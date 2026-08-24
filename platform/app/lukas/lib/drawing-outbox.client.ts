import type { DrawingDocumentState } from "./drawing-commands.ts";
import {
  DrawingLayerInputSchema,
  DrawingLayerSchema,
  DrawingObjectSchema,
  DrawingOperationInputSchema,
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

export type DrawingOutboxAdapter = {
  delete(clientOperationId: string): Promise<void>;
  enqueue(
    entry: Omit<DrawingOutboxEntry, "enqueueSequence">,
  ): Promise<DrawingOutboxEntry>;
  list(): Promise<DrawingOutboxEntry[]>;
  put(entry: DrawingOutboxEntry): Promise<void>;
};

export type DrawingOutboxResponse = {
  clientOperationId: string;
  status: "acked" | "conflicted" | "rejected";
  error?: string;
};

type RetryScheduler = (delayMs: number, retry: () => Promise<void>) => unknown;

type DrawingOutboxOptions = {
  ownerId: string;
  revisionId: string;
  schedule?: RetryScheduler;
  onChange?: () => void;
};

export type DrawingOutbox = {
  enqueue(operation: unknown): Promise<DrawingOperationInput>;
  entries(): Promise<DrawingOutboxEntry[]>;
  flush(
    send: (operation: DrawingOperationInput) => Promise<DrawingOutboxResponse>,
  ): Promise<void>;
  markAcked(clientOperationId: string): Promise<boolean>;
  markConflicted(
    clientOperationId: string,
    status?: "conflicted" | "rejected",
    error?: string,
  ): Promise<boolean>;
  pending(revisionId?: string): Promise<DrawingOperationInput[]>;
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
  let disposed = false;

  const entries = async () =>
    sorted(
      (await adapter.list()).filter(
        (entry) =>
          entry.ownerId === options.ownerId &&
          entry.operation.revisionId === options.revisionId,
      ),
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

  const flushOnce = async (
    send: (operation: DrawingOperationInput) => Promise<DrawingOutboxResponse>,
  ) => {
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
          const response = await send(operation);
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
        return coordinator.active.then(() =>
          disposed ? undefined : api.flush(send),
        );
      coordinator.active = flushOnce(send).finally(() => {
        coordinator.active = null;
      });
      return coordinator.active;
    },
    markAcked,
    markConflicted,
    async pending(revisionId) {
      return (await entries())
        .filter(
          (entry) =>
            revisionId === undefined ||
            entry.operation.revisionId === revisionId,
        )
        .map((entry) => entry.operation);
    },
    dispose() {
      disposed = true;
      for (const cancel of cancelRetries) cancel();
      cancelRetries.clear();
      scheduledRevisions.clear();
    },
  };
  return api;
}

type StoredDrawingOutboxEntry = DrawingOutboxEntry & {
  clientOperationId: string;
  revisionId: string;
  createdAt: string;
};

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
export function createIndexedDbDrawingOutboxAdapter(): DrawingOutboxAdapter {
  let database: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (database) return database;
    database = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) {
        reject(new Error("IndexedDB is unavailable."));
        return;
      }
      const request = globalThis.indexedDB.open("1hk-drawing-workspace", 2);
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
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    void database.catch(() => {
      database = null;
    });
    return database;
  };

  return {
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
  send: (operation: DrawingOperationInput) => Promise<DrawingOutboxResponse>;
  serverState: DrawingDocumentState;
}) {
  if (online) {
    try {
      await outbox.flush(send);
    } catch {
      // The durable pending entry remains eligible for exact-base recovery.
    }
  }
  return recoverPendingDrawingState(serverState, await outbox.entries());
}

export function canPersistDrawingMutation(capability: string) {
  return capability === "admin" || capability === "editor";
}

export function drawingSaveStatus({
  pending,
  conflicted = false,
  flushing = false,
  online = true,
  storageError = false,
}: {
  pending: number;
  conflicted?: boolean;
  flushing?: boolean;
  online?: boolean;
  storageError?: boolean;
}): "저장됨" | "저장 중" | "오프라인 저장" | "충돌 검토 필요" {
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
    init: { method: "POST"; body: FormData; headers: { Accept: string } },
  ) => Promise<DrawingFetchResponse> = fetch,
): Promise<DrawingOutboxResponse> {
  const operation = DrawingOperationInputSchema.parse(input);
  const form = new FormData();
  form.set("intent", "apply_operation");
  form.set("operation_json", JSON.stringify(operation));
  const response = await fetcher(url, {
    method: "POST",
    body: form,
    headers: { Accept: "application/json" },
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
  if (body?.kind === "conflict" || response.status === 409) {
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
