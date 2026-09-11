import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { buildNativeDrawingDwgImportPlan } from "../app/lukas/lib/drawing-native-dwg-import-plan.server.ts";

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
const adapter = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-source.server.ts")
  .catch(() => ({}));
const uuid = (n) => `93000000-0000-4000-8900-${String(n).padStart(12, "0")}`;
const hash = (s) => createHash("sha256").update(s).digest("hex");
const unavailable = (error) =>
  error.code === "NATIVE_DWG_RESAVE_SOURCE_UNAVAILABLE";

// Literal approved data: cm LINE (1,2) → (3,4) projects to mm (10,20) → (30,40).
// Independent current IDs represent a trusted clone; only source anchors bind it.
function fixture() {
  const report = {
    schemaVersion: "1hk-dwg-import/1",
    qualification: "experimental-unqualified",
    source: { sha256: "b".repeat(64), byteSize: 1234, headerVersion: "AC1024" },
    engine: { name: "ACadSharp", version: "3.7.1" },
    coordinateSystem: "WCS_NATIVE_UNITS",
    unitCode: 5,
    modelSpaceHandle: "1F",
    layers: [{ handle: "10", name: "0", visible: true, locked: false }],
    entities: [
      {
        handle: "2A",
        ownerHandle: "1F",
        layerHandle: "10",
        type: "LINE",
        geometry: { start: [1, 2, 0], end: [3, 4, 0] },
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
  const reportText = JSON.stringify(report),
    reportSha256 = hash(reportText);
  const canonical = {
    schemaVersion: 2,
    revision: {
      id: uuid(3),
      projectId: uuid(1),
      documentId: uuid(2),
      sequence: 2,
      version: 7,
    },
    operationSequence: 19,
    pages: [
      {
        id: uuid(4),
        revisionId: uuid(3),
        name: "Page",
        sortOrder: 0,
        version: 1,
      },
    ],
    canvases: [
      {
        id: uuid(5),
        pageId: uuid(4),
        name: "Canvas",
        spaceKind: "paper",
        widthMillimeters: 21000,
        heightMillimeters: 14850,
        background: null,
        outputProfile: {
          paper: "A3",
          orientation: "landscape",
          widthMillimeters: 420,
          heightMillimeters: 297,
          scaleDenominator: 50,
        },
        sortOrder: 0,
        version: 1,
      },
    ],
    layers: [
      {
        id: uuid(6),
        canvasId: uuid(5),
        pageId: uuid(4),
        name: "0",
        visible: true,
        locked: false,
        systemKind: "custom",
        sortOrder: 1,
        version: 2,
      },
      {
        id: uuid(16),
        canvasId: uuid(5),
        pageId: uuid(4),
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        sortOrder: 0,
        version: 1,
      },
    ],
    objects: [
      {
        id: uuid(7),
        lineageId: uuid(17),
        pageId: uuid(4),
        type: "line",
        name: "DWG LINE 2A",
        layerId: uuid(6),
        geometry: {
          type: "line",
          start: { x: 10, y: 20 },
          end: { x: 30, y: 40 },
        },
        styleId: null,
        style: { stroke: "#111827", strokeWidth: 1, fill: null },
        version: 3,
      },
    ],
    sources: [
      {
        id: uuid(8),
        objectId: uuid(7),
        revisionId: uuid(3),
        sourceFileId: uuid(9),
        sourceSha256: report.source.sha256,
        sourceKind: "dwg_entity",
        analysisJobId: uuid(10),
        reportSha256,
        handle: "2A",
        ownerHandle: "1F",
        layerHandle: "10",
        entityType: "LINE",
        sourceLayer: "0",
        unitCode: 5,
        unitSource: "declared",
        importerVersion: 1,
        version: 3,
      },
    ],
    styles: [],
    blocks: [],
    blockInstances: [],
    propertySchemas: [],
    propertyValues: [],
    tables: [],
    issues: [],
  };
  const payload = {
    approved: {
      projectId: uuid(1),
      documentId: uuid(2),
      canvasId: uuid(5),
      revision: { id: uuid(3), sequence: 2, version: 7, status: "approved" },
      snapshot: {
        sha256: "",
        schemaVersion: 2,
        operationSequence: 19,
        canonicalJsonText: "",
      },
      approvalDecision: "approved",
    },
    analysis: {
      scope: {
        projectId: uuid(1),
        documentId: uuid(12),
        revisionId: uuid(13),
        canvasId: uuid(15),
        sourceFileId: uuid(9),
        sourceSha256: report.source.sha256,
        unitOverride: null,
      },
      result: {
        receipt: {
          jobId: uuid(10),
          attemptNumber: 1,
          readerImageId: "sha256:" + "a".repeat(64),
          reportSha256,
          reportByteSize: Buffer.byteLength(reportText),
          source: {
            verificationId: uuid(11),
            fileId: uuid(9),
            ...report.source,
          },
          qualification: "experimental-unqualified",
          persistenceAuthority: "not-issued",
        },
        reportText,
      },
    },
  };
  const scope = {
    projectId: uuid(1),
    documentId: uuid(2),
    revisionId: uuid(3),
    revisionVersion: 7,
    canvasId: uuid(5),
    snapshotSha256: "",
  };
  const rehash = () => {
    payload.approved.snapshot.canonicalJsonText = JSON.stringify(canonical);
    scope.snapshotSha256 = payload.approved.snapshot.sha256 = hash(
      payload.approved.snapshot.canonicalJsonText,
    );
  };
  rehash();
  return { scope, payload, canonical, report, rehash };
}

test("approved cloned LINE uses source handle and frozen centimeters; empty default layer and no-op survive", async () => {
  assert.equal(
    typeof adapter.projectApprovedNativeDrawingDwgResaveSource,
    "function",
    "approved resave projector must exist",
  );
  const f = fixture();
  const noop = await adapter.projectApprovedNativeDrawingDwgResaveSource(
    f.scope,
    f.payload,
  );
  assert.equal(noop.selectedEdits.request, null);
  f.canonical.objects[0].geometry.end = { x: 55, y: -65 };
  f.rehash();
  const result = await adapter.projectApprovedNativeDrawingDwgResaveSource(
    f.scope,
    f.payload,
  );
  assert.deepEqual(result.selectedEdits.request, {
    schemaVersion: "1hk-dwg-edits/2",
    sourceSha256: "b".repeat(64),
    coordinateSystem: "WCS_NATIVE_UNITS",
    edits: [
      { handle: "2A", type: "LINE", start: [1, 2, 0], end: [5.5, -6.5, 0] },
    ],
  });
  assert.deepEqual(result.bindings, [{ objectId: uuid(7), handle: "2A" }]);
  assert.deepEqual(result.approved, {
    revisionId: uuid(3),
    revisionVersion: 7,
    snapshotSha256: f.scope.snapshotSha256,
    operationSequence: 19,
  });
  assert.deepEqual(result.analysisReceipt, f.payload.analysis.result.receipt);
  assert.equal(result.selectedEdits.persistenceAuthority, "not-issued");
  assert.equal(result.selectedEdits.qualification, "experimental-unqualified");
});

test("rehashed malicious anchors and unsupported canonical edits fail instead of being normalized", async (t) => {
  assert.equal(
    typeof adapter.projectApprovedNativeDrawingDwgResaveSource,
    "function",
  );
  const cases = [
    ...Object.entries({
      handle: "2B",
      ownerHandle: "FF",
      layerHandle: "11",
      entityType: "TEXT",
      sourceLayer: "fake",
      unitCode: 4,
      unitSource: "user_selected",
      analysisJobId: uuid(88),
      reportSha256: "c".repeat(64),
      sourceFileId: uuid(88),
      sourceSha256: "c".repeat(64),
      revisionId: uuid(88),
      importerVersion: 2,
    }).map(([key, value]) => [
      key,
      (f) => {
        f.canonical.sources[0][key] = value;
      },
    ]),
    ["missing source", (f) => f.canonical.sources.pop()],
    [
      "duplicate source",
      (f) =>
        f.canonical.sources.push({ ...f.canonical.sources[0], id: uuid(80) }),
    ],
    ["missing object", (f) => f.canonical.objects.pop()],
    [
      "added object",
      (f) =>
        f.canonical.objects.push({ ...f.canonical.objects[0], id: uuid(80) }),
    ],
    [
      "wrong object anchor",
      (f) => {
        f.canonical.sources[0].objectId = uuid(80);
      },
    ],
    [
      "renamed layer",
      (f) => {
        f.canonical.layers[0].name = "fake";
      },
    ],
    [
      "layer visibility",
      (f) => {
        f.canonical.layers[0].visible = false;
      },
    ],
    [
      "layer lock",
      (f) => {
        f.canonical.layers[0].locked = true;
      },
    ],
    [
      "layer kind",
      (f) => {
        f.canonical.layers[0].systemKind = "work";
      },
    ],
    [
      "layer order",
      (f) => {
        f.canonical.layers[0].sortOrder = 9;
      },
    ],
    [
      "object relayer",
      (f) => {
        f.canonical.objects[0].layerId = uuid(16);
      },
    ],
    [
      "renamed object",
      (f) => {
        f.canonical.objects[0].name = "fake";
      },
    ],
    [
      "object style",
      (f) => {
        f.canonical.objects[0].style.stroke = "#ff0000";
      },
    ],
    [
      "background",
      (f) => {
        f.canonical.canvases[0].background = { kind: "pdf" };
      },
    ],
    [
      "extra page",
      (f) => f.canonical.pages.push({ ...f.canonical.pages[0], id: uuid(80) }),
    ],
  ];
  for (const [label, mutate] of cases)
    await t.test(label, async () => {
      const f = fixture();
      mutate(f);
      f.rehash();
      await assert.rejects(
        adapter.projectApprovedNativeDrawingDwgResaveSource(f.scope, f.payload),
        unavailable,
      );
    });
});

test("strict envelopes, snapshot/report hashes, approval and source scope are required", async (t) => {
  assert.equal(
    typeof adapter.projectApprovedNativeDrawingDwgResaveSource,
    "function",
  );
  for (const [label, mutate] of [
    [
      "snapshot bytes",
      (f) => {
        f.payload.approved.snapshot.canonicalJsonText += " ";
      },
    ],
    [
      "report bytes",
      (f) => {
        f.payload.analysis.result.reportText += " ";
      },
    ],
    [
      "report size",
      (f) => {
        f.payload.analysis.result.receipt.reportByteSize++;
      },
    ],
    [
      "draft",
      (f) => {
        f.payload.approved.revision.status = "draft";
      },
    ],
    [
      "unapproved",
      (f) => {
        f.payload.approved.approvalDecision = "reviewed";
      },
    ],
    [
      "foreign project",
      (f) => {
        f.payload.analysis.scope.projectId = uuid(99);
      },
    ],
    [
      "wrong requested canvas",
      (f) => {
        f.scope.canvasId = uuid(99);
      },
    ],
    [
      "wrong requested version",
      (f) => {
        f.scope.revisionVersion++;
      },
    ],
    [
      "unit override",
      (f) => {
        f.payload.analysis.scope.unitOverride = 4;
      },
    ],
    [
      "private source descriptor",
      (f) => {
        f.payload.analysis.result.receipt.source.path = "secret";
      },
    ],
    [
      "caller edits",
      (f) => {
        f.scope.objects = [];
      },
    ],
  ])
    await t.test(label, async () => {
      const f = fixture();
      mutate(f);
      await assert.rejects(
        adapter.projectApprovedNativeDrawingDwgResaveSource(f.scope, f.payload),
        unavailable,
      );
    });
});

test("RPC loader forwards only validated scope and returns compiled results or a bounded error", async () => {
  assert.equal(
    typeof adapter.loadApprovedNativeDrawingDwgResaveSource,
    "function",
  );
  const f = fixture();
  const client = {
    async rpc(name, args) {
      assert.equal(this, client);
      assert.equal(name, "lukas_qto_drawing_native_dwg_resave_source");
      assert.deepEqual(args, { p_scope: f.scope });
      return { data: f.payload, error: null };
    },
  };
  assert.equal(
    (await adapter.loadApprovedNativeDrawingDwgResaveSource(client, f.scope))
      .selectedEdits.request,
    null,
  );
  for (const rpc of [
    null,
    async () => {
      throw Error("private path");
    },
    async () => ({ data: f.payload, error: { message: "private SQL" } }),
    async () => null,
  ])
    await assert.rejects(
      adapter.loadApprovedNativeDrawingDwgResaveSource({ rpc }, f.scope),
      (e) => unavailable(e) && !/private/.test(e.message),
    );
});

test("same analysis revision requires exact native layer, object and source identities after rehashing", async (t) => {
  for (const mutation of [
    "layer",
    "object",
    "source",
    "all",
    "document",
    "canvas",
  ]) {
    await t.test(mutation, async () => {
      const f = fixture();
      const plan = buildNativeDrawingDwgImportPlan({
        report: f.report,
        expectedSource: f.report.source,
        revisionId: f.scope.revisionId,
        canvasId: f.scope.canvasId,
        sourceFileId: uuid(9),
        analysisJobId: uuid(10),
        reportSha256: f.payload.analysis.result.receipt.reportSha256,
      });
      Object.assign(f.payload.analysis.scope, {
        documentId: f.scope.documentId,
        revisionId: f.scope.revisionId,
        canvasId: f.scope.canvasId,
      });
      f.canonical.layers = plan.layers.map((layer) => ({
        ...layer,
        pageId: uuid(4),
      }));
      f.canonical.objects = plan.objects.map((object) => ({
        ...object,
        lineageId: uuid(17),
        pageId: uuid(4),
        type: object.geometry.type,
      }));
      f.canonical.sources = structuredClone(plan.sources);
      f.rehash();
      assert.equal(
        (
          await adapter.projectApprovedNativeDrawingDwgResaveSource(
            f.scope,
            f.payload,
          )
        ).selectedEdits.request,
        null,
      );
      if (mutation === "layer" || mutation === "all") {
        f.canonical.layers[0].id = uuid(60);
        f.canonical.objects[0].layerId = uuid(60);
      }
      if (mutation === "object" || mutation === "all") {
        f.canonical.objects[0].id = uuid(61);
        f.canonical.sources[0].objectId = uuid(61);
      }
      if (mutation === "source" || mutation === "all")
        f.canonical.sources[0].id = uuid(71);
      if (mutation === "document")
        f.payload.analysis.scope.documentId = uuid(82);
      if (mutation === "canvas") f.payload.analysis.scope.canvasId = uuid(85);
      f.rehash();
      await assert.rejects(
        adapter.projectApprovedNativeDrawingDwgResaveSource(f.scope, f.payload),
        unavailable,
      );
    });
  }
});

test("approved original and clone compile all five geometry types with native handle ordering", async () => {
  const f = fixture();
  f.report.entities.push(
    {
      handle: "3",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "TEXT",
      geometry: { insert: [1, 2, 0], height: 2, text: "Base" },
    },
    {
      handle: "4",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "LWPOLYLINE",
      geometry: {
        points: [
          [0, 0, 0],
          [2, 3, 0],
        ],
        closed: false,
      },
    },
    {
      handle: "5",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "CIRCLE",
      geometry: { center: [4, 5, 0], radius: 2 },
    },
    {
      handle: "6",
      ownerHandle: "1F",
      layerHandle: "10",
      type: "ARC",
      geometry: {
        center: [7, 8, 0],
        radius: 3,
        startAngleRadians: 0.25,
        endAngleRadians: 2.5,
      },
    },
  );
  f.report.coverage.modelSpaceEntities = f.report.coverage.importedEntities = 5;
  const result = f.payload.analysis.result;
  result.reportText = JSON.stringify(f.report);
  result.receipt.reportSha256 = hash(result.reportText);
  result.receipt.reportByteSize = Buffer.byteLength(result.reportText);
  const plan = buildNativeDrawingDwgImportPlan({
    report: f.report,
    expectedSource: f.report.source,
    revisionId: uuid(3),
    canvasId: uuid(5),
    sourceFileId: uuid(9),
    analysisJobId: uuid(10),
    reportSha256: result.receipt.reportSha256,
  });
  f.payload.analysis.scope.documentId = uuid(2);
  f.payload.analysis.scope.revisionId = uuid(3);
  f.payload.analysis.scope.canvasId = uuid(5);
  f.canonical.layers = plan.layers.map((layer) => ({
    ...layer,
    pageId: uuid(4),
  }));
  f.canonical.objects = plan.objects.map((object, i) => ({
    ...object,
    lineageId: uuid(30 + i),
    pageId: uuid(4),
    type: object.geometry.type,
  }));
  f.canonical.sources = structuredClone(plan.sources);
  f.rehash();
  assert.equal(
    (
      await adapter.projectApprovedNativeDrawingDwgResaveSource(
        f.scope,
        f.payload,
      )
    ).selectedEdits.request,
    null,
  );
  const [line, text, polyline, circle, arc] = f.canonical.objects;
  line.geometry.end = { x: 55, y: -65 };
  text.geometry.origin = { x: 15, y: 25 };
  text.geometry.text = "Edited";
  text.style.fontSize = 30;
  polyline.geometry.points[1] = { x: 25, y: 35 };
  polyline.geometry.closed = true;
  circle.geometry.radius = 25;
  arc.geometry.center = { x: 75, y: 85 };
  const expected = [
    {
      handle: "3",
      type: "TEXT",
      insert: [1.5, 2.5, 0],
      height: 3,
      text: "Edited",
    },
    {
      handle: "4",
      type: "LWPOLYLINE",
      points: [
        [0, 0, 0],
        [2.5, 3.5, 0],
      ],
      closed: true,
    },
    { handle: "5", type: "CIRCLE", center: [4, 5, 0], radius: 2.5 },
    {
      handle: "6",
      type: "ARC",
      center: [7.5, 8.5, 0],
      radius: 3,
      startAngleRadians: 0.25,
      endAngleRadians: 2.5,
    },
    { handle: "2A", type: "LINE", start: [1, 2, 0], end: [5.5, -6.5, 0] },
  ];
  f.rehash();
  assert.deepEqual(
    (
      await adapter.projectApprovedNativeDrawingDwgResaveSource(
        f.scope,
        f.payload,
      )
    ).selectedEdits.request.edits,
    expected,
  );
  // The clone has its own approved revision/document/canvas and retains the
  // historical analysis scope; changing IDs within the original is not a clone.
  Object.assign(f.scope, {
    documentId: uuid(82),
    revisionId: uuid(83),
    canvasId: uuid(85),
  });
  Object.assign(f.payload.approved, {
    documentId: uuid(82),
    canvasId: uuid(85),
  });
  f.payload.approved.revision.id = uuid(83);
  Object.assign(f.canonical.revision, { id: uuid(83), documentId: uuid(82) });
  f.canonical.pages[0].revisionId = uuid(83);
  f.canonical.canvases[0].id = uuid(85);
  f.canonical.layers[0].canvasId = uuid(85);
  f.canonical.layers[0].id = uuid(60);
  f.canonical.objects.forEach((object, i) => {
    object.id = uuid(61 + i);
    object.layerId = uuid(60);
    f.canonical.sources[i].objectId = object.id;
    f.canonical.sources[i].id = uuid(71 + i);
    f.canonical.sources[i].revisionId = uuid(83);
  });
  f.rehash();
  const cloned = await adapter.projectApprovedNativeDrawingDwgResaveSource(
    f.scope,
    f.payload,
  );
  assert.deepEqual(cloned.selectedEdits.request.edits, expected);
  assert.deepEqual(
    cloned.bindings.map((b) => b.handle),
    ["3", "4", "5", "6", "2A"],
  );
});
