begin;

alter function private.lukas_drawing_create_from_template(uuid,text,uuid)
  rename to lukas_drawing_create_from_template_pre_snapshot_guard;

create or replace function private.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_snapshot public.lukas_drawing_snapshots%rowtype;
  v_digest text;
begin
  select r.* into v_revision
  from public.lukas_drawing_revisions r
  where r.id=p_source_revision_id
    and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
    and r.status='approved'
  for update;
  if not found then
    raise exception using errcode='P1R01',message='Drawing template target is unavailable';
  end if;

  select s.* into v_snapshot
  from public.lukas_drawing_snapshots s
  where s.revision_id=v_revision.id
    and s.project_id=v_revision.project_id
    and s.revision_version=v_revision.version;
  if not found
    or v_snapshot.schema_version not in (1,2)
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json)<>'object'
    or v_snapshot.canonical_json->>'schemaVersion'<>v_snapshot.schema_version::text
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'revision')<>'object'
    or v_snapshot.canonical_json->'revision'->>'id'<>v_revision.id::text
    or v_snapshot.canonical_json->'revision'->>'projectId'<>v_revision.project_id::text
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'pages')<>'array'
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'layers')<>'array'
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'objects')<>'array'
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'issues')<>'array'
    or (v_snapshot.schema_version=2 and (
      pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'canvases')<>'array'
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'styles')<>'array'
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'blocks')<>'array'
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'blockInstances')<>'array'
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'propertySchemas')<>'array'
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'propertyValues')<>'array'
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'tables')<>'array'
    )) then
    raise exception using errcode='P1R01',message='Drawing template target is unavailable';
  end if;

  v_digest:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_snapshot.canonical_json::text,'UTF8'),'sha256'),
    'hex'
  );
  if v_digest<>v_snapshot.sha256 then
    raise exception using errcode='P1R01',message='Drawing template target is unavailable';
  end if;

  return private.lukas_drawing_create_from_template_pre_snapshot_guard(
    p_source_revision_id,p_title,p_source_file_id
  );
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when others then
    raise exception using errcode='P1R01',message='Drawing template target is unavailable';
end;
$$;

revoke all on function
  private.lukas_drawing_create_from_template_pre_snapshot_guard(uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_create_from_template(uuid,text,uuid)
  from public,anon;
grant execute on function private.lukas_drawing_create_from_template(uuid,text,uuid)
  to authenticated,service_role;

commit;
