import { isAuthed, CORS, capturesRoute } from "../../lib/core.js";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const h = { authorization: req.headers.get("authorization") || "", cookie: req.headers.get("cookie") || "" };
  if (!isAuthed(h)) return json(401, { error: "인증이 필요합니다." });
  try {
    const query = Object.fromEntries(new URL(req.url).searchParams);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : undefined;
    const { status, body: out } = await capturesRoute(req.method, query, body);
    return json(status, out);
  } catch (e) { return json(500, { error: e.message || String(e) }); }
};
export const config = { path: "/api/captures" };
