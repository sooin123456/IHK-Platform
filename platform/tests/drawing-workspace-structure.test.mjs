import assert from "node:assert/strict";
import test from "node:test";
import {
  applyDrawingStructureActions,
  DrawingStructureError,
  resolveDrawingStyle,
} from "../app/lukas/lib/drawing-structure.ts";
import {
  createDrawingCanvasCommand,
  createDrawingLayerCommand,
  deleteDrawingPageCommand,
  drawingPageDeletionReason,
  reorderDrawingCanvasCommand,
  createDrawingPageCommand,
  deleteDrawingCanvasCommand,
  reorderDrawingLayerCommand,
  applyDrawingCommand,
  undoDrawingCommand,
  redoDrawingCommand,
} from "../app/lukas/lib/drawing-commands.ts";
import { createDrawingActiveCanvasSliceCache } from "../app/lukas/lib/drawing-document-store.ts";
import { nextDrawingCanvasFocusIntent } from "../app/lukas/lib/drawing-pages-focus.ts";
import {
  DrawingBlockInstanceSchema,
  DrawingObjectSchema,
  DrawingPropertyValueSchema,
  DrawingStructureActionSchema,
  DrawingTableSchema,
} from "../app/lukas/lib/drawing-workspace.types.ts";

const ids = {
  revision: "00000000-0000-4000-8000-000000000001",
  page: "00000000-0000-4000-8000-000000000002",
  canvas: "00000000-0000-4000-8000-000000000003",
  layer: "00000000-0000-4000-8000-000000000004",
  object: "00000000-0000-4000-8000-000000000005",
  style: "00000000-0000-4000-8000-000000000006",
  block: "00000000-0000-4000-8000-000000000007",
  instance: "00000000-0000-4000-8000-000000000008",
  modelCanvas: "00000000-0000-4000-8000-000000000009",
  modelLayer: "00000000-0000-4000-8000-000000000010",
};

function canvas(overrides = {}) {
  return {
    id: ids.canvas,
    pageId: ids.page,
    name: "Paper",
    spaceKind: "paper",
    widthMillimeters: 210,
    heightMillimeters: 297,
    background: null,
    sortOrder: 0,
    version: 1,
    ...overrides,
  };
}

function object(overrides = {}) {
  return {
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
    styleId: ids.style,
    style: { fill: "#ffffff" },
    version: 1,
    ...overrides,
  };
}

function state(overrides = {}) {
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
    canvases: {},
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
    objects: {},
    styles: {
      [ids.style]: {
        id: ids.style,
        revisionId: ids.revision,
        name: "Default",
        value: { stroke: "#111111", strokeWidth: 2, fill: null, fontSize: 12 },
        version: 1,
      },
    },
    blocks: {},
    blockInstances: {},
    propertySchemas: {},
    propertyValues: {},
    tables: {},
    ...overrides,
  };
}

test("canonical block instances require immutable lineage", () => {
  const instance = {
    id: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Required lineage",
    origin: { x: 0, y: 0 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };
  assert.equal(DrawingBlockInstanceSchema.safeParse(instance).success, false);
  assert.equal(
    DrawingBlockInstanceSchema.safeParse({
      ...instance,
      lineageId: instance.id,
    }).success,
    true,
  );
});

test("structure actions reject unknown fields and restore exact prior entities", () => {
  const action = { kind: "put_canvas", entity: canvas(), baseVersion: null };
  const layerAction = {
    kind: "put_layer",
    entity: state().layers[ids.layer],
    baseVersion: null,
  };
  const applied = applyDrawingStructureActions(state({ layers: {} }), [
    action,
    layerAction,
  ]);

  assert.deepEqual(applied.inverse, [
    { kind: "delete_layer", id: ids.layer, baseVersion: 1 },
    { kind: "delete_canvas", id: ids.canvas, baseVersion: 1 },
  ]);
  assert.throws(() =>
    DrawingStructureActionSchema.parse({ ...action, authority: "admin" }),
  );
});

test("canvas creation and deletion require exact recorded layer actions", () => {
  const current = state({ canvases: { [ids.canvas]: canvas() } });
  const model = canvas({
    id: ids.modelCanvas,
    name: "Model",
    spaceKind: "model",
    sortOrder: 1,
  });
  const modelLayer = {
    id: ids.modelLayer,
    name: "Model work",
    visible: true,
    locked: false,
    systemKind: "custom",
    canvasId: ids.modelCanvas,
    sortOrder: 7,
    version: 1,
  };

  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        { kind: "put_canvas", entity: model, baseVersion: null },
      ]),
    DrawingStructureError,
  );
  const created = applyDrawingStructureActions(current, [
    { kind: "put_canvas", entity: model, baseVersion: null },
    { kind: "put_layer", entity: modelLayer, baseVersion: null },
  ]);
  assert.deepEqual(created.state.layers[ids.modelLayer], modelLayer);
  assert.deepEqual(created.inverse, [
    { kind: "delete_layer", id: ids.modelLayer, baseVersion: 1 },
    { kind: "delete_canvas", id: ids.modelCanvas, baseVersion: 1 },
  ]);
  assert.throws(
    () =>
      applyDrawingStructureActions(created.state, [
        { kind: "delete_canvas", id: ids.modelCanvas, baseVersion: 1 },
      ]),
    DrawingStructureError,
  );
  const deleted = applyDrawingStructureActions(created.state, created.inverse);
  assert.equal(deleted.state.canvases[ids.modelCanvas], undefined);
  assert.equal(deleted.state.layers[ids.modelLayer], undefined);
  const restored = applyDrawingStructureActions(deleted.state, deleted.inverse);
  assert.equal(restored.state.layers[ids.modelLayer].id, ids.modelLayer);
  assert.equal(restored.state.layers[ids.modelLayer].sortOrder, 7);
});

test("page and canvas factories record atomic structural creation and deterministic layer reorder", () => {
  const extraLayer = {
    ...state().layers[ids.layer],
    id: ids.modelLayer,
    name: "Detail",
    systemKind: "custom",
    sortOrder: 1,
  };
  const current = state({
    canvases: { [ids.canvas]: canvas() },
    layers: { ...state().layers, [extraLayer.id]: extraLayer },
  });
  const documentState = {
    revisionId: ids.revision,
    layers: current.layers,
    structure: current,
  };
  const nextIds = [
    "00000000-0000-4000-8000-000000000111",
    "00000000-0000-4000-8000-000000000112",
    "00000000-0000-4000-8000-000000000113",
    "00000000-0000-4000-8000-000000000114",
    "00000000-0000-4000-8000-000000000115",
  ];
  const createId = () => nextIds.shift();
  const page = createDrawingPageCommand(
    documentState,
    "actor-a",
    "Page 2",
    createId,
  );
  assert.deepEqual(
    page.actions.map((action) => action.kind),
    ["put_page", "put_canvas", "put_layer"],
  );
  const createdPage = applyDrawingStructureActions(current, page.actions);
  const pageCanvasId = page.actions[1].entity.id;
  assert.equal(createdPage.state.canvases[pageCanvasId].spaceKind, "paper");
  assert.equal(createdPage.state.canvases[pageCanvasId].sortOrder, 0);

  const model = createDrawingCanvasCommand(
    documentState,
    "actor-a",
    ids.page,
    "model",
    "Model",
    createId,
  );
  assert.deepEqual(
    model.actions.map((action) => action.kind),
    ["put_canvas", "put_layer"],
  );
  const withModel = applyDrawingStructureActions(current, model.actions).state;
  const reorder = reorderDrawingLayerCommand(
    {
      revisionId: ids.revision,
      structure: withModel,
      layers: withModel.layers,
    },
    "actor-a",
    ids.layer,
    "down",
  );
  assert.deepEqual(
    reorder.actions.map((action) => action.kind),
    ["put_layer", "put_layer"],
  );
  const recorded = applyDrawingCommand(
    {
      revisionId: ids.revision,
      objects: withModel.objects,
      layers: withModel.layers,
      operations: [],
      undoStackByActor: {},
      redoStackByActor: {},
      structure: withModel,
    },
    reorder,
  );
  assert.equal(recorded.state.layers[ids.layer].sortOrder, 1);
  const undone = undoDrawingCommand(recorded.state, "actor-a");
  assert.equal(undone.state.layers[ids.layer].sortOrder, 0);

  assert.throws(
    () => deleteDrawingCanvasCommand(documentState, "actor-a", ids.canvas),
    /default paper canvas/,
  );
});

test("page, canvas, and layer navigation commands reject duplicates, pin defaults, and normalize order", () => {
  const secondPageId = "00000000-0000-4000-8000-000000000120";
  const secondCanvasId = "00000000-0000-4000-8000-000000000121";
  const secondLayerId = "00000000-0000-4000-8000-000000000122";
  const current = state({
    pages: {
      ...state().pages,
      [secondPageId]: {
        id: secondPageId,
        revisionId: ids.revision,
        name: "Page 2",
        sortOrder: 1,
        version: 1,
      },
    },
    canvases: {
      [ids.canvas]: canvas(),
      [ids.modelCanvas]: canvas({
        id: ids.modelCanvas,
        name: "Model",
        spaceKind: "model",
        sortOrder: 4,
      }),
      [secondCanvasId]: canvas({
        id: secondCanvasId,
        pageId: secondPageId,
        name: "Paper",
        sortOrder: 0,
      }),
    },
    layers: {
      ...state().layers,
      [ids.modelLayer]: {
        ...state().layers[ids.layer],
        id: ids.modelLayer,
        canvasId: ids.modelCanvas,
        name: "Detail",
        sortOrder: 8,
      },
      [secondLayerId]: {
        ...state().layers[ids.layer],
        id: secondLayerId,
        canvasId: ids.modelCanvas,
        name: "Notes",
        sortOrder: 8,
      },
    },
  });
  const documentState = {
    revisionId: ids.revision,
    layers: current.layers,
    structure: current,
  };

  assert.equal(
    createDrawingCanvasCommand(
      documentState,
      "actor-a",
      ids.page,
      "paper",
      "Paper",
      () => "00000000-0000-4000-8000-000000000124",
    ).actions[0].entity.name,
    "Paper 2",
  );
  assert.throws(
    () =>
      reorderDrawingCanvasCommand(documentState, "actor-a", ids.canvas, "down"),
    /default paper canvas/i,
  );
  assert.throws(
    () =>
      reorderDrawingCanvasCommand(
        documentState,
        "actor-a",
        ids.modelCanvas,
        "up",
      ),
    /cannot move farther/i,
  );
  const reorder = reorderDrawingLayerCommand(
    documentState,
    "actor-a",
    ids.modelLayer,
    "down",
  );
  assert.equal(
    reorder.actions.find(({ entity }) => entity.id === ids.modelLayer).entity
      .sortOrder,
    1,
  );
  assert.equal(
    reorder.actions.find(({ entity }) => entity.id === secondLayerId).entity
      .sortOrder,
    0,
  );
  assert.throws(
    () =>
      deleteDrawingPageCommand(
        {
          ...documentState,
          structure: state({ canvases: { [ids.canvas]: canvas() } }),
        },
        "actor-a",
        ids.page,
      ),
    /at least one page/i,
  );
  assert.equal(
    drawingPageDeletionReason(
      {
        ...documentState,
        structure: state({ canvases: { [ids.canvas]: canvas() } }),
      },
      ids.page,
    ),
    "A drawing document requires at least one page.",
  );
});

test("canvas factories suffix editable layer names across the page and replay layer order history", () => {
  const current = state({ canvases: { [ids.canvas]: canvas() } });
  const documentState = {
    revisionId: ids.revision,
    layers: current.layers,
    structure: current,
  };
  const createIds = [
    "00000000-0000-4000-8000-000000000130",
    "00000000-0000-4000-8000-000000000131",
    "00000000-0000-4000-8000-000000000132",
    "00000000-0000-4000-8000-000000000133",
  ];
  const createId = () => createIds.shift();
  const first = createDrawingCanvasCommand(
    documentState,
    "actor-a",
    ids.page,
    "paper",
    "Paper",
    createId,
  );
  const withFirst = applyDrawingStructureActions(current, first.actions).state;
  const second = createDrawingCanvasCommand(
    {
      revisionId: ids.revision,
      layers: withFirst.layers,
      structure: withFirst,
    },
    "actor-a",
    ids.page,
    "model",
    "Model",
    createId,
  );
  assert.equal(first.actions[1].entity.name, "Paper work");
  assert.equal(second.actions[1].entity.name, "Model work");
  const withSecond = applyDrawingStructureActions(
    withFirst,
    second.actions,
  ).state;
  const thirdIds = [
    "00000000-0000-4000-8000-000000000134",
    "00000000-0000-4000-8000-000000000135",
  ];
  const third = createDrawingCanvasCommand(
    {
      revisionId: ids.revision,
      layers: withSecond.layers,
      structure: withSecond,
    },
    "actor-a",
    ids.page,
    "paper",
    "Paper",
    () => thirdIds.shift(),
  );
  assert.equal(third.actions[1].entity.name, "Paper work 2");
  const withThird = applyDrawingStructureActions(
    withSecond,
    third.actions,
  ).state;
  const fourth = createDrawingCanvasCommand(
    {
      revisionId: ids.revision,
      layers: withThird.layers,
      structure: withThird,
    },
    "actor-a",
    ids.page,
    "model",
    "Model",
    (() => {
      const ids = [
        "00000000-0000-4000-8000-000000000136",
        "00000000-0000-4000-8000-000000000137",
      ];
      return () => ids.shift();
    })(),
  );
  assert.equal(fourth.actions[1].entity.name, "Model work 2");

  const detail = {
    ...current.layers[ids.layer],
    id: ids.modelLayer,
    name: "Detail",
    systemKind: "custom",
    sortOrder: 1,
  };
  const canonical = state({
    canvases: { [ids.canvas]: canvas() },
    layers: { ...current.layers, [detail.id]: detail },
  });
  const reorder = reorderDrawingLayerCommand(
    {
      revisionId: ids.revision,
      layers: canonical.layers,
      structure: canonical,
    },
    "actor-a",
    ids.layer,
    "down",
  );
  const recorded = applyDrawingCommand(
    {
      revisionId: ids.revision,
      objects: canonical.objects,
      layers: canonical.layers,
      operations: [],
      undoStackByActor: {},
      redoStackByActor: {},
      structure: canonical,
    },
    reorder,
  );
  const undone = undoDrawingCommand(recorded.state, "actor-a");
  const redone = redoDrawingCommand(undone.state, "actor-a");
  assert.equal(
    redone.operation.forward.actions.every(
      (action) => action.baseVersion === 3 && action.entity.version === 3,
    ),
    true,
  );
  assert.deepEqual(
    redone.operation.inverse.actions.map((action) => action.baseVersion),
    [4, 4],
  );
});

test("active canvas slices cache by canonical maps and deletion focus intents survive non-active removal", () => {
  const cache = createDrawingActiveCanvasSliceCache();
  const layers = {};
  const objects = {};
  for (let canvasIndex = 0; canvasIndex < 20; canvasIndex += 1) {
    const canvasId = `canvas-${canvasIndex}`;
    const layerId = `layer-${canvasIndex}`;
    layers[layerId] = { id: layerId, canvasId, version: 1 };
    for (let objectIndex = 0; objectIndex < 500; objectIndex += 1)
      objects[`${canvasIndex}-${objectIndex}`] = {
        id: `${canvasIndex}-${objectIndex}`,
        layerId,
      };
  }
  const a = cache.select(layers, objects, "canvas-0");
  const b = cache.select(layers, objects, "canvas-1");
  assert.strictEqual(cache.select(layers, objects, "canvas-0"), a);
  assert.equal(a.objects["0-499"].id, "0-499");
  assert.equal(b.objects["1-499"].id, "1-499");
  for (let canvasIndex = 2; canvasIndex < 20; canvasIndex += 1)
    cache.select(layers, objects, `canvas-${canvasIndex}`);
  assert.equal(cache.buildCount, 20);
  assert.notStrictEqual(cache.select({ ...layers }, objects, "canvas-0"), a);
  assert.equal(cache.buildCount, 21);

  const focus = nextDrawingCanvasFocusIntent(
    {
      activeCanvasId: ids.canvas,
      pages: [
        { id: ids.page, sortOrder: 0 },
        { id: "page-2", sortOrder: 1 },
      ],
      canvases: [
        { id: ids.canvas, pageId: ids.page, sortOrder: 0 },
        { id: ids.modelCanvas, pageId: ids.page, sortOrder: 1 },
        { id: "canvas-2", pageId: "page-2", sortOrder: 0 },
      ],
    },
    { deletedCanvasIds: [ids.modelCanvas] },
    4,
  );
  assert.deepEqual(focus, { canvasId: ids.canvas, token: 5 });
  assert.deepEqual(
    nextDrawingCanvasFocusIntent(
      {
        activeCanvasId: ids.canvas,
        pages: [{ id: ids.page, sortOrder: 0 }],
        canvases: [
          { id: ids.canvas, pageId: ids.page, sortOrder: 0 },
          { id: ids.modelCanvas, pageId: ids.page, sortOrder: 1 },
        ],
      },
      { deletedCanvasIds: [ids.canvas] },
      focus.token,
    ),
    { canvasId: ids.modelCanvas, token: 6 },
  );
});

test("standalone P2 layer creation uses legacy add_layer with canonical canvas fields", () => {
  const current = state({ canvases: { [ids.canvas]: canvas() } });
  const command = createDrawingLayerCommand(
    { revisionId: ids.revision, layers: current.layers, structure: current },
    "actor-a",
    "Details",
    () => "00000000-0000-4000-8000-000000000123",
    ids.canvas,
  );
  assert.equal(command.type, "add_layer");
  assert.deepEqual(command.layer, {
    id: "00000000-0000-4000-8000-000000000123",
    name: "Details",
    visible: true,
    locked: false,
    canvasId: ids.canvas,
    sortOrder: 1,
    version: 1,
  });
});

test("structure reducer rejects deleting the last page", () => {
  const current = state({ canvases: { [ids.canvas]: canvas() } });
  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        { kind: "delete_layer", id: ids.layer, baseVersion: 1 },
        { kind: "delete_canvas", id: ids.canvas, baseVersion: 1 },
        { kind: "delete_page", id: ids.page, baseVersion: 1 },
      ]),
    /at least one page/i,
  );
});

test("table rows require exactly one object or block instance target", () => {
  const table = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Schedule",
    columns: [
      {
        id: ids.style,
        name: "Note",
        kind: "text",
        propertySchemaId: null,
      },
    ],
    rows: [
      { id: ids.instance, objectId: null, blockInstanceId: null, cells: {} },
    ],
    version: 1,
  };
  assert.equal(DrawingTableSchema.safeParse(table).success, false);
  assert.equal(
    DrawingTableSchema.safeParse({
      ...table,
      rows: [
        {
          ...table.rows[0],
          objectId: ids.object,
          blockInstanceId: ids.instance,
        },
      ],
    }).success,
    false,
  );
});

test("resolved style merges a referenced definition with finite validated overrides", () => {
  assert.deepEqual(
    resolveDrawingStyle(object(), Object.values(state().styles)),
    {
      stroke: "#111111",
      strokeWidth: 2,
      fill: "#ffffff",
      fontSize: 12,
    },
  );
  assert.throws(() =>
    resolveDrawingStyle(
      object({ style: { strokeWidth: Number.POSITIVE_INFINITY } }),
      Object.values(state().styles),
    ),
  );
});

test("strict structure actions reject duplicate trimmed style definition names", () => {
  const current = state({ canvases: { [ids.canvas]: canvas() } });
  assert.throws(
    () => applyDrawingStructureActions(current, [{
      kind: "put_style",
      entity: {
        id: "00000000-0000-4000-8000-000000000011",
        revisionId: ids.revision,
        name: "Default",
        value: { stroke: "#000000", strokeWidth: 1, fill: null },
        version: 1,
      },
      baseVersion: null,
    }]),
    /style.*name.*unique|unique.*style.*name/i,
  );
});

test("structure object actions require the matching block conversion batch", () => {
  const existingCanvas = canvas();
  const current = state({ canvases: { [existingCanvas.id]: existingCanvas } });
  const putObject = {
    kind: "put_object",
    entity: object({
      styleId: null,
      style: { stroke: "#111111", strokeWidth: 2, fill: null },
    }),
    baseVersion: null,
  };

  assert.throws(
    () => applyDrawingStructureActions(current, [putObject]),
    DrawingStructureError,
  );

  const block = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Block",
    primitives: [
      {
        localId: "primitive-1",
        name: "Rectangle",
        geometry: object().geometry,
        styleId: null,
        style: { stroke: "#111111", strokeWidth: 2, fill: null },
      },
    ],
    version: 1,
  };
  const instance = {
    id: ids.instance,
    lineageId: ids.instance,
    blockId: ids.block,
    layerId: ids.layer,
    name: "Block 1",
    origin: { x: 0, y: 0 },
    rotation: 0,
    scaleX: 1,
    scaleY: 1,
    version: 1,
  };

  const applied = applyDrawingStructureActions(
    { ...current, objects: { [ids.object]: putObject.entity } },
    [
      { kind: "delete_object", id: ids.object, baseVersion: 1 },
      { kind: "put_block", entity: block, baseVersion: null },
      { kind: "put_block_instance", entity: instance, baseVersion: null },
    ],
  );
  assert.equal(applied.state.blockInstances[ids.instance].blockId, ids.block);
});

test("block conversion batches pair a new instance with their new definition", () => {
  const existingCanvas = canvas();
  const current = state({
    canvases: { [existingCanvas.id]: existingCanvas },
    objects: {
      [ids.object]: object({
        styleId: null,
        style: { stroke: "#111111", strokeWidth: 2, fill: null },
      }),
    },
    blocks: {
      [ids.style]: {
        id: ids.style,
        revisionId: ids.revision,
        name: "Existing block",
        primitives: [
          {
            localId: "existing-primitive",
            name: "Rectangle",
            geometry: object().geometry,
            styleId: null,
            style: { stroke: "#111111", strokeWidth: 2, fill: null },
          },
        ],
        version: 1,
      },
    },
  });
  const unrelatedBlock = {
    id: ids.block,
    revisionId: ids.revision,
    name: "Unrelated block",
    primitives: [
      {
        localId: "unrelated-primitive",
        name: "Rectangle",
        geometry: object().geometry,
        styleId: null,
        style: { stroke: "#111111", strokeWidth: 2, fill: null },
      },
    ],
    version: 1,
  };

  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        { kind: "delete_object", id: ids.object, baseVersion: 1 },
        { kind: "put_block", entity: unrelatedBlock, baseVersion: null },
        {
          kind: "put_block_instance",
          entity: {
            id: ids.instance,
            lineageId: ids.instance,
            blockId: ids.style,
            layerId: ids.layer,
            name: "Existing block instance",
            origin: { x: 0, y: 0 },
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            version: 1,
          },
          baseVersion: null,
        },
      ]),
    DrawingStructureError,
  );
});

test("objects without a style reference retain complete inline styles", () => {
  const legacy = object({
    styleId: null,
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
  });
  assert.equal(DrawingObjectSchema.safeParse(legacy).success, true);
  assert.deepEqual(resolveDrawingStyle(legacy, []), legacy.style);
});

test("structure reduction is atomic, ordered, and keeps inverse versions monotonic", () => {
  const original = canvas({
    id: "00000000-0000-4000-8000-000000000090",
    name: "Model",
    spaceKind: "model",
    sortOrder: 1,
    version: 4,
  });
  const modelLayer = {
    ...state().layers[ids.layer],
    id: ids.modelLayer,
    canvasId: original.id,
    name: "Model work",
  };
  const current = state({
    canvases: { [ids.canvas]: canvas(), [original.id]: original },
    layers: { ...state().layers, [modelLayer.id]: modelLayer },
  });
  const update = {
    kind: "put_canvas",
    entity: { ...original, name: "Updated" },
    baseVersion: 4,
  };
  const updated = applyDrawingStructureActions(current, [update]);
  const restored = applyDrawingStructureActions(updated.state, updated.inverse);
  assert.equal(restored.state.canvases[original.id].name, "Model");
  assert.equal(restored.state.canvases[original.id].version, 6);
  assert.deepEqual(current.canvases[original.id], original);
  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        {
          kind: "put_canvas",
          entity: {
            ...canvas(),
            id: "00000000-0000-4000-8000-000000000091",
            pageId: "00000000-0000-4000-8000-000000000092",
          },
          baseVersion: null,
        },
      ]),
    DrawingStructureError,
  );
  assert.equal(
    current.canvases["00000000-0000-4000-8000-000000000091"],
    undefined,
  );
});

test("default canvases, cross-kind IDs, nested extras, and invalid calendar dates fail closed", () => {
  const current = state({ canvases: { [ids.canvas]: canvas() } });
  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        {
          kind: "put_canvas",
          entity: canvas({
            id: "00000000-0000-4000-8000-000000000093",
            name: "Replacement",
            sortOrder: 0,
          }),
          baseVersion: null,
        },
        { kind: "delete_canvas", id: ids.canvas, baseVersion: 1 },
      ]),
    DrawingStructureError,
  );
  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        {
          kind: "put_style",
          entity: {
            id: ids.canvas,
            revisionId: ids.revision,
            name: "Collision",
            value: { stroke: "#111111", strokeWidth: 1, fill: null },
            version: 1,
          },
          baseVersion: null,
        },
      ]),
    DrawingStructureError,
  );
  assert.throws(() =>
    DrawingStructureActionSchema.parse({
      kind: "put_canvas",
      entity: {
        ...canvas(),
        background: {
          sourceFileId: ids.style,
          sourceSha256: "a".repeat(64),
          pdfPageNumber: 1,
          calibration: {
            normalizedStart: { x: 0, y: 0 },
            normalizedEnd: { x: 1, y: 1 },
            realLengthMillimeters: 1,
            millimetersPerNormalizedUnit: 1,
            extra: true,
          },
        },
      },
      baseVersion: null,
    }),
  );
  assert.equal(
    DrawingPropertyValueSchema.safeParse({
      id: ids.instance,
      schemaId: ids.style,
      objectId: ids.object,
      blockInstanceId: null,
      value: "2026-02-30",
      version: 1,
    }).success,
    true,
  );
  const dateState = state({
    canvases: { [ids.canvas]: canvas() },
    objects: { [ids.object]: object() },
    propertySchemas: {
      [ids.block]: {
        id: ids.block,
        revisionId: ids.revision,
        name: "Due date",
        valueType: "date",
        enumOptions: [],
        appliesTo: ["rectangle"],
        required: false,
        version: 1,
      },
    },
  });
  assert.throws(
    () =>
      applyDrawingStructureActions(dateState, [
        {
          kind: "put_property_value",
          entity: {
            id: ids.instance,
            schemaId: ids.block,
            objectId: ids.object,
            blockInstanceId: null,
            value: "2026-02-30",
            version: 1,
          },
          baseVersion: null,
        },
      ]),
    DrawingStructureError,
  );
});

test("block conversion primitives must exactly represent the deleted objects", () => {
  const current = state({
    canvases: { [ids.canvas]: canvas() },
    objects: {
      [ids.object]: object({
        styleId: null,
        style: { stroke: "#111111", strokeWidth: 2, fill: null },
      }),
    },
  });
  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        { kind: "delete_object", id: ids.object, baseVersion: 1 },
        {
          kind: "put_block",
          entity: {
            id: ids.block,
            revisionId: ids.revision,
            name: "Block",
            primitives: [
              {
                localId: "p",
                name: "Wrong",
                geometry: { ...object().geometry, width: 99 },
                styleId: null,
                style: { stroke: "#111111", strokeWidth: 2, fill: null },
              },
            ],
            version: 1,
          },
          baseVersion: null,
        },
        {
          kind: "put_block_instance",
          entity: {
            id: ids.instance,
            lineageId: ids.instance,
            blockId: ids.block,
            layerId: ids.layer,
            name: "Block",
            origin: { x: 0, y: 0 },
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            version: 1,
          },
          baseVersion: null,
        },
      ]),
    DrawingStructureError,
  );
});

test("block conversion rejects objects from a layer other than its instance layer", () => {
  const otherLayer = "00000000-0000-4000-8000-000000000097";
  const current = state({
    canvases: { [ids.canvas]: canvas() },
    layers: {
      [ids.layer]: state().layers[ids.layer],
      [otherLayer]: {
        ...state().layers[ids.layer],
        id: otherLayer,
        name: "Details",
      },
    },
    objects: {
      [ids.object]: object({
        layerId: otherLayer,
        styleId: null,
        style: { stroke: "#111111", strokeWidth: 2, fill: null },
      }),
    },
  });
  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        { kind: "delete_object", id: ids.object, baseVersion: 1 },
        {
          kind: "put_block",
          entity: {
            id: ids.block,
            revisionId: ids.revision,
            name: "Block",
            primitives: [
              {
                localId: "p",
                name: "Rectangle",
                geometry: object().geometry,
                styleId: null,
                style: { stroke: "#111111", strokeWidth: 2, fill: null },
              },
            ],
            version: 1,
          },
          baseVersion: null,
        },
        {
          kind: "put_block_instance",
          entity: {
            id: ids.instance,
            lineageId: ids.instance,
            blockId: ids.block,
            layerId: ids.layer,
            name: "Block",
            origin: { x: 0, y: 0 },
            rotation: 0,
            scaleX: 1,
            scaleY: 1,
            version: 1,
          },
          baseVersion: null,
        },
      ]),
    DrawingStructureError,
  );
});

test("translation-only block conversion preserves the canonical primitive through its inverse", () => {
  const source = object({
    styleId: null,
    style: { stroke: "#111111", strokeWidth: 2, fill: null },
    geometry: {
      type: "rectangle",
      origin: { x: 14, y: 26 },
      width: 20,
      height: 10,
      rotation: 0,
    },
  });
  const current = state({
    canvases: { [ids.canvas]: canvas() },
    objects: { [ids.object]: source },
  });
  const actions = [
    { kind: "delete_object", id: ids.object, baseVersion: 1 },
    {
      kind: "put_block",
      entity: {
        id: ids.block,
        revisionId: ids.revision,
        name: "Block",
        version: 1,
        primitives: [
          {
            localId: "p",
            name: source.name,
            geometry: {
              type: "rectangle",
              origin: { x: 4, y: 6 },
              width: 20,
              height: 10,
              rotation: 0,
            },
            styleId: null,
            style: source.style,
          },
        ],
      },
      baseVersion: null,
    },
    {
      kind: "put_block_instance",
      entity: {
        id: ids.instance,
        lineageId: ids.instance,
        blockId: ids.block,
        layerId: ids.layer,
        name: "Block",
        origin: { x: 10, y: 20 },
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        version: 1,
      },
      baseVersion: null,
    },
  ];
  const converted = applyDrawingStructureActions(current, actions);
  assert.deepEqual(converted.state.blocks[ids.block].primitives[0].geometry, {
    type: "rectangle",
    origin: { x: 4, y: 6 },
    width: 20,
    height: 10,
    rotation: 0,
  });
  const restored = applyDrawingStructureActions(
    converted.state,
    converted.inverse,
  );
  assert.deepEqual(
    { ...restored.state.objects[ids.object], version: source.version },
    source,
  );
  const malformedInverse = structuredClone(converted.inverse);
  malformedInverse.at(-1).entity.name = "Unrelated";
  assert.throws(
    () => applyDrawingStructureActions(converted.state, malformedInverse),
    DrawingStructureError,
  );
  const withoutCapturedObjects = structuredClone(converted.state);
  withoutCapturedObjects.tombstones = {};
  assert.throws(
    () =>
      applyDrawingStructureActions(withoutCapturedObjects, converted.inverse),
    DrawingStructureError,
  );
});

test("rotated and scaled block conversion is rejected before geometry or style mutation", () => {
  const source = object({
    styleId: null,
    style: { stroke: "#111111", strokeWidth: 2, fill: null },
    geometry: {
      type: "rectangle",
      origin: { x: 14.75, y: 26.125 },
      width: 20.5,
      height: 10.25,
      rotation: 47,
    },
  });
  const current = state({
    canvases: { [ids.canvas]: canvas() },
    objects: { [ids.object]: source },
  });
  const actions = [
    { kind: "delete_object", id: ids.object, baseVersion: 1 },
    {
      kind: "put_block",
      entity: {
        id: ids.block,
        revisionId: ids.revision,
        name: "Rotated block",
        primitives: [
          {
            localId: "rotated-primitive",
            name: source.name,
            geometry: {
              type: "rectangle",
              origin: { x: 10.653845264191645, y: 10.953001293556998 },
              width: 10.25,
              height: 5.125,
              rotation: 17,
            },
            styleId: null,
            style: source.style,
          },
        ],
        version: 1,
      },
      baseVersion: null,
    },
    {
      kind: "put_block_instance",
      entity: {
        id: ids.instance,
        lineageId: ids.instance,
        blockId: ids.block,
        layerId: ids.layer,
        name: "Rotated block",
        origin: { x: 7.25, y: -3.5 },
        rotation: 30,
        scaleX: 2,
        scaleY: 2,
        version: 1,
      },
      baseVersion: null,
    },
  ];

  assert.throws(
    () => applyDrawingStructureActions(current, actions),
    /translation-only/,
  );
  assert.deepEqual(current.objects[ids.object], source);
  assert.equal(current.blocks[ids.block], undefined);
});

test("fresh structure entities start at version one and documents cannot lose their final page", () => {
  const current = state({ canvases: { [ids.canvas]: canvas() } });
  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        {
          kind: "put_canvas",
          entity: canvas({
            id: "00000000-0000-4000-8000-000000000095",
            name: "Model",
            spaceKind: "model",
            sortOrder: 1,
            version: 99,
          }),
          baseVersion: null,
        },
      ]),
    DrawingStructureError,
  );
  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        {
          kind: "put_style",
          entity: {
            id: "00000000-0000-4000-8000-000000000096",
            revisionId: ids.revision,
            name: "Fresh",
            value: { stroke: "#111111", strokeWidth: 1, fill: null },
            version: 2,
          },
          baseVersion: null,
        },
      ]),
    DrawingStructureError,
  );
  assert.throws(
    () =>
      applyDrawingStructureActions(current, [
        { kind: "delete_layer", id: ids.layer, baseVersion: 1 },
        { kind: "delete_canvas", id: ids.canvas, baseVersion: 1 },
        { kind: "delete_page", id: ids.page, baseVersion: 1 },
      ]),
    /at least one page/i,
  );
});
