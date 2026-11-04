// GET  /api/captures            목록 (스크린샷 제외)
// GET  /api/captures?id=xxx     상세 (스크린샷 포함)
// POST /api/captures            확장 프로그램이 캡처 전송
// DELETE /api/captures?id=xxx   삭제
import { db, isAuthed, cors, unauthorized } from "./_lib.js";

export const config = { api: { bodyParser: { sizeLimit: "4mb" } } };

const LIST_COLS = "id, competitor, stage, device, note, url, title, captured_at, created_at, data";

export default async function handler(req, res) {
  if (cors(req, res)) return;
  if (!isAuthed(req)) return unauthorized(res);
  const sb = db();

  try {
    if (req.method === "GET") {
      const { id } = req.query;
      if (id) {
        const { data, error } = await sb.from("captures").select("*").eq("id", id).single();
        if (error) return res.status(404).json({ error: "없는 캡처입니다." });
        return res.status(200).json(data);
      }
      const { data, error } = await sb.from("captures").select(LIST_COLS).order("captured_at", { ascending: false }).limit(2000);
      if (error) throw error;
      return res.status(200).json(data);
    }

    if (req.method === "POST") {
      const b = req.body || {};
      if (!b.competitor || !b.stage) return res.status(400).json({ error: "competitor, stage는 필수입니다." });
      const { screenshot, id, competitor, stage, device, note, url, title, capturedAt, ...data } = b;
      const row = {
        id: id || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        competitor: String(competitor).trim().slice(0, 80),
        stage: String(stage).slice(0, 40),
        device: device || null,
        note: note || null,
        url: url || null,
        title: title || null,
        captured_at: capturedAt || new Date().toISOString(),
        data,
        screenshot: typeof screenshot === "string" && screenshot.startsWith("data:image/") ? screenshot : null,
      };
      const { error } = await sb.from("captures").upsert(row, { onConflict: "id" });
      if (error) throw error;
      return res.status(200).json({ ok: true, id: row.id });
    }

    if (req.method === "DELETE") {
      const { id, competitor } = req.query;
      let q = sb.from("captures").delete();
      if (id) q = q.eq("id", id);
      else if (competitor) q = q.eq("competitor", competitor);
      else return res.status(400).json({ error: "id 또는 competitor가 필요합니다." });
      const { error } = await q;
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message || String(e) });
  }
}
