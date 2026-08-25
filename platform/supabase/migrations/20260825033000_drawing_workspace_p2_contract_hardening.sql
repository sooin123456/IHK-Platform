begin;

-- P2 RPCs are the only authenticated mutation boundary for structural rows.
revoke insert,update,delete on public.lukas_drawing_pages from authenticated;
revoke insert,update,delete on public.lukas_drawing_layers from authenticated;
drop policy if exists "workspace editors add draft drawing pages" on public.lukas_drawing_pages;
drop policy if exists "workspace editors update draft drawing pages" on public.lukas_drawing_pages;
drop policy if exists "workspace editors delete draft drawing pages" on public.lukas_drawing_pages;
drop policy if exists "workspace editors add draft drawing layers" on public.lukas_drawing_layers;
drop policy if exists "workspace editors update draft drawing layers" on public.lukas_drawing_layers;
drop policy if exists "workspace editors delete draft drawing layers" on public.lukas_drawing_layers;

do $$
begin
  if exists (
    select 1 from public.lukas_drawing_canvases c
    where not exists (
      select 1 from public.lukas_drawing_layers l
      where l.canvas_id=c.id and l.system_kind<>'source' and l.visible and not l.locked
    )
  ) then
    raise exception using errcode='P1C01',
      message='Every legacy drawing canvas requires an editable work layer before P2 hardening';
  end if;
end;
$$;

-- Avoid copying large TOAST values into B-tree leaf tuples.
drop index if exists public.lukas_drawing_styles_project_idx;
create index lukas_drawing_styles_project_idx
  on public.lukas_drawing_styles(project_id,revision_id,id) include (name,version);
drop index if exists public.lukas_drawing_blocks_project_idx;
create index lukas_drawing_blocks_project_idx
  on public.lukas_drawing_blocks(project_id,revision_id,id) include (name,version);
drop index if exists public.lukas_drawing_block_instances_project_idx;
create index lukas_drawing_block_instances_project_idx
  on public.lukas_drawing_block_instances(project_id,revision_id,layer_id,id)
  include (block_id,name,rotation,scale_x,scale_y,version);
drop index if exists public.lukas_drawing_property_schemas_project_idx;
create index lukas_drawing_property_schemas_project_idx
  on public.lukas_drawing_property_schemas(project_id,revision_id,id)
  include (name,value_type,required,version);
drop index if exists public.lukas_drawing_property_values_project_idx;
create index lukas_drawing_property_values_project_idx
  on public.lukas_drawing_property_values(project_id,revision_id,schema_id,id)
  include (object_id,block_instance_id,version);

-- Page-number uniqueness remains immediate by default, but the RPC can defer it
-- for a validated atomic reorder (including a two-page swap).
alter table public.lukas_drawing_pages
  drop constraint lukas_drawing_pages_revision_id_page_number_key;
alter table public.lukas_drawing_pages
  add constraint lukas_drawing_pages_revision_id_page_number_key
  unique (revision_id,page_number) deferrable initially immediate;

create or replace function private.lukas_drawing_p2_json_numbers_valid(p_value jsonb)
returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare v_item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_value)='number' then
    return pg_catalog.abs((p_value #>> '{}')::numeric)<=999999999999;
  elsif pg_catalog.jsonb_typeof(p_value)='array' then
    for v_item in select value from pg_catalog.jsonb_array_elements(p_value) loop
      if private.lukas_drawing_p2_json_numbers_valid(v_item) is not true then return false; end if;
    end loop;
  elsif pg_catalog.jsonb_typeof(p_value)='object' then
    for v_item in select value from pg_catalog.jsonb_each(p_value) loop
      if private.lukas_drawing_p2_json_numbers_valid(v_item) is not true then return false; end if;
    end loop;
  end if;
  return true;
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_p2_positive_integer(p_value jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value)='number'
    and (p_value#>>'{}')::numeric between 1 and 2147483647
    and (p_value#>>'{}')::numeric=pg_catalog.trunc((p_value#>>'{}')::numeric),false)
$$;

alter function private.lukas_drawing_structure_block_compound_valid(jsonb,uuid,uuid)
  rename to lukas_drawing_structure_block_compound_valid_pre_p2_contract_hardening;
create or replace function private.lukas_drawing_structure_block_compound_valid(
  p_actions jsonb,p_revision_id uuid,p_project_id uuid
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare
  v_block public.lukas_drawing_blocks%rowtype;
  v_instance public.lukas_drawing_block_instances%rowtype;
  v_action jsonb; v_entity jsonb; v_primitive jsonb; v_tombstone jsonb;
  v_matches integer;
begin
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind'='delete_object') then
    return private.lukas_drawing_structure_block_compound_valid_pre_p2_contract_hardening(
      p_actions,p_revision_id,p_project_id);
  end if;
  select b.* into v_block from public.lukas_drawing_blocks b
    where b.id=(select (a->>'id')::uuid from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind'='delete_block') and b.revision_id=p_revision_id and b.project_id=p_project_id;
  if not found then return false; end if;
  select i.* into v_instance from public.lukas_drawing_block_instances i
    where i.id=(select (a->>'id')::uuid from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind'='delete_block_instance') and i.revision_id=p_revision_id
      and i.project_id=p_project_id and i.block_id=v_block.id;
  if not found or pg_catalog.jsonb_array_length(v_block.primitives)<>
      (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_actions) a
        where a->>'kind'='put_object') then return false; end if;
  for v_action in select value from pg_catalog.jsonb_array_elements(p_actions)
      where value->>'kind'='put_object' loop
    v_entity:=v_action->'entity';
    v_tombstone:=private.lukas_drawing_structure_tombstone(
      p_revision_id,(v_entity->>'id')::uuid,'put_object');
    if v_tombstone is null or v_tombstone is distinct from v_entity then return false; end if;
    select pg_catalog.count(*) into v_matches
    from pg_catalog.jsonb_array_elements(v_block.primitives) p
    where p->>'name' is not distinct from v_entity->>'name'
      and v_instance.layer_id::text is not distinct from v_entity->>'layerId'
      and coalesce(p->>'styleId','') is not distinct from coalesce(v_entity->>'styleId','')
      and p->'style' is not distinct from v_entity->'style'
      and private.lukas_drawing_p2_world_geometry_matches(p->'geometry',v_entity->'geometry',
        v_instance.origin,v_instance.rotation::double precision,
        v_instance.scale_x::double precision,v_instance.scale_y::double precision) is true;
    if v_matches=0 then return false; end if;
  end loop;
  for v_primitive in select value from pg_catalog.jsonb_array_elements(v_block.primitives) loop
    select pg_catalog.count(*) into v_matches
    from pg_catalog.jsonb_array_elements(p_actions) a
    where a->>'kind'='put_object'
      and a->'entity'->>'name' is not distinct from v_primitive->>'name'
      and a->'entity'->>'layerId' is not distinct from v_instance.layer_id::text
      and coalesce(a->'entity'->>'styleId','') is not distinct from coalesce(v_primitive->>'styleId','')
      and a->'entity'->'style' is not distinct from v_primitive->'style'
      and private.lukas_drawing_p2_world_geometry_matches(v_primitive->'geometry',a->'entity'->'geometry',
        v_instance.origin,v_instance.rotation::double precision,
        v_instance.scale_x::double precision,v_instance.scale_y::double precision) is true;
    if v_matches=0 then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_property_schema_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()<=1 and (
    exists(select 1 from public.lukas_drawing_property_values v where v.schema_id=old.id)
    or exists(select 1 from public.lukas_drawing_tables t
      cross join lateral pg_catalog.jsonb_array_elements(t.columns_json) c
      where t.revision_id=old.revision_id and c->>'propertySchemaId'=old.id::text)
  ) then raise exception 'Referenced drawing property schema cannot be deleted'; end if;
  if tg_op<>'DELETE' and private.lukas_drawing_p2_property_schema_json_valid(
    new.value_type,new.enum_options,new.applies_to) is not true then
    raise exception 'Drawing property schema is invalid';
  end if;
  if tg_op='UPDATE' and exists(
    select 1 from public.lukas_drawing_property_values v
    left join public.lukas_drawing_objects o on o.id=v.object_id and o.status='active'
    left join public.lukas_drawing_block_instances i on i.id=v.block_instance_id
    where v.schema_id=old.id and (
      private.lukas_drawing_p2_property_value_valid(v.value,new.value_type,new.enum_options) is not true
      or not (new.applies_to @> pg_catalog.jsonb_build_array(
        case when v.object_id is not null then o.object_type
          when i.id is not null then 'block_instance' end))
    )
  ) then raise exception 'Drawing property schema change invalidates an existing value target'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.lukas_drawing_table_domain_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op<>'DELETE' and (
    pg_catalog.jsonb_typeof(new.columns_json)<>'array'
    or pg_catalog.jsonb_typeof(new.rows_json)<>'array'
    or exists(select 1 from pg_catalog.jsonb_array_elements(new.rows_json) r
      where not (r ?& array['id','objectId','blockInstanceId','cells'])
        or ((pg_catalog.jsonb_typeof(r->'objectId')='null') =
            (pg_catalog.jsonb_typeof(r->'blockInstanceId')='null')))
  ) then raise exception 'Drawing table row requires exactly one target'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists lukas_drawing_tables_domain_guard on public.lukas_drawing_tables;
create trigger lukas_drawing_tables_domain_guard before insert or update
  on public.lukas_drawing_tables for each row execute function private.lukas_drawing_table_domain_guard();

create or replace function private.lukas_drawing_layer_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_tombstone jsonb;
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if tg_op='INSERT' then
    if current_user='authenticated' and new.system_kind<>'custom' then
      raise exception 'Only custom drawing layers may be inserted directly'; end if;
    v_tombstone:=private.lukas_drawing_structure_tombstone(new.revision_id,new.id,'put_layer');
    if new.created_by<>v_actor or not (
      new.version=1 or (v_tombstone is not null
        and new.version=(v_tombstone->>'version')::bigint+2)
    ) then
      raise exception 'Drawing layer creator and initial version are invalid'; end if;
  elsif tg_op='DELETE' then
    if pg_catalog.pg_trigger_depth()>1 then return old; end if;
    if old.system_kind='source' then raise exception 'Source drawing layer is immutable'; end if;
    if not exists(select 1 from public.lukas_drawing_layers l where l.canvas_id=old.canvas_id
      and l.id<>old.id and l.system_kind<>'source' and l.visible and not l.locked) then
      raise exception 'At least one visible unlocked user drawing layer is required'; end if;
    return old;
  else
    if old.system_kind='source' then raise exception 'Source drawing layer is immutable'; end if;
    if new.id is distinct from old.id or new.revision_id is distinct from old.revision_id
      or new.project_id is distinct from old.project_id or new.system_kind is distinct from old.system_kind
      or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'Drawing layer identity is immutable'; end if;
    if new.version<>old.version+1 then raise exception 'Drawing layer version must increase by one'; end if;
    if new.canvas_id is distinct from old.canvas_id and not exists(
      select 1 from public.lukas_drawing_layers l where l.canvas_id=old.canvas_id
        and l.id<>old.id and l.system_kind<>'source' and l.visible and not l.locked
    ) then raise exception 'The previous canvas must retain an editable layer'; end if;
  end if;
  if not exists(select 1 from public.lukas_drawing_canvases c where c.id=new.canvas_id
    and c.page_id=new.page_id and c.revision_id=new.revision_id and c.project_id=new.project_id) then
    raise exception 'Drawing layer canvas ancestry is invalid'; end if;
  if new.system_kind='source' and (not new.locked or not new.visible) then
    raise exception 'Source drawing layer must remain visible and locked'; end if;
  if new.system_kind<>'source' and (not new.visible or new.locked)
    and not exists(select 1 from public.lukas_drawing_layers l where l.canvas_id=new.canvas_id
      and l.id<>new.id and l.system_kind<>'source' and l.visible and not l.locked) then
    raise exception 'At least one visible unlocked user drawing layer is required'; end if;
  new.updated_at:=pg_catalog.now(); return new;
end;
$$;

create or replace function private.lukas_drawing_append_only_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()>1 then return old; end if;
  if tg_op='UPDATE' and tg_table_name='lukas_drawing_operations' then
    if current_user not in ('authenticated','anon')
      and pg_catalog.current_setting('private.lukas_drawing_p2_operation_rewrite',true)=old.id::text
      and new.id=old.id and new.revision_id=old.revision_id and new.project_id=old.project_id
      and new.sequence=old.sequence and new.client_operation_id=old.client_operation_id
      and new.operation_type=old.operation_type and new.actor_id=old.actor_id
      and new.created_at=old.created_at then return new; end if;
  end if;
  raise exception '% is append-only',tg_table_name;
end;
$$;

alter function private.lukas_drawing_structure_entity_json(text,uuid,uuid,uuid)
  rename to lukas_drawing_structure_entity_json_pre_p2_contract_hardening;
create or replace function private.lukas_drawing_structure_entity_json(
  p_kind text,p_id uuid,p_revision_id uuid,p_project_id uuid
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;
begin
  if p_kind='layer' then
    select pg_catalog.jsonb_build_object('id',l.id,'name',l.name,'visible',l.visible,
      'locked',l.locked,'systemKind',l.system_kind,'canvasId',l.canvas_id,
      'sortOrder',l.sort_order,'version',l.version) into v
    from public.lukas_drawing_layers l where l.id=p_id and l.revision_id=p_revision_id
      and l.project_id=p_project_id;
    return v;
  end if;
  return private.lukas_drawing_structure_entity_json_pre_p2_contract_hardening(
    p_kind,p_id,p_revision_id,p_project_id);
end;
$$;

alter function private.lukas_drawing_structure_action_valid(jsonb,uuid)
  rename to lukas_drawing_structure_action_valid_pre_p2_contract_hardening;
create or replace function private.lukas_drawing_structure_action_valid(
  p_action jsonb,p_revision_id uuid
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare v_entity jsonb;
begin
  if private.lukas_drawing_p2_json_numbers_valid(p_action) is not true then return false; end if;
  if p_action->>'kind'='delete_layer' then
    return p_action ?& array['kind','id','baseVersion']
      and p_action-array['kind','id','baseVersion']='{}'::jsonb
      and private.lukas_drawing_p2_uuid(p_action->'id') is true
      and private.lukas_drawing_p2_positive_integer(p_action->'baseVersion') is true;
  elsif p_action->>'kind'='put_layer' then
    if not (p_action ?& array['kind','entity','baseVersion'])
      or p_action-array['kind','entity','baseVersion']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(p_action->'entity')<>'object'
      or not (pg_catalog.jsonb_typeof(p_action->'baseVersion')='null'
        or private.lukas_drawing_p2_positive_integer(p_action->'baseVersion') is true)
      then return false; end if;
    v_entity:=p_action->'entity';
    return v_entity ?& array['id','name','visible','locked','systemKind','canvasId','sortOrder','version']
      and v_entity-array['id','name','visible','locked','systemKind','canvasId','sortOrder','version']='{}'::jsonb
      and private.lukas_drawing_p2_uuid(v_entity->'id') is true
      and private.lukas_drawing_p2_uuid(v_entity->'canvasId') is true
      and private.lukas_drawing_p2_name(v_entity->'name') is true
      and pg_catalog.jsonb_typeof(v_entity->'visible')='boolean'
      and pg_catalog.jsonb_typeof(v_entity->'locked')='boolean'
      and v_entity->>'systemKind' in ('source','work','custom')
      and (v_entity->>'systemKind'<>'source'
        or ((v_entity->>'visible')::boolean and (v_entity->>'locked')::boolean))
      and pg_catalog.jsonb_typeof(v_entity->'sortOrder')='number'
      and (v_entity->>'sortOrder')::numeric between 0 and 2147483647
      and (v_entity->>'sortOrder')::numeric=pg_catalog.trunc((v_entity->>'sortOrder')::numeric)
      and private.lukas_drawing_p2_positive_integer(v_entity->'version') is true;
  elsif p_action->>'kind'='put_table' and exists(
    select 1 from pg_catalog.jsonb_array_elements(p_action->'entity'->'rows') r
    where (pg_catalog.jsonb_typeof(r->'objectId')='null') =
      (pg_catalog.jsonb_typeof(r->'blockInstanceId')='null')
  ) then
    return false;
  end if;
  return private.lukas_drawing_structure_action_valid_pre_p2_contract_hardening(
    p_action,p_revision_id);
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_apply_p2_legacy_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype;
  v_item jsonb; v_inverse_item jsonb; v_patch jsonb; v_expected_patch jsonb;
  v_object public.lukas_drawing_objects%rowtype; v_layer public.lukas_drawing_layers%rowtype;
  v_canvas public.lukas_drawing_canvases%rowtype; v_style_id uuid; v_style jsonb;
  v_target_layer public.lukas_drawing_layers%rowtype; v_id uuid; v_index integer;
  v_sequence bigint; v_operation_id uuid; v_results jsonb:='{}'::jsonb;
  v_expected_bases jsonb:='{}'::jsonb; v_expected_ids jsonb:='[]'::jsonb;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
    where r.id=p_revision_id and v_actor is not null
      and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor') for update;
  if not found then raise exception using errcode='P1R01',message='Drawing revision target is unavailable'; end if;
  if v_revision.status<>'draft' then raise exception using errcode='P1C01',message='Drawing operation requires a draft revision'; end if;

  if p_operation_type='add_objects' then
    if p_forward->>'type'<>'add_objects' or p_forward-array['type','objects']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(p_forward->'objects')<>'array'
      or pg_catalog.jsonb_array_length(p_forward->'objects')=0
      or p_inverse->>'type'<>'delete_objects' or p_inverse-array['type','objectIds']<>'{}'::jsonb
      or p_base_versions<>'{}'::jsonb then
      raise exception using errcode='P1C01',message='Drawing add_objects payload is invalid'; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(p_forward->'objects') loop
      if private.lukas_drawing_structure_action_valid(pg_catalog.jsonb_build_object(
          'kind','put_object','entity',v_item,'baseVersion',null),p_revision_id) is not true
        or (v_item->>'version')::bigint<>1 then
        raise exception using errcode='P1C01',message='Drawing object JSON is invalid'; end if;
      v_id:=(v_item->>'id')::uuid;
      if private.lukas_drawing_structure_raw_id_exists(v_id)
        or private.lukas_drawing_structure_raw_id_recorded(p_revision_id,v_id) then
        raise exception using errcode='P1C01',message='Drawing object raw ID collision'; end if;
      select * into v_layer from public.lukas_drawing_layers l
        where l.id=(v_item->>'layerId')::uuid and l.revision_id=p_revision_id
          and l.project_id=v_revision.project_id and l.system_kind<>'source'
          and l.visible and not l.locked for key share;
      if not found then raise exception using errcode='P1R01',message='Drawing layer target is unavailable'; end if;
      v_style_id:=nullif(v_item->>'styleId','')::uuid; v_style:=v_item->'style';
      if v_style_id is not null and not exists(select 1 from public.lukas_drawing_styles s
        where s.id=v_style_id and s.revision_id=p_revision_id and s.project_id=v_revision.project_id) then
        raise exception using errcode='P1R01',message='Drawing style target is unavailable'; end if;
      insert into public.lukas_drawing_objects(id,lineage_id,page_id,layer_id,revision_id,project_id,
        name,object_type,geometry,style_id,style,status,version,created_by,updated_by)
      values(v_id,v_id,v_layer.page_id,v_layer.id,p_revision_id,v_revision.project_id,v_item->>'name',
        v_item->'geometry'->>'type',v_item->'geometry',v_style_id,v_style,'active',1,v_actor,v_actor);
      v_expected_ids:=v_expected_ids||pg_catalog.jsonb_build_array(v_id);
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,1);
    end loop;
    if p_inverse->'objectIds' is distinct from v_expected_ids then
      raise exception using errcode='P1C01',message='Drawing add_objects inverse is not exact'; end if;

  elsif p_operation_type='update_objects' then
    if p_forward->>'type'<>'update_objects' or p_forward-array['type','updates']<>'{}'::jsonb
      or p_inverse->>'type'<>'update_objects' or p_inverse-array['type','updates']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(p_forward->'updates')<>'array'
      or pg_catalog.jsonb_array_length(p_forward->'updates')=0
      or pg_catalog.jsonb_array_length(p_forward->'updates')<>pg_catalog.jsonb_array_length(p_inverse->'updates') then
      raise exception using errcode='P1C01',message='Drawing update_objects payload is invalid'; end if;
    for v_index in 0..pg_catalog.jsonb_array_length(p_forward->'updates')-1 loop
      v_item:=p_forward->'updates'->v_index; v_inverse_item:=p_inverse->'updates'->v_index;
      if v_item - array['objectId','patch']::text[]<>'{}'::jsonb or not (v_item ?& array['objectId','patch'])
        or pg_catalog.jsonb_typeof(v_item->'patch')<>'object' or v_item->'patch'='{}'::jsonb
        or (v_item->'patch') - array['name','layerId','geometry','styleId','style']::text[]<>'{}'::jsonb then
        raise exception using errcode='P1C01',message='Drawing object patch is invalid'; end if;
      v_id:=(v_item->>'objectId')::uuid; v_patch:=v_item->'patch';
      select * into v_object from public.lukas_drawing_objects o where o.id=v_id
        and o.revision_id=p_revision_id and o.project_id=v_revision.project_id and o.status='active' for update;
      if not found then raise exception using errcode='P1R01',message='Drawing object target is unavailable'; end if;
      v_expected_bases:=v_expected_bases||pg_catalog.jsonb_build_object(v_id::text,v_object.version);
      v_expected_patch:='{}'::jsonb;
      if v_patch ? 'name' then
        if private.lukas_drawing_p2_name(v_patch->'name') is not true then raise exception using errcode='P1C01',message='Drawing object name is invalid'; end if;
        v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('name',v_object.name);
      end if;
      if v_patch ? 'layerId' then
        select * into v_target_layer from public.lukas_drawing_layers l
          where l.id=(v_patch->>'layerId')::uuid and l.revision_id=p_revision_id
            and l.project_id=v_revision.project_id and l.system_kind<>'source'
            and l.visible and not l.locked for key share;
        if not found then raise exception using errcode='P1R01',message='Drawing layer target is unavailable'; end if;
        v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('layerId',v_object.layer_id);
      else v_target_layer:=v_layer; v_target_layer.id:=v_object.layer_id; v_target_layer.page_id:=v_object.page_id; end if;
      if v_patch ? 'geometry' then
        if private.lukas_drawing_geometry_valid(v_patch->'geometry'->>'type',v_patch->'geometry') is not true then
          raise exception using errcode='P1C01',message='Drawing geometry is invalid'; end if;
        v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('geometry',v_object.geometry);
      end if;
      if v_patch ? 'styleId' then
        v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('styleId',v_object.style_id);
      end if;
      if v_patch ? 'style' then
        v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('style',v_object.style);
      end if;
      if v_inverse_item is distinct from pg_catalog.jsonb_build_object('objectId',v_id,'patch',v_expected_patch) then
        raise exception using errcode='P1C01',message='Drawing object inverse is not exact'; end if;
      v_style_id:=case when v_patch ? 'styleId' then nullif(v_patch->>'styleId','')::uuid else v_object.style_id end;
      v_style:=case when v_patch ? 'style' then v_patch->'style' else v_object.style end;
      if (v_style_id is null and private.lukas_drawing_style_valid(v_style) is not true)
        or (v_style_id is not null and (private.lukas_drawing_style_override_valid(v_style) is not true
          or not exists(select 1 from public.lukas_drawing_styles s where s.id=v_style_id
            and s.revision_id=p_revision_id and s.project_id=v_revision.project_id))) then
        raise exception using errcode='P1C01',message='Drawing object style is invalid'; end if;
      update public.lukas_drawing_objects set
        name=coalesce(v_patch->>'name',v_object.name),
        layer_id=coalesce(v_target_layer.id,v_object.layer_id),page_id=coalesce(v_target_layer.page_id,v_object.page_id),
        object_type=coalesce(v_patch->'geometry'->>'type',v_object.object_type),
        geometry=coalesce(v_patch->'geometry',v_object.geometry),style_id=v_style_id,style=v_style,
        version=v_object.version+1,updated_by=v_actor where id=v_id;
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,v_object.version+1);
    end loop;
    if v_expected_bases is distinct from p_base_versions then
      raise exception using errcode='P1C01',message='Drawing object base versions are incomplete'; end if;

  elsif p_operation_type='add_layer' then
    v_item:=p_forward->'layer';
    if p_forward->>'type'<>'add_layer' or p_forward-array['type','layer']<>'{}'::jsonb
      or p_inverse<>'{}'::jsonb or p_base_versions<>'{}'::jsonb
      or v_item-array['id','name','visible','locked','canvasId','sortOrder','version']<>'{}'::jsonb
      or not (v_item ?& array['id','name','visible','locked','canvasId','sortOrder','version'])
      or private.lukas_drawing_p2_uuid(v_item->'id') is not true
      or private.lukas_drawing_p2_uuid(v_item->'canvasId') is not true
      or private.lukas_drawing_p2_name(v_item->'name') is not true
      or private.lukas_drawing_p2_positive_integer(v_item->'version') is not true
      or (v_item->>'version')::integer<>1
      or pg_catalog.jsonb_typeof(v_item->'sortOrder')<>'number'
      or (v_item->>'sortOrder')::numeric not between 0 and 2147483647 then
      raise exception using errcode='P1C01',message='Drawing add_layer payload is invalid'; end if;
    v_id:=(v_item->>'id')::uuid;
    if private.lukas_drawing_structure_raw_id_exists(v_id)
      or private.lukas_drawing_structure_raw_id_recorded(p_revision_id,v_id) then
      raise exception using errcode='P1C01',message='Drawing layer raw ID collision'; end if;
    select * into v_canvas from public.lukas_drawing_canvases c where c.id=(v_item->>'canvasId')::uuid
      and c.revision_id=p_revision_id and c.project_id=v_revision.project_id for key share;
    if not found then raise exception using errcode='P1R01',message='Drawing canvas target is unavailable'; end if;
    insert into public.lukas_drawing_layers(id,page_id,canvas_id,revision_id,project_id,name,sort_order,
      visible,locked,system_kind,version,created_by)
    values(v_id,v_canvas.page_id,v_canvas.id,p_revision_id,v_revision.project_id,v_item->>'name',
      (v_item->>'sortOrder')::integer,(v_item->>'visible')::boolean,(v_item->>'locked')::boolean,
      'custom',1,v_actor);
    v_results:=pg_catalog.jsonb_build_object(v_id::text,1);

  elsif p_operation_type='update_layer' then
    v_id:=(p_forward->>'layerId')::uuid; v_patch:=p_forward->'patch';
    if p_forward->>'type'<>'update_layer' or p_forward-array['type','layerId','patch']<>'{}'::jsonb
      or p_inverse->>'type'<>'update_layer' or p_inverse-array['type','layerId','patch']<>'{}'::jsonb
      or p_inverse->>'layerId'<>v_id::text or pg_catalog.jsonb_typeof(v_patch)<>'object'
      or v_patch='{}'::jsonb or v_patch-array['name','visible','locked','canvasId','sortOrder']<>'{}'::jsonb then
      raise exception using errcode='P1C01',message='Drawing update_layer payload is invalid'; end if;
    select * into v_layer from public.lukas_drawing_layers l where l.id=v_id
      and l.revision_id=p_revision_id and l.project_id=v_revision.project_id for update;
    if not found then raise exception using errcode='P1R01',message='Drawing layer target is unavailable'; end if;
    if v_layer.system_kind='source' then raise exception using errcode='P1C01',message='Source drawing layer is immutable'; end if;
    v_expected_bases:=pg_catalog.jsonb_build_object(v_id::text,v_layer.version);
    if v_expected_bases is distinct from p_base_versions then raise exception using errcode='P1C01',message='Drawing layer base version conflict'; end if;
    v_expected_patch:='{}'::jsonb;
    if v_patch ? 'name' then v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('name',v_layer.name); end if;
    if v_patch ? 'visible' then v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('visible',v_layer.visible); end if;
    if v_patch ? 'locked' then v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('locked',v_layer.locked); end if;
    if v_patch ? 'canvasId' then v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('canvasId',v_layer.canvas_id); end if;
    if v_patch ? 'sortOrder' then v_expected_patch:=v_expected_patch||pg_catalog.jsonb_build_object('sortOrder',v_layer.sort_order); end if;
    if p_inverse->'patch' is distinct from v_expected_patch then raise exception using errcode='P1C01',message='Drawing layer inverse is not exact'; end if;
    select * into v_canvas from public.lukas_drawing_canvases c
      where c.id=coalesce(nullif(v_patch->>'canvasId','')::uuid,v_layer.canvas_id)
        and c.revision_id=p_revision_id and c.project_id=v_revision.project_id for key share;
    if not found then raise exception using errcode='P1R01',message='Drawing canvas target is unavailable'; end if;
    update public.lukas_drawing_layers set page_id=v_canvas.page_id,canvas_id=v_canvas.id,
      name=coalesce(v_patch->>'name',v_layer.name),visible=coalesce((v_patch->>'visible')::boolean,v_layer.visible),
      locked=coalesce((v_patch->>'locked')::boolean,v_layer.locked),
      sort_order=coalesce((v_patch->>'sortOrder')::integer,v_layer.sort_order),version=v_layer.version+1
      where id=v_id;
    v_results:=pg_catalog.jsonb_build_object(v_id::text,v_layer.version+1);
  else
    raise exception using errcode='P1C01',message='Unsupported P2 legacy operation';
  end if;

  select coalesce(pg_catalog.max(o.sequence),0)+1 into v_sequence
    from public.lukas_drawing_operations o where o.revision_id=p_revision_id;
  insert into public.lukas_drawing_operations(revision_id,project_id,sequence,client_operation_id,
    operation_type,base_versions,forward,inverse,result_versions,actor_id)
  values(p_revision_id,v_revision.project_id,v_sequence,p_client_operation_id,p_operation_type,
    p_base_versions,p_forward,p_inverse,v_results,v_actor) returning id into v_operation_id;
  return pg_catalog.jsonb_build_object('operationId',v_operation_id,'sequence',v_sequence,
    'resultVersions',v_results);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation or not_null_violation
    or numeric_value_out_of_range or invalid_text_representation then
    raise exception using errcode='P1C01',message=sqlerrm;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

alter function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  rename to lukas_drawing_apply_operation_pre_p2_contract_hardening;
create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_project_id uuid;
  v_existing public.lukas_drawing_operations%rowtype; v_result jsonb;
  v_forward jsonb; v_inverse jsonb; v_bases jsonb; v_results jsonb;
  v_action jsonb; v_inverse_action jsonb; v_entity jsonb; v_previous jsonb;
  v_expected jsonb; v_tombstone jsonb; v_id uuid; v_canvas_id uuid;
  v_new_version bigint; v_index integer; v_count integer; v_page_id uuid;
begin
  select r.project_id into v_project_id from public.lukas_drawing_revisions r
    where r.id=p_revision_id and v_actor is not null
      and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor') for update;
  if not found then raise exception using errcode='P1R01',message='Drawing revision target is unavailable'; end if;
  select o.* into v_existing from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
      or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions
      or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse then
      raise exception using errcode='P1C01',message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object('operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions);
  end if;
  if private.lukas_drawing_p2_json_numbers_valid(p_base_versions) is not true
    or private.lukas_drawing_p2_json_numbers_valid(p_forward) is not true
    or private.lukas_drawing_p2_json_numbers_valid(p_inverse) is not true then
    raise exception using errcode='P1C01',message='Drawing numeric value is outside the supported range';
  end if;

  if p_operation_type<>'mutate_structure' then
    if (p_operation_type='add_objects' and exists(
          select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') o where o ? 'styleId'))
      or (p_operation_type='update_objects' and exists(
          select 1 from pg_catalog.jsonb_array_elements(p_forward->'updates') u
          where u->'patch' ? 'styleId'
            or (u->'patch' ? 'style' and private.lukas_drawing_style_valid(u->'patch'->'style') is not true)))
      or (p_operation_type='add_layer' and p_forward->'layer' ? 'canvasId')
      or (p_operation_type='update_layer' and
          (p_forward->'patch' ? 'canvasId' or p_forward->'patch' ? 'sortOrder')) then
      return private.lukas_drawing_apply_p2_legacy_operation(
        p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
    end if;
    return private.lukas_drawing_apply_operation_pre_p2_contract_hardening(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
  end if;
  select r.project_id into v_project_id from public.lukas_drawing_revisions r
    where r.id=p_revision_id and v_actor is not null
      and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor') for update;
  if not found then raise exception using errcode='P1R01',message='Drawing revision target is unavailable'; end if;
  if pg_catalog.jsonb_typeof(p_forward)<>'object' or pg_catalog.jsonb_typeof(p_inverse)<>'object'
    or p_forward->>'type'<>'mutate_structure' or p_inverse->>'type'<>'mutate_structure'
    or pg_catalog.jsonb_typeof(p_forward->'actions')<>'array'
    or pg_catalog.jsonb_typeof(p_inverse->'actions')<>'array'
    or pg_catalog.jsonb_array_length(p_forward->'actions')
      <>pg_catalog.jsonb_array_length(p_inverse->'actions') then
    raise exception using errcode='P1C01',message='Drawing structure payload is invalid';
  end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
    where private.lukas_drawing_structure_action_valid(a,p_revision_id) is not true) then
    raise exception using errcode='P1C01',message='Drawing structure action JSON is invalid'; end if;
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
    join public.lukas_drawing_property_values v on v.schema_id=(a->'entity'->>'id')::uuid
    left join public.lukas_drawing_objects o on o.id=v.object_id and o.status='active'
    left join public.lukas_drawing_block_instances i on i.id=v.block_instance_id
    where a->>'kind'='put_property_schema' and pg_catalog.jsonb_typeof(a->'baseVersion')='number'
      and not (a->'entity'->'appliesTo' @> pg_catalog.jsonb_build_array(
        case when v.object_id is not null then o.object_type
          when i.id is not null then 'block_instance' end))
  ) then raise exception using errcode='P1C01',
    message='Drawing property schema change invalidates an existing value target'; end if;

  -- Every fresh canvas names its exact editable layer, and every deleted canvas
  -- records every child layer before the FK cascade executes.
  for v_action in select value from pg_catalog.jsonb_array_elements(p_forward->'actions') loop
    if v_action->>'kind'='put_canvas' and pg_catalog.jsonb_typeof(v_action->'baseVersion')='null' then
      v_canvas_id:=(v_action->'entity'->>'id')::uuid;
      select pg_catalog.count(*) into v_count from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where a->>'kind'='put_layer' and a->'entity'->>'canvasId'=v_canvas_id::text
          and a->'entity'->>'systemKind'<>'source' and (a->'entity'->>'visible')::boolean
          and not (a->'entity'->>'locked')::boolean;
      if v_count<>1 then raise exception using errcode='P1C01',
        message='A fresh canvas requires exactly one recorded editable layer'; end if;
    elsif v_action->>'kind'='delete_canvas' then
      v_canvas_id:=(v_action->>'id')::uuid;
      if exists(select 1 from public.lukas_drawing_layers l where l.canvas_id=v_canvas_id
        and not exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
          where a->>'kind'='delete_layer' and a->>'id'=l.id::text and
            (a->>'baseVersion')::bigint=l.version)) then
        raise exception using errcode='P1C01',message='Canvas deletion must record every child layer';
      end if;
      select pg_catalog.count(*) into v_count from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where a->>'kind'='delete_layer' and exists(select 1 from public.lukas_drawing_layers l
          where l.id=(a->>'id')::uuid and l.canvas_id=v_canvas_id);
      if v_count<>(select pg_catalog.count(*) from public.lukas_drawing_layers l where l.canvas_id=v_canvas_id) then
        raise exception using errcode='P1C01',message='Canvas deletion contains an unrelated layer action'; end if;
    end if;
  end loop;

  -- Validate each layer action and its exact reverse-position inverse.
  v_count:=pg_catalog.jsonb_array_length(p_forward->'actions');
  for v_index in 0..v_count-1 loop
    v_action:=p_forward->'actions'->v_index;
    if v_action->>'kind' not in ('put_layer','delete_layer') then continue; end if;
    v_inverse_action:=p_inverse->'actions'->(v_count-v_index-1);
    v_id:=coalesce((v_action->'entity'->>'id')::uuid,(v_action->>'id')::uuid);
    v_previous:=private.lukas_drawing_structure_entity_json('layer',v_id,p_revision_id,v_project_id);
    if v_action->>'kind'='put_layer' then
      v_entity:=v_action->'entity';
      if pg_catalog.jsonb_typeof(v_action->'baseVersion')='null' then
        if v_previous is not null then raise exception using errcode='P1C01',message='Drawing layer already exists'; end if;
        v_tombstone:=private.lukas_drawing_structure_tombstone(p_revision_id,v_id,'put_layer');
        if v_tombstone is null then
          if private.lukas_drawing_structure_raw_id_exists(v_id)
            or private.lukas_drawing_structure_raw_id_recorded(p_revision_id,v_id)
            or (v_entity->>'version')::bigint<>1 then
            raise exception using errcode='P1C01',message='Drawing structure raw ID collision'; end if;
          v_new_version:=1;
        else
          if v_entity is distinct from v_tombstone then raise exception using errcode='P1C01',
            message='Drawing structure restore must match the exact tombstone'; end if;
          v_new_version:=(v_tombstone->>'version')::bigint+2;
        end if;
        v_expected:=pg_catalog.jsonb_build_object('kind','delete_layer','id',v_id,'baseVersion',v_new_version);
      else
        raise exception using errcode='P1C01',message='Layer updates use the update_layer operation';
      end if;
    else
      if v_previous is null or (v_previous->>'version')::bigint<>(v_action->>'baseVersion')::bigint then
        raise exception using errcode='P1C01',message='Drawing structure layer base version conflict'; end if;
      if not exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where a->>'kind'='delete_canvas' and a->>'id'=v_previous->>'canvasId') then
        raise exception using errcode='P1C01',message='Layer deletion must accompany its canvas deletion'; end if;
      v_new_version:=(v_previous->>'version')::bigint+1;
      v_expected:=pg_catalog.jsonb_build_object('kind','put_layer','entity',v_previous,'baseVersion',null);
    end if;
    if v_inverse_action is distinct from v_expected then
      raise exception using errcode='P1C01',message='Drawing structure layer inverse is not exact'; end if;
  end loop;

  v_forward:=pg_catalog.jsonb_build_object('type','mutate_structure','actions',
    coalesce((select pg_catalog.jsonb_agg(a order by ord) from
      pg_catalog.jsonb_array_elements(p_forward->'actions') with ordinality x(a,ord)
      where a->>'kind' not in ('put_layer','delete_layer')),'[]'::jsonb));
  v_inverse:=pg_catalog.jsonb_build_object('type','mutate_structure','actions',
    coalesce((select pg_catalog.jsonb_agg(a order by ord) from
      pg_catalog.jsonb_array_elements(p_inverse->'actions') with ordinality x(a,ord)
      where a->>'kind' not in ('put_layer','delete_layer')),'[]'::jsonb));
  v_bases:=coalesce((select pg_catalog.jsonb_object_agg(k,v) from pg_catalog.jsonb_each(p_base_versions) e(k,v)
    where not exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind'='delete_layer' and a->>'id'=k)),'{}'::jsonb);
  if pg_catalog.jsonb_array_length(v_forward->'actions')=0 then
    raise exception using errcode='P1C01',message='Layer actions must accompany a canvas action'; end if;
  if (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_forward->'actions') a
      where a->>'kind'='put_page')>1 then
    set constraints all deferred;
  end if;
  v_result:=private.lukas_drawing_apply_operation_pre_p2_contract_hardening(
    p_revision_id,p_client_operation_id,p_operation_type,v_bases,v_forward,v_inverse);
  v_results:=v_result->'resultVersions';

  -- Replace the pre-hardening canvas helper row with the exact recorded layer.
  for v_action in select value from pg_catalog.jsonb_array_elements(p_forward->'actions') loop
    if v_action->>'kind'='put_layer' then
      v_entity:=v_action->'entity'; v_id:=(v_entity->>'id')::uuid;
      select c.page_id into v_page_id from public.lukas_drawing_canvases c
        where c.id=(v_entity->>'canvasId')::uuid and c.revision_id=p_revision_id;
      if not found then raise exception using errcode='P1R01',message='Drawing layer canvas is unavailable'; end if;
      v_tombstone:=private.lukas_drawing_structure_tombstone(p_revision_id,v_id,'put_layer');
      v_new_version:=case when v_tombstone is null then 1 else (v_tombstone->>'version')::bigint+2 end;
      insert into public.lukas_drawing_layers(id,page_id,canvas_id,revision_id,project_id,name,sort_order,
        visible,locked,system_kind,version,created_by)
      values(v_id,v_page_id,(v_entity->>'canvasId')::uuid,p_revision_id,v_project_id,v_entity->>'name',
        (v_entity->>'sortOrder')::integer,(v_entity->>'visible')::boolean,(v_entity->>'locked')::boolean,
        v_entity->>'systemKind',v_new_version,v_actor);
      delete from public.lukas_drawing_layers l where l.canvas_id=(v_entity->>'canvasId')::uuid
        and l.id<>v_id and l.name='P2 '||pg_catalog.left((v_entity->>'canvasId'),8);
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,v_new_version);
    elsif v_action->>'kind'='delete_layer' then
      v_results:=v_results||pg_catalog.jsonb_build_object(v_action->>'id',null);
    end if;
  end loop;
  perform pg_catalog.set_config('private.lukas_drawing_p2_operation_rewrite',
    (v_result->>'operationId'),true);
  update public.lukas_drawing_operations set base_versions=p_base_versions,forward=p_forward,
    inverse=p_inverse,result_versions=v_results where revision_id=p_revision_id
      and client_operation_id=p_client_operation_id;
  return v_result||pg_catalog.jsonb_build_object('resultVersions',v_results);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when numeric_value_out_of_range or invalid_text_representation then
    raise exception using errcode='P1C01',message='Drawing numeric value is outside the supported range';
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create or replace function private.lukas_drawing_clone_document_source_clear()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if pg_catalog.current_setting('private.lukas_drawing_p2_clone_source_revision',true)<>''
    and current_user not in ('authenticated','anon') then
    new.source_file_id:=null; new.source_sha256:=null;
  end if;
  return new;
end;
$$;
drop trigger if exists lukas_drawing_documents_clone_source_clear on public.lukas_drawing_documents;
create trigger lukas_drawing_documents_clone_source_clear before insert
  on public.lukas_drawing_documents for each row
  execute function private.lukas_drawing_clone_document_source_clear();

alter function private.lukas_drawing_create_from_template(uuid,text,uuid)
  rename to lukas_drawing_create_from_template_pre_p2_contract_hardening;
create or replace function private.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb;
begin
  perform pg_catalog.set_config('private.lukas_drawing_p2_clone_source_revision',
    p_source_revision_id::text,true);
  v_result:=private.lukas_drawing_create_from_template_pre_p2_contract_hardening(
    p_source_revision_id,p_title,p_source_file_id);
  perform pg_catalog.set_config('private.lukas_drawing_p2_clone_source_revision','',true);
  return v_result;
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when numeric_value_out_of_range or invalid_text_representation then
    raise exception using errcode='P1C01',message='Drawing numeric value is outside the supported range';
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

-- Review is rejected before hashing if any legacy or newly-mutated structural
-- invariant is incomplete.
alter function private.lukas_drawing_request_review(uuid)
  rename to lukas_drawing_request_review_pre_p2_contract_hardening;
create or replace function private.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
begin
  perform 1 from public.lukas_drawing_revisions r where r.id=p_revision_id
    and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor') for update;
  if not found then raise exception using errcode='P1R01',message='Drawing revision target is unavailable'; end if;
  if exists(select 1 from public.lukas_drawing_pages p where p.revision_id=p_revision_id and (
      (select pg_catalog.count(*) from public.lukas_drawing_canvases c where c.page_id=p.id)=0
      or (select pg_catalog.count(*) from public.lukas_drawing_canvases c
        where c.page_id=p.id and c.space_kind='paper' and c.sort_order=0)<>1))
    or exists(select 1 from public.lukas_drawing_canvases c where c.revision_id=p_revision_id
      and not exists(select 1 from public.lukas_drawing_layers l where l.canvas_id=c.id
        and l.system_kind<>'source' and l.visible and not l.locked)) then
    raise exception using errcode='P1C01',message='Drawing review requires complete page, canvas, and editable-layer invariants';
  end if;
  return private.lukas_drawing_request_review_pre_p2_contract_hardening(p_revision_id);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

revoke all on function private.lukas_drawing_p2_json_numbers_valid(jsonb),
  private.lukas_drawing_table_domain_guard(),
  private.lukas_drawing_structure_block_compound_valid_pre_p2_contract_hardening(jsonb,uuid,uuid),
  private.lukas_drawing_structure_entity_json_pre_p2_contract_hardening(text,uuid,uuid,uuid),
  private.lukas_drawing_structure_action_valid_pre_p2_contract_hardening(jsonb,uuid),
  private.lukas_drawing_apply_p2_legacy_operation(uuid,uuid,text,jsonb,jsonb,jsonb),
  private.lukas_drawing_apply_operation_pre_p2_contract_hardening(uuid,uuid,text,jsonb,jsonb,jsonb),
  private.lukas_drawing_clone_document_source_clear(),
  private.lukas_drawing_create_from_template_pre_p2_contract_hardening(uuid,text,uuid),
  private.lukas_drawing_request_review_pre_p2_contract_hardening(uuid)
from public,anon,authenticated;
revoke all on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  from public,anon;
grant execute on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  to authenticated,service_role;
revoke all on function private.lukas_drawing_create_from_template(uuid,text,uuid) from public,anon;
grant execute on function private.lukas_drawing_create_from_template(uuid,text,uuid)
  to authenticated,service_role;
grant execute on function private.lukas_drawing_request_review(uuid) to authenticated,service_role;

commit;
