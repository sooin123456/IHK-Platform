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
  type PointerEvent as ReactPointerEvent,
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
  drawingGeometryHitTest,
  drawingOpeningMarkerSegments,
  drawingSemanticAccessibilityLabel,
  drawingSemanticLabelLayout,
  DRAWING_SEMANTIC_RENDER_METRICS,
  drawingPanGestureTransition,
  geometryBounds,
  geometrySnapPoints,
  sampleDrawingArcPoints,
  screenToWorld,
  snapWorldPoint,
  worldToScreen,
  zoomViewportAroundPointer,
  type DrawingPanGesture,
} from "~/lukas/lib/drawing-geometry";
import {
  isEditableDrawingLayer,
  moveDrawingOpeningToPoint,
  translateDrawingGeometry,
  type DrawingCommand,
  type DrawingMoveSnapshot,
} from "~/lukas/lib/drawing-commands";
import {
  drawingCanvasRenderItems,
  drawingCanvasViewportProjection,
  drawingKindExclusiveSelection,
  drawingVisibleCanvasObjects,
  type DrawingBlockRenderModel,
  type DrawingCanvasRenderItem,
} from "~/lukas/lib/drawing-blocks";
import { startDrawingWorkspaceStage } from "~/lukas/lib/drawing-runtime";
import {
  drawingDimensionDisplayPoints,
  drawingDimensionLabel,
  drawingDimensionLayout,
  drawingTextLayout,
} from "~/lukas/lib/drawing-layout";
import { drawingPdfImagePlacement } from "~/lukas/lib/drawing-workspace-view";
import {
  computeDrawingPdfRevisionDiff,
  DRAWING_PDF_DIFF_MAX_EDGE,
  type DrawingPdfDiffMarker,
} from "~/lukas/lib/drawing-pdf-revision-diff";
import {
  createDrawingPdfPageTransform,
  type DrawingPdfPageTransform,
} from "~/lukas/lib/drawing-pdf-transform";
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
  DrawingSemanticGeometry,
  DrawingStyle,
  Point,
  Viewport,
} from "~/lukas/lib/drawing-workspace.types";
import {
  DrawingGeometrySchema,
  defaultDrawingObjectName,
} from "~/lukas/lib/drawing-workspace.types";
import {
  addDrawingSemanticNumbers,
  normalizeDrawingSemanticNumber,
  projectPointToDrawingWall,
  resolveDrawingOpening,
} from "~/lukas/lib/drawing-semantic-geometry";
import type { DrawingAwarenessPeerStore } from "~/lukas/lib/drawing-awareness";
import { DrawingCollaborationOverlay } from "~/lukas/components/drawing-collaboration-overlay.client";
import { useDrawingAwarenessPeers } from "~/lukas/components/drawing-collaboration-presence";

type DrawingPdfCleanupScheduler = {
  requestFrame(callback: () => void): number;
  cancelFrame(id: number): void;
  setTimer(callback: () => void, milliseconds: number): number;
  clearTimer(id: number): void;
};

export function scheduleDrawingPdfOwnedCleanup(
  cleanup: () => void,
  scheduler: DrawingPdfCleanupScheduler = {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (id) => cancelAnimationFrame(id),
    setTimer: (callback, milliseconds) =>
      window.setTimeout(callback, milliseconds),
    clearTimer: (id) => window.clearTimeout(id),
  },
) {
  let finished = false;
  let frameId: number | null = null;
  let timerId: number | null = null;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (frameId !== null) scheduler.cancelFrame(frameId);
    if (timerId !== null) scheduler.clearTimer(timerId);
    cleanup();
  };
  frameId = scheduler.requestFrame(finish);
  timerId = scheduler.setTimer(finish, 1_000);
  return finish;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
const BASE_GRID_SIZE = 10;
const SELECTION_HIT_TOLERANCE_PIXELS = 6;
const VIEWPORT_OVERSCAN_PIXELS = 48;
const DIRECTION_45 = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
] as const;

function isDrawingSemanticObject(
  object: DrawingObject,
): object is DrawingObject & { geometry: DrawingSemanticGeometry } {
  return ["wall", "opening", "space", "area", "grid", "arc"].includes(
    object.geometry.type,
  );
}

export type DrawingTool =
  | "select"
  | "pan"
  | "line"
  | "polyline"
  | "rectangle"
  | "circle"
  | "text"
  | "dimension"
  | "wall"
  | "opening"
  | "space"
  | "area"
  | "grid"
  | "arc";

export type ToolSession =
  | { tool: "idle" }
  | { tool: "line"; start: Point }
  | { tool: "polyline"; points: Point[] }
  | { tool: "rectangle"; start: Point }
  | { tool: "circle"; center: Point }
  | { tool: "text"; origin: Point }
  | { tool: "dimension"; start: Point; end?: Point }
  | { tool: "wall" | "grid"; start: Point }
  | { tool: "space" | "area"; points: Point[] }
  | {
      tool: "arc";
      center: Point;
      radius?: number;
      startAngleDegrees?: number;
    };

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
  objects?: Readonly<Record<string, DrawingObject>>;
  lockedEntityIds?: ReadonlySet<string>;
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

function nextTool(
  tool: Exclude<DrawingTool, "select" | "pan">,
  repeat: boolean,
) {
  return repeat ? tool : "select";
}

function constrainedDirection(start: Point, end: Point) {
  return (
    ((Math.round(Math.atan2(end.y - start.y, end.x - start.x) / (Math.PI / 4)) %
      8) +
      8) %
    8
  );
}

function constrainTo45Degrees(start: Point, end: Point): Point {
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) return end;
  const direction = constrainedDirection(start, end);
  const amount = direction % 2 === 0 ? length : length / Math.SQRT2;
  const signs = DIRECTION_45[direction];
  return {
    x: start.x + amount * signs[0],
    y: start.y + amount * signs[1],
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
      stroke:
        geometry.type === "wall" || geometry.type === "opening"
          ? "#0f172a"
          : geometry.type === "grid"
            ? "#64748b"
            : geometry.type === "arc"
              ? "#7c3aed"
              : "#2563eb",
      strokeWidth: 2,
      fill:
        geometry.type === "text"
          ? "#2563eb"
          : geometry.type === "space"
            ? "#dbeafe66"
            : geometry.type === "area"
              ? "#fde68a66"
              : null,
      ...(geometry.type === "text" ? { fontSize: 14 } : {}),
    },
    version: 1,
  };
}

function completedResult(
  tool: Exclude<DrawingTool, "select" | "pan">,
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
    case "wall":
    case "grid":
      return { tool, start: committed };
    case "polyline":
    case "space":
    case "area":
      return { tool, points: [committed] };
    case "circle":
      return { tool, center: committed };
    case "text":
      return { tool, origin: committed };
    case "dimension":
      return { tool, start: committed };
    case "arc":
      return { tool, center: committed };
    case "opening":
      return { tool: "idle" };
  }
}

function semanticPoint(point: Point) {
  return {
    x: normalizeDrawingSemanticNumber(point.x),
    y: normalizeDrawingSemanticNumber(point.y),
  };
}

function constrainSemanticTo45Degrees(start: Point, end: Point) {
  const canonicalStart = semanticPoint(start);
  const canonicalEnd = semanticPoint(end);
  const direction = constrainedDirection(canonicalStart, canonicalEnd);
  const length = Math.hypot(
    canonicalEnd.x - canonicalStart.x,
    canonicalEnd.y - canonicalStart.y,
  );
  const delta = normalizeDrawingSemanticNumber(
    direction % 2 === 0 ? length : length / Math.SQRT2,
  );
  const signs = DIRECTION_45[direction];
  return {
    start: canonicalStart,
    end: {
      x: addDrawingSemanticNumbers(canonicalStart.x, delta * signs[0]),
      y: addDrawingSemanticNumbers(canonicalStart.y, delta * signs[1]),
    },
  };
}

function validSemanticGeometry(geometry: DrawingGeometry) {
  return DrawingGeometrySchema.safeParse(geometry).success ? geometry : null;
}

export function commitDrawingPoint(
  session: ToolSession,
  point: Point,
  options: DrawingCommitOptions,
): DrawingToolResult {
  if (session.tool === "idle" || session.tool === "text") {
    return { command: null, nextTool: "select", session };
  }
  let committed = snapPoint(point, options.snap);
  if (
    options.constrain &&
    (session.tool === "line" || session.tool === "dimension")
  ) {
    committed = constrainTo45Degrees(session.start, committed);
  }
  if (
    session.tool === "polyline" ||
    session.tool === "space" ||
    session.tool === "area"
  ) {
    const lastPoint = session.points.at(-1);
    const points =
      lastPoint?.x === committed.x && lastPoint.y === committed.y
        ? session.points
        : [...session.points, committed];
    return {
      command: null,
      nextTool: session.tool,
      session: { tool: session.tool, points },
    };
  }
  if (session.tool === "line") {
    const geometry =
      session.start.x === committed.x && session.start.y === committed.y
        ? null
        : ({ type: "line", start: session.start, end: committed } as const);
    return completedResult(session.tool, geometry, options);
  }
  if (session.tool === "wall" || session.tool === "grid") {
    const { start, end } = options.constrain
      ? constrainSemanticTo45Degrees(session.start, committed)
      : { start: semanticPoint(session.start), end: semanticPoint(committed) };
    const geometry =
      start.x === end.x && start.y === end.y
        ? null
        : session.tool === "wall"
          ? ({
              type: "wall",
              semanticVersion: 1,
              start,
              end,
              thicknessMillimeters: 200,
              heightMillimeters: 3000,
            } as const)
          : ({ type: "grid", semanticVersion: 1, start, end } as const);
    return completedResult(session.tool, geometry, options);
  }
  if (session.tool === "arc") {
    const center = semanticPoint(session.center);
    const arcPoint = semanticPoint(committed);
    if (
      session.radius === undefined ||
      session.startAngleDegrees === undefined
    ) {
      const radius = normalizeDrawingSemanticNumber(
        Math.hypot(arcPoint.x - center.x, arcPoint.y - center.y),
      );
      if (radius === 0) return { command: null, nextTool: "arc", session };
      return {
        command: null,
        nextTool: "arc",
        session: {
          tool: "arc",
          center,
          radius,
          startAngleDegrees: normalizeDrawingSemanticNumber(
            (Math.atan2(arcPoint.y - center.y, arcPoint.x - center.x) * 180) /
              Math.PI,
          ),
        },
      };
    }
    const endAngle =
      (Math.atan2(arcPoint.y - center.y, arcPoint.x - center.x) * 180) /
      Math.PI;
    let sweep = ((endAngle - session.startAngleDegrees + 540) % 360) - 180;
    if (sweep === -180) sweep = 180;
    sweep = normalizeDrawingSemanticNumber(sweep);
    if (sweep === 0) return { command: null, nextTool: "arc", session };
    return completedResult(
      session.tool,
      validSemanticGeometry({
        type: "arc",
        semanticVersion: 1,
        center,
        radius: session.radius,
        startAngleDegrees: session.startAngleDegrees,
        sweepAngleDegrees: sweep,
      }),
      options,
    );
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
  if (session.tool === "dimension") {
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
  return { command: null, nextTool: "select", session };
}

export function completeDrawingToolSession(
  session: ToolSession,
  options: DrawingCommitOptions,
): DrawingToolResult {
  if (
    session.tool === "polyline" ||
    session.tool === "space" ||
    session.tool === "area"
  ) {
    const distinct = session.points.some(
      (point) =>
        point.x !== session.points[0]?.x || point.y !== session.points[0]?.y,
    );
    const geometry: DrawingGeometry | null =
      session.tool === "polyline"
        ? session.points.length >= 2 && distinct
          ? { type: "polyline", points: session.points, closed: false }
          : null
        : session.points.length >= 3
          ? validSemanticGeometry(
              session.tool === "space"
                ? {
                    type: "space",
                    semanticVersion: 1,
                    boundary: session.points.map(semanticPoint),
                    number: "",
                    finishes: { floor: null, wall: null, ceiling: null },
                  }
                : {
                    type: "area",
                    semanticVersion: 1,
                    boundary: session.points.map(semanticPoint),
                  },
            )
          : null;
    if (session.tool !== "polyline" && !geometry)
      return { command: null, nextTool: session.tool, session };
    return completedResult(session.tool, geometry, options);
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
  return session.tool === "polyline" ||
    session.tool === "space" ||
    session.tool === "area"
    ? { tool: session.tool, points: session.points.slice(0, -1) }
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
  layers?: Readonly<Record<string, DrawingLayer>>;
  objectId: string;
  objects?: Readonly<Record<string, DrawingObject>>;
  lockedEntityIds?: ReadonlySet<string>;
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
  validationMessage: string | null;
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
  return context.canEdit && context.layerId && context.layers
    ? isEditableDrawingLayer(context.layers[context.layerId])
      ? context.layerId
      : null
    : null;
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
    validationMessage: null,
  };
}

export function drawingToolSessionOwnsKey(
  state: DrawingToolControllerState,
  key: string,
) {
  if (state.session.tool === "idle") return false;
  if (key === "Backspace")
    return (
      state.session.tool === "polyline" ||
      state.session.tool === "space" ||
      state.session.tool === "area" ||
      state.session.tool === "text"
    );
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
      nextTool: authorizedLayer(context) ? null : "select",
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
    objects: context.objects,
    lockedEntityIds: context.lockedEntityIds,
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
      validationMessage: null,
    },
    {
      command: completed.command,
      nextTool: completed.nextTool,
      pointerCapture,
    },
  );
}

function completedOrRejectedPolygon(
  state: DrawingToolControllerState,
  completed: DrawingToolResult,
) {
  if (
    !completed.command &&
    (state.session.tool === "space" || state.session.tool === "area")
  )
    return controllerResult({
      ...state,
      previewPoint: null,
      session: completed.session,
      validationMessage:
        "경계가 겹치지 않는 유효한 다각형이 되도록 점을 수정하세요.",
    });
  return completedControllerResult(state, completed);
}

function controllerWorldPoint(
  screenPoint: Point,
  context: DrawingToolControllerContext,
) {
  return screenToWorld(screenPoint, context.viewport);
}

function placeDrawingOpening(
  point: Point,
  context: DrawingToolControllerContext,
): DrawingToolResult {
  const options = controllerCommitOptions(context);
  if (!options) return cancelDrawingToolSession();
  const tolerance = context.snap.tolerancePixels / context.viewport.zoom;
  const candidates = Object.values(context.objects ?? {})
    .filter(
      (
        object,
      ): object is DrawingObject & {
        geometry: Extract<DrawingGeometry, { type: "wall" }>;
      } =>
        object.geometry.type === "wall" &&
        context.layers?.[object.layerId]?.visible !== false &&
        context.layers?.[object.layerId]?.locked !== true &&
        !context.lockedEntityIds?.has(object.id),
    )
    .map((host) => ({
      host,
      projection: projectPointToDrawingWall(point, host.geometry),
    }))
    .filter(({ host, projection }) => {
      if (projection.distanceMillimeters > tolerance) return false;
      const geometry = {
        type: "opening" as const,
        semanticVersion: 1 as const,
        hostWallId: host.id,
        offsetMillimeters: normalizeDrawingSemanticNumber(
          projection.offsetMillimeters,
        ),
        widthMillimeters: 900,
        heightMillimeters: 2100,
        sillHeightMillimeters: 0,
        openingKind: "door" as const,
      };
      if (!validSemanticGeometry(geometry)) return false;
      try {
        resolveDrawingOpening(geometry, context.objects ?? {});
        return true;
      } catch {
        return false;
      }
    })
    .sort(
      (left, right) =>
        left.projection.distanceMillimeters -
          right.projection.distanceMillimeters ||
        left.host.id.localeCompare(right.host.id),
    );
  const nearest = candidates[0];
  if (!nearest)
    return {
      command: null,
      nextTool: context.activeTool,
      session: { tool: "idle" },
    };
  return completedResult(
    "opening",
    {
      type: "opening",
      semanticVersion: 1,
      hostWallId: nearest.host.id,
      offsetMillimeters: normalizeDrawingSemanticNumber(
        nearest.projection.offsetMillimeters,
      ),
      widthMillimeters: 900,
      heightMillimeters: 2100,
      sillHeightMillimeters: 0,
      openingKind: "door",
    },
    options,
  );
}

export function drawingToolEventTransition(
  state: DrawingToolControllerState,
  event: DrawingToolControllerEvent,
  context: DrawingToolControllerContext,
): DrawingToolControllerResult {
  const synchronized = synchronizedController(state, context);
  if (event.type === "sync_context" || synchronized.changed)
    return synchronized.result;
  if (!authorizedLayer(context))
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
    if (context.activeTool === "opening") {
      return completedControllerResult(
        state,
        placeDrawingOpening(worldPoint, context),
      );
    }
    if (context.activeTool === "text") {
      return controllerResult({
        ...state,
        previewPoint: null,
        session: beginDrawingToolSession("text", worldPoint, snap),
      });
    }
    if (
      context.activeTool === "polyline" ||
      context.activeTool === "space" ||
      context.activeTool === "area"
    ) {
      if (state.session.tool === context.activeTool) {
        const options = controllerCommitOptions(context);
        if (!options) return controllerResult(state);
        const added = commitDrawingPoint(state.session, worldPoint, options);
        return controllerResult({
          ...state,
          previewPoint: null,
          session: added.session,
          validationMessage: null,
        });
      }
      return controllerResult({
        ...state,
        previewPoint: null,
        session: beginDrawingToolSession(context.activeTool, worldPoint, snap),
        validationMessage: null,
      });
    }
    if (
      context.activeTool === "line" ||
      context.activeTool === "dimension" ||
      context.activeTool === "wall" ||
      context.activeTool === "grid" ||
      context.activeTool === "arc"
    ) {
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
        validationMessage: null,
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
    let candidate = snapPoint(
      controllerWorldPoint(event.screenPoint, context),
      snap,
    );
    if (
      event.shiftKey &&
      (state.session.tool === "line" || state.session.tool === "dimension")
    ) {
      candidate = constrainTo45Degrees(state.session.start, candidate);
    }
    if (
      event.shiftKey &&
      (state.session.tool === "wall" || state.session.tool === "grid")
    )
      candidate = constrainSemanticTo45Degrees(
        state.session.start,
        candidate,
      ).end;
    return controllerResult({
      ...state,
      previewPoint: candidate,
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
    if (
      state.session.tool !== "polyline" &&
      state.session.tool !== "space" &&
      state.session.tool !== "area"
    )
      return controllerResult(state);
    const options = controllerCommitOptions(context);
    return options
      ? completedOrRejectedPolygon(
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
  if (
    event.key === "Backspace" &&
    (state.session.tool === "polyline" ||
      state.session.tool === "space" ||
      state.session.tool === "area")
  ) {
    return controllerResult({
      ...state,
      previewPoint: null,
      session: removeLastPolylinePoint(state.session),
      validationMessage: null,
    });
  }
  if (
    event.key === "Enter" &&
    (state.session.tool === "polyline" ||
      state.session.tool === "space" ||
      state.session.tool === "area" ||
      state.session.tool === "text")
  ) {
    const options = controllerCommitOptions(context, false, event.text);
    return options
      ? completedOrRejectedPolygon(
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
  orderedCandidateIds?: readonly string[];
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
  softLockId?: string | null;
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

function editableDrawingObject(
  context: Pick<
    DrawingSelectionContext,
    "canEdit" | "layers" | "lockedEntityIds" | "objects"
  >,
  objectId: string,
) {
  const object = context.objects[objectId];
  return object &&
    context.canEdit &&
    isEditableDrawingLayer(context.layers[object.layerId]) &&
    !context.lockedEntityIds?.has(objectId)
    ? object
    : null;
}

function drawingSelectionCandidateAtPoint(
  context: DrawingSelectionContext,
  preferredId: string | null,
  point: Point,
) {
  const ordered = context.orderedCandidateIds ?? Object.keys(context.objects);
  if (preferredId && !selectableDrawingObject(context, preferredId))
    return undefined;
  const matches = (id: string) => {
    const object = selectableDrawingObject(context, id);
    return object &&
      pointInBounds(
        point,
        drawingSelectionHitBounds(
          object.geometry,
          context.viewport.zoom,
          SELECTION_HIT_TOLERANCE_PIXELS,
          context.objects,
        ),
      ) &&
      drawingGeometryHitTest(
        object.geometry,
        point,
        SELECTION_HIT_TOLERANCE_PIXELS / context.viewport.zoom,
        context.objects,
      )
      ? object
      : undefined;
  };
  if (preferredId) {
    const preferred = matches(preferredId);
    if (preferred) return preferred;
  }
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const id = ordered[index];
    if (id === preferredId) continue;
    const candidate = matches(id);
    if (candidate) return candidate;
  }
  return undefined;
}

/** Expands canonical object bounds by a fixed screen-space hit tolerance. */
export function drawingSelectionHitBounds(
  geometry: DrawingGeometry,
  zoom: number,
  tolerancePixels = SELECTION_HIT_TOLERANCE_PIXELS,
  objects?: Readonly<Record<string, DrawingObject>>,
) {
  if (!Number.isFinite(zoom) || zoom <= 0)
    throw new Error("확대 배율이 올바르지 않습니다.");
  const bounds = geometryBounds(geometry, objects);
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
  const objectMap = Object.fromEntries(
    objects.map((candidate) => [candidate.id, candidate]),
  );
  return objects.flatMap((object) => {
    const layer = layers[object.layerId];
    return layer?.visible && !layer.locked
      ? [
          {
            id: object.id,
            bounds: drawingSelectionHitBounds(
              object.geometry,
              zoom,
              SELECTION_HIT_TOLERANCE_PIXELS,
              objectMap,
            ),
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
    const object = editableDrawingObject(context, objectId);
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
    const current = editableDrawingObject(context, snapshot.id);
    return (
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

function moveSelectionSnapshotsWithOpenings(
  snapshots: DrawingMoveSnapshot[],
  context: DrawingSelectionContext,
  delta: Point,
) {
  const selected = new Set(snapshots.map((snapshot) => snapshot.id));
  const updates = snapshots.flatMap((snapshot) => {
    if (snapshot.geometry.type !== "opening")
      return [
        {
          objectId: snapshot.id,
          baseVersion: snapshot.version,
          patch: {
            geometry: translateDrawingGeometry(snapshot.geometry, delta),
          },
        },
      ];
    if (selected.has(snapshot.geometry.hostWallId)) return [];
    const resolved = resolveDrawingOpening(snapshot.geometry, context.objects);
    return moveDrawingOpeningToPoint(context, snapshot.id, context.actorId, {
      x: resolved.center.x + delta.x,
      y: resolved.center.y + delta.y,
    }).updates;
  });
  return updates.length
    ? ({ type: "update_objects", actorId: context.actorId, updates } as const)
    : null;
}

export function drawingSelectionPreview({
  actorId,
  canEdit = true,
  delta,
  layers,
  lockedEntityIds,
  objects,
  selectedIds,
}: {
  actorId: string;
  canEdit?: boolean;
  delta: Point;
  layers: Record<string, DrawingLayer>;
  lockedEntityIds?: ReadonlySet<string>;
  objects: Record<string, DrawingObject>;
  selectedIds: readonly string[];
}) {
  if (delta.x === 0 && delta.y === 0)
    return { objectIds: [] as string[], objects };
  if (
    !canEdit ||
    selectedIds.some(
      (id) =>
        !editableDrawingObject(
          { canEdit, layers, lockedEntityIds, objects },
          id,
        ),
    )
  )
    return { objectIds: [] as string[], objects };
  const selected = new Set(selectedIds);
  const previewObjects = { ...objects };
  for (const id of selectedIds) {
    const object = objects[id];
    if (!object) continue;
    if (object.geometry.type === "opening") {
      if (selected.has(object.geometry.hostWallId)) continue;
      const resolved = resolveDrawingOpening(object.geometry, objects);
      previewObjects[id] = {
        ...object,
        geometry: moveDrawingOpeningToPoint({ layers, objects }, id, actorId, {
          x: resolved.center.x + delta.x,
          y: resolved.center.y + delta.y,
        }).updates[0].patch.geometry!,
      };
    } else {
      previewObjects[id] = {
        ...object,
        geometry: translateDrawingGeometry(object.geometry, delta),
      };
    }
  }
  const objectIds = [...selectedIds];
  for (const object of Object.values(objects))
    if (
      object.geometry.type === "opening" &&
      selected.has(object.geometry.hostWallId) &&
      !selected.has(object.id) &&
      layers[object.layerId]?.visible
    )
      objectIds.push(object.id);
  return { objectIds, objects: previewObjects };
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
      softLockId: invalidDrag ? null : undefined,
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
      softLockId: null,
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
    const candidate = drawingSelectionCandidateAtPoint(
      context,
      event.candidateId,
      point,
    );
    if (candidate) {
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
      const drag =
        selectedIds.includes(candidate.id) &&
        snapshots.length === selectedIds.length
          ? { pointerId: event.pointerId, start: point, snapshots }
          : null;
      return {
        command: null,
        softLockId: drag ? candidate.id : null,
        state: {
          selectedIds,
          marquee: null,
          drag,
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
        ? moveSelectionSnapshotsWithOpenings(
            moved.drag.snapshots,
            context,
            moved.previewDelta,
          )
        : null;
    return {
      command,
      pointerCapture: valid
        ? null
        : { type: "release", pointerId: event.pointerId },
      softLockId: null,
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
          boundsIntersect(
            marquee,
            geometryBounds(object.geometry, context.objects),
          ),
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

export function drawingCanvasSelectionPointerDown(
  state: DrawingSelectionState,
  event: Extract<DrawingSelectionEvent, { type: "pointer_down" }>,
  context: DrawingSelectionContext,
  blockInstanceIds: ReadonlySet<string>,
  objectIds: ReadonlySet<string>,
): DrawingSelectionResult {
  if (event.candidateId && blockInstanceIds.has(event.candidateId)) {
    const selectedIds = drawingKindExclusiveSelection(
      state.selectedIds,
      event.candidateId,
      event.shiftKey,
      objectIds,
      blockInstanceIds,
    );
    return {
      command: null,
      softLockId: null,
      state: {
        ...state,
        selectedIds,
        drag: null,
        marquee: null,
        previewDelta: { x: 0, y: 0 },
      },
    };
  }
  return drawingSelectionEventTransition(state, event, context);
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
  focus: () => void;
  getViewport: () => Viewport;
  resetViewport: () => void;
  setViewport: (viewport: Viewport) => void;
};

export type DrawingPdfCompareInput = {
  generation: number;
  mode: "current" | "overlay" | "previous";
  opacity: number;
  previousPageNumber: number;
  previousSignedUrl: string;
};

export type DrawingPdfCompareState =
  | { status: "idle" | "loading"; markers: readonly [] }
  | { status: "ready"; markers: readonly DrawingPdfDiffMarker[] }
  | {
      status: "missing" | "error";
      message: string;
      markers: readonly [];
    }
  | {
      status: "refused";
      reason: "rotation_mismatch" | "aspect_mismatch";
      markers: readonly [];
    };

type DrawingCanvasProps = {
  activeCanvasId: string;
  activeTool: DrawingTool;
  actorId: string;
  background: DrawingCanvasBackground;
  pdfCompare?: DrawingPdfCompareInput | null;
  onPdfCompareState?: (state: DrawingPdfCompareState) => void;
  onPdfPageTransform?: (transform: DrawingPdfPageTransform | null) => void;
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

export function drawingCanvasViewportBounds(
  size: CanvasSize,
  viewport: Viewport,
  overscanPixels = VIEWPORT_OVERSCAN_PIXELS,
): Bounds | null {
  if (size.width <= 0 || size.height <= 0) return null;
  const start = screenToWorld(
    { x: -overscanPixels, y: -overscanPixels },
    viewport,
  );
  const end = screenToWorld(
    {
      x: size.width + overscanPixels,
      y: size.height + overscanPixels,
    },
    viewport,
  );
  return {
    x: start.x,
    y: start.y,
    width: end.x - start.x,
    height: end.y - start.y,
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
  objects: Readonly<Record<string, DrawingObject>> = {},
  objectName = "",
  semanticView?: {
    opening?: ReturnType<typeof resolveDrawingOpening>;
    arcPoints?: Point[];
  },
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
    case "wall":
      return (
        <Line
          {...common}
          lineCap="square"
          points={[
            geometry.start.x,
            geometry.start.y,
            geometry.end.x,
            geometry.end.y,
          ]}
          strokeWidth={geometry.thicknessMillimeters}
        />
      );
    case "opening": {
      const resolved =
        semanticView?.opening ?? resolveDrawingOpening(geometry, objects);
      const [opening, marker] = drawingOpeningMarkerSegments(
        geometry,
        resolved,
      );
      const points = opening.flatMap((point) => [point.x, point.y]);
      return (
        <>
          <Line
            {...common}
            points={points}
            stroke="#ffffff"
            strokeWidth={
              resolved.host.geometry.thicknessMillimeters +
              DRAWING_SEMANTIC_RENDER_METRICS.openingCutExtra
            }
          />
          <Line
            {...common}
            points={points}
            strokeWidth={
              geometry.openingKind === "void"
                ? DRAWING_SEMANTIC_RENDER_METRICS.voidWidth
                : DRAWING_SEMANTIC_RENDER_METRICS.openingWidth
            }
          />
          {geometry.openingKind === "window" ? (
            <Line
              {...common}
              points={marker.flatMap((point) => [point.x, point.y])}
              strokeWidth={DRAWING_SEMANTIC_RENDER_METRICS.windowMarkerWidth}
            />
          ) : null}
          {geometry.openingKind === "door" ? (
            <Line
              {...common}
              points={marker.flatMap((point) => [point.x, point.y])}
              strokeWidth={DRAWING_SEMANTIC_RENDER_METRICS.doorMarkerWidth}
            />
          ) : null}
        </>
      );
    }
    case "space":
    case "area": {
      const label = drawingSemanticLabelLayout(geometry, objectName);
      return (
        <>
          <Line
            {...common}
            closed
            fill={
              style.fill ??
              (geometry.type === "space"
                ? DRAWING_SEMANTIC_RENDER_METRICS.spaceFill
                : DRAWING_SEMANTIC_RENDER_METRICS.areaFill)
            }
            points={geometry.boundary.flatMap((point) => [point.x, point.y])}
          />
          <Group
            clipHeight={label.height}
            clipWidth={label.width}
            listening={false}
            x={label.x}
            y={label.y}
          >
            <KonvaText
              align="center"
              fill={style.stroke}
              fontSize={label.fontSize}
              height={label.height}
              lineHeight={label.lineHeight}
              listening={false}
              name="drawing-semantic-label"
              text={label.lines.join("\n")}
              width={label.width}
              wrap="none"
            />
          </Group>
        </>
      );
    }
    case "grid": {
      const label = drawingSemanticLabelLayout(geometry, objectName);
      return (
        <>
          <Line
            {...common}
            dash={[...DRAWING_SEMANTIC_RENDER_METRICS.gridDash]}
            points={[
              geometry.start.x,
              geometry.start.y,
              geometry.end.x,
              geometry.end.y,
            ]}
          />
          <Circle
            fill="#ffffff"
            radius={DRAWING_SEMANTIC_RENDER_METRICS.gridBubbleRadius}
            stroke={style.stroke}
            strokeWidth={DRAWING_SEMANTIC_RENDER_METRICS.gridBubbleStrokeWidth}
            x={geometry.end.x}
            y={geometry.end.y}
          />
          <Group
            clipHeight={label.height}
            clipWidth={label.width}
            listening={false}
            rotation={label.rotation}
            x={label.x}
            y={label.y}
          >
            <KonvaText
              align="center"
              fill={style.stroke}
              fontSize={label.fontSize}
              height={label.height}
              lineHeight={label.lineHeight}
              listening={false}
              name="drawing-semantic-label"
              text={label.lines.join("\n")}
              width={label.width}
              wrap="none"
            />
          </Group>
        </>
      );
    }
    case "arc":
      return (
        <Line
          {...common}
          points={(
            semanticView?.arcPoints ?? sampleDrawingArcPoints(geometry)
          ).flatMap((point) => [point.x, point.y])}
        />
      );
  }
}

type SemanticRenderView = {
  opening?: ReturnType<typeof resolveDrawingOpening>;
  arcPoints?: Point[];
};

const semanticRenderCache = new WeakMap<
  DrawingObject,
  { host?: DrawingObject; view: SemanticRenderView }
>();

export function semanticRenderView(
  object: DrawingObject,
  objects: Readonly<Record<string, DrawingObject>>,
) {
  if (object.geometry.type !== "opening" && object.geometry.type !== "arc")
    return undefined;
  const host =
    object.geometry.type === "opening"
      ? objects[object.geometry.hostWallId]
      : undefined;
  const cached = semanticRenderCache.get(object);
  if (cached && cached.host === host) return cached.view;
  const view: SemanticRenderView =
    object.geometry.type === "opening"
      ? { opening: resolveDrawingOpening(object.geometry, objects) }
      : { arcPoints: sampleDrawingArcPoints(object.geometry) };
  semanticRenderCache.set(object, { host, view });
  return view;
}

type CommittedDrawingLayerProps = {
  calibration: DimensionCalibrationEvidence | null;
  items: DrawingCanvasRenderItem[];
  objects: Readonly<Record<string, DrawingObject>>;
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
};

// The workspace keeps `objects` and `calibration` identities stable. Passing
// viewport primitives limits this memo boundary to actual committed-layer work.
const CommittedDrawingLayer = memo(function CommittedDrawingLayer({
  calibration,
  items,
  objects,
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
              objects,
              item.object.name,
              semanticRenderView(item.object, objects),
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

const DrawingSemanticAccessibilityList = memo(
  function DrawingSemanticAccessibilityList({
    objects,
  }: {
    objects: Array<DrawingObject & { geometry: DrawingSemanticGeometry }>;
  }) {
    return (
      <ul className="sr-only" aria-label="건축 객체 목록">
        {objects.map((object) => (
          <li key={object.id}>
            {drawingSemanticAccessibilityLabel(object.name, object.geometry)}
          </li>
        ))}
      </ul>
    );
  },
);

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
  if (
    session.tool === "polyline" ||
    session.tool === "space" ||
    session.tool === "area"
  ) {
    const points = [...session.points, point];
    return points.length < 2
      ? null
      : session.tool === "polyline"
        ? { type: "polyline", points, closed: false }
        : session.tool === "space"
          ? {
              type: "space",
              semanticVersion: 1,
              boundary: points,
              number: "",
              finishes: { floor: null, wall: null, ceiling: null },
            }
          : { type: "area", semanticVersion: 1, boundary: points };
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
  if (session.tool === "wall" || session.tool === "grid")
    return session.tool === "wall"
      ? {
          type: "wall",
          semanticVersion: 1,
          start: session.start,
          end: point,
          thicknessMillimeters: 200,
          heightMillimeters: 3000,
        }
      : {
          type: "grid",
          semanticVersion: 1,
          start: session.start,
          end: point,
        };
  if (session.tool === "arc") {
    if (
      session.radius === undefined ||
      session.startAngleDegrees === undefined
    ) {
      const radius = Math.hypot(
        point.x - session.center.x,
        point.y - session.center.y,
      );
      return radius === 0
        ? null
        : { type: "circle", center: session.center, radius };
    }
    const endAngle =
      (Math.atan2(point.y - session.center.y, point.x - session.center.x) *
        180) /
      Math.PI;
    let sweep = ((endAngle - session.startAngleDegrees + 540) % 360) - 180;
    if (sweep === -180) sweep = 180;
    return sweep === 0
      ? null
      : {
          type: "arc",
          semanticVersion: 1,
          center: session.center,
          radius: session.radius,
          startAngleDegrees: session.startAngleDegrees,
          sweepAngleDegrees: sweep,
        };
  }
  return session.tool === "dimension" &&
    (session.start.x !== point.x || session.start.y !== point.y)
    ? {
        type: "dimension",
        start: session.start,
        end: point,
        offset: 12,
        calibrationId,
      }
    : null;
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
    pdfCompare = null,
    onPdfCompareState,
    onPdfPageTransform,
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
  const konvaMountFinishRef = useRef<null | (() => number)>(null);
  if (konvaMountFinishRef.current === null)
    konvaMountFinishRef.current = startDrawingWorkspaceStage("konva-mount");
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
  const visibleObjects = useMemo(
    () => drawingVisibleCanvasObjects(objects, layersById),
    [layersById, objects],
  );
  const blockInstancesById = useMemo(
    () =>
      Object.fromEntries(
        blockInstances.map((model) => [model.instance.id, model]),
      ),
    [blockInstances],
  );
  const objectIdSet = useMemo(
    () => new Set(visibleObjects.map((object) => object.id)),
    [visibleObjects],
  );
  const blockInstanceIdSet = useMemo(
    () => new Set(Object.keys(blockInstancesById)),
    [blockInstancesById],
  );
  const [size, setSize] = useState<CanvasSize>({ width: 0, height: 0 });
  const [viewport, setViewportState] = useState<Viewport>(viewportRef.current);
  const renderItems = useMemo(() => {
    const finish = startDrawingWorkspaceStage("render-adapter");
    try {
      return drawingCanvasRenderItems({
        blockInstances,
        layers: layersById,
        objects,
      });
    } finally {
      finish();
    }
  }, [blockInstances, layersById, objects]);
  const viewportBounds = useMemo(
    () => drawingCanvasViewportBounds(size, viewport),
    [size, viewport],
  );
  const viewportProjection = useMemo(() => {
    const finish = startDrawingWorkspaceStage("snap-hit-preparation");
    try {
      const projection = drawingCanvasViewportProjection({
        items: renderItems,
        layers: layersById,
        viewportBounds,
        zoom: viewport.zoom,
      });
      return {
        ...projection,
        objectCandidates: projection.projectedItems.flatMap((item) =>
          item.kind === "object"
            ? geometrySnapPoints(item.object.geometry, objectsById)
            : [],
        ),
      };
    } finally {
      finish();
    }
  }, [layersById, objectsById, renderItems, viewport.zoom, viewportBounds]);
  const objectCandidates = viewportProjection.objectCandidates;
  const [controllerState, setControllerState] =
    useState<DrawingToolControllerState>(() =>
      createDrawingToolControllerState({
        activeTool,
        actorId,
        calibrationId,
        canEdit,
        layerId,
        layers: layersById,
        objectId: "",
        objects: objectsById,
        lockedEntityIds: remotelyLockedIds,
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
  const [pdfSource, setPdfSource] = useState<{
    canvas: HTMLCanvasElement;
    bounds: { x: number; y: number; width: number; height: number };
    pageViewport: { width: number; height: number; rotation: number };
  } | null>(null);
  const [previousPdfSource, setPreviousPdfSource] = useState<{
    canvas: HTMLCanvasElement;
    bounds: { x: number; y: number; width: number; height: number };
    pageViewport: { width: number; height: number; rotation: number };
  } | null>(null);
  const [pdfDiffMarkers, setPdfDiffMarkers] = useState<
    readonly DrawingPdfDiffMarker[]
  >([]);
  const [pdfMessage, setPdfMessage] = useState("");
  const toolContextRef = useRef<DrawingToolControllerContext>({
    activeTool,
    actorId,
    calibrationId,
    canEdit,
    layerId,
    layers: layersById,
    objectId: "",
    objects: objectsById,
    lockedEntityIds: remotelyLockedIds,
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
    layers: layersById,
    objectId: "",
    objects: objectsById,
    lockedEntityIds: remotelyLockedIds,
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
      focus: () => hostRef.current?.focus(),
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

  useLayoutEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    konvaMountFinishRef.current?.();
  }, [size.height, size.width]);

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
      onPdfPageTransform?.(null);
      return;
    }
    let alive = true;
    let opened: OpenPdfDocument | null = null;
    let renderCleanup: (() => void) | null = null;
    const controller = new AbortController();
    const canvas = document.createElement("canvas");
    const finishPdfStage = startDrawingWorkspaceStage("pdf");
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
        setPdfSource({
          canvas,
          bounds: sourceBounds,
          pageViewport: rendered.pageViewport,
        });
        onPdfPageTransform?.(
          createDrawingPdfPageTransform({
            pageNumber: background.pageNumber,
            rotation: rendered.pageViewport.rotation,
            pdfViewport: rendered.pageViewport,
            worldViewport: {
              x: 0,
              y: 0,
              width: background.width,
              height: background.height,
            },
          }),
        );
        setPdfMessage("PDF 원본 배경을 표시하고 있습니다.");
        finishPdfStage();
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
        finishPdfStage();
        setPdfMessage(
          error instanceof Error
            ? error.message
            : "PDF 배경을 열지 못했습니다.",
        );
      });
    return () => {
      alive = false;
      controller.abort();
      setPdfSource((current) => (current?.canvas === canvas ? null : current));
      const cleanup = renderCleanup;
      renderCleanup = null;
      const documentToDestroy = opened;
      opened = null;
      onPdfPageTransform?.(null);
      scheduleDrawingPdfOwnedCleanup(() => {
        cleanup?.();
        void documentToDestroy?.destroy().finally(() => {
          canvas.width = 0;
          canvas.height = 0;
        });
      });
    };
  }, [
    background.kind,
    background.height,
    background.kind === "pdf" ? background.pageNumber : 0,
    background.kind === "pdf" ? background.signedUrl : "",
    background.width,
    onPdfPageTransform,
  ]);

  const previousPdfEnabled =
    background.kind === "pdf" &&
    Boolean(pdfCompare) &&
    pdfCompare?.mode !== "current";
  const previousPdfPageNumber = pdfCompare?.previousPageNumber ?? 0;
  const previousPdfSignedUrl = pdfCompare?.previousSignedUrl ?? "";
  useEffect(() => {
    if (!previousPdfEnabled) {
      setPreviousPdfSource(null);
      setPdfDiffMarkers([]);
      onPdfCompareState?.({ status: "idle", markers: [] });
      return;
    }
    let alive = true;
    let opened: OpenPdfDocument | null = null;
    let renderCleanup: (() => void) | null = null;
    const controller = new AbortController();
    const canvas = document.createElement("canvas");
    setPreviousPdfSource(null);
    setPdfDiffMarkers([]);
    onPdfCompareState?.({ status: "loading", markers: [] });
    void openPdfDocument(previousPdfSignedUrl, controller.signal)
      .then(async (nextDocument) => {
        if (!alive || controller.signal.aborted) {
          await nextDocument.destroy();
          return;
        }
        opened = nextDocument;
        if (previousPdfPageNumber > nextDocument.document.numPages) {
          onPdfCompareState?.({
            status: "missing",
            message: `이전 PDF에 ${previousPdfPageNumber}쪽이 없습니다. 다른 쪽을 자동 선택하지 않습니다.`,
            markers: [],
          });
          return;
        }
        const rendered = await renderPdfPageToCanvas({
          document: nextDocument.document,
          pageNumber: previousPdfPageNumber,
          canvas,
          hostWidth: 1600,
          zoom: 1,
          signal: controller.signal,
        });
        renderCleanup = rendered.cleanup;
        if (!alive || controller.signal.aborted) {
          rendered.cleanup();
          renderCleanup = null;
          return;
        }
        setPreviousPdfSource({
          canvas,
          bounds: drawingPdfImagePlacement(rendered.canvasSize, {
            width: background.width,
            height: background.height,
          }),
          pageViewport: rendered.pageViewport,
        });
        onPdfCompareState?.({ status: "ready", markers: [] });
      })
      .catch((error: unknown) => {
        if (!alive || controller.signal.aborted || isCancelled(error)) return;
        onPdfCompareState?.({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "이전 PDF 페이지를 열지 못했습니다.",
          markers: [],
        });
      });
    return () => {
      alive = false;
      controller.abort();
      setPreviousPdfSource((current) =>
        current?.canvas === canvas ? null : current,
      );
      const cleanup = renderCleanup;
      renderCleanup = null;
      const documentToDestroy = opened;
      opened = null;
      scheduleDrawingPdfOwnedCleanup(() => {
        cleanup?.();
        void documentToDestroy?.destroy().finally(() => {
          canvas.width = 0;
          canvas.height = 0;
        });
      });
    };
  }, [
    background.height,
    background.kind,
    background.width,
    onPdfCompareState,
    previousPdfEnabled,
    previousPdfPageNumber,
    previousPdfSignedUrl,
  ]);

  const pdfDiffEnabled =
    background.kind === "pdf" &&
    Boolean(pdfCompare) &&
    pdfCompare?.mode !== "current" &&
    (pdfCompare?.generation ?? 0) > 0;
  const pdfDiffGeneration = pdfCompare?.generation ?? 0;
  useEffect(() => {
    if (!pdfDiffEnabled || !pdfSource || !previousPdfSource) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (controller.signal.aborted) return;
      try {
        const aspect = pdfSource.canvas.width / pdfSource.canvas.height;
        const width = Math.max(
          1,
          Math.round(
            aspect >= 1
              ? DRAWING_PDF_DIFF_MAX_EDGE
              : DRAWING_PDF_DIFF_MAX_EDGE * aspect,
          ),
        );
        const height = Math.max(
          1,
          Math.round(
            aspect >= 1
              ? DRAWING_PDF_DIFF_MAX_EDGE / aspect
              : DRAWING_PDF_DIFF_MAX_EDGE,
          ),
        );
        const raster = (source: typeof pdfSource) => {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("PDF 비교 Canvas를 만들지 못했습니다.");
          context.drawImage(source.canvas, 0, 0, width, height);
          return {
            rotation: source.pageViewport.rotation,
            viewport: {
              width: source.pageViewport.width,
              height: source.pageViewport.height,
            },
            pixels: {
              width,
              height,
              data: context.getImageData(0, 0, width, height).data,
            },
          };
        };
        const result = computeDrawingPdfRevisionDiff({
          current: raster(pdfSource),
          previous: raster(previousPdfSource),
          signal: controller.signal,
        });
        if (result.status === "ready") {
          setPdfDiffMarkers(result.markers);
          onPdfCompareState?.(result);
        } else {
          setPdfDiffMarkers([]);
          onPdfCompareState?.(result);
        }
      } catch (error) {
        if (controller.signal.aborted || isCancelled(error)) return;
        setPdfDiffMarkers([]);
        onPdfCompareState?.({
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : "PDF 변경 표시를 계산하지 못했습니다.",
          markers: [],
        });
      }
    });
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    onPdfCompareState,
    pdfDiffEnabled,
    pdfDiffGeneration,
    pdfSource,
    previousPdfSource,
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
      if (result.state !== previous) setSelectionState(result.state);
      if (
        result.state.selectedIds.length !== previous.selectedIds.length ||
        result.state.selectedIds.some(
          (objectId, index) => objectId !== previous.selectedIds[index],
        )
      )
        onSelectionChange(result.state.selectedIds);
      if (result.command) onCommand(result.command);
      if (result.softLockId !== undefined) onSoftLockChange(result.softLockId);
      else if (previous.drag && !result.state.drag) onSoftLockChange(null);
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
  }, [activeTool, applyToolControllerResult, canEdit, layerId, layersById]);

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
          ...new Set([
            ...result.state.selectedIds.filter((id) => objectIdSet.has(id)),
            ...eligibleInstanceIds,
          ]),
        ],
      },
    });
  }, [
    activeTool,
    applySelectionResult,
    blockInstancesById,
    canEdit,
    layersById,
    objectIdSet,
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
  const selectionCandidates = useMemo(
    () =>
      viewportProjection.hitItems.map((item) => ({
        id: item.id,
        bounds: item.hitBounds,
      })),
    [viewportProjection.hitItems],
  );
  const orderedSelectionCandidateIds = useMemo(
    () => selectionCandidates.map(({ id }) => id),
    [selectionCandidates],
  );
  const remoteSelections = awarenessPeers.flatMap((peer) =>
    drawingRemoteSelectionBounds(
      peer.selectedIds,
      viewportProjection.projectedItems,
    ).map((selection) => ({ ...selection, peer })),
  );
  const projectedSemanticObjects = useMemo(
    () =>
      viewportProjection.projectedItems.flatMap((item) =>
        item.kind === "object" && isDrawingSemanticObject(item.object)
          ? [item.object]
          : [],
      ),
    [viewportProjection.projectedItems],
  );
  const visibleSemanticObjectCount = useMemo(
    () => visibleObjects.filter(isDrawingSemanticObject).length,
    [visibleObjects],
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
  const selectionPreview = useMemo(
    () =>
      drawingSelectionPreview({
        actorId,
        canEdit,
        delta: selectionState.previewDelta,
        layers: layersById,
        lockedEntityIds: remotelyLockedIds,
        objects: objectsById,
        selectedIds: selectionState.selectedIds,
      }),
    [
      actorId,
      canEdit,
      layersById,
      objectsById,
      remotelyLockedIds,
      selectionState.previewDelta,
      selectionState.selectedIds,
    ],
  );
  const previewObjectsById = selectionPreview.objects;

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

  function currentSelectionContext(): DrawingSelectionContext {
    return {
      ...selectionContextRef.current,
      orderedCandidateIds: orderedSelectionCandidateIds,
      viewport: viewportRef.current,
    };
  }

  function runSelectionEvent(event: DrawingSelectionEvent) {
    const result = drawingSelectionEventTransition(
      selectionRef.current,
      event,
      currentSelectionContext(),
    );
    applySelectionResult(result);
    return result;
  }

  function runSelectionPointerDown(
    event: Extract<DrawingSelectionEvent, { type: "pointer_down" }>,
  ) {
    const result = drawingCanvasSelectionPointerDown(
      selectionRef.current,
      event,
      currentSelectionContext(),
      blockInstanceIdSet,
      objectIdSet,
    );
    applySelectionResult(result);
    return result;
  }

  function candidateIdFor(screenPoint: Point) {
    const point = screenToWorld(screenPoint, viewportRef.current);
    for (let index = selectionCandidates.length - 1; index >= 0; index -= 1)
      if (pointInBounds(point, selectionCandidates[index].bounds))
        return selectionCandidates[index].id;
    return null;
  }

  function pointerForHostEvent(
    event: Pick<PointerEvent, "clientX" | "clientY">,
    host: HTMLElement,
  ) {
    const bounds = host.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function beginNativeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.focus();
    if (
      activeTool !== "select" ||
      event.button !== 0 ||
      spacePressedRef.current
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const pointer = pointerForHostEvent(event, event.currentTarget);
    const candidateId = candidateIdFor(pointer);
    if (!candidateId || !blockInstancesById[candidateId]) {
      event.currentTarget.setPointerCapture?.(event.pointerId);
      capturedSelectionTargetRef.current = event.currentTarget;
    }
    runSelectionPointerDown({
      type: "pointer_down",
      candidateId,
      pointerId: event.pointerId,
      screenPoint: pointer,
      shiftKey: event.shiftKey,
    });
  }

  function continueNativeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      activeTool !== "select" ||
      (selectionRef.current.drag?.pointerId !== event.pointerId &&
        selectionRef.current.marquee?.pointerId !== event.pointerId)
    )
      return;
    event.stopPropagation();
    const pointer = pointerForHostEvent(event, event.currentTarget);
    onCursorWorldChange(screenToWorld(pointer, viewportRef.current));
    runSelectionEvent({
      type: "pointer_move",
      pointerId: event.pointerId,
      screenPoint: pointer,
    });
  }

  function finishNativeSelection(
    event: ReactPointerEvent<HTMLDivElement>,
    type: "pointer_up" | "pointer_cancel",
  ) {
    if (
      activeTool !== "select" ||
      (selectionRef.current.drag?.pointerId !== event.pointerId &&
        selectionRef.current.marquee?.pointerId !== event.pointerId)
    )
      return;
    event.stopPropagation();
    if (type === "pointer_up")
      runSelectionEvent({
        type,
        pointerId: event.pointerId,
        screenPoint: pointerForHostEvent(event, event.currentTarget),
      });
    else runSelectionEvent({ type, pointerId: event.pointerId });
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    capturedSelectionTargetRef.current = null;
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
      const candidateId = candidateIdFor(pointer);
      if (!candidateId || !blockInstancesById[candidateId]) {
        target?.setPointerCapture?.(event.evt.pointerId);
        capturedSelectionTargetRef.current = target;
      }
      runSelectionPointerDown({
        type: "pointer_down",
        candidateId,
        pointerId: event.evt.pointerId,
        screenPoint: pointer,
        shiftKey: event.evt.shiftKey,
      });
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
    if (
      activeTool !== "polyline" &&
      activeTool !== "space" &&
      activeTool !== "area"
    )
      return;
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
      data-pdf-current-mounted={pdfSource ? "true" : "false"}
      data-pdf-previous-mounted={previousPdfSource ? "true" : "false"}
      data-drag-active={selectionState.drag ? "true" : "false"}
      data-drag-pointer-id={selectionState.drag?.pointerId ?? ""}
      data-drag-preview={`${selectionState.previewDelta.x},${selectionState.previewDelta.y}`}
      data-rendered-instance-count={blockInstances.length}
      data-rendered-layer-count={layers.length}
      data-rendered-object-count={visibleObjects.length}
      data-rendered-semantic-object-count={visibleSemanticObjectCount}
      data-projected-object-count={viewportProjection.projectedItems.length}
      data-projected-semantic-object-count={projectedSemanticObjects.length}
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
      onPointerCancelCapture={(event) =>
        finishNativeSelection(event, "pointer_cancel")
      }
      onPointerDownCapture={beginNativeSelection}
      onPointerLeave={() => onCursorWorldChange(null)}
      onPointerMoveCapture={continueNativeSelection}
      onPointerUpCapture={(event) => finishNativeSelection(event, "pointer_up")}
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
            name="drawing-background"
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          >
            <Group listening={false} name="immutable-source">
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
              {background.kind === "pdf" &&
              pdfSource &&
              pdfCompare?.mode !== "previous" ? (
                <KonvaImage
                  height={pdfSource.bounds.height}
                  image={pdfSource.canvas}
                  listening={false}
                  width={pdfSource.bounds.width}
                  x={pdfSource.bounds.x}
                  y={pdfSource.bounds.y}
                />
              ) : null}
              {background.kind === "pdf" &&
              previousPdfSource &&
              pdfCompare?.mode !== "current" ? (
                <KonvaImage
                  height={previousPdfSource.bounds.height}
                  image={previousPdfSource.canvas}
                  listening={false}
                  opacity={
                    pdfCompare?.mode === "overlay" ? pdfCompare.opacity : 1
                  }
                  width={previousPdfSource.bounds.width}
                  x={previousPdfSource.bounds.x}
                  y={previousPdfSource.bounds.y}
                />
              ) : null}
            </Group>
            <Group listening={false} name="pdf-diff-preview">
              {pdfCompare?.mode !== "current" && pdfSource
                ? pdfDiffMarkers.map((marker, index) => (
                    <Rect
                      dash={[8 / viewport.zoom, 4 / viewport.zoom]}
                      fill="rgba(245,158,11,0.16)"
                      height={marker.height * pdfSource.bounds.height}
                      key={`${marker.x}:${marker.y}:${index}`}
                      listening={false}
                      stroke="#f59e0b"
                      strokeWidth={2 / viewport.zoom}
                      width={marker.width * pdfSource.bounds.width}
                      x={pdfSource.bounds.x + marker.x * pdfSource.bounds.width}
                      y={
                        pdfSource.bounds.y + marker.y * pdfSource.bounds.height
                      }
                    />
                  ))
                : null}
            </Group>
            <Group listening={false} name="drawing-grid">
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
            </Group>
          </Layer>
          <CommittedDrawingLayer
            calibration={calibration}
            items={viewportProjection.projectedItems}
            objects={objectsById}
            viewportX={viewport.x}
            viewportY={viewport.y}
            viewportZoom={viewport.zoom}
          />
          <Layer
            listening={activeTool === "select"}
            name="drawing-overlay"
            scaleX={viewport.zoom}
            scaleY={viewport.zoom}
            x={viewport.x}
            y={viewport.y}
          >
            <Group listening={false} name="drawing-collaboration-selection">
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
            </Group>
            <Group name="drawing-selection">
              {selectionState.previewDelta.x !== 0 ||
              selectionState.previewDelta.y !== 0
                ? selectionPreview.objectIds.map((objectId) => {
                    const object = previewObjectsById[objectId];
                    return (
                      <Group key={`preview-${object.id}`} listening={false}>
                        {geometryShape(
                          previewObjectsById[object.id].geometry,
                          previewStyle,
                          true,
                          calibration,
                          previewObjectsById,
                          object.name,
                        )}
                      </Group>
                    );
                  })
                : null}
              {selectedObjects.map((object) => {
                const geometry =
                  selectionState.previewDelta.x !== 0 ||
                  selectionState.previewDelta.y !== 0
                    ? previewObjectsById[object.id].geometry
                    : object.geometry;
                const bounds = geometryBounds(geometry, previewObjectsById);
                const corners = [
                  { x: bounds.x, y: bounds.y },
                  { x: bounds.x + bounds.width, y: bounds.y },
                  {
                    x: bounds.x + bounds.width,
                    y: bounds.y + bounds.height,
                  },
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
            </Group>
            <Group listening={false} name="drawing-preview">
              {preview
                ? geometryShape(
                    preview,
                    previewStyle,
                    true,
                    calibration,
                    objectsById,
                  )
                : null}
            </Group>
          </Layer>
        </Stage>
      ) : null}
      {controllerState.validationMessage ? (
        <p
          className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-md bg-red-950 px-3 py-2 text-sm text-red-100 shadow-lg"
          role="alert"
        >
          {controllerState.validationMessage}
        </p>
      ) : null}
      <DrawingCollaborationOverlay store={awarenessStore} viewport={viewport} />
      {pdfCompare?.mode !== "current" && pdfDiffMarkers.length > 0 ? (
        <div className="pointer-events-none absolute right-4 top-4 z-10 rounded-md bg-amber-100 px-3 py-2 text-xs font-bold text-amber-950 shadow">
          브라우저 미리보기 · {pdfDiffMarkers.length}개
          {pdfDiffMarkers.map((marker, index) => (
            <span
              className="sr-only"
              data-listening="false"
              data-pdf-diff-marker="true"
              key={`${marker.x}:${marker.y}:${index}`}
            >
              {marker.label}
            </span>
          ))}
        </div>
      ) : null}
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
      <DrawingSemanticAccessibilityList
        key={`${projectedSemanticObjects[0]?.id ?? "empty"}:${projectedSemanticObjects.at(-1)?.id ?? "empty"}:${projectedSemanticObjects.length}`}
        objects={projectedSemanticObjects}
      />
    </div>
  );
});
