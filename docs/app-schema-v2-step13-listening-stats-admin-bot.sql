create table if not exists public.student_listening_sessions (
  id uuid primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  lesson_part_id bigint not null references public.lesson_parts(id) on delete cascade,
  duration_seconds integer not null check (duration_seconds > 0),
  listened_seconds integer not null default 0 check (listened_seconds >= 0),
  covered_intervals jsonb not null default '[]'::jsonb,
  coverage_percent numeric(5,2) not null default 0 check (coverage_percent between 0 and 100),
  completed boolean not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index if not exists idx_student_listening_sessions_student_part
  on public.student_listening_sessions(student_id, lesson_part_id, updated_at desc);

alter table public.practice_events
  add column if not exists listening_session_id uuid null
  references public.student_listening_sessions(id) on delete set null;

create unique index if not exists idx_practice_events_listening_session
  on public.practice_events(listening_session_id)
  where listening_session_id is not null;

create table if not exists public.whatsapp_admin_bot_sessions (
  admin_id bigint primary key references public.admins(id) on delete cascade,
  state text not null check (state in ('select_student', 'select_part', 'selected')),
  student_options jsonb not null default '[]'::jsonb,
  part_options jsonb not null default '[]'::jsonb,
  selected_student_id bigint null references public.students(id) on delete cascade,
  selected_lesson_part_id bigint null references public.lesson_parts(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_admin_bot_sessions_updated
  on public.whatsapp_admin_bot_sessions(updated_at);

alter table public.student_listening_sessions enable row level security;
alter table public.whatsapp_admin_bot_sessions enable row level security;
