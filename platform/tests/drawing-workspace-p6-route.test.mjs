import assert from "node:assert/strict";
import test from "node:test";

import { parseDrawingQuantityLinkForm } from "../app/lukas/lib/drawing-workspace.server.ts";

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
    const injected = new FormData(form);
    injected.set(forbidden, "attacker-controlled");
    assert.throws(() => parseDrawingQuantityLinkForm(injected), /허용되지 않은 필드/);
  }
});
