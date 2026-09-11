import assert from "node:assert/strict";
import test from "node:test";
import {
  nativeDwgSessionKey,
  readNativeDwgSession,
  writeNativeDwgSession,
  beginNativeDwgSession,
} from "../app/lukas/lib/drawing-native-dwg-import-session.ts";

const uuid = (n) => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = {
  actorId: uuid(1),
  projectId: uuid(2),
  documentId: uuid(3),
  revisionId: uuid(4),
  canvasId: uuid(5),
};
const source = { id: uuid(6), sha256: "a".repeat(64) };
const storage = () => {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
};
test("request pointer is durable before network and a lost response reuses identity", () => {
  const store = storage();
  const first = beginNativeDwgSession(store, scope, source, "4", () => uuid(7));
  assert.deepEqual(readNativeDwgSession(store, scope), first);
  assert.equal(
    beginNativeDwgSession(store, scope, source, "4", () => uuid(8)).requestId,
    first.requestId,
  );
  writeNativeDwgSession(store, { ...first, jobId: uuid(9) });
  assert.equal(readNativeDwgSession(store, scope).jobId, uuid(9));
});
test("each actor/project/document/revision/canvas is isolated", () => {
  const store = storage();
  beginNativeDwgSession(store, scope, source, "", () => uuid(7));
  for (const field of Object.keys(scope))
    assert.equal(
      readNativeDwgSession(store, { ...scope, [field]: uuid(99) }),
      null,
    );
});
test("source identity and units create another request; explicit failed retry can too", () => {
  const store = storage();
  beginNativeDwgSession(store, scope, source, "4", () => uuid(7));
  assert.equal(
    beginNativeDwgSession(store, scope, source, "6", () => uuid(8)).requestId,
    uuid(8),
  );
  assert.equal(
    beginNativeDwgSession(
      store,
      scope,
      { ...source, sha256: "b".repeat(64) },
      "6",
      () => uuid(9),
    ).requestId,
    uuid(9),
  );
  assert.equal(
    beginNativeDwgSession(store, scope, { ...source, id: uuid(10) }, "6", () =>
      uuid(11),
    ).requestId,
    uuid(11),
  );
  assert.equal(
    beginNativeDwgSession(
      store,
      scope,
      { ...source, id: uuid(10) },
      "6",
      () => uuid(12),
      true,
    ).requestId,
    uuid(12),
  );
});
test("storage failures surface, preventing request without a durable pointer", () => {
  assert.throws(
    () =>
      beginNativeDwgSession(
        {
          getItem: () => null,
          setItem: () => {
            throw Error("quota");
          },
        },
        scope,
        source,
        "4",
        () => uuid(7),
      ),
    /저장/,
  );
  assert.throws(
    () =>
      readNativeDwgSession(
        {
          getItem: () => {
            throw Error("denied");
          },
        },
        scope,
      ),
    /저장/,
  );
});
test("malformed, cross-scope, unversioned and extra payload pointers are ignored", () => {
  const store = storage();
  const pointer = beginNativeDwgSession(store, scope, source, "4", () =>
    uuid(7),
  );
  for (const value of [
    "{",
    "null",
    JSON.stringify({ ...pointer, version: 2 }),
    JSON.stringify({ ...pointer, actorId: uuid(9) }),
    JSON.stringify({ ...pointer, objects: [] }),
    JSON.stringify({ ...pointer, unitCode: "3" }),
    JSON.stringify({ ...pointer, sourceSha256: "bad" }),
  ]) {
    store.setItem(nativeDwgSessionKey(scope), value);
    assert.equal(readNativeDwgSession(store, scope), null);
  }
});
