begin;

alter function private.lukas_drawing_apply_p2_legacy_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  rename to lukas_drawing_apply_p2_legacy_operation_pre_p2_compatibility;

create or replace function private.lukas_drawing_apply_p2_legacy_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_item jsonb; v_inverse_item jsonb; v_patch jsonb; v_expected jsonb:='{}'::jsonb;
  v_object public.lukas_drawing_objects%rowtype; v_layer public.lukas_drawing_layers%rowtype;
  v_canvas public.lukas_drawing_canvases%rowtype; v_id uuid; v_index integer;
  v_sequence bigint; v_operation_id uuid; v_results jsonb:='{}'::jsonb;
  v_expected_bases jsonb:='{}'::jsonb; v_expected_ids jsonb:='[]'::jsonb;
  v_effective_visible boolean; v_effective_locked boolean;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
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
      raise exception using errcode='P1C01',
        message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object('operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions);
  end if;
  if v_revision.status<>'draft' then
    raise exception using errcode='P1C01',message='Drawing operation requires a draft revision'; end if;

  if p_operation_type='delete_objects' then
    if p_forward->>'type'<>'delete_objects' or p_forward-array['type','objectIds']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(p_forward->'objectIds')<>'array'
      or pg_catalog.jsonb_array_length(p_forward->'objectIds')=0
      or p_inverse->>'type'<>'add_objects' or p_inverse-array['type','objects']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(p_inverse->'objects')<>'array'
      or pg_catalog.jsonb_array_length(p_inverse->'objects')<>pg_catalog.jsonb_array_length(p_forward->'objectIds')
      or exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'objectIds') x
        where private.lukas_drawing_p2_uuid(x) is not true)
      or exists(select 1 from pg_catalog.jsonb_array_elements_text(p_forward->'objectIds') x(id)
        group by id having pg_catalog.count(*)>1) then
      raise exception using errcode='P1C01',message='Drawing delete_objects payload is invalid'; end if;
    for v_index in 0..pg_catalog.jsonb_array_length(p_forward->'objectIds')-1 loop
      v_id:=(p_forward->'objectIds'->>v_index)::uuid;
      v_inverse_item:=p_inverse->'objects'->v_index;
      select * into v_object from public.lukas_drawing_objects o
        where o.id=v_id and o.revision_id=p_revision_id and o.project_id=v_revision.project_id
          and o.status='active' for update;
      if not found then raise exception using errcode='P1R01',message='Drawing object target is unavailable'; end if;
      if not exists(select 1 from public.lukas_drawing_layers l where l.id=v_object.layer_id
        and l.revision_id=p_revision_id and l.project_id=v_revision.project_id
        and l.system_kind<>'source' and l.visible and not l.locked) then
        raise exception using errcode='P1R01',message='Drawing layer target is unavailable'; end if;
      v_expected_bases:=v_expected_bases||pg_catalog.jsonb_build_object(v_id::text,v_object.version);
      v_expected:=pg_catalog.jsonb_build_object('id',v_object.id,'name',v_object.name,
        'layerId',v_object.layer_id,'geometry',v_object.geometry,'styleId',v_object.style_id,
        'style',v_object.style,'version',v_object.version+2);
      if v_object.style_id is null and not (v_inverse_item ? 'styleId') then
        v_expected:=v_expected-'styleId';
      end if;
      if v_inverse_item is distinct from v_expected
        or private.lukas_drawing_structure_action_valid(pg_catalog.jsonb_build_object(
          'kind','put_object','entity',v_inverse_item,'baseVersion',null),p_revision_id) is not true then
        raise exception using errcode='P1C01',message='Drawing delete inverse is not replayable'; end if;
      update public.lukas_drawing_objects set status='deleted',version=v_object.version+1,updated_by=v_actor
        where id=v_id;
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,null);
    end loop;
    if v_expected_bases is distinct from p_base_versions then
      raise exception using errcode='P1C01',message='Drawing object base versions are incomplete'; end if;

  elsif p_operation_type='add_objects' then
    if p_forward->>'type'<>'add_objects' or p_forward-array['type','objects']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(p_forward->'objects')<>'array'
      or pg_catalog.jsonb_array_length(p_forward->'objects')=0
      or p_inverse->>'type'<>'delete_objects' or p_inverse-array['type','objectIds']<>'{}'::jsonb then
      raise exception using errcode='P1C01',message='Drawing add_objects payload is invalid'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') x
      where private.lukas_drawing_p2_uuid(x->'id') is not true) then
      raise exception using errcode='P1C01',message='Drawing object JSON is invalid'; end if;
    if exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') x
      where not exists(select 1 from public.lukas_drawing_objects o
        where o.id=(x->>'id')::uuid and o.revision_id=p_revision_id and o.status='deleted')) then
      return private.lukas_drawing_apply_p2_legacy_operation_pre_p2_compatibility(
        p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
    end if;
    for v_index in 0..pg_catalog.jsonb_array_length(p_forward->'objects')-1 loop
      v_item:=p_forward->'objects'->v_index; v_id:=(v_item->>'id')::uuid;
      if private.lukas_drawing_structure_action_valid(pg_catalog.jsonb_build_object(
        'kind','put_object','entity',v_item,'baseVersion',null),p_revision_id) is not true then
        raise exception using errcode='P1C01',message='Drawing object JSON is invalid'; end if;
      select * into v_object from public.lukas_drawing_objects o where o.id=v_id
        and o.revision_id=p_revision_id and o.project_id=v_revision.project_id
        and o.status='deleted' for update;
      if not found then raise exception using errcode='P1R01',message='Drawing object tombstone is unavailable'; end if;
      v_expected_bases:=v_expected_bases||pg_catalog.jsonb_build_object(v_id::text,v_object.version);
      v_expected:=pg_catalog.jsonb_build_object('id',v_object.id,'name',v_object.name,
        'layerId',v_object.layer_id,'geometry',v_object.geometry,'styleId',v_object.style_id,
        'style',v_object.style,'version',v_object.version+1);
      if v_object.style_id is null and not (v_item ? 'styleId') then v_expected:=v_expected-'styleId'; end if;
      if v_item is distinct from v_expected then
        raise exception using errcode='P1C01',message='Drawing object restore must match the exact tombstone'; end if;
      if not exists(select 1 from public.lukas_drawing_layers l where l.id=v_object.layer_id
        and l.revision_id=p_revision_id and l.project_id=v_revision.project_id
        and l.system_kind<>'source' and l.visible and not l.locked) then
        raise exception using errcode='P1R01',message='Drawing layer target is unavailable'; end if;
      if v_object.style_id is not null and not exists(select 1 from public.lukas_drawing_styles s
        where s.id=v_object.style_id and s.revision_id=p_revision_id and s.project_id=v_revision.project_id) then
        raise exception using errcode='P1R01',message='Drawing style target is unavailable'; end if;
      update public.lukas_drawing_objects set status='active',version=v_object.version+1,updated_by=v_actor
        where id=v_id;
      v_expected_ids:=v_expected_ids||pg_catalog.jsonb_build_array(v_id);
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,v_object.version+1);
    end loop;
    if p_inverse->'objectIds' is distinct from v_expected_ids
      or p_base_versions is distinct from v_expected_bases then
      raise exception using errcode='P1C01',message='Drawing object restore versions or inverse are not exact'; end if;

  elsif p_operation_type='add_layer' then
    v_item:=p_forward->'layer';
    if p_forward->>'type'<>'add_layer' or p_forward-array['type','layer']<>'{}'::jsonb
      or p_inverse<>'{}'::jsonb or pg_catalog.jsonb_typeof(v_item)<>'object'
      or v_item-array['id','name','visible','locked','canvasId','sortOrder','version']<>'{}'::jsonb
      or not (v_item ?& array['id','name','visible','locked','canvasId','sortOrder','version'])
      or private.lukas_drawing_p2_uuid(v_item->'id') is not true
      or private.lukas_drawing_p2_uuid(v_item->'canvasId') is not true
      or private.lukas_drawing_p2_name(v_item->'name') is not true
      or pg_catalog.jsonb_typeof(v_item->'visible')<>'boolean'
      or pg_catalog.jsonb_typeof(v_item->'locked')<>'boolean'
      or pg_catalog.jsonb_typeof(v_item->'sortOrder')<>'number'
      or private.lukas_drawing_p2_positive_integer(v_item->'version') is not true then
      raise exception using errcode='P1C01',message='Drawing add_layer payload is invalid'; end if;
    if (v_item->>'sortOrder')::numeric not between 0 and 2147483647
      or (v_item->>'sortOrder')::numeric<>pg_catalog.trunc((v_item->>'sortOrder')::numeric)
      or (v_item->>'version')::bigint<>1 then
      raise exception using errcode='P1C01',message='Drawing add_layer payload is invalid'; end if;
    v_id:=(v_item->>'id')::uuid;
    if p_base_versions is distinct from pg_catalog.jsonb_build_object(v_id::text,1) then
      raise exception using errcode='P1C01',message='Drawing add_layer base version is invalid'; end if;
    if private.lukas_drawing_structure_raw_id_exists(v_id)
      or private.lukas_drawing_structure_raw_id_recorded(p_revision_id,v_id) then
      raise exception using errcode='P1C01',message='Drawing layer raw ID collision'; end if;
    select * into v_canvas from public.lukas_drawing_canvases c
      where c.id=(v_item->>'canvasId')::uuid and c.revision_id=p_revision_id
        and c.project_id=v_revision.project_id for key share;
    if not found then raise exception using errcode='P1R01',message='Drawing canvas target is unavailable'; end if;
    insert into public.lukas_drawing_layers(id,page_id,canvas_id,revision_id,project_id,name,sort_order,
      visible,locked,system_kind,version,created_by)
    values(v_id,v_canvas.page_id,v_canvas.id,p_revision_id,v_revision.project_id,v_item->>'name',
      (v_item->>'sortOrder')::integer,(v_item->>'visible')::boolean,(v_item->>'locked')::boolean,
      'custom',1,v_actor);
    v_results:=pg_catalog.jsonb_build_object(v_id::text,1);

  elsif p_operation_type='update_layer' then
    if p_forward->>'type'<>'update_layer' or p_forward-array['type','layerId','patch']<>'{}'::jsonb
      or p_inverse->>'type'<>'update_layer' or p_inverse-array['type','layerId','patch']<>'{}'::jsonb
      or private.lukas_drawing_p2_uuid(p_forward->'layerId') is not true
      or p_inverse->'layerId' is distinct from p_forward->'layerId'
      or pg_catalog.jsonb_typeof(p_forward->'patch')<>'object'
      or p_forward->'patch'='{}'::jsonb
      or (p_forward->'patch')-array['name','visible','locked','canvasId','sortOrder']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(p_inverse->'patch')<>'object'
      or (p_inverse->'patch')-array['name','visible','locked','canvasId','sortOrder']<>'{}'::jsonb then
      raise exception using errcode='P1C01',message='Drawing update_layer payload is invalid'; end if;
    v_id:=(p_forward->>'layerId')::uuid; v_patch:=p_forward->'patch';
    if (v_patch ? 'name' and private.lukas_drawing_p2_name(v_patch->'name') is not true)
      or (v_patch ? 'visible' and pg_catalog.jsonb_typeof(v_patch->'visible')<>'boolean')
      or (v_patch ? 'locked' and pg_catalog.jsonb_typeof(v_patch->'locked')<>'boolean')
      or (v_patch ? 'canvasId' and private.lukas_drawing_p2_uuid(v_patch->'canvasId') is not true)
      or (v_patch ? 'sortOrder' and pg_catalog.jsonb_typeof(v_patch->'sortOrder')<>'number') then
      raise exception using errcode='P1C01',message='Drawing update_layer payload is invalid'; end if;
    if v_patch ? 'sortOrder' and ((v_patch->>'sortOrder')::numeric not between 0 and 2147483647
      or (v_patch->>'sortOrder')::numeric<>pg_catalog.trunc((v_patch->>'sortOrder')::numeric)) then
      raise exception using errcode='P1C01',message='Drawing update_layer payload is invalid'; end if;
    select * into v_layer from public.lukas_drawing_layers l where l.id=v_id
      and l.revision_id=p_revision_id and l.project_id=v_revision.project_id for update;
    if not found then raise exception using errcode='P1R01',message='Drawing layer target is unavailable'; end if;
    if v_layer.system_kind='source' then raise exception using errcode='P1C01',message='Source drawing layer is immutable'; end if;
    if p_base_versions is distinct from pg_catalog.jsonb_build_object(v_id::text,v_layer.version) then
      raise exception using errcode='P1C01',message='Drawing layer base version conflict'; end if;
    v_expected:='{}'::jsonb;
    if v_patch ? 'name' then v_expected:=v_expected||pg_catalog.jsonb_build_object('name',v_layer.name); end if;
    if v_patch ? 'visible' then v_expected:=v_expected||pg_catalog.jsonb_build_object('visible',v_layer.visible); end if;
    if v_patch ? 'locked' then v_expected:=v_expected||pg_catalog.jsonb_build_object('locked',v_layer.locked); end if;
    if v_patch ? 'canvasId' then v_expected:=v_expected||pg_catalog.jsonb_build_object('canvasId',v_layer.canvas_id); end if;
    if v_patch ? 'sortOrder' then v_expected:=v_expected||pg_catalog.jsonb_build_object('sortOrder',v_layer.sort_order); end if;
    if p_inverse->'patch' is distinct from v_expected then
      raise exception using errcode='P1C01',message='Drawing layer inverse is not exact'; end if;
    select * into v_canvas from public.lukas_drawing_canvases c
      where c.id=case when v_patch ? 'canvasId' then (v_patch->>'canvasId')::uuid else v_layer.canvas_id end
        and c.revision_id=p_revision_id and c.project_id=v_revision.project_id for key share;
    if not found then raise exception using errcode='P1R01',message='Drawing canvas target is unavailable'; end if;
    if v_canvas.page_id<>v_layer.page_id and (
      exists(select 1 from public.lukas_drawing_objects o where o.layer_id=v_id)
      or exists(select 1 from public.lukas_drawing_block_instances i where i.layer_id=v_id)
    ) then raise exception using errcode='P1C01',message='A nonempty layer cannot move across pages'; end if;
    v_effective_visible:=case when v_patch ? 'visible' then (v_patch->>'visible')::boolean else v_layer.visible end;
    v_effective_locked:=case when v_patch ? 'locked' then (v_patch->>'locked')::boolean else v_layer.locked end;
    if v_canvas.id<>v_layer.canvas_id and not exists(select 1 from public.lukas_drawing_layers l
      where l.canvas_id=v_layer.canvas_id and l.id<>v_id and l.system_kind<>'source'
        and l.visible and not l.locked) then
      raise exception using errcode='P1C01',message='Layer move would leave the previous canvas without an editable layer'; end if;
    if (not v_effective_visible or v_effective_locked) and not exists(
      select 1 from public.lukas_drawing_layers l where l.canvas_id=v_canvas.id and l.id<>v_id
        and l.system_kind<>'source' and l.visible and not l.locked
    ) then raise exception using errcode='P1C01',
      message='At least one visible unlocked user drawing layer is required on the destination canvas'; end if;
    update public.lukas_drawing_layers set page_id=v_canvas.page_id,canvas_id=v_canvas.id,
      name=case when v_patch ? 'name' then v_patch->>'name' else v_layer.name end,
      visible=v_effective_visible,locked=v_effective_locked,
      sort_order=case when v_patch ? 'sortOrder' then (v_patch->>'sortOrder')::integer else v_layer.sort_order end,
      version=v_layer.version+1 where id=v_id;
    v_results:=pg_catalog.jsonb_build_object(v_id::text,v_layer.version+1);
  else
    return private.lukas_drawing_apply_p2_legacy_operation_pre_p2_compatibility(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
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
  rename to lukas_drawing_apply_operation_pre_p2_compatibility;
create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_operation_type='delete_objects'
    or p_operation_type='update_layer'
    or (p_operation_type='add_layer' and p_forward->'layer' ? 'canvasId') then
    return private.lukas_drawing_apply_p2_legacy_operation(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
  end if;
  return private.lukas_drawing_apply_operation_pre_p2_compatibility(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when numeric_value_out_of_range or invalid_text_representation then
    raise exception using errcode='P1C01',message='Drawing numeric value is outside the supported range';
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

alter function private.lukas_drawing_request_review(uuid)
  rename to lukas_drawing_request_review_pre_p2_compatibility;
create or replace function private.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
begin
  perform 1 from public.lukas_drawing_revisions r where r.id=p_revision_id
    and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor') for update;
  if not found then raise exception using errcode='P1R01',message='Drawing revision target is unavailable'; end if;
  if exists(select 1 from public.lukas_drawing_objects o
    left join public.lukas_drawing_layers l on l.id=o.layer_id
    where o.revision_id=p_revision_id and o.status='active'
      and (l.id is null or o.page_id<>l.page_id
        or o.revision_id<>l.revision_id or o.project_id<>l.project_id)) then
    raise exception using errcode='P1C01',message='Drawing review found invalid object-layer page ancestry';
  end if;
  return private.lukas_drawing_request_review_pre_p2_compatibility(p_revision_id);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

revoke all on function
  private.lukas_drawing_apply_p2_legacy_operation_pre_p2_compatibility(uuid,uuid,text,jsonb,jsonb,jsonb),
  private.lukas_drawing_apply_p2_legacy_operation(uuid,uuid,text,jsonb,jsonb,jsonb),
  private.lukas_drawing_apply_operation_pre_p2_compatibility(uuid,uuid,text,jsonb,jsonb,jsonb),
  private.lukas_drawing_request_review_pre_p2_compatibility(uuid)
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  from public,anon;
grant execute on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  to authenticated,service_role;
revoke all on function private.lukas_drawing_request_review(uuid) from public,anon;
grant execute on function private.lukas_drawing_request_review(uuid) to authenticated,service_role;

commit;
