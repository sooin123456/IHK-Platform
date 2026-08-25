import type {
  AppliedDrawingCommand,
  DrawingCommand,
} from "./drawing-commands.ts";
import * as Y from "yjs";
import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DrawingCollaborationOperationSchema,
  type DrawingCollaborationOperation,
} from "./drawing-collaboration-protocol.ts";
import type {
  DrawingDraftAdapter,
  PreparedDrawingDraft,
} from "./drawing-yjs-draft.ts";
import type { DrawingOutbox } from "./drawing-outbox.ts";
import { drawingRoomName } from "./drawing-collaboration-protocol.ts";
import {
  DrawingOperationInputSchema,
  type DrawingOperationInput,
} from "./drawing-workspace.types.ts";

export type DrawingCollaborationRecentOutcome = {
  revisionId: string;
  clientOperationId: string;
  actorId: string;
  operationType: DrawingOperationInput["type"];
  baseVersions: DrawingOperationInput["baseVersions"];
  forward: DrawingOperationInput["forward"];
  inverse: DrawingOperationInput["inverse"];
  sequence: number;
  resultVersions: Record<string, number>;
};

export type DrawingCollaborationConnection = {
  phase: "connected" | "connecting" | "degraded";
  flush(): void;
  refreshToken(): Promise<void>;
  dispose(): void;
};

export function drawingCollaborationPhaseForProviderStatus(status: string) {
  if (status === "connected") return "connected" as const;
  if (status === "disconnected") return "degraded" as const;
  return "connecting" as const;
}

type DrawingCollaborationCapability =
  | "admin"
  | "editor"
  | "reviewer"
  | "commenter"
  | "viewer";
type DrawingCollaborationRevisionStatus =
  | "draft"
  | "review_requested"
  | "approved"
  | "superseded";

export function drawingCollaborationAuthority({
  bootstrap,
  fallbackCapability,
  fallbackRevisionStatus,
}: {
  bootstrap?: {
    capability: DrawingCollaborationCapability;
    revisionStatus: DrawingCollaborationRevisionStatus;
    canWrite: boolean;
  };
  fallbackCapability: DrawingCollaborationCapability;
  fallbackRevisionStatus: DrawingCollaborationRevisionStatus;
}) {
  if (bootstrap)
    return {
      capability: bootstrap.capability,
      revisionStatus: bootstrap.revisionStatus,
      canWrite: bootstrap.canWrite,
    };
  return {
    capability: fallbackCapability,
    revisionStatus: fallbackRevisionStatus,
    canWrite:
      fallbackRevisionStatus === "draft" &&
      (fallbackCapability === "admin" || fallbackCapability === "editor"),
  };
}

export async function openDrawingCollaborationLocalAttempt<
  Document extends { destroy(): void },
  Persistence extends { whenSynced(): Promise<void>; dispose(): Promise<void> },
  Adapter extends { dispose(): void },
>({
  createDocument,
  openPersistence,
  createAdapter,
  reconcile,
}: {
  createDocument(): Document;
  openPersistence(document: Document): Promise<Persistence | null>;
  createAdapter(document: Document): Adapter;
  reconcile(adapter: Adapter): Promise<void>;
}) {
  const document = createDocument();
  let persistence: Persistence | null = null;
  let adapter: Adapter | null = null;
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    try {
      adapter?.dispose();
    } finally {
      try {
        await persistence?.dispose();
      } finally {
        document.destroy();
      }
    }
  };
  try {
    persistence = await openPersistence(document);
    await persistence?.whenSynced();
    adapter = createAdapter(document);
    await reconcile(adapter);
    return { document, persistence, adapter, dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

export function initializeDrawingCollaborationDocument({
  document,
  projectId,
  revisionId,
  baseSnapshotSha256,
  baseOperationSequence,
}: {
  document: Y.Doc;
  projectId: string;
  revisionId: string;
  baseSnapshotSha256: string;
  baseOperationSequence: number;
}) {
  document.transact(() => {
    const meta = document.getMap("serverMeta");
    if (meta.size === 0) {
      meta.set("schemaVersion", DRAWING_COLLABORATION_SCHEMA_VERSION);
      meta.set("projectId", projectId);
      meta.set("revisionId", revisionId);
      meta.set("baseSnapshotSha256", baseSnapshotSha256);
      meta.set("baseOperationSequence", baseOperationSequence);
      meta.set("freezeState", "active");
      meta.set("freezeRequestId", null);
    }
    document.getArray("operationOrder");
    document.getArray("operations");
    document.getMap("operationStatus");
  });
}

/** Browser token resolver. It serializes no token or privileged server secret. */
export function createDrawingAccessTokenResolver(
  environment: Record<string, string | undefined> = import.meta.env,
) {
  let client: Promise<{
    auth: {
      getSession(): Promise<{
        data: { session: { access_token: string } | null };
      }>;
    };
  }> | null = null;
  return async () => {
    if (!client) {
      const url = environment.VITE_SUPABASE_URL ?? environment.SUPABASE_URL;
      const key =
        environment.VITE_SUPABASE_ANON_KEY ?? environment.SUPABASE_ANON_KEY;
      if (!url || !key)
        throw new Error("Supabase browser session is unavailable.");
      client = import("@supabase/ssr").then(({ createBrowserClient }) =>
        createBrowserClient(url, key),
      );
    }
    const { data } = await (await client).auth.getSession();
    if (!data.session?.access_token)
      throw new Error("Authenticated drawing session is unavailable.");
    return data.session.access_token;
  };
}

export async function openDrawingCollaborationConnection({
  document,
  projectId,
  revisionId,
  resolveToken,
  url,
  onPhase,
}: {
  document: Y.Doc;
  projectId: string;
  revisionId: string;
  resolveToken: () => Promise<string>;
  url?: string;
  onPhase?: (phase: DrawingCollaborationConnection["phase"]) => void;
}): Promise<DrawingCollaborationConnection | null> {
  if (!url) {
    onPhase?.("degraded");
    return null;
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:")
    throw new Error("Drawing collaboration URL must use WebSocket.");
  const { HocuspocusProvider } = await import("@hocuspocus/provider");
  onPhase?.("connecting");
  const provider = new HocuspocusProvider({
    url: parsed.toString(),
    name: drawingRoomName(projectId, revisionId),
    document,
    token: resolveToken,
    onStatus: ({ status }) =>
      onPhase?.(drawingCollaborationPhaseForProviderStatus(status)),
  });
  return {
    phase: "connecting",
    flush: () => provider.flushPendingUpdates(),
    refreshToken: () => provider.sendToken(),
    dispose: () => provider.destroy(),
  };
}

type DraftCommandAdapter = Pick<
  DrawingDraftAdapter,
  | "prepareLocal"
  | "preparePersistedLocal"
  | "prepareRecordedLocal"
  | "appendDurableLocal"
>;

type RepairDraftAdapter = Pick<
  DrawingDraftAdapter,
  "operations" | "preparePersistedLocal" | "appendDurableLocal"
>;

type RepairOutbox = Pick<DrawingOutbox, "entries" | "enqueue" | "markAcked">;

function operationInput(operation: DrawingCollaborationOperation) {
  const { actorId: _actor, schemaVersion: _schema, ...input } = operation;
  return DrawingOperationInputSchema.parse(input);
}

function collaborationOperation(
  operation: DrawingOperationInput & { actorId?: string },
  actorId: string,
): DrawingCollaborationOperation {
  return DrawingCollaborationOperationSchema.parse({
    clientOperationId: operation.clientOperationId,
    revisionId: operation.revisionId,
    actorId,
    schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
    type: operation.type,
    baseVersions: operation.baseVersions,
    forward: operation.forward,
    inverse: operation.inverse,
    createdAt: operation.createdAt,
    ...(operation.originalOperationId && operation.historyAction
      ? {
          originalOperationId: operation.originalOperationId,
          historyAction: operation.historyAction,
        }
      : {}),
  });
}

function outcomeOperation(
  outcome: DrawingCollaborationRecentOutcome,
): DrawingCollaborationOperation {
  return DrawingCollaborationOperationSchema.parse({
    clientOperationId: outcome.clientOperationId,
    revisionId: outcome.revisionId,
    actorId: outcome.actorId,
    schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
    type: outcome.operationType,
    baseVersions: outcome.baseVersions,
    forward: outcome.forward,
    inverse: outcome.inverse,
    // Postgres intentionally does not compare client creation time. A repaired
    // accepted envelope uses the stable operation ID as its deterministic time.
    createdAt: "1970-01-01T00:00:00.000Z",
  });
}

export function drawingCollaborationLifecycleKey(
  userId: string,
  projectId: string,
  revisionId: string,
) {
  return `${userId}\u0000${projectId}\u0000${revisionId}`;
}

/** The only local mutation order: validate, durable outbox, Yjs, provider. */
export function createDrawingCollaborationCommandBridge({
  adapter,
  outbox,
  afterAppend,
}: {
  adapter: DraftCommandAdapter;
  outbox: Pick<DrawingOutbox, "enqueue">;
  afterAppend?: (prepared: PreparedDrawingDraft) => void;
}) {
  const persist = async (prepared: PreparedDrawingDraft) => {
    await outbox.enqueue(operationInput(prepared.operation));
    adapter.appendDurableLocal(prepared);
    afterAppend?.(prepared);
    return prepared;
  };
  return {
    async applyCommand(command: DrawingCommand) {
      return persist(adapter.prepareLocal(command));
    },
    async applyRecorded(applied: AppliedDrawingCommand) {
      return persist(adapter.prepareRecordedLocal(applied.operation));
    },
  };
}

/** Repairs the three durable ledgers before a network provider is connected. */
export async function reconcileDrawingCollaborationDraft({
  actorId,
  adapter,
  outbox,
  recentOutcomes,
}: {
  actorId: string;
  adapter: RepairDraftAdapter;
  outbox: RepairOutbox;
  recentOutcomes: DrawingCollaborationRecentOutcome[];
}) {
  const entries = await outbox.entries();
  const outboxById = new Map(
    entries.map((entry) => [entry.operation.clientOperationId, entry]),
  );
  const operations = new Map(
    adapter
      .operations()
      .map((operation) => [operation.clientOperationId, operation]),
  );
  const accepted = new Map(
    recentOutcomes.map((outcome) => [outcome.clientOperationId, outcome]),
  );

  for (const entry of entries) {
    const id = entry.operation.clientOperationId;
    if (accepted.has(id) || operations.has(id)) continue;
    const prepared = adapter.preparePersistedLocal(
      collaborationOperation(entry.operation, actorId),
    );
    adapter.appendDurableLocal(prepared);
    operations.set(id, prepared.operation);
  }

  for (const operation of adapter.operations()) {
    if (
      operation.actorId !== actorId ||
      outboxById.has(operation.clientOperationId)
    )
      continue;
    await outbox.enqueue(operationInput(operation));
  }

  for (const outcome of recentOutcomes) {
    if (outcome.actorId !== actorId) continue;
    if (!operations.has(outcome.clientOperationId)) {
      const queued = outboxById.get(outcome.clientOperationId)?.operation;
      const prepared = adapter.preparePersistedLocal(
        queued
          ? collaborationOperation(queued, actorId)
          : outcomeOperation(outcome),
      );
      adapter.appendDurableLocal(prepared);
    }
    await outbox.markAcked(outcome.clientOperationId);
  }
}
