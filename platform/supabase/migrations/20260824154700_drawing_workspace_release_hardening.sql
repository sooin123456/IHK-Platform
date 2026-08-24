-- Release hardening is additive because every earlier workspace migration may
-- already be present in deployed migration history.

do $$
begin
  if exists (
    select 1
    from public.lukas_drawing_documents d
    where d.source_file_id is not null
    group by d.project_id, d.source_file_id
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = 'P1C01',
      message = 'Duplicate drawing source documents must be resolved before deployment';
  end if;
end;
$$;

create unique index lukas_drawing_documents_project_source_unique
  on public.lukas_drawing_documents(project_id, source_file_id)
  where source_file_id is not null;

alter function private.lukas_drawing_create_document(uuid, uuid, text, boolean)
  rename to lukas_drawing_create_document_pre_hardening;
alter function private.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  rename to lukas_drawing_apply_operation_pre_hardening;
alter function private.lukas_drawing_request_review(uuid)
  rename to lukas_drawing_request_review_pre_hardening;
alter function private.lukas_drawing_record_revision_decision(uuid, bigint, text, text, text)
  rename to lukas_drawing_record_revision_decision_pre_hardening;

create function private.lukas_drawing_create_document(
  p_project_id uuid,
  p_source_file_id uuid,
  p_title text,
  p_blank boolean
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return private.lukas_drawing_create_document_pre_hardening(
    p_project_id, p_source_file_id, p_title, p_blank
  );
exception
  when unique_violation then
    raise exception using
      errcode = 'P1C01',
      message = 'A drawing document already exists for this source file';
  when raise_exception then
    raise exception using errcode = 'P1R01', message = sqlerrm;
end;
$$;

create function private.lukas_drawing_apply_operation(
  p_revision_id uuid,
  p_client_operation_id uuid,
  p_operation_type text,
  p_base_versions jsonb,
  p_forward jsonb,
  p_inverse jsonb
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
begin
  select r.* into v_revision
  from public.lukas_drawing_revisions r
  where r.id = p_revision_id
    and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin', 'editor')
  for update;
  if not found then
    raise exception using
      errcode = 'P1R01',
      message = 'Drawing revision target is unavailable';
  end if;

  select o.* into v_existing
  from public.lukas_drawing_operations o
  where o.revision_id = p_revision_id
    and o.client_operation_id = p_client_operation_id;
  if found then
    if v_existing.revision_id is distinct from p_revision_id
       or v_existing.actor_id is distinct from v_actor
       or v_existing.operation_type is distinct from p_operation_type
       or v_existing.base_versions is distinct from p_base_versions
       or v_existing.forward is distinct from p_forward
       or v_existing.inverse is distinct from p_inverse then
      raise exception using
        errcode = 'P1C01',
        message = 'Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'operationId', v_existing.id,
      'sequence', v_existing.sequence,
      'resultVersions', v_existing.result_versions
    );
  end if;

  begin
    return private.lukas_drawing_apply_operation_pre_hardening(
      p_revision_id, p_client_operation_id, p_operation_type,
      p_base_versions, p_forward, p_inverse
    );
  exception
    when raise_exception then
      if sqlerrm ilike '%version conflict%'
         or sqlerrm ilike '%already exists%'
         or sqlerrm ilike '%requires a draft revision%'
         or sqlerrm ilike '%immutable%' then
        raise exception using errcode = 'P1C01', message = sqlerrm;
      end if;
      raise exception using errcode = 'P1R01', message = sqlerrm;
  end;
end;
$$;

create function private.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
begin
  select r.* into v_revision
  from public.lukas_drawing_revisions r
  where r.id = p_revision_id
    and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin', 'editor')
  for update;
  if not found then
    raise exception using
      errcode = 'P1R01',
      message = 'Drawing revision target is unavailable';
  end if;
  begin
    return private.lukas_drawing_request_review_pre_hardening(p_revision_id);
  exception
    when raise_exception then
      raise exception using errcode = 'P1C01', message = sqlerrm;
  end;
end;
$$;

create function private.lukas_drawing_record_revision_decision(
  p_revision_id uuid,
  p_subject_version bigint,
  p_snapshot_sha256 text,
  p_decision text,
  p_note text
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
begin
  select r.* into v_revision
  from public.lukas_drawing_revisions r
  where r.id = p_revision_id
    and v_actor is not null
    and private.lukas_qto_project_role(r.project_id)
      in ('owner', 'staff', 'reviewer')
  for update;
  if not found then
    raise exception using
      errcode = 'P1R01',
      message = 'Drawing revision target is unavailable';
  end if;
  begin
    return private.lukas_drawing_record_revision_decision_pre_hardening(
      p_revision_id, p_subject_version, p_snapshot_sha256, p_decision, p_note
    );
  exception
    when raise_exception then
      raise exception using errcode = 'P1C01', message = sqlerrm;
  end;
end;
$$;

create or replace function public.lukas_drawing_create_document(
  p_project_id uuid, p_source_file_id uuid, p_title text, p_blank boolean
) returns jsonb
language sql security invoker
set search_path = ''
as $$
  select private.lukas_drawing_create_document(
    p_project_id, p_source_file_id, p_title, p_blank
  )
$$;

create or replace function public.lukas_drawing_apply_operation(
  p_revision_id uuid, p_client_operation_id uuid, p_operation_type text,
  p_base_versions jsonb, p_forward jsonb, p_inverse jsonb
) returns jsonb
language sql security invoker
set search_path = ''
as $$
  select private.lukas_drawing_apply_operation(
    p_revision_id, p_client_operation_id, p_operation_type,
    p_base_versions, p_forward, p_inverse
  )
$$;

create or replace function public.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb
language sql security invoker
set search_path = ''
as $$ select private.lukas_drawing_request_review(p_revision_id) $$;

create or replace function public.lukas_drawing_record_revision_decision(
  p_revision_id uuid, p_subject_version bigint, p_snapshot_sha256 text,
  p_decision text, p_note text
) returns jsonb
language sql security invoker
set search_path = ''
as $$
  select private.lukas_drawing_record_revision_decision(
    p_revision_id, p_subject_version, p_snapshot_sha256, p_decision, p_note
  )
$$;

revoke all on function private.lukas_drawing_create_document_pre_hardening(uuid, uuid, text, boolean)
  from public, anon, authenticated;
revoke all on function private.lukas_drawing_apply_operation_pre_hardening(uuid, uuid, text, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function private.lukas_drawing_request_review_pre_hardening(uuid)
  from public, anon, authenticated;
revoke all on function private.lukas_drawing_record_revision_decision_pre_hardening(uuid, bigint, text, text, text)
  from public, anon, authenticated;

revoke all on function private.lukas_drawing_create_document(uuid, uuid, text, boolean)
  from public, anon;
revoke all on function private.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  from public, anon;
revoke all on function private.lukas_drawing_request_review(uuid) from public, anon;
revoke all on function private.lukas_drawing_record_revision_decision(uuid, bigint, text, text, text)
  from public, anon;
grant execute on function private.lukas_drawing_create_document(uuid, uuid, text, boolean)
  to authenticated, service_role;
grant execute on function private.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function private.lukas_drawing_request_review(uuid)
  to authenticated, service_role;
grant execute on function private.lukas_drawing_record_revision_decision(uuid, bigint, text, text, text)
  to authenticated, service_role;

revoke all on function public.lukas_drawing_create_document(uuid, uuid, text, boolean)
  from public, anon;
revoke all on function public.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  from public, anon;
revoke all on function public.lukas_drawing_request_review(uuid) from public, anon;
revoke all on function public.lukas_drawing_record_revision_decision(uuid, bigint, text, text, text)
  from public, anon;
grant execute on function public.lukas_drawing_create_document(uuid, uuid, text, boolean)
  to authenticated, service_role;
grant execute on function public.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  to authenticated, service_role;
grant execute on function public.lukas_drawing_request_review(uuid)
  to authenticated, service_role;
grant execute on function public.lukas_drawing_record_revision_decision(uuid, bigint, text, text, text)
  to authenticated, service_role;

alter function public.lukas_drawing_link_object_issue(uuid, uuid)
  rename to lukas_drawing_link_object_issue_pre_hardening;

create function public.lukas_drawing_link_object_issue(
  p_object_id uuid,
  p_issue_id uuid
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  return public.lukas_drawing_link_object_issue_pre_hardening(
    p_object_id, p_issue_id
  );
exception
  when raise_exception then
    if sqlerrm ilike '%requires a draft revision%' then
      raise exception using errcode = 'P1C01', message = sqlerrm;
    end if;
    raise exception using errcode = 'P1R01', message = sqlerrm;
end;
$$;

revoke all on function public.lukas_drawing_link_object_issue_pre_hardening(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.lukas_drawing_link_object_issue(uuid, uuid)
  from public, anon;
grant execute on function public.lukas_drawing_link_object_issue(uuid, uuid)
  to authenticated, service_role;
