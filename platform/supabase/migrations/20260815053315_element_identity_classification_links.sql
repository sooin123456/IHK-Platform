create table public.lukas_qto_element_identity_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  element_ledger_file_id uuid not null,
  element_ledger_sha256 text not null check(element_ledger_sha256 ~ '^[0-9a-f]{64}$'),
  revit_element_id bigint not null check(revit_element_id > 0),
  ifc_file_id uuid not null,
  ifc_sha256 text not null check(ifc_sha256 ~ '^[0-9a-f]{64}$'),
  ifc_global_id text not null check(ifc_global_id ~ '^[0-9A-Za-z_$]{22}$'),
  classification_namespace text not null check(char_length(trim(classification_namespace)) between 1 and 200),
  classification_code text not null check(char_length(trim(classification_code)) between 1 and 200),
  classification_version text not null check(char_length(trim(classification_version)) between 1 and 120),
  classification_label text not null default '' check(char_length(classification_label) <= 240),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key(element_ledger_file_id,project_id,element_ledger_sha256)
    references public.lukas_qto_files(id,project_id,sha256) on delete restrict,
  foreign key(ifc_file_id,project_id,ifc_sha256)
    references public.lukas_qto_files(id,project_id,sha256) on delete restrict,
  unique(project_id,revit_element_id,ifc_file_id,ifc_global_id,classification_namespace,classification_code,classification_version)
);

alter table public.lukas_qto_element_identity_links enable row level security;
revoke all on public.lukas_qto_element_identity_links from anon;
grant select,insert on public.lukas_qto_element_identity_links to authenticated;
grant all on public.lukas_qto_element_identity_links to service_role;
create policy "project roles read element identity links"
on public.lukas_qto_element_identity_links for select to authenticated
using(public.lukas_qto_project_role(project_id) is not null);
create policy "estimators confirm element identity links"
on public.lukas_qto_element_identity_links for insert to authenticated
with check(confirmed_by=(select auth.uid()) and public.lukas_qto_project_role(project_id) in('owner','staff','estimator','reviewer'));

create index lukas_qto_element_identity_links_ledger_idx
  on public.lukas_qto_element_identity_links(element_ledger_file_id,project_id);
create index lukas_qto_element_identity_links_ifc_idx
  on public.lukas_qto_element_identity_links(ifc_file_id,project_id);
create index lukas_qto_element_identity_links_confirmed_by_idx
  on public.lukas_qto_element_identity_links(confirmed_by);
