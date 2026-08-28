import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  P7_RELEASE_EVIDENCE_PATH,
  P7_REQUIREMENTS,
  drawingP7ReceiptPath,
  drawingP7ReleaseCommit,
  drawingP7ReleaseTreeSha256,
  writeDrawingP7ReleaseEvidence,
} from "./drawing-p7-release-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifactRoot = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-gates/",
    import.meta.url,
  ),
);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function manifest() {
  return [
    {
      id: "node.p0_p7",
      argv: ["npm", "run", "test:drawing-workspace"],
    },
    {
      id: "database.pglite",
      argv: [
        "node",
        "--test",
        "tests/drawing-workspace-database-runtime.test.mjs",
        "tests/drawing-workspace-p7-library-database.test.mjs",
        "tests/drawing-workspace-p7-retention-database.test.mjs",
        "tests/drawing-workspace-p7-organization-admin-database.test.mjs",
      ],
    },
    {
      id: "database.real_postgres",
      argv: [
        "env",
        "P7_REAL_POSTGRES_REQUIRED=1",
        "DRAWING_P7_REQUIRE_REAL_POSTGRES=1",
        "node",
        "--test",
        "tests/drawing-workspace-p7-retention-database.test.mjs",
        "tests/drawing-workspace-p7-organization-admin-database.test.mjs",
      ],
    },
    {
      id: "browser.desktop_tablet",
      argv: [
        "./node_modules/.bin/playwright",
        "test",
        "e2e/drawing-workspace-p7-release.spec.ts",
        "--config=playwright.p7-release.config.ts",
        "--project=chromium",
        "--workers=1",
      ],
    },
    {
      id: "collaboration.service",
      argv: [
        "node",
        "--test",
        "tests/drawing-collaboration-protocol.test.mjs",
        "tests/drawing-collaboration-service.test.mjs",
        "tests/drawing-workspace-p3-social.test.mjs",
        "tests/drawing-yjs-draft.test.mjs",
      ],
    },
    {
      id: "source.pdf_ifc",
      argv: [
        "node",
        "--test",
        "tests/drawing-source-lifecycle.test.mjs",
        "tests/drawing-pdf-revision-diff.test.mjs",
        "tests/drawing-ifc-focus.test.mjs",
        "tests/drawing-workspace-p5-server.test.mjs",
      ],
    },
    {
      id: "lineage.boq_material",
      argv: [
        "node",
        "--test",
        "tests/drawing-quantity-lineage.test.mjs",
        "tests/drawing-quantity-lineage-server.test.mjs",
        "tests/verified-boq-v1-1.test.mjs",
        "tests/verified-boq.test.mjs",
      ],
    },
    {
      id: "performance.source_bound",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p7:performance"],
    },
    {
      id: "retention.restore",
      argv: [
        "node",
        "--test",
        "tests/drawing-workspace-p7-restore.test.mjs",
        "tests/drawing-workspace-p7-export-audit.test.mjs",
        "tests/drawing-workspace-p7-retention-route.test.mjs",
      ],
    },
    {
      id: "organization.rls_entitlements",
      argv: [
        "node",
        "--test",
        "tests/drawing-workspace-p7-library-route.test.mjs",
        "tests/drawing-workspace-p7-organization-admin-route.test.mjs",
      ],
    },
    {
      id: "license.closure",
      argv: ["node", "--test", "tests/drawing-workspace-license.test.mjs"],
    },
    {
      id: "application.typecheck_build",
      argv: ["npm", "run", "typecheck"],
    },
    {
      id: "collaboration.typecheck_build",
      argv: ["npm", "run", "typecheck:collaboration"],
    },
    { id: "application.build", argv: ["npm", "run", "build"] },
    { id: "collaboration.build", argv: ["npm", "run", "build:collaboration"] },
    { id: "diff.check", argv: ["git", "--no-pager", "diff", "--check"] },
  ];
}

export const P7_RELEASE_GATES = Object.freeze(manifest());

export function assertExactP7GateManifest(gates) {
  if (!isDeepStrictEqual(gates, manifest()))
    throw new Error(
      "P7 release manifest does not match the exact gate contract",
    );
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value)
    throw new Error(`P7 release gate is UNEXECUTED: ${name} is required`);
  return value;
}

function hostedUrl(value, name, protocols) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`P7 release gate is UNEXECUTED: ${name} is invalid`);
  }
  if (
    !protocols.includes(parsed.protocol) ||
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname) ||
    parsed.hostname.endsWith(".test") ||
    parsed.hostname.includes("example")
  )
    throw new Error(`P7 release gate is UNEXECUTED: ${name} must be hosted`);
  return parsed;
}

function realIdentity(environment, prefix) {
  const idName = `P7_E2E_${prefix}_ID`;
  const emailName = `P7_E2E_${prefix}_EMAIL`;
  const id = required(environment, idName).toLowerCase();
  const email = required(environment, emailName).toLowerCase();
  if (!uuid.test(id))
    throw new Error(`P7 release gate is UNEXECUTED: ${idName} is invalid`);
  if (
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
    /(?:^|[+._-])(fixture|local|test|dummy|example)(?:[+._@-]|$)/i.test(
      email,
    ) ||
    email.endsWith("@example.test")
  )
    throw new Error(
      `P7 release gate is UNEXECUTED: ${emailName} must be a real production identity`,
    );
  return { id, email };
}

export function requireP7ProductionAuthorities(environment = process.env) {
  const baseUrl = hostedUrl(
    required(environment, "P7_E2E_BASE_URL"),
    "P7_E2E_BASE_URL",
    ["https:"],
  );
  const supabaseUrl = hostedUrl(
    required(environment, "P7_E2E_SUPABASE_URL"),
    "P7_E2E_SUPABASE_URL",
    ["https:"],
  );
  if (!supabaseUrl.hostname.endsWith(".supabase.co"))
    throw new Error(
      "P7 release gate is UNEXECUTED: P7_E2E_SUPABASE_URL must be managed Supabase",
    );
  const anonKey = required(environment, "P7_E2E_SUPABASE_ANON_KEY");
  const serviceRoleKey = required(
    environment,
    "P7_E2E_SUPABASE_SERVICE_ROLE_KEY",
  );
  if (
    anonKey.length < 32 ||
    serviceRoleKey.length < 32 ||
    anonKey === serviceRoleKey
  )
    throw new Error(
      "P7 release gate is UNEXECUTED: hosted Supabase keys are invalid",
    );
  const postgresUrl = hostedUrl(
    required(environment, "P7_E2E_POSTGRES_URL"),
    "P7_E2E_POSTGRES_URL",
    ["postgres:", "postgresql:"],
  );
  const collaborationUrl = hostedUrl(
    required(environment, "P7_E2E_COLLABORATION_URL"),
    "P7_E2E_COLLABORATION_URL",
    ["wss:"],
  );
  const telemetryUrl = hostedUrl(
    required(environment, "P7_E2E_TELEMETRY_URL"),
    "P7_E2E_TELEMETRY_URL",
    ["https:"],
  );
  const telemetryToken = required(environment, "P7_E2E_TELEMETRY_TOKEN");
  if (
    telemetryToken.length < 32 ||
    /placeholder|dummy|local|example/i.test(telemetryToken)
  )
    throw new Error(
      "P7 release gate is UNEXECUTED: P7_E2E_TELEMETRY_TOKEN is invalid",
    );
  const commit = required(environment, "P7_E2E_COMMIT");
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error("P7 release gate is UNEXECUTED: P7_E2E_COMMIT is invalid");
  const deploymentId = required(environment, "P7_E2E_DEPLOYMENT_ID");
  const region = required(environment, "P7_E2E_REGION");
  const runId = required(environment, "P7_E2E_RUN_ID");
  if (
    !/^[a-z0-9](?:[a-z0-9-]{6,62}[a-z0-9])$/.test(runId) ||
    /fixture|local|test|dummy|example/i.test(runId)
  )
    throw new Error("P7 release gate is UNEXECUTED: P7_E2E_RUN_ID is invalid");
  const ids = Object.fromEntries(
    ["PROJECT", "DOCUMENT", "REVISION", "FILE", "LAYER"].map((name) => {
      const envName = `P7_E2E_${name}_ID`;
      const value = required(environment, envName).toLowerCase();
      if (!uuid.test(value))
        throw new Error(`P7 release gate is UNEXECUTED: ${envName} is invalid`);
      return [name.toLowerCase(), value];
    }),
  );
  const identities = [
    realIdentity(environment, "AUTHOR"),
    realIdentity(environment, "COMMENTER"),
    realIdentity(environment, "APPROVER"),
  ];
  if (
    new Set(identities.map(({ id }) => id)).size !== 3 ||
    new Set(identities.map(({ email }) => email)).size !== 3
  )
    throw new Error(
      "P7 release gate is UNEXECUTED: three production identities must be distinct",
    );
  return {
    baseUrl,
    supabaseUrl,
    postgresUrl,
    collaborationUrl,
    telemetryUrl,
    telemetryToken,
    anonKey,
    serviceRoleKey,
    commit,
    deploymentId,
    region,
    runId,
    identities,
    ...ids,
  };
}

export function validateP7ProductionReceipt(receipt, authority, invocationId) {
  if (
    receipt?.schemaVersion !== 1 ||
    receipt.authority !== "P7_MOUNTED_PRODUCTION_PLAYWRIGHT_V1"
  )
    throw new Error("P7 production receipt authority is invalid");
  if (receipt.invocationId !== invocationId)
    throw new Error("P7 production receipt invocation mismatch");
  if (
    receipt.runId !== authority.runId ||
    receipt.commit !== authority.commit ||
    receipt.deploymentId !== authority.deploymentId ||
    receipt.projectId !== authority.project ||
    receipt.documentId !== authority.document ||
    receipt.revisionId !== authority.revision
  )
    throw new Error(
      "P7 production receipt deployment or mounted route mismatch",
    );
  if (!isDeepStrictEqual(receipt.identities, authority.identities))
    throw new Error("P7 production receipt identity mismatch");
  if (
    !Array.isArray(receipt.sourceBefore) ||
    receipt.sourceBefore.length < 2 ||
    !receipt.sourceBefore.some(({ kind }) => kind === "pdf") ||
    !receipt.sourceBefore.some(({ kind }) => kind === "ifc") ||
    !isDeepStrictEqual(receipt.sourceBefore, receipt.sourceAfter)
  )
    throw new Error("P7 production PDF/IFC source SHA evidence changed");
  if (
    receipt.offlineLoss !== 0 ||
    receipt.offlineOperationsAuthored < 1 ||
    receipt.offlineOperationsPersisted !== receipt.offlineOperationsAuthored
  )
    throw new Error("P7 production offline operation loss is nonzero");
  if (receipt.approvedImmutable !== true)
    throw new Error(
      "P7 production approved revision immutable authority failed",
    );
  if (
    receipt.export?.auditActorId !== authority.identities[2].id ||
    !/^[0-9a-f]{64}$/.test(receipt.export?.sha256 ?? "") ||
    !(receipt.export?.byteSize > 0)
  )
    throw new Error("P7 production export audit evidence is invalid");
  if (Number.isNaN(Date.parse(receipt.recordedAt)))
    throw new Error("P7 production receipt timestamp is invalid");
  return receipt;
}

async function execute({ argv }, environment = process.env) {
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: root,
      env: {
        ...environment,
        GIT_PAGER: "cat",
        GIT_TERMINAL_PROMPT: "0",
        PAGER: "cat",
      },
      shell: false,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      signal
        ? reject(new Error(`P7 gate terminated by ${signal}`))
        : resolve(code ?? 1),
    );
  });
}

async function executeWithEnvironment(argv, environment) {
  return execute({ argv }, environment);
}

async function providerTelemetry(authority) {
  const response = await fetch(authority.telemetryUrl, {
    headers: {
      Authorization: `Bearer ${authority.telemetryToken}`,
      Accept: "application/json",
    },
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(
      `P7 provider runtime telemetry is UNEXECUTED: ${response.status}`,
    );
  const receipt = JSON.parse(body);
  const receiptSha = response.headers.get("x-evidence-sha256")?.toLowerCase();
  if (
    receipt.commit !== authority.commit ||
    receipt.deploymentId !== authority.deploymentId ||
    receipt.region !== authority.region ||
    !/^[A-Za-z0-9_-]{8,}$/.test(
      response.headers.get("x-provider-request-id") ?? "",
    ) ||
    !/^[0-9a-f]{64}$/i.test(receiptSha ?? "") ||
    createHash("sha256").update(body).digest("hex") !== receiptSha
  )
    throw new Error(
      "P7 provider runtime telemetry is UNEXECUTED: unsigned or deployment-mismatched receipt",
    );
  for (const [name, value] of Object.entries({
    coldFirstUsableP95Ms: receipt.metrics?.coldFirstUsableP95Ms,
    collaborationP95Ms: receipt.metrics?.collaborationP95Ms,
    peakRssMiB: receipt.metrics?.peakRssMiB,
    cpuMs: receipt.metrics?.cpuMs,
  }))
    if (!Number.isFinite(value) || value < 0)
      throw new Error(`P7 provider runtime telemetry is NOT_MET: ${name}`);
  if (
    receipt.metrics.coldFirstUsableP95Ms > 2_500 ||
    receipt.metrics.collaborationP95Ms > 500
  )
    throw new Error(
      "P7 provider runtime telemetry is NOT_MET: startup or collaboration p95",
    );
  return receipt;
}

export async function runP7Gates(gates, runner = execute) {
  const results = [];
  for (const gate of gates) {
    const exitCode = await runner(gate);
    results.push({
      id: gate.id,
      status: exitCode === 0 ? "PASS" : "NOT_MET",
      exitCode,
    });
  }
  return results;
}

function fileReceipt(path) {
  return {
    path: drawingP7ReceiptPath(path),
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
  };
}

function gateRequirementIds(gateId) {
  const mapping = {
    "node.p0_p7": P7_REQUIREMENTS.filter(({ scope }) => scope === "local").map(
      ({ id }) => id,
    ),
    "browser.desktop_tablet": [
      "p7.current_default_workspace",
      "p7.desktop_1280x720",
      "p7.tablet_portrait_landscape",
      "p7.touch_focus_accessibility",
    ],
    "collaboration.service": [
      "p3.yjs_indexeddb_hocuspocus",
      "p3.awareness_locks_mentions_history",
    ],
    "source.pdf_ifc": [
      "p5.pdf_ifc_split_cross_select",
      "p5.revision_diff_anchor_relink",
    ],
    "lineage.boq_material": [
      "p6.object_quantity_boq_material_lineage",
      "p6.approved_exports",
    ],
    "performance.source_bound": [
      "performance.10k_deterministic",
      "performance.warm_interaction",
      "performance.warm_reopen",
    ],
    "retention.restore": ["p7.retention_archive_legal_hold"],
    "organization.rls_entitlements": [
      "p7.organization_library_provenance",
      "p7.organization_admin_entitlements",
    ],
    "license.closure": [
      "release.license_lock_notices",
      "release.no_rayon_assets_or_copy",
    ],
    "application.typecheck_build": ["release.typecheck_build_collaboration"],
  };
  return mapping[gateId] ?? [];
}

export function buildReleaseEvidenceFromResults(
  results,
  performance,
  restore,
  invocationId = randomUUID(),
) {
  const requirements = P7_REQUIREMENTS.map(({ id, scope }) => {
    let status = scope === "production" ? "UNEXECUTED" : "PASS";
    let authority =
      scope === "production"
        ? "production authority not supplied"
        : "complete current local gate matrix";
    let receipt = null;
    for (const result of results) {
      if (!gateRequirementIds(result.id).includes(id)) continue;
      if (result.status !== "PASS") status = "NOT_MET";
      const path = `${artifactRoot}${result.id}.log`;
      if (result.status === "PASS") receipt = fileReceipt(path);
      authority = result.id;
    }
    if (id === "performance.cold_startup") {
      status = performance.coldCacheMiss.status === "MET" ? "PASS" : "NOT_MET";
      authority = "source-bound P7 production-build Chromium cold cache-miss";
      receipt = fileReceipt(performance.path);
    }
    if (id === "performance.hosted_runtime") {
      status =
        performance.gates.productionRuntime === "MET" ? "PASS" : "UNEXECUTED";
      authority = "hosted runtime performance receipt";
      receipt = status === "PASS" ? fileReceipt(performance.path) : null;
    }
    if (
      id === "retention.managed_backup_restore" ||
      id === "retention.rpo_rto"
    ) {
      status = restore.status === "PASS" ? "PASS" : "UNEXECUTED";
      authority = "managed Supabase backup isolated restore comparison";
      receipt = status === "PASS" ? fileReceipt(restore.path) : null;
    }
    return { id, scope, status, authority, receipt };
  });
  const summary = { PASS: 0, NOT_MET: 0, UNEXECUTED: 0 };
  for (const row of requirements) summary[row.status] += 1;
  const overall =
    summary.NOT_MET > 0
      ? "NOT_MET"
      : summary.UNEXECUTED > 0
        ? "UNEXECUTED"
        : "PASS";
  return {
    schemaVersion: 1,
    commit: drawingP7ReleaseCommit(),
    sourceTreeSha256: drawingP7ReleaseTreeSha256(),
    generatedAt: new Date().toISOString(),
    runner: {
      name: "P7_FAIL_CLOSED_RELEASE_RUNNER_V1",
      sha256: createHash("sha256")
        .update(readFileSync(fileURLToPath(import.meta.url)))
        .digest("hex"),
      invocationId,
    },
    requirements,
    summary,
    overall,
    externalInputs: requirements.filter(
      ({ scope, status }) => scope === "production" && status !== "PASS",
    ).length,
  };
}

async function collectLocal() {
  assertExactP7GateManifest(P7_RELEASE_GATES);
  mkdirSync(artifactRoot, { recursive: true });
  const results = [];
  for (const gate of P7_RELEASE_GATES) {
    const logPath = `${artifactRoot}${gate.id}.log`;
    const chunks = [];
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(gate.argv[0], gate.argv.slice(1), {
        cwd: root,
        env: {
          ...process.env,
          GIT_PAGER: "cat",
          GIT_TERMINAL_PROMPT: "0",
          PAGER: "cat",
        },
        shell: false,
      });
      for (const stream of [child.stdout, child.stderr])
        stream.on("data", (chunk) => {
          chunks.push(chunk);
          process.stdout.write(chunk);
        });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    writeFileSync(logPath, Buffer.concat(chunks));
    const missingRealPg =
      gate.id === "database.real_postgres" &&
      !process.env.DRAWING_P7_REAL_DATABASE_URL;
    results.push({
      id: gate.id,
      status:
        exitCode === 0 ? "PASS" : missingRealPg ? "UNEXECUTED" : "NOT_MET",
      exitCode,
    });
  }
  const performancePath = fileURLToPath(
    new URL(
      "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json",
      import.meta.url,
    ),
  );
  const restorePath = fileURLToPath(
    new URL(
      "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-5-restore-evidence.json",
      import.meta.url,
    ),
  );
  const performance = {
    ...JSON.parse(readFileSync(performancePath, "utf8")),
    path: performancePath,
  };
  const restore = {
    ...JSON.parse(readFileSync(restorePath, "utf8")),
    path: restorePath,
  };
  const evidence = buildReleaseEvidenceFromResults(
    results,
    performance,
    restore,
  );
  writeDrawingP7ReleaseEvidence(evidence);
  process.stdout.write(
    `P7 ${evidence.overall}: ${JSON.stringify(evidence.summary)}; external inputs ${evidence.externalInputs}\n`,
  );
  return evidence.overall === "PASS" ? 0 : 1;
}

async function main(mode) {
  if (mode === "authority-check") {
    requireP7ProductionAuthorities(process.env);
    return 0;
  }
  if (mode === "local") return collectLocal();
  if (mode !== "production")
    throw new Error(
      "Usage: run-drawing-workspace-p7-release.mjs local|production|authority-check",
    );
  const authority = requireP7ProductionAuthorities(process.env);
  await collectLocal();
  const invocationId = randomUUID();
  mkdirSync(artifactRoot, { recursive: true });
  const rawPath = `${artifactRoot}production-${invocationId}.json.tmp`;
  const productionResults = [];
  for (const gate of [
    {
      id: "production.p0_p6",
      argv: ["npm", "run", "release:drawing-workspace-p6:production"],
    },
    {
      id: "production.real_postgres",
      argv: [
        "env",
        "P7_REAL_POSTGRES_REQUIRED=1",
        "DRAWING_P7_REQUIRE_REAL_POSTGRES=1",
        "node",
        "--test",
        "tests/drawing-workspace-p7-retention-database.test.mjs",
        "tests/drawing-workspace-p7-organization-admin-database.test.mjs",
      ],
    },
    {
      id: "production.managed_restore",
      argv: ["npm", "run", "release:drawing-workspace-p7:restore"],
    },
    {
      id: "production.three_users",
      argv: [
        "./node_modules/.bin/playwright",
        "test",
        "e2e/drawing-workspace-p7-production.spec.ts",
        "--project=chromium",
        "--workers=1",
      ],
    },
  ]) {
    const environment = {
      ...process.env,
      E2E_BASE_URL: authority.baseUrl.origin,
      SUPABASE_URL: authority.supabaseUrl.origin,
      SUPABASE_ANON_KEY: authority.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: authority.serviceRoleKey,
      VITE_DRAWING_COLLABORATION_URL: authority.collaborationUrl.toString(),
      DRAWING_P7_REAL_DATABASE_URL: authority.postgresUrl.toString(),
      P7_PRODUCTION_RAW_EVIDENCE_PATH: rawPath,
      P7_PRODUCTION_INVOCATION_ID: invocationId,
    };
    const exitCode = await executeWithEnvironment(gate.argv, environment);
    productionResults.push({
      id: gate.id,
      status: exitCode === 0 ? "PASS" : "NOT_MET",
      exitCode,
    });
    writeFileSync(
      `${artifactRoot}${gate.id}.log`,
      `${JSON.stringify({ invocationId, argv: gate.argv, exitCode, recordedAt: new Date().toISOString() })}\n`,
    );
  }
  let telemetryStatus = "PASS";
  try {
    const telemetry = await providerTelemetry(authority);
    writeFileSync(
      `${artifactRoot}production.telemetry.log`,
      `${JSON.stringify(telemetry, null, 2)}\n`,
    );
  } catch (error) {
    telemetryStatus = String(error).includes("UNEXECUTED")
      ? "UNEXECUTED"
      : "NOT_MET";
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  productionResults.push({
    id: "production.telemetry",
    status: telemetryStatus,
    exitCode: telemetryStatus === "PASS" ? 0 : 1,
  });
  const threeUsers = productionResults.find(
    ({ id }) => id === "production.three_users",
  );
  if (threeUsers?.status === "PASS") {
    const receipt = validateP7ProductionReceipt(
      JSON.parse(readFileSync(rawPath, "utf8")),
      authority,
      invocationId,
    );
    writeFileSync(
      `${artifactRoot}production.three-users.json`,
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
  }
  const failed = productionResults.filter(({ status }) => status !== "PASS");
  const baseEvidence = JSON.parse(
    readFileSync(P7_RELEASE_EVIDENCE_PATH, "utf8"),
  );
  const productionStatus = (id) =>
    productionResults.find((result) => result.id === id)?.status ??
    "UNEXECUTED";
  const receiptFor = (path, status) =>
    status === "PASS" ? fileReceipt(path) : null;
  const threeUserReceipt = `${artifactRoot}production.three-users.json`;
  const restoreReceipt = fileURLToPath(
    new URL(
      "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-5-restore-evidence.json",
      import.meta.url,
    ),
  );
  const realPgReceipt = `${artifactRoot}production.real_postgres.log`;
  const telemetryReceipt = `${artifactRoot}production.telemetry.log`;
  for (const row of baseEvidence.requirements) {
    let status = row.status;
    let path = null;
    if (
      [
        "source.pdf_ifc_sha_immutable",
        "p3.offline_zero_loss",
        "collaboration.hosted_service",
        "production.three_real_users",
        "production.mounted_route_actions",
        "production.export_audit",
      ].includes(row.id)
    ) {
      status = productionStatus("production.three_users");
      path = threeUserReceipt;
    } else if (
      [
        "security.real_postgres_rls",
        "security.approved_revision_immutable",
      ].includes(row.id)
    ) {
      status = productionStatus("production.real_postgres");
      path = realPgReceipt;
    } else if (
      ["retention.managed_backup_restore", "retention.rpo_rto"].includes(row.id)
    ) {
      status = productionStatus("production.managed_restore");
      path = restoreReceipt;
    } else if (row.id === "performance.hosted_runtime") {
      status = productionStatus("production.telemetry");
      path = telemetryReceipt;
    }
    if (path) {
      row.status = status;
      row.receipt = receiptFor(path, status);
      row.authority = `P7 production ${row.id}`;
    }
  }
  baseEvidence.summary = { PASS: 0, NOT_MET: 0, UNEXECUTED: 0 };
  for (const row of baseEvidence.requirements)
    baseEvidence.summary[row.status] += 1;
  baseEvidence.overall =
    baseEvidence.summary.NOT_MET > 0
      ? "NOT_MET"
      : baseEvidence.summary.UNEXECUTED > 0
        ? "UNEXECUTED"
        : "PASS";
  baseEvidence.externalInputs = baseEvidence.requirements.filter(
    ({ scope, status }) => scope === "production" && status !== "PASS",
  ).length;
  baseEvidence.generatedAt = new Date().toISOString();
  writeDrawingP7ReleaseEvidence(baseEvidence);
  if (failed.length)
    throw new Error(
      `P7 production gate is ${failed.some(({ status }) => status === "NOT_MET") ? "NOT_MET" : "UNEXECUTED"}: ${failed.map(({ id, status }) => `${id}=${status}`).join(", ")}`,
    );
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv[2]).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 2;
    },
  );
