#!/usr/bin/env node
/**
 * 경쟁사 퍼널 스냅샷 수집기 (funnel_collector.js)
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
 *   node collector/funnel_collector.js                      # 전체
 *   node collector/funnel_collector.js --site encar         # 특정 사이트
 *   node collector/funnel_collector.js --stage home         # 특정 단계
 *   node collector/funnel_collector.js --config path.json   # 다른 설정 파일
 *   node collector/funnel_collector.js --out snapshots # 출력 폴더
 *   node collector/funnel_collector.js --url https://... --competitor 엔카 --stage detail [--request-id r1] [--device 모바일|데스크톱|둘다]
 *       # 단일 URL 즉시 수집 (어드민 "URL로 수집" → repository_dispatch). 설정 파일의 sites는 무시.
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

const KST = 9 * 60 * 60 * 1000;
const todayKst = () => new Date(Date.now() + KST).toISOString().slice(0, 10);
const nowKst = () => new Date(Date.now() + KST).toISOString().replace('Z', '+09:00');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (a, b) => sleep(a + Math.random() * (b - a));
const log = m => console.log(`[${new Date(Date.now() + KST).toISOString().slice(11, 19)}] ${m}`);

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';

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
    promoHead: /(추천|인기|함께|많이 본|BEST|베스트|HOT|핫딜|특가|오늘의|신규|MD|기획전|이벤트|프로모션|랭킹|TOP)/i,
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
    if (!strong && !fx && r.width < vw * 0.6) return;
    const cs = getComputedStyle(el);
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
    const t = txt(el); if (t.length < 4 || t.length > 60) return;
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
  const brand = palette.filter(p => p.saturation >= 0.35 && p.share >= 0.005).slice(0, 3);
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
    id: res.requestId ? `req-${res.requestId}${res.viewportKey && res.viewportKey !== 'mobile' ? '-' + res.viewportKey : ''}` : `auto-${res.site}-${res.stage}-${res.viewportKey || 'mobile'}-${res.capturedAt.slice(0, 10)}`,
    competitor: res.siteName,
    stage: stageDef?.adminStage || stageDef?.label || res.stage,
    device: res.device || (res.viewportKey === 'desktop' ? '데스크톱' : '모바일'),
    note: res.requestId ? '어드민 URL 수집 (GitHub Actions)' : (cfg.admin && cfg.admin.note) || '자동 수집',
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
    style: res.style || null,
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
  const cap = cfg.capture || {};
  const result = { site: site.key, siteName: site.name, stage: page_.stage, url: resolvedUrl, capturedAt: nowKst(), ok: false, _shotPath: shotPath };
  try {
    const resp = await page.goto(resolvedUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    result.httpStatus = resp ? resp.status() : null;
    result.finalUrl = page.url();
    await sleep(cap.waitAfterLoadMs || 3000);

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
  } catch (e) {
    result.error = String(e && e.message || e).slice(0, 300);
    log(`  ✖ ${site.name}/${page_.stage}  ${result.error}`);
    try { await page.screenshot({ path: result._shotPath.replace(/\.jpg$/, '.error.jpg'), type: 'jpeg', quality: 60 }); } catch (_) {}
  } finally {
    await page.close();
  }
  return result;
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
    const want = ADHOC_DEVICE === '모바일' ? ['mobile'] : ADHOC_DEVICE === '데스크톱' ? ['desktop'] : ['mobile', 'desktop'];
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

  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--lang=ko-KR'] });
  const index = { date, capturedAt: nowKst(), stages: cfg.stages, viewports: viewports.map(v => v.key), sites: [] };
  let total = 0, failed = 0;

  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, deviceScaleFactor: vp.mobile ? 2 : 1,
      userAgent: vp.mobile ? MOBILE_UA : undefined, locale: 'ko-KR', timezoneId: 'Asia/Seoul',
      extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8' },
    });
    await context.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    const suffix = vp.key === 'mobile' ? '' : '.' + vp.key;   // 모바일은 기존 파일명 유지(latest.json 호환)

    for (const site of sites) {
      if (ONLY_SITE && site.key !== ONLY_SITE) continue;
      log(`▶ ${site.name} [${vp.label}]`);
      const prior = {};
      const siteEntry = { key: site.key, name: site.name, viewport: vp.key, pages: [] };
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
