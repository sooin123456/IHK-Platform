import type {
  AppliedDrawingCommand,
  DrawingCommand,
  DrawingDocumentState,
} from "./drawing-commands.ts";
import * as Y from "yjs";
import {
  DRAWING_COLLABORATION_SCHEMA_VERSION,
  DrawingCollaborationMetaSchema,
  DrawingCollaborationOperationSchema,
  DrawingCollaborationStatusSchema,
  drawingCollaborationOperationDigestSource,
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
import type { DrawingAwarenessState } from "./drawing-collaboration-protocol.ts";

export type DrawingCollaborationAwareness = {
  clientId: number;
  getStates(): Map<number, unknown>;
  setLocalState(state: DrawingAwarenessState | null): void;
  subscribe(listener: () => void): () => void;
};

export type DrawingCollaborationRecentOutcomeReceipt = {
  revisionId: string;
  clientOperationId: string;
  actorId: string;
  sequence: number;
  resultVersions: Record<string, number | null>;
  operationSha256: string;
};

const MAX_DRAWING_COLLABORATION_RECENT_OUTCOMES = 256;

export function drawingCollaborationRecentOutcomesKey(
  outcomes: readonly DrawingCollaborationRecentOutcomeReceipt[],
) {
  return JSON.stringify(
    outcomes.map((outcome) => [
      outcome.clientOperationId,
      outcome.actorId,
      outcome.sequence,
      outcome.operationSha256,
      Object.entries(outcome.resultVersions).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ]),
  );
}

export function assertDrawingCollaborationRecentOutcomeReceipts({
  revisionId,
  baseOperationSequence,
  recentOutcomes,
}: {
  revisionId: string;
  baseOperationSequence: number;
  recentOutcomes: DrawingCollaborationRecentOutcomeReceipt[];
}) {
  if (
    recentOutcomes.length > MAX_DRAWING_COLLABORATION_RECENT_OUTCOMES ||
    new Set(recentOutcomes.map((outcome) => outcome.clientOperationId)).size !==
      recentOutcomes.length ||
    new Set(recentOutcomes.map((outcome) => outcome.sequence)).size !==
      recentOutcomes.length ||
    recentOutcomes.some(
      (outcome, index) =>
        outcome.revisionId !== revisionId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          outcome.actorId,
        ) ||
        !/^[0-9a-f]{64}$/.test(outcome.operationSha256) ||
        !DrawingCollaborationStatusSchema.safeParse({
          operationId: outcome.clientOperationId,
          status: "acked",
          authoritativeSequence: outcome.sequence,
          resultVersions: outcome.resultVersions,
        }).success ||
        outcome.sequence > baseOperationSequence ||
        (index > 0 && recentOutcomes[index - 1].sequence >= outcome.sequence),
    )
  )
    throw new Error("Drawing collaboration bootstrap outcomes are invalid.");
}

export type DrawingCollaborationConnection = {
  phase: "connected" | "connecting" | "degraded" | "retrying" | "denied";
  flush(): void;
  refreshToken(): Promise<void>;
  dispose(): void;
  awareness?: DrawingCollaborationAwareness;
};

export function drawingCollaborationPhaseForProviderStatus(status: string) {
  if (status === "disconnected") return "degraded" as const;
  // An open socket is not proof that the room was admitted and synchronized.
  return "connecting" as const;
}

type DrawingCollaborationCapability =
  | "admin"
  | "editor"
  | "reviewer"
  | "approver"
  | "commenter"
  | "viewer";
type DrawingCollaborationRevisionStatus =
  | "draft"
  | "review_requested"
  | "reviewed"
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
  const localBaseMeta = DrawingCollaborationMetaSchema.parse({
    schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
    projectId,
    revisionId,
    baseSnapshotSha256,
    baseOperationSequence,
    freezeState: "active",
    freezeRequestId: null,
  });
  document.transact(() => {
    document.getMap("serverMeta");
    document.getArray("operationOrder");
    document.getArray("operations");
    document.getMap("operationStatus");
  });
  return localBaseMeta;
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
  let phase: DrawingCollaborationConnection["phase"] = "connecting";
  let disposed = false;
  let socketConnected = false;
  let awaitingSync = true;
  let generation = 0;
  let retryDelay = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const publishPhase = (next: DrawingCollaborationConnection["phase"]) => {
    if (disposed || phase === next) return;
    phase = next;
    onPhase?.(next);
  };
  const refreshToken = async () => {
    if (
      disposed ||
      phase === "denied" ||
      !socketConnected ||
      awaitingSync ||
      retryTimer !== null
    )
      return;
    awaitingSync = true;
    const attemptGeneration = generation;
    provider.synced = false;
    if (phase !== "retrying") publishPhase("connecting");
    await provider.sendToken();
    if (
      disposed ||
      generation !== attemptGeneration ||
      !socketConnected ||
      !awaitingSync
    )
      return;
    // Hocuspocus discards the sync frames of a refused admission. Token refresh
    // alone reauthenticates, but never requests the retained document again.
    provider.startSync();
  };
  onPhase?.("connecting");
  const provider = new HocuspocusProvider({
    url: parsed.toString(),
    name: drawingRoomName(projectId, revisionId),
    document,
    token: resolveToken,
    onOpen: () => {
      if (disposed) return;
      generation++;
      clearRetry();
      awaitingSync = true;
    },
    onStatus: ({ status }) => {
      if (disposed) return;
      socketConnected = status === "connected";
      if (!socketConnected) {
        generation++;
        clearRetry();
        awaitingSync = false;
      }
      if (phase === "denied") return;
      if (socketConnected && (phase === "connected" || phase === "retrying"))
        return;
      publishPhase(drawingCollaborationPhaseForProviderStatus(status));
    },
    onClose: ({ event }) => {
      if (disposed || phase === "denied") return;
      // Document-only CLOSE frames do not close the shared WebSocket or emit
      // a transport status. Never retain an admitted badge after room removal.
      generation++;
      awaitingSync = false;
      clearRetry();
      const denied =
        event.code === 4401 ||
        event.code === 4403 ||
        [
          "permission-revoked",
          "review-freeze",
          "Unauthorized",
          "Forbidden",
        ].includes(event.reason);
      publishPhase(denied ? "denied" : "degraded");
      if (denied) provider.disconnect();
    },
    onSynced: ({ state }) => {
      if (
        disposed ||
        phase === "denied" ||
        !state ||
        !socketConnected ||
        !provider.isAuthenticated
      )
        return;
      awaitingSync = false;
      clearRetry();
      retryDelay = 1000;
      publishPhase("connected");
    },
    onAuthenticationFailed: ({ reason }) => {
      if (disposed || phase === "denied") return;
      generation++;
      awaitingSync = false;
      provider.synced = false;
      clearRetry();
      if (reason !== "drawing-reconciling") {
        publishPhase("denied");
        provider.disconnect();
        return;
      }
      publishPhase("retrying");
      // Only the server's explicit transient admission reason is retryable.
      // A lease may outlive a minute; cap the rate, not the recovery window.
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void refreshToken().catch(() => {
          if (!disposed) {
            awaitingSync = false;
            publishPhase("degraded");
          }
        });
      }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10_000);
    },
  });
  const awareness = provider.awareness;
  return {
    get phase() {
      return phase;
    },
    flush: () => {
      if (!disposed) provider.flushPendingUpdates();
    },
    refreshToken,
    ...(awareness
      ? {
          awareness: {
            clientId: awareness.clientID,
            getStates: () => awareness.getStates(),
            setLocalState: (state: DrawingAwarenessState | null) =>
              awareness.setLocalState(state),
            subscribe(listener: () => void) {
              awareness.on("change", listener);
              return () => awareness.off("change", listener);
            },
          },
        }
      : {}),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      generation++;
      clearRetry();
      provider.destroy();
    },
  };
}

type DraftCommandAdapter = Pick<
  DrawingDraftAdapter,
  | "prepareLocal"
  | "preparePersistedLocal"
  | "prepareRecordedLocal"
  | "appendDurableLocal"
  | "hydrateCanonicalHistory"
>;

type RepairDraftAdapter = Pick<
  DrawingDraftAdapter,
  "operations" | "preparePersistedLocal" | "appendDurableLocal"
> &
  Partial<
    Pick<
      DrawingDraftAdapter,
      | "isOperationCheckpointAcknowledged"
      | "operationStatus"
      | "recordLocalAcknowledgement"
    >
  >;

type RepairOutbox = Pick<DrawingOutbox, "entries" | "enqueue" | "markAcked"> &
  Partial<Pick<DrawingOutbox, "acknowledgements" | "recoverOperation">>;

function operationInput(operation: DrawingCollaborationOperation) {
  const { actorId: _actor, schemaVersion: _schema, ...input } = operation;
  return DrawingOperationInputSchema.parse(input);
}

function sameDrawingResultVersions(
  left: Record<string, number | null>,
  right: Record<string, number | null>,
) {
  const leftEntries = Object.entries(left).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const rightEntries = Object.entries(right).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(
      ([id, version], index) =>
        id === rightEntries[index][0] && version === rightEntries[index][1],
    )
  );
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

async function drawingCollaborationOperationSha256(
  operation: DrawingOperationInput,
  actorId: string,
) {
  const bytes = new TextEncoder().encode(
    drawingCollaborationOperationDigestSource(operation, actorId),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function acceptedRecoveryOperation(
  operation: DrawingOperationInput & { actorId?: string },
  actorId: string,
) {
  const candidate = {
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
  };
  const parsed = DrawingCollaborationOperationSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  if (
    parsed.error.issues.every(
      (issue) =>
        issue.message ===
        "Drawing collaboration operation exceeds its byte limit.",
    )
  )
    return null;
  throw parsed.error;
}

export function drawingCollaborationLifecycleKey(
  userId: string,
  projectId: string,
  revisionId: string,
) {
  return `${userId}\u0000${projectId}\u0000${revisionId}`;
}

export function drawingCollaborationProviderReady(input: {
  sourceReady: boolean;
  checkpointInstalled: boolean;
}) {
  return input.sourceReady && input.checkpointInstalled;
}

/** Catches an adapter up to the latest coherent route checkpoint before it is exposed. */
export async function synchronizeDrawingCollaborationCheckpoint<
  Checkpoint extends { key: string },
>({
  appliedKey,
  getCurrentCheckpoint,
  applyCheckpoint,
  maxAttempts = 4,
}: {
  appliedKey: string;
  getCurrentCheckpoint(): Checkpoint;
  applyCheckpoint(checkpoint: Checkpoint): Promise<void>;
  maxAttempts?: number;
}) {
  if (maxAttempts < 1)
    throw new Error("Drawing checkpoint convergence bounds are invalid.");
  let currentKey = appliedKey;
  let attempts = 0;
  while (true) {
    const checkpoint = getCurrentCheckpoint();
    if (checkpoint.key === currentKey) return currentKey;
    if (attempts >= maxAttempts)
      throw new Error(
        "Drawing authoritative checkpoint did not converge within its startup bound.",
      );
    attempts += 1;
    await applyCheckpoint(checkpoint);
    currentKey = checkpoint.key;
  }
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
    hydrateCanonicalHistory(state: DrawingDocumentState) {
      return adapter.hydrateCanonicalHistory(state);
    },
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
  revisionId,
  baseOperationSequence = 0,
  adapter,
  outbox,
  recentOutcomes,
  commitRecoveredOperation,
}: {
  actorId: string;
  revisionId: string;
  baseOperationSequence?: number;
  adapter: RepairDraftAdapter;
  outbox: RepairOutbox;
  recentOutcomes: DrawingCollaborationRecentOutcomeReceipt[];
  commitRecoveredOperation?: () => Promise<void>;
}) {
  assertDrawingCollaborationRecentOutcomeReceipts({
    revisionId,
    baseOperationSequence,
    recentOutcomes,
  });
  const entries = await outbox.entries();
  const durableAcknowledgements = (await outbox.acknowledgements?.()) ?? [];
  if (
    new Set(durableAcknowledgements.map((item) => item.clientOperationId))
      .size !== durableAcknowledgements.length ||
    new Set(durableAcknowledgements.map((item) => item.authoritativeSequence))
      .size !== durableAcknowledgements.length ||
    durableAcknowledgements.some(
      (item) =>
        item.operation.clientOperationId !== item.clientOperationId ||
        item.operation.revisionId !== revisionId,
    )
  )
    throw new Error("Drawing durable acknowledgements are invalid.");
  const durableAcknowledgementIds = new Set(
    durableAcknowledgements.map((item) => item.clientOperationId),
  );
  const durableAcknowledgementsById = new Map(
    durableAcknowledgements.map((item) => [item.clientOperationId, item]),
  );
  const outboxById = new Map(
    entries.map((entry) => [entry.operation.clientOperationId, entry]),
  );
  const localOperations = adapter.operations();
  const operations = new Map(
    localOperations.map((operation) => [
      operation.clientOperationId,
      operation,
    ]),
  );
  await Promise.all(
    durableAcknowledgements.flatMap((acknowledgement) => {
      const local = operations.get(acknowledgement.clientOperationId);
      if (!local) return [];
      return [
        Promise.all([
          drawingCollaborationOperationSha256(
            acknowledgement.operation,
            actorId,
          ),
          drawingCollaborationOperationSha256(
            operationInput(local),
            local.actorId,
          ),
        ]).then(([persistedDigest, localDigest]) => {
          if (persistedDigest !== localDigest)
            throw new Error(
              "Drawing durable acknowledgement operation does not match its local ledger.",
            );
        }),
      ];
    }),
  );
  const accepted = new Map(
    recentOutcomes.map((outcome) => [outcome.clientOperationId, outcome]),
  );
  await Promise.all(
    recentOutcomes.flatMap((outcome) => {
      const candidates: Array<Promise<string>> = [];
      const queued = outboxById.get(outcome.clientOperationId)?.operation;
      const local = operations.get(outcome.clientOperationId);
      const durable = durableAcknowledgementsById.get(
        outcome.clientOperationId,
      );
      if ((queued || durable) && outcome.actorId !== actorId)
        throw new Error(
          "Drawing authoritative receipt actor does not match its local operation.",
        );
      if (durable) {
        if (
          durable.authoritativeSequence !== outcome.sequence ||
          !sameDrawingResultVersions(
            durable.resultVersions,
            outcome.resultVersions,
          )
        )
          throw new Error(
            "Drawing authoritative receipt conflicts with its durable acknowledgement.",
          );
        candidates.push(
          drawingCollaborationOperationSha256(
            durable.operation,
            outcome.actorId,
          ),
        );
      }
      if (queued)
        candidates.push(
          drawingCollaborationOperationSha256(queued, outcome.actorId),
        );
      if (local) {
        if (local.actorId !== outcome.actorId)
          throw new Error(
            "Drawing authoritative receipt actor does not match its local ledger.",
          );
        candidates.push(
          drawingCollaborationOperationSha256(
            operationInput(local),
            local.actorId,
          ),
        );
      }
      return candidates.map(async (digest) => {
        if ((await digest) !== outcome.operationSha256)
          throw new Error(
            "Drawing local operation digest does not match its authoritative receipt.",
          );
      });
    }),
  );
  for (const acknowledgement of durableAcknowledgements)
    if (operations.has(acknowledgement.clientOperationId))
      adapter.recordLocalAcknowledgement?.(acknowledgement, "canonical");
  for (const entry of entries) {
    const id = entry.operation.clientOperationId;
    if (accepted.has(id)) continue;
    const append = async () => {
      const prepared = adapter.preparePersistedLocal(
        collaborationOperation(entry.operation, actorId),
      );
      adapter.appendDurableLocal(prepared);
      await commitRecoveredOperation?.();
      operations.set(id, prepared.operation);
    };
    if (outbox.recoverOperation) await outbox.recoverOperation(id, append);
    else if (!operations.has(id)) await append();
  }

  for (const operation of adapter.operations()) {
    const status = adapter.operationStatus?.(operation.clientOperationId);
    if (
      status?.status === "conflicted" ||
      status?.status === "rejected" ||
      operation.actorId !== actorId ||
      outboxById.has(operation.clientOperationId) ||
      accepted.has(operation.clientOperationId) ||
      durableAcknowledgementIds.has(operation.clientOperationId) ||
      adapter.isOperationCheckpointAcknowledged?.(
        operation.clientOperationId,
        baseOperationSequence,
      )
    )
      continue;
    await outbox.enqueue(operationInput(operation));
  }

  for (const outcome of recentOutcomes) {
    if (outcome.actorId !== actorId) continue;
    if (durableAcknowledgementIds.has(outcome.clientOperationId)) continue;
    const queued = outboxById.get(outcome.clientOperationId)?.operation;
    let local = operations.get(outcome.clientOperationId);
    if (!local) {
      if (queued) {
        const operation = acceptedRecoveryOperation(queued, actorId);
        if (operation) {
          const prepared = adapter.preparePersistedLocal(operation);
          adapter.appendDurableLocal(prepared);
          local = prepared.operation;
          operations.set(outcome.clientOperationId, local);
        }
      }
    }
    if (queued && local) await commitRecoveredOperation?.();
    const acknowledgement = {
      clientOperationId: outcome.clientOperationId,
      authoritativeSequence: outcome.sequence,
      resultVersions: outcome.resultVersions,
    };
    if (local)
      adapter.recordLocalAcknowledgement?.(acknowledgement, "canonical");
    await outbox.markAcked(
      outcome.clientOperationId,
      queued
        ? {
            ...acknowledgement,
            operation: queued,
          }
        : undefined,
    );
  }
}
