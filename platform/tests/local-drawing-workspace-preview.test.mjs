import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { createServer } from "vite";
import * as Y from "yjs";

import routes from "../app/routes.ts";
import { resolveDrawingSemanticSchedule } from "../app/lukas/lib/drawing-semantic-schedules.ts";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  root: fileURLToPath(new URL("../", import.meta.url)),
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const preview = await vite.ssrLoadModule(
  "/app/lukas/screens/local-drawing-workspace-preview.tsx",
);
const pdfPreview = await vite.ssrLoadModule(
  "/app/lukas/screens/local-drawing-pdf-preview.ts",
);
const currentPdfPreview = await vite.ssrLoadModule(
  "/app/lukas/screens/local-drawing-pdf-current.ts",
);
const drawingCommands = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-commands.ts",
);
const drawingDocuments = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-document-store.ts",
);
const drawingDrafts = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-yjs-draft.ts",
);
const drawingCollaboration = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-collaboration-client.ts",
);
test.after(() => vite.close());
const testEnvironment = process.env.NODE_ENV;
process.env.NODE_ENV = "development";
test.after(() => {
  process.env.NODE_ENV = testEnvironment;
});

function request(url, init) {
  return new Request(url, init);
}

function unwrapRouteData(result) {
  return result?.type === "DataWithResponseInit" ? result.data : result;
}

test("P5 synthetic derivative descriptor is byte-exact to its public assets", async () => {
  const descriptor = preview.previewIfcDerivative(
    "00000000-0000-4000-8000-0000000000a1",
    "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d",
  );
  for (const asset of [
    {
      path: descriptor.manifestSignedUrl,
      byteSize: descriptor.manifestByteSize,
      sha256: descriptor.manifestSha256,
    },
    {
      path: descriptor.geometrySignedUrl,
      byteSize: descriptor.geometryByteSize,
      sha256: descriptor.geometrySha256,
    },
  ]) {
    const bytes = await readFile(
      new URL(`../public${asset.path}`, import.meta.url),
    );
    assert.equal(bytes.byteLength, asset.byteSize);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
    );
  }
});

function validOperation() {
  return {
    clientOperationId: "00000000-0000-4000-8000-000000000091",
    revisionId: "00000000-0000-4000-8000-000000000004",
    type: "update_layer",
    baseVersions: { "00000000-0000-4000-8000-000000000021": 1 },
    forward: {
      type: "update_layer",
      layerId: "00000000-0000-4000-8000-000000000021",
      patch: { visible: false },
    },
    inverse: {
      type: "update_layer",
      layerId: "00000000-0000-4000-8000-000000000021",
      patch: { visible: true },
    },
    createdAt: "2026-08-25T09:00:00.000Z",
  };
}

test("P2 local drawing preview is registered outside the authenticated workspace", () => {
  const paths = JSON.stringify(routes);
  assert.match(paths, /workspace-preview\/drawing-workspace/);
  assert.match(paths, /__p5-current\.pdf/);
  assert.match(paths, /__p5-previous\.pdf/);
});

test("P5 local PDF resources serve real no-store bytes only on development loopback", async () => {
  const response = await pdfPreview.loader({
    request: request("http://127.0.0.1:5173/__p5-previous.pdf"),
    params: {},
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    new TextDecoder().decode((await response.arrayBuffer()).slice(0, 4)),
    "%PDF",
  );

  process.env.NODE_ENV = "production";
  const denied = await pdfPreview.loader({
    request: request("http://127.0.0.1:5173/__p5-previous.pdf"),
    params: {},
  });
  assert.equal(denied.status, 404);
  process.env.NODE_ENV = "development";
});

test("current PDF resource matches its immutable preview descriptor and public fixture", async () => {
  const loaded = unwrapRouteData(
    await preview.loader({
      request: request(
        "http://127.0.0.1:5173/workspace-preview/drawing-workspace",
      ),
      params: {},
    }),
  );
  const descriptor = loaded.sourceBundle.pdf;
  const response = await currentPdfPreview.loader({
    request: request(`http://127.0.0.1:5173${descriptor.signedUrl}`),
    params: {},
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(response.headers.get("cache-control"), "no-store");
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 4).toString(), "%PDF");
  assert.equal(bytes.byteLength, descriptor.byteSize);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    descriptor.sha256,
  );
  assert.deepEqual(
    bytes,
    await readFile(
      new URL("./fixtures/p5-current-revision.pdf", import.meta.url),
    ),
  );
  const current = await PDFDocument.load(bytes);
  const previous = await PDFDocument.load(
    await readFile(
      new URL("./fixtures/p5-previous-revision.pdf", import.meta.url),
    ),
  );
  assert.equal(current.getPageCount(), 3);
  assert.deepEqual(
    current.getPages().map((page) => page.getSize()),
    previous.getPages().map((page) => page.getSize()),
  );
  assert.equal(
    current.getTitle(),
    "1HK synthetic current revision - NOT FOR CONSTRUCTION",
  );
  assert.notEqual(descriptor.sha256, loaded.sourceBundle.previousPdf.sha256);
  assert.equal(loaded.workspace.primarySource.sha256, descriptor.sha256);
  assert.equal(loaded.workspace.document.source_sha256, descriptor.sha256);
  assert.deepEqual(
    preview
      .localP5SourceManifest()
      .find((source) => source.kind === "pdf_current"),
    {
      kind: "pdf_current",
      id: descriptor.id,
      byteSize: descriptor.byteSize,
      sha256: descriptor.sha256,
      signedUrl: descriptor.signedUrl,
    },
  );
});

test("current PDF resource rejects non-loopback and production requests", async () => {
  const args = (url) => ({ request: request(url), params: {} });
  assert.equal(
    (
      await currentPdfPreview.loader(
        args("http://192.168.0.20/__p5-current.pdf"),
      )
    ).status,
    404,
  );
  process.env.NODE_ENV = "production";
  try {
    assert.equal(
      (
        await currentPdfPreview.loader(
          args("http://127.0.0.1:5173/__p5-current.pdf"),
        )
      ).status,
      404,
    );
  } finally {
    process.env.NODE_ENV = "development";
  }
});

test("P2 preview server module does not import browser-only state modules", async () => {
  const source = await readFile(
    new URL(
      "../app/lukas/screens/local-drawing-workspace-preview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(source, /drawing-document-store\.client/);
});

test("P2 local drawing preview loader allows only development loopback", async () => {
  const allowed = unwrapRouteData(
    await preview.loader({
      request: request(
        "http://127.0.0.1:5173/workspace-preview/drawing-workspace",
      ),
      params: {},
    }),
  );
  assert.equal(allowed.workspace.document.revision.status, "draft");
  assert.equal(allowed.capability, "editor");
  assert.throws(
    () =>
      preview.loader({
        request: request(
          "http://192.168.0.20/workspace-preview/drawing-workspace",
        ),
        params: {},
      }),
    (error) => error instanceof Response && error.status === 404,
  );
  process.env.NODE_ENV = "production";
  assert.throws(
    () =>
      preview.loader({
        request: request(
          "http://127.0.0.1/workspace-preview/drawing-workspace",
        ),
        params: {},
      }),
    (error) => error instanceof Response && error.status === 404,
  );
  process.env.NODE_ENV = "development";
});

test("current canonical preview opens the editable 2D canvas before loading IFC", async () => {
  const loaded = unwrapRouteData(
    await preview.loader({
      request: request(
        "http://127.0.0.1:5173/workspace-preview/drawing-workspace",
      ),
      params: {},
    }),
  );

  assert.equal(loaded.sourceBundle.pdf.signedUrl, "/__p5-current.pdf");
  assert.equal(loaded.sourceBundle.pdf.byteSize, 8_289);
  assert.equal(
    loaded.sourceBundle.pdf.sha256,
    "298cdc57f86b73f96ad6c743e20d9fb76e08d9f8dc7b827b6558ff068f95c8db",
  );
  assert.equal(loaded.workspace.primarySource.byte_size, 8_289);
  assert.equal(
    loaded.workspace.primarySource.sha256,
    loaded.sourceBundle.pdf.sha256,
  );
  assert.equal(loaded.sourceBundle.previousPdf.byteSize, 63_118);
  assert.equal(
    loaded.sourceBundle.previousPdf.sha256,
    "ea75a7e655dee16a460672131424f00112f70467e495f751d77de80e409fc9bc",
  );
  assert.notEqual(
    loaded.sourceBundle.previousPdf.sha256,
    loaded.sourceBundle.pdf.sha256,
  );
  assert.equal(
    loaded.selectedIfcFileId,
    "00000000-0000-4000-8000-0000000000a1",
  );
  assert.equal(loaded.viewMode, "2d");
  assert.equal(loaded.sourceBundle.ifc, null);
  assert.equal(
    loaded.sourceBundle.catalog.some(
      (source) =>
        source.kind === "ifc" &&
        source.id === "00000000-0000-4000-8000-0000000000a1",
    ),
    true,
  );
  assert.ok(
    loaded.sourceBundle.catalog.some(
      (item) =>
        item.id === "00000000-0000-4000-8000-0000000000a1" &&
        item.kind === "ifc",
    ),
  );
  assert.equal(loaded.workspace.document.revision.sources.length, 1);
  assert.equal(loaded.workspace.document.revision.status, "draft");
  assert.deepEqual(loaded.quantityLineage, { rows: [], nextCursor: null });
  assert.equal(
    loaded.workspace.document.revision.canvases.find(
      (canvas) =>
        canvas.id === loaded.workspace.document.revision.activeCanvasId,
    ).background.sourceFileId,
    loaded.workspace.primarySource.id,
  );
  assert.equal(loaded.canonicalP5, true);

  const compare = new FormData();
  compare.set("intent", "load_pdf_compare");
  compare.set("revision_edge_id", loaded.sourceBundle.revisionEdge.id);
  compare.set(
    "current_file_id",
    loaded.sourceBundle.revisionEdge.currentFileId,
  );
  compare.set("current_sha256", loaded.sourceBundle.revisionEdge.currentSha256);
  compare.set("previous_file_id", loaded.sourceBundle.previousPdf.id);
  compare.set("previous_sha256", loaded.sourceBundle.previousPdf.sha256);
  compare.set("page_number", "1");
  const compared = await preview.action({
    request: request(
      "http://127.0.0.1:5173/workspace-preview/drawing-workspace",
      { method: "POST", body: compare },
    ),
    params: {},
  });
  assert.equal(compared.data.ok, true);
  assert.equal(
    compared.data.previousPdf.sha256,
    loaded.sourceBundle.previousPdf.sha256,
  );

  const source = await readFile(
    new URL(
      "../app/lukas/screens/local-drawing-workspace-preview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /canonicalP5/);
  assert.doesNotMatch(source, /canonicalP5\s*\?\s*p5PreviewHarness/);
});

test("synthetic IFC preview is visibly labeled as a non-original mapping example", async () => {
  const source = await readFile(
    new URL(
      "../app/lukas/screens/local-drawing-workspace-preview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /합성 매핑 예제 · 원본 IFC 형상 아님/);
});

test("awareness harness uses its legacy fixture with explicit IFC opt-in", async () => {
  const loaded = unwrapRouteData(
    await preview.loader({
      request: request(
        "http://127.0.0.1:5173/workspace-preview/drawing-workspace?awarenessTest=1&view=split",
      ),
      params: {},
    }),
  );

  assert.equal(loaded.awarenessTest, true);
  assert.equal(loaded.canonicalP5, false);
  assert.equal(loaded.viewMode, "split");
  assert.equal(loaded.sourceBundle, undefined);
  const withIfc = unwrapRouteData(
    await preview.loader({
      request: request(
        "http://127.0.0.1:5173/workspace-preview/drawing-workspace?awarenessTest=1&p5IfcTest=1&view=split",
      ),
      params: {},
    }),
  );
  assert.equal(withIfc.awarenessTest, true);
  assert.equal(withIfc.p5IfcTest, true);
  assert.equal(withIfc.canonicalP5, false);
  assert.equal(withIfc.viewMode, "split");
  assert.equal(withIfc.sourceBundle.pdf, null);
  assert.equal(
    withIfc.sourceBundle.ifc.id,
    "00000000-0000-4000-8000-0000000000a1",
  );
  assert.equal(withIfc.selectedIfcFileId, withIfc.sourceBundle.ifc.id);
  assert.equal(withIfc.sourceBundle.ifc.derivative.status, "ready");
});

test("P5 local baseline contains exactly 10,000 objects and 2,000 immutable IFC links", async () => {
  const loaded = unwrapRouteData(
    await preview.loader({
      request: request(
        "http://127.0.0.1:5173/workspace-preview/drawing-workspace?p5BaselineTest=1",
      ),
      params: {},
    }),
  );
  const revision = loaded.workspace.document.revision;
  assert.equal(revision.objects.length, 10_000);
  assert.equal(revision.sources.length, 2_000);
  assert.equal(new Set(revision.sources.map(({ id }) => id)).size, 2_000);
  assert.equal(
    new Set(revision.sources.map(({ objectId }) => objectId)).size,
    2_000,
  );
  assert.ok(
    revision.sources.every(
      (source) =>
        source.sourceKind === "ifc_element" &&
        source.sourceFileId === loaded.selectedIfcFileId &&
        source.sourceSha256 ===
          loaded.sourceBundle.catalog.find(
            (item) => item.id === loaded.selectedIfcFileId,
          ).sha256,
    ),
  );
  assert.equal(loaded.p5BaselineTest, true);
});

test("P5 preview exposes a controlled IFC pair without putting its URL in drawing state", async () => {
  const ifcFileId = "00000000-0000-4000-8000-0000000000a1";
  const loaded = unwrapRouteData(
    await preview.loader({
      request: request(
        `http://127.0.0.1:5173/workspace-preview/drawing-workspace?p5IfcTest=1&view=split&ifc=${ifcFileId}`,
      ),
      params: {},
    }),
  );
  assert.equal(loaded.viewMode, "split");
  assert.equal(loaded.sourceBundle.ifc.id, ifcFileId);
  assert.equal("signedUrl" in loaded.sourceBundle.ifc, false);
  assert.equal(
    loaded.sourceBundle.ifc.derivative.geometrySignedUrl.endsWith(".glb"),
    true,
  );
  assert.equal(
    JSON.stringify(loaded.sourceBundle.catalog).includes("http"),
    false,
  );
  assert.deepEqual(
    loaded.workspace.document.revision.sources.map((source) => ({
      objectId: source.objectId,
      sourceFileId: source.sourceFileId,
      sourceSha256: source.sourceSha256,
      ifcGlobalId: source.ifcGlobalId,
    })),
    [
      {
        objectId: "00000000-0000-4000-8000-000000000070",
        sourceFileId: ifcFileId,
        sourceSha256:
          "db372f3f57796e2f572958c1c144bf3d8be7912493738636a2152cf18f08a14d",
        ifcGlobalId: "0VNYAWfXv8JvIRVfOzYH1j",
      },
    ],
  );
  assert.equal(JSON.stringify(loaded.workspace).includes("example.ifc"), false);

  const twoDimensional = unwrapRouteData(
    await preview.loader({
      request: request(
        `http://127.0.0.1:5173/workspace-preview/drawing-workspace?p5IfcTest=1&view=2d&ifc=${ifcFileId}`,
      ),
      params: {},
    }),
  );
  assert.equal(twoDimensional.selectedIfcFileId, ifcFileId);
  assert.equal(twoDimensional.sourceBundle.ifc, null);
});

test("P5 preview exposes one exact PDF predecessor edge without canonical compare state", async () => {
  const loaded = unwrapRouteData(
    await preview.loader({
      request: request(
        "http://127.0.0.1:5173/workspace-preview/drawing-workspace?p5PdfTest=1",
      ),
      params: {},
    }),
  );

  assert.equal(loaded.sourceBundle.pdf.signedUrl, "/__p5-current.pdf");
  assert.equal("signedUrl" in loaded.sourceBundle.previousPdf, false);
  assert.deepEqual(loaded.sourceBundle.revisionEdge, {
    id: "00000000-0000-4000-8000-0000000000b2",
    previousFileId: "00000000-0000-4000-8000-0000000000b1",
    previousSha256: "b".repeat(64),
    currentFileId: "00000000-0000-4000-8000-000000000002",
    currentSha256: "a".repeat(64),
  });
  const canonical = JSON.stringify(loaded.workspace.document.revision);
  assert.equal(canonical.includes("signedUrl"), false);
  assert.equal(canonical.includes("브라우저 미리보기"), false);
  assert.equal(canonical.includes("diff"), false);

  const form = new FormData();
  form.set("intent", "load_pdf_compare");
  form.set("revision_edge_id", loaded.sourceBundle.revisionEdge.id);
  form.set("current_file_id", loaded.sourceBundle.revisionEdge.currentFileId);
  form.set("current_sha256", loaded.sourceBundle.revisionEdge.currentSha256);
  form.set("previous_file_id", loaded.sourceBundle.previousPdf.id);
  form.set("previous_sha256", loaded.sourceBundle.previousPdf.sha256);
  form.set("page_number", "1");
  const signed = await preview.action({
    request: request(
      "http://127.0.0.1:5173/workspace-preview/drawing-workspace?p5PdfTest=1",
      { method: "POST", body: form },
    ),
    params: {},
  });
  assert.equal(signed.data.kind, "pdf_compare");
  assert.equal(signed.data.previousPdf.signedUrl, "/__p5-previous.pdf");
});

test("P4 vertical preview exposes only mounted-workspace test instrumentation", async () => {
  const loaded = unwrapRouteData(
    await preview.loader({
      request: request(
        "http://127.0.0.1:5173/workspace-preview/drawing-workspace?verticalTest=1",
      ),
      params: {},
    }),
  );
  assert.equal(loaded.verticalTest, true);

  const source = await readFile(
    new URL(
      "../app/lukas/screens/local-drawing-workspace-preview.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /aria-label="P4 mounted workspace snapshot"/);
  assert.match(source, /previewHarness=.*verticalPreviewHarness/s);
  assert.doesNotMatch(
    source,
    /applyDrawingCommand|hydrateDrawingDocumentState/,
  );
});

test("P2 preview fixture is a strict, hydrated P2 graph", () => {
  const fixture = preview.localDrawingWorkspacePreviewFixture();
  assert.doesNotThrow(() =>
    preview.validateLocalDrawingWorkspacePreviewFixture(fixture),
  );
  const revision = fixture.workspace.document.revision;
  assert.equal(revision.pages.length, 3);
  assert.ok(revision.canvases.some((canvas) => canvas.spaceKind === "paper"));
  assert.ok(revision.canvases.some((canvas) => canvas.spaceKind === "model"));
  assert.ok(revision.layers.some((layer) => layer.locked));
  assert.ok(revision.layers.some((layer) => !layer.locked && layer.visible));
  assert.ok(revision.objects.length >= 8);
  assert.equal(revision.styles.length, 2);
  assert.equal(revision.blocks.length, 2);
  assert.ok(revision.blockInstances.length >= 3);
  assert.equal(revision.issueLinks.length, 1);
});

test("local IFC preview fixture carries a source-bound immutable derivative contract", () => {
  const fixture = preview.localDrawingWorkspacePreviewFixture({
    p5IfcTest: true,
    selectedIfcFileId: "00000000-0000-4000-8000-0000000000a1",
    viewMode: "split",
  });
  const source = fixture.sourceBundle.ifc;
  assert.equal(source.derivative.status, "ready");
  assert.equal(source.derivative.version, 1);
  assert.equal(source.derivative.sourceSha256, source.sha256);
  assert.ok(source.derivative.manifestByteSize > 0);
  assert.ok(source.derivative.geometryByteSize > 0);
  assert.match(source.derivative.manifestSignedUrl, /\.json$/);
  assert.match(source.derivative.geometrySignedUrl, /\.glb$/);
});

test("P4 preview is visibly populated with canonical hosted objects and schedules", () => {
  const fixture = preview.localDrawingWorkspacePreviewFixture();
  const revision = fixture.workspace.document.revision;
  const beforeSource = {
    byteSize: fixture.workspace.primarySource.byte_size,
    documentSha256: fixture.workspace.document.source_sha256,
    fileSha256: fixture.workspace.primarySource.sha256,
  };
  const semantic = revision.objects.filter((object) =>
    ["wall", "opening", "space", "area", "grid", "arc"].includes(
      object.geometry.type,
    ),
  );
  assert.deepEqual(
    [...new Set(semantic.map((object) => object.geometry.type))].sort(),
    ["arc", "area", "grid", "opening", "space", "wall"],
  );
  const walls = semantic.filter((object) => object.geometry.type === "wall");
  assert.equal(walls.length, 2);
  assert.ok(
    walls.some((wall, index) =>
      walls
        .slice(index + 1)
        .some(
          (other) =>
            wall.geometry.end.x === other.geometry.start.x &&
            wall.geometry.end.y === other.geometry.start.y,
        ),
    ),
  );
  const openings = semantic.filter(
    (object) => object.geometry.type === "opening",
  );
  assert.deepEqual(
    openings.map((object) => object.geometry.openingKind).sort(),
    ["door", "window"],
  );
  for (const opening of openings) {
    const hostIndex = revision.objects.findIndex(
      (object) => object.id === opening.geometry.hostWallId,
    );
    assert.ok(hostIndex >= 0);
    assert.equal(revision.objects[hostIndex].geometry.type, "wall");
    assert.ok(hostIndex < revision.objects.indexOf(opening));
  }
  const state = {
    revisionId: revision.id,
    objects: Object.fromEntries(
      revision.objects.map((object) => [object.id, object]),
    ),
  };
  assert.equal(resolveDrawingSemanticSchedule("room", state).rows.length, 1);
  assert.equal(resolveDrawingSemanticSchedule("door", state).rows.length, 1);
  assert.equal(resolveDrawingSemanticSchedule("finish", state).rows.length, 1);
  assert.ok(revision.checkpoints.length >= 1);
  assert.doesNotThrow(() =>
    preview.validateLocalDrawingWorkspacePreviewFixture(fixture),
  );
  assert.deepEqual(
    {
      byteSize: fixture.workspace.primarySource.byte_size,
      documentSha256: fixture.workspace.document.source_sha256,
      fileSha256: fixture.workspace.primarySource.sha256,
    },
    beforeSource,
  );
});

test("P2 preview action validates operations and only echoes safe local operations", async () => {
  const form = new FormData();
  form.set("intent", "apply_operation");
  form.set("operation_json", JSON.stringify(validOperation()));
  const accepted = await preview.action({
    request: request(
      "http://localhost:5173/workspace-preview/drawing-workspace",
      { method: "POST", body: form },
    ),
    params: {},
  });
  assert.deepEqual(accepted.data, {
    ok: true,
    clientOperationId: "00000000-0000-4000-8000-000000000091",
    result: {
      operationId: "00000000-0000-4000-8000-000000000091",
      sequence: 1_787_648_400_000_000,
      resultVersions: { "00000000-0000-4000-8000-000000000021": 2 },
    },
  });

  const malformed = new FormData();
  malformed.set("intent", "apply_operation");
  malformed.set(
    "operation_json",
    JSON.stringify({ ...validOperation(), authority: "admin" }),
  );
  const rejected = await preview.action({
    request: request(
      "http://localhost:5173/workspace-preview/drawing-workspace",
      { method: "POST", body: malformed },
    ),
    params: {},
  });
  assert.equal(rejected.init.status, 400);

  const forbidden = new FormData();
  forbidden.set("intent", "create_layer");
  forbidden.set("name", "권한 우회");
  const forbiddenResult = await preview.action({
    request: request(
      "http://localhost:5173/workspace-preview/drawing-workspace",
      { method: "POST", body: forbidden },
    ),
    params: {},
  });
  assert.equal(forbiddenResult.init.status, 400);

  const wrongRevision = new FormData();
  wrongRevision.set("intent", "apply_operation");
  wrongRevision.set(
    "operation_json",
    JSON.stringify({
      ...validOperation(),
      revisionId: "00000000-0000-4000-8000-000000000003",
    }),
  );
  const wrongRevisionResult = await preview.action({
    request: request(
      "http://localhost:5173/workspace-preview/drawing-workspace",
      { method: "POST", body: wrongRevision },
    ),
    params: {},
  });
  assert.equal(wrongRevisionResult.init.status, 400);
});

test("preview receipts preserve create, update, Undo, and Redo causality", async () => {
  const fixture = preview.localDrawingWorkspacePreviewFixture();
  const revision = fixture.workspace.document.revision;
  const actorId = fixture.currentUserId;
  const objectId = "00000000-0000-4000-8000-000000000201";
  const operationIds = [
    "00000000-0000-4000-8000-000000000202",
    "00000000-0000-4000-8000-000000000203",
    "00000000-0000-4000-8000-000000000204",
    "00000000-0000-4000-8000-000000000205",
  ];
  const timestamps = [
    "2026-09-07T00:00:00.000Z",
    "2026-09-07T00:00:00.000Z",
    "2026-09-07T00:00:00.000Z",
    "2026-09-07T00:00:00.000Z",
  ];
  let operationIndex = 0;
  const state = drawingDocuments.hydrateDrawingDocumentState({
    revisionId: revision.id,
    pages: revision.pages,
    canvases: revision.canvases ?? [],
    layers: revision.layers,
    objects: revision.objects,
    sources: revision.sources ?? [],
    styles: revision.styles ?? [],
    blocks: revision.blocks ?? [],
    blockInstances: revision.blockInstances ?? [],
    propertySchemas: revision.propertySchemas ?? [],
    propertyValues: revision.propertyValues ?? [],
    tables: revision.tables ?? [],
  });
  const document = new Y.Doc();
  const localBaseMeta =
    drawingCollaboration.initializeDrawingCollaborationDocument({
      document,
      projectId: revision.project_id,
      revisionId: revision.id,
      baseSnapshotSha256: "a".repeat(64),
      baseOperationSequence: 0,
    });
  const adapter = drawingDrafts.createDrawingDraftAdapter({
    document,
    localBaseMeta,
    authoritativeState: state,
    actorId,
    authorization: "editor",
    frozen: false,
    enforceServerFreeze: false,
    createId: () => operationIds[operationIndex],
    now: () => timestamps[operationIndex++],
  });
  const queuedRequests = new Map();
  const bridge = drawingCollaboration.createDrawingCollaborationCommandBridge({
    adapter,
    outbox: { async enqueue(operation) { queuedRequests.set(operation.clientOperationId, operation); } },
  });
  const acknowledged = [];
  const acknowledge = async (applied) => {
    const operation = queuedRequests.get(applied.operation.clientOperationId);
    assert.ok(operation, "test sends the real outbox wire payload, not the internal collaboration envelope");
    const submit = async () => {
      const form = new FormData();
      form.set("intent", "apply_operation");
      form.set("operation_json", JSON.stringify(operation));
      const response = await preview.action({
        request: request("http://localhost:5173/workspace-preview/drawing-workspace", { method: "POST", body: form }),
        params: {},
      });
      assert.equal(response.data.ok, true);
      return response.data.result;
    };
    const receipt = await submit();
    const sequence = receipt.sequence;
    assert.deepEqual(await submit(), receipt, "receipt is idempotent");
    adapter.recordLocalAcknowledgement(
      {
        clientOperationId: operation.clientOperationId,
        authoritativeSequence: sequence,
        resultVersions: receipt.resultVersions,
      },
      "canonical",
    );
    acknowledged.push(sequence);
    assert.equal(adapter.getSnapshot().quarantine, null);
  };

  const template = revision.objects.find(
    (object) => object.geometry.type === "rectangle",
  );
  assert.ok(template);
  const created = await bridge.applyCommand({
    type: "add_objects",
    actorId,
    objects: [
      {
        ...structuredClone(template),
        id: objectId,
        name: "Receipt rectangle",
        version: 1,
      },
    ],
  });
  await acknowledge(created);
  const updated = await bridge.applyCommand({
    type: "update_objects",
    actorId,
    updates: [{ objectId, patch: { name: "Renamed rectangle" } }],
  });
  await acknowledge(updated);
  const undone = drawingCommands.undoDrawingCommandUnit(
    adapter.getSnapshot().state,
    actorId,
    { now: () => timestamps[2], createId: () => operationIds[2] },
  );
  assert.ok(undone && !("kind" in undone));
  await bridge.applyRecorded(undone.applied[0]);
  await acknowledge(undone.applied[0]);
  const redone = drawingCommands.redoDrawingCommandUnit(
    adapter.getSnapshot().state,
    actorId,
    { now: () => timestamps[3], createId: () => operationIds[3] },
  );
  assert.ok(redone && !("kind" in redone));
  await bridge.applyRecorded(redone.applied[0]);
  await acknowledge(redone.applied[0]);

  assert.deepEqual(
    acknowledged,
    [...acknowledged].sort((a, b) => a - b),
  );
  assert.equal(new Set(acknowledged).size, acknowledged.length);
  assert.ok(acknowledged[0] > 2_147_483_646);
  const restartedReceipts = preview.createPreviewOperationReceiptSequencer();
  assert.equal(restartedReceipts.issue(created.operation), acknowledged[0]);
  assert.throws(
    () => restartedReceipts.issue({ ...created.operation, actorId: "00000000-0000-4000-8000-000000000006" }),
    /identity cannot be reused/,
  );
  assert.ok(restartedReceipts.issue({ ...redone.applied[0].operation, createdAt: "2026-09-07T00:00:00.001Z" }) > acknowledged[3]);
  assert.equal(
    adapter.getSnapshot().state.objects[objectId].name,
    "Renamed rectangle",
  );
  adapter.dispose();
  document.destroy();
});

test("preview receipt sequence rejects safe-integer exhaustion before issuing an invalid ACK", () => {
  const receipts = preview.createPreviewOperationReceiptSequencer();
  const createdAt = new Date(Math.floor(Number.MAX_SAFE_INTEGER / 1000)).toISOString();
  const floor = Date.parse(createdAt) * 1000;
  const operation = (index) => ({
    revisionId: "00000000-0000-4000-8000-000000000004",
    clientOperationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    createdAt,
  });
  for (let index = 0; index <= Number.MAX_SAFE_INTEGER - floor; index++)
    assert.equal(receipts.issue(operation(index)), floor + index);
  assert.throws(() => receipts.issue(operation(1001)), /sequence is exhausted/);
  assert.equal(receipts.issue(operation(0)), floor, "earlier receipts remain idempotent after exhaustion");
});
