import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import { unzipSync } from "fflate";

import * as m1Harness from "../scripts/run-drawing-workspace-m1-e2e.mjs";
import {
  assertDisposableCleanupTarget,
  assertM1LoopbackEnvironment,
  cleanupDisposableProject,
  createProcessLifecycle,
  interruptedError,
  renderDisposableSupabaseConfig,
  runChildProcess,
  verifyDisposableSupabaseAuthority,
} from "../scripts/run-drawing-workspace-m1-e2e.mjs";

const validEnvironment = {
  M1_E2E_DISPOSABLE: "1",
  M1_E2E_DISPOSABLE_PROJECT_ID: "1hk-m1-deadbeef",
  M1_E2E_DISPOSABLE_WORKDIR: "/tmp/1hk-m1-supabase-deadbeef",
  SUPABASE_URL: "http://127.0.0.1:55431",
  SUPABASE_ANON_KEY: "a".repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
  M1_REAL_POSTGRES_DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:55432/postgres",
};
const repositoryConfig = readFileSync(
  new URL("../supabase/config.toml", import.meta.url),
  "utf8",
);
const harnessSource = readFileSync(
  new URL("../scripts/run-drawing-workspace-m1-e2e.mjs", import.meta.url),
  "utf8",
);
const ownedConfig = (projectId, portBase = 55431) =>
  renderDisposableSupabaseConfig({ projectId, portBase, repositoryConfig });

test("runner profile parsing is strict before resource startup", () => {
  assert.equal(m1Harness.parseRunnerProfile([]), "m1");
  assert.equal(m1Harness.parseRunnerProfile(["--profile=p3"]), "p3");
  assert.equal(
    m1Harness.parseRunnerProfile(["--profile=dwg-source"]),
    "dwg-source",
  );
  assert.equal(
    m1Harness.parseRunnerProfile(["--profile=dwg-resave"]),
    "dwg-resave",
  );
  for (const args of [
    ["--profile=m1"],
    ["--profile=unknown"],
    ["--profile=p3", "extra"],
    ["extra"],
  ])
    assert.throws(
      () => m1Harness.parseRunnerProfile(args),
      /profile|argument/i,
    );
});

test("runner profiles select only their exact Playwright target", () => {
  const suffix = [
    "--config=playwright.m1.config.ts",
    "--project=chromium",
    "--workers=1",
  ];
  assert.deepEqual(m1Harness.drawingWorkspacePlaywrightArgs("m1"), [
    "test",
    "e2e/drawing-workspace-m1-estimator.spec.ts",
    ...suffix,
  ]);
  assert.deepEqual(m1Harness.drawingWorkspacePlaywrightArgs("p3"), [
    "test",
    "e2e/drawing-workspace-p3.spec.ts",
    ...suffix,
  ]);
  assert.deepEqual(m1Harness.drawingWorkspacePlaywrightArgs("dwg-source"), [
    "test",
    "e2e/drawing-dwg-source-ingestion.spec.ts",
    ...suffix,
  ]);
  assert.deepEqual(m1Harness.drawingWorkspacePlaywrightArgs("dwg-resave"), [
    "test",
    "e2e/drawing-native-dwg-resave.spec.ts",
    ...suffix,
  ]);
});

test("M1 disposable release runner requires M1 M2 and M5 real PostgreSQL proofs", () => {
  assert.match(
    harnessSource,
    /drawing-workspace-m1-real-database\.test\.mjs[\s\S]*M1_REAL_POSTGRES_REQUIRED:\s*"1"/,
  );
  assert.match(
    harnessSource,
    /drawing-workspace-m2-pdf-attach-real-database\.test\.mjs[\s\S]*M2_PDF_ATTACH_REAL_POSTGRES_REQUIRED:\s*"1"/,
  );
  assert.match(
    harnessSource,
    /drawing-workspace-m5-storage-real-database\.test\.mjs[\s\S]*M5_STORAGE_REAL_POSTGRES_REQUIRED:\s*"1"/,
  );
});

test("M1 Revit release fixture serves a deterministic verified ZIP download", async () => {
  const fixture = await m1Harness.startM1ReleaseFixture({ port: 0 });
  try {
    const response = await fetch(fixture.url, {
      signal: AbortSignal.timeout(2_000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/zip");
    assert.equal(
      response.headers.get("content-disposition"),
      'attachment; filename="1HK-Revit-2025-M1.zip"',
    );
    assert.equal(response.headers.get("content-length"), "428");
    const archive = new Uint8Array(await response.arrayBuffer());
    const entries = unzipSync(archive);
    assert.deepEqual(Object.keys(entries), ["Lukas.Qto.addin"]);
    assert.deepEqual(
      Buffer.from(entries["Lukas.Qto.addin"]),
      readFileSync(new URL("../../addin/Lukas.Qto.addin", import.meta.url)),
    );
    assert.equal(
      Object.keys(entries).some((name) => name.toLowerCase().endsWith(".dll")),
      false,
    );
    assert.equal(
      fixture.sha256,
      "E8770AA7868D6556FBDBBA16A75EA3A71E0116A62453E928C821CC63DDF51C09",
    );
    assert.equal(fixture.version, "M1-E2E");
  } finally {
    await fixture.close();
  }
});

test("M1 runtime environment binds the verified loopback Revit release", () => {
  const environment = m1Harness.exactRuntimeEnvironment(
    {
      M1_E2E_P3_DISPOSABLE: "1",
      E2E_BASE_URL: "https://stale.example.test",
      P3_E2E_DATABASE_ADMIN_URL: "postgresql://stale.example.test/postgres",
      P3_E2E_RUN_ID: "stale-release-run",
    },
    {
      anonKey: validEnvironment.SUPABASE_ANON_KEY,
      databaseUrl: validEnvironment.M1_REAL_POSTGRES_DATABASE_URL,
      serviceRoleKey: validEnvironment.SUPABASE_SERVICE_ROLE_KEY,
      supabaseUrl: validEnvironment.SUPABASE_URL,
    },
    validEnvironment.M1_E2E_DISPOSABLE_WORKDIR,
    validEnvironment.M1_E2E_DISPOSABLE_PROJECT_ID,
    {
      url: "http://127.0.0.1:12350/revit-2025.zip",
      sha256:
        "8739C76E681F900923B900C9DF0EF75CF421D39CABB54650C4B9AD19B6A76D85",
      version: "M1-E2E",
    },
  );

  assert.equal(
    environment.VITE_REVIT_2025_BETA_URL,
    "http://127.0.0.1:12350/revit-2025.zip",
  );
  assert.equal(
    environment.VITE_REVIT_2025_BETA_SHA256,
    "8739C76E681F900923B900C9DF0EF75CF421D39CABB54650C4B9AD19B6A76D85",
  );
  assert.equal(environment.VITE_REVIT_2025_BETA_VERSION, "M1-E2E");
  assert.equal(environment.VITE_M1_E2E_ALLOW_LOOPBACK_RELEASE, "1");
  assert.equal("M1_E2E_P3_DISPOSABLE" in environment, false);
  assert.equal("E2E_BASE_URL" in environment, false);
  assert.equal("P3_E2E_DATABASE_ADMIN_URL" in environment, false);
  assert.equal("P3_E2E_RUN_ID" in environment, false);
});

test("P3 runtime environment adds only explicit disposable P3 authority", () => {
  const environment = m1Harness.exactRuntimeEnvironment(
    {},
    {
      anonKey: validEnvironment.SUPABASE_ANON_KEY,
      databaseUrl: validEnvironment.M1_REAL_POSTGRES_DATABASE_URL,
      serviceRoleKey: validEnvironment.SUPABASE_SERVICE_ROLE_KEY,
      supabaseUrl: validEnvironment.SUPABASE_URL,
    },
    validEnvironment.M1_E2E_DISPOSABLE_WORKDIR,
    validEnvironment.M1_E2E_DISPOSABLE_PROJECT_ID,
    {
      url: "http://127.0.0.1:12350/revit-2025.zip",
      sha256:
        "E8770AA7868D6556FBDBBA16A75EA3A71E0116A62453E928C821CC63DDF51C09",
      version: "M1-E2E",
    },
    "p3",
  );
  assert.equal(environment.M1_E2E_P3_DISPOSABLE, "1");
  assert.equal(environment.E2E_BASE_URL, "http://127.0.0.1:4000");
  assert.equal(
    environment.P3_E2E_DATABASE_ADMIN_URL,
    environment.M1_REAL_POSTGRES_DATABASE_URL,
  );
  assert.match(
    environment.P3_E2E_RUN_ID,
    /^1hk-m1-[0-9a-f]{8}-p3-[0-9a-f]{8}$/,
  );
});

test("DWG source profile reuses the ordinary disposable runtime authority", () => {
  const environment = m1Harness.exactRuntimeEnvironment(
    {},
    {
      anonKey: validEnvironment.SUPABASE_ANON_KEY,
      databaseUrl: validEnvironment.M1_REAL_POSTGRES_DATABASE_URL,
      serviceRoleKey: validEnvironment.SUPABASE_SERVICE_ROLE_KEY,
      supabaseUrl: validEnvironment.SUPABASE_URL,
    },
    validEnvironment.M1_E2E_DISPOSABLE_WORKDIR,
    validEnvironment.M1_E2E_DISPOSABLE_PROJECT_ID,
    {
      url: "http://127.0.0.1:12350/revit-2025.zip",
      sha256:
        "E8770AA7868D6556FBDBBA16A75EA3A71E0116A62453E928C821CC63DDF51C09",
      version: "M1-E2E",
    },
    "dwg-source",
  );
  assert.equal(environment.M1_E2E_DISPOSABLE, "1");
  assert.equal("M1_E2E_P3_DISPOSABLE" in environment, false);
  assert.equal("P3_E2E_DATABASE_ADMIN_URL" in environment, false);
  assert.equal("P3_E2E_RUN_ID" in environment, false);
});

test("DWG resave profile reuses the ordinary disposable runtime authority", () => {
  const environment = m1Harness.exactRuntimeEnvironment(
    {},
    {
      anonKey: validEnvironment.SUPABASE_ANON_KEY,
      databaseUrl: validEnvironment.M1_REAL_POSTGRES_DATABASE_URL,
      serviceRoleKey: validEnvironment.SUPABASE_SERVICE_ROLE_KEY,
      supabaseUrl: validEnvironment.SUPABASE_URL,
    },
    validEnvironment.M1_E2E_DISPOSABLE_WORKDIR,
    validEnvironment.M1_E2E_DISPOSABLE_PROJECT_ID,
    {
      url: "http://127.0.0.1:12350/revit-2025.zip",
      sha256:
        "E8770AA7868D6556FBDBBA16A75EA3A71E0116A62453E928C821CC63DDF51C09",
      version: "M1-E2E",
    },
    "dwg-resave",
  );
  assert.equal(environment.M1_E2E_DISPOSABLE, "1");
  assert.equal("M1_E2E_P3_DISPOSABLE" in environment, false);
  assert.equal("P3_E2E_DATABASE_ADMIN_URL" in environment, false);
  assert.equal("P3_E2E_RUN_ID" in environment, false);
});

test("M1 authority accepts only its concrete loopback Supabase and PostgreSQL endpoints", () => {
  assert.deepEqual(assertM1LoopbackEnvironment(validEnvironment), {
    databaseUrl: validEnvironment.M1_REAL_POSTGRES_DATABASE_URL,
    projectId: validEnvironment.M1_E2E_DISPOSABLE_PROJECT_ID,
    supabaseUrl: validEnvironment.SUPABASE_URL,
    workdir: validEnvironment.M1_E2E_DISPOSABLE_WORKDIR,
  });

  for (const replacement of [
    { SUPABASE_URL: "https://example.supabase.co" },
    {
      M1_REAL_POSTGRES_DATABASE_URL:
        "postgresql://postgres:postgres@example.com:5432/postgres",
    },
    { M1_E2E_DISPOSABLE: "0" },
    { SUPABASE_ANON_KEY: "placeholder" },
  ])
    assert.throws(
      () =>
        assertM1LoopbackEnvironment({ ...validEnvironment, ...replacement }),
      /M1 E2E refuses|M1 E2E requires/,
    );
});

test("disposable Supabase config uses the exact project and free port block", () => {
  const rendered = renderDisposableSupabaseConfig({
    projectId: "1hk-m1-01234567",
    portBase: 55431,
    repositoryConfig:
      "[functions.lukas-qto-upload-verify]\nverify_jwt = true\n",
  });
  assert.match(rendered, /^project_id = "1hk-m1-01234567"/);
  assert.match(rendered, /\[api\]\nenabled = true\nport = 55431/);
  assert.match(rendered, /\[db\]\nport = 55432\nshadow_port = 55433/);
  assert.match(rendered, /site_url = "http:\/\/127\.0\.0\.1:4000"/);
  assert.match(rendered, /\[functions\.lukas-qto-upload-verify\]/);
  assert.doesNotMatch(rendered, /5432[0-9]/);
});

test("disposable project enables Edge runtime and owns exactly the upload verifier files", () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "1hk-m1-supabase-edge-runtime-")),
  );
  const projectId = "1hk-m1-1234abcd";
  try {
    m1Harness.createDisposableProject(root, projectId, 55431);

    const destination = path.join(root, "supabase");
    const functionRoot = path.join(destination, "functions");
    const config = readFileSync(path.join(destination, "config.toml"), "utf8");
    assert.match(config, /\[edge_runtime\]\nenabled = true/);
    assert.match(
      config,
      /\[functions\.lukas-qto-upload-verify\]\nenabled = true/,
    );
    assert.match(
      config,
      /import_map = "\.\/functions\/lukas-qto-upload-verify\/deno\.json"/,
    );
    assert.match(
      config,
      /entrypoint = "\.\/functions\/lukas-qto-upload-verify\/index\.ts"/,
    );
    assert.deepEqual(readdirSync(functionRoot), ["lukas-qto-upload-verify"]);
    for (const name of ["deno.json", "index.ts"])
      assert.equal(
        readFileSync(
          path.join(functionRoot, "lukas-qto-upload-verify", name),
          "utf8",
        ),
        readFileSync(
          new URL(
            `../supabase/functions/lukas-qto-upload-verify/${name}`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("disposable runner root lives in the Docker-shareable workspace cache", () => {
  const root = m1Harness.createDisposableRoot();
  try {
    const sharedRoot = realpathSync(
      path.resolve("node_modules/.cache/1hk-m1-e2e"),
    );
    const relative = path.relative(sharedRoot, root);
    assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false);
    assert.match(path.basename(root), /^1hk-m1-supabase-/);
    assert.equal(realpathSync(root), root);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("disposable Supabase start command keeps Edge runtime enabled", () => {
  assert.deepEqual(m1Harness.disposableSupabaseStartArgs("/tmp/m1-owned"), [
    "start",
    "--workdir",
    "/tmp/m1-owned",
    "--exclude",
    "studio,mailpit,imgproxy,logflare,vector,supavisor",
  ]);
});

test("Playwright authority verifies status for the exact workdir and rejects endpoint or key drift", () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "1hk-m1-supabase-status-")),
  );
  const projectId = "1hk-m1-deadbeef";
  const environment = {
    ...validEnvironment,
    M1_E2E_DISPOSABLE_PROJECT_ID: projectId,
    M1_E2E_DISPOSABLE_WORKDIR: root,
  };
  const calls = [];
  const status = {
    API_URL: environment.SUPABASE_URL,
    DB_URL: environment.M1_REAL_POSTGRES_DATABASE_URL,
    ANON_KEY: environment.SUPABASE_ANON_KEY,
    SERVICE_ROLE_KEY: environment.SUPABASE_SERVICE_ROLE_KEY,
  };
  try {
    mkdirSync(path.join(root, "supabase"));
    writeFileSync(
      path.join(root, ".m1-disposable-supabase.json"),
      `${JSON.stringify({ projectId, root })}\n`,
    );
    writeFileSync(
      path.join(root, "supabase", "config.toml"),
      renderDisposableSupabaseConfig({
        projectId,
        portBase: 55431,
        repositoryConfig,
      }),
    );
    assert.deepEqual(
      verifyDisposableSupabaseAuthority(environment, {
        statusRunner(command, args) {
          calls.push({ command, args });
          return JSON.stringify(status);
        },
      }),
      {
        databaseUrl: environment.M1_REAL_POSTGRES_DATABASE_URL,
        projectId,
        supabaseUrl: environment.SUPABASE_URL,
        workdir: root,
      },
    );
    assert.deepEqual(calls, [
      {
        command: "supabase",
        args: ["status", "--workdir", root, "-o", "json"],
      },
    ]);

    for (const mutation of [
      { API_URL: "http://127.0.0.1:55441" },
      {
        DB_URL: "postgresql://postgres:postgres@127.0.0.1:55442/postgres",
      },
      { ANON_KEY: "x".repeat(40) },
      { SERVICE_ROLE_KEY: "y".repeat(40) },
    ])
      assert.throws(
        () =>
          verifyDisposableSupabaseAuthority(environment, {
            statusRunner: () => JSON.stringify({ ...status, ...mutation }),
          }),
        /status does not match the disposable environment/,
      );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("cleanup validation requires the owned marker and refuses repository Supabase", () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "1hk-m1-supabase-test-")),
  );
  const projectId = "1hk-m1-89abcdef";
  try {
    mkdirSync(path.join(root, "supabase"));
    writeFileSync(
      path.join(root, ".m1-disposable-supabase.json"),
      `${JSON.stringify({ projectId, root })}\n`,
    );
    writeFileSync(
      path.join(root, "supabase", "config.toml"),
      ownedConfig(projectId),
    );
    assert.doesNotThrow(() =>
      assertDisposableCleanupTarget({ projectId, root }),
    );
    assert.throws(
      () =>
        assertDisposableCleanupTarget({
          projectId,
          root: path.resolve("supabase"),
        }),
      /repository Supabase|disposable root/,
    );
    writeFileSync(
      path.join(root, ".m1-disposable-supabase.json"),
      `${JSON.stringify({ projectId: "wrong", root })}\n`,
    );
    assert.throws(
      () => assertDisposableCleanupTarget({ projectId, root }),
      /marker/,
    );
    writeFileSync(
      path.join(root, ".m1-disposable-supabase.json"),
      `${JSON.stringify({ projectId, root })}\n`,
    );
    writeFileSync(
      path.join(root, "supabase", "config.toml"),
      `${ownedConfig(projectId)}# self-authored drift\n`,
    );
    assert.throws(
      () => assertDisposableCleanupTarget({ projectId, root }),
      /mismatched Supabase project|config/,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("cleanup validation rejects a symlink anywhere below the owned root", () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "1hk-m1-supabase-symlink-")),
  );
  const projectId = "1hk-m1-acde1234";
  try {
    mkdirSync(path.join(root, "supabase"));
    writeFileSync(
      path.join(root, ".m1-disposable-supabase.json"),
      `${JSON.stringify({ projectId, root })}\n`,
    );
    writeFileSync(
      path.join(root, "supabase", "config.toml"),
      ownedConfig(projectId),
    );
    symlinkSync(tmpdir(), path.join(root, "supabase", "foreign"));
    assert.throws(
      () => assertDisposableCleanupTarget({ projectId, root }),
      /symlink/,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("cleanup preserves recovery metadata when stopping a partially started stack fails", async () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "1hk-m1-supabase-stop-failure-")),
  );
  const projectId = "1hk-m1-a1b2c3d4";
  let removed = false;
  try {
    mkdirSync(path.join(root, "supabase"));
    writeFileSync(
      path.join(root, ".m1-disposable-supabase.json"),
      `${JSON.stringify({ projectId, root })}\n`,
    );
    writeFileSync(
      path.join(root, "supabase", "config.toml"),
      ownedConfig(projectId),
    );
    await assert.rejects(
      cleanupDisposableProject({
        projectId,
        root,
        projectReady: true,
        startAttempted: true,
        stop: async () => {
          throw new Error("stop failed");
        },
        remove: () => {
          removed = true;
        },
      }),
      /preserved.*recovery|recovery.*preserved/i,
    );
    assert.equal(removed, false);
    assert.doesNotThrow(() =>
      assertDisposableCleanupTarget({ projectId, root }),
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

test("cleanup removes an exact partial owned root only before start", async () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "1hk-m1-supabase-partial-")),
  );
  await cleanupDisposableProject({
    projectId: "1hk-m1-bead1234",
    root,
    projectReady: false,
    startAttempted: false,
  });
  assert.equal(existsSync(root), false);
});

test("signal state terminates the tracked child and blocks ordinary new work", () => {
  const killed = [];
  const lifecycle = createProcessLifecycle();
  const child = { kill: (signal) => killed.push(signal) };
  lifecycle.track(child);
  lifecycle.requestSignal("SIGTERM");
  lifecycle.requestSignal("SIGINT");
  assert.equal(lifecycle.signal, "SIGTERM");
  assert.deepEqual(killed, ["SIGTERM"]);
  assert.throws(() => lifecycle.assertCanStart(false), /SIGTERM/);
  assert.doesNotThrow(() => lifecycle.assertCanStart(true));
});

test("process lifecycle refuses its own POSIX process group", () => {
  if (process.platform === "win32") return;
  const ownProcessGroupId = Number(
    execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], {
      encoding: "utf8",
    }).trim(),
  );
  const lifecycle = createProcessLifecycle();
  assert.throws(
    () =>
      lifecycle.track(
        { pid: ownProcessGroupId, kill: () => true },
        { processGroup: true },
      ),
    /own process group/,
  );
});

test("signal termination kills the isolated parent and grandchild process group before cleanup", async () => {
  if (process.platform === "win32") return;
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "1hk-m1-process-group-")),
  );
  const pidPath = path.join(root, "pids.json");
  const readyPath = path.join(root, "grandchild-ready");
  const grandchildSource = [
    'const { writeFileSync } = require("node:fs");',
    'process.on("SIGTERM", () => {});',
    'writeFileSync(process.argv[1], "ready");',
    "setInterval(() => {}, 1000);",
  ].join("");
  const parentSource = [
    'const { spawn } = require("node:child_process");',
    'const { writeFileSync } = require("node:fs");',
    "const grandchild = spawn(process.execPath,",
    `["-e", ${JSON.stringify(grandchildSource)}, process.argv[2]],`,
    '{ stdio: "ignore" });',
    "writeFileSync(process.argv[1], JSON.stringify({",
    "  parent: process.pid, grandchild: grandchild.pid",
    "}));",
    "setInterval(() => {}, 1000);",
  ].join("");
  const lifecycle = createProcessLifecycle({ escalationMilliseconds: 100 });
  const childRun = runChildProcess(
    process.execPath,
    ["-e", parentSource, pidPath, readyPath],
    process.env,
    { lifecycle },
  );
  try {
    const deadline = Date.now() + 5_000;
    while (
      (!existsSync(pidPath) || !existsSync(readyPath)) &&
      Date.now() < deadline
    )
      await delay(10);
    assert.equal(
      existsSync(pidPath) && existsSync(readyPath),
      true,
      "child hierarchy did not become signal-ready",
    );
    const pids = JSON.parse(readFileSync(pidPath, "utf8"));
    const isAlive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        throw error;
      }
    };
    assert.equal(isAlive(pids.parent), true);
    assert.equal(isAlive(pids.grandchild), true);

    lifecycle.requestSignal("SIGINT");
    await assert.rejects(childRun, /signal SIGTERM|signal SIGKILL/);
    await lifecycle.waitForTermination();

    assert.equal(isAlive(pids.parent), false);
    assert.equal(isAlive(pids.grandchild), false);
    assert.equal(lifecycle.signal, "SIGINT");
  } finally {
    lifecycle.requestSignal("SIGTERM");
    await childRun.catch(() => {});
    await lifecycle.waitForTermination().catch(() => {});
    rmSync(root, { recursive: true });
  }
});

test(
  "normal leader exit retains and reaps its live process group before lifecycle cleanup",
  { timeout: 5_000 },
  async () => {
    if (process.platform === "win32") return;
    const root = realpathSync(
      mkdtempSync(path.join(tmpdir(), "1hk-m1-orphaned-process-group-")),
    );
    const pidPath = path.join(root, "pids.json");
    const readyPath = path.join(root, "grandchild-ready");
    const grandchildSource = [
      'const { writeFileSync } = require("node:fs");',
      'process.on("SIGTERM", () => {});',
      'writeFileSync(process.argv[1], "ready");',
      "setInterval(() => {}, 1000);",
    ].join("");
    const parentSource = [
      'const { spawn } = require("node:child_process");',
      'const { writeFileSync } = require("node:fs");',
      "const grandchild = spawn(process.execPath,",
      `["-e", ${JSON.stringify(grandchildSource)}, process.argv[2]],`,
      '{ stdio: "ignore" });',
      "writeFileSync(process.argv[1], JSON.stringify({",
      "  parent: process.pid, grandchild: grandchild.pid",
      "}));",
      "grandchild.unref();",
    ].join("");
    const lifecycle = createProcessLifecycle({ escalationMilliseconds: 100 });
    let pids;
    const isAlive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        if (error?.code === "ESRCH") return false;
        throw error;
      }
    };
    try {
      await runChildProcess(
        process.execPath,
        ["-e", parentSource, pidPath, readyPath],
        process.env,
        { lifecycle },
      );
      const deadline = Date.now() + 5_000;
      while (
        (!existsSync(pidPath) || !existsSync(readyPath)) &&
        Date.now() < deadline
      )
        await delay(10);
      assert.equal(
        existsSync(pidPath) && existsSync(readyPath),
        true,
        "independent descendant did not become ready",
      );
      pids = JSON.parse(readFileSync(pidPath, "utf8"));
      assert.equal(isAlive(pids.parent), false);
      assert.equal(isAlive(pids.grandchild), true);

      await lifecycle.terminateTracked();

      assert.equal(isAlive(pids.grandchild), false);
    } finally {
      await lifecycle.terminateTracked?.().catch(() => {});
      if (pids?.grandchild && isAlive(pids.grandchild))
        process.kill(pids.grandchild, "SIGKILL");
      rmSync(root, { recursive: true });
    }
  },
);

test(
  "normal command without descendants completes and leaves no lifecycle work",
  { timeout: 2_000 },
  async () => {
    const lifecycle = createProcessLifecycle({ escalationMilliseconds: 100 });
    await runChildProcess(process.execPath, ["-e", ""], process.env, {
      lifecycle,
    });
    await lifecycle.terminateTracked();
  },
);

test("a child failure after SIGINT retains the interrupt exit identity", () => {
  const childFailure = new Error("child exited after termination");
  const result = interruptedError(childFailure, "SIGINT");
  assert.equal(result, childFailure);
  assert.equal(result.signal, "SIGINT");
});

test("sensitive child failures never expose captured keys or database URLs", async () => {
  const secret = "service-role-key-secret";
  const databaseUrl = "postgresql://postgres:secret@127.0.0.1:55432/postgres";
  await assert.rejects(
    runChildProcess(
      process.execPath,
      [
        "-e",
        `process.stdout.write(${JSON.stringify(secret)}); process.stderr.write(${JSON.stringify(databaseUrl)}); process.exit(7)`,
      ],
      process.env,
      {
        lifecycle: createProcessLifecycle(),
        sensitive: true,
      },
    ),
    (error) => {
      assert.doesNotMatch(error.message, new RegExp(secret));
      assert.doesNotMatch(error.message, /postgresql:\/\//);
      assert.match(error.message, /exit 7/);
      return true;
    },
  );
});

test("direct Playwright invocation fails before fixture writes", () => {
  const result = spawnSync(
    path.join("node_modules", ".bin", "playwright"),
    ["test", "--list", "--config=playwright.m1.config.ts"],
    {
      cwd: path.resolve("."),
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith("M1_")),
      ),
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /M1 E2E requires M1_E2E_DISPOSABLE=1/,
  );
});

test("direct Playwright rejects a self-authored root backed by another loopback stack", () => {
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "1hk-m1-supabase-fabricated-")),
  );
  const projectId = "1hk-m1-cafefeed";
  try {
    mkdirSync(path.join(root, "supabase"));
    mkdirSync(path.join(root, "bin"));
    writeFileSync(
      path.join(root, ".m1-disposable-supabase.json"),
      `${JSON.stringify({ projectId, root })}\n`,
    );
    writeFileSync(
      path.join(root, "supabase", "config.toml"),
      renderDisposableSupabaseConfig({
        projectId,
        portBase: 55431,
        repositoryConfig,
      }),
    );
    const fakeSupabase = path.join(root, "bin", "supabase");
    writeFileSync(
      fakeSupabase,
      `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(
        JSON.stringify({
          API_URL: "http://127.0.0.1:55441",
          DB_URL: "postgresql://postgres:postgres@127.0.0.1:55442/postgres",
          ANON_KEY: "x".repeat(40),
          SERVICE_ROLE_KEY: "y".repeat(40),
        }),
      )});\n`,
    );
    chmodSync(fakeSupabase, 0o700);
    const environment = {
      ...process.env,
      ...validEnvironment,
      COLLABORATION_FREEZE_SECRET: "f".repeat(40),
      COLLABORATION_INTERNAL_SECRET: "i".repeat(40),
      M1_E2E_DISPOSABLE_PROJECT_ID: projectId,
      M1_E2E_DISPOSABLE_WORKDIR: root,
      PATH: `${path.join(root, "bin")}:${process.env.PATH}`,
      VITE_DRAWING_COLLABORATION_URL: "ws://127.0.0.1:12349",
      VITE_SUPABASE_ANON_KEY: validEnvironment.SUPABASE_ANON_KEY,
      VITE_SUPABASE_URL: validEnvironment.SUPABASE_URL,
    };
    const result = spawnSync(
      path.join("node_modules", ".bin", "playwright"),
      ["test", "--list", "--config=playwright.m1.config.ts"],
      { cwd: path.resolve("."), encoding: "utf8", env: environment },
    );
    assert.notEqual(result.status, 0);
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /status does not match the disposable environment/,
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});
