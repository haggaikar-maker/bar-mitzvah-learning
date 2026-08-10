alter table students
add column if not exists whatsapp_phone text null;

create table if not exists whatsapp_messages (
  id bigint generated always as identity primary key,
  student_id bigint not null references students(id) on delete cascade,
  admin_id bigint not null references admins(id) on delete cascade,
  lesson_part_id bigint null references lesson_parts(id) on delete set null,
  message_type text not null,
  recipient_phone text not null,
  message_text text not null,
  lesson_link text null,
  external_message_id text null,
  status text not null default 'sent',
  provider_response jsonb null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_messages_student_id
  on whatsapp_messages(student_id);

create index if not exists idx_whatsapp_messages_admin_id
  on whatsapp_messages(admin_id);

create index if not exists idx_whatsapp_messages_sent_at
  on whatsapp_messages(sent_at desc);
