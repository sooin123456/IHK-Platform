import type {
  DrawingDocumentState,
  DrawingRecordedOperation,
} from "./drawing-commands.ts";
import {
  applyDrawingStructureActions,
  sameDrawingCanonicalValue,
  validateDrawingReferenceAwareObjectMutation,
  validateDrawingStructureState,
} from "./drawing-structure.ts";
import {
  DrawingLayerInputSchema,
  DrawingLayerSchema,
  DrawingObjectSchema,
  DrawingOperationInputSchema,
  type DrawingStructureAction,
  type DrawingOperationInput,
} from "./drawing-workspace.types.ts";
import {
  DRAWING_COLLABORATION_LIMITS,
  DrawingCollaborationStatusSchema,
} from "./drawing-collaboration-protocol.ts";

export type DrawingOutboxStatus = "pending" | "conflicted" | "rejected";

export type DrawingOutboxEntry = {
  ownerId: string;
  operation: DrawingOperationInput;
  status: DrawingOutboxStatus;
  retryCount: number;
  enqueueSequence: number;
  error?: string;
};

export type DrawingOutboxAcknowledgement = {
  clientOperationId: string;
  authoritativeSequence: number;
  resultVersions: Record<string, number | null>;
  operation: DrawingOperationInput;
};

export type DrawingOutboxDisposition = {
  clientOperationId: string;
  status: "acked" | "rejected";
  authoritativeSequence: number | null;
  resultVersions: Record<string, number | null>;
};

type DrawingAcknowledgedOutboxEntry = Omit<DrawingOutboxEntry, "status"> & {
  status: "acked";
  authoritativeSequence: number;
  resultVersions: Record<string, number | null>;
};

export type DrawingLegacyOutboxEntry = Omit<
  DrawingOutboxEntry,
  "enqueueSequence" | "ownerId"
> & {
  enqueueSequence?: undefined;
  ownerId?: undefined;
};

export type DrawingOutboxAdapter = {
  claimLegacy(revisionId: string, ownerId: string): Promise<number>;
  delete(clientOperationId: string): Promise<void>;
  enqueue(
    entry: Omit<DrawingOutboxEntry, "enqueueSequence">,
  ): Promise<DrawingOutboxEntry>;
  list(): Promise<
    Array<
      | DrawingOutboxEntry
      | DrawingLegacyOutboxEntry
      | DrawingAcknowledgedOutboxEntry
    >
  >;
  put(
    entry:
      | DrawingOutboxEntry
      | DrawingLegacyOutboxEntry
      | DrawingAcknowledgedOutboxEntry,
  ): Promise<void>;
  claimRecovery?(
    clientOperationId: string,
    claimantId: string,
  ): Promise<
    | boolean
    | {
        claimed: boolean;
        retryAfterMs?: number;
      }
  >;
  commitRecovery?(clientOperationId: string, claimantId: string): Promise<void>;
  releaseRecovery?(
    clientOperationId: string,
    claimantId: string,
  ): Promise<void>;
};

export type DrawingOutboxResponse =
  | ({
      clientOperationId: string;
      status: "acked";
    } & (
      | {
          authoritativeSequence: number;
          resultVersions: Record<string, number | null>;
        }
      | {
          authoritativeSequence?: undefined;
          resultVersions?: undefined;
        }
    ))
  | {
      clientOperationId: string;
      status: "conflicted" | "rejected";
      error?: string;
    };
type DrawingOutboxSend = (
  operation: DrawingOperationInput,
  context?: { signal: AbortSignal },
) => Promise<DrawingOutboxResponse>;

type RetryScheduler = (delayMs: number, retry: () => Promise<void>) => unknown;

type DrawingOutboxChangeChannel = {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
};

type DrawingOutboxChangeChannelFactory = (
  name: string,
) => DrawingOutboxChangeChannel | null;

export type DrawingOutboxChangeKind = "pending" | "settled";

type DrawingOutboxOptions = {
  ownerId: string;
  revisionId: string;
  schedule?: RetryScheduler;
  broadcastChannelFactory?: DrawingOutboxChangeChannelFactory;
  onAcknowledged?: (count: number) => void;
  beforeAcknowledged?: (
    response: Extract<DrawingOutboxResponse, { status: "acked" }>,
    operation: DrawingOperationInput,
  ) => void | Promise<void>;
  onChange?: () => void;
  onExternalChange?: (kind: DrawingOutboxChangeKind) => void;
};

export type DrawingOutbox = {
  recoveryScope(): DrawingRecoveryScope;
  claimLegacyEntries(): Promise<number>;
  enqueue(operation: unknown): Promise<DrawingOperationInput>;
  entries(): Promise<DrawingOutboxEntry[]>;
  acknowledgements(): Promise<DrawingOutboxAcknowledgement[]>;
  replayableOperations(): Promise<DrawingOperationInput[]>;
  settleConflictedSuffix(
    dispositions: DrawingOutboxDisposition[],
  ): Promise<number>;
  recoverOperation(
    clientOperationId: string,
    recover: () => void | Promise<void>,
  ): Promise<boolean>;
  flush(send: DrawingOutboxSend): Promise<number>;
  markAcked(
    clientOperationId: string,
    evidence?: DrawingOutboxAcknowledgement,
  ): Promise<boolean>;
  markConflicted(
    clientOperationId: string,
    status?: "conflicted" | "rejected",
    error?: string,
  ): Promise<boolean>;
  pending(revisionId?: string): Promise<DrawingOperationInput[]>;
  legacyEntries(): Promise<DrawingLegacyOutboxEntry[]>;
  retainRecoveryEvidence(
    entry: DrawingOutboxEntry,
    error: string,
  ): Promise<void>;
  dispose(): void;
};

export type DrawingRecoveryScope = {
  trustedOwnerId: string;
  revisionId: string;
};

const retryDelays = [1000, 2000, 4000, 8000, 15000] as const;
export const drawingRecoveryClaimLeaseMs = 30_000;

function sorted<Entry extends { enqueueSequence: number }>(
  entries: Entry[],
): Entry[] {
  return entries.sort(
    (left, right) => left.enqueueSequence - right.enqueueSequence,
  );
}

function defaultSchedule(delayMs: number, retry: () => Promise<void>) {
  const timeout = globalThis.setTimeout(
    () => void retry().catch(() => {}),
    delayMs,
  );
  // Recovery retries are durable state, not a reason for a closed browser or
  // a completed Node test process to stay alive. A live workspace still owns
  // and can cancel this timer through dispose().
  if (typeof timeout === "object" && "unref" in timeout)
    (
      timeout as ReturnType<typeof setTimeout> & { unref?: () => void }
    ).unref?.();
  return () => globalThis.clearTimeout(timeout);
}

type RealmCoordinator = { active: Promise<number> | null; generation: number };
const realmCoordinators = new Map<string, RealmCoordinator>();

function openNativeDrawingOutboxChangeChannel(name: string) {
  if (
    typeof window === "undefined" ||
    typeof globalThis.BroadcastChannel === "undefined"
  )
    return null;
  try {
    return new globalThis.BroadcastChannel(name);
  } catch {
    return null;
  }
}

export function createDrawingOutbox(
  adapter: DrawingOutboxAdapter = createIndexedDbDrawingOutboxAdapter(),
  options: DrawingOutboxOptions,
): DrawingOutbox {
  if (!options.ownerId || !options.revisionId)
    throw new Error("Drawing outbox owner and revision scope are required.");
  const schedule = options.schedule ?? defaultSchedule;
  const scopeKey = `${options.ownerId}:${options.revisionId}`;
  const coordinator = realmCoordinators.get(scopeKey) ?? {
    active: null,
    generation: 0,
  };
  realmCoordinators.set(scopeKey, coordinator);
  const senderId =
    globalThis.crypto?.randomUUID?.() ?? `${Date.now()}:${Math.random()}`;
  const channelName = `1hk:drawing-outbox:v1:${scopeKey}`;
  const changeChannel = (
    options.broadcastChannelFactory ?? openNativeDrawingOutboxChangeChannel
  )(channelName);
  const scheduledRevisions = new Set<string>();
  const scheduledRecoveries = new Map<string, () => void>();
  const cancelRetries = new Set<() => void>();
  const inFlight = new Set<AbortController>();
  let disposed = false;

  if (changeChannel)
    changeChannel.onmessage = ({ data }) => {
      if (!data || typeof data !== "object") return;
      const message = data as {
        type?: unknown;
        ownerId?: unknown;
        revisionId?: unknown;
        senderId?: unknown;
        kind?: unknown;
      };
      if (
        message.type !== "drawing-outbox-change" ||
        message.ownerId !== options.ownerId ||
        message.revisionId !== options.revisionId ||
        message.senderId === senderId ||
        (message.kind !== "pending" && message.kind !== "settled")
      )
        return;
      coordinator.generation += 1;
      options.onExternalChange?.(message.kind);
    };

  const notifyChange = (kind: DrawingOutboxChangeKind) => {
    options.onChange?.();
    try {
      changeChannel?.postMessage({
        type: "drawing-outbox-change",
        ownerId: options.ownerId,
        revisionId: options.revisionId,
        senderId,
        kind,
      });
    } catch {
      // Cross-tab wakeup is best-effort; IndexedDB remains authoritative.
    }
  };

  const allEntries = async () =>
    sorted(
      (await adapter.list()).filter(
        (entry): entry is DrawingOutboxEntry | DrawingAcknowledgedOutboxEntry =>
          entry.ownerId === options.ownerId &&
          typeof entry.enqueueSequence === "number" &&
          entry.operation.revisionId === options.revisionId,
      ),
    );
  const entries = async () =>
    (await allEntries()).filter(
      (entry): entry is DrawingOutboxEntry => entry.status !== "acked",
    );
  const acknowledgements = async (): Promise<DrawingOutboxAcknowledgement[]> =>
    (await allEntries())
      .filter(
        (entry): entry is DrawingAcknowledgedOutboxEntry =>
          entry.status === "acked",
      )
      .map((entry) => {
        const operation = DrawingOperationInputSchema.parse(entry.operation);
        const acknowledgement = DrawingCollaborationStatusSchema.parse({
          operationId: operation.clientOperationId,
          status: "acked",
          authoritativeSequence: entry.authoritativeSequence,
          resultVersions: entry.resultVersions,
        });
        return {
          clientOperationId: acknowledgement.operationId,
          authoritativeSequence: acknowledgement.authoritativeSequence!,
          resultVersions: acknowledgement.resultVersions,
          operation,
        };
      });
  const legacyEntries = async () =>
    (await adapter.list()).filter(
      (entry): entry is DrawingLegacyOutboxEntry =>
        !entry.ownerId && entry.operation.revisionId === options.revisionId,
    );
  const markAcked = async (
    clientOperationId: string,
    evidence?: DrawingOutboxAcknowledgement,
  ) => {
    const entry = (await allEntries()).find(
      (candidate) =>
        candidate.operation.clientOperationId === clientOperationId,
    );
    if (!entry) return false;
    if (evidence) {
      const acknowledgement = DrawingCollaborationStatusSchema.parse({
        operationId: evidence.clientOperationId,
        status: "acked",
        authoritativeSequence: evidence.authoritativeSequence,
        resultVersions: evidence.resultVersions,
      });
      if (acknowledgement.operationId !== clientOperationId)
        throw new Error(
          "Drawing acknowledgement does not match its outbox operation.",
        );
      if (!sameDrawingCanonicalValue(entry.operation, evidence.operation))
        throw new Error(
          "Drawing acknowledgement operation does not match its outbox entry.",
        );
      await adapter.put({
        ...entry,
        status: "acked",
        authoritativeSequence: acknowledgement.authoritativeSequence!,
        resultVersions: acknowledgement.resultVersions,
      });
    } else await adapter.delete(clientOperationId);
    notifyChange("settled");
    return true;
  };
  const markConflicted = async (
    clientOperationId: string,
    status: "conflicted" | "rejected" = "conflicted",
    error?: string,
  ) => {
    const entry = (await entries()).find(
      (candidate) =>
        candidate.operation.clientOperationId === clientOperationId,
    );
    if (!entry) return false;
    await adapter.put({ ...entry, status, error });
    notifyChange("settled");
    return true;
  };

  const flushOnce = async (send: DrawingOutboxSend) => {
    let acknowledged = 0;
    const rejectAfterPartialAcknowledgement = (error: unknown): never => {
      try {
        if (!disposed && acknowledged > 0)
          options.onAcknowledged?.(acknowledged);
      } finally {
        throw error;
      }
    };
    let observedGeneration = -1;
    while (!disposed) {
      const queued = await entries();
      const blocked = queued.some((entry) => entry.status !== "pending");
      const pending = blocked
        ? []
        : queued.filter((entry) => entry.status === "pending");
      if (pending.length === 0) {
        if (observedGeneration === coordinator.generation) return acknowledged;
        observedGeneration = coordinator.generation;
        await Promise.resolve();
        continue;
      }
      observedGeneration = coordinator.generation;
      for (const entry of pending) {
        if (disposed) return acknowledged;
        const { operation } = entry;
        try {
          const controller = new AbortController();
          inFlight.add(controller);
          let response: DrawingOutboxResponse;
          try {
            response = await send(operation, { signal: controller.signal });
          } finally {
            inFlight.delete(controller);
          }
          if (response.clientOperationId !== operation.clientOperationId) {
            const error = new Error(
              "Server acknowledgement did not match the queued operation.",
            );
            await markConflicted(
              operation.clientOperationId,
              "rejected",
              error.message,
            );
            throw error;
          }
          if (response.status === "acked") {
            await options.beforeAcknowledged?.(response, operation);
            const evidence =
              response.authoritativeSequence === undefined
                ? undefined
                : {
                    clientOperationId: response.clientOperationId,
                    authoritativeSequence: response.authoritativeSequence,
                    resultVersions: response.resultVersions,
                    operation,
                  };
            if (await markAcked(operation.clientOperationId, evidence))
              acknowledged += 1;
            continue;
          }
          await markConflicted(
            operation.clientOperationId,
            response.status,
            response.error,
          );
          return acknowledged;
        } catch (error) {
          const current = (await entries()).find(
            (candidate) =>
              candidate.operation.clientOperationId ===
              operation.clientOperationId,
          );
          if (!current) continue;
          if (current.status !== "pending")
            rejectAfterPartialAcknowledgement(error);
          const retryCount = current.retryCount + 1;
          await adapter.put({
            ...current,
            retryCount,
            error: error instanceof Error ? error.message : "Network error",
          });
          notifyChange("pending");
          if (!disposed && !scheduledRevisions.has(operation.revisionId)) {
            scheduledRevisions.add(operation.revisionId);
            const delay =
              retryDelays[Math.min(retryCount - 1, retryDelays.length - 1)];
            let cancel = () => {};
            const scheduled = schedule(delay, async () => {
              cancelRetries.delete(cancel);
              scheduledRevisions.delete(operation.revisionId);
              if (!disposed) await api.flush(send);
            });
            if (typeof scheduled === "function")
              cancel = scheduled as () => void;
            cancelRetries.add(cancel);
          }
          rejectAfterPartialAcknowledgement(error);
        }
      }
    }
    return acknowledged;
  };

  const api: DrawingOutbox = {
    recoveryScope() {
      return {
        trustedOwnerId: options.ownerId,
        revisionId: options.revisionId,
      };
    },
    async claimLegacyEntries() {
      const claimed = await adapter.claimLegacy(
        options.revisionId,
        options.ownerId,
      );
      coordinator.generation += claimed;
      notifyChange("pending");
      return claimed;
    },
    async enqueue(input) {
      const operation = DrawingOperationInputSchema.parse(input);
      if (operation.revisionId !== options.revisionId)
        throw new Error("Drawing operation revision is outside outbox scope.");
      await adapter.enqueue({
        ownerId: options.ownerId,
        operation,
        status: "pending",
        retryCount: 0,
      });
      coordinator.generation += 1;
      notifyChange("pending");
      return operation;
    },
    entries,
    acknowledgements,
    async replayableOperations() {
      return (await allEntries())
        .filter(
          (entry) => entry.status === "acked" || entry.status === "pending",
        )
        .map((entry) => DrawingOperationInputSchema.parse(entry.operation));
    },
    async settleConflictedSuffix(input) {
      if (disposed) return 0;
      if (coordinator.active) await coordinator.active.catch(() => undefined);
      const queued = await entries();
      const conflict = queued.find((entry) => entry.status !== "pending");
      if (!conflict) return 0;
      const suffix = queued.filter(
        (entry) => entry.enqueueSequence >= conflict.enqueueSequence,
      );
      if (
        input.length !== suffix.length ||
        input.some(
          (disposition, index) =>
            disposition.clientOperationId !==
            suffix[index].operation.clientOperationId,
        )
      )
        throw new Error(
          "Drawing conflict dispositions do not match the causal suffix.",
        );
      const dispositions = input.map((disposition) => {
        const status = DrawingCollaborationStatusSchema.parse({
          operationId: disposition.clientOperationId,
          status: disposition.status,
          authoritativeSequence: disposition.authoritativeSequence,
          resultVersions: disposition.resultVersions,
        });
        return { ...disposition, status };
      });
      // Keep the conflict sentinel until every later operation is durable so
      // a partial local failure remains visibly blocked and safely retryable.
      for (let index = suffix.length - 1; index >= 0; index -= 1) {
        const entry = suffix[index];
        const disposition = dispositions[index];
        if (disposition.status.status === "acked") {
          const response = {
            clientOperationId: disposition.clientOperationId,
            status: "acked" as const,
            authoritativeSequence: disposition.status.authoritativeSequence!,
            resultVersions: disposition.status.resultVersions,
          };
          await options.beforeAcknowledged?.(response, entry.operation);
          await markAcked(disposition.clientOperationId, {
            clientOperationId: disposition.clientOperationId,
            authoritativeSequence: response.authoritativeSequence,
            resultVersions: response.resultVersions,
            operation: entry.operation,
          });
        } else await adapter.delete(disposition.clientOperationId);
      }
      for (const cancel of cancelRetries) cancel();
      cancelRetries.clear();
      scheduledRecoveries.clear();
      scheduledRevisions.clear();
      coordinator.generation += suffix.length;
      notifyChange("settled");
      return suffix.length;
    },
    async recoverOperation(clientOperationId, recover) {
      if (disposed) return false;
      if (!adapter.claimRecovery) {
        await recover();
        return true;
      }
      const claim = await adapter.claimRecovery(clientOperationId, senderId);
      const claimed = typeof claim === "boolean" ? claim : claim.claimed;
      if (!claimed) {
        const retryAfterMs =
          typeof claim === "object" ? claim.retryAfterMs : undefined;
        if (
          retryAfterMs !== undefined &&
          retryAfterMs > 0 &&
          !scheduledRecoveries.has(clientOperationId)
        ) {
          let cancel = () => {};
          const scheduled = schedule(retryAfterMs, async () => {
            scheduledRecoveries.delete(clientOperationId);
            cancelRetries.delete(cancel);
            if (!disposed)
              await api.recoverOperation(clientOperationId, recover);
          });
          if (typeof scheduled === "function") cancel = scheduled as () => void;
          scheduledRecoveries.set(clientOperationId, cancel);
          cancelRetries.add(cancel);
        }
        return false;
      }
      const pendingRetry = scheduledRecoveries.get(clientOperationId);
      if (pendingRetry) {
        pendingRetry();
        scheduledRecoveries.delete(clientOperationId);
        cancelRetries.delete(pendingRetry);
      }
      try {
        await recover();
        await adapter.commitRecovery?.(clientOperationId, senderId);
        return true;
      } catch (error) {
        await adapter.releaseRecovery?.(clientOperationId, senderId);
        throw error;
      }
    },
    flush(send) {
      if (disposed) return Promise.resolve(0);
      if (coordinator.active)
        return coordinator.active.then(
          () => (disposed ? 0 : api.flush(send)),
          () => (disposed ? 0 : api.flush(send)),
        );
      coordinator.active = flushOnce(send)
        .then((acknowledged) => {
          if (!disposed && acknowledged > 0)
            options.onAcknowledged?.(acknowledged);
          return acknowledged;
        })
        .finally(() => {
          coordinator.active = null;
        });
      return coordinator.active;
    },
    markAcked,
    markConflicted,
    legacyEntries,
    async pending(revisionId) {
      return (await entries())
        .filter(
          (entry) =>
            revisionId === undefined ||
            entry.operation.revisionId === revisionId,
        )
        .map((entry) => entry.operation);
    },
    async retainRecoveryEvidence(entry, error) {
      if (
        entry.ownerId !== options.ownerId ||
        entry.operation.revisionId !== options.revisionId
      )
        throw new Error("Drawing recovery evidence is outside outbox scope.");
      await adapter.put({ ...entry, status: "conflicted", error });
      notifyChange("settled");
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (changeChannel) {
        changeChannel.onmessage = null;
        changeChannel.close();
      }
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
      for (const cancel of cancelRetries) cancel();
      cancelRetries.clear();
      scheduledRecoveries.clear();
      scheduledRevisions.clear();
    },
  };
  return api;
}

type StoredDrawingOutboxEntry = (
  | DrawingOutboxEntry
  | DrawingLegacyOutboxEntry
  | DrawingAcknowledgedOutboxEntry
) & {
  clientOperationId: string;
  revisionId: string;
  createdAt: string;
  recoveryClaimantId?: string;
  recoveryClaimedAt?: number;
  recoveryCommitted?: boolean;
};

function normalizeLegacyPersistedDrawingOperation(
  value: unknown,
): DrawingOperationInput {
  const candidate = structuredClone(value) as {
    type?: unknown;
    forward?: { actions?: unknown[] };
    inverse?: { actions?: unknown[] };
  };
  if (
    candidate?.type === "mutate_structure" ||
    candidate?.type === "restore_checkpoint"
  ) {
    for (const payload of [candidate.forward, candidate.inverse]) {
      if (!Array.isArray(payload?.actions)) continue;
      for (const action of payload.actions) {
        if (
          action &&
          typeof action === "object" &&
          (action as { kind?: unknown }).kind === "put_block_instance"
        ) {
          const entity = (action as { entity?: unknown }).entity;
          if (
            entity &&
            typeof entity === "object" &&
            !("lineageId" in entity) &&
            typeof (entity as { id?: unknown }).id === "string"
          )
            (entity as { lineageId: string }).lineageId = (
              entity as { id: string }
            ).id;
        }
      }
    }
  }
  return DrawingOperationInputSchema.parse(candidate);
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** Native browser persistence; opening remains lazy so SSR never touches IndexedDB. */
export function createIndexedDbDrawingOutboxAdapter(
  factory: IDBFactory | undefined = globalThis.indexedDB,
  options: {
    now?: () => number;
    recoveryLeaseMs?: number;
  } = {},
): DrawingOutboxAdapter {
  const now = options.now ?? Date.now;
  const recoveryLeaseMs =
    options.recoveryLeaseMs ?? drawingRecoveryClaimLeaseMs;
  let database: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      if (!factory) {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }
      let settled = false;
      const request = factory.open("1hk-drawing-workspace", 2);
      request.onupgradeneeded = () => {
        const store = request.result.objectStoreNames.contains("operations")
          ? request.transaction!.objectStore("operations")
          : request.result.createObjectStore("operations", {
              keyPath: "clientOperationId",
            });
        if (!store.indexNames.contains("revision_created_at"))
          store.createIndex("revision_created_at", ["revisionId", "createdAt"]);
        if (!store.indexNames.contains("status"))
          store.createIndex("status", "status");
        if (!store.indexNames.contains("enqueue_sequence"))
          store.createIndex("enqueue_sequence", "enqueueSequence");
      };
      request.onblocked = () => {
        if (settled) return;
        settled = true;
        reject(new Error("IndexedDB upgrade was blocked by another tab."));
      };
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        settled = true;
        request.result.onversionchange = () => {
          request.result.close();
          database = null;
        };
        resolve(request.result);
      };
      request.onerror = () => {
        if (settled) return;
        settled = true;
        reject(request.error);
      };
    });
    void database.catch(() => {
      database = null;
    });
    return database;
  };

  return {
    async claimLegacy(revisionId, ownerId) {
      const db = await open();
      const transaction = db.transaction("operations", "readwrite");
      const store = transaction.objectStore("operations");
      const stored = (await requestResult(store.getAll())) as Array<
        StoredDrawingOutboxEntry | DrawingLegacyOutboxEntry
      >;
      let enqueueSequence = stored.reduce(
        (highest, entry) =>
          typeof entry.enqueueSequence === "number"
            ? Math.max(highest, entry.enqueueSequence)
            : highest,
        0,
      );
      const legacy = stored
        .filter(
          (
            entry,
          ): entry is DrawingLegacyOutboxEntry &
            Pick<
              StoredDrawingOutboxEntry,
              "clientOperationId" | "revisionId" | "createdAt"
            > =>
            !entry.ownerId &&
            entry.status !== "acked" &&
            entry.operation.revisionId === revisionId,
        )
        .sort(
          (left, right) =>
            left.operation.createdAt.localeCompare(right.operation.createdAt) ||
            left.operation.clientOperationId.localeCompare(
              right.operation.clientOperationId,
            ),
        );
      for (const entry of legacy) {
        const operation = normalizeLegacyPersistedDrawingOperation(
          entry.operation,
        );
        const claimedEntry = {
          ...entry,
          operation,
          ownerId,
          enqueueSequence: ++enqueueSequence,
        } satisfies DrawingOutboxEntry;
        store.put({
          ...claimedEntry,
          clientOperationId: claimedEntry.operation.clientOperationId,
          revisionId: claimedEntry.operation.revisionId,
          createdAt: claimedEntry.operation.createdAt,
        });
      }
      await transactionDone(transaction);
      return legacy.length;
    },
    async delete(clientOperationId) {
      const db = await open();
      const transaction = db.transaction("operations", "readwrite");
      transaction.objectStore("operations").delete(clientOperationId);
      await transactionDone(transaction);
    },
    async list() {
      const db = await open();
      const transaction = db.transaction("operations", "readonly");
      const stored = await requestResult(
        transaction.objectStore("operations").getAll(),
      );
      await transactionDone(transaction);
      return (stored as StoredDrawingOutboxEntry[]).map(
        ({
          clientOperationId: _id,
          revisionId: _revision,
          createdAt: _at,
          recoveryClaimantId: _claimant,
          recoveryClaimedAt: _claimedAt,
          recoveryCommitted: _committed,
          ...entry
        }) => entry,
      );
    },
    async enqueue(entry) {
      const db = await open();
      const transaction = db.transaction("operations", "readwrite");
      const store = transaction.objectStore("operations");
      const cursor = await requestResult(
        store.index("enqueue_sequence").openCursor(null, "prev"),
      );
      const enqueueSequence =
        cursor && typeof cursor.value?.enqueueSequence === "number"
          ? cursor.value.enqueueSequence + 1
          : 1;
      const queued = { ...entry, enqueueSequence };
      store.add({
        ...queued,
        clientOperationId: queued.operation.clientOperationId,
        revisionId: queued.operation.revisionId,
        createdAt: queued.operation.createdAt,
      } satisfies StoredDrawingOutboxEntry);
      await transactionDone(transaction);
      return queued;
    },
    async put(entry) {
      const db = await open();
      const transaction = db.transaction("operations", "readwrite");
      const store = transaction.objectStore("operations");
      const existing = (await requestResult(
        store.get(entry.operation.clientOperationId),
      )) as StoredDrawingOutboxEntry | undefined;
      store.put({
        ...entry,
        clientOperationId: entry.operation.clientOperationId,
        revisionId: entry.operation.revisionId,
        createdAt: entry.operation.createdAt,
        ...(existing?.recoveryClaimantId
          ? { recoveryClaimantId: existing.recoveryClaimantId }
          : {}),
        ...(existing?.recoveryClaimedAt !== undefined
          ? { recoveryClaimedAt: existing.recoveryClaimedAt }
          : {}),
        ...(existing?.recoveryCommitted !== undefined
          ? { recoveryCommitted: existing.recoveryCommitted }
          : {}),
      } satisfies StoredDrawingOutboxEntry);
      await transactionDone(transaction);
    },
    async claimRecovery(clientOperationId, claimantId) {
      const db = await open();
      const transaction = db.transaction("operations", "readwrite");
      const store = transaction.objectStore("operations");
      const current = (await requestResult(store.get(clientOperationId))) as
        | StoredDrawingOutboxEntry
        | undefined;
      if (
        !current ||
        current.ownerId === undefined ||
        current.status !== "pending"
      ) {
        await transactionDone(transaction);
        return false;
      }
      if (current.recoveryCommitted) {
        await transactionDone(transaction);
        return false;
      }
      const claimedAt = current.recoveryClaimedAt;
      const elapsed =
        typeof claimedAt === "number" ? Math.max(0, now() - claimedAt) : null;
      if (
        current.recoveryClaimantId &&
        elapsed !== null &&
        elapsed < recoveryLeaseMs
      ) {
        await transactionDone(transaction);
        return {
          claimed: false,
          retryAfterMs: Math.max(1, recoveryLeaseMs - elapsed),
        };
      }
      store.put({
        ...current,
        recoveryClaimantId: claimantId,
        recoveryClaimedAt: now(),
        recoveryCommitted: false,
      });
      await transactionDone(transaction);
      return true;
    },
    async commitRecovery(clientOperationId, claimantId) {
      const db = await open();
      const transaction = db.transaction("operations", "readwrite");
      const store = transaction.objectStore("operations");
      const current = (await requestResult(store.get(clientOperationId))) as
        | StoredDrawingOutboxEntry
        | undefined;
      if (!current || current.recoveryClaimantId !== claimantId) {
        await transactionDone(transaction);
        throw new Error("Drawing recovery claim expired before commit.");
      }
      store.put({
        ...current,
        recoveryCommitted: true,
      });
      await transactionDone(transaction);
    },
    async releaseRecovery(clientOperationId, claimantId) {
      const db = await open();
      const transaction = db.transaction("operations", "readwrite");
      const store = transaction.objectStore("operations");
      const current = (await requestResult(store.get(clientOperationId))) as
        | StoredDrawingOutboxEntry
        | undefined;
      if (
        current?.recoveryClaimantId === claimantId &&
        !current.recoveryCommitted
      ) {
        const {
          recoveryClaimantId: _claimant,
          recoveryClaimedAt: _claimedAt,
          recoveryCommitted: _committed,
          ...released
        } = current;
        store.put(released);
      }
      await transactionDone(transaction);
    },
  };
}

function baseVersionsMatch(
  versions: Map<string, number>,
  baseVersions: Record<string, number>,
) {
  return Object.entries(baseVersions).every(
    ([id, version]) => versions.get(id) === version,
  );
}

function recoveryBaseVersionsMatch(
  state: DrawingDocumentState,
  versions: Map<string, number>,
  operation: DrawingOperationInput,
  historyEvidence: ObjectHistoryEvidence[],
  scope: DrawingRecoveryScope,
  pendingOwnerId: string | undefined,
) {
  // P2 validates every action against its captured operation-start state in
  // applyDrawingStructureActions. New entities intentionally have no version
  // in the loaded snapshot, so the flat P0/P1 map is not authoritative here.
  if (
    operation.type === "mutate_structure" ||
    operation.type === "restore_checkpoint" ||
    operation.type === "mutate_objects_with_references"
  )
    return true;
  if (operation.type !== "add_layer")
    return (
      baseVersionsMatch(versions, operation.baseVersions) ||
      exactCompactedObjectRedo(
        state,
        operation,
        historyEvidence,
        scope,
        pendingOwnerId,
      )
    );
  const layer = (
    operation.forward as { layer?: { id?: unknown; version?: unknown } }
  ).layer;
  if (typeof layer?.id !== "string" || typeof layer.version !== "number")
    return false;
  return (
    operation.baseVersions[layer.id] === layer.version &&
    Object.entries(operation.baseVersions).every(
      ([id, version]) => id === layer.id || versions.get(id) === version,
    )
  );
}

function structureCollectionForRecovery(kind: DrawingStructureAction["kind"]) {
  if (kind.includes("source")) return "sources" as const;
  if (kind.includes("object")) return "objects" as const;
  if (kind.includes("page")) return "pages" as const;
  if (kind.includes("canvas")) return "canvases" as const;
  if (kind.includes("layer")) return "layers" as const;
  if (kind.includes("style")) return "styles" as const;
  if (kind.includes("block_instance")) return "blockInstances" as const;
  if (kind.includes("block")) return "blocks" as const;
  if (kind.includes("property_schema")) return "propertySchemas" as const;
  if (kind.includes("property_value")) return "propertyValues" as const;
  return "tables" as const;
}

function pairedInverse(
  actions: DrawingStructureAction[],
  index: number,
): DrawingStructureAction {
  const inverse = actions[actions.length - index - 1];
  if (!inverse) throw new Error("Structure inverse action is missing.");
  return inverse;
}

function structureActionId(action: DrawingStructureAction) {
  return "entity" in action ? action.entity.id : action.id;
}

function requireExactStructureInverse(
  action: DrawingStructureAction,
  inverse: DrawingStructureAction,
) {
  const id = structureActionId(action);
  const inverseId = structureActionId(inverse);
  const suffix = action.kind.replace(/^(put|delete)_/, "");
  if (inverseId !== id)
    throw new Error("Structure inverse target is not exact.");
  if ("entity" in action) {
    const expectedKind =
      action.baseVersion === null ? `delete_${suffix}` : `put_${suffix}`;
    if (inverse.kind !== expectedKind || inverse.baseVersion === null)
      throw new Error("Structure put inverse is not exact.");
    return;
  }
  if (inverse.kind !== `put_${suffix}` || inverse.baseVersion !== null)
    throw new Error("Structure delete inverse is not exact.");
}

function restoreMissingStructureTombstones(
  state: NonNullable<DrawingDocumentState["structure"]>,
  actions: DrawingStructureAction[],
  inverse: DrawingStructureAction[],
) {
  for (const [index, action] of actions.entries()) {
    if (!("entity" in action) || action.baseVersion !== null) continue;
    const paired = pairedInverse(inverse, index);
    requireExactStructureInverse(action, paired);
    const id = structureActionId(action);
    if (!("id" in paired) || paired.id !== id || paired.baseVersion < 1)
      throw new Error("Structure acknowledgement inverse is not exact.");
    const collection = structureCollectionForRecovery(action.kind);
    if (state[collection]?.[id]) continue;
    // A creation acknowledgement uses version 1. A higher inverse delete base
    // proves this is a tombstone restore; recreate only that exact tombstone.
    if (paired.baseVersion === 1) continue;
    state.tombstones ??= {};
    if (state.tombstones[id]) {
      if (state.tombstones[id].version !== paired.baseVersion - 1)
        throw new Error("Structure tombstone version is not exact.");
      continue;
    }
    state.tombstones[id] = {
      collection,
      entity: structuredClone(action.entity) as never,
      version: paired.baseVersion - 1,
    };
  }
}

function valuesMatch(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

type ObjectHistoryEvidence = DrawingOperationInput &
  Partial<
    Pick<
      DrawingRecordedOperation,
      "actorId" | "resultVersions" | "realizedVersions"
    >
  >;

function exactRecordedVersions(
  evidence: ObjectHistoryEvidence,
  resultVersions: Record<string, number | null>,
  realizedVersions: Record<string, number>,
) {
  return (
    (evidence.resultVersions === undefined ||
      sameDrawingCanonicalValue(evidence.resultVersions, resultVersions)) &&
    (evidence.realizedVersions === undefined ||
      sameDrawingCanonicalValue(evidence.realizedVersions, realizedVersions))
  );
}

function hasActiveUuidOwner(state: DrawingDocumentState, id: string) {
  if (state.objects[id] || state.layers[id]) return true;
  if (!state.structure) return false;
  for (const [collection, entities] of Object.entries(state.structure)) {
    if (
      collection === "tombstones" ||
      !entities ||
      typeof entities !== "object"
    )
      continue;
    if (Object.hasOwn(entities, id)) return true;
  }
  return false;
}

function exactCompactedObjectRedo(
  state: DrawingDocumentState,
  operation: DrawingOperationInput,
  evidence: ObjectHistoryEvidence[],
  scope: DrawingRecoveryScope,
  pendingOwnerId: string | undefined,
) {
  if (
    operation.type !== "add_objects" ||
    operation.historyAction !== "redo" ||
    !operation.originalOperationId ||
    pendingOwnerId !== scope.trustedOwnerId ||
    operation.revisionId !== scope.revisionId ||
    state.revisionId !== scope.revisionId
  )
    return false;
  const byId = new Map<string, ObjectHistoryEvidence>();
  for (const candidate of evidence) {
    const previous = byId.get(candidate.clientOperationId);
    if (
      previous &&
      !sameDrawingCanonicalValue(
        DrawingOperationInputSchema.parse(previous),
        DrawingOperationInputSchema.parse(candidate),
      )
    )
      return false;
    if (!previous || candidate.resultVersions !== undefined)
      byId.set(candidate.clientOperationId, candidate);
  }
  const original = byId.get(operation.originalOperationId);
  if (
    !original ||
    original.type !== "add_objects" ||
    original.historyAction ||
    original.originalOperationId ||
    original.revisionId !== scope.revisionId ||
    original.actorId !== scope.trustedOwnerId
  )
    return false;
  const orderedEvidence = [...byId.values()];
  const lineage = orderedEvidence.filter(
    (candidate) =>
      candidate.originalOperationId === operation.originalOperationId,
  );
  const undo = lineage.at(-1);
  if (
    !undo ||
    orderedEvidence.indexOf(original) >= orderedEvidence.indexOf(undo) ||
    undo.type !== "delete_objects" ||
    undo.historyAction !== "undo" ||
    undo.revisionId !== scope.revisionId ||
    undo.actorId !== scope.trustedOwnerId
  )
    return false;
  const originalObjects = (original.forward as { objects?: unknown }).objects;
  const restoredObjects = (undo.inverse as { objects?: unknown }).objects;
  const pendingObjects = (operation.forward as { objects?: unknown }).objects;
  if (
    !Array.isArray(originalObjects) ||
    !Array.isArray(restoredObjects) ||
    !Array.isArray(pendingObjects) ||
    !sameDrawingCanonicalValue(undo.forward, original.inverse) ||
    !sameDrawingCanonicalValue(operation.inverse, undo.forward) ||
    !sameDrawingCanonicalValue(operation.forward, undo.inverse) ||
    originalObjects.length !== restoredObjects.length
  )
    return false;
  const expectedOriginalResult: Record<string, number> = {};
  const expectedUndoResult: Record<string, null> = {};
  const expectedUndoRealized: Record<string, number> = {};
  const expectedUndoBases: Record<string, number> = {};
  const expectedRedoBases: Record<string, number> = {};
  try {
    for (const [index, input] of originalObjects.entries()) {
      const initial = DrawingObjectSchema.parse(input);
      const restored = DrawingObjectSchema.parse(restoredObjects[index]);
      if (
        initial.version !== 1 ||
        restored.id !== initial.id ||
        restored.version !== 3 ||
        !sameDrawingCanonicalValue(restored, { ...initial, version: 3 }) ||
        hasActiveUuidOwner(state, initial.id)
      )
        return false;
      expectedOriginalResult[initial.id] = 1;
      expectedUndoResult[initial.id] = null;
      expectedUndoRealized[initial.id] = 2;
      expectedUndoBases[initial.id] = 1;
      expectedRedoBases[initial.id] = 2;
    }
  } catch {
    return false;
  }
  return (
    sameDrawingCanonicalValue(original.baseVersions, {}) &&
    sameDrawingCanonicalValue(undo.baseVersions, expectedUndoBases) &&
    sameDrawingCanonicalValue(operation.baseVersions, expectedRedoBases) &&
    exactRecordedVersions(
      original,
      expectedOriginalResult,
      expectedOriginalResult,
    ) &&
    exactRecordedVersions(undo, expectedUndoResult, expectedUndoRealized)
  );
}

type AcknowledgedFinalEffect = {
  target: string;
  matches(state: DrawingDocumentState): boolean;
};

class DrawingRecoveryContractError extends Error {}

function exactBaseVersions(
  operation: DrawingOperationInput,
  expected: Record<string, number>,
) {
  if (!valuesMatch(operation.baseVersions, expected))
    throw new Error("Acknowledged operation base versions are not exact.");
}

function uniqueAcknowledgedTargets(effects: AcknowledgedFinalEffect[]) {
  if (new Set(effects.map((effect) => effect.target)).size !== effects.length)
    throw new Error("Acknowledged operation has duplicate targets.");
  return effects;
}

function objectEffect(
  id: string,
  version: number,
  patch: Record<string, unknown>,
): AcknowledgedFinalEffect {
  return {
    target: `objects:${id}`,
    matches: (state) => {
      const current = state.objects[id];
      return Boolean(
        current &&
          current.version === version &&
          Object.entries(patch).every(([key, value]) =>
            valuesMatch(current[key as keyof typeof current], value),
          ),
      );
    },
  };
}

function layerEffect(
  id: string,
  version: number,
  patch: Record<string, unknown>,
): AcknowledgedFinalEffect {
  return {
    target: `layers:${id}`,
    matches: (state) => {
      const current = state.layers[id];
      return Boolean(
        current &&
          current.version === version &&
          Object.entries(patch).every(([key, value]) =>
            valuesMatch(current[key as keyof typeof current], value),
          ),
      );
    },
  };
}

/** Extracts each operation's exact final effects before reverse reconciliation. */
function acknowledgedFinalEffects(
  operation: DrawingOperationInput,
): AcknowledgedFinalEffect[] {
  if (
    operation.type === "mutate_structure" ||
    operation.type === "restore_checkpoint"
  ) {
    const forward = operation.forward as { actions: DrawingStructureAction[] };
    const inverse = operation.inverse as { actions: DrawingStructureAction[] };
    if (forward.actions.length !== inverse.actions.length)
      throw new Error("Structure inverse action count is not exact.");
    return uniqueAcknowledgedTargets(
      forward.actions.map((action, index) => {
        const paired = pairedInverse(inverse.actions, index);
        requireExactStructureInverse(action, paired);
        const collection = structureCollectionForRecovery(action.kind);
        const id = structureActionId(action);
        if ("entity" in action) {
          if (paired.baseVersion === null)
            throw new Error("Structure result version is not exact.");
          const expected = { ...action.entity, version: paired.baseVersion };
          return {
            target: `${collection}:${id}`,
            matches: (state) =>
              valuesMatch(state.structure?.[collection]?.[id], expected),
          };
        }
        return {
          target: `${collection}:${id}`,
          matches: (state) => {
            if (state.structure?.[collection]?.[id]) return false;
            const tombstone = state.structure?.tombstones?.[id];
            return !tombstone || tombstone.version === action.baseVersion + 1;
          },
        };
      }),
    );
  }
  if (operation.type === "mutate_objects_with_references") {
    const forward = operation.forward as {
      objectAction: "delete" | "restore";
      objects: Array<{ id: string; version: number }>;
      actions: DrawingStructureAction[];
    };
    const inverse = operation.inverse as typeof forward;
    if (
      inverse.objectAction === forward.objectAction ||
      inverse.objects.length !== forward.objects.length ||
      inverse.actions.length !== forward.actions.length
    )
      throw new Error("Object-reference inverse is not exact.");
    validateDrawingReferenceAwareObjectMutation(
      forward.objects.map((object) => DrawingObjectSchema.parse(object)),
      forward.actions,
    );
    const expectedBases: Record<string, number> = {};
    const effects: AcknowledgedFinalEffect[] = forward.actions.map(
      (action, index) => {
        const paired = pairedInverse(inverse.actions, index);
        requireExactStructureInverse(action, paired);
        const collection = structureCollectionForRecovery(action.kind);
        const id = structureActionId(action);
        if (action.baseVersion !== null) expectedBases[id] = action.baseVersion;
        if ("entity" in action) {
          if (paired.baseVersion === null)
            throw new Error("Structure result version is not exact.");
          const resultVersion =
            action.baseVersion === null
              ? action.entity.version + 2
              : action.baseVersion + 1;
          if (
            (action.baseVersion !== null &&
              action.entity.version !== action.baseVersion) ||
            paired.baseVersion !== resultVersion ||
            ("entity" in paired && paired.entity.version !== action.baseVersion)
          )
            throw new Error("Structure inverse result version is not exact.");
          const expected = { ...action.entity, version: paired.baseVersion };
          return {
            target: `${collection}:${id}`,
            matches: (state) =>
              valuesMatch(state.structure?.[collection]?.[id], expected),
          };
        }
        if (
          !("entity" in paired) ||
          paired.entity.version !== action.baseVersion
        )
          throw new Error("Structure deletion inverse version is not exact.");
        return {
          target: `${collection}:${id}`,
          matches: (state) => !state.structure?.[collection]?.[id],
        };
      },
    );
    for (const [index, object] of forward.objects.entries()) {
      const reverted = inverse.objects[index];
      const base = operation.baseVersions[object.id];
      if (
        !reverted ||
        reverted.id !== object.id ||
        base === undefined ||
        (forward.objectAction === "delete"
          ? object.version !== base || reverted.version !== base + 2
          : base < 2 ||
            object.version !== base + 1 ||
            !valuesMatch(reverted, object))
      )
        throw new Error("Object-reference inverse object is not exact.");
      expectedBases[object.id] = base;
      effects.push(
        forward.objectAction === "delete"
          ? {
              target: `objects:${object.id}`,
              matches: (state) => !state.objects[object.id],
            }
          : objectEffect(object.id, object.version, object),
      );
    }
    exactBaseVersions(operation, expectedBases);
    return uniqueAcknowledgedTargets(effects);
  }
  if (operation.type === "update_objects") {
    const forward = operation.forward as {
      updates: Array<{ objectId: string; patch: Record<string, unknown> }>;
    };
    const inverse = operation.inverse as typeof forward;
    if (
      inverse.updates.length !== forward.updates.length ||
      !forward.updates.every((update, index) => {
        const reverted = inverse.updates[index];
        return (
          reverted?.objectId === update.objectId &&
          valuesMatch(
            Object.keys(reverted.patch).sort(),
            Object.keys(update.patch).sort(),
          )
        );
      })
    )
      throw new Error("Object update inverse is not exact.");
    exactBaseVersions(
      operation,
      Object.fromEntries(
        forward.updates.map((update) => [
          update.objectId,
          operation.baseVersions[update.objectId],
        ]),
      ),
    );
    return uniqueAcknowledgedTargets(
      forward.updates.map((update) => {
        const base = operation.baseVersions[update.objectId];
        if (!base) throw new Error("Object update base version is missing.");
        return objectEffect(update.objectId, base + 1, update.patch);
      }),
    );
  }
  if (operation.type === "delete_objects") {
    const forward = operation.forward as { objectIds: string[] };
    const inverse = operation.inverse as {
      objects: Array<{ id: string; version: number }>;
    };
    if (
      inverse.objects.length !== forward.objectIds.length ||
      !forward.objectIds.every((id, index) => {
        const restored = inverse.objects[index];
        const expectedVersion =
          operation.historyAction === "undo"
            ? operation.baseVersions[id] + 2
            : operation.baseVersions[id];
        return restored?.id === id && restored.version === expectedVersion;
      })
    )
      throw new Error("Object delete inverse is not exact.");
    exactBaseVersions(
      operation,
      Object.fromEntries(
        forward.objectIds.map((id) => [id, operation.baseVersions[id]]),
      ),
    );
    return uniqueAcknowledgedTargets(
      forward.objectIds.map((id) => ({
        target: `objects:${id}`,
        matches: (state) => !state.objects[id],
      })),
    );
  }
  if (operation.type === "add_objects") {
    const forward = operation.forward as { objects: unknown[] };
    const inverse = operation.inverse as { objectIds: string[] };
    const objects = forward.objects.map((input) =>
      DrawingObjectSchema.parse(input),
    );
    if (
      inverse.objectIds.length !== objects.length ||
      !objects.every((object, index) => inverse.objectIds[index] === object.id)
    )
      throw new Error("Object add inverse is not exact.");
    exactBaseVersions(
      operation,
      Object.fromEntries(
        objects
          .filter((object) => object.version > 1)
          .map((object) => [object.id, object.version - 1]),
      ),
    );
    return uniqueAcknowledgedTargets(
      objects.map((object) => ({
        target: `objects:${object.id}`,
        matches: (state) => valuesMatch(state.objects[object.id], object),
      })),
    );
  }
  if (operation.type === "add_layer") {
    const layer = DrawingLayerInputSchema.parse(
      (operation.forward as { layer: unknown }).layer,
    );
    if (!valuesMatch(operation.inverse, {}))
      throw new Error("Layer add inverse is not exact.");
    exactBaseVersions(operation, { [layer.id]: layer.version });
    const expected = DrawingLayerSchema.parse({
      ...layer,
      systemKind: "custom",
    });
    return [
      {
        target: `layers:${layer.id}`,
        matches: (state) => valuesMatch(state.layers[layer.id], expected),
      },
    ];
  }
  const forward = operation.forward as {
    layerId: string;
    patch: Record<string, unknown>;
  };
  const inverse = operation.inverse as typeof forward;
  if (
    inverse.layerId !== forward.layerId ||
    !valuesMatch(
      Object.keys(inverse.patch).sort(),
      Object.keys(forward.patch).sort(),
    )
  )
    throw new Error("Layer update inverse is not exact.");
  const base = operation.baseVersions[forward.layerId];
  if (!base) throw new Error("Layer update base version is missing.");
  exactBaseVersions(operation, { [forward.layerId]: base });
  return [layerEffect(forward.layerId, base + 1, forward.patch)];
}

/**
 * The loader is authoritative only for a prefix's final effects. Traverse
 * newest-first so older writes to the same typed target are intentionally
 * shadowed, while malformed inverse payloads still reject the whole prefix.
 */
function acknowledgedPrefixIsRepresented(
  state: DrawingDocumentState,
  entries: DrawingOutboxEntry[],
) {
  const shadowed = new Set<string>();
  try {
    for (const entry of [...entries].reverse()) {
      const effects = acknowledgedFinalEffects(entry.operation);
      for (const effect of effects) {
        if (shadowed.has(effect.target)) continue;
        if (!effect.matches(state)) return false;
        shadowed.add(effect.target);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Replays durable local operations over a fresh server snapshot, failing closed. */
export function recoverPendingDrawingState(
  serverState: DrawingDocumentState,
  inputs: unknown[],
  scope: DrawingRecoveryScope,
  acknowledgedHistory: unknown[] = [],
): {
  state: DrawingDocumentState;
  conflictedOperationIds: string[];
  ambiguousOperationIds: string[];
} {
  let state = structuredClone(serverState);
  let versions = new Map<string, number>([
    ...Object.values(state.layers).map(
      (layer) => [layer.id, layer.version] as const,
    ),
    ...Object.values(state.objects).map(
      (object) => [object.id, object.version] as const,
    ),
    ...Object.entries(state.structure?.tombstones ?? {}).map(
      ([id, tombstone]) => [id, tombstone.version] as const,
    ),
  ]);
  const conflictedOperationIds: string[] = [];
  const ambiguousOperationIds: string[] = [];
  let blocked = false;
  const serverHistory = serverState.operations.map((recorded) => {
    const operation = DrawingOperationInputSchema.parse(recorded);
    return {
      ...operation,
      ...(typeof recorded.actorId === "string"
        ? { actorId: recorded.actorId }
        : {}),
      ...(recorded.resultVersions
        ? { resultVersions: recorded.resultVersions }
        : {}),
      ...(recorded.realizedVersions
        ? { realizedVersions: recorded.realizedVersions }
        : {}),
    };
  });
  const acknowledgedOutboxHistory = acknowledgedHistory.map((input) => {
    const entry = input as { operation?: unknown; ownerId?: unknown };
    const operation = DrawingOperationInputSchema.parse(entry.operation);
    return {
      ...operation,
      ...(typeof entry.ownerId === "string" ? { actorId: entry.ownerId } : {}),
    };
  });
  const historyEvidence: ObjectHistoryEvidence[] = [
    ...serverHistory,
    ...acknowledgedOutboxHistory,
  ];
  const queued = inputs.map((input, index) => {
    if (
      input &&
      typeof input === "object" &&
      "operation" in input &&
      "status" in input
    ) {
      const entry = input as {
        operation: unknown;
        ownerId?: unknown;
        status: unknown;
      };
      return {
        index,
        operation: DrawingOperationInputSchema.parse(entry.operation),
        ownerId: typeof entry.ownerId === "string" ? entry.ownerId : undefined,
        status: entry.status,
      };
    }
    return {
      index,
      operation: DrawingOperationInputSchema.parse(input),
      ownerId: undefined,
      status: "pending",
    };
  });
  if (
    !scope ||
    typeof scope.trustedOwnerId !== "string" ||
    !scope.trustedOwnerId ||
    typeof scope.revisionId !== "string" ||
    scope.revisionId !== state.revisionId
  )
    return {
      state,
      conflictedOperationIds,
      ambiguousOperationIds: queued
        .filter((entry) => entry.status === "pending")
        .map((entry) => entry.operation.clientOperationId),
    };
  const revisionBlocked = queued.some(
    (entry) =>
      entry.operation.revisionId === state.revisionId &&
      entry.status !== "pending",
  );

  for (const queuedOperation of queued
    .filter((entry) => !revisionBlocked && entry.status === "pending")
    .sort((left, right) => left.index - right.index)) {
    const { operation, ownerId } = queuedOperation;
    if (operation.type === "mutate_objects_with_references") {
      try {
        // A pending restore carries the only offline proof of its object and
        // structure result versions, so malformed inverses are conflicts.
        acknowledgedFinalEffects(operation);
      } catch {
        conflictedOperationIds.push(operation.clientOperationId);
        blocked = true;
        continue;
      }
    }
    if (
      blocked ||
      operation.revisionId !== scope.revisionId ||
      (ownerId !== undefined && ownerId !== scope.trustedOwnerId) ||
      !recoveryBaseVersionsMatch(
        state,
        versions,
        operation,
        historyEvidence,
        scope,
        ownerId,
      )
    ) {
      ambiguousOperationIds.push(operation.clientOperationId);
      blocked = true;
      continue;
    }
    const candidate = structuredClone(state);
    const candidateVersions = new Map(versions);
    try {
      if (operation.type === "add_objects") {
        const forward = operation.forward as {
          objects: unknown[];
          type: "add_objects";
        };
        for (const input of forward.objects) {
          const object = DrawingObjectSchema.parse(input);
          if (candidate.objects[object.id]) throw new Error("Object exists.");
          const base = operation.baseVersions[object.id];
          if (
            (base === undefined && candidateVersions.has(object.id)) ||
            object.version !== (base === undefined ? 1 : base + 1)
          )
            throw new Error("Object add version is stale.");
          const tombstone = candidate.structure?.tombstones?.[object.id];
          if (base !== undefined && tombstone) {
            const expectedTombstone = {
              collection: "objects",
              entity: { ...structuredClone(object), version: base - 1 },
              version: base,
            };
            if (!sameDrawingCanonicalValue(tombstone, expectedTombstone))
              throw new Error("Object add tombstone is stale.");
          }
          delete candidate.structure?.tombstones?.[object.id];
          candidate.objects[object.id] = object;
          if (candidate.structure)
            candidate.structure.objects[object.id] = object;
          candidateVersions.set(object.id, object.version);
        }
      } else if (operation.type === "update_objects") {
        const forward = operation.forward as {
          updates: Array<{ objectId: string; patch: object }>;
        };
        for (const update of forward.updates) {
          const current = candidate.objects[update.objectId];
          const base = operation.baseVersions[update.objectId];
          if (!current || base === undefined || current.version !== base)
            throw new Error("Object update version is stale.");
          const updated = DrawingObjectSchema.parse({
            ...current,
            ...update.patch,
            version: base + 1,
          });
          candidate.objects[update.objectId] = updated;
          candidateVersions.set(update.objectId, updated.version);
        }
      } else if (operation.type === "delete_objects") {
        const forward = operation.forward as { objectIds: string[] };
        for (const objectId of forward.objectIds) {
          const current = candidate.objects[objectId];
          const base = operation.baseVersions[objectId];
          if (!current || base === undefined || current.version !== base)
            throw new Error("Object delete version is stale.");
          delete candidate.objects[objectId];
          if (candidate.structure) {
            delete candidate.structure.objects[objectId];
            candidate.structure.tombstones ??= {};
            candidate.structure.tombstones[objectId] = {
              collection: "objects",
              entity: structuredClone(current),
              version: base + 1,
            };
          }
          candidateVersions.set(objectId, base + 1);
        }
      } else if (operation.type === "add_layer") {
        const forward = operation.forward as { layer: unknown };
        const input = DrawingLayerInputSchema.parse(forward.layer);
        if (candidate.layers[input.id]) throw new Error("Layer exists.");
        const layer = DrawingLayerSchema.parse({
          ...input,
          systemKind: "custom",
        });
        candidate.layers[layer.id] = layer;
        candidateVersions.set(layer.id, layer.version);
      } else if (
        operation.type === "mutate_structure" ||
        operation.type === "restore_checkpoint"
      ) {
        if (!candidate.structure)
          throw new Error("P2 structure state is missing.");
        const forward = operation.forward as {
          actions: DrawingStructureAction[];
        };
        const inverse = operation.inverse as {
          actions: DrawingStructureAction[];
        };
        if (forward.actions.length !== inverse.actions.length)
          throw new Error("Structure inverse action count is not exact.");
        restoreMissingStructureTombstones(
          candidate.structure,
          forward.actions,
          inverse.actions,
        );
        const applied = applyDrawingStructureActions(
          { revisionId: candidate.revisionId, ...candidate.structure },
          forward.actions,
          operation.type === "restore_checkpoint"
            ? { allowCheckpointRestore: true }
            : undefined,
        );
        for (const [index, action] of forward.actions.entries()) {
          const expected = pairedInverse(inverse.actions, index);
          requireExactStructureInverse(action, expected);
          const id = structureActionId(action);
          if ("entity" in action) {
            const current =
              applied.state[structureCollectionForRecovery(action.kind)]?.[id];
            if (!current || current.version !== expected.baseVersion)
              throw new Error("Structure result version is not exact.");
          } else if (expected.baseVersion !== null) {
            throw new Error("Structure deletion inverse is not exact.");
          }
        }
        const { revisionId: _revisionId, ...structure } = applied.state;
        candidate.objects = applied.state.objects;
        candidate.layers = applied.state.layers;
        candidate.structure = structure;
        for (const layer of Object.values(candidate.layers))
          candidateVersions.set(layer.id, layer.version);
        for (const object of Object.values(candidate.objects))
          candidateVersions.set(object.id, object.version);
      } else if (operation.type === "mutate_objects_with_references") {
        if (!candidate.structure)
          throw new Error("P2 structure state is missing.");
        const forward = operation.forward as {
          objectAction: "delete" | "restore";
          objects: unknown[];
          actions: DrawingStructureAction[];
        };
        const inputObjects = forward.objects.map((input) =>
          DrawingObjectSchema.parse(input),
        );
        if (
          new Set(inputObjects.map((object) => object.id)).size !==
          inputObjects.length
        )
          throw new Error("Object mutation targets are duplicated.");
        const hasReferenceAwareUpdates =
          validateDrawingReferenceAwareObjectMutation(
            inputObjects,
            forward.actions,
          );
        const structureState = {
          revisionId: candidate.revisionId,
          ...structuredClone(candidate.structure),
        };
        const inverse = operation.inverse as {
          objectAction: "delete" | "restore";
          objects: unknown[];
          actions: DrawingStructureAction[];
        };
        if (forward.objectAction === "restore")
          restoreMissingStructureTombstones(
            structureState,
            forward.actions,
            inverse.actions,
          );
        for (const object of inputObjects) {
          const base = operation.baseVersions[object.id];
          const current = candidate.objects[object.id];
          if (forward.objectAction === "delete") {
            if (
              !current ||
              base !== current.version ||
              !valuesMatch(current, object)
            )
              throw new Error("Object deletion snapshot is stale.");
          } else {
            if (
              current ||
              base === undefined ||
              (candidateVersions.has(object.id) &&
                candidateVersions.get(object.id) !== base) ||
              object.version !== base + 1
            )
              throw new Error("Object restoration snapshot is stale.");
            const tombstone = {
              collection: "objects" as const,
              entity: { ...structuredClone(object), version: base - 1 },
              version: base,
            };
            const currentTombstone = structureState.tombstones?.[object.id];
            if (currentTombstone && !valuesMatch(currentTombstone, tombstone))
              throw new Error("Object restoration tombstone is stale.");
            structureState.tombstones ??= {};
            structureState.tombstones[object.id] = tombstone;
          }
        }
        if (forward.objectAction === "restore") {
          validateDrawingStructureState(structureState);
          for (const object of inputObjects) {
            delete structureState.tombstones?.[object.id];
            structureState.objects[object.id] = object;
          }
        }
        const applied = forward.actions.length
          ? applyDrawingStructureActions(structureState, forward.actions, {
              allowReferenceAwareObjectMutation: hasReferenceAwareUpdates,
              deferSemanticReferenceValidation: hasReferenceAwareUpdates,
            })
          : {
              state: structureState,
              inverse: [],
              baseVersions: {},
              resultVersions: {},
              realizedVersions: {},
            };
        if (!valuesMatch(applied.inverse, inverse.actions))
          throw new DrawingRecoveryContractError(
            "Object mutation inverse actions are not exact.",
          );
        const expectedBases = { ...applied.baseVersions };
        for (const object of inputObjects) {
          const base = operation.baseVersions[object.id];
          if (base === undefined)
            throw new Error("Object mutation base version is missing.");
          expectedBases[object.id] = base;
          if (forward.objectAction === "delete") {
            delete applied.state.objects[object.id];
            applied.state.tombstones ??= {};
            applied.state.tombstones[object.id] = {
              collection: "objects",
              entity: structuredClone(object),
              version: base + 1,
            };
            candidateVersions.set(object.id, base + 1);
          } else {
            candidateVersions.set(object.id, object.version);
          }
        }
        if (!valuesMatch(operation.baseVersions, expectedBases))
          throw new Error("Object mutation base versions are not exact.");
        validateDrawingStructureState(applied.state);
        for (const action of forward.actions) {
          if (action.kind !== "put_object") continue;
          const updated = applied.state.objects[action.entity.id];
          if (!updated)
            throw new Error("Object mutation update result is missing.");
          candidateVersions.set(updated.id, updated.version);
        }
        const { revisionId: _revisionId, ...structure } = applied.state;
        candidate.objects = applied.state.objects;
        candidate.layers = applied.state.layers;
        candidate.structure = structure;
      } else {
        const forward = operation.forward as {
          layerId: string;
          patch: object;
        };
        const current = candidate.layers[forward.layerId];
        const base = operation.baseVersions[forward.layerId];
        if (!current || base === undefined || current.version !== base)
          throw new Error("Layer update version is stale.");
        const layer = DrawingLayerSchema.parse({
          ...current,
          ...forward.patch,
          version: base + 1,
        });
        candidate.layers[layer.id] = layer;
        candidateVersions.set(layer.id, layer.version);
      }
      if (candidate.structure)
        validateDrawingStructureState({
          revisionId: candidate.revisionId,
          ...candidate.structure,
        });
      state = candidate;
      versions = candidateVersions;
    } catch (error) {
      (error instanceof DrawingRecoveryContractError
        ? conflictedOperationIds
        : ambiguousOperationIds
      ).push(operation.clientOperationId);
      blocked = true;
    }
  }
  return { state, conflictedOperationIds, ambiguousOperationIds };
}

/** Resends uncertain operations when online before classifying local recovery. */
export async function restoreDrawingWorkspaceState({
  online,
  outbox,
  send,
  serverState,
}: {
  online: boolean;
  outbox: DrawingOutbox;
  send: DrawingOutboxSend;
  serverState: DrawingDocumentState;
}) {
  const recoveryScope = outbox.recoveryScope();
  const before = await outbox.entries();
  if (online) {
    try {
      await outbox.flush(send);
    } catch {
      // The durable pending entry remains eligible for exact-base recovery.
    }
  }
  const remaining = await outbox.entries();
  const remainingIds = new Set(
    remaining.map((entry) => entry.operation.clientOperationId),
  );
  const acknowledged = before.filter(
    (entry) =>
      entry.status === "pending" &&
      !remainingIds.has(entry.operation.clientOperationId),
  );
  let withAcknowledged = structuredClone(serverState);
  const conflictedOperationIds: string[] = [];
  const retainAcknowledgedEvidence = async (evidence: DrawingOutboxEntry[]) => {
    for (const ambiguous of evidence)
      await outbox.retainRecoveryEvidence(
        ambiguous,
        "Acknowledged operation could not be reconciled with the loaded snapshot.",
      );
    conflictedOperationIds.push(
      ...evidence.map((item) => item.operation.clientOperationId),
    );
  };
  if (
    acknowledged.length > 0 &&
    !acknowledgedPrefixIsRepresented(withAcknowledged, acknowledged)
  )
    await retainAcknowledgedEvidence(acknowledged);
  const entriesForRecovery = await outbox.entries();
  const recovered = recoverPendingDrawingState(
    withAcknowledged,
    // A conflicting acknowledged prefix is causally before every remaining
    // pending entry. Keep that work durable, but never project it locally.
    conflictedOperationIds.length > 0 ? [] : entriesForRecovery,
    recoveryScope,
    acknowledged,
  );
  const malformedPendingIds = new Set(recovered.conflictedOperationIds);
  for (const entry of entriesForRecovery) {
    if (
      entry.status === "pending" &&
      malformedPendingIds.has(entry.operation.clientOperationId)
    )
      await outbox.retainRecoveryEvidence(
        entry,
        "Pending operation has a noncanonical recovery contract.",
      );
  }
  return {
    ...recovered,
    conflictedOperationIds: [
      ...conflictedOperationIds,
      ...recovered.conflictedOperationIds,
    ],
    ambiguousOperationIds: [
      ...conflictedOperationIds,
      ...(conflictedOperationIds.length > 0
        ? entriesForRecovery
            .filter((entry) => entry.status === "pending")
            .map((entry) => entry.operation.clientOperationId)
        : []),
      ...recovered.ambiguousOperationIds,
    ],
  };
}

export async function claimLegacyDrawingOperations({
  capability,
  confirmed,
  outbox,
  revisionStatus = "draft",
}: {
  capability: string;
  confirmed: boolean;
  outbox: Pick<DrawingOutbox, "claimLegacyEntries">;
  revisionStatus?: string;
}) {
  if (!canPersistDrawingMutation(capability, undefined, revisionStatus))
    throw new Error(
      "Drawing editor capability is required to claim legacy work.",
    );
  return confirmed ? outbox.claimLegacyEntries() : 0;
}

export type DrawingPersistenceSnapshot = {
  failed: boolean;
  volatileCount: number;
};

export function createDrawingPersistenceQueue({
  flush,
  onChange,
  outbox,
}: {
  flush: () => Promise<void>;
  onChange?: (snapshot: DrawingPersistenceSnapshot) => void;
  outbox: Pick<DrawingOutbox, "enqueue">;
}) {
  const volatile: DrawingOperationInput[] = [];
  let active: Promise<boolean> | null = null;
  let failed = false;
  let disposed = false;
  const snapshot = (): DrawingPersistenceSnapshot => ({
    failed,
    volatileCount: volatile.length,
  });
  const changed = () => onChange?.(snapshot());
  const drain = () => {
    if (disposed) return Promise.resolve(false);
    if (active) return active;
    active = (async () => {
      while (!disposed) {
        while (volatile.length > 0) {
          try {
            await outbox.enqueue(volatile[0]);
          } catch {
            failed = true;
            changed();
            return false;
          }
          volatile.shift();
          changed();
        }
        failed = false;
        changed();
        await flush();
        if (volatile.length === 0) return true;
      }
      return false;
    })().finally(() => {
      active = null;
    });
    return active;
  };
  return {
    capture(input: unknown) {
      volatile.push(DrawingOperationInputSchema.parse(input));
      changed();
      return drain();
    },
    dispose() {
      disposed = true;
    },
    retry: drain,
    snapshot,
  };
}

export async function prepareDrawingReview({
  freeze,
  persistence,
  flush,
  outbox,
}: {
  freeze: () => void;
  persistence: Pick<
    ReturnType<typeof createDrawingPersistenceQueue>,
    "retry" | "snapshot"
  >;
  flush: () => Promise<void>;
  outbox: Pick<DrawingOutbox, "entries" | "legacyEntries">;
}) {
  freeze();
  const persisted = await persistence.retry();
  const snapshot = persistence.snapshot();
  if (!persisted || snapshot.failed || snapshot.volatileCount > 0)
    throw new Error("검토 요청 전에 로컬 작업을 모두 저장해야 합니다.");

  await flush();
  const [entries, legacy] = await Promise.all([
    outbox.entries(),
    outbox.legacyEntries(),
  ]);
  if (legacy.length > 0)
    throw new Error("검토 요청 전에 격리된 이전 작업을 복구해야 합니다.");
  if (entries.length > 0)
    throw new Error("검토 요청 전에 대기 또는 충돌 작업을 해결해야 합니다.");
  return true;
}

export function canPersistDrawingMutation(
  capability: string,
  persistence?: Pick<DrawingPersistenceSnapshot, "failed">,
  revisionStatus = "draft",
) {
  return (
    revisionStatus === "draft" &&
    !persistence?.failed &&
    (capability === "admin" || capability === "editor")
  );
}

export function drawingSaveStatus({
  pending,
  conflicted = false,
  flushing = false,
  online = true,
  storageError = false,
  volatileCount = 0,
  localMutationCount = 0,
}: {
  pending: number;
  conflicted?: boolean;
  flushing?: boolean;
  online?: boolean;
  storageError?: boolean;
  volatileCount?: number;
  localMutationCount?: number;
}): "저장됨" | "저장 중" | "오프라인 저장" | "충돌 검토 필요" {
  if (volatileCount > 0 || localMutationCount > 0) return "저장 중";
  if (conflicted) return "충돌 검토 필요";
  if (storageError) return "저장 중";
  if (!online) return "오프라인 저장";
  if (flushing) return "저장 중";
  return pending === 0 ? "저장됨" : "오프라인 저장";
}

type DrawingFetchResponse = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
};

function exactObject(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

/** Settles one exact causal conflict suffix through the authoritative action. */
export async function sendDrawingConflictDiscard(
  inputs: unknown[],
  revisionId: string,
  url: string,
  fetcher: (
    input: string,
    init: {
      method: "POST";
      body: FormData;
      headers: { Accept: string };
    },
  ) => Promise<DrawingFetchResponse> = fetch,
): Promise<DrawingOutboxDisposition[]> {
  if (
    inputs.length < 1 ||
    inputs.length > DRAWING_COLLABORATION_LIMITS.maxOperations
  )
    throw new Error("Drawing conflict suffix is outside the supported range.");
  const operations = inputs.map((input) =>
    DrawingOperationInputSchema.parse(input),
  );
  if (operations.some((operation) => operation.revisionId !== revisionId))
    throw new Error("Drawing conflict suffix is outside the active revision.");
  const dispositions: DrawingOutboxDisposition[] = [];
  for (
    let offset = 0;
    offset < operations.length;
    offset += DRAWING_COLLABORATION_LIMITS.maxActionItems
  ) {
    const batch = operations.slice(
      offset,
      offset + DRAWING_COLLABORATION_LIMITS.maxActionItems,
    );
    const form = new FormData();
    form.set("intent", "discard_conflicted_operations");
    form.set("revision_id", revisionId);
    form.set("operations_json", JSON.stringify(batch));
    const response = await fetcher(url, {
      method: "POST",
      body: form,
      headers: { Accept: "application/json" },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error =
        body && typeof body === "object" && "error" in body
          ? (body as { error?: unknown }).error
          : null;
      throw new Error(
        typeof error === "string"
          ? error
          : "Drawing conflict suffix could not be settled.",
      );
    }
    if (
      !exactObject(body, ["ok", "kind", "error", "result"]) ||
      body.ok !== true ||
      body.kind !== "success" ||
      body.error !== null ||
      !exactObject(body.result, ["dispositions"]) ||
      !Array.isArray(body.result.dispositions) ||
      body.result.dispositions.length !== batch.length
    )
      throw new Error("Server conflict disposition response is invalid.");
    dispositions.push(
      ...body.result.dispositions.map((value, index) => {
        if (
          !exactObject(value, [
            "clientOperationId",
            "status",
            "authoritativeSequence",
            "resultVersions",
          ]) ||
          (value.status !== "acked" && value.status !== "rejected")
        )
          throw new Error("Server conflict disposition response is invalid.");
        const parsed = DrawingCollaborationStatusSchema.safeParse({
          operationId: value.clientOperationId,
          status: value.status,
          authoritativeSequence: value.authoritativeSequence,
          resultVersions: value.resultVersions,
        });
        if (
          !parsed.success ||
          (parsed.data.status === "rejected" &&
            Object.keys(parsed.data.resultVersions).length > 0)
        )
          throw new Error("Server conflict disposition response is invalid.");
        if (parsed.data.operationId !== batch[index].clientOperationId)
          throw new Error(
            "Server conflict dispositions do not match the requested operations.",
          );
        return {
          clientOperationId: parsed.data.operationId,
          status: parsed.data.status,
          authoritativeSequence: parsed.data.authoritativeSequence,
          resultVersions: parsed.data.resultVersions,
        } as DrawingOutboxDisposition;
      }),
    );
  }
  return dispositions;
}

/** Posts one canonical operation to the existing React Router action. */
export async function sendDrawingOperation(
  input: unknown,
  url: string,
  fetcher: (
    input: string,
    init: {
      method: "POST";
      body: FormData;
      headers: { Accept: string };
      signal?: AbortSignal;
    },
  ) => Promise<DrawingFetchResponse> = fetch,
  signal?: AbortSignal,
): Promise<DrawingOutboxResponse> {
  const operation = DrawingOperationInputSchema.parse(input);
  const form = new FormData();
  form.set("intent", "apply_operation");
  form.set("operation_json", JSON.stringify(operation));
  const response = await fetcher(url, {
    method: "POST",
    body: form,
    headers: { Accept: "application/json" },
    signal,
  });
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    kind?: string;
    error?: string;
    clientOperationId?: string;
    result?: {
      operationId?: unknown;
      sequence?: unknown;
      resultVersions?: unknown;
    };
  } | null;
  if (response.ok && body?.ok) {
    if (body.clientOperationId !== operation.clientOperationId)
      throw new Error(
        "Server acknowledgement did not match the queued operation.",
      );
    const acknowledgement = DrawingCollaborationStatusSchema.safeParse({
      operationId: body.clientOperationId,
      status: "acked",
      authoritativeSequence: body.result?.sequence,
      resultVersions: body.result?.resultVersions,
    });
    if (!acknowledgement.success)
      throw new Error(
        "Server acknowledgement sequence or result versions are invalid.",
      );
    return {
      clientOperationId: body.clientOperationId,
      status: "acked",
      authoritativeSequence: acknowledgement.data.authoritativeSequence!,
      resultVersions: acknowledgement.data.resultVersions,
    };
  }
  if (body?.kind === "rpc")
    throw new Error(body.error ?? "Drawing operation could not be saved.");
  if (body?.kind === "conflict") {
    return {
      clientOperationId: operation.clientOperationId,
      status: "conflicted",
      error: body?.error,
    };
  }
  if (body?.kind === "rejected") {
    return {
      clientOperationId: operation.clientOperationId,
      status: "rejected",
      error: body.error,
    };
  }
  if (response.status === 409) {
    return {
      clientOperationId: operation.clientOperationId,
      status: "conflicted",
      error: body?.error,
    };
  }
  if (response.status >= 400 && response.status < 500) {
    return {
      clientOperationId: operation.clientOperationId,
      status: "rejected",
      error: body?.error,
    };
  }
  throw new Error(body?.error ?? "Drawing operation could not be saved.");
}
