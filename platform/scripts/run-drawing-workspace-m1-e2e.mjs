import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer as createHttpServer } from "node:http";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { strToU8, zipSync } from "fflate";

const platformRoot = fileURLToPath(new URL("../", import.meta.url));
const repositorySupabase = path.join(platformRoot, "supabase");
const disposableTempRoot = realpathSync(tmpdir());
const dockerSharedDisposableRoot = path.join(
  platformRoot,
  "node_modules",
  ".cache",
  "1hk-m1-e2e",
);
const markerName = ".m1-disposable-supabase.json";
const projectPattern = /^1hk-m1-[0-9a-f]{8}$/;
const placeholder = /placeholder|example|dummy|masked|sensitive/i;
const m1ReleaseManifest = readFileSync(
  new URL("../../addin/Lukas.Qto.addin", import.meta.url),
  "utf8",
);
const m1ReleaseArtifact = zipSync(
  {
    "Lukas.Qto.addin": [
      strToU8(m1ReleaseManifest),
      { mtime: new Date(1980, 0, 1) },
    ],
  },
  { level: 6 },
);
const m1ReleaseSha256 = createHash("sha256")
  .update(m1ReleaseArtifact)
  .digest("hex")
  .toUpperCase();

export function parseRunnerProfile(args) {
  if (args.length === 0) return "m1";
  if (args.length === 1 && args[0] === "--profile=p3") return "p3";
  if (args.length === 1 && args[0] === "--profile=dwg-source")
    return "dwg-source";
  if (args.length === 1 && args[0] === "--profile=dwg-resave")
    return "dwg-resave";
  throw new Error("M1 E2E refuses an unknown or extra profile argument");
}

export function drawingWorkspacePlaywrightArgs(profile) {
  if (
    profile !== "m1" &&
    profile !== "p3" &&
    profile !== "dwg-source" &&
    profile !== "dwg-resave"
  )
    throw new Error("M1 E2E refuses an unknown runner profile");
  return [
    "test",
    profile === "p3"
      ? "e2e/drawing-workspace-p3.spec.ts"
      : profile === "dwg-source"
        ? "e2e/drawing-dwg-source-ingestion.spec.ts"
        : profile === "dwg-resave"
          ? "e2e/drawing-native-dwg-resave.spec.ts"
          : "e2e/drawing-workspace-m1-estimator.spec.ts",
    "--config=playwright.m1.config.ts",
    "--project=chromium",
    "--workers=1",
  ];
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value || placeholder.test(value))
    throw new Error(`M1 E2E requires a concrete ${name}`);
  return value;
}

function loopbackUrl(value, protocols, name) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`M1 E2E refuses malformed ${name}`);
  }
  if (
    !protocols.includes(parsed.protocol) ||
    !["127.0.0.1", "[::1]", "::1"].includes(parsed.hostname)
  )
    throw new Error(`M1 E2E refuses non-loopback ${name}`);
  return parsed;
}

export function assertM1LoopbackEnvironment(environment) {
  if (environment.M1_E2E_DISPOSABLE !== "1")
    throw new Error("M1 E2E requires M1_E2E_DISPOSABLE=1");
  const projectId = required(environment, "M1_E2E_DISPOSABLE_PROJECT_ID");
  if (!projectPattern.test(projectId))
    throw new Error("M1 E2E refuses an invalid disposable project ID");
  const workdir = path.resolve(
    required(environment, "M1_E2E_DISPOSABLE_WORKDIR"),
  );
  const supabaseUrl = required(environment, "SUPABASE_URL");
  const databaseUrl = required(environment, "M1_REAL_POSTGRES_DATABASE_URL");
  loopbackUrl(supabaseUrl, ["http:"], "Supabase URL");
  loopbackUrl(databaseUrl, ["postgres:", "postgresql:"], "PostgreSQL URL");
  for (const name of ["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"])
    if (required(environment, name).length < 32)
      throw new Error(`M1 E2E refuses a non-concrete ${name}`);
  return { databaseUrl, projectId, supabaseUrl, workdir };
}

export function renderDisposableSupabaseConfig({
  projectId,
  portBase,
  repositoryConfig,
}) {
  if (!projectPattern.test(projectId))
    throw new Error("M1 disposable project ID is invalid");
  if (!Number.isInteger(portBase) || portBase < 10_000 || portBase > 65_520)
    throw new Error("M1 disposable port block is invalid");
  return `project_id = "${projectId}"

[api]
enabled = true
port = ${portBase}
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = ${portBase + 1}
shadow_port = ${portBase + 2}
major_version = 17

[db.pooler]
enabled = false
port = ${portBase + 3}

[db.migrations]
enabled = true
schema_paths = []

[db.seed]
enabled = false
sql_paths = []

[realtime]
enabled = true

[studio]
enabled = false
port = ${portBase + 4}

[local_smtp]
enabled = false
port = ${portBase + 5}
smtp_port = ${portBase + 6}
pop3_port = ${portBase + 7}

[storage]
enabled = true
file_size_limit = "50MiB"

[storage.s3_protocol]
enabled = false

[storage.vector]
enabled = false

[auth]
enabled = true
site_url = "http://127.0.0.1:4000"
additional_redirect_urls = ["http://127.0.0.1:4000/**"]
enable_signup = true
enable_anonymous_sign_ins = true

[edge_runtime]
enabled = true
inspector_port = ${portBase + 8}

[analytics]
enabled = false
port = ${portBase + 9}

${repositoryConfig.trim()}
`;
}

function assertNoSymlinksBelow(root, label) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isSymbolicLink() || lstatSync(child).isSymbolicLink())
      throw new Error(`M1 cleanup refuses a symlink below the ${label}`);
    if (entry.isDirectory()) assertNoSymlinksBelow(child, label);
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function allowedDisposableRoot(resolved) {
  if (isInside(disposableTempRoot, resolved)) return true;
  if (!existsSync(dockerSharedDisposableRoot)) return false;
  const sharedRoot = realpathSync(dockerSharedDisposableRoot);
  return isInside(sharedRoot, resolved);
}

export function createDisposableRoot() {
  mkdirSync(dockerSharedDisposableRoot, { recursive: true });
  const sharedRoot = realpathSync(dockerSharedDisposableRoot);
  const resolvedPlatformRoot = realpathSync(platformRoot);
  if (
    !isInside(resolvedPlatformRoot, sharedRoot) ||
    lstatSync(dockerSharedDisposableRoot).isSymbolicLink()
  )
    throw new Error("M1 disposable cache must stay inside the workspace");
  return realpathSync(mkdtempSync(path.join(sharedRoot, "1hk-m1-supabase-")));
}

export function assertDisposableCleanupTarget({ projectId, root }) {
  const resolved = path.resolve(root);
  const repository = path.resolve(repositorySupabase);
  if (
    !allowedDisposableRoot(resolved) ||
    !path.basename(resolved).startsWith("1hk-m1-supabase-") ||
    resolved === repository ||
    resolved.startsWith(`${repository}${path.sep}`)
  )
    throw new Error(
      "M1 cleanup refuses a non-disposable root or repository Supabase",
    );
  if (
    !existsSync(resolved) ||
    lstatSync(resolved).isSymbolicLink() ||
    !lstatSync(resolved).isDirectory() ||
    realpathSync(resolved) !== resolved
  )
    throw new Error("M1 cleanup refuses a symlinked disposable root");
  assertNoSymlinksBelow(resolved, "disposable root");
  const markerPath = path.join(resolved, markerName);
  const configPath = path.join(resolved, "supabase", "config.toml");
  if (!existsSync(markerPath) || !existsSync(configPath))
    throw new Error("M1 cleanup refuses a missing disposable marker");
  let marker;
  try {
    marker = JSON.parse(readFileSync(markerPath, "utf8"));
  } catch {
    throw new Error("M1 cleanup refuses an invalid disposable marker");
  }
  if (
    Object.keys(marker).sort().join(",") !== "projectId,root" ||
    marker.projectId !== projectId ||
    marker.root !== resolved ||
    !projectPattern.test(projectId)
  )
    throw new Error("M1 cleanup refuses a mismatched disposable marker");
  const config = readFileSync(configPath, "utf8");
  let expectedConfig;
  try {
    expectedConfig = renderDisposableSupabaseConfig({
      projectId,
      portBase: configPort(config, "api"),
      repositoryConfig: readFileSync(
        path.join(repositorySupabase, "config.toml"),
        "utf8",
      ),
    });
  } catch {
    throw new Error("M1 cleanup refuses a mismatched Supabase config");
  }
  if (
    !config.startsWith(`project_id = "${projectId}"\n`) ||
    (config.match(/^project_id\s*=/gm) ?? []).length !== 1 ||
    config !== expectedConfig
  )
    throw new Error("M1 cleanup refuses a mismatched Supabase config");
  return { configPath, markerPath, resolved };
}

export function createProcessLifecycle({
  escalationMilliseconds = 5_000,
} = {}) {
  if (!Number.isInteger(escalationMilliseconds) || escalationMilliseconds < 1)
    throw new Error("M1 process escalation interval is invalid");
  let ownProcessGroupId = null;
  if (process.platform !== "win32") {
    try {
      ownProcessGroupId = Number(
        execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      );
    } catch {
      throw new Error("M1 could not establish its process-group boundary");
    }
    if (!Number.isInteger(ownProcessGroupId) || ownProcessGroupId < 1)
      throw new Error("M1 could not establish its process-group boundary");
  }
  const children = new Map();
  const terminationCompletions = new Set();
  let interruptedBy = null;
  const settle = (entry, error) => {
    if (!children.has(entry.child)) return;
    children.delete(entry.child);
    if (entry.escalationTimer) clearTimeout(entry.escalationTimer);
    if (entry.probeTimer) clearTimeout(entry.probeTimer);
    if (entry.hardStopTimer) clearTimeout(entry.hardStopTimer);
    if (error) entry.reject(error);
    else entry.resolve();
  };
  const groupAlive = (entry) => {
    try {
      process.kill(-entry.groupId, 0);
      return true;
    } catch (error) {
      if (error?.code === "ESRCH") return false;
      if (error?.code === "EPERM") return true;
      throw error;
    }
  };
  const signalEntry = (entry, signal) => {
    try {
      if (entry.processGroup) process.kill(-entry.groupId, signal);
      else entry.child.kill(signal);
    } catch (error) {
      if (error?.code !== "ESRCH") {
        settle(
          entry,
          new Error(`M1 could not terminate a tracked process group`, {
            cause: error,
          }),
        );
      }
    }
  };
  const probeGroup = (entry) => {
    if (!children.has(entry.child) || !entry.processGroup || entry.probeTimer)
      return;
    const check = () => {
      entry.probeTimer = null;
      if (!children.has(entry.child)) return;
      try {
        if (!groupAlive(entry)) {
          settle(entry);
          return;
        }
      } catch (error) {
        settle(entry, error);
        return;
      }
      entry.probeTimer = setTimeout(check, 20);
    };
    check();
  };
  const terminate = (entry) => {
    if (entry.terminating) return;
    entry.terminating = true;
    terminationCompletions.add(entry.completion);
    entry.completion.catch(() => {});
    signalEntry(entry, "SIGTERM");
    if (!children.has(entry.child)) return;
    if (entry.processGroup) probeGroup(entry);
    entry.escalationTimer = setTimeout(() => {
      if (!children.has(entry.child)) return;
      signalEntry(entry, "SIGKILL");
      if (entry.processGroup) probeGroup(entry);
    }, escalationMilliseconds);
    if (!entry.processGroup) entry.escalationTimer.unref?.();
    if (entry.processGroup) {
      entry.hardStopTimer = setTimeout(
        () =>
          settle(
            entry,
            new Error(
              "M1 tracked process group did not terminate after SIGKILL",
            ),
          ),
        escalationMilliseconds + 5_000,
      );
    }
  };
  return {
    get signal() {
      return interruptedBy;
    },
    assertCanStart(allowAfterSignal = false) {
      if (interruptedBy && !allowAfterSignal)
        throw Object.assign(
          new Error(`M1 E2E interrupted by ${interruptedBy}`),
          { signal: interruptedBy },
        );
    },
    requestSignal(signal) {
      if (interruptedBy) return;
      interruptedBy = signal;
      for (const entry of children.values()) terminate(entry);
    },
    track(child, { processGroup = false } = {}) {
      let resolve;
      let reject;
      const completion = new Promise((accept, decline) => {
        resolve = accept;
        reject = decline;
      });
      const groupId =
        processGroup &&
        process.platform !== "win32" &&
        Number.isInteger(child.pid) &&
        child.pid > 0
          ? child.pid
          : null;
      if (
        groupId !== null &&
        (groupId === ownProcessGroupId || groupId === process.pid)
      )
        throw new Error("M1 refuses to track its own process group");
      const entry = {
        child,
        completion,
        escalationTimer: null,
        groupId,
        hardStopTimer: null,
        probeTimer: null,
        processGroup: groupId !== null,
        reject,
        resolve,
        terminating: false,
      };
      children.set(child, entry);
      return () => {
        if (!children.has(child)) return;
        if (entry.processGroup) {
          try {
            if (groupAlive(entry)) {
              probeGroup(entry);
              return;
            }
          } catch (error) {
            settle(entry, error);
            return;
          }
        }
        settle(entry);
      };
    },
    async terminateTracked() {
      const pending = [...children.values()];
      for (const entry of pending) terminate(entry);
      await Promise.all(pending.map((entry) => entry.completion));
    },
    async waitForTermination() {
      const pending = [...terminationCompletions];
      try {
        await Promise.all(pending);
      } finally {
        for (const completion of pending)
          terminationCompletions.delete(completion);
      }
    },
  };
}

export function interruptedError(error, signal) {
  const result =
    error instanceof Error ? error : new Error("M1 E2E was interrupted");
  return Object.assign(result, { signal });
}

function boundedAppend(current, chunk) {
  const limit = 4 * 1024 * 1024;
  if (current.length >= limit) return current;
  return `${current}${String(chunk)}`.slice(0, limit);
}

export function runChildProcess(
  command,
  args,
  environment,
  {
    allowAfterSignal = false,
    capture = false,
    cwd = platformRoot,
    lifecycle = createProcessLifecycle(),
    sensitive = false,
  } = {},
) {
  lifecycle.assertCanStart(allowAfterSignal);
  return new Promise((resolve, reject) => {
    const processGroup = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd,
      detached: processGroup,
      env: environment,
      shell: false,
      stdio: capture || sensitive ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    const untrack = lifecycle.track(child, { processGroup });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout = boundedAppend(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = boundedAppend(stderr, chunk);
    });
    child.once("error", (error) => {
      untrack();
      reject(
        new Error(`M1 child command ${command} could not start`, {
          cause: sensitive ? undefined : error,
        }),
      );
    });
    child.once("close", (code, signal) => {
      untrack();
      if (code === 0) {
        resolve(capture ? stdout : undefined);
        return;
      }
      const suffix =
        code === null ? `signal ${signal ?? "unknown"}` : `exit ${code}`;
      const error = new Error(`M1 child command ${command} failed (${suffix})`);
      if (!sensitive && stderr.trim()) error.cause = new Error(stderr.trim());
      reject(error);
    });
  });
}

function assertPartialDisposableCleanupTarget({ projectId, root }) {
  if (!projectPattern.test(projectId))
    throw new Error("M1 cleanup refuses an invalid disposable project ID");
  const resolved = path.resolve(root);
  if (
    !allowedDisposableRoot(resolved) ||
    !path.basename(resolved).startsWith("1hk-m1-supabase-") ||
    !existsSync(resolved) ||
    lstatSync(resolved).isSymbolicLink() ||
    !lstatSync(resolved).isDirectory() ||
    realpathSync(resolved) !== resolved
  )
    throw new Error("M1 cleanup refuses a non-canonical partial root");
  assertNoSymlinksBelow(resolved, "partial root");
  return resolved;
}

export async function cleanupDisposableProject({
  projectId,
  root,
  projectReady,
  remove = (target) => rmSync(target, { recursive: true }),
  startAttempted,
  stop,
}) {
  if (!existsSync(root)) return { removed: false, stopped: false };
  if (!projectReady) {
    const resolved = assertPartialDisposableCleanupTarget({ projectId, root });
    if (startAttempted)
      throw new Error(
        `M1 partial stack recovery metadata is preserved at ${resolved}`,
      );
    remove(resolved);
    return { removed: true, stopped: false };
  }
  const { resolved } = assertDisposableCleanupTarget({ projectId, root });
  if (startAttempted) {
    try {
      if (typeof stop !== "function")
        throw new Error("M1 cleanup requires a disposable stop operation");
      await stop();
    } catch (error) {
      throw new Error(
        `M1 Supabase stop failed; recovery metadata is preserved at ${resolved}`,
        { cause: error },
      );
    }
  }
  assertDisposableCleanupTarget({ projectId, root: resolved });
  remove(resolved);
  return { removed: true, stopped: startAttempted };
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}

export async function startM1ReleaseFixture({ port = 12350 } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535)
    throw new Error("M1 release fixture port is invalid");
  const server = createHttpServer((request, response) => {
    if (request.method !== "GET" || request.url !== "/revit-2025.zip") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      Connection: "close",
      "Content-Disposition": 'attachment; filename="1HK-Revit-2025-M1.zip"',
      "Content-Length": String(m1ReleaseArtifact.length),
      "Content-Type": "application/zip",
    });
    response.end(m1ReleaseArtifact);
  });
  await new Promise((resolve, reject) => {
    const onError = (error) =>
      reject(new Error("M1 release fixture could not start", { cause: error }));
    server.once("error", onError);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => {
      server.off("error", onError);
      resolve();
    });
  });
  server.unref();
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("M1 release fixture address is unavailable");
  }
  let closePromise;
  return {
    url: `http://127.0.0.1:${address.port}/revit-2025.zip`,
    sha256: m1ReleaseSha256,
    version: "M1-E2E",
    close() {
      closePromise ??= new Promise((resolve, reject) => {
        server.close((error) =>
          error
            ? reject(
                new Error("M1 release fixture could not stop", {
                  cause: error,
                }),
              )
            : resolve(),
        );
        server.closeAllConnections?.();
      });
      return closePromise;
    },
  };
}

async function assertReleasePortsAvailable() {
  for (const port of [4000, 12349, 12350])
    if (!(await portAvailable(port)))
      throw new Error(`M1 E2E refuses occupied loopback port ${port}`);
}

async function findFreePortBlock() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const base = 50_000 + (randomBytes(2).readUInt16BE(0) % 5_000);
    const free = await Promise.all(
      Array.from({ length: 10 }, (_, index) => portAvailable(base + index)),
    );
    if (free.every(Boolean)) return base;
  }
  throw new Error("M1 E2E could not reserve a free Supabase port block");
}

export function parseSupabaseStatus(raw) {
  const status = JSON.parse(raw);
  const value = (name) => {
    const result = status[name];
    if (typeof result !== "string" || !result.trim())
      throw new Error(`Disposable Supabase status omitted ${name}`);
    return result.trim();
  };
  return {
    supabaseUrl: value("API_URL"),
    anonKey: value("ANON_KEY"),
    serviceRoleKey: value("SERVICE_ROLE_KEY"),
    databaseUrl: value("DB_URL"),
  };
}

function configPort(config, section) {
  const match = config.match(
    new RegExp(`\\[${section}\\][\\s\\S]*?\\nport\\s*=\\s*(\\d+)`),
  );
  if (!match) throw new Error(`M1 disposable config omitted ${section} port`);
  return Number(match[1]);
}

function defaultStatusRunner(command, args, environment) {
  try {
    return execFileSync(command, args, {
      cwd: platformRoot,
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new Error("M1 E2E could not verify disposable Supabase status");
  }
}

export function verifyDisposableSupabaseAuthority(
  environment,
  { statusRunner = defaultStatusRunner } = {},
) {
  const authority = assertM1LoopbackEnvironment(environment);
  const { configPath } = assertDisposableCleanupTarget({
    projectId: authority.projectId,
    root: authority.workdir,
  });
  const raw = statusRunner(
    "supabase",
    ["status", "--workdir", authority.workdir, "-o", "json"],
    environment,
  );
  const status = parseSupabaseStatus(raw);
  const expected = {
    anonKey: required(environment, "SUPABASE_ANON_KEY"),
    databaseUrl: authority.databaseUrl,
    serviceRoleKey: required(environment, "SUPABASE_SERVICE_ROLE_KEY"),
    supabaseUrl: authority.supabaseUrl,
  };
  if (
    status.anonKey !== expected.anonKey ||
    status.databaseUrl !== expected.databaseUrl ||
    status.serviceRoleKey !== expected.serviceRoleKey ||
    status.supabaseUrl !== expected.supabaseUrl
  )
    throw new Error(
      "M1 E2E Supabase status does not match the disposable environment",
    );
  const config = readFileSync(configPath, "utf8");
  if (
    Number(new URL(status.supabaseUrl).port) !== configPort(config, "api") ||
    Number(new URL(status.databaseUrl).port) !== configPort(config, "db")
  )
    throw new Error(
      "M1 E2E Supabase status does not match the disposable config ports",
    );
  return authority;
}

export function exactRuntimeEnvironment(
  base,
  disposable,
  root,
  projectId,
  release,
  profile = "m1",
) {
  if (
    profile !== "m1" &&
    profile !== "p3" &&
    profile !== "dwg-source" &&
    profile !== "dwg-resave"
  )
    throw new Error("M1 E2E refuses an unknown runner profile");
  const internalSecret = randomBytes(32).toString("hex");
  const freezeSecret = randomBytes(32).toString("hex");
  const environment = {
    ...base,
    M1_E2E_DISPOSABLE: "1",
    M1_E2E_DISPOSABLE_PROJECT_ID: projectId,
    M1_E2E_DISPOSABLE_WORKDIR: root,
    M1_REAL_POSTGRES_DATABASE_URL: disposable.databaseUrl,
    DATABASE_URL: disposable.databaseUrl,
    SUPABASE_URL: disposable.supabaseUrl,
    SUPABASE_ANON_KEY: disposable.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: disposable.serviceRoleKey,
    VITE_SUPABASE_URL: disposable.supabaseUrl,
    VITE_SUPABASE_ANON_KEY: disposable.anonKey,
    VITE_DRAWING_COLLABORATION_URL: "ws://127.0.0.1:12349",
    COLLABORATION_INTERNAL_URL: "http://127.0.0.1:12349",
    COLLABORATION_INTERNAL_SECRET: internalSecret,
    COLLABORATION_FREEZE_SECRET: freezeSecret,
    VITE_REVIT_2025_BETA_URL: release.url,
    VITE_REVIT_2025_BETA_SHA256: release.sha256,
    VITE_REVIT_2025_BETA_VERSION: release.version,
    VITE_M1_E2E_ALLOW_LOOPBACK_RELEASE: "1",
  };
  for (const name of [
    "M1_E2E_P3_DISPOSABLE",
    "E2E_BASE_URL",
    "P3_E2E_DATABASE_ADMIN_URL",
    "P3_E2E_RUN_ID",
  ])
    delete environment[name];
  if (profile === "p3")
    Object.assign(environment, {
      M1_E2E_P3_DISPOSABLE: "1",
      E2E_BASE_URL: "http://127.0.0.1:4000",
      P3_E2E_DATABASE_ADMIN_URL: disposable.databaseUrl,
      P3_E2E_RUN_ID: `${projectId}-p3-${randomBytes(4).toString("hex")}`,
    });
  assertM1LoopbackEnvironment(environment);
  return environment;
}

export function createDisposableProject(root, projectId, portBase) {
  const destination = path.join(root, "supabase");
  if (path.resolve(destination) === path.resolve(repositorySupabase))
    throw new Error("M1 E2E refuses the repository Supabase workdir");
  mkdirSync(destination, { recursive: false });
  cpSync(
    path.join(repositorySupabase, "migrations"),
    path.join(destination, "migrations"),
    { recursive: true, errorOnExist: true },
  );
  mkdirSync(path.join(destination, "functions"), { recursive: false });
  cpSync(
    path.join(repositorySupabase, "functions", "lukas-qto-upload-verify"),
    path.join(destination, "functions", "lukas-qto-upload-verify"),
    { recursive: true, errorOnExist: true },
  );
  const repositoryConfig = readFileSync(
    path.join(repositorySupabase, "config.toml"),
    "utf8",
  );
  writeFileSync(
    path.join(destination, "config.toml"),
    renderDisposableSupabaseConfig({
      projectId,
      portBase,
      repositoryConfig,
    }),
  );
  writeFileSync(
    path.join(root, markerName),
    `${JSON.stringify({ projectId, root: path.resolve(root) })}\n`,
  );
  assertDisposableCleanupTarget({ projectId, root });
}

export function disposableSupabaseStartArgs(root) {
  return [
    "start",
    "--workdir",
    root,
    "--exclude",
    "studio,mailpit,imgproxy,logflare,vector,supavisor",
  ];
}

async function main() {
  const profile = parseRunnerProfile(process.argv.slice(2));
  const lifecycle = createProcessLifecycle();
  const signalHandlers = new Map(
    ["SIGINT", "SIGTERM"].map((signal) => [
      signal,
      () => lifecycle.requestSignal(signal),
    ]),
  );
  for (const [signal, handler] of signalHandlers) process.on(signal, handler);
  let root;
  let projectId;
  let projectReady = false;
  let startAttempted = false;
  let releaseFixture;
  let primaryError;
  try {
    await assertReleasePortsAvailable();
    releaseFixture = await startM1ReleaseFixture();
    lifecycle.assertCanStart(false);
    projectId = `1hk-m1-${randomBytes(4).toString("hex")}`;
    const portBase = await findFreePortBlock();
    lifecycle.assertCanStart(false);
    root = createDisposableRoot();
    createDisposableProject(root, projectId, portBase);
    projectReady = true;
    startAttempted = true;
    await runChildProcess(
      "supabase",
      disposableSupabaseStartArgs(root),
      process.env,
      { lifecycle, sensitive: true },
    );
    process.stdout.write(
      "M1 disposable Supabase started in an isolated temporary project.\n",
    );
    const disposable = parseSupabaseStatus(
      await runChildProcess(
        "supabase",
        ["status", "--workdir", root, "-o", "json"],
        process.env,
        { capture: true, lifecycle, sensitive: true },
      ),
    );
    const environment = exactRuntimeEnvironment(
      process.env,
      disposable,
      root,
      projectId,
      releaseFixture,
      profile,
    );
    await runChildProcess("npm", ["run", "build"], environment, {
      lifecycle,
    });
    await runChildProcess("npm", ["run", "build:collaboration"], environment, {
      lifecycle,
    });
    await runChildProcess(
      process.execPath,
      ["--test", "tests/drawing-workspace-m1-real-database.test.mjs"],
      { ...environment, M1_REAL_POSTGRES_REQUIRED: "1" },
      { lifecycle },
    );
    await runChildProcess(
      process.execPath,
      [
        "--test",
        "tests/drawing-workspace-m2-pdf-attach-real-database.test.mjs",
      ],
      { ...environment, M2_PDF_ATTACH_REAL_POSTGRES_REQUIRED: "1" },
      { lifecycle },
    );
    await runChildProcess(
      process.execPath,
      ["--test", "tests/drawing-workspace-m5-storage-real-database.test.mjs"],
      {
        ...environment,
        M5_STORAGE_REAL_POSTGRES_DATABASE_URL: disposable.databaseUrl,
        M5_STORAGE_REAL_POSTGRES_REQUIRED: "1",
      },
      { lifecycle },
    );
    await runChildProcess(
      path.join("node_modules", ".bin", "playwright"),
      drawingWorkspacePlaywrightArgs(profile),
      environment,
      { lifecycle },
    );
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    try {
      await lifecycle.terminateTracked();
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (releaseFixture) {
      try {
        await releaseFixture.close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (root && projectId) {
      try {
        await cleanupDisposableProject({
          projectId,
          root,
          projectReady,
          startAttempted,
          stop: async () => {
            try {
              return await runChildProcess(
                "supabase",
                [
                  "stop",
                  "--no-backup",
                  "--project-id",
                  projectId,
                  "--workdir",
                  root,
                ],
                process.env,
                { allowAfterSignal: true, lifecycle, sensitive: true },
              );
            } finally {
              await lifecycle.terminateTracked();
            }
          },
        });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const [signal, handler] of signalHandlers)
      process.off(signal, handler);
    if (lifecycle.signal)
      primaryError = interruptedError(
        primaryError ?? new Error(`M1 E2E interrupted by ${lifecycle.signal}`),
        lifecycle.signal,
      );
    if (primaryError && cleanupErrors.length)
      throw Object.assign(
        new AggregateError(
          [primaryError, ...cleanupErrors],
          "M1 E2E failed and disposable cleanup was incomplete",
        ),
        lifecycle.signal ? { signal: lifecycle.signal } : {},
      );
    if (primaryError) throw primaryError;
    if (cleanupErrors.length)
      throw new AggregateError(cleanupErrors, "M1 disposable cleanup failed");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode =
      error?.signal === "SIGINT" ? 130 : error?.signal === "SIGTERM" ? 143 : 1;
  });
