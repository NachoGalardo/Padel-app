-- Trigger para sincronizar auth.users -> public.profiles

set search_path = public, auth;

create or replace function public.sync_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display text;
  v_phone text;
  v_gender text;
  v_level text;
  v_push text;
  v_avatar text;
  v_gender_enum gender_enum;
  v_level_enum level_enum;
  v_incomplete boolean := false;
  v_existing_role role_enum;
begin
  v_display := coalesce(new.raw_user_meta_data->>'display_name', new.email);
  v_phone := new.raw_user_meta_data->>'phone';
  v_gender := new.raw_user_meta_data->>'gender';
  v_level := new.raw_user_meta_data->>'level';
  v_push := new.raw_user_meta_data->>'push_token';
  v_avatar := new.raw_user_meta_data->>'avatar_url';

  -- Validaciones mínimas
  if v_display is null or v_phone is null then
    v_incomplete := true;
  end if;

  if v_gender in ('masculino','femenino') then
    v_gender_enum := v_gender::gender_enum;
  else
    v_incomplete := true;
  end if;

  if v_level in ('1','2','3','4','5','6','7','7B') then
    v_level_enum := v_level::level_enum;
  else
    v_incomplete := true;
  end if;

  select role into v_existing_role from public.profiles where id = new.id;

  insert into public.profiles (
    id, display_name, email, phone, gender, level, role, incomplete, push_token, avatar_url, created_at, updated_at
  ) values (
    new.id,
    coalesce(v_display, new.email),
    new.email,
    coalesce(v_phone, ''),
    coalesce(v_gender_enum, 'masculino'),
    coalesce(v_level_enum, '1'),
    coalesce(v_existing_role, 'player'),
    v_incomplete,
    v_push,
    v_avatar,
    timezone('utc', now()),
    timezone('utc', now())
  )
  on conflict (id) do update
  set display_name = excluded.display_name,
      email = excluded.email,
      phone = excluded.phone,
      gender = excluded.gender,
      level = excluded.level,
      incomplete = excluded.incomplete,
      push_token = excluded.push_token,
      avatar_url = excluded.avatar_url,
      updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_changed on auth.users;
create trigger on_auth_user_changed
after insert or update on auth.users
for each row execute function public.sync_profile_from_auth();


