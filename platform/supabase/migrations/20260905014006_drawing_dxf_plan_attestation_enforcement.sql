begin;

create function private.lukas_drawing_dxf_plan_attestation_protected(
  p_operation public.lukas_drawing_operations
) returns boolean language sql stable security invoker set search_path='' as $$
  select coalesce(p_operation.history_action is null
    and p_operation.original_operation_id is null
    and (
      ((p_operation.forward->'historyGroup'->>'kind'='dxf_import') is true
        and (p_operation.inverse->'historyGroup'->>'kind'='dxf_import') is true)
      or private.lukas_drawing_dxf_import_phase(
        p_operation.base_versions,p_operation.forward,p_operation.inverse
      )='object_source_create'
      or (
        p_operation.operation_type<>'restore_checkpoint'
        and exists(
          select 1 from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(p_operation.forward->'actions')='array'
              then p_operation.forward->'actions' else '[]'::jsonb end
          ) action
          where action->>'kind'='put_source'
            and action->'entity'->>'sourceKind'='dxf_entity'
            and action->'baseVersion'='null'::jsonb
            and p_operation.result_versions->>(action->'entity'->>'id')='1'
        )
      )
    ),false)
$$;

create function private.lukas_drawing_dxf_plan_attestation_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_protected boolean:=private.lukas_drawing_dxf_plan_attestation_protected(new);
  v_old_protected boolean:=case when tg_op='UPDATE'
    then private.lukas_drawing_dxf_plan_attestation_protected(old) else false end;
  v_proof private.lukas_drawing_dxf_plan_attestations%rowtype;
  v_digest text;
begin
  if new.operation_type='mutate_objects_with_references' and exists(
    select 1 from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(new.forward->'actions')='array'
        then new.forward->'actions' else '[]'::jsonb end
    ) action
    where action->>'kind'='put_source' and action->'entity'->>'sourceKind'='dxf_entity'
      and action->'baseVersion'='null'::jsonb
      and new.result_versions->>(action->'entity'->>'id')='1'
  ) then
    raise exception using errcode='P1C01',message='DXF reference rewrite requires a server plan';
  end if;
  if v_protected is not true and v_old_protected is not true then return new; end if;
  perform 1 from public.lukas_drawing_revisions revision
  where revision.id=new.revision_id and revision.project_id=new.project_id for key share;
  select proof.* into v_proof
  from private.lukas_drawing_dxf_plan_attestations proof
  where proof.revision_id=new.revision_id
    and proof.client_operation_id=new.client_operation_id
  order by proof.plan_index for update;
  if not found then
    raise exception using errcode='P1T01',message='DXF operation plan attestation is pending';
  end if;
  v_digest:=private.lukas_drawing_operation_request_sha256(
    new.actor_id,new.project_id,new.revision_id,new.client_operation_id,
    new.operation_type,new.base_versions,new.forward,new.inverse,
    new.history_action,new.original_operation_id
  );
  if v_proof.actor_id is distinct from new.actor_id
    or v_proof.project_id is distinct from new.project_id
    or v_proof.request_sha256 is distinct from v_digest then
    raise exception using errcode='P1C01',message='DXF operation requires an exact server plan attestation';
  end if;
  if tg_op='UPDATE' then
    if v_proof.consumed_operation_id is distinct from new.id then
      raise exception using errcode='P1C01',message='DXF operation proof is not owned by this operation';
    end if;
    return new;
  end if;
  update private.lukas_drawing_dxf_plan_attestations proof
  set consumed_operation_id=new.id,consumed_at=pg_catalog.clock_timestamp()
  where proof.revision_id=v_proof.revision_id and proof.plan_id=v_proof.plan_id
    and proof.plan_index=v_proof.plan_index and proof.consumed_operation_id is null;
  if not found then
    raise exception using errcode='P1C01',message='DXF operation proof was already consumed';
  end if;
  return new;
end;
$$;

-- PostgreSQL runs same-event triggers in name order. Keep the existing
-- operation-disposition guard first so an explicitly discarded request stays
-- terminal instead of being reported as a missing, retryable attestation.
create trigger lukas_drawing_z_dxf_plan_attestation_guard
before insert or update on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_dxf_plan_attestation_guard();

-- The current private operation adapter deliberately maps unknown SQLSTATEs to
-- the stable conflict domain. Restore the one new transient attestation state
-- at the public boundary without broadening any other conflict classification.
create or replace function public.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode='P1R01',
      message='Drawing revision target is unavailable';
  end if;
  return private.lukas_drawing_apply_operation(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,p_history_action,p_original_operation_id
  );
exception
  when sqlstate 'P1R01' then
    if sqlerrm='Drawing operation domain JSON is invalid' then
      raise exception using errcode='P1C01',message=sqlerrm;
    end if;
    raise;
  when sqlstate 'P1C01' then
    if sqlerrm='DXF operation plan attestation is pending' then
      raise exception using errcode='P1T01',message=sqlerrm;
    end if;
    raise;
end;
$$;

revoke all on function private.lukas_drawing_dxf_plan_attestation_protected(
  public.lukas_drawing_operations
) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_dxf_plan_attestation_guard()
  from public,anon,authenticated,service_role;

commit;
