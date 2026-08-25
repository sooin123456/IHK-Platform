begin;

alter function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  rename to lukas_drawing_apply_operation_pre_block_exactness;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_project_id uuid;
  v_action jsonb;
  v_entity jsonb;
  v_instance public.lukas_drawing_block_instances%rowtype;
  v_layer public.lukas_drawing_layers%rowtype;
begin
  if p_operation_type<>'mutate_structure'
    or p_forward->>'type'<>'mutate_structure'
    or pg_catalog.jsonb_typeof(p_forward->'actions')<>'array' then
    return private.lukas_drawing_apply_operation_pre_block_exactness(
      p_revision_id,p_client_operation_id,p_operation_type,
      p_base_versions,p_forward,p_inverse);
  end if;

  select r.project_id into v_project_id
  from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor');
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing revision target is unavailable';
  end if;

  if exists(
    select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
    where a->>'kind'='delete_object'
  ) then
    select a->'entity' into v_entity
    from pg_catalog.jsonb_array_elements(p_forward->'actions') a
    where a->>'kind'='put_block_instance';
    if v_entity is not null and (
      (v_entity->>'rotation')::numeric<>0
      or (v_entity->>'scaleX')::numeric<>1
      or (v_entity->>'scaleY')::numeric<>1
    ) then
      raise exception using errcode='P1C01',
        message='Drawing block conversion creation is translation-only';
    end if;
  end if;

  for v_action in
    select value
    from pg_catalog.jsonb_array_elements(p_forward->'actions')
    where value->>'kind'='delete_block_instance'
    order by value->>'id'
  loop
    select i.* into v_instance
    from public.lukas_drawing_block_instances i
    where i.id=(v_action->>'id')::uuid
      and i.revision_id=p_revision_id and i.project_id=v_project_id
    for update;
    if not found then
      raise exception using errcode='P1R01',
        message='Drawing block instance target is unavailable';
    end if;
    select l.* into v_layer
    from public.lukas_drawing_layers l
    where l.id=v_instance.layer_id
      and l.revision_id=v_instance.revision_id
      and l.project_id=v_instance.project_id
    for update;
    if not found or not v_layer.visible or v_layer.locked
      or v_layer.system_kind not in ('work','custom') then
      raise exception using errcode='P1C01',
        message='Drawing block instance requires an eligible editable layer';
    end if;
  end loop;

  for v_action in
    select value
    from pg_catalog.jsonb_array_elements(p_forward->'actions')
    where value->>'kind'='put_block_instance'
    order by value->'entity'->>'id'
  loop
    v_entity:=v_action->'entity';
    select l.* into v_layer
    from public.lukas_drawing_layers l
    where l.id=(v_entity->>'layerId')::uuid
      and l.revision_id=p_revision_id and l.project_id=v_project_id
    for update;
    if not found or not v_layer.visible or v_layer.locked
      or v_layer.system_kind not in ('work','custom') then
      raise exception using errcode='P1C01',
        message='Drawing block instance requires an eligible editable layer';
    end if;
  end loop;

  return private.lukas_drawing_apply_operation_pre_block_exactness(
    p_revision_id,p_client_operation_id,p_operation_type,
    p_base_versions,p_forward,p_inverse);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when numeric_value_out_of_range or invalid_text_representation then
    raise exception using errcode='P1C01',
      message='Drawing block structure payload is invalid';
  when others then raise;
end;
$$;

revoke all on function
  private.lukas_drawing_apply_operation_pre_block_exactness(uuid,uuid,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function
  private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  from public,anon;
grant execute on function
  private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  to authenticated,service_role;

commit;
