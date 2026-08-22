create or replace function public.lukas_qto_prepare_project()
returns trigger language plpgsql security definer set search_path=public
as $$
declare
  personal_org uuid;
  actor uuid := (select auth.uid());
begin
  -- RLS already blocks anonymous writes. When a JWT user exists, prevent that
  -- user from forging another owner. A null actor is reserved for trusted
  -- service/migration execution and is required by server-side administration.
  if actor is not null
     and new.owner_id is distinct from actor
     and (select ((auth.jwt())->'app_metadata'->>'role')) is distinct from 'hangil_staff' then
    raise exception 'Project owner must be the current user';
  end if;
  if new.organization_id is null then
    select id into personal_org from public.lukas_qto_organizations
      where owner_id=new.owner_id and is_personal;
    if personal_org is null then
      insert into public.lukas_qto_organizations(name,owner_id,is_personal)
      values('개인 작업공간',new.owner_id,true) returning id into personal_org;
      insert into public.lukas_qto_organization_members(organization_id,user_id,role)
      values(personal_org,new.owner_id,'owner');
    end if;
    new.organization_id=personal_org;
  elsif not exists(
    select 1 from public.lukas_qto_organization_members
    where organization_id=new.organization_id and user_id=new.owner_id and role in('owner','admin')
  ) then
    raise exception 'Project owner must administer the organization';
  end if;
  return new;
end;
$$;
