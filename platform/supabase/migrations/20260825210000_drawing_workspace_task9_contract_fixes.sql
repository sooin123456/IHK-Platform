begin;

alter table public.lukas_drawing_operations
  drop constraint if exists lukas_drawing_operations_operation_type_check;
alter table public.lukas_drawing_operations
  add constraint lukas_drawing_operations_operation_type_check check (operation_type in (
    'add_objects','update_objects','delete_objects','add_layer','update_layer',
    'mutate_structure','mutate_objects_with_references'
  ));

alter function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) rename to lukas_drawing_apply_operation_pre_task9_contract_fixes;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_object jsonb; v_inverse_object jsonb; v_action jsonb; v_inverse_action jsonb;
  v_entity jsonb; v_previous jsonb; v_tombstone jsonb; v_rows jsonb;
  v_expected_actions jsonb:='[]'::jsonb;
  v_expected_inverse_actions jsonb:='[]'::jsonb;
  v_expected_inverse_objects jsonb:='[]'::jsonb;
  v_expected_bases jsonb:='{}'::jsonb;
  v_result_versions jsonb:='{}'::jsonb;
  v_id uuid; v_base bigint; v_new_version bigint; v_count integer;
  v_ordinal bigint; v_operation_id uuid; v_sequence bigint;
begin
  if p_operation_type<>'mutate_objects_with_references' then
    return private.lukas_drawing_apply_operation_pre_task9_contract_fixes(
      p_revision_id,p_client_operation_id,p_operation_type,
      p_base_versions,p_forward,p_inverse
    );
  end if;

  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing revision target is unavailable';
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
      or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions
      or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse then
      raise exception using errcode='P1C01',
        message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions
    );
  end if;
  if v_revision.status<>'draft' then
    raise exception using errcode='P1C01',
      message='Drawing operation requires a draft revision';
  end if;
  if p_client_operation_id is null
    or pg_catalog.jsonb_typeof(p_base_versions)<>'object'
    or pg_catalog.jsonb_typeof(p_forward)<>'object'
    or not (p_forward ?& array['type','objectAction','objects','actions'])
    or p_forward-array['type','objectAction','objects','actions']<>'{}'::jsonb
    or p_forward->>'type'<>'mutate_objects_with_references'
    or p_forward->>'objectAction' not in ('delete','restore')
    or pg_catalog.jsonb_typeof(p_forward->'objects')<>'array'
    or pg_catalog.jsonb_array_length(p_forward->'objects')=0
    or pg_catalog.jsonb_typeof(p_forward->'actions')<>'array'
    or pg_catalog.jsonb_typeof(p_inverse)<>'object'
    or not (p_inverse ?& array['type','objectAction','objects','actions'])
    or p_inverse-array['type','objectAction','objects','actions']<>'{}'::jsonb
    or p_inverse->>'type'<>'mutate_objects_with_references'
    or p_inverse->>'objectAction'=p_forward->>'objectAction'
    or p_inverse->>'objectAction' not in ('delete','restore')
    or pg_catalog.jsonb_typeof(p_inverse->'objects')<>'array'
    or pg_catalog.jsonb_array_length(p_inverse->'objects')
      <>pg_catalog.jsonb_array_length(p_forward->'objects')
    or pg_catalog.jsonb_typeof(p_inverse->'actions')<>'array'
    or pg_catalog.jsonb_array_length(p_inverse->'actions')
      <>pg_catalog.jsonb_array_length(p_forward->'actions')
    or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects')
        with ordinality item(value,ordinality)
      where private.lukas_drawing_structure_action_valid(
        pg_catalog.jsonb_build_object(
          'kind','put_object','entity',item.value,'baseVersion',null
        ),p_revision_id
      ) is not true
        or (item.ordinality>1 and item.value->>'id' <=
          p_forward->'objects'->(item.ordinality::integer-2)->>'id')
    ) then
    raise exception using errcode='P1C01',
      message='Reference-aware object mutation payload is invalid';
  end if;

  if p_forward->>'objectAction'='delete' then
    -- The object snapshots and editable layers are locked before the exact
    -- cleanup set is derived, so no reference can be persisted halfway.
    for v_object in
      select value from pg_catalog.jsonb_array_elements(p_forward->'objects')
    loop
      v_id:=(v_object->>'id')::uuid;
      v_previous:=private.lukas_drawing_structure_entity_json(
        'object',v_id,p_revision_id,v_revision.project_id
      );
      if v_previous is null or v_previous is distinct from v_object
        or not exists(
          select 1 from public.lukas_drawing_objects o
          join public.lukas_drawing_layers l on l.id=o.layer_id
            and l.revision_id=o.revision_id and l.project_id=o.project_id
          where o.id=v_id and o.revision_id=p_revision_id
            and o.project_id=v_revision.project_id and o.status='active'
            and l.visible and not l.locked and l.system_kind<>'source'
          for update of o,l
        ) then
        raise exception using errcode='P1C01',
          message='Reference-aware object deletion snapshot is stale';
      end if;
      v_base:=(v_object->>'version')::bigint;
      v_expected_bases:=v_expected_bases||
        pg_catalog.jsonb_build_object(v_id::text,v_base);
      v_result_versions:=v_result_versions||
        pg_catalog.jsonb_build_object(v_id::text,null);
      v_expected_inverse_objects:=v_expected_inverse_objects||
        pg_catalog.jsonb_build_array(pg_catalog.jsonb_set(
          v_object,'{version}',pg_catalog.to_jsonb(v_base+2)
        ));
    end loop;

    for v_entity in
      select private.lukas_drawing_structure_entity_json(
        'property_value',v.id,p_revision_id,v_revision.project_id
      )
      from public.lukas_drawing_property_values v
      where v.revision_id=p_revision_id and v.project_id=v_revision.project_id
        and exists(
          select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') o
          where o->>'id'=coalesce(v.object_id,v.block_instance_id)::text
        )
      order by v.id
    loop
      v_id:=(v_entity->>'id')::uuid;
      v_base:=(v_entity->>'version')::bigint;
      v_expected_actions:=v_expected_actions||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind','delete_property_value','id',v_id,'baseVersion',v_base
        )
      );
      v_expected_inverse_actions:=pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind','put_property_value','entity',v_entity,'baseVersion',null
        )
      )||v_expected_inverse_actions;
      v_expected_bases:=v_expected_bases||
        pg_catalog.jsonb_build_object(v_id::text,v_base);
      v_result_versions:=v_result_versions||
        pg_catalog.jsonb_build_object(v_id::text,null);
    end loop;

    for v_entity in
      select private.lukas_drawing_structure_entity_json(
        'table',t.id,p_revision_id,v_revision.project_id
      )
      from public.lukas_drawing_tables t
      where t.revision_id=p_revision_id and t.project_id=v_revision.project_id
        and exists(
          select 1 from pg_catalog.jsonb_array_elements(t.rows_json) r
          join pg_catalog.jsonb_array_elements(p_forward->'objects') o
            on o->>'id'=coalesce(r->>'objectId',r->>'blockInstanceId')
        )
      order by t.id
    loop
      v_id:=(v_entity->>'id')::uuid;
      v_base:=(v_entity->>'version')::bigint;
      select coalesce(pg_catalog.jsonb_agg(r.value order by r.ordinality),'[]'::jsonb)
        into v_rows
      from pg_catalog.jsonb_array_elements(v_entity->'rows')
        with ordinality r(value,ordinality)
      where not exists(
        select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') o
        where o->>'id'=coalesce(r.value->>'objectId',r.value->>'blockInstanceId')
      );
      v_expected_actions:=v_expected_actions||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind','put_table',
          'entity',pg_catalog.jsonb_set(v_entity,'{rows}',v_rows),
          'baseVersion',v_base
        )
      );
      v_expected_inverse_actions:=pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind','put_table','entity',v_entity,'baseVersion',v_base+1
        )
      )||v_expected_inverse_actions;
      v_expected_bases:=v_expected_bases||
        pg_catalog.jsonb_build_object(v_id::text,v_base);
      v_result_versions:=v_result_versions||
        pg_catalog.jsonb_build_object(v_id::text,v_base+1);
    end loop;

    if p_forward->'actions' is distinct from v_expected_actions
      or p_inverse is distinct from pg_catalog.jsonb_build_object(
        'type','mutate_objects_with_references','objectAction','restore',
        'objects',v_expected_inverse_objects,
        'actions',v_expected_inverse_actions
      ) or p_base_versions is distinct from v_expected_bases then
      raise exception using errcode='P1C01',
        message='Reference-aware object cleanup is not exact';
    end if;

    for v_action in
      select value from pg_catalog.jsonb_array_elements(v_expected_actions)
    loop
      v_id:=coalesce((v_action->>'id')::uuid,
        (v_action->'entity'->>'id')::uuid);
      if v_action->>'kind'='delete_property_value' then
        delete from public.lukas_drawing_property_values where id=v_id;
      else
        update public.lukas_drawing_tables
        set rows_json=v_action->'entity'->'rows',version=version+1
        where id=v_id;
      end if;
    end loop;
    for v_object in
      select value from pg_catalog.jsonb_array_elements(p_forward->'objects')
    loop
      update public.lukas_drawing_objects
      set status='deleted',version=version+1,updated_by=v_actor
      where id=(v_object->>'id')::uuid;
    end loop;
  else
    -- Restore validates the tombstones and every reverse reference action
    -- before reactivating the objects. Only rows for these objects may appear.
    for v_object in
      select value from pg_catalog.jsonb_array_elements(p_forward->'objects')
    loop
      v_id:=(v_object->>'id')::uuid;
      select pg_catalog.jsonb_build_object(
        'id',o.id,'name',o.name,'layerId',o.layer_id,'geometry',o.geometry,
        'styleId',o.style_id,'style',o.style,'version',o.version
      ) into v_previous
      from public.lukas_drawing_objects o
      join public.lukas_drawing_layers l on l.id=o.layer_id
        and l.revision_id=o.revision_id and l.project_id=o.project_id
      where o.id=v_id and o.revision_id=p_revision_id
        and o.project_id=v_revision.project_id and o.status='deleted'
        and o.page_id=l.page_id
        and l.visible and not l.locked and l.system_kind<>'source'
      for update of o,l;
      if v_previous is null
        or (
          pg_catalog.jsonb_set(
            v_object,'{styleId}',
            coalesce(v_object->'styleId','null'::jsonb),true
          )-'version'
        ) is distinct from v_previous-'version'
        or (v_object->>'version')::bigint<>(v_previous->>'version')::bigint+1 then
        raise exception using errcode='P1C01',
          message='Reference-aware object restore tombstone is stale';
      end if;
      v_base:=(v_previous->>'version')::bigint;
      v_expected_bases:=v_expected_bases||
        pg_catalog.jsonb_build_object(v_id::text,v_base);
      v_result_versions:=v_result_versions||
        pg_catalog.jsonb_build_object(v_id::text,v_base+1);
      v_expected_inverse_objects:=v_expected_inverse_objects||
        pg_catalog.jsonb_build_array(v_object);
    end loop;

    v_count:=pg_catalog.jsonb_array_length(p_forward->'actions');
    for v_action,v_ordinal in
      select value,ordinality from pg_catalog.jsonb_array_elements(
        p_forward->'actions'
      ) with ordinality
    loop
      v_inverse_action:=p_inverse->'actions'->(v_count-v_ordinal::integer);
      if private.lukas_drawing_structure_action_valid(v_action,p_revision_id)
          is not true
        or v_action->>'kind' not in ('put_property_value','put_table') then
        raise exception using errcode='P1C01',
          message='Reference-aware object restore action is invalid';
      end if;
      v_entity:=v_action->'entity';
      v_id:=(v_entity->>'id')::uuid;
      v_previous:=private.lukas_drawing_structure_entity_json(
        case when v_action->>'kind'='put_table' then 'table'
          else 'property_value' end,
        v_id,p_revision_id,v_revision.project_id
      );
      if v_action->>'kind'='put_property_value'
        and not exists(
          select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') o
          where o->>'id'=coalesce(
            v_entity->>'objectId',v_entity->>'blockInstanceId'
          )
        ) then
        raise exception using errcode='P1C01',
          message='Reference-aware property restore target is invalid';
      end if;
      if v_action->>'kind'='put_table' then
        select coalesce(pg_catalog.jsonb_agg(r.value order by r.ordinality),'[]'::jsonb)
          into v_rows
        from pg_catalog.jsonb_array_elements(v_entity->'rows')
          with ordinality r(value,ordinality)
        where not exists(
          select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') o
          where o->>'id'=coalesce(
            r.value->>'objectId',r.value->>'blockInstanceId'
          )
        );
        if v_previous is null
          or v_rows is distinct from v_previous->'rows'
          or v_entity-'rows' is distinct from v_previous-'rows' then
          raise exception using errcode='P1C01',
            message='Reference-aware table restore rows are invalid';
        end if;
      end if;
      if pg_catalog.jsonb_typeof(v_action->'baseVersion')='null' then
        if v_previous is not null then
          raise exception using errcode='P1C01',
            message='Reference-aware restored entity already exists';
        end if;
        v_tombstone:=private.lukas_drawing_structure_tombstone(
          p_revision_id,v_id,v_action->>'kind'
        );
        if v_tombstone is null or v_entity is distinct from v_tombstone then
          raise exception using errcode='P1C01',
            message='Reference-aware restore must match the exact tombstone';
        end if;
        v_new_version:=(v_tombstone->>'version')::bigint+2;
        v_inverse_action:=pg_catalog.jsonb_build_object(
          'kind',replace(v_action->>'kind','put_','delete_'),
          'id',v_id,'baseVersion',v_new_version
        );
      else
        v_base:=(v_action->>'baseVersion')::bigint;
        if v_previous is null
          or (v_previous->>'version')::bigint<>v_base
          or (v_entity->>'version')::bigint<>v_base then
          raise exception using errcode='P1C01',
            message='Reference-aware restore base version conflict';
        end if;
        v_new_version:=v_base+1;
        v_expected_bases:=v_expected_bases||
          pg_catalog.jsonb_build_object(v_id::text,v_base);
        v_inverse_action:=pg_catalog.jsonb_build_object(
          'kind',v_action->>'kind','entity',v_previous,
          'baseVersion',v_new_version
        );
      end if;
      if p_inverse->'actions'->(v_count-v_ordinal::integer)
          is distinct from v_inverse_action then
        raise exception using errcode='P1C01',
          message='Reference-aware restore inverse is not exact';
      end if;
      v_result_versions:=v_result_versions||
        pg_catalog.jsonb_build_object(v_id::text,v_new_version);
    end loop;
    if p_inverse->>'objectAction'<>'delete'
      or p_inverse->'objects' is distinct from v_expected_inverse_objects
      or p_base_versions is distinct from v_expected_bases then
      raise exception using errcode='P1C01',
        message='Reference-aware object restore is not exact';
    end if;

    for v_object in
      select value from pg_catalog.jsonb_array_elements(p_forward->'objects')
    loop
      update public.lukas_drawing_objects
      set status='active',version=version+1,updated_by=v_actor
      where id=(v_object->>'id')::uuid and status='deleted';
    end loop;
    for v_action in
      select value from pg_catalog.jsonb_array_elements(p_forward->'actions')
    loop
      v_entity:=v_action->'entity';
      v_id:=(v_entity->>'id')::uuid;
      if v_action->>'kind'='put_property_value' then
        insert into public.lukas_drawing_property_values(
          id,schema_id,object_id,block_instance_id,revision_id,project_id,
          value,version,created_by
        ) values(
          v_id,(v_entity->>'schemaId')::uuid,
          nullif(v_entity->>'objectId','')::uuid,
          nullif(v_entity->>'blockInstanceId','')::uuid,
          p_revision_id,v_revision.project_id,v_entity->'value',
          (v_result_versions->>v_id::text)::bigint,v_actor
        );
      else
        update public.lukas_drawing_tables set
          name=v_entity->>'name',columns_json=v_entity->'columns',
          rows_json=v_entity->'rows',version=(v_result_versions->>v_id::text)::bigint
        where id=v_id;
      end if;
    end loop;
  end if;

  select coalesce(pg_catalog.max(o.sequence),0)+1 into v_sequence
  from public.lukas_drawing_operations o where o.revision_id=p_revision_id;
  insert into public.lukas_drawing_operations(
    revision_id,project_id,sequence,client_operation_id,operation_type,
    base_versions,forward,inverse,result_versions,actor_id
  ) values(
    p_revision_id,v_revision.project_id,v_sequence,p_client_operation_id,
    p_operation_type,p_base_versions,p_forward,p_inverse,v_result_versions,v_actor
  ) returning id into v_operation_id;
  return pg_catalog.jsonb_build_object(
    'operationId',v_operation_id,'sequence',v_sequence,
    'resultVersions',v_result_versions
  );
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation
    or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range then
    raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

-- Block conversion remains a mutate_structure operation.  This narrow wrapper
-- lets its exact property/table cleanup travel in that same ledger entry while
-- the established object-compound engine continues to validate the core
-- definition/instance/object conversion unchanged.
alter function private.lukas_drawing_apply_operation_pre_task9_contract_fixes(
  uuid,uuid,text,jsonb,jsonb,jsonb
) rename to lukas_drawing_apply_operation_pre_task9_block_references;

create or replace function private.lukas_drawing_apply_operation_pre_task9_contract_fixes(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_object_action text;
  v_action jsonb; v_inverse_action jsonb; v_entity jsonb; v_previous jsonb;
  v_tombstone jsonb;
  v_rows jsonb; v_core_forward jsonb; v_core_inverse jsonb;
  v_core_bases jsonb:='{}'::jsonb; v_cleanup_bases jsonb:='{}'::jsonb;
  v_cleanup_forward jsonb:='[]'::jsonb; v_cleanup_inverse jsonb:='[]'::jsonb;
  v_expected_forward jsonb:='[]'::jsonb; v_expected_inverse jsonb:='[]'::jsonb;
  v_cleanup_results jsonb:='{}'::jsonb; v_results jsonb; v_result jsonb;
  v_id uuid; v_base bigint; v_new_version bigint; v_operation_id uuid;
  v_count integer; v_ordinal bigint;
begin
  if p_operation_type<>'mutate_structure'
    or p_forward->>'type'<>'mutate_structure'
    or pg_catalog.jsonb_typeof(p_forward->'actions')<>'array'
    or not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind' in ('put_object','delete_object')
    ) or not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind' in ('put_property_value','delete_property_value','put_table')
    ) then
    return private.lukas_drawing_apply_operation_pre_task9_block_references(
      p_revision_id,p_client_operation_id,p_operation_type,
      p_base_versions,p_forward,p_inverse
    );
  end if;

  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing revision target is unavailable';
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
      or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions
      or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse then
      raise exception using errcode='P1C01',
        message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions
    );
  end if;
  if v_revision.status<>'draft'
    or pg_catalog.jsonb_typeof(p_inverse->'actions')<>'array'
    or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where private.lukas_drawing_structure_action_valid(a,p_revision_id)
        is not true
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      group by coalesce(a->'entity'->>'id',a->>'id')
      having pg_catalog.count(*)>1
    ) then
    raise exception using errcode='P1C01',
      message='Drawing block reference cleanup payload is invalid';
  end if;
  select case
    when exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind'='delete_object'
    ) then 'delete' else 'restore' end into v_object_action;

  if v_object_action='delete' then
    if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          p_forward->'actions'
        ) a where a->>'kind'='put_block')<>1
      or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          p_forward->'actions'
        ) a where a->>'kind'='put_block_instance')<>1
      or exists(
        select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where a->>'kind' not in (
          'put_block','put_block_instance','delete_property_value',
          'put_table','delete_object'
        )
      ) then
      raise exception using errcode='P1C01',
        message='Drawing block conversion reference cleanup is not compound';
    end if;

    for v_entity in
      select private.lukas_drawing_structure_entity_json(
        'property_value',v.id,p_revision_id,v_revision.project_id
      )
      from public.lukas_drawing_property_values v
      where v.revision_id=p_revision_id and v.project_id=v_revision.project_id
        and exists(
          select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
          where a->>'kind'='delete_object'
            and a->>'id'=coalesce(v.object_id,v.block_instance_id)::text
        )
      order by v.id
    loop
      v_id:=(v_entity->>'id')::uuid;
      v_base:=(v_entity->>'version')::bigint;
      v_expected_forward:=v_expected_forward||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind','delete_property_value','id',v_id,'baseVersion',v_base
        )
      );
      v_expected_inverse:=pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind','put_property_value','entity',v_entity,'baseVersion',null
        )
      )||v_expected_inverse;
      v_cleanup_bases:=v_cleanup_bases||
        pg_catalog.jsonb_build_object(v_id::text,v_base);
      v_cleanup_results:=v_cleanup_results||
        pg_catalog.jsonb_build_object(v_id::text,null);
    end loop;
    for v_entity in
      select private.lukas_drawing_structure_entity_json(
        'table',t.id,p_revision_id,v_revision.project_id
      )
      from public.lukas_drawing_tables t
      where t.revision_id=p_revision_id and t.project_id=v_revision.project_id
        and exists(
          select 1 from pg_catalog.jsonb_array_elements(t.rows_json) r
          join pg_catalog.jsonb_array_elements(p_forward->'actions') a
            on a->>'kind'='delete_object'
              and a->>'id'=coalesce(r->>'objectId',r->>'blockInstanceId')
        )
      order by t.id
    loop
      v_id:=(v_entity->>'id')::uuid;
      v_base:=(v_entity->>'version')::bigint;
      select coalesce(pg_catalog.jsonb_agg(r.value order by r.ordinality),'[]'::jsonb)
        into v_rows
      from pg_catalog.jsonb_array_elements(v_entity->'rows')
        with ordinality r(value,ordinality)
      where not exists(
        select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where a->>'kind'='delete_object'
          and a->>'id'=coalesce(
            r.value->>'objectId',r.value->>'blockInstanceId'
          )
      );
      v_expected_forward:=v_expected_forward||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind','put_table',
          'entity',pg_catalog.jsonb_set(v_entity,'{rows}',v_rows),
          'baseVersion',v_base
        )
      );
      v_expected_inverse:=pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'kind','put_table','entity',v_entity,'baseVersion',v_base+1
        )
      )||v_expected_inverse;
      v_cleanup_bases:=v_cleanup_bases||
        pg_catalog.jsonb_build_object(v_id::text,v_base);
      v_cleanup_results:=v_cleanup_results||
        pg_catalog.jsonb_build_object(v_id::text,v_base+1);
    end loop;
    select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
      into v_cleanup_forward
    from pg_catalog.jsonb_array_elements(p_forward->'actions')
      with ordinality a(value,ordinality)
    where a.value->>'kind' in ('delete_property_value','put_table');
    select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
      into v_cleanup_inverse
    from pg_catalog.jsonb_array_elements(p_inverse->'actions')
      with ordinality a(value,ordinality)
    where a.value->>'kind' in ('put_property_value','put_table');
    if v_cleanup_forward is distinct from v_expected_forward
      or v_cleanup_inverse is distinct from v_expected_inverse then
      raise exception using errcode='P1C01',
        message='Drawing block conversion reference cleanup is not exact';
    end if;
  else
    if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          p_forward->'actions'
        ) a where a->>'kind'='delete_block')<>1
      or (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          p_forward->'actions'
        ) a where a->>'kind'='delete_block_instance')<>1
      or exists(
        select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where a->>'kind' not in (
          'put_object','put_property_value','put_table',
          'delete_block_instance','delete_block'
        )
      ) then
      raise exception using errcode='P1C01',
        message='Drawing block restoration reference cleanup is not compound';
    end if;
    v_count:=pg_catalog.jsonb_array_length(p_forward->'actions');
    for v_action,v_ordinal in
      select value,ordinality from pg_catalog.jsonb_array_elements(
        p_forward->'actions'
      ) with ordinality
      where value->>'kind' in ('put_property_value','put_table')
    loop
      v_entity:=v_action->'entity';
      v_id:=(v_entity->>'id')::uuid;
      if v_action->>'kind'='put_property_value' then
        if not exists(
          select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
          where a->>'kind'='put_object'
            and a->'entity'->>'id'=coalesce(
              v_entity->>'objectId',v_entity->>'blockInstanceId'
            )
        ) then
          raise exception using errcode='P1C01',
            message='Drawing block property restoration target is invalid';
        end if;
        v_tombstone:=private.lukas_drawing_structure_tombstone(
          p_revision_id,v_id,'put_property_value'
        );
        if v_tombstone is null or v_tombstone is distinct from v_entity
          or pg_catalog.jsonb_typeof(v_action->'baseVersion')<>'null' then
          raise exception using errcode='P1C01',
            message='Drawing block property restoration is not exact';
        end if;
        v_new_version:=(v_tombstone->>'version')::bigint+2;
        v_inverse_action:=pg_catalog.jsonb_build_object(
          'kind','delete_property_value','id',v_id,
          'baseVersion',v_new_version
        );
        v_cleanup_results:=v_cleanup_results||
          pg_catalog.jsonb_build_object(v_id::text,v_new_version);
      else
        v_previous:=private.lukas_drawing_structure_entity_json(
          'table',v_id,p_revision_id,v_revision.project_id
        );
        v_base:=(v_action->>'baseVersion')::bigint;
        select coalesce(pg_catalog.jsonb_agg(r.value order by r.ordinality),'[]'::jsonb)
          into v_rows
        from pg_catalog.jsonb_array_elements(v_entity->'rows')
          with ordinality r(value,ordinality)
        where not exists(
          select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
          where a->>'kind'='put_object'
            and a->'entity'->>'id'=coalesce(
              r.value->>'objectId',r.value->>'blockInstanceId'
            )
        );
        if v_previous is null or (v_previous->>'version')::bigint<>v_base
          or (v_entity->>'version')::bigint<>v_base
          or v_rows is distinct from v_previous->'rows'
          or v_entity-'rows' is distinct from v_previous-'rows' then
          raise exception using errcode='P1C01',
            message='Drawing block table restoration is not exact';
        end if;
        v_new_version:=v_base+1;
        v_inverse_action:=pg_catalog.jsonb_build_object(
          'kind','put_table','entity',v_previous,
          'baseVersion',v_new_version
        );
        v_cleanup_bases:=v_cleanup_bases||
          pg_catalog.jsonb_build_object(v_id::text,v_base);
        v_cleanup_results:=v_cleanup_results||
          pg_catalog.jsonb_build_object(v_id::text,v_new_version);
      end if;
      if p_inverse->'actions'->(v_count-v_ordinal::integer)
          is distinct from v_inverse_action then
        raise exception using errcode='P1C01',
          message='Drawing block restoration cleanup inverse is not exact';
      end if;
    end loop;
  end if;

  select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
    into v_core_forward
  from pg_catalog.jsonb_array_elements(p_forward->'actions')
    with ordinality a(value,ordinality)
  where case when v_object_action='delete'
    then a.value->>'kind' not in ('delete_property_value','put_table')
    else a.value->>'kind' not in ('put_property_value','put_table') end;
  select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
    into v_core_inverse
  from pg_catalog.jsonb_array_elements(p_inverse->'actions')
    with ordinality a(value,ordinality)
  where case when v_object_action='delete'
    then a.value->>'kind' not in ('put_property_value','put_table')
    else a.value->>'kind' not in ('delete_property_value','put_table') end;
  for v_action in select value from pg_catalog.jsonb_array_elements(v_core_forward)
  loop
    if pg_catalog.jsonb_typeof(v_action->'baseVersion')<>'null' then
      v_id:=coalesce((v_action->>'id')::uuid,
        (v_action->'entity'->>'id')::uuid);
      v_core_bases:=v_core_bases||pg_catalog.jsonb_build_object(
        v_id::text,(v_action->>'baseVersion')::bigint
      );
    end if;
  end loop;
  if p_base_versions is distinct from v_core_bases||v_cleanup_bases then
    raise exception using errcode='P1C01',
      message='Drawing block reference cleanup bases are incomplete';
  end if;

  if v_object_action='delete' then
    for v_action in select value from pg_catalog.jsonb_array_elements(v_expected_forward)
    loop
      v_id:=coalesce((v_action->>'id')::uuid,
        (v_action->'entity'->>'id')::uuid);
      if v_action->>'kind'='delete_property_value' then
        delete from public.lukas_drawing_property_values where id=v_id;
      else
        update public.lukas_drawing_tables set
          rows_json=v_action->'entity'->'rows',version=version+1
        where id=v_id;
      end if;
    end loop;
  end if;
  v_result:=private.lukas_drawing_apply_operation_pre_task9_block_references(
    p_revision_id,p_client_operation_id,p_operation_type,v_core_bases,
    pg_catalog.jsonb_build_object('type','mutate_structure','actions',v_core_forward),
    pg_catalog.jsonb_build_object('type','mutate_structure','actions',v_core_inverse)
  );
  if v_object_action='restore' then
    for v_action in
      select value from pg_catalog.jsonb_array_elements(p_forward->'actions')
      where value->>'kind' in ('put_property_value','put_table')
    loop
      v_entity:=v_action->'entity'; v_id:=(v_entity->>'id')::uuid;
      if v_action->>'kind'='put_property_value' then
        insert into public.lukas_drawing_property_values(
          id,schema_id,object_id,block_instance_id,revision_id,project_id,
          value,version,created_by
        ) values(
          v_id,(v_entity->>'schemaId')::uuid,
          nullif(v_entity->>'objectId','')::uuid,
          nullif(v_entity->>'blockInstanceId','')::uuid,
          p_revision_id,v_revision.project_id,v_entity->'value',
          (v_cleanup_results->>v_id::text)::bigint,v_actor
        );
      else
        update public.lukas_drawing_tables set
          name=v_entity->>'name',columns_json=v_entity->'columns',
          rows_json=v_entity->'rows',version=(v_cleanup_results->>v_id::text)::bigint
        where id=v_id;
      end if;
    end loop;
  end if;
  v_results:=(v_result->'resultVersions')||v_cleanup_results;
  v_operation_id:=(v_result->>'operationId')::uuid;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite',v_operation_id::text,true
  );
  update public.lukas_drawing_operations set
    base_versions=p_base_versions,forward=p_forward,inverse=p_inverse,
    result_versions=v_results
  where id=v_operation_id;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite','',true
  );
  return v_result||pg_catalog.jsonb_build_object('resultVersions',v_results);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation
    or not_null_violation or invalid_text_representation
    or numeric_value_out_of_range then
    raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

do $$
begin
  if exists(
    select 1 from public.lukas_drawing_tables t
    where exists(
      select 1 from pg_catalog.jsonb_array_elements(t.columns_json) c
      group by c->>'id' having pg_catalog.count(*)>1
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(t.columns_json) c
      group by c->>'name' having pg_catalog.count(*)>1
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(t.rows_json) r
      group by r->>'id' having pg_catalog.count(*)>1
    )
  ) then
    raise exception using errcode='P1C01',
      message='Resolve duplicate drawing table column or row identity before upgrade';
  end if;
end;
$$;

alter function private.lukas_drawing_structure_action_valid(jsonb,uuid)
  rename to lukas_drawing_structure_action_valid_pre_task9_table_identity;
create or replace function private.lukas_drawing_structure_action_valid(
  p_action jsonb,p_revision_id uuid
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare v_entity jsonb;
begin
  if private.lukas_drawing_structure_action_valid_pre_task9_table_identity(
      p_action,p_revision_id
    ) is not true then
    return false;
  end if;
  if p_action->>'kind'<>'put_table' then return true; end if;
  v_entity:=p_action->'entity';
  return not exists(
      select 1 from pg_catalog.jsonb_array_elements(v_entity->'columns') c
      group by c->>'id' having pg_catalog.count(*)>1
    ) and not exists(
      select 1 from pg_catalog.jsonb_array_elements(v_entity->'columns') c
      group by c->>'name' having pg_catalog.count(*)>1
    ) and not exists(
      select 1 from pg_catalog.jsonb_array_elements(v_entity->'rows') r
      group by r->>'id' having pg_catalog.count(*)>1
    );
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_table_domain_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then return old; end if;
  if pg_catalog.jsonb_typeof(new.rows_json)<>'array'
    or exists(
      select 1 from pg_catalog.jsonb_array_elements(new.rows_json) r
      where not (r ?& array['id','objectId','blockInstanceId','cells'])
        or ((pg_catalog.jsonb_typeof(r->'objectId')='null') =
          (pg_catalog.jsonb_typeof(r->'blockInstanceId')='null'))
    ) then
    raise exception using errcode='P1C01',
      message='Drawing table row requires exactly one target';
  end if;
  if pg_catalog.jsonb_typeof(new.columns_json)<>'array'
    or pg_catalog.jsonb_array_length(new.columns_json)=0
    or pg_catalog.jsonb_typeof(new.rows_json)<>'array'
    or exists(
      select 1 from pg_catalog.jsonb_array_elements(new.columns_json) c
      where pg_catalog.jsonb_typeof(c)<>'object'
        or not (c ?& array['id','name','kind','propertySchemaId'])
        or c-array['id','name','kind','propertySchemaId']<>'{}'::jsonb
        or private.lukas_drawing_p2_uuid(c->'id') is not true
        or private.lukas_drawing_p2_name(c->'name') is not true
        or c->>'kind' not in (
          'text','number','object_name','object_type','property'
        )
        or not (
          c->>'kind'='property'
            and private.lukas_drawing_p2_uuid(c->'propertySchemaId') is true
          or c->>'kind'<>'property'
            and pg_catalog.jsonb_typeof(c->'propertySchemaId')='null'
        )
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(new.rows_json) r
      where pg_catalog.jsonb_typeof(r)<>'object'
        or not (r ?& array['id','objectId','blockInstanceId','cells'])
        or r-array['id','objectId','blockInstanceId','cells']<>'{}'::jsonb
        or private.lukas_drawing_p2_uuid(r->'id') is not true
        or pg_catalog.jsonb_typeof(r->'cells')<>'object'
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(new.columns_json) c
      group by c->>'id' having pg_catalog.count(*)>1
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(new.columns_json) c
      group by c->>'name' having pg_catalog.count(*)>1
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(new.rows_json) r
      group by r->>'id' having pg_catalog.count(*)>1
    ) then
    raise exception using errcode='P1C01',
      message='Drawing table column and row identity must be exact and unique';
  end if;
  if exists(
      select 1 from pg_catalog.jsonb_array_elements(new.columns_json) c
      where c->>'kind'='property' and not exists(
        select 1 from public.lukas_drawing_property_schemas s
        where s.id=(c->>'propertySchemaId')::uuid
          and s.revision_id=new.revision_id and s.project_id=new.project_id
      )
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(new.rows_json) r
      where (r->>'objectId' is not null and not exists(
        select 1 from public.lukas_drawing_objects o
        where o.id=(r->>'objectId')::uuid and o.revision_id=new.revision_id
          and o.project_id=new.project_id and o.status='active'
      )) or (r->>'blockInstanceId' is not null and not exists(
        select 1 from public.lukas_drawing_block_instances i
        where i.id=(r->>'blockInstanceId')::uuid
          and i.revision_id=new.revision_id and i.project_id=new.project_id
      ))
    ) then
    raise exception using errcode='P1R01',
      message='Drawing table reference is unavailable';
  end if;
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(new.rows_json) r
    cross join pg_catalog.jsonb_array_elements(new.columns_json) c
    join public.lukas_drawing_property_schemas s
      on c->>'kind'='property' and s.id=(c->>'propertySchemaId')::uuid
      and s.revision_id=new.revision_id and s.project_id=new.project_id
    left join public.lukas_drawing_objects o
      on o.id=nullif(r->>'objectId','')::uuid and o.status='active'
    where not (s.applies_to @> pg_catalog.jsonb_build_array(
      case when o.id is not null then o.object_type else 'block_instance' end
    ))
  ) then
    raise exception using errcode='P1C01',
      message='Drawing table property column does not apply to its row target';
  end if;
  return new;
end;
$$;

revoke all on function
  private.lukas_drawing_apply_operation_pre_task9_contract_fixes(
    uuid,uuid,text,jsonb,jsonb,jsonb
  ),
  private.lukas_drawing_apply_operation_pre_task9_block_references(
    uuid,uuid,text,jsonb,jsonb,jsonb
  ),
  private.lukas_drawing_structure_action_valid_pre_task9_table_identity(
    jsonb,uuid
  ),
  private.lukas_drawing_table_domain_guard()
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) from public,anon;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) to authenticated,service_role;

commit;
