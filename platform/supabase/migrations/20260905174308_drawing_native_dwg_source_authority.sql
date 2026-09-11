begin;

create function public.lukas_qto_drawing_native_dwg_source(
  p_project_id uuid,
  p_document_id uuid,
  p_revision_id uuid,
  p_revision_version bigint,
  p_canvas_id uuid,
  p_snapshot_sha256 text
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  -- Authorization deliberately precedes source resolution so inaccessible and
  -- nonexistent scopes have the same bounded result.
  if (select auth.uid()) is null
    or private.lukas_qto_verified_session() is not true
    or private.lukas_qto_project_role(p_project_id) is null then
    raise exception using errcode='PND01',
      message='Approved native DWG source is unavailable';
  end if;
  if p_project_id is null
    or p_document_id is null
    or p_revision_id is null
    or p_revision_version is null
    or p_revision_version<1
    or p_revision_version>9007199254740991
    or p_canvas_id is null
    or p_snapshot_sha256 is null
    or p_snapshot_sha256!~'^[0-9a-f]{64}$' then
    raise exception using errcode='PND01',
      message='Approved native DWG source is unavailable';
  end if;

  select pg_catalog.jsonb_build_object(
    'projectId',r.project_id,
    'documentId',r.document_id,
    'canvasId',c.id,
    'revision',pg_catalog.jsonb_build_object(
      'id',r.id,
      'sequence',r.sequence,
      'version',r.version,
      'status',r.status
    ),
    'snapshot',pg_catalog.jsonb_build_object(
      'sha256',s.sha256,
      'schemaVersion',s.schema_version,
      'operationSequence',s.operation_sequence,
      'canonicalJsonText',s.canonical_json::text
    ),
    'approvalDecision','approved'
  ) into v_result
  from public.lukas_drawing_revisions r
  join public.lukas_qto_projects project
    on project.id=r.project_id
  join public.lukas_drawing_documents d
    on d.id=r.document_id and d.project_id=r.project_id
  join public.lukas_drawing_snapshots s on s.revision_id=r.id
    and s.project_id=r.project_id and s.revision_version=r.version
  join public.lukas_drawing_canvases c
    on c.id=p_canvas_id and c.revision_id=r.id and c.project_id=r.project_id
  where r.project_id=p_project_id and r.document_id=p_document_id
    and r.id=p_revision_id and r.version=p_revision_version
    and r.status in ('approved','superseded') and s.schema_version=2
    and s.operation_sequence between 0 and 9007199254740991
    and s.sha256=p_snapshot_sha256
    and s.sha256=pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(s.canonical_json::text,'UTF8'),'sha256'),'hex')
    and pg_catalog.octet_length(
      pg_catalog.convert_to(s.canonical_json::text,'UTF8')
    )<=20971520
    and exists(select 1 from public.lukas_drawing_revision_approvals a
      where a.revision_id=s.revision_id and a.project_id=s.project_id
      and a.subject_version=s.revision_version
      and a.snapshot_sha256=s.sha256 and a.decision='approved')
    and d.source_file_id is null and d.source_sha256 is null
    and c.background_source_file_id is null
    and c.background_source_sha256 is null
    and c.background_pdf_page is null
    and c.calibration is null
    and c.output_profile is not null
    and s.canonical_json@>pg_catalog.jsonb_build_object(
      'revision',pg_catalog.jsonb_build_object(
        'id',r.id::text,
        'documentId',r.document_id::text,
        'projectId',r.project_id::text,
        'sequence',r.sequence,
        'version',r.version
      ),
      'operationSequence',s.operation_sequence,
      'canvases',pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'id',c.id::text,
          'pageId',c.page_id::text,
          'outputProfile',c.output_profile
        )
      )
    )
    and (select pg_catalog.count(*)
      from public.lukas_drawing_pages page
      where page.revision_id=r.id and page.project_id=r.project_id)=1
    and (select pg_catalog.count(*)
      from public.lukas_drawing_canvases canvas
      where canvas.revision_id=r.id and canvas.project_id=r.project_id)=1
    and not exists(
      select 1 from public.lukas_drawing_pages page
      where page.revision_id=r.id and page.project_id=r.project_id
        and (page.background_source_file_id is not null
          or page.background_source_sha256 is not null
          or page.background_pdf_page is not null
          or page.calibration is not null)
    )
    and not exists(
      select 1 from public.lukas_drawing_canvases canvas
      where canvas.revision_id=r.id and canvas.project_id=r.project_id
        and (canvas.background_source_file_id is not null
          or canvas.background_source_sha256 is not null
          or canvas.background_pdf_page is not null
          or canvas.calibration is not null)
    )
    -- Deleted source rows are still historical provenance and remain ineligible.
    and not exists(
      select 1 from public.lukas_drawing_object_sources source
      where source.revision_id=r.id and source.project_id=r.project_id
    )
    and not exists(
      select 1 from public.lukas_drawing_revision_ifc_derivatives binding
      where binding.revision_id=r.id and binding.project_id=r.project_id
    )
    and not exists(
      select 1 from public.lukas_qto_retention_events event
      where event.project_id=project.id
        and event.event_type='purge_storage_ready'
    );

  if v_result is null then
    raise exception using errcode='PND01',
      message='Approved native DWG source is unavailable';
  end if;
  return v_result;
exception
  when sqlstate 'PND01' then raise;
  when others then
    raise exception using errcode='PND01',
      message='Approved native DWG source is unavailable';
end;
$$;

revoke all on function public.lukas_qto_drawing_native_dwg_source(
  uuid,uuid,uuid,bigint,uuid,text
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_qto_drawing_native_dwg_source(
  uuid,uuid,uuid,bigint,uuid,text
) to authenticated;

commit;
