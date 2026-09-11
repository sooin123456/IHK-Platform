begin;

-- A response-loss retry is a read of an already committed decision. Once the
-- project lock is held, replay that decision before evaluating whether purge
-- preparation now blocks brand-new work.
create or replace function public.lukas_drawing_requeue_failed_ifc_derivative_job(
  p_job_id uuid,
  p_project_id uuid,
  p_source_file_id uuid,
  p_source_sha256 text,
  p_expected_failed_version bigint,
  p_target_converter_sha256 text,
  p_request_id uuid,
  p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
declare v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
declare v_event public.lukas_drawing_ifc_derivative_requeue_events%rowtype;
declare v_target_version bigint; v_to_generation integer;
declare v_reason text; v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_expected_failed_version is null or p_expected_failed_version<1 then
    raise exception using errcode='22023',
      message='IFC derivative failed version is invalid';
  end if;
  if p_target_converter_sha256 is null
    or p_target_converter_sha256!~'^[0-9a-f]{64}$'
  then
    raise exception using errcode='22023',
      message='IFC derivative converter identity is invalid';
  end if;
  v_reason:=pg_catalog.btrim(pg_catalog.regexp_replace(
    coalesce(p_reason,''),'[[:cntrl:]]+',' ','g'
  ));
  if pg_catalog.char_length(v_reason) not between 1 and 500 then
    raise exception using errcode='22023',
      message='IFC derivative requeue reason is invalid';
  end if;

  -- Purge, publication, claims, and requeue all serialize on project first.
  select project.id into v_project_id
  from public.lukas_qto_projects project
  where project.id=p_project_id
  for update;
  if not found then
    raise exception using errcode='PIF06',
      message='IFC derivative terminal failed job is unavailable for requeue';
  end if;

  -- An exact request replay returns the original decision, even when purge
  -- preparation started after that decision committed. Different payloads may
  -- never borrow another request identity.
  select event.* into v_event
  from public.lukas_drawing_ifc_derivative_requeue_events event
  where event.request_id=p_request_id;
  if found then
    if v_event.job_id is distinct from p_job_id
      or v_event.project_id is distinct from p_project_id
      or v_event.source_file_id is distinct from p_source_file_id
      or v_event.source_sha256 is distinct from p_source_sha256
      or v_event.failed_derivative_version is distinct from p_expected_failed_version
      or v_event.target_converter_sha256 is distinct from p_target_converter_sha256
      or v_event.reason is distinct from v_reason
    then
      raise exception using errcode='PIF07',
        message='IFC derivative requeue request conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'status','queued','jobId',v_event.job_id,
      'generation',v_event.to_generation,
      'targetVersion',v_event.target_derivative_version,
      'converterSha256',v_event.target_converter_sha256,
      'requestId',v_event.request_id
    );
  end if;

  if exists(
    select 1 from public.lukas_qto_retention_events event
    where event.project_id=p_project_id
      and event.event_type='purge_storage_ready'
  ) then
    raise exception using errcode='PIF05',
      message='IFC derivative requeue is blocked by project purge';
  end if;

  select job.* into v_job
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.id=p_job_id
    and job.project_id=p_project_id
    and job.source_file_id=p_source_file_id
    and job.source_sha256=p_source_sha256
  for update;
  if not found
    or v_job.status<>'failed'
    or v_job.last_error_code<>'conversion_failed'
    or v_job.claimed_version is distinct from p_expected_failed_version
    or v_job.target_version is distinct from p_expected_failed_version
  then
    raise exception using errcode='PIF06',
      message='IFC derivative terminal failed job is unavailable for requeue';
  end if;
  if not exists(
    select 1 from public.lukas_drawing_ifc_derivatives derivative
    where derivative.project_id=p_project_id
      and derivative.source_file_id=p_source_file_id
      and derivative.source_sha256=p_source_sha256
      and derivative.version=p_expected_failed_version
      and derivative.status='failed'
  ) or exists(
    select 1 from public.lukas_drawing_ifc_derivatives derivative
    where derivative.project_id=p_project_id
      and derivative.source_file_id=p_source_file_id
      and derivative.source_sha256=p_source_sha256
      and derivative.status='ready'
  ) then
    raise exception using errcode='PIF06',
      message='IFC derivative terminal failed evidence is unavailable for requeue';
  end if;
  select coalesce(pg_catalog.max(derivative.version),0)+1
  into v_target_version
  from public.lukas_drawing_ifc_derivatives derivative
  where derivative.project_id=p_project_id
    and derivative.source_file_id=p_source_file_id
    and derivative.source_sha256=p_source_sha256;
  if v_target_version<>p_expected_failed_version+1 then
    raise exception using errcode='PIF06',
      message='IFC derivative target version is unavailable for requeue';
  end if;
  v_to_generation:=v_job.generation+1;

  insert into public.lukas_drawing_ifc_derivative_requeue_events(
    job_id,project_id,source_file_id,source_sha256,request_id,
    from_generation,to_generation,failed_derivative_version,
    target_derivative_version,target_converter_sha256,reason
  ) values(
    p_job_id,p_project_id,p_source_file_id,p_source_sha256,p_request_id,
    v_job.generation,v_to_generation,p_expected_failed_version,
    v_target_version,p_target_converter_sha256,v_reason
  ) on conflict(request_id) do nothing returning * into v_event;
  if not found then
    select event.* into v_event
    from public.lukas_drawing_ifc_derivative_requeue_events event
    where event.request_id=p_request_id;
    if not found
      or v_event.job_id is distinct from p_job_id
      or v_event.project_id is distinct from p_project_id
      or v_event.source_file_id is distinct from p_source_file_id
      or v_event.source_sha256 is distinct from p_source_sha256
      or v_event.failed_derivative_version is distinct from p_expected_failed_version
      or v_event.target_converter_sha256 is distinct from p_target_converter_sha256
      or v_event.reason is distinct from v_reason
    then
      raise exception using errcode='PIF07',
        message='IFC derivative requeue request conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'status','queued','jobId',v_event.job_id,
      'generation',v_event.to_generation,
      'targetVersion',v_event.target_derivative_version,
      'converterSha256',v_event.target_converter_sha256,
      'requestId',v_event.request_id
    );
  end if;

  update public.lukas_drawing_ifc_derivative_jobs job
  set status='queued',generation=v_to_generation,
    target_version=v_target_version,
    converter_sha256=p_target_converter_sha256,
    attempt_count=0,claimed_version=null,lease_token=null,
    lease_expires_at=null,next_attempt_at=v_now,
    last_error_code=null,last_error_message=null,updated_at=v_now
  where job.id=p_job_id;

  return pg_catalog.jsonb_build_object(
    'status','queued','jobId',p_job_id,'generation',v_to_generation,
    'targetVersion',v_target_version,
    'converterSha256',p_target_converter_sha256,
    'requestId',p_request_id
  );
end;
$$;

revoke all on function
  public.lukas_drawing_requeue_failed_ifc_derivative_job(
    uuid,uuid,uuid,text,bigint,text,uuid,text
  )
from public,anon,authenticated,service_role;
grant execute on function
  public.lukas_drawing_requeue_failed_ifc_derivative_job(
    uuid,uuid,uuid,text,bigint,text,uuid,text
  )
to service_role;

alter default privileges revoke execute on functions from public;

commit;
