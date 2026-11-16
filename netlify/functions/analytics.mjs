// 우리 사이트 분석 조회 (어드민 → GET /api/analytics?site=&days=&view=summary|heatmap|sessions|session)
// 집계는 최근 N일 이벤트(최대 2만 건)를 읽어 서버에서 계산합니다. 규모가 커지면 SQL 뷰로 옮기면 됩니다.
import { db, isAuthed, CORS } from "../../lib/core.js";
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });
const day = (ts) => new Date(new Date(ts).getTime() + 9 * 3600e3).toISOString().slice(0, 10); // KST 날짜
const weekOf = (ts) => { const d = new Date(new Date(ts).getTime() + 9 * 3600e3); const w = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay())); return w.toISOString().slice(0, 10); };
const inc = (m, k, n = 1) => { m[k] = (m[k] || 0) + n; };
const top = (m, n = 12) => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));

export default async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const h = { authorization: req.headers.get("authorization") || "", cookie: req.headers.get("cookie") || "" };
  if (!isAuthed(h)) return json(401, { error: "인증이 필요합니다." });
  const u = new URL(req.url);
  const site = u.searchParams.get("site") || "";
  const days = Math.min(90, Math.max(1, parseInt(u.searchParams.get("days") || "14") || 14));
  const view = u.searchParams.get("view") || "summary";
  const since = new Date(Date.now() - days * 86400e3).toISOString();
  const supa = db();

  if (view === "sites") {
    const { data, error } = await supa.from("events").select("site").gte("ts", since).limit(5000);
    if (error) return json(500, { error: error.message });
    return json(200, { sites: [...new Set((data || []).map((r) => r.site))] });
  }
  if (view === "session") {
    const sid = u.searchParams.get("sid") || "";
    const { data, error } = await supa.from("events").select("type,name,path,ts,data").eq("session_id", sid).order("ts", { ascending: true }).limit(500);
    if (error) return json(500, { error: error.message });
    const rr = []; const steps = [];
    for (const r of data || []) { if (r.type === "rr") rr.push(...(r.data?.events || [])); else steps.push({ type: r.type, name: r.name, path: r.path, ts: r.ts, data: r.type === "rr" ? undefined : r.data }); }
    return json(200, { steps, rr });
  }

  const sel = view === "heatmap" ? "type,path,device,data,ts" : "type,name,path,referrer,source,device,visitor_id,session_id,ts,data";
  let q = supa.from("events").select(sel).gte("ts", since).neq("type", "rr").order("ts", { ascending: false }).limit(20000);
  if (site) q = q.eq("site", site);
  if (view === "heatmap") { const p = u.searchParams.get("path") || "/"; q = q.eq("type", "click").eq("path", p); }
  const { data, error } = await q;
  if (error) return json(500, { error: /relation .*events|Could not find the table/i.test(error.message) ? "Supabase에 events 테이블이 없습니다. schema.sql의 events 부분을 실행하세요." : error.message });
  const rows = data || [];

  if (view === "heatmap") return json(200, { points: rows.map((r) => ({ x: r.data?.x, y: r.data?.y, d: r.device, n: r.data?.tag })).filter((p) => p.x != null && p.y != null), total: rows.length });
  if (view === "sessions") {
    const bySid = {};
    for (const r of rows) { const s = (bySid[r.session_id] = bySid[r.session_id] || { sid: r.session_id, vid: r.visitor_id, start: r.ts, end: r.ts, pages: new Set(), events: 0, source: r.source, device: r.device, conv: false, recorded: false }); if (r.ts < s.start) s.start = r.ts; if (r.ts > s.end) s.end = r.ts; if (r.type === "pageview") s.pages.add(r.path); if (r.type === "event") { s.events++; if (r.data?.conversion) s.conv = true; } }
    // 레코딩 유무: rr 이벤트가 있는 세션만 별도 조회
    const { data: rr } = await supa.from("events").select("session_id").eq("type", "rr").gte("ts", since).limit(5000);
    const rec = new Set((rr || []).map((r) => r.session_id));
    const list = Object.values(bySid).map((s) => ({ ...s, pages: [...s.pages], recorded: rec.has(s.sid), dur_s: Math.round((new Date(s.end) - new Date(s.start)) / 1000) })).sort((a, b) => new Date(b.start) - new Date(a.start)).slice(0, 200);
    return json(200, { sessions: list });
  }

  // ── summary: 9개 패널 ──
  const pv = rows.filter((r) => r.type === "pageview"), lv = rows.filter((r) => r.type === "leave" && !r.data?.partial), ev = rows.filter((r) => r.type === "event"), ab = rows.filter((r) => r.type === "ab"), clicks = rows.filter((r) => r.type === "click");
  const byDay = {}, byPath = {}, bySource = {}, byDevice = {}, visitorsByDay = {};
  pv.forEach((r) => { inc(byDay, day(r.ts)); inc(byPath, r.path || "/"); inc(bySource, r.source || "direct"); inc(byDevice, r.device || "?"); (visitorsByDay[day(r.ts)] = visitorsByDay[day(r.ts)] || new Set()).add(r.visitor_id); });
  const visitors = new Set(pv.map((r) => r.visitor_id)).size, sessions = new Set(pv.map((r) => r.session_id)).size;
  // 체류시간: leave 기준 (활성 시간)
  const durByPath = {}, durN = {}; let durSum = 0, durCnt = 0;
  lv.forEach((r) => { const d = +r.data?.duration_ms || 0; durSum += d; durCnt++; inc(durByPath, r.path || "/", d); inc(durN, r.path || "/"); });
  const avgTime = durCnt ? Math.round(durSum / durCnt / 1000) : 0;
  const timeByPath = Object.keys(durByPath).map((p) => ({ k: p, v: Math.round(durByPath[p] / durN[p] / 1000), n: durN[p] })).sort((a, b) => b.n - a.n).slice(0, 12);
  // 이탈(5초 미만 체류 세션 비율)
  const bounce = durCnt ? Math.round((lv.filter((r) => (+r.data?.duration_ms || 0) < 5000).length / durCnt) * 100) : 0;
  // 스크롤 깊이 분포
  const depthBins = { "25%": 0, "50%": 0, "75%": 0, "100%": 0 }; lv.forEach((r) => { const d = +r.data?.depth || 0; if (d >= 25) depthBins["25%"]++; if (d >= 50) depthBins["50%"]++; if (d >= 75) depthBins["75%"]++; if (d >= 100) depthBins["100%"]++; });
  const depthPct = Object.fromEntries(Object.entries(depthBins).map(([k, v]) => [k, durCnt ? Math.round((v / durCnt) * 100) : 0]));
  const depthByPath = {}; lv.forEach((r) => { const p = r.path || "/"; (depthByPath[p] = depthByPath[p] || []).push(+r.data?.depth || 0); });
  const scrollByPath = Object.entries(depthByPath).map(([p, arr]) => ({ k: p, v: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length), n: arr.length })).sort((a, b) => b.n - a.n).slice(0, 12);
  // 이벤트
  const evByName = {}, convByName = {}; ev.forEach((r) => { inc(evByName, r.name || "(이름 없음)"); if (r.data?.conversion) inc(convByName, r.name || "(이름 없음)"); });
  const clickByName = {}; clicks.forEach((r) => { if (r.name) inc(clickByName, r.name); });
  const convSessions = new Set(ev.filter((r) => r.data?.conversion).map((r) => r.session_id)).size;
  // 유입경로별 전환
  const sessSource = {}; pv.forEach((r) => { if (!sessSource[r.session_id]) sessSource[r.session_id] = r.source || "direct"; });
  const convBySource = {}; ev.filter((r) => r.data?.conversion).forEach((r) => inc(convBySource, sessSource[r.session_id] || "direct"));
  const sessBySource = {}; Object.values(sessSource).forEach((s) => inc(sessBySource, s));
  const sources = top(sessBySource, 12).map((o) => ({ ...o, conv: convBySource[o.k] || 0, rate: o.v ? +(((convBySource[o.k] || 0) / o.v) * 100).toFixed(1) : 0 }));
  // 코호트: 첫 방문 주차별 재방문율 (주 단위, 최근 8주)
  const firstSeen = {}; const weeks = {};
  [...pv].sort((a, b) => new Date(a.ts) - new Date(b.ts)).forEach((r) => { const w = weekOf(r.ts); if (!firstSeen[r.visitor_id]) firstSeen[r.visitor_id] = w; (weeks[r.visitor_id] = weeks[r.visitor_id] || new Set()).add(w); });
  const cohortWeeks = [...new Set(Object.values(firstSeen))].sort().slice(-8);
  const cohort = cohortWeeks.map((w0) => { const vids = Object.keys(firstSeen).filter((v) => firstSeen[v] === w0); const n = vids.length; const row = []; for (let i = 0; i < 6; i++) { const wi = new Date(new Date(w0).getTime() + i * 7 * 86400e3).toISOString().slice(0, 10); if (new Date(wi) > new Date()) break; const ret = vids.filter((v) => weeks[v].has(wi)).length; row.push(n ? Math.round((ret / n) * 100) : 0); } return { week: w0, n, row }; });
  // A/B: 테스트별 변형 → 세션 수 / 전환 세션 수
  const abTests = {}; const abSess = {};
  ab.forEach((r) => { const t = r.name || "test", v = r.data?.variant || "?"; (abTests[t] = abTests[t] || {}); (abTests[t][v] = abTests[t][v] || { sessions: new Set(), conv: 0 }).sessions.add(r.session_id); abSess[r.session_id + "|" + t] = v; });
  ev.filter((r) => r.data?.conversion).forEach((r) => { Object.keys(abTests).forEach((t) => { const v = abSess[r.session_id + "|" + t]; if (v && abTests[t][v]) abTests[t][v].conv++; }); });
  const abOut = Object.entries(abTests).map(([t, vs]) => ({ test: t, variants: Object.entries(vs).map(([v, o]) => ({ variant: v, sessions: o.sessions.size, conv: o.conv, rate: o.sessions.size ? +((o.conv / o.sessions.size) * 100).toFixed(1) : 0 })) }));
  return json(200, {
    site, days, rowsRead: rows.length,
    pageview: { total: pv.length, visitors, sessions, byDay: Object.entries(byDay).sort().map(([k, v]) => ({ k, v, u: (visitorsByDay[k] || new Set()).size })), byPath: top(byPath), byDevice: top(byDevice, 4) },
    time: { avg_s: avgTime, bounce_pct: bounce, n: durCnt, byPath: timeByPath },
    source: { sessions: sources, conversions: convSessions },
    events: { byName: top(evByName, 15), conversions: top(convByName, 10), clicksByName: top(clickByName, 15), total: ev.length },
    heatmap: { paths: top(Object.fromEntries(clicks.map((r) => [r.path || "/", 0]).map(([p]) => [p, clicks.filter((c) => (c.path || "/") === p).length])), 10), total: clicks.length },
    scroll: { pct: depthPct, byPath: scrollByPath, n: durCnt },
    cohort: { weeks: cohort },
    ab: abOut,
  });
};
export const config = { path: "/api/analytics" };
