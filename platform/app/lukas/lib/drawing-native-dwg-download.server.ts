import { createHash } from "node:crypto";

import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import {
  NativeDrawingDwgJobError,
  NativeDrawingDwgKindSchema,
  resolveNativeDrawingDwgDownload,
  type NativeDrawingDwgDescriptor,
  type NativeDrawingDwgKind,
  type NativeDrawingDwgScope,
} from "~/lukas/lib/drawing-native-dwg-jobs.server";
import { parseNativeDrawingDwgStatusScope } from "./drawing-native-dwg-export.server";

const MAX_BYTES: Record<NativeDrawingDwgKind, number> = {
  dwg: 100 * 1024 * 1024,
  source_manifest: 20 * 1024 * 1024,
  authority: 20 * 1024 * 1024,
  report: 32 * 1024 * 1024,
};
const FILES: Record<
  NativeDrawingDwgKind,
  { stored: string; download: string; mime: string }
> = {
  dwg: {
    stored: "native.dwg",
    download: "drawing-experimental.dwg",
    mime: "application/acad",
  },
  source_manifest: {
    stored: "source-manifest.json",
    download: "drawing-experimental-source-manifest.json",
    mime: "application/json",
  },
  authority: {
    stored: "authority.json",
    download: "drawing-experimental-authority.json",
    mime: "application/json",
  },
  report: {
    stored: "native-report.json",
    download: "drawing-experimental-native-report.json",
    mime: "application/json",
  },
};

type ServiceClient = {
  storage: {
    from(bucket: string): {
      download(
        path: string,
        options: Record<string, never>,
        parameters: { signal: AbortSignal },
      ): {
        asStream(): PromiseLike<{
          data: ReadableStream<Uint8Array> | null;
          error: unknown;
        }>;
      };
    };
  };
};

function secureHeaders(headers: Headers) {
  const result = new Headers(headers);
  result.set("Cache-Control", "private, no-store");
  result.set("Referrer-Policy", "no-referrer");
  result.set("X-Content-Type-Options", "nosniff");
  return result;
}

function boundedDownloadError(error: unknown) {
  if (error instanceof Response) return error;
  if (error instanceof NativeDrawingDwgJobError)
    return new Response(
      error.kind === "invalid"
        ? "DWG 다운로드 요청이 올바르지 않습니다."
        : "완료된 DWG 내보내기 파일을 찾을 수 없습니다.",
      { status: error.kind === "invalid" ? 400 : 404 },
    );
  return new Response("검증된 DWG 파일을 불러오지 못했습니다.", {
    status: 503,
  });
}

function assertManagedDescriptor(
  descriptor: NativeDrawingDwgDescriptor,
  scope: NativeDrawingDwgScope,
) {
  const file = FILES[descriptor.kind];
  if (descriptor.byteSize > MAX_BYTES[descriptor.kind]) throw new Error("size");
  const prefix = `projects/${scope.projectId}/native-dwg/${descriptor.jobId}/`;
  if (!descriptor.path.startsWith(prefix)) throw new Error("path");
  const suffix = descriptor.path.slice(prefix.length).split("/");
  if (
    suffix.length !== 3 ||
    !/^[1-3]$/.test(suffix[0]) ||
    !Number.isSafeInteger(Number(suffix[0])) ||
    suffix[1] !== descriptor.sha256 ||
    suffix[2] !== file.stored
  )
    throw new Error("path");
}

async function readVerifiedBytes(
  serviceClient: ServiceClient,
  descriptor: NativeDrawingDwgDescriptor,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const { data: stream, error } = await serviceClient.storage
    .from(descriptor.bucket)
    .download(descriptor.path, {}, { signal })
    .asStream();
  if (error || !stream) throw new Error("storage");
  const reader = stream.getReader();
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    cancellation ??= reader.cancel().catch(() => {});
  };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  const hash = createHash("sha256");
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > descriptor.byteSize || size > MAX_BYTES[descriptor.kind]) {
        await reader.cancel();
        throw new Error("size");
      }
      hash.update(value);
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    await cancellation;
    reader.releaseLock();
  }
  if (size !== descriptor.byteSize || hash.digest("hex") !== descriptor.sha256)
    throw new Error("integrity");
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function sameDescriptor(
  first: NativeDrawingDwgDescriptor,
  second: NativeDrawingDwgDescriptor,
) {
  return (
    first.jobId === second.jobId &&
    first.kind === second.kind &&
    first.bucket === second.bucket &&
    first.path === second.path &&
    first.sha256 === second.sha256 &&
    first.byteSize === second.byteSize
  );
}

export async function handleNativeDrawingDwgDownload(
  {
    client,
    headers,
    jobId,
    kind: rawKind,
    loadServiceClient,
    projectId,
    request,
    scope,
    workspaceId,
  }: {
    client: any;
    headers: Headers;
    jobId: string;
    kind: string;
    loadServiceClient: () => Promise<ServiceClient>;
    projectId: string;
    request: Request;
    scope: NativeDrawingDwgScope;
    workspaceId: string;
  },
  runtime: { downloadMilliseconds?: number } = {},
) {
  const outgoing = secureHeaders(headers);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const milliseconds = runtime.downloadMilliseconds ?? 30_000;
  const timer = setTimeout(abort, Math.max(1, Math.min(milliseconds, 30_000)));
  timer.unref?.();
  if (request.signal.aborted) abort();
  else request.signal.addEventListener("abort", abort, { once: true });
  try {
    controller.signal.throwIfAborted();
    if (request.method !== "GET")
      throw new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET" },
      });
    const expectedSearch = {
      revisionId: scope.revisionId,
      revisionVersion: String(scope.revisionVersion),
      canvasId: scope.canvasId,
      snapshotSha256: scope.snapshotSha256,
    };
    const search = new URL(request.url).searchParams;
    if (
      [...search.keys()].some((key) => !(key in expectedSearch)) ||
      Object.entries(expectedSearch).some(
        ([key, value]) =>
          search.getAll(key).length !== 1 || search.get(key) !== value,
      )
    )
      throw new NativeDrawingDwgJobError("invalid");
    if (scope.projectId !== projectId || scope.documentId !== workspaceId)
      throw new NativeDrawingDwgJobError("invalid");
    const parsedKind = NativeDrawingDwgKindSchema.safeParse(rawKind);
    if (!parsedKind.success) throw new NativeDrawingDwgJobError("invalid");
    const kind = parsedKind.data;
    const descriptor = await resolveNativeDrawingDwgDownload(
      client,
      scope,
      jobId,
      kind,
      controller.signal,
    );
    assertManagedDescriptor(descriptor, scope);
    const serviceClient = await loadServiceClient();
    const bytes = await readVerifiedBytes(
      serviceClient,
      descriptor,
      controller.signal,
    );
    const current = await resolveNativeDrawingDwgDownload(
      client,
      scope,
      jobId,
      kind,
      controller.signal,
    );
    assertManagedDescriptor(current, scope);
    if (!sameDescriptor(descriptor, current))
      throw new Error("reauthorization");
    controller.signal.throwIfAborted();
    const file = FILES[kind];
    outgoing.set(
      "Content-Disposition",
      `attachment; filename="${file.download}"`,
    );
    outgoing.set("Content-Length", String(bytes.byteLength));
    outgoing.set("Content-Type", file.mime);
    return new Response(bytes, { headers: outgoing });
  } catch (error) {
    throw mergeResponseHeaders(boundedDownloadError(error), outgoing);
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
  }
}

export async function nativeDrawingDwgDownloadRouteRequest({
  request,
  params,
}: {
  request: Request;
  params: {
    projectId?: string;
    workspaceId?: string;
    jobId?: string;
    kind?: string;
  };
}) {
  let context: Awaited<ReturnType<typeof drawingContext>>;
  try {
    context = await drawingContext(request, params.projectId!);
  } catch (error) {
    const headers =
      error instanceof Response ? new Headers(error.headers) : new Headers();
    throw mergeResponseHeaders(
      boundedDownloadError(error),
      secureHeaders(headers),
    );
  }
  const { client, headers } = context;
  try {
    const { scope } = parseNativeDrawingDwgStatusScope(
      request,
      params.projectId,
      params.workspaceId,
    );
    return await handleNativeDrawingDwgDownload({
      client,
      headers,
      jobId: params.jobId!,
      kind: params.kind!,
      loadServiceClient: async () =>
        (await import("~/core/lib/supa-admin-client.server")).default,
      projectId: params.projectId!,
      request,
      scope,
      workspaceId: params.workspaceId!,
    });
  } catch (error) {
    throw mergeResponseHeaders(
      boundedDownloadError(error),
      secureHeaders(headers),
    );
  }
}
