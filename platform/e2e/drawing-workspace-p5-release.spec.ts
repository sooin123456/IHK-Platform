import { createHash } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import {
  P5_SOURCE_FIXTURES,
  drawingP5SourceCommitSha,
  writeDrawingP5ReleaseEvidence,
} from "../scripts/drawing-p5-release-evidence.mjs";

type MountedSnapshot = {
  operationIds: string[];
  sources: Record<string, { sourceKind: string; sourceSha256: string }>;
  undoIds: string[];
};

const canonicalPath = "/workspace-preview/drawing-workspace";
const sha256 = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function sourceByteEvidence(page: Page) {
  const manifestResponse = await page.request.get("/__p5-source-manifest");
  expect(manifestResponse.ok()).toBe(true);
  const rows = (await manifestResponse.json()) as Array<{
    kind: string;
    id: string;
    byteSize: number;
    sha256: string;
    signedUrl: string;
  }>;
  const evidence = [];
  for (const row of rows) {
    const response = await page.request.get(row.signedUrl);
    expect(response.ok()).toBe(true);
    const bytes = await response.body();
    evidence.push({
      kind: row.kind,
      byteSize: bytes.byteLength,
      sha256: sha256(bytes),
      fileRow: {
        id: row.id,
        byteSize: row.byteSize,
        sha256: row.sha256,
      },
    });
  }
  return evidence;
}

let mutationWorkflowEvidence:
  | {
      runId: string;
      before: Awaited<ReturnType<typeof sourceByteEvidence>>;
      after: Awaited<ReturnType<typeof sourceByteEvidence>>;
    }
  | undefined;

async function ready(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
}

async function snapshot(page: Page) {
  return JSON.parse(
    (await page.getByLabel("P5 mounted workspace snapshot").textContent()) ??
      "null",
  ) as MountedSnapshot;
}

test.describe.configure({ mode: "serial", timeout: 10 * 60_000 });

test.beforeAll(() => {
  expect(process.env.P5_RELEASE_PRODUCTION_BUILD).toBe("1");
});

test("canonical P5 entry exposes one coherent PDF and IFC workflow without debug controls", async ({
  page,
}) => {
  const renderingErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") renderingErrors.push(message.text());
  });
  const ifcFetches = { manifest: 0, geometry: 0, raw: 0 };
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("synthetic-ifc-mapping.manifest.json"))
      ifcFetches.manifest += 1;
    else if (pathname.endsWith("synthetic-ifc-mapping.glb"))
      ifcFetches.geometry += 1;
    else if (pathname.endsWith(".ifc")) ifcFetches.raw += 1;
  });

  const sourceBefore = await sourceByteEvidence(page);
  await ready(page, canonicalPath);
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-pdf-current-mounted",
    "true",
    { timeout: 30_000 },
  );
  await expect(
    page.getByText("PDF 원본 배경을 표시하고 있습니다."),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "도면 작업실 보기" }),
  ).toBeVisible();
  await expect(
    page.getByRole("group", { name: "PDF 개정 비교" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "P5 mounted command controls" }),
  ).toHaveCount(0);
  await expect(page.getByText(/"selectedIds"/)).toHaveCount(0);
  expect(ifcFetches).toEqual({ manifest: 0, geometry: 0, raw: 0 });

  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-pdf-previous-mounted",
    "true",
  );
  await page.getByRole("button", { name: "변경 표시 계산" }).click();
  await expect(
    page.locator('[data-pdf-diff-marker="true"][data-listening="false"]'),
  ).not.toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "IFC 3D" }).click();
  await expect(page).toHaveURL(/view=3d/);
  await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(
    1,
    {
      timeout: 60_000,
    },
  );
  await expect(page.getByLabel("IFC 요소 검색")).toBeVisible();
  await expect(page.getByText("3D 요소 115개를 표시했습니다.")).toBeVisible({
    timeout: 60_000,
  });
  const selectable = page.getByRole("button", {
    name: /NZ-PFC Channels beam:300PFC40\.1:691733 #2863 · IfcBeam/,
  });
  await expect(selectable).toBeVisible();
  await selectable.click();
  await expect(page.getByText("선택한 요소: #2863 IfcBeam")).toBeVisible();
  await expect(
    page.getByText(
      "이 IFC에는 브라우저에 표시할 3D 형상이 없습니다. 요소와 속성만 확인할 수 있습니다.",
    ),
  ).toHaveCount(0);
  await expect
    .poll(() => ({ ...ifcFetches }))
    .toEqual({ manifest: 1, geometry: 1, raw: 0 });

  await page.getByRole("button", { name: "2D 도면" }).click();
  await page.getByRole("button", { name: "분할 보기" }).click();
  await expect(page).toHaveURL(/view=split/);
  expect(ifcFetches).toEqual({ manifest: 1, geometry: 1, raw: 0 });
  await page.waitForTimeout(100);
  expect(
    renderingErrors.filter((message) => message.includes("InvalidStateError")),
  ).toEqual([]);

  const sourceAfter = await sourceByteEvidence(page);
  expect(sourceBefore).toEqual(
    P5_SOURCE_FIXTURES.map(({ kind, byteSize, sha256 }) => ({
      kind,
      byteSize,
      sha256,
      fileRow: expect.objectContaining({ byteSize, sha256 }),
    })),
  );
  expect(sourceAfter).toEqual(sourceBefore);

  await page.goto("about:blank");
  await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(0);
});

test("offline unlink and undo survive reopen, acknowledge, and remain denied to Viewer", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const operationPosts: string[] = [];
  const operationResponses: number[] = [];
  const operationResponseBodies: unknown[] = [];
  context.on("request", (request) => {
    const body = request.postData();
    if (request.method() === "POST" && body?.includes('name="operation_json"'))
      operationPosts.push(body);
  });
  context.on("response", (response) => {
    const body = response.request().postData();
    if (
      response.request().method() === "POST" &&
      body?.includes('name="operation_json"')
    ) {
      operationResponses.push(response.status());
      void response.json().then((body) => operationResponseBodies.push(body));
    }
  });
  let page = await context.newPage();
  const path = `${canonicalPath}?p5ReleaseTest=1&realtimeTest=1`;
  const sourceBefore = await sourceByteEvidence(page);
  await ready(page, path);
  await expect(
    page.getByRole("region", { name: "도면 캔버스" }),
  ).toHaveAttribute("data-edit-ready", "true");
  await page.getByRole("button", { name: "P5 연결 객체 선택" }).click();
  const before = await snapshot(page);
  expect(
    Object.values(before.sources).filter(
      ({ sourceKind }) => sourceKind === "ifc_element",
    ),
  ).toHaveLength(1);

  await context.setOffline(true);
  await page.getByRole("button", { name: "원본 근거 해제" }).click();
  await expect
    .poll(async () => Object.keys((await snapshot(page)).sources).length)
    .toBe(0);
  await page.getByRole("button", { name: "실행 취소" }).click();
  await expect
    .poll(async () => Object.keys((await snapshot(page)).sources).length)
    .toBe(1);
  const offline = await snapshot(page);
  expect(offline.operationIds).toHaveLength(before.operationIds.length + 2);
  expect(offline.undoIds.length).toBeGreaterThanOrEqual(before.undoIds.length);
  expect(operationPosts).toHaveLength(0);

  await page.waitForTimeout(250);
  await page.close();
  await context.setOffline(false);
  page = await context.newPage();
  await ready(page, path);
  await expect
    .poll(async () => (await snapshot(page)).operationIds)
    .toEqual(offline.operationIds);
  await expect.poll(() => operationPosts.length, { timeout: 30_000 }).toBe(2);
  await expect
    .poll(() => operationResponses, { timeout: 30_000 })
    .toEqual([200, 200]);
  await expect.poll(() => operationResponseBodies.length).toBe(2);
  expect(operationResponseBodies).toEqual([
    expect.objectContaining({ ok: true }),
    expect.objectContaining({ ok: true }),
  ]);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const request = indexedDB.open("1hk-drawing-workspace", 2);
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const transaction = database.transaction("operations", "readonly");
        const countRequest = transaction.objectStore("operations").count();
        const count = await new Promise<number>((resolve, reject) => {
          countRequest.onsuccess = () => resolve(countRequest.result);
          countRequest.onerror = () => reject(countRequest.error);
        });
        database.close();
        return count;
      }),
    )
    .toBe(0);
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible({ timeout: 30_000 });
  const recoveredOperationIds = offline.operationIds.slice(-2);
  expect(operationPosts[0]).toContain(recoveredOperationIds[0]);
  expect(operationPosts[1]).toContain(recoveredOperationIds[1]);
  expect((await snapshot(page)).sources).toEqual(offline.sources);
  expect(await sourceByteEvidence(page)).toEqual(sourceBefore);
  mutationWorkflowEvidence = {
    runId: crypto.randomUUID(),
    before: sourceBefore,
    after: await sourceByteEvidence(page),
  };

  await page.getByRole("button", { name: "테스트 보기 권한" }).click();
  await expect(
    page.getByRole("button", { name: "원본 근거 해제" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "선택 객체 원본 근거" }),
  ).toContainText("조회 전용");
  await context.close();
});

test("10k objects, 2k links, one IFC, and one compare-page baseline records honest evidence", async ({
  browser,
  browserName,
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(mutationWorkflowEvidence).toBeDefined();
  const ifcFetches = { manifest: 0, geometry: 0, raw: 0 };
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("synthetic-ifc-mapping.manifest.json"))
      ifcFetches.manifest += 1;
    else if (pathname.endsWith("synthetic-ifc-mapping.glb"))
      ifcFetches.geometry += 1;
    else if (pathname.endsWith(".ifc")) ifcFetches.raw += 1;
  });
  await ready(page, `${canonicalPath}?p5BaselineTest=1&view=split`);
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "10000",
    {
      timeout: 60_000,
    },
  );
  await expect(page.getByLabel("P5 baseline object count")).toHaveText("10000");
  await expect(page.getByLabel("P5 baseline source link count")).toHaveText(
    "2000",
  );
  await expect
    .poll(() => ({ ...ifcFetches }))
    .toEqual({ manifest: 1, geometry: 1, raw: 0 });
  await expect(page.getByText("3D 요소 115개를 표시했습니다.")).toBeVisible({
    timeout: 60_000,
  });
  await page
    .getByRole("button", {
      name: /NZ-PFC Channels beam:300PFC40\.1:691733 #2863/,
    })
    .click();
  await expect(page.getByText("선택한 요소: #2863 IfcBeam")).toBeVisible();
  await page.getByRole("button", { name: "겹쳐 보기" }).click();
  await expect(surface).toHaveAttribute("data-pdf-previous-mounted", "true", {
    timeout: 30_000,
  });
  const firstUsableMs = await page.evaluate(() => performance.now());

  await page.getByLabel("IFC 원본 선택").selectOption("");
  await expect(page.getByRole("button", { name: "2D 도면" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(0);
  const ifcCanvasesAfterUnmount = await page
    .locator('canvas[aria-label="IFC 3D 모델"]')
    .count();
  const lifecycleOutput = page.getByLabel("P5 IFC owned lifecycle evidence");
  await expect
    .poll(
      async () =>
        JSON.parse((await lifecycleOutput.textContent()) ?? "{}")
          .ownedDisposals,
    )
    .toBe(1);
  const ifcLifecycleEvidence = JSON.parse(
    (await lifecycleOutput.textContent()) ?? "{}",
  ) as { ownedDisposals: number; contextLossRequests: number };
  const evidence = {
    schemaVersion: 1,
    status: "MEASURED",
    authority: "LOCAL_PRODUCTION_BUILD_CHROMIUM",
    sourceCommitSha: drawingP5SourceCommitSha(),
    browserName,
    browserVersion: browser.version(),
    viewport: { width: 1440, height: 900 },
    workload: {
      objects: 10_000,
      sourceLinks: 2_000,
      selectedIfcModels: 1,
      activeComparePages: 1,
    },
    lifecycle: {
      manifestFetches: ifcFetches.manifest,
      geometryFetches: ifcFetches.geometry,
      rawIfcFetches: ifcFetches.raw,
      ifcCanvasesAfterUnmount,
      ifcOwnedDisposals: ifcLifecycleEvidence.ownedDisposals,
      ifcContextLossRequests: ifcLifecycleEvidence.contextLossRequests,
    },
    derivativeGeometryAuthority:
      "SYNTHETIC_MAPPING_FIXTURE_NOT_SOURCE_FAITHFUL",
    sourceObservation: {
      observedBy: "browser_mutation_workflow",
      ...mutationWorkflowEvidence!,
    },
    firstUsableMs,
    firstUsableTargetMs: 2_500,
    firstUsableTargetStatus: firstUsableMs <= 2_500 ? "MET" : "NOT MET",
    p7SixtyFpsGate: "UNEXECUTED",
    productionAuthority: "UNEXECUTED",
    productionStorageCors: "UNEXECUTED",
    productionSignedUrls: "UNEXECUTED",
    productionTwoUserProvider: "UNEXECUTED",
  };
  const evidencePath = writeDrawingP5ReleaseEvidence(evidence);
  await test.info().attach("P5 release evidence", {
    path: evidencePath,
    contentType: "application/json",
  });
});
