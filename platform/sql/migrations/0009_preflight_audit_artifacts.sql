-- Deterministic L1 QTO/estimate/mapping audit reports and append-only approval history.
create table if not exists public.lukas_qto_preflight_artifacts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  format_version text not null check (format_version = 'LUKAS_PREFLIGHT_REPORT_V1'),
  ruleset_version text not null check (char_length(trim(ruleset_version)) between 1 and 40),
  scope_id text not null check (char_length(trim(scope_id)) between 1 and 160),
  report_file_id uuid not null,
  manifest_file_id uuid not null,
  report_sha256 text not null check (report_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  quantity_tolerance text not null check (quantity_tolerance ~ '^[0-9]+(\.[0-9]+)?$'),
  krw_tolerance text not null check (krw_tolerance ~ '^[0-9]+(\.[0-9]+)?$'),
  row_count integer not null check (row_count > 0),
  status_counts jsonb not null check (jsonb_typeof(status_counts) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id), unique (report_file_id), unique (manifest_file_id),
  check (report_file_id <> manifest_file_id),
  constraint lukas_qto_preflight_report_identity_fkey foreign key (report_file_id, project_id, report_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  constraint lukas_qto_preflight_manifest_identity_fkey foreign key (manifest_file_id, project_id, manifest_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table if not exists public.lukas_qto_preflight_inputs (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null,
  project_id uuid not null,
  input_role text not null check (input_role in ('ifc','qto','estimate','mapping','source_manifest')),
  file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_id text not null check (char_length(trim(source_id)) between 1 and 200),
  unique (artifact_id, input_role),
  constraint lukas_qto_preflight_inputs_artifact_fkey foreign key (artifact_id, project_id)
    references public.lukas_qto_preflight_artifacts(id, project_id) on delete cascade,
  constraint lukas_qto_preflight_inputs_file_identity_fkey foreign key (file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table if not exists public.lukas_qto_preflight_approvals (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null references public.lukas_qto_preflight_artifacts(id) on delete cascade,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approved','rejected','deferred')),
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now()
);

create index if not exists lukas_qto_preflight_artifacts_project_created_idx on public.lukas_qto_preflight_artifacts(project_id, created_at desc);
create index if not exists lukas_qto_preflight_inputs_file_idx on public.lukas_qto_preflight_inputs(file_id);
create index if not exists lukas_qto_preflight_approvals_artifact_created_idx on public.lukas_qto_preflight_approvals(artifact_id, created_at desc);

alter table public.lukas_qto_preflight_artifacts enable row level security;
alter table public.lukas_qto_preflight_inputs enable row level security;
alter table public.lukas_qto_preflight_approvals enable row level security;

create policy "project members read preflight artifacts" on public.lukas_qto_preflight_artifacts for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members read preflight input evidence" on public.lukas_qto_preflight_inputs for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members read preflight approvals" on public.lukas_qto_preflight_approvals for select to authenticated using (exists (
  select 1 from public.lukas_qto_preflight_artifacts a join public.lukas_qto_projects p on p.id = a.project_id where a.id = artifact_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members add preflight approvals" on public.lukas_qto_preflight_approvals for insert to authenticated with check (
  decided_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_preflight_artifacts a join public.lukas_qto_projects p on p.id = a.project_id where a.id = artifact_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));

grant select on public.lukas_qto_preflight_artifacts, public.lukas_qto_preflight_inputs to authenticated;
revoke insert, update, delete on public.lukas_qto_preflight_artifacts, public.lukas_qto_preflight_inputs from authenticated;
grant select, insert on public.lukas_qto_preflight_approvals to authenticated;
revoke update, delete on public.lukas_qto_preflight_approvals from authenticated;
grant all on public.lukas_qto_preflight_artifacts, public.lukas_qto_preflight_inputs, public.lukas_qto_preflight_approvals to service_role;

-- Public project inquiries. The browser may only append a consented inquiry;
-- reading and changing the queue is reserved for trusted server/staff tooling.
create table if not exists public.hangil_project_inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  email text not null check (char_length(trim(email)) between 3 and 254 and position('@' in email) > 1),
  phone text not null default '' check (char_length(phone) <= 40),
  company text not null default '' check (char_length(company) <= 120),
  project_name text not null check (char_length(trim(project_name)) between 1 and 160),
  message text not null check (char_length(trim(message)) between 10 and 4000),
  consent boolean not null check (consent = true),
  status text not null default 'new' check (status in ('new','contacted','qualified','closed')),
  created_at timestamptz not null default now()
);
alter table public.hangil_project_inquiries enable row level security;
create policy "public submits project inquiries" on public.hangil_project_inquiries
  for insert to anon, authenticated with check (consent = true and status = 'new');
create policy "hangil staff reads project inquiries" on public.hangil_project_inquiries
  for select to authenticated using (
    coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false
    and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
  );
create policy "hangil staff updates project inquiries" on public.hangil_project_inquiries
  for update to authenticated using (
    coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false
    and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
  ) with check (
    coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false
    and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
  );
grant insert on public.hangil_project_inquiries to anon, authenticated;
grant select, update on public.hangil_project_inquiries to authenticated;
revoke select, update, delete on public.hangil_project_inquiries from anon;
revoke delete on public.hangil_project_inquiries from authenticated;
grant all on public.hangil_project_inquiries to service_role;

-- Anonymous Auth users use the authenticated PostgreSQL role. A restrictive
-- policy makes every customer/staff table deny those sessions even if another
-- permissive owner policy matches the anonymous user's UUID.
create policy "verified email sessions only" on public.lukas_qto_projects as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_files as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_reviews as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_shares as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_suggestions as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_suggestion_decisions as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_takeoff_artifacts as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_takeoff_inputs as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_takeoff_approvals as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_file_revisions as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_preflight_artifacts as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_preflight_inputs as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_preflight_approvals as restrictive
  for all to authenticated using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only for qto storage" on storage.objects as restrictive
  for all to authenticated using (bucket_id <> 'lukas-qto' or coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (bucket_id <> 'lukas-qto' or coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);

create index if not exists lukas_qto_files_uploaded_by_idx on public.lukas_qto_files(uploaded_by);
create index if not exists lukas_qto_reviews_author_id_idx on public.lukas_qto_reviews(author_id);
create index if not exists lukas_qto_reviews_file_id_idx on public.lukas_qto_reviews(file_id);
create index if not exists lukas_qto_shares_created_by_idx on public.lukas_qto_shares(created_by);
create index if not exists hangil_project_inquiries_created_idx on public.hangil_project_inquiries(created_at desc);
