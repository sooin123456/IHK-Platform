import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";

import * as drawingLayout from "../app/lukas/lib/drawing-layout.ts";
import { drawingSemanticLabelLayout } from "../app/lukas/lib/drawing-geometry.ts";
import { drawingCanvasRenderItems } from "../app/lukas/lib/drawing-blocks.ts";

const ids = {
  page: "70000000-0000-4000-8000-000000000001",
  canvas: "70000000-0000-4000-8000-000000000002",
  source: "70000000-0000-4000-8000-000000000003",
};

const dimension = {
  type: "dimension",
  start: { x: 0, y: 0 },
  end: { x: 6_000, y: 0 },
  offset: -600,
  calibrationId: null,
};

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const drawingCanvas = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-canvas.client.tsx",
);
test.after(() => vite.close());

test("canonical native canvases measure null-ID dimensions directly in millimeters", () => {
  assert.equal(
    typeof drawingLayout.drawingDimensionContextForCanvas,
    "function",
  );
  const context = drawingLayout.drawingDimensionContextForCanvas({
    pageId: ids.page,
    widthMillimeters: 21_000,
    heightMillimeters: 14_850,
    background: null,
  });
  assert.deepEqual(context, { kind: "native_millimeters" });
  assert.deepEqual(
    drawingLayout.drawingDimensionLayout(dimension, context, 140),
    {
      displayStart: { x: 0, y: -600 },
      displayEnd: { x: 6_000, y: -600 },
      label: { x: 3_000, y: -600 },
      fontSize: 140,
      height: 168,
      lineHeight: 1.2,
      points: [
        { x: 0, y: 0 },
        { x: 6_000, y: 0 },
        { x: 0, y: -600 },
        { x: 6_000, y: -600 },
        { x: 3_000, y: -600 },
        { x: 3_756, y: -600 },
        { x: 3_756, y: -432 },
        { x: 3_000, y: -432 },
      ],
      text: "6000.0 mm",
      warning: false,
      width: 756,
      wrap: "none",
    },
  );
});

test("PDF dimensions preserve uncalibrated, unavailable, and matching calibration states", () => {
  const pdf = { kind: "pdf", calibration: null };
  const uncalibrated = drawingLayout.drawingDimensionLayout(
    dimension,
    pdf,
    140,
  );
  assert.equal(uncalibrated.text, "미보정");
  assert.equal(uncalibrated.warning, true);

  const calibratedGeometry = {
    ...dimension,
    end: { x: 2_100, y: 0 },
    calibrationId: ids.page,
  };
  const unavailable = drawingLayout.drawingDimensionLayout(
    calibratedGeometry,
    { kind: "pdf", calibration: null },
    140,
  );
  assert.equal(unavailable.text, "보정 확인 불가");
  assert.equal(unavailable.warning, true);
  const calibrated = drawingLayout.drawingDimensionLayout(
    calibratedGeometry,
    {
      kind: "pdf",
      calibration: {
        id: ids.page,
        millimetersPerNormalizedUnit: 1_000,
        pageWidth: 21_000,
        pageHeight: 14_850,
      },
    },
    140,
  );
  assert.equal(calibrated.text, "100.0 mm");
  assert.equal(calibrated.warning, false);
});

test("canonical PDF context uses the page identity and missing context stays conservative", () => {
  const context = drawingLayout.drawingDimensionContextForCanvas({
    pageId: ids.page,
    widthMillimeters: 21_000,
    heightMillimeters: 14_850,
    background: {
      sourceFileId: ids.source,
      sourceSha256: "a".repeat(64),
      pdfPageNumber: 1,
      calibration: { millimetersPerNormalizedUnit: 1_000 },
    },
  });
  assert.equal(context.kind, "pdf");
  assert.equal(context.calibration.id, ids.page);
  assert.equal(drawingLayout.drawingDimensionLayout(dimension).text, "미보정");
});

test("dimension and semantic layouts reject invalid fonts and scale semantic metrics", () => {
  for (const fontSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
    assert.throws(
      () =>
        drawingLayout.drawingDimensionLayout(
          dimension,
          { kind: "native_millimeters" },
          fontSize,
        ),
      RangeError,
    );
  assert.throws(
    () => drawingLayout.drawingDimensionLayout(dimension, { kind: "blank" }),
    TypeError,
  );

  const space = {
    type: "space",
    semanticVersion: 1,
    boundary: [
      { x: 0, y: 0 },
      { x: 1_000, y: 0 },
      { x: 1_000, y: 1_000 },
      { x: 0, y: 1_000 },
    ],
    number: "101",
    finishes: { floor: null, wall: null, ceiling: null },
  };
  const legacy = drawingSemanticLabelLayout(space, "회의실");
  const styled = drawingSemanticLabelLayout(space, "회의실", 140);
  assert.equal(legacy.fontSize, 14);
  assert.equal(legacy.width, 180);
  assert.equal(styled.fontSize, 140);
  assert.equal(styled.width, 1_800);
  assert.equal(styled.y, legacy.y - 63);
  const rendered = drawingCanvasRenderItems({
    blockInstances: [],
    dimensionContext: { kind: "native_millimeters" },
    layers: {
      [ids.page]: { visible: true, locked: false, sortOrder: 0 },
    },
    objects: [
      {
        id: ids.canvas,
        layerId: ids.page,
        name: "회의실",
        geometry: space,
        styleId: null,
        style: {
          stroke: "#112233",
          strokeWidth: 2,
          fill: null,
          fontSize: 140,
        },
        version: 1,
      },
    ],
  });
  assert.equal(rendered[0].bounds.width, 1_802);
  assert.throws(
    () => drawingSemanticLabelLayout(space, "회의실", 0),
    RangeError,
  );
});

test("pointer and marquee selection reuse the rendered native label bounds", () => {
  const objectId = "70000000-0000-4000-8000-000000000004";
  const layerId = "70000000-0000-4000-8000-000000000005";
  const object = {
    id: objectId,
    layerId,
    name: "Styled dimension",
    geometry: {
      ...dimension,
      end: { x: 10, y: 0 },
      offset: 4,
    },
    styleId: null,
    style: { stroke: "#112233", strokeWidth: 2, fill: null, fontSize: 140 },
    version: 1,
  };
  const context = {
    actorId: ids.page,
    canEdit: true,
    layers: {
      [layerId]: {
        id: layerId,
        name: "Dimensions",
        visible: true,
        locked: false,
        systemKind: "custom",
        sortOrder: 0,
        version: 1,
      },
    },
    objects: { [objectId]: object },
    orderedCandidateIds: [objectId],
    renderBoundsById: {
      [objectId]: { x: -1, y: -1, width: 595, height: 174 },
    },
    snap: { gridSize: 10 },
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  const selected = drawingCanvas.drawingSelectionEventTransition(
    drawingCanvas.createDrawingSelectionState(),
    {
      type: "pointer_down",
      candidateId: objectId,
      pointerId: 1,
      screenPoint: { x: 400, y: 50 },
      shiftKey: false,
    },
    context,
  );
  assert.deepEqual(selected.state.selectedIds, [objectId]);

  let marquee = drawingCanvas.drawingSelectionEventTransition(
    drawingCanvas.createDrawingSelectionState(),
    {
      type: "pointer_down",
      candidateId: null,
      pointerId: 2,
      screenPoint: { x: 700, y: 50 },
      shiftKey: false,
    },
    context,
  );
  assert.notEqual(marquee.state.marquee, null);
  assert.equal(marquee.state.drag, null);
  marquee = drawingCanvas.drawingSelectionEventTransition(
    marquee.state,
    { type: "pointer_move", pointerId: 2, screenPoint: { x: 400, y: 60 } },
    context,
  );
  marquee = drawingCanvas.drawingSelectionEventTransition(
    marquee.state,
    { type: "pointer_up", pointerId: 2, screenPoint: { x: 400, y: 60 } },
    context,
  );
  assert.deepEqual(marquee.state.selectedIds, [objectId]);
});

test("styled semantic labels are exact pointer targets outside their source geometry", () => {
  const layerId = "70000000-0000-4000-8000-000000000005";
  const selectAt = (object, screenPoint) => {
    const layers = {
      [layerId]: {
        id: layerId,
        name: "Annotations",
        visible: true,
        locked: false,
        systemKind: "custom",
        sortOrder: 0,
        version: 1,
      },
    };
    const [item] = drawingCanvasRenderItems({
      blockInstances: [],
      dimensionContext: { kind: "native_millimeters" },
      layers,
      objects: [object],
    });
    return drawingCanvas.drawingSelectionEventTransition(
      drawingCanvas.createDrawingSelectionState(),
      {
        type: "pointer_down",
        candidateId: object.id,
        pointerId: 1,
        screenPoint,
        shiftKey: false,
      },
      {
        actorId: ids.page,
        canEdit: true,
        layers,
        objects: { [object.id]: object },
        orderedCandidateIds: [object.id],
        renderBoundsById: { [object.id]: item.bounds },
        snap: { gridSize: 10 },
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    ).state.selectedIds;
  };
  const style = {
    stroke: "#112233",
    strokeWidth: 2,
    fill: null,
    fontSize: 140,
  };
  const space = {
    id: "70000000-0000-4000-8000-000000000006",
    layerId,
    name: "회의실",
    geometry: {
      type: "space",
      semanticVersion: 1,
      boundary: [
        { x: 2_000, y: 2_000 },
        { x: 2_100, y: 2_000 },
        { x: 2_100, y: 2_100 },
        { x: 2_000, y: 2_100 },
      ],
      number: "101",
      finishes: { floor: null, wall: null, ceiling: null },
    },
    styleId: null,
    style,
    version: 1,
  };
  assert.deepEqual(selectAt(space, { x: 1_300, y: 2_050 }), [space.id]);

  const grid = {
    id: "70000000-0000-4000-8000-000000000007",
    layerId,
    name: "A",
    geometry: {
      type: "grid",
      semanticVersion: 1,
      start: { x: 0, y: 0 },
      end: { x: 1_000, y: 1_000 },
    },
    styleId: null,
    style,
    version: 1,
  };
  assert.deepEqual(selectAt(grid, { x: 823, y: 1_272 }), [grid.id]);
  assert.deepEqual(selectAt(grid, { x: 490, y: 940 }), []);
});

test("opening drag outline bounds follow the host-constrained preview geometry", () => {
  assert.equal(
    typeof drawingCanvas.drawingSelectionPreviewRenderBounds,
    "function",
  );
  const layerId = "70000000-0000-4000-8000-000000000008";
  const openingLayerId = "70000000-0000-4000-8000-000000000009";
  const wallId = "70000000-0000-4000-8000-000000000010";
  const openingId = "70000000-0000-4000-8000-000000000011";
  const layers = {
    [layerId]: {
      id: layerId,
      name: "Walls",
      visible: true,
      locked: false,
      systemKind: "custom",
      sortOrder: 0,
      version: 1,
    },
    [openingLayerId]: {
      id: openingLayerId,
      name: "Openings",
      visible: true,
      locked: false,
      systemKind: "custom",
      sortOrder: 1,
      version: 1,
    },
  };
  const wall = {
    id: wallId,
    layerId,
    name: "Diagonal wall",
    geometry: {
      type: "wall",
      semanticVersion: 1,
      start: { x: 0, y: 0 },
      end: { x: 4_000, y: 4_000 },
      thicknessMillimeters: 200,
      heightMillimeters: 3_000,
    },
    styleId: null,
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
    version: 1,
  };
  const opening = {
    id: openingId,
    layerId: openingLayerId,
    name: "D-01",
    geometry: {
      type: "opening",
      semanticVersion: 1,
      hostWallId: wallId,
      offsetMillimeters: 1_800,
      widthMillimeters: 900,
      heightMillimeters: 2_100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
    styleId: null,
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
    version: 1,
  };
  const objects = { [wallId]: wall, [openingId]: opening };
  const delta = { x: 1_000, y: -1_000 };
  const preview = drawingCanvas.drawingSelectionPreview({
    actorId: ids.page,
    delta,
    layers,
    objects,
    selectedIds: [openingId],
  });
  const originalBounds = drawingCanvasRenderItems({
    blockInstances: [],
    dimensionContext: { kind: "native_millimeters" },
    layers,
    objects: Object.values(objects),
  }).find((item) => item.id === openingId).bounds;
  const previewBounds = drawingCanvas.drawingSelectionPreviewRenderBounds({
    dimensionContext: { kind: "native_millimeters" },
    layers,
    objects: Object.values(objects),
    previewObjects: preview.objects,
    selectedIds: [openingId],
  });

  assert.deepEqual(preview.objects[openingId].geometry, opening.geometry);
  assert.deepEqual(previewBounds[openingId], originalBounds);
  assert.notDeepEqual(previewBounds[openingId], {
    ...originalBounds,
    x: originalBounds.x + delta.x,
    y: originalBounds.y + delta.y,
  });

  const hostDelta = { x: 300, y: 200 };
  const hostPreview = drawingCanvas.drawingSelectionPreview({
    actorId: ids.page,
    delta: hostDelta,
    layers,
    objects,
    selectedIds: [wallId, openingId],
  });
  const hostPreviewBounds = drawingCanvas.drawingSelectionPreviewRenderBounds({
    dimensionContext: { kind: "native_millimeters" },
    layers,
    objects: Object.values(objects),
    previewObjects: hostPreview.objects,
    selectedIds: [wallId, openingId],
  });
  assert.equal(hostPreviewBounds[openingId].x, originalBounds.x + hostDelta.x);
  assert.equal(hostPreviewBounds[openingId].y, originalBounds.y + hostDelta.y);
  assert.ok(
    Math.abs(hostPreviewBounds[openingId].width - originalBounds.width) < 1e-9,
  );
  assert.ok(
    Math.abs(hostPreviewBounds[openingId].height - originalBounds.height) <
      1e-9,
  );
});
