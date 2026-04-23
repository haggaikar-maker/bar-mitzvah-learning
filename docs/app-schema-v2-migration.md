# Migration notes for the teacher-library model

This document maps the current schema to the new `teacher_parashot` model.

## Files in this proposal

- `docs/app-schema-v2.sql`: target architecture
- `docs/app-schema-v2-step1.sql`: safe additive migration that can run now

## What changes conceptually

- A teacher owns a parasha library item even if no students are assigned.
- A student is assigned to a teacher-owned parasha item, not directly to a
  generic `parasha_id`.
- Nusach becomes mandatory for each teacher-owned parasha item.
- Frozen parashot are hidden from students and blocked for new assignment.
- Deactivating a teacher should not delete their content. Use admin `status`
  instead of physical delete.

## Current tables and their v2 mapping

### `students`

Current:
- `admin_id`
- `parasha_id`

Target:
- keep `students`
- remove dependency on `students.parasha_id`
- create one active row in `student_teacher_parasha_assignments`

### `lesson_groups`

Current:
- owned by `(admin_id, parasha_id, section_id)`

Target:
- owned by `teacher_parasha_id`

### `lesson_parts`, `lesson_slides`, `practice_events`, `student_recordings`

Current:
- already good enough structurally

Target:
- keep them
- reconnect them through `lesson_groups.teacher_parasha_id`

## Recommended migration stages

### Stage 1: add new master tables without breaking the current app

1. Create `nusachim`
2. Create `teacher_parashot`
3. Create `student_teacher_parasha_assignments`
4. Add `teacher_parasha_id` to `lesson_groups` as nullable

### Stage 2: backfill teacher-owned parashot

Current data does not reliably know nusach, so each existing teacher+parasha
combination must be backfilled with either:

- a real chosen nusach, or
- the seeded fallback nusach `לא הוגדר`

Suggested seed query shape:

```sql
insert into teacher_parashot (
  owner_admin_id,
  parasha_id,
  nusach_id,
  variant_number,
  status,
  created_by_admin_id
)
select
  lg.admin_id,
  lg.parasha_id,
  n.id,
  1,
  'active',
  lg.admin_id
from (
  select distinct admin_id, parasha_id
  from lesson_groups
  where admin_id is not null
) lg
join nusachim n on n.slug = 'unspecified'
on conflict (owner_admin_id, parasha_id, nusach_id, variant_number) do nothing;
```

### Stage 3: backfill `lesson_groups.teacher_parasha_id`

For each old `lesson_group`, connect it to the matching `teacher_parasha`.

```sql
update lesson_groups lg
set teacher_parasha_id = tp.id
from teacher_parashot tp
join nusachim n on n.id = tp.nusach_id
where tp.owner_admin_id = lg.admin_id
  and tp.parasha_id = lg.parasha_id
  and n.slug = 'unspecified'
  and lg.teacher_parasha_id is null;
```

### Stage 4: backfill student assignment

Each student currently points to `(admin_id, parasha_id)`.
Create one active assignment to the matching `teacher_parasha`.

```sql
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
on conflict do nothing;
```

### Stage 5: update app code

The app should then move from:

- `students.parasha_id`
- `lesson_groups.admin_id + lesson_groups.parasha_id`

to:

- `student_teacher_parasha_assignments.teacher_parasha_id`
- `lesson_groups.teacher_parasha_id`

### Stage 6: cleanup after code is stable

Only after the code is fully migrated:

- stop using `students.parasha_id`
- stop using `lesson_groups.admin_id`
- stop using `lesson_groups.parasha_id`

## Important product rules to enforce in code

1. A teacher may import only from another `teacher_parasha` with the same
   `nusach_id`.
2. Students never see `variant_number`.
3. Frozen `teacher_parashot` do not appear to students.
4. Frozen `teacher_parashot` cannot be assigned to new students.
5. Primary admins may browse all teachers and all teacher-owned parashot.
6. Teacher deletion should become teacher deactivation.
