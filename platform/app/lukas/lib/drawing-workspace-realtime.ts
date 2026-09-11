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
  documentId,
  projectId,
  revisionId,
}: {
  documentId: string;
  projectId: string;
  revisionId: string;
  userId: string;
}): DrawingWorkspaceRealtimeSubscription[] {
  return [
    { table: "lukas_drawing_documents", filter: `id=eq.${documentId}` },
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
  onInvalidateScheduled?: () => void;
  onViewChange: (view: DrawingWorkspaceRealtimeView) => void;
};

export function createDrawingWorkspaceInvalidationScheduler({
  cancel = clearTimeout,
  now = Date.now,
  onInvalidate,
  onInvalidateScheduled,
  onViewChange,
  schedule = setTimeout,
}: SchedulerOptions) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const invalidate = () => {
    if (disposed || timer !== null) return;
    onInvalidateScheduled?.();
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
  const publish = () => options.onViewChange({ ...state, lastInvalidationAt });
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

export function disabledDrawingWorkspaceRealtimeView(): DrawingWorkspaceRealtimeView {
  return {
    phase: "disconnected",
    message: "회사 플랜에서 실시간 업무 알림 꺼짐 · 필요할 때 새로고침",
    lastInvalidationAt: null,
  };
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
  documentId,
  enabled,
  onInvalidate,
  onInvalidateScheduled,
  onRevalidated,
  projectId,
  revisionId,
  userId,
}: {
  adapter?: DrawingWorkspaceRealtimeAdapter;
  documentId: string;
  enabled: boolean;
  onInvalidate?: () => void;
  onInvalidateScheduled?: () => void;
  onRevalidated?: () => void;
  projectId: string;
  revisionId: string;
  userId: string;
}): DrawingWorkspaceRealtimeView {
  const { revalidate } = useRevalidator();
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
      setView(disabledDrawingWorkspaceRealtimeView());
      return;
    }
    let cancelled = false;
    let outstandingInvalidations = 0;
    let cleanupChannel: (() => void) | undefined;
    const settleInvalidation = () => {
      if (outstandingInvalidations < 1) return;
      outstandingInvalidations -= 1;
      onRevalidated?.();
    };
    const controller = createDrawingWorkspaceRealtimeController({
      onInvalidate() {
        const revalidation = Promise.resolve(revalidate());
        onInvalidate?.();
        void revalidation.then(
          () => {
            if (!cancelled) settleInvalidation();
          },
          () => undefined,
        );
      },
      onInvalidateScheduled() {
        outstandingInvalidations += 1;
        onInvalidateScheduled?.();
      },
      onViewChange: setView,
    });
    const visibilityChanged = () =>
      controller.visibilityChanged(document.hidden);
    document.addEventListener("visibilitychange", visibilityChanged);
    const subscriptions = drawingWorkspaceRealtimeSubscriptions({
      documentId,
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
        void import("@supabase/ssr")
          .then(async ({ createBrowserClient }) => {
            if (cancelled) return;
            const client = createBrowserClient(url, key);
            const { data, error } = await client.auth.getSession();
            const accessToken = data.session?.access_token;
            if (cancelled) return;
            if (error || !accessToken) {
              controller.status("CHANNEL_ERROR");
              return;
            }
            await client.realtime.setAuth(accessToken);
            if (cancelled) return;
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
          })
          .catch(() => {
            if (!cancelled) controller.status("CHANNEL_ERROR");
          });
    }
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visibilityChanged);
      controller.dispose();
      cleanupChannel?.();
      while (outstandingInvalidations > 0) settleInvalidation();
    };
  }, [
    adapter,
    documentId,
    enabled,
    onInvalidate,
    onInvalidateScheduled,
    onRevalidated,
    projectId,
    revalidate,
    revisionId,
    userId,
  ]);
  return view;
}
