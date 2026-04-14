insert into storage.buckets (id, name, public)
values
  ('lesson-audio', 'lesson-audio', true),
  ('lesson-images', 'lesson-images', true)
on conflict (id) do nothing;
