begin;

-- Ready derivative rows are authority records. The service role is the
-- managed-worker trust boundary: this RPC restricts browser/user roles, while
-- the worker orchestration performs byte validation and storage reconciliation.
revoke all on table public.lukas_drawing_ifc_derivatives
from public,anon,authenticated,service_role;
grant select on table public.lukas_drawing_ifc_derivatives
to authenticated,service_role;

create function public.lukas_drawing_publish_ifc_derivative_ready(
  p_project_id uuid,
  p_source_file_id uuid,
  p_source_sha256 text,
  p_version bigint,
  p_manifest_json jsonb,
  p_manifest_storage_path text,
  p_manifest_byte_size bigint,
  p_manifest_sha256 text,
  p_geometry_storage_path text,
  p_geometry_byte_size bigint,
  p_geometry_sha256 text,
  p_created_by uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  insert into public.lukas_drawing_ifc_derivatives(
    project_id,source_file_id,source_sha256,version,schema_version,status,
    manifest_json,manifest_storage_path,manifest_byte_size,manifest_sha256,
    geometry_storage_path,geometry_byte_size,geometry_sha256,created_by
  ) values(
    p_project_id,p_source_file_id,p_source_sha256,p_version,1,'ready',
    p_manifest_json,p_manifest_storage_path,p_manifest_byte_size,p_manifest_sha256,
    p_geometry_storage_path,p_geometry_byte_size,p_geometry_sha256,p_created_by
  ) on conflict(source_file_id,project_id,version) do nothing
    returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;

  select d.id into v_id
  from public.lukas_drawing_ifc_derivatives d
  where d.project_id=p_project_id
    and d.source_file_id=p_source_file_id
    and d.source_sha256=p_source_sha256
    and d.version=p_version
    and d.schema_version=1
    and d.status='ready'
    and d.manifest_json=p_manifest_json
    and d.manifest_storage_path=p_manifest_storage_path
    and d.manifest_byte_size=p_manifest_byte_size
    and d.manifest_sha256=p_manifest_sha256
    and d.geometry_storage_path=p_geometry_storage_path
    and d.geometry_byte_size=p_geometry_byte_size
    and d.geometry_sha256=p_geometry_sha256
    and d.created_by=p_created_by;
  if v_id is null then
    raise exception using errcode='23505',
      message='IFC derivative version maps to a different immutable payload';
  end if;
  return v_id;
end;
$$;

revoke all on function public.lukas_drawing_publish_ifc_derivative_ready(
  uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_publish_ifc_derivative_ready(
  uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid
) to service_role;

alter default privileges revoke execute on functions from public;

commit;
