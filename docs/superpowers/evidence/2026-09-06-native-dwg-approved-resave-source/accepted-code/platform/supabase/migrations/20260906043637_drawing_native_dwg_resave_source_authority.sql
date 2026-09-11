begin;

-- Read-only imported authority is separate from source-free native export.
create function private.lukas_drawing_native_dwg_resave_source_for_actor(
  p_actor_id uuid,p_scope jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare q record; approved jsonb; frozen jsonb; live jsonb; anchor jsonb;
declare j public.lukas_drawing_native_dwg_import_jobs%rowtype;
declare result public.lukas_drawing_native_dwg_import_results%rowtype;
declare verified jsonb; report jsonb; k text;
begin
  select * into q from private.lukas_drawing_native_dwg_scope(p_scope);
  if not found then return null; end if;
  select pg_catalog.jsonb_build_object(
    'projectId',r.project_id,'documentId',r.document_id,'canvasId',c.id,
    'revision',pg_catalog.jsonb_build_object('id',r.id,'sequence',r.sequence,'version',r.version,'status',r.status),
    'snapshot',pg_catalog.jsonb_build_object('sha256',s.sha256,'schemaVersion',s.schema_version,
      'operationSequence',s.operation_sequence,'canonicalJsonText',s.canonical_json::text),
    'approvalDecision','approved'
  ),s.canonical_json into approved,frozen
  from auth.users actor
  join public.lukas_drawing_revisions r on r.id=q.revision_id
    and r.document_id=q.document_id and r.project_id=q.project_id and r.version=q.revision_version
  join public.lukas_qto_projects project on project.id=r.project_id
  join public.lukas_drawing_documents d on d.id=r.document_id and d.project_id=r.project_id
  join public.lukas_drawing_snapshots s on s.revision_id=r.id and s.project_id=r.project_id
    and s.revision_version=r.version and s.sha256=q.snapshot_sha256
  join public.lukas_drawing_canvases c on c.id=q.canvas_id and c.revision_id=r.id and c.project_id=r.project_id
  where actor.id=p_actor_id and not coalesce(actor.is_anonymous,false)
    and nullif(pg_catalog.to_jsonb(actor)->>'deleted_at','') is null
    and (nullif(pg_catalog.to_jsonb(actor)->>'banned_until','') is null
      or (pg_catalog.to_jsonb(actor)->>'banned_until')::timestamptz<=pg_catalog.clock_timestamp())
    and private.lukas_drawing_collaboration_capability_for_user(p_actor_id,project.id) is not null
    and private.lukas_qto_project_feature_active(project.id,'drawing_workspace')
    and project.archived_at is null and project.deletion_requested_at is null
    and nullif(pg_catalog.to_jsonb(d)->>'archived_at','') is null
    and nullif(pg_catalog.to_jsonb(d)->>'deleted_at','') is null
    and r.status in ('approved','superseded') and s.schema_version=2
    and s.operation_sequence between 0 and 9007199254740991
    and s.sha256=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(s.canonical_json::text,'UTF8'),'sha256'),'hex')
    and pg_catalog.octet_length(pg_catalog.convert_to(s.canonical_json::text,'UTF8'))<=20971520
    and exists(select 1 from public.lukas_drawing_revision_approvals a where a.revision_id=s.revision_id
      and a.project_id=s.project_id and a.subject_version=s.revision_version
      and a.snapshot_sha256=s.sha256 and a.decision='approved')
    and c.background_source_file_id is null and c.background_source_sha256 is null
    and c.background_pdf_page is null and c.calibration is null
    and s.canonical_json@>pg_catalog.jsonb_build_object('schemaVersion',2,
      'revision',pg_catalog.jsonb_build_object('id',r.id::text,'documentId',r.document_id::text,
        'projectId',r.project_id::text,'sequence',r.sequence,'version',r.version),
      'operationSequence',s.operation_sequence,
      'canvases',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',c.id::text,'pageId',c.page_id::text)))
    and (select pg_catalog.count(*) from public.lukas_drawing_pages p where p.revision_id=r.id and p.project_id=r.project_id)=1
    and (select pg_catalog.count(*) from public.lukas_drawing_canvases x where x.revision_id=r.id and x.project_id=r.project_id)=1
    and not exists(select 1 from public.lukas_drawing_pages p where p.revision_id=r.id and p.project_id=r.project_id
      and (p.background_source_file_id is not null or p.background_source_sha256 is not null or p.background_pdf_page is not null or p.calibration is not null))
    and not exists(select 1 from public.lukas_drawing_revision_ifc_derivatives b where b.revision_id=r.id and b.project_id=r.project_id)
    and not exists(select 1 from public.lukas_qto_retention_events e where e.project_id=project.id and e.event_type='purge_storage_ready');
  if approved is null then return null; end if;
  if pg_catalog.jsonb_array_length(frozen->'pages')<>1 or pg_catalog.jsonb_array_length(frozen->'canvases')<>1
    or frozen->'blocks'<>'[]'::jsonb or frozen->'blockInstances'<>'[]'::jsonb
    or pg_catalog.jsonb_array_length(frozen->'objects') not between 1 and 10000
    or pg_catalog.jsonb_array_length(frozen->'sources')<>pg_catalog.jsonb_array_length(frozen->'objects')
  then return null; end if;
  -- Reuse canonical serialization to compare every live anchor and object scope.
  -- Historical deleted source rows are separately denied (not silently omitted).
  live:=private.lukas_drawing_p2_canonical_snapshot(q.revision_id,true);
  foreach k in array array['pages','canvases','layers','objects','sources','blocks','blockInstances'] loop
    if frozen->k is distinct from live->k then return null; end if;
  end loop;
  if exists(select 1 from public.lukas_drawing_object_sources s where s.revision_id=q.revision_id and s.project_id=q.project_id
    and (s.status<>'active' or s.source_kind<>'dwg_entity')) then return null; end if;
  anchor:=frozen->'sources'->0;
  if exists(select 1 from pg_catalog.jsonb_array_elements(frozen->'sources') s
    where s->>'sourceKind'<>'dwg_entity' or s->>'revisionId'<>q.revision_id::text
      or s->>'analysisJobId' is distinct from anchor->>'analysisJobId'
      or s->>'reportSha256' is distinct from anchor->>'reportSha256'
      or s->>'sourceFileId' is distinct from anchor->>'sourceFileId'
      or s->>'sourceSha256' is distinct from anchor->>'sourceSha256'
      or private.lukas_drawing_dwg_source_report_matches(q.project_id,(s->>'sourceFileId')::uuid,s->>'sourceSha256',
        s-array['id','objectId','revisionId','sourceFileId','sourceSha256','sourceKind','version']) is not true
      or not exists(select 1 from pg_catalog.jsonb_array_elements(frozen->'objects') o where o->>'id'=s->>'objectId'))
    or (select pg_catalog.count(distinct s->>'handle') from pg_catalog.jsonb_array_elements(frozen->'sources') s)<>pg_catalog.jsonb_array_length(frozen->'sources')
    or (select pg_catalog.count(distinct s->>'objectId') from pg_catalog.jsonb_array_elements(frozen->'sources') s)<>pg_catalog.jsonb_array_length(frozen->'objects')
  then return null; end if;
  select job.* into j from public.lukas_drawing_native_dwg_import_jobs job
    where job.id=(anchor->>'analysisJobId')::uuid and job.project_id=q.project_id and job.status='analyzed';
  if not found or private.lukas_drawing_native_dwg_import_scope(j.scope) is distinct from j.scope
    or j.scope->>'projectId'<>q.project_id::text then return null; end if;
  select r.* into result from public.lukas_drawing_native_dwg_import_results r
    join public.lukas_drawing_native_dwg_import_attempts a on a.job_id=r.job_id and a.project_id=r.project_id and a.attempt_number=r.attempt_number
    where r.job_id=j.id and r.project_id=j.project_id and r.attempt_number=j.attempt_count
      and r.reader_image_id=j.reader_image_id and a.reader_image_id=r.reader_image_id and a.outcome='analyzed'
      and r.report_sha256=anchor->>'reportSha256'
      and r.report_byte_size=pg_catalog.octet_length(pg_catalog.convert_to(r.report_text,'UTF8'))
      and r.report_byte_size between 1 and 33554432
      and r.report_sha256=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(r.report_text,'UTF8'),'sha256'),'hex');
  if not found then return null; end if;
  report:=result.report_text::jsonb;
  if pg_catalog.jsonb_array_length(report->'entities')<>pg_catalog.jsonb_array_length(frozen->'objects') then return null; end if;
  select pg_catalog.jsonb_build_object('verificationId',v.id,'fileId',f.id,'bucket','lukas-qto','path',f.storage_path,
    'sha256',f.sha256,'byteSize',f.byte_size,'headerVersion',v.dwg_header_version) into verified
  from public.lukas_qto_files f
  join public.lukas_qto_verified_uploads v on v.consumed_file_id=f.id
  join public.lukas_drawing_documents d on d.id=q.document_id and d.project_id=f.project_id
  join public.lukas_drawing_revisions historical on historical.id=(j.scope->>'revisionId')::uuid
    and historical.document_id=(j.scope->>'documentId')::uuid and historical.project_id=f.project_id
  join public.lukas_drawing_canvases historical_canvas on historical_canvas.id=(j.scope->>'canvasId')::uuid
    and historical_canvas.revision_id=historical.id and historical_canvas.project_id=f.project_id
  where f.id=(anchor->>'sourceFileId')::uuid and f.project_id=q.project_id
    and f.id=(j.scope->>'sourceFileId')::uuid and f.kind='dwg' and f.immutable
    and f.sha256=anchor->>'sourceSha256' and f.sha256=j.scope->>'sourceSha256'
    and f.byte_size between 1 and 209715200
    and v.kind='dwg' and v.project_id=f.project_id and v.storage_path=f.storage_path
    and v.sha256=f.sha256 and v.byte_size=f.byte_size and v.dwg_header_version~'^AC[0-9]{4}$'
    and (select pg_catalog.count(*) from public.lukas_qto_verified_uploads x where x.consumed_file_id=f.id)=1
    and ((d.source_file_id is null and d.source_sha256 is null) or (d.source_file_id=f.id and d.source_sha256=f.sha256));
  if verified is null or j.source is distinct from verified
    or report->'source' is distinct from verified-array['verificationId','fileId','bucket','path']
  then return null; end if;
  return pg_catalog.jsonb_build_object('approved',approved,'analysis',pg_catalog.jsonb_build_object(
    'scope',j.scope,'result',pg_catalog.jsonb_build_object('receipt',private.lukas_drawing_native_dwg_import_receipt(j.id),'reportText',result.report_text)));
exception when others then return null;
end;
$$;

create function public.lukas_qto_drawing_native_dwg_resave_source(p_scope jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or private.lukas_qto_verified_session() is not true
  then raise exception using errcode='PNR01',message='Approved DWG resave source is unavailable'; end if;
  result:=private.lukas_drawing_native_dwg_resave_source_for_actor((select auth.uid()),p_scope);
  if result is null then raise exception using errcode='PNR01',message='Approved DWG resave source is unavailable'; end if;
  return result;
exception when others then
  raise exception using errcode='PNR01',message='Approved DWG resave source is unavailable';
end;
$$;

revoke all on function private.lukas_drawing_native_dwg_resave_source_for_actor(uuid,jsonb)
  from public,anon,authenticated,service_role,lukas_drawing_collaboration;
revoke all on function public.lukas_qto_drawing_native_dwg_resave_source(jsonb)
  from public,anon,authenticated,service_role,lukas_drawing_collaboration;
grant execute on function public.lukas_qto_drawing_native_dwg_resave_source(jsonb) to authenticated;

commit;
