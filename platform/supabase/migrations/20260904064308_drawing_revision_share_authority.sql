begin;

-- Public drawing links are a separate authority from the legacy project-wide
-- share table. The bearer is generated outside Postgres; only its SHA-256 is
-- retained here. Every row remains bound to one exact frozen snapshot.
do $$
begin
  if pg_catalog.to_regclass('public.lukas_qto_projects') is null
    or pg_catalog.to_regclass('public.lukas_drawing_documents') is null
    or pg_catalog.to_regclass('public.lukas_drawing_revisions') is null
    or pg_catalog.to_regclass('public.lukas_drawing_snapshots') is null
    or pg_catalog.to_regprocedure(
      'private.lukas_qto_verified_session()'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.lukas_drawing_workspace_capability(uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.lukas_drawing_workspace_capability_pre_entitlement(uuid)'
    ) is null
    or pg_catalog.to_regprocedure(
      'private.lukas_qto_project_feature_active(uuid,text)'
    ) is null then
    raise exception using errcode='PDS01',
      message='Drawing share base authority is unavailable';
  end if;
end;
$$;

create table public.lukas_qto_drawing_shares (
  id uuid primary key default extensions.gen_random_uuid(),
  token_hash text not null unique
    check(token_hash ~ '^[0-9a-f]{64}$'),
  project_id uuid not null
    references public.lukas_qto_projects(id) on delete cascade,
  document_id uuid not null,
  revision_id uuid not null,
  revision_version bigint not null check(revision_version>0),
  snapshot_sha256 text not null
    check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  revoke_reason text check(
    revoke_reason is null or (
      revoke_reason=pg_catalog.btrim(revoke_reason)
      and pg_catalog.char_length(revoke_reason) between 1 and 500
    )
  ),
  unique(
    id,project_id,document_id,revision_id,revision_version,snapshot_sha256
  ),
  constraint lukas_qto_drawing_shares_document_fkey
    foreign key(document_id,project_id)
    references public.lukas_drawing_documents(id,project_id)
    on delete cascade,
  constraint lukas_qto_drawing_shares_revision_fkey
    foreign key(revision_id,document_id,project_id)
    references public.lukas_drawing_revisions(id,document_id,project_id)
    on delete cascade,
  constraint lukas_qto_drawing_shares_snapshot_fkey
    foreign key(
      revision_id,project_id,revision_version,snapshot_sha256
    ) references public.lukas_drawing_snapshots(
      revision_id,project_id,revision_version,sha256
    ) on delete cascade,
  constraint lukas_qto_drawing_shares_expiry_check check(
    expires_at>created_at
    and expires_at<=created_at+interval '7 days'
  ),
  constraint lukas_qto_drawing_shares_revocation_check check(
    (revoked_at is null and revoked_by is null and revoke_reason is null)
    or (
      revoked_at is not null and revoked_at>=created_at
      and revoked_by is not null and revoke_reason is not null
    )
  )
);

create table public.lukas_qto_drawing_share_events (
  id uuid primary key default extensions.gen_random_uuid(),
  share_id uuid not null,
  project_id uuid not null,
  document_id uuid not null,
  revision_id uuid not null,
  revision_version bigint not null check(revision_version>0),
  snapshot_sha256 text not null
    check(snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  event_type text not null check(event_type in('created','revoked')),
  request_id uuid not null,
  request_sha256 text not null
    check(request_sha256 ~ '^[0-9a-f]{64}$'),
  details jsonb not null check(pg_catalog.jsonb_typeof(details)='object'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null,
  unique(actor_id,request_id),
  constraint lukas_qto_drawing_share_events_share_fkey
    foreign key(
      share_id,project_id,document_id,revision_id,revision_version,
      snapshot_sha256
    ) references public.lukas_qto_drawing_shares(
      id,project_id,document_id,revision_id,revision_version,snapshot_sha256
    ) on delete cascade
);

create index lukas_qto_drawing_shares_scope_idx
  on public.lukas_qto_drawing_shares(
    project_id,document_id,revision_id,revision_version,created_at desc,id desc
  );
create index lukas_qto_drawing_shares_active_idx
  on public.lukas_qto_drawing_shares(
    project_id,revision_id,revision_version,expires_at,id
  ) where revoked_at is null;
create index lukas_qto_drawing_shares_created_by_idx
  on public.lukas_qto_drawing_shares(created_by);
create index lukas_qto_drawing_shares_revoked_by_idx
  on public.lukas_qto_drawing_shares(revoked_by)
  where revoked_by is not null;
create index lukas_qto_drawing_share_events_share_idx
  on public.lukas_qto_drawing_share_events(
    share_id,created_at,id
  );
create index lukas_qto_drawing_share_events_actor_idx
  on public.lukas_qto_drawing_share_events(actor_id,created_at desc,id desc);

create function private.lukas_qto_drawing_share_request_sha(p_values jsonb)
returns text language sql immutable security invoker set search_path='' as $$
  select pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_values::text,'UTF8'),'sha256'
    ),'hex'
  )
$$;

create function private.lukas_qto_drawing_share_event_append_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE'
    and pg_catalog.pg_trigger_depth()>1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project',true
    )=old.project_id::text
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    )
    and not exists(
      select 1 from public.lukas_qto_projects p
      where p.id=old.project_id
    ) then
    return old;
  end if;
  raise exception using errcode='PDS02',
    message='Drawing share evidence is append-only';
end;
$$;

create trigger lukas_qto_drawing_share_events_append_only
before update or delete on public.lukas_qto_drawing_share_events
for each row execute function
  private.lukas_qto_drawing_share_event_append_guard();

create function private.lukas_qto_drawing_share_mutation_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_event_id uuid; v_event public.lukas_qto_drawing_share_events%rowtype;
begin
  if tg_op='DELETE'
    and pg_catalog.pg_trigger_depth()>1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project',true
    )=old.project_id::text
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    )
    and not exists(
      select 1 from public.lukas_qto_projects p
      where p.id=old.project_id
    ) then
    return old;
  end if;
  if tg_op='UPDATE'
    and current_user=pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    )
    and new.id=old.id
    and new.token_hash=old.token_hash
    and new.project_id=old.project_id
    and new.document_id=old.document_id
    and new.revision_id=old.revision_id
    and new.revision_version=old.revision_version
    and new.snapshot_sha256=old.snapshot_sha256
    and new.created_by=old.created_by
    and new.created_at=old.created_at
    and new.expires_at=old.expires_at
    and old.revoked_at is null
    and old.revoked_by is null
    and old.revoke_reason is null
    and new.revoked_at is not null
    and new.revoked_by is not null
    and new.revoke_reason is not null then
    v_event_id:=nullif(pg_catalog.current_setting(
      'app.lukas_drawing_share_event_id',true
    ),'')::uuid;
    select event.* into v_event
    from public.lukas_qto_drawing_share_events event
    where event.id=v_event_id
      and event.event_type='revoked'
      and event.share_id=old.id
      and event.project_id=old.project_id
      and event.document_id=old.document_id
      and event.revision_id=old.revision_id
      and event.revision_version=old.revision_version
      and event.snapshot_sha256=old.snapshot_sha256
      and event.actor_id=new.revoked_by
      and event.created_at=new.revoked_at
      and event.details->>'reason'=new.revoke_reason;
    if found then return new; end if;
  end if;
  raise exception using errcode='PDS02',
    message='Drawing share changes are RPC-only and audited';
end;
$$;

create trigger lukas_qto_drawing_shares_mutation_guard
before update or delete on public.lukas_qto_drawing_shares
for each row execute function private.lukas_qto_drawing_share_mutation_guard();

create function private.lukas_qto_drawing_share_project_move_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.organization_id is distinct from old.organization_id
    and exists(
      select 1 from public.lukas_qto_drawing_shares share
      where share.project_id=old.id
        and share.revoked_at is null
        and share.expires_at>pg_catalog.now()
    ) then
    raise exception using errcode='PDS08',
      message='Project with an active drawing share cannot move organizations';
  end if;
  return new;
end;
$$;

create trigger lukas_qto_drawing_share_project_move_guard
before update of organization_id on public.lukas_qto_projects
for each row execute function
  private.lukas_qto_drawing_share_project_move_guard();

create function public.lukas_qto_create_drawing_share(
  p_project_id uuid,
  p_document_id uuid,
  p_revision_id uuid,
  p_revision_version bigint,
  p_snapshot_sha256 text,
  p_token_hash text,
  p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_share public.lukas_qto_drawing_shares%rowtype;
  v_event public.lukas_qto_drawing_share_events%rowtype;
  v_request_sha256 text; v_result jsonb;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if v_actor is null
    or private.lukas_qto_verified_session() is not true
    or private.lukas_drawing_workspace_capability(p_project_id)
      is distinct from 'admin' then
    raise exception using errcode='PDS03',
      message='Drawing share authority denied';
  end if;
  if p_request_id is null
    or p_revision_version is null or p_revision_version<1
    or p_snapshot_sha256 is null
      or p_snapshot_sha256!~'^[0-9a-f]{64}$'
    or p_token_hash is null or p_token_hash!~'^[0-9a-f]{64}$' then
    raise exception using errcode='PDS04',
      message='Drawing share input is invalid';
  end if;
  v_request_sha256:=private.lukas_qto_drawing_share_request_sha(
    pg_catalog.jsonb_build_array(
      'create',p_project_id,p_document_id,p_revision_id,
      p_revision_version,p_snapshot_sha256,p_token_hash
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':'||p_request_id::text,0
  ));
  select event.* into v_event
  from public.lukas_qto_drawing_share_events event
  where event.actor_id=v_actor and event.request_id=p_request_id;
  if found then
    if v_event.event_type<>'created'
      or v_event.request_sha256<>v_request_sha256 then
      raise exception using errcode='PDS05',
        message='Drawing share request conflict';
    end if;
    return v_event.details;
  end if;

  select revision.* into v_revision
  from public.lukas_drawing_revisions revision
  join public.lukas_qto_projects project
    on project.id=revision.project_id
      and project.archived_at is null
      and project.deletion_requested_at is null
  join public.lukas_drawing_documents document
    on document.id=revision.document_id
      and document.project_id=revision.project_id
  join public.lukas_drawing_snapshots snapshot
    on snapshot.revision_id=revision.id
      and snapshot.project_id=revision.project_id
      and snapshot.revision_version=revision.version
  where revision.id=p_revision_id
    and revision.document_id=p_document_id
    and revision.project_id=p_project_id
    and revision.version=p_revision_version
    and revision.status in(
      'review_requested','reviewed','approved','superseded'
    )
    and snapshot.sha256=p_snapshot_sha256
  for update of project,revision;
  if not found then
    raise exception using errcode='PDS06',
      message='Drawing share target is unavailable';
  end if;
  -- Project transfer and archival serialize on this row. Re-evaluate the
  -- caller after the lock so an old-organization Admin cannot create a link
  -- after a concurrent transfer commits.
  if private.lukas_drawing_workspace_capability(p_project_id)
      is distinct from 'admin' then
    raise exception using errcode='PDS03',
      message='Drawing share authority denied';
  end if;
  if (
    select pg_catalog.count(*)>=100
    from public.lukas_qto_drawing_shares share
    where share.project_id=p_project_id
      and share.document_id=p_document_id
      and share.revision_id=p_revision_id
      and share.revision_version=p_revision_version
      and share.snapshot_sha256=p_snapshot_sha256
      and share.revoked_at is null
      and share.expires_at>v_now
  ) then
    raise exception using errcode='PDS09',
      message='Drawing share active-link limit reached';
  end if;

  begin
    insert into public.lukas_qto_drawing_shares(
      token_hash,project_id,document_id,revision_id,revision_version,
      snapshot_sha256,created_by,created_at,expires_at
    ) values(
      p_token_hash,p_project_id,p_document_id,p_revision_id,
      p_revision_version,p_snapshot_sha256,v_actor,v_now,
      v_now+interval '7 days'
    ) returning * into v_share;
  exception when unique_violation then
    raise exception using errcode='PDS07',
      message='Drawing share token is unavailable';
  end;

  v_result:=pg_catalog.jsonb_build_object(
    'shareId',v_share.id,
    'projectId',v_share.project_id,
    'documentId',v_share.document_id,
    'revisionId',v_share.revision_id,
    'revisionVersion',v_share.revision_version,
    'snapshotSha256',v_share.snapshot_sha256,
    'createdAt',v_share.created_at,
    'expiresAt',v_share.expires_at,
    'revokedAt',null,
    'requestId',p_request_id
  );
  insert into public.lukas_qto_drawing_share_events(
    share_id,project_id,document_id,revision_id,revision_version,
    snapshot_sha256,event_type,request_id,request_sha256,details,
    actor_id,created_at
  ) values(
    v_share.id,v_share.project_id,v_share.document_id,v_share.revision_id,
    v_share.revision_version,v_share.snapshot_sha256,'created',p_request_id,
    v_request_sha256,v_result,v_actor,v_now
  );
  return v_result;
end;
$$;

create function public.lukas_qto_revoke_drawing_share(
  p_project_id uuid,
  p_document_id uuid,
  p_revision_id uuid,
  p_revision_version bigint,
  p_snapshot_sha256 text,
  p_share_id uuid,
  p_reason text,
  p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
  v_share public.lukas_qto_drawing_shares%rowtype;
  v_event public.lukas_qto_drawing_share_events%rowtype;
  v_request_sha256 text; v_reason text; v_result jsonb;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if v_actor is null
    or private.lukas_qto_verified_session() is not true
    or private.lukas_drawing_workspace_capability_pre_entitlement(p_project_id)
      is distinct from 'admin' then
    raise exception using errcode='PDS03',
      message='Drawing share authority denied';
  end if;
  v_reason:=pg_catalog.btrim(pg_catalog.regexp_replace(
    coalesce(p_reason,''),'[[:cntrl:]]+',' ','g'
  ));
  if p_request_id is null or p_share_id is null
    or p_revision_version is null or p_revision_version<1
    or p_snapshot_sha256 is null
      or p_snapshot_sha256!~'^[0-9a-f]{64}$'
    or pg_catalog.char_length(v_reason) not between 1 and 500 then
    raise exception using errcode='PDS04',
      message='Drawing share input is invalid';
  end if;
  v_request_sha256:=private.lukas_qto_drawing_share_request_sha(
    pg_catalog.jsonb_build_array(
      'revoke',p_project_id,p_document_id,p_revision_id,
      p_revision_version,p_snapshot_sha256,p_share_id,v_reason
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':'||p_request_id::text,0
  ));
  select event.* into v_event
  from public.lukas_qto_drawing_share_events event
  where event.actor_id=v_actor and event.request_id=p_request_id;
  if found then
    if v_event.event_type<>'revoked'
      or v_event.request_sha256<>v_request_sha256 then
      raise exception using errcode='PDS05',
        message='Drawing share request conflict';
    end if;
    return v_event.details;
  end if;

  select share.* into v_share
  from public.lukas_qto_drawing_shares share
  where share.id=p_share_id
    and share.project_id=p_project_id
    and share.document_id=p_document_id
    and share.revision_id=p_revision_id
    and share.revision_version=p_revision_version
    and share.snapshot_sha256=p_snapshot_sha256
    and share.revoked_at is null
  for update;
  if not found then
    raise exception using errcode='PDS06',
      message='Drawing share target is unavailable';
  end if;

  v_result:=pg_catalog.jsonb_build_object(
    'shareId',v_share.id,
    'projectId',v_share.project_id,
    'documentId',v_share.document_id,
    'revisionId',v_share.revision_id,
    'revisionVersion',v_share.revision_version,
    'snapshotSha256',v_share.snapshot_sha256,
    'createdAt',v_share.created_at,
    'expiresAt',v_share.expires_at,
    'revokedAt',v_now,
    'reason',v_reason,
    'requestId',p_request_id
  );
  insert into public.lukas_qto_drawing_share_events(
    share_id,project_id,document_id,revision_id,revision_version,
    snapshot_sha256,event_type,request_id,request_sha256,details,
    actor_id,created_at
  ) values(
    v_share.id,v_share.project_id,v_share.document_id,v_share.revision_id,
    v_share.revision_version,v_share.snapshot_sha256,'revoked',p_request_id,
    v_request_sha256,v_result,v_actor,v_now
  ) returning * into v_event;
  perform pg_catalog.set_config(
    'app.lukas_drawing_share_event_id',v_event.id::text,true
  );
  update public.lukas_qto_drawing_shares share
  set revoked_at=v_now,revoked_by=v_actor,revoke_reason=v_reason
  where share.id=v_share.id;
  return v_result;
end;
$$;

create function public.lukas_qto_list_drawing_shares(
  p_project_id uuid,
  p_document_id uuid,
  p_revision_id uuid,
  p_revision_version bigint,
  p_snapshot_sha256 text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_result jsonb;
begin
  if v_actor is null
    or private.lukas_qto_verified_session() is not true
    or private.lukas_drawing_workspace_capability(p_project_id)
      is distinct from 'admin' then
    raise exception using errcode='PDS03',
      message='Drawing share authority denied';
  end if;
  if p_revision_version is null or p_revision_version<1
    or p_snapshot_sha256 is null
      or p_snapshot_sha256!~'^[0-9a-f]{64}$' then
    raise exception using errcode='PDS04',
      message='Drawing share input is invalid';
  end if;
  perform 1
  from public.lukas_drawing_revisions revision
  join public.lukas_qto_projects project
    on project.id=revision.project_id
      and project.archived_at is null
      and project.deletion_requested_at is null
  join public.lukas_drawing_documents document
    on document.id=revision.document_id
      and document.project_id=revision.project_id
  join public.lukas_drawing_snapshots snapshot
    on snapshot.revision_id=revision.id
      and snapshot.project_id=revision.project_id
      and snapshot.revision_version=revision.version
      and snapshot.sha256=p_snapshot_sha256
  where revision.id=p_revision_id
    and revision.document_id=p_document_id
    and revision.project_id=p_project_id
    and revision.version=p_revision_version
    and revision.status in(
      'review_requested','reviewed','approved','superseded'
    );
  if not found then
    raise exception using errcode='PDS06',
      message='Drawing share target is unavailable';
  end if;
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'shareId',share.id,
      'revisionVersion',share.revision_version,
      'snapshotSha256',share.snapshot_sha256,
      'createdAt',share.created_at,
      'expiresAt',share.expires_at,
      'revokedAt',share.revoked_at
    ) order by share.created_at desc,share.id desc
  ),'[]'::jsonb) into v_result
  from (
    select candidate.id,candidate.revision_version,
      candidate.snapshot_sha256,candidate.created_at,
      candidate.expires_at,candidate.revoked_at
    from public.lukas_qto_drawing_shares candidate
    where candidate.project_id=p_project_id
      and candidate.document_id=p_document_id
      and candidate.revision_id=p_revision_id
      and candidate.revision_version=p_revision_version
      and candidate.snapshot_sha256=p_snapshot_sha256
      and candidate.revoked_at is null
      and candidate.expires_at>pg_catalog.now()
      and private.lukas_drawing_workspace_capability(p_project_id)='admin'
    order by candidate.created_at desc,candidate.id desc
    limit 100
  ) share;
  return v_result;
end;
$$;

create function public.lukas_qto_shared_drawing_revision(p_token text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_token_bytes bytea; v_token_hash text; v_result jsonb;
begin
  -- Keep malformed, expired, revoked, drifted, and unknown bearer outcomes
  -- indistinguishable. The executor grant below is the service boundary.
  if p_token is null
    or p_token!~'^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  begin
    v_token_bytes:=pg_catalog.decode(
      pg_catalog.translate(p_token,'-_','+/')||'=','base64'
    );
  exception when others then
    return null;
  end;
  if pg_catalog.octet_length(v_token_bytes)<>32
    or pg_catalog.rtrim(pg_catalog.translate(
      pg_catalog.encode(v_token_bytes,'base64'),'+/','-_'
    ),'=')<>p_token then
    return null;
  end if;
  v_token_hash:=pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(p_token,'UTF8'),'sha256'
    ),'hex'
  );
  select pg_catalog.jsonb_build_object(
    'shareId',share.id,
    'project',pg_catalog.jsonb_build_object(
      'id',project.id,'name',project.name
    ),
    'document',pg_catalog.jsonb_build_object(
      'id',document.id,'title',document.title
    ),
    'revision',pg_catalog.jsonb_build_object(
      'id',revision.id,'sequence',revision.sequence,
      'version',revision.version,'status',revision.status
    ),
    'snapshot',pg_catalog.jsonb_build_object(
      'sha256',snapshot.sha256,
      'schemaVersion',snapshot.schema_version,
      'operationSequence',snapshot.operation_sequence,
      'canonicalJson',snapshot.canonical_json
    ),
    'expiresAt',share.expires_at
  ) into v_result
  from public.lukas_qto_drawing_shares share
  join public.lukas_qto_projects project
    on project.id=share.project_id
      and project.archived_at is null
      and project.deletion_requested_at is null
      and private.lukas_qto_project_feature_active(
        project.id,'drawing_workspace'
      ) is true
  join public.lukas_drawing_documents document
    on document.id=share.document_id
      and document.project_id=share.project_id
  join public.lukas_drawing_revisions revision
    on revision.id=share.revision_id
      and revision.document_id=share.document_id
      and revision.project_id=share.project_id
      and revision.version=share.revision_version
      and revision.status in(
        'review_requested','reviewed','approved','superseded'
      )
  join public.lukas_drawing_snapshots snapshot
    on snapshot.revision_id=share.revision_id
      and snapshot.project_id=share.project_id
      and snapshot.revision_version=share.revision_version
      and snapshot.sha256=share.snapshot_sha256
  where share.token_hash=v_token_hash
    and share.revoked_at is null
    and share.expires_at>pg_catalog.now();
  return v_result;
end;
$$;

alter table public.lukas_qto_drawing_shares enable row level security;
alter table public.lukas_qto_drawing_share_events enable row level security;

revoke all on table public.lukas_qto_drawing_shares
  from public,anon,authenticated,service_role;
revoke all on table public.lukas_qto_drawing_share_events
  from public,anon,authenticated,service_role;
grant select on table public.lukas_qto_drawing_shares to service_role;
grant select on table public.lukas_qto_drawing_share_events to service_role;

revoke all on function
  private.lukas_qto_drawing_share_request_sha(jsonb),
  private.lukas_qto_drawing_share_event_append_guard(),
  private.lukas_qto_drawing_share_mutation_guard(),
  private.lukas_qto_drawing_share_project_move_guard(),
  public.lukas_qto_create_drawing_share(
    uuid,uuid,uuid,bigint,text,text,uuid
  ),
  public.lukas_qto_revoke_drawing_share(
    uuid,uuid,uuid,bigint,text,uuid,text,uuid
  ),
  public.lukas_qto_list_drawing_shares(
    uuid,uuid,uuid,bigint,text
  ),
  public.lukas_qto_shared_drawing_revision(text)
from public,anon,authenticated,service_role;
grant execute on function
  public.lukas_qto_create_drawing_share(
    uuid,uuid,uuid,bigint,text,text,uuid
  ),
  public.lukas_qto_revoke_drawing_share(
    uuid,uuid,uuid,bigint,text,uuid,text,uuid
  ),
  public.lukas_qto_list_drawing_shares(
    uuid,uuid,uuid,bigint,text
  )
to authenticated;
grant execute on function public.lukas_qto_shared_drawing_revision(text)
to service_role;

alter default privileges revoke execute on functions from public;

commit;
