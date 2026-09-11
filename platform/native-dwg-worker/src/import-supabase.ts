import { createHash } from "node:crypto";
import { isAbsolute, normalize } from "node:path";

import { z } from "zod";

import {
  NATIVE_DRAWING_DWG_IMPORT_LIMITS,
  NativeDrawingDwgImportClaimSchema,
  NativeDrawingDwgImportFailureReceiptSchema,
  NativeDrawingDwgImportReceiptSchema,
  NativeDrawingDwgImportSourceSchema,
  type NativeDrawingDwgImportRpcClient,
} from "../../app/lukas/lib/drawing-native-dwg-import-jobs.server.ts";
import {
  NativeDrawingDwgImportCompletionUncertainError,
  NativeDrawingDwgImportPublicationRejectedError,
  NativeDrawingDwgImportStaleLeaseError,
  type NativeDrawingDwgImportWorkerDependencies,
} from "../../app/lukas/lib/drawing-native-dwg-import-worker.server.ts";
import { runIsolatedNativeDrawingDwgReader } from "../../app/lukas/lib/drawing-native-dwg-sandbox.server.ts";

const ReaderImageId = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const AttemptNumber = z.number().int().min(1).max(3);
const FailureCode = z.enum([
  "source_unavailable",
  "source_mismatch",
  "reader_failed",
  "report_invalid",
  "worker_interrupted",
  "authority_revoked",
]);
const SupabaseOrigin = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      (url.pathname === "" || url.pathname === "/")
    );
  })
  .transform((value) => new URL(value).origin);
const DockerHost = z.string().refine((value) => {
  if (!/^unix:\/\/\/[^\0\r\n?#%]+$/.test(value)) return false;
  const socket = value.slice("unix://".length);
  return (
    isAbsolute(socket) &&
    normalize(socket) === socket &&
    !socket.startsWith("//")
  );
});
const BaseConfigSchema = z
  .object({
    supabaseUrl: SupabaseOrigin,
    serviceRoleKey: z.string().min(1).max(16_384),
  })
  .strict();
const WorkerConfigSchema = BaseConfigSchema.extend({
  readerImageId: ReaderImageId,
  dockerPath: z.string().refine(isAbsolute),
  dockerHost: DockerHost,
  leaseSeconds: z
    .number()
    .int()
    .min(NATIVE_DRAWING_DWG_IMPORT_LIMITS.minimumLeaseSeconds)
    .max(NATIVE_DRAWING_DWG_IMPORT_LIMITS.maximumLeaseSeconds)
    .default(NATIVE_DRAWING_DWG_IMPORT_LIMITS.defaultLeaseSeconds),
}).strict();

type Runtime = {
  fetch?: typeof fetch;
  readSource?: typeof runIsolatedNativeDrawingDwgReader;
};

/** A Supabase SDK fetch boundary that cannot follow service-auth redirects. */
export function createNativeDrawingDwgImportRpcFetch(
  rawOrigin: string,
  request: typeof fetch = fetch,
): typeof fetch {
  const origin = SupabaseOrigin.parse(rawOrigin);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const requestUrl = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (requestUrl.origin !== origin)
        throw new Error("Native DWG import RPC origin is invalid.");
      const response = await request(input, { ...init, redirect: "error" });
      if (response.redirected || new URL(response.url).origin !== origin) {
        await cancelBody(response);
        throw new Error("Native DWG import RPC origin changed.");
      }
      return response;
    } catch {
      throw new Error("Native DWG import RPC transport failed.");
    }
  }) as typeof fetch;
}

function storageObjectUrl(origin: string, path: string) {
  return `${origin}/storage/v1/object/lukas-qto/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

async function cancelBody(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

async function readExactBody(
  response: Response,
  expectedBytes: number,
  signal: AbortSignal,
) {
  const declared = response.headers.get("content-length");
  if (
    response.status !== 200 ||
    response.redirected ||
    (declared !== null &&
      (!/^\d+$/.test(declared) || Number(declared) !== expectedBytes)) ||
    expectedBytes < 1 ||
    expectedBytes > NATIVE_DRAWING_DWG_IMPORT_LIMITS.sourceBytes ||
    !response.body
  ) {
    await cancelBody(response);
    throw new Error("invalid source response");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error("source response aborted");
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > expectedBytes)
        throw new Error("source response exceeded size");
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedBytes) throw new Error("source response was truncated");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createNativeDrawingDwgImportSourceTransport(
  rawConfig: { supabaseUrl: string; serviceRoleKey: string },
  runtime: Pick<Runtime, "fetch"> = {},
) {
  const config = BaseConfigSchema.parse(rawConfig);
  const request = runtime.fetch ?? fetch;
  const headers = Object.freeze({
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
  });
  return {
    async downloadSource(input: {
      source: unknown;
      signal: AbortSignal;
    }): Promise<Uint8Array> {
      try {
        const source = NativeDrawingDwgImportSourceSchema.parse(input.source);
        if (!(input.signal instanceof AbortSignal) || input.signal.aborted)
          throw new Error("source download aborted");
        const expectedUrl = storageObjectUrl(config.supabaseUrl, source.path);
        const response = await request(expectedUrl, {
          method: "GET",
          headers,
          redirect: "error",
          signal: input.signal,
        });
        if (new URL(response.url).origin !== config.supabaseUrl) {
          await cancelBody(response);
          throw new Error("source origin changed");
        }
        return await readExactBody(response, source.byteSize, input.signal);
      } catch {
        throw new Error("Native DWG import source download failed.");
      }
    },
  };
}

function code(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : "";
}

function rpcBuilder(
  client: NativeDrawingDwgImportRpcClient,
  name: string,
  args: Record<string, unknown>,
  signal: AbortSignal,
) {
  if (!client || typeof client.rpc !== "function")
    throw new Error("Native DWG import RPC transport is invalid.");
  const builder = client.rpc(name, args);
  if (!builder || typeof builder.abortSignal !== "function")
    throw new Error("Native DWG import RPC transport is invalid.");
  return builder.abortSignal(signal);
}

export function createSupabaseNativeDrawingDwgImportDependencies(
  client: NativeDrawingDwgImportRpcClient,
  rawConfig: {
    supabaseUrl: string;
    serviceRoleKey: string;
    readerImageId: string;
    dockerPath: string;
    dockerHost: string;
    leaseSeconds?: number;
  },
  runtime: Runtime = {},
): NativeDrawingDwgImportWorkerDependencies {
  const config = WorkerConfigSchema.parse(rawConfig);
  if (!client || typeof client.rpc !== "function")
    throw new Error("Native DWG import RPC transport is invalid.");
  const storage = createNativeDrawingDwgImportSourceTransport(
    {
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
    },
    runtime,
  );
  const nativeRead = runtime.readSource ?? runIsolatedNativeDrawingDwgReader;
  return {
    async claim({ signal }) {
      try {
        if (signal.aborted) throw new Error("aborted");
        const result = await rpcBuilder(
          client,
          "lukas_drawing_claim_native_dwg_import",
          {
            p_reader_image_id: config.readerImageId,
            p_lease_seconds: config.leaseSeconds,
          },
          signal,
        );
        if (signal.aborted || result.error) throw new Error("claim rejected");
        if (result.data === null) return null;
        const claim = NativeDrawingDwgImportClaimSchema.parse(result.data);
        if (claim.readerImageId !== config.readerImageId)
          throw new Error("claim image mismatch");
        return claim;
      } catch {
        throw new Error("Native DWG import claim failed.");
      }
    },
    downloadSource(input) {
      return storage.downloadSource(input);
    },
    readSource(input) {
      return nativeRead({
        dockerPath: config.dockerPath,
        dockerHost: config.dockerHost,
        imageId: config.readerImageId,
        sourceBytes: input.sourceBytes,
        expectedSource: input.expectedSource,
        timeoutMilliseconds: input.timeoutMilliseconds,
        signal: input.signal,
      });
    },
    async complete(input) {
      let args: {
        p_job_id: string;
        p_attempt_number: number;
        p_lease_token: string;
        p_reader_image_id: string;
        p_report_text: string;
        p_report_sha256: string;
      };
      try {
        args = {
          p_job_id: Uuid.parse(input.jobId),
          p_attempt_number: AttemptNumber.parse(input.attemptNumber),
          p_lease_token: Uuid.parse(input.leaseToken),
          p_reader_image_id: ReaderImageId.parse(input.readerImageId),
          p_report_text: z
            .string()
            .min(1)
            .refine(
              (value) =>
                Buffer.byteLength(value, "utf8") <=
                NATIVE_DRAWING_DWG_IMPORT_LIMITS.reportBytes,
            )
            .parse(input.reportText),
          p_report_sha256: Sha256.parse(input.reportSha256),
        };
        if (
          args.p_reader_image_id !== config.readerImageId ||
          createHash("sha256").update(args.p_report_text).digest("hex") !==
            args.p_report_sha256
        )
          throw new Error("publication identity mismatch");
      } catch {
        throw new NativeDrawingDwgImportPublicationRejectedError();
      }
      let result: { data: unknown; error: unknown };
      try {
        result = await rpcBuilder(
          client,
          "lukas_drawing_complete_native_dwg_import",
          args,
          input.signal,
        );
      } catch {
        throw new NativeDrawingDwgImportCompletionUncertainError();
      }
      if (result.error) {
        if (code(result.error) === "PNI03")
          throw new NativeDrawingDwgImportStaleLeaseError();
        if (code(result.error) === "PNI04")
          throw new NativeDrawingDwgImportPublicationRejectedError();
        throw new NativeDrawingDwgImportCompletionUncertainError();
      }
      try {
        return NativeDrawingDwgImportReceiptSchema.parse(result.data);
      } catch {
        throw new NativeDrawingDwgImportCompletionUncertainError();
      }
    },
    async fail(input) {
      let result: { data: unknown; error: unknown };
      try {
        result = await rpcBuilder(
          client,
          "lukas_drawing_fail_native_dwg_import",
          {
            p_job_id: Uuid.parse(input.jobId),
            p_attempt_number: AttemptNumber.parse(input.attemptNumber),
            p_lease_token: Uuid.parse(input.leaseToken),
            p_failure_code: FailureCode.parse(input.failureCode),
            p_retryable: z.boolean().parse(input.retryable),
          },
          input.signal,
        );
      } catch (error) {
        if (error instanceof NativeDrawingDwgImportStaleLeaseError) throw error;
        throw new Error("Native DWG import failure acknowledgement failed.");
      }
      if (result.error) {
        if (code(result.error) === "PNI03")
          throw new NativeDrawingDwgImportStaleLeaseError();
        throw new Error("Native DWG import failure acknowledgement failed.");
      }
      try {
        return NativeDrawingDwgImportFailureReceiptSchema.parse(result.data);
      } catch {
        throw new Error("Native DWG import failure acknowledgement failed.");
      }
    },
  };
}
