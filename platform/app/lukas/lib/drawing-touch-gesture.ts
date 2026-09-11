import { zoomViewportAroundPointer } from "./drawing-geometry.ts";
import type { Point, Viewport } from "./drawing-workspace.types.ts";

type TouchPointer = { pointerId: number; screenPoint: Point };

export type DrawingTouchGestureState = {
  pointers: readonly TouchPointer[];
  pinch: {
    pointerIds: readonly [number, number];
    startDistance: number;
    startMidpoint: Point;
    viewport: Viewport;
  } | null;
  singlePointerId: number | null;
  suppressSingle: boolean;
};

type DrawingTouchGestureEvent = {
  type: "pointer_down" | "pointer_move" | "pointer_up" | "pointer_cancel";
  pointerId: number;
  screenPoint: Point;
  viewport: Viewport;
};

type DrawingTouchSingleEvent = Omit<DrawingTouchGestureEvent, "viewport">;

export function createDrawingTouchGestureState(): DrawingTouchGestureState {
  return {
    pointers: [],
    pinch: null,
    singlePointerId: null,
    suppressSingle: false,
  };
}

function midpoint(first: Point, second: Point): Point {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first: Point, second: Point) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function result(
  state: DrawingTouchGestureState,
  singleEvent: DrawingTouchSingleEvent | null = null,
  cancelSinglePointerId: number | null = null,
  viewport: Viewport | null = null,
) {
  return { cancelSinglePointerId, singleEvent, state, viewport };
}

function singleEvent(event: DrawingTouchGestureEvent): DrawingTouchSingleEvent {
  return {
    type: event.type,
    pointerId: event.pointerId,
    screenPoint: event.screenPoint,
  };
}

export function drawingTouchGestureTransition(
  state: DrawingTouchGestureState,
  event: DrawingTouchGestureEvent,
) {
  const existing = state.pointers.find(
    (pointer) => pointer.pointerId === event.pointerId,
  );
  const updatedPointer = {
    pointerId: event.pointerId,
    screenPoint: event.screenPoint,
  };

  if (event.type === "pointer_down") {
    if (existing) return result(state);
    const pointers = [...state.pointers, updatedPointer];
    if (pointers.length === 1 && !state.suppressSingle)
      return result(
        { ...state, pointers, singlePointerId: event.pointerId },
        singleEvent(event),
      );
    if (pointers.length === 2 && !state.pinch) {
      const [first, second] = pointers;
      return result(
        {
          pointers,
          pinch: {
            pointerIds: [first.pointerId, second.pointerId],
            startDistance: Math.max(
              1,
              distance(first.screenPoint, second.screenPoint),
            ),
            startMidpoint: midpoint(first.screenPoint, second.screenPoint),
            viewport: event.viewport,
          },
          singlePointerId: null,
          suppressSingle: true,
        },
        null,
        state.singlePointerId,
      );
    }
    return result({ ...state, pointers, suppressSingle: true });
  }

  if (!existing) return result(state);
  const movedPointers = state.pointers.map((pointer) =>
    pointer.pointerId === event.pointerId ? updatedPointer : pointer,
  );
  if (event.type === "pointer_move") {
    if (state.pinch) {
      const [firstId, secondId] = state.pinch.pointerIds;
      const first = movedPointers.find(
        (pointer) => pointer.pointerId === firstId,
      );
      const second = movedPointers.find(
        (pointer) => pointer.pointerId === secondId,
      );
      if (!first || !second)
        return result({ ...state, pointers: movedPointers });
      const currentMidpoint = midpoint(first.screenPoint, second.screenPoint);
      const anchored = zoomViewportAroundPointer(
        state.pinch.startMidpoint,
        state.pinch.viewport,
        state.pinch.viewport.zoom *
          (distance(first.screenPoint, second.screenPoint) /
            state.pinch.startDistance),
      );
      return result({ ...state, pointers: movedPointers }, null, null, {
        ...anchored,
        x: anchored.x + currentMidpoint.x - state.pinch.startMidpoint.x,
        y: anchored.y + currentMidpoint.y - state.pinch.startMidpoint.y,
      });
    }
    return state.singlePointerId === event.pointerId && !state.suppressSingle
      ? result({ ...state, pointers: movedPointers }, singleEvent(event))
      : result({ ...state, pointers: movedPointers });
  }

  const pointers = movedPointers.filter(
    (pointer) => pointer.pointerId !== event.pointerId,
  );
  if (state.suppressSingle)
    return result(
      pointers.length === 0
        ? createDrawingTouchGestureState()
        : {
            ...state,
            pointers,
            pinch: state.pinch?.pointerIds.includes(event.pointerId)
              ? null
              : state.pinch,
          },
    );
  if (state.singlePointerId === event.pointerId)
    return result(
      pointers.length === 0
        ? createDrawingTouchGestureState()
        : { ...state, pointers, singlePointerId: null },
      singleEvent(event),
    );
  return result({ ...state, pointers });
}
