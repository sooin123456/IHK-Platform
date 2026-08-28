begin;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'public.lukas_qto_projects','public.lukas_qto_organizations',
    'public.lukas_qto_organization_members','public.lukas_drawing_revisions',
    'public.lukas_drawing_revision_approvals','public.lukas_qto_boq_versions',
    'public.lukas_drawing_quantity_links','public.lukas_drawing_boq_links',
    'public.lukas_drawing_material_links','public.lukas_drawing_issue_approvals',
    'public.lukas_qto_material_transactions','public.lukas_drawing_library_versions',
    'public.lukas_drawing_library_imports','public.lukas_qto_files'
  ] loop
    if pg_catalog.to_regclass(v_table) is null then
      raise exception using errcode='P7R01',message='P7 retention base authority is missing';
    end if;
  end loop;
  if pg_catalog.to_regprocedure('private.lukas_qto_organization_role(uuid)') is null then
    raise exception using errcode='P7R01',message='P7 organization authority is missing';
  end if;
end;
$$;

alter table public.lukas_qto_projects
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete restrict,
  add column deletion_requested_at timestamptz,
  add column deletion_requested_by uuid references auth.users(id) on delete restrict,
  add column purge_after timestamptz,
  add column retention_event_id uuid,
  add constraint lukas_qto_projects_retention_state_check check (
    (archived_at is null and archived_by is null
      and deletion_requested_at is null and deletion_requested_by is null
      and purge_after is null and retention_event_id is null)
    or (archived_at is not null and archived_by is not null
      and deletion_requested_at is null and deletion_requested_by is null
      and purge_after is null and retention_event_id is not null)
    or (archived_at is not null and archived_by is not null
      and deletion_requested_at is not null and deletion_requested_by is not null
      and purge_after is not null and retention_event_id is not null)
  );

create table public.lukas_qto_retention_policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.lukas_qto_organizations(id) on delete restrict,
  version_no integer not null check(version_no>0),
  archive_retention_days integer not null check(archive_retention_days between 0 and 3650),
  approved_retention_days integer not null check(approved_retention_days between 365 and 3650),
  reason text not null check(char_length(trim(reason)) between 1 and 1000),
  request_id uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(organization_id,version_no),
  unique(created_by,request_id)
);

create table public.lukas_qto_retention_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.lukas_qto_organizations(id) on delete restrict,
  project_id uuid not null,
  event_type text not null check(event_type in(
    'project_archived','deletion_requested','legal_hold_placed',
    'legal_hold_released','purge_denied','project_purged'
  )),
  request_id uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  hold_id uuid,
  releases_event_id uuid references public.lukas_qto_retention_events(id) on delete restrict,
  purge_after timestamptz,
  reason text not null check(char_length(trim(reason)) between 1 and 2000),
  evidence jsonb not null default '{}'::jsonb check(pg_catalog.jsonb_typeof(evidence)='object'),
  actor_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(actor_id,request_id),
  check(
    (event_type='legal_hold_placed' and hold_id is not null and releases_event_id is null)
    or (event_type='legal_hold_released' and hold_id is not null and releases_event_id is not null)
    or (event_type not in('legal_hold_placed','legal_hold_released')
      and hold_id is null and releases_event_id is null)
  )
);

alter table public.lukas_qto_projects
  add constraint lukas_qto_projects_retention_event_fkey
  foreign key(retention_event_id) references public.lukas_qto_retention_events(id) on delete restrict;

create table public.lukas_qto_restore_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.lukas_qto_organizations(id) on delete restrict,
  source_project_ref text not null check(source_project_ref ~ '^[a-z0-9]{20}$'),
  provider_backup_id text not null check(char_length(trim(provider_backup_id)) between 1 and 160),
  provider_backup_created_at timestamptz not null,
  provider_restore_project_ref text not null check(provider_restore_project_ref ~ '^[a-z0-9]{20}$'),
  provider_restore_created_at timestamptz not null,
  source_commit text not null check(source_commit ~ '^[0-9a-f]{40}$'),
  schema_sha256 text not null check(schema_sha256 ~ '^[0-9a-f]{64}$'),
  database_sha256 text not null check(database_sha256 ~ '^[0-9a-f]{64}$'),
  storage_sha256 text not null check(storage_sha256 ~ '^[0-9a-f]{64}$'),
  yjs_sha256 text not null check(yjs_sha256 ~ '^[0-9a-f]{64}$'),
  approval_sha256 text not null check(approval_sha256 ~ '^[0-9a-f]{64}$'),
  lineage_sha256 text not null check(lineage_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  rpo_seconds bigint not null check(rpo_seconds>=0),
  rto_seconds bigint not null check(rto_seconds>=0),
  status text not null check(status in('PASS','NOT MET')),
  recorded_by uuid references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default pg_catalog.now(),
  unique(source_project_ref,provider_backup_id,provider_restore_project_ref)
);

create index lukas_qto_retention_policy_versions_org_idx
  on public.lukas_qto_retention_policy_versions(organization_id,version_no desc);
create index lukas_qto_retention_events_project_idx
  on public.lukas_qto_retention_events(organization_id,project_id,created_at desc,id desc);
create index lukas_qto_retention_events_active_hold_idx
  on public.lukas_qto_retention_events(project_id,hold_id,created_at desc)
  where event_type in('legal_hold_placed','legal_hold_released');
create index lukas_qto_restore_runs_org_idx
  on public.lukas_qto_restore_runs(organization_id,recorded_at desc,id desc);
create index lukas_qto_projects_active_idx
  on public.lukas_qto_projects(organization_id,updated_at desc) where archived_at is null;

create function private.lukas_qto_retention_append_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='P7R02',message='Retention evidence is append-only';
end;
$$;

create trigger lukas_qto_retention_policy_versions_append_only
before update or delete on public.lukas_qto_retention_policy_versions
for each row execute function private.lukas_qto_retention_append_guard();
create trigger lukas_qto_retention_events_append_only
before update or delete on public.lukas_qto_retention_events
for each row execute function private.lukas_qto_retention_append_guard();
create trigger lukas_qto_restore_runs_append_only
before update or delete on public.lukas_qto_restore_runs
for each row execute function private.lukas_qto_retention_append_guard();

create function private.lukas_qto_project_retention_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_event uuid;
begin
  if tg_op='DELETE' then
    if current_user=pg_catalog.pg_get_userbyid(
        (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
      ) and pg_catalog.current_setting('app.lukas_retention_purge_project',true)=old.id::text then
      return old;
    end if;
    raise exception using errcode='P7R03',message='Projects must be archived and purged through retention authority';
  end if;
  if new.archived_at is not distinct from old.archived_at
    and new.archived_by is not distinct from old.archived_by
    and new.deletion_requested_at is not distinct from old.deletion_requested_at
    and new.deletion_requested_by is not distinct from old.deletion_requested_by
    and new.purge_after is not distinct from old.purge_after
    and new.retention_event_id is not distinct from old.retention_event_id then return new; end if;
  v_event:=nullif(pg_catalog.current_setting('app.lukas_retention_event_id',true),'')::uuid;
  if current_user<>pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    ) or v_event is null or new.retention_event_id is distinct from v_event
    or not exists(select 1 from public.lukas_qto_retention_events e
      where e.id=v_event and e.organization_id=new.organization_id and e.project_id=new.id) then
    raise exception using errcode='P7R03',message='Project retention state is RPC-only';
  end if;
  return new;
end;
$$;

create trigger lukas_qto_projects_retention_guard
before update or delete on public.lukas_qto_projects
for each row execute function private.lukas_qto_project_retention_guard();

create function private.lukas_qto_retention_manager(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select auth.uid()) is not null and
    private.lukas_qto_organization_role(p_organization_id) in('owner','admin','staff'),false)
$$;

create function private.lukas_qto_project_retention_dependencies(p_project_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'approvedDrawingRevisions',(select pg_catalog.count(*) from public.lukas_drawing_revisions r
      where r.project_id=p_project_id and r.status in('approved','superseded')),
    'drawingRevisionApprovals',(select pg_catalog.count(*) from public.lukas_drawing_revision_approvals a
      where a.project_id=p_project_id and a.decision='approved'),
    'drawingIssueApprovals',(select pg_catalog.count(*) from public.lukas_drawing_issue_approvals a
      where a.project_id=p_project_id and a.decision='approved'),
    'approvedBoqVersions',(select pg_catalog.count(*) from public.lukas_qto_boq_versions b
      where b.project_id=p_project_id and b.status in('approved','superseded')),
    'drawingQuantityLinks',(select pg_catalog.count(*) from public.lukas_drawing_quantity_links q
      where q.project_id=p_project_id),
    'drawingBoqLinks',(select pg_catalog.count(*) from public.lukas_drawing_boq_links b
      where b.project_id=p_project_id),
    'drawingMaterialLinks',(select pg_catalog.count(*) from public.lukas_drawing_material_links m
      where m.project_id=p_project_id),
    'materialTransactions',(select pg_catalog.count(*) from public.lukas_qto_material_transactions m
      where m.project_id=p_project_id),
    'publishedLibraryVersions',(select pg_catalog.count(*) from public.lukas_drawing_library_versions v
      where v.source_project_id=p_project_id and v.status in('published','deprecated')),
    'libraryImports',(select pg_catalog.count(*) from public.lukas_drawing_library_imports i
      where i.project_id=p_project_id),
    'immutableFiles',(select pg_catalog.count(*) from public.lukas_qto_files f
      where f.project_id=p_project_id and f.immutable)
  )
$$;

create or replace function public.lukas_qto_set_retention_policy(
  p_organization_id uuid,p_archive_retention_days integer,
  p_approved_retention_days integer,p_reason text,p_request_id uuid
) returns public.lukas_qto_retention_policy_versions
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_version integer; v_sha text;
declare v_existing public.lukas_qto_retention_policy_versions%rowtype;
begin
  if not private.lukas_qto_retention_manager(p_organization_id) then
    raise exception using errcode='P7R04',message='Retention policy authority denied'; end if;
  if p_request_id is null or p_archive_retention_days not between 0 and 3650
    or p_approved_retention_days not between 365 and 3650
    or p_approved_retention_days<p_archive_retention_days
    or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 1000 then
    raise exception using errcode='P7R05',message='Retention policy input is invalid'; end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(p_organization_id,p_archive_retention_days,
      p_approved_retention_days,pg_catalog.btrim(p_reason))::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.lukas_qto_retention_policy_versions
    where created_by=v_actor and request_id=p_request_id;
  if found then
    if v_existing.request_sha256<>v_sha then raise exception using errcode='P7R05',message='Retention request identity was reused'; end if;
    return v_existing;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0));
  select coalesce(pg_catalog.max(version_no),0)+1 into v_version
    from public.lukas_qto_retention_policy_versions where organization_id=p_organization_id;
  insert into public.lukas_qto_retention_policy_versions(
    organization_id,version_no,archive_retention_days,approved_retention_days,
    reason,request_id,request_sha256,created_by
  ) values(p_organization_id,v_version,p_archive_retention_days,
    p_approved_retention_days,pg_catalog.btrim(p_reason),p_request_id,v_sha,v_actor)
  returning * into v_existing;
  return v_existing;
end;
$$;

create or replace function public.lukas_qto_archive_project(
  p_organization_id uuid,p_project_id uuid,p_reason text,p_request_id uuid
) returns public.lukas_qto_retention_events
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_project public.lukas_qto_projects%rowtype;
declare v_event public.lukas_qto_retention_events%rowtype; v_sha text;
begin
  if not private.lukas_qto_retention_manager(p_organization_id) then
    raise exception using errcode='P7R04',message='Project archive authority denied'; end if;
  select * into v_project from public.lukas_qto_projects
    where id=p_project_id and organization_id=p_organization_id for update;
  if not found then raise exception using errcode='P7R06',message='Project retention target is unavailable'; end if;
  if p_request_id is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='P7R05',message='Archive request is invalid'; end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array('project_archived',p_organization_id,p_project_id,pg_catalog.btrim(p_reason))::text,'UTF8'),'sha256'),'hex');
  select * into v_event from public.lukas_qto_retention_events where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then raise exception using errcode='P7R05',message='Retention request identity was reused'; end if;
    return v_event;
  end if;
  insert into public.lukas_qto_retention_events(
    organization_id,project_id,event_type,request_id,request_sha256,reason,actor_id
  ) values(p_organization_id,p_project_id,'project_archived',p_request_id,v_sha,pg_catalog.btrim(p_reason),v_actor)
  returning * into v_event;
  perform pg_catalog.set_config('app.lukas_retention_event_id',v_event.id::text,true);
  update public.lukas_qto_projects set archived_at=coalesce(archived_at,v_event.created_at),
    archived_by=coalesce(archived_by,v_actor),retention_event_id=v_event.id
    where id=p_project_id;
  return v_event;
end;
$$;

create or replace function public.lukas_qto_request_project_deletion(
  p_organization_id uuid,p_project_id uuid,p_reason text,p_request_id uuid
) returns public.lukas_qto_retention_events
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_project public.lukas_qto_projects%rowtype;
declare v_event public.lukas_qto_retention_events%rowtype; v_policy record;
declare v_dependencies jsonb; v_approved boolean; v_days integer; v_sha text;
begin
  if not private.lukas_qto_retention_manager(p_organization_id) then
    raise exception using errcode='P7R04',message='Project deletion request authority denied'; end if;
  select * into v_project from public.lukas_qto_projects
    where id=p_project_id and organization_id=p_organization_id for update;
  if not found then raise exception using errcode='P7R06',message='Project retention target is unavailable'; end if;
  if p_request_id is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='P7R05',message='Deletion request is invalid'; end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array('deletion_requested',p_organization_id,p_project_id,pg_catalog.btrim(p_reason))::text,'UTF8'),'sha256'),'hex');
  select * into v_event from public.lukas_qto_retention_events where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then raise exception using errcode='P7R05',message='Retention request identity was reused'; end if;
    return v_event;
  end if;
  select archive_retention_days,approved_retention_days into v_policy
    from public.lukas_qto_retention_policy_versions
    where organization_id=p_organization_id order by version_no desc limit 1;
  if not found then select 30,2555 into v_policy; end if;
  v_dependencies:=private.lukas_qto_project_retention_dependencies(p_project_id);
  v_approved:=((v_dependencies->>'approvedDrawingRevisions')::bigint
    +(v_dependencies->>'drawingRevisionApprovals')::bigint
    +(v_dependencies->>'drawingIssueApprovals')::bigint
    +(v_dependencies->>'approvedBoqVersions')::bigint)>0;
  v_days:=case when v_approved then v_policy.approved_retention_days else v_policy.archive_retention_days end;
  insert into public.lukas_qto_retention_events(
    organization_id,project_id,event_type,request_id,request_sha256,purge_after,
    reason,evidence,actor_id
  ) values(p_organization_id,p_project_id,'deletion_requested',p_request_id,v_sha,
    pg_catalog.now()+pg_catalog.make_interval(days=>v_days),pg_catalog.btrim(p_reason),
    pg_catalog.jsonb_build_object('approvedEvidence',v_approved,'dependencies',v_dependencies,
      'retentionDays',v_days),v_actor) returning * into v_event;
  perform pg_catalog.set_config('app.lukas_retention_event_id',v_event.id::text,true);
  update public.lukas_qto_projects set archived_at=coalesce(archived_at,v_event.created_at),
    archived_by=coalesce(archived_by,v_actor),deletion_requested_at=v_event.created_at,
    deletion_requested_by=v_actor,purge_after=v_event.purge_after,retention_event_id=v_event.id
    where id=p_project_id;
  return v_event;
end;
$$;

create or replace function public.lukas_qto_place_legal_hold(
  p_organization_id uuid,p_project_id uuid,p_hold_id uuid,p_reason text,p_request_id uuid
) returns public.lukas_qto_retention_events
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_event public.lukas_qto_retention_events%rowtype; v_sha text;
begin
  if not private.lukas_qto_retention_manager(p_organization_id) then raise exception using errcode='P7R04',message='Legal hold authority denied'; end if;
  if not exists(select 1 from public.lukas_qto_projects p where p.id=p_project_id and p.organization_id=p_organization_id)
    or p_hold_id is null or p_request_id is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='P7R05',message='Legal hold input is invalid'; end if;
  if exists(select 1 from public.lukas_qto_retention_events e where e.project_id=p_project_id and e.hold_id=p_hold_id) then
    raise exception using errcode='P7R05',message='Legal hold identity already exists'; end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
    'legal_hold_placed',p_organization_id,p_project_id,p_hold_id,pg_catalog.btrim(p_reason))::text,'UTF8'),'sha256'),'hex');
  insert into public.lukas_qto_retention_events(organization_id,project_id,event_type,
    request_id,request_sha256,hold_id,reason,actor_id)
  values(p_organization_id,p_project_id,'legal_hold_placed',p_request_id,v_sha,p_hold_id,
    pg_catalog.btrim(p_reason),v_actor) returning * into v_event;
  return v_event;
end;
$$;

create or replace function public.lukas_qto_release_legal_hold(
  p_organization_id uuid,p_project_id uuid,p_hold_id uuid,p_reason text,p_request_id uuid
) returns public.lukas_qto_retention_events
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_placed public.lukas_qto_retention_events%rowtype;
declare v_event public.lukas_qto_retention_events%rowtype; v_sha text;
begin
  if not private.lukas_qto_retention_manager(p_organization_id) then raise exception using errcode='P7R04',message='Legal hold authority denied'; end if;
  select * into v_placed from public.lukas_qto_retention_events e
    where e.organization_id=p_organization_id and e.project_id=p_project_id
      and e.event_type='legal_hold_placed' and e.hold_id=p_hold_id for share;
  if not found or exists(select 1 from public.lukas_qto_retention_events r
    where r.event_type='legal_hold_released' and r.releases_event_id=v_placed.id) then
    raise exception using errcode='P7R05',message='Active legal hold is unavailable'; end if;
  if p_request_id is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='P7R05',message='Legal hold release is invalid'; end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
    'legal_hold_released',p_organization_id,p_project_id,p_hold_id,pg_catalog.btrim(p_reason))::text,'UTF8'),'sha256'),'hex');
  insert into public.lukas_qto_retention_events(organization_id,project_id,event_type,
    request_id,request_sha256,hold_id,releases_event_id,reason,actor_id)
  values(p_organization_id,p_project_id,'legal_hold_released',p_request_id,v_sha,p_hold_id,
    v_placed.id,pg_catalog.btrim(p_reason),v_actor) returning * into v_event;
  return v_event;
end;
$$;

create or replace function public.lukas_qto_purge_project(
  p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project public.lukas_qto_projects%rowtype; v_dependencies jsonb;
declare v_request public.lukas_qto_retention_events%rowtype; v_event public.lukas_qto_retention_events%rowtype;
declare v_active_holds bigint; v_protected bigint; v_sha text; v_status text;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='P7R07',message='Trusted purge requires service authority'; end if;
  select * into v_project from public.lukas_qto_projects
    where id=p_project_id and organization_id=p_organization_id for update;
  if not found then raise exception using errcode='P7R06',message='Project retention target is unavailable'; end if;
  select * into v_request from public.lukas_qto_retention_events e
    where e.organization_id=p_organization_id and e.project_id=p_project_id
      and e.event_type='deletion_requested' order by e.created_at desc,e.id desc limit 1;
  if not found then raise exception using errcode='P7R08',message='Project deletion was not requested'; end if;
  select pg_catalog.count(*) into v_active_holds from public.lukas_qto_retention_events p
    where p.organization_id=p_organization_id and p.project_id=p_project_id
      and p.event_type='legal_hold_placed' and not exists(
        select 1 from public.lukas_qto_retention_events r
        where r.event_type='legal_hold_released' and r.releases_event_id=p.id
      );
  v_dependencies:=private.lukas_qto_project_retention_dependencies(p_project_id);
  v_protected:=(v_dependencies->>'approvedDrawingRevisions')::bigint
    +(v_dependencies->>'drawingRevisionApprovals')::bigint
    +(v_dependencies->>'drawingIssueApprovals')::bigint
    +(v_dependencies->>'approvedBoqVersions')::bigint
    +(v_dependencies->>'drawingQuantityLinks')::bigint
    +(v_dependencies->>'drawingBoqLinks')::bigint
    +(v_dependencies->>'drawingMaterialLinks')::bigint
    +(v_dependencies->>'materialTransactions')::bigint
    +(v_dependencies->>'publishedLibraryVersions')::bigint
    +(v_dependencies->>'libraryImports')::bigint;
  v_status:=case
    when pg_catalog.now()<v_request.purge_after then 'retention_not_expired'
    when v_active_holds>0 then 'legal_hold_active'
    when v_protected>0 then 'protected_dependencies'
    else 'purged' end;
  if p_request_id is null or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000 then
    raise exception using errcode='P7R05',message='Purge request is invalid'; end if;
  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
    v_status,p_organization_id,p_project_id,v_request.id,pg_catalog.btrim(p_reason),v_dependencies)::text,'UTF8'),'sha256'),'hex');
  insert into public.lukas_qto_retention_events(organization_id,project_id,event_type,
    request_id,request_sha256,reason,evidence,actor_id)
  values(p_organization_id,p_project_id,case when v_status='purged' then 'project_purged' else 'purge_denied' end,
    p_request_id,v_sha,pg_catalog.btrim(p_reason),pg_catalog.jsonb_build_object(
      'status',v_status,'requestEventId',v_request.id,'purgeAfter',v_request.purge_after,
      'activeLegalHolds',v_active_holds,'dependencies',v_dependencies),null)
  returning * into v_event;
  if v_status<>'purged' then return pg_catalog.jsonb_build_object('status','HELD','reason',v_status,
    'eventId',v_event.id,'dependencies',v_dependencies); end if;
  perform pg_catalog.set_config('app.lukas_retention_purge_project',p_project_id::text,true);
  delete from public.lukas_qto_projects where id=p_project_id and organization_id=p_organization_id;
  return pg_catalog.jsonb_build_object('status','PURGED','eventId',v_event.id,'dependencies',v_dependencies);
end;
$$;

create or replace function public.lukas_qto_record_restore_run(
  p_organization_id uuid,p_source_project_ref text,p_provider_backup_id text,
  p_provider_backup_created_at timestamptz,p_provider_restore_project_ref text,
  p_provider_restore_created_at timestamptz,p_source_commit text,p_schema_sha256 text,
  p_database_sha256 text,p_storage_sha256 text,p_yjs_sha256 text,
  p_approval_sha256 text,p_lineage_sha256 text,p_evidence_sha256 text,
  p_rpo_seconds bigint,p_rto_seconds bigint,p_status text
) returns public.lukas_qto_restore_runs
language plpgsql security definer set search_path='' as $$
declare v_row public.lukas_qto_restore_runs%rowtype;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    raise exception using errcode='P7R07',message='Restore evidence requires service authority'; end if;
  if p_source_project_ref=p_provider_restore_project_ref or p_status not in('PASS','NOT MET')
    or p_source_commit !~ '^[0-9a-f]{40}$'
    or p_schema_sha256 !~ '^[0-9a-f]{64}$' or p_database_sha256 !~ '^[0-9a-f]{64}$'
    or p_storage_sha256 !~ '^[0-9a-f]{64}$' or p_yjs_sha256 !~ '^[0-9a-f]{64}$'
    or p_approval_sha256 !~ '^[0-9a-f]{64}$' or p_lineage_sha256 !~ '^[0-9a-f]{64}$'
    or p_evidence_sha256 !~ '^[0-9a-f]{64}$' or p_rpo_seconds<0 or p_rto_seconds<0 then
    raise exception using errcode='P7R05',message='Restore evidence is invalid'; end if;
  insert into public.lukas_qto_restore_runs(organization_id,source_project_ref,
    provider_backup_id,provider_backup_created_at,provider_restore_project_ref,
    provider_restore_created_at,source_commit,schema_sha256,database_sha256,
    storage_sha256,yjs_sha256,approval_sha256,lineage_sha256,evidence_sha256,
    rpo_seconds,rto_seconds,status,recorded_by)
  values(p_organization_id,p_source_project_ref,p_provider_backup_id,
    p_provider_backup_created_at,p_provider_restore_project_ref,p_provider_restore_created_at,
    p_source_commit,p_schema_sha256,p_database_sha256,p_storage_sha256,p_yjs_sha256,
    p_approval_sha256,p_lineage_sha256,p_evidence_sha256,p_rpo_seconds,p_rto_seconds,
    p_status,(select auth.uid())) returning * into v_row;
  return v_row;
end;
$$;

alter table public.lukas_qto_retention_policy_versions enable row level security;
alter table public.lukas_qto_retention_events enable row level security;
alter table public.lukas_qto_restore_runs enable row level security;

revoke all on table public.lukas_qto_retention_policy_versions from anon,authenticated,service_role;
revoke all on table public.lukas_qto_retention_events from anon,authenticated,service_role;
revoke all on table public.lukas_qto_restore_runs from anon,authenticated,service_role;
grant select on table public.lukas_qto_retention_policy_versions to authenticated,service_role;
grant select on table public.lukas_qto_retention_events to authenticated,service_role;
grant select on table public.lukas_qto_restore_runs to authenticated,service_role;

create policy "organization members read retention policies"
on public.lukas_qto_retention_policy_versions for select to authenticated
using(private.lukas_qto_organization_role(organization_id) is not null);
create policy "organization members read retention events"
on public.lukas_qto_retention_events for select to authenticated
using(private.lukas_qto_organization_role(organization_id) is not null);
create policy "organization members read restore evidence"
on public.lukas_qto_restore_runs for select to authenticated
using(private.lukas_qto_organization_role(organization_id) is not null);

drop policy if exists "project owners delete projects" on public.lukas_qto_projects;
drop policy if exists "lukas qto owners manage projects" on public.lukas_qto_projects;
revoke delete on table public.lukas_qto_projects from authenticated,service_role;

revoke all on function private.lukas_qto_retention_append_guard(),
  private.lukas_qto_project_retention_guard(),private.lukas_qto_retention_manager(uuid),
  private.lukas_qto_project_retention_dependencies(uuid) from public,anon,authenticated,service_role;
revoke all on function public.lukas_qto_set_retention_policy(uuid,integer,integer,text,uuid),
  public.lukas_qto_archive_project(uuid,uuid,text,uuid),
  public.lukas_qto_request_project_deletion(uuid,uuid,text,uuid),
  public.lukas_qto_place_legal_hold(uuid,uuid,uuid,text,uuid),
  public.lukas_qto_release_legal_hold(uuid,uuid,uuid,text,uuid),
  public.lukas_qto_purge_project(uuid,uuid,uuid,text),
  public.lukas_qto_record_restore_run(uuid,text,text,timestamptz,text,timestamptz,text,text,text,text,text,text,text,text,bigint,bigint,text)
  from public,anon,authenticated,service_role;
grant execute on function public.lukas_qto_set_retention_policy(uuid,integer,integer,text,uuid),
  public.lukas_qto_archive_project(uuid,uuid,text,uuid),
  public.lukas_qto_request_project_deletion(uuid,uuid,text,uuid),
  public.lukas_qto_place_legal_hold(uuid,uuid,uuid,text,uuid),
  public.lukas_qto_release_legal_hold(uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.lukas_qto_purge_project(uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.lukas_qto_record_restore_run(uuid,text,text,timestamptz,text,timestamptz,text,text,text,text,text,text,text,text,bigint,bigint,text)
  to service_role;

commit;
