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
    let screenshot = null;
    try { screenshot = await chrome.tabs.captureVisibleTab(undefined, { format: "jpeg", quality: 60 }); } catch (e) { /* 일부 페이지는 캡처 불가 */ }

    const capture = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      competitor,
      stage: $("stage").value,
      device: $("device").value,
      note: $("note").value.trim(),
      capturedAt: new Date().toISOString(),
      screenshot,
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
