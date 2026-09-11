import { z } from "zod";

import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import {
  getNativeDrawingDwgExportStatus,
  NativeDrawingDwgJobError,
  NativeDrawingDwgScopeSchema,
  requestNativeDrawingDwgExport,
  type NativeDrawingDwgScope,
} from "~/lukas/lib/drawing-native-dwg-jobs.server";

const MAX_REQUEST_BYTES = 4_096;
const Uuid = z.string().uuid();
const RequestSchema = NativeDrawingDwgScopeSchema.extend({
  requestId: Uuid,
}).strict();
const STATUS_KEYS = [
  "revisionId",
  "revisionVersion",
  "canvasId",
  "snapshotSha256",
  "jobId",
] as const;

function boundedError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof NativeDrawingDwgJobError) {
    const status =
      error.kind === "invalid"
        ? 400
        : error.kind === "capacity"
          ? 429
          : error.kind === "conflict"
            ? 409
            : 404;
    const message =
      error.kind === "invalid"
        ? "DWG 요청이 올바르지 않습니다."
        : error.kind === "capacity"
          ? "현재 DWG 변환 대기열이 가득 찼습니다. 잠시 후 다시 시도해 주세요."
          : error.kind === "conflict"
            ? "DWG 요청 상태가 현재 도면과 일치하지 않습니다."
            : "현재 도면의 DWG 내보내기를 사용할 수 없습니다.";
    return new Response(message, { status });
  }
  return new Response("DWG 내보내기 서비스에 연결하지 못했습니다.", {
    status: 503,
  });
}

function responseHeaders(headers: Headers) {
  const result = new Headers(headers);
  result.set("Cache-Control", "private, no-store");
  result.set("X-Content-Type-Options", "nosniff");
  return result;
}

async function readBoundedJson(request: Request) {
  const declared = request.headers.get("content-length");
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > MAX_REQUEST_BYTES)
  )
    throw new Response("DWG 요청 본문이 너무 큽니다.", { status: 413 });
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    throw new Response("DWG 요청 형식이 올바르지 않습니다.", { status: 400 });
  if (!request.body)
    throw new Response("DWG 요청 본문이 비어 있습니다.", { status: 400 });
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new Response("DWG 요청 본문이 너무 큽니다.", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Response("DWG 요청 본문이 올바르지 않습니다.", { status: 400 });
  }
}

function parseRouteScope(projectId: unknown, workspaceId: unknown) {
  try {
    return {
      projectId: Uuid.parse(projectId),
      documentId: Uuid.parse(workspaceId),
    };
  } catch {
    throw new Response("DWG 도면 범위가 올바르지 않습니다.", { status: 400 });
  }
}

export function parseNativeDrawingDwgStatusScope(
  request: Request,
  projectId: unknown,
  workspaceId: unknown,
): { scope: NativeDrawingDwgScope; jobId: string | null } {
  const route = parseRouteScope(projectId, workspaceId);
  const search = new URL(request.url).searchParams;
  for (const key of search.keys())
    if (!STATUS_KEYS.includes(key as (typeof STATUS_KEYS)[number]))
      throw new Response("DWG 상태 요청이 올바르지 않습니다.", { status: 400 });
  for (const key of STATUS_KEYS)
    if (search.getAll(key).length > 1)
      throw new Response("DWG 상태 요청이 올바르지 않습니다.", { status: 400 });
  try {
    const revisionVersion = search.get("revisionVersion");
    if (!revisionVersion || !/^[1-9]\d*$/.test(revisionVersion))
      throw new Error("invalid revision version");
    return {
      scope: NativeDrawingDwgScopeSchema.parse({
        ...route,
        revisionId: search.get("revisionId"),
        revisionVersion: Number(revisionVersion),
        canvasId: search.get("canvasId"),
        snapshotSha256: search.get("snapshotSha256"),
      }),
      jobId: search.has("jobId") ? Uuid.parse(search.get("jobId")) : null,
    };
  } catch {
    throw new Response("DWG 상태 요청이 올바르지 않습니다.", { status: 400 });
  }
}

export async function handleNativeDrawingDwgExportRequest({
  client,
  headers,
  projectId,
  request,
  workspaceId,
}: {
  client: any;
  headers: Headers;
  projectId: string;
  request: Request;
  workspaceId: string;
}) {
  const outgoing = responseHeaders(headers);
  try {
    if (request.method === "GET") {
      const { scope, jobId } = parseNativeDrawingDwgStatusScope(
        request,
        projectId,
        workspaceId,
      );
      const status = await getNativeDrawingDwgExportStatus(
        client,
        scope,
        jobId,
      );
      return Response.json(status, { headers: outgoing });
    }
    if (request.method !== "POST")
      throw new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST" },
      });
    if (request.headers.get("origin") !== new URL(request.url).origin)
      throw new Response("DWG 요청 출처를 확인할 수 없습니다.", {
        status: 403,
      });
    const route = parseRouteScope(projectId, workspaceId);
    let parsed: z.infer<typeof RequestSchema>;
    try {
      parsed = RequestSchema.parse(await readBoundedJson(request));
    } catch (error) {
      if (error instanceof Response) throw error;
      throw new Response("DWG 요청이 올바르지 않습니다.", { status: 400 });
    }
    if (
      parsed.projectId !== route.projectId ||
      parsed.documentId !== route.documentId
    )
      throw new Response("DWG 요청 범위가 URL과 일치하지 않습니다.", {
        status: 409,
      });
    const accepted = await requestNativeDrawingDwgExport(client, parsed);
    return Response.json(accepted, { status: 202, headers: outgoing });
  } catch (error) {
    throw mergeResponseHeaders(boundedError(error), outgoing);
  }
}

export async function nativeDrawingDwgExportRouteRequest({
  request,
  params,
}: {
  request: Request;
  params: { projectId?: string; workspaceId?: string };
}) {
  let context: Awaited<ReturnType<typeof drawingContext>>;
  try {
    context = await drawingContext(request, params.projectId!);
  } catch (error) {
    const headers =
      error instanceof Response ? new Headers(error.headers) : new Headers();
    throw mergeResponseHeaders(boundedError(error), responseHeaders(headers));
  }
  const { client, headers } = context;
  return handleNativeDrawingDwgExportRequest({
    client,
    headers,
    projectId: params.projectId!,
    request,
    workspaceId: params.workspaceId!,
  });
}
