begin;

-- Upgrade installations that applied the original workspace core before
-- canonical object names and system-layer integrity were introduced.
alter table public.lukas_drawing_objects
  add column if not exists name text;

-- Historical approved revisions are immutable to application actors. The
-- migration owner performs only the deterministic schema backfill while user
-- triggers are disabled; append-only operation and evidence rows are untouched.
alter table public.lukas_drawing_objects disable trigger user;
update public.lukas_drawing_objects
set name = case object_type
  when 'line' then 'Line'
  when 'polyline' then 'Polyline'
  when 'rectangle' then 'Rectangle'
  when 'circle' then 'Circle'
  when 'text' then 'Text'
  when 'dimension' then 'Dimension'
end
where name is null
   or name <> pg_catalog.btrim(name)
   or pg_catalog.char_length(name) not between 1 and 255;
alter table public.lukas_drawing_objects enable trigger user;

alter table public.lukas_drawing_objects
  alter column name set not null;
alter table public.lukas_drawing_objects
  drop constraint if exists lukas_drawing_objects_name_contract;
alter table public.lukas_drawing_objects
  add constraint lukas_drawing_objects_name_contract check (
    name = pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 1 and 255
  );

alter table public.lukas_drawing_layers disable trigger user;
do $$
declare
  v_layer record;
  v_name text;
begin
  for v_layer in
    select id, page_id, name
    from public.lukas_drawing_layers
    where name <> pg_catalog.btrim(name)
    order by page_id, id
  loop
    v_name := pg_catalog.btrim(v_layer.name);
    if exists (
      select 1 from public.lukas_drawing_layers l
      where l.page_id = v_layer.page_id
        and l.id <> v_layer.id
        and l.name = v_name
    ) then
      v_name := pg_catalog.left(v_name, 246) || ' ' ||
        pg_catalog.left(v_layer.id::text, 8);
    end if;
    update public.lukas_drawing_layers set name = v_name
    where id = v_layer.id;
  end loop;

  update public.lukas_drawing_layers
  set visible = true, locked = true
  where system_kind = 'source' and (not visible or not locked);

  with missing as (
    select p.id page_id
    from public.lukas_drawing_pages p
    where not exists (
      select 1 from public.lukas_drawing_layers l
      where l.page_id = p.id
        and l.system_kind <> 'source'
        and l.visible and not l.locked
    )
  ), fallback as (
    select distinct on (l.page_id) l.id
    from public.lukas_drawing_layers l
    join missing m on m.page_id = l.page_id
    where l.system_kind <> 'source'
    order by l.page_id,
      case when l.system_kind = 'work' then 0 else 1 end,
      l.sort_order, l.id
  )
  update public.lukas_drawing_layers l
  set visible = true, locked = false
  from fallback f where l.id = f.id;
end;
$$;

alter table public.lukas_drawing_layers enable trigger user;

alter table public.lukas_drawing_layers
  drop constraint if exists lukas_drawing_layers_name_contract;
alter table public.lukas_drawing_layers
  add constraint lukas_drawing_layers_name_contract check (
    name = pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 1 and 255
  );
alter table public.lukas_drawing_layers
  drop constraint if exists lukas_drawing_layers_source_contract;
alter table public.lukas_drawing_layers
  add constraint lukas_drawing_layers_source_contract check (
    system_kind <> 'source' or (visible and locked)
  );

create or replace function private.lukas_drawing_create_document(
  p_project_id uuid,
  p_source_file_id uuid,
  p_title text,
  p_blank boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_file public.lukas_qto_files%rowtype;
  v_document_id uuid;
  v_revision_id uuid;
  v_page_id uuid;
  v_source_layer_id uuid;
  v_work_layer_id uuid;
  v_capability text;
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  v_capability := private.lukas_drawing_workspace_capability(p_project_id);
  if v_capability is null or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  if p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 240 then
    raise exception 'Drawing document title is required';
  end if;
  if p_blank is null then raise exception 'Drawing blank-page choice is required'; end if;

  if p_source_file_id is not null then
    select * into v_file
    from public.lukas_qto_files f
    where f.id = p_source_file_id and f.project_id = p_project_id
    for key share;
    if not found or v_file.kind not in ('pdf', 'ifc') or not v_file.immutable then
      raise exception 'Drawing source must be an immutable project PDF or IFC';
    end if;
  elsif not p_blank then
    raise exception 'A non-blank drawing requires a PDF or IFC source';
  end if;

  insert into public.lukas_drawing_documents(
    project_id, source_file_id, source_sha256, title, created_by
  ) values (
    p_project_id, p_source_file_id, v_file.sha256,
    pg_catalog.btrim(p_title), v_actor
  ) returning id into v_document_id;

  insert into public.lukas_drawing_revisions(
    document_id, project_id, sequence, status, version, created_by
  ) values (v_document_id, p_project_id, 1, 'draft', 1, v_actor)
  returning id into v_revision_id;

  insert into public.lukas_drawing_pages(
    revision_id, project_id, name, page_number,
    background_source_file_id, background_source_sha256, background_pdf_page
  ) values (
    v_revision_id, p_project_id, '1', 1,
    case when not p_blank and v_file.kind = 'pdf' then v_file.id end,
    case when not p_blank and v_file.kind = 'pdf' then v_file.sha256 end,
    case when not p_blank and v_file.kind = 'pdf' then 1 end
  ) returning id into v_page_id;

  insert into public.lukas_drawing_layers(
    page_id, revision_id, project_id, name, sort_order,
    visible, locked, system_kind, version, created_by
  ) values (
    v_page_id, v_revision_id, p_project_id, '작업', 1,
    true, false, 'work', 1, v_actor
  ) returning id into v_work_layer_id;

  insert into public.lukas_drawing_layers(
    page_id, revision_id, project_id, name, sort_order,
    visible, locked, system_kind, version, created_by
  ) values (
    v_page_id, v_revision_id, p_project_id, '원본', 0,
    true, true, 'source', 1, v_actor
  ) returning id into v_source_layer_id;

  return pg_catalog.jsonb_build_object(
    'documentId', v_document_id,
    'revisionId', v_revision_id,
    'pageId', v_page_id,
    'sourceLayerId', v_source_layer_id,
    'workLayerId', v_work_layer_id
  );
end;
$$;

create or replace function private.lukas_drawing_layer_guard()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if tg_op = 'INSERT' then
    if current_user = 'authenticated'
       and new.system_kind <> 'custom' then
      raise exception 'Only custom drawing layers may be inserted directly';
    end if;
    if new.created_by <> v_actor or new.version <> 1 then
      raise exception 'Drawing layer creator and initial version are invalid';
    end if;
  elsif tg_op = 'DELETE' then
    if old.system_kind = 'source' then
      raise exception 'Source drawing layer is immutable';
    end if;
    if not exists (
      select 1 from public.lukas_drawing_layers l
      where l.page_id = old.page_id
        and l.id <> old.id
        and l.system_kind <> 'source'
        and l.visible and not l.locked
    ) then
      raise exception 'At least one visible unlocked user drawing layer is required';
    end if;
    return old;
  else
    if old.system_kind = 'source' then
      raise exception 'Source drawing layer is immutable';
    end if;
    if new.id is distinct from old.id
       or new.page_id is distinct from old.page_id
       or new.revision_id is distinct from old.revision_id
       or new.project_id is distinct from old.project_id
       or new.system_kind is distinct from old.system_kind
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Drawing layer identity is immutable';
    end if;
    if new.version <> old.version + 1 then
      raise exception 'Drawing layer version must increase by one';
    end if;
  end if;
  if new.system_kind = 'source' and (not new.locked or not new.visible) then
    raise exception 'Source drawing layer must remain visible and locked';
  end if;
  if new.system_kind <> 'source'
     and (not new.visible or new.locked)
     and not exists (
       select 1 from public.lukas_drawing_layers l
       where l.page_id = new.page_id
         and l.id <> new.id
         and l.system_kind <> 'source'
         and l.visible and not l.locked
     ) then
    raise exception 'At least one visible unlocked user drawing layer is required';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function private.lukas_drawing_operation_payload_valid(p_payload jsonb)
returns boolean
language plpgsql immutable security invoker
set search_path = ''
as $$
declare
  v_type text;
  v_item jsonb;
  v_patch jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or not (p_payload ? 'type')
     or pg_catalog.jsonb_typeof(p_payload -> 'type') <> 'string' then
    return false;
  end if;
  v_type := p_payload ->> 'type';

  if v_type = 'add_objects' then
    if not (p_payload ?& array['type', 'objects'])
       or p_payload - array['type', 'objects'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_payload -> 'objects') <> 'array'
       or pg_catalog.jsonb_array_length(p_payload -> 'objects') = 0 then
      return false;
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'objects') loop
      if pg_catalog.jsonb_typeof(v_item) <> 'object'
         or not (v_item ?& array['id', 'name', 'layerId', 'geometry', 'style', 'version'])
         or v_item - array['id', 'name', 'layerId', 'geometry', 'style', 'version'] <> '{}'::jsonb
         or pg_catalog.jsonb_typeof(v_item -> 'id') <> 'string'
         or (v_item ->> 'id') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         or pg_catalog.jsonb_typeof(v_item -> 'layerId') <> 'string'
         or (v_item ->> 'layerId') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         or pg_catalog.jsonb_typeof(v_item -> 'name') <> 'string'
         or v_item ->> 'name' <> pg_catalog.btrim(v_item ->> 'name')
         or pg_catalog.char_length(v_item ->> 'name') not between 1 and 255
         or private.lukas_drawing_geometry_valid(
           v_item -> 'geometry' ->> 'type', v_item -> 'geometry'
         ) is not true
         or private.lukas_drawing_style_valid(v_item -> 'style') is not true
         or pg_catalog.jsonb_typeof(v_item -> 'version') <> 'number'
         or (v_item ->> 'version')::numeric <= 0
         or (v_item ->> 'version')::numeric <>
           pg_catalog.trunc((v_item ->> 'version')::numeric) then
        return false;
      end if;
    end loop;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'objects') item
      group by item ->> 'id' having pg_catalog.count(*) > 1
    ) then return false; end if;
    return true;

  elsif v_type = 'update_objects' then
    if not (p_payload ?& array['type', 'updates'])
       or p_payload - array['type', 'updates'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_payload -> 'updates') <> 'array'
       or pg_catalog.jsonb_array_length(p_payload -> 'updates') = 0 then
      return false;
    end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_payload -> 'updates') loop
      v_patch := v_item -> 'patch';
      if pg_catalog.jsonb_typeof(v_item) <> 'object'
         or not (v_item ?& array['objectId', 'patch'])
         or v_item - array['objectId', 'patch'] <> '{}'::jsonb
         or pg_catalog.jsonb_typeof(v_item -> 'objectId') <> 'string'
         or (v_item ->> 'objectId') !~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         or pg_catalog.jsonb_typeof(v_patch) <> 'object'
         or v_patch = '{}'::jsonb
         or v_patch - array['name', 'layerId', 'geometry', 'style'] <> '{}'::jsonb
         or (v_patch ? 'name' and (
           pg_catalog.jsonb_typeof(v_patch -> 'name') <> 'string'
           or v_patch ->> 'name' <> pg_catalog.btrim(v_patch ->> 'name')
           or pg_catalog.char_length(v_patch ->> 'name') not between 1 and 255
         ))
         or (v_patch ? 'layerId' and (
           pg_catalog.jsonb_typeof(v_patch -> 'layerId') <> 'string'
           or (v_patch ->> 'layerId') !~
             '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
         ))
         or (v_patch ? 'geometry' and private.lukas_drawing_geometry_valid(
           v_patch -> 'geometry' ->> 'type', v_patch -> 'geometry'
         ) is not true)
         or (v_patch ? 'style'
           and private.lukas_drawing_style_valid(v_patch -> 'style') is not true) then
        return false;
      end if;
    end loop;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(p_payload -> 'updates') item
      group by item ->> 'objectId' having pg_catalog.count(*) > 1
    ) then return false; end if;
    return true;

  elsif v_type = 'delete_objects' then
    if not (p_payload ?& array['type', 'objectIds'])
       or p_payload - array['type', 'objectIds'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_payload -> 'objectIds') <> 'array'
       or pg_catalog.jsonb_array_length(p_payload -> 'objectIds') = 0
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements(p_payload -> 'objectIds') item
         where pg_catalog.jsonb_typeof(item) <> 'string'
           or item #>> '{}' !~
             '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
       )
       or exists (
         select 1
         from pg_catalog.jsonb_array_elements_text(p_payload -> 'objectIds') object_id
         group by object_id having pg_catalog.count(*) > 1
       ) then
      return false;
    end if;
    return true;

  elsif v_type = 'add_layer' then
    v_item := p_payload -> 'layer';
    return coalesce(
      p_payload ?& array['type', 'layer']
        and p_payload - array['type', 'layer'] = '{}'::jsonb
        and pg_catalog.jsonb_typeof(v_item) = 'object'
        and v_item ?& array['id', 'name', 'visible', 'locked', 'version']
        and v_item - array['id', 'name', 'visible', 'locked', 'version'] = '{}'::jsonb
        and pg_catalog.jsonb_typeof(v_item -> 'id') = 'string'
        and (v_item ->> 'id') ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        and pg_catalog.jsonb_typeof(v_item -> 'name') = 'string'
        and pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'name')) between 1 and 255
        and pg_catalog.jsonb_typeof(v_item -> 'visible') = 'boolean'
        and pg_catalog.jsonb_typeof(v_item -> 'locked') = 'boolean'
        and pg_catalog.jsonb_typeof(v_item -> 'version') = 'number'
        and (v_item ->> 'version')::numeric = 1,
      false
    );

  elsif v_type = 'update_layer' then
    v_patch := p_payload -> 'patch';
    return coalesce(
      p_payload ?& array['type', 'layerId', 'patch']
        and p_payload - array['type', 'layerId', 'patch'] = '{}'::jsonb
        and pg_catalog.jsonb_typeof(p_payload -> 'layerId') = 'string'
        and (p_payload ->> 'layerId') ~
          '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
        and pg_catalog.jsonb_typeof(v_patch) = 'object'
        and v_patch <> '{}'::jsonb
        and v_patch - array['name', 'visible', 'locked'] = '{}'::jsonb
        and (not (v_patch ? 'name') or (
          pg_catalog.jsonb_typeof(v_patch -> 'name') = 'string'
          and pg_catalog.char_length(pg_catalog.btrim(v_patch ->> 'name')) between 1 and 255
        ))
        and (not (v_patch ? 'visible')
          or pg_catalog.jsonb_typeof(v_patch -> 'visible') = 'boolean')
        and (not (v_patch ? 'locked')
          or pg_catalog.jsonb_typeof(v_patch -> 'locked') = 'boolean'),
      false
    );
  end if;
  return false;
end;
$$;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,
  p_client_operation_id uuid,
  p_operation_type text,
  p_base_versions jsonb,
  p_forward jsonb,
  p_inverse jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_object public.lukas_drawing_objects%rowtype;
  v_layer public.lukas_drawing_layers%rowtype;
  v_new_layer public.lukas_drawing_layers%rowtype;
  v_item jsonb;
  v_inverse_item jsonb;
  v_patch jsonb;
  v_object_id uuid;
  v_layer_id uuid;
  v_page_id uuid;
  v_operation_id uuid;
  v_sequence bigint;
  v_result_versions jsonb := '{}'::jsonb;
  v_count integer;
  v_restore_count integer := 0;
  v_capability text;
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if p_client_operation_id is null then raise exception 'Client operation ID is required'; end if;
  if p_operation_type not in (
    'add_objects', 'update_objects', 'delete_objects', 'add_layer', 'update_layer'
  ) then raise exception 'Unsupported drawing operation type'; end if;
  if pg_catalog.jsonb_typeof(p_base_versions) <> 'object'
     or p_forward ->> 'type' is distinct from p_operation_type
     or private.lukas_drawing_operation_payload_valid(p_forward) is not true then
    raise exception 'Drawing operation domain JSON is invalid';
  end if;
  if private.lukas_drawing_operation_inverse_valid(
       p_operation_type, p_forward, p_inverse
     ) is not true then
    raise exception 'Drawing operation inverse payload is invalid';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_each(p_base_versions) b
    where pg_catalog.jsonb_typeof(b.value) <> 'number'
      or (b.value #>> '{}')::numeric <= 0
      or (b.value #>> '{}')::numeric <> pg_catalog.trunc((b.value #>> '{}')::numeric)
  ) then raise exception 'Drawing base versions must be positive integers'; end if;

  select * into v_revision
  from public.lukas_drawing_revisions r
  where r.id = p_revision_id
  for update;
  if not found then raise exception 'Drawing revision does not exist'; end if;
  v_capability := private.lukas_drawing_workspace_capability(v_revision.project_id);
  if v_capability is null or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;

  select * into v_existing
  from public.lukas_drawing_operations o
  where o.revision_id = p_revision_id
    and o.client_operation_id = p_client_operation_id;
  if found then
    return pg_catalog.jsonb_build_object(
      'operationId', v_existing.id,
      'sequence', v_existing.sequence,
      'resultVersions', v_existing.result_versions
    );
  end if;
  if v_revision.status <> 'draft' then
    raise exception 'Drawing operation requires a draft revision';
  end if;

  if p_operation_type = 'add_objects' then
    if p_forward - array['type', 'objects'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'objects') <> 'array'
       or pg_catalog.jsonb_array_length(p_forward -> 'objects') = 0 then
      raise exception 'Invalid add_objects payload';
    end if;
    if exists (
      select 1 from pg_catalog.jsonb_array_elements(p_forward -> 'objects') item
      group by item ->> 'id' having pg_catalog.count(*) > 1
    ) then raise exception 'Drawing operation contains duplicate object IDs'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_forward -> 'objects') loop
      if v_item - array['id', 'name', 'layerId', 'geometry', 'style', 'version'] <> '{}'::jsonb
         or pg_catalog.jsonb_typeof(v_item -> 'name') <> 'string'
         or v_item ->> 'name' <> pg_catalog.btrim(v_item ->> 'name')
         or pg_catalog.char_length(v_item ->> 'name') not between 1 and 255
         or pg_catalog.jsonb_typeof(v_item -> 'geometry') <> 'object'
         or pg_catalog.jsonb_typeof(v_item -> 'style') <> 'object'
         or pg_catalog.jsonb_typeof(v_item -> 'version') <> 'number' then
        raise exception 'Invalid drawing object payload';
      end if;
      v_object_id := (v_item ->> 'id')::uuid;
      v_layer_id := (v_item ->> 'layerId')::uuid;
      select * into v_layer from public.lukas_drawing_layers l
      where l.id = v_layer_id and l.revision_id = p_revision_id
        and l.project_id = v_revision.project_id for update;
      if not found or v_layer.locked then raise exception 'Drawing layer is locked or missing'; end if;
      if private.lukas_drawing_geometry_valid(
          v_item -> 'geometry' ->> 'type', v_item -> 'geometry'
        ) is not true or private.lukas_drawing_style_valid(v_item -> 'style') is not true then
        raise exception 'Drawing object domain JSON is invalid';
      end if;
      select * into v_object from public.lukas_drawing_objects o
      where o.id = v_object_id for update;
      if found then
        if v_object.revision_id <> p_revision_id
           or v_object.project_id <> v_revision.project_id
           or v_object.status <> 'deleted' then
          raise exception 'Drawing object already exists';
        end if;
        if p_base_versions -> v_object_id::text is null
           or (p_base_versions ->> v_object_id::text)::bigint <> v_object.version
           or (v_item ->> 'version')::bigint <> v_object.version + 1 then
          raise exception 'Drawing object restore version conflict';
        end if;
        update public.lukas_drawing_objects
        set page_id = v_layer.page_id, layer_id = v_layer.id,
            name = v_item ->> 'name',
            geometry = v_item -> 'geometry', style = v_item -> 'style',
            status = 'active', version = (v_item ->> 'version')::bigint,
            updated_by = v_actor
        where id = v_object_id;
        v_restore_count := v_restore_count + 1;
        v_result_versions := v_result_versions ||
          pg_catalog.jsonb_build_object(
            v_object_id::text, (v_item ->> 'version')::bigint
          );
      else
        if p_base_versions ? v_object_id::text
           or (v_item ->> 'version')::numeric <> 1 then
          raise exception 'Invalid new drawing object version';
        end if;
        insert into public.lukas_drawing_objects(
          id, lineage_id, page_id, layer_id, revision_id, project_id,
          name, object_type, geometry, style, status, version, created_by, updated_by
        ) values (
          v_object_id, v_object_id, v_layer.page_id, v_layer.id,
          p_revision_id, v_revision.project_id,
          v_item ->> 'name', v_item -> 'geometry' ->> 'type',
          v_item -> 'geometry', v_item -> 'style',
          'active', 1, v_actor, v_actor
        );
        v_result_versions := v_result_versions ||
          pg_catalog.jsonb_build_object(v_object_id::text, 1);
      end if;
    end loop;
    if (select pg_catalog.count(*) from pg_catalog.jsonb_each(p_base_versions))
         <> v_restore_count then
      raise exception 'Drawing restore base versions are incomplete';
    end if;

  elsif p_operation_type = 'update_objects' then
    if p_forward - array['type', 'updates'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'updates') <> 'array'
       or pg_catalog.jsonb_array_length(p_forward -> 'updates') = 0 then
      raise exception 'Invalid update_objects payload';
    end if;
    select pg_catalog.count(*) into v_count
    from pg_catalog.jsonb_array_elements(p_forward -> 'updates');
    if v_count <> (select pg_catalog.count(*) from pg_catalog.jsonb_each(p_base_versions))
       or exists (
         select 1 from pg_catalog.jsonb_array_elements(p_forward -> 'updates') item
         group by item ->> 'objectId' having pg_catalog.count(*) > 1
       ) then raise exception 'Drawing update target versions are incomplete'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_forward -> 'updates') loop
      if v_item - array['objectId', 'patch'] <> '{}'::jsonb
         or pg_catalog.jsonb_typeof(v_item -> 'patch') <> 'object'
         or v_item -> 'patch' = '{}'::jsonb
         or (v_item -> 'patch') - array['name', 'layerId', 'geometry', 'style'] <> '{}'::jsonb then
        raise exception 'Invalid drawing object update payload';
      end if;
      v_object_id := (v_item ->> 'objectId')::uuid;
      v_patch := v_item -> 'patch';
      select * into v_object from public.lukas_drawing_objects o
      where o.id = v_object_id and o.revision_id = p_revision_id
        and o.project_id = v_revision.project_id and o.status = 'active' for update;
      if not found or p_base_versions -> v_object_id::text is null
         or (p_base_versions ->> v_object_id::text)::bigint <> v_object.version then
        raise exception 'Drawing object version conflict';
      end if;
      select * into v_layer from public.lukas_drawing_layers l
      where l.id = v_object.layer_id and l.revision_id = p_revision_id for update;
      if v_layer.locked then raise exception 'Drawing layer is locked'; end if;
      if v_patch ? 'layerId' then
        select * into v_new_layer from public.lukas_drawing_layers l
        where l.id = (v_patch ->> 'layerId')::uuid
          and l.revision_id = p_revision_id
          and l.project_id = v_revision.project_id
          and l.page_id = v_object.page_id for update;
        if not found or v_new_layer.locked then raise exception 'Target drawing layer is locked or missing'; end if;
      end if;
      if v_patch ? 'name'
         and (pg_catalog.jsonb_typeof(v_patch -> 'name') <> 'string'
           or v_patch ->> 'name' <> pg_catalog.btrim(v_patch ->> 'name')
           or pg_catalog.char_length(v_patch ->> 'name') not between 1 and 255) then
        raise exception 'Drawing object name is invalid';
      end if;
      if v_patch ? 'geometry'
         and private.lukas_drawing_geometry_valid(
           v_object.object_type, v_patch -> 'geometry'
         ) is not true then
        raise exception 'Drawing object geometry is invalid';
      end if;
      if v_patch ? 'style'
         and private.lukas_drawing_style_valid(v_patch -> 'style') is not true then
        raise exception 'Drawing object style is invalid';
      end if;
      update public.lukas_drawing_objects
      set name = case when v_patch ? 'name' then v_patch ->> 'name' else name end,
          layer_id = case when v_patch ? 'layerId' then (v_patch ->> 'layerId')::uuid else layer_id end,
          geometry = case when v_patch ? 'geometry' then v_patch -> 'geometry' else geometry end,
          style = case when v_patch ? 'style' then v_patch -> 'style' else style end,
          version = version + 1, updated_by = v_actor
      where id = v_object_id;
      v_result_versions := v_result_versions ||
        pg_catalog.jsonb_build_object(v_object_id::text, v_object.version + 1);
    end loop;

  elsif p_operation_type = 'delete_objects' then
    if p_forward - array['type', 'objectIds'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'objectIds') <> 'array'
       or pg_catalog.jsonb_array_length(p_forward -> 'objectIds') = 0 then
      raise exception 'Invalid delete_objects payload';
    end if;
    select pg_catalog.count(*) into v_count
    from pg_catalog.jsonb_array_elements(p_forward -> 'objectIds');
    if v_count <> (select pg_catalog.count(*) from pg_catalog.jsonb_each(p_base_versions))
       or exists (
         select 1 from pg_catalog.jsonb_array_elements_text(p_forward -> 'objectIds') object_id
         group by object_id having pg_catalog.count(*) > 1
       ) then raise exception 'Drawing delete target versions are incomplete'; end if;
    for v_object_id in
      select value::uuid from pg_catalog.jsonb_array_elements_text(p_forward -> 'objectIds')
    loop
      select * into v_object from public.lukas_drawing_objects o
      where o.id = v_object_id and o.revision_id = p_revision_id
        and o.project_id = v_revision.project_id and o.status = 'active' for update;
      if not found or p_base_versions -> v_object_id::text is null
         or (p_base_versions ->> v_object_id::text)::bigint <> v_object.version then
        raise exception 'Drawing object version conflict';
      end if;
      select item into v_inverse_item
      from pg_catalog.jsonb_array_elements(p_inverse -> 'objects') item
      where item ->> 'id' = v_object_id::text;
      if v_inverse_item is distinct from pg_catalog.jsonb_build_object(
        'id', v_object.id,
        'name', v_object.name,
        'layerId', v_object.layer_id,
        'geometry', v_object.geometry,
        'style', v_object.style,
        'version', v_object.version + 2
      ) then
        raise exception 'Drawing delete inverse is not replayable';
      end if;
      select * into v_layer from public.lukas_drawing_layers l
      where l.id = v_object.layer_id and l.revision_id = p_revision_id for update;
      if v_layer.locked then raise exception 'Drawing layer is locked'; end if;
      update public.lukas_drawing_objects
      set status = 'deleted', version = version + 1, updated_by = v_actor
      where id = v_object_id;
      v_result_versions := v_result_versions ||
        pg_catalog.jsonb_build_object(v_object_id::text, null);
    end loop;

  elsif p_operation_type = 'add_layer' then
    if p_forward - array['type', 'layer'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'layer') <> 'object' then
      raise exception 'Invalid add_layer payload';
    end if;
    v_item := p_forward -> 'layer';
    if v_item - array['id', 'name', 'visible', 'locked', 'version'] <> '{}'::jsonb
       or pg_catalog.char_length(pg_catalog.btrim(v_item ->> 'name')) not between 1 and 255
       or pg_catalog.jsonb_typeof(v_item -> 'visible') <> 'boolean'
       or pg_catalog.jsonb_typeof(v_item -> 'locked') <> 'boolean'
       or pg_catalog.jsonb_typeof(v_item -> 'version') <> 'number'
       or (v_item ->> 'version')::bigint <> 1 then
      raise exception 'Invalid drawing layer payload';
    end if;
    v_layer_id := (v_item ->> 'id')::uuid;
    if p_base_versions <> '{}'::jsonb
       and not ((select pg_catalog.count(*) from pg_catalog.jsonb_each(p_base_versions)) = 1
         and (p_base_versions ->> v_layer_id::text)::bigint = 1) then
      raise exception 'Invalid add_layer base version';
    end if;
    select p.id into v_page_id from public.lukas_drawing_pages p
    where p.revision_id = p_revision_id and p.project_id = v_revision.project_id
    order by p.page_number, p.id limit 1;
    if v_page_id is null then raise exception 'Drawing revision has no page'; end if;
    insert into public.lukas_drawing_layers(
      id, page_id, revision_id, project_id, name, sort_order,
      visible, locked, system_kind, version, created_by
    ) values (
      v_layer_id, v_page_id, p_revision_id, v_revision.project_id,
      pg_catalog.btrim(v_item ->> 'name'),
      (select coalesce(pg_catalog.max(l.sort_order), 0) + 1
       from public.lukas_drawing_layers l where l.page_id = v_page_id),
      (v_item ->> 'visible')::boolean, (v_item ->> 'locked')::boolean,
      'custom', 1, v_actor
    );
    v_result_versions := v_result_versions ||
      pg_catalog.jsonb_build_object(v_layer_id::text, 1);

  elsif p_operation_type = 'update_layer' then
    if p_forward - array['type', 'layerId', 'patch'] <> '{}'::jsonb
       or pg_catalog.jsonb_typeof(p_forward -> 'patch') <> 'object'
       or p_forward -> 'patch' = '{}'::jsonb
       or (p_forward -> 'patch') - array['name', 'visible', 'locked'] <> '{}'::jsonb then
      raise exception 'Invalid update_layer payload';
    end if;
    v_layer_id := (p_forward ->> 'layerId')::uuid;
    v_patch := p_forward -> 'patch';
    if (select pg_catalog.count(*) from pg_catalog.jsonb_each(p_base_versions)) <> 1 then
      raise exception 'Drawing layer base version is required';
    end if;
    select * into v_layer from public.lukas_drawing_layers l
    where l.id = v_layer_id and l.revision_id = p_revision_id
      and l.project_id = v_revision.project_id for update;
    if not found or p_base_versions -> v_layer_id::text is null
       or (p_base_versions ->> v_layer_id::text)::bigint <> v_layer.version then
      raise exception 'Drawing layer version conflict';
    end if;
    if v_layer.system_kind = 'source' then raise exception 'Source drawing layer is immutable'; end if;
    if v_patch ? 'name'
       and pg_catalog.char_length(pg_catalog.btrim(v_patch ->> 'name')) not between 1 and 255 then
      raise exception 'Drawing layer name is invalid';
    end if;
    if v_patch ? 'visible' and pg_catalog.jsonb_typeof(v_patch -> 'visible') <> 'boolean' then
      raise exception 'Drawing layer visibility is invalid';
    end if;
    if v_patch ? 'locked' and pg_catalog.jsonb_typeof(v_patch -> 'locked') <> 'boolean' then
      raise exception 'Drawing layer lock state is invalid';
    end if;
    update public.lukas_drawing_layers
    set name = case when v_patch ? 'name' then pg_catalog.btrim(v_patch ->> 'name') else name end,
        visible = case when v_patch ? 'visible' then (v_patch ->> 'visible')::boolean else visible end,
        locked = case when v_patch ? 'locked' then (v_patch ->> 'locked')::boolean else locked end,
        version = version + 1
    where id = v_layer_id;
    v_result_versions := v_result_versions ||
      pg_catalog.jsonb_build_object(v_layer_id::text, v_layer.version + 1);
  end if;

  select coalesce(pg_catalog.max(o.sequence), 0) + 1 into v_sequence
  from public.lukas_drawing_operations o where o.revision_id = p_revision_id;
  insert into public.lukas_drawing_operations(
    revision_id, project_id, sequence, client_operation_id, operation_type,
    base_versions, forward, inverse, result_versions, actor_id
  ) values (
    p_revision_id, v_revision.project_id, v_sequence, p_client_operation_id,
    p_operation_type, p_base_versions, p_forward, p_inverse, v_result_versions, v_actor
  ) returning id into v_operation_id;
  return pg_catalog.jsonb_build_object(
    'operationId', v_operation_id,
    'sequence', v_sequence,
    'resultVersions', v_result_versions
  );
end;
$$;

create or replace function private.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_snapshot jsonb;
  v_sha256 text;
  v_operation_sequence bigint;
  v_snapshot_id uuid;
  v_capability text;
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  select * into v_revision from public.lukas_drawing_revisions r
  where r.id = p_revision_id for update;
  if not found then raise exception 'Drawing revision does not exist'; end if;
  v_capability := private.lukas_drawing_workspace_capability(v_revision.project_id);
  if v_capability is null or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  if v_revision.status <> 'draft' then raise exception 'Only a draft drawing revision can request review'; end if;

  select coalesce(pg_catalog.max(o.sequence), 0)
  into v_operation_sequence
  from public.lukas_drawing_operations o where o.revision_id = p_revision_id;

  v_snapshot := pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'revision', pg_catalog.jsonb_build_object(
      'id', v_revision.id,
      'documentId', v_revision.document_id,
      'projectId', v_revision.project_id,
      'sequence', v_revision.sequence,
      'version', v_revision.version
    ),
    'pages', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'name', p.name, 'pageNumber', p.page_number,
        'widthMm', p.width_mm, 'heightMm', p.height_mm,
        'backgroundSourceFileId', p.background_source_file_id,
        'backgroundSourceSha256', p.background_source_sha256,
        'backgroundPdfPage', p.background_pdf_page,
        'calibration', p.calibration
      ) order by p.id)
      from public.lukas_drawing_pages p where p.revision_id = p_revision_id
    ), '[]'::jsonb),
    'layers', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', l.id, 'pageId', l.page_id, 'name', l.name,
        'sortOrder', l.sort_order, 'visible', l.visible,
        'locked', l.locked, 'systemKind', l.system_kind, 'version', l.version
      ) order by l.id)
      from public.lukas_drawing_layers l where l.revision_id = p_revision_id
    ), '[]'::jsonb),
    'objects', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', o.id, 'lineageId', o.lineage_id, 'pageId', o.page_id,
        'layerId', o.layer_id, 'name', o.name, 'type', o.object_type,
        'geometry', o.geometry, 'style', o.style, 'version', o.version,
        'sources', coalesce((
          select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'id', s.id, 'sourceFileId', s.source_file_id,
            'sourceSha256', s.source_sha256, 'sourceKind', s.source_kind,
            'pdfPageNumber', s.pdf_page_number, 'x', s.x, 'y', s.y,
            'width', s.width, 'height', s.height, 'elementId', s.element_id,
            'ifcGlobalId', s.ifc_global_id, 'camera', s.camera_json
          ) order by s.id)
          from public.lukas_drawing_object_sources s where s.object_id = o.id
        ), '[]'::jsonb),
        'issueIds', coalesce((
          select pg_catalog.jsonb_agg(link.issue_id order by link.issue_id)
          from public.lukas_drawing_object_issue_links link where link.object_id = o.id
        ), '[]'::jsonb)
      ) order by o.id)
      from public.lukas_drawing_objects o
      where o.revision_id = p_revision_id and o.status = 'active'
    ), '[]'::jsonb),
    'operationSequence', v_operation_sequence
  );
  v_sha256 := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_snapshot::text, 'UTF8'), 'sha256'),
    'hex'
  );
  insert into public.lukas_drawing_snapshots(
    revision_id, project_id, revision_version, operation_sequence,
    canonical_json, sha256, created_by
  ) values (
    p_revision_id, v_revision.project_id, v_revision.version,
    v_operation_sequence, v_snapshot, v_sha256, v_actor
  ) returning id into v_snapshot_id;
  update public.lukas_drawing_revisions
  set status = 'review_requested', review_requested_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  where id = p_revision_id;
  return pg_catalog.jsonb_build_object(
    'snapshotId', v_snapshot_id,
    'subjectVersion', v_revision.version,
    'snapshotSha256', v_sha256,
    'operationSequence', v_operation_sequence
  );
end;
$$;

drop trigger if exists lukas_drawing_layers_domain_guard
  on public.lukas_drawing_layers;
create trigger lukas_drawing_layers_domain_guard
before insert or update or delete on public.lukas_drawing_layers
for each row execute function private.lukas_drawing_layer_guard();

revoke delete on public.lukas_drawing_layers from authenticated;

drop policy if exists "workspace editors add draft drawing layers"
  on public.lukas_drawing_layers;
create policy "workspace editors add draft drawing layers"
on public.lukas_drawing_layers for insert to authenticated
with check (
  created_by = (select auth.uid())
  and system_kind = 'custom'
  and private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (
    select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_layers.revision_id
      and r.project_id = lukas_drawing_layers.project_id
      and r.status = 'draft'
  )
);

drop policy if exists "workspace editors update draft drawing layers"
  on public.lukas_drawing_layers;
create policy "workspace editors update draft drawing layers"
on public.lukas_drawing_layers for update to authenticated
using (
  private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (
    select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_layers.revision_id
      and r.project_id = lukas_drawing_layers.project_id
      and r.status = 'draft'
  )
)
with check (
  created_by is not null
  and private.lukas_drawing_workspace_capability(project_id) in ('admin', 'editor')
  and exists (
    select 1 from public.lukas_drawing_revisions r
    where r.id = lukas_drawing_layers.revision_id
      and r.project_id = lukas_drawing_layers.project_id
      and r.status = 'draft'
  )
);

drop policy if exists "workspace editors delete draft drawing layers"
  on public.lukas_drawing_layers;

commit;
