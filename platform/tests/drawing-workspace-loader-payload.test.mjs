import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  compactDrawingCollaborationBootstrapForLoader,
  compactDrawingServerMeasurementEvidence,
  compactDrawingWorkspaceForLoader,
  decodeDrawingServerMeasurementEvidence,
  hydrateDrawingServerMeasurementEvidence,
} from "../app/lukas/lib/drawing-workspace-loader-payload.ts";
import {
  deriveDrawingServerMeasurementEvidence,
  drawingMeasurementEvidenceCurrent,
  resolveDrawingServerEvidenceStatus,
} from "../app/lukas/lib/drawing-semantic-schedules.ts";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  document: "00000000-0000-4000-8000-000000000003",
  revision: "00000000-0000-4000-8000-000000000004",
  page: "00000000-0000-4000-8000-000000000005",
  canvas: "00000000-0000-4000-8000-000000000006",
  layer: "00000000-0000-4000-8000-000000000007",
};

const objectId = (index) =>
  `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function operationSha256(outcome) {
  return createHash("sha256")
    .update(
      canonicalJson({
        actorId: outcome.actorId,
        baseVersions: outcome.baseVersions,
        clientOperationId: outcome.clientOperationId,
        forward: outcome.forward,
        inverse: outcome.inverse,
        revisionId: outcome.revisionId,
        schemaVersion: 1,
        type: outcome.operationType,
      }),
    )
    .digest("hex");
}

function drawingObjects(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: objectId(index),
    name: `line-${index + 1}`,
    layerId: ids.layer,
    geometry: {
      type: "line",
      start: { x: index, y: 0 },
      end: { x: index + 10, y: 0 },
    },
    styleId: null,
    style: {},
    version: 1,
  }));
}

function canonicalObjects(objects) {
  return objects.map((object) => ({
    ...object,
    lineageId: object.id,
    pageId: ids.page,
    type: object.geometry.type,
  }));
}

function bootstrap(objects, recentOutcomes = []) {
  return {
    canonicalJson: {
      schemaVersion: 2,
      revision: {
        id: ids.revision,
        documentId: ids.document,
        projectId: ids.project,
        sequence: 1,
        version: 3,
      },
      sources: [],
      pages: [],
      canvases: [],
      layers: [],
      objects: canonicalObjects(objects),
      styles: [],
      blocks: [],
      blockInstances: [],
      propertySchemas: [],
      propertyValues: [],
      tables: [],
      issues: [],
      operationSequence: 25,
    },
    operationSequence: 25,
    schemaVersion: 2,
    sha256: "a".repeat(64),
    revisionStatus: "draft",
    capability: "editor",
    canWrite: true,
    recentOutcomes,
  };
}

function measurementEvidence(objects) {
  return deriveDrawingServerMeasurementEvidence({
    documentId: ids.document,
    revisionId: ids.revision,
    revisionVersion: 3,
    snapshotSha256: "a".repeat(64),
    operationCheckpoint: 25,
    state: {
      revisionId: ids.revision,
      objects: Object.fromEntries(objects.map((object) => [object.id, object])),
    },
  });
}

test("loader measurement wire keeps exact server evidence without repeating checkpoint lineage", () => {
  const objects = drawingObjects(120);
  const evidence = measurementEvidence(objects);
  const authoritative = bootstrap(objects);

  const wire = compactDrawingServerMeasurementEvidence(evidence, authoritative);
  const hydrated = hydrateDrawingServerMeasurementEvidence(wire, authoritative);

  assert.deepEqual(hydrated, evidence);
  assert.ok(
    Buffer.byteLength(JSON.stringify(wire)) <
      Buffer.byteLength(JSON.stringify(evidence)) * 0.45,
    "the loader wire must remove per-object lineage duplication",
  );
  assert.deepEqual(Object.keys(wire).sort(), [
    "documentId",
    "measurements",
    "operationCheckpoint",
    "revisionId",
    "revisionVersion",
    "ruleVersion",
    "schedules",
    "snapshotSha256",
  ]);
  assert.equal(wire.measurements[0].length, 4);
});

test("measurement wire fails closed when its SHA-bound canonical object graph changes", () => {
  const objects = drawingObjects(2);
  const authoritative = bootstrap(objects);
  const wire = compactDrawingServerMeasurementEvidence(
    measurementEvidence(objects),
    authoritative,
  );
  const changed = structuredClone(authoritative);
  changed.canonicalJson.objects[0].geometry = {
    type: "text",
    origin: { x: 0, y: 0 },
    width: 10,
    text: "changed",
  };
  assert.throws(
    () => hydrateDrawingServerMeasurementEvidence(wire, changed),
    /fingerprint|canonical|measurement/i,
  );

  const missing = structuredClone(wire);
  missing.measurements.pop();
  assert.throws(
    () => hydrateDrawingServerMeasurementEvidence(missing, authoritative),
    /canonical|measurement/i,
  );
  const reordered = structuredClone(wire);
  reordered.measurements.reverse();
  assert.throws(
    () => hydrateDrawingServerMeasurementEvidence(reordered, authoritative),
    /canonical|measurement/i,
  );
  assert.throws(
    () =>
      hydrateDrawingServerMeasurementEvidence(wire, {
        ...authoritative,
        sha256: "b".repeat(64),
      }),
    /bootstrap lineage/i,
  );
  for (const invalid of ["1e3", "01", "1.0", "-1", "x".repeat(129)]) {
    const malformed = structuredClone(wire);
    malformed.measurements[0][1] = invalid;
    assert.throws(
      () => hydrateDrawingServerMeasurementEvidence(malformed, authoritative),
      /measurement tuple/i,
    );
  }
});

test("bootstrap graph and SHA are one trusted envelope while later same-type edits stay stale", () => {
  const objects = drawingObjects(2);
  const authoritative = bootstrap(objects);
  const wire = compactDrawingServerMeasurementEvidence(
    measurementEvidence(objects),
    authoritative,
  );
  const evidence = hydrateDrawingServerMeasurementEvidence(wire, authoritative);
  const changedObjects = structuredClone(objects);
  changedObjects[0].geometry.end.x += 1;
  const changedBootstrap = structuredClone(authoritative);
  changedBootstrap.canonicalJson.objects = canonicalObjects(changedObjects);

  // No synchronous client re-hash: the loader owns canonicalJson + sha256 as
  // one inseparable server authority. Hydration therefore accepts this
  // impossible same-envelope mutation, but its derived fingerprint changes.
  const changedEvidence = hydrateDrawingServerMeasurementEvidence(
    wire,
    changedBootstrap,
  );
  assert.notEqual(
    changedEvidence.objectFingerprints[objects[0].id],
    evidence.objectFingerprints[objects[0].id],
  );
  const current = drawingMeasurementEvidenceCurrent(
    {
      documentId: ids.document,
      revisionId: ids.revision,
      revisionVersion: 3,
      snapshotSha256: "a".repeat(64),
      operationCheckpoint: 25,
    },
    {
      revisionId: ids.revision,
      objects: Object.fromEntries(
        changedObjects.map((object) => [object.id, object]),
      ),
    },
    false,
  );
  assert.deepEqual(resolveDrawingServerEvidenceStatus(evidence, current), {
    status: "stale",
    reason: "objects",
  });
});

test("malformed loader evidence is contained as a bounded inspector error", () => {
  const objects = drawingObjects(2);
  const authoritative = bootstrap(objects);
  const wire = compactDrawingServerMeasurementEvidence(
    measurementEvidence(objects),
    authoritative,
  );
  wire.measurements.pop();
  assert.deepEqual(
    decodeDrawingServerMeasurementEvidence(wire, authoritative),
    {
      evidence: null,
      error: {
        code: "measurement_derivation_failed",
        message: "서버 측정 증거를 계산하지 못했습니다.",
      },
    },
  );
});

test("loader workspace projection retains workflow metadata but sends the graph only once", () => {
  const objects = drawingObjects(120);
  const graph = canonicalObjects(objects);
  const workspace = {
    primarySource: null,
    templateCandidates: [{ revisionId: ids.revision }],
    document: {
      id: ids.document,
      project_id: ids.project,
      source_file_id: null,
      source_sha256: null,
      title: "Payload test",
      created_by: ids.actor,
      created_at: "2026-09-02T00:00:00.000Z",
      updated_at: "2026-09-02T00:00:00.000Z",
      revision: {
        id: ids.revision,
        document_id: ids.document,
        project_id: ids.project,
        parent_revision_id: null,
        sequence: 1,
        status: "draft",
        version: 3,
        created_by: ids.actor,
        review_requested_at: null,
        approved_at: null,
        created_at: "2026-09-02T00:00:00.000Z",
        updated_at: "2026-09-02T00:00:00.000Z",
        activePageId: ids.page,
        activeCanvasId: ids.canvas,
        pages: [
          {
            id: ids.page,
            canvases: [{ id: ids.canvas }],
            layers: [{ id: ids.layer }],
            objects: graph,
            blockInstances: [],
          },
        ],
        canvases: [{ id: ids.canvas }],
        layers: [{ id: ids.layer }],
        objects: graph,
        sources: [],
        styles: [],
        blocks: [],
        blockInstances: [],
        propertySchemas: [],
        propertyValues: [],
        tables: [],
        issues: [{ id: objectId(500), title: "검토", status: "open" }],
        issueLinks: [
          {
            id: objectId(501),
            object_id: objects[0].id,
            issue_id: objectId(500),
          },
        ],
        reviewEvidence: null,
        checkpoints: [
          {
            id: objectId(502),
            createdAt: "2026-09-02T00:00:00.000Z",
            canonicalJson: { schemaVersion: 2 },
          },
        ],
      },
    },
  };

  const compact = compactDrawingWorkspaceForLoader(
    workspace,
    bootstrap(objects),
  );
  const revision = compact.document.revision;
  assert.equal(compact.document.title, "Payload test");
  assert.equal(revision.activePageId, ids.page);
  assert.equal(revision.activeCanvasId, ids.canvas);
  assert.deepEqual(revision.issues, workspace.document.revision.issues);
  assert.deepEqual(revision.issueLinks, workspace.document.revision.issueLinks);
  assert.deepEqual(
    revision.checkpoints,
    workspace.document.revision.checkpoints,
  );
  for (const key of [
    "pages",
    "canvases",
    "layers",
    "objects",
    "sources",
    "styles",
    "blocks",
    "blockInstances",
    "propertySchemas",
    "propertyValues",
    "tables",
  ])
    assert.deepEqual(revision[key], [], `${key} must come from canonicalJson`);
  assert.deepEqual(compact.templateCandidates, []);
  assert.ok(
    Buffer.byteLength(JSON.stringify(compact)) <
      Buffer.byteLength(JSON.stringify(workspace)) * 0.1,
  );
});

test("loader collaboration projection keeps the bounded acknowledgement proof", () => {
  const objects = drawingObjects(1);
  const outcome = {
    revisionId: ids.revision,
    clientOperationId: objectId(800),
    actorId: ids.actor,
    operationType: "add_objects",
    baseVersions: {},
    forward: { type: "add_objects", objects: canonicalObjects(objects) },
    inverse: { type: "delete_objects", objectIds: [objects[0].id] },
    sequence: 25,
    resultVersions: { [objects[0].id]: 1 },
  };
  outcome.operationSha256 = operationSha256(outcome);
  const full = bootstrap(objects, [outcome]);
  const compact = compactDrawingCollaborationBootstrapForLoader(full);

  assert.deepEqual(compact.recentOutcomes, [
    {
      revisionId: ids.revision,
      clientOperationId: outcome.clientOperationId,
      actorId: ids.actor,
      sequence: 25,
      resultVersions: outcome.resultVersions,
      operationSha256: outcome.operationSha256,
    },
  ]);
  assert.deepEqual(compact.canonicalJson, full.canonicalJson);
  assert.ok(
    Buffer.byteLength(JSON.stringify(compact)) <
      Buffer.byteLength(JSON.stringify(full)),
  );
});

test("loader collaboration receipts retain bounded result-version proof without operation bodies", () => {
  const objects = drawingObjects(1);
  const resultVersions = Object.fromEntries(
    Array.from({ length: 100 }, (_, index) => [objectId(index + 1_000), 1]),
  );
  const recentOutcomes = Array.from({ length: 112 }, (_, index) => {
    const outcome = {
      revisionId: ids.revision,
      clientOperationId: objectId(index + 2_000),
      actorId: ids.actor,
      operationType: "update_objects",
      baseVersions: resultVersions,
      forward: {
        type: "delete_objects",
        objectIds: Object.keys(resultVersions),
      },
      inverse: {
        type: "delete_objects",
        objectIds: Object.keys(resultVersions),
      },
      sequence: index + 1,
      resultVersions,
    };
    return { ...outcome, operationSha256: operationSha256(outcome) };
  });
  const full = bootstrap(objects, recentOutcomes);
  full.operationSequence = recentOutcomes.length;
  full.canonicalJson.operationSequence = recentOutcomes.length;
  const compact = compactDrawingCollaborationBootstrapForLoader(full);
  const fullReceiptsBytes = Buffer.byteLength(
    JSON.stringify(full.recentOutcomes),
  );
  const compactReceiptsJson = JSON.stringify(compact.recentOutcomes);

  assert.equal(compact.recentOutcomes.length, recentOutcomes.length);
  assert.deepEqual(
    compact.recentOutcomes.map((outcome) => outcome.resultVersions),
    recentOutcomes.map((outcome) => outcome.resultVersions),
  );
  assert.ok(
    compact.recentOutcomes.every(
      (outcome) =>
        "resultVersions" in outcome &&
        !("forward" in outcome) &&
        !("inverse" in outcome) &&
        /^[0-9a-f]{64}$/.test(outcome.operationSha256),
    ),
  );
  assert.ok(
    Buffer.byteLength(compactReceiptsJson) < fullReceiptsBytes * 0.35,
    "the loader must retain result proof without repeating full operation bodies",
  );
  assert.match(compactReceiptsJson, new RegExp(objectId(1_000)));
});

test("loader collaboration projection rejects receipts outside the authoritative checkpoint", () => {
  const objects = drawingObjects(1);
  const first = {
    revisionId: ids.revision,
    clientOperationId: objectId(800),
    actorId: ids.actor,
    sequence: 24,
    resultVersions: {},
    operationSha256: "a".repeat(64),
  };
  const second = {
    ...first,
    clientOperationId: objectId(801),
    sequence: 25,
  };
  const cases = [
    [{ ...first, revisionId: ids.document }],
    [first, { ...second, clientOperationId: first.clientOperationId }],
    [first, { ...second, sequence: first.sequence }],
    [second, first],
    [{ ...first, sequence: 26 }],
  ];

  for (const recentOutcomes of cases)
    assert.throws(
      () =>
        compactDrawingCollaborationBootstrapForLoader(
          bootstrap(objects, recentOutcomes),
        ),
      /collaboration bootstrap outcomes are invalid/i,
    );
});

test("loader collaboration receipt proof stays bounded to 256 outcomes", () => {
  const recentOutcomes = Array.from({ length: 257 }, (_, index) => ({
    revisionId: ids.revision,
    clientOperationId: objectId(index + 3_000),
    actorId: ids.actor,
    sequence: index + 1,
    resultVersions: {},
    operationSha256: "a".repeat(64),
  }));
  const full = bootstrap([], recentOutcomes);
  full.operationSequence = recentOutcomes.length;
  full.canonicalJson.operationSequence = recentOutcomes.length;

  assert.throws(
    () => compactDrawingCollaborationBootstrapForLoader(full),
    /collaboration bootstrap outcomes are invalid/i,
  );
});
