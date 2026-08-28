-- Authenticated project staff may read ordinary project storage, but IFC
-- derivatives are immutable managed artifacts. Only the trusted server-side
-- service role may publish their content-addressed keys. The ingestion client
-- uses upsert=false; consumers re-hash signed bytes against hashes returned by
-- the drawing source descriptor.
create policy "IFC derivatives reject authenticated insert"
on storage.objects as restrictive for insert to authenticated
with check(not (
  bucket_id='lukas-qto' and
  name ~ '^projects/[0-9a-f-]{36}/ifc-derivatives/'
));

create policy "IFC derivatives reject authenticated update"
on storage.objects as restrictive for update to authenticated
using(not (
  bucket_id='lukas-qto' and
  name ~ '^projects/[0-9a-f-]{36}/ifc-derivatives/'
))
with check(not (
  bucket_id='lukas-qto' and
  name ~ '^projects/[0-9a-f-]{36}/ifc-derivatives/'
));

create policy "IFC derivatives reject authenticated delete"
on storage.objects as restrictive for delete to authenticated
using(not (
  bucket_id='lukas-qto' and
  name ~ '^projects/[0-9a-f-]{36}/ifc-derivatives/'
));
