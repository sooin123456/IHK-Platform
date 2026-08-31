import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createServer } from "vite";

const projectId = "74000000-0000-4000-8000-000000000002";
const workspaceId = "74000000-0000-4000-8000-000000000003";
const revisionId = "74000000-0000-4000-8000-000000000004";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260828052729_drawing_workspace_retention_restore.sql",
    import.meta.url,
  ),
  "utf8",
);

test("project exports are append-only, exact-byte hashed, and RPC-authorized", () => {
  assert.match(migration, /create table public\.lukas_qto_export_events/i);
  assert.match(migration, /artifact_sha256[^;]*\^\[0-9a-f\]\{64\}\$/i);
  assert.match(
    migration,
    /artifact_byte_size bigint not null check\(artifact_byte_size>0\)/i,
  );
  assert.match(migration, /lukas_qto_export_events_append_only/i);
  assert.match(
    migration,
    /create function public\.lukas_qto_record_project_export/i,
  );
  assert.match(
    migration,
    /private\.lukas_qto_project_role\(p_project_id\) is null/i,
  );
  assert.match(migration, /where p\.id=p_project_id/i);
  assert.match(
    migration,
    /values\(v_organization_id,p_project_id,p_artifact_type/i,
  );
  assert.doesNotMatch(
    migration,
    /grant (?:insert|update|delete)[^;]*lukas_qto_export_events[^;]*authenticated/i,
  );
});

test("every actual project export response crosses the audit boundary", () => {
  const drawing = readFileSync(
    new URL(
      "../app/lukas/components/drawing-export-dialog.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const drawingRoute = readFileSync(
    new URL(
      "../app/lukas/screens/drawing-workspace-export.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const boq = readFileSync(
    new URL("../app/lukas/screens/verified-boq.tsx", import.meta.url),
    "utf8",
  );
  const material = readFileSync(
    new URL("../app/lukas/screens/material-control-export.ts", import.meta.url),
    "utf8",
  );
  const suggestion = readFileSync(
    new URL("../app/lukas/screens/project.tsx", import.meta.url),
    "utf8",
  );
  const ids = readFileSync(
    new URL(
      "../app/lukas/screens/information-requirements.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  for (const source of [drawingRoute, boq, material, suggestion, ids])
    assert.match(source, /recordProjectExport/);
  assert.match(suggestion, /suggestion_feedback_json/);
  assert.match(ids, /ids_bcfzip/);
  assert.match(drawing, /auditDrawingExport/);
  assert.doesNotMatch(
    drawing,
    /download:\s*\(\{ blob, filename \}\) => downloadDrawingExport/,
  );
});

test("drawing export audit posts to the canonical workspace identity", async () => {
  const vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  const original = {
    createObjectURL: URL.createObjectURL,
    document: globalThis.document,
    fetch: globalThis.fetch,
    revokeObjectURL: URL.revokeObjectURL,
  };
  const calls = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push([String(url), init]);
      return new Response(new Blob(["pdf"], { type: "application/pdf" }), {
        headers: { "content-type": "application/pdf" },
        status: 200,
      });
    };
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => {};
    globalThis.document = {
      createElement() {
        return { click() {} };
      },
    };
    const { auditDrawingExport } = await vite.ssrLoadModule(
      "/app/lukas/components/drawing-export-dialog.tsx",
    );
    await auditDrawingExport(
      new Blob(["pdf"], { type: "application/pdf" }),
      "drawing.pdf",
      workspaceId,
      projectId,
      revisionId,
    );
    assert.equal(
      calls[0][0],
      `/projects/${projectId}/workspaces/${workspaceId}/export`,
    );
    assert.equal(calls[0][1].method, "POST");
    assert.doesNotMatch(calls[0][0], /\/drawings\//);
  } finally {
    globalThis.fetch = original.fetch;
    globalThis.document = original.document;
    URL.createObjectURL = original.createObjectURL;
    URL.revokeObjectURL = original.revokeObjectURL;
    await vite.close();
  }
});

test("drawing export scope binds canonical workspace/revision and preserves legacy file export", async () => {
  const vite = await createServer({
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { validateDrawingExportScope } = await vite.ssrLoadModule(
      "/app/lukas/screens/drawing-workspace-export.ts",
    );
    const calls = [];
    const client = {
      from(table) {
        const call = { table, filters: [] };
        calls.push(call);
        const builder = {
          select() {
            return builder;
          },
          eq(column, value) {
            call.filters.push([column, value]);
            return builder;
          },
          maybeSingle() {
            if (table === "lukas_drawing_revisions")
              return Promise.resolve({
                data: { id: revisionId, document_id: workspaceId },
              });
            if (table === "lukas_drawing_documents")
              return Promise.resolve({
                data: { id: workspaceId, source_file_id: sourceFileId },
              });
            return Promise.resolve({ data: { id: sourceFileId } });
          },
        };
        return builder;
      },
    };
    const sourceFileId = "74000000-0000-4000-8000-000000000005";
    await validateDrawingExportScope(client, {
      fileId: null,
      projectId,
      revisionId,
      workspaceId,
    });
    assert.deepEqual(
      calls.map((call) => call.table),
      ["lukas_drawing_revisions", "lukas_drawing_documents"],
    );
    assert.deepEqual(calls[1].filters, [
      ["id", workspaceId],
      ["project_id", projectId],
    ]);

    calls.length = 0;
    await validateDrawingExportScope(client, {
      fileId: sourceFileId,
      projectId,
      revisionId,
      workspaceId: null,
    });
    assert.deepEqual(
      calls.map((call) => call.table),
      ["lukas_drawing_revisions", "lukas_drawing_documents", "lukas_qto_files"],
    );
  } finally {
    await vite.close();
  }
});

test("Revit release download keeps its existing server-side append-only SHA audit", () => {
  const source = readFileSync(
    new URL("../app/features/home/screens/revit-download.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /await recordRevitDownloadAudit/);
  assert.match(source, /await assertReleaseArtifactSha256/);
  assert.ok(
    source.indexOf("await assertReleaseArtifactSha256") <
      source.indexOf("await recordRevitDownloadAudit"),
  );
  assert.ok(
    source.indexOf("await recordRevitDownloadAudit") <
      source.indexOf('headers.set("Location"'),
  );
  assert.match(source, /recordRevitDownloadAudit/);
  assert.match(
    migration,
    /lukas_qto_download_events_append_only[\s\S]*lukas_qto_retention_append_guard/i,
  );
  assert.match(migration, /foreign key\(user_id\)[^;]*on delete set null/i);
  assert.match(
    migration,
    /grant select on table public\.lukas_qto_download_events to authenticated,service_role/i,
  );
  assert.doesNotMatch(
    migration,
    /grant[^;]*(?:insert|update|delete)[^;]*lukas_qto_download_events[^;]*service_role/i,
  );
});

test("anonymous Revit redirect records through the trusted ledger and fails closed", async () => {
  const { recordRevitDownloadAudit } = await import(
    "../app/features/home/lib/revit-download-audit.server.ts"
  );
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: 1, error: null };
    },
  };
  await recordRevitDownloadAudit(client, null, {
    version: "2026.8.28",
    sha256: "A".repeat(64),
  });
  assert.deepEqual(calls, [
    {
      name: "lukas_qto_record_revit_download",
      args: {
        p_user_id: null,
        p_release_version: "2026.8.28",
        p_release_sha256: "A".repeat(64),
      },
    },
  ]);
  client.rpc = async () => ({ data: null, error: { message: "denied" } });
  await assert.rejects(
    recordRevitDownloadAudit(client, null, {
      version: "2026.8.28",
      sha256: "A".repeat(64),
    }),
    /다운로드 기록.*denied/,
  );
});

test("published Revit ZIP is hashed at download time and rejects a mismatched body", async () => {
  const { createHash } = await import("node:crypto");
  const { assertReleaseArtifactSha256 } = await import(
    "../app/features/home/lib/revit-download-audit.server.ts"
  );
  const bytes = Buffer.from("official-field-kit");
  const sha256 = createHash("sha256").update(bytes).digest("hex").toUpperCase();
  await assertReleaseArtifactSha256(
    "https://files.example/kit.zip",
    sha256,
    async () => new Response(bytes, { status: 200 }),
  );
  await assert.rejects(
    () =>
      assertReleaseArtifactSha256(
        "https://files.example/kit.zip",
        sha256,
        async () => new Response(Buffer.from("tampered"), { status: 200 }),
      ),
    /확인번호와 다릅니다/,
  );
  await assert.rejects(
    () =>
      assertReleaseArtifactSha256(
        "https://files.example/kit.zip",
        sha256,
        async () => new Response(null, { status: 404 }),
      ),
    /확인하지 못했습니다/,
  );
});

test("server export helper hashes the exact response bytes and fails closed", async () => {
  const { recordProjectExport } = await import(
    "../app/lukas/lib/project-export-audit.server.ts"
  );
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { id: "event" }, error: null };
    },
  };
  const bytes = new Uint8Array([0, 1, 2, 255]);
  const result = await recordProjectExport(
    client,
    "74000000-0000-4000-8000-000000000002",
    "drawing_pdf",
    bytes,
    "74000000-0000-4000-8000-000000000003",
  );
  assert.deepEqual(result.bytes, bytes);
  assert.equal(calls[0].name, "lukas_qto_record_project_export");
  assert.equal(
    calls[0].args.p_artifact_sha256,
    "3d1f57c984978ef98a18378c8166c1cb8ede02c03eeb6aee7e2f121dfeee3e56",
  );
  assert.equal(calls[0].args.p_artifact_byte_size, 4);
  client.rpc = async () => ({ data: null, error: { message: "denied" } });
  await assert.rejects(
    recordProjectExport(
      client,
      "74000000-0000-4000-8000-000000000002",
      "drawing_pdf",
      bytes,
    ),
    /감사 기록 실패.*denied/,
  );
});
