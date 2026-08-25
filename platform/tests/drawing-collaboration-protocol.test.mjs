import assert from "node:assert/strict";
import test from "node:test";

const protocol = await import(
  "../app/lukas/lib/drawing-collaboration-protocol.ts"
).catch(() => null);

const ids = {
  project: "00000000-0000-4000-8000-000000000201",
  revision: "00000000-0000-4000-8000-000000000202",
  actor: "00000000-0000-4000-8000-000000000203",
  operation: "00000000-0000-4000-8000-000000000204",
  layer: "00000000-0000-4000-8000-000000000205",
  lock: "00000000-0000-4000-8000-000000000206",
};

function requireProtocol() {
  assert.ok(protocol, "drawing collaboration protocol must be implemented");
  return protocol;
}

function operation(overrides = {}) {
  return {
    clientOperationId: ids.operation,
    revisionId: ids.revision,
    actorId: ids.actor,
    schemaVersion: 1,
    type: "add_layer",
    baseVersions: {},
    forward: {
      type: "add_layer",
      layer: {
        id: ids.layer,
        name: "Annotations",
        visible: true,
        locked: false,
        version: 1,
      },
    },
    inverse: {},
    createdAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

function drawingObject(id) {
  return {
    id,
    name: "Rectangle",
    layerId: ids.layer,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 10,
      height: 20,
      rotation: 0,
    },
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
    version: 1,
  };
}

test("canonical drawing room names round-trip lower-case UUID scopes only", () => {
  const { drawingRoomName, parseDrawingRoomName } = requireProtocol();
  const room = drawingRoomName(ids.project, ids.revision);

  assert.equal(room, `drawing:${ids.project}:${ids.revision}`);
  assert.deepEqual(parseDrawingRoomName(room), {
    projectId: ids.project,
    revisionId: ids.revision,
  });
  for (const invalid of [
    `drawing:${ids.project.replace("00000000", "A0000000")}:${ids.revision}`,
    `drawing:${ids.project}:${ids.revision}:extra`,
    `drawing:${ids.project}/${ids.revision}`,
    `draft:${ids.project}:${ids.revision}`,
  ]) {
    assert.throws(() => parseDrawingRoomName(invalid));
  }
});

test("operation envelopes accept only the existing canonical drawing operation contract", () => {
  const { DrawingCollaborationOperationSchema } = requireProtocol();
  assert.deepEqual(
    DrawingCollaborationOperationSchema.parse(operation()),
    operation(),
  );

  for (const invalid of [
    { ...operation(), capability: "admin" },
    { ...operation(), quantity: 1 },
    { ...operation(), sourceBytes: "not-allowed" },
    { ...operation(), forward: { ...operation().forward, rate: 1 } },
    { ...operation(), inverse: { unexpected: true } },
    { ...operation(), actorId: "not-a-uuid" },
  ]) {
    assert.equal(
      DrawingCollaborationOperationSchema.safeParse(invalid).success,
      false,
    );
  }
});

test("operation envelopes enforce protocol and bounded operation collections", () => {
  const { DrawingCollaborationOperationSchema, DRAWING_COLLABORATION_LIMITS } =
    requireProtocol();
  assert.equal(
    DrawingCollaborationOperationSchema.safeParse({
      ...operation(),
      schemaVersion: 2,
    }).success,
    false,
  );
  assert.equal(
    DrawingCollaborationOperationSchema.safeParse({
      ...operation(),
      baseVersions: Object.fromEntries(
        Array.from(
          { length: DRAWING_COLLABORATION_LIMITS.maxBaseVersions + 1 },
          (_, index) => [
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            1,
          ],
        ),
      ),
    }).success,
    false,
  );
  assert.equal(
    DrawingCollaborationOperationSchema.safeParse({
      ...operation(),
      forward: {
        type: "delete_objects",
        objectIds: Array.from(
          { length: DRAWING_COLLABORATION_LIMITS.maxActionItems + 1 },
          (_, index) =>
            `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
      },
      inverse: { type: "add_objects", objects: [drawingObject(ids.operation)] },
      type: "delete_objects",
    }).success,
    false,
  );
});

test("history lineage is bounded, paired, canonical, and exact", () => {
  const { DrawingCollaborationOperationSchema } = requireProtocol();
  const history = operation({
    historyAction: "undo",
    originalOperationId: "00000000-0000-4000-8000-000000000207",
  });
  assert.deepEqual(DrawingCollaborationOperationSchema.parse(history), history);
  for (const invalid of [
    { ...operation(), historyAction: "undo" },
    { ...operation(), originalOperationId: ids.layer },
    { ...history, historyAction: "revert" },
    { ...history, historyResult: true },
  ])
    assert.equal(
      DrawingCollaborationOperationSchema.safeParse(invalid).success,
      false,
    );
});

test("server-only metadata and operation status reject client fields and malformed authority", () => {
  const {
    DrawingCollaborationMetaSchema,
    DrawingCollaborationStatusSchema,
    DRAWING_COLLABORATION_SCHEMA_VERSION,
  } = requireProtocol();
  const meta = {
    schemaVersion: DRAWING_COLLABORATION_SCHEMA_VERSION,
    projectId: ids.project,
    revisionId: ids.revision,
    baseSnapshotSha256: "a".repeat(64),
    baseOperationSequence: 0,
    freezeState: "active",
    freezeRequestId: null,
  };
  assert.deepEqual(DrawingCollaborationMetaSchema.parse(meta), meta);
  assert.equal(
    DrawingCollaborationMetaSchema.safeParse({ ...meta, capability: "editor" })
      .success,
    false,
  );

  const status = {
    operationId: ids.operation,
    status: "acked",
    authoritativeSequence: 1,
    resultVersions: { [ids.layer]: 2 },
  };
  assert.deepEqual(DrawingCollaborationStatusSchema.parse(status), status);
  assert.equal(
    DrawingCollaborationStatusSchema.safeParse({
      ...status,
      actorId: ids.actor,
    }).success,
    false,
  );
  assert.equal(
    DrawingCollaborationStatusSchema.safeParse({
      ...status,
      authoritativeSequence: 0,
    }).success,
    false,
  );
});

test("append validation preserves the immutable operation order and accepts only the verified actor", () => {
  const {
    DrawingCollaborationClientAppendSchema,
    drawingRoomName,
    validateDrawingCollaborationAppend,
  } = requireProtocol();
  const first = operation();
  const secondId = "00000000-0000-4000-8000-000000000207";
  const second = operation({ clientOperationId: secondId });
  const current = {
    operationOrder: [ids.operation],
    operations: { [ids.operation]: first },
  };
  const room = drawingRoomName(ids.project, ids.revision);

  assert.ok(
    DrawingCollaborationClientAppendSchema,
    "client writes must be limited to the append-only ledger",
  );
  assert.equal(
    DrawingCollaborationClientAppendSchema.safeParse({
      ...current,
      serverMeta: { projectId: ids.project },
    }).success,
    false,
  );

  assert.deepEqual(
    validateDrawingCollaborationAppend(
      current,
      {
        operationOrder: [ids.operation, secondId],
        operations: { [ids.operation]: first, [secondId]: second },
      },
      ids.actor,
      room,
    ).operationOrder,
    [ids.operation, secondId],
  );
  assert.throws(() =>
    validateDrawingCollaborationAppend(
      current,
      { operationOrder: [], operations: {} },
      ids.actor,
      room,
    ),
  );
  assert.throws(() =>
    validateDrawingCollaborationAppend(
      current,
      {
        operationOrder: [ids.operation],
        operations: { [ids.operation]: operation({ actorId: ids.revision }) },
      },
      ids.actor,
      room,
    ),
  );
  assert.throws(() =>
    validateDrawingCollaborationAppend(
      current,
      {
        operationOrder: [ids.operation, secondId],
        operations: {
          [ids.operation]: first,
          [secondId]: operation({
            clientOperationId: secondId,
            actorId: ids.revision,
          }),
        },
      },
      ids.actor,
      room,
    ),
  );
});

test("same durable operation ID is a convergent idempotent order entry", () => {
  const {
    DrawingCollaborationClientAppendSchema,
    drawingRoomName,
    validateDrawingCollaborationAppend,
  } = requireProtocol();
  const envelope = operation();
  const duplicate = {
    operationOrder: [ids.operation, ids.operation],
    operations: { [ids.operation]: envelope },
  };
  assert.deepEqual(
    DrawingCollaborationClientAppendSchema.parse(duplicate).operationOrder,
    [ids.operation],
  );
  assert.deepEqual(
    validateDrawingCollaborationAppend(
      { operationOrder: [], operations: {} },
      duplicate,
      ids.actor,
      drawingRoomName(ids.project, ids.revision),
    ).operationOrder,
    [ids.operation],
  );
  assert.deepEqual(
    validateDrawingCollaborationAppend(
      {
        operationOrder: [ids.operation],
        operations: { [ids.operation]: envelope },
      },
      duplicate,
      ids.actor,
      drawingRoomName(ids.project, ids.revision),
    ).operationOrder,
    [ids.operation],
  );
});

test("append validation accepts a bounded same-actor catch-up suffix", () => {
  const { drawingRoomName, validateDrawingCollaborationAppend } =
    requireProtocol();
  const secondId = "00000000-0000-4000-8000-000000000207";
  const thirdId = "00000000-0000-4000-8000-000000000208";
  const first = operation();
  const second = operation({ clientOperationId: secondId });
  const third = operation({ clientOperationId: thirdId });

  assert.deepEqual(
    validateDrawingCollaborationAppend(
      {
        operationOrder: [ids.operation],
        operations: { [ids.operation]: first },
      },
      {
        operationOrder: [ids.operation, secondId, thirdId],
        operations: {
          [ids.operation]: first,
          [secondId]: second,
          [thirdId]: third,
        },
      },
      ids.actor,
      drawingRoomName(ids.project, ids.revision),
    ).operationOrder,
    [ids.operation, secondId, thirdId],
  );
  assert.throws(() =>
    validateDrawingCollaborationAppend(
      {
        operationOrder: [ids.operation],
        operations: { [ids.operation]: first },
      },
      {
        operationOrder: [ids.operation, secondId, thirdId],
        operations: {
          [ids.operation]: first,
          [secondId]: operation({
            clientOperationId: secondId,
            actorId: ids.revision,
          }),
          [thirdId]: third,
        },
      },
      ids.actor,
      drawingRoomName(ids.project, ids.revision),
    ),
  );
});

test("append validation binds every new envelope to the canonical room revision", () => {
  const { drawingRoomName, validateDrawingCollaborationAppend } =
    requireProtocol();
  const otherRevision = "00000000-0000-4000-8000-000000000299";

  assert.throws(() =>
    validateDrawingCollaborationAppend(
      { operationOrder: [], operations: {} },
      {
        operationOrder: [ids.operation],
        operations: {
          [ids.operation]: operation({ revisionId: otherRevision }),
        },
      },
      ids.actor,
      drawingRoomName(ids.project, ids.revision),
    ),
  );
});

test("awareness is bounded, strict, and carries only ephemeral drawing state", () => {
  const { DrawingAwarenessStateSchema, DRAWING_COLLABORATION_LIMITS } =
    requireProtocol();
  const awareness = {
    user: { id: ids.actor, displayName: "Kim", color: "#112233" },
    pageId: null,
    canvasId: null,
    cursorWorld: { x: -12.5, y: 33.25 },
    selectedIds: [ids.layer],
    activeTool: "select",
    softLocks: [
      { entityId: ids.layer, leaseId: ids.lock, expiresAt: 1_800_000_000_000 },
    ],
  };
  assert.deepEqual(DrawingAwarenessStateSchema.parse(awareness), awareness);
  assert.equal(
    DrawingAwarenessStateSchema.safeParse({
      ...awareness,
      approval: "approved",
    }).success,
    false,
  );
  assert.equal(
    DrawingAwarenessStateSchema.safeParse({
      ...awareness,
      selectedIds: Array.from(
        { length: DRAWING_COLLABORATION_LIMITS.maxSelectedIds + 1 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
    }).success,
    false,
  );
  assert.equal(
    DrawingAwarenessStateSchema.safeParse({
      ...awareness,
      softLocks: Array.from(
        { length: DRAWING_COLLABORATION_LIMITS.maxSoftLocks + 1 },
        (_, index) => ({
          entityId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          leaseId: `00000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`,
          expiresAt: 1_800_000_000_000,
        }),
      ),
    }).success,
    false,
  );
});
