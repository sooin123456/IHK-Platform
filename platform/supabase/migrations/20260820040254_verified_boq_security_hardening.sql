-- Remove Supabase's automatic anonymous EXECUTE grants from the Verified BOQ
-- functions. The two user-facing RPCs remain available only to authenticated
-- sessions and the service role; trigger functions are not callable APIs.
revoke all on function public.lukas_qto_guard_boq_draft_child() from public,anon;
revoke all on function public.lukas_qto_guard_boq_source_decision() from public,anon;
revoke all on function public.lukas_qto_guard_boq_section_tree() from public,anon;
revoke all on function public.lukas_qto_guard_boq_wbs_tree() from public,anon;
revoke all on function public.lukas_qto_guard_boq_version_transition() from public,anon;
revoke all on function public.lukas_qto_guard_boq_approval() from public,anon;
revoke all on function public.lukas_qto_decide_boq(uuid,text,text) from public,anon;
revoke all on function public.lukas_qto_import_boq_structure(uuid,jsonb) from public,anon;

grant execute on function public.lukas_qto_decide_boq(uuid,text,text)
  to authenticated,service_role;
grant execute on function public.lukas_qto_import_boq_structure(uuid,jsonb)
  to authenticated,service_role;

-- The project-role helper was moved from public to private by the earlier RLS
-- hardening migration. Recreate the Storage wrapper so collaborator uploads do
-- not silently resolve to null through its exception handler.
create or replace function private.lukas_qto_storage_project_role(p_name text)
returns text
language plpgsql
stable
security definer
set search_path=pg_catalog
as $$
begin
  return private.lukas_qto_project_role(((storage.foldername(p_name))[2])::uuid);
exception when others then
  return null;
end;
$$;

revoke all on function private.lukas_qto_storage_project_role(text) from public,anon;
grant execute on function private.lukas_qto_storage_project_role(text)
  to authenticated,service_role;
