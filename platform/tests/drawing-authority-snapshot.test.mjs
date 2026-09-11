import assert from "node:assert/strict";
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
const authoritySnapshots = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-authority-snapshot.server.ts")
  .catch(() => ({}));
test.after(() => vite.close());

const ids = {
  project: "90000000-0000-4000-8900-000000000001",
  document: "90000000-0000-4000-8900-000000000002",
  issue: "90000000-0000-4000-8900-000000000099",
};
const snapshotSha256 = "a".repeat(64);

function lineageId(index) {
  return `90000000-0000-4000-8900-${String(index + 100).padStart(12, "0")}`;
}

function approvedTemplateSnapshot() {
  const template = buildNativeDrawingTemplate("measured-plan");
  const sourceBytes = JSON.stringify(template);
  const structure = template.structure;
  const pages = Object.values(structure.pages).map((page) => ({ ...page }));
  const canvases = Object.values(structure.canvases).map((canvas) => ({
    ...canvas,
    outputProfile: { ...template.outputProfile },
  }));
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
    sources: Object.values(structure.sources),
    pages,
    canvases,
    layers,
    objects,
    styles: Object.values(structure.styles),
    blocks: Object.values(structure.blocks),
    blockInstances: Object.values(structure.blockInstances),
    propertySchemas: Object.values(structure.propertySchemas),
    propertyValues: Object.values(structure.propertyValues),
    tables: Object.values(structure.tables),
    issues: [{ id: ids.issue, objectId: objects[0].id }],
    operationSequence: 12,
  };
  return {
    input: {
      projectId: ids.project,
      documentId: ids.document,
      revision: {
        id: structure.revisionId,
        sequence: 3,
        version: 7,
        status: "approved",
      },
      snapshot: {
        sha256: snapshotSha256,
        schemaVersion: 2,
        operationSequence: 12,
        canonicalJson,
      },
    },
    template,
    sourceBytes,
  };
}

test("real native template hydration preserves frozen structure and canonical-only lineage", () => {
  assert.equal(
    typeof authoritySnapshots.hydrateDrawingAuthoritySnapshot,
    "function",
  );
  const fixture = approvedTemplateSnapshot();
  const inputBytes = JSON.stringify(fixture.input);
  const { state, canonicalJson } =
    authoritySnapshots.hydrateDrawingAuthoritySnapshot(fixture.input);

  assert.equal(state.revisionId, "10000000-0000-4000-8100-000000000001");
  assert.equal(
    state.structure.pages["10000000-0000-4000-8100-000000000002"].name,
    "치수 평면 예제",
  );
  assert.equal(
    state.structure.objects["10000000-0000-4000-8100-000000000008"]
      .geometry.type,
    "wall",
  );
  assert.equal(Object.isFrozen(state), true);
  assert.equal(Object.isFrozen(state.structure), true);
  assert.equal(
    canonicalJson.layers[0].pageId,
    "10000000-0000-4000-8100-000000000002",
  );
  assert.equal(
    canonicalJson.objects[0].lineageId,
    "90000000-0000-4000-8900-000000000100",
  );
  assert.equal(canonicalJson.objects[0].type, "wall");
  assert.deepEqual(canonicalJson.issues, [
    {
      id: "90000000-0000-4000-8900-000000000099",
      objectId: "10000000-0000-4000-8100-000000000008",
    },
  ]);
  assert.equal(JSON.stringify(fixture.input), inputBytes);
  assert.equal(JSON.stringify(fixture.template), fixture.sourceBytes);
});

test("every frozen revision status hydrates while the snapshot digest remains opaque metadata", () => {
  for (const status of [
    "review_requested",
    "reviewed",
    "approved",
    "superseded",
  ]) {
    const fixture = approvedTemplateSnapshot();
    fixture.input.revision.status = status;
    fixture.input.snapshot.sha256 = "b".repeat(64);
    const sourceBytes = JSON.stringify(fixture.input);

    const result =
      authoritySnapshots.hydrateDrawingAuthoritySnapshot(fixture.input);

    assert.equal(result.state.revisionId, fixture.input.revision.id);
    assert.equal(result.canonicalJson.revision.version, 7);
    assert.equal(JSON.stringify(fixture.input), sourceBytes);
  }
});

function assertBoundedInvalid(candidate) {
  const sourceBytes = JSON.stringify(candidate);
  assert.throws(
    () => authoritySnapshots.hydrateDrawingAuthoritySnapshot(candidate),
    (error) =>
      error instanceof Error &&
      error.name === "Error" &&
      error.message === "Drawing authority snapshot is invalid.",
  );
  assert.equal(JSON.stringify(candidate), sourceBytes);
}

test("malformed authority scope, revision metadata, and snapshot metadata fail with one bounded error", async (t) => {
  const cases = [
    ["null scope", () => null],
    ["project identity", (input) => void (input.projectId = "not-a-uuid")],
    ["document identity", (input) => void (input.documentId = "not-a-uuid")],
    ["revision object", (input) => void (input.revision = null)],
    ["revision identity", (input) => void (input.revision.id = "not-a-uuid")],
    ["revision sequence", (input) => void (input.revision.sequence = 0)],
    [
      "unsafe revision sequence",
      (input) => void (input.revision.sequence = Number.MAX_SAFE_INTEGER + 1),
    ],
    ["revision version", (input) => void (input.revision.version = 0)],
    [
      "unsafe revision version",
      (input) => void (input.revision.version = Number.MAX_SAFE_INTEGER + 1),
    ],
    ["revision status", (input) => void (input.revision.status = "draft")],
    ["snapshot digest", (input) => void (input.snapshot.sha256 = "no")],
    ["snapshot schema", (input) => void (input.snapshot.schemaVersion = 1)],
    [
      "snapshot operation sequence",
      (input) => void (input.snapshot.operationSequence = -1),
    ],
    [
      "unsafe snapshot operation sequence",
      (input) =>
        void (input.snapshot.operationSequence = Number.MAX_SAFE_INTEGER + 1),
    ],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const fixture = approvedTemplateSnapshot();
      const replacement = mutate(fixture.input);
      assertBoundedInvalid(replacement === null ? null : fixture.input);
    });
  }
});

test("canonical revision and operation identity mismatches fail closed", async (t) => {
  const cases = [
    [
      "project",
      (input) => void (input.snapshot.canonicalJson.revision.projectId = ids.issue),
    ],
    [
      "document",
      (input) =>
        void (input.snapshot.canonicalJson.revision.documentId = ids.issue),
    ],
    [
      "revision",
      (input) => void (input.snapshot.canonicalJson.revision.id = ids.issue),
    ],
    [
      "sequence",
      (input) => void (input.snapshot.canonicalJson.revision.sequence = 4),
    ],
    [
      "version",
      (input) => void (input.snapshot.canonicalJson.revision.version = 8),
    ],
    [
      "operation sequence",
      (input) => void (input.snapshot.canonicalJson.operationSequence = 13),
    ],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const fixture = approvedTemplateSnapshot();
      mutate(fixture.input);
      assertBoundedInvalid(fixture.input);
    });
  }
});

test("canonical page, geometry type, and object lineage fields are validated before hydration", async (t) => {
  const cases = [
    [
      "cross-revision page",
      (graph) => void (graph.pages[0].revisionId = ids.issue),
    ],
    ["layer page", (graph) => void (graph.layers[0].pageId = ids.issue)],
    ["object page", (graph) => void (graph.objects[0].pageId = ids.issue)],
    ["object type", (graph) => void (graph.objects[0].type = "line")],
    [
      "object lineage",
      (graph) => void (graph.objects[0].lineageId = "not-a-uuid"),
    ],
    [
      "strict geometry",
      (graph) => {
        graph.objects[0].type = "spline";
        graph.objects[0].geometry = { type: "spline", points: [] };
      },
    ],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const fixture = approvedTemplateSnapshot();
      mutate(fixture.input.snapshot.canonicalJson);
      assertBoundedInvalid(fixture.input);
    });
  }
});

test("duplicate canonical entity IDs fail for every populated hydrated collection", async (t) => {
  for (const collection of [
    "pages",
    "canvases",
    "layers",
    "objects",
    "styles",
    "blocks",
    "blockInstances",
    "propertySchemas",
    "propertyValues",
    "tables",
  ]) {
    await t.test(collection, () => {
      const fixture = approvedTemplateSnapshot();
      const values = fixture.input.snapshot.canonicalJson[collection];
      values.push(structuredClone(values[0]));
      assertBoundedInvalid(fixture.input);
    });
  }
});

test("canonical issues require valid object links and unique issue-object pairs", async (t) => {
  const cases = [
    [
      "missing object",
      (issues) => void (issues[0].objectId = ids.document),
    ],
    ["malformed issue", (issues) => void (issues[0].id = "not-a-uuid")],
    ["duplicate pair", (issues) => issues.push(structuredClone(issues[0]))],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const fixture = approvedTemplateSnapshot();
      mutate(fixture.input.snapshot.canonicalJson.issues);
      assertBoundedInvalid(fixture.input);
    });
  }
});
