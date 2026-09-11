import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const shares = await vite
  .ssrLoadModule("/app/lukas/lib/drawing-share.server.ts")
  .catch(() => ({}));
test.after(() => vite.close());

const ids = {
  share: "10000000-0000-4000-8000-000000000001",
  project: "10000000-0000-4000-8000-000000000002",
  document: "10000000-0000-4000-8000-000000000003",
  revision: "10000000-0000-4000-8000-000000000004",
  page: "10000000-0000-4000-8000-000000000005",
  canvas: "10000000-0000-4000-8000-000000000006",
  layer: "10000000-0000-4000-8000-000000000007",
  object: "10000000-0000-4000-8000-000000000008",
  source: "10000000-0000-4000-8000-000000000009",
  propertySchema: "10000000-0000-4000-8000-000000000010",
  propertyValue: "10000000-0000-4000-8000-000000000011",
  table: "10000000-0000-4000-8000-000000000012",
  column: "10000000-0000-4000-8000-000000000013",
  row: "10000000-0000-4000-8000-000000000014",
  issue: "10000000-0000-4000-8000-000000000015",
};
const snapshotSha = "a".repeat(64);
const sourceSha = "b".repeat(64);
const token = "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI";

function authorityPayload(overrides = {}) {
  const canonicalJson = {
    schemaVersion: 2,
    revision: {
      id: ids.revision,
      documentId: ids.document,
      projectId: ids.project,
      sequence: 3,
      version: 7,
    },
    sources: [],
    pages: [
      {
        id: ids.page,
        revisionId: ids.revision,
        name: "A-101",
        sortOrder: 0,
        version: 1,
      },
    ],
    canvases: [
      {
        id: ids.canvas,
        pageId: ids.page,
        name: "1층 평면",
        spaceKind: "paper",
        widthMillimeters: 420,
        heightMillimeters: 297,
        background: {
          sourceFileId: ids.source,
          sourceSha256: sourceSha,
          pdfPageNumber: 2,
          calibration: null,
        },
        sortOrder: 0,
        version: 1,
      },
    ],
    layers: [
      {
        id: ids.layer,
        pageId: ids.page,
        canvasId: ids.canvas,
        name: "Work",
        sortOrder: 1,
        visible: true,
        locked: false,
        systemKind: "work",
        version: 1,
      },
    ],
    objects: [
      {
        id: ids.object,
        lineageId: ids.object,
        pageId: ids.page,
        layerId: ids.layer,
        name: "기준선",
        type: "line",
        geometry: {
          type: "line",
          start: { x: 10, y: 20 },
          end: { x: 110, y: 20 },
        },
        styleId: null,
        style: { stroke: "#112233", strokeWidth: 2, fill: null },
        version: 1,
      },
    ],
    styles: [],
    blocks: [],
    blockInstances: [],
    propertySchemas: [
      {
        id: ids.propertySchema,
        revisionId: ids.revision,
        name: "must-not-leak",
        valueType: "text",
        enumOptions: [],
        appliesTo: ["line"],
        required: false,
        version: 1,
      },
    ],
    propertyValues: [
      {
        id: ids.propertyValue,
        schemaId: ids.propertySchema,
        objectId: ids.object,
        blockInstanceId: null,
        value: "must-not-leak",
        version: 1,
      },
    ],
    tables: [
      {
        id: ids.table,
        revisionId: ids.revision,
        name: "must-not-leak",
        columns: [
          {
            id: ids.column,
            name: "객체",
            kind: "object_name",
            propertySchemaId: null,
          },
        ],
        rows: [
          {
            id: ids.row,
            objectId: ids.object,
            blockInstanceId: null,
            cells: {},
          },
        ],
        version: 1,
      },
    ],
    issues: [{ id: ids.issue, objectId: ids.object }],
    operationSequence: 12,
  };
  return {
    shareId: ids.share,
    project: { id: ids.project, name: "성수 복합시설" },
    document: { id: ids.document, title: "건축 평면도" },
    revision: {
      id: ids.revision,
      sequence: 3,
      version: 7,
      status: "approved",
    },
    snapshot: {
      sha256: snapshotSha,
      schemaVersion: 2,
      operationSequence: 12,
      canonicalJson,
    },
    expiresAt: "2026-09-11T00:00:00.000Z",
    ...overrides,
  };
}

function sourceQuery(row, calls) {
  const filters = [];
  const query = {
    select(columns) {
      calls.push(["select", columns]);
      return query;
    },
    eq(column, value) {
      filters.push([column, value]);
      return query;
    },
    maybeSingle() {
      calls.push(["filters", filters]);
      return Promise.resolve({ data: row, error: null });
    },
  };
  return query;
}

function resolvingClient(payload = authorityPayload(), sourceRow = {}) {
  const calls = [];
  const row = {
    id: ids.source,
    project_id: ids.project,
    kind: "pdf",
    storage_path: `${ids.project}/${ids.source}/source.pdf`,
    sha256: sourceSha,
    immutable: true,
    ...sourceRow,
  };
  return {
    calls,
    client: {
      async rpc(name, args) {
        calls.push(["rpc", name, args]);
        return { data: payload, error: null };
      },
      from(table) {
        calls.push(["from", table]);
        return sourceQuery(row, calls);
      },
      storage: {
        from(bucket) {
          calls.push(["bucket", bucket]);
          return {
            async createSignedUrl(path, ttl) {
              calls.push(["signed", path, ttl]);
              return {
                data: {
                  signedUrl:
                    "https://storage.example/exact.pdf?signature=short",
                },
                error: null,
              };
            },
          };
        },
      },
    },
  };
}

test("drawing share secrets are canonical 32-byte base64url values and only their hashes persist", () => {
  assert.equal(typeof shares.drawingShareSecretFromBytes, "function");
  const secret = shares.drawingShareSecretFromBytes(
    new TextEncoder().encode("12345678901234567890123456789012"),
  );
  assert.deepEqual(secret, {
    token: "MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI",
    tokenHash:
      "bc7c6622422eb753c567da2d27d5319dc96f90214dac4d69e266c70f57642d46",
  });
  assert.equal(shares.parseDrawingShareToken(secret.token), secret.token);
  for (const malformed of [
    "",
    "short",
    `${secret.token}=`,
    `${secret.token}/x`,
    `${secret.token.slice(0, -1)}J`,
    `${secret.token.slice(0, -1)}K`,
    `${secret.token.slice(0, -1)}L`,
    ids.share,
  ])
    assert.throws(() => shares.parseDrawingShareToken(malformed));
});

test("public resolution returns one render-only exact snapshot with a short exact PDF capability", async () => {
  assert.equal(typeof shares.resolvePublicDrawingShare, "function");
  const { client, calls } = resolvingClient();
  const view = await shares.resolvePublicDrawingShare(client, token);

  assert.deepEqual(Object.keys(view).sort(), [
    "blockInstances",
    "canvases",
    "document",
    "expiresAt",
    "layers",
    "objects",
    "pages",
    "pdfSources",
    "project",
    "revision",
    "snapshotSha256",
  ]);
  assert.equal(view.objects[0].id, ids.object);
  assert.deepEqual(view.objects[0].style, {
    stroke: "#112233",
    strokeWidth: 2,
    fill: null,
  });
  assert.deepEqual(view.pdfSources, {
    [ids.source]: {
      id: ids.source,
      sha256: sourceSha,
      signedUrl: "https://storage.example/exact.pdf?signature=short",
    },
  });
  const serialized = JSON.stringify(view);
  for (const forbidden of [
    "canonicalJson",
    "propertySchemas",
    "propertyValues",
    "tables",
    "issues",
    "recentOutcomes",
    "storage_path",
    "must-not-leak",
  ])
    assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.deepEqual(
    calls.find((call) => call[0] === "rpc"),
    ["rpc", "lukas_qto_shared_drawing_revision", { p_token: token }],
  );
  assert.deepEqual(calls.find((call) => call[0] === "signed").slice(-2), [
    `${ids.project}/${ids.source}/source.pdf`,
    60,
  ]);
});

test("public resolution fails closed for unavailable authority, lineage drift, invalid graph, and source mismatch", async () => {
  const unavailable = resolvingClient(null);
  await assert.rejects(
    () => shares.resolvePublicDrawingShare(unavailable.client, token),
    (error) => error instanceof Response && error.status === 404,
  );

  const wrongLineagePayload = authorityPayload();
  wrongLineagePayload.snapshot.canonicalJson.revision.documentId = ids.share;
  await assert.rejects(
    () =>
      shares.resolvePublicDrawingShare(
        resolvingClient(wrongLineagePayload).client,
        token,
      ),
    (error) => error instanceof Response && error.status === 404,
  );

  const invalidGraphPayload = authorityPayload();
  invalidGraphPayload.snapshot.canonicalJson.layers[0].canvasId = ids.share;
  await assert.rejects(
    () =>
      shares.resolvePublicDrawingShare(
        resolvingClient(invalidGraphPayload).client,
        token,
      ),
    (error) => error instanceof Response && error.status === 404,
  );

  await assert.rejects(
    () =>
      shares.resolvePublicDrawingShare(
        resolvingClient(authorityPayload(), { sha256: "c".repeat(64) }).client,
        token,
      ),
    (error) => error instanceof Response && error.status === 404,
  );
});

test("public resolution rejects corrupt canonical-only graph fields before PDF signing", async (t) => {
  const cases = [
    [
      "layer page lineage",
      (payload) => {
        payload.snapshot.canonicalJson.layers[0].pageId = ids.share;
      },
    ],
    [
      "object lineage ID",
      (payload) => {
        payload.snapshot.canonicalJson.objects[0].lineageId = "not-a-uuid";
      },
    ],
    [
      "object page lineage",
      (payload) => {
        payload.snapshot.canonicalJson.objects[0].pageId = ids.share;
      },
    ],
    [
      "object type",
      (payload) => {
        payload.snapshot.canonicalJson.objects[0].type = "circle";
      },
    ],
    [
      "issue entry",
      (payload) => {
        payload.snapshot.canonicalJson.issues[0].objectId = "not-a-uuid";
      },
    ],
  ];

  for (const [name, corrupt] of cases) {
    await t.test(name, async () => {
      const payload = authorityPayload();
      corrupt(payload);
      const { client, calls } = resolvingClient(payload);
      await assert.rejects(
        () => shares.resolvePublicDrawingShare(client, token),
        (error) => error instanceof Response && error.status === 404,
      );
      assert.equal(
        calls.some(([kind]) => kind === "signed"),
        false,
      );
    });
  }
});

test("share helpers send only actor, hash, and exact revision scope to RPC authority", async () => {
  assert.equal(typeof shares.createDrawingRevisionShare, "function");
  assert.equal(typeof shares.listDrawingRevisionShares, "function");
  assert.equal(typeof shares.revokeDrawingRevisionShare, "function");
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data:
          name === "lukas_qto_create_drawing_share"
            ? {
                shareId: ids.share,
                projectId: ids.project,
                documentId: ids.document,
                revisionId: ids.revision,
                revisionVersion: 7,
                snapshotSha256: snapshotSha,
                createdAt: "2026-09-04T00:00:00.000Z",
                expiresAt: "2026-09-11T00:00:00.000Z",
                revokedAt: null,
                requestId: ids.page,
              }
            : name === "lukas_qto_list_drawing_shares"
              ? []
              : {
                  shareId: ids.share,
                  projectId: ids.project,
                  documentId: ids.document,
                  revisionId: ids.revision,
                  revisionVersion: 7,
                  snapshotSha256: snapshotSha,
                  createdAt: "2026-09-04T00:00:00.000Z",
                  expiresAt: "2026-09-11T00:00:00.000Z",
                  revokedAt: "2026-09-04T00:00:00.000Z",
                  reason: "새 링크로 교체",
                  requestId: ids.canvas,
                },
        error: null,
      };
    },
  };
  const scope = {
    projectId: ids.project,
    documentId: ids.document,
    revisionId: ids.revision,
    revisionVersion: 7,
    snapshotSha256: snapshotSha,
  };
  const created = await shares.createDrawingRevisionShare(client, {
    ...scope,
    actorId: ids.object,
    requestId: ids.page,
    secretBytes: new TextEncoder().encode("12345678901234567890123456789012"),
  });
  assert.equal(created.token, token);
  assert.equal(JSON.stringify(calls[0][1]).includes(token), false);
  assert.equal(
    calls[0][1].p_token_hash,
    "bc7c6622422eb753c567da2d27d5319dc96f90214dac4d69e266c70f57642d46",
  );
  assert.equal(calls[0][1].p_actor_id, ids.object);
  await shares.listDrawingRevisionShares(client, scope);
  await shares.revokeDrawingRevisionShare(client, {
    ...scope,
    shareId: ids.share,
    reason: "새 링크로 교체",
    requestId: ids.canvas,
  });
  assert.deepEqual(
    calls.map(([name]) => name),
    [
      "lukas_qto_create_drawing_share",
      "lukas_qto_list_drawing_shares",
      "lukas_qto_revoke_drawing_share",
    ],
  );
});
