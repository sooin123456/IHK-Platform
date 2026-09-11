-- Adds verified DXF originals without treating native DWG as an editable kind.
alter table public.lukas_qto_files
  drop constraint if exists lukas_qto_files_kind_check;
alter table public.lukas_qto_files
  add constraint lukas_qto_files_kind_check check (
    kind in (
      'ifc','pdf','dxf','qto_csv','element_ledger','formwork_ledger',
      'estimate','mapping','other'
    )
  );

alter table public.lukas_qto_verified_uploads
  drop constraint if exists lukas_qto_verified_uploads_kind_check;
alter table public.lukas_qto_verified_uploads
  add constraint lukas_qto_verified_uploads_kind_check check (
    kind in (
      'ifc','pdf','dxf','qto_csv','element_ledger','formwork_ledger',
      'estimate','mapping','other'
    )
  );

update storage.buckets
set allowed_mime_types = array(
  select distinct mime
  from unnest(
    coalesce(allowed_mime_types, '{}'::text[]) || array[
      'application/dxf','application/x-dxf','application/octet-stream',
      'image/vnd.dxf','text/plain'
    ]
  ) mime
  order by mime
)
where id = 'lukas-qto';
