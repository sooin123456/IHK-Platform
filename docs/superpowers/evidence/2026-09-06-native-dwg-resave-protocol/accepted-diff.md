# accepted-unit exact dirty-baseline review

Base HEAD 9f5f56d93db325ff935772252f9d4fb64d69f98c; no commits/staging. Base capture baseline.


## platform/app/lukas/lib/drawing-native-dwg-resave-protocol.server.ts

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/app/lukas/lib/drawing-native-dwg-resave-protocol.server.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/app/lukas/lib/drawing-native-dwg-resave-protocol.server.ts
new file mode 100644
index 0000000..befebff
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/app/lukas/lib/drawing-native-dwg-resave-protocol.server.ts
@@ -0,0 +1,185 @@
+import { createHash } from "node:crypto";
+import { isDeepStrictEqual } from "node:util";
+
+import { z } from "zod";
+
+import { NativeDrawingDwgSourceSchema } from "./drawing-native-dwg-import.server.ts";
+
+const REQUEST_BYTES = 2 * 1024 * 1024;
+const REPORT_BYTES = 1024 * 1024;
+const DWG_BYTES = 200 * 1024 * 1024;
+const Source = NativeDrawingDwgSourceSchema.extend({
+  byteSize: z.number().int().min(6).max(DWG_BYTES),
+}).strict();
+const Handle = z.string().regex(/^[1-9A-F][0-9A-F]{0,15}$/);
+const Handles = z
+  .array(Handle)
+  .min(1)
+  .max(10_000)
+  .refine((handles) => new Set(handles).size === handles.length);
+const RequestIdentity = z
+  .object({
+    schemaVersion: z.literal("1hk-dwg-edits/2"),
+    sha256: Source.shape.sha256,
+    byteSize: z.number().int().min(1).max(REQUEST_BYTES),
+    handles: Handles,
+  })
+  .strict();
+
+export const NativeDrawingDwgResaveReportSchema = z
+  .object({
+    schemaVersion: z.literal("1hk-dwg-resave/1"),
+    qualification: z.literal("experimental-unqualified"),
+    persistenceAuthority: z.literal("not-issued"),
+    source: Source,
+    request: RequestIdentity,
+    output: Source,
+    engine: z
+      .object({ name: z.literal("ACadSharp"), version: z.literal("3.7.1") })
+      .strict(),
+    verification: z
+      .object({
+        noEditRoundTrip: z.literal("passed"),
+        selectedEditRoundTrip: z.literal("passed"),
+        geometryTolerance: z.literal(1e-9),
+        inventoriedEntityCount: z.number().int().min(1).max(10_000),
+        editedEntityCount: z.number().int().min(1).max(10_000),
+        inventoryCoverage: z.literal("supported-fields-only"),
+        independentCad: z.literal("not-performed"),
+      })
+      .strict(),
+  })
+  .strict()
+  .refine(
+    (report) =>
+      report.source.headerVersion === report.output.headerVersion &&
+      report.verification.editedEntityCount === report.request.handles.length &&
+      report.verification.editedEntityCount <=
+        report.verification.inventoriedEntityCount,
+  );
+
+// Only host metadata is interpreted here. Exact bytes go to the native v2
+// validator, which enforces duplicate keys, eligible targets and full geometry.
+const RequestMetadata = z
+  .object({
+    schemaVersion: z.literal("1hk-dwg-edits/2"),
+    sourceSha256: Source.shape.sha256,
+    coordinateSystem: z.literal("WCS_NATIVE_UNITS"),
+    edits: z
+      .array(
+        z
+          .object({
+            handle: Handle,
+            type: z.enum(["LINE", "LWPOLYLINE", "CIRCLE", "ARC", "TEXT"]),
+          })
+          .passthrough(),
+      )
+      .min(1)
+      .max(10_000),
+  })
+  .strict();
+
+function requireCondition(condition: unknown): asserts condition {
+  if (!condition) throw new Error("Invalid native DWG resave protocol.");
+}
+function sha256(bytes: Uint8Array) {
+  return createHash("sha256").update(bytes).digest("hex");
+}
+function json(bytes: Uint8Array): unknown {
+  // ignoreBOM preserves the BOM, causing JSON.parse to reject it.
+  return JSON.parse(
+    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes),
+  );
+}
+
+/** Validates and snapshots synchronously, with no source/request concatenation. */
+export function encodeNativeDrawingDwgResaveInput(input: {
+  sourceBytes: Uint8Array;
+  expectedSource: unknown;
+  requestBytes: Uint8Array;
+  expectedRequestSha256: string;
+}) {
+  const source = Object.freeze(Source.parse(input.expectedSource));
+  const expectedRequestSha256 = Source.shape.sha256.parse(
+    input.expectedRequestSha256,
+  );
+  requireCondition(
+    input.sourceBytes instanceof Uint8Array &&
+      input.requestBytes instanceof Uint8Array,
+  );
+  requireCondition(
+    input.sourceBytes.byteLength === source.byteSize &&
+      input.requestBytes.byteLength >= 1 &&
+      input.requestBytes.byteLength <= REQUEST_BYTES,
+  );
+  const sourceSnapshot = Buffer.from(input.sourceBytes);
+  const requestSnapshot = Buffer.from(input.requestBytes);
+  requireCondition(
+    sha256(sourceSnapshot) === source.sha256 &&
+      sourceSnapshot
+        .subarray(0, 6)
+        .equals(Buffer.from(source.headerVersion, "ascii")),
+  );
+  requireCondition(sha256(requestSnapshot) === expectedRequestSha256);
+  const metadata = RequestMetadata.parse(json(requestSnapshot));
+  requireCondition(metadata.sourceSha256 === source.sha256);
+  const request = RequestIdentity.parse({
+    schemaVersion: metadata.schemaVersion,
+    sha256: expectedRequestSha256,
+    byteSize: requestSnapshot.length,
+    handles: metadata.edits.map((edit) => edit.handle),
+  });
+  Object.freeze(request.handles);
+  Object.freeze(request);
+  const header = Buffer.alloc(16);
+  header.write("1HKRSV01", 0, "ascii");
+  header.writeUInt32BE(requestSnapshot.length, 8);
+  header.writeUInt32BE(sourceSnapshot.length, 12);
+  return { chunks: [header, requestSnapshot, sourceSnapshot], source, request };
+}
+
+/** Exact EOF, independent output identity and strict unqualified report. */
+export function decodeNativeDrawingDwgResaveOutput(
+  bytes: Uint8Array,
+  expected: {
+    source: z.infer<typeof Source>;
+    request: z.infer<typeof RequestIdentity>;
+  },
+) {
+  requireCondition(
+    bytes instanceof Uint8Array &&
+      bytes.byteLength >= 16 &&
+      bytes.byteLength <= 16 + REPORT_BYTES + DWG_BYTES,
+  );
+  const frame = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
+  requireCondition(
+    frame.subarray(0, 8).equals(Buffer.from("1HKRSO01", "ascii")),
+  );
+  const reportLength = frame.readUInt32BE(8);
+  const dwgLength = frame.readUInt32BE(12);
+  requireCondition(
+    reportLength >= 1 &&
+      reportLength <= REPORT_BYTES &&
+      dwgLength >= 6 &&
+      dwgLength <= DWG_BYTES &&
+      frame.length === 16 + reportLength + dwgLength,
+  );
+  const reportBytes = frame.subarray(16, 16 + reportLength);
+  const dwgBytes = frame.subarray(16 + reportLength);
+  const report = NativeDrawingDwgResaveReportSchema.parse(json(reportBytes));
+  requireCondition(
+    isDeepStrictEqual(report.source, Source.parse(expected.source)) &&
+      isDeepStrictEqual(
+        report.request,
+        RequestIdentity.parse(expected.request),
+      ),
+  );
+  requireCondition(
+    report.output.byteSize === dwgLength &&
+      report.output.sha256 === sha256(dwgBytes) &&
+      dwgBytes
+        .subarray(0, 6)
+        .equals(Buffer.from(report.output.headerVersion, "ascii")),
+  );
+  return { report, reportBytes, dwgBytes };
+}

```

## platform/app/lukas/lib/drawing-native-dwg-sandbox.server.ts

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/platform/app/lukas/lib/drawing-native-dwg-sandbox.server.ts b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/app/lukas/lib/drawing-native-dwg-sandbox.server.ts
index 469ae62..5cc2ae4 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/platform/app/lukas/lib/drawing-native-dwg-sandbox.server.ts
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/app/lukas/lib/drawing-native-dwg-sandbox.server.ts
@@ -5,198 +5,241 @@ import {
   access,
   lstat,
   mkdtemp,
   realpath,
   rmdir,
   stat,
 } from "node:fs/promises";
 import { tmpdir } from "node:os";
 import { isAbsolute, join, normalize } from "node:path";
 import { Readable } from "node:stream";
 import { pipeline } from "node:stream/promises";
 
 import { z } from "zod";
 
 import {
   NativeDrawingDwgImportReportSchema,
   NativeDrawingDwgSourceSchema,
   type NativeDrawingDwgImportReport,
 } from "./drawing-native-dwg-import.server.ts";
 
+import {
+  encodeNativeDrawingDwgResaveInput,
+  decodeNativeDrawingDwgResaveOutput,
+} from "./drawing-native-dwg-resave-protocol.server.ts";
+
 const FAILURE = "Isolated native DWG read failed.";
+const PROFILES = {
+  reader: {
+    failure: FAILURE,
+    prefix: "1hk-dwg-read-",
+    attemptLabel: "org.1hk.native-dwg-reader.attempt",
+    protocolLabel: "org.1hk.native-dwg-reader.protocol",
+    protocol: "1hk-dwg-import/1",
+    command: "read-native-stdio",
+    memory: 1_073_741_824,
+    outputBytes: 32 * 1024 * 1024,
+  },
+  resaver: {
+    failure: "Isolated native DWG resave failed.",
+    prefix: "1hk-dwg-resave-",
+    attemptLabel: "org.1hk.native-dwg-resaver.attempt",
+    protocolLabel: "org.1hk.native-dwg-resaver.protocol",
+    protocol: "1hk-dwg-resave/1",
+    command: "resave-native-stdio",
+    memory: 2_147_483_648,
+    outputBytes: 16 + 201 * 1024 * 1024,
+  },
+} as const;
+type Profile = keyof typeof PROFILES;
+type ResaveResult = ReturnType<typeof decodeNativeDrawingDwgResaveOutput>;
 const METADATA_BYTES = 64 * 1024;
-const REPORT_BYTES = 32 * 1024 * 1024;
-const ATTEMPT_LABEL = "org.1hk.native-dwg-reader.attempt";
-const PROTOCOL_LABEL = "org.1hk.native-dwg-reader.protocol";
 const ImageId = z.string().regex(/^sha256:[0-9a-f]{64}$/);
 const ContainerId = z.string().regex(/^[0-9a-f]{64}$/);
 const PolicyInput = z
   .object({
     imageId: ImageId,
     nonce: z.string().regex(/^[0-9a-f]{32}$/),
     timeoutMilliseconds: z.number().int().min(1).max(120_000),
   })
   .strict();
 
-/** The sole production command policy; no caller command, mounts or environment. */
-export function nativeDwgSandboxCreateArguments(input: {
-  imageId: string;
-  nonce: string;
-  timeoutMilliseconds: number;
-}): string[] {
+/** Closed internal command catalog; callers cannot supply commands or resources. */
+function createArguments(
+  kind: Profile,
+  input: {
+    imageId: string;
+    nonce: string;
+    timeoutMilliseconds: number;
+  },
+): string[] {
   try {
     const { imageId, nonce, timeoutMilliseconds } = PolicyInput.parse(input);
+    const profile = PROFILES[kind];
     return [
       "create",
       "--pull",
       "never",
       "--name",
-      `1hk-dwg-read-${nonce}`,
+      `${profile.prefix}${nonce}`,
       "--label",
-      `${ATTEMPT_LABEL}=${nonce}`,
+      `${profile.attemptLabel}=${nonce}`,
       "--network",
       "none",
       "--read-only",
       "--user",
       "65532:65532",
       "--cap-drop",
       "ALL",
       "--security-opt",
       "no-new-privileges=true",
       "--cpus",
       "1",
       "--memory",
-      "1073741824",
+      String(profile.memory),
       "--memory-swap",
-      "1073741824",
+      String(profile.memory),
       "--pids-limit",
       "64",
       "--cgroupns",
       "private",
       "--ipc",
       "private",
       "--ulimit",
       "core=0:0",
       "--tmpfs",
       "/tmp:rw,noexec,nosuid,nodev,size=16777216",
       "--log-driver",
       "none",
       "--restart",
       "no",
       "--init",
       "--interactive",
       "--entrypoint",
       "/usr/bin/timeout",
       imageId,
       "--signal=KILL",
       `${Math.ceil(timeoutMilliseconds / 1000)}s`,
       "/usr/share/dotnet/dotnet",
       "/app/DwgEngineQualification.dll",
-      "read-native-stdio",
+      profile.command,
     ];
   } catch {
-    throw new Error(FAILURE);
+    throw new Error(PROFILES[kind].failure);
   }
 }
 
+export function nativeDwgSandboxCreateArguments(
+  input: z.infer<typeof PolicyInput>,
+): string[] {
+  return createArguments("reader", input);
+}
+
+export function nativeDwgResaveSandboxCreateArguments(
+  input: z.infer<typeof PolicyInput>,
+): string[] {
+  return createArguments("resaver", input);
+}
+
 function requireCondition(condition: unknown): asserts condition {
   if (!condition) throw new Error(FAILURE);
 }
 
 function sha256(bytes: Uint8Array) {
   return createHash("sha256").update(bytes).digest("hex");
 }
 
 function exact(actual: unknown, expected: unknown) {
   return JSON.stringify(actual) === JSON.stringify(expected);
 }
 
 function boundedSignal(milliseconds: number, parent?: AbortSignal) {
   const controller = new AbortController();
   const abort = () => controller.abort();
   const timer = setTimeout(abort, Math.max(0, milliseconds));
   if (parent?.aborted) abort();
   else parent?.addEventListener("abort", abort, { once: true });
   return {
     signal: controller.signal,
     dispose() {
       clearTimeout(timer);
       parent?.removeEventListener("abort", abort);
     },
   };
 }
 
 /** Kill the CLI on overflow/abort; a separate owned-container cleanup follows. */
 async function docker(
   executable: string,
   host: string,
   configDirectory: string,
   args: string[],
   signal: AbortSignal,
-  source?: Buffer,
+  inputChunks: Buffer[] = [],
+  outputBudget = METADATA_BYTES,
 ): Promise<Buffer> {
   requireCondition(!signal.aborted);
   return new Promise<Buffer>((resolve, reject) => {
     const child = spawn(
       executable,
       ["--config", configDirectory, "--host", host, ...args],
       {
         env: {
           LANG: "C",
           LC_ALL: "C",
           PATH: "/usr/bin:/bin",
         },
         stdio: ["pipe", "pipe", "pipe"],
         shell: false,
       },
     );
     const chunks: Buffer[] = [];
     let stdoutBytes = 0;
     let stderrBytes = 0;
     let failed = false;
     const dispose = () => signal.removeEventListener("abort", fail);
     const fail = () => {
       if (failed) return;
       failed = true;
       child.kill("SIGKILL");
       child.stdin.destroy();
       child.stdout.destroy();
       child.stderr.destroy();
       dispose();
       reject(new Error(FAILURE));
     };
     signal.addEventListener("abort", fail, { once: true });
     if (signal.aborted) fail();
     child.once("error", fail);
     child.stdout.on("error", fail);
     child.stderr.on("error", fail);
     child.stdout.on("data", (chunk: Buffer) => {
       stdoutBytes += chunk.length;
-      if (stdoutBytes > (source ? REPORT_BYTES : METADATA_BYTES)) fail();
+      if (stdoutBytes > outputBudget) fail();
       else if (!failed) chunks.push(chunk);
     });
     child.stderr.on("data", (chunk: Buffer) => {
       stderrBytes += chunk.length;
       if (stderrBytes > METADATA_BYTES) fail();
     });
     // pipeline supplies backpressure without making a second source copy.
-    const sent = pipeline(Readable.from(source ? [source] : []), child.stdin);
+    const sent = pipeline(Readable.from(inputChunks), child.stdin);
     sent.catch(fail);
     child.once("close", (code, terminationSignal) => {
       dispose();
       if (failed) return;
       if (
         code !== 0 ||
         terminationSignal ||
         signal.aborted ||
         stderrBytes !== 0
       ) {
         fail();
         return;
       }
       void sent.then(() => {
         if (!failed) resolve(Buffer.concat(chunks, stdoutBytes));
       }, fail);
     });
   });
 }
 
@@ -236,42 +279,42 @@ const ContainerReceipt = z.object({
     User: z.literal("65532:65532"),
     Tty: z.literal(false),
     OpenStdin: z.literal(true),
     AttachStdin: z.literal(true),
     AttachStdout: z.literal(true),
     AttachStderr: z.literal(true),
     Env: z.array(z.string()),
     Volumes: EmptyCollection,
     ExposedPorts: EmptyCollection,
     Entrypoint: z.array(z.string()),
     Cmd: z.array(z.string()),
   }),
   HostConfig: z.object({
     NetworkMode: z.literal("none"),
     ReadonlyRootfs: z.literal(true),
     Privileged: z.literal(false),
     CapAdd: EmptyCollection,
     CapDrop: z.tuple([z.literal("ALL")]),
     SecurityOpt: z.tuple([z.literal("no-new-privileges=true")]),
     NanoCpus: z.literal(1_000_000_000),
-    Memory: z.literal(1_073_741_824),
-    MemorySwap: z.literal(1_073_741_824),
+    Memory: z.number().int(),
+    MemorySwap: z.number().int(),
     PidsLimit: z.literal(64),
     CgroupnsMode: z.literal("private"),
     PidMode: z.literal(""),
     IpcMode: z.literal("private"),
     ShmSize: z.literal(67_108_864),
     UTSMode: z.literal(""),
     UsernsMode: z.literal(""),
     Binds: EmptyCollection,
     Mounts: EmptyCollection,
     Devices: EmptyCollection,
     DeviceRequests: EmptyCollection,
     DeviceCgroupRules: EmptyCollection,
     VolumesFrom: EmptyCollection,
     PortBindings: EmptyCollection,
     PublishAllPorts: z.literal(false),
     ExtraHosts: EmptyCollection,
     Links: EmptyCollection,
     RestartPolicy: z.object({
       Name: z.literal("no"),
       MaximumRetryCount: z.literal(0),
@@ -289,193 +332,249 @@ const ContainerReceipt = z.object({
         Soft: z.literal(0),
       }),
     ]),
   }),
   Mounts: z.array(z.unknown()).length(0),
   NetworkSettings: z.object({
     Networks: z.object({ none: z.object({}) }).strict(),
   }),
   State: z.object({
     Status: z.string(),
     Running: z.literal(false),
     Paused: z.literal(false),
     Restarting: z.literal(false),
     Dead: z.literal(false),
     OOMKilled: z.literal(false),
     ExitCode: z.literal(0),
     Error: z.literal(""),
   }),
 });
 
-/** One ephemeral Linux parser; successful return carries no persistence authority. */
-export async function runIsolatedNativeDrawingDwgReader(input: {
+type SandboxInput = {
   dockerPath: string;
   dockerHost: string;
   imageId: string;
   sourceBytes: Uint8Array;
   expectedSource: unknown;
   signal?: AbortSignal;
   timeoutMilliseconds?: number;
-}): Promise<NativeDrawingDwgImportReport> {
+};
+
+type ResaverInput = SandboxInput & {
+  requestBytes: Uint8Array;
+  expectedRequestSha256: string;
+};
+
+/** One ephemeral Linux parser; successful return carries no persistence authority. */
+export async function runIsolatedNativeDrawingDwgReader(
+  input: SandboxInput,
+): Promise<NativeDrawingDwgImportReport> {
+  return (await runIsolated("reader", input)) as NativeDrawingDwgImportReport;
+}
+
+export async function runIsolatedNativeDrawingDwgResaver(
+  input: ResaverInput,
+): Promise<ResaveResult> {
+  return (await runIsolated("resaver", input)) as ResaveResult;
+}
+
+async function runIsolated(
+  kind: Profile,
+  input: SandboxInput | ResaverInput,
+): Promise<NativeDrawingDwgImportReport | ResaveResult> {
+  const profile = PROFILES[kind];
   const started = performance.now();
   try {
     const { dockerHost, dockerPath, sourceBytes, signal } = input;
     const timeoutMilliseconds = input.timeoutMilliseconds ?? 120_000;
     const imageId = ImageId.parse(input.imageId);
     requireCondition(
       Number.isInteger(timeoutMilliseconds) &&
         timeoutMilliseconds >= 1 &&
         timeoutMilliseconds <= 120_000,
     );
     requireCondition(!signal?.aborted && sourceBytes instanceof Uint8Array);
-    const expected = NativeDrawingDwgSourceSchema.parse(input.expectedSource);
+    const requestBytes =
+      kind === "resaver" ? (input as ResaverInput).requestBytes : undefined;
+    const encoded =
+      kind === "resaver"
+        ? encodeNativeDrawingDwgResaveInput(input as ResaverInput)
+        : undefined;
+    const expected =
+      encoded?.source ??
+      NativeDrawingDwgSourceSchema.parse(input.expectedSource);
     requireCondition(sourceBytes.byteLength === expected.byteSize);
     // Copy before the first await; hashing a caller-owned view after awaits is unsafe.
-    const snapshot = Buffer.from(sourceBytes);
+    const snapshot = encoded?.chunks[2] ?? Buffer.from(sourceBytes);
+    const unchanged = () =>
+      sourceBytes.byteLength === expected.byteSize &&
+      sha256(sourceBytes) === expected.sha256 &&
+      (!encoded ||
+        (requestBytes instanceof Uint8Array &&
+          requestBytes.byteLength === encoded.request.byteSize &&
+          sha256(requestBytes) === encoded.request.sha256));
     requireCondition(
       sha256(snapshot) === expected.sha256 &&
         snapshot
           .subarray(0, 6)
           .equals(Buffer.from(expected.headerVersion, "ascii")),
     );
     requireCondition(
       typeof dockerHost === "string" &&
         /^unix:\/\/\/[^\0\r\n?#%]+$/.test(dockerHost),
     );
     const socket = dockerHost.slice("unix://".length);
     requireCondition(
       isAbsolute(socket) &&
         normalize(socket) === socket &&
         !socket.startsWith("//"),
     );
     requireCondition(isAbsolute(dockerPath));
     const scope = boundedSignal(
       timeoutMilliseconds - (performance.now() - started),
       signal,
     );
     let configDirectory: string | undefined;
     let configIdentity: { dev: bigint; ino: bigint } | undefined;
-    let report: NativeDrawingDwgImportReport | undefined;
+    let report: NativeDrawingDwgImportReport | ResaveResult | undefined;
     let cleanupScope: ReturnType<typeof boundedSignal> | undefined;
     const cleanupSignal = () => (cleanupScope ??= boundedSignal(10_000)).signal;
     try {
       const executable = await realpath(dockerPath);
       requireCondition(
         isAbsolute(executable) && (await stat(executable)).isFile(),
       );
       await access(executable, constants.X_OK);
       requireCondition((await stat(socket)).isSocket());
       // Docker falls back to passwd home config even without HOME. This empty
       // private directory prevents client auth, proxy and custom-header loading.
       configDirectory = await mkdtemp(
         join(await realpath(tmpdir()), "1hk-dwg-cli-"),
       );
       configIdentity = await lstat(configDirectory, { bigint: true });
       requireCondition((await realpath(configDirectory)) === configDirectory);
       const config = configDirectory;
-      const call = (args: string[], signal = scope.signal, source?: Buffer) =>
-        docker(executable, dockerHost, config, args, signal, source);
+      const call = (
+        args: string[],
+        signal = scope.signal,
+        chunks?: Buffer[],
+        outputBudget = METADATA_BYTES,
+      ) =>
+        docker(
+          executable,
+          dockerHost,
+          config,
+          args,
+          signal,
+          chunks,
+          outputBudget,
+        );
       const capabilities = z
         .object({
           OSType: z.literal("linux"),
           MemoryLimit: z.literal(true),
           SwapLimit: z.literal(true),
           CpuCfsPeriod: z.literal(true),
           CpuCfsQuota: z.literal(true),
           PidsLimit: z.literal(true),
           SecurityOptions: z.array(z.string()),
         })
         .parse(json(await call(["info", "--format", "{{json .}}"])));
       requireCondition(
         capabilities.SecurityOptions.includes("name=seccomp,profile=builtin"),
       );
       const image = z
         .tuple([ImageReceipt])
         .parse(json(await call(["image", "inspect", imageId])))[0];
       requireCondition(
         image.Id === imageId &&
-          image.Config.Labels[PROTOCOL_LABEL] === "1hk-dwg-import/1",
+          image.Config.Labels[profile.protocolLabel] === profile.protocol,
       );
       requireCondition(image.Config.Env.includes("DOTNET_EnableDiagnostics=0"));
       const nonce = randomBytes(16).toString("hex");
-      const name = `1hk-dwg-read-${nonce}`;
-      const argv = nativeDwgSandboxCreateArguments({
+      const name = `${profile.prefix}${nonce}`;
+      const argv = createArguments(kind, {
         imageId,
         nonce,
         timeoutMilliseconds,
       });
       const command = argv.slice(argv.indexOf(imageId) + 1);
       let id: string | undefined;
       let createAttempted = false;
       const inspect = async (target: string, signal = scope.signal) => {
         const receipt = z
           .tuple([z.unknown()])
           .parse(json(await call(["container", "inspect", target], signal)))[0];
         const owner = OwnershipReceipt.parse(receipt);
         requireCondition(
           owner.Name === `/${name}` &&
             owner.Image === imageId &&
-            owner.Config.Labels[ATTEMPT_LABEL] === nonce &&
+            owner.Config.Labels[profile.attemptLabel] === nonce &&
             (!id || owner.Id === id),
         );
         return { receipt, id: owner.Id };
       };
       try {
         requireCondition(!scope.signal.aborted);
         createAttempted = true;
         const createOutput = await call(argv);
         id = ContainerId.parse(
           new TextDecoder("utf-8", { fatal: true }).decode(createOutput).trim(),
         );
         const validateProfile = (
           receipt: unknown,
           status: "created" | "exited",
         ) => {
           const container = ContainerReceipt.parse(receipt);
           requireCondition(
             container.Config.Image === imageId &&
-              container.State.Status === status,
+              container.State.Status === status &&
+              container.HostConfig.Memory === profile.memory &&
+              container.HostConfig.MemorySwap === profile.memory,
           );
           requireCondition(exact(container.Config.Env, image.Config.Env));
           requireCondition(
             exact(container.Config.Entrypoint, ["/usr/bin/timeout"]) &&
               exact(container.Config.Cmd, command) &&
               exact(container.Args, command),
           );
         };
         validateProfile((await inspect(id)).receipt, "created");
         const output = await call(
           ["start", "--attach", "--interactive", id],
           scope.signal,
-          snapshot,
+          encoded?.chunks ?? [snapshot],
+          profile.outputBytes,
         );
         validateProfile((await inspect(id)).receipt, "exited");
-        report = NativeDrawingDwgImportReportSchema.parse(json(output));
-        requireCondition(exact(report.source, expected));
+        if (encoded)
+          report = decodeNativeDrawingDwgResaveOutput(output, encoded);
+        else {
+          const parsed = NativeDrawingDwgImportReportSchema.parse(json(output));
+          requireCondition(exact(parsed.source, expected));
+          report = parsed;
+        }
         requireCondition(
           !scope.signal.aborted &&
             performance.now() - started <= timeoutMilliseconds,
         );
-        requireCondition(
-          sourceBytes.byteLength === expected.byteSize &&
-            sha256(sourceBytes) === expected.sha256,
-        );
+        requireCondition(unchanged());
       } finally {
         if (createAttempted) {
           const cleanup = cleanupSignal();
           const owned = await inspect(id ?? name, cleanup);
           const removed = await call(["rm", "--force", owned.id], cleanup);
           requireCondition(
             new TextDecoder("utf-8", { fatal: true }).decode(removed).trim() ===
               owned.id,
           );
         }
       }
     } finally {
       scope.dispose();
       try {
         if (configDirectory) {
           const cleanup = cleanupSignal();
           const config = configDirectory;
           // Nonrecursive removal cannot destroy any unexpected client artifacts.
           await new Promise<void>((resolve, reject) => {
             const abort = () => reject(new Error(FAILURE));
@@ -487,31 +586,26 @@ export async function runIsolatedNativeDrawingDwgReader(input: {
                 current.isDirectory() &&
                   !current.isSymbolicLink() &&
                   current.dev === configIdentity?.dev &&
                   current.ino === configIdentity?.ino &&
                   (await realpath(config)) === config &&
                   !cleanup.aborted,
               );
               await rmdir(config);
               requireCondition(!cleanup.aborted);
             })()
               .then(resolve, reject)
               .finally(() => cleanup.removeEventListener("abort", abort));
           });
         }
       } finally {
         cleanupScope?.dispose();
       }
     }
     // Publish only after both asynchronous cleanup stages; callers can still
     // mutate their bytes or cancel while the CLI directory is being removed.
-    requireCondition(
-      report &&
-        !signal?.aborted &&
-        sourceBytes.byteLength === expected.byteSize &&
-        sha256(sourceBytes) === expected.sha256,
-    );
+    requireCondition(report && !signal?.aborted && unchanged());
     return report;
   } catch {
-    throw new Error(FAILURE);
+    throw new Error(profile.failure);
   }
 }

```

## platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs
index 3f41a38..b3c08d2 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-geometry-resave-integration.test.mjs
@@ -256,41 +256,41 @@ async function compileAndQualify({
     requestBytes,
     sourceDwg,
     editedDwg,
     qualification,
     after,
   };
 }
 
 function assertQualificationEvidence(
   run,
   originalSha,
   expectedHandles,
   literalUntouchedEntities,
   literalBlocks,
 ) {
   const { qualification, requestBytes, sourceDwg, editedDwg, after } = run;
   assert.equal(after.qualification, "experimental-unqualified");
   assert.equal(qualification.status, "experimental");
   assert.equal(
     qualification.internalSyntheticResult,
-    "passed-with-inventory-gaps",
+    "passed",
   );
   assert.equal(
     qualification.productionDwgDeliveryQualification,
     "not-qualified",
   );
   assert.equal(qualification.independentCadVerification, "not-performed");
   assert.equal(
     qualification.tolerances.geometryNumericAbsolute,
     GEOMETRY_TOLERANCE,
   );
   assert.deepEqual(qualification.input, {
     path: sourceDwg,
     sha256Before: originalSha,
     sha256WorkingCopy: originalSha,
     sha256After: originalSha,
     originalBytesPreserved: true,
   });
   assert.deepEqual(qualification.editRequest, {
     sha256: sha256(requestBytes),
     sourceSha256: originalSha,
@@ -610,43 +610,47 @@ test(
     assert.deepEqual(
       (({ handle, ownerHandle, layerHandle, type }) => ({
         handle,
         ownerHandle,
         layerHandle,
         type,
       }))(nonzeroArc),
       sourceIdentityByType.get("ARC"),
     );
     assert.equal(
       nonzeroFullTurn.after.source.sha256,
       sha256(await readFile(nonzeroFullTurn.editedDwg)),
     );
 
     const literalBaselineEntities = [
       {
         handle: "47",
         type: "VIEWPORT",
         owner: "44",
         layer: "0",
-        geometry: "unsupported-type=ACadSharp.Entities.Viewport",
+        // Pinned default paper is A4 landscape, centered at half its stored size.
+        // Its unset model view height stays zero; no derived scale division is used.
+        geometry:
+          "center=148.5,105,0;width=297;height=210;viewCenter=0,0;viewHeight=0;viewDirection=0,0,1;viewTarget=0,0,0;twist=0;frontClip=0;backClip=0;lens=0;id=1;paper=True;active=1;status=0;ucsOrigin=0,0,0;ucsX=1,0,0;ucsY=0,1,0;ucsType=None;ucsPerViewport=False;ucsIcon=False;elevation=0;snapAngle=0;snapBase=0,0;snapSpacing=0,0;gridSpacing=0,0;gridFrequency=0;circleZoom=0;shadePlot=AsDisplayed;render=Optimized2D;defaultLighting=False;lightingType=OneDistantLight;brightness=0;contrast=0;ambient=ByBlock",
         text: null,
-        reference: null,
+        reference:
+          '{"StyleSheetName":"","boundary":null,"frozenLayers":[],"visualStyle":null,"scale":null}',
       },
       {
         handle: "4A",
         type: "LINE",
         owner: "40",
         layer: "QA_GEOMETRY",
         geometry: "start=0,0,0;end=100,0,0;thickness=0;normal=0,0,1",
         text: null,
         reference: null,
       },
       {
         handle: "4B",
         type: "CIRCLE",
         owner: "40",
         layer: "QA_GEOMETRY",
         geometry: "center=25,25,0;radius=10;thickness=0;normal=0,0,1",
         text: null,
         reference: null,
       },
       {

```

## platform/tests/drawing-native-dwg-resave-protocol.test.mjs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-resave-protocol.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-resave-protocol.test.mjs
new file mode 100644
index 0000000..3935834
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-resave-protocol.test.mjs
@@ -0,0 +1,285 @@
+import assert from "node:assert/strict";
+import { createHash } from "node:crypto";
+import { test } from "node:test";
+
+const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
+const sourceBytes = Buffer.from("AC1024original");
+const source = {
+  sha256: sha(sourceBytes),
+  byteSize: 14,
+  headerVersion: "AC1024",
+};
+const requestJson = {
+  schemaVersion: "1hk-dwg-edits/2",
+  sourceSha256: source.sha256,
+  coordinateSystem: "WCS_NATIVE_UNITS",
+  edits: [{ handle: "4A", type: "LINE", start: [1, 2, 0], end: [3, 4, 0] }],
+};
+const requestBytes = Buffer.from(JSON.stringify(requestJson));
+const request = {
+  schemaVersion: "1hk-dwg-edits/2",
+  sha256: sha(requestBytes),
+  byteSize: requestBytes.length,
+  handles: ["4A"],
+};
+const dwgBytes = Buffer.from("AC1024resaved");
+const report = {
+  schemaVersion: "1hk-dwg-resave/1",
+  qualification: "experimental-unqualified",
+  persistenceAuthority: "not-issued",
+  source,
+  request,
+  output: {
+    sha256: sha(dwgBytes),
+    byteSize: dwgBytes.length,
+    headerVersion: "AC1024",
+  },
+  engine: { name: "ACadSharp", version: "3.7.1" },
+  verification: {
+    noEditRoundTrip: "passed",
+    selectedEditRoundTrip: "passed",
+    geometryTolerance: 1e-9,
+    inventoriedEntityCount: 9,
+    editedEntityCount: 1,
+    inventoryCoverage: "supported-fields-only",
+    independentCad: "not-performed",
+  },
+};
+// Deliberately independent wire fixture; never calls the production encoder.
+function frame(reportValue = report, output = dwgBytes) {
+  const bytes = Buffer.isBuffer(reportValue)
+    ? reportValue
+    : Buffer.from(JSON.stringify(reportValue));
+  const header = Buffer.from([
+    49, 72, 75, 82, 83, 79, 48, 49, 0, 0, 0, 0, 0, 0, 0, 0,
+  ]);
+  header.writeUInt32BE(bytes.length, 8);
+  header.writeUInt32BE(output.length, 12);
+  return Buffer.concat([header, bytes, output]);
+}
+async function api() {
+  const mod = await import(
+    "../app/lukas/lib/drawing-native-dwg-resave-protocol.server.ts"
+  ).catch(() => ({}));
+  for (const name of [
+    "NativeDrawingDwgResaveReportSchema",
+    "encodeNativeDrawingDwgResaveInput",
+    "decodeNativeDrawingDwgResaveOutput",
+  ])
+    assert.ok(mod[name], `Required protocol API absent: ${name}`);
+  return mod;
+}
+const input = () => ({
+  sourceBytes: Buffer.from(sourceBytes),
+  expectedSource: { ...source },
+  requestBytes: Buffer.from(requestBytes),
+  expectedRequestSha256: request.sha256,
+});
+
+test("encoder snapshots exact bytes with a literal big endian 16 byte header and frozen identities", async () => {
+  const { encodeNativeDrawingDwgResaveInput: encode } = await api();
+  const supplied = input();
+  const result = encode(supplied);
+  const header = Buffer.from([
+    49, 72, 75, 82, 83, 86, 48, 49, 0, 0, 0, 0, 0, 0, 0, 14,
+  ]);
+  header.writeUInt32BE(requestBytes.length, 8);
+  assert.equal(result.chunks.length, 3);
+  assert.deepEqual(result.chunks[0], header);
+  assert.deepEqual(result.source, source);
+  assert.deepEqual(result.request, request);
+  supplied.sourceBytes.fill(0);
+  supplied.requestBytes.fill(0);
+  supplied.expectedSource.sha256 = "0".repeat(64);
+  assert.deepEqual(result.chunks[1], requestBytes);
+  assert.deepEqual(result.chunks[2], sourceBytes);
+  assert.ok(Object.isFrozen(result.source));
+  assert.ok(Object.isFrozen(result.request));
+  assert.ok(Object.isFrozen(result.request.handles));
+});
+
+test("encoder rejects unbound source, malformed metadata, handles, types, UTF8, BOM and bounded lengths", async () => {
+  const { encodeNativeDrawingDwgResaveInput: encode } = await api();
+  const wrongRequests = [
+    { ...requestJson, schemaVersion: "1hk-dwg-edits/1" },
+    { ...requestJson, sourceSha256: "0".repeat(64) },
+    { ...requestJson, coordinateSystem: "other" },
+    { ...requestJson, extra: true },
+    { ...requestJson, edits: [] },
+    ...["0", "04A", "4a", "10000000000000000"].map((handle) => ({
+      ...requestJson,
+      edits: [{ ...requestJson.edits[0], handle }],
+    })),
+    { ...requestJson, edits: [requestJson.edits[0], requestJson.edits[0]] },
+    { ...requestJson, edits: [{ handle: "4A", type: "INSERT" }] },
+    {
+      ...requestJson,
+      edits: Array.from({ length: 10001 }, () => requestJson.edits[0]),
+    },
+    null,
+    [],
+  ];
+  for (const bad of wrongRequests) {
+    const bytes = Buffer.from(JSON.stringify(bad));
+    assert.throws(() =>
+      encode({
+        ...input(),
+        requestBytes: bytes,
+        expectedRequestSha256: sha(bytes),
+      }),
+    );
+  }
+  for (const bytes of [
+    Buffer.alloc(0),
+    Buffer.alloc(2 * 1024 * 1024 + 1),
+    Buffer.from([255]),
+    Buffer.concat([Buffer.from([239, 187, 191]), requestBytes]),
+    Buffer.from("{}x"),
+  ])
+    assert.throws(() =>
+      encode({
+        ...input(),
+        requestBytes: bytes,
+        expectedRequestSha256: sha(bytes),
+      }),
+    );
+  for (const change of [
+    { expectedSource: { ...source, sha256: "0".repeat(64) } },
+    { expectedSource: { ...source, byteSize: 6 } },
+    { expectedSource: { ...source, extra: true } },
+    { expectedRequestSha256: "0".repeat(64) },
+    { expectedRequestSha256: request.sha256.toUpperCase() },
+    { sourceBytes: new Uint8Array(5) },
+    { sourceBytes: Buffer.from("AC1032original") },
+    { sourceBytes: [] },
+    { requestBytes: [] },
+  ])
+    assert.throws(() => encode({ ...input(), ...change }));
+});
+
+test("encoder preserves native geometry and duplicate-key validation bytes without reserialization", async () => {
+  const { encodeNativeDrawingDwgResaveInput: encode } = await api();
+  const bytes = Buffer.from(
+    JSON.stringify(requestJson).replace(
+      '"start":[1,2,0]',
+      '"start":[1,2,0],"start":[0,0,0]',
+    ),
+  );
+  const result = encode({
+    ...input(),
+    requestBytes: bytes,
+    expectedRequestSha256: sha(bytes),
+  });
+  assert.deepEqual(result.chunks[1], bytes);
+});
+
+test("decoder accepts strict literal success frame and exact output identities", async () => {
+  const { decodeNativeDrawingDwgResaveOutput: decode } = await api();
+  const result = decode(frame(), { source, request });
+  assert.deepEqual(result.report, report);
+  assert.deepEqual(result.dwgBytes, dwgBytes);
+  assert.deepEqual(result.reportBytes, Buffer.from(JSON.stringify(report)));
+  assert.equal(result.report.persistenceAuthority, "not-issued");
+});
+
+test("decoder rejects malformed framing, UTF8/BOM, lengths, altered DWG and trailing bytes", async () => {
+  const { decodeNativeDrawingDwgResaveOutput: decode } = await api();
+  const good = frame();
+  const wrongMagic = Buffer.from(good);
+  wrongMagic[7] = 50;
+  const wrongLength = Buffer.from(good);
+  wrongLength.writeUInt32LE(10, 8);
+  const zero = Buffer.from(good);
+  zero.writeUInt32BE(0, 8);
+  const huge = Buffer.from(good);
+  huge.writeUInt32BE(200 * 1024 * 1024 + 1, 12);
+  const changed = Buffer.from(good);
+  changed[changed.length - 1] ^= 1;
+  for (const bad of [
+    Buffer.alloc(0),
+    good.subarray(0, 15),
+    good.subarray(0, -1),
+    Buffer.concat([good, Buffer.from([0])]),
+    wrongMagic,
+    wrongLength,
+    zero,
+    huge,
+    changed,
+    frame(Buffer.from([255])),
+    frame(
+      Buffer.concat([
+        Buffer.from([239, 187, 191]),
+        Buffer.from(JSON.stringify(report)),
+      ]),
+    ),
+    frame(report, Buffer.from("AC1032resaved")),
+    frame(
+      {
+        ...report,
+        output: {
+          ...report.output,
+          headerVersion: "AC1032",
+          sha256: sha(Buffer.from("AC1032resaved")),
+        },
+      },
+      Buffer.from("AC1032resaved"),
+    ),
+  ])
+    assert.throws(() => decode(bad, { source, request }));
+});
+
+test("decoder rejects extra shape, changed bindings, handle order/count and authority-bearing status", async () => {
+  const {
+    decodeNativeDrawingDwgResaveOutput: decode,
+    NativeDrawingDwgResaveReportSchema: schema,
+  } = await api();
+  const changes = [
+    { extra: true },
+    { schemaVersion: "1hk-dwg-resave/2" },
+    { qualification: "qualified" },
+    { persistenceAuthority: "issued" },
+    { source: { ...source, sha256: "0".repeat(64) } },
+    { source: { ...source, byteSize: 5 } },
+    { request: { ...request, sha256: "0".repeat(64) } },
+    { request: { ...request, byteSize: request.byteSize + 1 } },
+    { request: { ...request, handles: ["4B"] } },
+    { request: { ...request, handles: ["4A", "4A"] } },
+    { request: { ...request, handles: ["4a"] } },
+    { request: { ...request, extra: true } },
+    { output: { ...report.output, byteSize: dwgBytes.length + 1 } },
+    { engine: { ...report.engine, version: "3.7.2" } },
+    ...[
+      { noEditRoundTrip: "failed" },
+      { selectedEditRoundTrip: "failed" },
+      { independentCad: "passed" },
+      { inventoryCoverage: "complete" },
+      { geometryTolerance: 1e-8 },
+      { editedEntityCount: 2 },
+      { inventoriedEntityCount: 0 },
+      { inventoriedEntityCount: 10001 },
+      { extra: true },
+    ].map((v) => ({ verification: { ...report.verification, ...v } })),
+  ];
+  for (const change of changes)
+    assert.throws(() =>
+      decode(frame({ ...report, ...change }), { source, request }),
+    );
+  assert.equal(
+    schema.safeParse({
+      ...report,
+      verification: { ...report.verification, editedEntityCount: 2 },
+    }).success,
+    false,
+  );
+  const ordered = { ...request, handles: ["4A", "4B"] };
+  assert.throws(() =>
+    decode(
+      frame({
+        ...report,
+        request: { ...ordered, handles: ["4B", "4A"] },
+        verification: { ...report.verification, editedEntityCount: 2 },
+      }),
+      { source, request: ordered },
+    ),
+  );
+});

```

## platform/tests/drawing-native-dwg-resave-sandbox-integration.test.mjs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-resave-sandbox-integration.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-resave-sandbox-integration.test.mjs
new file mode 100644
index 0000000..591c057
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-resave-sandbox-integration.test.mjs
@@ -0,0 +1,665 @@
+import assert from "node:assert/strict";
+import { spawn } from "node:child_process";
+import { createHash, randomBytes } from "node:crypto";
+import {
+  access,
+  chmod,
+  mkdir,
+  mkdtemp,
+  readFile,
+  rmdir,
+  stat,
+  writeFile,
+} from "node:fs/promises";
+import { isAbsolute, join } from "node:path";
+import { before, after, test } from "node:test";
+import {
+  applyDrawingCommand,
+  createDrawingDocumentState,
+} from "../app/lukas/lib/drawing-commands.ts";
+import { projectNativeDrawingDwgImport } from "../app/lukas/lib/drawing-native-dwg-import.server.ts";
+import { buildNativeDrawingDwgSelectedEdits } from "../app/lukas/lib/drawing-native-dwg-selected-edits.server.ts";
+import {
+  nativeDwgResaveSandboxCreateArguments,
+  runIsolatedNativeDrawingDwgReader,
+  runIsolatedNativeDrawingDwgResaver,
+} from "../app/lukas/lib/drawing-native-dwg-sandbox.server.ts";
+import { runNativeDwgProcess } from "../app/lukas/lib/drawing-native-dwg-worker.server.ts";
+
+// Actual Docker/native tests. The forwarding shim records real daemon receipts;
+// it never invents native output or container policy. Evidence is retained only
+// in the explicitly supplied private directory, which must not already exist.
+const label = "org.1hk.native-dwg-resaver.attempt";
+const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
+const required = (name) => {
+  assert.ok(
+    process.env[name],
+    `Required actual resave prerequisite unavailable: ${name}`,
+  );
+  return process.env[name];
+};
+let dockerPath,
+  dockerHost,
+  imageId,
+  root,
+  config,
+  engineDll,
+  dotnetPath,
+  sourceBytes,
+  expectedSource,
+  baseInput,
+  requestBytes;
+const identity = {
+  revisionId: "95000000-0000-4000-8000-000000000001",
+  canvasId: "95000000-0000-4000-8000-000000000002",
+  sourceFileId: "95000000-0000-4000-8000-000000000003",
+};
+const actorId = "95000000-0000-4000-8000-000000000004";
+const jsonFile = async (path) => JSON.parse(await readFile(path, "utf8"));
+const saveJson = (name, value) =>
+  writeFile(join(root, name), JSON.stringify(value, null, 2) + "\n", {
+    flag: "wx",
+  });
+
+function docker(args, input) {
+  return new Promise((resolve, reject) => {
+    const child = spawn(
+      dockerPath,
+      ["--config", config, "--host", dockerHost, ...args],
+      {
+        env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
+        stdio: ["pipe", "pipe", "pipe"],
+        shell: false,
+      },
+    );
+    const out = [],
+      err = [];
+    let size = 0,
+      failure;
+    const fail = (error) => {
+      failure = error;
+      child.kill("SIGKILL");
+    };
+    const timer = setTimeout(
+      () => fail(new Error("Actual Docker deadline")),
+      30000,
+    );
+    for (const [stream, chunks] of [
+      [child.stdout, out],
+      [child.stderr, err],
+    ])
+      stream.on("data", (chunk) => {
+        size += chunk.length;
+        if (size > 2 * 1024 * 1024)
+          fail(new Error("Actual Docker output overflow"));
+        else chunks.push(chunk);
+      });
+    child.once("error", fail);
+    child.stdin.once("error", fail);
+    child.stdin.end(input);
+    child.once("close", (code, signal) => {
+      clearTimeout(timer);
+      if (failure) reject(failure);
+      else
+        resolve({
+          code,
+          signal,
+          stdout: Buffer.concat(out),
+          stderr: Buffer.concat(err),
+        });
+    });
+  });
+}
+async function ok(args, input) {
+  const r = await docker(args, input);
+  assert.equal(r.code, 0, r.stderr.toString());
+  assert.equal(r.signal, null);
+  return r.stdout;
+}
+async function inspect(id) {
+  return JSON.parse((await ok(["container", "inspect", id])).toString())[0];
+}
+async function absent(name) {
+  assert.match(name, /^1hk-dwg-resave-[0-9a-f]{32}$/);
+  const names = (
+    await ok([
+      "container",
+      "ls",
+      "--all",
+      "--no-trunc",
+      "--filter",
+      `name=^/${name}$`,
+      "--format",
+      "{{.Names}}",
+    ])
+  )
+    .toString()
+    .trim();
+  assert.equal(names, "");
+}
+async function removeOwned(owned) {
+  const r = await inspect(owned.id);
+  assert.equal(r.Name, `/${owned.name}`);
+  assert.equal(r.Image, imageId);
+  assert.equal(r.Config.Labels[label], owned.nonce);
+  assert.equal(
+    (await ok(["rm", "--force", owned.id])).toString().trim(),
+    owned.id,
+  );
+}
+async function native(args) {
+  return runNativeDwgProcess(dotnetPath, [engineDll, ...args], {
+    timeoutMilliseconds: 120000,
+    maxOutputBytes: 65536,
+    signal: new AbortController().signal,
+    env: { LANG: "C", LC_ALL: "C" },
+  });
+}
+async function shim(name, coordinate = false) {
+  const path = join(root, `${name}-docker`),
+    log = join(root, `${name}-calls.jsonl`),
+    marker = join(root, `${name}-running`);
+  // All policy and lifecycle actions below go through the actual Docker CLI.
+  const script = `#!${process.execPath}
+import {spawnSync} from 'node:child_process';
+import fs from 'node:fs';
+const actual=${JSON.stringify(dockerPath)},args=process.argv.slice(2),log=${JSON.stringify(log)},marker=${JSON.stringify(marker)};
+const op=args[4],id=args.at(-1),common=args.slice(0,4);
+const call=(a,stdio='pipe')=>spawnSync(actual,a,{stdio,env:process.env,timeout:30000});
+fs.appendFileSync(log,JSON.stringify({args})+'\\n');
+if(op==='start'){
+ const pre=call([...common,'container','inspect',id]);if(pre.status!==0)process.exit(71);
+ fs.writeFileSync(${JSON.stringify(join(root, name + "-before.json"))},pre.stdout);
+ if(${coordinate}){const s=call([...common,'start',id]);if(s.status!==0)process.exit(72);fs.writeFileSync(marker,id);await new Promise(resolve=>setTimeout(resolve,5000));}
+ const r=call(${coordinate}?[...common,'attach',id]:args,'inherit');
+ const post=call([...common,'container','inspect',id]);if(post.status===0)fs.writeFileSync(${JSON.stringify(join(root, name + "-after.json"))},post.stdout);
+ process.exit(r.status??73);
+}
+const r=call(args,'inherit');process.exit(r.status??74);
+`;
+  await writeFile(path, script, { flag: "wx" });
+  await chmod(path, 0o700);
+  return {
+    path,
+    marker,
+    async names() {
+      const lines = (await readFile(log, "utf8").catch(() => ""))
+        .trim()
+        .split("\n")
+        .filter(Boolean)
+        .map(JSON.parse);
+      return lines
+        .filter((l) => l.args[4] === "create")
+        .map((l) => l.args[l.args.indexOf("--name") + 1]);
+    },
+  };
+}
+
+before(
+  async () => {
+    dockerPath = required("NATIVE_DWG_DOCKER_PATH");
+    dockerHost = required("NATIVE_DWG_DOCKER_HOST");
+    imageId = required("NATIVE_DWG_RESAVER_IMAGE_ID");
+    root = required("NATIVE_DWG_RESAVE_SANDBOX_EVIDENCE_DIRECTORY");
+    engineDll = required("NATIVE_DWG_RESAVE_TEST_ENGINE_DLL");
+    dotnetPath = required("NATIVE_DWG_DOTNET_PATH");
+    for (const path of [dockerPath, root, engineDll, dotnetPath])
+      assert.ok(isAbsolute(path));
+    assert.match(imageId, /^sha256:[0-9a-f]{64}$/);
+    assert.match(dockerHost, /^unix:\/\/\//);
+    assert.ok((await stat(dockerHost.slice(7))).isSocket());
+    await mkdir(root);
+    config = await mkdtemp(join(root, "empty-config-"));
+    const image = JSON.parse(
+      (await ok(["image", "inspect", imageId])).toString(),
+    )[0];
+    assert.equal(
+      image.Config.Labels["org.1hk.native-dwg-resaver.protocol"],
+      "1hk-dwg-resave/1",
+    );
+    assert.equal(
+      image.Config.Labels["org.1hk.native-dwg-reader.protocol"],
+      "1hk-dwg-import/1",
+    );
+    await saveJson("image.json", image);
+    await native([
+      "create-generated-fixture",
+      "--output-dir",
+      join(root, "source"),
+    ]);
+    sourceBytes = await readFile(join(root, "source", "synthetic-input.dwg"));
+    expectedSource = {
+      sha256: sha(sourceBytes),
+      byteSize: sourceBytes.length,
+      headerVersion: "AC1024",
+    };
+    baseInput = {
+      dockerPath,
+      dockerHost,
+      imageId,
+      sourceBytes,
+      expectedSource,
+      timeoutMilliseconds: 120000,
+    };
+  },
+  { timeout: 180000 },
+);
+after(async () => {
+  if (config) await rmdir(config);
+});
+
+test(
+  "actual resaver 2GiB cgroup enforces no mounts/network/capabilities and deadline",
+  { timeout: 60000 },
+  async () => {
+    const nonce = randomBytes(16).toString("hex"),
+      name = `1hk-dwg-resave-${nonce}`;
+    const args = nativeDwgResaveSandboxCreateArguments({
+      imageId,
+      nonce,
+      timeoutMilliseconds: 10000,
+    });
+    const command = `printf 'MEMORY=';cat /sys/fs/cgroup/memory.max;printf 'SWAP=';cat /sys/fs/cgroup/memory.swap.max;printf 'CPU=';cat /sys/fs/cgroup/cpu.max;printf 'PIDS=';cat /sys/fs/cgroup/pids.max;cat /proc/self/status;cat /proc/net/dev;cat /proc/net/route;cat /proc/self/mountinfo;env;touch /.probe 2>/dev/null;printf 'ROOT_WRITE=%s\\n' "$?";touch /tmp/probe;printf 'TMP_WRITE=%s\\n' "$?";test -e /Users;printf 'HOST_USERS=%s\\n' "$?"`;
+    const id = (
+      await ok([
+        ...args.slice(0, args.indexOf(imageId) + 1),
+        "--signal=KILL",
+        "10s",
+        "/bin/sh",
+        "-c",
+        command,
+      ])
+    )
+      .toString()
+      .trim();
+    const owned = { id, name, nonce };
+    try {
+      const receipt = await inspect(id);
+      assert.deepEqual(receipt.Mounts, []);
+      assert.equal(receipt.HostConfig.NetworkMode, "none");
+      assert.equal(receipt.HostConfig.ReadonlyRootfs, true);
+      assert.deepEqual(receipt.HostConfig.CapDrop, ["ALL"]);
+      assert.equal(receipt.HostConfig.Memory, 2147483648);
+      assert.equal(receipt.HostConfig.MemorySwap, 2147483648);
+      const output = (await ok(["start", "--attach", id])).toString();
+      await writeFile(join(root, "cgroup-probe.txt"), output, { flag: "wx" });
+      await saveJson("cgroup-receipt.json", receipt);
+      assert.match(output, /MEMORY=2147483648\n/);
+      assert.match(output, /SWAP=0\n/);
+      assert.match(output, /CPU=100000 100000\n/);
+      assert.match(output, /PIDS=64\n/);
+      assert.match(output, /^Uid:\s+65532\s+65532\s+65532\s+65532$/m);
+      assert.match(output, /^NoNewPrivs:\s+1$/m);
+      assert.match(output, /^Seccomp:\s+2$/m);
+      for (const cap of ["CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"])
+        assert.match(output, new RegExp(`^${cap}:\\s+0+$`, "m"));
+      assert.doesNotMatch(output, /eth0|en0|SECRET|SUPABASE/);
+      assert.match(output, /ROOT_WRITE=[1-9]/);
+      assert.match(output, /TMP_WRITE=0/);
+      assert.match(output, /HOST_USERS=1/);
+      assert.match(output, /\/tmp rw,nosuid,nodev,noexec/);
+    } finally {
+      await removeOwned(owned);
+    }
+    await absent(name);
+    const timerNonce = randomBytes(16).toString("hex"),
+      timerName = `1hk-dwg-resave-${timerNonce}`;
+    const timerArgs = nativeDwgResaveSandboxCreateArguments({
+      imageId,
+      nonce: timerNonce,
+      timeoutMilliseconds: 1000,
+    });
+    const timerId = (
+      await ok([
+        ...timerArgs.slice(0, timerArgs.indexOf(imageId) + 1),
+        "--signal=KILL",
+        "1s",
+        "/bin/sleep",
+        "30",
+      ])
+    )
+      .toString()
+      .trim();
+    try {
+      const started = Date.now();
+      const r = await docker(["start", "--attach", timerId]);
+      assert.equal(r.code, 137);
+      assert.ok(Date.now() - started < 7000);
+      assert.equal((await inspect(timerId)).State.OOMKilled, false);
+    } finally {
+      await removeOwned({ id: timerId, name: timerName, nonce: timerNonce });
+    }
+    await absent(timerName);
+  },
+);
+
+test(
+  "actual compiler edits five literal geometries through isolated resave and readback with untouched inventory",
+  { timeout: 240000 },
+  async (t) => {
+    const before = await runIsolatedNativeDrawingDwgReader(baseInput);
+    assert.equal(before.unitCode, 4);
+    assert.equal(before.source.headerVersion, "AC1024");
+    const importInput = { report: before, expectedSource, ...identity };
+    const projected = projectNativeDrawingDwgImport(importInput);
+    const geometry = {
+      LINE: { type: "line", start: { x: 10, y: 11 }, end: { x: 120, y: 21 } },
+      CIRCLE: { type: "circle", center: { x: 12, y: 14 }, radius: 7 },
+      ARC: {
+        type: "arc",
+        semanticVersion: 1,
+        center: { x: 45, y: 30 },
+        radius: 9,
+        startAngleDegrees: 300,
+        sweepAngleDegrees: 90,
+      },
+      LWPOLYLINE: {
+        type: "polyline",
+        points: [
+          { x: 1, y: 12 },
+          { x: 16, y: 20 },
+          { x: 31, y: 12 },
+          { x: 1, y: 12 },
+        ],
+        closed: false,
+      },
+    };
+    const updates = projected.objects.map((object) => {
+      const type = projected.bindings.find(
+        (b) => b.objectId === object.id,
+      ).entityType;
+      return {
+        objectId: object.id,
+        baseVersion: object.version,
+        patch:
+          type === "TEXT"
+            ? {
+                geometry: {
+                  ...object.geometry,
+                  origin: { x: 8, y: 42 },
+                  text: "수정된 실명",
+                },
+                style: { ...object.style, fontSize: 3.25 },
+              }
+            : { geometry: geometry[type] },
+      };
+    });
+    const state = createDrawingDocumentState({
+      revisionId: identity.revisionId,
+      objects: projected.objects,
+      layers: projected.layers,
+    });
+    const applied = applyDrawingCommand(
+      state,
+      { type: "update_objects", actorId, updates },
+      {
+        createId: () => "95000000-0000-4000-8000-000000000005",
+        now: () => "2026-09-06T00:00:00.000Z",
+      },
+    );
+    const compiled = buildNativeDrawingDwgSelectedEdits({
+      importInput,
+      objects: Object.values(applied.state.objects),
+    });
+    assert.deepEqual(
+      compiled.request.edits.map(({ handle, type }) => ({ handle, type })),
+      [
+        { handle: "4A", type: "LINE" },
+        { handle: "4B", type: "CIRCLE" },
+        { handle: "4C", type: "ARC" },
+        { handle: "4D", type: "LWPOLYLINE" },
+        { handle: "4E", type: "TEXT" },
+      ],
+    );
+    requestBytes = Buffer.from(JSON.stringify(compiled.request));
+    await writeFile(join(root, "request.json"), requestBytes, { flag: "wx" });
+    const forwarded = await shim("success");
+    const result = await runIsolatedNativeDrawingDwgResaver({
+      ...baseInput,
+      dockerPath: forwarded.path,
+      requestBytes,
+      expectedRequestSha256: sha(requestBytes),
+    });
+    assert.deepEqual(result.report.request, {
+      schemaVersion: "1hk-dwg-edits/2",
+      sha256: sha(requestBytes),
+      byteSize: requestBytes.length,
+      handles: ["4A", "4B", "4C", "4D", "4E"],
+    });
+    assert.deepEqual(result.report.source, expectedSource);
+    assert.equal(result.report.output.sha256, sha(result.dwgBytes));
+    assert.equal(result.report.output.byteSize, result.dwgBytes.length);
+    assert.equal(result.report.output.headerVersion, "AC1024");
+    assert.deepEqual(result.report.verification, {
+      noEditRoundTrip: "passed",
+      selectedEditRoundTrip: "passed",
+      geometryTolerance: 1e-9,
+      inventoriedEntityCount: 9,
+      editedEntityCount: 5,
+      inventoryCoverage: "supported-fields-only",
+      independentCad: "not-performed",
+    });
+    assert.deepEqual(JSON.parse(result.reportBytes.toString()), result.report);
+    await writeFile(join(root, "report.json"), result.reportBytes, {
+      flag: "wx",
+    });
+    await writeFile(join(root, "resaved.dwg"), result.dwgBytes, { flag: "wx" });
+    const after = await runIsolatedNativeDrawingDwgReader({
+      ...baseInput,
+      sourceBytes: result.dwgBytes,
+      expectedSource: result.report.output,
+    });
+    assert.equal(after.unitCode, 4);
+    assert.deepEqual(after.layers, before.layers);
+    assert.deepEqual(after.coverage, before.coverage);
+    assert.deepEqual(after.unsupported, before.unsupported);
+    const entity = (type) => after.entities.find((e) => e.type === type);
+    assert.deepEqual(entity("LINE").geometry, {
+      start: [10, 11, 0],
+      end: [120, 21, 0],
+    });
+    assert.deepEqual(entity("CIRCLE").geometry, {
+      center: [12, 14, 0],
+      radius: 7,
+    });
+    assert.deepEqual(entity("LWPOLYLINE").geometry, {
+      points: [
+        [1, 12, 0],
+        [16, 20, 0],
+        [31, 12, 0],
+        [1, 12, 0],
+      ],
+      closed: false,
+    });
+    assert.deepEqual(entity("TEXT").geometry, {
+      insert: [8, 42, 0],
+      height: 3.25,
+      text: "수정된 실명",
+    });
+    assert.deepEqual(entity("ARC").geometry.center, [45, 30, 0]);
+    assert.equal(entity("ARC").geometry.radius, 9);
+    assert.ok(
+      Math.abs(entity("ARC").geometry.startAngleRadians - 5.235987755982989) <=
+        1e-9,
+    );
+    assert.ok(
+      Math.abs(entity("ARC").geometry.endAngleRadians - 6.806784082777885) <=
+        1e-9,
+    );
+    const ids = (report) =>
+      report.entities.map(({ handle, ownerHandle, layerHandle, type }) => ({
+        handle,
+        ownerHandle,
+        layerHandle,
+        type,
+      }));
+    assert.deepEqual(ids(after), ids(before));
+    // Passive native inventories include default paper VIEWPORT and block
+    // children that the editable reader intentionally does not project.
+    for (const [name, path] of [
+      ["source", join(root, "source", "synthetic-input.dwg")],
+      ["resaved", join(root, "resaved.dwg")],
+    ])
+      await native([
+        "qualify",
+        "--input",
+        path,
+        "--output-dir",
+        join(root, `${name}-inventory`),
+      ]);
+    const baseline = (
+      await jsonFile(
+        join(root, "source-inventory", "qualification-report.json"),
+      )
+    ).baselineInventory;
+    const output = (
+      await jsonFile(
+        join(root, "resaved-inventory", "qualification-report.json"),
+      )
+    ).baselineInventory;
+    const selected = new Set(["4A", "4B", "4C", "4D", "4E"]);
+    const untouched = (inventory) =>
+      inventory.entities.filter((e) => !selected.has(e.handle));
+    assert.deepEqual(untouched(output), untouched(baseline));
+    assert.deepEqual(
+      untouched(output).map(({ handle, type, owner }) => ({
+        handle,
+        type,
+        owner,
+      })),
+      [
+        { handle: "47", type: "VIEWPORT", owner: "44" },
+        { handle: "52", type: "LINE", owner: "4F" },
+        { handle: "53", type: "CIRCLE", owner: "4F" },
+        { handle: "54", type: "INSERT", owner: "40" },
+      ],
+    );
+    assert.equal(
+      untouched(output)[1].geometry,
+      "start=0,0,0;end=8,0,0;thickness=0;normal=0,0,1",
+    );
+    assert.equal(
+      untouched(output)[2].geometry,
+      "center=4,4,0;radius=2;thickness=0;normal=0,0,1",
+    );
+    assert.match(
+      untouched(output)[0].geometry,
+      /^center=148\.5,105,0;width=297;height=210;/,
+    );
+    assert.deepEqual(
+      { ...output, entities: [] },
+      { ...baseline, entities: [] },
+    );
+    assert.equal(sha(sourceBytes), expectedSource.sha256);
+    assert.equal(
+      sha(await readFile(join(root, "source", "synthetic-input.dwg"))),
+      expectedSource.sha256,
+    );
+    for (const name of await forwarded.names()) await absent(name);
+    for (const phase of ["before", "after"]) {
+      const r = (await jsonFile(join(root, `success-${phase}.json`)))[0];
+      assert.equal(r.HostConfig.Memory, 2147483648);
+      assert.equal(r.HostConfig.MemorySwap, 2147483648);
+      assert.deepEqual(r.Mounts, []);
+      assert.equal(r.Config.Cmd.at(-1), "resave-native-stdio");
+      assert.equal(r.State.Status, phase === "before" ? "created" : "exited");
+    }
+    const summary = {
+      imageId,
+      source: expectedSource,
+      requestSha256: sha(requestBytes),
+      reportSha256: sha(result.reportBytes),
+      outputSha256: sha(result.dwgBytes),
+      qualification: "experimental-unqualified",
+      persistenceAuthority: "not-issued",
+      independentCad: "not-performed",
+      inventoryCoverage: "supported-fields-only",
+      ownedCleanup: true,
+    };
+    await saveJson("summary.json", summary);
+    t.diagnostic(JSON.stringify(summary));
+  },
+);
+
+test(
+  "actual invalid geometry, raw invalid stream, source mismatch, cancellation and deadline clean owned attempts and preserve foreign container",
+  { timeout: 120000 },
+  async () => {
+    const nonce = randomBytes(16).toString("hex"),
+      name = `1hk-dwg-resave-${nonce}`;
+    const args = nativeDwgResaveSandboxCreateArguments({
+      imageId,
+      nonce,
+      timeoutMilliseconds: 30000,
+    });
+    const id = (await ok(args)).toString().trim();
+    const sentinel = { id, name, nonce };
+    try {
+      const raw = await docker(
+        ["start", "--attach", "--interactive", id],
+        Buffer.from("invalid stream"),
+      );
+      assert.notEqual(raw.code, 0);
+      assert.equal(raw.stdout.length, 0);
+      assert.equal(raw.stderr.toString(), "native stream resave failed.\n");
+      for (const mode of ["invalid", "mismatch", "abort", "deadline"]) {
+        const forwarded = await shim(
+          mode,
+          mode === "abort" || mode === "deadline",
+        );
+        const controller = new AbortController();
+        const bytes = Buffer.from(
+          JSON.stringify({
+            schemaVersion: "1hk-dwg-edits/2",
+            sourceSha256:
+              mode === "mismatch" ? "0".repeat(64) : expectedSource.sha256,
+            coordinateSystem: "WCS_NATIVE_UNITS",
+            edits: [
+              { handle: "4A", type: "LINE", start: [0, 0, 0], end: [0, 0, 0] },
+            ],
+          }),
+        );
+        const input = {
+          ...baseInput,
+          dockerPath: forwarded.path,
+          requestBytes:
+            mode === "abort" || mode === "deadline" ? requestBytes : bytes,
+          expectedRequestSha256: sha(
+            mode === "abort" || mode === "deadline" ? requestBytes : bytes,
+          ),
+          signal: controller.signal,
+          timeoutMilliseconds: mode === "deadline" ? 3000 : 30000,
+        };
+        const started = Date.now();
+        const pending = assert.rejects(
+          runIsolatedNativeDrawingDwgResaver(input),
+          { message: "Isolated native DWG resave failed." },
+        );
+        if (mode === "abort" || mode === "deadline") {
+          const end = Date.now() + 5000;
+          while (
+            !(await access(forwarded.marker).then(
+              () => true,
+              () => false,
+            ))
+          ) {
+            assert.ok(Date.now() < end);
+            await new Promise((resolve) => setTimeout(resolve, 20));
+          }
+          const runningId = await readFile(forwarded.marker, "utf8");
+          assert.equal((await inspect(runningId)).State.Running, true);
+          if (mode === "abort") controller.abort();
+        }
+        await pending;
+        if (mode === "deadline") assert.ok(Date.now() - started < 8000);
+        const names = await forwarded.names();
+        assert.equal(names.length, mode === "mismatch" ? 0 : 1);
+        for (const ownedName of names) await absent(ownedName);
+        assert.equal((await inspect(id)).Id, id);
+      }
+    } finally {
+      await removeOwned(sentinel);
+    }
+    await absent(name);
+  },
+);

```

## platform/tests/drawing-native-dwg-resave-sandbox.test.mjs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-resave-sandbox.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-resave-sandbox.test.mjs
new file mode 100644
index 0000000..ac3318a
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-resave-sandbox.test.mjs
@@ -0,0 +1,378 @@
+import assert from "node:assert/strict";
+import { createHash } from "node:crypto";
+import fsPromises, { access, readFile, rmdir, unlink } from "node:fs/promises";
+import { syncBuiltinESMExports } from "node:module";
+import { join } from "node:path";
+import { test } from "node:test";
+import {
+  imageId,
+  containerId,
+  sourceBytes,
+  expectedSource,
+  transport,
+} from "./fixtures/drawing-native-dwg-sandbox-transport.mjs";
+
+const failure = { message: "Isolated native DWG resave failed." };
+const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
+const requestBytes = Buffer.from(
+  JSON.stringify({
+    schemaVersion: "1hk-dwg-edits/2",
+    sourceSha256: expectedSource.sha256,
+    coordinateSystem: "WCS_NATIVE_UNITS",
+    edits: [{ handle: "4A", type: "LINE", start: [1, 2, 0], end: [3, 4, 0] }],
+  }),
+);
+const dwgBytes = Buffer.from("AC1024finite-resaved-fixture");
+const report = {
+  schemaVersion: "1hk-dwg-resave/1",
+  qualification: "experimental-unqualified",
+  persistenceAuthority: "not-issued",
+  source: expectedSource,
+  request: {
+    schemaVersion: "1hk-dwg-edits/2",
+    sha256: sha(requestBytes),
+    byteSize: requestBytes.length,
+    handles: ["4A"],
+  },
+  output: {
+    sha256: sha(dwgBytes),
+    byteSize: dwgBytes.length,
+    headerVersion: "AC1024",
+  },
+  engine: { name: "ACadSharp", version: "3.7.1" },
+  verification: {
+    noEditRoundTrip: "passed",
+    selectedEditRoundTrip: "passed",
+    geometryTolerance: 1e-9,
+    inventoriedEntityCount: 9,
+    editedEntityCount: 1,
+    inventoryCoverage: "supported-fields-only",
+    independentCad: "not-performed",
+  },
+};
+const txFor = (t, mode = "ok", change = {}) =>
+  transport(t, mode, change, {
+    report,
+    dwgHex: dwgBytes.toString("hex"),
+    requestHex: requestBytes.toString("hex"),
+  });
+async function api() {
+  const mod = await import(
+    "../app/lukas/lib/drawing-native-dwg-sandbox.server.ts"
+  );
+  assert.equal(
+    typeof mod.runIsolatedNativeDrawingDwgResaver,
+    "function",
+    "Required isolated resaver API absent",
+  );
+  assert.equal(
+    typeof mod.nativeDwgResaveSandboxCreateArguments,
+    "function",
+    "Required resaver profile API absent",
+  );
+  return {
+    run: mod.runIsolatedNativeDrawingDwgResaver,
+    build: mod.nativeDwgResaveSandboxCreateArguments,
+  };
+}
+
+test("resaver fixes command, ownership and 2GiB without accepting profile overrides", async () => {
+  const { build } = await api();
+  const base = { imageId, nonce: "c".repeat(32), timeoutMilliseconds: 1001 };
+  const args = build(base);
+  for (const [key, value] of Object.entries({
+    "--name": `1hk-dwg-resave-${"c".repeat(32)}`,
+    "--label": `org.1hk.native-dwg-resaver.attempt=${"c".repeat(32)}`,
+    "--memory": "2147483648",
+    "--memory-swap": "2147483648",
+    "--network": "none",
+    "--user": "65532:65532",
+    "--cap-drop": "ALL",
+    "--security-opt": "no-new-privileges=true",
+    "--pids-limit": "64",
+    "--cpus": "1",
+  }))
+    assert.equal(args[args.indexOf(key) + 1], value);
+  assert.deepEqual(args.slice(args.indexOf(imageId) + 1), [
+    "--signal=KILL",
+    "2s",
+    "/usr/share/dotnet/dotnet",
+    "/app/DwgEngineQualification.dll",
+    "resave-native-stdio",
+  ]);
+  for (const change of [
+    { imageId: "mutable:latest" },
+    { nonce: "x" },
+    { timeoutMilliseconds: 0 },
+    { timeoutMilliseconds: 120001 },
+    { command: "sh" },
+    { memory: 1 },
+  ])
+    assert.throws(() => build({ ...base, ...change }), failure);
+});
+
+test("success streams literal frame and returns only verified bytes after both cleanup stages", async (t) => {
+  const { run } = await api();
+  const tx = await txFor(t);
+  const result = await run(tx.input);
+  assert.deepEqual(result, {
+    report,
+    reportBytes: Buffer.from(JSON.stringify(report)),
+    dwgBytes,
+  });
+  const header = Buffer.from([
+    49, 72, 75, 82, 83, 86, 48, 49, 0, 0, 0, 0, 0, 0, 0, 0,
+  ]);
+  header.writeUInt32BE(requestBytes.length, 8);
+  header.writeUInt32BE(sourceBytes.length, 12);
+  assert.deepEqual(
+    await tx.stdin(),
+    Buffer.concat([header, requestBytes, sourceBytes]),
+  );
+  assert.equal(await tx.stateExists(), false);
+  const calls = await tx.calls();
+  assert.deepEqual(calls.at(-1).args.slice(2), ["rm", "--force", containerId]);
+  for (const call of calls) {
+    const { __CF_USER_TEXT_ENCODING, ...env } = call.env;
+    assert.deepEqual(env, { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" });
+    assert.deepEqual(call.configEntries, []);
+    assert.equal(call.configMode, 0o700);
+  }
+  await assert.rejects(access(calls[0].configDirectory), { code: "ENOENT" });
+});
+
+test("request and source mismatches, host configuration and abort fail before Docker spawn", async (t) => {
+  const { run } = await api();
+  const tx = await txFor(t);
+  const unbound = Buffer.from(
+    requestBytes.toString().replace(expectedSource.sha256, "0".repeat(64)),
+  );
+  for (const change of [
+    { expectedRequestSha256: "0".repeat(64) },
+    { requestBytes: unbound, expectedRequestSha256: sha(unbound) },
+    { expectedSource: { ...expectedSource, sha256: "0".repeat(64) } },
+    { imageId: "mutable:latest" },
+    { dockerHost: "tcp://127.0.0.1:2375" },
+    { dockerPath: "docker" },
+    { signal: AbortSignal.abort() },
+    { timeoutMilliseconds: 120001 },
+  ])
+    await assert.rejects(run({ ...tx.input, ...change }), failure);
+  assert.deepEqual(await tx.calls(), []);
+});
+
+test("resaver refuses wrong image protocol and unenforced resources before create", async (t) => {
+  const { run } = await api();
+  for (const change of [
+    { info: { MemoryLimit: false } },
+    { info: { SwapLimit: false } },
+    { info: { SecurityOptions: ["name=seccomp,profile=unconfined"] } },
+    {
+      image: {
+        Config: {
+          Volumes: null,
+          ExposedPorts: null,
+          Env: ["DOTNET_EnableDiagnostics=0"],
+          Labels: { "org.1hk.native-dwg-reader.protocol": "1hk-dwg-import/1" },
+        },
+      },
+    },
+  ]) {
+    const tx = await txFor(t, "ok", change);
+    await assert.rejects(run(tx.input), failure);
+    assert.equal(
+      (await tx.calls()).some((c) => c.args[2] === "create"),
+      false,
+    );
+  }
+});
+
+test("actual receipt deviations prevent start and clean exact owned identity", async (t) => {
+  const { run } = await api();
+  for (const change of [
+    { host: { Memory: 1073741824 } },
+    { host: { MemorySwap: 1073741824 } },
+    { host: { NetworkMode: "host" } },
+    { host: { CapAdd: ["SYS_ADMIN"] } },
+    { host: { Binds: ["/tmp:/host"] } },
+    { container: { Mounts: [{}] } },
+    { container: { Args: ["sh"] } },
+    { config: { Cmd: ["read-native-stdio"] } },
+    { config: { Env: ["SECRET=x"] } },
+  ]) {
+    const tx = await txFor(t, "ok", change);
+    await assert.rejects(run(tx.input), failure);
+    assert.equal(
+      (await tx.calls()).some((c) => c.args[2] === "start"),
+      false,
+    );
+    assert.equal(await tx.stateExists(), false);
+  }
+});
+
+test("stderr, nonzero, OOM, overflow, malformed and mismatched reports fail closed", async (t) => {
+  const { run } = await api();
+  for (const [mode, change] of [
+    ["nonzero", {}],
+    ["unexpected-stderr", {}],
+    ["stderr-cap", {}],
+    ["stdout-cap", {}],
+    ["metadata-cap", {}],
+    ["utf8", {}],
+    ["bom", {}],
+    ["ok", { state: { OOMKilled: true } }],
+    ["ok", { state: { ExitCode: 7 } }],
+    ["ok", { state: { Running: true } }],
+    ["ok", { report: { extra: true } }],
+    [
+      "ok",
+      { report: { source: { ...expectedSource, sha256: "0".repeat(64) } } },
+    ],
+    [
+      "ok",
+      { report: { request: { ...report.request, sha256: "0".repeat(64) } } },
+    ],
+    [
+      "ok",
+      { report: { output: { ...report.output, sha256: "0".repeat(64) } } },
+    ],
+    ["remove-failure", {}],
+  ]) {
+    const tx = await txFor(t, mode, change);
+    await assert.rejects(run(tx.input), failure);
+    assert.equal(await tx.stateExists(), mode === "remove-failure");
+  }
+});
+
+test("uncertain create outcomes reconcile by owned name and foreign identity is preserved", async (t) => {
+  const { run } = await api();
+  for (const mode of [
+    "lost-create",
+    "bad-id",
+    "hang-create",
+    "foreign-cleanup",
+  ]) {
+    const tx = await txFor(t, mode);
+    await assert.rejects(
+      run({ ...tx.input, timeoutMilliseconds: 1500 }),
+      failure,
+    );
+    const calls = await tx.calls();
+    assert.equal(calls.filter((c) => c.args[2] === "create").length, 1);
+    assert.equal(
+      calls.some((c) => c.args[2] === "rm"),
+      mode !== "foreign-cleanup",
+    );
+    assert.equal(await tx.stateExists(), mode === "foreign-cleanup");
+    if (mode !== "foreign-cleanup")
+      assert.ok(
+        calls.some(
+          (c) =>
+            c.args[2] === "container" && /^1hk-dwg-resave-/.test(c.args.at(-1)),
+        ),
+      );
+  }
+});
+
+for (const stage of ["start", "removal", "config-cleanup"])
+  for (const action of ["source-mutation", "request-mutation", "abort"]) {
+    test(
+      `${action} at ${stage} prevents publication after owned cleanup`,
+      { timeout: 10000 },
+      async (t) => {
+        const { run } = await api();
+        const tx = await txFor(
+          t,
+          stage === "removal"
+            ? "slow-remove"
+            : stage === "start" && action === "abort"
+              ? "hang-start"
+              : "ok",
+        );
+        const controller = new AbortController();
+        const act = () => {
+          if (action === "abort") controller.abort();
+          else
+            tx.input[
+              action === "source-mutation" ? "sourceBytes" : "requestBytes"
+            ][8] ^= 1;
+        };
+        if (stage === "config-cleanup") {
+          const original = fsPromises.rmdir;
+          const mocked = t.mock.method(
+            fsPromises,
+            "rmdir",
+            async (path, ...args) => {
+              const value = await original(path, ...args);
+              if (String(path).includes("/1hk-dwg-cli-")) act();
+              return value;
+            },
+          );
+          syncBuiltinESMExports();
+          t.after(() => {
+            mocked.mock.restore();
+            syncBuiltinESMExports();
+          });
+        }
+        const pending = assert.rejects(
+          run({ ...tx.input, signal: controller.signal }),
+          failure,
+        );
+        if (stage === "start" && action !== "abort") act();
+        else if (stage !== "config-cleanup") {
+          const deadline = Date.now() + 5000;
+          while (
+            !(await tx.calls()).some(
+              (c) => c.args[2] === (stage === "start" ? "start" : "rm"),
+            )
+          ) {
+            assert.ok(Date.now() < deadline);
+            await new Promise((resolve) => setTimeout(resolve, 10));
+          }
+          act();
+        }
+        await pending;
+        assert.equal(await tx.stateExists(), false);
+        if (action !== "abort") {
+          const bytes = await tx.stdin();
+          assert.deepEqual(
+            bytes.subarray(16, 16 + requestBytes.length),
+            requestBytes,
+          );
+          assert.deepEqual(
+            bytes.subarray(16 + requestBytes.length),
+            sourceBytes,
+          );
+        }
+      },
+    );
+  }
+
+test("bounded outer deadline still performs independent cleanup", async (t) => {
+  const { run } = await api();
+  const tx = await txFor(t, "hang-start");
+  const started = Date.now();
+  await assert.rejects(
+    run({ ...tx.input, timeoutMilliseconds: 1500 }),
+    failure,
+  );
+  assert.ok(Date.now() - started < 2800);
+  assert.equal(await tx.stateExists(), false);
+});
+
+test("replaced private CLI directory is preserved and resave fails", async (t) => {
+  const { run } = await api();
+  const tx = await txFor(t, "replace-config");
+  await assert.rejects(run(tx.input), failure);
+  const directory = (await tx.calls())[0].configDirectory;
+  t.after(async () => {
+    await unlink(join(directory, "replacement-sentinel"));
+    await rmdir(directory);
+    await rmdir(directory + "-owned");
+  });
+  assert.equal(
+    await readFile(join(directory, "replacement-sentinel"), "utf8"),
+    "keep",
+  );
+  assert.equal(await tx.stateExists(), false);
+});

```

## platform/tests/drawing-native-dwg-sandbox.test.mjs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/platform/tests/drawing-native-dwg-sandbox.test.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-sandbox.test.mjs
index d643fbc..a9324f4 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/platform/tests/drawing-native-dwg-sandbox.test.mjs
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/drawing-native-dwg-sandbox.test.mjs
@@ -1,188 +1,47 @@
 import assert from "node:assert/strict";
 import { createHash } from "node:crypto";
 import fsPromises from "node:fs/promises";
-import {
-  access,
-  chmod,
-  mkdtemp,
-  readFile,
-  rm,
-  rmdir,
-  unlink,
-  writeFile,
-} from "node:fs/promises";
+import { access, readFile, rmdir, unlink } from "node:fs/promises";
 import { syncBuiltinESMExports } from "node:module";
-import { createServer } from "node:net";
-import { tmpdir } from "node:os";
 import { join } from "node:path";
 import { test } from "node:test";
 
-// These finite Docker CLI doubles test host validation/lifecycle only. Real
-// native parsing and Linux confinement are qualified in the integration suite.
-const imageId = `sha256:${"a".repeat(64)}`;
-const containerId = "b".repeat(64);
-const sourceBytes = Buffer.from("AC1024finite-invalid-native-fixture");
-const expectedSource = {
-  sha256: createHash("sha256").update(sourceBytes).digest("hex"),
-  byteSize: sourceBytes.length,
-  headerVersion: "AC1024",
-};
-const report = {
-  schemaVersion: "1hk-dwg-import/1",
-  qualification: "experimental-unqualified",
-  source: expectedSource,
-  engine: { name: "ACadSharp", version: "3.7.1" },
-  coordinateSystem: "WCS_NATIVE_UNITS",
-  unitCode: 4,
-  modelSpaceHandle: "1F",
-  layers: [],
-  entities: [],
-  unsupported: [],
-  readerNotificationCount: 0,
-  coverage: {
-    modelSpaceEntities: 0,
-    importedEntities: 0,
-    unsupportedEntities: 0,
-    nonModelSpaceEntities: 0,
-  },
-};
+import {
+  imageId,
+  containerId,
+  sourceBytes,
+  expectedSource,
+  report,
+  transport,
+} from "./fixtures/drawing-native-dwg-sandbox-transport.mjs";
+
 async function api() {
   return import("../app/lukas/lib/drawing-native-dwg-sandbox.server.ts").catch(
     (error) => {
       assert.fail(
         `Required production sandbox module unavailable: ${error.code}`,
       );
     },
   );
 }
 
-async function transport(t, mode = "ok", change = {}) {
-  const directory = await mkdtemp(join(tmpdir(), "dwg-sandbox-test-"));
-  const socket = join(directory, "docker.sock");
-  const server = createServer((connection) => connection.end());
-  await new Promise((resolve, reject) => {
-    server.once("error", reject);
-    server.listen(socket, resolve);
-  });
-  t.after(async () => {
-    await new Promise((resolve) => server.close(resolve));
-    await rm(directory, { recursive: true, force: true });
-  });
-  const dockerPath = join(directory, "docker");
-  const log = join(directory, "calls.jsonl");
-  const state = join(directory, "state.json");
-  const script = `#!${process.execPath}
-import fs from 'node:fs';
-const args = process.argv.slice(2);
-let configDirectory,configEntries,configMode;
-if(args[0]==='--config') {
- configDirectory=args[1];args.splice(0,2);
- configEntries=fs.readdirSync(configDirectory);configMode=fs.statSync(configDirectory).mode & 511;
-} else if(${JSON.stringify(mode)}==='hostile-home') {
- // Model Docker's documented passwd-home fallback without touching user config.
- fs.readFileSync(${JSON.stringify(join(directory, "hostile-home-config.json"))});
- fs.writeFileSync(${JSON.stringify(join(directory, "hostile-home-read"))},'read');
-}
-fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args,env:process.env,configDirectory,configEntries,configMode})+'\\n');
-if (args[0] !== '--host' || args[1] !== ${JSON.stringify(`unix://${socket}`)}) process.exit(71);
-args.splice(0,2);
-const mode=${JSON.stringify(mode)}, change=${JSON.stringify(change)}, id=${JSON.stringify(containerId)}, image=${JSON.stringify(imageId)};
-const statePath=${JSON.stringify(state)};
-const read=()=>JSON.parse(fs.readFileSync(statePath,'utf8'));
-const save=(s)=>fs.writeFileSync(statePath,JSON.stringify(s));
-const emit=(v)=>process.stdout.write(JSON.stringify(v));
-if(args[0]==='info') { if(mode==='metadata-cap')process.stdout.write(Buffer.alloc(65537,32)); else emit({OSType:'linux',MemoryLimit:true,SwapLimit:true,CpuCfsPeriod:true,CpuCfsQuota:true,PidsLimit:true,SecurityOptions:['name=seccomp,profile=builtin','name=cgroupns'],...change.info}); }
-else if(args[0]==='image' && args[1]==='inspect') {
- emit([{Id:image,Os:'linux',Config:{Volumes:null,ExposedPorts:null,Env:['PATH=/usr/bin:/bin','DOTNET_EnableDiagnostics=0'],Labels:{'org.1hk.native-dwg-reader.protocol':'1hk-dwg-import/1'}},...change.image}]);
-} else if(args[0]==='create') {
- const nonce=args[args.indexOf('--name')+1].slice('1hk-dwg-read-'.length);
- const command=['--signal=KILL',Math.ceil(Number(args[args.indexOf(image)+2].replace('s','')))+'s','/usr/share/dotnet/dotnet','/app/DwgEngineQualification.dll','read-native-stdio'];
- // Literal daemon receipt: expectations are not computed with production policy.
- const s={Id:id,Name:'/1hk-dwg-read-'+nonce,Image:image,Platform:'linux',Path:'/usr/bin/timeout',Args:command,
- Config:{Image:image,User:'65532:65532',AttachStdin:true,AttachStdout:true,AttachStderr:true,OpenStdin:true,StdinOnce:false,Tty:false,Env:['PATH=/usr/bin:/bin','DOTNET_EnableDiagnostics=0'],Volumes:null,ExposedPorts:null,Entrypoint:['/usr/bin/timeout'],Cmd:command,Labels:{'org.1hk.native-dwg-reader.attempt':nonce}},
- HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapAdd:null,CapDrop:['ALL'],SecurityOpt:['no-new-privileges=true'],NanoCpus:1000000000,Memory:1073741824,MemorySwap:1073741824,PidsLimit:64,CgroupnsMode:'private',PidMode:'',IpcMode:'private',ShmSize:67108864,UTSMode:'',UsernsMode:'',Binds:null,Mounts:null,Devices:[],DeviceRequests:null,DeviceCgroupRules:null,VolumesFrom:null,PortBindings:{},PublishAllPorts:false,ExtraHosts:null,Links:null,RestartPolicy:{Name:'no',MaximumRetryCount:0},AutoRemove:false,Init:true,LogConfig:{Type:'none',Config:{}},Tmpfs:{'/tmp':'rw,noexec,nosuid,nodev,size=16777216'},Ulimits:[{Name:'core',Soft:0,Hard:0}]},
- Mounts:[],NetworkSettings:{Networks:{none:{}}},State:{Status:'created',Running:false,Paused:false,Restarting:false,Dead:false,OOMKilled:false,ExitCode:0,Error:''}};
- Object.assign(s.HostConfig,change.host); Object.assign(s.Config,change.config); Object.assign(s,change.container);
- save(s);
- if(mode==='lost-create') {process.stderr.write('private daemon details');process.exitCode=1;}
- else if(mode==='hang-create') setTimeout(()=>process.exit(1),3000);
- else if(mode==='bad-id') process.stdout.write('malformed receipt');
- else process.stdout.write(id+'\\n');
-} else if(args[0]==='container' && args[1]==='inspect') {
- if(!fs.existsSync(statePath)){process.stderr.write('No such container');process.exitCode=1;}
- else {const s=read(); if(s.started && mode==='foreign-cleanup') s.Config.Labels['org.1hk.native-dwg-reader.attempt']='f'.repeat(32); emit([s]);}
-} else if(args[0]==='start') {
- const s=read(); s.started=true; s.State.Status='exited'; Object.assign(s.State,change.state); save(s);
- let bytes=[]; for await (const chunk of process.stdin) bytes.push(chunk);
- fs.writeFileSync(${JSON.stringify(join(directory, "stdin.bin"))},Buffer.concat(bytes));
- if(mode==='hang-start') setTimeout(()=>process.exit(1),3000);
- else if(mode==='stdout-cap') process.stdout.write(Buffer.alloc(32*1024*1024+1,32));
- else if(mode==='stderr-cap') process.stderr.write(Buffer.alloc(65537,65));
- else if(mode==='utf8') process.stdout.write(Buffer.from([255]));
- else if(mode==='bom') {process.stdout.write(Buffer.from([239,187,191]));emit(${JSON.stringify(report)});}
- else if(mode==='unexpected-stderr') {process.stderr.write('unexpected native output');emit(${JSON.stringify(report)});}
- else if(mode==='nonzero') {emit(${JSON.stringify(report)});process.exitCode=1;}
- else emit({...${JSON.stringify(report)},...change.report});
-} else if(args[0]==='rm') {
- if(args.join(' ')!=='rm --force '+id) process.exit(72);
- if(mode==='remove-failure') process.exit(1);
- if(mode==='slow-remove') await new Promise(resolve=>setTimeout(resolve,400));
- if(mode==='replace-config') {fs.renameSync(configDirectory,configDirectory+'-owned');fs.mkdirSync(configDirectory);fs.writeFileSync(configDirectory+'/replacement-sentinel','keep');}
- fs.unlinkSync(statePath);process.stdout.write(id+'\\n');
-} else process.exit(73);
-`;
-  await writeFile(dockerPath, script);
-  await writeFile(
-    join(directory, "hostile-home-config.json"),
-    JSON.stringify({ auths: { "must-not-read": { auth: "private-fixture" } } }),
-  );
-  await chmod(dockerPath, 0o700);
-  return {
-    input: {
-      dockerPath,
-      dockerHost: `unix://${socket}`,
-      imageId,
-      sourceBytes: Buffer.from(sourceBytes),
-      expectedSource,
-      timeoutMilliseconds: 2500,
-    },
-    calls: async () =>
-      (await readFile(log, "utf8").catch(() => ""))
-        .trim()
-        .split("\n")
-        .filter(Boolean)
-        .map(JSON.parse),
-    stateExists: async () =>
-      readFile(state).then(
-        () => true,
-        () => false,
-      ),
-    stdin: () => readFile(join(directory, "stdin.bin")),
-    hostileHomeRead: () =>
-      access(join(directory, "hostile-home-read")).then(
-        () => true,
-        () => false,
-      ),
-  };
-}
-
 test("production create argv fixes confinement and the native command", async () => {
   const { nativeDwgSandboxCreateArguments: build } = await api();
   const args = build({
     imageId,
     nonce: "c".repeat(32),
     timeoutMilliseconds: 1001,
   });
   for (const flag of ["--read-only", "--init", "--interactive"])
     assert.ok(args.includes(flag));
   for (const [flag, value] of Object.entries({
     "--pull": "never",
     "--network": "none",
     "--user": "65532:65532",
     "--cap-drop": "ALL",
     "--security-opt": "no-new-privileges=true",
     "--cpus": "1",
     "--memory": "1073741824",
     "--memory-swap": "1073741824",
     "--pids-limit": "64",
     "--cgroupns": "private",

```

## platform/tests/fixtures/drawing-native-dwg-sandbox-transport.mjs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/fixtures/drawing-native-dwg-sandbox-transport.mjs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/fixtures/drawing-native-dwg-sandbox-transport.mjs
new file mode 100644
index 0000000..f43f09d
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/platform/tests/fixtures/drawing-native-dwg-sandbox-transport.mjs
@@ -0,0 +1,171 @@
+import {
+  access,
+  chmod,
+  mkdtemp,
+  readFile,
+  rm,
+  writeFile,
+} from "node:fs/promises";
+import { createHash } from "node:crypto";
+import { createServer } from "node:net";
+import { tmpdir } from "node:os";
+import { join } from "node:path";
+
+// These finite Docker CLI doubles test host validation/lifecycle only. Real
+// native parsing and Linux confinement are qualified in the integration suite.
+export const imageId = `sha256:${"a".repeat(64)}`;
+export const containerId = "b".repeat(64);
+export const sourceBytes = Buffer.from("AC1024finite-invalid-native-fixture");
+export const expectedSource = {
+  sha256: createHash("sha256").update(sourceBytes).digest("hex"),
+  byteSize: sourceBytes.length,
+  headerVersion: "AC1024",
+};
+export const report = {
+  schemaVersion: "1hk-dwg-import/1",
+  qualification: "experimental-unqualified",
+  source: expectedSource,
+  engine: { name: "ACadSharp", version: "3.7.1" },
+  coordinateSystem: "WCS_NATIVE_UNITS",
+  unitCode: 4,
+  modelSpaceHandle: "1F",
+  layers: [],
+  entities: [],
+  unsupported: [],
+  readerNotificationCount: 0,
+  coverage: {
+    modelSpaceEntities: 0,
+    importedEntities: 0,
+    unsupportedEntities: 0,
+    nonModelSpaceEntities: 0,
+  },
+};
+export async function transport(t, mode = "ok", change = {}, resave) {
+  const directory = await mkdtemp(join(tmpdir(), "dwg-sandbox-test-"));
+  const socket = join(directory, "docker.sock");
+  const server = createServer((connection) => connection.end());
+  await new Promise((resolve, reject) => {
+    server.once("error", reject);
+    server.listen(socket, resolve);
+  });
+  t.after(async () => {
+    await new Promise((resolve) => server.close(resolve));
+    await rm(directory, { recursive: true, force: true });
+  });
+  const dockerPath = join(directory, "docker");
+  const log = join(directory, "calls.jsonl");
+  const state = join(directory, "state.json");
+  const profile = resave
+    ? {
+        prefix: "1hk-dwg-resave-",
+        label: "org.1hk.native-dwg-resaver.attempt",
+        command: "resave-native-stdio",
+        memory: 2147483648,
+      }
+    : {
+        prefix: "1hk-dwg-read-",
+        label: "org.1hk.native-dwg-reader.attempt",
+        command: "read-native-stdio",
+        memory: 1073741824,
+      };
+  const script = `#!${process.execPath}
+import fs from 'node:fs';
+const args = process.argv.slice(2);
+let configDirectory,configEntries,configMode;
+if(args[0]==='--config') {
+ configDirectory=args[1];args.splice(0,2);
+ configEntries=fs.readdirSync(configDirectory);configMode=fs.statSync(configDirectory).mode & 511;
+} else if(${JSON.stringify(mode)}==='hostile-home') {
+ // Model Docker's documented passwd-home fallback without touching user config.
+ fs.readFileSync(${JSON.stringify(join(directory, "hostile-home-config.json"))});
+ fs.writeFileSync(${JSON.stringify(join(directory, "hostile-home-read"))},'read');
+}
+fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({args,env:process.env,configDirectory,configEntries,configMode})+'\\n');
+if (args[0] !== '--host' || args[1] !== ${JSON.stringify(`unix://${socket}`)}) process.exit(71);
+args.splice(0,2);
+const profile=${JSON.stringify(profile)}, resave=${JSON.stringify(resave)}, mode=${JSON.stringify(mode)}, change=${JSON.stringify(change)}, id=${JSON.stringify(containerId)}, image=${JSON.stringify(imageId)};
+const statePath=${JSON.stringify(state)};
+const read=()=>JSON.parse(fs.readFileSync(statePath,'utf8'));
+const save=(s)=>fs.writeFileSync(statePath,JSON.stringify(s));
+const emit=(v)=>process.stdout.write(JSON.stringify(v));
+if(args[0]==='info') { if(mode==='metadata-cap')process.stdout.write(Buffer.alloc(65537,32)); else emit({OSType:'linux',MemoryLimit:true,SwapLimit:true,CpuCfsPeriod:true,CpuCfsQuota:true,PidsLimit:true,SecurityOptions:['name=seccomp,profile=builtin','name=cgroupns'],...change.info}); }
+else if(args[0]==='image' && args[1]==='inspect') {
+ emit([{Id:image,Os:'linux',Config:{Volumes:null,ExposedPorts:null,Env:['PATH=/usr/bin:/bin','DOTNET_EnableDiagnostics=0'],Labels:{'org.1hk.native-dwg-reader.protocol':'1hk-dwg-import/1','org.1hk.native-dwg-resaver.protocol':'1hk-dwg-resave/1'}},...change.image}]);
+} else if(args[0]==='create') {
+ const nonce=args[args.indexOf('--name')+1].slice(profile.prefix.length);
+ const command=['--signal=KILL',Math.ceil(Number(args[args.indexOf(image)+2].replace('s','')))+'s','/usr/share/dotnet/dotnet','/app/DwgEngineQualification.dll',profile.command];
+ // Literal daemon receipt: expectations are not computed with production policy.
+ const s={Id:id,Name:'/'+profile.prefix+nonce,Image:image,Platform:'linux',Path:'/usr/bin/timeout',Args:command,
+ Config:{Image:image,User:'65532:65532',AttachStdin:true,AttachStdout:true,AttachStderr:true,OpenStdin:true,StdinOnce:false,Tty:false,Env:['PATH=/usr/bin:/bin','DOTNET_EnableDiagnostics=0'],Volumes:null,ExposedPorts:null,Entrypoint:['/usr/bin/timeout'],Cmd:command,Labels:{[profile.label]:nonce}},
+ HostConfig:{NetworkMode:'none',ReadonlyRootfs:true,Privileged:false,CapAdd:null,CapDrop:['ALL'],SecurityOpt:['no-new-privileges=true'],NanoCpus:1000000000,Memory:profile.memory,MemorySwap:profile.memory,PidsLimit:64,CgroupnsMode:'private',PidMode:'',IpcMode:'private',ShmSize:67108864,UTSMode:'',UsernsMode:'',Binds:null,Mounts:null,Devices:[],DeviceRequests:null,DeviceCgroupRules:null,VolumesFrom:null,PortBindings:{},PublishAllPorts:false,ExtraHosts:null,Links:null,RestartPolicy:{Name:'no',MaximumRetryCount:0},AutoRemove:false,Init:true,LogConfig:{Type:'none',Config:{}},Tmpfs:{'/tmp':'rw,noexec,nosuid,nodev,size=16777216'},Ulimits:[{Name:'core',Soft:0,Hard:0}]},
+ Mounts:[],NetworkSettings:{Networks:{none:{}}},State:{Status:'created',Running:false,Paused:false,Restarting:false,Dead:false,OOMKilled:false,ExitCode:0,Error:''}};
+ Object.assign(s.HostConfig,change.host); Object.assign(s.Config,change.config); Object.assign(s,change.container);
+ save(s);
+ if(mode==='lost-create') {process.stderr.write('private daemon details');process.exitCode=1;}
+ else if(mode==='hang-create') setTimeout(()=>process.exit(1),3000);
+ else if(mode==='bad-id') process.stdout.write('malformed receipt');
+ else process.stdout.write(id+'\\n');
+} else if(args[0]==='container' && args[1]==='inspect') {
+ if(!fs.existsSync(statePath)){process.stderr.write('No such container');process.exitCode=1;}
+ else {const s=read(); if(s.started && mode==='foreign-cleanup') s.Config.Labels[profile.label]='f'.repeat(32); emit([s]);}
+} else if(args[0]==='start') {
+ const s=read(); s.started=true; s.State.Status='exited'; Object.assign(s.State,change.state); save(s);
+ let bytes=[]; for await (const chunk of process.stdin) bytes.push(chunk);
+ fs.writeFileSync(${JSON.stringify(join(directory, "stdin.bin"))},Buffer.concat(bytes));
+ const emitReport=()=>{if(!resave) return emit({...${JSON.stringify(report)},...change.report}); const r=Buffer.from(JSON.stringify({...resave.report,...change.report}));const dwg=Buffer.from(resave.dwgHex,'hex');const h=Buffer.from([49,72,75,82,83,79,48,49,0,0,0,0,0,0,0,0]);h.writeUInt32BE(r.length,8);h.writeUInt32BE(dwg.length,12);process.stdout.write(Buffer.concat([h,r,dwg]));};
+ if(mode==='hang-start') setTimeout(()=>process.exit(1),3000);
+ else if(mode==='stdout-cap') process.stdout.write(Buffer.alloc(resave ? 16+201*1024*1024+1 : 32*1024*1024+1,32));
+ else if(mode==='stderr-cap') process.stderr.write(Buffer.alloc(65537,65));
+ else if(mode==='utf8') process.stdout.write(Buffer.from([255]));
+ else if(mode==='bom') {process.stdout.write(Buffer.from([239,187,191]));emitReport();}
+ else if(mode==='unexpected-stderr') {process.stderr.write('unexpected native output');emitReport();}
+ else if(mode==='nonzero') {emitReport();process.exitCode=1;}
+ else emitReport();
+} else if(args[0]==='rm') {
+ if(args.join(' ')!=='rm --force '+id) process.exit(72);
+ if(mode==='remove-failure') process.exit(1);
+ if(mode==='slow-remove') await new Promise(resolve=>setTimeout(resolve,400));
+ if(mode==='replace-config') {fs.renameSync(configDirectory,configDirectory+'-owned');fs.mkdirSync(configDirectory);fs.writeFileSync(configDirectory+'/replacement-sentinel','keep');}
+ fs.unlinkSync(statePath);process.stdout.write(id+'\\n');
+} else process.exit(73);
+`;
+  await writeFile(dockerPath, script);
+  await writeFile(
+    join(directory, "hostile-home-config.json"),
+    JSON.stringify({ auths: { "must-not-read": { auth: "private-fixture" } } }),
+  );
+  await chmod(dockerPath, 0o700);
+  return {
+    input: {
+      dockerPath,
+      dockerHost: `unix://${socket}`,
+      imageId,
+      sourceBytes: Buffer.from(sourceBytes),
+      expectedSource,
+      ...(resave
+        ? {
+            requestBytes: Buffer.from(resave.requestHex, "hex"),
+            expectedRequestSha256: resave.report.request.sha256,
+          }
+        : {}),
+      timeoutMilliseconds: 2500,
+    },
+    calls: async () =>
+      (await readFile(log, "utf8").catch(() => ""))
+        .trim()
+        .split("\n")
+        .filter(Boolean)
+        .map(JSON.parse),
+    stateExists: async () =>
+      readFile(state).then(
+        () => true,
+        () => false,
+      ),
+    stdin: () => readFile(join(directory, "stdin.bin")),
+    hostileHomeRead: () =>
+      access(join(directory, "hostile-home-read")).then(
+        () => true,
+        () => false,
+      ),
+  };
+}

```

## tools/dwg-engine-qualification/Dockerfile.reader

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/Dockerfile.reader b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/Dockerfile.reader
index 1d8d644..d26b85f 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/Dockerfile.reader
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/Dockerfile.reader
@@ -1,19 +1,20 @@
 FROM mcr.microsoft.com/dotnet/sdk:8.0-bookworm-slim@sha256:bb32ba3ba3ea36e38572d9d8db76fa15f7cbf722f3f886e06bca6d528bd4fba8 AS build
 
 WORKDIR /src
 COPY DwgEngineQualification.csproj packages.lock.json ./
 RUN dotnet restore DwgEngineQualification.csproj --locked-mode
 COPY *.cs ./
 COPY THIRD_PARTY_NOTICES.md ./
 RUN dotnet publish DwgEngineQualification.csproj --configuration Release --no-restore --output /out /p:UseAppHost=false
 
 FROM mcr.microsoft.com/dotnet/runtime:8.0-bookworm-slim@sha256:9d94ecf60a21c6e7a784cf0761fbd4a8391646617a0ff2f39621443d580cc2c3
 
 LABEL org.1hk.native-dwg-reader.protocol="1hk-dwg-import/1"
+LABEL org.1hk.native-dwg-resaver.protocol="1hk-dwg-resave/1"
 ENV DOTNET_EnableDiagnostics=0
 WORKDIR /app
 RUN test -x /usr/bin/timeout
 COPY --from=build /out/ ./
 COPY --from=build /src/THIRD_PARTY_NOTICES.md ./THIRD_PARTY_NOTICES.md
 USER 65532:65532
 ENTRYPOINT ["/usr/bin/timeout", "--signal=KILL", "120s", "/usr/share/dotnet/dotnet", "/app/DwgEngineQualification.dll", "read-native-stdio"]

```

## tools/dwg-engine-qualification/NativeDwgReader.cs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/NativeDwgReader.cs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/NativeDwgReader.cs
index 818d693..17e2ec9 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/NativeDwgReader.cs
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/NativeDwgReader.cs
@@ -59,59 +59,67 @@ internal static class NativeDwgReader
         }
     }
 
     public static int RunStream(Stream input, Stream output, TextWriter error)
     {
         try
         {
             var reportBytes = BuildReportBytes(ReadBoundedSource(input), out _);
             output.Write(reportBytes);
             return 0;
         }
         catch (Exception exception)
         {
             error.WriteLine("native stream read failed.");
             return exception is ArgumentException or InvalidDataException ? 2 : 1;
         }
     }
 
     private static byte[] BuildReportBytes(byte[] sourceBytes, out SourceIdentity source)
     {
-        source = SourceIdentity.Create(sourceBytes);
-        var notifications = 0;
-        CadDocument document;
-        using (var stream = new MemoryStream(sourceBytes, writable: false))
-        using (var reader = new DwgReader(stream))
-        {
-            reader.Configuration.Failsafe = false;
-            reader.Configuration.KeepUnknownEntities = true;
-            reader.Configuration.KeepUnknownNonGraphicalObjects = true;
-            reader.OnNotification += (_, _) => notifications++;
-            document = reader.Read();
-        }
-
+        var document = ReadSource(sourceBytes, out source, out var notifications);
         var reportBytes = JsonSerializer.SerializeToUtf8Bytes(BuildReport(document, source, notifications), JsonOptions);
         if (reportBytes.Length > MaximumReportBytes)
             throw new InvalidDataException("DWG import report budget exceeded.");
         return reportBytes;
     }
 
+    internal static CadDocument ReadValidatedSource(byte[] sourceBytes, out SourceIdentity source)
+    {
+        var document = ReadSource(sourceBytes, out source, out var notifications);
+        _ = BuildReport(document, source, notifications);
+        return document;
+    }
+
+    private static CadDocument ReadSource(byte[] sourceBytes, out SourceIdentity source, out int notificationCount)
+    {
+        if (sourceBytes.Length < 6 || sourceBytes.LongLength > MaximumSourceBytes)
+            throw new InvalidDataException("DWG source size is unsupported.");
+        ValidateHeader(sourceBytes);
+        source = SourceIdentity.Create(sourceBytes);
+        var notifications = 0;
+        using var stream = new MemoryStream(sourceBytes, writable: false);
+        var document = QualificationRunner.ReadDocument(stream, _ => notifications++);
+        notificationCount = notifications;
+        return document;
+    }
+
     private static object BuildReport(CadDocument document, SourceIdentity source, int notificationCount)
     {
         if (document.Header.VersionString != source.HeaderVersion)
             throw new InvalidDataException("DWG header version is inconsistent.");
         if (document.Layers.Count() > MaximumLayers)
             throw new InvalidDataException("DWG layer budget exceeded.");
 
         var modelSpace = document.ModelSpace
             ?? throw new InvalidDataException("DWG model space is missing.");
         var modelSpaceHandle = CanonicalHandle(modelSpace.Handle);
         var layers = document.Layers.OrderBy(layer => layer.Handle).ToArray();
         var layerHandles = new HashSet<ulong>();
         var identityHandles = new HashSet<ulong>();
         var layerRecords = new List<object>(layers.Length);
         foreach (var layer in layers)
         {
             ValidateIdentity(layer.Handle, layerHandles, "layer");
             if (!identityHandles.Add(layer.Handle))
                 throw new InvalidDataException("DWG object identities are duplicated.");
             ValidateBoundedText(layer.Name, 255, allowEmpty: false);
@@ -500,28 +508,28 @@ internal static class NativeDwgReader
             var character = value[index];
             if (char.IsControl(character) || char.GetUnicodeCategory(character) is
                 UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
                 throw new InvalidDataException("DWG text identity is invalid.");
             if (char.IsHighSurrogate(character))
             {
                 if (++index >= value.Length || !char.IsLowSurrogate(value[index]))
                     throw new InvalidDataException("DWG text identity is invalid.");
             }
             else if (char.IsLowSurrogate(character))
                 throw new InvalidDataException("DWG text identity is invalid.");
         }
     }
 
     private sealed class UnsupportedAccumulator
     {
         public int Count { get; set; }
         public List<string> SampleHandles { get; } = [];
     }
 
-    private sealed record SourceIdentity(string Sha256, long ByteSize, string HeaderVersion)
+    internal sealed record SourceIdentity(string Sha256, long ByteSize, string HeaderVersion)
     {
         public static SourceIdentity Create(byte[] bytes) => new(
             Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
             bytes.LongLength,
             Encoding.ASCII.GetString(bytes, 0, 6));
     }
 }

```

## tools/dwg-engine-qualification/NativeDwgResaveSelfTests.cs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/NativeDwgResaveSelfTests.cs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/NativeDwgResaveSelfTests.cs
new file mode 100644
index 0000000..4b2dfc3
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/NativeDwgResaveSelfTests.cs
@@ -0,0 +1,333 @@
+using System.Buffers.Binary;
+using System.Diagnostics;
+using System.Reflection;
+using System.Security.Cryptography;
+using System.Text;
+using System.Text.Json;
+using System.Text.Json.Nodes;
+using ACadSharp;
+using ACadSharp.Entities;
+using ACadSharp.IO;
+using ACadSharp.Tables;
+using ACadSharp.Types.Units;
+using CSMath;
+
+namespace DwgEngineQualification;
+
+internal static class NativeDwgResaveSelfTests
+{
+    internal static void DetectsPassiveViewportChanges()
+    {
+        var document = new CadDocument(ACadVersion.AC1024);
+        var viewport = document.BlockRecords.SelectMany(block => block.Entities).OfType<Viewport>().Single();
+        viewport.Center = new XYZ(10, 20, 0);
+        viewport.Width = 200;
+        viewport.Height = 100;
+        viewport.ViewHeight = 500;
+        var first = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
+        var second = new Line(new XYZ(0, 1, 0), new XYZ(10, 1, 0));
+        document.Entities.Add(first);
+        document.Entities.Add(second);
+        viewport.Boundary = first;
+        CadInventory Snapshot() => QualificationRunner.Inventory(document, new List<string>());
+        var baseline = Snapshot();
+        Assert(baseline.Diagnostics!.Count == 0, "ordinary viewport has supported passive inventory");
+        var handle = viewport.Handle.ToString("X");
+        Assert(baseline.Entities.Single(entity => entity.Handle == handle).Geometry.Contains("center=10,20,0;width=200;height=100;"), "literal stored viewport geometry");
+        void Changed(string field) => Assert(SemanticComparer.Compare(baseline, Snapshot(), ExpectedEdits.None, 1e-9).Failures.Contains($"untouched entity {handle} {field} changed"), "detect changed viewport " + field);
+        viewport.Width = 201;
+        Changed("geometry");
+        viewport.Width = 200;
+        viewport.StyleSheetName = "plot-2.ctb";
+        Changed("reference");
+        viewport.StyleSheetName = null;
+        viewport.Boundary = second;
+        Changed("reference");
+        viewport.Boundary = first;
+        typeof(CadObject).GetProperty(nameof(CadObject.Owner))!.SetValue(viewport, document.ModelSpace);
+        Changed("owner");
+    }
+
+    internal static void ResavesChunkedNonSeekableInput()
+    {
+        var (source, request) = Fixture();
+        using var input = new ChunkedReadStream(Frame(request, source));
+        using var output = new MemoryStream();
+        using var error = new StringWriter();
+        Assert(NativeDwgResaver.RunStream(input, output, error) == 0, "chunked resave succeeds");
+        Assert(error.ToString().Length == 0, "chunked resave has no stderr");
+        VerifySuccess(source, request, output.ToArray());
+    }
+
+    internal static void RejectsMalformedFramesAndRequests()
+    {
+        var (source, request) = Fixture();
+        var valid = Frame(request, source);
+        for (var length = 0; length < 16; length++) Reject(valid[..length], "truncated header " + length);
+        Reject(valid[..^1], "truncated source");
+        Reject(valid[..20], "truncated request");
+        Reject([.. valid, 0], "trailing byte");
+        var wrongMagic = valid.ToArray();
+        wrongMagic[7] = (byte)'2';
+        Reject(wrongMagic, "wrong protocol magic/version");
+        foreach (var (requestLength, sourceLength) in new (uint, uint)[]
+        {
+            (0, 6), (2097153, 6), (uint.MaxValue, 6), (1, 0), (1, 5), (1, 209715201), (1, uint.MaxValue),
+        })
+        {
+            var header = valid[..16];
+            BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(8, 4), requestLength);
+            BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(12, 4), sourceLength);
+            using var input = new ChunkedReadStream(header, failAfterEnd: true);
+            Reject(input, "declared length rejected before reading/allocating payload");
+            Assert(!input.ReadPastEnd, "invalid declared length never reads payload");
+        }
+        Reject(Frame([0xFF], source), "invalid UTF-8");
+        Reject(Frame([239, 187, 191, .. request], source), "UTF-8 BOM");
+        Reject(Frame(Encoding.UTF8.GetBytes(Encoding.UTF8.GetString(request).Replace("\"schemaVersion\":", "\"schemaVersion\":\"1hk-dwg-edits/2\",\"schemaVersion\":")), source), "duplicate JSON keys");
+        void InvalidRequest(Action<JsonObject> mutate, string name)
+        {
+            var json = JsonNode.Parse(request)!.AsObject();
+            mutate(json);
+            Reject(Frame(JsonSerializer.SerializeToUtf8Bytes(json), source), name);
+        }
+        InvalidRequest(json => json["schemaVersion"] = "1hk-dwg-edits/1", "version 1");
+        // A genuinely valid v1 LINE request must also be rejected by this command.
+        InvalidRequest(json => { json["schemaVersion"] = "1hk-dwg-edits/1"; json["edits"] = new JsonArray(json["edits"]![1]!.DeepClone()); }, "valid v1 request");
+        InvalidRequest(json => json["sourceSha256"] = new string('0', 64), "stale source hash");
+        InvalidRequest(json => json["edits"] = new JsonArray(), "no implicit edit for empty request");
+        InvalidRequest(json => json["edits"]![1]!["handle"] = "FFFFFFFFFFFFFFFF", "invalid batch target");
+        InvalidRequest(json => json["edits"]![1]!["handle"] = json["edits"]![0]!["handle"]!.DeepClone(), "duplicate target");
+        InvalidRequest(json => json["edits"]![1]!["start"]![2] = 1, "nonplanar edit");
+        foreach (var corrupt in new[] { "ZZ1024"u8.ToArray(), "AC1024"u8.ToArray(), source[..(source.Length / 2)] })
+        {
+            var json = JsonNode.Parse(request)!.AsObject();
+            json["sourceSha256"] = Sha(corrupt);
+            Reject(Frame(JsonSerializer.SerializeToUtf8Bytes(json), corrupt), "malformed native source");
+        }
+        var extraArgs = RunCli(valid, "unexpected");
+        Assert(extraArgs.ExitCode != 0 && extraArgs.Output.Length == 0 && extraArgs.Error == "native stream resave failed.\n", "extra CLI arguments are rejected generically");
+    }
+
+    internal static void RejectsInventoryGapsAndIneligibleSources()
+    {
+        foreach (var customize in new Action<CadDocument>[]
+        {
+            doc => doc.Entities.Add(new ACadSharp.Entities.Point()),
+            doc => doc.BlockRecords.Single(block => block.Name == "UNTOUCHED_BLOCK").BlockEntity.XRefPath = "https://invalid.example/private-source.dwg",
+            doc => doc.Entities.OfType<Line>().Last().Normal = new XYZ(0, 1, 0),
+        })
+        {
+            var (source, request) = Fixture(customize);
+            Reject(Frame(request, source), "gap/xref/ineligible selected geometry");
+        }
+    }
+
+    internal static void BoundsOutputMemoryBeforeGrowth()
+    {
+        using var stream = new NativeDwgResaver.BoundedMemoryStream(17);
+        stream.Write(new byte[16]);
+        stream.WriteByte(1);
+        Assert(stream.Length == 17 && stream.Capacity <= 17, "output accepts exact byte budget without oversized backing array");
+        foreach (var write in new Action[] { () => stream.WriteByte(0), () => stream.Write(new byte[1]), () => stream.Write(new byte[1], 0, 1), () => stream.SetLength(18) })
+        {
+            var rejected = false;
+            try { write(); } catch (InvalidDataException) { rejected = true; }
+            Assert(rejected && stream.Length == 17 && stream.Capacity <= 17, "output overflow rejected before growth");
+        }
+    }
+
+    private static void Reject(byte[] frame, string name)
+    {
+        using var input = new ChunkedReadStream(frame);
+        Reject(input, name);
+    }
+
+    private static void Reject(Stream input, string name)
+    {
+        using var output = new MemoryStream();
+        using var error = new StringWriter();
+        Assert(NativeDwgResaver.RunStream(input, output, error) != 0, name + " rejects");
+        Assert(output.Length == 0, name + " publishes no success bytes");
+        Assert(error.ToString() == "native stream resave failed.\n", name + " fixed diagnostic");
+    }
+
+    private sealed class ChunkedReadStream(byte[] bytes, bool failAfterEnd = false) : Stream
+    {
+        private int position;
+        internal bool ReadPastEnd { get; private set; }
+        public override bool CanRead => true;
+        public override bool CanSeek => false;
+        public override bool CanWrite => false;
+        public override long Length => throw new NotSupportedException();
+        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
+        public override void Flush() { }
+        public override int Read(byte[] buffer, int offset, int count)
+        {
+            if (position == bytes.Length && failAfterEnd) { ReadPastEnd = true; throw new InvalidOperationException("Payload must not be read"); }
+            var length = Math.Min(Math.Min(5, count), bytes.Length - position);
+            bytes.AsSpan(position, length).CopyTo(buffer.AsSpan(offset, length));
+            position += length;
+            return length;
+        }
+        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
+        public override void SetLength(long value) => throw new NotSupportedException();
+        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
+    }
+
+    // Catches an absent CLI command, implicit first-entity edits, incorrect geometry,
+    // extra public fields, unbound hashes and incomplete binary publication.
+    internal static void CliResavesExactRequestedGeometry()
+    {
+        var (source, request) = Fixture();
+        var sourceBefore = source.ToArray();
+        var requestBefore = request.ToArray();
+        var (exitCode, frame, error) = RunCli(Frame(request, source));
+        Assert(exitCode == 0, $"resave CLI succeeds (exit={exitCode}, stderr={error.Trim()})");
+        Assert(error.Length == 0, "successful resave has no stderr");
+        VerifySuccess(source, request, frame);
+        Assert(source.SequenceEqual(sourceBefore) && request.SequenceEqual(requestBefore), "caller bytes unchanged");
+    }
+
+    private static void VerifySuccess(byte[] source, byte[] request, byte[] frame)
+    {
+        Assert(frame.Length >= 16 && frame.AsSpan(0, 8).SequenceEqual("1HKRSO01"u8), "resave output magic");
+        var reportLength = checked((int)BinaryPrimitives.ReadUInt32BigEndian(frame.AsSpan(8, 4)));
+        var dwgLength = checked((int)BinaryPrimitives.ReadUInt32BigEndian(frame.AsSpan(12, 4)));
+        Assert(reportLength is >= 1 and <= 1048576 && dwgLength is >= 6 and <= 209715200, "output budgets");
+        Assert(frame.Length == 16 + reportLength + dwgLength, "exact complete output frame");
+        var reportBytes = frame.AsSpan(16, reportLength).ToArray();
+        _ = new UTF8Encoding(false, true).GetString(reportBytes);
+        Assert(!reportBytes.AsSpan().StartsWith(new byte[] { 239, 187, 191 }), "report has no BOM");
+        using var report = JsonDocument.Parse(reportBytes);
+        var root = report.RootElement;
+        Keys(root, "schemaVersion", "qualification", "persistenceAuthority", "source", "request", "output", "engine", "verification");
+        Assert(root.GetProperty("schemaVersion").GetString() == "1hk-dwg-resave/1", "literal report schema");
+        Assert(root.GetProperty("qualification").GetString() == "experimental-unqualified", "literal qualification");
+        Assert(root.GetProperty("persistenceAuthority").GetString() == "not-issued", "no authority issued");
+        var dwg = frame.AsSpan(16 + reportLength, dwgLength).ToArray();
+        foreach (var (name, bytes) in new[] { ("source", source), ("output", dwg) })
+        {
+            var identity = root.GetProperty(name);
+            Keys(identity, "sha256", "byteSize", "headerVersion");
+            Assert(identity.GetProperty("sha256").GetString() == Sha(bytes), name + " exact hash");
+            Assert(identity.GetProperty("byteSize").GetInt32() == bytes.Length, name + " exact byte size");
+            Assert(identity.GetProperty("headerVersion").GetString() == "AC1024", name + " literal header");
+        }
+        var requestReport = root.GetProperty("request");
+        Keys(requestReport, "schemaVersion", "sha256", "byteSize", "handles");
+        Assert(requestReport.GetProperty("schemaVersion").GetString() == "1hk-dwg-edits/2", "v2 report");
+        Assert(requestReport.GetProperty("sha256").GetString() == Sha(request), "exact request hash");
+        Assert(requestReport.GetProperty("byteSize").GetInt32() == request.Length, "exact request size");
+        using var parsedRequest = JsonDocument.Parse(request);
+        var handles = parsedRequest.RootElement.GetProperty("edits").EnumerateArray().Select(edit => edit.GetProperty("handle").GetString()!).ToArray();
+        Assert(requestReport.GetProperty("handles").EnumerateArray().Select(item => item.GetString()).SequenceEqual(handles), "request handle order");
+        var engine = root.GetProperty("engine");
+        Keys(engine, "name", "version");
+        Assert(engine.GetProperty("name").GetString() == "ACadSharp" && engine.GetProperty("version").GetString() == "3.7.1", "pinned engine");
+        var verification = root.GetProperty("verification");
+        Keys(verification, "noEditRoundTrip", "selectedEditRoundTrip", "geometryTolerance", "inventoriedEntityCount", "editedEntityCount", "inventoryCoverage", "independentCad");
+        Assert(verification.GetProperty("noEditRoundTrip").GetString() == "passed", "no-edit verification");
+        Assert(verification.GetProperty("selectedEditRoundTrip").GetString() == "passed", "selected verification");
+        Assert(verification.GetProperty("geometryTolerance").GetDouble() == 1e-9, "geometry tolerance");
+        Assert(verification.GetProperty("editedEntityCount").GetInt32() == 6, "six edited entities");
+        Assert(verification.GetProperty("inventoriedEntityCount").GetInt32() == 9, "full model, viewport and block inventory");
+        Assert(verification.GetProperty("inventoryCoverage").GetString() == "supported-fields-only", "inventory limitation");
+        Assert(verification.GetProperty("independentCad").GetString() == "not-performed", "no independent qualification");
+
+        using var stream = new MemoryStream(dwg);
+        using var reader = new DwgReader(stream);
+        reader.Configuration.Failsafe = false;
+        var document = reader.Read();
+        Entity Selected(int index) => document.Entities.Single(entity => entity.Handle.ToString("X") == handles[index]);
+        var text = (TextEntity)Selected(0);
+        Assert(text.InsertPoint == new XYZ(18, 20, 0) && text.Height == 4 && text.Value == "선택 문자 v2", "literal TEXT result");
+        var line = (Line)Selected(1);
+        Assert(line.StartPoint == new XYZ(2, 4, 0) && line.EndPoint == new XYZ(175, 35, 0), "literal requested LINE end");
+        var polyline = (LwPolyline)Selected(2);
+        Assert(polyline.IsClosed && polyline.Flags.HasFlag(LwPolylineFlags.Plinegen) && polyline.Vertices.Count == 3, "polyline closure and metadata");
+        Assert(polyline.Vertices[0].Location == new XY(3, 5) && polyline.Vertices[1].Location == new XY(7, 11) && polyline.Vertices[2].Location == new XY(13, 5), "literal polyline vertices");
+        var circle = (Circle)Selected(3);
+        Assert(circle.Center == new XYZ(12, 14, 0) && circle.Radius == 7, "literal circle");
+        var wrapped = (Arc)Selected(4);
+        Assert(wrapped.Center == new XYZ(30, 35, 0) && wrapped.Radius == 9 && wrapped.StartAngle == 5.5 && wrapped.EndAngle == 1.25, "literal wrapped arc");
+        var fullTurn = (Arc)Selected(5);
+        Assert(fullTurn.Center == new XYZ(50, 55, 0) && fullTurn.Radius == 11 && fullTurn.StartAngle == 0 && fullTurn.EndAngle == 6.283185307179586, "literal full-turn arc");
+        var untouched = document.Entities.OfType<Line>().Single(entity => entity.Handle.ToString("X") != handles[1]);
+        Assert(untouched.StartPoint == new XYZ(70, 75, 0) && untouched.EndPoint == new XYZ(80, 85, 0), "first LINE untouched");
+        var blockLine = document.BlockRecords.Single(block => block.Name == "UNTOUCHED_BLOCK").Entities.OfType<Line>().Single();
+        Assert(blockLine.StartPoint == new XYZ(1, 1, 0) && blockLine.EndPoint == new XYZ(5, 1, 0), "block geometry untouched");
+        Assert(document.Header.InsUnits == UnitsType.Millimeters, "source units preserved");
+        Assert(document.BlockRecords.SelectMany(block => block.Entities).OfType<Viewport>().Single().RepresentsPaper, "ordinary paper viewport retained");
+    }
+
+    private static (byte[] Source, byte[] Request) Fixture(Action<CadDocument>? customize = null)
+    {
+        var document = new CadDocument(ACadVersion.AC1024);
+        document.Header.InsUnits = UnitsType.Millimeters;
+        document.Entities.Add(new Line(new XYZ(70, 75, 0), new XYZ(80, 85, 0)));
+        var line = new Line(new XYZ(0, 0, 0), new XYZ(10, 0, 0));
+        var polyline = new LwPolyline([new XY(0, 10), new XY(10, 15), new XY(20, 10)]) { Flags = LwPolylineFlags.Plinegen };
+        var circle = new Circle(new XYZ(20, 20, 0), 5);
+        var wrapped = new Arc(new XYZ(30, 30, 0), 6, 5, 1);
+        var fullTurn = new Arc(new XYZ(50, 50, 0), 8, 0, 6.283185307179586);
+        var text = new TextEntity { InsertPoint = new XYZ(10, 20, 0), Height = 3, Value = "EDIT ME" };
+        foreach (var entity in new Entity[] { line, polyline, circle, wrapped, fullTurn, text }) document.Entities.Add(entity);
+        var blockRecord = new BlockRecord("UNTOUCHED_BLOCK");
+        blockRecord.Entities.Add(new Line(new XYZ(1, 1, 0), new XYZ(5, 1, 0)));
+        document.BlockRecords.Add(blockRecord);
+        customize?.Invoke(document);
+        using var output = new MemoryStream();
+        using (var writer = new DwgWriter(output, document)) writer.Write();
+        var source = output.ToArray();
+        var request = JsonSerializer.SerializeToUtf8Bytes(new
+        {
+            schemaVersion = "1hk-dwg-edits/2", sourceSha256 = Sha(source), coordinateSystem = "WCS_NATIVE_UNITS",
+            edits = new object[]
+            {
+                new { handle = text.Handle.ToString("X"), type = "TEXT", insert = new[] { 18, 20, 0 }, height = 4, text = "선택 문자 v2" },
+                new { handle = line.Handle.ToString("X"), type = "LINE", start = new[] { 2, 4, 0 }, end = new[] { 175, 35, 0 } },
+                new { handle = polyline.Handle.ToString("X"), type = "LWPOLYLINE", points = new[] { new[] { 3, 5, 0 }, new[] { 7, 11, 0 }, new[] { 13, 5, 0 } }, closed = true },
+                new { handle = circle.Handle.ToString("X"), type = "CIRCLE", center = new[] { 12, 14, 0 }, radius = 7 },
+                new { handle = wrapped.Handle.ToString("X"), type = "ARC", center = new[] { 30, 35, 0 }, radius = 9, startAngleRadians = 5.5, endAngleRadians = 1.25 },
+                new { handle = fullTurn.Handle.ToString("X"), type = "ARC", center = new[] { 50, 55, 0 }, radius = 11, startAngleRadians = 0d, endAngleRadians = 6.283185307179586 },
+            },
+        });
+        return (source, request);
+    }
+
+    private static byte[] Frame(byte[] request, byte[] source)
+    {
+        var frame = new byte[16 + request.Length + source.Length];
+        "1HKRSV01"u8.CopyTo(frame);
+        BinaryPrimitives.WriteUInt32BigEndian(frame.AsSpan(8, 4), (uint)request.Length);
+        BinaryPrimitives.WriteUInt32BigEndian(frame.AsSpan(12, 4), (uint)source.Length);
+        request.CopyTo(frame, 16);
+        source.CopyTo(frame, 16 + request.Length);
+        return frame;
+    }
+
+    private static (int ExitCode, byte[] Output, string Error) RunCli(byte[] input, params string[] extraArguments)
+    {
+        var executable = Environment.ProcessPath!;
+        var start = new ProcessStartInfo(executable) { RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, UseShellExecute = false };
+        if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
+            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
+        start.ArgumentList.Add("resave-native-stdio");
+        foreach (var argument in extraArguments) start.ArgumentList.Add(argument);
+        using var process = Process.Start(start)!;
+        using var output = new MemoryStream();
+        var outputCopy = process.StandardOutput.BaseStream.CopyToAsync(output);
+        var errorRead = process.StandardError.ReadToEndAsync();
+        try { process.StandardInput.BaseStream.Write(input); }
+        catch (IOException) { /* The pre-implementation CLI closes stdin on an unknown command. */ }
+        process.StandardInput.Close();
+        if (!process.WaitForExit(30_000)) { process.Kill(entireProcessTree: true); throw new InvalidOperationException("resave CLI timeout"); }
+        outputCopy.GetAwaiter().GetResult();
+        return (process.ExitCode, output.ToArray(), errorRead.GetAwaiter().GetResult());
+    }
+
+    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
+    private static void Keys(JsonElement value, params string[] keys) => Assert(value.EnumerateObject().Select(property => property.Name).Order().SequenceEqual(keys.Order()), "strict public report fields");
+    private static void Assert(bool condition, string label) { if (!condition) throw new InvalidOperationException(label); }
+}

```

## tools/dwg-engine-qualification/NativeDwgResaver.cs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/NativeDwgResaver.cs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/NativeDwgResaver.cs
new file mode 100644
index 0000000..b8a41b6
--- /dev/null
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/NativeDwgResaver.cs
@@ -0,0 +1,131 @@
+using System.Buffers.Binary;
+using System.Security.Cryptography;
+using System.Text.Json;
+using ACadSharp;
+
+namespace DwgEngineQualification;
+
+internal static class NativeDwgResaver
+{
+    private const int MaximumRequestBytes = 2_097_152;
+    private const int MaximumDwgBytes = 209_715_200;
+    private const int MaximumReportBytes = 1_048_576;
+    private const double GeometryTolerance = 1e-9;
+    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
+
+    public static int RunStream(Stream input, Stream output, TextWriter error)
+    {
+        try
+        {
+            Span<byte> header = stackalloc byte[16];
+            input.ReadExactly(header);
+            if (!header[..8].SequenceEqual("1HKRSV01"u8)) throw new InvalidDataException();
+            var requestLength = BinaryPrimitives.ReadUInt32BigEndian(header[8..12]);
+            var sourceLength = BinaryPrimitives.ReadUInt32BigEndian(header[12..16]);
+            if (requestLength is < 1 or > MaximumRequestBytes || sourceLength is < 6 or > MaximumDwgBytes)
+                throw new InvalidDataException();
+            var requestBytes = new byte[(int)requestLength];
+            var sourceBytes = new byte[(int)sourceLength];
+            input.ReadExactly(requestBytes);
+            input.ReadExactly(sourceBytes);
+            if (input.ReadByte() != -1) throw new InvalidDataException();
+
+            var request = SelectedDwgEdits.Load(requestBytes);
+            if (!request.IsVersion2) throw new InvalidDataException();
+            var sourceSha = Sha(sourceBytes);
+            if (request.Evidence.SourceSha256 != sourceSha) throw new InvalidDataException();
+            var document = NativeDwgReader.ReadValidatedSource(sourceBytes, out var source);
+            var baseline = Inventory(document);
+            // Compare complete inventories without granting exemptions to selected handles.
+            var noEdit = RoundTrip(document, out _, out _);
+            RequireEqual(baseline, noEdit);
+            request.Apply(document, sourceSha);
+            var expected = Inventory(document);
+            var reread = RoundTrip(document, out var outputBytes, out var outputIdentity);
+            RequireEqual(expected, reread);
+            if (source.HeaderVersion != outputIdentity.HeaderVersion
+                || source.Sha256 != sourceSha || Sha(sourceBytes) != sourceSha
+                || Sha(requestBytes) != request.Evidence.Sha256)
+                throw new InvalidDataException();
+
+            using var report = new BoundedMemoryStream(MaximumReportBytes);
+            JsonSerializer.Serialize(report, new
+            {
+                schemaVersion = "1hk-dwg-resave/1",
+                qualification = "experimental-unqualified",
+                persistenceAuthority = "not-issued",
+                source,
+                request = new
+                {
+                    schemaVersion = "1hk-dwg-edits/2", sha256 = request.Evidence.Sha256,
+                    byteSize = requestBytes.Length, handles = request.Evidence.Handles,
+                },
+                output = outputIdentity,
+                engine = new { name = "ACadSharp", version = "3.7.1" },
+                verification = new
+                {
+                    noEditRoundTrip = "passed", selectedEditRoundTrip = "passed",
+                    geometryTolerance = GeometryTolerance, inventoriedEntityCount = baseline.Entities.Count,
+                    editedEntityCount = request.Evidence.Handles.Count,
+                    inventoryCoverage = "supported-fields-only", independentCad = "not-performed",
+                },
+            }, JsonOptions);
+            var reportBytes = report.ToArray();
+            if (reportBytes.Length < 1) throw new InvalidDataException();
+            "1HKRSO01"u8.CopyTo(header);
+            BinaryPrimitives.WriteUInt32BigEndian(header[8..12], (uint)reportBytes.Length);
+            BinaryPrimitives.WriteUInt32BigEndian(header[12..16], (uint)outputBytes.Length);
+            // Native/request failures above publish nothing. A transport failure here
+            // can leave an incomplete frame; consumers must reject it and the nonzero exit.
+            output.Write(header);
+            output.Write(reportBytes);
+            output.Write(outputBytes);
+            return 0;
+        }
+        catch (Exception exception)
+        {
+            error.WriteLine("native stream resave failed.");
+            return exception is ArgumentException or InvalidDataException ? 2 : 1;
+        }
+    }
+
+    private static CadInventory Inventory(CadDocument document)
+    {
+        QualificationRunner.RejectUnwritableObjects(document);
+        var diagnostics = new List<string>();
+        var inventory = QualificationRunner.Inventory(document, diagnostics);
+        if (inventory.Entities.Count is < 1 or > 10_000 || inventory.Diagnostics?.Count > 0)
+            throw new InvalidDataException();
+        return inventory;
+    }
+
+    private static CadInventory RoundTrip(CadDocument document, out byte[] bytes, out NativeDwgReader.SourceIdentity identity)
+    {
+        using var stream = new BoundedMemoryStream(MaximumDwgBytes);
+        QualificationRunner.WriteDocument(stream, document, _ => { });
+        bytes = stream.ToArray();
+        return Inventory(NativeDwgReader.ReadValidatedSource(bytes, out identity));
+    }
+
+    private static void RequireEqual(CadInventory expected, CadInventory actual)
+    {
+        if (SemanticComparer.Compare(expected, actual, ExpectedEdits.None, GeometryTolerance).Failures.Count != 0)
+            throw new InvalidDataException();
+    }
+
+    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
+
+    // Cap both logical writes and backing-array growth (MemoryStream normally doubles).
+    internal sealed class BoundedMemoryStream(int maximumBytes) : MemoryStream
+    {
+        private void Reserve(long end)
+        {
+            if (end < 0 || end > maximumBytes) throw new InvalidDataException();
+            if (end > Capacity) Capacity = (int)Math.Min(maximumBytes, Math.Max(end, Math.Max(256L, (long)Capacity * 2)));
+        }
+        public override void Write(byte[] buffer, int offset, int count) { Reserve(checked(Position + count)); base.Write(buffer, offset, count); }
+        public override void Write(ReadOnlySpan<byte> buffer) { Reserve(checked(Position + buffer.Length)); base.Write(buffer); }
+        public override void WriteByte(byte value) { Reserve(checked(Position + 1)); base.WriteByte(value); }
+        public override void SetLength(long value) { Reserve(value); base.SetLength(value); }
+    }
+}

```

## tools/dwg-engine-qualification/Program.cs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/Program.cs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/Program.cs
index ff514a0..8a84b3c 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/Program.cs
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/Program.cs
@@ -4,52 +4,61 @@ internal static class Program
 {
     public static int Main(string[] args)
     {
         if (args is ["self-test"])
         {
             return SelfTests.Run(Console.Out);
         }
 
         if (TryOption(args, "self-test-native", "--input-dir", out var inputDirectory))
             return NativeDwgSelfTests.Run(inputDirectory, Console.Out);
 
         if (TryOptions(args, "write-native", "--input", "--output-dir", out var manifest, out var nativeOutputDirectory))
             return NativeDwgWriter.Run(manifest, nativeOutputDirectory, Console.Out, Console.Error);
 
         if (TryOptions(args, "read-native", "--input", "--output-dir", out var nativeInput, out var nativeReadOutputDirectory))
             return NativeDwgReader.Run(nativeInput, nativeReadOutputDirectory, Console.Out, Console.Error);
 
         if (args is ["read-native-stdio"])
             return NativeDwgReader.RunStream(Console.OpenStandardInput(), Console.OpenStandardOutput(), Console.Error);
 
+        if (args is ["resave-native-stdio"])
+            return NativeDwgResaver.RunStream(Console.OpenStandardInput(), Console.OpenStandardOutput(), Console.Error);
+        if (args.Length > 0 && args[0] == "resave-native-stdio")
+        {
+            Console.Error.WriteLine("native stream resave failed.");
+            return 2;
+        }
+
         if (TryOption(args, "create-generated-fixture", "--output-dir", out var fixtureDirectory))
             return QualificationRunner.CreateGeneratedFixture(fixtureDirectory, Console.Out, Console.Error);
 
         if (TryQualificationOptions(args, out var input, out var outputDirectory, out var edits))
             return QualificationRunner.Qualify(input, outputDirectory, Console.Out, Console.Error, edits);
 
         Console.Error.WriteLine("Usage:");
         Console.Error.WriteLine("  dwg-engine-qualification self-test");
         Console.Error.WriteLine("  dwg-engine-qualification self-test-native --input-dir <four-manifest-directory>");
         Console.Error.WriteLine("  dwg-engine-qualification write-native --input <manifest.json> --output-dir <new-directory>");
         Console.Error.WriteLine("  dwg-engine-qualification read-native --input <source.dwg> --output-dir <new-directory>");
         Console.Error.WriteLine("  dwg-engine-qualification read-native-stdio");
+        Console.Error.WriteLine("  dwg-engine-qualification resave-native-stdio");
         Console.Error.WriteLine("  dwg-engine-qualification create-generated-fixture --output-dir <directory>");
         Console.Error.WriteLine("  dwg-engine-qualification qualify --input <input.dwg> --output-dir <directory> [--edits <request.json>]");
         return 2;
     }
 
     private static bool TryQualificationOptions(string[] args, out string input, out string output, out string? edits)
     {
         input = output = string.Empty;
         edits = null;
         if (args.Length is not (5 or 7) || args[0] != "qualify") return false;
         var values = new Dictionary<string, string>(StringComparer.Ordinal);
         for (var i = 1; i < args.Length; i += 2)
             if (args[i] is not ("--input" or "--output-dir" or "--edits")
                 || string.IsNullOrWhiteSpace(args[i + 1]) || !values.TryAdd(args[i], args[i + 1])) return false;
         values.TryGetValue("--edits", out edits);
         return values.TryGetValue("--input", out input!) && values.TryGetValue("--output-dir", out output!);
     }
 
     private static bool TryOption(string[] args, string command, string option, out string value)
     {

```

## tools/dwg-engine-qualification/QualificationRunner.cs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/QualificationRunner.cs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/QualificationRunner.cs
index 0e5951a..b07294d 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/QualificationRunner.cs
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/QualificationRunner.cs
@@ -259,45 +259,51 @@ internal static class QualificationRunner
 
         var block = new BlockRecord("QA_ORDINARY_BLOCK");
         block.Entities.Add(new Line(new XYZ(0, 0, 0), new XYZ(8, 0, 0)) { Layer = geometryLayer });
         block.Entities.Add(new Circle(new XYZ(4, 4, 0), 2) { Layer = geometryLayer });
         document.BlockRecords.Add(block);
         document.Entities.Add(new Insert(block)
         {
             InsertPoint = new XYZ(70, 30, 0),
             XScale = 1.5,
             YScale = 1.5,
             ZScale = 1,
             Rotation = 0.2,
             Layer = geometryLayer,
         });
 
         return document;
     }
 
     private static CadDocument ReadDocument(string path, ICollection<string> diagnostics)
     {
-        using var reader = new DwgReader(path);
+        using var stream = File.OpenRead(path);
+        return ReadDocument(stream, message => diagnostics.Add($"reader: {message}"));
+    }
+
+    internal static CadDocument ReadDocument(Stream stream, Action<string> notification)
+    {
+        using var reader = new DwgReader(stream);
         reader.Configuration.Failsafe = false;
         reader.Configuration.KeepUnknownEntities = true;
         reader.Configuration.KeepUnknownNonGraphicalObjects = true;
-        reader.OnNotification += (_, notification) => diagnostics.Add($"reader: {notification.Message}");
+        reader.OnNotification += (_, item) => notification(item.Message);
         return reader.Read();
     }
 
     internal static void RejectUnwritableObjects(CadDocument document)
     {
         // ACadSharp 3.7.1 exposes lookup by handle but no public registry enumeration.
         // Scan its verified registry, not only root/block collections: extension
         // dictionaries, table objects and owned entities may also retain unknowns.
         var pending = new Stack<CadObject>(RetainedObjects(document).Values.OfType<CadObject>());
         var visited = new HashSet<CadObject>(ReferenceEqualityComparer.Instance);
         while (pending.TryPop(out var item))
         {
             if (!visited.Add(item)) continue;
             if (item is UnknownEntity or UnknownNonGraphicalObject)
                 throw new InvalidDataException("DWG v2 edits reject retained unknown graphical or non-graphical objects.");
             if (item is LwPolyline polyline && polyline.Vertices.Any(vertex => vertex.Id != 0))
                 throw new InvalidDataException("DWG v2 edits reject retained polyline vertex identifiers that the pinned writer discards.");
             // Also follow reachable attachments; identity tracking bounds cycles.
             if (item.XDictionary is not null) pending.Push(item.XDictionary);
             foreach (var reactor in item.Reactors) pending.Push(reactor);
@@ -309,42 +315,48 @@ internal static class QualificationRunner
     private static IReadOnlyDictionary<ulong, IHandledCadObject> RetainedObjects(CadDocument document)
     {
         try
         {
             return RegisteredObjects(document)
                 ?? throw new InvalidDataException("The pinned DWG object registry is unavailable.");
         }
         catch (Exception exception) when (exception is MemberAccessException or TypeLoadException)
         {
             throw new InvalidDataException("The pinned DWG object registry cannot be inspected; v2 writing is disabled.", exception);
         }
     }
 
     // Exact ACadSharp 3.7.1 field type. Access/shape changes fail closed above;
     // no reflection or scan over potentially sparse, unbounded handle numbers.
     [UnsafeAccessor(UnsafeAccessorKind.Field, Name = "_cadObjects")]
     private static extern ref Dictionary<ulong, IHandledCadObject> RegisteredObjects(CadDocument document);
 
     private static void WriteDocument(string path, CadDocument document, ICollection<string> diagnostics)
     {
-        using var writer = new DwgWriter(path, document);
-        writer.OnNotification += (_, notification) => diagnostics.Add($"writer: {notification.Message}");
+        using var stream = new FileStream(path, FileMode.Create, FileAccess.Write);
+        WriteDocument(stream, document, message => diagnostics.Add($"writer: {message}"));
+    }
+
+    internal static void WriteDocument(Stream stream, CadDocument document, Action<string> notification)
+    {
+        using var writer = new DwgWriter(stream, document);
+        writer.OnNotification += (_, item) => notification(item.Message);
         writer.Write();
     }
 
     internal static CadInventory Inventory(CadDocument document, ICollection<string> diagnostics)
     {
         var entityDiagnostics = new List<string>();
         var entityGroups = document.BlockRecords
             .SelectMany(block => block.Entities)
             .GroupBy(entity => entity.Handle)
             .ToArray();
         foreach (var duplicate in entityGroups.Where(group => group.Count() > 1))
             entityDiagnostics.Add($"duplicate entity handle {Handle(duplicate.Key)} occurs {duplicate.Count()} times");
         var entities = entityGroups
             .SelectMany(group => group)
             .OrderBy(entity => entity.Handle)
             .Select(entity => InventoryEntity(entity, entityDiagnostics))
             .ToArray();
         foreach (var message in entityDiagnostics) diagnostics.Add(message);
 
         var blocks = document.BlockRecords
@@ -377,58 +389,95 @@ internal static class QualificationRunner
             entities,
             document.Header.InsUnits.ToString(),
             document.Header.VersionString,
             document.Layers.Select(layer => $"{Handle(layer.Handle)}|{layer.Name}").OrderBy(value => value, StringComparer.Ordinal).ToArray(),
             blocks,
             layouts,
             styles,
             entityDiagnostics);
     }
 
     internal static EntityInventory InventoryEntity(Entity entity, ICollection<string> diagnostics)
     {
         var geometry = entity switch
         {
             Line line => $"start={Point(line.StartPoint)};end={Point(line.EndPoint)};thickness={Number(line.Thickness)};normal={Point(line.Normal)}",
             Arc arc => $"center={Point(arc.Center)};radius={Number(arc.Radius)};startAngle={Number(arc.StartAngle)};endAngle={Number(arc.EndAngle)};thickness={Number(arc.Thickness)};normal={Point(arc.Normal)}",
             Circle circle => $"center={Point(circle.Center)};radius={Number(circle.Radius)};thickness={Number(circle.Thickness)};normal={Point(circle.Normal)}",
             LwPolyline polyline => $"closed={polyline.IsClosed};flags={polyline.Flags};elevation={Number(polyline.Elevation)};normal={Point(polyline.Normal)};thickness={Number(polyline.Thickness)};constantWidth={Number(polyline.ConstantWidth)};vertices={string.Join("/", polyline.Vertices.Select(vertex => $"{Point(vertex.Location)}:{Number(vertex.Bulge)}:{Number(vertex.StartWidth)}:{Number(vertex.EndWidth)}"))}",
             TextEntity text => $"insert={Point(text.InsertPoint)};alignment={Point(text.AlignmentPoint)};normal={Point(text.Normal)};height={Number(text.Height)};rotation={Number(text.Rotation)};horizontal={text.HorizontalAlignment};vertical={text.VerticalAlignment};oblique={Number(text.ObliqueAngle)};widthFactor={Number(text.WidthFactor)};mirror={text.Mirror};thickness={Number(text.Thickness)};style={text.Style?.Name}",
             Insert insert => InventoryInsert(insert, diagnostics),
+            Viewport viewport => InventoryViewport(viewport),
             _ => UnsupportedGeometry(entity, diagnostics),
         };
 
         return new EntityInventory(
             Handle(entity.Handle),
             entity.ObjectName,
             entity.Owner is null ? "0" : Handle(entity.Owner.Handle),
             entity.Layer?.Name ?? "<missing>",
             geometry,
             entity is TextEntity textEntity ? textEntity.Value : null,
             entity switch
             {
                 TextEntity text when text.Style is not null => $"{Handle(text.Style.Handle)}:{text.Style.Name}",
                 Insert insert when insert.Block is not null => $"{Handle(insert.Block.Handle)}:{insert.Block.Name}",
+                Viewport viewport => JsonSerializer.Serialize(new
+                {
+                    viewport.StyleSheetName,
+                    boundary = viewport.Boundary is null ? null : Handle(viewport.Boundary.Handle),
+                    frozenLayers = viewport.FrozenLayers.Select(layer => $"{Handle(layer.Handle)}:{layer.Name}").Order(StringComparer.Ordinal).ToArray(),
+                    visualStyle = viewport.VisualStyle is null ? null : Handle(viewport.VisualStyle.Handle),
+                    scale = viewport.Scale is null ? null : $"{Handle(viewport.Scale.Handle)}:{viewport.Scale.Name}",
+                }),
                 _ => null,
             });
     }
 
+    private static string InventoryViewport(Viewport viewport)
+    {
+        // Intrinsic fields only: default paper viewports have undefined derived scale/width.
+        // References and plot names are in the exact Reference field, never numeric-tolerant geometry.
+        var values = new[]
+        {
+            viewport.Center.X, viewport.Center.Y, viewport.Center.Z, viewport.Width, viewport.Height,
+            viewport.ViewCenter.X, viewport.ViewCenter.Y, viewport.ViewHeight,
+            viewport.ViewDirection.X, viewport.ViewDirection.Y, viewport.ViewDirection.Z,
+            viewport.ViewTarget.X, viewport.ViewTarget.Y, viewport.ViewTarget.Z,
+            viewport.TwistAngle, viewport.FrontClipPlane, viewport.BackClipPlane, viewport.LensLength,
+            viewport.UcsOrigin.X, viewport.UcsOrigin.Y, viewport.UcsOrigin.Z,
+            viewport.UcsXAxis.X, viewport.UcsXAxis.Y, viewport.UcsXAxis.Z,
+            viewport.UcsYAxis.X, viewport.UcsYAxis.Y, viewport.UcsYAxis.Z, viewport.Elevation,
+            viewport.SnapAngle, viewport.SnapBase.X, viewport.SnapBase.Y,
+            viewport.SnapSpacing.X, viewport.SnapSpacing.Y, viewport.GridSpacing.X, viewport.GridSpacing.Y,
+            viewport.Brightness, viewport.Contrast,
+        };
+        if (values.Any(value => !double.IsFinite(value))) throw new InvalidDataException("DWG viewport inventory is non-finite.");
+        return $"center={Point(viewport.Center)};width={Number(viewport.Width)};height={Number(viewport.Height)};"
+            + $"viewCenter={Point(viewport.ViewCenter)};viewHeight={Number(viewport.ViewHeight)};viewDirection={Point(viewport.ViewDirection)};viewTarget={Point(viewport.ViewTarget)};"
+            + $"twist={Number(viewport.TwistAngle)};frontClip={Number(viewport.FrontClipPlane)};backClip={Number(viewport.BackClipPlane)};lens={Number(viewport.LensLength)};"
+            + $"id={viewport.Id};paper={viewport.RepresentsPaper};active={viewport.ActiveStatus};status={viewport.Status};"
+            + $"ucsOrigin={Point(viewport.UcsOrigin)};ucsX={Point(viewport.UcsXAxis)};ucsY={Point(viewport.UcsYAxis)};ucsType={viewport.UcsOrthographicType};ucsPerViewport={viewport.UcsPerViewport};ucsIcon={viewport.DisplayUcsIcon};elevation={Number(viewport.Elevation)};"
+            + $"snapAngle={Number(viewport.SnapAngle)};snapBase={Point(viewport.SnapBase)};snapSpacing={Point(viewport.SnapSpacing)};gridSpacing={Point(viewport.GridSpacing)};gridFrequency={viewport.MajorGridLineFrequency};circleZoom={viewport.CircleZoomPercent};"
+            + $"shadePlot={viewport.ShadePlotMode};render={viewport.RenderMode};defaultLighting={viewport.UseDefaultLighting};lightingType={viewport.DefaultLightingType};brightness={Number(viewport.Brightness)};contrast={Number(viewport.Contrast)};ambient={viewport.AmbientLightColor}";
+    }
+
     private static string InventoryInsert(Insert insert, ICollection<string> diagnostics)
     {
         if (insert.Attributes.Count > 0)
             diagnostics.Add($"unsupported inventory fields for INSERT handle {Handle(insert.Handle)}: attribute tags, values, geometry, and ownership");
 
         return $"block={insert.Block?.Name};insert={Point(insert.InsertPoint)};normal={Point(insert.Normal)};scale={Number(insert.XScale)},{Number(insert.YScale)},{Number(insert.ZScale)};rotation={Number(insert.Rotation)};rows={insert.RowCount}:{Number(insert.RowSpacing)};columns={insert.ColumnCount}:{Number(insert.ColumnSpacing)};attributes={insert.Attributes.Count}";
     }
 
     private static string UnsupportedGeometry(Entity entity, ICollection<string> diagnostics)
     {
         diagnostics.Add($"unsupported inventory fields for {entity.ObjectName} handle {Handle(entity.Handle)}");
         return $"unsupported-type={entity.GetType().FullName}";
     }
 
     private static void RejectExternalReferences(CadInventory inventory)
     {
         var external = (inventory.Blocks ?? [])
             .Where(block => !string.IsNullOrWhiteSpace(block.ExternalReferencePath)
                 || block.Flags.Contains(nameof(BlockTypeFlags.XRef), StringComparison.Ordinal))
             .Select(block => block.Name)

```

## tools/dwg-engine-qualification/README.md

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/README.md b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/README.md
index 7d39fb5..474ebf0 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/README.md
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/README.md
@@ -50,40 +50,56 @@ The import report retains native model-space handles, owner and layer identities
 
 `write-native` is the strict internal consumer of `1hk-native-cad/1`. It maps all declared LINE, LWPOLYLINE, CIRCLE, ARC, MTEXT, aligned DIMENSION, HATCH and ordinary block/INSERT variants directly to AC1024 entities in millimeters, creates the authored paper layout/model viewport, writes `native.dwg`, and compares a fresh engine read-back with input intent. It also writes the exact input bytes to `source-manifest.json` and a bounded `native-report.json`. The output directory must be a fresh explicit directory; no output, existing path, file, directory, symlink, or input is overwritten. Exit `0` means only that this same-engine semantic comparison passed, exit `2` is validation/path rejection, and exit `1` is an engine/write/read/report/comparison failure.
 
 The native parser rejects unknown or duplicate consumed JSON fields, malformed Unicode/JSON, non-finite or inconsistent geometry, invalid identities/references/lineage, nested INSERTs, wrong fixed policies/profile/viewport dimensions, unsafe MTEXT `%%` or `%<` control sequences, opacity values that round outside ACadSharp's explicit-alpha representation, native MTEXT spacing factors outside `0.25..4`, and the declared byte/node/entity/point/block/hatch budgets before CAD allocation. Derived spacing, transform, rotation, viewport and dimension values must be finite before the output directory is created; otherwise the command returns validation exit `2`. Each block's conservative local bounds are calculated once across every allowed primitive, including curved radii and authored text/dimension extents; every INSERT then checks the four signed/rotated/nonuniform bounds corners after multiplication and origin addition against the same ±999,999,999,999 coordinate domain used by authored points. This keeps validation linear in block geometry plus INSERT count and rejects rather than clamps unrepresentable extents. Finite rotations are reduced modulo 360 before radians without collapsing a full-circle ARC sweep. `metadata.structure` is retained byte-for-byte as bounded opaque producer evidence; it is not independently authenticated or re-projected in C#. The trusted application remains responsible for schema/projection validation against its immutable server-loaded source.
 
 Entity true RGB is stored directly. Paper lineweights and HATCH opacity are mapped to ACadSharp's supported native values with requested/stored diagnostics in the report. Canonical dimensionless text `lineHeight` maps to Exact native spacing by `lineHeight * 3 / 5` (`1.2` becomes `0.72`; a 140 mm font retains a 168 mm baseline distance). Solid polygon and circular HATCH boundaries, planar modifiers, signed/nonuniform INSERT basis and zero block base point, literal escaped Korean/newline/backslash/brace MTEXT, horizontal top-left dimension text, all generated arrow corners and child ownership/layer/styles, signed/diagonal extension geometry, ordinary editable blocks, and custom geometrically consistent paper profiles are checked after read-back. The named Noto Sans KR font is neither opened nor embedded. Exactly four copies of the pinned ACadSharp missing `TableStyle.CellStyle` text-style reader notification and zero writer notifications are retained; any different text or cardinality fails. Public failure reports use bounded error codes/messages and omit raw local paths.
 
 Every native-writer report remains `qualification: experimental-unqualified`, `productionDwgDeliveryQualification: not-qualified`, `independentCadVerification: not-performed`, and `canonicalSourceValidation: producer-required`. Font-dependent MTEXT wrapping/rendering, independent CAD visual/open/save/print verification, complete existing-DWG edit/preservation support, licensed customer corpus/fonts/Xrefs/plot styles, recipient acceptance, and final DWG/PDF/dependency delivery packages remain open gates. Approved-native authenticated jobs/leases/receipts now exist separately in the application; they do not provide imported-DWG authority.
 
 The qualification command requires an explicit input file and explicit output directory. Existing path components are resolved to their physical targets before checking bounds, so a symlink alias cannot disguise an input/output collision. The input must be outside the resolved output directory. Existing files, directories and output symlinks are refused. Hash/copy/read/write failures stay inside the bounded command error path; a JSON failure report is attempted, and an unwritable report is itself reported without an unhandled exception. The command copies input bytes to `input-working-copy.dwg`, hashes original/copy/original-after, and writes only these separate bounded artifacts:
 
 - `no-edit-roundtrip.dwg`
 - `edited-roundtrip.dwg` (only with a valid explicit edit request)
 - `edit-request.json` (exact request bytes, only when requested)
 - `qualification-report.json`
 
 It does not resolve or open external-reference paths. Any detected Xref causes rejection.
 
 ## Explicit edits to an existing DWG copy
 
+`resave-native-stdio` accepts exactly one framed request and source, with no path arguments:
+
+```sh
+dotnet DwgEngineQualification.dll resave-native-stdio < request-and-source.frame > report-and-dwg.frame
+```
+
+Input framing is `1HKRSV01` (8 ASCII bytes), request length and source length (two unsigned 32-bit big-endian integers), exact request bytes, exact original DWG bytes, and EOF. Request size is 1–2,097,152 bytes, strict UTF-8 without BOM, and only `1hk-dwg-edits/2` is accepted. Source size is 6–209,715,200 bytes with an `AC` plus four-digit header. Lengths are checked before payload allocation; truncation, trailing bytes, malformed JSON/Unicode, duplicate keys/handles, stale source hashes, empty or invalid batches and ineligible targets fail closed. All existing v2 geometry/point/entity/layer limits apply.
+
+Success framing is `1HKRSO01`, report length then output DWG length in the same big-endian encoding, exact UTF-8 JSON report, and exact output DWG bytes. The report is 1–1,048,576 bytes and output DWG is 6–209,715,200 bytes; memory-stream writes and backing-array growth are bounded. Nothing is published until the existing native reader validates source/output, complete supported inventories have no explicit gaps, and both no-edit and exact requested-edit readbacks pass `SemanticComparer` at absolute tolerance `1e-9`, without selected-handle exemptions. Xrefs, retained unknown objects and lossy nonzero lightweight-polyline vertex IDs remain rejected. Source units/header and untouched inventoried entities are preserved.
+
+The exact public report has `schemaVersion: "1hk-dwg-resave/1"`, `qualification: "experimental-unqualified"`, `persistenceAuthority: "not-issued"`, source/request/output SHA-256 and byte-size identities, source/output headers, ordered request handles, pinned engine identity, and the two passed verification statuses/counts/tolerance. Its coverage is `supported-fields-only`; independent CAD is `not-performed`. It includes no paths, raw diagnostics or source text. Every failure returns nonzero and only `native stream resave failed.` plus newline on stderr. Native/request failures emit no success bytes; a transport write failure can leave a partial frame, which callers must reject along with any nonzero exit or stderr.
+
+Ordinary paper VIEWPORTs remain present. Passive inventory compares stored center/size, view center/height/direction/target, twist/clipping/lens, status/active state, UCS, snap/grid, render/lighting settings, and exact plot-style name and boundary/frozen-layer/visual-style/scale references. Derived `ScaleFactor` and `ViewWidth` are not compared because defaults divide by zero; their stored inputs are compared. Referenced visual-style/scale payloads, general appearance, extended data and full layout/plot settings are not completely inventoried. Other explicitly unhandled entity types still reject resave. This is preservation checking of supported fields, not editable VIEWPORT support or independent CAD qualification.
+
+`Dockerfile.reader` advertises both reader and resaver protocol labels while retaining its existing reader entrypoint and package pins. The framed command alone does not provide sandboxing, persistence authority, jobs, downloadable receipts or recipient qualification; the host must apply the isolated execution profile. Native self-tests include actual binary CLI and chunked stream success, literal geometry/hashes, passive viewport mutation detection, rejected frames/requests and output bounds.
+
 `qualify` without `--edits` now performs **only** the no-edit round trip. It never chooses or modifies the first LINE/TEXT. Its report supplies the source SHA and entity handles for preparing an explicit request; `editedInventory`, `editedRoundTrip`, and `editRequest` are null and no edited DWG is emitted.
 
 Supply `--edits <request.json>` to the same command, using a new output directory. Request v1 has exactly `schemaVersion`, `sourceSha256`, `coordinateSystem`, and `edits`. Replace the hash and handles below with identities from the actual source, not another drawing:
 
 ```json
 {
   "schemaVersion": "1hk-dwg-edits/1",
   "sourceSha256": "<actual lowercase SHA-256 of input.dwg>",
   "coordinateSystem": "WCS_NATIVE_UNITS",
   "edits": [
     {"handle": "2F", "type": "LINE", "start": [0, 0, 0], "end": [125, 0, 0]},
     {"handle": "30", "type": "TEXT", "text": "수정된 실명"}
   ]
 }
 ```
 
 The request is capped at 2 MiB and 1–10,000 distinct canonical uppercase hex handles. LINE replaces only its two WCS endpoints in the source's existing units (three finite coordinates each, absolute limit 999,999,999,999; no zero-length result). TEXT replaces only a plain single-line value, up to 10,000 UTF-16 code units; controls, line separators, malformed Unicode and CAD `%%`/`%<` expressions are rejected. Unknown/duplicate JSON fields, wrong schema, stale source hashes, missing/wrong-type targets, block-definition and paper-space targets are rejected. All targets are validated before any entity is mutated. This v1 edit profile is not a claim that other entity/layout edit operations are complete.
 
 Request v2 keeps the same exact root fields and changes `schemaVersion` to `1hk-dwg-edits/2`. Each edit has one of these exact shapes:
 
@@ -96,27 +112,27 @@ Request v2 keeps the same exact root fields and changes `schemaVersion` to `1hk-
 ```
 
 V2 accepts only exact runtime LINE, LWPOLYLINE, CIRCLE, ARC and TEXT model-space targets that already satisfy the native reader profile and still satisfy it after the prospective edit: planar Z=0, default normal, zero thickness, straight zero-width lightweight polylines, and plain default-aligned text. Points and scalar values are finite with absolute value at most 999,999,999,999; radii and text height are positive; LINE endpoints differ; and LWPOLYLINE has at least two points with at least two distinct positions. Edited polylines contain at most 100,000 aggregate request points, and the resulting document must also remain within the reader's 100,000-vertex budget across edited, untouched, model-space, block and unsupported `IPolyline` entities. Changing lightweight-polyline vertices and closure retains its existing PLINEGEN flag.
 
 ARC stores the supplied raw start/end pair without modulo normalization. Its raw difference must be nonzero with absolute value at most `2π`, so wrapped pairs and an exact `0→2π` full turn remain valid. V2 TEXT must be nonempty and uses the same 10,000-UTF-16-unit plain-text restrictions as above. All payloads, source geometry and targets are checked on detached candidates before any retained source entity is mutated.
 
 Qualification reads use failsafe recovery disabled and retain unknown graphical and non-graphical objects. Because the pinned ACadSharp writers do not retain their payload, any retained `UnknownEntity` or `UnknownNonGraphicalObject` rejects a v2 request before either round-trip DWG is written. This check scans the complete retained-object registry, including entity/table/block extension dictionaries, and follows dictionary/reactor attachments with cycle protection. ACadSharp 3.7.1 has no public registry enumeration; the check uses one .NET 8 `UnsafeAccessor` for its verified `Dictionary<ulong, IHandledCadObject> _cadObjects` field. An unavailable or changed registry fails closed before writing, so engine upgrades require revalidation.
 
 The pinned writer also drops lightweight-polyline vertex identifiers. V2 therefore rejects any retained LWPOLYLINE with a nonzero vertex ID, including untouched model, block and paper-space polylines. This is a known engine limitation, not a vertex-ID preservation claim. Eligible edits retain corresponding vertex objects and their metadata by index: closure-only and same-count edits keep existing vertices, growth appends default vertices, and shrinkage removes only omitted trailing vertices. V1 behavior remains unchanged, including nonplanar LINE endpoint edits and retained LINE thickness.
 
 Exact request bytes are retained as `edit-request.json`; their SHA, source SHA, selected handles and output DWG hashes are in the report. A fresh read-back is compared with the full *currently inventoried* expected state after only those requested field assignments; selected handles do not exempt an entire geometry field from validation. Input and working-copy bytes are rehashed after the run. Exit 2 denotes rejected input/request/path, 1 an engine/write/read/comparison failure, and 0 only the internal supported comparison (which may still explicitly have inventory gaps).
 
 This CLI does not authenticate input provenance or application permissions. Browser DWG import/mapping/operation/approved-resave integration, isolated writer execution and downloadable receipts, an unknown-object engine strategy, complete appearance/attributes/layout/XData preservation, a licensed customer-file corpus, and independent recipient CAD checks remain required. Do not expose this internal CLI as an authorized customer-edit endpoint. The separate approved-native application job implementation is documented in `platform/native-dwg-worker/README.md`; it does not consume imported DWG requests.
 
 ## What is inventoried and compared
 
 The JSON records DWG version and insertion units; layer identities; block, layout and text-style/font metadata; entity handle, type, owner, layer and supported geometry/text fields; reader/writer notifications; and explicit inventory gaps. Geometry coverage includes line/circle/arc normals and thickness, polyline normal/thickness/constant and vertex widths, text insertion/alignment/normal/orientation fields, and insert normal/array orientation data. Duplicate handles are reported as anomalies instead of silently collapsed. No-edit comparison requires every inventoried entity and document identity to remain stable. Edit comparison checks every inventoried field against the state after only the explicitly requested endpoint/text assignments, with no whole-geometry exemption for selected entities. Geometry numbers use an absolute tolerance of `1e-9`, declared in the report before comparison.
 
 TEXT style and INSERT block references additionally record the referenced handle and name in an exactly compared field. Digits within identifiers are not interpreted as tolerantly equal geometry values.
 
-The generated AC1024 fixture contains model-space line, lightweight polyline, circle, arc and text entities on named layers, plus an ordinary block containing a line and circle and an insert referencing it. Default objects such as the paper-space viewport are retained and any unsupported field inventory is reported rather than converted into a success boolean.
+The generated AC1024 fixture contains model-space line, lightweight polyline, circle, arc and text entities on named layers, plus an ordinary block containing a line and circle and an insert referencing it. Default paper-space viewports are retained and passively inventoried. Any other explicit unsupported field inventory remains reported by `qualify` and rejected by framed resave.
 
 ## Interpretation
 
 `internalSyntheticResult: passed` means only the supported synthetic inventory survived this same-engine round-trip. `passed-with-inventory-gaps` means those comparisons passed but at least one encountered type was only identified, not semantically inventoried. `productionDwgDeliveryQualification` remains `not-qualified` regardless.
 
 Release gates outside this tool include a licensed 30-file corpus spanning accepted DWG versions/entities, independent AutoCAD or another explicitly accepted CAD open/save/visual checks, fonts/SHX and Xref policy/corpus, print/layout review, quota/role enforcement in the application, source-hash lineage integration, and named recipient acceptance.

```

## tools/dwg-engine-qualification/SelectedDwgEdits.cs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/SelectedDwgEdits.cs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/SelectedDwgEdits.cs
index 207eb07..3d45e70 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/SelectedDwgEdits.cs
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/SelectedDwgEdits.cs
@@ -18,64 +18,71 @@ internal sealed record SelectedDwgEdit(
     XYZ? Center = null,
     double? Radius = null,
     double? StartAngleRadians = null,
     double? EndAngleRadians = null,
     XYZ? Insert = null,
     double? Height = null,
     string? Text = null);
 
 internal sealed record DwgEditRequestEvidence(string Sha256, string SourceSha256, IReadOnlyList<string> Handles);
 
 // The source hash fixes handle identity; coordinates are WCS in the source's native units.
 // This is an internal engine request, never proof of app authorization or recipient qualification.
 internal sealed class SelectedDwgEdits
 {
     private const int MaximumBytes = 2 * 1024 * 1024;
     private const int MaximumPolylinePoints = 100_000;
     private const double MaximumNumber = 999_999_999_999d;
     private static readonly UTF8Encoding StrictUtf8 = new(false, true);
     internal byte[] Bytes { get; }
     internal DwgEditRequestEvidence Evidence { get; }
-    private bool IsVersion2 { get; }
+    internal bool IsVersion2 { get; }
     private IReadOnlyList<SelectedDwgEdit> Edits { get; }
 
     private SelectedDwgEdits(
         byte[] bytes,
         string sourceSha256,
         bool isVersion2,
         IReadOnlyList<SelectedDwgEdit> edits)
     {
         Bytes = bytes;
         IsVersion2 = isVersion2;
         Edits = edits;
         Evidence = new DwgEditRequestEvidence(
             Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), sourceSha256,
             edits.Select(edit => edit.Handle.ToString("X", CultureInfo.InvariantCulture)).ToArray());
     }
 
     internal static SelectedDwgEdits Load(string path)
     {
         using var stream = File.OpenRead(path);
         if (stream.Length > MaximumBytes) throw new InvalidDataException("DWG edit request exceeds 2 MiB.");
         var bytes = new byte[checked((int)stream.Length)];
         stream.ReadExactly(bytes);
         if (stream.ReadByte() != -1) throw new InvalidDataException("DWG edit request changed while reading.");
+        return Load(bytes);
+    }
+
+    internal static SelectedDwgEdits Load(byte[] bytes)
+    {
+        if (bytes.Length is < 1 or > MaximumBytes)
+            throw new InvalidDataException("DWG edit request size is unsupported.");
         _ = StrictUtf8.GetString(bytes);
         using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 8 });
         var root = ExactObject(json.RootElement, "schemaVersion", "sourceSha256", "coordinateSystem", "edits");
         var version = String(root.GetProperty("schemaVersion"));
         var isVersion2 = version switch
         {
             "1hk-dwg-edits/1" => false,
             "1hk-dwg-edits/2" => true,
             _ => throw new InvalidDataException("DWG edit schema is unsupported."),
         };
         if (String(root.GetProperty("coordinateSystem")) != "WCS_NATIVE_UNITS")
             throw new InvalidDataException("DWG edit coordinate policy is unsupported.");
         var sourceSha = String(root.GetProperty("sourceSha256"));
         if (sourceSha.Length != 64 || sourceSha.Any(c => !(c is >= '0' and <= '9' or >= 'a' and <= 'f')))
             throw new InvalidDataException("DWG edit source SHA-256 is invalid.");
         var items = root.GetProperty("edits");
         if (items.ValueKind != JsonValueKind.Array || items.GetArrayLength() is < 1 or > 10_000)
             throw new InvalidDataException("DWG edit count must be between 1 and 10000.");
 
         var handles = new HashSet<ulong>();

```

## tools/dwg-engine-qualification/SelfTests.cs

```diff
diff --git a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/SelfTests.cs b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/SelfTests.cs
index 8c41986..56d76c0 100644
--- a/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/baseline-code/tools/dwg-engine-qualification/SelfTests.cs
+++ b/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/.superpowers/sdd/2026-09-06-native-dwg-resave-protocol/accepted-unit-code/tools/dwg-engine-qualification/SelfTests.cs
@@ -29,40 +29,46 @@ internal static class SelfTests
             ("rejects lossy retained polyline vertex identifiers before mutation", SelectedDwgGeometrySelfTests.RejectsLossyVertexIdentifiersBeforeMutation),
             ("rejects invalid v2 payloads and reader-ineligible targets atomically", SelectedDwgGeometrySelfTests.RejectsInvalidV2PayloadsAndTargets),
             ("rejects malformed and over-budget v2 requests", SelectedDwgGeometrySelfTests.RejectsV2BudgetsAndMalformedText),
             ("rejects retained unknown objects before mutating v2 targets", SelectedDwgGeometrySelfTests.RejectsRetainedUnknownObjectsBeforeMutation),
             ("rejects resulting document point overflow before mutating v2 targets", SelectedDwgGeometrySelfTests.RejectsResultingDocumentPointOverflowBeforeMutation),
             ("detects an unrequested LINE normal change", SelectedDwgEditSelfTests.DetectsLineNormalChange),
             ("detects a switch between similarly numbered style and block references", SelectedDwgEditSelfTests.DetectsReferenceChange),
             ("reads literal native geometry and preserves source bytes", NativeDwgReaderSelfTests.ReadsRealDwgGeometryAndPreservesSource),
             ("counts unsupported native geometry without fabrication", NativeDwgReaderSelfTests.CountsUnsupportedGeometryWithoutFabrication),
             ("keeps attribute definitions out of plain TEXT import", NativeDwgReaderSelfTests.KeepsAttributeDefinitionsOutOfPlainTextImport),
             ("rejects malformed native input and existing output", NativeDwgReaderSelfTests.RejectsMalformedInputAndExistingOutput),
             ("rejects external DWG references without producing output", NativeDwgReaderSelfTests.RejectsExternalReferencesWithoutOutput),
             ("accepts a full-turn ARC and appearance-only PLINEGEN", NativeDwgReaderSelfTests.AcceptsFullTurnArcAndPlinegenPolyline),
             ("counts classic polyline vertices in the global budget", NativeDwgReaderSelfTests.CountsClassicPolylineVerticesInGlobalBudget),
             ("publishes one durable report under concurrent output", NativeDwgReaderSelfTests.ConcurrentOutputHasOneOwnerAndOneReport),
             ("rejects corrupt DWG instead of reporting failsafe coverage", NativeDwgReaderSelfTests.RejectsCorruptionInsteadOfReportingFailsafeCoverage),
             ("pipes a real generated DWG through the actual stream CLI", NativeDwgStreamSelfTests.CliReadsRealDwgFromBinaryStandardInput),
             ("reads a non-seekable chunked native DWG stream", NativeDwgStreamSelfTests.ReadsNonSeekableChunkedInput),
             ("rejects malformed native streams without partial success output", NativeDwgStreamSelfTests.RejectsMalformedStreamsWithoutSuccessOutput),
             ("bounds generated native stream input without partial success output", NativeDwgStreamSelfTests.RejectsOversizedGeneratedStreamWithoutSuccessOutput),
+            ("resaves exact v2 geometry through the actual framed native CLI", NativeDwgResaveSelfTests.CliResavesExactRequestedGeometry),
+            ("detects unrequested passive viewport geometry plot and ownership changes", NativeDwgResaveSelfTests.DetectsPassiveViewportChanges),
+            ("resaves non-seekable chunked native frames", NativeDwgResaveSelfTests.ResavesChunkedNonSeekableInput),
+            ("rejects malformed resave frames and requests without success bytes", NativeDwgResaveSelfTests.RejectsMalformedFramesAndRequests),
+            ("rejects resave inventory gaps Xrefs and ineligible targets", NativeDwgResaveSelfTests.RejectsInventoryGapsAndIneligibleSources),
+            ("bounds native resave output memory before growth", NativeDwgResaveSelfTests.BoundsOutputMemoryBeforeGrowth),
         };
 
         var failed = 0;
         foreach (var test in tests)
         {
             try
             {
                 test.Body();
                 output.WriteLine($"PASS {test.Name}");
             }
             catch (Exception exception)
             {
                 failed++;
                 output.WriteLine($"FAIL {test.Name}: {exception.Message}");
             }
         }
 
         output.WriteLine($"{tests.Length - failed} passed, {failed} failed");
         return failed == 0 ? 0 : 1;
     }

```
