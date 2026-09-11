# Task2 exact-baseline review package

Review authority: exact pre-task public copies and newly created files, not HEAD. No commits. Branch codex/universal-workspace-m1; HEAD remains9f5f56d93db325ff935772252f9d4fb64d69f98c. Read brief/report alongside this package. Scope: nine production/test files below. Four new files use /dev/null baseline. Existing files compare the preserved exact source. Diffs include10lines context; read bounded chunks to EOF. Build evidence controller-task-2-build.log applies to identical final app hashes.

## File identity

- platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts: 1c11d4cd8ef6e4e2eb8e5ae0c80ad41b0d844512618a70b971e60310ffc4fdc8; baseline docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-resave-jobs.server.ts
- platform/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts: cdf5df3bcdad088b989c406353282aaf498e38c697e260d3df0d0586fed2cea9; baseline new file
- platform/supabase/migrations/20260906130844_drawing_native_dwg_resave_publication.sql: ba1fade7c669dd4ce6022750d6787796cc8b93e37f6bcba03c9d5ea0ca2a61e6; baseline new file
- platform/tests/drawing-native-dwg-resave-artifact-jobs.test.mjs: cd42e5c71c84d65049fa061197ff8efa579c009f8d7cb4e9010ff57d7d3a35c3; baseline new file
- platform/tests/fixtures/drawing-native-dwg-resave-publication-database.mjs: cec50d2e3c032c24d0ec59e6b5daf90fa6d280f61f9ad9d78af4e02c239e6e24; baseline new file
- platform/tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs: d9e223f97c9e756902113902c8170e4f521e70be0a01871db589cb59b34785da; baseline docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-resave-jobs-database.mjs
- platform/tests/drawing-workspace-m1-real-database.test.mjs: 8263da207971ce5fbbe1f983f9e683454ee76b9df6f845242118468d2d660810; baseline docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-workspace-m1-real-database.test.mjs
- platform/tests/fixtures/drawing-native-dwg-jobs-database.mjs: 23d985d0e3535690a77a2fe2468064558b43a8b90c16439ebf83bbd922b07e61; baseline docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-jobs-database.mjs
- platform/tests/drawing-native-dwg-resave-jobs.test.mjs: a15e90c9e46d36a1d9e4a4cc930f15ae52f66fb69e2b47fb24a22e10b2447cf7; baseline docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-resave-jobs.test.mjs

## Full exact deltas

### platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts

```diff
diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-resave-jobs.server.ts b/platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts
index 587083b..bc528e4 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-resave-jobs.server.ts
+++ b/platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts
@@ -23,40 +23,43 @@ const RequestSchema = NativeDrawingDwgScopeSchema.extend({
 const AcceptanceSchema = z
   .object({ jobId: Uuid, requestId: Uuid, hasChanges: z.boolean() })
   .strict();
 const FailureCode = z.enum([
   "source_unavailable",
   "source_mismatch",
   "resaver_failed",
   "output_invalid",
   "worker_interrupted",
   "authority_revoked",
+  "upload_failed",
+  "publication_failed",
 ]);
 const StatusSchema = AcceptanceSchema.extend({
   status: z.enum([
     "queued",
     "processing",
     "retry_wait",
     "cancel_requested",
     "cancelled",
     "no_changes",
     "failed",
+    "completed",
   ]),
   attemptCount: z.number().int().min(0).max(3),
   failureCode: FailureCode.nullable(),
 })
   .strict()
   .refine(
     (value) =>
       (value.status === "no_changes") === !value.hasChanges &&
       (value.status !== "no_changes" || value.attemptCount === 0) &&
-      (!["processing", "retry_wait", "cancel_requested"].includes(
+      (!["processing", "retry_wait", "cancel_requested", "completed"].includes(
         value.status,
       ) ||
         value.attemptCount > 0),
   );
 const ClaimSchema = z
   .object({
     jobId: Uuid,
     attemptNumber: z.number().int().min(1).max(3),
     leaseToken: Uuid,
     leaseExpiresAt: z.string().datetime({ offset: true }),
@@ -179,20 +182,48 @@ async function actor(client: UserClient, signal?: AbortSignal) {
   if (
     !response ||
     response.error !== null ||
     !response.data?.user ||
     response.data.user.is_anonymous === true
   )
     throw new NativeDrawingDwgResaveJobError("unavailable");
   return parse(Uuid, response.data.user.id);
 }
 
+// Authenticated artifact adapters share the same strict envelopes and deadline.
+export {
+  rpc as callNativeDrawingDwgResaveJobRpc,
+  actor as verifyNativeDrawingDwgResaveActor,
+};
+
+export async function getLatestNativeDrawingDwgResaveStatus(
+  client: UserClient,
+  rawScope: unknown,
+  signal?: AbortSignal,
+) {
+  const scope = scopeInput(rawScope);
+  const actorId = await actor(client, signal);
+  const raw = await rpc(
+    client,
+    "lukas_drawing_native_dwg_resave_status",
+    {
+      p_scope: scope,
+      p_job_id: null,
+    },
+    signal,
+  );
+  const status = raw === null ? null : parse(StatusSchema, raw);
+  if ((await actor(client, signal)) !== actorId)
+    throw new NativeDrawingDwgResaveJobError("unavailable");
+  return status;
+}
+
 export async function requestNativeDrawingDwgResave(
   userClient: UserClient,
   serviceClient: RpcClient,
   rawRequest: unknown,
   rawImageId: unknown,
   signal?: AbortSignal,
 ) {
   const { requestId, ...rawScope } = parse(RequestSchema, rawRequest);
   const scope = scopeInput(rawScope),
     imageId = parse(ImageId, rawImageId);
```

### platform/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts

```diff
diff --git a/platform/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts b/platform/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts
new file mode 100644
index 0000000..5e1baa8
--- /dev/null
+++ b/platform/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts
@@ -0,0 +1,107 @@
+import { isDeepStrictEqual } from "node:util";
+import { z } from "zod";
+import { NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-jobs.server.ts";
+import {
+  callNativeDrawingDwgResaveJobRpc,
+  verifyNativeDrawingDwgResaveActor,
+  NativeDrawingDwgResaveJobError,
+} from "./drawing-native-dwg-resave-jobs.server.ts";
+import {
+  NativeDrawingDwgResaveArtifactKindSchema,
+  NativeDrawingDwgResaveReceiptSchema,
+  NativeDrawingDwgResaveDescriptorSchema,
+  nativeDrawingDwgResaveArtifactPath,
+} from "./drawing-native-dwg-resave-artifacts.server.ts";
+
+type UserClient = Parameters<typeof verifyNativeDrawingDwgResaveActor>[0];
+const Uuid = z
+  .string()
+  .uuid()
+  .transform((value) => value.toLowerCase());
+const Scope = NativeDrawingDwgScopeSchema.transform((scope) => ({
+  ...scope,
+  projectId: scope.projectId.toLowerCase(),
+  documentId: scope.documentId.toLowerCase(),
+  revisionId: scope.revisionId.toLowerCase(),
+  canvasId: scope.canvasId.toLowerCase(),
+}));
+function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
+  const result = schema.safeParse(raw);
+  if (!result.success) throw new NativeDrawingDwgResaveJobError("invalid");
+  return result.data;
+}
+
+export async function getNativeDrawingDwgResaveReceipt(
+  client: UserClient,
+  rawScope: unknown,
+  rawJobId: unknown,
+  signal?: AbortSignal,
+) {
+  const scope = parse(Scope, rawScope),
+    jobId = parse(Uuid, rawJobId);
+  const actorId = await verifyNativeDrawingDwgResaveActor(client, signal);
+  const receipt = parse(
+    NativeDrawingDwgResaveReceiptSchema,
+    await callNativeDrawingDwgResaveJobRpc(
+      client,
+      "lukas_drawing_native_dwg_resave_receipt",
+      {
+        p_scope: scope,
+        p_job_id: jobId,
+      },
+      signal,
+    ),
+  );
+  if (receipt.jobId !== jobId || !isDeepStrictEqual(receipt.scope, scope))
+    throw new NativeDrawingDwgResaveJobError("invalid");
+  if ((await verifyNativeDrawingDwgResaveActor(client, signal)) !== actorId)
+    throw new NativeDrawingDwgResaveJobError("unavailable");
+  return receipt;
+}
+
+/** Server-only locator; every component is bound to the authenticated scope. */
+export async function getNativeDrawingDwgResaveDownloadDescriptor(
+  client: UserClient,
+  rawScope: unknown,
+  rawJobId: unknown,
+  rawKind: unknown,
+  signal?: AbortSignal,
+) {
+  const scope = parse(Scope, rawScope),
+    jobId = parse(Uuid, rawJobId);
+  const kind = parse(NativeDrawingDwgResaveArtifactKindSchema, rawKind);
+  const actorId = await verifyNativeDrawingDwgResaveActor(client, signal);
+  const descriptor = parse(
+    NativeDrawingDwgResaveDescriptorSchema,
+    await callNativeDrawingDwgResaveJobRpc(
+      client,
+      "lukas_drawing_native_dwg_resave_download_descriptor",
+      {
+        p_scope: scope,
+        p_job_id: jobId,
+        p_kind: kind,
+      },
+      signal,
+    ),
+  );
+  const metadata = {
+    kind: descriptor.kind,
+    sha256: descriptor.sha256,
+    byteSize: descriptor.byteSize,
+  };
+  if (
+    descriptor.jobId !== jobId ||
+    descriptor.kind !== kind ||
+    descriptor.path !==
+      nativeDrawingDwgResaveArtifactPath(
+        scope,
+        jobId,
+        descriptor.attemptNumber,
+        metadata,
+      )
+  )
+    throw new NativeDrawingDwgResaveJobError("invalid");
+  if ((await verifyNativeDrawingDwgResaveActor(client, signal)) !== actorId)
+    throw new NativeDrawingDwgResaveJobError("unavailable");
+  return descriptor;
+}
```

### platform/supabase/migrations/20260906130844_drawing_native_dwg_resave_publication.sql

```diff
diff --git a/platform/supabase/migrations/20260906130844_drawing_native_dwg_resave_publication.sql b/platform/supabase/migrations/20260906130844_drawing_native_dwg_resave_publication.sql
new file mode 100644
index 0000000..0832562
--- /dev/null
+++ b/platform/supabase/migrations/20260906130844_drawing_native_dwg_resave_publication.sql
@@ -0,0 +1,740 @@
+begin;
+
+alter table public.lukas_drawing_native_dwg_resave_jobs
+  drop constraint lukas_drawing_native_dwg_resave_jobs_status_check,
+  add check(status in ('queued','processing','retry_wait','cancel_requested','cancelled','no_changes','failed','completed')),
+  drop constraint lukas_drawing_native_dwg_resave_jobs_failure_code_check,
+  add check(failure_code in ('source_unavailable','source_mismatch','resaver_failed','output_invalid','worker_interrupted','authority_revoked','upload_failed','publication_failed'));
+alter table public.lukas_drawing_native_dwg_resave_attempts
+  add column upload_state text not null default 'not_started' check(upload_state in ('not_started','open','closed')),
+  add column upload_closed_at timestamptz,
+  add check((upload_state='closed')=(upload_closed_at is not null)),
+  add check(upload_state<>'open' or outcome is null),
+  add unique(project_id,job_id,attempt_number),
+  drop constraint lukas_drawing_native_dwg_resave_attempts_outcome_check,
+  add check(outcome in ('retry_wait','failed','expired','cancelled','completed')),
+  drop constraint lukas_drawing_native_dwg_resave_attempts_failure_code_check,
+  add check(failure_code in ('source_unavailable','source_mismatch','resaver_failed','output_invalid','worker_interrupted','authority_revoked','upload_failed','publication_failed'));
+create index drawing_resave_open_idx on public.lukas_drawing_native_dwg_resave_attempts(job_id) where upload_state='open';
+create index drawing_resave_latest_idx on public.lukas_drawing_native_dwg_resave_jobs(project_id,created_at desc,id desc);
+
+create table public.lukas_drawing_native_dwg_resave_artifacts (
+  project_id uuid not null,
+  job_id uuid not null,
+  attempt_number integer not null,
+  kind text not null check(kind in ('dwg','edit_request','authority','report')),
+  sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
+  byte_size bigint not null check(byte_size between case when kind='dwg' then 6 else 1 end and
+    case kind when 'dwg' then 209715200 when 'edit_request' then 2097152 when 'authority' then 67108864 else 1048576 end),
+  path text not null unique,
+  primary key(project_id,job_id,attempt_number,kind),
+  foreign key(project_id,job_id,attempt_number) references public.lukas_drawing_native_dwg_resave_attempts(project_id,job_id,attempt_number) on delete cascade,
+  check(path='projects/'||project_id::text||'/native-dwg-resave/'||job_id::text||'/'||attempt_number::text||'/'||sha256||'/'||
+    case kind when 'dwg' then 'resaved.dwg' when 'edit_request' then 'edit-request.json' when 'authority' then 'authority.json' else 'native-report.json' end)
+);
+create table public.lukas_drawing_native_dwg_resave_exports (
+  job_id uuid primary key,
+  project_id uuid not null,
+  attempt_number integer not null,
+  completed_at timestamptz not null,
+  foreign key(project_id,job_id,attempt_number) references public.lukas_drawing_native_dwg_resave_attempts(project_id,job_id,attempt_number) on delete cascade
+);
+create index drawing_resave_export_attempt_idx on public.lukas_drawing_native_dwg_resave_exports(project_id,job_id,attempt_number);
+alter table public.lukas_drawing_native_dwg_resave_artifacts enable row level security;
+alter table public.lukas_drawing_native_dwg_resave_artifacts force row level security;
+alter table public.lukas_drawing_native_dwg_resave_exports enable row level security;
+alter table public.lukas_drawing_native_dwg_resave_exports force row level security;
+revoke all on public.lukas_drawing_native_dwg_resave_artifacts,public.lukas_drawing_native_dwg_resave_exports from public,anon,authenticated,service_role,lukas_drawing_collaboration;
+
+create or replace function private.lukas_drawing_native_dwg_resave_guard()
+returns trigger language plpgsql security invoker set search_path='' as $$
+begin
+  if tg_op='DELETE' then
+    if private.lukas_drawing_native_dwg_delete_allowed(old.project_id,tg_relid) then return old; end if;
+    raise exception using errcode='PNR11',message='Native DWG resave is unavailable';
+  end if;
+  if tg_table_name='lukas_drawing_native_dwg_resave_jobs' then
+    if (pg_catalog.to_jsonb(new)-array['status','attempt_count','lease_token','lease_expires_at','next_attempt_at','failure_code']) is distinct from
+      (pg_catalog.to_jsonb(old)-array['status','attempt_count','lease_token','lease_expires_at','next_attempt_at','failure_code'])
+      or (old.status in ('no_changes','cancelled','failed','completed') and new is distinct from old)
+    then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+    if exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=old.id and upload_state='open')
+      and (new.status not in ('processing','cancel_requested') or new.attempt_count is distinct from old.attempt_count or new.lease_token is distinct from old.lease_token)
+    then raise exception using errcode='PNR13',message='Native DWG resave upload is open'; end if;
+  elsif tg_table_name='lukas_drawing_native_dwg_resave_attempts' then
+    if (pg_catalog.to_jsonb(new)-array['outcome','finished_at','failure_code','upload_state','upload_closed_at']) is distinct from
+      (pg_catalog.to_jsonb(old)-array['outcome','finished_at','failure_code','upload_state','upload_closed_at'])
+      or (old.outcome is not null and new is distinct from old)
+      or (old.upload_state='closed' and (new.upload_state is distinct from old.upload_state or new.upload_closed_at is distinct from old.upload_closed_at))
+      or (old.upload_state='open' and new.upload_state not in ('open','closed'))
+      or (old.upload_state='not_started' and new.upload_state not in ('not_started','open'))
+    then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+    if new.outcome is distinct from old.outcome and exists(
+      select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=old.job_id and upload_state='open')
+    then raise exception using errcode='PNR13',message='Native DWG resave upload is open'; end if;
+  else
+    raise exception using errcode='PNR11',message='Native DWG resave is immutable';
+  end if;
+  return new;
+end;
+$$;
+create trigger drawing_resave_artifacts_guard before update or delete on public.lukas_drawing_native_dwg_resave_artifacts for each row execute function private.lukas_drawing_native_dwg_resave_guard();
+create trigger drawing_resave_exports_guard before update or delete on public.lukas_drawing_native_dwg_resave_exports for each row execute function private.lukas_drawing_native_dwg_resave_guard();
+
+-- Project/job locks serialize all sessions; the exact attempt is locked next.
+create function public.lukas_drawing_stage_native_dwg_resave(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_artifacts jsonb)
+returns jsonb language plpgsql security definer set search_path='' as $$
+declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; a public.lukas_drawing_native_dwg_resave_attempts%rowtype;
+  context jsonb; m jsonb; n integer:=0; kinds text[]:=array['dwg','edit_request','authority','report']; k text; bytes numeric; maximum bigint; stored jsonb;
+begin
+  if not private.lukas_drawing_native_dwg_import_service() then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
+  select * into a from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and attempt_number=p_attempt_number for update;
+  if j.id is null or a.job_id is null or a.lease_token is distinct from p_lease_token
+    or j.attempt_count is distinct from p_attempt_number or j.lease_token is distinct from p_lease_token
+    or j.status<>'processing' or a.outcome is not null
+    or j.lease_expires_at<=pg_catalog.clock_timestamp() or a.lease_expires_at<=pg_catalog.clock_timestamp()
+  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+  if p_artifacts is null or pg_catalog.jsonb_typeof(p_artifacts)<>'array' then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
+  if pg_catalog.jsonb_array_length(p_artifacts)<>4 then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
+  for m in select value from pg_catalog.jsonb_array_elements(p_artifacts) loop
+    n:=n+1; k:=kinds[n];
+    if pg_catalog.jsonb_typeof(m)<>'object' or not m?&array['kind','sha256','byteSize'] or m-array['kind','sha256','byteSize']<>'{}'::jsonb
+      or m->>'kind' is distinct from k or pg_catalog.jsonb_typeof(m->'sha256') is distinct from 'string'
+      or m->>'sha256'!~'^[0-9a-f]{64}$' or pg_catalog.jsonb_typeof(m->'byteSize') is distinct from 'number'
+    then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
+    bytes:=(m->>'byteSize')::numeric;
+    maximum:=case k when 'dwg' then 209715200 when 'edit_request' then 2097152 when 'authority' then 67108864 else 1048576 end;
+    if bytes<>pg_catalog.trunc(bytes) or bytes not between (case when k='dwg' then 6 else 1 end) and maximum
+    then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
+  end loop;
+  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind',kind,'sha256',sha256,'byteSize',byte_size)
+    order by pg_catalog.array_position(kinds,kind)) into stored
+    from public.lukas_drawing_native_dwg_resave_artifacts where project_id=j.project_id and job_id=j.id and attempt_number=a.attempt_number;
+  if stored is not null and stored is distinct from p_artifacts then raise exception using errcode='PNR12',message='Native DWG resave artifacts conflict'; end if;
+  if p_artifacts#>>'{1,sha256}' is distinct from j.attestation#>>'{request,sha256}'
+    or p_artifacts#>'{1,byteSize}' is distinct from j.attestation#>'{request,byteSize}'
+    or p_artifacts#>>'{2,sha256}' is distinct from j.attestation#>>'{authority,sha256}'
+    or p_artifacts#>'{2,byteSize}' is distinct from j.attestation#>'{authority,byteSize}'
+  then raise exception using errcode='PNR11',message='Native DWG resave artifacts are invalid'; end if;
+  context:=private.lukas_drawing_native_dwg_resave_context(j.requested_by,j.scope);
+  if context->'source' is distinct from j.source or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true
+  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  if j.lease_expires_at<=pg_catalog.clock_timestamp() or a.lease_expires_at<=pg_catalog.clock_timestamp()
+  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+  if a.upload_state='not_started' then
+    insert into public.lukas_drawing_native_dwg_resave_artifacts(project_id,job_id,attempt_number,kind,sha256,byte_size,path)
+      select j.project_id,j.id,a.attempt_number,item->>'kind',item->>'sha256',(item->>'byteSize')::bigint,
+        'projects/'||j.project_id::text||'/native-dwg-resave/'||j.id::text||'/'||a.attempt_number::text||'/'||(item->>'sha256')||'/'||
+        case item->>'kind' when 'dwg' then 'resaved.dwg' when 'edit_request' then 'edit-request.json' when 'authority' then 'authority.json' else 'native-report.json' end
+      from pg_catalog.jsonb_array_elements(p_artifacts) item;
+    update public.lukas_drawing_native_dwg_resave_attempts set upload_state='open' where job_id=j.id and attempt_number=a.attempt_number returning * into a;
+  elsif stored is null then
+    raise exception using errcode='PNR13',message='Native DWG resave lease is stale';
+  end if;
+  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('kind',kind,'sha256',sha256,'byteSize',byte_size,'path',path)
+    order by pg_catalog.array_position(kinds,kind)) into stored
+    from public.lukas_drawing_native_dwg_resave_artifacts where project_id=j.project_id and job_id=j.id and attempt_number=a.attempt_number;
+  return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',a.attempt_number,'leaseToken',a.lease_token,'uploadState',a.upload_state,'artifacts',stored);
+end;
+$$;
+
+create function public.lukas_drawing_close_native_dwg_resave_upload(p_job_id uuid,p_attempt_number integer,p_lease_token uuid)
+returns jsonb language plpgsql security definer set search_path='' as $$
+declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; a public.lukas_drawing_native_dwg_resave_attempts%rowtype;
+begin
+  if not private.lukas_drawing_native_dwg_import_service() then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
+  select * into a from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and attempt_number=p_attempt_number for update;
+  if j.id is null or a.job_id is null or a.lease_token is distinct from p_lease_token or a.upload_state='not_started'
+  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+  if a.upload_state='open' then
+    update public.lukas_drawing_native_dwg_resave_attempts set upload_state='closed',upload_closed_at=pg_catalog.clock_timestamp() where job_id=j.id and attempt_number=a.attempt_number;
+  end if;
+  return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',a.attempt_number,'leaseToken',a.lease_token,'uploadState','closed');
+end;
+$$;
+
+create function private.lukas_drawing_native_dwg_resave_receipt(p_job_id uuid)
+returns jsonb language sql stable security invoker set search_path='' as $$
+  select pg_catalog.jsonb_build_object('schemaVersion','1hk-dwg-resave-receipt/1','jobId',j.id,'attemptNumber',e.attempt_number,
+    'scope',j.scope,'resaverImageId',j.resaver_image_id,'sourceSha256',j.source->'sha256','qualification','experimental-unqualified',
+    'persistenceAuthority','not-issued','artifacts',(select pg_catalog.jsonb_agg(
+      pg_catalog.jsonb_build_object('kind',r.kind,'sha256',r.sha256,'byteSize',r.byte_size)
+      order by pg_catalog.array_position(array['dwg','edit_request','authority','report'],r.kind))
+      from public.lukas_drawing_native_dwg_resave_artifacts r where r.project_id=e.project_id and r.job_id=e.job_id and r.attempt_number=e.attempt_number),
+    'createdAt',e.completed_at)
+  from public.lukas_drawing_native_dwg_resave_jobs j
+  join public.lukas_drawing_native_dwg_resave_exports e on e.project_id=j.project_id and e.job_id=j.id
+  join public.lukas_drawing_native_dwg_resave_attempts a on a.project_id=e.project_id and a.job_id=e.job_id and a.attempt_number=e.attempt_number
+  where j.id=p_job_id and j.status='completed' and a.outcome='completed' and a.upload_state='closed'
+$$;
+
+create function public.lukas_drawing_publish_native_dwg_resave(p_job_id uuid,p_attempt_number integer,p_lease_token uuid)
+returns jsonb language plpgsql security definer set search_path='' as $$
+declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; a public.lukas_drawing_native_dwg_resave_attempts%rowtype; context jsonb; receipt jsonb; t timestamptz;
+begin
+  if not private.lukas_drawing_native_dwg_import_service() then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
+  select * into a from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and attempt_number=p_attempt_number for update;
+  if j.id is null or a.job_id is null or a.lease_token is distinct from p_lease_token
+  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+  receipt:=private.lukas_drawing_native_dwg_resave_receipt(j.id);
+  if receipt is not null then
+    if (receipt->>'attemptNumber')::integer<>a.attempt_number then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+    return receipt;
+  end if;
+  if j.status<>'processing' or j.attempt_count<>a.attempt_number or j.lease_token is distinct from a.lease_token
+    or a.outcome is not null or a.upload_state<>'closed'
+    or exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and upload_state='open')
+    or j.lease_expires_at<=pg_catalog.clock_timestamp() or a.lease_expires_at<=pg_catalog.clock_timestamp()
+    or (select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_artifacts where project_id=j.project_id and job_id=j.id and attempt_number=a.attempt_number)<>4
+  then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+  context:=private.lukas_drawing_native_dwg_resave_context(j.requested_by,j.scope);
+  if context->'source' is distinct from j.source or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true
+  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  t:=pg_catalog.clock_timestamp();
+  if j.lease_expires_at<=t or a.lease_expires_at<=t then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+  insert into public.lukas_drawing_native_dwg_resave_exports(job_id,project_id,attempt_number,completed_at) values(j.id,j.project_id,a.attempt_number,t);
+  update public.lukas_drawing_native_dwg_resave_attempts set outcome='completed',finished_at=t,failure_code=null where job_id=j.id and attempt_number=a.attempt_number;
+  update public.lukas_drawing_native_dwg_resave_jobs set status='completed',failure_code=null where id=j.id;
+  return private.lukas_drawing_native_dwg_resave_receipt(j.id);
+end;
+$$;
+
+create function public.lukas_drawing_native_dwg_resave_receipt(p_scope jsonb,p_job_id uuid)
+returns jsonb language plpgsql security definer set search_path='' as $$
+declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; context jsonb; receipt jsonb;
+begin
+  if private.lukas_qto_verified_session() is not true then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  context:=private.lukas_drawing_native_dwg_resave_context((select auth.uid()),p_scope);
+  if context is null then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  select * into j from public.lukas_drawing_native_dwg_resave_jobs where id=p_job_id and scope=p_scope;
+  if j.id is null or context->'source' is distinct from j.source
+    or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true
+  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  receipt:=private.lukas_drawing_native_dwg_resave_receipt(j.id);
+  if receipt is null then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  return receipt;
+end;
+$$;
+
+create function public.lukas_drawing_native_dwg_resave_download_descriptor(p_scope jsonb,p_job_id uuid,p_kind text)
+returns jsonb language plpgsql security definer set search_path='' as $$
+declare receipt jsonb; descriptor jsonb;
+begin
+  receipt:=public.lukas_drawing_native_dwg_resave_receipt(p_scope,p_job_id);
+  select pg_catalog.jsonb_build_object('jobId',a.job_id,'attemptNumber',a.attempt_number,'kind',a.kind,'bucket','lukas-qto','path',a.path,'sha256',a.sha256,'byteSize',a.byte_size)
+    into descriptor from public.lukas_drawing_native_dwg_resave_artifacts a
+    where a.project_id=(receipt#>>'{scope,projectId}')::uuid and a.job_id=p_job_id and a.attempt_number=(receipt->>'attemptNumber')::integer and a.kind=p_kind;
+  if descriptor is null then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  return descriptor;
+end;
+$$;
+
+create policy "reserve native dwg resave managed prefix"
+on storage.objects as restrictive for all to authenticated,anon
+using (bucket_id<>'lukas-qto' or coalesce((storage.foldername(name))[1],'')<>'projects' or coalesce((storage.foldername(name))[3],'')<>'native-dwg-resave')
+with check (bucket_id<>'lukas-qto' or coalesce((storage.foldername(name))[1],'')<>'projects' or coalesce((storage.foldername(name))[3],'')<>'native-dwg-resave');
+
+revoke all on function private.lukas_drawing_native_dwg_resave_receipt(uuid) from public,anon,authenticated,service_role,lukas_drawing_collaboration;
+revoke all on function public.lukas_drawing_stage_native_dwg_resave(uuid,integer,uuid,jsonb),public.lukas_drawing_close_native_dwg_resave_upload(uuid,integer,uuid),public.lukas_drawing_publish_native_dwg_resave(uuid,integer,uuid),public.lukas_drawing_native_dwg_resave_receipt(jsonb,uuid),public.lukas_drawing_native_dwg_resave_download_descriptor(jsonb,uuid,text) from public,anon,authenticated,service_role,lukas_drawing_collaboration;
+grant execute on function public.lukas_drawing_stage_native_dwg_resave(uuid,integer,uuid,jsonb),public.lukas_drawing_close_native_dwg_resave_upload(uuid,integer,uuid),public.lukas_drawing_publish_native_dwg_resave(uuid,integer,uuid) to service_role;
+grant execute on function public.lukas_drawing_native_dwg_resave_receipt(jsonb,uuid),public.lukas_drawing_native_dwg_resave_download_descriptor(jsonb,uuid,text) to authenticated;
+
+create or replace function public.lukas_drawing_claim_native_dwg_resave(p_resaver_image_id text,p_lease_seconds integer default 300)
+returns jsonb language plpgsql security definer set search_path='' as $$
+declare candidate record; j public.lukas_drawing_native_dwg_resave_jobs%rowtype; context jsonb; t timestamptz; token uuid; expires timestamptz;
+begin
+  if not private.lukas_drawing_native_dwg_import_service() or p_resaver_image_id is null or p_resaver_image_id!~'^sha256:[0-9a-f]{64}$' or p_lease_seconds is null or p_lease_seconds not between 180 and 900
+  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  for candidate in select id,project_id from public.lukas_drawing_native_dwg_resave_jobs where resaver_image_id=p_resaver_image_id
+    and ((status in ('queued','retry_wait') and next_attempt_at<=pg_catalog.clock_timestamp()) or (status in ('processing','cancel_requested') and lease_expires_at<=pg_catalog.clock_timestamp())) order by created_at,id
+  loop
+    perform 1 from public.lukas_qto_projects where id=candidate.project_id for update skip locked;
+    if not found then continue; end if;
+    select * into j from public.lukas_drawing_native_dwg_resave_jobs where id=candidate.id for update skip locked;
+    if not found then continue; end if;
+    perform 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id order by attempt_number for update;
+    if exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and upload_state='open') then continue; end if;
+    t:=pg_catalog.clock_timestamp();
+    if j.resaver_image_id<>p_resaver_image_id or not ((j.status in ('queued','retry_wait') and j.next_attempt_at<=t) or (j.status in ('processing','cancel_requested') and j.lease_expires_at<=t)) then continue; end if;
+    if j.status='cancel_requested' then
+      update public.lukas_drawing_native_dwg_resave_attempts set outcome='cancelled',finished_at=t where job_id=j.id and attempt_number=j.attempt_count and outcome is null;
+      update public.lukas_drawing_native_dwg_resave_jobs set status='cancelled' where id=j.id;
+      continue;
+    end if;
+    if j.status='processing' then
+      update public.lukas_drawing_native_dwg_resave_attempts set outcome='expired',finished_at=t,failure_code='worker_interrupted' where job_id=j.id and attempt_number=j.attempt_count and outcome is null;
+    end if;
+    context:=private.lukas_drawing_native_dwg_resave_context(j.requested_by,j.scope);
+    if context->'source' is distinct from j.source or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true or j.attempt_count>=3 then
+      update public.lukas_drawing_native_dwg_resave_jobs set status='failed',failure_code=case when j.attempt_count>=3 then 'worker_interrupted' else 'authority_revoked' end where id=j.id;
+      continue;
+    end if;
+    token:=extensions.gen_random_uuid(); expires:=t+p_lease_seconds*interval '1 second';
+    insert into public.lukas_drawing_native_dwg_resave_attempts(job_id,project_id,attempt_number,lease_token,started_at,lease_expires_at) values(j.id,j.project_id,j.attempt_count+1,token,t,expires);
+    update public.lukas_drawing_native_dwg_resave_jobs set status='processing',attempt_count=j.attempt_count+1,lease_token=token,lease_expires_at=expires,failure_code=null where id=j.id;
+    return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',j.attempt_count+1,'leaseToken',token,'leaseExpiresAt',expires,'actorId',j.requested_by,'scope',j.scope,'source',j.source,'attestation',j.attestation,'payload',context->'payload');
+  end loop;
+  return null;
+end;
+$$;
+
+create or replace function public.lukas_drawing_fail_native_dwg_resave(p_job_id uuid,p_attempt_number integer,p_lease_token uuid,p_failure_code text,p_retryable boolean)
+returns jsonb language plpgsql security definer set search_path='' as $$
+declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype; context jsonb; state text; code text:=p_failure_code; t timestamptz;
+begin
+  if not private.lukas_drawing_native_dwg_import_service() or p_retryable is null or p_failure_code is null or p_failure_code not in ('source_unavailable','source_mismatch','resaver_failed','output_invalid','worker_interrupted','authority_revoked','upload_failed','publication_failed') then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
+  if j.id is null or j.status<>'processing' or p_attempt_number is distinct from j.attempt_count or p_lease_token is distinct from j.lease_token or j.lease_expires_at<=pg_catalog.clock_timestamp() then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+  perform 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id order by attempt_number for update;
+  if exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and upload_state='open')
+  then raise exception using errcode='PNR13',message='Native DWG resave upload is open'; end if;
+  context:=private.lukas_drawing_native_dwg_resave_context(j.requested_by,j.scope);
+  state:=case when p_retryable and p_failure_code in ('source_unavailable','resaver_failed','worker_interrupted','upload_failed','publication_failed') and j.attempt_count<3 then 'retry_wait' else 'failed' end;
+  if context->'source' is distinct from j.source or private.lukas_drawing_native_dwg_resave_attestation_valid(j.scope,j.attestation,context) is not true then state:='failed'; code:='authority_revoked'; end if;
+  t:=pg_catalog.clock_timestamp();
+  if j.lease_expires_at<=t then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+  update public.lukas_drawing_native_dwg_resave_attempts set outcome=state,finished_at=t,failure_code=code where job_id=j.id and attempt_number=j.attempt_count;
+  update public.lukas_drawing_native_dwg_resave_jobs set status=state,failure_code=code,next_attempt_at=t+j.attempt_count*interval '30 seconds' where id=j.id;
+  return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',j.attempt_count,'leaseToken',j.lease_token,'status',state);
+end;
+$$;
+
+create or replace function public.lukas_drawing_ack_native_dwg_resave_cancel(p_job_id uuid,p_attempt_number integer,p_lease_token uuid)
+returns jsonb language plpgsql security definer set search_path='' as $$
+declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype;
+begin
+  if not private.lukas_drawing_native_dwg_import_service() then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  j:=private.lukas_drawing_native_dwg_resave_locked_job(p_job_id);
+  if j.id is null or p_attempt_number is null or p_lease_token is null or p_attempt_number is distinct from j.attempt_count or p_lease_token is distinct from j.lease_token or j.status not in ('cancel_requested','cancelled') then raise exception using errcode='PNR13',message='Native DWG resave lease is stale'; end if;
+  perform 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id order by attempt_number for update;
+  if exists(select 1 from public.lukas_drawing_native_dwg_resave_attempts where job_id=j.id and upload_state='open')
+  then raise exception using errcode='PNR13',message='Native DWG resave upload is open'; end if;
+  if j.status='cancel_requested' then
+    update public.lukas_drawing_native_dwg_resave_attempts set outcome='cancelled',finished_at=pg_catalog.clock_timestamp() where job_id=j.id and attempt_number=j.attempt_count;
+    update public.lukas_drawing_native_dwg_resave_jobs set status='cancelled' where id=j.id;
+  end if;
+  return pg_catalog.jsonb_build_object('jobId',j.id,'attemptNumber',j.attempt_count,'leaseToken',j.lease_token,'status','cancelled');
+end;
+$$;
+
+create or replace function public.lukas_drawing_native_dwg_resave_status(p_scope jsonb,p_job_id uuid)
+returns jsonb language plpgsql security definer set search_path='' as $$
+declare j public.lukas_drawing_native_dwg_resave_jobs%rowtype;
+begin
+  if private.lukas_qto_verified_session() is not true or private.lukas_drawing_native_dwg_resave_source_for_actor((select auth.uid()),p_scope) is null
+  then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  select * into j from public.lukas_drawing_native_dwg_resave_jobs where project_id=(p_scope->>'projectId')::uuid and (p_job_id is null or id=p_job_id) and scope=p_scope order by created_at desc,id desc limit 1;
+  if not found and p_job_id is null then return null; end if;
+  if not found then raise exception using errcode='PNR11',message='Native DWG resave is unavailable'; end if;
+  return pg_catalog.jsonb_build_object('jobId',j.id,'requestId',j.request_id,'status',j.status,'attemptCount',j.attempt_count,'failureCode',j.failure_code,'hasChanges',j.attestation->'request'<>'null'::jsonb);
+end;
+$$;
+
+create or replace function private.lukas_qto_project_retention_storage_files(
+  p_project_id uuid
+) returns table(path text,sha256 text,byte_size bigint)
+language sql stable security invoker set search_path='' as $$
+  select artifact.path,artifact.sha256,artifact.byte_size
+  from (
+    select source.storage_path as path,source.sha256,source.byte_size
+    from public.lukas_qto_files source
+    where source.project_id=p_project_id and source.immutable
+    union all
+    select derivative.manifest_storage_path,derivative.manifest_sha256,
+      derivative.manifest_byte_size
+    from public.lukas_drawing_ifc_derivatives derivative
+    where derivative.project_id=p_project_id and derivative.status='ready'
+    union all
+    select derivative.geometry_storage_path,derivative.geometry_sha256,
+      derivative.geometry_byte_size
+    from public.lukas_drawing_ifc_derivatives derivative
+    where derivative.project_id=p_project_id and derivative.status='ready'
+    union all
+    select native.path,native.sha256,native.byte_size
+    from public.lukas_drawing_native_dwg_artifacts native
+    where native.project_id=p_project_id
+    union all
+    select resave.path,resave.sha256,resave.byte_size
+    from public.lukas_drawing_native_dwg_resave_artifacts resave
+    where resave.project_id=p_project_id
+  ) artifact
+  order by artifact.path,artifact.sha256,artifact.byte_size
+$$;
+
+create or replace function private.lukas_qto_project_retention_dependencies(
+  p_project_id uuid
+) returns jsonb language sql stable security definer set search_path='' as $$
+  select pg_catalog.jsonb_build_object(
+    'approvedDrawingRevisions',(select pg_catalog.count(*)
+      from public.lukas_drawing_revisions r where r.project_id=p_project_id
+        and r.status in('approved','superseded')),
+    'drawingRevisionApprovals',(select pg_catalog.count(*)
+      from public.lukas_drawing_revision_approvals a
+      where a.project_id=p_project_id and a.decision='approved'),
+    'drawingIssueApprovals',(select pg_catalog.count(*)
+      from public.lukas_drawing_issue_approvals a
+      where a.project_id=p_project_id and a.decision='approved'),
+    'approvedBoqVersions',(select pg_catalog.count(*)
+      from public.lukas_qto_boq_versions b where b.project_id=p_project_id
+        and b.status in('approved','superseded')),
+    'drawingQuantityLinks',(select pg_catalog.count(*)
+      from public.lukas_drawing_quantity_links q where q.project_id=p_project_id),
+    'drawingBoqLinks',(select pg_catalog.count(*)
+      from public.lukas_drawing_boq_links b where b.project_id=p_project_id),
+    'drawingMaterialLinks',(select pg_catalog.count(*)
+      from public.lukas_drawing_material_links m where m.project_id=p_project_id),
+    'materialTransactions',(select pg_catalog.count(*)
+      from public.lukas_qto_material_transactions m where m.project_id=p_project_id),
+    'publishedLibraryVersions',(select pg_catalog.count(*)
+      from public.lukas_drawing_library_versions v
+      where v.source_project_id=p_project_id
+        and v.status in('published','deprecated')),
+    'libraryImports',(select pg_catalog.count(*)
+      from public.lukas_drawing_library_imports i where i.project_id=p_project_id),
+    'immutableFiles',(select pg_catalog.count(*)
+      from public.lukas_qto_files f
+      where f.project_id=p_project_id and f.immutable),
+    'nativeDwgResaveJobs',(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_jobs where project_id=p_project_id),
+    'nativeDwgResaveArtifacts',(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_artifacts where project_id=p_project_id),
+    'nativeDwgResaveExports',(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_exports where project_id=p_project_id),
+    'nativeDwgResaveOpenUploads',(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_attempts where project_id=p_project_id and upload_state='open'),
+    'nativeDwgJobs',(select pg_catalog.count(*)
+      from public.lukas_drawing_native_dwg_jobs job
+      where job.project_id=p_project_id),
+    'nativeDwgArtifacts',(select pg_catalog.count(*)
+      from public.lukas_drawing_native_dwg_artifacts artifact
+      where artifact.project_id=p_project_id),
+    'nativeDwgOpenUploads',(select pg_catalog.count(*)
+      from public.lukas_drawing_native_dwg_attempts attempt
+      where attempt.project_id=p_project_id and attempt.upload_state='open')
+  )
+$$;
+
+create or replace function public.lukas_qto_purge_project(
+  p_organization_id uuid,p_project_id uuid,p_request_id uuid,p_reason text
+) returns jsonb language plpgsql security definer set search_path='' as $$
+declare v_project public.lukas_qto_projects%rowtype; v_dependencies jsonb;
+declare v_request public.lukas_qto_retention_events%rowtype;
+declare v_event public.lukas_qto_retention_events%rowtype;
+declare v_active_holds bigint; v_protected bigint; v_active_ifc_jobs bigint;
+declare v_active_native_jobs bigint; v_native_open_uploads bigint;
+declare v_sha text; v_status text; v_files jsonb; v_manifest_sha text;
+begin
+  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
+    raise exception using errcode='P7R07',
+      message='Trusted purge requires service authority';
+  end if;
+  if p_request_id is null
+    or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000
+  then raise exception using errcode='P7R05',
+    message='Purge request is invalid'; end if;
+  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
+    pg_catalog.jsonb_build_array(
+      'purge',p_organization_id,p_project_id,pg_catalog.btrim(p_reason)
+    )::text,'UTF8'),'sha256'),'hex');
+  perform pg_catalog.pg_advisory_xact_lock(
+    pg_catalog.hashtextextended(p_request_id::text,0)
+  );
+  select * into v_event from public.lukas_qto_retention_events event
+  where event.actor_id is null and event.request_id=p_request_id;
+  if found then
+    if v_event.request_sha256<>v_sha then
+      raise exception using errcode='P7R05',
+        message='Retention request identity was reused'; end if;
+    if v_event.event_type='project_purged' then
+      return pg_catalog.jsonb_build_object(
+        'status','PURGED','eventId',v_event.id,
+        'dependencies',v_event.evidence->'dependencies'
+      );
+    elsif v_event.event_type='purge_storage_ready' then
+      return pg_catalog.jsonb_build_object(
+        'status','STORAGE_REQUIRED','eventId',v_event.id,
+        'manifestSha256',v_event.evidence->>'manifestSha256',
+        'files',v_event.evidence->'files',
+        'dependencies',v_event.evidence->'dependencies'
+      );
+    end if;
+    return pg_catalog.jsonb_build_object(
+      'status','HELD','reason',v_event.evidence->>'status',
+      'eventId',v_event.id,'dependencies',v_event.evidence->'dependencies'
+    );
+  end if;
+
+  select * into v_project from public.lukas_qto_projects project
+  where project.id=p_project_id and project.organization_id=p_organization_id
+  for update;
+  if not found then raise exception using errcode='P7R06',
+    message='Project retention target is unavailable'; end if;
+  perform job.id from public.lukas_drawing_ifc_derivative_jobs job
+  where job.project_id=p_project_id order by job.id for update;
+  perform job.id from public.lukas_drawing_native_dwg_jobs job
+  where job.project_id=p_project_id order by job.id for update;
+  perform job.id from public.lukas_drawing_native_dwg_resave_jobs job
+  where job.project_id=p_project_id order by job.id for update;
+  select pg_catalog.count(*) into v_active_ifc_jobs
+  from public.lukas_drawing_ifc_derivative_jobs job
+  where job.project_id=p_project_id
+    and job.status in ('queued','processing','retry_wait');
+  select pg_catalog.count(*) into v_active_native_jobs
+  from public.lukas_drawing_native_dwg_jobs job
+  where job.project_id=p_project_id
+    and job.status in ('queued','processing','retry_wait');
+  select pg_catalog.count(*) into v_native_open_uploads
+  from public.lukas_drawing_native_dwg_attempts attempt
+  where attempt.project_id=p_project_id and attempt.upload_state='open';
+
+  v_active_native_jobs:=v_active_native_jobs+(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_jobs where project_id=p_project_id and status in ('queued','processing','retry_wait','cancel_requested'));
+  v_native_open_uploads:=v_native_open_uploads+(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_attempts where project_id=p_project_id and upload_state='open');
+  select * into v_request from public.lukas_qto_retention_events event
+  where event.organization_id=p_organization_id and event.project_id=p_project_id
+    and event.event_type='deletion_requested'
+  order by event.created_at desc,event.id desc limit 1;
+  if not found then raise exception using errcode='P7R08',
+    message='Project deletion was not requested'; end if;
+  select pg_catalog.count(*) into v_active_holds
+  from public.lukas_qto_retention_events placed
+  where placed.organization_id=p_organization_id
+    and placed.project_id=p_project_id
+    and placed.event_type='legal_hold_placed'
+    and not exists(select 1 from public.lukas_qto_retention_events released
+      where released.event_type='legal_hold_released'
+        and released.releases_event_id=placed.id);
+  v_dependencies:=private.lukas_qto_project_retention_dependencies(p_project_id);
+  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
+    'path',artifact.path,'sha256',artifact.sha256,'byteSize',artifact.byte_size
+  ) order by artifact.path,artifact.sha256,artifact.byte_size),'[]'::jsonb)
+  into v_files
+  from private.lukas_qto_project_retention_storage_files(p_project_id) artifact;
+  v_manifest_sha:=pg_catalog.encode(extensions.digest(
+    pg_catalog.convert_to(v_files::text,'UTF8'),'sha256'),'hex');
+  v_protected:=(v_dependencies->>'approvedDrawingRevisions')::bigint
+    +(v_dependencies->>'drawingRevisionApprovals')::bigint
+    +(v_dependencies->>'drawingIssueApprovals')::bigint
+    +(v_dependencies->>'approvedBoqVersions')::bigint
+    +(v_dependencies->>'drawingQuantityLinks')::bigint
+    +(v_dependencies->>'drawingBoqLinks')::bigint
+    +(v_dependencies->>'drawingMaterialLinks')::bigint
+    +(v_dependencies->>'materialTransactions')::bigint
+    +(v_dependencies->>'publishedLibraryVersions')::bigint
+    +(v_dependencies->>'libraryImports')::bigint;
+  v_status:=case
+    when pg_catalog.now()<v_request.purge_after then 'retention_not_expired'
+    when v_active_holds>0 then 'legal_hold_active'
+    when v_protected>0 then 'protected_dependencies'
+    when v_active_ifc_jobs>0 then 'active_ifc_derivative_jobs'
+    when v_active_native_jobs>0 then 'active_native_dwg_jobs'
+    when v_native_open_uploads>0 then 'native_dwg_uploads_open'
+    when pg_catalog.jsonb_array_length(v_files)>0
+      then 'storage_deletion_required'
+    else 'purged'
+  end;
+  insert into public.lukas_qto_retention_events(
+    organization_id,project_id,event_type,request_id,request_sha256,
+    reason,evidence,actor_id
+  ) values(
+    p_organization_id,p_project_id,
+    case when v_status='purged' then 'project_purged'
+      when v_status='storage_deletion_required' then 'purge_storage_ready'
+      else 'purge_denied' end,
+    p_request_id,v_sha,pg_catalog.btrim(p_reason),
+    pg_catalog.jsonb_build_object(
+      'status',v_status,'requestEventId',v_request.id,
+      'purgeAfter',v_request.purge_after,'activeLegalHolds',v_active_holds,
+      'activeIfcDerivativeJobs',v_active_ifc_jobs,
+      'activeNativeDwgJobs',v_active_native_jobs,
+      'nativeDwgOpenUploads',v_native_open_uploads,
+      'dependencies',v_dependencies,'manifestSha256',v_manifest_sha,
+      'files',v_files
+    ),null
+  ) returning * into v_event;
+  if v_status='storage_deletion_required' then
+    return pg_catalog.jsonb_build_object(
+      'status','STORAGE_REQUIRED','eventId',v_event.id,
+      'manifestSha256',v_manifest_sha,'files',v_files,
+      'dependencies',v_dependencies
+    );
+  end if;
+  if v_status<>'purged' then
+    return pg_catalog.jsonb_build_object(
+      'status','HELD','reason',v_status,'eventId',v_event.id,
+      'dependencies',v_dependencies
+    );
+  end if;
+  perform pg_catalog.set_config(
+    'app.lukas_retention_purge_project',p_project_id::text,true
+  );
+  delete from public.lukas_qto_projects project
+  where project.id=p_project_id and project.organization_id=p_organization_id;
+  return pg_catalog.jsonb_build_object(
+    'status','PURGED','eventId',v_event.id,'dependencies',v_dependencies
+  );
+end;
+$$;
+
+create or replace function public.lukas_qto_finalize_project_purge(
+  p_organization_id uuid,p_project_id uuid,p_ready_event_id uuid,
+  p_manifest_sha256 text,p_request_id uuid,p_reason text
+) returns jsonb language plpgsql security definer set search_path='' as $$
+declare v_project public.lukas_qto_projects%rowtype;
+declare v_ready public.lukas_qto_retention_events%rowtype;
+declare v_event public.lukas_qto_retention_events%rowtype;
+declare v_dependencies jsonb; v_files jsonb; v_paths text[];
+declare v_sha text; v_storage_exists boolean; v_active_ifc_jobs bigint;
+declare v_active_native_jobs bigint; v_native_open_uploads bigint;
+declare v_derivative_prefix text; v_native_prefix text;
+begin
+  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
+    raise exception using errcode='P7R07',
+      message='Trusted purge requires service authority';
+  end if;
+  if p_ready_event_id is null or p_request_id is null
+    or p_manifest_sha256!~'^[0-9a-f]{64}$'
+    or pg_catalog.char_length(pg_catalog.btrim(p_reason)) not between 1 and 2000
+  then raise exception using errcode='P7R05',
+    message='Purge finalization request is invalid'; end if;
+  v_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
+    pg_catalog.jsonb_build_array(
+      'finalize_purge',p_organization_id,p_project_id,p_ready_event_id,
+      p_manifest_sha256,pg_catalog.btrim(p_reason)
+    )::text,'UTF8'),'sha256'),'hex');
+  perform pg_catalog.pg_advisory_xact_lock(
+    pg_catalog.hashtextextended(p_request_id::text,0)
+  );
+  select * into v_event from public.lukas_qto_retention_events event
+  where event.actor_id is null and event.request_id=p_request_id;
+  if found then
+    if v_event.request_sha256<>v_sha then
+      raise exception using errcode='P7R05',
+        message='Retention request identity was reused'; end if;
+    return pg_catalog.jsonb_build_object(
+      'status','PURGED','eventId',v_event.id,
+      'dependencies',v_event.evidence->'dependencies'
+    );
+  end if;
+
+  select * into v_project from public.lukas_qto_projects project
+  where project.id=p_project_id and project.organization_id=p_organization_id
+  for update;
+  if not found then raise exception using errcode='P7R06',
+    message='Project retention target is unavailable'; end if;
+  perform job.id from public.lukas_drawing_ifc_derivative_jobs job
+  where job.project_id=p_project_id order by job.id for update;
+  perform job.id from public.lukas_drawing_native_dwg_jobs job
+  where job.project_id=p_project_id order by job.id for update;
+  perform job.id from public.lukas_drawing_native_dwg_resave_jobs job
+  where job.project_id=p_project_id order by job.id for update;
+  select pg_catalog.count(*) into v_active_ifc_jobs
+  from public.lukas_drawing_ifc_derivative_jobs job
+  where job.project_id=p_project_id
+    and job.status in ('queued','processing','retry_wait');
+  select pg_catalog.count(*) into v_active_native_jobs
+  from public.lukas_drawing_native_dwg_jobs job
+  where job.project_id=p_project_id
+    and job.status in ('queued','processing','retry_wait');
+  select pg_catalog.count(*) into v_native_open_uploads
+  from public.lukas_drawing_native_dwg_attempts attempt
+  where attempt.project_id=p_project_id and attempt.upload_state='open';
+  v_active_native_jobs:=v_active_native_jobs+(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_jobs where project_id=p_project_id and status in ('queued','processing','retry_wait','cancel_requested'));
+  v_native_open_uploads:=v_native_open_uploads+(select pg_catalog.count(*) from public.lukas_drawing_native_dwg_resave_attempts where project_id=p_project_id and upload_state='open');
+  if v_active_ifc_jobs>0 then raise exception using errcode='P7R08',
+    message='Project IFC derivative jobs changed'; end if;
+  if v_active_native_jobs>0 or v_native_open_uploads>0 then
+    raise exception using errcode='P7R08',
+      message='Project native DWG export state changed'; end if;
+
+  select * into v_ready from public.lukas_qto_retention_events event
+  where event.id=p_ready_event_id and event.organization_id=p_organization_id
+    and event.project_id=p_project_id
+    and event.event_type='purge_storage_ready';
+  if not found or v_ready.evidence->>'manifestSha256'<>p_manifest_sha256 then
+    raise exception using errcode='P7R05',
+      message='Purge storage manifest is unavailable'; end if;
+  select
+    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
+      'path',artifact.path,'sha256',artifact.sha256,
+      'byteSize',artifact.byte_size
+    ) order by artifact.path,artifact.sha256,artifact.byte_size),'[]'::jsonb),
+    coalesce(pg_catalog.array_agg(
+      artifact.path order by artifact.path,artifact.sha256,artifact.byte_size
+    ),array[]::text[])
+  into v_files,v_paths
+  from private.lukas_qto_project_retention_storage_files(p_project_id) artifact;
+  if pg_catalog.encode(extensions.digest(
+    pg_catalog.convert_to(v_files::text,'UTF8'),'sha256'),'hex'
+  )<>p_manifest_sha256 then raise exception using errcode='P7R05',
+    message='Purge storage manifest changed'; end if;
+  v_dependencies:=private.lukas_qto_project_retention_dependencies(p_project_id);
+  if ((v_dependencies->>'approvedDrawingRevisions')::bigint
+      +(v_dependencies->>'drawingRevisionApprovals')::bigint
+      +(v_dependencies->>'drawingIssueApprovals')::bigint
+      +(v_dependencies->>'approvedBoqVersions')::bigint
+      +(v_dependencies->>'drawingQuantityLinks')::bigint
+      +(v_dependencies->>'drawingBoqLinks')::bigint
+      +(v_dependencies->>'drawingMaterialLinks')::bigint
+      +(v_dependencies->>'materialTransactions')::bigint
+      +(v_dependencies->>'publishedLibraryVersions')::bigint
+      +(v_dependencies->>'libraryImports')::bigint)>0
+    or exists(select 1 from public.lukas_qto_retention_events placed
+      where placed.organization_id=p_organization_id
+        and placed.project_id=p_project_id
+        and placed.event_type='legal_hold_placed'
+        and not exists(select 1 from public.lukas_qto_retention_events released
+          where released.event_type='legal_hold_released'
+            and released.releases_event_id=placed.id))
+  then raise exception using errcode='P7R08',
+    message='Project purge dependencies changed'; end if;
+  if pg_catalog.to_regclass('storage.objects') is null then
+    raise exception using errcode='P7R09',
+      message='Storage deletion confirmation authority unavailable'; end if;
+  execute 'select exists(select 1 from storage.objects '
+    ||'where bucket_id=''lukas-qto'' and name=any($1))'
+  into v_storage_exists using v_paths;
+  if v_storage_exists then raise exception using errcode='P7R09',
+    message='Immutable Storage deletion is incomplete'; end if;
+  v_derivative_prefix:='projects/'||p_project_id::text||'/ifc-derivatives/';
+  execute 'select exists(select 1 from storage.objects '
+    ||'where bucket_id=''lukas-qto'' '
+    ||'and pg_catalog.left(name,pg_catalog.char_length($1))=$1)'
+  into v_storage_exists using v_derivative_prefix;
+  if v_storage_exists then raise exception using errcode='P7R09',
+    message='IFC derivative Storage deletion is incomplete'; end if;
+  v_native_prefix:='projects/'||p_project_id::text||'/native-dwg/';
+  execute 'select exists(select 1 from storage.objects '
+    ||'where bucket_id=''lukas-qto'' '
+    ||'and pg_catalog.left(name,pg_catalog.char_length($1))=$1)'
+  into v_storage_exists using v_native_prefix;
+  if v_storage_exists then raise exception using errcode='P7R09',
+    message='Native DWG Storage deletion is incomplete'; end if;
+  v_native_prefix:='projects/'||p_project_id::text||'/native-dwg-resave/';
+  execute 'select exists(select 1 from storage.objects '
+    ||'where bucket_id=''lukas-qto'' '
+    ||'and pg_catalog.left(name,pg_catalog.char_length($1))=$1)'
+  into v_storage_exists using v_native_prefix;
+  if v_storage_exists then raise exception using errcode='P7R09',
+    message='Native DWG resave Storage deletion is incomplete'; end if;
+  insert into public.lukas_qto_retention_events(
+    organization_id,project_id,event_type,request_id,request_sha256,
+    reason,evidence,actor_id
+  ) values(
+    p_organization_id,p_project_id,'project_purged',p_request_id,v_sha,
+    pg_catalog.btrim(p_reason),pg_catalog.jsonb_build_object(
+      'status','purged','readyEventId',v_ready.id,
+      'manifestSha256',p_manifest_sha256,'files',v_files,
+      'dependencies',v_dependencies
+    ),null
+  ) returning * into v_event;
+  perform pg_catalog.set_config(
+    'app.lukas_retention_purge_project',p_project_id::text,true
+  );
+  delete from public.lukas_qto_projects project
+  where project.id=p_project_id and project.organization_id=p_organization_id;
+  return pg_catalog.jsonb_build_object(
+    'status','PURGED','eventId',v_event.id,'dependencies',v_dependencies
+  );
+end;
+$$;
+
+commit;
```

### platform/tests/drawing-native-dwg-resave-artifact-jobs.test.mjs

```diff
diff --git a/platform/tests/drawing-native-dwg-resave-artifact-jobs.test.mjs b/platform/tests/drawing-native-dwg-resave-artifact-jobs.test.mjs
new file mode 100644
index 0000000..e3ef4ec
--- /dev/null
+++ b/platform/tests/drawing-native-dwg-resave-artifact-jobs.test.mjs
@@ -0,0 +1,237 @@
+import assert from "node:assert/strict";
+import test from "node:test";
+import { fileURLToPath } from "node:url";
+import { createServer } from "vite";
+import { resaveArtifactFixture } from "./fixtures/drawing-native-dwg-resave-artifacts.mjs";
+const vite = await createServer({
+  appType: "custom",
+  configFile: false,
+  logLevel: "silent",
+  resolve: {
+    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
+  },
+  server: { middlewareMode: true },
+});
+test.after(() => vite.close());
+const jobs = await vite.ssrLoadModule(
+  "/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts",
+);
+const adapters = await vite
+  .ssrLoadModule(
+    "/app/lukas/lib/drawing-native-dwg-resave-artifact-jobs.server.ts",
+  )
+  .catch(() => ({}));
+const { buildNativeDrawingDwgResaveAttestation } = await vite.ssrLoadModule(
+  "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
+);
+const core = await vite.ssrLoadModule(
+  "/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts",
+);
+const f = await resaveArtifactFixture(buildNativeDrawingDwgResaveAttestation);
+const { metadata } = await core.buildNativeDrawingDwgResaveArtifacts(
+  f.claim,
+  f.result,
+  f.imageId,
+);
+const { scope, jobId, actorId, attemptNumber } = f.claim;
+const receipt = {
+  schemaVersion: "1hk-dwg-resave-receipt/1",
+  jobId,
+  attemptNumber,
+  scope,
+  resaverImageId: f.imageId,
+  sourceSha256: f.claim.source.sha256,
+  qualification: "experimental-unqualified",
+  persistenceAuthority: "not-issued",
+  artifacts: metadata,
+  createdAt: "2026-09-06T00:00:00.000Z",
+};
+const descriptor = {
+  jobId,
+  attemptNumber,
+  kind: "dwg",
+  bucket: "lukas-qto",
+  sha256: metadata[0].sha256,
+  byteSize: metadata[0].byteSize,
+  path: `projects/${scope.projectId}/native-dwg-resave/${jobId}/2/${metadata[0].sha256}/resaved.dwg`,
+};
+function client(
+  name,
+  args,
+  response,
+  { error = null, afterActor = actorId } = {},
+) {
+  let authCount = 0;
+  return {
+    auth: {
+      getUser: async () => ({
+        data: {
+          user: {
+            id: authCount++ === 0 ? actorId : afterActor,
+            is_anonymous: false,
+          },
+        },
+        error: null,
+      }),
+    },
+    rpc(actualName, actualArgs) {
+      assert.equal(actualName, name);
+      assert.deepEqual(actualArgs, args);
+      return {
+        abortSignal: async (signal) => {
+          assert.ok(signal instanceof AbortSignal);
+          return { data: response, error };
+        },
+      };
+    },
+  };
+}
+const invalid = (e) => e.kind === "invalid" || e.kind === "unavailable";
+test("receipt adapters require complete ordered receipt and exact normalized authorized scope", async () => {
+  assert.equal(typeof adapters.getNativeDrawingDwgResaveReceipt, "function");
+  const args = { p_scope: scope, p_job_id: jobId };
+  const call = (response, options) =>
+    adapters.getNativeDrawingDwgResaveReceipt(
+      client(
+        "lukas_drawing_native_dwg_resave_receipt",
+        args,
+        response,
+        options,
+      ),
+      scope,
+      jobId,
+    );
+  assert.deepEqual(await call(receipt), receipt);
+  for (const bad of [
+    null,
+    { ...receipt, leaseToken: f.claim.leaseToken },
+    { ...receipt, jobId: actorId },
+    {
+      ...receipt,
+      scope: { ...scope, revisionVersion: scope.revisionVersion + 1 },
+    },
+    { ...receipt, artifacts: [...metadata].reverse() },
+    { ...receipt, artifacts: metadata.slice(1) },
+  ])
+    await assert.rejects(call(bad), invalid);
+  for (const error of [undefined, false, 0, ""]) {
+    const c = client("lukas_drawing_native_dwg_resave_receipt", args, receipt);
+    c.rpc = () => ({ abortSignal: async () => ({ data: receipt, error }) });
+    await assert.rejects(
+      adapters.getNativeDrawingDwgResaveReceipt(c, scope, jobId),
+      invalid,
+    );
+  }
+  await assert.rejects(call(receipt, { afterActor: jobId }), invalid);
+  const uppercase = Object.fromEntries(
+    Object.entries(scope).map(([k, v]) => [
+      k,
+      k.endsWith("Id") ? v.toUpperCase() : v,
+    ]),
+  );
+  assert.deepEqual(
+    await adapters.getNativeDrawingDwgResaveReceipt(
+      client("lukas_drawing_native_dwg_resave_receipt", args, receipt),
+      uppercase,
+      jobId.toUpperCase(),
+    ),
+    receipt,
+  );
+});
+test("download descriptor binds every path component to authorized project/job/attempt/kind/hash", async () => {
+  assert.equal(
+    typeof adapters.getNativeDrawingDwgResaveDownloadDescriptor,
+    "function",
+  );
+  const args = { p_scope: scope, p_job_id: jobId, p_kind: "dwg" };
+  const call = (response) =>
+    adapters.getNativeDrawingDwgResaveDownloadDescriptor(
+      client(
+        "lukas_drawing_native_dwg_resave_download_descriptor",
+        args,
+        response,
+      ),
+      scope,
+      jobId,
+      "dwg",
+    );
+  assert.deepEqual(await call(descriptor), descriptor);
+  for (const bad of [
+    { ...descriptor, path: descriptor.path.replace(scope.projectId, actorId) },
+    { ...descriptor, path: descriptor.path.replace("/2/", "/1/") },
+    {
+      ...descriptor,
+      path: descriptor.path.replace("resaved.dwg", "native-report.json"),
+    },
+    {
+      ...descriptor,
+      path: descriptor.path.replace(metadata[0].sha256, "a".repeat(64)),
+    },
+    { ...descriptor, kind: "report" },
+    { ...descriptor, jobId: actorId },
+    { ...descriptor, source: "private" },
+    { ...descriptor, byteSize: 209715201 },
+  ])
+    await assert.rejects(call(bad), invalid);
+});
+test("latest status authenticates before lookup, accepts null and completed with existing public shape", async () => {
+  assert.equal(typeof jobs.getLatestNativeDrawingDwgResaveStatus, "function");
+  const name = "lukas_drawing_native_dwg_resave_status",
+    args = { p_scope: scope, p_job_id: null };
+  assert.equal(
+    await jobs.getLatestNativeDrawingDwgResaveStatus(
+      client(name, args, null),
+      scope,
+    ),
+    null,
+  );
+  const completed = {
+    jobId,
+    requestId: actorId,
+    hasChanges: true,
+    status: "completed",
+    attemptCount: 2,
+    failureCode: null,
+  };
+  assert.deepEqual(
+    await jobs.getLatestNativeDrawingDwgResaveStatus(
+      client(name, args, completed),
+      scope,
+    ),
+    completed,
+  );
+  for (const failureCode of ["upload_failed", "publication_failed"])
+    assert.equal(
+      (
+        await jobs.getLatestNativeDrawingDwgResaveStatus(
+          client(name, args, { ...completed, status: "failed", failureCode }),
+          scope,
+        )
+      ).failureCode,
+      failureCode,
+    );
+  for (const response of [
+    { ...completed, extra: true },
+    { ...completed, status: "completed", attemptCount: 0 },
+  ])
+    await assert.rejects(
+      jobs.getLatestNativeDrawingDwgResaveStatus(
+        client(name, args, response),
+        scope,
+      ),
+      invalid,
+    );
+  const unauth = client(name, args, null);
+  unauth.auth.getUser = async () => ({ data: { user: null }, error: null });
+  unauth.rpc = () => assert.fail("unauthenticated request reached RPC");
+  await assert.rejects(
+    jobs.getLatestNativeDrawingDwgResaveStatus(unauth, scope),
+    invalid,
+  );
+  const c = client(name, args, null);
+  c.rpc = () => assert.fail("strict invalid scope reached RPC");
+  await assert.rejects(
+    jobs.getLatestNativeDrawingDwgResaveStatus(c, { ...scope, extra: true }),
+    invalid,
+  );
+});
```

### platform/tests/fixtures/drawing-native-dwg-resave-publication-database.mjs

```diff
diff --git a/platform/tests/fixtures/drawing-native-dwg-resave-publication-database.mjs b/platform/tests/fixtures/drawing-native-dwg-resave-publication-database.mjs
new file mode 100644
index 0000000..4bdc273
--- /dev/null
+++ b/platform/tests/fixtures/drawing-native-dwg-resave-publication-database.mjs
@@ -0,0 +1,772 @@
+import assert from "node:assert/strict";
+import { createHash, randomUUID } from "node:crypto";
+import { fileURLToPath } from "node:url";
+import { createServer } from "vite";
+import { createApprovedNativeDwgResaveRevision } from "./drawing-native-dwg-resave-jobs-database.mjs";
+
+const imageId = "sha256:" + "c".repeat(64);
+const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
+const session = (sql, role, actor, callback, jwtRole = role) =>
+  sql.begin(async (tx) => {
+    assert.ok(["authenticated", "service_role", "anon"].includes(role));
+    await tx.unsafe(`set local role "${role}"`);
+    await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: jwtRole, sub: actor, is_anonymous: false })},true)`;
+    await tx`select set_config('statement_timeout','10000',true)`;
+    return callback(tx);
+  });
+const denied = (promise, code) =>
+  assert.rejects(promise, (e) => {
+    assert.equal(e.code, code, e.message);
+    return true;
+  });
+
+const asRole = (tx, role, actor, fn) =>
+  tx.savepoint(async (sp) => {
+    const [before] =
+      await sp`select current_user role,current_setting('request.jwt.claims',true) claims`;
+    assert.ok(
+      ["postgres", "authenticated", "service_role"].includes(before.role),
+    );
+    assert.ok(["authenticated", "service_role"].includes(role));
+    await sp.unsafe(`set local role "${role}"`);
+    await sp`select set_config('request.jwt.claims',${JSON.stringify({ role, sub: actor, is_anonymous: false })},true)`;
+    const result = await fn(sp);
+    await sp.unsafe(`set local role "${before.role}"`);
+    await sp`select set_config('request.jwt.claims',${before.claims ?? ""},true)`;
+    return result;
+  });
+
+// These are database authority proofs; literal output metadata is not native/Storage evidence.
+// Removing the durable open-session fence or accepting changed metadata must fail these assertions.
+export async function proveNativeDwgResavePublicationAuthority({
+  owner,
+  workerA,
+  workerB,
+  ids,
+  imported,
+}) {
+  const { editedScope: scope } = await createApprovedNativeDwgResaveRevision({
+    owner,
+    ids,
+    imported,
+  });
+  const actor = ids.users.editor;
+  const vite = await createServer({
+    appType: "custom",
+    configFile: false,
+    logLevel: "silent",
+    resolve: {
+      alias: { "~": fileURLToPath(new URL("../../app", import.meta.url)) },
+    },
+    server: { middlewareMode: true },
+  });
+  try {
+    const { buildNativeDrawingDwgResaveAttestation: build } =
+      await vite.ssrLoadModule(
+        "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
+      );
+    const core = await vite.ssrLoadModule(
+      "/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts",
+    );
+    const [source] = await session(
+      owner,
+      "authenticated",
+      actor,
+      (tx) =>
+        tx`select public.lukas_qto_drawing_native_dwg_resave_source(${tx.json(scope)}) value`,
+    );
+    const attestation = await build(scope, source.value, imageId);
+    const metadata = [
+      { kind: "dwg", sha256: hash("AC1024database-proof"), byteSize: 19 },
+      {
+        kind: "edit_request",
+        sha256: attestation.request.sha256,
+        byteSize: attestation.request.byteSize,
+      },
+      {
+        kind: "authority",
+        sha256: attestation.authority.sha256,
+        byteSize: attestation.authority.byteSize,
+      },
+      { kind: "report", sha256: hash("database-proof"), byteSize: 14 },
+    ];
+    const service = (callback, sql = owner, jwtRole = "service_role") =>
+      session(sql, "service_role", null, callback, jwtRole).then(
+        ([r]) => r.value,
+      );
+    const admit = () =>
+      service(
+        (tx) =>
+          tx`select public.lukas_drawing_admit_native_dwg_resave(${actor}::uuid,${tx.json(scope)},${randomUUID()}::uuid,${tx.json(attestation)}) value`,
+      );
+    const claim = (sql = owner) =>
+      service(
+        (tx) =>
+          tx`select public.lukas_drawing_claim_native_dwg_resave(${imageId},300) value`,
+        sql,
+      );
+    const stage = (c, m = metadata, sql = owner) =>
+      service(
+        (tx) =>
+          tx`select public.lukas_drawing_stage_native_dwg_resave(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid,${tx.json(m)}) value`,
+        sql,
+      );
+    const close = (c) =>
+      service(
+        (tx) =>
+          tx`select public.lukas_drawing_close_native_dwg_resave_upload(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid) value`,
+      );
+    const publish = (c, sql = owner) =>
+      service(
+        (tx) =>
+          tx`select public.lukas_drawing_publish_native_dwg_resave(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid) value`,
+        sql,
+      );
+    const job = await admit();
+    const c = await claim();
+    assert.equal(c.jobId, job.jobId);
+    const staged = await stage(c);
+    assert.equal(staged.uploadState, "open");
+    assert.deepEqual(await stage(c), staged);
+    await denied(
+      stage(
+        c,
+        metadata.map((m, i) =>
+          i === 0 ? { ...m, sha256: "a".repeat(64) } : m,
+        ),
+      ),
+      "PNR12",
+    );
+    await denied(publish(c), "PNR13");
+    assert.deepEqual(await close(c), {
+      jobId: c.jobId,
+      attemptNumber: 1,
+      leaseToken: c.leaseToken,
+      uploadState: "closed",
+    });
+    assert.equal((await stage(c)).uploadState, "closed");
+    const receipt = await publish(c);
+    assert.equal(receipt.schemaVersion, "1hk-dwg-resave-receipt/1");
+    assert.equal(receipt.attemptNumber, 1);
+    assert.deepEqual(receipt.scope, scope);
+    assert.deepEqual(receipt.artifacts, metadata);
+    assert.deepEqual(
+      core.validateNativeDrawingDwgResaveReceipt(receipt, c, metadata),
+      receipt,
+    );
+    assert.deepEqual(await publish(c), receipt);
+
+    const readReceipt = (id = c.jobId, who = ids.users.viewer, s = scope) =>
+      session(
+        owner,
+        "authenticated",
+        who,
+        (tx) =>
+          tx`select public.lukas_drawing_native_dwg_resave_receipt(${tx.json(s)},${id}::uuid) value`,
+      ).then(([r]) => r.value);
+    const descriptor = (id, kind, who = ids.users.viewer, s = scope) =>
+      session(
+        owner,
+        "authenticated",
+        who,
+        (tx) =>
+          tx`select public.lukas_drawing_native_dwg_resave_download_descriptor(${tx.json(s)},${id}::uuid,${kind}) value`,
+      ).then(([r]) => r.value);
+    const status = (id = null, who = actor, s = scope) =>
+      session(
+        owner,
+        "authenticated",
+        who,
+        (tx) =>
+          tx`select public.lukas_drawing_native_dwg_resave_status(${tx.json(s)},${id}::uuid) value`,
+      ).then(([r]) => r.value);
+    const cancel = (c, sql = owner) =>
+      session(
+        sql,
+        "authenticated",
+        actor,
+        (tx) =>
+          tx`select public.lukas_drawing_cancel_native_dwg_resave(${tx.json(scope)},${c.jobId}::uuid) value`,
+      ).then(([r]) => r.value);
+    const ack = (c) =>
+      service(
+        (tx) =>
+          tx`select public.lukas_drawing_ack_native_dwg_resave_cancel(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid) value`,
+      );
+    const fail = (c, code = "upload_failed", retryable = true) =>
+      service(
+        (tx) =>
+          tx`select public.lukas_drawing_fail_native_dwg_resave(${c.jobId}::uuid,${c.attemptNumber},${c.leaseToken}::uuid,${code},${retryable}) value`,
+      );
+    const expire = (c) =>
+      owner`update public.lukas_drawing_native_dwg_resave_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${c.jobId}::uuid`;
+    const start = async () => {
+      const j = await admit();
+      const claimValue = await claim();
+      assert.equal(claimValue.jobId, j.jobId);
+      return claimValue;
+    };
+    const original =
+      await owner`select source from public.lukas_drawing_native_dwg_import_jobs where id=${imported.jobId}::uuid`;
+    const snapshots =
+      await owner`select * from public.lukas_drawing_snapshots where revision_id=${scope.revisionId}::uuid`;
+    assert.deepEqual(await readReceipt(), receipt);
+    assert.equal((await status()).status, "completed");
+    await denied(status(randomUUID()), "PNR11");
+    const emptyScope = (
+      await createApprovedNativeDwgResaveRevision({ owner, ids, imported })
+    ).editedScope;
+    assert.equal(await status(null, actor, emptyScope), null);
+    await denied(status(null, ids.users.outsider, emptyScope), "PNR11");
+    for (const [i, kind] of [
+      "dwg",
+      "edit_request",
+      "authority",
+      "report",
+    ].entries()) {
+      const d = await descriptor(c.jobId, kind);
+      assert.deepEqual(d, {
+        jobId: c.jobId,
+        attemptNumber: 1,
+        kind,
+        bucket: "lukas-qto",
+        path: staged.artifacts[i].path,
+        sha256: metadata[i].sha256,
+        byteSize: metadata[i].byteSize,
+      });
+    }
+    await denied(readReceipt(c.jobId, ids.users.outsider), "PNR11");
+    await denied(
+      readReceipt(c.jobId, actor, {
+        ...scope,
+        revisionVersion: scope.revisionVersion + 1,
+      }),
+      "PNR11",
+    );
+    await denied(descriptor(c.jobId, "source_manifest"), "PNR11");
+    await denied(publish({ ...c, leaseToken: randomUUID() }), "PNR13");
+    // Committed receipts remain exact even when the original lease has elapsed.
+    const rollback = Symbol("rolled back publication corruption");
+    const probe = async (fn) => {
+      try {
+        await owner.begin(async (tx) => {
+          await fn(tx);
+          throw rollback;
+        });
+      } catch (e) {
+        if (e !== rollback) throw e;
+      }
+    };
+    const asService = (tx, fn) => asRole(tx, "service_role", null, fn);
+    await probe(async (tx) => {
+      await tx`set local session_replication_role=replica`;
+      await tx`update public.lukas_drawing_native_dwg_resave_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${c.jobId}::uuid`;
+      await tx`update public.lukas_drawing_native_dwg_resave_attempts set lease_expires_at=clock_timestamp()-interval '1 second' where job_id=${c.jobId}::uuid`;
+      await tx`set local session_replication_role=origin`;
+      const [r] = await asService(
+        tx,
+        (sp) =>
+          sp`select public.lukas_drawing_publish_native_dwg_resave(${c.jobId}::uuid,1,${c.leaseToken}::uuid) value`,
+      );
+      assert.deepEqual(r.value, receipt);
+    });
+
+    const open = await start();
+    await denied(close(open), "PNR13");
+    for (const invalid of [
+      null,
+      {},
+      metadata.slice(1),
+      [metadata[1], metadata[0], metadata[2], metadata[3]],
+      metadata.map((m, i) => (i === 1 ? { ...m, sha256: "0".repeat(64) } : m)),
+      metadata.map((m, i) =>
+        i === 2 ? { ...m, byteSize: m.byteSize + 1 } : m,
+      ),
+      metadata.map((m, i) => (i === 0 ? { ...m, path: "private" } : m)),
+      metadata.map((m, i) => (i === 0 ? { ...m, byteSize: 209715201 } : m)),
+      metadata.map((m, i) => (i === 0 ? { ...m, byteSize: 5 } : m)),
+      metadata.map((m, i) => (i === 3 ? { ...m, byteSize: 1.5 } : m)),
+      ...[209715201, 2097153, 67108865, 1048577].map((limit, index) =>
+        metadata.map((m, i) => (i === index ? { ...m, byteSize: limit } : m)),
+      ),
+    ])
+      await denied(stage(open, invalid), "PNR11");
+    await stage(open);
+    await denied(fail(open), "PNR13");
+    await denied(ack(open), "PNR13");
+    await denied(
+      owner`update public.lukas_drawing_native_dwg_resave_jobs set status='failed' where id=${open.jobId}::uuid`,
+      "PNR13",
+    );
+    await denied(
+      owner`update public.lukas_drawing_native_dwg_resave_attempts set outcome='failed',finished_at=clock_timestamp() where job_id=${open.jobId}::uuid`,
+      "PNR13",
+    );
+    await expire(open);
+    assert.equal(await claim(workerA), null);
+    assert.equal((await status(open.jobId)).status, "processing");
+    await cancel(open);
+    assert.equal(
+      await claim(workerB),
+      null,
+      "expired cancellation with open upload is unchanged",
+    );
+    assert.equal((await status(open.jobId)).status, "cancel_requested");
+    await denied(ack(open), "PNR13");
+    await close(open);
+    assert.equal((await ack(open)).status, "cancelled");
+    assert.deepEqual(await close(open), {
+      jobId: open.jobId,
+      attemptNumber: 1,
+      leaseToken: open.leaseToken,
+      uploadState: "closed",
+    });
+    await denied(publish(open), "PNR13");
+    await denied(readReceipt(open.jobId), "PNR11");
+    await denied(
+      owner`update public.lukas_drawing_native_dwg_resave_attempts set upload_state='open',upload_closed_at=null where job_id=${open.jobId}::uuid`,
+      "PNR11",
+    );
+
+    const retry = await start();
+    await stage(retry);
+    await close(retry);
+    assert.equal((await fail(retry)).status, "retry_wait");
+    await owner`update public.lukas_drawing_native_dwg_resave_jobs set next_attempt_at=clock_timestamp()-interval '1 second' where id=${retry.jobId}::uuid`;
+    const retry2 = await claim();
+    assert.equal(retry2.jobId, retry.jobId);
+    assert.equal(retry2.attemptNumber, 2);
+    await probe(async (tx) => {
+      await tx`set local session_replication_role=replica`;
+      await tx`update public.lukas_drawing_native_dwg_resave_attempts set upload_state='open',upload_closed_at=null,outcome=null,finished_at=null where job_id=${retry.jobId}::uuid and attempt_number=1`;
+      await tx`set local session_replication_role=origin`;
+      await denied(
+        asService(
+          tx,
+          (sp) =>
+            sp`select public.lukas_drawing_fail_native_dwg_resave(${retry2.jobId}::uuid,2,${retry2.leaseToken}::uuid,'upload_failed',true)`,
+        ),
+        "PNR13",
+      );
+      await tx`update public.lukas_drawing_native_dwg_resave_jobs set lease_expires_at=clock_timestamp()-interval '1 second' where id=${retry2.jobId}::uuid`;
+      const [unchanged] = await asService(
+        tx,
+        (sp) =>
+          sp`select public.lukas_drawing_claim_native_dwg_resave(${imageId},300) value`,
+      );
+      assert.equal(
+        unchanged.value,
+        null,
+        "a historical open attempt fences reclamation of the current attempt",
+      );
+      await asRole(
+        tx,
+        "authenticated",
+        actor,
+        (sp) =>
+          sp`select public.lukas_drawing_cancel_native_dwg_resave(${sp.json(scope)},${retry2.jobId}::uuid)`,
+      );
+      await denied(
+        asService(
+          tx,
+          (sp) =>
+            sp`select public.lukas_drawing_ack_native_dwg_resave_cancel(${retry2.jobId}::uuid,2,${retry2.leaseToken}::uuid)`,
+        ),
+        "PNR13",
+      );
+    });
+    await close(retry); // Historical exact-token close never targets the replacement.
+    await denied(stage(retry), "PNR13");
+    const secondMetadata = metadata.map((m, i) =>
+      i === 0 ? { ...m, sha256: hash("AC1024second-output") } : m,
+    );
+    await stage(retry2, secondMetadata);
+    await close(retry2);
+    const receipt2 = await publish(retry2);
+    assert.equal(receipt2.attemptNumber, 2);
+    assert.deepEqual(receipt2.artifacts, secondMetadata);
+    assert.deepEqual(await readReceipt(retry.jobId), receipt2);
+    assert.equal((await descriptor(retry.jobId, "dwg")).attemptNumber, 2);
+    await denied(publish(retry), "PNR13");
+    assert.deepEqual(await publish(retry2), receipt2);
+
+    // Independent client project-lock barriers explicitly choose each winner.
+    const [[ownerPid], [aPid], [bPid]] = await Promise.all([
+      owner`select pg_backend_pid() pid`,
+      workerA`select pg_backend_pid() pid`,
+      workerB`select pg_backend_pid() pid`,
+    ]);
+    const blockedBy = async (tx, waiter, blocker) => {
+      const deadline = Date.now() + 5000;
+      let blocked = false;
+      do {
+        const [r] =
+          await tx`select ${blocker}::integer=any(pg_blocking_pids(${waiter}::integer)) blocked`;
+        blocked = r.blocked;
+      } while (!blocked && Date.now() < deadline);
+      assert.equal(
+        blocked,
+        true,
+        "independent client reached explicit project lock barrier",
+      );
+    };
+    const settle = (p) =>
+      p.then(
+        (value) => ({ value }),
+        (error) => ({ error }),
+      );
+    for (const cancelFirst of [true, false]) {
+      const race = await start();
+      await stage(race);
+      await close(race);
+      let first, second;
+      await owner.begin(async (tx) => {
+        await tx`select id from public.lukas_qto_projects where id=${scope.projectId}::uuid for update`;
+        first = settle(
+          cancelFirst ? cancel(race, workerA) : publish(race, workerA),
+        );
+        await blockedBy(tx, aPid.pid, ownerPid.pid);
+        second = settle(
+          cancelFirst ? publish(race, workerB) : cancel(race, workerB),
+        );
+        await blockedBy(tx, bPid.pid, aPid.pid);
+      });
+      const [one, two] = await Promise.all([first, second]);
+      assert.equal(one.error, undefined);
+      if (cancelFirst) {
+        assert.equal(two.error?.code, "PNR13");
+        await ack(race);
+      } else {
+        assert.equal(two.value.status, "completed");
+        assert.deepEqual(await readReceipt(race.jobId), one.value);
+      }
+    }
+
+    const revoked = await start();
+    await stage(revoked);
+    await owner`delete from public.lukas_qto_project_members where project_id=${scope.projectId}::uuid and user_id=${actor}::uuid`;
+    await denied(stage(revoked), "PNR11");
+    await denied(readReceipt(c.jobId, actor), "PNR11");
+    await denied(descriptor(c.jobId, "dwg", actor), "PNR11");
+    await close(revoked);
+    await denied(publish(revoked), "PNR11");
+    assert.equal((await fail(revoked)).status, "failed");
+    await owner`insert into public.lukas_qto_project_members(project_id,user_id,role) values(${scope.projectId}::uuid,${actor}::uuid,'estimator')`;
+    const tamper = await start();
+    await stage(tamper);
+    await close(tamper);
+    for (const mutate of [
+      (tx) =>
+        tx`update public.lukas_drawing_native_dwg_import_jobs set source=jsonb_set(source,'{path}','"changed/private.dwg"') where id=${imported.jobId}::uuid`,
+      (tx) =>
+        tx`update public.lukas_drawing_snapshots set canonical_json=jsonb_set(canonical_json,'{operationSequence}','99999') where revision_id=${scope.revisionId}::uuid`,
+    ])
+      await probe(async (tx) => {
+        await tx`set local session_replication_role=replica`;
+        await mutate(tx);
+        await tx`set local session_replication_role=origin`;
+        await denied(
+          asService(
+            tx,
+            (sp) =>
+              sp`select public.lukas_drawing_publish_native_dwg_resave(${tamper.jobId}::uuid,1,${tamper.leaseToken}::uuid)`,
+          ),
+          "PNR11",
+        );
+      });
+    assert.equal(
+      (await fail(tamper, "publication_failed", false)).status,
+      "failed",
+    );
+
+    for (const suffix of ["artifacts", "exports"]) {
+      const table = "public.lukas_drawing_native_dwg_resave_" + suffix;
+      const [rls] =
+        await owner`select relrowsecurity,relforcerowsecurity from pg_class where oid=${table}::regclass`;
+      assert.deepEqual(rls, {
+        relrowsecurity: true,
+        relforcerowsecurity: true,
+      });
+      for (const role of [
+        "anon",
+        "authenticated",
+        "service_role",
+        "lukas_drawing_collaboration",
+      ]) {
+        const [g] =
+          await owner`select has_table_privilege(${role},${table},'SELECT,INSERT,UPDATE,DELETE') allowed`;
+        assert.equal(g.allowed, false);
+      }
+      await denied(
+        owner.unsafe("delete from " + table + " where job_id=$1::uuid", [
+          c.jobId,
+        ]),
+        "PNR11",
+      );
+      await denied(
+        owner.unsafe(
+          "update " + table + " set attempt_number=2 where job_id=$1::uuid",
+          [c.jobId],
+        ),
+        "PNR11",
+      );
+    }
+    for (const [signature, expected] of [
+      [
+        "public.lukas_drawing_stage_native_dwg_resave(uuid,integer,uuid,jsonb)",
+        true,
+      ],
+      [
+        "public.lukas_drawing_close_native_dwg_resave_upload(uuid,integer,uuid)",
+        true,
+      ],
+      [
+        "public.lukas_drawing_publish_native_dwg_resave(uuid,integer,uuid)",
+        true,
+      ],
+      ["public.lukas_drawing_native_dwg_resave_receipt(jsonb,uuid)", false],
+      [
+        "public.lukas_drawing_native_dwg_resave_download_descriptor(jsonb,uuid,text)",
+        false,
+      ],
+    ])
+      for (const role of [
+        "anon",
+        "authenticated",
+        "service_role",
+        "lukas_drawing_collaboration",
+      ]) {
+        const [g] =
+          await owner`select has_function_privilege(${role},${signature},'EXECUTE') allowed`;
+        assert.equal(
+          g.allowed,
+          expected ? role === "service_role" : role === "authenticated",
+        );
+      }
+    await denied(
+      service(
+        (tx) =>
+          tx`select public.lukas_drawing_publish_native_dwg_resave(${c.jobId}::uuid,1,${c.leaseToken}::uuid) value`,
+        owner,
+        "authenticated",
+      ),
+      "PNR11",
+    );
+    assert.deepEqual(
+      await owner`select source from public.lukas_drawing_native_dwg_import_jobs where id=${imported.jobId}::uuid`,
+      original,
+    );
+    assert.deepEqual(
+      await owner`select * from public.lukas_drawing_snapshots where revision_id=${scope.revisionId}::uuid`,
+      snapshots,
+    );
+    const [deps] =
+      await owner`select private.lukas_qto_project_retention_dependencies(${scope.projectId}::uuid) value`;
+    const allArtifacts =
+      await owner`select path,sha256,byte_size from public.lukas_drawing_native_dwg_resave_artifacts where project_id=${scope.projectId}::uuid order by path`;
+    const manifest =
+      await owner`select * from private.lukas_qto_project_retention_storage_files(${scope.projectId}::uuid) where path like ${`projects/${scope.projectId}/native-dwg-resave/%`} order by path`;
+    assert.deepEqual(
+      manifest,
+      allArtifacts,
+      "retention includes every staged attempt, including failed and cancelled uploads",
+    );
+    assert.equal(
+      Number(deps.value.nativeDwgResaveArtifacts),
+      allArtifacts.length,
+    );
+
+    const storageId = randomUUID(),
+      ordinaryId = randomUUID();
+    const ordinaryPath = `projects/${scope.projectId}/ordinary/${ordinaryId}`;
+    await owner`insert into storage.objects(id,bucket_id,name) values(${storageId}::uuid,'lukas-qto',${staged.artifacts[0].path})`;
+    await session(
+      owner,
+      "authenticated",
+      ids.users.owner,
+      (tx) =>
+        tx`insert into storage.objects(id,bucket_id,name) values(${ordinaryId}::uuid,'lukas-qto',${ordinaryPath})`,
+    );
+    for (const role of ["authenticated", "anon"]) {
+      const hidden = await session(
+        owner,
+        role,
+        ids.users.owner,
+        (tx) => tx`select id from storage.objects where id=${storageId}::uuid`,
+      );
+      assert.equal(hidden.length, 0);
+      await denied(
+        session(
+          owner,
+          role,
+          ids.users.owner,
+          (tx) =>
+            tx`insert into storage.objects(id,bucket_id,name) values(${randomUUID()}::uuid,'lukas-qto',${staged.artifacts[1].path})`,
+        ),
+        "42501",
+      );
+      const deleted = await session(
+        owner,
+        role,
+        ids.users.owner,
+        (tx) =>
+          tx`delete from storage.objects where id=${storageId}::uuid returning id`,
+      );
+      assert.equal(deleted.length, 0);
+    }
+    await probe(async (tx) => {
+      await tx.unsafe(
+        'create policy "publication fixture permits update" on storage.objects for update to authenticated using (true) with check (true)',
+      );
+      const asOwner = (fn) => asRole(tx, "authenticated", ids.users.owner, fn);
+      assert.equal(
+        (
+          await asOwner(
+            (sp) =>
+              sp`update storage.objects set name=${ordinaryPath + "-renamed"} where id=${ordinaryId}::uuid returning id`,
+          )
+        ).length,
+        1,
+      );
+      await denied(
+        asOwner(
+          (sp) =>
+            sp`update storage.objects set name=${staged.artifacts[2].path} where id=${ordinaryId}::uuid`,
+        ),
+        "42501",
+      );
+      assert.equal(
+        (
+          await asOwner(
+            (sp) =>
+              sp`update storage.objects set name=${ordinaryPath + "-escaped"} where id=${storageId}::uuid returning id`,
+          )
+        ).length,
+        0,
+      );
+    });
+    await owner`delete from storage.objects where id in (${storageId}::uuid,${ordinaryId}::uuid)`;
+
+    const retained = await start();
+    await stage(retained);
+    // Retention probes remove earlier, unrelated protection only in a rolled-back
+    // corruption transaction, so the open-upload predicate itself must deny deletion.
+    await probe(async (tx) => {
+      await tx`set local session_replication_role=replica`;
+      await tx`update public.lukas_drawing_revisions set status='draft',review_requested_at=null,approved_at=null where project_id=${scope.projectId}::uuid`;
+      await tx`delete from public.lukas_drawing_revision_approvals where project_id=${scope.projectId}::uuid`;
+      await tx`delete from public.lukas_drawing_issue_approvals where project_id=${scope.projectId}::uuid`;
+      await tx`update public.lukas_qto_boq_versions set status='draft' where project_id=${scope.projectId}::uuid`;
+      for (const table of [
+        "lukas_drawing_quantity_links",
+        "lukas_drawing_boq_links",
+        "lukas_drawing_material_links",
+        "lukas_qto_material_transactions",
+        "lukas_drawing_library_imports",
+      ])
+        await tx.unsafe(
+          "delete from public." + table + " where project_id=$1::uuid",
+          [scope.projectId],
+        );
+      await tx`delete from public.lukas_drawing_library_versions where source_project_id=${scope.projectId}::uuid`;
+      await tx`set local session_replication_role=origin`;
+      const asOwner = (fn) => asRole(tx, "authenticated", ids.users.owner, fn);
+      const [deletion] = await asOwner(
+        (sp) =>
+          sp`select (public.lukas_qto_request_project_deletion(${ids.organization}::uuid,${scope.projectId}::uuid,'Publication retention proof',${randomUUID()}::uuid)).id id`,
+      );
+      await tx`set local session_replication_role=replica`;
+      await tx`update public.lukas_qto_retention_events set purge_after=now()-interval '1 second' where id=${deletion.id}::uuid`;
+      await tx`set local session_replication_role=origin`;
+      const purge = () =>
+        asService(
+          tx,
+          (sp) =>
+            sp`select public.lukas_qto_purge_project(${ids.organization}::uuid,${scope.projectId}::uuid,${randomUUID()}::uuid,'Publication retention proof') value`,
+        ).then(([r]) => r.value);
+      let held = await purge();
+      assert.equal(held.reason, "active_native_dwg_jobs");
+      assert.equal(Number(held.dependencies.nativeDwgResaveOpenUploads), 1);
+      // Deliberately emulate historical corruption to prove the independent open
+      // attempt blocker remains even when no job status counts as active.
+      await tx`set local session_replication_role=replica`;
+      await tx`update public.lukas_drawing_native_dwg_resave_jobs set status='failed' where id=${retained.jobId}::uuid`;
+      await tx`set local session_replication_role=origin`;
+      held = await purge();
+      assert.equal(held.reason, "native_dwg_uploads_open");
+      await denied(
+        asService(
+          tx,
+          (sp) =>
+            sp`select public.lukas_qto_finalize_project_purge(${ids.organization}::uuid,${scope.projectId}::uuid,${randomUUID()}::uuid,${"a".repeat(64)},${randomUUID()}::uuid,'Publication open finalization proof')`,
+        ),
+        "P7R08",
+      );
+      await asService(
+        tx,
+        (sp) =>
+          sp`select public.lukas_drawing_close_native_dwg_resave_upload(${retained.jobId}::uuid,1,${retained.leaseToken}::uuid)`,
+      );
+      const ready = await purge();
+      assert.equal(ready.status, "STORAGE_REQUIRED");
+      assert.ok(
+        ready.files.some((f) => f.path.includes("/native-dwg-resave/")),
+      );
+      await tx`set local session_replication_role=replica`;
+      await tx`update public.lukas_drawing_native_dwg_resave_jobs set status='processing' where id=${retained.jobId}::uuid`;
+      await tx`set local session_replication_role=origin`;
+      await denied(
+        asService(
+          tx,
+          (sp) =>
+            sp`select public.lukas_qto_finalize_project_purge(${ids.organization}::uuid,${scope.projectId}::uuid,${ready.eventId}::uuid,${ready.manifestSha256},${randomUUID()}::uuid,'Publication active finalization proof')`,
+        ),
+        "P7R08",
+      );
+      await tx`set local session_replication_role=replica`;
+      await tx`update public.lukas_drawing_native_dwg_resave_jobs set status='failed' where id=${retained.jobId}::uuid`;
+      await tx`set local session_replication_role=origin`;
+      const orphanPath = `projects/${scope.projectId}/native-dwg-resave/unregistered/leftover.dwg`;
+      await tx`insert into storage.objects(id,bucket_id,name) values(${randomUUID()}::uuid,'lukas-qto',${orphanPath})`;
+      await denied(
+        asService(
+          tx,
+          (sp) =>
+            sp`select public.lukas_qto_finalize_project_purge(${ids.organization}::uuid,${scope.projectId}::uuid,${ready.eventId}::uuid,${ready.manifestSha256},${randomUUID()}::uuid,'Publication whole prefix proof')`,
+        ),
+        "P7R09",
+      );
+      await tx`delete from storage.objects where name=${orphanPath}`;
+      const [purged] = await asService(
+        tx,
+        (sp) =>
+          sp`select public.lukas_qto_finalize_project_purge(${ids.organization}::uuid,${scope.projectId}::uuid,${ready.eventId}::uuid,${ready.manifestSha256},${randomUUID()}::uuid,'Publication exact finalization proof') value`,
+      );
+      assert.equal(purged.value.status, "PURGED");
+      for (const table of ["jobs", "attempts", "artifacts", "exports"]) {
+        const [residue] = await tx.unsafe(
+          "select count(*)::integer n from public.lukas_drawing_native_dwg_resave_" +
+            table +
+            " where project_id=$1::uuid",
+          [scope.projectId],
+        );
+        assert.equal(residue.n, 0);
+      }
+    });
+    await close(retained);
+    await fail(retained, "publication_failed", false);
+    assert.deepEqual(
+      await owner`select source from public.lukas_drawing_native_dwg_import_jobs where id=${imported.jobId}::uuid`,
+      original,
+    );
+    assert.deepEqual(
+      await owner`select * from public.lukas_drawing_snapshots where revision_id=${scope.revisionId}::uuid`,
+      snapshots,
+    );
+    console.log(
+      "Resave publication database: real compiler identities, stage/retry/receipt identity, open fences, historical close, cancel/publish lock barriers, revocation/tamper, grants/immutability and complete staged retention manifest passed",
+    );
+  } finally {
+    await vite.close();
+  }
+}
```

### platform/tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs

```diff
diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-resave-jobs-database.mjs b/platform/tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs
index ec5c97e..d065435 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-resave-jobs-database.mjs
+++ b/platform/tests/fixtures/drawing-native-dwg-resave-jobs-database.mjs
@@ -20,50 +20,40 @@ const session = (sql, role, actor, callback, jwtRole = role) =>
     await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: jwtRole, sub: actor, is_anonymous: false })},true)`;
     await tx`select set_config('statement_timeout','10000',true)`;
     return callback(tx);
   });
 const denied = (promise, code) =>
   assert.rejects(promise, (e) => {
     assert.equal(e.code, code, e.message);
     return true;
   });
 
-// Missing replay/cancellation fencing would duplicate jobs or restart cancelled work.
-export async function proveNativeDwgResaveJobAuthority({
+const scopeForRevision = async (owner, revisionId) => {
+  const [r] =
+    await owner`select r.project_id,r.document_id,r.version,s.sha256,c.id canvas_id from public.lukas_drawing_revisions r join public.lukas_drawing_snapshots s on s.revision_id=r.id and s.revision_version=r.version join public.lukas_drawing_canvases c on c.revision_id=r.id where r.id=${revisionId}::uuid`;
+  return {
+    projectId: r.project_id,
+    documentId: r.document_id,
+    revisionId,
+    revisionVersion: Number(r.version),
+    canvasId: r.canvas_id,
+    snapshotSha256: r.sha256,
+  };
+};
+
+export async function createApprovedNativeDwgResaveRevision({
   owner,
-  workerA,
-  workerB,
   ids,
   imported,
-  otherImported,
 }) {
   const editor = ids.users.editor;
-  const source = (scope, actor = editor) =>
-    session(
-      owner,
-      "authenticated",
-      actor,
-      (tx) =>
-        tx`select public.lukas_qto_drawing_native_dwg_resave_source(${tx.json(scope)}) value`,
-    ).then(([r]) => r.value);
-  const scopeFor = async (revisionId) => {
-    const [r] =
-      await owner`select r.project_id,r.document_id,r.version,s.sha256,c.id canvas_id from public.lukas_drawing_revisions r join public.lukas_drawing_snapshots s on s.revision_id=r.id and s.revision_version=r.version join public.lukas_drawing_canvases c on c.revision_id=r.id where r.id=${revisionId}::uuid`;
-    return {
-      projectId: r.project_id,
-      documentId: r.document_id,
-      revisionId,
-      revisionVersion: Number(r.version),
-      canvasId: r.canvas_id,
-      snapshotSha256: r.sha256,
-    };
-  };
+  const scopeFor = (revisionId) => scopeForRevision(owner, revisionId);
   const unchangedScope = await scopeFor(imported.scope.revisionId);
   const [clone] = await session(
     owner,
     "authenticated",
     editor,
     (tx) =>
       tx`select public.lukas_drawing_create_from_template(${imported.scope.revisionId}::uuid,'Resave changed LINE',null::uuid,${randomUUID()}::uuid) value`,
   );
   const [snapshot] =
     await owner`select private.lukas_drawing_p2_canonical_snapshot(${clone.value.revisionId}::uuid,true) value`;
@@ -94,20 +84,44 @@ export async function proveNativeDwgResaveJobAuthority({
     [ids.users.approver, "approved"],
   ])
     await session(
       owner,
       "authenticated",
       who,
       (tx) =>
         tx`select public.lukas_drawing_record_revision_decision(${clone.value.revisionId}::uuid,${frozen.revision_version}::bigint,${frozen.sha256},${decision},'Resave control proof')`,
     );
   const editedScope = await scopeFor(clone.value.revisionId);
+  return { unchangedScope, editedScope };
+}
+
+// Missing replay/cancellation fencing would duplicate jobs or restart cancelled work.
+export async function proveNativeDwgResaveJobAuthority({
+  owner,
+  workerA,
+  workerB,
+  ids,
+  imported,
+  otherImported,
+}) {
+  const editor = ids.users.editor;
+  const source = (scope, actor = editor) =>
+    session(
+      owner,
+      "authenticated",
+      actor,
+      (tx) =>
+        tx`select public.lukas_qto_drawing_native_dwg_resave_source(${tx.json(scope)}) value`,
+    ).then(([r]) => r.value);
+  const scopeFor = (revisionId) => scopeForRevision(owner, revisionId);
+  const { unchangedScope, editedScope } =
+    await createApprovedNativeDwgResaveRevision({ owner, ids, imported });
   const vite = await createServer({
     appType: "custom",
     configFile: false,
     logLevel: "silent",
     resolve: {
       alias: { "~": fileURLToPath(new URL("../../app", import.meta.url)) },
     },
     server: { middlewareMode: true },
   });
   try {
@@ -732,23 +746,25 @@ export async function proveNativeDwgResaveJobAuthority({
       "PNR11",
     );
     await denied(
       owner`update public.lukas_drawing_native_dwg_resave_jobs set requested_by=${ids.users.owner}::uuid where id=${first.jobId}::uuid`,
       "PNR11",
     );
     if (process.env.M1_RESAVE_ADVISORS === "1") {
       const [db] = await owner`select current_database() name`;
       const url = new URL(process.env.M1_REAL_POSTGRES_DATABASE_URL);
       assert.equal(url.hostname, "127.0.0.1");
-      assert.equal(url.port, "32779");
+      assert.match(url.port, /^[0-9]+$/);
+      assert.ok(Number(url.port) > 0 && Number(url.port) <= 65535);
       assert.match(db.name, /^m1_\d+_[0-9a-f]+$/);
       url.pathname = `/${db.name}`;
+      url.searchParams.set("sslmode", "disable");
       const { stdout, stderr } = await promisify(execFile)(
         "supabase",
         [
           "db",
           "advisors",
           "--db-url",
           url.toString(),
           "--type",
           "all",
           "--level",
```

### platform/tests/drawing-workspace-m1-real-database.test.mjs

```diff
diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-workspace-m1-real-database.test.mjs b/platform/tests/drawing-workspace-m1-real-database.test.mjs
index f53961f..2744241 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-workspace-m1-real-database.test.mjs
+++ b/platform/tests/drawing-workspace-m1-real-database.test.mjs
@@ -2,20 +2,21 @@ import assert from "node:assert/strict";
 import { createHash, randomBytes, randomUUID } from "node:crypto";
 import { readdir, readFile } from "node:fs/promises";
 import test from "node:test";
 
 import { proveCanonicalCollaborationSocketInitialization } from "./fixtures/drawing-collaboration-canonical-initialization.mjs";
 import { proveDwgSourceIngestionAuthority } from "./fixtures/drawing-dwg-source-ingestion-database.mjs";
 import { proveNativeDwgExportJobAuthority } from "./fixtures/drawing-native-dwg-jobs-database.mjs";
 import { proveNativeDwgImportJobAuthority } from "./fixtures/drawing-native-dwg-import-jobs-database.mjs";
 import { proveNativeDwgCanonicalImportAuthority } from "./fixtures/drawing-native-dwg-canonical-import-database.mjs";
 import { proveNativeDwgResaveJobAuthority } from "./fixtures/drawing-native-dwg-resave-jobs-database.mjs";
+import { proveNativeDwgResavePublicationAuthority } from "./fixtures/drawing-native-dwg-resave-publication-database.mjs";
 import { proveNativeDwgImportPipeline } from "./fixtures/drawing-native-dwg-import-pipeline.mjs";
 import { proveFreshNativeDwgCanonicalPipeline } from "./fixtures/drawing-native-dwg-canonical-pipeline.mjs";
 
 const databaseUrl = process.env.M1_REAL_POSTGRES_DATABASE_URL;
 const required = process.env.M1_REAL_POSTGRES_REQUIRED === "1";
 const nativeDwgImportPipelineRequired =
   process.env.M1_NATIVE_DWG_IMPORT_PIPELINE_REQUIRED === "1";
 
 if (!databaseUrl) {
   test(
@@ -2812,20 +2813,21 @@ if (!databaseUrl) {
         }
         const imported = await proveNativeDwgCanonicalImportAuthority({
           owner,workerA,workerB,ids,
           registerProject: (projectId) => projectIds.push(projectId),
         });
         const otherImported = await proveNativeDwgCanonicalImportAuthority({
           owner,workerA,workerB,ids,
           registerProject: (projectId) => projectIds.push(projectId),
         });
         await proveNativeDwgResaveJobAuthority({ owner, workerA, workerB, ids, imported, otherImported });
+        await proveNativeDwgResavePublicationAuthority({ owner, workerA, workerB, ids, imported });
         await proveNativeDwgImportJobAuthority({
           owner,workerA,workerB,ids,
           registerProject: (projectId) => projectIds.push(projectId),
         });
         const reviewDocument = await createDocument(
           owner,
           "authenticated",
           ids.users.editor,
           ids.project,
           "M1 staged review",
```

### platform/tests/fixtures/drawing-native-dwg-jobs-database.mjs

```diff
diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-jobs-database.mjs b/platform/tests/fixtures/drawing-native-dwg-jobs-database.mjs
index 9b5e56a..df56344 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-jobs-database.mjs
+++ b/platform/tests/fixtures/drawing-native-dwg-jobs-database.mjs
@@ -831,21 +831,21 @@ export async function proveNativeDwgExportJobAuthority({ owner, ids }) {
                 'M1 native dependency refusal',${randomUUID()}::uuid
               )).id id
             `,
           );
           await sp.unsafe(`
             alter table public.lukas_qto_retention_events
             disable trigger lukas_qto_retention_events_append_only
           `);
           await sp`
             update public.lukas_qto_retention_events
-            set purge_after=pg_catalog.clock_timestamp()-interval '1 second'
+            set purge_after=pg_catalog.now()-interval '1 second'
             where id=${deletion.id}::uuid
           `;
           await sp.unsafe(`
             alter table public.lukas_qto_retention_events
             enable trigger lukas_qto_retention_events_append_only
           `);
           const [held] = await asService(sp, (serviceTx) => serviceTx`
             select public.lukas_qto_purge_project(
               ${ids.organization}::uuid,${ids.project}::uuid,
               ${randomUUID()}::uuid,'M1 native dependency probe'
```

### platform/tests/drawing-native-dwg-resave-jobs.test.mjs

```diff
diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-resave-jobs.test.mjs b/platform/tests/drawing-native-dwg-resave-jobs.test.mjs
index 01b17b5..bc54c48 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-2-drawing-native-dwg-resave-jobs.test.mjs
+++ b/platform/tests/drawing-native-dwg-resave-jobs.test.mjs
@@ -330,42 +330,42 @@ test("service errors expose only conflict, stale and capacity classifications",
       jobs.requestNativeDrawingDwgResave(
         c.user,
         c.service,
         { ...f.scope, requestId: result.requestId },
         imageId,
       ),
       (e) => e.kind === kind && !e.message.includes("private"),
     );
   }
 });
-test("status and cancel bind exact job identity and reject locator or completed fields", async () => {
+test("status and cancel bind exact job identity and reject locators or inconsistent states", async () => {
   for (const [method, rpcName] of [
     [
       "getNativeDrawingDwgResaveStatus",
       "lukas_drawing_native_dwg_resave_status",
     ],
     ["cancelNativeDrawingDwgResave", "lukas_drawing_cancel_native_dwg_resave"],
   ]) {
     const f = edited();
     const c = clients(f, { response: status });
     assert.deepEqual(
       await jobs[method](c.service, f.scope, result.jobId),
       status,
     );
     assert.deepEqual(c.calls[0], {
       name: rpcName,
       args: { p_scope: f.scope, p_job_id: result.jobId },
     });
     for (const response of [
       { ...status, jobId: uuid(92) },
       { ...status, source: { path: "private" } },
-      { ...status, status: "completed" },
+      { ...status, status: "completed", attemptCount: 0 },
       { ...status, status: "no_changes" },
     ]) {
       await assert.rejects(
         jobs[method](clients(f, { response }).service, f.scope, result.jobId),
         generic,
       );
     }
   }
 });
 test("claim validates stored attestation and source against exact fresh payload and pinned image", async () => {
```
