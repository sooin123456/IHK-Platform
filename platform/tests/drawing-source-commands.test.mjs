import assert from "node:assert/strict";
import test from "node:test";

import {
  applyDrawingCommand,
  copyDrawingSelection,
  createDrawingDocumentState,
  duplicateDrawingSelection,
  redoDrawingCommand,
  revertDrawingOperation,
  undoDrawingCommand,
} from "../app/lukas/lib/drawing-commands.ts";
import { deleteDrawingObjectsWithReferencesCommand } from "../app/lukas/lib/drawing-properties.ts";
import { recoverPendingDrawingState } from "../app/lukas/lib/drawing-outbox.ts";
import {
  canMutateDrawingObjectSources,
  linkDrawingIfcSourceCommand,
  linkDrawingPdfRegionSourceCommand,
  unlinkDrawingObjectSourceCommand,
} from "../app/lukas/lib/drawing-source-links.ts";
import { DrawingOperationInputSchema } from "../app/lukas/lib/drawing-workspace.types.ts";

const ids = Object.fromEntries(
  [
    "revision",
    "page",
    "canvas",
    "layer",
    "object",
    "source",
    "source2",
    "file",
    "ifcFile",
    "actor",
    "otherActor",
    "addOperation",
    "linkOperation",
    "unlinkOperation",
    "deleteOperation",
    "undoOperation",
    "redoOperation",
    "duplicate",
    "otherObject",
  ].map((name, index) => [
    name,
    `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  ]),
);

const sha = "a".repeat(64);
const style = { stroke: "#112233", strokeWidth: 2, fill: null };

function object() {
  return {
    id: ids.object,
    name: "Evidence target",
    layerId: ids.layer,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 20,
      height: 10,
      rotation: 0,
    },
    style,
    version: 1,
  };
}

function source(overrides = {}) {
  return {
    id: ids.source,
    objectId: ids.object,
    revisionId: ids.revision,
    sourceFileId: ids.file,
    sourceSha256: sha,
    sourceKind: "pdf_region",
    pdfPageNumber: 2,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
    version: 1,
    ...overrides,
  };
}

function state(sources = {}) {
  return createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      pages: {
        [ids.page]: {
          id: ids.page,
          revisionId: ids.revision,
          name: "A1",
          sortOrder: 0,
          version: 1,
        },
      },
      canvases: {
        [ids.canvas]: {
          id: ids.canvas,
          pageId: ids.page,
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
        [ids.layer]: {
          id: ids.layer,
          name: "Work",
          visible: true,
          locked: false,
          systemKind: "work",
          canvasId: ids.canvas,
          sortOrder: 0,
          version: 1,
        },
      },
      objects: { [ids.object]: object() },
      sources,
      styles: {},
      blocks: {},
      blockInstances: {},
      propertySchemas: {},
      propertyValues: {},
      tables: {},
    },
  });
}

function environment(...operationIds) {
  let index = 0;
  return {
    createId: () => operationIds[index++],
    now: () => "2026-08-27T00:00:00.000Z",
  };
}

test("pure PDF and IFC link commands emit only one exact mutate_structure put_source", () => {
  const base = state();
  const pdf = linkDrawingPdfRegionSourceCommand(base, ids.actor, ids.object, {
    id: ids.source,
    sourceFileId: ids.file,
    sourceSha256: sha,
    pdfPageNumber: 2,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.4,
  });
  assert.deepEqual(pdf, {
    type: "mutate_structure",
    actorId: ids.actor,
    actions: [{ kind: "put_source", entity: source(), baseVersion: null }],
  });

  const ifc = linkDrawingIfcSourceCommand(base, ids.actor, ids.object, {
    id: ids.source2,
    sourceFileId: ids.ifcFile,
    sourceSha256: "b".repeat(64),
    ifcGlobalId: "3ABCdefghijklmnopqrstu",
    elementId: "42",
    camera: { position: [1.1234567, 2, 3], target: [4, 5, 6] },
  });
  assert.deepEqual(ifc.actions, [
    {
      kind: "put_source",
      baseVersion: null,
      entity: {
        id: ids.source2,
        objectId: ids.object,
        revisionId: ids.revision,
        sourceFileId: ids.ifcFile,
        sourceSha256: "b".repeat(64),
        sourceKind: "ifc_element",
        ifcGlobalId: "3ABCdefghijklmnopqrstu",
        elementId: "42",
        camera: { position: [1.123457, 2, 3], target: [4, 5, 6] },
        version: 1,
      },
    },
  ]);

  const applied = applyDrawingCommand(
    base,
    pdf,
    environment(ids.linkOperation),
  );
  assert.deepEqual(applied.state.structure.sources, {
    [ids.source]: source(),
  });
  assert.deepEqual(applied.operation.baseVersions, {});
  assert.deepEqual(applied.operation.resultVersions, { [ids.source]: 1 });
  assert.deepEqual(applied.operation.inverse, {
    type: "mutate_structure",
    actions: [{ kind: "delete_source", id: ids.source, baseVersion: 1 }],
  });
  assert.equal(
    DrawingOperationInputSchema.safeParse(applied.operation).success,
    true,
  );
});

test("unlink uses the current source base and undo redo preserve exact evidence", () => {
  const initial = state({ [ids.source]: source() });
  const command = unlinkDrawingObjectSourceCommand(
    initial,
    ids.actor,
    ids.source,
  );
  assert.deepEqual(command.actions, [
    { kind: "delete_source", id: ids.source, baseVersion: 1 },
  ]);
  const unlinked = applyDrawingCommand(
    initial,
    command,
    environment(ids.unlinkOperation),
  );
  assert.deepEqual(unlinked.state.structure.sources, {});
  const undone = undoDrawingCommand(
    unlinked.state,
    ids.actor,
    environment(ids.undoOperation),
  );
  assert.ok(undone && !("kind" in undone));
  assert.deepEqual(undone.state.structure.sources[ids.source], {
    ...source(),
    version: 3,
  });
  const redone = redoDrawingCommand(
    undone.state,
    ids.actor,
    environment(ids.redoOperation),
  );
  assert.ok(redone && !("kind" in redone));
  assert.deepEqual(redone.state.structure.sources, {});
});

test("history revert realizes the current source version and preserves provenance", () => {
  const linked = applyDrawingCommand(
    state(),
    linkDrawingPdfRegionSourceCommand(state(), ids.actor, ids.object, {
      id: ids.source,
      sourceFileId: ids.file,
      sourceSha256: sha,
      pdfPageNumber: 2,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    }),
    environment(ids.linkOperation),
  );
  const reverted = revertDrawingOperation(
    linked.state,
    ids.actor,
    ids.linkOperation,
    environment(ids.undoOperation),
  );
  assert.ok(!("kind" in reverted));
  assert.deepEqual(reverted.state.structure.sources, {});
  assert.equal(reverted.operation.originalOperationId, ids.linkOperation);
  assert.equal(reverted.operation.historyAction, "undo");
  assert.deepEqual(reverted.operation.forward, {
    type: "mutate_structure",
    actions: [{ kind: "delete_source", id: ids.source, baseVersion: 1 }],
  });
});

test("cross-actor source dependencies conflict object-add undo and revert and fence direct deletion", () => {
  const empty = createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      ...state().structure,
      objects: {},
      sources: {},
    },
  });
  const added = applyDrawingCommand(
    empty,
    { type: "add_objects", actorId: ids.actor, objects: [object()] },
    environment(ids.addOperation),
  );
  const linked = applyDrawingCommand(
    added.state,
    linkDrawingPdfRegionSourceCommand(added.state, ids.otherActor, ids.object, {
      id: ids.source,
      sourceFileId: ids.file,
      sourceSha256: sha,
      pdfPageNumber: 2,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
    }),
    environment(ids.linkOperation),
  );

  assert.deepEqual(
    undoDrawingCommand(linked.state, ids.actor, environment(ids.undoOperation)),
    { kind: "conflict", objectIds: [ids.source] },
  );
  assert.deepEqual(
    revertDrawingOperation(
      linked.state,
      ids.actor,
      ids.addOperation,
      environment(ids.undoOperation),
    ),
    { kind: "conflict", objectIds: [ids.source] },
  );
  assert.throws(
    () =>
      applyDrawingCommand(
        linked.state,
        {
          type: "delete_objects",
          actorId: ids.actor,
          objectIds: [ids.object],
        },
        environment(ids.deleteOperation),
      ),
    /missing object/,
  );
});

test("object deletion removes sources first and undo restores objects before sources", () => {
  const initial = state({ [ids.source]: source() });
  const command = deleteDrawingObjectsWithReferencesCommand(
    initial,
    ids.actor,
    [ids.object],
  );
  assert.deepEqual(command.actions, [
    { kind: "delete_source", id: ids.source, baseVersion: 1 },
  ]);
  const deleted = applyDrawingCommand(
    initial,
    command,
    environment(ids.deleteOperation),
  );
  assert.deepEqual(deleted.state.objects, {});
  assert.deepEqual(deleted.state.structure.sources, {});
  assert.deepEqual(deleted.operation.inverse.actions, [
    { kind: "put_source", entity: source(), baseVersion: null },
  ]);

  const restored = undoDrawingCommand(
    deleted.state,
    ids.actor,
    environment(ids.undoOperation),
  );
  assert.ok(restored && !("kind" in restored));
  assert.equal(restored.state.objects[ids.object].version, 3);
  assert.deepEqual(restored.state.structure.sources[ids.source], {
    ...source(),
    version: 3,
  });
});

test("reference-aware deletion reserves the exact object UUID tombstone through undo and recovery", () => {
  const other = { ...object(), id: ids.otherObject, name: "Other target" };
  const initial = createDrawingDocumentState({
    revisionId: ids.revision,
    structure: {
      ...state().structure,
      objects: { [ids.object]: object(), [ids.otherObject]: other },
      sources: {},
    },
  });
  const deleted = applyDrawingCommand(
    initial,
    deleteDrawingObjectsWithReferencesCommand(initial, ids.actor, [ids.object]),
    environment(ids.deleteOperation),
  );
  const tombstone = {
    collection: "objects",
    entity: object(),
    version: 2,
  };
  assert.deepEqual(deleted.state.structure.tombstones?.[ids.object], tombstone);
  assert.throws(
    () =>
      linkDrawingPdfRegionSourceCommand(
        deleted.state,
        ids.actor,
        ids.otherObject,
        {
          id: ids.object,
          sourceFileId: ids.file,
          sourceSha256: sha,
          pdfPageNumber: 1,
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.4,
        },
      ),
    /reuses a UUID/,
  );

  const restored = undoDrawingCommand(
    deleted.state,
    ids.actor,
    environment(ids.undoOperation),
  );
  assert.ok(restored && !("kind" in restored));
  assert.equal(restored.state.objects[ids.object].version, 3);
  assert.equal(restored.state.structure.tombstones[ids.object], undefined);

  const recovered = recoverPendingDrawingState(initial, [deleted.operation]);
  assert.deepEqual(recovered.conflictedOperationIds, []);
  assert.deepEqual(recovered.ambiguousOperationIds, []);
  assert.deepEqual(recovered.state.structure.tombstones[ids.object], tombstone);
});

test("same-document duplicate and clipboard copies begin without source evidence", () => {
  const initial = state({ [ids.source]: source() });
  const duplicate = duplicateDrawingSelection(
    initial,
    [ids.object],
    ids.actor,
    () => ids.duplicate,
  );
  assert.ok(duplicate);
  assert.equal(duplicate.type, "add_objects");
  assert.equal(duplicate.objects[0].id, ids.duplicate);
  assert.equal("sources" in duplicate, false);

  const clipboard = copyDrawingSelection(initial, [ids.object]);
  assert.equal("sources" in clipboard, false);
  assert.equal("source" in clipboard.items[0], false);
  assert.equal(JSON.stringify(clipboard).includes(ids.source), false);
});

test("source mutation permissions are command eligibility only", () => {
  for (const capability of ["admin", "editor"])
    assert.equal(
      canMutateDrawingObjectSources({
        capability,
        revisionStatus: "draft",
        frozen: false,
      }),
      true,
    );
  for (const capability of ["viewer", "commenter", "reviewer", "approver"])
    assert.equal(
      canMutateDrawingObjectSources({
        capability,
        revisionStatus: "draft",
        frozen: false,
      }),
      false,
    );
  assert.equal(
    canMutateDrawingObjectSources({
      capability: "editor",
      revisionStatus: "approved",
      frozen: false,
    }),
    false,
  );
  assert.equal(
    canMutateDrawingObjectSources({
      capability: "editor",
      revisionStatus: "draft",
      frozen: true,
    }),
    false,
  );
});
