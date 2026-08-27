import assert from "node:assert/strict";
import test from "node:test";

import * as workspaceServer from "../app/lukas/lib/drawing-workspace.server.ts";
import { loadDrawingRevisionSources } from "../app/lukas/lib/drawing-workspace.server.ts";
import * as workspaceView from "../app/lukas/lib/drawing-workspace-view.ts";
import {
  p5Ids,
  p5IfcSource,
  p5PdfSource,
  p5SourceRow,
} from "./fixtures/drawing-workspace-p5-database-fixtures.mjs";

test("source loader returns exact active PDF and IFC payloads", async () => {
  const calls = [];
  const rows = [p5SourceRow(p5PdfSource), p5SourceRow(p5IfcSource)];
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
  assert.deepEqual(result, [p5PdfSource, p5IfcSource]);
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

const sourceBundleIds = {
  primary: "10000000-0000-4000-8000-000000000001",
  ifc: "10000000-0000-4000-8000-000000000002",
  foreign: "10000000-0000-4000-8000-000000000003",
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
    file,
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

function sourceBundleClient(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      assert.equal(table, "lukas_qto_files");
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
          return Promise.resolve({ data: rows, error: null });
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

test("source bundle signs only loaded sources and never puts capabilities in the catalog", async () => {
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
  });
  assert.deepEqual(bundle.pdf, bundle.primary);
  assert.deepEqual(bundle.ifc, {
    id: ifc.id,
    kind: "ifc",
    originalFilename: "model.ifc",
    byteSize: 8192,
    sha256: "b".repeat(64),
    signedUrl: "https://storage.test/projects/model.ifc",
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
    [
      ["sign", "projects/plan.pdf", 300],
      ["sign", "projects/model.ifc", 300],
    ],
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
