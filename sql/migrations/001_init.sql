-- Repositorio: AppPadel
-- Propósito: migración inicial para Supabase (Auth + Postgres)
-- Incluye extensiones, enums, tablas, constraints, funciones internas stub

set check_function_bodies = off;

create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

do $$
begin
  create type gender_enum as enum ('masculino', 'femenino');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type level_enum as enum ('1','2','3','4','5','6','7','7B');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type role_enum as enum ('admin','player');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type tournament_status as enum ('draft','open','in_progress','completed','archived');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type match_stage as enum ('group','knockout');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type match_status as enum ('pending','reported','disputed','confirmed','cancelled','walkover');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type incident_status as enum ('open','resolved','rejected');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type result_type as enum ('normal','walkover');
exception when duplicate_object then null;
end $$;

do $$
begin
  create type event_type as enum ('result_reported','result_request','result_rejected','incident_resolved');
exception when duplicate_object then null;
end $$;

create schema if not exists internal;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  email text not null,
  phone text not null,
  gender gender_enum not null,
  level level_enum not null,
  role role_enum not null default 'player',
  incomplete boolean not null default true,
  push_token text,
  avatar_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint profiles_email_unique unique (email)
);

create index if not exists profiles_role_idx on public.profiles (role);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists teams_name_lower_unique on public.teams (lower(name));

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  status tournament_status not null default 'draft',
  registration_deadline timestamptz not null,
  start_date timestamptz not null,
  group_phase_end timestamptz not null,
  final_match_deadline timestamptz not null,
  max_teams integer check (max_teams is null or max_teams > 0),
  group_size integer check (group_size is null or group_size > 1),
  allow_post_deadline_edits boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint tournaments_deadlines_order check (
    registration_deadline <= start_date
    and start_date <= group_phase_end
    and group_phase_end <= final_match_deadline
  )
);

create index if not exists tournaments_status_idx on public.tournaments (status);
create index if not exists tournaments_registration_deadline_idx on public.tournaments (registration_deadline);

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now()),
  constraint tournament_entries_unique unique (tournament_id, team_id)
);

create index if not exists tournament_entries_tournament_idx on public.tournament_entries (tournament_id);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null,
  tournament_id uuid not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  is_captain boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  constraint team_members_team_fk foreign key (team_id) references public.teams (id) on delete cascade,
  constraint team_members_entry_fk foreign key (team_id, tournament_id) references public.tournament_entries (team_id, tournament_id) on delete cascade,
  constraint team_members_unique_member unique (team_id, user_id),
  constraint team_members_unique_user_per_tournament unique (tournament_id, user_id)
);

create index if not exists team_members_user_idx on public.team_members (user_id);
create index if not exists team_members_tournament_idx on public.team_members (tournament_id);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  name text not null,
  seed integer,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists groups_tournament_idx on public.groups (tournament_id);
create unique index if not exists groups_name_unique on public.groups (tournament_id, lower(name));

create table if not exists public.group_teams (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  constraint group_teams_unique unique (group_id, team_id)
);

create index if not exists group_teams_group_idx on public.group_teams (group_id);

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  group_id uuid references public.groups (id) on delete set null,
  stage match_stage not null,
  round text,
  home_team_id uuid not null references public.teams (id) on delete cascade,
  away_team_id uuid not null references public.teams (id) on delete cascade,
  scheduled_at timestamptz,
  status match_status not null default 'pending',
  winner_team_id uuid references public.teams (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint matches_teams_distinct check (home_team_id <> away_team_id),
  constraint matches_stage_group check (
    (stage = 'group' and group_id is not null) or
    (stage = 'knockout' and group_id is null)
  )
);

create index if not exists matches_tournament_idx on public.matches (tournament_id);
create index if not exists matches_scheduled_idx on public.matches (scheduled_at);

create table if not exists public.match_results (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  reporter_team_id uuid not null references public.teams (id) on delete cascade,
  reporter_user_id uuid not null references public.profiles (id) on delete cascade,
  result_type result_type not null default 'normal',
  sets_won_home integer not null default 0 check (sets_won_home >= 0),
  sets_won_away integer not null default 0 check (sets_won_away >= 0),
  set_scores jsonb,
  accepted boolean,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint match_results_unique_match unique (match_id)
);

create index if not exists match_results_match_idx on public.match_results (match_id);

create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  tournament_id uuid not null references public.tournaments (id) on delete cascade,
  raised_by_team_id uuid not null references public.teams (id) on delete cascade,
  raised_by_user_id uuid not null references public.profiles (id) on delete cascade,
  status incident_status not null default 'open',
  description text not null,
  resolution text,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists incidents_match_idx on public.incidents (match_id);
create index if not exists incidents_status_idx on public.incidents (status);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  event_type event_type not null,
  tournament_id uuid references public.tournaments (id) on delete cascade,
  match_id uuid references public.matches (id) on delete cascade,
  team_id uuid references public.teams (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  payload jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists events_type_idx on public.events (event_type);
create index if not exists events_created_idx on public.events (created_at);

create table if not exists public.audit_logs (
  id bigserial primary key,
  user_id uuid,
  action text not null,
  table_name text not null,
  row_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists audit_logs_created_idx on public.audit_logs (created_at);

create or replace function internal.generate_fixture(p_tournament_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  raise exception 'internal.generate_fixture not implemented in SQL bootstrap';
end;
$$;

create or replace function internal.accept_result(p_result_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  raise exception 'internal.accept_result not implemented in SQL bootstrap';
end;
$$;

create or replace function internal.resolve_incident(p_incident_id uuid, p_admin_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  raise exception 'internal.resolve_incident not implemented in SQL bootstrap';
end;
$$;

comment on schema internal is 'Funciones sensibles; ejecutar solo vía Edge Functions / service role';
comment on table public.audit_logs is 'Audit de cambios críticos; purgar >90 días vía tarea programada';

-- Trigger: sync auth.users -> public.profiles
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

-- Trigger de auditoría
create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_id uuid;
begin
  v_row_id := coalesce(new.id, old.id);

  insert into public.audit_logs (
    user_id,
    action,
    table_name,
    row_id,
    old_data,
    new_data,
    created_at
  ) values (
    auth.uid(),
    tg_op,
    tg_table_name,
    v_row_id,
    to_jsonb(old),
    to_jsonb(new),
    timezone('utc', now())
  );

  return null;
end;
$$;

drop trigger if exists audit_tournaments on public.tournaments;
create trigger audit_tournaments
after insert or update or delete on public.tournaments
for each row execute function public.log_audit();

drop trigger if exists audit_matches on public.matches;
create trigger audit_matches
after insert or update or delete on public.matches
for each row execute function public.log_audit();

drop trigger if exists audit_match_results on public.match_results;
create trigger audit_match_results
after insert or update or delete on public.match_results
for each row execute function public.log_audit();

drop trigger if exists audit_incidents on public.incidents;
create trigger audit_incidents
after insert or update or delete on public.incidents
for each row execute function public.log_audit();

create or replace function public.delete_old_audit_logs(days_threshold integer default 90)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.audit_logs
  where created_at < timezone('utc', now()) - (days_threshold || ' days')::interval;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;



