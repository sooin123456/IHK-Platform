begin;

create function private.lukas_drawing_collaboration_assert_store_unleased(
  p_project_id uuid,p_revision_id uuid
) returns void language plpgsql security definer set search_path='' as $$
declare
  v_lease private.lukas_drawing_collaboration_freeze_leases%rowtype;
  v_freeze_state text;
begin
  select l.* into v_lease
  from private.lukas_drawing_collaboration_freeze_leases l
  where l.revision_id=p_revision_id and l.project_id=p_project_id
  for update;
  if not found then return; end if;
  if v_lease.lease_expires_at>pg_catalog.clock_timestamp() then
    select s.freeze_state into v_freeze_state
    from private.lukas_drawing_collaboration_states s
    where s.revision_id=p_revision_id and s.project_id=p_project_id
    for update;
    if found and v_freeze_state in ('freezing','frozen') then
      raise exception using errcode='P3F02',
        message='Drawing collaboration freeze is immutable';
    end if;
    raise exception using errcode='P3F03',
      message='Drawing collaboration freeze lease is busy';
  end if;

  delete from private.lukas_drawing_collaboration_freeze_leases l
  where l.revision_id=p_revision_id and l.project_id=p_project_id
    and l.lease_expires_at<=pg_catalog.clock_timestamp();
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states s set
    freeze_owner_token=null,freeze_owner_request_id=null,
    freeze_owner_lease_expires_at=null
  where s.revision_id=p_revision_id and s.project_id=p_project_id
    and s.freeze_state in ('active','released')
    and s.freeze_owner_token=v_lease.owner_token
    and s.freeze_owner_request_id=v_lease.request_id;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
end;
$$;
revoke all on function private.lukas_drawing_collaboration_assert_store_unleased(uuid,uuid)
  from public,anon,authenticated,service_role,lukas_drawing_collaboration;

alter function private.lukas_drawing_collaboration_store_state(
  uuid,uuid,uuid,smallint,bytea,bigint,bigint,text
) rename to lukas_drawing_collaboration_store_state_unfenced;
revoke all on function private.lukas_drawing_collaboration_store_state_unfenced(
  uuid,uuid,uuid,smallint,bytea,bigint,bigint,text
) from public,anon,authenticated,service_role,lukas_drawing_collaboration;

create function private.lukas_drawing_collaboration_store_state(
  p_user_id uuid,p_project_id uuid,p_revision_id uuid,p_schema_version smallint,
  p_yjs_state bytea,p_base_operation_sequence bigint,
  p_expected_generation bigint,p_expected_sha256 text
) returns table(
  revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
  yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
  byte_size integer,persisted_at timestamptz
) language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  perform private.lukas_drawing_collaboration_assert_store_unleased(
    p_project_id,p_revision_id
  );
  return query
  select * from private.lukas_drawing_collaboration_store_state_unfenced(
    p_user_id,p_project_id,p_revision_id,p_schema_version,p_yjs_state,
    p_base_operation_sequence,p_expected_generation,p_expected_sha256
  );
end;
$$;

create or replace function private.lukas_drawing_collaboration_store_state(
  p_user_id uuid,p_project_id uuid,p_revision_id uuid,p_schema_version smallint,
  p_yjs_state bytea,p_base_operation_sequence bigint
) returns table(
  revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
  yjs_sha256 text,base_operation_sequence bigint,byte_size integer,
  persisted_at timestamptz
) language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  perform private.lukas_drawing_collaboration_assert_store_unleased(
    p_project_id,p_revision_id
  );
  raise exception using errcode='P3S03',
    message='Drawing collaboration store generation token is required';
end;
$$;

alter function private.lukas_drawing_collaboration_service_store_state(
  uuid,uuid,smallint,bytea,bigint,bigint,text
) rename to lukas_drawing_collaboration_service_store_state_unfenced;
revoke all on function private.lukas_drawing_collaboration_service_store_state_unfenced(
  uuid,uuid,smallint,bytea,bigint,bigint,text
) from public,anon,authenticated,service_role,lukas_drawing_collaboration;

create function private.lukas_drawing_collaboration_service_store_state(
  p_project_id uuid,p_revision_id uuid,p_schema_version smallint,
  p_yjs_state bytea,p_base_operation_sequence bigint,
  p_expected_generation bigint,p_expected_sha256 text
) returns table(
  revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
  yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
  byte_size integer,persisted_at timestamptz
) language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  perform private.lukas_drawing_collaboration_assert_store_unleased(
    p_project_id,p_revision_id
  );
  return query
  select * from private.lukas_drawing_collaboration_service_store_state_unfenced(
    p_project_id,p_revision_id,p_schema_version,p_yjs_state,
    p_base_operation_sequence,p_expected_generation,p_expected_sha256
  );
end;
$$;

revoke all on function private.lukas_drawing_collaboration_store_state(
  uuid,uuid,uuid,smallint,bytea,bigint
) from public,anon,authenticated,service_role,lukas_drawing_collaboration;
revoke all on function private.lukas_drawing_collaboration_store_state(
  uuid,uuid,uuid,smallint,bytea,bigint,bigint,text
) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_collaboration_store_state(
  uuid,uuid,uuid,smallint,bytea,bigint,bigint,text
) to lukas_drawing_collaboration;
revoke all on function private.lukas_drawing_collaboration_service_store_state(
  uuid,uuid,smallint,bytea,bigint,bigint,text
) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_collaboration_service_store_state(
  uuid,uuid,smallint,bytea,bigint,bigint,text
) to lukas_drawing_collaboration;

commit;
