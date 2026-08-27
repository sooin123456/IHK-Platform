import assert from "node:assert/strict";
import test from "node:test";

import {
  createDrawingQuantityLink,
  listDrawingObjectQuantityLineage,
  resolveDrawingWorkspaceEntry,
} from "../app/lukas/lib/drawing-quantity-lineage.server.ts";

test("trusted quantity creation forwards only server-derived evidence", async () => {
  const ids = {
    actor: "00000000-0000-4000-8000-000000000001",
    project: "00000000-0000-4000-8000-000000000002",
    document: "00000000-0000-4000-8000-000000000003",
    revision: "00000000-0000-4000-8000-000000000004",
    object: "00000000-0000-4000-8000-000000000005",
    layer: "00000000-0000-4000-8000-000000000006",
    page: "00000000-0000-4000-8000-000000000007",
    link: "00000000-0000-4000-8000-000000000008",
  };
  const canonicalJson = {
    schemaVersion: 2,
    revision: {
      id: ids.revision,
      documentId: ids.document,
      projectId: ids.project,
      sequence: 1,
      version: 7,
    },
    sources: [],
    pages: [],
    canvases: [],
    layers: [],
    objects: [
      {
        id: ids.object,
        lineageId: ids.object,
        pageId: ids.page,
        layerId: ids.layer,
        name: "A-01",
        type: "area",
        geometry: {
          type: "area",
          semanticVersion: 1,
          points: [
            { x: 0, y: 0 },
            { x: 5000, y: 0 },
            { x: 5000, y: 2500 },
            { x: 0, y: 2500 },
          ],
        },
        styleId: null,
        style: {},
        version: 3,
      },
    ],
    styles: [],
    blocks: [],
    blockInstances: [],
    propertySchemas: [],
    propertyValues: [],
    tables: [],
    issues: [],
    operationSequence: 12,
  };
  const snapshotSha256 = "a".repeat(64);
  const calls = [];
  const client = authorizedClient(ids.actor, ids.project, "estimator");

  const result = await createDrawingQuantityLink(
    client,
    ids.actor,
    {
      projectId: ids.project,
      drawingRevisionId: ids.revision,
      drawingObjectId: ids.object,
      measurementKind: "area",
      linkId: ids.link,
    },
    {
      async transaction(run) {
        return run({
          async loadAuthority() {
            return {
              projectId: ids.project,
              documentId: ids.document,
              revisionId: ids.revision,
              revisionVersion: 7,
              revisionStatus: "approved",
              operationSequence: 12,
              canonicalJson,
              snapshotSha256,
              recomputedSnapshotSha256: snapshotSha256,
              approvalDecision: "approved",
              objectId: ids.object,
              objectLineageId: ids.object,
              objectVersion: 3,
              sourceAnchors: [],
              issueLinks: [],
            };
          },
          async insertQuantityLink(args) {
            calls.push(args);
            return {
              id: ids.link,
              project_id: ids.project,
              drawing_revision_id: ids.revision,
              drawing_revision_version: 7,
              drawing_snapshot_sha256: snapshotSha256,
              drawing_object_id: ids.object,
              drawing_object_lineage_id: ids.object,
              drawing_object_version: 3,
              object_fingerprint: args.p_object_fingerprint,
              measurement_kind: "area",
              raw_quantity: "12.5",
              unit: "m2",
              measurement_rule_version: "P4_MEASUREMENT_V1",
              created_by: ids.actor,
              created_at: "2026-08-28T00:00:00.000Z",
            };
          },
        });
      },
    },
  );

  assert.equal(result.rawQuantity, "12.5");
  assert.deepEqual(calls[0], {
    p_actor_id: ids.actor,
    p_id: ids.link,
    p_revision_id: ids.revision,
    p_object_id: ids.object,
    p_measurement_kind: "area",
    p_snapshot_sha256: snapshotSha256,
    p_object_lineage_id: ids.object,
    p_object_version: 3,
    p_object_fingerprint: calls[0].p_object_fingerprint,
    p_raw_quantity: "12.5",
    p_unit: "m2",
    p_measurement_rule_version: "P4_MEASUREMENT_V1",
  });
  assert.match(calls[0].p_object_fingerprint, /^[0-9a-f]{64}$/);
});

test("quantity creation rejects anonymous and read-only roles before database access", async () => {
  const project = "00000000-0000-4000-8000-000000000011";
  const actor = "00000000-0000-4000-8000-000000000012";
  const input = {
    projectId: project,
    drawingRevisionId: "00000000-0000-4000-8000-000000000013",
    drawingObjectId: "00000000-0000-4000-8000-000000000014",
    measurementKind: "count",
    linkId: "00000000-0000-4000-8000-000000000015",
  };
  for (const role of ["viewer", "site", "reviewer"]) {
    let touched = false;
    await assert.rejects(
      createDrawingQuantityLink(authorizedClient(actor, project, role), actor, input, {
        async transaction() {
          touched = true;
        },
      }),
      (error) => error.code === "P6A01" && Boolean(error.requestId),
    );
    assert.equal(touched, false);
  }
});

test("lineage pages by created_at and id with a hard 200 row bound", async () => {
  const client = lineageClient();
  const page = await listDrawingObjectQuantityLineage(client, {
    projectId: "00000000-0000-4000-8000-000000000021",
    revisionId: "00000000-0000-4000-8000-000000000022",
    objectId: "00000000-0000-4000-8000-000000000023",
    cursor: null,
    limit: 500,
  });
  assert.equal(page.rows.length, 200);
  assert.ok(page.nextCursor);
  assert.deepEqual(client.orders, ["created_at", "id"]);
});

test("workspace resolution returns exact evidence route and never falls back", async () => {
  const ids = {
    project: "00000000-0000-4000-8000-000000000031",
    revision: "00000000-0000-4000-8000-000000000032",
    object: "00000000-0000-4000-8000-000000000033",
    boq: "00000000-0000-4000-8000-000000000034",
    line: "00000000-0000-4000-8000-000000000035",
    document: "00000000-0000-4000-8000-000000000036",
    file: "00000000-0000-4000-8000-000000000037",
  };
  const client = exactEntryClient(ids);
  assert.equal(
    await resolveDrawingWorkspaceEntry(client, {
      projectId: ids.project,
      revisionId: ids.revision,
      objectId: ids.object,
      boqVersionId: ids.boq,
      boqLineId: ids.line,
    }),
    `/projects/${ids.project}/drawings/${ids.file}/workspace?document=${ids.document}&revision=${ids.revision}&object=${ids.object}&boq=${ids.boq}&line=${ids.line}`,
  );
  await assert.rejects(
    resolveDrawingWorkspaceEntry(exactEntryClient({ ...ids, file: null }), {
      projectId: ids.project,
      revisionId: ids.revision,
      objectId: ids.object,
      boqVersionId: ids.boq,
      boqLineId: ids.line,
    }),
    /연결된 도면 근거를 열 수 없습니다/,
  );
});

function authorizedClient(actor, project, role) {
  return {
    auth: {
      async getUser() {
        return { data: { user: { id: actor, is_anonymous: false, app_metadata: {} } }, error: null };
      },
    },
    from(table) {
      const query = chain({
        data:
          table === "lukas_qto_projects"
            ? { id: project, owner_id: "00000000-0000-4000-8000-000000000099" }
            : { role },
        error: null,
      });
      return query;
    },
  };
}

function chain(result) {
  const query = {
    select() { return query; },
    eq() { return query; },
    in() { return query; },
    order() { return query; },
    gt() { return query; },
    or() { return query; },
    limit() { return Promise.resolve(result); },
    single() { return Promise.resolve(result); },
    maybeSingle() { return Promise.resolve(result); },
  };
  return query;
}

function lineageClient() {
  const quantities = Array.from({ length: 201 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    project_id: "00000000-0000-4000-8000-000000000021",
    drawing_revision_id: "00000000-0000-4000-8000-000000000022",
    drawing_revision_version: 1,
    drawing_snapshot_sha256: "a".repeat(64),
    drawing_object_id: "00000000-0000-4000-8000-000000000023",
    drawing_object_lineage_id: "00000000-0000-4000-8000-000000000023",
    drawing_object_version: 1,
    object_fingerprint: "b".repeat(64),
    measurement_kind: "count",
    raw_quantity: "1",
    unit: "EA",
    measurement_rule_version: "P4_MEASUREMENT_V1",
    created_by: "00000000-0000-4000-8000-000000000024",
    created_at: `2026-08-28T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
  }));
  return {
    orders: [],
    from(table) {
      const query = chain({ data: table === "lukas_drawing_quantity_links" ? quantities : [], error: null });
      query.order = (column) => { this.orders.push(column); return query; };
      query.limit = (size) => Promise.resolve({ data: quantities.slice(0, size), error: null });
      return query;
    },
  };
}

function exactEntryClient(ids) {
  const rows = {
    lukas_drawing_revisions: { id: ids.revision, document_id: ids.document, project_id: ids.project },
    lukas_drawing_documents: { id: ids.document, project_id: ids.project, source_file_id: ids.file },
    lukas_drawing_objects: { id: ids.object, revision_id: ids.revision, project_id: ids.project },
    lukas_qto_boq_versions: { id: ids.boq, project_id: ids.project },
    lukas_qto_boq_lines: { id: ids.line, version_id: ids.boq, project_id: ids.project },
    lukas_qto_files: ids.file ? { id: ids.file, project_id: ids.project, immutable: true, kind: "pdf" } : null,
  };
  return { from(table) { return chain({ data: rows[table], error: null }); } };
}
