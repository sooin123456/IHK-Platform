begin;

do $$
begin
  if exists(
    select 1
    from public.lukas_drawing_operations history
    join public.lukas_drawing_operations original
      on original.revision_id=history.revision_id
      and original.client_operation_id=history.original_operation_id
    where history.original_operation_id is not null
      and history.actor_id is distinct from original.actor_id
  ) then
    raise exception using errcode='P1C01',
      message='Drawing history original must belong to the same actor';
  end if;
end;
$$;

alter table public.lukas_drawing_operations
  add constraint lukas_drawing_operations_revision_client_actor_key
    unique(revision_id,client_operation_id,actor_id);

alter table public.lukas_drawing_operations
  drop constraint lukas_drawing_operations_history_original_fkey,
  add constraint lukas_drawing_operations_history_original_fkey
    foreign key(revision_id,original_operation_id,actor_id)
    references public.lukas_drawing_operations(
      revision_id,client_operation_id,actor_id
    )
    on delete cascade
    deferrable initially immediate;

alter function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) rename to lukas_drawing_apply_operation_pre_history_authority;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_existing public.lukas_drawing_operations%rowtype;
  v_original_actor uuid;
  v_result jsonb;
begin
  perform 1 from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P1R01',message='Drawing revision target is unavailable';
  end if;
  if not (
    (p_history_action is null and p_original_operation_id is null)
    or (p_history_action in ('undo','redo') and p_original_operation_id is not null)
  ) then
    raise exception using errcode='P1C01',message='Drawing history lineage is invalid';
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id and o.client_operation_id=p_client_operation_id;
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
  if p_original_operation_id is not null then
    select o.actor_id into v_original_actor from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id
      and o.client_operation_id=p_original_operation_id;
    if not found or v_original_actor is distinct from v_actor then
      raise exception using errcode='P1C01',
        message='Drawing history original must belong to the same actor';
    end if;
  end if;
  v_result:=private.lukas_drawing_apply_operation_pre_history_authority(
    p_revision_id,p_client_operation_id,p_operation_type,
    p_base_versions,p_forward,p_inverse
  );
  perform pg_catalog.set_config('private.lukas_drawing_history_write','1',true);
  update public.lukas_drawing_operations o set
    history_action=p_history_action,original_operation_id=p_original_operation_id
  where o.revision_id=p_revision_id and o.client_operation_id=p_client_operation_id;
  perform pg_catalog.set_config('private.lukas_drawing_history_write','',true);
  return v_result;
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

create or replace function public.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_apply_operation(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,null::text,null::uuid
  )
$$;

revoke all on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) from public,anon;
revoke all on function private.lukas_drawing_apply_operation_pre_history_authority(
  uuid,uuid,text,jsonb,jsonb,jsonb
) from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) from public,anon;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) to authenticated,service_role;
grant execute on function public.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) to authenticated,service_role;

commit;
