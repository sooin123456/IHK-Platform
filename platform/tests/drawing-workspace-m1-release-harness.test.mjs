import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

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
const ownedConfig = (projectId, portBase = 55431) =>
  renderDisposableSupabaseConfig({ projectId, portBase, repositoryConfig });

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
