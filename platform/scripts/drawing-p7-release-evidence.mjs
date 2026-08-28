import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const platformRoot = fileURLToPath(new URL("../", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const P7_RELEASE_EVIDENCE_PATH = fileURLToPath(
  new URL(
    "../../.superpowers/sdd/2026-08-28-drawing-workspace-p7/task-7-release-evidence.json",
    import.meta.url,
  ),
);

export const P7_REQUIREMENTS = Object.freeze(
  [
    ["p0.editor_core", "local"],
    ["p0.world_coordinates", "local"],
    ["p0.autosave_restore", "local"],
    ["p1.six_tools", "local"],
    ["p1.select_move_copy_delete", "local"],
    ["p1.undo_redo_inspector", "local"],
    ["vertical.blank_or_pdf_open", "local"],
    ["vertical.layers_visibility_lock", "local"],
    ["vertical.issue_object_link", "local"],
    ["vertical.two_browser_realtime", "local"],
    ["vertical.viewer_editor_roles", "local"],
    ["source.pdf_ifc_sha_immutable", "production"],
    ["p2.pages_canvas_styles_blocks", "local"],
    ["p2.tables_properties_templates_export", "local"],
    ["p3.yjs_indexeddb_hocuspocus", "local"],
    ["p3.awareness_locks_mentions_history", "local"],
    ["p3.offline_zero_loss", "production"],
    ["p4.semantic_objects_measurement", "local"],
    ["p4.deterministic_schedules", "local"],
    ["p5.pdf_ifc_split_cross_select", "local"],
    ["p5.revision_diff_anchor_relink", "local"],
    ["p6.object_quantity_boq_material_lineage", "local"],
    ["p6.approved_exports", "local"],
    ["p7.current_default_workspace", "local"],
    ["p7.desktop_1280x720", "local"],
    ["p7.tablet_portrait_landscape", "local"],
    ["p7.touch_focus_accessibility", "local"],
    ["p7.organization_library_provenance", "local"],
    ["p7.retention_archive_legal_hold", "local"],
    ["p7.organization_admin_entitlements", "local"],
    ["security.real_postgres_rls", "production"],
    ["security.approved_revision_immutable", "production"],
    ["collaboration.hosted_service", "production"],
    ["performance.10k_deterministic", "local"],
    ["performance.warm_interaction", "local"],
    ["performance.warm_reopen", "local"],
    ["performance.cold_startup", "production"],
    ["performance.hosted_runtime", "production"],
    ["retention.managed_backup_restore", "production"],
    ["retention.rpo_rto", "production"],
    ["production.three_real_users", "production"],
    ["production.mounted_route_actions", "production"],
    ["production.export_audit", "production"],
    ["release.regression_p0_p7", "local"],
    ["release.typecheck_build_collaboration", "local"],
    ["release.license_lock_notices", "local"],
    ["release.no_rayon_assets_or_copy", "local"],
  ].map(([id, scope]) => Object.freeze({ id, scope })),
);

const allowed = new Set(["PASS", "NOT_MET", "UNEXECUTED"]);
const hardProductionIds = new Set([
  "source.pdf_ifc_sha_immutable",
  "p3.offline_zero_loss",
  "security.real_postgres_rls",
  "security.approved_revision_immutable",
  "collaboration.hosted_service",
  "performance.cold_startup",
  "performance.hosted_runtime",
  "retention.managed_backup_restore",
  "retention.rpo_rto",
  "production.three_real_users",
  "production.mounted_route_actions",
  "production.export_audit",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function drawingP7ReceiptPath(path) {
  const absolute = isAbsolute(path) ? path : resolve(repositoryRoot, path);
  const repositoryRelative = relative(repositoryRoot, absolute);
  if (
    !repositoryRelative ||
    repositoryRelative === ".." ||
    repositoryRelative.startsWith("../") ||
    repositoryRelative.startsWith("..\\") ||
    isAbsolute(repositoryRelative)
  )
    throw new Error("P7 child receipt is outside repository authority");
  return repositoryRelative.split("\\").join("/");
}

function receiptAbsolutePath(path) {
  return resolve(repositoryRoot, drawingP7ReceiptPath(path));
}

export function drawingP7ReleaseCommit() {
  return execFileSync(
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
    { cwd: platformRoot, encoding: "utf8" },
  ).trim();
}

export function drawingP7ReleaseTreeSha256() {
  const paths = execFileSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
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
    { cwd: platformRoot },
  )
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(new URL(`../${path}`, import.meta.url)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function summarize(requirements) {
  const summary = { PASS: 0, NOT_MET: 0, UNEXECUTED: 0 };
  for (const requirement of requirements) summary[requirement.status] += 1;
  return summary;
}

function overall(summary) {
  if (summary.NOT_MET > 0) return "NOT_MET";
  if (summary.UNEXECUTED > 0) return "UNEXECUTED";
  return "PASS";
}

export function buildDrawingP7ReleaseEvidenceFixture({
  commit = "1".repeat(40),
} = {}) {
  const requirements = P7_REQUIREMENTS.map(({ id, scope }) => ({
    id,
    scope,
    status:
      id === "performance.cold_startup"
        ? "NOT_MET"
        : scope === "production"
          ? "UNEXECUTED"
          : "PASS",
    authority:
      scope === "production"
        ? "production authority unavailable"
        : "current integrated local regression",
    receipt: null,
  }));
  const summary = summarize(requirements);
  return {
    schemaVersion: 1,
    commit,
    sourceTreeSha256: "a".repeat(64),
    generatedAt: "2026-08-28T00:00:00.000Z",
    runner: {
      name: "P7_FAIL_CLOSED_RELEASE_RUNNER_V1",
      sha256: "b".repeat(64),
      invocationId: "00000000-0000-4000-8000-000000000001",
    },
    requirements,
    summary,
    overall: overall(summary),
    externalInputs: hardProductionIds.size,
  };
}

export function validateDrawingP7ReleaseEvidence(
  evidence,
  {
    expectedCommit = drawingP7ReleaseCommit(),
    expectedTreeSha256 = null,
    verifyReceipts = true,
  } = {},
) {
  assert.deepEqual(Object.keys(evidence).sort(), [
    "commit",
    "externalInputs",
    "generatedAt",
    "overall",
    "requirements",
    "runner",
    "schemaVersion",
    "sourceTreeSha256",
    "summary",
  ]);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.commit, expectedCommit, "current commit binding");
  assert.match(evidence.commit, /^[0-9a-f]{40}$/);
  assert.match(evidence.sourceTreeSha256, /^[0-9a-f]{64}$/);
  if (expectedTreeSha256)
    assert.equal(
      evidence.sourceTreeSha256,
      expectedTreeSha256,
      "source tree binding",
    );
  assert.equal(Number.isNaN(Date.parse(evidence.generatedAt)), false);
  assert.deepEqual(
    evidence.requirements.map(({ id, scope }) => ({ id, scope })),
    P7_REQUIREMENTS,
    "exact P0-P7 requirement ledger",
  );
  for (const requirement of evidence.requirements) {
    assert.ok(allowed.has(requirement.status), requirement.id);
    assert.equal(typeof requirement.authority, "string");
    assert.ok(requirement.authority.length > 0);
    if (verifyReceipts && requirement.status === "PASS") {
      assert.equal(
        typeof requirement.receipt,
        "object",
        `${requirement.id} receipt`,
      );
      assert.match(requirement.receipt.sha256, /^[0-9a-f]{64}$/);
      const receiptPath = receiptAbsolutePath(requirement.receipt.path);
      assert.equal(existsSync(receiptPath), true, requirement.receipt.path);
      assert.equal(
        sha256(readFileSync(receiptPath)),
        requirement.receipt.sha256,
      );
    }
  }
  assert.deepEqual(evidence.summary, summarize(evidence.requirements));
  assert.equal(evidence.overall, overall(evidence.summary));
  for (const id of hardProductionIds) {
    const row = evidence.requirements.find((candidate) => candidate.id === id);
    assert.ok(row, id);
    if (row.status === "PASS" && !verifyReceipts)
      throw new Error(
        `${id} cannot PASS without cold/production/managed restore/three-user receipt authority`,
      );
  }
  assert.equal(
    evidence.externalInputs,
    evidence.requirements.filter(
      ({ scope, status }) => scope === "production" && status !== "PASS",
    ).length,
  );
  return evidence;
}

export function assertDrawingP7ProgramComplete(evidence, options = {}) {
  const valid = validateDrawingP7ReleaseEvidence(evidence, options);
  if (valid.overall !== "PASS" || valid.externalInputs !== 0)
    throw new Error(
      `P7 program is ${valid.overall}: ${valid.summary.NOT_MET} NOT_MET, ${valid.summary.UNEXECUTED} UNEXECUTED`,
    );
  return valid;
}

export function writeDrawingP7ReleaseEvidence(evidence) {
  writeFileSync(
    P7_RELEASE_EVIDENCE_PATH,
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  return P7_RELEASE_EVIDENCE_PATH;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] !== "validate")
    throw new Error("Usage: drawing-p7-release-evidence.mjs validate");
  const evidence = JSON.parse(readFileSync(P7_RELEASE_EVIDENCE_PATH, "utf8"));
  validateDrawingP7ReleaseEvidence(evidence, {
    expectedTreeSha256: drawingP7ReleaseTreeSha256(),
  });
  assertDrawingP7ProgramComplete(evidence, {
    expectedTreeSha256: drawingP7ReleaseTreeSha256(),
  });
}
