const $ = (id) => document.getElementById(id);
const status = (msg, cls = "") => { $("status").textContent = msg; $("status").className = cls; };

async function settings() {
  const { server = "", password = "" } = await chrome.storage.local.get(["server", "password"]);
  return { server, password };
}

async function upload(capture) {
  const { server, password } = await settings();
  if (!server) throw new Error("어드민 주소가 설정되지 않았습니다.");
  const r = await fetch(server + "/api/captures", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + password },
    body: JSON.stringify(capture),
  });
  if (r.status === 401) throw new Error("비밀번호가 틀렸습니다.");
  if (!r.ok) throw new Error("서버 오류 " + r.status);
}

// 전송 실패분은 로컬 큐에 두었다가 다음에 재전송
async function flushQueue() {
  const { queue = [] } = await chrome.storage.local.get("queue");
  if (!queue.length) return 0;
  const left = [];
  for (const c of queue) { try { await upload(c); } catch { left.push(c); } }
  await chrome.storage.local.set({ queue: left });
  return queue.length - left.length;
}

async function load() {
  const { names = [], lastCompetitor = "", lastStage = "", sent = 0, queue = [], server = "" } = await chrome.storage.local.get(["names", "lastCompetitor", "lastStage", "sent", "queue", "server"]);
  $("competitors").innerHTML = names.map((n) => `<option value="${n.replace(/"/g, "&quot;")}">`).join("");
  if (lastCompetitor) $("competitor").value = lastCompetitor;
  if (lastStage) $("stage").value = lastStage;
  $("count").textContent = server ? `이 PC에서 전송한 캡처: ${sent}건` : "어드민 연결 설정이 필요합니다.";
  $("pending").textContent = queue.length ? `전송 대기 ${queue.length}건 (다음 캡처 때 자동 재전송)` : "";
}

$("capture").addEventListener("click", async () => {
  const competitor = $("competitor").value.trim();
  if (!competitor) { status("경쟁사 이름을 입력하세요.", "err"); return; }
  const { server } = await settings();
  if (!server) { status("먼저 어드민 연결 설정을 해주세요.", "err"); chrome.runtime.openOptionsPage(); return; }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/.test(tab.url || "")) { status("일반 웹페이지에서만 캡처할 수 있습니다.", "err"); return; }

  $("capture").disabled = true;
  status("페이지 분석 중…");
  try {
    const [{ result }] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["extract.js"] });
    let screenshot = null, screenshotFull = false, screenshotHeight = 0;
    try {
      status("전체 페이지 스크린샷 생성 중…");
      const full = await captureFullPage(tab.id);
      screenshot = full.dataUrl; screenshotFull = full.full; screenshotHeight = full.height;
    } catch (e) {
      try { screenshot = await chrome.tabs.captureVisibleTab(undefined, { format: "jpeg", quality: 60 }); } catch (e2) { /* 일부 페이지는 캡처 불가 */ }
    }

    const capture = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      competitor,
      stage: $("stage").value,
      device: $("device").value,
      note: $("note").value.trim(),
      capturedAt: new Date().toISOString(),
      screenshot, screenshotFull, screenshotHeight,
      ...result,
    };

    const st = await chrome.storage.local.get(["names", "sent", "queue"]);
    const names = [...new Set([...(st.names || []), competitor])];
    let sent = st.sent || 0, queue = st.queue || [];

    status("어드민으로 전송 중…");
    try {
      await upload(capture); sent++;
      status(`전송 완료: ${competitor} · ${capture.stage} (CTA ${result.ctas.length}개, 소구 문구 ${result.benefits.length}개)`, "ok");
    } catch (e) {
      queue.push(capture);
      status(`전송 실패(${e.message}). 로컬에 보관했다가 다음에 재전송합니다.`, "err");
    }
    await chrome.storage.local.set({ names, sent, queue, lastCompetitor: competitor, lastStage: capture.stage });
    $("note").value = "";
    const flushed = await flushQueue();
    if (flushed) { const s = await chrome.storage.local.get("sent"); await chrome.storage.local.set({ sent: (s.sent || 0) + flushed }); }
    await load();
  } catch (e) {
    status("캡처 실패: " + (e.message || e), "err");
  } finally {
    $("capture").disabled = false;
  }
});

$("open").addEventListener("click", async () => {
  const { server } = await settings();
  if (server) chrome.tabs.create({ url: server }); else chrome.runtime.openOptionsPage();
});
$("settings").addEventListener("click", (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });

load();

// 스크롤하며 보이는 화면을 여러 장 찍어 세로로 이어붙인 전체 페이지 스크린샷 (최대 20장 ≈ 모바일 기준 16,000px)
async function captureFullPage(tabId) {
  const run = (func, args = []) => chrome.scripting.executeScript({ target: { tabId }, func, args }).then((r) => r[0]?.result);
  const info = await run(() => ({ w: innerWidth, h: innerHeight, total: Math.max(document.documentElement.scrollHeight, document.body.scrollHeight), y0: scrollY, dpr: devicePixelRatio }));
  const shots = Math.min(20, Math.ceil(info.total / info.h));
  const parts = [];
  for (let i = 0; i < shots; i++) {
    const y = i * info.h;
    await run((y, first) => {
      window.scrollTo(0, y);
      // 두 번째 장부터는 고정 요소(헤더·하단바·플로팅)를 숨겨 반복 노출을 막음
      if (!first) document.querySelectorAll("body *").forEach((el) => { const p = getComputedStyle(el).position; if ((p === "fixed" || p === "sticky") && !el.dataset.__fcHidden) { el.dataset.__fcHidden = el.style.visibility || "_"; el.style.visibility = "hidden"; } });
    }, [y, i === 0]);
    await new Promise((r) => setTimeout(r, i === 0 ? 400 : 650)); // captureVisibleTab 호출 제한(초당 2회) 대응
    const actualY = await run(() => scrollY);
    parts.push({ y: actualY, dataUrl: await chrome.tabs.captureVisibleTab(undefined, { format: "jpeg", quality: 70 }) });
    if (actualY + info.h >= info.total) break;
  }
  await run((y0) => { document.querySelectorAll("[data-__fc-hidden], [data-__fcHidden]").forEach((el) => { el.style.visibility = el.dataset.__fcHidden === "_" ? "" : el.dataset.__fcHidden; delete el.dataset.__fcHidden; }); window.scrollTo(0, y0); }, [info.y0]);
  // 이어붙이기
  const imgs = await Promise.all(parts.map((p) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = p.dataUrl; })));
  const scale = imgs[0].width / info.w;
  const height = Math.min(info.total, parts[parts.length - 1].y + info.h);
  const canvas = document.createElement("canvas"); canvas.width = imgs[0].width; canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  parts.forEach((p, i) => ctx.drawImage(imgs[i], 0, Math.round(p.y * scale)));
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.6), full: height >= info.total, height };
}
