import assert from "node:assert/strict";
import test from "node:test";

const awareness = await import("../app/lukas/lib/drawing-awareness.ts").catch(
  () => null,
);

const ids = {
  me: "00000000-0000-4000-8000-000000000701",
  peer: "00000000-0000-4000-8000-000000000702",
  page: "00000000-0000-4000-8000-000000000703",
  otherPage: "00000000-0000-4000-8000-000000000704",
  canvas: "00000000-0000-4000-8000-000000000705",
  otherCanvas: "00000000-0000-4000-8000-000000000706",
  objectA: "00000000-0000-4000-8000-000000000707",
  objectB: "00000000-0000-4000-8000-000000000708",
  lease: "00000000-0000-4000-8000-000000000709",
};

function requireAwareness() {
  assert.ok(awareness, "drawing awareness must be implemented");
  return awareness;
}

function peerState(overrides = {}) {
  const { drawingAwarenessColor } = requireAwareness();
  return {
    user: {
      id: ids.peer,
      displayName: "김도윤",
      color: drawingAwarenessColor(ids.peer),
    },
    pageId: ids.page,
    canvasId: ids.canvas,
    cursorWorld: { x: -12.5, y: 230.25 },
    selectedIds: [ids.objectB, ids.objectA],
    activeTool: "select",
    softLocks: [
      { entityId: ids.objectA, leaseId: ids.lease, expiresAt: 10_000 },
    ],
    ...overrides,
  };
}

test("publisher canonicalizes world state and sends at most once per frame", () => {
  const { createDrawingAwarenessPublisher, drawingAwarenessColor } =
    requireAwareness();
  const frames = [];
  const published = [];
  const publisher = createDrawingAwarenessPublisher({
    user: { id: ids.me, displayName: "나" },
    publish: (state) => published.push(state),
    requestFrame: (callback) => (frames.push(callback), frames.length),
    cancelFrame() {},
  });

  publisher.update({
    pageId: ids.page,
    canvasId: ids.canvas,
    cursorWorld: { x: 1, y: 2 },
    selectedIds: [ids.objectB, ids.objectA, ids.objectB],
    activeTool: "line",
    softLocks: [],
  });
  publisher.update({
    pageId: ids.page,
    canvasId: ids.canvas,
    cursorWorld: { x: 3, y: 4 },
    selectedIds: [ids.objectA, ids.objectB],
    activeTool: "line",
    softLocks: [],
  });
  assert.equal(frames.length, 1);
  frames.shift()(16);
  assert.deepEqual(published, [
    {
      user: {
        id: ids.me,
        displayName: "나",
        color: drawingAwarenessColor(ids.me),
      },
      pageId: ids.page,
      canvasId: ids.canvas,
      cursorWorld: { x: 3, y: 4 },
      selectedIds: [ids.objectA, ids.objectB],
      activeTool: "line",
      softLocks: [],
    },
  ]);

  publisher.update({
    pageId: ids.page,
    canvasId: ids.canvas,
    cursorWorld: { x: 3, y: 4 },
    selectedIds: [ids.objectB, ids.objectA],
    activeTool: "line",
    softLocks: [],
  });
  frames.shift()(32);
  assert.equal(published.length, 1, "unchanged canonical state is suppressed");
  publisher.clear();
  assert.equal(published.at(-1), null, "authorization downgrade removes state");
  publisher.update({
    pageId: ids.page,
    canvasId: ids.canvas,
    cursorWorld: null,
    selectedIds: [],
    activeTool: "select",
    softLocks: [],
  });
  frames.shift()(48);
  assert.equal(published.length, 3, "a later authorized state can reconnect");
  publisher.dispose();
  assert.equal(published.at(-1), null, "dispose removes local Awareness");
});

test("peer parser excludes only the provider-owned local client and retains a second client for the same verified user", () => {
  const { parseDrawingAwarenessPeers, drawingAwarenessColor } =
    requireAwareness();
  const secondBrowser = peerState({
    user: {
      id: ids.me,
      displayName: "나",
      color: drawingAwarenessColor(ids.me),
    },
  });
  const peers = parseDrawingAwarenessPeers(
    new Map([
      [1, secondBrowser],
      [2, secondBrowser],
    ]),
    {
      localClientId: 1,
      pageId: ids.page,
      canvasId: ids.canvas,
      now: 1,
    },
  );
  assert.deepEqual(
    peers.map((peer) => [peer.clientId, peer.user.id, peer.user.color]),
    [[2, ids.me, drawingAwarenessColor(ids.me)]],
  );
  assert.deepEqual(peers[0].selectedIds, [ids.objectA, ids.objectB]);
  assert.equal(peers[0].softLocks[0].entityId, ids.objectA);
});

test("peer parser rejects unknown, malformed, color-spoofed, and oversized states", () => {
  const { parseDrawingAwarenessPeers } = requireAwareness();
  const valid = peerState();
  assert.deepEqual(
    parseDrawingAwarenessPeers(new Map([[2, valid]]), {
      localClientId: 1,
      pageId: ids.page,
      canvasId: ids.canvas,
      now: 1,
    }).map((peer) => peer.user.displayName),
    ["김도윤"],
  );

  const badColor = structuredClone(valid);
  badColor.user.color = "#ffffff";
  const unknown = { ...valid, capability: "admin" };
  const oversized = {
    ...valid,
    selectedIds: Array.from({ length: 101 }, () => ids.objectA),
  };
  assert.deepEqual(
    parseDrawingAwarenessPeers(
      new Map([
        [2, badColor],
        [3, unknown],
        [4, oversized],
        [5, { ...valid, cursorWorld: { x: Infinity, y: 0 } }],
      ]),
      {
        localClientId: 1,
        pageId: ids.page,
        canvasId: ids.canvas,
        now: 1,
      },
    ),
    [],
  );
});

test("lock subscribers do not rerender for cursor-only Awareness changes", () => {
  const { createDrawingAwarenessPeerStore } = requireAwareness();
  const store = createDrawingAwarenessPeerStore();
  let allChanges = 0;
  let lockChanges = 0;
  store.subscribe(() => allChanges++);
  store.subscribeLocks(() => lockChanges++);
  const first = { ...peerState(), clientId: 2 };
  store.replace([first]);
  store.replace([
    { ...first, cursorWorld: { x: first.cursorWorld.x + 1, y: 230.25 } },
  ]);
  assert.equal(allChanges, 2);
  assert.equal(lockChanges, 1);
});

test("workspace command gating blocks only live locked drawing and block targets", () => {
  const { drawingCommandSoftLockConflict, drawingSelectionSoftLockConflict } =
    requireAwareness();
  const peers = [{ ...peerState(), clientId: 2 }];
  assert.equal(
    drawingSelectionSoftLockConflict([ids.objectA], peers, 1).lock.entityId,
    ids.objectA,
    "copy and duplicate selection affordances share the same conflict gate",
  );
  assert.equal(drawingSelectionSoftLockConflict([ids.objectB], peers, 1), null);
  assert.equal(
    drawingCommandSoftLockConflict(
      {
        type: "delete_objects",
        actorId: ids.me,
        objectIds: [ids.objectA],
      },
      peers,
      1,
    ).lock.entityId,
    ids.objectA,
  );
  assert.equal(
    drawingCommandSoftLockConflict(
      {
        type: "update_objects",
        actorId: ids.me,
        updates: [{ objectId: ids.objectA, patch: { name: "잠김" } }],
      },
      peers,
      1,
    ).lock.entityId,
    ids.objectA,
  );
  assert.equal(
    drawingCommandSoftLockConflict(
      {
        type: "mutate_structure",
        actorId: ids.me,
        actions: [
          {
            kind: "delete_block_instance",
            id: ids.objectA,
            baseVersion: 1,
          },
        ],
      },
      peers,
      1,
    ).lock.entityId,
    ids.objectA,
  );
  assert.equal(
    drawingCommandSoftLockConflict(
      {
        type: "delete_objects",
        actorId: ids.me,
        objectIds: [ids.objectB],
      },
      peers,
      1,
    ),
    null,
  );
  assert.equal(
    drawingCommandSoftLockConflict(
      {
        type: "delete_objects",
        actorId: ids.me,
        objectIds: [ids.objectA],
      },
      peers,
      10_000,
    ),
    null,
  );
});

test("peer views filter cursor, selection, and locks to the active canvas", () => {
  const { parseDrawingAwarenessPeers } = requireAwareness();
  const peers = parseDrawingAwarenessPeers(
    new Map([
      [2, peerState()],
      [3, peerState({ canvasId: ids.otherCanvas })],
      [4, peerState({ pageId: ids.otherPage })],
    ]),
    {
      localClientId: 1,
      pageId: ids.page,
      canvasId: ids.canvas,
      now: 1,
    },
  );
  assert.equal(peers.length, 3, "participants remain visible across canvases");
  assert.deepEqual(peers[0].selectedIds, [ids.objectA, ids.objectB]);
  assert.deepEqual(peers[0].cursorWorld, { x: -12.5, y: 230.25 });
  for (const peer of peers.slice(1)) {
    assert.equal(peer.cursorWorld, null);
    assert.deepEqual(peer.selectedIds, []);
    assert.deepEqual(peer.softLocks, []);
  }
});

test("deterministic collaborator colors are stable and readable on dark canvas", () => {
  const { drawingAwarenessColor, drawingAwarenessContrastRatio } =
    requireAwareness();
  assert.equal(
    drawingAwarenessColor(ids.peer),
    drawingAwarenessColor(ids.peer),
  );
  assert.notEqual(
    drawingAwarenessColor(ids.peer),
    drawingAwarenessColor(ids.me),
  );
  assert.ok(
    drawingAwarenessContrastRatio(drawingAwarenessColor(ids.peer), "#020617") >=
      4.5,
  );
});

test("soft-lock lease acquires, renews, releases, and expires within ten seconds", () => {
  const { createDrawingSoftLockLease } = requireAwareness();
  let now = 1_000;
  const changes = [];
  const lease = createDrawingSoftLockLease({
    now: () => now,
    createId: () => ids.lease,
    onChange: (locks) => changes.push(locks),
  });
  assert.deepEqual(lease.acquire(ids.objectA), {
    entityId: ids.objectA,
    leaseId: ids.lease,
    expiresAt: 11_000,
  });
  now = 3_000;
  assert.equal(lease.renew()?.expiresAt, 13_000);
  now = 13_001;
  assert.equal(lease.current(), null);
  assert.deepEqual(changes.at(-1), []);

  lease.acquire(ids.objectB);
  lease.release();
  assert.equal(lease.current(), null);
});

test("remote locks are advisory UI conflicts and never grant or replace authority", () => {
  const { drawingSoftLockConflict } = requireAwareness();
  const peers = [{ clientId: 2, ...peerState() }];
  const conflict = drawingSoftLockConflict(ids.objectA, peers, 2_000);
  assert.equal(conflict?.user.displayName, "김도윤");
  assert.equal(drawingSoftLockConflict(ids.objectB, peers, 2_000), null);
  assert.equal(drawingSoftLockConflict(ids.objectA, peers, 20_000), null);
  assert.equal(conflict?.advisory, true);
  assert.equal("canWrite" in conflict, false);
});
