begin;

alter table public.lukas_drawing_native_dwg_resave_jobs
  drop constraint lukas_drawing_native_dwg_resave_jobs_status_check,
  add check(status in ('queued','processing','retry_wait','cancel_requested','cancelled','no_changes','failed','completed')),
  drop constraint lukas_drawing_native_dwg_resave_jobs_failure_code_check,
  add check(failure_code in ('source_unavailable','source_mismatch','resaver_failed','output_invalid','worker_interrupted','authority_revoked','upload_failed','publication_failed'));
alter table public.lukas_drawing_native_dwg_resave_attempts
  add column upload_state text not null default 'not_started' check(upload_state in ('not_started','open','closed')),
  add column upload_closed_at timestamptz,
  add check((upload_state='closed')=(upload_closed_at is not null)),
  add check(upload_state<>'open' or outcome is null),
  add unique(project_id,job_id,attempt_number),
  drop constraint lukas_drawing_native_dwg_resave_attempts_outcome_check,
  add check(outcome in ('retry_wait','failed','expired','cancelled','completed')),
  drop constraint lukas_drawing_native_dwg_resave_attempts_failure_code_check,
  add check(failure_code in ('source_unavailable','source_mismatch','resaver_failed','output_invalid','worker_interrupted','authority_revoked','upload_failed','publication_failed'));
create index drawing_resave_open_idx on public.lukas_drawing_native_dwg_resave_attempts(job_id) where upload_state='open';
create index drawing_resave_latest_idx on public.lukas_drawing_native_dwg_resave_jobs(project_id,created_at desc,id desc);

create table public.lukas_drawing_native_dwg_resave_artifacts (
  project_id uuid not null,
  job_id uuid not null,
  attempt_number integer not null,
  kind text not null check(kind in ('dwg','edit_request','authority','report')),
  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check(byte_size between case when kind='dwg' then 6 else 1 end and
    case kind when 'dwg' then 209715200 when 'edit_request' then 2097152 when 'authority' then 67108864 else 1048576 end),
  path text not null unique,
  primary key(project_id,job_id,attempt_number,kind),
  foreign key(project_id,job_id,attempt_number) references public.lukas_drawing_native_dwg_resave_attempts(project_id,job_id,attempt_number) on delete cascade,
  check(path='projects/'||project_id::text||'/native-dwg-resave/'||job_id::text||'/'||attempt_number::text||'/'||sha256||'/'||
    case kind when 'dwg' then 'resaved.dwg' when 'edit_request' then 'edit-request.json' when 'authority' then 'authority.json' else 'native-report.json' end)
);
create table public.lukas_drawing_native_dwg_resave_exports (
  job_id uuid primary key,
  project_id uuid not null,
  attempt_number integer not null,
  completed_at timestamptz not null,
  foreign key(project_id,job_id,attempt_number) references public.lukas_drawing_native_dwg_resave_attempts(project_id,job_id,attempt_number) on delete cascade
);
create index drawing_resave_export_attempt_idx on public.lukas_drawing_native_dwg_resave_exports(project_id,job_id,attempt_number);
alter table public.lukas_drawing_native_dwg_resave_artifacts enable row level security;
alter table public.lukas_drawing_native_dwg_resave_artifacts force row level security;
alter table public.lukas_drawing_native_dwg_resave_exports enable row level security;
alter table public.lukas_drawing_native_dwg_resave_exports force row level security;
revoke all on public.lukas_drawing_native_dwg_resave_artifacts,public.lukas_drawing_native_dwg_resave_exports from public,anon,authenticated,service_role,lukas_drawing_collaboration;

create or replace function private.lukas_drawing_native_dwg_resave_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    if private.lukas_drawing_native_dwg_delete_allowed(old.project_id,tg_relid) then return old; end if;
    raise exception using errcode='PNR11',message='Native DWG resave is unavailable';
  end if;
  if tg_table_name='lukas_drawing_native_dwg_resave_jobs' then
    if (pg_catalog.to_jsonb(new)-array['status','attempt_count','lease_token','lease_expires_at','next_attempt_at','failure_code']) is distinct from
      (pg_catalog.to_jsonb(old)-array['status','attempt_count','lease_token','lease_expires_at','next_attempt_at','failure_code'])
      or (old.status in ('no_changes','cancelled','failed','completed') and new is distinct from old)
    then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
    if exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=old.id and upload_state='open')
      and (new.status not in ('processing','cancel_requested') or new.attempt_count is distinct from old.attempt_count or new.lease_token is distinct from old.lease_token)
    then raise exception using errcode='PNR13',message='Native DWG resave upload is open'; end if;
  elsif tg_table_name='lukas_drawing_native_dwg_resave_attempts' then
    if (pg_catalog.to_jsonb(new)-array['outcome','finished_at','failure_code','upload_state','upload_closed_at']) is distinct from
      (pg_catalog.to_jsonb(old)-array['outcome','finished_at','failure_code','upload_state','upload_closed_at'])
      or (old.outcome is not null and new is distinct from old)
      or (old.upload_state='closed' and (new.upload_state is distinct from old.upload_state or new.upload_closed_at is distinct from old.upload_closed_at))
      or (old.upload_state='open' and new.upload_state not in ('open','closed'))
      or (old.upload_state='not_started' and new.upload_state not in ('not_started','open'))
    then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
    if new.outcome is distinct from old.outcome and exists(
      select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=old.job_id and upload_state='open')
    then raise exception using errcode='PNR13',message='Native DWG resave upload is open'; end if;
  else
    raise exception using errcode='PNR11',message='Native DWG resave is immutable';
  end if;
  return new;
end;
$$;
create trigger drawing_resave_artifacts_guard before update or delete on public.lukas_drawing_native_dwg_resave_artifacts for each row execute function private.lukas_drawing_native_dwg_resave_guard();
create trigger drawing_resave_exports_guard before update or delete on public.lukas_drawing_native_dwg_resave_exports for each row execute function private.lukas_drawing_native_dwg_resave_guard();

-- Project/job locks serialize all sessions; the exact attempt is locked next.
create function public.lukas_drawing_stage_native_dwg_resave(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_artifacts jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; a public.lukas_drawing_native_dwg_resave_attempts%rowtype;
  context jsonb; m jsonb; n integer:=0; kinds text[]:=array['dwg','edit_request','authority','report']; k text; bytes numeric; maximum bigint; stored jsonb;
begin
  if not private.lukas_drawing_native_dwg_import_service() then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
  select * into a from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and attempt_number=p_attempt_number for update;
  if j.id is null or a.job_id is null or a.lease_token is distinct from p_lease_token
    or j.attempt_count is distinct from p_attempt_number or j.lease_token is distinct from p_lease_token
    or j.status<>'processing' or a.outcome is not null
    or j.lease_expires_at<=pg_catalog.clock_timestamp() or a.lease_expires_at<=pg_catalog.clock_timestamp()
  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
  if p_artifacts is null or pg_catalog.jsonb_typeof(p_artifacts)<>'array' then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
  if pg_catalog.jsonb_array_length(p_artifacts)<>4 then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
  for m in select value from pg_catalog.jsonb_array_elements(p_artifacts) loop
    n:=n+1; k:=kinds[n];
    if pg_catalog.jsonb_typeof(m)<>'object' or not m?&array['kind','sha256','byteSize'] or m-array['kind','sha256','byteSize']<>'{}'::jsonb
      or m->>'kind' is distinct from k or pg_catalog.jsonb_typeof(m->'sha256') is distinct from 'string'
      or m->>'sha256'!~'^[0-9a-f]{64}$' or pg_catalog.jsonb_typeof(m->'byteSize') is distinct from 'number'
    then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
    bytes:=(m->>'byteSize')::numeric;
    maximum:=case k when 'dwg' then 209715200 when 'edit_request' then 2097152 when 'authority' then 67108864 else 1048576 end;
    if bytes<>pg_catalog.trunc(bytes) or bytes not between (case when k='dwg' then 6 else 1 end) and maximum
    then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
  end loop;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind',kind,'sha256',sha256,'byteSize',byte_size)
    order by pg_catalog.array_position(kinds,kind)) into stored
    from public.lukas_drawing_native_dwg_resave_artifacts where project_id=j.project_id and job_id=j.id and attempt_number=a.attempt_number;
  if stored is not null and stored is distinct from p_artifacts then raise exception using errcode='PNR12',message='Native DWG resave artifacts conflict'; end if;
  if p_artifacts#>>'{1,sha256}' is distinct from j.attestation#>>'{request,sha256}'
    or p_artifacts#>'{1,byteSize}' is distinct from j.attestation#>'{request,byteSize}'
    or p_artifacts#>>'{2,sha256}' is distinct from j.attestation#>>'{authority,sha256}'
    or p_artifacts#>'{2,byteSize}' is distinct from j.attestation#>'{authority,byteSize}'
  then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
  context:=private.lukas_drawing_native_dwg_resave_context(j.requested_by,j.scope);
  if context->'source' is distinct from j.source or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true
  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  if j.lease_expires_at<=pg_catalog.clock_timestamp() or a.lease_expires_at<=pg_catalog.clock_timestamp()
  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
  if a.upload_state='not_started' then
    insert into public.lukas_drawing_native_dwg_resave_artifacts(project_id,job_id,attempt_number,kind,sha256,byte_size,path)
      select j.project_id,j.id,a.attempt_number,item->>'kind',item->>'sha256',(item->>'byteSize')::bigint,
        'projects/'||j.project_id::text||'/native-dwg-resave/'||j.id::text||'/'||a.attempt_number::text||'/'||(item->>'sha256')||'/'||
        case item->>'kind' when 'dwg' then 'resaved.dwg' when 'edit_request' then 'edit-request.json' when 'authority' then 'authority.json' else 'native-report.json' end
      from pg_catalog.jsonb_array_elements(p_artifacts) item;
    update public.lukas_drawing_native_dwg_resave_attempts set upload_state='open' where job_id=j.id and attempt_number=a.attempt_number returning * into a;
  elsif stored is null then
    raise exception using errcode='PNR13',message='Native DWG resave lease is stale';
  end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind',kind,'sha256',sha256,'byteSize',byte_size,'path',path)
    order by pg_catalog.array_position(kinds,kind)) into stored
    from public.lukas_drawing_native_dwg_resave_artifacts where project_id=j.project_id and job_id=j.id and attempt_number=a.attempt_number;
  return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',a.attempt_number,'leaseToken',a.lease_token,'uploadState',a.upload_state,'artifacts',stored);
end;
$$;

create function public.lukas_drawing_close_native_dwg_resave_upload(p_job_id uuid,p_attempt_number integer,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; a public.lukas_drawing_native_dwg_resave_attempts%rowtype;
begin
  if not private.lukas_drawing_native_dwg_import_service() then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
  select * into a from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and attempt_number=p_attempt_number for update;
  if j.id is null or a.job_id is null or a.lease_token is distinct from p_lease_token or a.upload_state='not_started'
  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
  if a.upload_state='open' then
    update public.lukas_drawing_native_dwg_resave_attempts set upload_state='closed',upload_closed_at=pg_catalog.clock_timestamp() where job_id=j.id and attempt_number=a.attempt_number;
  end if;
  return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',a.attempt_number,'leaseToken',a.lease_token,'uploadState','closed');
end;
$$;

create function private.lukas_drawing_native_dwg_resave_receipt(p_job_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select pg_catalog.jsonb_build_object('schemaVersion','1hk-dwg-resave-receipt/1','jobId',j.id,'attemptNumber',e.attempt_number,
    'scope',j.scope,'resaverImageId',j.resaver_image_id,'sourceSha256',j.source->'sha256','qualification','experimental-unqualified',
    'persistenceAuthority','not-issued','artifacts',(select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object('kind',r.kind,'sha256',r.sha256,'byteSize',r.byte_size)
      order by pg_catalog.array_position(array['dwg','edit_request','authority','report'],r.kind))
      from public.lukas_drawing_native_dwg_resave_artifacts r where r.project_id=e.project_id and r.job_id=e.job_id and r.attempt_number=e.attempt_number),
    'createdAt',e.completed_at)
  from public.lukas_drawing_native_dwg_resave_jobs j
  join public.lukas_drawing_native_dwg_resave_exports e on e.project_id=j.project_id and e.job_id=j.id
  join public.lukas_drawing_native_dwg_resave_attempts a on a.project_id=e.project_id and a.job_id=e.job_id and a.attempt_number=e.attempt_number
  where j.id=p_job_id and j.status='completed' and a.outcome='completed' and a.upload_state='closed'
$$;

create function public.lukas_drawing_publish_native_dwg_resave(p_job_id uuid,p_attempt_number integer,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; a public.lukas_drawing_native_dwg_resave_attempts%rowtype; context jsonb; receipt jsonb; t timestamptz;
begin
  if not private.lukas_drawing_native_dwg_import_service() then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
  select * into a from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and attempt_number=p_attempt_number for update;
  if j.id is null or a.job_id is null or a.lease_token is distinct from p_lease_token
  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
  receipt:=private.lukas_drawing_native_dwg_resave_receipt(j.id);
  if receipt is not null then
    if (receipt->>'attemptNumber')::integer<>a.attempt_number then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
    return receipt;
  end if;
  if j.status<>'processing' or j.attempt_count<>a.attempt_number or j.lease_token is distinct from a.lease_token
    or a.outcome is not null or a.upload_state<>'closed'
    or exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and upload_state='open')
    or j.lease_expires_at<=pg_catalog.clock_timestamp() or a.lease_expires_at<=pg_catalog.clock_timestamp()
    or (select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_artifacts where project_id=j.project_id and job_id=j.id and attempt_number=a.attempt_number)<>4
  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
  context:=private.lukas_drawing_native_dwg_resave_context(j.requested_by,j.scope);
  if context->'source' is distinct from j.source or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true
  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  t:=pg_catalog.clock_timestamp();
  if j.lease_expires_at<=t or a.lease_expires_at<=t then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
  insert into public.lukas_drawing_native_dwg_resave_exports(job_id,project_id,attempt_number,completed_at) values(j.id,j.project_id,a.attempt_number,t);
  update public.lukas_drawing_native_dwg_resave_attempts set outcome='completed',finished_at=t,failure_code=null where job_id=j.id and attempt_number=a.attempt_number;
  update public.lukas_drawing_native_dwg_resave_jobs set status='completed',failure_code=null where id=j.id;
  return private.lukas_drawing_native_dwg_resave_receipt(j.id);
end;
$$;

create function public.lukas_drawing_native_dwg_resave_receipt(p_scope jsonb,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; context jsonb; receipt jsonb;
begin
  if private.lukas_qto_verified_session() is not true then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  context:=private.lukas_drawing_native_dwg_resave_context((select auth.uid()),p_scope);
  if context is null then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  select * into j from public.lukas_drawing_native_dwg_resave_jobs where id=p_job_id and scope=p_scope;
  if j.id is null or context->'source' is distinct from j.source
    or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true
  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  receipt:=private.lukas_drawing_native_dwg_resave_receipt(j.id);
  if receipt is null then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  return receipt;
end;
$$;

create function public.lukas_drawing_native_dwg_resave_download_descriptor(p_scope jsonb,p_job_id uuid,p_kind text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt jsonb; descriptor jsonb;
begin
  receipt:=public.lukas_drawing_native_dwg_resave_receipt(p_scope,p_job_id);
  select pg_catalog.jsonb_build_object('jobId',a.job_id,'attemptNumber',a.attempt_number,'kind',a.kind,'bucket','lukas-qto','path',a.path,'sha256',a.sha256,'byteSize',a.byte_size)
    into descriptor from public.lukas_drawing_native_dwg_resave_artifacts a
    where a.project_id=(receipt#>>'{scope,projectId}')::uuid and a.job_id=p_job_id and a.attempt_number=(receipt->>'attemptNumber')::integer and a.kind=p_kind;
  if descriptor is null then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  return descriptor;
end;
$$;

create policy "reserve native dwg resave managed prefix"
on storage.objects as restrictive for all to authenticated,anon
using (bucket_id<>'lukas-qto' or coalesce((storage.foldername(name))[1],'')<>'projects' or coalesce((storage.foldername(name))[3],'')<>'native-dwg-resave')
with check (bucket_id<>'lukas-qto' or coalesce((storage.foldername(name))[1],'')<>'projects' or coalesce((storage.foldername(name))[3],'')<>'native-dwg-resave');

revoke all on function private.lukas_drawing_native_dwg_resave_receipt(uuid) from public,anon,authenticated,service_role,lukas_drawing_collaboration;
revoke all on function public.lukas_drawing_stage_native_dwg_resave(uuid,integer,uuid,jsonb),public.lukas_drawing_close_native_dwg_resave_upload(uuid,integer,uuid),public.lukas_drawing_publish_native_dwg_resave(uuid,integer,uuid),public.lukas_drawing_native_dwg_resave_receipt(jsonb,uuid),public.lukas_drawing_native_dwg_resave_download_descriptor(jsonb,uuid,text) from public,anon,authenticated,service_role,lukas_drawing_collaboration;
grant execute on function public.lukas_drawing_stage_native_dwg_resave(uuid,integer,uuid,jsonb),public.lukas_drawing_close_native_dwg_resave_upload(uuid,integer,uuid),public.lukas_drawing_publish_native_dwg_resave(uuid,integer,uuid) to service_role;
grant execute on function public.lukas_drawing_native_dwg_resave_receipt(jsonb,uuid),public.lukas_drawing_native_dwg_resave_download_descriptor(jsonb,uuid,text) to authenticated;

create or replace function public.lukas_drawing_claim_native_dwg_resave(p_resaver_image_id text,p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; j public.lukas_drawing_native_dwg_resave_jobs%rowtype; context jsonb; t timestamptz; token uuid; expires timestamptz;
begin
  if not private.lukas_drawing_native_dwg_import_service() or p_resaver_image_id is null or p_resaver_image_id!~'^sha256:[0-9a-f]{64}$' or p_lease_seconds is null or p_lease_seconds not between 180 and 900
  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  for candidate in select id,project_id from public.lukas_drawing_native_dwg_resave_jobs where resaver_image_id=p_resaver_image_id
    and ((status in ('queued','retry_wait') and next_attempt_at<=pg_catalog.clock_timestamp()) or (status in ('processing','cancel_requested') and lease_expires_at<=pg_catalog.clock_timestamp())) order by created_at,id
  loop
    perform 1 from public.lukas_qto_projects where id=candidate.project_id for update skip locked;
    if not found then continue; end if;
    select * into j from public.lukas_drawing_native_dwg_resave_jobs where id=candidate.id for update skip locked;
    if not found then continue; end if;
    perform 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id order by attempt_number for update;
    if exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and upload_state='open') then continue; end if;
    t:=pg_catalog.clock_timestamp();
    if j.resaver_image_id<>p_resaver_image_id or not ((j.status in ('queued','retry_wait') and j.next_attempt_at<=t) or (j.status in ('processing','cancel_requested') and j.lease_expires_at<=t)) then continue; end if;
    if j.status='cancel_requested' then
      update public.lukas_drawing_native_dwg_resave_attempts set outcome='cancelled',finished_at=t where job_id=j.id and attempt_number=j.attempt_count and outcome is null;
      update public.lukas_drawing_native_dwg_resave_jobs set status='cancelled' where id=j.id;
      continue;
    end if;
    if j.status='processing' then
      update public.lukas_drawing_native_dwg_resave_attempts set outcome='expired',finished_at=t,failure_code='worker_interrupted' where job_id=j.id and attempt_number=j.attempt_count and outcome is null;
    end if;
    context:=private.lukas_drawing_native_dwg_resave_context(j.requested_by,j.scope);
    if context->'source' is distinct from j.source or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true or j.attempt_count>=3 then
      update public.lukas_drawing_native_dwg_resave_jobs set status='failed',failure_code=case when j.attempt_count>=3 then 'worker_interrupted' else 'authority_revoked' end where id=j.id;
      continue;
    end if;
    token:=extensions.gen_random_uuid(); expires:=t+p_lease_seconds*interval '1 second';
    insert into public.lukas_drawing_native_dwg_resave_attempts(job_id,project_id,attempt_number,lease_token,started_at,lease_expires_at) values(j.id,j.project_id,j.attempt_count+1,token,t,expires);
    update public.lukas_drawing_native_dwg_resave_jobs set status='processing',attempt_count=j.attempt_count+1,lease_token=token,lease_expires_at=expires,failure_code=null where id=j.id;
    return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',j.attempt_count+1,'leaseToken',token,'leaseExpiresAt',expires,'actorId',j.requested_by,'scope',j.scope,'source',j.source,'attestation',j.attestation,'payload',context->'payload');
  end loop;
  return null;
end;
$$;

create or replace function public.lukas_drawing_fail_native_dwg_resave(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_failure_code text,p_retryable boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; context jsonb; state text; code text:=p_failure_code; t timestamptz;
begin
  if not private.lukas_drawing_native_dwg_import_service() or p_retryable is null or p_failure_code is null or p_failure_code not in ('source_unavailable','source_mismatch','resaver_failed','output_invalid','worker_interrupted','authority_revoked','upload_failed','publication_failed') then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
  if j.id is null or j.status<>'processing' or p_attempt_number is distinct from j.attempt_count or p_lease_token is distinct from j.lease_token or j.lease_expires_at<=pg_catalog.clock_timestamp() then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
  perform 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id order by attempt_number for update;
  if exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and upload_state='open')
  then raise exception using errcode='PNR13',message='Native DWG resave upload is open'; end if;
  context:=private.lukas_drawing_native_dwg_resave_context(j.requested_by,j.scope);
  state:=case when p_retryable and p_failure_code in ('source_unavailable','resaver_failed','worker_interrupted','upload_failed','publication_failed') and j.attempt_count<3 then 'retry_wait' else 'failed' end;
  if context->'source' is distinct from j.source or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true then state:='failed'; code:='authority_revoked'; end if;
  t:=pg_catalog.clock_timestamp();
  if j.lease_expires_at<=t then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
  update public.lukas_drawing_native_dwg_resave_attempts set outcome=state,finished_at=t,failure_code=code where job_id=j.id and attempt_number=j.attempt_count;
  update public.lukas_drawing_native_dwg_resave_jobs set status=state,failure_code=code,next_attempt_at=t+j.attempt_count*interval '30 seconds' where id=j.id;
  return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',j.attempt_count,'leaseToken',j.lease_token,'status',state);
end;
$$;

create or replace function public.lukas_drawing_ack_native_dwg_resave_cancel(p_job_id uuid,p_attempt_number integer,p_lease_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype;
begin
  if not private.lukas_drawing_native_dwg_import_service() then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
  if j.id is null or p_attempt_number is null or p_lease_token is null or p_attempt_number is distinct from j.attempt_count or p_lease_token is distinct from j.lease_token or j.status not in ('cancel_requested','cancelled') then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
  perform 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id order by attempt_number for update;
  if exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and upload_state='open')
  then raise exception using errcode='PNR13',message='Native DWG resave upload is open'; end if;
  if j.status='cancel_requested' then
    update public.lukas_drawing_native_dwg_resave_attempts set outcome='cancelled',finished_at=pg_catalog.clock_timestamp() where job_id=j.id and attempt_number=j.attempt_count;
    update public.lukas_drawing_native_dwg_resave_jobs set status='cancelled' where id=j.id;
  end if;
  return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',j.attempt_count,'leaseToken',j.lease_token,'status','cancelled');
end;
$$;

create or replace function public.lukas_drawing_native_dwg_resave_status(p_scope jsonb,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype;
begin
  if private.lukas_qto_verified_session() is not true or private.lukas_drawing_native_dwg_resave_source_for_actor((select auth.uid()),p_scope) is null
  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  select * into j from public.lukas_drawing_native_dwg_resave_jobs where project_id=(p_scope->>'projectId')::uuid and (p_job_id is null or id=p_job_id) and scope=p_scope order by created_at desc,id desc limit 1;
  if not found and p_job_id is null then return null; end if;
  if not found then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
  return pg_catalog.jsonb_build_object('jobId',j.id,'requestId',j.request_id,'status',j.status,'attemptCount',j.attempt_count,'failureCode',j.failure_code,'hasChanges',j.attestation->'request'<>'null'::jsonb);
end;
$$;

create or replace function private.lukas_qto_project_retention_storage_files(
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
    union all
    select native.path,native.sha256,native.byte_size
    from public.lukas_drawing_native_dwg_artifacts native
    where native.project_id=p_project_id
    union all
    select resave.path,resave.sha256,resave.byte_size
    from public.lukas_drawing_native_dwg_resave_artifacts resave
    where resave.project_id=p_project_id
  ) artifact
  order by artifact.path,artifact.sha256,artifact.byte_size
$$;

create or replace function private.lukas_qto_project_retention_dependencies(
  p_project_id uuid
) returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'approvedDrawingRevisions',(select pg_catalog.count(*)
      from public.lukas_drawing_revisions r where r.project_id=p_project_id
        and r.status in('approved','superseded')),
    'drawingRevisionApprovals',(select pg_catalog.count(*)
      from public.lukas_drawing_revision_approvals a
      where a.project_id=p_project_id and a.decision='approved'),
    'drawingIssueApprovals',(select pg_catalog.count(*)
      from public.lukas_drawing_issue_approvals a
      where a.project_id=p_project_id and a.decision='approved'),
    'approvedBoqVersions',(select pg_catalog.count(*)
      from public.lukas_qto_boq_versions b where b.project_id=p_project_id
        and b.status in('approved','superseded')),
    'drawingQuantityLinks',(select pg_catalog.count(*)
      from public.lukas_drawing_quantity_links q where q.project_id=p_project_id),
    'drawingBoqLinks',(select pg_catalog.count(*)
      from public.lukas_drawing_boq_links b where b.project_id=p_project_id),
    'drawingMaterialLinks',(select pg_catalog.count(*)
      from public.lukas_drawing_material_links m where m.project_id=p_project_id),
    'materialTransactions',(select pg_catalog.count(*)
      from public.lukas_qto_material_transactions m where m.project_id=p_project_id),
    'publishedLibraryVersions',(select pg_catalog.count(*)
      from public.lukas_drawing_library_versions v
      where v.source_project_id=p_project_id
        and v.status in('published','deprecated')),
    'libraryImports',(select pg_catalog.count(*)
      from public.lukas_drawing_library_imports i where i.project_id=p_project_id),
    'immutableFiles',(select pg_catalog.count(*)
      from public.lukas_qto_files f
      where f.project_id=p_project_id and f.immutable),
    'nativeDwgResaveJobs',(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_jobs where project_id=p_project_id),
    'nativeDwgResaveArtifacts',(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_artifacts where project_id=p_project_id),
    'nativeDwgResaveExports',(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_exports where project_id=p_project_id),
    'nativeDwgResaveOpenUploads',(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_attempts where project_id=p_project_id and upload_state='open'),
    'nativeDwgJobs',(select pg_catalog.count(*)
      from public.lukas_drawing_native_dwg_jobs job
      where job.project_id=p_project_id),
    'nativeDwgArtifacts',(select pg_catalog.count(*)
      from public.lukas_drawing_native_dwg_artifacts artifact
      where artifact.project_id=p_project_id),
    'nativeDwgOpenUploads',(select pg_catalog.count(*)
      from public.lukas_drawing_native_dwg_attempts attempt
      where attempt.project_id=p_project_id and attempt.upload_state='open')
  )
$$;

create or replace function public.lukas_qto_purge_project(
  p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project public.lukas_qto_projects%rowtype; v_dependencies jsonb;
declare v_request public.lukas_qto_retention_events%rowtype;
declare v_event public.lukas_qto_retention_events%rowtype;
declare v_active_holds bigint; v_protected bigint; v_active_ifc_jobs bigint;
declare v_active_native_jobs bigint; v_native_open_uploads bigint;
declare v_sha text; v_status text; v_files jsonb; v_manifest_sha text;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='P7R07',
      message='Trusted purge requires service authority';
  end if;
  if p_request_id is null
    or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000
  then raise exception using errcode='P7R05',
    message='Purge request is invalid'; end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      'purge',p_organization_id,p_project_id,pg_catalog.btrim(p_reason)
    )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text,0)
  );
  select * into v_event from public.lukas_qto_retention_events event
  where event.actor_id is null and event.request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then
      raise exception using errcode='P7R05',
        message='Retention request identity was reused'; end if;
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

  select * into v_project from public.lukas_qto_projects project
  where project.id=p_project_id and project.organization_id=p_organization_id
  for update;
  if not found then raise exception using errcode='P7R06',
    message='Project retention target is unavailable'; end if;
  perform job.id from public.lukas_drawing_ifc_derivative_jobs job
  where job.project_id=p_project_id order by job.id for update;
  perform job.id from public.lukas_drawing_native_dwg_jobs job
  where job.project_id=p_project_id order by job.id for update;
  perform job.id from public.lukas_drawing_native_dwg_resave_jobs job
  where job.project_id=p_project_id order by job.id for update;
  select pg_catalog.count(*) into v_active_ifc_jobs
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.project_id=p_project_id
    and job.status in ('queued','processing','retry_wait');
  select pg_catalog.count(*) into v_active_native_jobs
  from public.lukas_drawing_native_dwg_jobs job
  where job.project_id=p_project_id
    and job.status in ('queued','processing','retry_wait');
  select pg_catalog.count(*) into v_native_open_uploads
  from public.lukas_drawing_native_dwg_attempts attempt
  where attempt.project_id=p_project_id and attempt.upload_state='open';

  v_active_native_jobs:=v_active_native_jobs+(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_jobs where project_id=p_project_id and status in ('queued','processing','retry_wait','cancel_requested'));
  v_native_open_uploads:=v_native_open_uploads+(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_attempts where project_id=p_project_id and upload_state='open');
  select * into v_request from public.lukas_qto_retention_events event
  where event.organization_id=p_organization_id and event.project_id=p_project_id
    and event.event_type='deletion_requested'
  order by event.created_at desc,event.id desc limit 1;
  if not found then raise exception using errcode='P7R08',
    message='Project deletion was not requested'; end if;
  select pg_catalog.count(*) into v_active_holds
  from public.lukas_qto_retention_events placed
  where placed.organization_id=p_organization_id
    and placed.project_id=p_project_id
    and placed.event_type='legal_hold_placed'
    and not exists(select 1 from public.lukas_qto_retention_events released
      where released.event_type='legal_hold_released'
        and released.releases_event_id=placed.id);
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
    when v_active_native_jobs>0 then 'active_native_dwg_jobs'
    when v_native_open_uploads>0 then 'native_dwg_uploads_open'
    when pg_catalog.jsonb_array_length(v_files)>0
      then 'storage_deletion_required'
    else 'purged'
  end;
  insert into public.lukas_qto_retention_events(
    organization_id,project_id,event_type,request_id,request_sha256,
    reason,evidence,actor_id
  ) values(
    p_organization_id,p_project_id,
    case when v_status='purged' then 'project_purged'
      when v_status='storage_deletion_required' then 'purge_storage_ready'
      else 'purge_denied' end,
    p_request_id,v_sha,pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object(
      'status',v_status,'requestEventId',v_request.id,
      'purgeAfter',v_request.purge_after,'activeLegalHolds',v_active_holds,
      'activeIfcDerivativeJobs',v_active_ifc_jobs,
      'activeNativeDwgJobs',v_active_native_jobs,
      'nativeDwgOpenUploads',v_native_open_uploads,
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
  where project.id=p_project_id and project.organization_id=p_organization_id;
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
declare v_active_native_jobs bigint; v_native_open_uploads bigint;
declare v_derivative_prefix text; v_native_prefix text;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='P7R07',
      message='Trusted purge requires service authority';
  end if;
  if p_ready_event_id is null or p_request_id is null
    or p_manifest_sha256!~'^[0-9a-f]{64}$'
    or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000
  then raise exception using errcode='P7R05',
    message='Purge finalization request is invalid'; end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      'finalize_purge',p_organization_id,p_project_id,p_ready_event_id,
      p_manifest_sha256,pg_catalog.btrim(p_reason)
    )::text,'UTF8'),'sha256'),'hex');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_request_id::text,0)
  );
  select * into v_event from public.lukas_qto_retention_events event
  where event.actor_id is null and event.request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then
      raise exception using errcode='P7R05',
        message='Retention request identity was reused'; end if;
    return pg_catalog.jsonb_build_object(
      'status','PURGED','eventId',v_event.id,
      'dependencies',v_event.evidence->'dependencies'
    );
  end if;

  select * into v_project from public.lukas_qto_projects project
  where project.id=p_project_id and project.organization_id=p_organization_id
  for update;
  if not found then raise exception using errcode='P7R06',
    message='Project retention target is unavailable'; end if;
  perform job.id from public.lukas_drawing_ifc_derivative_jobs job
  where job.project_id=p_project_id order by job.id for update;
  perform job.id from public.lukas_drawing_native_dwg_jobs job
  where job.project_id=p_project_id order by job.id for update;
  perform job.id from public.lukas_drawing_native_dwg_resave_jobs job
  where job.project_id=p_project_id order by job.id for update;
  select pg_catalog.count(*) into v_active_ifc_jobs
  from public.lukas_drawing_ifc_derivative_jobs job
  where job.project_id=p_project_id
    and job.status in ('queued','processing','retry_wait');
  select pg_catalog.count(*) into v_active_native_jobs
  from public.lukas_drawing_native_dwg_jobs job
  where job.project_id=p_project_id
    and job.status in ('queued','processing','retry_wait');
  select pg_catalog.count(*) into v_native_open_uploads
  from public.lukas_drawing_native_dwg_attempts attempt
  where attempt.project_id=p_project_id and attempt.upload_state='open';
  v_active_native_jobs:=v_active_native_jobs+(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_jobs where project_id=p_project_id and status in ('queued','processing','retry_wait','cancel_requested'));
  v_native_open_uploads:=v_native_open_uploads+(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_attempts where project_id=p_project_id and upload_state='open');
  if v_active_ifc_jobs>0 then raise exception using errcode='P7R08',
    message='Project IFC derivative jobs changed'; end if;
  if v_active_native_jobs>0 or v_native_open_uploads>0 then
    raise exception using errcode='P7R08',
      message='Project native DWG export state changed'; end if;

  select * into v_ready from public.lukas_qto_retention_events event
  where event.id=p_ready_event_id and event.organization_id=p_organization_id
    and event.project_id=p_project_id
    and event.event_type='purge_storage_ready';
  if not found or v_ready.evidence->>'manifestSha256'<>p_manifest_sha256 then
    raise exception using errcode='P7R05',
      message='Purge storage manifest is unavailable'; end if;
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
  )<>p_manifest_sha256 then raise exception using errcode='P7R05',
    message='Purge storage manifest changed'; end if;
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
    or exists(select 1 from public.lukas_qto_retention_events placed
      where placed.organization_id=p_organization_id
        and placed.project_id=p_project_id
        and placed.event_type='legal_hold_placed'
        and not exists(select 1 from public.lukas_qto_retention_events released
          where released.event_type='legal_hold_released'
            and released.releases_event_id=placed.id))
  then raise exception using errcode='P7R08',
    message='Project purge dependencies changed'; end if;
  if pg_catalog.to_regclass('storage.objects') is null then
    raise exception using errcode='P7R09',
      message='Storage deletion confirmation authority unavailable'; end if;
  execute 'select exists(select 1 from storage.objects '
    ||'where bucket_id=''lukas-qto'' and name=any($1))'
  into v_storage_exists using v_paths;
  if v_storage_exists then raise exception using errcode='P7R09',
    message='Immutable Storage deletion is incomplete'; end if;
  v_derivative_prefix:='projects/'||p_project_id::text||'/ifc-derivatives/';
  execute 'select exists(select 1 from storage.objects '
    ||'where bucket_id=''lukas-qto'' '
    ||'and pg_catalog.left(name,pg_catalog.char_length($1))=$1)'
  into v_storage_exists using v_derivative_prefix;
  if v_storage_exists then raise exception using errcode='P7R09',
    message='IFC derivative Storage deletion is incomplete'; end if;
  v_native_prefix:='projects/'||p_project_id::text||'/native-dwg/';
  execute 'select exists(select 1 from storage.objects '
    ||'where bucket_id=''lukas-qto'' '
    ||'and pg_catalog.left(name,pg_catalog.char_length($1))=$1)'
  into v_storage_exists using v_native_prefix;
  if v_storage_exists then raise exception using errcode='P7R09',
    message='Native DWG Storage deletion is incomplete'; end if;
  v_native_prefix:='projects/'||p_project_id::text||'/native-dwg-resave/';
  execute 'select exists(select 1 from storage.objects '
    ||'where bucket_id=''lukas-qto'' '
    ||'and pg_catalog.left(name,pg_catalog.char_length($1))=$1)'
  into v_storage_exists using v_native_prefix;
  if v_storage_exists then raise exception using errcode='P7R09',
    message='Native DWG resave Storage deletion is incomplete'; end if;
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
  where project.id=p_project_id and project.organization_id=p_organization_id;
  return pg_catalog.jsonb_build_object(
    'status','PURGED','eventId',v_event.id,'dependencies',v_dependencies
  );
end;
$$;

commit;
