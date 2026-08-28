import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const evidenceModule =
  await import("../scripts/drawing-p7-release-evidence.mjs").catch(() => ({}));
const runnerModule =
  await import("../scripts/run-drawing-workspace-p7-release.mjs").catch(
    () => ({}),
  );

const hosted = {
  P7_E2E_BASE_URL: "https://drawing.onehk.kr",
  P7_E2E_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  P7_E2E_SUPABASE_ANON_KEY: "a".repeat(40),
  P7_E2E_SUPABASE_SERVICE_ROLE_KEY: "b".repeat(40),
  P7_E2E_POSTGRES_URL:
    "postgresql://admin:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres?sslmode=require",
  P7_E2E_COLLABORATION_URL: "wss://collaboration.onehk.kr",
  P7_E2E_TELEMETRY_URL: "https://telemetry.onehk.kr/p7-release-evidence",
  P7_E2E_TELEMETRY_TOKEN: "t".repeat(40),
  P7_E2E_COMMIT: "1".repeat(40),
  P7_E2E_DEPLOYMENT_ID: "dpl_p7_20260828",
  P7_E2E_REGION: "icn1",
  P7_E2E_RUN_ID: "p7-release-20260828-a1",
  P7_E2E_PROJECT_ID: "00000000-0000-4000-8000-000000000001",
  P7_E2E_DOCUMENT_ID: "00000000-0000-4000-8000-000000000002",
  P7_E2E_REVISION_ID: "00000000-0000-4000-8000-000000000003",
  P7_E2E_FILE_ID: "00000000-0000-4000-8000-000000000004",
  P7_E2E_LAYER_ID: "00000000-0000-4000-8000-000000000005",
  P7_E2E_AUTHOR_ID: "00000000-0000-4000-8000-000000000006",
  P7_E2E_AUTHOR_EMAIL: "author@onehk.kr",
  P7_E2E_COMMENTER_ID: "00000000-0000-4000-8000-000000000007",
  P7_E2E_COMMENTER_EMAIL: "commenter@onehk.kr",
  P7_E2E_APPROVER_ID: "00000000-0000-4000-8000-000000000008",
  P7_E2E_APPROVER_EMAIL: "approver@onehk.kr",
};

function withCurrentRequirementLedger(evidence) {
  const current = structuredClone(evidence);
  current.requirements = evidenceModule.P7_REQUIREMENTS.map(
    ({ id, scope }) =>
      current.requirements.find((row) => row.id === id) ?? {
        id,
        scope,
        status: "UNEXECUTED",
        authority: "new production authority remains unavailable",
        receipt: null,
      },
  );
  current.summary = { PASS: 0, NOT_MET: 0, UNEXECUTED: 0 };
  for (const { status } of current.requirements) current.summary[status] += 1;
  current.overall = current.summary.NOT_MET
    ? "NOT_MET"
    : current.summary.UNEXECUTED
      ? "UNEXECUTED"
      : "PASS";
  current.externalInputs = current.requirements.filter(
    ({ scope, status }) => scope === "production" && status !== "PASS",
  ).length;
  return current;
}

test("P7 production authority requires hosted current deployment and three real distinct identities", () => {
  assert.equal(typeof runnerModule.requireP7ProductionAuthorities, "function");
  assert.throws(
    () => runnerModule.requireP7ProductionAuthorities({}),
    /UNEXECUTED.*P7_E2E_BASE_URL/,
  );
  const authority = runnerModule.requireP7ProductionAuthorities(hosted);
  assert.equal(authority.identities.length, 3);
  assert.equal(new Set(authority.identities.map(({ id }) => id)).size, 3);
  assert.equal(new Set(authority.identities.map(({ email }) => email)).size, 3);
  for (const key of Object.keys(hosted)) {
    const missing = { ...hosted };
    delete missing[key];
    assert.throws(
      () => runnerModule.requireP7ProductionAuthorities(missing),
      new RegExp(`UNEXECUTED.*${key}`),
    );
  }
  for (const fakeEmail of [
    "fixture@example.test",
    "local-user@onehk.kr",
    "test-user@onehk.kr",
  ])
    assert.throws(
      () =>
        runnerModule.requireP7ProductionAuthorities({
          ...hosted,
          P7_E2E_AUTHOR_EMAIL: fakeEmail,
        }),
      /real production identity/,
    );

  assert.equal(
    typeof runnerModule.buildP7ProductionGateEnvironment,
    "function",
  );
  const environment = runnerModule.buildP7ProductionGateEnvironment(
    authority,
    { PATH: "/usr/bin" },
    "/tmp/p7-raw.json",
    "00000000-0000-4000-8000-000000000099",
  );
  assert.equal(
    environment.DRAWING_P7_REAL_DATABASE_URL,
    authority.postgresUrl.toString(),
  );
  assert.equal(
    environment.P7_REAL_POSTGRES_DATABASE_URL,
    authority.postgresUrl.toString(),
  );
});

test("P7 release manifest covers every required authority and gathers all results", async () => {
  assert.equal(typeof runnerModule.assertExactP7GateManifest, "function");
  assert.doesNotThrow(() =>
    runnerModule.assertExactP7GateManifest(runnerModule.P7_RELEASE_GATES),
  );
  const labels = runnerModule.P7_RELEASE_GATES.map(({ id }) => id);
  for (const id of [
    "node.p0_p7",
    "database.pglite",
    "database.real_postgres",
    "browser.desktop_tablet",
    "collaboration.service",
    "source.pdf_ifc",
    "lineage.boq_material",
    "performance.source_bound",
    "retention.restore",
    "organization.rls_entitlements",
    "license.closure",
    "application.typecheck_build",
  ])
    assert.ok(labels.includes(id), id);

  const visited = [];
  const results = await runnerModule.runP7Gates(
    [
      { id: "pass", argv: ["pass"] },
      { id: "miss", argv: ["miss"] },
      { id: "still-runs", argv: ["still-runs"] },
    ],
    async ({ id }) => {
      visited.push(id);
      return id === "miss" ? 9 : 0;
    },
  );
  assert.deepEqual(visited, ["pass", "miss", "still-runs"]);
  assert.deepEqual(results, [
    { id: "pass", status: "PASS", exitCode: 0 },
    { id: "miss", status: "NOT_MET", exitCode: 9 },
    { id: "still-runs", status: "PASS", exitCode: 0 },
  ]);
});

test("P7 evidence is source and child-receipt bound and cannot pass with cold or production gaps", () => {
  assert.equal(
    typeof evidenceModule.validateDrawingP7ReleaseEvidence,
    "function",
  );
  const evidence = evidenceModule.buildDrawingP7ReleaseEvidenceFixture?.({
    commit: "1".repeat(40),
  });
  assert.ok(evidence, "fixture builder exists");
  assert.doesNotThrow(() =>
    evidenceModule.validateDrawingP7ReleaseEvidence(evidence, {
      expectedCommit: "1".repeat(40),
      verifyReceipts: false,
    }),
  );
  assert.equal(evidence.summary.PASS > 0, true);
  assert.equal(evidence.summary.NOT_MET > 0, true);
  assert.equal(evidence.summary.UNEXECUTED > 0, true);
  assert.equal(evidence.overall, "NOT_MET");
  assert.throws(
    () =>
      evidenceModule.assertDrawingP7ProgramComplete(evidence, {
        expectedCommit: "1".repeat(40),
        verifyReceipts: false,
      }),
    /NOT_MET|UNEXECUTED/,
  );

  const forged = structuredClone(evidence);
  for (const requirement of forged.requirements) requirement.status = "PASS";
  forged.summary = {
    PASS: forged.requirements.length,
    NOT_MET: 0,
    UNEXECUTED: 0,
  };
  forged.overall = "PASS";
  assert.throws(
    () =>
      evidenceModule.validateDrawingP7ReleaseEvidence(forged, {
        expectedCommit: "1".repeat(40),
        verifyReceipts: false,
      }),
    /cold|production|managed restore|three-user|execution authority/i,
  );
});

test("P7 required mode exits nonzero and writes honest evidence when production authority is absent", () => {
  const run = spawnSync(
    process.execPath,
    ["scripts/run-drawing-workspace-p7-release.mjs", "authority-check"],
    {
      cwd: new URL("..", import.meta.url),
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
    },
  );
  assert.notEqual(run.status, 0);
  assert.match(`${run.stdout}\n${run.stderr}`, /UNEXECUTED.*P7_E2E_BASE_URL/);
});

test("P7 production Playwright contract uses supplied identities and emits only runner-bound evidence", async () => {
  const source = await readFile(
    new URL("../e2e/drawing-workspace-p7-production.spec.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /requireP7ProductionAuthorities\(process\.env\)/);
  assert.match(source, /getUserById\(identity\.id\)/);
  assert.match(source, /authority\.identities\.map\(exactUser\)/);
  assert.match(source, /readSourceEvidence|source.*sha256/i);
  assert.match(source, /offline/i);
  assert.match(source, /request_review|검토 요청/);
  assert.match(source, /도면 검토 완료/);
  assert.match(source, /도면 최종 승인/);
  assert.match(source, /persistedOutboxOperationIds|offlineClientOperationId/);
  assert.match(source, /page\.on\("websocket"/);
  assert.doesNotMatch(source, /const revisionOperation/);
  assert.match(source, /download|내보내기/);
  assert.doesNotMatch(source, /createUser|example\.test|fixture/i);
});

test("P7 production receipt accepts only the current runner invocation and zero-loss immutable outcome", () => {
  assert.equal(typeof runnerModule.validateP7ProductionReceipt, "function");
  const receipt = {
    schemaVersion: 1,
    authority: "P7_MOUNTED_PRODUCTION_PLAYWRIGHT_V1",
    invocationId: "00000000-0000-4000-8000-000000000009",
    runId: hosted.P7_E2E_RUN_ID,
    commit: hosted.P7_E2E_COMMIT,
    deploymentId: hosted.P7_E2E_DEPLOYMENT_ID,
    identities: [
      { id: hosted.P7_E2E_AUTHOR_ID, email: hosted.P7_E2E_AUTHOR_EMAIL },
      { id: hosted.P7_E2E_COMMENTER_ID, email: hosted.P7_E2E_COMMENTER_EMAIL },
      { id: hosted.P7_E2E_APPROVER_ID, email: hosted.P7_E2E_APPROVER_EMAIL },
    ],
    roles: {
      author: "estimator",
      commenter: "reviewer",
      approver: "approver",
    },
    projectId: hosted.P7_E2E_PROJECT_ID,
    documentId: hosted.P7_E2E_DOCUMENT_ID,
    revisionId: hosted.P7_E2E_REVISION_ID,
    sourceBefore: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        kind: "pdf",
        sha256: "a".repeat(64),
        bytes: 10,
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        kind: "ifc",
        sha256: "b".repeat(64),
        bytes: 20,
      },
    ],
    sourceAfter: [
      {
        id: "00000000-0000-4000-8000-000000000011",
        kind: "pdf",
        sha256: "a".repeat(64),
        bytes: 10,
      },
      {
        id: "00000000-0000-4000-8000-000000000012",
        kind: "ifc",
        sha256: "b".repeat(64),
        bytes: 20,
      },
    ],
    collaborationUrls: [new URL(hosted.P7_E2E_COLLABORATION_URL).toString()],
    offlineClientOperationId: "00000000-0000-4000-8000-000000000013",
    offlineOperationsAuthored: 1,
    offlineOperationsPersisted: 1,
    offlineLoss: 0,
    approvedImmutable: true,
    review: {
      decision: "reviewed",
      decidedBy: hosted.P7_E2E_COMMENTER_ID,
      authorId: hosted.P7_E2E_AUTHOR_ID,
    },
    approval: {
      decision: "approved",
      decidedBy: hosted.P7_E2E_APPROVER_ID,
      authorId: hosted.P7_E2E_AUTHOR_ID,
    },
    export: {
      requestId: "00000000-0000-4000-8000-000000000014",
      artifactType: "drawing_pdf",
      sha256: "c".repeat(64),
      byteSize: 30,
      auditActorId: hosted.P7_E2E_APPROVER_ID,
    },
    recordedAt: "2026-08-28T00:00:00.000Z",
  };
  const authority = runnerModule.requireP7ProductionAuthorities(hosted);
  assert.deepEqual(
    runnerModule.validateP7ProductionReceipt(
      receipt,
      authority,
      receipt.invocationId,
    ),
    receipt,
  );
  for (const bad of [
    { ...receipt, invocationId: "00000000-0000-4000-8000-000000000010" },
    { ...receipt, offlineLoss: 1 },
    { ...receipt, sourceAfter: [] },
    { ...receipt, approvedImmutable: false },
    { ...receipt, offlineClientOperationId: "not-a-uuid" },
    { ...receipt, collaborationUrls: ["wss://wrong.example.com"] },
    { ...receipt, roles: { ...receipt.roles, approver: "reviewer" } },
    {
      ...receipt,
      review: { ...receipt.review, decidedBy: hosted.P7_E2E_AUTHOR_ID },
    },
    {
      ...receipt,
      approval: { ...receipt.approval, decidedBy: hosted.P7_E2E_AUTHOR_ID },
    },
    { ...receipt, export: { ...receipt.export, requestId: "not-a-uuid" } },
  ])
    assert.throws(
      () =>
        runnerModule.validateP7ProductionReceipt(
          bad,
          authority,
          receipt.invocationId,
        ),
      /invocation|offline|source|immutable|role|independent review|independent approval|collaboration|export/i,
    );
});

test("P7 child receipts are repository-relative and cannot escape the checkout", () => {
  assert.equal(typeof evidenceModule.drawingP7ReceiptPath, "function");
  assert.equal(
    evidenceModule.drawingP7ReceiptPath(
      new URL(
        "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-gates/node.p0_p7.log",
        import.meta.url,
      ).pathname,
    ),
    ".superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-gates/node.p0_p7.log",
  );
  assert.throws(
    () => evidenceModule.drawingP7ReceiptPath("/tmp/forged-p7-receipt.json"),
    /outside repository/,
  );
});

test("P7 evidence binds to the latest authority-source commit, not documentation HEAD", () => {
  const expected = execFileSync(
    "git",
    [
      "log",
      "-1",
      "--format=%H",
      "--",
      "app",
      "collaboration",
      "e2e",
      "scripts",
      "supabase/migrations",
      "tests",
      "package.json",
      "package-lock.json",
      "THIRD_PARTY_NOTICES.md",
    ],
    { cwd: new URL("../", import.meta.url), encoding: "utf8" },
  ).trim();
  assert.equal(evidenceModule.drawingP7ReleaseCommit(), expected);
});

test("persisted mutable child logs cannot be rewritten into program PASS", () => {
  const persisted = withCurrentRequirementLedger(
    JSON.parse(readFileSync(evidenceModule.P7_RELEASE_EVIDENCE_PATH, "utf8")),
  );
  const receipt = persisted.requirements.find(
    (requirement) => requirement.receipt,
  ).receipt;
  const forged = structuredClone(persisted);
  for (const requirement of forged.requirements) {
    requirement.status = "PASS";
    requirement.receipt = structuredClone(receipt);
  }
  forged.summary = {
    PASS: forged.requirements.length,
    NOT_MET: 0,
    UNEXECUTED: 0,
  };
  forged.overall = "PASS";
  forged.externalInputs = 0;
  assert.throws(
    () =>
      evidenceModule.validateDrawingP7ReleaseEvidence(forged, {
        expectedCommit: forged.commit,
        expectedTreeSha256: forged.sourceTreeSha256,
      }),
    /persisted|external immutable|signed receipt|execution authority/i,
  );
});

test("release validation invokes the current Task4 semantic authority", () => {
  const persisted = withCurrentRequirementLedger(
    JSON.parse(readFileSync(evidenceModule.P7_RELEASE_EVIDENCE_PATH, "utf8")),
  );
  const performancePath = new URL(
    "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json",
    import.meta.url,
  );
  const original = readFileSync(performancePath);
  const mutated = JSON.parse(original);
  mutated.firstUsable.durationMs += 1;
  const mutatedBytes = Buffer.from(`${JSON.stringify(mutated, null, 2)}\n`);
  const evidence = structuredClone(persisted);
  const relativePath =
    ".superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json";
  for (const requirement of evidence.requirements) {
    if (requirement.receipt?.path !== relativePath) continue;
    requirement.receipt.sha256 = createHash("sha256")
      .update(mutatedBytes)
      .digest("hex");
  }
  try {
    writeFileSync(performancePath, mutatedBytes);
    assert.throws(
      () =>
        evidenceModule.validateDrawingP7ReleaseEvidence(evidence, {
          expectedCommit: evidence.commit,
          expectedTreeSha256: evidence.sourceTreeSha256,
        }),
      /Playwright capture authority|capture checksum|first usable/i,
    );
  } finally {
    writeFileSync(performancePath, original);
  }
});

test("production cannot exit zero while the combined local ledger is non-PASS", () => {
  assert.equal(typeof runnerModule.p7CombinedReleaseExitCode, "function");
  const local = evidenceModule.buildDrawingP7ReleaseEvidenceFixture();
  assert.equal(local.overall, "NOT_MET");
  assert.equal(
    runnerModule.p7CombinedReleaseExitCode(local, [
      { id: "production.p0_p6", status: "PASS", exitCode: 0 },
      { id: "production.real_postgres", status: "PASS", exitCode: 0 },
      { id: "production.managed_restore", status: "PASS", exitCode: 0 },
      { id: "production.three_users", status: "PASS", exitCode: 0 },
      { id: "production.telemetry", status: "PASS", exitCode: 0 },
    ]),
    1,
  );
});

test("release build authority combines all four typecheck and build gates fail closed", () => {
  const buildGateIds = [
    "application.typecheck_build",
    "application.build",
    "collaboration.typecheck_build",
    "collaboration.build",
  ];
  const expectedReceipts = buildGateIds.map(
    (id) =>
      `.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-gates/${id}.log`,
  );
  const makeEvidence = (failedId, failedStatus = "NOT_MET") =>
    runnerModule.buildReleaseEvidenceFromResults(
      buildGateIds.map((id) => ({
        id,
        status: id === failedId ? failedStatus : "PASS",
        exitCode: id === failedId ? 1 : 0,
      })),
      {
        coldCacheMiss: { status: "MET" },
        gates: { productionRuntime: "UNEXECUTED" },
        path: new URL(
          "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json",
          import.meta.url,
        ).pathname,
      },
      {
        status: "UNEXECUTED",
        path: new URL(
          "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-5-restore-evidence.json",
          import.meta.url,
        ).pathname,
      },
    );

  for (const failedId of buildGateIds) {
    const evidence = makeEvidence(failedId);
    const requirement = evidence.requirements.find(
      ({ id }) => id === "release.typecheck_build_collaboration",
    );
    assert.equal(requirement.status, "NOT_MET", failedId);
    assert.deepEqual(
      requirement.receipts.map(({ path }) => path),
      expectedReceipts,
      failedId,
    );
    assert.equal(evidence.overall, "NOT_MET", failedId);
    assert.equal(runnerModule.p7CombinedReleaseExitCode(evidence, []), 1);
  }

  const unexecuted = makeEvidence("collaboration.build", "UNEXECUTED");
  const requirement = unexecuted.requirements.find(
    ({ id }) => id === "release.typecheck_build_collaboration",
  );
  assert.equal(requirement.status, "UNEXECUTED");
  assert.equal(runnerModule.p7CombinedReleaseExitCode(unexecuted, []), 1);
});

test("missing managed provider authority stays UNEXECUTED while an executed miss is NOT_MET", () => {
  assert.equal(
    runnerModule.p7ProductionGateStatus("production.managed_restore", 2, {
      status: "UNEXECUTED",
    }),
    "UNEXECUTED",
  );
  assert.equal(
    runnerModule.p7ProductionGateStatus("production.managed_restore", 1, {
      status: "NOT_MET",
    }),
    "NOT_MET",
  );
  assert.equal(
    runnerModule.p7ProductionGateStatus("production.real_postgres", 1),
    "NOT_MET",
  );
});

test("an application-controlled HTTPS telemetry body cannot confer provider authority", async () => {
  assert.equal(typeof runnerModule.providerTelemetry, "function");
  const authority = runnerModule.requireP7ProductionAuthorities(hosted);
  await assert.rejects(
    runnerModule.providerTelemetry(authority),
    /UNEXECUTED.*trusted provider.*signed|immutable/i,
  );
});
