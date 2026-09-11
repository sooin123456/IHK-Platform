begin;

create table public.lukas_drawing_native_dwg_jobs (
  id uuid primary key default extensions.gen_random_uuid(),
  project_id uuid not null,
  document_id uuid not null,
  revision_id uuid not null,
  revision_version bigint not null check (
    revision_version between 1 and 9007199254740991
  ),
  canvas_id uuid not null,
  snapshot_sha256 text not null check (snapshot_sha256~'^[0-9a-f]{64}$'),
  requested_by uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  status text not null default 'queued' check (
    status in ('queued','processing','retry_wait','completed','failed')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  next_attempt_at timestamptz not null default pg_catalog.clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  writer_build_sha256 text check (
    writer_build_sha256 is null or writer_build_sha256~'^[0-9a-f]{64}$'
  ),
  last_error_code text check (last_error_code is null or last_error_code in (
    'source_unavailable','lease_expired','conversion_failed',
    'verification_failed','upload_failed','publication_failed','budget_exceeded'
  )),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(id,project_id),
  unique(requested_by,request_id),
  constraint lukas_drawing_native_dwg_jobs_project_fkey
    foreign key(project_id) references public.lukas_qto_projects(id)
    on delete cascade,
  constraint lukas_drawing_native_dwg_jobs_revision_fkey
    foreign key(revision_id,document_id,project_id)
    references public.lukas_drawing_revisions(id,document_id,project_id)
    on delete cascade,
  constraint lukas_drawing_native_dwg_jobs_snapshot_fkey
    foreign key(revision_id,project_id,revision_version,snapshot_sha256)
    references public.lukas_drawing_snapshots(
      revision_id,project_id,revision_version,sha256
    ) on delete cascade,
  constraint lukas_drawing_native_dwg_jobs_canvas_fkey
    foreign key(canvas_id,revision_id,project_id)
    references public.lukas_drawing_canvases(id,revision_id,project_id)
    on delete cascade,
  constraint lukas_drawing_native_dwg_jobs_state_check check (
    (status='queued' and attempt_count=0 and lease_token is null
      and lease_expires_at is null and writer_build_sha256 is null
      and last_error_code is null)
    or (status='processing' and attempt_count between 1 and 3
      and lease_token is not null and lease_expires_at is not null
      and writer_build_sha256 is not null and last_error_code is null)
    or (status='retry_wait' and attempt_count between 1 and 2
      and lease_token is not null and lease_expires_at is null
      and writer_build_sha256 is not null and last_error_code is not null)
    or (status='completed' and attempt_count between 1 and 3
      and lease_token is not null and lease_expires_at is null
      and writer_build_sha256 is not null and last_error_code is null)
    or (status='failed' and lease_expires_at is null
      and last_error_code is not null)
  )
);

create table public.lukas_drawing_native_dwg_attempts (
  job_id uuid not null,
  project_id uuid not null,
  attempt_number integer not null check (attempt_number between 1 and 3),
  lease_token uuid not null,
  writer_build_sha256 text not null check (writer_build_sha256~'^[0-9a-f]{64}$'),
  lease_expires_at timestamptz not null,
  structure_sha256 text check (
    structure_sha256 is null or structure_sha256~'^[0-9a-f]{64}$'
  ),
  upload_state text not null default 'not_started' check (
    upload_state in ('not_started','open','closed')
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  closed_at timestamptz,
  primary key(job_id,attempt_number),
  unique(job_id,attempt_number,project_id),
  unique(lease_token),
  constraint lukas_drawing_native_dwg_attempts_job_fkey
    foreign key(job_id,project_id)
    references public.lukas_drawing_native_dwg_jobs(id,project_id)
    on delete cascade,
  check ((upload_state='closed')=(closed_at is not null)),
  check ((upload_state='not_started')=(structure_sha256 is null))
);

create table public.lukas_drawing_native_dwg_artifacts (
  job_id uuid not null,
  project_id uuid not null,
  attempt_number integer not null,
  kind text not null check (
    kind in ('dwg','source_manifest','authority','report')
  ),
  path text not null unique check (
    path!~'(^/|//|/\.\.?/|^$)' and pg_catalog.char_length(path)<=1000
  ),
  sha256 text not null check (sha256~'^[0-9a-f]{64}$'),
  byte_size bigint not null check (
    byte_size>0 and (
      (kind='dwg' and byte_size<=104857600)
      or (kind in ('source_manifest','authority') and byte_size<=20971520)
      or (kind='report' and byte_size<=33554432)
    )
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(job_id,attempt_number,kind),
  constraint lukas_drawing_native_dwg_artifacts_attempt_fkey
    foreign key(job_id,attempt_number,project_id)
    references public.lukas_drawing_native_dwg_attempts(
      job_id,attempt_number,project_id
    ) on delete cascade
);

create table public.lukas_drawing_native_dwg_exports (
  job_id uuid primary key,
  project_id uuid not null,
  attempt_number integer not null,
  structure_sha256 text not null check (structure_sha256~'^[0-9a-f]{64}$'),
  qualification text not null default 'experimental-unqualified'
    check (qualification='experimental-unqualified'),
  completed_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique(job_id,project_id),
  constraint lukas_drawing_native_dwg_exports_job_fkey
    foreign key(job_id,project_id)
    references public.lukas_drawing_native_dwg_jobs(id,project_id)
    on delete cascade,
  constraint lukas_drawing_native_dwg_exports_attempt_fkey
    foreign key(job_id,attempt_number,project_id)
    references public.lukas_drawing_native_dwg_attempts(
      job_id,attempt_number,project_id
    ) on delete cascade
);

create index lukas_drawing_native_dwg_jobs_scope_status_idx
  on public.lukas_drawing_native_dwg_jobs(
    project_id,document_id,revision_id,revision_version,canvas_id,
    snapshot_sha256,created_at desc,id desc
  );
create index lukas_drawing_native_dwg_jobs_claim_idx
  on public.lukas_drawing_native_dwg_jobs(status,next_attempt_at,created_at,id)
  where status in ('queued','retry_wait','processing');
create index lukas_drawing_native_dwg_attempts_project_job_idx
  on public.lukas_drawing_native_dwg_attempts(project_id,job_id,attempt_number);
create index lukas_drawing_native_dwg_artifacts_project_job_idx
  on public.lukas_drawing_native_dwg_artifacts(project_id,job_id,attempt_number);

alter table public.lukas_drawing_native_dwg_jobs enable row level security;
alter table public.lukas_drawing_native_dwg_jobs force row level security;
alter table public.lukas_drawing_native_dwg_attempts enable row level security;
alter table public.lukas_drawing_native_dwg_attempts force row level security;
alter table public.lukas_drawing_native_dwg_artifacts enable row level security;
alter table public.lukas_drawing_native_dwg_artifacts force row level security;
alter table public.lukas_drawing_native_dwg_exports enable row level security;
alter table public.lukas_drawing_native_dwg_exports force row level security;
revoke all on table public.lukas_drawing_native_dwg_jobs,
  public.lukas_drawing_native_dwg_attempts,
  public.lukas_drawing_native_dwg_artifacts,
  public.lukas_drawing_native_dwg_exports
from public,anon,authenticated,service_role;

create function private.lukas_drawing_native_dwg_scope(p_scope jsonb)
returns table(
  project_id uuid,document_id uuid,revision_id uuid,revision_version bigint,
  canvas_id uuid,snapshot_sha256 text
) language plpgsql stable security invoker set search_path='' as $$
begin
  if p_scope is null or pg_catalog.jsonb_typeof(p_scope)<>'object' then
    return;
  end if;
  if (select pg_catalog.count(*)
      from pg_catalog.jsonb_object_keys(p_scope))<>6
    or not p_scope?&array[
      'projectId','documentId','revisionId','revisionVersion','canvasId',
      'snapshotSha256'
    ]
    or pg_catalog.jsonb_typeof(p_scope->'projectId')<>'string'
    or pg_catalog.jsonb_typeof(p_scope->'documentId')<>'string'
    or pg_catalog.jsonb_typeof(p_scope->'revisionId')<>'string'
    or pg_catalog.jsonb_typeof(p_scope->'revisionVersion')<>'number'
    or pg_catalog.jsonb_typeof(p_scope->'canvasId')<>'string'
    or pg_catalog.jsonb_typeof(p_scope->'snapshotSha256')<>'string'
    or p_scope->>'projectId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_scope->>'documentId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_scope->>'revisionId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_scope->>'canvasId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or p_scope->>'revisionVersion'!~'^[1-9][0-9]*$'
    or (p_scope->>'revisionVersion')::numeric>9007199254740991
    or p_scope->>'snapshotSha256'!~'^[0-9a-f]{64}$'
  then return; end if;
  project_id:=(p_scope->>'projectId')::uuid;
  document_id:=(p_scope->>'documentId')::uuid;
  revision_id:=(p_scope->>'revisionId')::uuid;
  revision_version:=(p_scope->>'revisionVersion')::bigint;
  canvas_id:=(p_scope->>'canvasId')::uuid;
  snapshot_sha256:=p_scope->>'snapshotSha256';
  return next;
end;
$$;

create function private.lukas_drawing_native_dwg_source_for_actor(
  p_actor_id uuid,p_project_id uuid,p_document_id uuid,p_revision_id uuid,
  p_revision_version bigint,p_canvas_id uuid,p_snapshot_sha256 text
) returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'projectId',r.project_id,
    'documentId',r.document_id,
    'canvasId',c.id,
    'revision',pg_catalog.jsonb_build_object(
      'id',r.id,'sequence',r.sequence,'version',r.version,'status',r.status
    ),
    'snapshot',pg_catalog.jsonb_build_object(
      'sha256',s.sha256,'schemaVersion',s.schema_version,
      'operationSequence',s.operation_sequence,
      'canonicalJsonText',s.canonical_json::text
    ),
    'approvalDecision','approved'
  )
  from auth.users actor
  join public.lukas_drawing_revisions r
    on r.project_id=p_project_id and r.document_id=p_document_id
      and r.id=p_revision_id and r.version=p_revision_version
  join public.lukas_qto_projects project on project.id=r.project_id
  join public.lukas_drawing_documents d
    on d.id=r.document_id and d.project_id=r.project_id
  join public.lukas_drawing_snapshots s on s.revision_id=r.id
    and s.project_id=r.project_id and s.revision_version=r.version
  join public.lukas_drawing_canvases c
    on c.id=p_canvas_id and c.revision_id=r.id and c.project_id=r.project_id
  where actor.id=p_actor_id
    and coalesce(actor.is_anonymous,false)=false
    and nullif(pg_catalog.to_jsonb(actor)->>'deleted_at','') is null
    and (
      nullif(pg_catalog.to_jsonb(actor)->>'banned_until','') is null
      or (pg_catalog.to_jsonb(actor)->>'banned_until')::timestamptz
        <=pg_catalog.clock_timestamp()
    )
    and (
      project.owner_id=p_actor_id
      or exists(select 1 from public.lukas_qto_project_members member
        where member.project_id=project.id and member.user_id=p_actor_id)
      or actor.raw_app_meta_data->>'role'='hangil_staff'
    )
    and p_project_id is not null and p_document_id is not null
    and p_revision_id is not null
    and p_revision_version between 1 and 9007199254740991
    and p_canvas_id is not null and p_snapshot_sha256~'^[0-9a-f]{64}$'
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
    and c.background_pdf_page is null and c.calibration is null
    and c.output_profile is not null
    and s.canonical_json@>pg_catalog.jsonb_build_object(
      'revision',pg_catalog.jsonb_build_object(
        'id',r.id::text,'documentId',r.document_id::text,
        'projectId',r.project_id::text,'sequence',r.sequence,'version',r.version
      ),
      'operationSequence',s.operation_sequence,
      'canvases',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'id',c.id::text,'pageId',c.page_id::text,'outputProfile',c.output_profile
      ))
    )
    and (select pg_catalog.count(*) from public.lukas_drawing_pages page
      where page.revision_id=r.id and page.project_id=r.project_id)=1
    and (select pg_catalog.count(*) from public.lukas_drawing_canvases canvas
      where canvas.revision_id=r.id and canvas.project_id=r.project_id)=1
    and not exists(select 1 from public.lukas_drawing_pages page
      where page.revision_id=r.id and page.project_id=r.project_id
        and (page.background_source_file_id is not null
          or page.background_source_sha256 is not null
          or page.background_pdf_page is not null or page.calibration is not null))
    and not exists(select 1 from public.lukas_drawing_canvases canvas
      where canvas.revision_id=r.id and canvas.project_id=r.project_id
        and (canvas.background_source_file_id is not null
          or canvas.background_source_sha256 is not null
          or canvas.background_pdf_page is not null or canvas.calibration is not null))
    and not exists(select 1 from public.lukas_drawing_object_sources source
      where source.revision_id=r.id and source.project_id=r.project_id)
    and not exists(select 1 from public.lukas_drawing_revision_ifc_derivatives binding
      where binding.revision_id=r.id and binding.project_id=r.project_id)
    and not exists(select 1 from public.lukas_qto_retention_events event
      where event.project_id=project.id and event.event_type='purge_storage_ready')
$$;

create or replace function public.lukas_qto_drawing_native_dwg_source(
  p_project_id uuid,p_document_id uuid,p_revision_id uuid,
  p_revision_version bigint,p_canvas_id uuid,p_snapshot_sha256 text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_result jsonb; v_actor uuid:=(select auth.uid());
begin
  if v_actor is null or private.lukas_qto_verified_session() is not true
    or private.lukas_qto_project_role(p_project_id) is null
  then raise exception using errcode='PND01',
    message='Approved native DWG source is unavailable'; end if;
  v_result:=private.lukas_drawing_native_dwg_source_for_actor(
    v_actor,p_project_id,p_document_id,p_revision_id,p_revision_version,
    p_canvas_id,p_snapshot_sha256
  );
  if v_result is null then raise exception using errcode='PND01',
    message='Approved native DWG source is unavailable'; end if;
  return v_result;
exception when sqlstate 'PND01' then raise;
  when others then raise exception using errcode='PND01',
    message='Approved native DWG source is unavailable';
end;
$$;

create function private.lukas_drawing_native_dwg_receipt(p_job_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'jobId',job.id,'attempt',export.attempt_number,
    'qualification',export.qualification,
    'source',pg_catalog.jsonb_build_object(
      'projectId',job.project_id,'documentId',job.document_id,
      'revisionId',job.revision_id,'revisionVersion',job.revision_version,
      'canvasId',job.canvas_id,'snapshotSha256',job.snapshot_sha256
    ),
    'writerBuildSha256',job.writer_build_sha256,
    'structureSha256',export.structure_sha256,
    'artifacts',(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'kind',artifact.kind,'sha256',artifact.sha256,'byteSize',artifact.byte_size
    ) order by case artifact.kind when 'dwg' then 1 when 'source_manifest' then 2
      when 'authority' then 3 else 4 end)
      from public.lukas_drawing_native_dwg_artifacts artifact
      where artifact.job_id=job.id
        and artifact.attempt_number=export.attempt_number),
    'createdAt',export.completed_at
  )
  from public.lukas_drawing_native_dwg_jobs job
  join public.lukas_drawing_native_dwg_exports export on export.job_id=job.id
  where job.id=p_job_id
$$;

create function public.lukas_drawing_request_native_dwg_export(
  p_scope jsonb,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_scope record; v_source jsonb;
declare v_project_id uuid; v_job public.lukas_drawing_native_dwg_jobs%rowtype;
begin
  select * into v_scope from private.lukas_drawing_native_dwg_scope(p_scope);
  if v_actor is null or p_request_id is null or not found
    or private.lukas_qto_verified_session() is not true
    or private.lukas_qto_project_role(v_scope.project_id) is null
  then raise exception using errcode='PNJ01',
    message='Native DWG export scope is unavailable'; end if;
  select project.id into v_project_id from public.lukas_qto_projects project
  where project.id=v_scope.project_id for update;
  if not found then raise exception using errcode='PNJ01',
    message='Native DWG export scope is unavailable'; end if;
  v_source:=private.lukas_drawing_native_dwg_source_for_actor(
    v_actor,v_scope.project_id,v_scope.document_id,v_scope.revision_id,
    v_scope.revision_version,v_scope.canvas_id,v_scope.snapshot_sha256
  );
  if v_source is null then raise exception using errcode='PNJ01',
    message='Native DWG export scope is unavailable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':'||p_request_id::text,0
  ));
  select * into v_job from public.lukas_drawing_native_dwg_jobs job
  where job.requested_by=v_actor and job.request_id=p_request_id;
  if found then
    if (v_job.project_id,v_job.document_id,v_job.revision_id,
        v_job.revision_version,v_job.canvas_id,v_job.snapshot_sha256)
      is distinct from
       (v_scope.project_id,v_scope.document_id,v_scope.revision_id,
        v_scope.revision_version,v_scope.canvas_id,v_scope.snapshot_sha256)
    then raise exception using errcode='PNJ02',
      message='Native DWG export request identity was reused'; end if;
    return pg_catalog.jsonb_build_object(
      'accepted',true,'jobId',v_job.id,'requestId',v_job.request_id
    );
  end if;
  if (select pg_catalog.count(*)
      from public.lukas_drawing_native_dwg_jobs job
      where job.project_id=v_scope.project_id
        and job.status in ('queued','processing','retry_wait'))>=5
  then raise exception using errcode='PNJ05',
    message='Native DWG export project capacity is unavailable'; end if;
  insert into public.lukas_drawing_native_dwg_jobs(
    project_id,document_id,revision_id,revision_version,canvas_id,
    snapshot_sha256,requested_by,request_id
  ) values(
    v_scope.project_id,v_scope.document_id,v_scope.revision_id,
    v_scope.revision_version,v_scope.canvas_id,v_scope.snapshot_sha256,
    v_actor,p_request_id
  ) returning * into v_job;
  return pg_catalog.jsonb_build_object(
    'accepted',true,'jobId',v_job.id,'requestId',v_job.request_id
  );
exception when sqlstate 'PNJ01' or sqlstate 'PNJ02' or sqlstate 'PNJ05' then raise;
  when others then raise exception using errcode='PNJ01',
    message='Native DWG export scope is unavailable';
end;
$$;

create function public.lukas_drawing_native_dwg_export_status(
  p_scope jsonb,p_job_id uuid default null
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_scope record; v_job record;
declare v_source jsonb;
begin
  select * into v_scope from private.lukas_drawing_native_dwg_scope(p_scope);
  if v_actor is null or not found
    or private.lukas_qto_verified_session() is not true
    or private.lukas_qto_project_role(v_scope.project_id) is null
  then raise exception using errcode='PNJ01',
    message='Native DWG export scope is unavailable'; end if;
  v_source:=private.lukas_drawing_native_dwg_source_for_actor(
    v_actor,v_scope.project_id,v_scope.document_id,v_scope.revision_id,
    v_scope.revision_version,v_scope.canvas_id,v_scope.snapshot_sha256
  );
  if v_source is null then raise exception using errcode='PNJ01',
    message='Native DWG export scope is unavailable'; end if;
  select job.* into v_job from public.lukas_drawing_native_dwg_jobs job
  where job.project_id=v_scope.project_id
    and job.document_id=v_scope.document_id and job.revision_id=v_scope.revision_id
    and job.revision_version=v_scope.revision_version
    and job.canvas_id=v_scope.canvas_id
    and job.snapshot_sha256=v_scope.snapshot_sha256
    and (p_job_id is null or job.id=p_job_id)
  order by job.created_at desc,job.id desc limit 1;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object(
    'jobId',v_job.id,'status',v_job.status,
    'attemptCount',v_job.attempt_count,'lastErrorCode',v_job.last_error_code,
    'createdAt',v_job.created_at,
    'qualification','experimental-unqualified',
    'receipt',case when v_job.status='completed'
      then private.lukas_drawing_native_dwg_receipt(v_job.id) else null end
  );
exception when sqlstate 'PNJ01' then raise;
  when others then raise exception using errcode='PNJ01',
    message='Native DWG export scope is unavailable';
end;
$$;

create function public.lukas_drawing_native_dwg_download_descriptor(
  p_scope jsonb,p_job_id uuid,p_kind text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_scope record; v_result jsonb;
declare v_source jsonb;
begin
  select * into v_scope from private.lukas_drawing_native_dwg_scope(p_scope);
  if v_actor is null or p_job_id is null
    or p_kind not in ('dwg','source_manifest','authority','report')
    or not found or private.lukas_qto_verified_session() is not true
    or private.lukas_qto_project_role(v_scope.project_id) is null
  then raise exception using errcode='PNJ01',
    message='Native DWG export artifact is unavailable'; end if;
  v_source:=private.lukas_drawing_native_dwg_source_for_actor(
    v_actor,v_scope.project_id,v_scope.document_id,v_scope.revision_id,
    v_scope.revision_version,v_scope.canvas_id,v_scope.snapshot_sha256
  );
  if v_source is null then raise exception using errcode='PNJ01',
    message='Native DWG export artifact is unavailable'; end if;
  select pg_catalog.jsonb_build_object(
    'jobId',job.id,'kind',artifact.kind,'bucket','lukas-qto',
    'path',artifact.path,'sha256',artifact.sha256,'byteSize',artifact.byte_size
  ) into v_result
  from public.lukas_drawing_native_dwg_jobs job
  join public.lukas_drawing_native_dwg_exports export on export.job_id=job.id
  join public.lukas_drawing_native_dwg_artifacts artifact
    on artifact.job_id=job.id and artifact.attempt_number=export.attempt_number
      and artifact.kind=p_kind
  where job.id=p_job_id and job.status='completed'
    and job.project_id=v_scope.project_id and job.document_id=v_scope.document_id
    and job.revision_id=v_scope.revision_id
    and job.revision_version=v_scope.revision_version
    and job.canvas_id=v_scope.canvas_id
    and job.snapshot_sha256=v_scope.snapshot_sha256;
  if v_result is null then raise exception using errcode='PNJ01',
    message='Native DWG export artifact is unavailable'; end if;
  return v_result;
exception when sqlstate 'PNJ01' then raise;
  when others then raise exception using errcode='PNJ01',
    message='Native DWG export artifact is unavailable';
end;
$$;

create function private.lukas_drawing_native_dwg_delete_allowed(
  p_project_id uuid,p_relation oid
) returns boolean language sql stable security invoker set search_path='' as $$
  select pg_catalog.pg_trigger_depth()>1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project',true
    )=p_project_id::text
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=p_relation)
    )
    and not exists(select 1 from public.lukas_qto_projects project
      where project.id=p_project_id)
$$;

create function private.lukas_drawing_native_dwg_job_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    if private.lukas_drawing_native_dwg_delete_allowed(old.project_id,tg_relid)
    then return old; end if;
    raise exception using errcode='42501',
      message='Native DWG export jobs are retained';
  end if;
  if new.id is distinct from old.id or new.project_id is distinct from old.project_id
    or new.document_id is distinct from old.document_id
    or new.revision_id is distinct from old.revision_id
    or new.revision_version is distinct from old.revision_version
    or new.canvas_id is distinct from old.canvas_id
    or new.snapshot_sha256 is distinct from old.snapshot_sha256
    or new.requested_by is distinct from old.requested_by
    or new.request_id is distinct from old.request_id
    or new.created_at is distinct from old.created_at
    or (old.writer_build_sha256 is not null
      and new.writer_build_sha256 is distinct from old.writer_build_sha256)
  then raise exception using errcode='42501',
    message='Native DWG export job identity is immutable'; end if;
  return new;
end;
$$;

create function private.lukas_drawing_native_dwg_attempt_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    if private.lukas_drawing_native_dwg_delete_allowed(old.project_id,tg_relid)
    then return old; end if;
    raise exception using errcode='42501',
      message='Native DWG export attempts are retained';
  end if;
  if new.job_id is distinct from old.job_id
    or new.project_id is distinct from old.project_id
    or new.attempt_number is distinct from old.attempt_number
    or new.lease_token is distinct from old.lease_token
    or new.writer_build_sha256 is distinct from old.writer_build_sha256
    or new.lease_expires_at is distinct from old.lease_expires_at
    or new.created_at is distinct from old.created_at
    or (old.structure_sha256 is not null
      and new.structure_sha256 is distinct from old.structure_sha256)
    or not (
      new.upload_state=old.upload_state
      or (old.upload_state='not_started' and new.upload_state='open')
      or (old.upload_state='open' and new.upload_state='closed')
    )
  then raise exception using errcode='42501',
    message='Native DWG export attempt identity is immutable'; end if;
  return new;
end;
$$;

create function private.lukas_drawing_native_dwg_evidence_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE'
    and private.lukas_drawing_native_dwg_delete_allowed(old.project_id,tg_relid)
  then return old; end if;
  raise exception using errcode='42501',
    message='Native DWG export evidence is immutable';
end;
$$;

create trigger lukas_drawing_native_dwg_jobs_guard
before update or delete on public.lukas_drawing_native_dwg_jobs
for each row execute function private.lukas_drawing_native_dwg_job_guard();
create trigger lukas_drawing_native_dwg_attempts_guard
before update or delete on public.lukas_drawing_native_dwg_attempts
for each row execute function private.lukas_drawing_native_dwg_attempt_guard();
create trigger lukas_drawing_native_dwg_artifacts_guard
before update or delete on public.lukas_drawing_native_dwg_artifacts
for each row execute function private.lukas_drawing_native_dwg_evidence_guard();
create trigger lukas_drawing_native_dwg_exports_guard
before update or delete on public.lukas_drawing_native_dwg_exports
for each row execute function private.lukas_drawing_native_dwg_evidence_guard();

create function private.lukas_drawing_native_dwg_service_authorized()
returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce((select auth.jwt()->>'role'),'')='service_role'
$$;

create function public.lukas_drawing_claim_native_dwg_export(
  p_writer_build_sha256 text,p_lease_seconds integer default 900
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_candidate record; v_project_id uuid;
declare v_job public.lukas_drawing_native_dwg_jobs%rowtype;
declare v_source jsonb; v_token uuid; v_now timestamptz; v_attempt integer;
begin
  if not private.lukas_drawing_native_dwg_service_authorized() then
    raise exception using errcode='PNJ03',
      message='Native DWG export lease is unavailable';
  end if;
  if p_writer_build_sha256 is null
    or p_writer_build_sha256!~'^[0-9a-f]{64}$'
    or p_lease_seconds is null
    or p_lease_seconds not between 30 and 900
  then raise exception using errcode='PNJ03',
    message='Native DWG export lease is unavailable'; end if;
  for v_candidate in
    select candidate.id,candidate.project_id
    from public.lukas_drawing_native_dwg_jobs candidate
    where (
      candidate.status in ('queued','retry_wait')
        and candidate.next_attempt_at<=pg_catalog.clock_timestamp()
      or candidate.status='processing'
        and candidate.lease_expires_at<=pg_catalog.clock_timestamp()
    )
      and (candidate.writer_build_sha256 is null
        or candidate.writer_build_sha256=p_writer_build_sha256)
    order by case when candidate.status='processing'
      then candidate.lease_expires_at else candidate.next_attempt_at end,
      candidate.created_at,candidate.id
  loop
    v_project_id:=null;
    select project.id into v_project_id from public.lukas_qto_projects project
    where project.id=v_candidate.project_id for update skip locked;
    if not found then continue; end if;
    select job.* into v_job from public.lukas_drawing_native_dwg_jobs job
    where job.id=v_candidate.id and job.project_id=v_candidate.project_id
    for update skip locked;
    if not found then continue; end if;
    v_now:=pg_catalog.clock_timestamp();
    if not ((v_job.status in ('queued','retry_wait')
          and v_job.next_attempt_at<=v_now)
        or (v_job.status='processing' and v_job.lease_expires_at<=v_now))
      or (v_job.writer_build_sha256 is not null
        and v_job.writer_build_sha256<>p_writer_build_sha256)
    then continue; end if;
    v_source:=private.lukas_drawing_native_dwg_source_for_actor(
      v_job.requested_by,v_job.project_id,v_job.document_id,v_job.revision_id,
      v_job.revision_version,v_job.canvas_id,v_job.snapshot_sha256
    );
    if v_source is null then
      update public.lukas_drawing_native_dwg_jobs job
      set status='failed',lease_expires_at=null,last_error_code='source_unavailable',
        updated_at=v_now where job.id=v_job.id;
      continue;
    end if;
    if v_job.status='processing' and v_job.attempt_count>=3 then
      update public.lukas_drawing_native_dwg_jobs job
      set status='failed',lease_expires_at=null,last_error_code='lease_expired',
        updated_at=v_now where job.id=v_job.id;
      continue;
    end if;
    v_attempt:=v_job.attempt_count+1;
    if v_attempt>3 then
      update public.lukas_drawing_native_dwg_jobs job
      set status='failed',lease_expires_at=null,last_error_code='lease_expired',
        updated_at=v_now where job.id=v_job.id;
      continue;
    end if;
    v_token:=extensions.gen_random_uuid();
    insert into public.lukas_drawing_native_dwg_attempts(
      job_id,project_id,attempt_number,lease_token,writer_build_sha256,
      lease_expires_at
    ) values(
      v_job.id,v_job.project_id,v_attempt,v_token,p_writer_build_sha256,
      v_now+(p_lease_seconds*interval '1 second')
    );
    update public.lukas_drawing_native_dwg_jobs job set
      status='processing',attempt_count=v_attempt,lease_token=v_token,
      lease_expires_at=v_now+(p_lease_seconds*interval '1 second'),
      writer_build_sha256=coalesce(job.writer_build_sha256,p_writer_build_sha256),
      last_error_code=null,updated_at=v_now where job.id=v_job.id;
    return pg_catalog.jsonb_build_object(
      'jobId',v_job.id,'projectId',v_job.project_id,'attempt',v_attempt,
      'leaseToken',v_token,
      'leaseExpiresAt',v_now+(p_lease_seconds*interval '1 second'),
      'writerBuildSha256',p_writer_build_sha256,
      'source',pg_catalog.jsonb_build_object(
        'request',pg_catalog.jsonb_build_object(
          'projectId',v_job.project_id,'documentId',v_job.document_id,
          'revisionId',v_job.revision_id,
          'revisionVersion',v_job.revision_version,
          'canvasId',v_job.canvas_id,'snapshotSha256',v_job.snapshot_sha256
        ),'payload',v_source
      )
    );
  end loop;
  return null;
end;
$$;

create function public.lukas_drawing_stage_native_dwg_export(
  p_job_id uuid,p_attempt integer,p_lease_token uuid,
  p_structure_sha256 text,p_artifacts jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_item jsonb; v_kind text; v_sha text; v_size bigint;
declare v_seen text[]:=array[]::text[]; v_project_id uuid;
declare v_job public.lukas_drawing_native_dwg_jobs%rowtype;
declare v_attempt public.lukas_drawing_native_dwg_attempts%rowtype;
declare v_source jsonb; v_filename text; v_path text; v_result jsonb;
begin
  if not private.lukas_drawing_native_dwg_service_authorized() then
    raise exception using errcode='PNJ03',
      message='Native DWG export lease is unavailable'; end if;
  begin
    if p_job_id is null or p_attempt is null or p_attempt not between 1 and 3
      or p_lease_token is null or p_structure_sha256 is null
      or p_structure_sha256!~'^[0-9a-f]{64}$' or p_artifacts is null
      or pg_catalog.jsonb_typeof(p_artifacts)<>'array'
      or pg_catalog.jsonb_array_length(p_artifacts)<>4
    then raise exception using errcode='PNJ04',
      message='Native DWG export artifact metadata is invalid'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_artifacts)
    loop
      if pg_catalog.jsonb_typeof(v_item)<>'object'
        or (select pg_catalog.count(*)
          from pg_catalog.jsonb_object_keys(v_item))<>3
        or not v_item?&array['kind','sha256','byteSize']
        or pg_catalog.jsonb_typeof(v_item->'kind')<>'string'
        or pg_catalog.jsonb_typeof(v_item->'sha256')<>'string'
        or pg_catalog.jsonb_typeof(v_item->'byteSize')<>'number'
        or v_item->>'kind' not in ('dwg','source_manifest','authority','report')
        or v_item->>'sha256'!~'^[0-9a-f]{64}$'
        or v_item->>'byteSize'!~'^[1-9][0-9]*$'
      then raise exception using errcode='PNJ04',
        message='Native DWG export artifact metadata is invalid'; end if;
      v_kind:=v_item->>'kind'; v_sha:=v_item->>'sha256';
      v_size:=(v_item->>'byteSize')::bigint;
      if v_kind=any(v_seen)
        or (v_kind='dwg' and v_size>104857600)
        or (v_kind in ('source_manifest','authority') and v_size>20971520)
        or (v_kind='report' and v_size>33554432)
      then raise exception using errcode='PNJ04',
        message='Native DWG export artifact metadata is invalid'; end if;
      v_seen:=pg_catalog.array_append(v_seen,v_kind);
    end loop;
  exception when sqlstate 'PNJ04' then raise;
    when others then raise exception using errcode='PNJ04',
      message='Native DWG export artifact metadata is invalid';
  end;
  select candidate.project_id into v_project_id
  from public.lukas_drawing_native_dwg_jobs candidate where candidate.id=p_job_id;
  select project.id into v_project_id from public.lukas_qto_projects project
  where project.id=v_project_id for update;
  if not found then raise exception using errcode='PNJ03',
    message='Native DWG export lease is unavailable'; end if;
  select job.* into v_job from public.lukas_drawing_native_dwg_jobs job
  where job.id=p_job_id for update;
  select attempt.* into v_attempt
  from public.lukas_drawing_native_dwg_attempts attempt
  where attempt.job_id=p_job_id and attempt.attempt_number=p_attempt
    and attempt.lease_token=p_lease_token for update;
  if not found or v_job.status<>'processing'
    or v_job.attempt_count<>p_attempt
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at<=pg_catalog.clock_timestamp()
    or v_attempt.lease_expires_at<=pg_catalog.clock_timestamp()
    or v_attempt.writer_build_sha256 is distinct from v_job.writer_build_sha256
  then raise exception using errcode='PNJ03',
    message='Native DWG export lease is unavailable'; end if;
  v_source:=private.lukas_drawing_native_dwg_source_for_actor(
    v_job.requested_by,v_job.project_id,v_job.document_id,v_job.revision_id,
    v_job.revision_version,v_job.canvas_id,v_job.snapshot_sha256
  );
  if v_source is null then raise exception using errcode='PNJ03',
    message='Native DWG export lease is unavailable'; end if;
  if v_attempt.upload_state<>'not_started' then
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'kind',artifact.kind,'sha256',artifact.sha256,
      'byteSize',artifact.byte_size,'path',artifact.path
    ) order by case artifact.kind when 'dwg' then 1 when 'source_manifest' then 2
      when 'authority' then 3 else 4 end) into v_result
    from public.lukas_drawing_native_dwg_artifacts artifact
    where artifact.job_id=p_job_id and artifact.attempt_number=p_attempt;
    if v_attempt.structure_sha256=p_structure_sha256
      and (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'kind',item->>'kind','sha256',item->>'sha256',
        'byteSize',(item->>'byteSize')::bigint
      ) order by case item->>'kind' when 'dwg' then 1
        when 'source_manifest' then 2 when 'authority' then 3 else 4 end)
        from pg_catalog.jsonb_array_elements(p_artifacts) item)
      =(select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'kind',artifact.kind,'sha256',artifact.sha256,
        'byteSize',artifact.byte_size
      ) order by case artifact.kind when 'dwg' then 1
        when 'source_manifest' then 2 when 'authority' then 3 else 4 end)
        from public.lukas_drawing_native_dwg_artifacts artifact
        where artifact.job_id=p_job_id and artifact.attempt_number=p_attempt)
    then return v_result; end if;
    raise exception using errcode='PNJ04',
      message='Native DWG export artifact identity conflicts';
  end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_artifacts)
  loop
    v_kind:=v_item->>'kind'; v_sha:=v_item->>'sha256';
    v_size:=(v_item->>'byteSize')::bigint;
    v_filename:=case v_kind when 'dwg' then 'native.dwg'
      when 'source_manifest' then 'source-manifest.json'
      when 'authority' then 'authority.json' else 'native-report.json' end;
    v_path:='projects/'||v_job.project_id::text||'/native-dwg/'
      ||v_job.id::text||'/'||p_attempt::text||'/'||v_sha||'/'||v_filename;
    insert into public.lukas_drawing_native_dwg_artifacts(
      job_id,project_id,attempt_number,kind,path,sha256,byte_size
    ) values(v_job.id,v_job.project_id,p_attempt,v_kind,v_path,v_sha,v_size);
  end loop;
  update public.lukas_drawing_native_dwg_attempts attempt
  set structure_sha256=p_structure_sha256,upload_state='open'
  where attempt.job_id=p_job_id and attempt.attempt_number=p_attempt;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'kind',artifact.kind,'sha256',artifact.sha256,
    'byteSize',artifact.byte_size,'path',artifact.path
  ) order by case artifact.kind when 'dwg' then 1 when 'source_manifest' then 2
    when 'authority' then 3 else 4 end) into v_result
  from public.lukas_drawing_native_dwg_artifacts artifact
  where artifact.job_id=p_job_id and artifact.attempt_number=p_attempt;
  return v_result;
end;
$$;

create function public.lukas_drawing_settle_native_dwg_upload(
  p_job_id uuid,p_attempt integer,p_lease_token uuid
) returns text language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
declare v_attempt public.lukas_drawing_native_dwg_attempts%rowtype;
begin
  if not private.lukas_drawing_native_dwg_service_authorized() then
    raise exception using errcode='PNJ03',
      message='Native DWG export upload session is unavailable'; end if;
  select candidate.project_id into v_project_id
  from public.lukas_drawing_native_dwg_attempts candidate
  where candidate.job_id=p_job_id and candidate.attempt_number=p_attempt
    and candidate.lease_token=p_lease_token;
  select project.id into v_project_id from public.lukas_qto_projects project
  where project.id=v_project_id for update;
  if not found then raise exception using errcode='PNJ03',
    message='Native DWG export upload session is unavailable'; end if;
  perform job.id from public.lukas_drawing_native_dwg_jobs job
  where job.id=p_job_id for update;
  select attempt.* into v_attempt
  from public.lukas_drawing_native_dwg_attempts attempt
  where attempt.job_id=p_job_id and attempt.attempt_number=p_attempt
    and attempt.lease_token=p_lease_token for update;
  if not found or v_attempt.upload_state='not_started' then
    raise exception using errcode='PNJ03',
      message='Native DWG export upload session is unavailable'; end if;
  if v_attempt.upload_state='closed' then return 'closed'; end if;
  update public.lukas_drawing_native_dwg_attempts attempt
  set upload_state='closed',closed_at=pg_catalog.clock_timestamp()
  where attempt.job_id=p_job_id and attempt.attempt_number=p_attempt;
  return 'closed';
end;
$$;

create function public.lukas_drawing_publish_native_dwg_export(
  p_job_id uuid,p_attempt integer,p_lease_token uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project_id uuid; v_source jsonb; v_receipt jsonb; v_count integer;
declare v_job public.lukas_drawing_native_dwg_jobs%rowtype;
declare v_attempt public.lukas_drawing_native_dwg_attempts%rowtype;
declare v_export public.lukas_drawing_native_dwg_exports%rowtype;
begin
  if not private.lukas_drawing_native_dwg_service_authorized() then
    raise exception using errcode='PNJ03',
      message='Native DWG export publication is unavailable'; end if;
  select candidate.project_id into v_project_id
  from public.lukas_drawing_native_dwg_jobs candidate where candidate.id=p_job_id;
  select project.id into v_project_id from public.lukas_qto_projects project
  where project.id=v_project_id for update;
  if not found then raise exception using errcode='PNJ03',
    message='Native DWG export publication is unavailable'; end if;
  select job.* into v_job from public.lukas_drawing_native_dwg_jobs job
  where job.id=p_job_id for update;
  select attempt.* into v_attempt
  from public.lukas_drawing_native_dwg_attempts attempt
  where attempt.job_id=p_job_id and attempt.attempt_number=p_attempt
    and attempt.lease_token=p_lease_token for update;
  if not found then raise exception using errcode='PNJ03',
    message='Native DWG export publication is unavailable'; end if;
  select export.* into v_export from public.lukas_drawing_native_dwg_exports export
  where export.job_id=p_job_id;
  if found then
    if v_export.attempt_number=p_attempt then
      return private.lukas_drawing_native_dwg_receipt(p_job_id);
    end if;
    raise exception using errcode='PNJ04',
      message='Native DWG export publication identity conflicts';
  end if;
  if v_job.status<>'processing' or v_job.attempt_count<>p_attempt
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at<=pg_catalog.clock_timestamp()
    or v_attempt.lease_expires_at<=pg_catalog.clock_timestamp()
    or v_attempt.upload_state<>'closed' or v_attempt.structure_sha256 is null
  then raise exception using errcode='PNJ03',
    message='Native DWG export publication is unavailable'; end if;
  select pg_catalog.count(*)::integer into v_count
  from public.lukas_drawing_native_dwg_artifacts artifact
  where artifact.job_id=p_job_id and artifact.attempt_number=p_attempt
    and artifact.kind in ('dwg','source_manifest','authority','report');
  if v_count<>4 then raise exception using errcode='PNJ04',
    message='Native DWG export artifact set is incomplete'; end if;
  v_source:=private.lukas_drawing_native_dwg_source_for_actor(
    v_job.requested_by,v_job.project_id,v_job.document_id,v_job.revision_id,
    v_job.revision_version,v_job.canvas_id,v_job.snapshot_sha256
  );
  if v_source is null then raise exception using errcode='PNJ03',
    message='Native DWG export publication is unavailable'; end if;
  insert into public.lukas_drawing_native_dwg_exports(
    job_id,project_id,attempt_number,structure_sha256
  ) values(v_job.id,v_job.project_id,p_attempt,v_attempt.structure_sha256);
  update public.lukas_drawing_native_dwg_jobs job
  set status='completed',lease_expires_at=null,last_error_code=null,
    updated_at=pg_catalog.clock_timestamp() where job.id=v_job.id;
  v_receipt:=private.lukas_drawing_native_dwg_receipt(p_job_id);
  return v_receipt;
end;
$$;

create function public.lukas_drawing_fail_native_dwg_export(
  p_job_id uuid,p_attempt integer,p_lease_token uuid,
  p_error_code text,p_retryable boolean
) returns text language plpgsql security definer set search_path='' as $$
declare v_project_id uuid; v_now timestamptz;
declare v_job public.lukas_drawing_native_dwg_jobs%rowtype;
begin
  if not private.lukas_drawing_native_dwg_service_authorized() then
    raise exception using errcode='PNJ03',
      message='Native DWG export lease is unavailable'; end if;
  if p_attempt is null or p_attempt not between 1 and 3
    or p_error_code is null or p_error_code not in (
      'source_unavailable','lease_expired','conversion_failed',
      'verification_failed','upload_failed','publication_failed','budget_exceeded'
    ) or p_retryable is null
  then raise exception using errcode='PNJ03',
    message='Native DWG export lease is unavailable'; end if;
  select candidate.project_id into v_project_id
  from public.lukas_drawing_native_dwg_jobs candidate where candidate.id=p_job_id;
  select project.id into v_project_id from public.lukas_qto_projects project
  where project.id=v_project_id for update;
  if not found then return 'stale'; end if;
  select job.* into v_job from public.lukas_drawing_native_dwg_jobs job
  where job.id=p_job_id for update;
  v_now:=pg_catalog.clock_timestamp();
  if not found or v_job.status<>'processing'
    or v_job.attempt_count is distinct from p_attempt
    or v_job.lease_token is distinct from p_lease_token
    or v_job.lease_expires_at<=v_now
  then return 'stale'; end if;
  if p_retryable and p_attempt<3 then
    update public.lukas_drawing_native_dwg_jobs job set
      status='retry_wait',lease_expires_at=null,
      next_attempt_at=v_now+(30*pg_catalog.power(2,p_attempt-1))*interval '1 second',
      last_error_code=p_error_code,updated_at=v_now where job.id=p_job_id;
    return 'retry_wait';
  end if;
  update public.lukas_drawing_native_dwg_jobs job set
    status='failed',lease_expires_at=null,last_error_code=p_error_code,
    updated_at=v_now where job.id=p_job_id;
  return 'failed';
end;
$$;

create policy "reserve native DWG artifact prefix"
on storage.objects as restrictive for all to authenticated,anon
using (
  bucket_id<>'lukas-qto'
  or coalesce((storage.foldername(name))[1],'')<>'projects'
  or coalesce((storage.foldername(name))[3],'')<>'native-dwg'
)
with check (
  bucket_id<>'lukas-qto'
  or coalesce((storage.foldername(name))[1],'')<>'projects'
  or coalesce((storage.foldername(name))[3],'')<>'native-dwg'
);

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

revoke all on function
  private.lukas_drawing_native_dwg_scope(jsonb),
  private.lukas_drawing_native_dwg_source_for_actor(
    uuid,uuid,uuid,uuid,bigint,uuid,text
  ),
  private.lukas_drawing_native_dwg_receipt(uuid),
  private.lukas_drawing_native_dwg_delete_allowed(uuid,oid),
  private.lukas_drawing_native_dwg_job_guard(),
  private.lukas_drawing_native_dwg_attempt_guard(),
  private.lukas_drawing_native_dwg_evidence_guard(),
  private.lukas_drawing_native_dwg_service_authorized(),
  private.lukas_qto_project_retention_storage_files(uuid),
  private.lukas_qto_project_retention_dependencies(uuid)
from public,anon,authenticated,service_role;

revoke all on function public.lukas_qto_drawing_native_dwg_source(
  uuid,uuid,uuid,bigint,uuid,text
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_qto_drawing_native_dwg_source(
  uuid,uuid,uuid,bigint,uuid,text
) to authenticated;

revoke all on function
  public.lukas_drawing_request_native_dwg_export(jsonb,uuid),
  public.lukas_drawing_native_dwg_export_status(jsonb,uuid),
  public.lukas_drawing_native_dwg_download_descriptor(jsonb,uuid,text),
  public.lukas_drawing_claim_native_dwg_export(text,integer),
  public.lukas_drawing_stage_native_dwg_export(uuid,integer,uuid,text,jsonb),
  public.lukas_drawing_settle_native_dwg_upload(uuid,integer,uuid),
  public.lukas_drawing_publish_native_dwg_export(uuid,integer,uuid),
  public.lukas_drawing_fail_native_dwg_export(uuid,integer,uuid,text,boolean)
from public,anon,authenticated,service_role;
grant execute on function
  public.lukas_drawing_request_native_dwg_export(jsonb,uuid),
  public.lukas_drawing_native_dwg_export_status(jsonb,uuid),
  public.lukas_drawing_native_dwg_download_descriptor(jsonb,uuid,text)
to authenticated;
grant execute on function
  public.lukas_drawing_claim_native_dwg_export(text,integer),
  public.lukas_drawing_stage_native_dwg_export(uuid,integer,uuid,text,jsonb),
  public.lukas_drawing_settle_native_dwg_upload(uuid,integer,uuid),
  public.lukas_drawing_publish_native_dwg_export(uuid,integer,uuid),
  public.lukas_drawing_fail_native_dwg_export(uuid,integer,uuid,text,boolean)
to service_role;

revoke all on function
  public.lukas_qto_purge_project(uuid,uuid,uuid,text),
  public.lukas_qto_finalize_project_purge(uuid,uuid,uuid,text,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function
  public.lukas_qto_purge_project(uuid,uuid,uuid,text),
  public.lukas_qto_finalize_project_purge(uuid,uuid,uuid,text,uuid,text)
to service_role;

alter default privileges revoke execute on functions from public;

commit;
