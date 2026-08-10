create table if not exists whatsapp_message_templates (
  id bigint generated always as identity primary key,
  admin_id bigint not null references admins(id) on delete cascade,
  template_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(admin_id)
);

create index if not exists idx_whatsapp_message_templates_admin_id
  on whatsapp_message_templates(admin_id);
