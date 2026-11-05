// "URL로 수집": 이 저장소의 GitHub Actions(funnel_capture_request.yml)를 repository_dispatch로 실행합니다.
// 수집은 GitHub 러너에서 일어나므로 회사 IP가 경쟁사에 남지 않습니다. 결과는 Actions가 /api/captures 로 보내옵니다.
// 환경변수: GH_DISPATCH_TOKEN (이 저장소 Contents: Read and write 권한의 fine-grained PAT), GH_DISPATCH_REPO (기본 shadowmiro33-stack/goranisee)
import { isAuthed, CORS } from "../../lib/core.js";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const STAGE_KEYS = { "첫 화면(랜딩)": "home", "카테고리/상품 목록": "list", "상품 상세": "detail", "장바구니": "inquiry", "결제": "inquiry", "회원가입/로그인": "done", "이벤트/기획전": "home", "기타": "done" };

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const h = { authorization: req.headers.get("authorization") || "", cookie: req.headers.get("cookie") || "" };
  if (!isAuthed(h)) return json(401, { error: "인증이 필요합니다." });
  if (req.method !== "POST") return json(405, { error: "지원하지 않는 메서드" });
  const token = (process.env.GH_DISPATCH_TOKEN || "").trim();
  const repo = (process.env.GH_DISPATCH_REPO || "shadowmiro33-stack/goranisee").trim();
  if (!token) return json(500, { error: "Netlify 환경변수 GH_DISPATCH_TOKEN 이 없습니다. 이 저장소(goranisee)에 Contents 쓰기 권한이 있는 GitHub 토큰을 넣고 재배포하세요." });

  const b = await req.json().catch(() => ({}));
  let url; try { url = new URL(String(b.url || "").trim()); if (!/^https?:$/.test(url.protocol)) throw 0; } catch { return json(400, { error: "올바른 http(s) URL을 입력하세요." }); }
  const request_id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const payload = {
    url: url.href,
    competitor: String(b.competitor || "").trim().slice(0, 80),
    stage: STAGE_KEYS[b.stage] || (/^(home|list|detail|inquiry|done)$/.test(b.stage) ? b.stage : "home"),
    device: b.device === "데스크톱" ? "데스크톱" : b.device === "모바일" ? "모바일" : "둘다",
    request_id,
  };
  const r = await fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "funnel-admin" },
    body: JSON.stringify({ event_type: "funnel_capture", client_payload: payload }),
  });
  if (r.status !== 204) {
    const t = await r.text().catch(() => "");
    return json(502, { error: `GitHub 실행 요청 실패 (HTTP ${r.status}). 토큰 권한(해당 저장소 Contents: Read and write)을 확인하세요. ${t.slice(0, 200)}` });
  }
  return json(200, { ok: true, id: "req-" + request_id, request_id, actions_url: `https://github.com/${repo}/actions/workflows/funnel_capture_request.yml` });
};
export const config = { path: "/api/capture-request" };
