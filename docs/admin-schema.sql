create table if not exists admins (
  id bigint generated always as identity primary key,
  username text not null unique,
  display_name text not null,
  password_hash text not null,
  role text not null default 'teacher' check (role in ('primary', 'teacher')),
  created_at timestamptz not null default now()
);

create table if not exists admin_student_assignments (
  id bigint generated always as identity primary key,
  admin_id bigint not null references admins(id) on delete cascade,
  student_id bigint not null references students(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (admin_id, student_id)
);

create index if not exists idx_admin_student_assignments_admin_id
  on admin_student_assignments(admin_id);

create index if not exists idx_admin_student_assignments_student_id
  on admin_student_assignments(student_id);

-- Example bootstrap data:
-- Password hash should be sha256 in hex format.
-- Example hash for password "123456": 8d969eef6ecad3c29a3a629280e686cff8fabd... (full hash from app helper)
--
-- insert into admins (username, display_name, password_hash, role)
-- values ('hagai', 'חגי', '<sha256-hex>', 'primary');
