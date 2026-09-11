import { z } from "zod";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const SafePositiveInteger = z.number().int().positive().safe();
const SafeNonNegativeInteger = z.number().int().nonnegative().safe();

export const NativeDrawingDwgKindSchema = z.enum([
  "dwg",
  "source_manifest",
  "authority",
  "report",
]);
export type NativeDrawingDwgKind = z.infer<typeof NativeDrawingDwgKindSchema>;

export const NativeDrawingDwgScopeSchema = z
  .object({
    projectId: Uuid,
    documentId: Uuid,
    revisionId: Uuid,
    revisionVersion: SafePositiveInteger,
    canvasId: Uuid,
    snapshotSha256: Sha256,
  })
  .strict();
export type NativeDrawingDwgScope = z.infer<typeof NativeDrawingDwgScopeSchema>;

const NativeDrawingDwgRequestSchema = NativeDrawingDwgScopeSchema.extend({
  requestId: Uuid,
}).strict();
const ArtifactSchema = z
  .object({
    kind: NativeDrawingDwgKindSchema,
    sha256: Sha256,
    byteSize: SafePositiveInteger,
  })
  .strict();
const ReceiptSchema = z
  .object({
    jobId: Uuid,
    attempt: z.number().int().min(1).max(3),
    qualification: z.literal("experimental-unqualified"),
    source: NativeDrawingDwgScopeSchema,
    writerBuildSha256: Sha256,
    structureSha256: Sha256,
    artifacts: z.array(ArtifactSchema).length(4),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((receipt, context) => {
    const kinds = new Set(receipt.artifacts.map(({ kind }) => kind));
    if (kinds.size !== 4)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifacts"],
        message: "All native DWG artifacts are required.",
      });
  });
const StatusSchema = z
  .object({
    jobId: Uuid,
    status: z.enum([
      "queued",
      "processing",
      "retry_wait",
      "completed",
      "failed",
    ]),
    attemptCount: z.number().int().min(0).max(3),
    lastErrorCode: z
      .enum([
        "source_unavailable",
        "lease_expired",
        "conversion_failed",
        "verification_failed",
        "upload_failed",
        "publication_failed",
        "budget_exceeded",
      ])
      .nullable(),
    createdAt: z.string().datetime({ offset: true }),
    qualification: z.literal("experimental-unqualified"),
    receipt: ReceiptSchema.nullable(),
  })
  .strict()
  .superRefine((status, context) => {
    if ((status.status === "completed") !== (status.receipt !== null))
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt"],
        message: "Completion and receipt must agree.",
      });
    if (status.receipt && status.receipt.jobId !== status.jobId)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["receipt", "jobId"],
        message: "Receipt job does not match status.",
      });
  });
const AcceptanceSchema = z
  .object({ accepted: z.literal(true), jobId: Uuid, requestId: Uuid })
  .strict();
const DescriptorSchema = z
  .object({
    jobId: Uuid,
    kind: NativeDrawingDwgKindSchema,
    bucket: z.literal("lukas-qto"),
    path: z.string().min(1).max(512),
    sha256: Sha256,
    byteSize: SafePositiveInteger,
  })
  .strict();

export type NativeDrawingDwgReceipt = z.infer<typeof ReceiptSchema>;
export type NativeDrawingDwgStatus = z.infer<typeof StatusSchema>;
export type NativeDrawingDwgDescriptor = z.infer<typeof DescriptorSchema>;
export type NativeDrawingDwgAcceptance = z.infer<typeof AcceptanceSchema>;

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
  readonly kind: "invalid" | "unavailable" | "conflict" | "capacity";
  constructor(kind: NativeDrawingDwgJobError["kind"]) {
    super(
      kind === "invalid"
        ? "Invalid native DWG request."
        : kind === "capacity"
          ? "Native DWG export capacity is currently full."
          : kind === "conflict"
            ? "Native DWG export state conflicts with this request."
            : "Native DWG export is unavailable.",
    );
    this.kind = kind;
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
      : "";
  if (code === "PNJ05") throw new NativeDrawingDwgJobError("capacity");
  if (["PNJ02", "PNJ03", "PNJ04"].includes(code))
    throw new NativeDrawingDwgJobError("conflict");
  throw new NativeDrawingDwgJobError("unavailable");
}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) invalid();
  return result.data;
}

export async function requestNativeDrawingDwgExport(
  client: RpcClient,
  rawRequest: unknown,
): Promise<NativeDrawingDwgAcceptance> {
  const request = parse(NativeDrawingDwgRequestSchema, rawRequest);
  const { requestId, ...scope } = request;
  if (typeof client?.rpc !== "function") invalid();
  const { data, error } = await client.rpc(
    "lukas_drawing_request_native_dwg_export",
    { p_scope: scope, p_request_id: requestId },
  );
  if (error) rpcFailure(error);
  const acceptance = parse(AcceptanceSchema, data);
  if (acceptance.requestId !== requestId) invalid();
  return acceptance;
}

export async function getNativeDrawingDwgExportStatus(
  client: RpcClient,
  rawScope: unknown,
  rawJobId?: unknown,
): Promise<NativeDrawingDwgStatus | null> {
  const scope = parse(NativeDrawingDwgScopeSchema, rawScope);
  const jobId = rawJobId == null ? null : parse(Uuid, rawJobId);
  if (typeof client?.rpc !== "function") invalid();
  const { data, error } = await client.rpc(
    "lukas_drawing_native_dwg_export_status",
    { p_scope: scope, p_job_id: jobId },
  );
  if (error) rpcFailure(error);
  if (data === null) return null;
  const status = parse(StatusSchema, data);
  if (jobId && status.jobId !== jobId) invalid();
  if (
    status.receipt &&
    JSON.stringify(status.receipt.source) !== JSON.stringify(scope)
  )
    invalid();
  return status;
}

export async function resolveNativeDrawingDwgDownload(
  client: RpcClient,
  rawScope: unknown,
  rawJobId: unknown,
  rawKind: unknown,
  signal?: AbortSignal,
): Promise<NativeDrawingDwgDescriptor> {
  const scope = parse(NativeDrawingDwgScopeSchema, rawScope);
  const jobId = parse(Uuid, rawJobId);
  const kind = parse(NativeDrawingDwgKindSchema, rawKind);
  if (typeof client?.rpc !== "function") invalid();
  signal?.throwIfAborted();
  const operation = client.rpc("lukas_drawing_native_dwg_download_descriptor", {
    p_scope: scope,
    p_job_id: jobId,
    p_kind: kind,
  });
  const { data, error } = await (signal && operation.abortSignal
    ? operation.abortSignal(signal)
    : operation);
  signal?.throwIfAborted();
  if (error) rpcFailure(error);
  const descriptor = parse(DescriptorSchema, data);
  if (descriptor.jobId !== jobId || descriptor.kind !== kind) invalid();
  return descriptor;
}
