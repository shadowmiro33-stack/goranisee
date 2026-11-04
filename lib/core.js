// 런타임 공용 로직 (Vercel api/*.js 와 Netlify netlify/functions/*.js 가 함께 사용)
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const env = () => ({
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
});

export function db() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = env();
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수가 없습니다.");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

export function sessionToken() {
  const { ADMIN_PASSWORD } = env();
  if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD 환경변수가 없습니다.");
  return crypto.createHmac("sha256", ADMIN_PASSWORD).update("funnel-admin-session").digest("hex");
}
function safeEq(a, b) {
  const A = Buffer.from(String(a || "")), B = Buffer.from(String(b || ""));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}
export function checkPassword(pw) {
  const { ADMIN_PASSWORD } = env();
  return !!ADMIN_PASSWORD && safeEq(pw, ADMIN_PASSWORD);
}
// headers: { authorization, cookie } 소문자 키
export function isAuthed(headers) {
  const auth = headers.authorization || "";
  if (auth.startsWith("Bearer ") && checkPassword(auth.slice(7).trim())) return true;
  const m = (headers.cookie || "").match(/(?:^|;\s*)fc_session=([a-f0-9]+)/);
  return !!m && safeEq(m[1], sessionToken());
}
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
export const loginCookie = () => `fc_session=${sessionToken()}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; Secure; SameSite=Lax`;
export const logoutCookie = () => "fc_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";

const LIST_COLS = "id, competitor, stage, device, note, url, title, captured_at, created_at, data";

// 각 함수는 { status, body } 를 돌려줍니다.
export async function listCaptures() {
  const { data, error } = await db().from("captures").select(LIST_COLS).order("captured_at", { ascending: false }).limit(2000);
  if (error) throw error;
  return { status: 200, body: data };
}
export async function getCapture(id) {
  const { data, error } = await db().from("captures").select("*").eq("id", id).single();
  if (error) return { status: 404, body: { error: "없는 캡처입니다." } };
  return { status: 200, body: data };
}
export async function ingest(b) {
  b = b || {};
  if (!b.competitor || !b.stage) return { status: 400, body: { error: "competitor, stage는 필수입니다." } };
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
  const { error } = await db().from("captures").upsert(row, { onConflict: "id" });
  if (error) throw error;
  return { status: 200, body: { ok: true, id: row.id } };
}
export async function deleteCaptures({ id, competitor }) {
  let q = db().from("captures").delete();
  if (id) q = q.eq("id", id);
  else if (competitor) q = q.eq("competitor", competitor);
  else return { status: 400, body: { error: "id 또는 competitor가 필요합니다." } };
  const { error } = await q;
  if (error) throw error;
  return { status: 200, body: { ok: true } };
}

// 메서드/쿼리/본문을 받아 라우팅. 인증은 호출자가 확인.
export async function capturesRoute(method, query, body) {
  if (method === "GET") return query.id ? getCapture(query.id) : listCaptures();
  if (method === "POST") return ingest(body);
  if (method === "DELETE") return deleteCaptures(query);
  return { status: 405, body: { error: "지원하지 않는 메서드" } };
}
