import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
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

const disposableEnvironment = {
  M1_E2E_P3_DISPOSABLE: "1",
  M1_E2E_DISPOSABLE: "1",
  E2E_BASE_URL: "http://127.0.0.1:4000",
  SUPABASE_URL: "http://127.0.0.1:55431",
  SUPABASE_ANON_KEY: "a".repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
  VITE_DRAWING_COLLABORATION_URL: "ws://127.0.0.1:12349",
  COLLABORATION_INTERNAL_URL: "http://127.0.0.1:12349",
  COLLABORATION_INTERNAL_SECRET: "i".repeat(40),
  COLLABORATION_FREEZE_SECRET: "f".repeat(40),
  M1_REAL_POSTGRES_DATABASE_URL:
    "postgresql://postgres:postgres@127.0.0.1:55432/postgres",
  P3_E2E_DATABASE_ADMIN_URL:
    "postgresql://postgres:postgres@127.0.0.1:55432/postgres",
  P3_E2E_RUN_ID: "release-20260905-a1b2c3d4",
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
  for (const name of [
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "COLLABORATION_INTERNAL_SECRET",
    "COLLABORATION_FREEZE_SECRET",
  ]) {
    const environment = { ...readyEnvironment, [name]: ` ${"x".repeat(31)} ` };
    assert.deepEqual(
      fixtureHelpers.drawingP3ProductionCredentialStatus(environment),
      { status: "UNEXECUTED", missing: [name] },
    );
    assert.throws(() =>
      fixtureHelpers.requireDrawingP3ProductionCredentials(environment),
    );
  }
});

test("P3 disposable credentials require the exact runner-owned loopback authority", () => {
  assert.equal(
    typeof fixtureHelpers.requireDrawingP3DisposableCredentials,
    "function",
  );
  assert.deepEqual(
    fixtureHelpers.requireDrawingP3DisposableCredentials(
      disposableEnvironment,
    ),
    Object.fromEntries(
      Object.keys(readyEnvironment).map((name) => [
        name,
        disposableEnvironment[name],
      ]),
    ),
  );

  for (const replacement of [
    { M1_E2E_P3_DISPOSABLE: undefined },
    { M1_E2E_P3_DISPOSABLE: "true" },
    { M1_E2E_DISPOSABLE: undefined },
    { M1_E2E_DISPOSABLE: "true" },
    { E2E_BASE_URL: "http://127.0.0.1:4001" },
    { VITE_DRAWING_COLLABORATION_URL: "ws://127.0.0.1:12350" },
    { COLLABORATION_INTERNAL_URL: "http://127.0.0.1:12350" },
    { SUPABASE_URL: "https://abcdefghijklmnop.supabase.co" },
    { SUPABASE_URL: "http://localhost:55431" },
    { SUPABASE_ANON_KEY: undefined },
    { SUPABASE_ANON_KEY: "a".repeat(31) },
    { SUPABASE_SERVICE_ROLE_KEY: undefined },
    { SUPABASE_SERVICE_ROLE_KEY: "s".repeat(31) },
    {
      M1_REAL_POSTGRES_DATABASE_URL:
        "postgresql://postgres:postgres@db.acme.kr:5432/postgres",
      P3_E2E_DATABASE_ADMIN_URL:
        "postgresql://postgres:postgres@db.acme.kr:5432/postgres",
    },
    {
      P3_E2E_DATABASE_ADMIN_URL:
        "postgresql://postgres:postgres@127.0.0.1:55433/postgres",
    },
    { COLLABORATION_INTERNAL_SECRET: "i".repeat(31) },
    { COLLABORATION_FREEZE_SECRET: "f".repeat(31) },
    {
      COLLABORATION_FREEZE_SECRET:
        disposableEnvironment.COLLABORATION_INTERNAL_SECRET,
    },
    { P3_E2E_RUN_ID: "local-test-value" },
  ]) {
    const environment = { ...disposableEnvironment, ...replacement };
    assert.throws(
      () =>
        fixtureHelpers.requireDrawingP3DisposableCredentials(environment),
      (error) => {
        assert.equal(error instanceof Error, true);
        for (const secret of [
          disposableEnvironment.SUPABASE_ANON_KEY,
          disposableEnvironment.SUPABASE_SERVICE_ROLE_KEY,
          disposableEnvironment.COLLABORATION_INTERNAL_SECRET,
          disposableEnvironment.COLLABORATION_FREEZE_SECRET,
          disposableEnvironment.M1_REAL_POSTGRES_DATABASE_URL,
        ])
          assert.equal(error.message.includes(secret), false);
        return true;
      },
    );
  }
});

test("P3 workspace paths use canonical document IDs after authentication", () => {
  assert.equal(typeof fixtureHelpers.buildDrawingP3WorkspacePath, "function");
  const fixture = { projectId: "project-123" };
  const workspace = { documentId: "document-456", fileId: "file-legacy" };
  assert.equal(
    fixtureHelpers.buildDrawingP3WorkspacePath(fixture, workspace),
    "/projects/project-123/workspaces/document-456",
  );
  assert.equal(
    fixtureHelpers.buildDrawingP3WorkspacePath(
      fixture,
      workspace,
      "child-document-789",
    ),
    "/projects/project-123/workspaces/child-document-789",
  );
});

test("P3 second-canvas selector excludes canvas action buttons", () => {
  assert.equal(
    fixtureHelpers.DRAWING_P3_SECOND_CANVAS_BUTTON_NAME instanceof RegExp,
    true,
  );
  const accessibleNames = [
    "P2 paper canvas 02 (용지)",
    "캔버스 위로 이동: P2 paper canvas 02",
    "캔버스 아래로 이동: P2 paper canvas 02",
    "캔버스 삭제: P2 paper canvas 02",
  ];
  assert.deepEqual(
    accessibleNames.filter((name) =>
      fixtureHelpers.DRAWING_P3_SECOND_CANVAS_BUTTON_NAME.test(name),
    ),
    ["P2 paper canvas 02 (용지)"],
  );
});

test("P3 different-object movement uses an unambiguous grid target", () => {
  assert.deepEqual(fixtureHelpers.DRAWING_P3_SECOND_OBJECT_TARGET, {
    x: 270,
    y: 140,
  });
  assert.equal(fixtureHelpers.DRAWING_P3_SECOND_OBJECT_TARGET.x % 10, 0);
  assert.equal(fixtureHelpers.DRAWING_P3_SECOND_OBJECT_TARGET.y % 10, 0);
});

test("P3 reflection gestures remain nonzero after grid snapping", () => {
  assert.equal(typeof fixtureHelpers.buildDrawingP3ReflectionGesture, "function");
  const gestures = Array.from({ length: 30 }, (_, index) =>
    fixtureHelpers.buildDrawingP3ReflectionGesture(index),
  );
  assert.equal(
    new Set(gestures.map(({ from }) => `${from.x}:${from.y}`)).size,
    gestures.length,
  );
  for (const { from, to } of gestures) {
    for (const coordinate of [from.x, from.y, to.x, to.y])
      assert.equal(coordinate % 10, 0);
    assert.ok(Math.abs(to.x - from.x) >= 20);
    assert.ok(Math.abs(to.y - from.y) >= 20);
  }
});

test("P3 disposable cleanup terminally fails only its queued IFC jobs", async () => {
  assert.equal(
    typeof fixtureHelpers.failDrawingP3DisposableDerivativeJobs,
    "function",
  );
  const projectId = "project-123";
  const candidates = [
    {
      job_id: "job-1",
      project_id: projectId,
      source_file_id: "ifc-1",
      lease_token: "lease-1",
      derivative_version: 1,
    },
    {
      job_id: "job-2",
      project_id: projectId,
      source_file_id: "ifc-2",
      lease_token: "lease-2",
      derivative_version: 1,
    },
  ];
  const failed = [];
  const claims = [];
  const statusReads = [];
  const fixture = {
    projectId,
    ifcFileId: "ifc-1",
    revisedIfcFileId: "ifc-2",
    sourceEvidence: {
      "ifc-1": { metadataSha256: "a".repeat(64) },
      "ifc-2": { metadataSha256: "b".repeat(64) },
    },
    admin: {
      async rpc(name, args) {
        if (name === "lukas_drawing_claim_ifc_derivative_job")
          throw new Error("legacy claim must never be used");
        if (name === "lukas_drawing_claim_ifc_derivative_job_for_converter") {
          claims.push(args);
          return { data: candidates.length ? [candidates.shift()] : [] };
        }
        if (name === "lukas_drawing_fail_ifc_derivative_job") {
          failed.push(args);
          return { data: "failed" };
        }
        throw new Error(`unexpected RPC: ${name}`);
      },
    },
  };
  const statusClient = {
    async rpc(name, args) {
      assert.equal(name, "lukas_drawing_ifc_derivative_job_status");
      statusReads.push(args);
      return { data: { state: "failed" }, error: null };
    },
  };
  await fixtureHelpers.failDrawingP3DisposableDerivativeJobs(
    fixture,
    statusClient,
  );
  const cleanupDigest = createHash("sha256")
    .update("1HK-P3-DISPOSABLE-IFC-CLEANUP-v1", "utf8")
    .digest("hex");
  assert.deepEqual(claims, [
    { p_converter_sha256: cleanupDigest, p_lease_seconds: 300 },
    { p_converter_sha256: cleanupDigest, p_lease_seconds: 300 },
  ]);
  assert.deepEqual(
    failed.map((entry) => ({
      job: entry.p_job_id,
      retryable: entry.p_retryable,
      code: entry.p_error_code,
    })),
    [
      { job: "job-1", retryable: false, code: "disposable_fixture_cleanup" },
      { job: "job-2", retryable: false, code: "disposable_fixture_cleanup" },
    ],
  );
  assert.deepEqual(statusReads, [
    { p_source_file_id: "ifc-1", p_source_sha256: "a".repeat(64) },
    { p_source_file_id: "ifc-2", p_source_sha256: "b".repeat(64) },
  ]);
});

test("P3 Node providers attach when an external websocket is supplied", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  for (const [startMarker, endMarker] of [
    ["async function connectProvider(", "async function deniedProvider("],
    ["async function deniedProvider(", "async function sendOutcomeReceipt("],
  ]) {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start + startMarker.length);
    assert.ok(start >= 0 && end > start, startMarker);
    const body = source.slice(start, end);
    assert.match(body, /websocketProvider/);
    assert.match(body, /provider(?:!)?\.attach\(\)/);
  }

  const smoke = await read("e2e/drawing-collaboration-service-smoke.spec.ts");
  assert.equal(
    [...smoke.matchAll(/websocketProvider:\s*websocket/g)].length,
    [...smoke.matchAll(/provider(?:!)?\.attach\(\)/g)].length,
  );
});

test("P3 Gate 03 keeps collision evidence in a separate sourceless room", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  const start = source.indexOf('test("P3 Gate 03:');
  const end = source.indexOf('test("P3 Gate 04:', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /lukas_drawing_create_document/);
  assert.match(body, /p_source_file_id:\s*null/);
  assert.match(body, /p_blank:\s*true/);
  assert.match(body, /collisionWorkspace\.revisionId/);
  assert.match(body, /collisionWorkspace\.workLayerId/);
  assert.doesNotMatch(body, /p_source_file_id:\s*fixture\.revisedPdfFileId/);
  const loserFlush = body.indexOf(
    "editorConnection.provider.flushPendingUpdates()",
  );
  const causalReceipt = body.indexOf(
    ".includes(conflictedLoser.clientOperationId)",
    loserFlush,
  );
  const winnerAppend = body.indexOf(
    "ownerConnection.document,\n      authoritativeWinner",
  );
  assert.ok(loserFlush >= 0 && causalReceipt > loserFlush);
  assert.ok(winnerAppend > causalReceipt);
  const ownerObjectTab = body.indexOf(
    'owner.page.getByRole("tab", { name: "객체" })',
  );
  const editorMouseDown = body.indexOf("editor.page.mouse.down()");
  const lockStatus = body.indexOf('getByLabel("객체 잠금 상태"');
  assert.ok(ownerObjectTab >= 0 && editorMouseDown > ownerObjectTab);
  assert.ok(lockStatus > editorMouseDown);
});

test("P3 Gate 06 mounts the editor collaboration panel before realtime assertions", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  const start = source.indexOf('test("P3 Gate 06:');
  const end = source.indexOf('test("P3 Gate 07:', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  const editorPanel = body.indexOf(
    'editor.page.getByRole("tab", { name: "댓글·이슈" })',
  );
  const submit = body.indexOf('name: "댓글 등록"');
  const editorComment = body.indexOf(
    'editor.page.getByText("P3 명시적 멘션 댓글")',
  );
  assert.ok(editorPanel >= 0 && submit > editorPanel);
  assert.ok(editorComment > submit);
  assert.match(
    body,
    /getByRole\("textbox", \{ name: "댓글", exact: true \}\)/,
  );
  assert.doesNotMatch(body, /getByLabel\("댓글"\)/);
  assert.match(body, /getByRole\("region", \{ name: "변경 이력" \}\)/);
  assert.doesNotMatch(body, /getByLabel\("변경 이력"\)/);
  assert.match(body, /\.eq\("status", "active"\)/);
  assert.doesNotMatch(body, /\.is\("deleted_at", null\)/);
});

test("P3 Gate 04 waits for an editable selected canvas before offline input", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  const start = source.indexOf('test("P3 Gate 04:');
  const end = source.indexOf('test("P3 Gate 05:', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  const editReady = body.indexOf('"data-edit-ready",');
  const connected = body.indexOf('name: "공동 편집 상태: connected"');
  const selected = body.indexOf('"data-selected-object-id",');
  const offline = body.indexOf("context.setOffline(true)");
  assert.ok(editReady >= 0 && connected >= 0);
  assert.ok(selected > editReady && selected > connected);
  assert.ok(offline > selected);
  assert.match(body, /"data-edit-ready",\s*"true"/);
  assert.match(body, /"data-selected-object-id",\s*sharedObjectId/);
});

test("P3 Gate 07 follows live geometry and same-document child revision UI contracts", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  const start = source.indexOf('test("P3 Gate 07:');
  const end = source.indexOf('test("P3 Gate 08:', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  const ownerObjectTab = body.indexOf(
    'owner.page.getByRole("tab", { name: "객체" })',
  );
  const editorMouseDown = body.indexOf("editor.page.mouse.down()");
  const lockStatus = body.indexOf('getByLabel("객체 잠금 상태"');
  assert.ok(ownerObjectTab >= 0 && editorMouseDown > ownerObjectTab);
  assert.ok(lockStatus > editorMouseDown);
  assert.match(body, /dragBase\.data\.geometry/);
  assert.doesNotMatch(
    body,
    /canvasPoint\(editor\.page, \{ x: 120, y: 90 \}\)/,
  );
  assert.match(
    body,
    /button\[aria-label="선 도구"\]:not\(:disabled\)/,
  );
  assert.match(body, /expect\(enabledEditorLineTool\)\.toHaveCount\(0\)/);
  assert.doesNotMatch(body, /expect\(editorLineTool\)\.toBeVisible/);
  assert.doesNotMatch(body, /searchParams\.has\("document"\)/);
  assert.match(body, /\/workspaces\//);
  const restoreClick = body.indexOf('name: "새 초안으로 복원"');
  assert.ok(restoreClick >= 0);
  assert.match(
    body,
    /\.eq\("parent_revision_id",\s*fixture\.blankWorkspace\.revisionId\)/,
  );
  assert.match(
    body,
    /expect\(child\.data\.document_id\)\.toBe\(\s*fixture\.blankWorkspace\.documentId/,
  );
  assert.match(
    body,
    /expect\(child\.data\.id\)\.not\.toBe\(\s*fixture\.blankWorkspace\.revisionId/,
  );
  assert.doesNotMatch(body, /url\.pathname !== parentWorkspacePath/);
  assert.doesNotMatch(body, /document\.querySelectorAll\("canvas"\)/);
  assert.match(
    body,
    /editorSurface\.evaluate\([\s\S]*element\.hasPointerCapture\(pointerId\)/,
  );
});

test("P3 Gate 08 scopes the quantity upload submit to its intent form", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  const start = source.indexOf('test("P3 Gate 08:');
  assert.ok(start >= 0);
  const body = source.slice(start);
  assert.match(
    body,
    /form:has\(input\[name="intent"\]\[value="takeoff_upload"\]\)/,
  );
  assert.doesNotMatch(
    body,
    /page\.getByRole\("button", \{ name: "두 파일 등록" \}\)\.click/,
  );
  assert.match(body, /\/도면 작업실\//);
  assert.doesNotMatch(body, /\/협업 도면실\//);
  assert.match(body, /childOperationsBefore/);
  assert.match(body, /childObjectIdsBefore/);
  assert.match(
    body,
    /\.eq\("revision_id",\s*nextDraft!\.revisionId\)/,
  );
  assert.match(body, /newChildOperationIds/);
  assert.match(body, /newChildObjects/);
  assert.match(body, /geometryTypes:\s*\["line"\]/);
  assert.match(body, /page\.reload\(\)/);
  assert.match(body, /data-rendered-object-count/);
  assert.match(body, /persistedChildObject/);
  assert.match(
    body,
    /\?revision=\$\{fixture\.blankWorkspace\.revisionId\}/,
  );
  const approvedRevisionNavigation = body.indexOf(
    "?revision=${fixture.blankWorkspace.revisionId}",
  );
  const firstExport = body.indexOf('runDownload(page, "SVG")');
  assert.ok(
    approvedRevisionNavigation >= 0 && firstExport > approvedRevisionNavigation,
  );
});

test("every production drawing export keeps the audit boundary", async () => {
  const source = await read("app/lukas/components/drawing-workspace.tsx");
  assert.match(source, /auditRequired=\{!previewMode\}/);
  assert.doesNotMatch(
    source,
    /auditRequired=\{\s*!previewMode\s*&&\s*\(/,
  );
});

test("P3 disposable evidence and cleanup remain truthful and runner-owned", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  const runner = await read("scripts/run-drawing-workspace-m1-e2e.mjs");
  assert.match(source, /DISPOSABLE_PRODUCTION_SHAPED_MEASURED/);
  assert.match(source, /hostedProductionMeasurement:\s*disposableP3Mode\s*\?\s*"UNEXECUTED"/s);
  const afterAllStart = source.indexOf("test.afterAll(async () => {");
  const gateOneStart = source.indexOf('test("P3 Gate 01:', afterAllStart);
  assert.ok(afterAllStart >= 0 && gateOneStart > afterAllStart);
  const cleanup = source.slice(afterAllStart, gateOneStart);
  assert.match(cleanup, /const cleanupErrors = \[\]/);
  assert.match(cleanup, /try\s*\{[\s\S]*failDrawingP3DisposableDerivativeJobs/);
  assert.match(cleanup, /catch \(error\)[\s\S]*cleanupErrors\.push\(error\)/);
  assert.match(cleanup, /if \(disposableP3Mode\)[\s\S]*return/);
  assert.match(cleanup, /if \(!disposableP3Mode\)[\s\S]*destroyDrawingP3Fixture/);
  assert.match(cleanup, /AggregateError\(\s*cleanupErrors/);
  assert.match(
    runner,
    /finally \{[\s\S]*cleanupDisposableProject\([\s\S]*"stop"[\s\S]*"--no-backup"/,
  );
});

test("P3 Gate 05 probes live WebSocket write denial for every admitted read-only role", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  const start = source.indexOf('test("P3 Gate 05:');
  const end = source.indexOf('test("P3 Gate 06:', start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(
    body,
    /const readOnlyWebSocketRoles = \[[\s\S]*fixture\.viewer[\s\S]*fixture\.reviewer[\s\S]*fixture\.approver[\s\S]*\]/,
  );
  assert.match(body, /for \(const \{ label, user, coordinate \} of readOnlyWebSocketRoles\)/);
  assert.match(body, /appendDrawingCollaborationOperation\([\s\S]*actorId: user\.id/);
  assert.match(body, /expect\(deniedWsRow\.data\)\.toBeNull\(\)/);
});

test("P3 spec selects disposable credentials only for the exact flag", async () => {
  const source = await read("e2e/drawing-workspace-p3.spec.ts");
  const file = ts.createSourceFile(
    "drawing-workspace-p3.spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = file.statements
    .filter(ts.isVariableStatement)
    .flatMap(({ declarationList }) => declarationList.declarations)
    .find(({ name }) => ts.isIdentifier(name) && name.text === "credentials");
  const modeDeclaration = file.statements
    .filter(ts.isVariableStatement)
    .flatMap(({ declarationList }) => declarationList.declarations)
    .find(
      ({ name }) => ts.isIdentifier(name) && name.text === "disposableP3Mode",
    );
  assert.ok(declaration?.initializer);
  assert.ok(modeDeclaration?.initializer);
  assert.equal(
    modeDeclaration.initializer.getText(file),
    'process.env.M1_E2E_P3_DISPOSABLE === "1"',
  );
  assert.equal(ts.isConditionalExpression(declaration.initializer), true);
  assert.equal(
    declaration.initializer.condition.getText(file),
    "disposableP3Mode",
  );
  assert.equal(
    declaration.initializer.whenTrue.expression.getText(file),
    "requireDrawingP3DisposableCredentials",
  );
  assert.equal(
    declaration.initializer.whenFalse.expression.getText(file),
    "requireDrawingP3ProductionCredentials",
  );
});

test("Playwright base config never bypasses runner-owned disposable authority", () => {
  const run = (flag) =>
    spawnSync(
      path.join("node_modules", ".bin", "playwright"),
      [
        "test",
        "--list",
        "e2e/drawing-workspace-p3.spec.ts",
        "--config=playwright.config.ts",
      ],
      {
        cwd: root,
        encoding: "utf8",
        env: {
          ...process.env,
          ...disposableEnvironment,
          M1_E2E_P3_DISPOSABLE: flag,
        },
      },
    );
  const rejected = run("true");
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stdout}\n${rejected.stderr}`, /UNEXECUTED/);
  const accepted = run("1");
  assert.notEqual(accepted.status, 0);
  assert.match(
    `${accepted.stdout}\n${accepted.stderr}`,
    /playwright\.m1\.config\.ts|runner-owned/i,
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
      /generatedOutboxIds/,
      /committedOfflineIds/,
      /toEqual\(generatedOutboxIds\)/,
      /expectedOfflineGeometry/,
      /page\.close/,
      /setOffline\(false\)/,
    ],
    "P3 Gate 05": [
      /fixture\.viewer/,
      /fixture\.reviewer/,
      /fixture\.approver/,
      /fixture\.nonMember/,
      /deniedProvider/,
      /readOnlyWebSocketRoles/,
      /deniedConnection/,
      /deniedWsObjectId/,
      /deniedWsOperationId/,
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
      /data-drag-active/,
      /data-drag-preview/,
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
      /quantityWorkflow/,
      /setInputFiles/,
      /verifyConcreteTakeoffBundle/,
      /lukas_qto_takeoff_inputs/,
      /drawing-room|도면 작업실/i,
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
  assert.doesNotMatch(source, /coldSamples:\s*5/);
  assert.match(source, /coldSamples:\s*0/);
  assert.match(source, /coldMeasurement:\s*"UNEXECUTED"/);
  assert.doesNotMatch(
    source,
    /from\("lukas_qto_takeoff_artifacts"\)\s*\.insert/,
  );
  const finalSourceRead = source.lastIndexOf("readSourceEvidence(fixture)");
  assert.ok(finalSourceRead > source.lastIndexOf("unzipSync("));
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
    "playwright test e2e/drawing-workspace-p3.spec.ts --project=chromium",
  );
  assert.match(config, /P3_E2E_RUN_ID/);
  assert.match(config, /remote.*webServer/s);
  assert.doesNotMatch(config, /P3_E2E_DATABASE_ADMIN_URL[^\n]*console/i);
});

test("P3 crash repair keeps all four deterministic local boundaries executable", async () => {
  const [collaboration, outbox] = await Promise.all([
    read("tests/drawing-workspace-collaboration.test.mjs"),
    read("tests/drawing-workspace-outbox.test.mjs"),
  ]);
  assert.match(
    collaboration,
    /boot repair pairs outbox-only and Yjs-only operations without duplicates/,
  );
  assert.match(
    outbox,
    /online reload resends an uncertain acknowledgement before recovery/,
  );
  assert.match(
    collaboration,
    /authoritative outcomes repair committed-unshared operations and clear the outbox/,
  );
  assert.match(
    collaboration,
    /accepted RPC with a lost receipt remains retryable under the same operation ID/,
  );
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
