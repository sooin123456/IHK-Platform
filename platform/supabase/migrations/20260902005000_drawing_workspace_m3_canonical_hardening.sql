begin;

-- The canonical HTTP editor always needs an exact graph/checkpoint, even when
-- the organization has disabled realtime transport. Keep that read authority
-- on the drawing_workspace entitlement without weakening collaboration state
-- or WebSocket authorization.
create or replace function private.lukas_drawing_workspace_checkpoint_bootstrap(
  p_project_id uuid,p_revision_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_capability text; v_status text; v_graph jsonb;
  v_sequence bigint; v_sha text; v_outcomes jsonb;
begin
  select private.lukas_drawing_workspace_capability(p_project_id),r.status
  into v_capability,v_status
  from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id;
  if not found or v_capability is null then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  v_graph:=private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true);
  if v_graph is null or v_graph->>'schemaVersion'<>'2' then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  v_sequence:=(v_graph->>'operationSequence')::bigint;
  v_sha:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_graph::text,'UTF8'),'sha256'),'hex'
  );
  select coalesce(pg_catalog.jsonb_agg(x.payload order by x.sequence),'[]'::jsonb)
  into v_outcomes from (
    select o.sequence,pg_catalog.jsonb_build_object(
      'revisionId',o.revision_id,'clientOperationId',o.client_operation_id,
      'actorId',o.actor_id,'operationType',o.operation_type,
      'baseVersions',o.base_versions,'forward',o.forward,'inverse',o.inverse,
      'sequence',o.sequence,'resultVersions',o.result_versions
    ) || case when o.history_action is null then '{}'::jsonb else
      pg_catalog.jsonb_build_object('historyAction',o.history_action,
        'originalOperationId',o.original_operation_id) end payload
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.project_id=p_project_id
    order by o.sequence desc limit 256
  ) x;
  return pg_catalog.jsonb_build_object(
    'canonicalJson',v_graph,'operationSequence',v_sequence,
    'schemaVersion',2,'sha256',v_sha,'revisionStatus',v_status,
    'capability',v_capability,
    'canWrite',v_capability in ('admin','editor') and v_status='draft',
    'recentOutcomes',v_outcomes
  );
end;
$$;

-- Anonymous authenticated sessions may hold a UUID and project membership but
-- are never allowed to read the canonical collaboration graph.
create or replace function public.lukas_drawing_collaboration_bootstrap(
  p_revision_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_project_id uuid;
begin
  if v_actor is null
    or private.lukas_qto_verified_session() is not true then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  select r.project_id into v_project_id from public.lukas_drawing_revisions r
  where r.id=p_revision_id;
  if not found then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  return private.lukas_drawing_workspace_checkpoint_bootstrap(
    v_project_id,p_revision_id
  );
end;
$$;

-- A response-loss retry remains the same request after an independent reviewer
-- or approver advances the already frozen subject. Validate every freeze field
-- before returning the immutable snapshot receipt.
create or replace function private.lukas_drawing_request_collaborative_review(
  p_revision_id uuid,p_request_id uuid,p_manifest_sha256 text,
  p_manifest_count integer,p_base_operation_sequence bigint,
  p_subject_revision_version bigint,p_state_vector_base64 text,
  p_operation_statuses jsonb,p_manifest jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_state private.lukas_drawing_collaboration_states%rowtype;
  v_snapshot public.lukas_drawing_snapshots%rowtype;
  v_result jsonb;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_qto_verified_session() is true
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P1R01',message='Drawing revision target is unavailable';
  end if;
  select s.* into v_state from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=v_revision.project_id for update;
  if not found or v_state.freeze_state<>'frozen'
    or v_state.freeze_request_id is distinct from p_request_id
    or v_state.accepted_manifest_sha256 is distinct from p_manifest_sha256
    or v_state.accepted_operation_count is distinct from p_manifest_count
    or v_state.frozen_base_operation_sequence is distinct from p_base_operation_sequence
    or v_state.frozen_subject_revision_version is distinct from p_subject_revision_version
    or v_revision.version is distinct from p_subject_revision_version
    or v_state.frozen_yjs_state_vector is distinct from p_state_vector_base64
    or v_state.frozen_operation_statuses is distinct from p_operation_statuses then
    raise exception using errcode='P3F01',message='Drawing review requires exact versioned freeze evidence';
  end if;
  if v_revision.status in ('review_requested','reviewed','approved') then
    select s.* into v_snapshot from public.lukas_drawing_snapshots s
    where s.revision_id=p_revision_id and s.project_id=v_revision.project_id
      and s.revision_version=v_revision.version order by s.created_at desc limit 1;
    if not found then
      raise exception using errcode='P3F02',message='Committed drawing review snapshot is unavailable';
    end if;
    return pg_catalog.jsonb_build_object(
      'snapshotId',v_snapshot.id,'subjectVersion',v_revision.version,
      'snapshotSha256',v_snapshot.sha256,
      'operationSequence',v_snapshot.operation_sequence,
      'freezeRequestId',p_request_id,
      'subjectRevisionVersion',p_subject_revision_version,
      'stateVectorBase64',p_state_vector_base64
    );
  end if;
  if v_revision.status<>'draft' then
    raise exception using errcode='P3F01',message='Drawing review requires exact versioned freeze evidence';
  end if;
  v_result:=private.lukas_drawing_request_collaborative_review(
    p_revision_id,p_request_id,p_manifest_sha256,p_manifest_count,
    p_base_operation_sequence,p_manifest
  );
  return v_result||pg_catalog.jsonb_build_object(
    'subjectRevisionVersion',p_subject_revision_version,
    'stateVectorBase64',p_state_vector_base64
  );
end;
$$;

-- HTTP-only workspaces still use the canonical snapshot writer. A stale room
-- row must require freeze proof only while collaboration is actually enabled.
create or replace function private.lukas_drawing_request_review_legacy_guard(
  p_revision_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_qto_verified_session() is true
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P1R01',message='Drawing revision target is unavailable';
  end if;
  if private.lukas_qto_project_feature_active(
      v_revision.project_id,'realtime_collaboration'
    ) is true and exists(
      select 1 from private.lukas_drawing_collaboration_states s
      where s.revision_id=p_revision_id and s.project_id=v_revision.project_id
    ) then
    raise exception using errcode='P3F01',message='Collaborative drawing review requires room freeze';
  end if;
  return private.lukas_drawing_request_review(p_revision_id);
end;
$$;

-- HTTP loader snapshots have no collaboration checkpoint. Advance the
-- revision timestamp once per committed operation so revalidation has a
-- monotonic, O(1) identity even for very large drawings.
create or replace function private.lukas_drawing_operation_touch_revision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  update public.lukas_drawing_revisions r
  set updated_at=greatest(
    pg_catalog.clock_timestamp(),r.updated_at+interval '1 microsecond'
  )
  where r.id=new.revision_id and r.project_id=new.project_id;
  return new;
end;
$$;
drop trigger if exists lukas_drawing_operations_touch_revision
  on public.lukas_drawing_operations;
create trigger lukas_drawing_operations_touch_revision
after insert on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_operation_touch_revision();

revoke all on function public.lukas_drawing_collaboration_bootstrap(uuid) from public,anon,authenticated,service_role,lukas_drawing_collaboration;
grant execute on function public.lukas_drawing_collaboration_bootstrap(uuid) to authenticated;

revoke all on function private.lukas_drawing_workspace_checkpoint_bootstrap(uuid,uuid)
  from public,anon,authenticated,service_role,lukas_drawing_collaboration;

revoke all on function private.lukas_drawing_operation_touch_revision()
  from public,anon,authenticated,service_role,lukas_drawing_collaboration;
revoke all on function private.lukas_drawing_request_review_legacy_guard(uuid)
  from public,anon;
grant execute on function private.lukas_drawing_request_review_legacy_guard(uuid)
  to authenticated,service_role;

revoke all on function private.lukas_drawing_request_collaborative_review(
  uuid,uuid,text,integer,bigint,jsonb
) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_request_collaborative_review(
  uuid,uuid,text,integer,bigint,bigint,text,jsonb,jsonb
) from public,anon;
revoke all on function public.lukas_drawing_request_collaborative_review(
  uuid,uuid,text,integer,bigint,bigint,text,jsonb,jsonb
) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_request_collaborative_review(
  uuid,uuid,text,integer,bigint,bigint,text,jsonb,jsonb
) to authenticated,service_role;
grant execute on function public.lukas_drawing_request_collaborative_review(
  uuid,uuid,text,integer,bigint,bigint,text,jsonb,jsonb
) to authenticated,service_role;

commit;
