-- Drawing-room collaborators need the same read access to explicit revision edges
-- that they already have to the project files and drawing issues.
drop policy if exists "project members read file revision graph"
  on public.lukas_qto_file_revisions;

create policy "project roles read file revision graph"
on public.lukas_qto_file_revisions for select to authenticated
using (public.lukas_qto_project_role(project_id) is not null);
