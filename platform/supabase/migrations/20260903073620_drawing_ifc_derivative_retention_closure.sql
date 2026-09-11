begin;

-- One deterministic manifest source is shared by purge preparation and
-- finalization. Ready IFC derivatives add exactly their JSON and GLB objects;
-- failed derivatives have no Storage payload and therefore add nothing.
create function private.lukas_qto_project_retention_storage_files(
  p_project_id uuid
) returns table(path text,sha256 text,byte_size bigint)
language sql stable security invoker set search_path='' as $$
  select artifact.path,artifact.sha256,artifact.byte_size
  from (
    select source.storage_path as path,source.sha256,source.byte_size
    from public.lukas_qto_files source
    where source.project_id=p_project_id and source.immutable
    union all
    select derivative.manifest_storage_path,derivative.manifest_sha256,
      derivative.manifest_byte_size
    from public.lukas_drawing_ifc_derivatives derivative
    where derivative.project_id=p_project_id and derivative.status='ready'
    union all
    select derivative.geometry_storage_path,derivative.geometry_sha256,
      derivative.geometry_byte_size
    from public.lukas_drawing_ifc_derivatives derivative
    where derivative.project_id=p_project_id and derivative.status='ready'
  ) artifact
  order by artifact.path,artifact.sha256,artifact.byte_size
$$;

-- Immutable IFC evidence can leave only through the retention RPC's nested
-- project cascade. Keeping all four predicates prevents a forged session
-- marker, an ordinary direct delete, or an unrelated nested cascade.
create or replace function private.lukas_drawing_revision_ifc_derivative_immutable_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE'
    and pg_catalog.pg_trigger_depth()>1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project',true
    )=old.project_id::text
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    )
    and not exists(
      select 1 from public.lukas_qto_projects project
      where project.id=old.project_id
    ) then
    return old;
  end if;
  raise exception using errcode='42501',
    message='Drawing revision IFC derivative bindings are immutable';
end;
$$;

create or replace function private.lukas_drawing_ifc_derivative_immutable_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE'
    and pg_catalog.pg_trigger_depth()>1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project',true
    )=old.project_id::text
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    )
    and not exists(
      select 1 from public.lukas_qto_projects project
      where project.id=old.project_id
    ) then
    return old;
  end if;
  if exists(
    select 1
    from public.lukas_drawing_revisions revision
    join public.lukas_drawing_documents document
      on document.id=revision.document_id
     and document.project_id=revision.project_id
    where document.source_file_id=old.source_file_id
      and revision.project_id=old.project_id
      and revision.status in ('approved','superseded')
  ) or exists(
    select 1
    from public.lukas_drawing_revisions revision
    join public.lukas_drawing_object_sources source
      on source.revision_id=revision.id
     and source.project_id=revision.project_id
    where source.source_file_id=old.source_file_id
      and revision.project_id=old.project_id
      and revision.status in ('approved','superseded')
  ) then
    raise exception using errcode='42501',
      message='cannot mutate approved IFC derivative evidence';
  end if;
  raise exception using errcode='42501',
    message='IFC derivative artifacts are immutable; insert a new version';
end;
$$;

create function private.lukas_drawing_ifc_source_retention_delete_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE'
    and pg_catalog.pg_trigger_depth()>1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project',true
    )=old.project_id::text
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    )
    and not exists(
      select 1 from public.lukas_qto_projects project
      where project.id=old.project_id
    ) then
    return old;
  end if;
  raise exception using errcode='42501',
    message='Immutable IFC sources may only be deleted by project retention purge';
end;
$$;

create trigger lukas_qto_files_ifc_retention_delete_guard
before delete on public.lukas_qto_files
for each row when (old.kind='ifc' and old.immutable)
execute function private.lukas_drawing_ifc_source_retention_delete_guard();

create function private.lukas_drawing_ifc_derivative_job_retention_delete_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE'
    and pg_catalog.pg_trigger_depth()>1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project',true
    )=old.project_id::text
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    )
    and not exists(
      select 1 from public.lukas_qto_projects project
      where project.id=old.project_id
    ) then
    return old;
  end if;
  raise exception using errcode='42501',
    message='IFC derivative jobs may only be deleted by project retention purge';
end;
$$;

create trigger lukas_drawing_ifc_derivative_jobs_retention_delete_guard
before delete on public.lukas_drawing_ifc_derivative_jobs
for each row execute function
  private.lukas_drawing_ifc_derivative_job_retention_delete_guard();

-- Replace restrictive evidence links with guarded cascades. The guards above,
-- not a broadly usable DELETE grant, remain the mutation authority.
alter table public.lukas_drawing_revision_ifc_derivatives
  drop constraint lukas_drawing_revision_ifc_derivatives_project_id_fkey,
  add constraint lukas_drawing_revision_ifc_derivatives_project_fkey
    foreign key(project_id)
    references public.lukas_qto_projects(id) on delete cascade,
  drop constraint lukas_drawing_revision_ifc_derivatives_revision_fkey,
  add constraint lukas_drawing_revision_ifc_derivatives_revision_fkey
    foreign key(revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete cascade,
  drop constraint lukas_drawing_revision_ifc_derivatives_source_fkey,
  add constraint lukas_drawing_revision_ifc_derivatives_source_fkey
    foreign key(source_file_id,project_id,source_sha256)
    references public.lukas_qto_files(id,project_id,sha256) on delete cascade,
  drop constraint lukas_drawing_revision_ifc_derivatives_derivative_fkey,
  add constraint lukas_drawing_revision_ifc_derivatives_derivative_fkey
    foreign key(
      derivative_id,project_id,source_file_id,source_sha256,
      derivative_version,manifest_sha256,geometry_sha256
    ) references public.lukas_drawing_ifc_derivatives(
      id,project_id,source_file_id,source_sha256,
      version,manifest_sha256,geometry_sha256
    ) on delete cascade;

alter table public.lukas_drawing_ifc_derivatives
  drop constraint lukas_drawing_ifc_derivatives_project_id_fkey,
  add constraint lukas_drawing_ifc_derivatives_project_id_fkey
    foreign key(project_id)
    references public.lukas_qto_projects(id) on delete cascade,
  drop constraint lukas_drawing_ifc_derivatives_source_identity_fkey,
  add constraint lukas_drawing_ifc_derivatives_source_identity_fkey
    foreign key(source_file_id,project_id,source_sha256)
    references public.lukas_qto_files(id,project_id,sha256) on delete cascade;

-- IFC upload and retention share the project row as their first lock. An IFC
-- row that resumes after purge preparation aborts atomically with its enqueue.
create or replace function private.lukas_drawing_enqueue_ifc_derivative_job()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select project.id into v_project_id
  from public.lukas_qto_projects project
  where project.id=new.project_id
  for update;
  if not found or exists(
    select 1 from public.lukas_qto_retention_events event
    where event.project_id=new.project_id
      and event.event_type='purge_storage_ready'
  ) then
    raise exception using errcode='PIF05',
      message='IFC derivative enqueue is blocked by project purge';
  end if;
  insert into public.lukas_drawing_ifc_derivative_jobs(
    project_id,source_file_id,source_sha256,source_storage_path,
    source_byte_size,requested_by
  ) values(
    new.project_id,new.id,new.sha256,new.storage_path,new.byte_size,new.uploaded_by
  ) on conflict(source_file_id,project_id,source_sha256) do nothing;
  return new;
end;
$$;

create or replace function public.lukas_qto_purge_project(
  p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project public.lukas_qto_projects%rowtype; v_dependencies jsonb;
declare v_request public.lukas_qto_retention_events%rowtype;
declare v_event public.lukas_qto_retention_events%rowtype;
declare v_active_holds bigint; v_protected bigint; v_active_ifc_jobs bigint;
declare v_sha text; v_status text; v_files jsonb; v_manifest_sha text;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='P7R07',
      message='Trusted purge requires service authority';
  end if;
  if p_request_id is null
    or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000
  then
    raise exception using errcode='P7R05',message='Purge request is invalid';
  end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      'purge',p_organization_id,p_project_id,pg_catalog.btrim(p_reason)
    )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text,0)
  );
  select * into v_event
  from public.lukas_qto_retention_events event
  where event.actor_id is null and event.request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then
      raise exception using errcode='P7R05',
        message='Retention request identity was reused';
    end if;
    if v_event.event_type='project_purged' then
      return pg_catalog.jsonb_build_object(
        'status','PURGED','eventId',v_event.id,
        'dependencies',v_event.evidence->'dependencies'
      );
    elsif v_event.event_type='purge_storage_ready' then
      return pg_catalog.jsonb_build_object(
        'status','STORAGE_REQUIRED','eventId',v_event.id,
        'manifestSha256',v_event.evidence->>'manifestSha256',
        'files',v_event.evidence->'files',
        'dependencies',v_event.evidence->'dependencies'
      );
    end if;
    return pg_catalog.jsonb_build_object(
      'status','HELD','reason',v_event.evidence->>'status',
      'eventId',v_event.id,'dependencies',v_event.evidence->'dependencies'
    );
  end if;

  -- Global order for purge/publication/completion: project, then jobs.
  select * into v_project
  from public.lukas_qto_projects project
  where project.id=p_project_id
    and project.organization_id=p_organization_id
  for update;
  if not found then
    raise exception using errcode='P7R06',
      message='Project retention target is unavailable';
  end if;
  perform job.id
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.project_id=p_project_id
  order by job.id
  for update;
  select pg_catalog.count(*) into v_active_ifc_jobs
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.project_id=p_project_id
    and job.status in ('queued','processing','retry_wait');

  select * into v_request
  from public.lukas_qto_retention_events event
  where event.organization_id=p_organization_id
    and event.project_id=p_project_id
    and event.event_type='deletion_requested'
  order by event.created_at desc,event.id desc
  limit 1;
  if not found then
    raise exception using errcode='P7R08',
      message='Project deletion was not requested';
  end if;
  select pg_catalog.count(*) into v_active_holds
  from public.lukas_qto_retention_events placed
  where placed.organization_id=p_organization_id
    and placed.project_id=p_project_id
    and placed.event_type='legal_hold_placed'
    and not exists(
      select 1 from public.lukas_qto_retention_events released
      where released.event_type='legal_hold_released'
        and released.releases_event_id=placed.id
    );
  v_dependencies:=private.lukas_qto_project_retention_dependencies(p_project_id);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'path',artifact.path,'sha256',artifact.sha256,'byteSize',artifact.byte_size
  ) order by artifact.path,artifact.sha256,artifact.byte_size),'[]'::jsonb)
  into v_files
  from private.lukas_qto_project_retention_storage_files(p_project_id) artifact;
  v_manifest_sha:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_files::text,'UTF8'),'sha256'),'hex');
  v_protected:=(v_dependencies->>'approvedDrawingRevisions')::bigint
    +(v_dependencies->>'drawingRevisionApprovals')::bigint
    +(v_dependencies->>'drawingIssueApprovals')::bigint
    +(v_dependencies->>'approvedBoqVersions')::bigint
    +(v_dependencies->>'drawingQuantityLinks')::bigint
    +(v_dependencies->>'drawingBoqLinks')::bigint
    +(v_dependencies->>'drawingMaterialLinks')::bigint
    +(v_dependencies->>'materialTransactions')::bigint
    +(v_dependencies->>'publishedLibraryVersions')::bigint
    +(v_dependencies->>'libraryImports')::bigint;
  v_status:=case
    when pg_catalog.now()<v_request.purge_after then 'retention_not_expired'
    when v_active_holds>0 then 'legal_hold_active'
    when v_protected>0 then 'protected_dependencies'
    when v_active_ifc_jobs>0 then 'active_ifc_derivative_jobs'
    when pg_catalog.jsonb_array_length(v_files)>0
      then 'storage_deletion_required'
    else 'purged'
  end;
  insert into public.lukas_qto_retention_events(
    organization_id,project_id,event_type,request_id,request_sha256,
    reason,evidence,actor_id
  ) values(
    p_organization_id,p_project_id,
    case
      when v_status='purged' then 'project_purged'
      when v_status='storage_deletion_required' then 'purge_storage_ready'
      else 'purge_denied'
    end,
    p_request_id,v_sha,pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object(
      'status',v_status,'requestEventId',v_request.id,
      'purgeAfter',v_request.purge_after,'activeLegalHolds',v_active_holds,
      'activeIfcDerivativeJobs',v_active_ifc_jobs,
      'dependencies',v_dependencies,'manifestSha256',v_manifest_sha,
      'files',v_files
    ),null
  ) returning * into v_event;
  if v_status='storage_deletion_required' then
    return pg_catalog.jsonb_build_object(
      'status','STORAGE_REQUIRED','eventId',v_event.id,
      'manifestSha256',v_manifest_sha,'files',v_files,
      'dependencies',v_dependencies
    );
  end if;
  if v_status<>'purged' then
    return pg_catalog.jsonb_build_object(
      'status','HELD','reason',v_status,'eventId',v_event.id,
      'dependencies',v_dependencies
    );
  end if;
  perform pg_catalog.set_config(
    'app.lukas_retention_purge_project',p_project_id::text,true
  );
  delete from public.lukas_qto_projects project
  where project.id=p_project_id
    and project.organization_id=p_organization_id;
  return pg_catalog.jsonb_build_object(
    'status','PURGED','eventId',v_event.id,'dependencies',v_dependencies
  );
end;
$$;

create or replace function public.lukas_qto_finalize_project_purge(
  p_organization_id uuid,p_project_id uuid,p_ready_event_id uuid,
  p_manifest_sha256 text,p_request_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project public.lukas_qto_projects%rowtype;
declare v_ready public.lukas_qto_retention_events%rowtype;
declare v_event public.lukas_qto_retention_events%rowtype;
declare v_dependencies jsonb; v_files jsonb; v_paths text[];
declare v_sha text; v_storage_exists boolean; v_active_ifc_jobs bigint;
declare v_derivative_prefix text;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='P7R07',
      message='Trusted purge requires service authority';
  end if;
  if p_ready_event_id is null or p_request_id is null
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000
  then
    raise exception using errcode='P7R05',
      message='Purge finalization request is invalid';
  end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      'finalize_purge',p_organization_id,p_project_id,p_ready_event_id,
      p_manifest_sha256,pg_catalog.btrim(p_reason)
    )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text,0)
  );
  select * into v_event
  from public.lukas_qto_retention_events event
  where event.actor_id is null and event.request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then
      raise exception using errcode='P7R05',
        message='Retention request identity was reused';
    end if;
    return pg_catalog.jsonb_build_object(
      'status','PURGED','eventId',v_event.id,
      'dependencies',v_event.evidence->'dependencies'
    );
  end if;

  -- Same global order as prepare, publish and complete.
  select * into v_project
  from public.lukas_qto_projects project
  where project.id=p_project_id
    and project.organization_id=p_organization_id
  for update;
  if not found then
    raise exception using errcode='P7R06',
      message='Project retention target is unavailable';
  end if;
  perform job.id
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.project_id=p_project_id
  order by job.id
  for update;
  select pg_catalog.count(*) into v_active_ifc_jobs
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.project_id=p_project_id
    and job.status in ('queued','processing','retry_wait');
  if v_active_ifc_jobs>0 then
    raise exception using errcode='P7R08',
      message='Project IFC derivative jobs changed';
  end if;

  select * into v_ready
  from public.lukas_qto_retention_events event
  where event.id=p_ready_event_id
    and event.organization_id=p_organization_id
    and event.project_id=p_project_id
    and event.event_type='purge_storage_ready';
  if not found or v_ready.evidence->>'manifestSha256'<>p_manifest_sha256 then
    raise exception using errcode='P7R05',
      message='Purge storage manifest is unavailable';
  end if;
  select
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'path',artifact.path,'sha256',artifact.sha256,
      'byteSize',artifact.byte_size
    ) order by artifact.path,artifact.sha256,artifact.byte_size),'[]'::jsonb),
    coalesce(pg_catalog.array_agg(
      artifact.path order by artifact.path,artifact.sha256,artifact.byte_size
    ),array[]::text[])
  into v_files,v_paths
  from private.lukas_qto_project_retention_storage_files(p_project_id) artifact;
  if pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_files::text,'UTF8'),'sha256'),'hex'
  )<>p_manifest_sha256 then
    raise exception using errcode='P7R05',
      message='Purge storage manifest changed';
  end if;
  v_dependencies:=private.lukas_qto_project_retention_dependencies(p_project_id);
  if ((v_dependencies->>'approvedDrawingRevisions')::bigint
      +(v_dependencies->>'drawingRevisionApprovals')::bigint
      +(v_dependencies->>'drawingIssueApprovals')::bigint
      +(v_dependencies->>'approvedBoqVersions')::bigint
      +(v_dependencies->>'drawingQuantityLinks')::bigint
      +(v_dependencies->>'drawingBoqLinks')::bigint
      +(v_dependencies->>'drawingMaterialLinks')::bigint
      +(v_dependencies->>'materialTransactions')::bigint
      +(v_dependencies->>'publishedLibraryVersions')::bigint
      +(v_dependencies->>'libraryImports')::bigint)>0
    or exists(
      select 1 from public.lukas_qto_retention_events placed
      where placed.organization_id=p_organization_id
        and placed.project_id=p_project_id
        and placed.event_type='legal_hold_placed'
        and not exists(
          select 1 from public.lukas_qto_retention_events released
          where released.event_type='legal_hold_released'
            and released.releases_event_id=placed.id
        )
    ) then
    raise exception using errcode='P7R08',
      message='Project purge dependencies changed';
  end if;
  if pg_catalog.to_regclass('storage.objects') is null then
    raise exception using errcode='P7R09',
      message='Storage deletion confirmation authority unavailable';
  end if;
  execute 'select exists(select 1 from storage.objects '
    ||'where bucket_id=''lukas-qto'' and name=any($1))'
  into v_storage_exists using v_paths;
  if v_storage_exists then
    raise exception using errcode='P7R09',
      message='Immutable Storage deletion is incomplete';
  end if;
  -- A converter may have uploaded one content-addressed object before failing
  -- to publish its ready row. Such objects have no trustworthy DB hash/size
  -- tuple for the manifest, so finalization must fail closed on the prefix.
  v_derivative_prefix:=
    'projects/'||p_project_id::text||'/ifc-derivatives/';
  execute 'select exists(select 1 from storage.objects '
    ||'where bucket_id=''lukas-qto'' '
    ||'and pg_catalog.left(name,pg_catalog.char_length($1))=$1)'
  into v_storage_exists using v_derivative_prefix;
  if v_storage_exists then
    raise exception using errcode='P7R09',
      message='IFC derivative Storage deletion is incomplete';
  end if;
  insert into public.lukas_qto_retention_events(
    organization_id,project_id,event_type,request_id,request_sha256,
    reason,evidence,actor_id
  ) values(
    p_organization_id,p_project_id,'project_purged',p_request_id,v_sha,
    pg_catalog.btrim(p_reason),pg_catalog.jsonb_build_object(
      'status','purged','readyEventId',v_ready.id,
      'manifestSha256',p_manifest_sha256,'files',v_files,
      'dependencies',v_dependencies
    ),null
  ) returning * into v_event;
  perform pg_catalog.set_config(
    'app.lukas_retention_purge_project',p_project_id::text,true
  );
  delete from public.lukas_qto_projects project
  where project.id=p_project_id
    and project.organization_id=p_organization_id;
  return pg_catalog.jsonb_build_object(
    'status','PURGED','eventId',v_event.id,'dependencies',v_dependencies
  );
end;
$$;

create or replace function public.lukas_drawing_claim_ifc_derivative_job(
  p_lease_seconds integer default 300
) returns table(
  job_id uuid,
  project_id uuid,
  source_file_id uuid,
  source_storage_path text,
  source_byte_size bigint,
  source_sha256 text,
  requested_by uuid,
  derivative_version bigint,
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer
) language plpgsql security definer set search_path='' as $$
declare v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
declare v_candidate_job_id uuid; v_candidate_project_id uuid;
declare v_project_id uuid; v_version bigint; v_token uuid;
declare v_now timestamptz; v_derivative_status text;
begin
  if p_lease_seconds not between 30 and 900 then
    raise exception using errcode='22023',
      message='IFC derivative lease must be between 30 and 900 seconds';
  end if;
  loop
    v_now:=pg_catalog.clock_timestamp();
    -- Candidate discovery takes no row lock. Every mutation lock starts with
    -- its project, so purge and workers cannot deadlock job -> project.
    select job.id,job.project_id
    into v_candidate_job_id,v_candidate_project_id
    from public.lukas_drawing_ifc_derivative_jobs job
    where (
      (
        job.status in ('queued','retry_wait') and job.next_attempt_at<=v_now
      ) or (
        job.status='processing' and job.lease_expires_at<=v_now
      )
    )
    and not exists(
      select 1 from public.lukas_qto_retention_events event
      where event.project_id=job.project_id
        and event.event_type='purge_storage_ready'
    )
    order by
      case when job.status='processing'
        then job.lease_expires_at else job.next_attempt_at end,
      job.created_at,job.id
    limit 1;
    if not found then
      return;
    end if;

    select project.id into v_project_id
    from public.lukas_qto_projects project
    where project.id=v_candidate_project_id
    for update;
    if not found then
      continue;
    end if;
    select job.* into v_job
    from public.lukas_drawing_ifc_derivative_jobs job
    where job.id=v_candidate_job_id
      and (
        job.status in ('queued','retry_wait') and job.next_attempt_at<=v_now
        or job.status='processing' and job.lease_expires_at<=v_now
      )
    for update skip locked;
    if not found then
      continue;
    end if;
    if exists(
      select 1 from public.lukas_qto_retention_events event
      where event.project_id=v_job.project_id
        and event.event_type='purge_storage_ready'
    ) then
      continue;
    end if;

    if v_job.status='processing'
      and v_job.attempt_count>=v_job.max_attempts
    then
      select derivative.status into v_derivative_status
      from public.lukas_drawing_ifc_derivatives derivative
      where derivative.project_id=v_job.project_id
        and derivative.source_file_id=v_job.source_file_id
        and derivative.source_sha256=v_job.source_sha256
        and derivative.version=v_job.claimed_version;
      if v_derivative_status='ready' then
        update public.lukas_drawing_ifc_derivative_jobs job
        set status='completed',lease_expires_at=null,
          last_error_code=null,last_error_message=null,updated_at=v_now
        where job.id=v_job.id;
      else
        insert into public.lukas_drawing_ifc_derivatives(
          project_id,source_file_id,source_sha256,version,
          schema_version,status,created_by
        ) values(
          v_job.project_id,v_job.source_file_id,v_job.source_sha256,
          v_job.claimed_version,1,'failed',v_job.requested_by
        ) on conflict on constraint
          lukas_drawing_ifc_derivatives_source_version_key do nothing;
        select derivative.status into v_derivative_status
        from public.lukas_drawing_ifc_derivatives derivative
        where derivative.project_id=v_job.project_id
          and derivative.source_file_id=v_job.source_file_id
          and derivative.source_sha256=v_job.source_sha256
          and derivative.version=v_job.claimed_version;
        if v_derivative_status='ready' then
          update public.lukas_drawing_ifc_derivative_jobs job
          set status='completed',lease_expires_at=null,
            last_error_code=null,last_error_message=null,updated_at=v_now
          where job.id=v_job.id;
        elsif v_derivative_status='failed' then
          update public.lukas_drawing_ifc_derivative_jobs job
          set status='failed',lease_expires_at=null,
            last_error_code='lease_expired',
            last_error_message='IFC derivative worker lease expired.',
            updated_at=v_now
          where job.id=v_job.id;
        else
          raise exception using errcode='PIF04',
            message='IFC derivative version is occupied by nonterminal evidence';
        end if;
      end if;
      continue;
    end if;

    if v_job.claimed_version is null then
      select coalesce(pg_catalog.max(derivative.version),0)+1
      into v_version
      from public.lukas_drawing_ifc_derivatives derivative
      where derivative.project_id=v_job.project_id
        and derivative.source_file_id=v_job.source_file_id
        and derivative.source_sha256=v_job.source_sha256;
    else
      v_version:=v_job.claimed_version;
    end if;
    v_token:=extensions.gen_random_uuid();
    update public.lukas_drawing_ifc_derivative_jobs job
    set status='processing',attempt_count=job.attempt_count+1,
      claimed_version=v_version,lease_token=v_token,
      lease_expires_at=v_now+(p_lease_seconds*interval '1 second'),
      last_error_code=null,last_error_message=null,updated_at=v_now
    where job.id=v_job.id;
    return query select
      v_job.id,v_job.project_id,v_job.source_file_id,
      v_job.source_storage_path,v_job.source_byte_size,v_job.source_sha256,
      v_job.requested_by,v_version,v_token,
      v_now+(p_lease_seconds*interval '1 second'),v_job.attempt_count+1;
    return;
  end loop;
end;
$$;

create or replace function public.lukas_drawing_fail_ifc_derivative_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_derivative_version bigint,
  p_retryable boolean,
  p_error_code text,
  p_error_message text
) returns text language plpgsql security definer set search_path='' as $$
declare v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
declare v_project_id uuid; v_now timestamptz:=pg_catalog.clock_timestamp();
declare v_error_code text; v_error_message text; v_derivative_status text;
begin
  select project.id into v_project_id
  from public.lukas_qto_projects project
  where project.id=(
    select candidate.project_id
    from public.lukas_drawing_ifc_derivative_jobs candidate
    where candidate.id=p_job_id
  )
  for update;
  if not found then
    raise exception using errcode='PIF02',
      message='IFC derivative lease is unavailable';
  end if;
  select job.* into v_job
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.id=p_job_id
  for update;
  if not found then
    raise exception using errcode='PIF02',
      message='IFC derivative lease is unavailable';
  end if;
  if v_job.lease_token is distinct from p_lease_token
    or v_job.claimed_version is distinct from p_derivative_version
  then
    raise exception using errcode='PIF02',
      message='IFC derivative lease identity is stale';
  end if;
  select derivative.status into v_derivative_status
  from public.lukas_drawing_ifc_derivatives derivative
  where derivative.project_id=v_job.project_id
    and derivative.source_file_id=v_job.source_file_id
    and derivative.source_sha256=v_job.source_sha256
    and derivative.version=v_job.claimed_version;
  if v_job.status='completed' and v_derivative_status='ready' then
    return 'completed';
  end if;
  if v_job.status in ('retry_wait','failed') then
    return v_job.status;
  end if;
  if exists(
    select 1 from public.lukas_qto_retention_events event
    where event.project_id=v_job.project_id
      and event.event_type='purge_storage_ready'
  ) then
    raise exception using errcode='PIF05',
      message='IFC derivative failure is blocked by project purge';
  end if;
  if v_derivative_status='ready' then
    update public.lukas_drawing_ifc_derivative_jobs job
    set status='completed',lease_expires_at=null,last_error_code=null,
      last_error_message=null,updated_at=v_now
    where job.id=v_job.id;
    return 'completed';
  end if;
  if v_job.status='completed' then
    raise exception using errcode='PIF03',
      message='Exact ready derivative was not found';
  end if;
  if v_job.status<>'processing'
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at<=v_now
  then
    raise exception using errcode='PIF02',
      message='IFC derivative lease identity is stale';
  end if;
  v_error_code:=pg_catalog.left(pg_catalog.lower(pg_catalog.regexp_replace(
    coalesce(p_error_code,''),'[^a-zA-Z0-9_]+','_','g'
  )),64);
  if v_error_code='' then v_error_code:='conversion_failed'; end if;
  v_error_message:=pg_catalog.left(pg_catalog.btrim(
    pg_catalog.regexp_replace(
      coalesce(p_error_message,''),'[[:cntrl:]]+',' ','g'
    )
  ),500);
  if v_error_message='' then
    v_error_message:='IFC derivative conversion failed.';
  end if;
  if p_retryable and v_job.attempt_count<v_job.max_attempts then
    update public.lukas_drawing_ifc_derivative_jobs job
    set status='retry_wait',lease_expires_at=null,
      next_attempt_at=v_now+(v_job.attempt_count*interval '30 seconds'),
      last_error_code=v_error_code,last_error_message=v_error_message,
      updated_at=v_now
    where job.id=v_job.id;
    return 'retry_wait';
  end if;
  insert into public.lukas_drawing_ifc_derivatives(
    project_id,source_file_id,source_sha256,version,
    schema_version,status,created_by
  ) values(
    v_job.project_id,v_job.source_file_id,v_job.source_sha256,
    v_job.claimed_version,1,'failed',v_job.requested_by
  ) on conflict on constraint
    lukas_drawing_ifc_derivatives_source_version_key do nothing;
  select derivative.status into v_derivative_status
  from public.lukas_drawing_ifc_derivatives derivative
  where derivative.project_id=v_job.project_id
    and derivative.source_file_id=v_job.source_file_id
    and derivative.source_sha256=v_job.source_sha256
    and derivative.version=v_job.claimed_version;
  if v_derivative_status='ready' then
    update public.lukas_drawing_ifc_derivative_jobs job
    set status='completed',lease_expires_at=null,last_error_code=null,
      last_error_message=null,updated_at=v_now
    where job.id=v_job.id;
    return 'completed';
  end if;
  if v_derivative_status<>'failed' then
    raise exception using errcode='PIF04',
      message='IFC derivative version is occupied by nonterminal evidence';
  end if;
  update public.lukas_drawing_ifc_derivative_jobs job
  set status='failed',lease_expires_at=null,last_error_code=v_error_code,
    last_error_message=v_error_message,updated_at=v_now
  where job.id=v_job.id;
  return 'failed';
end;
$$;

create function public.lukas_drawing_publish_leased_ifc_derivative_ready(
  p_job_id uuid,
  p_lease_token uuid,
  p_project_id uuid,
  p_source_file_id uuid,
  p_source_sha256 text,
  p_version bigint,
  p_manifest_json jsonb,
  p_manifest_storage_path text,
  p_manifest_byte_size bigint,
  p_manifest_sha256 text,
  p_geometry_storage_path text,
  p_geometry_byte_size bigint,
  p_geometry_sha256 text,
  p_created_by uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_project_id uuid;
declare v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
declare v_purge_ready boolean;
begin
  -- Project then job is the shared lock order with retention prepare/finalize.
  select project.id into v_project_id
  from public.lukas_qto_projects project
  where project.id=p_project_id
  for update;
  if not found then
    raise exception using errcode='PIF05',
      message='IFC derivative publication is blocked by project purge';
  end if;
  select job.* into v_job
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.id=p_job_id
    and job.project_id=p_project_id
    and job.source_file_id=p_source_file_id
    and job.source_sha256=p_source_sha256
  for update;
  if not found
    or v_job.lease_token is distinct from p_lease_token
    or v_job.claimed_version is distinct from p_version
    or v_job.requested_by is distinct from p_created_by
  then
    raise exception using errcode='PIF02',
      message='IFC derivative publication lease identity is stale';
  end if;
  select derivative.id into v_id
  from public.lukas_drawing_ifc_derivatives derivative
  where derivative.project_id=p_project_id
    and derivative.source_file_id=p_source_file_id
    and derivative.source_sha256=p_source_sha256
    and derivative.version=p_version
    and derivative.schema_version=1
    and derivative.status='ready'
    and derivative.manifest_json=p_manifest_json
    and derivative.manifest_storage_path=p_manifest_storage_path
    and derivative.manifest_byte_size=p_manifest_byte_size
    and derivative.manifest_sha256=p_manifest_sha256
    and derivative.geometry_storage_path=p_geometry_storage_path
    and derivative.geometry_byte_size=p_geometry_byte_size
    and derivative.geometry_sha256=p_geometry_sha256
    and derivative.created_by=p_created_by;
  if v_job.status='completed' and v_id is not null then
    return v_id;
  end if;
  if v_job.status<>'processing'
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at<=pg_catalog.clock_timestamp()
  then
    raise exception using errcode='PIF02',
      message='IFC derivative publication lease identity is stale';
  end if;
  if v_id is not null then
    return v_id;
  end if;
  select exists(
    select 1 from public.lukas_qto_retention_events event
    where event.project_id=p_project_id
      and event.event_type='purge_storage_ready'
  ) into v_purge_ready;
  if v_purge_ready then
    raise exception using errcode='PIF05',
      message='IFC derivative publication is blocked by project purge';
  end if;

  insert into public.lukas_drawing_ifc_derivatives(
    project_id,source_file_id,source_sha256,version,schema_version,status,
    manifest_json,manifest_storage_path,manifest_byte_size,manifest_sha256,
    geometry_storage_path,geometry_byte_size,geometry_sha256,created_by
  ) values(
    p_project_id,p_source_file_id,p_source_sha256,p_version,1,'ready',
    p_manifest_json,p_manifest_storage_path,p_manifest_byte_size,
    p_manifest_sha256,p_geometry_storage_path,p_geometry_byte_size,
    p_geometry_sha256,p_created_by
  ) on conflict(source_file_id,project_id,version) do nothing
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;
  select derivative.id into v_id
  from public.lukas_drawing_ifc_derivatives derivative
  where derivative.project_id=p_project_id
    and derivative.source_file_id=p_source_file_id
    and derivative.source_sha256=p_source_sha256
    and derivative.version=p_version
    and derivative.schema_version=1
    and derivative.status='ready'
    and derivative.manifest_json=p_manifest_json
    and derivative.manifest_storage_path=p_manifest_storage_path
    and derivative.manifest_byte_size=p_manifest_byte_size
    and derivative.manifest_sha256=p_manifest_sha256
    and derivative.geometry_storage_path=p_geometry_storage_path
    and derivative.geometry_byte_size=p_geometry_byte_size
    and derivative.geometry_sha256=p_geometry_sha256
    and derivative.created_by=p_created_by;
  if v_id is null then
    raise exception using errcode='23505',
      message='IFC derivative version maps to a different immutable payload';
  end if;
  return v_id;
end;
$$;

-- Compatibility authority: callers without a lease token can only reconcile
-- an already-published byte-exact row. New publication uses the leased RPC.
create or replace function public.lukas_drawing_publish_ifc_derivative_ready(
  p_project_id uuid,
  p_source_file_id uuid,
  p_source_sha256 text,
  p_version bigint,
  p_manifest_json jsonb,
  p_manifest_storage_path text,
  p_manifest_byte_size bigint,
  p_manifest_sha256 text,
  p_geometry_storage_path text,
  p_geometry_byte_size bigint,
  p_geometry_sha256 text,
  p_created_by uuid
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_project_id uuid;
declare v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
begin
  select project.id into v_project_id
  from public.lukas_qto_projects project
  where project.id=p_project_id
  for update;
  if not found then
    raise exception using errcode='PIF05',
      message='IFC derivative publication is blocked by project purge';
  end if;
  select job.* into v_job
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.project_id=p_project_id
    and job.source_file_id=p_source_file_id
    and job.source_sha256=p_source_sha256
  for update;
  select derivative.id into v_id
  from public.lukas_drawing_ifc_derivatives derivative
  where derivative.project_id=p_project_id
    and derivative.source_file_id=p_source_file_id
    and derivative.source_sha256=p_source_sha256
    and derivative.version=p_version
    and derivative.schema_version=1
    and derivative.status='ready'
    and derivative.manifest_json=p_manifest_json
    and derivative.manifest_storage_path=p_manifest_storage_path
    and derivative.manifest_byte_size=p_manifest_byte_size
    and derivative.manifest_sha256=p_manifest_sha256
    and derivative.geometry_storage_path=p_geometry_storage_path
    and derivative.geometry_byte_size=p_geometry_byte_size
    and derivative.geometry_sha256=p_geometry_sha256
    and derivative.created_by=p_created_by;
  if v_id is not null then
    return v_id;
  end if;
  if exists(
    select 1 from public.lukas_qto_retention_events event
    where event.project_id=p_project_id
      and event.event_type='purge_storage_ready'
  ) then
    raise exception using errcode='PIF05',
      message='IFC derivative publication is blocked by project purge';
  end if;
  raise exception using errcode='PIF02',
    message='IFC derivative publication requires an active worker lease';
end;
$$;

create or replace function public.lukas_drawing_complete_ifc_derivative_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_derivative_version bigint,
  p_derivative_id uuid
) returns text language plpgsql security definer set search_path='' as $$
declare v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
declare v_project_id uuid; v_ready boolean;
declare v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  -- Resolve the project without locking the job, then take the global order.
  select project.id into v_project_id
  from public.lukas_qto_projects project
  where project.id=(
    select candidate.project_id
    from public.lukas_drawing_ifc_derivative_jobs candidate
    where candidate.id=p_job_id
  )
  for update;
  if not found then
    raise exception using errcode='PIF02',
      message='IFC derivative lease is unavailable';
  end if;
  select job.* into v_job
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.id=p_job_id
  for update;
  if not found then
    raise exception using errcode='PIF02',
      message='IFC derivative lease is unavailable';
  end if;
  if v_job.lease_token is distinct from p_lease_token
    or v_job.claimed_version is distinct from p_derivative_version
  then
    raise exception using errcode='PIF02',
      message='IFC derivative lease identity is stale';
  end if;
  select exists(
    select 1
    from public.lukas_drawing_ifc_derivatives derivative
    where derivative.id=p_derivative_id
      and derivative.project_id=v_job.project_id
      and derivative.source_file_id=v_job.source_file_id
      and derivative.source_sha256=v_job.source_sha256
      and derivative.version=v_job.claimed_version
      and derivative.status='ready'
  ) into v_ready;
  if v_job.status='completed' and v_ready then
    return 'completed';
  end if;
  if exists(
    select 1 from public.lukas_qto_retention_events event
    where event.project_id=v_job.project_id
      and event.event_type='purge_storage_ready'
  ) then
    raise exception using errcode='PIF05',
      message='IFC derivative completion is blocked by project purge';
  end if;
  if v_job.status<>'processing'
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at<=v_now
  then
    raise exception using errcode='PIF02',
      message='IFC derivative lease identity is stale';
  end if;
  if not v_ready then
    raise exception using errcode='PIF03',
      message='Exact ready derivative was not found';
  end if;
  update public.lukas_drawing_ifc_derivative_jobs job
  set status='completed',lease_expires_at=null,last_error_code=null,
    last_error_message=null,updated_at=v_now
  where job.id=v_job.id;
  return 'completed';
end;
$$;

revoke all on function
  private.lukas_qto_project_retention_storage_files(uuid),
  private.lukas_drawing_revision_ifc_derivative_immutable_guard(),
  private.lukas_drawing_ifc_derivative_immutable_guard(),
  private.lukas_drawing_ifc_source_retention_delete_guard(),
  private.lukas_drawing_ifc_derivative_job_retention_delete_guard(),
  private.lukas_drawing_enqueue_ifc_derivative_job()
from public,anon,authenticated,service_role;

revoke all on function
  public.lukas_qto_purge_project(uuid,uuid,uuid,text),
  public.lukas_qto_finalize_project_purge(uuid,uuid,uuid,text,uuid,text),
  public.lukas_drawing_claim_ifc_derivative_job(integer),
  public.lukas_drawing_fail_ifc_derivative_job(
    uuid,uuid,bigint,boolean,text,text
  ),
  public.lukas_drawing_publish_leased_ifc_derivative_ready(
    uuid,uuid,uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid
  ),
  public.lukas_drawing_publish_ifc_derivative_ready(
    uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid
  ),
  public.lukas_drawing_complete_ifc_derivative_job(uuid,uuid,bigint,uuid)
from public,anon,authenticated,service_role;
grant execute on function
  public.lukas_qto_purge_project(uuid,uuid,uuid,text),
  public.lukas_qto_finalize_project_purge(uuid,uuid,uuid,text,uuid,text),
  public.lukas_drawing_claim_ifc_derivative_job(integer),
  public.lukas_drawing_fail_ifc_derivative_job(
    uuid,uuid,bigint,boolean,text,text
  ),
  public.lukas_drawing_publish_leased_ifc_derivative_ready(
    uuid,uuid,uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid
  ),
  public.lukas_drawing_publish_ifc_derivative_ready(
    uuid,uuid,text,bigint,jsonb,text,bigint,text,text,bigint,text,uuid
  ),
  public.lukas_drawing_complete_ifc_derivative_job(uuid,uuid,bigint,uuid)
to service_role;

alter default privileges revoke execute on functions from public;

commit;
