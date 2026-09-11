import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-jobs.server.ts";
import {
  NativeDrawingDwgImportSourceSchema,
  type NativeDrawingDwgImportRpcClient,
} from "./drawing-native-dwg-import-jobs.server.ts";
import { NativeDrawingDwgResaveSourcePayloadSchema } from "./drawing-native-dwg-resave-source.server.ts";
import {
  buildNativeDrawingDwgResaveAttestation,
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
import {
  NativeDrawingDwgResaveAcceptanceSchema as AcceptanceSchema,
  NativeDrawingDwgResaveStatusSchema as StatusSchema,
} from "./drawing-native-dwg-resave-contract.ts";
export {
  NativeDrawingDwgResaveAcceptanceSchema,
  NativeDrawingDwgResaveStatusSchema,
} from "./drawing-native-dwg-resave-contract.ts";
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
  readonly kind: "invalid" | "unavailable" | "conflict" | "stale" | "capacity";
  constructor(kind: NativeDrawingDwgResaveJobError["kind"]) {
    super(`Native DWG resave ${kind}.`);
    this.kind = kind;
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
    projectId: scope.projectId.toLowerCase(),
    documentId: scope.documentId.toLowerCase(),
    revisionId: scope.revisionId.toLowerCase(),
    canvasId: scope.canvasId.toLowerCase(),
  };
}

// Bound even transports that ignore abort; late results cannot become authority.
async function bounded<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const fail = () => new NativeDrawingDwgResaveJobError("unavailable");
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(fail());
  });
  controller.signal.addEventListener("abort", rejectAbort, { once: true });
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 30_000);
  timer.unref?.();
  try {
    if (parent?.aborted) throw fail();
    const value = await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      aborted,
    ]);
    if (controller.signal.aborted) throw fail();
    return value;
  } catch (error) {
    if (error instanceof NativeDrawingDwgResaveJobError) throw error;
    throw fail();
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}
async function rpc(
  client: RpcClient,
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  return bounded(async (child) => {
    const transport = client.rpc(name, args);
    if (!transport || typeof transport.abortSignal !== "function")
      throw new NativeDrawingDwgResaveJobError("unavailable");
    const response = await transport.abortSignal(child);
    if (
      !response ||
      !Object.hasOwn(response, "data") ||
      !Object.hasOwn(response, "error")
    )
      throw new NativeDrawingDwgResaveJobError("unavailable");
    if (response.error !== null) {
      const code =
        typeof response.error === "object" && "code" in response.error
          ? response.error.code
          : null;
      throw new NativeDrawingDwgResaveJobError(
        code === "PNR12"
          ? "conflict"
          : code === "PNR13"
            ? "stale"
            : code === "PNR15"
              ? "capacity"
              : "unavailable",
      );
    }
    return response.data;
  }, signal);
}
async function actor(client: UserClient, signal?: AbortSignal) {
  const response = await bounded(() => client.auth.getUser(), signal);
  if (
    !response ||
    response.error !== null ||
    !response.data?.user ||
    response.data.user.is_anonymous === true
  )
    throw new NativeDrawingDwgResaveJobError("unavailable");
  return parse(Uuid, response.data.user.id);
}

// Authenticated artifact adapters share the same strict envelopes and deadline.
export {
  rpc as callNativeDrawingDwgResaveJobRpc,
  actor as verifyNativeDrawingDwgResaveActor,
};

export async function getLatestNativeDrawingDwgResaveStatus(
  client: UserClient,
  rawScope: unknown,
  signal?: AbortSignal,
) {
  const scope = scopeInput(rawScope);
  const actorId = await actor(client, signal);
  const raw = await rpc(
    client,
    "lukas_drawing_native_dwg_resave_status",
    {
      p_scope: scope,
      p_job_id: null,
    },
    signal,
  );
  const status = raw === null ? null : parse(StatusSchema, raw);
  if ((await actor(client, signal)) !== actorId)
    throw new NativeDrawingDwgResaveJobError("unavailable");
  return status;
}

export async function requestNativeDrawingDwgResave(
  userClient: UserClient,
  serviceClient: RpcClient,
  rawRequest: unknown,
  rawImageId: unknown,
  signal?: AbortSignal,
) {
  const { requestId, ...rawScope } = parse(RequestSchema, rawRequest);
  const scope = scopeInput(rawScope),
    imageId = parse(ImageId, rawImageId);
  const actorId = await actor(userClient, signal);
  const payload = await rpc(
    userClient,
    "lukas_qto_drawing_native_dwg_resave_source",
    { p_scope: scope },
    signal,
  );
  let attestation;
  try {
    attestation = await buildNativeDrawingDwgResaveAttestation(
      scope,
      payload,
      imageId,
    );
  } catch {
    throw new NativeDrawingDwgResaveJobError("invalid");
  }
  if ((await actor(userClient, signal)) !== actorId)
    throw new NativeDrawingDwgResaveJobError("unavailable");
  const result = parse(
    AcceptanceSchema,
    await rpc(
      serviceClient,
      "lukas_drawing_admit_native_dwg_resave",
      {
        p_actor_id: actorId,
        p_scope: scope,
        p_request_id: requestId,
        p_attestation: attestation,
      },
      signal,
    ),
  );
  if (
    result.requestId !== requestId ||
    result.hasChanges !== (attestation.request !== null)
  )
    throw new NativeDrawingDwgResaveJobError("invalid");
  if ((await actor(userClient, signal)) !== actorId)
    throw new NativeDrawingDwgResaveJobError("unavailable");
  return result;
}
async function statusCall(
  client: RpcClient,
  name: string,
  rawScope: unknown,
  rawJobId: unknown,
  signal?: AbortSignal,
) {
  const scope = scopeInput(rawScope),
    jobId = parse(Uuid, rawJobId);
  const result = parse(
    StatusSchema,
    await rpc(client, name, { p_scope: scope, p_job_id: jobId }, signal),
  );
  if (result.jobId !== jobId)
    throw new NativeDrawingDwgResaveJobError("invalid");
  return result;
}
export async function getNativeDrawingDwgResaveStatus(
  client: RpcClient,
  rawScope: unknown,
  rawJobId: unknown,
  signal?: AbortSignal,
) {
  return statusCall(
    client,
    "lukas_drawing_native_dwg_resave_status",
    rawScope,
    rawJobId,
    signal,
  );
}
export async function cancelNativeDrawingDwgResave(
  client: RpcClient,
  rawScope: unknown,
  rawJobId: unknown,
  signal?: AbortSignal,
) {
  return statusCall(
    client,
    "lukas_drawing_cancel_native_dwg_resave",
    rawScope,
    rawJobId,
    signal,
  );
}
export function parseNativeDrawingDwgResaveClaim(
  raw: unknown,
  expectedImageId: unknown,
) {
  try {
    const claim = parse(ClaimSchema, raw);
    const attestation = parseNativeDrawingDwgResaveAttestation(
      claim.attestation,
      claim.scope,
    );
    const envelope = JSON.parse(attestation.authority.text);
    const { bucket: _bucket, path: _path, ...publicSource } = claim.source;
    const approved = claim.payload.approved;
    if (
      attestation.resaverImageId !== parse(ImageId, expectedImageId) ||
      attestation.request === null ||
      !isDeepStrictEqual(
        publicSource,
        claim.payload.analysis.result.receipt.source,
      ) ||
      !isDeepStrictEqual(envelope.analysis, {
        scope: claim.payload.analysis.scope,
        receipt: claim.payload.analysis.result.receipt,
      }) ||
      envelope.snapshotCanonicalJsonText !==
        approved.snapshot.canonicalJsonText ||
      approved.projectId !== claim.scope.projectId ||
      approved.documentId !== claim.scope.documentId ||
      approved.canvasId !== claim.scope.canvasId ||
      !isDeepStrictEqual(envelope.approved, {
        revisionId: approved.revision.id,
        revisionVersion: approved.revision.version,
        snapshotSha256: approved.snapshot.sha256,
        operationSequence: approved.snapshot.operationSequence,
      })
    )
      throw new NativeDrawingDwgResaveJobError("invalid");
    return claim;
  } catch {
    throw new NativeDrawingDwgResaveJobError("invalid");
  }
}
