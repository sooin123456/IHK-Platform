begin;

alter table public.lukas_drawing_documents
  add column if not exists clone_request_id uuid,
  add column if not exists clone_requested_by uuid,
  add column if not exists clone_request_hash text;
create unique index if not exists lukas_drawing_documents_clone_request_idx
  on public.lukas_drawing_documents(clone_requested_by,clone_request_id)
  where clone_request_id is not null and clone_requested_by is not null;

create or replace function private.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid,p_client_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_source public.lukas_drawing_revisions%rowtype;
  v_hash text; v_document public.lukas_drawing_documents%rowtype; v_revision uuid;
  v_result jsonb;
begin
  select r.* into v_source from public.lukas_drawing_revisions r
  where r.id=p_source_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
  for update;
  if not found then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||':'||p_client_request_id::text,0));
  v_hash:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object('sourceRevisionId',p_source_revision_id,'title',pg_catalog.btrim(p_title),
      'sourceFileId',p_source_file_id)::text,'UTF8'),'sha256'),'hex');
  select d.* into v_document from public.lukas_drawing_documents d
  where d.clone_requested_by=v_actor and d.clone_request_id=p_client_request_id for update;
  if found then
    if v_document.clone_request_hash is distinct from v_hash then
      raise exception using errcode='P1C01',message='Drawing template request ID does not match the stored request';
    end if;
    select r.id into v_revision from public.lukas_drawing_revisions r
      where r.document_id=v_document.id and r.project_id=v_document.project_id order by r.sequence limit 1;
    if v_revision is null then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
    return pg_catalog.jsonb_build_object('documentId',v_document.id,'revisionId',v_revision,
      'sourceRevisionId',p_source_revision_id);
  end if;
  v_result:=private.lukas_drawing_create_from_template(p_source_revision_id,p_title,p_source_file_id);
  update public.lukas_drawing_documents set clone_request_id=p_client_request_id,
    clone_requested_by=v_actor,clone_request_hash=v_hash where id=(v_result->>'documentId')::uuid;
  return v_result;
exception when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when others then raise exception using errcode='P1R01',message='Drawing template target is unavailable';
end;
$$;

create or replace function public.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid,p_client_request_id uuid
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_create_from_template(p_source_revision_id,p_title,p_source_file_id,p_client_request_id)
$$;
revoke all on function private.lukas_drawing_create_from_template(uuid,text,uuid,uuid) from public,anon;
grant execute on function private.lukas_drawing_create_from_template(uuid,text,uuid,uuid) to authenticated,service_role;
revoke all on function public.lukas_drawing_create_from_template(uuid,text,uuid,uuid) from public,anon;
grant execute on function public.lukas_drawing_create_from_template(uuid,text,uuid,uuid) to authenticated,service_role;

commit;
