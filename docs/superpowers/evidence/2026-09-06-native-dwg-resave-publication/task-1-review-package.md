# Task 1 exact pre-task delta

HEAD unchanged: 9f5f56d93db325ff935772252f9d4fb64d69f98c. No commits. Four new files were absent; supabase.ts compared to exact public pre-task baseline.

1cbe7ec842dfbf9404e11e12bdbfd7808d12ec968308396b55373724ff21410d  platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts
6b6b4087a7efb2cfb13eb85ea0ceb70029b1a01bd949651f96291c4fc5466d2c  platform/native-dwg-worker/src/supabase.ts
7eba51a712cdc96a745688730a93bf82e662c0884b2969ee8d124d05d0aac05f  platform/tests/fixtures/drawing-native-dwg-resave-artifacts.mjs
f7db79391ee95e6c66b93fc299492deaa6d841313febfa91873148a7f5f0e979  platform/tests/drawing-native-dwg-resave-artifacts.test.mjs
50aa056a4b4f47e1f9591d921cef9472e619af6d51bebc8a3eb7498bb1202cc3  platform/tests/drawing-native-dwg-resave-storage.test.mjs

## platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts

diff --git a/platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts b/platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts
new file mode 100644
index 0000000..002e685
--- /dev/null
+++ b/platform/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts
@@ -0,0 +1,304 @@
+import { createHash } from "node:crypto";
+import { isDeepStrictEqual } from "node:util";
+
+import { z } from "zod";
+
+import { NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-jobs.server.ts";
+import { buildNativeDrawingDwgResaveAttestation } from "./drawing-native-dwg-resave-attestation.server.ts";
+import { parseNativeDrawingDwgResaveClaim } from "./drawing-native-dwg-resave-jobs.server.ts";
+import { decodeNativeDrawingDwgResaveOutput } from "./drawing-native-dwg-resave-protocol.server.ts";
+
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
+const Uuid = z
+  .string()
+  .uuid()
+  .transform((value) => value.toLowerCase());
+const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
+const AttemptNumber = z.number().int().min(1).max(3);
+const ScopeSchema = NativeDrawingDwgScopeSchema.transform((scope) => ({
+  ...scope,
+  projectId: scope.projectId.toLowerCase(),
+  documentId: scope.documentId.toLowerCase(),
+  revisionId: scope.revisionId.toLowerCase(),
+  canvasId: scope.canvasId.toLowerCase(),
+}));
+const filenames: Record<NativeDrawingDwgResaveArtifactKind, string> = {
+  dwg: "resaved.dwg",
+  edit_request: "edit-request.json",
+  authority: "authority.json",
+  report: "native-report.json",
+};
+const artifactOrder = NativeDrawingDwgResaveArtifactKindSchema.options;
+
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
+const ManagedPath = z.string().min(1).max(1_000);
+const StagedArtifactSchema = z
+  .object({
+    kind: NativeDrawingDwgResaveArtifactKindSchema,
+    sha256: Sha256,
+    byteSize: z.number().int().positive().safe(),
+    path: ManagedPath,
+  })
+  .strict();
+const StagedSchema = z
+  .object({
+    jobId: Uuid,
+    attemptNumber: AttemptNumber,
+    leaseToken: Uuid,
+    uploadState: z.enum(["open", "closed"]),
+    artifacts: z.array(StagedArtifactSchema).length(4),
+  })
+  .strict();
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
+const ManagedPathPattern = new RegExp(
+  "^projects/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
+    "native-dwg-resave/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
+    "([1-3])/([0-9a-f]{64})/([^/]+)$",
+);
+
+export const NativeDrawingDwgResaveDescriptorSchema = z
+  .object({
+    jobId: Uuid,
+    attemptNumber: AttemptNumber,
+    kind: NativeDrawingDwgResaveArtifactKindSchema,
+    bucket: z.literal("lukas-qto"),
+    path: ManagedPath,
+    sha256: Sha256,
+    byteSize: z.number().int().positive().safe(),
+  })
+  .strict()
+  .superRefine((descriptor, context) => {
+    const metadata = ArtifactMetadataSchema.safeParse({
+      kind: descriptor.kind,
+      sha256: descriptor.sha256,
+      byteSize: descriptor.byteSize,
+    });
+    const match = ManagedPathPattern.exec(descriptor.path);
+    if (
+      !metadata.success ||
+      !match ||
+      match[2] !== descriptor.jobId ||
+      Number(match[3]) !== descriptor.attemptNumber ||
+      match[4] !== descriptor.sha256 ||
+      match[5] !== filenames[descriptor.kind]
+    )
+      context.addIssue({
+        code: z.ZodIssueCode.custom,
+        path: ["path"],
+        message: "Invalid managed native DWG resave artifact path.",
+      });
+  });
+
+type Claim = ReturnType<typeof parseNativeDrawingDwgResaveClaim>;
+export type NativeDrawingDwgResaveArtifactMetadata = z.infer<
+  typeof ArtifactMetadataSchema
+>;
+
+const ResultSchema = z
+  .object({
+    report: z.unknown(),
+    reportBytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
+    dwgBytes: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
+  })
+  .strict();
+
+function sha256(bytes: Uint8Array) {
+  return createHash("sha256").update(bytes).digest("hex");
+}
+
+function outputFrame(reportBytes: Uint8Array, dwgBytes: Uint8Array) {
+  const header = Buffer.alloc(16);
+  header.write("1HKRSO01", 0, "ascii");
+  header.writeUInt32BE(reportBytes.byteLength, 8);
+  header.writeUInt32BE(dwgBytes.byteLength, 12);
+  return Buffer.concat([header, reportBytes, dwgBytes]);
+}
+
+/** Snapshots the claim and result synchronously before rebuilding authority. */
+export async function buildNativeDrawingDwgResaveArtifacts(
+  rawClaim: unknown,
+  rawResult: unknown,
+  imageId: unknown,
+): Promise<{
+  claim: Claim;
+  bytesByKind: Record<NativeDrawingDwgResaveArtifactKind, Buffer>;
+  metadata: NativeDrawingDwgResaveArtifactMetadata[];
+}> {
+  const claim = parseNativeDrawingDwgResaveClaim(rawClaim, imageId);
+  const result = ResultSchema.parse(rawResult);
+  const report = structuredClone(result.report);
+  const reportBytes = Buffer.from(result.reportBytes);
+  const dwgBytes = Buffer.from(result.dwgBytes);
+  const rebuilt = await buildNativeDrawingDwgResaveAttestation(
+    claim.scope,
+    claim.payload,
+    imageId,
+  );
+  if (!rebuilt.request || !isDeepStrictEqual(rebuilt, claim.attestation))
+    throw new Error("Invalid native DWG resave artifact authority.");
+  const verified = decodeNativeDrawingDwgResaveOutput(
+    outputFrame(reportBytes, dwgBytes),
+    {
+      source: {
+        sha256: claim.source.sha256,
+        byteSize: claim.source.byteSize,
+        headerVersion: claim.source.headerVersion,
+      },
+      request: {
+        schemaVersion: "1hk-dwg-edits/2",
+        sha256: rebuilt.request.sha256,
+        byteSize: rebuilt.request.byteSize,
+        handles: rebuilt.request.handles,
+      },
+    },
+  );
+  if (!isDeepStrictEqual(verified.report, report))
+    throw new Error("Invalid native DWG resave report identity.");
+
+  const bytesByKind = {
+    dwg: Buffer.from(verified.dwgBytes),
+    edit_request: Buffer.from(rebuilt.request.text, "utf8"),
+    authority: Buffer.from(rebuilt.authority.text, "utf8"),
+    report: Buffer.from(verified.reportBytes),
+  };
+  const metadata = ArtifactMetadataArraySchema.parse(
+    artifactOrder.map((kind) => ({
+      kind,
+      sha256: sha256(bytesByKind[kind]),
+      byteSize: bytesByKind[kind].byteLength,
+    })),
+  );
+  return { claim, bytesByKind, metadata };
+}
+
+export function nativeDrawingDwgResaveArtifactPath(
+  rawScope: unknown,
+  rawJobId: unknown,
+  rawAttemptNumber: unknown,
+  rawMetadata: unknown,
+) {
+  const scope = ScopeSchema.parse(rawScope);
+  const jobId = Uuid.parse(rawJobId);
+  const attemptNumber = AttemptNumber.parse(rawAttemptNumber);
+  const metadata = ArtifactMetadataSchema.parse(rawMetadata);
+  return `projects/${scope.projectId}/native-dwg-resave/${jobId}/${attemptNumber}/${metadata.sha256}/${filenames[metadata.kind]}`;
+}
+
+export function validateNativeDrawingDwgResaveStagedArtifacts(
+  raw: unknown,
+  claim: Claim,
+  rawMetadata: unknown,
+) {
+  const metadata = ArtifactMetadataArraySchema.parse(rawMetadata);
+  const staged = StagedSchema.parse(raw);
+  if (
+    staged.jobId !== claim.jobId.toLowerCase() ||
+    staged.attemptNumber !== claim.attemptNumber ||
+    staged.leaseToken !== claim.leaseToken.toLowerCase()
+  )
+    throw new Error("Native DWG resave stage identity changed.");
+  for (let index = 0; index < artifactOrder.length; index += 1) {
+    const artifact = staged.artifacts[index];
+    const expected = metadata[index];
+    if (
+      !isDeepStrictEqual(
+        {
+          kind: artifact.kind,
+          sha256: artifact.sha256,
+          byteSize: artifact.byteSize,
+        },
+        expected,
+      ) ||
+      artifact.path !==
+        nativeDrawingDwgResaveArtifactPath(
+          claim.scope,
+          claim.jobId,
+          claim.attemptNumber,
+          expected,
+        )
+    )
+      throw new Error("Native DWG resave stage artifacts changed.");
+  }
+  return staged;
+}
+
+export function validateNativeDrawingDwgResaveReceipt(
+  raw: unknown,
+  claim: Claim,
+  rawMetadata: unknown,
+) {
+  const metadata = ArtifactMetadataArraySchema.parse(rawMetadata);
+  const receipt = NativeDrawingDwgResaveReceiptSchema.parse(raw);
+  const scope = ScopeSchema.parse(claim.scope);
+  if (
+    receipt.jobId !== claim.jobId.toLowerCase() ||
+    receipt.attemptNumber !== claim.attemptNumber ||
+    !isDeepStrictEqual(receipt.scope, scope) ||
+    receipt.resaverImageId !== claim.attestation.resaverImageId ||
+    receipt.sourceSha256 !== claim.source.sha256 ||
+    !isDeepStrictEqual(receipt.artifacts, metadata)
+  )
+    throw new Error("Native DWG resave receipt identity changed.");
+  return receipt;
+}

## platform/native-dwg-worker/src/supabase.ts

diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-1-supabase.ts b/platform/native-dwg-worker/src/supabase.ts
index 0df604b..391fc81 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-1-supabase.ts
+++ b/platform/native-dwg-worker/src/supabase.ts
@@ -1,12 +1,13 @@
+import { createHash } from "node:crypto";
 import { isAbsolute } from "node:path";
 
 import type { SupabaseClient } from "@supabase/supabase-js";
 import { z } from "zod";
 
 import {
   NATIVE_DWG_WORKER_LIMITS,
   runNativeDrawingDwgWriter,
   type NativeDwgWorkerDependencies,
 } from "../../app/lukas/lib/drawing-native-dwg-worker.server.ts";
 
 const Uuid = z.string().uuid();
@@ -14,24 +15,25 @@ const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
 const PositiveSafeInteger = z.number().int().positive().safe();
 const ScopeSchema = z
   .object({
     projectId: Uuid,
     documentId: Uuid,
     revisionId: Uuid,
     revisionVersion: PositiveSafeInteger,
     canvasId: Uuid,
     snapshotSha256: Sha256,
   })
   .strict();
 const KindSchema = z.enum(["dwg", "source_manifest", "authority", "report"]);
+const ResaveKindSchema = z.enum(["dwg", "edit_request", "authority", "report"]);
 const ArtifactSchema = z
   .object({ kind: KindSchema, sha256: Sha256, byteSize: PositiveSafeInteger })
   .strict();
 const StagedArtifactSchema = ArtifactSchema.extend({
   path: z
     .string()
     .min(1)
     .max(1_000)
     .refine(
       (value) =>
         !value.startsWith("/") &&
         !value.includes("//") &&
@@ -86,44 +88,68 @@ const ConfigSchema = z
       .number()
       .int()
       .min(30)
       .max(NATIVE_DWG_WORKER_LIMITS.leaseSeconds),
   })
   .strict();
 const artifactLimits = {
   dwg: NATIVE_DWG_WORKER_LIMITS.dwgBytes,
   source_manifest: NATIVE_DWG_WORKER_LIMITS.sourceManifestBytes,
   authority: NATIVE_DWG_WORKER_LIMITS.authorityBytes,
   report: NATIVE_DWG_WORKER_LIMITS.reportBytes,
 } as const;
+const resaveArtifactLimits = {
+  dwg: 209715200,
+  edit_request: 2097152,
+  authority: 67108864,
+  report: 1048576,
+} as const;
+const resaveFilenames = {
+  dwg: "resaved.dwg",
+  edit_request: "edit-request.json",
+  authority: "authority.json",
+  report: "native-report.json",
+} as const;
+const ResavePathPattern = new RegExp(
+  "^projects/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
+    "native-dwg-resave/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
+    "([1-3])/([0-9a-f]{64})/([^/]+)$",
+);
 
 type WorkerClient = Pick<SupabaseClient<any>, "rpc">;
 type AdapterRuntime = {
   convert?: typeof runNativeDrawingDwgWriter;
   fetch?: typeof fetch;
   artifactLimits?: Partial<Record<z.infer<typeof KindSchema>, number>>;
 };
 
 type RpcResult = { data: unknown; error: unknown };
 type RpcBuilder = {
   abortSignal(signal: AbortSignal): PromiseLike<RpcResult>;
 };
 
 export class NativeDwgUncertainUploadError extends Error {
   constructor() {
     super("Native DWG upload completion is uncertain.");
     this.name = "NativeDwgUncertainUploadError";
   }
 }
 
+export class NativeDwgConfirmedUploadError extends Error {
+  constructor() {
+    super("Native DWG upload was definitely rejected before any write.");
+    this.name = "NativeDwgConfirmedUploadError";
+  }
+}
+
 function rpcData(result: { data: unknown; error: unknown }, message: string) {
   if (result.error) throw new Error(message);
   return result.data;
 }
 
 function ensureActive(signal: AbortSignal) {
   if (signal.aborted) throw new Error("Native DWG worker operation aborted.");
 }
 
 function rpcWithSignal(
   client: WorkerClient,
   name: string,
@@ -131,35 +157,33 @@ function rpcWithSignal(
   signal: AbortSignal,
 ) {
   const builder = client.rpc(
     name as never,
     arguments_ as never,
   ) as unknown as RpcBuilder;
   if (!builder || typeof builder.abortSignal !== "function")
     throw new Error("Native DWG RPC transport is invalid.");
   return builder.abortSignal(signal);
 }
 
 function configuredArtifactLimits(
-  override: AdapterRuntime["artifactLimits"] = {},
+  kinds: readonly string[],
+  maximums: Record<string, number>,
+  override: Record<string, number> = {},
 ) {
-  const result = { ...artifactLimits };
-  for (const kind of KindSchema.options) {
+  const result = { ...maximums };
+  for (const kind of kinds) {
     const value = override[kind];
     if (value !== undefined) {
-      if (
-        !Number.isSafeInteger(value) ||
-        value < 1 ||
-        value > artifactLimits[kind]
-      )
+      if (!Number.isSafeInteger(value) || value < 1 || value > maximums[kind])
         throw new Error("Native DWG Storage limits are invalid.");
       result[kind] = value;
     }
   }
   return result;
 }
 
 function scopedStorageSignal(parent: AbortSignal) {
   const controller = new AbortController();
   const abort = () => controller.abort();
   if (parent.aborted) controller.abort();
   else parent.addEventListener("abort", abort, { once: true });
@@ -212,104 +236,165 @@ async function readBoundedBody(
     offset += chunk.byteLength;
   }
   return bytes;
 }
 
 function storageObjectUrl(baseUrl: string, path: string) {
   return `${baseUrl}/storage/v1/object/lukas-qto/${path
     .split("/")
     .map(encodeURIComponent)
     .join("/")}`;
 }
 
-export function createNativeDwgStorageTransport(
+type StorageProfile =
+  | {
+      imported: false;
+      kinds: typeof KindSchema.options;
+      limits: typeof artifactLimits;
+    }
+  | {
+      imported: true;
+      kinds: typeof ResaveKindSchema.options;
+      limits: typeof resaveArtifactLimits;
+    };
+
+function parseStorageInput(
+  profile: StorageProfile,
+  input: { kind: unknown; path: unknown; bytes?: Uint8Array },
+  limits: Record<string, number>,
+) {
+  const kind = (profile.imported ? ResaveKindSchema : KindSchema).parse(
+    input.kind,
+  ) as keyof typeof limits & string;
+  const path = StagedArtifactSchema.shape.path.parse(input.path);
+  if (profile.imported) {
+    const match = ResavePathPattern.exec(path);
+    if (
+      !match ||
+      match[5] !== resaveFilenames[kind as keyof typeof resaveFilenames] ||
+      (input.bytes &&
+        createHash("sha256").update(input.bytes).digest("hex") !== match[4])
+    )
+      throw new Error("invalid upload path");
+  }
+  if (input.bytes) {
+    const minimum = profile.imported && kind === "dwg" ? 6 : 1;
+    if (
+      input.bytes.byteLength < minimum ||
+      input.bytes.byteLength > limits[kind]
+    )
+      throw new Error("invalid upload size");
+  }
+  return { kind, path };
+}
+
+function createStorageTransport(
   rawConfig: { supabaseUrl: string; serviceRoleKey: string },
-  runtime: Pick<AdapterRuntime, "fetch" | "artifactLimits"> = {},
+  runtime: { fetch?: typeof fetch; artifactLimits?: Record<string, number> },
+  profile: StorageProfile,
 ) {
   const config = ConfigSchema.pick({
     supabaseUrl: true,
     serviceRoleKey: true,
   }).parse(rawConfig);
   const request = runtime.fetch ?? fetch;
-  const limits = configuredArtifactLimits(runtime.artifactLimits);
+  const limits = configuredArtifactLimits(
+    profile.kinds,
+    profile.limits,
+    runtime.artifactLimits,
+  );
   const headers = {
     apikey: config.serviceRoleKey,
     authorization: `Bearer ${config.serviceRoleKey}`,
   };
   return {
     async upload(input: {
-      kind: z.infer<typeof KindSchema>;
+      kind: string;
       path: string;
       bytes: Uint8Array;
       signal: AbortSignal;
     }): Promise<"uploaded" | "exists"> {
       const scoped = scopedStorageSignal(input.signal);
       try {
-        const kind = KindSchema.parse(input.kind);
-        const path = StagedArtifactSchema.shape.path.parse(input.path);
-        if (input.bytes.byteLength < 1 || input.bytes.byteLength > limits[kind])
-          throw new Error("invalid upload size");
-        let response: Response;
-        let responseBytes: Uint8Array;
+        let parsed: ReturnType<typeof parseStorageInput>;
+        let body: Buffer;
         try {
-          response = await request(storageObjectUrl(config.supabaseUrl, path), {
+          parsed = parseStorageInput(profile, input, limits);
+          body = Buffer.from(input.bytes);
+          if (profile.imported && scoped.signal.aborted)
+            throw new Error("aborted before upload");
+        } catch (error) {
+          if (profile.imported) throw new NativeDwgConfirmedUploadError();
+          throw error;
+        }
+        let pending: Promise<Response>;
+        try {
+          pending = request(storageObjectUrl(config.supabaseUrl, parsed.path), {
             method: "POST",
             headers: {
               ...headers,
               "cache-control": "max-age=0",
               "content-type":
-                kind === "dwg"
+                parsed.kind === "dwg"
                   ? "application/octet-stream"
                   : "application/json",
               "x-upsert": "false",
             },
-            body: Buffer.from(input.bytes),
+            body: body as unknown as BodyInit,
             signal: scoped.signal,
           });
+        } catch {
+          if (profile.imported) throw new NativeDwgConfirmedUploadError();
+          throw new NativeDwgUncertainUploadError();
+        }
+        let response: Response;
+        let responseBytes: Uint8Array;
+        try {
+          response = await pending;
           responseBytes = await readBoundedBody(
             response,
             NATIVE_DWG_WORKER_LIMITS.processOutputBytes,
           );
         } catch {
           throw new NativeDwgUncertainUploadError();
         }
         if (response.ok) return "uploaded";
         let errorCode: unknown;
         try {
           const error = JSON.parse(
             Buffer.from(responseBytes).toString("utf8"),
           ) as Record<string, unknown>;
           errorCode = error.code ?? error.error;
         } catch {
           errorCode = undefined;
         }
         if (
           (response.status === 400 || response.status === 409) &&
           (errorCode === "Duplicate" || errorCode === "ResourceAlreadyExists")
         )
           return "exists";
+        if (profile.imported) throw new NativeDwgConfirmedUploadError();
         throw new Error("Native DWG upload failed.");
       } finally {
         scoped.dispose();
       }
     },
     async read(input: {
-      kind: z.infer<typeof KindSchema>;
+      kind: string;
       path: string;
       signal: AbortSignal;
     }): Promise<Uint8Array> {
       const scoped = scopedStorageSignal(input.signal);
       try {
-        const kind = KindSchema.parse(input.kind);
-        const path = StagedArtifactSchema.shape.path.parse(input.path);
+        const { kind, path } = parseStorageInput(profile, input, limits);
         const response = await request(
           storageObjectUrl(config.supabaseUrl, path),
           {
             method: "GET",
             headers,
             signal: scoped.signal,
           },
         );
         const bytes = await readBoundedBody(
           response,
           response.ok
             ? limits[kind]
@@ -318,24 +403,73 @@ export function createNativeDwgStorageTransport(
         if (!response.ok || bytes.byteLength < 1)
           throw new Error("read rejected");
         return bytes;
       } catch {
         throw new Error("Native DWG readback failed.");
       } finally {
         scoped.dispose();
       }
     },
   };
 }
 
+export function createNativeDwgStorageTransport(
+  rawConfig: { supabaseUrl: string; serviceRoleKey: string },
+  runtime: Pick<AdapterRuntime, "fetch" | "artifactLimits"> = {},
+) {
+  return createStorageTransport(rawConfig, runtime, {
+    imported: false,
+    kinds: KindSchema.options,
+    limits: artifactLimits,
+  }) as {
+    upload(input: {
+      kind: z.infer<typeof KindSchema>;
+      path: string;
+      bytes: Uint8Array;
+      signal: AbortSignal;
+    }): Promise<"uploaded" | "exists">;
+    read(input: {
+      kind: z.infer<typeof KindSchema>;
+      path: string;
+      signal: AbortSignal;
+    }): Promise<Uint8Array>;
+  };
+}
+
+export function createNativeDwgResaveStorageTransport(
+  rawConfig: { supabaseUrl: string; serviceRoleKey: string },
+  runtime: {
+    fetch?: typeof fetch;
+    artifactLimits?: Partial<Record<z.infer<typeof ResaveKindSchema>, number>>;
+  } = {},
+) {
+  return createStorageTransport(rawConfig, runtime, {
+    imported: true,
+    kinds: ResaveKindSchema.options,
+    limits: resaveArtifactLimits,
+  }) as {
+    upload(input: {
+      kind: z.infer<typeof ResaveKindSchema>;
+      path: string;
+      bytes: Uint8Array;
+      signal: AbortSignal;
+    }): Promise<"uploaded" | "exists">;
+    read(input: {
+      kind: z.infer<typeof ResaveKindSchema>;
+      path: string;
+      signal: AbortSignal;
+    }): Promise<Uint8Array>;
+  };
+}
+
 export function createSupabaseNativeDwgWorkerDependencies(
   client: WorkerClient,
   rawConfig: {
     supabaseUrl: string;
     serviceRoleKey: string;
     dotnetPath: string;
     publishedDirectory: string;
     writerBuildSha256: string;
     leaseSeconds: number;
   },
   runtime: AdapterRuntime = {},
 ): NativeDwgWorkerDependencies {

## platform/tests/fixtures/drawing-native-dwg-resave-artifacts.mjs

diff --git a/platform/tests/fixtures/drawing-native-dwg-resave-artifacts.mjs b/platform/tests/fixtures/drawing-native-dwg-resave-artifacts.mjs
new file mode 100644
index 0000000..6b7decb
--- /dev/null
+++ b/platform/tests/fixtures/drawing-native-dwg-resave-artifacts.mjs
@@ -0,0 +1,93 @@
+import { createHash } from "node:crypto";
+
+import {
+  fixture as sourceFixture,
+  uuid,
+} from "./drawing-native-dwg-resave-source.mjs";
+
+const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
+
+// This finite literal frame exercises the production protocol and attestation
+// compilers. It is deliberately not evidence of an actual native resave.
+export async function resaveArtifactFixture(buildAttestation) {
+  const fixture = sourceFixture();
+  const sourceBytes = Buffer.from("AC1024artifact-finite-source");
+  Object.assign(fixture.report.source, {
+    sha256: sha256(sourceBytes),
+    byteSize: sourceBytes.byteLength,
+  });
+  const analysis = fixture.payload.analysis;
+  Object.assign(analysis.result.receipt.source, fixture.report.source);
+  analysis.scope.sourceSha256 = fixture.report.source.sha256;
+  analysis.result.reportText = JSON.stringify(fixture.report);
+  analysis.result.receipt.reportSha256 = sha256(analysis.result.reportText);
+  analysis.result.receipt.reportByteSize = Buffer.byteLength(
+    analysis.result.reportText,
+  );
+  Object.assign(fixture.canonical.sources[0], {
+    sourceSha256: fixture.report.source.sha256,
+    reportSha256: analysis.result.receipt.reportSha256,
+  });
+  fixture.canonical.objects[0].geometry.end = { x: 55, y: 65 };
+  fixture.rehash();
+
+  const imageId = `sha256:${"c".repeat(64)}`;
+  const attestation = await buildAttestation(
+    fixture.scope,
+    fixture.payload,
+    imageId,
+  );
+  const claim = {
+    jobId: uuid(90),
+    attemptNumber: 2,
+    leaseToken: uuid(91),
+    leaseExpiresAt: "2099-01-01T00:00:00.000Z",
+    actorId: uuid(80),
+    scope: fixture.scope,
+    source: {
+      ...analysis.result.receipt.source,
+      bucket: "lukas-qto",
+      path: "owned/source.dwg",
+    },
+    attestation,
+    payload: fixture.payload,
+  };
+  const dwgBytes = Buffer.from("AC1024artifact-finite-output");
+  const report = {
+    schemaVersion: "1hk-dwg-resave/1",
+    qualification: "experimental-unqualified",
+    persistenceAuthority: "not-issued",
+    source: { ...fixture.report.source },
+    request: {
+      schemaVersion: "1hk-dwg-edits/2",
+      sha256: attestation.request.sha256,
+      byteSize: attestation.request.byteSize,
+      handles: [...attestation.request.handles],
+    },
+    output: {
+      sha256: sha256(dwgBytes),
+      byteSize: dwgBytes.byteLength,
+      headerVersion: "AC1024",
+    },
+    engine: { name: "ACadSharp", version: "3.7.1" },
+    verification: {
+      noEditRoundTrip: "passed",
+      selectedEditRoundTrip: "passed",
+      geometryTolerance: 1e-9,
+      inventoriedEntityCount: 1,
+      editedEntityCount: 1,
+      inventoryCoverage: "supported-fields-only",
+      independentCad: "not-performed",
+    },
+  };
+  return {
+    claim,
+    result: {
+      report,
+      reportBytes: Buffer.from(JSON.stringify(report)),
+      dwgBytes,
+    },
+    imageId,
+    sourceBytes,
+  };
+}

## platform/tests/drawing-native-dwg-resave-artifacts.test.mjs

diff --git a/platform/tests/drawing-native-dwg-resave-artifacts.test.mjs b/platform/tests/drawing-native-dwg-resave-artifacts.test.mjs
new file mode 100644
index 0000000..4e4ae0a
--- /dev/null
+++ b/platform/tests/drawing-native-dwg-resave-artifacts.test.mjs
@@ -0,0 +1,253 @@
+import assert from "node:assert/strict";
+import { createHash } from "node:crypto";
+import { fileURLToPath } from "node:url";
+import test from "node:test";
+import { createServer } from "vite";
+
+import { resaveArtifactFixture } from "./fixtures/drawing-native-dwg-resave-artifacts.mjs";
+import { uuid } from "./fixtures/drawing-native-dwg-resave-source.mjs";
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
+const { buildNativeDrawingDwgResaveAttestation: buildAttestation } =
+  await vite.ssrLoadModule(
+    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
+  );
+const artifactsModule = await vite
+  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-artifacts.server.ts")
+  .catch(() => ({}));
+
+function api() {
+  for (const name of [
+    "NATIVE_DWG_RESAVE_ARTIFACT_LIMITS",
+    "NativeDrawingDwgResaveArtifactKindSchema",
+    "NativeDrawingDwgResaveReceiptSchema",
+    "NativeDrawingDwgResaveDescriptorSchema",
+    "buildNativeDrawingDwgResaveArtifacts",
+    "nativeDrawingDwgResaveArtifactPath",
+    "validateNativeDrawingDwgResaveStagedArtifacts",
+    "validateNativeDrawingDwgResaveReceipt",
+  ])
+    assert.ok(artifactsModule[name], `Required artifact API absent: ${name}`);
+  return artifactsModule;
+}
+const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
+const cloneResult = (result) => ({
+  report: structuredClone(result.report),
+  reportBytes: Buffer.from(result.reportBytes),
+  dwgBytes: Buffer.from(result.dwgBytes),
+});
+
+test("builds the four exact ordered artifacts through the production verifier", async () => {
+  const f = await resaveArtifactFixture(buildAttestation);
+  const { buildNativeDrawingDwgResaveArtifacts: build } = api();
+  const artifacts = await build(f.claim, f.result, f.imageId);
+  assert.deepEqual(
+    artifacts.metadata.map(({ kind }) => kind),
+    ["dwg", "edit_request", "authority", "report"],
+  );
+  assert.equal(
+    artifacts.bytesByKind.edit_request.toString("utf8"),
+    f.claim.attestation.request.text,
+  );
+  assert.equal(
+    artifacts.bytesByKind.authority.toString("utf8"),
+    f.claim.attestation.authority.text,
+  );
+  assert.deepEqual(artifacts.bytesByKind.report, f.result.reportBytes);
+  assert.equal(artifacts.metadata[0].sha256, sha256(f.result.dwgBytes));
+  assert.equal(artifacts.metadata[0].byteSize, f.result.dwgBytes.byteLength);
+  assert.deepEqual(artifacts.claim, f.claim);
+});
+
+test("snapshots caller claim and native buffers before the attestation await", async () => {
+  const f = await resaveArtifactFixture(buildAttestation);
+  const { buildNativeDrawingDwgResaveArtifacts: build } = api();
+  const expectedClaim = structuredClone(f.claim);
+  const expectedDwg = Buffer.from(f.result.dwgBytes);
+  const expectedReport = Buffer.from(f.result.reportBytes);
+  const pending = build(f.claim, f.result, f.imageId);
+  f.claim.payload.approved.approvalDecision = "superseded";
+  f.claim.attestation.request.handles[0] = "3A";
+  f.result.dwgBytes.fill(0);
+  f.result.reportBytes.fill(0);
+  const artifacts = await pending;
+  assert.deepEqual(artifacts.claim, expectedClaim);
+  assert.deepEqual(artifacts.bytesByKind.dwg, expectedDwg);
+  assert.deepEqual(artifacts.bytesByKind.report, expectedReport);
+});
+
+test("rejects unpinned, changed-attestation, no-op and extra claim/result inputs", async () => {
+  const f = await resaveArtifactFixture(buildAttestation);
+  const { buildNativeDrawingDwgResaveArtifacts: build } = api();
+  await assert.rejects(build(f.claim, f.result, `sha256:${"d".repeat(64)}`));
+  const changedPayload = structuredClone(f.claim);
+  changedPayload.payload.analysis.result.reportText += " ";
+  await assert.rejects(build(changedPayload, f.result, f.imageId));
+  const noOp = structuredClone(f.claim);
+  noOp.attestation.request = null;
+  await assert.rejects(build(noOp, f.result, f.imageId));
+  await assert.rejects(build({ ...f.claim, extra: true }, f.result, f.imageId));
+  await assert.rejects(build(f.claim, { ...f.result, extra: true }, f.imageId));
+});
+
+test("rejects report object/bytes disagreement and source/request/output mismatches", async () => {
+  const f = await resaveArtifactFixture(buildAttestation);
+  const { buildNativeDrawingDwgResaveArtifacts: build } = api();
+  const changes = [
+    (result) => (result.report.verification.inventoriedEntityCount = 2),
+    (result) => (result.report.source.sha256 = "0".repeat(64)),
+    (result) => (result.report.request.sha256 = "0".repeat(64)),
+    (result) => (result.report.output.sha256 = "0".repeat(64)),
+    (result) => (result.dwgBytes = Buffer.from("short")),
+    (result) => {
+      result.dwgBytes = Buffer.from("XXXXXXwrong-header");
+      Object.assign(result.report.output, {
+        sha256: sha256(result.dwgBytes),
+        byteSize: result.dwgBytes.byteLength,
+      });
+      result.reportBytes = Buffer.from(JSON.stringify(result.report));
+    },
+  ];
+  for (const change of changes) {
+    const result = cloneResult(f.result);
+    change(result);
+    await assert.rejects(build(f.claim, result, f.imageId));
+  }
+});
+
+test("validates exact staged replay, immutable paths and a closed response", async () => {
+  const f = await resaveArtifactFixture(buildAttestation);
+  const {
+    buildNativeDrawingDwgResaveArtifacts: build,
+    nativeDrawingDwgResaveArtifactPath: artifactPath,
+    validateNativeDrawingDwgResaveStagedArtifacts: validate,
+  } = api();
+  const built = await build(f.claim, f.result, f.imageId);
+  const staged = {
+    jobId: f.claim.jobId,
+    attemptNumber: f.claim.attemptNumber,
+    leaseToken: f.claim.leaseToken,
+    uploadState: "open",
+    artifacts: built.metadata.map((metadata) => ({
+      ...metadata,
+      path: artifactPath(
+        f.claim.scope,
+        f.claim.jobId,
+        f.claim.attemptNumber,
+        metadata,
+      ),
+    })),
+  };
+  assert.deepEqual(validate(staged, built.claim, built.metadata), staged);
+  assert.equal(
+    validate({ ...staged, uploadState: "closed" }, built.claim, built.metadata)
+      .uploadState,
+    "closed",
+  );
+  const mutations = [
+    (value) => value.artifacts.reverse(),
+    (value) => (value.artifacts[1] = value.artifacts[0]),
+    (value) => value.artifacts.pop(),
+    (value) => (value.jobId = uuid(92)),
+    (value) => (value.attemptNumber = 1),
+    (value) => (value.leaseToken = uuid(93)),
+    (value) => (value.artifacts[0].sha256 = "0".repeat(64)),
+    (value) => (value.artifacts[0].path += "-other"),
+    (value) =>
+      (value.artifacts[0].path = value.artifacts[0].path.replace(
+        f.claim.scope.projectId,
+        uuid(94),
+      )),
+    (value) => (value.extra = true),
+  ];
+  for (const mutate of mutations) {
+    const changed = structuredClone(staged);
+    mutate(changed);
+    assert.throws(() => validate(changed, built.claim, built.metadata));
+  }
+});
+
+test("validates the exact public receipt and self-consistent descriptor", async () => {
+  const f = await resaveArtifactFixture(buildAttestation);
+  const {
+    buildNativeDrawingDwgResaveArtifacts: build,
+    nativeDrawingDwgResaveArtifactPath: artifactPath,
+    validateNativeDrawingDwgResaveReceipt: validate,
+    NativeDrawingDwgResaveDescriptorSchema: descriptorSchema,
+  } = api();
+  const built = await build(f.claim, f.result, f.imageId);
+  const receipt = {
+    schemaVersion: "1hk-dwg-resave-receipt/1",
+    jobId: f.claim.jobId,
+    attemptNumber: f.claim.attemptNumber,
+    scope: f.claim.scope,
+    resaverImageId: f.imageId,
+    sourceSha256: f.claim.source.sha256,
+    qualification: "experimental-unqualified",
+    persistenceAuthority: "not-issued",
+    artifacts: built.metadata,
+    createdAt: "2026-09-06T00:00:00.000Z",
+  };
+  assert.deepEqual(validate(receipt, built.claim, built.metadata), receipt);
+  for (const change of [
+    { authority: f.claim.attestation.authority.text },
+    { leaseToken: f.claim.leaseToken },
+    { sourceSha256: "0".repeat(64) },
+    { artifacts: built.metadata.toReversed() },
+  ])
+    assert.throws(() =>
+      validate({ ...receipt, ...change }, built.claim, built.metadata),
+    );
+
+  const metadata = built.metadata[0];
+  const descriptor = {
+    jobId: f.claim.jobId,
+    attemptNumber: f.claim.attemptNumber,
+    kind: metadata.kind,
+    bucket: "lukas-qto",
+    path: artifactPath(
+      f.claim.scope,
+      f.claim.jobId,
+      f.claim.attemptNumber,
+      metadata,
+    ),
+    sha256: metadata.sha256,
+    byteSize: metadata.byteSize,
+  };
+  assert.deepEqual(descriptorSchema.parse(descriptor), descriptor);
+  assert.throws(() =>
+    descriptorSchema.parse({
+      ...descriptor,
+      path: descriptor.path.replace("resaved.dwg", "native-report.json"),
+    }),
+  );
+});
+
+test("publishes fixed safe artifact limits and strict kinds", () => {
+  const {
+    NATIVE_DWG_RESAVE_ARTIFACT_LIMITS: limits,
+    NativeDrawingDwgResaveArtifactKindSchema: kindSchema,
+  } = api();
+  assert.deepEqual(limits, {
+    dwg: 209715200,
+    edit_request: 2097152,
+    authority: 67108864,
+    report: 1048576,
+  });
+  assert.deepEqual(kindSchema.options, [
+    "dwg",
+    "edit_request",
+    "authority",
+    "report",
+  ]);
+  assert.throws(() => kindSchema.parse("source_manifest"));
+});

## platform/tests/drawing-native-dwg-resave-storage.test.mjs

diff --git a/platform/tests/drawing-native-dwg-resave-storage.test.mjs b/platform/tests/drawing-native-dwg-resave-storage.test.mjs
new file mode 100644
index 0000000..e1d290b
--- /dev/null
+++ b/platform/tests/drawing-native-dwg-resave-storage.test.mjs
@@ -0,0 +1,314 @@
+import assert from "node:assert/strict";
+import { createHash } from "node:crypto";
+import { createServer } from "node:http";
+import test from "node:test";
+
+const storageModule = await import("../native-dwg-worker/src/supabase.ts");
+function api() {
+  for (const name of [
+    "createNativeDwgResaveStorageTransport",
+    "NativeDwgConfirmedUploadError",
+    "NativeDwgUncertainUploadError",
+  ])
+    assert.ok(storageModule[name], `Required Storage API absent: ${name}`);
+  return storageModule;
+}
+const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
+const projectId = "94000000-0000-4000-8900-000000000001";
+const jobId = "94000000-0000-4000-8900-000000000002";
+const filenames = {
+  dwg: "resaved.dwg",
+  edit_request: "edit-request.json",
+  authority: "authority.json",
+  report: "native-report.json",
+};
+const pathFor = (kind, bytes) =>
+  `projects/${projectId}/native-dwg-resave/${jobId}/2/${sha256(bytes)}/${filenames[kind]}`;
+const signal = () => new AbortController().signal;
+
+test("imported Storage uploads immutable copied bytes without upsert and reads full chunked bytes", async () => {
+  const { createNativeDwgResaveStorageTransport: createTransport } = api();
+  const sockets = new Set();
+  const received = [];
+  const stored = new Map();
+  const server = createServer(async (request, response) => {
+    if (request.method === "POST") {
+      const chunks = [];
+      for await (const chunk of request) chunks.push(chunk);
+      const bytes = Buffer.concat(chunks);
+      received.push({ headers: request.headers, bytes });
+      stored.set(request.url, bytes);
+      response.writeHead(200, { "content-type": "application/json" });
+      response.write("{");
+      return setImmediate(() => response.end("}"));
+    }
+    const bytes = stored.get(request.url);
+    assert.ok(bytes);
+    response.writeHead(200, { "content-type": "application/octet-stream" });
+    response.write(bytes.subarray(0, 3));
+    setImmediate(() => response.end(bytes.subarray(3)));
+  });
+  server.on("connection", (socket) => {
+    sockets.add(socket);
+    socket.on("close", () => sockets.delete(socket));
+  });
+  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
+  const address = server.address();
+  assert.notEqual(address, null);
+  try {
+    const transport = createTransport(
+      {
+        supabaseUrl: `http://127.0.0.1:${address.port}`,
+        serviceRoleKey: "service-secret",
+      },
+      {
+        artifactLimits: {
+          dwg: 64,
+          edit_request: 64,
+          authority: 64,
+          report: 64,
+        },
+      },
+    );
+    const supplied = Buffer.from("AC1024immutable-upload");
+    const expected = Buffer.from(supplied);
+    const path = pathFor("dwg", supplied);
+    const pending = transport.upload({
+      kind: "dwg",
+      path,
+      bytes: supplied,
+      signal: signal(),
+    });
+    supplied.fill(0);
+    assert.equal(await pending, "uploaded");
+    assert.equal(received[0].headers["x-upsert"], "false");
+    assert.equal(
+      received[0].headers["content-type"],
+      "application/octet-stream",
+    );
+    assert.equal(received[0].headers.apikey, "service-secret");
+    assert.deepEqual(received[0].bytes, expected);
+    assert.deepEqual(
+      Buffer.from(
+        await transport.read({ kind: "dwg", path, signal: signal() }),
+      ),
+      expected,
+    );
+  } finally {
+    for (const socket of sockets) socket.destroy();
+    await new Promise((resolve) => server.close(resolve));
+  }
+});
+
+test("classifies duplicate, definite refusal, disconnect and response-body uncertainty", async () => {
+  const {
+    createNativeDwgResaveStorageTransport: createTransport,
+    NativeDwgConfirmedUploadError,
+    NativeDwgUncertainUploadError,
+  } = api();
+  let mode = "duplicate";
+  const sockets = new Set();
+  const server = createServer(async (request, response) => {
+    for await (const _chunk of request) void _chunk;
+    if (mode === "disconnect") return request.socket.destroy();
+    if (mode === "body-failure") {
+      response.writeHead(200, { "content-type": "application/json" });
+      response.write("{");
+      return response.socket.destroy();
+    }
+    if (mode === "oversized-body") {
+      response.writeHead(200, { "content-type": "application/json" });
+      return response.end(Buffer.alloc(65537));
+    }
+    const status = mode === "duplicate" ? 409 : 503;
+    response.writeHead(status, { "content-type": "application/json" });
+    response.write(
+      mode === "duplicate" ? '{"code":"Dupli' : '{"code":"Other",',
+    );
+    setImmediate(() =>
+      response.end(mode === "duplicate" ? 'cate"}' : '"message":"no"}'),
+    );
+  });
+  server.on("connection", (socket) => {
+    sockets.add(socket);
+    socket.on("close", () => sockets.delete(socket));
+  });
+  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
+  const address = server.address();
+  assert.notEqual(address, null);
+  const bytes = Buffer.from("{}");
+  const input = {
+    kind: "report",
+    path: pathFor("report", bytes),
+    bytes,
+    signal: signal(),
+  };
+  try {
+    const transport = createTransport({
+      supabaseUrl: `http://127.0.0.1:${address.port}`,
+      serviceRoleKey: "service-secret",
+    });
+    assert.equal(await transport.upload(input), "exists");
+    mode = "refusal";
+    await assert.rejects(
+      transport.upload(input),
+      NativeDwgConfirmedUploadError,
+    );
+    for (const uncertainMode of [
+      "disconnect",
+      "body-failure",
+      "oversized-body",
+    ]) {
+      mode = uncertainMode;
+      await assert.rejects(
+        transport.upload(input),
+        NativeDwgUncertainUploadError,
+      );
+    }
+  } finally {
+    for (const socket of sockets) socket.destroy();
+    await new Promise((resolve) => server.close(resolve));
+  }
+});
+
+test("distinguishes definite pre-send throws from rejected POST promises", async () => {
+  const {
+    createNativeDwgResaveStorageTransport: createTransport,
+    NativeDwgConfirmedUploadError,
+    NativeDwgUncertainUploadError,
+  } = api();
+  const bytes = Buffer.from("{}");
+  const input = {
+    kind: "report",
+    path: pathFor("report", bytes),
+    bytes,
+    signal: signal(),
+  };
+  const config = {
+    supabaseUrl: "https://storage.test",
+    serviceRoleKey: "secret",
+  };
+  const beforeSend = createTransport(config, {
+    fetch() {
+      throw new Error("not sent");
+    },
+  });
+  await assert.rejects(beforeSend.upload(input), NativeDwgConfirmedUploadError);
+  const unknown = createTransport(config, {
+    fetch() {
+      return Promise.reject(new Error("unknown"));
+    },
+  });
+  await assert.rejects(unknown.upload(input), NativeDwgUncertainUploadError);
+});
+
+test("enforces imported profile paths, hashes, kinds and lowered per-kind caps", async () => {
+  const {
+    createNativeDwgResaveStorageTransport: createTransport,
+    createNativeDwgStorageTransport: createLegacy,
+    NativeDwgConfirmedUploadError,
+  } = api();
+  const bytes = Buffer.from("{}");
+  let fetchCalls = 0;
+  const runtime = {
+    artifactLimits: { dwg: 8, edit_request: 2, authority: 2, report: 2 },
+    fetch() {
+      fetchCalls++;
+      return Promise.resolve(new Response("{}"));
+    },
+  };
+  const transport = createTransport(
+    { supabaseUrl: "https://storage.test", serviceRoleKey: "secret" },
+    runtime,
+  );
+  for (const input of [
+    { kind: "source_manifest", path: pathFor("report", bytes), bytes },
+    {
+      kind: "report",
+      path: `projects/${projectId}/native-dwg/${jobId}/2/${sha256(bytes)}/native-report.json`,
+      bytes,
+    },
+    { kind: "report", path: pathFor("authority", bytes), bytes },
+    { kind: "report", path: pathFor("report", Buffer.from("other")), bytes },
+    {
+      kind: "report",
+      path: pathFor("report", bytes),
+      bytes: Buffer.from("123"),
+    },
+  ])
+    await assert.rejects(
+      transport.upload({ ...input, signal: signal() }),
+      NativeDwgConfirmedUploadError,
+    );
+  assert.equal(fetchCalls, 0);
+  assert.throws(() =>
+    createTransport(
+      { supabaseUrl: "https://storage.test", serviceRoleKey: "secret" },
+      { artifactLimits: { report: 1048577 } },
+    ),
+  );
+  const legacy = createLegacy(
+    { supabaseUrl: "https://storage.test", serviceRoleKey: "secret" },
+    { fetch: runtime.fetch, artifactLimits: { report: 2 } },
+  );
+  assert.equal(
+    await legacy.upload({
+      kind: "report",
+      path: "legacy/arbitrary-safe-path",
+      bytes,
+      signal: signal(),
+    }),
+    "uploaded",
+  );
+  await assert.rejects(
+    legacy.upload({
+      kind: "edit_request",
+      path: pathFor("edit_request", bytes),
+      bytes,
+      signal: signal(),
+    }),
+  );
+});
+
+test("bounds imported read streams at the lowered cap", async () => {
+  const { createNativeDwgResaveStorageTransport: createTransport } = api();
+  const sockets = new Set();
+  let oversizedClosed = false;
+  const server = createServer((_request, response) => {
+    response.writeHead(200, { "content-type": "application/octet-stream" });
+    response.on("close", () => {
+      oversizedClosed = true;
+    });
+    response.write(Buffer.alloc(9));
+  });
+  server.on("connection", (socket) => {
+    sockets.add(socket);
+    socket.on("close", () => sockets.delete(socket));
+  });
+  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
+  const address = server.address();
+  assert.notEqual(address, null);
+  const bytes = Buffer.from("AC1024xx");
+  try {
+    const transport = createTransport(
+      {
+        supabaseUrl: `http://127.0.0.1:${address.port}`,
+        serviceRoleKey: "service-secret",
+      },
+      { artifactLimits: { dwg: 8 } },
+    );
+    await assert.rejects(
+      transport.read({
+        kind: "dwg",
+        path: pathFor("dwg", bytes),
+        signal: signal(),
+      }),
+      /readback failed/,
+    );
+    await new Promise((resolve) => setTimeout(resolve, 50));
+    assert.equal(oversizedClosed, true);
+  } finally {
+    for (const socket of sockets) socket.destroy();
+    await new Promise((resolve) => server.close(resolve));
+  }
+});
