begin;

-- Creation accepts a bearer hash, so it must never be callable by a browser
-- role. The application authenticates the request with auth.getUser(), derives
-- the bearer on the server, and this service-only entry point independently
-- rechecks the explicit actor's live project authority.
revoke all on function public.lukas_qto_create_drawing_share(
  uuid,uuid,uuid,bigint,text,text,uuid
) from public,anon,authenticated,service_role;
drop function public.lukas_qto_create_drawing_share(
  uuid,uuid,uuid,bigint,text,text,uuid
);

create function public.lukas_qto_create_drawing_share(
  p_actor_id uuid,
  p_project_id uuid,
  p_document_id uuid,
  p_revision_id uuid,
  p_revision_version bigint,
  p_snapshot_sha256 text,
  p_token_hash text,
  p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=p_actor_id;
  v_revision public.lukas_drawing_revisions%rowtype;
  v_share public.lukas_qto_drawing_shares%rowtype;
  v_event public.lukas_qto_drawing_share_events%rowtype;
  v_request_sha256 text; v_result jsonb;
  v_now timestamptz:=pg_catalog.clock_timestamp();
begin
  if pg_catalog.current_setting('role',true)<>'service_role'
    or coalesce((select auth.jwt()->>'role'),'')<>'service_role'
    or v_actor is null
    or not exists(
      select 1 from auth.users actor
      where actor.id=v_actor
        and coalesce(actor.is_anonymous,false)=false
    )
    or private.lukas_qto_project_feature_active(
      p_project_id,'drawing_workspace'
    ) is not true
    or private.lukas_drawing_collaboration_capability_for_user(
      v_actor,p_project_id
    ) is distinct from 'admin' then
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
  if not exists(
      select 1 from auth.users actor
      where actor.id=v_actor
        and coalesce(actor.is_anonymous,false)=false
    )
    or private.lukas_qto_project_feature_active(
      p_project_id,'drawing_workspace'
    ) is not true
    or private.lukas_drawing_collaboration_capability_for_user(
      v_actor,p_project_id
    ) is distinct from 'admin' then
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

revoke all on function public.lukas_qto_create_drawing_share(
  uuid,uuid,uuid,uuid,bigint,text,text,uuid
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_qto_create_drawing_share(
  uuid,uuid,uuid,uuid,bigint,text,text,uuid
) to service_role;

commit;
