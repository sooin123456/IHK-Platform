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
    drillStartedAt: "2026-08-28T05:10:00.000Z",
  };
}

function snapshot() {
  return {
    systemIdentifier: "7641122334455667788",
    schema: { count: 40, digest: sha("1") },
    database: { count: 500, digest: sha("2") },
    storage: { count: 12, digest: sha("3"), integrity: true },
    yjs: { count: 7, digest: sha("4") },
    approvals: { count: 9, digest: sha("5") },
    lineage: { count: 31, digest: sha("6") },
  };
}

function matchingAdapters(value, overrides = {}) {
  return {
    async getSourceCommit() {
      return value.sourceCommit;
    },
    now() {
      return "2026-08-28T05:30:00.000Z";
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
        created_at: "2026-08-28T05:20:00.000Z",
      };
    },
    async captureDatabase() {
      return snapshot();
    },
    async captureStorage() {
      return snapshot().storage;
    },
    async record() {
      assert.fail("correlated-only evidence must not be recorded");
    },
    ...overrides,
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
  const {
    requireManagedRestoreAuthority,
    buildUnexecutedRestoreEvidence,
    inspectDrawingP7RestoreEvidence,
  } = await import(modulePath);
  assert.throws(
    () => requireManagedRestoreAuthority({}),
    /UNEXECUTED.*P7_RESTORE_MANAGEMENT_ACCESS_TOKEN/,
  );
  const evidence = buildUnexecutedRestoreEvidence("c".repeat(40), ["token"]);
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.status, "UNEXECUTED");
  assert.equal(evidence.provider.correlation.status, "UNEXECUTED");
  assert.equal(evidence.provider.directBinding.status, "UNEXECUTED");
  assert.equal(evidence.provider.targetProjectRef, null);
  assert.equal(evidence.rpoSeconds, null);
  assert.equal(evidence.rtoSeconds, null);
  assert.doesNotThrow(() => inspectDrawingP7RestoreEvidence(evidence));
  for (const mutate of [
    (item) => (item.sourceCommit = "forged"),
    (item) =>
      (item.provider.correlation.physicalClusterSystemIdentifier = "forged"),
  ]) {
    const forged = structuredClone(evidence);
    mutate(forged);
    assert.throws(() => inspectDrawingP7RestoreEvidence(forged));
  }

  const value = authority();
  const environment = {
    P7_RESTORE_MANAGEMENT_ACCESS_TOKEN: value.managementAccessToken,
    P7_RESTORE_SOURCE_PROJECT_REF: value.sourceProjectRef,
    P7_RESTORE_TARGET_PROJECT_REF: value.targetProjectRef,
    P7_RESTORE_ORGANIZATION_ID: value.organizationId,
    P7_RESTORE_BACKUP_ID: value.backupId,
    P7_RESTORE_SOURCE_POSTGRES_URL: value.sourcePostgresUrl,
    P7_RESTORE_TARGET_POSTGRES_URL: value.targetPostgresUrl,
    P7_RESTORE_SOURCE_SUPABASE_URL: value.sourceSupabaseUrl,
    P7_RESTORE_TARGET_SUPABASE_URL: value.targetSupabaseUrl,
    P7_RESTORE_SOURCE_SERVICE_ROLE_KEY: value.sourceServiceKey,
    P7_RESTORE_TARGET_SERVICE_ROLE_KEY: value.targetServiceKey,
    P7_RESTORE_COMMIT: value.sourceCommit,
    P7_RESTORE_REQUEST_ID: value.requestId,
  };
  assert.throws(
    () => requireManagedRestoreAuthority(environment),
    /UNEXECUTED.*P7_RESTORE_DRILL_STARTED_AT/,
  );
  environment.P7_RESTORE_DRILL_STARTED_AT = value.drillStartedAt;
  assert.equal(
    requireManagedRestoreAuthority(environment).drillStartedAt,
    value.drillStartedAt,
  );
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

test("provider correlation stays UNEXECUTED without direct backup binding", async () => {
  const { inspectDrawingP7RestoreEvidence, runManagedRestoreComparison } =
    await import(modulePath);
  const recorded = [];
  const value = authority();
  const evidence = await runManagedRestoreComparison(value, {
    async getSourceCommit() {
      return value.sourceCommit;
    },
    now() {
      return "2026-08-28T05:30:00.000Z";
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
        created_at: "2026-08-28T05:20:00.000Z",
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
  assert.equal(evidence.schemaVersion, 2);
  assert.equal(evidence.status, "UNEXECUTED");
  assert.equal(evidence.provider.backupId, value.backupId);
  assert.equal(evidence.provider.backupIsPhysical, true);
  assert.equal(evidence.provider.targetProjectRef, value.targetProjectRef);
  assert.equal(evidence.provider.restoreProjectRef, value.targetProjectRef);
  assert.equal(
    evidence.provider.restoreProjectId,
    "provider-project-restore-identity",
  );
  assert.equal("restoreId" in evidence.provider, false);
  assert.equal(evidence.provider.correlation.status, "MATCHED");
  assert.equal(evidence.provider.directBinding.status, "UNEXECUTED");
  assert.equal(evidence.comparison.status, "UNEXECUTED");
  assert.equal(evidence.drillStartedAt, value.drillStartedAt);
  assert.equal(evidence.rpoSeconds, 600);
  assert.equal(evidence.rtoSeconds, 1_200);
  assert.equal(recorded.length, 0);
  assert.doesNotThrow(() => inspectDrawingP7RestoreEvidence(evidence));
});

test("provider status or any digest mismatch stays NOT MET and may record", async () => {
  const { inspectDrawingP7RestoreEvidence, runManagedRestoreComparison } =
    await import(modulePath);
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
        created_at: "2026-08-28T05:15:00.000Z",
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
  assert.doesNotThrow(() => inspectDrawingP7RestoreEvidence(evidence));
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
  assert.equal(unissued.provider.correlation.status, "NOT MET");
});

test("event ordering is exact and a provider timing failure stays NOT MET", async () => {
  const { inspectDrawingP7RestoreEvidence, runManagedRestoreComparison } =
    await import(modulePath);
  const value = authority();
  let records = 0;
  const evidence = await runManagedRestoreComparison(value, {
    async getSourceCommit() {
      return value.sourceCommit;
    },
    now() {
      return "2026-08-28T05:30:00.000Z";
    },
    async listBackups() {
      return [
        {
          id: value.backupId,
          is_physical_backup: true,
          status: "COMPLETED",
          inserted_at: "2026-08-28T05:15:00.000Z",
        },
      ];
    },
    async getProject() {
      return {
        id: "provider-project-restore-identity",
        ref: value.targetProjectRef,
        status: "ACTIVE_HEALTHY",
        created_at: "2026-08-28T05:20:00.000Z",
      };
    },
    async captureDatabase() {
      return snapshot();
    },
    async captureStorage() {
      return snapshot().storage;
    },
    async record() {
      records += 1;
    },
  });
  assert.equal(evidence.status, "NOT MET");
  assert.equal(evidence.provider.correlation.status, "NOT MET");
  assert.equal(evidence.rpoSeconds, null);
  assert.equal(evidence.rtoSeconds, null);
  assert.equal(records, 0);
  assert.doesNotThrow(() => inspectDrawingP7RestoreEvidence(evidence));
});

test("restore measurement is sampled after capture and includes capture duration", async () => {
  const { runManagedRestoreComparison } = await import(modulePath);
  const value = authority();
  let captures = 0;
  const evidence = await runManagedRestoreComparison(
    value,
    matchingAdapters(value, {
      now() {
        assert.equal(captures, 4);
        return "2026-08-28T05:30:00.000Z";
      },
      async captureDatabase() {
        captures += 1;
        return snapshot();
      },
      async captureStorage() {
        captures += 1;
        return snapshot().storage;
      },
    }),
  );
  assert.equal(evidence.measuredAt, "2026-08-28T05:30:00.000Z");
  assert.equal(evidence.rtoSeconds, 1_200);
});

test("requested target ref is distinct from observed restore project correlation", async () => {
  const { inspectDrawingP7RestoreEvidence, runManagedRestoreComparison } =
    await import(modulePath);
  const value = authority();
  for (const actualRef of [ref("d"), null]) {
    let records = 0;
    const evidence = await runManagedRestoreComparison(
      value,
      matchingAdapters(value, {
        async getProject() {
          return {
            id: "provider-project-restore-identity",
            ref: actualRef,
            status: "ACTIVE_HEALTHY",
            created_at: "2026-08-28T05:20:00.000Z",
          };
        },
        async record() {
          records += 1;
        },
      }),
    );
    assert.equal(evidence.provider.targetProjectRef, value.targetProjectRef);
    assert.equal(evidence.provider.restoreProjectRef, actualRef);
    assert.equal(evidence.provider.correlation.status, "NOT MET");
    assert.equal(evidence.status, "NOT MET");
    assert.equal(records, 1);
    assert.doesNotThrow(() => inspectDrawingP7RestoreEvidence(evidence));
  }
});

test("record failure preserves the exact inspected NOT MET evidence", async () => {
  const {
    classifyDrawingP7RestoreFailure,
    inspectDrawingP7RestoreEvidence,
    runManagedRestoreComparison,
  } = await import(modulePath);
  const value = authority();
  const bad = snapshot();
  bad.yjs.digest = sha("9");
  let recorded;
  let failure;
  try {
    await runManagedRestoreComparison(
      value,
      matchingAdapters(value, {
        async captureDatabase(side) {
          return side === "source" ? snapshot() : bad;
        },
        async record(evidence) {
          recorded = evidence;
          throw new Error("append-only ledger unavailable");
        },
      }),
    );
  } catch (error) {
    failure = error;
  }
  assert.match(failure.message, /append-only ledger unavailable/);
  assert.strictEqual(failure.restoreEvidence, recorded);
  assert.equal(recorded.status, "NOT MET");
  assert.doesNotThrow(() => inspectDrawingP7RestoreEvidence(recorded));
  const result = classifyDrawingP7RestoreFailure(failure, value.sourceCommit);
  assert.strictEqual(result.evidence, recorded);
  assert.equal(result.exitCode, 1);
  assert.match(result.message, /append-only ledger unavailable/);
});

test("strict inspector rejects malformed and forged PASS restore evidence", async () => {
  const { inspectDrawingP7RestoreEvidence, runManagedRestoreComparison } =
    await import(modulePath);
  const value = authority();
  const evidence = await runManagedRestoreComparison(value, {
    async getSourceCommit() {
      return value.sourceCommit;
    },
    now() {
      return "2026-08-28T05:30:00.000Z";
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
        created_at: "2026-08-28T05:20:00.000Z",
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
  });
  const mutations = [
    (item) => (item.schemaVersion = 1),
    (item) => (item.status = "PASS"),
    (item) => (item.provider.directBinding.status = "PASS"),
    (item) => delete item.source.lineage,
    (item) => (item.target.storage.digest = sha("9")),
    (item) => (item.comparison.mismatches = ["database"]),
    (item) => (item.rpoSeconds = 601),
    (item) => (item.provider.restoreId = item.provider.restoreProjectId),
  ];
  for (const mutate of mutations) {
    const forged = structuredClone(evidence);
    mutate(forged);
    assert.throws(() => inspectDrawingP7RestoreEvidence(forged));
  }
});
