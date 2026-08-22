-- Verified deterministic concrete takeoff bundles and append-only human approvals.
-- The web platform stores evidence; it does not calculate or alter quantities.
create table if not exists public.lukas_qto_takeoff_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  artifact_kind text not null check (artifact_kind = 'concrete_takeoff'),
  format_version text not null check (format_version = 'CONCRETE_TAKEOFF_CSV_V1'),
  report_file_id uuid not null,
  manifest_file_id uuid not null,
  report_sha256 text not null check (report_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count > 0),
  input_sha256 jsonb not null check (
    jsonb_typeof(input_sha256) = 'object'
    and input_sha256 ?& array['export_manifest','ifc','qto','element_ledger','revit_mapping','concrete_rules','registry']
    and input_sha256 - array['export_manifest','ifc','qto','element_ledger','revit_mapping','concrete_rules','registry'] = '{}'::jsonb
  ),
  status_counts jsonb not null check (jsonb_typeof(status_counts) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (report_file_id),
  unique (manifest_file_id),
  constraint lukas_qto_takeoff_report_identity_fkey
    foreign key (report_file_id, project_id, report_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  constraint lukas_qto_takeoff_manifest_identity_fkey
    foreign key (manifest_file_id, project_id, manifest_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  check (report_file_id <> manifest_file_id)
);

create table if not exists public.lukas_qto_takeoff_inputs (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  project_id uuid not null,
  input_role text not null check (input_role in ('export_manifest','ifc','qto','element_ledger','revit_mapping','concrete_rules','registry')),
  file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  unique (artifact_id, input_role),
  constraint lukas_qto_takeoff_inputs_artifact_fkey
    foreign key (artifact_id, project_id)
    references public.lukas_qto_takeoff_artifacts(id, project_id) on delete cascade,
  constraint lukas_qto_takeoff_inputs_file_identity_fkey
    foreign key (file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table if not exists public.lukas_qto_takeoff_approvals (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.lukas_qto_takeoff_artifacts(id) on delete cascade,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected','deferred')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists lukas_qto_takeoff_artifacts_project_created_idx
  on public.lukas_qto_takeoff_artifacts(project_id, created_at desc);
create index if not exists lukas_qto_takeoff_approvals_artifact_created_idx
  on public.lukas_qto_takeoff_approvals(artifact_id, created_at desc);
create index if not exists lukas_qto_takeoff_inputs_file_idx
  on public.lukas_qto_takeoff_inputs(file_id);

alter table public.lukas_qto_takeoff_artifacts enable row level security;
alter table public.lukas_qto_takeoff_approvals enable row level security;
alter table public.lukas_qto_takeoff_inputs enable row level security;

create policy "project members read takeoff artifacts" on public.lukas_qto_takeoff_artifacts for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p where p.id = project_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));
create policy "project members read takeoff approvals" on public.lukas_qto_takeoff_approvals for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_takeoff_artifacts a
    join public.lukas_qto_projects p on p.id = a.project_id
    where a.id = artifact_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));
create policy "project members add takeoff approvals" on public.lukas_qto_takeoff_approvals for insert to authenticated
  with check (decided_by = (select auth.uid()) and exists (
    select 1 from public.lukas_qto_takeoff_artifacts a
    join public.lukas_qto_projects p on p.id = a.project_id
    where a.id = artifact_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));
create policy "project members read takeoff input evidence" on public.lukas_qto_takeoff_inputs for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p where p.id = project_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));

-- Artifact metadata can only be inserted by a validated server action.
grant select on public.lukas_qto_takeoff_artifacts to authenticated;
revoke insert, update, delete on public.lukas_qto_takeoff_artifacts from authenticated;
grant select, insert on public.lukas_qto_takeoff_approvals to authenticated;
revoke update, delete on public.lukas_qto_takeoff_approvals from authenticated;
grant select on public.lukas_qto_takeoff_inputs to authenticated;
revoke insert, update, delete on public.lukas_qto_takeoff_inputs from authenticated;
grant all on public.lukas_qto_takeoff_artifacts to service_role;
grant all on public.lukas_qto_takeoff_approvals to service_role;
grant all on public.lukas_qto_takeoff_inputs to service_role;
