import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("actual Drawing, BOQ, and material response bytes cross the audit boundary", () => {
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
  for (const source of [drawingRoute, boq, material])
    assert.match(source, /recordProjectExport/);
  assert.match(drawing, /auditDrawingExport/);
  assert.doesNotMatch(
    drawing,
    /download:\s*\(\{ blob, filename \}\) => downloadDrawingExport/,
  );
});

test("Revit release download keeps its existing server-side append-only SHA audit", () => {
  const source = readFileSync(
    new URL("../app/features/home/screens/revit-download.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /lukas_qto_download_events/);
  assert.match(source, /release_sha256:\s*release\.sha256/);
  assert.match(source, /if \(auditError\) throw/);
});

test("server export helper hashes the exact response bytes and fails closed", async () => {
  const { recordProjectExport } =
    await import("../app/lukas/lib/project-export-audit.server.ts");
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
