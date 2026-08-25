import { expect, test } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace";
const fakeSupabase = "http://127.0.0.1:54321";

test("revision-scoped Yjs drafts recover 100 offline operations before network", async ({
  page,
}) => {
  const fakeRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(fakeSupabase))
      fakeRequests.push(request.url());
  });
  await page.goto(previewPath);

  const result = await page.evaluate(async () => {
    const persistencePath = "/app/lukas/lib/drawing-yjs-persistence.client.ts";
    const persistence = await import(persistencePath);
    const revision = "00000000-0000-4000-8000-000000000602";
    const otherRevision = "00000000-0000-4000-8000-000000000603";
    const first = persistence.createDrawingYjsDocument();
    const firstHandle = await persistence.openDrawingYjsPersistence({
      revisionId: revision,
      document: first,
    });
    if (!firstHandle) throw new Error("Browser persistence did not open.");
    await firstHandle.whenSynced();
    const events = ["local-synced"];
    for (let index = 0; index < 100; index += 1) {
      const operationId = `00000000-0000-4000-8000-${String(index + 700).padStart(12, "0")}`;
      first.transact(() => {
        first.getArray("operationOrder").push([operationId]);
        first.getMap("operations").set(operationId, {
          clientOperationId: operationId,
          objectId: `object-${index}`,
          offlineMinute: Math.floor(index / 20),
        });
      });
    }
    await firstHandle.flush();
    await firstHandle.dispose();

    const reopened = persistence.createDrawingYjsDocument();
    const reopenedHandle = await persistence.openDrawingYjsPersistence({
      revisionId: revision,
      document: reopened,
    });
    if (!reopenedHandle) throw new Error("Browser persistence did not reopen.");
    await reopenedHandle.whenSynced();
    events.push("network-enabled");
    const order = reopened.getArray("operationOrder").toArray();
    const operationIds = [...reopened.getMap("operations").keys()];
    const names = [
      persistence.drawingYjsPersistenceName(revision),
      persistence.drawingYjsPersistenceName(otherRevision),
    ];
    await reopenedHandle.dispose();
    return {
      events,
      names,
      order,
      operationIds,
      objects: operationIds.map(
        (id) => reopened.getMap("operations").get(id).objectId,
      ),
    };
  });

  expect(result.events).toEqual(["local-synced", "network-enabled"]);
  expect(result.names[0]).not.toBe(result.names[1]);
  expect(result.order).toHaveLength(100);
  expect(new Set(result.order).size).toBe(100);
  expect(new Set(result.operationIds)).toEqual(new Set(result.order));
  expect(new Set(result.objects).size).toBe(100);
  expect(fakeRequests).toEqual([]);
});

test("version changes close safely and frozen recovery evidence survives disposal", async ({
  page,
}) => {
  await page.goto(previewPath);
  const result = await page.evaluate(async () => {
    const persistencePath = "/app/lukas/lib/drawing-yjs-persistence.client.ts";
    const persistence = await import(persistencePath);
    const revision = "00000000-0000-4000-8000-000000000604";
    const first = persistence.createDrawingYjsDocument();
    const firstHandle = await persistence.openDrawingYjsPersistence({
      revisionId: revision,
      document: first,
    });
    if (!firstHandle) throw new Error("Browser persistence did not open.");
    await firstHandle.whenSynced();
    first.transact(() => {
      first.getMap("serverMeta").set("freezeState", "frozen");
      first.getMap("recoveryEvidence").set("unsent", ["operation-1"]);
    });
    await firstHandle.flush();

    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(firstHandle.name, 2);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = () => undefined;
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const closedByVersionChange = firstHandle.closed;
    first
      .getMap("recoveryEvidence")
      .set("afterVersionChange", "must-not-persist");
    await new Promise((resolve) => setTimeout(resolve, 0));
    upgraded.close();
    await firstHandle.dispose();

    const recovered = persistence.createDrawingYjsDocument();
    const recoveredHandle = await persistence.openDrawingYjsPersistence({
      revisionId: revision,
      document: recovered,
    });
    if (!recoveredHandle)
      throw new Error("Browser persistence did not reopen.");
    await recoveredHandle.whenSynced();
    const freezeState = recovered.getMap("serverMeta").get("freezeState");
    const evidence = recovered.getMap("recoveryEvidence").get("unsent");
    const postCloseWrite = recovered
      .getMap("recoveryEvidence")
      .get("afterVersionChange");
    await recoveredHandle.dispose();
    return { closedByVersionChange, freezeState, evidence, postCloseWrite };
  });

  expect(result).toEqual({
    closedByVersionChange: true,
    freezeState: "frozen",
    evidence: ["operation-1"],
    postCloseWrite: undefined,
  });
});
