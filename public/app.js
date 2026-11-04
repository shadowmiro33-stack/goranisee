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
  renderTable(); renderTimeline(); $("#prompt").value = buildPrompt();
}
document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
  ["table", "timeline", "prompt", "tool"].forEach((t) => ($("#tab-" + t).hidden = b.dataset.tab !== t));
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
