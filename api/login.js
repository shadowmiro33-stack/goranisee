import { checkPassword, isAuthed, loginCookie, logoutCookie } from "../lib/core.js";
export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ authed: isAuthed(req.headers) });
  if (req.method === "DELETE") { res.setHeader("Set-Cookie", logoutCookie()); return res.status(200).json({ ok: true }); }
  if (req.method !== "POST") return res.status(405).end();
  if (!checkPassword((req.body || {}).password)) return res.status(401).json({ error: "비밀번호가 틀렸습니다." });
  res.setHeader("Set-Cookie", loginCookie());
  res.status(200).json({ ok: true });
}
