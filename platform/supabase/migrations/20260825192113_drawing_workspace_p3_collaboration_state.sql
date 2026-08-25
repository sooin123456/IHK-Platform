begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname='lukas_drawing_collaboration') then
    create role lukas_drawing_collaboration noinherit nologin;
  end if;
end;
$$;

create table private.lukas_drawing_collaboration_states (
  revision_id uuid primary key,
  project_id uuid not null,
  schema_version smallint not null check (schema_version=1),
  yjs_state bytea not null,
  yjs_sha256 text not null check (yjs_sha256 ~ '^[0-9a-f]{64}$'),
  base_operation_sequence bigint not null check (base_operation_sequence>=0),
  byte_size integer not null,
  persisted_at timestamptz not null default pg_catalog.now(),
  constraint lukas_drawing_collaboration_states_revision_fkey
    foreign key (revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete cascade,
  constraint lukas_drawing_collaboration_states_bytes_check check (
    pg_catalog.octet_length(yjs_state) between 1 and 8388608
    and byte_size=pg_catalog.octet_length(yjs_state)
    and yjs_sha256=pg_catalog.encode(extensions.digest(yjs_state,'sha256'),'hex')
  )
);

alter table private.lukas_drawing_collaboration_states enable row level security;
revoke all on table private.lukas_drawing_collaboration_states from public,anon,authenticated,service_role,lukas_drawing_collaboration;

create or replace function private.lukas_drawing_collaboration_capability_for_user(
  p_user_id uuid,p_project_id uuid
) returns text language sql stable security definer set search_path='' as $$
  select case
    when p_user_id is null then null
    when exists(
      select 1 from auth.users u
      where u.id=p_user_id
        and pg_catalog.to_jsonb(u)->'raw_app_meta_data'->>'role'='hangil_staff'
    ) then 'admin'
    when p.owner_id=p_user_id then 'admin'
    else case (
      select m.role from public.lukas_qto_project_members m
      where m.project_id=p.id and m.user_id=p_user_id
    )
      when 'estimator' then 'editor'
      when 'reviewer' then 'reviewer'
      when 'site' then 'commenter'
      when 'procurement' then 'commenter'
      when 'viewer' then 'viewer'
    end
  end
  from public.lukas_qto_projects p where p.id=p_project_id
$$;

-- Preserve the existing UI/RPC signature while sharing one role-to-capability map
-- with verified collaboration-service users.
create or replace function private.lukas_drawing_workspace_capability(p_project_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select private.lukas_drawing_collaboration_capability_for_user(
    (select auth.uid()),p_project_id
  )
$$;

create or replace function private.lukas_drawing_collaboration_authorize(
  p_user_id uuid,p_project_id uuid,p_revision_id uuid
) returns table(capability text,can_write boolean,revision_status text)
language plpgsql stable security definer set search_path='' as $$
declare v_capability text; v_status text;
begin
  select r.status,
    private.lukas_drawing_collaboration_capability_for_user(p_user_id,r.project_id)
  into v_status,v_capability
  from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id;
  if not found or v_capability is null then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  return query select v_capability,
    v_capability in ('admin','editor') and v_status='draft',v_status;
end;
$$;

create or replace function private.lukas_drawing_collaboration_load_state(
  p_user_id uuid,p_project_id uuid,p_revision_id uuid
) returns table(
  revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
  yjs_sha256 text,base_operation_sequence bigint,byte_size integer,
  persisted_at timestamptz
) language plpgsql stable security definer set search_path='' as $$
begin
  perform 1 from private.lukas_drawing_collaboration_authorize(
    p_user_id,p_project_id,p_revision_id
  );
  return query
  select s.revision_id,s.project_id,s.schema_version,s.yjs_state,s.yjs_sha256,
    s.base_operation_sequence,s.byte_size,s.persisted_at
  from private.lukas_drawing_collaboration_states s
  where s.revision_id=p_revision_id and s.project_id=p_project_id;
end;
$$;

create or replace function private.lukas_drawing_collaboration_store_state(
  p_user_id uuid,p_project_id uuid,p_revision_id uuid,p_schema_version smallint,
  p_yjs_state bytea,p_base_operation_sequence bigint
) returns table(
  revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
  yjs_sha256 text,base_operation_sequence bigint,byte_size integer,
  persisted_at timestamptz
) language plpgsql security definer set search_path='' as $$
declare v_access record; v_max_sequence bigint; v_sha text;
begin
  select * into v_access from private.lukas_drawing_collaboration_authorize(
    p_user_id,p_project_id,p_revision_id
  );
  if not v_access.can_write then
    raise exception using errcode='P3A02',message='Drawing collaboration room is read-only';
  end if;
  if p_schema_version is distinct from 1
    or p_yjs_state is null
    or pg_catalog.octet_length(p_yjs_state) not between 1 and 8388608
    or p_base_operation_sequence is null or p_base_operation_sequence<0 then
    raise exception using errcode='P3S01',message='Drawing collaboration state is invalid';
  end if;
  select r.status into v_access.revision_status
  from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.project_id=p_project_id
  for update;
  if not found or v_access.revision_status<>'draft' then
    raise exception using errcode='P3A02',message='Drawing collaboration room is read-only';
  end if;
  select coalesce(pg_catalog.max(o.sequence),0) into v_max_sequence
  from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id and o.project_id=p_project_id;
  if p_base_operation_sequence>v_max_sequence then
    raise exception using errcode='P3S01',message='Drawing collaboration sequence is invalid';
  end if;
  v_sha:=pg_catalog.encode(extensions.digest(p_yjs_state,'sha256'),'hex');
  insert into private.lukas_drawing_collaboration_states(
    revision_id,project_id,schema_version,yjs_state,yjs_sha256,
    base_operation_sequence,byte_size,persisted_at
  ) values(
    p_revision_id,p_project_id,p_schema_version,p_yjs_state,v_sha,
    p_base_operation_sequence,pg_catalog.octet_length(p_yjs_state),pg_catalog.now()
  ) on conflict on constraint lukas_drawing_collaboration_states_pkey do update set
    schema_version=excluded.schema_version,yjs_state=excluded.yjs_state,
    yjs_sha256=excluded.yjs_sha256,
    base_operation_sequence=excluded.base_operation_sequence,
    byte_size=excluded.byte_size,persisted_at=excluded.persisted_at
  where private.lukas_drawing_collaboration_states.project_id=excluded.project_id
    and private.lukas_drawing_collaboration_states.base_operation_sequence
      <=excluded.base_operation_sequence;
  if not found then
    raise exception using errcode='P3S02',message='Drawing collaboration sequence cannot move backward';
  end if;
  return query select * from private.lukas_drawing_collaboration_load_state(
    p_user_id,p_project_id,p_revision_id
  );
end;
$$;

create or replace function private.lukas_drawing_collaboration_lookup_operations(
  p_revision_id uuid,p_client_operation_ids uuid[]
) returns table(
  revision_id uuid,client_operation_id uuid,actor_id uuid,operation_type text,
  base_versions jsonb,forward jsonb,inverse jsonb,sequence bigint,result_versions jsonb
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
    o.base_versions,o.forward,o.inverse,o.sequence,o.result_versions
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
    ) payload
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

create or replace function public.lukas_drawing_collaboration_bootstrap(
  p_revision_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_project_id uuid;
begin
  if v_actor is null then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  select r.project_id into v_project_id from public.lukas_drawing_revisions r
  where r.id=p_revision_id;
  if not found then
    raise exception using errcode='P3A01',message='Drawing collaboration target is unavailable';
  end if;
  return private.lukas_drawing_collaboration_bootstrap(
    v_actor,v_project_id,p_revision_id
  );
end;
$$;

revoke all on function private.lukas_drawing_collaboration_capability_for_user(uuid,uuid) from public,anon,authenticated,service_role,lukas_drawing_collaboration;
revoke all on function private.lukas_drawing_collaboration_authorize(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_load_state(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_store_state(uuid,uuid,uuid,smallint,bytea,bigint) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_lookup_operations(uuid,uuid[]) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_collaboration_bootstrap(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant usage on schema private to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_authorize(uuid,uuid,uuid) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_load_state(uuid,uuid,uuid) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_store_state(uuid,uuid,uuid,smallint,bytea,bigint) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_lookup_operations(uuid,uuid[]) to lukas_drawing_collaboration;
grant execute on function private.lukas_drawing_collaboration_bootstrap(uuid,uuid,uuid) to lukas_drawing_collaboration;

revoke all on function public.lukas_drawing_collaboration_bootstrap(uuid) from public,anon,authenticated,service_role,lukas_drawing_collaboration;
grant execute on function public.lukas_drawing_collaboration_bootstrap(uuid) to authenticated;

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    if pg_catalog.to_regclass('public.lukas_drawing_revisions') is not null and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lukas_drawing_revisions') then execute 'alter publication supabase_realtime add table public.lukas_drawing_revisions'; end if;
    if pg_catalog.to_regclass('public.lukas_drawing_object_issue_links') is not null and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lukas_drawing_object_issue_links') then execute 'alter publication supabase_realtime add table public.lukas_drawing_object_issue_links'; end if;
    if pg_catalog.to_regclass('public.lukas_drawing_issues') is not null and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lukas_drawing_issues') then execute 'alter publication supabase_realtime add table public.lukas_drawing_issues'; end if;
    if pg_catalog.to_regclass('public.lukas_drawing_issue_comments') is not null and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lukas_drawing_issue_comments') then execute 'alter publication supabase_realtime add table public.lukas_drawing_issue_comments'; end if;
    if pg_catalog.to_regclass('public.lukas_drawing_issue_events') is not null and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lukas_drawing_issue_events') then execute 'alter publication supabase_realtime add table public.lukas_drawing_issue_events'; end if;
    if pg_catalog.to_regclass('public.lukas_drawing_issue_approvals') is not null and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lukas_drawing_issue_approvals') then execute 'alter publication supabase_realtime add table public.lukas_drawing_issue_approvals'; end if;
    if pg_catalog.to_regclass('public.lukas_qto_project_members') is not null and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='lukas_qto_project_members') then execute 'alter publication supabase_realtime add table public.lukas_qto_project_members'; end if;
  end if;
end;
$$;

commit;
