// 엣지 수집: Cloudflare Browser Run(워커 안의 헤드리스 크롬)으로 경쟁사 페이지를 모바일 화면으로 열어 분석.
// 브라우저는 요청을 처리하는 Cloudflare 데이터센터(한국에서 누르면 보통 서울)에서 뜨므로 접속 IP가 한국이 됩니다.
// 분석 로직은 수집기(collector/funnel_collector.cjs)와 같은 lib/pagefns.cjs 를 씁니다.
import puppeteer from "@cloudflare/puppeteer";
import pf from "./pagefns.cjs";
const { MOBILE_UA, BLOCK_RX, sanitize, EXTRACT, detectAdTech, guessStage, toAdminCapture, SITE_ERROR_SCAN, OVERLAY_SCAN, EXPAND_SCROLL, FORMS_SCAN } = pf;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const VP = { width: 390, height: 844 };
const STAGE_MAP = { home: "첫 화면(랜딩)", list: "상품 목록", detail: "상품 상세", inquiry: "신청·문의", other: "기타" };

export async function edgeCapture(env, { url, competitor, stage, requestId, budgetMs = 50000 }) {
  const t0 = Date.now();
  const browser = await puppeteer.launch(env.BROWSER);
  const page = await browser.newPage();
  const res = { siteName: competitor, stage: stage || "home", url, capturedAt: new Date().toISOString(), requestId, device: "모바일", viewportKey: "mobile", source: "edge" };
  const hosts = new Set(), scripts = [];
  try {
    await page.setUserAgent(MOBILE_UA);
    await page.setViewport({ ...VP, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    await page.setExtraHTTPHeaders({ "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8" });
    page.on("request", (req) => { try { const u = new URL(req.url()); const h = new URL(url).hostname; if (u.hostname !== h) hosts.add(u.hostname); if (req.resourceType() === "script") scripts.push(req.url()); } catch {} });
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    res.httpStatus = resp ? resp.status() : null;
    res.finalUrl = page.url();
    try { await page.waitForNetworkIdle({ idleTime: 800, timeout: 6000 }); } catch {}
    await sleep(2000);
    // 본문 길이 안정화 (SPA)
    { let last = -1, stable = 0; const tt = Date.now(); while (Date.now() - tt < 6000) { const len = await page.evaluate(() => (document.body && document.body.innerText || "").length).catch(() => 0); if (len === last && len > 0) { if (++stable >= 2) break; } else stable = 0; last = len; await sleep(600); } }
    // 사이트 오류 창 → 다시 시도 (1회)
    const err = await page.evaluate(SITE_ERROR_SCAN).catch(() => null);
    if (err) { res.siteErrorSeen = 1; if (err.hasRetry) await page.click("[data-funnel-retry]").catch(() => {}); else await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {}); await sleep(3000); const still = await page.evaluate(() => /네트워크가 원활하지|네트워크 오류|인터넷 연결 상태|다시 시도해/i.test(document.body.innerText || "")).catch(() => false); if (still) res.warning = "사이트 오류 창이 남아 있습니다(한국 IP 경유인데도 실패) — 휴대폰에서 즐겨찾기 버튼으로 수집해 보세요."; }
    // 차단 판정
    const info = await page.evaluate(() => ({ title: document.title || "", text: (document.body && document.body.innerText || "").slice(0, 600) })).catch(() => ({ title: "", text: "" }));
    const short = info.text.replace(/\s+/g, " ").length < 400;
    if ((res.httpStatus && res.httpStatus >= 400) || (short && BLOCK_RX.test(info.title + " " + info.text))) throw new Error(`접근 차단 또는 오류 응답 (HTTP ${res.httpStatus || "?"}, "${(info.title || info.text).slice(0, 40)}")`);
    if (info.text.replace(/\s+/g, " ").length < 200) res.warning = res.warning || "본문 텍스트가 거의 없습니다. 로그인이 필요하거나 화면이 늦게 그려지는 페이지일 수 있습니다.";
    // 오버레이: 로드 직후 + 스크롤 지점
    const t = await page.evaluate(EXTRACT);
    const overlaysByTrigger = [{ trigger: "load+2s", overlays: t.overlays }];
    for (const stop of [0.3, 0.6, 1.0]) {
      if (Date.now() - t0 > budgetMs - 15000) break;
      await page.evaluate((s) => window.scrollTo(0, Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) * s), stop);
      await sleep(900);
      const o = await page.evaluate(OVERLAY_SCAN).catch(() => []);
      overlaysByTrigger.push({ trigger: "scroll>" + Math.round(stop * 100) + "%", overlays: o });
    }
    await page.evaluate(() => window.scrollTo(0, 0)); await sleep(400);
    try { const n = await page.evaluate(EXPAND_SCROLL); if (n) { res.expandedScroll = n; await sleep(400); await page.evaluate(() => window.scrollTo(0, 0)); } } catch {}
    const full = await page.evaluate(EXTRACT);
    const seen = new Set();
    for (const g of overlaysByTrigger) g.overlays = g.overlays.filter((o) => { const k = o.text.slice(0, 40) + "|" + o.position; if (seen.has(k)) return false; seen.add(k); return true; }).map((o) => ({ ...o, text: sanitize(o.text) }));
    // 전체 페이지 스크린샷 (최대 12000px, 3.5MB 넘으면 보이는 화면만)
    const maxH = 12000; let b64 = null, shotFull = false;
    try {
      const big = full.viewport.pageHeight <= maxH;
      const buf = await page.screenshot({ type: "jpeg", quality: 55, fullPage: big, clip: big ? undefined : { x: 0, y: 0, width: full.viewport.w, height: maxH } });
      if (buf.length < 3.5 * 1024 * 1024) { b64 = Buffer.from(buf).toString("base64"); shotFull = big; } else { b64 = Buffer.from(await page.screenshot({ type: "jpeg", quality: 60 })).toString("base64"); }
    } catch {}
    res.forms = await page.evaluate(FORMS_SCAN).catch(() => ({ forms: [], stepIndicator: null, loginWall: false }));
    try { res.adTech = detectAdTech(hosts, scripts, await page.content()); } catch {}
    Object.assign(res, { ok: true, viewport: full.viewport, title: sanitize(full.title), hero: full.hero.map((h) => ({ ...h, text: sanitize(h.text) })), ctas: full.ctas.map((c) => ({ ...c, text: sanitize(c.text) })), promo: full.promo.map((p) => ({ ...p, label: sanitize(p.label) })), overlays: overlaysByTrigger, appeals: Object.fromEntries(Object.entries(full.appeals).map(([k, v]) => [k, v.map(sanitize)])), counts: full.counts, style: full.style });
    if (!stage || stage === "auto") res.stage = guessStage(res.finalUrl, res.title);
    const cfg = { capture: { maxScreenshotHeight: maxH } };
    const payload = toAdminCapture(res, cfg, { adminStage: STAGE_MAP[res.stage] || "기타" }, b64, shotFull);
    payload.id = `edge-${requestId}`; payload.source = "edge_capture"; payload.note = `한국 IP 경유 즉시 수집 (Cloudflare 엣지)` + (res.warning ? " · " + res.warning : "");
    payload.elapsedMs = Date.now() - t0;
    return payload;
  } catch (e) {
    return { id: `edge-${requestId}`, competitor, stage: STAGE_MAP[stage] || "첫 화면(랜딩)", device: "모바일", note: "즉시 수집 실패: " + String(e.message || e).slice(0, 200), capturedAt: res.capturedAt, screenshot: null, url, title: "", description: "", viewport: `${VP.width}x${VP.height}`, pageHeight: 0, headlines: [], ctas: [], benefits: [], overlays: [], sections: [], prices: [], forms: [], nav: [], firstScreenText: "", source: "edge_capture", captureError: String(e.message || e).slice(0, 300), elapsedMs: Date.now() - t0 };
  } finally {
    try { await browser.close(); } catch {}
  }
}
