// ---------- 우리 사이트 분석 (9개 패널: 페이지뷰·체류시간·유입경로·이벤트·히트맵·스크롤 깊이·세션 레코딩·코호트·A/B) ----------
const AN = { site: "", days: 14, data: null, sites: [] };
const pct = (n) => (n == null ? "—" : n + "%");
const secs = (s) => (s >= 60 ? `${Math.floor(s / 60)}분 ${s % 60}초` : `${s}초`);
function bars(list, { max, fmt = (v) => v, sub } = {}) {
  if (!list?.length) return '<div class="none">데이터 없음</div>';
  const mx = max || Math.max(...list.map((o) => o.v), 1);
  return `<div class="an-bars">${list.map((o) => `<div class="an-bar"><span class="k" title="${esc(o.k)}">${esc(o.k)}</span><span class="b"><i style="width:${Math.max(2, (o.v / mx) * 100)}%"></i></span><b>${fmt(o.v)}</b>${sub ? `<span class="s">${sub(o)}</span>` : ""}</div>`).join("")}</div>`;
}
function lineSvg(series) {
  if (!series?.length) return '<div class="none">데이터 없음</div>';
  const W = 640, H = 150, L = 36, R = 10, T = 10, B = 24, mx = Math.max(...series.map((p) => p.v), 1);
  const x = (i) => L + (series.length === 1 ? (W - L - R) / 2 : (i / (series.length - 1)) * (W - L - R)), y = (v) => T + (1 - v / mx) * (H - T - B);
  const area = series.map((p, i) => `${x(i)},${y(p.v)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block"><polygon points="${x(0)},${y(0)} ${area} ${x(series.length - 1)},${y(0)}" fill="var(--accent)" opacity=".08"/><polyline points="${area}" fill="none" stroke="var(--accent)" stroke-width="2"/><polyline points="${series.map((p, i) => `${x(i)},${y(p.u || 0)}`).join(" ")}" fill="none" stroke="var(--muted)" stroke-width="1.5" stroke-dasharray="3 3"/>${series.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3" fill="var(--accent)"><title>${p.k}: 페이지뷰 ${p.v} · 방문자 ${p.u || 0}</title></circle>`).join("")}${series.filter((_, i) => i % Math.ceil(series.length / 7) === 0).map((p) => `<text x="${x(series.indexOf(p))}" y="${H - 6}" font-size="10" text-anchor="middle" fill="var(--muted)">${p.k.slice(5)}</text>`).join("")}<text x="${L - 4}" y="${y(mx) + 4}" font-size="10" text-anchor="end" fill="var(--muted)">${mx}</text></svg><div style="font-size:11px;color:var(--muted)">실선 페이지뷰 · 점선 방문자</div>`;
}
async function loadAnalytics() {
  const el = $("#tab-an"); if (!el) return;
  try {
    if (!AN.sites.length) { const s = await api(`/api/analytics?view=sites&days=90`); AN.sites = s.sites || []; if (!AN.site) AN.site = AN.sites[0] || ""; }
    AN.data = await api(`/api/analytics?site=${encodeURIComponent(AN.site)}&days=${AN.days}`);
    renderAnalytics();
  } catch (e) { el.innerHTML = `<div class="empty">${esc(e.message)}</div>` + installBox(); }
}
function installBox() {
  const ep = location.origin;
  return `<div class="box" style="margin-top:12px"><h3 style="margin:0 0 6px;font-size:14px">설치 (우리 사이트에 한 줄)</h3>
    <pre class="an-code">&lt;script src="${esc(ep)}/track.js" data-site="사이트이름" async&gt;&lt;/script&gt;</pre>
    <div style="font-size:12px;color:var(--muted);line-height:1.6">
      · 페이지뷰·체류시간·유입경로·클릭 히트맵·스크롤 깊이는 자동. 세션 레코딩은 <code>data-record="1"</code>을 붙이면 켜집니다(입력값 마스킹).<br>
      · 전환: 신청 완료 시 <code>fa('conversion','견적_신청')</code>. 일반 이벤트: <code>fa('event','영상_재생',{id:1})</code>.<br>
      · A/B: <code>var v = fa('ab','cta_text',['A','B']); if (v==='B') btn.textContent='90초 견적 받기';</code> → 전환과 자동 연결.<br>
      · 처음이면 Supabase SQL Editor에서 <code>schema.sql</code>의 <b>events</b> 부분을 한 번 실행하세요.
    </div></div>`;
}
function renderAnalytics() {
  const el = $("#tab-an"), d = AN.data; if (!el) return;
  const head = `<div class="cmp-bar"><span>사이트</span><select id="an-site">${(AN.sites.length ? AN.sites : [AN.site || "(없음)"]).map((s) => `<option ${s === AN.site ? "selected" : ""}>${esc(s)}</option>`).join("")}</select><span>기간</span><select id="an-days">${[7, 14, 30, 90].map((n) => `<option value="${n}" ${n === AN.days ? "selected" : ""}>최근 ${n}일</option>`).join("")}</select><button class="sm" id="an-reload">새로고침</button><span style="margin-left:auto;font-size:12px;color:var(--muted)">이벤트 ${d?.rowsRead ?? 0}건 집계</span></div>`;
  if (!d || !d.pageview.total) { el.innerHTML = head + `<div class="empty">아직 수집된 데이터가 없습니다. 아래 한 줄을 우리 사이트에 넣으면 바로 쌓이기 시작합니다.</div>` + installBox(); bindAn(); return; }
  const P = (n, title, en, body) => `<section class="an-panel" id="an-p${n}"><h3><span class="n">${n}</span>${title}<span class="en">${en}</span></h3>${body}</section>`;
  const kpi = (v, l) => `<div class="an-kpi"><b>${v}</b><span>${l}</span></div>`;
  const html = `
  <div class="an-grid">
    ${P("01", "페이지뷰", "Pageview", `<div class="an-kpis">${kpi(d.pageview.total.toLocaleString(), "페이지뷰")}${kpi(d.pageview.visitors.toLocaleString(), "방문자")}${kpi(d.pageview.sessions.toLocaleString(), "세션")}${kpi(d.pageview.byDevice.map((o) => `${o.k === "mobile" ? "모바일" : "PC"} ${Math.round((o.v / d.pageview.total) * 100)}%`).join(" · ") || "—", "기기")}</div>${lineSvg(d.pageview.byDay)}<div class="an-sub">페이지별</div>${bars(d.pageview.byPath)}`)}
    ${P("02", "체류 시간", "Time on page", `<div class="an-kpis">${kpi(secs(d.time.avg_s), "평균 체류(활성)")}${kpi(pct(d.time.bounce_pct), "5초 미만 이탈")}${kpi(d.time.n.toLocaleString(), "측정 수")}</div><div class="an-sub">페이지별 평균</div>${bars(d.time.byPath, { fmt: secs, sub: (o) => `${o.n}회` })}`)}
    ${P("03", "유입 경로", "Traffic source", `<div class="an-kpis">${kpi(d.source.conversions, "전환 세션")}</div>${bars(d.source.sessions, { sub: (o) => `전환 ${o.conv} (${o.rate}%)` })}<div class="an-note">utm_source → 없으면 리퍼러로 분류. 광고 클릭(gclid/fbclid/n_media)은 google_ads·meta·naver_ads.</div>`)}
    ${P("04", "이벤트", "Event", `<div class="an-kpis">${kpi(d.events.total, "이벤트")}${kpi(d.events.conversions.reduce((a, o) => a + o.v, 0), "전환")}</div><div class="an-sub">전환 (fa('conversion'))</div>${bars(d.events.conversions)}<div class="an-sub">이벤트 (fa('event'))</div>${bars(d.events.byName)}<div class="an-sub">자동 수집된 클릭 (버튼·링크 문구)</div>${bars(d.events.clicksByName)}`)}
    ${P("05", "히트맵", "Heatmap", `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px"><select id="an-hm-path">${d.heatmap.paths.map((o, i) => `<option value="${esc(o.k)}" ${i === 0 ? "selected" : ""}>${esc(o.k)} (${o.v})</option>`).join("") || "<option>(클릭 없음)</option>"}</select><select id="an-hm-dev"><option value="">모바일+PC</option><option value="mobile">모바일</option><option value="desktop">PC</option></select><button class="sm" id="an-hm-go">그리기</button><span style="font-size:11px;color:var(--muted)">같은 주소의 우리 사이트 캡처가 있으면 그 위에 겹쳐 그립니다</span></div><div id="an-hm" class="an-hm"><div class="none">페이지를 고르고 "그리기"</div></div>`)}
    ${P("06", "스크롤 깊이", "Scroll depth", `<div class="an-kpis">${Object.entries(d.scroll.pct).map(([k, v]) => kpi(pct(v), k + " 도달")).join("")}</div><div class="an-sub">페이지별 평균 도달 깊이</div>${bars(d.scroll.byPath, { max: 100, fmt: pct, sub: (o) => `${o.n}회` })}`)}
    ${P("07", "세션 레코딩", "Session recording", `<div id="an-sessions"><button class="sm" id="an-sess-load">최근 세션 불러오기</button><span style="font-size:11px;color:var(--muted);margin-left:6px">레코딩은 스크립트에 data-record="1"을 붙인 페이지만</span></div>`)}
    ${P("08", "코호트", "Cohort", d.cohort.weeks.length ? `<div class="tablewrap"><table class="an-cohort"><thead><tr><th>첫 방문 주</th><th>방문자</th>${[0, 1, 2, 3, 4, 5].map((i) => `<th>${i}주차</th>`).join("")}</tr></thead><tbody>${d.cohort.weeks.map((c) => `<tr><td>${c.week}</td><td>${c.n}</td>${c.row.map((v) => `<td style="background:rgba(47,91,234,${(v / 100) * 0.6 + 0.04})">${v}%</td>`).join("")}${"<td></td>".repeat(6 - c.row.length)}</tr>`).join("")}</tbody></table></div><div class="an-note">주 단위 재방문율. 같은 기기·브라우저 기준(visitor id)</div>` : '<div class="none">데이터 없음</div>')}
    ${P("09", "A/B 테스트", "A/B test", d.ab.length ? d.ab.map((t) => `<div class="an-sub">${esc(t.test)}</div><div class="an-ab">${t.variants.map((v) => { const best = Math.max(...t.variants.map((x) => x.rate)); return `<div class="an-ab-v ${v.rate === best && v.conv ? "best" : ""}"><b>${esc(v.variant)}</b><span>세션 ${v.sessions}</span><span>전환 ${v.conv}</span><span class="r">${v.rate}%</span></div>`; }).join("")}</div>`).join("") : `<div class="none">진행 중인 테스트 없음</div><div class="an-note">페이지에서 <code>fa('ab','테스트명',['A','B'])</code>를 호출하면 방문자별로 고정 배정되고, 전환과 자동으로 연결됩니다.</div>`)}
  </div>` + installBox();
  el.innerHTML = head + html; bindAn();
}
function bindAn() {
  $("#an-site")?.addEventListener("change", (e) => { AN.site = e.target.value; loadAnalytics(); });
  $("#an-days")?.addEventListener("change", (e) => { AN.days = +e.target.value; loadAnalytics(); });
  $("#an-reload")?.addEventListener("click", () => { AN.sites = []; loadAnalytics(); });
  $("#an-hm-go")?.addEventListener("click", drawHeatmap);
  $("#an-sess-load")?.addEventListener("click", loadSessions);
}
async function drawHeatmap() {
  const path = $("#an-hm-path").value, dev = $("#an-hm-dev").value, box = $("#an-hm");
  box.innerHTML = '<div class="none">불러오는 중…</div>';
  const r = await api(`/api/analytics?view=heatmap&site=${encodeURIComponent(AN.site)}&days=${AN.days}&path=${encodeURIComponent(path)}`);
  let pts = r.points || []; if (dev) pts = pts.filter((p) => p.d === dev);
  // 배경: 우리 사이트 캡처(같은 path) 스크린샷이 있으면 사용
  const cap = ALL.find((c) => c.url && (() => { try { return new URL(c.url).pathname === path; } catch { return false; } })() && (!dev || (dev === "mobile" ? c.device === "모바일" : c.device === "데스크톱")));
  const bg = cap ? await shotOf(cap.id) : null;
  const W = dev === "desktop" ? 640 : 360, H = bg ? null : Math.round(W * 2.4);
  const img = bg ? await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = bg; }) : null;
  const h = img ? Math.round((img.height / img.width) * W) : H;
  const canvas = document.createElement("canvas"); canvas.width = W; canvas.height = h; const ctx = canvas.getContext("2d");
  if (img) ctx.drawImage(img, 0, 0, W, h); else { ctx.fillStyle = "#f3f4f6"; ctx.fillRect(0, 0, W, h); ctx.fillStyle = "#9ca3af"; ctx.font = "12px sans-serif"; ctx.fillText("배경 캡처 없음 — URL로 수집에서 우리 사이트를 캡처하면 그 위에 표시됩니다", 12, 20); }
  // 열점: 반경 18px 가우시안 누적 → 색상 매핑
  const heat = document.createElement("canvas"); heat.width = W; heat.height = h; const hc = heat.getContext("2d");
  pts.forEach((p) => { const g = hc.createRadialGradient(p.x * W, p.y * h, 0, p.x * W, p.y * h, 18); g.addColorStop(0, "rgba(0,0,0,0.35)"); g.addColorStop(1, "rgba(0,0,0,0)"); hc.fillStyle = g; hc.beginPath(); hc.arc(p.x * W, p.y * h, 18, 0, Math.PI * 2); hc.fill(); });
  const id = hc.getImageData(0, 0, W, h), px = id.data;
  for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; if (!a) continue; const t = Math.min(1, a * 1.6); const c = t < 0.33 ? [37, 99, 235] : t < 0.66 ? [250, 204, 21] : [220, 38, 38]; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = Math.round(Math.min(220, t * 255)); }
  hc.putImageData(id, 0, 0); ctx.drawImage(heat, 0, 0);
  box.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:6px">${esc(path)} · 클릭 ${pts.length}건${cap ? ` · 배경: ${esc(cap.competitor)} 캡처 ${fmt(cap.captured_at)}` : ""}</div><div style="overflow:auto;max-height:70vh;border:1px solid var(--line);border-radius:8px"><img src="${canvas.toDataURL("image/png")}" style="width:${W}px;display:block"></div>`;
}
async function loadSessions() {
  const box = $("#an-sessions"); box.innerHTML = '<div class="none">불러오는 중…</div>';
  const r = await api(`/api/analytics?view=sessions&site=${encodeURIComponent(AN.site)}&days=${AN.days}`);
  const list = r.sessions || [];
  box.innerHTML = list.length ? `<div class="tablewrap"><table class="an-sess"><thead><tr><th>시작</th><th>유입</th><th>기기</th><th>페이지</th><th>길이</th><th>전환</th><th></th></tr></thead><tbody>${list.map((s) => `<tr><td>${fmt(s.start)}</td><td>${esc(s.source || "")}</td><td>${s.device === "mobile" ? "모바일" : "PC"}</td><td title="${esc(s.pages.join(" → "))}">${s.pages.length}개: ${esc(s.pages.slice(0, 3).join(" → "))}${s.pages.length > 3 ? " …" : ""}</td><td>${secs(s.dur_s)}</td><td>${s.conv ? "✓" : ""}</td><td>${s.recorded ? `<button class="sm" data-replay="${s.sid}">▶ 다시보기</button>` : `<button class="sm" data-steps="${s.sid}">경로 보기</button>`}</td></tr>`).join("")}</tbody></table></div><div id="an-player"></div>` : '<div class="none">세션 없음</div>';
  box.querySelectorAll("[data-replay]").forEach((b) => b.addEventListener("click", () => replaySession(b.dataset.replay)));
  box.querySelectorAll("[data-steps]").forEach((b) => b.addEventListener("click", () => showSteps(b.dataset.steps)));
}
async function showSteps(sid) {
  const r = await api(`/api/analytics?view=session&sid=${encodeURIComponent(sid)}`);
  $("#an-player").innerHTML = `<div class="box" style="margin-top:8px;font-size:12px"><b>세션 경로</b><ol style="padding-left:18px;margin:6px 0">${(r.steps || []).filter((s) => s.type !== "click" || s.name).map((s) => `<li>${fmt(s.ts).slice(6)} · ${s.type === "pageview" ? "페이지 " + esc(s.path) : s.type === "leave" ? `이탈 (체류 ${Math.round((s.data?.duration_ms || 0) / 1000)}초, 스크롤 ${s.data?.depth || 0}%)` : s.type === "click" ? "클릭 " + esc(s.name) : s.type === "event" ? (s.data?.conversion ? "전환 " : "이벤트 ") + esc(s.name) : s.type === "ab" ? `A/B ${esc(s.name)} = ${esc(s.data?.variant)}` : s.type}</li>`).join("")}</ol></div>`;
}
async function replaySession(sid) {
  const host = $("#an-player"); host.innerHTML = '<div class="none">레코딩 불러오는 중…</div>';
  const r = await api(`/api/analytics?view=session&sid=${encodeURIComponent(sid)}`);
  if (!r.rr?.length) { host.innerHTML = '<div class="none">레코딩 데이터가 없습니다</div>'; return; }
  if (!window.rrwebPlayer) {
    await new Promise((res) => { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.17/dist/style.css"; document.head.appendChild(l); const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/rrweb-player@2.0.0-alpha.17/dist/index.js"; s.onload = res; document.head.appendChild(s); });
  }
  host.innerHTML = '<div class="box" style="margin-top:8px"><div id="an-rr"></div></div>';
  new rrwebPlayer({ target: $("#an-rr"), props: { events: r.rr, width: Math.min(900, host.clientWidth - 24), height: 520, autoPlay: true, skipInactive: true } });
}
