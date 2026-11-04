const $ = (s) => document.querySelector(s);
const STAGES = ["첫 화면(랜딩)", "카테고리/상품 목록", "상품 상세", "장바구니", "결제", "회원가입/로그인", "이벤트/기획전", "기타"];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (iso) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
let ALL = [];

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("on"); setTimeout(() => t.classList.remove("on"), 1800); }

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { "Content-Type": "application/json" }, ...opts });
  if (r.status === 401) { $("#login").classList.add("on"); throw new Error("unauthorized"); }
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}

// ---------- 로그인 ----------
$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-err").textContent = "";
  try {
    await api("/api/login", { method: "POST", body: JSON.stringify({ password: $("#pw").value }) });
    $("#login").classList.remove("on"); $("#pw").value = "";
    load();
  } catch (err) { $("#login-err").textContent = err.message === "unauthorized" ? "비밀번호가 틀렸습니다." : err.message; }
});
$("#btn-logout").addEventListener("click", async () => { await fetch("/api/login", { method: "DELETE" }); location.reload(); });

// ---------- 데이터 ----------
async function load() {
  try {
    ALL = await api("/api/captures");
    const comps = [...new Set(ALL.map((c) => c.competitor))].sort();
    const sel = $("#f-comp");
    const prev = [...sel.selectedOptions].map((o) => o.value);
    sel.innerHTML = comps.map((c) => `<option ${prev.includes(c) || !prev.length ? "selected" : ""}>${esc(c)}</option>`).join("");
    sel.size = Math.min(Math.max(comps.length, 1), 4);
    render();
  } catch (e) { if (e.message !== "unauthorized") { toast("불러오기 실패"); $("#tab-table").innerHTML = `<div class="empty" style="color:var(--danger)">서버 설정 오류<br><br><code style="white-space:pre-wrap">${esc(e.message)}</code><br><br><span style="color:var(--muted)">Netlify 환경변수 또는 Supabase 설정을 확인한 뒤 재배포하고 새로고침하세요.</span></div>`; } }
}

function filtered() {
  const dev = $("#f-device").value;
  const comps = [...$("#f-comp").selectedOptions].map((o) => o.value);
  return ALL.filter((c) => (!dev || c.device === dev) && (!comps.length || comps.includes(c.competitor)));
}
// 경쟁사×단계별 최신 캡처 + 이력
function matrix(rows) {
  const comps = [...new Set(rows.map((c) => c.competitor))].sort();
  const m = {};
  for (const c of rows) {
    const key = c.competitor + "|" + c.stage;
    (m[key] ||= []).push(c);
  }
  for (const k in m) m[k].sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
  return { comps, m };
}

// ---------- 비교표 ----------
function cellHtml(list) {
  if (!list?.length) return `<span class="none">—</span>`;
  const c = list[0], d = c.data || {};
  const h1 = d.headlines?.find((h) => h.tag === "h1")?.text || d.headlines?.[0]?.text;
  const ctas = (d.ctas || []).filter((x) => x.match).slice(0, 6);
  const benefits = (d.benefits || []).slice(0, 6).map((b) => b.text);
  const overlays = (d.overlays || []).slice(0, 3);
  const sections = (d.sections || []).slice(0, 5);
  return `<div class="cell">
    <div class="meta"><span>${fmt(c.captured_at)} · ${esc(c.device || "")}</span><a data-id="${c.id}">상세 ›</a></div>
    <div class="k">헤드라인</div><div class="v">${h1 ? esc(h1) : '<span class="none">없음</span>'}</div>
    <div class="k">CTA</div><div>${ctas.length ? ctas.map((x) => `<span class="chip ${x.strong ? "strong" : ""} ${x.fixed ? "fixed" : ""}" title="${esc(x.pos)}${x.fixed ? " · 고정" : ""}">${esc(x.text)}</span>`).join("") : '<span class="none">없음</span>'}</div>
    <div class="k">혜택·소구 문구</div><div class="v">${benefits.length ? benefits.map((b) => "· " + esc(b)).join("\n") : '<span class="none">없음</span>'}</div>
    <div class="k">팝업·배너</div><div class="v">${overlays.length ? overlays.map((o) => `[${esc(o.kind)}] ${esc(o.text.slice(0, 70))}`).join("\n") : '<span class="none">없음</span>'}</div>
    <div class="k">추천·광고 영역</div><div class="v">${sections.length ? sections.map((s) => `${esc(s.title)} (${s.cards}개, ${esc(s.pos)})`).join("\n") : '<span class="none">없음</span>'}</div>
    ${c.note ? `<div class="k">메모</div><div class="v">${esc(c.note)}</div>` : ""}
    <img class="thumb" data-shot="${c.id}" loading="lazy" alt="">
    ${list.length > 1 ? `<div class="hist">이전 ${list.length - 1}건: ${list.slice(1, 4).map((p) => `<a data-id="${p.id}">${fmt(p.captured_at)}</a>`).join("")}</div>` : ""}
  </div>`;
}

function renderTable() {
  const rows = filtered();
  const el = $("#tab-table");
  if (!rows.length) {
    el.innerHTML = `<div class="empty">아직 수집된 캡처가 없습니다.<br><br>크롬 확장 <b>퍼널 비교 수집기</b>의 설정에 이 어드민 주소와 비밀번호를 넣고, 경쟁사 페이지에서 <code>이 페이지 캡처</code>를 누르면 여기에 쌓입니다.</div>`;
    return;
  }
  const { comps, m } = matrix(rows);
  const stages = STAGES.filter((s) => comps.some((c) => m[c + "|" + s]));
  el.innerHTML = `<div class="scroll"><table>
    <thead><tr><th>퍼널 단계</th>${comps.map((c) => `<th>${esc(c)}<span class="sub">${rows.filter((r) => r.competitor === c).length}건 수집</span></th>`).join("")}</tr></thead>
    <tbody>${stages.map((s) => `<tr><td>${esc(s)}</td>${comps.map((c) => `<td>${cellHtml(m[c + "|" + s])}</td>`).join("")}</tr>`).join("")}</tbody>
  </table></div>`;
  // 스크린샷은 상세 API에서 지연 로딩
  el.querySelectorAll("img[data-shot]").forEach(async (img) => {
    try { const d = await api("/api/captures?id=" + img.dataset.shot); if (d.screenshot) img.src = d.screenshot; else img.remove(); } catch { img.remove(); }
    img.addEventListener("click", () => openDetail(img.dataset.shot));
  });
}

// ---------- 화면 비교 (두 경쟁사 나란히 + 핀) ----------
const PIN_TYPES = { cta: ["CTA", "#d9442b"], reco: ["추천·광고", "#7a3fd1"], pop: ["팝업·플로팅", "#0f8a7a"], price: ["가격·혜택", "#d98c00"], trust: ["신뢰", "#2662c9"], urg: ["긴급성", "#c2187a"] };
const cmpState = { stage: "", a: "", b: "" };
const SHOT_CACHE = {};
async function shotOf(id) { if (!(id in SHOT_CACHE)) { try { SHOT_CACHE[id] = (await api("/api/captures?id=" + id)).screenshot || null; } catch { SHOT_CACHE[id] = null; } } return SHOT_CACHE[id]; }

// 캡처 1건 → 핀 목록. 자동 수집(funnel_collector)은 페이지 비율 좌표가 있어 스크린샷 위에 찍고, 확장 수집은 위치 띠(첫화면/스크롤1…)로만 표시.
function pinsOf(c) {
  const d = c.data || {}, out = [];
  const bandY = (pos) => ({ "첫화면": 0.06, "스크롤1": 0.3, "스크롤2": 0.55, "하단": 0.85 })[String(pos || "").split("/")[0]];
  const bandX = (pos) => ({ "좌": 0.15, "중앙": 0.5, "우": 0.85 })[String(pos || "").split("/")[1]] ?? 0.5;
  if (d.ctaDetail) d.ctaDetail.forEach((x) => out.push({ t: "cta", x: x.pos.x, y: x.pos.y, n: x.text + (x.fixed ? " · 고정" : "") + (x.fullWidth ? " · 전폭" : ""), exact: true }));
  else (d.ctas || []).filter((x) => x.match).slice(0, 12).forEach((x) => out.push({ t: "cta", x: bandX(x.pos), y: bandY(x.pos), n: x.text + (x.fixed ? " · 고정" : "") + (x.strong ? " · 강조색" : ""), d: x.pos }));
  if (d.promoDetail) d.promoDetail.forEach((p) => out.push({ t: "reco", x: p.pos.x, y: p.pos.y, n: (p.kind === "banner" ? "배너 · " : p.kind === "ad" ? "광고 · " : "") + p.label + (p.items > 1 ? ` (${p.items}개)` : ""), exact: true }));
  else (d.sections || []).forEach((s) => out.push({ t: "reco", x: bandX(s.pos), y: bandY(s.pos), n: `${s.title} (${s.cards}개)`, d: s.pos }));
  if (d.overlaysByTrigger) d.overlaysByTrigger.forEach((tr) => tr.overlays.forEach((o) => out.push({ t: "pop", x: o.pos ? o.pos.x : 0.85, y: o.pos ? o.pos.y : 0.03, n: `${o.kind} · ${o.purpose} · ${o.text.slice(0, 50)}`, d: tr.trigger, exact: !!o.pos })));
  else (d.overlays || []).forEach((o) => out.push({ t: "pop", x: 0.85, y: o.kind === "하단바" ? 0.1 : 0.03, n: `${o.kind} · ${o.text.slice(0, 50)}`, d: o.size }));
  const ap = d.appeals;
  if (ap) { (ap.price || []).slice(0, 4).forEach((s, i) => out.push({ t: "price", x: 0.08, y: 0.2 + i * 0.03, n: s })); (ap.trust || []).slice(0, 4).forEach((s, i) => out.push({ t: "trust", x: 0.08, y: 0.4 + i * 0.03, n: s })); (ap.urgency || []).slice(0, 4).forEach((s, i) => out.push({ t: "urg", x: 0.08, y: 0.6 + i * 0.03, n: s })); }
  else (d.benefits || []).slice(0, 10).forEach((b) => { const t = /한정|오늘만|마감|선착순|마지막|남음/.test(b.text) ? "urg" : /후기|리뷰|평점|★|별점|보장|환불|인증/.test(b.text) ? "trust" : "price"; out.push({ t, x: bandX(b.pos), y: bandY(b.pos), n: b.text, d: b.pos }); });
  return out.map((p, i) => ({ ...p, i: i + 1, x: Math.min(97, Math.max(3, (p.x ?? 0.5) * 100)), y: Math.min(99, Math.max(1, (p.y ?? 0.1) * 100)) }));
}
function cmpColumn(side, c) {
  if (!c) return `<div class="cmp-col"><h2>${side}</h2><div class="shot"><div class="none">이 단계의 캡처가 없습니다</div></div></div>`;
  const pins = pinsOf(c), d = c.data || {};
  const exact = !!(d.ctaDetail || d.promoDetail);
  const pinHtml = pins.map((p) => `<button class="pin" data-pin="${side}-${p.i}" style="left:${p.x}%;top:${p.y}%;--c:${PIN_TYPES[p.t][1]}" title="${esc(p.n)}">${p.i}</button>`).join("");
  const groups = Object.keys(PIN_TYPES).map((t) => { const l = pins.filter((p) => p.t === t); return l.length ? `<div class="grp">${PIN_TYPES[t][0]} ${l.length}</div>${l.map((p) => `<div class="row" data-row="${side}-${p.i}" style="--c:${PIN_TYPES[t][1]}"><span class="dot">${p.i}</span><span>${esc(p.n)}${p.d ? ` <span class="d">(${esc(p.d)})</span>` : ""}</span></div>`).join("")}` : ""; }).join("");
  return `<div class="cmp-col" data-side="${side}">
    <h2><span>${side} · ${esc(c.competitor)}</span><a data-id="${c.id}">상세 ›</a></h2>
    <div class="sub">${fmt(c.captured_at)} · ${esc(c.device || "")}${c.note ? " · " + esc(c.note) : ""} · <a href="${esc(c.url)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc((c.url || "").replace(/^https?:\/\//, "").slice(0, 60))}</a></div>
    <div class="shot" data-shot-box="${side}"><div class="frame"><img data-cmp-shot="${c.id}" alt="">${pinHtml}</div><div class="none">스크린샷 불러오는 중…</div></div>
    <div class="pinlist">${groups || '<span class="none">추출된 항목이 없습니다</span>'}</div>
    ${exact ? "" : `<div class="cmp-note">확장·즐겨찾기 수집본은 정확한 좌표가 없어 핀을 대략적인 위치 띠(첫화면·스크롤·하단)에 놓았습니다. 정확한 위치는 자동 수집본에서 보입니다.</div>`}
  </div>`;
}
function renderCompare() {
  const rows = filtered();
  const el = $("#tab-compare");
  if (!rows.length) { el.innerHTML = `<div class="empty">비교할 캡처가 없습니다.</div>`; return; }
  const { comps, m } = matrix(rows);
  const stages = STAGES.filter((s) => comps.some((c) => m[c + "|" + s]));
  if (!stages.includes(cmpState.stage)) cmpState.stage = stages[0];
  if (!comps.includes(cmpState.a)) cmpState.a = comps[0];
  if (!comps.includes(cmpState.b) || cmpState.b === cmpState.a) cmpState.b = comps.find((c) => c !== cmpState.a) || comps[0];
  const A = m[cmpState.a + "|" + cmpState.stage]?.[0], B = m[cmpState.b + "|" + cmpState.stage]?.[0];
  const opt = (list, v) => list.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  el.innerHTML = `<div class="cmp-bar">
      <span>단계</span><select id="cmp-stage">${opt(stages, cmpState.stage)}</select>
      <span>A</span><select id="cmp-a">${opt(comps, cmpState.a)}</select>
      <span>B</span><select id="cmp-b">${opt(comps, cmpState.b)}</select>
      <button class="sm" id="cmp-swap">↔ 바꾸기</button>
      <div class="cmp-legend">${Object.entries(PIN_TYPES).map(([k, [l, c]]) => `<span style="--c:${c}"><i></i>${l}</span>`).join("")}</div>
    </div>
    <div class="cmp-cols">${cmpColumn("A", A)}${cmpColumn("B", B)}</div>
    <div class="cmp-note">두 화면은 스크롤이 함께 움직입니다. 핀이나 목록 항목을 누르면 서로 강조됩니다.</div>`;
  $("#cmp-stage").onchange = (e) => { cmpState.stage = e.target.value; renderCompare(); };
  $("#cmp-a").onchange = (e) => { cmpState.a = e.target.value; renderCompare(); };
  $("#cmp-b").onchange = (e) => { cmpState.b = e.target.value; renderCompare(); };
  $("#cmp-swap").onclick = () => { [cmpState.a, cmpState.b] = [cmpState.b, cmpState.a]; renderCompare(); };
  el.querySelectorAll("img[data-cmp-shot]").forEach(async (img) => {
    const box = img.closest(".shot"); const src = await shotOf(img.dataset.cmpShot);
    if (src) { img.src = src; box.querySelector(".none")?.remove(); } else { box.querySelector(".none").textContent = "스크린샷 없음 (즐겨찾기 수집본은 스크린샷이 빠집니다)"; }
  });
  const boxes = [...el.querySelectorAll("[data-shot-box]")];
  boxes.forEach((box) => box.addEventListener("scroll", () => {
    if (box._lock) return;
    const other = boxes.find((b) => b !== box); if (!other) return;
    const max = box.scrollHeight - box.clientHeight, omax = other.scrollHeight - other.clientHeight; if (max <= 0 || omax <= 0) return;
    other._lock = true; other.scrollTop = (box.scrollTop / max) * omax; requestAnimationFrame(() => (other._lock = false));
  }, { passive: true }));
  const hi = (key) => { el.querySelectorAll(".pin,.row").forEach((n) => n.classList.toggle("on", (n.dataset.pin || n.dataset.row) === key)); };
  el.querySelectorAll(".pin").forEach((p) => p.addEventListener("click", () => { hi(p.dataset.pin); el.querySelector(`[data-row="${p.dataset.pin}"]`)?.scrollIntoView({ block: "nearest" }); }));
  el.querySelectorAll(".row").forEach((r) => r.addEventListener("click", () => { hi(r.dataset.row); const p = el.querySelector(`[data-pin="${r.dataset.row}"]`); if (p) { const box = p.closest(".shot"); box.scrollTo({ top: p.offsetTop - box.clientHeight / 2, behavior: "smooth" }); } }));
}

// ---------- URL로 수집 (GitHub Actions 즉시 실행 + 도착 폴링) ----------
let CAP_Q = [];
try { CAP_Q = JSON.parse(localStorage.getItem("capQueue") || "[]"); } catch {}
const saveQ = () => { try { localStorage.setItem("capQueue", JSON.stringify(CAP_Q.slice(0, 30))); } catch {} };
function renderCaptureQueue() {
  const el = $("#cap-queue"); if (!el) return;
  $("#cap-comp-list").innerHTML = [...new Set(ALL.map((c) => c.competitor))].sort().map((c) => `<option value="${esc(c)}">`).join("");
  if (!CAP_Q.length) { el.innerHTML = ""; return; }
  el.innerHTML = `<div style="font-size:12px;color:var(--muted);margin-bottom:4px">요청 내역 (이 브라우저)</div>` + CAP_Q.map((q) => {
    const done = ALL.find((c) => c.id === q.id);
    const age = (Date.now() - q.at) / 1000;
    const st = done ? ["ok", "도착"] : q.error ? ["err", "실패"] : age > 600 ? ["err", "10분 경과 · Actions 확인"] : ["wait", "수집 중…"];
    return `<div class="cap-row"><span class="t">${fmt(new Date(q.at).toISOString())}</span><span class="u" title="${esc(q.url)}">${esc(q.competitor || "")} · ${esc(q.stage)} · ${esc(q.url)}</span><span class="st ${st[0]}">${st[1]}</span><span class="t">${esc(q.device)}</span><span>${done ? `<button class="sm" data-cmp-open="${q.id}">화면 비교</button> <button class="sm" data-id="${q.id}">상세</button>` : q.error ? `<span class="t" title="${esc(q.error)}">${esc(q.error.slice(0, 60))}</span>` : `<a href="${esc(q.actions || "#")}" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent)">진행 보기</a>`}</span></div>`;
  }).join("");
  el.querySelectorAll("[data-cmp-open]").forEach((b) => b.addEventListener("click", () => {
    const c = ALL.find((x) => x.id === b.dataset.cmpOpen); if (!c) return;
    cmpState.stage = c.stage; cmpState.a = c.competitor;
    document.querySelector('.tabs button[data-tab="compare"]').click(); renderCompare();
  }));
}
let capPoll = null;
function startCapPoll() {
  if (capPoll) return;
  capPoll = setInterval(async () => {
    const pending = CAP_Q.filter((q) => !q.error && !ALL.find((c) => c.id === q.id) && Date.now() - q.at < 600000);
    if (!pending.length) { clearInterval(capPoll); capPoll = null; return; }
    try { ALL = await api("/api/captures"); } catch { return; }
    const arrived = pending.filter((q) => ALL.find((c) => c.id === q.id));
    if (arrived.length) { toast(`수집 도착: ${arrived.map((q) => q.competitor || q.url).join(", ")}`); render(); }
    else renderCaptureQueue();
  }, 15000);
}
$("#cap-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { url: $("#cap-url").value.trim(), competitor: $("#cap-comp").value.trim(), stage: $("#cap-stage").value, device: $("#cap-device").value };
  $("#cap-go").disabled = true;
  try {
    const r = await api("/api/capture-request", { method: "POST", body: JSON.stringify(body) });
    CAP_Q.unshift({ id: r.id, at: Date.now(), ...body, actions: r.actions_url }); saveQ();
    toast("GitHub Actions에 수집을 요청했습니다. 1~2분 뒤 도착합니다."); $("#cap-url").value = "";
    renderCaptureQueue(); startCapPoll();
  } catch (err) { toast("요청 실패: " + err.message); CAP_Q.unshift({ id: "x" + Date.now(), at: Date.now(), ...body, error: err.message }); saveQ(); renderCaptureQueue(); }
  finally { $("#cap-go").disabled = false; }
});

// ---------- 타임라인 ----------
function renderTimeline() {
  const rows = filtered();
  const el = $("#tab-timeline");
  if (!rows.length) { el.innerHTML = `<div class="empty">수집 이력이 없습니다.</div>`; return; }
  const comps = [...new Set(rows.map((c) => c.competitor))].sort();
  el.innerHTML = comps.map((comp) => {
    const list = rows.filter((r) => r.competitor === comp).sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
    return `<div class="tl-comp"><h2>${esc(comp)} <button class="sm danger" data-del-comp="${esc(comp)}" style="float:right">경쟁사 전체 삭제</button></h2>
      ${list.map((c) => `<div class="tl-row"><span class="t">${fmt(c.captured_at)}</span><span class="s">${esc(c.stage)}</span><span class="d">${esc(c.device || "")}</span><span class="h" title="${esc(c.url)}">${esc(c.data?.headlines?.[0]?.text || c.title || c.url || "")}</span><span><button class="sm" data-id="${c.id}">상세</button> <button class="sm danger" data-del="${c.id}">삭제</button></span></div>`).join("")}
    </div>`;
  }).join("");
}

// ---------- 상세 ----------
async function openDetail(id) {
  let c; try { c = await api("/api/captures?id=" + id); } catch (e) { toast("불러오기 실패"); return; }
  const d = c.data || {};
  const li = (arr, f) => arr?.length ? `<ul>${arr.map((x) => `<li>${f(x)}</li>`).join("")}</ul>` : `<span class="none">없음</span>`;
  $("#detail-body").innerHTML = `
    <h2>${esc(c.competitor)} · ${esc(c.stage)}</h2>
    <div class="sub">${fmt(c.captured_at)} · ${esc(c.device || "")} · ${esc(d.viewport || "")} · <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.url)}</a></div>
    ${c.note ? `<h3>메모</h3><div>${esc(c.note)}</div>` : ""}
    ${c.screenshot ? `<h3>스크린샷</h3><img src="${c.screenshot}" alt="">` : ""}
    <h3>페이지</h3><div><b>${esc(c.title)}</b><br><span style="color:var(--muted)">${esc(d.description)}</span></div>
    <h3>헤드라인</h3>${li(d.headlines, (h) => `<code>${h.tag}</code> ${esc(h.text)} <span style="color:var(--muted)">(${esc(h.pos)})</span>`)}
    <h3>CTA (마케팅 키워드 매칭 우선)</h3>${li(d.ctas, (x) => `${esc(x.text)} <span style="color:var(--muted)">${esc(x.pos)} · ${x.size}${x.strong ? " · 강조색" : ""}${x.fixed ? " · 고정" : ""}</span>`)}
    <h3>혜택·소구 문구</h3>${li(d.benefits, (b) => `${esc(b.text)} <span style="color:var(--muted)">(${esc(b.pos)})</span>`)}
    <h3>팝업·배너·플로팅</h3>${li(d.overlays, (o) => `[${esc(o.kind)} ${o.size}] ${esc(o.text)}`)}
    <h3>추천·광고·상품 섹션</h3>${li(d.sections, (s) => `${esc(s.title)} — 카드 ${s.cards}개, ${esc(s.pos)}${s.samplePrices?.length ? ", 예: " + esc(s.samplePrices.join(" / ")) : ""}`)}
    <h3>노출 가격</h3><div>${d.prices?.length ? esc(d.prices.join(" · ")) : '<span class="none">없음</span>'}</div>
    <h3>입력 폼</h3>${li(d.forms, (f) => `${esc(f.fields.join(", "))} → <b>${esc(f.submit)}</b> <span style="color:var(--muted)">(${esc(f.pos)})</span>`)}
    <h3>내비게이션</h3><div>${d.nav?.length ? esc(d.nav.join(" · ")) : '<span class="none">없음</span>'}</div>
    <h3>첫 화면 텍스트</h3><pre>${esc(d.firstScreenText)}</pre>`;
  $("#detail").classList.add("on");
}
$("#btn-close").addEventListener("click", () => $("#detail").classList.remove("on"));
$("#detail").addEventListener("click", (e) => { if (e.target === $("#detail")) $("#detail").classList.remove("on"); });

// ---------- 프롬프트 ----------
function buildPrompt() {
  const rows = filtered();
  if (!rows.length) return "아직 수집된 데이터가 없습니다.\n\n경쟁사 페이지에서 즐겨찾기 '퍼널 수집' 버튼(또는 확장 프로그램)으로 먼저 캡처한 뒤, 이 탭을 다시 열어 복사하세요.";
  const { comps, m } = matrix(rows);
  const lines = [];
  lines.push("당신은 이커머스/서비스 마케팅 전략 분석가입니다. 아래는 경쟁사 사이트를 퍼널 단계별로 수집한 데이터입니다.");
  lines.push("다음 항목을 비교표와 서술로 정리해 주세요:");
  lines.push("1) 경쟁사별 핵심 소구점(가격/혜택/신뢰/긴급성/편의 등 분류)과 첫 화면 메시지 전략");
  lines.push("2) 퍼널 단계별 CTA 문구·위치·강조 방식의 차이와 사용자를 다음 단계로 밀어넣는 장치");
  lines.push("3) 상품 광고/추천 영역이 어느 단계·위치에 어떤 명목(추천/인기/함께 구매 등)으로 노출되는지 흐름");
  lines.push("4) 팝업·배너·플로팅 요소의 역할(첫 구매 유도, 앱 설치, 쿠폰 등)");
  lines.push("5) 우리가 참고할 만한 점 3가지와 피해야 할 점 2가지");
  lines.push("");
  for (const comp of comps) {
    lines.push(`## ${comp}`);
    for (const s of STAGES) {
      const list = m[comp + "|" + s]; if (!list) continue;
      const c = list[0], d = c.data || {};
      lines.push(`### ${s} (${c.device || ""}, ${fmt(c.captured_at)})`);
      lines.push(`- URL: ${c.url}`);
      if (d.headlines?.length) lines.push(`- 헤드라인: ${d.headlines.slice(0, 6).map((h) => h.text).join(" / ")}`);
      const ctas = (d.ctas || []).filter((x) => x.match).slice(0, 8);
      if (ctas.length) lines.push(`- CTA: ${ctas.map((x) => `${x.text}(${x.pos}${x.strong ? ",강조" : ""}${x.fixed ? ",고정" : ""})`).join(", ")}`);
      if (d.benefits?.length) lines.push(`- 혜택/소구 문구: ${d.benefits.slice(0, 10).map((b) => b.text).join(" | ")}`);
      if (d.overlays?.length) lines.push(`- 팝업/배너: ${d.overlays.map((o) => `[${o.kind}] ${o.text.slice(0, 80)}`).join(" | ")}`);
      if (d.sections?.length) lines.push(`- 추천/광고 섹션: ${d.sections.map((x) => `${x.title}(${x.cards}개,${x.pos})`).join(", ")}`);
      if (d.prices?.length) lines.push(`- 노출 가격: ${d.prices.join(", ")}`);
      if (d.forms?.length) lines.push(`- 폼: ${d.forms.map((f) => `${f.fields.join("/")}→${f.submit}`).join(", ")}`);
      if (c.note) lines.push(`- 수집자 메모: ${c.note}`);
      if (d.firstScreenText) lines.push(`- 첫 화면 텍스트: ${d.firstScreenText.slice(0, 500)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
$("#btn-copy").addEventListener("click", async () => { await navigator.clipboard.writeText($("#prompt").value); $("#copied").textContent = "복사됨"; setTimeout(() => ($("#copied").textContent = ""), 1500); });

// ---------- 수집 버튼(북마클릿) ----------
$("#btn-make").addEventListener("click", async () => {
  const pw = $("#tool-pw").value; if (!pw) return toast("비밀번호를 입력하세요.");
  try {
    const chk = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) });
    if (!chk.ok) return toast("비밀번호가 틀렸습니다.");
    let src = await fetch("/collector.js").then((r) => r.text());
    src = src.split("__SERVER__").join(location.origin).split("__PASSWORD__").join(pw.replace(/\\/g, "\\\\").replace(/"/g, '\\"'));
    const href = "javascript:" + encodeURIComponent(src);
    $("#bm-link").href = href; $("#bm-link").dataset.code = href; $("#tool-out").hidden = false; $("#tool-pw").value = "";
  } catch (e) { toast("생성 실패: " + e.message); }
});
$("#bm-link").addEventListener("click", (e) => { e.preventDefault(); toast("클릭이 아니라 즐겨찾기 바로 드래그하세요."); });
$("#btn-copy-bm").addEventListener("click", async () => { await navigator.clipboard.writeText($("#bm-link").dataset.code || ""); $("#bm-copied").textContent = "복사됨"; setTimeout(() => ($("#bm-copied").textContent = ""), 1500); });

// ---------- CSV ----------
$("#btn-csv").addEventListener("click", () => {
  const rows = filtered();
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const head = ["경쟁사", "단계", "화면", "수집시각", "URL", "제목", "헤드라인", "CTA", "혜택문구", "팝업배너", "추천광고섹션", "가격", "메모"];
  const body = rows.map((c) => { const d = c.data || {}; return [
    c.competitor, c.stage, c.device, c.captured_at, c.url, c.title,
    (d.headlines || []).map((h) => h.text).join(" / "),
    (d.ctas || []).filter((x) => x.match).map((x) => `${x.text}(${x.pos})`).join(" / "),
    (d.benefits || []).map((b) => b.text).join(" / "),
    (d.overlays || []).map((o) => `[${o.kind}] ${o.text}`).join(" / "),
    (d.sections || []).map((s) => `${s.title}(${s.cards})`).join(" / "),
    (d.prices || []).join(" / "), c.note,
  ].map(q).join(","); });
  const blob = new Blob(["﻿" + [head.map(q).join(","), ...body].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `funnel-compare-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
});

// ---------- 공통 ----------
function render() {
  const rows = filtered();
  $("#stat").textContent = `${rows.length}건 / 전체 ${ALL.length}건`;
  renderTable(); renderCompare(); renderCaptureQueue(); renderTimeline(); $("#prompt").value = buildPrompt();
  if (CAP_Q.some((q) => !q.error && !ALL.find((c) => c.id === q.id) && Date.now() - q.at < 600000)) startCapPoll();
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  ["table", "compare", "capture", "timeline", "prompt", "tool"].forEach((t) => ($("#tab-" + t).hidden = b.dataset.tab !== t));
}));
$("#f-device").addEventListener("change", render);
$("#f-comp").addEventListener("change", render);
$("#btn-refresh").addEventListener("click", load);
document.body.addEventListener("click", async (e) => {
  const t = e.target;
  if (t.dataset.id) return openDetail(t.dataset.id);
  if (t.dataset.del && confirm("이 캡처를 삭제할까요?")) { await api("/api/captures?id=" + t.dataset.del, { method: "DELETE" }); toast("삭제됨"); load(); }
  if (t.dataset.delComp && confirm(`'${t.dataset.delComp}'의 모든 캡처를 삭제할까요?`)) { await api("/api/captures?competitor=" + encodeURIComponent(t.dataset.delComp), { method: "DELETE" }); toast("삭제됨"); load(); }
});

(async () => {
  const { authed } = await fetch("/api/login").then((r) => r.json()).catch(() => ({ authed: false }));
  if (!authed) $("#login").classList.add("on"); else load();
})();
