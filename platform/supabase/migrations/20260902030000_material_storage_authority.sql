-- Material source hashes remain useful only while their exact storage bytes
-- remain available. Preserve every file already referenced by the append-only
-- material ledger, while allowing an uploader to clean an unreferenced field
-- capture after a failed transaction.

update storage.buckets
set allowed_mime_types=array(
  select distinct mime
  from unnest(
    coalesce(allowed_mime_types,'{}'::text[])
      ||array['application/json','model/gltf-binary']
  ) mime
  order by mime
)
where id='lukas-qto';

create or replace function private.lukas_qto_material_storage_path_is_referenced(
  p_storage_path text
) returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.lukas_qto_files f
    where f.storage_path=p_storage_path
  )
$$;

revoke all on function
  private.lukas_qto_material_storage_path_is_referenced(text)
from public,anon;
grant execute on function
  private.lukas_qto_material_storage_path_is_referenced(text)
to authenticated,service_role;

create or replace function private.lukas_qto_material_file_is_referenced(
  p_file_id uuid,
  p_project_id uuid,
  p_sha256 text
) returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1
    from public.lukas_qto_material_plans plan
    where plan.source_file_id=p_file_id
      and plan.project_id=p_project_id
      and plan.source_sha256=p_sha256
    union all
    select 1
    from public.lukas_qto_carbon_factors factor
    where factor.source_file_id=p_file_id
      and factor.project_id=p_project_id
      and factor.source_sha256=p_sha256
    union all
    select 1
    from public.lukas_qto_material_transactions t
    where t.evidence_file_id=p_file_id
      and t.project_id=p_project_id
      and t.evidence_sha256=p_sha256
  )
$$;

revoke all on function
  private.lukas_qto_material_file_is_referenced(uuid,uuid,text)
from public,anon;
grant execute on function
  private.lukas_qto_material_file_is_referenced(uuid,uuid,text)
to authenticated,service_role;

-- A manifest path is immutable after its first write, so its first writer is
-- also an authority boundary. Keep every other existing upload flow unchanged,
-- but prevent read-only/field roles (or a different maker's prefix) from
-- permanently reserving a content-addressed BOQ manifest name.
drop policy if exists "material manifest upload authority"
on storage.objects;
create policy "material manifest upload authority"
on storage.objects as restrictive
for insert to authenticated
with check(
  bucket_id<>'lukas-qto'
  or coalesce((storage.foldername(name))[3],'')<>'boq-manifests'
  or (
    (storage.foldername(name))[1]=(select auth.uid()::text)
    and private.lukas_qto_storage_project_role(name)
      in('owner','staff','estimator')
    and name ~ (
      '^'||(select auth.uid()::text)
      ||'/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
      ||'/boq-manifests/[0-9a-f]{64}[.]manifest[.]json$'
    )
  )
);

drop policy if exists "material manifest metadata insert authority"
on public.lukas_qto_files;
create policy "material manifest metadata insert authority"
on public.lukas_qto_files as restrictive
for insert to authenticated
with check(
  coalesce((storage.foldername(storage_path))[3],'')<>'boq-manifests'
  or (
    uploaded_by=(select auth.uid())
    and immutable
    and kind='other'
    and content_type='application/json'
    and private.lukas_qto_project_role(project_id)
      in('owner','staff','estimator')
    and storage_path=(select auth.uid()::text)||'/'||project_id::text
      ||'/boq-manifests/'||sha256||'.manifest.json'
  )
);

drop policy if exists "material evidence uploaders delete unreferenced files"
on public.lukas_qto_files;
create policy "material evidence uploaders delete unreferenced files"
on public.lukas_qto_files
for delete to authenticated
using(
  uploaded_by=(select auth.uid())
  and immutable
  and kind='other'
  and private.lukas_qto_project_role(project_id)
    in('owner','staff','site','procurement')
  and (storage.foldername(storage_path))[1]=(select auth.uid()::text)
  and (storage.foldername(storage_path))[2]=project_id::text
  and (storage.foldername(storage_path))[3]='material-evidence'
  and not private.lukas_qto_material_file_is_referenced(id,project_id,sha256)
);

-- Existing owner/staff file policies are permissive and therefore OR together
-- with the uploader cleanup policy above. Add a restrictive boundary so a
-- project administrator cannot remove another contributor's staged metadata.
-- BOQ manifests are content-addressed handoff authority and only service-role
-- retention cleanup may remove their metadata.
drop policy if exists "material evidence metadata delete authority"
on public.lukas_qto_files;
create policy "material evidence metadata delete authority"
on public.lukas_qto_files as restrictive
for delete to authenticated
using(
  coalesce((storage.foldername(storage_path))[3],'')
    not in('material-evidence','boq-manifests')
  or (
    (storage.foldername(storage_path))[3]='material-evidence'
    and uploaded_by=(select auth.uid())
    and immutable
    and kind='other'
    and private.lukas_qto_project_role(project_id)
      in('owner','staff','site','procurement')
    and (storage.foldername(storage_path))[1]=(select auth.uid()::text)
    and (storage.foldername(storage_path))[2]=project_id::text
    and not private.lukas_qto_material_file_is_referenced(id,project_id,sha256)
  )
);

drop policy if exists "material authority rejects authenticated delete"
on storage.objects;
create policy "material authority rejects authenticated delete"
on storage.objects as restrictive
for delete to authenticated
using(
  bucket_id<>'lukas-qto'
  or (
    coalesce((storage.foldername(name))[3],'')<>'boq-manifests'
    and not private.lukas_qto_material_storage_path_is_referenced(name)
  )
);

drop policy if exists "material authority rejects authenticated update"
on storage.objects;
create policy "material authority rejects authenticated update"
on storage.objects as restrictive
for update to authenticated
using(
  bucket_id<>'lukas-qto'
  or (
    coalesce((storage.foldername(name))[3],'')<>'boq-manifests'
    and not private.lukas_qto_material_storage_path_is_referenced(name)
  )
)
with check(
  bucket_id<>'lukas-qto'
  or (
    coalesce((storage.foldername(name))[3],'')<>'boq-manifests'
    and not private.lukas_qto_material_storage_path_is_referenced(name)
  )
);
