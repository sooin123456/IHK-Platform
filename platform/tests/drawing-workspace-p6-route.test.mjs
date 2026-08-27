import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertDrawingQuantityWorkspaceScope,
  parseDrawingQuantityLinkForm,
  parseDrawingQuantityLineageSearch,
} from "../app/lukas/lib/drawing-workspace.server.ts";
import { parseDrawingBoqMutationForm } from "../app/lukas/lib/drawing-quantity-lineage.server.ts";

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

test("quantity lineage URL identity is validated before workspace loading", async () => {
  assert.deepEqual(
    parseDrawingQuantityLineageSearch(
      new URLSearchParams({
        revision: "00000000-0000-4000-8000-000000000021",
        object: "00000000-0000-4000-8000-000000000022",
        quantityCursor: "cursor",
      }),
    ),
    {
      revisionId: "00000000-0000-4000-8000-000000000021",
      objectId: "00000000-0000-4000-8000-000000000022",
      cursor: "cursor",
    },
  );
  for (const input of [
    { revision: "not-a-uuid" },
    { object: "not-a-uuid" },
    { quantityCursor: "orphan-cursor" },
  ])
    assert.throws(
      () => parseDrawingQuantityLineageSearch(new URLSearchParams(input)),
      /URL이 올바르지 않습니다/,
    );

  const source = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const parseAt = source.indexOf(
    "parseDrawingQuantityLineageSearch(searchParams)",
  );
  const loadAt = source.indexOf("await loadDrawingWorkspace(");
  assert.ok(parseAt >= 0 && parseAt < loadAt);
});

test("quantity lineage loader binds the URL file, revision, and object before reading lineage", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const loaderStart = source.indexOf("export async function loader");
  const actionStart = source.indexOf("export async function action");
  const loader = source.slice(loaderStart, actionStart);
  const scopeAt = loader.indexOf("assertDrawingQuantityWorkspaceScope(");
  const lineageAt = loader.indexOf("listDrawingObjectQuantityLineage(");
  assert.ok(scopeAt >= 0 && scopeAt < lineageAt);
  assert.match(loader, /if \(scope\.requiresEntryResolution\)/);
  assert.match(loader, /entry\.fileId !== workspace\.file\.id/);
});

test("verified BOQ mapping forms accept only IDs factor and base version", () => {
  const put = new FormData();
  put.set("intent", "drawing_boq_put");
  put.set("id", "00000000-0000-4000-8000-000000000101");
  put.set("quantity_link_id", "00000000-0000-4000-8000-000000000102");
  put.set("version_id", "00000000-0000-4000-8000-000000000103");
  put.set("line_id", "00000000-0000-4000-8000-000000000104");
  put.set("allocation_factor", "0.5");
  put.set("base_version", "");
  assert.deepEqual(parseDrawingBoqMutationForm(put), {
    intent: "drawing_boq_put",
    id: "00000000-0000-4000-8000-000000000101",
    quantityLinkId: "00000000-0000-4000-8000-000000000102",
    boqVersionId: "00000000-0000-4000-8000-000000000103",
    boqLineId: "00000000-0000-4000-8000-000000000104",
    allocationFactor: "0.5",
    baseVersion: null,
  });
  for (const forbidden of [
    "raw_quantity",
    "unit",
    "final_quantity",
    "unit_price",
    "amount",
    "input_state_sha256",
    "result_sha256",
    "manifest_sha256",
    "project_id",
  ]) {
    const injected = new FormData();
    for (const [key, value] of put) injected.set(key, value);
    injected.set(forbidden, "attacker-controlled");
    assert.throws(
      () => parseDrawingBoqMutationForm(injected),
      /허용되지 않은 필드/,
    );
  }
});

test("verified BOQ delete, submit, and decision forms are strict", () => {
  const cases = [
    [
      [
        ["intent", "drawing_boq_delete"],
        ["id", "00000000-0000-4000-8000-000000000101"],
        ["base_version", "3"],
      ],
      "drawing_boq_delete",
    ],
    [
      [
        ["intent", "submit"],
        ["version_id", "00000000-0000-4000-8000-000000000103"],
      ],
      "submit",
    ],
    [
      [
        ["intent", "decision"],
        ["version_id", "00000000-0000-4000-8000-000000000103"],
        ["decision", "approved"],
        ["note", "검토 완료"],
      ],
      "decision",
    ],
  ];
  for (const [entries, intent] of cases) {
    const form = new FormData();
    for (const [key, value] of entries) form.set(key, value);
    assert.equal(parseDrawingBoqMutationForm(form).intent, intent);
    form.set("result_sha256", "a".repeat(64));
    assert.throws(
      () => parseDrawingBoqMutationForm(form),
      /허용되지 않은 필드/,
    );
  }
});

test("Drawing and BOQ inspectors expose persisted authority without monetary collaboration state", async () => {
  const [boqSources, quantityInspector, drawingInspector, workspace] =
    await Promise.all([
      readFile(
        new URL(
          "../app/lukas/components/verified-boq-drawing-sources.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/lukas/components/drawing-quantity-inspector.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/lukas/components/drawing-inspector.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/lukas/components/drawing-workspace.tsx",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
  assert.match(boqSources, /미연결 근거/);
  assert.match(boqSources, /배분 합계/);
  assert.match(boqSources, /base_version/);
  assert.match(quantityInspector, /미리보기/);
  assert.match(quantityInspector, /확정 근거/);
  assert.match(quantityInspector, /승인 스냅샷/);
  assert.doesNotMatch(quantityInspector, /m3/);
  assert.match(drawingInspector, /DrawingQuantityInspector/);
  assert.match(workspace, /quantityLineage/);
  assert.doesNotMatch(boqSources, /raw_quantity[^\n]*name=/);
  assert.doesNotMatch(boqSources, /result_sha256[^\n]*name=/);
});
