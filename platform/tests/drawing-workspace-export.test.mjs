import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { createServer } from "vite";

import {
  collectExportPrimitives,
  exportDrawingPdf,
  exportDrawingPng,
  exportDrawingSvg,
} from "../app/lukas/lib/drawing-export.ts";

const ids = {
  revision: "00000000-0000-4000-8000-000000001000",
  pageFirst: "00000000-0000-4000-8000-000000001010",
  pageSecond: "00000000-0000-4000-8000-000000001011",
  canvasFirst: "00000000-0000-4000-8000-000000001020",
  canvasSecond: "00000000-0000-4000-8000-000000001021",
  canvasModel: "00000000-0000-4000-8000-000000001022",
  layerLocked: "00000000-0000-4000-8000-000000001030",
  layerWork: "00000000-0000-4000-8000-000000001031",
  layerHidden: "00000000-0000-4000-8000-000000001032",
  layerSecond: "00000000-0000-4000-8000-000000001033",
  layerModel: "00000000-0000-4000-8000-000000001034",
  style: "00000000-0000-4000-8000-000000001040",
  objectLocked: "00000000-0000-4000-8000-000000001050",
  blockInstance: "00000000-0000-4000-8000-000000001051",
  objectStyled: "00000000-0000-4000-8000-000000001052",
  objectHidden: "00000000-0000-4000-8000-000000001053",
  objectSecond: "00000000-0000-4000-8000-000000001054",
  objectModel: "00000000-0000-4000-8000-000000001055",
  block: "00000000-0000-4000-8000-000000001060",
  lineage: "00000000-0000-4000-8000-000000001061",
  source: "00000000-0000-4000-8000-000000001070",
};

function exportFixture() {
  const pages = {
    [ids.pageSecond]: {
      id: ids.pageSecond,
      revisionId: ids.revision,
      name: "Second",
      sortOrder: 1,
      version: 1,
    },
    [ids.pageFirst]: {
      id: ids.pageFirst,
      revisionId: ids.revision,
      name: "First",
      sortOrder: 0,
      version: 1,
    },
  };
  const canvases = {
    [ids.canvasSecond]: {
      id: ids.canvasSecond,
      pageId: ids.pageSecond,
      name: "Second paper",
      spaceKind: "paper",
      widthMillimeters: 297,
      heightMillimeters: 210,
      background: null,
      sortOrder: 0,
      version: 1,
    },
    [ids.canvasModel]: {
      id: ids.canvasModel,
      pageId: ids.pageFirst,
      name: "Model",
      spaceKind: "model",
      widthMillimeters: 500,
      heightMillimeters: 400,
      background: null,
      sortOrder: 1,
      version: 1,
    },
    [ids.canvasFirst]: {
      id: ids.canvasFirst,
      pageId: ids.pageFirst,
      name: "First paper",
      spaceKind: "paper",
      widthMillimeters: 210,
      heightMillimeters: 297,
      background: {
        sourceFileId: ids.source,
        sourceSha256: "a".repeat(64),
        pdfPageNumber: 2,
        calibration: null,
      },
      sortOrder: 0,
      version: 1,
    },
  };
  const layers = {
    [ids.layerWork]: {
      id: ids.layerWork,
      name: "Work",
      canvasId: ids.canvasFirst,
      sortOrder: 1,
      visible: true,
      locked: false,
      systemKind: "work",
      version: 1,
    },
    [ids.layerLocked]: {
      id: ids.layerLocked,
      name: "Locked reference",
      canvasId: ids.canvasFirst,
      sortOrder: 0,
      visible: true,
      locked: true,
      systemKind: "custom",
      version: 1,
    },
    [ids.layerHidden]: {
      id: ids.layerHidden,
      name: "Hidden",
      canvasId: ids.canvasFirst,
      sortOrder: 2,
      visible: false,
      locked: false,
      systemKind: "custom",
      version: 1,
    },
    [ids.layerSecond]: {
      id: ids.layerSecond,
      name: "Second work",
      canvasId: ids.canvasSecond,
      sortOrder: 0,
      visible: true,
      locked: false,
      systemKind: "work",
      version: 1,
    },
    [ids.layerModel]: {
      id: ids.layerModel,
      name: "Model work",
      canvasId: ids.canvasModel,
      sortOrder: 0,
      visible: true,
      locked: false,
      systemKind: "work",
      version: 1,
    },
  };
  const inlineStyle = { stroke: "#112233", strokeWidth: 2, fill: null };
  const objects = {
    [ids.objectStyled]: {
      id: ids.objectStyled,
      name: "Styled rectangle",
      layerId: ids.layerWork,
      geometry: {
        type: "rectangle",
        origin: { x: 20, y: 30 },
        width: 40,
        height: 25,
        rotation: 10,
      },
      styleId: ids.style,
      style: { fill: "#ffeecc" },
      version: 1,
    },
    [ids.objectLocked]: {
      id: ids.objectLocked,
      name: "Locked line",
      layerId: ids.layerLocked,
      geometry: {
        type: "line",
        start: { x: 5, y: 6 },
        end: { x: 15, y: 16 },
      },
      styleId: null,
      style: inlineStyle,
      version: 1,
    },
    [ids.objectHidden]: {
      id: ids.objectHidden,
      name: "Hidden circle",
      layerId: ids.layerHidden,
      geometry: { type: "circle", center: { x: 40, y: 40 }, radius: 5 },
      styleId: null,
      style: inlineStyle,
      version: 1,
    },
    [ids.objectSecond]: {
      id: ids.objectSecond,
      name: "Second page note",
      layerId: ids.layerSecond,
      geometry: {
        type: "text",
        origin: { x: 1, y: 2 },
        width: 40,
        text: `A<&"'>`,
      },
      styleId: null,
      style: { ...inlineStyle, fontSize: 13 },
      version: 1,
    },
    [ids.objectModel]: {
      id: ids.objectModel,
      name: "Model line",
      layerId: ids.layerModel,
      geometry: {
        type: "line",
        start: { x: 2, y: 3 },
        end: { x: 20, y: 30 },
      },
      styleId: null,
      style: inlineStyle,
      version: 1,
    },
  };
  const structure = {
    pages,
    canvases,
    layers,
    objects,
    styles: {
      [ids.style]: {
        id: ids.style,
        revisionId: ids.revision,
        name: "Export style",
        value: {
          stroke: "#445566",
          strokeWidth: 3,
          fill: null,
          fontSize: 15,
        },
        version: 1,
      },
    },
    blocks: {
      [ids.block]: {
        id: ids.block,
        revisionId: ids.revision,
        name: "Door",
        primitives: [
          {
            localId: "leaf",
            name: "Leaf",
            geometry: {
              type: "line",
              start: { x: 0, y: 0 },
              end: { x: 12, y: 0 },
            },
            styleId: ids.style,
            style: { strokeWidth: 4 },
          },
        ],
        version: 1,
      },
    },
    blockInstances: {
      [ids.blockInstance]: {
        id: ids.blockInstance,
        lineageId: ids.lineage,
        blockId: ids.block,
        layerId: ids.layerWork,
        name: "Door 1",
        origin: { x: 100, y: 120 },
        rotation: 90,
        scaleX: 2,
        scaleY: 1,
        version: 1,
      },
    },
    propertySchemas: {},
    propertyValues: {},
    tables: {},
  };
  return {
    revisionId: ids.revision,
    objects,
    layers,
    operations: [],
    undoStackByActor: {},
    redoStackByActor: {},
    structure,
  };
}

test("canonical export traversal isolates one canvas and keeps visible locked layers", () => {
  const result = collectExportPrimitives(exportFixture(), ids.canvasFirst);

  assert.equal(result.canvas.id, ids.canvasFirst);
  assert.deepEqual(
    result.primitives.map((primitive) => primitive.id),
    [ids.objectLocked, `${ids.blockInstance}/leaf`, ids.objectStyled],
  );
  assert.equal(
    result.primitives.some((primitive) => primitive.id === ids.objectHidden),
    false,
  );
  assert.equal(
    result.primitives.some((primitive) => primitive.id === ids.objectSecond),
    false,
  );
});

test("canonical export traversal resolves live object and block styles", () => {
  const result = collectExportPrimitives(exportFixture(), ids.canvasFirst);
  const block = result.primitives.find(
    (primitive) => primitive.id === `${ids.blockInstance}/leaf`,
  );
  const object = result.primitives.find(
    (primitive) => primitive.id === ids.objectStyled,
  );

  assert.deepEqual(block.style, {
    stroke: "#445566",
    strokeWidth: 4,
    fill: null,
    fontSize: 15,
  });
  assert.deepEqual(block.transform, [0, 2, -1, 0, 100, 120]);
  assert.deepEqual(object.style, {
    stroke: "#445566",
    strokeWidth: 3,
    fill: "#ffeecc",
    fontSize: 15,
  });
  assert.deepEqual(object.transform, [1, 0, 0, 1, 0, 0]);
});

test("SVG export is byte-stable with escaped XML and stable canvas bounds", () => {
  const document = exportFixture();
  const first = exportDrawingSvg(document, ids.canvasSecond);
  const second = exportDrawingSvg(document, ids.canvasSecond);

  assert.equal(first, second);
  assert.equal(
    first,
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210">',
      '<rect x="0" y="0" width="297" height="210" fill="#ffffff"/>',
      `<g data-export-id="${ids.objectSecond}" transform="matrix(1 0 0 1 0 0)">`,
      '<text x="1" y="2" width="40" fill="#112233" font-family="sans-serif" font-size="13" dominant-baseline="text-before-edge" xml:space="preserve">A&lt;&amp;&quot;&apos;&gt;</text>',
      "</g>",
      "</svg>",
      "",
    ].join("\n"),
  );
});

test("SVG export preserves canonical multiline text layout", () => {
  const document = exportFixture();
  document.structure.objects[ids.objectSecond].geometry.text = "A&B\nC<D";
  const svg = exportDrawingSvg(document, ids.canvasSecond);

  assert.match(
    svg,
    /<text x="1" y="2" width="40" fill="#112233" font-family="sans-serif" font-size="13" dominant-baseline="text-before-edge" xml:space="preserve"><tspan x="1" y="2">A&amp;B<\/tspan><tspan x="1" y="17\.6">C&lt;D<\/tspan><\/text>/,
  );
});

function fakeCanvas({
  drawFailure = null,
  encode = "ok",
  pngBytes = "png",
} = {}) {
  const calls = [];
  const context = new Proxy(
    {
      calls,
      drawImage(...args) {
        calls.push(["drawImage", ...args]);
        if (drawFailure === "tainted")
          throw new DOMException("Tainted", "SecurityError");
        if (drawFailure === "encoding") throw new Error("Decode failed");
      },
      fillRect(...args) {
        calls.push(["fillRect", ...args]);
      },
      fillText(...args) {
        calls.push(["fillText", ...args]);
      },
      measureText() {
        return { width: 0 };
      },
    },
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
    context,
    height: 0,
    width: 0,
    getContext(kind) {
      return kind === "2d" ? context : null;
    },
    toBlob(callback) {
      if (encode === "throw")
        throw new DOMException("Canvas is tainted", "SecurityError");
      callback(
        encode === "null" ? null : new Blob([pngBytes], { type: "image/png" }),
      );
    },
  };
}

test("PNG export has deterministic 1x, 2x, and 4x dimensions", async () => {
  for (const [scale, dimensions] of [
    [1, [297, 210]],
    [2, [594, 420]],
    [4, [1188, 840]],
  ]) {
    const canvas = fakeCanvas();
    const blob = await exportDrawingPng(exportFixture(), ids.canvasSecond, {
      canvasFactory: () => canvas,
      scale,
    });
    assert.deepEqual([canvas.width, canvas.height], dimensions);
    assert.equal(blob.type, "image/png");
  }
});

test("PNG export requires the matching PDF.js background canvas", async () => {
  const document = exportFixture();
  await assert.rejects(
    exportDrawingPng(document, ids.canvasFirst, {
      canvasFactory: () => fakeCanvas(),
      scale: 1,
    }),
    /PDF background pixels are missing/i,
  );
  await assert.rejects(
    exportDrawingPng(document, ids.canvasFirst, {
      background: {
        bounds: { x: 0, y: 0, width: 210, height: 297 },
        canvas: fakeCanvas(),
        sourceFileId: ids.source,
        sourceSha256: "b".repeat(64),
        pdfPageNumber: 2,
      },
      canvasFactory: () => fakeCanvas(),
      scale: 1,
    }),
    /does not match the canonical source/i,
  );
});

test("PNG export reports tainted and failed background encoding explicitly", async () => {
  const background = {
    bounds: { x: 0, y: 0, width: 210, height: 297 },
    canvas: fakeCanvas(),
    sourceFileId: ids.source,
    sourceSha256: "a".repeat(64),
    pdfPageNumber: 2,
  };
  await assert.rejects(
    exportDrawingPng(exportFixture(), ids.canvasFirst, {
      background,
      canvasFactory: () => fakeCanvas({ encode: "throw" }),
      scale: 1,
    }),
    /tainted/i,
  );
  await assert.rejects(
    exportDrawingPng(exportFixture(), ids.canvasFirst, {
      background,
      canvasFactory: () => fakeCanvas({ encode: "null" }),
      scale: 1,
    }),
    /PNG encoding failed/i,
  );
  await assert.rejects(
    exportDrawingPng(exportFixture(), ids.canvasFirst, {
      background,
      canvasFactory: () => fakeCanvas({ drawFailure: "encoding" }),
      scale: 1,
    }),
    /PDF background encoding failed/i,
  );
});

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test("PDF export writes canonically ordered paper pages, dimensions, images, and metadata", async () => {
  const document = exportFixture();
  const sourceBefore = structuredClone(
    document.structure.canvases[ids.canvasFirst].background,
  );
  const sourceBytes = new Uint8Array([37, 80, 68, 70, 45]);
  const sourceBytesBefore = sourceBytes.slice();
  const bytes = await exportDrawingPdf(document, {
    author: "1HK QA",
    canvasFactory: () => fakeCanvas({ pngBytes: onePixelPng }),
    createdAt: "2026-08-25T09:00:00.000Z",
    getBackground: async (canvas) =>
      canvas.id === ids.canvasFirst
        ? {
            bounds: { x: 0, y: 0, width: 210, height: 297 },
            canvas: fakeCanvas(),
            sourceFileId: ids.source,
            sourceSha256: "a".repeat(64),
            pdfPageNumber: 2,
          }
        : undefined,
    scale: 1,
    subject: "Deterministic drawing export",
    title: "P2 Export Fixture",
  });
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = pdf.getPages();

  assert.equal(pages.length, 2);
  assert.ok(Math.abs(pages[0].getWidth() - (210 * 72) / 25.4) < 1e-6);
  assert.ok(Math.abs(pages[0].getHeight() - (297 * 72) / 25.4) < 1e-6);
  assert.ok(Math.abs(pages[1].getWidth() - (297 * 72) / 25.4) < 1e-6);
  assert.ok(Math.abs(pages[1].getHeight() - (210 * 72) / 25.4) < 1e-6);
  for (const page of pages)
    assert.equal(page.node.Contents() !== undefined, true);
  assert.equal(pdf.getTitle(), "P2 Export Fixture");
  assert.equal(pdf.getAuthor(), "1HK QA");
  assert.equal(pdf.getSubject(), "Deterministic drawing export");
  assert.equal(pdf.getCreator(), "1HK Drawing Workspace");
  assert.equal(pdf.getProducer(), "pdf-lib 1.17.1 / 1HK Drawing Workspace");
  assert.equal(pdf.getCreationDate().toISOString(), "2026-08-25T09:00:00.000Z");
  assert.deepEqual(
    document.structure.canvases[ids.canvasFirst].background,
    sourceBefore,
  );
  assert.deepEqual(sourceBytes, sourceBytesBefore);
});

test("PDF export excludes model canvases unless they are explicitly selected", async () => {
  const canvasFactory = () => fakeCanvas({ pngBytes: onePixelPng });
  const normal = await exportDrawingPdf(exportFixture(), {
    canvasFactory,
    createdAt: "2026-08-25T09:00:00.000Z",
    getBackground: async (canvas) =>
      canvas.id === ids.canvasFirst
        ? {
            bounds: { x: 0, y: 0, width: 210, height: 297 },
            canvas: fakeCanvas(),
            sourceFileId: ids.source,
            sourceSha256: "a".repeat(64),
            pdfPageNumber: 2,
          }
        : undefined,
    scale: 1,
    title: "Paper only",
  });
  assert.equal((await PDFDocument.load(normal)).getPageCount(), 2);

  const selectedModel = await exportDrawingPdf(exportFixture(), {
    canvasFactory,
    canvasIds: [ids.canvasModel],
    createdAt: "2026-08-25T09:00:00.000Z",
    scale: 1,
    title: "Selected model",
  });
  const modelPdf = await PDFDocument.load(selectedModel);
  assert.equal(modelPdf.getPageCount(), 1);
  assert.ok(
    Math.abs(modelPdf.getPage(0).getWidth() - (500 * 72) / 25.4) < 1e-6,
  );
  assert.ok(
    Math.abs(modelPdf.getPage(0).getHeight() - (400 * 72) / 25.4) < 1e-6,
  );
});

test("real browser PNG bytes contain the expected signature, dimensions, and pixels", async () => {
  const document = exportFixture();
  const canvas = document.structure.canvases[ids.canvasSecond];
  canvas.widthMillimeters = 10;
  canvas.heightMillimeters = 10;
  const object = document.structure.objects[ids.objectSecond];
  object.geometry = {
    type: "rectangle",
    origin: { x: 2, y: 2 },
    width: 6,
    height: 6,
    rotation: 0,
  };
  object.style = {
    stroke: "#ff0000",
    strokeWidth: 1,
    fill: "#ff0000",
  };

  const vite = await createServer({
    appType: "custom",
    clearScreen: false,
    configFile: false,
    logLevel: "silent",
    plugins: [
      {
        configureServer(server) {
          server.middlewares.use(
            "/drawing-export-test.html",
            (_request, response) => {
              response.statusCode = 200;
              response.setHeader("Content-Type", "text/html");
              response.end("<!doctype html><title>Drawing export test</title>");
            },
          );
        },
        name: "drawing-export-test-page",
      },
    ],
    root: new URL("..", import.meta.url).pathname,
    server: { host: "127.0.0.1", port: 0 },
  });
  let browser;
  try {
    await vite.listen();
    const address = vite.httpServer.address();
    assert.equal(typeof address, "object");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${origin}/drawing-export-test.html`);
    const result = await page.evaluate(
      async ({ canvasId, documentState, moduleUrl }) => {
        const { exportDrawingPng } = await import(moduleUrl);
        const blob = await exportDrawingPng(documentState, canvasId, {
          scale: 2,
        });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const bitmap = await createImageBitmap(blob);
        const decoded = document.createElement("canvas");
        decoded.width = bitmap.width;
        decoded.height = bitmap.height;
        const context = decoded.getContext("2d", { willReadFrequently: true });
        context.drawImage(bitmap, 0, 0);
        return {
          center: [...context.getImageData(10, 10, 1, 1).data],
          corner: [...context.getImageData(0, 0, 1, 1).data],
          height: bitmap.height,
          signature: [...bytes.slice(0, 8)],
          width: bitmap.width,
        };
      },
      {
        canvasId: ids.canvasSecond,
        documentState: document,
        moduleUrl: `${origin}/app/lukas/lib/drawing-export.ts`,
      },
    );
    assert.deepEqual(result.signature, [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual([result.width, result.height], [20, 20]);
    assert.deepEqual(result.corner, [255, 255, 255, 255]);
    assert.deepEqual(result.center, [255, 0, 0, 255]);
  } finally {
    await browser?.close();
    await vite.close();
  }
});

export { exportFixture, ids };
