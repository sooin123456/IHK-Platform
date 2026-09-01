import { createHash, randomUUID } from "node:crypto";
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
  removeEstimatorNegativeLine,
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
let boqStructure: Awaited<ReturnType<typeof seedEstimatorBoqStructure>>;
let immutableEvidenceBefore: DrawingEstimatorFixture["sourceEvidence"];

type BrowserEvidence = {
  consoleErrors: string[];
  pageErrors: string[];
  requestFailures: string[];
  responseErrors: string[];
};

function newBrowserEvidence(): BrowserEvidence {
  return {
    consoleErrors: [],
    pageErrors: [],
    requestFailures: [],
    responseErrors: [],
  };
}

function attachPageEvidence(page: Page, evidence: BrowserEvidence) {
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
}

function trackEvidence(page: Page): BrowserEvidence {
  const evidence = newBrowserEvidence();
  attachPageEvidence(page, evidence);
  return evidence;
}

function trackContextEvidence(context: BrowserContext): BrowserEvidence {
  const evidence = newBrowserEvidence();
  context.on("page", (page) => attachPageEvidence(page, evidence));
  return evidence;
}

function snapshotEvidence(evidence: BrowserEvidence): BrowserEvidence {
  return Object.fromEntries(
    Object.entries(evidence).map(([key, values]) => [key, [...values]]),
  ) as BrowserEvidence;
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

async function drawingSurfaceState(surface: Locator) {
  const [x, y, zoom, selectedObjectId, selectedObjectName] = await Promise.all([
    surface.getAttribute("data-viewport-x"),
    surface.getAttribute("data-viewport-y"),
    surface.getAttribute("data-viewport-zoom"),
    surface.getAttribute("data-selected-object-id"),
    surface.getAttribute("data-selected-object-name"),
  ]);
  return {
    x: Number(x),
    y: Number(y),
    zoom: Number(zoom),
    selectedObjectId: selectedObjectId ?? "",
    selectedObjectName: selectedObjectName ?? "",
  };
}

async function recordInteractionFrames(
  page: Page,
  interact: () => Promise<void>,
) {
  await page.evaluate(() => {
    const recording = {
      complete: false,
      frameTimesMilliseconds: [] as number[],
    };
    (globalThis as any).__m1InteractionRecording = recording;
    let prior = performance.now();
    const sample = (timestamp: number) => {
      recording.frameTimesMilliseconds.push(timestamp - prior);
      prior = timestamp;
      if (recording.frameTimesMilliseconds.length < 24)
        requestAnimationFrame(sample);
      else recording.complete = true;
    };
    requestAnimationFrame(sample);
  });
  await interact();
  return page.evaluate(async () => {
    const recording = (globalThis as any).__m1InteractionRecording as {
      complete: boolean;
      frameTimesMilliseconds: number[];
    };
    if (!recording)
      throw new Error("M1 interaction RAF recording was not initialized");
    while (!recording.complete)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
    return recording.frameTimesMilliseconds;
  });
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
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Drawing surface has no layout box");
  await page.mouse.move(box.x + input.x1, box.y + input.y1);
  await page.mouse.down();
  await page.mouse.move(box.x + input.x2, box.y + input.y2, { steps: 6 });
  await page.mouse.up();
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
  if (value.evidenceKind === "가정값")
    await expect(inspector.getByLabel("근거 사유")).toHaveValue(
      value.evidenceReason ?? "",
    );
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

function estimateRow(page: Page, itemCode: string) {
  return page
    .getByRole("list", { name: "견적 항목" })
    .getByRole("listitem")
    .filter({ has: page.getByText(itemCode, { exact: true }) });
}

function estimateValue(row: Locator, label: "수량" | "단가" | "금액") {
  return row
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::dd");
}

async function expectExactEstimateRow(
  page: Page,
  expected: {
    amount: string;
    code: string;
    quantity: string;
    rate: string;
    state: string;
  },
) {
  const row = estimateRow(page, expected.code);
  await expect(row).toHaveCount(1);
  await expect(estimateValue(row, "수량")).toHaveText(expected.quantity);
  await expect(estimateValue(row, "단가")).toHaveText(expected.rate);
  await expect(estimateValue(row, "금액")).toHaveText(expected.amount);
  await expect(row.getByText(expected.state, { exact: true })).toBeVisible();
}

async function expectExactBoqLine(
  page: Page,
  lineId: string,
  expected: {
    amount: string;
    finalQuantity: string;
    itemCode: string;
    rawQuantity: string;
    rate: string;
  },
) {
  const row = page.locator(`#boq-line-${lineId}`);
  const cells = row.getByRole("cell");
  await expect(row).toHaveCount(1);
  await expect(cells).toHaveCount(8);
  await expect(
    cells.nth(0).getByText(expected.itemCode, { exact: true }),
  ).toBeVisible();
  await expect(cells.nth(1)).toHaveText(expected.rawQuantity);
  await expect(cells.nth(4)).toHaveText(expected.finalQuantity);
  await expect(cells.nth(5)).toHaveText(expected.rate);
  await expect(cells.nth(6)).toHaveText(expected.amount);
  await expect(
    cells.nth(7).getByText("계산 가능", { exact: true }),
  ).toBeAttached();
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

function lineBoundsText(value: unknown) {
  const geometry = value as {
    type?: string;
    start?: { x: number; y: number };
    end?: { x: number; y: number };
  };
  if (geometry.type !== "line" || !geometry.start || !geometry.end)
    throw new Error("M1 collaborative geometry is not the created line");
  return `X ${Math.min(geometry.start.x, geometry.end.x)}–${Math.max(geometry.start.x, geometry.end.x)} · Y ${Math.min(geometry.start.y, geometry.end.y)}–${Math.max(geometry.start.y, geometry.end.y)}`;
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

function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
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

      await page.getByRole("button", { name: "선 도구" }).click();
      await drawLine(page, { x1: 300, y1: 470, x2: 450, y2: 470 });
      await classifySelectedObject(page, {
        name: "M1 임시 천장",
        classification: "천장",
        trade: "마감",
        itemCode: "M1-C-001",
        evidenceKind: "현장 실측",
      });
      await page.getByRole("button", { name: "선 도구" }).click();
      await drawLine(page, { x1: 500, y1: 470, x2: 650, y2: 470 });
      await classifySelectedObject(page, {
        name: "M1 임시 창호",
        classification: "창호",
        trade: "창호",
        itemCode: "M1-WIN-001",
        evidenceKind: "현장 실측",
      });
      await drawTwoPointShape(page, "원 도구", {
        x1: 700,
        y1: 350,
        x2: 720,
        y2: 350,
      });
      await classifySelectedObject(page, {
        name: "M1 임시 가구",
        classification: "가구",
        trade: "가구",
        itemCode: "M1-FUR-001",
        evidenceKind: "수기 입력",
      });
      await drawTwoPointShape(page, "사각형 도구", {
        x1: 680,
        y1: 430,
        x2: 760,
        y2: 480,
      });
      await classifySelectedObject(page, {
        name: "M1 임시 철거",
        classification: "철거",
        trade: "철거",
        itemCode: "M1-DEM-001",
        evidenceKind: "수기 입력",
      });

      const revision = await revisionStatus(estimatorWorkspaceId);
      const classifiedNames = [
        "M1 W-001 기준선",
        "M1 F-001 바닥",
        "M1 D-001 문",
        "M1 임시 천장",
        "M1 임시 창호",
        "M1 임시 가구",
        "M1 임시 철거",
      ];
      const objects = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,name")
        .eq("revision_id", revision.id)
        .in("name", classifiedNames);
      if (objects.error || objects.data?.length !== classifiedNames.length)
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
      const missingRateObjectId = id("M1 임시 천장");
      const classificationOnlyObjectIds = [
        id("M1 임시 창호"),
        id("M1 임시 가구"),
        id("M1 임시 철거"),
      ];
      const classificationSchema = await fixture.admin
        .from("lukas_drawing_property_schemas")
        .select("id")
        .eq("revision_id", revision.id)
        .eq("name", "적산 분류")
        .single();
      if (classificationSchema.error) throw classificationSchema.error;
      const classifications = await fixture.admin
        .from("lukas_drawing_property_values")
        .select("object_id,value")
        .eq("schema_id", classificationSchema.data.id)
        .in(
          "object_id",
          objects.data.map(({ id }) => id),
        );
      if (classifications.error) throw classifications.error;
      const classificationByName = Object.fromEntries(
        objects.data.map((object) => [
          object.name,
          classifications.data?.find((value) => value.object_id === object.id)
            ?.value,
        ]),
      );
      expect(classificationByName).toEqual({
        "M1 D-001 문": "문",
        "M1 F-001 바닥": "바닥",
        "M1 W-001 기준선": "벽",
        "M1 임시 가구": "가구",
        "M1 임시 철거": "철거",
        "M1 임시 천장": "천장",
        "M1 임시 창호": "창호",
      });
      await attachJson(testInfo, "m1-seven-estimator-classifications", {
        classificationByName,
        objectIds: Object.fromEntries(
          objects.data.map(({ id, name }) => [name, id]),
        ),
      });

      for (const objectId of classificationOnlyObjectIds) {
        await selectObject(page, objectId);
        await page.keyboard.press("Backspace");
        await waitUntilSaved(page);
      }
      await expect
        .poll(async () => {
          const result = await fixture.admin
            .from("lukas_drawing_objects")
            .select("id", { count: "exact", head: true })
            .in("id", classificationOnlyObjectIds);
          if (result.error) throw result.error;
          return result.count;
        })
        .toBe(0);

      await openResultRail(page);
      await importCompanyRatesAndCreateBoq(page, fixture);
      boqVersionId = new URL(page.url()).searchParams.get("version") ?? "";
      if (!boqVersionId) throw new Error("Draft BOQ version was not returned");
      boqStructure = await seedEstimatorBoqStructure(fixture, boqVersionId);
      await page.getByRole("link", { name: "작업실로 돌아가기" }).click();
      await bindDraftBoq(page, boqVersionId);
      await expect(
        page.getByText("초안", { exact: true }).first(),
      ).toBeVisible();
      const missingRateRow = estimateRow(page, "M1-C-001");
      await expect(missingRateRow).toHaveCount(1);
      await expect(page.getByLabel("단가 누락 1건")).toBeVisible();
      await expect(page.getByLabel("근거 누락 1건")).toBeVisible();
      await expect(
        missingRateRow.getByText("근거 누락", { exact: true }),
      ).toBeVisible();
      await expect(missingRateRow).toContainText(
        "검토 필요: 단가 자원 연결이 없습니다",
      );
      await expect(estimateValue(missingRateRow, "수량")).toHaveText("0.15 m");
      await expect(estimateValue(missingRateRow, "단가")).toHaveText("—");
      await expect(estimateValue(missingRateRow, "금액")).toHaveText("—");
      await expect(missingRateRow).not.toContainText("0원");
      await expect(
        missingRateRow.getByText("확정", { exact: true }),
      ).toHaveCount(0);
      await expect(page.getByLabel("총 예상 금액")).toHaveText("153,600원");

      await selectObject(page, missingRateObjectId);
      await page.keyboard.press("Backspace");
      await waitUntilSaved(page);
      await expect
        .poll(async () => {
          const result = await fixture.admin
            .from("lukas_drawing_objects")
            .select("id", { count: "exact", head: true })
            .eq("id", missingRateObjectId);
          if (result.error) throw result.error;
          return result.count;
        })
        .toBe(0);
      await removeEstimatorNegativeLine(fixture, {
        lineId: boqStructure.negativeLineId,
        versionId: boqVersionId,
      });
      const removedNegativeLine = await fixture.admin
        .from("lukas_qto_boq_lines")
        .select("id", { count: "exact", head: true })
        .eq("id", boqStructure.negativeLineId)
        .eq("project_id", fixture.projectId)
        .eq("version_id", boqVersionId);
      if (removedNegativeLine.error) throw removedNegativeLine.error;
      expect(removedNegativeLine.count).toBe(0);
      await openResultRail(page);
      await expect(page.getByText("M1-C-001", { exact: true })).toHaveCount(0);
      await expectExactEstimateRow(page, {
        amount: "3,000원",
        code: "W-001",
        quantity: "0.3 m",
        rate: "10,000원",
        state: "초안",
      });
      await expectExactEstimateRow(page, {
        amount: "600원",
        code: "F-001",
        quantity: "0.02 m2",
        rate: "30,000원",
        state: "가정값",
      });
      await expectExactEstimateRow(page, {
        amount: "150,000원",
        code: "D-001",
        quantity: "1 EA",
        rate: "150,000원",
        state: "초안",
      });
      await expect(page.getByLabel("총 예상 금액")).toHaveText("153,600원");
      await page.reload();
      await openResultRail(page);
      await expectExactEstimateRow(page, {
        amount: "3,000원",
        code: "W-001",
        quantity: "0.3 m",
        rate: "10,000원",
        state: "초안",
      });
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
      await expectExactEstimateRow(page, {
        amount: "600원",
        code: "F-001",
        quantity: "0.02 m2",
        rate: "30,000원",
        state: "가정값",
      });
      await expectExactEstimateRow(page, {
        amount: "150,000원",
        code: "D-001",
        quantity: "1 EA",
        rate: "150,000원",
        state: "초안",
      });
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
      await page.getByRole("tab", { name: "객체" }).click();
      await expect(
        page
          .getByLabel("길이 수량")
          .getByText("미리보기 · 5 m", { exact: true }),
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
      await viewerPage.goto(
        `${baseUrl}/projects/${fixture.projectId}/boq?version=${boqVersionId}`,
      );
      await expect(
        viewerPage.getByRole("button", { name: "품목 추가" }),
      ).toHaveCount(0);
      await expect(
        viewerPage.getByRole("button", { name: "승인 요청" }),
      ).toHaveCount(0);
      const viewerBoqAction = await viewerContext.request.post(
        `${baseUrl}/projects/${fixture.projectId}/boq?version=${boqVersionId}`,
        {
          form: {
            adjustment_reason: "",
            intent: "line",
            item_code: "VIEWER-FORBIDDEN",
            item_name: "Viewer forbidden",
            section_id: boqStructure.sectionId,
            signed_adjustment: "0",
            specification: "",
            unit: "EA",
            version_id: boqVersionId,
          },
          maxRedirects: 0,
        },
      );
      expect(viewerBoqAction.status()).toBe(400);
      expect(await viewerBoqAction.text()).toContain(
        "적산 담당자만 이 항목을 작성할 수 있습니다.",
      );
      const viewerSession = await viewer.auth.getSession();
      const accessToken = viewerSession.data.session?.access_token;
      if (!accessToken) throw new Error("Viewer API session is unavailable");
      const restHeaders = {
        apikey: process.env.SUPABASE_ANON_KEY!,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      };
      const viewerBoqLineBefore = await fixture.admin
        .from("lukas_qto_boq_lines")
        .select(
          "id,item_name,specification,unit,signed_adjustment,adjustment_reason",
        )
        .eq("id", boqStructure.lineIdsByCode["W-001"])
        .eq("project_id", fixture.projectId)
        .eq("version_id", boqVersionId)
        .single();
      if (viewerBoqLineBefore.error) throw viewerBoqLineBefore.error;
      const viewerBoqDatabaseMutation = await viewerContext.request.patch(
        `${process.env.SUPABASE_URL}/rest/v1/lukas_qto_boq_lines?id=eq.${boqStructure.lineIdsByCode["W-001"]}`,
        {
          data: { item_name: "Viewer forbidden" },
          headers: restHeaders,
        },
      );
      expect(viewerBoqDatabaseMutation.status()).toBe(200);
      const viewerBoqReturnedRows = await viewerBoqDatabaseMutation.json();
      expect(viewerBoqReturnedRows).toEqual([]);
      const viewerBoqLineAfter = await fixture.admin
        .from("lukas_qto_boq_lines")
        .select(
          "id,item_name,specification,unit,signed_adjustment,adjustment_reason",
        )
        .eq("id", boqStructure.lineIdsByCode["W-001"])
        .eq("project_id", fixture.projectId)
        .eq("version_id", boqVersionId)
        .single();
      if (viewerBoqLineAfter.error) throw viewerBoqLineAfter.error;
      expect(viewerBoqLineAfter.data).toEqual(viewerBoqLineBefore.data);
      const viewerRateMutation = await viewerContext.request.post(
        `${process.env.SUPABASE_URL}/rest/v1/lukas_qto_price_resources`,
        {
          data: {
            created_by: fixture.viewer.id,
            id: randomUUID(),
            price_book_id: boqStructure.priceBookId,
            project_id: fixture.projectId,
            resource_code: "VIEWER-FORBIDDEN",
            resource_name: "forbidden",
            resource_type: "material",
            unit: "EA",
            unit_price_krw: "1",
          },
          headers: restHeaders,
        },
      );
      expect(viewerRateMutation.status()).toBe(403);

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
      const measurementByObject = new Map([
        [
          estimatorObjectIds.line,
          {
            button: "길이 확정 근거 만들기",
            kind: "length",
            quantity: "0.3",
            unit: "m",
          },
        ],
        [
          estimatorObjectIds.area,
          {
            button: "면적 확정 근거 만들기",
            kind: "area",
            quantity: "0.02",
            unit: "m2",
          },
        ],
        [
          estimatorObjectIds.count,
          {
            button: "개수 확정 근거 만들기",
            kind: "count",
            quantity: "1",
            unit: "EA",
          },
        ],
      ]);
      for (const [objectId, expectedMeasurement] of measurementByObject) {
        await selectObject(editorPage, objectId);
        await editorPage.getByRole("tab", { name: "객체" }).click();
        await editorPage
          .getByRole("button", {
            name: expectedMeasurement.button,
            exact: true,
          })
          .click();
      }
      const snapshot = await approvedSnapshot(estimatorRevision.id);
      const quantities = await fixture.admin
        .from("lukas_drawing_quantity_links")
        .select(
          "id,drawing_revision_id,drawing_revision_version,drawing_snapshot_sha256,drawing_object_id,drawing_object_lineage_id,drawing_object_version,object_fingerprint,measurement_kind,raw_quantity,unit,measurement_rule_version",
        )
        .eq("drawing_revision_id", estimatorRevision.id)
        .in("drawing_object_id", Object.values(estimatorObjectIds));
      if (quantities.error) throw quantities.error;
      expect(quantities.data).toHaveLength(3);
      for (const quantity of quantities.data ?? []) {
        const expectedMeasurement = measurementByObject.get(
          quantity.drawing_object_id,
        );
        if (!expectedMeasurement)
          throw new Error("M1 quantity was created for an unknown object");
        expect(quantity).toMatchObject({
          drawing_revision_id: estimatorRevision.id,
          drawing_revision_version: snapshot.subject_version,
          drawing_snapshot_sha256: snapshot.snapshot_sha256,
          measurement_kind: expectedMeasurement.kind,
          measurement_rule_version: "P4_MEASUREMENT_V1",
          raw_quantity: expectedMeasurement.quantity,
          unit: expectedMeasurement.unit,
        });
        expect(quantity.drawing_object_lineage_id).toMatch(/^[0-9a-f-]{36}$/);
        expect(Number(quantity.drawing_object_version)).toBeGreaterThan(0);
        expect(quantity.object_fingerprint).toMatch(/^[0-9a-f]{64}$/);
      }
      await openResultRail(editorPage);
      for (const expected of [
        {
          amount: "3,000원",
          code: "W-001",
          quantity: "0.3 m",
          rate: "10,000원",
          state: "초안",
        },
        {
          amount: "600원",
          code: "F-001",
          quantity: "0.02 m2",
          rate: "30,000원",
          state: "가정값",
        },
        {
          amount: "150,000원",
          code: "D-001",
          quantity: "1 EA",
          rate: "150,000원",
          state: "초안",
        },
      ]) {
        await expectExactEstimateRow(editorPage, expected);
        await expect(estimateRow(editorPage, expected.code)).toContainText(
          "근거 1건",
        );
      }

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
      const boqLinks = await fixture.admin
        .from("lukas_drawing_boq_links")
        .select(
          "id,quantity_link_id,boq_version_id,boq_line_id,allocation_factor",
        )
        .eq("boq_version_id", boqVersionId);
      if (boqLinks.error) throw boqLinks.error;
      expect(boqLinks.data).toHaveLength(3);
      for (const link of boqLinks.data ?? []) {
        const quantity = quantities.data?.find(
          (candidate) => candidate.id === link.quantity_link_id,
        );
        if (!quantity) throw new Error("M1 BOQ link lost its quantity source");
        const code = codeByObject.get(quantity.drawing_object_id)!;
        expect(link).toMatchObject({
          allocation_factor: "1",
          boq_line_id: boqStructure.lineIdsByCode[code],
          boq_version_id: boqVersionId,
          quantity_link_id: quantity.id,
        });
      }
      for (const [code, expected] of Object.entries({
        "D-001": {
          amount: "150,000원",
          finalQuantity: "1 EA",
          rawQuantity: "1",
          rate: "150000 / 0 / 0",
        },
        "F-001": {
          amount: "600원",
          finalQuantity: "0.02 m2",
          rawQuantity: "0.02",
          rate: "30000 / 0 / 0",
        },
        "W-001": {
          amount: "3,000원",
          finalQuantity: "0.3 m",
          rawQuantity: "0.3",
          rate: "10000 / 0 / 0",
        },
      })) {
        await expectExactBoqLine(editorPage, boqStructure.lineIdsByCode[code], {
          ...expected,
          itemCode: code,
        });
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

      await editorPage.goto(
        `${baseUrl}${canonicalPath(fixture.projectId, estimatorWorkspaceId)}`,
      );
      await openResultRail(editorPage);
      for (const expected of [
        {
          amount: "3,000원",
          code: "W-001",
          quantity: "0.3 m",
          rate: "10,000원",
          state: "확정",
        },
        {
          amount: "600원",
          code: "F-001",
          quantity: "0.02 m2",
          rate: "30,000원",
          state: "확정",
        },
        {
          amount: "150,000원",
          code: "D-001",
          quantity: "1 EA",
          rate: "150,000원",
          state: "확정",
        },
      ]) {
        await expectExactEstimateRow(editorPage, expected);
        await expect(estimateRow(editorPage, expected.code)).toContainText(
          "근거 1건",
        );
      }

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
      expect(calculation.priceBook).toEqual({
        effectiveDate: "2026-08-31",
        id: boqStructure.priceBookId,
        rightsBasis: "customer_owned",
        sourceFileId: fixture.rateBookFileId,
        sourceSha256: fixture.rateBookEvidence.metadataSha256,
      });
      expect(calculation.result.resultSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(calculation.boqVersionId).toBe(boqVersionId);
      expect(calculation.projectId).toBe(fixture.projectId);
      expect(calculation.result.directCostKrw).toBe("153600");
      expect(calculation.resources).toHaveLength(3);
      expect(
        Object.fromEntries(
          calculation.resources.map((resource: any) => [
            resource.code,
            resource,
          ]),
        ),
      ).toEqual({
        "D-001": {
          code: "D-001",
          id: boqStructure.resourceIdsByCode["D-001"],
          type: "material",
          unit: "EA",
          unitPriceKrw: "150000",
        },
        "F-001": {
          code: "F-001",
          id: boqStructure.resourceIdsByCode["F-001"],
          type: "material",
          unit: "m2",
          unitPriceKrw: "30000",
        },
        "W-001": {
          code: "W-001",
          id: boqStructure.resourceIdsByCode["W-001"],
          type: "material",
          unit: "m",
          unitPriceKrw: "10000",
        },
      });
      expect(calculation.rateComponents).toHaveLength(3);
      expect(
        Object.fromEntries(
          calculation.rateComponents.map((component: any) => [
            component.lineId,
            component,
          ]),
        ),
      ).toEqual(
        Object.fromEntries(
          ["D-001", "F-001", "W-001"].map((code) => [
            boqStructure.lineIdsByCode[code],
            {
              coefficient: "1",
              id: boqStructure.componentIdsByCode[code],
              lineId: boqStructure.lineIdsByCode[code],
              resourceId: boqStructure.resourceIdsByCode[code],
            },
          ]),
        ),
      );
      expect(calculation.drawingSources).toHaveLength(3);
      for (const source of calculation.drawingSources) {
        const quantity = quantities.data?.find(
          (candidate) => candidate.id === source.quantityLinkId,
        );
        if (!quantity) throw new Error("Manifest has an unknown quantity ID");
        expect(source).toMatchObject({
          lineageId: quantity.drawing_object_lineage_id,
          measurementKind: quantity.measurement_kind,
          measurementRuleVersion: "P4_MEASUREMENT_V1",
          objectFingerprint: quantity.object_fingerprint,
          objectId: quantity.drawing_object_id,
          objectVersion: Number(quantity.drawing_object_version),
          quantityLinkId: quantity.id,
          rawQuantity: quantity.raw_quantity,
          revisionId: estimatorRevision.id,
          revisionVersion: snapshot.subject_version,
          snapshotSha256: snapshot.snapshot_sha256,
          unit: quantity.unit,
        });
      }
      expect(calculation.result.canonicalLines).toHaveLength(3);
      const expectedManifestLines = {
        "D-001": {
          amount: "150000",
          quantity: "1",
          rate: "150000",
          unit: "EA",
        },
        "F-001": { amount: "600", quantity: "0.02", rate: "30000", unit: "m2" },
        "W-001": { amount: "3000", quantity: "0.3", rate: "10000", unit: "m" },
      };
      for (const line of calculation.result.canonicalLines) {
        const expected =
          expectedManifestLines[
            line.itemCode as keyof typeof expectedManifestLines
          ];
        expect(expected).toBeTruthy();
        expect(line).toMatchObject({
          amountKrw: expected.amount,
          drawingQuantityLinkIds: [
            quantities.data?.find(
              (quantity) =>
                codeByObject.get(quantity.drawing_object_id) === line.itemCode,
            )!.id,
          ],
          finalQuantity: expected.quantity,
          lineId: boqStructure.lineIdsByCode[line.itemCode],
          materialUnitPriceKrw: expected.rate,
          rawQuantity: expected.quantity,
          status: "calculated",
          totalUnitPriceKrw: expected.rate,
          unit: expected.unit,
        });
      }
      const expectedMappings = (boqLinks.data ?? [])
        .map((link) => ({
          allocationFactor: "1",
          lineId: link.boq_line_id,
          sourceId: link.quantity_link_id,
          sourceKind: "drawing",
        }))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      expect(calculation.mappings).toHaveLength(3);
      expect(
        [...calculation.mappings].sort((left: any, right: any) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        ),
      ).toEqual(expectedMappings);
      const expectedManifestSha256 = sha256Json(calculation);
      expect(manifest.manifestSha256).toBe(expectedManifestSha256);
      expect(manifest.resultSha256).toBe(calculation.result.resultSha256);
      expect(manifest.approvalEnvelope).toMatchObject({
        decidedBy: fixture.reviewer.id,
        decision: "approved",
        manifestSha256: expectedManifestSha256,
        note: "M1 BOQ 수량·단가 검증",
        resultSha256: calculation.result.resultSha256,
        versionId: boqVersionId,
      });
      expect(manifest.approvalEnvelope.decidedAt).toMatch(
        /^\d{4}-\d{2}-\d{2}T/,
      );
      expect(manifest.evidenceFiles).toEqual([
        {
          fileId: fixture.rateBookFileId,
          sha256: fixture.rateBookEvidence.metadataSha256,
        },
      ]);
      expect(manifest.handoffSha256).toBe(
        sha256Json({
          calculationManifest: calculation,
          approvalEnvelope: manifest.approvalEnvelope,
          resultSha256: manifest.resultSha256,
          manifestSha256: manifest.manifestSha256,
          evidenceFiles: manifest.evidenceFiles,
        }),
      );

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
      await editorPage.getByRole("tab", { name: "객체" }).click();
      await expect(editorPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selected-object-name",
        collaborativeName,
      );
      await expect(editorPage.getByLabel("선택 객체 경계")).toHaveText(
        lineBoundsText(movedObject.data.geometry),
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
      await editorPage.getByRole("tab", { name: "객체" }).click();
      await expect(editorPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selected-object-name",
        collaborativeName,
      );
      await expect(editorPage.getByLabel("선택 객체 경계")).toHaveText(
        lineBoundsText(finalObject.data.geometry),
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
      const page = await authenticateContext(
        fixture,
        context,
        fixture.owner,
        baseUrl,
        `/projects/${fixture.projectId}`,
      );
      const workspaceUrl = `${baseUrl}${canonicalPath(
        fixture.projectId,
        fixture.blankWorkspace.documentId,
      )}`;
      const started = performance.now();
      await page.goto(workspaceUrl);
      await expect(page.getByLabel(/도면 화면/)).toBeVisible();
      await expect(page.getByRole("tab", { name: "결과" })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "선택 도구" }),
      ).toBeEnabled();
      const firstUsableMilliseconds = performance.now() - started;
      const selectedObjectId = performanceFixture.objects[0].id;
      const changedSelectionObjectId = performanceFixture.objects[1].id;
      const selectedObjectName = performanceFixture.objects[0].name;
      const changedSelectionObjectName = performanceFixture.objects[1].name;
      const surface = page.getByLabel(/도면 화면/);
      const stage = surface.locator(".konvajs-content");
      await expect(stage).toBeVisible();
      const stageBox = await stage.boundingBox();
      if (!stageBox) throw new Error("M1 Konva Stage has no layout box");
      const stageCenter = {
        x: stageBox.x + stageBox.width / 2,
        y: stageBox.y + stageBox.height / 2,
      };
      await selectObject(page, selectedObjectId);
      await expect(surface).toHaveAttribute(
        "data-selected-object-id",
        selectedObjectId,
      );
      await expect(surface).toHaveAttribute(
        "data-selected-object-name",
        selectedObjectName,
      );
      const zoomBefore = await drawingSurfaceState(surface);
      const zoomFrames = await recordInteractionFrames(page, async () => {
        await page.mouse.move(stageCenter.x, stageCenter.y);
        await page.mouse.wheel(0, -240);
      });
      await expect
        .poll(async () => (await drawingSurfaceState(surface)).zoom)
        .not.toBe(zoomBefore.zoom);
      const zoomAfter = await drawingSurfaceState(surface);
      await page.getByRole("button", { name: "이동 도구" }).click();
      const panBefore = await drawingSurfaceState(surface);
      const panFrames = await recordInteractionFrames(page, async () => {
        await page.mouse.move(stageCenter.x, stageCenter.y);
        await page.mouse.down();
        await page.mouse.move(stageCenter.x + 80, stageCenter.y + 40, {
          steps: 8,
        });
        await page.mouse.up();
      });
      await expect
        .poll(async () => {
          const current = await drawingSurfaceState(surface);
          return `${current.x},${current.y}`;
        })
        .not.toBe(`${panBefore.x},${panBefore.y}`);
      const panAfter = await drawingSurfaceState(surface);
      await page.getByRole("button", { name: "선택 도구" }).click();
      const changedSelectionPoint = await drawingSurfacePoint(
        page,
        await objectWorldPoint(changedSelectionObjectId),
      );
      const selectionBefore = await drawingSurfaceState(surface);
      const selectionFrames = await recordInteractionFrames(page, () =>
        page.mouse.click(changedSelectionPoint.x, changedSelectionPoint.y),
      );
      await expect(surface).toHaveAttribute(
        "data-selected-object-id",
        changedSelectionObjectId,
      );
      await expect(surface).toHaveAttribute(
        "data-selected-object-name",
        changedSelectionObjectName,
      );
      const selectionAfter = await drawingSurfaceState(surface);
      expect(selectionBefore.selectedObjectId).toBe(selectedObjectId);
      expect(selectionAfter.selectedObjectId).toBe(changedSelectionObjectId);
      const interactionFrameTimesMilliseconds = {
        zoom: zoomFrames,
        pan: panFrames,
        selection: selectionFrames,
      };
      const frameTimes = Object.values(
        interactionFrameTimesMilliseconds,
      ).flat();
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
          changedSelectionObjectId,
          changedSelectionPoint,
          initialSelectionObjectId: selectedObjectId,
          stageCenter,
          viewportState: {
            panAfter,
            panBefore,
            selectionAfter,
            selectionBefore,
            zoomAfter,
            zoomBefore,
          },
          steps: [
            "select first object",
            "wheel zoom on Konva Stage",
            "pointer drag pan on Konva Stage",
            "select second object",
          ],
        },
        sampleCount: frameTimes.length,
        interactionFrameTimesMilliseconds,
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
      expect(firstUsableMilliseconds).toBeLessThanOrEqual(2_500);
      expect(p95FrameMilliseconds).toBeLessThanOrEqual(16.7);
      expect(calculatedFps).toBeGreaterThanOrEqual(60);
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
      focusOrder?: string[];
      layout?: Record<string, Awaited<ReturnType<Locator["boundingBox"]>>>;
    }> = [];
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1024, height: 768 },
    ]) {
      const context = await browser.newContext({ viewport });
      try {
        const contextEvidence = trackContextEvidence(context);
        const startPath = `/projects/${fixture.projectId}/workspaces/new`;
        const page = await authenticateContext(
          fixture,
          context,
          fixture.editor,
          baseUrl,
          startPath,
        );
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
        await page.locator("#start-blank-title").focus();
        const focusOrder: string[] = [];
        for (let index = 0; index < 24; index += 1) {
          const card = await page.evaluate(() =>
            document.activeElement
              ?.closest("section")
              ?.getAttribute("aria-labelledby"),
          );
          if (card && focusOrder.at(-1) !== card) focusOrder.push(card);
          if (card === "pdf-workspace-title") break;
          await page.keyboard.press("Tab");
        }
        expect(focusOrder.slice(0, 3)).toEqual([
          "blank-workspace-title",
          "starter-workspace-title",
          "pdf-workspace-title",
        ]);
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
          evidence: snapshotEvidence(contextEvidence),
          focusOrder,
        });

        await page.goto(
          `${baseUrl}${canonicalPath(fixture.projectId, estimatorWorkspaceId)}`,
        );
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
          evidence: snapshotEvidence(contextEvidence),
          layout: {
            leftRail: await leftRail.boundingBox(),
            canvas: await canvas.boundingBox(),
            inspector: await inspector.boundingBox(),
            bottomTools: await bottomTools.boundingBox(),
          },
        });

        let pdfSignRequestAborted = false;
        await page.route("**/storage/v1/object/sign/**", (route) => {
          pdfSignRequestAborted = true;
          return route.abort();
        });
        await page.goto(
          `${baseUrl}${canonicalPath(fixture.projectId, pdfWorkspaceId)}`,
        );
        await expect(page.getByRole("tab", { name: "결과" })).toBeVisible();
        await expect(
          page.getByRole("button", { name: "선택 도구" }),
        ).toBeVisible();
        await expect(page.getByLabel(/도면 화면/)).toBeVisible();
        expect(pdfSignRequestAborted).toBe(true);
        const pdfFailureScreenshot = testInfo.outputPath(
          `m1-pdf-failure-${viewport.width}x${viewport.height}.png`,
        );
        await page.screenshot({ fullPage: true, path: pdfFailureScreenshot });
        await testInfo.attach(
          `m1-pdf-failure-${viewport.width}x${viewport.height}`,
          { path: pdfFailureScreenshot, contentType: "image/png" },
        );
        screenshots.push(pdfFailureScreenshot);
        browserEvidence.push({
          viewport,
          page: "pdf-failure",
          evidence: snapshotEvidence(contextEvidence),
        });
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
