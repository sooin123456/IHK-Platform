-- P7 renamed the original workspace-capability function. PostgreSQL policies
-- retain the referenced function OID across a rename, so the P5 source policy
-- kept calling the renamed pre-entitlement helper after its EXECUTE privilege
-- was revoked. Rebind the policy to the entitlement-aware wrapper.
alter policy "project members read active drawing object sources"
on public.lukas_drawing_object_sources
using (
  status='active'
  and (select private.lukas_drawing_workspace_capability(project_id)) is not null
);

revoke execute on function private.lukas_drawing_workspace_capability(uuid)
from public,anon;
grant execute on function private.lukas_drawing_workspace_capability(uuid)
to authenticated,service_role;
