// 우리 사이트 분석 수집 엔드포인트 (track.js → POST /api/track). 인증 없음(공개 스크립트), 크기·건수 제한만.
import { db, CORS } from "../../lib/core.js";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const TYPES = new Set(["pageview", "leave", "scroll", "click", "event", "ab", "rr"]);
const str = (v, n) => (v == null ? null : String(v).slice(0, n));

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json(405, { error: "POST only" });
  let body; try { body = await req.json(); } catch { return json(400, { error: "bad json" }); }
  const events = Array.isArray(body?.events) ? body.events.slice(0, 50) : [];
  const rows = [];
  for (const e of events) {
    if (!e || !TYPES.has(e.type) || !e.site || !e.visitor_id || !e.session_id) continue;
    let data = e.data && typeof e.data === "object" ? e.data : {};
    const s = JSON.stringify(data); if (s.length > (e.type === "rr" ? 900000 : 4000)) { if (e.type === "rr") continue; data = { truncated: true }; }
    rows.push({ site: str(e.site, 60), visitor_id: str(e.visitor_id, 40), session_id: str(e.session_id, 40), type: e.type, name: str(e.name, 120), path: str(e.path, 300), url: str(e.url, 500), referrer: str(e.referrer, 300), source: str(e.source, 80), device: str(e.device, 20), ts: e.ts && !isNaN(Date.parse(e.ts)) ? new Date(e.ts).toISOString() : new Date().toISOString(), data });
  }
  if (!rows.length) return json(200, { ok: true, n: 0 });
  const { error } = await db().from("events").insert(rows);
  if (error) return json(500, { error: /relation .*events|Could not find the table/i.test(error.message) ? "Supabase에 events 테이블이 없습니다. schema.sql의 events 부분을 실행하세요." : error.message });
  return json(200, { ok: true, n: rows.length });
};
export const config = { path: "/api/track" };
