/* 우리 사이트 분석 스크립트 (goranisee)
 * 설치: <script src="https://goranisee.cardt.workers.dev/track.js" data-site="사이트이름" async></script>
 * 옵션: data-record="1" (세션 레코딩, rrweb 로드), data-endpoint="https://..." (기본: 이 스크립트의 출처)
 * 사용: fa('event','견적_신청',{car:'모델Y'})  /  var v = fa('ab','cta_text',['A','B'])  /  fa('conversion','견적_완료')
 * 수집 항목: 페이지뷰, 체류시간, 유입경로(리퍼러·UTM), 이벤트, 클릭 히트맵(좌표), 스크롤 깊이, 세션 레코딩(옵션), A/B 배정
 */
(function () {
  if (window.__fa) return;
  var S = document.currentScript || [].slice.call(document.scripts).filter(function (s) { return /track\.js/.test(s.src); }).pop();
  var SITE = (S && S.getAttribute("data-site")) || location.hostname;
  var EP = (S && S.getAttribute("data-endpoint")) || (S && S.src.replace(/\/track\.js.*$/, "")) || "";
  var RECORD = S && S.getAttribute("data-record") === "1";
  var ls = function (k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } };
  var ss = function (k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) { return null; } };
  var rid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); };
  var VID = ls("fa_vid") || (ls("fa_vid", rid()), ls("fa_vid"));
  var SID = ss("fa_sid"), last = +ss("fa_last") || 0;
  if (!SID || Date.now() - last > 30 * 60 * 1000) { SID = rid(); ss("fa_sid", SID); }
  ss("fa_last", Date.now());
  var q = new URLSearchParams(location.search);
  var ref = document.referrer || "";
  var refHost = ""; try { refHost = ref ? new URL(ref).hostname : ""; } catch (e) {}
  var source = q.get("utm_source") || q.get("ref") || "";
  if (!source) {
    if (q.get("gclid")) source = "google_ads"; else if (q.get("fbclid")) source = "meta"; else if (q.get("n_media") || q.get("n_query")) source = "naver_ads"; else if (q.get("kakao") || q.get("kcl")) source = "kakao";
    else if (!refHost || refHost === location.hostname) source = "direct";
    else if (/google\./.test(refHost)) source = "google"; else if (/naver\./.test(refHost)) source = "naver"; else if (/daum\.|kakao/.test(refHost)) source = "kakao"; else if (/instagram|facebook|fb\.com/.test(refHost)) source = "meta"; else if (/youtube/.test(refHost)) source = "youtube"; else if (/t\.co|twitter|x\.com/.test(refHost)) source = "x"; else source = refHost;
  }
  var medium = q.get("utm_medium") || "", campaign = q.get("utm_campaign") || "";
  var device = /Mobi|Android|iPhone/i.test(navigator.userAgent) || innerWidth < 768 ? "mobile" : "desktop";
  var queue = [], timer = null;
  function base(type, name, data) { return { site: SITE, visitor_id: VID, session_id: SID, type: type, name: name || null, path: location.pathname, url: location.href.slice(0, 500), referrer: ref.slice(0, 300), source: source, device: device, ts: new Date().toISOString(), data: data || {} }; }
  function flush(sync) {
    if (!queue.length || !EP) return;
    var body = JSON.stringify({ events: queue.splice(0, queue.length) });
    if (sync && navigator.sendBeacon) { navigator.sendBeacon(EP + "/api/track", new Blob([body], { type: "application/json" })); return; }
    try { fetch(EP + "/api/track", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, keepalive: true }).catch(function () {}); } catch (e) {}
  }
  function send(type, name, data, now) { queue.push(base(type, name, data)); ss("fa_last", Date.now()); if (now) flush(); else { clearTimeout(timer); timer = setTimeout(flush, 1500); } }

  // 1) 페이지뷰 (+유입경로)
  var pvId = rid(), t0 = Date.now(), active = 0, lastTick = Date.now(), hidden = document.hidden;
  send("pageview", null, { pv: pvId, title: document.title.slice(0, 120), medium: medium, campaign: campaign, w: innerWidth, h: innerHeight, lang: navigator.language, new_visitor: !ls("fa_seen") });
  ls("fa_seen", "1");
  // 2) 체류시간 (탭이 보일 때만 누적)
  setInterval(function () { var n = Date.now(); if (!document.hidden) active += n - lastTick; lastTick = n; }, 1000);
  document.addEventListener("visibilitychange", function () { lastTick = Date.now(); });
  // 6) 스크롤 깊이
  var maxDepth = 0;
  function depth() { var h = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight) - innerHeight; var d = h <= 0 ? 100 : Math.min(100, Math.round((scrollY / h) * 100)); if (d > maxDepth) maxDepth = d; }
  addEventListener("scroll", depth, { passive: true }); depth();
  // 5) 클릭 히트맵 (페이지 대비 비율 좌표) + 4) 클릭 이벤트(버튼·링크 텍스트)
  addEventListener("click", function (e) {
    var pageH = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, 1);
    var el = e.target.closest ? e.target.closest("a,button,[role=button],input[type=submit]") : null;
    var txt = el ? (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
    send("click", txt || null, { x: +((e.pageX / innerWidth)).toFixed(3), y: +((e.pageY / pageH)).toFixed(3), w: innerWidth, pageH: pageH, tag: el ? el.tagName.toLowerCase() : e.target.tagName.toLowerCase(), href: el && el.href ? String(el.href).slice(0, 200) : undefined });
  }, true);
  // 이탈 시 체류시간·스크롤 깊이 전송
  function leave() { send("leave", null, { pv: pvId, duration_ms: active, total_ms: Date.now() - t0, depth: maxDepth }, false); flush(true); }
  addEventListener("pagehide", leave); addEventListener("beforeunload", leave);
  document.addEventListener("visibilitychange", function () { if (document.hidden) { send("leave", null, { pv: pvId, duration_ms: active, total_ms: Date.now() - t0, depth: maxDepth, partial: true }); flush(true); } });

  // 4) 커스텀 이벤트 / 전환 / 9) A/B 테스트
  window.fa = window.__fa = function (cmd, name, arg) {
    if (cmd === "event") { send("event", name, arg || {}, true); return; }
    if (cmd === "conversion") { send("event", name, Object.assign({ conversion: true }, arg || {}), true); return; }
    if (cmd === "ab") {
      var variants = arg && arg.length ? arg : ["A", "B"]; var key = "fa_ab_" + name; var v = ls(key);
      if (!v || variants.indexOf(v) < 0) { v = variants[Math.floor(Math.random() * variants.length)]; ls(key, v); send("ab", name, { variant: v, assigned: true }, true); } else send("ab", name, { variant: v });
      return v;
    }
  };
  // 7) 세션 레코딩 (옵션): rrweb 로 DOM 변화를 기록해 20초마다 전송. 입력값은 마스킹
  if (RECORD && !ls("fa_norecord")) {
    var sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/rrweb@2.0.0-alpha.17/dist/rrweb.min.js";
    sc.onload = function () {
      var buf = [];
      rrweb.record({ emit: function (ev) { buf.push(ev); }, maskAllInputs: true, sampling: { mousemove: 50, scroll: 150, input: "last" }, recordCanvas: false });
      var ship = function (sync) { if (!buf.length) return; var evs = buf.splice(0, buf.length); queue.push(base("rr", null, { pv: pvId, events: evs })); flush(sync); };
      setInterval(ship, 20000); addEventListener("pagehide", function () { ship(true); });
    };
    document.head.appendChild(sc);
  }
})();
