import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { buildNativeDrawingDwgImportPlan } from "../app/lukas/lib/drawing-native-dwg-import-plan.server.ts";
import {
  allFiveEntityFixture,
  fixture,
  uuid,
} from "./fixtures/drawing-native-dwg-resave-source.mjs";

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
const unavailable = (error) =>
  error.code === "NATIVE_DWG_RESAVE_SOURCE_UNAVAILABLE";

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
  const f = allFiveEntityFixture();
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
