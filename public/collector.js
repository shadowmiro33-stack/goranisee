// 북마클릿 본체. 어드민의 "수집 버튼" 탭이 서버 주소와 비밀번호를 채워 javascript: 링크로 만듭니다.
// 확장 프로그램 extract.js 와 같은 항목을 수집하되, 스크린샷은 없습니다.
(function () {
  var SERVER = "__SERVER__", PASSWORD = "__PASSWORD__";
  var STAGES = ["첫 화면(랜딩)", "카테고리/상품 목록", "상품 상세", "장바구니", "결제", "회원가입/로그인", "이벤트/기획전", "기타"];
  if (document.getElementById("__fc_panel")) { document.getElementById("__fc_panel").remove(); return; }

  var vw = innerWidth, vh = innerHeight;
  var clean = function (s) { return (s || "").replace(/\s+/g, " ").trim(); };
  var uniq = function (a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); };
  function isVisible(el) { if (!el || !(el instanceof Element)) return false; var st = getComputedStyle(el); if (st.display === "none" || st.visibility === "hidden" || +st.opacity === 0) return false; var r = el.getBoundingClientRect(); return r.width > 2 && r.height > 2; }
  function pos(el) { var r = el.getBoundingClientRect(), y = r.top + scrollY; var band = y < vh ? "첫화면" : y < vh * 2 ? "스크롤1" : y < vh * 3 ? "스크롤2" : "하단"; var cx = r.left + r.width / 2; return band + "/" + (cx < vw / 3 ? "좌" : cx > vw * 2 / 3 ? "우" : "중앙"); }
  function isFixed(el) { for (var e = el; e && e !== document.body; e = e.parentElement) { var p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") return true; } return false; }
  function q(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }

  function extract() {
    var meta = function (n) { var m = document.querySelector('meta[name="' + n + '"], meta[property="' + n + '"]'); return m ? m.getAttribute("content") || "" : ""; };
    var headlines = q("h1, h2, h3").filter(function (h) { return isVisible(h) && !h.closest("#__fc_panel"); }).map(function (h) { return { tag: h.tagName.toLowerCase(), text: clean(h.innerText).slice(0, 120), pos: pos(h) }; }).filter(function (h) { return h.text.length > 1; }).slice(0, 25);
    var ctaKw = /구매|장바구니|담기|주문|결제|가입|시작|신청|무료|체험|다운로드|상담|문의|받기|확인|보기|알아보기|쿠폰|예약|구독|로그인|더보기|buy|add to cart|cart|checkout|sign up|get started|start|try|free|subscribe|shop|order|book|learn more/i;
    var ctas = uniq(q('button, [role="button"], input[type="submit"], a[class*="btn"], a[class*="button"], a[class*="cta"], a[class*="Btn"]').filter(function (el) { return isVisible(el) && !el.closest("#__fc_panel"); }).map(function (el) {
      var text = clean(el.innerText || el.value || el.getAttribute("aria-label")); if (!text || text.length > 40) return null;
      var r = el.getBoundingClientRect(), bg = getComputedStyle(el).backgroundColor;
      return JSON.stringify({ text: text, pos: pos(el), fixed: isFixed(el), strong: !!bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent", size: Math.round(r.width) + "x" + Math.round(r.height), match: ctaKw.test(text) });
    }).filter(Boolean)).map(function (s) { return JSON.parse(s); }).sort(function (a, b) { return (b.match - a.match) || (b.strong - a.strong); }).slice(0, 30);
    var benefitRe = /(\d{1,2}\s?%\s?(할인|OFF)|무료\s?배송|쿠폰|적립|포인트|1\+1|한정|오늘만|마감|선착순|특가|세일|SALE|최저가|당일|새벽\s?배송|무이자|첫\s?구매|신규\s?회원|후기|리뷰|평점|★|별점|베스트|인기|추천|보장|환불|무료\s?체험|첫\s?달\s?무료|free shipping|coupon|limited|best seller|rating|review)/i;
    var benefits = [], w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode()) && benefits.length < 40) { var p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || p.closest("#__fc_panel")) continue; var t = clean(n.nodeValue); if (t.length >= 4 && t.length <= 140 && benefitRe.test(t) && isVisible(p)) benefits.push(JSON.stringify({ text: t, pos: pos(p) })); }
    benefits = uniq(benefits).map(function (s) { return JSON.parse(s); });
    var ovs = q("body *").filter(function (el) { if (el.closest("#__fc_panel") || !isVisible(el)) return false; var st = getComputedStyle(el); if (st.position !== "fixed" && st.position !== "sticky" && el.tagName !== "DIALOG" && !/modal|popup|layer|banner|toast|floating/i.test(el.className + " " + el.id)) return false; var r = el.getBoundingClientRect(); return r.width >= 120 && r.height >= 40; });
    var overlays = ovs.filter(function (el) { return !ovs.some(function (o) { return o !== el && o.contains(el); }); }).map(function (el) { var r = el.getBoundingClientRect(); return { kind: /modal|popup|dialog|layer/i.test(el.className + " " + el.id + " " + el.tagName) ? "팝업" : r.top < 10 ? "상단바" : r.bottom > vh - 10 ? "하단바" : "플로팅", text: clean(el.innerText).slice(0, 160), size: Math.round(r.width) + "x" + Math.round(r.height) }; }).filter(function (o) { return o.text.length > 0; }).slice(0, 10);
    var secRe = /추천|인기|BEST|베스트|함께|관련|많이|지금|요즘|핫|신상|NEW|기획전|이벤트|광고|AD|sponsored|recommend|popular|trending|you may|related|also/i, priceRe = /[\d,]{4,}\s?원|₩\s?[\d,]+|\$\s?[\d,.]+/g, sections = [];
    q("h1, h2, h3, h4, [class*='title'], [class*='Title']").some(function (h) {
      var t = clean(h.innerText).slice(0, 60); if (!t || !secRe.test(t) || !isVisible(h)) return false;
      var c = h.parentElement, cards = 0;
      for (var i = 0; i < 4 && c; i++) { var im = c.querySelectorAll("img").length, li = c.querySelectorAll("a").length; if (im >= 3 && li >= 3) { cards = Math.min(im, li); break; } c = c.parentElement; }
      if (cards >= 3) sections.push({ title: t, cards: cards, pos: pos(h), samplePrices: ((c && c.innerText) || "").match(priceRe) ? ((c && c.innerText) || "").match(priceRe).slice(0, 3) : [] });
      return sections.length >= 12;
    });
    var prices = uniq((document.body.innerText || "").match(priceRe) || []).slice(0, 8);
    var forms = q("form").filter(function (f) { return isVisible(f) && !f.closest("#__fc_panel"); }).map(function (f) { var b = f.querySelector('button, input[type="submit"]'); return { fields: Array.prototype.slice.call(f.querySelectorAll("input, select, textarea")).filter(isVisible).map(function (i) { return i.placeholder || i.name || i.type; }).slice(0, 8), submit: clean(b ? (b.innerText || b.value) : ""), pos: pos(f) }; }).filter(function (f) { return f.fields.length; }).slice(0, 6);
    var nav = uniq(q("nav a, header a").filter(isVisible).map(function (a) { return clean(a.innerText); }).filter(function (t) { return t && t.length <= 20; })).slice(0, 25);
    var firstScreenText = clean(q("body *").filter(function (el) { if (el.closest("#__fc_panel") || !isVisible(el) || el.children.length) return false; var r = el.getBoundingClientRect(); return r.top + scrollY < vh * 1.2 && r.bottom > 0; }).map(function (el) { return el.innerText; }).join(" | ")).slice(0, 1200);
    return { url: location.href, title: clean(document.title), description: clean(meta("description") || meta("og:description")), viewport: vw + "x" + vh, pageHeight: document.documentElement.scrollHeight, headlines: headlines, ctas: ctas, benefits: benefits, overlays: overlays, sections: sections, prices: prices, forms: forms, nav: nav, firstScreenText: firstScreenText };
  }

  // 작은 패널 UI
  var last = {}; try { last = JSON.parse(localStorage.getItem("__fc_last") || "{}"); } catch (e) {}
  var panel = document.createElement("div"); panel.id = "__fc_panel";
  panel.setAttribute("style", "all:initial;position:fixed;top:16px;right:16px;z-index:2147483647;width:300px;background:#fff;color:#17181c;border:1px solid #d9dbe0;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.2);font:13px/1.5 -apple-system,'Malgun Gothic',system-ui,sans-serif;padding:14px 16px;box-sizing:border-box");
  var opts = STAGES.map(function (s) { return "<option" + (s === last.stage ? " selected" : "") + ">" + s + "</option>"; }).join("");
  panel.innerHTML = '<div style="font-weight:700;font-size:14px;margin-bottom:8px">퍼널 비교 수집기</div>' +
    '<label style="display:block;font-size:11px;color:#6b7280;margin:6px 0 2px">경쟁사 이름</label><input id="__fc_c" style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #d9dbe0;border-radius:7px;font:inherit" value="' + (last.competitor || "").replace(/"/g, "&quot;") + '">' +
    '<label style="display:block;font-size:11px;color:#6b7280;margin:6px 0 2px">퍼널 단계</label><select id="__fc_s" style="width:100%;padding:7px 9px;border:1px solid #d9dbe0;border-radius:7px;font:inherit;background:#fff">' + opts + "</select>" +
    '<div style="display:flex;gap:6px"><div style="flex:1"><label style="display:block;font-size:11px;color:#6b7280;margin:6px 0 2px">화면</label><select id="__fc_d" style="width:100%;padding:7px 9px;border:1px solid #d9dbe0;border-radius:7px;font:inherit;background:#fff"><option>데스크톱</option><option' + (vw < 700 ? " selected" : "") + '>모바일</option></select></div><div style="flex:1.4"><label style="display:block;font-size:11px;color:#6b7280;margin:6px 0 2px">메모</label><input id="__fc_n" style="width:100%;box-sizing:border-box;padding:7px 9px;border:1px solid #d9dbe0;border-radius:7px;font:inherit"></div></div>' +
    '<button id="__fc_go" style="width:100%;margin-top:10px;padding:9px;border:0;border-radius:8px;background:#2f5bea;color:#fff;font:inherit;font-weight:700;cursor:pointer">이 페이지 캡처</button>' +
    '<div id="__fc_m" style="font-size:12px;color:#6b7280;margin-top:8px;min-height:16px"></div>' +
    '<button id="__fc_x" style="position:absolute;top:8px;right:10px;border:0;background:none;font-size:16px;cursor:pointer;color:#9aa0a6">✕</button>';
  document.documentElement.appendChild(panel);
  var $ = function (id) { return document.getElementById(id); };
  $("__fc_x").onclick = function () { panel.remove(); };
  $("__fc_go").onclick = function () {
    var competitor = clean($("__fc_c").value); if (!competitor) { $("__fc_m").textContent = "경쟁사 이름을 입력하세요."; return; }
    var btn = $("__fc_go"); btn.disabled = true; $("__fc_m").textContent = "분석·전송 중…";
    try {
      var data = extract();
      data.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6); data.competitor = competitor; data.stage = $("__fc_s").value; data.device = $("__fc_d").value; data.note = clean($("__fc_n").value); data.capturedAt = new Date().toISOString();
      try { localStorage.setItem("__fc_last", JSON.stringify({ competitor: competitor, stage: data.stage })); } catch (e) {}
      fetch(SERVER + "/api/captures", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + PASSWORD }, body: JSON.stringify(data) })
        .then(function (r) { if (r.status === 401) throw new Error("비밀번호가 틀렸습니다. 어드민에서 버튼을 다시 만드세요."); if (!r.ok) throw new Error("서버 오류 " + r.status + " (" + SERVER + ")"); $("__fc_m").style.color = "#1f8a4c"; $("__fc_m").textContent = "전송 완료: CTA " + data.ctas.length + "개, 소구 문구 " + data.benefits.length + "개"; btn.disabled = false; })
        .catch(function (e) { $("__fc_m").style.color = "#b42318"; $("__fc_m").textContent = "실패: " + e.message + (e.message.indexOf("(") < 0 ? " → " + SERVER : ""); btn.disabled = false; });
    } catch (e) { $("__fc_m").style.color = "#b42318"; $("__fc_m").textContent = "분석 실패: " + e.message; btn.disabled = false; }
  };
})();
