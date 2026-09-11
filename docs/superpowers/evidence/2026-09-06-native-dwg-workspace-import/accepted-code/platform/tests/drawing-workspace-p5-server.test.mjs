import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import * as workspaceServer from "../app/lukas/lib/drawing-workspace.server.ts";
import { loadDrawingRevisionSources } from "../app/lukas/lib/drawing-workspace.server.ts";
import * as workspaceView from "../app/lukas/lib/drawing-workspace-view.ts";
import {
  p5DxfSource,
  p5Ids,
  p5IfcSource,
  p5PdfSource,
  p5SourceRow,
} from "./fixtures/drawing-workspace-p5-database-fixtures.mjs";

test("source loader returns exact active PDF, IFC, DXF, and native DWG payloads", async () => {
  const calls = [];
  const nativeSource = {
    id: "50000000-0000-4000-8000-000000000012",
    objectId: p5Ids.object,
    revisionId: p5Ids.revision,
    sourceFileId: "50000000-0000-4000-8000-000000000013",
    sourceSha256: "e".repeat(64),
    sourceKind: "dwg_entity",
    analysisJobId: "50000000-0000-4000-8000-000000000014",
    reportSha256: "f".repeat(64),
    handle: "4A",
    ownerHandle: "40",
    layerHandle: "48",
    entityType: "LINE",
    sourceLayer: "QA_GEOMETRY",
    unitCode: 4,
    unitSource: "declared",
    importerVersion: 1,
    version: 1,
  };
  const rows = [
    p5SourceRow(p5PdfSource),
    p5SourceRow(p5IfcSource),
    p5SourceRow(p5DxfSource),
    {
      ...p5SourceRow(p5PdfSource),
      id: nativeSource.id,
      source_file_id: nativeSource.sourceFileId,
      source_sha256: nativeSource.sourceSha256,
      source_kind: nativeSource.sourceKind,
      pdf_page_number: null,
      x: null,
      y: null,
      width: null,
      height: null,
      dwg_entity_json: {
        analysisJobId: nativeSource.analysisJobId,
        reportSha256: nativeSource.reportSha256,
        handle: nativeSource.handle,
        ownerHandle: nativeSource.ownerHandle,
        layerHandle: nativeSource.layerHandle,
        entityType: nativeSource.entityType,
        sourceLayer: nativeSource.sourceLayer,
        unitCode: nativeSource.unitCode,
        unitSource: nativeSource.unitSource,
        importerVersion: nativeSource.importerVersion,
      },
    },
  ];
  const client = {
    from(table) {
      calls.push(table);
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        gt() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: rows, error: null });
        },
      };
      return query;
    },
  };
  const result = await loadDrawingRevisionSources(
    client,
    p5Ids.project,
    p5Ids.revision,
  );
  assert.deepEqual(result, [
    p5PdfSource,
    p5IfcSource,
    p5DxfSource,
    nativeSource,
  ]);
  assert.deepEqual(calls, ["lukas_drawing_object_sources"]);
});

test("source loader rejects cross-revision evidence", async () => {
  const bad = { ...p5SourceRow(p5PdfSource), revision_id: p5Ids.project };
  const client = {
    from() {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        gt() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: [bad], error: null });
        },
      };
      return query;
    },
  };
  await assert.rejects(
    loadDrawingRevisionSources(client, p5Ids.project, p5Ids.revision),
    /source metadata is invalid/i,
  );
});

test("source loader rejects native payload attempts to shadow row identity", async () => {
  const row = {
    ...p5SourceRow(p5PdfSource),
    id: "50000000-0000-4000-8000-000000000012",
    source_file_id: "50000000-0000-4000-8000-000000000013",
    source_sha256: "e".repeat(64),
    source_kind: "dwg_entity",
    pdf_page_number: null,
    x: null,
    y: null,
    width: null,
    height: null,
    dwg_entity_json: {
      analysisJobId: "50000000-0000-4000-8000-000000000014",
      reportSha256: "f".repeat(64),
      handle: "4A",
      ownerHandle: "40",
      layerHandle: "48",
      entityType: "LINE",
      sourceLayer: "QA_GEOMETRY",
      unitCode: 4,
      unitSource: "declared",
      importerVersion: 1,
      sourceSha256: "a".repeat(64),
    },
  };
  const client = {
    from() {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        order() {
          return query;
        },
        gt() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: [row], error: null });
        },
      };
      return query;
    },
  };

  await assert.rejects(
    loadDrawingRevisionSources(client, p5Ids.project, p5Ids.revision),
    /source metadata is invalid/i,
  );
});

const sourceBundleIds = {
  primary: "10000000-0000-4000-8000-000000000001",
  ifc: "10000000-0000-4000-8000-000000000002",
  foreign: "10000000-0000-4000-8000-000000000003",
  previous: "10000000-0000-4000-8000-000000000004",
  edge: "10000000-0000-4000-8000-000000000005",
  dxf: "10000000-0000-4000-8000-000000000006",
  dwg: "10000000-0000-4000-8000-000000000007",
};

function workspaceFile(overrides = {}) {
  return {
    id: sourceBundleIds.primary,
    project_id: p5Ids.project,
    kind: "pdf",
    original_filename: "plan.pdf",
    storage_path: "projects/plan.pdf",
    content_type: "application/pdf",
    byte_size: 4096,
    sha256: "a".repeat(64),
    immutable: true,
    created_at: "2026-08-27T00:00:00.000Z",
    ...overrides,
  };
}

function sourceWorkspace(file = workspaceFile()) {
  return {
    primarySource: file,
    templateCandidates: [],
    document: {
      id: p5Ids.document,
      project_id: p5Ids.project,
      source_file_id: file.id,
      source_sha256: file.sha256,
      title: "P5",
      created_by: p5Ids.actor,
      created_at: "2026-08-27T00:00:00.000Z",
      updated_at: "2026-08-27T00:00:00.000Z",
      revision: {
        id: p5Ids.revision,
        document_id: p5Ids.document,
        project_id: p5Ids.project,
        parent_revision_id: null,
        sequence: 1,
        status: "draft",
        version: 1,
        created_by: p5Ids.actor,
        review_requested_at: null,
        approved_at: null,
        created_at: "2026-08-27T00:00:00.000Z",
        updated_at: "2026-08-27T00:00:00.000Z",
        pages: [
          {
            background_pdf_page: 1,
            background_source_file_id: file.id,
            background_source_sha256: file.sha256,
          },
        ],
        layers: [],
        objects: [],
        issues: [],
        issueLinks: [],
        reviewEvidence: null,
        checkpoints: [],
      },
    },
  };
}

function sourceFreeWorkspace() {
  const workspace = sourceWorkspace();
  return {
    ...workspace,
    primarySource: null,
    document: {
      ...workspace.document,
      source_file_id: null,
      source_sha256: null,
      revision: {
        ...workspace.document.revision,
        pages: [],
      },
    },
  };
}

function sourceBundleClient(rows, revisionEdges = [], options = {}) {
  const calls = [];
  return {
    calls,
    async rpc(name, args) {
      calls.push(["rpc", name, args]);
      assert.equal(name, "lukas_drawing_ifc_derivative_job_status");
      return {
        data: options.derivativeJobStatus ?? null,
        error: options.derivativeJobStatusError
          ? { message: "db down" }
          : null,
      };
    },
    from(table) {
      assert.ok(
        table === "lukas_qto_files" ||
          table === "lukas_qto_file_revisions" ||
          table === "lukas_drawing_ifc_derivatives" ||
          table === "lukas_drawing_revision_ifc_derivatives",
      );
      const query = {
        select(columns) {
          calls.push(["select", columns]);
          return query;
        },
        eq(column, value) {
          calls.push(["eq", column, value]);
          return query;
        },
        order(column) {
          calls.push(["order", column]);
          return query;
        },
        gt(column, value) {
          calls.push(["gt", column, value]);
          return query;
        },
        limit(size) {
          calls.push(["limit", size]);
          return Promise.resolve({
            data:
              table === "lukas_qto_file_revisions"
                ? revisionEdges
                : table === "lukas_drawing_revision_ifc_derivatives"
                  ? (options.bindings ?? [])
                  : table === "lukas_drawing_ifc_derivatives"
                    ? (options.derivatives ?? [])
                    : rows,
            error: table === options.errorTable ? { message: "db down" } : null,
          });
        },
      };
      return query;
    },
    storage: {
      from(bucket) {
        calls.push(["bucket", bucket]);
        return {
          async createSignedUrl(path, expiresIn) {
            calls.push(["sign", path, expiresIn]);
            if (options.signError || options.signErrorPaths?.includes(path))
              return { data: null, error: { message: "storage down" } };
            return {
              data: { signedUrl: `https://storage.test/${path}` },
              error: null,
            };
          },
        };
      },
    },
  };
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

function readyIfcDerivative(file) {
  const geometrySha = "e".repeat(64);
  const manifest = {
    schemaVersion: 1,
    source: { fileId: file.id, sha256: file.sha256 },
    geometry: { sha256: geometrySha },
    elements: [],
  };
  const serializedManifest = canonicalJson(manifest);
  const manifestSha = createHash("sha256")
    .update(serializedManifest)
    .digest("hex");
  const prefix = `projects/${file.project_id}/ifc-derivatives/${file.sha256}/v1`;
  return {
    id: "10000000-0000-4000-8000-000000000007",
    project_id: file.project_id,
    source_file_id: file.id,
    source_sha256: file.sha256,
    version: 1,
    schema_version: 1,
    status: "ready",
    manifest_json: manifest,
    manifest_storage_path: `${prefix}/${manifestSha}.json`,
    manifest_byte_size: new TextEncoder().encode(serializedManifest).byteLength,
    manifest_sha256: manifestSha,
    geometry_storage_path: `${prefix}/${geometrySha}.glb`,
    geometry_byte_size: 128,
    geometry_sha256: geometrySha,
  };
}

test("only signed source capability failures use the panel-local unavailable error", async () => {
  const primary = workspaceFile();
  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceSourceBundle(
      sourceBundleClient([primary], [], { signError: true }),
      sourceWorkspace(primary),
      null,
    ),
    (error) =>
      error instanceof workspaceServer.DrawingWorkspaceSourceUnavailableError,
  );
  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceSourceBundle(
      sourceBundleClient([primary], [], { errorTable: "lukas_qto_files" }),
      sourceWorkspace(primary),
      null,
    ),
    (error) =>
      error instanceof Error &&
      !(
        error instanceof workspaceServer.DrawingWorkspaceSourceUnavailableError
      ),
  );
});

test("failed PDF capability retains the authorized catalog and loaded IFC", async () => {
  const pdf = workspaceFile();
  const ifc = workspaceFile({
    id: sourceBundleIds.ifc,
    kind: "ifc",
    original_filename: "model.ifc",
    storage_path: "projects/model.ifc",
    content_type: "application/x-step",
    byte_size: 8192,
    sha256: "b".repeat(64),
  });
  const derivative = readyIfcDerivative(ifc);
  const client = sourceBundleClient([pdf, ifc], [], {
    derivatives: [derivative],
    signErrorPaths: [pdf.storage_path],
  });
  let failure;

  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceSourceBundle(
      client,
      sourceWorkspace(pdf),
      ifc.id,
    ),
    (error) => {
      failure = error;
      return (
        error instanceof workspaceServer.DrawingWorkspaceSourceUnavailableError
      );
    },
  );

  assert.equal(failure.recoveryBundle.pdf, null);
  assert.equal(failure.recoveryBundle.primary.id, pdf.id);
  assert.equal(failure.recoveryBundle.ifc.id, ifc.id);
  assert.deepEqual(
    failure.recoveryBundle.catalog.map((source) => source.id),
    [pdf.id, ifc.id],
  );
  assert.equal(JSON.stringify(failure).includes("storage.test"), false);
});

test("failed IFC capability retains the authorized catalog and loaded PDF", async () => {
  const pdf = workspaceFile();
  const ifc = workspaceFile({
    id: sourceBundleIds.ifc,
    kind: "ifc",
    original_filename: "model.ifc",
    storage_path: "projects/model.ifc",
    content_type: "application/x-step",
    byte_size: 8192,
    sha256: "b".repeat(64),
  });
  const derivative = readyIfcDerivative(ifc);
  const client = sourceBundleClient([pdf, ifc], [], {
    derivatives: [derivative],
    signErrorPaths: [derivative.geometry_storage_path],
  });
  let failure;

  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceSourceBundle(
      client,
      sourceWorkspace(pdf),
      ifc.id,
    ),
    (error) => {
      failure = error;
      return (
        error instanceof workspaceServer.DrawingWorkspaceSourceUnavailableError
      );
    },
  );

  assert.equal(failure.recoveryBundle.pdf.id, pdf.id);
  assert.equal(failure.recoveryBundle.primary.id, pdf.id);
  assert.equal(failure.recoveryBundle.ifc, null);
  assert.deepEqual(
    failure.recoveryBundle.catalog.map((source) => source.id),
    [pdf.id, ifc.id],
  );
});

test("PDF source bundle exposes exact predecessor metadata without signing it", async () => {
  const current = workspaceFile();
  const previous = workspaceFile({
    id: sourceBundleIds.previous,
    original_filename: "plan-r1.pdf",
    storage_path: "projects/plan-r1.pdf",
    byte_size: 3072,
    sha256: "c".repeat(64),
  });
  const edge = {
    id: sourceBundleIds.edge,
    project_id: p5Ids.project,
    previous_file_id: previous.id,
    previous_sha256: previous.sha256,
    current_file_id: current.id,
    current_sha256: current.sha256,
    relation_kind: "supersedes",
  };
  const client = sourceBundleClient([current, previous], [edge]);

  const bundle = await workspaceServer.loadDrawingWorkspaceSourceBundle(
    client,
    sourceWorkspace(current),
    null,
  );

  assert.deepEqual(bundle.previousPdf, {
    id: previous.id,
    kind: "pdf",
    originalFilename: "plan-r1.pdf",
    byteSize: 3072,
    sha256: "c".repeat(64),
  });
  assert.deepEqual(bundle.revisionEdge, {
    id: edge.id,
    previousFileId: previous.id,
    previousSha256: previous.sha256,
    currentFileId: current.id,
    currentSha256: current.sha256,
  });
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [["sign", "projects/plan.pdf", 300]],
  );
});

test("PDF compare opt-in signs exactly one revalidated predecessor capability", async () => {
  const current = workspaceFile();
  const previous = workspaceFile({
    id: sourceBundleIds.previous,
    original_filename: "plan-r1.pdf",
    storage_path: "projects/plan-r1.pdf",
    byte_size: 3072,
    sha256: "c".repeat(64),
  });
  const edge = {
    id: sourceBundleIds.edge,
    project_id: p5Ids.project,
    previous_file_id: previous.id,
    previous_sha256: previous.sha256,
    current_file_id: current.id,
    current_sha256: current.sha256,
    relation_kind: "supersedes",
  };
  const client = sourceBundleClient([current, previous], [edge]);

  const descriptor = await workspaceServer.loadDrawingWorkspacePreviousPdf(
    client,
    sourceWorkspace(current),
    {
      revisionEdgeId: edge.id,
      currentFileId: current.id,
      currentSha256: current.sha256,
      previousFileId: previous.id,
      previousSha256: previous.sha256,
      pageNumber: 1,
    },
  );

  assert.deepEqual(descriptor, {
    id: previous.id,
    kind: "pdf",
    originalFilename: "plan-r1.pdf",
    byteSize: 3072,
    sha256: "c".repeat(64),
    signedUrl: "https://storage.test/projects/plan-r1.pdf",
    derivative: {
      status: "not_applicable",
      version: null,
      sourceSha256: null,
      manifestByteSize: null,
      geometryByteSize: null,
      manifestSha256: null,
      geometrySha256: null,
      manifestSignedUrl: null,
      geometrySignedUrl: null,
    },
  });
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [["sign", "projects/plan-r1.pdf", 300]],
  );
});

test("PDF compare lazy signer rejects stale edge or inactive page before signing", async () => {
  const current = workspaceFile();
  const previous = workspaceFile({
    id: sourceBundleIds.previous,
    storage_path: "projects/plan-r1.pdf",
    sha256: "c".repeat(64),
  });
  const edge = {
    id: sourceBundleIds.edge,
    project_id: p5Ids.project,
    previous_file_id: previous.id,
    previous_sha256: previous.sha256,
    current_file_id: current.id,
    current_sha256: current.sha256,
    relation_kind: "supersedes",
  };
  for (const patch of [
    { revisionEdgeId: crypto.randomUUID() },
    { previousSha256: "d".repeat(64) },
    { pageNumber: 2 },
  ]) {
    const client = sourceBundleClient([current, previous], [edge]);
    await assert.rejects(
      workspaceServer.loadDrawingWorkspacePreviousPdf(
        client,
        sourceWorkspace(current),
        {
          revisionEdgeId: edge.id,
          currentFileId: current.id,
          currentSha256: current.sha256,
          previousFileId: previous.id,
          previousSha256: previous.sha256,
          pageNumber: 1,
          ...patch,
        },
      ),
    );
    assert.deepEqual(
      client.calls.filter(([kind]) => kind === "sign"),
      [],
    );
  }
});

test("PDF source bundle never guesses a predecessor without one exact supersedes edge", async () => {
  const current = workspaceFile();
  const unrelatedPdf = workspaceFile({
    id: sourceBundleIds.previous,
    original_filename: "similar-sheet.pdf",
    storage_path: "projects/similar-sheet.pdf",
    sha256: "c".repeat(64),
  });
  const client = sourceBundleClient([current, unrelatedPdf]);

  const bundle = await workspaceServer.loadDrawingWorkspaceSourceBundle(
    client,
    sourceWorkspace(current),
    null,
  );

  assert.equal(bundle.previousPdf, null);
  assert.equal(bundle.revisionEdge, null);
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [["sign", "projects/plan.pdf", 300]],
  );
});

test("workspace view state accepts only strict shareable 2D, 3D, and split values", () => {
  assert.deepEqual(
    workspaceView.parseDrawingWorkspaceViewState(new URLSearchParams()),
    { view: "2d", ifcFileId: null },
  );
  assert.deepEqual(
    workspaceView.parseDrawingWorkspaceViewState(
      new URLSearchParams(`view=split&ifc=${sourceBundleIds.ifc}`),
    ),
    { view: "split", ifcFileId: sourceBundleIds.ifc },
  );
  for (const query of [
    "view=perspective",
    "view=",
    "view=2d&view=3d",
    "ifc=not-a-uuid",
    `ifc=${sourceBundleIds.ifc}&ifc=${sourceBundleIds.primary}`,
  ]) {
    assert.throws(
      () =>
        workspaceView.parseDrawingWorkspaceViewState(
          new URLSearchParams(query),
        ),
      /작업실 보기|IFC 파일 선택/,
    );
  }
});

test("2D source bundles validate the selected IFC without minting its URL", async () => {
  const primary = workspaceFile();
  const ifc = workspaceFile({
    id: sourceBundleIds.ifc,
    kind: "ifc",
    original_filename: "model.ifc",
    storage_path: "projects/model.ifc",
    content_type: "application/x-step",
    byte_size: 8192,
    sha256: "b".repeat(64),
  });
  const client = sourceBundleClient([primary, ifc]);
  const bundle = await workspaceServer.loadDrawingWorkspaceSourceBundle(
    client,
    sourceWorkspace(primary),
    sourceBundleIds.ifc,
    false,
  );

  assert.equal(bundle.ifc, null);
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [["sign", "projects/plan.pdf", 300]],
  );
  assert.ok(bundle.catalog.some((item) => item.id === sourceBundleIds.ifc));
});

test("source-free workspaces list project PDF, IFC, DXF, and DWG sources without minting capabilities", async () => {
  const pdf = workspaceFile();
  const ifc = workspaceFile({
    id: sourceBundleIds.ifc,
    kind: "ifc",
    original_filename: "model.ifc",
    storage_path: "projects/model.ifc",
    content_type: "application/x-step",
    byte_size: 8192,
    sha256: "b".repeat(64),
  });
  const foreign = workspaceFile({
    id: sourceBundleIds.foreign,
    project_id: sourceBundleIds.foreign,
  });
  const dxf = workspaceFile({
    id: sourceBundleIds.dxf,
    kind: "dxf",
    original_filename: "detail.dxf",
    storage_path: "projects/detail.dxf",
    content_type: "application/dxf",
    byte_size: 16_384,
    sha256: "d".repeat(64),
  });
  const dwg = workspaceFile({
    id: sourceBundleIds.dwg,
    kind: "dwg",
    original_filename: "native.dwg",
    storage_path: "projects/native.dwg",
    content_type: "application/octet-stream",
    byte_size: 32_768,
    sha256: "e".repeat(64),
  });
  const client = sourceBundleClient([pdf, ifc, dxf, dwg, foreign]);

  const bundle = await workspaceServer.loadDrawingWorkspaceSourceBundle(
    client,
    sourceFreeWorkspace(),
    ifc.id,
    false,
  );

  assert.deepEqual(bundle, {
    primary: null,
    pdf: null,
    ifc: null,
    previousPdf: null,
    revisionEdge: null,
    catalog: [
      {
        id: pdf.id,
        kind: "pdf",
        originalFilename: "plan.pdf",
        byteSize: 4096,
        sha256: "a".repeat(64),
      },
      {
        id: ifc.id,
        kind: "ifc",
        originalFilename: "model.ifc",
        byteSize: 8192,
        sha256: "b".repeat(64),
      },
      {
        id: dxf.id,
        kind: "dxf",
        originalFilename: "detail.dxf",
        byteSize: 16_384,
        sha256: "d".repeat(64),
      },
      {
        id: dwg.id,
        kind: "dwg",
        originalFilename: "native.dwg",
        byteSize: 32_768,
        sha256: "e".repeat(64),
      },
    ],
  });
  assert.ok(
    client.calls.some(
      (call) =>
        call[0] === "eq" &&
        call[1] === "project_id" &&
        call[2] === p5Ids.project,
    ),
  );
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [],
  );
  assert.deepEqual(
    client.calls.filter(
      ([kind, column]) => kind === "eq" && column === "source_file_id",
    ),
    [],
  );
});

test("DWG remains catalog-only and cannot become a primary background source", async () => {
  const dwg = workspaceFile({
    id: sourceBundleIds.dwg,
    kind: "dwg",
    original_filename: "native.dwg",
    storage_path: "projects/native.dwg",
    content_type: "application/octet-stream",
    sha256: "e".repeat(64),
  });
  const client = sourceBundleClient([dwg]);
  await assert.rejects(
    workspaceServer.loadDrawingWorkspaceSourceBundle(
      client,
      sourceWorkspace(dwg),
      null,
    ),
    (error) => error instanceof Response && error.status === 400,
  );
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [],
  );
});

test("source-free workspaces load a derivative only for the selected IFC", async () => {
  const pdf = workspaceFile();
  const selectedIfc = workspaceFile({
    id: sourceBundleIds.ifc,
    kind: "ifc",
    original_filename: "selected.ifc",
    storage_path: "projects/selected.ifc",
    content_type: "application/x-step",
    byte_size: 8192,
    sha256: "b".repeat(64),
  });
  const otherIfc = workspaceFile({
    id: sourceBundleIds.previous,
    kind: "ifc",
    original_filename: "other.ifc",
    storage_path: "projects/other.ifc",
    content_type: "application/x-step",
    byte_size: 6144,
    sha256: "c".repeat(64),
  });
  const client = sourceBundleClient([pdf, selectedIfc, otherIfc]);

  const bundle = await workspaceServer.loadDrawingWorkspaceSourceBundle(
    client,
    sourceFreeWorkspace(),
    selectedIfc.id,
    true,
  );

  assert.equal(bundle.primary, null);
  assert.equal(bundle.pdf, null);
  assert.deepEqual(bundle.ifc, {
    id: selectedIfc.id,
    kind: "ifc",
    originalFilename: "selected.ifc",
    byteSize: 8192,
    sha256: "b".repeat(64),
    derivative: {
      status: "not_queued",
      version: null,
      sourceSha256: "b".repeat(64),
      manifestByteSize: null,
      geometryByteSize: null,
      manifestSha256: null,
      geometrySha256: null,
      manifestSignedUrl: null,
      geometrySignedUrl: null,
    },
  });
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [],
  );
  assert.ok(
    client.calls
      .filter(([kind, column]) => kind === "eq" && column === "source_file_id")
      .every(([, , value]) => value === selectedIfc.id),
  );
  assert.ok(
    client.calls.some(
      ([kind, column]) => kind === "eq" && column === "source_file_id",
    ),
  );
});

test("an IFC primary also remains unsigned until 3D is requested", async () => {
  const primaryIfc = workspaceFile({
    kind: "ifc",
    original_filename: "primary.ifc",
    storage_path: "projects/primary.ifc",
    content_type: "application/x-step",
  });
  const workspace = sourceWorkspace(primaryIfc);
  workspace.document.revision.pages = [];
  const client = sourceBundleClient([primaryIfc]);
  const bundle = await workspaceServer.loadDrawingWorkspaceSourceBundle(
    client,
    workspace,
    null,
    false,
  );

  assert.equal(bundle.ifc, null);
  assert.equal("signedUrl" in bundle.primary, false);
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [],
  );
});

test("source bundle signs PDF only and exposes IFC through its derivative descriptor", async () => {
  const primary = workspaceFile();
  const ifc = workspaceFile({
    id: sourceBundleIds.ifc,
    kind: "ifc",
    original_filename: "model.ifc",
    storage_path: "projects/model.ifc",
    content_type: "application/x-step",
    byte_size: 8192,
    sha256: "b".repeat(64),
  });
  const client = sourceBundleClient([primary, ifc]);
  const bundle = await workspaceServer.loadDrawingWorkspaceSourceBundle(
    client,
    sourceWorkspace(primary),
    sourceBundleIds.ifc,
  );

  assert.deepEqual(bundle.primary, {
    id: primary.id,
    kind: "pdf",
    originalFilename: "plan.pdf",
    byteSize: 4096,
    sha256: "a".repeat(64),
    signedUrl: "https://storage.test/projects/plan.pdf",
    derivative: {
      status: "not_applicable",
      version: null,
      sourceSha256: null,
      manifestByteSize: null,
      geometryByteSize: null,
      manifestSha256: null,
      geometrySha256: null,
      manifestSignedUrl: null,
      geometrySignedUrl: null,
    },
  });
  assert.deepEqual(bundle.pdf, bundle.primary);
  assert.deepEqual(bundle.ifc, {
    id: ifc.id,
    kind: "ifc",
    originalFilename: "model.ifc",
    byteSize: 8192,
    sha256: "b".repeat(64),
    derivative: {
      status: "not_queued",
      version: null,
      sourceSha256: "b".repeat(64),
      manifestByteSize: null,
      geometryByteSize: null,
      manifestSha256: null,
      geometrySha256: null,
      manifestSignedUrl: null,
      geometrySignedUrl: null,
    },
  });
  assert.deepEqual(bundle.catalog, [
    {
      id: primary.id,
      kind: "pdf",
      originalFilename: "plan.pdf",
      byteSize: 4096,
      sha256: "a".repeat(64),
    },
    {
      id: ifc.id,
      kind: "ifc",
      originalFilename: "model.ifc",
      byteSize: 8192,
      sha256: "b".repeat(64),
    },
  ]);
  assert.equal(bundle.previousPdf, null);
  assert.equal(bundle.revisionEdge, null);
  assert.deepEqual(
    client.calls.filter(([kind]) => kind === "sign"),
    [["sign", "projects/plan.pdf", 300]],
  );
  assert.equal(JSON.stringify(bundle.catalog).includes("storage.test"), false);
  assert.equal(JSON.stringify(bundle.catalog).includes("storage_path"), false);
});

test("source bundle rejects foreign, mutable, wrong-kind, and malformed-SHA IFC selections before signing", async () => {
  const primary = workspaceFile();
  const cases = [
    workspaceFile({
      id: sourceBundleIds.ifc,
      project_id: sourceBundleIds.foreign,
      kind: "ifc",
      sha256: "b".repeat(64),
    }),
    workspaceFile({
      id: sourceBundleIds.ifc,
      kind: "ifc",
      immutable: false,
      sha256: "b".repeat(64),
    }),
    workspaceFile({ id: sourceBundleIds.ifc, kind: "pdf" }),
    workspaceFile({
      id: sourceBundleIds.ifc,
      kind: "ifc",
      sha256: "B".repeat(64),
    }),
  ];
  for (const selected of cases) {
    const client = sourceBundleClient([primary, selected]);
    await assert.rejects(
      workspaceServer.loadDrawingWorkspaceSourceBundle(
        client,
        sourceWorkspace(primary),
        sourceBundleIds.ifc,
      ),
      (error) => error instanceof Response && [400, 404].includes(error.status),
    );
    assert.deepEqual(
      client.calls.filter(([kind]) => kind === "sign"),
      [],
    );
  }
});
