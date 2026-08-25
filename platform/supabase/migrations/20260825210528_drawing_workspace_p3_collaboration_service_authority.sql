begin;

create or replace function private.lukas_drawing_collaboration_service_load_state(
  p_project_id uuid,p_revision_id uuid
) returns table(
  revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
  yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
  byte_size integer,persisted_at timestamptz
) language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(
    select 1 from public.lukas_drawing_revisions r
    where r.id=p_revision_id and r.project_id=p_project_id
  ) then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  return query
  select s.revision_id,s.project_id,s.schema_version,s.yjs_state,s.yjs_sha256,
    s.base_operation_sequence,s.store_generation,s.byte_size,s.persisted_at
  from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id;
end;
$$;

create or replace function private.lukas_drawing_collaboration_service_store_state(
  p_project_id uuid,p_revision_id uuid,p_schema_version smallint,
  p_yjs_state bytea,p_base_operation_sequence bigint,
  p_expected_generation bigint,p_expected_sha256 text
) returns table(
  revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
  yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
  byte_size integer,persisted_at timestamptz
) language plpgsql security definer set search_path='' as $$
declare
  v_existing private.lukas_drawing_collaboration_states%rowtype;
  v_status text;
  v_max_sequence bigint;
  v_sha text;
begin
  select r.status into v_status from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  if not found or v_status<>'draft' then
    raise exception using errcode='P3A02',message='Drawing collaboration room is read-only';
  end if;
  if p_schema_version is distinct from 1
    or p_yjs_state is null
    or pg_catalog.octet_length(p_yjs_state) not between 1 and 8388608
    or p_base_operation_sequence is null or p_base_operation_sequence<0
    or p_expected_generation is null or p_expected_generation<0
    or (p_expected_sha256 is not null and p_expected_sha256 !~ '^[0-9a-f]{64}$') then
    raise exception using errcode='P3S01',message='Drawing collaboration state is invalid';
  end if;
  select pg_catalog.coalesce(pg_catalog.max(o.sequence),0) into v_max_sequence
  from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id and o.project_id=p_project_id;
  if p_base_operation_sequence>v_max_sequence then
    raise exception using errcode='P3S01',message='Drawing collaboration sequence is invalid';
  end if;
  v_sha:=pg_catalog.encode(extensions.digest(p_yjs_state,'sha256'),'hex');
  select s.* into v_existing from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  if found then
    if p_base_operation_sequence<v_existing.base_operation_sequence then
      raise exception using errcode='P3S02',message='Drawing collaboration sequence cannot move backward';
    end if;
    if p_base_operation_sequence=v_existing.base_operation_sequence
      and v_sha=v_existing.yjs_sha256 then
      return query select * from private.lukas_drawing_collaboration_service_load_state(
        p_project_id,p_revision_id
      );
      return;
    end if;
    if p_expected_generation<>v_existing.store_generation
      or p_expected_sha256 is distinct from v_existing.yjs_sha256 then
      raise exception using errcode='P3S03',
        message='Drawing collaboration state changed; reload and merge before retry';
    end if;
    update private.lukas_drawing_collaboration_states s set
      schema_version=p_schema_version,yjs_state=p_yjs_state,yjs_sha256=v_sha,
      base_operation_sequence=p_base_operation_sequence,
      store_generation=v_existing.store_generation+1,
      byte_size=pg_catalog.octet_length(p_yjs_state),persisted_at=pg_catalog.now()
    where s.revision_id=p_revision_id and s.project_id=p_project_id;
  else
    if p_expected_generation<>0 or p_expected_sha256 is not null then
      raise exception using errcode='P3S03',
        message='Drawing collaboration state changed; reload and merge before retry';
    end if;
    insert into private.lukas_drawing_collaboration_states(
      revision_id,project_id,schema_version,yjs_state,yjs_sha256,
      base_operation_sequence,store_generation,byte_size,persisted_at
    ) values(
      p_revision_id,p_project_id,p_schema_version,p_yjs_state,v_sha,
      p_base_operation_sequence,1,pg_catalog.octet_length(p_yjs_state),pg_catalog.now()
    );
  end if;
  return query select * from private.lukas_drawing_collaboration_service_load_state(
    p_project_id,p_revision_id
  );
end;
$$;

create or replace function private.lukas_drawing_collaboration_service_bootstrap(
  p_project_id uuid,p_revision_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_graph jsonb; v_sequence bigint; v_sha text;
begin
  if not exists(
    select 1 from public.lukas_drawing_revisions r
    where r.id=p_revision_id and r.project_id=p_project_id and r.status='draft'
  ) then
    raise exception using errcode='P3A02',message='Drawing collaboration room is read-only';
  end if;
  v_graph:=private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true);
  if v_graph is null or v_graph->>'schemaVersion'<>'2' then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  v_sequence:=(v_graph->>'operationSequence')::bigint;
  v_sha:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_graph::text,'UTF8'),'sha256'),'hex'
  );
  return pg_catalog.jsonb_build_object('sha256',v_sha,'operationSequence',v_sequence);
end;
$$;

revoke all on function private.lukas_drawing_collaboration_service_load_state(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_service_store_state(uuid,uuid,smallint,bytea,bigint,bigint,text)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_service_bootstrap(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_collaboration_service_load_state(uuid,uuid)
  to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_service_store_state(uuid,uuid,smallint,bytea,bigint,bigint,text)
  to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_service_bootstrap(uuid,uuid)
  to lukas_drawing_collaboration;

commit;
