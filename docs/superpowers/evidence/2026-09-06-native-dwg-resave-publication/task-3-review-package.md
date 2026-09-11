# Task3 exact-baseline review package

Three-file task scope. Existing worker compares exact pre-task public baseline; two new files compare /dev/null. No commits; HEAD9f5f56d93db325ff935772252f9d4fb64d69f98c unchanged. Never use unrelated dirty HEAD diff. Read brief/report plus full package through EOF in bounded chunks. Context10lines; inspect extra unchanged code only for a concrete named risk.

- platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts: cdcbc6eb52332e12f754e5212921bd212bf1828d4cc90f5fc6f7c4496cde606b; baseline docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-3-drawing-native-dwg-resave-worker.server.ts
- platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts: 49b42c86e4ef126cfdbf77b310c4cd5518df305bc6f3d2069ed378ae9436fb53; baseline new file
- platform/tests/drawing-native-dwg-resave-publication.test.mjs: c041877b26d961579261516fb4b4d0f3ffd4850ae2b6ba9ee07c8d28b2bd2c47; baseline new file

## platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts

```diff
diff --git a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-3-drawing-native-dwg-resave-worker.server.ts b/platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts
index 8f216fa..bb178d9 100644
--- a/docs/superpowers/evidence/2026-09-06-native-dwg-resave-publication/baseline/task-3-drawing-native-dwg-resave-worker.server.ts
+++ b/platform/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts
@@ -70,28 +70,28 @@ const Control = z.discriminatedUnion("action", [
     action: z.literal("stop"),
     reason: z.enum(["authority_revoked", "lease_expired"]),
   }).strict(),
 ]);
 const Cancellation = Identity.extend({
   status: z.literal("cancelled"),
 }).strict();
 const Failure = Identity.extend({
   status: z.enum(["retry_wait", "failed"]),
 }).strict();
-class StaleLease extends Error {}
+export class NativeDrawingDwgResaveStaleLease extends Error {}
 
 /** A separate deadline bounds even a service transport which ignores abort. */
-async function rpc(
+export async function callNativeDrawingDwgResaveAttemptRpc(
   client: NativeDrawingDwgImportRpcClient,
   name: string,
   args: Record<string, unknown>,
-) {
+): Promise<unknown> {
   const controller = new AbortController();
   let timer: ReturnType<typeof setTimeout> | undefined;
   const deadline = new Promise<never>((_, reject) => {
     timer = setTimeout(() => {
       controller.abort();
       reject(new Error("Native DWG resave control unavailable."));
     }, 5_000);
   });
   try {
     const response = await Promise.race([
@@ -100,38 +100,57 @@ async function rpc(
       ),
       deadline,
     ]);
     if (!response || controller.signal.aborted || response.error !== null) {
       if (
         response?.error &&
         typeof response.error === "object" &&
         "code" in response.error &&
         response.error.code === "PNR13"
       )
-        throw new StaleLease();
+        throw new NativeDrawingDwgResaveStaleLease();
       throw new Error("Native DWG resave control unavailable.");
     }
     return response.data;
   } finally {
     clearTimeout(timer);
   }
 }
 
 function requireIdentity(receipt: z.infer<typeof Identity>, claim: Claim) {
   if (
     receipt.jobId !== claim.jobId ||
     receipt.attemptNumber !== claim.attemptNumber ||
     receipt.leaseToken !== claim.leaseToken
   )
     throw new Error("Native DWG resave attempt identity changed.");
 }
 
+export async function readNativeDrawingDwgResaveAttemptControl(
+  client: NativeDrawingDwgImportRpcClient,
+  claim: Claim,
+): Promise<z.infer<typeof Control>> {
+  const control = Control.parse(
+    await callNativeDrawingDwgResaveAttemptRpc(
+      client,
+      "lukas_drawing_native_dwg_resave_control",
+      {
+        p_job_id: claim.jobId,
+        p_attempt_number: claim.attemptNumber,
+        p_lease_token: claim.leaseToken,
+      },
+    ),
+  );
+  requireIdentity(control, claim);
+  return control;
+}
+
 /** Snapshot before control awaits, then reuse the protocol's exact-byte verifier. */
 function snapshotResult(
   result: NativeResult,
   expected: ReturnType<typeof encodeNativeDrawingDwgResaveInput>,
 ): NativeResult {
   if (
     !(result.reportBytes instanceof Uint8Array) ||
     !(result.dwgBytes instanceof Uint8Array) ||
     result.reportBytes.byteLength < 1 ||
     result.reportBytes.byteLength > 1024 * 1024 ||
@@ -184,35 +203,35 @@ export async function runNativeDrawingDwgResaveAttempt(
     execution.abort();
   };
   const shutdown = () => stop("worker_interrupted");
   signal?.addEventListener("abort", shutdown, { once: true });
   if (signal?.aborted) shutdown();
   let pollTimer: ReturnType<typeof setTimeout> | undefined;
   let pollPending: Promise<void> | undefined;
   let polling = false;
   const check = async () => {
     try {
-      const control = Control.parse(
-        await rpc(
-          serviceClient,
-          "lukas_drawing_native_dwg_resave_control",
-          args,
-        ),
+      const control = await readNativeDrawingDwgResaveAttemptControl(
+        serviceClient,
+        claim,
       );
-      requireIdentity(control, claim);
       if (control.action === "cancel") stop("cancel");
       if (control.action === "stop")
         stop(
           control.reason === "lease_expired" ? "stale" : "authority_revoked",
         );
     } catch (error) {
-      stop(error instanceof StaleLease ? "stale" : "control_uncertain");
+      stop(
+        error instanceof NativeDrawingDwgResaveStaleLease
+          ? "stale"
+          : "control_uncertain",
+      );
     }
   };
   const schedule = () => {
     if (!polling || refusal) return;
     pollTimer = setTimeout(() => {
       pollPending = check().finally(() => {
         pollPending = undefined;
         schedule();
       });
     }, 1_000);
@@ -303,56 +322,66 @@ export async function runNativeDrawingDwgResaveAttempt(
       outcome:
         refusal === "cancel" || refusal === "control_uncertain"
           ? "control_uncertain"
           : "settlement_uncertain",
     };
   if (refusal === "stale" || refusal === "control_uncertain")
     return { outcome: refusal };
   if (refusal === "cancel") {
     try {
       const receipt = Cancellation.parse(
-        await rpc(
+        await callNativeDrawingDwgResaveAttemptRpc(
           serviceClient,
           "lukas_drawing_ack_native_dwg_resave_cancel",
           args,
         ),
       );
       requireIdentity(receipt, claim);
       return { outcome: "cancelled" };
     } catch (error) {
       return {
-        outcome: error instanceof StaleLease ? "stale" : "control_uncertain",
+        outcome:
+          error instanceof NativeDrawingDwgResaveStaleLease
+            ? "stale"
+            : "control_uncertain",
       };
     }
   }
   if (refusal === "worker_interrupted" || refusal === "authority_revoked")
     failure = refusal;
   if (failure) {
     try {
       const retryable = [
         "source_unavailable",
         "resaver_failed",
         "worker_interrupted",
       ].includes(failure);
       const receipt = Failure.parse(
-        await rpc(serviceClient, "lukas_drawing_fail_native_dwg_resave", {
-          ...args,
-          p_failure_code: failure,
-          p_retryable: retryable,
-        }),
+        await callNativeDrawingDwgResaveAttemptRpc(
+          serviceClient,
+          "lukas_drawing_fail_native_dwg_resave",
+          {
+            ...args,
+            p_failure_code: failure,
+            p_retryable: retryable,
+          },
+        ),
       );
       requireIdentity(receipt, claim);
       if (!retryable && receipt.status === "retry_wait")
         throw new Error("Invalid failure settlement.");
       return {
         outcome: receipt.status === "retry_wait" ? "retry_scheduled" : "failed",
       };
     } catch (error) {
       return {
-        outcome: error instanceof StaleLease ? "stale" : "settlement_uncertain",
+        outcome:
+          error instanceof NativeDrawingDwgResaveStaleLease
+            ? "stale"
+            : "settlement_uncertain",
       };
     }
   }
   return result
     ? { outcome: "prepared", claim, result }
     : { outcome: "control_uncertain" };
 }
```

## platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts

```diff
diff --git a/platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts b/platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts
new file mode 100644
index 0000000..c867994
--- /dev/null
+++ b/platform/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts
@@ -0,0 +1,388 @@
+import { createHash } from "node:crypto";
+
+import { z } from "zod";
+
+import type { NativeDrawingDwgImportRpcClient } from "./drawing-native-dwg-import-jobs.server.ts";
+import { parseNativeDrawingDwgResaveClaim } from "./drawing-native-dwg-resave-jobs.server.ts";
+import {
+  buildNativeDrawingDwgResaveArtifacts,
+  validateNativeDrawingDwgResaveReceipt,
+  validateNativeDrawingDwgResaveStagedArtifacts,
+} from "./drawing-native-dwg-resave-artifacts.server.ts";
+import {
+  callNativeDrawingDwgResaveAttemptRpc,
+  NativeDrawingDwgResaveStaleLease,
+  readNativeDrawingDwgResaveAttemptControl,
+  runNativeDrawingDwgResaveAttempt,
+  type NativeDrawingDwgResaveAttemptOptions,
+  type NativeDrawingDwgResaveAttemptOutcome,
+} from "./drawing-native-dwg-resave-worker.server.ts";
+import {
+  createNativeDwgResaveStorageTransport,
+  NativeDwgConfirmedUploadError,
+} from "../../../native-dwg-worker/src/supabase.ts";
+
+type Claim = ReturnType<typeof parseNativeDrawingDwgResaveClaim>;
+type Prepared = Extract<
+  NativeDrawingDwgResaveAttemptOutcome,
+  { outcome: "prepared" }
+>;
+type Storage = ReturnType<typeof createNativeDwgResaveStorageTransport>;
+type Refusal =
+  | "cancel"
+  | "authority_revoked"
+  | "stale"
+  | "control_uncertain"
+  | "worker_interrupted";
+type PublicationFailure =
+  | "output_invalid"
+  | "upload_failed"
+  | "publication_failed"
+  | "authority_revoked"
+  | "worker_interrupted";
+type NonPrepared = Exclude<
+  NativeDrawingDwgResaveAttemptOutcome,
+  { outcome: "prepared" }
+>;
+export type NativeDrawingDwgResavePublicationOutcome =
+  | NonPrepared
+  | {
+      outcome: "completed";
+      receipt: ReturnType<typeof validateNativeDrawingDwgResaveReceipt>;
+    }
+  | { outcome: "publication_uncertain" };
+
+const Identity = z
+  .object({
+    jobId: z.string().uuid(),
+    attemptNumber: z.number().int().min(1).max(3),
+    leaseToken: z.string().uuid(),
+  })
+  .strict();
+const Closed = Identity.extend({ uploadState: z.literal("closed") }).strict();
+const Cancellation = Identity.extend({
+  status: z.literal("cancelled"),
+}).strict();
+const Failure = Identity.extend({
+  status: z.enum(["retry_wait", "failed"]),
+}).strict();
+
+function identityArguments(claim: Claim) {
+  return {
+    p_job_id: claim.jobId,
+    p_attempt_number: claim.attemptNumber,
+    p_lease_token: claim.leaseToken,
+  };
+}
+
+function requireIdentity(receipt: z.infer<typeof Identity>, claim: Claim) {
+  if (
+    receipt.jobId !== claim.jobId ||
+    receipt.attemptNumber !== claim.attemptNumber ||
+    receipt.leaseToken !== claim.leaseToken
+  )
+    throw new Error("Native DWG resave attempt identity changed.");
+}
+
+async function closeUpload(
+  serviceClient: NativeDrawingDwgImportRpcClient,
+  claim: Claim,
+) {
+  try {
+    const receipt = Closed.parse(
+      await callNativeDrawingDwgResaveAttemptRpc(
+        serviceClient,
+        "lukas_drawing_close_native_dwg_resave_upload",
+        identityArguments(claim),
+      ),
+    );
+    requireIdentity(receipt, claim);
+    return true;
+  } catch {
+    return false;
+  }
+}
+
+async function settleClosedAttempt(
+  serviceClient: NativeDrawingDwgImportRpcClient,
+  claim: Claim,
+  refusal: Refusal | undefined,
+  failure: PublicationFailure | undefined,
+): Promise<NonPrepared | undefined> {
+  if (refusal === "stale" || refusal === "control_uncertain")
+    return { outcome: refusal };
+  const args = identityArguments(claim);
+  if (refusal === "cancel") {
+    try {
+      const receipt = Cancellation.parse(
+        await callNativeDrawingDwgResaveAttemptRpc(
+          serviceClient,
+          "lukas_drawing_ack_native_dwg_resave_cancel",
+          args,
+        ),
+      );
+      requireIdentity(receipt, claim);
+      return { outcome: "cancelled" };
+    } catch (error) {
+      return {
+        outcome:
+          error instanceof NativeDrawingDwgResaveStaleLease
+            ? "stale"
+            : "control_uncertain",
+      };
+    }
+  }
+  const code =
+    refusal === "worker_interrupted" || refusal === "authority_revoked"
+      ? refusal
+      : failure;
+  if (!code) return undefined;
+  const retryable = [
+    "upload_failed",
+    "publication_failed",
+    "worker_interrupted",
+  ].includes(code);
+  try {
+    const receipt = Failure.parse(
+      await callNativeDrawingDwgResaveAttemptRpc(
+        serviceClient,
+        "lukas_drawing_fail_native_dwg_resave",
+        { ...args, p_failure_code: code, p_retryable: retryable },
+      ),
+    );
+    requireIdentity(receipt, claim);
+    if (!retryable && receipt.status === "retry_wait")
+      throw new Error("Invalid failure settlement.");
+    return {
+      outcome: receipt.status === "retry_wait" ? "retry_scheduled" : "failed",
+    };
+  } catch (error) {
+    return {
+      outcome:
+        error instanceof NativeDrawingDwgResaveStaleLease
+          ? "stale"
+          : "settlement_uncertain",
+    };
+  }
+}
+
+export async function publishNativeDrawingDwgResaveArtifacts(options: {
+  prepared: Prepared;
+  serviceClient: NativeDrawingDwgImportRpcClient;
+  storage: Storage;
+  imageId: string;
+  signal?: AbortSignal;
+}): Promise<NativeDrawingDwgResavePublicationOutcome> {
+  const { prepared, serviceClient, storage, imageId, signal } = options;
+  const upload = storage.upload.bind(storage);
+  const read = storage.read.bind(storage);
+  let claim: Claim;
+  try {
+    claim = parseNativeDrawingDwgResaveClaim(prepared.claim, imageId);
+  } catch {
+    return { outcome: "control_uncertain" };
+  }
+
+  const execution = new AbortController();
+  let refusal: Refusal | undefined;
+  const stop = (reason: Refusal) => {
+    refusal ??= reason;
+    execution.abort();
+  };
+  const shutdown = () => stop("worker_interrupted");
+  signal?.addEventListener("abort", shutdown, { once: true });
+  if (signal?.aborted) shutdown();
+
+  let pollTimer: ReturnType<typeof setTimeout> | undefined;
+  let pollPending: Promise<void> | undefined;
+  let polling = false;
+  let pollingStopped = false;
+  const check = async () => {
+    try {
+      const control = await readNativeDrawingDwgResaveAttemptControl(
+        serviceClient,
+        claim,
+      );
+      if (control.action === "cancel") stop("cancel");
+      if (control.action === "stop")
+        stop(
+          control.reason === "lease_expired" ? "stale" : "authority_revoked",
+        );
+    } catch (error) {
+      stop(
+        error instanceof NativeDrawingDwgResaveStaleLease
+          ? "stale"
+          : "control_uncertain",
+      );
+    }
+  };
+  const schedule = () => {
+    if (!polling || refusal) return;
+    pollTimer = setTimeout(() => {
+      pollPending = check().finally(() => {
+        pollPending = undefined;
+        schedule();
+      });
+    }, 1_000);
+  };
+  const stopPolling = async () => {
+    if (pollingStopped) return;
+    pollingStopped = true;
+    polling = false;
+    clearTimeout(pollTimer);
+    await pollPending;
+  };
+
+  const finishClosed = async (
+    failure?: PublicationFailure,
+  ): Promise<NativeDrawingDwgResavePublicationOutcome> => {
+    await stopPolling();
+    if (!refusal) await check();
+    const settled = await settleClosedAttempt(
+      serviceClient,
+      claim,
+      refusal,
+      failure,
+    );
+    if (settled) return settled;
+    signal?.removeEventListener("abort", shutdown);
+    const args = identityArguments(claim);
+    for (let attempt = 0; attempt < 2; attempt += 1) {
+      try {
+        const receipt = validateNativeDrawingDwgResaveReceipt(
+          await callNativeDrawingDwgResaveAttemptRpc(
+            serviceClient,
+            "lukas_drawing_publish_native_dwg_resave",
+            args,
+          ),
+          claim,
+          built!.metadata,
+        );
+        return { outcome: "completed", receipt };
+      } catch (error) {
+        if (error instanceof NativeDrawingDwgResaveStaleLease)
+          return { outcome: "stale" };
+      }
+    }
+    return { outcome: "publication_uncertain" };
+  };
+
+  let built:
+    | Awaited<ReturnType<typeof buildNativeDrawingDwgResaveArtifacts>>
+    | undefined;
+  let failure: PublicationFailure | undefined;
+  try {
+    try {
+      built = await buildNativeDrawingDwgResaveArtifacts(
+        claim,
+        prepared.result,
+        imageId,
+      );
+      claim = built.claim;
+    } catch {
+      failure = "output_invalid";
+    }
+    await check();
+    if (failure || refusal) {
+      return (
+        (await settleClosedAttempt(serviceClient, claim, refusal, failure)) ?? {
+          outcome: "control_uncertain",
+        }
+      );
+    }
+
+    polling = true;
+    schedule();
+    let staged: ReturnType<
+      typeof validateNativeDrawingDwgResaveStagedArtifacts
+    >;
+    try {
+      staged = validateNativeDrawingDwgResaveStagedArtifacts(
+        await callNativeDrawingDwgResaveAttemptRpc(
+          serviceClient,
+          "lukas_drawing_stage_native_dwg_resave",
+          {
+            ...identityArguments(claim),
+            p_artifacts: built!.metadata,
+          },
+        ),
+        claim,
+        built!.metadata,
+      );
+    } catch {
+      if (!(await closeUpload(serviceClient, claim)))
+        return { outcome: "settlement_uncertain" };
+      return await finishClosed("publication_failed");
+    }
+
+    for (const artifact of staged.artifacts) {
+      if (refusal) break;
+      if (staged.uploadState === "open") {
+        try {
+          const status = await upload({
+            kind: artifact.kind,
+            path: artifact.path,
+            bytes: built!.bytesByKind[artifact.kind],
+            signal: execution.signal,
+          });
+          if (status !== "uploaded" && status !== "exists")
+            return { outcome: "settlement_uncertain" };
+        } catch (error) {
+          if (!(error instanceof NativeDwgConfirmedUploadError))
+            return { outcome: "settlement_uncertain" };
+          failure = "upload_failed";
+          break;
+        }
+        if (refusal) break;
+      }
+      try {
+        const bytes = await read({
+          kind: artifact.kind,
+          path: artifact.path,
+          signal: execution.signal,
+        });
+        if (
+          !(bytes instanceof Uint8Array) ||
+          bytes.byteLength !== artifact.byteSize ||
+          createHash("sha256").update(bytes).digest("hex") !==
+            artifact.sha256 ||
+          !Buffer.from(bytes).equals(built!.bytesByKind[artifact.kind])
+        )
+          throw new Error("Native DWG resave readback changed.");
+      } catch {
+        failure = "output_invalid";
+        break;
+      }
+    }
+
+    if (
+      staged.uploadState === "open" &&
+      !(await closeUpload(serviceClient, claim))
+    )
+      return { outcome: "settlement_uncertain" };
+    return await finishClosed(failure);
+  } finally {
+    await stopPolling();
+    signal?.removeEventListener("abort", shutdown);
+  }
+}
+
+export async function runNativeDrawingDwgResaveToStorage(
+  options: NativeDrawingDwgResaveAttemptOptions & { storage: Storage },
+): Promise<NativeDrawingDwgResavePublicationOutcome> {
+  const { storage, ...attemptOptions } = options;
+  const capturedStorage = {
+    upload: storage.upload.bind(storage),
+    read: storage.read.bind(storage),
+  };
+  const { serviceClient, imageId, signal } = attemptOptions;
+  const result = await runNativeDrawingDwgResaveAttempt(attemptOptions);
+  if (result.outcome !== "prepared") return result;
+  return publishNativeDrawingDwgResaveArtifacts({
+    prepared: result,
+    serviceClient,
+    storage: capturedStorage,
+    imageId,
+    signal,
+  });
+}
```

## platform/tests/drawing-native-dwg-resave-publication.test.mjs

```diff
diff --git a/platform/tests/drawing-native-dwg-resave-publication.test.mjs b/platform/tests/drawing-native-dwg-resave-publication.test.mjs
new file mode 100644
index 0000000..63b3679
--- /dev/null
+++ b/platform/tests/drawing-native-dwg-resave-publication.test.mjs
@@ -0,0 +1,571 @@
+import assert from "node:assert/strict";
+import { createHash } from "node:crypto";
+import { fileURLToPath } from "node:url";
+import test from "node:test";
+
+import { createServer } from "vite";
+
+import { resaveArtifactFixture } from "./fixtures/drawing-native-dwg-resave-artifacts.mjs";
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
+
+const { buildNativeDrawingDwgResaveAttestation: buildAttestation } =
+  await vite.ssrLoadModule(
+    "/app/lukas/lib/drawing-native-dwg-resave-attestation.server.ts",
+  );
+const publicationModule = await vite
+  .ssrLoadModule(
+    "/app/lukas/lib/drawing-native-dwg-resave-publication.server.ts",
+  )
+  .catch(() => ({}));
+const workerModule = await vite.ssrLoadModule(
+  "/app/lukas/lib/drawing-native-dwg-resave-worker.server.ts",
+);
+const { NativeDwgConfirmedUploadError } = await vite.ssrLoadModule(
+  "/native-dwg-worker/src/supabase.ts",
+);
+
+function api() {
+  for (const name of [
+    "publishNativeDrawingDwgResaveArtifacts",
+    "runNativeDrawingDwgResaveToStorage",
+  ])
+    assert.equal(
+      typeof publicationModule[name],
+      "function",
+      `Required publication API absent: ${name}`,
+    );
+  for (const name of [
+    "callNativeDrawingDwgResaveAttemptRpc",
+    "readNativeDrawingDwgResaveAttemptControl",
+    "NativeDrawingDwgResaveStaleLease",
+  ])
+    assert.ok(workerModule[name], `Required worker helper absent: ${name}`);
+  return publicationModule;
+}
+
+const deferred = () => Promise.withResolvers();
+const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
+const rpcNames = {
+  lukas_drawing_native_dwg_resave_control: "control",
+  lukas_drawing_stage_native_dwg_resave: "stage",
+  lukas_drawing_close_native_dwg_resave_upload: "close",
+  lukas_drawing_publish_native_dwg_resave: "publish",
+  lukas_drawing_ack_native_dwg_resave_cancel: "ack",
+  lukas_drawing_fail_native_dwg_resave: "fail",
+};
+const filenames = {
+  dwg: "resaved.dwg",
+  edit_request: "edit-request.json",
+  authority: "authority.json",
+  report: "native-report.json",
+};
+
+async function setup() {
+  const fixture = await resaveArtifactFixture(buildAttestation);
+  const bytesByKind = {
+    dwg: Buffer.from(fixture.result.dwgBytes),
+    edit_request: Buffer.from(fixture.claim.attestation.request.text, "utf8"),
+    authority: Buffer.from(fixture.claim.attestation.authority.text, "utf8"),
+    report: Buffer.from(fixture.result.reportBytes),
+  };
+  const metadata = ["dwg", "edit_request", "authority", "report"].map(
+    (kind) => ({
+      kind,
+      sha256: sha256(bytesByKind[kind]),
+      byteSize: bytesByKind[kind].byteLength,
+    }),
+  );
+  const identity = {
+    jobId: fixture.claim.jobId,
+    attemptNumber: fixture.claim.attemptNumber,
+    leaseToken: fixture.claim.leaseToken,
+  };
+  const stagedArtifacts = metadata.map((item) => ({
+    ...item,
+    path: `projects/${fixture.claim.scope.projectId}/native-dwg-resave/${fixture.claim.jobId}/${fixture.claim.attemptNumber}/${item.sha256}/${filenames[item.kind]}`,
+  }));
+  const state = {
+    stageState: "open",
+    controlCount: 0,
+    handlers: {},
+    stored: new Map(),
+  };
+  const calls = [];
+  const receipt = {
+    schemaVersion: "1hk-dwg-resave-receipt/1",
+    jobId: fixture.claim.jobId,
+    attemptNumber: fixture.claim.attemptNumber,
+    scope: fixture.claim.scope,
+    resaverImageId: fixture.imageId,
+    sourceSha256: fixture.claim.source.sha256,
+    qualification: "experimental-unqualified",
+    persistenceAuthority: "not-issued",
+    artifacts: metadata,
+    createdAt: "2026-09-06T00:00:00.000Z",
+  };
+  const defaultRpc = async (name, args) => {
+    if (name === "control") {
+      state.controlCount += 1;
+      return {
+        data: { ...identity, action: "continue", reason: null },
+        error: null,
+      };
+    }
+    if (name === "stage")
+      return {
+        data: {
+          ...identity,
+          uploadState: state.stageState,
+          artifacts: stagedArtifacts,
+        },
+        error: null,
+      };
+    if (name === "close")
+      return {
+        data: { ...identity, uploadState: "closed" },
+        error: null,
+      };
+    if (name === "publish") return { data: receipt, error: null };
+    if (name === "ack")
+      return { data: { ...identity, status: "cancelled" }, error: null };
+    assert.equal(name, "fail");
+    return {
+      data: {
+        ...identity,
+        status: args.p_retryable ? "retry_wait" : "failed",
+      },
+      error: null,
+    };
+  };
+  const serviceClient = {
+    rpc(rawName, args) {
+      const name = rpcNames[rawName];
+      assert.ok(name, `Unexpected RPC ${rawName}`);
+      return {
+        async abortSignal(signal) {
+          assert.equal(signal.aborted, false);
+          calls.push({ name, args, signal });
+          return state.handlers[name]
+            ? state.handlers[name](args, signal, state.controlCount)
+            : defaultRpc(name, args);
+        },
+      };
+    },
+  };
+  const storage = {
+    async upload(input) {
+      calls.push({ name: `upload:${input.kind}`, input });
+      if (state.handlers.upload)
+        return state.handlers.upload(input, state.stored);
+      state.stored.set(input.path, Buffer.from(input.bytes));
+      return "uploaded";
+    },
+    async read(input) {
+      calls.push({ name: `read:${input.kind}`, input });
+      if (state.handlers.read) return state.handlers.read(input, state.stored);
+      const bytes = state.stored.get(input.path);
+      assert.ok(bytes, `No stored bytes for ${input.kind}`);
+      return Buffer.from(bytes);
+    },
+  };
+  const prepared = {
+    outcome: "prepared",
+    claim: fixture.claim,
+    result: fixture.result,
+  };
+  const options = {
+    prepared,
+    serviceClient,
+    storage,
+    imageId: fixture.imageId,
+  };
+  return {
+    fixture,
+    bytesByKind,
+    metadata,
+    identity,
+    stagedArtifacts,
+    receipt,
+    state,
+    calls,
+    serviceClient,
+    storage,
+    prepared,
+    options,
+    sequence: () => calls.map(({ name }) => name),
+  };
+}
+
+test("publishes four artifacts in the literal stage/upload/read/close/control order", async () => {
+  const h = await setup();
+  const result = await api().publishNativeDrawingDwgResaveArtifacts(h.options);
+  assert.deepEqual(result, { outcome: "completed", receipt: h.receipt });
+  assert.deepEqual(h.sequence(), [
+    "control",
+    "stage",
+    "upload:dwg",
+    "read:dwg",
+    "upload:edit_request",
+    "read:edit_request",
+    "upload:authority",
+    "read:authority",
+    "upload:report",
+    "read:report",
+    "close",
+    "control",
+    "publish",
+  ]);
+  assert.deepEqual(h.calls[1].args, {
+    p_job_id: h.identity.jobId,
+    p_attempt_number: 2,
+    p_lease_token: h.identity.leaseToken,
+    p_artifacts: h.metadata,
+  });
+  for (const [index, kind] of [
+    "dwg",
+    "edit_request",
+    "authority",
+    "report",
+  ].entries()) {
+    const upload = h.calls[2 + index * 2].input;
+    assert.deepEqual(
+      {
+        kind: upload.kind,
+        path: upload.path,
+        bytes: Buffer.from(upload.bytes),
+      },
+      {
+        kind,
+        path: h.stagedArtifacts[index].path,
+        bytes: h.bytesByKind[kind],
+      },
+    );
+  }
+});
+
+test("a parent abort already in force performs no publication side effect and settles interruption", async () => {
+  const h = await setup();
+  const parent = new AbortController();
+  parent.abort();
+  const result = await api().publishNativeDrawingDwgResaveArtifacts({
+    ...h.options,
+    signal: parent.signal,
+  });
+  assert.equal(result.outcome, "retry_scheduled");
+  assert.deepEqual(h.sequence(), ["control", "fail"]);
+  assert.equal(h.calls[1].args.p_failure_code, "worker_interrupted");
+  assert.equal(h.calls[1].args.p_retryable, true);
+});
+
+test(
+  "a late cancellation waits for an abort-ignoring POST, closes, then acknowledges",
+  { timeout: 10_000 },
+  async () => {
+    const h = await setup();
+    const postStarted = deferred();
+    const postSettled = deferred();
+    const cancellationObserved = deferred();
+    const uploadAborted = deferred();
+    h.state.handlers.upload = async (input, stored) => {
+      assert.equal(input.kind, "dwg");
+      input.signal.addEventListener("abort", uploadAborted.resolve, {
+        once: true,
+      });
+      postStarted.resolve(input.signal);
+      const value = await postSettled.promise;
+      stored.set(input.path, Buffer.from(input.bytes));
+      return value;
+    };
+    h.state.handlers.control = async (_args, _signal, priorCount) => {
+      h.state.controlCount += 1;
+      if (priorCount === 1) {
+        cancellationObserved.resolve();
+        return {
+          data: {
+            ...h.identity,
+            action: "cancel",
+            reason: "cancel_requested",
+          },
+          error: null,
+        };
+      }
+      return {
+        data: { ...h.identity, action: "continue", reason: null },
+        error: null,
+      };
+    };
+    const pending = api().publishNativeDrawingDwgResaveArtifacts(h.options);
+    const uploadSignal = await postStarted.promise;
+    await cancellationObserved.promise;
+    await uploadAborted.promise;
+    assert.equal(uploadSignal.aborted, true);
+    assert.equal(h.sequence().includes("close"), false);
+    assert.equal(h.sequence().includes("ack"), false);
+    postSettled.resolve("uploaded");
+    assert.equal((await pending).outcome, "cancelled");
+    assert.deepEqual(h.sequence(), [
+      "control",
+      "stage",
+      "upload:dwg",
+      "control",
+      "close",
+      "ack",
+    ]);
+  },
+);
+
+test("snapshots prepared buffers and bound dependencies before its first await", async () => {
+  const h = await setup();
+  const expectedDwg = Buffer.from(h.prepared.result.dwgBytes);
+  const pending = api().publishNativeDrawingDwgResaveArtifacts(h.options);
+  h.prepared.result.dwgBytes.fill(0);
+  h.prepared.result.reportBytes.fill(0);
+  h.prepared.result.report.output.sha256 = "0".repeat(64);
+  h.options.imageId = `sha256:${"d".repeat(64)}`;
+  h.options.serviceClient = { rpc: assert.fail };
+  h.storage.upload = assert.fail;
+  h.storage.read = assert.fail;
+  assert.equal((await pending).outcome, "completed");
+  assert.deepEqual(
+    Buffer.from(h.calls.find((call) => call.name === "upload:dwg").input.bytes),
+    expectedDwg,
+  );
+});
+
+test("a closed stage replay performs readback without any POST", async () => {
+  const h = await setup();
+  h.state.stageState = "closed";
+  for (const artifact of h.stagedArtifacts)
+    h.state.stored.set(artifact.path, h.bytesByKind[artifact.kind]);
+  assert.equal(
+    (await api().publishNativeDrawingDwgResaveArtifacts(h.options)).outcome,
+    "completed",
+  );
+  assert.deepEqual(h.sequence(), [
+    "control",
+    "stage",
+    "read:dwg",
+    "read:edit_request",
+    "read:authority",
+    "read:report",
+    "control",
+    "publish",
+  ]);
+});
+
+test("corrupt readback closes and settles terminal output_invalid", async () => {
+  const h = await setup();
+  h.state.handlers.read = async () => Buffer.from("corrupt");
+  const result = await api().publishNativeDrawingDwgResaveArtifacts(h.options);
+  assert.equal(result.outcome, "failed");
+  assert.deepEqual(h.sequence(), [
+    "control",
+    "stage",
+    "upload:dwg",
+    "read:dwg",
+    "close",
+    "control",
+    "fail",
+  ]);
+  assert.equal(h.calls.at(-1).args.p_failure_code, "output_invalid");
+  assert.equal(h.calls.at(-1).args.p_retryable, false);
+});
+
+test("a typed definite upload rejection closes before retryable upload failure", async () => {
+  const h = await setup();
+  h.state.handlers.upload = async () => {
+    throw new NativeDwgConfirmedUploadError();
+  };
+  const result = await api().publishNativeDrawingDwgResaveArtifacts(h.options);
+  assert.equal(result.outcome, "retry_scheduled");
+  assert.deepEqual(h.sequence(), [
+    "control",
+    "stage",
+    "upload:dwg",
+    "close",
+    "control",
+    "fail",
+  ]);
+  assert.equal(h.calls.at(-1).args.p_failure_code, "upload_failed");
+  assert.equal(h.calls.at(-1).args.p_retryable, true);
+});
+
+test("an untyped upload rejection remains uncertain with no close or settlement", async () => {
+  const h = await setup();
+  h.state.handlers.upload = async () => {
+    throw new Error("unknown POST completion");
+  };
+  assert.deepEqual(
+    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
+    { outcome: "settlement_uncertain" },
+  );
+  assert.deepEqual(h.sequence(), ["control", "stage", "upload:dwg"]);
+});
+
+test("a lost stage reply attempts exact close before publication failure settlement", async () => {
+  const h = await setup();
+  h.state.handlers.stage = async () => {
+    throw new Error("reply lost after stage commit");
+  };
+  const result = await api().publishNativeDrawingDwgResaveArtifacts(h.options);
+  assert.equal(result.outcome, "retry_scheduled");
+  assert.deepEqual(h.sequence(), [
+    "control",
+    "stage",
+    "close",
+    "control",
+    "fail",
+  ]);
+  assert.equal(h.calls.at(-1).args.p_failure_code, "publication_failed");
+});
+
+test("unconfirmed closure after a lost stage reply stays settlement_uncertain", async () => {
+  const h = await setup();
+  h.state.handlers.stage = async () => {
+    throw new Error("stage reply lost");
+  };
+  h.state.handlers.close = async () => ({
+    data: null,
+    error: { code: "PNR13" },
+  });
+  assert.deepEqual(
+    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
+    { outcome: "settlement_uncertain" },
+  );
+  assert.deepEqual(h.sequence(), ["control", "stage", "close"]);
+});
+
+test("a lost close reply stays settlement_uncertain without fail, ack or publish", async () => {
+  const h = await setup();
+  h.state.handlers.close = async () => {
+    throw new Error("close reply lost");
+  };
+  assert.deepEqual(
+    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
+    { outcome: "settlement_uncertain" },
+  );
+  assert.equal(h.sequence().at(-1), "close");
+  assert.equal(h.sequence().includes("fail"), false);
+  assert.equal(h.sequence().includes("ack"), false);
+  assert.equal(h.sequence().includes("publish"), false);
+});
+
+test("a lost publish reply replays once with the exact same identity", async () => {
+  const h = await setup();
+  let publishes = 0;
+  h.state.handlers.publish = async () => {
+    if (++publishes === 1) throw new Error("publish reply lost");
+    return { data: h.receipt, error: null };
+  };
+  assert.equal(
+    (await api().publishNativeDrawingDwgResaveArtifacts(h.options)).outcome,
+    "completed",
+  );
+  const calls = h.calls.filter(({ name }) => name === "publish");
+  assert.equal(calls.length, 2);
+  assert.deepEqual(calls[0].args, calls[1].args);
+  assert.deepEqual(calls[0].args, {
+    p_job_id: h.identity.jobId,
+    p_attempt_number: 2,
+    p_lease_token: h.identity.leaseToken,
+  });
+});
+
+test("two unknown publish replies return publication_uncertain without failure admission", async () => {
+  const h = await setup();
+  h.state.handlers.publish = async () => {
+    throw new Error("publish reply lost");
+  };
+  assert.deepEqual(
+    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
+    { outcome: "publication_uncertain" },
+  );
+  assert.equal(h.calls.filter(({ name }) => name === "publish").length, 2);
+  assert.equal(h.sequence().includes("fail"), false);
+});
+
+test("final control cancellation after closure wins before publication", async () => {
+  const h = await setup();
+  h.state.handlers.control = async (_args, _signal, priorCount) => {
+    h.state.controlCount += 1;
+    return {
+      data: {
+        ...h.identity,
+        action: priorCount === 1 ? "cancel" : "continue",
+        reason: priorCount === 1 ? "cancel_requested" : null,
+      },
+      error: null,
+    };
+  };
+  assert.deepEqual(
+    await api().publishNativeDrawingDwgResaveArtifacts(h.options),
+    { outcome: "cancelled" },
+  );
+  assert.deepEqual(h.sequence().slice(-3), ["close", "control", "ack"]);
+  assert.equal(h.sequence().includes("publish"), false);
+});
+
+test("storage wrapper runs the accepted native attempt once before publication", async () => {
+  const h = await setup();
+  let nativeCalls = 0;
+  const result = await api().runNativeDrawingDwgResaveToStorage({
+    claim: h.fixture.claim,
+    serviceClient: h.serviceClient,
+    async downloadSource({ source, signal }) {
+      assert.deepEqual(source, h.fixture.claim.source);
+      assert.equal(signal.aborted, false);
+      return h.fixture.sourceBytes;
+    },
+    async resave() {
+      nativeCalls += 1;
+      return h.fixture.result;
+    },
+    dockerPath: "/owned/docker",
+    dockerHost: "unix:///owned/socket",
+    imageId: h.fixture.imageId,
+    storage: h.storage,
+  });
+  assert.equal(result.outcome, "completed");
+  assert.equal(nativeCalls, 1);
+  assert.equal(
+    h.sequence().filter((name) => name.startsWith("upload:")).length,
+    4,
+  );
+});
+
+test("nonprepared native outcome passes through and never touches Storage", async () => {
+  const h = await setup();
+  h.state.handlers.control = async () => {
+    h.state.controlCount += 1;
+    return {
+      data: {
+        ...h.identity,
+        action: "cancel",
+        reason: "cancel_requested",
+      },
+      error: null,
+    };
+  };
+  const result = await api().runNativeDrawingDwgResaveToStorage({
+    claim: h.fixture.claim,
+    serviceClient: h.serviceClient,
+    downloadSource: async () => assert.fail("must not download"),
+    resave: async () => assert.fail("must not execute native"),
+    dockerPath: "/owned/docker",
+    dockerHost: "unix:///owned/socket",
+    imageId: h.fixture.imageId,
+    storage: h.storage,
+  });
+  assert.deepEqual(result, { outcome: "cancelled" });
+  assert.deepEqual(h.sequence(), ["control", "ack"]);
+});
```
