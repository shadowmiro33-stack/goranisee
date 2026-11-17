import { checkPassword, isAuthed, loginCookie, logoutCookie, getEnv, sessionToken } from "../../lib/core.js";
const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
export default async (req) => {
  const h = { authorization: req.headers.get("authorization") || "", cookie: req.headers.get("cookie") || "" };
  if (req.method === "GET") return json(200, { authed: isAuthed(h) });
  if (req.method === "DELETE") return json(200, { ok: true }, { "Set-Cookie": logoutCookie() });
  if (req.method !== "POST") return json(405, { error: "지원하지 않는 메서드" });
  const body = await req.json().catch(() => ({}));
  if (!(getEnv("ADMIN_PASSWORD") || "").trim()) return json(500, { error: "서버에 ADMIN_PASSWORD 환경변수가 없습니다. 호스팅(Cloudflare Workers → Settings → Variables and Secrets)에 추가하고 재배포하세요." });
  if (!checkPassword(body.password)) return json(401, { error: "비밀번호가 틀렸습니다." });
  // 쿠키 + 토큰 둘 다 발급: 쿠키를 막는 브라우저(사파리 설정·사내 보안 프로그램 등)에서는 토큰으로 로그인 유지
  return json(200, { ok: true, token: sessionToken() }, { "Set-Cookie": loginCookie() });
};
export const config = { path: "/api/login" };
