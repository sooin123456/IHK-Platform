import {
  drawingRealtimeState,
  drawingRealtimeTransition,
  type DrawingRealtimeState,
} from "~/lukas/lib/drawing-runtime";
import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

export type DrawingWorkspaceRealtimeView = DrawingRealtimeState & {
  lastInvalidationAt: number | null;
};

export type DrawingWorkspaceRealtimeSubscription = {
  table: string;
  filter: string;
};

export type DrawingWorkspaceRealtimeAdapter = {
  initialView?: DrawingWorkspaceRealtimeView;
  subscribe: ({
    onEvent,
    onStatus,
    subscriptions,
  }: {
    onEvent: () => void;
    onStatus: (status: string) => void;
    subscriptions: DrawingWorkspaceRealtimeSubscription[];
  }) => void | (() => void);
};

export function drawingWorkspaceRealtimeSubscriptions({
  projectId,
  revisionId,
}: {
  projectId: string;
  revisionId: string;
  userId: string;
}): DrawingWorkspaceRealtimeSubscription[] {
  return [
    { table: "lukas_drawing_revisions", filter: `id=eq.${revisionId}` },
    {
      table: "lukas_drawing_object_issue_links",
      filter: `revision_id=eq.${revisionId}`,
    },
    { table: "lukas_drawing_issues", filter: `project_id=eq.${projectId}` },
    {
      table: "lukas_drawing_issue_comments",
      filter: `project_id=eq.${projectId}`,
    },
    {
      table: "lukas_drawing_issue_events",
      filter: `project_id=eq.${projectId}`,
    },
    {
      table: "lukas_drawing_issue_approvals",
      filter: `project_id=eq.${projectId}`,
    },
    {
      table: "lukas_qto_project_members",
      filter: `project_id=eq.${projectId}`,
    },
  ];
}

type Clock = {
  now?: () => number;
  schedule?: (
    callback: () => void,
    milliseconds: number,
  ) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
};

type SchedulerOptions = Clock & {
  onInvalidate: () => void;
  onViewChange: (view: DrawingWorkspaceRealtimeView) => void;
};

export function createDrawingWorkspaceInvalidationScheduler({
  cancel = clearTimeout,
  now = Date.now,
  onInvalidate,
  onViewChange,
  schedule = setTimeout,
}: SchedulerOptions) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const invalidate = () => {
    if (disposed || timer !== null) return;
    timer = schedule(() => {
      timer = null;
      if (disposed) return;
      onInvalidate();
      onViewChange({
        ...drawingRealtimeState("SUBSCRIBED"),
        lastInvalidationAt: now(),
      });
    }, 250);
  };
  return {
    dispose() {
      disposed = true;
      if (timer !== null) cancel(timer);
      timer = null;
    },
    invalidate,
  };
}

export function createDrawingWorkspaceRealtimeController(
  options: SchedulerOptions,
) {
  let state = drawingRealtimeState("CONNECTING");
  let lastInvalidationAt: number | null = null;
  const publish = () =>
    options.onViewChange({ ...state, lastInvalidationAt });
  const scheduler = createDrawingWorkspaceInvalidationScheduler({
    ...options,
    onViewChange(view) {
      lastInvalidationAt = view.lastInvalidationAt;
      publish();
    },
  });
  publish();
  return {
    dispose: scheduler.dispose,
    event: scheduler.invalidate,
    status(status: string) {
      const transition = drawingRealtimeTransition(state, status);
      state = transition.state;
      publish();
      if (transition.shouldRevalidate) scheduler.invalidate();
    },
    visibilityChanged(hidden: boolean) {
      if (!hidden) scheduler.invalidate();
    },
  };
}

export function connectedDrawingWorkspaceRealtimeView(): DrawingWorkspaceRealtimeView {
  return { ...drawingRealtimeState("SUBSCRIBED"), lastInvalidationAt: null };
}

export function createInertDrawingWorkspaceRealtimeAdapter(): DrawingWorkspaceRealtimeAdapter {
  return {
    initialView: connectedDrawingWorkspaceRealtimeView(),
    subscribe({ onStatus }) {
      onStatus("SUBSCRIBED");
      return () => {};
    },
  };
}

export function useDrawingWorkspaceRealtime({
  adapter,
  enabled,
  onInvalidate,
  projectId,
  revisionId,
  userId,
}: {
  adapter?: DrawingWorkspaceRealtimeAdapter;
  enabled: boolean;
  onInvalidate?: () => void;
  projectId: string;
  revisionId: string;
  userId: string;
}): DrawingWorkspaceRealtimeView {
  const revalidator = useRevalidator();
  const [view, setView] = useState<DrawingWorkspaceRealtimeView>(
    () =>
      adapter?.initialView ?? {
        phase: "connecting",
        message: "실시간 연결 중",
        lastInvalidationAt: null,
      },
  );
  useEffect(() => {
    if (!enabled) {
      setView({
        phase: "disconnected",
        message: "실시간 연결이 끊겼습니다. 변경 내용은 다시 연결되면 갱신됩니다.",
        lastInvalidationAt: null,
      });
      return;
    }
    let cancelled = false;
    let cleanupChannel: (() => void) | undefined;
    const controller = createDrawingWorkspaceRealtimeController({
      onInvalidate() {
        revalidator.revalidate();
        onInvalidate?.();
      },
      onViewChange: setView,
    });
    const visibilityChanged = () => controller.visibilityChanged(document.hidden);
    document.addEventListener("visibilitychange", visibilityChanged);
    const subscriptions = drawingWorkspaceRealtimeSubscriptions({
      projectId,
      revisionId,
      userId,
    });
    if (adapter) {
      const adapterCleanup = adapter.subscribe({
        onEvent: controller.event,
        onStatus: controller.status,
        subscriptions,
      });
      if (typeof adapterCleanup === "function") cleanupChannel = adapterCleanup;
    } else {
      const url = import.meta.env.VITE_SUPABASE_URL;
      const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      if (!url || !key) controller.status("CHANNEL_ERROR");
      else
        void import("@supabase/ssr").then(({ createBrowserClient }) => {
          if (cancelled) return;
          const client = createBrowserClient(url, key);
          let channel = client.channel(
            `drawing-workspace:${projectId}:${revisionId}:${userId}`,
          );
          for (const subscription of subscriptions)
            channel = channel.on(
              "postgres_changes",
              {
                event: "*",
                filter: subscription.filter,
                schema: "public",
                table: subscription.table,
              },
              controller.event,
            );
          channel.subscribe(controller.status);
          cleanupChannel = () => void client.removeChannel(channel);
        });
    }
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibilityChanged);
      controller.dispose();
      cleanupChannel?.();
    };
  }, [adapter, enabled, onInvalidate, projectId, revalidator, revisionId, userId]);
  return view;
}
