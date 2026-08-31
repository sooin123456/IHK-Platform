-- Authenticated clients may still register small derived artifacts through
-- legacy server actions. Source kinds, and every object in the append-only
-- source-uploads namespace, must pass through the service-only verifier and
-- atomic finalizer introduced in 20260831012000.
drop policy if exists "verified source metadata requires service finalizer"
  on public.lukas_qto_files;
create policy "verified source metadata requires service finalizer"
on public.lukas_qto_files as restrictive for insert to authenticated
with check (
  kind = 'other'
  and pg_catalog.split_part(storage_path,'/',3) <> 'source-uploads'
);
