import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  P5_LOCAL_RELEASE_GATES,
  assertExactP5LocalGateManifest,
  requireP5ProductionAuthorities,
  runP5ReleaseGates,
} from "../scripts/run-drawing-workspace-p5-release.mjs";
import {
  P5_SOURCE_FIXTURES,
  validateDrawingP5ReleaseEvidence,
} from "../scripts/drawing-p5-release-evidence.mjs";

const productionEnvironment = {
  E2E_BASE_URL: "https://drawing.onehk.kr",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_ANON_KEY: "a".repeat(40),
  SUPABASE_SERVICE_ROLE_KEY: "b".repeat(40),
  VITE_DRAWING_COLLABORATION_URL: "wss://collaboration.onehk.kr",
  COLLABORATION_INTERNAL_URL: "https://collaboration.onehk.kr",
  COLLABORATION_INTERNAL_SECRET: "c".repeat(40),
  COLLABORATION_FREEZE_SECRET: "d".repeat(40),
  P3_E2E_DATABASE_ADMIN_URL:
    "postgresql://admin:secret@db.onehk.kr:5432/postgres",
  P3_E2E_RUN_ID: "p5-release-20260827",
  P5_E2E_STORAGE_CORS_ORIGIN: "https://drawing.onehk.kr",
};

test("P5 operation resource routes reuse the authenticated actions and notices close renderer licenses", async () => {
  const [routes, productionResource, localResource, notice] = await Promise.all(
    [
      readFile(new URL("../app/routes.ts", import.meta.url), "utf8"),
      readFile(
        new URL(
          "../app/lukas/screens/drawing-workspace-operation.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "../app/lukas/screens/local-drawing-workspace-operation.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(new URL("../THIRD_PARTY_NOTICES.md", import.meta.url), "utf8"),
    ],
  );
  assert.match(routes, /drawings\/:fileId\/workspace\/operation/);
  assert.match(routes, /workspace-preview\/drawing-workspace\/operation/);
  assert.match(
    productionResource,
    /export \{ action \} from "\.\/drawing-workspace\.tsx"/,
  );
  assert.match(
    localResource,
    /export \{ action \} from "\.\/local-drawing-workspace-preview\.tsx"/,
  );
  assert.match(notice, /\| pdfjs-dist\s+\| 6\.2\.108\s+\|.*Apache-2\.0/);
  assert.match(notice, /\| three\s+\| 0\.185\.1\s+\|.*MIT/);
  assert.match(notice, /\| web-ifc\s+\| 0\.0\.77\s+\|.*MPL-2\.0/);
});

test("P5 browser scripts use installed Playwright and isolate Vite-only import lifecycle", async () => {
  const packageJson = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.match(
    packageJson.scripts["test:e2e:drawing-workspace-p5:dev-lifecycle"],
    /^playwright test .*playwright\.p5-dev\.config\.ts.*source swap/,
  );
  assert.match(
    packageJson.scripts["test:e2e:drawing-workspace-p5:local"],
    /^P5_RELEASE_PRODUCTION_BUILD=1 playwright test .*--grep-invert.*source swap/,
  );
  assert.doesNotMatch(
    packageJson.scripts["test:e2e:drawing-workspace-p5:local"],
    /\bnpx\b/,
  );
  assert.equal(
    Object.values(packageJson.scripts).some((script) =>
      /\bnpx playwright\b/.test(script),
    ),
    false,
  );
});

test("P5 local release manifest composes the complete P4 gate before P5 browser evidence", () => {
  assert.doesNotThrow(() =>
    assertExactP5LocalGateManifest(P5_LOCAL_RELEASE_GATES),
  );
  assert.deepEqual(P5_LOCAL_RELEASE_GATES, [
    {
      label: "P0-P4 complete local release regression",
      argv: ["npm", "run", "release:drawing-workspace-p4:local"],
    },
    {
      label: "P5 development import-generation lifecycle",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p5:dev-lifecycle"],
    },
    {
      label: "P5 production-build vertical and stable lifecycle",
      argv: ["npm", "run", "test:e2e:drawing-workspace-p5:local"],
    },
    {
      label: "P5 generated release evidence",
      argv: ["node", "scripts/drawing-p5-release-evidence.mjs", "validate"],
    },
    { label: "diff check", argv: ["git", "--no-pager", "diff", "--check"] },
  ]);
});

test("P5 gate runner is ordered and fail-fast", async () => {
  const visited = [];
  await assert.rejects(
    runP5ReleaseGates(
      [
        { label: "one", argv: ["one"] },
        { label: "two", argv: ["two"] },
        { label: "never", argv: ["never"] },
      ],
      {
        phase: "LOCAL",
        runner: async ({ label }) => {
          visited.push(label);
          return label === "two" ? 7 : 0;
        },
        log() {},
      },
    ),
    /two failed with exit 7/,
  );
  assert.deepEqual(visited, ["one", "two"]);
});

test("P5 production authority fails closed for provider and exact Storage CORS origin", () => {
  assert.throws(
    () => requireP5ProductionAuthorities({}),
    /P5 production gate is UNEXECUTED/,
  );
  assert.throws(
    () =>
      requireP5ProductionAuthorities({
        ...productionEnvironment,
        P5_E2E_STORAGE_CORS_ORIGIN: "https://other.onehk.kr",
      }),
    /Storage CORS origin must exactly match E2E_BASE_URL origin/,
  );
  assert.equal(
    requireP5ProductionAuthorities(productionEnvironment)
      .P5_E2E_STORAGE_CORS_ORIGIN,
    productionEnvironment.P5_E2E_STORAGE_CORS_ORIGIN,
  );
});

test("P5 hosted command targets the new workspace source authority surface", async () => {
  const [packageJson, productionSpec] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8").then(
      JSON.parse,
    ),
    readFile(
      new URL(
        "../e2e/drawing-workspace-p5-production.spec.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);
  assert.match(
    packageJson.scripts["test:e2e:drawing-workspace-p5:production"],
    /drawing-workspace-p5-production\.spec\.ts/,
  );
  for (const boundary of [
    "/workspace?document=",
    "lukas_drawing_relink_issue_anchor",
    "replaces_anchor_id",
    "previousAnchorId",
    "newAnchorId",
    "editorContext",
    "viewerContext",
    "PDF 영역 원본 근거 연결",
    "원본 근거 해제",
    "공동 편집 상태: connected",
    "fixture.viewer",
    "fixture.nonMember",
    "readSourceEvidence",
    "view=split",
    "겹쳐 보기",
  ])
    assert.match(productionSpec, new RegExp(boundary.replace("?", "\\?")));
});

test("P5 IFC disposal evidence uses an owned harness observer without a window event", async () => {
  const [viewer, browser, workspace, preview, releaseSpec] = await Promise.all(
    [
      "../app/lukas/components/ifc-model-viewer.client.ts",
      "../app/lukas/components/ifc-property-browser.client.tsx",
      "../app/lukas/components/drawing-workspace.tsx",
      "../app/lukas/screens/local-drawing-workspace-preview.tsx",
      "../e2e/drawing-workspace-p5-release.spec.ts",
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  assert.doesNotMatch(
    viewer,
    /drawing:ifc-viewer-lifecycle|window\.dispatchEvent/,
  );
  assert.match(viewer, /onDispose/);
  assert.match(browser, /onViewerDispose/);
  assert.match(workspace, /onIfcViewerDispose/);
  assert.match(preview, /P5 IFC owned lifecycle evidence/);
  assert.match(releaseSpec, /P5 IFC owned lifecycle evidence/);
});

test("P5 pinned source fixtures are byte-exact PDF and renderable IFC inputs", async () => {
  for (const fixture of P5_SOURCE_FIXTURES) {
    const bytes = fixture.file
      ? await readFile(new URL(fixture.file, import.meta.url))
      : Buffer.from(await (await fetch(fixture.url)).arrayBuffer());
    assert.equal(bytes.byteLength, fixture.byteSize);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      fixture.sha256,
    );
  }
});

test("P5 evidence validates exact workload, lifecycle, immutable hashes, and honest statuses", () => {
  const evidence = {
    schemaVersion: 1,
    status: "MEASURED",
    authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
    sourceCommitSha: "1".repeat(40),
    browserName: "chromium",
    browserVersion: "140.0.7339.16",
    viewport: { width: 1440, height: 900 },
    workload: {
      objects: 10_000,
      sourceLinks: 2_000,
      selectedIfcModels: 1,
      activeComparePages: 1,
    },
    lifecycle: {
      ifcFetches: 1,
      ifcCanvasesAfterUnmount: 0,
      ifcOwnedDisposals: 1,
      ifcContextLossRequests: 1,
    },
    sourceObservation: {
      observedBy: "browser_mutation_workflow",
      runId: "00000000-0000-4000-8000-000000000099",
      before: P5_SOURCE_FIXTURES.map(({ kind, byteSize, sha256 }, index) => ({
        kind,
        byteSize,
        sha256,
        fileRow: {
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          byteSize,
          sha256,
        },
      })),
      after: P5_SOURCE_FIXTURES.map(({ kind, byteSize, sha256 }, index) => ({
        kind,
        byteSize,
        sha256,
        fileRow: {
          id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          byteSize,
          sha256,
        },
      })),
    },
    firstUsableMs: 5_900,
    firstUsableTargetMs: 2_500,
    firstUsableTargetStatus: "NOT MET",
    p7SixtyFpsGate: "UNEXECUTED",
    productionAuthority: "UNEXECUTED",
    productionStorageCors: "UNEXECUTED",
    productionSignedUrls: "UNEXECUTED",
    productionTwoUserProvider: "UNEXECUTED",
  };
  assert.deepEqual(
    validateDrawingP5ReleaseEvidence(evidence, "1".repeat(40)),
    evidence,
  );
  assert.throws(
    () =>
      validateDrawingP5ReleaseEvidence(
        {
          ...evidence,
          workload: { ...evidence.workload, sourceLinks: 1_999 },
        },
        "1".repeat(40),
      ),
    /source links/,
  );
  assert.throws(
    () =>
      validateDrawingP5ReleaseEvidence(
        { ...evidence, firstUsableTargetStatus: "MET" },
        "1".repeat(40),
      ),
    /first usable target status/,
  );
});
