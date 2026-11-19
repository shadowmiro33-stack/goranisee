// 모션 레이어 — 외부 라이브러리에서 "바닐라로 가져올 수 있는 것"만 적용
//  • useAnimations (MIT): Lottie 아이콘을 lottie-web으로 재생 — 내비·헤더·삭제·토스트·진행 표시
//  • React Bits 발상 포팅: CountUp(숫자 카운트업), SpotlightCard(커서 따라오는 하이라이트), AnimatedList(순차 등장)
//  • Sora UI 발상 포팅: 스크롤 반응 등장(IntersectionObserver)
// prefers-reduced-motion 이면 전부 정지 상태로 둡니다. 실패해도 화면은 그대로 동작합니다.
(() => {
  const RM = matchMedia("(prefers-reduced-motion: reduce)");
  const ICON_BASE = "https://useanimations.com/icons/";
  const ICON_MAP = { home: "home", table: "archive", cmp: "star", compare: "visibility", flow: "explore", site: "copy", ads: "radio", adspend: "trending-up", an: "activity", capture: "download-cloud", tool: "link", timeline: "refresh-ccw", prompt: "edit-3" };
  const anims = new WeakMap();
  const hasLottie = () => typeof lottie !== "undefined";

  // 아이콘 하나 붙이기: el 안에 <i class="ua"> 를 만들고 Lottie 로드. 반환: 제어 객체
  function mount(el, id, { size = 18, loop = false, trigger = "hover" } = {}) {
    if (!el || !hasLottie() || el.querySelector(":scope > .ua")) return null;
    const box = document.createElement("i"); box.className = "ua"; box.style.width = box.style.height = size + "px"; el.prepend(box);
    let a; try { a = lottie.loadAnimation({ container: box, renderer: "svg", loop, autoplay: false, path: ICON_BASE + id + ".json", rendererSettings: { preserveAspectRatio: "xMidYMid meet" } }); } catch { return null; }
    a.setSpeed(1.4);
    a.addEventListener("DOMLoaded", () => { a.goToAndStop(0, true); if (loop && !RM.matches) a.play(); });
    a.addEventListener("data_failed", () => box.remove());
    const play = () => { if (RM.matches) return; a.setDirection(1); a.goToAndPlay(0, true); };
    const back = () => { if (RM.matches) return; a.setDirection(-1); a.play(); };
    if (trigger === "hover") { el.addEventListener("mouseenter", play); el.addEventListener("mouseleave", back); el.addEventListener("focus", play); el.addEventListener("blur", back); }
    const ctl = { a, box, play, back, start: () => { if (!RM.matches) { a.loop = true; a.setDirection(1); a.play(); } box.classList.add("on"); }, stop: () => { a.loop = loop; a.goToAndStop(0, true); box.classList.remove("on"); } };
    anims.set(el, ctl); return ctl;
  }
  const ctlOf = (el) => anims.get(el);

  // ── 내비·헤더 아이콘 ──
  function icons() {
    document.querySelectorAll(".tabs button[data-tab]").forEach((b) => { const id = ICON_MAP[b.dataset.tab]; if (id) mount(b, id, { size: 18 }); });
    const refresh = mount(document.getElementById("btn-refresh"), "refresh-v2", { size: 16, trigger: "none" });
    mount(document.getElementById("btn-csv"), "download", { size: 16 });
    mount(document.getElementById("btn-logout"), "lock", { size: 16 });
    mount(document.getElementById("btn-copy"), "copy", { size: 16 });
    mount(document.getElementById("cap-go"), "download-cloud", { size: 18, trigger: "none" });
    // 새로고침 / 수집 버튼: 눌린 동안 회전·반복
    const spinWhile = (btn, ctl) => { if (!btn || !ctl) return; new MutationObserver(() => (btn.disabled ? ctl.start() : ctl.stop())).observe(btn, { attributes: true, attributeFilter: ["disabled"] }); btn.addEventListener("click", () => { ctl.start(); setTimeout(() => { if (!btn.disabled) ctl.stop(); }, 1200); }); };
    spinWhile(document.getElementById("btn-refresh"), refresh);
    spinWhile(document.getElementById("cap-go"), ctlOf(document.getElementById("cap-go")));
  }

  // 동적으로 생기는 삭제 버튼(.danger)·외부 링크에 아이콘
  function dynamicIcons(root) {
    root.querySelectorAll("button.danger:not([data-ua])").forEach((b) => { b.dataset.ua = 1; mount(b, "trash-v2", { size: 14 }); });
    root.querySelectorAll('a[target="_blank"]:not([data-ua])').forEach((a) => { a.dataset.ua = 1; if (a.textContent.trim().length < 40) mount(a, "external-link", { size: 12 }); });
  }

  // ── CountUp: .home-card .big 의 숫자만 0 → 값 (React Bits CountUp 포팅) ──
  function countUp(root) {
    if (RM.matches) return;
    root.querySelectorAll(".home-card .big").forEach((el) => {
      if (el.dataset.counted) return; el.dataset.counted = 1;
      const tn = [...el.childNodes].find((n) => n.nodeType === 3 && /\d/.test(n.textContent)); if (!tn) return;
      const m = tn.textContent.match(/^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/); if (!m) return;
      const target = parseFloat(m[2].replace(/,/g, "")); if (!isFinite(target) || target === 0) return;
      const dec = (m[2].split(".")[1] || "").length, pre = m[1], post = m[3]; const t0 = performance.now(), dur = 900;
      const step = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3); const v = target * e; tn.textContent = pre + (dec ? v.toFixed(dec) : Math.round(v).toLocaleString()) + post; if (p < 1) requestAnimationFrame(step); else tn.textContent = m[0]; };
      requestAnimationFrame(step);
    });
  }

  // ── Spotlight: 카드 위 커서 위치를 CSS 변수로 (React Bits SpotlightCard 포팅) ──
  function spotlight(root) {
    root.querySelectorAll(".home-card:not([data-spot]), .an-panel:not([data-spot]), .site-card:not([data-spot])").forEach((c) => { c.dataset.spot = 1; c.addEventListener("pointermove", (e) => { const r = c.getBoundingClientRect(); c.style.setProperty("--mx", (e.clientX - r.left) + "px"); c.style.setProperty("--my", (e.clientY - r.top) + "px"); }); });
  }

  // ── 순차 등장: 리스트·카드가 화면에 들어올 때 (AnimatedList + 스크롤 반응) ──
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.08 }) : null;
  function reveal(root) {
    if (RM.matches || !io) { root.querySelectorAll(".rv").forEach((x) => x.classList.add("in")); return; }
    root.querySelectorAll(".home-card, .an-panel, .site-card, .tl-item, .cmp-row, .sum-card").forEach((el, i) => { if (el.classList.contains("rv")) return; el.classList.add("rv"); el.style.setProperty("--d", Math.min(i % 12, 8) * 45 + "ms"); io.observe(el); });
  }

  // ── 토스트에 체크 아이콘 ──
  function toastIcon() {
    const t = document.getElementById("toast"); if (!t) return;
    new MutationObserver(() => { if (!t.classList.contains("on")) return; if (!t.querySelector(".ua")) { const c = mount(t, /실패|오류/.test(t.textContent) ? "alert-triangle" : "check-circle", { size: 18, trigger: "none" }); c && setTimeout(() => c.play(), 30); } else { const c = ctlOf(t); const bad = /실패|오류/.test(t.textContent); if (c && c.box.dataset.kind !== (bad ? "bad" : "ok")) { c.box.remove(); anims.delete(t); const n = mount(t, bad ? "alert-triangle" : "check-circle", { size: 18, trigger: "none" }); n && setTimeout(() => n.play(), 30); n && (n.box.dataset.kind = bad ? "bad" : "ok"); } else c && c.play(); } }).observe(t, { attributes: true, attributeFilter: ["class"] });
  }

  function pass(root = document) { try { dynamicIcons(root); countUp(root); spotlight(root); reveal(root); } catch {} }
  document.addEventListener("DOMContentLoaded", () => {
    icons(); toastIcon(); pass();
    const main = document.querySelector("main"); if (!main) return;
    let t; new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => pass(main), 60); }).observe(main, { childList: true, subtree: true });
  });
  window.MOTION = { mount, pass };
})();
