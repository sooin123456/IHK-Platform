import { expect, test, type Page } from "@playwright/test";
import * as Y from "yjs";

import { DRAWING_COLLABORATION_SERVER_ORIGIN } from "../app/lukas/lib/drawing-collaboration-protocol.ts";

const previewPath = "/workspace-preview/drawing-workspace";
const fakeSupabase = "http://127.0.0.1:54321";
const browserModules = [
  "/app/lukas/lib/drawing-yjs-persistence.client.ts",
  "/app/lukas/lib/drawing-yjs-draft.ts",
];
const ids = {
  project: "00000000-0000-4000-8000-000000000601",
  actor: "00000000-0000-4000-8000-000000000605",
  layer: "00000000-0000-4000-8000-000000000606",
  frozenOperation: "00000000-0000-4000-8000-000000000607",
  frozenObject: "00000000-0000-4000-8000-000000000608",
};

async function openPreview(page: Page) {
  for (const modulePath of browserModules)
    expect((await page.request.get(modulePath)).ok()).toBe(true);
  await page.goto(previewPath);
}

async function appendRecoveredOperation(
  page: Page,
  initialUpdate: number[],
  revisionId: string,
) {
  await openPreview(page);
  await page.evaluate(
    async ({ initialUpdate, fixtureIds, revisionId }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const baseState = {
        revisionId,
        objects: {},
        layers: {
          [fixtureIds.layer]: {
            id: fixtureIds.layer,
            name: "Work",
            visible: true,
            locked: false,
            systemKind: "work",
            version: 1,
          },
        },
        operations: [],
        undoStackByActor: {},
        redoStackByActor: {},
      };
      const document = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const handle = await persistence.openDrawingYjsPersistence({
        revisionId,
        document,
      });
      if (!handle) throw new Error("Browser persistence did not open.");
      await handle.whenSynced();
      const adapter = draft.createDrawingDraftAdapter({
        document,
        authoritativeState: baseState,
        actorId: fixtureIds.actor,
        authorization: "editor",
        frozen: false,
        createId: () => fixtureIds.frozenOperation,
        now: () => "2026-08-26T00:00:00.000Z",
      });
      adapter.appendDurableLocal(
        adapter.prepareLocal({
          type: "add_objects",
          actorId: fixtureIds.actor,
          objects: [
            {
              id: fixtureIds.frozenObject,
              name: "Recovered",
              layerId: fixtureIds.layer,
              geometry: {
                type: "rectangle",
                origin: { x: 0, y: 0 },
                width: 10,
                height: 10,
                rotation: 0,
              },
              style: { stroke: "#111111", strokeWidth: 1, fill: null },
              version: 1,
            },
          ],
        }),
      );
      await handle.flush();
      adapter.dispose();
      await handle.dispose();
    },
    { initialUpdate, fixtureIds: ids, revisionId },
  );
}

function object(id: string, index = 0) {
  return {
    id,
    name: `Offline ${index}`,
    layerId: ids.layer,
    geometry: {
      type: "rectangle" as const,
      origin: { x: index * 12, y: 0 },
      width: 10,
      height: 10,
      rotation: 0,
    },
    style: { stroke: "#111111", strokeWidth: 1, fill: null },
    version: 1,
  };
}

function authoritativeDocument(
  revisionId: string,
  freezeState: "active" | "frozen",
) {
  const document = new Y.Doc();
  document.transact(() => {
    const meta = document.getMap("serverMeta");
    meta.set("schemaVersion", 1);
    meta.set("projectId", ids.project);
    meta.set("revisionId", revisionId);
    meta.set("baseSnapshotSha256", "a".repeat(64));
    meta.set("baseOperationSequence", 0);
    meta.set("freezeState", freezeState);
    meta.set("freezeRequestId", null);
    document.getMap("operationStatus");
    document.getArray("operations");
    document.getArray("operationOrder");
  }, DRAWING_COLLABORATION_SERVER_ORIGIN);
  return document;
}

function authoritativeFixture(
  revisionId: string,
  freezeState: "active" | "frozen",
) {
  const document = authoritativeDocument(revisionId, freezeState);
  const update = [...Y.encodeStateAsUpdate(document)];
  document.destroy();
  return update;
}

function authoritativeActiveAndFreeze(revisionId: string) {
  const document = authoritativeDocument(revisionId, "active");
  const initialUpdate = [...Y.encodeStateAsUpdate(document)];
  const vector = Y.encodeStateVector(document);
  document.transact(() => {
    document.getMap("serverMeta").set("freezeState", "frozen");
  }, DRAWING_COLLABORATION_SERVER_ORIGIN);
  const freezeUpdate = [...Y.encodeStateAsUpdate(document, vector)];
  document.destroy();
  return { initialUpdate, freezeUpdate };
}

test("revision-scoped adapter recovers 100 canonical offline operations before network", async ({
  page,
}) => {
  const revision = "00000000-0000-4000-8000-000000000602";
  const fakeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(fakeSupabase))
      fakeRequests.push(request.url());
  });
  await openPreview(page);

  const result = await page.evaluate(
    async ({ initialUpdate, fixtureIds }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const revision = "00000000-0000-4000-8000-000000000602";
      const otherRevision = "00000000-0000-4000-8000-000000000603";
      const baseState = {
        revisionId: revision,
        objects: {},
        layers: {
          [fixtureIds.layer]: {
            id: fixtureIds.layer,
            name: "Work",
            visible: true,
            locked: false,
            systemKind: "work",
            version: 1,
          },
        },
        operations: [],
        undoStackByActor: {},
        redoStackByActor: {},
      };
      const operationIds = Array.from(
        { length: 100 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index + 700).padStart(12, "0")}`,
      );
      const objectIds = Array.from(
        { length: 100 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index + 900).padStart(12, "0")}`,
      );
      let operationIndex = 0;
      const first = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const firstHandle = await persistence.openDrawingYjsPersistence({
        revisionId: revision,
        document: first,
      });
      if (!firstHandle) throw new Error("Browser persistence did not open.");
      await firstHandle.whenSynced();
      const events = ["local-synced"];
      const adapter = draft.createDrawingDraftAdapter({
        document: first,
        authoritativeState: baseState,
        actorId: fixtureIds.actor,
        authorization: "editor",
        frozen: false,
        createId: () => operationIds[operationIndex++],
        now: () =>
          new Date(
            Date.UTC(2026, 7, 26) + operationIndex * 3_000,
          ).toISOString(),
      });
      for (let index = 0; index < 100; index += 1) {
        const objectId = objectIds[index];
        const prepared = adapter.prepareLocal({
          type: "add_objects",
          actorId: fixtureIds.actor,
          objects: [
            {
              id: objectId,
              name: `Offline ${index}`,
              layerId: fixtureIds.layer,
              geometry: {
                type: "grid",
                semanticVersion: 1,
                start: { x: index * 12, y: 0 },
                end: { x: index * 12, y: 100 },
              },
              style: { stroke: "#111111", strokeWidth: 1, fill: null },
              version: 1,
            },
          ],
        });
        adapter.appendDurableLocal(prepared);
      }
      await firstHandle.flush();
      adapter.dispose();
      await firstHandle.dispose();

      const reopened = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const reopenedHandle = await persistence.openDrawingYjsPersistence({
        revisionId: revision,
        document: reopened,
      });
      if (!reopenedHandle)
        throw new Error("Browser persistence did not reopen.");
      await reopenedHandle.whenSynced();
      const recovered = draft.createDrawingDraftAdapter({
        document: reopened,
        authoritativeState: baseState,
        actorId: fixtureIds.actor,
        authorization: "editor",
        frozen: false,
      });
      events.push("network-enabled");
      const snapshot = recovered.getSnapshot();
      const names = [
        persistence.drawingYjsPersistenceName(revision),
        persistence.drawingYjsPersistenceName(otherRevision),
      ];
      recovered.dispose();
      await reopenedHandle.dispose();
      return {
        events,
        names,
        quarantine: snapshot.quarantine,
        operationIds: snapshot.pendingOperationIds,
        objectIds: Object.keys(snapshot.state.objects),
        expectedOperationIds: operationIds,
        expectedObjectIds: objectIds,
      };
    },
    {
      initialUpdate: authoritativeFixture(revision, "active"),
      fixtureIds: ids,
    },
  );

  expect(result.events).toEqual(["local-synced", "network-enabled"]);
  expect(result.names[0]).not.toBe(result.names[1]);
  expect(result.quarantine).toBeNull();
  expect(result.operationIds).toEqual(result.expectedOperationIds);
  expect(result.objectIds).toEqual(result.expectedObjectIds);
  expect(fakeRequests).toEqual([]);
});

test("valid frozen adapter recovery survives version-change close", async ({
  page,
}) => {
  const revision = "00000000-0000-4000-8000-000000000604";
  const { freezeUpdate, initialUpdate } =
    authoritativeActiveAndFreeze(revision);
  await openPreview(page);
  const result = await page.evaluate(
    async ({ freezeUpdate, initialUpdate, fixtureIds }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const revision = "00000000-0000-4000-8000-000000000604";
      const baseState = {
        revisionId: revision,
        objects: {},
        layers: {
          [fixtureIds.layer]: {
            id: fixtureIds.layer,
            name: "Work",
            visible: true,
            locked: false,
            systemKind: "work",
            version: 1,
          },
        },
        operations: [],
        undoStackByActor: {},
        redoStackByActor: {},
      };
      const first = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const firstHandle = await persistence.openDrawingYjsPersistence({
        revisionId: revision,
        document: first,
      });
      if (!firstHandle) throw new Error("Browser persistence did not open.");
      await firstHandle.whenSynced();
      const activeAdapter = draft.createDrawingDraftAdapter({
        document: first,
        authoritativeState: baseState,
        actorId: fixtureIds.actor,
        authorization: "editor",
        frozen: false,
        createId: () => fixtureIds.frozenOperation,
        now: () => "2026-08-26T00:00:00.000Z",
      });
      activeAdapter.appendDurableLocal(
        activeAdapter.prepareLocal({
          type: "add_objects",
          actorId: fixtureIds.actor,
          objects: [
            {
              id: fixtureIds.frozenObject,
              name: "Recovered",
              layerId: fixtureIds.layer,
              geometry: {
                type: "rectangle",
                origin: { x: 0, y: 0 },
                width: 10,
                height: 10,
                rotation: 0,
              },
              style: { stroke: "#111111", strokeWidth: 1, fill: null },
              version: 1,
            },
          ],
        }),
      );
      await firstHandle.flush();
      const freezeApplied = activeAdapter.applyServerProjection(
        Uint8Array.from(freezeUpdate),
      );
      const freezeQuarantine = activeAdapter.getSnapshot().quarantine;
      let frozenMutationRejected = false;
      try {
        activeAdapter.prepareLocal({
          type: "delete_objects",
          actorId: fixtureIds.actor,
          objectIds: [fixtureIds.frozenObject],
        });
      } catch {
        frozenMutationRejected = true;
      }
      await firstHandle.flush();
      activeAdapter.dispose();

      const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(firstHandle.name, 2);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => undefined;
        request.onsuccess = () => resolve(request.result);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      const closedByVersionChange = firstHandle.closed;
      const postCloseOperation = {
        ...first
          .getArray("operations")
          .toArray()
          .find(
            (value: Record<string, unknown>) =>
              value.clientOperationId === fixtureIds.frozenOperation,
          ),
        clientOperationId: "00000000-0000-4000-8000-000000000609",
      };
      first.transact(() => {
        first.getArray("operations").push([postCloseOperation]);
        first
          .getArray("operationOrder")
          .push([postCloseOperation.clientOperationId]);
      });
      upgraded.close();
      await firstHandle.dispose();

      const recoveredDocument = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const recoveredHandle = await persistence.openDrawingYjsPersistence({
        revisionId: revision,
        document: recoveredDocument,
      });
      if (!recoveredHandle)
        throw new Error("Browser persistence did not reopen.");
      await recoveredHandle.whenSynced();
      const adapter = draft.createDrawingDraftAdapter({
        document: recoveredDocument,
        authoritativeState: baseState,
        actorId: fixtureIds.actor,
        authorization: "editor",
        frozen: false,
      });
      const snapshot = adapter.getSnapshot();
      const recoveredEnvelopes = recoveredDocument
        .getArray("operations")
        .toArray();
      const postClosePersisted = recoveredEnvelopes.some(
        (value: Record<string, unknown>) =>
          value.clientOperationId === postCloseOperation.clientOperationId,
      );
      const recoveryEnvelope = recoveredEnvelopes.find(
        (value: Record<string, unknown>) =>
          value.clientOperationId === fixtureIds.frozenOperation,
      );
      adapter.dispose();
      await recoveredHandle.dispose();
      return {
        closedByVersionChange,
        freezeApplied,
        freezeQuarantine,
        frozenMutationRejected,
        postClosePersisted,
        frozen: snapshot.frozen,
        quarantine: snapshot.quarantine,
        pendingOperationIds: snapshot.pendingOperationIds,
        objectIds: Object.keys(snapshot.state.objects),
        recoveryEnvelopeId: recoveryEnvelope?.clientOperationId ?? null,
      };
    },
    {
      initialUpdate,
      freezeUpdate,
      fixtureIds: ids,
    },
  );

  expect(result).toEqual({
    closedByVersionChange: true,
    freezeApplied: true,
    freezeQuarantine: null,
    frozenMutationRejected: true,
    postClosePersisted: false,
    frozen: true,
    quarantine: null,
    pendingOperationIds: [ids.frozenOperation],
    objectIds: [ids.frozenObject],
    recoveryEnvelopeId: ids.frozenOperation,
  });
});

test("two browser realms recover the same durable ID as one canonical operation", async ({
  context,
}) => {
  const revision = "00000000-0000-4000-8000-000000000610";
  const initialUpdate = authoritativeFixture(revision, "active");
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([
    appendRecoveredOperation(first, initialUpdate, revision),
    appendRecoveredOperation(second, initialUpdate, revision),
  ]);

  const result = await first.evaluate(
    async ({ initialUpdate, fixtureIds, revisionId }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const baseState = {
        revisionId,
        objects: {},
        layers: {
          [fixtureIds.layer]: {
            id: fixtureIds.layer,
            name: "Work",
            visible: true,
            locked: false,
            systemKind: "work",
            version: 1,
          },
        },
        operations: [],
        undoStackByActor: {},
        redoStackByActor: {},
      };
      const document = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const handle = await persistence.openDrawingYjsPersistence({
        revisionId,
        document,
      });
      if (!handle) throw new Error("Browser persistence did not reopen.");
      await handle.whenSynced();
      const adapter = draft.createDrawingDraftAdapter({
        document,
        authoritativeState: baseState,
        actorId: fixtureIds.actor,
        authorization: "editor",
        frozen: false,
      });
      const snapshot = adapter.getSnapshot();
      adapter.dispose();
      await handle.dispose();
      return {
        quarantine: snapshot.quarantine,
        pendingOperationIds: snapshot.pendingOperationIds,
        objectIds: Object.keys(snapshot.state.objects),
        projectedOperations: snapshot.state.operations.length,
      };
    },
    { initialUpdate, fixtureIds: ids, revisionId: revision },
  );
  await second.close();
  await first.close();

  expect(result).toEqual({
    quarantine: null,
    pendingOperationIds: [ids.frozenOperation],
    objectIds: [ids.frozenObject],
    projectedOperations: 1,
  });
});
