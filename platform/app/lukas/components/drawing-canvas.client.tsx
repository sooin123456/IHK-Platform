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
  geometrySnapPoints,
  screenToWorld,
  snapWorldPoint,
  worldToScreen,
  zoomViewportAroundPointer,
  type DrawingPanGesture,
} from "~/lukas/lib/drawing-geometry";
import type { DrawingCommand } from "~/lukas/lib/drawing-commands";
import { drawingPdfImagePlacement } from "~/lukas/lib/drawing-workspace-view";
import {
  openPdfDocument,
  renderPdfPageToCanvas,
  type OpenPdfDocument,
} from "~/lukas/lib/pdf-page-renderer.client";
import type {
  DrawingGeometry,
  DrawingObject,
  Point,
  Viewport,
} from "~/lukas/lib/drawing-workspace.types";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;
const BASE_GRID_SIZE = 10;

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
    layerId: options.layerId,
    geometry,
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
    return {
      command: null,
      nextTool: "polyline",
      session: { tool: "polyline", points: [...session.points, committed] },
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
      detail: number;
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
      if (event.detail >= 2 && state.session.tool === "polyline") {
        const options = controllerCommitOptions(context);
        return options
          ? completedControllerResult(
              state,
              completeDrawingToolSession(state.session, options),
            )
          : controllerResult(state);
      }
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

export function dimensionLabel(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
  calibration?: DimensionCalibrationEvidence | null,
) {
  if (geometry.calibrationId === null) return "미보정";
  if (
    !calibration ||
    calibration.id !== geometry.calibrationId ||
    !Number.isFinite(calibration.pageWidth) ||
    !Number.isFinite(calibration.pageHeight) ||
    calibration.pageWidth <= 0 ||
    calibration.pageHeight <= 0 ||
    !Number.isFinite(calibration.millimetersPerNormalizedUnit) ||
    calibration.millimetersPerNormalizedUnit <= 0
  )
    return "보정 확인 불가";
  const normalizedDistance = Math.hypot(
    (geometry.end.x - geometry.start.x) / calibration.pageWidth,
    (geometry.end.y - geometry.start.y) / calibration.pageHeight,
  );
  return `${(
    normalizedDistance * calibration.millimetersPerNormalizedUnit
  ).toFixed(1)} mm`;
}

export function dimensionDisplayPoints(
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
) {
  const lineLength = Math.hypot(
    geometry.end.x - geometry.start.x,
    geometry.end.y - geometry.start.y,
  );
  const offsetX =
    (-(geometry.end.y - geometry.start.y) / lineLength) * geometry.offset;
  const offsetY =
    ((geometry.end.x - geometry.start.x) / lineLength) * geometry.offset;
  const displayStart = {
    x: geometry.start.x + offsetX,
    y: geometry.start.y + offsetY,
  };
  const displayEnd = {
    x: geometry.end.x + offsetX,
    y: geometry.end.y + offsetY,
  };
  return {
    displayStart,
    displayEnd,
    label: {
      x: (displayStart.x + displayEnd.x) / 2,
      y: (displayStart.y + displayEnd.y) / 2,
    },
  };
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
  activeTool: DrawingTool;
  actorId: string;
  background: DrawingCanvasBackground;
  calibration: DimensionCalibrationEvidence | null;
  calibrationId: string | null;
  canEdit: boolean;
  layerId: string | null;
  objects: DrawingObject[];
  onCommand: (
    command: Extract<DrawingCommand, { type: "add_objects" }>,
  ) => void;
  onToolComplete: (tool: DrawingTool) => void;
  onViewportChange?: (viewport: Viewport) => void;
  repeatMode: boolean;
};

type CanvasSize = { width: number; height: number };

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

function fittedViewport(size: CanvasSize, background: DrawingCanvasBackground) {
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
  style: DrawingObject["style"],
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
    case "text":
      return (
        <KonvaText
          fill={style.fill ?? style.stroke}
          fontSize={style.fontSize ?? 14}
          listening={false}
          opacity={preview ? 0.75 : 1}
          text={geometry.text}
          width={geometry.width}
          x={geometry.origin.x}
          y={geometry.origin.y}
        />
      );
    case "dimension": {
      const { displayEnd, displayStart, label } =
        dimensionDisplayPoints(geometry);
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
            fontSize={12}
            listening={false}
            text={dimensionLabel(geometry, calibration)}
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
  objects: DrawingObject[];
  viewportX: number;
  viewportY: number;
  viewportZoom: number;
};

// The workspace keeps `objects` and `calibration` identities stable. Passing
// viewport primitives limits this memo boundary to actual committed-layer work.
const CommittedDrawingLayer = memo(function CommittedDrawingLayer({
  calibration,
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
      {objects.map((object) => (
        <Group key={object.id} listening={false}>
          {geometryShape(object.geometry, object.style, false, calibration)}
        </Group>
      ))}
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
    activeTool,
    actorId,
    background,
    calibration,
    calibrationId,
    canEdit,
    layerId,
    objects,
    onCommand,
    onToolComplete,
    onViewportChange,
    repeatMode,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport>({ x: 40, y: 40, zoom: 1 });
  const fitPendingRef = useRef(true);
  const panGestureRef = useRef<DrawingPanGesture | null>(null);
  const spacePressedRef = useRef(false);
  const capturedPointerTargetRef = useRef<HTMLElement | null>(null);
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
    setViewport(fittedViewport(size, background));
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
    setViewport(fittedViewport(size, background));
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

  useEffect(
    () => () => {
      spacePressedRef.current = false;
      panGestureRef.current = null;
      const target = capturedPointerTargetRef.current;
      const pointerId = controllerRef.current.dragPointerId;
      if (pointerId !== null && target?.hasPointerCapture?.(pointerId))
        target.releasePointerCapture(pointerId);
      capturedPointerTargetRef.current = null;
    },
    [],
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
  const previewStyle: DrawingObject["style"] = {
    stroke: "#60a5fa",
    strokeWidth: 2 / viewport.zoom,
    fill: null,
    fontSize: 14,
  };
  const textPosition =
    controllerState.session.tool === "text"
      ? worldToScreen(controllerState.session.origin, viewport)
      : null;

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
    runToolEvent(
      {
        type: "pointer_down",
        button: event.evt.button,
        detail: event.evt.detail,
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
    const result = drawingPanGestureTransition(panGestureRef.current, {
      type: "move",
      pointerId: event.evt.pointerId,
      pointer: { x: event.evt.clientX, y: event.evt.clientY },
    });
    if (result.viewport) setViewport(result.viewport);
    if (result.viewport || panGestureRef.current) return;
    const pointer = event.target.getStage()?.getPointerPosition();
    if (!pointer) return;
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
      aria-label="도면 화면. 스페이스 키와 드래그 또는 가운데 단추 드래그로 이동합니다."
      className="relative h-full min-h-[32rem] w-full overflow-hidden bg-slate-950 outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
      onBlur={() => {
        spacePressedRef.current = false;
        const result = drawingPanGestureTransition(panGestureRef.current, {
          type: "blur",
        });
        panGestureRef.current = result.gesture;
        setSpacePressed(false);
        setPanGesture(result.gesture);
      }}
      onKeyDown={(event) => {
        if (
          (event.key === "Escape" ||
            event.key === "Enter" ||
            event.key === "Backspace") &&
          controllerRef.current.session.tool !== "idle"
        ) {
          event.preventDefault();
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
      ref={hostRef}
      tabIndex={0}
    >
      {size.width > 0 && size.height > 0 ? (
        <Stage
          height={size.height}
          onDblClick={onDoubleClick}
          onPointerCancel={(event) => {
            endPan(event, "cancel");
            runToolEvent(
              { type: "pointer_cancel", pointerId: event.evt.pointerId },
              event.evt.currentTarget as HTMLElement | null,
            );
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
            objects={objects}
            viewportX={viewport.x}
            viewportY={viewport.y}
            viewportZoom={viewport.zoom}
          />
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
