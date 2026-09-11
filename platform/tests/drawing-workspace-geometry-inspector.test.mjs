import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const {
  createDrawingGeometryInspectorDraft,
  DrawingGeometryInspector,
  editDrawingGeometryInspectorDraft,
  reconcileDrawingGeometryInspectorDraft,
} = await vite
  .ssrLoadModule("/app/lukas/components/drawing-geometry-inspector.tsx")
  .catch(() => ({}));

test.after(() => vite.close());

const layerId = "00000000-0000-4000-8000-000000000201";
const objectId = "00000000-0000-4000-8000-000000000202";
const object = {
  id: objectId,
  name: "W-01",
  layerId,
  geometry: {
    type: "wall",
    semanticVersion: 1,
    start: { x: 100, y: 200 },
    end: { x: 3100, y: 200 },
    thicknessMillimeters: 200,
    heightMillimeters: 3000,
  },
  style: { stroke: "#000000", strokeWidth: 1, fill: null },
  version: 3,
};
const state = {
  layers: {
    [layerId]: {
      id: layerId,
      name: "Work",
      visible: true,
      locked: false,
      canvasId: "00000000-0000-4000-8000-000000000203",
      systemKind: "work",
      version: 1,
    },
  },
  objects: { [objectId]: object },
};

test("geometry inspector hides every mutation control from viewers", () => {
  assert.equal(typeof DrawingGeometryInspector, "function");
  const markup = renderToStaticMarkup(
    createElement(DrawingGeometryInspector, {
      actorId: "00000000-0000-4000-8000-000000000204",
      canEdit: false,
      object,
      onCommand() {},
      state,
    }),
  );
  assert.match(markup, /정밀 위치/);
  assert.match(markup, /시작 X/);
  assert.match(markup, /3,100|3100/);
  assert.doesNotMatch(markup, /<form|<input|<button/);
  assert.doesNotMatch(markup, /정밀 위치 적용/);
});

test("geometry inspector exposes exact millimeter controls only to editors", () => {
  assert.equal(typeof DrawingGeometryInspector, "function");
  const markup = renderToStaticMarkup(
    createElement(DrawingGeometryInspector, {
      actorId: "00000000-0000-4000-8000-000000000204",
      canEdit: true,
      object,
      onCommand() {},
      state,
    }),
  );
  for (const name of [
    "startXMillimeters",
    "startYMillimeters",
    "endXMillimeters",
    "endYMillimeters",
  ])
    assert.match(markup, new RegExp(`name="${name}"`));
  assert.match(markup, /단위 · mm/);
  assert.match(markup, /정밀 위치 적용/);
  assert.doesNotMatch(markup, /name="offsetMillimeters"/);
});

test("dimension inspector includes its signed offset and parent inspector connects it", async () => {
  assert.equal(typeof DrawingGeometryInspector, "function");
  const dimension = {
    ...object,
    geometry: {
      type: "dimension",
      start: { x: 0, y: 0 },
      end: { x: 1000, y: 0 },
      offset: -24,
      calibrationId: null,
    },
  };
  const markup = renderToStaticMarkup(
    createElement(DrawingGeometryInspector, {
      actorId: "00000000-0000-4000-8000-000000000204",
      canEdit: true,
      object: dimension,
      onCommand() {},
      state: { ...state, objects: { [objectId]: dimension } },
    }),
  );
  assert.match(markup, /name="offsetMillimeters"/);
  assert.match(markup, /defaultValue="-24"|value="-24"/);

  const parent = await readFile(
    new URL("../app/lukas/components/drawing-inspector.tsx", import.meta.url),
    "utf8",
  );
  assert.match(parent, /DrawingGeometryInspector/);
  assert.match(parent, /geometryInspector/);
});

test("geometry draft survives a soft-lock render and detects only remote field conflicts", async () => {
  assert.equal(typeof createDrawingGeometryInspectorDraft, "function");
  assert.equal(typeof editDrawingGeometryInspectorDraft, "function");
  assert.equal(typeof reconcileDrawingGeometryInspectorDraft, "function");

  const initial = createDrawingGeometryInspectorDraft(object);
  const edited = editDrawingGeometryInspectorDraft(
    initial,
    object,
    "startXMillimeters",
    "125.25",
  );
  assert.equal(edited.values.startXMillimeters, "125.25");
  assert.deepEqual(edited.dirtyFields, ["startXMillimeters"]);
  assert.deepEqual(
    reconcileDrawingGeometryInspectorDraft(edited, object),
    edited,
  );

  const unrelatedRemote = {
    ...object,
    version: 4,
    geometry: {
      ...object.geometry,
      end: { ...object.geometry.end, x: 3200 },
    },
  };
  const safelyRebased = reconcileDrawingGeometryInspectorDraft(
    edited,
    unrelatedRemote,
  );
  assert.equal(safelyRebased.values.startXMillimeters, "125.25");
  assert.equal(safelyRebased.values.endXMillimeters, "3200");
  assert.deepEqual(safelyRebased.conflictedFields, []);
  assert.equal(safelyRebased.objectVersion, 4);

  const conflictingRemote = {
    ...object,
    version: 4,
    geometry: {
      ...object.geometry,
      start: { ...object.geometry.start, x: 175 },
    },
  };
  const conflicted = reconcileDrawingGeometryInspectorDraft(
    edited,
    conflictingRemote,
  );
  assert.equal(conflicted.values.startXMillimeters, "125.25");
  assert.deepEqual(conflicted.conflictedFields, ["startXMillimeters"]);

  const source = await readFile(
    new URL(
      "../app/lukas/components/drawing-geometry-inspector.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /value=\{activeDraft\.values\[name\]\}/);
  assert.doesNotMatch(
    source,
    /key=\{`\$\{object\.id\}:\$\{object\.version\}`\}/,
  );
  assert.match(source, /내 입력 재적용/);
  assert.match(source, /최신값 사용/);
});
