import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

import ts from "typescript";

import * as fixtureHelpers from "../e2e/utils/drawing-collaboration-fixture.ts";
import {
  DRAWING_COLLABORATION_LIMITS,
  DrawingCollaborationOperationSchema,
} from "../app/lukas/lib/drawing-collaboration-protocol.ts";

const root = process.cwd();
const read = (file) => readFile(path.join(root, file), "utf8");

test("P2 workspace defers the export implementation until the user requests it", async () => {
  const [workspace, exportDialog] = await Promise.all([
    read("app/lukas/components/drawing-workspace.tsx"),
    read("app/lukas/components/drawing-export-dialog.tsx"),
  ]);

  assert.doesNotMatch(
    workspace,
    /import\s+\{\s*DrawingExportDialog\s*\}\s+from\s+["']\.\/drawing-export-dialog["']/,
  );
  assert.match(
    workspace,
    /lazy\(\(\)\s*=>\s*import\(["']\.\/drawing-export-dialog["']\)/,
  );
  assert.match(workspace, /DrawingExportLauncher/);
  assert.match(exportDialog, /open\?: boolean/);
  assert.match(exportDialog, /onOpenChange\?: \(open: boolean\) => void/);
  assert.match(exportDialog, /hideTrigger\?: boolean/);
});

function callName(node) {
  if (!ts.isCallExpression(node)) return null;
  const expression = node.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression)
  )
    return `${expression.expression.text}.${expression.name.text}`;
  if (
    ts.isPropertyAccessExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ts.isIdentifier(expression.expression.expression)
  )
    return `${expression.expression.expression.text}.${expression.expression.name.text}.${expression.name.text}`;
  return null;
}

function callsIn(node) {
  const calls = [];
  const visit = (child) => {
    const name = callName(child);
    if (name) calls.push({ name, node: child });
    ts.forEachChild(child, visit);
  };
  visit(node);
  return calls;
}

test("P2 production credentials fail closed without exposing values", () => {
  assert.equal(
    typeof fixtureHelpers.drawingP2ProductionCredentialStatus,
    "function",
  );
  assert.equal(
    typeof fixtureHelpers.requireDrawingP2ProductionCredentials,
    "function",
  );

  const complete = {
    E2E_BASE_URL: "https://preview.example.test",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_ANON_KEY: "anon-real-value",
    SUPABASE_SERVICE_ROLE_KEY: "service-real-value",
  };
  assert.deepEqual(
    fixtureHelpers.drawingP2ProductionCredentialStatus(complete),
    { status: "READY", missing: [] },
  );

  for (const [name, value] of [
    ["E2E_BASE_URL", ""],
    ["SUPABASE_URL", "[SENSITIVE]"],
    ["SUPABASE_ANON_KEY", "<masked>"],
    ["SUPABASE_SERVICE_ROLE_KEY", "***"],
  ]) {
    const environment = { ...complete, [name]: value };
    const status =
      fixtureHelpers.drawingP2ProductionCredentialStatus(environment);
    assert.deepEqual(status, { status: "UNEXECUTED", missing: [name] });
    assert.throws(
      () => fixtureHelpers.requireDrawingP2ProductionCredentials(environment),
      (error) =>
        error instanceof Error &&
        error.message.includes(name) &&
        !error.message.includes(value || "never-match-empty"),
    );
  }
});

test("P2 performance fixture has exact deterministic release composition", () => {
  assert.equal(
    typeof fixtureHelpers.buildDrawingP2PerformanceFixture,
    "function",
  );
  const input = {
    revisionId: "00000000-0000-4000-8000-000000000101",
    pageId: "00000000-0000-4000-8000-000000000102",
    canvasId: "00000000-0000-4000-8000-000000000103",
    layerId: "00000000-0000-4000-8000-000000000104",
  };
  const first = fixtureHelpers.buildDrawingP2PerformanceFixture(input);
  const second = fixtureHelpers.buildDrawingP2PerformanceFixture(input);
  assert.deepEqual(second, first);
  assert.deepEqual(first.counts, {
    pages: 3,
    canvases: 20,
    layers: 20,
    objects: 10_000,
    blocks: 20,
    blockInstances: 1_000,
    styles: 20,
    propertySchemas: 20,
    propertyValues: 20,
    tables: 5,
  });
  assert.equal(new Set(first.canvases.map(({ id }) => id)).size, 20);
  assert.equal(new Set(first.objects.map(({ id }) => id)).size, 10_000);
  assert.equal(new Set(first.blockInstances.map(({ id }) => id)).size, 1_000);
  assert.equal(first.canvases[0].id, input.canvasId);
  assert.equal(first.layers[0].id, input.layerId);
  assert.equal(first.activeCanvasId, input.canvasId);
  assert.equal(
    first.objects.filter(({ layerId }) => layerId === input.layerId).length,
    500,
  );
  assert.equal(
    first.blockInstances.filter(({ layerId }) => layerId === input.layerId)
      .length,
    50,
  );
  assert.deepEqual(
    first.propertySchemas.map(({ valueType }) => valueType).slice(0, 5),
    ["text", "number", "boolean", "date", "enum"],
  );
  assert.deepEqual(
    first.tables.map(({ rows }) => rows.length),
    [20, 20, 20, 20, 20],
  );
});

test("P2 performance fixture gives every page exactly one default paper canvas", () => {
  const fixture = fixtureHelpers.buildDrawingP2PerformanceFixture({
    revisionId: "00000000-0000-4000-8000-000000000201",
    pageId: "00000000-0000-4000-8000-000000000202",
    canvasId: "00000000-0000-4000-8000-000000000203",
    layerId: "00000000-0000-4000-8000-000000000204",
  });

  for (const page of fixture.pages) {
    const defaultPaperCanvases = fixture.canvases.filter(
      (canvas) =>
        canvas.pageId === page.id &&
        canvas.spaceKind === "paper" &&
        canvas.sortOrder === 0,
    );
    assert.equal(
      defaultPaperCanvases.length,
      1,
      `page ${page.sortOrder} default paper canvas count`,
    );
  }
});

test("P2 performance seed keeps every complete collaboration envelope within its byte limit", () => {
  const input = {
    revisionId: "00000000-0000-4000-8000-000000000301",
    pageId: "00000000-0000-4000-8000-000000000302",
    canvasId: "00000000-0000-4000-8000-000000000303",
    layerId: "00000000-0000-4000-8000-000000000304",
  };
  assert.equal(
    typeof fixtureHelpers.buildDrawingP2PerformanceSeedPlan,
    "function",
  );
  const plan = fixtureHelpers.buildDrawingP2PerformanceSeedPlan(input);
  assert.equal(
    typeof fixtureHelpers.buildDrawingPerformanceObjectSeedOperations,
    "function",
  );
  const legacyFixture = fixtureHelpers.buildDrawingPerformanceFixture(
    10_000,
    input.layerId,
    (index) => `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );
  const legacyOperations =
    fixtureHelpers.buildDrawingPerformanceObjectSeedOperations(
      legacyFixture.objects,
    );

  for (const [label, operations] of [
    ["P2", plan.operations],
    ["legacy", legacyOperations],
  ]) {
    let seededObjectCount = 0;
    for (const [index, operation] of operations.entries()) {
      if (operation.forward.type === "add_objects")
        seededObjectCount += operation.forward.objects.length;
      const envelope = {
        clientOperationId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        revisionId: input.revisionId,
        actorId: "00000000-0000-4000-8000-000000000305",
        schemaVersion: 1,
        type: operation.operationType,
        baseVersions: operation.baseVersions,
        forward: operation.forward,
        inverse: operation.inverse,
        createdAt: "1970-01-01T00:00:00.000Z",
      };
      const byteLength = new TextEncoder().encode(
        JSON.stringify(envelope),
      ).byteLength;
      assert.ok(
        byteLength <= DRAWING_COLLABORATION_LIMITS.maxOperationBytes,
        `${label} seed operation ${index} is ${byteLength} bytes`,
      );
      assert.equal(
        DrawingCollaborationOperationSchema.safeParse(envelope).success,
        true,
        `${label} seed operation ${index} satisfies the live collaboration contract`,
      );
    }
    assert.equal(seededObjectCount, 10_000);
  }
});

test("P2 production spec registers all twelve executable serial gates", async () => {
  const source = await read("e2e/drawing-workspace-p2.spec.ts");
  const file = ts.createSourceFile(
    "drawing-workspace-p2.spec.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  assert.equal(file.parseDiagnostics.length, 0);
  const calls = callsIn(file);
  assert.equal(
    calls.filter(({ name }) => name === "test.describe.serial").length,
    1,
  );
  assert.equal(
    calls.some(({ name }) => name === "test.skip"),
    false,
  );
  assert.equal(
    calls.some(({ name }) => name === "requireDrawingP2ProductionCredentials"),
    true,
  );

  const registered = calls
    .filter(
      ({ name, node }) =>
        name === "test" &&
        node.arguments.length >= 2 &&
        ts.isStringLiteral(node.arguments[0]) &&
        /^Gate \d{2}:/.test(node.arguments[0].text),
    )
    .map(({ node }) => ({
      name: node.arguments[0].text,
      body: node.arguments[1].getText(file),
    }));
  assert.deepEqual(
    registered.map(({ name }) => name.slice(0, 7)),
    Array.from(
      { length: 12 },
      (_, index) => `Gate ${String(index + 1).padStart(2, "0")}`,
    ),
  );
  for (const gate of registered) {
    assert.match(gate.body, /expect\s*\(/, gate.name);
    assert.doesNotMatch(gate.body, /test\.skip|TODO|placeholder/i, gate.name);
  }

  const gateBodies = Object.fromEntries(
    registered.map(({ name, body }) => [name.slice(0, 7), body]),
  );
  const gateContracts = {
    "Gate 01": [/lukas_drawing_canvases/, /retained.*toEqual/s],
    "Gate 02": [/10_000/, /data-active-canvas-id/],
    "Gate 03": [
      /data-rendered-object-count/,
      /data-rendered-instance-count/,
      /toBeLessThan/,
    ],
    "Gate 04": [/put_style/, /styleRead\.data.*toEqual/s, /styleId.*toBe/s],
    "Gate 05": [
      /put_block_instance/,
      /select\("origin,rotation,scale_x,scale_y,version"\)/,
      /transformedRead.*toEqual/s,
      /delete_block_instance/,
      /blocked\.error.*toBeTruthy/s,
    ],
    "Gate 06": [
      /lukas_drawing_request_review/,
      /lukas_drawing_record_revision_decision/,
      /lukas_drawing_create_from_template/,
      /sourceRevisionId.*toBe/s,
    ],
    "Gate 07": [
      /put_property_schema/,
      /rejected\.error.*toBeTruthy/s,
      /rejected\.error\?\.code.*toBe\("P1C01"\)/s,
      /put_property_value/,
    ],
    "Gate 08": [
      /getByRole\("table"/,
      /toHaveCount\(21\)/,
      /toHaveValue\(\s*"manual-0-0"/s,
      /page\.reload/,
      /toContainText/,
    ],
    "Gate 09": [
      /context\.setOffline\(true\)/,
      /오프라인/,
      /context\.setOffline\(false\)/,
      /page\.reload/,
      /toBeVisible/,
    ],
    "Gate 10": [
      /fixture\.editor/,
      /authenticateApiClient\(fixture, fixture\.editor\)/,
      /editorApproval\.error.*toBeTruthy/s,
      /update\.error.*update\.data/s,
      /deletion\.error.*deletion\.data/s,
      /after\.data.*toEqual\(before\.data\)/s,
      /rpcDenied\.error.*toBeTruthy/s,
    ],
    "Gate 11": [
      /runDownload\(page,\s*"SVG"\)/,
      /runDownload\(page,\s*"PNG"\)/,
      /runDownload\(page,\s*"PDF"\)/,
      /XMLParser/,
      /parsePng/,
      /PDFDocument\.load/,
      /getPageCount\(\).*toBe/s,
      /lukas_qto_export_events/,
      /artifact_sha256/,
      /artifact_byte_size/,
      /operation_checkpoint/,
      /checkpoint_sha256/,
    ],
    "Gate 12": [
      /readSourceEvidence/,
      /storageByteSha256.*metadataSha256/s,
      /response\?\.status\(\).*toBe\(200\)/s,
      /\/projects\/\$\{fixture\.projectId\}\/quantities/,
      /현장 검증 ZIP 다운로드/,
      /maxRedirects:\s*0/,
      /releaseDownload\.ok\(\).*toBe\(true\)/s,
    ],
  };
  for (const [gate, patterns] of Object.entries(gateContracts))
    for (const pattern of patterns)
      assert.match(gateBodies[gate], pattern, `${gate}: ${pattern}`);

  const performanceTest = calls.find(
    ({ name, node }) =>
      name === "test" &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text.includes("performance fixture records"),
  );
  assert.ok(performanceTest);
  const performanceBody = performanceTest.node.arguments[1].getText(file);
  assert.match(performanceBody, /selectionTargets/);
  assert.match(
    performanceBody,
    /selectionTargets\[selection\s*%\s*selectionTargets\.length\]/,
  );
  assert.match(performanceBody, /lastSelectedName/);
  assert.match(performanceBody, /not\.toBe\(lastSelectedName\)/);

  for (const requiredCall of [
    "authenticateContext",
    "authenticateApiClient",
    "readSourceEvidence",
    "seedDrawingP2PerformanceFixture",
    "download.createReadStream",
    "PDFDocument.load",
  ])
    assert.equal(
      calls.some(({ name }) => name === requiredCall),
      true,
      requiredCall,
    );
  for (const evidence of [
    "data-active-canvas-id",
    "data-rendered-object-count",
    "data-rendered-instance-count",
    "context.setOffline",
    "lukas_drawing_request_review",
    "lukas_drawing_record_revision_decision",
    "lukas_drawing_create_from_template",
    "lukas_drawing_apply_operation",
    "performance.now",
  ])
    assert.match(source, new RegExp(evidence.replace(".", "\\.")), evidence);
  assert.doesNotMatch(source, /Yjs|Hocuspocus|live cursor/i);
});

test("P2 fixture provisions an independent estimator-backed editor", async () => {
  const source = await read("e2e/utils/drawing-collaboration-fixture.ts");
  assert.match(source, /editor:\s*TestUser/);
  assert.match(source, /const editor = await addUser\("editor"\)/);
  assert.match(source, /\{ user: editor, role: "estimator" \}/);
  assert.match(
    source,
    /for \(const \{ user, role \} of projectMembers\)[\s\S]*p_email:\s*user\.email,[\s\S]*p_role:\s*role/,
  );
  assert.match(
    source,
    /fixture\.owner,\s*fixture\.editor,\s*fixture\.reviewer/s,
  );
});

test("canvas exposes active-slice mount evidence to the browser gate", async () => {
  const source = await read("app/lukas/components/drawing-canvas.client.tsx");
  const file = ts.createSourceFile(
    "drawing-canvas.client.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const hosts = [];
  const visit = (node) => {
    if (
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(file) === "div" &&
      node.attributes.properties.some(
        (attribute) =>
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(file) === "aria-label" &&
          attribute.initializer?.getText(file).includes("도면 화면"),
      )
    )
      hosts.push(
        new Set(
          node.attributes.properties.flatMap((attribute) =>
            ts.isJsxAttribute(attribute) ? [attribute.name.getText(file)] : [],
          ),
        ),
      );
    ts.forEachChild(node, visit);
  };
  visit(file);
  assert.equal(hosts.length, 1);
  for (const attribute of [
    "data-active-canvas-id",
    "data-rendered-layer-count",
    "data-rendered-object-count",
    "data-rendered-instance-count",
  ])
    assert.equal(hosts[0].has(attribute), true, attribute);
});

test("Task 11 runs actual local PGlite upgrade and security evidence", () => {
  const pattern = [
    "release migration duplicate preflight",
    "P2 review writes a deterministic complete v2 snapshot",
    "P2 approved template clone generates fresh identities",
    "P2 tables deny authenticated direct DML",
    "P2 upgrade leaves an approved v1 snapshot byte-stable",
    "P2 upgrade deterministically repairs legacy canvases",
  ].join("|");
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-name-pattern",
      pattern,
      "tests/drawing-workspace-database-runtime.test.mjs",
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([name]) => name !== "NODE_TEST_CONTEXT",
        ),
      ),
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join("\n"),
  );
  assert.match(result.stdout, /pass 6/);
  assert.match(result.stdout, /fail 0/);
  assert.doesNotMatch(result.stdout, /cancelled [1-9]|todo [1-9]/);
});

test("Task 11 scripts and release records separate local and production evidence", async () => {
  const packageJson = JSON.parse(await read("package.json"));
  const deployment = await read("DEPLOYMENT.md");
  const matrix = await read("../docs/P0_P5_IMPLEMENTATION_MATRIX.md");

  assert.equal(
    packageJson.scripts["test:e2e:drawing-workspace-p2:production"],
    "playwright test e2e/drawing-workspace-p2.spec.ts --project=chromium",
  );
  for (const evidence of [
    "duplicate/invariant preflight",
    "backup identifier",
    "schema snapshot identifier",
    "representative PDF SHA-256",
    "representative IFC SHA-256",
    "db:typegen",
    "test:e2e:drawing-workspace-p2:production",
    "collaboration room",
    "forward-fix",
    "incident-only",
  ])
    assert.match(deployment, new RegExp(evidence, "i"), evidence);
  for (const status of [
    "implemented",
    "locally executed",
    "production unexecuted",
    "measured target",
  ])
    assert.match(matrix, new RegExp(status, "i"), status);
  assert.match(matrix, /first usable.*2\.5s/is);
  assert.match(matrix, /switch p95.*250ms/is);
  assert.match(matrix, /export.*30s/is);
  assert.doesNotMatch(matrix, /P3[^\n]*(implemented|완료)/i);
});
