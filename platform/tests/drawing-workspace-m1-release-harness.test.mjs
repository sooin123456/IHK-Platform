import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertDisposableCleanupTarget,
  assertM1LoopbackEnvironment,
  renderDisposableSupabaseConfig,
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
      `project_id = "${projectId}"\n`,
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
  } finally {
    rmSync(root, { recursive: true });
  }
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
