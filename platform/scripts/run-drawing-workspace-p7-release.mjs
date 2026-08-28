import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import {
  P7_RELEASE_EVIDENCE_PATH,
  P7_REQUIREMENTS,
  drawingP7ReceiptPath,
  drawingP7ReleaseCommit,
  drawingP7ReleaseTreeSha256,
  loadP7CompletionAuthority,
  validateDrawingP7ReleaseEvidence,
  writeDrawingP7ReleaseEvidence,
} from "./drawing-p7-release-evidence.mjs";
import {
  invalidateDrawingP7ReleaseDocuments,
  writeDrawingP7ReleaseDocuments,
} from "./drawing-p7-release-documents.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifactRoot = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-gates/",
    import.meta.url,
  ),
);
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const visualEvidenceScript = fileURLToPath(
  new URL("./drawing-p7-visual-evidence.mjs", import.meta.url),
);
const visualEvidencePath = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-visual-evidence.json",
    import.meta.url,
  ),
);

function manifest() {
  return [
    {
      id: "performance.source_bound",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p7:performance"],
    },
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
      id: "browser.p0_p2",
      argv: [
        "./node_modules/.bin/playwright",
        "test",
        "e2e/drawing-workspace.spec.ts",
        "e2e/drawing-workspace-p2.spec.ts",
        "--project=chromium",
        "--workers=1",
      ],
    },
    {
      id: "browser.p3_multiplayer",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p3:production"],
    },
    {
      id: "browser.p4_functional",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p4:local"],
    },
    {
      id: "browser.p5_release",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p5:local"],
    },
    {
      id: "browser.p6_release",
      argv: [
        "./node_modules/.bin/playwright",
        "test",
        "e2e/drawing-workspace-p6.spec.ts",
        "--config=playwright.p6-release.config.ts",
        "--project=chromium",
        "--workers=1",
        "--grep-invert",
        "local mounted server-action authority is configured",
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
      id: "license.permissive_policy",
      argv: ["node", "scripts/run-drawing-p7-license-policy.mjs"],
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
    {
      id: "diff.check",
      argv: ["git", "--no-pager", "diff", "--check", "--", "."],
    },
  ];
}

export const P7_RELEASE_GATES = Object.freeze(manifest());

export function p7LocalGateEnvironment(
  gateId,
  environment,
  isolatedBrowserArtifactRoot,
) {
  if (gateId === "browser.p4_functional")
    return {
      ...environment,
      DRAWING_P4_ARTIFACT_ROOT: path.join(isolatedBrowserArtifactRoot, "p4"),
    };
  if (gateId === "browser.p5_release")
    return {
      ...environment,
      DRAWING_P5_ARTIFACT_ROOT: path.join(isolatedBrowserArtifactRoot, "p5"),
    };
  return environment;
}

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
    !isDeepStrictEqual(receipt.roles, {
      author: "estimator",
      commenter: "reviewer",
      approver: "approver",
    })
  )
    throw new Error("P7 production receipt exact project role mismatch");
  if (
    !Array.isArray(receipt.sourceBefore) ||
    receipt.sourceBefore.length < 2 ||
    !receipt.sourceBefore.some(({ kind }) => kind === "pdf") ||
    !receipt.sourceBefore.some(({ kind }) => kind === "ifc") ||
    !isDeepStrictEqual(receipt.sourceBefore, receipt.sourceAfter)
  )
    throw new Error("P7 production PDF/IFC source SHA evidence changed");
  if (
    !uuid.test(receipt.offlineClientOperationId ?? "") ||
    receipt.offlineLoss !== 0 ||
    receipt.offlineOperationsAuthored < 1 ||
    receipt.offlineOperationsPersisted !== receipt.offlineOperationsAuthored
  )
    throw new Error("P7 production offline operation loss is nonzero");
  if (
    !Array.isArray(receipt.collaborationUrls) ||
    !receipt.collaborationUrls.includes(authority.collaborationUrl.toString())
  )
    throw new Error("P7 production hosted collaboration WebSocket is invalid");
  if (receipt.approvedImmutable !== true)
    throw new Error(
      "P7 production approved revision immutable authority failed",
    );
  if (
    receipt.review?.decision !== "reviewed" ||
    receipt.review?.decidedBy !== authority.identities[1].id ||
    receipt.review?.authorId !== authority.identities[0].id ||
    receipt.review.decidedBy === receipt.review.authorId
  )
    throw new Error("P7 production independent reviewer authority failed");
  if (
    receipt.approval?.decision !== "approved" ||
    receipt.approval?.decidedBy !== authority.identities[2].id ||
    receipt.approval?.authorId !== authority.identities[0].id ||
    receipt.approval.decidedBy === receipt.approval.authorId
  )
    throw new Error("P7 production independent approval authority failed");
  if (
    receipt.export?.auditActorId !== authority.identities[2].id ||
    !uuid.test(receipt.export?.requestId ?? "") ||
    receipt.export?.artifactType !== "drawing_pdf" ||
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

export async function providerTelemetry() {
  throw new Error(
    "P7 provider runtime telemetry is UNEXECUTED: a trusted provider-domain signed immutable receipt with runner nonce is required",
  );
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

export function p7CombinedReleaseExitCode(evidence, productionResults) {
  if (
    evidence.overall !== "PASS" ||
    evidence.externalInputs !== 0 ||
    productionResults.some(({ status }) => status !== "PASS")
  )
    return 1;
  return 0;
}

export function p7ProductionGateStatus(
  gateId,
  exitCode,
  providerEvidence = null,
) {
  if (exitCode === 0) return "PASS";
  if (
    gateId === "production.managed_restore" &&
    providerEvidence?.status === "UNEXECUTED"
  )
    return "UNEXECUTED";
  return "NOT_MET";
}

const p0P2BrowserAuthorityNames = [
  "E2E_BASE_URL",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
];
const p3BrowserAuthorityNames = [
  ...p0P2BrowserAuthorityNames,
  "VITE_DRAWING_COLLABORATION_URL",
  "COLLABORATION_INTERNAL_URL",
  "COLLABORATION_INTERNAL_SECRET",
  "COLLABORATION_FREEZE_SECRET",
  "P3_E2E_DATABASE_ADMIN_URL",
  "P3_E2E_RUN_ID",
];

function suppliedAuthority(environment, names) {
  return names.every((name) => {
    const value = environment[name]?.trim().toLowerCase();
    return (
      value &&
      value !== "[sensitive]" &&
      value !== "***" &&
      !value.includes("placeholder") &&
      !value.includes("<masked")
    );
  });
}

export function p7LocalGatePreflight(gateId, environment) {
  const names =
    gateId === "browser.p0_p2"
      ? p0P2BrowserAuthorityNames
      : gateId === "browser.p3_multiplayer"
        ? p3BrowserAuthorityNames
        : null;
  if (!names) return null;
  const missing = names.filter(
    (name) => !suppliedAuthority(environment, [name]),
  );
  if (
    gateId === "browser.p3_multiplayer" &&
    environment.COLLABORATION_INTERNAL_SECRET?.trim() ===
      environment.COLLABORATION_FREEZE_SECRET?.trim() &&
    !missing.includes("COLLABORATION_FREEZE_SECRET")
  )
    missing.push("COLLABORATION_FREEZE_SECRET");
  return missing.length ? { status: "UNEXECUTED", missing } : null;
}

export function p7LocalGateStatus(gateId, exitCode, environment) {
  if (exitCode === 0) return "PASS";
  if (
    gateId === "database.real_postgres" &&
    !suppliedAuthority(environment, [
      "DRAWING_P7_REAL_DATABASE_URL",
      "P7_REAL_POSTGRES_DATABASE_URL",
    ])
  )
    return "UNEXECUTED";
  if (
    gateId === "browser.p0_p2" &&
    !suppliedAuthority(environment, p0P2BrowserAuthorityNames)
  )
    return "UNEXECUTED";
  if (
    gateId === "browser.p3_multiplayer" &&
    (!suppliedAuthority(environment, p3BrowserAuthorityNames) ||
      environment.COLLABORATION_INTERNAL_SECRET?.trim() ===
        environment.COLLABORATION_FREEZE_SECRET?.trim())
  )
    return "UNEXECUTED";
  return "NOT_MET";
}

export function buildP7ProductionGateEnvironment(
  authority,
  environment,
  rawPath,
  invocationId,
) {
  const postgresUrl = authority.postgresUrl.toString();
  return {
    ...environment,
    E2E_BASE_URL: authority.baseUrl.origin,
    SUPABASE_URL: authority.supabaseUrl.origin,
    SUPABASE_ANON_KEY: authority.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: authority.serviceRoleKey,
    VITE_DRAWING_COLLABORATION_URL: authority.collaborationUrl.toString(),
    DRAWING_P7_REAL_DATABASE_URL: postgresUrl,
    P7_REAL_POSTGRES_DATABASE_URL: postgresUrl,
    P7_PRODUCTION_RAW_EVIDENCE_PATH: rawPath,
    P7_PRODUCTION_INVOCATION_ID: invocationId,
  };
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
    "browser.p0_p2": ["release.regression_p0_p7"],
    "browser.p3_multiplayer": [
      "vertical.two_browser_realtime",
      "release.regression_p0_p7",
    ],
    "browser.p4_functional": ["release.regression_p0_p7"],
    "browser.p5_release": ["release.regression_p0_p7"],
    "browser.p6_release": ["release.regression_p0_p7"],
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
    "license.closure": ["release.no_rayon_assets_or_copy"],
    "license.permissive_policy": ["release.license_lock_notices"],
    "application.typecheck_build": ["release.typecheck_build_collaboration"],
    "application.build": ["release.typecheck_build_collaboration"],
    "collaboration.typecheck_build": ["release.typecheck_build_collaboration"],
    "collaboration.build": ["release.typecheck_build_collaboration"],
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
      if (result.status === "NOT_MET") status = "NOT_MET";
      else if (result.status === "UNEXECUTED" && status !== "NOT_MET")
        status = "UNEXECUTED";
      const path = result.receiptPath ?? `${artifactRoot}${result.id}.log`;
      receipt = fileReceipt(path);
      authority = result.id;
    }
    let receipts;
    if (id === "release.typecheck_build_collaboration") {
      const buildGateIds = [
        "application.typecheck_build",
        "application.build",
        "collaboration.typecheck_build",
        "collaboration.build",
      ];
      const buildResults = buildGateIds.map((gateId) =>
        results.find(({ id: resultId }) => resultId === gateId),
      );
      if (buildResults.every(Boolean)) {
        status = buildResults.some(({ status }) => status === "NOT_MET")
          ? "NOT_MET"
          : buildResults.some(({ status }) => status === "UNEXECUTED")
            ? "UNEXECUTED"
            : "PASS";
        authority = buildGateIds.join(" + ");
        receipts = buildResults.map((result) =>
          fileReceipt(result.receiptPath ?? `${artifactRoot}${result.id}.log`),
        );
        receipt = receipts.at(-1);
      }
    }
    if (id === "release.regression_p0_p7") {
      const browserGateIds = [
        "browser.p0_p2",
        "browser.p3_multiplayer",
        "browser.p4_functional",
        "browser.p5_release",
        "browser.p6_release",
      ];
      const browserResults = browserGateIds.map((gateId) =>
        results.find(({ id: resultId }) => resultId === gateId),
      );
      if (browserResults.every(Boolean)) {
        status = browserResults.some(({ status }) => status === "NOT_MET")
          ? "NOT_MET"
          : browserResults.some(({ status }) => status === "UNEXECUTED")
            ? "UNEXECUTED"
            : "PASS";
        authority = browserGateIds.join(" + ");
        receipts = browserResults.map((result) =>
          fileReceipt(result.receiptPath ?? `${artifactRoot}${result.id}.log`),
        );
        receipt = receipts.at(-1);
      }
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
    return receipts
      ? { id, scope, status, authority, receipt, receipts }
      : { id, scope, status, authority, receipt };
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

export function prepareP7LocalReleaseRun({
  manifest = P7_RELEASE_GATES,
  commit = drawingP7ReleaseCommit(),
  invocationId = randomUUID(),
  reportPath,
  matrixPath,
} = {}) {
  invalidateDrawingP7ReleaseDocuments({
    commit,
    invocationId,
    reportPath,
    matrixPath,
  });
  assertExactP7GateManifest(manifest);
  return invocationId;
}

async function collectLocal() {
  const invocationId = prepareP7LocalReleaseRun();
  mkdirSync(artifactRoot, { recursive: true });
  const isolatedBrowserArtifactRoot = mkdtempSync(
    path.join(tmpdir(), "1hk-p7-browser-"),
  );
  const results = [];
  try {
    for (const gate of P7_RELEASE_GATES) {
      const logPath = `${artifactRoot}${gate.id}.log`;
      const preflight = p7LocalGatePreflight(gate.id, process.env);
      if (preflight) {
        writeFileSync(
          logPath,
          `${JSON.stringify(
            {
              gate: gate.id,
              ...preflight,
              reason: "hosted browser authority is unavailable",
            },
            null,
            2,
          )}\n`,
        );
        results.push({
          id: gate.id,
          status: preflight.status,
          exitCode: 2,
        });
        continue;
      }
      const chunks = [];
      const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(gate.argv[0], gate.argv.slice(1), {
          cwd: root,
          env: p7LocalGateEnvironment(
            gate.id,
            {
              ...process.env,
              GIT_PAGER: "cat",
              GIT_TERMINAL_PROMPT: "0",
              PAGER: "cat",
            },
            isolatedBrowserArtifactRoot,
          ),
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
      results.push({
        id: gate.id,
        status: p7LocalGateStatus(gate.id, exitCode, process.env),
        exitCode,
      });
    }
  } finally {
    rmSync(isolatedBrowserArtifactRoot, { recursive: true, force: true });
  }
  const visualResult = results.find(
    ({ id }) => id === "browser.desktop_tablet",
  );
  if (visualResult?.exitCode === 0) {
    execFileSync(process.execPath, [visualEvidenceScript, "write"], {
      cwd: root,
      stdio: "inherit",
    });
    visualResult.receiptPath = visualEvidencePath;
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
    invocationId,
  );
  validateDrawingP7ReleaseEvidence(evidence, {
    expectedTreeSha256: drawingP7ReleaseTreeSha256(),
  });
  writeDrawingP7ReleaseEvidence(evidence);
  writeDrawingP7ReleaseDocuments(evidence, performance);
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
    const environment = buildP7ProductionGateEnvironment(
      authority,
      process.env,
      rawPath,
      invocationId,
    );
    const exitCode = await executeWithEnvironment(gate.argv, environment);
    let providerEvidence = null;
    if (gate.id === "production.managed_restore") {
      const path = fileURLToPath(
        new URL(
          "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-5-restore-evidence.json",
          import.meta.url,
        ),
      );
      if (existsSync(path))
        providerEvidence = JSON.parse(readFileSync(path, "utf8"));
    }
    productionResults.push({
      id: gate.id,
      status: p7ProductionGateStatus(gate.id, exitCode, providerEvidence),
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
        "security.reviewer_approver_separation",
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
  const completionAuthority =
    baseEvidence.overall === "PASS"
      ? loadP7CompletionAuthority(process.env)
      : null;
  validateDrawingP7ReleaseEvidence(baseEvidence, {
    expectedTreeSha256: drawingP7ReleaseTreeSha256(),
    completionAuthority,
  });
  writeDrawingP7ReleaseEvidence(baseEvidence);
  const performancePath = fileURLToPath(
    new URL(
      "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-4-performance-evidence.json",
      import.meta.url,
    ),
  );
  writeDrawingP7ReleaseDocuments(
    baseEvidence,
    JSON.parse(readFileSync(performancePath, "utf8")),
  );
  if (p7CombinedReleaseExitCode(baseEvidence, productionResults) !== 0)
    throw new Error(
      `P7 production gate is ${baseEvidence.overall}: ${failed.length ? failed.map(({ id, status }) => `${id}=${status}`).join(", ") : `local ledger=${baseEvidence.overall}`}`,
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
