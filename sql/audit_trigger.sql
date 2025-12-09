-- Trigger de auditoría para tablas críticas

set search_path = public;

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

-- Aplicar a tablas críticas
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


