alter policy "reviewers add takeoff approvals"
on public.lukas_qto_takeoff_approvals
with check(
  decided_by=(select auth.uid())
  and exists(
    select 1 from public.lukas_qto_takeoff_artifacts artifact
    where artifact.id=lukas_qto_takeoff_approvals.artifact_id
      and artifact.created_by<>(select auth.uid())
      and private.lukas_qto_project_role(artifact.project_id) in('owner','staff','reviewer')
  )
);

alter policy "reviewers add preflight approvals"
on public.lukas_qto_preflight_approvals
with check(
  decided_by=(select auth.uid())
  and exists(
    select 1 from public.lukas_qto_preflight_artifacts artifact
    where artifact.id=lukas_qto_preflight_approvals.artifact_id
      and artifact.created_by<>(select auth.uid())
      and private.lukas_qto_project_role(artifact.project_id) in('owner','staff','reviewer')
  )
);
