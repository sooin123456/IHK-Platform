begin;

-- A collaboration checkpoint's canonical SHA covers every accepted operation
-- through base_operation_sequence. The live freeze manifest therefore needs to
-- prove every operation after that boundary, while any included older entry
-- must still match its immutable Postgres row exactly.
create or replace function private.lukas_drawing_request_collaborative_review(
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
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_manifest) item
      group by item->>'clientOperationId' having pg_catalog.count(*)>1
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_manifest) item
      group by item->>'sequence' having pg_catalog.count(*)>1
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_manifest) item
      where not exists(
        select 1 from public.lukas_drawing_operations o
        where o.revision_id=p_revision_id and o.project_id=v_revision.project_id
          and item->>'clientOperationId'=o.client_operation_id::text
          and item->>'revisionId'=o.revision_id::text
          and item->>'actorId'=o.actor_id::text
          and item->>'operationType'=o.operation_type
          and item->'baseVersions'=o.base_versions
          and item->'forward'=o.forward and item->'inverse'=o.inverse
          and item->'historyAction'=coalesce(pg_catalog.to_jsonb(o.history_action),'null'::jsonb)
          and item->'originalOperationId'=coalesce(pg_catalog.to_jsonb(o.original_operation_id),'null'::jsonb)
          and item->>'sequence'=o.sequence::text
          and item->'resultVersions'=o.result_versions
      )
    ) or exists(
      select 1 from public.lukas_drawing_operations o
      where o.revision_id=p_revision_id and o.project_id=v_revision.project_id
        and o.sequence>p_base_operation_sequence
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
            and item->>'sequence'=o.sequence::text
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

revoke all on function private.lukas_drawing_request_collaborative_review(
  uuid,uuid,text,integer,bigint,jsonb
) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_request_collaborative_review(
  uuid,uuid,text,integer,bigint,jsonb
) to authenticated,service_role;

commit;
