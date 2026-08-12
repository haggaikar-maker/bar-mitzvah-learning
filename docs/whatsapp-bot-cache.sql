create table if not exists student_whatsapp_catalog_state (
  student_id bigint primary key references students(id) on delete cascade,
  admin_id bigint null references admins(id) on delete set null,
  student_name text not null,
  whatsapp_phone text null,
  whatsapp_phone_normalized text null,
  torah_reading_date date null,
  active_teacher_parasha_id bigint null references teacher_parashot(id) on delete set null,
  available_part_count integer not null default 0,
  recommended_lesson_part_id bigint null references lesson_parts(id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_student_whatsapp_catalog_state_phone
  on student_whatsapp_catalog_state (whatsapp_phone_normalized)
  where whatsapp_phone_normalized is not null;

create index if not exists idx_student_whatsapp_catalog_state_teacher_parasha
  on student_whatsapp_catalog_state (active_teacher_parasha_id);

create table if not exists student_whatsapp_catalog_items (
  id bigint generated always as identity primary key,
  student_id bigint not null references students(id) on delete cascade,
  active_teacher_parasha_id bigint not null references teacher_parashot(id) on delete cascade,
  lesson_part_id bigint not null references lesson_parts(id) on delete cascade,
  lesson_group_id bigint not null references lesson_groups(id) on delete cascade,
  display_index integer not null,
  section_name text not null,
  section_order_index integer not null default 0,
  part_name text not null,
  part_order integer not null,
  completion_target integer not null default 3,
  completed_count integer not null default 0,
  media_kind text not null check (media_kind in ('audio_slides', 'video')),
  media_url text null,
  audio_url text null,
  video_url text null,
  slide_count integer not null default 0,
  is_recommended boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (student_id, lesson_part_id)
);

create index if not exists idx_student_whatsapp_catalog_items_student_display
  on student_whatsapp_catalog_items (student_id, display_index);

create index if not exists idx_student_whatsapp_catalog_items_teacher_parasha
  on student_whatsapp_catalog_items (active_teacher_parasha_id, student_id);

create index if not exists idx_student_whatsapp_catalog_items_recommended
  on student_whatsapp_catalog_items (student_id, is_recommended);
