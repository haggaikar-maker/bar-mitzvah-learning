alter table admins
  add column if not exists whatsapp_phone text null;

create table if not exists whatsapp_contact_sessions (
  id bigint generated always as identity primary key,
  student_id bigint not null references students(id) on delete cascade,
  admin_id bigint not null references admins(id) on delete cascade,
  status text not null check (status in ('awaiting_student_message', 'awaiting_admin_reply')),
  initiated_by text not null check (initiated_by in ('student', 'admin')),
  last_student_message text null,
  last_admin_message text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, admin_id)
);

create index if not exists idx_whatsapp_contact_sessions_admin_status
  on whatsapp_contact_sessions (admin_id, status, updated_at desc);

create index if not exists idx_whatsapp_contact_sessions_student_status
  on whatsapp_contact_sessions (student_id, status, updated_at desc);
