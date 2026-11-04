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
