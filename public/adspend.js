// ---------- 광고비 추정 (역산 모델) ----------
// 데이터는 captures 테이블에 stage="광고데이터" 행으로 저장합니다 (스키마 변경 없음).
//   data.type = "assumptions" (id: adspend-assumptions, 1개)
//   data.type = "keyword_obs" : 검색광고 관측 1건 = {keyword, volume, cpc, ranks:{경쟁사: 순위}, date}
//   data.type = "creative_obs": 소재 수 관측 1건 = {competitor_name, channel: "meta"|"google", creatives, avgDays, date}
const AD_STAGE = "광고데이터";
const DEFAULT_ASSUMPTIONS = {
  ctrByRank: [0.12, 0.07, 0.045, 0.03, 0.02],          // 파워링크 모바일 1~5위 클릭률 가정
  cpcDefault: 1500,                                      // CPC 미입력 시 (원)
  cpcRankFactor: [1, 0.8, 0.65, 0.55, 0.45],             // 순위별 CPC = 1위 CPC × 계수
  metaPerCreativeDay: { low: 15000, mid: 40000, high: 100000 },   // 메타 활성 소재 1개당 일 집행액 (원)
  googlePerCreativeDay: { low: 10000, mid: 30000, high: 80000 },
  kakaoWhenTag: { low: 300000, high: 3000000 },          // 카카오 픽셀 존재 시 월 집행 범위 (원)
  gfaWhenTag: { low: 500000, high: 5000000 },            // 네이버 GFA 픽셀 존재 시
  googleDisplayWhenTag: { low: 300000, high: 3000000 },  // 구글 전환태그만 있고 소재 관측 없을 때
  days: 30,
};
const KRW = (n) => n == null || isNaN(n) ? "—" : n >= 1e8 ? (n / 1e8).toFixed(1) + "억" : n >= 1e4 ? Math.round(n / 1e4).toLocaleString() + "만" : Math.round(n).toLocaleString();
let AS = null; // assumptions

function adRows() { return ALL.filter((c) => c.stage === AD_STAGE); }
function assumptions() { const r = adRows().find((c) => c.id === "adspend-assumptions"); return { ...DEFAULT_ASSUMPTIONS, ...(r?.data?.values || {}) }; }
async function saveAssumptions(values) { await api("/api/captures", { method: "POST", body: JSON.stringify({ id: "adspend-assumptions", competitor: "_설정", stage: AD_STAGE, type: "assumptions", values }) }); }

// 경쟁사 목록 = 퍼널 수집 경쟁사 + 관측에 등장한 경쟁사
function adCompetitors() {
  const s = new Set(ALL.filter((c) => c.stage !== AD_STAGE).map((c) => c.competitor));
  adRows().forEach((c) => { if (c.data?.type === "keyword_obs") Object.keys(c.data.ranks || {}).forEach((k) => s.add(k)); if (c.data?.type === "creative_obs") s.add(c.data.competitor_name); });
  s.delete("_설정"); return [...s].sort();
}
// 경쟁사별 최신 광고 태그 (자동 수집 adTech)
function latestTags(comp) {
  const rows = ALL.filter((c) => c.competitor === comp && c.data?.adTech).sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
  return new Set((rows[0]?.data?.adTech?.tags || []).map((t) => t.key));
}
// 키워드 관측: 키워드별 최신 관측 1건만 사용 (관측일 기준)
function latestKeywordObs() {
  const m = {};
  adRows().filter((c) => c.data?.type === "keyword_obs").forEach((c) => { const k = c.data.keyword; if (!m[k] || new Date(c.data.date) > new Date(m[k].data.date)) m[k] = c; });
  return Object.values(m);
}
function latestCreativeObs(comp, channel) {
  return adRows().filter((c) => c.data?.type === "creative_obs" && c.data.competitor_name === comp && c.data.channel === channel).sort((a, b) => new Date(b.data.date) - new Date(a.data.date))[0]?.data || null;
}
function estimate(comp, A) {
  const out = { search: { low: 0, mid: 0, high: 0, n: 0 }, meta: { low: 0, mid: 0, high: 0, n: 0 }, google: { low: 0, mid: 0, high: 0, n: 0 }, kakao: { low: 0, mid: 0, high: 0 }, gfa: { low: 0, mid: 0, high: 0 }, basis: [] };
  // 1) 검색광고
  latestKeywordObs().forEach((c) => {
    const d = c.data; const rank = d.ranks?.[comp]; if (!rank || rank < 1) return;
    const r = Math.min(5, Math.max(1, +rank));
    const vol = +d.volume || 0, cpc1 = +d.cpc || A.cpcDefault;
    const clicks = vol * (A.ctrByRank[r - 1] || 0.02);
    const cpc = cpc1 * (A.cpcRankFactor[r - 1] || 0.45);
    const mid = clicks * cpc;
    out.search.mid += mid; out.search.low += mid * 0.6; out.search.high += mid * 1.5; out.search.n++;
  });
  if (out.search.n) out.basis.push(`검색광고 키워드 ${out.search.n}개 관측`);
  const tags = latestTags(comp);
  // 2) 메타
  const mo = latestCreativeObs(comp, "meta");
  if (mo) { const n = +mo.creatives || 0; out.meta = { low: n * A.metaPerCreativeDay.low * A.days, mid: n * A.metaPerCreativeDay.mid * A.days, high: n * A.metaPerCreativeDay.high * A.days, n }; out.basis.push(`메타 활성 소재 ${n}개 (${mo.date})`); }
  else if (tags.has("meta_pixel")) { out.meta = { low: 3 * A.metaPerCreativeDay.low * A.days, mid: 6 * A.metaPerCreativeDay.mid * A.days, high: 10 * A.metaPerCreativeDay.high * A.days, n: 0 }; out.basis.push("메타 픽셀 검출 (소재 수 미관측 → 3~10개 가정)"); }
  // 3) 구글
  const go = latestCreativeObs(comp, "google");
  if (go) { const n = +go.creatives || 0; out.google = { low: n * A.googlePerCreativeDay.low * A.days, mid: n * A.googlePerCreativeDay.mid * A.days, high: n * A.googlePerCreativeDay.high * A.days, n }; out.basis.push(`구글 소재 ${n}개 (${go.date})`); }
  else if (tags.has("google_ads")) { out.google = { low: A.googleDisplayWhenTag.low, mid: (A.googleDisplayWhenTag.low + A.googleDisplayWhenTag.high) / 2, high: A.googleDisplayWhenTag.high, n: 0 }; out.basis.push("구글 전환태그 검출 (소재 미관측 → 범위 가정)"); }
  // 4) 카카오 / GFA: 태그 존재 시 범위
  if (tags.has("kakao_pixel")) { out.kakao = { low: A.kakaoWhenTag.low, mid: (A.kakaoWhenTag.low + A.kakaoWhenTag.high) / 2, high: A.kakaoWhenTag.high }; out.basis.push("카카오 픽셀 검출 (범위 가정)"); }
  if (tags.has("naver_gfa")) { out.gfa = { low: A.gfaWhenTag.low, mid: (A.gfaWhenTag.low + A.gfaWhenTag.high) / 2, high: A.gfaWhenTag.high }; out.basis.push("네이버 GFA 픽셀 검출 (범위 가정)"); }
  const sum = (k) => ["search", "meta", "google", "kakao", "gfa"].reduce((a, ch) => a + (out[ch][k] || 0), 0);
  out.total = { low: sum("low"), mid: sum("mid"), high: sum("high") };
  return out;
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
  const chBar = (e) => { const tot = e.total.mid || 1; const parts = [["search", "검색", "#2563eb"], ["meta", "메타", "#4f46e5"], ["google", "구글", "#059669"], ["kakao", "카카오", "#d97706"], ["gfa", "GFA", "#0891b2"]]; return `<div class="stack">${parts.map(([k, l, c]) => e[k].mid ? `<span style="width:${(e[k].mid / tot * 100).toFixed(1)}%;background:${c}" title="${l} ${KRW(e[k].mid)}원"></span>` : "").join("")}</div><div class="flow-kv">${parts.map(([k, l]) => e[k].mid ? `${l} ${KRW(e[k].low)}~${KRW(e[k].high)}` : "").filter(Boolean).join(" · ") || "근거 없음"}</div>`; };
  el.innerHTML = `
    <div class="cmp-note" style="margin:0 0 10px"><b>추정치입니다.</b> 검색광고는 "키워드 월 검색량 × 순위별 클릭률 × 순위별 CPC", 메타·구글은 "활성 소재 수 × 소재당 일 집행액 벤치마크 × 30일", 카카오·GFA는 태그 검출 시 범위로 계산합니다. 가정값은 아래에서 바꿀 수 있고, 관측(키워드 순위·소재 수)이 쌓일수록 범위가 좁아집니다.</div>
    <div class="tablewrap"><table class="ads-table"><thead><tr><th>경쟁사</th><th>월 추정 집행액 (중간)</th><th>범위 (하한~상한)</th><th>채널 구성</th><th>근거</th></tr></thead><tbody>
      ${comps.map((c) => { const e = est[c]; return `<tr><td class="stage">${esc(c)}</td><td style="font-weight:600;font-size:15px">${KRW(e.total.mid)}원</td><td>${KRW(e.total.low)} ~ ${KRW(e.total.high)}원</td><td style="min-width:220px">${chBar(e)}</td><td style="font-size:12px;color:var(--muted)">${e.basis.map(esc).join("<br>") || "관측·태그 없음"}</td></tr>`; }).join("") || `<tr><td colspan="5" style="color:var(--muted)">경쟁사가 없습니다. 먼저 퍼널 수집을 하거나 아래에 관측을 입력하세요.</td></tr>`}
    </tbody></table></div>
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

    <details style="margin-top:16px"><summary style="cursor:pointer;font-size:14px;font-weight:600">가정값 (벤치마크) 수정</summary>
      <div class="box" style="margin-top:8px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;font-size:12px">
        <label>파워링크 1~5위 클릭률 (쉼표) <input id="as-ctr" value="${A.ctrByRank.join(",")}"></label>
        <label>순위별 CPC 계수 (1위 대비) <input id="as-cpcf" value="${A.cpcRankFactor.join(",")}"></label>
        <label>CPC 기본값(원) <input id="as-cpc" type="number" value="${A.cpcDefault}"></label>
        <label>메타 소재당 일 집행액 하/중/상(원) <input id="as-meta" value="${A.metaPerCreativeDay.low},${A.metaPerCreativeDay.mid},${A.metaPerCreativeDay.high}"></label>
        <label>구글 소재당 일 집행액 하/중/상(원) <input id="as-google" value="${A.googlePerCreativeDay.low},${A.googlePerCreativeDay.mid},${A.googlePerCreativeDay.high}"></label>
        <label>구글 태그만 있을 때 월 하/상(원) <input id="as-gd" value="${A.googleDisplayWhenTag.low},${A.googleDisplayWhenTag.high}"></label>
        <label>카카오 픽셀 있을 때 월 하/상(원) <input id="as-kakao" value="${A.kakaoWhenTag.low},${A.kakaoWhenTag.high}"></label>
        <label>네이버 GFA 픽셀 있을 때 월 하/상(원) <input id="as-gfa" value="${A.gfaWhenTag.low},${A.gfaWhenTag.high}"></label>
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
    const m = nums($("#as-meta").value), g = nums($("#as-google").value), gd = nums($("#as-gd").value), kk = nums($("#as-kakao").value), gf = nums($("#as-gfa").value);
    const values = { ctrByRank: nums($("#as-ctr").value), cpcRankFactor: nums($("#as-cpcf").value), cpcDefault: +$("#as-cpc").value || A.cpcDefault, metaPerCreativeDay: { low: m[0], mid: m[1], high: m[2] }, googlePerCreativeDay: { low: g[0], mid: g[1], high: g[2] }, googleDisplayWhenTag: { low: gd[0], high: gd[1] }, kakaoWhenTag: { low: kk[0], high: kk[1] }, gfaWhenTag: { low: gf[0], high: gf[1] }, days: 30 };
    await saveAssumptions(values); toast("가정값 저장"); load();
  };
  $("#as-reset").onclick = async () => { await saveAssumptions({}); toast("기본값으로 되돌림"); load(); };
}
