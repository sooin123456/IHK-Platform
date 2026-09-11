import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  NATIVE_DWG_WORKER_LIMITS,
  runNativeDrawingDwgWriter,
  type NativeDwgWorkerDependencies,
} from "../../app/lukas/lib/drawing-native-dwg-worker.server.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const PositiveSafeInteger = z.number().int().positive().safe();
const ScopeSchema = z
  .object({
    projectId: Uuid,
    documentId: Uuid,
    revisionId: Uuid,
    revisionVersion: PositiveSafeInteger,
    canvasId: Uuid,
    snapshotSha256: Sha256,
  })
  .strict();
const KindSchema = z.enum(["dwg", "source_manifest", "authority", "report"]);
const ResaveKindSchema = z.enum(["dwg", "edit_request", "authority", "report"]);
const ArtifactSchema = z
  .object({ kind: KindSchema, sha256: Sha256, byteSize: PositiveSafeInteger })
  .strict();
const StagedArtifactSchema = ArtifactSchema.extend({
  path: z
    .string()
    .min(1)
    .max(1_000)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.includes("//") &&
        !/(^|\/)\.\.?(\/|$)/.test(value),
    ),
}).strict();
const ClaimSchema = z
  .object({
    jobId: Uuid,
    projectId: Uuid,
    attempt: z.number().int().min(1).max(3),
    leaseToken: Uuid,
    leaseExpiresAt: z.string().datetime({ offset: true }),
    writerBuildSha256: Sha256,
    source: z.object({ request: ScopeSchema, payload: z.unknown() }).strict(),
  })
  .strict();
const ReceiptSchema = z
  .object({
    jobId: Uuid,
    attempt: z.number().int().min(1).max(3),
    qualification: z.literal("experimental-unqualified"),
    source: ScopeSchema,
    writerBuildSha256: Sha256,
    structureSha256: Sha256,
    artifacts: z.array(ArtifactSchema).length(4),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
const ConfigSchema = z
  .object({
    supabaseUrl: z
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
      .transform((value) => new URL(value).origin),
    serviceRoleKey: z.string().min(1).max(16_384),
    dotnetPath: z.string().refine(isAbsolute),
    publishedDirectory: z.string().refine(isAbsolute),
    writerBuildSha256: Sha256,
    leaseSeconds: z
      .number()
      .int()
      .min(30)
      .max(NATIVE_DWG_WORKER_LIMITS.leaseSeconds),
  })
  .strict();
const artifactLimits = {
  dwg: NATIVE_DWG_WORKER_LIMITS.dwgBytes,
  source_manifest: NATIVE_DWG_WORKER_LIMITS.sourceManifestBytes,
  authority: NATIVE_DWG_WORKER_LIMITS.authorityBytes,
  report: NATIVE_DWG_WORKER_LIMITS.reportBytes,
} as const;
const resaveArtifactLimits = {
  dwg: 209715200,
  edit_request: 2097152,
  authority: 67108864,
  report: 1048576,
} as const;
const resaveFilenames = {
  dwg: "resaved.dwg",
  edit_request: "edit-request.json",
  authority: "authority.json",
  report: "native-report.json",
} as const;
const ResavePathPattern = new RegExp(
  "^projects/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
    "native-dwg-resave/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/" +
    "([1-3])/([0-9a-f]{64})/([^/]+)$",
);

type WorkerClient = Pick<SupabaseClient<any>, "rpc">;
type AdapterRuntime = {
  convert?: typeof runNativeDrawingDwgWriter;
  fetch?: typeof fetch;
  artifactLimits?: Partial<Record<z.infer<typeof KindSchema>, number>>;
};

type RpcResult = { data: unknown; error: unknown };
type RpcBuilder = {
  abortSignal(signal: AbortSignal): PromiseLike<RpcResult>;
};

export class NativeDwgUncertainUploadError extends Error {
  constructor() {
    super("Native DWG upload completion is uncertain.");
    this.name = "NativeDwgUncertainUploadError";
  }
}

export class NativeDwgConfirmedUploadError extends Error {
  constructor() {
    super("Native DWG upload was definitely rejected before any write.");
    this.name = "NativeDwgConfirmedUploadError";
  }
}

function rpcData(result: { data: unknown; error: unknown }, message: string) {
  if (result.error) throw new Error(message);
  return result.data;
}

function ensureActive(signal: AbortSignal) {
  if (signal.aborted) throw new Error("Native DWG worker operation aborted.");
}

function rpcWithSignal(
  client: WorkerClient,
  name: string,
  arguments_: Record<string, unknown>,
  signal: AbortSignal,
) {
  const builder = client.rpc(
    name as never,
    arguments_ as never,
  ) as unknown as RpcBuilder;
  if (!builder || typeof builder.abortSignal !== "function")
    throw new Error("Native DWG RPC transport is invalid.");
  return builder.abortSignal(signal);
}

function configuredArtifactLimits(
  kinds: readonly string[],
  maximums: Record<string, number>,
  override: Record<string, number> = {},
) {
  const result = { ...maximums };
  for (const kind of kinds) {
    const value = override[kind];
    if (value !== undefined) {
      if (!Number.isSafeInteger(value) || value < 1 || value > maximums[kind])
        throw new Error("Native DWG Storage limits are invalid.");
      result[kind] = value;
    }
  }
  return result;
}

function scopedStorageSignal(parent: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted) controller.abort();
  else parent.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, NATIVE_DWG_WORKER_LIMITS.storageMilliseconds);
  timer.unref?.();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener("abort", abort);
    },
  };
}

async function readBoundedBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const parsed = Number(contentLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Native DWG Storage response is too large.");
    }
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Native DWG Storage response is too large.");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function storageObjectUrl(baseUrl: string, path: string) {
  return `${baseUrl}/storage/v1/object/lukas-qto/${path
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
}

type StorageProfile =
  | {
      imported: false;
      kinds: typeof KindSchema.options;
      limits: typeof artifactLimits;
    }
  | {
      imported: true;
      kinds: typeof ResaveKindSchema.options;
      limits: typeof resaveArtifactLimits;
    };

function parseStorageInput(
  profile: StorageProfile,
  input: { kind: unknown; path: unknown; bytes?: Uint8Array },
  limits: Record<string, number>,
) {
  const kind = (profile.imported ? ResaveKindSchema : KindSchema).parse(
    input.kind,
  ) as keyof typeof limits & string;
  const path = StagedArtifactSchema.shape.path.parse(input.path);
  if (profile.imported) {
    const match = ResavePathPattern.exec(path);
    if (
      !match ||
      match[5] !== resaveFilenames[kind as keyof typeof resaveFilenames] ||
      (input.bytes &&
        createHash("sha256").update(input.bytes).digest("hex") !== match[4])
    )
      throw new Error("invalid upload path");
  }
  if (input.bytes) {
    const minimum = profile.imported && kind === "dwg" ? 6 : 1;
    if (
      input.bytes.byteLength < minimum ||
      input.bytes.byteLength > limits[kind]
    )
      throw new Error("invalid upload size");
  }
  return { kind, path };
}

function createStorageTransport(
  rawConfig: { supabaseUrl: string; serviceRoleKey: string },
  runtime: { fetch?: typeof fetch; artifactLimits?: Record<string, number> },
  profile: StorageProfile,
) {
  const config = ConfigSchema.pick({
    supabaseUrl: true,
    serviceRoleKey: true,
  }).parse(rawConfig);
  const request = runtime.fetch ?? fetch;
  const limits = configuredArtifactLimits(
    profile.kinds,
    profile.limits,
    runtime.artifactLimits,
  );
  const headers = {
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
  };
  return {
    async upload(input: {
      kind: string;
      path: string;
      bytes: Uint8Array;
      signal: AbortSignal;
    }): Promise<"uploaded" | "exists"> {
      const scoped = scopedStorageSignal(input.signal);
      try {
        let parsed: ReturnType<typeof parseStorageInput>;
        let body: Buffer;
        try {
          parsed = parseStorageInput(profile, input, limits);
          body = Buffer.from(input.bytes);
          if (profile.imported && scoped.signal.aborted)
            throw new Error("aborted before upload");
        } catch (error) {
          if (profile.imported) throw new NativeDwgConfirmedUploadError();
          throw error;
        }
        let pending: Promise<Response>;
        try {
          pending = request(storageObjectUrl(config.supabaseUrl, parsed.path), {
            method: "POST",
            headers: {
              ...headers,
              "cache-control": "max-age=0",
              "content-type":
                parsed.kind === "dwg"
                  ? "application/octet-stream"
                  : "application/json",
              "x-upsert": "false",
            },
            body: body as unknown as BodyInit,
            signal: scoped.signal,
          });
        } catch {
          if (profile.imported) throw new NativeDwgConfirmedUploadError();
          throw new NativeDwgUncertainUploadError();
        }
        let response: Response;
        let responseBytes: Uint8Array;
        try {
          response = await pending;
          responseBytes = await readBoundedBody(
            response,
            NATIVE_DWG_WORKER_LIMITS.processOutputBytes,
          );
        } catch {
          throw new NativeDwgUncertainUploadError();
        }
        if (response.ok) return "uploaded";
        let errorCode: unknown;
        try {
          const error = JSON.parse(
            Buffer.from(responseBytes).toString("utf8"),
          ) as Record<string, unknown>;
          errorCode = error.code ?? error.error;
        } catch {
          errorCode = undefined;
        }
        if (
          (response.status === 400 || response.status === 409) &&
          (errorCode === "Duplicate" || errorCode === "ResourceAlreadyExists")
        )
          return "exists";
        if (profile.imported) throw new NativeDwgConfirmedUploadError();
        throw new Error("Native DWG upload failed.");
      } finally {
        scoped.dispose();
      }
    },
    async read(input: {
      kind: string;
      path: string;
      signal: AbortSignal;
    }): Promise<Uint8Array> {
      const scoped = scopedStorageSignal(input.signal);
      try {
        const { kind, path } = parseStorageInput(profile, input, limits);
        const response = await request(
          storageObjectUrl(config.supabaseUrl, path),
          {
            method: "GET",
            headers,
            signal: scoped.signal,
          },
        );
        const bytes = await readBoundedBody(
          response,
          response.ok
            ? limits[kind]
            : NATIVE_DWG_WORKER_LIMITS.processOutputBytes,
        );
        if (!response.ok || bytes.byteLength < 1)
          throw new Error("read rejected");
        return bytes;
      } catch {
        throw new Error("Native DWG readback failed.");
      } finally {
        scoped.dispose();
      }
    },
  };
}

export function createNativeDwgStorageTransport(
  rawConfig: { supabaseUrl: string; serviceRoleKey: string },
  runtime: Pick<AdapterRuntime, "fetch" | "artifactLimits"> = {},
) {
  return createStorageTransport(rawConfig, runtime, {
    imported: false,
    kinds: KindSchema.options,
    limits: artifactLimits,
  }) as {
    upload(input: {
      kind: z.infer<typeof KindSchema>;
      path: string;
      bytes: Uint8Array;
      signal: AbortSignal;
    }): Promise<"uploaded" | "exists">;
    read(input: {
      kind: z.infer<typeof KindSchema>;
      path: string;
      signal: AbortSignal;
    }): Promise<Uint8Array>;
  };
}

export function createNativeDwgResaveStorageTransport(
  rawConfig: { supabaseUrl: string; serviceRoleKey: string },
  runtime: {
    fetch?: typeof fetch;
    artifactLimits?: Partial<Record<z.infer<typeof ResaveKindSchema>, number>>;
  } = {},
) {
  return createStorageTransport(rawConfig, runtime, {
    imported: true,
    kinds: ResaveKindSchema.options,
    limits: resaveArtifactLimits,
  }) as {
    upload(input: {
      kind: z.infer<typeof ResaveKindSchema>;
      path: string;
      bytes: Uint8Array;
      signal: AbortSignal;
    }): Promise<"uploaded" | "exists">;
    read(input: {
      kind: z.infer<typeof ResaveKindSchema>;
      path: string;
      signal: AbortSignal;
    }): Promise<Uint8Array>;
  };
}

export function createSupabaseNativeDwgWorkerDependencies(
  client: WorkerClient,
  rawConfig: {
    supabaseUrl: string;
    serviceRoleKey: string;
    dotnetPath: string;
    publishedDirectory: string;
    writerBuildSha256: string;
    leaseSeconds: number;
  },
  runtime: AdapterRuntime = {},
): NativeDwgWorkerDependencies {
  const config = ConfigSchema.parse(rawConfig);
  const convert = runtime.convert ?? runNativeDrawingDwgWriter;
  const storage = createNativeDwgStorageTransport(
    {
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
    },
    runtime,
  );
  return {
    async claim({ signal }) {
      try {
        ensureActive(signal);
        const result = await rpcWithSignal(
          client,
          "lukas_drawing_claim_native_dwg_export",
          {
            p_writer_build_sha256: config.writerBuildSha256,
            p_lease_seconds: config.leaseSeconds,
          },
          signal,
        );
        ensureActive(signal);
        const data = rpcData(result, "Native DWG claim failed.");
        return data === null ? null : ClaimSchema.parse(data);
      } catch {
        throw new Error("Native DWG claim failed.");
      }
    },
    convert(input) {
      return convert({
        dotnetPath: config.dotnetPath,
        publishedDirectory: config.publishedDirectory,
        manifestBytes: input.manifestBytes,
        expectedWriterBuildSha256: input.expectedWriterBuildSha256,
        signal: input.signal,
      });
    },
    async stage(input) {
      try {
        ensureActive(input.signal);
        const artifacts = z
          .array(ArtifactSchema)
          .length(4)
          .parse(input.artifacts);
        const result = await rpcWithSignal(
          client,
          "lukas_drawing_stage_native_dwg_export",
          {
            p_job_id: Uuid.parse(input.jobId),
            p_attempt: z.number().int().min(1).max(3).parse(input.attempt),
            p_lease_token: Uuid.parse(input.leaseToken),
            p_structure_sha256: Sha256.parse(input.structureSha256),
            p_artifacts: artifacts,
          },
          input.signal,
        );
        ensureActive(input.signal);
        return z
          .array(StagedArtifactSchema)
          .length(4)
          .parse(rpcData(result, "Native DWG stage failed."));
      } catch {
        throw new Error("Native DWG stage failed.");
      }
    },
    async upload(input) {
      try {
        ensureActive(input.signal);
        const kind = KindSchema.parse(input.kind);
        const path = StagedArtifactSchema.shape.path.parse(input.path);
        if (
          input.bytes.byteLength < 1 ||
          input.bytes.byteLength > artifactLimits[kind]
        )
          throw new Error("invalid upload size");
        const result = await storage.upload({ ...input, kind, path });
        ensureActive(input.signal);
        return result;
      } catch (error) {
        if (error instanceof NativeDwgUncertainUploadError) throw error;
        throw new Error("Native DWG upload failed.");
      }
    },
    async read(input) {
      try {
        ensureActive(input.signal);
        const kind = KindSchema.parse(input.kind);
        const path = StagedArtifactSchema.shape.path.parse(input.path);
        const bytes = await storage.read({ ...input, kind, path });
        ensureActive(input.signal);
        return bytes;
      } catch {
        throw new Error("Native DWG readback failed.");
      }
    },
    async settle(input) {
      try {
        ensureActive(input.signal);
        const result = await rpcWithSignal(
          client,
          "lukas_drawing_settle_native_dwg_upload",
          {
            p_job_id: Uuid.parse(input.jobId),
            p_attempt: z.number().int().min(1).max(3).parse(input.attempt),
            p_lease_token: Uuid.parse(input.leaseToken),
          },
          input.signal,
        );
        ensureActive(input.signal);
        return z
          .literal("closed")
          .parse(rpcData(result, "Native DWG settle failed."));
      } catch {
        throw new Error("Native DWG settle failed.");
      }
    },
    async publish(input) {
      try {
        ensureActive(input.signal);
        const result = await rpcWithSignal(
          client,
          "lukas_drawing_publish_native_dwg_export",
          {
            p_job_id: Uuid.parse(input.jobId),
            p_attempt: z.number().int().min(1).max(3).parse(input.attempt),
            p_lease_token: Uuid.parse(input.leaseToken),
          },
          input.signal,
        );
        ensureActive(input.signal);
        return ReceiptSchema.parse(
          rpcData(result, "Native DWG publication failed."),
        );
      } catch {
        throw new Error("Native DWG publication failed.");
      }
    },
    async fail(input) {
      try {
        ensureActive(input.signal);
        const result = await rpcWithSignal(
          client,
          "lukas_drawing_fail_native_dwg_export",
          {
            p_job_id: Uuid.parse(input.jobId),
            p_attempt: z.number().int().min(1).max(3).parse(input.attempt),
            p_lease_token: Uuid.parse(input.leaseToken),
            p_error_code: z
              .enum([
                "source_unavailable",
                "lease_expired",
                "conversion_failed",
                "verification_failed",
                "upload_failed",
                "publication_failed",
                "budget_exceeded",
              ])
              .parse(input.errorCode),
            p_retryable: z.boolean().parse(input.retryable),
          },
          input.signal,
        );
        ensureActive(input.signal);
        return z
          .enum(["retry_wait", "failed", "stale"])
          .parse(rpcData(result, "Native DWG failure acknowledgement failed."));
      } catch {
        throw new Error("Native DWG failure acknowledgement failed.");
      }
    },
  };
}
