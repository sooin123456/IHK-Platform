import { randomUUID } from "node:crypto";
import os from "node:os";
import { performance } from "node:perf_hooks";

import {
  expect,
  test,
  type BrowserContext,
  type Download,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";

import {
  authenticateApiClient,
  authenticateContext,
  readSourceEvidence,
  seedDrawingP2PerformanceFixture,
} from "./utils/drawing-collaboration-fixture";
import {
  createDrawingEstimatorFixture,
  seedEstimatorBoqStructure,
  type DrawingEstimatorFixture,
} from "./utils/drawing-estimator-fixture";

const baseUrl = "http://127.0.0.1:4000";
const canonicalPath = (projectId: string, workspaceId: string) =>
  `/projects/${projectId}/workspaces/${workspaceId}`;

let fixture: DrawingEstimatorFixture;
let emptyWorkspaceId = "";
let estimatorWorkspaceId = "";
let collaborationWorkspaceId = "";
let pdfWorkspaceId = "";
let boqVersionId = "";
let estimatorObjectIds: Record<"line" | "area" | "count", string>;
let immutableEvidenceBefore: DrawingEstimatorFixture["sourceEvidence"];

type BrowserEvidence = {
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  responseErrors: string[];
};

function trackEvidence(page: Page): BrowserEvidence {
  const evidence: BrowserEvidence = {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    responseErrors: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") evidence.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => evidence.pageErrors.push(error.message));
  page.on("requestfailed", (request) =>
    evidence.requestFailures.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
    ),
  );
  page.on("response", (response) => {
    if (response.status() >= 500)
      evidence.responseErrors.push(`${response.status()} ${response.url()}`);
  });
  return evidence;
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown) {
  await testInfo.attach(name, {
    body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
}

async function waitUntilSaved(page: Page) {
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible({ timeout: 45_000 });
}

async function drawingSurfacePoint(
  page: Page,
  world: { x: number; y: number },
) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Drawing surface has no layout box");
  const [viewportX, viewportY, viewportZoom] = await Promise.all([
    surface.getAttribute("data-viewport-x"),
    surface.getAttribute("data-viewport-y"),
    surface.getAttribute("data-viewport-zoom"),
  ]);
  return {
    x: box.x + Number(viewportX) + world.x * Number(viewportZoom),
    y: box.y + Number(viewportY) + world.y * Number(viewportZoom),
  };
}

async function drawLine(
  page: Page,
  input: { x1: number; y1: number; x2: number; y2: number },
) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Drawing surface has no layout box");
  await page.mouse.click(box.x + input.x1, box.y + input.y1);
  await page.mouse.click(box.x + input.x2, box.y + input.y2);
}

async function drawTwoPointShape(
  page: Page,
  tool: "사각형 도구" | "원 도구",
  input: { x1: number; y1: number; x2: number; y2: number },
) {
  await page.getByRole("button", { name: tool }).click();
  await drawLine(page, input);
}

async function classifySelectedObject(
  page: Page,
  value: {
    name: string;
    classification: string;
    trade: string;
    itemCode: string;
    evidenceKind: string;
    evidenceReason?: string;
  },
) {
  await page.getByRole("tab", { name: "객체" }).click();
  const inspector = page.getByRole("complementary", { name: "속성 검사기" });
  await inspector.getByLabel("객체 이름", { exact: true }).fill(value.name);
  await inspector
    .getByRole("button", { name: "속성 적용", exact: true })
    .click();
  await inspector
    .getByLabel("적산 분류")
    .selectOption({ label: value.classification });
  await inspector.getByLabel("공종").fill(value.trade);
  await inspector.getByLabel("품목 코드").fill(value.itemCode);
  await inspector
    .getByLabel("근거 상태")
    .selectOption({ label: value.evidenceKind });
  if (value.evidenceKind === "가정값")
    await inspector.getByLabel("근거 사유").fill(value.evidenceReason ?? "");
  await inspector.getByRole("button", { name: "사용자 속성 적용" }).click();
  await waitUntilSaved(page);
}

async function openResultRail(page: Page) {
  await page.getByRole("tab", { name: "결과" }).click();
  await expect(page.getByRole("region", { name: "견적 결과" })).toBeVisible();
}

async function bindDraftBoq(page: Page, versionId: string) {
  await page.getByLabel("연결할 내역 버전").selectOption(versionId);
  await page.getByRole("button", { name: "내역 연결" }).click();
}

async function importCompanyRatesAndCreateBoq(
  page: Page,
  currentFixture: DrawingEstimatorFixture,
) {
  await page.getByRole("link", { name: "단가표 가져오기" }).click();
  await page.getByLabel("단가표 이름").fill("1HK E2E 회사 단가");
  await page.getByLabel("단가표 버전").fill("2026-08");
  await page.getByLabel("기준일").fill("2026-08-31");
  await page.getByLabel("사용 근거").selectOption("customer_owned");
  await page
    .getByLabel("단가표 원본 파일")
    .selectOption(currentFixture.rateBookFileId);
  await page.getByLabel("사용권 메모").fill("E2E 고객 보유 단가표");
  await page.getByRole("button", { name: "단가표 근거 등록" }).click();
  await page.getByRole("button", { name: "원본에서 일괄 가져오기" }).click();
  for (const code of ["W-001", "F-001", "D-001"])
    await expect(
      page.getByText(new RegExp(`^${code} ·`)).first(),
    ).toBeVisible();
  await page.getByLabel("내역 제목").fill("A동 실내 적산");
  await page.getByLabel("계산 방식").selectOption("general_half_away");
  await page.getByLabel("수량 소수 자릿수").fill("6");
  await page.getByRole("button", { name: "새 버전" }).click();
  await expect(page).toHaveURL(/\?[^#]*version=[0-9a-f-]{36}/);
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Playwright download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function downloadNamed(page: Page, name: string) {
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("link", { name, exact: true }).click(),
  ]);
  return {
    bytes: await downloadBytes(download),
    filename: download.suggestedFilename(),
  };
}

async function projectCounts(projectId: string) {
  const [files, documents] = await Promise.all([
    fixture.admin
      .from("lukas_qto_files")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId),
    fixture.admin
      .from("lukas_drawing_documents")
      .select("id,source_file_id")
      .eq("project_id", projectId),
  ]);
  if (files.error || documents.error) throw files.error ?? documents.error;
  return { fileCount: files.count, documents: documents.data ?? [] };
}

async function revisionStatus(workspaceId: string) {
  const revision = await fixture.admin
    .from("lukas_drawing_revisions")
    .select("id,status,version")
    .eq("document_id", workspaceId)
    .order("sequence", { ascending: false })
    .limit(1)
    .single();
  if (revision.error) throw revision.error;
  return revision.data;
}

async function objectWorldPoint(objectId: string) {
  const result = await fixture.admin
    .from("lukas_drawing_objects")
    .select("geometry")
    .eq("id", objectId)
    .single();
  if (result.error) throw result.error;
  const geometry = result.data.geometry as any;
  if (geometry.type === "line")
    return {
      x: (geometry.start.x + geometry.end.x) / 2,
      y: (geometry.start.y + geometry.end.y) / 2,
    };
  if (geometry.type === "rectangle")
    return {
      x: geometry.origin.x + geometry.width / 2,
      y: geometry.origin.y + geometry.height / 2,
    };
  if (geometry.center) return geometry.center as { x: number; y: number };
  throw new Error(`Unsupported M1 selection geometry: ${geometry.type}`);
}

async function selectObject(page: Page, objectId: string) {
  await page.getByRole("button", { name: "선택 도구" }).click();
  const point = await drawingSurfacePoint(
    page,
    await objectWorldPoint(objectId),
  );
  await page.mouse.click(point.x, point.y);
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-selection-count",
    "1",
  );
}

async function formValues(button: Locator) {
  const form = button.locator("xpath=ancestor::form");
  return form.evaluate((node) =>
    Object.fromEntries(new FormData(node as HTMLFormElement).entries()),
  ) as Promise<Record<string, string>>;
}

async function persistedCollaborationState(page: Page) {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("1hk-drawing-workspace", 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction("operations", "readonly");
      const rows = await new Promise<
        Array<{
          clientOperationId: string;
          ownerId: string;
          revisionId: string;
        }>
      >((resolve, reject) => {
        const request = transaction.objectStore("operations").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return {
        databases: (await indexedDB.databases()).map(({ name }) => name).sort(),
        rows: rows.sort((left, right) =>
          left.clientOperationId.localeCompare(right.clientOperationId),
        ),
      };
    } finally {
      database.close();
    }
  });
}

async function approvedSnapshot(revisionId: string) {
  const approval = await fixture.admin
    .from("lukas_drawing_revision_approvals")
    .select("snapshot_sha256,subject_version,decided_by")
    .eq("revision_id", revisionId)
    .eq("decision", "approved")
    .single();
  if (approval.error) throw approval.error;
  return approval.data;
}

function percentile(values: number[], fraction: number) {
  if (!values.length) throw new Error("M1 performance sample is empty");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  ];
}

async function noOverlap(first: Locator, second: Locator) {
  const [left, right] = await Promise.all([
    first.boundingBox(),
    second.boundingBox(),
  ]);
  if (!left || !right) return true;
  return (
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

async function containedWithin(inner: Locator, outer: Locator) {
  const [innerBox, outerBox] = await Promise.all([
    inner.boundingBox(),
    outer.boundingBox(),
  ]);
  if (!innerBox || !outerBox)
    throw new Error("M1 layout evidence is unavailable");
  return (
    innerBox.x >= outerBox.x &&
    innerBox.y >= outerBox.y &&
    innerBox.x + innerBox.width <= outerBox.x + outerBox.width &&
    innerBox.y + innerBox.height <= outerBox.y + outerBox.height
  );
}

test.describe
  .serial("1HK Universal Workspace M1 production-shaped authority", () => {
  test.describe.configure({ timeout: 15 * 60_000 });
  test.beforeAll(async () => {
    if (process.env.M1_E2E_DISPOSABLE !== "1")
      throw new Error("M1 E2E requires the disposable Supabase runner");
    fixture = await createDrawingEstimatorFixture();
    immutableEvidenceBefore = structuredClone(fixture.sourceEvidence);
  });

  test("a truly empty project starts on a source-null canonical workspace", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        `/projects/${fixture.emptyProjectId}`,
      );
      await expect(
        page.getByText("아직 등록된 도면이 없습니다."),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "새 작업실" }).first(),
      ).toHaveAttribute(
        "href",
        `/projects/${fixture.emptyProjectId}/workspaces/new`,
      );
      expect(await projectCounts(fixture.emptyProjectId)).toEqual({
        fileCount: 0,
        documents: [],
      });
      await page.getByRole("link", { name: "새 작업실" }).first().click();
      await page.getByRole("heading", { name: "새 작업실" }).waitFor();
      await page.getByLabel("작업실 이름").first().fill("빈 작업실");
      const beforeCreate = await projectCounts(fixture.emptyProjectId);
      await page.getByRole("button", { name: "빈 작업실로 시작" }).click();
      await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
      emptyWorkspaceId = page.url().split("/").at(-1)!;
      await expect(page.getByText("원본 없음 · 빈 캔버스")).toBeVisible();
      const afterCreate = await projectCounts(fixture.emptyProjectId);
      expect(beforeCreate.fileCount).toBe(0);
      expect(afterCreate.fileCount).toBe(0);
      expect(afterCreate.documents).toHaveLength(1);
      expect(afterCreate.documents[0]).toMatchObject({
        id: emptyWorkspaceId,
        source_file_id: null,
      });
    } finally {
      await context.close();
    }
  });

  test("estimator creates line area and count evidence and restores the bound draft after relogin", async ({
    browser,
  }, testInfo) => {
    let context: BrowserContext | null = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      let page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        `/projects/${fixture.projectId}`,
      );
      const evidence = trackEvidence(page);
      await page.getByRole("link", { name: "새 작업실" }).first().click();
      await page.getByLabel("작업실 이름").first().fill("A동 실내 적산");
      await page.getByRole("button", { name: "빈 작업실로 시작" }).click();
      await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
      estimatorWorkspaceId = page.url().split("/").at(-1)!;
      await expect(
        page.getByText("기준 좌표 · 1 도면 단위 = 1 mm"),
      ).toBeVisible();

      await page.getByRole("button", { name: "선 도구" }).click();
      await drawLine(page, { x1: 240, y1: 240, x2: 540, y2: 240 });
      await classifySelectedObject(page, {
        name: "M1 W-001 기준선",
        classification: "벽",
        trade: "금속",
        itemCode: "W-001",
        evidenceKind: "현장 실측",
      });
      await drawTwoPointShape(page, "사각형 도구", {
        x1: 260,
        y1: 320,
        x2: 460,
        y2: 420,
      });
      await classifySelectedObject(page, {
        name: "M1 F-001 바닥",
        classification: "바닥",
        trade: "마감",
        itemCode: "F-001",
        evidenceKind: "가정값",
        evidenceReason: "현장 실측 전 설계 치수 가정",
      });
      await expect(page.getByText("현장 실측 전 설계 치수 가정")).toBeVisible();
      await drawTwoPointShape(page, "원 도구", {
        x1: 560,
        y1: 340,
        x2: 590,
        y2: 340,
      });
      await classifySelectedObject(page, {
        name: "M1 D-001 문",
        classification: "문",
        trade: "창호",
        itemCode: "D-001",
        evidenceKind: "수기 입력",
      });

      const revision = await revisionStatus(estimatorWorkspaceId);
      const objects = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,name")
        .eq("revision_id", revision.id)
        .in("name", ["M1 W-001 기준선", "M1 F-001 바닥", "M1 D-001 문"]);
      if (objects.error || objects.data?.length !== 3)
        throw (
          objects.error ?? new Error("M1 classified objects did not persist")
        );
      const id = (name: string) =>
        objects.data!.find((row) => row.name === name)!.id;
      estimatorObjectIds = {
        line: id("M1 W-001 기준선"),
        area: id("M1 F-001 바닥"),
        count: id("M1 D-001 문"),
      };

      await openResultRail(page);
      await importCompanyRatesAndCreateBoq(page, fixture);
      boqVersionId = new URL(page.url()).searchParams.get("version") ?? "";
      if (!boqVersionId) throw new Error("Draft BOQ version was not returned");
      await seedEstimatorBoqStructure(fixture, boqVersionId);
      await page.getByRole("link", { name: "작업실로 돌아가기" }).click();
      await bindDraftBoq(page, boqVersionId);
      await expect(
        page.getByText("초안", { exact: true }).first(),
      ).toBeVisible();
      const resultRows = page.getByRole("list", { name: "견적 항목" });
      await expect(resultRows).toContainText(/0\.[0-9]+ m/);
      await expect(resultRows).toContainText(/0\.[0-9]+ m2/);
      await expect(resultRows).toContainText("1 EA");
      await expect(page.getByLabel("총 예상 금액")).not.toHaveText(
        /^(?:—|0원)$/,
      );
      await page.reload();
      await expect(resultRows).toContainText("W-001");
      await expect(resultRows).toContainText("F-001");
      await expect(resultRows).toContainText("D-001");
      await context.close();
      context = null;

      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      );
      await openResultRail(page);
      await expect(page.getByRole("list", { name: "견적 항목" })).toContainText(
        /W-001[\s\S]*F-001[\s\S]*D-001/,
      );
      const binding = await fixture.admin
        .from("lukas_drawing_estimate_bindings")
        .select("drawing_revision_id,boq_version_id")
        .eq("drawing_revision_id", revision.id)
        .single();
      if (binding.error) throw binding.error;
      expect(binding.data.boq_version_id).toBe(boqVersionId);

      await selectObject(page, estimatorObjectIds.line);
      await page.getByRole("tab", { name: "댓글·이슈" }).click();
      await page
        .getByLabel("연결할 이슈")
        .selectOption(fixture.existingIssueId);
      await page
        .getByRole("button", { name: "선택 객체를 이슈에 연결" })
        .click();
      const issueLink = await fixture.admin
        .from("lukas_drawing_object_issue_links")
        .select("issue_id,object_id")
        .eq("issue_id", fixture.existingIssueId)
        .eq("object_id", estimatorObjectIds.line)
        .single();
      if (issueLink.error) throw issueLink.error;
      await attachJson(
        testInfo,
        "m1-estimator-browser-network-console",
        evidence,
      );
    } finally {
      if (context) await context.close();
    }
  });

  test("starter and PDF creation are idempotent and the PDF scale measures a known line", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const startPath = `/projects/${fixture.projectId}/workspaces/new`;
      const page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        startPath,
      );
      const starterButton = page.getByRole("button", {
        name: "실내건축 기본 적산 템플릿으로 시작",
      });
      const starterForm = await formValues(starterButton);
      await starterButton.click();
      await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
      collaborationWorkspaceId = page.url().split("/").at(-1)!;
      const starterRevision = await revisionStatus(collaborationWorkspaceId);
      expect(starterRevision.status).toBe("draft");

      const [layers, schemas, table, libraryVersion, imports] =
        await Promise.all([
          fixture.admin
            .from("lukas_drawing_layers")
            .select("name,sort_order")
            .eq("revision_id", starterRevision.id)
            .eq("system_kind", "custom")
            .order("sort_order"),
          fixture.admin
            .from("lukas_drawing_property_schemas")
            .select("name,value_type,enum_options,required,version")
            .eq("revision_id", starterRevision.id),
          fixture.admin
            .from("lukas_drawing_tables")
            .select("name,columns_json,rows_json,version")
            .eq("revision_id", starterRevision.id)
            .eq("name", "기본 내역")
            .single(),
          fixture.admin
            .from("lukas_drawing_library_versions")
            .select("id,source_kind,platform_starter_key,status,content_sha256")
            .eq("organization_id", fixture.organizationId)
            .eq("source_kind", "platform_starter")
            .eq("platform_starter_key", "interior-basic")
            .single(),
          fixture.admin
            .from("lukas_drawing_library_imports")
            .select(
              "id,version_id,target_document_id,target_revision_id,client_request_id",
            )
            .eq("target_document_id", collaborationWorkspaceId),
        ]);
      for (const result of [layers, schemas, table, libraryVersion, imports])
        if (result.error) throw result.error;
      if (!libraryVersion.data)
        throw new Error("M1 starter library version is unavailable");
      expect(layers.data?.map(({ name }) => name)).toEqual([
        "실측",
        "바닥",
        "벽",
        "천장",
        "문·창호",
        "가구",
      ]);
      expect(schemas.data).toHaveLength(5);
      expect(new Set(schemas.data?.map(({ name }) => name))).toEqual(
        new Set(["적산 분류", "공종", "품목 코드", "근거 상태", "근거 사유"]),
      );
      expect(table.data).toMatchObject({
        name: "기본 내역",
        rows_json: [],
        version: 1,
      });
      expect(libraryVersion.data).toMatchObject({
        source_kind: "platform_starter",
        platform_starter_key: "interior-basic",
        status: "published",
      });
      expect(imports.data).toHaveLength(1);
      expect(imports.data?.[0]).toMatchObject({
        version_id: libraryVersion.data.id,
        target_revision_id: starterRevision.id,
        client_request_id: starterForm.clientRequestId,
      });

      const starterRetry = await context.request.post(
        `${baseUrl}${startPath}`,
        {
          form: starterForm,
          maxRedirects: 0,
        },
      );
      expect(starterRetry.status()).toBeGreaterThanOrEqual(300);
      expect(starterRetry.status()).toBeLessThan(400);
      expect(starterRetry.headers().location).toContain(
        canonicalPath(fixture.projectId, collaborationWorkspaceId),
      );
      const [starterDocumentsAfterRetry, importsAfterRetry] = await Promise.all(
        [
          fixture.admin
            .from("lukas_drawing_documents")
            .select("id")
            .eq("project_id", fixture.projectId)
            .eq("created_by", fixture.editor.id)
            .eq("creation_request_id", starterForm.clientRequestId),
          fixture.admin
            .from("lukas_drawing_library_imports")
            .select("id")
            .eq("target_document_id", collaborationWorkspaceId),
        ],
      );
      if (starterDocumentsAfterRetry.error || importsAfterRetry.error)
        throw starterDocumentsAfterRetry.error ?? importsAfterRetry.error;
      expect(starterDocumentsAfterRetry.data).toHaveLength(1);
      expect(importsAfterRetry.data).toHaveLength(1);

      await page.goto(`${baseUrl}${startPath}`);
      const pdfButton = page.getByRole("button", {
        name: "1HK-test-drawing.pdf PDF로 시작",
      });
      const pdfForm = await formValues(pdfButton);
      await pdfButton.click();
      await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
      pdfWorkspaceId = page.url().split("/").at(-1)!;
      await page.getByRole("button", { name: "두 점 선택" }).click();
      const surface = page.getByLabel(/도면 화면/);
      const box = await surface.boundingBox();
      if (!box) throw new Error("M1 PDF canvas has no layout box");
      const reference = {
        x1: Math.max(80, box.width * 0.25),
        y1: Math.max(100, box.height * 0.45),
        x2: Math.max(260, box.width * 0.65),
        y2: Math.max(100, box.height * 0.45),
      };
      await page.mouse.click(box.x + reference.x1, box.y + reference.y1);
      await page.mouse.click(box.x + reference.x2, box.y + reference.y2);
      await page.getByLabel("실제 길이").fill("5");
      await page.getByLabel("단위", { exact: true }).selectOption("m");
      await page.getByRole("button", { name: "축척 저장" }).click();
      await waitUntilSaved(page);
      await page.getByRole("button", { name: "선 도구" }).click();
      await drawLine(page, reference);
      await expect(
        page.getByText("5 m", { exact: true }).first(),
      ).toBeVisible();

      const pdfRetry = await context.request.post(`${baseUrl}${startPath}`, {
        form: pdfForm,
        maxRedirects: 0,
      });
      expect(pdfRetry.status()).toBeGreaterThanOrEqual(300);
      expect(pdfRetry.status()).toBeLessThan(400);
      expect(pdfRetry.headers().location).toContain(
        canonicalPath(fixture.projectId, pdfWorkspaceId),
      );
      const pdfRevision = await revisionStatus(pdfWorkspaceId);
      const [documents, revisions, pages, canvases] = await Promise.all([
        fixture.admin
          .from("lukas_drawing_documents")
          .select("id")
          .eq("project_id", fixture.projectId)
          .eq("created_by", fixture.editor.id)
          .eq("creation_request_id", pdfForm.clientRequestId),
        fixture.admin
          .from("lukas_drawing_revisions")
          .select("id")
          .eq("document_id", pdfWorkspaceId),
        fixture.admin
          .from("lukas_drawing_pages")
          .select("id")
          .eq("revision_id", pdfRevision.id),
        fixture.admin
          .from("lukas_drawing_canvases")
          .select("id")
          .eq("revision_id", pdfRevision.id),
      ]);
      for (const result of [documents, revisions, pages, canvases])
        if (result.error) throw result.error;
      expect(documents.data).toHaveLength(1);
      expect(revisions.data).toHaveLength(1);
      expect(pages.data).toHaveLength(1);
      expect(canvases.data).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test("viewer counterexamples, staged drawing approval, confirmed quantities, BOQ approval, exports, and reverse lineage are exact", async ({
    browser,
  }, testInfo) => {
    const estimatorRevision = await revisionStatus(estimatorWorkspaceId);
    const viewerContext = await browser.newContext();
    const editorContext = await browser.newContext();
    const reviewerContext = await browser.newContext();
    const approverContext = await browser.newContext();
    const boqReviewerContext = await browser.newContext();
    try {
      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      );
      await expect(
        viewerPage.getByRole("button", { name: "선 도구" }),
      ).toHaveCount(0);
      await expect(
        viewerPage.getByRole("button", { name: "내역 연결" }),
      ).toHaveCount(0);
      await expect(
        viewerPage.getByRole("link", { name: "단가표 가져오기" }),
      ).toHaveCount(0);
      const viewer = await authenticateApiClient(fixture, fixture.viewer);
      const viewerOperation = await viewer.rpc(
        "lukas_drawing_apply_operation",
        {
          p_revision_id: estimatorRevision.id,
          p_client_operation_id: randomUUID(),
          p_operation_type: "update_objects",
          p_base_versions: {},
          p_forward: { type: "update_objects", updates: [] },
          p_inverse: { type: "update_objects", updates: [] },
        },
      );
      expect(viewerOperation.error).toBeTruthy();
      const viewerBindingMutation = await viewer
        .from("lukas_drawing_estimate_bindings")
        .update({ boq_version_id: boqVersionId })
        .eq("drawing_revision_id", estimatorRevision.id);
      expect(viewerBindingMutation.error).toBeTruthy();
      const viewerRateMutation = await viewer
        .from("lukas_qto_price_resources")
        .insert({
          id: randomUUID(),
          project_id: fixture.projectId,
          price_book_id: randomUUID(),
          resource_code: "VIEWER-FORBIDDEN",
          resource_type: "material",
          resource_name: "forbidden",
          unit: "EA",
          unit_price_krw: "1",
          created_by: fixture.viewer.id,
        });
      expect(viewerRateMutation.error).toBeTruthy();

      const editorPage = await authenticateContext(
        fixture,
        editorContext,
        fixture.editor,
        baseUrl,
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      );
      await editorPage.getByRole("button", { name: "검토 요청" }).click();
      await expect
        .poll(async () => (await revisionStatus(estimatorWorkspaceId)).status)
        .toBe("review_requested");

      const reviewerPage = await authenticateContext(
        fixture,
        reviewerContext,
        fixture.reviewer,
        baseUrl,
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      );
      await reviewerPage.getByLabel("검토 의견").fill("M1 독립 검토 완료");
      await reviewerPage
        .getByRole("button", { name: "도면 검토 완료" })
        .click();
      await expect
        .poll(async () => (await revisionStatus(estimatorWorkspaceId)).status)
        .toBe("reviewed");

      const approverPage = await authenticateContext(
        fixture,
        approverContext,
        fixture.approver,
        baseUrl,
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      );
      await approverPage.getByLabel("검토 의견").fill("M1 독립 최종 승인");
      await approverPage
        .getByRole("button", { name: "도면 최종 승인" })
        .click();
      await expect
        .poll(async () => (await revisionStatus(estimatorWorkspaceId)).status)
        .toBe("approved");
      const approvals = await fixture.admin
        .from("lukas_drawing_revision_approvals")
        .select("decision,decided_by,snapshot_sha256,subject_version")
        .eq("revision_id", estimatorRevision.id)
        .in("decision", ["reviewed", "approved"])
        .order("created_at");
      if (approvals.error) throw approvals.error;
      expect(approvals.data?.map(({ decision }) => decision)).toEqual([
        "reviewed",
        "approved",
      ]);
      expect(approvals.data?.[0]?.decided_by).toBe(fixture.reviewer.id);
      expect(approvals.data?.[1]?.decided_by).toBe(fixture.approver.id);
      expect(
        new Set([
          fixture.editor.id,
          approvals.data?.[0]?.decided_by,
          approvals.data?.[1]?.decided_by,
        ]).size,
      ).toBe(3);

      await editorPage.reload();
      for (const objectId of [
        estimatorObjectIds.line,
        estimatorObjectIds.area,
        estimatorObjectIds.count,
      ]) {
        await selectObject(editorPage, objectId);
        await editorPage.getByRole("tab", { name: "객체" }).click();
        await editorPage
          .getByRole("button", { name: "확정 근거 만들기" })
          .first()
          .click();
      }
      const snapshot = await approvedSnapshot(estimatorRevision.id);
      const quantities = await fixture.admin
        .from("lukas_drawing_quantity_links")
        .select(
          "id,drawing_object_id,drawing_snapshot_sha256,measurement_kind,raw_quantity,unit",
        )
        .eq("drawing_revision_id", estimatorRevision.id)
        .in("drawing_object_id", Object.values(estimatorObjectIds));
      if (quantities.error) throw quantities.error;
      expect(quantities.data).toHaveLength(3);
      expect(
        new Set(
          quantities.data?.map(({ measurement_kind }) => measurement_kind),
        ),
      ).toEqual(new Set(["length", "area", "count"]));
      expect(
        quantities.data?.every(
          ({ drawing_snapshot_sha256 }) =>
            drawing_snapshot_sha256 === snapshot.snapshot_sha256,
        ),
      ).toBe(true);

      const boqPath = `/projects/${fixture.projectId}/boq?version=${boqVersionId}&returnTo=${encodeURIComponent(
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      )}`;
      await editorPage.goto(`${baseUrl}${boqPath}`);
      const codeByObject = new Map([
        [estimatorObjectIds.line, "W-001"],
        [estimatorObjectIds.area, "F-001"],
        [estimatorObjectIds.count, "D-001"],
      ]);
      const lineLabelByCode = new Map([
        ["W-001", "W-001 경량벽체"],
        ["F-001", "F-001 바닥마감"],
        ["D-001", "D-001 문 세트"],
      ]);
      for (const quantity of quantities.data ?? []) {
        const code = codeByObject.get(quantity.drawing_object_id);
        if (!code)
          throw new Error("M1 confirmed quantity has an unknown object");
        const lineLabel = lineLabelByCode.get(code);
        if (!lineLabel) throw new Error("M1 BOQ line label is unavailable");
        const card = editorPage
          .getByRole("listitem")
          .filter({ hasText: quantity.drawing_object_id });
        await card
          .getByLabel("Drawing 근거를 연결할 품목")
          .selectOption({ label: lineLabel });
        await card.getByLabel("새 Drawing 배분 계수").fill("1");
        await card.getByRole("button", { name: "연결", exact: true }).click();
      }
      await editorPage.getByRole("button", { name: "승인 요청" }).click();
      const boqReviewerPage = await authenticateContext(
        fixture,
        boqReviewerContext,
        fixture.reviewer,
        baseUrl,
        `/projects/${fixture.projectId}/boq`,
      );
      await boqReviewerPage.goto(`${baseUrl}${boqPath}`);
      await boqReviewerPage.getByLabel("승인 결정").selectOption("approved");
      await boqReviewerPage
        .getByLabel("검토 메모")
        .fill("M1 BOQ 수량·단가 검증");
      await boqReviewerPage.getByRole("button", { name: "결정 기록" }).click();
      await expect(
        boqReviewerPage.getByText("승인 완료", { exact: true }).first(),
      ).toBeVisible();

      const csv = await downloadNamed(boqReviewerPage, "CSV");
      const xlsx = await downloadNamed(boqReviewerPage, "Excel");
      const manifestDownload = await downloadNamed(boqReviewerPage, "Manifest");
      expect(csv.bytes.byteLength).toBeGreaterThan(0);
      expect(xlsx.bytes.byteLength).toBeGreaterThan(0);
      expect(manifestDownload.bytes.byteLength).toBeGreaterThan(0);
      expect(csv.filename).toMatch(/\.csv$/i);
      expect(xlsx.filename).toMatch(/\.xlsx$/i);
      const manifest = JSON.parse(manifestDownload.bytes.toString("utf8"));
      const calculation = manifest.calculationManifest;
      expect(calculation.priceBook.sourceSha256).toBe(
        fixture.rateBookEvidence.metadataSha256,
      );
      expect(calculation.result.resultSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(calculation.drawingSources).toHaveLength(3);
      for (const source of calculation.drawingSources) {
        expect(Object.values(estimatorObjectIds)).toContain(source.objectId);
        expect(source.snapshotSha256).toBe(snapshot.snapshot_sha256);
        expect(Number(source.quantity)).toBeGreaterThan(0);
      }
      expect(calculation.result.canonicalLines).toHaveLength(3);
      for (const line of calculation.result.canonicalLines) {
        expect(Number(line.finalQuantity)).toBeGreaterThan(0);
        expect(Number(line.amountKrw)).toBeGreaterThan(0);
      }

      const drawingLink = boqReviewerPage
        .getByRole("link", {
          name: "도면 작업실 열기",
        })
        .first();
      const expectedHref = await drawingLink.getAttribute("href");
      await drawingLink.click();
      await expect(boqReviewerPage).toHaveURL(
        new RegExp(
          `/projects/${fixture.projectId}/workspaces/${estimatorWorkspaceId}\\?`,
        ),
      );
      const reverseUrl = new URL(boqReviewerPage.url());
      expect(reverseUrl.searchParams.get("revision")).toBe(
        estimatorRevision.id,
      );
      expect(Object.values(estimatorObjectIds)).toContain(
        reverseUrl.searchParams.get("object"),
      );
      expect(reverseUrl.searchParams.get("boq")).toBe(boqVersionId);
      expect(reverseUrl.searchParams.get("line")).toBeTruthy();
      await expect(boqReviewerPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selection-count",
        "1",
      );
      await boqReviewerPage
        .getByRole("link", { name: "내역으로 돌아가기" })
        .click();
      await expect(boqReviewerPage).toHaveURL(
        new RegExp(
          `version=${boqVersionId}.*line=${reverseUrl.searchParams.get("line")}`,
        ),
      );
      await expect(
        boqReviewerPage.locator(
          `#boq-line-${reverseUrl.searchParams.get("line")}`,
        ),
      ).toBeFocused();
      expect(expectedHref).toContain(`boq=${boqVersionId}`);

      const immutableEvidenceAfter = await readSourceEvidence(fixture);
      expect(immutableEvidenceAfter).toEqual(immutableEvidenceBefore);
      expect(fixture.rvtImmutabilitySentinelParseable).toBe(false);
      await attachJson(testInfo, "m1-approved-export-manifest", manifest);
      await attachJson(testInfo, "m1-source-sha-before-after", {
        before: immutableEvidenceBefore,
        after: immutableEvidenceAfter,
        rvtSentinel: {
          fileId: fixture.rvtImmutabilitySentinelFileId,
          parseable: false,
          purpose: "storage-byte immutability only",
        },
      });
    } finally {
      await Promise.all([
        viewerContext.close(),
        editorContext.close(),
        reviewerContext.close(),
        approverContext.close(),
        boqReviewerContext.close(),
      ]);
    }
  });

  test("canonical Hocuspocus pages reflect edits and replay one offline outbox operation exactly once", async ({
    browser,
  }, testInfo) => {
    const revision = await revisionStatus(collaborationWorkspaceId);
    expect(revision.status).toBe("draft");
    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const editorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const path = canonicalPath(fixture.projectId, collaborationWorkspaceId);
      const [ownerPage, editorPage] = await Promise.all([
        authenticateContext(
          fixture,
          ownerContext,
          fixture.owner,
          baseUrl,
          path,
        ),
        authenticateContext(
          fixture,
          editorContext,
          fixture.editor,
          baseUrl,
          path,
        ),
      ]);
      for (const page of [ownerPage, editorPage]) {
        await expect(
          page.getByRole("status", { name: "공동 편집 상태: connected" }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          page.getByRole("status", { name: "공동 작업 참여자 2명" }),
        ).toBeVisible({ timeout: 30_000 });
      }

      const collaborativeName = `M1 shared ${randomUUID()}`;
      await ownerPage.getByRole("button", { name: "선 도구" }).click();
      await drawLine(ownerPage, { x1: 280, y1: 260, x2: 500, y2: 260 });
      await ownerPage.getByRole("tab", { name: "객체" }).click();
      await ownerPage
        .getByLabel("객체 이름", { exact: true })
        .fill(collaborativeName);
      await ownerPage.getByRole("button", { name: "속성 적용" }).click();
      await waitUntilSaved(ownerPage);
      const sharedObject = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,geometry,version")
        .eq("revision_id", revision.id)
        .eq("name", collaborativeName)
        .single();
      if (sharedObject.error) throw sharedObject.error;
      await expect(editorPage.getByText(collaborativeName).first()).toBeVisible(
        {
          timeout: 30_000,
        },
      );

      await selectObject(ownerPage, sharedObject.data.id);
      await ownerPage.keyboard.press("ArrowRight");
      await waitUntilSaved(ownerPage);
      const movedObject = await fixture.admin
        .from("lukas_drawing_objects")
        .select("geometry,version")
        .eq("id", sharedObject.data.id)
        .single();
      if (movedObject.error) throw movedObject.error;
      expect(movedObject.data.version).toBeGreaterThan(
        sharedObject.data.version,
      );
      expect(movedObject.data.geometry).not.toEqual(sharedObject.data.geometry);
      await selectObject(editorPage, sharedObject.data.id);
      await expect(editorPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selected-object-name",
        collaborativeName,
      );

      const persistedBefore = await persistedCollaborationState(ownerPage);
      await ownerContext.setOffline(true);
      await ownerPage.keyboard.press("ArrowRight");
      await expect(
        ownerPage.getByRole("status", { name: /저장 상태/ }),
      ).toContainText(/오프라인|저장 중/);
      const persistedOffline = await persistedCollaborationState(ownerPage);
      const beforeIds = new Set(
        persistedBefore.rows.map(({ clientOperationId }) => clientOperationId),
      );
      const offlineRows = persistedOffline.rows.filter(
        ({ clientOperationId }) => !beforeIds.has(clientOperationId),
      );
      expect(offlineRows).toHaveLength(1);
      expect(offlineRows[0]).toMatchObject({
        ownerId: fixture.owner.id,
        revisionId: revision.id,
      });
      await ownerContext.setOffline(false);
      await waitUntilSaved(ownerPage);
      const operations = await fixture.admin
        .from("lukas_drawing_operations")
        .select("id,client_operation_id,actor_id,revision_id")
        .eq("revision_id", revision.id)
        .eq("client_operation_id", offlineRows[0].clientOperationId);
      if (operations.error) throw operations.error;
      expect(operations.data).toHaveLength(1);
      expect(operations.data?.[0]).toMatchObject({
        actor_id: fixture.owner.id,
        revision_id: revision.id,
      });
      await expect
        .poll(async () =>
          (await persistedCollaborationState(ownerPage)).rows.some(
            ({ clientOperationId }) =>
              clientOperationId === offlineRows[0].clientOperationId,
          ),
        )
        .toBe(false);

      await Promise.all([ownerPage.reload(), editorPage.reload()]);
      for (const page of [ownerPage, editorPage]) {
        await expect(page.getByText(collaborativeName)).toHaveCount(1);
        await expect(
          page.getByRole("status", { name: "공동 편집 상태: connected" }),
        ).toBeVisible({ timeout: 30_000 });
      }
      const finalObject = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,name,geometry")
        .eq("id", sharedObject.data.id)
        .single();
      if (finalObject.error) throw finalObject.error;
      await selectObject(editorPage, sharedObject.data.id);
      await expect(editorPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selected-object-name",
        collaborativeName,
      );
      const [ownerPersistence, editorPersistence] = await Promise.all([
        persistedCollaborationState(ownerPage),
        persistedCollaborationState(editorPage),
      ]);
      for (const persisted of [ownerPersistence, editorPersistence])
        expect(persisted.databases).toContain(
          `1hk:drawing-draft:v1:${revision.id}`,
        );
      await attachJson(testInfo, "m1-canonical-collaboration-outbox", {
        canonicalUrl: `${baseUrl}${path}`,
        revisionId: revision.id,
        ownerPersistence,
        editorPersistence,
        offlineClientOperationId: offlineRows[0].clientOperationId,
        persistedOperationCount: operations.data?.length,
        finalGeometry: finalObject.data.geometry,
      });
    } finally {
      await Promise.all([ownerContext.close(), editorContext.close()]);
    }
  });

  test("legacy file, PDF, IFC, BOQ, and Revit routes remain production regressions", async ({
    browser,
  }) => {
    const context = await browser.newContext();
    try {
      const page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        `/projects/${fixture.projectId}/drawings`,
      );
      await page.goto(
        `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}/workspace`,
      );
      await expect(page).toHaveURL(
        new RegExp(
          `/projects/${fixture.projectId}/workspaces/${fixture.pdfWorkspace.documentId}$`,
        ),
      );
      await expect(page.getByLabel(/도면 화면/)).toBeVisible();

      await page.goto(
        `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}`,
      );
      await expect(
        page.getByText("1HK-test-drawing.pdf").first(),
      ).toBeVisible();
      await expect(page.getByText(/PDF/).first()).toBeVisible();
      await page.goto(
        `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.ifcFileId}`,
      );
      await expect(page.getByText("1HK-test-model.ifc").first()).toBeVisible();
      await expect(page.getByText(/IFC/).first()).toBeVisible();
      await page.goto(
        `${baseUrl}/projects/${fixture.projectId}/boq?version=${boqVersionId}`,
      );
      await expect(page.getByText("A동 실내 적산").first()).toBeVisible();

      const revit = await context.request.get(`${baseUrl}/download/revit-2025`);
      expect(revit.ok()).toBe(true);
      expect((await revit.body()).byteLength).toBeGreaterThan(0);
      expect(revit.headers()["content-disposition"]).toMatch(/attachment/i);
    } finally {
      await context.close();
    }
  });

  test("canonical 10k workspace records raw first-usable and frame evidence without widening targets", async ({
    browser,
  }, testInfo) => {
    const performanceFixture = await seedDrawingP2PerformanceFixture(fixture);
    expect(performanceFixture.counts.objects).toBe(10_000);
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const started = performance.now();
      const page = await authenticateContext(
        fixture,
        context,
        fixture.owner,
        baseUrl,
        canonicalPath(fixture.projectId, fixture.blankWorkspace.documentId),
      );
      await expect(page.getByLabel(/도면 화면/)).toBeVisible();
      await expect(page.getByRole("tab", { name: "결과" })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "선택 도구" }),
      ).toBeEnabled();
      const firstUsableMilliseconds = performance.now() - started;
      const selectedObjectId = performanceFixture.objects[0].id;
      await selectObject(page, selectedObjectId);
      const frameTimes = await page.evaluate(async () => {
        const surface = document.querySelector<HTMLElement>(
          "[aria-label*='도면 화면']",
        );
        if (!surface) throw new Error("M1 performance canvas is unavailable");
        surface.focus();
        const samples: number[] = [];
        let prior = performance.now();
        for (let index = 0; index < 180; index += 1) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame((timestamp) => {
              samples.push(timestamp - prior);
              prior = timestamp;
              if (index % 3 === 0)
                surface.dispatchEvent(
                  new WheelEvent("wheel", {
                    bubbles: true,
                    clientX: surface.clientWidth / 2,
                    clientY: surface.clientHeight / 2,
                    deltaY: index % 6 === 0 ? -20 : 20,
                  }),
                );
              else if (index % 3 === 1)
                surface.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    bubbles: true,
                    key: index % 2 === 0 ? "ArrowLeft" : "ArrowRight",
                  }),
                );
              else
                surface.dispatchEvent(
                  new PointerEvent("pointermove", {
                    bubbles: true,
                    clientX: 160 + (index % 40),
                    clientY: 180 + (index % 30),
                    pointerId: 1,
                  }),
                );
              resolve();
            }),
          );
        }
        return samples.slice(1);
      });
      const p50FrameMilliseconds = percentile(frameTimes, 0.5);
      const p95FrameMilliseconds = percentile(frameTimes, 0.95);
      const calculatedFps = 1000 / p95FrameMilliseconds;
      const evidence = {
        authority: "M1_CANONICAL_PRODUCTION_BUILD_10K_V1",
        recordedAt: new Date().toISOString(),
        referenceHardware: {
          platform: os.platform(),
          release: os.release(),
          architecture: os.arch(),
          cpu: os.cpus()[0]?.model ?? "unknown",
          logicalCpuCount: os.cpus().length,
          memoryBytes: os.totalmem(),
        },
        browser: {
          name: browser.browserType().name(),
          version: browser.version(),
          viewport: { width: 1440, height: 900 },
        },
        fixtureCounts: performanceFixture.counts,
        interactionSequence: {
          selectedObjectId,
          frameSamples: "zoom/pan/pointer-move",
        },
        sampleCount: frameTimes.length,
        frameTimesMilliseconds: frameTimes,
        p50FrameMilliseconds,
        p95FrameMilliseconds,
        calculatedFps,
        firstUsableMilliseconds,
        targets: {
          firstUsableMilliseconds: 2500,
          p95FrameMilliseconds: 16.7,
          fps: 60,
        },
        status:
          firstUsableMilliseconds <= 2500 &&
          p95FrameMilliseconds <= 16.7 &&
          calculatedFps >= 60
            ? "PASS"
            : "NOT MET",
      };
      await attachJson(testInfo, "m1-canonical-10k-performance-raw", evidence);
    } finally {
      await context.close();
    }
  });

  test("desktop and compact production layouts, start focus labels, and PDF failure containment have visual evidence", async ({
    browser,
  }, testInfo) => {
    const screenshots: string[] = [];
    const browserEvidence: Array<{
      viewport: { width: number; height: number };
      page: string;
      evidence: BrowserEvidence;
      layout?: Record<string, Awaited<ReturnType<Locator["boundingBox"]>>>;
    }> = [];
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
    ]) {
      const context = await browser.newContext({ viewport });
      try {
        const startPath = `/projects/${fixture.projectId}/workspaces/new`;
        const page = await authenticateContext(
          fixture,
          context,
          fixture.editor,
          baseUrl,
          startPath,
        );
        const startEvidence = trackEvidence(page);
        for (const heading of ["빈 작업실", "템플릿으로 시작", "PDF로 시작"])
          await expect(
            page.getByRole("heading", { name: heading }),
          ).toBeVisible();
        await expect(page.getByLabel("작업실 이름").first()).toBeVisible();
        await expect(
          page.getByRole("button", { name: "빈 작업실로 시작" }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", {
            name: "실내건축 기본 적산 템플릿으로 시작",
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "1HK-test-drawing.pdf PDF로 시작" }),
        ).toBeVisible();
        const startScreenshot = testInfo.outputPath(
          `m1-start-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ fullPage: true, path: startScreenshot });
        await testInfo.attach(`m1-start-${viewport.width}x${viewport.height}`, {
          path: startScreenshot,
          contentType: "image/png",
        });
        screenshots.push(startScreenshot);
        browserEvidence.push({
          viewport,
          page: "start",
          evidence: startEvidence,
        });

        await page.goto(
          `${baseUrl}${canonicalPath(fixture.projectId, estimatorWorkspaceId)}`,
        );
        const workspaceEvidence = trackEvidence(page);
        await page.getByRole("tab", { name: "결과" }).click();
        const surface = page.getByLabel(/도면 화면/);
        const canvas = page.getByRole("region", { name: "도면 캔버스" });
        const leftRail = page.getByRole("complementary", {
          name: "도면 도구 패널",
        });
        const inspector = page.getByRole("complementary", {
          name: "속성 검사기",
        });
        const resultRail = page.getByRole("region", { name: "견적 결과" });
        const bottomTools = page.getByRole("navigation", {
          name: "캔버스 도구",
        });
        const selectTool = page.getByRole("button", { name: "선택 도구" });
        await expect(surface).toBeVisible();
        await expect(leftRail).toBeVisible();
        await expect(canvas).toBeVisible();
        await expect(inspector).toBeVisible();
        await expect(resultRail).toBeVisible();
        await expect(bottomTools).toBeVisible();
        await expect(selectTool).toBeVisible();
        expect(await noOverlap(leftRail, canvas)).toBe(true);
        expect(await noOverlap(canvas, inspector)).toBe(true);
        expect(await noOverlap(leftRail, inspector)).toBe(true);
        expect(await noOverlap(bottomTools, inspector)).toBe(true);
        expect(await containedWithin(bottomTools, canvas)).toBe(true);
        if (viewport.width === 1024) {
          await page.getByRole("tab", { name: "객체" }).click();
          await expect(page.getByRole("tab", { name: "객체" })).toHaveAttribute(
            "aria-selected",
            "true",
          );
          await page.getByRole("tab", { name: "결과" }).click();
        }
        const workspaceScreenshot = testInfo.outputPath(
          `m1-workspace-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ fullPage: true, path: workspaceScreenshot });
        await testInfo.attach(
          `m1-workspace-${viewport.width}x${viewport.height}`,
          { path: workspaceScreenshot, contentType: "image/png" },
        );
        screenshots.push(workspaceScreenshot);
        browserEvidence.push({
          viewport,
          page: "workspace",
          evidence: workspaceEvidence,
          layout: {
            leftRail: await leftRail.boundingBox(),
            canvas: await canvas.boundingBox(),
            inspector: await inspector.boundingBox(),
            bottomTools: await bottomTools.boundingBox(),
          },
        });

        await page.route("**/storage/v1/object/sign/**", (route) =>
          route.abort(),
        );
        await page.goto(
          `${baseUrl}${canonicalPath(fixture.projectId, pdfWorkspaceId)}`,
        );
        await expect(page.getByRole("tab", { name: "결과" })).toBeVisible();
        await expect(
          page.getByRole("button", { name: "선택 도구" }),
        ).toBeVisible();
        await expect(page.getByLabel(/도면 화면/)).toBeVisible();
        const pdfFailureScreenshot = testInfo.outputPath(
          `m1-pdf-failure-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ fullPage: true, path: pdfFailureScreenshot });
        await testInfo.attach(
          `m1-pdf-failure-${viewport.width}x${viewport.height}`,
          { path: pdfFailureScreenshot, contentType: "image/png" },
        );
        screenshots.push(pdfFailureScreenshot);
      } finally {
        await context.close();
      }
    }
    const unexpected = browserEvidence
      .flatMap(({ evidence }) => [
        ...evidence.consoleErrors,
        ...evidence.pageErrors,
        ...evidence.requestFailures,
        ...evidence.responseErrors,
      ])
      .filter(
        (message) => !/pdf|renderer|storage\/v1\/object\/sign/i.test(message),
      );
    expect(unexpected).toEqual([]);
    expect(
      browserEvidence.flatMap(({ evidence }) => evidence.consoleErrors),
    ).not.toEqual(
      expect.arrayContaining([
        expect.stringMatching(/hydration|unhandled|Unexpected error/i),
      ]),
    );
    await attachJson(testInfo, "m1-browser-console-network", {
      screenshots,
      browserEvidence,
      expectedPdfRendererFailure: true,
    });
  });
});
