-- Customer-facing Hangil System workflow. Existing table names stay stable for compatibility.
alter table public.lukas_qto_projects
  add column if not exists workflow_status text not null default 'inquiry_received'
    check (workflow_status in ('inquiry_received','quote_review','confirmed','bim_modeling','quantity_takeoff','expert_review','delivered')),
  add column if not exists contact_name text not null default '' check (char_length(contact_name) <= 80),
  add column if not exists contact_phone text not null default '' check (char_length(contact_phone) <= 40);

create index if not exists lukas_qto_projects_workflow_status_idx on public.lukas_qto_projects(workflow_status, updated_at desc);

-- Staff authority is issued only through auth.app_metadata by a Supabase administrator.
drop policy if exists "hangil staff read projects" on public.lukas_qto_projects;
create policy "hangil staff read projects" on public.lukas_qto_projects for select to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff update projects" on public.lukas_qto_projects;
create policy "hangil staff update projects" on public.lukas_qto_projects for update to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff manage files" on public.lukas_qto_files;
create policy "hangil staff manage files" on public.lukas_qto_files for all to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff manage reviews" on public.lukas_qto_reviews;
create policy "hangil staff manage reviews" on public.lukas_qto_reviews for all to authenticated
  using ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  with check ((select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');

drop policy if exists "hangil staff read source files" on storage.objects;
create policy "hangil staff read source files" on storage.objects for select to authenticated
  using (bucket_id='lukas-qto' and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff upload source files" on storage.objects;
create policy "hangil staff upload source files" on storage.objects for insert to authenticated
  with check (bucket_id='lukas-qto' and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
drop policy if exists "hangil staff delete source files" on storage.objects;
create policy "hangil staff delete source files" on storage.objects for delete to authenticated
  using (bucket_id='lukas-qto' and (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff');
