begin;

-- Layer-only structure batches are updates, never a second creation/deletion API.
create or replace function private.lukas_drawing_apply_p2_layer_structure_updates(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype; v_action jsonb; v_inverse jsonb;
  v_entity jsonb; v_previous jsonb; v_layer public.lukas_drawing_layers%rowtype;
  v_canvas public.lukas_drawing_canvases%rowtype; v_index integer; v_count integer;
  v_expected_bases jsonb:='{}'::jsonb; v_results jsonb:='{}'::jsonb;
  v_sequence bigint; v_operation_id uuid;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r where r.id=p_revision_id
    and v_actor is not null and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
    for update;
  if not found then raise exception using errcode='P1R01',message='Drawing revision target is unavailable'; end if;
  select * into v_existing from public.lukas_drawing_operations o where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse then
      raise exception using errcode='P1C01',message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object('operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions);
  end if;
  if v_revision.status<>'draft' then raise exception using errcode='P1C01',message='Drawing operation requires a draft revision'; end if;
  if p_operation_type<>'mutate_structure' or pg_catalog.jsonb_typeof(p_base_versions)<>'object'
    or p_forward->>'type'<>'mutate_structure' or p_forward-array['type','actions']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(p_forward->'actions')<>'array' or pg_catalog.jsonb_array_length(p_forward->'actions')=0
    or p_inverse->>'type'<>'mutate_structure' or p_inverse-array['type','actions']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(p_inverse->'actions')<>'array'
    or pg_catalog.jsonb_array_length(p_forward->'actions')<>pg_catalog.jsonb_array_length(p_inverse->'actions') then
    raise exception using errcode='P1C01',message='Drawing layer structure payload is invalid';
  end if;
  v_count:=pg_catalog.jsonb_array_length(p_forward->'actions');
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind'<>'put_layer' or a-array['kind','entity','baseVersion']<>'{}'::jsonb
        or pg_catalog.jsonb_typeof(a->'baseVersion')='null'
        or private.lukas_drawing_p2_positive_integer(a->'baseVersion') is not true
        or pg_catalog.jsonb_typeof(a->'entity')<>'object'
        or (a->'entity')-array['id','name','visible','locked','systemKind','canvasId','sortOrder','version']<>'{}'::jsonb
        or not (a->'entity' ?& array['id','name','visible','locked','systemKind','canvasId','sortOrder','version'])
        or private.lukas_drawing_p2_uuid(a->'entity'->'id') is not true
        or private.lukas_drawing_p2_name(a->'entity'->'name') is not true
        or pg_catalog.jsonb_typeof(a->'entity'->'visible')<>'boolean'
        or pg_catalog.jsonb_typeof(a->'entity'->'locked')<>'boolean'
        or a->'entity'->>'systemKind' not in ('work','custom','source')
        or private.lukas_drawing_p2_uuid(a->'entity'->'canvasId') is not true
        or pg_catalog.jsonb_typeof(a->'entity'->'sortOrder')<>'number'
        or (a->'entity'->>'sortOrder')::numeric<0
        or (a->'entity'->>'sortOrder')::numeric<>pg_catalog.trunc((a->'entity'->>'sortOrder')::numeric)
        or private.lukas_drawing_p2_positive_integer(a->'entity'->'version') is not true)
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      group by a->'entity'->>'id' having pg_catalog.count(*)>1) then
    raise exception using errcode='P1C01',message='Drawing layer structure action JSON is invalid';
  end if;
  for v_index in 0..v_count-1 loop
    v_action:=p_forward->'actions'->v_index; v_entity:=v_action->'entity';
    v_inverse:=p_inverse->'actions'->(v_count-v_index-1);
    select * into v_layer from public.lukas_drawing_layers l where l.id=(v_entity->>'id')::uuid
      and l.revision_id=p_revision_id and l.project_id=v_revision.project_id for update;
    if not found then raise exception using errcode='P1R01',message='Drawing layer target is unavailable'; end if;
    if v_layer.system_kind='source' then raise exception using errcode='P1C01',message='Source drawing layer is immutable'; end if;
    v_previous:=private.lukas_drawing_structure_entity_json(
      'layer',v_layer.id,p_revision_id,v_revision.project_id);
    if (v_action->>'baseVersion')::bigint<>v_layer.version
      or (v_entity->>'version')::bigint not in (v_layer.version,v_layer.version-1)
      or v_entity->>'systemKind'<>v_layer.system_kind then
      raise exception using errcode='P1C01',message='Drawing layer structure base version conflict'; end if;
    if v_inverse is distinct from pg_catalog.jsonb_build_object('kind','put_layer','entity',v_previous,
      'baseVersion',v_layer.version+1) then
      raise exception using errcode='P1C01',message='Drawing layer structure inverse is not exact'; end if;
    select * into v_canvas from public.lukas_drawing_canvases c where c.id=(v_entity->>'canvasId')::uuid
      and c.revision_id=p_revision_id and c.project_id=v_revision.project_id for key share;
    if not found then raise exception using errcode='P1R01',message='Drawing canvas target is unavailable'; end if;
    if v_canvas.page_id<>v_layer.page_id then
      raise exception using errcode='P1C01',message='Layers may move only between canvases on the same page'; end if;
    v_expected_bases:=v_expected_bases||pg_catalog.jsonb_build_object(v_layer.id::text,v_layer.version);
    update public.lukas_drawing_layers set page_id=v_canvas.page_id,canvas_id=v_canvas.id,name=v_entity->>'name',
      visible=(v_entity->>'visible')::boolean,locked=(v_entity->>'locked')::boolean,
      sort_order=(v_entity->>'sortOrder')::integer,version=v_layer.version+1 where id=v_layer.id;
    v_results:=v_results||pg_catalog.jsonb_build_object(v_layer.id::text,v_layer.version+1);
  end loop;
  if p_base_versions is distinct from v_expected_bases then
    raise exception using errcode='P1C01',message='Drawing layer structure base versions are incomplete'; end if;
  if (select pg_catalog.count(*) from public.lukas_drawing_pages where revision_id=p_revision_id)=0 then
    raise exception using errcode='P1C01',message='Drawing navigation invariants require a page, default paper canvas, and editable layer';
  end if;
  -- This update-only route cannot change page/canvas topology; page/canvas
  -- guards preserve their default-paper invariant and the layer guard enforces
  -- the editable fallback while the affected rows are locked above.
  select coalesce(pg_catalog.max(o.sequence),0)+1 into v_sequence from public.lukas_drawing_operations o where o.revision_id=p_revision_id;
  insert into public.lukas_drawing_operations(revision_id,project_id,sequence,client_operation_id,operation_type,base_versions,forward,inverse,result_versions,actor_id)
    values(p_revision_id,v_revision.project_id,v_sequence,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse,v_results,v_actor)
    returning id into v_operation_id;
  return pg_catalog.jsonb_build_object('operationId',v_operation_id,'sequence',v_sequence,'resultVersions',v_results);
exception when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation or not_null_violation or numeric_value_out_of_range or invalid_text_representation then
    raise exception using errcode='P1C01',message=sqlerrm;
  when others then raise;
end;
$$;

create or replace function private.lukas_drawing_require_remaining_page()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if coalesce(pg_catalog.current_setting('private.lukas_drawing_delete_page_ids',true),'')<>''
    and exists(select 1 from public.lukas_drawing_revisions r where r.id=old.revision_id)
    and not exists(select 1 from public.lukas_drawing_pages p where p.revision_id=old.revision_id and p.id<>old.id) then
    raise exception using errcode='P1C01',message='A drawing document requires at least one page';
  end if;
  return old;
end;
$$;
create trigger lukas_drawing_pages_require_remaining_page before delete on public.lukas_drawing_pages
  for each row execute function private.lukas_drawing_require_remaining_page();

alter function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  rename to lukas_drawing_apply_operation_pre_p2_navigation_hardening;
create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_operation_type='mutate_structure' and p_forward->>'type'='mutate_structure'
    and pg_catalog.jsonb_typeof(p_forward->'actions')='array' and pg_catalog.jsonb_array_length(p_forward->'actions')>0
    and not exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a where a->>'kind'<>'put_layer') then
    return private.lukas_drawing_apply_p2_layer_structure_updates(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
  end if;
  return private.lukas_drawing_apply_operation_pre_p2_navigation_hardening(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
exception when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when others then raise;
end;
$$;

revoke all on function private.lukas_drawing_apply_p2_layer_structure_updates(uuid,uuid,text,jsonb,jsonb,jsonb),
  private.lukas_drawing_apply_operation_pre_p2_navigation_hardening(uuid,uuid,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon;
grant execute on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb) to authenticated,service_role;

commit;
