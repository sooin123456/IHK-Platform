begin;

-- Historical public clone bindings were editor-mutable before this guard.
-- Only rows already written through the private ledger path are authoritative.

create or replace function private.lukas_drawing_template_clone_ledger_append_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='P1C01',
    message='Drawing template clone ledger is append-only';
end;
$$;
drop trigger if exists lukas_drawing_template_clone_ledger_append_guard
  on private.lukas_drawing_template_clone_requests;
create trigger lukas_drawing_template_clone_ledger_append_guard
before update or delete on private.lukas_drawing_template_clone_requests
for each row execute function private.lukas_drawing_template_clone_ledger_append_guard();

create or replace function private.lukas_drawing_clone_binding_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (tg_op='INSERT' and (
      new.clone_request_id is not null
      or new.clone_requested_by is not null
      or new.clone_request_hash is not null
    )) or (tg_op='UPDATE' and (
      new.clone_request_id is distinct from old.clone_request_id
      or new.clone_requested_by is distinct from old.clone_requested_by
      or new.clone_request_hash is distinct from old.clone_request_hash
    )) then
    raise exception using errcode='P1C01',
      message='Drawing template clone binding is immutable';
  end if;
  return new;
end;
$$;
drop trigger if exists lukas_drawing_clone_binding_guard
  on public.lukas_drawing_documents;
create trigger lukas_drawing_clone_binding_guard
before insert or update on public.lukas_drawing_documents
for each row execute function private.lukas_drawing_clone_binding_guard();

-- V1 evidence is promoted directly into P2 rows.  The explicitly selected,
-- immutable, SHA-matched page background becomes the authoritative paper
-- canvas background; blank clones keep every source field null.
create or replace function private.lukas_drawing_clone_v1_snapshot(
  p_snapshot jsonb,p_project_id uuid,p_actor uuid,p_title text,p_source_file_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_document uuid; v_revision uuid; v_page jsonb; v_layer jsonb;
  v_object jsonb; v_source jsonb; v_issue jsonb;
  v_page_map jsonb:='{}'::jsonb; v_canvas_map jsonb:='{}'::jsonb;
  v_layer_map jsonb:='{}'::jsonb; v_object_map jsonb:='{}'::jsonb;
  v_page_id uuid; v_canvas_id uuid; v_layer_id uuid; v_object_id uuid;
  v_file public.lukas_qto_files%rowtype;
begin
  if pg_catalog.jsonb_typeof(p_snapshot) is distinct from 'object'
    or not (p_snapshot ?& array[
      'schemaVersion','revision','pages','layers','objects','operationSequence'
    ])
    or p_snapshot-array[
      'schemaVersion','revision','pages','layers','objects','operationSequence'
    ]<>'{}'::jsonb
    or p_snapshot->>'schemaVersion' is distinct from '1'
    or pg_catalog.jsonb_typeof(p_snapshot->'revision') is distinct from 'object'
    or exists(
      select 1 from pg_catalog.unnest(array['pages','layers','objects']) k
      where pg_catalog.jsonb_typeof(p_snapshot->k) is distinct from 'array'
    ) then
    raise exception using errcode='P1R01',
      message='Drawing template target is unavailable';
  end if;
  if p_title is null
    or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 240 then
    raise exception using errcode='P1C01',message='Drawing template title is required';
  end if;
  if p_source_file_id is not null then
    select f.* into v_file from public.lukas_qto_files f
    where f.id=p_source_file_id and f.project_id=p_project_id
      and f.immutable and f.kind='pdf' for key share;
    if not found or not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_snapshot->'pages') p
      where p->>'backgroundSourceFileId'=p_source_file_id::text
        and p->>'backgroundSourceSha256'=v_file.sha256
    ) then
      raise exception using errcode='P1R01',
        message='Drawing template target is unavailable';
    end if;
  end if;

  insert into public.lukas_drawing_documents(project_id,title,created_by)
  values(p_project_id,pg_catalog.btrim(p_title),p_actor)
  returning id into v_document;
  insert into public.lukas_drawing_revisions(
    document_id,project_id,sequence,status,version,created_by
  ) values(v_document,p_project_id,1,'draft',1,p_actor)
  returning id into v_revision;

  for v_page in
    select value from pg_catalog.jsonb_array_elements(p_snapshot->'pages')
  loop
    if pg_catalog.jsonb_typeof(v_page)<>'object'
      or not (v_page ?& array[
        'id','name','pageNumber','widthMm','heightMm',
        'backgroundSourceFileId','backgroundSourceSha256',
        'backgroundPdfPage','calibration'
      ])
      or v_page-array[
        'id','name','pageNumber','widthMm','heightMm',
        'backgroundSourceFileId','backgroundSourceSha256',
        'backgroundPdfPage','calibration'
      ]<>'{}'::jsonb
      or private.lukas_drawing_p2_uuid(v_page->'id') is not true
      or pg_catalog.jsonb_typeof(v_page->'name')<>'string'
      or pg_catalog.jsonb_typeof(v_page->'pageNumber')<>'number'
      or pg_catalog.jsonb_typeof(v_page->'widthMm')<>'number'
      or pg_catalog.jsonb_typeof(v_page->'heightMm')<>'number' then
      raise exception using errcode='P1R01',
        message='Drawing template target is unavailable';
    end if;
    v_page_id:=extensions.gen_random_uuid();
    v_canvas_id:=extensions.gen_random_uuid();
    v_page_map:=v_page_map||pg_catalog.jsonb_build_object(v_page->>'id',v_page_id);
    v_canvas_map:=v_canvas_map||pg_catalog.jsonb_build_object(v_page->>'id',v_canvas_id);
    insert into public.lukas_drawing_pages(
      id,revision_id,project_id,name,page_number,sort_order,width_mm,height_mm,
      background_source_file_id,background_source_sha256,background_pdf_page,
      calibration,version
    ) values(
      v_page_id,v_revision,p_project_id,v_page->>'name',
      (v_page->>'pageNumber')::integer,(v_page->>'pageNumber')::integer-1,
      (v_page->>'widthMm')::numeric,(v_page->>'heightMm')::numeric,
      case when p_source_file_id::text=v_page->>'backgroundSourceFileId'
        and v_file.sha256=v_page->>'backgroundSourceSha256'
        then p_source_file_id end,
      case when p_source_file_id::text=v_page->>'backgroundSourceFileId'
        and v_file.sha256=v_page->>'backgroundSourceSha256'
        then v_file.sha256 end,
      case when p_source_file_id::text=v_page->>'backgroundSourceFileId'
        and v_file.sha256=v_page->>'backgroundSourceSha256'
        then nullif(v_page->>'backgroundPdfPage','')::integer end,
      case when p_source_file_id::text=v_page->>'backgroundSourceFileId'
        and v_file.sha256=v_page->>'backgroundSourceSha256'
        and pg_catalog.jsonb_typeof(v_page->'calibration')<>'null'
        then v_page->'calibration' end,
      1
    );
    insert into public.lukas_drawing_canvases(
      id,page_id,revision_id,project_id,name,space_kind,width_mm,height_mm,
      background_source_file_id,background_source_sha256,background_pdf_page,
      calibration,sort_order,version,created_by
    ) values(
      v_canvas_id,v_page_id,v_revision,p_project_id,'Paper','paper',
      (v_page->>'widthMm')::numeric,(v_page->>'heightMm')::numeric,
      case when p_source_file_id::text=v_page->>'backgroundSourceFileId'
        and v_file.sha256=v_page->>'backgroundSourceSha256'
        then p_source_file_id end,
      case when p_source_file_id::text=v_page->>'backgroundSourceFileId'
        and v_file.sha256=v_page->>'backgroundSourceSha256'
        then v_file.sha256 end,
      case when p_source_file_id::text=v_page->>'backgroundSourceFileId'
        and v_file.sha256=v_page->>'backgroundSourceSha256'
        then nullif(v_page->>'backgroundPdfPage','')::integer end,
      case when p_source_file_id::text=v_page->>'backgroundSourceFileId'
        and v_file.sha256=v_page->>'backgroundSourceSha256'
        and pg_catalog.jsonb_typeof(v_page->'calibration')<>'null'
        then v_page->'calibration' end,
      0,1,p_actor
    );
  end loop;
  if v_page_map='{}'::jsonb then
    raise exception using errcode='P1R01',
      message='Drawing template target is unavailable';
  end if;

  for v_layer in
    select value from pg_catalog.jsonb_array_elements(p_snapshot->'layers')
  loop
    if pg_catalog.jsonb_typeof(v_layer)<>'object'
      or not (v_layer ?& array[
        'id','pageId','name','sortOrder','visible','locked','systemKind','version'
      ])
      or v_layer-array[
        'id','pageId','name','sortOrder','visible','locked','systemKind','version'
      ]<>'{}'::jsonb
      or private.lukas_drawing_p2_uuid(v_layer->'id') is not true
      or private.lukas_drawing_p2_uuid(v_layer->'pageId') is not true
      or (v_page_map->>(v_layer->>'pageId')) is null then
      raise exception using errcode='P1R01',
        message='Drawing template target is unavailable';
    end if;
    v_layer_id:=extensions.gen_random_uuid();
    v_layer_map:=v_layer_map||pg_catalog.jsonb_build_object(v_layer->>'id',v_layer_id);
    insert into public.lukas_drawing_layers(
      id,page_id,canvas_id,revision_id,project_id,name,sort_order,visible,
      locked,system_kind,version,created_by
    ) values(
      v_layer_id,(v_page_map->>(v_layer->>'pageId'))::uuid,
      (v_canvas_map->>(v_layer->>'pageId'))::uuid,v_revision,p_project_id,
      v_layer->>'name',(v_layer->>'sortOrder')::integer,
      (v_layer->>'visible')::boolean,(v_layer->>'locked')::boolean,
      v_layer->>'systemKind',1,p_actor
    );
  end loop;
  for v_page in
    select value from pg_catalog.jsonb_array_elements(p_snapshot->'pages')
  loop
    if not exists(
      select 1 from public.lukas_drawing_layers l
      where l.revision_id=v_revision
        and l.page_id=(v_page_map->>(v_page->>'id'))::uuid
        and l.visible and not l.locked and l.system_kind<>'source'
    ) then
      insert into public.lukas_drawing_layers(
        page_id,canvas_id,revision_id,project_id,name,sort_order,visible,
        locked,system_kind,version,created_by
      ) values(
        (v_page_map->>(v_page->>'id'))::uuid,
        (v_canvas_map->>(v_page->>'id'))::uuid,v_revision,p_project_id,
        'Work',999,true,false,'work',1,p_actor
      );
    end if;
  end loop;

  for v_object in
    select value from pg_catalog.jsonb_array_elements(p_snapshot->'objects')
  loop
    if pg_catalog.jsonb_typeof(v_object)<>'object'
      or not (v_object ?& array[
        'id','lineageId','pageId','layerId','name','type','geometry','style',
        'version','sources','issueIds'
      ])
      or v_object-array[
        'id','lineageId','pageId','layerId','name','type','geometry','style',
        'version','sources','issueIds'
      ]<>'{}'::jsonb
      or private.lukas_drawing_p2_uuid(v_object->'id') is not true
      or private.lukas_drawing_p2_uuid(v_object->'lineageId') is not true
      or (v_page_map->>(v_object->>'pageId')) is null
      or (v_layer_map->>(v_object->>'layerId')) is null
      or pg_catalog.jsonb_typeof(v_object->'geometry')<>'object'
      or pg_catalog.jsonb_typeof(v_object->'style')<>'object'
      or pg_catalog.jsonb_typeof(v_object->'sources')<>'array'
      or pg_catalog.jsonb_typeof(v_object->'issueIds')<>'array' then
      raise exception using errcode='P1R01',
        message='Drawing template target is unavailable';
    end if;
    v_object_id:=extensions.gen_random_uuid();
    v_object_map:=v_object_map||pg_catalog.jsonb_build_object(v_object->>'id',v_object_id);
    insert into public.lukas_drawing_objects(
      id,lineage_id,page_id,layer_id,revision_id,project_id,name,object_type,
      geometry,style,status,version,created_by,updated_by
    ) values(
      v_object_id,(v_object->>'lineageId')::uuid,
      (v_page_map->>(v_object->>'pageId'))::uuid,
      (v_layer_map->>(v_object->>'layerId'))::uuid,v_revision,p_project_id,
      v_object->>'name',v_object->>'type',v_object->'geometry',v_object->'style',
      'active',1,p_actor,p_actor
    );
    for v_source in
      select value from pg_catalog.jsonb_array_elements(v_object->'sources')
    loop
      if pg_catalog.jsonb_typeof(v_source)<>'object'
        or not (v_source ?& array[
          'id','sourceFileId','sourceSha256','sourceKind','pdfPageNumber','x','y',
          'width','height','elementId','ifcGlobalId','camera'
        ])
        or v_source-array[
          'id','sourceFileId','sourceSha256','sourceKind','pdfPageNumber','x','y',
          'width','height','elementId','ifcGlobalId','camera'
        ]<>'{}'::jsonb then
        raise exception using errcode='P1R01',
          message='Drawing template target is unavailable';
      end if;
      if p_source_file_id::text=v_source->>'sourceFileId'
        and v_file.sha256=v_source->>'sourceSha256' then
        insert into public.lukas_drawing_object_sources(
          object_id,revision_id,project_id,source_file_id,source_sha256,
          source_kind,pdf_page_number,x,y,width,height,element_id,ifc_global_id,
          camera_json,created_by
        ) values(
          v_object_id,v_revision,p_project_id,p_source_file_id,v_file.sha256,
          v_source->>'sourceKind',nullif(v_source->>'pdfPageNumber','')::integer,
          nullif(v_source->>'x','')::numeric,nullif(v_source->>'y','')::numeric,
          nullif(v_source->>'width','')::numeric,
          nullif(v_source->>'height','')::numeric,
          nullif(v_source->>'elementId',''),nullif(v_source->>'ifcGlobalId',''),
          v_source->'camera',p_actor
        );
      end if;
    end loop;
    for v_issue in
      select value from pg_catalog.jsonb_array_elements(v_object->'issueIds')
    loop
      if pg_catalog.jsonb_typeof(v_issue)<>'string'
        or private.lukas_drawing_p2_uuid(v_issue) is not true then
        raise exception using errcode='P1R01',
          message='Drawing template target is unavailable';
      end if;
    end loop;
  end loop;
  return pg_catalog.jsonb_build_object(
    'documentId',v_document,'revisionId',v_revision
  );
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' then raise;
  when others then
    raise exception using errcode='P1R01',
      message='Drawing template target is unavailable';
end;
$$;

-- Every canonical structure write carries lineage.  Existing operation rows
-- are checked first so an exact retry remains exact even after its target row
-- was deleted.
alter function private.lukas_drawing_structure_action_valid(jsonb,uuid)
  rename to lukas_drawing_structure_action_valid_pre_final_lineage;
create or replace function private.lukas_drawing_structure_action_valid(
  p_action jsonb,p_revision_id uuid
) returns boolean language plpgsql immutable set search_path='' as $$
begin
  if p_action->>'kind'='put_block_instance' then
    return private.lukas_drawing_structure_action_valid_pre_final_lineage(
      p_action,p_revision_id
    ) is true
      and p_action->'entity' ? 'lineageId'
      and private.lukas_drawing_p2_uuid(
        p_action->'entity'->'lineageId'
      ) is true;
  end if;
  return private.lukas_drawing_structure_action_valid_pre_final_lineage(
    p_action,p_revision_id
  );
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_block_instance_lineage_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_map_text text; v_map jsonb; v_source_revision uuid;
  v_offset bigint; v_lineage uuid; v_operation_active boolean;
begin
  if tg_op='UPDATE' and new.lineage_id is distinct from old.lineage_id then
    raise exception using errcode='P1C01',
      message='Drawing block instance lineage is immutable';
  end if;
  if tg_op='INSERT' then
    v_map_text:=pg_catalog.current_setting(
      'private.lukas_drawing_block_instance_lineage_map',true
    );
    v_operation_active:=coalesce(pg_catalog.current_setting(
      'private.lukas_drawing_block_instance_operation',true
    ),'')='1';
    v_source_revision:=nullif(pg_catalog.current_setting(
      'private.lukas_drawing_p2_clone_source_revision',true
    ),'')::uuid;
    if coalesce(v_map_text,'')<>'' then
      v_map:=v_map_text::jsonb;
    end if;
    if v_map ? new.id::text then
      new.lineage_id:=(v_map->>new.id::text)::uuid;
    elsif v_source_revision is not null then
      select pg_catalog.count(*) into v_offset
      from public.lukas_drawing_block_instances
      where revision_id=new.revision_id;
      select i.lineage_id into v_lineage
      from public.lukas_drawing_block_instances i
      where i.revision_id=v_source_revision
      order by i.id offset v_offset limit 1;
      if v_lineage is null then
        raise exception using errcode='P1R01',
          message='Drawing template target is unavailable';
      end if;
      new.lineage_id:=v_lineage;
    elsif new.lineage_id is not null then
      null;
    elsif v_operation_active then
      raise exception using errcode='P1C01',
        message='Drawing block instance lineage is required';
    elsif current_user in ('authenticated','anon') then
      raise exception using errcode='P1C01',
        message='Drawing block instance lineage is required';
    else
      -- Additive migration/backfill compatibility only.  Canonical operation
      -- and clone paths are handled by the authoritative branches above.
      new.lineage_id:=new.id;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

alter function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) rename to lukas_drawing_apply_operation_pre_final_lineage;
create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_action jsonb; v_entity jsonb; v_tombstone jsonb; v_result jsonb;
  v_id uuid; v_lineage uuid; v_stored_lineage uuid;
  v_map jsonb:='{}'::jsonb;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing revision target is unavailable';
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
      or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions
      or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse then
      raise exception using errcode='P1C01',
        message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions
    );
  end if;

  if p_operation_type='mutate_structure'
    and p_forward->>'type'='mutate_structure'
    and pg_catalog.jsonb_typeof(p_forward->'actions')='array' then
    for v_action in
      select value from pg_catalog.jsonb_array_elements(p_forward->'actions')
      where value->>'kind'='put_block_instance'
      order by value->'entity'->>'id'
    loop
      v_entity:=v_action->'entity';
      if private.lukas_drawing_structure_action_valid(
        v_action,p_revision_id
      ) is not true then
        raise exception using errcode='P1C01',
          message='Drawing structure action JSON is invalid';
      end if;
      v_id:=(v_entity->>'id')::uuid;
      v_lineage:=(v_entity->>'lineageId')::uuid;
      if pg_catalog.jsonb_typeof(v_action->'baseVersion')='null' then
        v_tombstone:=private.lukas_drawing_structure_tombstone(
          p_revision_id,v_id,'put_block_instance'
        );
        if v_tombstone is null then
          if v_lineage<>v_id then
            raise exception using errcode='P1C01',
              message='A fresh drawing block instance starts its own lineage';
          end if;
        elsif v_tombstone->>'lineageId' is distinct from v_lineage::text then
          raise exception using errcode='P1C01',
            message='Drawing block instance restore lineage is not exact';
        end if;
      else
        select i.lineage_id into v_stored_lineage
        from public.lukas_drawing_block_instances i
        where i.id=v_id and i.revision_id=p_revision_id
          and i.project_id=v_revision.project_id
        for update;
        if not found or v_stored_lineage is distinct from v_lineage then
          raise exception using errcode='P1C01',
            message='Drawing block instance lineage does not match stored state';
        end if;
      end if;
      v_map:=v_map||pg_catalog.jsonb_build_object(v_id::text,v_lineage);
    end loop;
    perform pg_catalog.set_config(
      'private.lukas_drawing_block_instance_lineage_map',v_map::text,true
    );
    perform pg_catalog.set_config(
      'private.lukas_drawing_block_instance_operation','1',true
    );
  end if;
  v_result:=private.lukas_drawing_apply_operation_pre_final_lineage(
    p_revision_id,p_client_operation_id,p_operation_type,
    p_base_versions,p_forward,p_inverse
  );
  perform pg_catalog.set_config(
    'private.lukas_drawing_block_instance_lineage_map','',true
  );
  perform pg_catalog.set_config(
    'private.lukas_drawing_block_instance_operation','',true
  );
  return v_result;
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when numeric_value_out_of_range or invalid_text_representation then
    raise exception using errcode='P1C01',
      message='Drawing block instance lineage payload is invalid';
  when others then raise;
end;
$$;

-- The final four-argument clone implementation never reads document binding
-- columns.  Revision lock -> request advisory lock -> private ledger gives one
-- exact result for concurrent exact retries and P1C01 for key reuse mismatch.
alter function private.lukas_drawing_create_from_template(uuid,text,uuid,uuid)
  rename to lukas_drawing_create_from_template_pre_final_authority;
create or replace function private.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid,
  p_client_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_snapshot public.lukas_drawing_snapshots%rowtype;
  v_existing private.lukas_drawing_template_clone_requests%rowtype;
  v_file public.lukas_qto_files%rowtype;
  v_hash text; v_result jsonb; v_expected_revision jsonb;
begin
  if p_client_request_id is null then
    raise exception using errcode='P1C01',
      message='Drawing template request ID is required';
  end if;
  if p_title is null
    or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 240 then
    raise exception using errcode='P1C01',message='Drawing template title is required';
  end if;
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_source_revision_id and v_actor is not null
    and r.status='approved'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing template target is unavailable';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':'||p_client_request_id::text,0
  ));
  v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'sourceRevisionId',p_source_revision_id,
      'title',pg_catalog.btrim(p_title),
      'sourceFileId',p_source_file_id
    )::text,'UTF8'
  ),'sha256'),'hex');
  select l.* into v_existing
  from private.lukas_drawing_template_clone_requests l
  where l.actor_id=v_actor and l.client_request_id=p_client_request_id
  for update;
  if found then
    if v_existing.request_hash is distinct from v_hash then
      raise exception using errcode='P1C01',
        message='Drawing template request ID does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'documentId',v_existing.document_id,
      'revisionId',v_existing.revision_id,
      'sourceRevisionId',p_source_revision_id
    );
  end if;

  select s.* into v_snapshot
  from public.lukas_drawing_snapshots s
  join public.lukas_drawing_revision_approvals a
    on a.revision_id=s.revision_id and a.project_id=s.project_id
    and a.subject_version=s.revision_version
    and a.snapshot_sha256=s.sha256 and a.decision='approved'
  where s.revision_id=v_revision.id
    and s.project_id=v_revision.project_id
    and s.revision_version=v_revision.version;
  if not found
    or v_snapshot.schema_version not in (1,2)
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json)<>'object'
    or v_snapshot.canonical_json->>'schemaVersion'
      is distinct from v_snapshot.schema_version::text
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'operationSequence')
      <>'number'
    or (v_snapshot.canonical_json->>'operationSequence')::bigint
      is distinct from v_snapshot.operation_sequence
    or v_snapshot.sha256 is distinct from pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(
        v_snapshot.canonical_json::text,'UTF8'
      ),'sha256'),'hex'
    ) then
    raise exception using errcode='P1R01',
      message='Drawing template target is unavailable';
  end if;

  if v_snapshot.schema_version=1 then
    v_expected_revision:=pg_catalog.jsonb_build_object(
      'id',v_revision.id,
      'documentId',v_revision.document_id,
      'projectId',v_revision.project_id,
      'sequence',v_revision.sequence,
      'version',v_revision.version
    );
    if not (v_snapshot.canonical_json ?& array[
        'schemaVersion','revision','pages','layers','objects','operationSequence'
      ])
      or v_snapshot.canonical_json-array[
        'schemaVersion','revision','pages','layers','objects','operationSequence'
      ]<>'{}'::jsonb
      or v_snapshot.canonical_json->'revision' is distinct from v_expected_revision
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'pages')<>'array'
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'layers')<>'array'
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'objects')<>'array'
      then
      raise exception using errcode='P1R01',
        message='Drawing template target is unavailable';
    end if;
    if p_source_file_id is not null then
      select f.* into v_file from public.lukas_qto_files f
      where f.id=p_source_file_id and f.project_id=v_revision.project_id
        and f.immutable and f.kind='pdf' for key share;
      if not found or not exists(
        select 1
        from pg_catalog.jsonb_array_elements(
          v_snapshot.canonical_json->'pages'
        ) p
        where p->>'backgroundSourceFileId'=p_source_file_id::text
          and p->>'backgroundSourceSha256'=v_file.sha256
      ) then
        raise exception using errcode='P1R01',
          message='Drawing template target is unavailable';
      end if;
    end if;
    v_result:=private.lukas_drawing_clone_v1_snapshot(
      v_snapshot.canonical_json,v_revision.project_id,v_actor,
      p_title,p_source_file_id
    )||pg_catalog.jsonb_build_object(
      'sourceRevisionId',p_source_revision_id
    );
  else
    v_result:=private.lukas_drawing_create_from_template(
      p_source_revision_id,p_title,p_source_file_id
    );
  end if;
  insert into private.lukas_drawing_template_clone_requests(
    actor_id,client_request_id,request_hash,document_id,revision_id
  ) values(
    v_actor,p_client_request_id,v_hash,
    (v_result->>'documentId')::uuid,(v_result->>'revisionId')::uuid
  );
  return v_result;
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when others then
    raise exception using errcode='P1R01',
      message='Drawing template target is unavailable';
end;
$$;

create or replace function public.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid,
  p_client_request_id uuid
) returns jsonb language sql security definer set search_path='' as $$
  select private.lukas_drawing_create_from_template(
    p_source_revision_id,p_title,p_source_file_id,p_client_request_id
  )
$$;

revoke all on function
  private.lukas_drawing_template_clone_ledger_append_guard(),
  private.lukas_drawing_clone_binding_guard(),
  private.lukas_drawing_clone_v1_snapshot(jsonb,uuid,uuid,text,uuid),
  private.lukas_drawing_create_from_template(uuid,text,uuid,uuid),
  private.lukas_drawing_create_from_template(uuid,text,uuid),
  private.lukas_drawing_create_from_template_pre_final_authority(uuid,text,uuid,uuid),
  private.lukas_drawing_create_from_template_pre_clone_ledger(uuid,text,uuid,uuid),
  private.lukas_drawing_create_from_template_pre_v1_snapshot(uuid,text,uuid,uuid),
  private.lukas_drawing_create_from_template_pre_snapshot_authority(uuid,text,uuid),
  private.lukas_drawing_create_from_template_pre_snapshot_guard(uuid,text,uuid),
  private.lukas_drawing_create_from_template_pre_p2_contract_hardening(uuid,text,uuid),
  private.lukas_drawing_structure_action_valid_pre_final_lineage(jsonb,uuid),
  private.lukas_drawing_apply_operation_pre_final_lineage(uuid,uuid,text,jsonb,jsonb,jsonb)
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_structure_action_valid(jsonb,uuid),
  private.lukas_drawing_block_instance_lineage_guard()
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) from public,anon;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) to authenticated,service_role;
revoke all on function public.lukas_drawing_create_from_template(
  uuid,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_create_from_template(
  uuid,text,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_create_from_template(
  uuid,text,uuid,uuid
) to authenticated,service_role;
revoke all on table private.lukas_drawing_template_clone_requests
from public,anon,authenticated,service_role;

commit;
