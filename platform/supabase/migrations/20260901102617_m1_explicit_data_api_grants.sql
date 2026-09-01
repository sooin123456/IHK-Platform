
revoke all on table
  public.lukas_qto_projects,
  public.lukas_qto_files,
  public.lukas_qto_reviews,
  public.lukas_qto_shares,
  public.profiles,
  public.payments
from public,anon,authenticated,service_role;

grant select,insert,update on table public.lukas_qto_projects
  to authenticated,service_role;
grant select,insert,delete on table public.lukas_qto_files
  to authenticated,service_role;
grant select,insert on table public.lukas_qto_reviews
  to authenticated,service_role;
grant select,insert,update,delete on table public.lukas_qto_shares
  to authenticated,service_role;
grant select,update,delete on table public.profiles
  to authenticated,service_role;
grant select on table public.payments
  to authenticated,service_role;
