begin;

alter table public.lukas_drawing_object_sources add column dwg_entity_json jsonb;

create function private.lukas_drawing_dwg_entity_payload_valid(p jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(pg_catalog.jsonb_typeof(p)='object'
    and p ?& array['analysisJobId','reportSha256','handle','ownerHandle','layerHandle','entityType','sourceLayer','unitCode','unitSource','importerVersion']
    and p-array['analysisJobId','reportSha256','handle','ownerHandle','layerHandle','entityType','sourceLayer','unitCode','unitSource','importerVersion']='{}'::jsonb
    and private.lukas_drawing_p2_uuid(p->'analysisJobId')
    and pg_catalog.jsonb_typeof(p->'reportSha256')='string' and p->>'reportSha256'~'^[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(p->'handle')='string' and p->>'handle'~'^[1-9A-F][0-9A-F]{0,15}$'
    and pg_catalog.jsonb_typeof(p->'ownerHandle')='string' and p->>'ownerHandle'~'^[1-9A-F][0-9A-F]{0,15}$'
    and pg_catalog.jsonb_typeof(p->'layerHandle')='string' and p->>'layerHandle'~'^[1-9A-F][0-9A-F]{0,15}$'
    and p->>'entityType' in('LINE','LWPOLYLINE','CIRCLE','ARC','TEXT')
    and pg_catalog.jsonb_typeof(p->'sourceLayer')='string'
    and pg_catalog.char_length(p->>'sourceLayer') between 1 and 255
    and p->>'sourceLayer'=pg_catalog.btrim(p->>'sourceLayer')
    and p->'unitCode' in('1'::jsonb,'2'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
    and p->>'unitSource' in('declared','user_selected') and p->'importerVersion'='1'::jsonb,false)
$$;

-- Keep the previous exact PDF/IFC/DXF constraint, adding one separate payload.
do $$ declare previous text; begin
  select pg_catalog.pg_get_expr(conbin,conrelid) into strict previous from pg_catalog.pg_constraint
    where conrelid='public.lukas_drawing_object_sources'::regclass and conname='lukas_drawing_object_sources_exact_payload_check';
  alter table public.lukas_drawing_object_sources drop constraint lukas_drawing_object_sources_exact_payload_check;
  execute 'alter table public.lukas_drawing_object_sources add constraint lukas_drawing_object_sources_exact_payload_check check (('
    ||previous||') and dwg_entity_json is null or (source_kind=''dwg_entity'' and private.lukas_drawing_dwg_entity_payload_valid(dwg_entity_json)'
    ||' and pdf_page_number is null and x is null and y is null and width is null and height is null and element_id is null and ifc_global_id is null and camera_json is null'
    ||' and dxf_entity_key is null and dxf_entity_type is null and dxf_source_layer is null and dxf_handle is null and dxf_unit_code is null and dxf_unit_source is null and dxf_importer_version is null))';
end $$;
alter table public.lukas_drawing_object_sources drop constraint lukas_drawing_object_sources_source_kind_check;
alter table public.lukas_drawing_object_sources add constraint lukas_drawing_object_sources_source_kind_check check(source_kind in('pdf_region','ifc_element','dxf_entity','dwg_entity'));

-- Migration-only exact-anchor edits preserve the installed wrapper chain. A
-- changed predecessor aborts the transaction instead of silently losing logic.
create function pg_temp.patch_native_dwg(p_signature text,p_old text,p_new text,p_count integer default 1)
returns void language plpgsql as $$ declare body text; occurrences integer; begin
  body:=pg_catalog.pg_get_functiondef(p_signature::regprocedure);
  occurrences:=(pg_catalog.length(body)-pg_catalog.length(pg_catalog.replace(body,p_old,'')))/pg_catalog.length(p_old);
  if occurrences<>p_count then raise exception 'Native CAD predecessor mismatch: %, expected %, got % for %',p_signature,p_count,occurrences,p_old; end if;
  execute pg_catalog.replace(body,p_old,p_new);
end $$;

select pg_temp.patch_native_dwg('private.lukas_drawing_source_json(uuid,uuid,uuid,boolean)',
  'select case s.source_kind', $n$select case s.source_kind
    when 'dwg_entity' then s.dwg_entity_json || pg_catalog.jsonb_build_object(
      'id',s.id,'objectId',s.object_id,'revisionId',s.revision_id,'sourceFileId',s.source_file_id,
      'sourceSha256',s.source_sha256,'sourceKind',s.source_kind,'version',s.version)$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_p6_source_anchor_json(uuid,uuid,uuid)',
  'select case a.source_kind', $n$select case a.source_kind
    when 'dwg_entity' then a.dwg_entity_json || pg_catalog.jsonb_build_object(
      'id',a.id,'sourceFileId',a.source_file_id,'sourceSha256',a.source_sha256,'sourceKind',a.source_kind,
      'pdfPageNumber',null,'x',null,'y',null,'width',null,'height',null,
      'elementId',null,'ifcGlobalId',null,'camera',null,'version',a.version)$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_structure_action_valid_pre_output_profile(jsonb,uuid)',
  $o$elsif v->>'sourceKind'='dxf_entity' then$o$, $n$elsif v->>'sourceKind'='dwg_entity' then
    return private.lukas_drawing_dwg_entity_payload_valid(v-array['id','objectId','revisionId','sourceFileId','sourceSha256','sourceKind','version']);
  elsif v->>'sourceKind'='dxf_entity' then$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_object_source_guard()',
  $o$or new.source_kind='dxf_entity' and f.kind='dxf'$o$,
  $n$or new.source_kind='dxf_entity' and f.kind='dxf'
        or new.source_kind='dwg_entity' and f.kind='dwg'$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_object_source_guard()',
  'and source.camera_json is not distinct from new.camera_json',
  'and source.camera_json is not distinct from new.camera_json and source.dwg_entity_json is not distinct from new.dwg_entity_json');
select pg_temp.patch_native_dwg('private.lukas_drawing_object_source_guard()',
  'or new.camera_json is distinct from old.camera_json',
  'or new.camera_json is distinct from old.camera_json or new.dwg_entity_json is distinct from old.dwg_entity_json');
select pg_temp.patch_native_dwg('private.lukas_drawing_apply_source_actions(uuid,uuid,uuid,jsonb,jsonb)',
  'camera_json,dxf_entity_key', 'camera_json,dwg_entity_json,dxf_entity_key');
select pg_temp.patch_native_dwg('private.lukas_drawing_apply_source_actions(uuid,uuid,uuid,jsonb,jsonb)',
  $o$nullif(v_entity->>'entityKey',''),nullif(v_entity->>'entityType',''),
          nullif(v_entity->>'sourceLayer',''),nullif(v_entity->>'handle',''),
          nullif(v_entity->>'unitCode','')::integer,
          nullif(v_entity->>'unitSource',''),
          nullif(v_entity->>'importerVersion','')::integer,$o$,
  $n$case when v_entity->>'sourceKind'='dwg_entity' then v_entity-array['id','objectId','revisionId','sourceFileId','sourceSha256','sourceKind','version'] end,
          case when v_entity->>'sourceKind'='dxf_entity' then v_entity->>'entityKey' end,
          case when v_entity->>'sourceKind'='dxf_entity' then v_entity->>'entityType' end,
          case when v_entity->>'sourceKind'='dxf_entity' then v_entity->>'sourceLayer' end,
          case when v_entity->>'sourceKind'='dxf_entity' then v_entity->>'handle' end,
          case when v_entity->>'sourceKind'='dxf_entity' then (v_entity->>'unitCode')::integer end,
          case when v_entity->>'sourceKind'='dxf_entity' then v_entity->>'unitSource' end,
          case when v_entity->>'sourceKind'='dxf_entity' then (v_entity->>'importerVersion')::integer end,$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_create_from_template(uuid,text,uuid)',
  'camera_json,dxf_entity_key','camera_json,dwg_entity_json,dxf_entity_key');
select pg_temp.patch_native_dwg('private.lukas_drawing_create_from_template(uuid,text,uuid)',
  'source.element_id,source.ifc_global_id,source.camera_json,',
  'source.element_id,source.ifc_global_id,source.camera_json,source.dwg_entity_json,');
-- Clone custom layers visible/unlocked while their objects materialize. Restoring
-- source state is a real guarded update, so changed layers finish at version 2.
select pg_temp.patch_native_dwg('private.lukas_drawing_create_from_template_pre_p2_contract_hardening(uuid,text,uuid)',
  'v_row.sort_order,v_row.visible,v_row.locked,v_row.system_kind,1,v_actor',
  $n$v_row.sort_order,case when v_row.system_kind='custom' then true else v_row.visible end,case when v_row.system_kind='custom' then false else v_row.locked end,v_row.system_kind,1,v_actor$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_create_from_template_pre_p2_contract_hardening(uuid,text,uuid)',
  $o$return pg_catalog.jsonb_build_object('documentId',v_document_id,'revisionId',v_revision_id,$o$,
  $n$update public.lukas_drawing_layers child set visible=parent.visible,locked=parent.locked,version=child.version+1
  from public.lukas_drawing_layers parent
  where parent.revision_id=p_source_revision_id and parent.system_kind='custom' and (parent.locked or not parent.visible)
    and child.id=(v_layer_map->>parent.id::text)::uuid and child.revision_id=v_revision_id;
  return pg_catalog.jsonb_build_object('documentId',v_document_id,'revisionId',v_revision_id,$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_apply_operation_pre_p4_semantic_objects(uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid)',
  $o$or s->>'sourceKind'='dxf_entity' and f.kind='dxf'$o$,
  $n$or s->>'sourceKind'='dxf_entity' and f.kind='dxf' or s->>'sourceKind'='dwg_entity' and f.kind='dwg'$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_dxf_history_group_valid(jsonb)',
  $o$p_group->>'kind'='dxf_import'$o$, $n$p_group->>'kind' in('dxf_import','dwg_import')$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_dxf_import_phase(jsonb,jsonb,jsonb)',
  $o$a.value->'entity'->>'sourceKind'<>'dxf_entity'$o$, $n$a.value->'entity'->>'sourceKind' not in('dxf_entity','dwg_entity')$n$,2);
select pg_temp.patch_native_dwg('private.lukas_drawing_apply_dxf_import_operation(uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid)',
  $o$v_source->>'sourceKind'<>'dxf_entity'$o$, $n$v_source->>'sourceKind' not in('dxf_entity','dwg_entity')$n$,2);

-- Homogeneous source groups are mandatory even when the shared CAD executor is
-- called through an ordinary operation rather than the issuer.
select pg_temp.patch_native_dwg('private.lukas_drawing_dxf_import_phase(jsonb,jsonb,jsonb)',
  'v_count:=pg_catalog.jsonb_array_length', $n$if exists(
    select 1 from pg_catalog.jsonb_array_elements((p_forward->'actions')||(p_inverse->'actions')) a
    where a->>'kind'='put_source' and a->'entity'->>'sourceKind' is distinct from
      case when p_forward->'historyGroup'->>'kind'='dwg_import' then 'dwg_entity' else 'dxf_entity' end
  ) then return null; end if;
  v_count:=pg_catalog.jsonb_array_length$n$);

-- Native identity is immutable report-backed lineage, including on clone and
-- restore. The analyzed job target revision deliberately need not equal a clone.
create function private.lukas_drawing_dwg_source_report_matches(p_project uuid,p_file uuid,p_sha text,p jsonb)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.lukas_drawing_dwg_entity_payload_valid(p) and exists(
    select 1 from public.lukas_drawing_native_dwg_import_jobs j
    join public.lukas_drawing_native_dwg_import_results r on r.job_id=j.id and r.project_id=j.project_id
    cross join lateral pg_catalog.jsonb_array_elements(r.report_text::jsonb->'entities') e
    join lateral pg_catalog.jsonb_array_elements(r.report_text::jsonb->'layers') l on l->>'handle'=e->>'layerHandle'
    where j.id=(p->>'analysisJobId')::uuid and j.project_id=p_project and j.status='analyzed'
      and j.scope->>'sourceFileId'=p_file::text and j.scope->>'sourceSha256'=p_sha
      and r.report_sha256=p->>'reportSha256' and e->>'handle'=p->>'handle'
      and e->>'ownerHandle'=p->>'ownerHandle' and e->>'ownerHandle'=r.report_text::jsonb->>'modelSpaceHandle'
      and e->>'layerHandle'=p->>'layerHandle' and e->>'type'=p->>'entityType' and l->>'name'=p->>'sourceLayer'
      and (r.report_text::jsonb->'unitCode' not in('1'::jsonb,'2'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb)
        or j.scope->'unitOverride'='null'::jsonb or j.scope->'unitOverride'=r.report_text::jsonb->'unitCode')
      and p->'unitCode'=case when r.report_text::jsonb->'unitCode' in('1'::jsonb,'2'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb) then r.report_text::jsonb->'unitCode' else j.scope->'unitOverride' end
      and p->>'unitSource'=case when r.report_text::jsonb->'unitCode' in('1'::jsonb,'2'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb) then 'declared' else 'user_selected' end
  ),false)
$$;
create function private.lukas_drawing_dwg_source_guard()
returns trigger language plpgsql security definer set search_path='' as $$ begin
  if new.source_kind='dwg_entity' and private.lukas_drawing_dwg_source_report_matches(new.project_id,new.source_file_id,new.source_sha256,new.dwg_entity_json) is not true then
    raise exception using errcode='P1C01',message='Native DWG source report identity is invalid'; end if;
  return new;
end $$;
create trigger lukas_drawing_z_dwg_source_guard before insert or update on public.lukas_drawing_object_sources for each row execute function private.lukas_drawing_dwg_source_guard();

create function public.lukas_drawing_native_dwg_import_context(p_job_id uuid,p_include_result boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_import_jobs%rowtype; status jsonb; result jsonb;
begin
  select * into j from public.lukas_drawing_native_dwg_import_jobs where id=p_job_id and requested_by=(select auth.uid());
  if not found then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  status:=public.lukas_drawing_native_dwg_import_status(j.scope,j.id);
  if status is null then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  if p_include_result and j.status='analyzed' then result:=public.lukas_drawing_native_dwg_import_result(j.scope,j.id); end if;
  return pg_catalog.jsonb_build_object('scope',j.scope,'status',status,'result',result);
end $$;

-- One issuer ledger/phase validator/digest consumer for both explicit CAD kinds.
alter function public.lukas_drawing_attest_dxf_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb) set schema private;
alter function private.lukas_drawing_attest_dxf_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb) rename to lukas_drawing_attest_cad_import_plan;
select pg_temp.patch_native_dwg('private.lukas_drawing_attest_cad_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
  $o$source.kind='dxf'$o$, $n$source.kind=case when p_operations->0->'forward'->'historyGroup'->>'kind'='dwg_import' then 'dwg' else 'dxf' end$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_attest_cad_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
  $o$->>'sourceKind'='dxf_entity'$o$, $n$->>'sourceKind' in('dxf_entity','dwg_entity')$n$,3);
select pg_temp.patch_native_dwg('private.lukas_drawing_attest_cad_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
  $o$->>'kind'<>'dxf_import'$o$, $n$->>'kind' is distinct from v_group->>'kind'$n$,2);
create function public.lukas_drawing_attest_dxf_import_plan(p_actor_id uuid,p_project_id uuid,p_revision_id uuid,p_canvas_id uuid,p_source_file_id uuid,p_source_sha256 text,p_operations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$ begin
  if p_operations->0->'forward'->'historyGroup'->>'kind' is distinct from 'dxf_import' then raise exception using errcode='P1C01',message='DXF plan group is invalid'; end if;
  return private.lukas_drawing_attest_cad_import_plan(p_actor_id,p_project_id,p_revision_id,p_canvas_id,p_source_file_id,p_source_sha256,p_operations);
end $$;
select pg_temp.patch_native_dwg('private.lukas_drawing_dxf_plan_attestation_protected(public.lukas_drawing_operations)',
  $o$->>'kind'='dxf_import'$o$, $n$->>'kind' in('dxf_import','dwg_import')$n$,2);
select pg_temp.patch_native_dwg('private.lukas_drawing_dxf_plan_attestation_protected(public.lukas_drawing_operations)',
  $o$->>'sourceKind'='dxf_entity'$o$, $n$->>'sourceKind' in('dxf_entity','dwg_entity')$n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_dxf_plan_attestation_guard()',
  $o$->>'sourceKind'='dxf_entity'$o$, $n$->>'sourceKind' in('dxf_entity','dwg_entity')$n$);

alter table private.lukas_drawing_dxf_plan_attestations add column analysis_job_id uuid references public.lukas_drawing_native_dwg_import_results(job_id) on delete restrict;
alter table private.lukas_drawing_dxf_plan_attestations enable row level security;
alter table private.lukas_drawing_dxf_plan_attestations force row level security;
select pg_temp.patch_native_dwg('private.lukas_drawing_attest_cad_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
  $o$consumed_operation_id,consumed_at
      ) values($o$, $n$analysis_job_id,consumed_operation_id,consumed_at
      ) values($n$);
select pg_temp.patch_native_dwg('private.lukas_drawing_attest_cad_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb)',
  'case when v_existing.id is null then null else v_existing.id end,',
  $n$case when v_group->>'kind'='dwg_import' then (pg_catalog.jsonb_path_query_first(p_operations,'$[*].forward.actions[*].entity.analysisJobId')#>>'{}')::uuid end,
        case when v_existing.id is null then null else v_existing.id end,$n$);
create function private.lukas_drawing_cad_attestation_evidence_guard()
returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if tg_op='DELETE' then
    if private.lukas_drawing_native_dwg_delete_allowed(old.project_id,tg_relid) then return old; end if;
    raise exception using errcode='42501',message='CAD plan evidence is retained';
  end if;
  if (pg_catalog.to_jsonb(new)-array['consumed_operation_id','consumed_at']) is distinct from (pg_catalog.to_jsonb(old)-array['consumed_operation_id','consumed_at'])
    or old.consumed_operation_id is not null and new is distinct from old
    or new.consumed_operation_id is null or new.consumed_at is null then
    raise exception using errcode='42501',message='CAD plan evidence is immutable'; end if;
  return new;
end $$;
create trigger lukas_drawing_cad_attestation_evidence_guard before update or delete on private.lukas_drawing_dxf_plan_attestations for each row execute function private.lukas_drawing_cad_attestation_evidence_guard();

-- Existing clone ledger RESTRICT links prevented marked project retention from
-- closing over committed clones. Keep its project identity and permit only the
-- same owner-only, nested, exact-project cascade used by native evidence.
alter table private.lukas_drawing_template_clone_requests add column project_id uuid;
drop trigger lukas_drawing_template_clone_ledger_append_guard on private.lukas_drawing_template_clone_requests;
update private.lukas_drawing_template_clone_requests ledger set project_id=document.project_id
  from public.lukas_drawing_documents document where document.id=ledger.document_id;
alter table private.lukas_drawing_template_clone_requests alter column project_id set not null;
alter table private.lukas_drawing_template_clone_requests
  add constraint lukas_drawing_template_clone_requests_project_id_fkey foreign key(project_id) references public.lukas_qto_projects(id) on delete cascade,
  drop constraint lukas_drawing_template_clone_requests_document_id_fkey,
  add constraint lukas_drawing_template_clone_requests_document_id_fkey foreign key(document_id) references public.lukas_drawing_documents(id) on delete cascade,
  drop constraint lukas_drawing_template_clone_requests_revision_id_fkey,
  add constraint lukas_drawing_template_clone_requests_revision_id_fkey foreign key(revision_id) references public.lukas_drawing_revisions(id) on delete cascade;
create or replace function private.lukas_drawing_template_clone_ledger_append_guard()
returns trigger language plpgsql security invoker set search_path='' as $$ declare project uuid; begin
  if tg_op='INSERT' then
    select d.project_id into project from public.lukas_drawing_documents d
      join public.lukas_drawing_revisions r on r.document_id=d.id and r.project_id=d.project_id
      where d.id=new.document_id and r.id=new.revision_id;
    if project is null or new.project_id is not null and new.project_id<>project then
      raise exception using errcode='P1C01',message='Drawing template clone project is invalid'; end if;
    new.project_id:=project; return new;
  end if;
  if tg_op='DELETE' and private.lukas_drawing_native_dwg_delete_allowed(old.project_id,tg_relid) then return old; end if;
  raise exception using errcode='P1C01',message='Drawing template clone ledger is append-only';
end $$;
create trigger lukas_drawing_template_clone_ledger_append_guard before insert or update or delete on private.lukas_drawing_template_clone_requests for each row execute function private.lukas_drawing_template_clone_ledger_append_guard();
alter table private.lukas_drawing_template_clone_requests enable row level security;
alter table private.lukas_drawing_template_clone_requests force row level security;
do $$ declare item record; total integer:=0; definition text; begin
  for item in select conname,pg_catalog.pg_get_constraintdef(oid) definition from pg_catalog.pg_constraint
    where conrelid='private.lukas_drawing_snapshot_restore_requests'::regclass and contype='f'
      and confrelid in('public.lukas_drawing_documents'::regclass,'public.lukas_drawing_revisions'::regclass)
  loop
    if pg_catalog.strpos(item.definition,'ON DELETE RESTRICT')=0 then raise exception 'Restore ledger retention predecessor changed'; end if;
    definition:=pg_catalog.replace(item.definition,'ON DELETE RESTRICT','ON DELETE CASCADE');
    execute pg_catalog.format('alter table private.lukas_drawing_snapshot_restore_requests drop constraint %I, add constraint %I %s',item.conname,item.conname,definition);
    total:=total+1;
  end loop;
  if total<>3 then raise exception 'Restore ledger retention predecessor count changed'; end if;
end $$;
create or replace function private.lukas_drawing_snapshot_restore_ledger_guard()
returns trigger language plpgsql security invoker set search_path='' as $$ begin
  if tg_op='DELETE' and private.lukas_drawing_native_dwg_delete_allowed(old.project_id,tg_relid) then return old; end if;
  raise exception using errcode='P3S01',message='Drawing snapshot restore ledger is append-only';
end $$;
alter table private.lukas_drawing_snapshot_restore_requests enable row level security;
alter table private.lukas_drawing_snapshot_restore_requests force row level security;

create function public.lukas_drawing_attest_dwg_import_plan(p_job_id uuid,p_operations jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_import_jobs%rowtype; r public.lukas_drawing_native_dwg_import_results%rowtype;
  sources jsonb; objects jsonb; layers jsonb; s jsonb; o jsonb; l jsonb; report jsonb; result jsonb;
  op jsonb; action jsonb; inverse_action jsonb; expected_inverse jsonb; phase text; native_layer jsonb; index integer; total integer; bases jsonb; final_ids text[]:=array[]::text[];
begin
  if private.lukas_drawing_native_dwg_import_service() is not true then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  j:=private.lukas_drawing_native_dwg_import_locked_job(p_job_id);
  if j.id is null or j.status<>'analyzed' then
    raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  perform 1 from public.lukas_drawing_revisions where id=(j.scope->>'revisionId')::uuid for update;
  -- A freeze can commit while the revision lock waits. Resolve current source
  -- and actor authority only after acquiring it, retaining project/job/revision order.
  if not found or private.lukas_drawing_native_dwg_import_source(j.requested_by,j.scope) is distinct from j.source then
    raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  select * into strict r from public.lukas_drawing_native_dwg_import_results where job_id=j.id;
  report:=r.report_text::jsonb;
  if pg_catalog.jsonb_typeof(p_operations) is distinct from 'array' or pg_catalog.jsonb_array_length(p_operations) not between 1 and 48
    or pg_catalog.octet_length(pg_catalog.convert_to(p_operations::text,'UTF8'))>3145728
    or p_operations->0->'forward'->'historyGroup'->>'kind' is distinct from 'dwg_import'
  then raise exception using errcode='P1C01',message='Native DWG plan is invalid'; end if;
  select coalesce(pg_catalog.jsonb_agg(a->'entity') filter(where a->>'kind'='put_source'),'[]'),
    coalesce(pg_catalog.jsonb_agg(a->'entity') filter(where a->>'kind'='put_object'),'[]'),
    coalesce(pg_catalog.jsonb_agg(a->'entity') filter(where a->>'kind'='put_layer' and a->'baseVersion'='null'),'[]')
    into sources,objects,layers
  from pg_catalog.jsonb_array_elements(p_operations) candidate cross join lateral pg_catalog.jsonb_array_elements(candidate->'forward'->'actions') a;
  if pg_catalog.jsonb_array_length(sources)=0 or pg_catalog.jsonb_array_length(sources)<>pg_catalog.jsonb_array_length(report->'entities')
    or pg_catalog.jsonb_array_length(sources)<>pg_catalog.jsonb_array_length(objects)
    or (select pg_catalog.count(distinct x->>'handle') from pg_catalog.jsonb_array_elements(sources) x)<>pg_catalog.jsonb_array_length(sources)
    or (select pg_catalog.count(distinct x->>'objectId') from pg_catalog.jsonb_array_elements(sources) x)<>pg_catalog.jsonb_array_length(sources)
    or (select pg_catalog.count(distinct x->>'id') from pg_catalog.jsonb_array_elements(sources) x)<>pg_catalog.jsonb_array_length(sources)
  then raise exception using errcode='P1C01',message='Native DWG plan coverage is invalid'; end if;
  if pg_catalog.jsonb_array_length(layers)<>pg_catalog.jsonb_array_length(report->'layers')
    or (select pg_catalog.count(distinct x->>'name') from pg_catalog.jsonb_array_elements(layers) x)<>pg_catalog.jsonb_array_length(layers)
    or (select pg_catalog.count(distinct x->>'id') from pg_catalog.jsonb_array_elements(layers) x)<>pg_catalog.jsonb_array_length(layers)
    or (select pg_catalog.count(distinct x->>'handle') from pg_catalog.jsonb_array_elements(report->'entities') x)<>pg_catalog.jsonb_array_length(sources)
    or report->'coverage'->'importedEntities' is distinct from pg_catalog.to_jsonb(pg_catalog.jsonb_array_length(sources))
  then raise exception using errcode='P1C01',message='Native DWG report coverage is invalid'; end if;
  for op in select value from pg_catalog.jsonb_array_elements(p_operations) loop
    phase:=private.lukas_drawing_dxf_import_phase(op->'baseVersions',op->'forward',op->'inverse');
    if phase is null or op ? 'historyAction' or op ? 'originalOperationId' then raise exception using errcode='P1C01',message='Native DWG initial phase is invalid'; end if;
    total:=pg_catalog.jsonb_array_length(op->'forward'->'actions'); bases:='{}';
    for index in 0..total-1 loop
      action:=op->'forward'->'actions'->index;
      inverse_action:=op->'inverse'->'actions'->(total-index-1);
      if private.lukas_drawing_structure_action_valid(action,(j.scope->>'revisionId')::uuid) is not true then raise exception using errcode='P1C01',message='Native DWG action schema is invalid'; end if;
      if phase='object_source_create' and index%2=1
        and action->'entity'->>'objectId' is distinct from op->'forward'->'actions'->(index-1)->'entity'->>'id'
      then raise exception using errcode='P1C01',message='Native DWG object-source pair is invalid'; end if;
      if phase in('layer_create','object_source_create') then
        expected_inverse:=pg_catalog.jsonb_build_object('kind',pg_catalog.replace(action->>'kind','put_','delete_'),'id',action->'entity'->'id','baseVersion',1);
        if action->'entity'->'version' is distinct from '1'::jsonb then raise exception using errcode='P1C01',message='Native DWG initial version is invalid'; end if;
      elsif phase='layer_finalize' then
        select x into l from pg_catalog.jsonb_array_elements(layers) x where x->>'id'=action->'entity'->>'id';
        if l is null or action->'baseVersion' is distinct from '1'::jsonb
          or ((action->'entity')-array['visible','locked']) is distinct from (l-array['visible','locked'])
          or action->'entity'->>'id'=any(final_ids) then raise exception using errcode='P1C01',message='Native DWG layer finalization is invalid'; end if;
        final_ids:=pg_catalog.array_append(final_ids,action->'entity'->>'id');
        bases:=bases||pg_catalog.jsonb_build_object(action->'entity'->>'id',1);
        expected_inverse:=pg_catalog.jsonb_build_object('kind','put_layer','entity',l,'baseVersion',2);
      else raise exception using errcode='P1C01',message='Native DWG initial phase is invalid'; end if;
      if inverse_action is distinct from expected_inverse then raise exception using errcode='P1C01',message='Native DWG inverse is not exact'; end if;
      if action->>'kind'='put_layer' then
        select x into native_layer from pg_catalog.jsonb_array_elements(report->'layers') x where x->>'name'=action->'entity'->>'name';
        if native_layer is null or action->'entity'->>'canvasId' is distinct from j.scope->>'canvasId'
          or action->'entity'->>'systemKind' is distinct from 'custom'
          or (phase='layer_create' and (action->'entity'->'visible' is distinct from 'true'::jsonb or action->'entity'->'locked' is distinct from 'false'::jsonb))
          or (phase='layer_finalize' and (action->'entity'->'visible' is distinct from native_layer->'visible' or action->'entity'->'locked' is distinct from native_layer->'locked'))
        then raise exception using errcode='P1C01',message='Native DWG report layer state is invalid'; end if;
      end if;
    end loop;
    if op->'baseVersions' is distinct from bases then raise exception using errcode='P1C01',message='Native DWG phase bases are invalid'; end if;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_array_elements(layers) candidate join lateral pg_catalog.jsonb_array_elements(report->'layers') n on n->>'name'=candidate->>'name'
    where (n->'visible'='false'::jsonb or n->'locked'='true'::jsonb) and not (candidate->>'id'=any(final_ids))) then
    raise exception using errcode='P1C01',message='Native DWG layer finalization is incomplete'; end if;
  for s in select value from pg_catalog.jsonb_array_elements(sources) loop
    if s->>'sourceKind' is distinct from 'dwg_entity' or s->>'analysisJobId' is distinct from j.id::text or s->>'reportSha256' is distinct from r.report_sha256
      or s->>'sourceFileId' is distinct from j.scope->>'sourceFileId' or s->>'sourceSha256' is distinct from j.scope->>'sourceSha256'
      or private.lukas_drawing_structure_action_valid(pg_catalog.jsonb_build_object('kind','put_source','entity',s,'baseVersion',null),(j.scope->>'revisionId')::uuid) is not true
      or private.lukas_drawing_dwg_source_report_matches(j.project_id,(j.scope->>'sourceFileId')::uuid,j.scope->>'sourceSha256',s-array['id','objectId','revisionId','sourceFileId','sourceSha256','sourceKind','version']) is not true
    then raise exception using errcode='P1C01',message='Native DWG plan source identity is invalid'; end if;
    select x into o from pg_catalog.jsonb_array_elements(objects) x where x->>'id'=s->>'objectId';
    select x into l from pg_catalog.jsonb_array_elements(layers) x where x->>'id'=o->>'layerId';
    if o is null or l is null or l->>'name' is distinct from s->>'sourceLayer'
      or o->'geometry'->>'type' is distinct from (case s->>'entityType' when 'LWPOLYLINE' then 'polyline' else pg_catalog.lower(s->>'entityType') end)
      or private.lukas_drawing_structure_action_valid(pg_catalog.jsonb_build_object('kind','put_object','entity',o,'baseVersion',null),(j.scope->>'revisionId')::uuid) is not true
    then raise exception using errcode='P1C01',message='Native DWG plan object binding is invalid'; end if;
  end loop;
  if exists(select 1 from private.lukas_drawing_dxf_plan_attestations a where a.revision_id=(j.scope->>'revisionId')::uuid
    and a.plan_id=(p_operations->0->'forward'->'historyGroup'->>'id')::uuid and a.analysis_job_id is distinct from j.id) then
    raise exception using errcode='P1C01',message='Native DWG plan analysis identity conflicts'; end if;
  result:=private.lukas_drawing_attest_cad_import_plan(j.requested_by,j.project_id,(j.scope->>'revisionId')::uuid,(j.scope->>'canvasId')::uuid,(j.scope->>'sourceFileId')::uuid,j.scope->>'sourceSha256',p_operations);
  return result;
exception when sqlstate 'PNI01' then raise; when sqlstate 'P1C01' then raise; when others then raise exception using errcode='P1C01',message='Native DWG canonical plan conflicts';
end $$;

revoke all on function private.lukas_drawing_dwg_entity_payload_valid(jsonb),private.lukas_drawing_dwg_source_report_matches(uuid,uuid,text,jsonb),private.lukas_drawing_dwg_source_guard(),private.lukas_drawing_attest_cad_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_cad_attestation_evidence_guard(),private.lukas_drawing_template_clone_ledger_append_guard(),private.lukas_drawing_snapshot_restore_ledger_guard() from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_native_dwg_import_context(uuid,boolean),public.lukas_drawing_attest_dwg_import_plan(uuid,jsonb),public.lukas_drawing_attest_dxf_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_native_dwg_import_context(uuid,boolean) to authenticated;
grant execute on function public.lukas_drawing_attest_dwg_import_plan(uuid,jsonb),public.lukas_drawing_attest_dxf_import_plan(uuid,uuid,uuid,uuid,uuid,text,jsonb) to service_role;
drop function pg_temp.patch_native_dwg(text,text,text,integer);
commit;
