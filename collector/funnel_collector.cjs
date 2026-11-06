#!/usr/bin/env node
/**
 * 경쟁사 퍼널 스냅샷 수집기 (funnel_collector.cjs)
 *
 * funnel_targets.json에 등록된 공개 페이지를 실제 브라우저(Playwright Chromium)로 열어
 *   - 화면 요소를 구조화 JSON으로 추출 (CTA / 추천·광고 영역 / 팝업·플로팅 / 가격·혜택 / 신뢰 / 긴급성)
 *   - 전체 페이지 스크린샷(JPEG)
 * 을 snapshots/<site>/<stage>/<YYYY-MM-DD>.json|.jpg 로 저장합니다.
 *
 * 원칙
 *   - 공개 페이지 GET만. 폼 제출·로그인·클릭 자동화 없음 (detail 단계의 followFrom은 리스트의 첫 링크 href로 이동할 뿐).
 *   - 요청 간 랜덤 지터, 모바일 UA. 주 1회 수준의 저빈도 실행을 전제로 함.
 *   - 개인정보(전화번호·차량번호)는 텍스트에서 마스킹 후 저장.
 *
 * 사용
 *   node collector/funnel_collector.cjs                      # 전체
 *   node collector/funnel_collector.cjs --site encar         # 특정 사이트
 *   node collector/funnel_collector.cjs --stage home         # 특정 단계
 *   node collector/funnel_collector.cjs --config path.json   # 다른 설정 파일
 *   node collector/funnel_collector.cjs --out snapshots # 출력 폴더
 *   node collector/funnel_collector.cjs --url https://... --competitor 엔카 --stage detail [--request-id r1] [--device 모바일|데스크톱|둘다]
 *       # 단일 URL 즉시 수집 (어드민 "URL로 수집" → repository_dispatch). 설정 파일의 sites는 무시.
 *   node collector/funnel_collector.cjs --url https://... --competitor 엔카 --flow [--request-id r1]
 *       # 흐름 모드: 첫 화면에서 시작해 리스트 → 상세 → 신청 버튼까지 따라가며 단계별 캡처 (입력·제출 없음)
 */

const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('playwright가 없습니다. `npm i -D playwright && npx playwright install chromium` 후 다시 실행하세요.'); process.exit(2); }

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..');
const CONFIG = path.resolve(ROOT, arg('--config', 'collector/funnel_targets.json'));
const OUT = path.resolve(ROOT, arg('--out', 'snapshots'));
const ONLY_SITE = arg('--site', null);
const ONLY_STAGE = arg('--stage', null);
const ADHOC_URL = arg('--url', null);
const ADHOC_COMPETITOR = arg('--competitor', null);
const ADHOC_REQUEST = arg('--request-id', null);
const ADHOC_DEVICE = arg('--device', null);
const FLOW = args.includes('--flow');

const KST = 9 * 60 * 60 * 1000;
const todayKst = () => new Date(Date.now() + KST).toISOString().slice(0, 10);
const nowKst = () => new Date(Date.now() + KST).toISOString().replace('Z', '+09:00');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (a, b) => sleep(a + Math.random() * (b - a));
const log = m => console.log(`[${new Date(Date.now() + KST).toISOString().slice(11, 19)}] ${m}`);

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const BLOCK_RX = /(403|forbidden|access denied|접근.?(거부|차단)|차단되었|blocked|captcha|robot|bot detection|unusual traffic|request blocked|just a moment)/i;

/** 개인정보 마스킹: 휴대폰 번호, 차량 번호판 */
function sanitize(s) {
  return String(s || '')
    .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '010-****-****')
    .replace(/\d{2,3}[가-힣]\s?\d{4}/g, '**가****')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------------ */
/* 페이지 안에서 실행되는 추출 스크립트 (브라우저 컨텍스트)              */
/* ------------------------------------------------------------------ */
const EXTRACT = () => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1);
  const txt = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const absY = el => { const r = el.getBoundingClientRect(); return r.top + window.scrollY; };
  const rel = el => { const r = el.getBoundingClientRect(); return { x: +((r.left + r.width / 2) / vw).toFixed(3), y: +((absY(el) + r.height / 2) / pageH).toFixed(3), w: Math.round(r.width), h: Math.round(r.height) }; };
  const fixedAncestor = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return n; } return null; };
  const bg = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return null; };

  const RX = {
    cta: /(구매|신청|예약|상담|견적|문의|시작|가입|로그인|바로|담기|장바구니|결제|주문|보러|확인하기|받기|둘러보기|검색|비교|찜|알림)/,
    promoHead: /(추천|인기|함께|많이 본|BEST|베스트|HOT|핫딜|특가|오늘의|신규|MD|기획전|이벤트|프로모션|랭킹|TOP|필요한|아티클|FAQ|자주 ?묻|빠르게|둘러보|지금 뜨는|화제|신차|한정|혜택)/i,
    urgency: /(오늘만|마감|남음|남았|한정|선착순|마지막|품절 임박|곧 종료|D-\d|\d+명이 보|실시간|지금)/,
    trust: /(리뷰|후기|평점|★|만족도|인증|보증|무료 반품|환불|보장|진단|검수|누적|회원|거래)/,
    price: /(할인|쿠폰|무료|적립|캐시백|혜택|%|원|특가|최저가|월 \d|이자|무이자)/,
    appInstall: /(앱 설치|앱에서|앱 다운|App Store|Google Play|앱으로)/i,
  };
  const classify = s => Object.entries({ urgency: RX.urgency, trust: RX.trust, price: RX.price }).filter(([, r]) => r.test(s)).map(([k]) => k);

  // 1) CTA 후보: 버튼/링크 중 보이는 것, 텍스트 2~20자, 충분히 큰 것
  const ctas = [];
  document.querySelectorAll('button, a, [role=button], input[type=submit]').forEach(el => {
    if (!vis(el)) return;
    const t = txt(el) || el.value || el.getAttribute('aria-label') || '';
    if (t.length < 2 || t.length > 24) return;
    const r = el.getBoundingClientRect();
    if (r.width < 80 || r.height < 32) return;
    const fx = fixedAncestor(el);
    const strong = RX.cta.test(t);
    const cs = getComputedStyle(el);
    const ownBg = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
    const ownBorder = parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
    const buttonLike = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || ownBg || ownBorder;
    if (!strong && !fx && !(buttonLike && r.width >= vw * 0.5)) return;
    if (!fx && r.height > 96) return; // 카드·리스트 행은 CTA가 아님
    ctas.push({ text: t, pos: rel(el), fixed: !!fx, fullWidth: r.width >= vw * 0.85, bg: bg(el), color: cs.color, fontSize: parseFloat(cs.fontSize), appeal: classify(t), href: el.href ? String(el.href).slice(0, 200) : undefined });
  });
  // 중복(같은 문구·위치) 제거, 상위 40개
  const seen = new Set();
  const ctaOut = ctas.filter(c => { const k = c.text + '|' + Math.round(c.pos.y * 50); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 40);

  // 2) 추천·광고 영역: 제목에 추천/인기/함께… 가 들어간 섹션 헤딩 + 그 섹션의 카드 개수 추정
  const promos = [];
  document.querySelectorAll('h1,h2,h3,h4,strong,[class*=title],[class*=tit]').forEach(h => {
    if (!vis(h)) return;
    const t = txt(h);
    if (t.length < 2 || t.length > 40 || !RX.promoHead.test(t)) return;
    let sec = h.closest('section, article, div[class*=sec], div[class*=area], div[class*=wrap], ul, div');
    for (let i = 0; i < 3 && sec && sec.getBoundingClientRect().height < 120; i++) sec = sec.parentElement;
    const items = sec ? sec.querySelectorAll('li, [class*=card], [class*=item], article').length : 0;
    const imgs = sec ? sec.querySelectorAll('img').length : 0;
    promos.push({ label: t, pos: rel(h), items, images: imgs, kind: /광고|AD|스폰서/i.test(t) ? 'ad' : 'reco' });
  });
  // 배너형 이미지/링크 (가로로 넓고 높이 60~400)
  document.querySelectorAll('[class*=banner], [class*=bnr], [class*=swiper-slide], [class*=slide], [class*=carousel] > *').forEach(el => {
    if (!vis(el)) return; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (r.width < vw * 0.8 || r.height < 60 || r.height > 420) return;
    if (!(cs.backgroundImage && cs.backgroundImage !== 'none') && !el.querySelector('img')) return;
    promos.push({ label: (txt(el) || '(배너)').slice(0, 80), pos: rel(el), items: 1, images: 1, kind: 'banner' });
  });
  document.querySelectorAll('a img, [class*=banner] img, [class*=bnr] img, [class*=swiper] img').forEach(img => {
    if (!vis(img)) return; const r = img.getBoundingClientRect();
    if (r.width < vw * 0.8 || r.height < 60 || r.height > 420) return;
    const alt = (img.alt || txt(img.closest('a') || img) || '').slice(0, 80);
    promos.push({ label: alt || '(배너 이미지)', pos: rel(img), items: 1, images: 1, kind: 'banner' });
  });
  const pseen = new Set();
  const promoOut = promos.filter(p => { const k = p.kind + '|' + Math.round(p.pos.y * 100); if (pseen.has(k)) return false; pseen.add(k); return true; }).slice(0, 30);

  // 3) 팝업·플로팅: fixed/sticky 요소, dialog, 모달류
  const overlays = [];
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    const cs = getComputedStyle(el);
    const isDialog = el.matches('dialog[open], [role=dialog], [aria-modal=true], [class*=modal], [class*=popup], [class*=layer], [class*=toast], [class*=floating], [class*=float], [class*=bottom-sheet], [class*=sheet]');
    if (cs.position !== 'fixed' && cs.position !== 'sticky' && !isDialog) continue;
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 24) continue;
    if (el.parentElement && overlays.some(o => o._el && o._el.contains(el))) continue; // 자식 중복 제거
    const t = txt(el).slice(0, 160);
    const area = (r.width * r.height) / (vw * vh);
    const kind = isDialog && area > 0.25 ? 'popup' : (r.top <= 2 && r.width >= vw * 0.9 ? 'header' : (r.bottom >= vh - 2 && r.width >= vw * 0.9 ? 'bottom-bar' : 'floating'));
    const purpose = RX.appInstall.test(t) ? 'app_install' : /쿠폰|할인|혜택/.test(t) ? 'coupon' : /첫 구매|신규|가입/.test(t) ? 'first_purchase' : /상담|문의|채팅|톡/.test(t) ? 'contact' : /검색/.test(t) ? 'search' : /구매|신청|견적/.test(t) ? 'cta' : 'other';
    overlays.push({ _el: el, kind, purpose, text: t, pos: rel(el), viewportArea: +area.toFixed(2), position: r.top <= 2 ? 'top' : r.bottom >= vh - 2 ? 'bottom' : 'middle' });
  }
  const overlayOut = overlays.map(({ _el, ...o }) => o).slice(0, 25);

  // 4) 첫 화면 메시지(뷰포트 상단에 보이는 가장 큰 텍스트 2개)
  const heads = [];
  document.querySelectorAll('h1,h2,h3,p,strong,span,div').forEach(el => {
    if (!vis(el) || el.children.length > 2) return;
    const r = el.getBoundingClientRect(); if (absY(el) > vh * 1.2) return;
    const t = txt(el); if (t.length < 6 || t.length > 60 || /^[\d\s,.주원%~\-]+$/.test(t)) return;
    const fs = parseFloat(getComputedStyle(el).fontSize); if (fs < 16) return;
    heads.push({ text: t, fontSize: fs, y: +(absY(el) / pageH).toFixed(3) });
  });
  heads.sort((a, b) => b.fontSize - a.fontSize);
  const hero = heads.slice(0, 3).map(h => ({ ...h, appeal: classify(h.text) }));

  // 5) 소구점 문구 수집 (전체 텍스트에서 짧은 문장 단위)
  const bodyText = (document.body.innerText || '').slice(0, 30000);
  const sentences = bodyText.split(/\n|(?<=[.!?。])\s|\s[·•|]\s|\t/).map(s => s.replace(/\s+/g, ' ').trim()).filter(s => s.length >= 4 && s.length <= 50);
  const pick = rx => [...new Set(sentences.filter(s => rx.test(s)))].slice(0, 12);
  const appeals = { urgency: pick(RX.urgency), trust: pick(RX.trust), price: pick(RX.price) };

  // 6) 디자인 근거(style): 색 팔레트, 글꼴, CTA 강조 방식, 고정 요소 비중
  const parseRgb = c => { const m = String(c || '').match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
  const hex = c => { const p = parseRgb(c); return p ? '#' + p.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : null; };
  const lum = p => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(p[0]) + 0.7152 * f(p[1]) + 0.0722 * f(p[2]); };
  const contrast = (a, b) => { const A = parseRgb(a), B = parseRgb(b); if (!A || !B) return null; const l1 = lum(A), l2 = lum(B); return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2); };
  const sat = p => { const mx = Math.max(p[0], p[1], p[2]), mn = Math.min(p[0], p[1], p[2]); return mx === 0 ? 0 : (mx - mn) / mx; };
  const paletteAcc = {};
  let fixedArea = 0;
  const bodyCs = getComputedStyle(document.body);
  const fontAcc = {};
  const weightAcc = {};
  for (const el of all) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect(); const area = r.width * r.height; if (area < 400) continue;
    const cs = getComputedStyle(el);
    const bgp = parseRgb(cs.backgroundColor);
    if (bgp && bgp[3] > 0.5) { const k = hex(cs.backgroundColor); paletteAcc[k] = (paletteAcc[k] || 0) + Math.min(area, vw * vh); }
    if ((cs.position === 'fixed' || cs.position === 'sticky') && absY(el) < vh) fixedArea += Math.min(area, vw * vh);
    if (el.children.length === 0 && txt(el).length > 2) { const f = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(); fontAcc[f] = (fontAcc[f] || 0) + txt(el).length; weightAcc[cs.fontWeight] = (weightAcc[cs.fontWeight] || 0) + txt(el).length; }
  }
  const totalArea = Object.values(paletteAcc).reduce((a, b) => a + b, 0) || 1;
  const palette = Object.entries(paletteAcc).map(([color, a]) => ({ color, share: +(a / totalArea).toFixed(3), saturation: +sat(parseRgb(color.replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)})`)) || [0, 0, 0]).toFixed(2) })).sort((a, b) => b.share - a.share);
  let brand = palette.filter(p => p.saturation >= 0.35 && p.share >= 0.005).slice(0, 3);
  if (!brand.length) {
    const acc = {};
    for (const el of all) { if (!vis(el)) continue; const cs = getComputedStyle(el); for (const c of [cs.backgroundColor, cs.color, cs.borderTopColor]) { const p = parseRgb(c); if (p && p[3] > 0.5 && sat(p) >= 0.5 && Math.max(p[0], p[1], p[2]) > 60) { const k = hex(c); acc[k] = (acc[k] || 0) + 1; } } }
    const tot = Object.values(acc).reduce((a, b) => a + b, 0) || 1;
    brand = Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([color, n]) => ({ color, share: +(n / tot).toFixed(3), saturation: +sat(parseRgb(color.replace(/^#(..)(..)(..)$/, (_, r, g, b) => `rgb(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)})`))).toFixed(2), by: 'count' }));
  }
  const headingEl = [...document.querySelectorAll('h1,h2')].find(vis);
  const topFonts = Object.entries(fontAcc).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([f]) => f);
  const ctaStyles = ctaOut.map(c => ({ text: c.text, bg: hex(c.bg), color: hex(c.color), contrast: contrast(c.bg, c.color), height: c.pos.h, widthRatio: +(c.pos.w / vw).toFixed(2), fixed: c.fixed, fontSize: c.fontSize, saturated: (parseRgb(c.bg) ? sat(parseRgb(c.bg)) : 0) >= 0.35 }));
  const primary = [...ctaStyles].sort((a, b) => (b.fixed - a.fixed) || (b.saturated - a.saturated) || (b.widthRatio * b.height - a.widthRatio * a.height))[0] || null;
  const style = {
    palette: palette.slice(0, 6), brand,
    fonts: { body: bodyCs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), top: topFonts, heading: headingEl ? getComputedStyle(headingEl).fontFamily.split(',')[0].replace(/["']/g, '').trim() : null, baseSize: parseFloat(bodyCs.fontSize), headingSize: headingEl ? parseFloat(getComputedStyle(headingEl).fontSize) : null, boldShare: +(((weightAcc['700'] || 0) + (weightAcc['600'] || 0) + (weightAcc['800'] || 0) + (weightAcc['bold'] || 0)) / (Object.values(weightAcc).reduce((a, b) => a + b, 0) || 1)).toFixed(2) },
    cta: { primary, count: ctaStyles.length, fixedCount: ctaStyles.filter(c => c.fixed).length, fullWidthCount: ctaStyles.filter(c => c.widthRatio >= 0.85).length, saturatedCount: ctaStyles.filter(c => c.saturated).length, avgHeight: ctaStyles.length ? Math.round(ctaStyles.reduce((a, c) => a + c.height, 0) / ctaStyles.length) : null, colors: [...new Set(ctaStyles.map(c => c.bg).filter(Boolean))].slice(0, 5) },
    fixedViewportShare: +Math.min(1, fixedArea / (vw * vh)).toFixed(2),
  };

  return { viewport: { w: vw, h: vh, pageHeight: pageH }, style, title: document.title, hero, ctas: ctaOut, promo: promoOut, overlays: overlayOut, appeals, counts: { links: document.querySelectorAll('a').length, images: document.querySelectorAll('img').length, buttons: document.querySelectorAll('button').length } };
};

/* ------------------------------------------------------------------ */
/* 이 저장소의 어드민 전송                        */
/* 확장 프로그램(extension/extract.js)이 보내는 것과 같은 모양으로 변환  */
/* ------------------------------------------------------------------ */
const ADMIN_URL = (process.env.FUNNEL_ADMIN_URL || '').trim().replace(/\/+$/, '');
const ADMIN_PW = (process.env.FUNNEL_ADMIN_PASSWORD || '').trim();

function band(yRatio, pageH, vh) { const y = yRatio * pageH; return y < vh ? '첫화면' : y < vh * 2 ? '스크롤1' : y < vh * 3 ? '스크롤2' : '하단'; }
function col(xRatio) { return xRatio < 1 / 3 ? '좌' : xRatio > 2 / 3 ? '우' : '중앙'; }
function toAdminCapture(res, cfg, stageDef, viewportShotB64, shotFull) {
  const vh = res.viewport.h, pageH = res.viewport.pageHeight;
  const posStr = p => p ? `${band(p.y, pageH, vh)}/${col(p.x)}` : '';
  const strongBg = bg => !!bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && !/^rgb\(2[3-5]\d, 2[3-5]\d, 2[3-5]\d\)$/.test(bg);
  const ctas = res.ctas.map(c => ({ text: c.text, pos: posStr(c.pos), fixed: !!c.fixed, strong: strongBg(c.bg), size: `${c.pos.w}x${c.pos.h}`, match: true, y: c.pos.y }));
  const benefits = [];
  for (const [k, arr] of Object.entries(res.appeals || {})) arr.forEach(t => benefits.push({ text: t, pos: k === 'urgency' ? '긴급성' : k === 'trust' ? '신뢰' : '가격·혜택' }));
  const overlays = [];
  for (const trg of res.overlays || []) for (const o of trg.overlays) overlays.push({ kind: o.kind === 'popup' ? '팝업' : o.kind === 'header' ? '상단바' : o.kind === 'bottom-bar' ? '하단바' : '플로팅', text: `[${trg.trigger}${o.purpose && o.purpose !== 'other' ? ' · ' + o.purpose : ''}] ${o.text}`, size: o.pos ? `${o.pos.w}x${o.pos.h}` : '' });
  const sections = res.promo.map(p => ({ title: (p.kind === 'banner' ? '[배너] ' : p.kind === 'ad' ? '[광고] ' : '') + p.label, cards: p.items, pos: posStr(p.pos), samplePrices: [] }));
  const headlines = res.hero.map(h => ({ tag: 'hero', text: h.text, pos: `${band(h.y, pageH, vh)}/중앙` }));
  return {
    id: res.requestId ? `req-${res.requestId}${res.flow ? '-' + res.stage : ''}${res.viewportKey && res.viewportKey !== 'mobile' ? '-' + res.viewportKey : ''}` : `auto-${res.site}-${res.stage}-${res.viewportKey || 'mobile'}-${res.capturedAt.slice(0, 10)}`,
    competitor: res.siteName,
    stage: stageDef?.adminStage || stageDef?.label || res.stage,
    device: res.device || (res.viewportKey === 'desktop' ? '데스크톱' : '모바일'),
    note: (res.flow ? `흐름 수집 ${res.flow.step}단계` + (res.flow.via ? ` · 진입: "${res.flow.via.text}"` : ' · 시작') : res.requestId ? '어드민 URL 수집 (GitHub Actions)' : (cfg.admin && cfg.admin.note) || '자동 수집') + (res.warning ? ' · ' + res.warning : ''),
    capturedAt: new Date(res.capturedAt).toISOString(),
    screenshot: viewportShotB64 ? 'data:image/jpeg;base64,' + viewportShotB64 : null,
    url: res.finalUrl || res.url,
    title: res.title,
    description: '',
    viewport: `${res.viewport.w}x${res.viewport.h}`,
    pageHeight: pageH,
    headlines, ctas, benefits, overlays, sections,
    prices: (res.appeals && res.appeals.price || []).map(s => (s.match(/[\d,]{2,}\s?(만원|원)/) || [])[0]).filter(Boolean).slice(0, 8),
    forms: [], nav: [],
    firstScreenText: res.hero.map(h => h.text).join(' | '),
    style: res.style || null, warning: res.warning || null, flow: res.flow || null, flowSummary: res.flowSummary || null, formsDetail: res.forms || null, adTech: res.adTech || null,
    source: 'funnel_collector', sourceStage: res.stage, viewportKey: res.viewportKey || null, screenshotFull: !!shotFull, screenshotHeight: shotFull ? Math.min(pageH, (cfg.capture && cfg.capture.maxScreenshotHeight) || 12000) : vh, overlaysByTrigger: res.overlays, promoDetail: res.promo, ctaDetail: res.ctas,
  };
}
async function pushToAdmin(capture) {
  const r = await fetch(ADMIN_URL + '/api/captures', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + ADMIN_PW }, body: JSON.stringify(capture) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`HTTP ${r.status} ${body.error || ''}`);
  return body;
}

async function capturePage(context, site, page_, cfg, resolvedUrl, shotPath) {
  const page = await context.newPage();
  attachRequestLog(page);
  const result = { site: site.key, siteName: site.name, stage: page_.stage, url: resolvedUrl, capturedAt: nowKst(), ok: false, _shotPath: shotPath };
  try {
    const resp = await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    result.httpStatus = resp ? resp.status() : null;
    await analyzeOnPage(page, site, page_.stage, cfg, shotPath, result);
  } catch (e) {
    result.error = String(e && e.message || e).slice(0, 300);
    log(`  ✖ ${site.name}/${page_.stage}  ${result.error}`);
    try { await page.screenshot({ path: result._shotPath.replace(/\.jpg$/, '.error.jpg'), type: 'jpeg', quality: 60 }); } catch (_) {}
  } finally {
    await page.close();
  }
  return result;
}

/** 이미 열려 있는 page를 분석해 result를 채움 (capturePage와 흐름 모드가 공용) */
async function analyzeOnPage(page, site, stageKey, cfg, shotPath, result) {
  const cap = cfg.capture || {};
  const page_ = { stage: stageKey };
  result.finalUrl = page.url();
    // SPA 대응: 네트워크가 잠잠해지고 본문 텍스트 길이가 안정될 때까지 (최대 settleMaxMs) 기다림
    try { await page.waitForLoadState('networkidle', { timeout: cap.networkIdleMs || 8000 }); } catch (_) {}
    await sleep(cap.waitAfterLoadMs || 3000);
    {
      const maxMs = cap.settleMaxMs || 12000, t0 = Date.now();
      let last = -1, stable = 0;
      while (Date.now() - t0 < maxMs) {
        const len = await page.evaluate(() => (document.body && document.body.innerText || '').length).catch(() => 0);
        if (len === last && len > 0) { if (++stable >= 2) break; } else stable = 0;
        last = len; await sleep(700);
      }
      result.settledMs = Date.now() - t0;
    }
    // 차단/오류 페이지 판정: HTTP 4xx/5xx 또는 짧은 본문에 차단 문구 → 실패로 기록 (우회하지 않음, 수동 캡처 안내)
    {
      const info = await page.evaluate(() => ({ title: document.title || '', text: (document.body && document.body.innerText || '').slice(0, 600) })).catch(() => ({ title: '', text: '' }));
      const short = info.text.replace(/\s+/g, ' ').length < 400;
      if ((result.httpStatus && result.httpStatus >= 400) || (short && BLOCK_RX.test(info.title + ' ' + info.text))) {
        throw new Error(`접근 차단 또는 오류 응답 (HTTP ${result.httpStatus || '?'}, "${(info.title || info.text).slice(0, 40)}") — 이 사이트는 자동 수집을 막고 있습니다. 확장 프로그램이나 즐겨찾기 버튼으로 직접 캡처하세요.`);
      }
      if (info.text.replace(/\s+/g, ' ').length < 200) result.warning = '본문 텍스트가 거의 없습니다. 로그인이 필요하거나 화면이 늦게 그려지는 페이지일 수 있습니다.';
    }

    // 로드 직후 오버레이
    const t0 = await page.evaluate(EXTRACT);
    const overlaysByTrigger = [{ trigger: 'load+' + Math.round((cap.waitAfterLoadMs || 3000) / 1000) + 's', overlays: t0.overlays }];

    // 스크롤 지점별 오버레이 (lazy 콘텐츠 로드 겸)
    for (const stop of cap.scrollStops || [0.3, 0.6, 1.0]) {
      await page.evaluate(s => window.scrollTo(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) * s), stop);
      await sleep(cap.scrollPauseMs || 1200);
      const o = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight; const out = [];
        document.querySelectorAll('body *').forEach(el => { const cs = getComputedStyle(el); if (cs.position !== 'fixed' && cs.position !== 'sticky' && !el.matches('[role=dialog],[aria-modal=true],[class*=modal],[class*=popup],[class*=floating]')) return; const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 24 || cs.display === 'none' || cs.visibility === 'hidden') return; if (out.some(x => x._el.contains(el))) return; out.push({ _el: el, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120), position: r.top <= 2 ? 'top' : r.bottom >= vh - 2 ? 'bottom' : 'middle', viewportArea: +((r.width * r.height) / (vw * vh)).toFixed(2) }); });
        return out.map(({ _el, ...o }) => o).slice(0, 15);
      });
      overlaysByTrigger.push({ trigger: 'scroll>' + Math.round(stop * 100) + '%', overlays: o });
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(600);

    // 전체 추출 (lazy 로드 후)
    const full = await page.evaluate(EXTRACT);
    // 트리거별 신규 오버레이만 남기기
    const seen = new Set();
    for (const t of overlaysByTrigger) {
      t.overlays = t.overlays.filter(o => { const k = o.text.slice(0, 40) + '|' + o.position; if (seen.has(k)) return false; seen.add(k); return true; }).map(o => ({ ...o, text: sanitize(o.text) }));
    }

    // 어드민용 스크린샷: 전체 페이지(1x, 핀 위치 매핑용). 너무 크면 보이는 화면만.
    const maxH = cap.maxScreenshotHeight || 12000;
    try {
      const fullB = await page.screenshot({ type: 'jpeg', quality: 55, scale: 'css', fullPage: full.viewport.pageHeight <= maxH, clip: full.viewport.pageHeight > maxH ? { x: 0, y: 0, width: full.viewport.w, height: maxH } : undefined });
      result._viewportB64 = fullB.length < 3.5 * 1024 * 1024 ? fullB.toString('base64') : (await page.screenshot({ type: 'jpeg', quality: 60 })).toString('base64');
      result._shotFull = fullB.length < 3.5 * 1024 * 1024;
    } catch (_) {}

    // 스크린샷
    await page.screenshot({ path: shotPath, type: 'jpeg', quality: cap.screenshotQuality || 80, fullPage: full.viewport.pageHeight <= maxH, clip: full.viewport.pageHeight > maxH ? { x: 0, y: 0, width: full.viewport.w, height: maxH } : undefined });

    Object.assign(result, {
      ok: true,
      viewport: full.viewport,
      title: sanitize(full.title),
      hero: full.hero.map(h => ({ ...h, text: sanitize(h.text) })),
      ctas: full.ctas.map(c => ({ ...c, text: sanitize(c.text) })),
      promo: full.promo.map(p => ({ ...p, label: sanitize(p.label) })),
      overlays: overlaysByTrigger,
      appeals: Object.fromEntries(Object.entries(full.appeals).map(([k, v]) => [k, v.map(sanitize)])),
      counts: full.counts,
      style: full.style,
      screenshot: path.basename(shotPath),
    });
    log(`  ✔ ${site.name}/${page_.stage}  CTA ${result.ctas.length} · 추천 ${result.promo.length} · 오버레이 ${overlaysByTrigger.reduce((a, t) => a + t.overlays.length, 0)} · ${full.viewport.pageHeight}px`);
  // 입력 폼 분석 (신청 단계 마찰 측정용)
  result.forms = await page.evaluate(() => {
    const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const txt = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const out = [];
    const forms = [...document.querySelectorAll('form')]; if (!forms.length) forms.push(document.body);
    for (const f of forms) {
      const fields = [...f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')].filter(vis);
      if (!fields.length) continue;
      out.push({ fields: fields.length, required: fields.filter(i => i.required || i.getAttribute('aria-required') === 'true').length, types: [...new Set(fields.map(i => i.type || i.tagName.toLowerCase()))].slice(0, 8), labels: fields.map(i => i.placeholder || i.getAttribute('aria-label') || i.name || i.id || i.type).filter(Boolean).slice(0, 10), submit: txt([...f.querySelectorAll('button, input[type=submit]')].filter(vis).find(b => /신청|제출|완료|확인|다음|보내기|요청|상담|견적|가입|로그인/.test(txt(b) || b.value || '')) || {}) || null, hasPassword: fields.some(i => i.type === 'password') });
    }
    const stepTxt = (document.body.innerText || '').match(/(STEP|단계)\s*\d+\s*(\/|of)?\s*\d*|\b\d\s*\/\s*\d\b/i);
    return { forms: out.slice(0, 4), stepIndicator: stepTxt ? stepTxt[0] : null, loginWall: /login|signin|sign-in|member\/|auth/i.test(location.href) || (out.some(f => f.hasPassword) && /로그인/.test(document.body.innerText || '')) };
  }).catch(() => ({ forms: [], stepIndicator: null, loginWall: false }));
  // 광고·마케팅 채널 신호
  try {
    const html = await page.content();
    const lg = page._adlog || { hosts: new Set(), scripts: [] };
    result.adTech = detectAdTech(lg.hosts, lg.scripts, html);
    if (result.adTech.tags.length) log(`  ◎ 광고/마케팅 태그: ${result.adTech.tags.map(t => t.label).join(', ')}`);
  } catch (_) {}
  return result;
}


/* ------------------------------------------------------------------ */
/* 광고·마케팅 채널 신호: 페이지가 부르는 트래킹 태그·픽셀로 어떤 광고 채널을 운영하는지 추정 */
/* ------------------------------------------------------------------ */
const AD_TECH = [
  { key: 'google_ads',   label: 'Google 광고 (전환태그)', channel: '구글 검색/디스플레이/유튜브', rx: /googleads\.g\.doubleclick\.net|googleadservices\.com|\/pagead\/conversion|gtag\(\s*['"]config['"]\s*,\s*['"]AW-|AW-\d{6,}/i },
  { key: 'ga4',          label: 'Google Analytics', channel: '(분석)', rx: /google-analytics\.com|googletagmanager\.com\/gtag\/js|G-[A-Z0-9]{6,}/ },
  { key: 'gtm',          label: 'Google Tag Manager', channel: '(태그 관리)', rx: /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{5,}/ },
  { key: 'meta_pixel',   label: 'Meta 픽셀', channel: '페이스북/인스타그램 광고', rx: /connect\.facebook\.net|facebook\.com\/tr\b|fbq\(\s*['"]init['"]/i },
  { key: 'naver_ads',    label: '네이버 광고 전환 (wcs)', channel: '네이버 검색광고/GFA', rx: /wcs\.naver\.net|wcs\.pstatic\.net|wcslog|naver\.com\/wcslog|_nasa\b/ },
  { key: 'naver_gfa',    label: '네이버 GFA 픽셀', channel: '네이버 성과형 디스플레이', rx: /adimg\.naver|gfa\.naver|siape\.veta\.naver|veta\.naver/ },
  { key: 'kakao_pixel',  label: '카카오 픽셀', channel: '카카오모먼트/카카오 광고', rx: /t1\.daumcdn\.net\/adfit|kakao\.com\/kp\.js|kakaoPixel\(|adfit\.kakao|t1\.daumcdn\.net\/kas/i },
  { key: 'tiktok',       label: 'TikTok 픽셀', channel: '틱톡 광고', rx: /analytics\.tiktok\.com|ttq\.load/i },
  { key: 'criteo',       label: 'Criteo', channel: '리타게팅 디스플레이', rx: /static\.criteo\.net|criteo\.com\/js|dis\.criteo/i },
  { key: 'karrot',       label: '당근 광고 픽셀', channel: '당근마켓 광고', rx: /karrotmarket|daangn\.com\/pixel|karrot\.ad/i },
  { key: 'linkedin',     label: 'LinkedIn Insight', channel: '링크드인 광고', rx: /snap\.licdn\.com|px\.ads\.linkedin/i },
  { key: 'twitter',      label: 'X(트위터) 픽셀', channel: 'X 광고', rx: /static\.ads-twitter\.com|analytics\.twitter\.com/i },
  { key: 'appsflyer',    label: 'AppsFlyer', channel: '앱 설치 광고 어트리뷰션', rx: /appsflyer\.com|onelink\.me/i },
  { key: 'airbridge',    label: 'Airbridge', channel: '앱 설치 광고 어트리뷰션', rx: /airbridge\.io|abr\.ge/i },
  { key: 'adjust',       label: 'Adjust', channel: '앱 설치 광고 어트리뷰션', rx: /adjust\.com|adj\.st/i },
  { key: 'branch',       label: 'Branch', channel: '딥링크/앱 어트리뷰션', rx: /branch\.io|app\.link/i },
  { key: 'amplitude',    label: 'Amplitude', channel: '(제품 분석)', rx: /amplitude\.com/i },
  { key: 'mixpanel',     label: 'Mixpanel', channel: '(제품 분석)', rx: /mixpanel\.com/i },
  { key: 'braze',        label: 'Braze', channel: '(CRM 푸시/메시지)', rx: /braze\.com|appboy/i },
  { key: 'hotjar',       label: 'Hotjar', channel: '(UX 녹화)', rx: /hotjar\.com/i },
  { key: 'clarity',      label: 'MS Clarity', channel: '(UX 녹화)', rx: /clarity\.ms/i },
  { key: 'channeltalk',  label: '채널톡', channel: '(상담 채널)', rx: /channel\.io/i },
  { key: 'kakao_channel',label: '카카오톡 채널 버튼', channel: '(상담 채널)', rx: /pf\.kakao\.com|kakao\.com\/channel/i },
  { key: 'naver_talk',   label: '네이버 톡톡', channel: '(상담 채널)', rx: /talk\.naver\.com/i },
  { key: 'youtube_embed',label: 'YouTube 임베드', channel: '(콘텐츠)', rx: /youtube\.com\/embed|youtube-nocookie/i },
];
function detectAdTech(hosts, scripts, html) {
  const hay = [...hosts, ...scripts].join('\n') + '\n' + (html || '').slice(0, 400000);
  const found = AD_TECH.filter(t => t.rx.test(hay)).map(t => ({ key: t.key, label: t.label, channel: t.channel }));
  const adIds = {};
  const m1 = (html || '').match(/AW-\d{6,}/g); if (m1) adIds.googleAds = [...new Set(m1)].slice(0, 3);
  const m2 = (html || '').match(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{6,})['"]/); if (m2) adIds.metaPixel = [m2[1]];
  const m3 = (html || '').match(/GTM-[A-Z0-9]{5,}/g); if (m3) adIds.gtm = [...new Set(m3)].slice(0, 3);
  const m4 = (html || '').match(/kakaoPixel\(\s*['"]([^'"]+)['"]/); if (m4) adIds.kakaoPixel = [m4[1]];
  const m5 = (html || '').match(/wcs_add\s*\[\s*['"]wa['"]\s*\]\s*=\s*['"]([^'"]+)['"]/); if (m5) adIds.naverWcs = [m5[1]];
  const paid = found.filter(f => !f.channel.startsWith('(')).map(f => f.channel);
  return { tags: found, ids: adIds, paidChannels: [...new Set(paid)], thirdPartyHosts: [...hosts].filter(h => !/^(127\.|localhost)/.test(h)).slice(0, 60) };
}
function attachRequestLog(page) {
  const hosts = new Set(), scripts = [];
  page.on('request', req => { try { const u = new URL(req.url()); if (u.hostname !== new URL(page.url() || 'http://x/').hostname) hosts.add(u.hostname); if (req.resourceType() === 'script') scripts.push(u.href.slice(0, 200)); } catch (_) {} });
  page._adlog = { hosts, scripts };
}

/* ------------------------------------------------------------------ */
/* 흐름 모드: 첫 화면 → 리스트 → 상세 → 신청 을 한 브라우저에서 따라가며 각 단계 캡처 */
/* 링크 이동과 '신청' 버튼 클릭까지만. 입력·제출은 절대 하지 않음.                 */
/* ------------------------------------------------------------------ */
const NEXT_RULES = {
  list:    { text: /차량|매물|전체|보기|찾기|검색|둘러보|리스트|견적|시작|구독|렌트|리스|모델/, hrefNot: /login|signin|member|event|notice|faq|terms|privacy|#$/i },
  detail:  { href: /detail|view|\/car[s]?\/|\/vehicle|\/model|\/product|\/item|id=|catalog|trim/i, hrefNot: /login|signin|list|search|category/i },
  inquiry: { text: /견적|신청|상담|문의|구매|예약|계약|시작하기|받기|바로 가기|이용하기/, hrefNot: /login|signin/i },
};
const FIND_NEXT = ({ stage, rule: rs }) => {
  const rule = { text: rs.text ? new RegExp(rs.text, 'i') : null, href: rs.href ? new RegExp(rs.href, 'i') : null, hrefNot: rs.hrefNot ? new RegExp(rs.hrefNot, 'i') : null };
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  const txt = el => (el.innerText || el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
  const pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1), vh = innerHeight, vw = innerWidth;
  const absY = el => el.getBoundingClientRect().top + scrollY;
  const fixed = el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; };
  const sameOrigin = h => { try { return new URL(h, location.href).origin === location.origin; } catch { return false; } };
  const cands = [];
  const els = stage === 'detail' ? [...document.querySelectorAll('a[href]')] : [...document.querySelectorAll('a[href], button, [role=button]')];
  for (const el of els) {
    if (!vis(el)) continue;
    const t = txt(el); const href = el.href || '';
    const r = el.getBoundingClientRect();
    if (absY(el) > pageH * 0.92 && !fixed(el)) continue;          // 푸터 제외
    if (href && rule.hrefNot && rule.hrefNot.test(href)) continue;
    if (href && !sameOrigin(href)) continue;
    if (href && href.replace(/#.*$/, '') === location.href.replace(/#.*$/, '')) continue;
    let score = 0;
    if (stage === 'detail') { if (!href || !rule.href.test(href)) continue; if (el.querySelector('img') || el.closest('li, article, [class*=card], [class*=item]')?.querySelector('img')) score += 2; if (/원|만원|km|년/.test(txt(el.closest('li, article, [class*=card], [class*=item]') || el))) score += 1; score -= absY(el) / pageH; }
    else { if (!t || t.length > 30 || !rule.text.test(t)) continue; if (fixed(el)) score += 3; if (r.width >= vw * 0.6) score += 2; if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') score += 1; const bg = getComputedStyle(el).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') score += 1; if (absY(el) < vh) score += 1; if (stage === 'list' && !href) score -= 2; }
    cands.push({ el, score, t, href, fixed: fixed(el), x: +((r.left + r.width / 2) / vw).toFixed(3), y: +((absY(el) + r.height / 2) / pageH).toFixed(3), w: Math.round(r.width), h: Math.round(r.height) });
  }
  cands.sort((a, b) => b.score - a.score);
  const pick = cands[0]; if (!pick) return null;
  document.querySelectorAll('[data-funnel-next]').forEach(n => n.removeAttribute('data-funnel-next'));
  pick.el.setAttribute('data-funnel-next', '1');
  const { el, ...rest } = pick;
  return { ...rest, kind: pick.href ? 'href' : 'click', candidates: cands.length };
};

async function runFlow(context, site, startUrl, cfg, vp, outDir, base, onStep) {
  const order = ['home', 'list', 'detail', 'inquiry'];
  const page = await context.newPage();
  attachRequestLog(page);
  const steps = []; let via = null;
  try {
    const resp = await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    for (let i = 0; i < order.length; i++) {
      const stage = order[i];
      const result = { site: site.key, siteName: site.name, stage, url: page.url(), capturedAt: nowKst(), ok: false, _shotPath: path.join(outDir, `${base}.${stage}.jpg`), httpStatus: i === 0 && resp ? resp.status() : null, flow: { step: i + 1, tapsFromHome: i, via } };
      try { await analyzeOnPage(page, site, stage, cfg, result._shotPath, result); }
      catch (e) { result.error = String(e.message || e).slice(0, 300); log(`  ✖ ${site.name}/${stage}  ${result.error}`); try { await page.screenshot({ path: result._shotPath.replace(/\.jpg$/, '.error.jpg'), type: 'jpeg', quality: 60 }); } catch (_) {} }
      result.flow.loginWall = !!(result.forms && result.forms.loginWall);
      steps.push(result);
      await onStep(result, i);
      if (!result.ok || result.flow.loginWall) break;
      const next = order[i + 1]; if (!next) break;
      const rs = NEXT_RULES[next];
      const found = await page.evaluate(FIND_NEXT, { stage: next, rule: { text: rs.text && rs.text.source, href: rs.href && rs.href.source, hrefNot: rs.hrefNot && rs.hrefNot.source } }).catch(e => { log('  FIND_NEXT 오류: ' + e.message); return null; });
      if (!found) { log(`  ⏹ ${stage} → ${next}: 다음 단계로 가는 링크/버튼을 찾지 못했습니다`); steps[steps.length - 1].flow.nextNotFound = next; break; }
      via = { from: stage, text: sanitize(found.t), kind: found.kind, href: found.href || null, fixed: found.fixed, pos: { x: found.x, y: found.y, w: found.w, h: found.h }, candidates: found.candidates };
      log(`  → ${next}: "${via.text}" (${found.kind}${found.fixed ? ', 고정' : ''})`);
      await jitter(1200, 2500);
      if (found.kind === 'href') { await page.goto(found.href, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {}); }
      else { await Promise.all([page.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => {}), page.click('[data-funnel-next]', { timeout: 10000 }).catch(() => {})]); await sleep(1500); }
    }
  } finally { await page.close(); }
  // 요약
  const last = steps[steps.length - 1];
  const inquiry = steps.find(s => s.stage === 'inquiry');
  const form = inquiry && inquiry.forms && inquiry.forms.forms && inquiry.forms.forms[0];
  const summary = {
    stagesReached: steps.filter(s => s.ok).map(s => s.stage),
    reachedInquiry: !!(inquiry && inquiry.ok),
    tapsToInquiry: inquiry ? inquiry.flow.tapsFromHome : null,
    loginRequired: !!(last && last.flow.loginWall),
    stoppedAt: last ? last.stage : null,
    stopReason: last && last.error ? '오류: ' + last.error.slice(0, 80) : last && last.flow.loginWall ? '로그인 필요' : last && last.flow.nextNotFound ? `다음 단계(${last.flow.nextNotFound}) 진입점 미발견` : inquiry ? null : '미도달',
    path: steps.map(s => ({ stage: s.stage, url: s.finalUrl || s.url, via: s.flow.via ? { text: s.flow.via.text, kind: s.flow.via.kind, fixed: s.flow.via.fixed } : null, overlays: s.overlays ? s.overlays.reduce((a, t) => a + t.overlays.length, 0) : 0, ctas: s.ctas ? s.ctas.length : 0, urgency: s.appeals ? s.appeals.urgency.length : 0, trust: s.appeals ? s.appeals.trust.length : 0, price: s.appeals ? s.appeals.price.length : 0 })),
    inquiryForm: form ? { fields: form.fields, required: form.required, types: form.types, labels: form.labels, submit: form.submit, stepIndicator: inquiry.forms.stepIndicator } : null,
  };
  return { steps, summary };
}

async function resolveFollow(context, site, page_, prior) {
  const from = prior[page_.followFrom];
  if (!from || !from.ok) throw new Error(`followFrom '${page_.followFrom}' 결과가 없습니다`);
  const page = await context.newPage();
  try {
    await page.goto(from.finalUrl || from.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(2500);
    const href = await page.evaluate(sel => { const a = document.querySelector(sel); return a ? a.href : null; }, page_.linkSelector);
    if (!href) throw new Error(`linkSelector에 맞는 링크가 없습니다: ${page_.linkSelector}`);
    return href;
  } finally { await page.close(); }
}

async function main() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const date = todayKst();
  let viewports = cfg.viewports || [Object.assign({ key: 'mobile', label: '모바일' }, cfg.viewport || { width: 390, height: 844, mobile: true })];
  if (ADHOC_URL) {
    // --device 모바일 | 데스크톱 | 둘다(기본)
    const want = ADHOC_DEVICE === '모바일' ? ['mobile'] : ADHOC_DEVICE === '데스크톱' ? ['desktop'] : FLOW ? ['mobile'] : ['mobile', 'desktop'];
    viewports = want.map(k => viewports.find(v => v.key === k) || (k === 'desktop' ? { key: 'desktop', label: '데스크톱', width: 1280, height: 800, mobile: false } : { key: 'mobile', label: '모바일', width: 390, height: 844, mobile: true }));
  }
  log(`퍼널 스냅샷 수집 시작 ${date}  (config: ${path.relative(ROOT, CONFIG)}, out: ${path.relative(ROOT, OUT)}, 화면: ${viewports.map(v => v.label).join('·')})`);
  const adminOn = !!(cfg.admin && cfg.admin.enabled !== false && ADMIN_URL && ADMIN_PW);
  if (cfg.admin && cfg.admin.enabled !== false && !adminOn) log('어드민 전송 생략: FUNNEL_ADMIN_URL / FUNNEL_ADMIN_PASSWORD 환경변수가 없습니다');
  else if (adminOn) log(`어드민 전송: ${ADMIN_URL}`);

  let sites = cfg.sites;
  if (ADHOC_URL) {
    const stageKey = ONLY_STAGE || 'home';
    const name = ADHOC_COMPETITOR || new URL(ADHOC_URL).hostname.replace(/^(www|m)\./, '');
    const key = 'adhoc-' + name.replace(/[^\w가-힣]+/g, '-').toLowerCase();
    sites = [{ key, name, pages: [{ stage: stageKey, url: ADHOC_URL }] }];
    log(`단일 URL 수집: ${name} / ${stageKey} / ${ADHOC_URL}${ADHOC_REQUEST ? ' (요청 ' + ADHOC_REQUEST + ')' : ''}`);
  }

  const browser = await chromium.launch({ headless: true, args: ['--lang=ko-KR'] });
  const index = { date, capturedAt: nowKst(), stages: cfg.stages, viewports: viewports.map(v => v.key), sites: [] };
  let total = 0, failed = 0;

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1,
      userAgent: vp.mobile ? MOBILE_UA : undefined, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
      extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' },
    });
    const suffix = vp.key === 'mobile' ? '' : '.' + vp.key;   // 모바일은 기존 파일명 유지(latest.json 호환)

    for (const site of sites) {
      if (ONLY_SITE && site.key !== ONLY_SITE) continue;
      log(`▶ ${site.name} [${vp.label}]`);
      const prior = {};
      const siteEntry = { key: site.key, name: site.name, viewport: vp.key, pages: [] };
      if (FLOW && ADHOC_URL) {
        const dir = path.join(OUT, 'flow'); fs.mkdirSync(dir, { recursive: true });
        const base = `${date}_${(ADHOC_REQUEST || Date.now().toString(36)).replace(/[^\w-]/g, '')}_${site.key}${suffix}`;
        const flowId = ADHOC_REQUEST || base;
        const pushed = [];
        const { steps, summary } = await runFlow(context, site, ADHOC_URL, cfg, vp, dir, base, async (res, i) => {
          res.viewportKey = vp.key; res.device = vp.label; res.requestId = ADHOC_REQUEST || undefined; res.flow.id = flowId;
          pushed.push(res);
        });
        for (const res of steps) {
          if (res === steps[steps.length - 1]) res.flowSummary = summary;
          const { _shotPath, _viewportB64, _shotFull, ...clean } = res;
          if (adminOn && clean.ok) {
            try { const stageDef = (cfg.stages || []).find(s => s.key === clean.stage); const out = await pushToAdmin(toAdminCapture(clean, cfg, stageDef, _viewportB64, _shotFull)); clean.admin = { ok: true, id: out.id }; log(`  ↑ 어드민 전송 완료 (${out.id})`); }
            catch (e) { clean.admin = { ok: false, error: String(e.message || e).slice(0, 200) }; log(`  ↑ 어드민 전송 실패: ${clean.admin.error}`); }
          } else if (adminOn && !clean.ok) {
            try { const stageDef = (cfg.stages || []).find(s => s.key === clean.stage); await pushToAdmin({ id: `req-${flowId}-${clean.stage}${vp.key !== 'mobile' ? '-' + vp.key : ''}`, competitor: site.name, stage: stageDef?.adminStage || clean.stage, device: vp.label, note: '흐름 수집 실패: ' + clean.error, capturedAt: new Date(clean.capturedAt).toISOString(), screenshot: null, url: clean.url, title: '', description: '', viewport: `${vp.width}x${vp.height}`, pageHeight: 0, headlines: [], ctas: [], benefits: [], overlays: [], sections: [], prices: [], forms: [], nav: [], firstScreenText: '', source: 'funnel_collector', captureError: clean.error, flow: clean.flow, flowSummary: clean.flowSummary || null }); } catch (_) {}
          }
          fs.writeFileSync(path.join(dir, `${base}.${clean.stage}.json`), JSON.stringify(clean, null, 2));
          total++; if (!clean.ok) failed++;
        }
        fs.writeFileSync(path.join(dir, `${base}.summary.json`), JSON.stringify(summary, null, 2));
        log(`  ■ 흐름 요약: ${summary.stagesReached.join(' → ')}${summary.reachedInquiry ? ` · 신청까지 ${summary.tapsToInquiry}탭` : ` · 중단: ${summary.stopReason}`}${summary.inquiryForm ? ` · 폼 ${summary.inquiryForm.fields}필드(필수 ${summary.inquiryForm.required})` : ''}${summary.loginRequired ? ' · 로그인 필요' : ''}`);
        index.sites.push({ key: site.key, name: site.name, viewport: vp.key, flow: summary });
        continue;
      }
      for (const p of site.pages) {
        if (ONLY_STAGE && p.stage !== ONLY_STAGE) continue;
        const dir = path.join(OUT, ADHOC_URL ? 'adhoc' : site.key, p.stage);
        fs.mkdirSync(dir, { recursive: true });
        let url = (vp.key === 'desktop' && p.urlDesktop) || p.url;
        let res;
        try {
          if (!url && p.followFrom) url = await resolveFollow(context, site, p, prior);
          res = await capturePage(context, site, p, cfg, url, path.join(dir, `${date}${suffix}.jpg`));
        } catch (e) {
          res = { site: site.key, siteName: site.name, stage: p.stage, url: url || null, capturedAt: nowKst(), ok: false, error: String(e.message || e).slice(0, 300) };
          log(`  ✖ ${site.name}/${p.stage}  ${res.error}`);
        }
        res.viewportKey = vp.key; res.device = vp.label;
        prior[p.stage] = res;
        if (ADHOC_URL) res.requestId = ADHOC_REQUEST || undefined;
        const { _shotPath, _viewportB64, _shotFull, ...clean } = res;
        if (!clean.ok && adminOn && ADHOC_URL) {
          // 실패도 어드민에 알림 (요청 내역에 '실패'와 사유가 보이도록)
          try {
            const stageDef = (cfg.stages || []).find(s => s.key === p.stage);
            await pushToAdmin({ id: `req-${clean.requestId}${vp.key !== 'mobile' ? '-' + vp.key : ''}`, competitor: site.name, stage: stageDef?.adminStage || p.stage, device: vp.label, note: '수집 실패: ' + clean.error, capturedAt: new Date(clean.capturedAt).toISOString(), screenshot: null, url: clean.url, title: '', description: '', viewport: `${vp.width}x${vp.height}`, pageHeight: 0, headlines: [], ctas: [], benefits: [], overlays: [], sections: [], prices: [], forms: [], nav: [], firstScreenText: '', source: 'funnel_collector', captureError: clean.error });
            log('  ↑ 어드민에 실패 알림 전송');
          } catch (e) { log(`  ↑ 어드민 전송 실패: ${String(e.message || e).slice(0, 120)}`); }
        }
        if (clean.ok && adminOn) {
          try {
            const stageDef = (cfg.stages || []).find(s => s.key === p.stage);
            const out = await pushToAdmin(toAdminCapture(clean, cfg, stageDef, _viewportB64, _shotFull));
            clean.admin = { ok: true, id: out.id, url: ADMIN_URL };
            log(`  ↑ 어드민 전송 완료 (${out.id})`);
          } catch (e) { clean.admin = { ok: false, error: String(e.message || e).slice(0, 200) }; log(`  ↑ 어드민 전송 실패: ${clean.admin.error}`); }
        }
        const base = (ADHOC_URL ? `${date}_${(ADHOC_REQUEST || Date.now().toString(36)).replace(/[^\w-]/g, '')}_${site.key}` : date) + suffix;
        if (ADHOC_URL && clean.screenshot) { try { fs.renameSync(path.join(dir, clean.screenshot), path.join(dir, base + '.jpg')); clean.screenshot = base + '.jpg'; } catch (_) {} }
        fs.writeFileSync(path.join(dir, `${base}.json`), JSON.stringify(clean, null, 2));
        if (!ADHOC_URL) fs.writeFileSync(path.join(dir, `latest${suffix}.json`), JSON.stringify(clean, null, 2));
        if (!ADHOC_URL && clean.ok && clean.screenshot) { try { fs.copyFileSync(path.join(dir, clean.screenshot), path.join(dir, `latest${suffix}.jpg`)); } catch (_) {} }
        siteEntry.pages.push({ stage: p.stage, ok: !!clean.ok, url: clean.url, error: clean.error, ctas: clean.ctas ? clean.ctas.length : 0, promo: clean.promo ? clean.promo.length : 0, overlays: clean.overlays ? clean.overlays.reduce((a, t) => a + t.overlays.length, 0) : 0 });
        total++; if (!clean.ok) failed++;
        await jitter(1500, 4000);
      }
      index.sites.push(siteEntry);
      // 정기 수집: 신청까지 흐름 (모바일만)
      if (!ADHOC_URL && site.flowStart && vp.key === 'mobile' && !ONLY_STAGE) {
        const dir = path.join(OUT, site.key, 'flow'); fs.mkdirSync(dir, { recursive: true });
        const flowId = `auto-${site.key}-${date}`;
        try {
          const { steps, summary } = await runFlow(context, site, site.flowStart, cfg, vp, dir, date, async (res) => { res.viewportKey = vp.key; res.device = vp.label; res.flow.id = flowId; });
          for (const res of steps) {
            if (res === steps[steps.length - 1]) res.flowSummary = summary;
            const { _shotPath, _viewportB64, _shotFull, ...clean } = res;
            if (adminOn && clean.ok) { try { const stageDef = (cfg.stages || []).find(s => s.key === clean.stage); clean.requestId = undefined; const payload = toAdminCapture(clean, cfg, stageDef, _viewportB64, _shotFull); payload.id = `${flowId}-${clean.stage}`; const out = await pushToAdmin(payload); clean.admin = { ok: true, id: out.id }; } catch (e) { clean.admin = { ok: false, error: String(e.message || e).slice(0, 200) }; } }
            fs.writeFileSync(path.join(dir, `${date}.${clean.stage}.json`), JSON.stringify(clean, null, 2));
          }
          fs.writeFileSync(path.join(dir, `${date}.summary.json`), JSON.stringify(summary, null, 2));
          fs.writeFileSync(path.join(dir, `latest.summary.json`), JSON.stringify(summary, null, 2));
          siteEntry.flow = summary;
          log(`  ■ 흐름 요약: ${summary.stagesReached.join(' → ')}${summary.reachedInquiry ? ` · 신청까지 ${summary.tapsToInquiry}탭` : ` · 중단: ${summary.stopReason}`}`);
        } catch (e) { log(`  ✖ 흐름 수집 실패: ${String(e.message || e).slice(0, 200)}`); }
        await jitter(1500, 3000);
      }
    }
    await context.close();
  }
  await browser.close();

  fs.mkdirSync(OUT, { recursive: true });
  if (!ADHOC_URL) {
    fs.writeFileSync(path.join(OUT, `index_${date}.json`), JSON.stringify(index, null, 2));
    fs.writeFileSync(path.join(OUT, `index_latest.json`), JSON.stringify(index, null, 2));
  }
  log(`완료: ${total}개 페이지, 실패 ${failed}개`);
  process.exit(total && failed === total ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
