import assert from "node:assert/strict";
import test from "node:test";

import { validateDrawingStructureState } from "../app/lukas/lib/drawing-structure.ts";
import {
  DrawingObjectSourceSchema,
  IfcCameraStateSchema,
} from "../app/lukas/lib/drawing-workspace.types.ts";

const ids = {
  revision: "00000000-0000-4000-8000-000000000001",
  page: "00000000-0000-4000-8000-000000000002",
  canvas: "00000000-0000-4000-8000-000000000003",
  layer: "00000000-0000-4000-8000-000000000004",
  object: "00000000-0000-4000-8000-000000000005",
  source: "00000000-0000-4000-8000-000000000006",
  source2: "00000000-0000-4000-8000-000000000007",
  file: "00000000-0000-4000-8000-000000000008",
};

const sha = "a".repeat(64);

function pdfSource(overrides = {}) {
  return {
    id: ids.source,
    objectId: ids.object,
    revisionId: ids.revision,
    sourceFileId: ids.file,
    sourceSha256: sha,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    version: 1,
    ...overrides,
  };
}

function ifcSource(overrides = {}) {
  return {
    id: ids.source,
    objectId: ids.object,
    revisionId: ids.revision,
    sourceFileId: ids.file,
    sourceSha256: sha,
    sourceKind: "ifc_element",
    ifcGlobalId: "3ABCdefghijklmnopqrstu",
    elementId: "42",
    camera: {
      position: [1.1234567, 2, 3],
      target: [4, 5.7654321, 6],
    },
    version: 1,
    ...overrides,
  };
}

function structure(sources) {
  return {
    revisionId: ids.revision,
    pages: {
      [ids.page]: {
        id: ids.page,
        revisionId: ids.revision,
        name: "Page 1",
        sortOrder: 0,
        version: 1,
      },
    },
    canvases: {
      [ids.canvas]: {
        id: ids.canvas,
        pageId: ids.page,
        name: "Paper",
        spaceKind: "paper",
        widthMillimeters: 210,
        heightMillimeters: 297,
        background: null,
        sortOrder: 0,
        version: 1,
      },
    },
    layers: {
      [ids.layer]: {
        id: ids.layer,
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        canvasId: ids.canvas,
        sortOrder: 0,
        version: 1,
      },
    },
    objects: {
      [ids.object]: {
        id: ids.object,
        name: "Rectangle",
        layerId: ids.layer,
        geometry: {
          type: "rectangle",
          origin: { x: 0, y: 0 },
          width: 20,
          height: 10,
          rotation: 0,
        },
        style: { stroke: "#111111", strokeWidth: 1, fill: null },
        version: 1,
      },
    },
    sources,
    styles: {},
    blocks: {},
    blockInstances: {},
    propertySchemas: {},
    propertyValues: {},
    tables: {},
  };
}

test("DrawingObjectSource accepts only the exact PDF and IFC evidence keys", () => {
  assert.deepEqual(DrawingObjectSourceSchema.parse(pdfSource()), pdfSource());
  assert.deepEqual(DrawingObjectSourceSchema.parse(ifcSource()), {
    ...ifcSource(),
    camera: {
      position: [1.123457, 2, 3],
      target: [4, 5.765432, 6],
    },
  });

  for (const excluded of [
    "signedUrl",
    "rendererId",
    "viewportPixels",
    "markers",
  ])
    assert.equal(
      DrawingObjectSourceSchema.safeParse({
        ...pdfSource(),
        [excluded]: "leak",
      }).success,
      false,
    );
});

test("source hashes, GlobalIds, cameras, and normalized regions are canonical", () => {
  assert.equal(
    DrawingObjectSourceSchema.safeParse(
      pdfSource({ sourceSha256: "A".repeat(64) }),
    ).success,
    false,
  );
  for (const ifcGlobalId of [
    "3ABCdefghijklmnopqrstu ",
    "3ABCdefghijklmnopqrst",
    "3ABCdefghijklmnopqrstuv",
    "3ABCdefghijklmnopqrstu-",
  ])
    assert.equal(
      DrawingObjectSourceSchema.safeParse(ifcSource({ ifcGlobalId })).success,
      false,
    );
  assert.equal(
    DrawingObjectSourceSchema.parse(ifcSource()).ifcGlobalId,
    "3ABCdefghijklmnopqrstu",
  );
  assert.equal(
    DrawingObjectSourceSchema.safeParse(
      ifcSource({ camera: { position: [Infinity, 0, 0], target: [0, 0, 0] } }),
    ).success,
    false,
  );

  for (const region of [
    { x: -0.01 },
    { y: 1 },
    { width: 0 },
    { height: 0 },
    { x: 0.8, width: 0.3 },
    { y: 0.7, height: 0.4 },
  ])
    assert.equal(
      DrawingObjectSourceSchema.safeParse(pdfSource(region)).success,
      false,
    );
  assert.equal(
    DrawingObjectSourceSchema.safeParse(
      pdfSource({ x: 0.75, y: 0.75, width: 0.25, height: 0.25 }),
    ).success,
    true,
  );
});

test("camera canonicalization cannot turn finite input into non-finite evidence", () => {
  const overflowing = {
    position: [Number.MAX_VALUE, 0, 0],
    target: [0, 0, 0],
  };
  assert.equal(IfcCameraStateSchema.safeParse(overflowing).success, false);
  assert.equal(
    DrawingObjectSourceSchema.safeParse(ifcSource({ camera: overflowing }))
      .success,
    false,
  );

  const bounded = IfcCameraStateSchema.parse({
    position: [999_999_999_999, 0, 0],
    target: [0, 0, 0],
  });
  assert.equal(Number.isFinite(bounded.position[0]), true);
  assert.equal(JSON.stringify(bounded).includes("null"), false);
});

test("source-map validation checks final object/revision identity and active uniqueness", () => {
  assert.doesNotThrow(() =>
    validateDrawingStructureState(structure({ [ids.source]: pdfSource() })),
  );
  assert.throws(() =>
    validateDrawingStructureState(structure({ wrong: pdfSource() })),
  );
  assert.throws(() =>
    validateDrawingStructureState(
      structure({ [ids.source]: pdfSource({ objectId: ids.source2 }) }),
    ),
  );
  assert.throws(() =>
    validateDrawingStructureState(
      structure({
        [ids.source]: pdfSource({ revisionId: ids.source2 }),
      }),
    ),
  );
  assert.throws(() =>
    validateDrawingStructureState(
      structure({
        [ids.source]: pdfSource(),
        [ids.source2]: pdfSource({ id: ids.source2 }),
      }),
    ),
  );
  assert.throws(() =>
    validateDrawingStructureState(
      structure({
        [ids.object]: pdfSource({ id: ids.object }),
      }),
    ),
  );
});

test("source canonical comparison ignores key order but detects value normalization and shape changes", () => {
  const canonical = ifcSource({
    camera: { position: [1.123457, 2, 3], target: [4, 5.765432, 6] },
  });
  const reordered = Object.fromEntries(
    Object.entries({
      ...canonical,
      camera: Object.fromEntries(Object.entries(canonical.camera).reverse()),
    }).reverse(),
  );
  assert.doesNotThrow(() =>
    validateDrawingStructureState(structure({ [ids.source]: reordered })),
  );

  assert.throws(() =>
    validateDrawingStructureState(structure({ [ids.source]: ifcSource() })),
  );
  assert.equal(
    DrawingObjectSourceSchema.safeParse({ ...pdfSource(), width: undefined })
      .success,
    false,
  );
  assert.equal(
    DrawingObjectSourceSchema.safeParse({ ...pdfSource(), signedUrl: "leak" })
      .success,
    false,
  );
  assert.throws(() =>
    validateDrawingStructureState(
      structure({
        [ids.source]: pdfSource({ sourceSha256: "A".repeat(64) }),
      }),
    ),
  );
  assert.throws(() =>
    validateDrawingStructureState(
      structure({ [ids.source]: pdfSource({ x: 0.9, width: 0.2 }) }),
    ),
  );
});
