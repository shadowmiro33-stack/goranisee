import { checkPassword, sessionToken, isAuthed } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "GET") return res.status(200).json({ authed: isAuthed(req) });
  if (req.method === "DELETE") {
    res.setHeader("Set-Cookie", "fc_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
    return res.status(200).json({ ok: true });
  }
  if (req.method !== "POST") return res.status(405).end();
  const { password } = req.body || {};
  if (!checkPassword(password)) return res.status(401).json({ error: "비밀번호가 틀렸습니다." });
  res.setHeader("Set-Cookie", `fc_session=${sessionToken()}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; Secure; SameSite=Lax`);
  res.status(200).json({ ok: true });
}
