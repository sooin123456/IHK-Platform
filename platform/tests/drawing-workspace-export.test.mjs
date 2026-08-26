import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { chromium } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
import { createServer } from "vite";

import {
  collectExportPrimitives,
  exportDrawingPdf,
  exportDrawingPng,
  exportDrawingSvg,
} from "../app/lukas/lib/drawing-export.ts";
import { geometryBounds } from "../app/lukas/lib/drawing-geometry.ts";
import { resolveDrawingOpening } from "../app/lukas/lib/drawing-semantic-geometry.ts";
import { DrawingGeometrySchema } from "../app/lukas/lib/drawing-workspace.types.ts";

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
  semanticWall: "00000000-0000-4000-8000-000000001071",
  semanticDoor: "00000000-0000-4000-8000-000000001072",
  semanticWindow: "00000000-0000-4000-8000-000000001073",
  semanticSpace: "00000000-0000-4000-8000-000000001074",
  semanticArea: "00000000-0000-4000-8000-000000001075",
  semanticGrid: "00000000-0000-4000-8000-000000001076",
  semanticArc: "00000000-0000-4000-8000-000000001077",
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

function semanticExportFixture() {
  const document = exportFixture();
  document.structure.canvases[ids.canvasSecond].widthMillimeters = 1000;
  document.structure.canvases[ids.canvasSecond].heightMillimeters = 700;
  const style = { stroke: "#123456", strokeWidth: 3, fill: null };
  Object.assign(document.structure.objects, {
    [ids.semanticWall]: {
      id: ids.semanticWall,
      name: "북측 벽",
      layerId: ids.layerSecond,
      geometry: {
        type: "wall",
        semanticVersion: 1,
        start: { x: 100, y: 100 },
        end: { x: 900, y: 100 },
        thicknessMillimeters: 18,
        heightMillimeters: 3000,
      },
      styleId: null,
      style,
      version: 1,
    },
    [ids.semanticDoor]: {
      id: ids.semanticDoor,
      name: "D-01",
      layerId: ids.layerSecond,
      geometry: {
        type: "opening",
        semanticVersion: 1,
        hostWallId: ids.semanticWall,
        offsetMillimeters: 250,
        widthMillimeters: 90,
        heightMillimeters: 2100,
        sillHeightMillimeters: 0,
        openingKind: "door",
      },
      styleId: null,
      style,
      version: 1,
    },
    [ids.semanticWindow]: {
      id: ids.semanticWindow,
      name: "W-01",
      layerId: ids.layerSecond,
      geometry: {
        type: "opening",
        semanticVersion: 1,
        hostWallId: ids.semanticWall,
        offsetMillimeters: 650,
        widthMillimeters: 120,
        heightMillimeters: 1200,
        sillHeightMillimeters: 900,
        openingKind: "window",
      },
      styleId: null,
      style,
      version: 1,
    },
    [ids.semanticSpace]: {
      id: ids.semanticSpace,
      name: "회의실",
      layerId: ids.layerSecond,
      geometry: {
        type: "space",
        semanticVersion: 1,
        boundary: [
          { x: 120, y: 180 },
          { x: 420, y: 180 },
          { x: 420, y: 420 },
          { x: 120, y: 420 },
        ],
        number: "101",
        finishes: { floor: "타일", wall: "도장", ceiling: "텍스" },
      },
      styleId: null,
      style: { ...style, fill: "#cfe8ff" },
      version: 1,
    },
    [ids.semanticArea]: {
      id: ids.semanticArea,
      name: "외부 포장",
      layerId: ids.layerSecond,
      geometry: {
        type: "area",
        semanticVersion: 1,
        boundary: [
          { x: 520, y: 180 },
          { x: 820, y: 180 },
          { x: 820, y: 420 },
          { x: 520, y: 420 },
        ],
      },
      styleId: null,
      style: { ...style, fill: "#ffe7a3" },
      version: 1,
    },
    [ids.semanticGrid]: {
      id: ids.semanticGrid,
      name: "A",
      layerId: ids.layerSecond,
      geometry: {
        type: "grid",
        semanticVersion: 1,
        start: { x: 80, y: 500 },
        end: { x: 920, y: 500 },
      },
      styleId: null,
      style,
      version: 1,
    },
    [ids.semanticArc]: {
      id: ids.semanticArc,
      name: "처마 호",
      layerId: ids.layerSecond,
      geometry: {
        type: "arc",
        semanticVersion: 1,
        center: { x: 500, y: 560 },
        radius: 100,
        startAngleDegrees: 180,
        sweepAngleDegrees: 180,
      },
      styleId: null,
      style,
      version: 1,
    },
  });
  return document;
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

test("canonical export traversal interleaves tied layers by item id and preserves block definition order", () => {
  const document = exportFixture();
  document.structure.layers[ids.layerLocked].sortOrder = 1;
  delete document.structure.objects[ids.objectLocked];
  const tiedLayerObjectId = "00000000-0000-4000-8000-000000001059";
  document.structure.objects[tiedLayerObjectId] = {
    id: tiedLayerObjectId,
    name: "Tied layer top",
    layerId: ids.layerLocked,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 10,
      height: 10,
      rotation: 0,
    },
    styleId: null,
    style: { stroke: "#00ff00", strokeWidth: 1, fill: "#00ff00" },
    version: 1,
  };
  document.structure.blocks[ids.block].primitives = [
    {
      localId: "z-definition-first",
      name: "Definition first",
      geometry: {
        type: "rectangle",
        origin: { x: 0, y: 0 },
        width: 10,
        height: 10,
        rotation: 0,
      },
      styleId: null,
      style: { stroke: "#ff0000", strokeWidth: 1, fill: "#ff0000" },
    },
    {
      localId: "a-definition-second",
      name: "Definition second",
      geometry: {
        type: "rectangle",
        origin: { x: 0, y: 0 },
        width: 10,
        height: 10,
        rotation: 0,
      },
      styleId: null,
      style: { stroke: "#0000ff", strokeWidth: 1, fill: "#0000ff" },
    },
  ];

  assert.deepEqual(
    collectExportPrimitives(document, ids.canvasFirst).primitives.map(
      (primitive) => primitive.id,
    ),
    [
      `${ids.blockInstance}/z-definition-first`,
      `${ids.blockInstance}/a-definition-second`,
      ids.objectStyled,
      tiedLayerObjectId,
    ],
  );
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
      '<clipPath id="drawing-export-clip-0"><rect x="1" y="2" width="40" height="15.6"/></clipPath>',
      '<text x="1" y="2" clip-path="url(#drawing-export-clip-0)" fill="#112233" font-family="sans-serif" font-size="13" dominant-baseline="text-before-edge" xml:space="preserve"><tspan x="1" y="2">A&lt;&amp;&quot;&apos;&gt;</tspan></text>',
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
    /<text x="1" y="2" clip-path="url\(#drawing-export-clip-0\)" fill="#112233" font-family="sans-serif" font-size="13" dominant-baseline="text-before-edge" xml:space="preserve"><tspan x="1" y="2">A&amp;B<\/tspan><tspan x="1" y="17\.6">C&lt;D<\/tspan><\/text>/,
  );
});

test("SVG text uses deterministic fixed-width clipping for long multiline content", () => {
  const document = exportFixture();
  document.structure.objects[ids.objectSecond].geometry.text =
    "A very long first line that must not be condensed\nsecond line";
  const svg = exportDrawingSvg(document, ids.canvasSecond);

  assert.match(
    svg,
    /<clipPath id="drawing-export-clip-0"><rect x="1" y="2" width="40" height="31\.2"\/><\/clipPath>/,
  );
  assert.match(svg, /<text [^>]*clip-path="url\(#drawing-export-clip-0\)"/);
  assert.doesNotMatch(svg, /<text[^>]*\swidth=/);
  assert.match(
    svg,
    />A very long first line that must not be condensed<\/tspan>/,
  );
  assert.match(svg, />second line<\/tspan>/);
});

test("SVG export rejects XML 1.0-invalid C0 controls without stripping text", () => {
  const document = exportFixture();
  document.structure.objects[ids.objectSecond].geometry.text =
    "semantic\u0001text";

  assert.throws(
    () => exportDrawingSvg(document, ids.canvasSecond),
    /XML 1\.0-invalid control character/i,
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

test("P4 mixed geometry has one canonical SVG PNG and PDF render plan", async () => {
  const document = semanticExportFixture();
  const before = structuredClone(document);
  const traversal = collectExportPrimitives(document, ids.canvasSecond);
  const semantic = traversal.primitives.filter((primitive) =>
    ["wall", "opening", "space", "area", "grid", "arc"].includes(
      primitive.geometry.type,
    ),
  );
  assert.equal(semantic.length, 7);
  for (const primitive of semantic) {
    const bounds = geometryBounds(
      primitive.geometry,
      document.structure.objects,
    );
    assert.ok(
      [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite),
      primitive.geometry.type,
    );
  }
  assert.deepEqual(
    resolveDrawingOpening(
      document.structure.objects[ids.semanticDoor].geometry,
      document.structure.objects,
    ).center,
    { x: 350, y: 100 },
  );

  const svg = exportDrawingSvg(document, ids.canvasSecond);
  assert.equal((svg.match(/data-semantic-type=/g) ?? []).length, 7);
  assert.match(svg, /101 · 회의실/);
  assert.match(svg, /외부 포장/);
  assert.match(svg, />A<\/text>/);
  assert.match(svg, /stroke-width="18"/);
  assert.match(svg, /fill="#cfe8ff"/);
  assert.match(svg, /stroke-dasharray="16 8"/);

  const canvas = fakeCanvas({ pngBytes: onePixelPng });
  const png = await exportDrawingPng(document, ids.canvasSecond, {
    canvasFactory: () => canvas,
    includeBackground: false,
    scale: 1,
  });
  assert.ok(png.size > 0);
  assert.deepEqual(
    canvas.calls
      .filter(([name]) => name === "fillText")
      .map(([, text]) => text)
      .filter((text) => ["101 · 회의실", "외부 포장", "A"].includes(text)),
    ["101 · 회의실", "외부 포장", "A"],
  );
  assert.ok(canvas.calls.some(([name]) => name === "setLineDash"));

  const pdfBytes = await exportDrawingPdf(document, {
    canvasFactory: () => fakeCanvas({ pngBytes: onePixelPng }),
    canvasIds: [ids.canvasSecond],
    createdAt: "2026-08-26T00:00:00.000Z",
    scale: 1,
    title: "P4 semantic export",
  });
  assert.ok(pdfBytes.byteLength > onePixelPng.byteLength);
  assert.equal((await PDFDocument.load(pdfBytes)).getPageCount(), 1);
  assert.deepEqual(document, before);
});

test("P4 export rejects an unresolved hosted opening before any partial artifact work", async () => {
  const document = semanticExportFixture();
  document.structure.objects[ids.semanticDoor].geometry.hostWallId =
    "00000000-0000-4000-8000-000000001099";
  let canvasCreations = 0;
  let backgroundReads = 0;

  assert.throws(
    () => exportDrawingSvg(document, ids.canvasSecond),
    /host wall|host.*exist/i,
  );
  await assert.rejects(
    exportDrawingPng(document, ids.canvasSecond, {
      canvasFactory: () => {
        canvasCreations++;
        return fakeCanvas();
      },
      scale: 1,
    }),
    /host wall|host.*exist/i,
  );
  await assert.rejects(
    exportDrawingPdf(document, {
      canvasFactory: () => {
        canvasCreations++;
        return fakeCanvas({ pngBytes: onePixelPng });
      },
      canvasIds: [ids.canvasSecond],
      createdAt: "2026-08-26T00:00:00.000Z",
      getBackground: async () => {
        backgroundReads++;
        return undefined;
      },
      scale: 1,
      title: "Invalid P4 semantic export",
    }),
    /host wall|host.*exist/i,
  );
  assert.equal(canvasCreations, 0);
  assert.equal(backgroundReads, 0);
});

test("PNG text clips to the fixed layout and draws uncompressed multiline text", async () => {
  const document = exportFixture();
  document.structure.objects[ids.objectSecond].geometry.text =
    "A very long first line that must not be condensed\nsecond line";
  const canvas = fakeCanvas();

  await exportDrawingPng(document, ids.canvasSecond, {
    canvasFactory: () => canvas,
    scale: 1,
  });

  assert.deepEqual(
    canvas.calls.filter(([name]) => name === "rect"),
    [["rect", 1, 2, 40, 31.2]],
  );
  assert.equal(canvas.calls.filter(([name]) => name === "clip").length, 1);
  assert.deepEqual(
    canvas.calls.filter(([name]) => name === "fillText"),
    [
      ["fillText", "A very long first line that must not be condensed", 1, 2],
      ["fillText", "second line", 1, 17.6],
    ],
  );
});

test("dimension export uses page calibration identity for direct and transformed block geometry", async () => {
  const document = exportFixture();
  document.structure.canvases[ids.canvasFirst].background.calibration = {
    millimetersPerNormalizedUnit: 1000,
  };
  document.structure.objects[ids.objectStyled].geometry = {
    type: "dimension",
    start: { x: 0, y: 0 },
    end: { x: 21, y: 0 },
    offset: 5,
    calibrationId: ids.pageFirst,
  };
  document.structure.objects[ids.objectLocked].geometry = {
    type: "dimension",
    start: { x: 0, y: 20 },
    end: { x: 21, y: 20 },
    offset: 5,
    calibrationId: ids.pageSecond,
  };
  document.structure.blocks[ids.block].primitives = [
    {
      localId: "dimension",
      name: "Block dimension",
      geometry: {
        type: "dimension",
        start: { x: 0, y: 0 },
        end: { x: 21, y: 0 },
        offset: 5,
        calibrationId: ids.pageFirst,
      },
      styleId: ids.style,
      style: {},
    },
  ];

  const svg = exportDrawingSvg(document, ids.canvasFirst);
  assert.equal(svg.match(/>100\.0 mm<\/tspan>/g)?.length, 2);
  assert.match(svg, />보정 확인 불가<\/tspan>/);
  assert.match(
    svg,
    new RegExp(
      `data-export-id="${ids.blockInstance}/dimension" transform="matrix\\(0 2 -1 0 100 120\\)"`,
    ),
  );

  const canvas = fakeCanvas();
  await exportDrawingPng(document, ids.canvasFirst, {
    background: {
      bounds: { x: 0, y: 0, width: 210, height: 297 },
      canvas: fakeCanvas(),
      sourceFileId: ids.source,
      sourceSha256: "a".repeat(64),
      pdfPageNumber: 2,
    },
    canvasFactory: () => canvas,
    scale: 1,
  });
  assert.equal(
    canvas.calls.filter(
      ([name, text]) => name === "fillText" && text === "100.0 mm",
    ).length,
    2,
  );
  assert.equal(
    canvas.calls.some(
      ([name, text]) => name === "fillText" && text === "보정 확인 불가",
    ),
    true,
  );
  assert.equal(
    canvas.calls.some(
      ([name, a, b, c, d, e, f]) =>
        name === "transform" &&
        a === 0 &&
        b === 2 &&
        c === -1 &&
        d === 0 &&
        e === 100 &&
        f === 120,
    ),
    true,
  );
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

test("PNG export intentionally excludes canonical background metadata when requested", async () => {
  const canvas = fakeCanvas();
  const blob = await exportDrawingPng(exportFixture(), ids.canvasFirst, {
    canvasFactory: () => canvas,
    includeBackground: false,
    scale: 1,
  });

  assert.equal(blob.type, "image/png");
  assert.equal(
    canvas.calls.some(([name]) => name === "drawImage"),
    false,
  );
  assert.deepEqual(
    canvas.calls.find(([name]) => name === "fillRect")?.slice(1),
    [0, 0, 210, 297],
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

test("PNG encoding rejects promptly when the export signal is cancelled", async () => {
  const controller = new AbortController();
  const canvas = fakeCanvas();
  canvas.toBlob = (callback) => {
    setTimeout(() => callback(new Blob(["late"], { type: "image/png" })), 25);
  };
  const pending = exportDrawingPng(exportFixture(), ids.canvasSecond, {
    canvasFactory: () => canvas,
    scale: 1,
    signal: controller.signal,
  });

  controller.abort();
  await assert.rejects(pending, /cancel/i);
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

test("PDF export propagates one cancellation signal through background work", async () => {
  const controller = new AbortController();
  let receivedSignal;
  const pending = exportDrawingPdf(exportFixture(), {
    canvasFactory: () => fakeCanvas({ pngBytes: onePixelPng }),
    createdAt: "2026-08-25T09:00:00.000Z",
    getBackground: async (_canvas, signal) => {
      receivedSignal = signal;
      controller.abort();
      return undefined;
    },
    scale: 1,
    signal: controller.signal,
    title: "Cancelled",
  });

  await assert.rejects(pending, /cancel/i);
  assert.equal(receivedSignal, controller.signal);
});

test("PDF export races non-cancellable image embedding work against cancellation", async () => {
  const controller = new AbortController();
  let imageReadStarted;
  const started = new Promise((resolve) => {
    imageReadStarted = resolve;
  });
  const canvas = fakeCanvas();
  canvas.toBlob = (callback) =>
    callback({
      arrayBuffer() {
        imageReadStarted();
        return new Promise(() => {});
      },
      type: "image/png",
    });
  const pending = exportDrawingPdf(exportFixture(), {
    canvasFactory: () => canvas,
    canvasIds: [ids.canvasSecond],
    createdAt: "2026-08-25T09:00:00.000Z",
    scale: 1,
    signal: controller.signal,
    title: "Cancelled image embedding",
  });
  await started;
  controller.abort();

  assert.equal(
    await Promise.race([
      pending.then(
        () => "resolved",
        (error) => (error instanceof Error ? error.message : String(error)),
      ),
      new Promise((resolve) => setTimeout(() => resolve("stalled"), 25)),
    ]),
    "Drawing export was cancelled.",
  );
});

test("real browser export preserves source evidence and renders ordered SVG, PNG, and PDF pixels", async () => {
  const document = exportFixture();
  const firstCanvas = document.structure.canvases[ids.canvasFirst];
  firstCanvas.widthMillimeters = 100;
  firstCanvas.heightMillimeters = 60;
  firstCanvas.background.pdfPageNumber = 1;
  firstCanvas.background.calibration = {
    millimetersPerNormalizedUnit: 500,
  };
  const secondCanvas = document.structure.canvases[ids.canvasSecond];
  secondCanvas.widthMillimeters = 80;
  secondCanvas.heightMillimeters = 40;
  document.structure.layers[ids.layerLocked].sortOrder = 1;
  document.structure.objects[ids.objectLocked].geometry = {
    type: "dimension",
    start: { x: 5, y: 35 },
    end: { x: 25, y: 35 },
    offset: 5,
    calibrationId: ids.pageFirst,
  };
  document.structure.objects[ids.objectLocked].style = {
    stroke: "#111111",
    strokeWidth: 1,
    fill: null,
  };
  document.structure.blockInstances[ids.blockInstance] = {
    ...document.structure.blockInstances[ids.blockInstance],
    origin: { x: 5, y: 5 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
  };
  document.structure.blocks[ids.block].primitives = [
    {
      localId: "z-definition-first",
      name: "Red definition first",
      geometry: {
        type: "rectangle",
        origin: { x: 0, y: 0 },
        width: 15,
        height: 15,
        rotation: 0,
      },
      styleId: null,
      style: { stroke: "#ff0000", strokeWidth: 1, fill: "#ff0000" },
    },
    {
      localId: "a-definition-second",
      name: "Blue definition second",
      geometry: {
        type: "rectangle",
        origin: { x: 0, y: 0 },
        width: 15,
        height: 15,
        rotation: 0,
      },
      styleId: null,
      style: { stroke: "#0000ff", strokeWidth: 1, fill: "#0000ff" },
    },
  ];
  document.structure.objects[ids.objectStyled].geometry = {
    type: "rectangle",
    origin: { x: 30, y: 5 },
    width: 15,
    height: 15,
    rotation: 0,
  };
  document.structure.objects[ids.objectStyled].styleId = null;
  document.structure.objects[ids.objectStyled].style = {
    stroke: "#ff0000",
    strokeWidth: 1,
    fill: "#ff0000",
  };
  const tiedLayerObjectId = "00000000-0000-4000-8000-000000001059";
  document.structure.objects[tiedLayerObjectId] = {
    id: tiedLayerObjectId,
    name: "Green tied-layer top",
    layerId: ids.layerLocked,
    geometry: {
      type: "rectangle",
      origin: { x: 30, y: 5 },
      width: 15,
      height: 15,
      rotation: 0,
    },
    styleId: null,
    style: { stroke: "#00ff00", strokeWidth: 1, fill: "#00ff00" },
    version: 1,
  };
  document.structure.objects[ids.objectSecond].geometry = {
    type: "text",
    origin: { x: 2, y: 2 },
    width: 20,
    text: "WWWWWWWWWWWWWWWW\nSECOND LINE",
  };
  document.structure.objects[ids.objectSecond].style = {
    stroke: "#111111",
    strokeWidth: 1,
    fill: "#111111",
    fontSize: 10,
  };
  const secondMarkerId = "00000000-0000-4000-8000-000000001060";
  document.structure.objects[secondMarkerId] = {
    id: secondMarkerId,
    name: "Second page marker",
    layerId: ids.layerSecond,
    geometry: {
      type: "rectangle",
      origin: { x: 50, y: 20 },
      width: 20,
      height: 15,
      rotation: 0,
    },
    styleId: null,
    style: { stroke: "#ff00ff", strokeWidth: 1, fill: "#ff00ff" },
    version: 1,
  };

  const sourcePdf = await PDFDocument.create();
  sourcePdf
    .addPage([100, 60])
    .drawRectangle({ x: 0, y: 0, width: 100, height: 60, color: rgb(1, 1, 0) });
  const sourceBytes = Buffer.from(await sourcePdf.save());
  const sourceSha256 = createHash("sha256").update(sourceBytes).digest("hex");
  firstCanvas.background.sourceSha256 = sourceSha256;
  const sourceEvidence = {
    documentSourceSha256: sourceSha256,
    file: {
      byteSize: sourceBytes.length,
      id: ids.source,
      immutable: true,
      sha256: sourceSha256,
      storagePath: "drawing-fixtures/source.pdf",
    },
  };
  const serverRequests = [];

  const vite = await createServer({
    appType: "custom",
    cacheDir: new URL(
      "../node_modules/.vite-drawing-export-test",
      import.meta.url,
    ).pathname,
    clearScreen: false,
    configFile: false,
    logLevel: "silent",
    optimizeDeps: {
      include: [
        "@pdf-lib/standard-fonts",
        "@pdf-lib/upng",
        "pdf-lib",
        "pdfjs-dist",
        "zod",
      ],
    },
    resolve: {
      alias: { "~": new URL("../app", import.meta.url).pathname },
    },
    plugins: [
      {
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            serverRequests.push({ method: request.method, url: request.url });
            if (request.url === "/drawing-export-source.pdf") {
              response.statusCode = 200;
              response.setHeader("Content-Type", "application/pdf");
              response.setHeader("Content-Length", String(sourceBytes.length));
              response.end(sourceBytes);
              return;
            }
            if (request.url === "/drawing-export-test.html") {
              response.statusCode = 200;
              response.setHeader("Content-Type", "text/html");
              response.end("<!doctype html><title>Drawing export test</title>");
              return;
            }
            next();
          });
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
    await vite.waitForRequestsIdle();
    const address = vite.httpServer.address();
    assert.equal(typeof address, "object");
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`${origin}/drawing-export-test.html`);
    const result = await page.evaluate(
      async ({ documentState, evidence, origin }) => {
        const exportModule = await import(
          `${origin}/app/lukas/lib/drawing-export.ts`
        );
        const renderer = await import(
          `${origin}/app/lukas/lib/pdf-page-renderer.client.ts`
        );
        const sourceUrl = `${origin}/drawing-export-source.pdf`;
        const sha256 = async (bytes) =>
          [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
            .map((value) => value.toString(16).padStart(2, "0"))
            .join("");
        const sourceBefore = await (await fetch(sourceUrl)).arrayBuffer();
        const evidenceBefore = JSON.stringify(evidence);
        const storageBefore = JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        });
        Object.freeze(evidence.file);
        Object.freeze(evidence);

        const openedSource = await renderer.openPdfDocument(sourceUrl);
        const sourceCanvas = document.createElement("canvas");
        const sourceRender = await renderer.renderPdfPageToCanvas({
          canvas: sourceCanvas,
          document: openedSource.document,
          hostWidth: 100,
          pageNumber: 1,
          zoom: 1,
        });
        const background = {
          bounds: { x: 0, y: 0, width: 100, height: 60 },
          canvas: sourceCanvas,
          pdfPageNumber: 1,
          sourceFileId: evidence.file.id,
          sourceSha256: evidence.file.sha256,
        };
        const includedPng = await exportModule.exportDrawingPng(
          documentState,
          documentState.structure.canvases[
            "00000000-0000-4000-8000-000000001020"
          ].id,
          { background, includeBackground: true, scale: 2 },
        );
        const excludedPng = await exportModule.exportDrawingPng(
          documentState,
          "00000000-0000-4000-8000-000000001020",
          { includeBackground: false, scale: 2 },
        );
        const secondPng = await exportModule.exportDrawingPng(
          documentState,
          "00000000-0000-4000-8000-000000001021",
          { includeBackground: false, scale: 2 },
        );
        const decode = async (blob) => {
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          return { canvas, context };
        };
        const sample = (decoded, x, y, logicalWidth, logicalHeight) => [
          ...decoded.context.getImageData(
            Math.floor((x / logicalWidth) * decoded.canvas.width),
            Math.floor((y / logicalHeight) * decoded.canvas.height),
            1,
            1,
          ).data,
        ];
        const inkCount = (
          decoded,
          bounds,
          logicalWidth,
          logicalHeight,
          backgroundColor,
        ) => {
          const left = Math.floor(
            (bounds.x / logicalWidth) * decoded.canvas.width,
          );
          const top = Math.floor(
            (bounds.y / logicalHeight) * decoded.canvas.height,
          );
          const right = Math.ceil(
            ((bounds.x + bounds.width) / logicalWidth) * decoded.canvas.width,
          );
          const bottom = Math.ceil(
            ((bounds.y + bounds.height) / logicalHeight) *
              decoded.canvas.height,
          );
          const pixels = decoded.context.getImageData(
            left,
            top,
            Math.max(1, right - left),
            Math.max(1, bottom - top),
          ).data;
          let count = 0;
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index] !== backgroundColor[0] ||
              pixels[index + 1] !== backgroundColor[1] ||
              pixels[index + 2] !== backgroundColor[2]
            )
              count += 1;
          }
          return count;
        };
        const included = await decode(includedPng);
        const excluded = await decode(excludedPng);
        const second = await decode(secondPng);

        const secondSvg = exportModule.exportDrawingSvg(
          documentState,
          "00000000-0000-4000-8000-000000001021",
        );
        const parsedSvg = new DOMParser().parseFromString(
          secondSvg,
          "image/svg+xml",
        );
        const svgBlob = new Blob([secondSvg], { type: "image/svg+xml" });
        const svgUrl = URL.createObjectURL(svgBlob);
        const svgImage = new Image();
        svgImage.src = svgUrl;
        await svgImage.decode();
        const svgCanvas = document.createElement("canvas");
        svgCanvas.width = 160;
        svgCanvas.height = 80;
        const svgContext = svgCanvas.getContext("2d", {
          willReadFrequently: true,
        });
        svgContext.drawImage(svgImage, 0, 0, 160, 80);
        URL.revokeObjectURL(svgUrl);
        const svgDecoded = { canvas: svgCanvas, context: svgContext };

        const pdfBytes = await exportModule.exportDrawingPdf(documentState, {
          createdAt: "2026-08-25T09:00:00.000Z",
          getBackground: async (canvas) =>
            canvas.id === "00000000-0000-4000-8000-000000001020"
              ? background
              : undefined,
          scale: 2,
          title: "Browser evidence",
        });
        const pdfUrl = URL.createObjectURL(
          new Blob([pdfBytes], { type: "application/pdf" }),
        );
        const openedPdf = await renderer.openPdfDocument(pdfUrl);
        const pdfPages = [];
        for (
          let pageNumber = 1;
          pageNumber <= openedPdf.document.numPages;
          pageNumber += 1
        ) {
          const canvas = document.createElement("canvas");
          const rendered = await renderer.renderPdfPageToCanvas({
            canvas,
            document: openedPdf.document,
            hostWidth: 400,
            pageNumber,
            zoom: 1,
          });
          const context = canvas.getContext("2d", { willReadFrequently: true });
          pdfPages.push({
            canvasSize: rendered.canvasSize,
            dimensionInk:
              pageNumber === 1
                ? inkCount(
                    { canvas, context },
                    { x: 15, y: 40, width: 58, height: 15 },
                    100,
                    60,
                    [255, 255, 0],
                  )
                : 0,
            marker:
              pageNumber === 1
                ? sample({ canvas, context }, 35, 10, 100, 60)
                : sample({ canvas, context }, 60, 27, 80, 40),
          });
          rendered.cleanup();
        }
        await openedPdf.destroy();
        URL.revokeObjectURL(pdfUrl);

        sourceRender.cleanup();
        await openedSource.destroy();
        const sourceAfter = await (await fetch(sourceUrl)).arrayBuffer();
        return {
          backgroundPixels: {
            excludedCorner: sample(excluded, 1, 1, 100, 60),
            includedCorner: sample(included, 1, 1, 100, 60),
          },
          orderPixels: {
            blockDefinition: sample(included, 10, 10, 100, 60),
            tiedLayer: sample(included, 35, 10, 100, 60),
          },
          dimensionInk: inkCount(
            included,
            { x: 15, y: 40, width: 58, height: 15 },
            100,
            60,
            [255, 255, 0],
          ),
          pdfPages,
          source: {
            bytesEqual:
              sourceBefore.byteLength === sourceAfter.byteLength &&
              new Uint8Array(sourceBefore).every(
                (value, index) => value === new Uint8Array(sourceAfter)[index],
              ),
            evidenceAfter: JSON.stringify(evidence),
            evidenceBefore,
            shaAfter: await sha256(sourceAfter),
            shaBefore: await sha256(sourceBefore),
            storageAfter: JSON.stringify({
              local: { ...localStorage },
              session: { ...sessionStorage },
            }),
            storageBefore,
          },
          svg: {
            clipHeight: parsedSvg
              .querySelector("clipPath rect")
              ?.getAttribute("height"),
            clipWidth: parsedSvg
              .querySelector("clipPath rect")
              ?.getAttribute("width"),
            marker: sample(svgDecoded, 60, 27, 80, 40),
            parserErrors: parsedSvg.querySelectorAll("parsererror").length,
            rightOfTextClip: sample(svgDecoded, 30, 8, 80, 40),
          },
          textPixels: {
            pngFirstLineInk: inkCount(
              second,
              { x: 2, y: 2, width: 20, height: 11 },
              80,
              40,
              [255, 255, 255],
            ),
            pngRightOfClip: sample(second, 30, 8, 80, 40),
            pngSecondLineInk: inkCount(
              second,
              { x: 2, y: 13, width: 20, height: 12 },
              80,
              40,
              [255, 255, 255],
            ),
            svgFirstLineInk: inkCount(
              svgDecoded,
              { x: 2, y: 2, width: 20, height: 11 },
              80,
              40,
              [255, 255, 255],
            ),
            svgSecondLineInk: inkCount(
              svgDecoded,
              { x: 2, y: 13, width: 20, height: 12 },
              80,
              40,
              [255, 255, 255],
            ),
          },
        };
      },
      {
        documentState: document,
        evidence: sourceEvidence,
        origin,
      },
    );
    assert.deepEqual(
      result.backgroundPixels.includedCorner,
      [255, 255, 0, 255],
    );
    assert.deepEqual(
      result.backgroundPixels.excludedCorner,
      [255, 255, 255, 255],
    );
    const assertVectorEvidence = (pixels) => {
      assert.deepEqual(pixels.blockDefinition, [0, 0, 255, 255]);
      assert.deepEqual(pixels.tiedLayer, [0, 255, 0, 255]);
    };
    assertVectorEvidence(result.orderPixels);
    assert.throws(() =>
      assertVectorEvidence({
        blockDefinition: [255, 255, 255, 255],
        tiedLayer: result.orderPixels.tiedLayer,
      }),
    );
    assert.ok(result.dimensionInk > 10);
    assert.equal(result.svg.parserErrors, 0);
    assert.equal(result.svg.clipWidth, "20");
    assert.equal(result.svg.clipHeight, "24");
    assert.deepEqual(result.svg.rightOfTextClip, [255, 255, 255, 255]);
    assert.deepEqual(result.textPixels.pngRightOfClip, [255, 255, 255, 255]);
    assert.ok(result.textPixels.pngFirstLineInk > 5);
    assert.ok(result.textPixels.pngSecondLineInk > 5);
    assert.ok(result.textPixels.svgFirstLineInk > 5);
    assert.ok(result.textPixels.svgSecondLineInk > 5);
    assert.deepEqual(result.svg.marker, [255, 0, 255, 255]);
    const assertPageEvidence = (pages) => {
      assert.equal(pages.length, 2);
      assert.ok(Math.abs(pages[0].canvasSize.width - 400) < 0.01);
      assert.ok(Math.abs(pages[0].canvasSize.height - 240) < 0.01);
      assert.ok(Math.abs(pages[1].canvasSize.width - 400) < 0.01);
      assert.ok(Math.abs(pages[1].canvasSize.height - 200) < 0.01);
      assert.deepEqual(pages[0].marker, [0, 255, 0, 255]);
      assert.deepEqual(pages[1].marker, [255, 0, 255, 255]);
      assert.ok(pages[0].dimensionInk > 10);
    };
    assertPageEvidence(result.pdfPages);
    assert.throws(() =>
      assertPageEvidence([result.pdfPages[1], result.pdfPages[0]]),
    );
    assert.throws(() =>
      assertPageEvidence([result.pdfPages[0], result.pdfPages[0]]),
    );
    assert.throws(() =>
      assertPageEvidence([
        { ...result.pdfPages[0], marker: [255, 255, 255, 255] },
        { ...result.pdfPages[1], marker: [255, 255, 255, 255] },
      ]),
    );
    assert.equal(result.source.bytesEqual, true);
    assert.equal(result.source.shaBefore, sourceSha256);
    assert.equal(result.source.shaAfter, sourceSha256);
    assert.equal(result.source.evidenceBefore, result.source.evidenceAfter);
    assert.equal(result.source.storageBefore, result.source.storageAfter);
    assert.equal(
      serverRequests.some(({ method }) => method !== "GET"),
      false,
      JSON.stringify(serverRequests),
    );
  } finally {
    await browser?.close();
    await vite.close();
  }
});

export { exportFixture, ids };
