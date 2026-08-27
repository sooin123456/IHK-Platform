import { expect, test, type Page } from "@playwright/test";
import * as Y from "yjs";

import { DRAWING_COLLABORATION_SERVER_ORIGIN } from "../app/lukas/lib/drawing-collaboration-protocol.ts";

const previewPath = "/workspace-preview/drawing-workspace";
const fakeSupabase = "http://127.0.0.1:54321";
const browserModules = [
  "/app/lukas/lib/drawing-yjs-persistence.client.ts",
  "/app/lukas/lib/drawing-yjs-draft.ts",
  "/app/lukas/lib/drawing-outbox.ts",
  "/app/lukas/lib/drawing-collaboration-client.ts",
  "/app/lukas/lib/drawing-source-links.ts",
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
      const snapshot = adapter.getSnapshot();
      const alreadyRecovered = snapshot.state.operations.some(
        (operation: { clientOperationId: string }) =>
          operation.clientOperationId === fixtureIds.frozenOperation,
      );
      if (!alreadyRecovered)
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
      else if (!snapshot.state.objects[fixtureIds.frozenObject])
        throw new Error("Recovered operation is missing its canonical object.");
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

test("offline command bridge recovers 100 ordered operations and stops at the real action-ack boundary", async ({
  context,
  page,
}) => {
  const revision = "00000000-0000-4000-8000-000000000004";
  const fakeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(fakeSupabase))
      fakeRequests.push(request.url());
  });
  await openPreview(page);
  await page.evaluate(
    (modulePaths) => Promise.all(modulePaths.map((path) => import(path))),
    browserModules,
  );
  await context.setOffline(true);

  const written = await page.evaluate(
    async ({ initialUpdate, fixtureIds }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const outboxPath = "/app/lukas/lib/drawing-outbox.ts";
      const collaborationPath =
        "/app/lukas/lib/drawing-collaboration-client.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const outboxModule = await import(outboxPath);
      const collaboration = await import(collaborationPath);
      const revision = "00000000-0000-4000-8000-000000000004";
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
      const outbox = outboxModule.createDrawingOutbox(undefined, {
        ownerId: fixtureIds.actor,
        revisionId: revision,
        schedule: () => undefined,
      });
      const bridge = collaboration.createDrawingCollaborationCommandBridge({
        adapter,
        outbox,
      });
      for (let index = 0; index < 100; index += 1) {
        const objectId = objectIds[index];
        await bridge.applyCommand({
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
      }
      await firstHandle.flush();
      const snapshot = adapter.getSnapshot();
      const result = {
        online: navigator.onLine,
        outboxIds: (await outbox.entries()).map(
          (entry: any) => entry.operation.clientOperationId,
        ),
        operationIds: adapter
          .operations()
          .map((operation: any) => operation.clientOperationId),
        pendingIds: snapshot.pendingOperationIds,
        objectIds: Object.keys(snapshot.state.objects),
        expectedOperationIds: operationIds,
        expectedObjectIds: objectIds,
      };
      outbox.dispose();
      adapter.dispose();
      await firstHandle.dispose();
      first.destroy();
      return result;
    },
    {
      initialUpdate: authoritativeFixture(revision, "active"),
      fixtureIds: ids,
    },
  );

  expect(written.online).toBe(false);
  expect(written.outboxIds).toEqual(written.expectedOperationIds);
  expect(written.operationIds).toEqual(written.expectedOperationIds);
  expect(written.pendingIds).toEqual(written.expectedOperationIds);
  expect(written.objectIds).toEqual(written.expectedObjectIds);

  const reopened = await page.evaluate(
    async ({ initialUpdate, fixtureIds }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const outboxPath = "/app/lukas/lib/drawing-outbox.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const outboxModule = await import(outboxPath);
      const revision = "00000000-0000-4000-8000-000000000004";
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
      const snapshot = recovered.getSnapshot();
      const outbox = outboxModule.createDrawingOutbox(undefined, {
        ownerId: fixtureIds.actor,
        revisionId: revision,
        schedule: () => undefined,
      });
      const result = {
        online: navigator.onLine,
        quarantine: snapshot.quarantine,
        outboxIds: (await outbox.entries()).map(
          (entry: any) => entry.operation.clientOperationId,
        ),
        operationIds: recovered
          .operations()
          .map((operation: any) => operation.clientOperationId),
        pendingIds: snapshot.pendingOperationIds,
        objectIds: Object.keys(snapshot.state.objects),
      };
      outbox.dispose();
      recovered.dispose();
      await reopenedHandle.dispose();
      reopened.destroy();
      return result;
    },
    {
      initialUpdate: authoritativeFixture(revision, "active"),
      fixtureIds: ids,
    },
  );

  expect(reopened.online).toBe(false);
  expect(reopened.quarantine).toBeNull();
  expect(reopened.outboxIds).toEqual(written.expectedOperationIds);
  expect(reopened.operationIds).toEqual(written.expectedOperationIds);
  expect(reopened.pendingIds).toEqual(written.expectedOperationIds);
  expect(reopened.objectIds).toEqual(written.expectedObjectIds);
  expect(fakeRequests).toEqual([]);

  const applyRequests: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes(previewPath))
      applyRequests.push(request.url());
  });
  await context.setOffline(false);
  const actionAcknowledged = await page.evaluate(
    async ({ initialUpdate, fixtureIds }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const outboxPath = "/app/lukas/lib/drawing-outbox.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const outboxModule = await import(outboxPath);
      const revision = "00000000-0000-4000-8000-000000000004";
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
      const document = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const handle = await persistence.openDrawingYjsPersistence({
        revisionId: revision,
        document,
      });
      if (!handle) throw new Error("Browser persistence did not reconnect.");
      await handle.whenSynced();
      const adapter = draft.createDrawingDraftAdapter({
        document,
        authoritativeState: baseState,
        actorId: fixtureIds.actor,
        authorization: "editor",
        frozen: false,
      });
      const outbox = outboxModule.createDrawingOutbox(undefined, {
        ownerId: fixtureIds.actor,
        revisionId: revision,
        schedule: () => undefined,
      });
      await outbox.flush((operation: any, context: any) =>
        outboxModule.sendDrawingOperation(
          operation,
          `${window.location.pathname}.data`,
          async (input: string, init: RequestInit) => {
            const response = await fetch(input, init);
            const wireBody = await response.text();
            if (!response.ok || !wireBody.includes(operation.clientOperationId))
              throw new Error("Reconnect action did not echo the operation.");
            return {
              ok: true,
              status: response.status,
              async json() {
                return {
                  ok: true,
                  clientOperationId: operation.clientOperationId,
                };
              },
            };
          },
          context?.signal,
        ),
      );
      await handle.flush();
      const snapshot = adapter.getSnapshot();
      const result = {
        online: navigator.onLine,
        outboxIds: (await outbox.entries()).map(
          (entry: any) => entry.operation.clientOperationId,
        ),
        operationIds: adapter
          .operations()
          .map((operation: any) => operation.clientOperationId),
        pendingIds: snapshot.pendingOperationIds,
        objectIds: Object.keys(snapshot.state.objects),
        statusIds: Array.from(document.getMap("operationStatus").keys()),
      };
      outbox.dispose();
      adapter.dispose();
      await handle.dispose();
      document.destroy();
      return result;
    },
    {
      initialUpdate: authoritativeFixture(revision, "active"),
      fixtureIds: ids,
    },
  );
  expect(actionAcknowledged.online).toBe(true);
  expect(actionAcknowledged.outboxIds).toEqual([]);
  expect(actionAcknowledged.operationIds).toEqual(written.expectedOperationIds);
  expect(actionAcknowledged.pendingIds).toEqual(written.expectedOperationIds);
  expect(actionAcknowledged.objectIds).toEqual(written.expectedObjectIds);
  expect(actionAcknowledged.statusIds).toEqual([]);
  expect(applyRequests).toHaveLength(100);
});

test("source link unlink and undo survive a real IndexedDB crash and reopen without clipboard evidence", async ({
  page,
}) => {
  const revision = "00000000-0000-4000-8000-000000000630";
  const sourceId = "00000000-0000-4000-8000-000000000631";
  const fileId = "00000000-0000-4000-8000-000000000632";
  const objectId = "00000000-0000-4000-8000-000000000633";
  const semanticObjectId = "00000000-0000-4000-8000-000000000639";
  const pageId = "00000000-0000-4000-8000-000000000634";
  const canvasId = "00000000-0000-4000-8000-000000000635";
  const operationIds = [
    "00000000-0000-4000-8000-000000000636",
    "00000000-0000-4000-8000-000000000637",
    "00000000-0000-4000-8000-000000000638",
    "00000000-0000-4000-8000-000000000640",
    "00000000-0000-4000-8000-000000000641",
    "00000000-0000-4000-8000-000000000642",
    "00000000-0000-4000-8000-000000000643",
  ];
  const initialUpdate = authoritativeFixture(revision, "active");
  await openPreview(page);

  const written = await page.evaluate(
    async ({
      canvasId,
      fileId,
      fixtureIds,
      initialUpdate,
      objectId,
      operationIds,
      pageId,
      revision,
      semanticObjectId,
      sourceId,
    }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const outboxPath = "/app/lukas/lib/drawing-outbox.ts";
      const collaborationPath =
        "/app/lukas/lib/drawing-collaboration-client.ts";
      const commandsPath = "/app/lukas/lib/drawing-commands.ts";
      const sourceLinksPath = "/app/lukas/lib/drawing-source-links.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const outboxModule = await import(outboxPath);
      const collaboration = await import(collaborationPath);
      const commands = await import(commandsPath);
      const sourceLinks = await import(sourceLinksPath);
      const object = {
        id: objectId,
        name: "Linked object",
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
      };
      const baseState = commands.createDrawingDocumentState({
        revisionId: revision,
        structure: {
          pages: {
            [pageId]: {
              id: pageId,
              revisionId: revision,
              name: "A1",
              sortOrder: 0,
              version: 1,
            },
          },
          canvases: {
            [canvasId]: {
              id: canvasId,
              pageId,
              name: "Paper",
              spaceKind: "paper",
              widthMillimeters: 210,
              heightMillimeters: 297,
              background: null,
              sortOrder: 0,
              version: 1,
            },
          },
          layers: {
            [fixtureIds.layer]: {
              id: fixtureIds.layer,
              name: "Work",
              visible: true,
              locked: false,
              systemKind: "work",
              canvasId,
              sortOrder: 0,
              version: 1,
            },
          },
          objects: { [objectId]: object },
          sources: {},
          styles: {},
          blocks: {},
          blockInstances: {},
          propertySchemas: {},
          propertyValues: {},
          tables: {},
        },
      });
      const document = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const handle = await persistence.openDrawingYjsPersistence({
        revisionId: revision,
        document,
      });
      if (!handle) throw new Error("Browser persistence did not open.");
      await handle.whenSynced();
      let operationIndex = 0;
      const adapter = draft.createDrawingDraftAdapter({
        document,
        authoritativeState: baseState,
        actorId: fixtureIds.actor,
        authorization: "editor",
        frozen: false,
        createId: () => operationIds[operationIndex++],
        now: () => "2026-08-27T00:00:00.000Z",
      });
      const outbox = outboxModule.createDrawingOutbox(undefined, {
        ownerId: fixtureIds.actor,
        revisionId: revision,
        schedule: () => undefined,
      });
      const bridge = collaboration.createDrawingCollaborationCommandBridge({
        adapter,
        outbox,
      });
      await bridge.applyCommand({
        type: "add_objects",
        actorId: fixtureIds.actor,
        objects: [
          {
            id: semanticObjectId,
            name: "Crash wall",
            layerId: fixtureIds.layer,
            geometry: {
              type: "wall",
              semanticVersion: 1,
              start: { x: 0, y: 0 },
              end: { x: 1000, y: 0 },
              thicknessMillimeters: 200,
              heightMillimeters: 3000,
            },
            style: { stroke: "#111111", strokeWidth: 1, fill: null },
            version: 1,
          },
        ],
      });
      const undoAdded = commands.undoDrawingCommand(
        adapter.getSnapshot().state,
        fixtureIds.actor,
        {
          createId: () => operationIds[operationIndex++],
          now: () => "2026-08-27T00:00:01.000Z",
        },
      );
      if (!undoAdded || "kind" in undoAdded)
        throw new Error("Added object undo conflicted.");
      await bridge.applyRecorded(undoAdded);
      let sourceIdClaimDenied = false;
      try {
        sourceLinks.linkDrawingPdfRegionSourceCommand(
          adapter.getSnapshot().state,
          fixtureIds.actor,
          objectId,
          {
            id: semanticObjectId,
            sourceFileId: fileId,
            sourceSha256: "e".repeat(64),
            pdfPageNumber: 1,
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.4,
          },
        );
      } catch {
        sourceIdClaimDenied = true;
      }
      const redoAdded = commands.redoDrawingCommand(
        adapter.getSnapshot().state,
        fixtureIds.actor,
        {
          createId: () => operationIds[operationIndex++],
          now: () => "2026-08-27T00:00:02.000Z",
        },
      );
      if (!redoAdded || "kind" in redoAdded)
        throw new Error("Added object redo conflicted.");
      await bridge.applyRecorded(redoAdded);
      const undoAddedAgain = commands.undoDrawingCommand(
        adapter.getSnapshot().state,
        fixtureIds.actor,
        {
          createId: () => operationIds[operationIndex++],
          now: () => "2026-08-27T00:00:03.000Z",
        },
      );
      if (!undoAddedAgain || "kind" in undoAddedAgain)
        throw new Error("Redone object undo conflicted.");
      await bridge.applyRecorded(undoAddedAgain);
      await bridge.applyCommand(
        sourceLinks.linkDrawingPdfRegionSourceCommand(
          adapter.getSnapshot().state,
          fixtureIds.actor,
          objectId,
          {
            id: sourceId,
            sourceFileId: fileId,
            sourceSha256: "e".repeat(64),
            pdfPageNumber: 1,
            x: 0.1,
            y: 0.2,
            width: 0.3,
            height: 0.4,
          },
        ),
      );
      await bridge.applyCommand(
        sourceLinks.unlinkDrawingObjectSourceCommand(
          adapter.getSnapshot().state,
          fixtureIds.actor,
          sourceId,
        ),
      );
      const undo = commands.undoDrawingCommand(
        adapter.getSnapshot().state,
        fixtureIds.actor,
        {
          createId: () => operationIds[operationIndex++],
          now: () => "2026-08-27T00:00:01.000Z",
        },
      );
      if (!undo || "kind" in undo) throw new Error("Source undo conflicted.");
      await bridge.applyRecorded(undo);
      await handle.flush();
      const snapshot = adapter.getSnapshot();
      const clipboard = commands.copyDrawingSelection(snapshot.state, [
        objectId,
      ]);
      return {
        outboxIds: (await outbox.entries()).map(
          (entry: any) => entry.operation.clientOperationId,
        ),
        operationIds: adapter
          .operations()
          .map((operation: any) => operation.clientOperationId),
        sourceVersion: snapshot.state.structure.sources[sourceId]?.version,
        sourceIdClaimDenied,
        semanticTombstone:
          snapshot.state.structure.tombstones?.[semanticObjectId],
        clipboardJson: JSON.stringify(clipboard),
      };
      // Deliberately do not dispose: navigation below simulates a renderer crash.
    },
    {
      canvasId,
      fileId,
      fixtureIds: ids,
      initialUpdate,
      objectId,
      operationIds,
      pageId,
      revision,
      semanticObjectId,
      sourceId,
    },
  );
  expect(written.outboxIds).toEqual(operationIds);
  expect(written.operationIds).toEqual(operationIds);
  expect(written.sourceVersion).toBe(3);
  expect(written.sourceIdClaimDenied).toBe(true);
  expect(written.semanticTombstone).toMatchObject({
    collection: "objects",
    version: 4,
    entity: { id: semanticObjectId, version: 3, geometry: { type: "wall" } },
  });
  expect(written.clipboardJson).not.toContain(sourceId);

  await page.reload();
  const reopened = await page.evaluate(
    async ({
      canvasId,
      fixtureIds,
      initialUpdate,
      objectId,
      pageId,
      revision,
      semanticObjectId,
      sourceId,
    }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const outboxPath = "/app/lukas/lib/drawing-outbox.ts";
      const commandsPath = "/app/lukas/lib/drawing-commands.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const outboxModule = await import(outboxPath);
      const commands = await import(commandsPath);
      const baseState = commands.createDrawingDocumentState({
        revisionId: revision,
        structure: {
          pages: {
            [pageId]: {
              id: pageId,
              revisionId: revision,
              name: "A1",
              sortOrder: 0,
              version: 1,
            },
          },
          canvases: {
            [canvasId]: {
              id: canvasId,
              pageId,
              name: "Paper",
              spaceKind: "paper",
              widthMillimeters: 210,
              heightMillimeters: 297,
              background: null,
              sortOrder: 0,
              version: 1,
            },
          },
          layers: {
            [fixtureIds.layer]: {
              id: fixtureIds.layer,
              name: "Work",
              visible: true,
              locked: false,
              systemKind: "work",
              canvasId,
              sortOrder: 0,
              version: 1,
            },
          },
          objects: {
            [objectId]: {
              id: objectId,
              name: "Linked object",
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
          },
          sources: {},
          styles: {},
          blocks: {},
          blockInstances: {},
          propertySchemas: {},
          propertyValues: {},
          tables: {},
        },
      });
      const document = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const handle = await persistence.openDrawingYjsPersistence({
        revisionId: revision,
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
      const outbox = outboxModule.createDrawingOutbox(undefined, {
        ownerId: fixtureIds.actor,
        revisionId: revision,
        schedule: () => undefined,
      });
      const entries = await outbox.entries();
      const recovered = outboxModule.recoverPendingDrawingState(
        baseState,
        entries,
      );
      const snapshot = adapter.getSnapshot();
      const result = {
        quarantine: snapshot.quarantine,
        outboxIds: entries.map(
          (entry: any) => entry.operation.clientOperationId,
        ),
        operationIds: adapter
          .operations()
          .map((operation: any) => operation.clientOperationId),
        sourceVersion: snapshot.state.structure.sources[sourceId]?.version,
        recoveredSourceVersion:
          recovered.state.structure.sources[sourceId]?.version,
        semanticTombstone:
          snapshot.state.structure.tombstones?.[semanticObjectId],
        recoveredSemanticTombstone:
          recovered.state.structure.tombstones?.[semanticObjectId],
        conflicts: recovered.conflictedOperationIds,
        ambiguous: recovered.ambiguousOperationIds,
      };
      outbox.dispose();
      adapter.dispose();
      await handle.dispose();
      document.destroy();
      return result;
    },
    {
      canvasId,
      fixtureIds: ids,
      initialUpdate,
      objectId,
      pageId,
      revision,
      semanticObjectId,
      sourceId,
    },
  );
  expect(reopened).toEqual({
    quarantine: null,
    outboxIds: operationIds,
    operationIds,
    sourceVersion: 3,
    recoveredSourceVersion: 3,
    semanticTombstone: {
      collection: "objects",
      version: 4,
      entity: expect.objectContaining({
        id: semanticObjectId,
        version: 3,
        geometry: expect.objectContaining({ type: "wall" }),
      }),
    },
    recoveredSemanticTombstone: {
      collection: "objects",
      version: 4,
      entity: expect.objectContaining({
        id: semanticObjectId,
        version: 3,
        geometry: expect.objectContaining({ type: "wall" }),
      }),
    },
    conflicts: [],
    ambiguous: [],
  });
});

test("compacted add undo lineage restores a pending redo after a real IndexedDB realm crash", async ({
  page,
}) => {
  const revision = "00000000-0000-4000-8000-000000000651";
  const objectId = "00000000-0000-4000-8000-000000000652";
  const operationIds = [
    "00000000-0000-4000-8000-000000000653",
    "00000000-0000-4000-8000-000000000654",
    "00000000-0000-4000-8000-000000000655",
  ];
  const initialUpdate = authoritativeFixture(revision, "active");
  await openPreview(page);

  const written = await page.evaluate(
    async ({ fixtureIds, initialUpdate, objectId, operationIds, revision }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const commandsPath = "/app/lukas/lib/drawing-commands.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const commands = await import(commandsPath);
      const baseState = commands.createDrawingDocumentState({
        revisionId: revision,
        layers: [
          {
            id: fixtureIds.layer,
            name: "Work",
            visible: true,
            locked: false,
            systemKind: "work",
            version: 1,
          },
        ],
        objects: [],
      });
      let operationIndex = 0;
      const document = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const handle = await persistence.openDrawingYjsPersistence({
        revisionId: revision,
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
        createId: () => operationIds[operationIndex++],
        now: () =>
          new Date(Date.UTC(2026, 7, 27, 4, operationIndex)).toISOString(),
      });
      const preparedAdd = adapter.prepareLocal({
        type: "add_objects",
        actorId: fixtureIds.actor,
        objects: [
          {
            id: objectId,
            name: "Compacted restore",
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
      });
      const added = preparedAdd.state.operations.at(-1);
      if (!added) throw new Error("Added operation was not recorded.");
      adapter.appendDurableLocal(preparedAdd);
      const undone = commands.undoDrawingCommand(
        adapter.getSnapshot().state,
        fixtureIds.actor,
        {
          createId: () => operationIds[operationIndex++],
          now: () => "2026-08-27T04:01:00.000Z",
        },
      );
      if (!undone || "kind" in undone) throw new Error("Undo conflicted.");
      adapter.appendDurableLocal(adapter.prepareRecordedLocal(undone.operation));
      const redone = commands.redoDrawingCommand(
        adapter.getSnapshot().state,
        fixtureIds.actor,
        {
          createId: () => operationIds[operationIndex++],
          now: () => "2026-08-27T04:02:00.000Z",
        },
      );
      if (!redone || "kind" in redone) throw new Error("Redo conflicted.");
      adapter.appendDurableLocal(adapter.prepareRecordedLocal(redone.operation));
      document.transact(() => {
        document.getMap("serverMeta").set("baseOperationSequence", 2);
        document.getMap("operationStatus").set(operationIds[0], {
          operationId: operationIds[0],
          status: "acked",
          authoritativeSequence: 1,
          resultVersions: added.realizedVersions,
        });
        document.getMap("operationStatus").set(operationIds[1], {
          operationId: operationIds[1],
          status: "acked",
          authoritativeSequence: 2,
          resultVersions: undone.operation.realizedVersions,
        });
      });
      await handle.flush();
      return {
        operationIds: adapter.operations().map(
          (operation: { clientOperationId: string }) =>
            operation.clientOperationId,
        ),
        version: adapter.getSnapshot().state.objects[objectId]?.version,
      };
      // Deliberately leave the first realm open; reload below is the crash.
    },
    { fixtureIds: ids, initialUpdate, objectId, operationIds, revision },
  );
  expect(written).toEqual({ operationIds, version: 3 });

  await page.reload();
  const reopened = await page.evaluate(
    async ({ fixtureIds, initialUpdate, objectId, revision }) => {
      const persistencePath =
        "/app/lukas/lib/drawing-yjs-persistence.client.ts";
      const draftPath = "/app/lukas/lib/drawing-yjs-draft.ts";
      const commandsPath = "/app/lukas/lib/drawing-commands.ts";
      const persistence = await import(persistencePath);
      const draft = await import(draftPath);
      const commands = await import(commandsPath);
      const baseState = commands.createDrawingDocumentState({
        revisionId: revision,
        layers: [
          {
            id: fixtureIds.layer,
            name: "Work",
            visible: true,
            locked: false,
            systemKind: "work",
            version: 1,
          },
        ],
        objects: [],
      });
      const document = persistence.createDrawingYjsDocument(
        Uint8Array.from(initialUpdate),
      );
      const handle = await persistence.openDrawingYjsPersistence({
        revisionId: revision,
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
        baseOperationSequence: 2,
      });
      const snapshot = adapter.getSnapshot();
      const result = {
        quarantine: snapshot.quarantine,
        provisional: snapshot.provisionalConflictOperationIds,
        pending: snapshot.pendingOperationIds,
        version: snapshot.state.objects[objectId]?.version,
      };
      adapter.dispose();
      await handle.dispose();
      document.destroy();
      return result;
    },
    { fixtureIds: ids, initialUpdate, objectId, revision },
  );
  expect(reopened).toEqual({
    quarantine: null,
    provisional: [],
    pending: [operationIds[2]],
    version: 3,
  });
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
