begin;

alter table public.lukas_drawing_block_instances
  add column if not exists lineage_id uuid;
update public.lukas_drawing_block_instances
  set lineage_id=id where lineage_id is null;
alter table public.lukas_drawing_block_instances
  alter column lineage_id set not null;

create or replace function private.lukas_drawing_block_instance_lineage_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_source_revision uuid; v_offset bigint; v_lineage uuid;
begin
  if tg_op='UPDATE' and new.lineage_id is distinct from old.lineage_id then
    raise exception using errcode='P1C01',message='Drawing block instance lineage is immutable';
  end if;
  if tg_op='INSERT' then
    v_source_revision:=nullif(pg_catalog.current_setting('private.lukas_drawing_p2_clone_source_revision',true),'')::uuid;
    if v_source_revision is not null then
      select count(*) into v_offset from public.lukas_drawing_block_instances
        where revision_id=new.revision_id;
      select lineage_id into v_lineage from public.lukas_drawing_block_instances
        where revision_id=v_source_revision order by id offset v_offset limit 1;
      new.lineage_id:=coalesce(v_lineage,new.id);
    else
      new.lineage_id:=coalesce(new.lineage_id,new.id);
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists lukas_drawing_block_instance_lineage_guard on public.lukas_drawing_block_instances;
create trigger lukas_drawing_block_instance_lineage_guard before insert or update
  on public.lukas_drawing_block_instances for each row
  execute function private.lukas_drawing_block_instance_lineage_guard();

create index if not exists lukas_drawing_block_instances_lineage_idx
  on public.lukas_drawing_block_instances(revision_id,lineage_id);

-- Keep structure intents strict: a client must carry the immutable lineage on
-- every block-instance write.  The row trigger is the final authority for its
-- value (and preserves template lineage under the clone transaction).
alter function private.lukas_drawing_structure_action_valid(jsonb,uuid)
  rename to lukas_drawing_structure_action_valid_pre_block_instance_lineage;
create or replace function private.lukas_drawing_structure_action_valid(
  p_action jsonb,p_revision_id uuid
) returns boolean language plpgsql immutable set search_path='' as $$
declare v_entity jsonb:=p_action->'entity'; v_kind text:=p_action->>'kind';
begin
  if v_kind<>'put_block_instance' then
    return private.lukas_drawing_structure_action_valid_pre_block_instance_lineage(
      p_action,p_revision_id
    );
  end if;
  return pg_catalog.jsonb_typeof(v_entity)='object'
    and v_entity ?& array['id','blockId','layerId','name','origin','rotation','scaleX','scaleY','version']
    and v_entity-array['id','lineageId','blockId','layerId','name','origin','rotation','scaleX','scaleY','version'] in ('{}'::jsonb,jsonb_build_object('lineageId',null))
    and private.lukas_drawing_p2_uuid(v_entity->'id') is true
    and (not (v_entity ? 'lineageId') or private.lukas_drawing_p2_uuid(v_entity->'lineageId') is true)
    and private.lukas_drawing_p2_uuid(v_entity->'blockId') is true
    and private.lukas_drawing_p2_uuid(v_entity->'layerId') is true
    and private.lukas_drawing_p2_name(v_entity->'name') is true
    and private.lukas_drawing_point_valid(v_entity->'origin') is true
    and pg_catalog.jsonb_typeof(v_entity->'rotation')='number'
    and pg_catalog.jsonb_typeof(v_entity->'scaleX')='number' and (v_entity->>'scaleX')::numeric<>0
    and pg_catalog.jsonb_typeof(v_entity->'scaleY')='number' and (v_entity->>'scaleY')::numeric<>0;
exception when others then return false;
end;
$$;
revoke all on function private.lukas_drawing_structure_action_valid_pre_block_instance_lineage(jsonb,uuid)
  from public,anon,authenticated,service_role;

alter function private.lukas_drawing_structure_entity_json(text,uuid,uuid,uuid)
  rename to lukas_drawing_structure_entity_json_pre_block_instance_lineage;
create or replace function private.lukas_drawing_structure_entity_json(
  p_kind text,p_id uuid,p_revision_id uuid,p_project_id uuid
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;
begin
  if p_kind<>'block_instance' then
    return private.lukas_drawing_structure_entity_json_pre_block_instance_lineage(
      p_kind,p_id,p_revision_id,p_project_id
    );
  end if;
  select pg_catalog.jsonb_build_object('id',i.id,'lineageId',i.lineage_id,
    'blockId',i.block_id,'layerId',i.layer_id,'name',i.name,'origin',i.origin,
    'rotation',i.rotation,'scaleX',i.scale_x,'scaleY',i.scale_y,'version',i.version)
    into v from public.lukas_drawing_block_instances i
    where i.id=p_id and i.revision_id=p_revision_id and i.project_id=p_project_id;
  return v;
end;
$$;
revoke all on function private.lukas_drawing_structure_entity_json_pre_block_instance_lineage(text,uuid,uuid,uuid)
  from public,anon,authenticated,service_role;

commit;
