// ---------- 홈: 경쟁사 퍼널 비교 어드민의 핵심 지표 9개 (우리 데이터로 계산, 클릭하면 해당 탭으로) ----------
const H_ROWS = () => ALL.filter((c) => c.stage !== "광고데이터");
const H_OK = () => H_ROWS().filter((c) => !c.data?.captureError);
const H_COMPS = () => [...new Set(H_ROWS().map((c) => c.competitor))].sort();
const hLatest = (comp, pred = () => true) => H_OK().filter((c) => c.competitor === comp && pred(c)).sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at))[0];
const hDays = (iso) => Math.floor((Date.now() - new Date(iso)) / 86400e3);
const hRel = (iso) => { const d = hDays(iso); return d <= 0 ? "오늘" : d === 1 ? "어제" : `${d}일 전`; };
const hList = (items) => items.length ? `<ul class="hl">${items.map((s) => `<li>${s}</li>`).join("")}</ul>` : `<div class="none">아직 없음</div>`;

function homeCards() {
  const comps = H_COMPS(), rows = H_ROWS(), ok = H_OK();
  const weekAgo = Date.now() - 7 * 86400e3;

  // 01 수집 현황
  const recent = ok.filter((c) => new Date(c.captured_at) > weekAgo).length;
  const byComp = comps.map((c) => { const l = hLatest(c); return { c, n: ok.filter((x) => x.competitor === c).length, last: l?.captured_at }; });
  const c01 = { tab: "table", t: "수집 현황", en: "Captures", big: `${comps.length}<small>개 사</small>`, sub: `캡처 ${ok.length}건 · 최근 7일 ${recent}건`, body: hList(byComp.map((o) => `<b>${esc(o.c)}</b> ${o.n}건 · <span class="m">${o.last ? hRel(o.last) : "—"}</span>`)) };

  // 02 이번 주 변화 (같은 경쟁사·단계·화면의 직전 캡처 대비)
  const changes = [];
  for (const c of ok.filter((c) => new Date(c.captured_at) > weekAgo)) {
    const prev = ok.find((x) => x !== c && x.competitor === c.competitor && x.stage === c.stage && x.device === c.device && new Date(x.captured_at) < new Date(c.captured_at));
    const d = typeof diffCapture === "function" ? diffCapture(c, prev) : null;
    if (d?.length) changes.push({ comp: c.competitor, stage: c.stage, d, at: c.captured_at });
  }
  const chBy = {}; changes.forEach((x) => (chBy[x.comp] = (chBy[x.comp] || 0) + x.d.length));
  const c02 = { tab: "timeline", t: "이번 주 변화", en: "What changed", big: `${changes.reduce((a, x) => a + x.d.length, 0)}<small>건</small>`, sub: changes.length ? `${Object.keys(chBy).length}개 사에서 감지` : "직전 캡처와 비교할 변화 없음", body: hList(changes.slice(0, 4).map((x) => `<b>${esc(x.comp)}</b> ${esc(x.stage)} · ${x.d.map((k) => `${esc(k.label)}${k.add.length ? ` +${k.add.length}` : ""}${k.del.length ? ` −${k.del.length}` : ""}`).join(", ")}`)) };

  // 03 신청까지 흐름 (탭 수)
  const flows = comps.map((c) => { const l = hLatest(c, (x) => x.data?.flowSummary); return l ? { c, s: l.data.flowSummary } : null; }).filter(Boolean);
  const best = flows.filter((f) => f.s.tapsToInquiry != null).sort((a, b) => a.s.tapsToInquiry - b.s.tapsToInquiry)[0];
  const c03 = { tab: "flow", t: "신청까지 흐름", en: "Taps to inquiry", big: best ? `${best.s.tapsToInquiry}<small>탭 · ${esc(best.c)}</small>` : "—", sub: best ? "가장 짧은 경쟁사" : "흐름 수집을 아직 안 했음", body: hList(flows.map((f) => `<b>${esc(f.c)}</b> ${f.s.reachedInquiry ? `${f.s.tapsToInquiry}탭 · 폼 ${f.s.inquiryForm?.fields ?? "?"}칸${f.s.loginRequired ? " · 로그인 필요" : ""}` : `<span class="m">${esc(f.s.stopReason || "미도달")}</span>`}`)) };

  // 04 첫 화면 CTA (경쟁사별 첫 화면의 대표 CTA)
  const ctas = comps.map((c) => { const l = hLatest(c, (x) => /첫 화면|랜딩/.test(x.stage) && x.data?.ctas?.length); const p = l?.data.ctas.find((k) => k.primary || k.fixed) || l?.data.ctas[0]; return p ? { c, t: p.text, fixed: p.fixed } : null; }).filter(Boolean);
  const c04 = { tab: "cmp", t: "첫 화면 CTA", en: "Primary CTA", big: `${ctas.length}<small>개 사</small>`, sub: `하단 고정 CTA ${ctas.filter((x) => x.fixed).length}개 사`, body: hList(ctas.map((x) => `<b>${esc(x.c)}</b> “${esc(String(x.t).slice(0, 22))}”${x.fixed ? ' <span class="chip">고정</span>' : ""}`)) };

  // 05 팝업·배너 (최신 첫 화면 기준)
  const ovs = comps.map((c) => { const l = hLatest(c, (x) => /첫 화면|랜딩/.test(x.stage)); const o = l?.data?.overlays || []; return { c, n: o.length, kinds: [...new Set(o.map((v) => String(v.text || "").match(/^\[([^\]]*)\]/)?.[1]).filter(Boolean))] }; });
  const c05 = { tab: "table", t: "팝업·배너", en: "Overlays", big: `${ovs.reduce((a, o) => a + o.n, 0)}<small>개</small>`, sub: `첫 화면 기준 · ${ovs.filter((o) => o.n).length}개 사 사용`, body: hList(ovs.map((o) => `<b>${esc(o.c)}</b> ${o.n ? `${o.n}개${o.kinds.length ? ` · ${o.kinds.slice(0, 3).map(esc).join(", ")}` : ""}` : '<span class="m">없음</span>'}`)) };

  // 06 광고 채널
  const ads = comps.map((c) => { const l = hLatest(c, (x) => x.data?.adTech); const ch = l?.data.adTech?.paidChannels || []; return { c, ch }; });
  const allCh = {}; ads.forEach((a) => a.ch.forEach((k) => (allCh[k] = (allCh[k] || 0) + 1)));
  const c06 = { tab: "ads", t: "광고 채널", en: "Paid channels", big: `${Object.keys(allCh).length}<small>개 채널</small>`, sub: Object.entries(allCh).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(" · ") || "태그 감지 없음", body: hList(ads.map((a) => `<b>${esc(a.c)}</b> ${a.ch.length ? a.ch.map((k) => `<span class="chip paid">${esc(k)}</span>`).join("") : '<span class="m">감지 안 됨</span>'}`)) };

  // 07 광고비 추정 (월, 중간값)
  let spend = [];
  try { if (typeof estimate === "function" && typeof assumptions === "function" && typeof adCompetitors === "function") { const A = assumptions(); spend = adCompetitors().map((c) => ({ c, e: estimate(c, A) })).filter((x) => x.e?.total?.mid > 0).sort((a, b) => b.e.total.mid - a.e.total.mid); } } catch {}
  const c07 = { tab: "adspend", t: "광고비 추정", en: "Est. ad spend / month", big: spend.length ? `${KRW(spend[0].e.total.mid)}<small>${esc(spend[0].c)}</small>` : "—", sub: spend.length ? "관측 건수 × 공식 단가 · 중간값" : "광고 관측값을 입력하면 계산됨", body: hList(spend.slice(0, 4).map((x) => `<b>${esc(x.c)}</b> ${KRW(x.e.total.low)}~${KRW(x.e.total.high)} <span class="m">노출 ${NUM(x.e.impressions.mid)}</span>`)) };

  // 08 AI UX 점수
  const scores = comps.map((c) => { const l = hLatest(c, (x) => x.data?.aiScore?.total != null); return l ? { c, s: l.data.aiScore } : null; }).filter(Boolean).sort((a, b) => b.s.total - a.s.total);
  const c08 = { tab: "cmp", t: "AI UX 점수", en: "UX review", big: scores.length ? `${scores[0].s.total}<small>점 · ${esc(scores[0].c)}</small>` : "—", sub: scores.length ? `${scores.length}개 사 검토됨` : "경쟁사 비교 점수 탭에서 검토 실행", body: hList(scores.map((x) => `<b>${esc(x.c)}</b> <span style="color:${scoreColor(x.s.total / 10)}">${x.s.total}점</span> <span class="m">${esc((x.s.issues?.[0]?.issue || x.s.summary || "").slice(0, 40))}</span>`)) };

  // 09 할 일 (재수집 필요·진행 중·대기)
  const bad = rows.filter((c) => c.data?.captureError || /사이트 오류 창이 남아|접근 차단/.test(c.data?.warning || ""));
  const need = bad.filter((c) => !ok.some((x) => x.competitor === c.competitor && x.url === c.url && !/사이트 오류 창이 남아/.test(x.data?.warning || "") && new Date(x.captured_at) > new Date(c.captured_at)));
  const running = (typeof CAP_Q !== "undefined" ? CAP_Q : []).filter((q) => !q.error && !ALL.find((c) => c.id === q.id || c.id.startsWith(q.id + "-")) && Date.now() - q.at < 600000);
  const stale = byComp.filter((o) => o.last && hDays(o.last) >= 14);
  const todo = [...need.slice(0, 3).map((c) => `휴대폰 재수집 · <b>${esc(c.competitor)}</b> ${esc(c.stage)}`), ...running.map((q) => `진행 중 · <b>${esc(q.competitor || "")}</b> ${esc(q.url).slice(0, 36)}`), ...stale.map((o) => `14일 이상 미수집 · <b>${esc(o.c)}</b> (${hRel(o.last)})`)];
  const c09 = { tab: "capture", t: "할 일", en: "To do", big: `${need.length + running.length + stale.length}<small>건</small>`, sub: `재수집 ${need.length} · 진행 중 ${running.length} · 오래됨 ${stale.length}`, body: hList(todo.slice(0, 4)) };

  return [c01, c02, c03, c04, c05, c06, c07, c08, c09];
}

function renderHome() {
  const el = $("#tab-home"); if (!el) return;
  if (!ALL.length) { el.innerHTML = `<div class="empty">아직 수집한 경쟁사가 없습니다. <a data-home-go="capture" style="color:var(--accent);cursor:pointer">URL로 수집</a>에서 시작하세요.</div>`; el.querySelector("[data-home-go]")?.addEventListener("click", (e) => document.querySelector(`.tabs button[data-tab="${e.target.dataset.homeGo}"]`).click()); return; }
  const cards = homeCards();
  const d = typeof AN !== "undefined" ? AN.data : null;
  const ours = d?.pageview?.total ? `<a class="home-ours" data-home-go="an">우리 사이트 최근 ${AN.days}일 · 방문자 <b>${d.pageview.visitors.toLocaleString()}</b> · 세션 <b>${d.pageview.sessions.toLocaleString()}</b> · 전환 <b>${d.source.conversions}</b> · 1위 유입 <b>${esc(d.source.sessions[0]?.k || "—")}</b> →</a>` : `<a class="home-ours dim" data-home-go="an">우리 사이트 방문 데이터는 아직 없음 · 설치 한 줄로 시작 →</a>`;
  el.innerHTML = `<div class="home-head"><div><h2>경쟁사 퍼널 한눈에</h2><div class="t">모바일 캡처 기준 · 경쟁사별 최신 수집으로 계산 · 카드를 누르면 상세 탭으로</div></div>${ours}</div>
  <div class="home-grid">${cards.map((c, i) => `<a class="home-card" data-home-go="${c.tab}"><div class="cap"><span class="n">${String(i + 1).padStart(2, "0")}</span><b>${c.t}</b><span class="en">${c.en}</span></div><div class="big">${c.big}</div><div class="sub">${c.sub}</div>${c.body}</a>`).join("")}</div>`;
  el.querySelectorAll("[data-home-go]").forEach((a) => a.addEventListener("click", () => document.querySelector(`.tabs button[data-tab="${a.dataset.homeGo}"]`).click()));
}
