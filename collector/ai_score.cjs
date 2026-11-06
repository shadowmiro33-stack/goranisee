#!/usr/bin/env node
/**
 * AI UI/UX 채점: 캡처(스크린샷 + 추출 데이터)를 Claude에 보내 루브릭 점수와 개선점을 받아 캡처에 저장합니다.
 *   node collector/ai_score.cjs --id <capture id>            # 1건
 *   node collector/ai_score.cjs --competitor <이름>           # 그 경쟁사의 단계별 최신 캡처 전부
 * 환경변수: ANTHROPIC_API_KEY, FUNNEL_ADMIN_URL, FUNNEL_ADMIN_PASSWORD
 */
const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const ADMIN = (process.env.FUNNEL_ADMIN_URL || '').replace(/\/+$/, ''), PW = process.env.FUNNEL_ADMIN_PASSWORD || '', KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.AI_SCORE_MODEL || 'claude-sonnet-5-5';
if (!ADMIN || !PW) { console.error('FUNNEL_ADMIN_URL / FUNNEL_ADMIN_PASSWORD 필요'); process.exit(2); }
if (!KEY) { console.error('ANTHROPIC_API_KEY 가 없습니다. 저장소 Secrets에 추가하세요.'); process.exit(2); }
const H = { Authorization: 'Bearer ' + PW, 'Content-Type': 'application/json' };

const RUBRIC = `당신은 자동차 커머스(중고차·장기렌트·리스·구독) 서비스의 시니어 UX 리뷰어입니다. 아래 화면(스크린샷)과 추출 데이터를 보고, 이 퍼널 단계의 목적(첫 화면=가치제안·탐색 유도, 목록=비교·선택, 상세=확신·신청 유도, 신청=마찰 최소화)에 비추어 전문가 의견을 씁니다.
한국어로, 근거는 화면에서 실제로 보이는 요소를 인용해 구체적으로. 추측은 "추정"이라고 표시.
JSON만 출력:
{
 "summary": "3~4문장 총평 (이 화면이 사용자를 다음 단계로 얼마나 잘 밀어주는지)",
 "scores": {
   "value_prop": {"score":0~10, "why":"한 줄 근거"},   // 첫인상·가치제안 명확성
   "cta": {"score":0~10, "why":"..."},                // CTA 문구·위치·강조
   "hierarchy": {"score":0~10, "why":"..."},          // 시각 위계·가독성
   "trust": {"score":0~10, "why":"..."},              // 신뢰 요소(리뷰·보증·가격 투명성)
   "friction": {"score":0~10, "why":"..."},           // 마찰 적음(팝업·입력·단계). 적을수록 높은 점수
   "mobile": {"score":0~10, "why":"..."},             // 모바일 적합성·터치 타깃·고정 요소 적정
   "consistency": {"score":0~10, "why":"..."},        // 톤·디자인 일관성
   "next_step": {"score":0~10, "why":"..."}           // 다음 단계로 자연스럽게 미는 설계
 },
 "total": 가중평균(소수1자리; 가중치 value_prop20 cta20 hierarchy10 trust15 friction15 mobile10 consistency5 next_step5),
 "strengths": ["잘한 점 3개, 각 한 문장"],
 "issues": [{"priority":"높음|중간|낮음","issue":"문제","why":"사용자에게 미치는 영향","fix":"구체적 수정 제안"}],  // 3~5개, 우선순위순
 "takeaways": ["우리가 가져갈 점 2~3개"],
 "avoid": ["우리가 피할 점 1~2개"]
}`;

async function getCapture(id) { const r = await fetch(`${ADMIN}/api/captures?id=${encodeURIComponent(id)}`, { headers: H }); if (!r.ok) throw new Error('캡처 조회 실패 ' + r.status); return r.json(); }
async function listCaptures() { const r = await fetch(`${ADMIN}/api/captures`, { headers: H }); if (!r.ok) throw new Error('목록 조회 실패 ' + r.status); return r.json(); }

function summarize(d) {
  const o = {
    url: d.url, title: d.title, viewport: d.viewport, pageHeight: d.pageHeight,
    headlines: (d.headlines || []).slice(0, 8).map(h => h.text), ctas: (d.ctas || []).slice(0, 12).map(c => ({ text: c.text, pos: c.pos, fixed: c.fixed, strong: c.strong })),
    benefits: (d.benefits || []).slice(0, 12).map(b => b.text), overlays: (d.overlays || []).slice(0, 8).map(o => ({ kind: o.kind, text: String(o.text || '').slice(0, 80) })),
    sections: (d.sections || []).slice(0, 8).map(s => ({ title: s.title, cards: s.cards, pos: s.pos })), forms: (d.forms || []).slice(0, 4), nav: (d.nav || []).slice(0, 15),
    style: d.style ? { brand: d.style.brand, fonts: d.style.fonts, cta: d.style.cta, fixedViewportShare: d.style.fixedViewportShare } : null,
    flow: d.flow || null, flowSummary: d.flowSummary || null,
  };
  return JSON.stringify(o).slice(0, 12000);
}

async function score(row) {
  const d = row.data || {};
  const content = [];
  if (row.screenshot && row.screenshot.startsWith('data:image/')) {
    const m = row.screenshot.match(/^data:(image\/\w+);base64,(.+)$/);
    if (m && m[2].length < 6_000_000) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
  }
  content.push({ type: 'text', text: `경쟁사: ${row.competitor}\n퍼널 단계: ${row.stage}\n화면: ${row.device || ''}\n추출 데이터(JSON): ${summarize(d)}` });
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: RUBRIC, messages: [{ role: 'user', content }] }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Claude API ${r.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 200)}`);
  const text = (j.content || []).map(c => c.text || '').join('');
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('JSON 응답 아님: ' + text.slice(0, 200));
  const parsed = JSON.parse(m[0]);
  parsed.model = MODEL; parsed.scoredAt = new Date().toISOString(); parsed.withScreenshot = content.length > 1;
  return parsed;
}

async function save(row, aiScore) {
  const { screenshot, ...rest } = row;
  const payload = { id: row.id, competitor: row.competitor, stage: row.stage, device: row.device, note: row.note, url: row.url, title: row.title, capturedAt: row.captured_at, screenshot: row.screenshot, ...(row.data || {}), aiScore };
  const u = await fetch(`${ADMIN}/api/captures`, { method: 'POST', headers: H, body: JSON.stringify(payload) });
  if (!u.ok) throw new Error('저장 실패 ' + u.status);
}

(async () => {
  let ids = [];
  if (arg('--id')) ids = [arg('--id')];
  else if (arg('--competitor')) {
    const all = (await listCaptures()).filter(c => c.competitor === arg('--competitor') && c.stage !== '광고데이터' && !(c.data && c.data.captureError));
    const latest = {}; all.sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at)).forEach(c => { const k = c.stage + '|' + (c.device || ''); if (!latest[k]) latest[k] = c; });
    ids = Object.values(latest).map(c => c.id);
  }
  if (!ids.length) { console.log('채점할 캡처가 없습니다'); return; }
  let ok = 0;
  for (const id of ids) {
    try { const row = await getCapture(id); const s = await score(row); await save(row, s); ok++; console.log(`✔ ${row.competitor} / ${row.stage} / ${row.device || ''} → 총점 ${s.total}  (${id})`); }
    catch (e) { console.log(`✖ ${id}: ${e.message}`); }
  }
  console.log(`완료 ${ok}/${ids.length}`);
  if (!ok) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
