// 현재 페이지에서 마케팅 요소를 추출합니다. chrome.scripting.executeScript로 주입되어
// 반환값이 팝업으로 돌아갑니다.
(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const uniq = (arr) => [...new Set(arr)];

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const st = getComputedStyle(el);
    if (st.display === "none" || st.visibility === "hidden" || +st.opacity === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2;
  }
  function inFirstScreen(el) {
    const r = el.getBoundingClientRect();
    return r.top + window.scrollY < vh * 1.2 && r.bottom > 0;
  }
  function pos(el) {
    const r = el.getBoundingClientRect();
    const y = r.top + window.scrollY;
    const band = y < vh ? "첫화면" : y < vh * 2 ? "스크롤1" : y < vh * 3 ? "스크롤2" : "하단";
    const x = r.left + r.width / 2 < vw / 3 ? "좌" : r.left + r.width / 2 > (vw * 2) / 3 ? "우" : "중앙";
    return `${band}/${x}`;
  }
  const isFixed = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const p = getComputedStyle(e).position;
      if (p === "fixed" || p === "sticky") return true;
    }
    return false;
  };

  // 1) 메타 정보
  const meta = (n) =>
    document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute("content") || "";
  const title = clean(document.title);
  const description = clean(meta("description") || meta("og:description"));

  // 2) 헤드라인 (h1~h3, 보이는 것만, 위치순)
  const headlines = [...document.querySelectorAll("h1, h2, h3")]
    .filter(isVisible)
    .map((h) => ({ tag: h.tagName.toLowerCase(), text: clean(h.innerText).slice(0, 120), pos: pos(h) }))
    .filter((h) => h.text.length > 1)
    .slice(0, 25);

  // 3) CTA 후보: button, role=button, a가 버튼처럼 생긴 것
  const ctaSelector =
    'button, [role="button"], input[type="submit"], a[class*="btn"], a[class*="button"], a[class*="cta"], a[class*="Btn"]';
  const ctaKeywords = /구매|장바구니|담기|주문|결제|가입|시작|신청|무료|체험|다운로드|상담|문의|받기|확인|보기|알아보기|쿠폰|예약|구독|로그인|더보기|buy|add to cart|cart|checkout|sign up|get started|start|try|free|subscribe|shop|order|book|learn more/i;
  const ctas = uniq(
    [...document.querySelectorAll(ctaSelector)]
      .filter(isVisible)
      .map((el) => {
        const text = clean(el.innerText || el.value || el.getAttribute("aria-label"));
        if (!text || text.length > 40) return null;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        const bg = st.backgroundColor;
        const strong = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
        return JSON.stringify({
          text,
          pos: pos(el),
          fixed: isFixed(el),
          strong,
          size: Math.round(r.width) + "x" + Math.round(r.height),
          match: ctaKeywords.test(text),
        });
      })
      .filter(Boolean)
  )
    .map((s) => JSON.parse(s))
    .sort((a, b) => (b.match - a.match) || (b.strong - a.strong))
    .slice(0, 30);

  // 4) 혜택/소구 문구: 할인, 무료배송, 쿠폰, 후기, 적립, 한정 등
  const benefitRe =
    /(\d{1,2}\s?%\s?(할인|OFF)|무료\s?배송|무료배송|쿠폰|적립|포인트|1\+1|한정|오늘만|마감|선착순|특가|세일|SALE|최저가|당일|새벽\s?배송|무이자|첫\s?구매|신규\s?회원|후기|리뷰|평점|★|별점|베스트|인기|추천|보장|환불|무료\s?체험|첫\s?달\s?무료|free shipping|off|coupon|limited|best seller|rating|review)/i;
  const textNodes = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
      const t = clean(n.nodeValue);
      return t.length >= 4 && t.length <= 140 && benefitRe.test(t) && isVisible(p)
        ? NodeFilter.FILTER_ACCEPT
        : NodeFilter.FILTER_SKIP;
    },
  });
  let node;
  while ((node = walker.nextNode()) && textNodes.length < 40) {
    textNodes.push({ text: clean(node.nodeValue), pos: pos(node.parentElement) });
  }
  const benefits = uniq(textNodes.map((t) => JSON.stringify(t))).map((s) => JSON.parse(s));

  // 5) 팝업/배너/띠배너: fixed/sticky 요소 중 큰 것, dialog, modal
  const overlays = [...document.querySelectorAll("body *")]
    .filter((el) => {
      if (!isVisible(el)) return false;
      const st = getComputedStyle(el);
      if (st.position !== "fixed" && st.position !== "sticky" && el.tagName !== "DIALOG" && !/modal|popup|layer|banner|toast|floating/i.test(el.className + " " + el.id))
        return false;
      const r = el.getBoundingClientRect();
      return r.width >= 120 && r.height >= 40;
    })
    .filter((el, _, arr) => !arr.some((o) => o !== el && o.contains(el))) // 최상위만
    .map((el) => {
      const r = el.getBoundingClientRect();
      return {
        kind: /modal|popup|dialog|layer/i.test(el.className + " " + el.id + " " + el.tagName) ? "팝업" : r.top < 10 ? "상단바" : r.bottom > vh - 10 ? "하단바" : "플로팅",
        text: clean(el.innerText).slice(0, 160),
        size: Math.round(r.width) + "x" + Math.round(r.height),
      };
    })
    .filter((o) => o.text.length > 0)
    .slice(0, 10);

  // 6) 추천/광고/상품 섹션: 제목에 추천/인기/BEST/함께/관련/광고/AD 가 있고 아래에 카드가 여러 개
  const sectionRe = /추천|인기|BEST|베스트|함께|관련|많이|지금|요즘|핫|신상|NEW|기획전|이벤트|광고|AD|sponsored|recommend|popular|trending|you may|related|also/i;
  const sections = [];
  for (const h of document.querySelectorAll("h1, h2, h3, h4, [class*='title'], [class*='Title']")) {
    const t = clean(h.innerText).slice(0, 60);
    if (!t || !sectionRe.test(t) || !isVisible(h)) continue;
    let container = h.parentElement;
    let cards = 0;
    for (let i = 0; i < 4 && container; i++) {
      const imgs = container.querySelectorAll("img").length;
      const links = container.querySelectorAll("a").length;
      if (imgs >= 3 && links >= 3) { cards = Math.min(imgs, links); break; }
      container = container.parentElement;
    }
    if (cards >= 3) {
      const prices = [...(container?.innerText || "").matchAll(/[\d,]{4,}\s?원|₩\s?[\d,]+|\$\s?[\d,.]+/g)].slice(0, 3).map((m) => m[0]);
      sections.push({ title: t, cards, pos: pos(h), samplePrices: prices });
    }
    if (sections.length >= 12) break;
  }

  // 7) 가격 노출 (상품 상세용)
  const priceMatches = uniq([...(document.body.innerText || "").matchAll(/[\d,]{4,}\s?원|₩\s?[\d,]+|\$\s?[\d,.]+/g)].map((m) => m[0])).slice(0, 8);

  // 8) 폼 (가입/구독 유도)
  const forms = [...document.querySelectorAll("form")]
    .filter(isVisible)
    .map((f) => ({
      fields: [...f.querySelectorAll("input, select, textarea")].filter(isVisible).map((i) => i.placeholder || i.name || i.type).slice(0, 8),
      submit: clean(f.querySelector('button, input[type="submit"]')?.innerText || f.querySelector('input[type="submit"]')?.value || ""),
      pos: pos(f),
    }))
    .filter((f) => f.fields.length)
    .slice(0, 6);

  // 9) 내비게이션
  const nav = uniq(
    [...document.querySelectorAll("nav a, header a")]
      .filter(isVisible)
      .map((a) => clean(a.innerText))
      .filter((t) => t && t.length <= 20)
  ).slice(0, 25);

  // 10) 첫 화면 텍스트 (히어로 요약용)
  const firstScreenText = clean(
    [...document.querySelectorAll("body *")]
      .filter((el) => isVisible(el) && inFirstScreen(el) && el.children.length === 0)
      .map((el) => el.innerText)
      .join(" | ")
  ).slice(0, 1200);

  return {
    url: location.href,
    title,
    description,
    viewport: `${vw}x${vh}`,
    pageHeight: document.documentElement.scrollHeight,
    headlines,
    ctas,
    benefits,
    overlays,
    sections,
    prices: priceMatches,
    forms,
    nav,
    firstScreenText,
  };
})();
