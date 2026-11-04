const $ = (id) => document.getElementById(id);
const msg = (t, c = "") => { $("msg").textContent = t; $("msg").className = c; };

chrome.storage.local.get(["server", "password"]).then(({ server = "", password = "" }) => {
  $("server").value = server; $("password").value = password;
});

const norm = (u) => u.trim().replace(/\/+$/, "");

$("save").addEventListener("click", async () => {
  const server = norm($("server").value), password = $("password").value;
  if (!/^https?:\/\//.test(server)) return msg("주소는 https:// 로 시작해야 합니다.", "err");
  await chrome.storage.local.set({ server, password });
  msg("저장되었습니다.", "ok");
});

$("test").addEventListener("click", async () => {
  const server = norm($("server").value), password = $("password").value;
  msg("연결 확인 중…");
  try {
    const r = await fetch(server + "/api/captures", { headers: { Authorization: "Bearer " + password } });
    if (r.status === 401) return msg("비밀번호가 틀렸습니다.", "err");
    if (!r.ok) return msg("서버 응답 오류: " + r.status, "err");
    const list = await r.json();
    msg(`연결 성공. 어드민에 ${list.length}건이 쌓여 있습니다.`, "ok");
  } catch (e) { msg("연결 실패: 주소를 확인하세요. (" + e.message + ")", "err"); }
});
