import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

function assertOrdered(source, labels) {
  let cursor = -1;
  for (const label of labels) {
    const next = source.indexOf(label, cursor + 1);
    assert.ok(next > cursor, `${label} must appear in the documented order`);
    cursor = next;
  }
}

test("P3 runbook is executable, least-privilege, and forward-safe", async () => {
  const deployment = await read("DEPLOYMENT.md");
  const start = deployment.indexOf("## Drawing Workspace P3 release runbook");
  assert.ok(start >= 0, "dedicated P3 release runbook is required");
  const p3 = deployment.slice(start);

  assertOrdered(p3, [
    "1. Backup and snapshot",
    "2. Asymmetric JWKS preflight",
    "3. Collaboration login",
    "4. Additive migrations and types",
    "5. Collaboration image",
    "6. Service smoke",
    "7. Application preview",
    "8. P3 production fixture",
    "9. Promote",
  ]);

  for (const evidence of [
    "RS256",
    "ES256",
    "HS256-only",
    "JWKS cache",
    "SET ROLE lukas_drawing_collaboration",
    "RESET ROLE",
    "Node 22",
    "one replica",
    "/healthz",
    "test:e2e:drawing-workspace-p3:production",
    "pg_publication_tables",
    "information_schema.role_routine_grants",
    "lukas_drawing_collaboration_states",
    "lukas_drawing_collaboration_freeze_leases",
    "owner_token",
    "freeze_request_id",
    "missing publication",
    "lukas_qto_project_members",
  ]) assert.match(p3, new RegExp(evidence, "i"), evidence);

  for (const authority of [
    "E2E_BASE_URL",
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VITE_DRAWING_COLLABORATION_URL",
    "COLLABORATION_INTERNAL_URL",
    "COLLABORATION_INTERNAL_SECRET",
    "COLLABORATION_FREEZE_SECRET",
    "P3_E2E_DATABASE_ADMIN_URL",
    "P3_E2E_RUN_ID",
  ]) assert.match(p3, new RegExp(authority), authority);
  assert.doesNotMatch(p3, /supabase db dump[^\n]*--schema-only/);

  assert.match(p3, /stop new room admission/i);
  assert.match(p3, /flush.*await.*Hocuspocus/is);
  assert.match(p3, /retain.*operation.*snapshot/is);
  assert.match(p3, /forward-fix migration/i);
  assert.match(p3, /backup restore.*approved incident/is);
  assert.match(p3, /frozen.*in-flight.*rejected review/is);
});

test("P3 release record separates evidence classes and never invents production proof", async () => {
  const report = await read(
    "../docs/superpowers/reports/2026-08-26-drawing-workspace-p3-release.md",
  );

  assertOrdered(report, [
    "## IMPLEMENTED",
    "## LOCAL PASS",
    "## LOCAL ENV UNEXECUTED",
    "## PRODUCTION UNEXECUTED",
    "## MEASURED",
  ]);
  assert.match(report, /573345d/);
  assert.match(report, /20260825192113.*20260826073708/s);
  assert.match(report, /artifact.*SHA-256/i);
  assert.match(report, /production p95.*UNEXECUTED/i);
  assert.match(report, /two-user.*UNEXECUTED/i);
  assert.match(report, /rollback rehearsal.*UNEXECUTED/i);
  assert.doesNotMatch(report, /\b(?:TBD|TODO|placeholder)\b/i);
  assert.doesNotMatch(report, /P3 (?:operational|production) (?:complete|PASS)/i);
});

test("P3 field, matrix, and project status agree on local versus production completion", async () => {
  const [field, matrix, state] = await Promise.all([
    read("../docs/DRAWING_COLLABORATION_FIELD_CHECK.md"),
    read("../docs/P0_P5_IMPLEMENTATION_MATRIX.md"),
    read("../docs/PROJECT_STATE.md"),
  ]);

  for (const source of [field, matrix, state]) {
    assert.match(source, /P3.*local implementation/is);
    assert.match(source, /P3.*production.*(?:UNEXECUTED|미실행)/is);
    assert.doesNotMatch(
      source,
      /(?:status|상태)\s*:\s*\*?\*?P3 (?:operationally complete|운영 완료)/i,
    );
  }
  assert.match(field, /owner.*editor.*reviewer.*viewer.*nonmember/is);
  assert.match(field, /three-context.*p95.*500 ms/is);
  assert.match(matrix, /Yjs.*y-indexeddb.*Hocuspocus/is);
  assert.match(state, /final broad\s+review.*pending/i);
});
