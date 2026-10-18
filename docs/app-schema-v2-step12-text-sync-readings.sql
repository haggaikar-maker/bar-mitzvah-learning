begin;

alter table public.text_sync_jobs
  add column if not exists reading_kind text not null default 'weekly_aliyah',
  add column if not exists reading_title text,
  add column if not exists source_book text,
  add column if not exists start_chapter integer,
  add column if not exists start_verse integer,
  add column if not exists end_chapter integer,
  add column if not exists end_verse integer;

alter table public.text_sync_jobs
  alter column aliyah_number drop not null;

alter table public.text_sync_jobs
  drop constraint if exists text_sync_jobs_aliyah_number_check,
  add constraint text_sync_jobs_aliyah_number_check
    check (aliyah_number is null or aliyah_number between 1 and 7),
  add constraint text_sync_jobs_reading_kind_check
    check (reading_kind in ('weekly_aliyah', 'manual_range'));

commit;
