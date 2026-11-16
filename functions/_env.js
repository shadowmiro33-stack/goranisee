// Cloudflare Pages Functions 어댑터: Netlify 함수(Request → Response)를 그대로 재사용합니다.
// Cloudflare는 환경변수를 context.env 로 주므로 process.env 에 복사한 뒤 핸들러를 호출합니다 (nodejs_compat 필요, wrangler.toml 참고).
export async function withEnv(ctx, handler) {
  try { for (const [k, v] of Object.entries(ctx.env || {})) if (typeof v === "string") process.env[k] = v; } catch (_) {}
  return handler(ctx.request, ctx);
}
