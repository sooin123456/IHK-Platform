import assert from "node:assert/strict";
import test from "node:test";

import { createDrawingDocumentState } from "../app/lukas/lib/drawing-commands.ts";
import {
  deriveDrawingTransientState,
  drawingTransientAuthorizationKey,
  sanitizeDrawingTransientInput,
  createDrawingDocumentStore,
  DRAWING_SERVER_VALIDATED_HYDRATION,
  hydrateDrawingDocumentState,
} from "../app/lukas/lib/drawing-document-store.ts";
import { createDrawingStyleResolutionCache } from "../app/lukas/lib/drawing-style-resolution.ts";

const documentStoreModule =
  await import("../app/lukas/lib/drawing-document-store.ts");

const ids = {
  revision: "00000000-0000-4000-8000-000000000101",
  page: "00000000-0000-4000-8000-000000000102",
  paper: "00000000-0000-4000-8000-000000000103",
  model: "00000000-0000-4000-8000-000000000104",
  work: "00000000-0000-4000-8000-000000000105",
  modelWork: "00000000-0000-4000-8000-000000000106",
  object: "00000000-0000-4000-8000-000000000107",
  style: "00000000-0000-4000-8000-000000000108",
  block: "00000000-0000-4000-8000-000000000109",
  schema: "00000000-0000-4000-8000-000000000110",
  table: "00000000-0000-4000-8000-000000000111",
  actor: "00000000-0000-4000-8000-000000000112",
  operation: "00000000-0000-4000-8000-000000000113",
  hostLayer: "00000000-0000-4000-8000-000000000120",
  openingLayer: "00000000-0000-4000-8000-000000000121",
  hostWall: "00000000-0000-4000-8000-000000000122",
  opening: "00000000-0000-4000-8000-000000000123",
  unrelated: "00000000-0000-4000-8000-000000000124",
  source: "00000000-0000-4000-8000-000000000125",
  file: "00000000-0000-4000-8000-000000000126",
};

function source() {
  return {
    id: ids.source,
    objectId: ids.object,
    revisionId: ids.revision,
    sourceFileId: ids.file,
    sourceSha256: "a".repeat(64),
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    version: 1,
  };
}

function structure() {
  return {
    pages: {
      [ids.page]: {
        id: ids.page,
        revisionId: ids.revision,
        name: "A1",
        sortOrder: 0,
        version: 1,
      },
    },
    canvases: {
      [ids.paper]: {
        id: ids.paper,
        pageId: ids.page,
        name: "Paper",
        spaceKind: "paper",
        widthMillimeters: 210,
        heightMillimeters: 297,
        background: null,
        sortOrder: 0,
        version: 1,
      },
      [ids.model]: {
        id: ids.model,
        pageId: ids.page,
        name: "Model",
        spaceKind: "model",
        widthMillimeters: 210,
        heightMillimeters: 297,
        background: null,
        sortOrder: 1,
        version: 1,
      },
    },
    layers: {
      [ids.work]: {
        id: ids.work,
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        canvasId: ids.paper,
        sortOrder: 0,
        version: 1,
      },
      [ids.modelWork]: {
        id: ids.modelWork,
        name: "Model work",
        visible: true,
        locked: false,
        systemKind: "custom",
        canvasId: ids.model,
        sortOrder: 0,
        version: 1,
      },
    },
    objects: {
      [ids.object]: {
        id: ids.object,
        name: "Rectangle",
        layerId: ids.work,
        geometry: {
          type: "rectangle",
          origin: { x: 0, y: 0 },
          width: 10,
          height: 20,
          rotation: 0,
        },
        style: { stroke: "#112233", strokeWidth: 2, fill: null },
        version: 1,
      },
    },
    styles: {
      [ids.style]: {
        id: ids.style,
        revisionId: ids.revision,
        name: "Default",
        value: { stroke: "#112233", strokeWidth: 2, fill: null },
        version: 1,
      },
    },
    blocks: {
      [ids.block]: {
        id: ids.block,
        revisionId: ids.revision,
        name: "Symbol",
        primitives: [
          {
            localId: "rect",
            name: "Rectangle",
            geometry: {
              type: "rectangle",
              origin: { x: 0, y: 0 },
              width: 10,
              height: 20,
              rotation: 0,
            },
            styleId: null,
            style: { stroke: "#112233", strokeWidth: 2, fill: null },
          },
        ],
        version: 1,
      },
    },
    blockInstances: {},
    propertySchemas: {
      [ids.schema]: {
        id: ids.schema,
        revisionId: ids.revision,
        name: "Code",
        valueType: "text",
        enumOptions: [],
        appliesTo: ["rectangle"],
        required: false,
        version: 1,
      },
    },
    propertyValues: {},
    tables: {
      [ids.table]: {
        id: ids.table,
        revisionId: ids.revision,
        name: "Schedule",
        columns: [
          {
            id: "00000000-0000-4000-8000-000000000114",
            name: "Note",
            kind: "text",
            propertySchemaId: null,
          },
        ],
        rows: [],
        version: 1,
      },
    },
  };
}

test("hydrates every P2 collection into one canonical document state", () => {
  const state = hydrateDrawingDocumentState({
    revisionId: ids.revision,
    sources: [source()],
    ...Object.fromEntries(
      Object.entries(structure()).map(([key, value]) => [
        key,
        Object.values(value),
      ]),
    ),
  });

  assert.equal(state.structure.pages[ids.page].name, "A1");
  assert.equal(state.structure.canvases[ids.model].spaceKind, "model");
  assert.equal(state.objects[ids.object].layerId, ids.work);
  assert.equal(state.structure.styles[ids.style].name, "Default");
  assert.equal(state.structure.blocks[ids.block].name, "Symbol");
  assert.equal(state.structure.propertySchemas[ids.schema].name, "Code");
  assert.equal(state.structure.tables[ids.table].name, "Schedule");
  assert.deepEqual(state.structure.sources, { [ids.source]: source() });
  assert.strictEqual(state.objects, state.structure.objects);
  assert.strictEqual(state.layers, state.structure.layers);
});

test("explicit server-validated hydration skips duplicate row parsing but keeps graph invariants", () => {
  const input = structure();
  input.objects[ids.object].serverValidatedMarker = "preserved";
  const hydration = {
    revisionId: ids.revision,
    ...Object.fromEntries(
      Object.entries(input).map(([key, value]) => [key, Object.values(value)]),
    ),
  };

  assert.throws(() => hydrateDrawingDocumentState(hydration));
  assert.throws(() =>
    hydrateDrawingDocumentState(hydration, { authority: "server-validated" }),
  );
  const trustedState = hydrateDrawingDocumentState(hydration, {
    authority: DRAWING_SERVER_VALIDATED_HYDRATION,
  });
  assert.equal(
    trustedState.objects[ids.object].serverValidatedMarker,
    "preserved",
  );

  hydration.canvases[0].pageId = ids.actor;
  assert.throws(() =>
    hydrateDrawingDocumentState(hydration, {
      authority: DRAWING_SERVER_VALIDATED_HYDRATION,
    }),
  );
});

test("store preserves canonical P2 state and falls back to the page default after active canvas deletion", () => {
  const initial = createDrawingDocumentState({
    revisionId: ids.revision,
    structure: structure(),
  });
  const store = createDrawingDocumentStore(initial, {
    activePageId: ids.page,
    activeCanvasId: ids.model,
    createId: () => ids.operation,
    now: () => "2026-08-25T00:00:00.000Z",
  });
  let notifications = 0;
  const unsubscribe = store.subscribe(() => {
    notifications += 1;
  });

  store.dispatch({
    type: "mutate_structure",
    actorId: ids.actor,
    actions: [
      { kind: "delete_layer", id: ids.modelWork, baseVersion: 1 },
      { kind: "delete_canvas", id: ids.model, baseVersion: 1 },
    ],
  });

  const snapshot = store.getSnapshot();
  assert.equal(snapshot.activePageId, ids.page);
  assert.equal(snapshot.activeCanvasId, ids.paper);
  assert.equal(snapshot.structure.canvases[ids.model], undefined);
  assert.equal(snapshot.structure.styles[ids.style].name, "Default");
  assert.equal(notifications, 1);
  assert.strictEqual(store.getSnapshot(), snapshot);
  store.selectCanvas(ids.paper);
  assert.strictEqual(store.getSnapshot(), snapshot);
  assert.equal(notifications, 1);
  unsubscribe();
  store.selectCanvas(ids.paper);
  assert.equal(notifications, 1);
});

test("store leaves the prior snapshot intact when a structure batch conflicts", () => {
  const initial = createDrawingDocumentState({
    revisionId: ids.revision,
    structure: structure(),
  });
  const store = createDrawingDocumentStore(initial);
  const before = store.getSnapshot();

  assert.throws(() =>
    store.dispatch({
      type: "mutate_structure",
      actorId: ids.actor,
      actions: [
        { kind: "delete_layer", id: ids.modelWork, baseVersion: 1 },
        { kind: "delete_canvas", id: ids.model, baseVersion: 2 },
      ],
    }),
  );

  assert.strictEqual(store.getSnapshot(), before);
  assert.ok(store.getSnapshot().structure.canvases[ids.model]);
});

test("post-validation nested mutation cannot bypass document replacement validation", () => {
  const initial = createDrawingDocumentState({
    revisionId: ids.revision,
    structure: structure(),
  });
  const store = createDrawingDocumentStore(initial);
  const next = structuredClone(initial);
  documentStoreModule.validateAndSealDrawingDocumentState?.(next);
  next.objects[ids.object].layerId = ids.actor;

  const replace =
    store.replaceValidated?.bind(store) ?? store.replace.bind(store);
  assert.throws(() => replace(next));
  assert.strictEqual(store.getSnapshot().objects[ids.object].layerId, ids.work);
});

test("hydration fails closed on a malformed P2 row", () => {
  const input = structure();
  input.canvases[ids.paper] = {
    ...input.canvases[ids.paper],
    widthMillimeters: 0,
  };

  assert.throws(() =>
    hydrateDrawingDocumentState({
      revisionId: ids.revision,
      ...Object.fromEntries(
        Object.entries(input).map(([key, value]) => [
          key,
          Object.values(value),
        ]),
      ),
    }),
  );
});

test("hydration rejects orphaned, cross-revision, colliding, defaultless, and non-editable P2 graphs", () => {
  const invalid = (mutate) => {
    const input = structure();
    mutate(input);
    return () =>
      hydrateDrawingDocumentState({
        revisionId: ids.revision,
        ...Object.fromEntries(
          Object.entries(input).map(([key, value]) => [
            key,
            Object.values(value),
          ]),
        ),
      });
  };
  assert.throws(
    invalid((input) => {
      input.pages[ids.page].revisionId = ids.actor;
    }),
  );
  assert.throws(
    invalid((input) => {
      input.canvases[ids.paper].pageId = ids.actor;
    }),
  );
  assert.throws(
    invalid((input) => {
      input.styles[ids.style].id = ids.object;
    }),
  );
  assert.throws(
    invalid((input) => {
      input.canvases[ids.paper].spaceKind = "model";
    }),
  );
  assert.throws(
    invalid((input) => {
      input.layers[ids.work].locked = true;
      input.layers[ids.modelWork].locked = true;
    }),
  );
});

test("non-draft stores reject mutations before changing their snapshot", () => {
  const initial = createDrawingDocumentState({
    revisionId: ids.revision,
    structure: structure(),
  });
  const store = createDrawingDocumentStore(initial, {
    revisionStatus: "approved",
  });
  const before = store.getSnapshot();

  assert.throws(() =>
    store.dispatch({
      type: "update_objects",
      actorId: ids.actor,
      updates: [{ objectId: ids.object, patch: { name: "Blocked" } }],
    }),
  );
  assert.strictEqual(store.getSnapshot(), before);
});

test("transient state synchronously removes inactive, locked, and non-draft editing state", () => {
  const store = createDrawingDocumentStore(
    createDrawingDocumentState({
      revisionId: ids.revision,
      structure: structure(),
    }),
    { activePageId: ids.page, activeCanvasId: ids.model },
  );
  const snapshot = store.getSnapshot();
  const modelObject = {
    ...snapshot.objects[ids.object],
    id: "00000000-0000-4000-8000-000000000115",
    layerId: ids.modelWork,
  };
  const state = {
    ...snapshot,
    objects: { ...snapshot.objects, [modelObject.id]: modelObject },
    structure: {
      ...snapshot.structure,
      objects: { ...snapshot.structure.objects, [modelObject.id]: modelObject },
    },
  };

  const transient = deriveDrawingTransientState(state, {
    canEdit: false,
    activeLayerId: ids.work,
    activeTool: "rectangle",
    selectedIds: [ids.object, modelObject.id],
  });

  assert.deepEqual(Object.keys(transient.state.layers), [ids.modelWork]);
  assert.deepEqual(Object.keys(transient.state.objects), [modelObject.id]);
  assert.deepEqual(transient.selectedIds, []);
  assert.equal(transient.activeLayerId, null);
  assert.equal(transient.activeTool, "select");
});

test("read-only viewers preserve visible active-canvas selection without gaining an edit layer or tool", () => {
  const snapshot = createDrawingDocumentStore(
    createDrawingDocumentState({
      revisionId: ids.revision,
      structure: structure(),
    }),
    { activePageId: ids.page, activeCanvasId: ids.paper },
  ).getSnapshot();
  const transient = deriveDrawingTransientState(snapshot, {
    canEdit: false,
    canSelect: true,
    activeLayerId: ids.work,
    activeTool: "rectangle",
    selectedIds: [ids.object],
  });
  assert.deepEqual(transient.selectedIds, [ids.object]);
  assert.equal(transient.activeLayerId, null);
  assert.equal(transient.activeTool, "select");
});

test("read-only viewers retain the non-mutating pan tool without an edit layer", () => {
  const snapshot = createDrawingDocumentStore(
    createDrawingDocumentState({
      revisionId: ids.revision,
      structure: structure(),
    }),
    { activePageId: ids.page, activeCanvasId: ids.paper },
  ).getSnapshot();
  const transient = deriveDrawingTransientState(snapshot, {
    canEdit: false,
    canSelect: true,
    activeLayerId: null,
    activeTool: "pan",
    selectedIds: [],
  });
  assert.equal(transient.activeLayerId, null);
  assert.equal(transient.activeTool, "pan");
});

test("transient selection inherits host visibility without pruning unrelated or locked-host selections", () => {
  const base = structure();
  const style = { stroke: "#112233", strokeWidth: 2, fill: null };
  const hostLayer = {
    ...base.layers[ids.work],
    id: ids.hostLayer,
    name: "Host",
    visible: false,
  };
  const openingLayer = {
    ...base.layers[ids.work],
    id: ids.openingLayer,
    name: "Opening",
    sortOrder: 1,
  };
  const hostWall = {
    id: ids.hostWall,
    name: "Host wall",
    layerId: ids.hostLayer,
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 0, y: 0 },
      end: { x: 200, y: 0 },
      thicknessMillimeters: 200,
      heightMillimeters: 3000,
    },
    style,
    version: 1,
  };
  const opening = {
    id: ids.opening,
    name: "Door",
    layerId: ids.openingLayer,
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: ids.hostWall,
      offsetMillimeters: 90,
      widthMillimeters: 90,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
    style,
    version: 1,
  };
  const unrelated = {
    ...base.objects[ids.object],
    id: ids.unrelated,
    name: "Unrelated",
    layerId: ids.openingLayer,
  };
  const snapshot = createDrawingDocumentStore(
    createDrawingDocumentState({
      revisionId: ids.revision,
      structure: {
        ...base,
        layers: {
          ...base.layers,
          [ids.hostLayer]: hostLayer,
          [ids.openingLayer]: openingLayer,
        },
        objects: {
          ...base.objects,
          [ids.hostWall]: hostWall,
          [ids.opening]: opening,
          [ids.unrelated]: unrelated,
        },
      },
    }),
    { activePageId: ids.page, activeCanvasId: ids.paper },
  ).getSnapshot();
  const hidden = deriveDrawingTransientState(snapshot, {
    canEdit: true,
    canSelect: true,
    activeLayerId: ids.openingLayer,
    activeTool: "select",
    selectedIds: [ids.opening, ids.unrelated],
  });
  assert.deepEqual(hidden.selectedIds, [ids.unrelated]);

  const visibleHost = {
    ...snapshot,
    layers: {
      ...snapshot.layers,
      [ids.hostLayer]: { ...hostLayer, visible: true, locked: true },
    },
    structure: {
      ...snapshot.structure,
      layers: {
        ...snapshot.structure.layers,
        [ids.hostLayer]: { ...hostLayer, visible: true, locked: true },
      },
    },
  };
  assert.deepEqual(
    deriveDrawingTransientState(visibleHost, {
      canEdit: true,
      canSelect: true,
      activeLayerId: ids.openingLayer,
      activeTool: "select",
      selectedIds: [ids.opening, ids.unrelated],
    }).selectedIds,
    [ids.opening, ids.unrelated],
  );
  assert.deepEqual(
    deriveDrawingTransientState(visibleHost, {
      canEdit: true,
      canSelect: true,
      activeLayerId: ids.openingLayer,
      activeTool: "select",
      selectedIds: hidden.selectedIds,
    }).selectedIds,
    [ids.unrelated],
  );
});

test("definition-only store updates change every effective style without changing object versions", () => {
  const input = structure();
  input.objects[ids.object] = {
    ...input.objects[ids.object],
    styleId: ids.style,
    style: { fill: "#abcdef" },
  };
  const store = createDrawingDocumentStore(
    createDrawingDocumentState({ revisionId: ids.revision, structure: input }),
    { createId: () => ids.operation },
  );
  const before = store.getSnapshot();
  assert.equal(
    createDrawingStyleResolutionCache(before.structure.styles).resolve(
      before.objects[ids.object],
    ).stroke,
    "#112233",
  );
  store.dispatch({
    type: "mutate_structure",
    actorId: ids.actor,
    actions: [
      {
        kind: "put_style",
        entity: {
          ...before.structure.styles[ids.style],
          value: { stroke: "#445566", strokeWidth: 3, fill: null },
        },
        baseVersion: 1,
      },
    ],
  });
  const after = store.getSnapshot();
  assert.equal(
    after.objects[ids.object].version,
    before.objects[ids.object].version,
  );
  assert.equal(
    createDrawingStyleResolutionCache(after.structure.styles).resolve(
      after.objects[ids.object],
    ).stroke,
    "#445566",
  );
});

test("transient authorization identity changes for canvas, draft, and capability boundaries", () => {
  const snapshot = createDrawingDocumentStore(
    createDrawingDocumentState({
      revisionId: ids.revision,
      structure: structure(),
    }),
    { activePageId: ids.page, activeCanvasId: ids.paper },
  ).getSnapshot();
  const draftEditor = drawingTransientAuthorizationKey(snapshot, {
    draft: true,
    canEdit: true,
  });
  const model = { ...snapshot, activeCanvasId: ids.model };

  assert.notEqual(
    draftEditor,
    drawingTransientAuthorizationKey(model, { draft: true, canEdit: true }),
  );
  assert.notEqual(
    draftEditor,
    drawingTransientAuthorizationKey(snapshot, { draft: false, canEdit: true }),
  );
  assert.notEqual(
    draftEditor,
    drawingTransientAuthorizationKey(snapshot, { draft: true, canEdit: false }),
  );
});

test("transient authorization identity includes the effective layer eligibility and version", () => {
  const snapshot = createDrawingDocumentStore(
    createDrawingDocumentState({
      revisionId: ids.revision,
      structure: structure(),
    }),
    { activePageId: ids.page, activeCanvasId: ids.paper },
  ).getSnapshot();
  const layer = snapshot.layers[ids.work];
  const identity = drawingTransientAuthorizationKey(snapshot, {
    draft: true,
    canEdit: true,
    activeLayer: layer,
  });
  assert.notEqual(
    identity,
    drawingTransientAuthorizationKey(snapshot, {
      draft: true,
      canEdit: true,
      activeLayer: { ...layer, locked: true },
    }),
  );
  assert.notEqual(
    identity,
    drawingTransientAuthorizationKey(snapshot, {
      draft: true,
      canEdit: true,
      activeLayer: { ...layer, version: 2 },
    }),
  );
  assert.notEqual(
    identity,
    drawingTransientAuthorizationKey(snapshot, {
      draft: true,
      canEdit: true,
      activeLayer: snapshot.layers[ids.modelWork],
    }),
  );
});

test("authorization-boundary adapter never reuses rectangle or polyline selection input", () => {
  const staleRectangle = {
    activeLayerId: ids.work,
    activeTool: "rectangle",
    selectedIds: [ids.object],
  };
  const stalePolyline = { ...staleRectangle, activeTool: "polyline" };
  const cleared = {
    activeLayerId: ids.work,
    activeTool: "select",
    selectedIds: [],
  };
  assert.deepEqual(
    sanitizeDrawingTransientInput(staleRectangle, true),
    cleared,
  );
  assert.deepEqual(sanitizeDrawingTransientInput(stalePolyline, true), cleared);
  // Re-upgrading edit capability keeps the identity-owned invalidation until
  // an actual new authorized interaction replaces it.
  assert.deepEqual(
    sanitizeDrawingTransientInput(staleRectangle, true),
    cleared,
  );
});
