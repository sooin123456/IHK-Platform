begin;

-- Serialize first admission on the same revision lock used by graph writers.
-- Yjs semantics are checked by the trusted server; SQL binds its candidate to
-- the current canonical graph and never merges or overwrites an existing origin.
create function private.lukas_drawing_collaboration_initialize_state_core(
  p_project_id uuid,p_revision_id uuid,p_yjs_state bytea,
  p_base_operation_sequence bigint,p_base_snapshot_sha256 text,
  p_allow_readonly boolean
) returns setof private.lukas_drawing_collaboration_states
language plpgsql security definer set search_path='' as $$
declare
  v_status text;
  v_graph jsonb;
  v_snapshot_sha256 text;
begin
  select r.status into v_status from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  if not found then
    raise exception using errcode='P3A01',
      message='Drawing collaboration target is unavailable';
  end if;

  return query select s.* from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id;
  if found then return; end if;

  if p_allow_readonly is not true and v_status<>'draft' then
    raise exception using errcode='P3A02',
      message='Drawing collaboration room is read-only';
  end if;
  if p_yjs_state is null
    or pg_catalog.octet_length(p_yjs_state) not between 1 and 8388608
    or p_base_operation_sequence is null or p_base_operation_sequence<0
    or p_base_snapshot_sha256 is null
    or p_base_snapshot_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='P3S01',
      message='Drawing collaboration state is invalid';
  end if;

  v_graph:=private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true);
  v_snapshot_sha256:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_graph::text,'UTF8'),'sha256'),'hex');
  if v_graph->>'schemaVersion' is distinct from '2'
    or (v_graph->>'operationSequence')::bigint is distinct from p_base_operation_sequence
    or v_snapshot_sha256 is distinct from p_base_snapshot_sha256 then
    raise exception using errcode='P3S04',
      message='Drawing collaboration snapshot changed; reload before initializing';
  end if;

  -- Initial persistence is insert-only, even under a pre-acquired freeze lease.
  -- Leave that lease untouched and establish only active/null initial metadata.
  return query
  insert into private.lukas_drawing_collaboration_states(
    revision_id,project_id,schema_version,yjs_state,yjs_sha256,
    base_operation_sequence,store_generation,byte_size,persisted_at,
    freeze_state,freeze_request_id
  ) values(
    p_revision_id,p_project_id,1,p_yjs_state,
    pg_catalog.encode(extensions.digest(p_yjs_state,'sha256'),'hex'),
    p_base_operation_sequence,1,pg_catalog.octet_length(p_yjs_state),pg_catalog.now(),
    'active',null
  ) returning *;
end;
$$;

create function private.lukas_drawing_collaboration_initialize_state(
  p_user_id uuid,p_project_id uuid,p_revision_id uuid,p_yjs_state bytea,
  p_base_operation_sequence bigint,p_base_snapshot_sha256 text
) returns setof private.lukas_drawing_collaboration_states
language plpgsql security definer set search_path='' as $$
begin
  -- The collaboration server supplies the verified user ID, including Viewers.
  perform 1 from private.lukas_drawing_collaboration_authorize(
    p_user_id,p_project_id,p_revision_id
  );
  return query select * from private.lukas_drawing_collaboration_initialize_state_core(
    p_project_id,p_revision_id,p_yjs_state,p_base_operation_sequence,
    p_base_snapshot_sha256,true
  );
end;
$$;

create function private.lukas_drawing_collaboration_service_initialize_state(
  p_project_id uuid,p_revision_id uuid,p_yjs_state bytea,
  p_base_operation_sequence bigint,p_base_snapshot_sha256 text
) returns setof private.lukas_drawing_collaboration_states
language plpgsql security definer set search_path='' as $$
begin
  if not private.lukas_qto_project_feature_active(
    p_project_id,'realtime_collaboration'
  ) then
    raise exception using errcode='P7A07',
      message='Realtime collaboration entitlement is unavailable';
  end if;
  return query select * from private.lukas_drawing_collaboration_initialize_state_core(
    p_project_id,p_revision_id,p_yjs_state,p_base_operation_sequence,
    p_base_snapshot_sha256,false
  );
end;
$$;

revoke all on function
  private.lukas_drawing_collaboration_initialize_state_core(uuid,uuid,bytea,bigint,text,boolean),
  private.lukas_drawing_collaboration_initialize_state(uuid,uuid,uuid,bytea,bigint,text),
  private.lukas_drawing_collaboration_service_initialize_state(uuid,uuid,bytea,bigint,text)
from public,anon,authenticated,service_role,lukas_drawing_collaboration;

grant execute on function
  private.lukas_drawing_collaboration_initialize_state(uuid,uuid,uuid,bytea,bigint,text),
  private.lukas_drawing_collaboration_service_initialize_state(uuid,uuid,bytea,bigint,text)
to lukas_drawing_collaboration;

commit;
