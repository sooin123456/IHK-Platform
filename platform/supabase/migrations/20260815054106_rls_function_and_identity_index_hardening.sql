create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.lukas_qto_add_owner_membership() set schema private;
alter function public.lukas_qto_organization_role(uuid) set schema private;
alter function public.lukas_qto_prepare_project() set schema private;
alter function public.lukas_qto_project_role(uuid) set schema private;
alter function public.lukas_qto_storage_project_role(text) set schema private;

revoke all on function private.lukas_qto_add_owner_membership() from public, anon, authenticated;
revoke all on function private.lukas_qto_prepare_project() from public, anon, authenticated;
revoke all on function private.lukas_qto_organization_role(uuid) from public, anon;
revoke all on function private.lukas_qto_project_role(uuid) from public, anon;
revoke all on function private.lukas_qto_storage_project_role(text) from public, anon;
grant execute on function private.lukas_qto_organization_role(uuid) to authenticated, service_role;
grant execute on function private.lukas_qto_project_role(uuid) to authenticated, service_role;
grant execute on function private.lukas_qto_storage_project_role(text) to authenticated, service_role;

drop policy "organization owners manage membership" on public.lukas_qto_organization_members;
create policy "organization owners add membership"
on public.lukas_qto_organization_members for insert to authenticated
with check(private.lukas_qto_organization_role(organization_id) in('owner','staff'));
create policy "organization owners update membership"
on public.lukas_qto_organization_members for update to authenticated
using(private.lukas_qto_organization_role(organization_id) in('owner','staff'))
with check(private.lukas_qto_organization_role(organization_id) in('owner','staff'));
create policy "organization owners remove membership"
on public.lukas_qto_organization_members for delete to authenticated
using(private.lukas_qto_organization_role(organization_id) in('owner','staff'));

drop policy "project owners manage membership" on public.lukas_qto_project_members;
create policy "project owners add membership"
on public.lukas_qto_project_members for insert to authenticated
with check(private.lukas_qto_project_role(project_id) in('owner','staff'));
create policy "project owners update membership"
on public.lukas_qto_project_members for update to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff'))
with check(private.lukas_qto_project_role(project_id) in('owner','staff'));
create policy "project owners remove membership"
on public.lukas_qto_project_members for delete to authenticated
using(private.lukas_qto_project_role(project_id) in('owner','staff'));

drop index public.lukas_qto_element_identity_links_ledger_idx;
drop index public.lukas_qto_element_identity_links_ifc_idx;
create index lukas_qto_element_identity_links_ledger_idx
  on public.lukas_qto_element_identity_links(element_ledger_file_id,project_id,element_ledger_sha256);
create index lukas_qto_element_identity_links_ifc_idx
  on public.lukas_qto_element_identity_links(ifc_file_id,project_id,ifc_sha256);
