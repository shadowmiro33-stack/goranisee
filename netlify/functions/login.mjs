import { checkPassword, isAuthed, loginCookie, logoutCookie } from "../../lib/core.js";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
export default async (req) => {
  const h = { authorization: req.headers.get("authorization") || "", cookie: req.headers.get("cookie") || "" };
  if (req.method === "GET") return json(200, { authed: isAuthed(h) });
  if (req.method === "DELETE") return json(200, { ok: true }, { "Set-Cookie": logoutCookie() });
  if (req.method !== "POST") return json(405, { error: "지원하지 않는 메서드" });
  const body = await req.json().catch(() => ({}));
  if (!checkPassword(body.password)) return json(401, { error: "비밀번호가 틀렸습니다." });
  return json(200, { ok: true }, { "Set-Cookie": loginCookie() });
};
export const config = { path: "/api/login" };
