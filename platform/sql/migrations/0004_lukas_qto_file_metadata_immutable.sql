-- Source file metadata is append-only. Review annotations are the mutable layer.
drop policy if exists "lukas qto owners manage files" on public.lukas_qto_files;
create policy "lukas qto owners read files" on public.lukas_qto_files for select to authenticated
using (exists (select 1 from public.lukas_qto_projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "lukas qto owners add immutable files" on public.lukas_qto_files for insert to authenticated
with check (uploaded_by=(select auth.uid()) and immutable=true and exists (select 1 from public.lukas_qto_projects p where p.id=project_id and p.owner_id=(select auth.uid())));
create policy "lukas qto owners delete files" on public.lukas_qto_files for delete to authenticated
using (exists (select 1 from public.lukas_qto_projects p where p.id=project_id and p.owner_id=(select auth.uid())));
