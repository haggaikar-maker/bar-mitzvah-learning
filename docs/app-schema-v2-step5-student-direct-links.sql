create table if not exists student_access_links (
  id bigint generated always as identity primary key,
  token_hash text not null unique,
  student_id bigint not null references students(id) on delete cascade,
  lesson_part_id bigint not null references lesson_parts(id) on delete cascade,
  created_by_admin_id bigint null references admins(id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_student_access_links_student_id
  on student_access_links(student_id);

create index if not exists idx_student_access_links_expires_at
  on student_access_links(expires_at);
