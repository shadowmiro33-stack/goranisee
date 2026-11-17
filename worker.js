// Cloudflare Workers 진입점: /api/* 는 Netlify 함수 핸들러를 재사용하고, 나머지는 public/ 정적 자산으로 응답합니다.
import login from "./netlify/functions/login.mjs";
import captures from "./netlify/functions/captures.mjs";
import captureRequest from "./netlify/functions/capture-request.mjs";
import track from "./netlify/functions/track.mjs";
import analytics from "./netlify/functions/analytics.mjs";
import { setRuntimeEnv, isAuthed, ingest } from "./lib/core.js";

const ROUTES = { "/api/login": login, "/api/captures": captures, "/api/capture-request": captureRequest, "/api/track": track, "/api/analytics": analytics };

export default {
  async fetch(request, env, ctx) {
    // Workers 바인딩(env)을 공용 로직에 전달 (process.env 에 의존하지 않음)
    setRuntimeEnv(env);
    if (new URL(request.url).pathname === "/api/env-check") {
      const names = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY", "ADMIN_PASSWORD", "GH_DISPATCH_TOKEN"];
      const out = Object.fromEntries(names.map((n) => [n, typeof env[n] === "string" && env[n].length > 0 ? "설정됨" : "없음"]));
      out.BROWSER = env.BROWSER ? "설정됨" : "없음"; out.colo = request.cf && request.cf.colo || null;
      return new Response(JSON.stringify(out), { headers: { "Content-Type": "application/json" } });
    }
    const url = new URL(request.url);
    // 즉시 수집(한국 IP 경유): 워커 안의 헤드리스 크롬이 요청자와 가까운 데이터센터에서 열림
    if (url.pathname === "/api/capture-now") {
      const h = { authorization: request.headers.get("authorization") || "", cookie: request.headers.get("cookie") || "" };
      if (!isAuthed(h)) return new Response(JSON.stringify({ error: "인증이 필요합니다." }), { status: 401, headers: { "Content-Type": "application/json" } });
      if (!env.BROWSER) return new Response(JSON.stringify({ error: "이 배포에 브라우저 바인딩(BROWSER)이 없습니다. wrangler.toml의 [browser] 설정이 반영된 뒤 다시 시도하세요." }), { status: 503, headers: { "Content-Type": "application/json" } });
      let b = {}; try { b = await request.json(); } catch {}
      if (!/^https?:\/\//.test(b.url || "")) return new Response(JSON.stringify({ error: "url이 필요합니다." }), { status: 400, headers: { "Content-Type": "application/json" } });
      const { edgeCapture, edgeCrawl } = await import("./lib/edge_capture.js");
      const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      const colo = request.cf && request.cf.colo ? request.cf.colo : null;
      const competitor = String(b.competitor || "경쟁사").trim().slice(0, 80);
      if (b.mode === "crawl") {
        // 사이트 전체: 진행 상황을 NDJSON 스트림으로 흘려보내고(연결 유지), 페이지마다 바로 저장
        const { readable, writable } = new TransformStream();
        const w = writable.getWriter(); const enc = new TextEncoder();
        const send = (o) => w.write(enc.encode(JSON.stringify(o) + "\n")).catch(() => {});
        ctx.waitUntil((async () => {
          try {
            await send({ type: "start", colo, requestId });
            const sum = await edgeCrawl(env, { url: b.url, competitor, requestId, maxPages: Math.min(40, Math.max(1, +b.max_pages || 20)),
              onLog: (m) => send({ type: "log", m }),
              onPage: async (p) => { p.edgeColo = colo; if (colo) p.note = (p.note || "") + ` · 데이터센터 ${colo}`; const r = await ingest(p); await send({ type: "page", id: r.body && r.body.id, url: p.url, stage: p.stage, ok: !p.captureError, error: p.captureError || null, index: p.crawl && p.crawl.index }); } });
            await send({ type: "done", ...sum });
          } catch (e) { await send({ type: "error", error: String(e && e.message || e) }); }
          finally { try { await w.close(); } catch {} }
        })());
        return new Response(readable, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
      }
      const payload = await edgeCapture(env, { url: b.url, competitor, stage: b.stage || "auto", requestId });
      payload.edgeColo = colo; payload.edgeCountry = request.cf && request.cf.country || null;
      if (colo) payload.note = (payload.note || "") + ` · 데이터센터 ${colo}`;
      const saved = await ingest(payload);
      return new Response(JSON.stringify({ ok: !payload.captureError, id: saved.body && saved.body.id, error: payload.captureError || null, colo, elapsedMs: payload.elapsedMs }), { status: saved.status, headers: { "Content-Type": "application/json" } });
    }
    const handler = ROUTES[url.pathname.replace(/\/+$/, "")];
    if (handler) {
      try { return await handler(request, { env, ctx }); }
      catch (e) { return new Response(JSON.stringify({ error: String(e && e.message || e) }), { status: 500, headers: { "Content-Type": "application/json" } }); }
    }
    return env.ASSETS.fetch(request);
  },
};
