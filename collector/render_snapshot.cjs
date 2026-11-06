#!/usr/bin/env node
/**
 * 수동 수집본(즐겨찾기)의 DOM 스냅샷을 브라우저에 그려 전체 화면 스크린샷을 만들고, 같은 id로 어드민에 다시 저장합니다.
 *   node collector/render_snapshot.cjs --id <capture id>
 * 환경변수: FUNNEL_ADMIN_URL, FUNNEL_ADMIN_PASSWORD
 */
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const id = args[args.indexOf('--id') + 1];
const ADMIN = (process.env.FUNNEL_ADMIN_URL || '').replace(/\/+$/, ''), PW = process.env.FUNNEL_ADMIN_PASSWORD || '';
if (!id || !ADMIN || !PW) { console.error('--id, FUNNEL_ADMIN_URL, FUNNEL_ADMIN_PASSWORD 가 필요합니다'); process.exit(2); }
const H = { Authorization: 'Bearer ' + PW, 'Content-Type': 'application/json' };

(async () => {
  const r = await fetch(`${ADMIN}/api/captures?id=${encodeURIComponent(id)}`, { headers: H });
  if (!r.ok) { console.error('캡처 조회 실패', r.status); process.exit(1); }
  const row = await r.json();
  const d = row.data || {};
  const rd = await fetch(`${ADMIN}/api/captures?id=${encodeURIComponent(id + '-dom')}`, { headers: H });
  const domRow = rd.ok ? await rd.json() : null;
  d.dom = domRow && domRow.data && domRow.data.dom;
  if (!d.dom) { console.log('DOM 스냅샷이 없는 캡처입니다. 건너뜀.'); return; }
  const mobile = (row.device || '') === '모바일';
  const [vw, vh] = (d.viewport || (mobile ? '390x844' : '1280x800')).split('x').map(Number);
  const browser = await chromium.launch({ headless: true, args: ['--lang=ko-KR'] });
  const ctx = await browser.newContext({ viewport: { width: vw || (mobile ? 390 : 1280), height: vh || (mobile ? 844 : 800) }, isMobile: mobile, deviceScaleFactor: 1, locale: 'ko-KR', bypassCSP: true });
  const page = await ctx.newPage();
  // 원본 사이트의 이미지·CSS는 <base href>로 절대 경로가 되어 그대로 불러옵니다 (GitHub 러너 IP). 스크립트는 제거되어 있음.
  await page.setContent(d.dom, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const pageH = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  const maxH = 12000;
  const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: pageH <= maxH, clip: pageH > maxH ? { x: 0, y: 0, width: vw, height: maxH } : undefined });
  await browser.close();
  const screenshot = 'data:image/jpeg;base64,' + buf.toString('base64');
  // 같은 id로 다시 저장 (ingest는 upsert). 컬럼 필드 + data 필드를 모두 보냄
  const { dom, ...rest } = d;
  const payload = { id: row.id, competitor: row.competitor, stage: row.stage, device: row.device, note: row.note, url: row.url, title: row.title, capturedAt: row.captured_at, screenshot, ...rest, screenshotFull: pageH <= maxH, screenshotHeight: Math.min(pageH, maxH), renderedAt: new Date().toISOString(), renderedBy: 'funnel_render' };
  const u = await fetch(`${ADMIN}/api/captures`, { method: 'POST', headers: H, body: JSON.stringify(payload) });
  console.log(u.ok ? `렌더 완료: ${row.competitor} / ${row.stage} / ${pageH}px → ${row.id}` : `저장 실패 ${u.status}`);
  if (!u.ok) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
