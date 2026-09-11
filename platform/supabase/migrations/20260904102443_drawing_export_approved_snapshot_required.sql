begin;

create or replace function public.lukas_qto_record_drawing_export(
  p_project_id uuid,
  p_artifact_type text,
  p_artifact_sha256 text,
  p_artifact_byte_size bigint,
  p_request_id uuid,
  p_workspace_id uuid,
  p_revision_id uuid,
  p_revision_version bigint,
  p_operation_checkpoint bigint,
  p_checkpoint_sha256 text
) returns public.lukas_qto_export_events
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_organization_id uuid;
  v_request_sha256 text;
  v_legacy_request_sha256 text;
  v_event public.lukas_qto_export_events%rowtype;
  v_revision public.lukas_drawing_revisions%rowtype;
  v_checkpoint jsonb;
  v_current_checkpoint_sha256 text;
  v_snapshot_sha256 text;
begin
  select p.organization_id into v_organization_id
  from public.lukas_qto_projects p where p.id=p_project_id;
  if v_actor is null or private.lukas_qto_verified_session() is not true
    or v_organization_id is null
    or private.lukas_qto_project_role(p_project_id) is null then
    raise exception using errcode='P7R04',message='Drawing export authority denied';
  end if;
  if p_artifact_type not in('drawing_pdf','drawing_png','drawing_svg')
    or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
    or p_artifact_byte_size<=0 or p_request_id is null
    or p_workspace_id is null or p_revision_id is null
    or p_revision_version is null or p_revision_version<=0
    or p_operation_checkpoint is null or p_operation_checkpoint<0
    or p_checkpoint_sha256 is null
    or p_checkpoint_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='P7R05',message='Drawing export evidence is invalid';
  end if;

  v_legacy_request_sha256:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_array(
      v_organization_id,p_project_id,p_artifact_type,p_artifact_sha256,
      p_artifact_byte_size
    )::text,'UTF8'),'sha256'),'hex');
  v_request_sha256:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_array(
      v_organization_id,p_project_id,p_artifact_type,p_artifact_sha256,
      p_artifact_byte_size,p_workspace_id,p_revision_id,p_revision_version,
      p_operation_checkpoint,p_checkpoint_sha256
    )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text,0)
  );
  select * into v_event from public.lukas_qto_export_events
    where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_event.request_sha256 not in(
      v_request_sha256,v_legacy_request_sha256
    ) then
      raise exception using errcode='P7R05',message='Export request identity was reused';
    end if;
    return v_event;
  end if;

  select r.* into v_revision
  from public.lukas_drawing_revisions r
  join public.lukas_drawing_documents d
    on d.id=r.document_id and d.project_id=r.project_id
  where r.id=p_revision_id and r.project_id=p_project_id
    and r.document_id=p_workspace_id and d.id=p_workspace_id
  for no key update of r;
  if not found or v_revision.version<>p_revision_version then
    raise exception using errcode='P7R05',message='Drawing export lineage is invalid';
  end if;

  v_checkpoint:=private.lukas_drawing_p2_canonical_snapshot(
    p_revision_id,true
  );
  v_current_checkpoint_sha256:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_checkpoint::text,'UTF8'),'sha256'),'hex');
  if v_checkpoint is null
    or (v_checkpoint->>'operationSequence')::bigint
      is distinct from p_operation_checkpoint
    or v_current_checkpoint_sha256 is distinct from p_checkpoint_sha256 then
    raise exception using errcode='P7R05',message='Drawing export checkpoint is invalid';
  end if;

  select s.sha256 into v_snapshot_sha256
  from public.lukas_drawing_snapshots s
  join public.lukas_drawing_revision_approvals a
    on a.revision_id=s.revision_id and a.project_id=s.project_id
    and a.subject_version=s.revision_version
    and a.snapshot_sha256=s.sha256 and a.decision='approved'
  where s.revision_id=p_revision_id and s.project_id=p_project_id
    and s.revision_version=p_revision_version;
  if v_snapshot_sha256 is null then
    raise exception using errcode='P7R05',message='Drawing export approved snapshot is required';
  end if;

  insert into public.lukas_qto_export_events(
    organization_id,project_id,artifact_type,artifact_sha256,
    artifact_byte_size,request_id,request_sha256,actor_id,workspace_id,
    revision_id,revision_version,operation_checkpoint,checkpoint_sha256,
    revision_snapshot_sha256
  ) values(
    v_organization_id,p_project_id,p_artifact_type,p_artifact_sha256,
    p_artifact_byte_size,p_request_id,v_request_sha256,v_actor,p_workspace_id,
    p_revision_id,p_revision_version,p_operation_checkpoint,p_checkpoint_sha256,
    v_snapshot_sha256
  ) returning * into v_event;
  return v_event;
end;
$$;

commit;
