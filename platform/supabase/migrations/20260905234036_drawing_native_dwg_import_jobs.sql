-- Durable analysis evidence only: this grants no drawing persistence authority.
create table public.lukas_drawing_native_dwg_import_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  requested_by uuid not null,
  request_id uuid not null,
  scope jsonb not null,
  source jsonb not null,
  status text not null default 'queued' check(status in ('queued','processing','retry_wait','analyzed','failed')),
  attempt_count integer not null default 0 check(attempt_count between 0 and 3),
  reader_image_id text check(reader_image_id ~ '^sha256:[0-9a-f]{64}$'),
  lease_token uuid,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  failure_code text check(failure_code in ('source_unavailable','source_mismatch','reader_failed','report_invalid','worker_interrupted','authority_revoked')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(requested_by,request_id), unique(id,project_id)
);
create table public.lukas_drawing_native_dwg_import_attempts (
  job_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  attempt_number integer not null check(attempt_number between 1 and 3),
  lease_token uuid not null unique,
  reader_image_id text not null check(reader_image_id ~ '^sha256:[0-9a-f]{64}$'),
  started_at timestamptz not null,
  lease_expires_at timestamptz not null,
  outcome text check(outcome in ('analyzed','retry_wait','failed','expired')),
  finished_at timestamptz,
  failure_code text check(failure_code in ('source_unavailable','source_mismatch','reader_failed','report_invalid','worker_interrupted','authority_revoked')),
  primary key(job_id,attempt_number), unique(job_id,attempt_number,project_id),
  foreign key(job_id,project_id) references public.lukas_drawing_native_dwg_import_jobs(id,project_id) on delete cascade,
  check((outcome is null)=(finished_at is null))
);
create table public.lukas_drawing_native_dwg_import_results (
  job_id uuid primary key,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  attempt_number integer not null,
  reader_image_id text not null check(reader_image_id ~ '^sha256:[0-9a-f]{64}$'),
  report_text text not null check(pg_catalog.octet_length(report_text) between 1 and 33554432),
  report_sha256 text not null check(report_sha256 ~ '^[0-9a-f]{64}$'),
  report_byte_size integer not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  foreign key(job_id,attempt_number,project_id) references public.lukas_drawing_native_dwg_import_attempts(job_id,attempt_number,project_id) on delete cascade,
  check(report_byte_size=pg_catalog.octet_length(pg_catalog.convert_to(report_text,'UTF8'))),
  check(report_sha256=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(report_text,'UTF8'),'sha256'),'hex'))
);
create index lukas_drawing_native_dwg_import_claim_idx on public.lukas_drawing_native_dwg_import_jobs(status,next_attempt_at,created_at,id)
  where status in ('queued','processing','retry_wait');
create index lukas_drawing_native_dwg_import_project_idx on public.lukas_drawing_native_dwg_import_jobs(project_id,status);
create index lukas_drawing_native_dwg_import_attempt_project_idx on public.lukas_drawing_native_dwg_import_attempts(project_id);
create index lukas_drawing_native_dwg_import_result_project_idx on public.lukas_drawing_native_dwg_import_results(project_id);
alter table public.lukas_drawing_native_dwg_import_jobs enable row level security;
alter table public.lukas_drawing_native_dwg_import_jobs force row level security;
alter table public.lukas_drawing_native_dwg_import_attempts enable row level security;
alter table public.lukas_drawing_native_dwg_import_attempts force row level security;
alter table public.lukas_drawing_native_dwg_import_results enable row level security;
alter table public.lukas_drawing_native_dwg_import_results force row level security;
revoke all on public.lukas_drawing_native_dwg_import_jobs,public.lukas_drawing_native_dwg_import_attempts,public.lukas_drawing_native_dwg_import_results from public,anon,authenticated,service_role;

create function private.lukas_drawing_native_dwg_import_scope(p_scope jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare k text; v jsonb:=p_scope;
begin
  if p_scope is null or pg_catalog.jsonb_typeof(p_scope)<>'object' then return null; end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(p_scope))<>7
    or not p_scope?&array['projectId','documentId','revisionId','canvasId','sourceFileId','sourceSha256','unitOverride']
    or pg_catalog.jsonb_typeof(p_scope->'sourceSha256')<>'string'
    or p_scope->>'sourceSha256'!~'^[0-9a-f]{64}$'
    or not (p_scope->'unitOverride'='null'::jsonb or p_scope->'unitOverride' in ('1'::jsonb,'2'::jsonb,'4'::jsonb,'5'::jsonb,'6'::jsonb))
  then return null; end if;
  foreach k in array array['projectId','documentId','revisionId','canvasId','sourceFileId'] loop
    if pg_catalog.jsonb_typeof(p_scope->k)<>'string' or p_scope->>k!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then return null; end if;
    v:=pg_catalog.jsonb_set(v,array[k],pg_catalog.to_jsonb((p_scope->>k)::uuid::text));
  end loop;
  return v;
end;
$$;

create function private.lukas_drawing_native_dwg_import_source(p_actor uuid,p_scope jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('verificationId',v.id,'fileId',f.id,'bucket','lukas-qto','path',f.storage_path,'sha256',f.sha256,'byteSize',f.byte_size,'headerVersion',v.dwg_header_version)
  from auth.users a
  join public.lukas_qto_projects p on p.id=(p_scope->>'projectId')::uuid
  join public.lukas_drawing_documents d on d.id=(p_scope->>'documentId')::uuid and d.project_id=p.id
  join public.lukas_drawing_revisions r on r.id=(p_scope->>'revisionId')::uuid and r.document_id=d.id and r.project_id=p.id
  join public.lukas_drawing_canvases c on c.id=(p_scope->>'canvasId')::uuid and c.revision_id=r.id and c.project_id=p.id
  join public.lukas_qto_files f on f.id=(p_scope->>'sourceFileId')::uuid and f.project_id=p.id
  join public.lukas_qto_verified_uploads v on v.consumed_file_id=f.id
  where a.id=p_actor and not coalesce(a.is_anonymous,false)
    and nullif(pg_catalog.to_jsonb(a)->>'deleted_at','') is null
    and (nullif(pg_catalog.to_jsonb(a)->>'banned_until','') is null or (pg_catalog.to_jsonb(a)->>'banned_until')::timestamptz<=pg_catalog.clock_timestamp())
    and private.lukas_drawing_collaboration_capability_for_user(p_actor,p.id) in ('admin','editor')
    and private.lukas_qto_project_feature_active(p.id,'drawing_workspace')
    and p.archived_at is null and p.deletion_requested_at is null
    and nullif(pg_catalog.to_jsonb(d)->>'archived_at','') is null
    and nullif(pg_catalog.to_jsonb(d)->>'deleted_at','') is null
    and r.status='draft'
    and not exists(select 1 from private.lukas_drawing_collaboration_read_freeze(p.id,r.id) cs where cs.freeze_state in ('freezing','frozen'))
    and f.kind='dwg' and f.immutable and f.sha256=p_scope->>'sourceSha256'
    and f.byte_size between 1 and 209715200
    and v.kind='dwg' and v.project_id=f.project_id and v.storage_path=f.storage_path
    and v.sha256=f.sha256 and v.byte_size=f.byte_size and v.dwg_header_version~'^AC[0-9]{4}$'
    and (select pg_catalog.count(*) from public.lukas_qto_verified_uploads x where x.consumed_file_id=f.id)=1
$$;

create function private.lukas_drawing_native_dwg_import_service()
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(pg_catalog.current_setting('role',true),'')='service_role'
    and coalesce((select auth.jwt()->>'role'),'')='service_role'
$$;
create function private.lukas_drawing_native_dwg_import_receipt(p_job_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',r.attempt_number,'readerImageId',r.reader_image_id,
    'reportSha256',r.report_sha256,'reportByteSize',r.report_byte_size,'source',j.source-'path'-'bucket',
    'qualification','experimental-unqualified','persistenceAuthority','not-issued')
  from public.lukas_drawing_native_dwg_import_jobs j join public.lukas_drawing_native_dwg_import_results r on r.job_id=j.id
  where j.id=p_job_id and j.status='analyzed'
$$;

create function private.lukas_drawing_native_dwg_import_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    if private.lukas_drawing_native_dwg_delete_allowed(old.project_id,tg_relid) then return old; end if;
    raise exception using errcode='42501',message='Native DWG analysis evidence is retained';
  end if;
  if tg_table_name='lukas_drawing_native_dwg_import_results' then
    raise exception using errcode='42501',message='Native DWG analysis evidence is immutable';
  elsif tg_table_name='lukas_drawing_native_dwg_import_jobs' then
    if (pg_catalog.to_jsonb(new)-array['status','attempt_count','reader_image_id','lease_token','lease_expires_at','next_attempt_at','failure_code'])
      is distinct from (pg_catalog.to_jsonb(old)-array['status','attempt_count','reader_image_id','lease_token','lease_expires_at','next_attempt_at','failure_code'])
      or (old.reader_image_id is not null and new.reader_image_id is distinct from old.reader_image_id)
      or (old.status in ('failed','analyzed') and new is distinct from old)
    then raise exception using errcode='42501',message='Native DWG analysis identity is immutable'; end if;
  else
    if (pg_catalog.to_jsonb(new)-array['outcome','finished_at','failure_code']) is distinct from (pg_catalog.to_jsonb(old)-array['outcome','finished_at','failure_code'])
      or (old.outcome is not null and new is distinct from old)
    then raise exception using errcode='42501',message='Native DWG analysis attempt is immutable'; end if;
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_native_dwg_import_jobs_guard before update or delete on public.lukas_drawing_native_dwg_import_jobs for each row execute function private.lukas_drawing_native_dwg_import_guard();
create trigger lukas_drawing_native_dwg_import_attempts_guard before update or delete on public.lukas_drawing_native_dwg_import_attempts for each row execute function private.lukas_drawing_native_dwg_import_guard();
create trigger lukas_drawing_native_dwg_import_results_guard before update or delete on public.lukas_drawing_native_dwg_import_results for each row execute function private.lukas_drawing_native_dwg_import_guard();

create function public.lukas_drawing_request_native_dwg_import(p_scope jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=private.lukas_drawing_native_dwg_import_scope(p_scope); src jsonb; actor uuid:=(select auth.uid()); j public.lukas_drawing_native_dwg_import_jobs%rowtype;
begin
  if s is null or p_request_id is null or actor is null or coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'false' then
    raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  perform 1 from public.lukas_qto_projects where id=(s->>'projectId')::uuid for update;
  src:=private.lukas_drawing_native_dwg_import_source(actor,s);
  if src is null then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  -- Serialize actor/request across projects as well as per-project capacity.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||p_request_id::text,0));
  select * into j from public.lukas_drawing_native_dwg_import_jobs where requested_by=actor and request_id=p_request_id;
  if found then
    if j.scope<>s then raise exception using errcode='PNI02',message='Native DWG analysis request conflicts'; end if;
    if j.source is distinct from src then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
    return pg_catalog.jsonb_build_object('jobId',j.id);
  end if;
  if (select pg_catalog.count(*) from public.lukas_drawing_native_dwg_import_jobs where project_id=(s->>'projectId')::uuid and status in ('queued','processing','retry_wait'))>=5
  then raise exception using errcode='PNI05',message='Native DWG analysis capacity is unavailable'; end if;
  insert into public.lukas_drawing_native_dwg_import_jobs(project_id,requested_by,request_id,scope,source)
    values((s->>'projectId')::uuid,actor,p_request_id,s,src) returning * into j;
  return pg_catalog.jsonb_build_object('jobId',j.id);
end;
$$;
create function public.lukas_drawing_native_dwg_import_status(p_scope jsonb,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb:=private.lukas_drawing_native_dwg_import_scope(p_scope); j public.lukas_drawing_native_dwg_import_jobs%rowtype;
begin
  if s is null or coalesce((select auth.jwt()->>'is_anonymous'),'false')<>'false'
    or private.lukas_drawing_native_dwg_import_source((select auth.uid()),s) is null
  then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  select * into j from public.lukas_drawing_native_dwg_import_jobs where id=p_job_id and scope=s and requested_by=(select auth.uid());
  if not found then return null; end if;
  if j.source is distinct from private.lukas_drawing_native_dwg_import_source(j.requested_by,s) then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  return pg_catalog.jsonb_build_object('jobId',j.id,'status',j.status,'attemptCount',j.attempt_count,'failureCode',j.failure_code,'receipt',private.lukas_drawing_native_dwg_import_receipt(j.id));
end;
$$;
create function public.lukas_drawing_native_dwg_import_result(p_scope jsonb,p_job_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb;
begin
  s:=public.lukas_drawing_native_dwg_import_status(p_scope,p_job_id);
  if s is null or s->>'status'<>'analyzed' then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  return (select pg_catalog.jsonb_build_object('receipt',s->'receipt','reportText',r.report_text) from public.lukas_drawing_native_dwg_import_results r where r.job_id=p_job_id);
end;
$$;

create function public.lukas_drawing_claim_native_dwg_import(p_reader_image_id text,p_lease_seconds integer default 300)
returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate record; j public.lukas_drawing_native_dwg_import_jobs%rowtype; src jsonb; t timestamptz; token uuid; expires timestamptz;
begin
  if not private.lukas_drawing_native_dwg_import_service() or p_reader_image_id is null or p_reader_image_id!~'^sha256:[0-9a-f]{64}$' or p_lease_seconds is null or p_lease_seconds not between 180 and 900
  then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  for candidate in select id,project_id from public.lukas_drawing_native_dwg_import_jobs
    where ((status in ('queued','retry_wait') and next_attempt_at<=pg_catalog.clock_timestamp()) or (status='processing' and lease_expires_at<=pg_catalog.clock_timestamp()))
      and (reader_image_id is null or reader_image_id=p_reader_image_id) order by created_at,id
  loop
    perform 1 from public.lukas_qto_projects where id=candidate.project_id for update skip locked;
    if not found then continue; end if;
    select * into j from public.lukas_drawing_native_dwg_import_jobs where id=candidate.id for update skip locked;
    if not found then continue; end if;
    t:=pg_catalog.clock_timestamp();
    if not ((j.status in ('queued','retry_wait') and j.next_attempt_at<=t) or (j.status='processing' and j.lease_expires_at<=t)) or (j.reader_image_id is not null and j.reader_image_id<>p_reader_image_id) then continue; end if;
    src:=private.lukas_drawing_native_dwg_import_source(j.requested_by,j.scope);
    if j.status='processing' then
      update public.lukas_drawing_native_dwg_import_attempts set outcome='expired',finished_at=t,failure_code='worker_interrupted' where job_id=j.id and attempt_number=j.attempt_count and outcome is null;
    end if;
    if src is distinct from j.source or j.attempt_count>=3 then
      update public.lukas_drawing_native_dwg_import_jobs set status='failed',lease_expires_at=null,failure_code=case when src is distinct from j.source then 'authority_revoked' else 'worker_interrupted' end where id=j.id;
      continue;
    end if;
    token:=extensions.gen_random_uuid(); expires:=t+p_lease_seconds*interval '1 second';
    insert into public.lukas_drawing_native_dwg_import_attempts(job_id,project_id,attempt_number,lease_token,reader_image_id,started_at,lease_expires_at)
      values(j.id,j.project_id,j.attempt_count+1,token,p_reader_image_id,t,expires);
    update public.lukas_drawing_native_dwg_import_jobs set status='processing',attempt_count=j.attempt_count+1,reader_image_id=p_reader_image_id,lease_token=token,lease_expires_at=expires,failure_code=null where id=j.id;
    return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',j.attempt_count+1,'leaseToken',token,'leaseExpiresAt',expires,'readerImageId',p_reader_image_id,'actorId',j.requested_by,'scope',j.scope,'source',j.source);
  end loop;
  return null;
end;
$$;

-- Shared lock order for publication/failure. It never grants generic operations.
create function private.lukas_drawing_native_dwg_import_locked_job(p_job_id uuid)
returns public.lukas_drawing_native_dwg_import_jobs language plpgsql security definer set search_path='' as $$
declare p uuid; j public.lukas_drawing_native_dwg_import_jobs%rowtype;
begin
  select project_id into p from public.lukas_drawing_native_dwg_import_jobs where id=p_job_id;
  perform 1 from public.lukas_qto_projects where id=p for update;
  select * into j from public.lukas_drawing_native_dwg_import_jobs where id=p_job_id for update;
  return j;
end;
$$;
create function public.lukas_drawing_complete_native_dwg_import(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_reader_image_id text,p_report_text text,p_report_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_import_jobs%rowtype; r jsonb; h text; bytes integer; old_result public.lukas_drawing_native_dwg_import_results%rowtype;
begin
  if not private.lukas_drawing_native_dwg_import_service() then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  j:=private.lukas_drawing_native_dwg_import_locked_job(p_job_id);
  if j.id is null or p_attempt_number is distinct from j.attempt_count or p_lease_token is distinct from j.lease_token or p_reader_image_id is distinct from j.reader_image_id
    or private.lukas_drawing_native_dwg_import_source(j.requested_by,j.scope) is distinct from j.source
  then raise exception using errcode='PNI03',message='Native DWG analysis lease conflicts'; end if;
  if j.status='analyzed' then
    select * into old_result from public.lukas_drawing_native_dwg_import_results where job_id=j.id;
    if old_result.report_text is distinct from p_report_text or old_result.report_sha256 is distinct from p_report_sha256 then raise exception using errcode='PNI03',message='Native DWG analysis lease conflicts'; end if;
    return private.lukas_drawing_native_dwg_import_receipt(j.id);
  end if;
  if j.status<>'processing' or j.lease_expires_at<=pg_catalog.clock_timestamp() then raise exception using errcode='PNI03',message='Native DWG analysis lease conflicts'; end if;
  bytes:=pg_catalog.octet_length(pg_catalog.convert_to(p_report_text,'UTF8'));
  if bytes is null or bytes not between 1 and 33554432 then raise exception using errcode='PNI04',message='Native DWG analysis report is invalid'; end if;
  h:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_report_text,'UTF8'),'sha256'),'hex');
  if h is distinct from p_report_sha256 then raise exception using errcode='PNI04',message='Native DWG analysis report is invalid'; end if;
  begin r:=p_report_text::jsonb; exception when others then raise exception using errcode='PNI04',message='Native DWG analysis report is invalid'; end;
  if pg_catalog.jsonb_typeof(r) is distinct from 'object'
    or r->'schemaVersion' is distinct from '"1hk-dwg-import/1"'::jsonb
    or r->'qualification' is distinct from '"experimental-unqualified"'::jsonb
    or r->'engine' is distinct from '{"name":"ACadSharp","version":"3.7.1"}'::jsonb
    or r->'coordinateSystem' is distinct from '"WCS_NATIVE_UNITS"'::jsonb
    or r->'source' is distinct from (j.source-'verificationId'-'fileId'-'bucket'-'path')
  then raise exception using errcode='PNI04',message='Native DWG analysis report is invalid'; end if;
  if j.lease_expires_at<=pg_catalog.clock_timestamp() then raise exception using errcode='PNI03',message='Native DWG analysis lease conflicts'; end if;
  insert into public.lukas_drawing_native_dwg_import_results(job_id,project_id,attempt_number,reader_image_id,report_text,report_sha256,report_byte_size)
    values(j.id,j.project_id,j.attempt_count,j.reader_image_id,p_report_text,h,bytes);
  update public.lukas_drawing_native_dwg_import_attempts set outcome='analyzed',finished_at=pg_catalog.clock_timestamp() where job_id=j.id and attempt_number=j.attempt_count;
  update public.lukas_drawing_native_dwg_import_jobs set status='analyzed',failure_code=null where id=j.id;
  return private.lukas_drawing_native_dwg_import_receipt(j.id);
end;
$$;
create function public.lukas_drawing_fail_native_dwg_import(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_failure_code text,p_retryable boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.lukas_drawing_native_dwg_import_jobs%rowtype; state text; code text:=p_failure_code; t timestamptz;
begin
  if not private.lukas_drawing_native_dwg_import_service() or p_failure_code is null or p_failure_code not in ('source_unavailable','source_mismatch','reader_failed','report_invalid','worker_interrupted','authority_revoked') or p_retryable is null
  then raise exception using errcode='PNI01',message='Native DWG analysis is unavailable'; end if;
  j:=private.lukas_drawing_native_dwg_import_locked_job(p_job_id); t:=pg_catalog.clock_timestamp();
  if j.id is null or j.status<>'processing' or p_attempt_number is distinct from j.attempt_count or p_lease_token is distinct from j.lease_token or j.lease_expires_at<=t
  then raise exception using errcode='PNI03',message='Native DWG analysis lease conflicts'; end if;
  state:=case when p_retryable and j.attempt_count<3 then 'retry_wait' else 'failed' end;
  if private.lukas_drawing_native_dwg_import_source(j.requested_by,j.scope) is distinct from j.source then state:='failed'; code:='authority_revoked'; end if;
  update public.lukas_drawing_native_dwg_import_attempts set outcome=state,finished_at=t,failure_code=code where job_id=j.id and attempt_number=j.attempt_count;
  update public.lukas_drawing_native_dwg_import_jobs set status=state,failure_code=code,lease_expires_at=null,next_attempt_at=t+j.attempt_count*interval '30 seconds' where id=j.id;
  return pg_catalog.jsonb_build_object('jobId',j.id,'status',state);
end;
$$;

revoke all on function private.lukas_drawing_native_dwg_import_scope(jsonb),private.lukas_drawing_native_dwg_import_source(uuid,jsonb),private.lukas_drawing_native_dwg_import_service(),private.lukas_drawing_native_dwg_import_receipt(uuid),private.lukas_drawing_native_dwg_import_guard(),private.lukas_drawing_native_dwg_import_locked_job(uuid) from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_request_native_dwg_import(jsonb,uuid),public.lukas_drawing_native_dwg_import_status(jsonb,uuid),public.lukas_drawing_native_dwg_import_result(jsonb,uuid),public.lukas_drawing_claim_native_dwg_import(text,integer),public.lukas_drawing_complete_native_dwg_import(uuid,integer,uuid,text,text,text),public.lukas_drawing_fail_native_dwg_import(uuid,integer,uuid,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_request_native_dwg_import(jsonb,uuid),public.lukas_drawing_native_dwg_import_status(jsonb,uuid),public.lukas_drawing_native_dwg_import_result(jsonb,uuid) to authenticated;
grant execute on function public.lukas_drawing_claim_native_dwg_import(text,integer),public.lukas_drawing_complete_native_dwg_import(uuid,integer,uuid,text,text,text),public.lukas_drawing_fail_native_dwg_import(uuid,integer,uuid,text,boolean) to service_role;
