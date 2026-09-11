import { createServer } from "node:http";
import { isAbsolute } from "node:path";

import { z } from "zod";

import type { DrawingIfcDerivativeWorkerOutcome } from "../../app/lukas/lib/drawing-ifc-derivative-worker.server.ts";

const IntegerString = z.string().regex(/^\d+$/).transform(Number);

const WorkerEnvironmentSchema = z
  .object({
    SUPABASE_URL: z
      .string()
      .url()
      .transform((value) => new URL(value))
      .refine(
        (url) =>
          url.protocol === "https:" ||
          (url.protocol === "http:" &&
            ["127.0.0.1", "localhost", "::1"].includes(url.hostname)),
      )
      .refine(
        (url) =>
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          (url.pathname === "/" || url.pathname === ""),
      ),
    SUPABASE_SERVICE_ROLE_KEY: z.string().trim().min(32).max(4_096),
    IFC_DERIVATIVE_CONVERTER_PATH: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine(isAbsolute),
    PORT: IntegerString.pipe(z.number().int().min(1).max(65_535)).default(
      "8080",
    ),
    IFC_DERIVATIVE_LEASE_SECONDS: IntegerString.pipe(
      z.number().int().min(600).max(900),
    ).default("900"),
    IFC_DERIVATIVE_POLL_MIN_MS: IntegerString.pipe(
      z.number().int().min(100).max(60_000),
    ).default("1000"),
    IFC_DERIVATIVE_POLL_MAX_MS: IntegerString.pipe(
      z.number().int().min(100).max(60_000),
    ).default("30000"),
    IFC_DERIVATIVE_POLL_JITTER_RATIO: z.coerce
      .number()
      .min(0)
      .max(0.5)
      .default(0.2),
  })
  .strict()
  .refine(
    (value) =>
      value.IFC_DERIVATIVE_POLL_MIN_MS <= value.IFC_DERIVATIVE_POLL_MAX_MS,
  );

export type IfcDerivativeWorkerConfig = ReturnType<
  typeof parseIfcDerivativeWorkerConfig
>;

export function parseIfcDerivativeWorkerConfig(
  environment: Record<string, string | undefined>,
) {
  const result = WorkerEnvironmentSchema.safeParse({
    SUPABASE_URL: environment.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY,
    IFC_DERIVATIVE_CONVERTER_PATH: environment.IFC_DERIVATIVE_CONVERTER_PATH,
    PORT: environment.PORT,
    IFC_DERIVATIVE_LEASE_SECONDS: environment.IFC_DERIVATIVE_LEASE_SECONDS,
    IFC_DERIVATIVE_POLL_MIN_MS: environment.IFC_DERIVATIVE_POLL_MIN_MS,
    IFC_DERIVATIVE_POLL_MAX_MS: environment.IFC_DERIVATIVE_POLL_MAX_MS,
    IFC_DERIVATIVE_POLL_JITTER_RATIO:
      environment.IFC_DERIVATIVE_POLL_JITTER_RATIO,
  });
  if (!result.success)
    throw new Error("IFC derivative worker configuration is invalid.");
  return {
    supabaseUrl: result.data.SUPABASE_URL.href.replace(/\/$/, ""),
    supabaseServiceRoleKey: result.data.SUPABASE_SERVICE_ROLE_KEY,
    converterPath: result.data.IFC_DERIVATIVE_CONVERTER_PATH,
    port: result.data.PORT,
    leaseSeconds: result.data.IFC_DERIVATIVE_LEASE_SECONDS,
    pollMinMilliseconds: result.data.IFC_DERIVATIVE_POLL_MIN_MS,
    pollMaxMilliseconds: result.data.IFC_DERIVATIVE_POLL_MAX_MS,
    pollJitterRatio: result.data.IFC_DERIVATIVE_POLL_JITTER_RATIO,
  };
}

type PollConfig = Pick<
  IfcDerivativeWorkerConfig,
  "pollMinMilliseconds" | "pollMaxMilliseconds" | "pollJitterRatio"
>;

export function boundedIfcDerivativePollDelay(
  inactiveStreak: number,
  config: PollConfig,
  random: () => number = Math.random,
) {
  const exponent = Math.min(30, Math.max(0, inactiveStreak - 1));
  const base = Math.min(
    config.pollMaxMilliseconds,
    config.pollMinMilliseconds * 2 ** exponent,
  );
  const jitter = base * config.pollJitterRatio * (random() * 2 - 1);
  return Math.max(
    config.pollMinMilliseconds,
    Math.min(config.pollMaxMilliseconds, Math.round(base + jitter)),
  );
}

export function createBoundedFetch(
  fetchImplementation: typeof fetch,
  timeoutMilliseconds = 30_000,
): typeof fetch {
  if (
    !Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds < 1 ||
    timeoutMilliseconds > 300_000
  )
    throw new Error("IFC derivative network timeout is invalid.");
  return (input, init = {}) => {
    const deadline = AbortSignal.timeout(timeoutMilliseconds);
    const signal = init.signal
      ? AbortSignal.any([init.signal, deadline])
      : deadline;
    return fetchImplementation(input, { ...init, signal });
  };
}

function abortableSleep(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(done, milliseconds);
    signal.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
  });
}

export async function runIfcDerivativeWorkerLoop(
  input: PollConfig & {
    signal: AbortSignal;
    runOnce(): Promise<DrawingIfcDerivativeWorkerOutcome>;
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
    random?: () => number;
    log: (event: Record<string, unknown>) => void;
  },
) {
  let inactiveStreak = 0;
  const sleep = input.sleep ?? abortableSleep;
  const random = input.random ?? Math.random;
  while (!input.signal.aborted) {
    const startedAt = Date.now();
    try {
      const outcome = await input.runOnce();
      inactiveStreak = outcome === "idle" ? inactiveStreak + 1 : 0;
      input.log({
        event: "worker_iteration",
        outcome,
        durationMilliseconds: Date.now() - startedAt,
      });
    } catch {
      inactiveStreak += 1;
      input.log({
        event: "worker_iteration_failed",
        durationMilliseconds: Date.now() - startedAt,
      });
    }
    if (input.signal.aborted) break;
    await sleep(
      boundedIfcDerivativePollDelay(Math.max(1, inactiveStreak), input, random),
      input.signal,
    );
  }
}

export async function startIfcDerivativeHealthServer(input: {
  port: number;
  isStopping(): boolean;
}) {
  const server = createServer((request, response) => {
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/json; charset=utf-8");
    if (request.method === "GET" && request.url === "/healthz") {
      const stopping = input.isStopping();
      response.statusCode = stopping ? 503 : 200;
      response.end(JSON.stringify({ status: stopping ? "stopping" : "ok" }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ status: "not_found" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("IFC derivative health server failed to start.");
  }
  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
