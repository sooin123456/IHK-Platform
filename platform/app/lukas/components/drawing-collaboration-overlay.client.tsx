import type { Viewport } from "~/lukas/lib/drawing-workspace.types";
import { worldToScreen } from "~/lukas/lib/drawing-geometry";
import type { DrawingAwarenessPeerStore } from "~/lukas/lib/drawing-awareness";
import { useDrawingAwarenessPeers } from "~/lukas/components/drawing-collaboration-presence";

export function DrawingCollaborationOverlay({
  store,
  viewport,
}: {
  store: DrawingAwarenessPeerStore;
  viewport: Viewport;
}) {
  const peers = useDrawingAwarenessPeers(store);
  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {peers.flatMap((peer) => {
        if (!peer.cursorWorld) return [];
        const point = worldToScreen(peer.cursorWorld, viewport);
        return [
          <div
            aria-label={`${peer.user.displayName} 커서`}
            className="absolute max-w-40 rounded-md px-2 py-1 text-xs font-semibold text-slate-950 shadow-lg"
            key={peer.clientId}
            style={{
              backgroundColor: peer.user.color,
              left: point.x + 10,
              top: point.y + 10,
            }}
          >
            <span className="block truncate">{peer.user.displayName}</span>
            {peer.selectedIds.length ? (
              <span data-remote-selection={peer.user.displayName}>
                선택 {peer.selectedIds.length}
              </span>
            ) : null}
          </div>,
        ];
      })}
    </div>
  );
}
