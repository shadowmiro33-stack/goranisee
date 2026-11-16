-- Supabase → SQL Editor 에 붙여넣고 Run 한 번만 실행하세요.
create table if not exists captures (
  id          text primary key,
  competitor  text not null,
  stage       text not null,
  device      text,
  note        text,
  url         text,
  title       text,
  captured_at timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  data        jsonb not null default '{}'::jsonb,
  screenshot  text
);
create index if not exists captures_comp_stage_idx on captures (competitor, stage, captured_at desc);

-- 서비스 키로만 접근하므로 공개 접근은 막아둡니다.
alter table captures enable row level security;

-- ───────────────────────────────────────────────
-- 우리 사이트 분석 (track.js 가 보내는 이벤트). 한 번만 실행.
create table if not exists events (
  id          bigint generated always as identity primary key,
  site        text not null,
  visitor_id  text not null,
  session_id  text not null,
  type        text not null,         -- pageview | leave | scroll | click | event | ab | rr
  name        text,                  -- event 이름 / ab 테스트 이름
  path        text,
  url         text,
  referrer    text,
  source      text,                  -- direct | search | social | ad | referral | 인스타 등 분류
  device      text,                  -- mobile | desktop
  ts          timestamptz not null default now(),
  data        jsonb not null default '{}'::jsonb
);
create index if not exists events_site_ts_idx on events (site, ts desc);
create index if not exists events_site_type_idx on events (site, type, ts desc);
create index if not exists events_session_idx on events (session_id, ts);
alter table events enable row level security;
