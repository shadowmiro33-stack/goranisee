// ---------- 경쟁사 비교 스코어카드 ----------
// 선택한 경쟁사(2~4개)를 열로 놓고, 분석 항목(소구점·첫 화면 메시지 / CTA 전략 / 추천·광고 영역 / 팝업·배너·플로팅 / 퍼널 흐름 / 광고 채널·추정 집행액 / 강조 방식)을 행으로 비교합니다.
// 경쟁사별 메모(참고할 점·피할 점)는 captures stage="광고데이터", data.type="note" 로 저장합니다.
const APPEAL_RX = {
  "가격·혜택": /할인|쿠폰|무료|적립|캐시백|혜택|특가|최저가|무이자|%|원\b/,
  "신뢰": /리뷰|후기|평점|★|별점|만족도|인증|보증|무사고|진단|검수|누적|회원|거래|보장|환불/,
  "긴급성": /오늘만|마감|남음|남았|한정|선착순|마지막|임박|곧 종료|D-\d|지금|실시간/,
  "편의": /간편|빠른|바로|즉시|1분|3분|비대면|집 앞|배송|탁송|무료 상담|쉽게|클릭 한 번|원스톱/,
};
const OVERLAY_PURPOSE = { app_install: "앱 설치", coupon: "쿠폰·할인", first_purchase: "첫 구매·가입", contact: "상담", search: "검색", cta: "구매·신청", other: "기타" };
let CMP_SEL = null;

function latestPerStage(comp) {
  const m = {};
  ALL.filter((c) => c.competitor === comp && c.stage !== AD_STAGE && !c.data?.captureError).sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at)).forEach((c) => { if (!m[c.stage]) m[c.stage] = c; });
  return m;
}
function classifyAppeals(texts) {
  const out = {}; Object.keys(APPEAL_RX).forEach((k) => (out[k] = []));
  texts.forEach((t) => { for (const [k, rx] of Object.entries(APPEAL_RX)) if (rx.test(t)) { out[k].push(t); break; } });
  return out;
}
function noteOf(comp) { return adRows().find((c) => c.data?.type === "note" && c.data.competitor_name === comp)?.data || {}; }
async function saveNote(comp, keep, avoid) {
  await api("/api/captures", { method: "POST", body: JSON.stringify({ id: "note-" + btoa(unescape(encodeURIComponent(comp))).replace(/[^a-z0-9]/gi, "").slice(0, 24), competitor: "_설정", stage: AD_STAGE, type: "note", competitor_name: comp, keep, avoid, date: new Date().toISOString().slice(0, 10) }) });
}

function competitorProfile(comp) {
  const byStage = latestPerStage(comp);
  const caps = Object.values(byStage);
  const home = byStage["첫 화면(랜딩)"]; const hd = home?.data || {};
  const all = caps.map((c) => c.data || {});
  const appeals = classifyAppeals([...new Set(all.flatMap((d) => (d.benefits || []).map((b) => b.text)))]);
  const ctas = all.flatMap((d) => (d.ctas || []).filter((x) => x.match));
  const fixed = ctas.filter((x) => x.fixed).length, strong = ctas.filter((x) => x.strong).length;
  const ctaTexts = [...new Set(ctas.map((x) => x.text))];
  const sections = all.flatMap((d, i) => (d.sections || []).map((s) => ({ ...s, stage: caps[i].stage })));
  const overlays = all.flatMap((d, i) => (d.overlays || []).map((o) => ({ ...o, stage: caps[i].stage })));
  const purposes = {}; all.forEach((d) => (d.overlaysByTrigger || []).forEach((t) => t.overlays.forEach((o) => { purposes[o.purpose || "other"] = (purposes[o.purpose || "other"] || 0) + 1; })));
  if (!Object.keys(purposes).length) overlays.forEach((o) => { const t = o.text || ""; const k = /앱/.test(t) ? "app_install" : /쿠폰|할인/.test(t) ? "coupon" : /첫|가입/.test(t) ? "first_purchase" : /상담|문의|톡/.test(t) ? "contact" : "other"; purposes[k] = (purposes[k] || 0) + 1; });
  const flows = (typeof flowGroups === "function" ? flowGroups(ALL.filter((c) => c.competitor === comp)) : []);
  const flow = flows[0]?.summary || null;
  const tags = latestTags(comp);
  const est = (typeof estimate === "function" && typeof assumptions === "function") ? estimate(comp, assumptions()) : null;
  const style = hd.style || all.find((d) => d.style)?.style || null;
  return { byStage, caps, hd, appeals, ctaTexts, fixed, strong, ctaCount: ctas.length, sections, overlays, purposes, flow, tags, est, style, stages: Object.keys(byStage) };
}

function renderCompareCard() {
  const el = $("#tab-cmp"); if (!el) return;
  const comps = [...new Set(ALL.filter((c) => c.stage !== AD_STAGE).map((c) => c.competitor))].sort();
  if (comps.length < 1) { el.innerHTML = `<div class="empty">비교할 경쟁사가 없습니다.</div>`; return; }
  if (!CMP_SEL || !CMP_SEL.every((c) => comps.includes(c))) CMP_SEL = comps.slice(0, Math.min(3, comps.length));
  const P = Object.fromEntries(CMP_SEL.map((c) => [c, competitorProfile(c)]));
  const th = CMP_SEL.map((c) => `<th>${esc(c)}<br><span style="font-weight:400;font-size:11px;color:var(--muted)">${P[c].stages.length}단계 수집</span></th>`).join("");
  const row = (label, f, sub) => `<tr><td class="stage">${label}${sub ? `<br><span style="font-weight:400;font-size:11px;color:var(--muted)">${sub}</span>` : ""}</td>${CMP_SEL.map((c) => `<td style="vertical-align:top;font-size:12px">${f(P[c], c)}</td>`).join("")}</tr>`;
  const chips = (arr, cls = "") => arr.length ? arr.slice(0, 8).map((t) => `<span class="chip ${cls}">${esc(String(t).slice(0, 40))}</span>`).join("") : '<span class="none">—</span>';
  const n = (x) => `<b>${x}</b>`;
  const best = (key, fn) => { const vals = CMP_SEL.map((c) => fn(P[c])); const mx = Math.max(...vals.filter((v) => v != null)); return (c) => fn(P[c]) === mx && mx > 0 ? ' style="background:#ecfdf5"' : ""; };

  const table = `<div class="tablewrap"><table class="ads-table cmp-card"><thead><tr><th style="width:170px">항목</th>${th}</tr></thead><tbody>
    <tr class="grp"><td colspan="${CMP_SEL.length + 1}">1. 핵심 소구점 · 첫 화면 메시지</td></tr>
    ${row("첫 화면 헤드라인", (p) => p.hd.headlines?.length ? p.hd.headlines.slice(0, 2).map((h) => `<div>${esc(h.text)}</div>`).join("") : '<span class="none">첫 화면 미수집</span>')}
    ${row("소구점 분류", (p) => Object.entries(p.appeals).map(([k, v]) => `<div><span class="k" style="color:var(--muted)">${k}</span> ${n(v.length)}${v.length ? ` <span style="color:var(--muted)">${esc(v[0].slice(0, 30))}${v.length > 1 ? " 외" : ""}</span>` : ""}</div>`).join(""), "혜택·소구 문구를 가격/신뢰/긴급성/편의로 분류")}
    ${row("주력 소구", (p) => { const e = Object.entries(p.appeals).sort((a, b) => b[1].length - a[1].length)[0]; return e && e[1].length ? `<b>${e[0]}</b> 중심` : '<span class="none">—</span>'; })}
    <tr class="grp"><td colspan="${CMP_SEL.length + 1}">2. CTA 문구 · 위치 · 강조 방식</td></tr>
    ${row("CTA 문구", (p) => chips(p.ctaTexts))}
    ${row("CTA 수 / 고정 / 강조색", (p) => `${n(p.ctaCount)} / ${n(p.fixed)} / ${n(p.strong)}`, "고정 = 스크롤해도 따라오는 CTA")}
    ${row("대표 CTA 강조", (p) => p.style?.cta?.primary ? `"${esc(p.style.cta.primary.text)}" · ${sw(p.style.cta.primary.bg)} 대비 ${p.style.cta.primary.contrast ?? "?"} · ${p.style.cta.primary.height}px · 폭 ${Math.round(p.style.cta.primary.widthRatio * 100)}%${p.style.cta.primary.fixed ? " · 고정" : ""}` : '<span class="none">자동 수집본 없음</span>')}
    ${row("다음 단계로 미는 장치", (p) => p.flow?.path?.length ? p.flow.path.filter((x) => x.via).map((x) => `<div>${FLOW_LABEL[x.stage]} ← "${esc(x.via.text)}"${x.via.fixed ? " (고정)" : ""}</div>`).join("") : '<span class="none">흐름 수집 없음</span>', "퍼널 흐름 수집 기준")}
    <tr class="grp"><td colspan="${CMP_SEL.length + 1}">3. 상품 추천 · 광고 영역 노출</td></tr>
    ${row("추천 영역 (단계 · 명목 · 카드 수)", (p) => p.sections.length ? p.sections.slice(0, 8).map((s) => `<div><span style="color:var(--muted)">${esc(s.stage.replace(/\(.*\)/, ""))}</span> ${esc(s.title)} <span style="color:var(--muted)">${s.cards}개${s.pos ? " · " + esc(s.pos) : ""}</span></div>`).join("") : '<span class="none">—</span>')}
    ${row("추천 영역 수", (p) => n(p.sections.length))}
    <tr class="grp"><td colspan="${CMP_SEL.length + 1}">4. 팝업 · 배너 · 플로팅 역할</td></tr>
    ${row("역할별 개수", (p) => Object.keys(p.purposes).length ? Object.entries(p.purposes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip">${OVERLAY_PURPOSE[k] || k} ${v}</span>`).join("") : '<span class="none">—</span>', "앱 설치 / 쿠폰 / 첫 구매 / 상담 …")}
    ${row("단계별 팝업·플로팅", (p) => p.flow?.path?.length ? p.flow.path.map((x) => `${FLOW_LABEL[x.stage]} ${x.overlays}`).join(" · ") : p.overlays.length ? `${p.overlays.length}개` : '<span class="none">—</span>')}
    <tr class="grp"><td colspan="${CMP_SEL.length + 1}">5. 신청까지 흐름 (마찰)</td></tr>
    ${row("신청까지 탭 수", (p) => p.flow ? (p.flow.reachedInquiry ? n(p.flow.tapsToInquiry) : `<span style="color:#b45309">미도달 (${esc(p.flow.stopReason || "")})</span>`) : '<span class="none">—</span>')}
    ${row("신청 폼 / 로그인", (p) => p.flow ? `${p.flow.inquiryForm ? `${p.flow.inquiryForm.fields}필드 (필수 ${p.flow.inquiryForm.required})` : "폼 없음"} · 로그인 ${p.flow.loginRequired ? "<b style='color:#b45309'>필요</b>" : "불필요"}` : '<span class="none">—</span>')}
    <tr class="grp"><td colspan="${CMP_SEL.length + 1}">6. 광고 채널 · 추정 집행액</td></tr>
    ${row("유료 채널 신호", (p) => { const paid = AD_TECH_LABELS.filter(([k]) => p.tags.has(k)); return paid.length ? paid.map(([, l]) => `<span class="chip paid">${l}</span>`).join("") : '<span class="none">태그 없음</span>'; })}
    ${row("월 추정 집행액", (p) => p.est ? `<b>${KRW(p.est.total.mid)}원</b> <span style="color:var(--muted)">(${KRW(p.est.total.low)}~${KRW(p.est.total.high)})</span>` : '<span class="none">—</span>', "광고비 추정 탭 기준")}
    <tr class="grp"><td colspan="${CMP_SEL.length + 1}">7. 디자인 · 강조 방식</td></tr>
    ${row("주색 / 글꼴", (p) => p.style ? `${(p.style.brand || []).slice(0, 3).map((b) => sw(b.color)).join(" ")}<br>${esc(p.style.fonts?.heading || p.style.fonts?.body || "")} ${p.style.fonts?.baseSize || ""}px · 굵게 ${Math.round((p.style.fonts?.boldShare || 0) * 100)}%` : '<span class="none">—</span>')}
    ${row("첫 화면 고정 요소 비중", (p) => p.style ? `${Math.round((p.style.fixedViewportShare || 0) * 100)}%` : '<span class="none">—</span>', "헤더·하단바·팝업이 첫 화면에서 차지하는 면적")}
    <tr class="grp"><td colspan="${CMP_SEL.length + 1}">8. 우리가 참고할 점 · 피해야 할 점 (직접 작성)</td></tr>
    ${row("참고할 점", (p, c) => `<textarea data-note-keep="${esc(c)}" rows="4" style="width:100%;font-size:12px" placeholder="예: 하단 고정 견적 CTA + 리뷰 수 노출">${esc(noteOf(c).keep || "")}</textarea>`)}
    ${row("피해야 할 점", (p, c) => `<textarea data-note-avoid="${esc(c)}" rows="3" style="width:100%;font-size:12px" placeholder="예: 로드 직후 앱 설치 팝업">${esc(noteOf(c).avoid || "")}</textarea>`)}
    <tr><td></td><td colspan="${CMP_SEL.length}"><button class="primary sm" id="note-save">메모 저장</button> <span style="font-size:12px;color:var(--muted)">AI 분석용 프롬프트에도 포함됩니다</span></td></tr>
  </tbody></table></div>`;

  el.innerHTML = `<div class="cmp-bar"><span>비교 경쟁사 (2~4개)</span>${comps.map((c) => `<label style="display:flex;gap:4px;align-items:center;font-size:13px"><input type="checkbox" data-cmp-sel="${esc(c)}" ${CMP_SEL.includes(c) ? "checked" : ""}> ${esc(c)}</label>`).join("")}<span style="margin-left:auto;font-size:12px;color:var(--muted)">각 경쟁사의 단계별 최신 수집본 기준 · 초록 배경 = 해당 항목 최댓값</span></div>${table}`;
  el.querySelectorAll("[data-cmp-sel]").forEach((cb) => cb.addEventListener("change", () => { const next = [...el.querySelectorAll("[data-cmp-sel]:checked")].map((x) => x.dataset.cmpSel); if (next.length < 1) { cb.checked = true; return; } CMP_SEL = next.slice(0, 4); renderCompareCard(); }));
  $("#note-save").onclick = async () => { for (const c of CMP_SEL) await saveNote(c, el.querySelector(`[data-note-keep="${CSS.escape(c)}"]`).value, el.querySelector(`[data-note-avoid="${CSS.escape(c)}"]`).value); toast("메모 저장"); load(); };
}
const AD_TECH_LABELS = [["google_ads", "구글 광고"], ["meta_pixel", "메타"], ["naver_ads", "네이버 검색광고"], ["naver_gfa", "네이버 GFA"], ["kakao_pixel", "카카오"], ["tiktok", "틱톡"], ["criteo", "Criteo"], ["karrot", "당근"], ["appsflyer", "앱 어트리뷰션"], ["airbridge", "앱 어트리뷰션"], ["adjust", "앱 어트리뷰션"]];
