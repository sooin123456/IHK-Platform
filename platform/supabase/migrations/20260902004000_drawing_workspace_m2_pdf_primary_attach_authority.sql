begin;

-- A source-free document with a persisted background predates the primary
-- attach authority and cannot be repaired without rewriting drawing evidence.
lock table public.lukas_drawing_documents,
  public.lukas_drawing_pages,
  public.lukas_drawing_canvases,
  storage.objects
in share row exclusive mode;

do $$
begin
  if exists(
    select 1
    from public.lukas_drawing_documents d
    join public.lukas_drawing_revisions r
      on r.document_id=d.id and r.project_id=d.project_id
    join public.lukas_drawing_canvases c
      on c.revision_id=r.id and c.project_id=r.project_id
    where (
        c.background_source_file_id is not null
        or c.background_source_sha256 is not null
        or c.background_pdf_page is not null
        or c.calibration is not null
      )
      and (
        d.source_file_id is distinct from c.background_source_file_id
        or d.source_sha256 is distinct from c.background_source_sha256
      )
  ) or exists(
    select 1
    from public.lukas_drawing_documents d
    join public.lukas_drawing_revisions r
      on r.document_id=d.id and r.project_id=d.project_id
    join public.lukas_drawing_pages p
      on p.revision_id=r.id and p.project_id=r.project_id
    where (
        p.background_source_file_id is not null
        or p.background_source_sha256 is not null
        or p.background_pdf_page is not null
        or p.calibration is not null
      )
      and (
        d.source_file_id is distinct from p.background_source_file_id
        or d.source_sha256 is distinct from p.background_source_sha256
      )
  ) or exists(
    select 1
    from public.lukas_drawing_documents d
    where d.source_file_id is not null
      and not exists(
        select 1
        from public.lukas_qto_files f
        join storage.objects object
          on object.bucket_id='lukas-qto'
          and object.name=f.storage_path
        where f.id=d.source_file_id
          and f.project_id=d.project_id
          and f.sha256=d.source_sha256
          and f.kind in ('pdf','ifc')
          and f.immutable
      )
  ) then
    raise exception using errcode='P1C01',
      message='Drawing source attach preflight failed';
  end if;
end;
$$;

create table private.lukas_drawing_source_attach_requests(
  actor_id uuid not null references auth.users(id) on delete restrict,
  client_request_id uuid not null,
  request_sha256 text not null check(request_sha256~'^[0-9a-f]{64}$'),
  project_id uuid not null
    references public.lukas_qto_projects(id) on delete cascade,
  document_id uuid not null
    references public.lukas_drawing_documents(id) on delete cascade,
  revision_id uuid not null
    references public.lukas_drawing_revisions(id) on delete cascade,
  source_file_id uuid not null
    references public.lukas_qto_files(id) on delete cascade,
  source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$'),
  canvas_id uuid not null
    references public.lukas_drawing_canvases(id) on delete cascade,
  result_json jsonb not null check(
    pg_catalog.jsonb_typeof(result_json)='object'
    and result_json->>'documentId'=document_id::text
    and result_json->>'revisionId'=revision_id::text
    and result_json->>'canvasId'=canvas_id::text
    and result_json->>'sourceFileId'=source_file_id::text
    and result_json->>'sourceSha256'=source_sha256
  ),
  created_at timestamptz not null default pg_catalog.now(),
  primary key(actor_id,client_request_id)
);

create index lukas_drawing_source_attach_requests_project_idx
on private.lukas_drawing_source_attach_requests(project_id);

create table private.lukas_drawing_source_attach_leases(
  transaction_id bigint primary key,
  actor_id uuid not null,
  document_id uuid not null,
  revision_id uuid not null,
  canvas_id uuid not null,
  source_file_id uuid not null,
  source_sha256 text not null check(source_sha256~'^[0-9a-f]{64}$')
);

revoke all on table private.lukas_drawing_source_attach_requests
from public,anon,authenticated,service_role;
revoke all on table private.lukas_drawing_source_attach_leases
from public,anon,authenticated,service_role;

-- Protect every registered immutable PDF before it is attached. This closes
-- the attach/delete race without another collaboration authority: the file row
-- is already committed, and the attach RPC holds it FOR KEY SHARE.
create function private.lukas_drawing_storage_object_is_immutable_pdf(
  p_bucket_id text,
  p_name text
) returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select p_bucket_id='lukas-qto' and exists(
    select 1
    from public.lukas_qto_files f
    where f.storage_path=p_name
      and f.kind='pdf'
      and f.immutable
  )
$$;

revoke all on function
  private.lukas_drawing_storage_object_is_immutable_pdf(text,text)
from public,anon,authenticated,service_role;
grant execute on function
  private.lukas_drawing_storage_object_is_immutable_pdf(text,text)
to authenticated,service_role;

drop policy if exists "drawing attached sources reject authenticated delete"
on storage.objects;
create policy "drawing attached sources reject authenticated delete"
on storage.objects as restrictive for delete to authenticated
using(not private.lukas_drawing_storage_object_is_immutable_pdf(bucket_id,name));

drop policy if exists "drawing attached sources reject authenticated update"
on storage.objects;
create policy "drawing attached sources reject authenticated update"
on storage.objects as restrictive for update to authenticated
using(not private.lukas_drawing_storage_object_is_immutable_pdf(bucket_id,name))
with check(not private.lukas_drawing_storage_object_is_immutable_pdf(bucket_id,name));

-- Keep ordinary draft title updates, creation identity, and retention purge
-- behavior intact. Only the table owner executing the narrow attach RPC may
-- move the source pair from NULL to one exact immutable identity.
create or replace function private.lukas_drawing_document_guard()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_owner name;
  v_marker text;
  v_source_changed boolean:=false;
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
      select 1 from public.lukas_qto_projects p where p.id=old.project_id
    ) then
    return old;
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner) into v_owner
  from pg_catalog.pg_class c where c.oid=tg_relid;

  if tg_op='INSERT' then
    if v_actor is null or new.created_by<>v_actor then
      raise exception 'Drawing document creator must be the authenticated user';
    end if;
    if new.creation_request_id is not null
      or new.creation_request_sha256 is not null then
      raise exception using errcode='P1C01',
        message='Drawing document creation identity is immutable';
    end if;
  elsif tg_op='UPDATE' then
    if new.project_id is distinct from old.project_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Drawing document identity is immutable';
    end if;
    if new.creation_request_id is distinct from old.creation_request_id
      or new.creation_request_sha256 is distinct from old.creation_request_sha256 then
      v_marker:=pg_catalog.current_setting(
        'lukas.drawing_creation_identity',true
      );
      if old.creation_request_id is not null
        or old.creation_request_sha256 is not null
        or new.creation_request_id is null
        or new.creation_request_sha256 is null
        or current_user<>v_owner
        or v_marker is distinct from
          old.id::text||':'||new.creation_request_id::text||':'||
            new.creation_request_sha256 then
        raise exception using errcode='P1C01',
          message='Drawing document creation identity is immutable';
      end if;
    end if;

    v_source_changed:=
      new.source_file_id is distinct from old.source_file_id
      or new.source_sha256 is distinct from old.source_sha256;
    if v_source_changed then
      if old.source_file_id is not null
        or old.source_sha256 is not null
        or new.source_file_id is null
        or new.source_sha256 is null
        or current_user<>v_owner then
        raise exception using errcode='P1C01',
          message='Drawing document source identity is immutable';
      end if;
      if not exists(
          select 1 from private.lukas_drawing_source_attach_leases lease
          where lease.transaction_id=pg_catalog.txid_current()
            and lease.actor_id=v_actor
            and lease.document_id=old.id
            and lease.source_file_id=new.source_file_id
            and lease.source_sha256=new.source_sha256
      ) then
        raise exception using errcode='P1C01',
          message='Drawing document source identity is immutable';
      end if;
    end if;
  end if;

  if tg_op<>'INSERT' and exists(
      select 1 from public.lukas_drawing_revisions r
      where r.document_id=old.id and r.status<>'draft'
    ) then
    raise exception 'Drawing document with a non-draft revision is immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.source_file_id is not null and not exists(
    select 1 from public.lukas_qto_files f
    where f.id=new.source_file_id and f.project_id=new.project_id
      and f.sha256=new.source_sha256 and f.kind in ('pdf','ifc')
      and f.immutable
  ) then
    raise exception 'Drawing source must be an immutable PDF or IFC from the project';
  end if;
  new.updated_at:=pg_catalog.now();
  return new;
end;
$$;

create or replace function private.lukas_drawing_source_attach_ledger_append_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
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
      select 1 from public.lukas_qto_projects p where p.id=old.project_id
    ) then
    return old;
  end if;
  raise exception using errcode='P1C01',
    message='Drawing source attach ledger is append-only';
end;
$$;

create trigger lukas_drawing_source_attach_ledger_append_guard
before update or delete on private.lukas_drawing_source_attach_requests
for each row execute function
  private.lukas_drawing_source_attach_ledger_append_guard();

create or replace function private.lukas_drawing_page_source_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_document public.lukas_drawing_documents%rowtype;
begin
  if tg_op='UPDATE' and (
    new.width_mm is distinct from old.width_mm
    or new.height_mm is distinct from old.height_mm
    or new.background_source_file_id is distinct from old.background_source_file_id
    or new.background_source_sha256 is distinct from old.background_source_sha256
    or new.background_pdf_page is distinct from old.background_pdf_page
    or new.calibration is distinct from old.calibration
  ) then
    raise exception using errcode='P1C01',
      message='Legacy drawing page canvas columns are read-only';
  end if;

  if tg_op='INSERT' and (
    new.background_source_file_id is not null
    or new.background_source_sha256 is not null
    or new.background_pdf_page is not null
    or new.calibration is not null
  ) then
    select d.* into v_document
    from public.lukas_drawing_revisions r
    join public.lukas_drawing_documents d
      on d.id=r.document_id and d.project_id=r.project_id
    where r.id=new.revision_id and r.project_id=new.project_id;
    if not found
      or v_document.source_file_id is distinct from new.background_source_file_id
      or v_document.source_sha256 is distinct from new.background_source_sha256 then
      raise exception using errcode='P1C01',
        message='Legacy drawing page canvas columns are read-only';
    end if;
  end if;

  if new.background_source_file_id is not null and not exists(
    select 1 from public.lukas_qto_files f
    where f.id=new.background_source_file_id
      and f.project_id=new.project_id
      and f.sha256=new.background_source_sha256
      and f.kind='pdf' and f.immutable
  ) then
    raise exception using errcode='P1C01',
      message='Drawing page background must be an immutable project PDF';
  end if;
  new.updated_at:=pg_catalog.now();
  return new;
end;
$$;

create function private.lukas_drawing_canvas_source_identity_guard()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_document public.lukas_drawing_documents%rowtype;
  v_identity_changed boolean;
begin
  if tg_op='DELETE' then
    if pg_catalog.pg_trigger_depth()>1
      and pg_catalog.current_setting(
        'app.lukas_retention_purge_project',true
      )=old.project_id::text
      and current_user=pg_catalog.pg_get_userbyid(
        (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
      )
      and not exists(
        select 1 from public.lukas_qto_projects p where p.id=old.project_id
      ) then
      return old;
    end if;
    if old.background_source_file_id is not null
      or old.background_source_sha256 is not null
      or old.background_pdf_page is not null then
      raise exception using errcode='P1C01',
        message='Drawing canvas source identity is immutable';
    end if;
    return old;
  end if;

  select d.* into v_document
  from public.lukas_drawing_revisions r
  join public.lukas_drawing_documents d
    on d.id=r.document_id and d.project_id=r.project_id
  where r.id=new.revision_id and r.project_id=new.project_id;
  if not found then
    raise exception using errcode='P1C01',
      message='Drawing canvas source ancestry is invalid';
  end if;

  if tg_op='INSERT' then
    if new.background_source_file_id is not null and (
      v_document.source_file_id is distinct from new.background_source_file_id
      or v_document.source_sha256 is distinct from new.background_source_sha256
    ) then
      raise exception using errcode='P1C01',
        message='Drawing canvas source identity is immutable';
    end if;
    return new;
  end if;

  v_identity_changed:=
    new.background_source_file_id is distinct from old.background_source_file_id
    or new.background_source_sha256 is distinct from old.background_source_sha256
    or new.background_pdf_page is distinct from old.background_pdf_page;
  if not v_identity_changed then return new; end if;

  if old.background_source_file_id is not null
    or old.background_source_sha256 is not null
    or old.background_pdf_page is not null
    or new.background_source_file_id is null
    or new.background_source_sha256 is null then
    raise exception using errcode='P1C01',
      message='Drawing canvas source identity is immutable';
  end if;

  if v_document.source_file_id is not distinct from new.background_source_file_id
    and v_document.source_sha256 is not distinct from new.background_source_sha256 then
    return new;
  end if;

  if v_document.source_file_id is not null
    or v_document.source_sha256 is not null
    or not exists(
      select 1 from private.lukas_drawing_source_attach_leases lease
      where lease.transaction_id=pg_catalog.txid_current()
        and lease.actor_id=v_actor
        and lease.document_id=v_document.id
        and lease.revision_id=new.revision_id
        and lease.canvas_id=new.id
        and lease.source_file_id=new.background_source_file_id
        and lease.source_sha256=new.background_source_sha256
    ) then
    raise exception using errcode='P1C01',
      message='Drawing canvas source identity is immutable';
  end if;
  return new;
end;
$$;

create trigger lukas_drawing_canvases_source_identity_guard
before insert or update or delete on public.lukas_drawing_canvases
for each row execute function
  private.lukas_drawing_canvas_source_identity_guard();

create function private.lukas_drawing_attach_source(
  p_document_id uuid,
  p_revision_id uuid,
  p_canvas_id uuid,
  p_source_file_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid:=(select auth.uid());
  v_document public.lukas_drawing_documents%rowtype;
  v_revision public.lukas_drawing_revisions%rowtype;
  v_canvas public.lukas_drawing_canvases%rowtype;
  v_file public.lukas_qto_files%rowtype;
  v_existing private.lukas_drawing_source_attach_requests%rowtype;
  v_request_sha256 text;
  v_before jsonb;
  v_after jsonb;
  v_base_versions jsonb;
  v_forward jsonb;
  v_inverse jsonb;
  v_operation jsonb;
  v_result jsonb;
  v_document_updated_at timestamptz;
begin
  if v_actor is null or p_document_id is null or p_revision_id is null
    or p_canvas_id is null or p_source_file_id is null
    or p_request_id is null then
    raise exception using errcode='P1C01',
      message='Drawing source attach request is invalid';
  end if;

  v_request_sha256:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'documentId',p_document_id,
      'revisionId',p_revision_id,
      'canvasId',p_canvas_id,
      'sourceFileId',p_source_file_id
    )::text,'UTF8'),'sha256'
  ),'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'drawing-source-attach-request:'||v_actor::text||':'||p_request_id::text,
    0
  ));
  select request.* into v_existing
  from private.lukas_drawing_source_attach_requests request
  where request.actor_id=v_actor
    and request.client_request_id=p_request_id
  for update;
  if found then
    if v_existing.request_sha256 is distinct from v_request_sha256 then
      raise exception using errcode='P1C01',
        message='Drawing source attach request ID does not match the stored request';
    end if;
    return v_existing.result_json;
  end if;

  select d.* into v_document
  from public.lukas_drawing_documents d
  where d.id=p_document_id
    and private.lukas_drawing_workspace_capability(d.project_id)
      in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing source attach target is unavailable';
  end if;

  select r.* into v_revision
  from public.lukas_drawing_revisions r
  where r.id=p_revision_id
    and r.document_id=v_document.id
    and r.project_id=v_document.project_id
    and r.status='draft'
    and not exists(
      select 1 from public.lukas_drawing_revisions historical
      where historical.document_id=r.document_id
        and historical.project_id=r.project_id
        and historical.status<>'draft'
    )
    and not exists(
      select 1 from public.lukas_drawing_revisions later
      where later.document_id=r.document_id
        and later.project_id=r.project_id
        and later.sequence>r.sequence
    )
  for update;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing source attach target is unavailable';
  end if;

  select f.* into v_file
  from public.lukas_qto_files f
  where f.id=p_source_file_id
    and f.project_id=v_document.project_id
    and f.kind='pdf'
    and f.immutable
    and exists(
      select 1 from storage.objects object
      where object.bucket_id='lukas-qto'
        and object.name=f.storage_path
    )
  for key share;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing source attach target is unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'drawing-source-attach-file:'||v_document.project_id::text||':'||
      v_file.id::text,
    0
  ));
  perform 1
  from public.lukas_drawing_documents d
  where d.project_id=v_document.project_id
    and d.source_file_id=v_file.id
    and d.id<>v_document.id
  for key share;
  if found then
    raise exception using errcode='P1C01',
      message='Drawing source file is already attached in this project';
  end if;
  if v_document.source_file_id is not null
    or v_document.source_sha256 is not null then
    raise exception using errcode='P1C01',
      message='Drawing document already has a primary source';
  end if;

  select c.* into v_canvas
  from public.lukas_drawing_canvases c
  where c.id=p_canvas_id
    and c.revision_id=v_revision.id
    and c.project_id=v_revision.project_id
    and c.space_kind='paper'
    and c.sort_order=0
    and exists(
      select 1 from public.lukas_drawing_pages p
      where p.id=c.page_id and p.revision_id=c.revision_id
        and p.project_id=c.project_id and p.sort_order=0
        and p.page_number=1
    )
  for update;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing source attach target is unavailable';
  end if;

  if v_canvas.background_source_file_id is not null
    or v_canvas.background_source_sha256 is not null
    or v_canvas.background_pdf_page is not null
    or v_canvas.calibration is not null
    or exists(
      select 1 from public.lukas_drawing_canvases c
      join public.lukas_drawing_revisions background_revision
        on background_revision.id=c.revision_id
        and background_revision.project_id=c.project_id
      where background_revision.document_id=v_document.id
        and background_revision.project_id=v_document.project_id
        and (
          c.background_source_file_id is not null
          or c.background_source_sha256 is not null
          or c.background_pdf_page is not null
          or c.calibration is not null
        )
    )
    or exists(
      select 1 from public.lukas_drawing_pages p
      join public.lukas_drawing_revisions background_revision
        on background_revision.id=p.revision_id
        and background_revision.project_id=p.project_id
      where background_revision.document_id=v_document.id
        and background_revision.project_id=v_document.project_id
        and (
          p.background_source_file_id is not null
          or p.background_source_sha256 is not null
          or p.background_pdf_page is not null
          or p.calibration is not null
        )
    ) then
    raise exception using errcode='P1C01',
      message='Drawing source attach requires source-free backgrounds';
  end if;

  v_before:=private.lukas_drawing_structure_entity_json(
    'canvas',v_canvas.id,v_revision.id,v_revision.project_id
  );
  if v_before is null then
    raise exception using errcode='P1R01',
      message='Drawing source attach target is unavailable';
  end if;
  v_after:=pg_catalog.jsonb_set(
    v_before,'{background}',pg_catalog.jsonb_build_object(
      'sourceFileId',v_file.id,
      'sourceSha256',v_file.sha256,
      'pdfPageNumber',1,
      'calibration',null
    ),false
  );
  v_base_versions:=pg_catalog.jsonb_build_object(
    v_canvas.id::text,v_canvas.version
  );
  v_forward:=pg_catalog.jsonb_build_object(
    'type','mutate_structure',
    'actions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind','put_canvas',
      'entity',v_after,
      'baseVersion',v_canvas.version
    ))
  );
  v_inverse:=pg_catalog.jsonb_build_object(
    'type','mutate_structure',
    'actions',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind','put_canvas',
      'entity',v_before,
      'baseVersion',v_canvas.version+1
    ))
  );

  insert into private.lukas_drawing_source_attach_leases(
    transaction_id,actor_id,document_id,revision_id,canvas_id,
    source_file_id,source_sha256
  ) values(
    pg_catalog.txid_current(),v_actor,v_document.id,v_revision.id,v_canvas.id,
    v_file.id,v_file.sha256
  );
  v_operation:=private.lukas_drawing_apply_operation(
    v_revision.id,p_request_id,'mutate_structure',v_base_versions,
    v_forward,v_inverse,null::text,null::uuid
  );

  update public.lukas_drawing_documents set
    source_file_id=v_file.id,
    source_sha256=v_file.sha256
  where id=v_document.id and project_id=v_document.project_id
  returning updated_at into v_document_updated_at;
  if v_document_updated_at is null then
    raise exception using errcode='P1R01',
      message='Drawing source attach target is unavailable';
  end if;
  delete from private.lukas_drawing_source_attach_leases lease
  where lease.transaction_id=pg_catalog.txid_current()
    and lease.actor_id=v_actor and lease.document_id=v_document.id;

  v_result:=pg_catalog.jsonb_build_object(
    'documentId',v_document.id,
    'revisionId',v_revision.id,
    'canvasId',v_canvas.id,
    'sourceFileId',v_file.id,
    'sourceSha256',v_file.sha256,
    'documentUpdatedAt',v_document_updated_at,
    'operationId',v_operation->'operationId',
    'operationSequence',v_operation->'sequence',
    'resultVersions',v_operation->'resultVersions'
  );
  insert into private.lukas_drawing_source_attach_requests(
    actor_id,client_request_id,request_sha256,project_id,document_id,
    revision_id,source_file_id,source_sha256,canvas_id,result_json
  ) values(
    v_actor,p_request_id,v_request_sha256,v_document.project_id,v_document.id,
    v_revision.id,v_file.id,v_file.sha256,v_canvas.id,v_result
  );
  return v_result;
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when unique_violation then
    raise exception using errcode='P1C01',
      message='Drawing source file is already attached in this project';
  when foreign_key_violation or check_violation or not_null_violation then
    raise exception using errcode='P1C01',
      message='Drawing source attach conflicted with stored authority';
  when others then
    raise exception using errcode='P1R01',
      message='Drawing source attach target is unavailable';
end;
$$;

create function public.lukas_drawing_attach_source(
  p_document_id uuid,
  p_revision_id uuid,
  p_canvas_id uuid,
  p_source_file_id uuid,
  p_request_id uuid
) returns jsonb
language sql
security definer
set search_path=''
as $$
  select private.lukas_drawing_attach_source(
    p_document_id,p_revision_id,p_canvas_id,p_source_file_id,p_request_id
  )
$$;

revoke all on function
  private.lukas_drawing_document_guard(),
  private.lukas_drawing_source_attach_ledger_append_guard(),
  private.lukas_drawing_page_source_guard(),
  private.lukas_drawing_canvas_source_identity_guard(),
  private.lukas_drawing_attach_source(uuid,uuid,uuid,uuid,uuid)
from public,anon,authenticated,service_role;

revoke all on function public.lukas_drawing_attach_source(
  uuid,uuid,uuid,uuid,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_attach_source(
  uuid,uuid,uuid,uuid,uuid
) to authenticated,service_role;

do $$
begin
  if exists(
    select 1 from pg_catalog.pg_publication
    where pubname='supabase_realtime'
  ) and not exists(
    select 1 from pg_catalog.pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='lukas_drawing_documents'
  ) then
    execute 'alter publication supabase_realtime add table public.lukas_drawing_documents';
  end if;
end;
$$;

commit;
