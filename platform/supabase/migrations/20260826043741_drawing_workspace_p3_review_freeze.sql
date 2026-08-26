begin;

alter table private.lukas_drawing_collaboration_states
  add column freeze_state text not null default 'active',
  add column freeze_request_id uuid,
  add column accepted_manifest_sha256 text,
  add column accepted_operation_count integer,
  add column frozen_base_operation_sequence bigint,
  add column frozen_at timestamptz,
  add column review_committed_at timestamptz,
  add constraint lukas_drawing_collaboration_states_freeze_check check (
    (freeze_state='active' and freeze_request_id is null
      and accepted_manifest_sha256 is null and accepted_operation_count is null
      and frozen_base_operation_sequence is null and frozen_at is null
      and review_committed_at is null)
    or (freeze_state='freezing' and freeze_request_id is not null
      and accepted_manifest_sha256 is null and accepted_operation_count is null
      and frozen_base_operation_sequence is null and frozen_at is null
      and review_committed_at is null)
    or (freeze_state='frozen' and freeze_request_id is not null
      and accepted_manifest_sha256 ~ '^[0-9a-f]{64}$'
      and accepted_operation_count between 0 and 10000
      and frozen_base_operation_sequence>=0 and frozen_at is not null)
    or (freeze_state='released' and freeze_request_id is not null
      and accepted_manifest_sha256 is null and accepted_operation_count is null
      and frozen_base_operation_sequence is null and frozen_at is null
      and review_committed_at is null)
  );

create function private.lukas_drawing_collaboration_freeze_write_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if old.freeze_state in ('freezing','frozen')
    and coalesce(pg_catalog.current_setting('private.lukas_drawing_freeze_write',true),'')<>'1'
    and (new.yjs_state is distinct from old.yjs_state
      or new.yjs_sha256 is distinct from old.yjs_sha256
      or new.base_operation_sequence is distinct from old.base_operation_sequence
      or new.store_generation is distinct from old.store_generation
      or new.freeze_state is distinct from old.freeze_state
      or new.freeze_request_id is distinct from old.freeze_request_id
      or new.accepted_manifest_sha256 is distinct from old.accepted_manifest_sha256
      or new.accepted_operation_count is distinct from old.accepted_operation_count
      or new.frozen_base_operation_sequence is distinct from old.frozen_base_operation_sequence
      or new.review_committed_at is distinct from old.review_committed_at) then
    raise exception using errcode='P3F02',message='Drawing collaboration freeze is immutable';
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_collaboration_freeze_write_guard
before update on private.lukas_drawing_collaboration_states
for each row execute function private.lukas_drawing_collaboration_freeze_write_guard();

create function private.lukas_drawing_collaboration_read_freeze(
  p_project_id uuid,p_revision_id uuid
) returns table(
  freeze_state text,freeze_request_id uuid,revision_status text,
  accepted_manifest_sha256 text,accepted_operation_count integer,
  frozen_base_operation_sequence bigint
) language sql stable security definer set search_path='' as $$
  select s.freeze_state,s.freeze_request_id,r.status,
    s.accepted_manifest_sha256,s.accepted_operation_count,
    s.frozen_base_operation_sequence
  from private.lukas_drawing_collaboration_states s
  join public.lukas_drawing_revisions r
    on r.id=s.revision_id and r.project_id=s.project_id
  where s.revision_id=p_revision_id and s.project_id=p_project_id
$$;

create function private.lukas_drawing_collaboration_begin_freeze(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,
  p_yjs_state bytea,p_base_operation_sequence bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_revision public.lukas_drawing_revisions%rowtype;
  v_state private.lukas_drawing_collaboration_states%rowtype;
  v_sha text; v_max_sequence bigint; v_changed bigint;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  if not found or v_revision.status<>'draft' then
    raise exception using errcode='P3F02',message='Drawing revision is permanently frozen';
  end if;
  if p_request_id is null or p_yjs_state is null
    or pg_catalog.octet_length(p_yjs_state) not between 1 and 8388608
    or p_base_operation_sequence is null or p_base_operation_sequence<0 then
    raise exception using errcode='P3F01',message='Drawing freeze request is invalid';
  end if;
  select coalesce(pg_catalog.max(o.sequence),0::bigint) into v_max_sequence
  from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id and o.project_id=p_project_id;
  if p_base_operation_sequence>v_max_sequence then
    raise exception using errcode='P3F01',message='Drawing freeze sequence is invalid';
  end if;
  select s.* into v_state from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  if found and v_state.freeze_state in ('freezing','frozen') then
    if v_state.freeze_request_id is distinct from p_request_id then
      raise exception using errcode='P3F01',message='Drawing freeze request does not match';
    end if;
    return pg_catalog.jsonb_build_object(
      'state',v_state.freeze_state,'requestId',v_state.freeze_request_id,
      'revisionStatus',v_revision.status,
      'manifestSha256',v_state.accepted_manifest_sha256,
      'manifestCount',v_state.accepted_operation_count,
      'frozenBaseOperationSequence',v_state.frozen_base_operation_sequence
    );
  end if;
  v_sha:=pg_catalog.encode(extensions.digest(p_yjs_state,'sha256'),'hex');
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  insert into private.lukas_drawing_collaboration_states(
    revision_id,project_id,schema_version,yjs_state,yjs_sha256,
    base_operation_sequence,store_generation,byte_size,persisted_at,
    freeze_state,freeze_request_id
  ) values(
    p_revision_id,p_project_id,1,p_yjs_state,v_sha,p_base_operation_sequence,
    1,pg_catalog.octet_length(p_yjs_state),pg_catalog.now(),'freezing',p_request_id
  ) on conflict(revision_id) do update set
    yjs_state=excluded.yjs_state,yjs_sha256=excluded.yjs_sha256,
    base_operation_sequence=excluded.base_operation_sequence,
    store_generation=private.lukas_drawing_collaboration_states.store_generation+1,
    byte_size=excluded.byte_size,persisted_at=excluded.persisted_at,
    freeze_state='freezing',freeze_request_id=p_request_id,
    accepted_manifest_sha256=null,accepted_operation_count=null,
    frozen_base_operation_sequence=null,frozen_at=null
  where private.lukas_drawing_collaboration_states.project_id=p_project_id
    and private.lukas_drawing_collaboration_states.freeze_state in ('active','released');
  get diagnostics v_changed=row_count;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  if v_changed<>1 then
    raise exception using errcode='P3F01',message='Drawing freeze state changed';
  end if;
  return pg_catalog.jsonb_build_object(
    'state','freezing','requestId',p_request_id,'revisionStatus','draft'
  );
end;
$$;

create function private.lukas_drawing_collaboration_complete_freeze(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,p_yjs_state bytea,
  p_manifest jsonb,p_manifest_sha256 text,p_manifest_count integer,
  p_base_operation_sequence bigint
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_revision public.lukas_drawing_revisions%rowtype;
  v_state private.lukas_drawing_collaboration_states%rowtype; v_sha text;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  if not found or v_revision.status<>'draft' then
    raise exception using errcode='P3F02',message='Drawing revision is permanently frozen';
  end if;
  select s.* into strict v_state from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  if v_state.freeze_request_id is distinct from p_request_id
    or v_state.freeze_state not in ('freezing','frozen') then
    raise exception using errcode='P3F01',message='Drawing freeze request does not match';
  end if;
  if p_yjs_state is null or pg_catalog.octet_length(p_yjs_state) not between 1 and 8388608
    or pg_catalog.jsonb_typeof(p_manifest)<>'array'
    or p_manifest_count is null or p_manifest_count not between 0 and 10000
    or pg_catalog.jsonb_array_length(p_manifest)<>p_manifest_count
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$'
    or p_base_operation_sequence is distinct from v_state.base_operation_sequence then
    raise exception using errcode='P3F01',message='Drawing frozen manifest is invalid';
  end if;
  if v_state.freeze_state='frozen' then
    if v_state.accepted_manifest_sha256 is distinct from p_manifest_sha256
      or v_state.accepted_operation_count is distinct from p_manifest_count
      or v_state.frozen_base_operation_sequence is distinct from p_base_operation_sequence then
      raise exception using errcode='P3F01',message='Drawing frozen manifest does not match';
    end if;
  else
    v_sha:=pg_catalog.encode(extensions.digest(p_yjs_state,'sha256'),'hex');
    perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
    update private.lukas_drawing_collaboration_states set
      yjs_state=p_yjs_state,yjs_sha256=v_sha,
      store_generation=store_generation+1,byte_size=pg_catalog.octet_length(p_yjs_state),
      persisted_at=pg_catalog.now(),freeze_state='frozen',
      accepted_manifest_sha256=p_manifest_sha256,
      accepted_operation_count=p_manifest_count,
      frozen_base_operation_sequence=p_base_operation_sequence,
      frozen_at=pg_catalog.now()
    where revision_id=p_revision_id and project_id=p_project_id;
    perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  end if;
  return pg_catalog.jsonb_build_object(
    'state','frozen','requestId',p_request_id,'revisionStatus','draft',
    'manifestSha256',p_manifest_sha256,'manifestCount',p_manifest_count,
    'frozenBaseOperationSequence',p_base_operation_sequence
  );
exception when no_data_found then
  raise exception using errcode='P3F01',message='Drawing freeze state is unavailable';
end;
$$;

create function private.lukas_drawing_collaboration_release_freeze(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,p_yjs_state bytea
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_status text; v_sha text; v_changed bigint;
begin
  select r.status into v_status from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  if not found or v_status<>'draft' then
    raise exception using errcode='P3F02',message='Committed drawing freeze cannot be released';
  end if;
  if p_yjs_state is null or pg_catalog.octet_length(p_yjs_state) not between 1 and 8388608 then
    raise exception using errcode='P3F01',message='Drawing release state is invalid';
  end if;
  v_sha:=pg_catalog.encode(extensions.digest(p_yjs_state,'sha256'),'hex');
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    yjs_state=p_yjs_state,yjs_sha256=v_sha,store_generation=store_generation+1,
    byte_size=pg_catalog.octet_length(p_yjs_state),persisted_at=pg_catalog.now(),
    freeze_state='released',accepted_manifest_sha256=null,
    accepted_operation_count=null,frozen_base_operation_sequence=null,frozen_at=null
  where revision_id=p_revision_id and project_id=p_project_id
    and freeze_state in ('freezing','frozen') and freeze_request_id=p_request_id
    and review_committed_at is null;
  get diagnostics v_changed=row_count;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  if v_changed<>1 then
    raise exception using errcode='P3F02',message='Drawing freeze cannot be released';
  end if;
  return pg_catalog.jsonb_build_object(
    'state','released','requestId',p_request_id,'revisionStatus','draft'
  );
end;
$$;

create function private.lukas_drawing_request_collaborative_review(
  p_revision_id uuid,p_request_id uuid,p_manifest_sha256 text,
  p_manifest_count integer,p_base_operation_sequence bigint,p_manifest jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_state private.lukas_drawing_collaboration_states%rowtype;
  v_result jsonb; v_snapshot public.lukas_drawing_snapshots%rowtype;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
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
    or v_state.frozen_base_operation_sequence is distinct from p_base_operation_sequence then
    raise exception using errcode='P3F01',message='Drawing review requires the matching frozen room';
  end if;
  if v_revision.status in ('review_requested','approved') then
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
      'freezeRequestId',p_request_id
    );
  end if;
  if v_revision.status<>'draft' or pg_catalog.jsonb_typeof(p_manifest)<>'array'
    or pg_catalog.jsonb_array_length(p_manifest)<>p_manifest_count
    or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_manifest) item
      where item-array[
        'clientOperationId','revisionId','actorId','operationType','baseVersions',
        'forward','inverse','historyAction','originalOperationId','sequence','resultVersions'
      ]<>'{}'::jsonb
    ) or (select pg_catalog.count(*) from public.lukas_drawing_operations o
      where o.revision_id=p_revision_id and o.project_id=v_revision.project_id)<>p_manifest_count
    or exists(
      select 1 from public.lukas_drawing_operations o
      where o.revision_id=p_revision_id and o.project_id=v_revision.project_id
        and not exists(
          select 1 from pg_catalog.jsonb_array_elements(p_manifest) item
          where item->>'clientOperationId'=o.client_operation_id::text
            and item->>'revisionId'=o.revision_id::text
            and item->>'actorId'=o.actor_id::text
            and item->>'operationType'=o.operation_type
            and item->'baseVersions'=o.base_versions
            and item->'forward'=o.forward and item->'inverse'=o.inverse
            and item->'historyAction'=coalesce(pg_catalog.to_jsonb(o.history_action),'null'::jsonb)
            and item->'originalOperationId'=coalesce(pg_catalog.to_jsonb(o.original_operation_id),'null'::jsonb)
            and (item->>'sequence')::bigint=o.sequence
            and item->'resultVersions'=o.result_versions
        )
    ) then
    raise exception using errcode='P3F01',message='Drawing accepted manifest does not match Postgres';
  end if;
  v_result:=private.lukas_drawing_request_review(p_revision_id);
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states
  set review_committed_at=pg_catalog.now()
  where revision_id=p_revision_id and project_id=v_revision.project_id
    and freeze_state='frozen' and freeze_request_id=p_request_id;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  return v_result||pg_catalog.jsonb_build_object('freezeRequestId',p_request_id);
end;
$$;

create function public.lukas_drawing_request_collaborative_review(
  p_revision_id uuid,p_request_id uuid,p_manifest_sha256 text,
  p_manifest_count integer,p_base_operation_sequence bigint,p_manifest jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_request_collaborative_review(
    p_revision_id,p_request_id,p_manifest_sha256,p_manifest_count,
    p_base_operation_sequence,p_manifest
  )
$$;

-- Keep the legacy signature for non-collaborative documents, but make an
-- existing collaboration room impossible to review without its freeze proof.
alter function public.lukas_drawing_request_review(uuid)
  rename to lukas_drawing_request_review_pre_p3_freeze;
create function private.lukas_drawing_request_review_legacy_guard(p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and (select auth.uid()) is not null
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
  for update;
  if found and exists(select 1 from private.lukas_drawing_collaboration_states s
    where s.revision_id=p_revision_id) then
    raise exception using errcode='P3F01',message='Collaborative drawing review requires room freeze';
  end if;
  return private.lukas_drawing_request_review(p_revision_id);
end;
$$;
create function public.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_request_review_legacy_guard(p_revision_id)
$$;

revoke all on function private.lukas_drawing_collaboration_freeze_write_guard() from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_read_freeze(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_begin_freeze(uuid,uuid,uuid,bytea,bigint) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_complete_freeze(uuid,uuid,uuid,bytea,jsonb,text,integer,bigint) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_release_freeze(uuid,uuid,uuid,bytea) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,jsonb) from public,anon;
revoke all on function private.lukas_drawing_request_review(uuid) from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,jsonb) from public,anon;
revoke all on function public.lukas_drawing_request_review_pre_p3_freeze(uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_request_review_legacy_guard(uuid) from public,anon;
revoke all on function public.lukas_drawing_request_review(uuid) from public,anon;
grant execute on function private.lukas_drawing_collaboration_read_freeze(uuid,uuid) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_begin_freeze(uuid,uuid,uuid,bytea,bigint) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_complete_freeze(uuid,uuid,uuid,bytea,jsonb,text,integer,bigint) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_release_freeze(uuid,uuid,uuid,bytea) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,jsonb) to authenticated,service_role;
grant execute on function public.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,jsonb) to authenticated,service_role;
grant execute on function private.lukas_drawing_request_review_legacy_guard(uuid) to authenticated,service_role;
grant execute on function public.lukas_drawing_request_review(uuid) to authenticated,service_role;

commit;
