begin;

-- Operational queue state is mutable; derivative rows remain append-only
-- evidence. Source identity and the exact verified Storage claim are frozen at
-- enqueue time so a worker never receives a reconstructed source reference.
create table public.lukas_drawing_ifc_derivative_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null,
  source_file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_storage_path text not null check (
    source_storage_path !~ '(^/|//|/\.\.?/|^$)'
    and pg_catalog.char_length(source_storage_path) <= 1000
  ),
  source_byte_size bigint not null check (source_byte_size >= 0),
  requested_by uuid not null references auth.users(id) on delete restrict,
  status text not null default 'queued' check (
    status in ('queued','processing','retry_wait','completed','failed')
  ),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  claimed_version bigint check (claimed_version > 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  last_error_code text check (last_error_code ~ '^[a-z0-9_]{1,64}$'),
  last_error_message text check (
    pg_catalog.char_length(last_error_message) between 1 and 500
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint lukas_drawing_ifc_derivative_jobs_source_identity_fkey
    foreign key (source_file_id,project_id,source_sha256)
    references public.lukas_qto_files(id,project_id,sha256) on delete cascade,
  constraint lukas_drawing_ifc_derivative_jobs_source_identity_key
    unique (source_file_id,project_id,source_sha256),
  constraint lukas_drawing_ifc_derivative_jobs_attempts_check
    check (attempt_count <= max_attempts),
  constraint lukas_drawing_ifc_derivative_jobs_state_check check (
    status='queued'
      and attempt_count=0
      and claimed_version is null
      and lease_token is null
      and lease_expires_at is null
      and last_error_code is null
      and last_error_message is null
    or status='processing'
      and attempt_count between 1 and max_attempts
      and claimed_version is not null
      and lease_token is not null
      and lease_expires_at is not null
    or status='retry_wait'
      and attempt_count between 1 and max_attempts-1
      and claimed_version is not null
      and lease_token is not null
      and lease_expires_at is null
      and last_error_code is not null
      and last_error_message is not null
    or status='completed'
      and attempt_count between 1 and max_attempts
      and claimed_version is not null
      and lease_token is not null
      and lease_expires_at is null
      and last_error_code is null
      and last_error_message is null
    or status='failed'
      and attempt_count between 1 and max_attempts
      and claimed_version is not null
      and lease_token is not null
      and lease_expires_at is null
      and last_error_code is not null
      and last_error_message is not null
  )
);

create index lukas_drawing_ifc_derivative_jobs_claim_idx
  on public.lukas_drawing_ifc_derivative_jobs(status,next_attempt_at,created_at)
  where status in ('queued','retry_wait','processing');

create function private.lukas_drawing_ifc_derivative_job_source_guard()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if tg_op='UPDATE' then
    if new.project_id is distinct from old.project_id
      or new.source_file_id is distinct from old.source_file_id
      or new.source_sha256 is distinct from old.source_sha256
      or new.source_storage_path is distinct from old.source_storage_path
      or new.source_byte_size is distinct from old.source_byte_size
      or new.requested_by is distinct from old.requested_by
      or new.max_attempts is distinct from old.max_attempts
      or new.created_at is distinct from old.created_at then
      raise exception using
        errcode='PIF01',
        message='IFC derivative job source identity is immutable';
    end if;
    return new;
  end if;

  if not exists (
    select 1
    from public.lukas_qto_files source
    where source.id=new.source_file_id
      and source.project_id=new.project_id
      and source.sha256=new.source_sha256
      and source.storage_path=new.source_storage_path
      and source.byte_size=new.source_byte_size
      and source.uploaded_by=new.requested_by
      and source.kind='ifc'
      and source.immutable
  ) then
    raise exception using
      errcode='23514',
      message='IFC derivative job requires an immutable IFC source';
  end if;
  return new;
end;
$$;

create trigger lukas_drawing_ifc_derivative_jobs_source_guard
before insert or update on public.lukas_drawing_ifc_derivative_jobs
for each row execute function private.lukas_drawing_ifc_derivative_job_source_guard();

create function private.lukas_drawing_enqueue_ifc_derivative_job()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.lukas_drawing_ifc_derivative_jobs(
    project_id,source_file_id,source_sha256,source_storage_path,
    source_byte_size,requested_by
  ) values(
    new.project_id,new.id,new.sha256,new.storage_path,new.byte_size,new.uploaded_by
  ) on conflict(source_file_id,project_id,source_sha256) do nothing;
  return new;
end;
$$;

create trigger lukas_qto_files_enqueue_ifc_derivative_job
after insert on public.lukas_qto_files
for each row
when (new.kind='ifc' and new.immutable)
execute function private.lukas_drawing_enqueue_ifc_derivative_job();

-- Install-time backfill is idempotent and intentionally creates no pending
-- derivative evidence. Queue state remains the only pending signal.
insert into public.lukas_drawing_ifc_derivative_jobs(
  project_id,source_file_id,source_sha256,source_storage_path,
  source_byte_size,requested_by
)
select source.project_id,source.id,source.sha256,source.storage_path,
  source.byte_size,source.uploaded_by
from public.lukas_qto_files source
where source.kind='ifc' and source.immutable
on conflict(source_file_id,project_id,source_sha256) do nothing;

alter table public.lukas_drawing_ifc_derivative_jobs enable row level security;
alter table public.lukas_drawing_ifc_derivative_jobs force row level security;
revoke all on table public.lukas_drawing_ifc_derivative_jobs
from public,anon,authenticated,service_role;

create function public.lukas_drawing_claim_ifc_derivative_job(
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
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
  v_version bigint;
  v_token uuid;
  v_now timestamptz;
  v_derivative_status text;
begin
  if p_lease_seconds not between 30 and 900 then
    raise exception using
      errcode='22023',
      message='IFC derivative lease must be between 30 and 900 seconds';
  end if;

  loop
    v_now:=pg_catalog.clock_timestamp();
    select job.* into v_job
    from public.lukas_drawing_ifc_derivative_jobs job
    where (
      job.status in ('queued','retry_wait')
      and job.next_attempt_at<=v_now
    ) or (
      job.status='processing'
      and job.lease_expires_at<=v_now
    )
    order by
      case when job.status='processing'
        then job.lease_expires_at else job.next_attempt_at end,
      job.created_at,job.id
    for update skip locked
    limit 1;
    if not found then
      return;
    end if;

    -- A worker that disappears on its final lease still converges to one
    -- immutable terminal derivative rather than remaining processing forever.
    if v_job.status='processing'
      and v_job.attempt_count>=v_job.max_attempts then
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
        ) on conflict(source_file_id,project_id,version) do nothing;

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
          raise exception using
            errcode='PIF04',
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

create function public.lukas_drawing_complete_ifc_derivative_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_derivative_version bigint,
  p_derivative_id uuid
) returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
  v_ready boolean;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  select job.* into v_job
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.id=p_job_id
  for update;
  if not found then
    raise exception using errcode='PIF02',message='IFC derivative lease is unavailable';
  end if;
  if v_job.lease_token is distinct from p_lease_token
    or v_job.claimed_version is distinct from p_derivative_version then
    raise exception using errcode='PIF02',message='IFC derivative lease identity is stale';
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
  if v_job.status<>'processing'
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at<=v_now then
    raise exception using errcode='PIF02',message='IFC derivative lease identity is stale';
  end if;
  if not v_ready then
    raise exception using errcode='PIF03',message='Exact ready derivative was not found';
  end if;

  update public.lukas_drawing_ifc_derivative_jobs job
  set status='completed',lease_expires_at=null,last_error_code=null,
    last_error_message=null,updated_at=v_now
  where job.id=v_job.id;
  return 'completed';
end;
$$;

create function public.lukas_drawing_fail_ifc_derivative_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_derivative_version bigint,
  p_retryable boolean,
  p_error_code text,
  p_error_message text
) returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
  v_now timestamptz:=pg_catalog.clock_timestamp();
  v_error_code text;
  v_error_message text;
  v_derivative_status text;
begin
  select job.* into v_job
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.id=p_job_id
  for update;
  if not found then
    raise exception using errcode='PIF02',message='IFC derivative lease is unavailable';
  end if;
  if v_job.lease_token is distinct from p_lease_token
    or v_job.claimed_version is distinct from p_derivative_version then
    raise exception using errcode='PIF02',message='IFC derivative lease identity is stale';
  end if;

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
  if v_job.status in ('retry_wait','failed') then
    return v_job.status;
  end if;
  if v_job.status='completed' then
    raise exception using errcode='PIF03',message='Exact ready derivative was not found';
  end if;
  if v_job.status<>'processing'
    or v_job.lease_expires_at is null
    or v_job.lease_expires_at<=v_now then
    raise exception using errcode='PIF02',message='IFC derivative lease identity is stale';
  end if;

  v_error_code:=pg_catalog.left(
    pg_catalog.lower(pg_catalog.regexp_replace(
      coalesce(p_error_code,''),'[^a-zA-Z0-9_]+','_','g'
    )),64
  );
  if v_error_code='' then
    v_error_code:='conversion_failed';
  end if;
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
  ) on conflict(source_file_id,project_id,version) do nothing;

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
    raise exception using
      errcode='PIF04',
      message='IFC derivative version is occupied by nonterminal evidence';
  end if;

  update public.lukas_drawing_ifc_derivative_jobs job
  set status='failed',lease_expires_at=null,last_error_code=v_error_code,
    last_error_message=v_error_message,updated_at=v_now
  where job.id=v_job.id;
  return 'failed';
end;
$$;

-- The workspace gets only a non-sensitive projection. Returning null for an
-- absent or unauthorized source avoids turning this RPC into a file oracle.
create function public.lukas_drawing_ifc_derivative_job_status(
  p_source_file_id uuid,
  p_source_sha256 text
) returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_job public.lukas_drawing_ifc_derivative_jobs%rowtype;
begin
  if (select auth.uid()) is null then
    return null;
  end if;
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
  if not found then
    return null;
  end if;
  return pg_catalog.jsonb_build_object(
    'state',v_job.status,
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

revoke all on function private.lukas_drawing_ifc_derivative_job_source_guard(),
  private.lukas_drawing_enqueue_ifc_derivative_job()
from public,anon,authenticated,service_role;

revoke all on function public.lukas_drawing_claim_ifc_derivative_job(integer),
  public.lukas_drawing_complete_ifc_derivative_job(uuid,uuid,bigint,uuid),
  public.lukas_drawing_fail_ifc_derivative_job(uuid,uuid,bigint,boolean,text,text),
  public.lukas_drawing_ifc_derivative_job_status(uuid,text)
from public,anon,authenticated,service_role;

grant execute on function public.lukas_drawing_claim_ifc_derivative_job(integer),
  public.lukas_drawing_complete_ifc_derivative_job(uuid,uuid,bigint,uuid),
  public.lukas_drawing_fail_ifc_derivative_job(uuid,uuid,bigint,boolean,text,text)
to service_role;
grant execute on function public.lukas_drawing_ifc_derivative_job_status(uuid,text)
to authenticated;

alter default privileges revoke execute on functions from public;

commit;
