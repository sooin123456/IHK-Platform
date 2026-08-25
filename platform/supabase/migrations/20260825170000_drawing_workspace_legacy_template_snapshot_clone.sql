begin;

create or replace function private.lukas_drawing_clone_v1_snapshot(
  p_snapshot jsonb,p_project_id uuid,p_actor uuid,p_title text,p_source_file_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_document uuid; v_revision uuid; v_page jsonb; v_layer jsonb; v_object jsonb; v_source jsonb;
  v_page_map jsonb:='{}'; v_canvas_map jsonb:='{}'; v_layer_map jsonb:='{}'; v_object_map jsonb:='{}';
  v_page_id uuid; v_canvas_id uuid; v_layer_id uuid; v_object_id uuid; v_issue jsonb;
begin
  if jsonb_typeof(p_snapshot) is distinct from 'object'
    or not (p_snapshot ?& array['schemaVersion','revision','pages','layers','objects','operationSequence'])
    or p_snapshot-array['schemaVersion','revision','pages','layers','objects','operationSequence']<>'{}'::jsonb
    or p_snapshot->>'schemaVersion' is distinct from '1'
    or jsonb_typeof(p_snapshot->'revision') is distinct from 'object'
    or exists(select 1 from unnest(array['pages','layers','objects']) k where jsonb_typeof(p_snapshot->k) is distinct from 'array') then
    raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  insert into public.lukas_drawing_documents(project_id,title,created_by) values(p_project_id,btrim(p_title),p_actor) returning id into v_document;
  insert into public.lukas_drawing_revisions(document_id,project_id,sequence,status,version,created_by)
    values(v_document,p_project_id,1,'draft',1,p_actor) returning id into v_revision;
  for v_page in select value from jsonb_array_elements(p_snapshot->'pages') loop
    if jsonb_typeof(v_page)<>'object' or not (v_page ?& array['id','name','pageNumber','widthMm','heightMm','backgroundSourceFileId','backgroundSourceSha256','backgroundPdfPage','calibration'])
      or v_page-array['id','name','pageNumber','widthMm','heightMm','backgroundSourceFileId','backgroundSourceSha256','backgroundPdfPage','calibration']<>'{}'::jsonb
      or (v_page->>'id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or jsonb_typeof(v_page->'name')<>'string' or jsonb_typeof(v_page->'pageNumber')<>'number'
      or jsonb_typeof(v_page->'widthMm')<>'number' or jsonb_typeof(v_page->'heightMm')<>'number' then
      raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
    v_page_id:=extensions.gen_random_uuid(); v_canvas_id:=extensions.gen_random_uuid();
    v_page_map:=v_page_map||jsonb_build_object(v_page->>'id',v_page_id); v_canvas_map:=v_canvas_map||jsonb_build_object(v_page->>'id',v_canvas_id);
    insert into public.lukas_drawing_pages(id,revision_id,project_id,name,page_number,sort_order,width_mm,height_mm,background_source_file_id,background_source_sha256,background_pdf_page,calibration,version)
      values(v_page_id,v_revision,p_project_id,v_page->>'name',(v_page->>'pageNumber')::int,(v_page->>'pageNumber')::int-1,(v_page->>'widthMm')::numeric,(v_page->>'heightMm')::numeric,
        case when p_source_file_id::text=v_page->>'backgroundSourceFileId' then p_source_file_id end,
        case when p_source_file_id::text=v_page->>'backgroundSourceFileId' then v_page->>'backgroundSourceSha256' end,
        case when p_source_file_id::text=v_page->>'backgroundSourceFileId' then (v_page->>'backgroundPdfPage')::int end,
        case when p_source_file_id::text=v_page->>'backgroundSourceFileId' then v_page->'calibration' end,1);
    insert into public.lukas_drawing_canvases(id,page_id,revision_id,project_id,name,space_kind,width_mm,height_mm,sort_order,version,created_by)
      values(v_canvas_id,v_page_id,v_revision,p_project_id,'Paper','paper',(v_page->>'widthMm')::numeric,(v_page->>'heightMm')::numeric,0,1,p_actor);
  end loop;
  if v_page_map='{}'::jsonb then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  for v_layer in select value from jsonb_array_elements(p_snapshot->'layers') loop
    if jsonb_typeof(v_layer)<>'object' or not (v_layer ?& array['id','pageId','name','sortOrder','visible','locked','systemKind','version'])
      or v_layer-array['id','pageId','name','sortOrder','visible','locked','systemKind','version']<>'{}'::jsonb
      or (v_layer->>'id') !~* '^[0-9a-f-]{36}$' or (v_layer->>'pageId') !~* '^[0-9a-f-]{36}$'
      or (v_page_map->>(v_layer->>'pageId')) is null then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
    v_layer_id:=extensions.gen_random_uuid(); v_layer_map:=v_layer_map||jsonb_build_object(v_layer->>'id',v_layer_id);
    insert into public.lukas_drawing_layers(id,page_id,canvas_id,revision_id,project_id,name,sort_order,visible,locked,system_kind,version,created_by)
      values(v_layer_id,(v_page_map->>(v_layer->>'pageId'))::uuid,(v_canvas_map->>(v_layer->>'pageId'))::uuid,v_revision,p_project_id,v_layer->>'name',(v_layer->>'sortOrder')::int,(v_layer->>'visible')::boolean,(v_layer->>'locked')::boolean,v_layer->>'systemKind',1,p_actor);
  end loop;
  for v_page in select value from jsonb_array_elements(p_snapshot->'pages') loop
    if not exists(select 1 from public.lukas_drawing_layers l where l.revision_id=v_revision and l.page_id=(v_page_map->>(v_page->>'id'))::uuid and l.visible and not l.locked and l.system_kind<>'source') then
      insert into public.lukas_drawing_layers(page_id,canvas_id,revision_id,project_id,name,sort_order,visible,locked,system_kind,version,created_by)
        values((v_page_map->>(v_page->>'id'))::uuid,(v_canvas_map->>(v_page->>'id'))::uuid,v_revision,p_project_id,'Work',999,true,false,'work',1,p_actor);
    end if;
  end loop;
  for v_object in select value from jsonb_array_elements(p_snapshot->'objects') loop
    if jsonb_typeof(v_object)<>'object' or not (v_object ?& array['id','lineageId','pageId','layerId','name','type','geometry','style','version','sources','issueIds'])
      or v_object-array['id','lineageId','pageId','layerId','name','type','geometry','style','version','sources','issueIds']<>'{}'::jsonb
      or (v_object->>'id') !~* '^[0-9a-f-]{36}$' or (v_object->>'lineageId') !~* '^[0-9a-f-]{36}$'
      or (v_page_map->>(v_object->>'pageId')) is null or (v_layer_map->>(v_object->>'layerId')) is null
      or jsonb_typeof(v_object->'geometry')<>'object' or jsonb_typeof(v_object->'style')<>'object'
      or jsonb_typeof(v_object->'sources')<>'array' or jsonb_typeof(v_object->'issueIds')<>'array' then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
    v_object_id:=extensions.gen_random_uuid(); v_object_map:=v_object_map||jsonb_build_object(v_object->>'id',v_object_id);
    insert into public.lukas_drawing_objects(id,lineage_id,page_id,layer_id,revision_id,project_id,name,object_type,geometry,style,status,version,created_by,updated_by)
      values(v_object_id,(v_object->>'lineageId')::uuid,(v_page_map->>(v_object->>'pageId'))::uuid,(v_layer_map->>(v_object->>'layerId'))::uuid,v_revision,p_project_id,v_object->>'name',v_object->>'type',v_object->'geometry',v_object->'style','active',1,p_actor,p_actor);
    for v_source in select value from jsonb_array_elements(v_object->'sources') loop
      if jsonb_typeof(v_source)<>'object' or not (v_source ?& array['id','sourceFileId','sourceSha256','sourceKind','pdfPageNumber','x','y','width','height','elementId','ifcGlobalId','camera']) then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
      if p_source_file_id::text=v_source->>'sourceFileId' then insert into public.lukas_drawing_object_sources(object_id,revision_id,project_id,source_file_id,source_sha256,source_kind,pdf_page_number,x,y,width,height,element_id,ifc_global_id,camera_json,created_by)
        values(v_object_id,v_revision,p_project_id,p_source_file_id,v_source->>'sourceSha256',v_source->>'sourceKind',nullif(v_source->>'pdfPageNumber','')::int,nullif(v_source->>'x','')::numeric,nullif(v_source->>'y','')::numeric,nullif(v_source->>'width','')::numeric,nullif(v_source->>'height','')::numeric,nullif(v_source->>'elementId',''),nullif(v_source->>'ifcGlobalId',''),v_source->'camera',p_actor); end if;
    end loop;
    for v_issue in select value from jsonb_array_elements(v_object->'issueIds') loop
      if jsonb_typeof(v_issue)<>'string' or v_issue#>>'{}' !~* '^[0-9a-f-]{36}$' then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
      -- Historic issue rows can be retired during a P2 upgrade; their UUIDs
      -- remain validated evidence, but no mutable live issue is consulted.
    end loop;
  end loop;
  return jsonb_build_object('documentId',v_document,'revisionId',v_revision);
exception when sqlstate 'P1C01' or sqlstate 'P1R01' then raise; when others then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end;
$$;

alter function private.lukas_drawing_create_from_template(uuid,text,uuid,uuid) rename to lukas_drawing_create_from_template_pre_v1_snapshot;
create or replace function private.lukas_drawing_create_from_template(p_source_revision_id uuid,p_title text,p_source_file_id uuid,p_client_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype; v_snapshot public.lukas_drawing_snapshots%rowtype; v_hash text; v_document public.lukas_drawing_documents%rowtype; v_result jsonb;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r where r.id=p_source_revision_id and v_actor is not null and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor') and r.status='approved' for update;
  if not found then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  select s.* into v_snapshot from public.lukas_drawing_snapshots s where s.revision_id=v_revision.id and s.project_id=v_revision.project_id and s.revision_version=v_revision.version;
  if not found then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  if v_snapshot.schema_version<>1 then return private.lukas_drawing_create_from_template_pre_v1_snapshot(p_source_revision_id,p_title,p_source_file_id,p_client_request_id); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_client_request_id::text,0));
  v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('sourceRevisionId',p_source_revision_id,'title',btrim(p_title),'sourceFileId',p_source_file_id)::text,'UTF8'),'sha256'),'hex');
  select * into v_document from public.lukas_drawing_documents where clone_requested_by=v_actor and clone_request_id=p_client_request_id for update;
  if found then if v_document.clone_request_hash is distinct from v_hash then raise exception using errcode='P1C01',message='Drawing template request ID does not match the stored request'; end if; return jsonb_build_object('documentId',v_document.id,'revisionId',(select id from public.lukas_drawing_revisions where document_id=v_document.id order by sequence limit 1),'sourceRevisionId',p_source_revision_id); end if;
  v_result:=private.lukas_drawing_clone_v1_snapshot(v_snapshot.canonical_json,v_revision.project_id,v_actor,p_title,p_source_file_id);
  update public.lukas_drawing_documents set clone_request_id=p_client_request_id,clone_requested_by=v_actor,clone_request_hash=v_hash where id=(v_result->>'documentId')::uuid;
  return v_result||jsonb_build_object('sourceRevisionId',p_source_revision_id);
exception when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise; when others then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end;
$$;
revoke all on function private.lukas_drawing_create_from_template_pre_v1_snapshot(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;

commit;
