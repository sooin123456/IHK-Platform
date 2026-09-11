begin;

create table private.lukas_drawing_dxf_plan_attestations(
  revision_id uuid not null references public.lukas_drawing_revisions(id) on delete cascade,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  canvas_id uuid not null references public.lukas_drawing_canvases(id) on delete cascade,
  source_file_id uuid not null references public.lukas_qto_files(id) on delete restrict,
  source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
  plan_id uuid not null,
  plan_index integer not null check(plan_index between 0 and 47),
  plan_count integer not null check(plan_count between 1 and 48),
  client_operation_id uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  consumed_operation_id uuid references public.lukas_drawing_operations(id)
    on delete restrict deferrable initially deferred,
  issued_at timestamptz not null default pg_catalog.clock_timestamp(),
  consumed_at timestamptz,
  primary key(revision_id,plan_id,plan_index),
  unique(revision_id,client_operation_id),
  check(plan_index < plan_count),
  check((consumed_operation_id is null) = (consumed_at is null))
);

create index lukas_drawing_dxf_plan_attestations_operation_index
  on private.lukas_drawing_dxf_plan_attestations(
    revision_id,client_operation_id,actor_id,project_id
  );

create or replace function private.lukas_drawing_operation_request_sha256(
  p_actor_id uuid,p_project_id uuid,p_revision_id uuid,
  p_client_operation_id uuid,p_operation_type text,p_base_versions jsonb,
  p_forward jsonb,p_inverse jsonb,p_history_action text,
  p_original_operation_id uuid
) returns text language sql immutable security invoker set search_path='' as $$
  select pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_object(
      'domain','drawing-operation-request:v1',
      'actorId',p_actor_id,'projectId',p_project_id,
      'revisionId',p_revision_id,'clientOperationId',p_client_operation_id,
      'operationType',p_operation_type,'baseVersions',p_base_versions,
      'forward',p_forward,'inverse',p_inverse,
      'historyAction',p_history_action,
      'originalOperationId',p_original_operation_id
    )::text,'UTF8'),'sha256'),'hex')
$$;

create or replace function private.lukas_drawing_begin_operation_write_lease(
  p_revision_id uuid,p_client_operation_id uuid,p_actor_id uuid,
  p_operation_type text,p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns uuid language plpgsql volatile security definer set search_path='' as $$
declare
  v_token uuid:=extensions.gen_random_uuid();
  v_project_id uuid;
  v_request_sha256 text;
begin
  if p_revision_id is null or p_client_operation_id is null or p_actor_id is null then
    return null;
  end if;
  select revision.project_id into v_project_id
  from public.lukas_drawing_revisions revision where revision.id=p_revision_id;
  v_request_sha256:=private.lukas_drawing_operation_request_sha256(
    p_actor_id,v_project_id,p_revision_id,p_client_operation_id,p_operation_type,
    p_base_versions,p_forward,p_inverse,p_history_action,p_original_operation_id
  );
  insert into private.lukas_drawing_operation_write_leases(
    token,transaction_id,revision_id,client_operation_id,actor_id,request_sha256
  ) values(
    v_token,pg_catalog.txid_current(),p_revision_id,p_client_operation_id,
    p_actor_id,v_request_sha256
  );
  perform pg_catalog.set_config(
    'private.lukas_drawing_operation_write_token',v_token::text,true
  );
  return v_token;
end;
$$;

create or replace function public.lukas_drawing_attest_dxf_import_plan(
  p_actor_id uuid,p_project_id uuid,p_revision_id uuid,p_canvas_id uuid,
  p_source_file_id uuid,p_source_sha256 text,p_operations jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_claims jsonb;
  v_group jsonb;
  v_plan_id uuid;
  v_count integer;
  v_index integer:=0;
  v_operation jsonb;
  v_existing public.lukas_drawing_operations%rowtype;
  v_prefix_ended boolean:=false;
  v_prefix_sequence bigint:=0;
  v_source_count integer;
  v_phase text;
  v_phase_order integer:=0;
  v_created_layers jsonb:='{}'::jsonb;
  v_digest text;
  v_attestation private.lukas_drawing_dxf_plan_attestations%rowtype;
  v_database_role text:=pg_catalog.current_setting('role',true);
begin
  begin
    v_claims:=coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  exception when others then v_claims:='{}'::jsonb;
  end;
  if v_database_role is distinct from 'service_role' or v_claims->>'role' is distinct from 'service_role'
    or p_actor_id is null
    or not exists(
      select 1 from auth.users actor
      where actor.id=p_actor_id and coalesce(actor.is_anonymous,false)=false
    )
    or private.lukas_qto_project_feature_active(
      p_project_id,'drawing_workspace'
    ) is not true then
    raise exception using errcode='P1C01',message='DXF plan attestation requires service authority';
  end if;
  if pg_catalog.jsonb_typeof(p_operations) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_operations) not between 1 and 48
    or pg_catalog.octet_length(pg_catalog.convert_to(p_operations::text,'UTF8'))>3145728
    or (p_source_sha256 ~ '^[0-9a-f]{64}$') is not true then
    raise exception using errcode='P1C01',message='DXF plan attestation is invalid';
  end if;
  perform 1 from public.lukas_drawing_revisions revision
  where revision.id=p_revision_id and revision.project_id=p_project_id
    and revision.status='draft'
  for update;
  if not found or (private.lukas_drawing_collaboration_capability_for_user(
      p_actor_id,p_project_id
    ) in('admin','editor')) is not true then
    raise exception using errcode='P1C01',message='DXF plan attestation target is unavailable';
  end if;
  perform 1 from public.lukas_drawing_canvases canvas
  where canvas.id=p_canvas_id and canvas.revision_id=p_revision_id
    and canvas.project_id=p_project_id;
  if not found then raise exception using errcode='P1C01',message='DXF plan canvas is unavailable'; end if;
  perform 1 from public.lukas_qto_files source
  where source.id=p_source_file_id and source.project_id=p_project_id
    and source.kind='dxf' and source.immutable and source.sha256=p_source_sha256;
  if not found then raise exception using errcode='P1C01',message='DXF plan source is unavailable'; end if;

  v_count:=pg_catalog.jsonb_array_length(p_operations);
  if not exists(
    select 1 from pg_catalog.jsonb_array_elements(p_operations) operation
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(operation->'forward'->'actions')='array'
        then operation->'forward'->'actions' else '[]'::jsonb end
    ) action
    where action->>'kind'='put_source' and action->'entity'->>'sourceKind'='dxf_entity'
  ) then raise exception using errcode='P1C01',message='DXF plan requires a source phase'; end if;
  v_group:=p_operations->0->'forward'->'historyGroup';
  if private.lukas_drawing_dxf_history_group_valid(v_group) is not true
    or v_group is distinct from p_operations->0->'inverse'->'historyGroup'
    or (v_group->>'count')::integer<>v_count then
    raise exception using errcode='P1C01',message='DXF plan group is invalid';
  end if;
  v_plan_id:=(v_group->>'id')::uuid;
  for v_operation in select value from pg_catalog.jsonb_array_elements(p_operations)
  loop
    if v_operation->>'revisionId' is distinct from p_revision_id::text
      or v_operation->>'type' is distinct from 'mutate_structure'
      or private.lukas_drawing_dxf_history_group_valid(v_operation->'forward'->'historyGroup') is not true
      or v_operation->'forward'->'historyGroup' is distinct from v_operation->'inverse'->'historyGroup'
      or private.lukas_drawing_p2_uuid(v_operation->'clientOperationId') is not true
      or v_operation->'forward'->'historyGroup'->>'id'<>v_plan_id::text
      or v_operation->'forward'->'historyGroup'->>'kind'<>'dxf_import'
      or (v_operation->'forward'->'historyGroup'->>'count')::integer<>v_count
      or v_operation->'inverse'->'historyGroup'->>'id'<>v_plan_id::text
      or v_operation->'inverse'->'historyGroup'->>'kind'<>'dxf_import'
      or (v_operation->'inverse'->'historyGroup'->>'count')::integer<>v_count
      or (v_operation->'forward'->'historyGroup'->>'index')::integer<>v_index
      or (v_operation->'inverse'->'historyGroup'->>'index')::integer<>v_index
      or private.lukas_drawing_dxf_import_phase(
        v_operation->'baseVersions',v_operation->'forward',v_operation->'inverse'
      ) is null
      or (
        select pg_catalog.count(distinct candidate->>'clientOperationId')
        from pg_catalog.jsonb_array_elements(p_operations) candidate
      )<>v_count then
      raise exception using errcode='P1C01',message='DXF plan operation is invalid';
    end if;
    v_phase:=private.lukas_drawing_dxf_import_phase(
      v_operation->'baseVersions',v_operation->'forward',v_operation->'inverse'
    );
    if (v_phase in('layer_create','object_source_create','layer_finalize')) is not true then
      raise exception using errcode='P1C01',message='DXF plan phase is not an import phase';
    end if;
    if (v_phase='layer_create' and v_phase_order>0)
      or (v_phase='object_source_create' and (v_phase_order>1 or v_created_layers='{}'::jsonb))
      or (v_phase='layer_finalize' and v_phase_order=0) then
      raise exception using errcode='P1C01',message='DXF plan phase order is invalid';
    end if;
    if v_phase='layer_create' then
      select v_created_layers || pg_catalog.jsonb_object_agg(action->'entity'->>'id',true)
      into v_created_layers
      from pg_catalog.jsonb_array_elements(v_operation->'forward'->'actions') action;
    else
      v_phase_order:=case when v_phase='object_source_create' then 1 else 2 end;
      if exists(
        select 1 from pg_catalog.jsonb_array_elements(v_operation->'forward'->'actions') action
        where (action->>'kind'='put_object' and not (v_created_layers ? (action->'entity'->>'layerId')))
          or (action->>'kind'='put_layer' and not (v_created_layers ? (action->'entity'->>'id')))
      ) then raise exception using errcode='P1C01',message='DXF plan layer is not created by this plan'; end if;
    end if;
    v_source_count:=0;
    if exists(
      select 1 from pg_catalog.jsonb_array_elements(v_operation->'forward'->'actions') action
      where action->>'kind'='put_source'
        and action->'entity'->>'sourceKind'='dxf_entity'
        and (
          action->'entity'->>'sourceFileId' is distinct from p_source_file_id::text
          or action->'entity'->>'sourceSha256' is distinct from p_source_sha256
          or action->'entity'->>'revisionId' is distinct from p_revision_id::text
        )
    ) then raise exception using errcode='P1C01',message='DXF plan source binding is invalid'; end if;
    select pg_catalog.count(*) into v_source_count
    from pg_catalog.jsonb_array_elements(v_operation->'forward'->'actions') action
    where action->>'kind'='put_source' and action->'entity'->>'sourceKind'='dxf_entity';
    if v_source_count>0 and not exists(
      select 1 from pg_catalog.jsonb_array_elements(v_operation->'forward'->'actions') action
      where action->>'kind'='put_object'
    ) then raise exception using errcode='P1C01',message='DXF plan source graph is invalid'; end if;
    if exists(
      select 1 from pg_catalog.jsonb_array_elements(v_operation->'forward'->'actions') action
      where action->>'kind'='put_layer' and action->'entity'->>'canvasId' is distinct from p_canvas_id::text
    ) then raise exception using errcode='P1C01',message='DXF plan canvas binding is invalid'; end if;
    v_digest:=private.lukas_drawing_operation_request_sha256(
      p_actor_id,p_project_id,p_revision_id,
      (v_operation->>'clientOperationId')::uuid,v_operation->>'type',
      v_operation->'baseVersions',v_operation->'forward',v_operation->'inverse',null,null
    );
    select operation.* into v_existing from public.lukas_drawing_operations operation
    where operation.revision_id=p_revision_id
      and operation.client_operation_id=(v_operation->>'clientOperationId')::uuid
      and operation.history_action is null and operation.original_operation_id is null;
    if v_existing.id is null then
      v_prefix_ended:=true;
    elsif v_prefix_ended then
      raise exception using errcode='P1C01',message='DXF committed operations are not a prefix';
    elsif v_existing.sequence<=v_prefix_sequence then
      raise exception using errcode='P1C01',message='DXF committed prefix is not ordered';
    end if;
    if v_existing.id is not null then v_prefix_sequence:=v_existing.sequence; end if;
    if found and (
      v_existing.actor_id is distinct from p_actor_id
      or private.lukas_drawing_operation_request_sha256(
        v_existing.actor_id,v_existing.project_id,v_existing.revision_id,
        v_existing.client_operation_id,v_existing.operation_type,
        v_existing.base_versions,v_existing.forward,v_existing.inverse,
        v_existing.history_action,v_existing.original_operation_id
      ) is distinct from v_digest
    ) then raise exception using errcode='P1C01',message='DXF committed prefix is not exact'; end if;
    select attestation.* into v_attestation
    from private.lukas_drawing_dxf_plan_attestations attestation
    where attestation.revision_id=p_revision_id and attestation.plan_id=v_plan_id
      and attestation.plan_index=v_index
    order by attestation.plan_index for update;
    if found and (
      v_attestation.project_id is distinct from p_project_id
      or v_attestation.actor_id is distinct from p_actor_id
      or v_attestation.canvas_id is distinct from p_canvas_id
      or v_attestation.source_file_id is distinct from p_source_file_id
      or v_attestation.source_sha256 is distinct from p_source_sha256
      or v_attestation.plan_count<>v_count
      or v_attestation.client_operation_id<>(v_operation->>'clientOperationId')::uuid
      or v_attestation.request_sha256 is distinct from v_digest
    ) then raise exception using errcode='P1C01',message='DXF plan re-attestation changed'; end if;
    if not found then
      insert into private.lukas_drawing_dxf_plan_attestations(
        revision_id,project_id,actor_id,canvas_id,source_file_id,source_sha256,
        plan_id,plan_index,plan_count,client_operation_id,request_sha256,
        consumed_operation_id,consumed_at
      ) values(
        p_revision_id,p_project_id,p_actor_id,p_canvas_id,p_source_file_id,p_source_sha256,
        v_plan_id,v_index,v_count,(v_operation->>'clientOperationId')::uuid,v_digest,
        case when v_existing.id is null then null else v_existing.id end,
        case when v_existing.id is null then null else pg_catalog.clock_timestamp() end
      );
    elsif v_existing.id is not null and v_attestation.consumed_operation_id is null then
      update private.lukas_drawing_dxf_plan_attestations attestation
      set consumed_operation_id=v_existing.id,consumed_at=pg_catalog.clock_timestamp()
      where attestation.revision_id=v_attestation.revision_id
        and attestation.plan_id=v_attestation.plan_id
        and attestation.plan_index=v_attestation.plan_index
        and attestation.consumed_operation_id is null;
    elsif v_existing.id is not null
      and v_attestation.consumed_operation_id is distinct from v_existing.id then
      raise exception using errcode='P1C01',message='DXF committed prefix proof is not exact';
    end if;
    v_index:=v_index+1;
  end loop;
  if exists(
    select 1 from public.lukas_drawing_operations operation
    where operation.revision_id=p_revision_id and operation.history_action is null
      and operation.forward->'historyGroup'->>'id'=v_plan_id::text
      and not exists(
        select 1 from pg_catalog.jsonb_array_elements(p_operations) candidate
        where candidate->>'clientOperationId'=operation.client_operation_id::text
          and private.lukas_drawing_operation_request_sha256(
            operation.actor_id,operation.project_id,operation.revision_id,
            operation.client_operation_id,operation.operation_type,
            operation.base_versions,operation.forward,operation.inverse,
            operation.history_action,operation.original_operation_id
          )=private.lukas_drawing_operation_request_sha256(
            p_actor_id,p_project_id,p_revision_id,
            (candidate->>'clientOperationId')::uuid,candidate->>'type',
            candidate->'baseVersions',candidate->'forward',candidate->'inverse',null,null
          )
      )
  ) then raise exception using errcode='P1C01',message='DXF plan group has a rogue member'; end if;
  return pg_catalog.jsonb_build_object(
    'planId',v_plan_id,'planCount',v_count,
    'alreadyAppliedCount',(
      select pg_catalog.count(*) from private.lukas_drawing_dxf_plan_attestations attestation
      where attestation.revision_id=p_revision_id and attestation.plan_id=v_plan_id
        and attestation.consumed_operation_id is not null
    )
  );
end;
$$;

revoke all on table private.lukas_drawing_dxf_plan_attestations
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_operation_request_sha256(
  uuid,uuid,uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_attest_dxf_import_plan(
  uuid,uuid,uuid,uuid,uuid,text,jsonb
) from public,anon,authenticated;
grant execute on function public.lukas_drawing_attest_dxf_import_plan(
  uuid,uuid,uuid,uuid,uuid,text,jsonb
) to service_role;

commit;
