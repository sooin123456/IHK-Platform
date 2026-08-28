import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  IfcDerivativeManifestSchema,
  loadDrawingIfcDerivative,
  publishManagedIfcDerivativeObject,
  validateManagedIfcDerivativePair,
} from "../app/lukas/lib/drawing-workspace.server.ts";

const ids = {
  actor: "20000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000002",
  source: "20000000-0000-4000-8000-000000000003",
  revision: "20000000-0000-4000-8000-000000000004",
  derivative1: "20000000-0000-4000-8000-000000000005",
  derivative2: "20000000-0000-4000-8000-000000000006",
};
const sourceSha = "a".repeat(64);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function glb(json, binary = null) {
  const source = new TextEncoder().encode(JSON.stringify(json));
  const padded = Math.ceil(source.byteLength / 4) * 4;
  const binaryPadded = binary ? Math.ceil(binary.byteLength / 4) * 4 : 0;
  const bytes = new Uint8Array(
    12 + 8 + padded + (binary ? 8 + binaryPadded : 0),
  );
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(source, 20);
  bytes.fill(0x20, 20 + source.byteLength);
  if (binary) {
    const binaryOffset = 20 + padded;
    view.setUint32(binaryOffset, binaryPadded, true);
    view.setUint32(binaryOffset + 4, 0x004e4942, true);
    bytes.set(binary, binaryOffset + 8);
  }
  return bytes;
}

function validGeometryGlb(overrides = {}) {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const binary = new Uint8Array(positions.buffer);
  const document = {
    asset: { version: "2.0" },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: binary.byteLength }],
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
    ...overrides,
  };
  return glb(document, binary);
}

function withManifestElements(selected, elements) {
  const manifest = { ...selected.row.manifest_json, elements };
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  const manifestSha256 = sha256(manifestBytes);
  const prefix = selected.row.manifest_storage_path.slice(
    0,
    selected.row.manifest_storage_path.lastIndexOf("/"),
  );
  return {
    ...selected,
    row: {
      ...selected.row,
      manifest_json: manifest,
      manifest_storage_path: `${prefix}/${manifestSha256}.json`,
      manifest_byte_size: manifestBytes.byteLength,
      manifest_sha256: manifestSha256,
    },
    manifestBytes,
  };
}

test("manifest mesh identity is the global node and primitive tuple", () => {
  const selected = artifact(1);
  const first = selected.row.manifest_json.elements[0];
  const disjoint = {
    ...first,
    expressId: 43,
    globalId: "1VNYAWfXv8JvIRVfOzYH1j",
    meshes: [{ nodeId: "ifc-42", primitiveIndices: [1] }],
  };
  assert.doesNotThrow(() =>
    IfcDerivativeManifestSchema.parse({
      ...selected.row.manifest_json,
      elements: [first, disjoint],
    }),
  );
  assert.throws(
    () =>
      IfcDerivativeManifestSchema.parse({
        ...selected.row.manifest_json,
        elements: [
          first,
          {
            ...disjoint,
            meshes: [{ nodeId: "ifc-42", primitiveIndices: [0] }],
          },
        ],
      }),
    /nodeId and primitiveIndex tuple/i,
  );
});

function artifact(version, options = {}) {
  const geometryBytes = options.geometryBytes ?? validGeometryGlb();
  const geometrySha256 = sha256(geometryBytes);
  const manifest = {
    schemaVersion: 1,
    source: { fileId: ids.source, sha256: sourceSha },
    geometry: { sha256: geometrySha256 },
    elements: [
      {
        expressId: 42,
        globalId: "0VNYAWfXv8JvIRVfOzYH1j",
        typeName: "IFCWALL",
        name: "Wall",
        meshes: [{ nodeId: "ifc-42", primitiveIndices: [0] }],
        properties: [{ group: "Identity", name: "FireRating", value: "2h" }],
      },
    ],
  };
  const manifestBytes = new TextEncoder().encode(canonicalJson(manifest));
  const manifestSha256 = sha256(manifestBytes);
  const prefix = `projects/${ids.project}/ifc-derivatives/${sourceSha}/v${version}`;
  return {
    row: {
      id: `20000000-0000-4000-8000-${String(version + 4).padStart(12, "0")}`,
      project_id: ids.project,
      source_file_id: ids.source,
      source_sha256: sourceSha,
      version,
      schema_version: 1,
      status: "ready",
      manifest_json: manifest,
      manifest_storage_path: `${prefix}/${manifestSha256}.json`,
      manifest_byte_size: manifestBytes.byteLength,
      manifest_sha256: manifestSha256,
      geometry_storage_path: `${prefix}/${geometrySha256}.glb`,
      geometry_byte_size: geometryBytes.byteLength,
      geometry_sha256: geometrySha256,
    },
    manifestBytes,
    geometryBytes,
  };
}

const file = {
  id: ids.source,
  project_id: ids.project,
  kind: "ifc",
  original_filename: "model.ifc",
  storage_path: "projects/model.ifc",
  content_type: "application/x-step",
  byte_size: 1,
  sha256: sourceSha,
  immutable: true,
  created_at: "2026-08-28T00:00:00Z",
};

function clientFor({ derivatives, bindings = [], objects = {} }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(["fetch", url, init]);
    const path = String(url).replace("https://storage.test/internal/", "");
    const bytes = objects[path];
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(bytes, {
      status: 206,
      headers: {
        "content-length": String(bytes.byteLength),
        "content-range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
      },
    });
  };
  return {
    calls,
    fetchImpl,
    from(table) {
      const filters = [];
      let descending = false;
      const builder = {
        select() {
          return builder;
        },
        eq(column, value) {
          filters.push([column, value]);
          return builder;
        },
        order(_column, options) {
          descending = options?.ascending === false;
          return builder;
        },
        limit(count) {
          const source =
            table === "lukas_drawing_revision_ifc_derivatives"
              ? bindings
              : derivatives;
          const data = source
            .filter((row) =>
              filters.every(([column, value]) => row[column] === value),
            )
            .sort((left, right) =>
              descending
                ? right.version - left.version
                : left.version - right.version,
            )
            .slice(0, count);
          return Promise.resolve({ data, error: null });
        },
      };
      return builder;
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "lukas-qto");
        return {
          async download(path) {
            calls.push(["download", path]);
            const bytes = objects[path];
            return bytes
              ? { data: new Blob([bytes]), error: null }
              : { data: null, error: new Error("missing") };
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
}

function objectsFor(...artifacts) {
  return Object.fromEntries(
    artifacts.flatMap(({ row, manifestBytes, geometryBytes }) => [
      [row.manifest_storage_path, manifestBytes],
      [row.geometry_storage_path, geometryBytes],
    ]),
  );
}

test("an approved revision keeps its pin and signs ready artifacts without a storage read", async () => {
  const first = artifact(1);
  const laterReady = artifact(4);
  const pending = {
    ...laterReady.row,
    id: ids.derivative2,
    version: 2,
    status: "pending",
    manifest_json: null,
    manifest_storage_path: null,
    manifest_byte_size: null,
    manifest_sha256: null,
    geometry_storage_path: null,
    geometry_byte_size: null,
    geometry_sha256: null,
  };
  const failed = {
    ...pending,
    id: "20000000-0000-4000-8000-000000000007",
    version: 3,
    status: "failed",
  };
  const binding = {
    revision_id: ids.revision,
    revision_version: 7,
    project_id: ids.project,
    source_file_id: ids.source,
    source_sha256: sourceSha,
    derivative_id: first.row.id,
    derivative_version: 1,
    manifest_sha256: first.row.manifest_sha256,
    geometry_sha256: first.row.geometry_sha256,
    version: 1,
  };
  const client = clientFor({
    derivatives: [first.row, pending, failed, laterReady.row],
    bindings: [binding],
    objects: objectsFor(first, laterReady),
  });
  const loaded = await loadDrawingIfcDerivative(
    client,
    file,
    { id: ids.revision, status: "approved", version: 7 },
    { fetch: client.fetchImpl },
  );
  assert.equal(loaded.version, 1);
  assert.equal(loaded.manifestSha256, first.row.manifest_sha256);
  assert.equal(loaded.manifestByteSize, first.row.manifest_byte_size);
  assert.equal(loaded.geometryByteSize, first.row.geometry_byte_size);
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "fetch"),
    [],
  );
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [
      ["sign", first.row.manifest_storage_path, 300],
      ["sign", first.row.geometry_storage_path, 300],
    ],
  );
});

test("the ready route fails closed on tampered content-addressed metadata before signing", async () => {
  const valid = artifact(1);
  for (const row of [
    {
      ...valid.row,
      geometry_storage_path: `projects/${ids.project}/ifc-derivatives/${sourceSha}/v1/not-the-geometry.glb`,
    },
    { ...valid.row, geometry_byte_size: 0 },
  ]) {
    const client = clientFor({
      derivatives: [row],
      objects: objectsFor(valid),
    });
    await assert.rejects(
      loadDrawingIfcDerivative(client, file, {
        id: ids.revision,
        status: "draft",
        version: 1,
      }),
      (error) => error instanceof Response && error.status === 409,
    );
    assert.deepEqual(client.calls, []);
  }
});

test("a protected revision without an exact derivative binding fails closed", async () => {
  const first = artifact(1);
  const client = clientFor({
    derivatives: [first.row],
    objects: objectsFor(first),
  });
  await assert.rejects(
    loadDrawingIfcDerivative(client, file, {
      id: ids.revision,
      status: "superseded",
      version: 7,
    }),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.deepEqual(client.calls, []);
});

test("a draft deterministically resolves the newest ready derivative", async () => {
  const first = artifact(1);
  const latest = artifact(4);
  const pending = {
    ...latest.row,
    id: "20000000-0000-4000-8000-000000000008",
    version: 5,
    status: "pending",
    manifest_json: null,
    manifest_storage_path: null,
    manifest_byte_size: null,
    manifest_sha256: null,
    geometry_storage_path: null,
    geometry_byte_size: null,
    geometry_sha256: null,
  };
  const client = clientFor({
    derivatives: [pending, first.row, latest.row],
    objects: objectsFor(first, latest),
  });
  const loaded = await loadDrawingIfcDerivative(
    client,
    file,
    { id: ids.revision, status: "draft", version: 7 },
    { fetch: client.fetchImpl },
  );
  assert.equal(loaded.version, 4);
  assert.equal(loaded.geometrySha256, latest.row.geometry_sha256);
});

test("a draft exposes the latest failed status when no ready derivative exists", async () => {
  const failed = {
    ...artifact(1).row,
    status: "failed",
    manifest_json: null,
    manifest_storage_path: null,
    manifest_byte_size: null,
    manifest_sha256: null,
    geometry_storage_path: null,
    geometry_byte_size: null,
    geometry_sha256: null,
  };
  const client = clientFor({ derivatives: [failed] });
  const loaded = await loadDrawingIfcDerivative(client, file, {
    id: ids.revision,
    status: "draft",
    version: 7,
  });
  assert.deepEqual(loaded, {
    status: "failed",
    version: 1,
    sourceSha256: sourceSha,
    manifestByteSize: null,
    geometryByteSize: null,
    manifestSha256: null,
    geometrySha256: null,
    manifestSignedUrl: null,
    geometrySignedUrl: null,
  });
});

test("GLB node identity requires canonical extras and every primitive claim", async (context) => {
  const base = artifact(1);
  const outOfRange = withManifestElements(base, [
    {
      ...base.row.manifest_json.elements[0],
      meshes: [{ nodeId: "ifc-42", primitiveIndices: [1] }],
    },
  ]);
  const cases = [
    [
      "node name is not an identity fallback",
      artifact(1, {
        geometryBytes: validGeometryGlb({
          nodes: [{ name: "ifc-42", mesh: 0 }],
        }),
      }),
    ],
    [
      "mesh node extras reject non-canonical identity fields",
      artifact(1, {
        geometryBytes: validGeometryGlb({
          nodes: [
            {
              extras: { ifcNodeId: "ifc-42", ifcExpressId: 42, legacyId: 42 },
              mesh: 0,
            },
          ],
        }),
      }),
    ],
    ["manifest primitive index must be in range", outOfRange],
    [
      "an unclaimed rendered primitive is rejected",
      artifact(1, {
        geometryBytes: validGeometryGlb({
          meshes: [
            {
              primitives: [
                { attributes: { POSITION: 0 } },
                { attributes: { POSITION: 0 } },
              ],
            },
          ],
        }),
      }),
    ],
  ];
  for (const [name, selected] of cases)
    await context.test(name, async () => {
      await assert.rejects(
        validateManagedIfcDerivativePair({
          sourceFileId: ids.source,
          sourceSha256: sourceSha,
          manifestBytes: selected.manifestBytes,
          geometryBytes: selected.geometryBytes,
        }),
        /managed publication failed/i,
      );
    });
});

test("GLB ifcExpressId matches the complete primitive ownership of a node", async (context) => {
  const primitives = [
    { attributes: { POSITION: 0 } },
    { attributes: { POSITION: 0 } },
  ];
  const first = artifact(1, {
    geometryBytes: validGeometryGlb({
      nodes: [{ extras: { ifcNodeId: "ifc-42" }, mesh: 0 }],
      meshes: [{ primitives }],
    }),
  });
  const original = first.row.manifest_json.elements[0];
  const mixedElements = [
    original,
    {
      ...original,
      expressId: 43,
      globalId: "1VNYAWfXv8JvIRVfOzYH1j",
      meshes: [{ nodeId: "ifc-42", primitiveIndices: [1] }],
    },
  ];
  const mixed = withManifestElements(first, mixedElements);
  await context.test("mixed node omits ifcExpressId", async () => {
    await assert.doesNotReject(
      validateManagedIfcDerivativePair({
        sourceFileId: ids.source,
        sourceSha256: sourceSha,
        manifestBytes: mixed.manifestBytes,
        geometryBytes: mixed.geometryBytes,
      }),
    );
  });
  await context.test("mixed node cannot claim one ifcExpressId", async () => {
    const selected = artifact(1, {
      geometryBytes: validGeometryGlb({
        nodes: [
          {
            extras: { ifcNodeId: "ifc-42", ifcExpressId: 42 },
            mesh: 0,
          },
        ],
        meshes: [{ primitives }],
      }),
    });
    const invalid = withManifestElements(selected, mixedElements);
    await assert.rejects(
      validateManagedIfcDerivativePair({
        sourceFileId: ids.source,
        sourceSha256: sourceSha,
        manifestBytes: invalid.manifestBytes,
        geometryBytes: invalid.geometryBytes,
      }),
      /managed publication failed/i,
    );
  });
  await context.test("single owner ifcExpressId must match", async () => {
    const selected = artifact(1, {
      geometryBytes: validGeometryGlb({
        nodes: [
          {
            extras: { ifcNodeId: "ifc-42", ifcExpressId: 99 },
            mesh: 0,
          },
        ],
      }),
    });
    await assert.rejects(
      validateManagedIfcDerivativePair({
        sourceFileId: ids.source,
        sourceSha256: sourceSha,
        manifestBytes: selected.manifestBytes,
        geometryBytes: selected.geometryBytes,
      }),
      /managed publication failed/i,
    );
  });
});

test("managed publication verifies canonical manifests and official GLB errors", async (context) => {
  const valid = artifact(1);
  const corrupt = artifact(1, { geometryBytes: new Uint8Array([1, 2, 3, 4]) });
  const external = artifact(1, {
    geometryBytes: glb({
      asset: { version: "2.0" },
      buffers: [{ byteLength: 4, uri: "https://evil.test/a.bin" }],
      nodes: [{ name: "ifc-42", mesh: 0 }],
      meshes: [{ primitives: [{}] }],
    }),
  });
  const missingAttributes = artifact(1, {
    geometryBytes: glb({
      asset: { version: "2.0" },
      nodes: [{ name: "ifc-42", mesh: 0 }],
      meshes: [{ primitives: [{}] }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    }),
  });
  const invalidAccessorReference = artifact(1, {
    geometryBytes: validGeometryGlb({
      accessors: [
        {
          bufferView: 99,
          componentType: 5126,
          count: 3,
          type: "VEC3",
        },
      ],
    }),
  });
  const invalidNodeReference = artifact(1, {
    geometryBytes: validGeometryGlb({
      nodes: [{ name: "ifc-42", mesh: 99 }],
    }),
  });
  const invalidChunkBytes = validGeometryGlb();
  new DataView(invalidChunkBytes.buffer).setUint32(12, 0xfffffffc, true);
  const invalidChunk = artifact(1, { geometryBytes: invalidChunkBytes });
  const informationalFloodNodes = Array.from({ length: 300 }, (_, index) => ({
    name: `unused-${index}`,
  }));
  const truncatedReport = artifact(1, {
    geometryBytes: validGeometryGlb({
      nodes: [...informationalFloodNodes, { name: "ifc-42", mesh: 0 }],
      scenes: [{ nodes: [300] }],
    }),
  });
  const truncatedBeforeInvalidAccessor = artifact(1, {
    geometryBytes: validGeometryGlb({
      nodes: [...informationalFloodNodes, { name: "ifc-42", mesh: 0 }],
      accessors: [
        {
          bufferView: 99,
          componentType: 5126,
          count: 3,
          type: "VEC3",
        },
      ],
      scenes: [{ nodes: [300] }],
    }),
  });
  const cases = [
    [
      "substituted manifest",
      new TextEncoder().encode("{}"),
      valid.geometryBytes,
    ],
    ["corrupt GLB", corrupt.manifestBytes, corrupt.geometryBytes],
    ["external GLB URI", external.manifestBytes, external.geometryBytes],
    [
      "primitive missing attributes",
      missingAttributes.manifestBytes,
      missingAttributes.geometryBytes,
    ],
    [
      "invalid accessor reference",
      invalidAccessorReference.manifestBytes,
      invalidAccessorReference.geometryBytes,
    ],
    [
      "invalid node reference",
      invalidNodeReference.manifestBytes,
      invalidNodeReference.geometryBytes,
    ],
    [
      "invalid chunk length",
      invalidChunk.manifestBytes,
      invalidChunk.geometryBytes,
    ],
    [
      "truncated informational report",
      truncatedReport.manifestBytes,
      truncatedReport.geometryBytes,
    ],
    [
      "truncated report before invalid accessor",
      truncatedBeforeInvalidAccessor.manifestBytes,
      truncatedBeforeInvalidAccessor.geometryBytes,
    ],
  ];
  for (const [name, manifestBytes, geometryBytes] of cases) {
    await context.test(name, async () => {
      await assert.rejects(
        validateManagedIfcDerivativePair({
          sourceFileId: ids.source,
          sourceSha256: sourceSha,
          manifestBytes,
          geometryBytes,
        }),
        /managed publication failed/i,
      );
    });
  }
});

test("managed publication rejects noncanonical manifest bytes before ready transition", async () => {
  const valid = artifact(1);
  await assert.rejects(
    validateManagedIfcDerivativePair({
      sourceFileId: ids.source,
      sourceSha256: sourceSha,
      manifestBytes: new Uint8Array([...valid.manifestBytes, 0x20]),
      geometryBytes: valid.geometryBytes,
    }),
    /managed publication failed/i,
  );
});

test("the loader refuses oversized artifact metadata before download", async () => {
  const valid = artifact(1);
  const row = { ...valid.row, geometry_byte_size: 200 * 1024 * 1024 + 1 };
  const client = clientFor({ derivatives: [row], objects: objectsFor(valid) });
  await assert.rejects(
    loadDrawingIfcDerivative(client, file, {
      id: ids.revision,
      status: "draft",
      version: 1,
    }),
    (error) => error instanceof Response && error.status === 409,
  );
  assert.deepEqual(client.calls, []);
});

test("managed ingestion publishes a content-addressed object without replacement", async () => {
  const bytes = new TextEncoder().encode("immutable derivative");
  const expectedSha = sha256(bytes);
  const calls = [];
  const storage = {
    from(bucket) {
      assert.equal(bucket, "lukas-qto");
      return {
        async upload(path, body, options) {
          calls.push({ path, body: new Uint8Array(body), options });
          return { data: { path }, error: null };
        },
        async createSignedUrl(path, ttl) {
          assert.equal(ttl, 30);
          return {
            data: { signedUrl: `https://storage.test/internal/${path}` },
            error: null,
          };
        },
      };
    },
  };
  const result = await publishManagedIfcDerivativeObject(
    storage,
    {
      projectId: ids.project,
      sourceSha256: sourceSha,
      version: 3,
      bytes,
      extension: "glb",
      contentType: "model/gltf-binary",
    },
    {
      fetch: async () =>
        new Response(bytes, {
          status: 206,
          headers: {
            "content-length": String(bytes.byteLength),
            "content-range": `bytes 0-${bytes.byteLength - 1}/${bytes.byteLength}`,
          },
        }),
    },
  );
  assert.deepEqual(result, {
    path: `projects/${ids.project}/ifc-derivatives/${sourceSha}/v3/${expectedSha}.glb`,
    byteSize: bytes.byteLength,
    sha256: expectedSha,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.upsert, false);
  assert.equal(calls[0].options.contentType, "model/gltf-binary");
  assert.deepEqual(calls[0].body, bytes);
});

test("managed ingestion reconciles a response-lost retry only from exact stored bytes", async () => {
  const bytes = new TextEncoder().encode("immutable retry");
  const expectedSha = sha256(bytes);
  const path = `projects/${ids.project}/ifc-derivatives/${sourceSha}/v4/${expectedSha}.json`;
  const objects = new Map();
  const storage = {
    from() {
      return {
        async upload(uploadPath, body, options) {
          assert.equal(options.upsert, false);
          objects.set(uploadPath, new Uint8Array(body));
          return { data: null, error: new Error("response lost") };
        },
        async createSignedUrl(signedPath, ttl) {
          assert.equal(ttl, 30);
          return {
            data: { signedUrl: `https://storage.test/internal/${signedPath}` },
            error: null,
          };
        },
      };
    },
  };
  const fetchImpl = async (url) => {
    const stored = objects.get(
      String(url).replace("https://storage.test/internal/", ""),
    );
    assert.ok(stored);
    return new Response(stored, {
      status: 206,
      headers: {
        "content-length": String(stored.byteLength),
        "content-range": `bytes 0-${stored.byteLength - 1}/${stored.byteLength}`,
      },
    });
  };
  assert.deepEqual(
    await publishManagedIfcDerivativeObject(
      storage,
      {
        projectId: ids.project,
        sourceSha256: sourceSha,
        version: 4,
        bytes,
        extension: "json",
        contentType: "application/json",
      },
      { fetch: fetchImpl },
    ),
    { path, byteSize: bytes.byteLength, sha256: expectedSha },
  );
});

test("managed ingestion rejects a conflict whose existing bytes do not match", async () => {
  const bytes = new TextEncoder().encode("expected bytes");
  const wrong = new TextEncoder().encode("wrong bytes---");
  const storage = {
    from() {
      return {
        async upload() {
          return { data: null, error: new Error("already exists") };
        },
        async createSignedUrl(path) {
          return {
            data: { signedUrl: `https://storage.test/internal/${path}` },
            error: null,
          };
        },
      };
    },
  };
  await assert.rejects(
    publishManagedIfcDerivativeObject(
      storage,
      {
        projectId: ids.project,
        sourceSha256: sourceSha,
        version: 5,
        bytes,
        extension: "glb",
        contentType: "model/gltf-binary",
      },
      {
        fetch: async () =>
          new Response(wrong, {
            status: 206,
            headers: {
              "content-length": String(wrong.byteLength),
              "content-range": `bytes 0-${wrong.byteLength - 1}/${wrong.byteLength}`,
            },
          }),
      },
    ),
    /publication failed/i,
  );
});

test("pair publication validates before attempting either artifact upload", async () => {
  const { publishManagedIfcDerivativePair } = await import(
    "../app/lukas/lib/drawing-workspace.server.ts"
  );
  let uploads = 0;
  const storage = {
    from() {
      return {
        async upload() {
          uploads += 1;
          return { data: { path: "unexpected" }, error: null };
        },
        async createSignedUrl() {
          return {
            data: { signedUrl: "https://storage.test/unexpected" },
            error: null,
          };
        },
      };
    },
  };
  await assert.rejects(
    publishManagedIfcDerivativePair(storage, {
      projectId: ids.project,
      sourceFileId: ids.source,
      sourceSha256: sourceSha,
      version: 6,
      manifestBytes: new TextEncoder().encode("{}"),
      geometryBytes: new Uint8Array([1, 2, 3, 4]),
    }),
    /managed publication failed/i,
  );
  assert.equal(uploads, 0);
});

test("managed ready publication writes the exact verified upload result through one writer", async () => {
  const { publishManagedIfcDerivativeReady } = await import(
    "../app/lukas/lib/drawing-workspace.server.ts"
  );
  assert.equal(typeof publishManagedIfcDerivativeReady, "function");
  const verified = artifact(8);
  const objects = new Map();
  const storage = {
    from() {
      return {
        async upload(path, body) {
          objects.set(path, new Uint8Array(body));
          return { data: { path }, error: null };
        },
        async createSignedUrl(path) {
          return {
            data: { signedUrl: `https://storage.test/internal/${path}` },
            error: null,
          };
        },
      };
    },
  };
  const recorded = [];
  const result = await publishManagedIfcDerivativeReady(
    storage,
    {
      async recordReady(input) {
        recorded.push(input);
        return { id: ids.derivative1 };
      },
    },
    {
      projectId: ids.project,
      sourceFileId: ids.source,
      sourceSha256: sourceSha,
      version: 8,
      createdBy: ids.actor,
      manifestBytes: verified.manifestBytes,
      geometryBytes: verified.geometryBytes,
    },
    {
      fetch: async (url) => {
        const bytes = objects.get(
          String(url).replace("https://storage.test/internal/", ""),
        );
        assert.ok(bytes);
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
  assert.equal(result.id, ids.derivative1);
  assert.deepEqual(recorded, [
    {
      projectId: ids.project,
      sourceFileId: ids.source,
      sourceSha256: sourceSha,
      version: 8,
      createdBy: ids.actor,
      manifestJson: verified.row.manifest_json,
      manifestStoragePath: verified.row.manifest_storage_path,
      manifestByteSize: verified.row.manifest_byte_size,
      manifestSha256: verified.row.manifest_sha256,
      geometryStoragePath: verified.row.geometry_storage_path,
      geometryByteSize: verified.row.geometry_byte_size,
      geometrySha256: verified.row.geometry_sha256,
    },
  ]);
});

test("managed ready RPC writer accepts only the exact ready publication contract", async () => {
  const { createManagedIfcDerivativeReadyWriter } = await import(
    "../app/lukas/lib/drawing-workspace.server.ts"
  );
  assert.equal(typeof createManagedIfcDerivativeReadyWriter, "function");
  const calls = [];
  const writer = createManagedIfcDerivativeReadyWriter({
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: ids.derivative1, error: null };
    },
  });
  const id = await writer.recordReady({
    projectId: ids.project,
    sourceFileId: ids.source,
    sourceSha256: sourceSha,
    version: 8,
    createdBy: ids.actor,
    manifestJson: artifact(8).row.manifest_json,
    manifestStoragePath: `projects/${ids.project}/ifc-derivatives/${sourceSha}/v8/${"a".repeat(64)}.json`,
    manifestByteSize: 256,
    manifestSha256: "a".repeat(64),
    geometryStoragePath: `projects/${ids.project}/ifc-derivatives/${sourceSha}/v8/${"b".repeat(64)}.glb`,
    geometryByteSize: 128,
    geometrySha256: "b".repeat(64),
  });
  assert.deepEqual(id, { id: ids.derivative1 });
  assert.deepEqual(calls, [
    {
      name: "lukas_drawing_publish_ifc_derivative_ready",
      args: {
        p_project_id: ids.project,
        p_source_file_id: ids.source,
        p_source_sha256: sourceSha,
        p_version: 8,
        p_manifest_json: artifact(8).row.manifest_json,
        p_manifest_storage_path: `projects/${ids.project}/ifc-derivatives/${sourceSha}/v8/${"a".repeat(64)}.json`,
        p_manifest_byte_size: 256,
        p_manifest_sha256: "a".repeat(64),
        p_geometry_storage_path: `projects/${ids.project}/ifc-derivatives/${sourceSha}/v8/${"b".repeat(64)}.glb`,
        p_geometry_byte_size: 128,
        p_geometry_sha256: "b".repeat(64),
        p_created_by: ids.actor,
      },
    },
  ]);
});

test("pair publication reconciles exact content-addressed artifacts", async () => {
  const { publishManagedIfcDerivativePair } = await import(
    "../app/lukas/lib/drawing-workspace.server.ts"
  );
  assert.equal(typeof publishManagedIfcDerivativePair, "function");
  const manifestBytes = new TextEncoder().encode('{"schemaVersion":1}');
  const geometryBytes = new TextEncoder().encode("verified glb bytes");
  const objects = new Map();
  const uploads = [];
  const storage = {
    from() {
      return {
        async upload(path, body, options) {
          uploads.push({ path, options });
          if (objects.has(path))
            return { data: null, error: new Error("already exists") };
          objects.set(path, new Uint8Array(body));
          return { data: { path }, error: null };
        },
        async createSignedUrl(path) {
          return {
            data: { signedUrl: `https://storage.test/internal/${path}` },
            error: null,
          };
        },
      };
    },
  };
  const fetchImpl = async (url) => {
    const stored = objects.get(
      String(url).replace("https://storage.test/internal/", ""),
    );
    assert.ok(stored);
    return new Response(stored, {
      status: 206,
      headers: {
        "content-length": String(stored.byteLength),
        "content-range": `bytes 0-${stored.byteLength - 1}/${stored.byteLength}`,
      },
    });
  };
  const first = await publishManagedIfcDerivativePair(
    storage,
    {
      projectId: ids.project,
      sourceFileId: ids.source,
      sourceSha256: sourceSha,
      version: 6,
      manifestBytes: artifact(6).manifestBytes,
      geometryBytes: artifact(6).geometryBytes,
    },
    { fetch: fetchImpl },
  );
  const retry = await publishManagedIfcDerivativePair(
    storage,
    {
      projectId: ids.project,
      sourceFileId: ids.source,
      sourceSha256: sourceSha,
      version: 6,
      manifestBytes: artifact(6).manifestBytes,
      geometryBytes: artifact(6).geometryBytes,
    },
    { fetch: fetchImpl },
  );
  assert.deepEqual(retry, first);
  assert.equal(objects.size, 2);
  assert.equal(uploads.length, 4);
  assert.equal(
    uploads.every(({ options }) => options.upsert === false),
    true,
  );
});

test("pair publication retains an exact manifest orphan when a verified peer is corrupt", async () => {
  const { publishManagedIfcDerivativePair } = await import(
    "../app/lukas/lib/drawing-workspace.server.ts"
  );
  const verified = artifact(7);
  const manifestBytes = verified.manifestBytes;
  const geometryBytes = verified.geometryBytes;
  const geometryPath = verified.row.geometry_storage_path;
  const objects = new Map([
    [geometryPath, new TextEncoder().encode("corrupt geometry-")],
  ]);
  const storage = {
    from() {
      return {
        async upload(path, body) {
          if (objects.has(path))
            return { data: null, error: new Error("already exists") };
          objects.set(path, new Uint8Array(body));
          return { data: { path }, error: null };
        },
        async createSignedUrl(path) {
          return {
            data: { signedUrl: `https://storage.test/internal/${path}` },
            error: null,
          };
        },
      };
    },
  };
  const fetchImpl = async (url) => {
    const stored = objects.get(
      String(url).replace("https://storage.test/internal/", ""),
    );
    assert.ok(stored);
    return new Response(stored, {
      status: 206,
      headers: {
        "content-length": String(stored.byteLength),
        "content-range": `bytes 0-${stored.byteLength - 1}/${stored.byteLength}`,
      },
    });
  };
  await assert.rejects(
    publishManagedIfcDerivativePair(
      storage,
      {
        projectId: ids.project,
        sourceFileId: ids.source,
        sourceSha256: sourceSha,
        version: 7,
        manifestBytes,
        geometryBytes,
      },
      { fetch: fetchImpl },
    ),
    /publication failed/i,
  );
  assert.equal(objects.size, 2);
  assert.deepEqual(
    objects.get(geometryPath),
    new TextEncoder().encode("corrupt geometry-"),
  );
  assert.deepEqual(
    objects.get(verified.row.manifest_storage_path),
    manifestBytes,
  );
});
