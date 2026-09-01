import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = fileURLToPath(new URL("../", import.meta.url));
const repositorySupabase = path.join(platformRoot, "supabase");
const disposableTempRoot = realpathSync(tmpdir());
const markerName = ".m1-disposable-supabase.json";
const projectPattern = /^1hk-m1-[0-9a-f]{8}$/;
const placeholder = /placeholder|example|dummy|masked|sensitive/i;

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
enable_anonymous_sign_ins = false

[edge_runtime]
enabled = false
inspector_port = ${portBase + 8}

[analytics]
enabled = false
port = ${portBase + 9}

${repositoryConfig.trim()}
`;
}

export function assertDisposableCleanupTarget({ projectId, root }) {
  const resolved = path.resolve(root);
  const repository = path.resolve(repositorySupabase);
  if (
    !resolved.startsWith(`${disposableTempRoot}${path.sep}1hk-m1-supabase-`) ||
    resolved === repository ||
    resolved.startsWith(`${repository}${path.sep}`)
  )
    throw new Error(
      "M1 cleanup refuses a non-disposable root or repository Supabase",
    );
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
    marker.projectId !== projectId ||
    path.resolve(marker.root) !== resolved ||
    !projectPattern.test(projectId)
  )
    throw new Error("M1 cleanup refuses a mismatched disposable marker");
  const config = readFileSync(configPath, "utf8");
  if (!config.startsWith(`project_id = "${projectId}"`))
    throw new Error("M1 cleanup refuses a mismatched Supabase project");
  return { configPath, markerPath, resolved };
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

async function assertReleasePortsAvailable() {
  for (const port of [4000, 12349])
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

function run(command, args, environment, capture = false) {
  return execFileSync(command, args, {
    cwd: platformRoot,
    encoding: capture ? "utf8" : undefined,
    env: environment,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function parseSupabaseStatus(raw) {
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

function exactRuntimeEnvironment(base, disposable, root, projectId) {
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
  };
  assertM1LoopbackEnvironment(environment);
  return environment;
}

function createDisposableProject(root, projectId, portBase) {
  const destination = path.join(root, "supabase");
  if (path.resolve(destination) === path.resolve(repositorySupabase))
    throw new Error("M1 E2E refuses the repository Supabase workdir");
  mkdirSync(destination, { recursive: false });
  cpSync(
    path.join(repositorySupabase, "migrations"),
    path.join(destination, "migrations"),
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

async function main() {
  await assertReleasePortsAvailable();
  const projectId = `1hk-m1-${randomBytes(4).toString("hex")}`;
  const portBase = await findFreePortBlock();
  const root = mkdtempSync(path.join(disposableTempRoot, "1hk-m1-supabase-"));
  let startAttempted = false;
  let primaryError;
  try {
    createDisposableProject(root, projectId, portBase);
    startAttempted = true;
    run(
      "supabase",
      [
        "start",
        "--workdir",
        root,
        "--exclude",
        "studio,mailpit,imgproxy,edge-runtime,logflare,vector,supavisor",
      ],
      process.env,
    );
    const disposable = parseSupabaseStatus(
      run(
        "supabase",
        ["status", "--workdir", root, "-o", "json"],
        process.env,
        true,
      ),
    );
    const environment = exactRuntimeEnvironment(
      process.env,
      disposable,
      root,
      projectId,
    );
    run("npm", ["run", "build"], environment);
    run("npm", ["run", "build:collaboration"], environment);
    run(
      process.execPath,
      ["--test", "tests/drawing-workspace-m1-real-database.test.mjs"],
      { ...environment, M1_REAL_POSTGRES_REQUIRED: "1" },
    );
    run(
      path.join("node_modules", ".bin", "playwright"),
      [
        "test",
        "e2e/drawing-workspace-m1-estimator.spec.ts",
        "--config=playwright.m1.config.ts",
        "--project=chromium",
        "--workers=1",
      ],
      environment,
    );
  } catch (error) {
    primaryError = error;
  } finally {
    const cleanupErrors = [];
    if (startAttempted) {
      try {
        assertDisposableCleanupTarget({ projectId, root });
        run(
          "supabase",
          ["stop", "--no-backup", "--project-id", projectId, "--workdir", root],
          process.env,
        );
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    try {
      const { resolved } = assertDisposableCleanupTarget({ projectId, root });
      if (realpathSync(resolved) !== resolved)
        throw new Error("M1 cleanup refuses a symlinked disposable root");
      rmSync(resolved, { recursive: true });
    } catch (error) {
      cleanupErrors.push(error);
    }
    if (primaryError && cleanupErrors.length)
      throw new AggregateError(
        [primaryError, ...cleanupErrors],
        "M1 E2E failed and disposable cleanup was incomplete",
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
    process.exitCode = 1;
  });
