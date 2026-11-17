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
 *   node collector/funnel_collector.cjs --url https://... --competitor 엔카 --crawl --max-pages 30
 *       # 전체 페이지 수집: 같은 도메인 링크(및 sitemap)를 따라 최대 N페이지 캡처, URL로 단계 자동 분류
 *   node collector/funnel_collector.cjs --url https://... --competitor 엔카 --flow [--request-id r1]
 *       # 흐름 모드: 첫 화면에서 시작해 리스트 → 상세 → 신청 버튼까지 따라가며 단계별 캡처 (입력·제출 없음)
 */

const fs = require('fs');
const path = require('path');
const { MOBILE_UA, BLOCK_RX, CRAWL_SKIP, sanitize, EXTRACT, band, col, AD_TECH, detectAdTech, guessStage, toAdminCapture } = require('../lib/pagefns.cjs');

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
const CRAWL = args.includes('--crawl');
const CRAWL_MAX = Math.min(80, Math.max(1, parseInt(arg('--max-pages', '30')) || 30));

const KST = 9 * 60 * 60 * 1000;
const todayKst = () => new Date(Date.now() + KST).toISOString().slice(0, 10);
const nowKst = () => new Date(Date.now() + KST).toISOString().replace('Z', '+09:00');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = (a, b) => sleep(a + Math.random() * (b - a));
const log = m => console.log(`[${new Date(Date.now() + KST).toISOString().slice(11, 19)}] ${m}`);


/** 개인정보 마스킹: 휴대폰 번호, 차량 번호판 */

/* ------------------------------------------------------------------ */
/* 페이지 안에서 실행되는 추출 스크립트 (브라우저 컨텍스트)              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* 이 저장소의 어드민 전송                        */
/* 확장 프로그램(extension/extract.js)이 보내는 것과 같은 모양으로 변환  */
/* ------------------------------------------------------------------ */
const ADMIN_URL = (process.env.FUNNEL_ADMIN_URL || '').trim().replace(/\/+$/, '');
const ADMIN_PW = (process.env.FUNNEL_ADMIN_PASSWORD || '').trim();

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
    // 사이트 자체 오류 창(네트워크 오류·다시 시도) 감지 → '다시 시도' 클릭 또는 새로고침 후 재대기 (최대 2회). 해외 IP·요청 제한으로 SPA API가 실패할 때 뜸
    for (let attempt = 0; attempt < 2; attempt++) {
      const err = await page.evaluate(() => {
        const RX = /네트워크가 원활하지|네트워크 (오류|연결)|인터넷 연결 상태|다시 시도해|일시적인 오류|서버와의 연결|요청이 실패|Network Error|Something went wrong|try again/i;
        const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 80 && r.height > 40 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
        const cands = [...document.querySelectorAll('[role=dialog], [aria-modal=true], [class*=modal], [class*=popup], [class*=layer], [class*=dialog], [class*=toast]')].filter(vis);
        for (const el of cands) { const t = (el.innerText || '').replace(/\s+/g, ' '); if (t.length < 400 && RX.test(t)) { const btn = [...el.querySelectorAll('button, a, [role=button]')].find(b => /다시 ?시도|재시도|retry|확인|새로고침/i.test(b.innerText || '')); if (btn) { btn.setAttribute('data-funnel-retry', '1'); return { text: t.slice(0, 80), hasRetry: true }; } return { text: t.slice(0, 80), hasRetry: false }; } }
        return null;
      }).catch(() => null);
      if (!err) break;
      log(`  ↻ 사이트 오류 창 감지("${err.text.slice(0, 40)}") → ${err.hasRetry ? '다시 시도 클릭' : '새로고침'} (${attempt + 1}/2)`);
      result.siteErrorSeen = (result.siteErrorSeen || 0) + 1;
      if (err.hasRetry) await page.click('[data-funnel-retry]', { timeout: 5000 }).catch(() => {}); else await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await sleep(4000 + attempt * 3000);
      try { await page.waitForLoadState('networkidle', { timeout: 8000 }); } catch (_) {}
      if (attempt === 1) { const still = await page.evaluate(() => /네트워크가 원활하지|네트워크 오류|인터넷 연결 상태|다시 시도해/i.test(document.body.innerText || '')).catch(() => false); if (still) result.warning = '사이트 오류 창이 남아 있음(해외 IP 거부 또는 요청 제한 추정) → 휴대폰 즐겨찾기로 재수집 권장'; }
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

    // 페이지 내부 스크롤 영역(SPA의 overflow:auto 컨테이너)을 펼쳐 전체 높이가 문서 높이에 반영되도록 함
    try {
      const expanded = await page.evaluate(() => {
        let n = 0; const vh = innerHeight;
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el); if (!/(auto|scroll)/.test(cs.overflowY)) continue;
          const r = el.getBoundingClientRect(); if (r.height < vh * 0.5 || el.scrollHeight <= el.clientHeight + 50) continue;
          el.style.setProperty('height', 'auto', 'important'); el.style.setProperty('max-height', 'none', 'important'); el.style.setProperty('overflow', 'visible', 'important'); n++;
        }
        for (const el of [document.documentElement, document.body]) { const cs = getComputedStyle(el); if (/(hidden|auto|scroll)/.test(cs.overflowY) && el.scrollHeight <= el.clientHeight + 50) { el.style.setProperty('height', 'auto', 'important'); el.style.setProperty('overflow', 'visible', 'important'); } }
        return n;
      });
      if (expanded) { await sleep(600); result.expandedScroll = expanded; await page.evaluate(() => window.scrollTo(0, 0)); }
    } catch (_) {}
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
function attachRequestLog(page) {
  const hosts = new Set(), scripts = [];
  page.on('request', req => { try { const u = new URL(req.url()); if (u.hostname !== new URL(page.url() || 'http://x/').hostname) hosts.add(u.hostname); if (req.resourceType() === 'script') scripts.push(u.href.slice(0, 200)); } catch (_) {} });
  page._adlog = { hosts, scripts };
}

/* ------------------------------------------------------------------ */
/* 전체 페이지 수집(crawl): 시작 URL에서 같은 도메인 링크를 너비우선으로 따라가며 최대 N페이지 캡처 */
/* GET 이동만. 로그인·폼·검색 결과 파라미터 페이지는 제외. sitemap.xml 이 있으면 우선 사용.      */
/* ------------------------------------------------------------------ */
async function fetchSitemap(context, origin) {
  const urls = [];
  for (const sm of ['/sitemap.xml', '/sitemap_index.xml']) {
    try {
      const r = await context.request.get(origin + sm, { timeout: 10000 }); if (!r.ok()) continue;
      const xml = await r.text(); const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1]);
      for (const l of locs) { if (/sitemap.*\.xml$/i.test(l) && urls.length < 2000) { try { const r2 = await context.request.get(l, { timeout: 10000 }); if (r2.ok()) urls.push(...[...(await r2.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map(m => m[1])); } catch (_) {} } else urls.push(l); }
      if (urls.length) break;
    } catch (_) {}
  }
  return [...new Set(urls)];
}
async function runCrawl(context, site, startUrl, cfg, vp, outDir, base, maxPages, onPage) {
  const origin = new URL(startUrl).origin;
  const seen = new Set(), queue = [{ url: startUrl, depth: 0 }], results = [];
  const norm = u => { try { const x = new URL(u, startUrl); x.hash = ''; if (x.origin !== origin) return null; if (CRAWL_SKIP.test(x.pathname + x.search)) return null; if ([...x.searchParams.keys()].length > 2) return null; return x.href; } catch { return null; } };
  const sm = await fetchSitemap(context, origin);
  if (sm.length) { log(`  sitemap ${sm.length}개 URL 발견`); sm.map(norm).filter(Boolean).forEach(u => queue.push({ url: u, depth: 1 })); }
  const page = await context.newPage();
  attachRequestLog(page);
  try {
    while (queue.length && results.length < maxPages) {
      const { url, depth } = queue.shift();
      const n = norm(url); if (!n || seen.has(n)) continue; seen.add(n);
      const result = { site: site.key, siteName: site.name, stage: 'etc', url: n, capturedAt: nowKst(), ok: false, _shotPath: path.join(outDir, `${base}.${String(results.length + 1).padStart(3, '0')}.jpg`), crawl: { index: results.length + 1, depth, from: startUrl } };
      try {
        const resp = await page.goto(n, { waitUntil: 'domcontentloaded', timeout: 45000 });
        result.httpStatus = resp ? resp.status() : null;
        if (seen.has(page.url()) && page.url() !== n) { seen.add(n); continue; } // 리다이렉트로 이미 본 페이지
        await analyzeOnPage(page, site, 'etc', cfg, result._shotPath, result);
        result.stage = depth === 0 ? 'home' : guessStage(page.url(), result.title);
        // 다음 링크 수집 (depth 제한 2)
        if (depth < 2) {
          const links = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map(a => a.href)).catch(() => []);
          const fresh = [...new Set(links.map(norm).filter(Boolean))].filter(u => !seen.has(u));
          fresh.slice(0, 60).forEach(u => queue.push({ url: u, depth: depth + 1 }));
        }
      } catch (e) { result.error = String(e.message || e).slice(0, 300); log(`  ✖ ${site.name} #${result.crawl.index} ${n}  ${result.error}`); }
      results.push(result);
      await onPage(result);
      await jitter(4000, 8000);
    }
  } finally { await page.close(); }
  return { results, discovered: seen.size, queued: queue.length };
}

/* ------------------------------------------------------------------ */
/* 흐름 모드: 첫 화면 → 리스트 → 상세 → 신청 을 한 브라우저에서 따라가며 각 단계 캡처 */
/* 링크 이동과 '신청' 버튼 클릭까지만. 입력·제출은 절대 하지 않음.                 */
/* ------------------------------------------------------------------ */
const NEXT_RULES = {
  list:    { text: /차량|매물|전체|보기|찾기|검색|둘러보|리스트|견적|시작|구독|렌트|리스|모델/, strong: /차량|매물|전체 ?차량|전체 ?보기|차 ?찾기|검색|둘러보|모델|견적/, weak: /^더 ?보기$|^더보기 ?>?$|아티클|소식|이벤트|공지/, hrefHint: /car|vehicle|list|search|model|product|catalog|estimate/i, hrefNot: /login|signin|member|event|notice|faq|terms|privacy|article|blog|news|#$/i },
  detail:  { href: /detail|view|\/car[s]?\/|\/vehicle|\/model|\/product|\/item|id=|catalog|trim|estimate|quote/i, hrefNot: /login|signin|category|article|blog|news|faq/i },
  inquiry: { text: /견적|신청|상담|문의|구매|예약|계약|시작하기|받기|바로 가기|이용하기/, hrefNot: /login|signin/i },
};
const FIND_NEXT = ({ stage, rule: rs }) => {
  const rule = { text: rs.text ? new RegExp(rs.text, 'i') : null, href: rs.href ? new RegExp(rs.href, 'i') : null, hrefNot: rs.hrefNot ? new RegExp(rs.hrefNot, 'i') : null, strong: rs.strong ? new RegExp(rs.strong, 'i') : null, weak: rs.weak ? new RegExp(rs.weak, 'i') : null, hrefHint: rs.hrefHint ? new RegExp(rs.hrefHint, 'i') : null };
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
    else { if (!t || t.length > 30 || !rule.text.test(t)) continue; if (rule.strong && rule.strong.test(t)) score += 3; if (rule.weak && rule.weak.test(t)) score -= 3; if (rule.hrefHint && href && rule.hrefHint.test(href)) score += 2; if (fixed(el)) score += 3; if (r.width >= vw * 0.6) score += 2; if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') score += 1; const bg = getComputedStyle(el).backgroundColor; if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') score += 1; if (absY(el) < vh) score += 1; if (stage === 'list' && !href) score -= 2; }
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
      const selOverride = site.flowSelectors && site.flowSelectors[next];
      const found = selOverride ? await page.evaluate(sel => {
        const el = [...document.querySelectorAll(sel)].find(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); if (!el) return null;
        document.querySelectorAll('[data-funnel-next]').forEach(n => n.removeAttribute('data-funnel-next')); el.setAttribute('data-funnel-next', '1');
        const r = el.getBoundingClientRect(); const pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1);
        return { t: (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(), href: el.href || '', kind: el.href ? 'href' : 'click', fixed: false, x: +((r.left + r.width / 2) / innerWidth).toFixed(3), y: +((r.top + scrollY + r.height / 2) / pageH).toFixed(3), w: Math.round(r.width), h: Math.round(r.height), candidates: 1, bySelector: true };
      }, selOverride).catch(() => null) : await page.evaluate(FIND_NEXT, { stage: next, rule: { text: rs.text && rs.text.source, href: rs.href && rs.href.source, hrefNot: rs.hrefNot && rs.hrefNot.source, strong: rs.strong && rs.strong.source, weak: rs.weak && rs.weak.source, hrefHint: rs.hrefHint && rs.hrefHint.source } }).catch(e => { log('  FIND_NEXT 오류: ' + e.message); return null; });
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
    const want = ADHOC_DEVICE === '모바일' ? ['mobile'] : ADHOC_DEVICE === '데스크톱' ? ['desktop'] : ['mobile']; // 기본 모바일만 (데스크톱은 --device 데스크톱 명시 시에만)
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

  // FUNNEL_PROXY=http://user:pass@host:port 를 주면 그 경유지(예: 한국 IP 프록시)로 접속합니다
  const proxyUrl = (process.env.FUNNEL_PROXY || '').trim();
  let proxy; if (proxyUrl) { try { const u = new URL(proxyUrl); proxy = { server: `${u.protocol}//${u.hostname}${u.port ? ':' + u.port : ''}`, username: decodeURIComponent(u.username || ''), password: decodeURIComponent(u.password || '') }; log(`프록시 경유: ${u.hostname}`); } catch { log('FUNNEL_PROXY 형식 오류 — 무시'); } }
  const browser = await chromium.launch({ headless: true, args: ['--lang=ko-KR'], proxy });
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
      if (CRAWL && ADHOC_URL) {
        const dir = path.join(OUT, 'crawl'); fs.mkdirSync(dir, { recursive: true });
        const base = `${date}_${(ADHOC_REQUEST || Date.now().toString(36)).replace(/[^\w-]/g, '')}_${site.key}${suffix}`;
        log(`  전체 페이지 수집 시작 (최대 ${CRAWL_MAX}페이지)`);
        const stageMap = { event: '이벤트/기획전', etc: '기타' };
        const { results, discovered, queued } = await runCrawl(context, site, ADHOC_URL, cfg, vp, dir, base, CRAWL_MAX, async (res) => {
          res.viewportKey = vp.key; res.device = vp.label; res.requestId = ADHOC_REQUEST || undefined;
          const { _shotPath, _viewportB64, _shotFull, ...clean } = res;
          if (adminOn && clean.ok) {
            try { const stageDef = (cfg.stages || []).find(s => s.key === clean.stage) || { adminStage: stageMap[clean.stage] || '기타' }; const out = await pushToAdmin(toAdminCapture(clean, cfg, stageDef, _viewportB64, _shotFull)); clean.admin = { ok: true, id: out.id }; log(`  ↑ 어드민 전송 (${out.id}) [${clean.stage}] ${clean.url}`); }
            catch (e) { clean.admin = { ok: false, error: String(e.message || e).slice(0, 200) }; log(`  ↑ 어드민 전송 실패: ${clean.admin.error}`); }
          }
          fs.writeFileSync(path.join(dir, `${base}.${String(clean.crawl.index).padStart(3, '0')}.json`), JSON.stringify(clean, null, 2));
          total++; if (!clean.ok) failed++;
        });
        const summary = { pages: results.length, ok: results.filter(r => r.ok).length, discovered, notVisited: queued, byStage: results.reduce((a, r) => (a[r.stage] = (a[r.stage] || 0) + 1, a), {}), urls: results.map(r => ({ url: r.finalUrl || r.url, stage: r.stage, ok: r.ok, title: r.title })) };
        fs.writeFileSync(path.join(dir, `${base}.summary.json`), JSON.stringify(summary, null, 2));
        log(`  ■ 전체 수집 요약: ${summary.ok}/${summary.pages}페이지, 발견 ${discovered} (미방문 ${queued}) · ${Object.entries(summary.byStage).map(([k, v]) => k + ' ' + v).join(', ')}`);
        index.sites.push({ key: site.key, name: site.name, viewport: vp.key, crawl: summary });
        continue;
      }
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
