begin;

-- Forward reconciliation for databases whose migration history already records
-- 033000/040000 and therefore may not automatically revisit the ordered 030000
-- repair. On a fully ordered install every statement below is a no-op.

alter table public.lukas_drawing_layers disable trigger user;

update public.lukas_drawing_layers set sort_order=0 where sort_order<0;

do $$
declare
  v record; v_digest text; v_layer_id uuid; v_name text; v_suffix integer;
begin
  for v in
    select c.id canvas_id,c.page_id,c.revision_id,c.project_id,r.created_by
    from public.lukas_drawing_canvases c
    join public.lukas_drawing_revisions r
      on r.id=c.revision_id and r.project_id=c.project_id
    where not exists(
      select 1 from public.lukas_drawing_layers l
      where l.canvas_id=c.id and l.system_kind<>'source' and l.visible and not l.locked
    )
    order by c.id
  loop
    v_digest:=pg_catalog.md5('lukas-drawing-p2-editable-layer:'||v.canvas_id::text);
    v_layer_id:=(pg_catalog.substr(v_digest,1,8)||'-'||pg_catalog.substr(v_digest,9,4)||'-5'||
      pg_catalog.substr(v_digest,14,3)||'-a'||pg_catalog.substr(v_digest,18,3)||'-'||
      pg_catalog.substr(v_digest,21,12))::uuid;
    if private.lukas_drawing_structure_raw_id_exists(v_layer_id) then
      raise exception using errcode='P1C01',
        message='Deterministic drawing layer reconciliation ID collides with existing structure';
    end if;
    v_suffix:=0;
    loop
      v_name:=case when v_suffix=0 then 'P2 Work '||v.canvas_id::text
        else 'P2 Work '||v.canvas_id::text||' #'||v_suffix::text end;
      exit when not exists(select 1 from public.lukas_drawing_layers l
        where l.page_id=v.page_id and l.name=v_name);
      v_suffix:=v_suffix+1;
    end loop;
    insert into public.lukas_drawing_layers(
      id,page_id,canvas_id,revision_id,project_id,name,sort_order,
      visible,locked,system_kind,version,created_by
    ) values(
      v_layer_id,v.page_id,v.canvas_id,v.revision_id,v.project_id,v_name,0,
      true,false,'custom',1,v.created_by
    );
  end loop;
end;
$$;

alter table public.lukas_drawing_layers enable trigger user;

do $$
begin
  if exists(select 1 from public.lukas_drawing_layers where sort_order<0)
    or exists(select 1 from public.lukas_drawing_canvases c where not exists(
      select 1 from public.lukas_drawing_layers l
      where l.canvas_id=c.id and l.system_kind<>'source' and l.visible and not l.locked
    )) then raise exception using errcode='P1C01',
      message='Drawing layer history reconciliation did not restore required invariants';
  end if;
  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid='public.lukas_drawing_layers'::regclass
      and conname='lukas_drawing_layers_sort_order_nonnegative') then
    alter table public.lukas_drawing_layers
      add constraint lukas_drawing_layers_sort_order_nonnegative
      check (sort_order>=0) not valid;
  end if;
  if exists(select 1 from pg_catalog.pg_constraint
    where conrelid='public.lukas_drawing_layers'::regclass
      and conname='lukas_drawing_layers_sort_order_nonnegative' and not convalidated) then
    alter table public.lukas_drawing_layers
      validate constraint lukas_drawing_layers_sort_order_nonnegative;
  end if;
end;
$$;

create or replace function private.lukas_drawing_apply_p2_object_tombstone_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_item jsonb; v_inverse_item jsonb; v_expected jsonb;
  v_object public.lukas_drawing_objects%rowtype; v_id uuid; v_index integer;
  v_expected_bases jsonb:='{}'::jsonb; v_expected_ids jsonb:='[]'::jsonb;
  v_results jsonb:='{}'::jsonb; v_sequence bigint; v_operation_id uuid;
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
        and l.revision_id=p_revision_id and l.project_id=v_revision.project_id and not l.locked) then
        raise exception using errcode='P1R01',message='Drawing layer target is unavailable'; end if;
      v_expected_bases:=v_expected_bases||pg_catalog.jsonb_build_object(v_id::text,v_object.version);
      v_expected:=pg_catalog.jsonb_build_object('id',v_object.id,'name',v_object.name,
        'layerId',v_object.layer_id,'geometry',v_object.geometry,'styleId',v_object.style_id,
        'style',v_object.style,'version',v_object.version+2);
      if v_object.style_id is null and not (v_inverse_item ? 'styleId') then
        v_expected:=v_expected-'styleId'; end if;
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
      return private.lukas_drawing_apply_operation_pre_p2_history_reconciliation(
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
      if v_item is distinct from v_expected then raise exception using errcode='P1C01',
        message='Drawing object restore must match the exact tombstone'; end if;
      if not exists(select 1 from public.lukas_drawing_layers l where l.id=v_object.layer_id
        and l.revision_id=p_revision_id and l.project_id=v_revision.project_id and not l.locked) then
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
  else
    raise exception using errcode='P1C01',message='Unsupported drawing tombstone operation';
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
  rename to lukas_drawing_apply_operation_pre_p2_history_reconciliation;
create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if p_operation_type='delete_objects'
    and pg_catalog.jsonb_typeof(p_inverse->'objects')='array' then
    if exists(select 1 from pg_catalog.jsonb_array_elements(p_inverse->'objects') x
      where x ? 'styleId') then
      return private.lukas_drawing_apply_p2_object_tombstone_operation(
        p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
    end if;
  elsif p_operation_type='add_objects'
    and pg_catalog.jsonb_typeof(p_forward->'objects')='array' then
    if exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') x
      where x ? 'styleId') then
      return private.lukas_drawing_apply_p2_object_tombstone_operation(
        p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
    end if;
  end if;
  return private.lukas_drawing_apply_operation_pre_p2_history_reconciliation(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,p_forward,p_inverse);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when numeric_value_out_of_range or invalid_text_representation then
    raise exception using errcode='P1C01',message='Drawing numeric value is outside the supported range';
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

revoke all on function
  private.lukas_drawing_apply_p2_object_tombstone_operation(uuid,uuid,text,jsonb,jsonb,jsonb),
  private.lukas_drawing_apply_operation_pre_p2_history_reconciliation(uuid,uuid,text,jsonb,jsonb,jsonb)
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  from public,anon;
grant execute on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  to authenticated,service_role;

commit;
