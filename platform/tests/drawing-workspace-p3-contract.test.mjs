import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import ts from "typescript";

import * as fixtureHelpers from "../e2e/utils/drawing-collaboration-fixture.ts";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

function callsIn(file) {
  const calls = [];
  const expressionName = (expression) => {
    if (ts.isIdentifier(expression)) return expression.text;
    if (ts.isPropertyAccessExpression(expression))
      return `${expressionName(expression.expression)}.${expression.name.text}`;
    return null;
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const name = expressionName(node.expression);
      if (name) calls.push({ name, node });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return calls;
}

const readyEnvironment = {
  E2E_BASE_URL: "https://drawing-preview.acme.kr",
  SUPABASE_URL: "https://abcdefghijklmnop.supabase.co",
  SUPABASE_ANON_KEY: `sb_publishable_${"a".repeat(32)}`,
  SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${"b".repeat(32)}`,
  VITE_DRAWING_COLLABORATION_URL: "wss://drawing-collab.acme.kr",
  COLLABORATION_INTERNAL_URL: "https://drawing-collab-internal.acme.kr",
  COLLABORATION_INTERNAL_SECRET: "c".repeat(32),
  COLLABORATION_FREEZE_SECRET: "d".repeat(32),
  P3_E2E_DATABASE_ADMIN_URL:
    "postgresql://p3_admin:secret@db.acme.kr:5432/postgres?sslmode=require",
  P3_E2E_RUN_ID: "release-20260826-001",
};

test("P3 production command fails closed for every external authority", () => {
  assert.equal(
    typeof fixtureHelpers.drawingP3ProductionCredentialStatus,
    "function",
  );
  assert.equal(
    typeof fixtureHelpers.requireDrawingP3ProductionCredentials,
    "function",
  );
  assert.deepEqual(
    fixtureHelpers.drawingP3ProductionCredentialStatus(readyEnvironment),
    { status: "READY", missing: [] },
  );

  for (const [name, value] of [
    ["E2E_BASE_URL", "http://127.0.0.1:4000"],
    ["SUPABASE_URL", "https://example.supabase.co"],
    ["SUPABASE_ANON_KEY", "local-anon-key"],
    ["SUPABASE_SERVICE_ROLE_KEY", "[SENSITIVE]"],
    ["VITE_DRAWING_COLLABORATION_URL", "ws://localhost:1234"],
    ["COLLABORATION_INTERNAL_URL", "<masked>"],
    ["COLLABORATION_INTERNAL_SECRET", "placeholder-secret"],
    ["COLLABORATION_FREEZE_SECRET", "***"],
    ["P3_E2E_DATABASE_ADMIN_URL", "postgres://localhost/postgres"],
    ["P3_E2E_RUN_ID", "placeholder"],
  ]) {
    const environment = { ...readyEnvironment, [name]: value };
    const status =
      fixtureHelpers.drawingP3ProductionCredentialStatus(environment);
    assert.deepEqual(status, { status: "UNEXECUTED", missing: [name] });
    assert.throws(
      () => fixtureHelpers.requireDrawingP3ProductionCredentials(environment),
      (error) =>
        error instanceof Error &&
        error.message.includes("UNEXECUTED") &&
        error.message.includes(name) &&
        !error.message.includes(value),
    );
  }
  assert.throws(() =>
    fixtureHelpers.requireDrawingP3ProductionCredentials({
      ...readyEnvironment,
      COLLABORATION_INTERNAL_SECRET: ` ${readyEnvironment.COLLABORATION_FREEZE_SECRET} `,
    }),
  );
});

test("P3 fixture identities are deterministic, role-complete and secret-free", () => {
  assert.equal(typeof fixtureHelpers.buildDrawingP3Identities, "function");
  const first = fixtureHelpers.buildDrawingP3Identities(
    readyEnvironment.P3_E2E_RUN_ID,
  );
  const second = fixtureHelpers.buildDrawingP3Identities(
    readyEnvironment.P3_E2E_RUN_ID,
  );
  assert.deepEqual(second, first);
  assert.deepEqual(Object.keys(first), [
    "owner",
    "editor",
    "reviewer",
    "viewer",
    "nonMember",
  ]);
  assert.equal(new Set(Object.values(first)).size, 5);
  for (const [role, email] of Object.entries(first)) {
    assert.match(email, new RegExp(`^1hk-p3-e2e-${role.toLowerCase()}-`));
    assert.match(email, /@example\.test$/);
    assert.doesNotMatch(email, /secret|password|token/i);
  }
  for (const invalid of ["", "placeholder", "spaces are bad", "../escape"])
    assert.throws(() => fixtureHelpers.buildDrawingP3Identities(invalid));
});

test("P3 production spec registers executable mutation-resistant gates", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  const file = ts.createSourceFile(
    "drawing-workspace-p3.spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.equal(file.parseDiagnostics.length, 0);
  const calls = callsIn(file);
  assert.equal(
    calls.some(({ name }) => name === "test.describe.serial"),
    true,
  );
  assert.equal(
    calls.some(({ name }) => name === "test.skip"),
    false,
  );
  assert.equal(
    calls.some(({ name }) => name === "requireDrawingP3ProductionCredentials"),
    true,
  );

  const gates = calls
    .filter(
      ({ name, node }) =>
        name === "test" &&
        ts.isStringLiteral(node.arguments[0]) &&
        /^P3 Gate \d{2}:/.test(node.arguments[0].text),
    )
    .map(({ node }) => ({
      name: node.arguments[0].text,
      body: node.arguments[1].getText(file),
    }));
  assert.deepEqual(
    gates.map(({ name }) => name.slice(0, 10)),
    Array.from(
      { length: 8 },
      (_, index) => `P3 Gate ${String(index + 1).padStart(2, "0")}`,
    ),
  );
  for (const gate of gates) {
    assert.match(gate.body, /expect\s*\(/, gate.name);
    assert.doesNotMatch(gate.body, /TODO|placeholder|test\.skip/i, gate.name);
  }

  const bodies = Object.fromEntries(
    gates.map(({ name, body }) => [name.slice(0, 10), body]),
  );
  const contracts = {
    "P3 Gate 01": [
      /threeContexts/,
      /공동 작업 참여자 3명/,
      /cursorWorld/,
      /data-remote-selection-count/,
      /data-active-canvas-id/,
    ],
    "P3 Gate 02": [
      /differentObject/,
      /independentMovement/,
      /geometry.*version/is,
      /reflectionLatencies/,
      /percentile/,
      /500/,
      /browserVersion/,
      /viewport/,
      /cpu.*memory/is,
      /cold.*warm/is,
    ],
    "P3 Gate 03": [
      /yjsOrder/,
      /loserIndex.*winnerIndex/is,
      /authoritativeWinner/,
      /conflictedLoser/,
      /P1C01/,
      /operationStatus/,
      /객체 잠금 상태/,
    ],
    "P3 Gate 04": [
      /setOffline\(true\)/,
      /100/,
      /advanceOfflineMinute/,
      /readOutboxIds/,
      /client_operation_id/,
      /new Set/,
      /page\.close/,
      /setOffline\(false\)/,
    ],
    "P3 Gate 05": [
      /fixture\.viewer/,
      /fixture\.reviewer/,
      /fixture\.nonMember/,
      /deniedProvider/,
      /viewerConnection/,
      /viewerWsObjectId/,
      /viewerWsOperationId/,
      /hasUnsyncedChanges/,
      /error.*toBeTruthy/is,
    ],
    "P3 Gate 06": [
      /댓글 등록/,
      /mentioned_user_ids/,
      /프로젝트 멤버 및 역할 관리/,
      /member-email/,
      /member-role/,
      /추가·변경/,
      /lukas_qto_project_members/,
      /postCheckpointObject/,
      /checkpointGraph/,
      /변경 이력/,
      /restore_checkpoint/,
    ],
    "P3 Gate 07": [
      /mouse\.down/,
      /dragBase/,
      /editorOperationsBefore/,
      /검토 요청/,
      /review_requested/,
      /approved/,
      /frozenBase.*version/is,
      /새 초안으로 복원/,
      /draft/,
    ],
    "P3 Gate 08": [
      /readSourceEvidence/,
      /toEqual\(immutableSourceBefore\)/,
      /runDownload/,
      /quantities/,
      /quantityArtifact/,
      /lukas_qto_takeoff_inputs/,
      /drawing-room|협업 도면실/i,
      /revit-2025/,
      /unzipSync/,
      /approval/i,
    ],
  };
  for (const [gate, patterns] of Object.entries(contracts))
    for (const pattern of patterns)
      assert.match(bodies[gate], pattern, `${gate}: ${pattern}`);
  assert.match(source, /new HocuspocusProvider\(/);
  assert.match(source, /new HocuspocusProviderWebsocket\(/);
  assert.match(source, /P3 denied-provider classification timed out/);
  assert.match(source, /onAuthenticationFailed/);
  assert.match(source, /P3 denied-provider cleanup failed/);
  assert.match(source, /test\.afterEach/);
  assert.match(source, /trackedContexts/);
  assert.match(source, /trackedProviderDisposers/);
});

test("P3 command and Playwright config keep local and production execution separate", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const config = await read("playwright.config.ts");
  assert.equal(
    packageJson.scripts["test:e2e:drawing-workspace-p3:production"],
    "npx playwright test e2e/drawing-workspace-p3.spec.ts --project=chromium",
  );
  assert.match(config, /P3_E2E_RUN_ID/);
  assert.match(config, /remote.*webServer/s);
  assert.doesNotMatch(config, /P3_E2E_DATABASE_ADMIN_URL[^\n]*console/i);
});

test("P3 npm command exits UNEXECUTED before starting a credential-free server", () => {
  const result = spawnSync(
    "npm",
    ["run", "test:e2e:drawing-workspace-p3:production"],
    {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH },
      timeout: 10_000,
    },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.notEqual(result.status, 0);
  assert.equal(result.signal, null, output);
  assert.match(output, /P3 production gate is UNEXECUTED/);
  assert.doesNotMatch(output, /WebServer|react-router dev|ExperimentalWarning/);
});
