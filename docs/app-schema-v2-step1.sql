-- Step 1 migration to the teacher-library model
-- Safe/additive migration only.
-- This script does NOT remove the current schema or break the running app.
-- It introduces the new tables and backfills them from the current data.

begin;

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

alter table admins
  add column if not exists status text not null default 'active';
alter table admins
  add column if not exists city text null;
alter table admins
  add column if not exists email text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admins_status_check'
  ) then
    alter table admins
      add constraint admins_status_check
      check (status in ('active', 'inactive'));
  end if;
end $$;

alter table admins add column if not exists updated_at timestamptz not null default now();
alter table admins add column if not exists deactivated_at timestamptz null;

alter table students add column if not exists created_at timestamptz not null default now();
alter table students add column if not exists updated_at timestamptz not null default now();

create table if not exists teacher_parashot (
  id bigint generated always as identity primary key,
  owner_admin_id bigint not null references admins(id) on delete restrict,
  parasha_id bigint not null references parashot(id) on delete restrict,
  nusach_id bigint not null references nusachim(id) on delete restrict,
  variant_number integer not null default 1,
  status text not null default 'active'
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

alter table lesson_groups
  add column if not exists teacher_parasha_id bigint null references teacher_parashot(id) on delete cascade;

create index if not exists idx_lesson_groups_teacher_parasha
  on lesson_groups (teacher_parasha_id, section_id);

-- Backfill one teacher-owned parasha per current admin+parasha pair
-- using the fallback nusach "לא הוגדר".
insert into teacher_parashot (
  owner_admin_id,
  parasha_id,
  nusach_id,
  variant_number,
  status,
  created_by_admin_id
)
select
  src.admin_id,
  src.parasha_id,
  n.id,
  1,
  'active',
  src.admin_id
from (
  select distinct admin_id, parasha_id
  from lesson_groups
  where admin_id is not null
    and parasha_id is not null
) as src
join nusachim n on n.slug = 'unspecified'
on conflict (owner_admin_id, parasha_id, nusach_id, variant_number) do nothing;

-- Connect the old lesson_groups rows to the new teacher_parashot rows.
update lesson_groups lg
set teacher_parasha_id = tp.id
from teacher_parashot tp
join nusachim n on n.id = tp.nusach_id
where lg.teacher_parasha_id is null
  and lg.admin_id = tp.owner_admin_id
  and lg.parasha_id = tp.parasha_id
  and n.slug = 'unspecified';

-- Create active student assignments from the current admin_id + parasha_id model.
insert into student_teacher_parasha_assignments (
  student_id,
  teacher_parasha_id,
  assigned_by_admin_id,
  status
)
select
  s.id,
  tp.id,
  s.admin_id,
  'active'
from students s
join teacher_parashot tp
  on tp.owner_admin_id = s.admin_id
 and tp.parasha_id = s.parasha_id
join nusachim n
  on n.id = tp.nusach_id
 and n.slug = 'unspecified'
where s.admin_id is not null
  and s.parasha_id is not null
  and not exists (
    select 1
    from student_teacher_parasha_assignments stpa
    where stpa.student_id = s.id
      and stpa.status = 'active'
  );

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

commit;
