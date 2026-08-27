import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertDrawingBoqEvidenceScope,
  assertDrawingQuantityWorkspaceScope,
  parseDrawingQuantityLinkForm,
  parseDrawingQuantityLineageSearch,
} from "../app/lukas/lib/drawing-workspace.server.ts";
import {
  drawingWorkspaceEvidenceFocusBounds,
  drawingWorkspaceEvidenceFocusKey,
  drawingWorkspaceObjectFocusViewport,
} from "../app/lukas/lib/drawing-workspace-view.ts";
import { sanitizeDrawingTransientInput } from "../app/lukas/lib/drawing-document-store.ts";
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
      boqVersionId: null,
      boqLineId: null,
      evidenceFileId: null,
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

test("BOQ evidence URL requires one exact UUID ancestry tuple", () => {
  const tuple = {
    revision: "00000000-0000-4000-8000-000000000021",
    object: "00000000-0000-4000-8000-000000000022",
    boq: "00000000-0000-4000-8000-000000000023",
    line: "00000000-0000-4000-8000-000000000024",
    evidence: "00000000-0000-4000-8000-000000000025",
  };
  assert.deepEqual(
    parseDrawingQuantityLineageSearch(new URLSearchParams(tuple)),
    {
      revisionId: tuple.revision,
      objectId: tuple.object,
      boqVersionId: tuple.boq,
      boqLineId: tuple.line,
      evidenceFileId: tuple.evidence,
      cursor: null,
    },
  );
  for (const input of [
    { ...tuple, boq: "not-a-uuid" },
    { ...tuple, line: "not-a-uuid" },
    { revision: tuple.revision, object: tuple.object, boq: tuple.boq },
    { revision: tuple.revision, object: tuple.object, line: tuple.line },
    { boq: tuple.boq, line: tuple.line },
    {
      revision: tuple.revision,
      object: tuple.object,
      boq: tuple.boq,
      line: tuple.line,
    },
    { evidence: tuple.evidence },
  ])
    assert.throws(
      () => parseDrawingQuantityLineageSearch(new URLSearchParams(input)),
      /URL이 올바르지 않습니다/,
    );
  const duplicate = new URLSearchParams(tuple);
  duplicate.append("object", tuple.object);
  assert.throws(
    () => parseDrawingQuantityLineageSearch(duplicate),
    /URL이 올바르지 않습니다/,
  );
});

test("BOQ evidence focus accepts only the exact authorized persisted link", () => {
  const boqVersionId = "00000000-0000-4000-8000-000000000023";
  const boqLineId = "00000000-0000-4000-8000-000000000024";
  const lineage = {
    rows: [
      {
        quantity: { id: "00000000-0000-4000-8000-000000000025" },
        boqLinks: [
          {
            boqVersionId,
            boqLineId,
          },
        ],
      },
    ],
    nextCursor: null,
  };
  assert.deepEqual(
    assertDrawingBoqEvidenceScope(lineage, { boqVersionId, boqLineId }),
    { boqVersionId, boqLineId },
  );
  for (const mismatch of [
    {
      boqVersionId: "00000000-0000-4000-8000-000000000026",
      boqLineId,
    },
    {
      boqVersionId,
      boqLineId: "00000000-0000-4000-8000-000000000027",
    },
  ])
    assert.throws(
      () => assertDrawingBoqEvidenceScope(lineage, mismatch),
      /연결된 도면 근거를 열 수 없습니다/,
    );
  assert.throws(
    () =>
      assertDrawingBoqEvidenceScope(
        { rows: [], nextCursor: null },
        { boqVersionId, boqLineId },
      ),
    /연결된 도면 근거를 열 수 없습니다/,
  );
});

test("BOQ object focus selects its non-default canvas and computes a bounded initial fit", () => {
  assert.deepEqual(
    drawingWorkspaceObjectFocusViewport({
      bounds: { x: 100, y: 50, width: 200, height: 100 },
      canvasId: "canvas-b",
      pageId: "page-b",
      viewportSize: { width: 1000, height: 600 },
    }),
    {
      activeCanvasId: "canvas-b",
      activePageId: "page-b",
      viewport: { x: -300, y: -100, zoom: 4 },
    },
  );
});

test("BOQ evidence focus is one-shot per exact authorized tuple", () => {
  const tuple = {
    revisionId: "00000000-0000-4000-8000-000000000031",
    objectId: "00000000-0000-4000-8000-000000000032",
    boqVersionId: "00000000-0000-4000-8000-000000000033",
    boqLineId: "00000000-0000-4000-8000-000000000034",
    evidenceFileId: "00000000-0000-4000-8000-000000000035",
  };
  const key = drawingWorkspaceEvidenceFocusKey(tuple);
  assert.equal(key, drawingWorkspaceEvidenceFocusKey({ ...tuple }));
  assert.notEqual(
    key,
    drawingWorkspaceEvidenceFocusKey({
      ...tuple,
      objectId: "00000000-0000-4000-8000-000000000036",
    }),
  );
  assert.notEqual(
    key,
    drawingWorkspaceEvidenceFocusKey({
      ...tuple,
      evidenceFileId: "00000000-0000-4000-8000-000000000037",
    }),
  );
  assert.equal(
    drawingWorkspaceEvidenceFocusKey({ ...tuple, evidenceFileId: null }),
    null,
  );
});

test("PDF evidence focus consumes the persisted page and normalized region", () => {
  const evidence = {
    id: "00000000-0000-4000-8000-000000000041",
    objectId: "00000000-0000-4000-8000-000000000042",
    revisionId: "00000000-0000-4000-8000-000000000043",
    sourceFileId: "00000000-0000-4000-8000-000000000044",
    sourceSha256: "a".repeat(64),
    sourceKind: "pdf_region",
    pdfPageNumber: 3,
    x: 0.25,
    y: 0.5,
    width: 0.5,
    height: 0.25,
    version: 1,
  };
  const transform = {
    pageNumber: 3,
    rotation: 0,
    pdfViewport: { width: 1000, height: 500 },
    worldBounds: { x: 10, y: 20, width: 800, height: 400 },
  };
  assert.deepEqual(
    drawingWorkspaceEvidenceFocusBounds({
      evidence,
      objectBounds: { x: 999, y: 999, width: 1, height: 1 },
      pdfPageTransform: transform,
    }),
    { x: 210, y: 220, width: 400, height: 100 },
  );
  assert.equal(
    drawingWorkspaceEvidenceFocusBounds({
      evidence,
      objectBounds: { x: 999, y: 999, width: 1, height: 1 },
      pdfPageTransform: { ...transform, pageNumber: 2 },
    }),
    null,
  );
});

test("workspace loader binds the BOQ tuple before returning focus and never falls back", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  const loader = source.slice(
    source.indexOf("export async function loader"),
    source.indexOf("export async function action"),
  );
  assert.match(loader, /lineageSearch\.objectId/);
  assert.match(loader, /assertDrawingBoqEvidenceScope\(/);
  assert.match(loader, /boqVersionId: lineageSearch\.boqVersionId/);
  assert.match(loader, /boqLineId: lineageSearch\.boqLineId/);
  assert.match(loader, /boqEvidence:/);
  assert.match(loader, /연결된 도면 근거를 열 수 없습니다/);
  assert.doesNotMatch(
    loader,
    /boqVersionId[\s\S]{0,180}(?:versions\[0\]|rows\[0\])/,
  );

  const client = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(client, /drawingWorkspaceObjectFocusViewport\(/);
  assert.match(client, /drawingWorkspaceEvidenceFocusBounds\(/);
  assert.match(client, /canvasRef\.current\.setViewport\(/);
  assert.match(client, /initialEvidenceFocusKeyRef/);
  assert.match(
    client,
    /initialEvidenceFocusKeyRef\.current === evidenceFocusKey/,
  );
  assert.match(client, /setAuthorizedSelection\(\[evidenceFocusObjectId\]\)/);
  assert.match(client, /selectedDrawingObjectId !== evidenceFocusObjectId/);
  const workspaceServer = await readFile(
    new URL("../app/lukas/lib/drawing-workspace.server.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    workspaceServer,
    /focusedObject && \(!focusedLayer \|\| !focusedCanvas\)/,
  );
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

test("validated reload selection survives initial transient sanitization while stale selection is removed", () => {
  const objectId = "00000000-0000-4000-8000-000000000031";
  const input = {
    activeLayerId: null,
    activeTool: "select",
    selectedIds: [objectId],
  };
  assert.deepEqual(sanitizeDrawingTransientInput(input, false).selectedIds, [
    objectId,
  ]);
  assert.deepEqual(sanitizeDrawingTransientInput(input, true).selectedIds, []);
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

test("verified BOQ Drawing mutations bind their targets to the current route project before RPC", async () => {
  const source = await readFile(
    new URL("../app/lukas/screens/verified-boq.tsx", import.meta.url),
    "utf8",
  );
  const putScope = source.indexOf(
    '.from("lukas_qto_boq_versions")',
    source.indexOf('intent === "drawing_boq_put"'),
  );
  const putRpc = source.indexOf("await putDrawingBoqLink", putScope);
  const deleteScope = source.indexOf(
    '.from("lukas_drawing_boq_links")',
    source.indexOf('intent === "drawing_boq_delete"'),
  );
  const deleteRpc = source.indexOf("await deleteDrawingBoqLink", deleteScope);
  assert.ok(putScope >= 0 && putScope < putRpc);
  assert.ok(deleteScope >= 0 && deleteScope < deleteRpc);
  assert.match(
    source.slice(putScope, putRpc),
    /\.eq\("project_id", context\.project\.id\)/,
  );
  assert.match(
    source.slice(deleteScope, deleteRpc),
    /\.eq\("project_id", context\.project\.id\)/,
  );
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
  assert.match(workspace, /next\.set\("object", selectedDrawingObjectId\)/);
  assert.match(workspace, /next\.set\("revision", revision\.id\)/);
  assert.match(workspace, /searchParams\.get\("object"\)/);
  assert.match(workspace, /linkedObjectId \? \[linkedObjectId\] : \[\]/);
  assert.match(
    workspace,
    /authorizationWasInitialized[\s\S]*if \(authorizationWasInitialized\)\s+transientInputInvalidatedRef\.current = true/,
  );
  assert.doesNotMatch(boqSources, /raw_quantity[^\n]*name=/);
  assert.doesNotMatch(boqSources, /result_sha256[^\n]*name=/);
});
