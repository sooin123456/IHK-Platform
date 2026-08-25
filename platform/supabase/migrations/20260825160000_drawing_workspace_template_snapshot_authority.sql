begin;

-- This is deliberately the same canonical ordering as the P2 review writer.
-- Legacy approved v2 evidence had no block-instance lineage; it is compared in
-- that historical representation and is never rewritten.
create or replace function private.lukas_drawing_p2_canonical_snapshot(
  p_revision_id uuid,p_include_instance_lineage boolean
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_revision public.lukas_drawing_revisions%rowtype; v_sequence bigint;
begin
  select * into v_revision from public.lukas_drawing_revisions where id=p_revision_id;
  if not found then return null; end if;
  select coalesce(max(sequence),0) into v_sequence from public.lukas_drawing_operations where revision_id=p_revision_id;
  return jsonb_build_object(
    'schemaVersion',2,
    'revision',jsonb_build_object('id',v_revision.id,'documentId',v_revision.document_id,'projectId',v_revision.project_id,'sequence',v_revision.sequence,'version',v_revision.version),
    'sources',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'objectId',s.object_id,'sourceFileId',s.source_file_id,'sourceSha256',s.source_sha256,'sourceKind',s.source_kind,'pdfPageNumber',s.pdf_page_number,'x',s.x,'y',s.y,'width',s.width,'height',s.height,'elementId',s.element_id,'ifcGlobalId',s.ifc_global_id,'camera',s.camera_json) order by s.id) from public.lukas_drawing_object_sources s where s.revision_id=p_revision_id),'[]'::jsonb),
    'pages',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'revisionId',p.revision_id,'name',p.name,'sortOrder',p.sort_order,'version',p.version) order by p.sort_order,p.id) from public.lukas_drawing_pages p where p.revision_id=p_revision_id),'[]'::jsonb),
    'canvases',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'pageId',c.page_id,'name',c.name,'spaceKind',c.space_kind,'widthMillimeters',c.width_mm,'heightMillimeters',c.height_mm,'background',case when c.background_source_file_id is null then null else jsonb_build_object('sourceFileId',c.background_source_file_id,'sourceSha256',c.background_source_sha256,'pdfPageNumber',c.background_pdf_page,'calibration',c.calibration) end,'sortOrder',c.sort_order,'version',c.version) order by p.sort_order,c.sort_order,c.id) from public.lukas_drawing_canvases c join public.lukas_drawing_pages p on p.id=c.page_id where c.revision_id=p_revision_id),'[]'::jsonb),
    'layers',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'pageId',l.page_id,'canvasId',l.canvas_id,'name',l.name,'sortOrder',l.sort_order,'visible',l.visible,'locked',l.locked,'systemKind',l.system_kind,'version',l.version) order by p.sort_order,c.sort_order,l.sort_order,l.id) from public.lukas_drawing_layers l join public.lukas_drawing_canvases c on c.id=l.canvas_id join public.lukas_drawing_pages p on p.id=l.page_id where l.revision_id=p_revision_id),'[]'::jsonb),
    'objects',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'lineageId',o.lineage_id,'pageId',o.page_id,'layerId',o.layer_id,'name',o.name,'type',o.object_type,'geometry',o.geometry,'styleId',o.style_id,'style',o.style,'version',o.version) order by o.id) from public.lukas_drawing_objects o where o.revision_id=p_revision_id and o.status='active'),'[]'::jsonb),
    'styles',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'revisionId',s.revision_id,'name',s.name,'value',s.value,'version',s.version) order by s.id) from public.lukas_drawing_styles s where s.revision_id=p_revision_id),'[]'::jsonb),
    'blocks',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'revisionId',b.revision_id,'name',b.name,'primitives',b.primitives,'version',b.version) order by b.id) from public.lukas_drawing_blocks b where b.revision_id=p_revision_id),'[]'::jsonb),
    'blockInstances',coalesce((select jsonb_agg((jsonb_build_object('id',i.id,'blockId',i.block_id,'layerId',i.layer_id,'name',i.name,'origin',i.origin,'rotation',i.rotation,'scaleX',i.scale_x,'scaleY',i.scale_y,'version',i.version) || case when p_include_instance_lineage then jsonb_build_object('lineageId',i.lineage_id) else '{}'::jsonb end) order by i.id) from public.lukas_drawing_block_instances i where i.revision_id=p_revision_id),'[]'::jsonb),
    'propertySchemas',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'revisionId',s.revision_id,'name',s.name,'valueType',s.value_type,'enumOptions',s.enum_options,'appliesTo',s.applies_to,'required',s.required,'version',s.version) order by s.id) from public.lukas_drawing_property_schemas s where s.revision_id=p_revision_id),'[]'::jsonb),
    'propertyValues',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'schemaId',v.schema_id,'objectId',v.object_id,'blockInstanceId',v.block_instance_id,'value',v.value,'version',v.version) order by v.id) from public.lukas_drawing_property_values v where v.revision_id=p_revision_id),'[]'::jsonb),
    'tables',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'revisionId',t.revision_id,'name',t.name,'columns',t.columns_json,'rows',t.rows_json,'version',t.version) order by t.id) from public.lukas_drawing_tables t where t.revision_id=p_revision_id),'[]'::jsonb),
    'issues',coalesce((select jsonb_agg(jsonb_build_object('id',l.issue_id,'objectId',l.object_id) order by l.issue_id,l.object_id) from public.lukas_drawing_object_issue_links l where l.revision_id=p_revision_id),'[]'::jsonb),
    'operationSequence',v_sequence);
end;
$$;

alter function private.lukas_drawing_create_from_template(uuid,text,uuid)
  rename to lukas_drawing_create_from_template_pre_snapshot_authority;
create or replace function private.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype;
  v_snapshot public.lukas_drawing_snapshots%rowtype; v_legacy boolean; v_live jsonb; v_digest text;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r where r.id=p_source_revision_id
    and v_actor is not null and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
    and r.status='approved' for update;
  if not found then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  select s.* into v_snapshot from public.lukas_drawing_snapshots s where s.revision_id=v_revision.id
    and s.project_id=v_revision.project_id and s.revision_version=v_revision.version;
  if not found or jsonb_typeof(v_snapshot.canonical_json) is distinct from 'object'
    or v_snapshot.canonical_json->>'schemaVersion' is distinct from v_snapshot.schema_version::text then
    raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  if v_snapshot.schema_version=2 then
    if not (v_snapshot.canonical_json ?& array['schemaVersion','revision','sources','pages','canvases','layers','objects','styles','blocks','blockInstances','propertySchemas','propertyValues','tables','issues','operationSequence'])
      or v_snapshot.canonical_json-array['schemaVersion','revision','sources','pages','canvases','layers','objects','styles','blocks','blockInstances','propertySchemas','propertyValues','tables','issues','operationSequence']<>'{}'::jsonb
      or exists(select 1 from unnest(array['sources','pages','canvases','layers','objects','styles','blocks','blockInstances','propertySchemas','propertyValues','tables','issues']) k where jsonb_typeof(v_snapshot.canonical_json->k) is distinct from 'array') then
      raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
    select exists(select 1 from jsonb_array_elements(v_snapshot.canonical_json->'blockInstances') x where not (x ? 'lineageId')) into v_legacy;
    if v_legacy and exists(select 1 from jsonb_array_elements(v_snapshot.canonical_json->'blockInstances') x where x ? 'lineageId') then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
    v_live:=private.lukas_drawing_p2_canonical_snapshot(v_revision.id,not v_legacy);
    v_digest:=encode(extensions.digest(convert_to(v_live::text,'UTF8'),'sha256'),'hex');
    if v_live is distinct from v_snapshot.canonical_json or v_digest is distinct from v_snapshot.sha256 then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  end if;
  return private.lukas_drawing_create_from_template_pre_snapshot_authority(p_source_revision_id,p_title,p_source_file_id);
exception when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
 when others then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end;
$$;
revoke all on function private.lukas_drawing_create_from_template_pre_snapshot_authority(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_create_from_template(uuid,text,uuid) from public,anon,authenticated,service_role;

commit;
