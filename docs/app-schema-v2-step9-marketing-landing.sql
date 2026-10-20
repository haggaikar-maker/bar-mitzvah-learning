create table if not exists marketing_demo_sessions (
  id bigserial primary key,
  raw_phone text not null,
  normalized_phone text not null unique,
  demo_student_id bigint not null references students(id) on delete cascade,
  status text not null default 'active',
  requested_template_name text null,
  lead_name text null,
  lead_role text null,
  lead_email text null,
  lead_notes text null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_marketing_demo_sessions_demo_student
  on marketing_demo_sessions (demo_student_id, expires_at desc);

create table if not exists marketing_leads (
  id bigserial primary key,
  source text not null,
  full_name text null,
  contact_role text null,
  phone text null,
  normalized_phone text null,
  email text null,
  notes text null,
  related_demo_session_id bigint null references marketing_demo_sessions(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_marketing_leads_created_at
  on marketing_leads (created_at desc);

create index if not exists idx_marketing_leads_phone
  on marketing_leads (normalized_phone);

alter table marketing_demo_sessions enable row level security;
alter table marketing_leads enable row level security;
