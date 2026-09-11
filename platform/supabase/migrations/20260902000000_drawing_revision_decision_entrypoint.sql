-- Restore the authenticated decision entrypoint without exposing the private
-- authority function directly. The staged-approval migration intentionally
-- revoked authenticated access to private helpers, so the public wrapper must
-- cross that boundary as its owner while the private function and triggers
-- continue to authorize auth.uid(), project role, maker-checker, and snapshot.

-- The original table declared the parent and lifecycle checks without names.
-- PostgreSQL named them `..._check` and `..._check1`; the staged-approval
-- migration dropped the former while intending to replace the latter. Remove
-- the stale lifecycle check and restore the accidentally removed parent guard
-- with stable names.
alter table public.lukas_drawing_revisions
  drop constraint if exists lukas_drawing_revisions_check1;
alter table public.lukas_drawing_revisions
  drop constraint if exists lukas_drawing_revisions_parent_not_self_check;
alter table public.lukas_drawing_revisions
  add constraint lukas_drawing_revisions_parent_not_self_check
    check(parent_revision_id is null or parent_revision_id <> id);

create or replace function private.lukas_drawing_revision_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and pg_catalog.pg_trigger_depth() > 1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project', true
    ) = old.project_id::text
    and current_user = pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid = tg_relid)
    )
    and not exists(
      select 1 from public.lukas_qto_projects p
      where p.id = old.project_id
    ) then return old;
  end if;
  if tg_op = 'UPDATE'
    and current_user not in ('authenticated', 'anon')
    and pg_catalog.current_setting(
      'private.lukas_drawing_snapshot_restore_reparent', true
    ) = old.id::text
    and old.status = 'draft'
    and new.status = 'draft'
    and new.id = old.id
    and new.project_id = old.project_id
    and new.version = old.version
    and new.created_by = old.created_by
    and new.created_at = old.created_at
    and new.review_requested_at is null
    and new.approved_at is null then
    return new;
  end if;

  if old.status = 'approved' then
    raise exception 'Approved drawing revision is immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;

  if new.document_id is distinct from old.document_id
    or new.project_id is distinct from old.project_id
    or new.parent_revision_id is distinct from old.parent_revision_id
    or new.sequence is distinct from old.sequence
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Drawing revision identity is immutable';
  end if;
  if new.status = old.status and new.version is distinct from old.version then
    raise exception 'Direct drawing revision version update is forbidden';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'draft' and new.status = 'review_requested' then
      if new.version <> old.version
        or new.review_requested_at is null
        or new.approved_at is not null
        or not exists(
          select 1
          from public.lukas_drawing_snapshots s
          where s.revision_id = old.id
            and s.project_id = old.project_id
            and s.revision_version = old.version
        ) then
        raise exception 'Drawing review request requires a canonical snapshot';
      end if;
    elsif old.status = 'review_requested' and new.status = 'reviewed' then
      if new.version <> old.version
        or new.review_requested_at is distinct from old.review_requested_at
        or new.approved_at is not null
        or not exists(
          select 1
          from public.lukas_drawing_revision_approvals a
          where a.revision_id = old.id
            and a.project_id = old.project_id
            and a.subject_version = old.version
            and a.decision = 'reviewed'
        ) then
        raise exception 'Drawing review requires an append-only decision';
      end if;
    elsif old.status = 'reviewed' and new.status = 'approved' then
      if new.version <> old.version
        or new.review_requested_at is distinct from old.review_requested_at
        or new.approved_at is null
        or not exists(
          select 1
          from public.lukas_drawing_revision_approvals a
          where a.revision_id = old.id
            and a.project_id = old.project_id
            and a.subject_version = old.version
            and a.decision = 'approved'
        ) then
        raise exception 'Drawing approval requires an append-only decision';
      end if;
    elsif old.status in ('review_requested', 'reviewed')
      and new.status = 'draft' then
      if new.version <> old.version + 1
        or new.review_requested_at is not null
        or new.approved_at is not null
        or not exists(
          select 1
          from public.lukas_drawing_revision_approvals a
          where a.revision_id = old.id
            and a.project_id = old.project_id
            and a.subject_version = old.version
            and a.decision = 'rejected'
        ) then
        raise exception 'Drawing rejection requires an append-only decision';
      end if;
    else
      raise exception 'Direct drawing revision status update is forbidden';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.lukas_drawing_revision_guard()
  from public, anon, authenticated, service_role;
grant execute on function private.lukas_drawing_revision_guard()
  to service_role;

-- The public decision entrypoint below runs as its owner so it can reach the
-- intentionally private recorder. Every authorization predicate in the
-- approval trigger therefore has to reject SQL NULL explicitly: a plain
-- `NULL <> 'reviewer'` is NULL, which PL/pgSQL does not enter as a true IF.
create or replace function private.lukas_drawing_revision_approval_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_role text;
begin
  if v_actor is null
    or private.lukas_qto_verified_session() is not true
    or new.decided_by is distinct from v_actor then
    raise exception 'Authenticated drawing decision actor required';
  end if;

  select * into v_revision
  from public.lukas_drawing_revisions r
  where r.id = new.revision_id
    and r.project_id = new.project_id
  for update;
  if not found then
    raise exception 'Drawing revision does not exist';
  end if;
  if v_revision.created_by = v_actor then
    raise exception 'Maker cannot decide their own drawing revision';
  end if;
  if private.lukas_qto_project_feature_active(
    v_revision.project_id, 'drawing_workspace'
  ) is not true then
    raise exception 'Drawing workspace entitlement is unavailable';
  end if;

  v_role := private.lukas_qto_project_role(v_revision.project_id);
  if new.decision = 'reviewed' then
    if v_role is distinct from 'reviewer'
      or v_revision.status <> 'review_requested' then
      raise exception 'Exact drawing reviewer recommendation required';
    end if;
  elsif new.decision = 'approved' then
    if v_role is distinct from 'approver'
      or v_revision.status <> 'reviewed' then
      raise exception 'Exact drawing approver final authority required';
    end if;
    if not exists(
      select 1
      from public.lukas_drawing_revision_approvals a
      where a.revision_id = new.revision_id
        and a.project_id = new.project_id
        and a.subject_version = new.subject_version
        and a.snapshot_sha256 = new.snapshot_sha256
        and a.decision = 'reviewed'
        and a.decided_by <> v_actor
        and a.decided_by <> v_revision.created_by
    ) then
      raise exception 'Independent reviewer recommendation required';
    end if;
  elsif new.decision = 'rejected' then
    if coalesce(
      (v_role = 'reviewer' and v_revision.status = 'review_requested')
      or (v_role = 'approver' and v_revision.status = 'reviewed'),
      false
    ) is not true then
      raise exception 'Exact staged rejection authority required';
    end if;
  else
    raise exception 'Invalid drawing decision';
  end if;

  if v_revision.version <> new.subject_version then
    raise exception 'Drawing revision subject version changed';
  end if;
  if not exists(
    select 1
    from public.lukas_drawing_snapshots s
    where s.revision_id = new.revision_id
      and s.project_id = new.project_id
      and s.revision_version = new.subject_version
      and s.sha256 = new.snapshot_sha256
  ) then
    raise exception 'Drawing decision snapshot SHA does not match';
  end if;

  new.created_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.lukas_drawing_revision_approval_guard()
  from public, anon, authenticated, service_role;
grant execute on function private.lukas_drawing_revision_approval_guard()
  to service_role;

-- Keep authorization ahead of the row lock as well as in the insert trigger.
-- This makes a foreign and a nonexistent revision indistinguishable to an
-- authenticated caller while retaining the trigger as defense in depth.
create or replace function private.lukas_drawing_record_revision_decision(
  p_revision_id uuid,
  p_subject_version bigint,
  p_snapshot_sha256 text,
  p_decision text,
  p_note text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_approval_id uuid;
  v_status text;
  v_version bigint;
begin
  if v_actor is null
    or private.lukas_qto_verified_session() is not true
    or p_decision not in ('reviewed', 'approved', 'rejected')
    or p_note is null
    or pg_catalog.char_length(p_note) > 5000 then
    raise exception using errcode = 'P1R01',
      message = 'Drawing revision decision denied';
  end if;

  select * into v_revision
  from public.lukas_drawing_revisions r
  where r.id = p_revision_id
    and r.created_by <> v_actor
    and private.lukas_qto_project_feature_active(
      r.project_id, 'drawing_workspace'
    ) is true
    and (
      (p_decision = 'reviewed'
        and r.status = 'review_requested'
        and private.lukas_qto_project_role(r.project_id) = 'reviewer')
      or (p_decision = 'approved'
        and r.status = 'reviewed'
        and private.lukas_qto_project_role(r.project_id) = 'approver')
      or (p_decision = 'rejected' and (
        (r.status = 'review_requested'
          and private.lukas_qto_project_role(r.project_id) = 'reviewer')
        or (r.status = 'reviewed'
          and private.lukas_qto_project_role(r.project_id) = 'approver')
      ))
    )
  for update;
  if not found then
    raise exception using errcode = 'P1R01',
      message = 'Drawing revision decision denied';
  end if;

  insert into public.lukas_drawing_revision_approvals(
    revision_id,
    project_id,
    subject_version,
    snapshot_sha256,
    decision,
    note,
    decided_by
  ) values (
    p_revision_id,
    v_revision.project_id,
    p_subject_version,
    p_snapshot_sha256,
    p_decision,
    p_note,
    v_actor
  ) returning id into v_approval_id;

  select status, version into v_status, v_version
  from public.lukas_drawing_revisions
  where id = p_revision_id;
  return pg_catalog.jsonb_build_object(
    'approvalId', v_approval_id,
    'status', v_status,
    'version', v_version
  );
end;
$$;

revoke all on function private.lukas_drawing_record_revision_decision(
  uuid, bigint, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function private.lukas_drawing_record_revision_decision(
  uuid, bigint, text, text, text
) to service_role;

create or replace function public.lukas_drawing_record_revision_decision(
  p_revision_id uuid,
  p_subject_version bigint,
  p_snapshot_sha256 text,
  p_decision text,
  p_note text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.lukas_drawing_record_revision_decision(
    p_revision_id,
    p_subject_version,
    p_snapshot_sha256,
    p_decision,
    p_note
  )
$$;

revoke all on function public.lukas_drawing_record_revision_decision(
  uuid, bigint, text, text, text
) from public, anon, authenticated, service_role;
grant execute on function public.lukas_drawing_record_revision_decision(
  uuid, bigint, text, text, text
) to authenticated, service_role;
