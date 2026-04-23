-- Proposed schema v2
-- Goal: separate teacher-owned parasha libraries from student assignment.
-- This file is a target architecture proposal and should be migrated in stages.

create table if not exists parashot (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table if not exists sections (
  id bigint generated always as identity primary key,
  name text not null unique,
  order_index integer not null
);

create table if not exists nusachim (
  id bigint generated always as identity primary key,
  slug text not null unique,
  name text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into nusachim (slug, name)
values
  ('unspecified', 'לא הוגדר'),
  ('ashkenazi', 'אשכנזי'),
  ('edot-mizrach', 'אשכנז'),
  ('moroccan', 'מרוקאי'),
  ('yerushalmi', 'ירושלמי'),
  ('temani', 'תימני')
on conflict (slug) do nothing;

create table if not exists admins (
  id bigint generated always as identity primary key,
  username text not null unique,
  display_name text not null,
  city text null,
  email text null,
  password_hash text not null,
  role text not null default 'teacher' check (role in ('primary', 'teacher')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  share_code_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz null
);

create table if not exists students (
  id bigint generated always as identity primary key,
  user_id uuid null,
  admin_id bigint null references admins(id) on delete set null,
  username text null,
  password_hash text null,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists students_username_unique_idx
  on students (username)
  where username is not null;

-- Teacher-owned library item.
-- A teacher may hold multiple versions of the same parasha in the same nusach.
-- variant_number is internal only; students should not see it.
create table if not exists teacher_parashot (
  id bigint generated always as identity primary key,
  owner_admin_id bigint not null references admins(id) on delete restrict,
  parasha_id bigint not null references parashot(id) on delete restrict,
  nusach_id bigint not null references nusachim(id) on delete restrict,
  variant_number integer not null default 1,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'frozen', 'archived')),
  freeze_reason text null,
  notes text null,
  source_teacher_parasha_id bigint null references teacher_parashot(id) on delete set null,
  created_by_admin_id bigint null references admins(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  frozen_at timestamptz null,
  archived_at timestamptz null,
  unique (owner_admin_id, parasha_id, nusach_id, variant_number)
);

create index if not exists idx_teacher_parashot_owner
  on teacher_parashot (owner_admin_id, status, nusach_id);

create index if not exists idx_teacher_parashot_parasha
  on teacher_parashot (parasha_id, nusach_id, status);

-- Import provenance: a teacher can copy full content or selected parts from
-- another teacher only when both belong to the same nusach.
create table if not exists teacher_parasha_import_batches (
  id bigint generated always as identity primary key,
  target_teacher_parasha_id bigint not null references teacher_parashot(id) on delete cascade,
  source_teacher_parasha_id bigint not null references teacher_parashot(id) on delete restrict,
  imported_by_admin_id bigint not null references admins(id) on delete restrict,
  scope text not null check (scope in ('full_parasha', 'section', 'selected_parts')),
  created_at timestamptz not null default now(),
  note text null
);

create table if not exists teacher_parasha_import_items (
  id bigint generated always as identity primary key,
  import_batch_id bigint not null references teacher_parasha_import_batches(id) on delete cascade,
  source_lesson_part_id bigint null,
  target_lesson_part_id bigint null,
  created_at timestamptz not null default now()
);

-- Student assignment is now explicit.
-- A student is assigned to a teacher-owned parasha, not to a generic parasha row.
create table if not exists student_teacher_parasha_assignments (
  id bigint generated always as identity primary key,
  student_id bigint not null references students(id) on delete cascade,
  teacher_parasha_id bigint not null references teacher_parashot(id) on delete restrict,
  assigned_by_admin_id bigint null references admins(id) on delete set null,
  status text not null default 'active'
    check (status in ('active', 'ended')),
  assigned_at timestamptz not null default now(),
  ended_at timestamptz null
);

create unique index if not exists idx_student_active_teacher_parasha_assignment
  on student_teacher_parasha_assignments (student_id)
  where status = 'active';

create index if not exists idx_student_teacher_parasha_assignments_parasha
  on student_teacher_parasha_assignments (teacher_parasha_id, status);

create table if not exists lesson_groups (
  id bigint generated always as identity primary key,
  teacher_parasha_id bigint not null references teacher_parashot(id) on delete cascade,
  section_id bigint not null references sections(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_parasha_id, section_id)
);

create index if not exists idx_lesson_groups_teacher_parasha
  on lesson_groups (teacher_parasha_id, section_id);

create table if not exists lesson_parts (
  id bigint generated always as identity primary key,
  lesson_group_id bigint not null references lesson_groups(id) on delete cascade,
  name text not null,
  part_order integer not null,
  is_full_reading boolean not null default false,
  media_kind text not null default 'audio_slides'
    check (media_kind in ('audio_slides', 'video')),
  default_is_visible_to_student boolean not null default true,
  completion_target integer not null default 3,
  audio_url text null,
  video_url text null,
  duration_seconds integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lesson_parts_group
  on lesson_parts (lesson_group_id, part_order);

create table if not exists lesson_slides (
  id bigint generated always as identity primary key,
  lesson_part_id bigint not null references lesson_parts(id) on delete cascade,
  image_url text not null,
  slide_index integer not null,
  start_second integer not null default 0
);

create index if not exists idx_lesson_slides_part
  on lesson_slides (lesson_part_id, slide_index);

create table if not exists practice_events (
  id bigint generated always as identity primary key,
  student_id bigint not null references students(id) on delete cascade,
  lesson_part_id bigint not null references lesson_parts(id) on delete cascade,
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_practice_events_student_part
  on practice_events (student_id, lesson_part_id);

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

create index if not exists idx_student_recordings_student_part
  on student_recordings (student_id, lesson_part_id);

-- Per-student override. This is where a teacher decides which sub-parts are
-- currently exposed for a specific student.
create table if not exists student_lesson_part_settings (
  id bigint generated always as identity primary key,
  student_id bigint not null references students(id) on delete cascade,
  lesson_part_id bigint not null references lesson_parts(id) on delete cascade,
  is_visible_to_student boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, lesson_part_id)
);

create index if not exists idx_student_lesson_part_settings_student_part
  on student_lesson_part_settings (student_id, lesson_part_id);

-- Optional helper view for UI:
-- internal_display_name is for managers/teachers.
-- student_display_name intentionally hides the variant number.
create or replace view teacher_parasha_catalog_view as
select
  tp.id,
  tp.owner_admin_id,
  a.display_name as owner_display_name,
  tp.parasha_id,
  p.name as parasha_name,
  tp.nusach_id,
  n.name as nusach_name,
  tp.variant_number,
  tp.status,
  tp.freeze_reason,
  case
    when tp.variant_number > 1 then p.name || ' (' || tp.variant_number || ')'
    else p.name
  end as internal_display_name,
  p.name as student_display_name,
  tp.created_at,
  tp.updated_at
from teacher_parashot tp
join admins a on a.id = tp.owner_admin_id
join parashot p on p.id = tp.parasha_id
join nusachim n on n.id = tp.nusach_id;
