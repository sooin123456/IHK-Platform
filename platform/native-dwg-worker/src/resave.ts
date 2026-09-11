import { createClient } from "@supabase/supabase-js";
import { isAbsolute, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { parseNativeDrawingDwgResaveClaim } from "../../app/lukas/lib/drawing-native-dwg-resave-jobs.server.ts";
import { callNativeDrawingDwgResaveAttemptRpc } from "../../app/lukas/lib/drawing-native-dwg-resave-worker.server.ts";
import { runNativeDrawingDwgResaveToStorage } from "../../app/lukas/lib/drawing-native-dwg-resave-publication.server.ts";
import {
  createNativeDrawingDwgImportRpcFetch,
  createNativeDrawingDwgImportSourceTransport,
} from "./import-supabase.ts";
import { createNativeDwgResaveStorageTransport } from "./supabase.ts";

const Environment = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).max(16_384),
    NATIVE_DWG_RESAVER_IMAGE_ID: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    NATIVE_DWG_DOCKER_PATH: z.string().refine(isAbsolute),
    NATIVE_DWG_DOCKER_HOST: z.string().refine((value) => {
      if (!/^unix:\/\/\/[^\0\r\n?#%]+$/.test(value)) return false;
      const socket = value.slice("unix://".length);
      return (
        isAbsolute(socket) &&
        normalize(socket) === socket &&
        !socket.startsWith("//")
      );
    }),
    NATIVE_DWG_RESAVE_LEASE_SECONDS: z.coerce
      .number()
      .int()
      .min(180)
      .max(900)
      .optional(),
    NATIVE_DWG_RESAVE_POLL_MILLISECONDS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .optional(),
  })
  .strip();

export function parseNativeDrawingDwgResaveWorkerConfig(
  environment: NodeJS.ProcessEnv,
) {
  try {
    const value = Environment.parse(environment);
    const url = new URL(value.SUPABASE_URL);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error("origin");
    return {
      supabaseUrl: url.origin,
      serviceRoleKey: value.SUPABASE_SERVICE_ROLE_KEY,
      resaverImageId: value.NATIVE_DWG_RESAVER_IMAGE_ID,
      dockerPath: value.NATIVE_DWG_DOCKER_PATH,
      dockerHost: value.NATIVE_DWG_DOCKER_HOST,
      leaseSeconds: value.NATIVE_DWG_RESAVE_LEASE_SECONDS ?? 900,
      pollMilliseconds: value.NATIVE_DWG_RESAVE_POLL_MILLISECONDS ?? 1000,
    };
  } catch {
    throw new Error("Native DWG resave worker configuration is invalid.");
  }
}

export async function runNativeDrawingDwgResaveWorkerOnce(
  config: ReturnType<typeof parseNativeDrawingDwgResaveWorkerConfig>,
  dependencies: Pick<
    Parameters<typeof runNativeDrawingDwgResaveToStorage>[0],
    "serviceClient" | "downloadSource" | "storage" | "resave" | "signal"
  >,
) {
  if (dependencies.signal?.aborted) return { outcome: "idle" } as const;
  let claim;
  try {
    const raw = await callNativeDrawingDwgResaveAttemptRpc(
      dependencies.serviceClient,
      "lukas_drawing_claim_native_dwg_resave",
      {
        p_resaver_image_id: config.resaverImageId,
        p_lease_seconds: config.leaseSeconds,
      },
    );
    if (raw === null) return { outcome: "idle" } as const;
    claim = parseNativeDrawingDwgResaveClaim(raw, config.resaverImageId);
  } catch {
    return { outcome: "control_uncertain" } as const;
  }
  // A claim arriving during shutdown still needs the attempt's fenced settlement.
  return runNativeDrawingDwgResaveToStorage({
    ...dependencies,
    claim,
    imageId: config.resaverImageId,
    dockerPath: config.dockerPath,
    dockerHost: config.dockerHost,
  });
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

export async function runNativeDrawingDwgResaveWorker(
  environment: NodeJS.ProcessEnv,
) {
  const config = parseNativeDrawingDwgResaveWorkerConfig(environment);
  const base = {
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.serviceRoleKey,
  };
  const serviceClient = createClient(
    config.supabaseUrl,
    config.serviceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: {
        fetch: createNativeDrawingDwgImportRpcFetch(config.supabaseUrl),
      },
    },
  );
  const { downloadSource } = createNativeDrawingDwgImportSourceTransport(base);
  const storage = createNativeDwgResaveStorageTransport(base);
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write('{"event":"native_dwg_resave_worker_started"}\n');
  try {
    while (!controller.signal.aborted) {
      const { outcome } = await runNativeDrawingDwgResaveWorkerOnce(config, {
        serviceClient,
        downloadSource,
        storage,
        signal: controller.signal,
      });
      process.stdout.write(
        `${JSON.stringify({ event: "native_dwg_resave_worker_result", outcome })}\n`,
      );
      await wait(config.pollMilliseconds, controller.signal);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.stdout.write('{"event":"native_dwg_resave_worker_stopped"}\n');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runNativeDrawingDwgResaveWorker(process.env).catch(() => {
    process.stderr.write('{"event":"native_dwg_resave_worker_failed"}\n');
    process.exitCode = 1;
  });
}
