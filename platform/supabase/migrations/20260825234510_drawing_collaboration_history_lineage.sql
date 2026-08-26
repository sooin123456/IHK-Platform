begin;

alter table public.lukas_drawing_operations
  add column history_action text,
  add column original_operation_id uuid;
alter table public.lukas_drawing_operations
  add constraint lukas_drawing_operations_history_pair_check check (
    (history_action is null and original_operation_id is null)
    or (history_action in ('undo','redo') and original_operation_id is not null)
  ),
  add constraint lukas_drawing_operations_history_original_fkey
    foreign key(revision_id,original_operation_id)
    references public.lukas_drawing_operations(revision_id,client_operation_id)
    on delete cascade;

create function private.lukas_drawing_operations_history_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()>1 then return old; end if;
  if tg_op='UPDATE' and current_user not in ('authenticated','anon')
    and pg_catalog.current_setting('private.lukas_drawing_p2_operation_rewrite',true)=old.id::text
    and new.id=old.id and new.revision_id=old.revision_id
    and new.project_id=old.project_id and new.sequence=old.sequence
    and new.client_operation_id=old.client_operation_id
    and new.operation_type=old.operation_type and new.actor_id=old.actor_id
    and new.created_at=old.created_at then return new; end if;
  if tg_op='UPDATE'
    and pg_catalog.current_setting('private.lukas_drawing_history_write',true)='1'
    and old.history_action is null and old.original_operation_id is null
    and (pg_catalog.to_jsonb(new)-'history_action'-'original_operation_id')
      =(pg_catalog.to_jsonb(old)-'history_action'-'original_operation_id') then
    return new;
  end if;
  raise exception '% is append-only',tg_table_name;
end;
$$;
drop trigger lukas_drawing_operations_append_only on public.lukas_drawing_operations;
create trigger lukas_drawing_operations_append_only
before update or delete on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_operations_history_guard();

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
  v_result:=private.lukas_drawing_apply_operation(
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

create or replace function public.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language sql security definer set search_path='' as $$
  select private.lukas_drawing_apply_operation(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,p_history_action,p_original_operation_id
  )
$$;

drop function private.lukas_drawing_collaboration_lookup_operations(uuid,uuid[]);
create function private.lukas_drawing_collaboration_lookup_operations(
  p_revision_id uuid,p_client_operation_ids uuid[]
) returns table(
  revision_id uuid,client_operation_id uuid,actor_id uuid,operation_type text,
  base_versions jsonb,forward jsonb,inverse jsonb,history_action text,
  original_operation_id uuid,sequence bigint,result_versions jsonb
) language plpgsql stable security definer set search_path='' as $$
begin
  if p_revision_id is null or p_client_operation_ids is null
    or pg_catalog.cardinality(p_client_operation_ids) not between 1 and 256
    or pg_catalog.array_position(p_client_operation_ids,null) is not null
    or (select pg_catalog.count(*)<>pg_catalog.count(distinct x)
        from pg_catalog.unnest(p_client_operation_ids) x) then
    raise exception using errcode='P3S01',message='Drawing collaboration lookup is invalid';
  end if;
  return query
  select o.revision_id,o.client_operation_id,o.actor_id,o.operation_type,
    o.base_versions,o.forward,o.inverse,o.history_action,
    o.original_operation_id,o.sequence,o.result_versions
  from public.lukas_drawing_operations o
  join public.lukas_drawing_revisions r
    on r.id=o.revision_id and r.project_id=o.project_id
  where o.revision_id=p_revision_id
    and o.client_operation_id=any(p_client_operation_ids)
  order by o.sequence;
end;
$$;

create or replace function private.lukas_drawing_collaboration_bootstrap(
  p_user_id uuid,p_project_id uuid,p_revision_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_access record; v_graph jsonb; v_sequence bigint; v_sha text; v_outcomes jsonb;
begin
  select * into v_access from private.lukas_drawing_collaboration_authorize(
    p_user_id,p_project_id,p_revision_id
  );
  v_graph:=private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true);
  if v_graph is null or v_graph->>'schemaVersion'<>'2' then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  v_sequence:=(v_graph->>'operationSequence')::bigint;
  v_sha:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_graph::text,'UTF8'),'sha256'),'hex'
  );
  select coalesce(pg_catalog.jsonb_agg(x.payload order by x.sequence),'[]'::jsonb)
  into v_outcomes from (
    select o.sequence,pg_catalog.jsonb_build_object(
      'revisionId',o.revision_id,'clientOperationId',o.client_operation_id,
      'actorId',o.actor_id,'operationType',o.operation_type,
      'baseVersions',o.base_versions,'forward',o.forward,'inverse',o.inverse,
      'sequence',o.sequence,'resultVersions',o.result_versions
    ) || case when o.history_action is null then '{}'::jsonb else
      pg_catalog.jsonb_build_object('historyAction',o.history_action,
        'originalOperationId',o.original_operation_id) end payload
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.project_id=p_project_id
    order by o.sequence desc limit 256
  ) x;
  return pg_catalog.jsonb_build_object(
    'canonicalJson',v_graph,'operationSequence',v_sequence,
    'schemaVersion',2,'sha256',v_sha,'revisionStatus',v_access.revision_status,
    'capability',v_access.capability,'canWrite',v_access.can_write,
    'recentOutcomes',v_outcomes
  );
end;
$$;

create or replace function private.lukas_drawing_collaboration_service_bootstrap(
  p_project_id uuid,p_revision_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_graph jsonb; v_sequence bigint; v_sha text; v_outcomes jsonb;
begin
  if not exists(
    select 1 from public.lukas_drawing_revisions r
    where r.id=p_revision_id and r.project_id=p_project_id and r.status='draft'
  ) then
    raise exception using errcode='P3A02',message='Drawing collaboration room is read-only';
  end if;
  v_graph:=private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true);
  if v_graph is null or v_graph->>'schemaVersion'<>'2' then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  v_sequence:=(v_graph->>'operationSequence')::bigint;
  v_sha:=pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_graph::text,'UTF8'),'sha256'),'hex'
  );
  select coalesce(pg_catalog.jsonb_agg(x.payload order by x.sequence),'[]'::jsonb)
  into v_outcomes from (
    select o.sequence,pg_catalog.jsonb_build_object(
      'revisionId',o.revision_id,'clientOperationId',o.client_operation_id,
      'actorId',o.actor_id,'operationType',o.operation_type,
      'baseVersions',o.base_versions,'forward',o.forward,'inverse',o.inverse,
      'sequence',o.sequence,'resultVersions',o.result_versions
    ) || case when o.history_action is null then '{}'::jsonb else
      pg_catalog.jsonb_build_object('historyAction',o.history_action,
        'originalOperationId',o.original_operation_id) end payload
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.project_id=p_project_id
      and o.actor_id in (
        select recent.actor_id from public.lukas_drawing_operations recent
        where recent.revision_id=p_revision_id and recent.project_id=p_project_id
        order by recent.sequence desc limit 256
      )
    order by o.sequence limit 10000
  ) x;
  return pg_catalog.jsonb_build_object(
    'sha256',v_sha,'operationSequence',v_sequence,'historyOutcomes',v_outcomes
  );
end;
$$;

revoke all on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) from public,anon;
revoke all on function public.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) from public,anon;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) to authenticated,service_role;
grant execute on function public.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) to authenticated,service_role;
revoke all on function private.lukas_drawing_operations_history_guard()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_lookup_operations(uuid,uuid[])
  from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_collaboration_lookup_operations(uuid,uuid[])
  to lukas_drawing_collaboration;
revoke all on function private.lukas_drawing_collaboration_service_bootstrap(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_collaboration_service_bootstrap(uuid,uuid)
  to lukas_drawing_collaboration;

commit;
