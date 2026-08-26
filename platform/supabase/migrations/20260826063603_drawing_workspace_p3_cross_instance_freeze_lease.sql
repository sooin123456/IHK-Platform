begin;

alter table private.lukas_drawing_collaboration_states
  add column freeze_owner_token uuid,
  add column freeze_owner_request_id uuid,
  add column freeze_owner_lease_expires_at timestamptz,
  add constraint lukas_drawing_collaboration_states_owner_lease_check check (
    (freeze_owner_token is null and freeze_owner_request_id is null
      and freeze_owner_lease_expires_at is null)
    or (freeze_owner_token is not null and freeze_owner_request_id is not null
      and freeze_owner_lease_expires_at is not null)
  );

create table private.lukas_drawing_collaboration_freeze_leases (
  revision_id uuid primary key,
  project_id uuid not null,
  request_id uuid not null,
  owner_token uuid not null,
  subject_revision_version bigint not null check(subject_revision_version>0),
  lease_expires_at timestamptz not null,
  constraint lukas_drawing_collaboration_freeze_leases_revision_fkey
    foreign key (revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete cascade
);
alter table private.lukas_drawing_collaboration_freeze_leases enable row level security;
revoke all on table private.lukas_drawing_collaboration_freeze_leases
  from public,anon,authenticated,service_role,lukas_drawing_collaboration;

create or replace function private.lukas_drawing_collaboration_freeze_write_guard()
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
      or new.review_committed_at is distinct from old.review_committed_at
      or new.freeze_owner_token is distinct from old.freeze_owner_token
      or new.freeze_owner_request_id is distinct from old.freeze_owner_request_id
      or new.freeze_owner_lease_expires_at is distinct from old.freeze_owner_lease_expires_at) then
    raise exception using errcode='P3F02',message='Drawing collaboration freeze is immutable';
  end if;
  return new;
end;
$$;

drop function private.lukas_drawing_collaboration_read_freeze(uuid,uuid);
create function private.lukas_drawing_collaboration_read_freeze(
  p_project_id uuid,p_revision_id uuid
) returns table(
  freeze_state text,freeze_request_id uuid,revision_status text,
  revision_version bigint,accepted_manifest_sha256 text,
  accepted_operation_count integer,frozen_base_operation_sequence bigint,
  frozen_subject_revision_version bigint,frozen_yjs_state_vector text,
  frozen_operation_statuses jsonb,review_committed boolean,
  freeze_owner_token uuid,freeze_owner_request_id uuid,
  freeze_owner_lease_expires_at timestamptz
) language sql stable security definer set search_path='' as $$
  select case when s.freeze_state in ('freezing','frozen') then s.freeze_state
      when l.revision_id is not null then 'freezing'
      else coalesce(s.freeze_state,'active') end,
    case when s.freeze_state in ('freezing','frozen') then s.freeze_request_id
      else l.request_id end,r.status,r.version,
    s.accepted_manifest_sha256,s.accepted_operation_count,
    s.frozen_base_operation_sequence,
    coalesce(s.frozen_subject_revision_version,l.subject_revision_version),
    s.frozen_yjs_state_vector,s.frozen_operation_statuses,
    s.review_committed_at is not null,l.owner_token,
    l.request_id,l.lease_expires_at
  from public.lukas_drawing_revisions r
  left join private.lukas_drawing_collaboration_states s
    on s.revision_id=r.id and s.project_id=r.project_id
  left join private.lukas_drawing_collaboration_freeze_leases l
    on l.revision_id=r.id and l.project_id=r.project_id
  where r.id=p_revision_id and r.project_id=p_project_id
$$;

create function private.lukas_drawing_collaboration_acquire_freeze_lease(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,
  p_owner_token uuid,p_lease_seconds integer,p_yjs_state bytea,
  p_base_operation_sequence bigint
) returns void language plpgsql security definer set search_path='' as $$
declare v_status text; v_version bigint;
  v_state private.lukas_drawing_collaboration_states%rowtype;
  v_lease private.lukas_drawing_collaboration_freeze_leases%rowtype;
  v_sha text; v_max_sequence bigint;
begin
  select r.status,r.version into v_status,v_version from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  if not found or v_status<>'draft' then
    raise exception using errcode='P3F02',message='Drawing revision is permanently frozen';
  end if;
  if p_request_id is null or p_owner_token is null
    or p_lease_seconds not between 5 and 300 then
    raise exception using errcode='P3F01',message='Drawing freeze lease is invalid';
  end if;
  select l.* into v_lease from private.lukas_drawing_collaboration_freeze_leases l
  where l.revision_id=p_revision_id and l.project_id=p_project_id for update;
  if found and v_lease.lease_expires_at>pg_catalog.clock_timestamp()
    and (v_lease.owner_token is distinct from p_owner_token
      or v_lease.request_id is distinct from p_request_id) then
    raise exception using errcode='P3F03',message='Drawing freeze lease is busy';
  end if;
  if found and v_lease.subject_revision_version<>v_version then
    raise exception using errcode='P3F02',message='Drawing freeze lease subject changed';
  end if;
  insert into private.lukas_drawing_collaboration_freeze_leases(
    revision_id,project_id,request_id,owner_token,subject_revision_version,
    lease_expires_at
  ) values(
    p_revision_id,p_project_id,p_request_id,p_owner_token,
    v_version,
    pg_catalog.clock_timestamp()+pg_catalog.make_interval(secs=>p_lease_seconds)
  ) on conflict(revision_id) do update set
    project_id=excluded.project_id,request_id=excluded.request_id,
    owner_token=excluded.owner_token,
    subject_revision_version=excluded.subject_revision_version,
    lease_expires_at=excluded.lease_expires_at;
  select s.* into v_state from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  if found and v_state.freeze_state in ('freezing','frozen')
    and v_state.freeze_request_id is distinct from p_request_id then
    raise exception using errcode='P3F03',message='Drawing freeze recovery request does not match';
  end if;
  if p_yjs_state is null and p_base_operation_sequence is null then return; end if;
  if not found then
    if p_yjs_state is null
      or pg_catalog.octet_length(p_yjs_state) not between 1 and 8388608
      or p_base_operation_sequence is null or p_base_operation_sequence<0 then
      raise exception using errcode='P3F01',message='Drawing freeze lease state is invalid';
    end if;
    select coalesce(pg_catalog.max(o.sequence),0::bigint) into v_max_sequence
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.project_id=p_project_id;
    if p_base_operation_sequence>v_max_sequence then
      raise exception using errcode='P3F01',message='Drawing freeze lease sequence is invalid';
    end if;
    v_sha:=pg_catalog.encode(extensions.digest(p_yjs_state,'sha256'),'hex');
    insert into private.lukas_drawing_collaboration_states(
      revision_id,project_id,schema_version,yjs_state,yjs_sha256,
      base_operation_sequence,store_generation,byte_size,persisted_at,
      freeze_owner_token,freeze_owner_request_id,freeze_owner_lease_expires_at
    ) values(
      p_revision_id,p_project_id,1,p_yjs_state,v_sha,p_base_operation_sequence,
      1,pg_catalog.octet_length(p_yjs_state),pg_catalog.clock_timestamp(),
      p_owner_token,p_request_id,pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs=>p_lease_seconds)
    );
    return;
  end if;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    freeze_owner_token=p_owner_token,freeze_owner_request_id=p_request_id,
    freeze_owner_lease_expires_at=pg_catalog.clock_timestamp()
      + pg_catalog.make_interval(secs=>p_lease_seconds)
  where revision_id=p_revision_id and project_id=p_project_id;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
end;
$$;

create function private.lukas_drawing_collaboration_renew_freeze_lease(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,
  p_owner_token uuid,p_lease_seconds integer
) returns void language plpgsql security definer set search_path='' as $$
declare v_status text; v_changed bigint;
begin
  select r.status into v_status from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  if not found or v_status<>'draft' or p_lease_seconds not between 5 and 300 then
    raise exception using errcode='P3F02',message='Drawing freeze lease cannot be renewed';
  end if;
  perform 1 from private.lukas_drawing_collaboration_freeze_leases l
  where l.revision_id=p_revision_id and l.project_id=p_project_id for update;
  update private.lukas_drawing_collaboration_freeze_leases set
    lease_expires_at=pg_catalog.clock_timestamp()
      + pg_catalog.make_interval(secs=>p_lease_seconds)
  where revision_id=p_revision_id and project_id=p_project_id
    and owner_token=p_owner_token and request_id=p_request_id
    and lease_expires_at>pg_catalog.clock_timestamp();
  get diagnostics v_changed=row_count;
  if v_changed<>1 then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  perform 1 from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    freeze_owner_lease_expires_at=pg_catalog.clock_timestamp()
      + pg_catalog.make_interval(secs=>p_lease_seconds)
  where revision_id=p_revision_id and project_id=p_project_id
    and freeze_owner_token=p_owner_token
    and freeze_owner_request_id=p_request_id
    and freeze_owner_lease_expires_at>pg_catalog.clock_timestamp();
  get diagnostics v_changed=row_count;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  if v_changed<>1 and exists(select 1 from private.lukas_drawing_collaboration_states s
    where s.revision_id=p_revision_id and s.project_id=p_project_id
      and s.freeze_owner_token is not null) then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
end;
$$;

create function private.lukas_drawing_collaboration_release_freeze_lease(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,p_owner_token uuid
) returns void language plpgsql security definer set search_path='' as $$
declare v_changed bigint;
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  if not found then
    raise exception using errcode='P3F02',message='Drawing freeze lease cannot be released';
  end if;
  perform 1 from private.lukas_drawing_collaboration_freeze_leases l
  where l.revision_id=p_revision_id and l.project_id=p_project_id for update;
  delete from private.lukas_drawing_collaboration_freeze_leases
  where revision_id=p_revision_id and project_id=p_project_id
    and owner_token=p_owner_token and request_id=p_request_id
    and lease_expires_at>pg_catalog.clock_timestamp();
  get diagnostics v_changed=row_count;
  if v_changed<>1 then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  perform 1 from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    freeze_owner_token=null,freeze_owner_request_id=null,
    freeze_owner_lease_expires_at=null
  where revision_id=p_revision_id and project_id=p_project_id
    and freeze_owner_token=p_owner_token
    and freeze_owner_request_id=p_request_id
    and freeze_owner_lease_expires_at>pg_catalog.clock_timestamp();
  get diagnostics v_changed=row_count;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  if v_changed<>1 and exists(select 1 from private.lukas_drawing_collaboration_states s
    where s.revision_id=p_revision_id and s.project_id=p_project_id
      and s.freeze_owner_token is not null) then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
end;
$$;

create function private.lukas_drawing_collaboration_begin_freeze(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,
  p_yjs_state bytea,p_base_operation_sequence bigint,p_owner_token uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_state private.lukas_drawing_collaboration_states%rowtype;
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  perform 1 from private.lukas_drawing_collaboration_freeze_leases l
  where l.revision_id=p_revision_id and l.project_id=p_project_id
    and l.owner_token=p_owner_token and l.request_id=p_request_id
    and l.lease_expires_at>pg_catalog.clock_timestamp() for update;
  if not found then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  select s.* into v_state from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  if not found or v_state.freeze_owner_token is distinct from p_owner_token
    or v_state.freeze_owner_request_id is distinct from p_request_id
    or v_state.freeze_owner_lease_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  return private.lukas_drawing_collaboration_begin_freeze(
    p_project_id,p_revision_id,p_request_id,p_yjs_state,p_base_operation_sequence
  );
end;
$$;

create function private.lukas_drawing_collaboration_complete_freeze(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,p_yjs_state bytea,
  p_manifest jsonb,p_manifest_sha256 text,p_manifest_count integer,
  p_base_operation_sequence bigint,p_state_vector_base64 text,
  p_operation_statuses jsonb,p_owner_token uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_state private.lukas_drawing_collaboration_states%rowtype;
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  perform 1 from private.lukas_drawing_collaboration_freeze_leases l
  where l.revision_id=p_revision_id and l.project_id=p_project_id
    and l.owner_token=p_owner_token and l.request_id=p_request_id
    and l.lease_expires_at>pg_catalog.clock_timestamp() for update;
  if not found then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  select s.* into v_state from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  if not found or v_state.freeze_owner_token is distinct from p_owner_token
    or v_state.freeze_owner_request_id is distinct from p_request_id
    or v_state.freeze_owner_lease_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  return private.lukas_drawing_collaboration_complete_freeze(
    p_project_id,p_revision_id,p_request_id,p_yjs_state,p_manifest,
    p_manifest_sha256,p_manifest_count,p_base_operation_sequence,
    p_state_vector_base64,p_operation_statuses
  );
end;
$$;

create function private.lukas_drawing_collaboration_release_freeze(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,
  p_yjs_state bytea,p_owner_token uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_state private.lukas_drawing_collaboration_states%rowtype; v_result jsonb;
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  perform 1 from private.lukas_drawing_collaboration_freeze_leases l
  where l.revision_id=p_revision_id and l.project_id=p_project_id
    and l.owner_token=p_owner_token and l.request_id=p_request_id
    and l.lease_expires_at>pg_catalog.clock_timestamp() for update;
  if not found then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  select s.* into v_state from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  if not found or v_state.freeze_owner_token is distinct from p_owner_token
    or v_state.freeze_owner_request_id is distinct from p_request_id
    or v_state.freeze_owner_lease_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  v_result:=private.lukas_drawing_collaboration_release_freeze(
    p_project_id,p_revision_id,p_request_id,p_yjs_state
  );
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    freeze_owner_token=null,freeze_owner_request_id=null,
    freeze_owner_lease_expires_at=null
  where revision_id=p_revision_id and project_id=p_project_id;
  delete from private.lukas_drawing_collaboration_freeze_leases
  where revision_id=p_revision_id and project_id=p_project_id
    and owner_token=p_owner_token and request_id=p_request_id;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  return v_result;
end;
$$;

create function private.lukas_drawing_collaboration_sync_released_state(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,
  p_yjs_state bytea,p_owner_token uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_state private.lukas_drawing_collaboration_states%rowtype; v_result jsonb;
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  perform 1 from private.lukas_drawing_collaboration_freeze_leases l
  where l.revision_id=p_revision_id and l.project_id=p_project_id
    and l.owner_token=p_owner_token and l.request_id=p_request_id
    and l.lease_expires_at>pg_catalog.clock_timestamp() for update;
  if not found then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  select s.* into v_state from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  if not found or v_state.freeze_owner_token is distinct from p_owner_token
    or v_state.freeze_owner_request_id is distinct from p_request_id
    or v_state.freeze_owner_lease_expires_at<=pg_catalog.clock_timestamp() then
    raise exception using errcode='P3F03',message='Drawing freeze lease is not owned';
  end if;
  v_result:=private.lukas_drawing_collaboration_sync_released_state(
    p_project_id,p_revision_id,p_request_id,p_yjs_state
  );
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    freeze_owner_token=null,freeze_owner_request_id=null,
    freeze_owner_lease_expires_at=null
  where revision_id=p_revision_id and project_id=p_project_id;
  delete from private.lukas_drawing_collaboration_freeze_leases
  where revision_id=p_revision_id and project_id=p_project_id
    and owner_token=p_owner_token and request_id=p_request_id;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  return v_result;
end;
$$;

-- Rejection is the authoritative business release and invalidates any service owner.
create or replace function private.lukas_drawing_revision_rejection_release_freeze()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_changed bigint;
begin
  if new.decision<>'rejected' then return new; end if;
  if not exists(select 1 from private.lukas_drawing_collaboration_states s
    where s.revision_id=new.revision_id and s.project_id=new.project_id) then
    return new;
  end if;
  delete from private.lukas_drawing_collaboration_freeze_leases
  where revision_id=new.revision_id and project_id=new.project_id;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    freeze_state='released',accepted_manifest_sha256=null,
    accepted_operation_count=null,frozen_base_operation_sequence=null,
    frozen_at=null,review_committed_at=null,
    frozen_subject_revision_version=null,frozen_yjs_state_vector=null,
    frozen_operation_statuses=null,freeze_owner_token=null,
    freeze_owner_request_id=null,freeze_owner_lease_expires_at=null
  where revision_id=new.revision_id and project_id=new.project_id
    and freeze_state='frozen' and review_committed_at is not null
    and frozen_subject_revision_version=new.subject_version;
  get diagnostics v_changed=row_count;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  if v_changed<>1 then
    raise exception using errcode='P3F02',message='Drawing rejection lost its frozen subject';
  end if;
  return new;
end;
$$;

revoke all on function private.lukas_drawing_collaboration_read_freeze(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_acquire_freeze_lease(uuid,uuid,uuid,uuid,integer,bytea,bigint) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_renew_freeze_lease(uuid,uuid,uuid,uuid,integer) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_release_freeze_lease(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_begin_freeze(uuid,uuid,uuid,bytea,bigint,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_complete_freeze(uuid,uuid,uuid,bytea,jsonb,text,integer,bigint,text,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_release_freeze(uuid,uuid,uuid,bytea,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_sync_released_state(uuid,uuid,uuid,bytea,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_begin_freeze(uuid,uuid,uuid,bytea,bigint) from lukas_drawing_collaboration;
revoke all on function private.lukas_drawing_collaboration_complete_freeze(uuid,uuid,uuid,bytea,jsonb,text,integer,bigint,text,jsonb) from lukas_drawing_collaboration;
revoke all on function private.lukas_drawing_collaboration_release_freeze(uuid,uuid,uuid,bytea) from lukas_drawing_collaboration;
revoke all on function private.lukas_drawing_collaboration_sync_released_state(uuid,uuid,uuid,bytea) from lukas_drawing_collaboration;

grant execute on function private.lukas_drawing_collaboration_read_freeze(uuid,uuid) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_acquire_freeze_lease(uuid,uuid,uuid,uuid,integer,bytea,bigint) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_renew_freeze_lease(uuid,uuid,uuid,uuid,integer) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_release_freeze_lease(uuid,uuid,uuid,uuid) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_begin_freeze(uuid,uuid,uuid,bytea,bigint,uuid) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_complete_freeze(uuid,uuid,uuid,bytea,jsonb,text,integer,bigint,text,jsonb,uuid) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_release_freeze(uuid,uuid,uuid,bytea,uuid) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_sync_released_state(uuid,uuid,uuid,bytea,uuid) to lukas_drawing_collaboration;

commit;
