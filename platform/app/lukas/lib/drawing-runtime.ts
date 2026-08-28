export type DrawingRealtimeState = {
  phase: "connecting" | "connected" | "disconnected";
  message: string;
};

export type DrawingWorkspacePerformanceStage =
  | "loader"
  | "ssr"
  | "hydration"
  | "style-resolution"
  | "render-adapter"
  | "konva-mount"
  | "snap-hit-preparation"
  | "pdf"
  | "ifc";

type DrawingWorkspacePerformanceMarker = Pick<Performance, "measure" | "now">;

/** Records one real production-boundary interval and closes it at most once. */
export function startDrawingWorkspaceStage(
  stage: DrawingWorkspacePerformanceStage,
  performanceMarker: DrawingWorkspacePerformanceMarker = performance,
) {
  const started = performanceMarker.now();
  let duration: number | null = null;
  return () => {
    if (duration !== null) return duration;
    const ended = performanceMarker.now();
    duration = ended - started;
    performanceMarker.measure(`drawing-workspace:${stage}`, {
      start: started,
      end: ended,
    });
    return duration;
  };
}

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

export function drawingLocalEditReady(input: {
  outboxReady: boolean;
  bridgeReady: boolean;
  persistenceFailed: boolean;
}) {
  return input.outboxReady && input.bridgeReady && !input.persistenceFailed;
}

type PerformanceMarker = Pick<Performance, "getEntriesByName" | "mark">;

function drawingFirstPaintMarkName(kind: "pdf" | "ifc", lifecycleKey?: string) {
  const base =
    kind === "pdf" ? "drawing-first-page" : "drawing-first-ifc-frame";
  return lifecycleKey ? `${base}:${encodeURIComponent(lifecycleKey)}` : base;
}

export function drawingWorkspaceFirstPaintReady(
  requirements: { requiresPdf: boolean; requiresIfc: boolean },
  performanceMarker: Pick<Performance, "getEntriesByName"> = performance,
  lifecycleKey?: string,
) {
  return (
    (!requirements.requiresPdf ||
      performanceMarker.getEntriesByName(
        drawingFirstPaintMarkName("pdf", lifecycleKey),
      ).length > 0) &&
    (!requirements.requiresIfc ||
      performanceMarker.getEntriesByName(
        drawingFirstPaintMarkName("ifc", lifecycleKey),
      ).length > 0)
  );
}

export function markDrawingFirstUsable(
  kind: "pdf" | "ifc",
  performanceMarker: PerformanceMarker = performance,
  lifecycleKey?: string,
) {
  const name = drawingFirstPaintMarkName(kind, lifecycleKey);
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
