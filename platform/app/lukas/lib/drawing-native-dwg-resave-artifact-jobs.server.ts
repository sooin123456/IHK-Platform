import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-jobs.server.ts";
import {
  callNativeDrawingDwgResaveJobRpc,
  verifyNativeDrawingDwgResaveActor,
  NativeDrawingDwgResaveJobError,
} from "./drawing-native-dwg-resave-jobs.server.ts";
import {
  NativeDrawingDwgResaveArtifactKindSchema,
  NativeDrawingDwgResaveReceiptSchema,
  NativeDrawingDwgResaveDescriptorSchema,
  nativeDrawingDwgResaveArtifactPath,
} from "./drawing-native-dwg-resave-artifacts.server.ts";

type UserClient = Parameters<typeof verifyNativeDrawingDwgResaveActor>[0];
const Uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const Scope = NativeDrawingDwgScopeSchema.transform((scope) => ({
  ...scope,
  projectId: scope.projectId.toLowerCase(),
  documentId: scope.documentId.toLowerCase(),
  revisionId: scope.revisionId.toLowerCase(),
  canvasId: scope.canvasId.toLowerCase(),
}));
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new NativeDrawingDwgResaveJobError("invalid");
  return result.data;
}

export async function getNativeDrawingDwgResaveReceipt(
  client: UserClient,
  rawScope: unknown,
  rawJobId: unknown,
  signal?: AbortSignal,
) {
  const scope = parse(Scope, rawScope),
    jobId = parse(Uuid, rawJobId);
  const actorId = await verifyNativeDrawingDwgResaveActor(client, signal);
  const receipt = parse(
    NativeDrawingDwgResaveReceiptSchema,
    await callNativeDrawingDwgResaveJobRpc(
      client,
      "lukas_drawing_native_dwg_resave_receipt",
      {
        p_scope: scope,
        p_job_id: jobId,
      },
      signal,
    ),
  );
  if (receipt.jobId !== jobId || !isDeepStrictEqual(receipt.scope, scope))
    throw new NativeDrawingDwgResaveJobError("invalid");
  if ((await verifyNativeDrawingDwgResaveActor(client, signal)) !== actorId)
    throw new NativeDrawingDwgResaveJobError("unavailable");
  return receipt;
}

/** Server-only locator; every component is bound to the authenticated scope. */
export async function getNativeDrawingDwgResaveDownloadDescriptor(
  client: UserClient,
  rawScope: unknown,
  rawJobId: unknown,
  rawKind: unknown,
  signal?: AbortSignal,
) {
  const scope = parse(Scope, rawScope),
    jobId = parse(Uuid, rawJobId);
  const kind = parse(NativeDrawingDwgResaveArtifactKindSchema, rawKind);
  const actorId = await verifyNativeDrawingDwgResaveActor(client, signal);
  const descriptor = parse(
    NativeDrawingDwgResaveDescriptorSchema,
    await callNativeDrawingDwgResaveJobRpc(
      client,
      "lukas_drawing_native_dwg_resave_download_descriptor",
      {
        p_scope: scope,
        p_job_id: jobId,
        p_kind: kind,
      },
      signal,
    ),
  );
  const metadata = {
    kind: descriptor.kind,
    sha256: descriptor.sha256,
    byteSize: descriptor.byteSize,
  };
  if (
    descriptor.jobId !== jobId ||
    descriptor.kind !== kind ||
    descriptor.path !==
      nativeDrawingDwgResaveArtifactPath(
        scope,
        jobId,
        descriptor.attemptNumber,
        metadata,
      )
  )
    throw new NativeDrawingDwgResaveJobError("invalid");
  if ((await verifyNativeDrawingDwgResaveActor(client, signal)) !== actorId)
    throw new NativeDrawingDwgResaveJobError("unavailable");
  return descriptor;
}
