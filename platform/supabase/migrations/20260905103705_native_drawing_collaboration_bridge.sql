begin;

-- A live room can predate an import. Only committed native block receipts may
-- introduce server-authored envelopes; ordinary missing client operations must
-- still fail the unchanged collaborative review manifest check.
create function private.lukas_drawing_collaboration_native_operations(
  p_project_id uuid,p_revision_id uuid,p_after_sequence bigint
) returns table(operation jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if p_after_sequence is null or p_after_sequence<0 or not exists(
    select 1 from public.lukas_drawing_revisions r
    where r.id=p_revision_id and r.project_id=p_project_id and r.status='draft'
  ) then raise exception using errcode='P3A02',message='Native collaboration scope is unavailable'; end if;
  if private.lukas_qto_project_feature_active(p_project_id,'drawing_workspace') is not true
    or private.lukas_qto_project_feature_active(p_project_id,'realtime_collaboration') is not true
  then raise exception using errcode='P7A07',message='Native collaboration entitlement is unavailable'; end if;
  return query
  select pg_catalog.jsonb_build_object(
    'revisionId',o.revision_id,'clientOperationId',o.client_operation_id,
    'actorId',o.actor_id,'operationType',o.operation_type,'baseVersions',o.base_versions,
    'forward',o.forward,'inverse',o.inverse,'historyAction',o.history_action,
    'originalOperationId',o.original_operation_id,'sequence',o.sequence,'resultVersions',o.result_versions
  )
  from public.lukas_drawing_operations o
  where o.project_id=p_project_id and o.revision_id=p_revision_id and o.sequence>p_after_sequence
    and o.operation_type='mutate_structure' and o.history_action is null
    and o.original_operation_id is null and o.base_versions='{}'::jsonb
    and pg_catalog.jsonb_array_length(o.forward->'actions')=1
    and o.forward#>>'{actions,0,kind}'='put_block'
    and o.forward#>'{actions,0,baseVersion}'='null'::jsonb
    and exists(
      select 1 from public.lukas_drawing_library_imports i
      join public.lukas_drawing_library_versions v on v.id=i.version_id
        and v.organization_id=i.organization_id and v.registry_id=i.registry_id
      where i.project_id=p_project_id and i.revision_id=p_revision_id
        and i.target_revision_id=p_revision_id and i.imported_by=o.actor_id
        and i.target_entity_id::text=o.forward#>>'{actions,0,entity,id}'
        and v.source_kind='platform_native' and i.source_content_sha256=v.content_sha256
        -- Restores reuse the entity ID but advance its version (3, 5, ...).
        -- Only the original import created version 1 with this exact inverse.
        and o.result_versions=pg_catalog.jsonb_build_object(coalesce(i.target_entity_id::text,''),1)
        and o.inverse=pg_catalog.jsonb_build_object('type','mutate_structure','actions',
          pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'kind','delete_block','id',i.target_entity_id,'baseVersion',1)))
    )
  order by o.sequence limit 256;
end;
$$;
revoke all on function private.lukas_drawing_collaboration_native_operations(uuid,uuid,bigint)
  from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_collaboration_native_operations(uuid,uuid,bigint)
  to lukas_drawing_collaboration;

commit;
