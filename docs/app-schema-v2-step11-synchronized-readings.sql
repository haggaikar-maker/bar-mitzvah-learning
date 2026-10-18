begin;

create table if not exists public.text_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_admin_id bigint not null references public.admins(id) on delete cascade,
  student_id bigint not null references public.students(id) on delete cascade,
  lesson_part_id bigint not null references public.lesson_parts(id) on delete cascade,
  parasha_name text not null,
  aliyah_number smallint not null check (aliyah_number between 1 and 7),
  audio_object_path text not null,
  audio_public_url text not null,
  source_ref text,
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'completed', 'failed', 'approved', 'rejected')),
  progress_percent smallint not null default 0 check (progress_percent between 0 and 100),
  result_json jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_text_sync_jobs_queue
  on public.text_sync_jobs (status, created_at)
  where status in ('queued', 'processing');

create index if not exists idx_text_sync_jobs_owner
  on public.text_sync_jobs (owner_admin_id, created_at desc);

create table if not exists public.student_lesson_part_readings (
  id bigint generated always as identity primary key,
  student_id bigint not null references public.students(id) on delete cascade,
  lesson_part_id bigint not null references public.lesson_parts(id) on delete cascade,
  audio_object_path text not null,
  audio_url text not null,
  source_ref text not null,
  source_text text not null,
  word_timings jsonb not null,
  approved_by_admin_id bigint null references public.admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, lesson_part_id)
);

create or replace function public.claim_text_sync_job()
returns setof public.text_sync_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_id uuid;
begin
  select id into claimed_id
  from public.text_sync_jobs
  where status = 'queued'
  order by created_at
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.text_sync_jobs
  set status = 'processing', progress_percent = 1, updated_at = now()
  where id = claimed_id
  returning *;
end;
$$;

revoke all on function public.claim_text_sync_job() from public, anon, authenticated;
grant execute on function public.claim_text_sync_job() to service_role;

alter table public.text_sync_jobs enable row level security;
alter table public.student_lesson_part_readings enable row level security;

commit;
