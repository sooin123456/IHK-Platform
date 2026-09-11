import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { PDFDocument } from "pdf-lib";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

import {
  exportDrawingPdf,
  exportDrawingPng,
  exportDrawingSvg,
} from "../app/lukas/lib/drawing-export.ts";
import { createDrawingDocumentState } from "../app/lukas/lib/drawing-commands.ts";
import {
  loadDrawingWorkspace,
  loadDrawingWorkspaceCollaborationBootstrap,
} from "../app/lukas/lib/drawing-workspace.server.ts";
import { DrawingCanvasSchema } from "../app/lukas/lib/drawing-workspace.types.ts";

const ids = {
  canvas: "00000000-0000-4000-8000-000000000003",
  document: "00000000-0000-4000-8000-000000000001",
  layer: "00000000-0000-4000-8000-000000000004",
  page: "00000000-0000-4000-8000-000000000002",
  revision: "00000000-0000-4000-8000-000000000005",
};

const outputProfile = {
  paper: "A3",
  orientation: "landscape",
  widthMillimeters: 420,
  heightMillimeters: 297,
  scaleDenominator: 50,
};

const sharedOutputProfileCases = JSON.parse(
  readFileSync(
    new URL("./fixtures/drawing-output-profiles.json", import.meta.url),
    "utf8",
  ),
);

function canonicalCanvas(overrides = {}) {
  return {
    id: ids.canvas,
    pageId: ids.page,
    name: "A3 1:50",
    spaceKind: "paper",
    widthMillimeters: 21_000,
    heightMillimeters: 14_850,
    background: null,
    sortOrder: 0,
    version: 1,
    outputProfile,
    ...overrides,
  };
}

function profiledDocument() {
  const canvas = canonicalCanvas();
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      pages: {
        [ids.page]: {
          id: ids.page,
          revisionId: ids.revision,
          name: "A3 example",
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: { [ids.canvas]: canvas },
      layers: {
        [ids.layer]: {
          id: ids.layer,
          canvasId: ids.canvas,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          sortOrder: 0,
          version: 1,
        },
      },
      objects: {},
      sources: {},
      styles: {},
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
}

function fakeCanvas(pngBytes = "png") {
  const calls = [];
  const context = new Proxy(
    {},
    {
      get(target, property) {
        if (property in target) return target[property];
        return (...args) => calls.push([property, ...args]);
      },
      set(target, property, value) {
        target[property] = value;
        return true;
      },
    },
  );
  return {
    calls,
    width: 0,
    height: 0,
    getContext: (kind) => (kind === "2d" ? context : null),
    toBlob: (callback) => callback(new Blob([pngBytes], { type: "image/png" })),
  };
}

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function collaborationBootstrap(canvas = canonicalCanvas()) {
  return {
    canonicalJson: {
      schemaVersion: 2,
      revision: {
        id: ids.revision,
        documentId: ids.document,
        projectId: "00000000-0000-4000-8000-000000000006",
        sequence: 1,
        version: 1,
      },
      sources: [],
      pages: [],
      canvases: [canvas],
      layers: [],
      objects: [],
      styles: [],
      blocks: [],
      blockInstances: [],
      propertySchemas: [],
      propertyValues: [],
      tables: [],
      issues: [],
      operationSequence: 0,
    },
    operationSequence: 0,
    schemaVersion: 2,
    sha256: "a".repeat(64),
    revisionStatus: "draft",
    capability: "editor",
    canWrite: true,
    recentOutcomes: [],
  };
}

function queryClient(responses) {
  return {
    from(table) {
      const response = responses[table] ?? { data: [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        gt: () => builder,
        limit(value) {
          if (value === 1) return builder;
          return Promise.resolve({
            ...response,
            data: Array.isArray(response.data) ? response.data : [],
          });
        },
        range: () =>
          Promise.resolve({
            ...response,
            data: Array.isArray(response.data) ? response.data : [],
          }),
        single: () => Promise.resolve(response),
        maybeSingle: () => Promise.resolve(response),
        then: (resolve, reject) =>
          Promise.resolve(response).then(resolve, reject),
      };
      return builder;
    },
  };
}

function dialogShellPlugin() {
  return {
    name: "drawing-export-dialog-test-shell",
    enforce: "pre",
    resolveId(id) {
      if (
        id === "~/core/components/ui/dialog" ||
        /\/core\/components\/ui\/dialog(?:\.tsx)?$/.test(id)
      )
        return "\0drawing-export-dialog-test-shell";
    },
    load(id) {
      if (id !== "\0drawing-export-dialog-test-shell") return;
      return `
        import { createElement } from "react";
        const shell = ({ children }) => createElement("div", null, children);
        export const Dialog = shell;
        export const DialogClose = shell;
        export const DialogContent = shell;
        export const DialogDescription = shell;
        export const DialogFooter = shell;
        export const DialogHeader = shell;
        export const DialogTitle = shell;
        export const DialogTrigger = shell;
      `;
    },
  };
}

test("canonical canvases preserve a strict, scale-consistent output profile", () => {
  const canvas = DrawingCanvasSchema.parse(canonicalCanvas());

  assert.deepEqual(canvas.outputProfile, outputProfile);
  assert.equal(canvas.widthMillimeters, 21_000);
  assert.equal(canvas.heightMillimeters, 14_850);

  for (const invalid of [
    { ...outputProfile, extra: true },
    { ...outputProfile, widthMillimeters: 0 },
    { ...outputProfile, scaleDenominator: Number.POSITIVE_INFINITY },
    { ...outputProfile, orientation: "portrait" },
  ])
    assert.throws(
      () =>
        DrawingCanvasSchema.parse(canonicalCanvas({ outputProfile: invalid })),
      /invalid|unrecognized|0|finite|orientation|scale|ratio|dimensions/i,
    );

  assert.throws(
    () =>
      DrawingCanvasSchema.parse(canonicalCanvas({ widthMillimeters: 20_999 })),
    /scale|ratio|dimensions/i,
  );

  for (const canvas of [
    canonicalCanvas({
      widthMillimeters: 1e-16,
      heightMillimeters: 1e-16,
      outputProfile: {
        paper: "microscopic",
        orientation: "landscape",
        widthMillimeters: 2e-16,
        heightMillimeters: 1e-16,
        scaleDenominator: 1,
      },
    }),
    canonicalCanvas({
      widthMillimeters: Number.MAX_VALUE,
      heightMillimeters: 2,
      outputProfile: {
        paper: "overflow",
        orientation: "landscape",
        widthMillimeters: Number.MAX_VALUE,
        heightMillimeters: 1,
        scaleDenominator: 2,
      },
    }),
    canonicalCanvas({
      widthMillimeters: Number.MIN_VALUE,
      heightMillimeters: Number.MIN_VALUE,
      outputProfile: {
        paper: "underflow",
        orientation: "landscape",
        widthMillimeters: Number.MIN_VALUE * 2,
        heightMillimeters: Number.MIN_VALUE,
        scaleDenominator: 0.25,
      },
    }),
  ])
    assert.throws(
      () => DrawingCanvasSchema.parse(canvas),
      /scale|ratio|dimensions/i,
    );
});

test("canonical canvas validation matches the shared SQL output profile matrix", () => {
  assert.ok(
    sharedOutputProfileCases.some(
      ({ name, valid }) => name === "A4 landscape at 1:50" && valid,
    ),
  );
  assert.ok(
    sharedOutputProfileCases.some(
      ({ name, valid }) =>
        name === "fractional scale with decimal float artifact" && valid,
    ),
  );
  for (const name of [
    "JSON numeric half-micro differs from binary rounding",
    "off-grid model within former rounding tolerance",
  ])
    assert.ok(
      sharedOutputProfileCases.some(
        (fixture) => fixture.name === name && !fixture.valid,
      ),
      `${name}: shared rejection fixture is missing`,
    );

  for (const fixture of sharedOutputProfileCases) {
    const candidate = canonicalCanvas({
      widthMillimeters: fixture.widthMillimeters,
      heightMillimeters: fixture.heightMillimeters,
      outputProfile: fixture.profile,
    });
    const result = DrawingCanvasSchema.safeParse(candidate);
    assert.equal(
      result.success,
      fixture.valid,
      `${fixture.name}: ${result.success ? "unexpectedly valid" : result.error.message}`,
    );
    if (result.success)
      assert.deepEqual(
        {
          profile: result.data.outputProfile,
          widthMillimeters: result.data.widthMillimeters,
          heightMillimeters: result.data.heightMillimeters,
        },
        {
          profile: fixture.profile,
          widthMillimeters: fixture.widthMillimeters,
          heightMillimeters: fixture.heightMillimeters,
        },
        `${fixture.name}: valid profile did not round-trip exactly`,
      );
  }
});

test("legacy canvases omit outputProfile after canonical parsing", () => {
  const { outputProfile: _profile, ...legacy } = canonicalCanvas({
    widthMillimeters: 420,
    heightMillimeters: 297,
  });

  assert.equal(
    JSON.stringify(DrawingCanvasSchema.parse(legacy)),
    JSON.stringify(legacy),
  );
  assert.equal("outputProfile" in DrawingCanvasSchema.parse(legacy), false);

  const microscopicLegacy = {
    ...legacy,
    widthMillimeters: 2e-20,
    heightMillimeters: 1e-20,
  };
  assert.deepEqual(
    DrawingCanvasSchema.parse(microscopicLegacy),
    microscopicLegacy,
  );
});

test("canonical collaboration loading round-trips and validates output profiles", async () => {
  const source = collaborationBootstrap();
  const loaded = await loadDrawingWorkspaceCollaborationBootstrap(
    {
      rpc: async () => ({ data: source, error: null }),
    },
    ids.revision,
  );
  assert.deepEqual(
    loaded.canonicalJson.canvases[0].outputProfile,
    outputProfile,
  );
  assert.equal(
    JSON.stringify(loaded.canonicalJson.canvases[0]),
    JSON.stringify(source.canonicalJson.canvases[0]),
  );

  await assert.rejects(
    loadDrawingWorkspaceCollaborationBootstrap(
      {
        rpc: async () => ({
          data: collaborationBootstrap(
            canonicalCanvas({ widthMillimeters: 20_999 }),
          ),
          error: null,
        }),
      },
      ids.revision,
    ),
    /scale|ratio|dimensions/i,
  );
});

test("database canvas loading maps optional output_profile without changing native geometry", async () => {
  const projectId = "00000000-0000-4000-8000-000000000006";
  const responses = {
    lukas_drawing_documents: {
      data: {
        id: ids.document,
        project_id: projectId,
        source_file_id: null,
        source_sha256: null,
        title: "Native template clone",
      },
      error: null,
    },
    lukas_drawing_revisions: {
      data: {
        id: ids.revision,
        document_id: ids.document,
        project_id: projectId,
        status: "draft",
        version: 1,
        sequence: 1,
      },
      error: null,
    },
    lukas_drawing_pages: {
      data: [
        {
          id: ids.page,
          revision_id: ids.revision,
          project_id: projectId,
          name: "A3 example",
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_canvases: {
      data: [
        {
          id: ids.canvas,
          page_id: ids.page,
          revision_id: ids.revision,
          project_id: projectId,
          name: "A3 1:50",
          space_kind: "paper",
          width_mm: 21_000,
          height_mm: 14_850,
          background_source_file_id: null,
          background_source_sha256: null,
          background_pdf_page: null,
          calibration: null,
          output_profile: outputProfile,
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_layers: {
      data: [
        {
          id: ids.layer,
          page_id: ids.page,
          canvas_id: ids.canvas,
          revision_id: ids.revision,
          project_id: projectId,
          name: "Work",
          sort_order: 0,
          visible: true,
          locked: false,
          system_kind: "work",
          version: 1,
        },
      ],
      error: null,
    },
  };
  const loaded = await loadDrawingWorkspace(queryClient(responses), {
    projectId,
    workspaceId: ids.document,
  });
  const [canvas] = loaded.document.revision.canvases;

  assert.deepEqual(canvas.outputProfile, outputProfile);
  assert.equal(canvas.widthMillimeters, 21_000);
  assert.equal(canvas.heightMillimeters, 14_850);

  responses.lukas_drawing_canvases.data[0] = {
    ...responses.lukas_drawing_canvases.data[0],
    width_mm: 420,
    height_mm: 297,
    output_profile: null,
  };
  const legacy = await loadDrawingWorkspace(queryClient(responses), {
    projectId,
    workspaceId: ids.document,
  });
  assert.equal("outputProfile" in legacy.document.revision.canvases[0], false);
});

test("profiled SVG keeps native world coordinates inside physical A3 dimensions", () => {
  const document = profiledDocument();
  const before = structuredClone(document.structure.canvases[ids.canvas]);
  const svg = exportDrawingSvg(document, ids.canvas);

  assert.match(
    svg,
    /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="420mm" height="297mm" viewBox="0 0 21000 14850">/,
  );
  assert.match(
    svg,
    /<rect x="0" y="0" width="21000" height="14850" fill="#ffffff"\/>/,
  );
  assert.deepEqual(document.structure.canvases[ids.canvas], before);
});

test("export refuses a profiled canvas whose paper scale would distort geometry", () => {
  const document = profiledDocument();
  document.structure.canvases[ids.canvas].widthMillimeters = 20_999;

  assert.throws(
    () => exportDrawingSvg(document, ids.canvas),
    /output dimensions are invalid/i,
  );
});

test("profiled PNG density uses paper pixels instead of the native world extent", async () => {
  const document = profiledDocument();
  const canvases = [];
  for (const [scale, expected] of [
    [1, [1_587, 1_123]],
    [2, [3_175, 2_245]],
    [4, [6_350, 4_490]],
  ]) {
    const canvas = fakeCanvas();
    canvases.push(canvas);
    await exportDrawingPng(document, ids.canvas, {
      canvasFactory: () => canvas,
      scale,
    });
    assert.deepEqual([canvas.width, canvas.height], expected);
  }

  const canvas = canvases.at(-1);
  assert.ok(canvas.width * canvas.height < 30_000_000);
  assert.deepEqual(
    canvas.calls.find(([name]) => name === "setTransform"),
    ["setTransform", 6_350 / 21_000, 0, 0, 4_490 / 14_850, 0, 0],
  );
  assert.deepEqual(
    canvas.calls.find(([name]) => name === "fillRect"),
    ["fillRect", 0, 0, 21_000, 14_850],
  );
  assert.equal(
    document.structure.canvases[ids.canvas].widthMillimeters,
    21_000,
  );
  assert.equal(
    document.structure.canvases[ids.canvas].heightMillimeters,
    14_850,
  );
});

test("profiled PDF has an actual 420 by 297 millimeter page", async () => {
  const document = profiledDocument();
  const rendered = fakeCanvas(onePixelPng);
  const bytes = await exportDrawingPdf(document, {
    canvasFactory: () => rendered,
    createdAt: "2026-09-05T00:00:00.000Z",
    scale: 2,
    title: "A3 physical export",
  });
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const [page] = pdf.getPages();

  assert.ok(Math.abs(page.getWidth() - (420 * 72) / 25.4) < 1e-6);
  assert.ok(Math.abs(page.getHeight() - (297 * 72) / 25.4) < 1e-6);
  assert.deepEqual([rendered.width, rendered.height], [3_175, 2_245]);
  assert.equal(
    document.structure.canvases[ids.canvas].widthMillimeters,
    21_000,
  );
  assert.equal(
    document.structure.canvases[ids.canvas].heightMillimeters,
    14_850,
  );
});

test("export dialog describes physical paper, scale, and unchanged world size", async (t) => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    resolve: { alias: { "~": path.resolve("app") } },
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  const dialog = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-export-dialog.tsx",
  );

  const description = dialog.drawingExportSizeDescription(canonicalCanvas(), 2);
  assert.match(description, /A3/);
  assert.match(description, /420 × 297 mm/);
  assert.match(description, /1:50/);
  assert.match(description, /21,000 × 14,850 mm/);
  assert.match(description, /192 DPI/);
  for (const [scale, dpi] of [
    [1, 96],
    [2, 192],
    [4, 384],
  ])
    assert.match(
      dialog.drawingExportSizeDescription(canonicalCanvas(), scale),
      new RegExp(`${dpi} DPI`),
    );
});

test("PDF export dialog describes its mixed multi-canvas page selection", async (t) => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    plugins: [dialogShellPlugin()],
    resolve: { alias: { "~": path.resolve("app") } },
    server: { middlewareMode: true },
  });
  t.after(() => vite.close());
  const dialog = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-export-dialog.tsx",
  );
  const documentState = profiledDocument();
  const portraitCanvasId = "00000000-0000-4000-8000-000000000013";
  documentState.structure.canvases[portraitCanvasId] = canonicalCanvas({
    id: portraitCanvasId,
    name: "A4 1:100",
    widthMillimeters: 21_000,
    heightMillimeters: 29_700,
    sortOrder: 1,
    outputProfile: {
      paper: "A4",
      orientation: "portrait",
      widthMillimeters: 210,
      heightMillimeters: 297,
      scaleDenominator: 100,
    },
  });
  const legacyCanvasId = "00000000-0000-4000-8000-000000000023";
  const { outputProfile: _profile, ...legacyCanvas } = canonicalCanvas({
    id: legacyCanvasId,
    name: "Legacy actual size",
    widthMillimeters: 420,
    heightMillimeters: 297,
    sortOrder: 2,
  });
  documentState.structure.canvases[legacyCanvasId] = legacyCanvas;
  const html = renderToStaticMarkup(
    createElement(dialog.DrawingExportDialog, {
      auditRequired: false,
      checkpointSha256: null,
      createdAt: "2026-09-05T00:00:00.000Z",
      documentState: {
        ...documentState,
        activeCanvasId: ids.canvas,
        activePageId: ids.page,
      },
      hideTrigger: true,
      open: true,
      operationCheckpoint: null,
      outboxReady: true,
      projectId: "00000000-0000-4000-8000-000000000006",
      revisionId: ids.revision,
      revisionVersion: 1,
      saveStatus: "저장됨",
      sourceUrl: null,
      title: "Mixed paper export",
      workspaceId: ids.document,
    }),
  );

  assert.match(html, /PDF 3쪽/);
  assert.match(html, /혼합 용지\/방향\/축척/);
  assert.match(html, /혼합 래스터 DPI/);
  assert.doesNotMatch(html, /PDF 3쪽[^<]*A3 가로[^<]*축척 1:50/);
});
