import { IndexeddbPersistence, storeState } from "y-indexeddb";
import * as Y from "yjs";

import { DRAWING_COLLABORATION_SERVER_ORIGIN } from "./drawing-collaboration-protocol.ts";

const canonicalUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function drawingYjsPersistenceName(ownerId: string, revisionId: string) {
  if (!canonicalUuid.test(ownerId))
    throw new Error("Drawing Yjs persistence requires a canonical owner UUID.");
  if (!canonicalUuid.test(revisionId))
    throw new Error(
      "Drawing Yjs persistence requires a canonical revision UUID.",
    );
  return `1hk:drawing-draft:v2:${ownerId}:${revisionId}`;
}

export type DrawingYjsPersistence = {
  readonly name: string;
  readonly closed: boolean;
  whenSynced(): Promise<void>;
  flush(): Promise<void>;
  dispose(): Promise<void>;
};

function waitForDrawingIndexedDbWrites(database: IDBDatabase) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction("updates", "readonly");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("Drawing IndexedDB flush failed."));
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error("Drawing IndexedDB flush aborted."),
      );
    transaction.objectStore("updates").count();
  });
}

export function createDrawingYjsDocument(authoritativeState?: Uint8Array) {
  const document = new Y.Doc();
  if (authoritativeState)
    Y.applyUpdate(
      document,
      authoritativeState,
      DRAWING_COLLABORATION_SERVER_ORIGIN,
    );
  document.getMap("serverMeta");
  document.getArray("operationOrder");
  document.getArray("operations");
  document.getMap("operationStatus");
  return document;
}

/** Opens only in a browser; callers await sync before enabling a network provider. */
export async function openDrawingYjsPersistence({
  ownerId,
  revisionId,
  document,
}: {
  ownerId: string;
  revisionId: string;
  document: Y.Doc;
}): Promise<DrawingYjsPersistence | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined")
    return null;
  const name = drawingYjsPersistenceName(ownerId, revisionId);
  const persistence = new IndexeddbPersistence(name, document);
  const database = await persistence._db;
  let closed = false;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;
  const destroy = () => {
    if (!disposePromise) {
      disposed = true;
      closed = true;
      disposePromise = persistence.destroy();
    }
    return disposePromise;
  };
  const priorVersionChange = database.onversionchange;
  database.onversionchange = (event) => {
    closed = true;
    void destroy();
    priorVersionChange?.call(database, event);
  };
  return {
    name,
    get closed() {
      return closed;
    },
    async whenSynced() {
      await persistence.whenSynced;
    },
    async flush() {
      if (disposed || closed) return;
      await storeState(persistence, true);
      await waitForDrawingIndexedDbWrites(database);
    },
    async dispose() {
      await destroy();
    },
  };
}
