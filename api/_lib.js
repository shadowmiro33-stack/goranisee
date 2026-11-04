// 공용 헬퍼: Supabase 클라이언트, 인증, CORS
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_PASSWORD } = process.env;

export function db() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY 환경변수가 없습니다.");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
}

// 비밀번호에서 파생한 세션 토큰 (비밀번호를 바꾸면 모든 세션이 무효화됨)
export function sessionToken() {
  if (!ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD 환경변수가 없습니다.");
  return crypto.createHmac("sha256", ADMIN_PASSWORD).update("funnel-admin-session").digest("hex");
}

function safeEq(a, b) {
  const A = Buffer.from(String(a || "")), B = Buffer.from(String(b || ""));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

export function checkPassword(pw) {
  return !!ADMIN_PASSWORD && safeEq(pw, ADMIN_PASSWORD);
}

// 쿠키(어드민 화면) 또는 Bearer(확장 프로그램) 둘 중 하나로 인증
export function isAuthed(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ") && checkPassword(auth.slice(7).trim())) return true;
  const cookie = req.headers.cookie || "";
  const m = cookie.match(/(?:^|;\s*)fc_session=([a-f0-9]+)/);
  return !!m && safeEq(m[1], sessionToken());
}

export function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

export function unauthorized(res) {
  res.status(401).json({ error: "인증이 필요합니다." });
}
