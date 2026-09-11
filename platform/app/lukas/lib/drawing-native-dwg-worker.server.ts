import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

import { projectApprovedNativeDrawingCadSource } from "./drawing-native-dwg-source.server.ts";

export const NATIVE_DWG_WORKER_LIMITS = Object.freeze({
  attemptMilliseconds: 840_000,
  leaseSeconds: 900,
  writerMilliseconds: 120_000,
  storageMilliseconds: 30_000,
  processOutputBytes: 64 * 1024,
  sourceManifestBytes: 20 * 1024 * 1024,
  dwgBytes: 100 * 1024 * 1024,
  authorityBytes: 20 * 1024 * 1024,
  reportBytes: 32 * 1024 * 1024,
});

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
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
const ArtifactKindSchema = z.enum([
  "dwg",
  "source_manifest",
  "authority",
  "report",
]);
const ArtifactMetadataSchema = z
  .object({
    kind: ArtifactKindSchema,
    sha256: Sha256,
    byteSize: PositiveSafeInteger,
  })
  .strict();
const StagedArtifactSchema = ArtifactMetadataSchema.extend({
  path: z.string().min(1).max(1_000),
}).strict();
const ClaimSchema = z
  .object({
    jobId: Uuid,
    projectId: Uuid,
    attempt: z.number().int().min(1).max(3),
    leaseToken: Uuid,
    leaseExpiresAt: z.string().datetime({ offset: true }),
    writerBuildSha256: Sha256,
    source: z.object({ request: z.unknown(), payload: z.unknown() }).strict(),
  })
  .strict();
const ReceiptSchema = z
  .object({
    jobId: Uuid,
    attempt: z.number().int().min(1).max(3),
    qualification: z.literal("experimental-unqualified"),
    source: ScopeSchema,
    writerBuildSha256: Sha256,
    structureSha256: Sha256,
    artifacts: z.array(ArtifactMetadataSchema).length(4),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type NativeDwgScope = z.infer<typeof ScopeSchema>;
export type NativeDwgArtifactKind = z.infer<typeof ArtifactKindSchema>;
export type NativeDwgArtifactMetadata = z.infer<typeof ArtifactMetadataSchema>;
export type NativeDwgStagedArtifact = z.infer<typeof StagedArtifactSchema>;
export type NativeDwgJobClaim = z.infer<typeof ClaimSchema>;
export type NativeDwgReceipt = z.infer<typeof ReceiptSchema>;

export type NativeDwgWriterArtifacts = {
  dwg: Uint8Array;
  source_manifest: Uint8Array;
  report: Uint8Array;
};

type WorkerFailureCode =
  | "source_unavailable"
  | "lease_expired"
  | "conversion_failed"
  | "verification_failed"
  | "upload_failed"
  | "publication_failed"
  | "budget_exceeded";

export type NativeDwgWorkerDependencies = {
  claim(input: { signal: AbortSignal }): Promise<NativeDwgJobClaim | null>;
  convert(input: {
    manifestBytes: Uint8Array;
    expectedWriterBuildSha256: string;
    signal: AbortSignal;
  }): Promise<NativeDwgWriterArtifacts>;
  stage(input: {
    jobId: string;
    attempt: number;
    leaseToken: string;
    structureSha256: string;
    artifacts: NativeDwgArtifactMetadata[];
    signal: AbortSignal;
  }): Promise<NativeDwgStagedArtifact[]>;
  upload(input: {
    kind: NativeDwgArtifactKind;
    path: string;
    bytes: Uint8Array;
    signal: AbortSignal;
  }): Promise<"uploaded" | "exists">;
  read(input: {
    kind: NativeDwgArtifactKind;
    path: string;
    signal: AbortSignal;
  }): Promise<Uint8Array>;
  settle(input: {
    jobId: string;
    attempt: number;
    leaseToken: string;
    signal: AbortSignal;
  }): Promise<"closed">;
  publish(input: {
    jobId: string;
    attempt: number;
    leaseToken: string;
    signal: AbortSignal;
  }): Promise<NativeDwgReceipt>;
  fail(input: {
    jobId: string;
    attempt: number;
    leaseToken: string;
    errorCode: WorkerFailureCode;
    retryable: boolean;
    signal: AbortSignal;
  }): Promise<"retry_wait" | "failed" | "stale">;
};

export type NativeDwgWorkerOutcome =
  | "idle"
  | "completed"
  | "retry_scheduled"
  | "failed";

type WorkerRuntime = {
  now?: () => number;
  signal?: AbortSignal;
};

class NativeDwgWorkerFailure extends Error {
  readonly code: WorkerFailureCode;
  readonly retryable: boolean;

  constructor(code: WorkerFailureCode, retryable: boolean) {
    super("Native DWG worker operation failed.");
    this.code = code;
    this.retryable = retryable;
  }
}

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function exactKeys(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === [...keys].sort()[index])
  );
}

function verifyWriterArtifacts(
  raw: NativeDwgWriterArtifacts,
  manifestBytes: Uint8Array,
  expectedScope: {
    projectId: string;
    documentId: string;
    revisionId: string;
    operationSequence: number;
    structureSha256: string;
  },
): NativeDwgWriterArtifacts {
  if (!exactKeys(raw, ["dwg", "source_manifest", "report"]))
    throw new NativeDwgWorkerFailure("verification_failed", false);
  const artifacts = raw as NativeDwgWriterArtifacts;
  if (
    artifacts.dwg.byteLength < 6 ||
    artifacts.dwg.byteLength > NATIVE_DWG_WORKER_LIMITS.dwgBytes ||
    Buffer.from(artifacts.dwg.subarray(0, 6)).toString("ascii") !== "AC1024" ||
    artifacts.source_manifest.byteLength < 1 ||
    artifacts.source_manifest.byteLength >
      NATIVE_DWG_WORKER_LIMITS.sourceManifestBytes ||
    !Buffer.from(artifacts.source_manifest).equals(
      Buffer.from(manifestBytes),
    ) ||
    artifacts.report.byteLength < 1 ||
    artifacts.report.byteLength > NATIVE_DWG_WORKER_LIMITS.reportBytes
  )
    throw new NativeDwgWorkerFailure("verification_failed", false);

  let report: unknown;
  try {
    report = JSON.parse(Buffer.from(artifacts.report).toString("utf8"));
  } catch {
    throw new NativeDwgWorkerFailure("verification_failed", false);
  }
  if (
    !exactKeys(report, [
      "qualification",
      "status",
      "productionDwgDeliveryQualification",
      "independentCadVerification",
      "canonicalSourceValidation",
      "engine",
      "tolerances",
      "input",
      "outputs",
      "outputProfile",
      "verification",
      "diagnostics",
      "failures",
      "warnings",
    ])
  )
    throw new NativeDwgWorkerFailure("verification_failed", false);
  const value = report as Record<string, unknown>;
  const input = value.input as Record<string, unknown>;
  const outputs = value.outputs as Record<string, unknown>;
  const dwg = outputs?.dwg as Record<string, unknown>;
  const source = outputs?.sourceManifest as Record<string, unknown>;
  const verification = value.verification as Record<string, unknown>;
  if (
    value.qualification !== "experimental-unqualified" ||
    value.status !== "passed-internal-semantic-comparison" ||
    value.productionDwgDeliveryQualification !== "not-qualified" ||
    value.independentCadVerification !== "not-performed" ||
    value.canonicalSourceValidation !== "producer-required" ||
    !Array.isArray(value.failures) ||
    value.failures.length !== 0 ||
    !verification ||
    !Array.isArray(verification.failures) ||
    verification.failures.length !== 0 ||
    !exactKeys(input, [
      "fileName",
      "sha256",
      "bytes",
      "scope",
      "originalBytesPreserved",
    ]) ||
    input.fileName !== "native.cad.json" ||
    input.sha256 !== hash(manifestBytes) ||
    input.bytes !== manifestBytes.byteLength ||
    input.originalBytesPreserved !== true ||
    JSON.stringify(input.scope) !== JSON.stringify(expectedScope) ||
    !exactKeys(outputs, ["dwg", "sourceManifest", "report"]) ||
    !exactKeys(dwg, ["fileName", "sha256"]) ||
    dwg.fileName !== "native.dwg" ||
    dwg.sha256 !== hash(artifacts.dwg) ||
    !exactKeys(source, ["fileName", "sha256"]) ||
    source.fileName !== "source-manifest.json" ||
    source.sha256 !== hash(manifestBytes) ||
    outputs.report !== "native-report.json"
  )
    throw new NativeDwgWorkerFailure("verification_failed", false);
  return artifacts;
}

const artifactOrder = [
  "dwg",
  "source_manifest",
  "authority",
  "report",
] as const;
const artifactFileNames: Record<NativeDwgArtifactKind, string> = {
  dwg: "native.dwg",
  source_manifest: "source-manifest.json",
  authority: "authority.json",
  report: "native-report.json",
};
const artifactLimits: Record<NativeDwgArtifactKind, number> = {
  dwg: NATIVE_DWG_WORKER_LIMITS.dwgBytes,
  source_manifest: NATIVE_DWG_WORKER_LIMITS.sourceManifestBytes,
  authority: NATIVE_DWG_WORKER_LIMITS.authorityBytes,
  report: NATIVE_DWG_WORKER_LIMITS.reportBytes,
};

function expectedArtifactPath(
  claim: NativeDwgJobClaim,
  artifact: NativeDwgArtifactMetadata,
): string {
  return `projects/${claim.projectId}/native-dwg/${claim.jobId}/${claim.attempt}/${artifact.sha256}/${artifactFileNames[artifact.kind]}`;
}

function validateArtifactMetadata(
  raw: unknown,
  expected: NativeDwgArtifactMetadata[],
  claim: NativeDwgJobClaim,
): NativeDwgStagedArtifact[] {
  const parsed = z.array(StagedArtifactSchema).length(4).parse(raw);
  for (let index = 0; index < artifactOrder.length; index += 1) {
    const value = parsed[index];
    const wanted = expected[index];
    if (
      value.kind !== artifactOrder[index] ||
      value.kind !== wanted.kind ||
      value.sha256 !== wanted.sha256 ||
      value.byteSize !== wanted.byteSize ||
      value.path !== expectedArtifactPath(claim, wanted)
    )
      throw new NativeDwgWorkerFailure("publication_failed", false);
  }
  return parsed;
}

function validateReceipt(
  raw: unknown,
  claim: NativeDwgJobClaim,
  scope: NativeDwgScope,
  structureSha256: string,
  artifacts: NativeDwgArtifactMetadata[],
): void {
  const receipt = ReceiptSchema.parse(raw);
  if (
    receipt.jobId !== claim.jobId ||
    receipt.attempt !== claim.attempt ||
    receipt.writerBuildSha256 !== claim.writerBuildSha256 ||
    receipt.structureSha256 !== structureSha256 ||
    JSON.stringify(receipt.source) !== JSON.stringify(scope) ||
    JSON.stringify(receipt.artifacts) !== JSON.stringify(artifacts)
  )
    throw new NativeDwgWorkerFailure("publication_failed", false);
}

function childSignal(parent: AbortSignal | undefined, milliseconds: number) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, milliseconds);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abort);
    },
  };
}

export async function runNativeDrawingDwgWorkerOnce(
  dependencies: NativeDwgWorkerDependencies,
  runtime: WorkerRuntime = {},
): Promise<NativeDwgWorkerOutcome> {
  const now = runtime.now ?? Date.now;
  const startedAt = now();
  const attemptDeadline =
    startedAt + NATIVE_DWG_WORKER_LIMITS.attemptMilliseconds;
  const ensureAvailable = (deadline = attemptDeadline) => {
    if (runtime.signal?.aborted || now() >= deadline)
      throw new NativeDwgWorkerFailure("budget_exceeded", true);
  };
  const boundary = async <T>(
    milliseconds: number,
    operation: (signal: AbortSignal) => Promise<T>,
    deadline = attemptDeadline,
  ): Promise<T> => {
    ensureAvailable(deadline);
    const remaining = Math.max(1, Math.min(milliseconds, deadline - now()));
    const scoped = childSignal(runtime.signal, remaining);
    try {
      const result = await operation(scoped.signal);
      if (scoped.signal.aborted || runtime.signal?.aborted || now() >= deadline)
        throw new NativeDwgWorkerFailure("budget_exceeded", true);
      return result;
    } finally {
      scoped.dispose();
    }
  };

  const rawClaim = await boundary(
    NATIVE_DWG_WORKER_LIMITS.storageMilliseconds,
    (signal) => dependencies.claim({ signal }),
  );
  if (rawClaim === null) return "idle";
  let claim: NativeDwgJobClaim;
  try {
    claim = ClaimSchema.parse(rawClaim);
  } catch {
    throw new Error("Native DWG claim is invalid.");
  }
  const leaseDeadline = Date.parse(claim.leaseExpiresAt);
  const deadline = Math.min(attemptDeadline, leaseDeadline);
  const fail = async (
    failure: NativeDwgWorkerFailure,
  ): Promise<NativeDwgWorkerOutcome> => {
    const scoped = childSignal(
      runtime.signal,
      NATIVE_DWG_WORKER_LIMITS.storageMilliseconds,
    );
    try {
      const state = await dependencies.fail({
        jobId: claim.jobId,
        attempt: claim.attempt,
        leaseToken: claim.leaseToken,
        errorCode: failure.code,
        retryable: failure.retryable,
        signal: scoped.signal,
      });
      if (!(["retry_wait", "failed", "stale"] as const).includes(state))
        return "failed";
      return state === "retry_wait" ? "retry_scheduled" : "failed";
    } catch {
      return "failed";
    } finally {
      scoped.dispose();
    }
  };
  const execute = async (): Promise<NativeDwgWorkerOutcome> => {
    if (deadline <= startedAt)
      throw new NativeDwgWorkerFailure("lease_expired", false);
    ensureAvailable(deadline);

    let projected: Awaited<
      ReturnType<typeof projectApprovedNativeDrawingCadSource>
    >;
    try {
      projected = await projectApprovedNativeDrawingCadSource(
        claim.source.request,
        claim.source.payload,
      );
    } catch {
      throw new NativeDwgWorkerFailure("source_unavailable", false);
    }
    const scope = ScopeSchema.parse(claim.source.request);
    if (scope.projectId !== claim.projectId)
      throw new NativeDwgWorkerFailure("source_unavailable", false);
    const manifestBytes = jsonBytes(projected.manifest);
    const authorityBytes = jsonBytes(projected.authority);
    if (
      manifestBytes.byteLength < 1 ||
      manifestBytes.byteLength > NATIVE_DWG_WORKER_LIMITS.sourceManifestBytes ||
      authorityBytes.byteLength < 1 ||
      authorityBytes.byteLength > NATIVE_DWG_WORKER_LIMITS.authorityBytes
    )
      throw new NativeDwgWorkerFailure("source_unavailable", false);
    const structureSha256 = Sha256.parse(
      projected.manifest.scope.structureSha256,
    );

    let converted: NativeDwgWriterArtifacts;
    try {
      converted = await boundary(
        NATIVE_DWG_WORKER_LIMITS.writerMilliseconds,
        (signal) =>
          dependencies.convert({
            manifestBytes,
            expectedWriterBuildSha256: claim.writerBuildSha256,
            signal,
          }),
        deadline,
      );
    } catch (error) {
      if (error instanceof NativeDwgWorkerFailure) throw error;
      throw new NativeDwgWorkerFailure("conversion_failed", false);
    }
    const artifacts = verifyWriterArtifacts(converted, manifestBytes, {
      projectId: scope.projectId,
      documentId: scope.documentId,
      revisionId: scope.revisionId,
      operationSequence: projected.authority.operationSequence,
      structureSha256,
    });
    const bytesByKind: Record<NativeDwgArtifactKind, Uint8Array> = {
      dwg: artifacts.dwg,
      source_manifest: artifacts.source_manifest,
      authority: authorityBytes,
      report: artifacts.report,
    };
    const metadata = artifactOrder.map((kind) => {
      const bytes = bytesByKind[kind];
      if (bytes.byteLength < 1 || bytes.byteLength > artifactLimits[kind])
        throw new NativeDwgWorkerFailure("verification_failed", false);
      return { kind, sha256: hash(bytes), byteSize: bytes.byteLength };
    });
    let staged: NativeDwgStagedArtifact[];
    try {
      staged = validateArtifactMetadata(
        await boundary(
          NATIVE_DWG_WORKER_LIMITS.storageMilliseconds,
          (signal) =>
            dependencies.stage({
              jobId: claim.jobId,
              attempt: claim.attempt,
              leaseToken: claim.leaseToken,
              structureSha256,
              artifacts: metadata,
              signal,
            }),
          deadline,
        ),
        metadata,
        claim,
      );
    } catch (error) {
      if (error instanceof NativeDwgWorkerFailure) throw error;
      throw new NativeDwgWorkerFailure("publication_failed", true);
    }

    for (const item of staged) {
      const bytes = bytesByKind[item.kind];
      let uploadResult: "uploaded" | "exists";
      try {
        uploadResult = await boundary(
          NATIVE_DWG_WORKER_LIMITS.storageMilliseconds,
          (signal) => dependencies.upload({ ...item, bytes, signal }),
          deadline,
        );
        if (uploadResult !== "uploaded" && uploadResult !== "exists")
          throw new Error("invalid upload result");
      } catch (error) {
        if (error instanceof NativeDwgWorkerFailure) throw error;
        throw new NativeDwgWorkerFailure("upload_failed", true);
      }
      let storedBytes: Uint8Array;
      try {
        storedBytes = await boundary(
          NATIVE_DWG_WORKER_LIMITS.storageMilliseconds,
          (signal) => dependencies.read({ ...item, signal }),
          deadline,
        );
      } catch (error) {
        if (error instanceof NativeDwgWorkerFailure) throw error;
        throw new NativeDwgWorkerFailure("upload_failed", true);
      }
      if (
        storedBytes.byteLength !== item.byteSize ||
        hash(storedBytes) !== item.sha256 ||
        !Buffer.from(storedBytes).equals(Buffer.from(bytes))
      )
        throw new NativeDwgWorkerFailure(
          uploadResult === "uploaded" ? "verification_failed" : "upload_failed",
          uploadResult === "exists",
        );
    }

    try {
      const settled = await boundary(
        NATIVE_DWG_WORKER_LIMITS.storageMilliseconds,
        (signal) =>
          dependencies.settle({
            jobId: claim.jobId,
            attempt: claim.attempt,
            leaseToken: claim.leaseToken,
            signal,
          }),
        deadline,
      );
      if (settled !== "closed")
        throw new NativeDwgWorkerFailure("publication_failed", true);
      const receipt = await boundary(
        NATIVE_DWG_WORKER_LIMITS.storageMilliseconds,
        (signal) =>
          dependencies.publish({
            jobId: claim.jobId,
            attempt: claim.attempt,
            leaseToken: claim.leaseToken,
            signal,
          }),
        deadline,
      );
      validateReceipt(receipt, claim, scope, structureSha256, metadata);
      return "completed";
    } catch (error) {
      if (error instanceof NativeDwgWorkerFailure) throw error;
      throw new NativeDwgWorkerFailure("publication_failed", true);
    }
  };

  try {
    return await execute();
  } catch (error) {
    return fail(
      error instanceof NativeDwgWorkerFailure
        ? error
        : new NativeDwgWorkerFailure("verification_failed", false),
    );
  }
}

type WriterRuntime = {
  mkdtemp(prefix: string): Promise<string>;
  writeFile(
    path: string,
    bytes: Uint8Array,
    options: { flag: "wx"; mode: number },
  ): Promise<void>;
  execFile(
    binary: string,
    arguments_: string[],
    options: {
      shell: false;
      timeout: number;
      killSignal: "SIGKILL";
      maxBuffer: number;
      windowsHide: true;
      signal: AbortSignal;
      env: { LANG: "C"; LC_ALL: "C" };
    },
  ): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  readdir(path: string): Promise<string[]>;
  lstat(path: string): ReturnType<typeof lstat>;
  realpath(path: string): Promise<string>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
  tmpdir(): string;
};

const defaultWriterRuntime: WriterRuntime = {
  mkdtemp,
  writeFile,
  execFile(binary, arguments_, options) {
    return runNativeDwgProcess(binary, arguments_, {
      timeoutMilliseconds: options.timeout,
      maxOutputBytes: options.maxBuffer,
      signal: options.signal,
      env: options.env,
    });
  },
  readFile,
  readdir,
  lstat,
  realpath,
  rm,
  tmpdir,
};

export function runNativeDwgProcess(
  binary: string,
  arguments_: string[],
  options: {
    timeoutMilliseconds: number;
    maxOutputBytes: number;
    signal: AbortSignal;
    env: { LANG: "C"; LC_ALL: "C" };
  },
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(binary, arguments_, {
        shell: false,
        windowsHide: true,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      rejectPromise(new Error("Native DWG process failed."));
      return;
    }
    let failed = false;
    let outputBytes = 0;
    const stdout = child.stdout!;
    const stderr = child.stderr!;
    const stop = () => {
      failed = true;
      child.kill("SIGKILL");
    };
    const count = (chunk: Buffer) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > options.maxOutputBytes) stop();
    };
    stdout.on("data", count);
    stderr.on("data", count);
    child.once("error", stop);
    const abort = () => stop();
    if (options.signal.aborted) stop();
    else options.signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(stop, options.timeoutMilliseconds);
    timer.unref?.();
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      stdout.off("data", count);
      stderr.off("data", count);
      if (failed || code !== 0)
        rejectPromise(new Error("Native DWG process failed."));
      else resolvePromise();
    });
  });
}

async function publishedFiles(
  publishedDirectory: string,
  runtime: Pick<WriterRuntime, "lstat" | "realpath" | "readdir" | "readFile">,
) {
  if (!isAbsolute(publishedDirectory))
    throw new Error("Native DWG writer configuration is invalid.");
  const directory = await runtime.lstat(publishedDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error("Native DWG writer configuration is invalid.");
  if (
    (await runtime.realpath(publishedDirectory)) !== resolve(publishedDirectory)
  )
    throw new Error("Native DWG writer configuration is invalid.");
  const names = (await runtime.readdir(publishedDirectory)).sort();
  if (names.length < 1 || !names.includes("DwgEngineQualification.dll"))
    throw new Error("Native DWG writer configuration is invalid.");
  const files: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const name of names) {
    if (basename(name) !== name || name === "." || name === "..")
      throw new Error("Native DWG writer configuration is invalid.");
    const path = join(publishedDirectory, name);
    const information = await runtime.lstat(path);
    if (!information.isFile() || information.isSymbolicLink())
      throw new Error("Native DWG writer configuration is invalid.");
    if ((await runtime.realpath(path)) !== resolve(path))
      throw new Error("Native DWG writer configuration is invalid.");
    files.push({ name, bytes: await runtime.readFile(path) });
  }
  return files;
}

function buildHash(files: Array<{ name: string; bytes: Uint8Array }>): string {
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(Buffer.from(file.name, "utf8"));
    digest.update(Buffer.from([0]));
    digest.update(Buffer.from(String(file.bytes.byteLength), "ascii"));
    digest.update(Buffer.from([0]));
    digest.update(file.bytes);
    digest.update(Buffer.from([0]));
  }
  return digest.digest("hex");
}

export async function calculateNativeDwgWriterBuildSha256(
  publishedDirectory: string,
  runtime: Pick<
    WriterRuntime,
    "lstat" | "realpath" | "readdir" | "readFile"
  > = defaultWriterRuntime,
): Promise<string> {
  return buildHash(await publishedFiles(publishedDirectory, runtime));
}

export async function runNativeDrawingDwgWriter(
  input: {
    dotnetPath: string;
    publishedDirectory: string;
    manifestBytes: Uint8Array;
    expectedWriterBuildSha256: string;
    signal?: AbortSignal;
  },
  runtime: WriterRuntime = defaultWriterRuntime,
): Promise<NativeDwgWriterArtifacts> {
  try {
    if (!isAbsolute(input.dotnetPath) || !isAbsolute(input.publishedDirectory))
      throw new Error("invalid configuration");
    const resolvedDotnetPath = await runtime.realpath(input.dotnetPath);
    const dotnet = await runtime.lstat(resolvedDotnetPath);
    if (!isAbsolute(resolvedDotnetPath) || !dotnet.isFile())
      throw new Error("invalid configuration");
    const expectedBuild = Sha256.parse(input.expectedWriterBuildSha256);
    const beforeFiles = await publishedFiles(input.publishedDirectory, runtime);
    if (buildHash(beforeFiles) !== expectedBuild)
      throw new Error("writer build mismatch");
    if (
      input.manifestBytes.byteLength < 1 ||
      input.manifestBytes.byteLength >
        NATIVE_DWG_WORKER_LIMITS.sourceManifestBytes
    )
      throw new Error("invalid source");

    const temporaryParent = await runtime.realpath(runtime.tmpdir());
    const temporaryParentInformation = await runtime.lstat(temporaryParent);
    if (
      !isAbsolute(temporaryParent) ||
      !temporaryParentInformation.isDirectory() ||
      temporaryParentInformation.isSymbolicLink() ||
      (await runtime.realpath(temporaryParent)) !== resolve(temporaryParent)
    )
      throw new Error("unsafe temporary parent");
    const temporaryPrefix = join(temporaryParent, "1hk-native-dwg-");
    let root: string | undefined;
    try {
      root = await runtime.mkdtemp(temporaryPrefix);
      if (
        !isAbsolute(root) ||
        dirname(root) !== temporaryParent ||
        !basename(root).startsWith("1hk-native-dwg-")
      )
        throw new Error("unsafe temporary directory");
      const rootInformation = await runtime.lstat(root);
      if (
        !rootInformation.isDirectory() ||
        rootInformation.isSymbolicLink() ||
        (await runtime.realpath(root)) !== resolve(root)
      )
        throw new Error("unsafe temporary directory");
      const sourcePath = join(root, "native.cad.json");
      const outputDirectory = join(root, "output");
      await runtime.writeFile(sourcePath, input.manifestBytes, {
        flag: "wx",
        mode: 0o600,
      });
      const scoped = childSignal(
        input.signal,
        NATIVE_DWG_WORKER_LIMITS.writerMilliseconds,
      );
      try {
        await runtime.execFile(
          input.dotnetPath,
          [
            join(input.publishedDirectory, "DwgEngineQualification.dll"),
            "write-native",
            "--input",
            sourcePath,
            "--output-dir",
            outputDirectory,
          ],
          {
            shell: false,
            timeout: NATIVE_DWG_WORKER_LIMITS.writerMilliseconds,
            killSignal: "SIGKILL",
            maxBuffer: NATIVE_DWG_WORKER_LIMITS.processOutputBytes,
            windowsHide: true,
            signal: scoped.signal,
            env: { LANG: "C", LC_ALL: "C" },
          },
        );
        if (scoped.signal.aborted) throw new Error("writer aborted");
      } finally {
        scoped.dispose();
      }
      const entries = (await runtime.readdir(outputDirectory)).sort();
      if (
        JSON.stringify(entries) !==
        JSON.stringify([
          "native-report.json",
          "native.dwg",
          "source-manifest.json",
        ])
      )
        throw new Error("unexpected output");
      const outputInformation = await runtime.lstat(outputDirectory);
      if (
        !outputInformation.isDirectory() ||
        outputInformation.isSymbolicLink() ||
        (await runtime.realpath(outputDirectory)) !== resolve(outputDirectory)
      )
        throw new Error("unexpected output");
      for (const name of entries) {
        const information = await runtime.lstat(join(outputDirectory, name));
        if (!information.isFile() || information.isSymbolicLink())
          throw new Error("unexpected output");
        const limit =
          name === "native.dwg"
            ? NATIVE_DWG_WORKER_LIMITS.dwgBytes
            : name === "source-manifest.json"
              ? NATIVE_DWG_WORKER_LIMITS.sourceManifestBytes
              : NATIVE_DWG_WORKER_LIMITS.reportBytes;
        if (
          Number.isSafeInteger(information.size) &&
          (information.size < 1 || information.size > limit)
        )
          throw new Error("unexpected output");
      }
      const artifacts = verifyWriterArtifacts(
        {
          dwg: await runtime.readFile(join(outputDirectory, "native.dwg")),
          source_manifest: await runtime.readFile(
            join(outputDirectory, "source-manifest.json"),
          ),
          report: await runtime.readFile(
            join(outputDirectory, "native-report.json"),
          ),
        },
        input.manifestBytes,
        (
          JSON.parse(Buffer.from(input.manifestBytes).toString("utf8")) as {
            scope: {
              projectId: string;
              documentId: string;
              revisionId: string;
              operationSequence: number;
              structureSha256: string;
            };
          }
        ).scope,
      );
      const afterFiles = await publishedFiles(
        input.publishedDirectory,
        runtime,
      );
      if (buildHash(afterFiles) !== expectedBuild)
        throw new Error("writer build changed");
      return artifacts;
    } finally {
      if (root) {
        const confined =
          isAbsolute(root) &&
          dirname(root) === temporaryParent &&
          basename(root).startsWith("1hk-native-dwg-");
        if (!confined)
          throw new Error("Native DWG writer temporary cleanup refused.");
        await runtime.rm(root, { recursive: true, force: true });
      }
    }
  } catch {
    throw new Error("Native DWG conversion failed.");
  }
}
