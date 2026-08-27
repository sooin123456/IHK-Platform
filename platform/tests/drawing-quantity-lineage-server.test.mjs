import assert from "node:assert/strict";
import test from "node:test";

import {
  createDrawingQuantityLink,
  deleteDrawingBoqLink,
  listDrawingObjectQuantityLineage,
  parseVerifiedBoqV1_1RpcInput,
  putDrawingBoqLink,
  recheckAndDecideVerifiedBoqV1_1,
  resolveDrawingWorkspaceEntry,
  submitVerifiedBoqV1_1,
} from "../app/lukas/lib/drawing-quantity-lineage.server.ts";

const P6_SHA_A = "a".repeat(64);
const P6_SHA_B = "b".repeat(64);

const p6Ids = {
  actor: "00000000-0000-4000-8000-000000000101",
  reviewer: "00000000-0000-4000-8000-000000000102",
  project: "00000000-0000-4000-8000-000000000103",
  version: "00000000-0000-4000-8000-000000000104",
  section: "00000000-0000-4000-8000-000000000105",
  line: "00000000-0000-4000-8000-000000000106",
  quantity: "00000000-0000-4000-8000-000000000107",
  drawingLink: "00000000-0000-4000-8000-000000000108",
  revision: "00000000-0000-4000-8000-000000000109",
  object: "00000000-0000-4000-8000-000000000110",
  lineage: "00000000-0000-4000-8000-000000000111",
  priceBook: "00000000-0000-4000-8000-000000000112",
  priceFile: "00000000-0000-4000-8000-000000000113",
  resource: "00000000-0000-4000-8000-000000000114",
  component: "00000000-0000-4000-8000-000000000115",
};

function boqInputRpcPayload() {
  return {
    inputStateSha256: P6_SHA_A,
    input: {
      versionId: p6Ids.version,
      projectId: p6Ids.project,
      engineVersion: "VERIFIED-BOQ-1.1",
      calculationPolicy: "general_half_away",
      quantityScale: 3,
      lines: [
        {
          id: p6Ids.line,
          sectionId: p6Ids.section,
          section: {
            id: p6Ids.section,
            parentId: null,
            code: "01",
            name: "건축",
            sortOrder: 1,
          },
          itemCode: "001-A",
          itemName: "벽체",
          specification: "A",
          unit: "m2",
          adjustment: "0",
          reason: "",
          sortOrder: 1,
        },
      ],
      drawingLinks: [
        {
          id: p6Ids.drawingLink,
          line: p6Ids.line,
          factor: "1",
          version: 1,
          source: {
            id: p6Ids.quantity,
            revisionId: p6Ids.revision,
            revisionVersion: 2,
            snapshotSha256: P6_SHA_B,
            objectId: p6Ids.object,
            lineageId: p6Ids.lineage,
            objectVersion: 3,
            fingerprint: P6_SHA_A,
            kind: "area",
            rawQuantity: "4.75",
            unit: "m2",
            rule: "P4_MEASUREMENT_V1",
            anchors: [],
            issues: [],
          },
        },
      ],
      legacyMappings: [],
      legacyExclusions: [],
      components: [
        {
          id: p6Ids.component,
          line: p6Ids.line,
          resourceId: p6Ids.resource,
          coefficient: "2",
          resource: {
            id: p6Ids.resource,
            code: "M-001",
            type: "material",
            name: "벽체재",
            specification: "A",
            unit: "m2",
            unitPriceKrw: "100",
            priceBookId: p6Ids.priceBook,
          },
        },
      ],
      priceBook: {
        id: p6Ids.priceBook,
        name: "고객 단가표",
        versionLabel: "2026-08",
        fileId: p6Ids.priceFile,
        sha256: P6_SHA_B,
        effectiveDate: "2026-08-01",
        currency: "KRW",
        rightsBasis: "customer_owned",
        licenseNote: "customer",
      },
    },
  };
}

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
          boundary: [
            { x: 0, y: 0 },
            { x: 5000, y: 0 },
            { x: 5000, y: 2500 },
            { x: 0, y: 2500 },
          ],
        },
        styleId: null,
        style: { stroke: "#111111", strokeWidth: 1, fill: null },
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
      createDrawingQuantityLink(
        authorizedClient(actor, project, role),
        actor,
        input,
        {
          async transaction() {
            touched = true;
          },
        },
      ),
      (error) => error.code === "P6A01" && Boolean(error.requestId),
    );
    assert.equal(touched, false);
  }
});

test("owner, estimator, and verified staff reach trusted authority with server identity", async () => {
  const project = "00000000-0000-4000-8000-000000000016";
  const actor = "00000000-0000-4000-8000-000000000017";
  const input = {
    projectId: project,
    drawingRevisionId: "00000000-0000-4000-8000-000000000018",
    drawingObjectId: "00000000-0000-4000-8000-000000000019",
    measurementKind: "count",
    linkId: "00000000-0000-4000-8000-000000000020",
  };
  for (const [role, isStaff] of [
    ["owner", false],
    ["estimator", false],
    ["staff", true],
  ]) {
    let trustedActor = null;
    await assert.rejects(
      createDrawingQuantityLink(
        authorizedClient(actor, project, role),
        actor,
        input,
        {
          async transaction(_run, context) {
            trustedActor = context;
            throw Object.assign(new Error("bounded"), { code: "P6Q03" });
          },
        },
      ),
      (error) => error.code === "P6Q03",
    );
    assert.deepEqual(trustedActor, { actorId: actor, isStaff });
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
  assert.deepEqual(client.orders.slice(0, 2), ["created_at", "id"]);
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

test("1.1 RPC input parser keeps fixed authoritative fields and rejects injection", () => {
  const parsed = parseVerifiedBoqV1_1RpcInput(boqInputRpcPayload());
  assert.equal(parsed.projectId, p6Ids.project);
  assert.equal(parsed.inputStateSha256, P6_SHA_A);
  assert.equal(parsed.input.engineVersion, "VERIFIED-BOQ-1.1");
  assert.equal(parsed.input.drawingMappings[0].source.rawQuantity, "4.75");
  assert.equal(parsed.input.drawingMappings[0].allocationFactor, "1");
  assert.equal(parsed.input.resources[0].unit, "m2");

  for (const mutate of [
    (value) => (value.resultSha256 = P6_SHA_B),
    (value) => (value.input.lines[0].finalQuantity = "999"),
    (value) => (value.input.drawingLinks[0].source.amount = "999"),
    (value) => (value.input.components[0].resource.unitPrice = "999"),
  ]) {
    const injected = structuredClone(boqInputRpcPayload());
    mutate(injected);
    assert.throws(() => parseVerifiedBoqV1_1RpcInput(injected), /P6B04|입력/);
  }
});

test("BOQ link put accepts only IDs factor and OCC version, supports partial and exact retry", async () => {
  const calls = [];
  const row = {
    id: p6Ids.drawingLink,
    project_id: p6Ids.project,
    quantity_link_id: p6Ids.quantity,
    boq_version_id: p6Ids.version,
    boq_line_id: p6Ids.line,
    allocation_factor: "0.5",
    version: 1,
    created_by: p6Ids.actor,
    updated_by: p6Ids.actor,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
  const client = rpcClient(p6Ids.actor, async (name, args) => {
    calls.push([name, args]);
    return { data: row, error: null };
  });
  const input = {
    id: p6Ids.drawingLink,
    quantityLinkId: p6Ids.quantity,
    boqVersionId: p6Ids.version,
    boqLineId: p6Ids.line,
    allocationFactor: "0.5",
    baseVersion: null,
  };
  assert.equal(
    (await putDrawingBoqLink(client, input)).allocationFactor,
    "0.5",
  );
  assert.deepEqual(calls[0], [
    "lukas_drawing_put_boq_link",
    {
      p_id: p6Ids.drawingLink,
      p_quantity_link_id: p6Ids.quantity,
      p_boq_version_id: p6Ids.version,
      p_boq_line_id: p6Ids.line,
      p_allocation_factor: "0.5",
      p_base_version: null,
    },
  ]);
  assert.deepEqual(
    await putDrawingBoqLink(client, input),
    await putDrawingBoqLink(client, input),
  );

  await assert.rejects(
    putDrawingBoqLink(client, { ...input, resultSha256: P6_SHA_A }),
    (error) => error.code === "P6B04",
  );
});

test("BOQ link put/delete bounds allocation, unit, authorization, project, and OCC failures", async () => {
  const input = {
    id: p6Ids.drawingLink,
    quantityLinkId: p6Ids.quantity,
    boqVersionId: p6Ids.version,
    boqLineId: p6Ids.line,
    allocationFactor: "1",
    baseVersion: 3,
  };
  for (const code of ["P6B04", "P6U01", "P6A01", "P6O01"]) {
    const client = rpcClient(p6Ids.actor, async () => ({
      data: null,
      error: { code, message: "database detail must stay bounded" },
    }));
    await assert.rejects(
      putDrawingBoqLink(client, input),
      (error) =>
        error.code === code && !error.message.includes("database detail"),
    );
  }
  await assert.rejects(
    putDrawingBoqLink(rpcClient(p6Ids.actor), {
      ...input,
      allocationFactor: "1.000000001",
    }),
    (error) => error.code === "P6B04",
  );
  const calls = [];
  await deleteDrawingBoqLink(
    rpcClient(p6Ids.actor, async (name, args) => {
      calls.push([name, args]);
      return { data: { id: p6Ids.drawingLink, deleted: true }, error: null };
    }),
    { id: p6Ids.drawingLink, baseVersion: 3 },
  );
  assert.deepEqual(calls[0], [
    "lukas_drawing_delete_boq_link",
    {
      p_id: p6Ids.drawingLink,
      p_base_version: 3,
    },
  ]);
});

test("1.1 submission calculates trusted input then compare-and-freezes exact hashes", async () => {
  const finalizeCalls = [];
  const result = await submitVerifiedBoqV1_1(
    rpcClient(p6Ids.actor, async (name) => {
      assert.equal(name, "lukas_qto_boq_v1_1_input");
      return { data: boqInputRpcPayload(), error: null };
    }),
    p6Ids.actor,
    p6Ids.version,
    {
      async finalize(args) {
        finalizeCalls.push(args);
        return args;
      },
      async loadFrozenInput() {
        throw new Error("not used");
      },
    },
  );
  assert.match(result.resultSha256, /^[0-9a-f]{64}$/);
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(finalizeCalls[0], {
    actorId: p6Ids.actor,
    versionId: p6Ids.version,
    inputStateSha256: P6_SHA_A,
    resultSha256: result.resultSha256,
    manifestSha256: result.manifestSha256,
    directCostKrw: "950",
    lineCount: 1,
  });
});

test("1.1 submission fails closed on uncalculated input and finalize race", async () => {
  const uncalculated = boqInputRpcPayload();
  uncalculated.input.components = [];
  await assert.rejects(
    submitVerifiedBoqV1_1(
      rpcClient(p6Ids.actor, async () => ({ data: uncalculated, error: null })),
      p6Ids.actor,
      p6Ids.version,
      freezeAuthority(),
    ),
    (error) => error.code === "P6B04",
  );
  await assert.rejects(
    submitVerifiedBoqV1_1(
      rpcClient(p6Ids.actor, async () => ({
        data: boqInputRpcPayload(),
        error: null,
      })),
      p6Ids.actor,
      p6Ids.version,
      freezeAuthority({ finalizeCode: "P6O01" }),
    ),
    (error) => error.code === "P6O01",
  );
  await assert.rejects(
    submitVerifiedBoqV1_1(
      rpcClient(p6Ids.reviewer, async () => ({
        data: boqInputRpcPayload(),
        error: null,
      })),
      p6Ids.actor,
      p6Ids.version,
      freezeAuthority(),
    ),
    (error) => error.code === "P6A01",
  );
});

test("1.1 decision reruns frozen hashes, requires an independent reviewer, and forwards no hashes", async () => {
  const payload = boqInputRpcPayload();
  const submitted = await submitVerifiedBoqV1_1(
    rpcClient(p6Ids.actor, async () => ({ data: payload, error: null })),
    p6Ids.actor,
    p6Ids.version,
    freezeAuthority(),
  );
  const rpcCalls = [];
  const reviewer = decisionClient({
    actorId: p6Ids.reviewer,
    version: {
      created_by: p6Ids.actor,
      status: "in_review",
      input_state_sha256: P6_SHA_A,
      result_sha256: submitted.resultSha256,
      manifest_sha256: submitted.manifestSha256,
    },
    rpcCalls,
  });
  await recheckAndDecideVerifiedBoqV1_1(
    reviewer,
    p6Ids.reviewer,
    { versionId: p6Ids.version, decision: "approved", note: "확인" },
    freezeAuthority({ payload }),
  );
  assert.deepEqual(rpcCalls, [
    [
      "lukas_qto_decide_boq",
      {
        p_version_id: p6Ids.version,
        p_decision: "approved",
        p_note: "확인",
      },
    ],
  ]);

  await assert.rejects(
    recheckAndDecideVerifiedBoqV1_1(
      decisionClient({
        actorId: p6Ids.actor,
        version: {
          created_by: p6Ids.actor,
          status: "in_review",
          input_state_sha256: P6_SHA_A,
          result_sha256: submitted.resultSha256,
          manifest_sha256: submitted.manifestSha256,
        },
      }),
      p6Ids.actor,
      { versionId: p6Ids.version, decision: "approved", note: "self" },
      freezeAuthority({ payload }),
    ),
    (error) => error.code === "P6A01",
  );
  await assert.rejects(
    recheckAndDecideVerifiedBoqV1_1(
      decisionClient({
        actorId: p6Ids.reviewer,
        version: {
          created_by: p6Ids.actor,
          status: "in_review",
          input_state_sha256: P6_SHA_A,
          result_sha256: P6_SHA_B,
          manifest_sha256: submitted.manifestSha256,
        },
      }),
      p6Ids.reviewer,
      { versionId: p6Ids.version, decision: "approved", note: "stale" },
      freezeAuthority({ payload }),
    ),
    (error) => error.code === "P6C01",
  );
});

function authorizedClient(actor, project, role) {
  return {
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: actor,
              is_anonymous: false,
              app_metadata: role === "staff" ? { role: "hangil_staff" } : {},
            },
          },
          error: null,
        };
      },
    },
    from(table) {
      const query = chain({
        data:
          table === "lukas_qto_projects"
            ? {
                id: project,
                owner_id:
                  role === "owner"
                    ? actor
                    : "00000000-0000-4000-8000-000000000099",
              }
            : { role },
        error: null,
      });
      return query;
    },
  };
}

function chain(result) {
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    in() {
      return query;
    },
    order() {
      return query;
    },
    gt() {
      return query;
    },
    or() {
      return query;
    },
    limit() {
      return Promise.resolve(result);
    },
    single() {
      return Promise.resolve(result);
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
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
      const rows = table === "lukas_drawing_quantity_links" ? quantities : [];
      const query = chain({ data: rows, error: null });
      query.order = (column) => {
        this.orders.push(column);
        return query;
      };
      query.limit = (size) =>
        Promise.resolve({ data: rows.slice(0, size), error: null });
      return query;
    },
  };
}

function exactEntryClient(ids) {
  const rows = {
    lukas_drawing_revisions: {
      id: ids.revision,
      document_id: ids.document,
      project_id: ids.project,
    },
    lukas_drawing_documents: {
      id: ids.document,
      project_id: ids.project,
      source_file_id: ids.file,
    },
    lukas_drawing_objects: {
      id: ids.object,
      revision_id: ids.revision,
      project_id: ids.project,
    },
    lukas_qto_boq_versions: { id: ids.boq, project_id: ids.project },
    lukas_qto_boq_lines: {
      id: ids.line,
      version_id: ids.boq,
      project_id: ids.project,
    },
    lukas_qto_files: ids.file
      ? { id: ids.file, project_id: ids.project, immutable: true, kind: "pdf" }
      : null,
  };
  return {
    from(table) {
      return chain({ data: rows[table], error: null });
    },
  };
}

function rpcClient(
  actorId,
  handler = async () => ({ data: null, error: null }),
) {
  return {
    auth: {
      async getUser() {
        return {
          data: {
            user: { id: actorId, is_anonymous: false, app_metadata: {} },
          },
          error: null,
        };
      },
    },
    rpc: handler,
  };
}

function freezeAuthority(options = {}) {
  return {
    async finalize(args) {
      if (options.finalizeCode)
        throw Object.assign(new Error("database detail"), {
          code: options.finalizeCode,
        });
      return args;
    },
    async loadFrozenInput() {
      return options.payload ?? boqInputRpcPayload();
    },
  };
}

function decisionClient({ actorId, version, rpcCalls = [] }) {
  return {
    auth: {
      async getUser() {
        return {
          data: {
            user: { id: actorId, is_anonymous: false, app_metadata: {} },
          },
          error: null,
        };
      },
    },
    from(table) {
      assert.equal(table, "lukas_qto_boq_versions");
      return chain({
        data: { id: p6Ids.version, project_id: p6Ids.project, ...version },
        error: null,
      });
    },
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      return { data: null, error: null };
    },
  };
}
