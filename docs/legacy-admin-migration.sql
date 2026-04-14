-- Migration for assigning legacy data to one existing admin.
-- Run this only after the new schema in docs/app-schema.sql was applied.
--
-- Before running:
-- 1. Replace HAGAI_USERNAME with the real username from the admins table.
-- 2. Review the preview queries first.
-- 3. Then run the update statements.

-- Preview the admin row that will receive the legacy data.
select id, username, display_name, role
from admins
where username = 'HAGAI_USERNAME';

-- Preview legacy students that currently have no admin.
select id, name, username, parasha_id
from students
where admin_id is null
order by id;

-- Preview legacy lesson groups that currently have no admin.
select id, parasha_id, section_id
from lesson_groups
where admin_id is null
order by id;

-- Assign all legacy students without a manager to this admin.
update students
set admin_id = (
  select id
  from admins
  where username = 'HAGAI_USERNAME'
)
where admin_id is null;

-- Assign all legacy lesson groups without a manager to this admin.
update lesson_groups
set admin_id = (
  select id
  from admins
  where username = 'HAGAI_USERNAME'
)
where admin_id is null;

-- Optional: generate fallback usernames for old students that do not have one yet.
-- This is useful so legacy students can log in immediately.
update students
set username = 'student_' || id
where username is null;

-- Optional: set the same temporary password for all legacy students that do not have one yet.
-- Replace TEMP_PASSWORD_SHA256 with a real sha256 hash before running.
update students
set password_hash = 'TEMP_PASSWORD_SHA256'
where password_hash is null;

-- Verification: all legacy rows should now be linked.
select count(*) as students_without_admin
from students
where admin_id is null;

select count(*) as lesson_groups_without_admin
from lesson_groups
where admin_id is null;
