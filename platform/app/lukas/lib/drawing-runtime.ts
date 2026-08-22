export type DrawingRealtimeState = {
  phase: "connecting" | "connected" | "disconnected";
  message: string;
};

export function drawingRealtimeState(status: string): DrawingRealtimeState {
  if (status === "SUBSCRIBED")
    return { phase: "connected", message: "실시간 연결됨" };
  if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status))
    return {
      phase: "disconnected",
      message:
        "실시간 연결이 끊겼습니다. 변경 내용은 다시 연결되면 갱신됩니다.",
    };
  return { phase: "connecting", message: "실시간 연결 중" };
}

export function drawingRealtimeTransition(
  previous: DrawingRealtimeState,
  status: string,
) {
  const state = drawingRealtimeState(status);
  return {
    state,
    shouldRevalidate:
      previous.phase === "disconnected" && state.phase === "connected",
  };
}

type PerformanceMarker = Pick<Performance, "getEntriesByName" | "mark">;

export function markDrawingFirstUsable(
  kind: "pdf" | "ifc",
  performanceMarker: PerformanceMarker = performance,
) {
  const name =
    kind === "pdf" ? "drawing-first-page" : "drawing-first-ifc-frame";
  if (performanceMarker.getEntriesByName(name).length === 0)
    performanceMarker.mark(name);
}

export function createVisibilityRenderGate({
  isHidden,
  render,
  onFirstRender,
}: {
  isHidden: () => boolean;
  render: () => void;
  onFirstRender?: () => void;
}) {
  let pending = false;
  let rendered = false;
  const renderVisible = () => {
    render();
    if (!rendered) {
      rendered = true;
      onFirstRender?.();
    }
  };
  return {
    request() {
      if (isHidden()) {
        pending = true;
        return;
      }
      pending = false;
      renderVisible();
    },
    visibilityChanged() {
      if (!isHidden() && pending) {
        pending = false;
        renderVisible();
      }
    },
  };
}
