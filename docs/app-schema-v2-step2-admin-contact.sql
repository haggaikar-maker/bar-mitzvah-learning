alter table admins
  add column if not exists city text null;

alter table admins
  add column if not exists email text null;
