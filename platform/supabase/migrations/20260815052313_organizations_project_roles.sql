create table public.lukas_qto_organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 160),
  owner_id uuid not null references auth.users(id) on delete restrict,
  is_personal boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index lukas_qto_organizations_personal_owner_key
  on public.lukas_qto_organizations(owner_id) where is_personal;

create table public.lukas_qto_organization_members (
  organization_id uuid not null references public.lukas_qto_organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create table public.lukas_qto_project_members (
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','estimator','reviewer','site','procurement','viewer')),
  created_at timestamptz not null default now(),
  primary key (project_id,user_id)
);

alter table public.lukas_qto_projects add column organization_id uuid;

insert into public.lukas_qto_organizations(name,owner_id,is_personal)
select '개인 작업공간', owner_id, true from public.lukas_qto_projects
group by owner_id on conflict(owner_id) where is_personal do nothing;

update public.lukas_qto_projects p set organization_id=o.id
from public.lukas_qto_organizations o where o.owner_id=p.owner_id and o.is_personal;

alter table public.lukas_qto_projects
  alter column organization_id set not null,
  add constraint lukas_qto_projects_organization_id_fkey
    foreign key(organization_id) references public.lukas_qto_organizations(id) on delete restrict;

insert into public.lukas_qto_organization_members(organization_id,user_id,role)
select id,owner_id,'owner' from public.lukas_qto_organizations
on conflict(organization_id,user_id) do nothing;
insert into public.lukas_qto_project_members(project_id,user_id,role)
select id,owner_id,'owner' from public.lukas_qto_projects
on conflict(project_id,user_id) do nothing;

create or replace function public.lukas_qto_project_role(p_project_id uuid)
returns text language sql stable security definer set search_path=public
as $$
  select case
    when (select ((auth.jwt())->'app_metadata'->>'role'))='hangil_staff' then 'staff'
    when p.owner_id=(select auth.uid()) then 'owner'
    else (select m.role from public.lukas_qto_project_members m
          where m.project_id=p.id and m.user_id=(select auth.uid()))
  end
  from public.lukas_qto_projects p where p.id=p_project_id;
$$;
revoke all on function public.lukas_qto_project_role(uuid) from public;
grant execute on function public.lukas_qto_project_role(uuid) to authenticated,service_role;

create or replace function public.lukas_qto_organization_role(p_organization_id uuid)
returns text language sql stable security definer set search_path=public
as $$
  select case
    when (select ((auth.jwt())->'app_metadata'->>'role'))='hangil_staff' then 'staff'
    when o.owner_id=(select auth.uid()) then 'owner'
    else (select m.role from public.lukas_qto_organization_members m
          where m.organization_id=o.id and m.user_id=(select auth.uid()))
  end
  from public.lukas_qto_organizations o where o.id=p_organization_id;
$$;
revoke all on function public.lukas_qto_organization_role(uuid) from public;
grant execute on function public.lukas_qto_organization_role(uuid) to authenticated,service_role;

create or replace function public.lukas_qto_prepare_project()
returns trigger language plpgsql security definer set search_path=public
as $$
declare personal_org uuid;
begin
  if new.owner_id is distinct from (select auth.uid())
     and (select ((auth.jwt())->'app_metadata'->>'role')) is distinct from 'hangil_staff' then
    raise exception 'Project owner must be the current user';
  end if;
  if new.organization_id is null then
    select id into personal_org from public.lukas_qto_organizations where owner_id=new.owner_id and is_personal;
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
create trigger lukas_qto_projects_prepare before insert on public.lukas_qto_projects
for each row execute function public.lukas_qto_prepare_project();

create or replace function public.lukas_qto_add_owner_membership()
returns trigger language plpgsql security definer set search_path=public
as $$ begin
  insert into public.lukas_qto_project_members(project_id,user_id,role)
  values(new.id,new.owner_id,'owner') on conflict(project_id,user_id) do nothing;
  return new;
end $$;
create trigger lukas_qto_projects_add_owner after insert on public.lukas_qto_projects
for each row execute function public.lukas_qto_add_owner_membership();

alter table public.lukas_qto_organizations enable row level security;
alter table public.lukas_qto_organization_members enable row level security;
alter table public.lukas_qto_project_members enable row level security;
revoke all on public.lukas_qto_organizations,public.lukas_qto_organization_members,public.lukas_qto_project_members from anon;
grant select,insert,update,delete on public.lukas_qto_organizations,public.lukas_qto_organization_members,public.lukas_qto_project_members to authenticated;
grant all on public.lukas_qto_organizations,public.lukas_qto_organization_members,public.lukas_qto_project_members to service_role;

create policy "organization members read organizations" on public.lukas_qto_organizations
for select to authenticated using(public.lukas_qto_organization_role(id) is not null);
create policy "users create organizations" on public.lukas_qto_organizations
for insert to authenticated with check(owner_id=(select auth.uid()) and is_personal=false);
create policy "owners update organizations" on public.lukas_qto_organizations
for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy "organization members read membership" on public.lukas_qto_organization_members
for select to authenticated using(public.lukas_qto_organization_role(organization_id) is not null);
create policy "organization owners manage membership" on public.lukas_qto_organization_members
for all to authenticated using(public.lukas_qto_organization_role(organization_id) in('owner','staff'))
with check(public.lukas_qto_organization_role(organization_id) in('owner','staff'));
create policy "project members read membership" on public.lukas_qto_project_members
for select to authenticated using(public.lukas_qto_project_role(project_id) is not null);
create policy "project owners manage membership" on public.lukas_qto_project_members
for all to authenticated using(public.lukas_qto_project_role(project_id) in('owner','staff'))
with check(public.lukas_qto_project_role(project_id) in('owner','staff'));

drop policy if exists "project owners or staff read projects" on public.lukas_qto_projects;
drop policy if exists "project owners or staff update projects" on public.lukas_qto_projects;
create policy "project roles read projects" on public.lukas_qto_projects for select to authenticated
using(public.lukas_qto_project_role(id) is not null);
create policy "project owner or estimator updates project" on public.lukas_qto_projects for update to authenticated
using(public.lukas_qto_project_role(id) in('owner','staff','estimator'))
with check(public.lukas_qto_project_role(id) in('owner','staff','estimator'));

drop policy if exists "project owners or staff read files" on public.lukas_qto_files;
drop policy if exists "project owners or staff add immutable files" on public.lukas_qto_files;
drop policy if exists "project owners or staff delete files" on public.lukas_qto_files;
create policy "project roles read files" on public.lukas_qto_files for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
create policy "project contributors add immutable files" on public.lukas_qto_files for insert to authenticated
with check(uploaded_by=(select auth.uid()) and immutable=true and public.lukas_qto_project_role(project_id) in('owner','staff','estimator','reviewer','site','procurement'));
create policy "project owners delete files" on public.lukas_qto_files for delete to authenticated
using(public.lukas_qto_project_role(project_id) in('owner','staff'));

drop policy if exists "project members read material plans" on public.lukas_qto_material_plans;
drop policy if exists "project members add material plans" on public.lukas_qto_material_plans;
create policy "project roles read material plans" on public.lukas_qto_material_plans for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
create policy "estimators add material plans" on public.lukas_qto_material_plans for insert to authenticated
with check(created_by=(select auth.uid()) and public.lukas_qto_project_role(project_id) in('owner','staff','estimator'));

drop policy if exists "project members read carbon factors" on public.lukas_qto_carbon_factors;
drop policy if exists "project members add carbon factors" on public.lukas_qto_carbon_factors;
create policy "project roles read carbon factors" on public.lukas_qto_carbon_factors for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
create policy "procurement adds carbon factors" on public.lukas_qto_carbon_factors for insert to authenticated
with check(created_by=(select auth.uid()) and public.lukas_qto_project_role(project_id) in('owner','staff','estimator','procurement'));

drop policy if exists "project members read material transactions" on public.lukas_qto_material_transactions;
drop policy if exists "project members add material transactions" on public.lukas_qto_material_transactions;
create policy "project roles read material transactions" on public.lukas_qto_material_transactions for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
create policy "role separated material events" on public.lukas_qto_material_transactions for insert to authenticated
with check(created_by=(select auth.uid()) and (
  (transaction_type in('purchase_order','invoice_evidence') and public.lukas_qto_project_role(project_id) in('owner','staff','procurement'))
  or (transaction_type in('goods_receipt','installation','return_to_supplier','waste_disposal') and public.lukas_qto_project_role(project_id) in('owner','staff','site'))
));

drop policy if exists "project members read takeoff approvals" on public.lukas_qto_takeoff_approvals;
drop policy if exists "project members add takeoff approvals" on public.lukas_qto_takeoff_approvals;
create policy "project roles read takeoff approvals" on public.lukas_qto_takeoff_approvals for select to authenticated
using(exists(select 1 from public.lukas_qto_takeoff_artifacts a where a.id=artifact_id and public.lukas_qto_project_role(a.project_id) is not null));
create policy "reviewers add takeoff approvals" on public.lukas_qto_takeoff_approvals for insert to authenticated
with check(decided_by=(select auth.uid()) and exists(select 1 from public.lukas_qto_takeoff_artifacts a where a.id=artifact_id and public.lukas_qto_project_role(a.project_id) in('owner','staff','reviewer')));

drop policy if exists "project members read takeoff artifacts" on public.lukas_qto_takeoff_artifacts;
create policy "project roles read takeoff artifacts" on public.lukas_qto_takeoff_artifacts for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
drop policy if exists "project members read takeoff input evidence" on public.lukas_qto_takeoff_inputs;
create policy "project roles read takeoff input evidence" on public.lukas_qto_takeoff_inputs for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
drop policy if exists "project members read preflight artifacts" on public.lukas_qto_preflight_artifacts;
create policy "project roles read preflight artifacts" on public.lukas_qto_preflight_artifacts for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
drop policy if exists "project members read preflight input evidence" on public.lukas_qto_preflight_inputs;
create policy "project roles read preflight input evidence" on public.lukas_qto_preflight_inputs for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
drop policy if exists "project members read file revision graph" on public.lukas_qto_file_revisions;
create policy "project roles read file revision graph" on public.lukas_qto_file_revisions for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
drop policy if exists "project members read machine suggestions" on public.lukas_qto_suggestions;
create policy "project roles read machine suggestions" on public.lukas_qto_suggestions for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
drop policy if exists "project owners or staff manage reviews" on public.lukas_qto_reviews;
create policy "project roles read reviews" on public.lukas_qto_reviews for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
create policy "reviewers add reviews" on public.lukas_qto_reviews for insert to authenticated
with check((author_id=(select auth.uid()) or author_id is null) and public.lukas_qto_project_role(project_id) in('owner','staff','reviewer'));

drop policy if exists "project members read preflight approvals" on public.lukas_qto_preflight_approvals;
drop policy if exists "project members add preflight approvals" on public.lukas_qto_preflight_approvals;
create policy "project roles read preflight approvals" on public.lukas_qto_preflight_approvals for select to authenticated
using(exists(select 1 from public.lukas_qto_preflight_artifacts a where a.id=artifact_id and public.lukas_qto_project_role(a.project_id) is not null));
create policy "reviewers add preflight approvals" on public.lukas_qto_preflight_approvals for insert to authenticated
with check(decided_by=(select auth.uid()) and exists(select 1 from public.lukas_qto_preflight_artifacts a where a.id=artifact_id and public.lukas_qto_project_role(a.project_id) in('owner','staff','reviewer')));

drop policy if exists "project members read suggestion decisions" on public.lukas_qto_suggestion_decisions;
drop policy if exists "project members add suggestion decisions" on public.lukas_qto_suggestion_decisions;
create policy "project roles read suggestion decisions" on public.lukas_qto_suggestion_decisions for select to authenticated
using(exists(select 1 from public.lukas_qto_suggestions s where s.id=suggestion_id and public.lukas_qto_project_role(s.project_id) is not null));
create policy "reviewers add suggestion decisions" on public.lukas_qto_suggestion_decisions for insert to authenticated
with check(decided_by=(select auth.uid()) and exists(select 1 from public.lukas_qto_suggestions s where s.id=suggestion_id and public.lukas_qto_project_role(s.project_id) in('owner','staff','reviewer','estimator')));

create or replace function public.lukas_qto_storage_project_role(p_name text)
returns text language plpgsql stable security definer set search_path=public,storage
as $$ begin
  return public.lukas_qto_project_role(((storage.foldername(p_name))[2])::uuid);
exception when others then return null;
end $$;
revoke all on function public.lukas_qto_storage_project_role(text) from public;
grant execute on function public.lukas_qto_storage_project_role(text) to authenticated,service_role;
create policy "project roles read qto storage" on storage.objects for select to authenticated
using(bucket_id='lukas-qto' and public.lukas_qto_storage_project_role(name) is not null);
create policy "project contributors upload qto storage" on storage.objects for insert to authenticated
with check(bucket_id='lukas-qto' and public.lukas_qto_storage_project_role(name) in('owner','staff','estimator','reviewer','site','procurement'));

create index lukas_qto_organization_members_user_idx on public.lukas_qto_organization_members(user_id,organization_id);
create index lukas_qto_project_members_user_idx on public.lukas_qto_project_members(user_id,project_id);
create index lukas_qto_projects_organization_idx on public.lukas_qto_projects(organization_id,id);
grant usage,select on all sequences in schema public to authenticated,service_role;
