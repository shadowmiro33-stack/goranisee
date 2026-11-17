// 수집기(GitHub Actions·로컬)와 엣지 수집(Cloudflare 워커)이 함께 쓰는 페이지 분석 코드
// 페이지 안에서 실행되는 함수(EXTRACT 등)는 브라우저 API만 쓰고, 나머지는 Node/워커 공용.
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const BLOCK_RX = /(403|forbidden|access denied|접근.?(거부|차단)|차단되었|blocked|captcha|robot|bot detection|unusual traffic|request blocked|just a moment)/i;
const CRAWL_SKIP = /login|signin|signup|join|logout|member|mypage|cart|order|checkout|pay|terms|privacy|policy|\.(pdf|jpg|png|gif|zip|xml|json)$|mailto:|tel:|javascript:|#/i;
function sanitize(s) {
  return String(s || '')
    .replace(/01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/g, '010-****-****')
    .replace(/\d{2,3}[가-힣]\s?\d{4}/g, '**가****')
    .replace(/\s+/g, ' ')
    .trim();
}
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
function band(yRatio, pageH, vh) { const y = yRatio * pageH; return y < vh ? '첫화면' : y < vh * 2 ? '스크롤1' : y < vh * 3 ? '스크롤2' : '하단'; }
function col(xRatio) { return xRatio < 1 / 3 ? '좌' : xRatio > 2 / 3 ? '우' : '중앙'; }
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
function guessStage(url, title) {
  const u = (url + ' ' + (title || '')).toLowerCase();
  if (/detail|view|\/car[s]?\/\d|\/vehicle\/|id=\d|\/product\//.test(u)) return 'detail';
  if (/list|search|category|catalog|\/cars?$|\/vehicles?|model/.test(u)) return 'list';
  if (/estimate|quote|inquiry|consult|apply|request|contact|견적|상담|신청/.test(u)) return 'inquiry';
  if (/event|promotion|benefit|이벤트|기획전/.test(u)) return 'event';
  if (/faq|notice|about|company|review|blog|article|news|guide/.test(u)) return 'etc';
  return 'etc';
}
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
    id: res.requestId ? `req-${res.requestId}${res.crawl ? '-p' + res.crawl.index : ''}${res.flow ? '-' + res.stage : ''}${res.viewportKey && res.viewportKey !== 'mobile' ? '-' + res.viewportKey : ''}` : `auto-${res.site}-${res.stage}-${res.viewportKey || 'mobile'}-${res.capturedAt.slice(0, 10)}`,
    competitor: res.siteName,
    stage: stageDef?.adminStage || stageDef?.label || res.stage,
    device: res.device || (res.viewportKey === 'desktop' ? '데스크톱' : '모바일'),
    note: (res.crawl ? `전체 페이지 수집 #${res.crawl.index} (깊이 ${res.crawl.depth})` : res.flow ? `흐름 수집 ${res.flow.step}단계` + (res.flow.via ? ` · 진입: "${res.flow.via.text}"` : ' · 시작') : res.requestId ? '어드민 URL 수집 (GitHub Actions)' : (cfg.admin && cfg.admin.note) || '자동 수집') + (res.warning ? ' · ' + res.warning : ''),
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
    style: res.style || null, warning: res.warning || null, siteErrorSeen: res.siteErrorSeen || 0, flow: res.flow || null, flowSummary: res.flowSummary || null, crawl: res.crawl || null, formsDetail: res.forms || null, adTech: res.adTech || null,
    source: 'funnel_collector', sourceStage: res.stage, viewportKey: res.viewportKey || null, screenshotFull: !!shotFull, screenshotHeight: shotFull ? Math.min(pageH, (cfg.capture && cfg.capture.maxScreenshotHeight) || 12000) : vh, overlaysByTrigger: res.overlays, promoDetail: res.promo, ctaDetail: res.ctas,
  };
}

// 페이지 안에서 실행: 사이트 자체 오류 창(네트워크 오류·다시 시도) 탐지 → 버튼에 data-funnel-retry 표시
const SITE_ERROR_SCAN = () => {
  const RX = /네트워크가 원활하지|네트워크 (오류|연결)|인터넷 연결 상태|다시 시도해|일시적인 오류|서버와의 연결|요청이 실패|Network Error|Something went wrong|try again/i;
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 80 && r.height > 40 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const cands = [...document.querySelectorAll('[role=dialog], [aria-modal=true], [class*=modal], [class*=popup], [class*=layer], [class*=dialog], [class*=toast]')].filter(vis);
  for (const el of cands) { const t = (el.innerText || '').replace(/\s+/g, ' '); if (t.length < 400 && RX.test(t)) { const btn = [...el.querySelectorAll('button, a, [role=button]')].find(b => /다시 ?시도|재시도|retry|확인|새로고침/i.test(b.innerText || '')); if (btn) btn.setAttribute('data-funnel-retry', '1'); return { text: t.slice(0, 120), hasRetry: !!btn }; } }
  return null;
};
// 페이지 안에서 실행: 현재 스크롤 위치에서 보이는 고정/플로팅/모달 요소
const OVERLAY_SCAN = () => {
  const vw = innerWidth, vh = innerHeight; const out = [];
  document.querySelectorAll('body *').forEach(el => { const cs = getComputedStyle(el); if (cs.position !== 'fixed' && cs.position !== 'sticky' && !el.matches('[role=dialog],[aria-modal=true],[class*=modal],[class*=popup],[class*=floating]')) return; const r = el.getBoundingClientRect(); if (r.width < 40 || r.height < 24 || cs.display === 'none' || cs.visibility === 'hidden') return; if (out.some(x => x._el.contains(el))) return; out.push({ _el: el, text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120), position: r.top <= 2 ? 'top' : r.bottom >= vh - 2 ? 'bottom' : 'middle', viewportArea: +((r.width * r.height) / (vw * vh)).toFixed(2) }); });
  return out.map(({ _el, ...o }) => o).slice(0, 15);
};
// 페이지 안에서 실행: 내부 스크롤 컨테이너를 펼쳐 전체 높이가 문서에 반영되게
const EXPAND_SCROLL = () => {
  let n = 0; const vh = innerHeight;
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el); if (!/(auto|scroll)/.test(cs.overflowY)) continue;
    const r = el.getBoundingClientRect(); if (r.height < vh * 0.5 || el.scrollHeight <= el.clientHeight + 50) continue;
    el.style.setProperty('height', 'auto', 'important'); el.style.setProperty('max-height', 'none', 'important'); el.style.setProperty('overflow', 'visible', 'important'); n++;
  }
  for (const el of [document.documentElement, document.body]) { const cs = getComputedStyle(el); if (/(hidden|auto|scroll)/.test(cs.overflowY) && el.scrollHeight <= el.clientHeight + 50) { el.style.setProperty('height', 'auto', 'important'); el.style.setProperty('overflow', 'visible', 'important'); } }
  return n;
};
// 페이지 안에서 실행: 입력 폼 마찰 측정
const FORMS_SCAN = () => {
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const txt = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  const out = [];
  const forms = [...document.querySelectorAll('form')]; if (!forms.length) forms.push(document.body);
  for (const f of forms) {
    const fields = [...f.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea')].filter(vis);
    if (!fields.length) continue;
    out.push({ fields: fields.length, required: fields.filter(i => i.required || i.getAttribute('aria-required') === 'true').length, types: [...new Set(fields.map(i => i.type || i.tagName.toLowerCase()))].slice(0, 8), labels: fields.map(i => i.placeholder || i.getAttribute('aria-label') || (i.labels && i.labels[0] && txt(i.labels[0])) || i.name || '').filter(Boolean).slice(0, 12), submit: (f.querySelector('button[type=submit], input[type=submit], button') ? txt(f.querySelector('button[type=submit], input[type=submit], button')) : '').slice(0, 40), hasPassword: fields.some(i => i.type === 'password') });
  }
  const stepTxt = (document.body.innerText || '').match(/(STEP|단계)\s*\d+\s*(\/|of)?\s*\d*|\b\d\s*\/\s*\d\b/i);
  return { forms: out.slice(0, 4), stepIndicator: stepTxt ? stepTxt[0] : null, loginWall: /login|signin|sign-in|member\/|auth/i.test(location.href) || (out.some(f => f.hasPassword) && /로그인/.test(document.body.innerText || '')) };
};
module.exports = { MOBILE_UA, BLOCK_RX, CRAWL_SKIP, sanitize, EXTRACT, band, col, AD_TECH, detectAdTech, guessStage, toAdminCapture, SITE_ERROR_SCAN, OVERLAY_SCAN, EXPAND_SCROLL, FORMS_SCAN };
