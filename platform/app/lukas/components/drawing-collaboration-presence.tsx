import { useSyncExternalStore } from "react";

import type { DrawingAwarenessPeerStore } from "~/lukas/lib/drawing-awareness";
import type { DrawingCollaborationConnection } from "~/lukas/lib/drawing-collaboration-client";
import type { DrawingRealtimeState } from "~/lukas/lib/drawing-runtime";

const EMPTY_PEERS: ReturnType<DrawingAwarenessPeerStore["getSnapshot"]> = [];
const EMPTY_STORE: DrawingAwarenessPeerStore = {
  getSnapshot: () => EMPTY_PEERS,
  getLocksSnapshot: () => EMPTY_PEERS,
  subscribe: () => () => false,
  subscribeLocks: () => () => false,
  replace: () => undefined,
};

export function drawingConnectionSummary({
  collaborationEnabled,
  collaborationPhase,
  realtimePhase,
}: {
  collaborationEnabled: boolean;
  collaborationPhase: DrawingCollaborationConnection["phase"];
  realtimePhase: DrawingRealtimeState["phase"];
}): {
  label: string;
  tone: "healthy" | "warning" | "pending" | "limited";
} {
  if (!collaborationEnabled) {
    if (realtimePhase === "disconnected")
      return { label: "실시간 연결 끊김", tone: "warning" };
    if (realtimePhase === "connecting")
      return { label: "실시간 연결 중", tone: "pending" };
    return { label: "실시간만 연결됨", tone: "limited" };
  }
  if (collaborationPhase === "denied")
    return { label: "공동 편집 중지", tone: "warning" };
  if (collaborationPhase === "degraded")
    return { label: "공동 편집 오프라인", tone: "warning" };
  if (collaborationPhase === "retrying")
    return { label: "공동 편집 재연결 중", tone: "warning" };
  if (realtimePhase === "disconnected")
    return { label: "실시간 연결 끊김", tone: "warning" };
  if (collaborationPhase === "connecting")
    return { label: "공동 편집 연결 중", tone: "pending" };
  if (realtimePhase === "connecting")
    return { label: "실시간 연결 중", tone: "pending" };
  return { label: "모두 연결됨", tone: "healthy" };
}

export function useDrawingAwarenessPeers(store?: DrawingAwarenessPeerStore) {
  const resolvedStore = store ?? EMPTY_STORE;
  return useSyncExternalStore(
    resolvedStore.subscribe,
    resolvedStore.getSnapshot,
    resolvedStore.getSnapshot,
  );
}

export function useDrawingAwarenessLocks(store?: DrawingAwarenessPeerStore) {
  const resolvedStore = store ?? EMPTY_STORE;
  return useSyncExternalStore(
    resolvedStore.subscribeLocks,
    resolvedStore.getLocksSnapshot,
    resolvedStore.getLocksSnapshot,
  );
}

export function DrawingCollaborationParticipants({
  store,
}: {
  store: DrawingAwarenessPeerStore;
}) {
  const peers = useDrawingAwarenessPeers(store);
  return (
    <div
      aria-label={`공동 작업 참여자 ${peers.length + 1}명`}
      className="flex min-w-0 items-center gap-1"
      role="status"
    >
      <span className="drawing-workspace-participant-count shrink-0 text-xs text-slate-500">
        {peers.length + 1}명
      </span>
      <ul className="flex min-w-0 items-center gap-1" aria-label="참여자 목록">
        <li
          className="grid size-7 shrink-0 place-items-center rounded-full border border-slate-200 text-[10px] font-bold text-slate-900"
          style={{ backgroundColor: "#e2e8f0" }}
          title="나"
        >
          나
        </li>
        {peers.map((peer) => (
          <li
            aria-label={peer.user.displayName}
            className="max-w-24 shrink-0 truncate rounded-full border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-900"
            key={peer.clientId}
            style={{ backgroundColor: peer.user.color }}
            title={peer.user.displayName}
          >
            {peer.user.displayName}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DrawingCollaborationConnectionStatus({
  enabled = true,
  phase,
  readOnly,
  store,
}: {
  enabled?: boolean;
  phase: DrawingCollaborationConnection["phase"];
  readOnly: boolean;
  store: DrawingAwarenessPeerStore;
}) {
  const peers = useDrawingAwarenessPeers(store);
  const message = !enabled
    ? "회사 플랜에서 공동 편집 꺼짐 · 로컬 자동 저장 사용"
    : phase === "connected"
      ? `공동 편집 연결됨${readOnly ? " · 읽기 전용" : ""} · ${peers.length + 1}명`
      : phase === "retrying"
        ? "공동 편집 재연결 중 · 로컬 작업 유지"
        : phase === "denied"
          ? "공동 편집 연결 중지 · 권한·로그인·도면 상태 확인 후 새로고침"
          : phase === "degraded"
            ? `공동 편집 오프라인 · ${peers.length + 1}명`
            : `공동 편집 연결 중 · ${peers.length + 1}명`;
  return (
    <span
      aria-label={`공동 편집 상태: ${enabled ? phase : "disabled"}`}
      className={`drawing-workspace-presence-status inline-flex min-h-9 items-center px-2 text-xs ${enabled && phase === "connected" ? "text-emerald-700" : enabled && (phase === "degraded" || phase === "retrying" || phase === "denied") ? "text-amber-700" : "text-slate-600"}`}
      role="status"
    >
      <span
        aria-hidden="true"
        className="drawing-workspace-status-dot size-2 rounded-full bg-current"
      />
      <span className="drawing-workspace-status-message">{message}</span>
    </span>
  );
}

export function DrawingCollaborationLockStatus({
  objectNames,
  store,
}: {
  objectNames: Record<string, string>;
  store: DrawingAwarenessPeerStore;
}) {
  const peers = useDrawingAwarenessPeers(store);
  const locks = peers.flatMap((peer) =>
    peer.softLocks.map((lock) => ({ lock, user: peer.user })),
  );
  if (!locks.length) return null;
  return (
    <p
      aria-label="객체 잠금 상태"
      className="mb-3 max-w-full break-words rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900"
      role="status"
    >
      {locks
        .map(
          ({ lock, user }) =>
            `${user.displayName}님이 ${objectNames[lock.entityId] ?? "객체"} 편집 중`,
        )
        .join(" · ")}
    </p>
  );
}
