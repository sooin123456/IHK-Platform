begin;

alter table private.lukas_drawing_collaboration_states
  add column frozen_subject_revision_version bigint,
  add column frozen_yjs_state_vector text,
  add column frozen_operation_statuses jsonb;

-- Preserve permanent committed freezes and make pre-upgrade interrupted freezes
-- version-bound. A review that was already rejected is released immediately;
-- its Yjs bytes are reconciled by the service before the room is served.
update private.lukas_drawing_collaboration_states s
set frozen_subject_revision_version=r.version
from public.lukas_drawing_revisions r
where r.id=s.revision_id and r.project_id=s.project_id
  and s.freeze_state in ('freezing','frozen');

select pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
update private.lukas_drawing_collaboration_states s
set freeze_state='released',accepted_manifest_sha256=null,
  accepted_operation_count=null,frozen_base_operation_sequence=null,
  frozen_at=null,review_committed_at=null,
  frozen_subject_revision_version=null,frozen_yjs_state_vector=null,
  frozen_operation_statuses=null
from public.lukas_drawing_revisions r
where r.id=s.revision_id and r.project_id=s.project_id
  and s.freeze_state='frozen' and s.review_committed_at is not null
  and r.status='draft';
select pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);

alter table private.lukas_drawing_collaboration_states
  drop constraint lukas_drawing_collaboration_states_freeze_check;
alter table private.lukas_drawing_collaboration_states
  add constraint lukas_drawing_collaboration_states_freeze_check check (
    (freeze_state='active' and freeze_request_id is null
      and accepted_manifest_sha256 is null and accepted_operation_count is null
      and frozen_base_operation_sequence is null and frozen_at is null
      and review_committed_at is null and frozen_subject_revision_version is null
      and frozen_yjs_state_vector is null and frozen_operation_statuses is null)
    or (freeze_state='freezing' and freeze_request_id is not null
      and accepted_manifest_sha256 is null and accepted_operation_count is null
      and frozen_base_operation_sequence is null and frozen_at is null
      and review_committed_at is null and frozen_subject_revision_version>0
      and frozen_yjs_state_vector is null and frozen_operation_statuses is null)
    or (freeze_state='frozen' and freeze_request_id is not null
      and accepted_manifest_sha256 ~ '^[0-9a-f]{64}$'
      and accepted_operation_count between 0 and 10000
      and frozen_base_operation_sequence>=0 and frozen_at is not null
      and frozen_subject_revision_version>0
      and (frozen_yjs_state_vector is null or
        (pg_catalog.char_length(frozen_yjs_state_vector) between 1 and 87384
          and pg_catalog.char_length(frozen_yjs_state_vector)%4=0
          and frozen_yjs_state_vector ~ '^[A-Za-z0-9+/]+={0,2}$'))
      and (frozen_operation_statuses is null or
        (pg_catalog.jsonb_typeof(frozen_operation_statuses)='array'
          and pg_catalog.jsonb_array_length(frozen_operation_statuses)<=10000)))
    or (freeze_state='released' and freeze_request_id is not null
      and accepted_manifest_sha256 is null and accepted_operation_count is null
      and frozen_base_operation_sequence is null and frozen_at is null
      and review_committed_at is null and frozen_subject_revision_version is null
      and frozen_yjs_state_vector is null and frozen_operation_statuses is null)
  );

create function private.lukas_drawing_collaboration_freeze_subject_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_version bigint;
begin
  if new.freeze_state='freezing'
    and (tg_op='INSERT' or old.freeze_state in ('active','released')) then
    select r.version into v_version from public.lukas_drawing_revisions r
    where r.id=new.revision_id and r.project_id=new.project_id;
    if v_version is null then
      raise exception using errcode='P3F01',message='Drawing freeze revision is unavailable';
    end if;
    new.frozen_subject_revision_version:=v_version;
    new.frozen_yjs_state_vector:=null;
    new.frozen_operation_statuses:=null;
  elsif new.freeze_state in ('active','released') then
    new.frozen_subject_revision_version:=null;
    new.frozen_yjs_state_vector:=null;
    new.frozen_operation_statuses:=null;
  end if;
  return new;
end;
$$;
create trigger a_lukas_drawing_collaboration_freeze_subject_guard
before insert or update on private.lukas_drawing_collaboration_states
for each row execute function private.lukas_drawing_collaboration_freeze_subject_guard();

drop function private.lukas_drawing_collaboration_read_freeze(uuid,uuid);
create function private.lukas_drawing_collaboration_read_freeze(
  p_project_id uuid,p_revision_id uuid
) returns table(
  freeze_state text,freeze_request_id uuid,revision_status text,
  revision_version bigint,accepted_manifest_sha256 text,
  accepted_operation_count integer,frozen_base_operation_sequence bigint,
  frozen_subject_revision_version bigint,frozen_yjs_state_vector text,
  frozen_operation_statuses jsonb,review_committed boolean
) language sql stable security definer set search_path='' as $$
  select s.freeze_state,s.freeze_request_id,r.status,r.version,
    s.accepted_manifest_sha256,s.accepted_operation_count,
    s.frozen_base_operation_sequence,s.frozen_subject_revision_version,
    s.frozen_yjs_state_vector,s.frozen_operation_statuses,
    s.review_committed_at is not null
  from private.lukas_drawing_collaboration_states s
  join public.lukas_drawing_revisions r
    on r.id=s.revision_id and r.project_id=s.project_id
  where s.revision_id=p_revision_id and s.project_id=p_project_id
$$;

create function private.lukas_drawing_collaboration_complete_freeze(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,p_yjs_state bytea,
  p_manifest jsonb,p_manifest_sha256 text,p_manifest_count integer,
  p_base_operation_sequence bigint,p_state_vector_base64 text,
  p_operation_statuses jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_revision public.lukas_drawing_revisions%rowtype;
  v_state private.lukas_drawing_collaboration_states%rowtype; v_result jsonb;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id for update;
  if not found or v_revision.status<>'draft' then
    raise exception using errcode='P3F02',message='Drawing revision is permanently frozen';
  end if;
  select s.* into strict v_state from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id for update;
  if v_state.freeze_request_id is distinct from p_request_id
    or v_state.frozen_subject_revision_version is distinct from v_revision.version then
    raise exception using errcode='P3F01',message='Drawing freeze subject version changed';
  end if;
  if p_state_vector_base64 is null
    or pg_catalog.char_length(p_state_vector_base64) not between 1 and 87384
    or pg_catalog.char_length(p_state_vector_base64)%4<>0
    or p_state_vector_base64 !~ '^[A-Za-z0-9+/]+={0,2}$'
    or pg_catalog.jsonb_typeof(p_operation_statuses)<>'array'
    or pg_catalog.jsonb_array_length(p_operation_statuses)>10000
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_operation_statuses) item
      where item-array['clientOperationId','status','authoritativeSequence','resultVersions']<>'{}'::jsonb
        or item->>'status' not in ('acked','rejected'))
    or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_operation_statuses) item
      where item->>'status'='acked')<>p_manifest_count then
    raise exception using errcode='P3F01',message='Drawing freeze boundary evidence is invalid';
  end if;
  if exists(
      select 1 from pg_catalog.jsonb_array_elements(p_operation_statuses) item
      group by item->>'clientOperationId' having pg_catalog.count(*)>1
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_manifest) operation
      where not exists(
        select 1 from pg_catalog.jsonb_array_elements(p_operation_statuses) status
        where status->>'status'='acked'
          and status->>'clientOperationId'=operation->>'clientOperationId'
          and (status->>'authoritativeSequence')::bigint=(operation->>'sequence')::bigint
          and status->'resultVersions'=operation->'resultVersions'
      )
    ) then
    raise exception using errcode='P3F01',message='Drawing freeze operation evidence does not match manifest';
  end if;
  v_result:=private.lukas_drawing_collaboration_complete_freeze(
    p_project_id,p_revision_id,p_request_id,p_yjs_state,p_manifest,
    p_manifest_sha256,p_manifest_count,p_base_operation_sequence
  );
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    frozen_yjs_state_vector=p_state_vector_base64,
    frozen_operation_statuses=p_operation_statuses
  where revision_id=p_revision_id and project_id=p_project_id
    and freeze_state='frozen' and freeze_request_id=p_request_id
    and frozen_subject_revision_version=v_revision.version;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  return v_result||pg_catalog.jsonb_build_object(
    'frozenSubjectRevisionVersion',v_revision.version,
    'stateVectorBase64',p_state_vector_base64,
    'operationStatuses',p_operation_statuses
  );
exception when no_data_found then
  raise exception using errcode='P3F01',message='Drawing freeze state is unavailable';
end;
$$;

create function private.lukas_drawing_request_collaborative_review(
  p_revision_id uuid,p_request_id uuid,p_manifest_sha256 text,
  p_manifest_count integer,p_base_operation_sequence bigint,
  p_subject_revision_version bigint,p_state_vector_base64 text,
  p_operation_statuses jsonb,p_manifest jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_state private.lukas_drawing_collaboration_states%rowtype; v_result jsonb;
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
    or v_state.frozen_subject_revision_version is distinct from p_subject_revision_version
    or v_revision.version is distinct from p_subject_revision_version
    or v_state.frozen_yjs_state_vector is distinct from p_state_vector_base64
    or v_state.frozen_operation_statuses is distinct from p_operation_statuses then
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

create function public.lukas_drawing_request_collaborative_review(
  p_revision_id uuid,p_request_id uuid,p_manifest_sha256 text,
  p_manifest_count integer,p_base_operation_sequence bigint,
  p_subject_revision_version bigint,p_state_vector_base64 text,
  p_operation_statuses jsonb,p_manifest jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_request_collaborative_review(
    p_revision_id,p_request_id,p_manifest_sha256,p_manifest_count,
    p_base_operation_sequence,p_subject_revision_version,
    p_state_vector_base64,p_operation_statuses,p_manifest
  )
$$;

create function private.lukas_drawing_collaboration_sync_released_state(
  p_project_id uuid,p_revision_id uuid,p_request_id uuid,p_yjs_state bytea
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_sha text; v_version bigint; v_changed bigint;
begin
  select r.version into v_version from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id and r.status='draft'
  for update;
  if not found or p_yjs_state is null
    or pg_catalog.octet_length(p_yjs_state) not between 1 and 8388608 then
    raise exception using errcode='P3F02',message='Released drawing state cannot be synchronized';
  end if;
  v_sha:=pg_catalog.encode(extensions.digest(p_yjs_state,'sha256'),'hex');
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    yjs_state=p_yjs_state,yjs_sha256=v_sha,store_generation=store_generation+1,
    byte_size=pg_catalog.octet_length(p_yjs_state),persisted_at=pg_catalog.now()
  where revision_id=p_revision_id and project_id=p_project_id
    and freeze_state='released' and freeze_request_id=p_request_id
    and review_committed_at is null;
  get diagnostics v_changed=row_count;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','',true);
  if v_changed<>1 then
    raise exception using errcode='P3F02',message='Released drawing state changed';
  end if;
  return pg_catalog.jsonb_build_object(
    'state','released','requestId',p_request_id,'revisionStatus','draft',
    'revisionVersion',v_version
  );
end;
$$;

create function private.lukas_drawing_revision_rejection_release_freeze()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_changed bigint;
begin
  if new.decision<>'rejected' then return new; end if;
  if not exists(select 1 from private.lukas_drawing_collaboration_states s
    where s.revision_id=new.revision_id and s.project_id=new.project_id) then
    return new;
  end if;
  perform pg_catalog.set_config('private.lukas_drawing_freeze_write','1',true);
  update private.lukas_drawing_collaboration_states set
    freeze_state='released',accepted_manifest_sha256=null,
    accepted_operation_count=null,frozen_base_operation_sequence=null,
    frozen_at=null,review_committed_at=null,
    frozen_subject_revision_version=null,frozen_yjs_state_vector=null,
    frozen_operation_statuses=null
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
create trigger z_lukas_drawing_revision_rejection_release_freeze
after insert on public.lukas_drawing_revision_approvals
for each row execute function private.lukas_drawing_revision_rejection_release_freeze();

revoke all on function private.lukas_drawing_collaboration_freeze_subject_guard() from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_read_freeze(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_complete_freeze(uuid,uuid,uuid,bytea,jsonb,text,integer,bigint,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,bigint,text,jsonb,jsonb) from public,anon;
revoke all on function public.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,bigint,text,jsonb,jsonb) from public,anon;
revoke all on function private.lukas_drawing_collaboration_sync_released_state(uuid,uuid,uuid,bytea) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_revision_rejection_release_freeze() from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_complete_freeze(uuid,uuid,uuid,bytea,jsonb,text,integer,bigint) from lukas_drawing_collaboration;
revoke all on function private.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,jsonb) from authenticated,service_role;
revoke all on function public.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,jsonb) from authenticated,service_role;
grant execute on function private.lukas_drawing_collaboration_complete_freeze(uuid,uuid,uuid,bytea,jsonb,text,integer,bigint,text,jsonb) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_read_freeze(uuid,uuid) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,bigint,text,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.lukas_drawing_request_collaborative_review(uuid,uuid,text,integer,bigint,bigint,text,jsonb,jsonb) to authenticated,service_role;
grant execute on function private.lukas_drawing_collaboration_sync_released_state(uuid,uuid,uuid,bytea) to lukas_drawing_collaboration;

commit;
