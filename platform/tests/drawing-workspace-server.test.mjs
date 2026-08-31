import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  applyDrawingCommand,
  copyDrawingSelection,
  createDrawingDocumentState,
  pasteDrawingClipboard,
} from "../app/lukas/lib/drawing-commands.ts";
import * as workspaceServer from "../app/lukas/lib/drawing-workspace.server.ts";
import {
  applyDrawingOperation,
  createDrawingDocument,
  createDrawingDocumentIdempotent,
  createDrawingDocumentFromTemplate,
  handleWorkspaceMutation,
  linkDrawingObjectIssue,
  loadAllDrawingObjects,
  loadAllDrawingRows,
  loadDrawingWorkspace,
  loadDrawingTemplateCandidates,
  loadDrawingWorkspaceCapability,
  parseWorkspaceMutation,
} from "../app/lukas/lib/drawing-workspace.server.ts";
import {
  p4FixtureIds,
  p4Object,
  validP4Geometries,
} from "./fixtures/drawing-workspace-p4-database-fixtures.mjs";

const ids = {
  actor: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  file: "00000000-0000-4000-8000-000000000003",
  document: "00000000-0000-4000-8000-000000000004",
  revision: "00000000-0000-4000-8000-000000000005",
  page: "00000000-0000-4000-8000-000000000006",
  sourceLayer: "00000000-0000-4000-8000-000000000007",
  workLayer: "00000000-0000-4000-8000-000000000008",
  object: "00000000-0000-4000-8000-000000000009",
  operation: "00000000-0000-4000-8000-000000000010",
  issue: "00000000-0000-4000-8000-000000000011",
  link: "00000000-0000-4000-8000-000000000012",
};

const sourceSha = "a".repeat(64);

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function ifcTestGlb() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const binary = new Uint8Array(positions.buffer);
  const json = new TextEncoder().encode(
    JSON.stringify({
      asset: { version: "2.0" },
      buffers: [{ byteLength: binary.byteLength }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: binary.byteLength },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "VEC3",
          min: [0, 0, 0],
          max: [1, 1, 0],
        },
      ],
      nodes: [{ extras: { ifcNodeId: "ifc-42", ifcExpressId: 42 }, mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    }),
  );
  const padded = Math.ceil(json.byteLength / 4) * 4;
  const binaryPadded = Math.ceil(binary.byteLength / 4) * 4;
  const bytes = new Uint8Array(20 + padded + 8 + binaryPadded);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(json, 20);
  bytes.fill(0x20, 20 + json.byteLength);
  view.setUint32(20 + padded, binaryPadded, true);
  view.setUint32(24 + padded, 0x004e4942, true);
  bytes.set(binary, 28 + padded);
  return bytes;
}

const ifcGeometryBytes = ifcTestGlb();
const ifcGeometrySha = createHash("sha256")
  .update(ifcGeometryBytes)
  .digest("hex");

const ifcDerivativeManifest = {
  schemaVersion: 1,
  source: { fileId: ids.file, sha256: sourceSha },
  geometry: { sha256: ifcGeometrySha },
  elements: [
    {
      expressId: 42,
      globalId: "0VNYAWfXv8JvIRVfOzYH1j",
      typeName: "IFCWALL",
      name: "외벽",
      meshes: [{ nodeId: "ifc-42", primitiveIndices: [0] }],
      properties: [{ group: "Identity", name: "FireRating", value: "2h" }],
    },
  ],
};
const ifcManifestSha = createHash("sha256")
  .update(canonicalJson(ifcDerivativeManifest))
  .digest("hex");
const ifcManifestBytes = new TextEncoder().encode(
  canonicalJson(ifcDerivativeManifest),
);
const ifcDerivativePrefix = `projects/${ids.project}/ifc-derivatives/${sourceSha}/v1`;

test("IFC derivative manifest is strict and rejects ambiguous element mappings", () => {
  assert.deepEqual(
    workspaceServer.IfcDerivativeManifestSchema.parse(ifcDerivativeManifest),
    ifcDerivativeManifest,
  );
  assert.throws(
    () =>
      workspaceServer.IfcDerivativeManifestSchema.parse({
        ...ifcDerivativeManifest,
        ignored: true,
      }),
    /unrecognized/i,
  );
  assert.throws(
    () =>
      workspaceServer.IfcDerivativeManifestSchema.parse({
        ...ifcDerivativeManifest,
        elements: [
          ifcDerivativeManifest.elements[0],
          {
            ...ifcDerivativeManifest.elements[0],
            globalId: "1VNYAWfXv8JvIRVfOzYH1j",
          },
        ],
      }),
    /expressId/i,
  );
});

test("IFC derivative loader signs only a hash-bound ready artifact", async () => {
  const calls = [];
  const derivative = {
    id: "00000000-0000-4000-8000-000000000100",
    project_id: ids.project,
    source_file_id: ids.file,
    source_sha256: sourceSha,
    version: 1,
    schema_version: 1,
    status: "ready",
    manifest_json: ifcDerivativeManifest,
    manifest_storage_path: `${ifcDerivativePrefix}/${ifcManifestSha}.json`,
    manifest_byte_size: ifcManifestBytes.byteLength,
    manifest_sha256: ifcManifestSha,
    geometry_storage_path: `${ifcDerivativePrefix}/${ifcGeometrySha}.glb`,
    geometry_byte_size: ifcGeometryBytes.byteLength,
    geometry_sha256: ifcGeometrySha,
  };
  const client = {
    from(table) {
      calls.push(["table", table]);
      const builder = {
        select() {
          return builder;
        },
        eq(column, value) {
          calls.push(["eq", column, value]);
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return Promise.resolve({ data: [derivative], error: null });
        },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        calls.push(["bucket", bucket]);
        return {
          async download(path) {
            calls.push(["download", path]);
            const bytes = path.endsWith(".json")
              ? ifcManifestBytes
              : ifcGeometryBytes;
            return { data: new Blob([bytes]), error: null };
          },
          async createSignedUrl(path, ttl) {
            calls.push(["sign", path, ttl]);
            return {
              data: {
                signedUrl:
                  ttl <= 30
                    ? `https://storage.test/internal/${path}`
                    : `https://storage.test/${path}`,
              },
              error: null,
            };
          },
        };
      },
    },
  };
  const loaded = await workspaceServer.loadDrawingIfcDerivative(
    client,
    {
      id: ids.file,
      project_id: ids.project,
      kind: "ifc",
      original_filename: "model.ifc",
      storage_path: "projects/model.ifc",
      content_type: "application/x-step",
      byte_size: 1,
      sha256: sourceSha,
      immutable: true,
      created_at: "2026-08-28T00:00:00Z",
    },
    undefined,
    {
      fetch: async (url, init) => {
        calls.push(["fetch", url, init]);
        const bytes = String(url).endsWith(".json")
          ? ifcManifestBytes
          : ifcGeometryBytes;
        return new Response(bytes, {
          status: 206,
          headers: {
            "content-length": String(bytes.byteLength),
            "content-range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
          },
        });
      },
    },
  );
  assert.deepEqual(loaded, {
    status: "ready",
    version: 1,
    sourceSha256: sourceSha,
    manifestByteSize: ifcManifestBytes.byteLength,
    geometryByteSize: ifcGeometryBytes.byteLength,
    manifestSha256: ifcManifestSha,
    geometrySha256: ifcGeometrySha,
    manifestSignedUrl: `https://storage.test/${ifcDerivativePrefix}/${ifcManifestSha}.json`,
    geometrySignedUrl: `https://storage.test/${ifcDerivativePrefix}/${ifcGeometrySha}.glb`,
  });
  assert.deepEqual(
    calls.filter(([kind, , ttl]) => kind === "sign" && ttl === 300),
    [
      ["sign", `${ifcDerivativePrefix}/${ifcManifestSha}.json`, 300],
      ["sign", `${ifcDerivativePrefix}/${ifcGeometrySha}.glb`, 300],
    ],
  );
});

test("IFC derivative loader fails closed before signing mismatched evidence", async () => {
  let signed = false;
  const client = {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return Promise.resolve({
            data: [
              {
                project_id: ids.project,
                source_file_id: ids.file,
                source_sha256: "c".repeat(64),
                version: 1,
                schema_version: 1,
                status: "ready",
                manifest_json: ifcDerivativeManifest,
                manifest_storage_path: "model.json",
                manifest_sha256: ifcManifestSha,
                geometry_storage_path: "model.glb",
                geometry_sha256: "b".repeat(64),
              },
            ],
            error: null,
          });
        },
      };
      return builder;
    },
    storage: {
      from() {
        return {
          createSignedUrl() {
            signed = true;
          },
        };
      },
    },
  };
  await assert.rejects(
    workspaceServer.loadDrawingIfcDerivative(client, {
      id: ids.file,
      project_id: ids.project,
      kind: "ifc",
      original_filename: "model.ifc",
      storage_path: "model.ifc",
      content_type: null,
      byte_size: 1,
      sha256: sourceSha,
      immutable: true,
      created_at: "2026-08-28T00:00:00Z",
    }),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.equal(signed, false);
});

test("IFC derivative loader rejects a pending row with an unsupported contract version", async () => {
  const client = {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return Promise.resolve({
            data: [
              {
                project_id: ids.project,
                source_file_id: ids.file,
                source_sha256: sourceSha,
                version: 1,
                schema_version: 2,
                status: "pending",
                manifest_json: null,
                manifest_storage_path: null,
                manifest_sha256: null,
                geometry_storage_path: null,
                geometry_sha256: null,
              },
            ],
            error: null,
          });
        },
      };
      return builder;
    },
  };
  await assert.rejects(
    workspaceServer.loadDrawingIfcDerivative(client, {
      id: ids.file,
      project_id: ids.project,
      kind: "ifc",
      original_filename: "model.ifc",
      storage_path: "model.ifc",
      content_type: null,
      byte_size: 1,
      sha256: sourceSha,
      immutable: true,
      created_at: "2026-08-28T00:00:00Z",
    }),
    (error) => error instanceof Response && error.status === 409,
  );
});

const p2Ids = {
  canvas: "00000000-0000-4000-8000-000000000013",
  style: "00000000-0000-4000-8000-000000000014",
  block: "00000000-0000-4000-8000-000000000015",
  instance: "00000000-0000-4000-8000-000000000016",
  schema: "00000000-0000-4000-8000-000000000017",
  value: "00000000-0000-4000-8000-000000000018",
  table: "00000000-0000-4000-8000-000000000019",
  template: "00000000-0000-4000-8000-000000000020",
  source: "00000000-0000-4000-8000-000000000021",
};

test("workspace object loading uses an ID keyset beyond the Supabase response cap", async () => {
  const calls = [];
  const rows = Array.from({ length: 2_005 }, (_, index) => ({
    id: String(index).padStart(5, "0"),
  }));
  const client = {
    from(table) {
      assert.equal(table, "lukas_drawing_objects");
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        gt(column, cursor) {
          calls.push(["gt", column, cursor]);
          return builder;
        },
        limit(size) {
          const cursor = calls.findLast((call) => call[0] === "gt")?.[2];
          const from =
            cursor == null ? 0 : rows.findIndex((row) => row.id === cursor) + 1;
          calls.push(["limit", size]);
          return Promise.resolve({
            data: rows.slice(from, from + size),
            error: null,
          });
        },
      };
      return builder;
    },
  };

  const loaded = await loadAllDrawingObjects(
    client,
    ids.project,
    ids.revision,
    1_000,
  );
  assert.equal(loaded.length, 2_005);
  assert.deepEqual(
    calls.filter((call) => call[0] === "limit"),
    [
      ["limit", 1_000],
      ["limit", 1_000],
      ["limit", 1_000],
    ],
  );
});

test("bounded drawing row pagination has deterministic ID ties and removes duplicate rows", async () => {
  const calls = [];
  const rows = Array.from({ length: 2_005 }, (_, index) => ({
    id: String(index).padStart(5, "0"),
  }));
  rows.splice(1_000, 0, { id: "00999" });
  const client = {
    from(table) {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order(column) {
          calls.push([table, "order", column]);
          return builder;
        },
        gt(_column, cursor) {
          calls.push([table, "gt", cursor]);
          return builder;
        },
        limit(size) {
          const cursor = calls.findLast((call) => call[1] === "gt")?.[2];
          const from =
            cursor == null ? 0 : rows.findIndex((row) => row.id > cursor);
          calls.push([table, "limit", size]);
          return Promise.resolve({
            data: rows.slice(from, from + size),
            error: null,
          });
        },
        range(from, to) {
          calls.push([table, from, to]);
          return Promise.resolve({
            data: rows.slice(from, to + 1),
            error: null,
          });
        },
      };
      return builder;
    },
  };
  const loaded = await loadAllDrawingRows(client, {
    table: "lukas_drawing_blocks",
    projectId: ids.project,
    revisionId: ids.revision,
    order: [{ column: "id", direction: "asc" }],
    pageSize: 1_000,
  });
  assert.equal(loaded.length, 2_005);
  assert.equal(new Set(loaded.map((row) => row.id)).size, 2_005);
  assert.deepEqual(
    loaded.map((row) => row.id),
    [...loaded.map((row) => row.id)].sort(),
  );
  assert.deepEqual(
    calls.filter((call) => call[1] === "limit"),
    [
      ["lukas_drawing_blocks", "limit", 1_000],
      ["lukas_drawing_blocks", "limit", 1_000],
      ["lukas_drawing_blocks", "limit", 1_000],
    ],
  );
});

test("keyset transport rejects duplicate rows, caps pages, and applies numeric canonical order", async () => {
  const rows = [
    { id: "0002", sort_order: 10 },
    { id: "0001", sort_order: 2 },
  ];
  const client = {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        gt() {
          return builder;
        },
        limit(size) {
          return Promise.resolve({ data: rows.slice(0, size), error: null });
        },
      };
      return builder;
    },
  };
  const loaded = await loadAllDrawingRows(client, {
    table: "lukas_drawing_pages",
    projectId: ids.project,
    order: [
      { column: "sort_order", direction: "asc" },
      { column: "id", direction: "asc" },
    ],
  });
  assert.deepEqual(
    loaded.map((row) => row.sort_order),
    [2, 10],
  );
  const directionalRows = [
    { id: "0003", sort_order: 2, updated_at: "2026-08-24T01:00:00.000Z" },
    { id: "0001", sort_order: 10, updated_at: "2026-08-25T01:00:00.000Z" },
    { id: "0002", sort_order: 2, updated_at: "2026-08-24T01:00:00.000Z" },
  ];
  const directionalClient = {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        gt() {
          return builder;
        },
        limit() {
          return Promise.resolve({ data: directionalRows, error: null });
        },
      };
      return builder;
    },
  };
  assert.deepEqual(
    (
      await loadAllDrawingRows(directionalClient, {
        table: "lukas_drawing_issues",
        projectId: ids.project,
        order: [
          { column: "updated_at", direction: "desc" },
          { column: "id", direction: "asc" },
        ],
      })
    ).map((row) => row.id),
    ["0001", "0002", "0003"],
  );
  assert.deepEqual(
    (
      await loadAllDrawingRows(directionalClient, {
        table: "lukas_drawing_pages",
        projectId: ids.project,
        order: [
          { column: "sort_order", direction: "desc" },
          { column: "id", direction: "asc" },
        ],
      })
    ).map((row) => row.sort_order),
    [10, 2, 2],
  );
  await assert.rejects(
    () =>
      loadAllDrawingRows(client, {
        table: "lukas_drawing_pages",
        projectId: ids.project,
        order: [{ column: "id", direction: "asc" }],
        pageSize: 1_001,
      }),
    /between 1 and 1000/,
  );
  const duplicate = {
    from() {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        order() {
          return builder;
        },
        gt() {
          return builder;
        },
        limit() {
          return Promise.resolve({
            data: [{ id: "0001" }, { id: "0001" }],
            error: null,
          });
        },
      };
      return builder;
    },
  };
  await assert.rejects(
    () =>
      loadAllDrawingRows(duplicate, {
        table: "lukas_drawing_blocks",
        projectId: ids.project,
        order: [{ column: "id", direction: "asc" }],
      }),
    /중복 ID/,
  );
});

test("P4 loader strictly converts semantic rows and fails closed for broken canvas ancestry", async () => {
  const wall = p4Object(
    p4FixtureIds.wall,
    ids.workLayer,
    validP4Geometries[0],
    "W-01",
  );
  const opening = p4Object(
    p4FixtureIds.opening,
    ids.workLayer,
    validP4Geometries[1],
    "D-01",
  );
  const boundarySpace = p4Object(
    "40000000-0000-4000-8000-000000000003",
    ids.workLayer,
    validP4Geometries[8],
    "Boundary Unicode space",
  );
  const client = queryClient({
    lukas_qto_files: {
      data: {
        id: ids.file,
        project_id: ids.project,
        kind: "pdf",
        sha256: sourceSha,
        immutable: true,
      },
      error: null,
    },
    lukas_drawing_documents: {
      data: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: ids.file,
        source_sha256: sourceSha,
      },
      error: null,
    },
    lukas_drawing_revisions: {
      data: {
        id: ids.revision,
        document_id: ids.document,
        project_id: ids.project,
        status: "draft",
        version: 1,
      },
      error: null,
    },
    lukas_drawing_pages: {
      data: [
        {
          id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "A-101",
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_canvases: {
      data: [
        {
          id: p2Ids.canvas,
          page_id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "Paper",
          space_kind: "paper",
          width_mm: 841,
          height_mm: 594,
          background_source_file_id: ids.file,
          background_source_sha256: sourceSha,
          background_pdf_page: 1,
          calibration: null,
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_layers: {
      data: [
        {
          id: ids.sourceLayer,
          page_id: ids.page,
          canvas_id: p2Ids.canvas,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "Source",
          sort_order: 0,
          visible: true,
          locked: true,
          system_kind: "source",
          version: 1,
        },
        {
          id: ids.workLayer,
          page_id: ids.page,
          canvas_id: p2Ids.canvas,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "Work",
          sort_order: 1,
          visible: true,
          locked: false,
          system_kind: "work",
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_objects: {
      data: [wall, opening, boundarySpace].map((object) => ({
        id: object.id,
        name: object.name,
        page_id: ids.page,
        layer_id: object.layerId,
        revision_id: ids.revision,
        project_id: ids.project,
        object_type: object.geometry.type,
        geometry: object.geometry,
        style_id: object.styleId ?? null,
        style: object.style,
        version: object.version,
      })),
      error: null,
    },
    lukas_drawing_object_sources: {
      data: [
        {
          id: p2Ids.source,
          object_id: wall.id,
          revision_id: ids.revision,
          project_id: ids.project,
          source_file_id: ids.file,
          source_sha256: sourceSha,
          source_kind: "pdf_region",
          pdf_page_number: 1,
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.4,
          element_id: null,
          ifc_global_id: null,
          camera: null,
          version: 1,
          status: "active",
        },
      ],
      error: null,
    },
    lukas_drawing_styles: { data: [], error: null },
    lukas_drawing_blocks: { data: [], error: null },
    lukas_drawing_block_instances: { data: [], error: null },
    lukas_drawing_property_schemas: { data: [], error: null },
    lukas_drawing_property_values: { data: [], error: null },
    lukas_drawing_tables: { data: [], error: null },
  });
  const loaded = await loadDrawingWorkspace(client, {
    projectId: ids.project,
    workspaceId: ids.document,
  });
  assert.deepEqual(loaded.document.revision.sources, [
    {
      id: p2Ids.source,
      objectId: wall.id,
      revisionId: ids.revision,
      sourceFileId: ids.file,
      sourceSha256: sourceSha,
      sourceKind: "pdf_region",
      pdfPageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      version: 1,
    },
  ]);
  assert.deepEqual(loaded.document.revision.pages[0], {
    id: ids.page,
    revisionId: ids.revision,
    name: "A-101",
    sortOrder: 0,
    version: 1,
    canvases: [
      {
        id: p2Ids.canvas,
        pageId: ids.page,
        name: "Paper",
        spaceKind: "paper",
        widthMillimeters: 841,
        heightMillimeters: 594,
        background: {
          sourceFileId: ids.file,
          sourceSha256: sourceSha,
          pdfPageNumber: 1,
          calibration: null,
        },
        sortOrder: 0,
        version: 1,
      },
    ],
    layers: [
      {
        id: ids.sourceLayer,
        name: "Source",
        visible: true,
        locked: true,
        systemKind: "source",
        canvasId: p2Ids.canvas,
        sortOrder: 0,
        version: 1,
      },
      {
        id: ids.workLayer,
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        canvasId: p2Ids.canvas,
        sortOrder: 1,
        version: 1,
      },
    ],
    objects: [wall, opening, boundarySpace],
    blockInstances: [],
  });
  for (const table of [
    "lukas_drawing_pages",
    "lukas_drawing_layers",
    "lukas_drawing_objects",
  ])
    assert.equal(
      client.calls.filter((call) => call.table === table).length,
      1,
      `${table} is loaded exactly once for P2`,
    );

  const malformed = queryClient({
    ...Object.fromEntries(
      client.calls.map((call) => [call.table, { data: [], error: null }]),
    ),
    lukas_qto_files: {
      data: {
        id: ids.file,
        project_id: ids.project,
        kind: "pdf",
        sha256: sourceSha,
        immutable: true,
      },
      error: null,
    },
    lukas_drawing_documents: {
      data: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: ids.file,
        source_sha256: sourceSha,
      },
      error: null,
    },
    lukas_drawing_revisions: {
      data: {
        id: ids.revision,
        document_id: ids.document,
        project_id: ids.project,
        status: "draft",
        version: 1,
      },
      error: null,
    },
    lukas_drawing_pages: {
      data: [
        {
          id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "A-101",
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_canvases: {
      data: [
        {
          id: p2Ids.canvas,
          page_id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "Paper",
          space_kind: "paper",
          width_mm: 841,
          height_mm: 594,
          background_source_file_id: ids.file,
          background_source_sha256: "b".repeat(64),
          background_pdf_page: 1,
          calibration: null,
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
  });
  await assert.rejects(
    loadDrawingWorkspace(malformed, ids.project, ids.file),
    /source evidence|ancestry/i,
  );
});

test("P4 measurement evidence derives only from the authorized transactional checkpoint", async () => {
  assert.equal(
    typeof workspaceServer.deriveAuthorizedDrawingMeasurementEvidence,
    "function",
  );
  const wall = p4Object(
    p4FixtureIds.wall,
    ids.workLayer,
    validP4Geometries[0],
    "W-01",
  );
  const opening = p4Object(
    p4FixtureIds.opening,
    ids.workLayer,
    validP4Geometries[1],
    "D-01",
  );
  const bootstrap = {
    canonicalJson: {
      schemaVersion: 2,
      revision: {
        id: ids.revision,
        documentId: ids.document,
        projectId: ids.project,
        sequence: 1,
        version: 1,
      },
      sources: [],
      pages: [],
      canvases: [],
      layers: [],
      objects: [opening, wall].map((object) => ({
        ...object,
        lineageId: object.id,
        pageId: ids.page,
        type: object.geometry.type,
      })),
      styles: [],
      blocks: [],
      blockInstances: [],
      propertySchemas: [],
      propertyValues: [],
      tables: [],
      issues: [],
      operationSequence: 17,
    },
    operationSequence: 17,
    schemaVersion: 2,
    sha256: sourceSha,
    revisionStatus: "draft",
    capability: "viewer",
    canWrite: false,
    recentOutcomes: [],
  };
  const evidence =
    workspaceServer.deriveAuthorizedDrawingMeasurementEvidence(bootstrap);
  assert.equal(evidence.revisionId, ids.revision);
  assert.equal(evidence.operationCheckpoint, 17);
  assert.equal(evidence.ruleVersion, "P4_MEASUREMENT_V1");
  assert.equal(evidence.documentId, ids.document);
  assert.equal(evidence.revisionVersion, 1);
  assert.equal(evidence.snapshotSha256, sourceSha);
  assert.deepEqual(evidence.objectIds, [opening.id, wall.id].sort());
  assert.deepEqual(
    evidence.objectLineage,
    [opening, wall]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((object) => ({
        objectId: object.id,
        objectVersion: object.version,
      })),
  );
  assert.equal(evidence.measurements[opening.id].measurement.count, "1");

  assert.throws(
    () =>
      workspaceServer.deriveAuthorizedDrawingMeasurementEvidence({
        ...bootstrap,
        operationSequence: 18,
      }),
    /checkpoint|operation sequence|inconsistent/i,
  );
  const clientMeasurement = new FormData();
  clientMeasurement.set("intent", "measurement_evidence");
  clientMeasurement.set("revision_id", ids.revision);
  clientMeasurement.set("object_id", opening.id);
  clientMeasurement.set("length_millimeters", "999999");
  assert.throws(
    () => parseWorkspaceMutation(clientMeasurement),
    /지원하지|intent|invalid|expected/i,
  );

  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceMeasurementState(
      {
        async rpc() {
          return { data: bootstrap, error: null };
        },
      },
      {
        documentId: "00000000-0000-4000-8000-000000000099",
        revisionId: ids.revision,
        revisionVersion: 1,
      },
    ),
    /document lineage is inconsistent/i,
  );
});

test("authorized measurement derivation returns a bounded error without evidence for an invalid graph", async () => {
  assert.equal(
    typeof workspaceServer.deriveAuthorizedDrawingMeasurementEvidenceResult,
    "function",
  );
  const opening = p4Object(
    p4FixtureIds.opening,
    ids.workLayer,
    validP4Geometries[1],
    "D-01",
  );
  const bootstrap = {
    canonicalJson: {
      schemaVersion: 2,
      revision: {
        id: ids.revision,
        documentId: ids.document,
        projectId: ids.project,
        sequence: 1,
        version: 1,
      },
      sources: [],
      pages: [],
      canvases: [],
      layers: [],
      objects: [
        {
          ...opening,
          lineageId: opening.id,
          pageId: ids.page,
          type: opening.geometry.type,
        },
      ],
      styles: [],
      blocks: [],
      blockInstances: [],
      propertySchemas: [],
      propertyValues: [],
      tables: [],
      issues: [],
      operationSequence: 17,
    },
    operationSequence: 17,
    schemaVersion: 2,
    sha256: sourceSha,
    revisionStatus: "draft",
    capability: "viewer",
    canWrite: false,
    recentOutcomes: [],
  };

  const result =
    workspaceServer.deriveAuthorizedDrawingMeasurementEvidenceResult(bootstrap);
  assert.deepEqual(result, {
    evidence: null,
    error: {
      code: "measurement_derivation_failed",
      message: "서버 측정 증거를 계산하지 못했습니다.",
    },
  });

  const routeState = await workspaceServer.loadDrawingWorkspaceMeasurementState(
    {
      async rpc() {
        return { data: bootstrap, error: null };
      },
    },
    {
      documentId: ids.document,
      revisionId: ids.revision,
      revisionVersion: 1,
    },
  );
  assert.equal(routeState.collaborationBootstrap, null);
  assert.equal(routeState.authorizedCapability, "viewer");
  assert.equal(routeState.measurementEvidence, null);
  assert.equal(
    routeState.measurementEvidenceError?.code,
    "measurement_derivation_failed",
  );
});

test("P2 blank canvases do not sign an undefined legacy background and select the authoritative default canvas", async () => {
  const client = queryClient({
    lukas_qto_files: {
      data: {
        id: ids.file,
        project_id: ids.project,
        kind: "pdf",
        sha256: sourceSha,
        immutable: true,
        storage_path: "source.pdf",
      },
      error: null,
    },
    lukas_drawing_documents: {
      data: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: ids.file,
        source_sha256: sourceSha,
      },
      error: null,
    },
    lukas_drawing_revisions: {
      data: {
        id: ids.revision,
        document_id: ids.document,
        project_id: ids.project,
        status: "draft",
        version: 1,
      },
      error: null,
    },
    lukas_drawing_pages: {
      data: [
        {
          id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "A-101",
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_canvases: {
      data: [
        {
          id: p2Ids.canvas,
          page_id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "Paper",
          space_kind: "paper",
          width_mm: 841,
          height_mm: 594,
          background_source_file_id: null,
          background_source_sha256: null,
          background_pdf_page: null,
          calibration: null,
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_layers: {
      data: [
        {
          id: ids.workLayer,
          page_id: ids.page,
          canvas_id: p2Ids.canvas,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "Work",
          sort_order: 0,
          visible: true,
          locked: false,
          system_kind: "work",
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_objects: { data: [], error: null },
    lukas_drawing_styles: { data: [], error: null },
    lukas_drawing_blocks: { data: [], error: null },
    lukas_drawing_block_instances: { data: [], error: null },
    lukas_drawing_property_schemas: { data: [], error: null },
    lukas_drawing_property_values: { data: [], error: null },
    lukas_drawing_tables: { data: [], error: null },
  });
  const workspace = await loadDrawingWorkspace(client, ids.project, ids.file);
  assert.equal(workspace.document.revision.activePageId, ids.page);
  assert.equal(workspace.document.revision.activeCanvasId, p2Ids.canvas);
  assert.equal(
    await workspaceServer.loadDrawingWorkspaceSourceUrl(
      {
        storage: {
          from() {
            throw new Error("must not sign");
          },
        },
      },
      workspace,
    ),
    null,
  );
});

test("template clone accepts only project-bound source IDs and parses its authoritative response", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          documentId: ids.document,
          revisionId: ids.revision,
          sourceRevisionId: p2Ids.template,
        },
        error: null,
      };
    },
  };
  const result = await createDrawingDocumentFromTemplate(
    client,
    p2Ids.template,
    " Template draft ",
    ids.file,
    ids.operation,
  );
  assert.deepEqual(result, {
    documentId: ids.document,
    revisionId: ids.revision,
    sourceRevisionId: p2Ids.template,
  });
  assert.deepEqual(calls, [
    [
      "lukas_drawing_create_from_template",
      {
        p_source_revision_id: p2Ids.template,
        p_title: "Template draft",
        p_source_file_id: ids.file,
        p_client_request_id: ids.operation,
      },
    ],
  ]);
});

test("template clone rejects browser authority fields, foreign candidates, and non-draft destinations", async () => {
  assert.throws(() =>
    parseWorkspaceMutation(
      form({
        intent: "create_from_template",
        source_revision_id: p2Ids.template,
        title: "Draft",
        project_id: ids.project,
      }),
    ),
  );
  const base = {
    ...loadedWorkspace(),
    templateCandidates: [
      {
        revisionId: p2Ids.template,
        title: "Approved",
        version: 3,
        approvedAt: "2026-08-25T00:00:00.000Z",
        snapshotSha256: sourceSha,
      },
    ],
  };
  const cloneForm = form({
    intent: "create_from_template",
    source_revision_id: p2Ids.template,
    title: "Draft",
    client_request_id: ids.operation,
  });
  const accepted = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: {
            documentId: ids.document,
            revisionId: ids.revision,
            sourceRevisionId: p2Ids.template,
          },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace: base,
    form: cloneForm,
  });
  assert.equal(accepted.status, 200);
  const fromDocumentCreation = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: {
            documentId: ids.document,
            revisionId: ids.revision,
            sourceRevisionId: p2Ids.template,
          },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace: { ...base, document: null },
    form: cloneForm,
  });
  assert.equal(fromDocumentCreation.status, 200);
  const foreign = await handleWorkspaceMutation({
    client: {
      async rpc() {
        throw new Error("must not call");
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace: base,
    form: form({
      intent: "create_from_template",
      source_revision_id: ids.actor,
      title: "Draft",
      client_request_id: ids.operation,
    }),
  });
  assert.equal(foreign.status, 404);
  const reviewed = await handleWorkspaceMutation({
    client: {
      async rpc() {
        throw new Error("must not call");
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace: {
      ...base,
      document: {
        ...base.document,
        revision: { ...base.document.revision, status: "review_requested" },
      },
    },
    form: cloneForm,
  });
  assert.equal(reviewed.status, 409);
});

test("template candidates expose only approved project revisions with matching immutable snapshot evidence", async () => {
  const candidate = await loadDrawingTemplateCandidates(
    queryClient({
      lukas_drawing_revisions: {
        data: [
          {
            id: p2Ids.template,
            document_id: ids.document,
            project_id: ids.project,
            status: "approved",
            version: 3,
            approved_at: "2026-08-25T00:00:00.000Z",
          },
        ],
        error: null,
      },
      lukas_drawing_documents: {
        data: [
          {
            id: ids.document,
            project_id: ids.project,
            title: "Approved A-101",
          },
        ],
        error: null,
      },
      lukas_drawing_snapshots: {
        data: [
          {
            id: ids.link,
            revision_id: p2Ids.template,
            project_id: ids.project,
            revision_version: 3,
            sha256: sourceSha,
          },
        ],
        error: null,
      },
    }),
    ids.project,
  );
  assert.deepEqual(candidate, [
    {
      revisionId: p2Ids.template,
      title: "Approved A-101",
      version: 3,
      approvedAt: "2026-08-25T00:00:00.000Z",
      snapshotSha256: sourceSha,
    },
  ]);
});

function form(fields) {
  const result = new FormData();
  for (const [key, value] of Object.entries(fields))
    result.set(key, typeof value === "string" ? value : JSON.stringify(value));
  return result;
}

function operation(overrides = {}) {
  return {
    clientOperationId: ids.operation,
    revisionId: ids.revision,
    type: "add_objects",
    baseVersions: {},
    forward: {
      type: "add_objects",
      objects: [
        {
          id: ids.object,
          name: "Circle",
          layerId: ids.workLayer,
          geometry: {
            type: "circle",
            center: { x: 10, y: 20 },
            radius: 4,
          },
          style: { stroke: "#112233", strokeWidth: 2, fill: null },
          version: 1,
        },
      ],
    },
    inverse: { type: "delete_objects", objectIds: [ids.object] },
    createdAt: "2026-08-24T02:00:00.000Z",
    ...overrides,
  };
}

test("mutation parsing preserves a valid operation without accepting authority fields", () => {
  const input = operation();
  assert.deepEqual(
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: input }),
    ),
    { intent: "apply_operation", operation: input },
  );

  for (const authority of ["actor_id", "actorId", "project_id", "capability"])
    assert.throws(() =>
      parseWorkspaceMutation(
        form({
          intent: "apply_operation",
          operation_json: input,
          [authority]: ids.actor,
        }),
      ),
    );

  assert.throws(() =>
    parseWorkspaceMutation(
      form({
        intent: "apply_operation",
        operation_json: { ...input, actorId: ids.actor },
      }),
    ),
  );
});

test("server parses and acknowledges the exact reference-aware object mutation contract", async () => {
  const object = operation().forward.objects[0];
  const input = {
    clientOperationId: ids.operation,
    revisionId: ids.revision,
    type: "mutate_objects_with_references",
    baseVersions: { [ids.object]: 1 },
    forward: {
      type: "mutate_objects_with_references",
      objectAction: "delete",
      objects: [object],
      actions: [],
    },
    inverse: {
      type: "mutate_objects_with_references",
      objectAction: "restore",
      objects: [{ ...object, version: 3 }],
      actions: [],
    },
    createdAt: "2026-08-25T00:00:00.000Z",
  };
  assert.deepEqual(
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: input }),
    ),
    { intent: "apply_operation", operation: input },
  );
  const calls = [];
  await applyDrawingOperation(
    {
      async rpc(name, payload) {
        calls.push([name, payload]);
        return {
          data: {
            operationId: ids.operation,
            sequence: 1,
            resultVersions: { [ids.object]: null },
          },
          error: null,
        };
      },
    },
    input,
  );
  assert.equal(calls.length, 1);
  await assert.rejects(
    () =>
      applyDrawingOperation(
        {
          async rpc() {
            return {
              data: {
                operationId: ids.operation,
                sequence: 1,
                resultVersions: { [ids.object]: 2 },
              },
              error: null,
            };
          },
        },
        input,
      ),
    (error) => error.name === "DrawingWorkspaceRpcError",
  );
});

test("blank canvas creation retains route source identity while omitting its PDF background", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: { documentId: ids.document }, error: null };
    },
  };
  await createDrawingDocument(
    client,
    ids.project,
    { id: ids.file, kind: "pdf" },
    {
      title: "Blank",
      mode: "blank",
    },
  );
  await createDrawingDocument(
    client,
    ids.project,
    { id: ids.file, kind: "pdf" },
    {
      title: "Background",
      mode: "pdf_background",
    },
  );
  assert.equal(calls[0][1].p_source_file_id, ids.file);
  assert.equal(calls[0][1].p_blank, true);
  assert.equal(calls[1][1].p_source_file_id, ids.file);
  assert.equal(calls[1][1].p_blank, false);
});

test("blank workspace creation can omit a drawing source file", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return { data: { documentId: ids.document }, error: null };
    },
  };
  await createDrawingDocument(client, ids.project, null, {
    title: "빈 작업실",
    mode: "blank",
  });
  assert.equal(calls[0][1].p_source_file_id, null);
  assert.equal(calls[0][1].p_blank, true);
});

test("workspace loading opens a source-less document without a drawing file", async () => {
  const canvasId = "00000000-0000-4000-8000-000000000013";
  const client = queryClient({
    lukas_drawing_documents: {
      data: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: null,
        source_sha256: null,
        title: "빈 작업실",
      },
      error: null,
    },
    lukas_drawing_revisions: {
      data: {
        id: ids.revision,
        document_id: ids.document,
        project_id: ids.project,
        status: "draft",
        version: 1,
        sequence: 1,
      },
      error: null,
    },
    lukas_drawing_canvases: {
      data: [
        {
          id: canvasId,
          page_id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "1 Paper",
          space_kind: "paper",
          width_mm: 420,
          height_mm: 297,
          background_source_file_id: null,
          background_source_sha256: null,
          background_pdf_page: null,
          calibration: null,
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_pages: {
      data: [
        {
          id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "1",
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_layers: {
      data: [
        {
          id: ids.workLayer,
          page_id: ids.page,
          canvas_id: canvasId,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "작업",
          sort_order: 1,
          visible: true,
          locked: false,
          system_kind: "work",
          version: 1,
        },
        {
          id: ids.sourceLayer,
          page_id: ids.page,
          canvas_id: canvasId,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "원본",
          sort_order: 0,
          visible: true,
          locked: true,
          system_kind: "source",
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_objects: { data: [], error: null },
    lukas_drawing_object_sources: { data: [], error: null },
    lukas_drawing_library_imports: { data: [], error: null },
  });
  const loaded = await loadDrawingWorkspace(client, {
    projectId: ids.project,
    workspaceId: ids.document,
  });
  assert.equal(loaded.primarySource, null);
  assert.equal(loaded.document.id, ids.document);
});

test("stable domain SQLSTATEs map to terminal conflict or rejection while database retries stay transient", async () => {
  const workspace = loadedWorkspace();
  const applyForm = form({
    intent: "apply_operation",
    operation_json: operation(),
  });
  for (const [code, kind, status] of [
    ["P1C01", "conflict", 409],
    ["P1R01", "rejected", 404],
    ["40001", "retryable", 503],
    ["40P01", "retryable", 503],
  ]) {
    const result = await handleWorkspaceMutation({
      client: {
        async rpc() {
          return { data: null, error: { code, message: `failure ${code}` } };
        },
      },
      projectId: ids.project,
      capability: "editor",
      workspace,
      form: applyForm,
    });
    assert.equal(result.status, status);
    assert.equal(result.body.kind, kind);
  }
});

test("mutation parsing rejects malformed canonical geometry before an RPC", () => {
  const malformed = operation();
  malformed.forward.objects[0].geometry.radius = -1;
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: malformed }),
    ),
  );
});

test("mutation parsing rejects unknown nested renderer fields instead of stripping them", () => {
  const rendererShaped = operation();
  rendererShaped.forward.objects[0].geometry.attrs = { radius: 4 };
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: rendererShaped }),
    ),
  );
});

test("mutation parsing requires object names and rejects browser layer authority", () => {
  const missingName = operation();
  delete missingName.forward.objects[0].name;
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: missingName }),
    ),
  );

  const addLayer = operation({
    type: "add_layer",
    forward: {
      type: "add_layer",
      layer: {
        id: ids.sourceLayer,
        name: "Injected source",
        visible: true,
        locked: true,
        systemKind: "source",
        version: 1,
      },
    },
    inverse: {},
  });
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: addLayer }),
    ),
  );
});

test("pasted add payload is exact canonical DrawingObject input for server parsing", () => {
  const source = {
    id: ids.object,
    name: "Rectangle",
    layerId: ids.workLayer,
    geometry: {
      type: "rectangle",
      origin: { x: 0, y: 0 },
      width: 20,
      height: 10,
      rotation: 0,
    },
    style: { stroke: "#112233", strokeWidth: 2, fill: null },
    version: 1,
  };
  const state = createDrawingDocumentState({
    revisionId: ids.revision,
    layers: [
      {
        id: ids.workLayer,
        name: "Work",
        visible: true,
        locked: false,
        systemKind: "work",
        version: 1,
      },
    ],
    objects: [source],
  });
  const pasted = pasteDrawingClipboard(
    copyDrawingSelection(state, [ids.object]),
    ids.actor,
    () => "00000000-0000-4000-8000-000000000011",
  );
  const applied = applyDrawingCommand(state, pasted, {
    createId: () => ids.operation,
    now: () => "2026-08-24T02:00:00.000Z",
  });
  const recorded = Object.fromEntries(
    [
      "baseVersions",
      "clientOperationId",
      "createdAt",
      "forward",
      "inverse",
      "revisionId",
      "type",
    ].map((key) => [key, applied.operation[key]]),
  );

  assert.deepEqual(
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: recorded }),
    ),
    { intent: "apply_operation", operation: recorded },
  );
  const noncanonical = structuredClone(recorded);
  noncanonical.forward.objects[0].lineageId = ids.object;
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "apply_operation", operation_json: noncanonical }),
    ),
  );
});

test("mutation parsing accepts only the approved narrow intent shapes", () => {
  const revision = ids.revision;
  assert.deepEqual(
    parseWorkspaceMutation(
      form({ intent: "create_document", title: " A-101 " }),
    ),
    { intent: "create_document", title: "A-101" },
  );
  assert.deepEqual(
    parseWorkspaceMutation(form({ intent: "create_layer", name: " 주석 " })),
    { intent: "create_layer", name: "주석" },
  );
  assert.deepEqual(
    parseWorkspaceMutation(
      form({
        intent: "link_issue",
        object_id: ids.object,
        issue_id: ids.actor,
      }),
    ),
    { intent: "link_issue", objectId: ids.object, issueId: ids.actor },
  );
  assert.deepEqual(
    parseWorkspaceMutation(
      form({
        intent: "request_review",
        revision_id: revision,
        freeze_request_id: ids.operation,
      }),
    ),
    {
      intent: "request_review",
      revisionId: revision,
      requestId: ids.operation,
    },
  );
  assert.deepEqual(
    parseWorkspaceMutation(
      form({
        intent: "record_revision_decision",
        revision_id: revision,
        subject_version: "7",
        snapshot_sha256: sourceSha,
        decision: "rejected",
        note: " 치수 근거 보완 ",
      }),
    ),
    {
      intent: "record_revision_decision",
      revisionId: revision,
      subjectVersion: 7,
      snapshotSha256: sourceSha,
      decision: "rejected",
      note: "치수 근거 보완",
    },
  );

  assert.throws(() => parseWorkspaceMutation(form({ intent: "unknown" })));
  assert.throws(() =>
    parseWorkspaceMutation(
      form({ intent: "create_document", title: "A-101", role: "owner" }),
    ),
  );
});

test("review rejection immediately notifies collaboration authority for the live room", async () => {
  const workspace = loadedWorkspace();
  workspace.document.revision.status = "review_requested";
  const reconciliations = [];
  const response = await handleWorkspaceMutation({
    client: {
      async rpc(name) {
        assert.equal(name, "lukas_drawing_record_revision_decision");
        return { data: { decision: "rejected" }, error: null };
      },
    },
    projectId: ids.project,
    capability: "reviewer",
    workspace,
    form: form({
      intent: "record_revision_decision",
      revision_id: ids.revision,
      subject_version: "1",
      snapshot_sha256: sourceSha,
      decision: "rejected",
      note: "revise",
    }),
    async reconcileDecision(scope) {
      reconciliations.push(scope);
      return true;
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(reconciliations, [
    { projectId: ids.project, revisionId: ids.revision },
  ]);
});

function queryClient(responses) {
  const calls = [];
  return {
    calls,
    from(table) {
      const call = { table, filters: [], orders: [] };
      calls.push(call);
      const response = responses[table] ?? { data: [], error: null };
      const builder = {
        select(columns) {
          call.select = columns;
          return builder;
        },
        eq(column, value) {
          call.filters.push(["eq", column, value]);
          return builder;
        },
        in(column, values) {
          call.filters.push(["in", column, values]);
          return builder;
        },
        order(column, options) {
          call.orders.push([column, options]);
          return builder;
        },
        gt(column, value) {
          call.filters.push(["gt", column, value]);
          return builder;
        },
        limit(value) {
          call.limit = value;
          if (value === 1) return builder;
          call.terminal = "limit";
          const rows = Array.isArray(response.data) ? response.data : [];
          const cursor = call.filters.find((filter) => filter[0] === "gt")?.[2];
          return Promise.resolve({
            ...response,
            data: Array.isArray(response.data)
              ? rows
                  .filter((row) => cursor == null || row.id > cursor)
                  .slice(0, value)
              : [],
          });
        },
        range(from, to) {
          call.range = [from, to];
          call.terminal = "range";
          return Promise.resolve({
            ...response,
            data: Array.isArray(response.data) ? response.data : [],
          });
        },
        single() {
          call.terminal = "single";
          return Promise.resolve(response);
        },
        maybeSingle() {
          call.terminal = "maybeSingle";
          return Promise.resolve(response);
        },
        then(resolve, reject) {
          call.terminal = "await";
          return Promise.resolve(response).then(resolve, reject);
        },
      };
      return builder;
    },
  };
}

function canonicalLoaderResponses(overrides = {}) {
  return {
    lukas_qto_files: {
      data: {
        id: ids.file,
        project_id: ids.project,
        kind: "pdf",
        original_filename: "A-101.pdf",
        storage_path: "projects/source.pdf",
        content_type: "application/pdf",
        byte_size: 1234,
        sha256: sourceSha,
        immutable: true,
        created_at: "2026-08-24T00:00:00.000Z",
      },
      error: null,
    },
    lukas_drawing_documents: {
      data: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: ids.file,
        source_sha256: sourceSha,
        title: "A-101",
        created_by: ids.actor,
        created_at: "2026-08-24T00:00:00.000Z",
        updated_at: "2026-08-24T01:00:00.000Z",
      },
      error: null,
    },
    lukas_drawing_revisions: {
      data: {
        id: ids.revision,
        document_id: ids.document,
        project_id: ids.project,
        parent_revision_id: null,
        sequence: 1,
        status: "draft",
        version: 1,
        created_by: ids.actor,
        review_requested_at: null,
        approved_at: null,
        created_at: "2026-08-24T00:00:00.000Z",
        updated_at: "2026-08-24T01:00:00.000Z",
      },
      error: null,
    },
    ...overrides,
  };
}

function assertDrawingGraphNotLoaded(client) {
  for (const table of [
    "lukas_drawing_canvases",
    "lukas_drawing_pages",
    "lukas_drawing_layers",
    "lukas_drawing_objects",
  ])
    assert.equal(
      client.calls.some((call) => call.table === table),
      false,
      `${table} must not load after identity rejection`,
    );
}

test("canonical loader returns bounded 404 when the exact document is absent", async () => {
  const client = queryClient(
    canonicalLoaderResponses({
      lukas_drawing_documents: { data: null, error: null },
    }),
  );
  await assert.rejects(
    loadDrawingWorkspace(client, {
      projectId: ids.project,
      workspaceId: ids.document,
    }),
    (error) => error instanceof Response && error.status === 404,
  );
  assert.equal(
    client.calls.some((call) => call.table === "lukas_drawing_revisions"),
    false,
  );
  assertDrawingGraphNotLoaded(client);
});

test("canonical loader returns bounded 404 when the exact requested revision is absent", async () => {
  const client = queryClient(
    canonicalLoaderResponses({
      lukas_drawing_revisions: { data: null, error: null },
    }),
  );
  await assert.rejects(
    loadDrawingWorkspace(client, {
      projectId: ids.project,
      workspaceId: ids.document,
      revisionId: ids.revision,
    }),
    (error) => error instanceof Response && error.status === 404,
  );
  const revisionCall = client.calls.find(
    (call) => call.table === "lukas_drawing_revisions",
  );
  assert.deepEqual(revisionCall.filters, [
    ["eq", "project_id", ids.project],
    ["eq", "document_id", ids.document],
    ["eq", "id", ids.revision],
  ]);
  assert.equal(
    client.calls.some((call) => call.table === "lukas_qto_files"),
    false,
  );
  assertDrawingGraphNotLoaded(client);
});

test("canonical loader rejects document/revision ancestry before source or graph loading", async () => {
  const client = queryClient(
    canonicalLoaderResponses({
      lukas_drawing_documents: {
        data: {
          id: ids.document,
          project_id: ids.project,
          source_file_id: null,
          source_sha256: null,
          title: "Blank",
          created_by: ids.actor,
          created_at: "2026-08-24T00:00:00.000Z",
          updated_at: "2026-08-24T01:00:00.000Z",
        },
        error: null,
      },
      lukas_drawing_revisions: {
        data: {
          id: ids.revision,
          document_id: "00000000-0000-4000-8000-000000000099",
          project_id: ids.project,
          parent_revision_id: null,
          sequence: 1,
          status: "draft",
          version: 1,
          created_by: ids.actor,
          review_requested_at: null,
          approved_at: null,
          created_at: "2026-08-24T00:00:00.000Z",
          updated_at: "2026-08-24T01:00:00.000Z",
        },
        error: null,
      },
    }),
  );
  await assert.rejects(
    loadDrawingWorkspace(client, {
      projectId: ids.project,
      workspaceId: ids.document,
    }),
    /Drawing document ancestry is invalid/,
  );
  assert.equal(
    client.calls.some((call) => call.table === "lukas_qto_files"),
    false,
  );
  assertDrawingGraphNotLoaded(client);
});

test("canonical loader returns bounded 404 when a source-backed document has no source row", async () => {
  const client = queryClient(
    canonicalLoaderResponses({
      lukas_qto_files: { data: null, error: null },
    }),
  );
  await assert.rejects(
    loadDrawingWorkspace(client, {
      projectId: ids.project,
      workspaceId: ids.document,
    }),
    (error) => error instanceof Response && error.status === 404,
  );
  assertDrawingGraphNotLoaded(client);
});

test("canonical loader returns bounded 404 when immutable source SHA differs", async () => {
  const client = queryClient(
    canonicalLoaderResponses({
      lukas_qto_files: {
        data: {
          id: ids.file,
          project_id: ids.project,
          kind: "pdf",
          original_filename: "A-101.pdf",
          storage_path: "projects/source.pdf",
          content_type: "application/pdf",
          byte_size: 1234,
          sha256: "b".repeat(64),
          immutable: true,
          created_at: "2026-08-24T00:00:00.000Z",
        },
        error: null,
      },
    }),
  );
  await assert.rejects(
    loadDrawingWorkspace(client, {
      projectId: ids.project,
      workspaceId: ids.document,
    }),
    (error) => error instanceof Response && error.status === 404,
  );
  assertDrawingGraphNotLoaded(client);
});

test("document-first loader accepts a workspace without a primary source", async () => {
  const client = queryClient({
    lukas_drawing_documents: {
      data: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: null,
        source_sha256: null,
        title: "Blank workspace",
      },
      error: null,
    },
    lukas_drawing_revisions: {
      data: {
        id: ids.revision,
        document_id: ids.document,
        project_id: ids.project,
        status: "draft",
        version: 1,
      },
      error: null,
    },
    lukas_drawing_pages: {
      data: [
        {
          id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "Page 1",
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_canvases: {
      data: [
        {
          id: p2Ids.canvas,
          page_id: ids.page,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "Blank canvas",
          space_kind: "paper",
          width_mm: 841,
          height_mm: 594,
          background_source_file_id: null,
          background_source_sha256: null,
          background_pdf_page: null,
          calibration: null,
          sort_order: 0,
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_layers: {
      data: [
        {
          id: ids.workLayer,
          page_id: ids.page,
          canvas_id: p2Ids.canvas,
          revision_id: ids.revision,
          project_id: ids.project,
          name: "Work",
          sort_order: 0,
          visible: true,
          locked: false,
          system_kind: "work",
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_objects: { data: [], error: null },
    lukas_drawing_object_sources: { data: [], error: null },
    lukas_drawing_styles: { data: [], error: null },
    lukas_drawing_blocks: { data: [], error: null },
    lukas_drawing_block_instances: { data: [], error: null },
    lukas_drawing_property_schemas: { data: [], error: null },
    lukas_drawing_property_values: { data: [], error: null },
    lukas_drawing_tables: { data: [], error: null },
  });

  const loaded = await loadDrawingWorkspace(client, {
    projectId: ids.project,
    workspaceId: ids.document,
  });
  assert.equal(loaded.primarySource, null);
  assert.equal(loaded.document.id, ids.document);
  assert.equal(loaded.document.revision.id, ids.revision);
  assert.equal(
    client.calls.some((call) => call.table === "lukas_qto_files"),
    false,
  );
});

function workspaceLoaderClient(layers, extraResponses = {}) {
  return queryClient({
    lukas_qto_files: {
      data: {
        id: ids.file,
        project_id: ids.project,
        kind: "pdf",
        sha256: sourceSha,
        immutable: true,
      },
      error: null,
    },
    lukas_drawing_documents: {
      data: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: ids.file,
        source_sha256: sourceSha,
      },
      error: null,
    },
    lukas_drawing_revisions: {
      data: {
        id: ids.revision,
        document_id: ids.document,
        project_id: ids.project,
        status: "draft",
        version: 1,
      },
      error: null,
    },
    lukas_drawing_pages: { data: [{ id: ids.page }], error: null },
    lukas_drawing_layers: { data: layers, error: null },
    lukas_drawing_objects: { data: [], error: null },
    ...extraResponses,
  });
}

test("workspace loading binds immutable PDF evidence to its project and performs no insert", async () => {
  const file = {
    id: ids.file,
    project_id: ids.project,
    kind: "pdf",
    original_filename: "A-101.pdf",
    storage_path: "projects/source.pdf",
    content_type: "application/pdf",
    byte_size: 1234,
    sha256: sourceSha,
    immutable: true,
    created_at: "2026-08-24T00:00:00.000Z",
  };
  const document = {
    id: ids.document,
    project_id: ids.project,
    source_file_id: ids.file,
    source_sha256: sourceSha,
    title: "A-101",
    created_by: ids.actor,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T01:00:00.000Z",
  };
  const revision = {
    id: ids.revision,
    document_id: ids.document,
    project_id: ids.project,
    parent_revision_id: null,
    sequence: 1,
    status: "draft",
    version: 1,
    created_by: ids.actor,
    review_requested_at: null,
    approved_at: null,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T01:00:00.000Z",
  };
  const client = queryClient({
    lukas_qto_files: { data: file, error: null },
    lukas_drawing_documents: { data: document, error: null },
    lukas_drawing_revisions: { data: revision, error: null },
    lukas_drawing_pages: { data: [{ id: ids.page }], error: null },
    lukas_drawing_layers: {
      data: [
        {
          id: ids.sourceLayer,
          page_id: ids.page,
          name: "Source",
          locked: true,
          visible: true,
          system_kind: "source",
          version: 1,
        },
        {
          id: ids.workLayer,
          page_id: ids.page,
          name: "Work",
          locked: false,
          visible: true,
          system_kind: "work",
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_objects: { data: [], error: null },
  });

  const loaded = await loadDrawingWorkspace(client, {
    projectId: ids.project,
    workspaceId: ids.document,
  });

  assert.equal(loaded.primarySource.sha256, sourceSha);
  assert.equal(loaded.document.revision.id, ids.revision);
  assert.deepEqual(loaded.document.revision.pages, [{ id: ids.page }]);
  assert.deepEqual(
    client.calls.slice(0, 3).map((call) => call.table),
    ["lukas_drawing_documents", "lukas_drawing_revisions", "lukas_qto_files"],
  );
  assert.deepEqual(client.calls[2].filters, [
    ["eq", "project_id", ids.project],
    ["eq", "id", ids.file],
    ["in", "kind", ["pdf", "ifc"]],
    ["eq", "immutable", true],
  ]);
  assert.equal(
    client.calls.some((call) => call.mutation),
    false,
  );
  assert.equal(file.sha256, sourceSha);
});

test("workspace loading scopes searchable issues and current links to the project revision", async () => {
  const activeObject = operation().forward.objects[0];
  const objectRow = {
    ...activeObject,
    object_type: activeObject.geometry.type,
    layer_id: activeObject.layerId,
    status: "active",
  };
  const manyIssues = Array.from({ length: 1_005 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 100).padStart(12, "0")}`,
    project_id: ids.project,
    title: `issue ${index}`,
    priority: "high",
    status: "open",
    updated_at: "2026-08-24T03:00:00.000Z",
  }));
  const manyLinks = manyIssues.map((issue, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 2_000).padStart(12, "0")}`,
    object_id: ids.object,
    revision_id: ids.revision,
    issue_id: issue.id,
    project_id: ids.project,
    created_by: ids.actor,
    created_at: "2026-08-24T03:00:00.000Z",
  }));
  const responses = {
    lukas_drawing_objects: { data: [objectRow], error: null },
    lukas_drawing_issues: {
      data: manyIssues,
      error: null,
    },
    lukas_drawing_object_issue_links: {
      data: [
        ...manyLinks,
        {
          id: ids.operation,
          object_id: "00000000-0000-4000-8000-000000000099",
          revision_id: ids.revision,
          issue_id: manyIssues[0].id,
          project_id: ids.project,
          created_by: ids.actor,
          created_at: "2026-08-24T03:00:00.000Z",
        },
      ],
      error: null,
    },
  };
  const client = workspaceLoaderClient(
    [
      {
        id: ids.sourceLayer,
        page_id: ids.page,
        name: "Source",
        system_kind: "source",
        visible: true,
        locked: true,
        version: 1,
      },
      {
        id: ids.workLayer,
        page_id: ids.page,
        name: "Work",
        system_kind: "work",
        visible: true,
        locked: false,
        version: 1,
      },
    ],
    responses,
  );

  const loaded = await loadDrawingWorkspace(client, ids.project, ids.file);
  assert.deepEqual(loaded.document.revision.issues, manyIssues);
  assert.deepEqual(loaded.document.revision.issueLinks, [...manyLinks]);
  const issueCall = client.calls.find(
    (call) => call.table === "lukas_drawing_issues",
  );
  const linkCall = client.calls.find(
    (call) => call.table === "lukas_drawing_object_issue_links",
  );
  assert.deepEqual(issueCall.filters, [["eq", "project_id", ids.project]]);
  assert.deepEqual(linkCall.filters, [
    ["eq", "project_id", ids.project],
    ["eq", "revision_id", ids.revision],
  ]);
  assert.equal(
    client.calls.filter((call) => call.table === "lukas_drawing_issues").length,
    2,
  );
  assert.equal(
    client.calls.filter(
      (call) => call.table === "lukas_drawing_object_issue_links",
    ).length,
    2,
  );
});

test("workspace loading fails closed when source-layer metadata is missing", async () => {
  const file = {
    id: ids.file,
    project_id: ids.project,
    kind: "pdf",
    original_filename: "A-101.pdf",
    storage_path: "projects/source.pdf",
    content_type: "application/pdf",
    byte_size: 1234,
    sha256: sourceSha,
    immutable: true,
    created_at: "2026-08-24T00:00:00.000Z",
  };
  const client = queryClient({
    lukas_qto_files: { data: file, error: null },
    lukas_drawing_documents: {
      data: {
        id: ids.document,
        project_id: ids.project,
        source_file_id: ids.file,
        source_sha256: sourceSha,
      },
      error: null,
    },
    lukas_drawing_revisions: {
      data: {
        id: ids.revision,
        document_id: ids.document,
        project_id: ids.project,
        status: "draft",
        version: 1,
      },
      error: null,
    },
    lukas_drawing_pages: { data: [{ id: ids.page }], error: null },
    lukas_drawing_layers: {
      data: [{ id: ids.sourceLayer, name: "Source", locked: true }],
      error: null,
    },
    lukas_drawing_objects: { data: [], error: null },
  });

  await assert.rejects(
    loadDrawingWorkspace(client, ids.project, ids.file),
    /source layer metadata/i,
  );
});

test("workspace loading rejects invisible or unlocked source metadata", async () => {
  for (const source of [
    { visible: false, locked: true },
    { visible: true, locked: false },
  ]) {
    const client = workspaceLoaderClient([
      {
        id: ids.sourceLayer,
        page_id: ids.page,
        name: "Source",
        system_kind: "source",
        version: 1,
        ...source,
      },
      {
        id: ids.workLayer,
        page_id: ids.page,
        name: "Work",
        system_kind: "work",
        visible: true,
        locked: false,
        version: 1,
      },
    ]);

    await assert.rejects(
      loadDrawingWorkspace(client, ids.project, ids.file),
      /source layer metadata/i,
    );
  }
});

test("workspace loading rejects a page without an editable user layer", async () => {
  const client = workspaceLoaderClient([
    {
      id: ids.sourceLayer,
      page_id: ids.page,
      name: "Source",
      system_kind: "source",
      visible: true,
      locked: true,
      version: 1,
    },
    {
      id: ids.workLayer,
      page_id: ids.page,
      name: "Work",
      system_kind: "work",
      visible: true,
      locked: true,
      version: 1,
    },
  ]);

  await assert.rejects(
    loadDrawingWorkspace(client, ids.project, ids.file),
    /editable layer metadata/i,
  );
});

test("workspace loading returns a null document without creating one", async () => {
  const client = queryClient({
    lukas_qto_files: {
      data: {
        id: ids.file,
        project_id: ids.project,
        kind: "ifc",
        sha256: sourceSha,
        immutable: true,
      },
      error: null,
    },
    lukas_drawing_documents: { data: null, error: null },
  });
  const loaded = await loadDrawingWorkspace(client, ids.project, ids.file);
  assert.equal(loaded.document, null);
  assert.deepEqual(
    client.calls.map((call) => call.table),
    [
      "lukas_qto_files",
      "lukas_drawing_documents",
      "lukas_drawing_revisions",
      "lukas_drawing_documents",
      "lukas_drawing_snapshots",
    ],
  );
});

test("review-requested workspace loads its exact project-bound snapshot evidence", async () => {
  const snapshotSha = "b".repeat(64);
  const file = {
    id: ids.file,
    project_id: ids.project,
    kind: "pdf",
    original_filename: "A-101.pdf",
    storage_path: "projects/source.pdf",
    content_type: "application/pdf",
    byte_size: 1234,
    sha256: sourceSha,
    immutable: true,
    created_at: "2026-08-24T00:00:00.000Z",
  };
  const document = {
    id: ids.document,
    project_id: ids.project,
    source_file_id: ids.file,
    source_sha256: sourceSha,
    title: "A-101",
    created_by: ids.actor,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T01:00:00.000Z",
  };
  const revision = {
    id: ids.revision,
    document_id: ids.document,
    project_id: ids.project,
    parent_revision_id: null,
    sequence: 1,
    status: "review_requested",
    version: 7,
    created_by: ids.actor,
    review_requested_at: "2026-08-24T01:00:00.000Z",
    approved_at: null,
    created_at: "2026-08-24T00:00:00.000Z",
    updated_at: "2026-08-24T01:00:00.000Z",
  };
  const client = queryClient({
    lukas_qto_files: { data: file, error: null },
    lukas_drawing_documents: { data: document, error: null },
    lukas_drawing_revisions: { data: revision, error: null },
    lukas_drawing_pages: { data: [{ id: ids.page }], error: null },
    lukas_drawing_layers: {
      data: [
        {
          id: ids.sourceLayer,
          page_id: ids.page,
          name: "Source",
          locked: true,
          visible: true,
          system_kind: "source",
          version: 1,
        },
        {
          id: ids.workLayer,
          page_id: ids.page,
          name: "Work",
          locked: false,
          visible: true,
          system_kind: "work",
          version: 1,
        },
      ],
      error: null,
    },
    lukas_drawing_objects: { data: [], error: null },
    lukas_drawing_snapshots: {
      data: { revision_version: 7, sha256: snapshotSha },
      error: null,
    },
  });

  const loaded = await loadDrawingWorkspace(client, ids.project, ids.file);

  assert.deepEqual(loaded.document.revision.reviewEvidence, {
    subjectVersion: 7,
    snapshotSha256: snapshotSha,
  });
  const snapshotCall = client.calls.find(
    (call) => call.table === "lukas_drawing_snapshots",
  );
  assert.equal(snapshotCall.select, "revision_version,sha256");
  assert.deepEqual(snapshotCall.filters, [
    ["eq", "project_id", ids.project],
    ["eq", "revision_id", ids.revision],
    ["eq", "revision_version", 7],
  ]);
  assert.equal(snapshotCall.terminal, "maybeSingle");
});

test("workspace source signing never mints a raw IFC capability and preserves exact PDF evidence", async () => {
  assert.equal(
    typeof workspaceServer.loadDrawingWorkspaceSourceUrl,
    "function",
  );
  const calls = [];
  const client = {
    storage: {
      from(bucket) {
        calls.push(["bucket", bucket]);
        return {
          async createSignedUrl(path, expiresIn) {
            calls.push(["sign", path, expiresIn]);
            return {
              data: { signedUrl: "https://storage.test/source" },
              error: null,
            };
          },
        };
      },
    },
  };
  const ifcWorkspace = {
    primarySource: {
      id: ids.file,
      project_id: ids.project,
      kind: "ifc",
      original_filename: "model.ifc",
      storage_path: "projects/model.ifc",
      content_type: "application/x-step",
      byte_size: 2048,
      sha256: sourceSha,
      immutable: true,
      created_at: "2026-08-24T00:00:00.000Z",
    },
    document: loadedWorkspace().document,
  };
  assert.equal(
    await workspaceServer.loadDrawingWorkspaceSourceUrl(client, ifcWorkspace),
    null,
  );
  assert.deepEqual(calls, []);

  const blankPdf = {
    ...ifcWorkspace,
    primarySource: { ...ifcWorkspace.primarySource, kind: "pdf" },
  };
  assert.equal(
    await workspaceServer.loadDrawingWorkspaceSourceUrl(client, blankPdf),
    null,
  );
  const mismatchedPdf = {
    ...blankPdf,
    document: {
      ...blankPdf.document,
      revision: {
        ...blankPdf.document.revision,
        pages: [
          {
            background_pdf_page: 1,
            background_source_file_id: ids.file,
            background_source_sha256: "c".repeat(64),
          },
        ],
      },
    },
  };
  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceSourceUrl(client, mismatchedPdf),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.equal(calls.length, 0);
});

test("document creation derives blank/background behavior from the authoritative file kind", async () => {
  const rpcCalls = [];
  const client = {
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      return { data: { documentId: ids.document }, error: null };
    },
  };
  await createDrawingDocument(
    client,
    ids.project,
    { id: ids.file, kind: "pdf" },
    { title: " A-101 ", mode: "pdf_background" },
  );
  await createDrawingDocument(
    client,
    ids.project,
    { id: ids.file, kind: "ifc" },
    { title: " IFC 스케치 ", mode: "pdf_background" },
  );
  assert.deepEqual(rpcCalls, [
    [
      "lukas_drawing_create_document",
      {
        p_project_id: ids.project,
        p_source_file_id: ids.file,
        p_title: "A-101",
        p_blank: false,
      },
    ],
    [
      "lukas_drawing_create_document",
      {
        p_project_id: ids.project,
        p_source_file_id: ids.file,
        p_title: "IFC 스케치",
        p_blank: true,
      },
    ],
  ]);
});

test("idempotent document creation sends source-optional retry identity and exposes mismatches", async () => {
  const calls = [];
  const stored = new Map();
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      const identity = JSON.stringify({
        projectId: args.p_project_id,
        sourceFileId: args.p_source_file_id,
        title: args.p_title,
        blank: args.p_blank,
        libraryVersionId: args.p_library_version_id,
      });
      const previous = stored.get(args.p_client_request_id);
      if (previous && previous !== identity)
        return {
          data: null,
          error: {
            code: "P1C01",
            message: "Request ID does not match the stored drawing creation",
          },
        };
      stored.set(args.p_client_request_id, identity);
      return { data: { documentId: ids.document }, error: null };
    },
  };
  const input = {
    title: " 빈 작업실 ",
    mode: "blank",
    sourceFile: null,
    clientRequestId: ids.operation,
  };
  const first = await createDrawingDocumentIdempotent(
    client,
    ids.project,
    input,
  );
  const retry = await createDrawingDocumentIdempotent(
    client,
    ids.project,
    input,
  );
  assert.equal(first.documentId, ids.document);
  assert.equal(retry.documentId, ids.document);
  assert.deepEqual(calls[0], [
    "lukas_drawing_create_document_idempotent",
    {
      p_project_id: ids.project,
      p_source_file_id: null,
      p_title: "빈 작업실",
      p_blank: true,
      p_client_request_id: ids.operation,
      p_library_version_id: null,
    },
  ]);
  await assert.rejects(
    createDrawingDocumentIdempotent(client, ids.project, {
      ...input,
      title: "변경된 제목",
    }),
    (error) =>
      error.name === "DrawingWorkspaceConflictError" &&
      error.message === "Request ID does not match the stored drawing creation",
  );
  await assert.rejects(
    createDrawingDocumentIdempotent(client, ids.project, {
      ...input,
      libraryVersionId: ids.revision,
    }),
    (error) => error.name === "DrawingWorkspaceConflictError",
  );
});

test("operation RPC receives exact client operation fields and exposes conflicts", async () => {
  const input = operation();
  const calls = [];
  const successful = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          operationId: ids.operation,
          sequence: 1,
          resultVersions: { [ids.object]: 1 },
        },
        error: null,
      };
    },
  };
  await applyDrawingOperation(successful, input);
  assert.deepEqual(calls, [
    [
      "lukas_drawing_apply_operation",
      {
        p_revision_id: input.revisionId,
        p_client_operation_id: input.clientOperationId,
        p_operation_type: input.type,
        p_base_versions: input.baseVersions,
        p_forward: input.forward,
        p_inverse: input.inverse,
        p_history_action: null,
        p_original_operation_id: null,
      },
    ],
  ]);

  const conflicting = {
    async rpc() {
      return {
        data: null,
        error: { code: "P1C01", message: "Drawing object version conflict" },
      };
    },
  };
  await assert.rejects(
    () => applyDrawingOperation(conflicting, input),
    (error) =>
      error.name === "DrawingWorkspaceConflictError" &&
      error.kind === "conflict",
  );
  await assert.rejects(
    () =>
      applyDrawingOperation(
        {
          async rpc() {
            return { data: {}, error: null };
          },
        },
        input,
      ),
    /operationId|sequence|resultVersions/,
  );
});

test("structure acknowledgements bind each SQL-valid forward action to its exact reverse-indexed inverse", async () => {
  const secondStyleId = "00000000-0000-4000-8000-000000000021";
  const style = (id, version, name = "Dimension") => ({
    id,
    revisionId: ids.revision,
    name,
    value: { stroke: "#112233", strokeWidth: 1, fill: null },
    version,
  });
  const structure = (actions, inverseActions, baseVersions = {}) => ({
    clientOperationId: ids.operation,
    revisionId: ids.revision,
    type: "mutate_structure",
    baseVersions,
    forward: { type: "mutate_structure", actions },
    inverse: { type: "mutate_structure", actions: inverseActions },
    createdAt: "2026-08-24T02:00:00.000Z",
  });
  const acknowledge = (resultVersions) => ({
    async rpc() {
      return {
        data: { operationId: ids.operation, sequence: 1, resultVersions },
        error: null,
      };
    },
  });
  const fresh = structure(
    [{ kind: "put_style", entity: style(p2Ids.style, 1), baseVersion: null }],
    [{ kind: "delete_style", id: p2Ids.style, baseVersion: 1 }],
  );
  await applyDrawingOperation(acknowledge({ [p2Ids.style]: 1 }), fresh);
  const updated = structure(
    [
      {
        kind: "put_style",
        entity: style(p2Ids.style, 1, "Updated dimension"),
        baseVersion: 1,
      },
    ],
    [{ kind: "put_style", entity: style(p2Ids.style, 1), baseVersion: 2 }],
    { [p2Ids.style]: 1 },
  );
  await applyDrawingOperation(acknowledge({ [p2Ids.style]: 2 }), updated);
  const restored = structure(
    [{ kind: "put_style", entity: style(p2Ids.style, 5), baseVersion: null }],
    [{ kind: "delete_style", id: p2Ids.style, baseVersion: 7 }],
  );
  await applyDrawingOperation(acknowledge({ [p2Ids.style]: 7 }), restored);
  const deleted = structure(
    [{ kind: "delete_style", id: p2Ids.style, baseVersion: 7 }],
    [{ kind: "put_style", entity: style(p2Ids.style, 7), baseVersion: null }],
    { [p2Ids.style]: 7 },
  );
  await applyDrawingOperation(acknowledge({ [p2Ids.style]: null }), deleted);

  const ordered = structure(
    [
      { kind: "put_style", entity: style(p2Ids.style, 1), baseVersion: null },
      {
        kind: "put_style",
        entity: style(secondStyleId, 3, "Existing style"),
        baseVersion: 3,
      },
    ],
    [
      {
        kind: "put_style",
        entity: style(secondStyleId, 3, "Previous style"),
        baseVersion: 4,
      },
      { kind: "delete_style", id: p2Ids.style, baseVersion: 1 },
    ],
    { [secondStyleId]: 3 },
  );
  await applyDrawingOperation(
    acknowledge({ [p2Ids.style]: 1, [secondStyleId]: 4 }),
    ordered,
  );

  const rejects = [
    [fresh, { [p2Ids.style]: 7 }],
    [restored, { [p2Ids.style]: 8 }],
    [
      structure(fresh.forward.actions, fresh.forward.actions),
      { [p2Ids.style]: 1 },
    ],
    [
      structure(fresh.forward.actions, [
        ...fresh.inverse.actions,
        ...fresh.inverse.actions,
      ]),
      { [p2Ids.style]: 1 },
    ],
    [
      structure(fresh.forward.actions, [
        { kind: "delete_block", id: p2Ids.style, baseVersion: 1 },
      ]),
      { [p2Ids.style]: 1 },
    ],
    [
      structure(fresh.forward.actions, [
        { kind: "delete_style", id: secondStyleId, baseVersion: 1 },
      ]),
      { [p2Ids.style]: 1 },
    ],
    [
      structure(
        updated.forward.actions,
        [{ ...updated.inverse.actions[0], baseVersion: 3 }],
        { [p2Ids.style]: 1 },
      ),
      { [p2Ids.style]: 3 },
    ],
    [
      structure(
        deleted.forward.actions,
        [{ ...deleted.inverse.actions[0], baseVersion: 1 }],
        { [p2Ids.style]: 7 },
      ),
      { [p2Ids.style]: null },
    ],
    [
      structure(
        ordered.forward.actions,
        [...ordered.inverse.actions].reverse(),
        { [secondStyleId]: 3 },
      ),
      { [p2Ids.style]: 1, [secondStyleId]: 4 },
    ],
  ];
  for (const [operation, resultVersions] of rejects)
    await assert.rejects(
      () => applyDrawingOperation(acknowledge(resultVersions), operation),
      /확인 응답/,
    );

  for (const resultVersions of [
    { [p2Ids.style]: 1 },
    {},
    { [p2Ids.style]: 2, [ids.object]: 1 },
  ])
    await assert.rejects(
      () => applyDrawingOperation(acknowledge(resultVersions), updated),
      /확인 응답/,
    );
});

test("capability comes from project ownership or membership rows, never user metadata", async () => {
  const ownerClient = queryClient({});
  assert.equal(
    await loadDrawingWorkspaceCapability(
      ownerClient,
      ids.project,
      ids.actor,
      ids.actor,
    ),
    "admin",
  );
  assert.equal(ownerClient.calls.length, 0);

  const memberClient = queryClient({
    lukas_qto_project_members: { data: { role: "estimator" }, error: null },
  });
  assert.equal(
    await loadDrawingWorkspaceCapability(
      memberClient,
      ids.project,
      ids.actor,
      ids.document,
    ),
    "editor",
  );
  assert.deepEqual(memberClient.calls[0].filters, [
    ["eq", "project_id", ids.project],
    ["eq", "user_id", ids.actor],
  ]);

  const approverClient = queryClient({
    lukas_qto_project_members: { data: { role: "approver" }, error: null },
  });
  assert.equal(
    await loadDrawingWorkspaceCapability(
      approverClient,
      ids.project,
      ids.actor,
      ids.document,
    ),
    "approver",
  );
});

test("reviewer recommendation and approver final approval are separate action authorities", async () => {
  const calls = [];
  const client = {
    async rpc(name, input) {
      calls.push([name, input.p_decision]);
      return { data: { decision: input.p_decision }, error: null };
    },
  };
  const decisionForm = (decision) =>
    form({
      intent: "record_revision_decision",
      revision_id: ids.revision,
      subject_version: "1",
      snapshot_sha256: sourceSha,
      decision,
      note: "separated",
    });
  const reviewWorkspace = loadedWorkspace();
  reviewWorkspace.document.revision.status = "review_requested";
  const reviewed = await handleWorkspaceMutation({
    client,
    projectId: ids.project,
    capability: "reviewer",
    workspace: reviewWorkspace,
    form: decisionForm("reviewed"),
  });
  assert.equal(reviewed.status, 200);

  await assert.rejects(
    handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability: "reviewer",
      workspace: reviewWorkspace,
      form: decisionForm("approved"),
    }),
    (error) => error instanceof Response && error.status === 403,
  );
  const approvalWorkspace = loadedWorkspace();
  approvalWorkspace.document.revision.status = "reviewed";
  const approved = await handleWorkspaceMutation({
    client,
    projectId: ids.project,
    capability: "approver",
    workspace: approvalWorkspace,
    form: decisionForm("approved"),
  });
  assert.equal(approved.status, 200);
  assert.deepEqual(calls, [
    ["lukas_drawing_record_revision_decision", "reviewed"],
    ["lukas_drawing_record_revision_decision", "approved"],
  ]);
});

test("trusted staff context is admin without membership while viewer and outsider stay constrained", async () => {
  const staffClient = queryClient({});
  assert.equal(
    await loadDrawingWorkspaceCapability(
      staffClient,
      ids.project,
      ids.actor,
      ids.document,
      "staff",
    ),
    "admin",
  );
  assert.equal(staffClient.calls.length, 0);

  const viewerClient = queryClient({
    lukas_qto_project_members: { data: { role: "viewer" }, error: null },
  });
  assert.equal(
    await loadDrawingWorkspaceCapability(
      viewerClient,
      ids.project,
      ids.actor,
      ids.document,
      "viewer",
    ),
    "viewer",
  );

  const outsiderClient = queryClient({
    lukas_qto_project_members: { data: null, error: null },
  });
  assert.equal(
    await loadDrawingWorkspaceCapability(
      outsiderClient,
      ids.project,
      ids.actor,
      ids.document,
      null,
    ),
    null,
  );

  await assert.rejects(
    () =>
      handleWorkspaceMutation({
        client: { async rpc() {} },
        projectId: ids.project,
        capability: "viewer",
        workspace: { ...loadedWorkspace(), document: null },
        form: form({
          intent: "create_document",
          title: "A-101",
          document_mode: "blank",
        }),
      }),
    (error) => error instanceof Response && error.status === 403,
  );
});

function loadedWorkspace(revisionId = ids.revision) {
  return {
    primarySource: {
      id: ids.file,
      project_id: ids.project,
      kind: "pdf",
      original_filename: "A-101.pdf",
      storage_path: "projects/source.pdf",
      content_type: "application/pdf",
      byte_size: 1234,
      sha256: sourceSha,
      immutable: true,
      created_at: "2026-08-24T00:00:00.000Z",
    },
    document: {
      id: ids.document,
      project_id: ids.project,
      source_file_id: ids.file,
      source_sha256: sourceSha,
      title: "A-101",
      created_by: ids.actor,
      created_at: "2026-08-24T00:00:00.000Z",
      updated_at: "2026-08-24T00:00:00.000Z",
      revision: {
        id: revisionId,
        document_id: ids.document,
        project_id: ids.project,
        parent_revision_id: null,
        sequence: 1,
        status: "draft",
        version: 1,
        created_by: ids.actor,
        review_requested_at: null,
        approved_at: null,
        created_at: "2026-08-24T00:00:00.000Z",
        updated_at: "2026-08-24T00:00:00.000Z",
        pages: [],
        layers: [],
        objects: [],
        reviewEvidence: null,
      },
    },
  };
}

test("apply action echoes the server-validated client operation id for exact outbox acknowledgement", async () => {
  const input = operation();
  const result = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: {
            operationId: "00000000-0000-4000-8000-000000000011",
            sequence: 1,
            resultVersions: { [ids.object]: 1 },
          },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace: loadedWorkspace(),
    form: form({ intent: "apply_operation", operation_json: input }),
  });

  assert.deepEqual(result, {
    status: 200,
    body: {
      ok: true,
      kind: "success",
      error: null,
      clientOperationId: input.clientOperationId,
      result: {
        operationId: "00000000-0000-4000-8000-000000000011",
        sequence: 1,
        resultVersions: { [ids.object]: 1 },
      },
    },
  });
});

test("action contract returns 409 for stale revision and pre-existing document preconditions", async () => {
  let rpcCalls = 0;
  const client = {
    async rpc() {
      rpcCalls += 1;
      return { data: {}, error: null };
    },
  };
  const stale = operation({
    revisionId: "00000000-0000-4000-8000-000000000099",
  });
  assert.deepEqual(
    await handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability: "editor",
      workspace: loadedWorkspace(),
      form: form({ intent: "apply_operation", operation_json: stale }),
    }),
    {
      status: 409,
      body: {
        ok: false,
        kind: "conflict",
        error: "현재 파일의 도면 리비전과 요청이 일치하지 않습니다.",
      },
    },
  );
  assert.deepEqual(
    await handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability: "editor",
      workspace: loadedWorkspace(),
      form: form({
        intent: "create_document",
        title: "A-101",
        document_mode: "blank",
      }),
    }),
    {
      status: 409,
      body: {
        ok: false,
        kind: "conflict",
        error: "이 파일에는 이미 도면 문서가 있습니다.",
      },
    },
  );
  assert.equal(rpcCalls, 0);
});

test("action contract maps stable database conflict codes to 409 and validation failures to 400", async () => {
  const raceClient = {
    async rpc() {
      return {
        data: null,
        error: { code: "23505", message: "duplicate key value" },
      };
    },
  };
  assert.deepEqual(
    await handleWorkspaceMutation({
      client: raceClient,
      projectId: ids.project,
      capability: "editor",
      workspace: { ...loadedWorkspace(), document: null },
      form: form({
        intent: "create_document",
        title: "A-101",
        document_mode: "blank",
      }),
    }),
    {
      status: 409,
      body: {
        ok: false,
        kind: "conflict",
        error: "duplicate key value",
      },
    },
  );

  const validation = await handleWorkspaceMutation({
    client: raceClient,
    projectId: ids.project,
    capability: "editor",
    workspace: { ...loadedWorkspace(), document: null },
    form: form({ intent: "unknown" }),
  });
  assert.equal(validation.status, 400);
  assert.equal(validation.body.kind, "validation");

  const rpcFailure = await handleWorkspaceMutation({
    client: {
      async rpc() {
        return {
          data: null,
          error: { code: "P0001", message: "RPC precondition failed" },
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace: { ...loadedWorkspace(), document: null },
    form: form({
      intent: "create_document",
      title: "A-101",
      document_mode: "blank",
    }),
  });
  assert.equal(rpcFailure.status, 400);
  assert.equal(rpcFailure.body.kind, "rpc");
});

test("issue linking uses the narrow RPC and returns its authoritative link", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          id: ids.link,
          objectId: ids.object,
          issueId: ids.issue,
          createdBy: ids.actor,
          createdAt: "2026-08-24T03:00:00.000Z",
        },
        error: null,
      };
    },
  };
  const result = await linkDrawingObjectIssue(client, ids.object, ids.issue);
  assert.deepEqual(calls, [
    [
      "lukas_drawing_link_object_issue",
      { p_object_id: ids.object, p_issue_id: ids.issue },
    ],
  ]);
  assert.equal(result.id, ids.link);
});

test("issue-link action permits only editors on the current draft", async () => {
  let rpcCalls = 0;
  const client = {
    async rpc() {
      rpcCalls += 1;
      return {
        data: {
          id: ids.link,
          objectId: ids.object,
          issueId: ids.issue,
          createdBy: ids.actor,
          createdAt: "2026-08-24T03:00:00.000Z",
        },
        error: null,
      };
    },
  };
  const linkForm = form({
    intent: "link_issue",
    object_id: ids.object,
    issue_id: ids.issue,
  });
  const currentWorkspace = () => {
    const workspace = loadedWorkspace();
    workspace.document.revision.objects = [{ id: ids.object }];
    workspace.document.revision.issues = [{ id: ids.issue }];
    workspace.document.revision.issueLinks = [];
    return workspace;
  };
  for (const capability of ["admin", "editor"]) {
    const response = await handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability,
      workspace: currentWorkspace(),
      form: linkForm,
    });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  }
  for (const capability of ["viewer", "commenter", "reviewer"]) {
    await assert.rejects(
      handleWorkspaceMutation({
        client,
        projectId: ids.project,
        capability,
        workspace: currentWorkspace(),
        form: linkForm,
      }),
      (error) => error instanceof Response && error.status === 403,
    );
  }
  for (const status of ["review_requested", "approved"]) {
    const workspace = currentWorkspace();
    workspace.document.revision.status = status;
    const response = await handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability: "editor",
      workspace,
      form: linkForm,
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.kind, "conflict");
  }
  assert.equal(rpcCalls, 2);
});

test("issue-link action delegates same-session saved object identity to the authoritative RPC", async () => {
  let linkedObjectId = null;
  const workspace = loadedWorkspace();
  workspace.document.revision.objects = [];
  workspace.document.revision.issues = [{ id: ids.issue }];
  const response = await handleWorkspaceMutation({
    client: {
      async rpc(name, args) {
        assert.equal(name, "lukas_drawing_link_object_issue");
        linkedObjectId = args.p_object_id;
        return {
          data: {
            id: ids.link,
            objectId: ids.object,
            issueId: ids.issue,
            createdBy: ids.actor,
            createdAt: "2026-08-24T03:00:00.000Z",
          },
          error: null,
        };
      },
    },
    projectId: ids.project,
    capability: "editor",
    workspace,
    form: form({
      intent: "link_issue",
      object_id: ids.object,
      issue_id: ids.issue,
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(linkedObjectId, ids.object);
});

test("source-free workspace issue linking keeps editor authority and denies viewer object operations", async () => {
  const workspace = loadedWorkspace();
  workspace.primarySource = null;
  workspace.document.source_file_id = null;
  workspace.document.source_sha256 = null;
  workspace.document.revision.objects = [{ id: ids.object }];
  workspace.document.revision.issues = [{ id: ids.issue }];
  workspace.document.revision.issueLinks = [];
  let rpcCalls = 0;
  const client = {
    async rpc(name) {
      rpcCalls += 1;
      assert.equal(name, "lukas_drawing_link_object_issue");
      return {
        data: {
          id: ids.link,
          objectId: ids.object,
          issueId: ids.issue,
          createdBy: ids.actor,
          createdAt: "2026-08-31T00:00:00.000Z",
        },
        error: null,
      };
    },
  };
  const linked = await handleWorkspaceMutation({
    client,
    projectId: ids.project,
    capability: "editor",
    workspace,
    form: form({
      intent: "link_issue",
      object_id: ids.object,
      issue_id: ids.issue,
    }),
  });
  assert.equal(linked.status, 200);

  await assert.rejects(
    handleWorkspaceMutation({
      client,
      projectId: ids.project,
      capability: "viewer",
      workspace,
      form: form({ intent: "apply_operation", operation_json: operation() }),
    }),
    (error) => error instanceof Response && error.status === 403,
  );
  assert.equal(rpcCalls, 1);
});
