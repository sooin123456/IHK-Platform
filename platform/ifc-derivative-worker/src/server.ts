import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { runDrawingIfcDerivativeWorkerOnce } from "../../app/lukas/lib/drawing-ifc-derivative-worker.server.ts";
import {
  createBoundedFetch,
  parseIfcDerivativeWorkerConfig,
  runIfcDerivativeWorkerLoop,
  startIfcDerivativeHealthServer,
} from "./service.ts";
import { createSupabaseIfcDerivativeWorkerDependencies } from "./supabase.ts";

function log(event: Record<string, unknown>) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function main() {
  const config = parseIfcDerivativeWorkerConfig(process.env);
  const converterSha256 = createHash("sha256")
    .update(await readFile(config.converterPath))
    .digest("hex");
  const boundedFetch = createBoundedFetch(fetch);
  const client = createClient(
    config.supabaseUrl,
    config.supabaseServiceRoleKey,
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: { fetch: boundedFetch },
    },
  );
  const dependencies = createSupabaseIfcDerivativeWorkerDependencies(
    client,
    {
      converterPath: config.converterPath,
      converterSha256,
      leaseSeconds: config.leaseSeconds,
    },
    { fetch: boundedFetch },
  );
  const controller = new AbortController();
  let stopping = false;
  const stop = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    log({ event: "worker_stopping", signal });
    controller.abort();
  };
  const onSigterm = () => stop("SIGTERM");
  const onSigint = () => stop("SIGINT");
  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);

  const health = await startIfcDerivativeHealthServer({
    port: config.port,
    isStopping: () => stopping,
  });
  log({ event: "worker_started", port: health.port, converterSha256 });
  try {
    await runIfcDerivativeWorkerLoop({
      signal: controller.signal,
      pollMinMilliseconds: config.pollMinMilliseconds,
      pollMaxMilliseconds: config.pollMaxMilliseconds,
      pollJitterRatio: config.pollJitterRatio,
      runOnce: () => runDrawingIfcDerivativeWorkerOnce(dependencies),
      log,
    });
  } finally {
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
    await health.close();
    log({ event: "worker_stopped" });
  }
}

main().catch(() => {
  process.stderr.write('{"event":"worker_start_failed"}\n');
  process.exitCode = 1;
});
