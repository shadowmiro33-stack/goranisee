// ---------- 광고비 추정 (역산 모델) ----------
// 데이터는 captures 테이블에 stage="광고데이터" 행으로 저장합니다 (스키마 변경 없음).
//   data.type = "assumptions" (id: adspend-assumptions, 1개)
//   data.type = "keyword_obs" : 검색광고 관측 1건 = {keyword, volume, cpc, ranks:{경쟁사: 순위}, date}
//   data.type = "creative_obs": 소재 수 관측 1건 = {competitor_name, channel: "meta"|"google", creatives, avgDays, date}
const AD_STAGE = "광고데이터";
const DEFAULT_ASSUMPTIONS = {
  // ── 건수 가정 (클릭률·노출) ──
  ctrByRank: [0.12, 0.07, 0.045, 0.03, 0.02],          // 파워링크 모바일 1~5위 클릭률
  impressionShareByRank: [0.95, 0.9, 0.85, 0.8, 0.7],  // 순위별 노출 점유율 (검색량 중 실제 노출 비율)
  cpcRankFactor: [1, 0.8, 0.65, 0.55, 0.45],             // 순위별 CPC = 1위 CPC × 계수
  // ── 단가 가이드 (플랫폼 공식 최소값·기본값 기준, VAT 별도) ──
  naverPowerlinkMinCpc: 70,                              // 네이버 파워링크 최소 입찰가 70원 (네이버 검색광고 안내, 2026)
  cpcDefault: 1500,                                      // 1위 CPC 미입력 시 가정 (자동차 카테고리 경쟁 키워드는 수천~수만원)
  brandSearch: { light: 500000, premium: 1000000 },      // 네이버 브랜드검색 30일 기본 단가: 라이트 50만~, 프리미엄 100만~ (조회수 구간에 따라 상승)
  brandSearchVolumeFactor: [1, 1.5, 2.5, 4],             // 월 조회수 구간(~5만 / ~20만 / ~50만 / 50만+) 배수 가정
  kakao: { cpc: 200, cpm: 3000 },                        // 카카오모먼트 기본 입찰가: CPC 200원, 비즈보드 CPM 3,000원 (최소 CPC 10원·CPM 1,000원)
  kakaoImpressions: { low: 300000, high: 3000000 },      // 카카오 픽셀 검출 시 월 노출 가정 (건)
  gfa: { cpm: 3000 },                                    // 네이버 GFA CPM 가정 (공식 단가표 없음, 입찰형)
  gfaImpressions: { low: 300000, high: 5000000 },
  meta: { cpm: 8000 },                                   // 메타 국내 평균 CPM 가정 (원)
  metaImpressionsPerCreativeDay: { low: 2000, high: 15000 }, // 활성 소재 1개당 일 노출 가정 (건)
  metaDefaultCreatives: { low: 5, high: 20 },            // 소재 수 미관측·픽셀만 있을 때
  google: { cpm: 5000 },                                 // 구글 디스플레이/유튜브 CPM 가정
  googleImpressionsPerCreativeDay: { low: 2000, high: 15000 },
  googleDefaultCreatives: { low: 3, high: 15 },
  days: 30,
};
const RATE_SOURCES = [
  ["네이버 파워링크 최소 입찰가 70원, 브랜드검색 30일 100만원~ (비즈팝콘, 2026 네이버 안내 정리)", "https://bizpopcorn.co.kr/blog/naver-ad-price"],
  ["네이버 브랜드검색 기본 단가 50만원 수준, 유형·조회수·기간에 따라 상승 (애드마켓팁, 2026.7)", "https://blog.admarketip.com/naver-brand-search-cost/"],
  ["카카오모먼트 최소·기본 입찰가 CPC 10/200원, CPM 1,000/3,000원 (AMPM, 2023.7)", "https://inside.ampm.co.kr/insight/2370"],
  ["카카오모먼트 공식 과금 안내", "https://kakaobusiness.gitbook.io/main/ad/moment"],
];
const KRW = (n) => n == null || isNaN(n) ? "—" : n >= 1e8 ? (n / 1e8).toFixed(1) + "억" : n >= 1e4 ? Math.round(n / 1e4).toLocaleString() + "만" : Math.round(n).toLocaleString();
const NUM = (n) => n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString();
let AS = null; // assumptions

function adRows() { return ALL.filter((c) => c.stage === AD_STAGE); }
function assumptions() { const r = adRows().find((c) => c.id === "adspend-assumptions"); return { ...DEFAULT_ASSUMPTIONS, ...(r?.data?.values || {}) }; }
async function saveAssumptions(values) { await api("/api/captures", { method: "POST", body: JSON.stringify({ id: "adspend-assumptions", competitor: "_설정", stage: AD_STAGE, type: "assumptions", values }) }); }

// 경쟁사 목록 = 퍼널 수집 경쟁사 + 관측에 등장한 경쟁사
function adCompetitors() {
  const s = new Set(ALL.filter((c) => c.stage !== AD_STAGE).map((c) => c.competitor));
  adRows().forEach((c) => { if (c.data?.type === "keyword_obs") Object.keys(c.data.ranks || {}).forEach((k) => s.add(k)); if (c.data?.type === "creative_obs" || c.data?.type === "brand_obs") s.add(c.data.competitor_name); });
  s.delete("_설정"); return [...s].sort();
}
function latestTags(comp) {
  const rows = ALL.filter((c) => c.competitor === comp && c.data?.adTech).sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
  return new Set((rows[0]?.data?.adTech?.tags || []).map((t) => t.key));
}
function latestKeywordObs() {
  const m = {};
  adRows().filter((c) => c.data?.type === "keyword_obs").forEach((c) => { const k = c.data.keyword; if (!m[k] || new Date(c.data.date) > new Date(m[k].data.date)) m[k] = c; });
  return Object.values(m);
}
function latestObs(type, comp, extra) {
  return adRows().filter((c) => c.data?.type === type && c.data.competitor_name === comp && (!extra || extra(c.data))).sort((a, b) => new Date(b.data.date) - new Date(a.data.date))[0]?.data || null;
}
const latestCreativeObs = (comp, ch) => latestObs("creative_obs", comp, (d) => d.channel === ch);

// 추정 = 라인아이템(건수 × 단가)의 합. 각 라인은 {ch, label, count, countUnit, unit, unitLabel, low, mid, high, source}
// 채널별 보고서: 각 채널 = { key, label, signal, impressions:{low,mid,high}|null, clicks:{...}|null, unit, unitLabel, amount:{low,mid,high}|null, confidence: "관측"|"신호(가정)"|"없음", basis, items[] }
const CHANNELS = [["naver_search", "네이버 검색광고 (파워링크)"], ["naver_brand", "네이버 브랜드검색"], ["naver_gfa", "네이버 GFA (성과형 DA)"], ["meta", "메타 (페이스북·인스타그램)"], ["google", "구글 (검색·디스플레이·유튜브)"], ["kakao", "카카오모먼트"], ["app", "앱 설치 광고 (어트리뷰션)"]];
const gmean = (a, b) => Math.sqrt(Math.max(a, 1) * Math.max(b, 1));
function estimate(comp, A) {
  const tags = latestTags(comp);
  const ch = Object.fromEntries(CHANNELS.map(([k, label]) => [k, { key: k, label, signal: null, impressions: null, clicks: null, unit: null, unitLabel: "", amount: null, confidence: "없음", basis: "", items: [] }]));
  // 네이버 검색광고: 키워드별 노출(검색량×노출점유율) → 클릭(×CTR) → CPC
  const kws = latestKeywordObs().filter((c) => c.data.ranks?.[comp] >= 1);
  if (kws.length) {
    let imp = 0, clk = 0, cost = 0;
    kws.forEach((c) => { const d = c.data, r = Math.min(5, Math.max(1, +d.ranks[comp])); const vol = +d.volume || 0, cpc1 = +d.cpc || A.cpcDefault; const i = vol * (A.impressionShareByRank[r - 1] || 0.7); const k = i * (A.ctrByRank[r - 1] || 0.02); const cpc = Math.max(A.naverPowerlinkMinCpc, cpc1 * (A.cpcRankFactor[r - 1] || 0.45)); imp += i; clk += k; cost += k * cpc; ch.naver_search.items.push({ label: `"${d.keyword}" ${r}위`, impressions: i, clicks: k, unit: cpc, amount: k * cpc, source: `검색량 ${NUM(vol)} × 노출점유 ${Math.round((A.impressionShareByRank[r - 1] || 0.7) * 100)}% × CTR ${((A.ctrByRank[r - 1] || 0.02) * 100).toFixed(1)}% × CPC ${NUM(cpc)}${d.cpc ? "" : "(가정)"} · ${d.date}` }); });
    Object.assign(ch.naver_search, { signal: `키워드 ${kws.length}개 노출 확인`, impressions: { low: imp * 0.8, mid: imp, high: imp * 1.2 }, clicks: { low: clk * 0.6, mid: clk, high: clk * 1.5 }, unit: cost / (clk || 1), unitLabel: "평균 CPC", amount: { low: cost * 0.6, mid: cost, high: cost * 1.5 }, confidence: "관측", basis: `키워드 ${kws.length}개 순위 관측` });
  } else if (tags.has("naver_ads")) Object.assign(ch.naver_search, { signal: "네이버 광고 전환태그(wcs) 검출", confidence: "신호(가정)", basis: "키워드 순위 관측이 없어 노출·금액 산출 불가 → 키워드 관측 입력 필요" });
  // 브랜드검색
  const bo = latestObs("brand_obs", comp);
  if (bo) {
    if (bo.running) { const base = bo.kind === "premium" ? A.brandSearch.premium : A.brandSearch.light; const f = A.brandSearchVolumeFactor[Math.min(3, Math.max(0, +bo.tier || 0))] || 1; Object.assign(ch.naver_brand, { signal: `${bo.kind === "premium" ? "프리미엄" : "라이트"}형 운영 확인 (${bo.date})`, impressions: null, clicks: null, unit: base * f, unitLabel: "30일 계약 단가", amount: { low: base * f, mid: base * f * 1.3, high: base * f * 2 }, confidence: "관측", basis: `기본 ${KRW(base)}원 × 조회수 구간 배수 ${f} (기간 계약형, 노출은 브랜드 검색량과 동일)` }); }
    else Object.assign(ch.naver_brand, { signal: `미운영 확인 (${bo.date})`, confidence: "관측", amount: { low: 0, mid: 0, high: 0 } });
  }
  // GFA
  if (tags.has("naver_gfa")) { const L = A.gfaImpressions.low, H = A.gfaImpressions.high, M = gmean(L, H); Object.assign(ch.naver_gfa, { signal: "GFA 픽셀 검출", impressions: { low: L, mid: M, high: H }, unit: A.gfa.cpm, unitLabel: "CPM(가정)", amount: { low: L / 1000 * A.gfa.cpm, mid: M / 1000 * A.gfa.cpm, high: H / 1000 * A.gfa.cpm }, confidence: "신호(가정)", basis: "노출 수는 가정 범위 (공개 데이터 없음)" }); }
  // 메타
  const mo = latestCreativeObs(comp, "meta");
  if (mo || tags.has("meta_pixel")) {
    const nL = mo ? +mo.creatives : A.metaDefaultCreatives.low, nH = mo ? +mo.creatives : A.metaDefaultCreatives.high;
    const L = nL * A.metaImpressionsPerCreativeDay.low * A.days, H = nH * A.metaImpressionsPerCreativeDay.high * A.days, M = gmean(L, H);
    Object.assign(ch.meta, { signal: mo ? `활성 소재 ${mo.creatives}개 (${mo.date})` : "메타 픽셀 검출", impressions: { low: L, mid: M, high: H }, unit: A.meta.cpm, unitLabel: "CPM(가정)", amount: { low: L / 1000 * A.meta.cpm, mid: M / 1000 * A.meta.cpm, high: H / 1000 * A.meta.cpm }, confidence: mo ? "관측" : "신호(가정)", basis: `${mo ? "소재 " + mo.creatives + "개" : "소재 " + nL + "~" + nH + "개 가정"} × 소재당 일 노출 ${NUM(A.metaImpressionsPerCreativeDay.low)}~${NUM(A.metaImpressionsPerCreativeDay.high)} × ${A.days}일` });
  }
  // 구글
  const go = latestCreativeObs(comp, "google");
  if (go || tags.has("google_ads")) {
    const nL = go ? +go.creatives : A.googleDefaultCreatives.low, nH = go ? +go.creatives : A.googleDefaultCreatives.high;
    const L = nL * A.googleImpressionsPerCreativeDay.low * A.days, H = nH * A.googleImpressionsPerCreativeDay.high * A.days, M = gmean(L, H);
    Object.assign(ch.google, { signal: go ? `소재 ${go.creatives}개 (${go.date})` : "Google 광고 전환태그 검출", impressions: { low: L, mid: M, high: H }, unit: A.google.cpm, unitLabel: "CPM(가정)", amount: { low: L / 1000 * A.google.cpm, mid: M / 1000 * A.google.cpm, high: H / 1000 * A.google.cpm }, confidence: go ? "관측" : "신호(가정)", basis: `${go ? "소재 " + go.creatives + "개" : "소재 " + nL + "~" + nH + "개 가정"} × 소재당 일 노출 ${NUM(A.googleImpressionsPerCreativeDay.low)}~${NUM(A.googleImpressionsPerCreativeDay.high)} × ${A.days}일 (검색광고는 키워드 관측에 구글 열을 추가하면 분리 산출)` });
  }
  // 카카오
  if (tags.has("kakao_pixel")) { const L = A.kakaoImpressions.low, H = A.kakaoImpressions.high, M = gmean(L, H); Object.assign(ch.kakao, { signal: "카카오 픽셀 검출", impressions: { low: L, mid: M, high: H }, unit: A.kakao.cpm, unitLabel: "CPM(기본 입찰가)", amount: { low: L / 1000 * A.kakao.cpm, mid: M / 1000 * A.kakao.cpm, high: H / 1000 * A.kakao.cpm }, confidence: "신호(가정)", basis: "노출 수는 가정 범위 (공개 데이터 없음)" }); }
  // 앱 설치
  const appTags = ["appsflyer", "airbridge", "adjust", "branch"].filter((k) => tags.has(k));
  if (appTags.length) Object.assign(ch.app, { signal: `앱 어트리뷰션 SDK 검출 (${appTags.join(", ")})`, confidence: "신호(가정)", basis: "앱 설치 캠페인 운영 신호. 금액은 메타·구글 채널에 포함" });

  const list = Object.values(ch);
  const sum = (k) => list.reduce((a, c) => a + (c.amount ? c.amount[k] : 0), 0);
  const impSum = (k) => list.reduce((a, c) => a + (c.impressions ? c.impressions[k] : 0), 0);
  const clkSum = (k) => list.reduce((a, c) => a + (c.clicks ? c.clicks[k] : 0), 0);
  const observed = list.filter((c) => c.confidence === "관측").length, signal = list.filter((c) => c.confidence === "신호(가정)").length;
  return { channels: list, total: { low: sum("low"), mid: sum("mid"), high: sum("high") }, impressions: { low: impSum("low"), mid: impSum("mid"), high: impSum("high") }, clicks: { low: clkSum("low"), mid: clkSum("mid"), high: clkSum("high") }, observed, signal, basis: list.filter((c) => c.signal).map((c) => c.signal) };
}
// 시계열: 관측일별로 그 시점까지의 최신 관측으로 추정 (월 추정액 중간값)
function spendSeries(comp, A) {
  const dates = [...new Set(adRows().filter((c) => c.data?.type !== "assumptions").map((c) => c.data.date).filter(Boolean))].sort();
  const snapshot = ALL;
  return dates.map((dt) => {
    const sub = adRows().filter((c) => c.data?.type === "assumptions" || (c.data.date && c.data.date <= dt));
    const saved = ALL; ALL = ALL.filter((c) => c.stage !== AD_STAGE).concat(sub);
    const e = estimate(comp, A); ALL = saved;
    return { date: dt, mid: e.total.mid, low: e.total.low, high: e.total.high };
  });
}
function seriesSvg(seriesByComp) {
  const all = Object.values(seriesByComp).flat(); if (!all.length) return "";
  const dates = [...new Set(all.map((p) => p.date))].sort();
  const max = Math.max(...all.map((p) => p.high), 1);
  const W = 720, H = 200, L = 60, R = 10, T = 12, B = 28;
  const x = (d) => L + (dates.length === 1 ? (W - L - R) / 2 : (dates.indexOf(d) / (dates.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - v / max) * (H - T - B);
  const colors = ["#2563eb", "#dc2626", "#059669", "#d97706", "#7c3aed", "#0891b2"];
  const lines = Object.entries(seriesByComp).map(([comp, pts], i) => {
    const c = colors[i % colors.length];
    const band = pts.map((p) => `${x(p.date)},${y(p.high)}`).concat(pts.slice().reverse().map((p) => `${x(p.date)},${y(p.low)}`)).join(" ");
    return `<polygon points="${band}" fill="${c}" opacity=".08"/><polyline points="${pts.map((p) => `${x(p.date)},${y(p.mid)}`).join(" ")}" fill="none" stroke="${c}" stroke-width="2"/>${pts.map((p) => `<circle cx="${x(p.date)}" cy="${y(p.mid)}" r="3" fill="${c}"><title>${esc(comp)} ${p.date}: ${KRW(p.mid)}원 (${KRW(p.low)}~${KRW(p.high)})</title></circle>`).join("")}<text x="${x(pts[pts.length - 1].date) + 6}" y="${y(pts[pts.length - 1].mid) + 4}" font-size="11" fill="${c}">${esc(comp)}</text>`;
  }).join("");
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(max * f) + 4}" font-size="10" text-anchor="end" fill="var(--muted)">${KRW(max * f)}</text>`).join("");
  const xl = dates.map((d) => `<text x="${x(d)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="var(--muted)">${d.slice(5)}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;max-width:${W}px;display:block">${grid}${xl}${lines}</svg>`;
}

function renderAdspend() {
  const el = $("#tab-adspend"); if (!el) return;
  const A = assumptions(); AS = A;
  const comps = adCompetitors();
  const kw = latestKeywordObs();
  const est = Object.fromEntries(comps.map((c) => [c, estimate(c, A)]));
  const series = Object.fromEntries(comps.map((c) => [c, spendSeries(c, A)]).filter(([, s]) => s.length));
  const conf = (c) => c === "관측" ? `<span class="chip paid">관측</span>` : c === "신호(가정)" ? `<span class="chip" style="color:#b45309;border-color:#fcd34d;background:#fffbeb">신호·가정치</span>` : `<span class="chip">없음</span>`;
  const rng = (o, f = NUM, unit = "") => o ? `<b>${f(o.mid)}</b>${unit}<br><span style="font-size:11px;color:var(--muted)">${f(o.low)}~${f(o.high)}${unit}</span>` : `<span class="none">—</span>`;
  const report = (comp, e) => `<div class="box" style="margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:8px"><h3 style="margin:0;font-size:15px">${esc(comp)}</h3><span style="font-size:12px;color:var(--muted)">관측 채널 ${e.observed} · 신호만 ${e.signal} · 월 노출 합계 <b>${NUM(e.impressions.mid)}</b>건 · 클릭 <b>${NUM(e.clicks.mid)}</b>건</span></div>
    <div class="tablewrap" style="margin-top:8px"><table class="ads-table ch-table"><thead><tr><th style="min-width:160px">채널</th><th>운영 신호</th><th>월 노출 (건)</th><th>월 클릭 (건)</th><th>적용 단가</th><th>월 집행액 추정</th><th>신뢰도</th><th>근거</th></tr></thead><tbody>
      ${e.channels.map((c) => `<tr class="${c.confidence === "없음" ? "dim" : ""}"><td class="stage">${esc(c.label)}</td><td>${c.signal ? esc(c.signal) : '<span class="none">검출 안 됨</span>'}</td><td>${rng(c.impressions)}</td><td>${c.clicks ? rng(c.clicks) : c.impressions ? '<span class="none">CPM 과금</span>' : '<span class="none">—</span>'}</td><td>${c.unit ? `${NUM(c.unit)}원 <span style="font-size:11px;color:var(--muted)">${esc(c.unitLabel)}</span>` : '<span class="none">—</span>'}</td><td>${c.amount ? rng(c.amount, KRW, "원") : c.signal ? '<span style="color:#b45309;font-size:12px">관측 필요</span>' : '<span class="none">—</span>'}</td><td>${conf(c.confidence)}</td><td style="font-size:11px;color:var(--muted)">${esc(c.basis || "")}${c.items.length ? `<details><summary style="cursor:pointer">키워드 ${c.items.length}개</summary>${c.items.map((i) => `<div>${esc(i.label)} · 노출 ${NUM(i.impressions)} · 클릭 ${NUM(i.clicks)} · CPC ${NUM(i.unit)} · ${KRW(i.amount)}원 <span title="${esc(i.source)}">ⓘ</span></div>`).join("")}</details>` : ""}</td></tr>`).join("")}
      <tr><td class="stage">합계</td><td></td><td>${rng(e.impressions)}</td><td>${rng(e.clicks)}</td><td></td><td>${rng(e.total, KRW, "원")}</td><td></td><td style="font-size:11px;color:var(--muted)">${e.observed ? "" : "관측값이 없어 합계는 가정치입니다. "}카카오·GFA·메타·구글은 노출 수를 공개하지 않으므로 가정 범위이며, 소재 수 관측을 넣으면 범위가 좁아집니다.</td></tr>
    </tbody></table></div></div>`;
  el.innerHTML = `
    <div class="cmp-note" style="margin:0 0 10px"><b>채널별 보고서.</b> 각 채널을 운영 신호 → 월 노출 건수 → 클릭 건수 → 단가 → 집행액 순으로 보입니다. "관측"은 직접 입력한 키워드 순위·소재 수·브랜드검색에서 산출한 값, "신호·가정치"는 사이트의 광고 태그만 검출된 상태에서 가정 범위로 채운 값입니다. 노출 수가 공개되지 않는 채널(메타·구글·카카오·GFA)은 소재 수 관측을 넣어야 범위가 의미를 갖습니다.</div>
    ${comps.map((c) => report(c, est[c])).join("") || `<div class="empty">경쟁사가 없습니다.</div>`}
    ${Object.keys(series).length ? `<h3 style="font-size:14px;margin:16px 0 6px">월 추정 집행액 추이 (관측일 기준, 띠 = 하한~상한)</h3><div class="box">${seriesSvg(series)}</div>` : ""}

    <h3 style="font-size:14px;margin:18px 0 6px">검색광고 키워드 관측 <span style="font-weight:400;color:var(--muted);font-size:12px">주 1~2회, 핵심 키워드를 네이버에서 검색해 파워링크 순위를 기록</span></h3>
    <div class="box">
      <div class="flow-kv" style="margin-bottom:8px">엑셀에서 붙여넣기: 첫 줄 헤더 <code>키워드	월검색량	1위CPC	${comps.slice(0, 3).join("	") || "경쟁사A	경쟁사B"}</code> (탭 구분, 순위는 1~5, 미노출은 비움). 월검색량·CPC는 네이버 검색광고 키워드 도구 값을 쓰면 됩니다. 비우면 CPC 기본값 ${A.cpcDefault.toLocaleString()}원 적용.</div>
      <textarea id="kw-paste" rows="4" placeholder="키워드	월검색량	1위CPC	엔카	케이카&#10;중고차	450000	1800	1	2&#10;장기렌트	120000	3200		1" style="width:100%;height:110px;min-height:0;font-family:ui-monospace,monospace;font-size:12px"></textarea>
      <div style="display:flex;gap:8px;align-items:center;margin-top:6px;flex-wrap:wrap"><label style="font-size:12px">관측일 <input type="date" id="kw-date" value="${new Date().toISOString().slice(0, 10)}"></label><button class="primary" id="kw-save">관측 저장</button><span id="kw-msg" style="font-size:12px;color:var(--muted)"></span></div>
      ${kw.length ? `<div class="tablewrap" style="margin-top:10px"><table class="ads-table"><thead><tr><th>키워드</th><th>월검색량</th><th>1위 CPC</th>${comps.map((c) => `<th>${esc(c)} 순위</th>`).join("")}<th>관측일</th><th></th></tr></thead><tbody>${kw.sort((a, b) => (+b.data.volume || 0) - (+a.data.volume || 0)).map((c) => `<tr><td>${esc(c.data.keyword)}</td><td>${(+c.data.volume || 0).toLocaleString()}</td><td>${c.data.cpc ? (+c.data.cpc).toLocaleString() : "<span style='color:var(--muted)'>기본</span>"}</td>${comps.map((x) => `<td>${c.data.ranks?.[x] ? c.data.ranks[x] + "위" : "—"}</td>`).join("")}<td style="color:var(--muted);font-size:12px">${esc(c.data.date)}</td><td><button class="sm danger" data-del="${c.id}">삭제</button></td></tr>`).join("")}</tbody></table></div>` : ""}
    </div>

    <h3 style="font-size:14px;margin:18px 0 6px">소재 수 관측 <span style="font-weight:400;color:var(--muted);font-size:12px">Meta 광고 라이브러리 / Google 광고 투명성 센터에서 활성 소재 수를 세어 기록 (API 연동 전까지 수동)</span></h3>
    <div class="box" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select id="cr-comp">${comps.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
      <select id="cr-ch"><option value="meta">메타(FB/IG)</option><option value="google">구글</option></select>
      <input type="number" id="cr-n" placeholder="활성 소재 수" min="0" style="width:120px">
      <input type="number" id="cr-days" placeholder="평균 운영일(선택)" min="0" style="width:140px">
      <input type="date" id="cr-date" value="${new Date().toISOString().slice(0, 10)}">
      <button class="primary" id="cr-save">저장</button>
      <div style="flex-basis:100%"></div>
      ${comps.map((c) => ["meta", "google"].map((ch) => { const o = latestCreativeObs(c, ch); return o ? `<span class="chip">${esc(c)} · ${ch === "meta" ? "메타" : "구글"} ${o.creatives}개 (${esc(o.date)})</span>` : ""; }).join("")).join("")}
      <div style="flex-basis:100%;font-size:12px;color:var(--muted)">바로가기: ${comps.map((c) => `${esc(c)} <a href="https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&q=${encodeURIComponent(c)}&search_type=keyword_unordered" target="_blank" rel="noopener">Meta</a>/<a href="https://adstransparency.google.com/?region=KR&query=${encodeURIComponent(c)}" target="_blank" rel="noopener">Google</a>`).join(" · ")}</div>
    </div>

    <h3 style="font-size:14px;margin:18px 0 6px">브랜드검색 관측 <span style="font-weight:400;color:var(--muted);font-size:12px">네이버에서 경쟁사 브랜드명을 검색해 최상단 브랜드검색 광고가 있는지 기록</span></h3>
    <div class="box" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select id="br-comp">${comps.map((c) => `<option>${esc(c)}</option>`).join("")}</select>
      <select id="br-run"><option value="1">운영 중</option><option value="0">미운영</option></select>
      <select id="br-kind"><option value="light">라이트형</option><option value="premium">프리미엄형(이미지·동영상)</option></select>
      <select id="br-tier"><option value="0">월 조회수 ~5만</option><option value="1">~20만</option><option value="2">~50만</option><option value="3">50만+</option></select>
      <input type="date" id="br-date" value="${new Date().toISOString().slice(0, 10)}">
      <button class="primary" id="br-save">저장</button>
      <div style="flex-basis:100%"></div>
      ${comps.map((c) => { const o = latestObs("brand_obs", c); return o ? `<span class="chip">${esc(c)} · ${o.running ? (o.kind === "premium" ? "프리미엄" : "라이트") + " 운영" : "미운영"} (${esc(o.date)})</span>` : ""; }).join("")}
    </div>

    <h3 style="font-size:14px;margin:18px 0 6px">플랫폼 단가 가이드 (추정에 쓰는 기준값)</h3>
    <div class="box" style="font-size:12px">
      <div class="tablewrap"><table class="ads-table"><thead><tr><th>플랫폼·상품</th><th>공식 최소/기본 단가</th><th>이 모델의 적용값</th></tr></thead><tbody>
        <tr><td>네이버 파워링크</td><td>최소 입찰가 70원/클릭 (실제는 키워드 경쟁에 따라 수천~수만원)</td><td>키워드별 1위 CPC 입력값 × 순위 계수, 하한 ${A.naverPowerlinkMinCpc}원</td></tr>
        <tr><td>네이버 브랜드검색</td><td>30일 기본 라이트 50만원~, 프리미엄 100만원~ (조회수 구간·기간에 따라 상승)</td><td>${KRW(A.brandSearch.light)} / ${KRW(A.brandSearch.premium)} × 구간 배수 ${A.brandSearchVolumeFactor.join("/")}</td></tr>
        <tr><td>카카오모먼트</td><td>CPC 최소 10원·기본 200원, 비즈보드 CPM 최소 1,000원·기본 3,000원</td><td>CPM ${NUM(A.kakao.cpm)}원 × 월 노출 ${NUM(A.kakaoImpressions.low)}~${NUM(A.kakaoImpressions.high)}</td></tr>
        <tr><td>네이버 GFA</td><td>입찰형, 공식 단가표 없음</td><td>CPM ${NUM(A.gfa.cpm)}원 × 월 노출 ${NUM(A.gfaImpressions.low)}~${NUM(A.gfaImpressions.high)}</td></tr>
        <tr><td>메타 (FB/IG)</td><td>경매형, 공식 단가 없음 (국내 CPM 통상 수천~1만원대)</td><td>CPM ${NUM(A.meta.cpm)}원 × 소재당 일 노출 ${NUM(A.metaImpressionsPerCreativeDay.low)}~${NUM(A.metaImpressionsPerCreativeDay.high)}</td></tr>
        <tr><td>구글 디스플레이/유튜브</td><td>경매형</td><td>CPM ${NUM(A.google.cpm)}원 × 소재당 일 노출 ${NUM(A.googleImpressionsPerCreativeDay.low)}~${NUM(A.googleImpressionsPerCreativeDay.high)}</td></tr>
      </tbody></table></div>
      <div style="margin-top:6px;color:var(--muted)">출처: ${RATE_SOURCES.map(([t, u]) => `<a href="${u}" target="_blank" rel="noopener">${esc(t)}</a>`).join(" · ")}. VAT 별도. 경매형 채널은 공식 단가가 없어 CPM을 가정하며, 우리 계정의 실제 CPM·CPC로 바꿔 넣는 것이 가장 정확합니다.</div>
    </div>

    <details style="margin-top:16px"><summary style="cursor:pointer;font-size:14px;font-weight:600">가정값 (건수·단가) 수정</summary>
      <div class="box" style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;font-size:12px">
        <label>파워링크 1~5위 클릭률 (쉼표) <input id="as-ctr" value="${A.ctrByRank.join(",")}"></label>
        <label>순위별 CPC 계수 (1위 대비) <input id="as-cpcf" value="${A.cpcRankFactor.join(",")}"></label>
        <label>1위 CPC 미입력 시 가정(원) <input id="as-cpc" type="number" value="${A.cpcDefault}"></label>
        <label>브랜드검색 30일 기본 단가 라이트,프리미엄(원) <input id="as-brand" value="${A.brandSearch.light},${A.brandSearch.premium}"></label>
        <label>메타 CPM(원) <input id="as-metacpm" type="number" value="${A.meta.cpm}"></label>
        <label>메타 소재당 일 노출 하,상(건) <input id="as-metaimp" value="${A.metaImpressionsPerCreativeDay.low},${A.metaImpressionsPerCreativeDay.high}"></label>
        <label>메타 소재 수 미관측 시 하,상(개) <input id="as-metan" value="${A.metaDefaultCreatives.low},${A.metaDefaultCreatives.high}"></label>
        <label>구글 CPM(원) <input id="as-gcpm" type="number" value="${A.google.cpm}"></label>
        <label>구글 소재당 일 노출 하,상(건) <input id="as-gimp" value="${A.googleImpressionsPerCreativeDay.low},${A.googleImpressionsPerCreativeDay.high}"></label>
        <label>구글 소재 수 미관측 시 하,상(개) <input id="as-gn" value="${A.googleDefaultCreatives.low},${A.googleDefaultCreatives.high}"></label>
        <label>카카오 CPM(원) <input id="as-kcpm" type="number" value="${A.kakao.cpm}"></label>
        <label>카카오 월 노출 하,상(건) <input id="as-kimp" value="${A.kakaoImpressions.low},${A.kakaoImpressions.high}"></label>
        <label>GFA CPM(원) <input id="as-gfacpm" type="number" value="${A.gfa.cpm}"></label>
        <label>GFA 월 노출 하,상(건) <input id="as-gfaimp" value="${A.gfaImpressions.low},${A.gfaImpressions.high}"></label>
        <div style="grid-column:1/-1;display:flex;gap:8px;align-items:center"><button class="primary" id="as-save">가정값 저장</button><button class="sm" id="as-reset">기본값으로</button><span style="color:var(--muted)">우리 회사 실제 집행 데이터(소재당 일 집행액, 키워드별 CPC)로 보정하면 오차가 줄어듭니다.</span></div>
      </div>
    </details>`;

  $("#kw-save").onclick = async () => {
    const lines = $("#kw-paste").value.split(/\r?\n/).map((l) => l.split("\t").map((x) => x.trim())).filter((l) => l.length >= 2 && l[0]);
    if (lines.length < 2) { toast("헤더 줄과 데이터 줄을 붙여넣어 주세요"); return; }
    const head = lines[0]; const compCols = head.slice(3);
    const date = $("#kw-date").value || new Date().toISOString().slice(0, 10);
    let n = 0;
    for (const l of lines.slice(1)) {
      const ranks = {}; compCols.forEach((c, i) => { const v = parseInt(l[3 + i]); if (v >= 1) ranks[c] = v; });
      const id = "kw-" + date + "-" + btoa(unescape(encodeURIComponent(l[0]))).replace(/[^a-z0-9]/gi, "").slice(0, 24);
      await api("/api/captures", { method: "POST", body: JSON.stringify({ id, competitor: "_설정", stage: AD_STAGE, capturedAt: date + "T00:00:00+09:00", type: "keyword_obs", keyword: l[0], volume: parseInt((l[1] || "").replace(/[^\d]/g, "")) || 0, cpc: parseInt((l[2] || "").replace(/[^\d]/g, "")) || null, ranks, date }) });
      n++;
    }
    toast(`키워드 ${n}개 저장`); load();
  };
  $("#cr-save").onclick = async () => {
    const comp = $("#cr-comp").value, ch = $("#cr-ch").value, n = parseInt($("#cr-n").value), date = $("#cr-date").value;
    if (!comp || isNaN(n)) { toast("경쟁사와 소재 수를 입력하세요"); return; }
    await api("/api/captures", { method: "POST", body: JSON.stringify({ id: `cr-${date}-${ch}-${btoa(unescape(encodeURIComponent(comp))).replace(/[^a-z0-9]/gi, "").slice(0, 16)}`, competitor: "_설정", stage: AD_STAGE, capturedAt: date + "T00:00:00+09:00", type: "creative_obs", competitor_name: comp, channel: ch, creatives: n, avgDays: parseInt($("#cr-days").value) || null, date }) });
    toast("저장됨"); load();
  };
  const nums = (s) => s.split(",").map((x) => +x.trim()).filter((x) => !isNaN(x));
  $("#as-save").onclick = async () => {
    const pair = (id, k1, k2) => { const v = nums($("#" + id).value); return { [k1]: v[0], [k2]: v[1] }; };
    const values = { ctrByRank: nums($("#as-ctr").value), cpcRankFactor: nums($("#as-cpcf").value), cpcDefault: +$("#as-cpc").value || A.cpcDefault,
      brandSearch: pair("as-brand", "light", "premium"), meta: { cpm: +$("#as-metacpm").value || A.meta.cpm }, metaImpressionsPerCreativeDay: pair("as-metaimp", "low", "high"), metaDefaultCreatives: pair("as-metan", "low", "high"),
      google: { cpm: +$("#as-gcpm").value || A.google.cpm }, googleImpressionsPerCreativeDay: pair("as-gimp", "low", "high"), googleDefaultCreatives: pair("as-gn", "low", "high"),
      kakao: { ...A.kakao, cpm: +$("#as-kcpm").value || A.kakao.cpm }, kakaoImpressions: pair("as-kimp", "low", "high"), gfa: { cpm: +$("#as-gfacpm").value || A.gfa.cpm }, gfaImpressions: pair("as-gfaimp", "low", "high"), days: 30 };
    await saveAssumptions(values); toast("가정값 저장"); load();
  };
  $("#br-save").onclick = async () => {
    const comp = $("#br-comp").value, date = $("#br-date").value; if (!comp) return;
    await api("/api/captures", { method: "POST", body: JSON.stringify({ id: `br-${date}-${btoa(unescape(encodeURIComponent(comp))).replace(/[^a-z0-9]/gi, "").slice(0, 16)}`, competitor: "_설정", stage: AD_STAGE, capturedAt: date + "T00:00:00+09:00", type: "brand_obs", competitor_name: comp, running: $("#br-run").value === "1", kind: $("#br-kind").value, tier: +$("#br-tier").value, date }) });
    toast("저장됨"); load();
  };
  $("#as-reset").onclick = async () => { await saveAssumptions({}); toast("기본값으로 되돌림"); load(); };
}
