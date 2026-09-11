import { createHash } from "node:crypto";

import { z } from "zod";

import { NativeDrawingDwgImportReportSchema } from "./drawing-native-dwg-import.server.ts";

export const NATIVE_DRAWING_DWG_IMPORT_LIMITS = Object.freeze({
  sourceBytes: 209_715_200,
  reportBytes: 33_554_432,
  minimumLeaseSeconds: 180,
  maximumLeaseSeconds: 900,
  defaultLeaseSeconds: 300,
  rpcMilliseconds: 30_000,
  readerMilliseconds: 120_000,
  readerCleanupMilliseconds: 10_000,
  publicationMarginMilliseconds: 15_000,
  failureMilliseconds: 10_000,
});

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const ReaderImageId = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const HeaderVersion = z.string().regex(/^AC[0-9]{4}$/);
const PositiveSafeInteger = z.number().int().positive().safe();
const AttemptNumber = z.number().int().min(1).max(3);
const UnitOverride = z.union([
  z.null(),
  z.literal(1),
  z.literal(2),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
export const NativeDrawingDwgImportFailureCodeSchema = z.enum([
  "source_unavailable",
  "source_mismatch",
  "reader_failed",
  "report_invalid",
  "worker_interrupted",
  "authority_revoked",
]);
export const NativeDrawingDwgImportJobStatusSchema = z.enum([
  "queued",
  "processing",
  "retry_wait",
  "analyzed",
  "failed",
]);
const StoragePath = z
  .string()
  .min(1)
  .max(1_024)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.endsWith("/") &&
      !value.includes("//") &&
      !value.includes("\\") &&
      !/[\u0000-\u001f\u007f]/u.test(value) &&
      !/(^|\/)\.\.?(\/|$)/u.test(value),
    "Invalid native DWG import storage path.",
  );

export const NativeDrawingDwgImportScopeSchema = z
  .object({
    projectId: Uuid,
    documentId: Uuid,
    revisionId: Uuid,
    canvasId: Uuid,
    sourceFileId: Uuid,
    sourceSha256: Sha256,
    unitOverride: UnitOverride,
  })
  .strict();

export const NativeDrawingDwgImportSourceSchema = z
  .object({
    verificationId: Uuid,
    fileId: Uuid,
    bucket: z.literal("lukas-qto"),
    path: StoragePath,
    sha256: Sha256,
    byteSize: PositiveSafeInteger.max(
      NATIVE_DRAWING_DWG_IMPORT_LIMITS.sourceBytes,
    ),
    headerVersion: HeaderVersion,
  })
  .strict();

export const NativeDrawingDwgImportPublicSourceSchema =
  NativeDrawingDwgImportSourceSchema.omit({
    bucket: true,
    path: true,
  }).strict();

export const NativeDrawingDwgImportReceiptSchema = z
  .object({
    jobId: Uuid,
    attemptNumber: AttemptNumber,
    readerImageId: ReaderImageId,
    reportSha256: Sha256,
    reportByteSize: PositiveSafeInteger.max(
      NATIVE_DRAWING_DWG_IMPORT_LIMITS.reportBytes,
    ),
    source: NativeDrawingDwgImportPublicSourceSchema,
    qualification: z.literal("experimental-unqualified"),
    persistenceAuthority: z.literal("not-issued"),
  })
  .strict();

export const NativeDrawingDwgImportStatusSchema = z
  .object({
    jobId: Uuid,
    status: NativeDrawingDwgImportJobStatusSchema,
    attemptCount: z.number().int().min(0).max(3),
    failureCode: NativeDrawingDwgImportFailureCodeSchema.nullable(),
    receipt: NativeDrawingDwgImportReceiptSchema.nullable(),
  })
  .strict()
  .superRefine((status, context) => {
    const analyzed = status.status === "analyzed";
    if (analyzed !== (status.receipt !== null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt"],
        message: "Native DWG import receipt does not match status.",
      });
    if (status.receipt && status.receipt.jobId !== status.jobId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt", "jobId"],
        message: "Native DWG import receipt job is inconsistent.",
      });
  });

export const NativeDrawingDwgImportClaimSchema = z
  .object({
    jobId: Uuid,
    attemptNumber: AttemptNumber,
    leaseToken: Uuid,
    leaseExpiresAt: z.string().datetime({ offset: true }),
    readerImageId: ReaderImageId,
    actorId: Uuid,
    scope: NativeDrawingDwgImportScopeSchema,
    source: NativeDrawingDwgImportSourceSchema,
  })
  .strict()
  .superRefine((claim, context) => {
    if (claim.scope.sourceFileId !== claim.source.fileId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source", "fileId"],
        message: "Native DWG import source file is inconsistent.",
      });
    if (claim.scope.sourceSha256 !== claim.source.sha256)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source", "sha256"],
        message: "Native DWG import source digest is inconsistent.",
      });
  });

export const NativeDrawingDwgImportFailureReceiptSchema = z
  .object({ jobId: Uuid, status: z.enum(["retry_wait", "failed"]) })
  .strict();

const AcceptanceSchema = z.object({ jobId: Uuid }).strict();
export const NativeDrawingDwgImportResultSchema = z
  .object({
    receipt: NativeDrawingDwgImportReceiptSchema,
    reportText: z.string().min(1),
  })
  .strict()
  .superRefine((result, context) => {
    const bytes = Buffer.byteLength(result.reportText, "utf8");
    if (
      bytes > NATIVE_DRAWING_DWG_IMPORT_LIMITS.reportBytes ||
      bytes !== result.receipt.reportByteSize ||
      createHash("sha256").update(result.reportText).digest("hex") !==
        result.receipt.reportSha256
    )
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reportText"],
        message: "Native DWG import report identity is inconsistent.",
      });
    try {
      const report = NativeDrawingDwgImportReportSchema.parse(
        JSON.parse(result.reportText) as unknown,
      );
      const expected = result.receipt.source;
      if (
        report.source.sha256 !== expected.sha256 ||
        report.source.byteSize !== expected.byteSize ||
        report.source.headerVersion !== expected.headerVersion
      )
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["reportText", "source"],
          message: "Native DWG import report source is inconsistent.",
        });
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["reportText"],
        message: "Native DWG import report is invalid.",
      });
    }
  });

export type NativeDrawingDwgImportScope = z.infer<
  typeof NativeDrawingDwgImportScopeSchema
>;
export type NativeDrawingDwgImportSource = z.infer<
  typeof NativeDrawingDwgImportSourceSchema
>;
export type NativeDrawingDwgImportReceipt = z.infer<
  typeof NativeDrawingDwgImportReceiptSchema
>;
export type NativeDrawingDwgImportStatus = z.infer<
  typeof NativeDrawingDwgImportStatusSchema
>;
export type NativeDrawingDwgImportClaim = z.infer<
  typeof NativeDrawingDwgImportClaimSchema
>;
export type NativeDrawingDwgImportFailureCode = z.infer<
  typeof NativeDrawingDwgImportFailureCodeSchema
>;
export type NativeDrawingDwgImportFailureReceipt = z.infer<
  typeof NativeDrawingDwgImportFailureReceiptSchema
>;
export type NativeDrawingDwgImportResult = z.infer<
  typeof NativeDrawingDwgImportResultSchema
>;

export type NativeDrawingDwgImportRpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): {
    abortSignal(
      signal: AbortSignal,
    ): PromiseLike<{ data: unknown; error: unknown }>;
  };
};

export class NativeDrawingDwgImportJobError extends Error {
  readonly kind: "invalid" | "unavailable" | "conflict" | "stale" | "capacity";

  constructor(
    kind: "invalid" | "unavailable" | "conflict" | "stale" | "capacity",
  ) {
    super(
      kind === "invalid"
        ? "Native DWG import response is invalid."
        : kind === "conflict"
          ? "Native DWG import request identity conflicts."
          : kind === "stale"
            ? "Native DWG import lease is stale."
            : kind === "capacity"
              ? "Native DWG import capacity is currently full."
              : "Native DWG import is unavailable.",
    );
    this.name = "NativeDrawingDwgImportJobError";
    this.kind = kind;
  }
}

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new NativeDrawingDwgImportJobError("invalid");
  return parsed.data;
}

export function parseNativeDrawingDwgImportClaim(
  raw: unknown,
  expectedReaderImageId?: string,
): NativeDrawingDwgImportClaim {
  const claim = parse(NativeDrawingDwgImportClaimSchema, raw);
  if (
    expectedReaderImageId !== undefined &&
    claim.readerImageId !== parse(ReaderImageId, expectedReaderImageId)
  )
    throw new NativeDrawingDwgImportJobError("invalid");
  return claim;
}

function boundedSignal(
  parent?: AbortSignal,
  milliseconds = NATIVE_DRAWING_DWG_IMPORT_LIMITS.rpcMilliseconds,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent?.aborted) abort();
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

function rpcError(error: unknown): never {
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (code === "PNI02") throw new NativeDrawingDwgImportJobError("conflict");
  if (code === "PNI03") throw new NativeDrawingDwgImportJobError("stale");
  if (code === "PNI05") throw new NativeDrawingDwgImportJobError("capacity");
  throw new NativeDrawingDwgImportJobError("unavailable");
}

async function rpc(
  client: NativeDrawingDwgImportRpcClient,
  name: string,
  args: Record<string, unknown>,
  parent?: AbortSignal,
) {
  if (!client || typeof client.rpc !== "function")
    throw new Error("Native DWG import RPC transport is invalid.");
  const scope = boundedSignal(parent);
  try {
    if (scope.signal.aborted)
      throw new NativeDrawingDwgImportJobError("unavailable");
    let builder: ReturnType<NativeDrawingDwgImportRpcClient["rpc"]>;
    try {
      builder = client.rpc(name, args);
    } catch {
      throw new NativeDrawingDwgImportJobError("unavailable");
    }
    if (!builder || typeof builder.abortSignal !== "function")
      throw new Error("Native DWG import RPC transport is invalid.");
    let result: { data: unknown; error: unknown };
    try {
      result = await builder.abortSignal(scope.signal);
    } catch {
      throw new NativeDrawingDwgImportJobError("unavailable");
    }
    if (scope.signal.aborted)
      throw new NativeDrawingDwgImportJobError("unavailable");
    if (result.error) rpcError(result.error);
    return result.data;
  } finally {
    scope.dispose();
  }
}

export async function requestNativeDrawingDwgImport(
  client: NativeDrawingDwgImportRpcClient,
  rawScope: unknown,
  rawRequestId: unknown,
  signal?: AbortSignal,
): Promise<{ jobId: string }> {
  const scope = parse(NativeDrawingDwgImportScopeSchema, rawScope);
  const requestId = parse(Uuid, rawRequestId);
  return parse(
    AcceptanceSchema,
    await rpc(
      client,
      "lukas_drawing_request_native_dwg_import",
      { p_scope: scope, p_request_id: requestId },
      signal,
    ),
  );
}

export async function getNativeDrawingDwgImportStatus(
  client: NativeDrawingDwgImportRpcClient,
  rawScope: unknown,
  rawJobId: unknown,
  signal?: AbortSignal,
): Promise<NativeDrawingDwgImportStatus | null> {
  const scope = parse(NativeDrawingDwgImportScopeSchema, rawScope);
  const jobId = parse(Uuid, rawJobId);
  const data = await rpc(
    client,
    "lukas_drawing_native_dwg_import_status",
    { p_scope: scope, p_job_id: jobId },
    signal,
  );
  if (data === null) return null;
  const status = parse(NativeDrawingDwgImportStatusSchema, data);
  if (
    status.jobId !== jobId ||
    (status.receipt &&
      (status.receipt.source.fileId !== scope.sourceFileId ||
        status.receipt.source.sha256 !== scope.sourceSha256))
  )
    throw new NativeDrawingDwgImportJobError("invalid");
  return status;
}

export async function getNativeDrawingDwgImportResult(
  client: NativeDrawingDwgImportRpcClient,
  rawScope: unknown,
  rawJobId: unknown,
  signal?: AbortSignal,
): Promise<NativeDrawingDwgImportResult> {
  const scope = parse(NativeDrawingDwgImportScopeSchema, rawScope);
  const jobId = parse(Uuid, rawJobId);
  const data = await rpc(
    client,
    "lukas_drawing_native_dwg_import_result",
    { p_scope: scope, p_job_id: jobId },
    signal,
  );
  if (data === null) throw new NativeDrawingDwgImportJobError("unavailable");
  const result = parse(NativeDrawingDwgImportResultSchema, data);
  if (
    result.receipt.jobId !== jobId ||
    result.receipt.source.fileId !== scope.sourceFileId ||
    result.receipt.source.sha256 !== scope.sourceSha256
  )
    throw new NativeDrawingDwgImportJobError("invalid");
  return result;
}
