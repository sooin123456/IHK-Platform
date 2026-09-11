
revoke all on table
  public.lukas_qto_projects,
  public.lukas_qto_files,
  public.lukas_qto_reviews,
  public.lukas_qto_shares
from public,anon,authenticated,service_role;

grant select,insert,update on table public.lukas_qto_projects
  to authenticated,service_role;
grant select,insert,delete on table public.lukas_qto_files
  to authenticated,service_role;
grant select,insert on table public.lukas_qto_reviews
  to authenticated,service_role;
grant select,insert,update,delete on table public.lukas_qto_shares
  to authenticated,service_role;

-- These Supaplate-era tables are optional in a 1HK-only installation.
do $$
begin
  if pg_catalog.to_regclass('public.profiles') is not null then
    execute 'revoke all on table public.profiles from public,anon,authenticated,service_role';
    execute 'grant select,update,delete on table public.profiles to authenticated,service_role';
  end if;
  if pg_catalog.to_regclass('public.payments') is not null then
    execute 'revoke all on table public.payments from public,anon,authenticated,service_role';
    execute 'grant select on table public.payments to authenticated,service_role';
  end if;
end
$$;
