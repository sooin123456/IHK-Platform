import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { KonvaEventObject } from "konva/lib/Node";
import {
  Circle,
  Group,
  Image as KonvaImage,
  Layer,
  Line,
  Rect,
  Stage,
  Text as KonvaText,
} from "react-konva";

import {
  drawingCanvasCursor,
  drawingPanGestureTransition,
  geometryBounds,
  geometrySnapPoints,
  screenToWorld,
  snapWorldPoint,
  worldToScreen,
  zoomViewportAroundPointer,
  type DrawingPanGesture,
} from "~/lukas/lib/drawing-geometry";
import {
  moveDrawingSnapshots,
  translateDrawingGeometry,
  type DrawingCommand,
  type DrawingMoveSnapshot,
} from "~/lukas/lib/drawing-commands";
import {
  drawingCanvasRenderAdapter,
  drawingKindExclusiveSelection,
  type DrawingBlockRenderModel,
  type DrawingCanvasRenderItem,
} from "~/lukas/lib/drawing-blocks";
import {
  drawingDimensionDisplayPoints,
  drawingDimensionLabel,
  drawingDimensionLayout,
  drawingTextLayout,
} from "~/lukas/lib/drawing-layout";
import { drawingPdfImagePlacement } from "~/lukas/lib/drawing-workspace-view";
import {
  openPdfDocument,
  renderPdfPageToCanvas,
  type OpenPdfDocument,
} from "~/lukas/lib/pdf-page-renderer.client";
import type {
  Bounds,
  DrawingGeometry,
  DrawingLayer,
  DrawingObject,
  DrawingStyle,
  Point,
  Viewport,
} from "~/lukas/lib/drawing-workspace.types";
import { defaultDrawingObjectName } from "~/lukas/lib/drawing-workspace.types";
import type { DrawingAwarenessPeerStore } from "~/lukas/lib/drawing-awareness";
import { DrawingCollaborationOverlay } from "~/lukas/components/drawing-collaboration-overlay.client";
import { useDrawingAwarenessPeers } from "~/lukas/components/drawing-collaboration-presence";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
const BASE_GRID_SIZE = 10;
const SELECTION_HIT_TOLERANCE_PIXELS = 6;

export type DrawingTool =
  | "select"
  | "pan"
  | "line"
  | "polyline"
  | "rectangle"
  | "circle"
  | "text"
  | "dimension";

export type ToolSession =
  | { tool: "idle" }
  | { tool: "line"; start: Point }
  | { tool: "polyline"; points: Point[] }
  | { tool: "rectangle"; start: Point }
  | { tool: "circle"; center: Point }
  | { tool: "text"; origin: Point }
  | { tool: "dimension"; start: Point; end?: Point };

export type DrawingSnapContext = {
  gridSize: number;
  objectCandidates: Point[];
  tolerancePixels: number;
  zoom: number;
};

type DrawingCommitOptions = {
  actorId: string;
  calibrationId?: string | null;
  constrain?: boolean;
  layerId: string;
  objectId: string;
  repeatMode: boolean;
  snap: DrawingSnapContext;
  text?: string;
};

export type DrawingToolResult = {
  command: Extract<DrawingCommand, { type: "add_objects" }> | null;
  nextTool: DrawingTool;
  session: ToolSession;
};

export type DimensionCalibrationEvidence = {
  id: string;
  millimetersPerNormalizedUnit: number;
  pageHeight: number;
  pageWidth: number;
};

function snapPoint(point: Point, context: DrawingSnapContext) {
  return snapWorldPoint(point, context.objectCandidates, {
    gridSize: context.gridSize,
    tolerancePixels: context.tolerancePixels,
    zoom: context.zoom,
  }).point;
}

function nextTool(tool: Exclude<ToolSession["tool"], "idle">, repeat: boolean) {
  return repeat ? tool : "select";
}

function constrainTo45Degrees(start: Point, end: Point): Point {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) return end;
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const constrained = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
  return {
    x: start.x + Math.cos(constrained) * length,
    y: start.y + Math.sin(constrained) * length,
  };
}

function drawingObject(
  geometry: DrawingGeometry,
  options: DrawingCommitOptions,
): DrawingObject {
  return {
    id: options.objectId,
    name: defaultDrawingObjectName(geometry.type),
    layerId: options.layerId,
    geometry,
    styleId: null,
    style: {
      stroke: "#2563eb",
      strokeWidth: 2,
      fill: geometry.type === "text" ? "#2563eb" : null,
      ...(geometry.type === "text" ? { fontSize: 14 } : {}),
    },
    version: 1,
  };
}

function completedResult(
  tool: Exclude<ToolSession["tool"], "idle">,
  geometry: DrawingGeometry | null,
  options: DrawingCommitOptions,
): DrawingToolResult {
  return {
    command: geometry
      ? {
          type: "add_objects",
          actorId: options.actorId,
          objects: [drawingObject(geometry, options)],
        }
      : null,
    nextTool: nextTool(tool, options.repeatMode),
    session: { tool: "idle" },
  };
}

export function beginDrawingToolSession(
  tool: Exclude<DrawingTool, "select" | "pan">,
  point: Point,
  context: DrawingSnapContext,
): ToolSession {
  const committed = snapPoint(point, context);
  switch (tool) {
    case "line":
    case "rectangle":
      return { tool, start: committed };
    case "polyline":
      return { tool, points: [committed] };
    case "circle":
      return { tool, center: committed };
    case "text":
      return { tool, origin: committed };
    case "dimension":
      return { tool, start: committed };
  }
}

export function commitDrawingPoint(
  session: ToolSession,
  point: Point,
  options: DrawingCommitOptions,
): DrawingToolResult {
  if (session.tool === "idle" || session.tool === "text") {
    return { command: null, nextTool: "select", session };
  }
  let candidate = point;
  if (
    options.constrain &&
    (session.tool === "line" || session.tool === "dimension")
  ) {
    candidate = constrainTo45Degrees(session.start, candidate);
  }
  const committed = snapPoint(candidate, options.snap);
  if (session.tool === "polyline") {
    const lastPoint = session.points.at(-1);
    const points =
      lastPoint?.x === committed.x && lastPoint.y === committed.y
        ? session.points
        : [...session.points, committed];
    return {
      command: null,
      nextTool: "polyline",
      session: { tool: "polyline", points },
    };
  }
  if (session.tool === "line") {
    const geometry =
      session.start.x === committed.x && session.start.y === committed.y
        ? null
        : ({ type: "line", start: session.start, end: committed } as const);
    return completedResult(session.tool, geometry, options);
  }
  if (session.tool === "rectangle") {
    const width = Math.abs(committed.x - session.start.x);
    const height = Math.abs(committed.y - session.start.y);
    const geometry =
      width === 0 || height === 0
        ? null
        : ({
            type: "rectangle",
            origin: {
              x: Math.min(session.start.x, committed.x),
              y: Math.min(session.start.y, committed.y),
            },
            width,
            height,
            rotation: 0,
          } as const);
    return completedResult(session.tool, geometry, options);
  }
  if (session.tool === "circle") {
    const radius = Math.hypot(
      committed.x - session.center.x,
      committed.y - session.center.y,
    );
    const geometry =
      radius === 0
        ? null
        : ({ type: "circle", center: session.center, radius } as const);
    return completedResult(session.tool, geometry, options);
  }
  const geometry =
    session.start.x === committed.x && session.start.y === committed.y
      ? null
      : ({
          type: "dimension",
          start: session.start,
          end: committed,
          offset: 12,
          calibrationId: options.calibrationId ?? null,
        } as const);
  return completedResult(session.tool, geometry, options);
}

export function completeDrawingToolSession(
  session: ToolSession,
  options: DrawingCommitOptions,
): DrawingToolResult {
  if (session.tool === "polyline") {
    const distinct = session.points.some(
      (point) =>
        point.x !== session.points[0]?.x || point.y !== session.points[0]?.y,
    );
    return completedResult(
      session.tool,
      session.points.length >= 2 && distinct
        ? { type: "polyline", points: session.points, closed: false }
        : null,
      options,
    );
  }
  if (session.tool === "text") {
    const text = options.text?.trim() ?? "";
    return completedResult(
      session.tool,
      text ? { type: "text", origin: session.origin, width: 160, text } : null,
      options,
    );
  }
  return { command: null, nextTool: "select", session };
}

export function removeLastPolylinePoint(session: ToolSession): ToolSession {
  return session.tool === "polyline"
    ? { tool: "polyline", points: session.points.slice(0, -1) }
    : session;
}

export function cancelDrawingToolSession(): DrawingToolResult {
  return { command: null, nextTool: "select", session: { tool: "idle" } };
}

export type DrawingToolControllerContext = {
  activeTool: DrawingTool;
  actorId: string;
  calibrationId: string | null;
  canEdit: boolean;
  layerId: string | null;
  objectId: string;
  repeatMode: boolean;
  snap: Omit<DrawingSnapContext, "zoom">;
  viewport: Viewport;
};

export type DrawingToolControllerState = {
  activeTool: DrawingTool;
  canEdit: boolean;
  dragPointerId: number | null;
  editLayerId: string | null;
  previewPoint: Point | null;
  session: ToolSession;
};

export type DrawingPointerCaptureIntent = {
  type: "set" | "release";
  pointerId: number;
};

export type DrawingToolControllerEvent =
  | { type: "sync_context" }
  | {
      type: "pointer_down";
      button: number;
      pointerId: number;
      screenPoint: Point;
      shiftKey: boolean;
    }
  | {
      type: "pointer_move";
      pointerId: number;
      screenPoint: Point;
      shiftKey: boolean;
    }
  | {
      type: "pointer_up";
      pointerId: number;
      screenPoint: Point;
      shiftKey: boolean;
    }
  | { type: "pointer_cancel"; pointerId: number }
  | { type: "double_click" }
  | { type: "key_down"; key: string; text?: string };

export type DrawingToolControllerResult = {
  command: Extract<DrawingCommand, { type: "add_objects" }> | null;
  nextTool: DrawingTool | null;
  pointerCapture: DrawingPointerCaptureIntent | null;
  state: DrawingToolControllerState;
};

function authorizedLayer(context: DrawingToolControllerContext) {
  return context.canEdit ? context.layerId : null;
}

export function createDrawingToolControllerState(
  context: DrawingToolControllerContext,
): DrawingToolControllerState {
  return {
    activeTool: context.activeTool,
    canEdit: context.canEdit,
    dragPointerId: null,
    editLayerId: authorizedLayer(context),
    previewPoint: null,
    session: { tool: "idle" },
  };
}

export function drawingToolSessionOwnsKey(
  state: DrawingToolControllerState,
  key: string,
) {
  if (state.session.tool === "idle") return false;
  if (key === "Backspace")
    return state.session.tool === "polyline" || state.session.tool === "text";
  return key === "Escape" || key === "Enter";
}

function controllerResult(
  state: DrawingToolControllerState,
  changes: Partial<
    Omit<DrawingToolControllerResult, "state"> & {
      state: DrawingToolControllerState;
    }
  > = {},
): DrawingToolControllerResult {
  return {
    command: null,
    nextTool: null,
    pointerCapture: null,
    state,
    ...changes,
  };
}

function synchronizedController(
  state: DrawingToolControllerState,
  context: DrawingToolControllerContext,
) {
  const changed =
    state.activeTool !== context.activeTool ||
    state.canEdit !== context.canEdit ||
    state.editLayerId !== authorizedLayer(context);
  if (!changed) return { changed: false, result: controllerResult(state) };
  return {
    changed: true,
    result: controllerResult(createDrawingToolControllerState(context), {
      nextTool: context.canEdit ? null : "select",
      pointerCapture:
        state.dragPointerId === null
          ? null
          : { type: "release", pointerId: state.dragPointerId },
    }),
  };
}

function controllerSnapContext(
  context: DrawingToolControllerContext,
): DrawingSnapContext {
  return { ...context.snap, zoom: context.viewport.zoom };
}

function controllerCommitOptions(
  context: DrawingToolControllerContext,
  constrain = false,
  text?: string,
): DrawingCommitOptions | null {
  const layerId = authorizedLayer(context);
  if (!layerId) return null;
  return {
    actorId: context.actorId,
    calibrationId: context.calibrationId,
    constrain,
    layerId,
    objectId: context.objectId,
    repeatMode: context.repeatMode,
    snap: controllerSnapContext(context),
    text,
  };
}

function completedControllerResult(
  state: DrawingToolControllerState,
  completed: DrawingToolResult,
  pointerCapture: DrawingPointerCaptureIntent | null = null,
) {
  return controllerResult(
    {
      ...state,
      dragPointerId: null,
      previewPoint: null,
      session: completed.session,
    },
    {
      command: completed.command,
      nextTool: completed.nextTool,
      pointerCapture,
    },
  );
}

function controllerWorldPoint(
  screenPoint: Point,
  context: DrawingToolControllerContext,
) {
  return screenToWorld(screenPoint, context.viewport);
}

export function drawingToolEventTransition(
  state: DrawingToolControllerState,
  event: DrawingToolControllerEvent,
  context: DrawingToolControllerContext,
): DrawingToolControllerResult {
  const synchronized = synchronizedController(state, context);
  if (event.type === "sync_context" || synchronized.changed)
    return synchronized.result;
  if (!context.canEdit || !context.layerId)
    return controllerResult(createDrawingToolControllerState(context));

  const snap = controllerSnapContext(context);
  if (event.type === "pointer_down") {
    if (
      event.button !== 0 ||
      context.activeTool === "select" ||
      context.activeTool === "pan"
    )
      return controllerResult(state);
    const worldPoint = controllerWorldPoint(event.screenPoint, context);
    if (context.activeTool === "text") {
      return controllerResult({
        ...state,
        previewPoint: null,
        session: beginDrawingToolSession("text", worldPoint, snap),
      });
    }
    if (context.activeTool === "polyline") {
      if (state.session.tool === "polyline") {
        const options = controllerCommitOptions(context);
        if (!options) return controllerResult(state);
        const added = commitDrawingPoint(state.session, worldPoint, options);
        return controllerResult({
          ...state,
          previewPoint: null,
          session: added.session,
        });
      }
      return controllerResult({
        ...state,
        previewPoint: null,
        session: beginDrawingToolSession("polyline", worldPoint, snap),
      });
    }
    if (context.activeTool === "line" || context.activeTool === "dimension") {
      if (state.session.tool === context.activeTool) {
        const options = controllerCommitOptions(context, event.shiftKey);
        return options
          ? completedControllerResult(
              state,
              commitDrawingPoint(state.session, worldPoint, options),
            )
          : controllerResult(state);
      }
      return controllerResult({
        ...state,
        previewPoint: null,
        session: beginDrawingToolSession(context.activeTool, worldPoint, snap),
      });
    }
    return controllerResult(
      {
        ...state,
        dragPointerId: event.pointerId,
        previewPoint: null,
        session: beginDrawingToolSession(context.activeTool, worldPoint, snap),
      },
      { pointerCapture: { type: "set", pointerId: event.pointerId } },
    );
  }

  if (event.type === "pointer_move") {
    if (
      state.session.tool === "idle" ||
      state.session.tool === "text" ||
      (state.dragPointerId !== null && state.dragPointerId !== event.pointerId)
    )
      return controllerResult(state);
    let candidate = controllerWorldPoint(event.screenPoint, context);
    if (
      event.shiftKey &&
      (state.session.tool === "line" || state.session.tool === "dimension")
    ) {
      candidate = constrainTo45Degrees(state.session.start, candidate);
    }
    return controllerResult({
      ...state,
      previewPoint: snapPoint(candidate, snap),
    });
  }

  if (event.type === "pointer_up") {
    if (
      state.dragPointerId !== event.pointerId ||
      (state.session.tool !== "rectangle" && state.session.tool !== "circle")
    )
      return controllerResult(state);
    const options = controllerCommitOptions(context, event.shiftKey);
    if (!options) return controllerResult(state);
    return completedControllerResult(
      state,
      commitDrawingPoint(
        state.session,
        controllerWorldPoint(event.screenPoint, context),
        options,
      ),
      { type: "release", pointerId: event.pointerId },
    );
  }

  if (event.type === "pointer_cancel") {
    const pointerCapture =
      state.dragPointerId === event.pointerId
        ? { type: "release" as const, pointerId: event.pointerId }
        : null;
    return controllerResult(createDrawingToolControllerState(context), {
      nextTool: state.session.tool === "idle" ? null : "select",
      pointerCapture,
    });
  }

  if (event.type === "double_click") {
    if (state.session.tool !== "polyline") return controllerResult(state);
    const options = controllerCommitOptions(context);
    return options
      ? completedControllerResult(
          state,
          completeDrawingToolSession(state.session, options),
        )
      : controllerResult(state);
  }

  if (event.key === "Escape") {
    const cancelled = cancelDrawingToolSession();
    return completedControllerResult(
      state,
      cancelled,
      state.dragPointerId === null
        ? null
        : { type: "release", pointerId: state.dragPointerId },
    );
  }
  if (event.key === "Backspace" && state.session.tool === "polyline") {
    return controllerResult({
      ...state,
      previewPoint: null,
      session: removeLastPolylinePoint(state.session),
    });
  }
  if (
    event.key === "Enter" &&
    (state.session.tool === "polyline" || state.session.tool === "text")
  ) {
    const options = controllerCommitOptions(context, false, event.text);
    return options
      ? completedControllerResult(
          state,
          completeDrawingToolSession(state.session, options),
        )
      : controllerResult(state);
  }
  return controllerResult(state);
}

export type DrawingSelectionState = {
  selectedIds: string[];
  marquee: {
    pointerId: number;
    start: Point;
    current: Point;
    additive: boolean;
    initialSelectedIds: string[];
  } | null;
  drag: {
    pointerId: number;
    start: Point;
    snapshots: DrawingMoveSnapshot[];
  } | null;
  previewDelta: Point;
};

export type DrawingSelectionContext = {
  actorId: string;
  canEdit: boolean;
  layers: Record<string, DrawingLayer>;
  objects: Record<string, DrawingObject>;
  snap: { gridSize: number };
  viewport: Viewport;
  lockedEntityIds?: ReadonlySet<string>;
};

export type DrawingSelectionEvent =
  | { type: "sync_context" }
  | {
      type: "pointer_down";
      candidateId: string | null;
      pointerId: number;
      screenPoint: Point;
      shiftKey: boolean;
    }
  | { type: "pointer_move"; pointerId: number; screenPoint: Point }
  | { type: "pointer_up"; pointerId: number; screenPoint: Point }
  | { type: "pointer_cancel"; pointerId: number };

export type DrawingSelectionResult = {
  command: Extract<DrawingCommand, { type: "update_objects" }> | null;
  pointerCapture?: DrawingPointerCaptureIntent | null;
  state: DrawingSelectionState;
};

export function createDrawingSelectionState(
  selectedIds: string[] = [],
): DrawingSelectionState {
  return {
    selectedIds: [...new Set(selectedIds)],
    marquee: null,
    drag: null,
    previewDelta: { x: 0, y: 0 },
  };
}

function selectableDrawingObject(
  context: DrawingSelectionContext,
  objectId: string,
) {
  const object = context.objects[objectId];
  const layer = object ? context.layers[object.layerId] : undefined;
  return object && layer?.visible && !layer.locked ? object : null;
}

/** Expands canonical object bounds by a fixed screen-space hit tolerance. */
export function drawingSelectionHitBounds(
  geometry: DrawingGeometry,
  zoom: number,
  tolerancePixels = SELECTION_HIT_TOLERANCE_PIXELS,
) {
  if (!Number.isFinite(zoom) || zoom <= 0)
    throw new Error("확대 배율이 올바르지 않습니다.");
  const bounds = geometryBounds(geometry);
  const tolerance = tolerancePixels / zoom;
  return {
    x: bounds.x - tolerance,
    y: bounds.y - tolerance,
    width: bounds.width + tolerance * 2,
    height: bounds.height + tolerance * 2,
  };
}

export function drawingSelectionCandidates(
  objects: DrawingObject[],
  layers: Record<string, DrawingLayer>,
  zoom: number,
) {
  return objects.flatMap((object) => {
    const layer = layers[object.layerId];
    return layer?.visible && !layer.locked
      ? [
          {
            id: object.id,
            bounds: drawingSelectionHitBounds(object.geometry, zoom),
          },
        ]
      : [];
  });
}

function pointInBounds(
  point: Point,
  bounds: ReturnType<typeof geometryBounds>,
) {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
}

function normalizedBounds(first: Point, second: Point) {
  return {
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(second.x - first.x),
    height: Math.abs(second.y - first.y),
  };
}

function boundsIntersect(
  first: ReturnType<typeof normalizedBounds>,
  second: ReturnType<typeof geometryBounds>,
) {
  return (
    first.x <= second.x + second.width &&
    first.x + first.width >= second.x &&
    first.y <= second.y + second.height &&
    first.y + first.height >= second.y
  );
}

function snappedDragDelta(
  start: Point,
  current: Point,
  gridSize: number,
): Point {
  const delta = { x: current.x - start.x, y: current.y - start.y };
  if (!Number.isFinite(gridSize) || gridSize <= 0) return delta;
  return {
    x: Math.round(delta.x / gridSize) * gridSize,
    y: Math.round(delta.y / gridSize) * gridSize,
  };
}

function drawingSelectionSnapshots(
  selectedIds: string[],
  context: DrawingSelectionContext,
): DrawingMoveSnapshot[] {
  return selectedIds.flatMap((objectId) => {
    const object = selectableDrawingObject(context, objectId);
    return object
      ? [
          {
            id: object.id,
            layerId: object.layerId,
            geometry: structuredClone(object.geometry),
            version: object.version,
          },
        ]
      : [];
  });
}

function drawingSelectionDragIsValid(
  state: DrawingSelectionState,
  context: DrawingSelectionContext,
) {
  if (!state.drag || !context.canEdit) return false;
  if (state.drag.snapshots.length !== state.selectedIds.length) return false;
  return state.drag.snapshots.every((snapshot, index) => {
    if (state.selectedIds[index] !== snapshot.id) return false;
    const current = selectableDrawingObject(context, snapshot.id);
    return (
      !context.lockedEntityIds?.has(snapshot.id) &&
      current?.version === snapshot.version &&
      current.layerId === snapshot.layerId &&
      JSON.stringify(current.geometry) === JSON.stringify(snapshot.geometry)
    );
  });
}

function selectionPointerMove(
  state: DrawingSelectionState,
  pointerId: number,
  screenPoint: Point,
  context: DrawingSelectionContext,
): DrawingSelectionState {
  const worldPoint = screenToWorld(screenPoint, context.viewport);
  if (state.drag?.pointerId === pointerId) {
    return {
      ...state,
      previewDelta: snappedDragDelta(
        state.drag.start,
        worldPoint,
        context.snap.gridSize,
      ),
    };
  }
  if (state.marquee?.pointerId === pointerId) {
    return {
      ...state,
      marquee: { ...state.marquee, current: worldPoint },
    };
  }
  return state;
}

/** Pure selection gesture adapter; renderer nodes are only candidate hints. */
export function drawingSelectionEventTransition(
  state: DrawingSelectionState,
  event: DrawingSelectionEvent,
  context: DrawingSelectionContext,
): DrawingSelectionResult {
  if (event.type === "sync_context") {
    const selectedIds = state.selectedIds.filter((objectId) =>
      Boolean(selectableDrawingObject(context, objectId)),
    );
    const invalidDrag = Boolean(
      state.drag &&
        (!drawingSelectionDragIsValid(state, context) ||
          selectedIds.length !== state.selectedIds.length),
    );
    return {
      command: null,
      pointerCapture:
        invalidDrag && state.drag
          ? { type: "release", pointerId: state.drag.pointerId }
          : null,
      state: {
        ...state,
        selectedIds,
        drag: invalidDrag ? null : state.drag,
        previewDelta: invalidDrag ? { x: 0, y: 0 } : state.previewDelta,
      },
    };
  }
  if (event.type === "pointer_cancel") {
    if (
      state.drag?.pointerId !== event.pointerId &&
      state.marquee?.pointerId !== event.pointerId
    )
      return { command: null, state };
    return {
      command: null,
      pointerCapture: { type: "release", pointerId: event.pointerId },
      state: {
        ...state,
        drag: null,
        marquee: null,
        previewDelta: { x: 0, y: 0 },
      },
    };
  }
  if (event.type === "pointer_move") {
    return {
      command: null,
      state: selectionPointerMove(
        state,
        event.pointerId,
        event.screenPoint,
        context,
      ),
    };
  }
  if (event.type === "pointer_down") {
    const point = screenToWorld(event.screenPoint, context.viewport);
    if (event.candidateId !== null) {
      const candidate = selectableDrawingObject(context, event.candidateId);
      if (
        !candidate ||
        !pointInBounds(
          point,
          drawingSelectionHitBounds(candidate.geometry, context.viewport.zoom),
        )
      )
        return { command: null, state };
      const eligibleSelectedIds = state.selectedIds.filter((objectId) =>
        Boolean(selectableDrawingObject(context, objectId)),
      );
      const alreadySelected = eligibleSelectedIds.includes(candidate.id);
      const selectedIds = event.shiftKey
        ? alreadySelected
          ? eligibleSelectedIds.filter((objectId) => objectId !== candidate.id)
          : [...eligibleSelectedIds, candidate.id]
        : alreadySelected
          ? eligibleSelectedIds
          : [candidate.id];
      const snapshots = drawingSelectionSnapshots(selectedIds, context);
      return {
        command: null,
        state: {
          selectedIds,
          marquee: null,
          drag:
            context.canEdit &&
            !selectedIds.some((id) => context.lockedEntityIds?.has(id)) &&
            selectedIds.includes(candidate.id) &&
            snapshots.length === selectedIds.length
              ? { pointerId: event.pointerId, start: point, snapshots }
              : null,
          previewDelta: { x: 0, y: 0 },
        },
      };
    }
    return {
      command: null,
      state: {
        ...state,
        marquee: {
          pointerId: event.pointerId,
          start: point,
          current: point,
          additive: event.shiftKey,
          initialSelectedIds: state.selectedIds.filter((objectId) =>
            Boolean(selectableDrawingObject(context, objectId)),
          ),
        },
        drag: null,
        previewDelta: { x: 0, y: 0 },
      },
    };
  }

  const moved = selectionPointerMove(
    state,
    event.pointerId,
    event.screenPoint,
    context,
  );
  if (moved.drag?.pointerId === event.pointerId) {
    const valid = drawingSelectionDragIsValid(moved, context);
    const command =
      valid && (moved.previewDelta.x !== 0 || moved.previewDelta.y !== 0)
        ? moveDrawingSnapshots(
            moved.drag.snapshots,
            context.actorId,
            moved.previewDelta,
          )
        : null;
    return {
      command,
      pointerCapture: valid
        ? null
        : { type: "release", pointerId: event.pointerId },
      state: {
        ...moved,
        drag: null,
        previewDelta: { x: 0, y: 0 },
      },
    };
  }
  if (moved.marquee?.pointerId === event.pointerId) {
    const marquee = normalizedBounds(
      moved.marquee.start,
      moved.marquee.current,
    );
    const intersecting = Object.values(context.objects)
      .filter(
        (object) =>
          selectableDrawingObject(context, object.id) &&
          boundsIntersect(marquee, geometryBounds(object.geometry)),
      )
      .map((object) => object.id);
    return {
      command: null,
      state: {
        ...moved,
        selectedIds: moved.marquee.additive
          ? [...new Set([...moved.marquee.initialSelectedIds, ...intersecting])]
          : intersecting,
        marquee: null,
      },
    };
  }
  return { command: null, state: moved };
}

export function drawingSelectionHandleSize(zoom: number, pixels = 8) {
  if (!Number.isFinite(zoom) || zoom <= 0)
    throw new Error("확대 배율이 올바르지 않습니다.");
  return pixels / zoom;
}

export function dimensionLabel(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
  calibration?: DimensionCalibrationEvidence | null,
) {
  if (geometry.calibrationId === null) return "미보정";
  return drawingDimensionLabel(geometry, calibration);
}

export function dimensionDisplayPoints(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
) {
  return drawingDimensionDisplayPoints(geometry);
}

export type DrawingCanvasBackground =
  | { kind: "blank"; width: number; height: number }
  | {
      kind: "pdf";
      width: number;
      height: number;
      pageNumber: number;
      signedUrl: string;
    };

export type DrawingCanvasHandle = {
  getViewport: () => Viewport;
  resetViewport: () => void;
  setViewport: (viewport: Viewport) => void;
};

type DrawingCanvasProps = {
  activeCanvasId: string;
  activeTool: DrawingTool;
  actorId: string;
  background: DrawingCanvasBackground;
  blockInstances: Array<DrawingBlockRenderModel & { bounds: Bounds }>;
  calibration: DimensionCalibrationEvidence | null;
  calibrationId: string | null;
  canEdit: boolean;
  layerId: string | null;
  layers: DrawingLayer[];
  objects: Array<DrawingObject & { style: DrawingStyle }>;
  onCommand: (command: DrawingCommand) => void;
  onSelectionChange: (selectedIds: string[]) => void;
  onToolComplete: (tool: DrawingTool) => void;
  onViewportChange?: (viewport: Viewport) => void;
  repeatMode: boolean;
  selectedIds: string[];
  awarenessStore: DrawingAwarenessPeerStore;
  onCursorWorldChange: (point: Point | null) => void;
  onSoftLockChange: (entityId: string | null) => void;
};

type CanvasSize = { width: number; height: number };

export function drawingRemoteSelectionBounds(
  selectedIds: readonly string[],
  items: readonly {
    bounds: Bounds;
    id: string;
    kind: "object" | "block";
  }[],
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  return selectedIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [{ id, kind: item.kind, bounds: item.bounds }] : [];
  });
}

function clampZoom(zoom: number) {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

function safeViewport(viewport: Viewport): Viewport {
  return {
    x: Number.isFinite(viewport.x) ? viewport.x : 0,
    y: Number.isFinite(viewport.y) ? viewport.y : 0,
    zoom: clampZoom(viewport.zoom),
  };
}

export function drawingFittedViewport(
  size: CanvasSize,
  background: DrawingCanvasBackground,
) {
  const availableWidth = Math.max(1, size.width - 80);
  const availableHeight = Math.max(1, size.height - 80);
  const zoom = clampZoom(
    Math.min(
      availableWidth / background.width,
      availableHeight / background.height,
    ),
  );
  return {
    x: (size.width - background.width * zoom) / 2,
    y: (size.height - background.height * zoom) / 2,
    zoom,
  };
}

function visibleGrid(
  size: CanvasSize,
  viewport: Viewport,
): { vertical: number[]; horizontal: number[] } {
  if (size.width <= 0 || size.height <= 0)
    return { vertical: [], horizontal: [] };
  const start = screenToWorld({ x: 0, y: 0 }, viewport);
  const end = screenToWorld({ x: size.width, y: size.height }, viewport);
  const multiplier = Math.max(
    1,
    2 ** Math.ceil(Math.log2(16 / (BASE_GRID_SIZE * viewport.zoom))),
  );
  const step = BASE_GRID_SIZE * multiplier;
  const firstX = Math.floor(start.x / step) * step;
  const firstY = Math.floor(start.y / step) * step;
  const vertical: number[] = [];
  const horizontal: number[] = [];
  for (let x = firstX; x <= end.x + step && vertical.length < 500; x += step)
    vertical.push(x);
  for (let y = firstY; y <= end.y + step && horizontal.length < 500; y += step)
    horizontal.push(y);
  return { vertical, horizontal };
}

function isCancelled(error: unknown) {
  return (
    (error instanceof Error &&
      (error.name === "AbortError" ||
        error.name === "RenderingCancelledException")) ||
    false
  );
}

function geometryShape(
  geometry: DrawingGeometry,
  style: DrawingStyle,
  preview = false,
  calibration?: DimensionCalibrationEvidence | null,
) {
  const common = {
    dash: preview ? [8, 5] : undefined,
    listening: false,
    opacity: preview ? 0.75 : 1,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
  };
  switch (geometry.type) {
    case "line":
      return (
        <Line
          {...common}
          points={[
            geometry.start.x,
            geometry.start.y,
            geometry.end.x,
            geometry.end.y,
          ]}
        />
      );
    case "polyline":
      return (
        <Line
          {...common}
          closed={geometry.closed}
          points={geometry.points.flatMap((point) => [point.x, point.y])}
        />
      );
    case "rectangle":
      return (
        <Rect
          {...common}
          fill={style.fill ?? undefined}
          height={geometry.height}
          rotation={geometry.rotation}
          width={geometry.width}
          x={geometry.origin.x}
          y={geometry.origin.y}
        />
      );
    case "circle":
      return (
        <Circle
          {...common}
          fill={style.fill ?? undefined}
          radius={geometry.radius}
          x={geometry.center.x}
          y={geometry.center.y}
        />
      );
    case "text": {
      const textLayout = drawingTextLayout(geometry, style.fontSize ?? 14);
      return (
        <KonvaText
          fill={style.fill ?? style.stroke}
          fontSize={textLayout.fontSize}
          height={textLayout.height}
          lineHeight={textLayout.lineHeight}
          listening={false}
          opacity={preview ? 0.75 : 1}
          text={geometry.text}
          width={textLayout.width}
          wrap={textLayout.wrap}
          x={geometry.origin.x}
          y={geometry.origin.y}
        />
      );
    }
    case "dimension": {
      const layout = drawingDimensionLayout(geometry, calibration);
      const { displayEnd, displayStart, label } = layout;
      return (
        <>
          <Line
            {...common}
            points={[
              displayStart.x,
              displayStart.y,
              displayEnd.x,
              displayEnd.y,
            ]}
          />
          <Line
            {...common}
            points={[
              geometry.start.x,
              geometry.start.y,
              displayStart.x,
              displayStart.y,
            ]}
          />
          <Line
            {...common}
            points={[
              geometry.end.x,
              geometry.end.y,
              displayEnd.x,
              displayEnd.y,
            ]}
          />
          <KonvaText
            fill={geometry.calibrationId === null ? "#dc2626" : style.stroke}
            fontSize={layout.fontSize}
            height={layout.height}
            lineHeight={layout.lineHeight}
            listening={false}
            text={layout.text}
            width={layout.width}
            wrap={layout.wrap}
            x={label.x}
            y={label.y}
          />
        </>
      );
    }
  }
}

type CommittedDrawingLayerProps = {
  calibration: DimensionCalibrationEvidence | null;
  items: DrawingCanvasRenderItem[];
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
};

// The workspace keeps `objects` and `calibration` identities stable. Passing
// viewport primitives limits this memo boundary to actual committed-layer work.
const CommittedDrawingLayer = memo(function CommittedDrawingLayer({
  calibration,
  items,
  viewportX,
  viewportY,
  viewportZoom,
}: CommittedDrawingLayerProps) {
  return (
    <Layer
      listening={false}
      name="drawing-objects"
      scaleX={viewportZoom}
      scaleY={viewportZoom}
      x={viewportX}
      y={viewportY}
    >
      {items.map((item) =>
        item.kind === "object" ? (
          <Group key={item.id} listening={false}>
            {geometryShape(
              item.object.geometry,
              item.object.style,
              false,
              calibration,
            )}
          </Group>
        ) : (
          <Group
            key={item.id}
            listening={false}
            rotation={item.model.instance.rotation}
            scaleX={item.model.instance.scaleX}
            scaleY={item.model.instance.scaleY}
            x={item.model.instance.origin.x}
            y={item.model.instance.origin.y}
          >
            {item.model.primitives.map((primitive) => (
              <Group key={primitive.localId} listening={false}>
                {geometryShape(
                  primitive.geometry,
                  primitive.style,
                  false,
                  calibration,
                )}
              </Group>
            ))}
          </Group>
        ),
      )}
    </Layer>
  );
});

function previewGeometry(
  session: ToolSession,
  point: Point | null,
  calibrationId: string | null,
): DrawingGeometry | null {
  if (!point || session.tool === "idle" || session.tool === "text") return null;
  if (session.tool === "line")
    return session.start.x === point.x && session.start.y === point.y
      ? null
      : { type: "line", start: session.start, end: point };
  if (session.tool === "polyline") {
    const points = [...session.points, point];
    return points.length < 2
      ? null
      : { type: "polyline", points, closed: false };
  }
  if (session.tool === "rectangle") {
    const width = Math.abs(point.x - session.start.x);
    const height = Math.abs(point.y - session.start.y);
    return width === 0 || height === 0
      ? null
      : {
          type: "rectangle",
          origin: {
            x: Math.min(session.start.x, point.x),
            y: Math.min(session.start.y, point.y),
          },
          width,
          height,
          rotation: 0,
        };
  }
  if (session.tool === "circle") {
    const radius = Math.hypot(
      point.x - session.center.x,
      point.y - session.center.y,
    );
    return radius === 0
      ? null
      : { type: "circle", center: session.center, radius };
  }
  return session.start.x === point.x && session.start.y === point.y
    ? null
    : {
        type: "dimension",
        start: session.start,
        end: point,
        offset: 12,
        calibrationId,
      };
}

export const DrawingCanvas = forwardRef<
  DrawingCanvasHandle,
  DrawingCanvasProps
>(function DrawingCanvas(
  {
    activeCanvasId,
    activeTool,
    actorId,
    background,
    blockInstances,
    calibration,
    calibrationId,
    canEdit,
    layerId,
    layers,
    objects,
    onCommand,
    onSelectionChange,
    onToolComplete,
    onViewportChange,
    repeatMode,
    selectedIds,
    awarenessStore,
    onCursorWorldChange,
    onSoftLockChange,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const awarenessPeers = useDrawingAwarenessPeers(awarenessStore);
  const remotelyLockedIds = useMemo(
    () =>
      new Set(
        awarenessPeers.flatMap((peer) =>
          peer.softLocks.map((lock) => lock.entityId),
        ),
      ),
    [awarenessPeers],
  );
  const viewportRef = useRef<Viewport>({ x: 40, y: 40, zoom: 1 });
  const fitPendingRef = useRef(true);
  const panGestureRef = useRef<DrawingPanGesture | null>(null);
  const spacePressedRef = useRef(false);
  const capturedPointerTargetRef = useRef<HTMLElement | null>(null);
  const capturedSelectionTargetRef = useRef<HTMLElement | null>(null);
  const layersById = useMemo(
    () => Object.fromEntries(layers.map((layer) => [layer.id, layer])),
    [layers],
  );
  const objectsById = useMemo(
    () => Object.fromEntries(objects.map((object) => [object.id, object])),
    [objects],
  );
  const blockInstancesById = useMemo(
    () =>
      Object.fromEntries(
        blockInstances.map((model) => [model.instance.id, model]),
      ),
    [blockInstances],
  );
  const objectIdSet = useMemo(
    () => new Set(Object.keys(objectsById)),
    [objectsById],
  );
  const blockInstanceIdSet = useMemo(
    () => new Set(Object.keys(blockInstancesById)),
    [blockInstancesById],
  );
  const objectCandidates = useMemo(
    () => objects.flatMap((object) => geometrySnapPoints(object.geometry)),
    [objects],
  );
  const [controllerState, setControllerState] =
    useState<DrawingToolControllerState>(() =>
      createDrawingToolControllerState({
        activeTool,
        actorId,
        calibrationId,
        canEdit,
        layerId,
        objectId: "",
        repeatMode,
        snap: {
          gridSize: BASE_GRID_SIZE,
          objectCandidates,
          tolerancePixels: 8,
        },
        viewport: viewportRef.current,
      }),
    );
  const controllerRef = useRef(controllerState);
  const [selectionState, setSelectionState] = useState<DrawingSelectionState>(
    () => createDrawingSelectionState(selectedIds),
  );
  const selectionRef = useRef(selectionState);
  const [spacePressed, setSpacePressed] = useState(false);
  const [panGesture, setPanGesture] = useState<DrawingPanGesture | null>(null);
  const [textValue, setTextValue] = useState("");
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [viewport, setViewportState] = useState<Viewport>(viewportRef.current);
  const [pdfSource, setPdfSource] = useState<{
    canvas: HTMLCanvasElement;
    bounds: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [pdfMessage, setPdfMessage] = useState("");
  const toolContextRef = useRef<DrawingToolControllerContext>({
    activeTool,
    actorId,
    calibrationId,
    canEdit,
    layerId,
    objectId: "",
    repeatMode,
    snap: {
      gridSize: BASE_GRID_SIZE,
      objectCandidates,
      tolerancePixels: 8,
    },
    viewport: viewportRef.current,
  });
  toolContextRef.current = {
    activeTool,
    actorId,
    calibrationId,
    canEdit,
    layerId,
    objectId: "",
    repeatMode,
    snap: {
      gridSize: BASE_GRID_SIZE,
      objectCandidates,
      tolerancePixels: 8,
    },
    viewport,
  };
  const selectionContextRef = useRef<DrawingSelectionContext>({
    actorId,
    canEdit,
    layers: layersById,
    objects: objectsById,
    snap: { gridSize: BASE_GRID_SIZE },
    viewport: viewportRef.current,
    lockedEntityIds: remotelyLockedIds,
  });
  selectionContextRef.current = {
    actorId,
    canEdit,
    layers: layersById,
    objects: objectsById,
    snap: { gridSize: BASE_GRID_SIZE },
    viewport,
    lockedEntityIds: remotelyLockedIds,
  };

  const setViewport = useCallback(
    (next: Viewport) => {
      const safe = safeViewport(next);
      viewportRef.current = safe;
      setViewportState(safe);
      onViewportChange?.(safe);
    },
    [onViewportChange],
  );

  const resetViewport = useCallback(() => {
    if (size.width <= 0 || size.height <= 0) return;
    setViewport(drawingFittedViewport(size, background));
  }, [background, setViewport, size]);

  useImperativeHandle(
    ref,
    () => ({
      getViewport: () => viewportRef.current,
      resetViewport,
      setViewport,
    }),
    [resetViewport, setViewport],
  );

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const updateSize = (width: number, height: number) =>
      setSize({
        width: Math.max(0, Math.floor(width)),
        height: Math.max(0, Math.floor(height)),
      });
    const bounds = host.getBoundingClientRect();
    updateSize(bounds.width, bounds.height);
    const observer = new ResizeObserver(([entry]) =>
      updateSize(entry.contentRect.width, entry.contentRect.height),
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fitPendingRef.current = true;
  }, [background.height, background.kind, background.width]);

  useEffect(() => {
    if (!fitPendingRef.current || size.width <= 0 || size.height <= 0) return;
    fitPendingRef.current = false;
    setViewport(drawingFittedViewport(size, background));
  }, [background, setViewport, size]);

  useEffect(() => {
    if (background.kind !== "pdf") {
      setPdfSource(null);
      setPdfMessage("");
      return;
    }
    let alive = true;
    let opened: OpenPdfDocument | null = null;
    let renderCleanup: (() => void) | null = null;
    const controller = new AbortController();
    const canvas = document.createElement("canvas");
    setPdfSource(null);
    setPdfMessage("PDF 배경을 준비하는 중입니다.");
    void openPdfDocument(background.signedUrl, controller.signal)
      .then(async (nextDocument) => {
        if (!alive || controller.signal.aborted) {
          await nextDocument.destroy();
          return;
        }
        opened = nextDocument;
        const rendered = await renderPdfPageToCanvas({
          document: nextDocument.document,
          pageNumber: background.pageNumber,
          canvas,
          hostWidth: 1600,
          zoom: 1,
          signal: controller.signal,
        });
        renderCleanup = rendered.cleanup;
        const sourceBounds = drawingPdfImagePlacement(rendered.canvasSize, {
          width: background.width,
          height: background.height,
        });
        if (!alive || controller.signal.aborted) {
          rendered.cleanup();
          renderCleanup = null;
          return;
        }
        setPdfSource({ canvas, bounds: sourceBounds });
        setPdfMessage("PDF 원본 배경을 표시하고 있습니다.");
      })
      .catch((error: unknown) => {
        renderCleanup?.();
        renderCleanup = null;
        const failedDocument = opened;
        opened = null;
        void failedDocument?.destroy();
        canvas.width = 0;
        canvas.height = 0;
        if (!alive || controller.signal.aborted || isCancelled(error)) return;
        setPdfMessage(
          error instanceof Error
            ? error.message
            : "PDF 배경을 열지 못했습니다.",
        );
      });
    return () => {
      alive = false;
      controller.abort();
      renderCleanup?.();
      const documentToDestroy = opened;
      opened = null;
      void documentToDestroy?.destroy();
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [
    background.kind,
    background.height,
    background.kind === "pdf" ? background.pageNumber : 0,
    background.kind === "pdf" ? background.signedUrl : "",
    background.width,
  ]);

  const applyToolControllerResult = useCallback(
    (result: DrawingToolControllerResult, target?: HTMLElement | null) => {
      const previousSession = controllerRef.current.session;
      const captureTarget = target ?? capturedPointerTargetRef.current;
      if (result.pointerCapture?.type === "set") {
        captureTarget?.setPointerCapture?.(result.pointerCapture.pointerId);
        capturedPointerTargetRef.current = captureTarget ?? null;
      } else if (result.pointerCapture?.type === "release") {
        if (captureTarget?.hasPointerCapture?.(result.pointerCapture.pointerId))
          captureTarget.releasePointerCapture(result.pointerCapture.pointerId);
        capturedPointerTargetRef.current = null;
      }
      if (result.state !== controllerRef.current) {
        controllerRef.current = result.state;
        setControllerState(result.state);
      }
      if (
        result.state.session.tool !== "text" ||
        result.state.session !== previousSession
      )
        setTextValue("");
      if (result.command) onCommand(result.command);
      if (result.nextTool) onToolComplete(result.nextTool);
    },
    [onCommand, onToolComplete],
  );

  const applySelectionResult = useCallback(
    (result: DrawingSelectionResult) => {
      const previous = selectionRef.current;
      const captureTarget = capturedSelectionTargetRef.current;
      if (result.pointerCapture?.type === "release") {
        if (captureTarget?.hasPointerCapture?.(result.pointerCapture.pointerId))
          captureTarget.releasePointerCapture(result.pointerCapture.pointerId);
        capturedSelectionTargetRef.current = null;
      }
      selectionRef.current = result.state;
      if (previous.drag && !result.state.drag) onSoftLockChange(null);
      if (result.state !== previous) setSelectionState(result.state);
      if (
        result.state.selectedIds.length !== previous.selectedIds.length ||
        result.state.selectedIds.some(
          (objectId, index) => objectId !== previous.selectedIds[index],
        )
      )
        onSelectionChange(result.state.selectedIds);
      if (result.command) onCommand(result.command);
    },
    [onCommand, onSelectionChange, onSoftLockChange],
  );

  useEffect(
    () => () => {
      spacePressedRef.current = false;
      panGestureRef.current = null;
      const target = capturedPointerTargetRef.current;
      const pointerId = controllerRef.current.dragPointerId;
      if (pointerId !== null && target?.hasPointerCapture?.(pointerId))
        target.releasePointerCapture(pointerId);
      capturedPointerTargetRef.current = null;
      const selectionTarget = capturedSelectionTargetRef.current;
      const selectionPointerId =
        selectionRef.current.drag?.pointerId ??
        selectionRef.current.marquee?.pointerId;
      if (
        selectionPointerId !== undefined &&
        selectionTarget?.hasPointerCapture?.(selectionPointerId)
      )
        selectionTarget.releasePointerCapture(selectionPointerId);
      capturedSelectionTargetRef.current = null;
      onSoftLockChange(null);
    },
    [onSoftLockChange],
  );

  useEffect(() => {
    applyToolControllerResult(
      drawingToolEventTransition(
        controllerRef.current,
        { type: "sync_context" },
        toolContextRef.current,
      ),
    );
  }, [activeTool, applyToolControllerResult, canEdit, layerId]);

  useEffect(() => {
    const current = selectionRef.current;
    const withExternalSelection = {
      ...current,
      selectedIds: [...selectedIds],
      ...(activeTool === "select"
        ? {}
        : {
            drag: null,
            marquee: null,
            previewDelta: { x: 0, y: 0 },
          }),
    };
    const result = drawingSelectionEventTransition(
      withExternalSelection,
      { type: "sync_context" },
      selectionContextRef.current,
    );
    const eligibleInstanceIds = selectedIds.filter((id) => {
      const model = blockInstancesById[id];
      const layer = model ? layersById[model.instance.layerId] : undefined;
      return Boolean(model && layer?.visible && !layer.locked);
    });
    applySelectionResult({
      ...result,
      state: {
        ...result.state,
        selectedIds: [
          ...new Set([...result.state.selectedIds, ...eligibleInstanceIds]),
        ],
      },
    });
  }, [
    activeTool,
    applySelectionResult,
    blockInstancesById,
    canEdit,
    layersById,
    objectsById,
    remotelyLockedIds,
    selectedIds,
  ]);

  const grid = useMemo(() => visibleGrid(size, viewport), [size, viewport]);
  const cursor =
    activeTool === "select" || activeTool === "pan"
      ? drawingCanvasCursor(activeTool, spacePressed, panGesture !== null)
      : spacePressed
        ? drawingCanvasCursor("select", true, panGesture !== null)
        : "crosshair";
  const preview = previewGeometry(
    controllerState.session,
    controllerState.previewPoint,
    calibrationId,
  );
  const previewStyle: DrawingStyle = {
    stroke: "#60a5fa",
    strokeWidth: 2 / viewport.zoom,
    fill: null,
    fontSize: 14,
  };
  const textPosition =
    controllerState.session.tool === "text"
      ? worldToScreen(controllerState.session.origin, viewport)
      : null;
  const renderAdapter = useMemo(
    () =>
      drawingCanvasRenderAdapter({
        blockInstances,
        layers: layersById,
        objects,
        zoom: viewport.zoom,
      }),
    [blockInstances, layersById, objects, viewport.zoom],
  );
  const selectionCandidates = renderAdapter.hitItems.map((item) => ({
    id: item.id,
    bounds: item.hitBounds,
  }));
  const remoteSelections = awarenessPeers.flatMap((peer) =>
    drawingRemoteSelectionBounds(peer.selectedIds, renderAdapter.items).map(
      (selection) => ({ ...selection, peer }),
    ),
  );
  const selectedObjects = selectionState.selectedIds.flatMap((objectId) => {
    const object = objectsById[objectId];
    return object ? [object] : [];
  });
  const selectedBlockInstances = selectionState.selectedIds.flatMap(
    (instanceId) => {
      const model = blockInstancesById[instanceId];
      return model ? [model] : [];
    },
  );
  const marqueeBounds = selectionState.marquee
    ? normalizedBounds(
        selectionState.marquee.start,
        selectionState.marquee.current,
      )
    : null;
  const handleSize = drawingSelectionHandleSize(viewport.zoom);

  function runToolEvent(
    event: DrawingToolControllerEvent,
    target?: HTMLElement | null,
  ) {
    const result = drawingToolEventTransition(controllerRef.current, event, {
      ...toolContextRef.current,
      objectId: crypto.randomUUID(),
      viewport: viewportRef.current,
    });
    applyToolControllerResult(result, target);
    return result;
  }

  function runSelectionEvent(event: DrawingSelectionEvent) {
    const result = drawingSelectionEventTransition(
      selectionRef.current,
      event,
      {
        ...selectionContextRef.current,
        viewport: viewportRef.current,
      },
    );
    applySelectionResult(result);
    return result;
  }

  function candidateIdFor(event: KonvaEventObject<PointerEvent>) {
    const candidate = (
      event.target as unknown as { getAttr: (name: string) => unknown }
    ).getAttr("drawingSelectionId");
    return typeof candidate === "string" ? candidate : null;
  }

  function beginPan(event: KonvaEventObject<PointerEvent>) {
    const nativeEvent = event.evt;
    const previous = panGestureRef.current;
    const result = drawingPanGestureTransition(previous, {
      type: "begin",
      activeTool: activeTool === "pan" ? "pan" : "select",
      spacePressed: spacePressedRef.current,
      button: nativeEvent.button,
      pointerId: nativeEvent.pointerId,
      pointer: { x: nativeEvent.clientX, y: nativeEvent.clientY },
      viewport: viewportRef.current,
    });
    if (result.gesture === previous) return;
    nativeEvent.preventDefault();
    (nativeEvent.currentTarget as HTMLElement | null)?.setPointerCapture?.(
      nativeEvent.pointerId,
    );
    panGestureRef.current = result.gesture;
    setPanGesture(result.gesture);
  }

  function beginDrawing(event: KonvaEventObject<PointerEvent>) {
    beginPan(event);
    if (panGestureRef.current || event.evt.button !== 0) return;
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    const target = event.evt.currentTarget as HTMLElement | null;
    if (activeTool === "select") {
      event.evt.preventDefault();
      const candidateId = candidateIdFor(event);
      if (
        candidateId &&
        (blockInstancesById[candidateId] ||
          (event.evt.shiftKey && objectsById[candidateId]))
      ) {
        const current = selectionRef.current.selectedIds;
        const selected = drawingKindExclusiveSelection(
          current,
          candidateId,
          event.evt.shiftKey,
          objectIdSet,
          blockInstanceIdSet,
        );
        const next: DrawingSelectionState = {
          ...selectionRef.current,
          selectedIds: selected,
          drag: null,
          marquee: null,
          previewDelta: { x: 0, y: 0 },
        };
        selectionRef.current = next;
        setSelectionState(next);
        onSelectionChange(selected);
        return;
      }
      target?.setPointerCapture?.(event.evt.pointerId);
      capturedSelectionTargetRef.current = target;
      const result = runSelectionEvent({
        type: "pointer_down",
        candidateId,
        pointerId: event.evt.pointerId,
        screenPoint: pointer,
        shiftKey: event.evt.shiftKey,
      });
      if (result.state.drag && candidateId) onSoftLockChange(candidateId);
      return;
    }
    runToolEvent(
      {
        type: "pointer_down",
        button: event.evt.button,
        pointerId: event.evt.pointerId,
        screenPoint: pointer,
        shiftKey: event.evt.shiftKey,
      },
      target,
    );
  }

  function onDoubleClick(event: KonvaEventObject<MouseEvent>) {
    if (activeTool !== "polyline") return;
    event.evt.preventDefault();
    runToolEvent({ type: "double_click" });
  }

  function continuePan(event: KonvaEventObject<PointerEvent>) {
    const stagePoint = event.target.getStage()?.getPointerPosition();
    if (stagePoint)
      onCursorWorldChange(screenToWorld(stagePoint, viewportRef.current));
    const result = drawingPanGestureTransition(panGestureRef.current, {
      type: "move",
      pointerId: event.evt.pointerId,
      pointer: { x: event.evt.clientX, y: event.evt.clientY },
    });
    if (result.viewport) setViewport(result.viewport);
    if (result.viewport || panGestureRef.current) return;
    const pointer = stagePoint;
    if (!pointer) return;
    if (activeTool === "select") {
      runSelectionEvent({
        type: "pointer_move",
        pointerId: event.evt.pointerId,
        screenPoint: pointer,
      });
      return;
    }
    runToolEvent({
      type: "pointer_move",
      pointerId: event.evt.pointerId,
      screenPoint: pointer,
      shiftKey: event.evt.shiftKey,
    });
  }

  function endPan(
    event: KonvaEventObject<PointerEvent>,
    type: "end" | "cancel",
  ) {
    const previous = panGestureRef.current;
    const result = drawingPanGestureTransition(previous, {
      type,
      pointerId: event.evt.pointerId,
    });
    if (result.gesture === previous) return;
    const target = event.evt.currentTarget as HTMLElement | null;
    if (target?.hasPointerCapture?.(event.evt.pointerId))
      target.releasePointerCapture(event.evt.pointerId);
    panGestureRef.current = result.gesture;
    setPanGesture(result.gesture);
  }

  function finishPointer(event: KonvaEventObject<PointerEvent>) {
    if (panGestureRef.current) {
      endPan(event, "end");
      return;
    }
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
    const target = event.evt.currentTarget as HTMLElement | null;
    if (activeTool === "select") {
      runSelectionEvent({
        type: "pointer_up",
        pointerId: event.evt.pointerId,
        screenPoint: pointer,
      });
      if (target?.hasPointerCapture?.(event.evt.pointerId))
        target.releasePointerCapture(event.evt.pointerId);
      capturedSelectionTargetRef.current = null;
      return;
    }
    runToolEvent(
      {
        type: "pointer_up",
        pointerId: event.evt.pointerId,
        screenPoint: pointer,
        shiftKey: event.evt.shiftKey,
      },
      target,
    );
  }

  return (
    <div
      aria-describedby="drawing-canvas-input-description"
      aria-label="도면 화면. 스페이스 키와 드래그 또는 가운데 단추 드래그로 이동합니다."
      className="relative h-full min-h-[32rem] w-full overflow-hidden bg-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
      data-active-canvas-id={activeCanvasId}
      data-rendered-instance-count={blockInstances.length}
      data-rendered-layer-count={layers.length}
      data-rendered-object-count={objects.length}
      data-remote-block-selection-count={
        remoteSelections.filter((selection) => selection.kind === "block")
          .length
      }
      data-remote-selection-count={remoteSelections.length}
      data-selected-object-name={selectedObjects[0]?.name ?? ""}
      data-selection-count={selectionState.selectedIds.length}
      data-viewport-x={viewport.x}
      data-viewport-y={viewport.y}
      data-viewport-zoom={viewport.zoom}
      onBlur={() => {
        spacePressedRef.current = false;
        const result = drawingPanGestureTransition(panGestureRef.current, {
          type: "blur",
        });
        panGestureRef.current = result.gesture;
        setSpacePressed(false);
        setPanGesture(result.gesture);
        const selectionPointerId =
          selectionRef.current.drag?.pointerId ??
          selectionRef.current.marquee?.pointerId;
        if (selectionPointerId !== undefined)
          runSelectionEvent({
            type: "pointer_cancel",
            pointerId: selectionPointerId,
          });
      }}
      onKeyDown={(event) => {
        if (drawingToolSessionOwnsKey(controllerRef.current, event.key)) {
          event.preventDefault();
          event.stopPropagation();
          runToolEvent({ type: "key_down", key: event.key });
          return;
        }
        if (event.code === "Space") {
          event.preventDefault();
          spacePressedRef.current = true;
          setSpacePressed(true);
        }
      }}
      onKeyUp={(event) => {
        if (event.code !== "Space") return;
        event.preventDefault();
        spacePressedRef.current = false;
        setSpacePressed(false);
      }}
      onPointerDown={(event) => event.currentTarget.focus()}
      onPointerLeave={() => onCursorWorldChange(null)}
      ref={hostRef}
      tabIndex={0}
    >
      <p className="sr-only" id="drawing-canvas-input-description">
        휠로 확대하고 이동 도구 또는 스페이스 키와 드래그로 화면을 이동합니다.
      </p>
      {size.width > 0 && size.height > 0 ? (
        <Stage
          height={size.height}
          onDblClick={onDoubleClick}
          onPointerCancel={(event) => {
            endPan(event, "cancel");
            if (activeTool === "select") {
              runSelectionEvent({
                type: "pointer_cancel",
                pointerId: event.evt.pointerId,
              });
              capturedSelectionTargetRef.current = null;
            } else {
              runToolEvent(
                { type: "pointer_cancel", pointerId: event.evt.pointerId },
                event.evt.currentTarget as HTMLElement | null,
              );
            }
          }}
          onPointerDown={beginDrawing}
          onPointerMove={continuePan}
          onPointerUp={finishPointer}
          onWheel={(event) => {
            event.evt.preventDefault();
            const pointer = event.target.getStage()?.getPointerPosition();
            if (!pointer) return;
            const nextZoom = clampZoom(
              viewportRef.current.zoom * Math.exp(-event.evt.deltaY * 0.002),
            );
            setViewport(
              zoomViewportAroundPointer(pointer, viewportRef.current, nextZoom),
            );
          }}
          style={{ cursor }}
          width={size.width}
        >
          <Layer
            listening={false}
            name="immutable-source"
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          >
            <Rect
              fill="#ffffff"
              height={background.height}
              listening={false}
              shadowBlur={12 / viewport.zoom}
              shadowColor="#000000"
              shadowOpacity={0.35}
              stroke="#cbd5e1"
              strokeWidth={1 / viewport.zoom}
              width={background.width}
            />
            {background.kind === "pdf" && pdfSource ? (
              <KonvaImage
                height={pdfSource.bounds.height}
                image={pdfSource.canvas}
                listening={false}
                width={pdfSource.bounds.width}
                x={pdfSource.bounds.x}
                y={pdfSource.bounds.y}
              />
            ) : null}
          </Layer>
          <Layer
            listening={false}
            name="drawing-collaboration-selection"
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          >
            {remoteSelections.map(({ bounds, id, peer }) => (
              <Rect
                dash={[7 / viewport.zoom, 5 / viewport.zoom]}
                height={bounds.height}
                key={`${peer.clientId}:${id}`}
                listening={false}
                stroke={peer.user.color}
                strokeWidth={2 / viewport.zoom}
                width={bounds.width}
                x={bounds.x}
                y={bounds.y}
              />
            ))}
          </Layer>
          <Layer
            listening={false}
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          >
            {grid.vertical.map((x) => (
              <Line
                key={`x-${x}`}
                opacity={0.18}
                points={[
                  x,
                  screenToWorld({ x: 0, y: 0 }, viewport).y,
                  x,
                  screenToWorld({ x: 0, y: size.height }, viewport).y,
                ]}
                stroke="#64748b"
                strokeWidth={1 / viewport.zoom}
              />
            ))}
            {grid.horizontal.map((y) => (
              <Line
                key={`y-${y}`}
                opacity={0.18}
                points={[
                  screenToWorld({ x: 0, y: 0 }, viewport).x,
                  y,
                  screenToWorld({ x: size.width, y: 0 }, viewport).x,
                  y,
                ]}
                stroke="#64748b"
                strokeWidth={1 / viewport.zoom}
              />
            ))}
          </Layer>
          <CommittedDrawingLayer
            calibration={calibration}
            items={renderAdapter.items}
            viewportX={viewport.x}
            viewportY={viewport.y}
            viewportZoom={viewport.zoom}
          />
          <Layer
            listening={activeTool === "select"}
            name="drawing-selection"
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          >
            {activeTool === "select"
              ? selectionCandidates.map((candidate) => {
                  const { bounds } = candidate;
                  return (
                    <Rect
                      drawingSelectionId={candidate.id}
                      fill="rgba(0,0,0,0.001)"
                      height={bounds.height}
                      key={`hit-${candidate.id}`}
                      width={bounds.width}
                      x={bounds.x}
                      y={bounds.y}
                    />
                  );
                })
              : null}
            {selectionState.previewDelta.x !== 0 ||
            selectionState.previewDelta.y !== 0
              ? selectedObjects.map((object) => (
                  <Group key={`preview-${object.id}`} listening={false}>
                    {geometryShape(
                      translateDrawingGeometry(
                        object.geometry,
                        selectionState.previewDelta,
                      ),
                      previewStyle,
                      true,
                      calibration,
                    )}
                  </Group>
                ))
              : null}
            {selectedObjects.map((object) => {
              const geometry =
                selectionState.previewDelta.x !== 0 ||
                selectionState.previewDelta.y !== 0
                  ? translateDrawingGeometry(
                      object.geometry,
                      selectionState.previewDelta,
                    )
                  : object.geometry;
              const bounds = geometryBounds(geometry);
              const corners = [
                { x: bounds.x, y: bounds.y },
                { x: bounds.x + bounds.width, y: bounds.y },
                { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
                { x: bounds.x, y: bounds.y + bounds.height },
              ];
              return (
                <Group key={`selection-${object.id}`} listening={false}>
                  <Rect
                    dash={[6 / viewport.zoom, 4 / viewport.zoom]}
                    height={bounds.height}
                    stroke="#2563eb"
                    strokeWidth={1.5 / viewport.zoom}
                    width={bounds.width}
                    x={bounds.x}
                    y={bounds.y}
                  />
                  {corners.map((corner, index) => (
                    <Rect
                      fill="#ffffff"
                      height={handleSize}
                      key={index}
                      stroke="#2563eb"
                      strokeWidth={1 / viewport.zoom}
                      width={handleSize}
                      x={corner.x - handleSize / 2}
                      y={corner.y - handleSize / 2}
                    />
                  ))}
                </Group>
              );
            })}
            {selectedBlockInstances.map((model) => (
              <Rect
                dash={[6 / viewport.zoom, 4 / viewport.zoom]}
                height={model.bounds.height}
                key={`block-selection-${model.instance.id}`}
                listening={false}
                stroke="#2563eb"
                strokeWidth={1.5 / viewport.zoom}
                width={model.bounds.width}
                x={model.bounds.x}
                y={model.bounds.y}
              />
            ))}
            {marqueeBounds ? (
              <Rect
                fill="rgba(37,99,235,0.12)"
                height={marqueeBounds.height}
                listening={false}
                stroke="#60a5fa"
                strokeWidth={1 / viewport.zoom}
                width={marqueeBounds.width}
                x={marqueeBounds.x}
                y={marqueeBounds.y}
              />
            ) : null}
          </Layer>
          <Layer
            listening={false}
            name="drawing-preview"
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          >
            {preview
              ? geometryShape(preview, previewStyle, true, calibration)
              : null}
          </Layer>
        </Stage>
      ) : null}
      <DrawingCollaborationOverlay store={awarenessStore} viewport={viewport} />
      {textPosition ? (
        <form
          className="absolute z-10"
          onSubmit={(event) => {
            event.preventDefault();
            runToolEvent({
              type: "key_down",
              key: "Enter",
              text: textValue,
            });
          }}
          style={{ left: textPosition.x, top: textPosition.y }}
        >
          <label className="sr-only" htmlFor="drawing-text-input">
            도면 텍스트
          </label>
          <input
            aria-label="도면 텍스트"
            autoFocus
            className="min-h-11 w-48 rounded-md border border-blue-400 bg-white px-2 text-sm text-slate-950 shadow-lg outline-none focus:ring-2 focus:ring-blue-500"
            id="drawing-text-input"
            maxLength={10000}
            onChange={(event) => setTextValue(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key !== "Escape") return;
              event.preventDefault();
              runToolEvent({ type: "key_down", key: "Escape" });
            }}
            placeholder="텍스트 입력 후 Enter"
            value={textValue}
          />
        </form>
      ) : null}
      <p className="sr-only" role="status">
        {pdfMessage || "빈 도면 배경을 표시하고 있습니다."}
      </p>
    </div>
  );
});
