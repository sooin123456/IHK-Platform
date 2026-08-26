import {
  DRAWING_COLLABORATION_LIMITS,
  DrawingAwarenessStateSchema,
  type DrawingAwarenessState,
} from "./drawing-collaboration-protocol.ts";
import type {
  DrawingCommand,
  DrawingRecordedOperation,
} from "./drawing-commands.ts";
import type { DrawingStructureAction } from "./drawing-workspace.types.ts";

const COLORS = [
  "#fbbf24",
  "#34d399",
  "#60a5fa",
  "#f472b6",
  "#c084fc",
  "#fb7185",
  "#22d3ee",
  "#a3e635",
] as const;
const MAX_LEASE_MS = 10_000;

export type DrawingAwarenessPeer = DrawingAwarenessState & {
  clientId: number;
};
export type DrawingAwarenessLockPeer = Pick<
  DrawingAwarenessPeer,
  "clientId" | "softLocks" | "user"
>;

export type DrawingAwarenessLocalInput = Omit<DrawingAwarenessState, "user">;

const EMPTY_PEERS: DrawingAwarenessPeer[] = [];

export type DrawingAwarenessPeerStore = ReturnType<
  typeof createDrawingAwarenessPeerStore
>;

export function createDrawingAwarenessPeerStore() {
  let peers = EMPTY_PEERS;
  let lockPeers: DrawingAwarenessLockPeer[] = [];
  let encodedLocks = "[]";
  const listeners = new Set<() => void>();
  const lockListeners = new Set<() => void>();
  return {
    getSnapshot: () => peers,
    getLocksSnapshot: () => lockPeers,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeLocks(listener: () => void) {
      lockListeners.add(listener);
      return () => lockListeners.delete(listener);
    },
    replace(next: DrawingAwarenessPeer[]) {
      peers = next.length ? next : EMPTY_PEERS;
      for (const listener of listeners) listener();
      const nextLockPeers = peers.map(({ clientId, softLocks, user }) => ({
        clientId,
        softLocks,
        user,
      }));
      const nextEncodedLocks = JSON.stringify(nextLockPeers);
      if (nextEncodedLocks === encodedLocks) return;
      lockPeers = nextLockPeers;
      encodedLocks = nextEncodedLocks;
      for (const listener of lockListeners) listener();
    },
  };
}

function hash(value: string) {
  let result = 2_166_136_261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

export function drawingAwarenessColor(userId: string) {
  return COLORS[hash(userId) % COLORS.length];
}

function rgb(color: string) {
  const matched = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!matched)
    throw new Error("Awareness color must be a six-digit hex color.");
  return matched.slice(1).map((channel) => Number.parseInt(channel, 16));
}

function luminance(color: string) {
  const channels = rgb(color).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

export function drawingAwarenessContrastRatio(first: string, second: string) {
  const [lighter, darker] = [luminance(first), luminance(second)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function canonicalLocalState(
  input: DrawingAwarenessLocalInput,
  user: { id: string; displayName: string },
) {
  return DrawingAwarenessStateSchema.parse({
    user: { ...user, color: drawingAwarenessColor(user.id) },
    pageId: input.pageId,
    canvasId: input.canvasId,
    cursorWorld: input.cursorWorld,
    selectedIds: [...new Set(input.selectedIds)].sort(),
    activeTool: input.activeTool,
    softLocks: input.softLocks,
  });
}

export function createDrawingAwarenessPublisher({
  user,
  publish,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame,
}: {
  user: { id: string; displayName: string };
  publish: (state: DrawingAwarenessState | null) => void;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (handle: number) => void;
}) {
  let pending: DrawingAwarenessState | null = null;
  let published = "";
  let frame: number | null = null;
  let disposed = false;
  const flush = () => {
    frame = null;
    if (!pending || disposed) return;
    const encoded = JSON.stringify(pending);
    if (encoded === published) return;
    published = encoded;
    publish(pending);
  };
  const clear = () => {
    if (frame !== null) cancelFrame(frame);
    frame = null;
    pending = null;
    published = "";
    publish(null);
  };
  return {
    update(input: DrawingAwarenessLocalInput) {
      if (disposed) return;
      pending = canonicalLocalState(input, user);
      if (frame === null) frame = requestFrame(flush);
    },
    clear,
    dispose() {
      if (disposed) return;
      disposed = true;
      clear();
    },
  };
}

export function parseDrawingAwarenessPeers(
  states: Map<number, unknown>,
  scope: {
    localClientId: number;
    pageId: string | null;
    canvasId: string | null;
    now?: number;
  },
) {
  const now = scope.now ?? Date.now();
  return [...states.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([clientId, value]): DrawingAwarenessPeer[] => {
      if (clientId === scope.localClientId) return [];
      const parsed = DrawingAwarenessStateSchema.safeParse(value);
      if (!parsed.success) return [];
      const state = parsed.data;
      if (
        state.user.color.toLowerCase() !== drawingAwarenessColor(state.user.id)
      )
        return [];
      const sameCanvas =
        state.pageId === scope.pageId && state.canvasId === scope.canvasId;
      return [
        {
          ...state,
          clientId,
          cursorWorld: sameCanvas ? state.cursorWorld : null,
          selectedIds: sameCanvas ? [...state.selectedIds].sort() : [],
          softLocks: sameCanvas
            ? state.softLocks.filter((lock) => lock.expiresAt > now)
            : [],
        },
      ];
    });
}

export function drawingSoftLockConflict(
  entityId: string,
  peers: DrawingAwarenessLockPeer[],
  now = Date.now(),
) {
  for (const peer of peers) {
    const lock = peer.softLocks.find(
      (candidate) =>
        candidate.entityId === entityId && candidate.expiresAt > now,
    );
    if (lock) return { advisory: true as const, lock, user: peer.user };
  }
  return null;
}

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function invalidRecordedOperation(): never {
  throw new Error("Drawing recorded operation payload is invalid.");
}

function boundedItems(value: unknown): unknown[] {
  if (
    !Array.isArray(value) ||
    value.length > DRAWING_COLLABORATION_LIMITS.maxActionItems
  )
    invalidRecordedOperation();
  return value;
}

function canonicalTargetId(value: unknown) {
  if (typeof value !== "string" || !CANONICAL_UUID.test(value))
    invalidRecordedOperation();
  return value;
}

function optionalCanonicalTargetId(value: unknown) {
  return value === null ? [] : [canonicalTargetId(value)];
}

function structureActionTargetIds(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return invalidRecordedOperation();
  const action = value as DrawingStructureAction;
  switch (action.kind) {
    case "put_object":
    case "put_block_instance":
      return [canonicalTargetId(action.entity.id)];
    case "delete_object":
    case "delete_block_instance":
      return [canonicalTargetId(action.id)];
    case "put_property_value":
      return [action.entity.objectId, action.entity.blockInstanceId].flatMap(
        optionalCanonicalTargetId,
      );
    case "put_table":
      return boundedItems(action.entity.rows).flatMap((row) =>
        [
          (row as { objectId: unknown }).objectId,
          (row as { blockInstanceId: unknown }).blockInstanceId,
        ].flatMap(optionalCanonicalTargetId),
      );
    case "delete_property_value":
    case "delete_table":
    case "put_page":
    case "delete_page":
    case "put_canvas":
    case "delete_canvas":
    case "put_layer":
    case "delete_layer":
    case "put_style":
    case "delete_style":
    case "put_block":
    case "delete_block":
    case "put_property_schema":
    case "delete_property_schema":
      return [];
    default:
      return invalidRecordedOperation();
  }
}

export function drawingCommandTargetIds(
  command: DrawingCommand | DrawingRecordedOperation["forward"],
) {
  if (command.type === "add_objects")
    return boundedItems(command.objects).map((object) =>
      canonicalTargetId((object as { id: unknown }).id),
    );
  if (command.type === "update_objects")
    return boundedItems(command.updates).map((update) =>
      canonicalTargetId((update as { objectId: unknown }).objectId),
    );
  if (command.type === "delete_objects")
    return boundedItems(command.objectIds).map(canonicalTargetId);
  if (command.type === "mutate_structure")
    return boundedItems(command.actions).flatMap(structureActionTargetIds);
  if (command.type === "mutate_objects_with_references")
    return [
      ...boundedItems(command.objects).map((object) =>
        canonicalTargetId((object as { id: unknown }).id),
      ),
      ...boundedItems(command.actions).flatMap(structureActionTargetIds),
    ];
  if (command.type === "add_layer" || command.type === "update_layer")
    return [];
  return invalidRecordedOperation();
}

function operationPayloadTargetIds(payload: unknown, allowEmpty: boolean) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return invalidRecordedOperation();
  if (Object.keys(payload).length === 0)
    return allowEmpty ? [] : invalidRecordedOperation();
  return drawingCommandTargetIds(
    payload as DrawingRecordedOperation["forward"],
  );
}

export function drawingRecordedOperationTargetIds(
  operation: Pick<DrawingRecordedOperation, "forward" | "inverse">,
) {
  const emptyInverseAllowed = operation.forward.type === "add_layer";
  const targets = new Set([
    ...operationPayloadTargetIds(operation.forward, false),
    ...operationPayloadTargetIds(operation.inverse, emptyInverseAllowed),
  ]);
  if (targets.size > DRAWING_COLLABORATION_LIMITS.maxActionItems * 2)
    return invalidRecordedOperation();
  return [...targets];
}

export function drawingCommandSoftLockConflict(
  command: DrawingCommand | DrawingRecordedOperation["forward"],
  peers: DrawingAwarenessLockPeer[],
  now = Date.now(),
) {
  for (const entityId of new Set(drawingCommandTargetIds(command))) {
    const conflict = drawingSoftLockConflict(entityId, peers, now);
    if (conflict) return conflict;
  }
  return null;
}

export function drawingRecordedOperationSoftLockConflict(
  operation: Pick<DrawingRecordedOperation, "forward" | "inverse">,
  peers: DrawingAwarenessLockPeer[],
  now = Date.now(),
) {
  for (const entityId of drawingRecordedOperationTargetIds(operation)) {
    const conflict = drawingSoftLockConflict(entityId, peers, now);
    if (conflict) return conflict;
  }
  return null;
}

export function drawingSelectionSoftLockConflict(
  entityIds: readonly string[],
  peers: DrawingAwarenessLockPeer[],
  now = Date.now(),
) {
  for (const entityId of entityIds) {
    const conflict = drawingSoftLockConflict(entityId, peers, now);
    if (conflict) return conflict;
  }
  return null;
}

export function createDrawingSoftLockLease({
  now = Date.now,
  createId = crypto.randomUUID,
  onChange,
}: {
  now?: () => number;
  createId?: () => string;
  onChange?: (locks: DrawingAwarenessState["softLocks"]) => void;
} = {}) {
  let lock: DrawingAwarenessState["softLocks"][number] | null = null;
  const notify = () => onChange?.(lock ? [lock] : []);
  const current = () => {
    if (lock && lock.expiresAt <= now()) {
      lock = null;
      notify();
    }
    return lock;
  };
  return {
    acquire(entityId: string) {
      lock = {
        entityId,
        leaseId: createId(),
        expiresAt: now() + MAX_LEASE_MS,
      };
      notify();
      return lock;
    },
    renew() {
      if (!current()) return null;
      lock = { ...lock!, expiresAt: now() + MAX_LEASE_MS };
      notify();
      return lock;
    },
    release() {
      if (!lock) return;
      lock = null;
      notify();
    },
    current,
  };
}
