import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import { getNativeDrawingDwgResaveDownloadDescriptor } from "./drawing-native-dwg-resave-artifact-jobs.server";
import { NativeDrawingDwgResaveJobError } from "./drawing-native-dwg-resave-jobs.server";
import {
  nativeDwgResaveError,
  nativeDwgResaveHeaders,
  parseNativeDwgResaveQuery,
} from "./drawing-native-dwg-resave-resource.server";

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
type Scope = ReturnType<typeof parseNativeDwgResaveQuery>["scope"];

export async function handleNativeDrawingDwgResaveDownload(
  {
    client,
    headers,
    jobId,
    kind,
    loadServiceClient,
    projectId,
    request,
    scope,
    workspaceId,
  }: {
    client: Parameters<typeof getNativeDrawingDwgResaveDownloadDescriptor>[0];
    headers: Headers;
    jobId: string;
    kind: string;
    loadServiceClient: () => Promise<ServiceClient>;
    projectId: string;
    request: Request;
    scope: Scope;
    workspaceId: string;
  },
  runtime: { downloadMilliseconds?: number } = {},
) {
  const outgoing = nativeDwgResaveHeaders(headers);
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(
    abort,
    Math.max(1, Math.min(runtime.downloadMilliseconds ?? 30_000, 30_000)),
  );
  let rejectAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(new Error("aborted"));
  });
  controller.signal.addEventListener("abort", rejectAbort, { once: true });
  request.signal.addEventListener("abort", abort, { once: true });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const cancel = () => {
    if (reader) void reader.cancel().catch(() => {});
  };
  controller.signal.addEventListener("abort", cancel, { once: true });
  try {
    if (request.signal.aborted) abort();
    const bytes = await Promise.race([
      aborted,
      (async () => {
        controller.signal.throwIfAborted();
        if (request.method !== "GET")
          throw new Response(null, { status: 405, headers: { Allow: "GET" } });
        const parsed = parseNativeDwgResaveQuery(
          request,
          projectId,
          workspaceId,
        );
        if (parsed.jobId !== null || !isDeepStrictEqual(parsed.scope, scope))
          throw new NativeDrawingDwgResaveJobError("invalid");
        const descriptor = await getNativeDrawingDwgResaveDownloadDescriptor(
          client,
          scope,
          jobId,
          kind,
          controller.signal,
        );
        const service = await loadServiceClient();
        controller.signal.throwIfAborted();
        const { data, error } = await service.storage
          .from(descriptor.bucket)
          .download(descriptor.path, {}, { signal: controller.signal })
          .asStream();
        if (controller.signal.aborted) {
          if (data) void data.cancel().catch(() => {});
          controller.signal.throwIfAborted();
        }
        if (error !== null || !data) throw new Error("storage");
        reader = data.getReader();
        const chunks: Uint8Array[] = [];
        const hash = createHash("sha256");
        let size = 0;
        while (true) {
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) break;
          size += value.byteLength;
          if (size > descriptor.byteSize) throw new Error("size");
          const copy = new Uint8Array(value);
          hash.update(copy);
          chunks.push(copy);
        }
        reader.releaseLock();
        reader = undefined;
        if (
          size !== descriptor.byteSize ||
          hash.digest("hex") !== descriptor.sha256
        )
          throw new Error("integrity");
        const current = await getNativeDrawingDwgResaveDownloadDescriptor(
          client,
          scope,
          jobId,
          kind,
          controller.signal,
        );
        if (!isDeepStrictEqual(descriptor, current))
          throw new Error("authorization");
        controller.signal.throwIfAborted();
        const result = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return result;
      })(),
    ]);
    controller.signal.throwIfAborted();
    const filenames: Record<string, string> = {
      dwg: "resaved-experimental.dwg",
      edit_request: "edit-request.json",
      authority: "authority.json",
      report: "native-report.json",
    };
    outgoing.set(
      "Content-Disposition",
      `attachment; filename="${filenames[kind]}"`,
    );
    outgoing.set(
      "Content-Type",
      kind === "dwg" ? "application/acad" : "application/json",
    );
    outgoing.set("Content-Length", String(bytes.byteLength));
    return new Response(bytes, { headers: outgoing });
  } catch (error) {
    cancel();
    throw mergeResponseHeaders(
      nativeDwgResaveError(
        error instanceof z.ZodError
          ? new NativeDrawingDwgResaveJobError("invalid")
          : error,
      ),
      outgoing,
    );
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
    controller.signal.removeEventListener("abort", cancel);
    // GET cleanup cannot extend the response deadline when a transport ignores abort.
  }
}

export async function nativeDrawingDwgResaveDownloadRouteRequest({
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
  let headers = new Headers();
  try {
    const context = await drawingContext(request, params.projectId!);
    headers = context.headers;
    const { scope } = parseNativeDwgResaveQuery(
      request,
      params.projectId,
      params.workspaceId,
    );
    // Generated database types predate the resave RPCs; the descriptor adapter validates them.
    return await handleNativeDrawingDwgResaveDownload({
      client: context.client as unknown as Parameters<
        typeof getNativeDrawingDwgResaveDownloadDescriptor
      >[0],
      headers,
      request,
      scope,
      projectId: params.projectId!,
      workspaceId: params.workspaceId!,
      jobId: params.jobId!,
      kind: params.kind!,
      loadServiceClient: async () =>
        (await import("~/core/lib/supa-admin-client.server")).default,
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
