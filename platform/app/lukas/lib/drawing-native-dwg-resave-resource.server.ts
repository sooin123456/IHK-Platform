import { z } from "zod";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import { NativeDrawingDwgResaveScopeSchema as NativeDrawingDwgScopeSchema } from "./drawing-native-dwg-resave-contract";
import { parseNativeDrawingDwgStatusScope } from "./drawing-native-dwg-export.server";
import {
  NativeDrawingDwgResaveJobError,
  cancelNativeDrawingDwgResave,
  getLatestNativeDrawingDwgResaveStatus,
  getNativeDrawingDwgResaveStatus,
  requestNativeDrawingDwgResave,
  verifyNativeDrawingDwgResaveActor,
} from "./drawing-native-dwg-resave-jobs.server";
import { getNativeDrawingDwgResaveReceipt } from "./drawing-native-dwg-resave-artifact-jobs.server";

const Uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const Intent = z.discriminatedUnion("intent", [
  NativeDrawingDwgScopeSchema.extend({
    intent: z.literal("request"),
    requestId: Uuid,
  }).strict(),
  NativeDrawingDwgScopeSchema.extend({
    intent: z.literal("cancel"),
    jobId: Uuid,
  }).strict(),
]);

export function nativeDwgResaveHeaders(headers: Headers) {
  const result = new Headers(headers);
  result.set("Cache-Control", "private, no-store");
  result.set("Referrer-Policy", "no-referrer");
  result.set("X-Content-Type-Options", "nosniff");
  return result;
}

export function nativeDwgResaveError(error: unknown) {
  const status =
    error instanceof Response
      ? error.status
      : error instanceof NativeDrawingDwgResaveJobError
        ? error.kind === "invalid"
          ? 400
          : error.kind === "capacity"
            ? 429
            : error.kind === "conflict" || error.kind === "stale"
              ? 409
              : 404
        : 503;
  const headers = new Headers();
  if (error instanceof Response && error.headers.has("Allow"))
    headers.set("Allow", error.headers.get("Allow")!);
  return new Response(
    "현재 도면의 실험적 DWG 재저장 요청을 처리할 수 없습니다.",
    { status, headers },
  );
}

function normalizedScope(raw: unknown) {
  return NativeDrawingDwgScopeSchema.parse(raw);
}

export function parseNativeDwgResaveQuery(
  request: Request,
  projectId: unknown,
  workspaceId: unknown,
) {
  const parsed = parseNativeDrawingDwgStatusScope(
    request,
    projectId,
    workspaceId,
  );
  return {
    scope: normalizedScope(parsed.scope),
    jobId: parsed.jobId === null ? null : Uuid.parse(parsed.jobId),
  };
}

async function readJson(request: Request) {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > 4096))
    throw new Response(null, { status: 413 });
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !==
      "application/json" ||
    !request.body
  )
    throw new Response(null, { status: 400 });
  const reader = request.body.getReader();
  const bytes = new Uint8Array(4096);
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > bytes.byteLength) {
        void reader.cancel().catch(() => {});
        throw new Response(null, { status: 413 });
      }
      bytes.set(value, size);
      size += value.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)),
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    throw new Response(null, { status: 400 });
  } finally {
    reader.releaseLock();
  }
}

export async function handleNativeDrawingDwgResaveResource({
  request,
  projectId,
  workspaceId,
  client,
  headers,
  loadServiceClient,
  imageId,
}: {
  request: Request;
  projectId: string;
  workspaceId: string;
  client: Parameters<typeof verifyNativeDrawingDwgResaveActor>[0];
  headers: Headers;
  loadServiceClient: () => Promise<
    Parameters<typeof requestNativeDrawingDwgResave>[1]
  >;
  imageId?: unknown;
}) {
  const outgoing = nativeDwgResaveHeaders(headers);
  try {
    if (request.method === "GET") {
      const { scope, jobId } = parseNativeDwgResaveQuery(
        request,
        projectId,
        workspaceId,
      );
      await verifyNativeDrawingDwgResaveActor(client, request.signal);
      const job =
        jobId === null
          ? await getLatestNativeDrawingDwgResaveStatus(
              client,
              scope,
              request.signal,
            )
          : await getNativeDrawingDwgResaveStatus(
              client,
              scope,
              jobId,
              request.signal,
            );
      const receipt =
        job?.status === "completed"
          ? await getNativeDrawingDwgResaveReceipt(
              client,
              scope,
              job.jobId,
              request.signal,
            )
          : null;
      return Response.json({ job, receipt }, { headers: outgoing });
    }
    if (request.method !== "POST")
      throw new Response(null, {
        status: 405,
        headers: { Allow: "GET, POST" },
      });
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new Response(null, { status: 403 });
    if (new URL(request.url).search) throw new Response(null, { status: 400 });
    const parsed = Intent.parse(await readJson(request));
    const { intent, ...input } = parsed;
    const {
      requestId: _requestId,
      jobId: _jobId,
      ...rawScope
    } = input as typeof input & { requestId?: string; jobId?: string };
    const scope = normalizedScope(rawScope);
    if (
      scope.projectId !== Uuid.parse(projectId) ||
      scope.documentId !== Uuid.parse(workspaceId)
    )
      throw new Response(null, { status: 409 });
    await verifyNativeDrawingDwgResaveActor(client, request.signal);
    if (parsed.intent === "cancel") {
      const job = await cancelNativeDrawingDwgResave(
        client,
        scope,
        parsed.jobId,
        request.signal,
      );
      const receipt =
        job.status === "completed"
          ? await getNativeDrawingDwgResaveReceipt(
              client,
              scope,
              job.jobId,
              request.signal,
            )
          : null;
      return Response.json({ job, receipt }, { headers: outgoing });
    }
    if (
      !z
        .string()
        .regex(/^sha256:[0-9a-f]{64}$/)
        .safeParse(imageId).success
    )
      throw new Response(null, { status: 503 });
    const accepted = await requestNativeDrawingDwgResave(
      client,
      await loadServiceClient(),
      { ...scope, requestId: parsed.requestId },
      imageId,
      request.signal,
    );
    return Response.json(accepted, { status: 202, headers: outgoing });
  } catch (error) {
    throw mergeResponseHeaders(
      nativeDwgResaveError(
        error instanceof z.ZodError
          ? new NativeDrawingDwgResaveJobError("invalid")
          : error,
      ),
      outgoing,
    );
  }
}

export async function nativeDrawingDwgResaveRouteRequest({
  request,
  params,
}: {
  request: Request;
  params: { projectId?: string; workspaceId?: string };
}) {
  let headers = new Headers();
  try {
    const context = await drawingContext(request, params.projectId!);
    headers = context.headers;
    // Generated database types predate the resave RPCs; adapters validate every response.
    return await handleNativeDrawingDwgResaveResource({
      request,
      projectId: params.projectId!,
      workspaceId: params.workspaceId!,
      client: context.client as unknown as Parameters<
        typeof verifyNativeDrawingDwgResaveActor
      >[0],
      headers,
      imageId: process.env.NATIVE_DWG_RESAVER_IMAGE_ID,
      loadServiceClient: async () =>
        (await import("~/core/lib/supa-admin-client.server"))
          .default as unknown as Parameters<
          typeof requestNativeDrawingDwgResave
        >[1],
    });
  } catch (error) {
    if (error instanceof Response)
      headers = mergeResponseHeaders(error, headers).headers;
    throw mergeResponseHeaders(
      nativeDwgResaveError(error),
      nativeDwgResaveHeaders(headers),
    );
  }
}
