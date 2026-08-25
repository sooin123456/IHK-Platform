import type { DrawingDocumentState } from "./drawing-commands.ts";
import {
  applyDrawingStructureActions,
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

export type DrawingOutboxStatus = "pending" | "conflicted" | "rejected";

export type DrawingOutboxEntry = {
  ownerId: string;
  operation: DrawingOperationInput;
  status: DrawingOutboxStatus;
  retryCount: number;
  enqueueSequence: number;
  error?: string;
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
  list(): Promise<Array<DrawingOutboxEntry | DrawingLegacyOutboxEntry>>;
  put(entry: DrawingOutboxEntry | DrawingLegacyOutboxEntry): Promise<void>;
};

export type DrawingOutboxResponse = {
  clientOperationId: string;
  status: "acked" | "conflicted" | "rejected";
  error?: string;
};
type DrawingOutboxSend = (
  operation: DrawingOperationInput,
  context?: { signal: AbortSignal },
) => Promise<DrawingOutboxResponse>;

type RetryScheduler = (delayMs: number, retry: () => Promise<void>) => unknown;

type DrawingOutboxOptions = {
  ownerId: string;
  revisionId: string;
  schedule?: RetryScheduler;
  onChange?: () => void;
};

export type DrawingOutbox = {
  claimLegacyEntries(): Promise<number>;
  enqueue(operation: unknown): Promise<DrawingOperationInput>;
  entries(): Promise<DrawingOutboxEntry[]>;
  flush(send: DrawingOutboxSend): Promise<void>;
  markAcked(clientOperationId: string): Promise<boolean>;
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

const retryDelays = [1000, 2000, 4000, 8000, 15000] as const;

function sorted(entries: DrawingOutboxEntry[]) {
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
    (timeout as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
  return () => globalThis.clearTimeout(timeout);
}

type RealmCoordinator = { active: Promise<void> | null; generation: number };
const realmCoordinators = new Map<string, RealmCoordinator>();

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
  const scheduledRevisions = new Set<string>();
  const cancelRetries = new Set<() => void>();
  const inFlight = new Set<AbortController>();
  let disposed = false;

  const entries = async () =>
    sorted(
      (await adapter.list()).filter(
        (entry): entry is DrawingOutboxEntry =>
          entry.ownerId === options.ownerId &&
          typeof entry.enqueueSequence === "number" &&
          entry.operation.revisionId === options.revisionId,
      ),
    );
  const legacyEntries = async () =>
    (await adapter.list()).filter(
      (entry): entry is DrawingLegacyOutboxEntry =>
        !entry.ownerId && entry.operation.revisionId === options.revisionId,
    );
  const markAcked = async (clientOperationId: string) => {
    const exists = (await entries()).some(
      (entry) => entry.operation.clientOperationId === clientOperationId,
    );
    if (!exists) return false;
    await adapter.delete(clientOperationId);
    options.onChange?.();
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
    options.onChange?.();
    return true;
  };

  const flushOnce = async (send: DrawingOutboxSend) => {
    let observedGeneration = -1;
    while (!disposed) {
      const queued = await entries();
      const blocked = queued.some((entry) => entry.status !== "pending");
      const pending = blocked
        ? []
        : queued.filter((entry) => entry.status === "pending");
      if (pending.length === 0) {
        if (observedGeneration === coordinator.generation) return;
        observedGeneration = coordinator.generation;
        await Promise.resolve();
        continue;
      }
      observedGeneration = coordinator.generation;
      for (const entry of pending) {
        if (disposed) return;
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
            await markAcked(operation.clientOperationId);
            continue;
          }
          await markConflicted(
            operation.clientOperationId,
            response.status,
            response.error,
          );
          return;
        } catch (error) {
          const current = (await entries()).find(
            (candidate) =>
              candidate.operation.clientOperationId ===
              operation.clientOperationId,
          );
          if (!current) continue;
          if (current.status !== "pending") throw error;
          const retryCount = current.retryCount + 1;
          await adapter.put({
            ...current,
            retryCount,
            error: error instanceof Error ? error.message : "Network error",
          });
          options.onChange?.();
          if (!disposed && !scheduledRevisions.has(operation.revisionId)) {
            scheduledRevisions.add(operation.revisionId);
            const delay =
              retryDelays[Math.min(retryCount - 1, retryDelays.length - 1)];
            let cancel = () => {};
            const scheduled = schedule(delay, async () => {
              cancelRetries.delete(cancel);
              scheduledRevisions.delete(operation.revisionId);
              if (!disposed) return api.flush(send);
            });
            if (typeof scheduled === "function")
              cancel = scheduled as () => void;
            cancelRetries.add(cancel);
          }
          throw error;
        }
      }
    }
  };

  const api: DrawingOutbox = {
    async claimLegacyEntries() {
      const claimed = await adapter.claimLegacy(
        options.revisionId,
        options.ownerId,
      );
      coordinator.generation += claimed;
      options.onChange?.();
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
      options.onChange?.();
      return operation;
    },
    entries,
    flush(send) {
      if (disposed) return Promise.resolve();
      if (coordinator.active)
        return coordinator.active.then(
          () => (disposed ? undefined : api.flush(send)),
          () => (disposed ? undefined : api.flush(send)),
        );
      coordinator.active = flushOnce(send).finally(() => {
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
      options.onChange?.();
    },
    dispose() {
      disposed = true;
      for (const controller of inFlight) controller.abort();
      inFlight.clear();
      for (const cancel of cancelRetries) cancel();
      cancelRetries.clear();
      scheduledRevisions.clear();
    },
  };
  return api;
}

type StoredDrawingOutboxEntry = (
  | DrawingOutboxEntry
  | DrawingLegacyOutboxEntry
) & {
  clientOperationId: string;
  revisionId: string;
  createdAt: string;
};

function normalizeLegacyPersistedDrawingOperation(
  value: unknown,
): DrawingOperationInput {
  const candidate = structuredClone(value) as {
    type?: unknown;
    forward?: { actions?: unknown[] };
    inverse?: { actions?: unknown[] };
  };
  if (candidate?.type === "mutate_structure") {
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
): DrawingOutboxAdapter {
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
          (entry) =>
            !entry.ownerId && entry.operation.revisionId === revisionId,
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
      transaction.objectStore("operations").put({
        ...entry,
        clientOperationId: entry.operation.clientOperationId,
        revisionId: entry.operation.revisionId,
        createdAt: entry.operation.createdAt,
      } satisfies StoredDrawingOutboxEntry);
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
  versions: Map<string, number>,
  operation: DrawingOperationInput,
) {
  // P2 validates every action against its captured operation-start state in
  // applyDrawingStructureActions. New entities intentionally have no version
  // in the loaded snapshot, so the flat P0/P1 map is not authoritative here.
  if (
    operation.type === "mutate_structure" ||
    operation.type === "mutate_objects_with_references"
  )
    return true;
  if (operation.type !== "add_layer")
    return baseVersionsMatch(versions, operation.baseVersions);
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

function structureCollectionForRecovery(
  kind: DrawingStructureAction["kind"],
) {
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
  if (inverseId !== id) throw new Error("Structure inverse target is not exact.");
  if ("entity" in action) {
    const expectedKind = action.baseVersion === null
      ? `delete_${suffix}`
      : `put_${suffix}`;
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
    if (state[collection][id]) continue;
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

type AcknowledgedFinalEffect = {
  target: string;
  matches(state: DrawingDocumentState): boolean;
};

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
  if (operation.type === "mutate_structure") {
    const forward = operation.forward as { actions: DrawingStructureAction[] };
    const inverse = operation.inverse as { actions: DrawingStructureAction[] };
    if (forward.actions.length !== inverse.actions.length)
      throw new Error("Structure inverse action count is not exact.");
    return uniqueAcknowledgedTargets(forward.actions.map((action, index) => {
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
          matches: (state) => valuesMatch(
            state.structure?.[collection][id],
            expected,
          ),
        };
      }
      return {
        target: `${collection}:${id}`,
        matches: (state) => {
          if (state.structure?.[collection][id]) return false;
          const tombstone = state.structure?.tombstones?.[id];
          return !tombstone || tombstone.version === action.baseVersion + 1;
        },
      };
    }));
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
    const expectedBases: Record<string, number> = {};
    const effects: AcknowledgedFinalEffect[] = forward.actions.map(
      (action, index) => {
        const paired = pairedInverse(inverse.actions, index);
        requireExactStructureInverse(action, paired);
        const collection = structureCollectionForRecovery(action.kind);
        const id = structureActionId(action);
        if (action.baseVersion !== null)
          expectedBases[id] = action.baseVersion;
        if ("entity" in action) {
          if (paired.baseVersion === null)
            throw new Error("Structure result version is not exact.");
          const expected = { ...action.entity, version: paired.baseVersion };
          return {
            target: `${collection}:${id}`,
            matches: (state) =>
              valuesMatch(state.structure?.[collection][id], expected),
          };
        }
        return {
          target: `${collection}:${id}`,
          matches: (state) => !state.structure?.[collection][id],
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
          : object.version !== base + 1 || !valuesMatch(reverted, object))
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
        return reverted?.objectId === update.objectId &&
          valuesMatch(Object.keys(reverted.patch).sort(), Object.keys(update.patch).sort());
      })
    )
      throw new Error("Object update inverse is not exact.");
    exactBaseVersions(
      operation,
      Object.fromEntries(forward.updates.map((update) => [
        update.objectId,
        operation.baseVersions[update.objectId],
      ])),
    );
    return uniqueAcknowledgedTargets(forward.updates.map((update) => {
      const base = operation.baseVersions[update.objectId];
      if (!base) throw new Error("Object update base version is missing.");
      return objectEffect(update.objectId, base + 1, update.patch);
    }));
  }
  if (operation.type === "delete_objects") {
    const forward = operation.forward as { objectIds: string[] };
    const inverse = operation.inverse as { objects: Array<{ id: string; version: number }> };
    if (
      inverse.objects.length !== forward.objectIds.length ||
      !forward.objectIds.every((id, index) => {
        const restored = inverse.objects[index];
        return restored?.id === id && restored.version === operation.baseVersions[id];
      })
    )
      throw new Error("Object delete inverse is not exact.");
    exactBaseVersions(
      operation,
      Object.fromEntries(forward.objectIds.map((id) => [id, operation.baseVersions[id]])),
    );
    return uniqueAcknowledgedTargets(forward.objectIds.map((id) => ({
      target: `objects:${id}`,
      matches: (state) => !state.objects[id],
    })));
  }
  if (operation.type === "add_objects") {
    const forward = operation.forward as { objects: unknown[] };
    const inverse = operation.inverse as { objectIds: string[] };
    const objects = forward.objects.map((input) => DrawingObjectSchema.parse(input));
    if (
      inverse.objectIds.length !== objects.length ||
      !objects.every((object, index) => inverse.objectIds[index] === object.id)
    )
      throw new Error("Object add inverse is not exact.");
    exactBaseVersions(operation, Object.fromEntries(
      objects
        .filter((object) => object.version > 1)
        .map((object) => [object.id, object.version - 1]),
    ));
    return uniqueAcknowledgedTargets(objects.map((object) => ({
      target: `objects:${object.id}`,
      matches: (state) => valuesMatch(state.objects[object.id], object),
    })));
  }
  if (operation.type === "add_layer") {
    const layer = DrawingLayerInputSchema.parse((operation.forward as { layer: unknown }).layer);
    if (!valuesMatch(operation.inverse, {}))
      throw new Error("Layer add inverse is not exact.");
    exactBaseVersions(operation, { [layer.id]: layer.version });
    const expected = DrawingLayerSchema.parse({ ...layer, systemKind: "custom" });
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
    !valuesMatch(Object.keys(inverse.patch).sort(), Object.keys(forward.patch).sort())
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
  ]);
  const conflictedOperationIds: string[] = [];
  const ambiguousOperationIds: string[] = [];
  let blocked = false;
  const queued = inputs.map((input, index) => {
    if (
      input &&
      typeof input === "object" &&
      "operation" in input &&
      "status" in input
    ) {
      const entry = input as { operation: unknown; status: unknown };
      return {
        index,
        operation: DrawingOperationInputSchema.parse(entry.operation),
        status: entry.status,
      };
    }
    return {
      index,
      operation: DrawingOperationInputSchema.parse(input),
      status: "pending",
    };
  });
  const revisionBlocked = queued.some(
    (entry) =>
      entry.operation.revisionId === state.revisionId &&
      entry.status !== "pending",
  );

  for (const operation of queued
    .filter(
      (entry) =>
        !revisionBlocked &&
        entry.status === "pending" &&
        entry.operation.revisionId === state.revisionId,
    )
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.operation)) {
    if (blocked || !recoveryBaseVersionsMatch(versions, operation)) {
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
          candidate.objects[object.id] = object;
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
      } else if (operation.type === "mutate_structure") {
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
        );
        for (const [index, action] of forward.actions.entries()) {
          const expected = pairedInverse(inverse.actions, index);
          requireExactStructureInverse(action, expected);
          const id = structureActionId(action);
          if ("entity" in action) {
            const current = applied.state[structureCollectionForRecovery(action.kind)][id];
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
        const structureState = {
          revisionId: candidate.revisionId,
          ...structuredClone(candidate.structure),
        };
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
              candidateVersions.get(object.id) !== base ||
              object.version !== base + 1
            )
              throw new Error("Object restoration snapshot is stale.");
            structureState.objects[object.id] = object;
          }
        }
        const applied = forward.actions.length
          ? applyDrawingStructureActions(structureState, forward.actions)
          : {
              state: structureState,
              baseVersions: {},
              resultVersions: {},
              realizedVersions: {},
            };
        const expectedBases = { ...applied.baseVersions };
        for (const object of inputObjects) {
          const base = operation.baseVersions[object.id];
          if (base === undefined)
            throw new Error("Object mutation base version is missing.");
          expectedBases[object.id] = base;
          if (forward.objectAction === "delete") {
            delete applied.state.objects[object.id];
            candidateVersions.set(object.id, base + 1);
          } else {
            candidateVersions.set(object.id, object.version);
          }
        }
        if (!valuesMatch(operation.baseVersions, expectedBases))
          throw new Error("Object mutation base versions are not exact.");
        validateDrawingStructureState(applied.state);
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
      state = candidate;
      versions = candidateVersions;
    } catch {
      ambiguousOperationIds.push(operation.clientOperationId);
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
  );
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
    !persistence?.failed && (capability === "admin" || capability === "editor")
  );
}

export function drawingSaveStatus({
  pending,
  conflicted = false,
  flushing = false,
  online = true,
  storageError = false,
  volatileCount = 0,
}: {
  pending: number;
  conflicted?: boolean;
  flushing?: boolean;
  online?: boolean;
  storageError?: boolean;
  volatileCount?: number;
}): "저장됨" | "저장 중" | "오프라인 저장" | "충돌 검토 필요" {
  if (volatileCount > 0) return "저장 중";
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
  } | null;
  if (response.ok && body?.ok) {
    if (body.clientOperationId !== operation.clientOperationId)
      throw new Error(
        "Server acknowledgement did not match the queued operation.",
      );
    return { clientOperationId: body.clientOperationId, status: "acked" };
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
