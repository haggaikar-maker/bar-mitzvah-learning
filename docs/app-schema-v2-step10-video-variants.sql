begin;

alter table if exists public.students
  add column if not exists preferred_video_variant text not null default 'nikud';

alter table if exists public.students
  drop constraint if exists students_preferred_video_variant_check;

alter table if exists public.students
  add constraint students_preferred_video_variant_check
  check (preferred_video_variant in ('nikud', 'tikkun'));

alter table if exists public.lesson_parts
  add column if not exists video_url_nikud text,
  add column if not exists video_url_tikkun text;

update public.lesson_parts
set video_url_nikud = coalesce(video_url_nikud, video_url)
where video_url is not null;

alter table if exists public.student_lesson_part_settings
  add column if not exists preferred_video_variant text;

alter table if exists public.student_lesson_part_settings
  drop constraint if exists student_lesson_part_settings_preferred_video_variant_check;

alter table if exists public.student_lesson_part_settings
  add constraint student_lesson_part_settings_preferred_video_variant_check
  check (
    preferred_video_variant is null
    or preferred_video_variant in ('nikud', 'tikkun')
  );

comment on column public.students.preferred_video_variant is
  'ברירת המחדל של התלמיד להצגת וידאו: עם ניקוד או תיקון סופרים.';

comment on column public.lesson_parts.video_url_nikud is
  'וידאו ברירת מחדל עם ניקוד עבור תת־החלק.';

comment on column public.lesson_parts.video_url_tikkun is
  'וידאו תיקון סופרים עבור תת־החלק.';

comment on column public.student_lesson_part_settings.preferred_video_variant is
  'העדפת תצוגת וידאו נקודתית של תלמיד עבור תת־חלק מסוים.';

commit;
