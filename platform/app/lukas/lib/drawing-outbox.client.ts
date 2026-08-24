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
  operation: DrawingOperationInput;
  status: DrawingOutboxStatus;
  retryCount: number;
  error?: string;
};

export type DrawingOutboxAdapter = {
  delete(clientOperationId: string): Promise<void>;
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
};

const retryDelays = [1000, 2000, 4000, 8000, 15000] as const;

function sorted(entries: DrawingOutboxEntry[]) {
  return entries.sort(
    (left, right) =>
      left.operation.revisionId.localeCompare(right.operation.revisionId) ||
      left.operation.createdAt.localeCompare(right.operation.createdAt) ||
      left.operation.clientOperationId.localeCompare(
        right.operation.clientOperationId,
      ),
  );
}

function defaultSchedule(delayMs: number, retry: () => Promise<void>) {
  return globalThis.setTimeout(() => void retry().catch(() => {}), delayMs);
}

export function createDrawingOutbox(
  adapter: DrawingOutboxAdapter = createIndexedDbDrawingOutboxAdapter(),
  options: DrawingOutboxOptions = {},
): DrawingOutbox {
  const schedule = options.schedule ?? defaultSchedule;
  const scheduledRevisions = new Set<string>();
  let activeFlush: Promise<void> | null = null;

  const entries = async () => sorted(await adapter.list());
  const markAcked = async (clientOperationId: string) => {
    const exists = (await adapter.list()).some(
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
    const entry = (await adapter.list()).find(
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
    const queued = await entries();
    const blockedRevisions = new Set(
      queued
        .filter((entry) => entry.status !== "pending")
        .map((entry) => entry.operation.revisionId),
    );
    let firstFailure: unknown;

    for (const entry of queued) {
      const { operation } = entry;
      if (
        entry.status !== "pending" ||
        blockedRevisions.has(operation.revisionId)
      )
        continue;
      try {
        const response = await send(operation);
        if (response.clientOperationId !== operation.clientOperationId) {
          await markConflicted(
            operation.clientOperationId,
            "rejected",
            "Server acknowledgement did not match the queued operation.",
          );
          blockedRevisions.add(operation.revisionId);
          firstFailure ??= new Error(
            "Server acknowledgement did not match the queued operation.",
          );
          continue;
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
        blockedRevisions.add(operation.revisionId);
      } catch (error) {
        const retryCount = entry.retryCount + 1;
        await adapter.put({
          ...entry,
          retryCount,
          error: error instanceof Error ? error.message : "Network error",
        });
        options.onChange?.();
        blockedRevisions.add(operation.revisionId);
        firstFailure ??= error;
        if (!scheduledRevisions.has(operation.revisionId)) {
          scheduledRevisions.add(operation.revisionId);
          const delay =
            retryDelays[Math.min(retryCount - 1, retryDelays.length - 1)];
          schedule(delay, async () => {
            scheduledRevisions.delete(operation.revisionId);
            return api.flush(send);
          });
        }
      }
    }
    if (firstFailure) throw firstFailure;
  };

  const api: DrawingOutbox = {
    async enqueue(input) {
      const operation = DrawingOperationInputSchema.parse(input);
      await adapter.put({ operation, status: "pending", retryCount: 0 });
      options.onChange?.();
      return operation;
    },
    entries,
    flush(send) {
      if (activeFlush) return activeFlush;
      activeFlush = flushOnce(send).finally(() => {
        activeFlush = null;
      });
      return activeFlush;
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
      const request = globalThis.indexedDB.open("1hk-drawing-workspace", 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore("operations", {
          keyPath: "clientOperationId",
        });
        store.createIndex("revision_created_at", ["revisionId", "createdAt"]);
        store.createIndex("status", "status");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
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
): { state: DrawingDocumentState; conflictedOperationIds: string[] } {
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
  let blocked = false;
  const queued = inputs.map((input) => {
    if (
      input &&
      typeof input === "object" &&
      "operation" in input &&
      "status" in input
    ) {
      const entry = input as { operation: unknown; status: unknown };
      return {
        operation: DrawingOperationInputSchema.parse(entry.operation),
        status: entry.status,
      };
    }
    return {
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
    .map((entry) => entry.operation)
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.clientOperationId.localeCompare(right.clientOperationId),
    )) {
    if (blocked || !recoveryBaseVersionsMatch(versions, operation)) {
      conflictedOperationIds.push(operation.clientOperationId);
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
      conflictedOperationIds.push(operation.clientOperationId);
      blocked = true;
    }
  }
  return { state, conflictedOperationIds };
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
  if (storageError || !online) return "오프라인 저장";
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
  const body = (await response.json()) as {
    ok?: boolean;
    kind?: string;
    error?: string;
    clientOperationId?: string;
  };
  if (response.ok && body.ok) {
    if (body.clientOperationId !== operation.clientOperationId)
      throw new Error(
        "Server acknowledgement did not match the queued operation.",
      );
    return { clientOperationId: body.clientOperationId, status: "acked" };
  }
  if (body.kind === "conflict" || response.status === 409) {
    return {
      clientOperationId: operation.clientOperationId,
      status: "conflicted",
      error: body.error,
    };
  }
  if (response.status >= 400 && response.status < 500) {
    return {
      clientOperationId: operation.clientOperationId,
      status: "rejected",
      error: body.error,
    };
  }
  throw new Error(body.error ?? "Drawing operation could not be saved.");
}
