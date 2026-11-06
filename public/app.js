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
    const comps = [...new Set(ALL.filter((c) => c.stage !== "광고데이터").map((c) => c.competitor))].sort();
    const sel = $("#f-comp");
    const prev = [...sel.selectedOptions].map((o) => o.value);
    const known = [...sel.options].map((o) => o.value);
    // 새로 생긴 경쟁사는 자동으로 선택 (기존 선택은 유지)
    sel.innerHTML = comps.map((c) => `<option ${prev.includes(c) || !prev.length || !known.includes(c) ? "selected" : ""}>${esc(c)}</option>`).join("");
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
    <div class="k">팝업·배너</div><div class="v">${overlays.length ? overlays.map((o) => `[${esc(o.kind)}] ${esc(String(o.text || "").slice(0, 70))}`).join("\n") : '<span class="none">없음</span>'}</div>
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

// ---------- 강조 방식(style) 요약 ----------
const sw = (c) => c ? `<i class="sw" style="background:${esc(c)}"></i>${esc(c)}` : "";
function styleHtml(d) {
  const st = d?.style; if (!st) return "";
  const p = st.cta?.primary;
  return `<div class="sty">
    ${st.brand?.length ? `<span><span class="k">주색</span>${st.brand.map((b) => sw(b.color) + ` ${Math.round(b.share * 100)}%`).join(" ")}</span>` : ""}
    ${p ? `<span><span class="k">대표 CTA</span>${sw(p.bg)} / 글자 ${sw(p.color)} · 대비 ${p.contrast ?? "?"} · ${p.height}px · 폭 ${Math.round(p.widthRatio * 100)}%${p.fixed ? " · 고정" : ""}</span>` : ""}
    <span><span class="k">CTA</span>${st.cta?.count ?? 0}개 · 고정 ${st.cta?.fixedCount ?? 0} · 전폭 ${st.cta?.fullWidthCount ?? 0} · 평균 ${st.cta?.avgHeight ?? "?"}px</span>
    ${st.fonts ? `<span><span class="k">글꼴</span>${esc(st.fonts.heading || st.fonts.body)} ${st.fonts.headingSize ? st.fonts.headingSize + "px" : ""} / 본문 ${esc(st.fonts.body)} ${st.fonts.baseSize}px · 굵게 ${Math.round((st.fonts.boldShare || 0) * 100)}%</span>` : ""}
    <span><span class="k">첫 화면 고정 요소</span>${Math.round((st.fixedViewportShare || 0) * 100)}%</span>
  </div>`;
}
function styleLine(d) {
  const st = d?.style; if (!st) return "";
  const p = st.cta?.primary;
  return [st.brand?.length ? `주색 ${st.brand.map((b) => `${b.color}(${Math.round(b.share * 100)}%)`).join(",")}` : "", p ? `대표CTA "${p.text}" 배경 ${p.bg} 글자 ${p.color} 대비 ${p.contrast} 높이 ${p.height}px 폭 ${Math.round(p.widthRatio * 100)}%${p.fixed ? " 고정" : ""}` : "", `CTA ${st.cta?.count ?? 0}개(고정 ${st.cta?.fixedCount ?? 0}, 전폭 ${st.cta?.fullWidthCount ?? 0}, 평균 ${st.cta?.avgHeight ?? "?"}px)`, st.fonts ? `글꼴 ${st.fonts.heading || st.fonts.body} ${st.fonts.headingSize || ""}/${st.fonts.body} ${st.fonts.baseSize}px 굵게 ${Math.round((st.fonts.boldShare || 0) * 100)}%` : "", `첫화면 고정요소 ${Math.round((st.fixedViewportShare || 0) * 100)}%`].filter(Boolean).join(" · ");
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
  if (d.overlaysByTrigger) d.overlaysByTrigger.forEach((tr) => tr.overlays.forEach((o) => out.push({ t: "pop", x: o.pos ? o.pos.x : 0.85, y: o.pos ? o.pos.y : 0.03, n: `${o.kind} · ${o.purpose} · ${String(o.text || "").slice(0, 50)}`, d: tr.trigger, exact: !!o.pos })));
  else (d.overlays || []).forEach((o) => out.push({ t: "pop", x: 0.85, y: o.kind === "하단바" ? 0.1 : 0.03, n: `${o.kind} · ${String(o.text || "").slice(0, 50)}`, d: o.size }));
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
    ${styleHtml(d)}
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
    const doneAll = ALL.filter((c) => c.id === q.id || c.id.startsWith(q.id + "-"));
    const done = ALL.find((c) => c.id === q.id) || doneAll.find((c) => c.id.endsWith("-inquiry")) || doneAll[0];
    const age = (Date.now() - q.at) / 1000;
    const capErr = done?.data?.captureError;
    const st = done ? (capErr ? ["err", "실패"] : ["ok", "도착"]) : q.error ? ["err", "실패"] : age > 600 ? ["err", "10분 경과 · Actions 확인"] : ["wait", "수집 중…"];
    return `<div class="cap-row"><span class="t">${fmt(new Date(q.at).toISOString())}</span><span class="u" title="${esc(q.url)}">${esc(q.competitor || "")} · ${esc(q.stage)} · ${esc(q.url)}</span><span class="st ${st[0]}">${st[1]}${doneAll.length > 1 ? ` (${doneAll.length})` : ""}</span><span class="t">${esc(q.device)}${q.flow ? " · 흐름" : ""}${q.crawl ? ` · 전체 ${q.max_pages}p` : ""}</span><span>${done ? (capErr ? `<span class="t" title="${esc(capErr)}">${esc(capErr.slice(0, 90))}</span>` : `${q.flow ? `<button class="sm" data-tab-go="flow">퍼널 흐름</button>` : q.crawl ? `<button class="sm" data-tab-go="timeline">이력 보기</button>` : `<button class="sm" data-cmp-open="${done.id}">화면 비교</button>`} <button class="sm" data-id="${done.id}">상세</button>`) : q.error ? `<span class="t" title="${esc(q.error)}">${esc(q.error.slice(0, 60))}</span>` : `<a href="${esc(q.actions || "#")}" target="_blank" rel="noopener" style="font-size:12px;color:var(--accent)">진행 보기</a>`} <button class="sm danger" data-q-del="${esc(q.id)}" title="요청 내역과 도착한 캡처 삭제">삭제</button></span></div>`;
  }).join("");
  el.querySelectorAll("[data-tab-go]").forEach((b) => b.addEventListener("click", () => document.querySelector(`.tabs button[data-tab="${b.dataset.tabGo}"]`).click()));
  el.querySelectorAll("[data-q-del]").forEach((b) => b.addEventListener("click", async () => {
    const qid = b.dataset.qDel; const hits = ALL.filter((c) => c.id === qid || c.id.startsWith(qid + "-"));
    if (!confirm(hits.length ? `요청 내역과 도착한 캡처 ${hits.length}건을 삭제할까요?` : "요청 내역에서 지울까요?")) return;
    for (const c of hits) { try { await api("/api/captures?id=" + c.id, { method: "DELETE" }); } catch {} }
    CAP_Q = CAP_Q.filter((q) => q.id !== qid); saveQ(); toast("삭제됨"); load();
  }));
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
    const pending = CAP_Q.filter((q) => !q.error && !ALL.find((c) => c.id === q.id || c.id.startsWith(q.id + "-")) && Date.now() - q.at < 600000);
    if (!pending.length) { clearInterval(capPoll); capPoll = null; return; }
    try { ALL = await api("/api/captures"); } catch { return; }
    const arrived = pending.filter((q) => ALL.find((c) => c.id === q.id || c.id.startsWith(q.id + "-")));
    if (arrived.length) { toast(`수집 도착: ${arrived.map((q) => q.competitor || q.url).join(", ")}`); render(); }
    else renderCaptureQueue();
  }, 15000);
}
$("#cap-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = { url: $("#cap-url").value.trim(), competitor: $("#cap-comp").value.trim(), stage: $("#cap-stage").value, device: $("#cap-device").value === "둘 다" ? "둘다" : $("#cap-device").value, flow: $("#cap-flow").checked, crawl: $("#cap-crawl").checked, max_pages: +$("#cap-max").value || 30 };
  $("#cap-go").disabled = true;
  try {
    const r = await api("/api/capture-request", { method: "POST", body: JSON.stringify(body) });
    CAP_Q.unshift({ id: r.id, at: Date.now(), ...body, actions: r.actions_url }); saveQ();
    toast("GitHub Actions에 수집을 요청했습니다. 1~2분 뒤 도착합니다."); $("#cap-url").value = "";
    renderCaptureQueue(); startCapPoll();
  } catch (err) { toast("요청 실패: " + err.message); CAP_Q.unshift({ id: "x" + Date.now(), at: Date.now(), ...body, error: err.message }); saveQ(); renderCaptureQueue(); }
  finally { $("#cap-go").disabled = false; }
});


// ---------- 퍼널 흐름 (첫 화면 → 리스트 → 상세 → 신청, 경쟁사별 선형 비교) ----------
const FLOW_STAGES = ["home", "list", "detail", "inquiry"];
const FLOW_LABEL = { home: "첫 화면", list: "리스트", detail: "상세", inquiry: "신청" };
function flowGroups(rows) {
  const g = {};
  rows.filter((c) => c.data?.flow?.id).forEach((c) => { const id = c.data.flow.id; (g[id] = g[id] || { id, competitor: c.competitor, device: c.device, at: c.captured_at, steps: {} }); g[id].steps[c.data.flow.sourceStage || c.data.sourceStage || c.data.flow.stage || stageKeyOf(c)] = c; if (c.data.flowSummary) g[id].summary = c.data.flowSummary; if (new Date(c.captured_at) > new Date(g[id].at)) g[id].at = c.captured_at; });
  return Object.values(g).sort((a, b) => new Date(b.at) - new Date(a.at));
}
function stageKeyOf(c) { const k = c.data?.sourceStage; if (k) return k; return ({ "첫 화면(랜딩)": "home", "카테고리/상품 목록": "list", "상품 상세": "detail", "결제": "inquiry", "장바구니": "inquiry" })[c.stage] || "home"; }
function renderFlow() {
  const el = $("#tab-flow");
  const groups = flowGroups(ALL.filter((c) => !c.data?.captureError || c.data?.flowSummary));
  if (!groups.length) { el.innerHTML = `<div class="empty">아직 흐름 수집이 없습니다. <b>URL로 수집</b> 탭에서 "신청까지 흐름 따라가기"를 켜고 경쟁사 첫 화면 주소를 넣어 보세요. 매일 자동 수집 대상(엔카·케이카)은 다음 실행부터 여기 쌓입니다.</div>`; return; }
  // 경쟁사별 최신 흐름 1개씩 + 이전 흐름 선택
  const byComp = {}; groups.forEach((g) => { (byComp[g.competitor] = byComp[g.competitor] || []).push(g); });
  const sel = window.__flowSel || {};
  const cmpRows = Object.entries(byComp).map(([comp, list]) => {
    const g = list.find((x) => x.id === sel[comp]) || list[0];
    const sm = g.summary || {};
    const strip = FLOW_STAGES.map((k, i) => {
      const c = g.steps[k]; const d = c?.data || {};
      const via = c?.data?.flow?.via;
      const arrow = i === 0 ? "" : `<div class="flow-arrow"><b>→</b>${via ? `<span class="via" title="${esc(via.text)}">${esc(via.text)}</span><span>${via.kind === "click" ? "버튼" : "링크"}${via.fixed ? "·고정" : ""}</span>` : `<span>${c ? "" : "미도달"}</span>`}</div>`;
      const thumb = c ? `<div class="flow-thumb"><span class="st">${i + 1}. ${FLOW_LABEL[k]}</span><img data-cmp-shot="${c.id}" alt=""><div class="none">불러오는 중…</div></div>` : `<div class="flow-thumb"><span class="st">${i + 1}. ${FLOW_LABEL[k]}</span><div class="none">${sm.stoppedAt && FLOW_STAGES.indexOf(sm.stoppedAt) < i ? "도달 못함" : "수집 없음"}</div></div>`;
      const ov = d.overlays?.length || 0, ctas = d.ctas?.length || 0, ben = d.benefits?.length || 0;
      const kv = c ? `<div class="flow-kv"><b>${esc(d.headlines?.[0]?.text || c.title || "").slice(0, 40)}</b><br>CTA ${ctas} · 팝업/플로팅 ${ov} · 소구 문구 ${ben}${d.style?.cta?.primary ? `<br>대표 CTA "${esc(d.style.cta.primary.text)}"${d.style.cta.primary.fixed ? " (고정)" : ""}` : ""}${k === "inquiry" && sm.inquiryForm ? `<br>입력 ${sm.inquiryForm.fields}필드 (필수 ${sm.inquiryForm.required})${sm.inquiryForm.submit ? ` → "${esc(sm.inquiryForm.submit)}"` : ""}${sm.inquiryForm.stepIndicator ? ` · ${esc(sm.inquiryForm.stepIndicator)}` : ""}` : ""}<br><button class="sm" data-id="${c.id}" style="margin-top:4px">상세</button></div>` : "";
      return arrow + `<div class="flow-step">${thumb}${kv}</div>`;
    }).join("");
    const friction = [];
    if (sm.loginRequired) friction.push("신청 전 로그인 요구");
    if (sm.inquiryForm && sm.inquiryForm.required >= 4) friction.push(`필수 입력 ${sm.inquiryForm.required}개`);
    if (sm.inquiryForm?.stepIndicator) friction.push(`다단계 폼 (${sm.inquiryForm.stepIndicator})`);
    (sm.path || []).forEach((p) => { if (p.overlays >= 3) friction.push(`${FLOW_LABEL[p.stage] || p.stage}에 팝업/플로팅 ${p.overlays}개`); });
    if (sm.stopReason) friction.push(`중단: ${sm.stopReason}`);
    const pushers = (sm.path || []).filter((p) => p.via).map((p) => `${FLOW_LABEL[p.stage]} 진입 ← "${p.via.text}"${p.via.fixed ? " (하단 고정)" : ""}`);
    return `<div class="flow-comp">
      <h2>${esc(comp)} <span class="m">${fmt(g.at)} · ${esc(g.device || "")}</span>
        ${list.length > 1 ? `<select data-flow-sel="${esc(comp)}" style="margin-left:auto;font-size:12px">${list.map((x) => `<option value="${x.id}" ${x.id === g.id ? "selected" : ""}>${fmt(x.at)}${x.summary?.reachedInquiry ? " · 신청 도달" : ""}</option>`).join("")}</select>` : ""}</h2>
      <div class="flow-strip">${strip}</div>
      <div class="flow-sum">
        <div>신청까지 탭 수<b>${sm.reachedInquiry ? sm.tapsToInquiry : "—"}</b></div>
        <div>도달 단계<b style="font-size:14px">${(sm.stagesReached || []).map((k) => FLOW_LABEL[k] || k).join(" → ") || "—"}</b></div>
        <div>신청 폼 입력<b>${sm.inquiryForm ? `${sm.inquiryForm.fields} <span style="font-size:12px;color:var(--muted)">(필수 ${sm.inquiryForm.required})</span>` : "—"}</b></div>
        <div>로그인 필요<b>${sm.loginRequired ? "예" : "아니오"}</b></div>
        <div>단계별 팝업/플로팅<b style="font-size:14px">${(sm.path || []).map((p) => p.overlays).join(" / ") || "—"}</b></div>
      </div>
      ${pushers.length ? `<div class="flow-kv" style="margin-top:8px"><b>다음 단계로 미는 장치</b><br>${pushers.map(esc).join("<br>")}</div>` : ""}
      ${friction.length ? `<div class="flow-stop">마찰 포인트: ${friction.map(esc).join(" · ")}</div>` : ""}
    </div>`;
  }).join("");
  // 요약 비교표
  const comps = Object.keys(byComp);
  const row = (label, f) => `<tr><td class="stage">${label}</td>${comps.map((c) => { const g = (byComp[c].find((x) => x.id === sel[c]) || byComp[c][0]); return `<td>${f(g.summary || {}, g)}</td>`; }).join("")}</tr>`;
  const table = `<div class="tablewrap" style="margin-top:4px"><table class="flow-table"><thead><tr><th>항목</th>${comps.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>
    ${row("신청까지 탭 수", (s) => s.reachedInquiry ? s.tapsToInquiry : "미도달")}
    ${row("도달 단계", (s) => (s.stagesReached || []).map((k) => FLOW_LABEL[k] || k).join(" → "))}
    ${row("진입 장치(순서)", (s) => (s.path || []).filter((p) => p.via).map((p) => `"${esc(p.via.text)}"${p.via.fixed ? "·고정" : ""}`).join(" → ") || "—")}
    ${row("신청 폼", (s) => s.inquiryForm ? `${s.inquiryForm.fields}필드 / 필수 ${s.inquiryForm.required}${s.inquiryForm.submit ? ` / "${esc(s.inquiryForm.submit)}"` : ""}` : "—")}
    ${row("로그인 요구", (s) => s.loginRequired ? "예" : "아니오")}
    ${row("단계별 팝업/플로팅", (s) => (s.path || []).map((p) => `${FLOW_LABEL[p.stage]} ${p.overlays}`).join(", ") || "—")}
    ${row("단계별 긴급성/신뢰/혜택 문구", (s) => (s.path || []).map((p) => `${FLOW_LABEL[p.stage]} ${p.urgency}/${p.trust}/${p.price}`).join(", ") || "—")}
  </tbody></table></div>`;
  el.innerHTML = `<div class="cmp-note" style="margin:0 0 10px">첫 화면에서 시작해 리스트 → 상세 → 신청 버튼까지 실제로 따라간 결과입니다. 화살표 위 문구가 각 단계로 넘어갈 때 누른 링크/버튼입니다.</div>${cmpRows}<h3 style="font-size:14px;margin:14px 0 6px">경쟁사 흐름 요약 비교</h3>${table}`;
  el.querySelectorAll("[data-flow-sel]").forEach((s) => s.addEventListener("change", () => { window.__flowSel = { ...(window.__flowSel || {}), [s.dataset.flowSel]: s.value }; renderFlow(); }));
  el.querySelectorAll("img[data-cmp-shot]").forEach(async (img) => { const src = await shotOf(img.dataset.cmpShot); const box = img.closest(".flow-thumb"); if (src) { img.src = src; box.querySelector(".none")?.remove(); } else box.querySelector(".none").textContent = "스크린샷 없음"; });
}

// ---------- 광고 채널 (트래킹 태그·픽셀로 추정) ----------
function renderAds() {
  const el = $("#tab-ads");
  const rows = ALL.filter((c) => c.data?.adTech);
  if (!rows.length) { el.innerHTML = `<div class="empty">광고 채널 신호가 있는 수집이 아직 없습니다. 자동 수집(URL로 수집·매일 수집)에서 페이지가 부르는 광고 태그·픽셀을 읽어 채널을 추정합니다. 확장·즐겨찾기 수집본에는 이 정보가 없습니다.</div>`; return; }
  const comps = [...new Set(rows.map((c) => c.competitor))].sort();
  // 경쟁사별: 최신 수집본들(최근 7일)의 태그 합집합, 첫 발견일·최근 발견일
  const info = {};
  comps.forEach((comp) => {
    const list = rows.filter((c) => c.competitor === comp).sort((a, b) => new Date(a.captured_at) - new Date(b.captured_at));
    const tags = {};
    list.forEach((c) => (c.data.adTech.tags || []).forEach((t) => { const x = (tags[t.key] = tags[t.key] || { ...t, first: c.captured_at, last: c.captured_at, n: 0 }); x.last = c.captured_at; x.n++; }));
    const latest = list[list.length - 1];
    const latestKeys = new Set((latest.data.adTech.tags || []).map((t) => t.key));
    Object.values(tags).forEach((t) => (t.active = latestKeys.has(t.key)));
    info[comp] = { tags, latest, ids: latest.data.adTech.ids || {}, hosts: latest.data.adTech.thirdPartyHosts || [] };
  });
  const allKeys = [...new Set(Object.values(info).flatMap((i) => Object.values(i.tags).map((t) => t.key)))];
  const meta = (k) => Object.values(info).flatMap((i) => Object.values(i.tags)).find((t) => t.key === k);
  const paid = allKeys.filter((k) => !meta(k).channel.startsWith("(")), other = allKeys.filter((k) => meta(k).channel.startsWith("("));
  const trow = (k) => { const m = meta(k); return `<tr><td class="stage">${esc(m.label)}<br><span style="font-weight:400;color:var(--muted);font-size:11px">${esc(m.channel)}</span></td>${comps.map((c) => { const t = info[c].tags[k]; return t ? `<td class="${t.active ? "on" : "off"}">${t.active ? "운영 중" : "최근 미검출"}<br><span style="font-weight:400;font-size:11px;color:var(--muted)">최초 ${fmt(t.first).slice(0, 5)} · 최근 ${fmt(t.last).slice(0, 5)}</span></td>` : `<td class="off">—</td>`; }).join("")}</tr>`; };
  el.innerHTML = `<div class="cmp-note" style="margin:0 0 10px">경쟁사 페이지가 호출하는 광고 전환 태그·픽셀로 <b>어떤 유료 채널에 광고를 집행 중인지</b> 추정합니다 (태그가 있으면 그 채널에서 전환을 측정하고 있다는 뜻). 새 태그가 생기면 새 채널 시작, 사라지면 중단 신호로 봅니다. 광고 소재 자체는 Meta 광고 라이브러리·Google 광고 투명성 센터에서 확인할 수 있습니다.</div>
    <div class="tablewrap"><table class="ads-table"><thead><tr><th>유료 광고 채널 신호</th>${comps.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${paid.map(trow).join("") || `<tr><td colspan="${comps.length + 1}" style="color:var(--muted)">검출된 유료 채널 태그 없음</td></tr>`}</tbody></table></div>
    <h3 style="font-size:14px;margin:14px 0 6px">분석·CRM·상담 도구</h3>
    <div class="tablewrap"><table class="ads-table"><thead><tr><th>도구</th>${comps.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${other.map(trow).join("") || `<tr><td colspan="${comps.length + 1}" style="color:var(--muted)">없음</td></tr>`}</tbody></table></div>
    <h3 style="font-size:14px;margin:14px 0 6px">광고 소재 확인 링크</h3>
    <div class="flow-kv">${comps.map((c) => `<b>${esc(c)}</b>: <a href="https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=KR&q=${encodeURIComponent(c)}&search_type=keyword_unordered" target="_blank" rel="noopener">Meta 광고 라이브러리</a> · <a href="https://adstransparency.google.com/?region=KR&query=${encodeURIComponent(c)}" target="_blank" rel="noopener">Google 광고 투명성 센터</a>${info[c].ids.metaPixel ? ` · Meta 픽셀 ID ${esc(info[c].ids.metaPixel.join(","))}` : ""}${info[c].ids.googleAds ? ` · Google Ads ${esc(info[c].ids.googleAds.join(","))}` : ""}${info[c].ids.naverWcs ? ` · 네이버 wcs ${esc(info[c].ids.naverWcs.join(","))}` : ""}`).join("<br>")}</div>
    <details style="margin-top:12px"><summary style="font-size:12px;color:var(--muted);cursor:pointer">제3자 호출 도메인 전체 보기</summary>${comps.map((c) => `<div class="flow-kv" style="margin-top:6px"><b>${esc(c)}</b> ${info[c].hosts.map((h) => `<span class="chip">${esc(h)}</span>`).join("")}</div>`).join("")}</details>`;
}

// ---------- 변화 추적: 같은 경쟁사·단계·화면의 직전 수집과 비교 ----------
function diffCapture(cur, prev) {
  if (!prev) return null;
  const a = cur.data || {}, b = prev.data || {};
  const set = (arr, f) => new Set((arr || []).map(f).filter(Boolean));
  const cmp = (label, A, B) => { const add = [...A].filter((x) => !B.has(x)), del = [...B].filter((x) => !A.has(x)); return add.length || del.length ? { label, add, del } : null; };
  const out = [
    cmp("헤드라인", set(a.headlines, (h) => h.text), set(b.headlines, (h) => h.text)),
    cmp("CTA", set(a.ctas, (c) => c.text), set(b.ctas, (c) => c.text)),
    cmp("혜택·소구 문구", set(a.benefits, (x) => x.text), set(b.benefits, (x) => x.text)),
    cmp("팝업·배너", set(a.overlays, (o) => String(o.text || "").replace(/^\[[^\]]*\]\s*/, "").slice(0, 60)), set(b.overlays, (o) => String(o.text || "").replace(/^\[[^\]]*\]\s*/, "").slice(0, 60))),
    cmp("추천·광고 섹션", set(a.sections, (x) => x.title), set(b.sections, (x) => x.title)),
    cmp("노출 가격", set(a.prices, (x) => x), set(b.prices, (x) => x)),
    cmp("광고 태그", set(a.adTech?.tags, (t) => t.label), set(b.adTech?.tags, (t) => t.label)),
  ].filter(Boolean);
  return out;
}
function diffHtml(cur, prev) {
  const d = diffCapture(cur, prev);
  if (d === null) return `<div class="diff same">첫 수집 (비교 대상 없음)</div>`;
  if (!d.length) return `<div class="diff same">직전 수집(${fmt(prev.captured_at)})과 변화 없음</div>`;
  return `<div class="diff"><span class="k">직전 ${fmt(prev.captured_at)} 대비</span>${d.map((x) => `<div><span class="k">${x.label}</span>${x.add.map((t) => `<span class="add">+ ${esc(t)}</span>`).join(" ")} ${x.del.map((t) => `<span class="del">${esc(t)}</span>`).join(" ")}</div>`).join("")}</div>`;
}

// ---------- 타임라인 ----------
function renderTimeline() {
  const dev = $("#f-device").value, comps0 = [...$("#f-comp").selectedOptions].map((o) => o.value);
  const rows = ALL.filter((c) => c.stage !== "광고데이터" && (!dev || c.device === dev) && (!comps0.length || comps0.includes(c.competitor)));
  const el = $("#tab-timeline");
  if (!rows.length) { el.innerHTML = `<div class="empty">수집 이력이 없습니다.</div>`; return; }
  const comps = [...new Set(rows.map((c) => c.competitor))].sort();
  const changedOnly = window.__tlChanged || false;
  el.innerHTML = `<div class="cmp-note" style="margin:0 0 8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">같은 경쟁사·단계·화면의 직전 수집과 비교해 바뀐 문구·CTA·팝업·가격·광고 태그를 표시합니다. 매일 06:23에 자동 수집되므로 일 단위 변화가 쌓입니다. <label style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="tl-changed" ${changedOnly ? "checked" : ""}> 변화 있는 것만</label></div>` + comps.map((comp) => {
    const list = rows.filter((r) => r.competitor === comp).sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));
    const items = list.map((c) => {
      const prev = list.find((x) => x !== c && x.stage === c.stage && x.device === c.device && !x.data?.captureError && new Date(x.captured_at) < new Date(c.captured_at));
      const d = c.data?.captureError ? null : diffCapture(c, prev);
      if (changedOnly && (!d || !d.length)) return "";
      return `<div class="tl-row"><span class="t">${fmt(c.captured_at)}</span><span class="s">${esc(c.stage)}</span><span class="d">${esc(c.device || "")}</span><span class="h" title="${esc(c.url)}">${c.data?.captureError ? `<span style="color:var(--danger)">실패: ${esc(c.data.captureError.slice(0, 60))}</span>` : esc(c.data?.headlines?.[0]?.text || c.title || c.url || "")}${c.data?.flow ? ` <span class="chip">흐름 ${c.data.flow.step}단계</span>` : ""}</span><span><button class="sm" data-id="${c.id}">상세</button> <button class="sm danger" data-del="${c.id}">삭제</button></span></div>${c.data?.captureError ? "" : diffHtml(c, prev)}`;
    }).join("");
    if (!items) return "";
    return `<div class="tl-comp"><h2>${esc(comp)} <button class="sm danger" data-del-comp="${esc(comp)}" style="float:right">경쟁사 전체 삭제</button></h2>${items}</div>`;
  }).join("") || `<div class="empty">변화가 감지된 수집이 없습니다.</div>`;
  $("#tl-changed")?.addEventListener("change", (e) => { window.__tlChanged = e.target.checked; renderTimeline(); });
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
    ${d.style ? `<h3>강조 방식 (디자인 근거)</h3>${styleHtml(d)}` : ""}
    ${d.flow ? `<h3>퍼널 흐름</h3><div>${d.flow.step}단계 · 첫 화면에서 ${d.flow.tapsFromHome}탭${d.flow.via ? ` · 진입: "${esc(d.flow.via.text)}" (${d.flow.via.kind === "click" ? "버튼" : "링크"}${d.flow.via.fixed ? ", 고정" : ""})` : ""}${d.flow.loginWall ? " · 로그인 벽" : ""}</div>` : ""}
    ${d.formsDetail?.forms?.length ? `<h3>입력 폼 (마찰)</h3>${li(d.formsDetail.forms, (f) => `${f.fields}필드 (필수 ${f.required}) · ${esc((f.labels || []).join(", "))}${f.submit ? ` → <b>${esc(f.submit)}</b>` : ""}`)}${d.formsDetail.stepIndicator ? `<div style="color:var(--muted)">단계 표시: ${esc(d.formsDetail.stepIndicator)}</div>` : ""}` : ""}
    ${d.adTech ? `<h3>광고·마케팅 태그</h3><div>${(d.adTech.tags || []).map((t) => `<span class="chip ${t.channel.startsWith("(") ? "" : "paid"}" title="${esc(t.channel)}">${esc(t.label)}</span>`).join("") || '<span class="none">없음</span>'}</div>` : ""}
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
      if (d.style) lines.push(`- 강조 방식: ${styleLine(d)}`);
      if (d.flow?.via) lines.push(`- 이 단계 진입 장치: "${d.flow.via.text}" (${d.flow.via.kind === "click" ? "버튼" : "링크"}${d.flow.via.fixed ? ", 고정" : ""}), 첫 화면에서 ${d.flow.tapsFromHome}탭`);
      if (d.flowSummary) lines.push(`- 신청까지 흐름 요약: ${(d.flowSummary.stagesReached || []).join("→")} · 탭 ${d.flowSummary.tapsToInquiry ?? "미도달"} · 폼 ${d.flowSummary.inquiryForm ? `${d.flowSummary.inquiryForm.fields}필드(필수 ${d.flowSummary.inquiryForm.required})` : "없음"} · 로그인 ${d.flowSummary.loginRequired ? "필요" : "불필요"}`);
      if (d.adTech?.paidChannels?.length) lines.push(`- 광고 채널 신호: ${d.adTech.paidChannels.join(", ")}`);
      if (typeof noteOf === "function") { const nt = noteOf(c.competitor); if (nt.keep || nt.avoid) lines.push(`- 분석자 메모: 참고 "${nt.keep || ""}" / 회피 "${nt.avoid || ""}"`); }
      if (d.benefits?.length) lines.push(`- 혜택/소구 문구: ${d.benefits.slice(0, 10).map((b) => b.text).join(" | ")}`);
      if (d.overlays?.length) lines.push(`- 팝업/배너: ${d.overlays.map((o) => `[${o.kind}] ${String(o.text || "").slice(0, 80)}`).join(" | ")}`);
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
  renderTable(); renderCompare(); renderFlow(); renderAds(); if (typeof renderAdspend === "function") renderAdspend(); if (typeof renderCompareCard === "function") renderCompareCard(); renderCaptureQueue(); renderTimeline(); $("#prompt").value = buildPrompt();
  if (CAP_Q.some((q) => !q.error && !ALL.find((c) => c.id === q.id || c.id.startsWith(q.id + "-")) && Date.now() - q.at < 600000)) startCapPoll();
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  ["table", "cmp", "compare", "flow", "ads", "adspend", "capture", "timeline", "prompt", "tool"].forEach((t) => ($("#tab-" + t).hidden = b.dataset.tab !== t));
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
