-- P0 hardening for the existing Lukas QTO schema.
-- Covers every foreign-key access path reported by the Supabase advisor and
-- consolidates the original owner/staff policies without broadening access.

create index if not exists lukas_qto_carbon_factors_source_identity_idx
  on public.lukas_qto_carbon_factors(source_file_id, project_id, source_sha256);
create index if not exists lukas_qto_carbon_factors_created_by_idx
  on public.lukas_qto_carbon_factors(created_by);

create index if not exists lukas_qto_file_revisions_created_by_idx
  on public.lukas_qto_file_revisions(created_by);
create index if not exists lukas_qto_file_revisions_current_identity_idx
  on public.lukas_qto_file_revisions(current_file_id, project_id, current_sha256);
create index if not exists lukas_qto_file_revisions_previous_identity_idx
  on public.lukas_qto_file_revisions(previous_file_id, project_id, previous_sha256);

create index if not exists lukas_qto_material_plans_baseline_factor_idx
  on public.lukas_qto_material_plans(baseline_factor_id, project_id);
create index if not exists lukas_qto_material_plans_source_identity_idx
  on public.lukas_qto_material_plans(source_file_id, project_id, source_sha256);
create index if not exists lukas_qto_material_plans_created_by_idx
  on public.lukas_qto_material_plans(created_by);

create index if not exists lukas_qto_material_transactions_evidence_identity_idx
  on public.lukas_qto_material_transactions(evidence_file_id, project_id, evidence_sha256);
create index if not exists lukas_qto_material_transactions_factor_idx
  on public.lukas_qto_material_transactions(carbon_factor_id, project_id);
create index if not exists lukas_qto_material_transactions_order_idx
  on public.lukas_qto_material_transactions(related_order_id, project_id);
create index if not exists lukas_qto_material_transactions_plan_project_idx
  on public.lukas_qto_material_transactions(material_plan_id, project_id);
create index if not exists lukas_qto_material_transactions_created_by_idx
  on public.lukas_qto_material_transactions(created_by);

create index if not exists lukas_qto_preflight_approvals_decided_by_idx
  on public.lukas_qto_preflight_approvals(decided_by);
create index if not exists lukas_qto_preflight_artifacts_created_by_idx
  on public.lukas_qto_preflight_artifacts(created_by);
create index if not exists lukas_qto_preflight_artifacts_manifest_identity_idx
  on public.lukas_qto_preflight_artifacts(manifest_file_id, project_id, manifest_sha256);
create index if not exists lukas_qto_preflight_artifacts_report_identity_idx
  on public.lukas_qto_preflight_artifacts(report_file_id, project_id, report_sha256);
create index if not exists lukas_qto_preflight_inputs_artifact_idx
  on public.lukas_qto_preflight_inputs(artifact_id, project_id);
create index if not exists lukas_qto_preflight_inputs_file_identity_idx
  on public.lukas_qto_preflight_inputs(file_id, project_id, source_sha256);

create index if not exists lukas_qto_suggestion_decisions_decided_by_idx
  on public.lukas_qto_suggestion_decisions(decided_by);
create index if not exists lukas_qto_suggestions_created_by_idx
  on public.lukas_qto_suggestions(created_by);
create index if not exists lukas_qto_suggestions_payload_identity_idx
  on public.lukas_qto_suggestions(payload_file_id, project_id, payload_sha256);
create index if not exists lukas_qto_suggestions_source_identity_idx
  on public.lukas_qto_suggestions(file_id, project_id, source_sha256);

create index if not exists lukas_qto_takeoff_approvals_decided_by_idx
  on public.lukas_qto_takeoff_approvals(decided_by);
create index if not exists lukas_qto_takeoff_artifacts_created_by_idx
  on public.lukas_qto_takeoff_artifacts(created_by);
create index if not exists lukas_qto_takeoff_artifacts_manifest_identity_idx
  on public.lukas_qto_takeoff_artifacts(manifest_file_id, project_id, manifest_sha256);
create index if not exists lukas_qto_takeoff_artifacts_report_identity_idx
  on public.lukas_qto_takeoff_artifacts(report_file_id, project_id, report_sha256);
create index if not exists lukas_qto_takeoff_inputs_artifact_idx
  on public.lukas_qto_takeoff_inputs(artifact_id, project_id);
create index if not exists lukas_qto_takeoff_inputs_file_identity_idx
  on public.lukas_qto_takeoff_inputs(file_id, project_id, source_sha256);

-- One permissive policy per table/action avoids evaluating parallel owner and
-- staff policies while preserving the original authorization predicates.
drop policy if exists "lukas qto owners manage projects" on public.lukas_qto_projects;
drop policy if exists "hangil staff read projects" on public.lukas_qto_projects;
drop policy if exists "hangil staff update projects" on public.lukas_qto_projects;

create policy "project owners or staff read projects"
  on public.lukas_qto_projects for select to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
  );
create policy "project owners create projects"
  on public.lukas_qto_projects for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy "project owners or staff update projects"
  on public.lukas_qto_projects for update to authenticated
  using (
    owner_id = (select auth.uid())
    or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
  )
  with check (
    owner_id = (select auth.uid())
    or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
  );
create policy "project owners delete projects"
  on public.lukas_qto_projects for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy if exists "lukas qto owners read files" on public.lukas_qto_files;
drop policy if exists "lukas qto owners add immutable files" on public.lukas_qto_files;
drop policy if exists "lukas qto owners delete files" on public.lukas_qto_files;
drop policy if exists "hangil staff manage files" on public.lukas_qto_files;

create policy "project owners or staff read files"
  on public.lukas_qto_files for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p
    where p.id = project_id
      and (
        p.owner_id = (select auth.uid())
        or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
      )
  ));
create policy "project owners or staff add immutable files"
  on public.lukas_qto_files for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and immutable = true
    and exists (
      select 1 from public.lukas_qto_projects p
      where p.id = project_id
        and (
          p.owner_id = (select auth.uid())
          or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
        )
    )
  );
create policy "project owners or staff delete files"
  on public.lukas_qto_files for delete to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p
    where p.id = project_id
      and (
        p.owner_id = (select auth.uid())
        or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
      )
  ));

drop policy if exists "lukas qto owners manage reviews" on public.lukas_qto_reviews;
drop policy if exists "hangil staff manage reviews" on public.lukas_qto_reviews;

create policy "project owners or staff manage reviews"
  on public.lukas_qto_reviews for all to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p
    where p.id = project_id
      and (
        p.owner_id = (select auth.uid())
        or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
      )
  ))
  with check (exists (
    select 1 from public.lukas_qto_projects p
    where p.id = project_id
      and (
        p.owner_id = (select auth.uid())
        or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff'
      )
  ));
