import { isAuthed, CORS, capturesRoute } from "../lib/core.js";
export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };
export default async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!isAuthed(req.headers)) return res.status(401).json({ error: "인증이 필요합니다." });
  try {
    const { status, body } = await capturesRoute(req.method, req.query || {}, req.body);
    res.status(status).json(body);
  } catch (e) { res.status(500).json({ error: e.message || String(e) }); }
}
