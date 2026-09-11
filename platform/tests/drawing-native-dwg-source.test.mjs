import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

import { buildNativeDrawingTemplate } from "../app/lukas/lib/drawing-native-templates.ts";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const nativeSources = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-source.server.ts")
  .catch(() => ({}));
test.after(() => vite.close());

const ids = {
  project: "91000000-0000-4000-8900-000000000001",
  document: "91000000-0000-4000-8900-000000000002",
  issue: "91000000-0000-4000-8900-000000000003",
};

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function lineageId(index) {
  return `91000000-0000-4000-8900-${String(index + 100).padStart(12, "0")}`;
}

function approvedNativeSource() {
  const template = buildNativeDrawingTemplate("measured-plan");
  const structure = structuredClone(template.structure);
  const canvasId = Object.keys(structure.canvases)[0];
  const layers = Object.values(structure.layers).map((layer) => ({
    ...layer,
    pageId: structure.canvases[layer.canvasId].pageId,
  }));
  const objects = Object.values(structure.objects).map((object, index) => ({
    ...object,
    lineageId: lineageId(index),
    pageId:
      structure.canvases[structure.layers[object.layerId].canvasId].pageId,
    type: object.geometry.type,
  }));
  const canonicalJson = {
    schemaVersion: 2,
    revision: {
      id: structure.revisionId,
      documentId: ids.document,
      projectId: ids.project,
      sequence: 3,
      version: 7,
    },
    sources: [],
    pages: Object.values(structure.pages),
    canvases: Object.values(structure.canvases).map((canvas) => ({
      ...canvas,
      outputProfile: structuredClone(template.outputProfile),
    })),
    layers,
    objects,
    styles: Object.values(structure.styles),
    blocks: Object.values(structure.blocks),
    blockInstances: Object.values(structure.blockInstances),
    propertySchemas: Object.values(structure.propertySchemas),
    propertyValues: Object.values(structure.propertyValues),
    tables: Object.values(structure.tables),
    issues: [{ id: ids.issue, objectId: objects[0].id }],
    operationSequence: 19,
  };
  const canonicalJsonText = JSON.stringify(canonicalJson);
  const snapshotSha256 = sha256(canonicalJsonText);
  const request = {
    projectId: ids.project,
    documentId: ids.document,
    revisionId: structure.revisionId,
    revisionVersion: 7,
    canvasId,
    snapshotSha256,
  };
  const payload = {
    projectId: ids.project,
    documentId: ids.document,
    canvasId,
    revision: {
      id: structure.revisionId,
      sequence: 3,
      version: 7,
      status: "approved",
    },
    snapshot: {
      sha256: snapshotSha256,
      schemaVersion: 2,
      operationSequence: 19,
      canonicalJsonText,
    },
    approvalDecision: "approved",
  };
  return { request, payload, canonicalJson, canonicalJsonText, template };
}

function literalApprovedLineSource() {
  const revisionId = "92000000-0000-4000-8900-000000000001";
  const pageId = "92000000-0000-4000-8900-000000000002";
  const canvasId = "92000000-0000-4000-8900-000000000003";
  const layerId = "92000000-0000-4000-8900-000000000004";
  const objectId = "92000000-0000-4000-8900-000000000005";
  const canonicalJson = {
    schemaVersion: 2,
    revision: {
      id: revisionId,
      documentId: ids.document,
      projectId: ids.project,
      sequence: 3,
      version: 7,
    },
    sources: [],
    pages: [
      { id: pageId, revisionId, name: "Literal page", sortOrder: 0, version: 1 },
    ],
    canvases: [
      {
        id: canvasId,
        pageId,
        name: "Literal canvas",
        spaceKind: "paper",
        widthMillimeters: 21_000,
        heightMillimeters: 14_850,
        background: null,
        outputProfile: {
          paper: "A3",
          orientation: "landscape",
          widthMillimeters: 420,
          heightMillimeters: 297,
          scaleDenominator: 50,
        },
        sortOrder: 0,
        version: 1,
      },
    ],
    layers: [
      {
        id: layerId,
        canvasId,
        pageId,
        name: "Literal work",
        visible: true,
        locked: false,
        systemKind: "work",
        sortOrder: 0,
        version: 1,
      },
    ],
    objects: [
      {
        id: objectId,
        lineageId: "92000000-0000-4000-8900-000000000006",
        pageId,
        type: "line",
        name: "Literal line",
        layerId,
        geometry: {
          type: "line",
          start: { x: 125.25, y: -80.5 },
          end: { x: 725.75, y: -340.25 },
        },
        styleId: null,
        style: { stroke: "#123456", strokeWidth: 25, fill: null },
        version: 1,
      },
    ],
    styles: [],
    blocks: [],
    blockInstances: [],
    propertySchemas: [],
    propertyValues: [],
    tables: [],
    issues: [],
    operationSequence: 19,
  };
  const canonicalJsonText = JSON.stringify(canonicalJson);
  const snapshotSha256 = sha256(canonicalJsonText);
  return {
    request: {
      projectId: ids.project,
      documentId: ids.document,
      revisionId,
      revisionVersion: 7,
      canvasId,
      snapshotSha256,
    },
    payload: {
      projectId: ids.project,
      documentId: ids.document,
      canvasId,
      revision: { id: revisionId, sequence: 3, version: 7, status: "approved" },
      snapshot: {
        sha256: snapshotSha256,
        schemaVersion: 2,
        operationSequence: 19,
        canonicalJsonText,
      },
      approvalDecision: "approved",
    },
    layerId,
    objectId,
  };
}

function refreshCanonicalPayload(fixture) {
  fixture.payload.snapshot.canonicalJsonText = JSON.stringify(
    fixture.canonicalJson,
  );
  fixture.payload.snapshot.sha256 = sha256(
    fixture.payload.snapshot.canonicalJsonText,
  );
  fixture.request.snapshotSha256 = fixture.payload.snapshot.sha256;
}

async function assertUnavailable(operation, preserved = []) {
  const before = preserved.map((value) => JSON.stringify(value));
  await assert.rejects(operation, (error) => {
    assert.equal(error?.name, "DrawingNativeDwgSourceError");
    assert.equal(error?.code, "NATIVE_DWG_SOURCE_UNAVAILABLE");
    assert.equal(error?.message, "Approved native DWG source is unavailable.");
    assert.doesNotMatch(error.message, /select|canonical|sql|payload|91000000/i);
    return true;
  });
  assert.deepEqual(
    preserved.map((value) => JSON.stringify(value)),
    before,
  );
}

test("approved native template returns an unchanged CAD manifest and separate deterministic authority lineage", async () => {
  assert.equal(
    typeof nativeSources.projectApprovedNativeDrawingCadSource,
    "function",
  );
  const fixture = approvedNativeSource();
  const requestBefore = JSON.stringify(fixture.request);
  const payloadBefore = JSON.stringify(fixture.payload);

  const result = await nativeSources.projectApprovedNativeDrawingCadSource(
    fixture.request,
    fixture.payload,
  );

  assert.equal(result.manifest.scope.projectId, ids.project);
  assert.equal(result.manifest.scope.documentId, ids.document);
  assert.equal(result.manifest.scope.revisionId, fixture.request.revisionId);
  assert.equal(result.manifest.scope.operationSequence, 19);
  assert.equal(result.manifest.canvas.id, fixture.request.canvasId);
  assert.deepEqual(
    result.manifest.canvas.outputProfile,
    fixture.template.outputProfile,
  );
  assert.notEqual(
    result.manifest.scope.structureSha256,
    fixture.request.snapshotSha256,
  );
  assert.deepEqual(result.authority, {
    projectId: ids.project,
    documentId: ids.document,
    revisionId: fixture.request.revisionId,
    revisionSequence: 3,
    revisionVersion: 7,
    operationSequence: 19,
    canvasId: fixture.request.canvasId,
    snapshotSha256: fixture.request.snapshotSha256,
    schemaVersion: 2,
    approvalDecision: "approved",
    revisionStatus: "approved",
    lineage: {
      layers: fixture.canonicalJson.layers
        .map(({ id, pageId }) => ({ id, pageId }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      objects: fixture.canonicalJson.objects
        .map(({ id, lineageId, pageId, type }) => ({
          id,
          lineageId,
          pageId,
          type,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      issues: structuredClone(fixture.canonicalJson.issues),
    },
  });
  assert.equal(JSON.stringify(fixture.request), requestBefore);
  assert.equal(JSON.stringify(fixture.payload), payloadBefore);
});

test("approved native lineage orders same-id issue links by object id independently of input order", async () => {
  const first = approvedNativeSource();
  const objects = first.canonicalJson.objects;
  first.canonicalJson.issues = [
    { id: ids.issue, objectId: objects[1].id },
    { id: ids.issue, objectId: objects[0].id },
  ];
  refreshCanonicalPayload(first);
  const firstRequestBefore = JSON.stringify(first.request);
  const firstPayloadBefore = JSON.stringify(first.payload);

  const second = structuredClone(first);
  second.canonicalJson.issues.reverse();
  refreshCanonicalPayload(second);
  const secondRequestBefore = JSON.stringify(second.request);
  const secondPayloadBefore = JSON.stringify(second.payload);

  const firstResult =
    await nativeSources.projectApprovedNativeDrawingCadSource(
      first.request,
      first.payload,
    );
  const secondResult =
    await nativeSources.projectApprovedNativeDrawingCadSource(
      second.request,
      second.payload,
    );
  const expectedIssues = [
    { id: ids.issue, objectId: objects[0].id },
    { id: ids.issue, objectId: objects[1].id },
  ];

  assert.deepEqual(firstResult.authority.lineage.issues, expectedIssues);
  assert.deepEqual(secondResult.authority.lineage.issues, expectedIssues);
  assert.deepEqual(
    firstResult.authority.lineage.issues,
    secondResult.authority.lineage.issues,
  );
  assert.equal(JSON.stringify(first.request), firstRequestBefore);
  assert.equal(JSON.stringify(first.payload), firstPayloadBefore);
  assert.equal(JSON.stringify(second.request), secondRequestBefore);
  assert.equal(JSON.stringify(second.payload), secondPayloadBefore);
});

test("approved literal canonical line projects exact independent CAD geometry", async () => {
  const fixture = literalApprovedLineSource();

  const result = await nativeSources.projectApprovedNativeDrawingCadSource(
    fixture.request,
    fixture.payload,
  );

  assert.deepEqual(result.manifest.entities, [
    {
      id: `object/${fixture.objectId}/0`,
      layerId: fixture.layerId,
      style: {
        stroke: "#123456",
        strokeWidth: 25,
        fill: null,
        kind: "resolved",
        requestedPaperLineweightMillimeters: 0.5,
      },
      geometry: {
        type: "line",
        start: { x: 125.25, y: 80.5 },
        end: { x: 725.75, y: 340.25 },
      },
    },
  ]);
  assert.deepEqual(result.manifest.lineage, [
    {
      id: fixture.objectId,
      kind: "object",
      name: "Literal line",
      version: 1,
      entityIds: [`object/${fixture.objectId}/0`],
    },
  ]);
});

test("loader calls the authenticated read-only RPC once with only exact named scope", async () => {
  const fixture = approvedNativeSource();
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: fixture.payload, error: null };
    },
  };

  const result = await nativeSources.loadApprovedNativeDrawingCadSource(
    client,
    fixture.request,
  );

  assert.equal(result.authority.snapshotSha256, fixture.request.snapshotSha256);
  assert.deepEqual(calls, [
    {
      name: "lukas_qto_drawing_native_dwg_source",
      args: {
        p_project_id: fixture.request.projectId,
        p_document_id: fixture.request.documentId,
        p_revision_id: fixture.request.revisionId,
        p_revision_version: 7,
        p_canvas_id: fixture.request.canvasId,
        p_snapshot_sha256: fixture.request.snapshotSha256,
      },
    },
  ]);
  assert.equal("authenticated" in result.authority, false);
  assert.equal("digestVerified" in result.authority, false);
  assert.equal("canonicalJsonText" in result.authority, false);
});

test("request and returned authority scope must match exactly", async (t) => {
  const cases = [
    ["project", (fixture) => void (fixture.payload.projectId = ids.issue)],
    ["document", (fixture) => void (fixture.payload.documentId = ids.issue)],
    ["revision", (fixture) => void (fixture.payload.revision.id = ids.issue)],
    ["version", (fixture) => void (fixture.payload.revision.version = 8)],
    ["canvas", (fixture) => void (fixture.payload.canvasId = ids.issue)],
    ["digest", (fixture) => void (fixture.payload.snapshot.sha256 = "b".repeat(64))],
  ];
  for (const [name, mutate] of cases)
    await t.test(name, async () => {
      const fixture = approvedNativeSource();
      mutate(fixture);
      await assertUnavailable(
        () =>
          nativeSources.projectApprovedNativeDrawingCadSource(
            fixture.request,
            fixture.payload,
          ),
        [fixture.request, fixture.payload],
      );
    });
});

test("tampered or malformed PostgreSQL text never becomes an approved source", async (t) => {
  const cases = [
    [
      "tampered text",
      (fixture) =>
        void (fixture.payload.snapshot.canonicalJsonText += " "),
    ],
    [
      "wrong hash",
      (fixture) => void (fixture.payload.snapshot.sha256 = "c".repeat(64)),
    ],
    [
      "malformed hashed JSON",
      (fixture) => {
        fixture.payload.snapshot.canonicalJsonText = "{";
        fixture.payload.snapshot.sha256 = sha256("{");
        fixture.request.snapshotSha256 = fixture.payload.snapshot.sha256;
      },
    ],
  ];
  for (const [name, mutate] of cases)
    await t.test(name, async () => {
      const fixture = approvedNativeSource();
      mutate(fixture);
      await assertUnavailable(
        () =>
          nativeSources.projectApprovedNativeDrawingCadSource(
            fixture.request,
            fixture.payload,
          ),
        [fixture.request, fixture.payload],
      );
    });
});

test("revision, approval and canonical identity must remain approved and exact", async (t) => {
  const cases = [
    ["reviewed status", (fixture) => void (fixture.payload.revision.status = "reviewed")],
    ["draft status", (fixture) => void (fixture.payload.revision.status = "draft")],
    ["wrong decision", (fixture) => void (fixture.payload.approvalDecision = "reviewed")],
    [
      "revision sequence",
      (fixture) => void (fixture.canonicalJson.revision.sequence = 4),
    ],
    [
      "operation sequence",
      (fixture) => void (fixture.canonicalJson.operationSequence = 18),
    ],
    [
      "canonical project",
      (fixture) => void (fixture.canonicalJson.revision.projectId = ids.issue),
    ],
    [
      "canonical document",
      (fixture) => void (fixture.canonicalJson.revision.documentId = ids.issue),
    ],
  ];
  for (const [name, mutate] of cases)
    await t.test(name, async () => {
      const fixture = approvedNativeSource();
      mutate(fixture);
      if (name.startsWith("canonical") || name.includes("sequence"))
        refreshCanonicalPayload(fixture);
      await assertUnavailable(
        () =>
          nativeSources.projectApprovedNativeDrawingCadSource(
            fixture.request,
            fixture.payload,
          ),
        [fixture.request, fixture.payload],
      );
    });
});

test("native projection rejects missing profiles, sources, backgrounds, extra canvases and unsupported geometry", async (t) => {
  const cases = [
    [
      "missing persisted profile",
      (fixture) => void delete fixture.canonicalJson.canvases[0].outputProfile,
    ],
    [
      "object source",
      (fixture) => {
        const object = fixture.canonicalJson.objects[0];
        fixture.canonicalJson.sources.push({
          id: "91000000-0000-4000-8900-000000000004",
          objectId: object.id,
          revisionId: fixture.request.revisionId,
          sourceFileId: "91000000-0000-4000-8900-000000000005",
          sourceSha256: "d".repeat(64),
          sourceKind: "pdf_region",
          pdfPageNumber: 1,
          x: 0.1,
          y: 0.1,
          width: 0.2,
          height: 0.2,
          version: 1,
        });
      },
    ],
    [
      "canvas background",
      (fixture) => {
        fixture.canonicalJson.canvases[0].background = {
          sourceFileId: "91000000-0000-4000-8900-000000000005",
          sourceSha256: "d".repeat(64),
          pdfPageNumber: 1,
          calibration: null,
        };
      },
    ],
    [
      "additional canvas",
      (fixture) => {
        fixture.canonicalJson.canvases.push({
          ...structuredClone(fixture.canonicalJson.canvases[0]),
          id: "91000000-0000-4000-8900-000000000006",
        });
      },
    ],
    [
      "unsupported entity",
      (fixture) => {
        fixture.canonicalJson.objects[0].type = "spline";
        fixture.canonicalJson.objects[0].geometry = {
          type: "spline",
          points: [],
        };
      },
    ],
  ];
  for (const [name, mutate] of cases)
    await t.test(name, async () => {
      const fixture = approvedNativeSource();
      mutate(fixture);
      refreshCanonicalPayload(fixture);
      await assertUnavailable(
        () =>
          nativeSources.projectApprovedNativeDrawingCadSource(
            fixture.request,
            fixture.payload,
          ),
        [fixture.request, fixture.payload],
      );
    });
});

test("canonical preimage is bounded before parsing", async () => {
  const fixture = approvedNativeSource();
  fixture.payload.snapshot.canonicalJsonText = " ".repeat(20 * 1024 * 1024 + 1);
  fixture.payload.snapshot.sha256 = sha256(
    fixture.payload.snapshot.canonicalJsonText,
  );
  fixture.request.snapshotSha256 = fixture.payload.snapshot.sha256;
  await assertUnavailable(
    () =>
      nativeSources.projectApprovedNativeDrawingCadSource(
        fixture.request,
        fixture.payload,
      ),
    [fixture.request, fixture.payload],
  );
});

test("strict malformed requests and payloads fail without calling RPC", async (t) => {
  const requestCases = [
    null,
    {},
    { ...approvedNativeSource().request, revisionVersion: 0 },
    {
      ...approvedNativeSource().request,
      revisionVersion: Number.MAX_SAFE_INTEGER + 1,
    },
    { ...approvedNativeSource().request, browserActorId: ids.issue },
  ];
  for (const [index, request] of requestCases.entries())
    await t.test(`request ${index + 1}`, async () => {
      let calls = 0;
      await assertUnavailable(
        () =>
          nativeSources.loadApprovedNativeDrawingCadSource(
            { rpc: async () => (calls += 1) },
            request,
          ),
        request ? [request] : [],
      );
      assert.equal(calls, 0);
    });

  const fixture = approvedNativeSource();
  await assertUnavailable(
    () =>
      nativeSources.projectApprovedNativeDrawingCadSource(fixture.request, {
        ...fixture.payload,
        actorId: ids.issue,
      }),
    [fixture.request, fixture.payload],
  );
});

test("RPC exceptions, returned errors, nulls and malformed payloads use one bounded error with no fallback", async (t) => {
  const fixture = approvedNativeSource();
  const cases = [
    ["exception", async () => Promise.reject(new Error("select secret from payload"))],
    ["returned error", async () => ({ data: fixture.payload, error: { message: "SQL secret" } })],
    ["null", async () => ({ data: null, error: null })],
    ["malformed", async () => ({ data: { projectId: ids.project }, error: null })],
  ];
  for (const [name, rpc] of cases)
    await t.test(name, async () => {
      let calls = 0;
      await assertUnavailable(
        () =>
          nativeSources.loadApprovedNativeDrawingCadSource(
            {
              rpc: async (...args) => {
                calls += 1;
                return rpc(...args);
              },
            },
            fixture.request,
          ),
        [fixture.request, fixture.payload],
      );
      assert.equal(calls, 1);
    });
});
