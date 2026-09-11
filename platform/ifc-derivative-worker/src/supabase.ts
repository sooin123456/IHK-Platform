import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  DRAWING_IFC_DERIVATIVE_WORKER_LIMITS,
  runDrawingIfcDerivativeConverter,
  type DrawingIfcDerivativeJobClaim,
  type DrawingIfcDerivativeWorkerDependencies,
} from "../../app/lukas/lib/drawing-ifc-derivative-worker.server.ts";
import {
  publishManagedIfcDerivativeReady,
  type ManagedIfcDerivativeReadyWriter,
} from "../../app/lukas/lib/drawing-workspace.server.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const StoragePath = z
  .string()
  .min(1)
  .max(1_000)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("//") &&
      !/(^|\/)\.\.?(\/|$)/.test(value),
  );

const RawClaimSchema = z
  .object({
    job_id: Uuid,
    project_id: Uuid,
    source_file_id: Uuid,
    source_storage_path: StoragePath,
    source_byte_size: z
      .number()
      .int()
      .positive()
      .max(DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxSourceBytes),
    source_sha256: Sha256,
    requested_by: Uuid,
    derivative_version: z.number().int().positive().safe(),
    lease_token: Uuid,
    lease_expires_at: z.string().datetime({ offset: true }),
    attempt_count: z.number().int().min(1).max(10),
    generation: z.number().int().positive(),
    converter_sha256: Sha256,
  })
  .strict();
const RawClaimRowsSchema = z.array(RawClaimSchema).max(1);

export function mapIfcDerivativeJobClaim(
  value: unknown,
  expectedConverterSha256?: string,
): DrawingIfcDerivativeJobClaim | null {
  const result = RawClaimRowsSchema.safeParse(value);
  if (!result.success) throw new Error("IFC derivative claim is invalid.");
  const row = result.data[0];
  if (!row) return null;
  if (
    expectedConverterSha256 !== undefined &&
    row.converter_sha256 !== Sha256.parse(expectedConverterSha256)
  )
    throw new Error("IFC derivative claim is invalid.");
  return {
    jobId: row.job_id,
    projectId: row.project_id,
    sourceFileId: row.source_file_id,
    sourceStoragePath: row.source_storage_path,
    sourceByteSize: row.source_byte_size,
    sourceSha256: row.source_sha256,
    requestedBy: row.requested_by,
    derivativeVersion: row.derivative_version,
    leaseToken: row.lease_token,
  };
}

type WorkerClient = Pick<SupabaseClient<any>, "rpc" | "storage">;
type WorkerAdapterRuntime = {
  maxSourceBytes?: number;
  downloadTimeoutMilliseconds?: number;
  convert?: typeof runDrawingIfcDerivativeConverter;
  publish?: typeof publishManagedIfcDerivativeReady;
  fetch?: typeof fetch;
};

export function createLeasedIfcDerivativeReadyWriter(
  client: Pick<WorkerClient, "rpc">,
  identity: { jobId: string; leaseToken: string },
): ManagedIfcDerivativeReadyWriter {
  const jobId = Uuid.parse(identity.jobId);
  const leaseToken = Uuid.parse(identity.leaseToken);
  return {
    async recordReady(input) {
      const result = await client.rpc(
        "lukas_drawing_publish_leased_ifc_derivative_ready",
        {
          p_job_id: jobId,
          p_lease_token: leaseToken,
          p_project_id: input.projectId,
          p_source_file_id: input.sourceFileId,
          p_source_sha256: input.sourceSha256,
          p_version: input.version,
          p_manifest_json: input.manifestJson,
          p_manifest_storage_path: input.manifestStoragePath,
          p_manifest_byte_size: input.manifestByteSize,
          p_manifest_sha256: input.manifestSha256,
          p_geometry_storage_path: input.geometryStoragePath,
          p_geometry_byte_size: input.geometryByteSize,
          p_geometry_sha256: input.geometrySha256,
          p_created_by: input.createdBy,
        },
      );
      if (result.error || typeof result.data !== "string")
        throw new Error("IFC derivative leased publication failed.");
      return { id: Uuid.parse(result.data) };
    },
  };
}

function assertSuccessfulRpc(
  result: { data: unknown; error: unknown },
  expected: readonly string[],
) {
  if (result.error || !expected.includes(String(result.data)))
    throw new Error("IFC derivative queue operation failed.");
}

export function createSupabaseIfcDerivativeWorkerDependencies(
  client: WorkerClient,
  config: {
    converterPath: string;
    converterSha256: string;
    leaseSeconds: number;
  },
  runtime: WorkerAdapterRuntime = {},
): DrawingIfcDerivativeWorkerDependencies {
  const maxSourceBytes =
    runtime.maxSourceBytes ??
    DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxSourceBytes;
  if (
    !Number.isSafeInteger(maxSourceBytes) ||
    maxSourceBytes < 1 ||
    maxSourceBytes > DRAWING_IFC_DERIVATIVE_WORKER_LIMITS.maxSourceBytes
  )
    throw new Error("IFC source download limit is invalid.");
  const downloadTimeoutMilliseconds =
    runtime.downloadTimeoutMilliseconds ?? 30_000;
  if (
    !Number.isSafeInteger(downloadTimeoutMilliseconds) ||
    downloadTimeoutMilliseconds < 1 ||
    downloadTimeoutMilliseconds > 300_000
  )
    throw new Error("IFC source download timeout is invalid.");
  const convert = runtime.convert ?? runDrawingIfcDerivativeConverter;
  const publish = runtime.publish ?? publishManagedIfcDerivativeReady;
  const converterSha256 = Sha256.parse(config.converterSha256);

  return {
    async claim() {
      const result = await client.rpc(
        "lukas_drawing_claim_ifc_derivative_job_for_converter",
        {
          p_converter_sha256: converterSha256,
          p_lease_seconds: config.leaseSeconds,
        },
      );
      if (result.error) throw new Error("IFC derivative claim failed.");
      return mapIfcDerivativeJobClaim(result.data, converterSha256);
    },
    async download(claim) {
      try {
        const bucket = client.storage.from("lukas-qto");
        const information = await bucket.info(claim.sourceStoragePath);
        if (
          information.error ||
          !information.data ||
          information.data.size !== claim.sourceByteSize ||
          information.data.size > maxSourceBytes
        )
          throw new Error("invalid private object size");
        const result = await bucket.download(
          claim.sourceStoragePath,
          {},
          { signal: AbortSignal.timeout(downloadTimeoutMilliseconds) },
        );
        if (
          result.error ||
          !result.data ||
          !Number.isSafeInteger(result.data.size) ||
          result.data.size < 1 ||
          result.data.size > maxSourceBytes
        )
          throw new Error("invalid private object");
        return new Uint8Array(await result.data.arrayBuffer());
      } catch {
        throw new Error("IFC source download failed.");
      }
    },
    convert(input) {
      return convert({ binaryPath: config.converterPath, ...input });
    },
    async publish(input) {
      const { jobId, leaseToken, ...publication } = input;
      const writer = createLeasedIfcDerivativeReadyWriter(client, {
        jobId,
        leaseToken,
      });
      return publish(
        client.storage as never,
        writer,
        publication,
        runtime.fetch ? { fetch: runtime.fetch } : {},
      );
    },
    async complete(input) {
      const result = await client.rpc(
        "lukas_drawing_complete_ifc_derivative_job",
        {
          p_job_id: input.jobId,
          p_lease_token: input.leaseToken,
          p_derivative_version: input.derivativeVersion,
          p_derivative_id: input.derivativeId,
        },
      );
      assertSuccessfulRpc(result, ["completed"]);
    },
    async fail(input) {
      const result = await client.rpc("lukas_drawing_fail_ifc_derivative_job", {
        p_job_id: input.jobId,
        p_lease_token: input.leaseToken,
        p_derivative_version: input.derivativeVersion,
        p_retryable: input.retryable,
        p_error_code: input.errorCode,
        p_error_message: input.errorMessage,
      });
      assertSuccessfulRpc(result, ["retry_wait", "failed", "completed"]);
    },
  };
}
