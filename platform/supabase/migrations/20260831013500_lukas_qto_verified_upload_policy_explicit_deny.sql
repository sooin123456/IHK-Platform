-- The verifier ledger is intentionally service-only. An explicit deny policy
-- documents that boundary while table grants remain revoked from browsers.
create policy "verified uploads reject browser access"
on public.lukas_qto_verified_uploads as restrictive for all to anon,authenticated
using (false)
with check (false);
