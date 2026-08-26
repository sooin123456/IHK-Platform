import { useSyncExternalStore } from "react";

import type { DrawingAwarenessPeerStore } from "~/lukas/lib/drawing-awareness";

const EMPTY_PEERS: ReturnType<DrawingAwarenessPeerStore["getSnapshot"]> = [];
const EMPTY_STORE: DrawingAwarenessPeerStore = {
  getSnapshot: () => EMPTY_PEERS,
  subscribe: () => () => false,
  replace: () => undefined,
};

export function useDrawingAwarenessPeers(store?: DrawingAwarenessPeerStore) {
  const resolvedStore = store ?? EMPTY_STORE;
  return useSyncExternalStore(
    resolvedStore.subscribe,
    resolvedStore.getSnapshot,
    resolvedStore.getSnapshot,
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
      <span className="shrink-0 text-xs text-slate-300">
        {peers.length + 1}명
      </span>
      <ul className="flex min-w-0 items-center gap-1" aria-label="참여자 목록">
        <li
          className="grid size-7 shrink-0 place-items-center rounded-full border border-white/20 text-[10px] font-bold text-slate-950"
          style={{ backgroundColor: "#e2e8f0" }}
          title="나"
        >
          나
        </li>
        {peers.map((peer) => (
          <li
            aria-label={peer.user.displayName}
            className="max-w-24 shrink-0 truncate rounded-full border border-white/20 px-2 py-1 text-[10px] font-bold text-slate-950"
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
  phase,
  readOnly,
  store,
}: {
  phase: "connected" | "connecting" | "degraded";
  readOnly: boolean;
  store: DrawingAwarenessPeerStore;
}) {
  const peers = useDrawingAwarenessPeers(store);
  const message =
    phase === "connected"
      ? `공동 편집 연결됨${readOnly ? " · 읽기 전용" : ""} · ${peers.length + 1}명`
      : phase === "degraded"
        ? `공동 편집 오프라인 · ${peers.length + 1}명`
        : `공동 편집 연결 중 · ${peers.length + 1}명`;
  return (
    <span
      aria-label={`공동 편집 상태: ${phase}`}
      className={`inline-flex min-h-9 items-center px-2 text-xs ${phase === "connected" ? "text-emerald-300" : phase === "degraded" ? "text-amber-300" : "text-slate-300"}`}
      role="status"
    >
      {message}
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
      className="mb-3 max-w-full break-words rounded-md border border-amber-400/30 bg-amber-950/60 p-2 text-xs leading-5 text-amber-100"
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
