create function private.lukas_qto_verified_session()
returns boolean
language sql stable security invoker
set search_path=''
as $$
  select coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false)=false
$$;

create function private.lukas_qto_staff_session()
returns boolean
language sql stable security invoker
set search_path=''
as $$
  select private.lukas_qto_verified_session()
    and (select auth.jwt()->'app_metadata'->>'role')='hangil_staff'
$$;

revoke all on function private.lukas_qto_verified_session() from public, anon;
revoke all on function private.lukas_qto_staff_session() from public, anon;
grant execute on function private.lukas_qto_verified_session() to authenticated, service_role;
grant execute on function private.lukas_qto_staff_session() to authenticated, service_role;

do $$
declare target_table text;
begin
  foreach target_table in array array[
    'lukas_qto_carbon_factors','lukas_qto_file_revisions','lukas_qto_files',
    'lukas_qto_material_plans','lukas_qto_material_transactions',
    'lukas_qto_preflight_approvals','lukas_qto_preflight_artifacts',
    'lukas_qto_preflight_inputs','lukas_qto_projects','lukas_qto_reviews',
    'lukas_qto_shares','lukas_qto_suggestion_decisions','lukas_qto_suggestions',
    'lukas_qto_takeoff_approvals','lukas_qto_takeoff_artifacts',
    'lukas_qto_takeoff_inputs'
  ] loop
    execute format(
      'alter policy %I on public.%I using (private.lukas_qto_verified_session()) with check (private.lukas_qto_verified_session())',
      'verified email sessions only',target_table
    );
  end loop;
end
$$;

alter policy "hangil staff reads project inquiries"
on public.hangil_project_inquiries
using(private.lukas_qto_staff_session());
alter policy "hangil staff updates project inquiries"
on public.hangil_project_inquiries
using(private.lukas_qto_staff_session())
with check(private.lukas_qto_staff_session());
