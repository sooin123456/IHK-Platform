import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

import { buildDrawingDxfImportPlan } from "../app/lukas/lib/drawing-dxf-import-plan.server.ts";
import { attestPreparedDrawingDxfImport } from "../app/lukas/lib/drawing-dxf-source.server.ts";

const screenPath = new URL(
  "../app/lukas/screens/drawing-workspace.tsx",
  import.meta.url,
);
const componentPath = new URL(
  "../app/lukas/components/drawing-workspace.tsx",
  import.meta.url,
);

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const workspaceRoute = await vite.ssrLoadModule(
  "/app/lukas/screens/drawing-workspace.tsx",
);
test.after(() => vite.close());

const ids = {
  actor: "43000000-0000-4000-8000-000000000005",
  project: "43000000-0000-4000-8000-000000000001",
  revision: "43000000-0000-4000-8000-000000000002",
  canvas: "43000000-0000-4000-8000-000000000003",
  file: "43000000-0000-4000-8000-000000000004",
};

function dxf() {
  return new TextEncoder().encode(
    [
      "0",
      "SECTION",
      "2",
      "HEADER",
      "9",
      "$INSUNITS",
      "70",
      "4",
      "0",
      "ENDSEC",
      "0",
      "SECTION",
      "2",
      "ENTITIES",
      "0",
      "LINE",
      "5",
      "1a2b",
      "8",
      "A-WALL",
      "10",
      "0",
      "20",
      "0",
      "11",
      "2",
      "21",
      "0",
      "0",
      "ENDSEC",
      "0",
      "EOF",
      "",
    ].join("\n"),
  );
}

async function plan() {
  return buildDrawingDxfImportPlan({
    bytes: dxf(),
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    createdAt: "2026-09-02T03:00:00.000Z",
  });
}

function actionInput() {
  return {
    actorId: ids.actor,
    projectId: ids.project,
    revisionId: ids.revision,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
  };
}

function exactReceipt(prepared, alreadyAppliedCount = 0) {
  return {
    planId: prepared.requestId,
    planCount: prepared.operations.length,
    alreadyAppliedCount,
  };
}

test("workspace action authorizes the exact DXF target before source download and parse", async () => {
  const source = await readFile(screenPath, "utf8");
  assert.match(source, /intent === "prepare_dxf_import"/);
  assert.match(
    source,
    /assertDrawingDxfImportScope\([\s\S]*parseDrawingDxfImportForm\(form\)[\s\S]*prepareDrawingDxfProjectImport\(/,
  );
  assert.match(source, /kind: "dxf_import_prepared"/);
});

test("DXF action waits for attestation and returns the existing browser plan unchanged", async () => {
  const prepared = await plan();
  const wait = Promise.withResolvers();
  let adminLoads = 0;
  let settled = false;
  const completion = attestPreparedDrawingDxfImport(
    prepared,
    actionInput(),
    async () => {
      adminLoads += 1;
      return {
        default: {
          rpc: async () => wait.promise,
        },
      };
    },
  );
  completion.then(() => {
    settled = true;
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(adminLoads, 1);
  wait.resolve({ data: exactReceipt(prepared), error: null });
  assert.equal(await completion, prepared);
  assert.deepEqual(await completion, prepared);
  assert.equal("attestation" in prepared, false);
});

test("DXF action does not load admin for blocked or empty plans", async () => {
  const prepared = await plan();
  let adminLoads = 0;
  const loadAdminClient = async () => {
    adminLoads += 1;
    throw new Error("must not load admin");
  };
  for (const result of [
    {
      ...prepared,
      report: { ...prepared.report, blocking: [{ code: "UNIT_REQUIRED" }] },
    },
    { ...prepared, requestId: null, operations: [] },
  ])
    assert.equal(
      await attestPreparedDrawingDxfImport(
        result,
        actionInput(),
        loadAdminClient,
      ),
      result,
    );
  assert.equal(adminLoads, 0);
});

test("DXF action bounds issuer and dynamic-admin failures as retryable source errors", async () => {
  const prepared = await plan();
  const errors = [
    () =>
      attestPreparedDrawingDxfImport(prepared, actionInput(), async () => ({
        default: {
          rpc: async () => ({ data: null, error: { message: "db detail" } }),
        },
      })),
    () =>
      attestPreparedDrawingDxfImport(prepared, actionInput(), async () => {
        throw new Error("admin module initialization detail");
      }),
  ];
  for (const attempt of errors)
    await assert.rejects(attempt(), (error) =>
      Boolean(
        error && error.status === 503 && !error.message.includes("detail"),
      ),
    );
});

test("DXF plan preparation skips loader revalidation and is exposed as an editor control", async () => {
  const [screen, component] = await Promise.all([
    readFile(screenPath, "utf8"),
    readFile(componentPath, "utf8"),
  ]);
  assert.match(
    screen,
    /shouldRevalidate[\s\S]*prepare_dxf_import[\s\S]*return false/,
  );
  assert.match(component, /DXF 도면 가져오기/);
  assert.match(component, /name="unit_code"/);
  assert.match(component, /dxfImportFetcher/);
  assert.match(component, /sourceBundle\?\.catalog[\s\S]*kind === "dxf"/);
});

test("all bounded native DWG intents preserve unsaved workspace state", () => {
  for (const intent of [
    "request_native_dwg_import",
    "native_dwg_import_status",
    "prepare_native_dwg_import",
  ]) {
    const formData = new FormData();
    formData.set("intent", intent);
    assert.equal(
      workspaceRoute.shouldRevalidate({
        actionStatus: 400,
        currentUrl: new URL("http://app.test/workspace"),
        defaultShouldRevalidate: true,
        formAction: "/workspace",
        formData,
        formEncType: "application/x-www-form-urlencoded",
        formMethod: "POST",
        nextUrl: new URL("http://app.test/workspace"),
      }),
      false,
      intent,
    );
  }
});

test("blank workspace DXF upload preserves its workspace and preselects only a catalog source", async () => {
  const component = await readFile(componentPath, "utf8");
  assert.match(
    component,
    /drawingWorkspaceDxfUploadPath\(\s*revision\.project_id,\s*workspace\.document\.id,?\s*\)/,
  );
  assert.match(
    component,
    /const requestedDxfSourceId = searchParams\.get\("dxfSourceFileId"\)/,
  );
  assert.match(
    component,
    /const uploadedDxfSourceId =[\s\S]*availableDxfSources\.find\([\s\S]*item\.id === requestedDxfSourceId[\s\S]*\?\.id/,
  );
  assert.match(
    component,
    /name="source_file_id"[\s\S]*defaultValue=\{uploadedDxfSourceId \?\? ""\}/,
  );
});
