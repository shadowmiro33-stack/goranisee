#!/usr/bin/env node
// 광고 관측값을 어드민(captures, stage=광고데이터)에 기록합니다. GitHub Actions(funnel_observation)에서 사용.
//   node collector/post_observation.cjs '<JSON>'   JSON: {type:"creative_obs"|"brand_obs"|"keyword_obs", competitor_name, channel, creatives, date, note, ...}
const ADMIN = (process.env.FUNNEL_ADMIN_URL || '').replace(/\/+$/, ''), PW = process.env.FUNNEL_ADMIN_PASSWORD || '';
const obs = JSON.parse(process.argv[2] || '{}');
if (!ADMIN || !PW || !obs.type) { console.error('FUNNEL_ADMIN_URL/PASSWORD 와 type 이 필요합니다'); process.exit(2); }
const date = obs.date || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const slug = (s) => Buffer.from(String(s)).toString('base64').replace(/[^a-z0-9]/gi, '').slice(0, 16);
const id = obs.id || (obs.type === 'creative_obs' ? `cr-${date}-${obs.channel}-${slug(obs.competitor_name)}` : obs.type === 'brand_obs' ? `br-${date}-${slug(obs.competitor_name)}` : `kw-${date}-${slug(obs.keyword)}`);
const body = { id, competitor: '_설정', stage: '광고데이터', capturedAt: date + 'T00:00:00+09:00', ...obs, date };
fetch(`${ADMIN}/api/captures`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + PW }, body: JSON.stringify(body) })
  .then(async (r) => { console.log(r.ok ? `기록 완료: ${id}` : `실패 ${r.status} ${await r.text()}`); if (!r.ok) process.exit(1); });
