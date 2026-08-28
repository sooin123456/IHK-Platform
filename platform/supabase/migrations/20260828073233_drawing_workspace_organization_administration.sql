begin;

do $$
declare v_table text;
begin
  foreach v_table in array array[
    'public.lukas_qto_organizations','public.lukas_qto_organization_members',
    'public.lukas_qto_projects','public.lukas_qto_project_members',
    'public.lukas_drawing_library_entries','public.lukas_drawing_library_versions',
    'public.lukas_drawing_library_imports',
    'public.lukas_qto_retention_events','public.lukas_qto_export_events',
    'public.lukas_drawing_revisions','public.lukas_drawing_revision_approvals',
    'public.lukas_drawing_issue_approvals',
    'public.lukas_qto_price_books','public.lukas_qto_price_resources',
    'public.lukas_qto_boq_versions','public.lukas_qto_boq_sections',
    'public.lukas_qto_boq_lines','public.lukas_qto_boq_wbs_nodes',
    'public.lukas_qto_boq_wbs_allocations','public.lukas_qto_boq_quantity_mappings',
    'public.lukas_qto_boq_source_exclusions','public.lukas_qto_boq_rate_components',
    'public.lukas_qto_boq_approvals','public.lukas_drawing_quantity_links',
    'public.lukas_drawing_boq_links','public.lukas_drawing_material_links',
    'public.lukas_qto_material_plans','public.lukas_qto_material_transactions',
    'public.lukas_qto_carbon_factors'
  ] loop
    if pg_catalog.to_regclass(v_table) is null then
      raise exception using errcode='P7A01',message='P7 organization administration base authority is missing';
    end if;
  end loop;
  if pg_catalog.to_regprocedure('private.lukas_qto_organization_role(uuid)') is null
    or pg_catalog.to_regprocedure('private.lukas_qto_project_role(uuid)') is null
    or pg_catalog.to_regprocedure('private.lukas_drawing_workspace_capability(uuid)') is null
    or pg_catalog.to_regprocedure('private.lukas_drawing_collaboration_authorize(uuid,uuid,uuid)') is null
    or pg_catalog.to_regprocedure('private.lukas_drawing_collaboration_service_load_state(uuid,uuid)') is null
    or pg_catalog.to_regprocedure('private.lukas_drawing_collaboration_service_store_state(uuid,uuid,smallint,bytea,bigint,bigint,text)') is null
    or pg_catalog.to_regprocedure('private.lukas_drawing_collaboration_service_bootstrap(uuid,uuid)') is null then
    raise exception using errcode='P7A01',message='P7 organization role authority is missing';
  end if;
end;
$$;

alter table public.lukas_qto_organization_members
  add column library_access boolean not null default true;

create table public.lukas_qto_organization_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.lukas_qto_organizations(id) on delete restrict,
  normalized_email text not null check(
    normalized_email=pg_catalog.lower(pg_catalog.btrim(normalized_email))
    and normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ),
  role text not null check(role in('admin','member')),
  library_access boolean not null default true,
  target_user_id uuid references auth.users(id) on delete restrict,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id) on delete restrict,
  revoke_reason text check(revoke_reason is null or char_length(pg_catalog.btrim(revoke_reason)) between 1 and 1000),
  request_id uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(invited_by,request_id),
  check((accepted_at is null and accepted_by is null) or (accepted_at is not null and accepted_by is not null)),
  check((revoked_at is null and revoked_by is null and revoke_reason is null)
    or (revoked_at is not null and revoked_by is not null and revoke_reason is not null)),
  check(not(accepted_at is not null and revoked_at is not null))
);

create index lukas_qto_organization_invitations_active_email_idx
  on public.lukas_qto_organization_invitations(organization_id,normalized_email)
  where accepted_at is null and revoked_at is null;
create index lukas_qto_organization_invitations_org_idx
  on public.lukas_qto_organization_invitations(organization_id,created_at desc,id desc);
create index lukas_qto_organization_invitations_target_idx
  on public.lukas_qto_organization_invitations(target_user_id)
  where target_user_id is not null;

create table public.lukas_qto_organization_entitlement_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.lukas_qto_organizations(id) on delete restrict,
  version_no integer not null check(version_no>0),
  plan text not null check(plan in('legacy','free','team','business','enterprise')),
  seat_limit integer not null check(seat_limit between 1 and 100000),
  project_limit integer not null check(project_limit between 1 and 100000),
  library_version_limit integer not null check(library_version_limit between 0 and 1000000),
  trial_ends_at timestamptz,
  features jsonb not null check(
    pg_catalog.jsonb_typeof(features)='object'
    and features-array['drawing_workspace','organization_library','realtime_collaboration','ifc_workspace','quantity_lineage']='{}'::jsonb
    and features ?& array['drawing_workspace','organization_library','realtime_collaboration','ifc_workspace','quantity_lineage']
    and pg_catalog.jsonb_typeof(features->'drawing_workspace')='boolean'
    and pg_catalog.jsonb_typeof(features->'organization_library')='boolean'
    and pg_catalog.jsonb_typeof(features->'realtime_collaboration')='boolean'
    and pg_catalog.jsonb_typeof(features->'ifc_workspace')='boolean'
    and pg_catalog.jsonb_typeof(features->'quantity_lineage')='boolean'
  ),
  reason text not null check(char_length(pg_catalog.btrim(reason)) between 1 and 1000),
  request_id uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(organization_id,version_no),
  unique(created_by,request_id)
);
create index lukas_qto_organization_entitlement_versions_org_idx
  on public.lukas_qto_organization_entitlement_versions(organization_id,version_no desc);

create table public.lukas_qto_organization_admin_events (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.lukas_qto_organizations(id) on delete restrict,
  event_type text not null check(event_type in(
    'organization_settings_changed','invitation_created','invitation_revoked','invitation_accepted',
    'organization_role_changed','organization_member_removed','library_access_changed',
    'project_member_changed','project_member_removed','project_moved','entitlement_changed'
  )),
  subject_user_id uuid references auth.users(id) on delete restrict,
  project_id uuid,
  invitation_id uuid references public.lukas_qto_organization_invitations(id) on delete restrict,
  entitlement_version_id uuid references public.lukas_qto_organization_entitlement_versions(id) on delete restrict,
  request_id uuid not null,
  request_sha256 text not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  details jsonb not null default '{}'::jsonb check(pg_catalog.jsonb_typeof(details)='object'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(actor_id,request_id)
);
create index lukas_qto_organization_admin_events_org_idx
  on public.lukas_qto_organization_admin_events(organization_id,created_at desc,id desc);
create index lukas_qto_organization_admin_events_subject_idx
  on public.lukas_qto_organization_admin_events(subject_user_id)
  where subject_user_id is not null;
create index lukas_qto_organization_admin_events_invitation_idx
  on public.lukas_qto_organization_admin_events(invitation_id)
  where invitation_id is not null;
create index lukas_qto_organization_admin_events_entitlement_idx
  on public.lukas_qto_organization_admin_events(entitlement_version_id)
  where entitlement_version_id is not null;

create function private.lukas_qto_organization_admin_append_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='P7A02',message='Organization administration evidence is append-only';
end;
$$;
create trigger lukas_qto_organization_entitlement_versions_append_only
before update or delete on public.lukas_qto_organization_entitlement_versions
for each row execute function private.lukas_qto_organization_admin_append_guard();
create trigger lukas_qto_organization_admin_events_append_only
before update or delete on public.lukas_qto_organization_admin_events
for each row execute function private.lukas_qto_organization_admin_append_guard();

create function private.lukas_qto_organization_membership_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_event_id uuid;
begin
  v_event_id:=nullif(pg_catalog.current_setting('app.lukas_organization_admin_event_id',true),'')::uuid;
  if current_user<>pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    ) or v_event_id is null or not exists(
      select 1 from public.lukas_qto_organization_admin_events e
      where e.id=v_event_id and e.organization_id=old.organization_id
        and e.subject_user_id=old.user_id
    ) then
    raise exception using errcode='P7A03',message='Organization membership changes are RPC-only and audited';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;
create trigger lukas_qto_organization_membership_guard
before update or delete on public.lukas_qto_organization_members
for each row execute function private.lukas_qto_organization_membership_guard();

create function private.lukas_qto_project_organization_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_event_id uuid;
begin
  if new.organization_id is not distinct from old.organization_id then
    return new;
  end if;
  v_event_id:=nullif(pg_catalog.current_setting(
    'app.lukas_project_organization_event_id',true
  ),'')::uuid;
  if current_user<>pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
    ) or v_event_id is null or not exists(
      select 1 from public.lukas_qto_organization_admin_events e
      where e.id=v_event_id and e.organization_id=old.organization_id
        and e.project_id=old.id and e.event_type='project_moved'
        and e.details->>'destinationOrganizationId'=new.organization_id::text
    ) then
    raise exception using errcode='P7A03',
      message='Project organization changes are RPC-only and audited';
  end if;
  return new;
end;
$$;
create trigger lukas_qto_project_organization_guard
before update of organization_id on public.lukas_qto_projects
for each row execute function private.lukas_qto_project_organization_guard();

create function private.lukas_qto_organization_manager(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select auth.uid()) is not null
    and private.lukas_qto_organization_role(p_organization_id) in('owner','admin','staff'),false)
$$;

create function private.lukas_qto_project_membership_manager(p_project_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    private.lukas_qto_project_role(p.id) in('owner','staff')
      or private.lukas_qto_organization_manager(p.organization_id),false
  ) from public.lukas_qto_projects p where p.id=p_project_id
$$;

create function private.lukas_qto_current_entitlement(p_organization_id uuid)
returns public.lukas_qto_organization_entitlement_versions
language sql stable security definer set search_path='' as $$
  select e.* from public.lukas_qto_organization_entitlement_versions e
  where e.organization_id=p_organization_id order by e.version_no desc limit 1
$$;

create function private.lukas_qto_organization_feature_active(
  p_organization_id uuid,p_feature text
) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    (e.trial_ends_at is null or e.trial_ends_at>pg_catalog.now())
      and (e.features->>p_feature)::boolean,false
  ) from private.lukas_qto_current_entitlement(p_organization_id) e
  where p_feature in('drawing_workspace','organization_library','realtime_collaboration','ifc_workspace','quantity_lineage')
$$;

create function private.lukas_qto_project_feature_active(
  p_project_id uuid,p_feature text
) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(private.lukas_qto_organization_feature_active(
    p.organization_id,p_feature
  ),false) from public.lukas_qto_projects p where p.id=p_project_id
$$;

create function public.lukas_qto_organization_feature_enabled(
  p_organization_id uuid,p_feature text
) returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    private.lukas_qto_organization_role(p_organization_id) is not null
      and private.lukas_qto_organization_feature_active(
        p_organization_id,p_feature
      ),false
  )
$$;

create function private.lukas_qto_organization_library_access(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    public.lukas_qto_organization_feature_enabled(p_organization_id,'organization_library')
    and (
      private.lukas_qto_organization_role(p_organization_id)='staff'
      or exists(select 1 from public.lukas_qto_organization_members m
        where m.organization_id=p_organization_id and m.user_id=(select auth.uid())
          and (m.role in('owner','admin') or m.library_access))
    ),false)
$$;

create function private.lukas_qto_admin_request_sha(p_values jsonb)
returns text language sql immutable security definer set search_path='' as $$
  select pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(p_values::text,'UTF8'),'sha256'),'hex')
$$;

create function private.lukas_qto_admin_retry_matches(
  p_actor uuid,p_request_id uuid,p_request_sha256 text
) returns boolean language plpgsql stable security definer set search_path='' as $$
declare v_stored text;
begin
  select e.request_sha256 into v_stored from public.lukas_qto_organization_admin_events e
    where e.actor_id=p_actor and e.request_id=p_request_id;
  if not found then return false; end if;
  if v_stored<>p_request_sha256 then
    raise exception using errcode='P7A06',message='Request ID does not match the stored organization administration action';
  end if;
  return true;
end;
$$;

-- Existing organizations retain their current behavior until staff deliberately
-- appends a new plan version. Limits are raised to the existing row counts.
insert into public.lukas_qto_organization_entitlement_versions(
  organization_id,version_no,plan,seat_limit,project_limit,library_version_limit,
  trial_ends_at,features,reason,request_id,request_sha256,created_by
)
select o.id,1,'legacy',
  greatest(3,(select pg_catalog.count(*)::integer from public.lukas_qto_organization_members m where m.organization_id=o.id)),
  greatest(10,(select pg_catalog.count(*)::integer from public.lukas_qto_projects p where p.organization_id=o.id)),
  greatest(100,(select pg_catalog.count(*)::integer from public.lukas_drawing_library_versions v where v.organization_id=o.id)),
  null,'{"drawing_workspace":true,"organization_library":true,"realtime_collaboration":true,"ifc_workspace":true,"quantity_lineage":true}'::jsonb,
  'P7 legacy authority bootstrap',extensions.gen_random_uuid(),
  private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(o.id,'legacy-bootstrap')),null
from public.lukas_qto_organizations o;

create function private.lukas_qto_default_organization_entitlement()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_request uuid:=extensions.gen_random_uuid();
begin
  insert into public.lukas_qto_organization_entitlement_versions(
    organization_id,version_no,plan,seat_limit,project_limit,library_version_limit,
    features,reason,request_id,request_sha256,created_by
  ) values(
    new.id,1,'free',3,3,10,
    '{"drawing_workspace":true,"organization_library":true,"realtime_collaboration":true,"ifc_workspace":true,"quantity_lineage":true}'::jsonb,
    'Default free plan',v_request,
    private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(new.id,'free',3,3,10)),new.owner_id
  );
  return new;
end;
$$;
create trigger lukas_qto_organizations_default_entitlement
after insert on public.lukas_qto_organizations
for each row execute function private.lukas_qto_default_organization_entitlement();

create function public.lukas_qto_update_organization_settings(
  p_organization_id uuid,p_name text,p_request_id uuid
) returns public.lukas_qto_organizations
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_event public.lukas_qto_organization_admin_events%rowtype;
  v_result public.lukas_qto_organizations%rowtype; v_name text:=pg_catalog.btrim(p_name); v_sha text;
begin
  if v_actor is null or not private.lukas_qto_organization_manager(p_organization_id) then
    raise exception using errcode='P7A04',message='Organization settings authority denied';
  end if;
  if char_length(v_name) not between 1 and 160 or p_request_id is null then
    raise exception using errcode='P7A05',message='Organization settings input is invalid';
  end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_organization_id,v_name));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  select * into v_event from public.lukas_qto_organization_admin_events where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then raise exception using errcode='P7A06',message='Request ID does not match organization settings'; end if;
    select * into v_result from public.lukas_qto_organizations where id=p_organization_id;
    return v_result;
  end if;
  update public.lukas_qto_organizations set name=v_name where id=p_organization_id returning * into v_result;
  if not found then raise exception using errcode='P7A04',message='Organization settings authority denied'; end if;
  insert into public.lukas_qto_organization_admin_events(organization_id,event_type,request_id,request_sha256,details,actor_id)
  values(p_organization_id,'organization_settings_changed',p_request_id,v_sha,pg_catalog.jsonb_build_object('name',v_name),v_actor);
  return v_result;
end;
$$;

create function public.lukas_qto_invite_organization_member(
  p_organization_id uuid,p_email text,p_role text,p_library_access boolean,
  p_expires_in_days integer,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_email text:=pg_catalog.lower(pg_catalog.btrim(p_email));
  v_target uuid; v_invitation public.lukas_qto_organization_invitations%rowtype;
  v_event public.lukas_qto_organization_admin_events%rowtype; v_sha text;
begin
  if v_actor is null or not private.lukas_qto_organization_manager(p_organization_id) then
    raise exception using errcode='P7A04',message='Organization invitation authority denied';
  end if;
  if v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
    or p_role not in('admin','member') or p_expires_in_days not between 1 and 30
    or p_request_id is null then
    raise exception using errcode='P7A05',message='Organization invitation input is invalid';
  end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(
    p_organization_id,v_email,p_role,p_library_access,p_expires_in_days));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  select * into v_event from public.lukas_qto_organization_admin_events where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then raise exception using errcode='P7A06',message='Request ID does not match organization invitation'; end if;
    select * into v_invitation from public.lukas_qto_organization_invitations where id=v_event.invitation_id;
    return pg_catalog.jsonb_build_object('invitationId',v_invitation.id,'expiresAt',v_invitation.expires_at);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text||':'||v_email,0
  ));
  select u.id into v_target from auth.users u
    where pg_catalog.lower(pg_catalog.btrim(u.email))=v_email and coalesce(u.is_anonymous,false)=false;
  if v_target is not null and exists(select 1 from public.lukas_qto_organization_members m
      where m.organization_id=p_organization_id and m.user_id=v_target) then
    raise exception using errcode='P7A05',message='User is already an organization member';
  end if;
  if exists(select 1 from public.lukas_qto_organization_invitations i
      where i.organization_id=p_organization_id and i.normalized_email=v_email
        and i.accepted_at is null and i.revoked_at is null
        and i.expires_at>pg_catalog.now()) then
    raise exception using errcode='P7A05',message='An active invitation already exists';
  end if;
  insert into public.lukas_qto_organization_invitations(
    organization_id,normalized_email,role,library_access,target_user_id,expires_at,
    request_id,request_sha256,invited_by
  ) values(p_organization_id,v_email,p_role,p_library_access,v_target,
    pg_catalog.now()+pg_catalog.make_interval(days=>p_expires_in_days),p_request_id,v_sha,v_actor)
  returning * into v_invitation;
  insert into public.lukas_qto_organization_admin_events(
    organization_id,event_type,invitation_id,request_id,request_sha256,details,actor_id
  ) values(p_organization_id,'invitation_created',v_invitation.id,p_request_id,v_sha,
    pg_catalog.jsonb_build_object('email',v_email,'role',p_role,'libraryAccess',p_library_access,'expiresAt',v_invitation.expires_at),v_actor);
  return pg_catalog.jsonb_build_object('invitationId',v_invitation.id,'expiresAt',v_invitation.expires_at);
end;
$$;

create function public.lukas_qto_revoke_organization_invitation(
  p_organization_id uuid,p_invitation_id uuid,p_reason text,p_request_id uuid
) returns public.lukas_qto_organization_invitations
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_invitation public.lukas_qto_organization_invitations%rowtype;
  v_event public.lukas_qto_organization_admin_events%rowtype; v_reason text:=pg_catalog.btrim(p_reason); v_sha text;
begin
  if v_actor is null or not private.lukas_qto_organization_manager(p_organization_id) then
    raise exception using errcode='P7A04',message='Organization invitation authority denied';
  end if;
  if char_length(v_reason) not between 1 and 1000 or p_request_id is null then
    raise exception using errcode='P7A05',message='Invitation revocation input is invalid';
  end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_organization_id,p_invitation_id,v_reason));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  select * into v_event from public.lukas_qto_organization_admin_events where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then raise exception using errcode='P7A06',message='Request ID does not match invitation revocation'; end if;
    select * into v_invitation from public.lukas_qto_organization_invitations where id=v_event.invitation_id;
    return v_invitation;
  end if;
  select * into v_invitation from public.lukas_qto_organization_invitations i
    where i.id=p_invitation_id and i.organization_id=p_organization_id for update;
  if not found or v_invitation.accepted_at is not null or v_invitation.revoked_at is not null then
    raise exception using errcode='P7A05',message='Active organization invitation is unavailable';
  end if;
  update public.lukas_qto_organization_invitations set revoked_at=pg_catalog.now(),revoked_by=v_actor,revoke_reason=v_reason
    where id=v_invitation.id returning * into v_invitation;
  insert into public.lukas_qto_organization_admin_events(
    organization_id,event_type,invitation_id,request_id,request_sha256,details,actor_id
  ) values(p_organization_id,'invitation_revoked',v_invitation.id,p_request_id,v_sha,
    pg_catalog.jsonb_build_object('reason',v_reason),v_actor);
  return v_invitation;
end;
$$;

create function public.lukas_qto_accept_organization_invitation(
  p_invitation_id uuid,p_request_id uuid
) returns public.lukas_qto_organization_members
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_email text; v_invitation public.lukas_qto_organization_invitations%rowtype;
  v_entitlement public.lukas_qto_organization_entitlement_versions%rowtype;
  v_event public.lukas_qto_organization_admin_events%rowtype; v_member public.lukas_qto_organization_members%rowtype; v_sha text;
begin
  if v_actor is null or p_request_id is null then raise exception using errcode='P7A04',message='Invitation acceptance authority denied'; end if;
  select pg_catalog.lower(pg_catalog.btrim(u.email)) into v_email from auth.users u
    where u.id=v_actor and coalesce(u.is_anonymous,false)=false;
  select * into v_invitation from public.lukas_qto_organization_invitations i
    where i.id=p_invitation_id for update;
  if not found or v_email is null or v_invitation.normalized_email<>v_email
    or (v_invitation.target_user_id is not null and v_invitation.target_user_id<>v_actor) then
    raise exception using errcode='P7A04',message='Organization invitation is unavailable or expired';
  end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_invitation_id,v_actor));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  select * into v_event from public.lukas_qto_organization_admin_events where actor_id=v_actor and request_id=p_request_id;
  if found then
    if v_event.request_sha256<>v_sha then raise exception using errcode='P7A06',message='Request ID does not match invitation acceptance'; end if;
    select * into v_member from public.lukas_qto_organization_members where organization_id=v_event.organization_id and user_id=v_actor;
    return v_member;
  end if;
  if v_invitation.accepted_at is not null or v_invitation.revoked_at is not null
    or not(v_invitation.expires_at>pg_catalog.now()) then
    raise exception using errcode='P7A04',message='Organization invitation is unavailable or expired';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_invitation.organization_id::text,0));
  select * into v_entitlement from private.lukas_qto_current_entitlement(v_invitation.organization_id);
  if (select pg_catalog.count(*) from public.lukas_qto_organization_members m where m.organization_id=v_invitation.organization_id)>=v_entitlement.seat_limit then
    raise exception using errcode='P7A07',message='Organization seat limit reached';
  end if;
  insert into public.lukas_qto_organization_members(organization_id,user_id,role,library_access)
  values(v_invitation.organization_id,v_actor,v_invitation.role,v_invitation.library_access)
  returning * into v_member;
  update public.lukas_qto_organization_invitations set accepted_at=pg_catalog.now(),accepted_by=v_actor,target_user_id=v_actor
    where id=v_invitation.id;
  insert into public.lukas_qto_organization_admin_events(
    organization_id,event_type,subject_user_id,invitation_id,request_id,request_sha256,details,actor_id
  ) values(v_invitation.organization_id,'invitation_accepted',v_actor,v_invitation.id,p_request_id,v_sha,
    pg_catalog.jsonb_build_object('role',v_invitation.role,'libraryAccess',v_invitation.library_access),v_actor);
  return v_member;
end;
$$;

create function public.lukas_qto_change_organization_member(
  p_organization_id uuid,p_user_id uuid,p_role text,p_library_access boolean,p_request_id uuid
) returns public.lukas_qto_organization_members
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_member public.lukas_qto_organization_members%rowtype;
  v_owner uuid; v_event_id uuid:=extensions.gen_random_uuid(); v_sha text;
begin
  if v_actor is null or not private.lukas_qto_organization_manager(p_organization_id) then
    raise exception using errcode='P7A04',message='Organization member authority denied';
  end if;
  if p_role not in('admin','member') or p_request_id is null then
    raise exception using errcode='P7A05',message='Organization member role is invalid';
  end if;
  select o.owner_id into v_owner from public.lukas_qto_organizations o where o.id=p_organization_id;
  if p_user_id=v_owner then raise exception using errcode='P7A05',message='Cannot change the organization owner'; end if;
  select * into v_member from public.lukas_qto_organization_members m where m.organization_id=p_organization_id and m.user_id=p_user_id for update;
  if not found then raise exception using errcode='P7A04',message='Organization member is unavailable'; end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_organization_id,p_user_id,p_role,p_library_access));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  if private.lukas_qto_admin_retry_matches(v_actor,p_request_id,v_sha) then
    select * into v_member from public.lukas_qto_organization_members where organization_id=p_organization_id and user_id=p_user_id; return v_member;
  end if;
  insert into public.lukas_qto_organization_admin_events(
    id,organization_id,event_type,subject_user_id,request_id,request_sha256,details,actor_id
  ) values(v_event_id,p_organization_id,'organization_role_changed',p_user_id,p_request_id,v_sha,
    pg_catalog.jsonb_build_object('fromRole',v_member.role,'toRole',p_role,'fromLibraryAccess',v_member.library_access,'toLibraryAccess',p_library_access),v_actor);
  perform pg_catalog.set_config('app.lukas_organization_admin_event_id',v_event_id::text,true);
  update public.lukas_qto_organization_members set role=p_role,library_access=p_library_access
    where organization_id=p_organization_id and user_id=p_user_id returning * into v_member;
  return v_member;
end;
$$;

create function public.lukas_qto_remove_organization_member(
  p_organization_id uuid,p_user_id uuid,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_owner uuid; v_event_id uuid:=extensions.gen_random_uuid();
  v_reason text:=pg_catalog.btrim(p_reason); v_sha text;
begin
  if v_actor is null or not private.lukas_qto_organization_manager(p_organization_id) then raise exception using errcode='P7A04',message='Organization member authority denied'; end if;
  select o.owner_id into v_owner from public.lukas_qto_organizations o where o.id=p_organization_id;
  if p_user_id=v_owner then raise exception using errcode='P7A05',message='Cannot change the organization owner'; end if;
  if char_length(v_reason) not between 1 and 1000 or p_request_id is null then raise exception using errcode='P7A05',message='Member removal input is invalid'; end if;
  if exists(select 1 from public.lukas_qto_projects p
      where p.organization_id=p_organization_id and p.owner_id=p_user_id)
    or exists(select 1 from public.lukas_qto_project_members pm join public.lukas_qto_projects p on p.id=pm.project_id
      where p.organization_id=p_organization_id and pm.user_id=p_user_id) then
    raise exception using errcode='P7A05',message='Remove project memberships before organization membership';
  end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_organization_id,p_user_id,v_reason));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  if private.lukas_qto_admin_retry_matches(v_actor,p_request_id,v_sha) then return pg_catalog.jsonb_build_object('removed',true); end if;
  if not exists(select 1 from public.lukas_qto_organization_members m where m.organization_id=p_organization_id and m.user_id=p_user_id) then raise exception using errcode='P7A04',message='Organization member is unavailable'; end if;
  insert into public.lukas_qto_organization_admin_events(id,organization_id,event_type,subject_user_id,request_id,request_sha256,details,actor_id)
  values(v_event_id,p_organization_id,'organization_member_removed',p_user_id,p_request_id,v_sha,pg_catalog.jsonb_build_object('reason',v_reason),v_actor);
  perform pg_catalog.set_config('app.lukas_organization_admin_event_id',v_event_id::text,true);
  delete from public.lukas_qto_organization_members where organization_id=p_organization_id and user_id=p_user_id;
  return pg_catalog.jsonb_build_object('removed',true);
end;
$$;

create function public.lukas_qto_set_organization_entitlement(
  p_organization_id uuid,p_plan text,p_seat_limit integer,p_project_limit integer,
  p_library_version_limit integer,p_trial_ends_at timestamptz,p_features jsonb,
  p_reason text,p_request_id uuid
) returns public.lukas_qto_organization_entitlement_versions
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_version public.lukas_qto_organization_entitlement_versions%rowtype;
  v_reason text:=pg_catalog.btrim(p_reason); v_sha text; v_next integer;
begin
  if v_actor is null or (select auth.jwt()->'app_metadata'->>'role') is distinct from 'hangil_staff' then
    raise exception using errcode='P7A04',message='Entitlement authority denied';
  end if;
  if not exists(select 1 from public.lukas_qto_organizations o where o.id=p_organization_id)
    or p_plan not in('legacy','free','team','business','enterprise')
    or p_seat_limit not between 1 and 100000 or p_project_limit not between 1 and 100000
    or p_library_version_limit not between 0 and 1000000
    or pg_catalog.jsonb_typeof(p_features)<>'object'
    or p_features-array['drawing_workspace','organization_library','realtime_collaboration','ifc_workspace','quantity_lineage']<>'{}'::jsonb
    or not(p_features ?& array['drawing_workspace','organization_library','realtime_collaboration','ifc_workspace','quantity_lineage'])
    or exists(select 1 from pg_catalog.jsonb_each(p_features) feature where pg_catalog.jsonb_typeof(feature.value)<>'boolean')
    or char_length(v_reason) not between 1 and 1000 or p_request_id is null then
    raise exception using errcode='P7A05',message='Entitlement input is invalid';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_organization_id::text,0));
  if p_seat_limit<(select pg_catalog.count(*) from public.lukas_qto_organization_members m where m.organization_id=p_organization_id) then raise exception using errcode='P7A07',message='Seat limit is below current membership'; end if;
  if p_project_limit<(select pg_catalog.count(*) from public.lukas_qto_projects p where p.organization_id=p_organization_id and p.archived_at is null) then raise exception using errcode='P7A07',message='Project quota is below current usage'; end if;
  if p_library_version_limit<(select pg_catalog.count(*) from public.lukas_drawing_library_versions v where v.organization_id=p_organization_id and v.status in('published','deprecated')) then raise exception using errcode='P7A07',message='Library version quota is below current usage'; end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_organization_id,p_plan,p_seat_limit,p_project_limit,p_library_version_limit,p_trial_ends_at,p_features,v_reason));
  select * into v_version from public.lukas_qto_organization_entitlement_versions where created_by=v_actor and request_id=p_request_id;
  if found then if v_version.request_sha256<>v_sha then raise exception using errcode='P7A06',message='Request ID does not match entitlement change'; end if; return v_version; end if;
  select coalesce(pg_catalog.max(e.version_no),0)+1 into v_next from public.lukas_qto_organization_entitlement_versions e where e.organization_id=p_organization_id;
  insert into public.lukas_qto_organization_entitlement_versions(organization_id,version_no,plan,seat_limit,project_limit,library_version_limit,trial_ends_at,features,reason,request_id,request_sha256,created_by)
  values(p_organization_id,v_next,p_plan,p_seat_limit,p_project_limit,p_library_version_limit,p_trial_ends_at,p_features,v_reason,p_request_id,v_sha,v_actor) returning * into v_version;
  insert into public.lukas_qto_organization_admin_events(organization_id,event_type,entitlement_version_id,request_id,request_sha256,details,actor_id)
  values(p_organization_id,'entitlement_changed',v_version.id,p_request_id,v_sha,
    pg_catalog.jsonb_build_object('plan',p_plan,'seatLimit',p_seat_limit,'projectLimit',p_project_limit,'libraryVersionLimit',p_library_version_limit,'trialEndsAt',p_trial_ends_at,'features',p_features),v_actor);
  return v_version;
end;
$$;

create function public.lukas_qto_list_organization_members(
  p_organization_id uuid,p_after_user_id uuid default null,p_page_size integer default 100
) returns table(user_id uuid,email text,role text,library_access boolean,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.lukas_qto_organization_manager(p_organization_id) then raise exception using errcode='P7A04',message='Organization member list authority denied'; end if;
  if p_page_size not between 1 and 100 then raise exception using errcode='P7A05',message='Organization member page is invalid'; end if;
  return query select m.user_id,pg_catalog.lower(pg_catalog.btrim(u.email)),m.role,m.library_access,m.created_at
    from public.lukas_qto_organization_members m join auth.users u on u.id=m.user_id
    where m.organization_id=p_organization_id and (p_after_user_id is null or m.user_id>p_after_user_id)
    order by m.user_id limit p_page_size;
end;
$$;

create function public.lukas_qto_list_organization_invitations(
  p_organization_id uuid,p_after_invitation_id uuid default null,p_page_size integer default 100
) returns table(id uuid,normalized_email text,role text,library_access boolean,
  expires_at timestamptz,accepted_at timestamptz,revoked_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.lukas_qto_organization_manager(p_organization_id) then raise exception using errcode='P7A04',message='Organization invitation list authority denied'; end if;
  if p_page_size not between 1 and 100 then raise exception using errcode='P7A05',message='Organization invitation page is invalid'; end if;
  return query select i.id,i.normalized_email,i.role,i.library_access,i.expires_at,i.accepted_at,i.revoked_at,i.created_at
    from public.lukas_qto_organization_invitations i
    where i.organization_id=p_organization_id and (p_after_invitation_id is null or i.id>p_after_invitation_id)
    order by i.id limit p_page_size;
end;
$$;

create function public.lukas_qto_list_organization_projects(
  p_organization_id uuid,p_after_project_id uuid default null,p_page_size integer default 100
) returns table(id uuid,name text,organization_id uuid,archived_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.lukas_qto_organization_manager(p_organization_id) then raise exception using errcode='P7A04',message='Organization project list authority denied'; end if;
  if p_page_size not between 1 and 100 then raise exception using errcode='P7A05',message='Organization project page is invalid'; end if;
  return query select p.id,p.name,p.organization_id,p.archived_at
    from public.lukas_qto_projects p
    where p.organization_id=p_organization_id and p.archived_at is null
      and (p_after_project_id is null or p.id>p_after_project_id)
    order by p.id limit p_page_size;
end;
$$;

create function public.lukas_qto_list_managed_organizations(
  p_organization_id uuid,p_after_organization_id uuid default null,p_page_size integer default 100
) returns table(id uuid,name text)
language plpgsql stable security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_staff boolean:=coalesce((select auth.jwt()->'app_metadata'->>'role')='hangil_staff',false);
begin
  if v_actor is null or not private.lukas_qto_organization_manager(p_organization_id) then raise exception using errcode='P7A04',message='Managed organization list authority denied'; end if;
  if p_page_size not between 1 and 100 then raise exception using errcode='P7A05',message='Managed organization page is invalid'; end if;
  return query select o.id,o.name from public.lukas_qto_organizations o
    where o.id<>p_organization_id and (p_after_organization_id is null or o.id>p_after_organization_id)
      and (v_staff or o.owner_id=v_actor or exists(select 1 from public.lukas_qto_organization_members m
        where m.organization_id=o.id and m.user_id=v_actor and m.role in('owner','admin')))
    order by o.id limit p_page_size;
end;
$$;

create function public.lukas_qto_list_project_members(
  p_project_id uuid,p_after_user_id uuid default null,p_page_size integer default 100
) returns table(user_id uuid,email text,role text,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.lukas_qto_project_membership_manager(p_project_id) then raise exception using errcode='P7A04',message='Project member list authority denied'; end if;
  if p_page_size not between 1 and 100 then raise exception using errcode='P7A05',message='Project member page is invalid'; end if;
  return query select m.user_id,pg_catalog.lower(pg_catalog.btrim(u.email)),m.role,m.created_at
    from public.lukas_qto_project_members m join auth.users u on u.id=m.user_id
    where m.project_id=p_project_id and (p_after_user_id is null or m.user_id>p_after_user_id)
    order by m.user_id limit p_page_size;
end;
$$;

create function public.lukas_qto_set_project_member(
  p_organization_id uuid,p_project_id uuid,p_email text,p_role text,p_request_id uuid
) returns public.lukas_qto_project_members
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_email text:=pg_catalog.lower(pg_catalog.btrim(p_email)); v_user uuid;
  v_owner uuid; v_member public.lukas_qto_project_members%rowtype; v_sha text;
begin
  if v_actor is null or not private.lukas_qto_project_membership_manager(p_project_id) then raise exception using errcode='P7A04',message='Project member authority denied'; end if;
  select p.owner_id into v_owner from public.lukas_qto_projects p where p.id=p_project_id and p.organization_id=p_organization_id;
  if not found or p_role not in('estimator','reviewer','site','procurement','viewer') or p_request_id is null then raise exception using errcode='P7A05',message='Project member input is invalid'; end if;
  select u.id into v_user from auth.users u join public.lukas_qto_organization_members m on m.user_id=u.id
    where m.organization_id=p_organization_id and pg_catalog.lower(pg_catalog.btrim(u.email))=v_email and coalesce(u.is_anonymous,false)=false;
  if v_user is null then raise exception using errcode='P7A05',message='Exact organization member email is unavailable'; end if;
  if v_user=v_owner then raise exception using errcode='P7A05',message='Cannot change the project owner'; end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_organization_id,p_project_id,v_user,p_role));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  if private.lukas_qto_admin_retry_matches(v_actor,p_request_id,v_sha) then select * into v_member from public.lukas_qto_project_members where project_id=p_project_id and user_id=v_user; return v_member; end if;
  insert into public.lukas_qto_project_members(project_id,user_id,role) values(p_project_id,v_user,p_role)
    on conflict(project_id,user_id) do update set role=excluded.role returning * into v_member;
  insert into public.lukas_qto_organization_admin_events(organization_id,event_type,subject_user_id,project_id,request_id,request_sha256,details,actor_id)
  values(p_organization_id,'project_member_changed',v_user,p_project_id,p_request_id,v_sha,pg_catalog.jsonb_build_object('role',p_role),v_actor);
  return v_member;
end;
$$;

create function public.lukas_qto_remove_project_member(
  p_organization_id uuid,p_project_id uuid,p_user_id uuid,p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_owner uuid; v_reason text:=pg_catalog.btrim(p_reason); v_sha text;
begin
  if v_actor is null or not private.lukas_qto_project_membership_manager(p_project_id) then raise exception using errcode='P7A04',message='Project member authority denied'; end if;
  select p.owner_id into v_owner from public.lukas_qto_projects p where p.id=p_project_id and p.organization_id=p_organization_id;
  if not found or p_user_id=v_owner or char_length(v_reason) not between 1 and 1000 or p_request_id is null then raise exception using errcode='P7A05',message='Project member removal input is invalid'; end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_organization_id,p_project_id,p_user_id,v_reason));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  if private.lukas_qto_admin_retry_matches(v_actor,p_request_id,v_sha) then return pg_catalog.jsonb_build_object('removed',true); end if;
  delete from public.lukas_qto_project_members where project_id=p_project_id and user_id=p_user_id;
  if not found then raise exception using errcode='P7A04',message='Project member is unavailable'; end if;
  insert into public.lukas_qto_organization_admin_events(organization_id,event_type,subject_user_id,project_id,request_id,request_sha256,details,actor_id)
  values(p_organization_id,'project_member_removed',p_user_id,p_project_id,p_request_id,v_sha,pg_catalog.jsonb_build_object('reason',v_reason),v_actor);
  return pg_catalog.jsonb_build_object('removed',true);
end;
$$;

create function public.lukas_qto_move_project(
  p_organization_id uuid,p_project_id uuid,p_destination_organization_id uuid,
  p_reason text,p_request_id uuid
) returns public.lukas_qto_projects
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_project public.lukas_qto_projects%rowtype;
  v_entitlement public.lukas_qto_organization_entitlement_versions%rowtype;
  v_event_id uuid:=extensions.gen_random_uuid();
  v_reason text:=pg_catalog.btrim(p_reason); v_sha text;
begin
  if v_actor is null or p_organization_id=p_destination_organization_id
    or not private.lukas_qto_organization_manager(p_organization_id)
    or not private.lukas_qto_organization_manager(p_destination_organization_id) then
    raise exception using errcode='P7A04',message='Source or destination organization authority denied';
  end if;
  if char_length(v_reason) not between 1 and 1000 or p_request_id is null then
    raise exception using errcode='P7A05',message='Project move input is invalid or retained';
  end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_organization_id,p_project_id,p_destination_organization_id,v_reason));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  if private.lukas_qto_admin_retry_matches(v_actor,p_request_id,v_sha) then
    select * into v_project from public.lukas_qto_projects p
      where p.id=p_project_id and p.organization_id=p_destination_organization_id;
    if not found then raise exception using errcode='P7A06',message='Stored project move is no longer current'; end if;
    return v_project;
  end if;
  select * into v_project from public.lukas_qto_projects p where p.id=p_project_id and p.organization_id=p_organization_id for update;
  if not found or v_project.archived_at is not null or v_project.deletion_requested_at is not null then
    raise exception using errcode='P7A05',message='Project move input is invalid or retained';
  end if;
  if exists(select 1 from public.lukas_drawing_library_imports i where i.project_id=p_project_id)
    or exists(select 1 from public.lukas_drawing_library_versions v where v.source_project_id=p_project_id)
    or exists(select 1 from public.lukas_qto_retention_events e where e.project_id=p_project_id)
    or exists(select 1 from public.lukas_qto_export_events e where e.project_id=p_project_id) then
    raise exception using errcode='P7A08',message='Project with retention or library imports cannot move organizations';
  end if;
  if exists(select 1 from public.lukas_drawing_revisions r where r.project_id=p_project_id and r.status in('approved','superseded'))
    or exists(select 1 from public.lukas_drawing_revision_approvals a where a.project_id=p_project_id and a.decision='approved')
    or exists(select 1 from public.lukas_drawing_issue_approvals a where a.project_id=p_project_id and a.decision='approved')
    or exists(select 1 from public.lukas_qto_boq_versions b where b.project_id=p_project_id and b.status in('approved','superseded'))
    or exists(select 1 from public.lukas_qto_boq_approvals a join public.lukas_qto_boq_versions b on b.id=a.version_id where b.project_id=p_project_id and a.decision='approved')
    or exists(select 1 from public.lukas_drawing_quantity_links q where q.project_id=p_project_id)
    or exists(select 1 from public.lukas_drawing_boq_links b where b.project_id=p_project_id)
    or exists(select 1 from public.lukas_drawing_material_links m where m.project_id=p_project_id)
    or exists(select 1 from public.lukas_qto_material_plans m where m.project_id=p_project_id)
    or exists(select 1 from public.lukas_qto_material_transactions m where m.project_id=p_project_id) then
    raise exception using errcode='P7A08',message='Project with approved drawing, BOQ, quantity, or material evidence cannot move organizations';
  end if;
  if exists(select 1 from public.lukas_qto_project_members pm where pm.project_id=p_project_id
    and not exists(select 1 from public.lukas_qto_organization_members om
      where om.organization_id=p_destination_organization_id and om.user_id=pm.user_id)) then
    raise exception using errcode='P7A08',message='Every project member must belong to the destination organization';
  end if;
  if not exists(select 1 from public.lukas_qto_organization_members om
    where om.organization_id=p_destination_organization_id
      and om.user_id=v_project.owner_id) then
    raise exception using errcode='P7A08',message='Project owner must belong to the destination organization';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_destination_organization_id::text,0));
  select * into v_entitlement from private.lukas_qto_current_entitlement(p_destination_organization_id);
  if not private.lukas_qto_organization_feature_active(p_destination_organization_id,'drawing_workspace')
    or (select pg_catalog.count(*) from public.lukas_qto_projects p where p.organization_id=p_destination_organization_id and p.archived_at is null)>=v_entitlement.project_limit then
    raise exception using errcode='P7A07',message='Destination organization project quota reached';
  end if;
  insert into public.lukas_qto_organization_admin_events(id,organization_id,event_type,project_id,request_id,request_sha256,details,actor_id)
  values(v_event_id,p_organization_id,'project_moved',p_project_id,p_request_id,v_sha,
    pg_catalog.jsonb_build_object('destinationOrganizationId',p_destination_organization_id,'reason',v_reason),v_actor);
  perform pg_catalog.set_config(
    'app.lukas_project_organization_event_id',v_event_id::text,true
  );
  update public.lukas_qto_projects set organization_id=p_destination_organization_id where id=p_project_id returning * into v_project;
  return v_project;
end;
$$;

create function private.lukas_qto_projects_entitlement_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_organization_id uuid:=new.organization_id; v_entitlement public.lukas_qto_organization_entitlement_versions%rowtype;
begin
  if v_organization_id is null then select o.id into v_organization_id from public.lukas_qto_organizations o where o.owner_id=new.owner_id and o.is_personal limit 1; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_organization_id::text,0));
  select * into v_entitlement from private.lukas_qto_current_entitlement(v_organization_id);
  if v_entitlement.id is null or not private.lukas_qto_organization_feature_active(v_organization_id,'drawing_workspace') then raise exception using errcode='P7A07',message='Drawing workspace entitlement is unavailable'; end if;
  if (select pg_catalog.count(*) from public.lukas_qto_projects p where p.organization_id=v_organization_id and p.archived_at is null)>=v_entitlement.project_limit then raise exception using errcode='P7A07',message='Organization project quota reached'; end if;
  return new;
end;
$$;
create trigger zz_lukas_qto_projects_entitlement_guard
before insert on public.lukas_qto_projects
for each row execute function private.lukas_qto_projects_entitlement_guard();

create function private.lukas_drawing_library_versions_entitlement_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_entitlement public.lukas_qto_organization_entitlement_versions%rowtype;
begin
  if tg_op='UPDATE' and old.status='draft' and new.status='published' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.organization_id::text,0));
    select * into v_entitlement from private.lukas_qto_current_entitlement(new.organization_id);
    if not private.lukas_qto_organization_library_access(new.organization_id) then raise exception using errcode='P7A07',message='Organization library entitlement is unavailable'; end if;
    if (select pg_catalog.count(*) from public.lukas_drawing_library_versions v where v.organization_id=new.organization_id and v.status in('published','deprecated'))>=v_entitlement.library_version_limit then raise exception using errcode='P7A07',message='Organization library version quota reached'; end if;
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_library_versions_entitlement_guard
before update on public.lukas_drawing_library_versions
for each row execute function private.lukas_drawing_library_versions_entitlement_guard();

create or replace function private.lukas_drawing_library_manager(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null
    and private.lukas_qto_organization_role(p_organization_id) in('owner','admin','staff')
    and private.lukas_qto_organization_library_access(p_organization_id)
$$;

-- Entitlements reuse the established project capability and collaboration
-- authorities, so every existing RLS policy/RPC inherits the same hard fence.
alter function private.lukas_drawing_workspace_capability(uuid)
  rename to lukas_drawing_workspace_capability_pre_entitlement;
create function private.lukas_drawing_workspace_capability(p_project_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when private.lukas_qto_project_feature_active(
    p_project_id,'drawing_workspace'
  ) then private.lukas_drawing_workspace_capability_pre_entitlement(p_project_id)
  else null::text end
$$;

alter function private.lukas_drawing_collaboration_authorize(uuid,uuid,uuid)
  rename to lukas_drawing_collaboration_authorize_pre_entitlement;
create function private.lukas_drawing_collaboration_authorize(
  p_user_id uuid,p_project_id uuid,p_revision_id uuid
) returns table(capability text,can_write boolean,revision_status text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.lukas_qto_project_feature_active(
    p_project_id,'realtime_collaboration'
  ) then raise exception using errcode='P7A07',
    message='Realtime collaboration entitlement is unavailable'; end if;
  return query select *
  from private.lukas_drawing_collaboration_authorize_pre_entitlement(
    p_user_id,p_project_id,p_revision_id
  );
end;
$$;

alter function private.lukas_drawing_collaboration_service_load_state(uuid,uuid)
  rename to lukas_drawing_collaboration_service_load_state_pre_entitlement;
create function private.lukas_drawing_collaboration_service_load_state(
  p_project_id uuid,p_revision_id uuid
) returns table(
  revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
  yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
  byte_size integer,persisted_at timestamptz
) language plpgsql stable security definer set search_path='' as $$
begin
  if not private.lukas_qto_project_feature_active(
    p_project_id,'realtime_collaboration'
  ) then raise exception using errcode='P7A07',
    message='Realtime collaboration entitlement is unavailable'; end if;
  return query select *
  from private.lukas_drawing_collaboration_service_load_state_pre_entitlement(
    p_project_id,p_revision_id
  );
end;
$$;

alter function private.lukas_drawing_collaboration_service_store_state(
  uuid,uuid,smallint,bytea,bigint,bigint,text
) rename to lukas_drawing_collaboration_service_store_state_pre_entitlement;
create function private.lukas_drawing_collaboration_service_store_state(
  p_project_id uuid,p_revision_id uuid,p_schema_version smallint,
  p_yjs_state bytea,p_base_operation_sequence bigint,
  p_expected_generation bigint,p_expected_sha256 text
) returns table(
  revision_id uuid,project_id uuid,schema_version smallint,yjs_state bytea,
  yjs_sha256 text,base_operation_sequence bigint,store_generation bigint,
  byte_size integer,persisted_at timestamptz
) language plpgsql security definer set search_path='' as $$
begin
  if not private.lukas_qto_project_feature_active(
    p_project_id,'realtime_collaboration'
  ) then raise exception using errcode='P7A07',
    message='Realtime collaboration entitlement is unavailable'; end if;
  return query select *
  from private.lukas_drawing_collaboration_service_store_state_pre_entitlement(
    p_project_id,p_revision_id,p_schema_version,p_yjs_state,
    p_base_operation_sequence,p_expected_generation,p_expected_sha256
  );
end;
$$;

alter function private.lukas_drawing_collaboration_service_bootstrap(uuid,uuid)
  rename to lukas_drawing_collaboration_service_bootstrap_pre_entitlement;
create function private.lukas_drawing_collaboration_service_bootstrap(
  p_project_id uuid,p_revision_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.lukas_qto_project_feature_active(
    p_project_id,'realtime_collaboration'
  ) then raise exception using errcode='P7A07',
    message='Realtime collaboration entitlement is unavailable'; end if;
  return private.lukas_drawing_collaboration_service_bootstrap_pre_entitlement(
    p_project_id,p_revision_id
  );
end;
$$;

alter table public.lukas_qto_organization_invitations enable row level security;
alter table public.lukas_qto_organization_entitlement_versions enable row level security;
alter table public.lukas_qto_organization_admin_events enable row level security;
revoke all on table public.lukas_qto_organization_invitations from anon,authenticated,service_role;
revoke all on table public.lukas_qto_organization_entitlement_versions from anon,authenticated,service_role;
revoke all on table public.lukas_qto_organization_admin_events from anon,authenticated,service_role;
grant select on table public.lukas_qto_organization_invitations to authenticated,service_role;
grant select on table public.lukas_qto_organization_entitlement_versions to authenticated,service_role;
grant select on table public.lukas_qto_organization_admin_events to authenticated,service_role;
revoke update on table public.lukas_qto_organizations from authenticated;
revoke insert,update,delete on table public.lukas_qto_organization_members from authenticated;
revoke insert,update,delete on table public.lukas_qto_project_members from authenticated;

create policy "organization managers read invitations" on public.lukas_qto_organization_invitations
for select to authenticated using((select private.lukas_qto_organization_manager(organization_id)));
create policy "organization members read entitlement versions" on public.lukas_qto_organization_entitlement_versions
for select to authenticated using((select private.lukas_qto_organization_role(organization_id)) is not null);
create policy "organization managers read administration events" on public.lukas_qto_organization_admin_events
for select to authenticated using((select private.lukas_qto_organization_manager(organization_id)));

alter policy "organization members read drawing library entries"
on public.lukas_drawing_library_entries
using((select private.lukas_qto_organization_library_access(organization_id)));
alter policy "organization members read drawing library versions"
on public.lukas_drawing_library_versions
using((select private.lukas_qto_organization_library_access(organization_id)));
alter policy "organization members read drawing library imports"
on public.lukas_drawing_library_imports
using((select private.lukas_qto_organization_library_access(organization_id)));

alter function public.lukas_drawing_import_library_version(uuid,uuid,uuid,uuid,uuid)
  rename to lukas_drawing_import_library_version_pre_entitlement;
create function public.lukas_drawing_import_library_version(
  p_organization_id uuid,p_version_id uuid,p_project_id uuid,p_revision_id uuid,
  p_client_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.lukas_qto_organization_library_access(p_organization_id)
    or not private.lukas_qto_project_feature_active(p_project_id,'organization_library') then
    raise exception using errcode='P7A07',message='Organization library entitlement is unavailable';
  end if;
  return public.lukas_drawing_import_library_version_pre_entitlement(
    p_organization_id,p_version_id,p_project_id,p_revision_id,p_client_request_id
  );
end;
$$;

create policy "P7 quantity lineage entitlement lukas_qto_price_books" on public.lukas_qto_price_books
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_price_resources" on public.lukas_qto_price_resources
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_material_plans" on public.lukas_qto_material_plans
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_material_transactions" on public.lukas_qto_material_transactions
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_carbon_factors" on public.lukas_qto_carbon_factors
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_drawing_quantity_links" on public.lukas_drawing_quantity_links
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_drawing_boq_links" on public.lukas_drawing_boq_links
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_drawing_material_links" on public.lukas_drawing_material_links
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_boq_versions" on public.lukas_qto_boq_versions
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_boq_sections" on public.lukas_qto_boq_sections
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_boq_lines" on public.lukas_qto_boq_lines
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_boq_wbs_nodes" on public.lukas_qto_boq_wbs_nodes
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_boq_wbs_allocations" on public.lukas_qto_boq_wbs_allocations
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_boq_quantity_mappings" on public.lukas_qto_boq_quantity_mappings
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_boq_source_exclusions" on public.lukas_qto_boq_source_exclusions
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_boq_rate_components" on public.lukas_qto_boq_rate_components
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(project_id,'quantity_lineage'));
create policy "P7 quantity lineage entitlement lukas_qto_boq_approvals" on public.lukas_qto_boq_approvals
as restrictive for all to authenticated using(private.lukas_qto_project_feature_active(
  (select b.project_id from public.lukas_qto_boq_versions b where b.id=lukas_qto_boq_approvals.version_id),'quantity_lineage'))
with check(private.lukas_qto_project_feature_active(
  (select b.project_id from public.lukas_qto_boq_versions b where b.id=lukas_qto_boq_approvals.version_id),'quantity_lineage'));

alter function public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint)
  rename to lukas_drawing_put_boq_link_pre_entitlement;
create function public.lukas_drawing_put_boq_link(
  p_id uuid,p_quantity_link_id uuid,p_boq_version_id uuid,p_boq_line_id uuid,
  p_allocation_factor numeric,p_base_version bigint default null
) returns public.lukas_drawing_boq_links language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select b.project_id into v_project_id from public.lukas_qto_boq_versions b where b.id=p_boq_version_id;
  if not private.lukas_qto_project_feature_active(v_project_id,'quantity_lineage') then raise exception using errcode='P7A07',message='Quantity lineage entitlement is unavailable'; end if;
  return public.lukas_drawing_put_boq_link_pre_entitlement(p_id,p_quantity_link_id,p_boq_version_id,p_boq_line_id,p_allocation_factor,p_base_version);
end;
$$;

alter function public.lukas_drawing_delete_boq_link(uuid,bigint)
  rename to lukas_drawing_delete_boq_link_pre_entitlement;
create function public.lukas_drawing_delete_boq_link(p_id uuid,p_base_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select b.project_id into v_project_id from public.lukas_drawing_boq_links b where b.id=p_id;
  if not private.lukas_qto_project_feature_active(v_project_id,'quantity_lineage') then raise exception using errcode='P7A07',message='Quantity lineage entitlement is unavailable'; end if;
  return public.lukas_drawing_delete_boq_link_pre_entitlement(p_id,p_base_version);
end;
$$;

alter function public.lukas_qto_boq_v1_1_input(uuid)
  rename to lukas_qto_boq_v1_1_input_pre_entitlement;
create function public.lukas_qto_boq_v1_1_input(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select b.project_id into v_project_id from public.lukas_qto_boq_versions b where b.id=p_version_id;
  if not private.lukas_qto_project_feature_active(v_project_id,'quantity_lineage') then raise exception using errcode='P7A07',message='Quantity lineage entitlement is unavailable'; end if;
  return public.lukas_qto_boq_v1_1_input_pre_entitlement(p_version_id);
end;
$$;

alter function public.lukas_qto_decide_boq(uuid,text,text)
  rename to lukas_qto_decide_boq_pre_entitlement;
create function public.lukas_qto_decide_boq(p_version_id uuid,p_decision text,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select b.project_id into v_project_id from public.lukas_qto_boq_versions b where b.id=p_version_id;
  if not private.lukas_qto_project_feature_active(v_project_id,'quantity_lineage') then raise exception using errcode='P7A07',message='Quantity lineage entitlement is unavailable'; end if;
  perform public.lukas_qto_decide_boq_pre_entitlement(p_version_id,p_decision,p_note);
end;
$$;

alter function public.lukas_qto_import_boq_structure(uuid,jsonb)
  rename to lukas_qto_import_boq_structure_pre_entitlement;
create function public.lukas_qto_import_boq_structure(p_version_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select b.project_id into v_project_id from public.lukas_qto_boq_versions b where b.id=p_version_id;
  if not private.lukas_qto_project_feature_active(v_project_id,'quantity_lineage') then raise exception using errcode='P7A07',message='Quantity lineage entitlement is unavailable'; end if;
  perform public.lukas_qto_import_boq_structure_pre_entitlement(p_version_id,p_payload);
end;
$$;

alter function private.lukas_drawing_insert_quantity_link(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text)
  rename to lukas_drawing_insert_quantity_link_pre_entitlement;
create function private.lukas_drawing_insert_quantity_link(
  p_actor_id uuid,p_id uuid,p_revision_id uuid,p_object_id uuid,p_measurement_kind text,
  p_snapshot_sha256 text,p_object_lineage_id uuid,p_object_version bigint,
  p_object_fingerprint text,p_raw_quantity numeric,p_unit text,p_measurement_rule_version text
) returns public.lukas_drawing_quantity_links language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select r.project_id into v_project_id from public.lukas_drawing_revisions r where r.id=p_revision_id;
  if not private.lukas_qto_project_feature_active(v_project_id,'quantity_lineage') then raise exception using errcode='P7A07',message='Quantity lineage entitlement is unavailable'; end if;
  return private.lukas_drawing_insert_quantity_link_pre_entitlement(
    p_actor_id,p_id,p_revision_id,p_object_id,p_measurement_kind,p_snapshot_sha256,
    p_object_lineage_id,p_object_version,p_object_fingerprint,p_raw_quantity,p_unit,p_measurement_rule_version
  );
end;
$$;

alter function private.lukas_qto_finalize_boq_v1_1(uuid,uuid,text,text,text,numeric,integer)
  rename to lukas_qto_finalize_boq_v1_1_pre_entitlement;
create function private.lukas_qto_finalize_boq_v1_1(
  p_actor_id uuid,p_version_id uuid,p_input_state_sha256 text,p_result_sha256 text,
  p_manifest_sha256 text,p_direct_cost_krw numeric,p_line_count integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select b.project_id into v_project_id from public.lukas_qto_boq_versions b where b.id=p_version_id;
  if not private.lukas_qto_project_feature_active(v_project_id,'quantity_lineage') then raise exception using errcode='P7A07',message='Quantity lineage entitlement is unavailable'; end if;
  return private.lukas_qto_finalize_boq_v1_1_pre_entitlement(
    p_actor_id,p_version_id,p_input_state_sha256,p_result_sha256,p_manifest_sha256,p_direct_cost_krw,p_line_count
  );
end;
$$;

alter function private.lukas_drawing_insert_material_handoff(uuid,uuid,text,uuid,text,jsonb,jsonb)
  rename to lukas_drawing_insert_material_handoff_pre_entitlement;
create function private.lukas_drawing_insert_material_handoff(
  p_actor_id uuid,p_boq_version_id uuid,p_result_sha256 text,p_manifest_file_id uuid,
  p_manifest_file_sha256 text,p_material_plan_rows jsonb,p_material_link_rows jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project_id uuid;
begin
  select b.project_id into v_project_id from public.lukas_qto_boq_versions b where b.id=p_boq_version_id;
  if not private.lukas_qto_project_feature_active(v_project_id,'quantity_lineage') then raise exception using errcode='P7A07',message='Quantity lineage entitlement is unavailable'; end if;
  return private.lukas_drawing_insert_material_handoff_pre_entitlement(
    p_actor_id,p_boq_version_id,p_result_sha256,p_manifest_file_id,p_manifest_file_sha256,
    p_material_plan_rows,p_material_link_rows
  );
end;
$$;

revoke all on function
  private.lukas_qto_organization_admin_append_guard(),
  private.lukas_qto_organization_membership_guard(),
  private.lukas_qto_project_organization_guard(),
  private.lukas_qto_organization_manager(uuid),
  private.lukas_qto_project_membership_manager(uuid),
  private.lukas_qto_current_entitlement(uuid),
  private.lukas_qto_organization_feature_active(uuid,text),
  private.lukas_qto_project_feature_active(uuid,text),
  private.lukas_qto_organization_library_access(uuid),
  private.lukas_qto_admin_request_sha(jsonb),
  private.lukas_qto_admin_retry_matches(uuid,uuid,text),
  private.lukas_qto_default_organization_entitlement(),
  private.lukas_qto_projects_entitlement_guard(),
  private.lukas_drawing_library_versions_entitlement_guard()
from public,anon,authenticated,service_role;
revoke all on function
  private.lukas_drawing_workspace_capability_pre_entitlement(uuid),
  private.lukas_drawing_workspace_capability(uuid),
  private.lukas_drawing_collaboration_authorize_pre_entitlement(uuid,uuid,uuid),
  private.lukas_drawing_collaboration_authorize(uuid,uuid,uuid),
  private.lukas_drawing_collaboration_service_load_state_pre_entitlement(uuid,uuid),
  private.lukas_drawing_collaboration_service_load_state(uuid,uuid),
  private.lukas_drawing_collaboration_service_store_state_pre_entitlement(uuid,uuid,smallint,bytea,bigint,bigint,text),
  private.lukas_drawing_collaboration_service_store_state(uuid,uuid,smallint,bytea,bigint,bigint,text),
  private.lukas_drawing_collaboration_service_bootstrap_pre_entitlement(uuid,uuid),
  private.lukas_drawing_collaboration_service_bootstrap(uuid,uuid)
from public,anon,authenticated,service_role,lukas_drawing_collaboration;
revoke all on function
  public.lukas_drawing_import_library_version_pre_entitlement(uuid,uuid,uuid,uuid,uuid),
  public.lukas_drawing_put_boq_link_pre_entitlement(uuid,uuid,uuid,uuid,numeric,bigint),
  public.lukas_drawing_delete_boq_link_pre_entitlement(uuid,bigint),
  public.lukas_qto_boq_v1_1_input_pre_entitlement(uuid),
  public.lukas_qto_decide_boq_pre_entitlement(uuid,text,text),
  public.lukas_qto_import_boq_structure_pre_entitlement(uuid,jsonb),
  private.lukas_drawing_insert_quantity_link_pre_entitlement(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text),
  private.lukas_qto_finalize_boq_v1_1_pre_entitlement(uuid,uuid,text,text,text,numeric,integer),
  private.lukas_drawing_insert_material_handoff_pre_entitlement(uuid,uuid,text,uuid,text,jsonb,jsonb)
from public,anon,authenticated,service_role;
revoke all on function
  public.lukas_drawing_import_library_version(uuid,uuid,uuid,uuid,uuid),
  public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint),
  public.lukas_drawing_delete_boq_link(uuid,bigint),
  public.lukas_qto_boq_v1_1_input(uuid),
  public.lukas_qto_decide_boq(uuid,text,text),
  public.lukas_qto_import_boq_structure(uuid,jsonb),
  private.lukas_drawing_insert_quantity_link(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text),
  private.lukas_qto_finalize_boq_v1_1(uuid,uuid,text,text,text,numeric,integer),
  private.lukas_drawing_insert_material_handoff(uuid,uuid,text,uuid,text,jsonb,jsonb)
from public,anon,authenticated,service_role;
revoke all on function public.lukas_qto_organization_feature_enabled(uuid,text),
  public.lukas_qto_update_organization_settings(uuid,text,uuid),
  public.lukas_qto_invite_organization_member(uuid,text,text,boolean,integer,uuid),
  public.lukas_qto_revoke_organization_invitation(uuid,uuid,text,uuid),
  public.lukas_qto_accept_organization_invitation(uuid,uuid),
  public.lukas_qto_change_organization_member(uuid,uuid,text,boolean,uuid),
  public.lukas_qto_remove_organization_member(uuid,uuid,text,uuid),
  public.lukas_qto_set_organization_entitlement(uuid,text,integer,integer,integer,timestamptz,jsonb,text,uuid),
  public.lukas_qto_list_organization_members(uuid,uuid,integer),
  public.lukas_qto_list_organization_invitations(uuid,uuid,integer),
  public.lukas_qto_list_organization_projects(uuid,uuid,integer),
  public.lukas_qto_list_managed_organizations(uuid,uuid,integer),
  public.lukas_qto_list_project_members(uuid,uuid,integer),
  public.lukas_qto_set_project_member(uuid,uuid,text,text,uuid),
  public.lukas_qto_remove_project_member(uuid,uuid,uuid,text,uuid),
  public.lukas_qto_move_project(uuid,uuid,uuid,text,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.lukas_qto_organization_feature_enabled(uuid,text),
  public.lukas_qto_update_organization_settings(uuid,text,uuid),
  public.lukas_qto_invite_organization_member(uuid,text,text,boolean,integer,uuid),
  public.lukas_qto_revoke_organization_invitation(uuid,uuid,text,uuid),
  public.lukas_qto_accept_organization_invitation(uuid,uuid),
  public.lukas_qto_change_organization_member(uuid,uuid,text,boolean,uuid),
  public.lukas_qto_remove_organization_member(uuid,uuid,text,uuid),
  public.lukas_qto_list_organization_members(uuid,uuid,integer),
  public.lukas_qto_list_organization_invitations(uuid,uuid,integer),
  public.lukas_qto_list_organization_projects(uuid,uuid,integer),
  public.lukas_qto_list_managed_organizations(uuid,uuid,integer),
  public.lukas_qto_list_project_members(uuid,uuid,integer),
  public.lukas_qto_set_project_member(uuid,uuid,text,text,uuid),
  public.lukas_qto_remove_project_member(uuid,uuid,uuid,text,uuid),
  public.lukas_qto_move_project(uuid,uuid,uuid,text,uuid)
to authenticated,service_role;
grant execute on function
  private.lukas_drawing_insert_quantity_link(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text),
  private.lukas_qto_finalize_boq_v1_1(uuid,uuid,text,text,text,numeric,integer),
  private.lukas_drawing_insert_material_handoff(uuid,uuid,text,uuid,text,jsonb,jsonb)
to service_role;
grant execute on function public.lukas_qto_set_organization_entitlement(uuid,text,integer,integer,integer,timestamptz,jsonb,text,uuid)
to authenticated,service_role;
grant execute on function
  public.lukas_drawing_import_library_version(uuid,uuid,uuid,uuid,uuid),
  public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint),
  public.lukas_drawing_delete_boq_link(uuid,bigint),
  public.lukas_qto_boq_v1_1_input(uuid),
  public.lukas_qto_decide_boq(uuid,text,text),
  public.lukas_qto_import_boq_structure(uuid,jsonb)
to authenticated,service_role;
grant execute on function
  private.lukas_drawing_workspace_capability(uuid)
to authenticated,service_role;
grant execute on function
  private.lukas_drawing_collaboration_authorize(uuid,uuid,uuid),
  private.lukas_drawing_collaboration_service_load_state(uuid,uuid),
  private.lukas_drawing_collaboration_service_store_state(uuid,uuid,smallint,bytea,bigint,bigint,text),
  private.lukas_drawing_collaboration_service_bootstrap(uuid,uuid)
to lukas_drawing_collaboration;

commit;
