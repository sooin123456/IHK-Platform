-- INSERT ... RETURNING evaluates the SELECT policy before AFTER INSERT
-- triggers add the owner's project-membership row. The role helper reads the
-- table and therefore cannot see that not-yet-visible row during RETURNING.
-- Authorize the immutable owner column directly while preserving role access
-- for every already-persisted project.
alter policy "project roles read projects"
on public.lukas_qto_projects
using (
  owner_id = (select auth.uid())
  or private.lukas_qto_project_role(id) is not null
);
