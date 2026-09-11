begin;

alter table public.lukas_drawing_object_sources
  add column dxf_entity_key text,
  add column dxf_entity_type text,
  add column dxf_source_layer text,
  add column dxf_handle text,
  add column dxf_unit_code integer,
  add column dxf_unit_source text,
  add column dxf_importer_version integer;

create function private.lukas_drawing_dxf_entity_payload_valid(p_entity jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  return coalesce(
    pg_catalog.jsonb_typeof(p_entity)='object'
    and pg_catalog.jsonb_typeof(p_entity->'entityKey')='string'
    and pg_catalog.char_length(p_entity->>'entityKey') between 1 and 1024
    and p_entity->>'entityKey'=pg_catalog.btrim(p_entity->>'entityKey')
    and p_entity->>'entityKey' !~ '[[:cntrl:]]'
    and pg_catalog.jsonb_typeof(p_entity->'entityType')='string'
    and p_entity->>'entityType' in(
      'LINE','LWPOLYLINE','POLYLINE','CIRCLE','ARC','TEXT'
    )
    and pg_catalog.jsonb_typeof(p_entity->'sourceLayer')='string'
    and pg_catalog.char_length(p_entity->>'sourceLayer') between 1 and 255
    and p_entity->>'sourceLayer'=pg_catalog.btrim(p_entity->>'sourceLayer')
    and (
      pg_catalog.jsonb_typeof(p_entity->'handle')='null'
      or (
        pg_catalog.jsonb_typeof(p_entity->'handle')='string'
        and p_entity->>'handle' ~ '^[0-9A-F]{1,32}$'
      )
    )
    and pg_catalog.jsonb_typeof(p_entity->'unitCode')='number'
    and (p_entity->>'unitCode')::numeric in(1,2,4,5,6)
    and (p_entity->>'unitCode')::numeric
      =pg_catalog.trunc((p_entity->>'unitCode')::numeric)
    and pg_catalog.jsonb_typeof(p_entity->'unitSource')='string'
    and p_entity->>'unitSource' in('declared','user_selected')
    and pg_catalog.jsonb_typeof(p_entity->'importerVersion')='number'
    and (p_entity->>'importerVersion')::numeric=1,
    false
  );
exception when others then return false;
end;
$$;

alter table public.lukas_drawing_object_sources
  drop constraint lukas_drawing_object_sources_source_kind_check,
  drop constraint lukas_drawing_object_sources_exact_payload_check;

alter table public.lukas_drawing_object_sources
  add constraint lukas_drawing_object_sources_source_kind_check
    check(source_kind in('pdf_region','ifc_element','dxf_entity')),
  add constraint lukas_drawing_object_sources_exact_payload_check check(
    (
      source_kind='pdf_region'
      and pdf_page_number is not null and pdf_page_number>0
      and x is not null and x>=0 and y is not null and y>=0
      and width is not null and width>0 and height is not null and height>0
      and x+width<=1 and y+height<=1
      and element_id is null and ifc_global_id is null and camera_json is null
      and dxf_entity_key is null and dxf_entity_type is null
      and dxf_source_layer is null and dxf_handle is null
      and dxf_unit_code is null and dxf_unit_source is null
      and dxf_importer_version is null
    ) or (
      source_kind='ifc_element'
      and pdf_page_number is null and x is null and y is null
      and width is null and height is null
      and (
        status='active'
        and ifc_global_id is not null
        and ifc_global_id ~ '^[0-9A-Za-z_$]{22}$'
        and (element_id is null or element_id ~ '^[1-9][0-9]*$')
        and private.lukas_drawing_p5_camera_valid(camera_json)
        or status='deleted'
        and (element_id is not null or ifc_global_id is not null)
        and (
          element_id is null
          or pg_catalog.char_length(pg_catalog.btrim(element_id)) between 1 and 128
        )
        and (ifc_global_id is null or ifc_global_id ~ '^[0-9A-Za-z_$]{22}$')
        and (camera_json is null or pg_catalog.jsonb_typeof(camera_json)='object')
      )
      and dxf_entity_key is null and dxf_entity_type is null
      and dxf_source_layer is null and dxf_handle is null
      and dxf_unit_code is null and dxf_unit_source is null
      and dxf_importer_version is null
    ) or (
      source_kind='dxf_entity'
      and pdf_page_number is null and x is null and y is null
      and width is null and height is null
      and element_id is null and ifc_global_id is null and camera_json is null
      and private.lukas_drawing_dxf_entity_payload_valid(
        pg_catalog.jsonb_build_object(
          'entityKey',dxf_entity_key,
          'entityType',dxf_entity_type,
          'sourceLayer',dxf_source_layer,
          'handle',dxf_handle,
          'unitCode',dxf_unit_code,
          'unitSource',dxf_unit_source,
          'importerVersion',dxf_importer_version
        )
      )
    )
  );

create or replace function private.lukas_drawing_source_json(
  p_id uuid,p_revision_id uuid,p_project_id uuid,p_active_only boolean default true
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;
begin
  select case s.source_kind
    when 'pdf_region' then pg_catalog.jsonb_build_object(
      'id',s.id,'objectId',s.object_id,'revisionId',s.revision_id,
      'sourceFileId',s.source_file_id,'sourceSha256',s.source_sha256,
      'sourceKind',s.source_kind,'pdfPageNumber',s.pdf_page_number,
      'x',s.x,'y',s.y,'width',s.width,'height',s.height,'version',s.version)
    when 'ifc_element' then pg_catalog.jsonb_build_object(
      'id',s.id,'objectId',s.object_id,'revisionId',s.revision_id,
      'sourceFileId',s.source_file_id,'sourceSha256',s.source_sha256,
      'sourceKind',s.source_kind,'ifcGlobalId',s.ifc_global_id,
      'elementId',s.element_id,'camera',s.camera_json,'version',s.version)
    when 'dxf_entity' then pg_catalog.jsonb_build_object(
      'id',s.id,'objectId',s.object_id,'revisionId',s.revision_id,
      'sourceFileId',s.source_file_id,'sourceSha256',s.source_sha256,
      'sourceKind',s.source_kind,'entityKey',s.dxf_entity_key,
      'entityType',s.dxf_entity_type,'sourceLayer',s.dxf_source_layer,
      'handle',s.dxf_handle,'unitCode',s.dxf_unit_code,
      'unitSource',s.dxf_unit_source,
      'importerVersion',s.dxf_importer_version,'version',s.version)
  end into v
  from public.lukas_drawing_object_sources s
  where s.id=p_id and s.revision_id=p_revision_id and s.project_id=p_project_id
    and (not p_active_only or s.status='active');
  return v;
end;
$$;

create or replace function private.lukas_drawing_structure_action_valid(
  p_action jsonb,p_revision_id uuid
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare v jsonb:=p_action->'entity'; v_kind text:=p_action->>'kind';
begin
  if v_kind not in('put_source','delete_source') then
    return private.lukas_drawing_structure_action_valid_pre_p5_sources(
      p_action,p_revision_id
    );
  end if;
  if pg_catalog.jsonb_typeof(p_action)<>'object' then return false; end if;
  if v_kind='delete_source' then
    return p_action ?& array['kind','id','baseVersion']
      and p_action-array['kind','id','baseVersion']='{}'::jsonb
      and private.lukas_drawing_p2_uuid(p_action->'id') is true
      and private.lukas_drawing_p2_positive_integer(p_action->'baseVersion') is true;
  end if;
  if not (p_action ?& array['kind','entity','baseVersion'])
    or p_action-array['kind','entity','baseVersion']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(v)<>'object'
    or not (
      pg_catalog.jsonb_typeof(p_action->'baseVersion')='null'
      or private.lukas_drawing_p2_positive_integer(p_action->'baseVersion') is true
    )
    or not (v ?& array[
      'id','objectId','revisionId','sourceFileId','sourceSha256','sourceKind','version'
    ])
    or private.lukas_drawing_p2_uuid(v->'id') is not true
    or private.lukas_drawing_p2_uuid(v->'objectId') is not true
    or private.lukas_drawing_p2_uuid(v->'revisionId') is not true
    or (v->>'revisionId')::uuid<>p_revision_id
    or private.lukas_drawing_p2_uuid(v->'sourceFileId') is not true
    or v->>'sourceSha256' !~ '^[0-9a-f]{64}$'
    or private.lukas_drawing_p2_positive_integer(v->'version') is not true
  then return false; end if;
  if v->>'sourceKind'='pdf_region' then
    return v ?& array['pdfPageNumber','x','y','width','height']
      and v-array[
        'id','objectId','revisionId','sourceFileId','sourceSha256','sourceKind',
        'pdfPageNumber','x','y','width','height','version'
      ]='{}'::jsonb
      and private.lukas_drawing_p2_positive_integer(v->'pdfPageNumber') is true
      and pg_catalog.jsonb_typeof(v->'x')='number'
      and pg_catalog.jsonb_typeof(v->'y')='number'
      and pg_catalog.jsonb_typeof(v->'width')='number'
      and pg_catalog.jsonb_typeof(v->'height')='number'
      and (v->>'x')::numeric>=0 and (v->>'y')::numeric>=0
      and (v->>'width')::numeric>0 and (v->>'height')::numeric>0
      and (v->>'x')::numeric+(v->>'width')::numeric<=1
      and (v->>'y')::numeric+(v->>'height')::numeric<=1;
  elsif v->>'sourceKind'='ifc_element' then
    return v ?& array['ifcGlobalId','elementId','camera']
      and v-array[
        'id','objectId','revisionId','sourceFileId','sourceSha256','sourceKind',
        'ifcGlobalId','elementId','camera','version'
      ]='{}'::jsonb
      and v->>'ifcGlobalId' ~ '^[0-9A-Za-z_$]{22}$'
      and (
        pg_catalog.jsonb_typeof(v->'elementId')='null'
        or (
          pg_catalog.jsonb_typeof(v->'elementId')='string'
          and v->>'elementId' ~ '^[1-9][0-9]*$'
        )
      )
      and (
        pg_catalog.jsonb_typeof(v->'camera')='null'
        or private.lukas_drawing_p5_camera_valid(v->'camera')
      );
  elsif v->>'sourceKind'='dxf_entity' then
    return v ?& array[
        'entityKey','entityType','sourceLayer','handle',
        'unitCode','unitSource','importerVersion'
      ]
      and v-array[
        'id','objectId','revisionId','sourceFileId','sourceSha256','sourceKind',
        'entityKey','entityType','sourceLayer','handle','unitCode','unitSource',
        'importerVersion','version'
      ]='{}'::jsonb
      and private.lukas_drawing_dxf_entity_payload_valid(v);
  end if;
  return false;
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_object_source_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_internal boolean:=current_user not in('authenticated','anon')
    or pg_catalog.current_setting(
      'private.lukas_drawing_source_operation',true
    )=coalesce(new.revision_id,old.revision_id)::text;
begin
  if not v_internal then
    raise exception using errcode='42501',
      message='Drawing sources are mutated only by drawing operations';
  end if;
  if tg_op='DELETE' then
    if pg_catalog.current_setting(
      'private.lukas_drawing_p5_checkpoint_operation',true
    )=old.revision_id::text then return null; end if;
    if old.status='deleted' then return null; end if;
    perform pg_catalog.set_config(
      'private.lukas_drawing_source_operation',old.revision_id::text,true
    );
    update public.lukas_drawing_object_sources set
      status='deleted',version=old.version+1,
      updated_by=coalesce(v_actor,old.updated_by),updated_at=pg_catalog.now()
    where id=old.id and status='active';
    return null;
  end if;
  if not exists(
    select 1 from public.lukas_qto_files f
    where f.id=new.source_file_id and f.project_id=new.project_id
      and f.sha256=new.source_sha256 and f.immutable
      and (
        new.source_kind='pdf_region' and f.kind='pdf'
        or new.source_kind='ifc_element' and f.kind='ifc'
        or new.source_kind='dxf_entity' and f.kind='dxf'
      )
  ) then
    raise exception using errcode='P1R01',
      message='Drawing source requires its immutable project file identity';
  end if;
  if new.status='active' and not exists(
    select 1 from public.lukas_drawing_objects o
    where o.id=new.object_id and o.revision_id=new.revision_id
      and o.project_id=new.project_id and o.status='active'
  ) then
    raise exception using errcode='P1R01',
      message='Drawing source requires an active owning object';
  end if;
  if tg_op='INSERT' then
    if pg_catalog.current_setting(
        'private.lukas_drawing_source_operation',true
      ) is distinct from new.revision_id::text
      and current_user not in('authenticated','anon') then
      if exists(
        select 1 from public.lukas_drawing_object_sources existing
        where existing.object_id=new.object_id
          and existing.source_file_id=new.source_file_id
          and existing.source_kind=new.source_kind
          and existing.status='active'
      ) then return null; end if;
      if not exists(
        select 1
        from public.lukas_drawing_objects child
        join public.lukas_drawing_objects parent
          on parent.lineage_id=child.lineage_id
          and parent.project_id=child.project_id
        join public.lukas_drawing_object_sources source
          on source.object_id=parent.id and source.revision_id=parent.revision_id
          and source.project_id=parent.project_id and source.status='active'
        where child.id=new.object_id and child.revision_id=new.revision_id
          and source.source_file_id=new.source_file_id
          and source.source_sha256=new.source_sha256
          and source.source_kind=new.source_kind
          and source.pdf_page_number is not distinct from new.pdf_page_number
          and source.x is not distinct from new.x
          and source.y is not distinct from new.y
          and source.width is not distinct from new.width
          and source.height is not distinct from new.height
          and source.element_id is not distinct from new.element_id
          and source.ifc_global_id is not distinct from new.ifc_global_id
          and source.camera_json is not distinct from new.camera_json
          and source.dxf_entity_key is not distinct from new.dxf_entity_key
          and source.dxf_entity_type is not distinct from new.dxf_entity_type
          and source.dxf_source_layer is not distinct from new.dxf_source_layer
          and source.dxf_handle is not distinct from new.dxf_handle
          and source.dxf_unit_code is not distinct from new.dxf_unit_code
          and source.dxf_unit_source is not distinct from new.dxf_unit_source
          and source.dxf_importer_version
            is not distinct from new.dxf_importer_version
      ) then return null; end if;
    end if;
    if new.status<>'active' or new.version<>1
      or new.created_by is distinct from v_actor
      or new.updated_by is distinct from v_actor then
      raise exception using errcode='P1C01',
        message='Drawing source initial actor and version are invalid';
    end if;
  else
    if new.id is distinct from old.id
      or new.object_id is distinct from old.object_id
      or new.revision_id is distinct from old.revision_id
      or new.project_id is distinct from old.project_id
      or new.source_file_id is distinct from old.source_file_id
      or new.source_sha256 is distinct from old.source_sha256
      or new.source_kind is distinct from old.source_kind
      or new.pdf_page_number is distinct from old.pdf_page_number
      or new.x is distinct from old.x or new.y is distinct from old.y
      or new.width is distinct from old.width or new.height is distinct from old.height
      or new.element_id is distinct from old.element_id
      or new.ifc_global_id is distinct from old.ifc_global_id
      or new.camera_json is distinct from old.camera_json
      or new.dxf_entity_key is distinct from old.dxf_entity_key
      or new.dxf_entity_type is distinct from old.dxf_entity_type
      or new.dxf_source_layer is distinct from old.dxf_source_layer
      or new.dxf_handle is distinct from old.dxf_handle
      or new.dxf_unit_code is distinct from old.dxf_unit_code
      or new.dxf_unit_source is distinct from old.dxf_unit_source
      or new.dxf_importer_version is distinct from old.dxf_importer_version
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.version<>old.version+1
      or new.updated_by is distinct from v_actor
      or not (
        old.status='active' and new.status in('active','deleted')
        or old.status='deleted' and new.status='active'
      ) then
      raise exception using errcode='P1C01',
        message='Drawing source identity, payload, actor, and version are immutable';
    end if;
  end if;
  new.updated_at:=pg_catalog.now();
  return new;
end;
$$;

create or replace function private.lukas_drawing_object_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if tg_op='UPDATE'
    and pg_catalog.current_setting(
      'private.lukas_drawing_dxf_layer_rehome',true
    )=old.revision_id::text
    and old.status='deleted' and new.status='deleted'
    and new.version=old.version and new.updated_by=old.updated_by
    and new.layer_id is distinct from old.layer_id
    and (pg_catalog.to_jsonb(new)-array['layer_id','page_id','updated_at'])
      =(pg_catalog.to_jsonb(old)-array['layer_id','page_id','updated_at'])
    and exists(
      select 1 from public.lukas_drawing_layers l
      where l.id=new.layer_id and l.page_id=new.page_id
        and l.revision_id=new.revision_id and l.project_id=new.project_id
        and l.visible and not l.locked and l.system_kind<>'source'
    ) then
    new.updated_at:=pg_catalog.now(); return new;
  end if;
  if private.lukas_drawing_geometry_valid(new.object_type,new.geometry) is not true
    or ((new.style_id is null and private.lukas_drawing_style_valid(new.style) is not true)
      or (new.style_id is not null and private.lukas_drawing_style_override_valid(new.style) is not true)) then
    raise exception 'Drawing object domain JSON is invalid'; end if;
  if new.geometry->>'type' is distinct from new.object_type then
    raise exception 'Drawing geometry type must match object_type'; end if;
  if not exists(select 1 from public.lukas_drawing_layers l where l.id=new.layer_id
    and l.page_id=new.page_id and l.revision_id=new.revision_id and l.project_id=new.project_id
    and not l.locked) then raise exception 'Drawing object requires an unlocked layer on the same page'; end if;
  if new.style_id is not null and not exists(select 1 from public.lukas_drawing_styles s
    where s.id=new.style_id and s.revision_id=new.revision_id and s.project_id=new.project_id) then
    raise exception 'Drawing object style reference is invalid'; end if;
  if tg_op='INSERT' then
    if new.created_by<>v_actor or new.updated_by<>v_actor or new.version<>1 or new.status<>'active' then
      raise exception 'Drawing object creator or initial state is invalid'; end if;
  else
    if new.id is distinct from old.id or new.lineage_id is distinct from old.lineage_id
      or new.revision_id is distinct from old.revision_id or new.project_id is distinct from old.project_id
      or new.object_type is distinct from old.object_type or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then raise exception 'Drawing object identity is immutable'; end if;
    if pg_catalog.current_setting(
        'private.lukas_drawing_p4_clone_host_remap',true
      )=new.revision_id::text
      and old.object_type='opening' and new.object_type='opening'
      and new.version=old.version and new.updated_by=v_actor
      and (pg_catalog.to_jsonb(new)-array['geometry','host_object_id','updated_at'])
        =(pg_catalog.to_jsonb(old)-array['geometry','host_object_id','updated_at'])
      and new.geometry-'hostWallId'=old.geometry-'hostWallId'
      and exists(
        select 1
        from public.lukas_drawing_objects source_host
        join public.lukas_drawing_objects child_host
          on child_host.lineage_id=source_host.lineage_id
          and child_host.revision_id=new.revision_id
          and child_host.project_id=new.project_id
          and child_host.object_type='wall' and child_host.status='active'
        where source_host.id=(old.geometry->>'hostWallId')::uuid
          and source_host.project_id=new.project_id
          and source_host.object_type='wall'
          and child_host.id=(new.geometry->>'hostWallId')::uuid
      ) then
      return new;
    end if;
    if new.updated_by<>v_actor or new.version<>old.version+1 then
      raise exception 'Drawing object actor or version is invalid'; end if;
  end if;
  new.updated_at:=pg_catalog.now(); return new;
end;
$$;

create or replace function private.lukas_drawing_apply_source_actions(
  p_revision_id uuid,p_project_id uuid,p_actor uuid,
  p_actions jsonb,p_result_versions jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare v_action jsonb; v_entity jsonb; v_id uuid; v_row jsonb; v_version bigint;
begin
  if pg_catalog.jsonb_typeof(p_actions)<>'array' then return; end if;
  perform pg_catalog.set_config(
    'private.lukas_drawing_source_operation',p_revision_id::text,true
  );
  for v_action in select value from pg_catalog.jsonb_array_elements(p_actions)
  loop
    if v_action->>'kind' not in('put_source','delete_source') then continue; end if;
    v_entity:=v_action->'entity';
    v_id:=coalesce((v_entity->>'id')::uuid,(v_action->>'id')::uuid);
    if v_action->>'kind'='delete_source' then
      update public.lukas_drawing_object_sources set
        status='deleted',version=(v_action->>'baseVersion')::bigint+1,
        updated_by=p_actor
      where id=v_id and revision_id=p_revision_id and project_id=p_project_id
        and status='active' and version=(v_action->>'baseVersion')::bigint;
      if not found then raise exception using errcode='P1C01',
        message='Drawing source delete base version is stale'; end if;
    else
      v_version:=(p_result_versions->>v_id::text)::bigint;
      v_row:=private.lukas_drawing_source_json(
        v_id,p_revision_id,p_project_id,false
      );
      if v_row is null then
        if v_version<>1 then raise exception using errcode='P1C01',
          message='Drawing source initial result version is invalid'; end if;
        insert into public.lukas_drawing_object_sources(
          id,object_id,revision_id,project_id,source_file_id,source_sha256,
          source_kind,pdf_page_number,x,y,width,height,element_id,ifc_global_id,
          camera_json,dxf_entity_key,dxf_entity_type,dxf_source_layer,
          dxf_handle,dxf_unit_code,dxf_unit_source,dxf_importer_version,
          status,version,created_by,updated_by
        ) values(
          v_id,(v_entity->>'objectId')::uuid,p_revision_id,p_project_id,
          (v_entity->>'sourceFileId')::uuid,v_entity->>'sourceSha256',
          v_entity->>'sourceKind',nullif(v_entity->>'pdfPageNumber','')::integer,
          nullif(v_entity->>'x','')::numeric,nullif(v_entity->>'y','')::numeric,
          nullif(v_entity->>'width','')::numeric,
          nullif(v_entity->>'height','')::numeric,
          nullif(v_entity->>'elementId',''),nullif(v_entity->>'ifcGlobalId',''),
          case when pg_catalog.jsonb_typeof(v_entity->'camera')='null'
            then null else v_entity->'camera' end,
          nullif(v_entity->>'entityKey',''),nullif(v_entity->>'entityType',''),
          nullif(v_entity->>'sourceLayer',''),nullif(v_entity->>'handle',''),
          nullif(v_entity->>'unitCode','')::integer,
          nullif(v_entity->>'unitSource',''),
          nullif(v_entity->>'importerVersion','')::integer,
          'active',v_version,p_actor,p_actor
        );
      else
        if (v_row-'version') is distinct from (v_entity-'version') then
          raise exception using errcode='P1C01',
            message='Drawing source payload is immutable';
        end if;
        update public.lukas_drawing_object_sources set
          status='active',version=v_version,updated_by=p_actor
        where id=v_id and revision_id=p_revision_id and project_id=p_project_id
          and version=v_version-1;
        if not found then raise exception using errcode='P1C01',
          message='Drawing source put result version is stale'; end if;
      end if;
    end if;
  end loop;
  if exists(
    select 1 from public.lukas_drawing_object_sources s
    left join public.lukas_drawing_objects o
      on o.id=s.object_id and o.revision_id=s.revision_id
      and o.project_id=s.project_id and o.status='active'
    where s.revision_id=p_revision_id and s.project_id=p_project_id
      and s.status='active' and o.id is null
  ) then raise exception using errcode='P1C01',
    message='Drawing source final graph has an inactive owner'; end if;
end;
$$;

create or replace function private.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_result jsonb; v_revision_id uuid;
begin
  v_result:=private.lukas_drawing_create_from_template_pre_p5_sources(
    p_source_revision_id,p_title,p_source_file_id
  );
  v_revision_id:=(v_result->>'revisionId')::uuid;
  insert into public.lukas_drawing_object_sources(
    id,object_id,revision_id,project_id,source_file_id,source_sha256,
    source_kind,pdf_page_number,x,y,width,height,element_id,ifc_global_id,
    camera_json,dxf_entity_key,dxf_entity_type,dxf_source_layer,dxf_handle,
    dxf_unit_code,dxf_unit_source,dxf_importer_version,
    status,version,created_by,updated_by
  ) select
    extensions.gen_random_uuid(),child.id,v_revision_id,source.project_id,
    source.source_file_id,source.source_sha256,source.source_kind,
    source.pdf_page_number,source.x,source.y,source.width,source.height,
    source.element_id,source.ifc_global_id,source.camera_json,
    source.dxf_entity_key,source.dxf_entity_type,source.dxf_source_layer,
    source.dxf_handle,source.dxf_unit_code,source.dxf_unit_source,
    source.dxf_importer_version,'active',1,v_actor,v_actor
  from public.lukas_drawing_object_sources source
  join public.lukas_drawing_objects parent
    on parent.id=source.object_id and parent.revision_id=p_source_revision_id
    and parent.project_id=source.project_id and parent.status='active'
  join public.lukas_drawing_objects child
    on child.lineage_id=parent.lineage_id and child.revision_id=v_revision_id
    and child.project_id=parent.project_id and child.status='active'
  where source.revision_id=p_source_revision_id and source.status='active'
    and not exists(
      select 1 from public.lukas_drawing_object_sources existing
      where existing.object_id=child.id
        and existing.source_file_id=source.source_file_id
        and existing.source_kind=source.source_kind and existing.status='active'
    );
  return v_result;
end;
$$;

create or replace function private.lukas_drawing_p5_checkpoint_sources(
  p_sources jsonb,p_revision_id uuid
) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  v_source jsonb;
  v_result jsonb:='[]'::jsonb;
  v_legacy_keys text[]:=array[
    'id','objectId','sourceFileId','sourceSha256','sourceKind',
    'pdfPageNumber','x','y','width','height','elementId','ifcGlobalId','camera'
  ];
  v_dxf_legacy_keys text[]:=array[
    'id','objectId','sourceFileId','sourceSha256','sourceKind',
    'entityKey','entityType','sourceLayer','handle','unitCode','unitSource',
    'importerVersion'
  ];
begin
  if pg_catalog.jsonb_typeof(p_sources)<>'array' then return p_sources; end if;
  for v_source in select value from pg_catalog.jsonb_array_elements(p_sources)
  loop
    if pg_catalog.jsonb_typeof(v_source)='object'
      and v_source ?& v_legacy_keys
      and v_source-v_legacy_keys='{}'::jsonb then
      if v_source->>'sourceKind'='pdf_region' then
        v_source:=pg_catalog.jsonb_build_object(
          'id',v_source->'id','objectId',v_source->'objectId',
          'revisionId',p_revision_id,'sourceFileId',v_source->'sourceFileId',
          'sourceSha256',v_source->'sourceSha256','sourceKind','pdf_region',
          'pdfPageNumber',v_source->'pdfPageNumber','x',v_source->'x',
          'y',v_source->'y','width',v_source->'width','height',v_source->'height',
          'version',1
        );
      elsif v_source->>'sourceKind'='ifc_element' then
        v_source:=pg_catalog.jsonb_build_object(
          'id',v_source->'id','objectId',v_source->'objectId',
          'revisionId',p_revision_id,'sourceFileId',v_source->'sourceFileId',
          'sourceSha256',v_source->'sourceSha256','sourceKind','ifc_element',
          'ifcGlobalId',v_source->'ifcGlobalId','elementId',v_source->'elementId',
          'camera',v_source->'camera','version',1
        );
      end if;
    elsif pg_catalog.jsonb_typeof(v_source)='object'
      and v_source ?& v_dxf_legacy_keys
      and v_source-v_dxf_legacy_keys='{}'::jsonb
      and v_source->>'sourceKind'='dxf_entity' then
      v_source:=pg_catalog.jsonb_build_object(
        'id',v_source->'id','objectId',v_source->'objectId',
        'revisionId',p_revision_id,'sourceFileId',v_source->'sourceFileId',
        'sourceSha256',v_source->'sourceSha256','sourceKind','dxf_entity',
        'entityKey',v_source->'entityKey','entityType',v_source->'entityType',
        'sourceLayer',v_source->'sourceLayer','handle',v_source->'handle',
        'unitCode',v_source->'unitCode','unitSource',v_source->'unitSource',
        'importerVersion',v_source->'importerVersion','version',1
      );
    end if;
    v_result:=v_result||pg_catalog.jsonb_build_array(v_source);
  end loop;
  return v_result;
end;
$$;

create function private.lukas_drawing_dxf_history_group_valid(p_group jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  return coalesce(
    pg_catalog.jsonb_typeof(p_group)='object'
    and p_group ?& array['id','kind','index','count']
    and p_group-array['id','kind','index','count']='{}'::jsonb
    and private.lukas_drawing_p2_uuid(p_group->'id') is true
    and p_group->>'kind'='dxf_import'
    and pg_catalog.jsonb_typeof(p_group->'index')='number'
    and (p_group->>'index')::numeric
      =pg_catalog.trunc((p_group->>'index')::numeric)
    and pg_catalog.jsonb_typeof(p_group->'count')='number'
    and (p_group->>'count')::numeric
      =pg_catalog.trunc((p_group->>'count')::numeric)
    and (p_group->>'index')::numeric>=0
    and (p_group->>'count')::numeric between 1 and 48
    and (p_group->>'index')::numeric<(p_group->>'count')::numeric,
    false
  );
exception when others then return false;
end;
$$;

create table private.lukas_drawing_operation_write_leases(
  token uuid primary key,
  transaction_id bigint not null,
  revision_id uuid not null,
  client_operation_id uuid not null,
  actor_id uuid,
  request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(transaction_id,revision_id,client_operation_id)
);

create table private.lukas_drawing_operation_authority_proofs(
  operation_id uuid primary key references public.lukas_drawing_operations(id)
    on delete cascade,
  operation_sha256 text not null check(operation_sha256 ~ '^[0-9a-f]{64}$'),
  authorized_transaction_id bigint not null,
  authorized_at timestamptz not null default pg_catalog.clock_timestamp()
);

create function private.lukas_drawing_operation_envelope_sha256(
  p_operation public.lukas_drawing_operations
) returns text language sql immutable security invoker set search_path='' as $$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'id',p_operation.id,'revisionId',p_operation.revision_id,
      'projectId',p_operation.project_id,'sequence',p_operation.sequence,
      'clientOperationId',p_operation.client_operation_id,
      'operationType',p_operation.operation_type,
      'baseVersions',p_operation.base_versions,'forward',p_operation.forward,
      'inverse',p_operation.inverse,'resultVersions',p_operation.result_versions,
      'actorId',p_operation.actor_id,'historyAction',p_operation.history_action,
      'originalOperationId',p_operation.original_operation_id,
      'createdAtEpochMicroseconds',
        (extract(epoch from p_operation.created_at)*1000000)::bigint
    )::text,'UTF8'),'sha256'),'hex')
$$;

create function private.lukas_drawing_operation_authority_proof_valid(
  p_operation public.lukas_drawing_operations
) returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from private.lukas_drawing_operation_authority_proofs proof
    where proof.operation_id=p_operation.id
      and proof.operation_sha256=
        private.lukas_drawing_operation_envelope_sha256(p_operation)
  )
$$;

create function private.lukas_drawing_begin_operation_write_lease(
  p_revision_id uuid,p_client_operation_id uuid,p_actor_id uuid,
  p_operation_type text,p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare v_token uuid:=extensions.gen_random_uuid(); v_request_sha256 text;
begin
  if p_revision_id is null or p_client_operation_id is null
    or p_actor_id is null then return null; end if;
  v_request_sha256:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'revisionId',p_revision_id,'clientOperationId',p_client_operation_id,
      'operationType',p_operation_type,'baseVersions',p_base_versions,
      'forward',p_forward,'inverse',p_inverse,
      'historyAction',p_history_action,
      'originalOperationId',p_original_operation_id
    )::text,'UTF8'),'sha256'),'hex');
  insert into private.lukas_drawing_operation_write_leases(
    token,transaction_id,revision_id,client_operation_id,actor_id,
    request_sha256
  ) values(
    v_token,pg_catalog.txid_current(),p_revision_id,p_client_operation_id,
    p_actor_id,v_request_sha256
  );
  perform pg_catalog.set_config(
    'private.lukas_drawing_operation_write_token',v_token::text,true
  );
  return v_token;
end;
$$;

create function private.lukas_drawing_finish_operation_write_lease(
  p_token uuid
) returns void language plpgsql volatile security definer set search_path='' as $$
begin
  if p_token is null then return; end if;
  perform pg_catalog.set_config(
    'private.lukas_drawing_operation_write_token','',true
  );
  delete from private.lukas_drawing_operation_write_leases lease
  where lease.token=p_token
    and lease.transaction_id=pg_catalog.txid_current();
end;
$$;

create function private.lukas_drawing_operation_authority_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_token uuid;
begin
  begin
    v_token:=nullif(pg_catalog.current_setting(
      'private.lukas_drawing_operation_write_token',true
    ),'')::uuid;
  exception when others then v_token:=null;
  end;
  if v_token is null or not exists(
    select 1 from private.lukas_drawing_operation_write_leases lease
    where lease.token=v_token
      and lease.transaction_id=pg_catalog.txid_current()
      and lease.revision_id=new.revision_id
      and lease.client_operation_id=new.client_operation_id
      and lease.actor_id is not distinct from new.actor_id
  ) then
    raise exception using errcode='P1C01',
      message='Drawing operation requires canonical mutation authority';
  end if;
  return new;
end;
$$;

create function private.lukas_drawing_operation_authority_proof_write()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.lukas_drawing_operation_authority_proofs(
    operation_id,operation_sha256,authorized_transaction_id,authorized_at
  ) values(
    new.id,private.lukas_drawing_operation_envelope_sha256(new),
    pg_catalog.txid_current(),pg_catalog.clock_timestamp()
  ) on conflict(operation_id) do update set
    operation_sha256=excluded.operation_sha256,
    authorized_transaction_id=excluded.authorized_transaction_id,
    authorized_at=excluded.authorized_at;
  return new;
end;
$$;

create trigger lukas_drawing_operation_authority_guard
before insert or update on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_operation_authority_guard();
create trigger lukas_drawing_operation_authority_proof_write
after insert or update on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_operation_authority_proof_write();

create function private.lukas_drawing_dxf_history_payload_identity(
  p_payload jsonb
) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare v_action jsonb; v_actions jsonb:='[]'::jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload)<>'object'
    or pg_catalog.jsonb_typeof(p_payload->'actions')<>'array' then return null;
  end if;
  for v_action in
    select value from pg_catalog.jsonb_array_elements(p_payload->'actions')
  loop
    v_action:=v_action-'baseVersion';
    if pg_catalog.jsonb_typeof(v_action->'entity')='object' then
      v_action:=pg_catalog.jsonb_set(
        v_action,'{entity}',v_action->'entity'-'version',false
      );
    end if;
    v_actions:=v_actions||pg_catalog.jsonb_build_array(v_action);
  end loop;
  return pg_catalog.jsonb_set(
    p_payload-'historyGroup','{actions}',v_actions,false
  );
exception when others then return null;
end;
$$;

create function private.lukas_drawing_dxf_history_action_state_matches(
  p_revision_id uuid,p_project_id uuid,p_action jsonb,p_result_versions jsonb
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare
  v_kind text:=p_action->>'kind'; v_entity jsonb:=p_action->'entity';
  v_id uuid; v_actual jsonb;
begin
  if v_kind not in(
      'put_layer','delete_layer','put_object','delete_object',
      'put_source','delete_source','patch_layer','patch_object'
    ) or pg_catalog.jsonb_typeof(p_result_versions)<>'object' then return false;
  end if;
  v_id:=coalesce((v_entity->>'id')::uuid,(p_action->>'id')::uuid);
  v_actual:=private.lukas_drawing_structure_entity_json(
    case
      when v_kind in('put_layer','delete_layer','patch_layer') then 'layer'
      when v_kind in('put_object','delete_object','patch_object') then 'object'
      else 'source'
    end,
    v_id,p_revision_id,p_project_id
  );
  if v_kind like 'patch\_%' then
    return v_actual is not null
      and private.lukas_drawing_p2_positive_integer(
        p_action->'baseVersion'
      ) is true
      and private.lukas_drawing_p2_positive_integer(
        p_result_versions->v_id::text
      ) is true
      and (p_result_versions->>v_id::text)::bigint
        =(p_action->>'baseVersion')::bigint+1
      and (v_actual->>'version')::bigint
        =(p_result_versions->>v_id::text)::bigint
      and pg_catalog.jsonb_typeof(p_action->'patch')='object'
      and p_action->'patch'<>'{}'::jsonb
      and not exists(
        select 1 from pg_catalog.jsonb_each(p_action->'patch') patch
        where not (v_actual ? patch.key)
          or v_actual->patch.key is distinct from patch.value
      );
  end if;
  if v_kind like 'put_%' then
    if v_kind='put_object' and not (v_entity ? 'styleId')
      and pg_catalog.jsonb_typeof(v_actual->'styleId')='null' then
      v_actual:=v_actual-'styleId';
    end if;
    return v_actual is not null
      and private.lukas_drawing_p2_positive_integer(
        p_result_versions->v_id::text
      ) is true
      and (v_actual->>'version')::bigint
        =(p_result_versions->>v_id::text)::bigint
      and (v_actual-'version') is not distinct from (v_entity-'version');
  end if;
  return p_result_versions ? v_id::text
    and pg_catalog.jsonb_typeof(p_result_versions->v_id::text)='null'
    and v_actual is null;
exception when others then return false;
end;
$$;

create function private.lukas_drawing_dxf_history_result_targets_match(
  p_payload jsonb,p_result_versions jsonb
) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_action_count integer;
begin
  if pg_catalog.jsonb_typeof(p_payload->'actions')<>'array'
    or pg_catalog.jsonb_typeof(p_result_versions)<>'object' then return false;
  end if;
  v_action_count:=pg_catalog.jsonb_array_length(p_payload->'actions');
  return v_action_count>0
    and (
      select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(
        p_result_versions
      ) key
    )=v_action_count
    and not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_payload->'actions') action
      where private.lukas_drawing_p2_uuid(
          pg_catalog.to_jsonb(coalesce(
            action->'entity'->>'id',action->>'id'
          ))
        ) is not true
        or not (p_result_versions ? coalesce(
          action->'entity'->>'id',action->>'id'
        ))
    )
    and (
      select pg_catalog.count(distinct coalesce(
        action->'entity'->>'id',action->>'id'
      )) from pg_catalog.jsonb_array_elements(p_payload->'actions') action
    )=v_action_count;
exception when others then return false;
end;
$$;

create function private.lukas_drawing_dxf_history_payload_state_matches(
  p_revision_id uuid,p_project_id uuid,p_payload jsonb,p_result_versions jsonb
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_action jsonb;
begin
  if private.lukas_drawing_dxf_history_result_targets_match(
      p_payload,p_result_versions
    ) is not true then return false; end if;
  for v_action in
    select value from pg_catalog.jsonb_array_elements(p_payload->'actions')
  loop
    if private.lukas_drawing_dxf_history_action_state_matches(
        p_revision_id,p_project_id,v_action,p_result_versions
      ) is not true then return false;
    end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function private.lukas_drawing_dxf_history_state_matches(
  p_revision_id uuid
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select r.project_id into v_project_id from public.lukas_drawing_revisions r
  where r.id=p_revision_id;
  if not found then return false; end if;
  return (
    with authorized_operations as (
      select o.* from public.lukas_drawing_operations o
      where o.revision_id=p_revision_id
        and private.lukas_drawing_operation_authority_proof_valid(o)
    ), grouped_operations as (
      select o.forward,o.result_versions from authorized_operations o
      where o.revision_id=p_revision_id and o.forward ? 'historyGroup'
    ), grouped_actions as (
      select a.value action
      from grouped_operations o
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(o.forward->'actions')='array'
          then o.forward->'actions' else '[]'::jsonb end
      ) a(value)
    ), grouped_targets as (
      select distinct
        case
          when a.action->>'kind' in('put_layer','delete_layer') then 'layer'
          when a.action->>'kind' in('put_object','delete_object') then 'object'
          when a.action->>'kind' in('put_source','delete_source') then 'source'
        end entity_kind,
        coalesce(a.action->'entity'->>'id',a.action->>'id') target_id
      from grouped_actions a
    ), raw_effective_actions as (
      select o.sequence,o.result_versions,a.value action,a.ordinality
      from authorized_operations o
      cross join lateral pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(o.forward->'actions')='array'
          then o.forward->'actions' else '[]'::jsonb end
      ) with ordinality a(value,ordinality)
      where o.revision_id=p_revision_id
        and a.value->>'kind' in(
          'put_layer','delete_layer','put_object','delete_object',
          'put_source','delete_source'
        )
        and private.lukas_drawing_structure_action_valid(
          a.value,p_revision_id
        ) is true
      union all
      select o.sequence,o.result_versions,pg_catalog.jsonb_build_object(
          'kind','put_object','entity',object.value,'baseVersion',null
        ),object.ordinality
      from authorized_operations o
      cross join lateral pg_catalog.jsonb_array_elements(
        case when o.operation_type='add_objects'
          and o.forward->>'type'='add_objects'
          and pg_catalog.jsonb_typeof(o.forward->'objects')='array'
          then o.forward->'objects' else '[]'::jsonb end
      ) with ordinality object(value,ordinality)
      where o.revision_id=p_revision_id
        and o.forward ?& array['type','objects']
        and o.forward-array['type','objects']='{}'::jsonb
        and pg_catalog.jsonb_typeof(object.value)='object'
        and private.lukas_drawing_p2_uuid(object.value->'id') is true
        and private.lukas_drawing_p2_positive_integer(
          object.value->'version'
        ) is true
      union all
      select o.sequence,o.result_versions,pg_catalog.jsonb_build_object(
          'kind','delete_object','id',object.value,
          'baseVersion',o.base_versions->(object.value#>>'{}')
        ),object.ordinality
      from authorized_operations o
      cross join lateral pg_catalog.jsonb_array_elements(
        case when o.operation_type='delete_objects'
          and o.forward->>'type'='delete_objects'
          and pg_catalog.jsonb_typeof(o.forward->'objectIds')='array'
          then o.forward->'objectIds' else '[]'::jsonb end
      ) with ordinality object(value,ordinality)
      where o.revision_id=p_revision_id
        and o.forward ?& array['type','objectIds']
        and o.forward-array['type','objectIds']='{}'::jsonb
        and private.lukas_drawing_p2_uuid(object.value) is true
      union all
      select o.sequence,o.result_versions,pg_catalog.jsonb_build_object(
          'kind','put_layer','entity',
          o.forward->'layer'||pg_catalog.jsonb_build_object(
            'systemKind','custom'
          ),'baseVersion',null
        ),1
      from authorized_operations o
      where o.revision_id=p_revision_id and o.operation_type='add_layer'
        and o.forward->>'type'='add_layer'
        and o.forward ?& array['type','layer']
        and o.forward-array['type','layer']='{}'::jsonb
        and pg_catalog.jsonb_typeof(o.forward->'layer')='object'
        and private.lukas_drawing_p2_uuid(o.forward->'layer'->'id') is true
        and private.lukas_drawing_p2_positive_integer(
          o.forward->'layer'->'version'
        ) is true
      union all
      select o.sequence,o.result_versions,pg_catalog.jsonb_build_object(
          'kind','patch_object','id',update.value->'objectId',
          'patch',update.value->'patch',
          'baseVersion',o.base_versions->(update.value->>'objectId')
        ),update.ordinality
      from authorized_operations o
      cross join lateral pg_catalog.jsonb_array_elements(
        case when o.operation_type='update_objects'
          and o.forward->>'type'='update_objects'
          and pg_catalog.jsonb_typeof(o.forward->'updates')='array'
          then o.forward->'updates' else '[]'::jsonb end
      ) with ordinality update(value,ordinality)
      where o.revision_id=p_revision_id
        and o.forward-array['type','updates']='{}'::jsonb
        and pg_catalog.jsonb_typeof(update.value)='object'
        and update.value ?& array['objectId','patch']
        and update.value-array['objectId','patch']='{}'::jsonb
        and private.lukas_drawing_p2_uuid(update.value->'objectId') is true
      union all
      select o.sequence,o.result_versions,pg_catalog.jsonb_build_object(
          'kind','patch_layer','id',o.forward->'layerId',
          'patch',o.forward->'patch',
          'baseVersion',o.base_versions->(o.forward->>'layerId')
        ),1
      from authorized_operations o
      where o.revision_id=p_revision_id and o.operation_type='update_layer'
        and o.forward->>'type'='update_layer'
        and o.forward ?& array['type','layerId','patch']
        and o.forward-array['type','layerId','patch']='{}'::jsonb
        and private.lukas_drawing_p2_uuid(o.forward->'layerId') is true
      union all
      select o.sequence,o.result_versions,
        case o.forward->>'objectAction'
          when 'delete' then pg_catalog.jsonb_build_object(
            'kind','delete_object','id',object.value->'id',
            'baseVersion',o.base_versions->(object.value->>'id')
          )
          when 'restore' then pg_catalog.jsonb_build_object(
            'kind','put_object','entity',object.value,'baseVersion',null
          )
        end,
        case o.forward->>'objectAction'
          when 'restore' then -object.ordinality
          else pg_catalog.jsonb_array_length(o.forward->'actions')
            +object.ordinality
        end
      from authorized_operations o
      cross join lateral pg_catalog.jsonb_array_elements(
        case when o.operation_type='mutate_objects_with_references'
          and o.forward->>'type'='mutate_objects_with_references'
          and o.forward->>'objectAction' in('delete','restore')
          and pg_catalog.jsonb_typeof(o.forward->'objects')='array'
          and pg_catalog.jsonb_typeof(o.forward->'actions')='array'
          then o.forward->'objects' else '[]'::jsonb end
      ) with ordinality object(value,ordinality)
      where o.revision_id=p_revision_id
        and o.forward ?& array['type','objectAction','objects','actions']
        and o.forward-array['type','objectAction','objects','actions']='{}'::jsonb
        and pg_catalog.jsonb_typeof(object.value)='object'
        and private.lukas_drawing_p2_uuid(object.value->'id') is true
    ), effective_actions as (
      select raw.sequence,raw.result_versions,raw.action,raw.ordinality,
        case
          when raw.action->>'kind' in(
            'put_layer','delete_layer','patch_layer'
          ) then 'layer'
          when raw.action->>'kind' in(
            'put_object','delete_object','patch_object'
          ) then 'object'
          when raw.action->>'kind' in('put_source','delete_source') then 'source'
        end entity_kind,
        coalesce(raw.action->'entity'->>'id',raw.action->>'id') target_id
      from raw_effective_actions raw
      join grouped_targets target on target.entity_kind=case
          when raw.action->>'kind' in(
            'put_layer','delete_layer','patch_layer'
          ) then 'layer'
          when raw.action->>'kind' in(
            'put_object','delete_object','patch_object'
          ) then 'object'
          when raw.action->>'kind' in('put_source','delete_source') then 'source'
        end
        and target.target_id=coalesce(
          raw.action->'entity'->>'id',raw.action->>'id'
        )
    ), ordered_actions as (
      select action.*,lag(action.action->>'kind') over entity_history previous_kind,
        lag(action.action->'baseVersion') over entity_history previous_base,
        lag(action.result_versions->action.target_id)
          over entity_history previous_result
      from effective_actions action
      window entity_history as (
        partition by action.entity_kind,action.target_id
        order by action.sequence,action.ordinality
      )
    ), latest_actions as (
      select distinct on(action.entity_kind,action.target_id)
        action.entity_kind,action.target_id,action.action,action.result_versions
      from effective_actions action
      order by action.entity_kind,action.target_id,
        action.sequence desc,action.ordinality desc
    )
    select not exists(
      select 1 from public.lukas_drawing_operations operation
      where operation.revision_id=p_revision_id
        and operation.forward ? 'historyGroup'
        and private.lukas_drawing_operation_authority_proof_valid(
          operation
        ) is not true
    ) and not exists(
      select 1 from grouped_operations operation
      where pg_catalog.jsonb_typeof(operation.forward->'actions')<>'array'
        or pg_catalog.jsonb_array_length(operation.forward->'actions')=0
        or private.lukas_drawing_dxf_history_result_targets_match(
          operation.forward,operation.result_versions
        ) is not true
    ) and not exists(
      select 1 from grouped_actions action
      where action.action->>'kind' not in(
          'put_layer','delete_layer','put_object','delete_object',
          'put_source','delete_source'
        )
        or private.lukas_drawing_structure_action_valid(
          action.action,p_revision_id
        ) is not true
    ) and not exists(
      select 1 from ordered_actions action
      where not (action.result_versions ? action.target_id)
        or action.action->>'kind' like 'put\_%' and (
          private.lukas_drawing_p2_positive_integer(
            action.result_versions->action.target_id
          ) is not true
          or private.lukas_drawing_p2_positive_integer(
            action.action->'entity'->'version'
          ) is not true
          or pg_catalog.jsonb_typeof(action.action->'baseVersion')='number'
            and (
              private.lukas_drawing_p2_positive_integer(
                action.action->'baseVersion'
              ) is not true
              or (action.result_versions->>action.target_id)::bigint
                <>(action.action->>'baseVersion')::bigint+1
              or action.previous_kind is null
              or action.previous_kind like 'delete\_%'
              or (action.previous_result #>> '{}')::bigint
                is distinct from (action.action->>'baseVersion')::bigint
            )
          or pg_catalog.jsonb_typeof(action.action->'baseVersion')='null'
            and (
              action.previous_kind is not null
                and action.previous_kind not like 'delete\_%'
              or action.previous_kind is null and
                (action.result_versions->>action.target_id)::bigint
                  <>(action.action->'entity'->>'version')::bigint
              or action.previous_kind like 'delete\_%' and
                (action.result_versions->>action.target_id)::bigint
                  <>(action.previous_base #>> '{}')::bigint+2
            )
          or pg_catalog.jsonb_typeof(action.action->'baseVersion')
            not in('number','null')
        )
        or action.action->>'kind' like 'patch\_%' and (
          private.lukas_drawing_p2_positive_integer(
            action.result_versions->action.target_id
          ) is not true
          or private.lukas_drawing_p2_positive_integer(
            action.action->'baseVersion'
          ) is not true
          or (action.result_versions->>action.target_id)::bigint
            <>(action.action->>'baseVersion')::bigint+1
          or action.previous_kind is null
          or action.previous_kind like 'delete\_%'
          or (action.previous_result #>> '{}')::bigint
            is distinct from (action.action->>'baseVersion')::bigint
        )
        or action.action->>'kind' like 'delete\_%' and (
          pg_catalog.jsonb_typeof(
            action.result_versions->action.target_id
          )<>'null'
          or private.lukas_drawing_p2_positive_integer(
            action.action->'baseVersion'
          ) is not true
          or action.previous_kind is null
          or action.previous_kind like 'delete\_%'
          or (action.previous_result #>> '{}')::bigint
            is distinct from (action.action->>'baseVersion')::bigint
        )
    ) and not exists(
      select 1 from latest_actions action
      where private.lukas_drawing_dxf_history_action_state_matches(
        p_revision_id,v_project_id,action.action,action.result_versions
      ) is not true
    )
  );
exception when others then return false;
end;
$$;

create function private.lukas_drawing_dxf_history_group_status(
  p_revision_id uuid,p_group_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_actor uuid; v_count integer; v_original_count integer;
  v_actor_count integer; v_count_count integer; v_index_count integer;
  v_min_index integer; v_max_index integer; v_original_states integer;
  v_undo_states integer; v_redo_states integer;
  v_min_undo integer; v_max_undo integer; v_min_redo integer; v_max_redo integer;
  v_last_action text; v_next_action text; v_next_index integer;
  v_original_operation_id uuid;
begin
  if p_revision_id is null or p_group_id is null then
    return pg_catalog.jsonb_build_object('valid',false,'complete',false);
  end if;
  if exists(
    select 1 from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id
      and (
        o.forward->'historyGroup'->>'id'=p_group_id::text
        or o.inverse->'historyGroup'->>'id'=p_group_id::text
      ) and (
        o.operation_type<>'mutate_structure'
        or private.lukas_drawing_dxf_history_group_valid(
          o.forward->'historyGroup'
        ) is not true
        or o.forward->'historyGroup' is distinct from o.inverse->'historyGroup'
      )
  ) then return pg_catalog.jsonb_build_object('valid',false,'complete',false); end if;

  select pg_catalog.count(*)::integer,
    pg_catalog.count(distinct o.actor_id)::integer,
    pg_catalog.count(distinct (o.forward->'historyGroup'->>'count'))::integer,
    pg_catalog.count(distinct (o.forward->'historyGroup'->>'index'))::integer,
    pg_catalog.min((o.forward->'historyGroup'->>'index')::integer),
    pg_catalog.max((o.forward->'historyGroup'->>'index')::integer),
    (pg_catalog.array_agg(o.actor_id order by o.sequence))[1],
    pg_catalog.min((o.forward->'historyGroup'->>'count')::integer)
  into v_original_count,v_actor_count,v_count_count,v_index_count,
    v_min_index,v_max_index,v_actor,v_count
  from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id and o.history_action is null
    and o.forward->'historyGroup'->>'id'=p_group_id::text;
  if v_original_count=0 then return null; end if;
  if v_actor_count<>1 or v_count_count<>1 or v_original_count>v_count
    or v_index_count<>v_original_count or v_min_index<>0
    or v_max_index<>v_original_count-1 then
    return pg_catalog.jsonb_build_object('valid',false,'complete',false);
  end if;

  if exists(
    select 1 from public.lukas_drawing_operations history
    left join public.lukas_drawing_operations original
      on original.revision_id=history.revision_id
      and original.client_operation_id=history.original_operation_id
      and original.history_action is null
    where history.revision_id=p_revision_id and history.history_action is not null
      and (
        history.forward->'historyGroup'->>'id'=p_group_id::text
        or original.forward->'historyGroup'->>'id'=p_group_id::text
      ) and (
        original.id is null
        or history.actor_id is distinct from original.actor_id
        or history.forward->'historyGroup'
          is distinct from original.forward->'historyGroup'
        or history.inverse->'historyGroup'
          is distinct from original.inverse->'historyGroup'
        or private.lukas_drawing_dxf_history_payload_identity(history.forward)
          is distinct from private.lukas_drawing_dxf_history_payload_identity(
            case history.history_action when 'undo' then original.inverse
              when 'redo' then original.forward else null end
          )
      )
  ) then return pg_catalog.jsonb_build_object('valid',false,'complete',false); end if;

  if v_original_count<v_count then
    select o.client_operation_id into v_original_operation_id
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.history_action is null
      and o.forward->'historyGroup'->>'id'=p_group_id::text
      and (o.forward->'historyGroup'->>'index')::integer=v_original_count;
    return pg_catalog.jsonb_build_object(
      'valid',true,'complete',false,'id',p_group_id,'count',v_count,
      'actorId',v_actor,'nextHistoryAction',null,
      'nextIndex',v_original_count,'originalOperationId',null
    );
  end if;

  with originals as (
    select o.client_operation_id,
      (o.forward->'historyGroup'->>'index')::integer member_index
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.history_action is null
      and o.forward->'historyGroup'->>'id'=p_group_id::text
  ), states as (
    select original.member_index,coalesce((
      select history.history_action
      from public.lukas_drawing_operations history
      where history.revision_id=p_revision_id
        and history.original_operation_id=original.client_operation_id
      order by history.sequence desc limit 1
    ),'original') state
    from originals original
  ) select
    pg_catalog.count(*) filter(where state='original')::integer,
    pg_catalog.count(*) filter(where state='undo')::integer,
    pg_catalog.count(*) filter(where state='redo')::integer,
    pg_catalog.min(member_index) filter(where state='undo'),
    pg_catalog.max(member_index) filter(where state='undo'),
    pg_catalog.min(member_index) filter(where state='redo'),
    pg_catalog.max(member_index) filter(where state='redo')
  into v_original_states,v_undo_states,v_redo_states,
    v_min_undo,v_max_undo,v_min_redo,v_max_redo
  from states;
  select h.history_action into v_last_action
  from public.lukas_drawing_operations h
  join public.lukas_drawing_operations o
    on o.revision_id=h.revision_id
    and o.client_operation_id=h.original_operation_id
  where h.revision_id=p_revision_id and h.history_action is not null
    and o.forward->'historyGroup'->>'id'=p_group_id::text
  order by h.sequence desc limit 1;

  if v_original_states=v_count then
    v_next_action:='undo'; v_next_index:=v_count-1;
  elsif v_undo_states=v_count then
    v_next_action:='redo'; v_next_index:=0;
  elsif v_redo_states=v_count then
    v_next_action:='undo'; v_next_index:=v_count-1;
  elsif v_last_action='undo' and v_undo_states between 1 and v_count-1
    and (v_original_states=0 or v_redo_states=0)
    and v_original_states+v_redo_states=v_count-v_undo_states
    and v_min_undo=v_count-v_undo_states and v_max_undo=v_count-1 then
    v_next_action:='undo'; v_next_index:=v_count-v_undo_states-1;
  elsif v_last_action='redo' and v_original_states=0
    and v_redo_states between 1 and v_count-1
    and v_undo_states=v_count-v_redo_states
    and v_min_redo=0 and v_max_redo=v_redo_states-1
    and v_min_undo=v_redo_states and v_max_undo=v_count-1 then
    v_next_action:='redo'; v_next_index:=v_redo_states;
  else
    return pg_catalog.jsonb_build_object('valid',false,'complete',false);
  end if;
  select o.client_operation_id into v_original_operation_id
  from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id and o.history_action is null
    and o.forward->'historyGroup'->>'id'=p_group_id::text
    and (o.forward->'historyGroup'->>'index')::integer=v_next_index;
  return pg_catalog.jsonb_build_object(
    'valid',true,
    'complete',v_original_states=v_count or v_undo_states=v_count
      or v_redo_states=v_count,
    'id',p_group_id,'count',v_count,'actorId',v_actor,
    'nextHistoryAction',v_next_action,'nextIndex',v_next_index,
    'originalOperationId',v_original_operation_id
  );
exception when others then
  return pg_catalog.jsonb_build_object('valid',false,'complete',false);
end;
$$;

create function private.lukas_drawing_dxf_history_groups_complete(
  p_revision_id uuid
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_group_id uuid; v_status jsonb;
begin
  if p_revision_id is null then return false; end if;
  if exists(
    select 1 from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id
      and (o.forward ? 'historyGroup' or o.inverse ? 'historyGroup')
      and (
        o.operation_type<>'mutate_structure'
        or private.lukas_drawing_dxf_history_group_valid(
          o.forward->'historyGroup'
        ) is not true
        or o.forward->'historyGroup' is distinct from o.inverse->'historyGroup'
      )
  ) or exists(
    select 1 from public.lukas_drawing_operations history
    join public.lukas_drawing_operations original
      on original.revision_id=history.revision_id
      and original.client_operation_id=history.original_operation_id
    where history.revision_id=p_revision_id and history.history_action is not null
      and (history.forward ? 'historyGroup' or original.forward ? 'historyGroup')
      and (
        history.actor_id is distinct from original.actor_id
        or history.forward->'historyGroup'
          is distinct from original.forward->'historyGroup'
        or history.inverse->'historyGroup'
          is distinct from original.inverse->'historyGroup'
        or private.lukas_drawing_dxf_history_payload_identity(history.forward)
          is distinct from private.lukas_drawing_dxf_history_payload_identity(
            case history.history_action when 'undo' then original.inverse
              when 'redo' then original.forward else null end
          )
      )
  ) then return false; end if;
  if private.lukas_drawing_dxf_history_state_matches(p_revision_id) is not true
  then return false; end if;
  for v_group_id in
    select distinct (o.forward->'historyGroup'->>'id')::uuid
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.history_action is null
      and o.forward ? 'historyGroup'
  loop
    v_status:=private.lukas_drawing_dxf_history_group_status(
      p_revision_id,v_group_id
    );
    if (v_status->>'valid')::boolean is not true
      or (v_status->>'complete')::boolean is not true then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create function private.lukas_drawing_dxf_history_group_lease_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if private.lukas_drawing_dxf_history_groups_complete(
      new.revision_id
    ) is not true then
    raise exception using errcode='P3F01',
      message='Drawing freeze requires complete DXF history groups';
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_dxf_history_group_lease_guard
before insert or update on private.lukas_drawing_collaboration_freeze_leases
for each row execute function private.lukas_drawing_dxf_history_group_lease_guard();

create function private.lukas_drawing_dxf_history_group_append_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_group jsonb:=new.forward->'historyGroup';
  v_original_group jsonb; v_original_forward jsonb; v_original_inverse jsonb;
  v_group_id uuid; v_existing_group_id uuid; v_status jsonb;
  v_incomplete jsonb; v_incomplete_count integer:=0;
  v_freeze_state text;
  v_lease_expires_at timestamptz;
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=new.revision_id and r.project_id=new.project_id
  for update;
  select lease.lease_expires_at into v_lease_expires_at
  from private.lukas_drawing_collaboration_freeze_leases lease
  where lease.revision_id=new.revision_id and lease.project_id=new.project_id
  for share;
  if found and v_lease_expires_at>pg_catalog.clock_timestamp() then
    raise exception using errcode='P3F03',
      message='Drawing collaboration freeze lease is busy';
  end if;
  select s.freeze_state into v_freeze_state
  from private.lukas_drawing_collaboration_states s
  where s.revision_id=new.revision_id and s.project_id=new.project_id
  for share;
  if found and v_freeze_state in('freezing','frozen') then
    raise exception using errcode='P3F02',
      message='Drawing collaboration freeze is immutable';
  end if;
  if new.forward ? 'historyGroup' or new.inverse ? 'historyGroup' then
    if new.operation_type<>'mutate_structure'
      or private.lukas_drawing_dxf_history_group_valid(v_group) is not true
      or v_group is distinct from new.inverse->'historyGroup' then
      raise exception using errcode='P1C01',
        message='DXF history group metadata is invalid';
    end if;
    v_group_id:=(v_group->>'id')::uuid;
  end if;
  if new.original_operation_id is not null then
    select original.forward->'historyGroup',original.forward,original.inverse
    into v_original_group,v_original_forward,v_original_inverse
    from public.lukas_drawing_operations original
    where original.revision_id=new.revision_id
      and original.client_operation_id=new.original_operation_id
      and original.history_action is null;
    if not found or (v_group is not null or v_original_group is not null)
      and (
        private.lukas_drawing_dxf_history_group_valid(v_group) is not true
        or v_group is distinct from v_original_group
        or new.inverse->'historyGroup' is distinct from v_original_group
        or private.lukas_drawing_dxf_history_payload_identity(new.forward)
          is distinct from private.lukas_drawing_dxf_history_payload_identity(
            case new.history_action when 'undo' then v_original_inverse
              when 'redo' then v_original_forward else null end
          )
      ) then
      raise exception using errcode='P1C01',
        message='DXF history continuation must retain its original payload';
    end if;
  end if;
  for v_existing_group_id in
    select distinct (o.forward->'historyGroup'->>'id')::uuid
    from public.lukas_drawing_operations o
    where o.revision_id=new.revision_id and o.history_action is null
      and o.forward ? 'historyGroup'
  loop
    v_status:=private.lukas_drawing_dxf_history_group_status(
      new.revision_id,v_existing_group_id
    );
    if (v_status->>'valid')::boolean is not true then
      raise exception using errcode='P1C01',
        message='DXF history group ledger is invalid';
    end if;
    if (v_status->>'complete')::boolean is not true then
      v_incomplete:=v_status; v_incomplete_count:=v_incomplete_count+1;
    end if;
  end loop;
  if v_incomplete_count>1 then
    raise exception using errcode='P1C01',
      message='DXF history group ledger has multiple incomplete groups';
  end if;
  if v_incomplete is not null then v_status:=v_incomplete;
  elsif v_group_id is not null then
    v_status:=private.lukas_drawing_dxf_history_group_status(
      new.revision_id,v_group_id
    );
  else return new; end if;

  if v_group_id is null
    or v_incomplete is not null
      and v_group_id::text is distinct from v_status->>'id'
    or v_status is null and (
      new.history_action is not null
      or new.original_operation_id is not null
      or (v_group->>'index')::integer<>0
    )
    or v_status is not null and (
      new.actor_id::text is distinct from v_status->>'actorId'
      or (v_group->>'count')::integer<>(v_status->>'count')::integer
      or (v_group->>'index')::integer<>(v_status->>'nextIndex')::integer
      or new.history_action is distinct from v_status->>'nextHistoryAction'
      or new.original_operation_id::text
        is distinct from v_status->>'originalOperationId'
    ) then
    raise exception using errcode='P1C01',
      message='DXF history group must append its exact next member';
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_dxf_history_group_append_guard
before insert on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_dxf_history_group_append_guard();
create trigger lukas_drawing_dxf_history_group_lineage_update_guard
before update of history_action,original_operation_id
on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_dxf_history_group_append_guard();

create function private.lukas_drawing_dxf_history_state_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and exists(
    select 1 from private.lukas_drawing_collaboration_freeze_leases lease
    where lease.revision_id=new.revision_id
      and lease.project_id=new.project_id
      and lease.lease_expires_at>pg_catalog.clock_timestamp()
  ) then
    raise exception using errcode='P3F03',
      message='Drawing collaboration freeze lease is busy';
  end if;
  if tg_op='UPDATE' and exists(
    select 1 from private.lukas_drawing_collaboration_states state
    where state.revision_id=new.revision_id
      and state.project_id=new.project_id
      and state.freeze_state in('freezing','frozen')
  ) then
    raise exception using errcode='P3F02',
      message='Drawing collaboration freeze is immutable';
  end if;
  if new.forward ? 'historyGroup'
    and (
      private.lukas_drawing_dxf_history_payload_state_matches(
        new.revision_id,new.project_id,new.forward,new.result_versions
      ) is not true
      or private.lukas_drawing_dxf_history_state_matches(
        new.revision_id
      ) is not true
    ) then
    raise exception using errcode='P1C01',
      message='DXF history operation does not match canonical drawing state';
  end if;
  if tg_op='UPDATE' and old.forward ? 'historyGroup'
    and not (new.forward ? 'historyGroup') then
    raise exception using errcode='P1C01',
      message='DXF history operation cannot remove its group';
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_operations_dxf_history_state_guard
after insert or update on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_dxf_history_state_guard();

create function private.lukas_drawing_dxf_history_group_review_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.status='draft' and new.status='review_requested'
    and private.lukas_drawing_dxf_history_groups_complete(old.id) is not true then
    raise exception using errcode='P1C01',
      message='Drawing review requires complete DXF history groups';
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_dxf_history_group_review_guard
before update on public.lukas_drawing_revisions
for each row execute function private.lukas_drawing_dxf_history_group_review_guard();

create function private.lukas_drawing_dxf_history_group_freeze_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (
      new.freeze_state='freezing'
        and (tg_op='INSERT' or old.freeze_state in('active','released'))
      or new.freeze_state='frozen'
        and (tg_op='INSERT' or old.freeze_state='freezing')
    )
    and private.lukas_drawing_dxf_history_groups_complete(
      new.revision_id
    ) is not true then
    raise exception using errcode='P3F01',
      message='Drawing freeze requires complete DXF history groups';
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_dxf_history_group_freeze_guard
before insert or update on private.lukas_drawing_collaboration_states
for each row execute function private.lukas_drawing_dxf_history_group_freeze_guard();

create function private.lukas_drawing_dxf_import_phase(
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns text language plpgsql immutable security invoker set search_path='' as $$
declare v_count integer;
begin
  if pg_catalog.jsonb_typeof(p_base_versions)<>'object'
    or pg_catalog.jsonb_typeof(p_forward)<>'object'
    or p_forward ?& array['type','actions'] is not true
    or p_forward-array['type','actions','historyGroup']<>'{}'::jsonb
    or p_forward->>'type'<>'mutate_structure'
    or pg_catalog.jsonb_typeof(p_forward->'actions')<>'array'
    or pg_catalog.jsonb_typeof(p_inverse)<>'object'
    or p_inverse ?& array['type','actions'] is not true
    or p_inverse-array['type','actions','historyGroup']<>'{}'::jsonb
    or p_inverse->>'type'<>'mutate_structure'
    or pg_catalog.jsonb_typeof(p_inverse->'actions')<>'array'
    or (
      p_forward ? 'historyGroup' or p_inverse ? 'historyGroup'
    ) and (
      private.lukas_drawing_dxf_history_group_valid(
        p_forward->'historyGroup'
      ) is not true
      or p_forward->'historyGroup' is distinct from p_inverse->'historyGroup'
    )
  then return null; end if;
  v_count:=pg_catalog.jsonb_array_length(p_forward->'actions');
  if v_count=0 or v_count<>pg_catalog.jsonb_array_length(p_inverse->'actions')
    or v_count>256 then return null; end if;

  if p_base_versions='{}'::jsonb
    and not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind'<>'put_layer'
        or pg_catalog.jsonb_typeof(a->'baseVersion')<>'null'
    )
    and not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_inverse->'actions') a
      where a->>'kind'<>'delete_layer'
        or private.lukas_drawing_p2_positive_integer(
          a->'baseVersion'
        ) is not true
        or not (p_forward ? 'historyGroup') and a->>'baseVersion'<>'1'
    )
  then return 'layer_create'; end if;

  if p_forward ? 'historyGroup' and v_count>0 and not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind'<>'delete_layer'
        or private.lukas_drawing_p2_positive_integer(
          a->'baseVersion'
        ) is not true
    ) and not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_inverse->'actions') a
      where a->>'kind'<>'put_layer'
        or pg_catalog.jsonb_typeof(a->'baseVersion')<>'null'
    )
  then return 'layer_delete'; end if;

  if p_base_versions='{}'::jsonb and v_count%2=0
    and not exists(
      select 1
      from pg_catalog.jsonb_array_elements(p_forward->'actions')
        with ordinality a(value,ordinality)
      where (
          a.ordinality%2=1 and a.value->>'kind'<>'put_object'
          or a.ordinality%2=0 and (
            a.value->>'kind'<>'put_source'
            or a.value->'entity'->>'sourceKind'<>'dxf_entity'
          )
        )
        or pg_catalog.jsonb_typeof(a.value->'baseVersion')<>'null'
    )
    and not exists(
      select 1
      from pg_catalog.jsonb_array_elements(p_inverse->'actions')
        with ordinality a(value,ordinality)
      where a.ordinality%2=1 and (
          a.value->>'kind'<>'delete_source'
          or private.lukas_drawing_p2_positive_integer(
            a.value->'baseVersion'
          ) is not true
        )
        or a.ordinality%2=0 and (
          a.value->>'kind'<>'delete_object'
          or private.lukas_drawing_p2_positive_integer(
            a.value->'baseVersion'
          ) is not true
        )
    )
  then return 'object_source_create'; end if;

  if v_count%2=0
    and not exists(
      select 1
      from pg_catalog.jsonb_array_elements(p_forward->'actions')
        with ordinality a(value,ordinality)
      where a.ordinality%2=1 and (
          a.value->>'kind'<>'delete_source'
          or private.lukas_drawing_p2_positive_integer(
            a.value->'baseVersion'
          ) is not true
        )
        or a.ordinality%2=0 and (
          a.value->>'kind'<>'delete_object'
          or private.lukas_drawing_p2_positive_integer(
            a.value->'baseVersion'
          ) is not true
        )
    )
    and not exists(
      select 1
      from pg_catalog.jsonb_array_elements(p_inverse->'actions')
        with ordinality a(value,ordinality)
      where a.ordinality%2=1 and (
          a.value->>'kind'<>'put_object'
          or pg_catalog.jsonb_typeof(a.value->'baseVersion')<>'null'
        )
        or a.ordinality%2=0 and (
          a.value->>'kind'<>'put_source'
          or a.value->'entity'->>'sourceKind'<>'dxf_entity'
          or pg_catalog.jsonb_typeof(a.value->'baseVersion')<>'null'
        )
    )
  then return 'object_source_delete'; end if;

  if p_forward ? 'historyGroup' and not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind'<>'put_layer'
        or private.lukas_drawing_p2_positive_integer(
          a->'baseVersion'
        ) is not true
        or private.lukas_drawing_p2_positive_integer(
          a->'entity'->'version'
        ) is not true
        or not (p_forward ? 'historyGroup') and (
          a->>'baseVersion'<>'1' or a->'entity'->>'version'<>'1'
        )
    )
    and not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_inverse->'actions') a
      where a->>'kind'<>'put_layer'
        or private.lukas_drawing_p2_positive_integer(
          a->'baseVersion'
        ) is not true
        or private.lukas_drawing_p2_positive_integer(
          a->'entity'->'version'
        ) is not true
        or not (p_forward ? 'historyGroup') and (
          a->>'baseVersion'<>'2' or a->'entity'->>'version'<>'1'
        )
    )
  then return 'layer_finalize'; end if;
  return null;
exception when others then return null;
end;
$$;

create function private.lukas_drawing_apply_dxf_import_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_canvas public.lukas_drawing_canvases%rowtype;
  v_layer public.lukas_drawing_layers%rowtype;
  v_parking_layer public.lukas_drawing_layers%rowtype;
  v_phase text; v_action jsonb; v_inverse_action jsonb;
  v_entity jsonb; v_object jsonb; v_source jsonb; v_previous jsonb;
  v_object_tombstone jsonb; v_layer_tombstone jsonb;
  v_history_group jsonb:=p_forward->'historyGroup';
  v_original_forward jsonb; v_original_inverse jsonb;
  v_original_actor uuid; v_new_object_version bigint; v_new_layer_version bigint;
  v_source_actions jsonb; v_inverse_source_actions jsonb; v_source_plan jsonb;
  v_expected_bases jsonb:='{}'::jsonb;
  v_result_versions jsonb:='{}'::jsonb;
  v_id uuid; v_count integer; v_index integer;
  v_operation_id uuid; v_sequence bigint; v_expected_object_type text;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in('admin','editor')
  for update;
  if not found then raise exception using errcode='P1R01',
    message='Drawing revision target is unavailable'; end if;

  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
      or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions
      or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse
      or v_existing.history_action is distinct from p_history_action
      or v_existing.original_operation_id is distinct from p_original_operation_id
    then raise exception using errcode='P1C01',
      message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions
    );
  end if;

  v_phase:=private.lukas_drawing_dxf_import_phase(
    p_base_versions,p_forward,p_inverse
  );
  if p_operation_type<>'mutate_structure' or v_phase is null
    or p_client_operation_id is null
    or not (
      p_history_action is null and p_original_operation_id is null
      or p_history_action in('undo','redo')
        and p_original_operation_id is not null
    )
    or v_revision.status<>'draft'
    or private.lukas_drawing_p2_json_numbers_valid(p_base_versions) is not true
    or private.lukas_drawing_p2_json_numbers_valid(p_forward) is not true
    or private.lukas_drawing_p2_json_numbers_valid(p_inverse) is not true
  then raise exception using errcode='P1C01',
    message='DXF import operation is invalid'; end if;

  if p_original_operation_id is not null then
    select o.actor_id,o.forward,o.inverse
    into v_original_actor,v_original_forward,v_original_inverse
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id
      and o.client_operation_id=p_original_operation_id
      and o.history_action is null;
    if not found or v_original_actor is distinct from v_actor
      or v_history_group is distinct from v_original_forward->'historyGroup'
      or private.lukas_drawing_dxf_history_payload_identity(p_forward)
        is distinct from private.lukas_drawing_dxf_history_payload_identity(
          case p_history_action when 'undo' then v_original_inverse
            else v_original_forward end
        ) then
      raise exception using errcode='P1C01',
        message='DXF history continuation must match its original payload';
    end if;
  end if;

  v_count:=pg_catalog.jsonb_array_length(p_forward->'actions');
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
    where private.lukas_drawing_structure_action_valid(a,p_revision_id) is not true
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(p_inverse->'actions') a
    where private.lukas_drawing_structure_action_valid(a,p_revision_id) is not true
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
    group by coalesce(a->'entity'->>'id',a->>'id')
    having pg_catalog.count(*)>1
  ) then raise exception using errcode='P1C01',
    message='DXF import action graph is invalid'; end if;

  if v_phase='layer_create' then
    for v_index in 0..v_count-1 loop
      v_action:=p_forward->'actions'->v_index;
      v_inverse_action:=p_inverse->'actions'->(v_count-v_index-1);
      v_entity:=v_action->'entity'; v_id:=(v_entity->>'id')::uuid;
      v_layer_tombstone:=private.lukas_drawing_structure_tombstone(
        p_revision_id,v_id,'put_layer'
      );
      if v_layer_tombstone is null then v_new_layer_version:=1;
      else
        v_new_layer_version:=(v_layer_tombstone->>'version')::bigint+2;
      end if;
      if v_entity->>'systemKind'<>'custom'
        or (v_entity->>'visible')::boolean is not true
        or (v_entity->>'locked')::boolean is not false
        or v_inverse_action is distinct from pg_catalog.jsonb_build_object(
          'kind','delete_layer','id',v_id,
          'baseVersion',v_new_layer_version
        )
        or v_layer_tombstone is null and (
          (v_entity->>'version')::bigint<>1
          or private.lukas_drawing_structure_raw_id_exists(v_id)
          or private.lukas_drawing_structure_raw_id_recorded(p_revision_id,v_id)
          or p_history_action is not null
        )
        or v_layer_tombstone is not null and (
          p_history_action is distinct from 'redo'
          or (v_entity-'version')
            is distinct from (v_layer_tombstone-'version')
        )
      then raise exception using errcode='P1C01',
        message='DXF import layer creation is not exact'; end if;
      select c.* into v_canvas from public.lukas_drawing_canvases c
      where c.id=(v_entity->>'canvasId')::uuid
        and c.revision_id=p_revision_id and c.project_id=v_revision.project_id
      for key share;
      if not found then raise exception using errcode='P1R01',
        message='DXF import layer canvas is unavailable'; end if;
      insert into public.lukas_drawing_layers(
        id,page_id,canvas_id,revision_id,project_id,name,sort_order,
        visible,locked,system_kind,version,created_by
      ) values(
        v_id,v_canvas.page_id,v_canvas.id,p_revision_id,v_revision.project_id,
        v_entity->>'name',(v_entity->>'sortOrder')::integer,true,false,
        'custom',v_new_layer_version,v_actor
      );
      v_result_versions:=v_result_versions||
        pg_catalog.jsonb_build_object(v_id::text,v_new_layer_version);
    end loop;
  elsif v_phase='layer_delete' then
    if p_history_action is distinct from 'undo' then
      raise exception using errcode='P1C01',
        message='DXF layer delete history lineage is invalid';
    end if;
    for v_index in 0..v_count-1 loop
      v_action:=p_forward->'actions'->v_index;
      v_inverse_action:=p_inverse->'actions'->(v_count-v_index-1);
      v_id:=(v_action->>'id')::uuid;
      select l.* into v_layer from public.lukas_drawing_layers l
      where l.id=v_id and l.revision_id=p_revision_id
        and l.project_id=v_revision.project_id for update;
      v_previous:=private.lukas_drawing_structure_entity_json(
        'layer',v_id,p_revision_id,v_revision.project_id
      );
      if not found or v_previous is null or v_layer.system_kind<>'custom'
        or (v_action->>'baseVersion')::bigint<>v_layer.version
        or v_inverse_action is distinct from pg_catalog.jsonb_build_object(
          'kind','put_layer','entity',v_previous,'baseVersion',null
        ) then raise exception using errcode='P1C01',
          message='DXF layer delete is not exact'; end if;
      v_expected_bases:=v_expected_bases||
        pg_catalog.jsonb_build_object(v_id::text,v_layer.version);
      select parking.* into v_parking_layer
      from public.lukas_drawing_layers parking
      where parking.canvas_id=v_layer.canvas_id and parking.id<>v_layer.id
        and parking.revision_id=p_revision_id
        and parking.project_id=v_revision.project_id
        and parking.visible and not parking.locked
        and parking.system_kind<>'source'
      order by parking.sort_order,parking.id limit 1 for update;
      if not found or exists(
        select 1 from public.lukas_drawing_objects o
        where o.layer_id=v_layer.id and o.status='active'
      ) then raise exception using errcode='P1C01',
        message='DXF layer delete requires an editable parking layer'; end if;
      perform pg_catalog.set_config(
        'private.lukas_drawing_dxf_layer_rehome',p_revision_id::text,true
      );
      update public.lukas_drawing_objects set
        layer_id=v_parking_layer.id,page_id=v_parking_layer.page_id
      where layer_id=v_layer.id and revision_id=p_revision_id
        and project_id=v_revision.project_id and status='deleted';
      perform pg_catalog.set_config(
        'private.lukas_drawing_dxf_layer_rehome','',true
      );
      delete from public.lukas_drawing_layers
      where id=v_id and revision_id=p_revision_id and version=v_layer.version;
      if not found then raise exception using errcode='P1C01',
        message='DXF layer delete changed concurrently'; end if;
      v_result_versions:=v_result_versions||
        pg_catalog.jsonb_build_object(v_id::text,null);
    end loop;
    if p_base_versions is distinct from v_expected_bases then
      raise exception using errcode='P1C01',
        message='DXF layer delete bases are incomplete';
    end if;
  elsif v_phase='object_source_create' then
    if p_history_action='undo'
      or (p_history_action is null) is distinct from
        (p_original_operation_id is null) then
      raise exception using errcode='P1C01',
        message='DXF create history lineage is invalid';
    end if;
    select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
      into v_source_actions
    from pg_catalog.jsonb_array_elements(p_forward->'actions')
      with ordinality a(value,ordinality)
    where a.ordinality%2=0;
    select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
      into v_inverse_source_actions
    from pg_catalog.jsonb_array_elements(p_inverse->'actions')
      with ordinality a(value,ordinality)
    where a.ordinality%2=1;
    v_source_plan:=private.lukas_drawing_validate_source_actions(
      p_revision_id,v_revision.project_id,
      v_source_actions,v_inverse_source_actions
    );
    if v_source_plan->'bases'<>'{}'::jsonb then
      raise exception using errcode='P1C01',
        message='DXF import source bases are invalid';
    end if;
    v_result_versions:=v_source_plan->'results';
    for v_index in 0..v_count-1 by 2 loop
      v_object:=p_forward->'actions'->v_index->'entity';
      v_source:=p_forward->'actions'->(v_index+1)->'entity';
      v_inverse_action:=p_inverse->'actions'->(v_count-v_index-2);
      v_object_tombstone:=private.lukas_drawing_structure_tombstone(
        p_revision_id,(v_object->>'id')::uuid,'put_object'
      );
      if v_object_tombstone is null then
        v_new_object_version:=1;
      else
        v_new_object_version:=(v_object_tombstone->>'version')::bigint+2;
      end if;
      if v_source->>'objectId'<>v_object->>'id'
        or v_source->>'revisionId'<>p_revision_id::text
        or v_source->>'sourceKind'<>'dxf_entity'
        or (v_object->>'version')::bigint<>1
        or (v_source->>'version')::bigint<>1
        or v_inverse_action is distinct from pg_catalog.jsonb_build_object(
          'kind','delete_source','id',(v_source->>'id')::uuid,
          'baseVersion',(
            v_source_plan->'results'->>(v_source->>'id')
          )::bigint
        )
        or p_inverse->'actions'->(v_count-v_index-1)
          is distinct from pg_catalog.jsonb_build_object(
            'kind','delete_object','id',(v_object->>'id')::uuid,
            'baseVersion',v_new_object_version
          )
        or v_object_tombstone is null and (
          private.lukas_drawing_structure_raw_id_exists(
            (v_object->>'id')::uuid
          )
          or private.lukas_drawing_structure_raw_id_recorded(
            p_revision_id,(v_object->>'id')::uuid
          )
          or p_history_action is not null
        )
        or v_object_tombstone is not null and (
          p_history_action is distinct from 'redo'
          or v_object is distinct from v_object_tombstone
        )
      then raise exception using errcode='P1C01',
        message='DXF object-source compound is not exact'; end if;
      select l.* into v_layer from public.lukas_drawing_layers l
      where l.id=(v_object->>'layerId')::uuid
        and l.revision_id=p_revision_id and l.project_id=v_revision.project_id
        and l.visible and not l.locked and l.system_kind<>'source'
      for key share;
      if not found then raise exception using errcode='P1R01',
        message='DXF object layer is unavailable'; end if;
      v_expected_object_type:=case v_source->>'entityType'
        when 'LINE' then 'line'
        when 'LWPOLYLINE' then 'polyline'
        when 'POLYLINE' then 'polyline'
        when 'CIRCLE' then 'circle'
        when 'ARC' then 'arc'
        when 'TEXT' then 'text'
      end;
      if v_object->'geometry'->>'type' is distinct from v_expected_object_type
      then raise exception using errcode='P1C01',
        message='DXF source type does not match its drawing object'; end if;
      if v_object_tombstone is null then
        insert into public.lukas_drawing_objects(
          id,lineage_id,page_id,layer_id,revision_id,project_id,
          name,object_type,geometry,style_id,style,status,version,
          created_by,updated_by
        ) values(
          (v_object->>'id')::uuid,(v_object->>'id')::uuid,
          v_layer.page_id,v_layer.id,p_revision_id,v_revision.project_id,
          v_object->>'name',v_object->'geometry'->>'type',v_object->'geometry',
          nullif(v_object->>'styleId','')::uuid,v_object->'style',
          'active',v_new_object_version,v_actor,v_actor
        );
      else
        update public.lukas_drawing_objects set
          layer_id=v_layer.id,page_id=v_layer.page_id,name=v_object->>'name',
          object_type=v_object->'geometry'->>'type',geometry=v_object->'geometry',
          style_id=nullif(v_object->>'styleId','')::uuid,
          style=v_object->'style',status='active',version=v_new_object_version,
          updated_by=v_actor
        where id=(v_object->>'id')::uuid and revision_id=p_revision_id
          and project_id=v_revision.project_id and status='deleted'
          and version=v_new_object_version-1;
        if not found then raise exception using errcode='P1C01',
          message='DXF object tombstone changed concurrently'; end if;
      end if;
      v_result_versions:=v_result_versions||pg_catalog.jsonb_build_object(
        v_object->>'id',v_new_object_version
      );
    end loop;
  elsif v_phase='object_source_delete' then
    if p_history_action is not null and p_history_action<>'undo' then
      raise exception using errcode='P1C01',
        message='DXF delete history lineage is invalid';
    end if;
    select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
      into v_source_actions
    from pg_catalog.jsonb_array_elements(p_forward->'actions')
      with ordinality a(value,ordinality)
    where a.ordinality%2=1;
    select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
      into v_inverse_source_actions
    from pg_catalog.jsonb_array_elements(p_inverse->'actions')
      with ordinality a(value,ordinality)
    where a.ordinality%2=0;
    v_source_plan:=private.lukas_drawing_validate_source_actions(
      p_revision_id,v_revision.project_id,
      v_source_actions,v_inverse_source_actions
    );
    v_result_versions:=v_source_plan->'results';
    v_expected_bases:=v_source_plan->'bases';
    for v_index in 0..v_count-1 by 2 loop
      v_action:=p_forward->'actions'->v_index;
      v_inverse_action:=p_inverse->'actions'->(v_count-v_index-2);
      v_source:=private.lukas_drawing_source_json(
        (v_action->>'id')::uuid,p_revision_id,v_revision.project_id,true
      );
      v_id:=(p_forward->'actions'->(v_index+1)->>'id')::uuid;
      v_previous:=private.lukas_drawing_structure_entity_json(
        'object',v_id,p_revision_id,v_revision.project_id
      );
      if v_source is null or v_previous is null
        or v_source->>'sourceKind'<>'dxf_entity'
        or v_source->>'objectId'<>v_id::text
        or v_inverse_action is distinct from pg_catalog.jsonb_build_object(
          'kind','put_object','entity',v_previous,'baseVersion',null
        )
        or p_inverse->'actions'->(v_count-v_index-1)
          is distinct from pg_catalog.jsonb_build_object(
            'kind','put_source','entity',v_source,'baseVersion',null
        )
        or (p_forward->'actions'->(v_index+1)->>'baseVersion')::bigint
          <>(v_previous->>'version')::bigint
        or exists(
          select 1 from public.lukas_drawing_object_sources active_source
          where active_source.object_id=v_id
            and active_source.revision_id=p_revision_id
            and active_source.project_id=v_revision.project_id
            and active_source.status='active'
            and not exists(
              select 1
              from pg_catalog.jsonb_array_elements(p_forward->'actions') a
              where a->>'kind'='delete_source'
                and a->>'id'=active_source.id::text
            )
        )
      then raise exception using errcode='P1C01',
        message='DXF object-source delete is not exact'; end if;
      v_expected_bases:=v_expected_bases||pg_catalog.jsonb_build_object(
        v_id::text,(v_previous->>'version')::bigint
      );
      update public.lukas_drawing_objects set
        status='deleted',version=(v_previous->>'version')::bigint+1,
        updated_by=v_actor
      where id=v_id and revision_id=p_revision_id
        and project_id=v_revision.project_id and status='active'
        and version=(v_previous->>'version')::bigint;
      if not found then raise exception using errcode='P1C01',
        message='DXF object delete changed concurrently'; end if;
      v_result_versions:=v_result_versions||
        pg_catalog.jsonb_build_object(v_id::text,null);
    end loop;
    if p_base_versions is distinct from v_expected_bases then
      raise exception using errcode='P1C01',
        message='DXF object-source delete bases are incomplete';
    end if;
  else
    for v_index in 0..v_count-1 loop
      v_action:=p_forward->'actions'->v_index;
      v_inverse_action:=p_inverse->'actions'->(v_count-v_index-1);
      v_entity:=v_action->'entity'; v_id:=(v_entity->>'id')::uuid;
      select l.* into v_layer from public.lukas_drawing_layers l
      where l.id=v_id and l.revision_id=p_revision_id
        and l.project_id=v_revision.project_id for update;
      if not found or v_layer.system_kind<>'custom'
        or (v_action->>'baseVersion')::bigint<>v_layer.version
        or (v_entity->>'version')::bigint<>v_layer.version
        or not (p_forward ? 'historyGroup') and v_layer.version<>1
      then raise exception using errcode='P1C01',
        message='DXF layer finalize target is stale'; end if;
      v_previous:=private.lukas_drawing_structure_entity_json(
        'layer',v_id,p_revision_id,v_revision.project_id
      );
      if v_inverse_action->>'kind'<>'put_layer'
        or (v_inverse_action->>'baseVersion')::bigint<>v_layer.version+1
        or v_inverse_action->'entity' is distinct from v_previous
        or v_entity-array['visible','locked','version']
          is distinct from v_previous-array['visible','locked','version']
      then raise exception using errcode='P1C01',
        message='DXF layer finalize inverse is not exact'; end if;
      v_expected_bases:=v_expected_bases||
        pg_catalog.jsonb_build_object(v_id::text,v_layer.version);
      update public.lukas_drawing_layers set
        visible=(v_entity->>'visible')::boolean,
        locked=(v_entity->>'locked')::boolean,
        version=v_layer.version+1,updated_at=pg_catalog.now()
      where id=v_id and version=v_layer.version;
      if not found then raise exception using errcode='P1C01',
        message='DXF layer finalize target changed concurrently'; end if;
      v_result_versions:=v_result_versions||
        pg_catalog.jsonb_build_object(v_id::text,v_layer.version+1);
    end loop;
    if p_base_versions is distinct from v_expected_bases then
      raise exception using errcode='P1C01',
        message='DXF layer finalize bases are incomplete';
    end if;
  end if;

  select coalesce(pg_catalog.max(o.sequence),0)+1 into v_sequence
  from public.lukas_drawing_operations o where o.revision_id=p_revision_id;
  insert into public.lukas_drawing_operations(
    revision_id,project_id,sequence,client_operation_id,operation_type,
    base_versions,forward,inverse,result_versions,actor_id,
    history_action,original_operation_id
  ) values(
    p_revision_id,v_revision.project_id,v_sequence,p_client_operation_id,
    p_operation_type,p_base_versions,p_forward,p_inverse,v_result_versions,
    v_actor,p_history_action,p_original_operation_id
  ) returning id into v_operation_id;
  return pg_catalog.jsonb_build_object(
    'operationId',v_operation_id,'sequence',v_sequence,
    'resultVersions',v_result_versions
  );
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or sqlstate 'P3F02'
    or sqlstate 'P3F03'
    or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation
    or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range then
    raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_sources jsonb; v_inverse_sources jsonb; v_core jsonb; v_inverse_core jsonb;
  v_plan jsonb; v_core_bases jsonb; v_result jsonb; v_results jsonb;
  v_source_ids text[]; v_operation_id uuid; v_write_token uuid;
begin
  v_write_token:=private.lukas_drawing_begin_operation_write_lease(
    p_revision_id,p_client_operation_id,v_actor,p_operation_type,
    p_base_versions,p_forward,p_inverse,p_history_action,
    p_original_operation_id
  );
  if p_operation_type='mutate_structure' and (
      p_forward ? 'historyGroup'
      or p_inverse ? 'historyGroup'
      or exists(
        select 1 from public.lukas_drawing_operations original
        where original.revision_id=p_revision_id
          and original.client_operation_id=p_original_operation_id
          and original.forward ? 'historyGroup'
      )
      or private.lukas_drawing_dxf_import_phase(
        p_base_versions,p_forward,p_inverse
      ) is not null
      or exists(
        select 1
        from pg_catalog.jsonb_array_elements(
          case when pg_catalog.jsonb_typeof(p_forward->'actions')='array'
            then p_forward->'actions' else '[]'::jsonb end
        ) a
        where a->'entity'->>'sourceKind'='dxf_entity'
      )
    ) then
    v_result:=private.lukas_drawing_apply_dxf_import_operation(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
    perform private.lukas_drawing_finish_operation_write_lease(v_write_token);
    return v_result;
  end if;
  if p_operation_type='restore_checkpoint' then
    perform pg_catalog.set_config(
      'private.lukas_drawing_p5_checkpoint_operation',p_revision_id::text,true
    );
    v_result:=private.lukas_drawing_apply_operation_pre_p5_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
    perform pg_catalog.set_config(
      'private.lukas_drawing_p5_checkpoint_operation','',true
    );
    perform private.lukas_drawing_finish_operation_write_lease(v_write_token);
    return v_result;
  end if;
  if p_operation_type<>'mutate_objects_with_references'
    or p_forward->>'type'<>'mutate_objects_with_references' then
    v_result:=private.lukas_drawing_apply_operation_pre_p5_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
    perform private.lukas_drawing_finish_operation_write_lease(v_write_token);
    return v_result;
  end if;
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in('admin','editor')
  for update;
  if not found then raise exception using errcode='P1R01',
    message='Drawing revision target is unavailable'; end if;
  select * into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
      or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions
      or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse
      or v_existing.history_action is distinct from p_history_action
      or v_existing.original_operation_id is distinct from p_original_operation_id
    then raise exception using errcode='P1C01',
      message='Drawing operation idempotency key does not match the stored request';
    end if;
    v_result:=pg_catalog.jsonb_build_object(
      'operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions
    );
    perform private.lukas_drawing_finish_operation_write_lease(v_write_token);
    return v_result;
  end if;
  select coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb
  ) into v_sources
  from pg_catalog.jsonb_array_elements(p_forward->'actions')
    with ordinality a(value,ordinality)
  where a.value->>'kind' in('put_source','delete_source');
  select coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb
  ) into v_inverse_sources
  from pg_catalog.jsonb_array_elements(p_inverse->'actions')
    with ordinality a(value,ordinality)
  where a.value->>'kind' in('put_source','delete_source');
  if pg_catalog.jsonb_array_length(v_sources)=0 then
    if exists(
      select 1 from public.lukas_drawing_object_sources s
      where s.revision_id=p_revision_id and s.status='active'
        and exists(
          select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') o
          where o->>'id'=s.object_id::text
        )
    ) then raise exception using errcode='P1C01',
      message='Reference-aware object mutation must carry every source'; end if;
    v_result:=private.lukas_drawing_apply_operation_pre_p5_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
    perform private.lukas_drawing_finish_operation_write_lease(v_write_token);
    return v_result;
  end if;
  v_plan:=private.lukas_drawing_validate_source_actions(
    p_revision_id,v_revision.project_id,v_sources,v_inverse_sources
  );
  select pg_catalog.array_agg(key) into v_source_ids
  from pg_catalog.jsonb_object_keys(v_plan->'results') key;
  v_core_bases:=p_base_versions-coalesce(v_source_ids,array[]::text[]);
  if p_base_versions is distinct from v_core_bases||(v_plan->'bases') then
    raise exception using errcode='P1C01',
      message='Drawing source base versions are incomplete';
  end if;
  select pg_catalog.jsonb_set(p_forward,'{actions}',coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind' not in('put_source','delete_source')),
    '[]'::jsonb),false) into v_core
  from pg_catalog.jsonb_array_elements(p_forward->'actions')
    with ordinality a(value,ordinality);
  select pg_catalog.jsonb_set(p_inverse,'{actions}',coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind' not in('put_source','delete_source')),
    '[]'::jsonb),false) into v_inverse_core
  from pg_catalog.jsonb_array_elements(p_inverse->'actions')
    with ordinality a(value,ordinality);

  v_result:=private.lukas_drawing_apply_operation_pre_p5_sources(
    p_revision_id,p_client_operation_id,p_operation_type,v_core_bases,
    v_core,v_inverse_core,p_history_action,p_original_operation_id
  );
  v_results:=(v_result->'resultVersions')||(v_plan->'results');
  perform private.lukas_drawing_apply_source_actions(
    p_revision_id,v_revision.project_id,v_actor,v_sources,v_results
  );
  v_operation_id:=(v_result->>'operationId')::uuid;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite',v_operation_id::text,true
  );
  update public.lukas_drawing_operations set
    base_versions=p_base_versions,forward=p_forward,inverse=p_inverse,
    result_versions=v_results
  where id=v_operation_id;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite','',true
  );
  v_result:=v_result||pg_catalog.jsonb_build_object(
    'resultVersions',v_results
  );
  perform private.lukas_drawing_finish_operation_write_lease(v_write_token);
  return v_result;
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or sqlstate 'P3F02'
    or sqlstate 'P3F03'
    or serialization_failure or deadlock_detected then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create function private.lukas_drawing_p6_source_anchor_json(
  p_id uuid,p_revision_id uuid,p_project_id uuid
) returns jsonb language sql stable security definer set search_path='' as $$
  select case a.source_kind
    when 'dxf_entity' then pg_catalog.jsonb_build_object(
      'id',a.id,'sourceFileId',a.source_file_id,
      'sourceSha256',a.source_sha256,'sourceKind',a.source_kind,
      'pdfPageNumber',null,'x',null,'y',null,'width',null,'height',null,
      'elementId',null,'ifcGlobalId',null,'camera',null,
      'entityKey',a.dxf_entity_key,'entityType',a.dxf_entity_type,
      'sourceLayer',a.dxf_source_layer,'handle',a.dxf_handle,
      'unitCode',a.dxf_unit_code,'unitSource',a.dxf_unit_source,
      'importerVersion',a.dxf_importer_version,'version',a.version
    )
    when 'pdf_region' then pg_catalog.jsonb_build_object(
      'id',a.id,'sourceFileId',a.source_file_id,
      'sourceSha256',a.source_sha256,'sourceKind',a.source_kind,
      'pdfPageNumber',a.pdf_page_number,'x',a.x,'y',a.y,
      'width',a.width,'height',a.height,'elementId',a.element_id,
      'ifcGlobalId',a.ifc_global_id,'camera',a.camera_json,'version',a.version
    )
    when 'ifc_element' then pg_catalog.jsonb_build_object(
      'id',a.id,'sourceFileId',a.source_file_id,
      'sourceSha256',a.source_sha256,'sourceKind',a.source_kind,
      'pdfPageNumber',a.pdf_page_number,'x',a.x,'y',a.y,
      'width',a.width,'height',a.height,'elementId',a.element_id,
      'ifcGlobalId',a.ifc_global_id,'camera',a.camera_json,'version',a.version
    )
  end
  from public.lukas_drawing_object_sources a
  where a.id=p_id and a.revision_id=p_revision_id and a.project_id=p_project_id
$$;

create or replace function private.lukas_drawing_p6_input_state(p_version_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'versionId',v.id,'projectId',v.project_id,'engineVersion',v.engine_version,
    'calculationPolicy',v.calculation_policy,'quantityScale',v.quantity_scale,
    'lines',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',l.id,'sectionId',l.section_id,
      'section',pg_catalog.jsonb_build_object('id',s.id,'parentId',s.parent_id,
        'code',s.code,'name',s.name,'sortOrder',s.sort_order),
      'itemCode',l.item_code,'itemName',l.item_name,'specification',l.specification,
      'unit',l.unit,'adjustment',l.signed_adjustment,
      'reason',l.adjustment_reason,'sortOrder',l.sort_order)
      order by l.item_code collate "C",l.id)
      from public.lukas_qto_boq_lines l
      join public.lukas_qto_boq_sections s
        on s.id=l.section_id and s.version_id=l.version_id
        and s.project_id=l.project_id
      where l.version_id=v.id),'[]'::jsonb),
    'drawingLinks',coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id',b.id,'line',b.boq_line_id,'factor',b.allocation_factor,
        'version',b.version,
        'source',pg_catalog.jsonb_build_object(
          'id',q.id,'revisionId',q.drawing_revision_id,
          'revisionVersion',q.drawing_revision_version,
          'snapshotSha256',q.drawing_snapshot_sha256,
          'objectId',q.drawing_object_id,
          'lineageId',q.drawing_object_lineage_id,
          'objectVersion',q.drawing_object_version,
          'fingerprint',q.object_fingerprint,'kind',q.measurement_kind,
          'rawQuantity',q.raw_quantity,'unit',q.unit,
          'rule',q.measurement_rule_version,
          'anchors',coalesce((select pg_catalog.jsonb_agg(
            private.lukas_drawing_p6_source_anchor_json(
              a.id,a.revision_id,a.project_id
            ) order by a.id)
            from public.lukas_drawing_object_sources a
            where a.object_id=q.drawing_object_id
              and a.revision_id=q.drawing_revision_id
              and a.project_id=q.project_id and a.status='active'),'[]'::jsonb),
          'issues',coalesce((select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object('id',i.id,'issueId',i.issue_id)
            order by i.id)
            from public.lukas_drawing_object_issue_links i
            where i.object_id=q.drawing_object_id
              and i.revision_id=q.drawing_revision_id
              and i.project_id=q.project_id),'[]'::jsonb)
        )
      ) order by b.quantity_link_id,b.boq_line_id)
      from public.lukas_drawing_boq_links b
      join public.lukas_drawing_quantity_links q
        on q.id=b.quantity_link_id and q.project_id=b.project_id
      where b.boq_version_id=v.id),'[]'::jsonb),
    'legacyMappings',coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id',m.id,'line',m.line_id,'fileId',m.source_file_id,
        'sha256',m.source_sha256,'subject',m.source_subject_key,
        'quantity',m.source_quantity,'factor',m.factor,'unit',m.unit,
        'elementIds',m.element_ids
      ) order by m.id)
      from public.lukas_qto_boq_quantity_mappings m
      where m.version_id=v.id),'[]'::jsonb),
    'legacyExclusions',coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id',e.id,'fileId',e.source_file_id,'sha256',e.source_sha256,
        'subject',e.source_subject_key,'quantity',e.source_quantity,
        'unit',e.unit,'elementIds',e.element_ids,'reason',e.reason
      ) order by e.id)
      from public.lukas_qto_boq_source_exclusions e
      where e.version_id=v.id),'[]'::jsonb),
    'components',coalesce((select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id',c.id,'line',c.line_id,'resourceId',c.resource_id,
        'coefficient',c.coefficient,
        'resource',pg_catalog.jsonb_build_object(
          'id',r.id,'code',r.resource_code,'type',r.resource_type,
          'name',r.resource_name,'specification',r.specification,
          'unit',r.unit,'unitPriceKrw',r.unit_price_krw,
          'priceBookId',r.price_book_id
        )
      ) order by c.id)
      from public.lukas_qto_boq_rate_components c
      join public.lukas_qto_price_resources r
        on r.id=c.resource_id and r.project_id=c.project_id
      where c.version_id=v.id),'[]'::jsonb),
    'priceBook',(select pg_catalog.jsonb_build_object(
      'id',p.id,'name',p.name,'versionLabel',p.version_label,
      'fileId',p.source_file_id,'sha256',p.source_sha256,
      'effectiveDate',p.effective_date,'currency',p.currency,
      'rightsBasis',p.rights_basis,'licenseNote',p.license_note
    ) from public.lukas_qto_price_books p
      where p.id=v.price_book_id and p.project_id=v.project_id)
  ) from public.lukas_qto_boq_versions v where v.id=p_version_id
$$;

create or replace function private.lukas_drawing_apply_operation_pre_p4_semantic_objects(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_snapshot public.lukas_drawing_snapshots%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_issue jsonb; v_action jsonb; v_identity jsonb; v_result jsonb;
  v_sources jsonb; v_inverse_sources jsonb; v_core jsonb; v_inverse_core jsonb;
  v_plan jsonb; v_core_bases jsonb; v_results jsonb; v_live_sources jsonb;
  v_snapshot_sources jsonb; v_target_sources jsonb; v_live_issues jsonb;
  v_source_ids text[];
  v_operation_id uuid; v_sequence bigint;
begin
  if p_operation_type<>'restore_checkpoint' then
    return private.lukas_drawing_apply_operation_pre_p5_checkpoint_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  select s.* into v_snapshot from public.lukas_drawing_snapshots s
  where s.id=(p_forward->>'checkpointId')::uuid
    and s.revision_id=p_revision_id for share;
  if not found or not (
    exists(
      select 1 from pg_catalog.jsonb_array_elements(
        v_snapshot.canonical_json->'sources'
      ) s where s ? 'revisionId'
    )
    or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind' in('put_source','delete_source')
    )
  ) then
    return private.lukas_drawing_apply_operation_pre_p5_checkpoint_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
      or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions
      or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse
      or v_existing.history_action is distinct from p_history_action
      or v_existing.original_operation_id is distinct from p_original_operation_id
    then raise exception using errcode='P1C01',
      message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions
    );
  end if;
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.status='draft'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in('admin','editor')
  for update;
  if not found or v_snapshot.schema_version<>2
    or v_snapshot.sha256 is distinct from pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(
        v_snapshot.canonical_json::text,'UTF8'),'sha256'),'hex'
    )
  then raise exception using errcode='P1C01',
    message='Drawing checkpoint reference target is invalid'; end if;
  v_snapshot_sources:=private.lukas_drawing_p5_checkpoint_sources(
    v_snapshot.canonical_json->'sources',p_revision_id
  );
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(v_snapshot_sources) s
    where private.lukas_drawing_structure_action_valid(
      pg_catalog.jsonb_build_object(
        'kind','put_source','entity',s,'baseVersion',null
      ),p_revision_id
    ) is not true
      or not exists(
        select 1 from pg_catalog.jsonb_array_elements(
          v_snapshot.canonical_json->'objects'
        ) o where o->>'id'=s->>'objectId'
      )
      or not exists(
        select 1 from public.lukas_qto_files f
        where f.id=(s->>'sourceFileId')::uuid
          and f.project_id=v_revision.project_id
          and f.sha256=s->>'sourceSha256' and f.immutable
          and (
            s->>'sourceKind'='pdf_region' and f.kind='pdf'
            or s->>'sourceKind'='ifc_element' and f.kind='ifc'
            or s->>'sourceKind'='dxf_entity' and f.kind='dxf'
          )
      )
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(v_snapshot_sources) s
    group by s->>'objectId',s->>'sourceFileId',s->>'sourceKind'
    having pg_catalog.count(*)>1
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'issues'
    ) i
    where not (i ?& array['id','objectId'])
      or i-array['id','objectId']<>'{}'::jsonb
      or not exists(
        select 1 from pg_catalog.jsonb_array_elements(
          v_snapshot.canonical_json->'objects'
        ) o where o->>'id'=i->>'objectId'
      )
      or not exists(
        select 1 from public.lukas_drawing_issues x
        where x.id=(i->>'id')::uuid and x.project_id=v_revision.project_id
      )
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'issues'
    ) i group by i->>'id',i->>'objectId' having pg_catalog.count(*)>1
  ) then raise exception using errcode='P1C01',
    message='Drawing checkpoint source graph is invalid'; end if;

  select coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb
  ) into v_sources
  from pg_catalog.jsonb_array_elements(p_forward->'actions')
    with ordinality a(value,ordinality)
  where a.value->>'kind' in('put_source','delete_source');
  select coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb
  ) into v_inverse_sources
  from pg_catalog.jsonb_array_elements(p_inverse->'actions')
    with ordinality a(value,ordinality)
  where a.value->>'kind' in('put_source','delete_source');
  v_plan:=private.lukas_drawing_validate_source_actions(
    p_revision_id,v_revision.project_id,v_sources,v_inverse_sources
  );
  select pg_catalog.array_agg(key) into v_source_ids
  from pg_catalog.jsonb_object_keys(v_plan->'results') key;
  v_core_bases:=p_base_versions-coalesce(v_source_ids,array[]::text[]);
  if p_base_versions is distinct from v_core_bases||(v_plan->'bases') then
    raise exception using errcode='P1C01',
      message='Drawing checkpoint source base versions are incomplete';
  end if;
  select pg_catalog.jsonb_set(p_forward,'{actions}',coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind' not in('put_source','delete_source')),
    '[]'::jsonb),false) into v_core
  from pg_catalog.jsonb_array_elements(p_forward->'actions')
    with ordinality a(value,ordinality);
  select pg_catalog.jsonb_set(p_inverse,'{actions}',coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind' not in('put_source','delete_source')),
    '[]'::jsonb),false) into v_inverse_core
  from pg_catalog.jsonb_array_elements(p_inverse->'actions')
    with ordinality a(value,ordinality);

  insert into private.lukas_drawing_checkpoint_reference_targets(
    transaction_id,actor_id,revision_id,snapshot_id,sources,issues
  ) values(
    pg_catalog.txid_current(),v_actor,p_revision_id,v_snapshot.id,
    v_snapshot_sources,v_snapshot.canonical_json->'issues'
  );
  insert into private.lukas_drawing_checkpoint_issue_delete_leases(
    transaction_id,actor_id,revision_id,link_id
  ) select pg_catalog.txid_current(),v_actor,p_revision_id,l.id
    from public.lukas_drawing_object_issue_links l
    where l.revision_id=p_revision_id and not exists(
      select 1 from pg_catalog.jsonb_array_elements(
        v_snapshot.canonical_json->'issues'
      ) i where i->>'id'=l.issue_id::text and i->>'objectId'=l.object_id::text
    );
  insert into private.lukas_drawing_checkpoint_reference_history(
    revision_id,project_id,snapshot_id,client_operation_id,actor_id,
    link_kind,action,link_identity
  ) select p_revision_id,v_revision.project_id,v_snapshot.id,
      p_client_operation_id,v_actor,'issue','delete',pg_catalog.to_jsonb(l)
    from public.lukas_drawing_object_issue_links l
    join private.lukas_drawing_checkpoint_issue_delete_leases x
      on x.transaction_id=pg_catalog.txid_current() and x.actor_id=v_actor
      and x.revision_id=p_revision_id and x.link_id=l.id;
  delete from public.lukas_drawing_object_issue_links l
  using private.lukas_drawing_checkpoint_issue_delete_leases x
  where x.transaction_id=pg_catalog.txid_current() and x.actor_id=v_actor
    and x.revision_id=p_revision_id and x.link_id=l.id;

  for v_action in
    select value from pg_catalog.jsonb_array_elements(p_forward->'actions')
  loop
    if v_action->>'kind' in('put_source','delete_source') then
      v_identity:=case when v_action->>'kind'='put_source'
        then v_action->'entity'
        else private.lukas_drawing_source_json(
          (v_action->>'id')::uuid,p_revision_id,v_revision.project_id,true
        ) end;
      insert into private.lukas_drawing_checkpoint_reference_history(
        revision_id,project_id,snapshot_id,client_operation_id,actor_id,
        link_kind,action,link_identity
      ) values(
        p_revision_id,v_revision.project_id,v_snapshot.id,
        p_client_operation_id,v_actor,'source',
        case when v_action->>'kind'='put_source' then 'restore'
          else 'delete' end,
        v_identity
      );
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(v_core->'actions')=0 then
    select coalesce(pg_catalog.max(o.sequence),0)+1 into v_sequence
    from public.lukas_drawing_operations o where o.revision_id=p_revision_id;
    v_operation_id:=extensions.gen_random_uuid();
    v_results:=v_plan->'results';
    insert into public.lukas_drawing_operations(
      id,revision_id,project_id,sequence,client_operation_id,operation_type,
      base_versions,forward,inverse,result_versions,actor_id,
      history_action,original_operation_id
    ) values(
      v_operation_id,p_revision_id,v_revision.project_id,v_sequence,
      p_client_operation_id,p_operation_type,p_base_versions,p_forward,
      p_inverse,v_results,v_actor,p_history_action,p_original_operation_id
    );
    v_result:=pg_catalog.jsonb_build_object(
      'operationId',v_operation_id,'sequence',v_sequence
    );
  else
    v_result:=private.lukas_drawing_apply_operation_pre_checkpoint_reference_authority(
      p_revision_id,p_client_operation_id,p_operation_type,v_core_bases,
      v_core,v_inverse_core,p_history_action,p_original_operation_id
    );
    v_results:=(v_result->'resultVersions')||(v_plan->'results');
    perform private.lukas_drawing_apply_source_actions(
      p_revision_id,v_revision.project_id,v_actor,v_sources,v_results
    );
    v_operation_id:=(v_result->>'operationId')::uuid;
  end if;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite',v_operation_id::text,true
  );
  update public.lukas_drawing_operations set
    base_versions=p_base_versions,forward=p_forward,inverse=p_inverse,
    result_versions=v_results
  where id=v_operation_id;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite','',true
  );

  for v_issue in
    select value from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'issues'
    )
  loop
    if not exists(
      select 1 from public.lukas_drawing_object_issue_links l
      where l.object_id=(v_issue->>'objectId')::uuid
        and l.issue_id=(v_issue->>'id')::uuid
    ) then
      insert into public.lukas_drawing_object_issue_links(
        object_id,revision_id,issue_id,project_id,created_by
      ) values(
        (v_issue->>'objectId')::uuid,p_revision_id,
        (v_issue->>'id')::uuid,v_revision.project_id,v_actor
      );
      insert into private.lukas_drawing_checkpoint_reference_history(
        revision_id,project_id,snapshot_id,client_operation_id,actor_id,
        link_kind,action,link_identity
      ) values(
        p_revision_id,v_revision.project_id,v_snapshot.id,
        p_client_operation_id,v_actor,'issue','restore',v_issue
      );
    end if;
  end loop;
  delete from private.lukas_drawing_checkpoint_issue_delete_leases l
  where l.transaction_id=pg_catalog.txid_current() and l.actor_id=v_actor
    and l.revision_id=p_revision_id;
  delete from private.lukas_drawing_checkpoint_reference_targets t
  where t.transaction_id=pg_catalog.txid_current() and t.actor_id=v_actor
    and t.revision_id=p_revision_id;
  select coalesce(
    pg_catalog.jsonb_agg(s.value-'version' order by s.value->>'id'),'[]'::jsonb
  ) into v_live_sources
  from pg_catalog.jsonb_array_elements(
    private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true)->'sources'
  ) s;
  select coalesce(
    pg_catalog.jsonb_agg(s.value-'version' order by s.value->>'id'),'[]'::jsonb
  ) into v_target_sources
  from pg_catalog.jsonb_array_elements(v_snapshot_sources) s;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',l.issue_id,'objectId',l.object_id
  ) order by l.issue_id,l.object_id),'[]'::jsonb) into v_live_issues
  from public.lukas_drawing_object_issue_links l
  where l.revision_id=p_revision_id;
  if v_live_sources is distinct from v_target_sources
    or v_live_issues is distinct from v_snapshot.canonical_json->'issues'
  then raise exception using errcode='P1C01',
    message='Drawing checkpoint reference delta does not match its snapshot';
  end if;
  return v_result||pg_catalog.jsonb_build_object('resultVersions',v_results);
end;
$$;

revoke insert,update,delete on table public.lukas_drawing_object_sources
  from authenticated;

revoke all on table private.lukas_drawing_operation_write_leases,
  private.lukas_drawing_operation_authority_proofs
from public,anon,authenticated,service_role;

revoke all on function private.lukas_drawing_dxf_entity_payload_valid(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_group_valid(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_operation_envelope_sha256(
  public.lukas_drawing_operations
) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_operation_authority_proof_valid(
  public.lukas_drawing_operations
) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_begin_operation_write_lease(
  uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_finish_operation_write_lease(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_operation_authority_guard()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_operation_authority_proof_write()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_payload_identity(jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_action_state_matches(
  uuid,uuid,jsonb,jsonb
) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_result_targets_match(
  jsonb,jsonb
) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_payload_state_matches(
  uuid,uuid,jsonb,jsonb
) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_state_matches(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_group_status(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_groups_complete(uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_group_lease_guard()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_group_append_guard()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_state_guard()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_group_review_guard()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_history_group_freeze_guard()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_import_phase(jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_apply_dxf_import_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_source_anchor_json(uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) to authenticated,service_role;

commit;
