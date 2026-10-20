-- Manager WhatsApp menus store their navigation state between incoming messages.
-- This migration is safe to run after step13 and keeps existing sessions intact.
alter table public.whatsapp_admin_bot_sessions
  add column if not exists selected_action text null;

alter table public.whatsapp_admin_bot_sessions
  alter column part_options set default '{"groups": [], "items": []}'::jsonb;

update public.whatsapp_admin_bot_sessions
set part_options = '{"groups": [], "items": []}'::jsonb
where jsonb_typeof(part_options) is distinct from 'object'
   or not (part_options ? 'groups')
   or not (part_options ? 'items');

alter table public.whatsapp_admin_bot_sessions
  drop constraint if exists whatsapp_admin_bot_sessions_state_check;

alter table public.whatsapp_admin_bot_sessions
  add constraint whatsapp_admin_bot_sessions_state_check
  check (state in ('select_student', 'select_action', 'select_section', 'select_part', 'selected'));

alter table public.whatsapp_admin_bot_sessions
  drop constraint if exists whatsapp_admin_bot_sessions_selected_action_check;

alter table public.whatsapp_admin_bot_sessions
  add constraint whatsapp_admin_bot_sessions_selected_action_check
  check (selected_action is null or selected_action in ('student_recordings', 'teacher_recordings', 'reminders', 'statistics'));

create index if not exists idx_whatsapp_messages_student_inbound_recent
  on public.whatsapp_messages(student_id, created_at desc)
  where message_type = 'student_inbound';
