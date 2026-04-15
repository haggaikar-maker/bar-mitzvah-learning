insert into storage.buckets (id, name, public)
values
  ('lesson-audio', 'lesson-audio', true),
  ('lesson-images', 'lesson-images', true),
  ('lesson-videos', 'lesson-videos', true),
  ('student-recordings', 'student-recordings', false)
on conflict (id) do nothing;
