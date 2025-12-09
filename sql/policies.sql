-- Políticas RLS para AppPadel

-- Helper inline: check si usuario es admin
-- Nota: se repite en políticas con subconsultas para mantener compatibilidad sin funciones extras.

-- PROFILES
alter table public.profiles enable row level security;

-- Seleccionar: solo self o admin (evita exponer email a terceros)
create policy profiles_select_self_or_admin
  on public.profiles
  for select
  using (
    auth.uid() = id
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Update: el usuario puede actualizar su perfil pero no su rol
create policy profiles_update_self
  on public.profiles
  for update
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles p2 where p2.id = auth.uid())
  );

-- Update: admin puede actualizar (incluido rol)
create policy profiles_update_admin
  on public.profiles
  for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

-- Tournaments
alter table public.tournaments enable row level security;

create policy tournaments_select_public
  on public.tournaments
  for select
  using (true);

create policy tournaments_admin_write
  on public.tournaments
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

-- Teams
alter table public.teams enable row level security;

create policy teams_select_public
  on public.teams
  for select
  using (true);

create policy teams_insert_authenticated
  on public.teams
  for insert
  with check (auth.uid() is not null);

create policy teams_update_owner_or_admin
  on public.teams
  for update
  using (
    owner_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy teams_delete_owner_or_admin
  on public.teams
  for delete
  using (
    owner_id = auth.uid()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Tournament entries (inscripción/baja)
alter table public.tournament_entries enable row level security;

create policy entries_select_public
  on public.tournament_entries
  for select
  using (true);

create policy entries_insert_owner_before_deadline_or_admin
  on public.tournament_entries
  for insert
  with check (
    (
      exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid())
      and timezone('utc', now()) <= (select registration_deadline from public.tournaments tr where tr.id = tournament_id)
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy entries_delete_owner_before_deadline_or_admin
  on public.tournament_entries
  for delete
  using (
    (
      exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid())
      and timezone('utc', now()) <= (select registration_deadline from public.tournaments tr where tr.id = tournament_id)
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Team members
alter table public.team_members enable row level security;

create policy team_members_select_involved_or_admin
  on public.team_members
  for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy team_members_insert_owner_or_admin
  on public.team_members
  for insert
  with check (
    exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy team_members_delete_owner_or_admin
  on public.team_members
  for delete
  using (
    exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid())
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Groups
alter table public.groups enable row level security;

create policy groups_select_public
  on public.groups
  for select
  using (true);

create policy groups_admin_write
  on public.groups
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

-- Group teams
alter table public.group_teams enable row level security;

create policy group_teams_select_public
  on public.group_teams
  for select
  using (true);

create policy group_teams_admin_write
  on public.group_teams
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

-- Matches
alter table public.matches enable row level security;

-- Público ve solo partidos confirmados
create policy matches_select_public_confirmed
  on public.matches
  for select
  using (status = 'confirmed');

-- Equipos involucrados y admins pueden ver todo
create policy matches_select_involved_or_admin
  on public.matches
  for select
  using (
    home_team_id in (
      select tm.team_id from public.team_members tm where tm.user_id = auth.uid()
    )
    or away_team_id in (
      select tm.team_id from public.team_members tm where tm.user_id = auth.uid()
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Escritura solo admin (fixtures via Edge Functions)
create policy matches_admin_write
  on public.matches
  for all
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

-- Match results
alter table public.match_results enable row level security;

create policy match_results_select_involved_or_admin
  on public.match_results
  for select
  using (
    reporter_user_id = auth.uid()
    or exists (
      select 1
      from public.matches m
      where m.id = match_id
        and (
          m.home_team_id in (select tm.team_id from public.team_members tm where tm.user_id = auth.uid())
          or m.away_team_id in (select tm.team_id from public.team_members tm where tm.user_id = auth.uid())
        )
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy match_results_insert_team_member
  on public.match_results
  for insert
  with check (
    exists (
      select 1
      from public.team_members tm
      join public.matches m on m.id = match_id
      where tm.user_id = auth.uid()
        and tm.team_id = reporter_team_id
        and (m.home_team_id = tm.team_id or m.away_team_id = tm.team_id)
    )
  );

-- Update solo admin (aceptaciones/rechazos se manejan vía Edge Functions con service role)
create policy match_results_update_admin
  on public.match_results
  for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

-- Incidents
alter table public.incidents enable row level security;

create policy incidents_select_involved_or_admin
  on public.incidents
  for select
  using (
    raised_by_user_id = auth.uid()
    or exists (
      select 1
      from public.matches m
      where m.id = match_id
        and (
          m.home_team_id in (select tm.team_id from public.team_members tm where tm.user_id = auth.uid())
          or m.away_team_id in (select tm.team_id from public.team_members tm where tm.user_id = auth.uid())
        )
    )
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

create policy incidents_insert_team_member
  on public.incidents
  for insert
  with check (
    exists (select 1 from public.team_members tm where tm.user_id = auth.uid() and tm.team_id = raised_by_team_id)
  );

create policy incidents_update_admin
  on public.incidents
  for update
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (true);

-- Events
alter table public.events enable row level security;

create policy events_select_involved_or_admin
  on public.events
  for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.team_members tm where tm.user_id = auth.uid() and tm.team_id = events.team_id)
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- Audit logs: solo admin puede leer; inserta service role/trigger
alter table public.audit_logs enable row level security;

create policy audit_logs_select_admin
  on public.audit_logs
  for select
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

create policy audit_logs_insert_service_role
  on public.audit_logs
  for insert
  with check (
    current_setting('request.jwt.claim.role', true) = 'service_role'
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );


