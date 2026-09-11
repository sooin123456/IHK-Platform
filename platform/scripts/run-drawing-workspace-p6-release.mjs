import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import { requireP5ProductionAuthorities } from "./run-drawing-workspace-p5-release.mjs";
import {
  P6_PERFORMANCE_EVIDENCE_PATH,
  validateDrawingP6PerformanceEvidence,
} from "./drawing-p6-performance-evidence.mjs";
import {
  assertDrawingP6CurrentTreeClean,
  assertDrawingP6ReleasePass,
  buildDrawingP6UnexecutedReleaseEvidence,
  drawingP6ReleaseCommit,
  writeDrawingP6ReleaseEvidence,
} from "./drawing-p6-release-evidence.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function exactLocalManifest() {
  return [
    {
      label: "P0-P5 complete local release regression",
      argv: ["npm", "run", "release:drawing-workspace-p5:local"],
    },
    {
      label: "P6 pure, PGlite, and trusted-server contracts",
      argv: [
        "node",
        "--test",
        "tests/drawing-quantity-lineage.test.mjs",
        "tests/drawing-quantity-lineage-server.test.mjs",
        "tests/drawing-workspace-material-blank-specification.test.mjs",
        "tests/drawing-workspace-p6-database-contract.test.mjs",
        "tests/drawing-workspace-p6-route.test.mjs",
        "tests/verified-boq-v1-1.test.mjs",
        "tests/verified-boq.test.mjs",
      ],
    },
    {
      label: "P6 exact pure production-function workload",
      argv: [
        "node",
        "scripts/drawing-p6-performance-evidence.mjs",
        "measure-pure",
      ],
    },
    {
      label: "P6 mandatory real PostgreSQL RLS, locks, and indexes",
      argv: [
        "env",
        "P6_REAL_POSTGRES_REQUIRED=1",
        "node",
        "--test",
        "tests/drawing-workspace-p6-postgres-concurrency.test.mjs",
      ],
    },
    {
      label: "P6 production-build local vertical and preview smoke producer",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p6:local"],
    },
    {
      label: "P6 exact workload performance evidence",
      argv: ["node", "scripts/drawing-p6-performance-evidence.mjs", "validate"],
    },
    {
      label: "P6 release and license contracts",
      argv: ["node", "--test", "tests/drawing-workspace-p6-release.test.mjs"],
    },
    { label: "application typecheck", argv: ["npm", "run", "typecheck"] },
    {
      label: "collaboration typecheck",
      argv: ["npm", "run", "typecheck:collaboration"],
    },
    { label: "production build", argv: ["npm", "run", "build"] },
    {
      label: "P6 formatting",
      argv: [
        "./node_modules/.bin/prettier",
        "--check",
        "app/**/*.{ts,tsx,js,jsx,json,css,md,mdx}",
        "tests/**/*.mjs",
        "scripts/**/*.{mjs,mts}",
        "../docs/superpowers/specs/2026-08-27-drawing-workspace-p6-design.md",
        "../docs/superpowers/plans/2026-08-27-drawing-workspace-p6.md",
      ],
    },
    { label: "diff check", argv: ["git", "--no-pager", "diff", "--check"] },
  ];
}

export const P6_LOCAL_RELEASE_GATES = exactLocalManifest();
export function p6LocalReleaseManifest() {
  return exactLocalManifest();
}
export function assertExactP6LocalGateManifest(gates) {
  if (!isDeepStrictEqual(gates, exactLocalManifest()))
    throw new Error(
      "P6 local release manifest does not match the exact gate contract",
    );
}

function required(environment, name) {
  const value = environment[name]?.trim();
  if (!value)
    throw new Error(`P6 production gate is UNEXECUTED: ${name} is required`);
  return value;
}
function hostedUrl(value, name, websocket = false) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`P6 production gate is UNEXECUTED: ${name} is invalid`);
  }
  if (
    !(websocket ? url.protocol === "wss:" : url.protocol === "https:") ||
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  )
    throw new Error(`P6 production gate is UNEXECUTED: ${name} must be hosted`);
  return url;
}

export function requireP6ProductionAuthorities(environment) {
  let p5;
  try {
    p5 = requireP5ProductionAuthorities(environment);
  } catch (error) {
    throw new Error(
      (error instanceof Error ? error.message : String(error)).replace(
        /^P5 production gate/,
        "P6 production gate",
      ),
    );
  }
  const baseUrl = hostedUrl(
    required(environment, "P6_E2E_BASE_URL"),
    "P6_E2E_BASE_URL",
  );
  const supabaseUrl = hostedUrl(
    required(environment, "P6_E2E_SUPABASE_URL"),
    "P6_E2E_SUPABASE_URL",
  );
  const anonKey = required(environment, "P6_E2E_SUPABASE_ANON_KEY");
  const serviceKey = required(environment, "P6_E2E_SUPABASE_SERVICE_ROLE_KEY");
  if (anonKey === serviceKey || anonKey.length < 32 || serviceKey.length < 32)
    throw new Error(
      "P6 production gate is UNEXECUTED: hosted Supabase keys are invalid",
    );
  const postgresUrl = required(environment, "P6_E2E_POSTGRES_URL");
  const postgresAuthority = (value, name) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`P6 production gate is UNEXECUTED: ${name} is invalid`);
    }
    if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !parsed.hostname)
      throw new Error(
        `P6 production gate is UNEXECUTED: ${name} must be real PostgreSQL`,
      );
    return value;
  };
  postgresAuthority(postgresUrl, "P6_E2E_POSTGRES_URL");
  const freshPostgresUrl = postgresAuthority(
    required(environment, "P6_E2E_FRESH_POSTGRES_URL"),
    "P6_E2E_FRESH_POSTGRES_URL",
  );
  const upgradePostgresUrl = postgresAuthority(
    required(environment, "P6_E2E_UPGRADE_POSTGRES_URL"),
    "P6_E2E_UPGRADE_POSTGRES_URL",
  );
  const restorePostgresUrl = postgresAuthority(
    required(environment, "P6_E2E_RESTORE_POSTGRES_URL"),
    "P6_E2E_RESTORE_POSTGRES_URL",
  );
  if (
    new Set([
      postgresUrl,
      freshPostgresUrl,
      upgradePostgresUrl,
      restorePostgresUrl,
    ]).size !== 4
  )
    throw new Error(
      "P6 production gate is UNEXECUTED: fresh, upgrade, restore, and fixture databases must be distinct",
    );
  const managementApiUrl = hostedUrl(
    required(environment, "P6_E2E_MANAGEMENT_API_URL"),
    "P6_E2E_MANAGEMENT_API_URL",
  );
  if (managementApiUrl.origin !== "https://api.supabase.com")
    throw new Error(
      "P6 production gate is UNEXECUTED: P6_E2E_MANAGEMENT_API_URL must be the Supabase Management API",
    );
  const managementAccessToken = required(
    environment,
    "P6_E2E_MANAGEMENT_ACCESS_TOKEN",
  );
  if (!/^sbp_[A-Za-z0-9_-]{32,}$/.test(managementAccessToken))
    throw new Error(
      "P6 production gate is UNEXECUTED: P6_E2E_MANAGEMENT_ACCESS_TOKEN is invalid",
    );
  const projectRef = required(environment, "P6_E2E_PROJECT_REF");
  if (
    !/^[a-z0-9]{20}$/.test(projectRef) ||
    supabaseUrl.hostname !== `${projectRef}.supabase.co`
  )
    throw new Error(
      "P6 production gate is UNEXECUTED: P6_E2E_PROJECT_REF must match Supabase URL",
    );
  const storageCorsOrigin = required(environment, "P6_E2E_STORAGE_CORS_ORIGIN");
  if (storageCorsOrigin !== baseUrl.origin)
    throw new Error(
      "P6 production gate is UNEXECUTED: P6_E2E_STORAGE_CORS_ORIGIN must match the deployment origin",
    );
  const deploymentId = required(environment, "P6_E2E_DEPLOYMENT_ID");
  const commit = required(environment, "P6_E2E_COMMIT");
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error(
      "P6 production gate is UNEXECUTED: P6_E2E_COMMIT is invalid",
    );
  const backupId = required(environment, "P6_E2E_BACKUP_ID");
  const restoreOperationId = required(
    environment,
    "P6_E2E_RESTORE_OPERATION_ID",
  );
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(restoreOperationId))
    throw new Error(
      "P6 production gate is UNEXECUTED: P6_E2E_RESTORE_OPERATION_ID is invalid",
    );
  const restoreResultSha256 = required(
    environment,
    "P6_E2E_RESTORE_RESULT_SHA256",
  );
  const restoreManifestSha256 = required(
    environment,
    "P6_E2E_RESTORE_MANIFEST_SHA256",
  );
  for (const [name, value] of [
    ["P6_E2E_RESTORE_RESULT_SHA256", restoreResultSha256],
    ["P6_E2E_RESTORE_MANIFEST_SHA256", restoreManifestSha256],
  ])
    if (!/^[0-9a-f]{64}$/.test(value))
      throw new Error(`P6 production gate is UNEXECUTED: ${name} is invalid`);
  const region = required(environment, "P6_E2E_REGION");
  const makerEmail = required(environment, "P6_E2E_MAKER_EMAIL").toLowerCase();
  const approverEmail = required(
    environment,
    "P6_E2E_APPROVER_EMAIL",
  ).toLowerCase();
  const attackerEmail = required(
    environment,
    "P6_E2E_ATTACKER_EMAIL",
  ).toLowerCase();
  const viewerEmail = required(
    environment,
    "P6_E2E_VIEWER_EMAIL",
  ).toLowerCase();
  if (
    new Set([makerEmail, approverEmail, attackerEmail, viewerEmail]).size !== 4
  )
    throw new Error(
      "P6 production gate is UNEXECUTED: maker, approver, viewer, and attacker must be distinct users",
    );
  const fixtureNames = [
    "P6_E2E_PROJECT_ID",
    "P6_E2E_DRAWING_REVISION_ID",
    "P6_E2E_BOQ_VERSION_ID",
    "P6_E2E_MATERIAL_PLAN_ID",
  ];
  const fixtureIds = fixtureNames.map((name) => {
    const value = required(environment, name);
    if (!uuid.test(value))
      throw new Error(`P6 production gate is UNEXECUTED: ${name} is invalid`);
    return value.toLowerCase();
  });
  if (
    p5.E2E_BASE_URL !== baseUrl.toString().replace(/\/$/, "") ||
    p5.SUPABASE_URL !== supabaseUrl.toString().replace(/\/$/, "") ||
    p5.SUPABASE_ANON_KEY !== anonKey ||
    p5.SUPABASE_SERVICE_ROLE_KEY !== serviceKey
  )
    throw new Error(
      "P6 production gate is UNEXECUTED: P6 and composed P5 authorities must match",
    );
  return {
    phase: "production",
    baseUrl,
    supabaseUrl,
    postgresUrl,
    freshPostgresUrl,
    upgradePostgresUrl,
    restorePostgresUrl,
    managementApiUrl,
    managementAccessToken,
    projectRef,
    storageCorsOrigin,
    deploymentId,
    commit,
    backupId,
    restoreOperationId,
    restoreResultSha256,
    restoreManifestSha256,
    region,
    makerEmail,
    approverEmail,
    attackerEmail,
    viewerEmail,
    projectId: fixtureIds[0],
    drawingRevisionId: fixtureIds[1],
    boqVersionId: fixtureIds[2],
    materialPlanId: fixtureIds[3],
  };
}

export function requireP6LocalAuthorities(environment) {
  const value = (name) => required(environment, name);
  const baseUrl = new URL(
    environment.P6_LOCAL_E2E_BASE_URL ??
      `http://127.0.0.1:${environment.PORT ?? "4176"}`,
  );
  if (
    baseUrl.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(baseUrl.hostname)
  )
    throw new Error(
      "P6 local gate is UNEXECUTED: P6_LOCAL_E2E_BASE_URL must be loopback HTTP",
    );
  const supabaseUrl = new URL(value("P6_LOCAL_SUPABASE_URL"));
  if (
    !["http:", "https:"].includes(supabaseUrl.protocol) ||
    !["127.0.0.1", "localhost"].includes(supabaseUrl.hostname)
  )
    throw new Error(
      "P6 local gate is UNEXECUTED: P6_LOCAL_SUPABASE_URL must be local",
    );
  const anonKey = value("P6_LOCAL_SUPABASE_ANON_KEY");
  const serviceKey = value("P6_LOCAL_SUPABASE_SERVICE_ROLE_KEY");
  if (anonKey === serviceKey || anonKey.length < 32 || serviceKey.length < 32)
    throw new Error(
      "P6 local gate is UNEXECUTED: local Supabase keys are invalid",
    );
  const postgresUrl = value("P6_REAL_POSTGRES_DATABASE_URL");
  try {
    const parsed = new URL(postgresUrl);
    if (!/^postgres(?:ql)?:$/.test(parsed.protocol) || !parsed.hostname)
      throw new Error();
  } catch {
    throw new Error(
      "P6 local gate is UNEXECUTED: P6_REAL_POSTGRES_DATABASE_URL is invalid",
    );
  }
  const localEmail = (name) => value(name).toLowerCase();
  const makerEmail = localEmail("P6_LOCAL_MAKER_EMAIL");
  const approverEmail = localEmail("P6_LOCAL_APPROVER_EMAIL");
  const attackerEmail = localEmail("P6_LOCAL_ATTACKER_EMAIL");
  const viewerEmail = localEmail("P6_LOCAL_VIEWER_EMAIL");
  if (
    new Set([makerEmail, approverEmail, attackerEmail, viewerEmail]).size !== 4
  )
    throw new Error(
      "P6 local gate is UNEXECUTED: local fixture users must be distinct",
    );
  const fixture = (name) => {
    const id = value(name);
    if (!uuid.test(id))
      throw new Error(`P6 local gate is UNEXECUTED: ${name} is invalid`);
    return id.toLowerCase();
  };
  const restoreResultSha256 = value("P6_LOCAL_RESULT_SHA256");
  const restoreManifestSha256 = value("P6_LOCAL_MANIFEST_SHA256");
  if (
    !/^[0-9a-f]{64}$/.test(restoreResultSha256) ||
    !/^[0-9a-f]{64}$/.test(restoreManifestSha256)
  )
    throw new Error(
      "P6 local gate is UNEXECUTED: local fixture hashes are invalid",
    );
  return {
    phase: "local",
    baseUrl,
    supabaseUrl,
    postgresUrl,
    freshPostgresUrl: postgresUrl,
    upgradePostgresUrl: postgresUrl,
    restorePostgresUrl: postgresUrl,
    managementApiUrl: new URL("https://api.supabase.com"),
    managementAccessToken: "",
    projectRef: "",
    storageCorsOrigin: baseUrl.origin,
    deploymentId: "local-production-build",
    commit: drawingP6ReleaseCommit(),
    backupId: "local-real-postgres",
    restoreOperationId: "local-real-postgres",
    restoreResultSha256,
    restoreManifestSha256,
    region: "local",
    makerEmail,
    approverEmail,
    attackerEmail,
    viewerEmail,
    projectId: fixture("P6_LOCAL_PROJECT_ID"),
    drawingRevisionId: fixture("P6_LOCAL_DRAWING_REVISION_ID"),
    boqVersionId: fixture("P6_LOCAL_BOQ_VERSION_ID"),
    materialPlanId: fixture("P6_LOCAL_MATERIAL_PLAN_ID"),
  };
}

function execute({ argv, environment = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: root,
      env: {
        ...process.env,
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
        ? reject(new Error(`terminated by ${signal}`))
        : resolve(code ?? 1),
    );
  });
}

export async function runP6ReleaseGates(
  gates,
  { phase, runner = execute, log = (message) => process.stdout.write(message) },
) {
  if (phase !== "LOCAL" && phase !== "PRODUCTION")
    throw new Error("P6 release phase must be LOCAL or PRODUCTION");
  for (const gate of gates) {
    log(`P6 ${phase} ${gate.label}\n`);
    const status = await runner(gate);
    if (status !== 0)
      throw new Error(
        `P6 release gate ${gate.label} failed with exit ${status}`,
      );
  }
}

function recordUnexecuted(phase) {
  writeDrawingP6ReleaseEvidence(
    buildDrawingP6UnexecutedReleaseEvidence(phase.toLowerCase()),
  );
}

function recordLocalPass() {
  const performance = validateDrawingP6PerformanceEvidence(
    JSON.parse(readFileSync(P6_PERFORMANCE_EVIDENCE_PATH, "utf8")),
  );
  const seed = buildDrawingP6UnexecutedReleaseEvidence("local");
  const localNames = [
    "browser",
    "build",
    "collaborationTypecheck",
    "diff",
    "format",
    "license",
    "metrics",
    "mountedRoute",
    "p5",
    "performance",
    "pglite",
    "pure",
    "realPostgres",
    "rlsConcurrency",
    "server",
    "twoUsers",
    "typecheck",
  ];
  for (const name of localNames) seed.authorities[name] = "PASS";
  const sourceHash = (values) =>
    createHash("sha256").update(JSON.stringify(values)).digest("hex");
  const evidence = {
    ...seed,
    authorities: seed.authorities,
    hashes: {
      csv: performance.repeatedHashes.csv[0],
      handoff: performance.repeatedHashes.handoff[0],
      manifest: performance.repeatedHashes.manifest[0],
      result: performance.repeatedHashes.result[0],
      sourceBefore: sourceHash(performance.sourceHashes.before),
      sourceAfter: sourceHash(performance.sourceHashes.after),
      xlsx: performance.repeatedHashes.xlsx[0],
    },
    metrics: performance.metrics,
    gates: { local: "PASS", production: "UNEXECUTED" },
  };
  writeDrawingP6ReleaseEvidence(evidence);
  assertDrawingP6ReleasePass(evidence);
}

async function main(mode) {
  if (mode === "local") {
    recordUnexecuted("LOCAL");
    assertDrawingP6CurrentTreeClean();
    assertExactP6LocalGateManifest(P6_LOCAL_RELEASE_GATES);
    await runP6ReleaseGates(P6_LOCAL_RELEASE_GATES, { phase: "LOCAL" });
    recordLocalPass();
    process.stdout.write("P6 LOCAL PASS\n");
    return;
  }
  if (mode !== "production")
    throw new Error(
      "Usage: run-drawing-workspace-p6-release.mjs local|production",
    );
  recordUnexecuted("PRODUCTION");
  const productionAuthority = requireP6ProductionAuthorities(process.env);
  process.env.P6_REAL_POSTGRES_DATABASE_URL ??= productionAuthority.postgresUrl;
  assertDrawingP6CurrentTreeClean();
  await runP6ReleaseGates(
    [
      {
        label: "commit-matched P6 local release authority",
        argv: ["npm", "run", "release:drawing-workspace-p6:local"],
      },
      ...[
        ["fresh", productionAuthority.freshPostgresUrl],
        ["upgrade", productionAuthority.upgradePostgresUrl],
        ["restore", productionAuthority.restorePostgresUrl],
      ].map(([name, databaseUrl]) => ({
        label: `hosted ${name} PostgreSQL RLS, locks, indexes, and schema parity`,
        argv: [
          "node",
          "--test",
          "tests/drawing-workspace-p6-postgres-concurrency.test.mjs",
        ],
        environment: {
          P6_REAL_POSTGRES_REQUIRED: "1",
          P6_REAL_POSTGRES_DATABASE_URL: databaseUrl,
        },
      })),
      {
        label:
          "hosted P0-P5 provider, migrations, RLS, advisors, and backup restore",
        argv: ["npm", "run", "release:drawing-workspace-p5:production"],
      },
      {
        label:
          "deployed P6 two-user, attacker, Storage, export, and material lineage",
        argv: ["npm", "run", "test:e2e:drawing-workspace-p6:production"],
      },
      {
        label: "deployed P6 commit-bound evidence",
        argv: [
          "node",
          "scripts/drawing-p6-release-evidence.mjs",
          "validate",
          "production",
        ],
      },
    ],
    { phase: "PRODUCTION" },
  );
  process.stdout.write("P6 PRODUCTION PASS\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  main(process.argv[2]).catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
