// Cloudflare Workers 진입점: /api/* 는 Netlify 함수 핸들러를 재사용하고, 나머지는 public/ 정적 자산으로 응답합니다.
import login from "./netlify/functions/login.mjs";
import captures from "./netlify/functions/captures.mjs";
import captureRequest from "./netlify/functions/capture-request.mjs";
import { setRuntimeEnv } from "./lib/core.js";

const ROUTES = { "/api/login": login, "/api/captures": captures, "/api/capture-request": captureRequest };

export default {
  async fetch(request, env, ctx) {
    // Workers 바인딩(env)을 공용 로직에 전달 (process.env 에 의존하지 않음)
    setRuntimeEnv(env);
    if (new URL(request.url).pathname === "/api/env-check") {
      const names = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ADMIN_PASSWORD", "GH_DISPATCH_TOKEN"];
      return new Response(JSON.stringify(Object.fromEntries(names.map((n) => [n, typeof env[n] === "string" && env[n].length > 0 ? "설정됨" : "없음"]))), { headers: { "Content-Type": "application/json" } });
    }
    const url = new URL(request.url);
    const handler = ROUTES[url.pathname.replace(/\/+$/, "")];
    if (handler) {
      try { return await handler(request, { env, ctx }); }
      catch (e) { return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } }); }
    }
    return env.ASSETS.fetch(request);
  },
};
