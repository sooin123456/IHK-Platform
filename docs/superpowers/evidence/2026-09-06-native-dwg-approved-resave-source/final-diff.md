# final review package

Uncommitted scoped diff against captured dirty baseline; unrelated changes excluded.
HEAD: 9f5f56d93db325ff935772252f9d4fb64d69f98c


## platform/supabase/migrations/20260906043637_drawing_native_dwg_resave_source_authority.sql

diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/baseline-code/platform/supabase/migrations/20260906043637_drawing_native_dwg_resave_source_authority.sql b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/supabase/migrations/20260906043637_drawing_native_dwg_resave_source_authority.sql
index e69de29..237ce33 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/baseline-code/platform/supabase/migrations/20260906043637_drawing_native_dwg_resave_source_authority.sql
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/supabase/migrations/20260906043637_drawing_native_dwg_resave_source_authority.sql
@@ -0,0 +1,146 @@
+begin;
+
+-- Read-only imported authority is separate from source-free native export.
+create function private.lukas_drawing_native_dwg_resave_source_for_actor(
+  p_actor_id uuid,p_scope jsonb
+) returns jsonb language plpgsql stable security definer set search_path='' as $$
+declare q record; approved jsonb; frozen jsonb; live jsonb; anchor jsonb;
+declare j public.lukas_drawing_native_dwg_import_jobs%rowtype;
+declare result public.lukas_drawing_native_dwg_import_results%rowtype;
+declare verified jsonb; report jsonb; k text;
+begin
+  select * into q from private.lukas_drawing_native_dwg_scope(p_scope);
+  if not found then return null; end if;
+  select pg_catalog.jsonb_build_object(
+    'projectId',r.project_id,'documentId',r.document_id,'canvasId',c.id,
+    'revision',pg_catalog.jsonb_build_object('id',r.id,'sequence',r.sequence,'version',r.version,'status',r.status),
+    'snapshot',pg_catalog.jsonb_build_object('sha256',s.sha256,'schemaVersion',s.schema_version,
+      'operationSequence',s.operation_sequence,'canonicalJsonText',s.canonical_json::text),
+    'approvalDecision','approved'
+  ),s.canonical_json into approved,frozen
+  from auth.users actor
+  join public.lukas_drawing_revisions r on r.id=q.revision_id
+    and r.document_id=q.document_id and r.project_id=q.project_id and r.version=q.revision_version
+  join public.lukas_qto_projects project on project.id=r.project_id
+  join public.lukas_drawing_documents d on d.id=r.document_id and d.project_id=r.project_id
+  join public.lukas_drawing_snapshots s on s.revision_id=r.id and s.project_id=r.project_id
+    and s.revision_version=r.version and s.sha256=q.snapshot_sha256
+  join public.lukas_drawing_canvases c on c.id=q.canvas_id and c.revision_id=r.id and c.project_id=r.project_id
+  where actor.id=p_actor_id and not coalesce(actor.is_anonymous,false)
+    and nullif(pg_catalog.to_jsonb(actor)->>'deleted_at','') is null
+    and (nullif(pg_catalog.to_jsonb(actor)->>'banned_until','') is null
+      or (pg_catalog.to_jsonb(actor)->>'banned_until')::timestamptz<=pg_catalog.clock_timestamp())
+    and private.lukas_drawing_collaboration_capability_for_user(p_actor_id,project.id) is not null
+    and private.lukas_qto_project_feature_active(project.id,'drawing_workspace')
+    and project.archived_at is null and project.deletion_requested_at is null
+    and nullif(pg_catalog.to_jsonb(d)->>'archived_at','') is null
+    and nullif(pg_catalog.to_jsonb(d)->>'deleted_at','') is null
+    and r.status in ('approved','superseded') and s.schema_version=2
+    and s.operation_sequence between 0 and 9007199254740991
+    and s.sha256=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(s.canonical_json::text,'UTF8'),'sha256'),'hex')
+    and pg_catalog.octet_length(pg_catalog.convert_to(s.canonical_json::text,'UTF8'))<=20971520
+    and exists(select 1 from public.lukas_drawing_revision_approvals a where a.revision_id=s.revision_id
+      and a.project_id=s.project_id and a.subject_version=s.revision_version
+      and a.snapshot_sha256=s.sha256 and a.decision='approved')
+    and c.background_source_file_id is null and c.background_source_sha256 is null
+    and c.background_pdf_page is null and c.calibration is null
+    and s.canonical_json@>pg_catalog.jsonb_build_object('schemaVersion',2,
+      'revision',pg_catalog.jsonb_build_object('id',r.id::text,'documentId',r.document_id::text,
+        'projectId',r.project_id::text,'sequence',r.sequence,'version',r.version),
+      'operationSequence',s.operation_sequence,
+      'canvases',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',c.id::text,'pageId',c.page_id::text)))
+    and (select pg_catalog.count(*) from public.lukas_drawing_pages p where p.revision_id=r.id and p.project_id=r.project_id)=1
+    and (select pg_catalog.count(*) from public.lukas_drawing_canvases x where x.revision_id=r.id and x.project_id=r.project_id)=1
+    and not exists(select 1 from public.lukas_drawing_pages p where p.revision_id=r.id and p.project_id=r.project_id
+      and (p.background_source_file_id is not null or p.background_source_sha256 is not null or p.background_pdf_page is not null or p.calibration is not null))
+    and not exists(select 1 from public.lukas_drawing_revision_ifc_derivatives b where b.revision_id=r.id and b.project_id=r.project_id)
+    and not exists(select 1 from public.lukas_qto_retention_events e where e.project_id=project.id and e.event_type='purge_storage_ready');
+  if approved is null then return null; end if;
+  if pg_catalog.jsonb_array_length(frozen->'pages')<>1 or pg_catalog.jsonb_array_length(frozen->'canvases')<>1
+    or frozen->'blocks'<>'[]'::jsonb or frozen->'blockInstances'<>'[]'::jsonb
+    or pg_catalog.jsonb_array_length(frozen->'objects') not between 1 and 10000
+    or pg_catalog.jsonb_array_length(frozen->'sources')<>pg_catalog.jsonb_array_length(frozen->'objects')
+  then return null; end if;
+  -- Reuse canonical serialization to compare every live anchor and object scope.
+  -- Historical deleted source rows are separately denied (not silently omitted).
+  live:=private.lukas_drawing_p2_canonical_snapshot(q.revision_id,true);
+  foreach k in array array['pages','canvases','layers','objects','sources','blocks','blockInstances'] loop
+    if frozen->k is distinct from live->k then return null; end if;
+  end loop;
+  if exists(select 1 from public.lukas_drawing_object_sources s where s.revision_id=q.revision_id and s.project_id=q.project_id
+    and (s.status<>'active' or s.source_kind<>'dwg_entity')) then return null; end if;
+  anchor:=frozen->'sources'->0;
+  if exists(select 1 from pg_catalog.jsonb_array_elements(frozen->'sources') s
+    where s->>'sourceKind'<>'dwg_entity' or s->>'revisionId'<>q.revision_id::text
+      or s->>'analysisJobId' is distinct from anchor->>'analysisJobId'
+      or s->>'reportSha256' is distinct from anchor->>'reportSha256'
+      or s->>'sourceFileId' is distinct from anchor->>'sourceFileId'
+      or s->>'sourceSha256' is distinct from anchor->>'sourceSha256'
+      or private.lukas_drawing_dwg_source_report_matches(q.project_id,(s->>'sourceFileId')::uuid,s->>'sourceSha256',
+        s-array['id','objectId','revisionId','sourceFileId','sourceSha256','sourceKind','version']) is not true
+      or not exists(select 1 from pg_catalog.jsonb_array_elements(frozen->'objects') o where o->>'id'=s->>'objectId'))
+    or (select pg_catalog.count(distinct s->>'handle') from pg_catalog.jsonb_array_elements(frozen->'sources') s)<>pg_catalog.jsonb_array_length(frozen->'sources')
+    or (select pg_catalog.count(distinct s->>'objectId') from pg_catalog.jsonb_array_elements(frozen->'sources') s)<>pg_catalog.jsonb_array_length(frozen->'objects')
+  then return null; end if;
+  select job.* into j from public.lukas_drawing_native_dwg_import_jobs job
+    where job.id=(anchor->>'analysisJobId')::uuid and job.project_id=q.project_id and job.status='analyzed';
+  if not found or private.lukas_drawing_native_dwg_import_scope(j.scope) is distinct from j.scope
+    or j.scope->>'projectId'<>q.project_id::text then return null; end if;
+  select r.* into result from public.lukas_drawing_native_dwg_import_results r
+    join public.lukas_drawing_native_dwg_import_attempts a on a.job_id=r.job_id and a.project_id=r.project_id and a.attempt_number=r.attempt_number
+    where r.job_id=j.id and r.project_id=j.project_id and r.attempt_number=j.attempt_count
+      and r.reader_image_id=j.reader_image_id and a.reader_image_id=r.reader_image_id and a.outcome='analyzed'
+      and r.report_sha256=anchor->>'reportSha256'
+      and r.report_byte_size=pg_catalog.octet_length(pg_catalog.convert_to(r.report_text,'UTF8'))
+      and r.report_byte_size between 1 and 33554432
+      and r.report_sha256=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(r.report_text,'UTF8'),'sha256'),'hex');
+  if not found then return null; end if;
+  report:=result.report_text::jsonb;
+  if pg_catalog.jsonb_array_length(report->'entities')<>pg_catalog.jsonb_array_length(frozen->'objects') then return null; end if;
+  select pg_catalog.jsonb_build_object('verificationId',v.id,'fileId',f.id,'bucket','lukas-qto','path',f.storage_path,
+    'sha256',f.sha256,'byteSize',f.byte_size,'headerVersion',v.dwg_header_version) into verified
+  from public.lukas_qto_files f
+  join public.lukas_qto_verified_uploads v on v.consumed_file_id=f.id
+  join public.lukas_drawing_documents d on d.id=q.document_id and d.project_id=f.project_id
+  join public.lukas_drawing_revisions historical on historical.id=(j.scope->>'revisionId')::uuid
+    and historical.document_id=(j.scope->>'documentId')::uuid and historical.project_id=f.project_id
+  join public.lukas_drawing_canvases historical_canvas on historical_canvas.id=(j.scope->>'canvasId')::uuid
+    and historical_canvas.revision_id=historical.id and historical_canvas.project_id=f.project_id
+  where f.id=(anchor->>'sourceFileId')::uuid and f.project_id=q.project_id
+    and f.id=(j.scope->>'sourceFileId')::uuid and f.kind='dwg' and f.immutable
+    and f.sha256=anchor->>'sourceSha256' and f.sha256=j.scope->>'sourceSha256'
+    and f.byte_size between 1 and 209715200
+    and v.kind='dwg' and v.project_id=f.project_id and v.storage_path=f.storage_path
+    and v.sha256=f.sha256 and v.byte_size=f.byte_size and v.dwg_header_version~'^AC[0-9]{4}$'
+    and (select pg_catalog.count(*) from public.lukas_qto_verified_uploads x where x.consumed_file_id=f.id)=1
+    and ((d.source_file_id is null and d.source_sha256 is null) or (d.source_file_id=f.id and d.source_sha256=f.sha256));
+  if verified is null or j.source is distinct from verified
+    or report->'source' is distinct from verified-array['verificationId','fileId','bucket','path']
+  then return null; end if;
+  return pg_catalog.jsonb_build_object('approved',approved,'analysis',pg_catalog.jsonb_build_object(
+    'scope',j.scope,'result',pg_catalog.jsonb_build_object('receipt',private.lukas_drawing_native_dwg_import_receipt(j.id),'reportText',result.report_text)));
+exception when others then return null;
+end;
+$$;
+
+create function public.lukas_qto_drawing_native_dwg_resave_source(p_scope jsonb)
+returns jsonb language plpgsql stable security definer set search_path='' as $$
+declare result jsonb;
+begin
+  if (select auth.uid()) is null or private.lukas_qto_verified_session() is not true
+  then raise exception using errcode='PNR01',message='Approved DWG resave source is unavailable'; end if;
+  result:=private.lukas_drawing_native_dwg_resave_source_for_actor((select auth.uid()),p_scope);
+  if result is null then raise exception using errcode='PNR01',message='Approved DWG resave source is unavailable'; end if;
+  return result;
+exception when others then
+  raise exception using errcode='PNR01',message='Approved DWG resave source is unavailable';
+end;
+$$;
+
+revoke all on function private.lukas_drawing_native_dwg_resave_source_for_actor(uuid,jsonb)
+  from public,anon,authenticated,service_role,lukas_drawing_collaboration;
+revoke all on function public.lukas_qto_drawing_native_dwg_resave_source(jsonb)
+  from public,anon,authenticated,service_role,lukas_drawing_collaboration;
+grant execute on function public.lukas_qto_drawing_native_dwg_resave_source(jsonb) to authenticated;
+
+commit;


## platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts

diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts
new file mode 100644
index 0000000..e33ece9
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-source.server.ts
@@ -0,0 +1,265 @@
+import { createHash } from "node:crypto";
+import { isDeepStrictEqual } from "node:util";
+import { z } from "zod";
+
+import { hydrateDrawingAuthoritySnapshot } from "./drawing-authority-snapshot.server.ts";
+import { NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-jobs.server.ts";
+import {
+  NativeDrawingDwgImportScopeSchema,
+  NativeDrawingDwgImportResultSchema,
+} from "./drawing-native-dwg-import-jobs.server.ts";
+import { buildNativeDrawingDwgImportPlan } from "./drawing-native-dwg-import-plan.server.ts";
+import { projectNativeDrawingDwgImport } from "./drawing-native-dwg-import.server.ts";
+import { buildNativeDrawingDwgSelectedEdits } from "./drawing-native-dwg-selected-edits.server.ts";
+
+const Uuid = z.string().uuid();
+const PayloadSchema = z
+  .object({
+    approved: z
+      .object({
+        projectId: Uuid,
+        documentId: Uuid,
+        canvasId: Uuid,
+        revision: z
+          .object({
+            id: Uuid,
+            sequence: z.number().int().positive().safe(),
+            version: z.number().int().positive().safe(),
+            status: z.enum(["approved", "superseded"]),
+          })
+          .strict(),
+        snapshot: z
+          .object({
+            sha256: z.string().regex(/^[0-9a-f]{64}$/),
+            schemaVersion: z.literal(2),
+            operationSequence: z.number().int().nonnegative().safe(),
+            canonicalJsonText: z.string(),
+          })
+          .strict(),
+        approvalDecision: z.literal("approved"),
+      })
+      .strict(),
+    analysis: z
+      .object({
+        scope: NativeDrawingDwgImportScopeSchema,
+        result: NativeDrawingDwgImportResultSchema,
+      })
+      .strict(),
+  })
+  .strict();
+const units = {
+  1: { code: 1, label: "in" },
+  2: { code: 2, label: "ft" },
+  4: { code: 4, label: "mm" },
+  5: { code: 5, label: "cm" },
+  6: { code: 6, label: "m" },
+} as const;
+
+export class DrawingNativeDwgResaveSourceError extends Error {
+  readonly code = "NATIVE_DWG_RESAVE_SOURCE_UNAVAILABLE";
+  constructor() {
+    super("Approved DWG resave source is unavailable.");
+    this.name = "DrawingNativeDwgResaveSourceError";
+  }
+}
+
+export async function projectApprovedNativeDrawingDwgResaveSource(
+  rawRequest: unknown,
+  rawPayload: unknown,
+) {
+  try {
+    const scope = NativeDrawingDwgScopeSchema.parse(rawRequest);
+    const { approved, analysis } = PayloadSchema.parse(rawPayload);
+    const receipt = analysis.result.receipt;
+    if (
+      approved.projectId !== scope.projectId ||
+      approved.documentId !== scope.documentId ||
+      approved.canvasId !== scope.canvasId ||
+      approved.revision.id !== scope.revisionId ||
+      approved.revision.version !== scope.revisionVersion ||
+      approved.snapshot.sha256 !== scope.snapshotSha256 ||
+      analysis.scope.projectId !== scope.projectId ||
+      analysis.scope.sourceFileId !== receipt.source.fileId ||
+      analysis.scope.sourceSha256 !== receipt.source.sha256 ||
+      Buffer.byteLength(approved.snapshot.canonicalJsonText, "utf8") >
+        20 * 1024 * 1024 ||
+      createHash("sha256")
+        .update(approved.snapshot.canonicalJsonText, "utf8")
+        .digest("hex") !== scope.snapshotSha256
+    )
+      throw new DrawingNativeDwgResaveSourceError();
+    const isClone = analysis.scope.revisionId !== scope.revisionId;
+    if (
+      !isClone &&
+      (analysis.scope.documentId !== scope.documentId ||
+        analysis.scope.canvasId !== scope.canvasId)
+    )
+      throw new DrawingNativeDwgResaveSourceError();
+    const { state } = hydrateDrawingAuthoritySnapshot({
+      projectId: scope.projectId,
+      documentId: scope.documentId,
+      revision: approved.revision,
+      snapshot: {
+        sha256: scope.snapshotSha256,
+        schemaVersion: 2,
+        operationSequence: approved.snapshot.operationSequence,
+        canonicalJson: JSON.parse(approved.snapshot.canonicalJsonText),
+      },
+    });
+    const structure = state.structure!;
+    const pages = Object.values(structure.pages),
+      canvases = Object.values(structure.canvases);
+    if (
+      pages.length !== 1 ||
+      canvases.length !== 1 ||
+      canvases[0].id !== scope.canvasId ||
+      canvases[0].background !== null ||
+      Object.keys(structure.blocks).length ||
+      Object.keys(structure.blockInstances).length
+    )
+      throw new DrawingNativeDwgResaveSourceError();
+    const importInput = {
+      report: JSON.parse(analysis.result.reportText),
+      expectedSource: {
+        sha256: receipt.source.sha256,
+        byteSize: receipt.source.byteSize,
+        headerVersion: receipt.source.headerVersion,
+      },
+      revisionId: scope.revisionId,
+      canvasId: scope.canvasId,
+      sourceFileId: receipt.source.fileId,
+      ...(analysis.scope.unitOverride === null
+        ? {}
+        : { unitOverride: units[analysis.scope.unitOverride] }),
+      analysisJobId: receipt.jobId,
+      reportSha256: receipt.reportSha256,
+    };
+    const plan = buildNativeDrawingDwgImportPlan(importInput);
+    const baseline = projectNativeDrawingDwgImport(importInput);
+    const objects = Object.values(structure.objects),
+      sources = Object.values(structure.sources ?? {}),
+      layers = Object.values(structure.layers);
+    if (
+      objects.length !== plan.objects.length ||
+      sources.length !== objects.length
+    )
+      throw new DrawingNativeDwgResaveSourceError();
+    // Layer IDs change on clone. Bind all imported layers by their full native
+    // semantics, including empty native layers, before adapting object IDs.
+    const layerIds = new Map<string, string>();
+    for (const nativeLayer of plan.layers) {
+      const matches = layers.filter(
+        (layer) =>
+          layer.name === nativeLayer.name && layer.systemKind === "custom",
+      );
+      if (matches.length !== 1) throw new DrawingNativeDwgResaveSourceError();
+      const current = matches[0];
+      if (
+        !isDeepStrictEqual(
+          {
+            ...current,
+            id: isClone ? nativeLayer.id : current.id,
+            version: nativeLayer.version,
+          },
+          nativeLayer,
+        ) ||
+        current.version < nativeLayer.version
+      )
+        throw new DrawingNativeDwgResaveSourceError();
+      layerIds.set(current.id, nativeLayer.id);
+    }
+    if (
+      layers.some(
+        (layer) =>
+          !layerIds.has(layer.id) &&
+          (layer.systemKind === "custom" ||
+            objects.some((object) => object.layerId === layer.id)),
+      )
+    )
+      throw new DrawingNativeDwgResaveSourceError();
+    const byHandle = new Map(
+      plan.sources.map((source) => [source.handle, source]),
+    );
+    const seenHandles = new Set<string>(),
+      seenObjects = new Set<string>();
+    const bindings: Array<{ objectId: string; handle: string }> = [];
+    const boundCanonicalObjects = sources.map((source) => {
+      if (source.sourceKind !== "dwg_entity")
+        throw new DrawingNativeDwgResaveSourceError();
+      const expected = byHandle.get(source.handle);
+      const object = structure.objects[source.objectId];
+      if (
+        !expected ||
+        !object ||
+        seenHandles.has(source.handle) ||
+        seenObjects.has(source.objectId) ||
+        source.version < expected.version ||
+        !isDeepStrictEqual(
+          {
+            ...source,
+            id: isClone ? expected.id : source.id,
+            objectId: isClone ? expected.objectId : source.objectId,
+            version: expected.version,
+          },
+          expected,
+        )
+      )
+        throw new DrawingNativeDwgResaveSourceError();
+      seenHandles.add(source.handle);
+      seenObjects.add(source.objectId);
+      bindings.push({ objectId: object.id, handle: source.handle });
+      const projected = baseline.objects.find(
+        (candidate) => candidate.id === expected.objectId,
+      )!;
+      if (layerIds.get(object.layerId) !== projected.layerId)
+        throw new DrawingNativeDwgResaveSourceError();
+      return isClone
+        ? { ...object, id: expected.objectId, layerId: projected.layerId }
+        : object;
+    });
+    bindings.sort((a, b) =>
+      BigInt(`0x${a.handle}`) < BigInt(`0x${b.handle}`) ? -1 : 1,
+    );
+    const selectedEdits = buildNativeDrawingDwgSelectedEdits({
+      importInput,
+      objects: boundCanonicalObjects,
+    });
+    return {
+      scope,
+      approved: {
+        revisionId: scope.revisionId,
+        revisionVersion: scope.revisionVersion,
+        snapshotSha256: scope.snapshotSha256,
+        operationSequence: approved.snapshot.operationSequence,
+      },
+      analysisReceipt: receipt,
+      bindings,
+      selectedEdits,
+    };
+  } catch {
+    throw new DrawingNativeDwgResaveSourceError();
+  }
+}
+
+export async function loadApprovedNativeDrawingDwgResaveSource(
+  client: { rpc: unknown },
+  rawRequest: unknown,
+) {
+  try {
+    const scope = NativeDrawingDwgScopeSchema.parse(rawRequest);
+    if (typeof client?.rpc !== "function")
+      throw new DrawingNativeDwgResaveSourceError();
+    const response = await Reflect.apply(client.rpc, client, [
+      "lukas_qto_drawing_native_dwg_resave_source",
+      { p_scope: scope },
+    ]);
+    if (!response || response.error)
+      throw new DrawingNativeDwgResaveSourceError();
+    return await projectApprovedNativeDrawingDwgResaveSource(
+      scope,
+      response.data,
+    );
+  } catch {
+    throw new DrawingNativeDwgResaveSourceError();
+  }
+}


## platform/tests/drawing-native-dwg-resave-source.test.mjs

diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-source.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-source.test.mjs
new file mode 100644
index 0000000..433f6b8
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-source.test.mjs
@@ -0,0 +1,728 @@
+import assert from "node:assert/strict";
+import { createHash } from "node:crypto";
+import { fileURLToPath } from "node:url";
+import test from "node:test";
+import { createServer } from "vite";
+import { buildNativeDrawingDwgImportPlan } from "../app/lukas/lib/drawing-native-dwg-import-plan.server.ts";
+
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
+const adapter = await vite
+  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-source.server.ts")
+  .catch(() => ({}));
+const uuid = (n) => `93000000-0000-4000-8900-${String(n).padStart(12, "0")}`;
+const hash = (s) => createHash("sha256").update(s).digest("hex");
+const unavailable = (error) =>
+  error.code === "NATIVE_DWG_RESAVE_SOURCE_UNAVAILABLE";
+
+// Literal approved data: cm LINE (1,2) → (3,4) projects to mm (10,20) → (30,40).
+// Independent current IDs represent a trusted clone; only source anchors bind it.
+function fixture() {
+  const report = {
+    schemaVersion: "1hk-dwg-import/1",
+    qualification: "experimental-unqualified",
+    source: { sha256: "b".repeat(64), byteSize: 1234, headerVersion: "AC1024" },
+    engine: { name: "ACadSharp", version: "3.7.1" },
+    coordinateSystem: "WCS_NATIVE_UNITS",
+    unitCode: 5,
+    modelSpaceHandle: "1F",
+    layers: [{ handle: "10", name: "0", visible: true, locked: false }],
+    entities: [
+      {
+        handle: "2A",
+        ownerHandle: "1F",
+        layerHandle: "10",
+        type: "LINE",
+        geometry: { start: [1, 2, 0], end: [3, 4, 0] },
+      },
+    ],
+    coverage: {
+      modelSpaceEntities: 1,
+      importedEntities: 1,
+      unsupportedEntities: 0,
+      nonModelSpaceEntities: 0,
+    },
+    unsupported: [],
+    readerNotificationCount: 0,
+  };
+  const reportText = JSON.stringify(report),
+    reportSha256 = hash(reportText);
+  const canonical = {
+    schemaVersion: 2,
+    revision: {
+      id: uuid(3),
+      projectId: uuid(1),
+      documentId: uuid(2),
+      sequence: 2,
+      version: 7,
+    },
+    operationSequence: 19,
+    pages: [
+      {
+        id: uuid(4),
+        revisionId: uuid(3),
+        name: "Page",
+        sortOrder: 0,
+        version: 1,
+      },
+    ],
+    canvases: [
+      {
+        id: uuid(5),
+        pageId: uuid(4),
+        name: "Canvas",
+        spaceKind: "paper",
+        widthMillimeters: 21000,
+        heightMillimeters: 14850,
+        background: null,
+        outputProfile: {
+          paper: "A3",
+          orientation: "landscape",
+          widthMillimeters: 420,
+          heightMillimeters: 297,
+          scaleDenominator: 50,
+        },
+        sortOrder: 0,
+        version: 1,
+      },
+    ],
+    layers: [
+      {
+        id: uuid(6),
+        canvasId: uuid(5),
+        pageId: uuid(4),
+        name: "0",
+        visible: true,
+        locked: false,
+        systemKind: "custom",
+        sortOrder: 1,
+        version: 2,
+      },
+      {
+        id: uuid(16),
+        canvasId: uuid(5),
+        pageId: uuid(4),
+        name: "Work",
+        visible: true,
+        locked: false,
+        systemKind: "work",
+        sortOrder: 0,
+        version: 1,
+      },
+    ],
+    objects: [
+      {
+        id: uuid(7),
+        lineageId: uuid(17),
+        pageId: uuid(4),
+        type: "line",
+        name: "DWG LINE 2A",
+        layerId: uuid(6),
+        geometry: {
+          type: "line",
+          start: { x: 10, y: 20 },
+          end: { x: 30, y: 40 },
+        },
+        styleId: null,
+        style: { stroke: "#111827", strokeWidth: 1, fill: null },
+        version: 3,
+      },
+    ],
+    sources: [
+      {
+        id: uuid(8),
+        objectId: uuid(7),
+        revisionId: uuid(3),
+        sourceFileId: uuid(9),
+        sourceSha256: report.source.sha256,
+        sourceKind: "dwg_entity",
+        analysisJobId: uuid(10),
+        reportSha256,
+        handle: "2A",
+        ownerHandle: "1F",
+        layerHandle: "10",
+        entityType: "LINE",
+        sourceLayer: "0",
+        unitCode: 5,
+        unitSource: "declared",
+        importerVersion: 1,
+        version: 3,
+      },
+    ],
+    styles: [],
+    blocks: [],
+    blockInstances: [],
+    propertySchemas: [],
+    propertyValues: [],
+    tables: [],
+    issues: [],
+  };
+  const payload = {
+    approved: {
+      projectId: uuid(1),
+      documentId: uuid(2),
+      canvasId: uuid(5),
+      revision: { id: uuid(3), sequence: 2, version: 7, status: "approved" },
+      snapshot: {
+        sha256: "",
+        schemaVersion: 2,
+        operationSequence: 19,
+        canonicalJsonText: "",
+      },
+      approvalDecision: "approved",
+    },
+    analysis: {
+      scope: {
+        projectId: uuid(1),
+        documentId: uuid(12),
+        revisionId: uuid(13),
+        canvasId: uuid(15),
+        sourceFileId: uuid(9),
+        sourceSha256: report.source.sha256,
+        unitOverride: null,
+      },
+      result: {
+        receipt: {
+          jobId: uuid(10),
+          attemptNumber: 1,
+          readerImageId: "sha256:" + "a".repeat(64),
+          reportSha256,
+          reportByteSize: Buffer.byteLength(reportText),
+          source: {
+            verificationId: uuid(11),
+            fileId: uuid(9),
+            ...report.source,
+          },
+          qualification: "experimental-unqualified",
+          persistenceAuthority: "not-issued",
+        },
+        reportText,
+      },
+    },
+  };
+  const scope = {
+    projectId: uuid(1),
+    documentId: uuid(2),
+    revisionId: uuid(3),
+    revisionVersion: 7,
+    canvasId: uuid(5),
+    snapshotSha256: "",
+  };
+  const rehash = () => {
+    payload.approved.snapshot.canonicalJsonText = JSON.stringify(canonical);
+    scope.snapshotSha256 = payload.approved.snapshot.sha256 = hash(
+      payload.approved.snapshot.canonicalJsonText,
+    );
+  };
+  rehash();
+  return { scope, payload, canonical, report, rehash };
+}
+
+test("approved cloned LINE uses source handle and frozen centimeters; empty default layer and no-op survive", async () => {
+  assert.equal(
+    typeof adapter.projectApprovedNativeDrawingDwgResaveSource,
+    "function",
+    "approved resave projector must exist",
+  );
+  const f = fixture();
+  const noop = await adapter.projectApprovedNativeDrawingDwgResaveSource(
+    f.scope,
+    f.payload,
+  );
+  assert.equal(noop.selectedEdits.request, null);
+  f.canonical.objects[0].geometry.end = { x: 55, y: -65 };
+  f.rehash();
+  const result = await adapter.projectApprovedNativeDrawingDwgResaveSource(
+    f.scope,
+    f.payload,
+  );
+  assert.deepEqual(result.selectedEdits.request, {
+    schemaVersion: "1hk-dwg-edits/2",
+    sourceSha256: "b".repeat(64),
+    coordinateSystem: "WCS_NATIVE_UNITS",
+    edits: [
+      { handle: "2A", type: "LINE", start: [1, 2, 0], end: [5.5, -6.5, 0] },
+    ],
+  });
+  assert.deepEqual(result.bindings, [{ objectId: uuid(7), handle: "2A" }]);
+  assert.deepEqual(result.approved, {
+    revisionId: uuid(3),
+    revisionVersion: 7,
+    snapshotSha256: f.scope.snapshotSha256,
+    operationSequence: 19,
+  });
+  assert.deepEqual(result.analysisReceipt, f.payload.analysis.result.receipt);
+  assert.equal(result.selectedEdits.persistenceAuthority, "not-issued");
+  assert.equal(result.selectedEdits.qualification, "experimental-unqualified");
+});
+
+test("rehashed malicious anchors and unsupported canonical edits fail instead of being normalized", async (t) => {
+  assert.equal(
+    typeof adapter.projectApprovedNativeDrawingDwgResaveSource,
+    "function",
+  );
+  const cases = [
+    ...Object.entries({
+      handle: "2B",
+      ownerHandle: "FF",
+      layerHandle: "11",
+      entityType: "TEXT",
+      sourceLayer: "fake",
+      unitCode: 4,
+      unitSource: "user_selected",
+      analysisJobId: uuid(88),
+      reportSha256: "c".repeat(64),
+      sourceFileId: uuid(88),
+      sourceSha256: "c".repeat(64),
+      revisionId: uuid(88),
+      importerVersion: 2,
+    }).map(([key, value]) => [
+      key,
+      (f) => {
+        f.canonical.sources[0][key] = value;
+      },
+    ]),
+    ["missing source", (f) => f.canonical.sources.pop()],
+    [
+      "duplicate source",
+      (f) =>
+        f.canonical.sources.push({ ...f.canonical.sources[0], id: uuid(80) }),
+    ],
+    ["missing object", (f) => f.canonical.objects.pop()],
+    [
+      "added object",
+      (f) =>
+        f.canonical.objects.push({ ...f.canonical.objects[0], id: uuid(80) }),
+    ],
+    [
+      "wrong object anchor",
+      (f) => {
+        f.canonical.sources[0].objectId = uuid(80);
+      },
+    ],
+    [
+      "renamed layer",
+      (f) => {
+        f.canonical.layers[0].name = "fake";
+      },
+    ],
+    [
+      "layer visibility",
+      (f) => {
+        f.canonical.layers[0].visible = false;
+      },
+    ],
+    [
+      "layer lock",
+      (f) => {
+        f.canonical.layers[0].locked = true;
+      },
+    ],
+    [
+      "layer kind",
+      (f) => {
+        f.canonical.layers[0].systemKind = "work";
+      },
+    ],
+    [
+      "layer order",
+      (f) => {
+        f.canonical.layers[0].sortOrder = 9;
+      },
+    ],
+    [
+      "object relayer",
+      (f) => {
+        f.canonical.objects[0].layerId = uuid(16);
+      },
+    ],
+    [
+      "renamed object",
+      (f) => {
+        f.canonical.objects[0].name = "fake";
+      },
+    ],
+    [
+      "object style",
+      (f) => {
+        f.canonical.objects[0].style.stroke = "#ff0000";
+      },
+    ],
+    [
+      "background",
+      (f) => {
+        f.canonical.canvases[0].background = { kind: "pdf" };
+      },
+    ],
+    [
+      "extra page",
+      (f) => f.canonical.pages.push({ ...f.canonical.pages[0], id: uuid(80) }),
+    ],
+  ];
+  for (const [label, mutate] of cases)
+    await t.test(label, async () => {
+      const f = fixture();
+      mutate(f);
+      f.rehash();
+      await assert.rejects(
+        adapter.projectApprovedNativeDrawingDwgResaveSource(f.scope, f.payload),
+        unavailable,
+      );
+    });
+});
+
+test("strict envelopes, snapshot/report hashes, approval and source scope are required", async (t) => {
+  assert.equal(
+    typeof adapter.projectApprovedNativeDrawingDwgResaveSource,
+    "function",
+  );
+  for (const [label, mutate] of [
+    [
+      "snapshot bytes",
+      (f) => {
+        f.payload.approved.snapshot.canonicalJsonText += " ";
+      },
+    ],
+    [
+      "report bytes",
+      (f) => {
+        f.payload.analysis.result.reportText += " ";
+      },
+    ],
+    [
+      "report size",
+      (f) => {
+        f.payload.analysis.result.receipt.reportByteSize++;
+      },
+    ],
+    [
+      "draft",
+      (f) => {
+        f.payload.approved.revision.status = "draft";
+      },
+    ],
+    [
+      "unapproved",
+      (f) => {
+        f.payload.approved.approvalDecision = "reviewed";
+      },
+    ],
+    [
+      "foreign project",
+      (f) => {
+        f.payload.analysis.scope.projectId = uuid(99);
+      },
+    ],
+    [
+      "wrong requested canvas",
+      (f) => {
+        f.scope.canvasId = uuid(99);
+      },
+    ],
+    [
+      "wrong requested version",
+      (f) => {
+        f.scope.revisionVersion++;
+      },
+    ],
+    [
+      "unit override",
+      (f) => {
+        f.payload.analysis.scope.unitOverride = 4;
+      },
+    ],
+    [
+      "private source descriptor",
+      (f) => {
+        f.payload.analysis.result.receipt.source.path = "secret";
+      },
+    ],
+    [
+      "caller edits",
+      (f) => {
+        f.scope.objects = [];
+      },
+    ],
+  ])
+    await t.test(label, async () => {
+      const f = fixture();
+      mutate(f);
+      await assert.rejects(
+        adapter.projectApprovedNativeDrawingDwgResaveSource(f.scope, f.payload),
+        unavailable,
+      );
+    });
+});
+
+test("RPC loader forwards only validated scope and returns compiled results or a bounded error", async () => {
+  assert.equal(
+    typeof adapter.loadApprovedNativeDrawingDwgResaveSource,
+    "function",
+  );
+  const f = fixture();
+  const client = {
+    async rpc(name, args) {
+      assert.equal(this, client);
+      assert.equal(name, "lukas_qto_drawing_native_dwg_resave_source");
+      assert.deepEqual(args, { p_scope: f.scope });
+      return { data: f.payload, error: null };
+    },
+  };
+  assert.equal(
+    (await adapter.loadApprovedNativeDrawingDwgResaveSource(client, f.scope))
+      .selectedEdits.request,
+    null,
+  );
+  for (const rpc of [
+    null,
+    async () => {
+      throw Error("private path");
+    },
+    async () => ({ data: f.payload, error: { message: "private SQL" } }),
+    async () => null,
+  ])
+    await assert.rejects(
+      adapter.loadApprovedNativeDrawingDwgResaveSource({ rpc }, f.scope),
+      (e) => unavailable(e) && !/private/.test(e.message),
+    );
+});
+
+test("same analysis revision requires exact native layer, object and source identities after rehashing", async (t) => {
+  for (const mutation of [
+    "layer",
+    "object",
+    "source",
+    "all",
+    "document",
+    "canvas",
+  ]) {
+    await t.test(mutation, async () => {
+      const f = fixture();
+      const plan = buildNativeDrawingDwgImportPlan({
+        report: f.report,
+        expectedSource: f.report.source,
+        revisionId: f.scope.revisionId,
+        canvasId: f.scope.canvasId,
+        sourceFileId: uuid(9),
+        analysisJobId: uuid(10),
+        reportSha256: f.payload.analysis.result.receipt.reportSha256,
+      });
+      Object.assign(f.payload.analysis.scope, {
+        documentId: f.scope.documentId,
+        revisionId: f.scope.revisionId,
+        canvasId: f.scope.canvasId,
+      });
+      f.canonical.layers = plan.layers.map((layer) => ({
+        ...layer,
+        pageId: uuid(4),
+      }));
+      f.canonical.objects = plan.objects.map((object) => ({
+        ...object,
+        lineageId: uuid(17),
+        pageId: uuid(4),
+        type: object.geometry.type,
+      }));
+      f.canonical.sources = structuredClone(plan.sources);
+      f.rehash();
+      assert.equal(
+        (
+          await adapter.projectApprovedNativeDrawingDwgResaveSource(
+            f.scope,
+            f.payload,
+          )
+        ).selectedEdits.request,
+        null,
+      );
+      if (mutation === "layer" || mutation === "all") {
+        f.canonical.layers[0].id = uuid(60);
+        f.canonical.objects[0].layerId = uuid(60);
+      }
+      if (mutation === "object" || mutation === "all") {
+        f.canonical.objects[0].id = uuid(61);
+        f.canonical.sources[0].objectId = uuid(61);
+      }
+      if (mutation === "source" || mutation === "all")
+        f.canonical.sources[0].id = uuid(71);
+      if (mutation === "document")
+        f.payload.analysis.scope.documentId = uuid(82);
+      if (mutation === "canvas") f.payload.analysis.scope.canvasId = uuid(85);
+      f.rehash();
+      await assert.rejects(
+        adapter.projectApprovedNativeDrawingDwgResaveSource(f.scope, f.payload),
+        unavailable,
+      );
+    });
+  }
+});
+
+test("approved original and clone compile all five geometry types with native handle ordering", async () => {
+  const f = fixture();
+  f.report.entities.push(
+    {
+      handle: "3",
+      ownerHandle: "1F",
+      layerHandle: "10",
+      type: "TEXT",
+      geometry: { insert: [1, 2, 0], height: 2, text: "Base" },
+    },
+    {
+      handle: "4",
+      ownerHandle: "1F",
+      layerHandle: "10",
+      type: "LWPOLYLINE",
+      geometry: {
+        points: [
+          [0, 0, 0],
+          [2, 3, 0],
+        ],
+        closed: false,
+      },
+    },
+    {
+      handle: "5",
+      ownerHandle: "1F",
+      layerHandle: "10",
+      type: "CIRCLE",
+      geometry: { center: [4, 5, 0], radius: 2 },
+    },
+    {
+      handle: "6",
+      ownerHandle: "1F",
+      layerHandle: "10",
+      type: "ARC",
+      geometry: {
+        center: [7, 8, 0],
+        radius: 3,
+        startAngleRadians: 0.25,
+        endAngleRadians: 2.5,
+      },
+    },
+  );
+  f.report.coverage.modelSpaceEntities = f.report.coverage.importedEntities = 5;
+  const result = f.payload.analysis.result;
+  result.reportText = JSON.stringify(f.report);
+  result.receipt.reportSha256 = hash(result.reportText);
+  result.receipt.reportByteSize = Buffer.byteLength(result.reportText);
+  const plan = buildNativeDrawingDwgImportPlan({
+    report: f.report,
+    expectedSource: f.report.source,
+    revisionId: uuid(3),
+    canvasId: uuid(5),
+    sourceFileId: uuid(9),
+    analysisJobId: uuid(10),
+    reportSha256: result.receipt.reportSha256,
+  });
+  f.payload.analysis.scope.documentId = uuid(2);
+  f.payload.analysis.scope.revisionId = uuid(3);
+  f.payload.analysis.scope.canvasId = uuid(5);
+  f.canonical.layers = plan.layers.map((layer) => ({
+    ...layer,
+    pageId: uuid(4),
+  }));
+  f.canonical.objects = plan.objects.map((object, i) => ({
+    ...object,
+    lineageId: uuid(30 + i),
+    pageId: uuid(4),
+    type: object.geometry.type,
+  }));
+  f.canonical.sources = structuredClone(plan.sources);
+  f.rehash();
+  assert.equal(
+    (
+      await adapter.projectApprovedNativeDrawingDwgResaveSource(
+        f.scope,
+        f.payload,
+      )
+    ).selectedEdits.request,
+    null,
+  );
+  const [line, text, polyline, circle, arc] = f.canonical.objects;
+  line.geometry.end = { x: 55, y: -65 };
+  text.geometry.origin = { x: 15, y: 25 };
+  text.geometry.text = "Edited";
+  text.style.fontSize = 30;
+  polyline.geometry.points[1] = { x: 25, y: 35 };
+  polyline.geometry.closed = true;
+  circle.geometry.radius = 25;
+  arc.geometry.center = { x: 75, y: 85 };
+  const expected = [
+    {
+      handle: "3",
+      type: "TEXT",
+      insert: [1.5, 2.5, 0],
+      height: 3,
+      text: "Edited",
+    },
+    {
+      handle: "4",
+      type: "LWPOLYLINE",
+      points: [
+        [0, 0, 0],
+        [2.5, 3.5, 0],
+      ],
+      closed: true,
+    },
+    { handle: "5", type: "CIRCLE", center: [4, 5, 0], radius: 2.5 },
+    {
+      handle: "6",
+      type: "ARC",
+      center: [7.5, 8.5, 0],
+      radius: 3,
+      startAngleRadians: 0.25,
+      endAngleRadians: 2.5,
+    },
+    { handle: "2A", type: "LINE", start: [1, 2, 0], end: [5.5, -6.5, 0] },
+  ];
+  f.rehash();
+  assert.deepEqual(
+    (
+      await adapter.projectApprovedNativeDrawingDwgResaveSource(
+        f.scope,
+        f.payload,
+      )
+    ).selectedEdits.request.edits,
+    expected,
+  );
+  // The clone has its own approved revision/document/canvas and retains the
+  // historical analysis scope; changing IDs within the original is not a clone.
+  Object.assign(f.scope, {
+    documentId: uuid(82),
+    revisionId: uuid(83),
+    canvasId: uuid(85),
+  });
+  Object.assign(f.payload.approved, {
+    documentId: uuid(82),
+    canvasId: uuid(85),
+  });
+  f.payload.approved.revision.id = uuid(83);
+  Object.assign(f.canonical.revision, { id: uuid(83), documentId: uuid(82) });
+  f.canonical.pages[0].revisionId = uuid(83);
+  f.canonical.canvases[0].id = uuid(85);
+  f.canonical.layers[0].canvasId = uuid(85);
+  f.canonical.layers[0].id = uuid(60);
+  f.canonical.objects.forEach((object, i) => {
+    object.id = uuid(61 + i);
+    object.layerId = uuid(60);
+    f.canonical.sources[i].objectId = object.id;
+    f.canonical.sources[i].id = uuid(71 + i);
+    f.canonical.sources[i].revisionId = uuid(83);
+  });
+  f.rehash();
+  const cloned = await adapter.projectApprovedNativeDrawingDwgResaveSource(
+    f.scope,
+    f.payload,
+  );
+  assert.deepEqual(cloned.selectedEdits.request.edits, expected);
+  assert.deepEqual(
+    cloned.bindings.map((b) => b.handle),
+    ["3", "4", "5", "6", "2A"],
+  );
+});


## platform/tests/fixtures/drawing-native-dwg-resave-source-database.mjs

diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/fixtures/drawing-native-dwg-resave-source-database.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/fixtures/drawing-native-dwg-resave-source-database.mjs
new file mode 100644
index 0000000..326b8ff
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/fixtures/drawing-native-dwg-resave-source-database.mjs
@@ -0,0 +1,201 @@
+import assert from "node:assert/strict";
+import { randomUUID } from "node:crypto";
+import { fileURLToPath } from "node:url";
+import { createServer } from "vite";
+
+export async function proveApprovedNativeDwgResaveSource({
+  owner,
+  ids,
+  scope,
+  approved,
+}) {
+  const [revision] =
+    await owner`select version from public.lukas_drawing_revisions where id=${scope.revisionId}::uuid`;
+  const [snapshot] =
+    await owner`select sha256,canonical_json from public.lukas_drawing_snapshots where revision_id=${scope.revisionId}::uuid and revision_version=${revision.version}::bigint`;
+  const request = {
+    projectId: scope.projectId,
+    documentId: scope.documentId,
+    revisionId: scope.revisionId,
+    revisionVersion: Number(revision.version),
+    canvasId: scope.canvasId,
+    snapshotSha256: snapshot?.sha256 ?? "0".repeat(64),
+  };
+  const call = (
+    actor = ids.users.editor,
+    input = request,
+    role = "authenticated",
+    anonymous = false,
+  ) =>
+    owner.begin(async (tx) => {
+      assert.ok(["authenticated", "anon", "service_role"].includes(role));
+      await tx.unsafe(`set local role "${role}"`);
+      await tx`select set_config('request.jwt.claims',${JSON.stringify({ role, sub: actor, is_anonymous: anonymous })},true)`;
+      const [row] =
+        await tx`select public.lukas_qto_drawing_native_dwg_resave_source(${tx.json(input)}) value`;
+      return row.value;
+    });
+  const denied = (promise, code = "PNR01") =>
+    assert.rejects(promise, (e) => {
+      assert.equal(e.code, code, e.message);
+      if (code === "PNR01")
+        assert.equal(e.message, "Approved DWG resave source is unavailable");
+      return true;
+    });
+  if (!approved) {
+    await denied(call());
+    return;
+  }
+  const payload = await call();
+  for (const role of [
+    "anon",
+    "authenticated",
+    "service_role",
+    "lukas_drawing_collaboration",
+  ]) {
+    const [privileges] = await owner`select
+      has_function_privilege(${role},'private.lukas_drawing_native_dwg_resave_source_for_actor(uuid,jsonb)','EXECUTE') private_execute,
+      has_function_privilege(${role},'public.lukas_qto_drawing_native_dwg_resave_source(jsonb)','EXECUTE') public_execute`;
+    assert.deepEqual(privileges, {
+      private_execute: false,
+      public_execute: role === "authenticated",
+    });
+  }
+  assert.deepEqual(Object.keys(payload).sort(), ["analysis", "approved"]);
+  assert.equal(payload.approved.snapshot.sha256, request.snapshotSha256);
+  assert.equal(payload.analysis.scope.sourceFileId, scope.sourceFileId);
+  assert.deepEqual(Object.keys(payload.analysis.result.receipt.source).sort(), [
+    "byteSize",
+    "fileId",
+    "headerVersion",
+    "sha256",
+    "verificationId",
+  ]);
+  // Imported revisions must remain ineligible for the original source-free branch.
+  await denied(
+    owner.begin(async (tx) => {
+      await tx.unsafe("set local role authenticated");
+      await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: "authenticated", sub: ids.users.editor, is_anonymous: false })},true)`;
+      return tx`select public.lukas_qto_drawing_native_dwg_source(${request.projectId}::uuid,${request.documentId}::uuid,${request.revisionId}::uuid,${request.revisionVersion}::bigint,${request.canvasId}::uuid,${request.snapshotSha256})`;
+    }),
+    "PND01",
+  );
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
+    const { projectApprovedNativeDrawingDwgResaveSource } =
+      await vite.ssrLoadModule(
+        "/app/lukas/lib/drawing-native-dwg-resave-source.server.ts",
+      );
+    const result = await projectApprovedNativeDrawingDwgResaveSource(
+      request,
+      payload,
+    );
+    assert.equal(result.selectedEdits.request, null);
+    assert.deepEqual(
+      result.bindings.map((b) => b.objectId).sort(),
+      snapshot.canonical_json.objects.map((o) => o.id).sort(),
+    );
+    assert.deepEqual(
+      result.bindings.map((b) => b.handle),
+      ["4A", "4B", "4C", "4D", "4E"],
+    );
+    assert.equal(result.selectedEdits.persistenceAuthority, "not-issued");
+  } finally {
+    await vite.close();
+  }
+  await denied(call(ids.users.outsider));
+  assert.equal(
+    (await call(ids.users.viewer)).approved.snapshot.sha256,
+    request.snapshotSha256,
+  );
+  await denied(call(null));
+  await denied(call(ids.users.editor, request, "authenticated", true));
+  await denied(call(null, request, "anon"), "42501");
+  await denied(call(null, request, "service_role"), "42501");
+  for (const patch of [
+    { projectId: randomUUID() },
+    { documentId: randomUUID() },
+    { canvasId: randomUUID() },
+    { revisionId: randomUUID() },
+    { revisionVersion: request.revisionVersion + 1 },
+    { snapshotSha256: "f".repeat(64) },
+    { extra: true },
+  ])
+    await denied(call(ids.users.editor, { ...request, ...patch }));
+  const sourceId = snapshot.canonical_json.sources[0].id;
+  // Poison evidence only inside this disposable fixture's rolled-back owner
+  // transaction. Bypass write guards so the read contract itself is tested.
+  const corruptions = [
+    (tx) =>
+      tx`update public.lukas_qto_projects set archived_at=clock_timestamp(),archived_by=${ids.users.owner}::uuid,retention_event_id=${randomUUID()}::uuid where id=${scope.projectId}::uuid`,
+    (tx) =>
+      tx`update public.lukas_qto_projects set archived_at=clock_timestamp(),archived_by=${ids.users.owner}::uuid,retention_event_id=${randomUUID()}::uuid,deletion_requested_at=clock_timestamp(),deletion_requested_by=${ids.users.owner}::uuid,purge_after=clock_timestamp()+interval '1 day' where id=${scope.projectId}::uuid`,
+    (tx) =>
+      tx`delete from public.lukas_qto_project_members where project_id=${scope.projectId}::uuid and user_id=${ids.users.editor}::uuid`,
+    (tx) =>
+      tx`update public.lukas_drawing_object_sources set status='deleted' where id=${sourceId}::uuid`,
+    (tx) =>
+      tx`update public.lukas_drawing_object_sources set dwg_entity_json=jsonb_set(dwg_entity_json,'{handle}','"FFFF"') where id=${sourceId}::uuid`,
+    (tx) =>
+      tx`update public.lukas_qto_verified_uploads set dwg_header_version='AC9999' where consumed_file_id=${scope.sourceFileId}::uuid`,
+    (tx) =>
+      tx`update public.lukas_drawing_native_dwg_import_results set reader_image_id=${"sha256:" + "f".repeat(64)} where job_id=${payload.analysis.result.receipt.jobId}::uuid`,
+    (tx) =>
+      tx`update public.lukas_drawing_snapshots set canonical_json=jsonb_set(canonical_json,'{operationSequence}','999') where revision_id=${request.revisionId}::uuid and revision_version=${request.revisionVersion}::bigint`,
+    (tx) =>
+      tx`update public.lukas_drawing_documents set source_file_id=${scope.sourceFileId}::uuid,source_sha256=${"f".repeat(64)} where id=${request.documentId}::uuid`,
+  ];
+  for (const corrupt of corruptions)
+    await denied(
+      owner.begin(async (tx) => {
+        await tx.unsafe("set local session_replication_role=replica");
+        await corrupt(tx);
+        await tx.unsafe("set local role authenticated");
+        await tx`select set_config('request.jwt.claims',${JSON.stringify({ role: "authenticated", sub: ids.users.editor, is_anonymous: false })},true)`;
+        return tx`select public.lukas_qto_drawing_native_dwg_resave_source(${tx.json(request)})`;
+      }),
+    );
+  for (const field of ["banned_until", "deleted_at"]) {
+    await owner
+      .begin(async (tx) => {
+        await tx.unsafe(
+          `update auth.users set ${field}=clock_timestamp()+interval '1 day' where id=$1::uuid`,
+          [ids.users.editor],
+        );
+        const [row] =
+          await tx`select private.lukas_drawing_native_dwg_resave_source_for_actor(${ids.users.editor}::uuid,${tx.json(request)}) value`;
+        assert.equal(row.value, null);
+        throw Object.assign(new Error("rollback probe"), {
+          rollbackProbe: true,
+        });
+      })
+      .catch((e) => {
+        if (!e.rollbackProbe) throw e;
+      });
+  }
+  const [preserved] =
+    await owner`select sha256,canonical_json::text snapshot_text from public.lukas_drawing_snapshots where revision_id=${request.revisionId}::uuid and revision_version=${request.revisionVersion}::bigint`;
+  assert.equal(preserved.sha256, request.snapshotSha256);
+  assert.equal(
+    preserved.snapshot_text,
+    payload.approved.snapshot.canonicalJsonText,
+  );
+  const [file] =
+    await owner`select sha256 from public.lukas_qto_files where id=${scope.sourceFileId}::uuid`;
+  assert.equal(file.sha256, scope.sourceSha256);
+  const plan =
+    await owner`explain (analyze,buffers,format json) select private.lukas_drawing_native_dwg_resave_source_for_actor(${ids.users.editor}::uuid,${owner.json(request)})`;
+  console.info("Approved DWG resave RPC accepted", {
+    revisionId: request.revisionId,
+    objects: 5,
+    executionMilliseconds: plan[0]["QUERY PLAN"][0]["Execution Time"],
+  });
+}


## platform/tests/fixtures/drawing-native-dwg-canonical-import-database.mjs

diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/baseline-code/platform/tests/fixtures/drawing-native-dwg-canonical-import-database.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/fixtures/drawing-native-dwg-canonical-import-database.mjs
index 1b186d7..e1a0d2d 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-approved-resave-source/baseline-code/platform/tests/fixtures/drawing-native-dwg-canonical-import-database.mjs
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/fixtures/drawing-native-dwg-canonical-import-database.mjs
@@ -1,20 +1,21 @@
 import assert from "node:assert/strict";
 import { createHash, randomUUID } from "node:crypto";
 import { readFile } from "node:fs/promises";
 import {
   applyDrawingCommand,
   createDrawingDocumentState,
   undoDrawingCommandUnit,
   redoDrawingCommandUnit,
 } from "../../app/lukas/lib/drawing-commands.ts";
 import { parseVerifiedBoqV1_1RpcInput } from "../../app/lukas/lib/drawing-quantity-lineage.server.ts";
+import { proveApprovedNativeDwgResaveSource } from "./drawing-native-dwg-resave-source-database.mjs";
 
 const session = (sql, role, actor, callback) =>
   sql.begin(async (tx) => {
     assert.ok(["authenticated", "service_role"].includes(role));
     await tx.unsafe(`set local role "${role}"`);
     await tx`select set_config('request.jwt.claims',${JSON.stringify({ role, sub: actor, is_anonymous: false })},true)`;
     return callback(tx);
   });
 const denied = (promise, code) =>
   assert.rejects(promise, (error) => {
@@ -354,20 +355,26 @@ export async function proveNativeDwgCanonicalImportAuthority({
           "authenticated",
           actor,
           (tx) =>
             tx`select public.lukas_drawing_request_review(${scope.revisionId}::uuid)`,
         ),
       );
   }
   const [fresh] =
     await workerA`select private.lukas_drawing_p2_canonical_snapshot(${scope.revisionId}::uuid,true) value`;
   assert.equal(fresh.value.sources.length, 5);
+  await proveApprovedNativeDwgResaveSource({
+    owner,
+    ids,
+    scope,
+    approved: false,
+  });
   assert.deepEqual(fresh.value.sources.map((s) => s.handle).sort(), [
     "4A",
     "4B",
     "4C",
     "4D",
     "4E",
   ]);
   for (const source of fresh.value.sources) {
     assert.equal(source.sourceKind, "dwg_entity");
     assert.equal(source.analysisJobId, jobId);
@@ -664,20 +671,26 @@ export async function proveNativeDwgCanonicalImportAuthority({
     [ids.users.reviewer, "reviewed"],
     [ids.users.approver, "approved"],
   ])
     await session(
       owner,
       "authenticated",
       who,
       (tx) =>
         tx`select public.lukas_drawing_record_revision_decision(${scope.revisionId}::uuid,${snapshot.revision_version}::bigint,${snapshot.sha256},${decision},'Native lineage proof')`,
     );
+  await proveApprovedNativeDwgResaveSource({
+    owner,
+    ids,
+    scope,
+    approved: true,
+  });
   for (const method of ["template", "restore"]) {
     const cloneRequestId = randomUUID();
     const cloneCall = () =>
       session(owner, "authenticated", actor, (tx) =>
         method === "template"
           ? tx`select public.lukas_drawing_create_from_template(${scope.revisionId}::uuid,'Native clone',null::uuid,${cloneRequestId}::uuid) value`
           : tx`select public.lukas_drawing_restore_approved_snapshot(${scope.revisionId}::uuid,${cloneRequestId}::uuid) value`,
       );
     const [clone] = await cloneCall();
     assert.deepEqual((await cloneCall())[0].value, clone.value);
@@ -686,20 +699,58 @@ export async function proveNativeDwgCanonicalImportAuthority({
     assert.equal(copy.value.sources.length, 5, method);
     for (const source of copy.value.sources) {
       assert.equal(source.analysisJobId, jobId);
       assert.equal(source.reportSha256, reportSha256);
       assert.notEqual(source.revisionId, scope.revisionId);
     }
     const locked = copy.value.layers.find((layer) => layer.name === "QA_TEXT");
     assert.equal(locked.visible, false);
     assert.equal(locked.locked, true);
     assert.equal(locked.version, 2);
+    const cloneScope = {
+      ...scope,
+      documentId: copy.value.revision.documentId,
+      revisionId: clone.value.revisionId,
+      canvasId: copy.value.canvases[0].id,
+    };
+    await proveApprovedNativeDwgResaveSource({
+      owner,
+      ids,
+      scope: cloneScope,
+      approved: false,
+    });
+    const [cloneReview] = await session(
+      owner,
+      "authenticated",
+      actor,
+      (tx) =>
+        tx`select public.lukas_drawing_request_review(${cloneScope.revisionId}::uuid) value`,
+    );
+    const [cloneSnapshot] =
+      await owner`select sha256,revision_version from public.lukas_drawing_snapshots where id=${cloneReview.value.snapshotId}::uuid`;
+    for (const [who, decision] of [
+      [ids.users.reviewer, "reviewed"],
+      [ids.users.approver, "approved"],
+    ])
+      await session(
+        owner,
+        "authenticated",
+        who,
+        (tx) =>
+          tx`select public.lukas_drawing_record_revision_decision(${cloneScope.revisionId}::uuid,${cloneSnapshot.revision_version}::bigint,${cloneSnapshot.sha256},${decision},'Approved clone resave proof')`,
+      );
+    await proveApprovedNativeDwgResaveSource({
+      owner,
+      ids,
+      scope: cloneScope,
+      approved: true,
+    });
   }
   for (const [table, code] of [
     ["lukas_drawing_template_clone_requests", "P1C01"],
     ["lukas_drawing_snapshot_restore_requests", "P3S01"],
   ]) {
     await denied(
       owner.unsafe(`delete from private.${table} where project_id=$1::uuid`, [
         projectId,
       ]),
       code,

