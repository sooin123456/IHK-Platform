import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const modulePath = "../scripts/drawing-p7-restore-evidence.mjs";
const sha = (digit) => digit.repeat(64);
const ref = (digit) => digit.repeat(20);

function authority() {
  return {
    organizationId: "74000000-0000-4000-8000-000000000001",
    sourceProjectRef: ref("a"),
    targetProjectRef: ref("b"),
    backupId: "backup-2026-08-28",
    managementAccessToken: "sbp_management_authority",
    sourcePostgresUrl: `postgresql://postgres:secret@db.${ref("a")}.supabase.co:5432/postgres`,
    targetPostgresUrl: `postgresql://postgres:secret@db.${ref("b")}.supabase.co:5432/postgres`,
    sourceSupabaseUrl: `https://${ref("a")}.supabase.co`,
    targetSupabaseUrl: `https://${ref("b")}.supabase.co`,
    sourceServiceKey: "source-service-role-key-with-authority",
    targetServiceKey: "target-service-role-key-with-authority",
    sourceCommit: "c".repeat(40),
    requestId: "74000000-0000-4000-8000-000000000009",
  };
}

function snapshot() {
  return {
    systemIdentifier: "7641122334455667788",
    schema: { count: 40, digest: sha("1") },
    database: { count: 500, digest: sha("2") },
    storage: { count: 12, digest: sha("3") },
    yjs: { count: 7, digest: sha("4") },
    approvals: { count: 9, digest: sha("5") },
    lineage: { count: 31, digest: sha("6") },
  };
}

test("restore inventory names the existing approval, BOQ, and material lineage tables", async () => {
  const source = await readFile(new URL(modulePath, import.meta.url), "utf8");
  assert.match(source, /from pg_catalog\.pg_tables/);
  assert.doesNotMatch(source, /const PUBLIC_TABLES/);
  assert.match(source, /pg_catalog\.pg_control_system\(\)/);
  for (const authority of [
    "relrowsecurity",
    "relforcerowsecurity",
    "relacl",
    "pg_get_triggerdef",
    "pg_get_indexdef",
    "pg_type",
    "pg_views",
    "pg_extension",
    "proacl",
  ])
    assert.match(source, new RegExp(authority), authority);
  assert.match(source, /response\.status === 404/);
  assert.doesNotMatch(source, /NOT MET: storage download/);
  for (const table of [
    "lukas_qto_boq_approvals",
    "lukas_drawing_quantity_links",
    "lukas_drawing_boq_links",
    "lukas_drawing_material_links",
    "lukas_qto_boq_versions",
    "lukas_qto_boq_lines",
    "lukas_qto_boq_quantity_mappings",
    "lukas_qto_material_plans",
    "lukas_qto_material_transactions",
  ])
    assert.match(source, new RegExp(`"${table}"`), table);
});

test("missing managed authorities produce explicit UNEXECUTED evidence", async () => {
  const { requireManagedRestoreAuthority, buildUnexecutedRestoreEvidence } =
    await import(modulePath);
  assert.throws(
    () => requireManagedRestoreAuthority({}),
    /UNEXECUTED.*P7_RESTORE_MANAGEMENT_ACCESS_TOKEN/,
  );
  const evidence = buildUnexecutedRestoreEvidence("c".repeat(40), ["token"]);
  assert.equal(evidence.status, "UNEXECUTED");
  assert.equal(evidence.provider.status, "UNEXECUTED");
  assert.equal(evidence.rpoSeconds, null);
  assert.equal(evidence.rtoSeconds, null);
});

test("source and isolated restore must match every retained evidence domain", async () => {
  const { compareRestoreSnapshots } = await import(modulePath);
  assert.deepEqual(compareRestoreSnapshots(snapshot(), snapshot()), {
    status: "PASS",
    mismatches: [],
  });
  const changed = snapshot();
  changed.storage.digest = sha("9");
  changed.approvals.count += 1;
  assert.deepEqual(compareRestoreSnapshots(snapshot(), changed), {
    status: "NOT MET",
    mismatches: ["storage", "approvals"],
  });
  const corrupt = snapshot();
  corrupt.storage.integrity = false;
  assert.deepEqual(compareRestoreSnapshots(corrupt, corrupt), {
    status: "NOT MET",
    mismatches: ["storage"],
  });
  const schemaDrift = snapshot();
  schemaDrift.schema.digest = sha("8");
  assert.deepEqual(compareRestoreSnapshots(snapshot(), schemaDrift), {
    status: "NOT MET",
    mismatches: ["schema"],
  });
});

test("provider-issued backup and restore identities gate PASS and recording", async () => {
  const { runManagedRestoreComparison } = await import(modulePath);
  const recorded = [];
  const value = authority();
  const evidence = await runManagedRestoreComparison(value, {
    async getSourceCommit() {
      return value.sourceCommit;
    },
    now() {
      return "2026-08-28T05:20:00.000Z";
    },
    async listBackups(projectRef, token) {
      assert.equal(projectRef, value.sourceProjectRef);
      assert.equal(token, value.managementAccessToken);
      return [
        {
          id: value.backupId,
          is_physical_backup: true,
          status: "COMPLETED",
          inserted_at: "2026-08-28T05:00:00.000Z",
        },
      ];
    },
    async getProject(projectRef) {
      assert.equal(projectRef, value.targetProjectRef);
      return {
        id: "provider-project-restore-identity",
        ref: projectRef,
        status: "ACTIVE_HEALTHY",
        created_at: "2026-08-28T05:05:00.000Z",
      };
    },
    async captureDatabase(side) {
      assert.match(side, /^(source|target)$/);
      return snapshot();
    },
    async captureStorage(side) {
      assert.match(side, /^(source|target)$/);
      return snapshot().storage;
    },
    async record(item) {
      recorded.push(item);
    },
  });
  assert.equal(evidence.status, "PASS");
  assert.equal(evidence.provider.backupId, value.backupId);
  assert.equal(evidence.provider.restoreProjectRef, value.targetProjectRef);
  assert.equal(
    evidence.provider.restoreId,
    "provider-project-restore-identity",
  );
  assert.equal(evidence.rpoSeconds, 300);
  assert.equal(evidence.rtoSeconds, 900);
  assert.equal(recorded.length, 1);
});

test("provider status or any digest mismatch stays NOT MET", async () => {
  const { runManagedRestoreComparison } = await import(modulePath);
  const value = authority();
  let records = 0;
  const bad = snapshot();
  bad.yjs.digest = sha("9");
  const evidence = await runManagedRestoreComparison(value, {
    async getSourceCommit() {
      return value.sourceCommit;
    },
    now() {
      return "2026-08-28T05:20:00.000Z";
    },
    async listBackups() {
      return [
        {
          id: value.backupId,
          is_physical_backup: true,
          status: "COMPLETED",
          inserted_at: "2026-08-28T05:00:00.000Z",
        },
      ];
    },
    async getProject() {
      return {
        id: "provider-project-restore-identity",
        ref: value.targetProjectRef,
        status: "ACTIVE_HEALTHY",
        created_at: "2026-08-28T05:05:00.000Z",
      };
    },
    async captureDatabase(side) {
      return side === "source" ? snapshot() : bad;
    },
    async captureStorage() {
      return snapshot().storage;
    },
    async record() {
      records += 1;
    },
  });
  assert.equal(evidence.status, "NOT MET");
  assert.deepEqual(evidence.comparison.mismatches, ["yjs"]);
  assert.equal(records, 1);
});

test("checkout mismatch and unissued target restore identity cannot PASS", async () => {
  const { runManagedRestoreComparison } = await import(modulePath);
  const value = authority();
  const adapters = {
    async getSourceCommit() {
      return "d".repeat(40);
    },
    now() {
      return "2026-08-28T05:20:00.000Z";
    },
    async listBackups() {
      return [
        {
          id: value.backupId,
          is_physical_backup: true,
          status: "COMPLETED",
          inserted_at: "2026-08-28T05:00:00.000Z",
        },
      ];
    },
    async getProject() {
      return {
        id: value.targetProjectRef,
        ref: value.targetProjectRef,
        status: "ACTIVE_HEALTHY",
        created_at: "2026-08-28T05:05:00.000Z",
      };
    },
    async captureDatabase() {
      return snapshot();
    },
    async captureStorage() {
      return snapshot().storage;
    },
    async record() {
      assert.fail("unbound evidence must not be recorded");
    },
  };
  await assert.rejects(
    runManagedRestoreComparison(value, adapters),
    /UNEXECUTED.*commit/i,
  );
  adapters.getSourceCommit = async () => value.sourceCommit;
  adapters.record = async () => {};
  const unissued = await runManagedRestoreComparison(value, adapters);
  assert.equal(unissued.status, "NOT MET");
  assert.equal(unissued.provider.status, "NOT MET");
});
