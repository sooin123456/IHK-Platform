import { createClient } from "@supabase/supabase-js";
import { isAbsolute, normalize } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { NATIVE_DRAWING_DWG_IMPORT_LIMITS } from "../../app/lukas/lib/drawing-native-dwg-import-jobs.server.ts";
import { runNativeDrawingDwgImportWorkerOnce } from "../../app/lukas/lib/drawing-native-dwg-import-worker.server.ts";
import {
  createNativeDrawingDwgImportRpcFetch,
  createSupabaseNativeDrawingDwgImportDependencies,
} from "./import-supabase.ts";

const DockerHost = z.string().refine((value) => {
  if (!/^unix:\/\/\/[^\0\r\n?#%]+$/.test(value)) return false;
  const socket = value.slice("unix://".length);
  return (
    isAbsolute(socket) &&
    normalize(socket) === socket &&
    !socket.startsWith("//")
  );
});
const EnvironmentSchema = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).max(16_384),
    NATIVE_DWG_READER_IMAGE_ID: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    NATIVE_DWG_DOCKER_PATH: z.string().refine(isAbsolute),
    NATIVE_DWG_DOCKER_HOST: DockerHost,
    NATIVE_DWG_IMPORT_LEASE_SECONDS: z.coerce
      .number()
      .int()
      .min(NATIVE_DRAWING_DWG_IMPORT_LIMITS.minimumLeaseSeconds)
      .max(NATIVE_DRAWING_DWG_IMPORT_LIMITS.maximumLeaseSeconds)
      .optional(),
    NATIVE_DWG_IMPORT_POLL_MILLISECONDS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .optional(),
  })
  .strip();

export function parseNativeDrawingDwgImportWorkerConfig(
  environment: NodeJS.ProcessEnv,
) {
  try {
    const value = EnvironmentSchema.parse(environment);
    const url = new URL(value.SUPABASE_URL);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      (url.pathname !== "" && url.pathname !== "/")
    )
      throw new Error("invalid origin");
    return {
      supabaseUrl: url.origin,
      serviceRoleKey: value.SUPABASE_SERVICE_ROLE_KEY,
      readerImageId: value.NATIVE_DWG_READER_IMAGE_ID,
      dockerPath: value.NATIVE_DWG_DOCKER_PATH,
      dockerHost: value.NATIVE_DWG_DOCKER_HOST,
      leaseSeconds:
        value.NATIVE_DWG_IMPORT_LEASE_SECONDS ??
        NATIVE_DRAWING_DWG_IMPORT_LIMITS.defaultLeaseSeconds,
      pollMilliseconds: value.NATIVE_DWG_IMPORT_POLL_MILLISECONDS ?? 1_000,
    };
  } catch {
    throw new Error("Native DWG import worker configuration is invalid.");
  }
}

async function wait(milliseconds: number, signal: AbortSignal) {
  await new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

export async function runNativeDrawingDwgImportWorker(
  environment: NodeJS.ProcessEnv,
) {
  const config = parseNativeDrawingDwgImportWorkerConfig(environment);
  const client = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      fetch: createNativeDrawingDwgImportRpcFetch(config.supabaseUrl),
    },
  });
  const dependencies = createSupabaseNativeDrawingDwgImportDependencies(
    client,
    {
      supabaseUrl: config.supabaseUrl,
      serviceRoleKey: config.serviceRoleKey,
      readerImageId: config.readerImageId,
      dockerPath: config.dockerPath,
      dockerHost: config.dockerHost,
      leaseSeconds: config.leaseSeconds,
    },
  );
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write('{"event":"native_dwg_import_worker_started"}\n');
  try {
    while (!controller.signal.aborted) {
      const outcome = await runNativeDrawingDwgImportWorkerOnce(dependencies, {
        signal: controller.signal,
      });
      if (outcome !== "idle")
        process.stdout.write(
          `${JSON.stringify({ event: "native_dwg_import_worker_result", outcome })}\n`,
        );
      if (outcome === "idle")
        await wait(config.pollMilliseconds, controller.signal);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.stdout.write('{"event":"native_dwg_import_worker_stopped"}\n');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runNativeDrawingDwgImportWorker(process.env).catch(() => {
    process.stderr.write('{"event":"native_dwg_import_worker_failed"}\n');
    process.exitCode = 1;
  });
}
