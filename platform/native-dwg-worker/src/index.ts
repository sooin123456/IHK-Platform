import { createClient } from "@supabase/supabase-js";
import { isAbsolute } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

import {
  NATIVE_DWG_WORKER_LIMITS,
  calculateNativeDwgWriterBuildSha256,
  runNativeDrawingDwgWorkerOnce,
} from "../../app/lukas/lib/drawing-native-dwg-worker.server.ts";
import { createSupabaseNativeDwgWorkerDependencies } from "./supabase.ts";

const EnvironmentSchema = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    NATIVE_DWG_DOTNET_PATH: z.string().refine(isAbsolute),
    NATIVE_DWG_PUBLISHED_DIRECTORY: z.string().refine(isAbsolute),
    NATIVE_DWG_LEASE_SECONDS: z.coerce
      .number()
      .int()
      .min(30)
      .max(900)
      .optional(),
    NATIVE_DWG_POLL_MILLISECONDS: z.coerce
      .number()
      .int()
      .min(100)
      .max(60_000)
      .optional(),
  })
  .strip();

export function parseNativeDwgWorkerConfig(environment: NodeJS.ProcessEnv) {
  try {
    const value = EnvironmentSchema.parse(environment);
    return {
      supabaseUrl: value.SUPABASE_URL,
      supabaseServiceRoleKey: value.SUPABASE_SERVICE_ROLE_KEY,
      dotnetPath: value.NATIVE_DWG_DOTNET_PATH,
      publishedDirectory: value.NATIVE_DWG_PUBLISHED_DIRECTORY,
      leaseSeconds:
        value.NATIVE_DWG_LEASE_SECONDS ?? NATIVE_DWG_WORKER_LIMITS.leaseSeconds,
      pollMilliseconds: value.NATIVE_DWG_POLL_MILLISECONDS ?? 1_000,
    };
  } catch {
    throw new Error("Native DWG worker configuration is invalid.");
  }
}

async function wait(milliseconds: number, signal: AbortSignal) {
  await new Promise<void>((resolvePromise) => {
    if (signal.aborted) return resolvePromise();
    const done = () => {
      signal.removeEventListener("abort", abort);
      resolvePromise();
    };
    const timer = setTimeout(done, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      done();
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function runNativeDwgWorker(environment: NodeJS.ProcessEnv) {
  const config = parseNativeDwgWorkerConfig(environment);
  const writerBuildSha256 = await calculateNativeDwgWriterBuildSha256(
    config.publishedDirectory,
  );
  const client = createClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    },
  );
  const dependencies = createSupabaseNativeDwgWorkerDependencies(client, {
    supabaseUrl: config.supabaseUrl,
    serviceRoleKey: config.supabaseServiceRoleKey,
    dotnetPath: config.dotnetPath,
    publishedDirectory: config.publishedDirectory,
    writerBuildSha256,
    leaseSeconds: config.leaseSeconds,
  });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.stdout.write(
    `${JSON.stringify({ event: "native_dwg_worker_started", writerBuildSha256 })}\n`,
  );
  try {
    while (!controller.signal.aborted) {
      const outcome = await runNativeDrawingDwgWorkerOnce(dependencies, {
        signal: controller.signal,
      });
      if (outcome !== "idle")
        process.stdout.write(
          `${JSON.stringify({ event: "native_dwg_worker_result", outcome })}\n`,
        );
      if (outcome === "idle")
        await wait(config.pollMilliseconds, controller.signal);
    }
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    process.stdout.write('{"event":"native_dwg_worker_stopped"}\n');
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runNativeDwgWorker(process.env).catch(() => {
    process.stderr.write('{"event":"native_dwg_worker_failed"}\n');
    process.exitCode = 1;
  });
}
