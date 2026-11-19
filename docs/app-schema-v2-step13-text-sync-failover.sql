begin;

alter table public.text_sync_jobs
  add column if not exists claimed_by text,
  add column if not exists lease_expires_at timestamptz;

update public.text_sync_jobs
set lease_expires_at = coalesce(updated_at, now()) + interval '3 minutes'
where status = 'processing' and lease_expires_at is null;

create table if not exists public.text_sync_worker_heartbeats (
  worker_id text primary key,
  worker_kind text not null check (worker_kind in ('local', 'vercel')),
  active_job_id uuid references public.text_sync_jobs(id) on delete set null,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.text_sync_worker_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  message text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_text_sync_worker_heartbeats_last_seen
  on public.text_sync_worker_heartbeats (worker_kind, last_seen_at desc);

create index if not exists idx_text_sync_worker_events_created_at
  on public.text_sync_worker_events (created_at desc);

alter table public.text_sync_worker_heartbeats enable row level security;
alter table public.text_sync_worker_events enable row level security;
revoke all on public.text_sync_worker_heartbeats from public, anon, authenticated;
revoke all on public.text_sync_worker_events from public, anon, authenticated;
grant all on public.text_sync_worker_heartbeats to service_role;
grant all on public.text_sync_worker_events to service_role;
grant usage, select on sequence public.text_sync_worker_events_id_seq to service_role;

drop function if exists public.claim_text_sync_job();
create or replace function public.claim_text_sync_job(p_worker_id text)
returns setof public.text_sync_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  if p_worker_id is null or length(trim(p_worker_id)) = 0 or length(p_worker_id) > 80 then
    raise exception 'Invalid worker id';
  end if;

  select id into claimed_id
  from public.text_sync_jobs
  where status = 'queued'
     or (status = 'processing' and lease_expires_at <= now())
  order by created_at
  for update skip locked
  limit 1;

  if claimed_id is null then
    return;
  end if;

  return query
  update public.text_sync_jobs
  set status = 'processing',
      claimed_by = p_worker_id,
      lease_expires_at = now() + interval '3 minutes',
      progress_percent = case when status = 'queued' then 1 else progress_percent end,
      error_message = null,
      updated_at = now()
  where id = claimed_id
  returning *;
end;
$$;

revoke all on function public.claim_text_sync_job(text) from public, anon, authenticated;
grant execute on function public.claim_text_sync_job(text) to service_role;

commit;
