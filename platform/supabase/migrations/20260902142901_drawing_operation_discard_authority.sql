begin;

create table private.lukas_drawing_operation_dispositions(
  revision_id uuid not null,
  client_operation_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  operation_json jsonb not null
    check(pg_catalog.jsonb_typeof(operation_json)='object'),
  discarded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(revision_id,client_operation_id,actor_id),
  foreign key(revision_id) references public.lukas_drawing_revisions(id)
    on delete cascade
);

create or replace function private.lukas_drawing_operation_disposition_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_disposition private.lukas_drawing_operation_dispositions%rowtype;
begin
  perform 1
  from public.lukas_drawing_revisions r
  where r.id=new.revision_id
  for update;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing revision target is unavailable';
  end if;

  select d.* into v_disposition
  from private.lukas_drawing_operation_dispositions d
  where d.revision_id=new.revision_id
    and d.client_operation_id=new.client_operation_id
    and d.actor_id=new.actor_id;
  if not found then return new; end if;

  if new.operation_type is distinct from v_disposition.operation_json->>'type'
    or new.base_versions is distinct from v_disposition.operation_json->'baseVersions'
    or new.forward is distinct from v_disposition.operation_json->'forward'
    or new.inverse is distinct from v_disposition.operation_json->'inverse'
    or new.history_action is distinct from (case
      when v_disposition.operation_json ? 'historyAction'
        then v_disposition.operation_json->>'historyAction'
      else null end)
    or new.original_operation_id is distinct from (case
      when v_disposition.operation_json ? 'originalOperationId'
        then (v_disposition.operation_json->>'originalOperationId')::uuid
      else null end)
  then
    raise exception using errcode='P1C01',
      message='Drawing operation idempotency key does not match its discarded request';
  end if;
  raise exception using errcode='P1R01',
    message='Drawing operation was explicitly discarded';
end;
$$;

create trigger lukas_drawing_operation_disposition_guard
before insert on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_operation_disposition_guard();

create or replace function private.lukas_drawing_discard_operation_suffix(
  p_revision_id uuid,p_operations jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_project_id uuid;
  v_operation jsonb;
  v_existing public.lukas_drawing_operations%rowtype;
  v_disposition private.lukas_drawing_operation_dispositions%rowtype;
  v_dispositions jsonb:='[]'::jsonb;
begin
  select r.project_id into strict v_project_id
  from public.lukas_drawing_revisions r
  where r.id=p_revision_id
    and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in('admin','editor')
    and r.status='draft'
  for update;

  if pg_catalog.jsonb_typeof(p_operations) is distinct from 'array'
    or pg_catalog.jsonb_array_length(p_operations) not between 1 and 256
  then
    raise exception using errcode='P1C01',
      message='Drawing discard operation batch is invalid';
  end if;

  for v_operation in
    select value from pg_catalog.jsonb_array_elements(p_operations)
  loop
    if pg_catalog.jsonb_typeof(v_operation)<>'object'
      or not v_operation ?& array[
        'clientOperationId','revisionId','type','baseVersions','forward',
        'inverse','createdAt'
      ]
      or (
        not (v_operation ? 'historyAction')
        and not (v_operation ? 'originalOperationId')
        and v_operation-array[
          'clientOperationId','revisionId','type','baseVersions','forward',
          'inverse','createdAt'
        ]<>'{}'::jsonb
      )
      or (
        (v_operation ? 'historyAction' or v_operation ? 'originalOperationId')
        and (
          not (v_operation ? 'historyAction')
          or not (v_operation ? 'originalOperationId')
          or v_operation-array[
            'clientOperationId','revisionId','type','baseVersions','forward',
            'inverse','createdAt','historyAction','originalOperationId'
          ]<>'{}'::jsonb
        )
      )
      or private.lukas_drawing_p2_uuid(v_operation->'clientOperationId') is not true
      or private.lukas_drawing_p2_uuid(v_operation->'revisionId') is not true
      or (v_operation->>'revisionId')::uuid<>p_revision_id
      or pg_catalog.jsonb_typeof(v_operation->'type')<>'string'
      or v_operation->>'type' not in(
        'add_objects','update_objects','delete_objects','add_layer','update_layer',
        'mutate_structure','mutate_objects_with_references','restore_checkpoint'
      )
      or pg_catalog.jsonb_typeof(v_operation->'baseVersions')<>'object'
      or pg_catalog.jsonb_typeof(v_operation->'forward')<>'object'
      or pg_catalog.jsonb_typeof(v_operation->'inverse')<>'object'
      or pg_catalog.jsonb_typeof(v_operation->'createdAt')<>'string'
      or (
        v_operation ? 'historyAction'
        and (
          v_operation->>'historyAction' not in('undo','redo')
          or private.lukas_drawing_p2_uuid(
            v_operation->'originalOperationId'
          ) is not true
        )
      )
    then
      raise exception using errcode='P1C01',
        message='Drawing discard operation batch is invalid';
    end if;
  end loop;

  if (
    select pg_catalog.count(*)<>pg_catalog.count(distinct value->>'clientOperationId')
    from pg_catalog.jsonb_array_elements(p_operations)
  ) then
    raise exception using errcode='P1C01',
      message='Drawing discard operation batch contains duplicate ids';
  end if;

  for v_operation in
    select value from pg_catalog.jsonb_array_elements(p_operations)
  loop
    select o.* into v_existing
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id
      and o.client_operation_id=(v_operation->>'clientOperationId')::uuid;
    if found then
      if v_existing.actor_id is distinct from v_actor
        or v_existing.operation_type is distinct from v_operation->>'type'
        or v_existing.base_versions is distinct from v_operation->'baseVersions'
        or v_existing.forward is distinct from v_operation->'forward'
        or v_existing.inverse is distinct from v_operation->'inverse'
        or v_existing.history_action is distinct from (case
          when v_operation ? 'historyAction'
            then v_operation->>'historyAction'
          else null end)
        or v_existing.original_operation_id is distinct from (case
          when v_operation ? 'originalOperationId'
            then (v_operation->>'originalOperationId')::uuid
          else null end)
      then
        raise exception using errcode='P1C01',
          message='Drawing operation idempotency key does not match the stored request';
      end if;
      v_dispositions:=v_dispositions||pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'clientOperationId',v_existing.client_operation_id,
          'status','acked',
          'authoritativeSequence',v_existing.sequence,
          'resultVersions',v_existing.result_versions
        )
      );
      continue;
    end if;

    select d.* into v_disposition
    from private.lukas_drawing_operation_dispositions d
    where d.revision_id=p_revision_id
      and d.client_operation_id=(v_operation->>'clientOperationId')::uuid
      and d.actor_id=v_actor;
    if found then
      if v_disposition.operation_json is distinct from v_operation
      then
        raise exception using errcode='P1C01',
          message='Drawing operation idempotency key does not match its discarded request';
      end if;
    else
      insert into private.lukas_drawing_operation_dispositions(
        revision_id,client_operation_id,actor_id,operation_json
      ) values(
        p_revision_id,(v_operation->>'clientOperationId')::uuid,
        v_actor,v_operation
      );
    end if;
    v_dispositions:=v_dispositions||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'clientOperationId',v_operation->>'clientOperationId',
        'status','rejected',
        'authoritativeSequence',null,
        'resultVersions','{}'::jsonb
      )
    );
  end loop;

  return pg_catalog.jsonb_build_object('dispositions',v_dispositions);
exception
  when no_data_found then
    raise exception using errcode='P1R01',
      message='Drawing revision target is unavailable';
end;
$$;

create or replace function public.lukas_drawing_discard_operation_suffix(
  p_revision_id uuid,p_operations jsonb
) returns jsonb language sql volatile security definer set search_path='' as $$
  select private.lukas_drawing_discard_operation_suffix(
    p_revision_id,p_operations
  )
$$;

revoke all on table private.lukas_drawing_operation_dispositions
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_operation_disposition_guard()
  from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_discard_operation_suffix(uuid,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_discard_operation_suffix(uuid,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_discard_operation_suffix(uuid,jsonb)
  to authenticated;

commit;
