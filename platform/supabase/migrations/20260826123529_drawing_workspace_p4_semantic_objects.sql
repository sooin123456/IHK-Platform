begin;

alter table public.lukas_drawing_objects
  drop constraint if exists lukas_drawing_objects_object_type_check;
alter table public.lukas_drawing_objects
  add constraint lukas_drawing_objects_object_type_check check (
    object_type in (
      'line','polyline','rectangle','circle','text','dimension',
      'wall','opening','space','area','grid','arc'
    )
  );

create function private.lukas_drawing_p4_number_valid(p_value jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value)='number'
    and pg_catalog.abs((p_value#>>'{}')::numeric)<=9000000000
    and (p_value#>>'{}')::numeric*1000000
      =pg_catalog.trunc((p_value#>>'{}')::numeric*1000000),
    false
  )
$$;

create function private.lukas_drawing_p4_point_valid(p_value jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value)='object'
    and p_value ?& array['x','y']
    and p_value-array['x','y']='{}'::jsonb
    and private.lukas_drawing_p4_number_valid(p_value->'x')
    and private.lukas_drawing_p4_number_valid(p_value->'y'),
    false
  )
$$;

create function private.lukas_drawing_p4_segments_intersect(
  p_a jsonb,p_b jsonb,p_c jsonb,p_d jsonb
) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
  v_ax numeric:=(p_a->>'x')::numeric*1000000;
  v_ay numeric:=(p_a->>'y')::numeric*1000000;
  v_bx numeric:=(p_b->>'x')::numeric*1000000;
  v_by numeric:=(p_b->>'y')::numeric*1000000;
  v_cx numeric:=(p_c->>'x')::numeric*1000000;
  v_cy numeric:=(p_c->>'y')::numeric*1000000;
  v_dx numeric:=(p_d->>'x')::numeric*1000000;
  v_dy numeric:=(p_d->>'y')::numeric*1000000;
  abc numeric; abd numeric; cda numeric; cdb numeric;
begin
  abc:=(v_bx-v_ax)*(v_cy-v_ay)-(v_by-v_ay)*(v_cx-v_ax);
  abd:=(v_bx-v_ax)*(v_dy-v_ay)-(v_by-v_ay)*(v_dx-v_ax);
  cda:=(v_dx-v_cx)*(v_ay-v_cy)-(v_dy-v_cy)*(v_ax-v_cx);
  cdb:=(v_dx-v_cx)*(v_by-v_cy)-(v_dy-v_cy)*(v_bx-v_cx);
  if ((abc<0 and abd>0) or (abc>0 and abd<0))
    and ((cda<0 and cdb>0) or (cda>0 and cdb<0)) then
    return true;
  end if;
  return (abc=0 and v_cx between least(v_ax,v_bx) and greatest(v_ax,v_bx)
      and v_cy between least(v_ay,v_by) and greatest(v_ay,v_by))
    or (abd=0 and v_dx between least(v_ax,v_bx) and greatest(v_ax,v_bx)
      and v_dy between least(v_ay,v_by) and greatest(v_ay,v_by))
    or (cda=0 and v_ax between least(v_cx,v_dx) and greatest(v_cx,v_dx)
      and v_ay between least(v_cy,v_dy) and greatest(v_cy,v_dy))
    or (cdb=0 and v_bx between least(v_cx,v_dx) and greatest(v_cx,v_dx)
      and v_by between least(v_cy,v_dy) and greatest(v_cy,v_dy));
exception when others then return false;
end;
$$;

create function private.lukas_drawing_p4_boundary_valid(p_boundary jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
  v_count integer; v_first integer; v_second integer;
  v_point jsonb; v_next jsonb; v_area numeric:=0;
begin
  if pg_catalog.jsonb_typeof(p_boundary)<>'array' then return false; end if;
  v_count:=pg_catalog.jsonb_array_length(p_boundary);
  if v_count not between 3 and 4096 then return false; end if;
  for v_first in 0..v_count-1 loop
    v_point:=p_boundary->v_first;
    v_next:=p_boundary->((v_first+1)%v_count);
    if private.lukas_drawing_p4_point_valid(v_point) is not true
      or v_point=v_next then return false; end if;
    v_area:=v_area
      +(v_point->>'x')::numeric*(v_next->>'y')::numeric
      -(v_next->>'x')::numeric*(v_point->>'y')::numeric;
  end loop;
  if v_area=0 then return false; end if;
  for v_first in 0..v_count-1 loop
    for v_second in v_first+1..v_count-1 loop
      if (v_first+1)%v_count=v_second
        or (v_second+1)%v_count=v_first then continue; end if;
      if private.lukas_drawing_p4_segments_intersect(
        p_boundary->v_first,p_boundary->((v_first+1)%v_count),
        p_boundary->v_second,p_boundary->((v_second+1)%v_count)
      ) then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;

alter function private.lukas_drawing_geometry_valid(text,jsonb)
  rename to lukas_drawing_geometry_valid_pre_p4_semantic_objects;
create function private.lukas_drawing_geometry_valid(
  p_object_type text,p_geometry jsonb
) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_finishes jsonb;
begin
  if p_object_type in ('line','polyline','rectangle','circle','text','dimension') then
    return private.lukas_drawing_geometry_valid_pre_p4_semantic_objects(
      p_object_type,p_geometry
    );
  end if;
  if pg_catalog.jsonb_typeof(p_geometry)<>'object'
    or p_geometry->>'type' is distinct from p_object_type
    or p_geometry->>'semanticVersion' is distinct from '1'
    or pg_catalog.jsonb_typeof(p_geometry->'semanticVersion')<>'number' then
    return false;
  end if;
  if p_object_type='wall' then
    return p_geometry ?& array[
        'type','semanticVersion','start','end','thicknessMillimeters','heightMillimeters'
      ] and p_geometry-array[
        'type','semanticVersion','start','end','thicknessMillimeters','heightMillimeters'
      ]='{}'::jsonb
      and private.lukas_drawing_p4_point_valid(p_geometry->'start')
      and private.lukas_drawing_p4_point_valid(p_geometry->'end')
      and p_geometry->'start'<>p_geometry->'end'
      and private.lukas_drawing_p4_number_valid(p_geometry->'thicknessMillimeters')
      and (p_geometry->>'thicknessMillimeters')::numeric>0
      and private.lukas_drawing_p4_number_valid(p_geometry->'heightMillimeters')
      and (p_geometry->>'heightMillimeters')::numeric>0;
  elsif p_object_type='opening' then
    return p_geometry ?& array[
        'type','semanticVersion','hostWallId','offsetMillimeters','widthMillimeters',
        'heightMillimeters','sillHeightMillimeters','openingKind'
      ] and p_geometry-array[
        'type','semanticVersion','hostWallId','offsetMillimeters','widthMillimeters',
        'heightMillimeters','sillHeightMillimeters','openingKind'
      ]='{}'::jsonb
      and private.lukas_drawing_p2_uuid(p_geometry->'hostWallId')
      and private.lukas_drawing_p4_number_valid(p_geometry->'offsetMillimeters')
      and (p_geometry->>'offsetMillimeters')::numeric>=0
      and private.lukas_drawing_p4_number_valid(p_geometry->'widthMillimeters')
      and (p_geometry->>'widthMillimeters')::numeric>0
      and private.lukas_drawing_p4_number_valid(p_geometry->'heightMillimeters')
      and (p_geometry->>'heightMillimeters')::numeric>0
      and private.lukas_drawing_p4_number_valid(p_geometry->'sillHeightMillimeters')
      and (p_geometry->>'sillHeightMillimeters')::numeric>=0
      and p_geometry->>'openingKind' in ('door','window','void')
      and (p_geometry->>'openingKind'<>'door'
        or (p_geometry->>'sillHeightMillimeters')::numeric=0);
  elsif p_object_type in ('space','area') then
    if p_object_type='space' then
      if not (p_geometry ?& array['type','semanticVersion','boundary','number','finishes'])
        or p_geometry-array['type','semanticVersion','boundary','number','finishes']<>'{}'::jsonb
        or pg_catalog.jsonb_typeof(p_geometry->'number')<>'string'
        or pg_catalog.char_length(p_geometry->>'number')>255 then return false; end if;
      v_finishes:=p_geometry->'finishes';
      if pg_catalog.jsonb_typeof(v_finishes)<>'object'
        or not (v_finishes ?& array['floor','wall','ceiling'])
        or v_finishes-array['floor','wall','ceiling']<>'{}'::jsonb
        or exists(select 1 from pg_catalog.jsonb_each(v_finishes) x
          where pg_catalog.jsonb_typeof(x.value) not in ('null','string')
            or (pg_catalog.jsonb_typeof(x.value)='string'
              and pg_catalog.char_length(x.value#>>'{}')>255)) then return false; end if;
    elsif not (p_geometry ?& array['type','semanticVersion','boundary'])
      or p_geometry-array['type','semanticVersion','boundary']<>'{}'::jsonb then
      return false;
    end if;
    return private.lukas_drawing_p4_boundary_valid(p_geometry->'boundary');
  elsif p_object_type='grid' then
    return p_geometry ?& array['type','semanticVersion','start','end']
      and p_geometry-array['type','semanticVersion','start','end']='{}'::jsonb
      and private.lukas_drawing_p4_point_valid(p_geometry->'start')
      and private.lukas_drawing_p4_point_valid(p_geometry->'end')
      and p_geometry->'start'<>p_geometry->'end';
  elsif p_object_type='arc' then
    return p_geometry ?& array[
        'type','semanticVersion','center','radius','startAngleDegrees','sweepAngleDegrees'
      ] and p_geometry-array[
        'type','semanticVersion','center','radius','startAngleDegrees','sweepAngleDegrees'
      ]='{}'::jsonb
      and private.lukas_drawing_p4_point_valid(p_geometry->'center')
      and private.lukas_drawing_p4_number_valid(p_geometry->'radius')
      and (p_geometry->>'radius')::numeric>0
      and private.lukas_drawing_p4_number_valid(p_geometry->'startAngleDegrees')
      and private.lukas_drawing_p4_number_valid(p_geometry->'sweepAngleDegrees')
      and (p_geometry->>'sweepAngleDegrees')::numeric<>0
      and pg_catalog.abs((p_geometry->>'sweepAngleDegrees')::numeric)<=360;
  end if;
  return false;
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_p2_property_schema_json_valid(
  p_value_type text,p_enum_options jsonb,p_applies_to jsonb
) returns boolean language sql immutable security invoker set search_path='' as $$
  select coalesce(
    p_value_type in ('text','number','boolean','date','enum')
    and pg_catalog.jsonb_typeof(p_enum_options)='array'
    and not exists(select 1 from pg_catalog.jsonb_array_elements(p_enum_options) v
      where private.lukas_drawing_p2_name(v) is not true)
    and ((p_value_type='enum' and pg_catalog.jsonb_array_length(p_enum_options)>0)
      or (p_value_type<>'enum' and p_enum_options='[]'::jsonb))
    and pg_catalog.jsonb_typeof(p_applies_to)='array'
    and pg_catalog.jsonb_array_length(p_applies_to)>0
    and not exists(select 1 from pg_catalog.jsonb_array_elements_text(p_applies_to) v
      where v not in (
        'line','polyline','rectangle','circle','text','dimension',
        'wall','opening','space','area','grid','arc','block_instance'
      ))
    and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(p_applies_to))
      =(select pg_catalog.count(distinct v) from pg_catalog.jsonb_array_elements_text(p_applies_to) v),
    false
  )
$$;

create or replace function private.lukas_drawing_p2_block_primitives_valid(
  p_primitives jsonb,p_revision_id uuid,p_project_id uuid
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare v_item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_primitives)<>'array'
    or pg_catalog.jsonb_array_length(p_primitives)=0
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_primitives) item
      group by item->>'localId' having pg_catalog.count(*)>1) then return false; end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_primitives) loop
    if pg_catalog.jsonb_typeof(v_item)<>'object'
      or not (v_item ?& array['localId','name','geometry','styleId','style'])
      or v_item-array['localId','name','geometry','styleId','style']<>'{}'::jsonb
      or v_item->'geometry'->>'type' not in ('line','polyline','rectangle','circle','text','dimension')
      or pg_catalog.jsonb_typeof(v_item->'localId')<>'string'
      or pg_catalog.char_length(v_item->>'localId') not between 1 and 255
      or private.lukas_drawing_p2_name(v_item->'name') is not true
      or private.lukas_drawing_geometry_valid(v_item->'geometry'->>'type',v_item->'geometry') is not true
      or not ((pg_catalog.jsonb_typeof(v_item->'styleId')='null'
          and private.lukas_drawing_style_valid(v_item->'style') is true)
        or (private.lukas_drawing_p2_uuid(v_item->'styleId') is true
          and private.lukas_drawing_style_override_valid(v_item->'style') is true
          and exists(select 1 from public.lukas_drawing_styles s
            where s.id=(v_item->>'styleId')::uuid
              and s.revision_id=p_revision_id and s.project_id=p_project_id))) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

alter function private.lukas_drawing_structure_action_valid(jsonb,uuid)
  rename to lukas_drawing_structure_action_valid_pre_p4_semantic_objects;
create function private.lukas_drawing_structure_action_valid(
  p_action jsonb,p_revision_id uuid
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare v_entity jsonb;
begin
  if p_action->>'kind'<>'put_object'
    or p_action->'entity'->'geometry'->>'type'
      not in ('wall','opening','space','area','grid','arc') then
    return private.lukas_drawing_structure_action_valid_pre_p4_semantic_objects(
      p_action,p_revision_id
    );
  end if;
  if private.lukas_drawing_p2_json_numbers_valid(p_action) is not true
    or not (p_action ?& array['kind','entity','baseVersion'])
    or p_action-array['kind','entity','baseVersion']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(p_action->'entity')<>'object'
    or not (pg_catalog.jsonb_typeof(p_action->'baseVersion')='null'
      or private.lukas_drawing_p2_positive_integer(p_action->'baseVersion')) then
    return false;
  end if;
  v_entity:=p_action->'entity';
  return v_entity ?& array['id','name','layerId','geometry','style','version']
    and v_entity-array['id','name','layerId','geometry','style','styleId','version']='{}'::jsonb
    and private.lukas_drawing_p2_uuid(v_entity->'id')
    and private.lukas_drawing_p2_positive_integer(v_entity->'version')
    and private.lukas_drawing_p2_name(v_entity->'name')
    and private.lukas_drawing_p2_uuid(v_entity->'layerId')
    and private.lukas_drawing_geometry_valid(
      v_entity->'geometry'->>'type',v_entity->'geometry'
    )
    and (((not (v_entity ? 'styleId')
          or pg_catalog.jsonb_typeof(v_entity->'styleId')='null')
        and private.lukas_drawing_style_valid(v_entity->'style'))
      or (private.lukas_drawing_p2_uuid(v_entity->'styleId')
        and private.lukas_drawing_style_override_valid(v_entity->'style')));
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_object_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if private.lukas_drawing_geometry_valid(new.object_type,new.geometry) is not true
    or ((new.style_id is null and private.lukas_drawing_style_valid(new.style) is not true)
      or (new.style_id is not null and private.lukas_drawing_style_override_valid(new.style) is not true)) then
    raise exception 'Drawing object domain JSON is invalid'; end if;
  if new.geometry->>'type' is distinct from new.object_type then
    raise exception 'Drawing geometry type must match object_type'; end if;
  if not exists(select 1 from public.lukas_drawing_layers l where l.id=new.layer_id
    and l.page_id=new.page_id and l.revision_id=new.revision_id and l.project_id=new.project_id
    and not l.locked) then raise exception 'Drawing object requires an unlocked layer on the same page'; end if;
  if new.style_id is not null and not exists(select 1 from public.lukas_drawing_styles s
    where s.id=new.style_id and s.revision_id=new.revision_id and s.project_id=new.project_id) then
    raise exception 'Drawing object style reference is invalid'; end if;
  if tg_op='INSERT' then
    if new.created_by<>v_actor or new.updated_by<>v_actor or new.version<>1 or new.status<>'active' then
      raise exception 'Drawing object creator or initial state is invalid'; end if;
  else
    if new.id is distinct from old.id or new.lineage_id is distinct from old.lineage_id
      or new.revision_id is distinct from old.revision_id or new.project_id is distinct from old.project_id
      or new.object_type is distinct from old.object_type or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then raise exception 'Drawing object identity is immutable'; end if;
    if pg_catalog.current_setting(
        'private.lukas_drawing_p4_clone_host_remap',true
      )=new.revision_id::text
      and old.object_type='opening' and new.object_type='opening'
      and new.version=old.version and new.updated_by=v_actor
      and (pg_catalog.to_jsonb(new)-array['geometry','host_object_id','updated_at'])
        =(pg_catalog.to_jsonb(old)-array['geometry','host_object_id','updated_at'])
      and new.geometry-'hostWallId'=old.geometry-'hostWallId'
      and exists(
        select 1
        from public.lukas_drawing_objects source_host
        join public.lukas_drawing_objects child_host
          on child_host.lineage_id=source_host.lineage_id
          and child_host.revision_id=new.revision_id
          and child_host.project_id=new.project_id
          and child_host.object_type='wall' and child_host.status='active'
        where source_host.id=(old.geometry->>'hostWallId')::uuid
          and source_host.project_id=new.project_id
          and source_host.object_type='wall'
          and child_host.id=(new.geometry->>'hostWallId')::uuid
      ) then
      return new;
    end if;
    if new.updated_by<>v_actor or new.version<>old.version+1 then
      raise exception 'Drawing object actor or version is invalid'; end if;
  end if;
  new.updated_at:=pg_catalog.now(); return new;
end;
$$;

alter function private.lukas_drawing_create_from_template(uuid,text,uuid)
  rename to lukas_drawing_create_from_template_pre_p4_semantic_objects;
create function private.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_revision_id uuid;
begin
  v_result:=private.lukas_drawing_create_from_template_pre_p4_semantic_objects(
    p_source_revision_id,p_title,p_source_file_id
  );
  v_revision_id:=(v_result->>'revisionId')::uuid;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p4_clone_host_remap',v_revision_id::text,true
  );
  update public.lukas_drawing_objects child_opening set
    geometry=pg_catalog.jsonb_set(
      child_opening.geometry,'{hostWallId}',pg_catalog.to_jsonb(child_host.id)
    )
  from public.lukas_drawing_objects source_opening
  join public.lukas_drawing_objects source_host
    on source_host.id=(source_opening.geometry->>'hostWallId')::uuid
    and source_host.revision_id=p_source_revision_id
    and source_host.project_id=source_opening.project_id
    and source_host.object_type='wall'
  join public.lukas_drawing_objects child_host
    on child_host.lineage_id=source_host.lineage_id
    and child_host.revision_id=v_revision_id
    and child_host.project_id=source_host.project_id
    and child_host.object_type='wall' and child_host.status='active'
  where child_opening.revision_id=v_revision_id
    and child_opening.project_id=source_opening.project_id
    and child_opening.object_type='opening' and child_opening.status='active'
    and source_opening.revision_id=p_source_revision_id
    and source_opening.object_type='opening'
    and source_opening.lineage_id=child_opening.lineage_id;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p4_clone_host_remap','',true
  );
  perform private.lukas_drawing_p4_assert_semantic_graph(v_revision_id);
  return v_result;
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when others then raise exception using errcode='P1R01',
    message='Drawing template target is unavailable';
end;
$$;

alter table public.lukas_drawing_objects
  add column host_object_id uuid generated always as (
    case when object_type='opening' then (geometry->>'hostWallId')::uuid end
  ) stored;
alter table public.lukas_drawing_objects
  add constraint lukas_drawing_objects_host_object_fkey
  foreign key(host_object_id,revision_id,project_id)
  references public.lukas_drawing_objects(id,revision_id,project_id)
  on delete restrict deferrable initially deferred;
create index lukas_drawing_objects_host_object_idx
  on public.lukas_drawing_objects(host_object_id,revision_id,project_id)
  where host_object_id is not null;

create function private.lukas_drawing_p4_semantic_graph_valid(p_revision_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select not exists(
    select 1
    from public.lukas_drawing_objects opening
    left join public.lukas_drawing_objects host
      on host.id=opening.host_object_id
      and host.revision_id=opening.revision_id
      and host.project_id=opening.project_id
      and host.status='active' and host.object_type='wall'
    left join public.lukas_drawing_layers opening_layer
      on opening_layer.id=opening.layer_id
      and opening_layer.revision_id=opening.revision_id
      and opening_layer.project_id=opening.project_id
    left join public.lukas_drawing_layers host_layer
      on host_layer.id=host.layer_id
      and host_layer.revision_id=host.revision_id
      and host_layer.project_id=host.project_id
    where opening.revision_id=p_revision_id
      and opening.status='active' and opening.object_type='opening'
      and (host.id is null or opening.page_id<>host.page_id
        or opening_layer.canvas_id is distinct from host_layer.canvas_id
        or 2*(opening.geometry->>'offsetMillimeters')::numeric*1000000
          -(opening.geometry->>'widthMillimeters')::numeric*1000000<0
        or pg_catalog.power(
          2*(opening.geometry->>'offsetMillimeters')::numeric*1000000
            +(opening.geometry->>'widthMillimeters')::numeric*1000000,2
        )>4*(
          pg_catalog.power(
            ((host.geometry->'end'->>'x')::numeric
              -(host.geometry->'start'->>'x')::numeric)*1000000,2
          )+pg_catalog.power(
            ((host.geometry->'end'->>'y')::numeric
              -(host.geometry->'start'->>'y')::numeric)*1000000,2
          )
        )
        or (opening.geometry->>'openingKind'='window'
          and ((opening.geometry->>'sillHeightMillimeters')::numeric
            +(opening.geometry->>'heightMillimeters')::numeric
            >(host.geometry->>'heightMillimeters')::numeric)))
  )
$$;

create function private.lukas_drawing_p4_assert_semantic_graph(p_revision_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if private.lukas_drawing_p4_semantic_graph_valid(p_revision_id) is not true then
    raise exception using errcode='P1C01',
      message='Drawing semantic host graph is invalid';
  end if;
end;
$$;

alter function private.lukas_drawing_request_review(uuid)
  rename to lukas_drawing_request_review_pre_p4_semantic_objects;
create function private.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.lukas_drawing_p4_assert_semantic_graph(p_revision_id);
  return private.lukas_drawing_request_review_pre_p4_semantic_objects(
    p_revision_id
  );
end;
$$;

alter function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) rename to lukas_drawing_apply_operation_pre_p4_semantic_objects;
create function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_result jsonb; v_results jsonb; v_core_forward jsonb; v_core_inverse jsonb;
  v_core_bases jsonb; v_sorted_forward jsonb; v_sorted_inverse jsonb;
  v_action jsonb; v_inverse_action jsonb; v_entity jsonb; v_previous jsonb;
  v_id uuid; v_layer_page uuid; v_base bigint; v_new_version bigint;
  v_count integer; v_ordinal bigint; v_operation_id uuid;
begin
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
      or v_existing.inverse is distinct from p_inverse
      or v_existing.history_action is distinct from p_history_action
      or v_existing.original_operation_id is distinct from p_original_operation_id then
      raise exception using errcode='P1C01',
        message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions
    );
  end if;

  -- Task 2 deliberately records host updates as ordinary put_object actions
  -- beside the exact reference cleanup for explicitly deleted openings.  The
  -- established reference engine remains authoritative for the outer deletion;
  -- this wrapper validates and realizes only those existing action variants.
  if p_operation_type='mutate_objects_with_references'
    and p_forward->>'type'='mutate_objects_with_references'
    and exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind'='put_object'
    ) then
    if pg_catalog.jsonb_typeof(p_inverse->'actions')<>'array'
      or exists(
        select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where private.lukas_drawing_structure_action_valid(a,p_revision_id)
          is not true
      ) or exists(
        select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where a->>'kind'='put_object'
          and a->'entity'->'geometry'->>'type' not in ('wall','opening')
      ) or not exists(
        select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where a->>'kind'='put_object'
          and a->'entity'->'geometry'->>'type'='wall'
      ) or exists(
        select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') o
        where o->'geometry'->>'type'<>'opening'
          or not exists(
            select 1 from pg_catalog.jsonb_array_elements(
              p_forward->'actions'
            ) a
            where a->>'kind'='put_object'
              and a->'entity'->'geometry'->>'type'='wall'
              and a->'entity'->>'id'=o->'geometry'->>'hostWallId'
          )
      ) or exists(
        select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
        where a->>'kind'='put_object'
        group by a->'entity'->>'id' having pg_catalog.count(*)>1
      ) or (
        select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          p_forward->'actions'
        ) a where a->>'kind'='put_object'
      )<>(
        select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          p_inverse->'actions'
        ) a where a->>'kind'='put_object'
      ) then
      raise exception using errcode='P1C01',
        message='Mixed drawing semantic mutation is invalid';
    end if;
    select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind'<>'put_object'),'[]'::jsonb)
      into v_core_forward
    from pg_catalog.jsonb_array_elements(p_forward->'actions')
      with ordinality a(value,ordinality);
    select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind'<>'put_object'),'[]'::jsonb)
      into v_core_inverse
    from pg_catalog.jsonb_array_elements(p_inverse->'actions')
      with ordinality a(value,ordinality);
    select coalesce(pg_catalog.jsonb_object_agg(e.key,e.value),'{}'::jsonb)
      into v_core_bases
    from pg_catalog.jsonb_each(p_base_versions) e
    where not exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind'='put_object' and a->'entity'->>'id'=e.key
    );
    v_core_forward:=pg_catalog.jsonb_set(
      p_forward,'{actions}',v_core_forward
    );
    v_core_inverse:=pg_catalog.jsonb_set(
      p_inverse,'{actions}',v_core_inverse
    );
    v_result:=private.lukas_drawing_apply_operation_pre_p4_semantic_objects(
      p_revision_id,p_client_operation_id,p_operation_type,v_core_bases,
      v_core_forward,v_core_inverse,p_history_action,p_original_operation_id
    );
    v_results:=v_result->'resultVersions';
    v_count:=pg_catalog.jsonb_array_length(p_forward->'actions');
    for v_action,v_ordinal in
      select value,ordinality from pg_catalog.jsonb_array_elements(
        p_forward->'actions'
      ) with ordinality
    loop
      if v_action->>'kind'<>'put_object' then continue; end if;
      v_entity:=v_action->'entity';
      v_id:=(v_entity->>'id')::uuid;
      v_base:=(v_action->>'baseVersion')::bigint;
      v_inverse_action:=p_inverse->'actions'->(v_count-v_ordinal::integer);
      v_previous:=private.lukas_drawing_structure_entity_json(
        'object',v_id,p_revision_id,
        (select project_id from public.lukas_drawing_revisions
          where id=p_revision_id)
      );
      if v_previous is null or (v_previous->>'version')::bigint<>v_base
        or v_entity->>'id' is distinct from v_previous->>'id'
        or (v_entity->>'version')::bigint<>v_base
        or v_inverse_action->>'kind'<>'put_object'
        or v_inverse_action->'entity' is distinct from v_previous
        or (v_inverse_action->>'baseVersion')::bigint<>v_base+1 then
        raise exception using errcode='P1C01',
          message='Mixed drawing semantic inverse is not exact';
      end if;
      select l.page_id into strict v_layer_page
      from public.lukas_drawing_layers l
      where l.id=(v_entity->>'layerId')::uuid
        and l.revision_id=p_revision_id and l.visible and not l.locked
        and l.system_kind<>'source';
      v_new_version:=v_base+1;
      update public.lukas_drawing_objects set
        name=v_entity->>'name',layer_id=(v_entity->>'layerId')::uuid,
        page_id=(select page_id from public.lukas_drawing_layers
          where id=(v_entity->>'layerId')::uuid),
        geometry=v_entity->'geometry',style_id=nullif(v_entity->>'styleId','')::uuid,
        style=v_entity->'style',version=v_new_version,updated_by=v_actor
      where id=v_id and revision_id=p_revision_id and status='active';
      if not found then raise exception using errcode='P1C01',
        message='Mixed drawing semantic object is unavailable'; end if;
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,v_new_version);
    end loop;
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
    perform private.lukas_drawing_p4_assert_semantic_graph(p_revision_id);
    return v_result||pg_catalog.jsonb_build_object('resultVersions',v_results);
  end if;

  -- Hosted openings intentionally precede their wall in explicit compound
  -- deletes.  Sort only the internal call expected by the P2 engine, preserve
  -- the client payload in the ledger, and validate the completed graph below.
  if p_operation_type='mutate_objects_with_references'
    and p_forward->>'type'='mutate_objects_with_references'
    and exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') o
      where o->'geometry'->>'type'='wall'
    ) then
    if p_forward->>'objectAction'='delete' and exists(
      select 1
      from pg_catalog.jsonb_array_elements(p_forward->'objects')
        with ordinality wall(value,ordinality)
      where wall.value->'geometry'->>'type'='wall'
        and exists(
          select 1 from public.lukas_drawing_objects opening
          where opening.revision_id=p_revision_id
            and opening.project_id=v_revision.project_id
            and opening.status='active' and opening.object_type='opening'
            and opening.host_object_id=(wall.value->>'id')::uuid
            and not exists(
              select 1
              from pg_catalog.jsonb_array_elements(p_forward->'objects')
                with ordinality prior(value,ordinality)
              where prior.value->>'id'=opening.id::text
                and prior.ordinality<wall.ordinality
            )
        )
    ) then
      raise exception using errcode='P1C01',
        message='Hosted openings must precede their deleted wall';
    end if;
    select pg_catalog.jsonb_agg(o.value order by o.value->>'id')
      into v_sorted_forward
    from pg_catalog.jsonb_array_elements(p_forward->'objects') o;
    select pg_catalog.jsonb_agg(o.value order by o.value->>'id')
      into v_sorted_inverse
    from pg_catalog.jsonb_array_elements(p_inverse->'objects') o;
    v_core_forward:=pg_catalog.jsonb_set(
      p_forward,'{objects}',v_sorted_forward
    );
    v_core_inverse:=pg_catalog.jsonb_set(
      p_inverse,'{objects}',v_sorted_inverse
    );
    v_result:=private.lukas_drawing_apply_operation_pre_p4_semantic_objects(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      v_core_forward,v_core_inverse,p_history_action,p_original_operation_id
    );
    v_operation_id:=(v_result->>'operationId')::uuid;
    perform pg_catalog.set_config(
      'private.lukas_drawing_p2_operation_rewrite',v_operation_id::text,true
    );
    update public.lukas_drawing_operations
      set forward=p_forward,inverse=p_inverse where id=v_operation_id;
    perform pg_catalog.set_config(
      'private.lukas_drawing_p2_operation_rewrite','',true
    );
    perform private.lukas_drawing_p4_assert_semantic_graph(p_revision_id);
    return v_result;
  end if;

  v_result:=private.lukas_drawing_apply_operation_pre_p4_semantic_objects(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,p_history_action,p_original_operation_id
  );
  perform private.lukas_drawing_p4_assert_semantic_graph(p_revision_id);
  return v_result;
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

revoke all on function
  private.lukas_drawing_p4_number_valid(jsonb),
  private.lukas_drawing_p4_point_valid(jsonb),
  private.lukas_drawing_p4_segments_intersect(jsonb,jsonb,jsonb,jsonb),
  private.lukas_drawing_p4_boundary_valid(jsonb),
  private.lukas_drawing_geometry_valid_pre_p4_semantic_objects(text,jsonb),
  private.lukas_drawing_geometry_valid(text,jsonb),
  private.lukas_drawing_p2_property_schema_json_valid(text,jsonb,jsonb),
  private.lukas_drawing_p2_block_primitives_valid(jsonb,uuid,uuid),
  private.lukas_drawing_structure_action_valid_pre_p4_semantic_objects(jsonb,uuid),
  private.lukas_drawing_structure_action_valid(jsonb,uuid),
  private.lukas_drawing_object_guard(),
  private.lukas_drawing_p4_semantic_graph_valid(uuid),
  private.lukas_drawing_p4_assert_semantic_graph(uuid),
  private.lukas_drawing_request_review_pre_p4_semantic_objects(uuid),
  private.lukas_drawing_request_review(uuid),
  private.lukas_drawing_create_from_template_pre_p4_semantic_objects(uuid,text,uuid),
  private.lukas_drawing_create_from_template(uuid,text,uuid),
  private.lukas_drawing_apply_operation_pre_p4_semantic_objects(
    uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
  )
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) from public,anon;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) to authenticated,service_role;

commit;
