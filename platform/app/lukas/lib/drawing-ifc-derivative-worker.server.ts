import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdtemp as makeTemporaryDirectory,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir as systemTemporaryDirectory } from "node:os";
import { isAbsolute, join } from "node:path";

import { z } from "zod";

export const DRAWING_IFC_DERIVATIVE_WORKER_LIMITS = Object.freeze({
  maxSourceBytes: 200 * 1024 * 1024,
  maxManifestBytes: 32 * 1024 * 1024,
  maxGeometryBytes: 200 * 1024 * 1024,
  converterTimeoutMilliseconds: 5 * 60 * 1000,
  converterOutputBytes: 64 * 1024,
});

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

const DrawingIfcDerivativeJobClaimSchema = z
  .object({
    jobId: Uuid,
    leaseToken: Uuid,
    projectId: Uuid,
    sourceFileId: Uuid,
    sourceSha256: Sha256,
    sourceStoragePath: z.string().trim().min(1).max(1_000),
    sourceByteSize: z
      .number()
      .int()
      .positive()
      .max(DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxSourceBytes),
    requestedBy: Uuid,
    derivativeVersion: z.number().int().positive(),
  })
  .strict();

export type DrawingIfcDerivativeJobClaim = z.infer<
  typeof DrawingIfcDerivativeJobClaimSchema
>;

export type DrawingIfcDerivativeArtifacts = {
  manifestBytes: Uint8Array;
  geometryBytes: Uint8Array;
};

export type DrawingIfcDerivativeConverterPaths = {
  root: string;
  source: string;
  manifest: string;
  geometry: string;
};

type DrawingIfcDerivativeConverterExecOptions = {
  shell: false;
  timeout: number;
  maxBuffer: number;
  windowsHide: true;
  env: { LANG: "C"; LC_ALL: "C" };
};

type DrawingIfcDerivativeConverterRuntime = {
  mkdtemp(prefix: string): Promise<string>;
  writeFile(
    path: string,
    bytes: Uint8Array,
    options: { flag: "wx"; mode: number },
  ): Promise<void>;
  execFile(
    binary: string,
    arguments_: string[],
    options: DrawingIfcDerivativeConverterExecOptions,
  ): Promise<unknown>;
  readFile(path: string): Promise<Uint8Array>;
  rm(path: string, options: { recursive: true; force: true }): Promise<void>;
  tmpdir(): string;
};

const defaultConverterRuntime: DrawingIfcDerivativeConverterRuntime = {
  mkdtemp: makeTemporaryDirectory,
  writeFile,
  execFile(binary, arguments_, options) {
    return new Promise((resolve, reject) => {
      execFileCallback(binary, arguments_, options, (error) => {
        if (error) reject(error);
        else resolve(undefined);
      });
    });
  },
  readFile,
  rm,
  tmpdir: systemTemporaryDirectory,
};

export function drawingIfcDerivativeConverterArguments(
  paths: Pick<
    DrawingIfcDerivativeConverterPaths,
    "source" | "manifest" | "geometry"
  >,
  sourceFileId: string,
): string[] {
  Uuid.parse(sourceFileId);
  return [
    paths.source,
    paths.manifest,
    paths.geometry,
    "--source-file-id",
    sourceFileId,
  ];
}

export async function runDrawingIfcDerivativeConverter(
  input: {
    binaryPath: string;
    sourceBytes: Uint8Array;
    sourceFileId: string;
  },
  runtime: DrawingIfcDerivativeConverterRuntime = defaultConverterRuntime,
): Promise<DrawingIfcDerivativeArtifacts> {
  Uuid.parse(input.sourceFileId);
  if (!isAbsolute(input.binaryPath))
    throw new Error("IFC derivative converter path must be absolute.");
  if (
    input.sourceBytes.byteLength < 1 ||
    input.sourceBytes.byteLength >
      DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxSourceBytes
  )
    throw new Error("IFC derivative conversion failed.");

  let paths: DrawingIfcDerivativeConverterPaths | null = null;
  try {
    const root = await runtime.mkdtemp(
      join(runtime.tmpdir(), "1hk-ifc-derivative-"),
    );
    paths = {
      root,
      source: join(root, "source.ifc"),
      manifest: join(root, "manifest.json"),
      geometry: join(root, "geometry.glb"),
    };
    await runtime.writeFile(paths.source, input.sourceBytes, {
      flag: "wx",
      mode: 0o600,
    });
    await runtime.execFile(
      input.binaryPath,
      drawingIfcDerivativeConverterArguments(paths, input.sourceFileId),
      {
        shell: false,
        timeout:
          DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.converterTimeoutMilliseconds,
        maxBuffer: DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.converterOutputBytes,
        windowsHide: true,
        env: { LANG: "C", LC_ALL: "C" },
      },
    );
    const manifestBytes = await runtime.readFile(paths.manifest);
    const geometryBytes = await runtime.readFile(paths.geometry);
    if (
      manifestBytes.byteLength < 1 ||
      manifestBytes.byteLength >
        DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxManifestBytes ||
      geometryBytes.byteLength < 1 ||
      geometryBytes.byteLength >
        DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxGeometryBytes
    )
      throw new Error("IFC derivative output is outside managed limits.");
    return { manifestBytes, geometryBytes };
  } catch {
    throw new Error("IFC derivative conversion failed.");
  } finally {
    if (paths) {
      try {
        await runtime.rm(paths.root, { recursive: true, force: true });
      } catch {
        throw new Error("IFC derivative temporary data cleanup failed.");
      }
    }
  }
}

type DrawingIfcDerivativeWorkerFailure = {
  jobId: string;
  leaseToken: string;
  derivativeVersion: number;
  retryable: boolean;
  errorCode:
    | "source_download_failed"
    | "source_identity_mismatch"
    | "conversion_failed"
    | "publication_failed"
    | "completion_failed";
  errorMessage: string;
};

export type DrawingIfcDerivativeWorkerDependencies = {
  claim(): Promise<DrawingIfcDerivativeJobClaim | null>;
  download(claim: DrawingIfcDerivativeJobClaim): Promise<Uint8Array>;
  convert(input: {
    sourceBytes: Uint8Array;
    sourceFileId: string;
  }): Promise<DrawingIfcDerivativeArtifacts>;
  publish(input: {
    jobId: string;
    leaseToken: string;
    projectId: string;
    sourceFileId: string;
    sourceSha256: string;
    version: number;
    createdBy: string;
    manifestBytes: Uint8Array;
    geometryBytes: Uint8Array;
  }): Promise<{ id: string }>;
  complete(input: {
    jobId: string;
    leaseToken: string;
    derivativeVersion: number;
    derivativeId: string;
  }): Promise<void>;
  fail(input: DrawingIfcDerivativeWorkerFailure): Promise<void>;
};

export type DrawingIfcDerivativeWorkerOutcome =
  | "idle"
  | "completed"
  | "retry_scheduled"
  | "failed";

const fixedFailureMessages = {
  source_download_failed: "IFC source download failed.",
  source_identity_mismatch: "IFC source identity verification failed.",
  conversion_failed: "IFC derivative conversion failed.",
  publication_failed: "IFC derivative publication failed.",
  completion_failed: "IFC derivative completion acknowledgement failed.",
} as const;

export async function runDrawingIfcDerivativeWorkerOnce(
  dependencies: DrawingIfcDerivativeWorkerDependencies,
): Promise<DrawingIfcDerivativeWorkerOutcome> {
  const rawClaim = await dependencies.claim();
  if (rawClaim === null) return "idle";
  const claim = DrawingIfcDerivativeJobClaimSchema.parse(rawClaim);
  const fail = async (
    errorCode: DrawingIfcDerivativeWorkerFailure["errorCode"],
    retryable: boolean,
  ): Promise<DrawingIfcDerivativeWorkerOutcome> => {
    await dependencies.fail({
      jobId: claim.jobId,
      leaseToken: claim.leaseToken,
      derivativeVersion: claim.derivativeVersion,
      retryable,
      errorCode,
      errorMessage: fixedFailureMessages[errorCode],
    });
    return retryable ? "retry_scheduled" : "failed";
  };

  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await dependencies.download(claim);
  } catch {
    return fail("source_download_failed", true);
  }
  const sourceDigest = createHash("sha256").update(sourceBytes).digest("hex");
  if (
    sourceBytes.byteLength !== claim.sourceByteSize ||
    sourceBytes.byteLength >
      DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxSourceBytes ||
    sourceDigest !== claim.sourceSha256
  )
    return fail("source_identity_mismatch", false);

  let artifacts: DrawingIfcDerivativeArtifacts;
  try {
    artifacts = await dependencies.convert({
      sourceBytes,
      sourceFileId: claim.sourceFileId,
    });
    if (
      artifacts.manifestBytes.byteLength < 1 ||
      artifacts.manifestBytes.byteLength >
        DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxManifestBytes ||
      artifacts.geometryBytes.byteLength < 1 ||
      artifacts.geometryBytes.byteLength >
        DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxGeometryBytes
    )
      throw new Error("outside managed limits");
  } catch {
    return fail("conversion_failed", false);
  }

  let derivative: { id: string };
  try {
    derivative = await dependencies.publish({
      jobId: claim.jobId,
      leaseToken: claim.leaseToken,
      projectId: claim.projectId,
      sourceFileId: claim.sourceFileId,
      sourceSha256: claim.sourceSha256,
      version: claim.derivativeVersion,
      createdBy: claim.requestedBy,
      manifestBytes: artifacts.manifestBytes,
      geometryBytes: artifacts.geometryBytes,
    });
    Uuid.parse(derivative.id);
  } catch {
    return fail("publication_failed", true);
  }

  try {
    await dependencies.complete({
      jobId: claim.jobId,
      leaseToken: claim.leaseToken,
      derivativeVersion: claim.derivativeVersion,
      derivativeId: derivative.id,
    });
  } catch {
    return fail("completion_failed", true);
  }
  return "completed";
}
