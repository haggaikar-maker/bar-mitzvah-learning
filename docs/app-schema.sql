create table if not exists parashot (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table if not exists sections (
  id bigint generated always as identity primary key,
  name text not null unique,
  order_index integer not null
);

create table if not exists admins (
  id bigint generated always as identity primary key,
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null default 'teacher' check (role in ('primary', 'teacher')),
  share_code_hash text null,
  created_at timestamptz not null default now()
);

create table if not exists students (
  id bigint generated always as identity primary key,
  user_id uuid null,
  admin_id bigint null references admins(id) on delete set null,
  username text null unique,
  password_hash text null,
  name text not null,
  parasha_id bigint null references parashot(id) on delete set null
);

create table if not exists lesson_groups (
  id bigint generated always as identity primary key,
  admin_id bigint not null references admins(id) on delete cascade,
  parasha_id bigint not null references parashot(id) on delete cascade,
  section_id bigint not null references sections(id) on delete cascade,
  completion_target integer not null default 3,
  unique (admin_id, parasha_id, section_id)
);

create table if not exists lesson_parts (
  id bigint generated always as identity primary key,
  lesson_group_id bigint not null references lesson_groups(id) on delete cascade,
  name text not null,
  part_order integer not null,
  is_full_reading boolean not null default false,
  media_kind text not null default 'audio_slides' check (media_kind in ('audio_slides', 'video')),
  is_visible_to_student boolean not null default true,
  completion_target integer not null default 3,
  audio_url text null,
  video_url text null,
  duration_seconds integer null
);

create table if not exists lesson_slides (
  id bigint generated always as identity primary key,
  lesson_part_id bigint not null references lesson_parts(id) on delete cascade,
  image_url text not null,
  slide_index integer not null,
  start_second integer not null default 0
);

create table if not exists practice_events (
  id bigint generated always as identity primary key,
  student_id bigint not null references students(id) on delete cascade,
  lesson_part_id bigint not null references lesson_parts(id) on delete cascade,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists student_recordings (
  id bigint generated always as identity primary key,
  student_id bigint not null references students(id) on delete cascade,
  lesson_part_id bigint not null references lesson_parts(id) on delete cascade,
  storage_path text not null,
  duration_seconds integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, lesson_part_id)
);

create table if not exists content_share_requests (
  id bigint generated always as identity primary key,
  requester_admin_id bigint not null references admins(id) on delete cascade,
  source_admin_id bigint not null references admins(id) on delete cascade,
  parasha_id bigint not null references parashot(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  responded_at timestamptz null
);

alter table students add column if not exists admin_id bigint null references admins(id) on delete set null;
alter table students add column if not exists username text null;
alter table students add column if not exists password_hash text null;
alter table admins add column if not exists share_code_hash text null;
alter table lesson_groups add column if not exists admin_id bigint null references admins(id) on delete cascade;
alter table lesson_groups add column if not exists completion_target integer not null default 3;
alter table lesson_parts add column if not exists media_kind text not null default 'audio_slides';
alter table lesson_parts add column if not exists is_visible_to_student boolean not null default true;
alter table lesson_parts add column if not exists completion_target integer not null default 3;
alter table lesson_parts add column if not exists video_url text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'lesson_parts_media_kind_check'
  ) then
    alter table lesson_parts
      add constraint lesson_parts_media_kind_check
      check (media_kind in ('audio_slides', 'video'));
  end if;
end $$;

create table if not exists student_recordings (
  id bigint generated always as identity primary key,
  student_id bigint not null references students(id) on delete cascade,
  lesson_part_id bigint not null references lesson_parts(id) on delete cascade,
  storage_path text not null,
  duration_seconds integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'student_recordings_student_id_lesson_part_id_key'
  ) then
    alter table student_recordings
      add constraint student_recordings_student_id_lesson_part_id_key
      unique (student_id, lesson_part_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'students_username_unique_idx'
  ) then
    create unique index students_username_unique_idx
      on students (username)
      where username is not null;
  end if;
end $$;

create index if not exists idx_students_admin_id on students(admin_id);
create index if not exists idx_students_parasha_id on students(parasha_id);
create index if not exists idx_lesson_groups_admin_parasha_section on lesson_groups(admin_id, parasha_id, section_id);
create index if not exists idx_lesson_parts_group on lesson_parts(lesson_group_id, part_order);
create index if not exists idx_lesson_slides_part on lesson_slides(lesson_part_id, slide_index);
create index if not exists idx_practice_events_student_part on practice_events(student_id, lesson_part_id);
create index if not exists idx_student_recordings_student_part on student_recordings(student_id, lesson_part_id);
create index if not exists idx_share_requests_source on content_share_requests(source_admin_id, status);
create index if not exists idx_share_requests_requester on content_share_requests(requester_admin_id, status);

drop table if exists admin_student_assignments;
