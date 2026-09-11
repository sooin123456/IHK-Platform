# Task4 exact pre-task review package

Worktree /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1, branch codex/universal-workspace-m1. HEAD/base/head9f5f56d93db325ff935772252f9d4fb64d69f98c unchanged; no commits or staged changes. Exact public pre-task copies (not HEAD) are review authority. Eight modified files, ten new files, eighteen total. Snapshot hashes are in task-4-baselines.md and final hashes in report. Review scoped diff once; do not rederive from git or crawl unrelated dirty work.

## app/routes.ts

Final SHA256 4c99a2fdf4eae975228ef3ae38712afeaff085c9fecdca135d792e638ceea045
Baseline /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-routes.ts

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-routes.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/routes.ts
index 8d53133..7aa2c4a 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-routes.ts
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/routes.ts
@@ -105,24 +105,32 @@ export default [
         { id: "drawing-workspace" },
       ),
       route(
         "/projects/:projectId/workspaces/:workspaceId/operation",
         "lukas/screens/drawing-workspace-operation.ts",
         { id: "drawing-workspace-operation" },
       ),
       route(
         "/projects/:projectId/workspaces/:workspaceId/export",
         "lukas/screens/drawing-workspace-export.ts",
         { id: "drawing-workspace-export" },
       ),
+      route(
+        "/projects/:projectId/workspaces/:workspaceId/native-dwg-resave",
+        "lukas/screens/drawing-native-dwg-resave.ts",
+      ),
+      route(
+        "/projects/:projectId/workspaces/:workspaceId/native-dwg-resave/:jobId/download/:kind",
+        "lukas/screens/drawing-native-dwg-resave-download.ts",
+      ),
       route(
         "/projects/:projectId/workspaces/:workspaceId/native-dwg",
         "lukas/screens/drawing-native-dwg-export.ts",
         { id: "drawing-native-dwg-export" },
       ),
       route(
         "/projects/:projectId/workspaces/:workspaceId/native-dwg/:jobId/download/:kind",
         "lukas/screens/drawing-native-dwg-download.ts",
         { id: "drawing-native-dwg-download" },
       ),
       route(
         "/projects/:projectId/workspaces/:workspaceId/measurement-evidence",
```

## app/lukas/lib/drawing-workspace-paths.ts

Final SHA256 d040e7448611f49af42d4e754d016e5a2d7a116837fc46ea0aa672ea4cdf9f0a
Baseline /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-workspace-paths.ts

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-workspace-paths.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-workspace-paths.ts
index bd06335..75913f1 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-workspace-paths.ts
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-workspace-paths.ts
@@ -45,24 +45,40 @@ export function drawingNativeDwgExportPath(
   return `${drawingWorkspacePath(projectId, workspaceId)}/native-dwg`;
 }
 
 export function drawingNativeDwgDownloadPath(
   projectId: string,
   workspaceId: string,
   jobId: string,
   kind: "dwg" | "source_manifest" | "authority" | "report",
 ) {
   return `${drawingNativeDwgExportPath(projectId, workspaceId)}/${Uuid.parse(jobId)}/download/${kind}`;
 }
 
+export function drawingNativeDwgResavePath(
+  projectId: string,
+  documentId: string,
+) {
+  return `${drawingWorkspacePath(Uuid.parse(projectId).toLowerCase(), Uuid.parse(documentId).toLowerCase())}/native-dwg-resave`;
+}
+
+export function drawingNativeDwgResaveDownloadPath(
+  projectId: string,
+  documentId: string,
+  jobId: string,
+  kind: "dwg" | "edit_request" | "authority" | "report",
+) {
+  return `${drawingNativeDwgResavePath(projectId, documentId)}/${Uuid.parse(jobId).toLowerCase()}/download/${z.enum(["dwg", "edit_request", "authority", "report"]).parse(kind)}`;
+}
+
 export function drawingWorkspaceMeasurementEvidencePath({
   projectId,
   workspaceId,
   revisionId,
   revisionVersion,
   snapshotSha256,
   operationCheckpoint,
 }: {
   projectId: string;
   workspaceId: string;
   revisionId: string;
   revisionVersion: number;
```

## app/lukas/components/drawing-export-dialog.tsx

Final SHA256 153f6fa0c45c0b9eeceba5a2e2fed9fc12e4bbac3613a2224f8d413b60c36824
Baseline /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-export-dialog.tsx

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-export-dialog.tsx b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/components/drawing-export-dialog.tsx
index b6f9a09..5c60fef 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-export-dialog.tsx
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/components/drawing-export-dialog.tsx
@@ -15,34 +15,36 @@ import type { DrawingDocumentSnapshot } from "~/lukas/lib/drawing-document-store
 import {
   exportDrawingPdf,
   exportDrawingPng,
   exportDrawingSvg,
   drawingExportSize,
   type DrawingExportBackground,
 } from "~/lukas/lib/drawing-export";
 import { drawingPdfImagePlacement } from "~/lukas/lib/drawing-workspace-view";
 import { drawingWorkspaceExportPath } from "~/lukas/lib/drawing-workspace-paths";
 import type { DrawingWorkspaceDocument } from "~/lukas/lib/drawing-workspace.server";
 import type { DrawingCanvas } from "~/lukas/lib/drawing-workspace.types";
 import { NativeDrawingDwgExportControl } from "./drawing-native-dwg-export";
+import { NativeDrawingDwgResaveControl } from "./drawing-native-dwg-resave-control";
 
 type ExportFormat = "pdf" | "png" | "svg" | "dwg";
 type ExportStatus =
   | { kind: "idle" }
   | { kind: "working"; message: string }
   | { kind: "success"; message: string }
   | { kind: "error"; message: string };
 
 export type DrawingExportDialogProps = {
   auditRequired?: boolean;
+  currentUserId?: string | null;
   checkpointSha256: string | null;
   createdAt: string;
   documentState: DrawingDocumentSnapshot;
   hideTrigger?: boolean;
   onOpenChange?: (open: boolean) => void;
   open?: boolean;
   operationCheckpoint: number | null;
   outboxReady: boolean;
   projectId: string;
   revisionId: string;
   revisionStatus?: DrawingWorkspaceDocument["revision"]["status"];
   revisionVersion: number;
@@ -412,24 +414,25 @@ export async function pdfBackground(
         sourceSha256: canvas.background.sourceSha256,
       },
       dispose,
     };
   } catch (error) {
     await dispose();
     throw error;
   }
 }
 
 export function DrawingExportDialog({
   auditRequired = true,
+  currentUserId,
   checkpointSha256,
   createdAt,
   documentState,
   hideTrigger = false,
   onOpenChange,
   open: controlledOpen,
   operationCheckpoint,
   outboxReady,
   projectId,
   revisionId,
   revisionStatus = "draft",
   revisionVersion,
@@ -694,25 +697,53 @@ export function DrawingExportDialog({
         ) : null}
         {format === "pdf" && activeCanvas?.spaceKind === "model" ? (
           <label className="flex min-h-10 items-center gap-2 text-sm">
             <input
               checked={currentModelOnly}
               disabled={exporting}
               onChange={(event) => setCurrentModelOnly(event.target.checked)}
               type="checkbox"
             />
             현재 모델 캔버스만 명시적으로 PDF에 포함
           </label>
         ) : null}
-        {format === "dwg" ? (
+        {format === "dwg" &&
+        Object.values(documentState.structure?.sources ?? {}).some(
+          (source) => source.sourceKind === "dwg_entity",
+        ) ? (
+          <NativeDrawingDwgResaveControl
+            currentUserId={currentUserId}
+            open={open}
+            readiness={
+              auditRequired &&
+              outboxReady &&
+              saveStatus === "저장됨" &&
+              operationCheckpoint !== null &&
+              checkpointSha256 !== null &&
+              (revisionStatus === "approved" || revisionStatus === "superseded")
+            }
+            scope={
+              documentState.activeCanvasId && checkpointSha256
+                ? {
+                    projectId,
+                    documentId: workspaceId,
+                    revisionId,
+                    revisionVersion,
+                    canvasId: documentState.activeCanvasId,
+                    snapshotSha256: checkpointSha256,
+                  }
+                : null
+            }
+          />
+        ) : format === "dwg" ? (
           <NativeDrawingDwgExportControl
             backendAvailable={auditRequired}
             documentState={documentState}
             open={open}
             outboxReady={outboxReady}
             projectId={projectId}
             revisionId={revisionId}
             revisionStatus={revisionStatus}
             revisionVersion={revisionVersion}
             saveStatus={saveStatus}
             snapshotSha256={checkpointSha256}
             workspaceId={workspaceId}
```

## app/lukas/components/drawing-workspace.tsx

Final SHA256 40f43f2a38c707d61f8bce7e64a3a666f9b6cf958e524e0ff4a8d5fc13b1be4c
Baseline /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-workspace.tsx

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-workspace.tsx b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/components/drawing-workspace.tsx
index 986704e..92b804d 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-workspace.tsx
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/components/drawing-workspace.tsx
@@ -6056,24 +6056,25 @@ export default function DrawingWorkspaceClient({
             <DrawingCollaborationParticipants
               store={awarenessStoreRef.current}
             />
           ) : null}
           <DrawingShareControls
             capability={effectiveCapability}
             revisionStatus={effectiveRevisionStatus}
             shares={drawingShares}
             snapshotReady={Boolean(collaborationBootstrap?.sha256)}
           />
           <DrawingExportLauncher
             auditRequired={!previewMode}
+            currentUserId={currentUserId}
             checkpointSha256={collaborationBootstrap?.sha256 ?? null}
             createdAt={drawingDocument.created_at}
             documentState={drawingState}
             operationCheckpoint={
               collaborationBootstrap?.operationSequence ?? null
             }
             outboxReady={outboxReady && exportCheckpointReady}
             projectId={projectId}
             revisionId={revision.id}
             revisionStatus={effectiveRevisionStatus}
             revisionVersion={revision.version}
             saveStatus={saveStatus}
```

## app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts

Final SHA256 786d3d047fbc5178159f160124dcf4f0b61551c2b9420f933afef8a12c8366e0
Baseline /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-native-dwg-resave-jobs.server.ts

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-native-dwg-resave-jobs.server.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts
index bc528e4..c66a5d5 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-native-dwg-resave-jobs.server.ts
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts
@@ -11,94 +11,60 @@ import {
   parseNativeDrawingDwgResaveAttestation,
   NativeDrawingDwgResaveAttestationSchema,
 } from "./drawing-native-dwg-resave-attestation.server.ts";
 
 const Uuid = z
   .string()
   .uuid()
   .transform((value) => value.toLowerCase());
 const ImageId = z.string().regex(/^sha256:[0-9a-f]{64}$/);
 const RequestSchema = NativeDrawingDwgScopeSchema.extend({
   requestId: Uuid,
 }).strict();
-const AcceptanceSchema = z
-  .object({ jobId: Uuid, requestId: Uuid, hasChanges: z.boolean() })
-  .strict();
-const FailureCode = z.enum([
-  "source_unavailable",
-  "source_mismatch",
-  "resaver_failed",
-  "output_invalid",
-  "worker_interrupted",
-  "authority_revoked",
-  "upload_failed",
-  "publication_failed",
-]);
-const StatusSchema = AcceptanceSchema.extend({
-  status: z.enum([
-    "queued",
-    "processing",
-    "retry_wait",
-    "cancel_requested",
-    "cancelled",
-    "no_changes",
-    "failed",
-    "completed",
-  ]),
-  attemptCount: z.number().int().min(0).max(3),
-  failureCode: FailureCode.nullable(),
-})
-  .strict()
-  .refine(
-    (value) =>
-      (value.status === "no_changes") === !value.hasChanges &&
-      (value.status !== "no_changes" || value.attemptCount === 0) &&
-      (!["processing", "retry_wait", "cancel_requested", "completed"].includes(
-        value.status,
-      ) ||
-        value.attemptCount > 0),
-  );
+import {
+  NativeDrawingDwgResaveAcceptanceSchema as AcceptanceSchema,
+  NativeDrawingDwgResaveStatusSchema as StatusSchema,
+} from "./drawing-native-dwg-resave-contract.ts";
+export {
+  NativeDrawingDwgResaveAcceptanceSchema,
+  NativeDrawingDwgResaveStatusSchema,
+} from "./drawing-native-dwg-resave-contract.ts";
 const ClaimSchema = z
   .object({
     jobId: Uuid,
     attemptNumber: z.number().int().min(1).max(3),
     leaseToken: Uuid,
     leaseExpiresAt: z.string().datetime({ offset: true }),
     actorId: Uuid,
     scope: NativeDrawingDwgScopeSchema,
     source: NativeDrawingDwgImportSourceSchema,
     attestation: NativeDrawingDwgResaveAttestationSchema,
     payload: NativeDrawingDwgResaveSourcePayloadSchema,
   })
   .strict();
 type RpcClient = NativeDrawingDwgImportRpcClient;
 type UserClient = RpcClient & {
   auth: {
     getUser(): PromiseLike<{
       data: { user: { id: string; is_anonymous?: boolean } | null };
       error: unknown;
     }>;
   };
 };
 
 export class NativeDrawingDwgResaveJobError extends Error {
-  constructor(
-    readonly kind:
-      | "invalid"
-      | "unavailable"
-      | "conflict"
-      | "stale"
-      | "capacity",
-  ) {
+  readonly kind: "invalid" | "unavailable" | "conflict" | "stale" | "capacity";
+  constructor(kind: NativeDrawingDwgResaveJobError["kind"]) {
     super(`Native DWG resave ${kind}.`);
+    this.kind = kind;
     this.name = "NativeDrawingDwgResaveJobError";
   }
 }
 function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
   const result = schema.safeParse(raw);
   if (!result.success) throw new NativeDrawingDwgResaveJobError("invalid");
   return result.data;
 }
 function scopeInput(raw: unknown) {
   const scope = parse(NativeDrawingDwgScopeSchema, raw);
   return {
     ...scope,
```

## app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts

Final SHA256 0396f4abfd4cd5c6b55f6d91bd9fd50d657155601c6ce84f9913c0c572c114f8
Baseline /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-native-dwg-resave-artifacts.server.ts

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-native-dwg-resave-artifacts.server.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts
index 002e685..03ef59e 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-native-dwg-resave-artifacts.server.ts
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts
@@ -1,125 +1,76 @@
 import { createHash } from "node:crypto";
 import { isDeepStrictEqual } from "node:util";
 
 import { z } from "zod";
 
 import { NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-jobs.server.ts";
 import { buildNativeDrawingDwgResaveAttestation } from "./drawing-native-dwg-resave-attestation.server.ts";
 import { parseNativeDrawingDwgResaveClaim } from "./drawing-native-dwg-resave-jobs.server.ts";
 import { decodeNativeDrawingDwgResaveOutput } from "./drawing-native-dwg-resave-protocol.server.ts";
 
-export const NATIVE_DWG_RESAVE_ARTIFACT_LIMITS = Object.freeze({
-  dwg: 209715200,
-  edit_request: 2097152,
-  authority: 67108864,
-  report: 1048576,
-});
-
-export const NativeDrawingDwgResaveArtifactKindSchema = z.enum([
-  "dwg",
-  "edit_request",
-  "authority",
-  "report",
-]);
-export type NativeDrawingDwgResaveArtifactKind = z.infer<
-  typeof NativeDrawingDwgResaveArtifactKindSchema
->;
-
+import {
+  NATIVE_DWG_RESAVE_ARTIFACT_LIMITS,
+  NativeDrawingDwgResaveArtifactKindSchema,
+  NativeDrawingDwgResaveReceiptSchema,
+  NativeDrawingDwgResaveArtifactMetadataSchema as ArtifactMetadataSchema,
+  NativeDrawingDwgResaveArtifactMetadataArraySchema as ArtifactMetadataArraySchema,
+  type NativeDrawingDwgResaveArtifactKind,
+} from "./drawing-native-dwg-resave-contract.ts";
+export {
+  NATIVE_DWG_RESAVE_ARTIFACT_LIMITS,
+  NativeDrawingDwgResaveArtifactKindSchema,
+  NativeDrawingDwgResaveReceiptSchema,
+  type NativeDrawingDwgResaveArtifactKind,
+} from "./drawing-native-dwg-resave-contract.ts";
 const Uuid = z
   .string()
   .uuid()
   .transform((value) => value.toLowerCase());
 const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
 const AttemptNumber = z.number().int().min(1).max(3);
 const ScopeSchema = NativeDrawingDwgScopeSchema.transform((scope) => ({
   ...scope,
   projectId: scope.projectId.toLowerCase(),
   documentId: scope.documentId.toLowerCase(),
   revisionId: scope.revisionId.toLowerCase(),
   canvasId: scope.canvasId.toLowerCase(),
 }));
 const filenames: Record<NativeDrawingDwgResaveArtifactKind, string> = {
   dwg: "resaved.dwg",
   edit_request: "edit-request.json",
   authority: "authority.json",
   report: "native-report.json",
 };
 const artifactOrder = NativeDrawingDwgResaveArtifactKindSchema.options;
 
-const ArtifactMetadataSchema = z
-  .object({
-    kind: NativeDrawingDwgResaveArtifactKindSchema,
-    sha256: Sha256,
-    byteSize: z.number().int().positive().safe(),
-  })
-  .strict()
-  .superRefine((artifact, context) => {
-    const minimum = artifact.kind === "dwg" ? 6 : 1;
-    if (
-      artifact.byteSize < minimum ||
-      artifact.byteSize > NATIVE_DWG_RESAVE_ARTIFACT_LIMITS[artifact.kind]
-    )
-      context.addIssue({
-        code: z.ZodIssueCode.custom,
-        path: ["byteSize"],
-        message: "Invalid native DWG resave artifact size.",
-      });
-  });
-const ArtifactMetadataArraySchema = z
-  .array(ArtifactMetadataSchema)
-  .length(4)
-  .superRefine((artifacts, context) => {
-    for (let index = 0; index < artifactOrder.length; index += 1)
-      if (artifacts[index]?.kind !== artifactOrder[index])
-        context.addIssue({
-          code: z.ZodIssueCode.custom,
-          path: [index, "kind"],
-          message: "Native DWG resave artifacts are not in canonical order.",
-        });
-  });
 const ManagedPath = z.string().min(1).max(1_000);
 const StagedArtifactSchema = z
   .object({
     kind: NativeDrawingDwgResaveArtifactKindSchema,
     sha256: Sha256,
     byteSize: z.number().int().positive().safe(),
     path: ManagedPath,
   })
   .strict();
 const StagedSchema = z
   .object({
     jobId: Uuid,
     attemptNumber: AttemptNumber,
     leaseToken: Uuid,
     uploadState: z.enum(["open", "closed"]),
     artifacts: z.array(StagedArtifactSchema).length(4),
   })
   .strict();
 
-export const NativeDrawingDwgResaveReceiptSchema = z
-  .object({
-    schemaVersion: z.literal("1hk-dwg-resave-receipt/1"),
-    jobId: Uuid,
-    attemptNumber: AttemptNumber,
-    scope: ScopeSchema,
-    resaverImageId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
-    sourceSha256: Sha256,
-    qualification: z.literal("experimental-unqualified"),
-    persistenceAuthority: z.literal("not-issued"),
-    artifacts: ArtifactMetadataArraySchema,
-    createdAt: z.string().datetime({ offset: true }),
-  })
-  .strict();
-
 const ManagedPathPattern = new RegExp(
   "^projects/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
     "native-dwg-resave/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
     "([1-3])/([0-9a-f]{64})/([^/]+)$",
 );
 
 export const NativeDrawingDwgResaveDescriptorSchema = z
   .object({
     jobId: Uuid,
     attemptNumber: AttemptNumber,
     kind: NativeDrawingDwgResaveArtifactKindSchema,
     bucket: z.literal("lukas-qto"),
```

## app/lukas/lib/drawing-native-dwg-jobs.server.ts

Final SHA256 4caf9b30b29a9a84e17a3cb73ae85d989701e25b08be3c52f016b6f19a5c5eb7
Baseline /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-native-dwg-jobs.server.ts

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-native-dwg-jobs.server.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-jobs.server.ts
index f2d3948..516cc27 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-drawing-native-dwg-jobs.server.ts
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-jobs.server.ts
@@ -119,36 +119,36 @@ export type NativeDrawingDwgAcceptance = z.infer<typeof AcceptanceSchema>;
 type RpcClient = {
   rpc(
     name: string,
     args: Record<string, unknown>,
   ): PromiseLike<{ data: unknown; error: unknown }> & {
     abortSignal?: (
       signal: AbortSignal,
     ) => PromiseLike<{ data: unknown; error: unknown }>;
   };
 };
 
 export class NativeDrawingDwgJobError extends Error {
-  constructor(
-    readonly kind: "invalid" | "unavailable" | "conflict" | "capacity",
-  ) {
+  readonly kind: "invalid" | "unavailable" | "conflict" | "capacity";
+  constructor(kind: NativeDrawingDwgJobError["kind"]) {
     super(
       kind === "invalid"
         ? "Invalid native DWG request."
         : kind === "capacity"
           ? "Native DWG export capacity is currently full."
           : kind === "conflict"
             ? "Native DWG export state conflicts with this request."
             : "Native DWG export is unavailable.",
     );
+    this.kind = kind;
     this.name = "NativeDrawingDwgJobError";
   }
 }
 
 function invalid(): never {
   throw new NativeDrawingDwgJobError("invalid");
 }
 
 function rpcFailure(error: unknown): never {
   const code =
     error && typeof error === "object" && "code" in error
       ? String(error.code)
```

## package.json

Final SHA256 b3316cbb30ce5c955f596693b5dd9085fea0403b26c5802b5a1112dbad38ce49
Baseline /Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-package.json

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-package.json b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/package.json
old mode 100644
new mode 100755
index 4f69d27..46cdb1c
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-4-package.json
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/package.json
@@ -4,24 +4,25 @@
   "type": "module",
   "version": "1.0",
   "scripts": {
     "prebuild": "npm run typecheck",
     "build": "react-router build",
     "build:collaboration": "tsc -p collaboration/tsconfig.json",
     "build:native-dwg-worker": "tsc -p native-dwg-worker/tsconfig.json",
     "build:vercel": "VERCEL=1 VERCEL_ENV=production npm run build",
     "dev": "NODE_OPTIONS='--import ./instrument.server.mjs' react-router dev",
     "preview:drawing-workspace": "npm run build && NODE_ENV=development SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=local-drawing-preview PORT=${PORT:-5175} npm run start",
     "start": "react-router-serve ./build/server/index.js",
     "start:native-dwg-import-worker": "node --experimental-strip-types native-dwg-worker/src/import.ts",
+    "start:native-dwg-resave-worker": "node --experimental-strip-types native-dwg-worker/src/resave.ts",
     "start:native-dwg-worker": "node --experimental-strip-types native-dwg-worker/src/index.ts",
     "typecheck": "react-router typegen && tsc",
     "typecheck:collaboration": "tsc -p collaboration/tsconfig.json --noEmit",
     "db:generate": "drizzle-kit generate",
     "db:migrate": "drizzle-kit migrate",
     "db:typegen": "test -n \"$SUPABASE_PROJECT_REF\" || (echo 'Set SUPABASE_PROJECT_REF before generating database types.' >&2; exit 1); supabase gen types typescript --project-id \"$SUPABASE_PROJECT_REF\" > database.types.ts",
     "test:e2e": "playwright test",
     "test:e2e:drawing:production": "playwright test e2e/drawing-collaboration.spec.ts --project=chromium",
     "test:e2e:drawing-workspace:production": "playwright test e2e/drawing-workspace.spec.ts --project=chromium",
     "test:e2e:drawing-workspace-p2:production": "playwright test e2e/drawing-workspace-p2.spec.ts --project=chromium",
     "test:e2e:drawing-workspace-p0-p2:local": "playwright test e2e/drawing-workspace-local-p0-p2.spec.ts --config=playwright.p4-functional.config.ts --project=chromium --workers=1",
     "test:e2e:drawing-workspace-p3:local": "playwright test e2e/drawing-workspace-local-multiplayer.spec.ts --config=playwright.p4-functional.config.ts --project=chromium --workers=1",
```

## app/lukas/lib/drawing-native-dwg-resave-resource.server.ts

Final SHA256 fc07c04b31ca9269b7937fc72281c11aedf034d0843b5dd1fc8fcd86e032a681
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-resource.server.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-resource.server.ts
new file mode 100644
index 0000000..25ae897
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-resource.server.ts
@@ -0,0 +1,270 @@
+import { z } from "zod";
+import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
+import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
+import { NativeDrawingDwgResaveScopeSchema as NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-resave-contract";
+import { parseNativeDrawingDwgStatusScope } from "./drawing-native-dwg-export.server";
+import {
+  NativeDrawingDwgResaveJobError,
+  cancelNativeDrawingDwgResave,
+  getLatestNativeDrawingDwgResaveStatus,
+  getNativeDrawingDwgResaveStatus,
+  requestNativeDrawingDwgResave,
+  verifyNativeDrawingDwgResaveActor,
+} from "./drawing-native-dwg-resave-jobs.server";
+import { getNativeDrawingDwgResaveReceipt } from "./drawing-native-dwg-resave-artifact-jobs.server";
+
+const Uuid = z
+  .string()
+  .uuid()
+  .transform((value) => value.toLowerCase());
+const Intent = z.discriminatedUnion("intent", [
+  NativeDrawingDwgScopeSchema.extend({
+    intent: z.literal("request"),
+    requestId: Uuid,
+  }).strict(),
+  NativeDrawingDwgScopeSchema.extend({
+    intent: z.literal("cancel"),
+    jobId: Uuid,
+  }).strict(),
+]);
+
+export function nativeDwgResaveHeaders(headers: Headers) {
+  const result = new Headers(headers);
+  result.set("Cache-Control", "private, no-store");
+  result.set("Referrer-Policy", "no-referrer");
+  result.set("X-Content-Type-Options", "nosniff");
+  return result;
+}
+
+export function nativeDwgResaveError(error: unknown) {
+  const status =
+    error instanceof Response
+      ? error.status
+      : error instanceof NativeDrawingDwgResaveJobError
+        ? error.kind === "invalid"
+          ? 400
+          : error.kind === "capacity"
+            ? 429
+            : error.kind === "conflict" || error.kind === "stale"
+              ? 409
+              : 404
+        : 503;
+  const headers = new Headers();
+  if (error instanceof Response && error.headers.has("Allow"))
+    headers.set("Allow", error.headers.get("Allow")!);
+  return new Response(
+    "현재 도면의 실험적 DWG 재저장 요청을 처리할 수 없습니다.",
+    { status, headers },
+  );
+}
+
+function normalizedScope(raw: unknown) {
+  return NativeDrawingDwgScopeSchema.parse(raw);
+}
+
+export function parseNativeDwgResaveQuery(
+  request: Request,
+  projectId: unknown,
+  workspaceId: unknown,
+) {
+  const parsed = parseNativeDrawingDwgStatusScope(
+    request,
+    projectId,
+    workspaceId,
+  );
+  return {
+    scope: normalizedScope(parsed.scope),
+    jobId: parsed.jobId === null ? null : Uuid.parse(parsed.jobId),
+  };
+}
+
+async function readJson(request: Request) {
+  const declared = request.headers.get("content-length");
+  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 4096))
+    throw new Response(null, { status: 413 });
+  if (
+    request.headers.get("content-type")?.split(";", 1)[0] !==
+      "application/json" ||
+    !request.body
+  )
+    throw new Response(null, { status: 400 });
+  const reader = request.body.getReader();
+  const bytes = new Uint8Array(4096);
+  let size = 0;
+  try {
+    while (true) {
+      const { done, value } = await reader.read();
+      if (done) break;
+      if (size + value.byteLength > bytes.byteLength) {
+        void reader.cancel().catch(() => {});
+        throw new Response(null, { status: 413 });
+      }
+      bytes.set(value, size);
+      size += value.byteLength;
+    }
+    return JSON.parse(
+      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
+    );
+  } catch (error) {
+    if (error instanceof Response) throw error;
+    throw new Response(null, { status: 400 });
+  } finally {
+    reader.releaseLock();
+  }
+}
+
+export async function handleNativeDrawingDwgResaveResource({
+  request,
+  projectId,
+  workspaceId,
+  client,
+  headers,
+  loadServiceClient,
+  imageId,
+}: {
+  request: Request;
+  projectId: string;
+  workspaceId: string;
+  client: Parameters<typeof verifyNativeDrawingDwgResaveActor>[0];
+  headers: Headers;
+  loadServiceClient: () => Promise<
+    Parameters<typeof requestNativeDrawingDwgResave>[1]
+  >;
+  imageId?: unknown;
+}) {
+  const outgoing = nativeDwgResaveHeaders(headers);
+  try {
+    if (request.method === "GET") {
+      const { scope, jobId } = parseNativeDwgResaveQuery(
+        request,
+        projectId,
+        workspaceId,
+      );
+      await verifyNativeDrawingDwgResaveActor(client, request.signal);
+      const job =
+        jobId === null
+          ? await getLatestNativeDrawingDwgResaveStatus(
+              client,
+              scope,
+              request.signal,
+            )
+          : await getNativeDrawingDwgResaveStatus(
+              client,
+              scope,
+              jobId,
+              request.signal,
+            );
+      const receipt =
+        job?.status === "completed"
+          ? await getNativeDrawingDwgResaveReceipt(
+              client,
+              scope,
+              job.jobId,
+              request.signal,
+            )
+          : null;
+      return Response.json({ job, receipt }, { headers: outgoing });
+    }
+    if (request.method !== "POST")
+      throw new Response(null, {
+        status: 405,
+        headers: { Allow: "GET, POST" },
+      });
+    if (request.headers.get("origin") !== new URL(request.url).origin)
+      throw new Response(null, { status: 403 });
+    if (new URL(request.url).search) throw new Response(null, { status: 400 });
+    const parsed = Intent.parse(await readJson(request));
+    const { intent, ...input } = parsed;
+    const {
+      requestId: _requestId,
+      jobId: _jobId,
+      ...rawScope
+    } = input as typeof input & { requestId?: string; jobId?: string };
+    const scope = normalizedScope(rawScope);
+    if (
+      scope.projectId !== Uuid.parse(projectId) ||
+      scope.documentId !== Uuid.parse(workspaceId)
+    )
+      throw new Response(null, { status: 409 });
+    await verifyNativeDrawingDwgResaveActor(client, request.signal);
+    if (parsed.intent === "cancel") {
+      const job = await cancelNativeDrawingDwgResave(
+        client,
+        scope,
+        parsed.jobId,
+        request.signal,
+      );
+      const receipt =
+        job.status === "completed"
+          ? await getNativeDrawingDwgResaveReceipt(
+              client,
+              scope,
+              job.jobId,
+              request.signal,
+            )
+          : null;
+      return Response.json({ job, receipt }, { headers: outgoing });
+    }
+    if (
+      !z
+        .string()
+        .regex(/^sha256:[0-9a-f]{64}$/)
+        .safeParse(imageId).success
+    )
+      throw new Response(null, { status: 503 });
+    const accepted = await requestNativeDrawingDwgResave(
+      client,
+      await loadServiceClient(),
+      { ...scope, requestId: parsed.requestId },
+      imageId,
+      request.signal,
+    );
+    return Response.json(accepted, { status: 202, headers: outgoing });
+  } catch (error) {
+    throw mergeResponseHeaders(
+      nativeDwgResaveError(
+        error instanceof z.ZodError
+          ? new NativeDrawingDwgResaveJobError("invalid")
+          : error,
+      ),
+      outgoing,
+    );
+  }
+}
+
+export async function nativeDrawingDwgResaveRouteRequest({
+  request,
+  params,
+}: {
+  request: Request;
+  params: { projectId?: string; workspaceId?: string };
+}) {
+  let headers = new Headers();
+  try {
+    const context = await drawingContext(request, params.projectId!);
+    headers = context.headers;
+    // Generated database types predate the resave RPCs; adapters validate every response.
+    return await handleNativeDrawingDwgResaveResource({
+      request,
+      projectId: params.projectId!,
+      workspaceId: params.workspaceId!,
+      client: context.client as unknown as Parameters<
+        typeof verifyNativeDrawingDwgResaveActor
+      >[0],
+      headers,
+      imageId: process.env.NATIVE_DWG_RESAVER_IMAGE_ID,
+      loadServiceClient: async () =>
+        (await import("~/core/lib/supa-admin-client.server"))
+          .default as unknown as Parameters<
+          typeof requestNativeDrawingDwgResave
+        >[1],
+    });
+  } catch (error) {
+    if (error instanceof Response)
+      headers = mergeResponseHeaders(error, headers).headers;
+    throw mergeResponseHeaders(
+      nativeDwgResaveError(error),
+      nativeDwgResaveHeaders(headers),
+    );
+  }
+}
```

## app/lukas/lib/drawing-native-dwg-resave-download.server.ts

Final SHA256 8aae313e8ddcc72c85a8fa82912f0f2ae2849a8a25bd2314dcc1bf5a32d5a5fa
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-download.server.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-download.server.ts
new file mode 100644
index 0000000..5f35fa0
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-download.server.ts
@@ -0,0 +1,227 @@
+import { createHash } from "node:crypto";
+import { isDeepStrictEqual } from "node:util";
+import { z } from "zod";
+import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
+import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
+import { getNativeDrawingDwgResaveDownloadDescriptor } from "./drawing-native-dwg-resave-artifact-jobs.server";
+import { NativeDrawingDwgResaveJobError } from "./drawing-native-dwg-resave-jobs.server";
+import {
+  nativeDwgResaveError,
+  nativeDwgResaveHeaders,
+  parseNativeDwgResaveQuery,
+} from "./drawing-native-dwg-resave-resource.server";
+
+type ServiceClient = {
+  storage: {
+    from(bucket: string): {
+      download(
+        path: string,
+        options: Record<string, never>,
+        parameters: { signal: AbortSignal },
+      ): {
+        asStream(): PromiseLike<{
+          data: ReadableStream<Uint8Array> | null;
+          error: unknown;
+        }>;
+      };
+    };
+  };
+};
+type Scope = ReturnType<typeof parseNativeDwgResaveQuery>["scope"];
+
+export async function handleNativeDrawingDwgResaveDownload(
+  {
+    client,
+    headers,
+    jobId,
+    kind,
+    loadServiceClient,
+    projectId,
+    request,
+    scope,
+    workspaceId,
+  }: {
+    client: Parameters<typeof getNativeDrawingDwgResaveDownloadDescriptor>[0];
+    headers: Headers;
+    jobId: string;
+    kind: string;
+    loadServiceClient: () => Promise<ServiceClient>;
+    projectId: string;
+    request: Request;
+    scope: Scope;
+    workspaceId: string;
+  },
+  runtime: { downloadMilliseconds?: number } = {},
+) {
+  const outgoing = nativeDwgResaveHeaders(headers);
+  const controller = new AbortController();
+  const abort = () => controller.abort();
+  const timer = setTimeout(
+    abort,
+    Math.max(1, Math.min(runtime.downloadMilliseconds ?? 30_000, 30_000)),
+  );
+  let rejectAbort: () => void = () => {};
+  const aborted = new Promise<never>((_, reject) => {
+    rejectAbort = () => reject(new Error("aborted"));
+  });
+  controller.signal.addEventListener("abort", rejectAbort, { once: true });
+  request.signal.addEventListener("abort", abort, { once: true });
+  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
+  const cancel = () => {
+    if (reader) void reader.cancel().catch(() => {});
+  };
+  controller.signal.addEventListener("abort", cancel, { once: true });
+  try {
+    if (request.signal.aborted) abort();
+    const bytes = await Promise.race([
+      aborted,
+      (async () => {
+        controller.signal.throwIfAborted();
+        if (request.method !== "GET")
+          throw new Response(null, { status: 405, headers: { Allow: "GET" } });
+        const parsed = parseNativeDwgResaveQuery(
+          request,
+          projectId,
+          workspaceId,
+        );
+        if (parsed.jobId !== null || !isDeepStrictEqual(parsed.scope, scope))
+          throw new NativeDrawingDwgResaveJobError("invalid");
+        const descriptor = await getNativeDrawingDwgResaveDownloadDescriptor(
+          client,
+          scope,
+          jobId,
+          kind,
+          controller.signal,
+        );
+        const service = await loadServiceClient();
+        controller.signal.throwIfAborted();
+        const { data, error } = await service.storage
+          .from(descriptor.bucket)
+          .download(descriptor.path, {}, { signal: controller.signal })
+          .asStream();
+        if (controller.signal.aborted) {
+          if (data) void data.cancel().catch(() => {});
+          controller.signal.throwIfAborted();
+        }
+        if (error !== null || !data) throw new Error("storage");
+        reader = data.getReader();
+        const chunks: Uint8Array[] = [];
+        const hash = createHash("sha256");
+        let size = 0;
+        while (true) {
+          const { done, value } = await reader.read();
+          controller.signal.throwIfAborted();
+          if (done) break;
+          size += value.byteLength;
+          if (size > descriptor.byteSize) throw new Error("size");
+          const copy = new Uint8Array(value);
+          hash.update(copy);
+          chunks.push(copy);
+        }
+        reader.releaseLock();
+        reader = undefined;
+        if (
+          size !== descriptor.byteSize ||
+          hash.digest("hex") !== descriptor.sha256
+        )
+          throw new Error("integrity");
+        const current = await getNativeDrawingDwgResaveDownloadDescriptor(
+          client,
+          scope,
+          jobId,
+          kind,
+          controller.signal,
+        );
+        if (!isDeepStrictEqual(descriptor, current))
+          throw new Error("authorization");
+        controller.signal.throwIfAborted();
+        const result = new Uint8Array(size);
+        let offset = 0;
+        for (const chunk of chunks) {
+          result.set(chunk, offset);
+          offset += chunk.byteLength;
+        }
+        return result;
+      })(),
+    ]);
+    controller.signal.throwIfAborted();
+    const filenames: Record<string, string> = {
+      dwg: "resaved-experimental.dwg",
+      edit_request: "edit-request.json",
+      authority: "authority.json",
+      report: "native-report.json",
+    };
+    outgoing.set(
+      "Content-Disposition",
+      `attachment; filename="${filenames[kind]}"`,
+    );
+    outgoing.set(
+      "Content-Type",
+      kind === "dwg" ? "application/acad" : "application/json",
+    );
+    outgoing.set("Content-Length", String(bytes.byteLength));
+    return new Response(bytes, { headers: outgoing });
+  } catch (error) {
+    cancel();
+    throw mergeResponseHeaders(
+      nativeDwgResaveError(
+        error instanceof z.ZodError
+          ? new NativeDrawingDwgResaveJobError("invalid")
+          : error,
+      ),
+      outgoing,
+    );
+  } finally {
+    clearTimeout(timer);
+    request.signal.removeEventListener("abort", abort);
+    controller.signal.removeEventListener("abort", rejectAbort);
+    controller.signal.removeEventListener("abort", cancel);
+    // GET cleanup cannot extend the response deadline when a transport ignores abort.
+  }
+}
+
+export async function nativeDrawingDwgResaveDownloadRouteRequest({
+  request,
+  params,
+}: {
+  request: Request;
+  params: {
+    projectId?: string;
+    workspaceId?: string;
+    jobId?: string;
+    kind?: string;
+  };
+}) {
+  let headers = new Headers();
+  try {
+    const context = await drawingContext(request, params.projectId!);
+    headers = context.headers;
+    const { scope } = parseNativeDwgResaveQuery(
+      request,
+      params.projectId,
+      params.workspaceId,
+    );
+    // Generated database types predate the resave RPCs; the descriptor adapter validates them.
+    return await handleNativeDrawingDwgResaveDownload({
+      client: context.client as unknown as Parameters<
+        typeof getNativeDrawingDwgResaveDownloadDescriptor
+      >[0],
+      headers,
+      request,
+      scope,
+      projectId: params.projectId!,
+      workspaceId: params.workspaceId!,
+      jobId: params.jobId!,
+      kind: params.kind!,
+      loadServiceClient: async () =>
+        (await import("~/core/lib/supa-admin-client.server")).default,
+    });
+  } catch (error) {
+    if (error instanceof Response)
+      headers = mergeResponseHeaders(error, headers).headers;
+    throw mergeResponseHeaders(
+      nativeDwgResaveError(error),
+      nativeDwgResaveHeaders(headers),
+    );
+  }
+}
```

## app/lukas/screens/drawing-native-dwg-resave.ts

Final SHA256 d93f70bda8f300117527c7fcdb601c9ce1a8e82839af445163cf6542937e16f5
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/screens/drawing-native-dwg-resave.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/screens/drawing-native-dwg-resave.ts
new file mode 100644
index 0000000..ceb1b8a
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/screens/drawing-native-dwg-resave.ts
@@ -0,0 +1,8 @@
+import type { Route } from "./+types/drawing-native-dwg-resave";
+import { nativeDrawingDwgResaveRouteRequest } from "~/lukas/lib/drawing-native-dwg-resave-resource.server";
+export async function loader(args: Route.LoaderArgs) {
+  return nativeDrawingDwgResaveRouteRequest(args);
+}
+export async function action(args: Route.ActionArgs) {
+  return nativeDrawingDwgResaveRouteRequest(args);
+}
```

## app/lukas/screens/drawing-native-dwg-resave-download.ts

Final SHA256 17cfe12a8deb8b1f632a2f670901fd8e8c7ffa09f0422dd24402b1a0540f45ec
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/screens/drawing-native-dwg-resave-download.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/screens/drawing-native-dwg-resave-download.ts
new file mode 100644
index 0000000..8966e4d
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/screens/drawing-native-dwg-resave-download.ts
@@ -0,0 +1,5 @@
+import type { Route } from "./+types/drawing-native-dwg-resave-download";
+import { nativeDrawingDwgResaveDownloadRouteRequest } from "~/lukas/lib/drawing-native-dwg-resave-download.server";
+export async function loader(args: Route.LoaderArgs) {
+  return nativeDrawingDwgResaveDownloadRouteRequest(args);
+}
```

## app/lukas/components/drawing-native-dwg-resave-control.tsx

Final SHA256 bb3426178f999c5dbe1aa7ff887190bf8b10b8fc6db9e770c269fc14c9efaa51
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/components/drawing-native-dwg-resave-control.tsx b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/components/drawing-native-dwg-resave-control.tsx
new file mode 100644
index 0000000..3ad421d
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/components/drawing-native-dwg-resave-control.tsx
@@ -0,0 +1,307 @@
+import { useEffect, useRef, useState } from "react";
+import { z } from "zod";
+import { Button } from "~/core/components/ui/button";
+import {
+  NativeDrawingDwgResaveAcceptanceSchema,
+  NativeDrawingDwgResaveReceiptSchema,
+  NativeDrawingDwgResaveScopeSchema,
+  NativeDrawingDwgResaveStatusSchema,
+  type NativeDrawingDwgResaveScope,
+} from "~/lukas/lib/drawing-native-dwg-resave-contract";
+import {
+  drawingNativeDwgResavePath,
+  drawingNativeDwgResaveDownloadPath,
+} from "~/lukas/lib/drawing-workspace-paths";
+
+const Uuid = z
+  .string()
+  .uuid()
+  .transform((value) => value.toLowerCase());
+const Envelope = z
+  .object({
+    job: NativeDrawingDwgResaveStatusSchema.nullable(),
+    receipt: NativeDrawingDwgResaveReceiptSchema.nullable(),
+  })
+  .strict()
+  .refine(
+    ({ job, receipt }) =>
+      (job?.status === "completed") === (receipt !== null) &&
+      (receipt === null || receipt.jobId === job?.jobId),
+  );
+type EnvelopeValue = z.infer<typeof Envelope>;
+const terminal = new Set(["completed", "failed", "cancelled", "no_changes"]);
+const cancellable = new Set(["queued", "processing", "retry_wait"]);
+const labels = {
+  queued: "대기 중",
+  processing: "재저장 중",
+  retry_wait: "재시도 대기",
+  cancel_requested: "취소 처리 중",
+  cancelled: "취소됨",
+  no_changes: "지원되는 변경이 없습니다",
+  failed: "재저장 실패",
+  completed: "재저장 완료",
+};
+
+function search(scope: NativeDrawingDwgResaveScope, jobId?: string) {
+  return new URLSearchParams({
+    revisionId: scope.revisionId,
+    revisionVersion: String(scope.revisionVersion),
+    canvasId: scope.canvasId,
+    snapshotSha256: scope.snapshotSha256,
+    ...(jobId ? { jobId } : {}),
+  });
+}
+function parseEnvelope(
+  value: unknown,
+  scope: NativeDrawingDwgResaveScope,
+  jobId?: string,
+) {
+  const parsed = Envelope.parse(value);
+  if (jobId && parsed.job?.jobId !== jobId) throw new Error("identity");
+  if (
+    parsed.receipt &&
+    Object.entries(scope).some(
+      ([key, value]) =>
+        parsed.receipt!.scope[key as keyof NativeDrawingDwgResaveScope] !==
+        value,
+    )
+  )
+    throw new Error("scope");
+  return parsed;
+}
+
+export function NativeDrawingDwgResaveControl({
+  scope: rawScope,
+  currentUserId,
+  open,
+  readiness,
+  transport = fetch,
+}: {
+  scope: NativeDrawingDwgResaveScope | null;
+  currentUserId?: string | null;
+  open: boolean;
+  readiness: boolean;
+  transport?: typeof fetch;
+}) {
+  const parsedScope = NativeDrawingDwgResaveScopeSchema.safeParse(rawScope);
+  const actor = Uuid.safeParse(currentUserId);
+  const scope = parsedScope.success ? parsedScope.data : null;
+  const scopeKey = scope ? JSON.stringify(scope) : "";
+  const key =
+    scope && actor.success
+      ? `native-dwg-resave:v1:${actor.data}:${scopeKey}`
+      : "";
+  const lifecycle = `${open}:${readiness}:${key}`;
+  const generation = useRef({ lifecycle, token: {} });
+  const watchJob = useRef<string | undefined>(undefined);
+  if (generation.current.lifecycle !== lifecycle) {
+    generation.current = { lifecycle, token: {} };
+    watchJob.current = undefined;
+  }
+  const token = generation.current.token;
+  const localIds = useRef(new Map<string, string>());
+  const flight = useRef<{ token: object; controller: AbortController } | null>(
+    null,
+  );
+  const [view, setView] = useState<{
+    token: object;
+    value: EnvelopeValue | null;
+    error: boolean;
+  }>({ token, value: null, error: false });
+  const [busy, setBusy] = useState<object | null>(null);
+  const [refresh, setRefresh] = useState(0);
+  const visible = view.token === token ? view : null;
+  const value = visible?.value;
+  const job = value?.job;
+
+  useEffect(() => {
+    try {
+      if (key && !localIds.current.has(key)) {
+        const stored = Uuid.safeParse(localStorage.getItem(key));
+        if (stored.success) localIds.current.set(key, stored.data);
+      }
+    } catch {
+      /* Storage may be unavailable; the mounted identity still survives retry. */
+    }
+    return () => {
+      if (flight.current?.token === token) flight.current.controller.abort();
+    };
+  }, [key, token]);
+
+  useEffect(() => {
+    if (!open || !readiness || !key) return;
+    const exactScope = NativeDrawingDwgResaveScopeSchema.parse(
+      JSON.parse(scopeKey),
+    );
+    const controller = new AbortController();
+    let timer: ReturnType<typeof setTimeout> | undefined;
+    const fresh = () =>
+      !controller.signal.aborted && generation.current.token === token;
+    const poll = async () => {
+      let finished = false;
+      try {
+        const jobId = watchJob.current;
+        const response = await transport(
+          `${drawingNativeDwgResavePath(exactScope.projectId, exactScope.documentId)}?${search(exactScope, jobId)}`,
+          { credentials: "same-origin", signal: controller.signal },
+        );
+        if (!response.ok) throw new Error("status");
+        const parsed = parseEnvelope(await response.json(), exactScope, jobId);
+        if (!fresh()) return;
+        setView({ token, value: parsed, error: false });
+        finished = parsed.job !== null && terminal.has(parsed.job.status);
+      } catch {
+        if (fresh()) setView({ token, value: null, error: true });
+      }
+      if (fresh() && !finished) timer = setTimeout(poll, 1000);
+    };
+    void poll();
+    return () => {
+      controller.abort();
+      clearTimeout(timer);
+    };
+  }, [key, scopeKey, open, readiness, refresh, token, transport]);
+
+  const send = async (intent: "request" | "cancel") => {
+    if (
+      !scope ||
+      !key ||
+      !open ||
+      !readiness ||
+      flight.current?.token === token
+    )
+      return;
+    const controller = new AbortController();
+    const operation = { token, controller };
+    flight.current = operation;
+    setBusy(token);
+    try {
+      let body;
+      if (intent === "cancel") {
+        if (
+          !job ||
+          !cancellable.has(job.status) ||
+          localIds.current.get(key) !== job.requestId
+        )
+          return;
+        body = { intent, ...scope, jobId: job.jobId };
+      } else {
+        let requestId = localIds.current.get(key);
+        if (
+          !requestId ||
+          job?.status === "failed" ||
+          job?.status === "cancelled"
+        ) {
+          requestId = crypto.randomUUID();
+          localIds.current.set(key, requestId);
+          try {
+            localStorage.setItem(key, requestId);
+          } catch {
+            /* Retain the in-memory ID. */
+          }
+        }
+        body = { intent, ...scope, requestId };
+      }
+      const response = await transport(
+        drawingNativeDwgResavePath(scope.projectId, scope.documentId),
+        {
+          method: "POST",
+          credentials: "same-origin",
+          headers: { "Content-Type": "application/json" },
+          body: JSON.stringify(body),
+          signal: controller.signal,
+        },
+      );
+      if (!response.ok) throw new Error("request");
+      const raw: unknown = await response.json();
+      if (controller.signal.aborted || generation.current.token !== token)
+        return;
+      if (body.intent === "request") {
+        const accepted = NativeDrawingDwgResaveAcceptanceSchema.parse(raw);
+        if (accepted.requestId !== body.requestId)
+          throw new Error("request identity");
+        watchJob.current = accepted.jobId;
+      } else {
+        setView({
+          token,
+          value: parseEnvelope(raw, scope, body.jobId),
+          error: false,
+        });
+      }
+      setRefresh((n) => n + 1);
+    } catch {
+      if (!controller.signal.aborted && generation.current.token === token)
+        setView({ token, value: null, error: true });
+    } finally {
+      if (flight.current === operation) flight.current = null;
+      if (generation.current.token === token) setBusy(null);
+    }
+  };
+
+  if (!key) return null;
+  const canRequest =
+    !job || job.status === "failed" || job.status === "cancelled";
+  return (
+    <div className="space-y-3" data-native-dwg-resave-control="">
+      <p className="text-sm text-amber-700">
+        실험적 DWG 재저장 · 독립 CAD 검증 미수행 · 영구 저장 권한 미발급
+      </p>
+      {!readiness ? (
+        <p role="status" className="text-sm">
+          실제 서버에서 승인된 개정과 저장 체크포인트를 준비해 주세요.
+        </p>
+      ) : null}
+      {job ? (
+        <p role="status" className="text-sm">
+          {labels[job.status]}
+        </p>
+      ) : null}
+      {visible?.error ? (
+        <p role="alert" className="text-sm text-destructive">
+          요청 상태를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.
+        </p>
+      ) : null}
+      {canRequest ? (
+        <Button
+          type="button"
+          disabled={!open || !readiness || busy === token}
+          onClick={() => void send("request")}
+        >
+          DWG 재저장 요청
+        </Button>
+      ) : null}
+      {job &&
+      cancellable.has(job.status) &&
+      localIds.current.get(key) === job.requestId ? (
+        <Button
+          type="button"
+          variant="secondary"
+          disabled={busy === token || !open || !readiness}
+          onClick={() => void send("cancel")}
+        >
+          요청 취소
+        </Button>
+      ) : null}
+      {value?.receipt ? (
+        <div className="flex flex-wrap gap-3">
+          {value.receipt.artifacts.map(({ kind }) => (
+            <a
+              key={kind}
+              className="text-sm underline"
+              href={`${drawingNativeDwgResaveDownloadPath(scope!.projectId, scope!.documentId, value.receipt!.jobId, kind)}?${search(scope!)}`}
+            >
+              {
+                {
+                  dwg: "DWG 다운로드",
+                  edit_request: "편집 요청 다운로드",
+                  authority: "권한 증거 다운로드",
+                  report: "네이티브 보고서 다운로드",
+                }[kind]
+              }
+            </a>
+          ))}
+        </div>
+      ) : null}
+    </div>
+  );
+}
```

## app/lukas/lib/drawing-native-dwg-resave-contract.ts

Final SHA256 ca26c5db8910f92f346da86a6972359aa8e22582e37385723a25989f08b718b7
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-contract.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-contract.ts
new file mode 100644
index 0000000..c6411d8
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/app/lukas/lib/drawing-native-dwg-resave-contract.ts
@@ -0,0 +1,131 @@
+import { z } from "zod";
+
+const Uuid = z
+  .string()
+  .uuid()
+  .transform((value) => value.toLowerCase());
+const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
+const AttemptNumber = z.number().int().min(1).max(3);
+export const NativeDrawingDwgResaveScopeSchema = z
+  .object({
+    projectId: Uuid,
+    documentId: Uuid,
+    revisionId: Uuid,
+    revisionVersion: z.number().int().positive().safe(),
+    canvasId: Uuid,
+    snapshotSha256: Sha256,
+  })
+  .strict();
+const ScopeSchema = NativeDrawingDwgResaveScopeSchema;
+export const NATIVE_DWG_RESAVE_ARTIFACT_LIMITS = Object.freeze({
+  dwg: 209715200,
+  edit_request: 2097152,
+  authority: 67108864,
+  report: 1048576,
+});
+
+export const NativeDrawingDwgResaveArtifactKindSchema = z.enum([
+  "dwg",
+  "edit_request",
+  "authority",
+  "report",
+]);
+export type NativeDrawingDwgResaveArtifactKind = z.infer<
+  typeof NativeDrawingDwgResaveArtifactKindSchema
+>;
+
+const artifactOrder = NativeDrawingDwgResaveArtifactKindSchema.options;
+const ArtifactMetadataSchema = z
+  .object({
+    kind: NativeDrawingDwgResaveArtifactKindSchema,
+    sha256: Sha256,
+    byteSize: z.number().int().positive().safe(),
+  })
+  .strict()
+  .superRefine((artifact, context) => {
+    const minimum = artifact.kind === "dwg" ? 6 : 1;
+    if (
+      artifact.byteSize < minimum ||
+      artifact.byteSize > NATIVE_DWG_RESAVE_ARTIFACT_LIMITS[artifact.kind]
+    )
+      context.addIssue({
+        code: z.ZodIssueCode.custom,
+        path: ["byteSize"],
+        message: "Invalid native DWG resave artifact size.",
+      });
+  });
+const ArtifactMetadataArraySchema = z
+  .array(ArtifactMetadataSchema)
+  .length(4)
+  .superRefine((artifacts, context) => {
+    for (let index = 0; index < artifactOrder.length; index += 1)
+      if (artifacts[index]?.kind !== artifactOrder[index])
+        context.addIssue({
+          code: z.ZodIssueCode.custom,
+          path: [index, "kind"],
+          message: "Native DWG resave artifacts are not in canonical order.",
+        });
+  });
+
+export const NativeDrawingDwgResaveReceiptSchema = z
+  .object({
+    schemaVersion: z.literal("1hk-dwg-resave-receipt/1"),
+    jobId: Uuid,
+    attemptNumber: AttemptNumber,
+    scope: ScopeSchema,
+    resaverImageId: z.string().regex(/^sha256:[0-9a-f]{64}$/),
+    sourceSha256: Sha256,
+    qualification: z.literal("experimental-unqualified"),
+    persistenceAuthority: z.literal("not-issued"),
+    artifacts: ArtifactMetadataArraySchema,
+    createdAt: z.string().datetime({ offset: true }),
+  })
+  .strict();
+
+const AcceptanceSchema = z
+  .object({ jobId: Uuid, requestId: Uuid, hasChanges: z.boolean() })
+  .strict();
+const FailureCode = z.enum([
+  "source_unavailable",
+  "source_mismatch",
+  "resaver_failed",
+  "output_invalid",
+  "worker_interrupted",
+  "authority_revoked",
+  "upload_failed",
+  "publication_failed",
+]);
+const StatusSchema = AcceptanceSchema.extend({
+  status: z.enum([
+    "queued",
+    "processing",
+    "retry_wait",
+    "cancel_requested",
+    "cancelled",
+    "no_changes",
+    "failed",
+    "completed",
+  ]),
+  attemptCount: z.number().int().min(0).max(3),
+  failureCode: FailureCode.nullable(),
+})
+  .strict()
+  .refine(
+    (value) =>
+      (value.status === "no_changes") === !value.hasChanges &&
+      (value.status !== "no_changes" || value.attemptCount === 0) &&
+      (!["processing", "retry_wait", "cancel_requested", "completed"].includes(
+        value.status,
+      ) ||
+        value.attemptCount > 0),
+  );
+
+export {
+  ArtifactMetadataSchema as NativeDrawingDwgResaveArtifactMetadataSchema,
+  ArtifactMetadataArraySchema as NativeDrawingDwgResaveArtifactMetadataArraySchema,
+  AcceptanceSchema as NativeDrawingDwgResaveAcceptanceSchema,
+  StatusSchema as NativeDrawingDwgResaveStatusSchema,
+};
+export type NativeDrawingDwgResaveScope = z.infer<
+  typeof NativeDrawingDwgResaveScopeSchema
+>;
```

## native-dwg-worker/src/resave.ts

Final SHA256 ee907f82e4605056dffcff15e7677b9d1710835304fefdac811b4c0dfe7641a2
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/native-dwg-worker/src/resave.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/native-dwg-worker/src/resave.ts
new file mode 100644
index 0000000..cf7fb49
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/native-dwg-worker/src/resave.ts
@@ -0,0 +1,176 @@
+import { createClient } from "@supabase/supabase-js";
+import { isAbsolute, normalize } from "node:path";
+import { pathToFileURL } from "node:url";
+import { z } from "zod";
+import { parseNativeDrawingDwgResaveClaim } from "../../app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts";
+import { callNativeDrawingDwgResaveAttemptRpc } from "../../app/lukas/lib/drawing-native-dwg-resave-worker.server.ts";
+import { runNativeDrawingDwgResaveToStorage } from "../../app/lukas/lib/drawing-native-dwg-resave-publication.server.ts";
+import {
+  createNativeDrawingDwgImportRpcFetch,
+  createNativeDrawingDwgImportSourceTransport,
+} from "./import-supabase.ts";
+import { createNativeDwgResaveStorageTransport } from "./supabase.ts";
+
+const Environment = z
+  .object({
+    SUPABASE_URL: z.string().url(),
+    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).max(16_384),
+    NATIVE_DWG_RESAVER_IMAGE_ID: z.string().regex(/^sha256:[0-9a-f]{64}$/),
+    NATIVE_DWG_DOCKER_PATH: z.string().refine(isAbsolute),
+    NATIVE_DWG_DOCKER_HOST: z.string().refine((value) => {
+      if (!/^unix:\/\/\/[^\0\r\n?#%]+$/.test(value)) return false;
+      const socket = value.slice("unix://".length);
+      return (
+        isAbsolute(socket) &&
+        normalize(socket) === socket &&
+        !socket.startsWith("//")
+      );
+    }),
+    NATIVE_DWG_RESAVE_LEASE_SECONDS: z.coerce
+      .number()
+      .int()
+      .min(180)
+      .max(900)
+      .optional(),
+    NATIVE_DWG_RESAVE_POLL_MILLISECONDS: z.coerce
+      .number()
+      .int()
+      .min(100)
+      .max(60_000)
+      .optional(),
+  })
+  .strip();
+
+export function parseNativeDrawingDwgResaveWorkerConfig(
+  environment: NodeJS.ProcessEnv,
+) {
+  try {
+    const value = Environment.parse(environment);
+    const url = new URL(value.SUPABASE_URL);
+    if (
+      !["https:", "http:"].includes(url.protocol) ||
+      url.username ||
+      url.password ||
+      url.search ||
+      url.hash ||
+      url.pathname !== "/"
+    )
+      throw new Error("origin");
+    return {
+      supabaseUrl: url.origin,
+      serviceRoleKey: value.SUPABASE_SERVICE_ROLE_KEY,
+      resaverImageId: value.NATIVE_DWG_RESAVER_IMAGE_ID,
+      dockerPath: value.NATIVE_DWG_DOCKER_PATH,
+      dockerHost: value.NATIVE_DWG_DOCKER_HOST,
+      leaseSeconds: value.NATIVE_DWG_RESAVE_LEASE_SECONDS ?? 900,
+      pollMilliseconds: value.NATIVE_DWG_RESAVE_POLL_MILLISECONDS ?? 1000,
+    };
+  } catch {
+    throw new Error("Native DWG resave worker configuration is invalid.");
+  }
+}
+
+export async function runNativeDrawingDwgResaveWorkerOnce(
+  config: ReturnType<typeof parseNativeDrawingDwgResaveWorkerConfig>,
+  dependencies: Pick<
+    Parameters<typeof runNativeDrawingDwgResaveToStorage>[0],
+    "serviceClient" | "downloadSource" | "storage" | "resave" | "signal"
+  >,
+) {
+  if (dependencies.signal?.aborted) return { outcome: "idle" } as const;
+  let claim;
+  try {
+    const raw = await callNativeDrawingDwgResaveAttemptRpc(
+      dependencies.serviceClient,
+      "lukas_drawing_claim_native_dwg_resave",
+      {
+        p_resaver_image_id: config.resaverImageId,
+        p_lease_seconds: config.leaseSeconds,
+      },
+    );
+    if (raw === null) return { outcome: "idle" } as const;
+    claim = parseNativeDrawingDwgResaveClaim(raw, config.resaverImageId);
+  } catch {
+    return { outcome: "control_uncertain" } as const;
+  }
+  // A claim arriving during shutdown still needs the attempt's fenced settlement.
+  return runNativeDrawingDwgResaveToStorage({
+    ...dependencies,
+    claim,
+    imageId: config.resaverImageId,
+    dockerPath: config.dockerPath,
+    dockerHost: config.dockerHost,
+  });
+}
+
+async function wait(milliseconds: number, signal: AbortSignal) {
+  await new Promise<void>((resolve) => {
+    if (signal.aborted) return resolve();
+    const finish = () => {
+      clearTimeout(timer);
+      signal.removeEventListener("abort", finish);
+      resolve();
+    };
+    const timer = setTimeout(finish, milliseconds);
+    signal.addEventListener("abort", finish, { once: true });
+  });
+}
+
+export async function runNativeDrawingDwgResaveWorker(
+  environment: NodeJS.ProcessEnv,
+) {
+  const config = parseNativeDrawingDwgResaveWorkerConfig(environment);
+  const base = {
+    supabaseUrl: config.supabaseUrl,
+    serviceRoleKey: config.serviceRoleKey,
+  };
+  const serviceClient = createClient(
+    config.supabaseUrl,
+    config.serviceRoleKey,
+    {
+      auth: {
+        autoRefreshToken: false,
+        detectSessionInUrl: false,
+        persistSession: false,
+      },
+      global: {
+        fetch: createNativeDrawingDwgImportRpcFetch(config.supabaseUrl),
+      },
+    },
+  );
+  const { downloadSource } = createNativeDrawingDwgImportSourceTransport(base);
+  const storage = createNativeDwgResaveStorageTransport(base);
+  const controller = new AbortController();
+  const stop = () => controller.abort();
+  process.once("SIGINT", stop);
+  process.once("SIGTERM", stop);
+  process.stdout.write('{"event":"native_dwg_resave_worker_started"}\n');
+  try {
+    while (!controller.signal.aborted) {
+      const { outcome } = await runNativeDrawingDwgResaveWorkerOnce(config, {
+        serviceClient,
+        downloadSource,
+        storage,
+        signal: controller.signal,
+      });
+      process.stdout.write(
+        `${JSON.stringify({ event: "native_dwg_resave_worker_result", outcome })}\n`,
+      );
+      await wait(config.pollMilliseconds, controller.signal);
+    }
+  } finally {
+    process.off("SIGINT", stop);
+    process.off("SIGTERM", stop);
+    process.stdout.write('{"event":"native_dwg_resave_worker_stopped"}\n');
+  }
+}
+
+if (
+  process.argv[1] &&
+  import.meta.url === pathToFileURL(process.argv[1]).href
+) {
+  runNativeDrawingDwgResaveWorker(process.env).catch(() => {
+    process.stderr.write('{"event":"native_dwg_resave_worker_failed"}\n');
+    process.exitCode = 1;
+  });
+}
```

## tests/drawing-native-dwg-resave-resource.test.mjs

Final SHA256 0f003ee3ec46feb48f658f352210174302b5c14f695f1687ca1d25fa72a20f1c
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-resource.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-resource.test.mjs
new file mode 100644
index 0000000..58982f0
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-resource.test.mjs
@@ -0,0 +1,456 @@
+import assert from "node:assert/strict";
+import { createHash } from "node:crypto";
+import { createServer as httpServer } from "node:http";
+import { fileURLToPath } from "node:url";
+import test from "node:test";
+import { createServer } from "vite";
+import { resaveArtifactFixture } from "./fixtures/drawing-native-dwg-resave-artifacts.mjs";
+const vite = await createServer({
+  appType: "custom",
+  configFile: false,
+  logLevel: "silent",
+  resolve: {
+    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
+  },
+  plugins: [
+    {
+      name: "context",
+      enforce: "pre",
+      resolveId(s) {
+        if (s.endsWith("lukas/lib/drawing-collaboration.server"))
+          return "\0context";
+      },
+      load(id) {
+        if (id === "\0context")
+          return "export const drawingContext = (...args) => globalThis.__resaveContext(...args);";
+      },
+    },
+  ],
+  server: { middlewareMode: true },
+});
+test.after(() => {
+  delete globalThis.__resaveContext;
+  return vite.close();
+});
+const resource = await vite
+  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-resource.server.ts")
+  .catch(() => ({}));
+const download = await vite
+  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-download.server.ts")
+  .catch(() => ({}));
+const { buildNativeDrawingDwgResaveAttestation: build } =
+  await vite.ssrLoadModule(
+    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
+  );
+const core = await vite.ssrLoadModule(
+  "/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts",
+);
+const f = await resaveArtifactFixture(build);
+const { metadata, bytesByKind } =
+  await core.buildNativeDrawingDwgResaveArtifacts(f.claim, f.result, f.imageId);
+const { scope, jobId, actorId, attemptNumber } = f.claim;
+const requestId = "91000000-0000-4000-8000-000000000098";
+const accepted = { jobId, requestId, hasChanges: true };
+const status = {
+  ...accepted,
+  status: "completed",
+  attemptCount: 2,
+  failureCode: null,
+};
+
+test("framework resources expose loader/action delegates and preserve bounded authenticated context errors", async () => {
+  const screen = await vite.ssrLoadModule(
+    "/app/lukas/screens/drawing-native-dwg-resave.ts",
+  );
+  const downloadScreen = await vite.ssrLoadModule(
+    "/app/lukas/screens/drawing-native-dwg-resave-download.ts",
+  );
+  assert.deepEqual(Object.keys(screen).sort(), ["action", "loader"]);
+  assert.deepEqual(Object.keys(downloadScreen), ["loader"]);
+  const d = deps({ status: null });
+  globalThis.__resaveContext = async (request, projectId) => {
+    assert.equal(projectId, scope.projectId);
+    return { client: d.client, headers: d.headers };
+  };
+  const response = await screen.loader({
+    request: new Request(`${url}?${query}`),
+    params: { projectId: scope.projectId, workspaceId: scope.documentId },
+  });
+  assert.deepEqual(await response.json(), { job: null, receipt: null });
+  globalThis.__resaveContext = async () => {
+    throw new Response("private SQL credentials", {
+      status: 401,
+      headers: { "set-cookie": "session=expired; HttpOnly" },
+    });
+  };
+  try {
+    await screen.loader({
+      request: new Request(url),
+      params: { projectId: scope.projectId, workspaceId: scope.documentId },
+    });
+    assert.fail("expected rejection");
+  } catch (error) {
+    assert.equal(error.status, 401);
+    assert.equal(error.headers.get("set-cookie"), "session=expired; HttpOnly");
+    assert.doesNotMatch(await error.text(), /private|credentials|SQL/);
+  }
+});
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
+  createdAt: "2026-09-06T00:00:00Z",
+};
+const query = new URLSearchParams({
+  revisionId: scope.revisionId,
+  revisionVersion: String(scope.revisionVersion),
+  canvasId: scope.canvasId,
+  snapshotSha256: scope.snapshotSha256,
+});
+const url = `http://localhost/projects/${scope.projectId}/workspaces/${scope.documentId}/native-dwg-resave`;
+const descriptor = {
+  jobId,
+  attemptNumber,
+  kind: "dwg",
+  bucket: "lukas-qto",
+  ...metadata[0],
+  path: `projects/${scope.projectId}/native-dwg-resave/${jobId}/2/${metadata[0].sha256}/resaved.dwg`,
+};
+function deps(options = {}) {
+  const calls = [];
+  let descriptors = 0,
+    loads = 0;
+  const client = {
+    auth: {
+      getUser: async () => ({ data: { user: { id: actorId } }, error: null }),
+    },
+    rpc(name, args) {
+      calls.push({ name, args });
+      return {
+        abortSignal: async () => {
+          if (name === "lukas_qto_drawing_native_dwg_resave_source")
+            return { data: f.claim.payload, error: null };
+          if (name === "lukas_drawing_native_dwg_resave_receipt")
+            return { data: options.receipt ?? receipt, error: null };
+          if (name === "lukas_drawing_native_dwg_resave_download_descriptor")
+            return ++descriptors === 2 && options.revoke
+              ? { data: null, error: { code: "forbidden" } }
+              : { data: descriptor, error: null };
+          return {
+            data: Object.hasOwn(options, "status") ? options.status : status,
+            error: null,
+          };
+        },
+      };
+    },
+  };
+  const service = {
+    rpc(name, args) {
+      calls.push({ name, args });
+      return { abortSignal: async () => ({ data: accepted, error: null }) };
+    },
+    storage: {
+      from(bucket) {
+        assert.equal(bucket, "lukas-qto");
+        return {
+          download(path, _options, { signal }) {
+            assert.equal(path, descriptor.path);
+            return {
+              asStream: () =>
+                options.stream
+                  ? options.stream(signal)
+                  : Promise.resolve({
+                      data: new Blob([bytesByKind.dwg]).stream(),
+                      error: null,
+                    }),
+            };
+          },
+        };
+      },
+    },
+  };
+  return {
+    client,
+    headers: new Headers({ "x-auth-test": "preserved" }),
+    projectId: scope.projectId,
+    workspaceId: scope.documentId,
+    imageId: f.imageId,
+    loadServiceClient: async () => {
+      loads++;
+      return service;
+    },
+    calls,
+    get loads() {
+      return loads;
+    },
+  };
+}
+function post(body, headers = {}) {
+  return new Request(url, {
+    method: "POST",
+    headers: {
+      origin: "http://localhost",
+      "content-type": "application/json",
+      ...headers,
+    },
+    body: typeof body === "string" ? body : JSON.stringify(body),
+  });
+}
+const rejected = (code) => async (e) => {
+  assert.ok(e instanceof Response);
+  assert.equal(e.status, code);
+  assert.equal(e.headers.get("cache-control"), "private, no-store");
+  assert.doesNotMatch(await e.text(), /private|lukas_|sha256:/);
+  return true;
+};
+async function reject(promise, code) {
+  try {
+    await promise;
+    assert.fail("expected rejection");
+  } catch (e) {
+    await rejected(code)(e);
+  }
+}
+test("resource admits strict authenticated intent via actual compiler and trusted image", async () => {
+  assert.equal(
+    typeof resource.handleNativeDrawingDwgResaveResource,
+    "function",
+  );
+  const d = deps();
+  const r = await resource.handleNativeDrawingDwgResaveResource({
+    ...d,
+    request: post({ intent: "request", ...scope, requestId }),
+  });
+  assert.equal(r.status, 202);
+  assert.deepEqual(await r.json(), accepted);
+  assert.equal(d.loads, 1);
+  const admitted = d.calls.find(
+    (c) => c.name === "lukas_drawing_admit_native_dwg_resave",
+  );
+  assert.equal(admitted.args.p_actor_id, actorId);
+  assert.equal(admitted.args.p_attestation.resaverImageId, f.imageId);
+  assert.equal(admitted.args.p_request_id, requestId);
+  assert.equal("intent" in admitted.args.p_scope, false);
+});
+test("resource rejects origin, media, overflow, malformed UTF8, extra authority, route and query identities", async () => {
+  const body = { intent: "request", ...scope, requestId };
+  for (const request of [
+    post(body, { origin: "http://evil.test" }),
+    post(body, { origin: "" }),
+  ])
+    await reject(
+      resource.handleNativeDrawingDwgResaveResource({ ...deps(), request }),
+      403,
+    );
+  for (const request of [
+    post(body, { "content-type": "text/plain" }),
+    post("{"),
+    post({ ...body, actorId }),
+    post({ ...body, resaverImageId: f.imageId }),
+    post({ ...body, path: "private" }),
+    post({ ...body, intent: "other" }),
+    new Request(url, {
+      method: "POST",
+      headers: {
+        origin: "http://localhost",
+        "content-type": "application/json",
+      },
+      body: new Uint8Array([0xff]),
+    }),
+  ])
+    await reject(
+      resource.handleNativeDrawingDwgResaveResource({ ...deps(), request }),
+      400,
+    );
+  await reject(
+    resource.handleNativeDrawingDwgResaveResource({
+      ...deps(),
+      request: post(" ".repeat(4097)),
+    }),
+    413,
+  );
+  await reject(
+    resource.handleNativeDrawingDwgResaveResource({
+      ...deps(),
+      workspaceId: jobId,
+      request: post(body),
+    }),
+    409,
+  );
+  for (const suffix of ["&unknown=x", "&revisionVersion=2", "&jobId=invalid"])
+    await reject(
+      resource.handleNativeDrawingDwgResaveResource({
+        ...deps(),
+        request: new Request(`${url}?${query}${suffix}`),
+      }),
+      400,
+    );
+  const d = deps();
+  await reject(
+    resource.handleNativeDrawingDwgResaveResource({
+      ...d,
+      imageId: undefined,
+      request: post(body),
+    }),
+    503,
+  );
+  assert.equal(d.loads, 0);
+});
+test("GET idle and pending omit receipt; completed reads exact receipt; cancel needs no admin/image", async () => {
+  for (const job of [null, { ...status, status: "processing" }, status]) {
+    const d = deps({ status: job });
+    const r = await resource.handleNativeDrawingDwgResaveResource({
+      ...d,
+      imageId: undefined,
+      request: new Request(`${url}?${query}`),
+    });
+    assert.deepEqual(await r.json(), {
+      job,
+      receipt: job?.status === "completed" ? receipt : null,
+    });
+    assert.equal(d.loads, 0);
+    assert.equal(
+      d.calls.filter((c) => c.name.includes("receipt")).length,
+      job?.status === "completed" ? 1 : 0,
+    );
+  }
+  const d = deps({ status: { ...status, status: "cancel_requested" } });
+  const r = await resource.handleNativeDrawingDwgResaveResource({
+    ...d,
+    imageId: undefined,
+    request: post({ intent: "cancel", ...scope, jobId }),
+  });
+  assert.equal((await r.json()).job.status, "cancel_requested");
+  assert.equal(d.loads, 0);
+  assert.equal(d.calls[0].name, "lukas_drawing_cancel_native_dwg_resave");
+  await reject(
+    resource.handleNativeDrawingDwgResaveResource({
+      ...deps({
+        receipt: { ...receipt, scope: { ...scope, documentId: jobId } },
+      }),
+      request: new Request(`${url}?${query}`),
+    }),
+    400,
+  );
+});
+function getDownload(
+  d = deps(),
+  request = new Request(`${url}/${jobId}/download/dwg?${query}`),
+  runtime,
+) {
+  return download.handleNativeDrawingDwgResaveDownload(
+    { ...d, request, scope, jobId, kind: "dwg" },
+    runtime,
+  );
+}
+test("download returns copied hash-verified bytes only after second authorization and never leaks locator", async () => {
+  assert.equal(
+    typeof download.handleNativeDrawingDwgResaveDownload,
+    "function",
+  );
+  const d = deps();
+  const r = await getDownload(d);
+  assert.equal(r.headers.get("cache-control"), "private, no-store");
+  assert.equal(r.headers.get("referrer-policy"), "no-referrer");
+  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
+  assert.equal(r.headers.get("x-auth-test"), "preserved");
+  assert.match(r.headers.get("content-disposition"), /^attachment;/);
+  assert.equal(
+    createHash("sha256")
+      .update(Buffer.from(await r.arrayBuffer()))
+      .digest("hex"),
+    metadata[0].sha256,
+  );
+  assert.equal(d.calls.length, 2);
+  await reject(getDownload(deps({ revoke: true })), 404);
+  await reject(
+    getDownload(
+      deps({
+        stream: async () => ({
+          data: new Blob(["wrong"]).stream(),
+          error: null,
+        }),
+      }),
+    ),
+    503,
+  );
+  const mutable = new Uint8Array(bytesByKind.dwg);
+  let n = 0;
+  const stream = new ReadableStream(
+    {
+      pull(c) {
+        if (n++ === 0) c.enqueue(mutable);
+        else {
+          mutable.fill(0);
+          c.close();
+        }
+      },
+    },
+    { highWaterMark: 0 },
+  );
+  const copied = await getDownload(
+    deps({ stream: async () => ({ data: stream, error: null }) }),
+  );
+  assert.equal(
+    createHash("sha256")
+      .update(Buffer.from(await copied.arrayBuffer()))
+      .digest("hex"),
+    metadata[0].sha256,
+  );
+});
+test("download deadline returns despite abort-ignoring GET/body/cancel and actual stalled loopback body", async () => {
+  for (const stream of [
+    () => new Promise(() => {}),
+    async () => ({
+      data: new ReadableStream({
+        pull() {
+          return new Promise(() => {});
+        },
+        cancel() {
+          return new Promise(() => {});
+        },
+      }),
+      error: null,
+    }),
+  ]) {
+    const started = Date.now();
+    await reject(
+      getDownload(deps({ stream }), undefined, { downloadMilliseconds: 30 }),
+      503,
+    );
+    assert.ok(Date.now() - started < 1000);
+  }
+  const server = httpServer((_q, r) => {
+    r.writeHead(200);
+    r.write("AC1024");
+  });
+  await new Promise((r) => server.listen(0, "127.0.0.1", r));
+  try {
+    await reject(
+      getDownload(
+        deps({
+          stream: async (signal) => ({
+            data: (
+              await fetch(`http://127.0.0.1:${server.address().port}`, {
+                signal,
+              })
+            ).body,
+            error: null,
+          }),
+        }),
+        undefined,
+        { downloadMilliseconds: 60 },
+      ),
+      503,
+    );
+  } finally {
+    server.closeAllConnections();
+    await new Promise((r) => server.close(r));
+  }
+});
```

## tests/drawing-native-dwg-resave-control.test.mjs

Final SHA256 c41bb7f08c96864a2d147bf66b6d02b26a462e067e150f432175e172ec0d0944
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-control.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-control.test.mjs
new file mode 100644
index 0000000..6ee58ec
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-control.test.mjs
@@ -0,0 +1,402 @@
+import assert from "node:assert/strict";
+import { readFile } from "node:fs/promises";
+import { fileURLToPath } from "node:url";
+import test from "node:test";
+import { createServer } from "vite";
+import { chromium } from "@playwright/test";
+const actor = "82000000-0000-4000-8000-000000000080",
+  otherActor = "82000000-0000-4000-8000-000000000081",
+  jobId = "82000000-0000-4000-8000-000000000090";
+const scope = {
+  projectId: "82000000-0000-4000-8000-000000000001",
+  documentId: "82000000-0000-4000-8000-000000000002",
+  revisionId: "82000000-0000-4000-8000-000000000003",
+  revisionVersion: 3,
+  canvasId: "82000000-0000-4000-8000-000000000004",
+  snapshotSha256: "a".repeat(64),
+};
+const receipt = {
+  schemaVersion: "1hk-dwg-resave-receipt/1",
+  jobId,
+  attemptNumber: 1,
+  scope,
+  resaverImageId: "sha256:" + "c".repeat(64),
+  sourceSha256: "b".repeat(64),
+  qualification: "experimental-unqualified",
+  persistenceAuthority: "not-issued",
+  artifacts: [
+    { kind: "dwg", sha256: "d".repeat(64), byteSize: 6 },
+    { kind: "edit_request", sha256: "e".repeat(64), byteSize: 1 },
+    { kind: "authority", sha256: "f".repeat(64), byteSize: 1 },
+    { kind: "report", sha256: "0".repeat(64), byteSize: 1 },
+  ],
+  createdAt: "2026-09-06T00:00:00Z",
+};
+async function browserTest(run) {
+  const server = await createServer({
+    configFile: false,
+    logLevel: "silent",
+    resolve: {
+      alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
+    },
+    server: { host: "127.0.0.1", port: 0 },
+    plugins: [
+      {
+        name: "resave-fixture",
+        enforce: "pre",
+        configureServer(s) {
+          s.middlewares.use((req, res, next) => {
+            if (req.url !== "/") return next();
+            res.setHeader("Content-Type", "text/html");
+            res.end(
+              '<div id="root"></div><script type="module" src="/resave-fixture.js"></script>',
+            );
+          });
+        },
+        resolveId(id) {
+          if (id === "/resave-fixture.js") return "\0resave-fixture";
+          if (
+            id === "~/core/components/ui/dialog" ||
+            /\/core\/components\/ui\/dialog(?:\.tsx)?$/.test(id)
+          )
+            return "\0dialog";
+        },
+        load(id) {
+          if (id === "\0dialog")
+            return `import React from 'react'; const Shell=({children})=>React.createElement('div',null,children);export const Dialog=Shell,DialogClose=Shell,DialogContent=Shell,DialogDescription=Shell,DialogFooter=Shell,DialogHeader=Shell,DialogTitle=Shell,DialogTrigger=Shell;`;
+          if (id !== "\0resave-fixture") return;
+          return `import React from 'react';import {createRoot} from 'react-dom/client';import {NativeDrawingDwgResaveControl} from '/app/lukas/components/drawing-native-dwg-resave-control.tsx';import {DrawingExportDialog} from '/app/lukas/components/drawing-export-dialog.tsx';import {buildNativeDrawingTemplate} from '/app/lukas/lib/drawing-native-templates.ts';import {createDrawingDocumentState} from '/app/lukas/lib/drawing-commands.ts';
+ window.props={scope:${JSON.stringify(scope)},currentUserId:${JSON.stringify(actor)},open:true,readiness:true};window.calls=[];window.pending=[];window.result={job:null,receipt:null};window.failPost=false;window.hold=false;
+ const transport=async(url,init={})=>{const body=init.body?JSON.parse(init.body):null;window.calls.push({url,body});if(window.hold)return new Promise(resolve=>window.pending.push(value=>resolve(Response.json(value))));if(body?.intent==='request'){if(window.failPost)throw Error('uncertain');window.result={job:{jobId:${JSON.stringify(jobId)},requestId:body.requestId,hasChanges:true,status:'queued',attemptCount:0,failureCode:null},receipt:null};return Response.json({jobId:${JSON.stringify(jobId)},requestId:body.requestId,hasChanges:true});}if(body?.intent==='cancel')window.result={job:{...window.result.job,status:'cancelled'},receipt:null};return Response.json(window.result);};
+ window.fetch=transport;const root=createRoot(document.getElementById('root'));window.render=()=>root.render(React.createElement(NativeDrawingDwgResaveControl,{...window.props,transport}));window.render();
+ const t=buildNativeDrawingTemplate('measured-plan');const canvas=Object.values(t.structure.canvases)[0];canvas.outputProfile=t.outputProfile;
+ window.dialogProps={auditRequired:true,currentUserId:${JSON.stringify(actor)},checkpointSha256:'a'.repeat(64),createdAt:'2026-09-06T00:00:00Z',documentState:{...createDrawingDocumentState({revisionId:t.structure.revisionId,structure:t.structure}),activeCanvasId:canvas.id,activePageId:canvas.pageId},hideTrigger:true,open:true,operationCheckpoint:0,outboxReady:true,projectId:${JSON.stringify(scope.projectId)},revisionId:t.structure.revisionId,revisionStatus:'approved',revisionVersion:1,saveStatus:'저장됨',sourceUrl:null,title:t.name,workspaceId:${JSON.stringify(scope.documentId)}};
+ window.renderDialog=()=>root.render(React.createElement(DrawingExportDialog,window.dialogProps));window.unmount=()=>root.render(null);`;
+        },
+      },
+    ],
+  });
+  let browser;
+  try {
+    await server.listen();
+    browser = await chromium.launch({ headless: true });
+    const page = await browser.newPage();
+    page.setDefaultTimeout(5000);
+    const errors = [];
+    page.on("pageerror", (e) => errors.push(e.message));
+    await page.goto(server.resolvedUrls.local[0]);
+    await page.waitForFunction(() => typeof window.render === "function");
+    await run(page);
+    assert.deepEqual(errors, []);
+  } finally {
+    await browser?.close();
+    await server.close();
+  }
+}
+test("browser-safe DTO contract is shared and rejects forged completed envelopes", async () => {
+  const vite = await createServer({
+    appType: "custom",
+    configFile: false,
+    logLevel: "silent",
+    server: { middlewareMode: true },
+  });
+  try {
+    const c = await vite
+      .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-contract.ts")
+      .catch(() => ({}));
+    assert.equal(
+      typeof c.NativeDrawingDwgResaveReceiptSchema?.safeParse,
+      "function",
+    );
+    assert.equal(
+      c.NativeDrawingDwgResaveReceiptSchema.safeParse(receipt).success,
+      true,
+    );
+    for (const bad of [
+      { ...receipt, persistenceAuthority: "issued" },
+      { ...receipt, artifacts: [...receipt.artifacts].reverse() },
+      { ...receipt, path: "private" },
+    ])
+      assert.equal(
+        c.NativeDrawingDwgResaveReceiptSchema.safeParse(bad).success,
+        false,
+      );
+  } finally {
+    await vite.close();
+  }
+});
+test("React requests only on click, retries same identity, owns cancel, and exposes only completed validated four links", async () =>
+  browserTest(async (page) => {
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
+    assert.equal(
+      await page.evaluate(() => window.calls.filter((c) => c.body).length),
+      0,
+    );
+    await page.evaluate(() => (window.failPost = true));
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
+    await page.getByRole("alert").waitFor();
+    const first = await page.evaluate(
+      () => window.calls.find((c) => c.body).body,
+    );
+    assert.deepEqual(
+      Object.keys(first).sort(),
+      ["intent", ...Object.keys(scope), "requestId"].sort(),
+    );
+    await page.evaluate(() => (window.failPost = false));
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
+    await page.getByRole("button", { name: "요청 취소" }).waitFor();
+    const posts = await page.evaluate(() => window.calls.filter((c) => c.body));
+    assert.equal(posts[1].body.requestId, first.requestId);
+    assert.equal(await page.locator("a").count(), 0);
+    await page.evaluate(() => {
+      window.result = {
+        job: { ...window.result.job, status: "completed", attemptCount: 1 },
+        receipt: null,
+      };
+    });
+    await page.waitForTimeout(1150);
+    assert.equal(await page.locator("a").count(), 0);
+    await page.evaluate((r) => {
+      window.result.receipt = r;
+    }, receipt);
+    await page.getByRole("link", { name: "DWG 다운로드" }).waitFor();
+    assert.equal(await page.locator("a").count(), 4);
+    const hrefs = await page
+      .locator("a")
+      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
+    assert.ok(
+      hrefs.every((h) =>
+        h.startsWith(
+          `/projects/${scope.projectId}/workspaces/${scope.documentId}/native-dwg-resave/${jobId}/download/`,
+        ),
+      ),
+    );
+  }));
+test("actor/open/scope generations fence A to B to A responses and relogin reads latest without admission", async () =>
+  browserTest(async (page) => {
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
+    await page.evaluate(() => {
+      window.hold = true;
+      window.props = { ...window.props, open: false };
+      window.render();
+    });
+    await page.waitForTimeout(30);
+    await page.evaluate(() => {
+      window.props = { ...window.props, open: true };
+      window.render();
+    });
+    await page.waitForFunction(() => window.pending.length === 1);
+    await page.evaluate((a) => {
+      window.props = { ...window.props, currentUserId: a };
+      window.render();
+    }, otherActor);
+    await page.waitForFunction(() => window.pending.length === 2);
+    await page.evaluate((a) => {
+      window.props = { ...window.props, currentUserId: a };
+      window.render();
+    }, actor);
+    await page.waitForFunction(() => window.pending.length === 3);
+    await page.evaluate(
+      ({ receipt, jobId }) =>
+        window.pending[0]({
+          job: {
+            jobId,
+            requestId: "82000000-0000-4000-8000-000000000091",
+            hasChanges: true,
+            status: "completed",
+            attemptCount: 1,
+            failureCode: null,
+          },
+          receipt,
+        }),
+      { receipt, jobId },
+    );
+    await page.waitForTimeout(30);
+    assert.equal(await page.locator("a").count(), 0);
+    await page.evaluate(() => window.pending[2]({ job: null, receipt: null }));
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
+    assert.equal(
+      await page.evaluate(() => window.calls.filter((c) => c.body).length),
+      0,
+    );
+    await page.evaluate(() => {
+      window.hold = false;
+      window.props = { ...window.props, currentUserId: null };
+      window.render();
+    });
+    assert.equal(
+      await page.getByRole("button", { name: "DWG 재저장 요청" }).count(),
+      0,
+    );
+  }));
+test("actual dialog chooses one imported control and gates actor/backend/checkpoint/outbox; workspace passes actor", async () => {
+  const workspace = await readFile(
+    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
+    "utf8",
+  );
+  assert.match(
+    workspace,
+    /<DrawingExportLauncher[\s\S]*?currentUserId=\{currentUserId\}/,
+  );
+  await browserTest(async (page) => {
+    await page.evaluate(() => {
+      window.dialogProps.documentState.structure.sources = {
+        imported: { sourceKind: "dwg_entity" },
+      };
+      window.renderDialog();
+    });
+    await page.getByRole("radio", { name: "DWG (시험)" }).check();
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
+    assert.equal(
+      await page.getByRole("button", { name: "네이티브 DWG 요청" }).count(),
+      0,
+    );
+    for (const change of [
+      { auditRequired: false },
+      { outboxReady: false },
+      { operationCheckpoint: null },
+      { checkpointSha256: null },
+      { saveStatus: "저장 중" },
+      { currentUserId: null },
+    ]) {
+      await page.evaluate((change) => {
+        window.saved = { ...window.dialogProps };
+        Object.assign(window.dialogProps, change);
+        window.renderDialog();
+      }, change);
+      const button = page.getByRole("button", { name: "DWG 재저장 요청" });
+      assert.ok((await button.count()) === 0 || (await button.isDisabled()));
+      await page.evaluate(() => {
+        window.dialogProps = window.saved;
+        window.renderDialog();
+      });
+    }
+    await page.evaluate(() => {
+      window.dialogProps.documentState.structure.sources = {};
+      window.renderDialog();
+    });
+    assert.equal(
+      await page.getByRole("button", { name: "DWG 재저장 요청" }).count(),
+      0,
+    );
+    assert.ok((await page.locator("body").innerText()).includes("네이티브"));
+  });
+});
+
+test("remount recovers latest and actor-scoped ownership; own cancel is explicit and retry gets a new ID", async () =>
+  browserTest(async (page) => {
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
+    await page.getByRole("button", { name: "요청 취소" }).waitFor();
+    const first = await page.evaluate(() => window.result.job.requestId);
+    await page.evaluate(() => window.unmount());
+    await page.waitForFunction(
+      () => document.querySelector("#root").childElementCount === 0,
+    );
+    await page.evaluate(() => window.render());
+    await page.getByRole("button", { name: "요청 취소" }).waitFor();
+    assert.equal(
+      await page.evaluate(() => window.calls.filter((c) => c.body).length),
+      1,
+    );
+    assert.ok(
+      await page.evaluate(() => !window.calls.at(-1).url.includes("jobId=")),
+    );
+    await page.evaluate((a) => {
+      window.props = { ...window.props, currentUserId: a };
+      window.render();
+    }, otherActor);
+    await page.waitForFunction(() =>
+      document.body.innerText.includes("대기 중"),
+    );
+    assert.equal(
+      await page.getByRole("button", { name: "요청 취소" }).count(),
+      0,
+    );
+    await page.evaluate((a) => {
+      window.props = { ...window.props, currentUserId: a };
+      window.render();
+    }, actor);
+    await page.getByRole("button", { name: "요청 취소" }).click();
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
+    const cancel = await page.evaluate(
+      () => window.calls.find((c) => c.body?.intent === "cancel").body,
+    );
+    assert.deepEqual(cancel, { intent: "cancel", ...scope, jobId });
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
+    await page.getByRole("button", { name: "요청 취소" }).waitFor();
+    assert.notEqual(
+      await page.evaluate(() => window.result.job.requestId),
+      first,
+    );
+  }));
+
+test("scope and close/reopen generations fence pending status; disabled storage keeps uncertain identity", async () =>
+  browserTest(async (page) => {
+    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
+    await page.evaluate(() => {
+      window.failPost = true;
+      Storage.prototype.getItem = () => {
+        throw Error("denied");
+      };
+      Storage.prototype.setItem = () => {
+        throw Error("denied");
+      };
+    });
+    for (let i = 0; i < 2; i++) {
+      await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
+      await page.getByRole("alert").waitFor();
+    }
+    assert.equal(
+      await page.evaluate(
+        () =>
+          window.calls.filter((c) => c.body)[0].body.requestId ===
+          window.calls.filter((c) => c.body)[1].body.requestId,
+      ),
+      true,
+    );
+    await page.evaluate(() => {
+      window.hold = true;
+      window.props = {
+        ...window.props,
+        scope: { ...window.props.scope, revisionVersion: 4 },
+      };
+      window.render();
+    });
+    await page.waitForFunction(() => window.pending.length === 1);
+    await page.evaluate(() => {
+      window.props = {
+        ...window.props,
+        scope: { ...window.props.scope, revisionVersion: 3 },
+      };
+      window.render();
+    });
+    await page.waitForFunction(() => window.pending.length === 2);
+    await page.evaluate(() => {
+      window.props = { ...window.props, open: false };
+      window.render();
+    });
+    await page.waitForTimeout(25);
+    await page.evaluate(() => {
+      window.props = { ...window.props, open: true };
+      window.render();
+    });
+    await page.waitForFunction(() => window.pending.length === 3);
+    await page.evaluate(
+      ({ receipt, jobId }) =>
+        window.pending[1]({
+          job: {
+            jobId,
+            requestId: "82000000-0000-4000-8000-000000000091",
+            hasChanges: true,
+            status: "completed",
+            attemptCount: 1,
+            failureCode: null,
+          },
+          receipt,
+        }),
+      { receipt, jobId },
+    );
+    await page.waitForTimeout(25);
+    assert.equal(await page.locator("a").count(), 0);
+    await page.evaluate(() => window.pending[2]({ job: null, receipt: null }));
+  }));
```

## tests/drawing-native-dwg-resave-entry.test.mjs

Final SHA256 c01ba555ace79ef63080c06281d2f1c5aadd40490827e28f537ebe14007e70e8
Baseline /dev/null

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-entry.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-entry.test.mjs
new file mode 100644
index 0000000..45a6a7e
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/platform/tests/drawing-native-dwg-resave-entry.test.mjs
@@ -0,0 +1,381 @@
+import assert from "node:assert/strict";
+import { spawn } from "node:child_process";
+import { createServer as httpServer } from "node:http";
+import { fileURLToPath } from "node:url";
+import test from "node:test";
+import { createServer } from "vite";
+import { resaveArtifactFixture } from "./fixtures/drawing-native-dwg-resave-artifacts.mjs";
+const vite = await createServer({
+  appType: "custom",
+  configFile: false,
+  logLevel: "silent",
+  server: { middlewareMode: true },
+});
+test.after(() => vite.close());
+const entry = await vite
+  .ssrLoadModule("/native-dwg-worker/src/resave.ts")
+  .catch(() => ({}));
+const { buildNativeDrawingDwgResaveAttestation: build } =
+  await vite.ssrLoadModule(
+    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
+  );
+const f = await resaveArtifactFixture(build);
+const env = {
+  SUPABASE_URL: "https://project.supabase.co",
+  SUPABASE_SERVICE_ROLE_KEY: "test-secret",
+  NATIVE_DWG_RESAVER_IMAGE_ID: f.imageId,
+  NATIVE_DWG_DOCKER_PATH: "/unused/docker",
+  NATIVE_DWG_DOCKER_HOST: "unix:///unused/docker.sock",
+};
+test("resave config validates immutable image, origin, local socket, lease and poll bounds", () => {
+  assert.equal(
+    typeof entry.parseNativeDrawingDwgResaveWorkerConfig,
+    "function",
+  );
+  assert.deepEqual(entry.parseNativeDrawingDwgResaveWorkerConfig(env), {
+    supabaseUrl: "https://project.supabase.co",
+    serviceRoleKey: "test-secret",
+    resaverImageId: f.imageId,
+    dockerPath: "/unused/docker",
+    dockerHost: "unix:///unused/docker.sock",
+    leaseSeconds: 900,
+    pollMilliseconds: 1000,
+  });
+  for (const change of [
+    { SUPABASE_URL: "https://user:secret@project.supabase.co" },
+    { SUPABASE_URL: "https://project.supabase.co/path" },
+    { NATIVE_DWG_RESAVER_IMAGE_ID: "resaver:latest" },
+    { NATIVE_DWG_DOCKER_PATH: "docker" },
+    { NATIVE_DWG_DOCKER_HOST: "unix:///tmp/../docker.sock" },
+    { NATIVE_DWG_DOCKER_HOST: "tcp://localhost:2375" },
+    { NATIVE_DWG_RESAVE_LEASE_SECONDS: "179" },
+    { NATIVE_DWG_RESAVE_LEASE_SECONDS: "901" },
+    { NATIVE_DWG_RESAVE_POLL_MILLISECONDS: "99" },
+    { NATIVE_DWG_RESAVE_POLL_MILLISECONDS: "60001" },
+  ])
+    assert.throws(
+      () =>
+        entry.parseNativeDrawingDwgResaveWorkerConfig({ ...env, ...change }),
+      /^Error: Native DWG resave worker configuration is invalid\.$/,
+    );
+});
+
+test("strip-compatible error fields preserve the accepted source-free and imported error contract", async () => {
+  const sourceFree = await import(
+    "../app/lukas/lib/drawing-native-dwg-jobs.server.ts"
+  );
+  const imported = await import(
+    "../app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts"
+  );
+  for (const [kind, message] of [
+    ["invalid", "Invalid native DWG request."],
+    ["unavailable", "Native DWG export is unavailable."],
+    ["conflict", "Native DWG export state conflicts with this request."],
+    ["capacity", "Native DWG export capacity is currently full."],
+  ]) {
+    const error = new sourceFree.NativeDrawingDwgJobError(kind);
+    assert.equal(error.kind, kind);
+    assert.equal(error.message, message);
+    assert.equal(error.name, "NativeDrawingDwgJobError");
+    assert.ok(error instanceof Error);
+  }
+  for (const kind of [
+    "invalid",
+    "unavailable",
+    "conflict",
+    "stale",
+    "capacity",
+  ]) {
+    const error = new imported.NativeDrawingDwgResaveJobError(kind);
+    assert.equal(error.kind, kind);
+    assert.equal(error.message, `Native DWG resave ${kind}.`);
+    assert.equal(error.name, "NativeDrawingDwgResaveJobError");
+  }
+});
+test("worker once uses exact claim RPC, validates claim, and settles a claim received during shutdown", async () => {
+  assert.equal(typeof entry.runNativeDrawingDwgResaveWorkerOnce, "function");
+  const config = entry.parseNativeDrawingDwgResaveWorkerConfig(env);
+  const stop = new AbortController();
+  const calls = [];
+  const dependencies = {
+    serviceClient: {
+      rpc(name, args) {
+        calls.push({ name, args });
+        return {
+          abortSignal: async () => {
+            if (name === "lukas_drawing_claim_native_dwg_resave") {
+              stop.abort();
+              return { data: f.claim, error: null };
+            }
+            if (name === "lukas_drawing_native_dwg_resave_control") {
+              return {
+                data: {
+                  jobId: f.claim.jobId,
+                  attemptNumber: 2,
+                  leaseToken: f.claim.leaseToken,
+                  action: "continue",
+                  reason: null,
+                },
+                error: null,
+              };
+            }
+            return {
+              data: {
+                jobId: f.claim.jobId,
+                attemptNumber: 2,
+                leaseToken: f.claim.leaseToken,
+                status: "retry_wait",
+              },
+              error: null,
+            };
+          },
+        };
+      },
+    },
+    downloadSource: () => assert.fail("shutdown downloaded source"),
+    storage: {
+      upload: () => assert.fail("shutdown uploaded"),
+      read: () => assert.fail("shutdown read"),
+    },
+    signal: stop.signal,
+  };
+  const result = await entry.runNativeDrawingDwgResaveWorkerOnce(
+    config,
+    dependencies,
+  );
+  assert.deepEqual(result, { outcome: "retry_scheduled" });
+  assert.deepEqual(calls[0], {
+    name: "lukas_drawing_claim_native_dwg_resave",
+    args: { p_resaver_image_id: f.imageId, p_lease_seconds: 900 },
+  });
+  assert.ok(
+    calls.some((c) => c.name === "lukas_drawing_fail_native_dwg_resave"),
+  );
+  calls.length = 0;
+  assert.deepEqual(
+    await entry.runNativeDrawingDwgResaveWorkerOnce(config, dependencies),
+    { outcome: "idle" },
+  );
+  assert.equal(calls.length, 0);
+  for (const data of [
+    undefined,
+    { jobId: f.claim.jobId },
+    { ...f.claim, actorId: "invalid" },
+  ]) {
+    const names = [];
+    assert.deepEqual(
+      await entry.runNativeDrawingDwgResaveWorkerOnce(config, {
+        ...dependencies,
+        signal: undefined,
+        serviceClient: {
+          rpc(name) {
+            names.push(name);
+            return { abortSignal: async () => ({ data, error: null }) };
+          },
+        },
+      }),
+      { outcome: "control_uncertain" },
+    );
+    assert.deepEqual(names, ["lukas_drawing_claim_native_dwg_resave"]);
+  }
+});
+test("actual strip-only Node CLI claims idle and SIGTERM exits cleanly with outcome-only sanitized logs", async (t) => {
+  const calls = [];
+  let child;
+  const server = httpServer(async (req, res) => {
+    const chunks = [];
+    for await (const chunk of req) chunks.push(chunk);
+    calls.push({
+      url: req.url,
+      method: req.method,
+      body: JSON.parse(Buffer.concat(chunks)),
+    });
+    res.writeHead(200, { "content-type": "application/json" });
+    res.end("null");
+  });
+  await new Promise((r) => server.listen(0, "127.0.0.1", r));
+  t.after(async () => {
+    if (child?.exitCode === null && child?.signalCode === null)
+      child.kill("SIGKILL");
+    server.closeAllConnections();
+    await new Promise((r) => server.close(r));
+  });
+  child = spawn(
+    process.execPath,
+    ["--experimental-strip-types", "native-dwg-worker/src/resave.ts"],
+    {
+      cwd: fileURLToPath(new URL("..", import.meta.url)),
+      env: {
+        PATH: process.env.PATH,
+        NODE_OPTIONS: "--no-experimental-webstorage",
+        ...env,
+        SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
+      },
+      stdio: ["ignore", "pipe", "pipe"],
+    },
+  );
+  let stdout = "",
+    stderr = "",
+    sentStop = false;
+  child.stdout.on("data", (b) => {
+    stdout += b;
+    if (!sentStop && stdout.includes('"outcome":"idle"')) {
+      sentStop = true;
+      child.kill("SIGTERM");
+    }
+  });
+  child.stderr.on("data", (b) => (stderr += b));
+  const result = await new Promise((resolve, reject) => {
+    const timer = setTimeout(() => {
+      child.kill("SIGKILL");
+      reject(Error("CLI timeout"));
+    }, 5000);
+    child.once("error", reject);
+    child.once("exit", (code, signal) => {
+      clearTimeout(timer);
+      resolve({ code, signal });
+    });
+  });
+  assert.deepEqual(result, { code: 0, signal: null });
+  assert.equal(stderr, "");
+  assert.deepEqual(stdout.trim().split("\n").map(JSON.parse), [
+    { event: "native_dwg_resave_worker_started" },
+    { event: "native_dwg_resave_worker_result", outcome: "idle" },
+    { event: "native_dwg_resave_worker_stopped" },
+  ]);
+  assert.deepEqual(calls, [
+    {
+      url: "/rest/v1/rpc/lukas_drawing_claim_native_dwg_resave",
+      method: "POST",
+      body: { p_resaver_image_id: f.imageId, p_lease_seconds: 900 },
+    },
+  ]);
+  assert.doesNotMatch(stdout, /test-secret|sha256|receipt|leaseToken/);
+});
+
+test("actual CLI source transport is wired and every immediate refusal turn gets a bounded poll wait", async (t) => {
+  const calls = [];
+  let child;
+  let claimCount = 0;
+  const identity = {
+    jobId: f.claim.jobId,
+    attemptNumber: 2,
+    leaseToken: f.claim.leaseToken,
+  };
+  const server = httpServer(async (req, res) => {
+    const chunks = [];
+    for await (const chunk of req) chunks.push(chunk);
+    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
+    calls.push({
+      url: req.url,
+      body,
+      at: Date.now(),
+      authorization: req.headers.authorization,
+    });
+    let value;
+    if (req.url === "/rest/v1/rpc/lukas_drawing_claim_native_dwg_resave")
+      value = ++claimCount === 1 ? f.claim : { invalid: true };
+    else if (req.url === "/rest/v1/rpc/lukas_drawing_native_dwg_resave_control")
+      value = { ...identity, action: "continue", reason: null };
+    else if (req.url === "/rest/v1/rpc/lukas_drawing_fail_native_dwg_resave")
+      value = { ...identity, status: "retry_wait" };
+    else if (req.url === "/storage/v1/object/lukas-qto/owned/source.dwg") {
+      res.writeHead(200, {
+        "content-length": String(f.sourceBytes.byteLength),
+      });
+      res.end(f.sourceBytes);
+      return;
+    } else {
+      res.writeHead(404);
+      res.end();
+      return;
+    }
+    res.writeHead(200, { "content-type": "application/json" });
+    res.end(JSON.stringify(value));
+  });
+  await new Promise((r) => server.listen(0, "127.0.0.1", r));
+  t.after(async () => {
+    if (child?.exitCode === null && child?.signalCode === null)
+      child.kill("SIGKILL");
+    server.closeAllConnections();
+    await new Promise((r) => server.close(r));
+  });
+  child = spawn(
+    process.execPath,
+    ["--experimental-strip-types", "native-dwg-worker/src/resave.ts"],
+    {
+      cwd: fileURLToPath(new URL("..", import.meta.url)),
+      env: {
+        PATH: process.env.PATH,
+        NODE_OPTIONS: "--no-experimental-webstorage",
+        ...env,
+        SUPABASE_URL: `http://127.0.0.1:${server.address().port}`,
+        NATIVE_DWG_RESAVE_POLL_MILLISECONDS: "100",
+      },
+      stdio: ["ignore", "pipe", "pipe"],
+    },
+  );
+  let stdout = "",
+    stderr = "",
+    stop = false;
+  child.stdout.on("data", (b) => {
+    stdout += b;
+    if (!stop && stdout.split('"outcome":"control_uncertain"').length === 3) {
+      stop = true;
+      child.kill("SIGTERM");
+    }
+  });
+  child.stderr.on("data", (b) => (stderr += b));
+  const exit = await new Promise((resolve, reject) => {
+    const timer = setTimeout(() => {
+      child.kill("SIGKILL");
+      reject(Error(`CLI timeout: ${stdout} ${stderr}`));
+    }, 10000);
+    child.once("error", reject);
+    child.once("exit", (code, signal) => {
+      clearTimeout(timer);
+      resolve({ code, signal });
+    });
+  });
+  assert.deepEqual(exit, { code: 0, signal: null });
+  assert.equal(stderr, "");
+  assert.deepEqual(
+    stdout
+      .trim()
+      .split("\n")
+      .map(JSON.parse)
+      .filter((v) => v.outcome)
+      .map((v) => v.outcome),
+    ["retry_scheduled", "control_uncertain", "control_uncertain"],
+  );
+  assert.equal(calls.filter((c) => c.url.startsWith("/storage/")).length, 1);
+  assert.equal(
+    calls.find((c) => c.url.startsWith("/storage/")).authorization,
+    "Bearer test-secret",
+  );
+  assert.equal(
+    calls.find((c) => c.url.endsWith("/lukas_drawing_fail_native_dwg_resave"))
+      .body.p_failure_code,
+    "resaver_failed",
+  );
+  const claims = calls.filter((c) =>
+    c.url.endsWith("/lukas_drawing_claim_native_dwg_resave"),
+  );
+  assert.ok(
+    claims[2].at - claims[1].at >= 90,
+    "immediate refusal must wait before claiming again",
+  );
+  assert.equal(
+    calls.filter(
+      (c) =>
+        c.url.includes("admit") ||
+        c.url.includes("upload") ||
+        c.url.includes("publish"),
+    ).length,
+    0,
+  );
+  assert.doesNotMatch(
+    stdout,
+    /test-secret|sha256:|leaseToken|owned\/source|receipt/,
+  );
+});
```
