import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDrawingIfcFocusRequest,
  createDrawingIfcFocusState,
  createDrawingIfcLoadIndex,
  createDrawingIfcSourceIndex,
  matchDrawingObjectsForIfcSelection,
  nextDrawingIfcLoadGeneration,
  resolveDrawingIfcFocus,
} from "../app/lukas/lib/drawing-source-links.ts";

const ids = {
  object1: "00000000-0000-4000-8000-000000000001",
  object2: "00000000-0000-4000-8000-000000000002",
  source1: "00000000-0000-4000-8000-000000000003",
  source2: "00000000-0000-4000-8000-000000000004",
  revision: "00000000-0000-4000-8000-000000000005",
  file1: "00000000-0000-4000-8000-000000000006",
  file2: "00000000-0000-4000-8000-000000000007",
};
const sha1 = "a".repeat(64);
const sha2 = "b".repeat(64);
const globalId = "3ABCdefghijklmnopqrstu";

function source(overrides = {}) {
  return {
    id: ids.source1,
    objectId: ids.object1,
    revisionId: ids.revision,
    sourceFileId: ids.file1,
    sourceSha256: sha1,
    sourceKind: "ifc_element",
    ifcGlobalId: globalId,
    elementId: "42",
    camera: null,
    version: 1,
    ...overrides,
  };
}

test("IFC user picks resolve to unique, ambiguous, or no drawing match without guessing", () => {
  const index = createDrawingIfcSourceIndex({
    [ids.source1]: source(),
    [ids.source2]: source({ id: ids.source2, objectId: ids.object2 }),
  });
  assert.deepEqual(
    matchDrawingObjectsForIfcSelection(index, {
      origin: "user",
      sourceFileId: ids.file1,
      sourceSha256: sha1,
      ifcGlobalId: globalId,
    }),
    { status: "ambiguous", objectIds: [ids.object1, ids.object2] },
  );

  const unique = createDrawingIfcSourceIndex({ [ids.source1]: source() });
  assert.deepEqual(
    matchDrawingObjectsForIfcSelection(unique, {
      origin: "user",
      sourceFileId: ids.file1,
      sourceSha256: sha1,
      ifcGlobalId: globalId,
    }),
    { status: "unique", objectId: ids.object1 },
  );
  assert.deepEqual(
    matchDrawingObjectsForIfcSelection(unique, {
      origin: "user",
      sourceFileId: ids.file2,
      sourceSha256: sha1,
      ifcGlobalId: globalId,
    }),
    { status: "no_match" },
  );
  assert.deepEqual(
    matchDrawingObjectsForIfcSelection(unique, {
      origin: "programmatic",
      sourceFileId: ids.file1,
      sourceSha256: sha1,
      ifcGlobalId: globalId,
    }),
    { status: "ignored_programmatic" },
  );
});

test("IFC reverse focus excludes stale SHA links before unique or ambiguous matching", () => {
  const index = createDrawingIfcSourceIndex({
    [ids.source1]: source(),
    [ids.source2]: source({
      id: ids.source2,
      objectId: ids.object2,
      sourceSha256: sha2,
    }),
  });
  assert.deepEqual(
    matchDrawingObjectsForIfcSelection(index, {
      origin: "user",
      sourceFileId: ids.file1,
      sourceSha256: sha1,
      ifcGlobalId: globalId,
    }),
    { status: "unique", objectId: ids.object1 },
  );
  assert.deepEqual(
    matchDrawingObjectsForIfcSelection(index, {
      origin: "user",
      sourceFileId: ids.file1,
      sourceSha256: "c".repeat(64),
      ifcGlobalId: globalId,
    }),
    { status: "no_match" },
  );
});

test("focus requires exact file identity unless a verified revision identity confirms GlobalId", () => {
  const linked = source();
  const sameLoad = createDrawingIfcLoadIndex({
    sourceFileId: ids.file1,
    sourceSha256: sha1,
    generation: 7,
    elements: [
      { expressId: 42, ifcGlobalId: "2ABCdefghijklmnopqrstu" },
      { expressId: 99, ifcGlobalId: globalId },
    ],
  });
  assert.deepEqual(resolveDrawingIfcFocus(linked, sameLoad, 7), {
    status: "matched",
    expressId: 99,
    matchedBy: "global_id",
  });

  const missingGlobal = createDrawingIfcLoadIndex({
    sourceFileId: ids.file1,
    sourceSha256: sha1,
    generation: 7,
    elements: [{ expressId: 42, ifcGlobalId: null }],
  });
  assert.deepEqual(resolveDrawingIfcFocus(linked, missingGlobal, 7), {
    status: "matched",
    expressId: 42,
    matchedBy: "same_sha_express_id",
  });
  assert.deepEqual(
    resolveDrawingIfcFocus(
      linked,
      createDrawingIfcLoadIndex({
        sourceFileId: ids.file1,
        sourceSha256: sha2,
        generation: 7,
        elements: [{ expressId: 42, ifcGlobalId: null }],
      }),
      7,
    ),
    { status: "no_match" },
  );

  const sameFileWrongSha = createDrawingIfcLoadIndex({
    sourceFileId: ids.file1,
    sourceSha256: sha2,
    generation: 7,
    elements: [{ expressId: 99, ifcGlobalId: globalId }],
  });
  assert.deepEqual(resolveDrawingIfcFocus(linked, sameFileWrongSha, 7), {
    status: "no_match",
  });

  const successor = createDrawingIfcLoadIndex({
    sourceFileId: ids.file2,
    sourceSha256: sha2,
    generation: 8,
    elements: [{ expressId: 314, ifcGlobalId: globalId }],
  });
  assert.deepEqual(resolveDrawingIfcFocus(linked, successor, 8), {
    status: "no_match",
  });
  assert.deepEqual(
    resolveDrawingIfcFocus(linked, successor, 8, {
      previousFileId: ids.file1,
      previousSha256: sha1,
      currentFileId: ids.file2,
      currentSha256: sha2,
      ifcGlobalId: globalId,
    }),
    {
      status: "matched",
      expressId: 314,
      matchedBy: "verified_revision_global_id",
    },
  );
  assert.deepEqual(
    resolveDrawingIfcFocus(linked, successor, 8, {
      previousFileId: ids.file1,
      previousSha256: sha1,
      currentFileId: ids.file2,
      currentSha256: sha2,
      ifcGlobalId: "2ABCdefghijklmnopqrstu",
    }),
    { status: "no_match" },
  );
});

test("controlled request IDs and load generations suppress stale and repeated focus", () => {
  let state = createDrawingIfcFocusState(7);
  const applied = applyDrawingIfcFocusRequest(state, {
    requestId: "focus-1",
    generation: 7,
    requestGeneration: 1,
    expressId: 99,
  });
  assert.deepEqual(applied.effect, {
    origin: "programmatic",
    expressId: 99,
    requestId: "focus-1",
    generation: 7,
    requestGeneration: 1,
  });
  state = applied.state;
  assert.equal(
    applyDrawingIfcFocusRequest(state, {
      requestId: "focus-1",
      generation: 7,
      requestGeneration: 1,
      expressId: 42,
    }).status,
    "ignored_duplicate",
  );
  assert.equal(
    applyDrawingIfcFocusRequest(state, {
      requestId: "focus-old",
      generation: 6,
      requestGeneration: 2,
      expressId: 42,
    }).status,
    "ignored_stale",
  );

  state = nextDrawingIfcLoadGeneration(state, 8);
  assert.deepEqual(state, {
    generation: 8,
    requestGeneration: 0,
    handledRequestId: null,
    focusedExpressId: null,
  });
  assert.deepEqual(
    resolveDrawingIfcFocus(
      source(),
      createDrawingIfcLoadIndex({
        sourceFileId: ids.file1,
        sourceSha256: sha1,
        generation: 8,
        elements: [{ expressId: 42, ifcGlobalId: globalId }],
      }),
      7,
    ),
    { status: "stale_generation" },
  );
});

test("same-load request generations prevent out-of-order A to B to A focus", () => {
  let state = createDrawingIfcFocusState(9);
  const first = applyDrawingIfcFocusRequest(state, {
    requestId: "focus-A",
    generation: 9,
    requestGeneration: 1,
    expressId: 100,
  });
  assert.equal(first.status, "applied");
  state = first.state;
  const newer = applyDrawingIfcFocusRequest(state, {
    requestId: "focus-B",
    generation: 9,
    requestGeneration: 2,
    expressId: 200,
  });
  assert.equal(newer.status, "applied");
  state = newer.state;

  const olderCompletion = applyDrawingIfcFocusRequest(state, {
    requestId: "focus-A",
    generation: 9,
    requestGeneration: 1,
    expressId: 100,
  });
  assert.equal(olderCompletion.status, "ignored_stale_request");
  assert.equal(olderCompletion.state.focusedExpressId, 200);

  const newest = applyDrawingIfcFocusRequest(state, {
    requestId: "focus-C",
    generation: 9,
    requestGeneration: 3,
    expressId: 300,
  });
  assert.equal(newest.status, "applied");
  assert.equal(newest.state.focusedExpressId, 300);
});
