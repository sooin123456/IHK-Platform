begin;

create function private.lukas_drawing_checkpoint_structure(p_graph jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'pages',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'pages')),'[]'::jsonb),
    'canvases',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'canvases')),'[]'::jsonb),
    'layers',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'layers')),'[]'::jsonb),
    'objects',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'objects')),'[]'::jsonb),
    'styles',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'styles')),'[]'::jsonb),
    'blocks',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'blocks')),'[]'::jsonb),
    'blockInstances',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'blockInstances')),'[]'::jsonb),
    'propertySchemas',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'propertySchemas')),'[]'::jsonb),
    'propertyValues',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'propertyValues')),'[]'::jsonb),
    'tables',coalesce((select pg_catalog.jsonb_agg(value-'version' order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'tables')),'[]'::jsonb),
    'sources',coalesce((select pg_catalog.jsonb_agg(value order by value->>'id') from pg_catalog.jsonb_array_elements(p_graph->'sources')),'[]'::jsonb),
    'issues',coalesce((select pg_catalog.jsonb_agg(value order by value->>'id',value->>'objectId') from pg_catalog.jsonb_array_elements(p_graph->'issues')),'[]'::jsonb)
  )
$$;

alter function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) rename to lukas_drawing_apply_operation_pre_p3_activity_authority;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_existing public.lukas_drawing_operations%rowtype;
  v_snapshot public.lukas_drawing_snapshots%rowtype;
  v_live jsonb;
  v_result jsonb;
begin
  if p_operation_type<>'restore_checkpoint' then
    return private.lukas_drawing_apply_operation_pre_p3_activity_authority(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id and o.client_operation_id=p_client_operation_id;
  if found then
    return private.lukas_drawing_apply_operation_pre_p3_activity_authority(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.status='draft' for update;
  if not found then raise exception using errcode='P1C01',
    message='Drawing checkpoint requires a draft revision'; end if;
  select s.* into v_snapshot from public.lukas_drawing_snapshots s
  where s.id=(p_forward->>'checkpointId')::uuid
    and s.revision_id=p_revision_id for share;
  if not found or v_snapshot.schema_version<>2
    or v_snapshot.sha256 is distinct from pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(
        v_snapshot.canonical_json::text,'UTF8'),'sha256'),'hex'
    ) then raise exception using errcode='P1C01',
      message='Drawing checkpoint target is invalid'; end if;
  v_result:=private.lukas_drawing_apply_operation_pre_p3_activity_authority(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,p_history_action,p_original_operation_id
  );
  v_live:=private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true);
  if private.lukas_drawing_checkpoint_structure(v_live)
    is distinct from private.lukas_drawing_checkpoint_structure(
      v_snapshot.canonical_json
    ) then raise exception using errcode='P1C01',
      message='Drawing checkpoint delta does not match its canonical snapshot';
  end if;
  return v_result;
end;
$$;

create table private.lukas_drawing_checkpoint_tombstone_targets(
  transaction_id bigint not null,
  actor_id uuid not null,
  revision_id uuid not null,
  entity_id uuid not null,
  put_kind text not null,
  entity jsonb not null,
  primary key(transaction_id,actor_id,revision_id,entity_id,put_kind)
);

create or replace function private.lukas_drawing_structure_tombstone(
  p_revision_id uuid,p_id uuid,p_put_kind text
) returns jsonb language sql stable security definer set search_path='' as $$
  with latest as (
    select o.inverse,o.result_versions
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.result_versions ? p_id::text
    order by o.sequence desc limit 1
  ), actual as (
    select candidate.entity from latest,
      lateral (
        select a->'entity' entity
        from pg_catalog.jsonb_array_elements(
          coalesce(latest.inverse->'actions','[]'::jsonb)
        ) a
        where a->>'kind'=p_put_kind
        union all
        select o entity
        from pg_catalog.jsonb_array_elements(
          coalesce(latest.inverse->'objects','[]'::jsonb)
        ) o
        where p_put_kind='put_object'
          and latest.inverse->>'type'='add_objects'
      ) candidate
    where latest.result_versions->p_id::text='null'::jsonb
      and candidate.entity->>'id'=p_id::text
    limit 1
  ), target as (
    select t.entity from private.lukas_drawing_checkpoint_tombstone_targets t
    where t.transaction_id=pg_catalog.txid_current()
      and t.actor_id=(select auth.uid()) and t.revision_id=p_revision_id
      and t.entity_id=p_id and t.put_kind=p_put_kind
  )
  select case when actual.entity is not null and target.entity is not null
    then target.entity else actual.entity end
  from actual full join target on true
$$;

create function private.lukas_drawing_checkpoint_apply_objects(
  p_revision_id uuid,p_actions jsonb,p_inverse_actions jsonb,p_phase text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_project_id uuid;
  v_count integer:=pg_catalog.jsonb_array_length(p_actions);
  v_action jsonb; v_inverse jsonb; v_entity jsonb; v_previous jsonb;
  v_expected jsonb; v_tombstone jsonb;
  v_id uuid; v_base bigint; v_new_version bigint; v_ordinal bigint;
  v_step bigint;
  v_status text;
  v_bases jsonb:='{}'::jsonb; v_results jsonb:='{}'::jsonb;
begin
  if p_phase not in ('put_ready','put_deferred','delete') then
    raise exception using errcode='P1C01',
      message='Drawing checkpoint object phase is invalid';
  end if;
  select r.project_id into v_project_id from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.status='draft'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor');
  if not found then raise exception using errcode='P1R01',
    message='Drawing checkpoint object target is unavailable'; end if;
  for v_action,v_ordinal in
    select value,ordinality from pg_catalog.jsonb_array_elements(p_actions)
      with ordinality
  loop
    if (p_phase in ('put_ready','put_deferred')
        and v_action->>'kind'<>'put_object')
      or (p_phase='delete' and v_action->>'kind'<>'delete_object') then
      continue;
    end if;
    if p_phase='put_ready' and exists(
        select 1 from private.lukas_drawing_checkpoint_tombstone_targets t
        where t.transaction_id=pg_catalog.txid_current()
          and t.actor_id=v_actor and t.revision_id=p_revision_id
          and t.entity_id=(v_action->'entity'->>'id')::uuid
          and t.put_kind='put_object_deferred'
      ) then continue; end if;
    if p_phase='put_deferred' and not exists(
        select 1 from private.lukas_drawing_checkpoint_tombstone_targets t
        where t.transaction_id=pg_catalog.txid_current()
          and t.actor_id=v_actor and t.revision_id=p_revision_id
          and t.entity_id=(v_action->'entity'->>'id')::uuid
          and t.put_kind='put_object_deferred'
      ) then continue; end if;
    v_inverse:=p_inverse_actions->(v_count-v_ordinal::integer);
    v_entity:=v_action->'entity';
    v_id:=coalesce((v_entity->>'id')::uuid,(v_action->>'id')::uuid);
    select o.status,o.version into v_status,v_base
    from public.lukas_drawing_objects o
    where o.id=v_id and o.revision_id=p_revision_id
      and o.project_id=v_project_id for update;
    v_previous:=private.lukas_drawing_structure_entity_json(
      'object',v_id,p_revision_id,v_project_id
    );
    if p_phase in ('put_ready','put_deferred') then
      if pg_catalog.jsonb_typeof(v_entity)<>'object'
        or not (v_entity ?& array['id','name','layerId','geometry','style','version'])
        or v_entity-array['id','name','layerId','geometry','styleId','style','version']<>'{}'::jsonb
        or private.lukas_drawing_p2_json_numbers_valid(v_entity) is not true
        or not exists(
          select 1 from public.lukas_drawing_layers l
          where l.id=(v_entity->>'layerId')::uuid
            and l.revision_id=p_revision_id and l.project_id=v_project_id
        ) then raise exception using errcode='P1C01',
          message='Drawing checkpoint object payload is invalid'; end if;
      if v_status='active' then
        if pg_catalog.jsonb_typeof(v_action->'baseVersion')='null'
          or (v_action->>'baseVersion')::bigint<>v_base
          or (v_entity->>'version')::bigint<>v_base then
          raise exception using errcode='P1C01',
            message='Drawing checkpoint object base version is stale'; end if;
        v_new_version:=v_base+1;
        v_expected:=pg_catalog.jsonb_build_object(
          'kind','put_object','entity',v_previous,
          'baseVersion',v_new_version
        );
        v_bases:=v_bases||pg_catalog.jsonb_build_object(v_id::text,v_base);
      elsif v_status='deleted' then
        if pg_catalog.jsonb_typeof(v_action->'baseVersion')<>'null' then
          raise exception using errcode='P1C01',
            message='Drawing checkpoint object tombstone base is invalid'; end if;
        v_tombstone:=private.lukas_drawing_structure_tombstone(
          p_revision_id,v_id,'put_object'
        );
        if v_tombstone is null
          or (v_entity->>'version')::bigint
            <>(v_tombstone->>'version')::bigint then
          raise exception using errcode='P1C01',
            message='Drawing checkpoint object tombstone is stale'; end if;
        v_new_version:=v_base+1;
        v_expected:=pg_catalog.jsonb_build_object(
          'kind','delete_object','id',v_id,'baseVersion',v_new_version
        );
      else
        v_tombstone:=private.lukas_drawing_structure_tombstone(
          p_revision_id,v_id,'put_object'
        );
        if pg_catalog.jsonb_typeof(v_action->'baseVersion')<>'null'
          or v_tombstone is null
          or (v_entity->>'version')::bigint
            <>(v_tombstone->>'version')::bigint then
          raise exception using errcode='P1C01',
            message='Drawing checkpoint object history is unavailable'; end if;
        v_new_version:=(v_tombstone->>'version')::bigint+2;
        v_expected:=pg_catalog.jsonb_build_object(
          'kind','delete_object','id',v_id,'baseVersion',v_new_version
        );
      end if;
      if v_inverse is distinct from v_expected then
        raise exception using errcode='P1C01',
          message='Drawing checkpoint object inverse is not exact'; end if;
      if v_status is null then
        insert into public.lukas_drawing_objects(
          id,lineage_id,page_id,layer_id,revision_id,project_id,name,
          object_type,geometry,style_id,style,status,version,
          created_by,updated_by
        ) values(
          v_id,v_id,(select l.page_id from public.lukas_drawing_layers l
            where l.id=(v_entity->>'layerId')::uuid),
          (v_entity->>'layerId')::uuid,p_revision_id,v_project_id,
          v_entity->>'name',v_entity->'geometry'->>'type',
          v_entity->'geometry',nullif(v_entity->>'styleId','')::uuid,
          v_entity->'style','active',1,v_actor,v_actor
        );
        for v_step in 2..v_new_version loop
          update public.lukas_drawing_objects set
            version=v_step,updated_by=v_actor where id=v_id;
        end loop;
      else
        update public.lukas_drawing_objects set
          layer_id=(v_entity->>'layerId')::uuid,
          page_id=(select l.page_id from public.lukas_drawing_layers l
            where l.id=(v_entity->>'layerId')::uuid),
          name=v_entity->>'name',object_type=v_entity->'geometry'->>'type',
          geometry=v_entity->'geometry',
          style_id=nullif(v_entity->>'styleId','')::uuid,
          style=v_entity->'style',status='active',version=v_new_version,
          updated_by=v_actor
        where id=v_id;
      end if;
      v_results:=v_results||
        pg_catalog.jsonb_build_object(v_id::text,v_new_version);
    else
      if v_status is null then
        select t.entity into v_previous
        from private.lukas_drawing_checkpoint_tombstone_targets t
        where t.transaction_id=pg_catalog.txid_current()
          and t.actor_id=v_actor and t.revision_id=p_revision_id
          and t.entity_id=v_id and t.put_kind='delete_object_current';
        v_base:=(v_previous->>'version')::bigint;
      end if;
      if coalesce(v_status,'active')<>'active' or v_previous is null
        or (v_action->>'baseVersion')::bigint<>v_base then
        raise exception using errcode='P1C01',
          message='Drawing checkpoint object delete base is stale'; end if;
      v_expected:=pg_catalog.jsonb_build_object(
        'kind','put_object','entity',v_previous,'baseVersion',null
      );
      if v_inverse is distinct from v_expected then
        raise exception using errcode='P1C01',
          message='Drawing checkpoint object inverse is not exact'; end if;
      if v_status is not null and (exists(select 1 from public.lukas_drawing_property_values v
          where v.object_id=v_id)
        or exists(select 1 from public.lukas_drawing_tables t
          cross join lateral pg_catalog.jsonb_array_elements(t.rows_json) r
          where t.revision_id=p_revision_id and r->>'objectId'=v_id::text))
      then raise exception using errcode='P1C01',
        message='Drawing checkpoint object references are incomplete'; end if;
      if v_status is not null then
        update public.lukas_drawing_objects set status='deleted',
          version=v_base+1,updated_by=v_actor where id=v_id;
      end if;
      v_bases:=v_bases||pg_catalog.jsonb_build_object(v_id::text,v_base);
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,null);
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('bases',v_bases,'results',v_results);
exception when sqlstate 'P1C01' or sqlstate 'P1R01' then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create function private.lukas_drawing_checkpoint_apply_layer_updates(
  p_revision_id uuid,p_actions jsonb,p_inverse_actions jsonb,p_phase text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_project_id uuid;
  v_count integer:=pg_catalog.jsonb_array_length(p_actions);
  v_action jsonb; v_inverse jsonb; v_entity jsonb; v_previous jsonb;
  v_expected jsonb; v_id uuid; v_base bigint; v_ordinal bigint;
  v_bases jsonb:='{}'::jsonb; v_results jsonb:='{}'::jsonb;
begin
  if p_phase not in ('ready','deferred') then
    raise exception using errcode='P1C01',
      message='Drawing checkpoint layer phase is invalid'; end if;
  select r.project_id into v_project_id from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.status='draft'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor');
  if not found then raise exception using errcode='P1R01',
    message='Drawing checkpoint layer target is unavailable'; end if;
  for v_action,v_ordinal in
    select value,ordinality from pg_catalog.jsonb_array_elements(p_actions)
      with ordinality
  loop
    if v_action->>'kind'<>'put_layer'
      or pg_catalog.jsonb_typeof(v_action->'baseVersion')<>'number' then
      continue; end if;
    v_id:=(v_action->'entity'->>'id')::uuid;
    if p_phase='ready' and exists(
      select 1 from private.lukas_drawing_checkpoint_tombstone_targets t
      where t.transaction_id=pg_catalog.txid_current()
        and t.actor_id=v_actor and t.revision_id=p_revision_id
        and t.entity_id=v_id and t.put_kind='put_layer_deferred'
    ) then continue; end if;
    if p_phase='deferred' and not exists(
      select 1 from private.lukas_drawing_checkpoint_tombstone_targets t
      where t.transaction_id=pg_catalog.txid_current()
        and t.actor_id=v_actor and t.revision_id=p_revision_id
        and t.entity_id=v_id and t.put_kind='put_layer_deferred'
    ) then continue; end if;
    v_entity:=v_action->'entity';
    v_inverse:=p_inverse_actions->(v_count-v_ordinal::integer);
    select l.version into v_base from public.lukas_drawing_layers l
    where l.id=v_id and l.revision_id=p_revision_id
      and l.project_id=v_project_id for update;
    v_previous:=private.lukas_drawing_structure_entity_json(
      'layer',v_id,p_revision_id,v_project_id
    );
    if v_previous is null
      or pg_catalog.jsonb_typeof(v_entity)<>'object'
      or not (v_entity ?& array[
        'id','name','visible','locked','systemKind','canvasId','sortOrder','version'
      ])
      or v_entity-array[
        'id','name','visible','locked','systemKind','canvasId','sortOrder','version'
      ]<>'{}'::jsonb
      or private.lukas_drawing_p2_json_numbers_valid(v_entity) is not true
      or (v_action->>'baseVersion')::bigint<>v_base
      or (v_entity->>'version')::bigint<>v_base
      or not exists(select 1 from public.lukas_drawing_canvases c
        where c.id=(v_entity->>'canvasId')::uuid
          and c.revision_id=p_revision_id and c.project_id=v_project_id)
    then raise exception using errcode='P1C01',
      message='Drawing checkpoint layer update is invalid'; end if;
    v_expected:=pg_catalog.jsonb_build_object(
      'kind','put_layer','entity',v_previous,'baseVersion',v_base+1
    );
    if v_inverse is distinct from v_expected then
      raise exception using errcode='P1C01',
        message='Drawing checkpoint layer inverse is not exact'; end if;
    update public.lukas_drawing_layers set
      page_id=(select c.page_id from public.lukas_drawing_canvases c
        where c.id=(v_entity->>'canvasId')::uuid),
      canvas_id=(v_entity->>'canvasId')::uuid,name=v_entity->>'name',
      sort_order=(v_entity->>'sortOrder')::integer,
      visible=(v_entity->>'visible')::boolean,
      locked=(v_entity->>'locked')::boolean,version=v_base+1
    where id=v_id;
    v_bases:=v_bases||pg_catalog.jsonb_build_object(v_id::text,v_base);
    v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,v_base+1);
  end loop;
  return pg_catalog.jsonb_build_object('bases',v_bases,'results',v_results);
exception when sqlstate 'P1C01' or sqlstate 'P1R01' then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create function private.lukas_drawing_checkpoint_stage_canvases(
  p_revision_id uuid,p_actions jsonb,p_inverse_actions jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_project_id uuid;
  v_count integer:=pg_catalog.jsonb_array_length(p_actions);
  v_action jsonb; v_inverse jsonb; v_entity jsonb; v_tombstone jsonb;
  v_id uuid; v_ordinal bigint; v_new_version bigint; v_step bigint;
  v_results jsonb:='{}'::jsonb;
begin
  select r.project_id into v_project_id from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.status='draft'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor');
  if not found then raise exception using errcode='P1R01',
    message='Drawing checkpoint canvas target is unavailable'; end if;
  for v_action,v_ordinal in
    select value,ordinality from pg_catalog.jsonb_array_elements(p_actions)
      with ordinality
  loop
    if v_action->>'kind'<>'put_canvas'
      or pg_catalog.jsonb_typeof(v_action->'baseVersion')<>'null'
      or not exists(
        select 1 from pg_catalog.jsonb_array_elements(p_actions) l
        where l->>'kind'='put_layer'
          and pg_catalog.jsonb_typeof(l->'baseVersion')='number'
          and l->'entity'->>'canvasId'=v_action->'entity'->>'id'
      ) then continue; end if;
    v_entity:=v_action->'entity'; v_id:=(v_entity->>'id')::uuid;
    if exists(select 1 from public.lukas_drawing_canvases c where c.id=v_id)
      or private.lukas_drawing_structure_action_valid(
        v_action,p_revision_id
      ) is not true then raise exception using errcode='P1C01',
        message='Drawing checkpoint staged canvas is invalid'; end if;
    v_tombstone:=private.lukas_drawing_structure_tombstone(
      p_revision_id,v_id,'put_canvas'
    );
    if v_tombstone is null
      or (v_entity->>'version')::bigint<>(v_tombstone->>'version')::bigint
    then raise exception using errcode='P1C01',
      message='Drawing checkpoint staged canvas tombstone is stale'; end if;
    v_new_version:=(v_tombstone->>'version')::bigint+2;
    v_inverse:=p_inverse_actions->(v_count-v_ordinal::integer);
    if v_inverse is distinct from pg_catalog.jsonb_build_object(
      'kind','delete_canvas','id',v_id,'baseVersion',v_new_version
    ) then raise exception using errcode='P1C01',
      message='Drawing checkpoint staged canvas inverse is not exact'; end if;
    insert into public.lukas_drawing_canvases(
      id,page_id,revision_id,project_id,name,space_kind,width_mm,height_mm,
      background_source_file_id,background_source_sha256,
      background_pdf_page,calibration,sort_order,version,created_by
    ) values(
      v_id,(v_entity->>'pageId')::uuid,p_revision_id,v_project_id,
      v_entity->>'name',v_entity->>'spaceKind',
      (v_entity->>'widthMillimeters')::numeric,
      (v_entity->>'heightMillimeters')::numeric,
      nullif(v_entity->'background'->>'sourceFileId','')::uuid,
      v_entity->'background'->>'sourceSha256',
      nullif(v_entity->'background'->>'pdfPageNumber','')::integer,
      case when pg_catalog.jsonb_typeof(
        v_entity->'background'->'calibration'
      )='null' then null else v_entity->'background'->'calibration' end,
      (v_entity->>'sortOrder')::integer,v_new_version,v_actor
    );
    v_results:=v_results||pg_catalog.jsonb_build_object(
      v_id::text,v_new_version
    );
  end loop;
  for v_action,v_ordinal in
    select value,ordinality from pg_catalog.jsonb_array_elements(p_actions)
      with ordinality
  loop
    if v_action->>'kind'<>'put_layer'
      or pg_catalog.jsonb_typeof(v_action->'baseVersion')<>'null'
      or not exists(
        select 1 from pg_catalog.jsonb_array_elements(p_actions) c
        where c->>'kind'='put_canvas'
          and pg_catalog.jsonb_typeof(c->'baseVersion')='null'
          and c->'entity'->>'id'=v_action->'entity'->>'canvasId'
          and v_results ? (c->'entity'->>'id')
      ) then continue; end if;
    v_entity:=v_action->'entity'; v_id:=(v_entity->>'id')::uuid;
    if private.lukas_drawing_structure_action_valid(
      v_action,p_revision_id
    ) is not true then raise exception using errcode='P1C01',
      message='Drawing checkpoint staged layer is invalid'; end if;
    v_tombstone:=private.lukas_drawing_structure_tombstone(
      p_revision_id,v_id,'put_layer'
    );
    if v_tombstone is null
      or (v_entity->>'version')::bigint<>(v_tombstone->>'version')::bigint
    then raise exception using errcode='P1C01',
      message='Drawing checkpoint staged layer tombstone is stale'; end if;
    v_new_version:=(v_tombstone->>'version')::bigint+2;
    v_inverse:=p_inverse_actions->(v_count-v_ordinal::integer);
    if v_inverse is distinct from pg_catalog.jsonb_build_object(
      'kind','delete_layer','id',v_id,'baseVersion',v_new_version
    ) then raise exception using errcode='P1C01',
      message='Drawing checkpoint staged layer inverse is not exact'; end if;
    insert into public.lukas_drawing_layers(
      id,page_id,canvas_id,revision_id,project_id,name,sort_order,
      visible,locked,system_kind,version,created_by
    ) values(
      v_id,(select c.page_id from public.lukas_drawing_canvases c
        where c.id=(v_entity->>'canvasId')::uuid),
      (v_entity->>'canvasId')::uuid,p_revision_id,v_project_id,
      v_entity->>'name',(v_entity->>'sortOrder')::integer,
      (v_entity->>'visible')::boolean,(v_entity->>'locked')::boolean,
      v_entity->>'systemKind',1,v_actor
    );
    for v_step in 2..v_new_version loop
      update public.lukas_drawing_layers set version=v_step where id=v_id;
    end loop;
    v_results:=v_results||pg_catalog.jsonb_build_object(
      v_id::text,v_new_version
    );
  end loop;
  return pg_catalog.jsonb_build_object('bases','{}'::jsonb,'results',v_results);
exception when sqlstate 'P1C01' or sqlstate 'P1R01' then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_snapshot public.lukas_drawing_snapshots%rowtype;
  v_put_ready jsonb; v_put_deferred jsonb; v_delete jsonb;
  v_layer_ready jsonb; v_layer_deferred jsonb;
  v_staged_canvases jsonb;
  v_non_forward jsonb; v_non_inverse jsonb;
  v_non_bases jsonb; v_expected_bases jsonb; v_results jsonb; v_result jsonb;
  v_live jsonb; v_operation_id uuid; v_sequence bigint; v_original_actor uuid;
  v_object_ids text[]; v_layer_update_ids text[]; v_staged_canvas_ids text[];
  v_staged_layer_ids text[];
  v_action jsonb; v_tombstone jsonb; v_target_id uuid;
begin
  if p_operation_type<>'restore_checkpoint' then
    return private.lukas_drawing_apply_operation_pre_p3_activity_authority(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
  if found then
    return private.lukas_drawing_apply_operation_pre_p3_activity_authority(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.status='draft'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor') for update;
  if not found then raise exception using errcode='P1C01',
    message='Drawing checkpoint requires a writable draft revision'; end if;
  select s.* into v_snapshot from public.lukas_drawing_snapshots s
  where s.id=(p_forward->>'checkpointId')::uuid
    and s.revision_id=p_revision_id for share;
  if not found or v_snapshot.schema_version<>2
    or v_snapshot.sha256 is distinct from pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(
        v_snapshot.canonical_json::text,'UTF8'),'sha256'),'hex'
    ) then raise exception using errcode='P1C01',
      message='Drawing checkpoint target is invalid'; end if;
  if not (p_forward->>'type'='restore_checkpoint'
      and p_forward-array['type','checkpointId','actions']='{}'::jsonb
      and p_inverse->>'type'='restore_checkpoint'
      and p_inverse-array['type','checkpointId','actions']='{}'::jsonb
      and pg_catalog.jsonb_typeof(p_forward->'actions')='array'
      and pg_catalog.jsonb_array_length(p_forward->'actions') between 1 and 5000
      and p_inverse->>'checkpointId'=p_forward->>'checkpointId'
      and pg_catalog.jsonb_typeof(p_inverse->'actions')='array'
      and pg_catalog.jsonb_array_length(p_inverse->'actions')
        =pg_catalog.jsonb_array_length(p_forward->'actions')) then
    raise exception using errcode='P1C01',
      message='Drawing checkpoint payload is invalid'; end if;
  if not ((p_history_action is null and p_original_operation_id is null)
      or (p_history_action in ('undo','redo')
        and p_original_operation_id is not null)) then
    raise exception using errcode='P1C01',
      message='Drawing history lineage is invalid'; end if;
  if p_original_operation_id is not null then
    select o.actor_id into v_original_actor from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id
      and o.client_operation_id=p_original_operation_id;
    if not found or v_original_actor is distinct from v_actor then
      raise exception using errcode='P1C01',
        message='Drawing history original must belong to the same actor'; end if;
  end if;
  select pg_catalog.array_agg(coalesce(a->'entity'->>'id',a->>'id'))
    into v_object_ids from pg_catalog.jsonb_array_elements(p_forward->'actions') a
    where a->>'kind' in ('put_object','delete_object');
  select pg_catalog.array_agg(a->'entity'->>'id')
    into v_layer_update_ids
  from pg_catalog.jsonb_array_elements(p_forward->'actions') a
  where a->>'kind'='put_layer'
    and pg_catalog.jsonb_typeof(a->'baseVersion')='number';
  select pg_catalog.array_agg(a->'entity'->>'id')
    into v_staged_canvas_ids
  from pg_catalog.jsonb_array_elements(p_forward->'actions') a
  where a->>'kind'='put_canvas'
    and pg_catalog.jsonb_typeof(a->'baseVersion')='null'
    and not exists(select 1 from public.lukas_drawing_canvases c
      where c.id=(a->'entity'->>'id')::uuid)
    and exists(select 1
      from pg_catalog.jsonb_array_elements(p_forward->'actions') l
      where l->>'kind'='put_layer'
        and pg_catalog.jsonb_typeof(l->'baseVersion')='number'
        and l->'entity'->>'canvasId'=a->'entity'->>'id');
  select pg_catalog.array_agg(l->'entity'->>'id')
    into v_staged_layer_ids
  from pg_catalog.jsonb_array_elements(p_forward->'actions') l
  where l->>'kind'='put_layer'
    and pg_catalog.jsonb_typeof(l->'baseVersion')='null'
    and coalesce(v_staged_canvas_ids,array[]::text[])
      @> array[l->'entity'->>'canvasId'];
  v_non_forward:=pg_catalog.jsonb_build_object(
    'type','restore_checkpoint','checkpointId',p_forward->>'checkpointId',
    'actions',coalesce((select pg_catalog.jsonb_agg(a order by ord)
      from pg_catalog.jsonb_array_elements(p_forward->'actions')
        with ordinality x(a,ord)
      where a->>'kind' not in ('put_object','delete_object')
        and not (a->>'kind'='put_layer'
          and pg_catalog.jsonb_typeof(a->'baseVersion')='number')
        and not (a->>'kind'='put_canvas'
          and coalesce(v_staged_canvas_ids,array[]::text[])
            @> array[a->'entity'->>'id'])
        and not (a->>'kind'='put_layer'
          and coalesce(v_staged_layer_ids,array[]::text[])
            @> array[a->'entity'->>'id'])),
      '[]'::jsonb)
  );
  v_non_inverse:=pg_catalog.jsonb_build_object(
    'type','restore_checkpoint','checkpointId',p_forward->>'checkpointId',
    'actions',coalesce((select pg_catalog.jsonb_agg(a order by ord)
      from pg_catalog.jsonb_array_elements(p_inverse->'actions')
        with ordinality x(a,ord)
      where a->>'kind' not in ('put_object','delete_object')
        and not (a->>'kind'='put_layer'
          and pg_catalog.jsonb_typeof(a->'baseVersion')='number')
        and not (a->>'kind'='delete_canvas'
          and coalesce(v_staged_canvas_ids,array[]::text[])
            @> array[a->>'id'])
        and not (a->>'kind'='delete_layer'
          and coalesce(v_staged_layer_ids,array[]::text[])
            @> array[a->>'id'])),
      '[]'::jsonb)
  );
  v_non_bases:=p_base_versions-coalesce(v_object_ids,array[]::text[])
    -coalesce(v_layer_update_ids,array[]::text[]);
  for v_action in
    select a from pg_catalog.jsonb_array_elements(v_non_forward->'actions') a
    where a->>'kind' like 'put\_%'
      and pg_catalog.jsonb_typeof(a->'baseVersion')='null'
  loop
    v_target_id:=(v_action->'entity'->>'id')::uuid;
    v_tombstone:=private.lukas_drawing_structure_tombstone(
      p_revision_id,v_target_id,v_action->>'kind'
    );
    if v_tombstone is not null then
      if (v_action->'entity'->>'version')::bigint
        <>(v_tombstone->>'version')::bigint then
        raise exception using errcode='P1C01',
          message='Drawing checkpoint structure tombstone is stale';
      end if;
      insert into private.lukas_drawing_checkpoint_tombstone_targets(
        transaction_id,actor_id,revision_id,entity_id,put_kind,entity
      ) values(
        pg_catalog.txid_current(),v_actor,p_revision_id,v_target_id,
        v_action->>'kind',v_action->'entity'
      );
    end if;
  end loop;
  v_staged_canvases:=private.lukas_drawing_checkpoint_stage_canvases(
    p_revision_id,p_forward->'actions',p_inverse->'actions'
  );
  for v_action in
    select a from pg_catalog.jsonb_array_elements(p_forward->'actions') a
    where a->>'kind'='put_layer'
      and pg_catalog.jsonb_typeof(a->'baseVersion')='number'
      and not exists(select 1 from public.lukas_drawing_canvases c
        where c.id=(a->'entity'->>'canvasId')::uuid
          and c.revision_id=p_revision_id)
  loop
    insert into private.lukas_drawing_checkpoint_tombstone_targets(
      transaction_id,actor_id,revision_id,entity_id,put_kind,entity
    ) values(
      pg_catalog.txid_current(),v_actor,p_revision_id,
      (v_action->'entity'->>'id')::uuid,'put_layer_deferred',
      v_action->'entity'
    );
  end loop;
  for v_action in
    select a from pg_catalog.jsonb_array_elements(p_forward->'actions') a
    where a->>'kind' in ('put_object','delete_object')
  loop
    v_target_id:=coalesce(
      (v_action->'entity'->>'id')::uuid,(v_action->>'id')::uuid
    );
    if v_action->>'kind'='put_object' and (
      not exists(select 1 from public.lukas_drawing_layers l
        where l.id=(v_action->'entity'->>'layerId')::uuid
          and l.revision_id=p_revision_id)
      or (nullif(v_action->'entity'->>'styleId','') is not null
        and not exists(select 1 from public.lukas_drawing_styles s
          where s.id=(v_action->'entity'->>'styleId')::uuid
            and s.revision_id=p_revision_id))
    ) then
      insert into private.lukas_drawing_checkpoint_tombstone_targets(
        transaction_id,actor_id,revision_id,entity_id,put_kind,entity
      ) values(
        pg_catalog.txid_current(),v_actor,p_revision_id,v_target_id,
        'put_object_deferred',v_action->'entity'
      );
    elsif v_action->>'kind'='delete_object' then
      v_tombstone:=private.lukas_drawing_structure_entity_json(
        'object',v_target_id,p_revision_id,v_revision.project_id
      );
      if v_tombstone is not null then
        insert into private.lukas_drawing_checkpoint_tombstone_targets(
          transaction_id,actor_id,revision_id,entity_id,put_kind,entity
        ) values(
          pg_catalog.txid_current(),v_actor,p_revision_id,v_target_id,
          'delete_object_current',v_tombstone
        );
      end if;
    end if;
  end loop;
  v_put_ready:=private.lukas_drawing_checkpoint_apply_objects(
    p_revision_id,p_forward->'actions',p_inverse->'actions','put_ready'
  );
  v_layer_ready:=private.lukas_drawing_checkpoint_apply_layer_updates(
    p_revision_id,p_forward->'actions',p_inverse->'actions','ready'
  );
  if pg_catalog.jsonb_array_length(v_non_forward->'actions')>0 then
    v_result:=private.lukas_drawing_apply_operation_pre_p3_activity_authority(
      p_revision_id,p_client_operation_id,'restore_checkpoint',v_non_bases,
      v_non_forward,v_non_inverse,p_history_action,p_original_operation_id
    );
    v_operation_id:=(v_result->>'operationId')::uuid;
    v_results:=v_result->'resultVersions';
  else
    select coalesce(pg_catalog.max(o.sequence),0)+1 into v_sequence
    from public.lukas_drawing_operations o where o.revision_id=p_revision_id;
    v_operation_id:=extensions.gen_random_uuid();
    v_results:='{}'::jsonb;
    insert into public.lukas_drawing_operations(
      id,revision_id,project_id,sequence,client_operation_id,operation_type,
      base_versions,forward,inverse,result_versions,actor_id,
      history_action,original_operation_id
    ) values(
      v_operation_id,p_revision_id,v_revision.project_id,v_sequence,
      p_client_operation_id,'restore_checkpoint',p_base_versions,p_forward,
      p_inverse,'{}'::jsonb,v_actor,p_history_action,p_original_operation_id
    );
    v_result:=pg_catalog.jsonb_build_object(
      'operationId',v_operation_id,'sequence',v_sequence
    );
  end if;
  v_put_deferred:=private.lukas_drawing_checkpoint_apply_objects(
    p_revision_id,p_forward->'actions',p_inverse->'actions','put_deferred'
  );
  v_layer_deferred:=private.lukas_drawing_checkpoint_apply_layer_updates(
    p_revision_id,p_forward->'actions',p_inverse->'actions','deferred'
  );
  v_delete:=private.lukas_drawing_checkpoint_apply_objects(
    p_revision_id,p_forward->'actions',p_inverse->'actions','delete'
  );
  delete from private.lukas_drawing_checkpoint_tombstone_targets t
  where t.transaction_id=pg_catalog.txid_current()
    and t.actor_id=v_actor and t.revision_id=p_revision_id;
  v_expected_bases:=v_non_bases||(v_staged_canvases->'bases')
    ||(v_layer_ready->'bases')
    ||(v_layer_deferred->'bases')||(v_put_ready->'bases')
    ||(v_put_deferred->'bases')||(v_delete->'bases');
  if v_expected_bases is distinct from p_base_versions then
    raise exception using errcode='P1C01',
      message='Drawing checkpoint base versions are not exact'; end if;
  v_results:=v_results||(v_staged_canvases->'results')
    ||(v_layer_ready->'results')
    ||(v_layer_deferred->'results')||(v_put_ready->'results')
    ||(v_put_deferred->'results')||(v_delete->'results');
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite',v_operation_id::text,true
  );
  update public.lukas_drawing_operations set
    base_versions=p_base_versions,forward=p_forward,inverse=p_inverse,
    result_versions=v_results,history_action=p_history_action,
    original_operation_id=p_original_operation_id
  where id=v_operation_id;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite','',true
  );
  v_live:=private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true);
  if private.lukas_drawing_checkpoint_structure(v_live)
    is distinct from private.lukas_drawing_checkpoint_structure(
      v_snapshot.canonical_json
    ) then raise exception using errcode='P1C01',
      message='Drawing checkpoint delta does not match its canonical snapshot';
  end if;
  return v_result||pg_catalog.jsonb_build_object('resultVersions',v_results);
end;
$$;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language sql security definer set search_path='' as $$
  select private.lukas_drawing_apply_operation(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,null::text,null::uuid
  )
$$;

alter function public.lukas_drawing_restore_approved_snapshot(uuid,uuid)
  rename to lukas_drawing_restore_approved_snapshot_pre_document_lock;

create table private.lukas_drawing_restore_capability_leases(
  transaction_id bigint not null,
  actor_id uuid not null,
  project_id uuid not null,
  primary key(transaction_id,actor_id,project_id)
);

alter function private.lukas_drawing_workspace_capability(uuid)
  rename to lukas_drawing_workspace_capability_pre_restore_lease;

create function private.lukas_drawing_workspace_capability(p_project_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case
    when private.lukas_drawing_workspace_capability_pre_restore_lease(
      p_project_id
    )='reviewer' and exists(
      select 1 from private.lukas_drawing_restore_capability_leases l
      where l.transaction_id=pg_catalog.txid_current()
        and l.actor_id=(select auth.uid()) and l.project_id=p_project_id
    ) then 'editor'
    else private.lukas_drawing_workspace_capability_pre_restore_lease(
      p_project_id
    )
  end
$$;

create function public.lukas_drawing_restore_approved_snapshot(
  p_source_revision_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_document_id uuid;
  v_project_id uuid;
  v_actor uuid:=(select auth.uid());
  v_result jsonb;
begin
  select r.document_id,r.project_id into v_document_id,v_project_id
  from public.lukas_drawing_revisions r
  where r.id=p_source_revision_id and r.status='approved'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor','reviewer');
  if not found then raise exception using errcode='P3S01',
    message='Drawing approved snapshot restore failed'; end if;
  perform 1 from public.lukas_drawing_documents d
  where d.id=v_document_id for update;
  insert into private.lukas_drawing_restore_capability_leases(
    transaction_id,actor_id,project_id
  ) values(pg_catalog.txid_current(),v_actor,v_project_id)
  on conflict do nothing;
  v_result:=public.lukas_drawing_restore_approved_snapshot_pre_document_lock(
    p_source_revision_id,p_request_id
  );
  delete from private.lukas_drawing_restore_capability_leases l
  where l.transaction_id=pg_catalog.txid_current()
    and l.actor_id=v_actor and l.project_id=v_project_id;
  return v_result;
exception when sqlstate 'P3S01' then raise;
  when others then raise exception using errcode='P3S01',
    message='Drawing approved snapshot restore failed';
end;
$$;

revoke all on function private.lukas_drawing_checkpoint_structure(jsonb),
  private.lukas_drawing_checkpoint_apply_objects(uuid,jsonb,jsonb,text),
  private.lukas_drawing_checkpoint_apply_layer_updates(uuid,jsonb,jsonb,text),
  private.lukas_drawing_checkpoint_stage_canvases(uuid,jsonb,jsonb),
  private.lukas_drawing_apply_operation_pre_p3_activity_authority(
    uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
  ),private.lukas_drawing_workspace_capability_pre_restore_lease(uuid),
  private.lukas_drawing_workspace_capability(uuid),
  public.lukas_drawing_restore_approved_snapshot_pre_document_lock(uuid,uuid),
  public.lukas_drawing_restore_approved_snapshot(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke all on table private.lukas_drawing_restore_capability_leases
  from public,anon,authenticated,service_role;
revoke all on table private.lukas_drawing_checkpoint_tombstone_targets
  from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) to authenticated,service_role;
grant execute on function private.lukas_drawing_workspace_capability_pre_restore_lease(uuid),
  private.lukas_drawing_workspace_capability(uuid)
  to authenticated,service_role;
grant execute on function public.lukas_drawing_restore_approved_snapshot(uuid,uuid)
  to authenticated,service_role;

commit;
