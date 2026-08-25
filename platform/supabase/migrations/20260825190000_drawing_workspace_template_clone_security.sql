begin;

revoke all on function private.lukas_drawing_clone_v1_snapshot(jsonb,uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_create_from_template(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_create_from_template(uuid,text,uuid) from public,anon,authenticated,service_role;

create table if not exists private.lukas_drawing_template_clone_requests(
  actor_id uuid not null references auth.users(id) on delete restrict,
  client_request_id uuid not null,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  document_id uuid not null references public.lukas_drawing_documents(id) on delete restrict,
  revision_id uuid not null references public.lukas_drawing_revisions(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key(actor_id,client_request_id)
);
revoke all on table private.lukas_drawing_template_clone_requests from public,anon,authenticated,service_role;

create or replace function private.lukas_drawing_clone_binding_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and not (old.clone_request_id is null and old.clone_requested_by is null and old.clone_request_hash is null) and (new.clone_request_id is distinct from old.clone_request_id or new.clone_requested_by is distinct from old.clone_requested_by or new.clone_request_hash is distinct from old.clone_request_hash) then
  raise exception using errcode='P1C01',message='Drawing template clone binding is immutable'; end if;
 return new;
end; $$;
drop trigger if exists lukas_drawing_clone_binding_guard on public.lukas_drawing_documents;
create trigger lukas_drawing_clone_binding_guard before update on public.lukas_drawing_documents for each row execute function private.lukas_drawing_clone_binding_guard();

alter function private.lukas_drawing_create_from_template(uuid,text,uuid,uuid) rename to lukas_drawing_create_from_template_pre_clone_ledger;
create or replace function private.lukas_drawing_create_from_template(p_source_revision_id uuid,p_title text,p_source_file_id uuid,p_client_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype; v_snapshot public.lukas_drawing_snapshots%rowtype; v_hash text; v_existing private.lukas_drawing_template_clone_requests%rowtype; v_result jsonb; v_file public.lukas_qto_files%rowtype; v_page jsonb;
begin
 if p_client_request_id is null then raise exception using errcode='P1C01',message='Drawing template request ID is required'; end if;
 select r.* into v_revision from public.lukas_drawing_revisions r where r.id=p_source_revision_id and v_actor is not null and r.status='approved' and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor') for update;
 if not found then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
 select s.* into v_snapshot from public.lukas_drawing_snapshots s join public.lukas_drawing_revision_approvals a on a.revision_id=s.revision_id and a.project_id=s.project_id and a.subject_version=s.revision_version and a.snapshot_sha256=s.sha256 and a.decision='approved' where s.revision_id=v_revision.id and s.project_id=v_revision.project_id and s.revision_version=v_revision.version;
 if not found or v_snapshot.sha256 is distinct from encode(extensions.digest(convert_to(v_snapshot.canonical_json::text,'UTF8'),'sha256'),'hex') then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
 if p_source_file_id is not null and v_snapshot.schema_version=1 then
  select * into v_file from public.lukas_qto_files f where f.id=p_source_file_id and f.project_id=v_revision.project_id and f.immutable;
  if not found or not exists(select 1 from jsonb_array_elements(v_snapshot.canonical_json->'pages') p where p->>'backgroundSourceFileId'=p_source_file_id::text and p->>'backgroundSourceSha256'=v_file.sha256)
    and not exists(select 1 from jsonb_array_elements(v_snapshot.canonical_json->'objects') o cross join lateral jsonb_array_elements(o->'sources') s where s->>'sourceFileId'=p_source_file_id::text and s->>'sourceSha256'=v_file.sha256) then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(v_actor::text||':'||p_client_request_id::text,0));
 v_hash:=encode(extensions.digest(convert_to(jsonb_build_object('sourceRevisionId',p_source_revision_id,'title',btrim(p_title),'sourceFileId',p_source_file_id)::text,'UTF8'),'sha256'),'hex');
 select * into v_existing from private.lukas_drawing_template_clone_requests where actor_id=v_actor and client_request_id=p_client_request_id for update;
 if found then if v_existing.request_hash is distinct from v_hash then raise exception using errcode='P1C01',message='Drawing template request ID does not match the stored request'; end if; return jsonb_build_object('documentId',v_existing.document_id,'revisionId',v_existing.revision_id,'sourceRevisionId',p_source_revision_id); end if;
 v_result:=private.lukas_drawing_create_from_template_pre_clone_ledger(p_source_revision_id,p_title,p_source_file_id,p_client_request_id);
 insert into private.lukas_drawing_template_clone_requests(actor_id,client_request_id,request_hash,document_id,revision_id) values(v_actor,p_client_request_id,v_hash,(v_result->>'documentId')::uuid,(v_result->>'revisionId')::uuid);
 return v_result;
exception when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise; when others then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end; $$;
revoke all on function private.lukas_drawing_create_from_template_pre_clone_ledger(uuid,text,uuid,uuid) from public,anon,authenticated,service_role;

alter function private.lukas_drawing_request_review(uuid) rename to lukas_drawing_request_review_pre_lineage_evidence_return;
create or replace function private.lukas_drawing_request_review(p_revision_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_snapshot public.lukas_drawing_snapshots%rowtype;
begin
 v_result:=private.lukas_drawing_request_review_pre_lineage_evidence_return(p_revision_id);
 select * into v_snapshot from public.lukas_drawing_snapshots where id=(v_result->>'snapshotId')::uuid;
 if not found then raise exception using errcode='P1R01',message='Drawing revision target is unavailable'; end if;
 return v_result||jsonb_build_object('snapshotSha256',v_snapshot.sha256,'operationSequence',v_snapshot.operation_sequence);
end; $$;
revoke all on function private.lukas_drawing_request_review_pre_lineage_evidence_return(uuid) from public,anon,authenticated,service_role;

commit;
