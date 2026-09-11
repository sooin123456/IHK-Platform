import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { data } from "react-router";
import ts from "typescript";
import { createServer } from "vite";
import { drawingWorkspaceOperationLocation } from "../app/lukas/lib/drawing-workspace-paths.ts";
import { buildNativeDrawingDwgImportPlan } from "../app/lukas/lib/drawing-native-dwg-import-plan.server.ts";

// Execute the real producer expression and real screen action, without loading
// the entire editor or replacing its scope checks. Only Auth/DB/worker edges
// are controlled here; this is not live Auth/Storage evidence.
const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
test.after(() => vite.close());
const native = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-native-dwg-import-action.server.ts",
);
const route = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace-route.server.ts",
);
const workspaceServer = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace.server.ts",
);

async function sourceFile(path) {
  return ts.createSourceFile(
    path,
    await readFile(new URL(path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}
function descendants(file, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
function evaluate(expression, dependencies) {
  const compiled = ts.transpileModule(`(${expression})`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  return new Function(...Object.keys(dependencies), `return ${compiled}`)(
    ...Object.values(dependencies),
  );
}
const component = await sourceFile(
  "../app/lukas/components/drawing-workspace.tsx",
);
const controls = descendants(
  component,
  (node) =>
    ts.isJsxSelfClosingElement(node) &&
    node.tagName.getText(component) === "DrawingNativeDwgImport",
);
assert.equal(controls.length, 1);
const actionAttribute = controls[0].attributes.properties.find(
  (attribute) =>
    ts.isJsxAttribute(attribute) &&
    attribute.name.getText(component) === "action",
);
assert.ok(
  actionAttribute?.initializer &&
    ts.isJsxExpression(actionAttribute.initializer),
);
const producer = actionAttribute.initializer.expression.getText(component);
const screen = await sourceFile("../app/lukas/screens/drawing-workspace.tsx");
const actionDeclarations = descendants(
  screen,
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === "action",
);
assert.equal(actionDeclarations.length, 1);
const actionCode = actionDeclarations[0]
  .getText(screen)
  .replace(/^export\s+/, "");

const id = (n) => `92000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ids = {
  actor: id(1),
  project: id(2),
  document: id(3),
  selected: id(4),
  latest: id(5),
  canvas: id(6),
  file: id(7),
  request: id(8),
  job: id(9),
};
const sha256 = "a".repeat(64);
const drafts = [
  {
    id: ids.selected,
    sequence: 1,
    project_id: ids.project,
    document_id: ids.document,
    status: "draft",
    pages: [],
    canvases: [{ id: ids.canvas }],
  },
  {
    id: ids.latest,
    sequence: 2,
    project_id: ids.project,
    document_id: ids.document,
    status: "draft",
    pages: [],
    canvases: [{ id: id(10) }],
  },
];
const document = {
  id: ids.document,
  project_id: ids.project,
  source_file_id: null,
};
const scope = {
  projectId: ids.project,
  documentId: ids.document,
  revisionId: ids.selected,
  canvasId: ids.canvas,
  sourceFileId: ids.file,
  sourceSha256: sha256,
  unitOverride: 4,
};
const report = {
  schemaVersion: "1hk-dwg-import/1",
  qualification: "experimental-unqualified",
  source: { sha256, byteSize: 1024, headerVersion: "AC1024" },
  engine: { name: "ACadSharp", version: "3.7.1" },
  coordinateSystem: "WCS_NATIVE_UNITS",
  unitCode: 4,
  modelSpaceHandle: "10",
  layers: [{ handle: "20", name: "WALL", visible: true, locked: false }],
  entities: [
    {
      handle: "30",
      ownerHandle: "10",
      layerHandle: "20",
      type: "LINE",
      geometry: { start: [0, 0, 0], end: [1000, 0, 0] },
    },
  ],
  coverage: {
    modelSpaceEntities: 1,
    importedEntities: 1,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  },
  unsupported: [],
  readerNotificationCount: 0,
};
const prepared = {
  ...buildNativeDrawingDwgImportPlan({
    report,
    expectedSource: report.source,
    revisionId: ids.selected,
    canvasId: ids.canvas,
    sourceFileId: ids.file,
    analysisJobId: ids.job,
    reportSha256: "b".repeat(64),
  }),
  canonicalReceipts: [],
  persistenceAuthority: "operation-attested",
};

for (const [intent, expectedKind] of [
  ["request_native_dwg_import", "native_dwg_import_requested"],
  ["native_dwg_import_status", "native_dwg_import_status"],
  ["prepare_native_dwg_import", "native_dwg_import_prepared"],
]) {
  test(`${intent} uses selected older draft through workspace producer and screen consumer`, async () => {
    const selectedByLoader = [];
    const client = {
      from(table) {
        assert.equal(table, "lukas_qto_files");
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return {
              data: {
                id: ids.file,
                project_id: ids.project,
                kind: "dwg",
                sha256,
                immutable: true,
              },
              error: null,
            };
          },
        };
      },
      async rpc(name) {
        assert.equal(name, "lukas_drawing_native_dwg_import_context");
        return {
          data: {
            scope,
            status: {
              jobId: ids.job,
              status: "queued",
              attemptCount: 0,
              failureCode: null,
              receipt: null,
            },
            result: null,
          },
          error: null,
        };
      },
    };
    const consume = evaluate(actionCode, {
      workspaceContext: async () => ({
        client,
        headers: new Headers(),
        project: { id: ids.project },
        capability: "editor",
        user: { id: ids.actor },
      }),
      actionRequestId: route.actionRequestId,
      loadDrawingWorkspaceActionScope: route.loadDrawingWorkspaceActionScope,
      loadDrawingWorkspace: async (_client, query) => {
        // Database boundary: absent selector returns the highest sequence, just
        // as the real workspace loader does. The real screen produces query.
        const revision = query.revisionId
          ? drafts.find((draft) => draft.id === query.revisionId)
          : [...drafts].sort((a, b) => b.sequence - a.sequence)[0];
        selectedByLoader.push(revision.id);
        return {
          primarySource: null,
          templateCandidates: [],
          document: { ...document, revision },
        };
      },
      nativeDwgImportIntents: new Set([
        "request_native_dwg_import",
        "native_dwg_import_status",
        "prepare_native_dwg_import",
      ]),
      handleDrawingNativeDwgImportAction: (input) =>
        native.handleDrawingNativeDwgImportAction(input, {
          async requestImport(_client, requestedScope) {
            assert.equal(requestedScope.revisionId, ids.selected);
            return { jobId: ids.job };
          },
          async prepareImport(_client, requestedScope) {
            assert.equal(requestedScope.revisionId, ids.selected);
            return prepared;
          },
        }),
      DrawingNativeDwgImportActionError:
        native.DrawingNativeDwgImportActionError,
      DrawingWorkspaceRetryableError:
        workspaceServer.DrawingWorkspaceRetryableError,
      drawingWorkspaceActionErrorResponse:
        route.drawingWorkspaceActionErrorResponse,
      data,
    });
    const actionUrl = evaluate(producer, {
      drawingWorkspaceOperationLocation,
      revision: drafts[0],
      workspace: { document },
    });
    const body = new FormData();
    body.set("intent", intent);
    body.set("revision_id", ids.selected);
    body.set("canvas_id", ids.canvas);
    if (intent === "request_native_dwg_import") {
      body.set("source_file_id", ids.file);
      body.set("request_id", ids.request);
      body.set("unit_code", "4");
    } else body.set("job_id", ids.job);
    const response = await consume({
      request: new Request(new URL(actionUrl, "https://fixture.invalid"), {
        method: "POST",
        body,
      }),
      params: { projectId: ids.project, workspaceId: ids.document },
    });
    assert.deepEqual(
      selectedByLoader,
      [ids.selected],
      "URL producer must retain the selected draft instead of loading the latest sequence",
    );
    assert.equal(response.data.ok, true);
    assert.equal(response.data.kind, expectedKind);
    assert.equal(response.init.status ?? 200, 200);
    // The fix must preserve, not bypass, server URL/form revision agreement.
    const wrongUrl = new URL(actionUrl, "https://fixture.invalid");
    wrongUrl.searchParams.set("revision", ids.latest);
    const wrong = await consume({
      request: new Request(wrongUrl, { method: "POST", body }),
      params: { projectId: ids.project, workspaceId: ids.document },
    });
    assert.equal(wrong.data.ok, false);
    assert.equal(wrong.init.status, 409);
  });
}
