begin;

-- A job is the mutable scheduler record. Every conversion attempt still owns
-- a new immutable derivative version; a requeue advances only this generation.
alter table public.lukas_drawing_ifc_derivative_jobs
  add column generation integer not null default 1,
  add column target_version bigint,
  add column converter_sha256 text,
  add constraint lukas_drawing_ifc_derivative_jobs_generation_check
    check(generation>0),
  add constraint lukas_drawing_ifc_derivative_jobs_converter_sha256_check
    check(
      converter_sha256 is null
      or converter_sha256~'^[0-9a-f]{64}$'
    );

update public.lukas_drawing_ifc_derivative_jobs job
set target_version=coalesce(
  job.claimed_version,
  (
    select coalesce(pg_catalog.max(derivative.version),0)+1
    from public.lukas_drawing_ifc_derivatives derivative
    where derivative.project_id=job.project_id
      and derivative.source_file_id=job.source_file_id
      and derivative.source_sha256=job.source_sha256
  )
);

alter table public.lukas_drawing_ifc_derivative_jobs
  alter column target_version set not null,
  alter column target_version set default 1,
  add constraint lukas_drawing_ifc_derivative_jobs_target_version_check
    check(target_version>0);

create table public.lukas_drawing_ifc_derivative_requeue_events(
  id uuid primary key default extensions.gen_random_uuid(),
  job_id uuid not null references
    public.lukas_drawing_ifc_derivative_jobs(id) on delete cascade,
  project_id uuid not null,
  source_file_id uuid not null,
  source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),
  request_id uuid not null unique,
  from_generation integer not null check(from_generation>0),
  to_generation integer not null,
  failed_derivative_version bigint not null check(failed_derivative_version>0),
  target_derivative_version bigint not null,
  target_converter_sha256 text not null check(
    target_converter_sha256~'^[0-9a-f]{64}$'
  ),
  reason text not null check(pg_catalog.char_length(reason) between 1 and 500),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint lukas_drawing_ifc_derivative_requeue_generation_check check(
    to_generation=from_generation+1
  ),
  constraint lukas_drawing_ifc_derivative_requeue_version_check check(
    target_derivative_version=failed_derivative_version+1
  ),
  constraint lukas_drawing_ifc_derivative_requeue_job_generation_key
    unique(job_id,to_generation)
);

create function private.lukas_drawing_ifc_derivative_requeue_update_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='42501',
    message='IFC derivative requeue audit is append-only';
end;
$$;

create trigger lukas_drawing_ifc_derivative_requeue_update_guard
before update on public.lukas_drawing_ifc_derivative_requeue_events
for each row execute function
  private.lukas_drawing_ifc_derivative_requeue_update_guard();

-- Reuse the retention-authorized nested-delete contract already protecting the
-- job. Audit evidence cannot be deleted directly but does leave with its job
-- during the same project purge cascade.
create trigger lukas_drawing_ifc_derivative_requeue_delete_guard
before delete on public.lukas_drawing_ifc_derivative_requeue_events
for each row execute function
  private.lukas_drawing_ifc_derivative_job_retention_delete_guard();

alter table public.lukas_drawing_ifc_derivative_requeue_events
  enable row level security;
alter table public.lukas_drawing_ifc_derivative_requeue_events
  force row level security;
revoke all on table public.lukas_drawing_ifc_derivative_requeue_events
from public,anon,authenticated,service_role;

create function public.lukas_drawing_requeue_failed_ifc_derivative_job(
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
  if exists(
    select 1 from public.lukas_qto_retention_events event
    where event.project_id=p_project_id
      and event.event_type='purge_storage_ready'
  ) then
    raise exception using errcode='PIF05',
      message='IFC derivative requeue is blocked by project purge';
  end if;

  -- An exact request replay returns the original decision, not current queue
  -- state. Different payloads may never borrow another request identity.
  select event.* into v_event
  from public.lukas_drawing_ifc_derivative_requeue_events event
  where event.request_id=p_request_id;
  if found then
    if v_event.job_id<>p_job_id
      or v_event.project_id<>p_project_id
      or v_event.source_file_id<>p_source_file_id
      or v_event.source_sha256<>p_source_sha256
      or v_event.failed_derivative_version<>p_expected_failed_version
      or v_event.target_converter_sha256<>p_target_converter_sha256
      or v_event.reason<>v_reason
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
      or v_event.job_id<>p_job_id
      or v_event.project_id<>p_project_id
      or v_event.source_file_id<>p_source_file_id
      or v_event.source_sha256<>p_source_sha256
      or v_event.failed_derivative_version<>p_expected_failed_version
      or v_event.target_converter_sha256<>p_target_converter_sha256
      or v_event.reason<>v_reason
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

create function public.lukas_drawing_claim_ifc_derivative_job_for_converter(
  p_converter_sha256 text,
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
  attempt_count integer,
  generation integer,
  converter_sha256 text
) language plpgsql security definer set search_path='' as $$
declare v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
declare v_candidate_job_id uuid; v_candidate_project_id uuid;
declare v_project_id uuid; v_version bigint; v_token uuid;
declare v_now timestamptz; v_derivative_status text;
begin
  if p_converter_sha256 is null
    or p_converter_sha256!~'^[0-9a-f]{64}$'
  then
    raise exception using errcode='22023',
      message='IFC derivative converter identity is invalid';
  end if;
  if p_lease_seconds not between 30 and 900 then
    raise exception using errcode='22023',
      message='IFC derivative lease must be between 30 and 900 seconds';
  end if;
  loop
    v_now:=pg_catalog.clock_timestamp();
    select job.id,job.project_id
    into v_candidate_job_id,v_candidate_project_id
    from public.lukas_drawing_ifc_derivative_jobs job
    where (
      job.status in ('queued','retry_wait') and job.next_attempt_at<=v_now
      or job.status='processing' and job.lease_expires_at<=v_now
    )
    and (job.converter_sha256 is null
      or job.converter_sha256=p_converter_sha256)
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
    if not found then return; end if;

    select project.id into v_project_id
    from public.lukas_qto_projects project
    where project.id=v_candidate_project_id
    for update;
    if not found then continue; end if;
    select job.* into v_job
    from public.lukas_drawing_ifc_derivative_jobs job
    where job.id=v_candidate_job_id
      and (
        job.status in ('queued','retry_wait') and job.next_attempt_at<=v_now
        or job.status='processing' and job.lease_expires_at<=v_now
      )
      and (job.converter_sha256 is null
        or job.converter_sha256=p_converter_sha256)
    for update skip locked;
    if not found then continue; end if;
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

    v_version:=v_job.target_version;
    if v_job.claimed_version is not null
      and v_job.claimed_version<>v_version
    then
      raise exception using errcode='PIF04',
        message='IFC derivative target version does not match its lease';
    end if;
    if v_job.claimed_version is null then
      select derivative.status into v_derivative_status
      from public.lukas_drawing_ifc_derivatives derivative
      where derivative.project_id=v_job.project_id
        and derivative.source_file_id=v_job.source_file_id
        and derivative.source_sha256=v_job.source_sha256
        and derivative.version=v_version;
      if v_derivative_status='ready' then
        update public.lukas_drawing_ifc_derivative_jobs job
        set status='completed',claimed_version=v_version,
          lease_expires_at=null,last_error_code=null,
          last_error_message=null,updated_at=v_now
        where job.id=v_job.id;
        continue;
      elsif v_derivative_status is not null then
        raise exception using errcode='PIF04',
          message='IFC derivative target version is already occupied';
      end if;
    end if;

    v_token:=extensions.gen_random_uuid();
    update public.lukas_drawing_ifc_derivative_jobs job
    set status='processing',attempt_count=job.attempt_count+1,
      converter_sha256=coalesce(job.converter_sha256,p_converter_sha256),
      claimed_version=v_version,lease_token=v_token,
      lease_expires_at=v_now+(p_lease_seconds*interval '1 second'),
      last_error_code=null,last_error_message=null,updated_at=v_now
    where job.id=v_job.id;
    return query select
      v_job.id,v_job.project_id,v_job.source_file_id,
      v_job.source_storage_path,v_job.source_byte_size,v_job.source_sha256,
      v_job.requested_by,v_version,v_token,
      v_now+(p_lease_seconds*interval '1 second'),v_job.attempt_count+1,
      v_job.generation,coalesce(v_job.converter_sha256,p_converter_sha256);
    return;
  end loop;
end;
$$;

-- The UI projection exposes the scheduler generation and intended immutable
-- version, so a current requeue can truthfully outrank legacy failed evidence.
create or replace function public.lukas_drawing_ifc_derivative_job_status(
  p_source_file_id uuid,
  p_source_sha256 text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
begin
  if (select auth.uid()) is null then return null; end if;
  select job.* into v_job
  from public.lukas_drawing_ifc_derivative_jobs job
  join public.lukas_qto_files source
    on source.id=job.source_file_id
   and source.project_id=job.project_id
   and source.sha256=job.source_sha256
  where source.id=p_source_file_id
    and source.sha256=p_source_sha256
    and source.kind='ifc'
    and source.immutable
    and private.lukas_qto_project_role(source.project_id) is not null;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'state',v_job.status,
    'generation',v_job.generation,
    'targetVersion',v_job.target_version,
    'attemptCount',v_job.attempt_count,
    'availableAt',case
      when v_job.status in ('queued','retry_wait') then v_job.next_attempt_at
      when v_job.status='processing' then v_job.lease_expires_at
      else null
    end,
    'updatedAt',v_job.updated_at,
    'errorCode',case
      when v_job.status in ('retry_wait','failed') then v_job.last_error_code
      else null
    end
  );
end;
$$;

revoke all on function
  private.lukas_drawing_ifc_derivative_requeue_update_guard()
from public,anon,authenticated,service_role;
revoke all on function
  public.lukas_drawing_requeue_failed_ifc_derivative_job(
    uuid,uuid,uuid,text,bigint,text,uuid,text
  ),
  public.lukas_drawing_claim_ifc_derivative_job_for_converter(text,integer),
  public.lukas_drawing_ifc_derivative_job_status(uuid,text),
  public.lukas_drawing_claim_ifc_derivative_job(integer)
from public,anon,authenticated,service_role;
grant execute on function
  public.lukas_drawing_requeue_failed_ifc_derivative_job(
    uuid,uuid,uuid,text,bigint,text,uuid,text
  ),
  public.lukas_drawing_claim_ifc_derivative_job_for_converter(text,integer)
to service_role;
grant execute on function
  public.lukas_drawing_ifc_derivative_job_status(uuid,text)
to authenticated;

alter default privileges revoke execute on functions from public;

commit;
