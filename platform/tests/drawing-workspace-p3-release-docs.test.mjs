import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import {
  parseDrawingCollaborationReplicaTargets,
  verifyDrawingCollaborationReplicaIdentity,
} from "../e2e/utils/drawing-collaboration-replica-targets.ts";

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

function extractAclAudit(deployment) {
  const match = deployment.match(
    /-- BEGIN P3 ACL AUDIT\n([\s\S]+?)\n-- END P3 ACL AUDIT/,
  );
  assert.ok(
    match,
    "P3 ACL audit must be extractable for runtime mutation tests",
  );
  return match[1];
}

function assertJwksRotationContract(deployment, smoke) {
  assert.match(deployment, /P3_COLLABORATION_REPLICAS_JSON/);
  assert.match(deployment, /P3_JWKS_NEW_KID/);
  assert.match(smoke, /for \(const replica of replicas\)/);
  assert.match(smoke, /replica\.websocketUrl/);
  assert.match(smoke, /target: replica/);
  assert.match(smoke, /expectedKid/);
  const margin = deployment.match(/JWKS_SAFETY_MARGIN_SECONDS=(\d+)/)?.[1];
  assert.ok(margin, "JWKS safety margin must be explicit");
  assert.ok(Number(margin) >= 900, "JWKS safety margin must be at least 900s");
}

test("P3 replica inventory and observed identities reject duplicates and aliases", () => {
  const valid = JSON.stringify([
    {
      id: "collab-a",
      websocketUrl: "wss://collab-a.example.test/socket",
      healthUrl: "https://collab-a.example.test/healthz",
    },
    {
      id: "collab-b",
      websocketUrl: "wss://collab-b.example.test/socket",
      healthUrl: "https://collab-b.example.test/healthz",
    },
  ]);
  const parsed = parseDrawingCollaborationReplicaTargets(valid, "new-kid");
  assert.equal(parsed.replicas.length, 2);

  for (const mutation of [
    valid.replace('"collab-b"', '"collab-a"'),
    valid.replace(
      "wss://collab-b.example.test/socket",
      "wss://collab-a.example.test/socket",
    ),
    valid.replace(
      "https://collab-b.example.test/healthz",
      "https://collab-a.example.test/healthz",
    ),
  ])
    assert.throws(
      () => parseDrawingCollaborationReplicaTargets(mutation, "new-kid"),
      /unique/,
    );

  const observed = new Set();
  verifyDrawingCollaborationReplicaIdentity({
    target: parsed.replicas[0],
    healthInstanceId: "collab-a",
    admissionInstanceId: "collab-a",
    observedInstanceIds: observed,
  });
  for (const mutation of [
    { healthInstanceId: "", admissionInstanceId: "collab-b" },
    { healthInstanceId: "collab-b", admissionInstanceId: "" },
    { healthInstanceId: "collab-other", admissionInstanceId: "collab-b" },
    { healthInstanceId: "collab-b", admissionInstanceId: "collab-other" },
    {
      healthInstanceId: "collab-other",
      admissionInstanceId: "collab-other",
    },
    { healthInstanceId: "collab-a", admissionInstanceId: "collab-a" },
  ])
    assert.throws(() =>
      verifyDrawingCollaborationReplicaIdentity({
        target: parsed.replicas[1],
        ...mutation,
        observedInstanceIds: observed,
      }),
    );
});

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
    "9. Operator rollback rehearsal",
    "10. Promote",
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
    "pg_get_function_identity_arguments",
    "aclexplode",
    "acldefault",
    "pg_default_acl",
    "lukas_drawing_collaboration_states",
    "lukas_drawing_collaboration_freeze_leases",
    "owner_token",
    "freeze_request_id",
    "missing publication",
    "lukas_qto_project_members",
  ])
    assert.match(p3, new RegExp(evidence, "i"), evidence);
  assert.doesNotMatch(p3, /information_schema\.role_(?:routine|table)_grants/i);

  for (const signature of [
    "lukas_drawing_collaboration_authorize|uuid, uuid, uuid",
    "lukas_drawing_collaboration_store_state|uuid, uuid, uuid, smallint, bytea, bigint, bigint, text",
    "lukas_drawing_collaboration_service_store_state|uuid, uuid, smallint, bytea, bigint, bigint, text",
    "lukas_drawing_collaboration_acquire_freeze_lease|uuid, uuid, uuid, uuid, integer, bytea, bigint",
    "lukas_drawing_collaboration_complete_freeze|uuid, uuid, uuid, bytea, jsonb, text, integer, bigint, text, jsonb, uuid",
  ]) {
    const [name, args] = signature.split("|");
    assert.match(p3, new RegExp(`${name}[\\s\\S]{0,120}${args}`), signature);
  }
  for (const forbidden of [
    "PUBLIC",
    "anon",
    "authenticated",
    "service_role",
    "lukas_drawing_collaboration_runtime",
  ])
    assert.match(p3, new RegExp(forbidden), forbidden);

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
  ])
    assert.match(p3, new RegExp(authority), authority);
  assert.doesNotMatch(p3, /supabase db dump[^\n]*--schema-only/);

  assertOrdered(p3, [
    "create asymmetric standby key",
    "new kid",
    "rotate the signing key",
    "fresh access token",
    "purge each replica",
    "authenticated room admission on every replica",
    "access-token lifetime plus the safety margin",
    "revoke the previous key",
  ]);
  assert.match(p3, /restore the previous key.*if.*fails/is);

  assert.match(p3, /stop new room admission/i);
  assert.match(p3, /flush.*await.*Hocuspocus/is);
  assert.match(p3, /retain.*operation.*snapshot/is);
  assert.match(p3, /forward-fix migration/i);
  assert.match(p3, /backup restore.*approved incident/is);
  assert.match(p3, /frozen.*in-flight.*rejected review/is);
});

test("P3 ACL audit exposes built-in PUBLIC execute when owner hardening is removed", async () => {
  const deployment = await read("DEPLOYMENT.md");
  const audit = extractAclAudit(deployment);
  const database = new PGlite();
  try {
    await database.exec(`
      create schema private;
      create role lukas_drawing_collaboration nologin noinherit;
      create table private.lukas_drawing_collaboration_states (id uuid);
      create table private.lukas_drawing_collaboration_freeze_leases (id uuid);
      alter default privileges for role postgres
        revoke execute on functions from public;
    `);
    const hardened = await database.query(audit);
    assert.equal(
      hardened.rows.some(
        (row) =>
          row.violation === "forbidden default ACL" &&
          row.object_name === "function" &&
          row.grantee_name === "PUBLIC",
      ),
      false,
    );

    await database.exec(`
      alter default privileges for role postgres
        grant execute on functions to public;
    `);
    const defaultRows = await database.query(`
      select count(*)::int as count
      from pg_catalog.pg_default_acl d
      join pg_catalog.pg_roles r on r.oid = d.defaclrole
      where r.rolname = 'postgres' and d.defaclobjtype = 'f'
    `);
    assert.equal(defaultRows.rows[0].count, 0);
    const mutated = await database.query(audit);
    assert.equal(
      mutated.rows.some(
        (row) =>
          row.violation === "forbidden default ACL" &&
          row.object_name === "function" &&
          row.grantee_name === "PUBLIC",
      ),
      true,
    );
  } finally {
    await database.close();
  }
});

test("P3 service smoke is executable and matches endpoint authentication contracts", async () => {
  const [
    deployment,
    packageJson,
    smoke,
    server,
    config,
    replicaTargets,
    freeze,
    workspaceServer,
  ] = await Promise.all([
    read("DEPLOYMENT.md"),
    read("package.json").then(JSON.parse),
    read("e2e/drawing-collaboration-service-smoke.spec.ts"),
    read("collaboration/src/server.ts"),
    read("collaboration/src/config.ts"),
    read("e2e/utils/drawing-collaboration-replica-targets.ts"),
    read("collaboration/src/freeze.ts"),
    read("app/lukas/lib/drawing-workspace.server.ts"),
  ]);
  const p3 = deployment.slice(
    deployment.indexOf("## Drawing Workspace P3 release runbook"),
  );

  assert.equal(
    packageJson.scripts["smoke:drawing-collaboration:production"],
    "playwright test e2e/drawing-collaboration-service-smoke.spec.ts --project=chromium --workers=1",
  );
  assert.match(p3, /npm run smoke:drawing-collaboration:production/);
  for (const boundary of [
    "authenticated admission",
    "non-member rejection",
    "store/reload",
    "outcome receipt",
    "freeze/release",
    "restart",
    "SIGTERM drain",
  ])
    assert.match(smoke, new RegExp(boundary, "i"), boundary);
  assert.doesNotMatch(smoke, /test\.skip|\.skip\(/);
  assert.equal(smoke.match(/await connection\.waitForClose\(\)/g)?.length, 1);
  assert.equal(smoke.match(/await afterRestart\.waitForClose\(\)/g)?.length, 1);

  assert.match(server, /x-1hk-signature/);
  assert.match(server, /x-1hk-freeze-secret/);
  assert.match(server, /createHmac\("sha256"/);
  assert.match(server, /timingSafeEqual\(expected, supplied\)/);
  assert.match(config, /COLLABORATION_INSTANCE_ID/);
  assert.match(server, /type: "1hk-collaboration-admission"/);
  assert.match(server, /instanceId: dependencies\.config\.instanceId/);
  assert.ok(
    server.match(/instanceId: dependencies\.config\.instanceId/g)?.length >= 4,
    "instance identity must be returned by admission and every health state",
  );
  assert.match(smoke, /requireReplicaHealth\(replica\)/);
  assert.match(smoke, /requireAdmissionInstanceId\(\)/);
  assert.match(smoke, /verifyDrawingCollaborationReplicaIdentity/);
  assert.match(replicaTargets, /healthInstanceId !== admissionInstanceId/);
  assert.match(replicaTargets, /healthInstanceId !== target\.id/);
  assert.match(replicaTargets, /observedInstanceIds\.has\(healthInstanceId\)/);
  assert.match(freeze, /timingSafeEqual\(expected, comparable\)/);
  assert.match(workspaceServer, /createHmac\("sha256"/);
  assert.match(workspaceServer, /"x-1hk-signature": signature/);
  assert.match(workspaceServer, /"x-1hk-freeze-secret": secret/);
  assert.match(p3, /outcomes.*HMAC-SHA-256.*x-1hk-signature/is);
  assert.match(p3, /freeze.*constant-time.*bearer.*x-1hk-freeze-secret/is);

  assertJwksRotationContract(p3, smoke);
  assert.throws(() =>
    assertJwksRotationContract(
      p3,
      smoke.replace(
        "for (const replica of replicas)",
        "for (const replica of [])",
      ),
    ),
  );
  assert.throws(() =>
    assertJwksRotationContract(
      p3.replace(
        "JWKS_SAFETY_MARGIN_SECONDS=900",
        "JWKS_SAFETY_MARGIN_SECONDS=899",
      ),
      smoke,
    ),
  );
});

test("P3 service smoke fails closed before Playwright when authorities are absent", () => {
  const env = { ...process.env };
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
    "P3_COLLABORATION_SIGTERM_COMMAND_JSON",
    "P3_COLLABORATION_RESTART_COMMAND_JSON",
    "P3_COLLABORATION_REPLICAS_JSON",
    "P3_JWKS_NEW_KID",
  ])
    delete env[authority];
  const result = spawnSync(
    "npm",
    ["run", "smoke:drawing-collaboration:production"],
    {
      cwd: new URL("../", import.meta.url),
      env,
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /UNEXECUTED/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /Local:\s+http/);

  const missingReplicaInventory = spawnSync(
    "npm",
    ["run", "smoke:drawing-collaboration:production"],
    {
      cwd: new URL("../", import.meta.url),
      env: {
        PATH: process.env.PATH,
        E2E_BASE_URL: "https://p3-app.invalid",
        SUPABASE_URL: "https://round2fixture.supabase.co",
        SUPABASE_ANON_KEY: "anon-round2-credential-value-1234567890",
        SUPABASE_SERVICE_ROLE_KEY: "service-round2-credential-value-1234567890",
        VITE_DRAWING_COLLABORATION_URL: "wss://p3-collab.invalid",
        COLLABORATION_INTERNAL_URL: "https://p3-collab.invalid",
        COLLABORATION_INTERNAL_SECRET:
          "internal-round2-credential-value-1234567890",
        COLLABORATION_FREEZE_SECRET:
          "freeze-round2-credential-value-123456789012",
        P3_E2E_DATABASE_ADMIN_URL:
          "postgresql://operator:secret@p3-db.invalid/postgres",
        P3_E2E_RUN_ID: "round2-abcdef12",
        P3_COLLABORATION_SIGTERM_COMMAND_JSON: '["/usr/bin/true"]',
        P3_COLLABORATION_RESTART_COMMAND_JSON: '["/usr/bin/true"]',
      },
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  const inventoryOutput = `${missingReplicaInventory.stdout}\n${missingReplicaInventory.stderr}`;
  assert.notEqual(missingReplicaInventory.status, 0);
  assert.match(inventoryOutput, /P3_COLLABORATION_REPLICAS_JSON is UNEXECUTED/);
  assert.doesNotMatch(inventoryOutput, /Running \d+ tests|Local:\s+http/);
});

test("P3 rollout stays single-replica and rollback evidence is a separate operator gate", async () => {
  const [deployment, productionSpec] = await Promise.all([
    read("DEPLOYMENT.md"),
    read("e2e/drawing-workspace-p3.spec.ts"),
  ]);
  const p3 = deployment.slice(
    deployment.indexOf("## Drawing Workspace P3 release runbook"),
  );
  const fixtureStage = p3.slice(
    p3.indexOf("### 8. P3 production fixture"),
    p3.indexOf("### 9. Operator rollback rehearsal"),
  );

  assert.match(p3, /initial release.*exactly one replica/is);
  assert.match(
    p3,
    /ordinary sticky sessions.*(?:insufficient|not sufficient)/is,
  );
  assert.match(p3, /deterministic canonical-room affinity.*failover/is);
  assert.match(p3, /shared Yjs\/Awareness broadcast/is);
  assert.match(p3, /multi-replica two-client smoke/is);
  assert.doesNotMatch(fixtureStage, /rollback rehearsal/i);
  assert.doesNotMatch(productionSpec, /rollback rehearsal/i);
  assert.match(p3, /### 9\. Operator rollback rehearsal/);
  assert.match(p3, /stop new room admission.*previous.*image.*reopen/is);
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
  assert.doesNotMatch(
    report,
    /P3 (?:operational|production) (?:complete|PASS)/i,
  );
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
