// Cloudflare Workers 진입점: /api/* 는 Netlify 함수 핸들러를 재사용하고, 나머지는 public/ 정적 자산으로 응답합니다.
import login from "./netlify/functions/login.mjs";
import captures from "./netlify/functions/captures.mjs";
import captureRequest from "./netlify/functions/capture-request.mjs";

const ROUTES = { "/api/login": login, "/api/captures": captures, "/api/capture-request": captureRequest };

export default {
  async fetch(request, env, ctx) {
    // Netlify 핸들러는 process.env 를 읽으므로 Workers 바인딩을 복사 (nodejs_compat)
    try { for (const [k, v] of Object.entries(env)) if (typeof v === "string") process.env[k] = v; } catch (_) {}
    const url = new URL(request.url);
    const handler = ROUTES[url.pathname.replace(/\/+$/, "")];
    if (handler) {
      try { return await handler(request, { env, ctx }); }
      catch (e) { return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } }); }
    }
    return env.ASSETS.fetch(request);
  },
};
