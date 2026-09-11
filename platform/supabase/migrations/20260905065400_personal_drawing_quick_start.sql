begin;

create table private.lukas_drawing_personal_projects (
  user_id uuid primary key references auth.users(id) on delete cascade,
  project_id uuid not null unique
    references public.lukas_qto_projects(id) on delete cascade,
  organization_id uuid not null
    references public.lukas_qto_organizations(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now()
);

alter table private.lukas_drawing_personal_projects enable row level security;
revoke all on table private.lukas_drawing_personal_projects
  from public,anon,authenticated,service_role;

-- A first normal project and a first quick-start project can race before either
-- transaction has committed the user's personal organization. The partial
-- unique index is the authority; re-select after the conflict-safe insert.
create or replace function private.lukas_qto_prepare_project()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  personal_org uuid;
  actor uuid:=(select auth.uid());
begin
  if actor is not null
    and new.owner_id is distinct from actor
    and (select auth.jwt()->'app_metadata'->>'role')
      is distinct from 'hangil_staff' then
    raise exception 'Project owner must be the current user';
  end if;
  if new.organization_id is null then
    insert into public.lukas_qto_organizations(name,owner_id,is_personal)
    values('개인 작업공간',new.owner_id,true)
    on conflict(owner_id) where is_personal do nothing;
    select organization.id into personal_org
    from public.lukas_qto_organizations organization
    where organization.owner_id=new.owner_id and organization.is_personal;
    if personal_org is null then
      raise exception 'Personal organization is unavailable';
    end if;
    insert into public.lukas_qto_organization_members(
      organization_id,user_id,role
    ) values(personal_org,new.owner_id,'owner')
    on conflict(organization_id,user_id) do nothing;
    new.organization_id=personal_org;
  elsif not exists(
    select 1 from public.lukas_qto_organization_members membership
    where membership.organization_id=new.organization_id
      and membership.user_id=new.owner_id
      and membership.role in('owner','admin')
  ) then
    raise exception 'Project owner must administer the organization';
  end if;
  return new;
end;
$$;

create function private.lukas_drawing_ensure_personal_project()
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid());
  mapping private.lukas_drawing_personal_projects%rowtype;
  project public.lukas_qto_projects%rowtype;
  organization public.lukas_qto_organizations%rowtype;
begin
  if actor is null
    or coalesce((select (auth.jwt()->>'is_anonymous')::boolean),false)
    or not exists(
      select 1 from auth.users user_account
      where user_account.id=actor
        and coalesce(user_account.is_anonymous,false)=false
    ) then
    raise exception using errcode='P1R01',
      message='Personal drawing project is unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'personal-drawing-project:'||actor::text,0
  ));

  select stored.* into mapping
  from private.lukas_drawing_personal_projects stored
  where stored.user_id=actor
  for update;
  if found then
    select stored_project.* into project
    from public.lukas_qto_projects stored_project
    where stored_project.id=mapping.project_id
    for share;
    select stored_organization.* into organization
    from public.lukas_qto_organizations stored_organization
    where stored_organization.id=mapping.organization_id
    for share;
    if project.id is null
      or organization.id is null
      or project.owner_id is distinct from actor
      or project.organization_id is distinct from mapping.organization_id
      or organization.owner_id is distinct from actor
      or organization.is_personal is distinct from true
      or project.archived_at is not null
      or project.deletion_requested_at is not null
      or private.lukas_drawing_workspace_capability(project.id)
        is distinct from 'admin' then
      raise exception using errcode='P1R01',
        message='Personal drawing project requires recovery';
    end if;
    return pg_catalog.jsonb_build_object(
      'projectId',project.id,'organizationId',organization.id
    );
  end if;

  insert into public.lukas_qto_projects(owner_id,name)
  values(actor,'내 도면')
  returning * into project;
  select stored_organization.* into organization
  from public.lukas_qto_organizations stored_organization
  where stored_organization.id=project.organization_id
    and stored_organization.owner_id=actor
    and stored_organization.is_personal
  for share;
  if organization.id is null
    or private.lukas_drawing_workspace_capability(project.id)
      is distinct from 'admin' then
    raise exception using errcode='P1R01',
      message='Personal drawing project is unavailable';
  end if;
  insert into private.lukas_drawing_personal_projects(
    user_id,project_id,organization_id
  ) values(actor,project.id,organization.id);
  return pg_catalog.jsonb_build_object(
    'projectId',project.id,'organizationId',organization.id
  );
end;
$$;

create function public.lukas_drawing_ensure_personal_project()
returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_ensure_personal_project()
$$;

revoke all on function private.lukas_drawing_ensure_personal_project()
  from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_ensure_personal_project()
  to authenticated;
revoke all on function public.lukas_drawing_ensure_personal_project()
  from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_ensure_personal_project()
  to authenticated;

commit;
