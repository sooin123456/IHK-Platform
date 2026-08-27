import assert from "node:assert/strict";
import test from "node:test";

import {
  assertDrawingQuantityWorkspaceScope,
  parseDrawingQuantityLinkForm,
} from "../app/lukas/lib/drawing-workspace.server.ts";

test("drawing quantity form accepts only stable intent identity and measurement kind", () => {
  const form = new FormData();
  form.set("intent", "create_drawing_quantity_link");
  form.set("link_id", "00000000-0000-4000-8000-000000000001");
  form.set("revision_id", "00000000-0000-4000-8000-000000000002");
  form.set("object_id", "00000000-0000-4000-8000-000000000003");
  form.set("measurement_kind", "area");
  assert.deepEqual(parseDrawingQuantityLinkForm(form), {
    intent: "create_drawing_quantity_link",
    linkId: "00000000-0000-4000-8000-000000000001",
    drawingRevisionId: "00000000-0000-4000-8000-000000000002",
    drawingObjectId: "00000000-0000-4000-8000-000000000003",
    measurementKind: "area",
  });

  for (const forbidden of [
    "raw_quantity",
    "object_version",
    "object_fingerprint",
    "unit",
    "final_quantity",
    "unit_price",
    "amount",
    "snapshot_sha256",
  ]) {
    const injected = new FormData();
    for (const [key, value] of form) injected.set(key, value);
    injected.set(forbidden, "attacker-controlled");
    assert.throws(
      () => parseDrawingQuantityLinkForm(injected),
      /허용되지 않은 필드/,
    );
  }
});

test("quantity action scope binds the posted object to the current file document and revision", () => {
  const fileId = "00000000-0000-4000-8000-000000000011";
  const revisionId = "00000000-0000-4000-8000-000000000012";
  const objectId = "00000000-0000-4000-8000-000000000013";
  const workspace = {
    file: { id: fileId },
    document: {
      source_file_id: fileId,
      revision: { id: revisionId, objects: [{ id: objectId }] },
    },
  };
  assert.deepEqual(
    assertDrawingQuantityWorkspaceScope(workspace, {
      fileId,
      revisionId,
      objectId,
    }),
    { requiresEntryResolution: false },
  );
  for (const mismatch of [
    { fileId: "00000000-0000-4000-8000-000000000014", revisionId, objectId },
    { fileId, revisionId: "00000000-0000-4000-8000-000000000015", objectId },
    { fileId, revisionId, objectId: "00000000-0000-4000-8000-000000000016" },
  ])
    assert.throws(
      () => assertDrawingQuantityWorkspaceScope(workspace, mismatch),
      /연결된 도면 근거/,
    );
});
