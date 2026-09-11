import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
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
import { PDFDocument } from "pdf-lib";
import { createClient } from "@supabase/supabase-js";

import {
  authenticateApiClient,
  authenticateContext,
  readSourceEvidence,
  seedDrawingP2PerformanceFixture,
} from "./utils/drawing-collaboration-fixture";
import {
  createDrawingEstimatorFixture,
  M4_DXF_ASCII,
  M4_DXF_SHA256,
  removeEstimatorNegativeLine,
  seedDrawingIfcDerivativeFixture,
  seedEstimatorBoqStructure,
  type DrawingEstimatorFixture,
} from "./utils/drawing-estimator-fixture";
import {
  buildMaterialControlSummaries,
  carbonFactorRow,
  materialPlanRow,
  materialTransactionRow,
} from "../app/lukas/lib/material-control.server";
import {
  nearestRankPercentile,
  summarizeInteractionFrameTimes,
} from "./utils/drawing-performance-evidence";
import { proveNativeDrawingDwgExport } from "./utils/drawing-native-dwg-export-evidence";

const baseUrl = "http://127.0.0.1:4000";
const canonicalPath = (projectId: string, workspaceId: string) =>
  `/projects/${projectId}/workspaces/${workspaceId}`;

let fixture: DrawingEstimatorFixture;
let emptyWorkspaceId = "";
let estimatorWorkspaceId = "";
let collaborationWorkspaceId = "";
let pdfWorkspaceId = "";
let sourceIntegrationWorkspaceId = "";
let dxfWorkspaceId = "";
let boqVersionId = "";
let estimatorObjectIds: Record<"line" | "area" | "count", string>;
let boqStructure: Awaited<ReturnType<typeof seedEstimatorBoqStructure>>;
let immutableEvidenceBefore: DrawingEstimatorFixture["sourceEvidence"];
let m4IfcDerivative: Awaited<
  ReturnType<typeof seedDrawingIfcDerivativeFixture>
>;

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
    if (message.type() === "error") {
      const locationUrl = message.location().url;
      evidence.consoleErrors.push(
        locationUrl ? `${message.text()} ${locationUrl}` : message.text(),
      );
    }
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

async function expectReadyIfcViewer(page: Page) {
  const viewer = page.getByRole("img", { name: "IFC 3D 모델 화면" });
  await expect(viewer).toBeVisible({ timeout: 60_000 });
  await expect(viewer).toHaveAttribute("data-viewer-phase", "ready", {
    timeout: 60_000,
  });
  await expect(
    viewer.locator('canvas[aria-label="IFC 3D 모델"]'),
  ).toBeVisible();
  await expect(
    viewer
      .locator("xpath=ancestor::section[1]")
      .getByRole("button", { name: "전체 보기", exact: true }),
  ).toBeEnabled();
}

function trackContextEvidence(
  context: BrowserContext,
  evidence = newBrowserEvidence(),
): BrowserEvidence {
  context.on("page", (page) => attachPageEvidence(page, evidence));
  return evidence;
}

type CollaborationStatusObservation = {
  name: "Owner" | "Editor" | "Viewer";
  page: Page;
  readOnly: boolean;
  violations: string[];
  stopNodeObservation?: () => void;
};

function recordCollaborationObservationViolation(
  observation: CollaborationStatusObservation,
  violation: string,
) {
  if (!observation.violations.includes(violation))
    observation.violations.push(violation);
}

async function startCollaborationStatusObservation(
  observation: CollaborationStatusObservation,
) {
  const closed = () =>
    recordCollaborationObservationViolation(
      observation,
      `${observation.name} page closed during reflection sampling`,
    );
  const crashed = () =>
    recordCollaborationObservationViolation(
      observation,
      `${observation.name} page crashed during reflection sampling`,
    );
  observation.page.on("close", closed);
  observation.page.on("crash", crashed);
  observation.stopNodeObservation = () => {
    observation.page.off("close", closed);
    observation.page.off("crash", crashed);
  };
  await observation.page.evaluate(
    ({ name, readOnly }) => {
      const state = { violations: [] as string[] };
      const recordViolation = (violation: string) => {
        if (!state.violations.includes(violation))
          state.violations.push(violation);
      };
      const collaboration = document.querySelector<HTMLElement>(
        '[role="status"][aria-label^="공동 편집 상태:"]',
      );
      const participants = document.querySelector<HTMLElement>(
        '[role="status"][aria-label^="공동 작업 참여자"]',
      );
      const inspect = () => {
        const currentCollaboration = document.querySelector<HTMLElement>(
          '[role="status"][aria-label^="공동 편집 상태:"]',
        );
        const currentParticipants = document.querySelector<HTMLElement>(
          '[role="status"][aria-label^="공동 작업 참여자"]',
        );
        if (
          currentCollaboration?.getAttribute("aria-label") !==
          "공동 편집 상태: connected"
        )
          recordViolation(`${name} collaboration status was not connected`);
        if (
          currentParticipants?.getAttribute("aria-label") !==
          "공동 작업 참여자 3명"
        )
          recordViolation(`${name} participant count was not three`);
        if (
          readOnly &&
          !currentCollaboration?.textContent?.includes("읽기 전용")
        )
          recordViolation(`${name} Viewer was not read-only`);
      };
      if (!collaboration)
        recordViolation(
          `${name} collaboration status observer was unavailable`,
        );
      if (!participants)
        recordViolation(`${name} participant observer was unavailable`);
      const handleRecords = (records: MutationRecord[]) => {
        for (const record of records) {
          if (record.type === "attributes") {
            const expected =
              record.target === collaboration
                ? "공동 편집 상태: connected"
                : "공동 작업 참여자 3명";
            if (record.oldValue !== expected)
              recordViolation(
                `${name} observed transient status ${record.oldValue ?? "missing"}`,
              );
          }
          if (
            readOnly &&
            record.type !== "attributes" &&
            collaboration?.contains(record.target)
          )
            recordViolation(
              `${name} read-only collaboration status content changed`,
            );
          if (
            readOnly &&
            record.type === "characterData" &&
            record.oldValue !== null &&
            !record.oldValue.includes("읽기 전용")
          )
            recordViolation(`${name} observed missing read-only status text`);
          if (
            record.type === "childList" &&
            ((collaboration !== null &&
              [...record.removedNodes].includes(collaboration)) ||
              (participants !== null &&
                [...record.removedNodes].includes(participants)))
          )
            recordViolation(
              `${name} collaboration status element was replaced`,
            );
        }
        inspect();
      };
      const observer = new MutationObserver(handleRecords);
      if (collaboration)
        observer.observe(collaboration, {
          attributeFilter: ["aria-label"],
          attributeOldValue: true,
          attributes: true,
          characterData: true,
          characterDataOldValue: true,
          childList: true,
          subtree: true,
        });
      if (participants)
        observer.observe(participants, {
          attributeFilter: ["aria-label"],
          attributeOldValue: true,
          attributes: true,
        });
      for (const parent of new Set(
        [collaboration?.parentElement, participants?.parentElement].filter(
          (parent): parent is HTMLElement => parent instanceof HTMLElement,
        ),
      ))
        observer.observe(parent, { childList: true });
      inspect();
      (
        globalThis as typeof globalThis & {
          __m3CollaborationStatusObservation?: {
            dispose(): string[];
            inspect(): string[];
          };
        }
      ).__m3CollaborationStatusObservation = {
        dispose: () => {
          handleRecords(observer.takeRecords());
          observer.disconnect();
          return [...state.violations];
        },
        inspect: () => {
          inspect();
          return [...state.violations];
        },
      };
    },
    { name: observation.name, readOnly: observation.readOnly },
  );
}

async function inspectCollaborationStatusObservations(
  observations: CollaborationStatusObservation[],
) {
  await Promise.all(
    observations.map(async (observation) => {
      if (observation.page.isClosed()) {
        recordCollaborationObservationViolation(
          observation,
          `${observation.name} page closed during reflection sampling`,
        );
        return;
      }
      try {
        const violations = await observation.page.evaluate(() =>
          (
            globalThis as typeof globalThis & {
              __m3CollaborationStatusObservation?: {
                inspect(): string[];
              };
            }
          ).__m3CollaborationStatusObservation?.inspect(),
        );
        if (!violations)
          recordCollaborationObservationViolation(
            observation,
            `${observation.name} collaboration observer was unavailable`,
          );
        else
          for (const violation of violations)
            recordCollaborationObservationViolation(observation, violation);
      } catch (error) {
        recordCollaborationObservationViolation(
          observation,
          `${observation.name} collaboration observer inspection failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
}

async function stopCollaborationStatusObservations(
  observations: CollaborationStatusObservation[],
) {
  for (const observation of observations) observation.stopNodeObservation?.();
  await Promise.all(
    observations.map(async (observation) => {
      if (observation.page.isClosed()) return;
      try {
        const violations = await observation.page.evaluate(() =>
          (
            globalThis as typeof globalThis & {
              __m3CollaborationStatusObservation?: {
                dispose(): string[];
              };
            }
          ).__m3CollaborationStatusObservation?.dispose(),
        );
        if (violations)
          for (const violation of violations)
            recordCollaborationObservationViolation(observation, violation);
      } catch (error) {
        recordCollaborationObservationViolation(
          observation,
          `${observation.name} collaboration observer teardown failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
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

async function expectRegionAnnotationAligned(
  surface: Locator,
  annotation: Locator,
  region: { x: number; y: number; width: number; height: number },
) {
  const [surfaceBox, annotationBox, viewport] = await Promise.all([
    surface.boundingBox(),
    annotation.locator("xpath=..").boundingBox(),
    drawingSurfaceState(surface),
  ]);
  if (!surfaceBox || !annotationBox)
    throw new Error("Drawing region alignment boxes are unavailable");
  const expected = {
    x: surfaceBox.x + viewport.x + region.x * viewport.zoom,
    y: surfaceBox.y + viewport.y + region.y * viewport.zoom,
    width: region.width * viewport.zoom,
    height: region.height * viewport.zoom,
  };
  for (const key of ["x", "y", "width", "height"] as const)
    expect(Math.abs(annotationBox[key] - expected[key]), key).toBeLessThan(2);
}

async function recordInteractionFrames(
  page: Page,
  eventType: "pointerdown" | "wheel",
  interact: () => Promise<void>,
) {
  await page.evaluate(
    (eventType) =>
      new Promise<void>((resolve) => {
        const recording = {
          complete: false,
          frameTimesMilliseconds: [] as number[],
          interactionEventObserved: false,
          stopAfterSampleCount: null as number | null,
        };
        (globalThis as any).__m1InteractionRecording = recording;
        window.addEventListener(
          eventType,
          () => {
            recording.interactionEventObserved = true;
          },
          { capture: true, once: true },
        );
        let prior: number | null = null;
        const sample = (timestamp: number) => {
          if (recording.complete) return;
          if (prior === null) {
            prior = timestamp;
            requestAnimationFrame(sample);
            resolve();
            return;
          }
          const elapsedMilliseconds = timestamp - prior;
          prior = timestamp;
          if (recording.interactionEventObserved)
            recording.frameTimesMilliseconds.push(elapsedMilliseconds);
          if (
            recording.stopAfterSampleCount !== null &&
            recording.frameTimesMilliseconds.length >=
              recording.stopAfterSampleCount
          ) {
            recording.complete = true;
            return;
          }
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }),
    eventType,
  );
  await interact();
  return page.evaluate(async () => {
    const recording = (globalThis as any).__m1InteractionRecording as {
      complete: boolean;
      frameTimesMilliseconds: number[];
      interactionEventObserved: boolean;
      stopAfterSampleCount: number | null;
    };
    if (!recording)
      throw new Error("M1 interaction RAF recording was not initialized");
    if (!recording.interactionEventObserved)
      throw new Error("M1 interaction event was not observed");
    recording.stopAfterSampleCount = Math.max(
      recording.frameTimesMilliseconds.length,
      24,
    );
    if (
      recording.frameTimesMilliseconds.length >= recording.stopAfterSampleCount
    )
      recording.complete = true;
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

async function drawWorldLine(
  page: Page,
  input: { x1: number; y1: number; x2: number; y2: number },
) {
  const start = await drawingSurfacePoint(page, {
    x: input.x1,
    y: input.y1,
  });
  const end = await drawingSurfacePoint(page, { x: input.x2, y: input.y2 });
  await page.mouse.click(start.x, start.y);
  await page.mouse.click(end.x, end.y);
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

async function drawWorldTwoPointShape(
  page: Page,
  tool: "사각형 도구" | "원 도구",
  input: { x1: number; y1: number; x2: number; y2: number },
) {
  await page.getByRole("button", { name: tool }).click();
  const start = await drawingSurfacePoint(page, {
    x: input.x1,
    y: input.y1,
  });
  const end = await drawingSurfacePoint(page, { x: input.x2, y: input.y2 });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
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
  await page.getByRole("radio", { name: "수량·금액", exact: true }).click();
  const openInspector = page.getByRole("button", { name: "속성 검사기 열기", exact: true });
  if (await openInspector.isVisible()) await openInspector.click();
  await page.getByRole("tab", { name: "결과" }).click();
  await expect(page.getByRole("region", { name: "견적 결과" })).toBeVisible();
}

async function openReviewPanel(page: Page) {
  await page.getByRole("radio", { name: "검토", exact: true }).click();
  const openTools = page.getByRole("button", { name: "왼쪽 도구 패널 열기", exact: true });
  if (await openTools.isVisible()) await openTools.click();
  await page.getByRole("tab", { name: "댓글·이슈", exact: true }).click();
}

async function bindDraftBoq(page: Page, versionId: string) {
  await openResultRail(page);
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
  const registerPriceBook = async (input: {
    name: string;
    note: string;
    sourceFileId: string;
    version: string;
  }) => {
    await page.getByLabel("단가표 이름").fill(input.name);
    await page.getByLabel("단가표 버전").fill(input.version);
    await page.getByLabel("기준일").fill("2026-08-31");
    await page.getByLabel("사용 근거").selectOption("customer_owned");
    await page.getByLabel("단가표 원본 파일").selectOption(input.sourceFileId);
    await page.getByLabel("사용권 메모").fill(input.note);
    await page.getByRole("button", { name: "단가표 근거 등록" }).click();
    await expect
      .poll(async () => {
        const result = await currentFixture.admin
          .from("lukas_qto_price_books")
          .select("id")
          .eq("project_id", currentFixture.projectId)
          .eq("source_file_id", input.sourceFileId);
        if (result.error) throw result.error;
        return result.data?.[0]?.id ?? "";
      })
      .toMatch(/^[0-9a-f-]{36}$/);
    const result = await currentFixture.admin
      .from("lukas_qto_price_books")
      .select("id")
      .eq("project_id", currentFixture.projectId)
      .eq("source_file_id", input.sourceFileId)
      .single();
    if (result.error) throw result.error;
    return result.data.id;
  };
  const expectResourceCount = async (priceBookId: string, count: number) => {
    await expect
      .poll(async () => {
        const result = await currentFixture.admin
          .from("lukas_qto_price_resources")
          .select("id", { count: "exact", head: true })
          .eq("project_id", currentFixture.projectId)
          .eq("price_book_id", priceBookId);
        if (result.error) throw result.error;
        return result.count ?? -1;
      })
      .toBe(count);
  };
  const unexpectedDialogs: string[] = [];
  const acceptUnexpectedDialog = async (dialog: {
    accept(): Promise<void>;
    message(): string;
  }) => {
    unexpectedDialogs.push(dialog.message());
    await dialog.accept();
  };
  page.on("dialog", acceptUnexpectedDialog);
  try {
    await page.getByRole("link", { name: "단가표 가져오기" }).click();
  } finally {
    page.off("dialog", acceptUnexpectedDialog);
  }
  expect(
    unexpectedDialogs,
    "saved workspace navigation must not raise an unsaved-work dialog",
  ).toEqual([]);
  await expect(page).toHaveURL(/\/boq(?:\?|$)/, { timeout: 45_000 });

  const invalidPriceBookId = await registerPriceBook({
    name: "1HK E2E 오류 단가",
    note: "E2E 고객 보유 오류 단가표",
    sourceFileId: currentFixture.mixedInvalidRateBookFileId,
    version: "2026-08-ERR",
  });
  await page.getByLabel("가져올 단가표").selectOption(invalidPriceBookId);
  await page.getByRole("button", { name: "단가표 검사" }).click();
  const invalidPreview = page.getByLabel("단가표 가져오기 미리보기");
  await expect(invalidPreview).toBeVisible();
  await expect(invalidPreview).toContainText("유효 1행 · 오류 2건");
  await expect(invalidPreview).toContainText("헤더 매핑");
  for (const header of [
    "1열 · resource_code",
    "2열 · resource_type",
    "3열 · resource_name",
    "4열 · specification",
    "5열 · unit",
    "6열 · unit_price_krw",
  ])
    await expect(invalidPreview).toContainText(header);
  await expect(
    invalidPreview.getByText(
      "3행 · unit_price_krw · 단가표 3행 단가는 음수일 수 없습니다.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    invalidPreview.getByText(
      "4행 · unit · 단가표 4행 단위가 올바르지 않습니다.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    invalidPreview.getByRole("button", { name: "검사 결과 반영" }),
  ).toHaveCount(0);
  const [invalidReport] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    invalidPreview
      .getByRole("link", { name: "오류 CSV 다운로드", exact: true })
      .click(),
  ]);
  expect(invalidReport.suggestedFilename()).toBe("pricebook-import-errors.csv");
  expect((await downloadBytes(invalidReport)).toString("utf8")).toBe(
    "\uFEFFrow,field,reason\r\n3,unit_price_krw,단가표 3행 단가는 음수일 수 없습니다.\r\n4,unit,단가표 4행 단위가 올바르지 않습니다.\r\n",
  );
  await expectResourceCount(invalidPriceBookId, 0);

  const validPriceBookId = await registerPriceBook({
    name: "1HK E2E 회사 단가",
    note: "E2E 고객 보유 단가표",
    sourceFileId: currentFixture.rateBookFileId,
    version: "2026-08",
  });
  await page.getByLabel("가져올 단가표").selectOption(validPriceBookId);
  await page.getByRole("button", { name: "단가표 검사" }).click();
  const validPreview = page.getByLabel("단가표 가져오기 미리보기");
  await expect(validPreview).toBeVisible();
  await expect(validPreview).toContainText("유효 3행 · 오류 0건");
  await expect(
    validPreview.getByRole("button", { name: "검사 결과 반영", exact: true }),
  ).toBeVisible();
  await expect(
    validPreview.getByRole("link", { name: "오류 CSV 다운로드" }),
  ).toHaveCount(0);
  await validPreview
    .getByRole("button", { name: "검사 결과 반영", exact: true })
    .click();
  await expectResourceCount(validPriceBookId, 3);

  const versionForm = page
    .getByRole("button", { name: "새 버전", exact: true })
    .locator("xpath=ancestor::form");
  await versionForm.getByLabel("단가표").selectOption(validPriceBookId);

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
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("link", { name, exact: true }).click(),
  ]);
  return {
    bytes: await downloadBytes(download),
    filename: download.suggestedFilename(),
    url: download.url(),
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

async function canonicalPdfBinding(workspaceId: string) {
  const revision = await revisionStatus(workspaceId);
  const [document, canvas] = await Promise.all([
    fixture.admin
      .from("lukas_drawing_documents")
      .select("id,source_file_id,source_sha256")
      .eq("id", workspaceId)
      .single(),
    fixture.admin
      .from("lukas_drawing_canvases")
      .select(
        "id,page_id,background_source_file_id,background_source_sha256,background_pdf_page",
      )
      .eq("revision_id", revision.id)
      .eq("space_kind", "paper")
      .single(),
  ]);
  if (document.error || canvas.error) throw document.error ?? canvas.error;
  return {
    canvasId: canvas.data.id,
    documentId: document.data.id,
    pageId: canvas.data.page_id,
    pdfPageNumber: canvas.data.background_pdf_page,
    revisionId: revision.id,
    revisionVersion: revision.version,
    sourceFileId: document.data.source_file_id,
    sourceSha256: document.data.source_sha256,
    canvasSourceFileId: canvas.data.background_source_file_id,
    canvasSourceSha256: canvas.data.background_source_sha256,
  };
}

async function exactProjectSourceEvidence(projectId: string, fileId: string) {
  const file = await fixture.admin
    .from("lukas_qto_files")
    .select(
      "id,project_id,kind,original_filename,storage_path,content_type,byte_size,sha256,immutable",
    )
    .eq("id", fileId)
    .eq("project_id", projectId)
    .single();
  if (file.error) throw file.error;
  const stored = await fixture.admin.storage
    .from("lukas-qto")
    .download(file.data.storage_path);
  if (stored.error || !stored.data)
    throw stored.error ?? new Error("Uploaded source bytes are unavailable");
  const bytes = new Uint8Array(await stored.data.arrayBuffer());
  return {
    byteLength: bytes.byteLength,
    contentType: file.data.content_type,
    fileId: file.data.id,
    immutable: file.data.immutable,
    kind: file.data.kind,
    metadataByteLength: Number(file.data.byte_size),
    metadataSha256: file.data.sha256,
    originalFilename: file.data.original_filename,
    projectId: file.data.project_id,
    storageByteSha256: sha256Bytes(bytes),
    storagePath: file.data.storage_path,
  };
}

async function dxfSourceMetadata(sourceFileId: string) {
  const result = await fixture.admin
    .from("lukas_qto_files")
    .select(
      "id,project_id,kind,original_filename,storage_path,content_type,byte_size,sha256,immutable",
    )
    .eq("id", sourceFileId)
    .eq("project_id", fixture.projectId)
    .single();
  if (result.error) throw result.error;
  return result.data;
}

async function canonicalDxfImportGraph(
  workspaceId: string,
  sourceFileId: string,
) {
  const revision = await revisionStatus(workspaceId);
  const sources = await fixture.admin
    .from("lukas_drawing_object_sources")
    .select(
      "id,object_id,revision_id,source_file_id,source_sha256,source_kind,dxf_entity_key,dxf_entity_type,dxf_source_layer,dxf_handle,dxf_unit_code,dxf_unit_source,dxf_importer_version,status,version",
    )
    .eq("revision_id", revision.id)
    .eq("source_file_id", sourceFileId)
    .eq("source_kind", "dxf_entity")
    .eq("status", "active")
    .order("id", { ascending: true });
  if (sources.error) throw sources.error;
  const objectIds = (sources.data ?? []).map((source) => source.object_id);
  if (objectIds.length === 0)
    throw new Error("M4 canonical DXF source graph is not persisted yet");
  const objects = await fixture.admin
    .from("lukas_drawing_objects")
    .select(
      "id,lineage_id,revision_id,page_id,layer_id,name,object_type,geometry,status,version",
    )
    .eq("revision_id", revision.id)
    .in("id", objectIds)
    .eq("status", "active")
    .order("id", { ascending: true });
  if (objects.error) throw objects.error;
  const layerIds = (objects.data ?? []).map((object) => object.layer_id);
  const layers = await fixture.admin
    .from("lukas_drawing_layers")
    .select("id,revision_id,canvas_id,name,visible,locked,system_kind,version")
    .eq("revision_id", revision.id)
    .in("id", layerIds)
    .order("id", { ascending: true });
  if (layers.error) throw layers.error;
  return {
    file: await dxfSourceMetadata(sourceFileId),
    layers: layers.data ?? [],
    objects: objects.data ?? [],
    revision: {
      id: revision.id,
      status: revision.status,
      version: revision.version,
    },
    sources: sources.data ?? [],
  };
}

async function canonicalDxfImportResidue(input: {
  revisionId: string;
  sourceFileId: string;
  layerIds: string[];
  objectIds: string[];
}) {
  const [sources, objects, layers] = await Promise.all([
    fixture.admin
      .from("lukas_drawing_object_sources")
      .select(
        "id,object_id,revision_id,source_file_id,source_sha256,source_kind,dxf_entity_key,dxf_entity_type,dxf_source_layer,dxf_handle,dxf_unit_code,dxf_unit_source,dxf_importer_version,status,version",
      )
      .eq("revision_id", input.revisionId)
      .eq("source_file_id", input.sourceFileId)
      .eq("source_kind", "dxf_entity")
      .order("id", { ascending: true }),
    fixture.admin
      .from("lukas_drawing_objects")
      .select(
        "id,lineage_id,revision_id,page_id,layer_id,name,object_type,geometry,status,version",
      )
      .eq("revision_id", input.revisionId)
      .in("id", input.objectIds)
      .order("id", { ascending: true }),
    fixture.admin
      .from("lukas_drawing_layers")
      .select("id,revision_id,canvas_id,name")
      .eq("revision_id", input.revisionId)
      .in("id", input.layerIds)
      .order("id", { ascending: true }),
  ]);
  const failed = [sources, objects, layers].find((result) => result.error);
  if (failed?.error) throw failed.error;
  const objectRows = objects.data ?? [];
  const sourceRows = sources.data ?? [];
  return {
    active: {
      layers: layers.data ?? [],
      objects: objectRows.filter((object) => object.status === "active"),
      sources: sourceRows.filter((source) => source.status === "active"),
    },
    tombstones: {
      objects: objectRows.filter((object) => object.status === "deleted"),
      sources: sourceRows.filter((source) => source.status === "deleted"),
    },
  };
}

function dxfImportIdentityGraph(
  graph: Awaited<ReturnType<typeof canonicalDxfImportGraph>>,
) {
  const withoutVersion = (value: object) =>
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "version"),
    );
  return {
    file: graph.file,
    layers: graph.layers.map(withoutVersion),
    objects: graph.objects.map(withoutVersion),
    revision: withoutVersion(graph.revision),
    sources: graph.sources.map(withoutVersion),
  };
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
  const surface = page.getByLabel(/도면 화면/);
  const point = await drawingSurfacePoint(
    page,
    await objectWorldPoint(objectId),
  );
  await page.mouse.click(point.x, point.y);
  await expect(surface).toHaveAttribute("data-selection-count", "1");
  await expect(surface).toHaveAttribute("data-selected-object-id", objectId);
}

async function deleteObject(page: Page, objectId: string) {
  const surface = page.getByLabel(/도면 화면/);
  await selectObject(page, objectId);
  await page.keyboard.press("Backspace");
  await expect(surface).toHaveAttribute("data-selected-object-id", "");
  await expect
    .poll(async () => {
      const result = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id", { count: "exact", head: true })
        .eq("id", objectId)
        .eq("status", "active");
      if (result.error) throw result.error;
      return result.count;
    })
    .toBe(0);
  await waitUntilSaved(page);
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
          status: string;
          authoritativeSequence?: number;
          resultVersions?: Record<string, number | null>;
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

async function materialProjectSnapshot(projectId: string) {
  const [links, plans, transactions, factors] = await Promise.all([
    fixture.admin
      .from("lukas_drawing_material_links")
      .select("*")
      .eq("project_id", projectId)
      .order("id"),
    fixture.admin
      .from("lukas_qto_material_plans")
      .select("*")
      .eq("project_id", projectId)
      .order("id"),
    fixture.admin
      .from("lukas_qto_material_transactions")
      .select("*")
      .eq("project_id", projectId)
      .order("id"),
    fixture.admin
      .from("lukas_qto_carbon_factors")
      .select("*")
      .eq("project_id", projectId)
      .order("id"),
  ]);
  const failed = [links, plans, transactions, factors].find(
    (result) => result.error,
  );
  if (failed?.error) throw failed.error;
  return {
    factors: factors.data ?? [],
    links: links.data ?? [],
    plans: plans.data ?? [],
    transactions: transactions.data ?? [],
  };
}

function sortedJson<T>(values: T[]) {
  return values.sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right)),
  );
}

async function workspaceCloneFingerprint(revisionId: string) {
  const results = await Promise.all([
    fixture.admin
      .from("lukas_drawing_pages")
      .select("id,name,sort_order,width_mm,height_mm")
      .eq("revision_id", revisionId),
    fixture.admin
      .from("lukas_drawing_canvases")
      .select(
        "id,page_id,name,space_kind,width_mm,height_mm,background_source_file_id,background_source_sha256,background_pdf_page,calibration,sort_order",
      )
      .eq("revision_id", revisionId),
    fixture.admin
      .from("lukas_drawing_layers")
      .select("id,page_id,canvas_id,name,sort_order,visible,locked,system_kind")
      .eq("revision_id", revisionId),
    fixture.admin
      .from("lukas_drawing_styles")
      .select("id,name,value")
      .eq("revision_id", revisionId),
    fixture.admin
      .from("lukas_drawing_blocks")
      .select("id,name,primitives")
      .eq("revision_id", revisionId),
    fixture.admin
      .from("lukas_drawing_objects")
      .select(
        "id,page_id,layer_id,name,object_type,geometry,style_id,style,status",
      )
      .eq("revision_id", revisionId)
      .eq("status", "active"),
    fixture.admin
      .from("lukas_drawing_block_instances")
      .select("id,block_id,layer_id,name,origin,rotation,scale_x,scale_y")
      .eq("revision_id", revisionId),
    fixture.admin
      .from("lukas_drawing_property_schemas")
      .select("id,name,value_type,enum_options,applies_to,required")
      .eq("revision_id", revisionId),
    fixture.admin
      .from("lukas_drawing_property_values")
      .select("schema_id,object_id,block_instance_id,value")
      .eq("revision_id", revisionId),
    fixture.admin
      .from("lukas_drawing_tables")
      .select("name,columns_json,rows_json")
      .eq("revision_id", revisionId),
  ]);
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
  const [
    pages,
    canvases,
    layers,
    styles,
    blocks,
    objects,
    blockInstances,
    propertySchemas,
    propertyValues,
    tables,
  ] = results.map((result) => (result.data ?? []) as any[]);
  const byId = (rows: any[], identify: (row: any) => string) =>
    new Map(rows.map((row) => [String(row.id), identify(row)]));
  const pageById = byId(pages, (page) => page.name);
  const canvasById = byId(
    canvases,
    (canvas) => `${pageById.get(canvas.page_id)} / ${canvas.name}`,
  );
  const layerById = byId(
    layers,
    (layer) => `${canvasById.get(layer.canvas_id)} / ${layer.name}`,
  );
  const styleById = byId(styles, (style) => style.name);
  const blockById = byId(blocks, (block) => block.name);
  const objectById = byId(objects, (object) => object.name);
  const blockInstanceById = byId(blockInstances, (instance) => instance.name);
  const schemaById = byId(propertySchemas, (schema) => schema.name);
  const reference = (map: Map<string, string>, id: unknown, label: string) => {
    if (id === null || id === undefined) return null;
    const value = map.get(String(id));
    if (!value) throw new Error(`M1 template ${label} reference is missing`);
    return value;
  };
  const geometry = (value: any) =>
    value?.type === "opening" && value.hostWallId
      ? {
          ...value,
          hostWallId: reference(objectById, value.hostWallId, "opening host"),
        }
      : value;
  return {
    pages: sortedJson(
      pages.map(({ name, sort_order, width_mm, height_mm }) => ({
        name,
        sortOrder: sort_order,
        widthMillimeters: width_mm,
        heightMillimeters: height_mm,
      })),
    ),
    canvases: sortedJson(
      canvases.map((canvas) => ({
        page: reference(pageById, canvas.page_id, "canvas page"),
        name: canvas.name,
        spaceKind: canvas.space_kind,
        widthMillimeters: canvas.width_mm,
        heightMillimeters: canvas.height_mm,
        background:
          canvas.background_source_file_id === null
            ? null
            : {
                sourceFileId: canvas.background_source_file_id,
                sourceSha256: canvas.background_source_sha256,
                pdfPageNumber: canvas.background_pdf_page,
                calibration: canvas.calibration,
              },
        sortOrder: canvas.sort_order,
      })),
    ),
    layers: sortedJson(
      layers.map((layer) => ({
        page: reference(pageById, layer.page_id, "layer page"),
        canvas: reference(canvasById, layer.canvas_id, "layer canvas"),
        name: layer.name,
        sortOrder: layer.sort_order,
        visible: layer.visible,
        locked: layer.locked,
        systemKind: layer.system_kind,
      })),
    ),
    styles: sortedJson(styles.map(({ name, value }) => ({ name, value }))),
    blocks: sortedJson(
      blocks.map((block) => ({
        name: block.name,
        primitives: (block.primitives as any[]).map((primitive) => ({
          ...primitive,
          ...(primitive.styleId
            ? {
                styleId: reference(styleById, primitive.styleId, "block style"),
              }
            : {}),
        })),
      })),
    ),
    objects: sortedJson(
      objects.map((object) => ({
        page: reference(pageById, object.page_id, "object page"),
        layer: reference(layerById, object.layer_id, "object layer"),
        name: object.name,
        type: object.object_type,
        geometry: geometry(object.geometry),
        style: reference(styleById, object.style_id, "object style"),
        override: object.style,
      })),
    ),
    blockInstances: sortedJson(
      blockInstances.map((instance) => ({
        block: reference(blockById, instance.block_id, "instance block"),
        layer: reference(layerById, instance.layer_id, "instance layer"),
        name: instance.name,
        origin: instance.origin,
        rotation: instance.rotation,
        scaleX: instance.scale_x,
        scaleY: instance.scale_y,
      })),
    ),
    propertySchemas: sortedJson(
      propertySchemas.map((schema) => ({
        name: schema.name,
        valueType: schema.value_type,
        enumOptions: schema.enum_options,
        appliesTo: schema.applies_to,
        required: schema.required,
      })),
    ),
    propertyValues: sortedJson(
      propertyValues.map((value) => ({
        schema: reference(schemaById, value.schema_id, "property schema"),
        object: reference(objectById, value.object_id, "property object"),
        blockInstance: reference(
          blockInstanceById,
          value.block_instance_id,
          "property block instance",
        ),
        value: value.value,
      })),
    ),
    tables: sortedJson(
      tables.map((table) => {
        const columns = table.columns_json as any[];
        const columnById = new Map(
          columns.map((column) => [String(column.id), column.name]),
        );
        return {
          name: table.name,
          columns: columns.map((column) => ({
            name: column.name,
            kind: column.kind,
            propertySchema: reference(
              schemaById,
              column.propertySchemaId,
              "table property schema",
            ),
          })),
          rows: sortedJson(
            (table.rows_json as any[]).map((row) => ({
              object: reference(objectById, row.objectId, "table object"),
              blockInstance: reference(
                blockInstanceById,
                row.blockInstanceId,
                "table block instance",
              ),
              cells: Object.fromEntries(
                Object.entries(row.cells ?? {})
                  .map(([columnId, value]) => [
                    reference(columnById, columnId, "table cell column"),
                    value,
                  ])
                  .sort(([left], [right]) =>
                    String(left).localeCompare(String(right)),
                  ),
              ),
            })),
          ),
        };
      }),
    ),
  };
}

function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sha256Bytes(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
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

async function visibleBoundingBox(locator: Locator) {
  if (!(await locator.isVisible())) return null;
  return locator.boundingBox();
}

test.describe
  .serial("1HK Universal Workspace M1 production-shaped authority", () => {
  test.describe.configure({ timeout: 15 * 60_000 });
  test.use({ actionTimeout: 30_000 });
  test.beforeAll(async () => {
    if (process.env.M1_E2E_DISPOSABLE !== "1")
      throw new Error("M1 E2E requires the disposable Supabase runner");
    fixture = await createDrawingEstimatorFixture();
    immutableEvidenceBefore = structuredClone(fixture.sourceEvidence);
    m4IfcDerivative = await seedDrawingIfcDerivativeFixture(fixture);
  });

  test("workspace scope uses the signed-in member role and keeps one settings menu", async ({ browser }, testInfo) => {
    for (const identity of [fixture.owner, fixture.viewer]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const evidence = trackContextEvidence(context);
      try {
        const page = await authenticateContext(
          fixture, context, identity, baseUrl,
          `/workspace?space=${fixture.organizationId}`,
        );
        const selector = page.getByRole("combobox", { name: "작업 공간 선택" });
        await expect(selector).toHaveValue(fixture.organizationId);
        await expect(selector).toHaveCount(1);
        const management = page.locator(`a[href="/organizations/${fixture.organizationId}/settings"]`);
        await expect(management).toHaveCount(identity.id === fixture.owner.id ? 1 : 0);
        await expect(page.getByRole("link", { name: "로그아웃", exact: true })).toHaveCount(1);
        await selector.selectOption("shared");
        await expect(selector).toHaveValue("shared");
        await expect(page.locator('a[href^="/organizations/"][href$="/settings"]')).toHaveCount(0);
        const unauthorizedSpace = randomUUID();
        await page.goto(`${baseUrl}/workspace?space=${unauthorizedSpace}`);
        await expect(selector).not.toHaveValue(unauthorizedSpace);
        await expect(page.locator("vite-error-overlay")).toHaveCount(0);
        expect(evidence.pageErrors).toEqual([]);
        expect(evidence.consoleErrors).toEqual([]);
        await attachJson(testInfo, `business-space-${identity.id === fixture.owner.id ? "owner" : "viewer"}`, {
          selectedOrganization: fixture.organizationId,
          canManage: identity.id === fixture.owner.id,
          unauthorizedScopeRejected: true,
          evidence,
        });
      } finally { await context.close(); }
    }
  });

  test("direct blank creation needs no project input and preserves retries, saved geometry, and recent drawings", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const evidence = trackContextEvidence(context);
    try {
      const page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        "/workspace",
      );
      await page
        .locator("summary")
        .filter({ hasText: /^\s*새 도면\s*$/ })
        .click();
      const create = page.getByRole("button", {
        name: "빈 도면으로 시작",
        exact: true,
      });
      const request = await formValues(create);
      expect(request.intent).toBe("quick_blank");
      expect(Object.keys(request).sort()).toEqual([
        "client_created_at",
        "client_request_id",
        "intent",
      ]);
      await create.click();
      await expect(page).toHaveURL(
        /\/projects\/[0-9a-f-]{36}\/workspaces\/[0-9a-f-]{36}$/,
      );
      const firstPath = new URL(page.url()).pathname;
      const [, , projectId, , firstDocumentId] = firstPath.split("/");
      await expect(page.getByText("원본 없음 · 빈 캔버스")).toBeVisible();
      await waitUntilSaved(page);
      const project = await fixture.admin
        .from("lukas_qto_projects")
        .select("owner_id,organization_id,name")
        .eq("id", projectId)
        .single();
      if (project.error) throw project.error;
      expect(project.data).toMatchObject({
        owner_id: fixture.editor.id,
        name: "내 도면",
      });
      const organization = await fixture.admin
        .from("lukas_qto_organizations")
        .select("owner_id,is_personal")
        .eq("id", project.data.organization_id)
        .single();
      if (organization.error) throw organization.error;
      expect(organization.data).toEqual({
        owner_id: fixture.editor.id,
        is_personal: true,
      });

      const retry = await context.request.post(`${baseUrl}/workspace`, {
        form: request,
        maxRedirects: 0,
      });
      expect(retry.status()).toBeGreaterThanOrEqual(300);
      expect(retry.status()).toBeLessThan(400);
      expect(retry.headers().location).toBe(firstPath);
      expect(await projectCounts(projectId)).toMatchObject({
        fileCount: 0,
        documents: [{ id: firstDocumentId, source_file_id: null }],
      });

      await page.getByRole("button", { name: "선 도구", exact: true }).click();
      const surface = page.getByLabel(/도면 화면/);
      const bounds = await surface.boundingBox();
      if (!bounds)
        throw new Error("Quick-created drawing has no canvas bounds");
      await drawLine(page, {
        x1: bounds.width * 0.35,
        y1: bounds.height * 0.3,
        x2: bounds.width * 0.65,
        y2: bounds.height * 0.3,
      });
      const revision = await revisionStatus(firstDocumentId);
      const readObjects = async () => {
        const result = await fixture.admin
          .from("lukas_drawing_objects")
          .select("id,object_type,geometry,version")
          .eq("revision_id", revision.id)
          .order("id");
        if (result.error) throw result.error;
        return result.data;
      };
      await expect.poll(async () => (await readObjects()).length).toBe(1);
      await waitUntilSaved(page);
      const savedObjects = await readObjects();
      expect(savedObjects[0].object_type).toBe("line");
      const renamedTitle = "현장 실측 평면 · 직접 시작";
      const canvasBeforeRename = await surface.elementHandle();
      if (!canvasBeforeRename) throw new Error("Canvas missing before rename");
      const renameControl = page
        .locator("summary")
        .filter({ hasText: /^\s*도면 이름 변경\s*$/ });
      await renameControl.click();
      await page
        .getByRole("textbox", { name: "도면 이름", exact: true })
        .fill(renamedTitle);
      const competingTitle = "동시 수정으로 먼저 저장된 도면";
      const competingRename = await context.request.post(
        `${baseUrl}${firstPath}`,
        {
          form: {
            intent: "rename_drawing_document",
            expectedTitle: "새 도면",
            title: competingTitle,
          },
          maxRedirects: 0,
        },
      );
      expect(competingRename.status()).toBe(200);
      const staleResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" && response.status() === 409,
      );
      await page
        .getByRole("button", { name: "이름 저장", exact: true })
        .click();
      const rejectedRenameResponse = await staleResponse;
      await expect(
        page.getByRole("heading", { name: competingTitle, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("textbox", { name: "도면 이름", exact: true }),
      ).toHaveValue(renamedTitle);
      await expect(
        page
          .locator("details")
          .filter({ has: renameControl })
          .getByRole("alert"),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "이름 저장", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: renamedTitle, exact: true }),
      ).toBeVisible();
      await expect(renameControl).toBeFocused();
      await renameControl.press("Enter");
      await page
        .getByRole("textbox", { name: "도면 이름", exact: true })
        .fill("취소할 이름");
      await page.getByRole("button", { name: "취소", exact: true }).click();
      await expect(renameControl).toBeFocused();
      await expect(
        page.getByRole("heading", { name: renamedTitle, exact: true }),
      ).toBeVisible();
      expect(
        await canvasBeforeRename.evaluate((element) => element.isConnected),
      ).toBe(true);
      expect(await readObjects()).toEqual(savedObjects);
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitUntilSaved(page);
      await expect(surface).toHaveAttribute("data-rendered-object-count", "1");
      await expect(
        page.getByRole("heading", { name: renamedTitle, exact: true }),
      ).toBeVisible();
      expect(await readObjects()).toEqual(savedObjects);

      const retryAfterRename = await context.request.post(
        `${baseUrl}/workspace`,
        { form: request, maxRedirects: 0 },
      );
      expect(retryAfterRename.status()).toBeGreaterThanOrEqual(300);
      expect(retryAfterRename.status()).toBeLessThan(400);
      expect(retryAfterRename.headers().location).toBe(firstPath);
      const persistedTitle = await fixture.admin
        .from("lukas_drawing_documents")
        .select("title")
        .eq("id", firstDocumentId)
        .single();
      if (persistedTitle.error) throw persistedTitle.error;
      expect(persistedTitle.data.title).toBe(renamedTitle);

      await page.goto(`${baseUrl}/workspace`);
      const recent = page.getByRole("region", {
        name: "최근 도면",
        exact: true,
      });
      await expect(recent.locator(`a[href="${firstPath}"]`)).toBeVisible();
      await expect(recent.locator(`a[href="${firstPath}"]`)).toContainText(
        renamedTitle,
      );
      await page
        .locator("summary")
        .filter({ hasText: /^\s*새 도면\s*$/ })
        .click();
      await page
        .getByRole("button", { name: "빈 도면으로 시작", exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/${projectId}/workspaces/[0-9a-f-]{36}$`),
      );
      const secondPath = new URL(page.url()).pathname;
      expect(secondPath).not.toBe(firstPath);
      await waitUntilSaved(page);
      const counts = await projectCounts(projectId);
      expect(counts.fileCount).toBe(0);
      expect(counts.documents).toHaveLength(2);
      expect(
        counts.documents.every((document) => document.source_file_id === null),
      ).toBe(true);
      await page.goto(`${baseUrl}/workspace`);
      await expect(recent.locator(`a[href="${firstPath}"]`)).toBeVisible();
      await expect(recent.locator(`a[href="${secondPath}"]`)).toBeVisible();
      await recent.locator(`a[href="${firstPath}"]`).click();
      await waitUntilSaved(page);
      await expect(surface).toHaveAttribute("data-rendered-object-count", "1");
      expect(await readObjects()).toEqual(savedObjects);
      expect(evidence.pageErrors).toEqual([]);
      const expectedConflictConsole = evidence.consoleErrors.filter(
        (message) =>
          message.startsWith("Failed to load resource:") &&
          message.includes("status of 409") &&
          message.endsWith(rejectedRenameResponse.url()),
      );
      expect(expectedConflictConsole.length).toBeLessThanOrEqual(1);
      expect(evidence.consoleErrors).toEqual(expectedConflictConsole);
      expect(evidence.responseErrors).toEqual([]);
      await attachJson(testInfo, "direct-drawing-start", {
        firstPath,
        secondPath,
        renamedTitle,
        counts,
        savedObjects,
        evidence,
      });
    } finally {
      await context.close();
    }
  });

  test("direct template and import entry share the personal project while forged Viewer targets are rejected", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const viewerContext = await browser.newContext();
    const evidence = trackContextEvidence(context);
    try {
      const page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        "/workspace",
      );
      await page
        .locator("summary")
        .filter({ hasText: /^\s*새 도면\s*$/ })
        .click();
      const templateEntry = page.getByRole("button", {
        name: "템플릿에서 시작",
        exact: true,
      });
      const templateEntryRequest = await formValues(templateEntry);
      expect(templateEntryRequest.intent).toBe("quick_template");
      expect(Object.keys(templateEntryRequest).sort()).toEqual([
        "client_created_at",
        "client_request_id",
        "intent",
      ]);
      await templateEntry.click();
      await expect(page).toHaveURL(
        /\/projects\/[0-9a-f-]{36}\/workspaces\/new#starter-workspace-title$/,
      );
      const projectId = new URL(page.url()).pathname.split("/")[2];
      const before = await projectCounts(projectId);
      expect(before.documents).toHaveLength(2);
      const templateButton = page.getByRole("button", {
        name: "실내건축 기본 적산 템플릿으로 시작",
        exact: true,
      });
      const templateRequest = await formValues(templateButton);
      await templateButton.click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/${projectId}/workspaces/[0-9a-f-]{36}$`),
      );
      await waitUntilSaved(page);
      const templateDocumentId = new URL(page.url()).pathname
        .split("/")
        .at(-1)!;
      const imports = await fixture.admin
        .from("lukas_drawing_library_imports")
        .select("target_document_id,client_request_id")
        .eq("target_document_id", templateDocumentId);
      if (imports.error) throw imports.error;
      expect(imports.data).toEqual([
        {
          target_document_id: templateDocumentId,
          client_request_id: templateRequest.clientRequestId,
        },
      ]);
      await page.goto(`${baseUrl}/workspace`);
      await page
        .locator("summary")
        .filter({ hasText: /^\s*새 도면\s*$/ })
        .click();
      const fileEntry = page.getByRole("button", {
        name: "파일 가져오기",
        exact: true,
      });
      const fileEntryRequest = await formValues(fileEntry);
      expect(fileEntryRequest.intent).toBe("quick_file");
      expect(Object.keys(fileEntryRequest).sort()).toEqual([
        "client_created_at",
        "client_request_id",
        "intent",
      ]);
      await fileEntry.click();
      await expect(page).toHaveURL(`${baseUrl}/projects/${projectId}/files`);
      await expect(page.getByLabel("파일", { exact: true })).toBeVisible();
      expect((await projectCounts(projectId)).documents).toHaveLength(3);

      await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        "/workspace",
      );
      const targetBefore = await projectCounts(projectId);
      const viewerProjects = async () => {
        const result = await fixture.admin
          .from("lukas_qto_projects")
          .select("id,organization_id")
          .eq("owner_id", fixture.viewer.id)
          .order("id");
        if (result.error) throw result.error;
        return result.data;
      };
      const viewerProjectsBefore = await viewerProjects();
      const forged = await viewerContext.request.post(`${baseUrl}/workspace`, {
        form: {
          intent: "quick_blank",
          client_request_id: randomUUID(),
          client_created_at: new Date().toISOString(),
          projectId,
        },
        maxRedirects: 0,
      });
      expect(forged.status()).toBe(400);
      expect(forged.headers().location).toBeUndefined();
      expect(await projectCounts(projectId)).toEqual(targetBefore);
      expect(await viewerProjects()).toEqual(viewerProjectsBefore);
      expect(evidence.pageErrors).toEqual([]);
      expect(evidence.consoleErrors).toEqual([]);
      expect(evidence.responseErrors).toEqual([]);
      await attachJson(testInfo, "direct-template-import-entry", {
        projectId,
        templateDocumentId,
        imports: imports.data,
        forgedTargetStatus: forged.status(),
        evidence,
      });
    } finally {
      await Promise.all([context.close(), viewerContext.close()]);
    }
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

  test("a blank workspace uploads DXF and returns to the same workspace ready to import", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const evidence = trackContextEvidence(context);
    try {
      const page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        canonicalPath(fixture.emptyProjectId, emptyWorkspaceId),
      );
      await waitUntilSaved(page);

      const uploadLink = page.getByRole("link", { name: "DXF 업로드" });
      await expect(uploadLink).toBeVisible();
      await uploadLink.click();
      await expect(page).toHaveURL(
        (url) =>
          url.pathname === `/projects/${fixture.emptyProjectId}/files` &&
          url.searchParams.get("kind") === "dxf",
      );
      const uploadLocation = new URL(page.url());
      expect(uploadLocation.pathname).toBe(
        `/projects/${fixture.emptyProjectId}/files`,
      );
      expect(uploadLocation.searchParams.get("kind")).toBe("dxf");
      expect(uploadLocation.searchParams.get("returnTo")).toBe(
        canonicalPath(fixture.emptyProjectId, emptyWorkspaceId),
      );
      expect(uploadLocation.hash).toBe("#upload");

      const sourceBytes = Buffer.from(
        M4_DXF_ASCII.replace("ab12", "ac13"),
        "ascii",
      );
      const sourceSha256 = sha256Bytes(sourceBytes);
      expect(sourceSha256).not.toBe(M4_DXF_SHA256);
      const sourcePath = testInfo.outputPath("1hk-workspace-handoff.dxf");
      await writeFile(sourcePath, sourceBytes);
      await page.getByLabel("파일", { exact: true }).setInputFiles(sourcePath);
      await page
        .getByRole("button", { name: "파일 업로드", exact: true })
        .click();
      await expect
        .poll(
          () => {
            const location = new URL(page.url());
            return {
              pathname: location.pathname,
              sourceFileId: location.searchParams.get("dxfSourceFileId"),
            };
          },
          { timeout: 120_000 },
        )
        .toEqual({
          pathname: canonicalPath(fixture.emptyProjectId, emptyWorkspaceId),
          sourceFileId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        });
      const sourceFileId = new URL(page.url()).searchParams.get(
        "dxfSourceFileId",
      );
      if (!sourceFileId) throw new Error("DXF handoff source ID is missing");

      await expect(
        page.getByText(
          "방금 올린 DXF를 선택했습니다. 단위를 확인한 뒤 도면 가져오기를 실행하세요.",
          { exact: true },
        ),
      ).toBeVisible();
      const importForm = page.getByRole("form", {
        name: "DXF 도면 가져오기",
      });
      await expect(importForm.getByLabel("가져올 DXF 원본")).toHaveValue(
        sourceFileId,
      );
      const importButton = importForm.getByRole("button", {
        name: "DXF 도면 가져오기",
      });
      await expect(importButton).toBeEnabled({ timeout: 45_000 });
      await importButton.click();
      await expect(
        page.getByText(
          "DXF 객체 1개와 원본 계보를 저장 대기열에 추가했습니다.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 45_000 });
      await waitUntilSaved(page);

      const revision = await revisionStatus(emptyWorkspaceId);
      const [documents, sources, sourceEvidence] = await Promise.all([
        fixture.admin
          .from("lukas_drawing_documents")
          .select("id")
          .eq("project_id", fixture.emptyProjectId),
        fixture.admin
          .from("lukas_drawing_object_sources")
          .select("id,source_file_id,source_sha256,source_kind,status")
          .eq("revision_id", revision.id)
          .eq("source_file_id", sourceFileId)
          .eq("source_kind", "dxf_entity")
          .eq("status", "active"),
        exactProjectSourceEvidence(fixture.emptyProjectId, sourceFileId),
      ]);
      if (documents.error || sources.error)
        throw documents.error ?? sources.error;
      expect(documents.data).toEqual([{ id: emptyWorkspaceId }]);
      expect(sources.data).toEqual([
        expect.objectContaining({
          source_file_id: sourceFileId,
          source_kind: "dxf_entity",
          source_sha256: sourceSha256,
          status: "active",
        }),
      ]);
      expect(sourceEvidence).toMatchObject({
        byteLength: sourceBytes.byteLength,
        immutable: true,
        kind: "dxf",
        metadataSha256: sourceSha256,
        originalFilename: "1hk-workspace-handoff.dxf",
        projectId: fixture.emptyProjectId,
        storageByteSha256: sourceSha256,
      });
      expect(evidence.pageErrors).toEqual([]);
      expect(evidence.responseErrors).toEqual([]);
      await attachJson(testInfo, "m4-dxf-existing-workspace-handoff", {
        browserEvidence: evidence,
        sourceEvidence,
        sourceFileId,
        sourceRows: sources.data,
        workspaceId: emptyWorkspaceId,
      });
    } finally {
      await context.close();
    }
  });

  test("a signed-in owner creates a project, resumably uploads and verifies a PDF, then attaches it without changing source bytes", async ({
    browser,
  }, testInfo) => {
    let ownerContext: BrowserContext | null = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    let reloginContext: BrowserContext | null = null;
    let viewerContext: BrowserContext | null = null;
    const evidence = newBrowserEvidence();
    const interruptedEvidence = trackContextEvidence(ownerContext);
    let restartResumeEvidence: Record<string, unknown> | null = null;
    const projectName = `1HK real entry ${randomUUID().slice(0, 8)}`;
    const originalFilename = "1hk-real-browser-upload.pdf";
    try {
      let page = await authenticateContext(
        fixture,
        ownerContext,
        fixture.owner,
        baseUrl,
        "/workspace",
      );

      await page
        .getByRole("button", { name: "새 프로젝트", exact: true })
        .click();
      const projectDialog = page.getByRole("dialog", {
        name: "새 도면 프로젝트",
      });
      await projectDialog
        .getByLabel("프로젝트명", { exact: true })
        .fill(projectName);
      await projectDialog
        .getByRole("button", {
          name: "프로젝트 만들고 작업공간 열기",
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(
        /\/projects\/[0-9a-f-]{36}\/workspaces\/new$/,
      );
      const projectId = new URL(page.url()).pathname.split("/")[2];
      if (!projectId) throw new Error("UI-created project ID is unavailable");
      const project = await fixture.admin
        .from("lukas_qto_projects")
        .select("id,organization_id,owner_id,name")
        .eq("id", projectId)
        .single();
      if (project.error) throw project.error;
      expect(project.data).toMatchObject({
        id: projectId,
        name: projectName,
        organization_id: fixture.organizationId,
        owner_id: fixture.owner.id,
      });

      const blankSection = page.locator(
        'section[aria-labelledby="blank-workspace-title"]',
      );
      await blankSection
        .getByRole("textbox", { name: "작업실 이름" })
        .fill("실제 업로드 연결 작업실");
      await blankSection
        .getByRole("button", { name: "빈 작업실로 시작", exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/projects/${projectId}/workspaces/[0-9a-f-]{36}$`),
      );
      const workspaceId = new URL(page.url()).pathname.split("/").at(-1)!;
      await expect(page.getByText("원본 없음 · 빈 캔버스")).toBeVisible();
      await waitUntilSaved(page);

      const pdfUploadPath = `/projects/${projectId}/files?kind=pdf&returnTo=${encodeURIComponent(
        canonicalPath(projectId, workspaceId),
      )}#upload`;
      await page.getByRole("link", { name: "PDF 업로드로 이동" }).click();
      await expect(page).toHaveURL(pdfUploadPath);
      await page
        .getByRole("combobox", { name: "자료 종류" })
        .selectOption("pdf");
      const resumableChunkBytes = 6 * 1024 * 1024;
      const pdf = await PDFDocument.create();
      const fixedPdfDate = new Date("2026-01-01T00:00:00.000Z");
      pdf.setCreationDate(fixedPdfDate);
      pdf.setModificationDate(fixedPdfDate);
      pdf.addPage([612, 792]);
      const deterministicAttachment = new Uint8Array(7 * 1024 * 1024);
      let attachmentState = 0x1a2b3c4d;
      for (let index = 0; index < deterministicAttachment.length; index += 1) {
        attachmentState ^= attachmentState << 13;
        attachmentState ^= attachmentState >>> 17;
        attachmentState ^= attachmentState << 5;
        deterministicAttachment[index] = attachmentState & 0xff;
      }
      await pdf.attach(
        deterministicAttachment,
        "1hk-deterministic-resume-evidence.bin",
        {
          creationDate: fixedPdfDate,
          description: "Deterministic TUS restart evidence",
          mimeType: "application/octet-stream",
          modificationDate: fixedPdfDate,
        },
      );
      const sourceBytes = Buffer.from(
        await pdf.save({ useObjectStreams: false }),
      );
      expect(sourceBytes.byteLength).toBeGreaterThan(resumableChunkBytes);
      expect(sourceBytes.byteLength).toBeLessThan(2 * resumableChunkBytes);
      const expectedSha256 = sha256Bytes(sourceBytes);
      const sourcePath = testInfo.outputPath(originalFilename);
      await writeFile(sourcePath, sourceBytes);

      const beforeRestartRequests: Array<{
        method: string;
        uploadLength: string | null;
        uploadOffset: string | null;
        url: string;
      }> = [];
      const beforeRestartResponses: Array<{
        method: string;
        status: number;
        uploadLength: string | null;
        uploadOffset: string | null;
        url: string;
      }> = [];
      const isTusRequest = (url: string) => {
        const pathname = new URL(url).pathname;
        return (
          pathname === "/storage/v1/upload/resumable" ||
          pathname.startsWith("/storage/v1/upload/resumable/")
        );
      };
      ownerContext.on("request", (request) => {
        if (!isTusRequest(request.url())) return;
        const headers = request.headers();
        beforeRestartRequests.push({
          method: request.method(),
          uploadLength: headers["upload-length"] ?? null,
          uploadOffset: headers["upload-offset"] ?? null,
          url: request.url(),
        });
      });
      ownerContext.on("response", (response) => {
        if (!isTusRequest(response.url())) return;
        const headers = response.headers();
        beforeRestartResponses.push({
          method: response.request().method(),
          status: response.status(),
          uploadLength: headers["upload-length"] ?? null,
          uploadOffset: headers["upload-offset"] ?? null,
          url: response.url(),
        });
      });
      let connectionInterrupted = false;
      let acceptedInitialPatch = false;
      await ownerContext.route(
        (url) => isTusRequest(url.toString()),
        async (route) => {
          const request = route.request();
          if (request.method() === "OPTIONS") {
            await route.continue();
            return;
          }
          if (request.method() === "PATCH" && !acceptedInitialPatch) {
            acceptedInitialPatch = true;
            await route.continue();
            return;
          }
          if (connectionInterrupted || request.method() === "PATCH") {
            connectionInterrupted = true;
            await route.abort("internetdisconnected");
            return;
          }
          await route.continue();
        },
      );
      await page.getByLabel("파일", { exact: true }).setInputFiles(sourcePath);
      const selectedFileBeforeRestart = await page
        .getByLabel("파일", { exact: true })
        .evaluate((element) => {
          const file = (element as HTMLInputElement).files?.[0];
          return file
            ? {
                lastModified: file.lastModified,
                name: file.name,
                size: file.size,
                type: file.type,
              }
            : null;
        });
      expect(selectedFileBeforeRestart).toMatchObject({
        name: originalFilename,
        size: sourceBytes.byteLength,
        type: "application/pdf",
      });
      expect(interruptedEvidence.consoleErrors).toEqual([]);
      const interruptedPatchPromise = page.waitForRequest(
        (request) =>
          request.method() === "PATCH" &&
          isTusRequest(request.url()) &&
          request.headers()["upload-offset"] === String(resumableChunkBytes),
        { timeout: 60_000 },
      );
      await page
        .getByRole("button", { name: "파일 업로드", exact: true })
        .click();
      const interruptedPatch = await interruptedPatchPromise;
      expect(interruptedPatch.headers()["upload-offset"]).toBe(
        String(resumableChunkBytes),
      );
      await expect
        .poll(
          () =>
            interruptedEvidence.requestFailures.filter((failure) =>
              failure.includes("/storage/v1/upload/resumable/"),
            ).length,
          { timeout: 10_000 },
        )
        .toBeGreaterThanOrEqual(1);

      const restartState = await ownerContext.storageState();
      const applicationStorage = restartState.origins.find(
        ({ origin }) => origin === baseUrl,
      );
      const storedTusEntries =
        applicationStorage?.localStorage.filter(({ name }) =>
          name.startsWith("tus::"),
        ) ?? [];
      expect(storedTusEntries).toHaveLength(1);
      const storedTusUpload = JSON.parse(storedTusEntries[0].value) as {
        metadata?: Record<string, string>;
        parallelUploadUrls?: unknown;
        size?: number;
        uploadUrl?: string;
      };
      expect(storedTusUpload).toMatchObject({
        metadata: {
          bucketName: "lukas-qto",
          contentType: "application/pdf",
        },
        size: sourceBytes.byteLength,
      });
      expect(storedTusUpload.parallelUploadUrls).toBeUndefined();
      expect(storedTusUpload.metadata?.objectName).toMatch(
        new RegExp(
          `^${fixture.owner.id}/${projectId}/source-uploads/[0-9a-f-]{36}\\.pdf$`,
        ),
      );
      const resumedUploadUrl = storedTusUpload.uploadUrl;
      const resumedStoragePath = storedTusUpload.metadata?.objectName;
      if (!resumedUploadUrl || !resumedStoragePath)
        throw new Error("Persisted TUS restart evidence is incomplete");
      expect(isTusRequest(resumedUploadUrl)).toBe(true);
      const creationRequests = beforeRestartRequests.filter(
        ({ method }) => method === "POST",
      );
      const interruptedPatches = beforeRestartRequests.filter(
        ({ method }) => method === "PATCH",
      );
      expect(creationRequests).toHaveLength(1);
      expect(creationRequests[0].uploadLength).toBe(
        String(sourceBytes.byteLength),
      );
      expect(interruptedPatches).toHaveLength(2);
      expect(interruptedPatches[0]).toMatchObject({
        uploadOffset: "0",
        url: resumedUploadUrl,
      });
      expect(interruptedPatches[1]).toMatchObject({
        uploadOffset: String(resumableChunkBytes),
        url: resumedUploadUrl,
      });
      const creationResponse = beforeRestartResponses.find(
        ({ method }) => method === "POST",
      );
      expect(creationResponse?.status).toBeGreaterThanOrEqual(200);
      expect(creationResponse?.status).toBeLessThan(300);
      expect(creationRequests[0].uploadOffset).toBeNull();
      expect(creationResponse?.uploadOffset).toBeNull();
      expect(interruptedEvidence.pageErrors).toEqual([]);
      expect(interruptedEvidence.responseErrors).toEqual([]);
      expect(
        interruptedEvidence.consoleErrors.filter(
          (error) =>
            !(
              error.includes("/storage/v1/upload/resumable/") &&
              /ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(error)
            ),
        ),
      ).toEqual([]);
      expect(
        interruptedEvidence.requestFailures.every((failure) =>
          failure.includes("/storage/v1/upload/resumable/"),
        ),
      ).toBe(true);
      const interruptionBrowserEvidence = snapshotEvidence(interruptedEvidence);

      await ownerContext.setOffline(true);
      await ownerContext.close();
      ownerContext = null;

      ownerContext = await browser.newContext({
        storageState: restartState,
        viewport: { width: 1440, height: 900 },
      });
      const afterRestartRequests: typeof beforeRestartRequests = [];
      const afterRestartResponses: typeof beforeRestartResponses = [];
      ownerContext.on("request", (request) => {
        if (!isTusRequest(request.url())) return;
        const headers = request.headers();
        afterRestartRequests.push({
          method: request.method(),
          uploadLength: headers["upload-length"] ?? null,
          uploadOffset: headers["upload-offset"] ?? null,
          url: request.url(),
        });
      });
      ownerContext.on("response", (response) => {
        if (!isTusRequest(response.url())) return;
        const headers = response.headers();
        afterRestartResponses.push({
          method: response.request().method(),
          status: response.status(),
          uploadLength: headers["upload-length"] ?? null,
          uploadOffset: headers["upload-offset"] ?? null,
          url: response.url(),
        });
      });
      const postUploadInterruptionEvidence = newBrowserEvidence();
      trackContextEvidence(ownerContext, postUploadInterruptionEvidence);
      const isUploadVerifierRequest = (url: string) =>
        new URL(url).pathname === "/functions/v1/lukas-qto-upload-verify";
      const isUploadFinalizationRequest = (url: string) =>
        new URL(url).pathname ===
        `/projects/${projectId}/files/finalize-upload`;
      let verifierRequests = 0;
      let verifierInterruptions = 0;
      await ownerContext.route(
        (url) => isUploadVerifierRequest(url.toString()),
        async (route) => {
          if (route.request().method() === "OPTIONS") {
            await route.continue();
            return;
          }
          verifierRequests += 1;
          if (verifierInterruptions < 1) {
            verifierInterruptions += 1;
            await route.abort("internetdisconnected");
            return;
          }
          await route.continue();
        },
      );
      let finalizationRequests = 0;
      let finalizationInterruptions = 0;
      await ownerContext.route(
        (url) => isUploadFinalizationRequest(url.toString()),
        async (route) => {
          if (route.request().method() !== "POST") {
            await route.continue();
            return;
          }
          finalizationRequests += 1;
          if (finalizationInterruptions < 2) {
            finalizationInterruptions += 1;
            await route.abort("internetdisconnected");
            return;
          }
          await route.continue();
        },
      );
      page = await ownerContext.newPage();
      await page.goto(`${baseUrl}${pdfUploadPath}`);
      await expect(page).toHaveURL(pdfUploadPath);
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.startsWith("tus::")),
        ),
      ).toEqual([storedTusEntries[0].name]);
      await page
        .getByRole("combobox", { name: "자료 종류" })
        .selectOption("pdf");
      await page.getByLabel("파일", { exact: true }).setInputFiles(sourcePath);
      const selectedFileAfterRestart = await page
        .getByLabel("파일", { exact: true })
        .evaluate((element) => {
          const file = (element as HTMLInputElement).files?.[0];
          return file
            ? {
                lastModified: file.lastModified,
                name: file.name,
                size: file.size,
                type: file.type,
              }
            : null;
        });
      expect(selectedFileAfterRestart).toEqual(selectedFileBeforeRestart);
      const interruptedVerifierPromise = page.waitForRequest(
        (request) =>
          request.method() === "POST" && isUploadVerifierRequest(request.url()),
        { timeout: 120_000 },
      );
      await page
        .getByRole("button", { name: "파일 업로드", exact: true })
        .click();
      await interruptedVerifierPromise;
      await expect(page.getByText(/파일 검증 실패/)).toBeVisible({
        timeout: 120_000,
      });
      await expect(page).toHaveURL(pdfUploadPath);
      const nonPreflightAfterRestart = afterRestartRequests.filter(
        ({ method }) => method !== "OPTIONS",
      );
      expect(nonPreflightAfterRestart[0]).toMatchObject({
        method: "HEAD",
        url: resumedUploadUrl,
      });
      expect(
        nonPreflightAfterRestart.filter(({ method }) => method === "POST"),
      ).toEqual([]);
      const resumedHeadResponses = afterRestartResponses.filter(
        ({ method, status }) =>
          method === "HEAD" && status >= 200 && status < 300,
      );
      expect(resumedHeadResponses).toContainEqual(
        expect.objectContaining({
          uploadLength: String(sourceBytes.byteLength),
          uploadOffset: String(resumableChunkBytes),
          url: resumedUploadUrl,
        }),
      );
      const resumedPatches = nonPreflightAfterRestart.filter(
        ({ method }) => method === "PATCH",
      );
      expect(resumedPatches).toEqual([
        expect.objectContaining({
          uploadOffset: String(resumableChunkBytes),
          url: resumedUploadUrl,
        }),
      ]);
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((key) => key.startsWith("tus::")),
        ),
      ).toEqual([]);
      const tusRequestCountAfterStorageCompletion = afterRestartRequests.length;
      const repeatedVerifierPromise = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          isUploadVerifierRequest(response.url()) &&
          response.status() >= 200 &&
          response.status() < 300,
        { timeout: 120_000 },
      );
      const firstFinalizationPromise = page.waitForRequest(
        (request) =>
          request.method() === "POST" &&
          isUploadFinalizationRequest(request.url()),
        { timeout: 120_000 },
      );
      await page
        .getByRole("button", { name: "파일 등록 다시 시도", exact: true })
        .click();
      await Promise.all([repeatedVerifierPromise, firstFinalizationPromise]);
      await expect(
        page.getByText(/원본 저장은 완료됐지만 파일 등록을 마치지 못했습니다/),
      ).toBeVisible({ timeout: 120_000 });
      expect(verifierRequests).toBe(2);
      expect(verifierInterruptions).toBe(1);
      expect(finalizationRequests).toBe(1);
      expect(finalizationInterruptions).toBe(1);
      expect(afterRestartRequests).toHaveLength(
        tusRequestCountAfterStorageCompletion,
      );

      await page
        .getByRole("button", { name: "파일 등록 다시 시도", exact: true })
        .click();
      await expect
        .poll(() => ({ finalizationInterruptions, verifierRequests }), {
          timeout: 15_000,
        })
        .toEqual({ finalizationInterruptions: 2, verifierRequests: 2 });
      await expect(
        page.getByText(/원본 저장은 완료됐지만 파일 등록을 마치지 못했습니다/),
      ).toBeVisible();
      expect(finalizationRequests).toBe(2);
      expect(afterRestartRequests).toHaveLength(
        tusRequestCountAfterStorageCompletion,
      );
      const completedUploadState = await ownerContext.storageState();
      const completedApplicationStorage = completedUploadState.origins.find(
        ({ origin }) => origin === baseUrl,
      );
      const pendingUploadEntries =
        completedApplicationStorage?.localStorage.filter(({ name }) =>
          name.startsWith("1hk:pending-project-upload:v1:"),
        ) ?? [];
      expect(pendingUploadEntries).toHaveLength(1);
      const verifiedPendingUpload = JSON.parse(pendingUploadEntries[0].value);
      expect(verifiedPendingUpload).toMatchObject({
        actorId: fixture.owner.id,
        byteSize: sourceBytes.byteLength,
        kind: "pdf",
        ownerId: fixture.owner.id,
        projectId,
        returnTo: canonicalPath(projectId, workspaceId),
        storagePath: resumedStoragePath,
        uploadComplete: true,
        version: 1,
      });
      expect(verifiedPendingUpload.revision).toBeGreaterThan(0);
      expect(verifiedPendingUpload.verificationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(postUploadInterruptionEvidence.pageErrors).toEqual([]);
      expect(postUploadInterruptionEvidence.responseErrors).toEqual([]);
      expect(
        postUploadInterruptionEvidence.requestFailures.every((failure) =>
          [
            "/functions/v1/lukas-qto-upload-verify",
            `/projects/${projectId}/files/finalize-upload`,
          ].some((path) => failure.includes(path)),
        ),
      ).toBe(true);
      expect(
        postUploadInterruptionEvidence.consoleErrors.filter(
          (message) =>
            !(
              [
                "/functions/v1/lukas-qto-upload-verify",
                `/projects/${projectId}/files/finalize-upload`,
              ].some((path) => message.includes(path)) &&
              /ERR_INTERNET_DISCONNECTED|Failed to fetch/i.test(message)
            ),
        ),
      ).toEqual([]);
      const postUploadBrowserEvidence = snapshotEvidence(
        postUploadInterruptionEvidence,
      );

      await ownerContext.close();
      ownerContext = await browser.newContext({
        storageState: completedUploadState,
        viewport: { width: 1440, height: 900 },
      });
      trackContextEvidence(ownerContext, evidence);
      const recoveryTusRequests: typeof beforeRestartRequests = [];
      ownerContext.on("request", (request) => {
        if (!isTusRequest(request.url())) return;
        const headers = request.headers();
        recoveryTusRequests.push({
          method: request.method(),
          uploadLength: headers["upload-length"] ?? null,
          uploadOffset: headers["upload-offset"] ?? null,
          url: request.url(),
        });
      });
      page = await ownerContext.newPage();
      await page.goto(`${baseUrl}${pdfUploadPath}`);
      await expect(page).toHaveURL(canonicalPath(projectId, workspaceId), {
        timeout: 120_000,
      });
      expect(recoveryTusRequests).toEqual([]);
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage).filter((key) =>
            key.startsWith("1hk:pending-project-upload:v1:"),
          ),
        ),
      ).toEqual([]);
      const finalizedSource = await fixture.admin
        .from("lukas_qto_files")
        .select("id")
        .eq("project_id", projectId)
        .eq("storage_path", resumedStoragePath)
        .single();
      if (finalizedSource.error) throw finalizedSource.error;
      const sourceFileId = finalizedSource.data.id;
      const sourceBefore = await exactProjectSourceEvidence(
        projectId,
        sourceFileId,
      );
      expect(sourceBefore).toMatchObject({
        byteLength: sourceBytes.byteLength,
        contentType: "application/pdf",
        fileId: sourceFileId,
        immutable: true,
        kind: "pdf",
        metadataByteLength: sourceBytes.byteLength,
        metadataSha256: expectedSha256,
        originalFilename,
        projectId,
        storageByteSha256: expectedSha256,
      });
      expect(sourceBefore.storagePath).toBe(resumedStoragePath);
      const verification = await fixture.admin
        .from("lukas_qto_verified_uploads")
        .select(
          "id,actor_id,project_id,kind,storage_path,original_filename,content_type,byte_size,sha256,consumed_file_id,consumed_at",
        )
        .eq("consumed_file_id", sourceFileId)
        .single();
      if (verification.error) throw verification.error;
      expect(verification.data).toMatchObject({
        actor_id: fixture.owner.id,
        byte_size: sourceBytes.byteLength,
        consumed_file_id: sourceFileId,
        content_type: "application/pdf",
        kind: "pdf",
        original_filename: originalFilename,
        project_id: projectId,
        sha256: expectedSha256,
        storage_path: sourceBefore.storagePath,
      });
      expect(verification.data.consumed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      restartResumeEvidence = {
        afterRestart: {
          browserEvidence: postUploadBrowserEvidence,
          requests: afterRestartRequests,
          responses: afterRestartResponses,
          selectedFile: selectedFileAfterRestart,
        },
        beforeRestart: {
          browserEvidence: interruptionBrowserEvidence,
          requests: beforeRestartRequests,
          responses: beforeRestartResponses,
          selectedFile: selectedFileBeforeRestart,
        },
        expectedSha256,
        persistedUpload: {
          key: storedTusEntries[0].name,
          metadata: storedTusUpload.metadata,
          size: storedTusUpload.size,
          uploadUrl: resumedUploadUrl,
        },
        recovery: {
          requests: recoveryTusRequests,
          resumedWithoutFileSelection: true,
        },
        sourceByteLength: sourceBytes.byteLength,
      };

      const attachForm = page.getByRole("form", { name: "PDF 원본 연결" });
      await expect(attachForm).toBeVisible();
      await attachForm
        .getByRole("combobox", { name: "연결할 PDF 원본" })
        .selectOption(sourceFileId);
      const attachButton = attachForm.getByRole("button", {
        name: "PDF 원본 연결",
        exact: true,
      });
      await expect(attachButton).toBeEnabled({ timeout: 45_000 });
      await attachButton.click();
      await expect(attachForm).toHaveCount(0);
      await expect(
        page.getByText(`도면 작업실 · ${originalFilename}`, { exact: true }),
      ).toBeVisible({ timeout: 45_000 });
      await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );
      const bindingBeforeRelogin = await canonicalPdfBinding(workspaceId);
      expect(bindingBeforeRelogin).toMatchObject({
        canvasSourceFileId: sourceFileId,
        canvasSourceSha256: expectedSha256,
        pdfPageNumber: 1,
        sourceFileId,
        sourceSha256: expectedSha256,
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );

      await ownerContext.close();
      ownerContext = null;
      reloginContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      trackContextEvidence(reloginContext, evidence);
      page = await authenticateContext(
        fixture,
        reloginContext,
        fixture.owner,
        baseUrl,
        canonicalPath(projectId, workspaceId),
      );
      await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );
      const [bindingAfterRelogin, sourceAfter] = await Promise.all([
        canonicalPdfBinding(workspaceId),
        exactProjectSourceEvidence(projectId, sourceFileId),
      ]);
      expect(bindingAfterRelogin).toEqual(bindingBeforeRelogin);
      expect(sourceAfter).toEqual(sourceBefore);

      const member = await fixture.retentionClient.rpc(
        "lukas_qto_set_project_member",
        {
          p_organization_id: fixture.organizationId,
          p_project_id: projectId,
          p_email: fixture.viewer.email,
          p_role: "viewer",
          p_request_id: randomUUID(),
        },
      );
      if (member.error) throw member.error;
      const viewerMembership = await fixture.admin
        .from("lukas_qto_project_members")
        .select("project_id,user_id,role")
        .eq("project_id", projectId)
        .eq("user_id", fixture.viewer.id)
        .single();
      if (viewerMembership.error) throw viewerMembership.error;
      expect(viewerMembership.data.role).toBe("viewer");
      const revision = await revisionStatus(workspaceId);
      expect(revision.status).toBe("draft");
      const layers = await fixture.admin
        .from("lukas_drawing_layers")
        .select("id,locked,sort_order,system_kind")
        .eq("revision_id", revision.id)
        .eq("system_kind", "work")
        .eq("visible", true)
        .eq("locked", false)
        .order("sort_order", { ascending: true })
        .limit(1);
      if (layers.error) throw layers.error;
      const editableLayerId = layers.data?.[0]?.id;
      if (!editableLayerId)
        throw new Error("Real-entry workspace has no editable layer");
      const viewerObjectId = randomUUID();
      const viewerClientOperationId = randomUUID();
      const viewerObjectsBefore = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,status,version")
        .eq("revision_id", revision.id)
        .eq("id", viewerObjectId);
      if (viewerObjectsBefore.error) throw viewerObjectsBefore.error;
      const viewerOperationsBefore = await fixture.admin
        .from("lukas_drawing_operations")
        .select("id,sequence,client_operation_id,operation_type,actor_id")
        .eq("revision_id", revision.id)
        .eq("client_operation_id", viewerClientOperationId);
      if (viewerOperationsBefore.error) throw viewerOperationsBefore.error;
      expect(viewerObjectsBefore.data).toEqual([]);
      expect(viewerOperationsBefore.data).toEqual([]);
      const viewer = await authenticateApiClient(fixture, fixture.viewer);
      const viewerDenied = await viewer.rpc("lukas_drawing_apply_operation", {
        p_revision_id: revision.id,
        p_client_operation_id: viewerClientOperationId,
        p_operation_type: "add_objects",
        p_base_versions: {},
        p_forward: {
          type: "add_objects",
          objects: [
            {
              id: viewerObjectId,
              name: "Viewer forbidden valid line",
              layerId: editableLayerId,
              geometry: {
                type: "line",
                start: { x: 40, y: 40 },
                end: { x: 160, y: 40 },
              },
              styleId: null,
              style: { stroke: "#dc2626", strokeWidth: 2, fill: null },
              version: 1,
            },
          ],
        },
        p_inverse: { type: "delete_objects", objectIds: [viewerObjectId] },
      });
      expect(viewerDenied.error?.code).toBe("P1R01");
      expect(viewerDenied.error?.message).toBe(
        "Drawing revision target is unavailable",
      );
      expect(viewerDenied.data).toBeNull();
      const viewerObjectsAfter = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,status,version")
        .eq("revision_id", revision.id)
        .eq("id", viewerObjectId);
      if (viewerObjectsAfter.error) throw viewerObjectsAfter.error;
      const viewerOperationsAfter = await fixture.admin
        .from("lukas_drawing_operations")
        .select("id,sequence,client_operation_id,operation_type,actor_id")
        .eq("revision_id", revision.id)
        .eq("client_operation_id", viewerClientOperationId);
      if (viewerOperationsAfter.error) throw viewerOperationsAfter.error;
      const revisionAfterViewerDenial = await revisionStatus(workspaceId);
      expect({
        objects: viewerObjectsAfter.data,
        operations: viewerOperationsAfter.data,
        revision: revisionAfterViewerDenial,
      }).toEqual({
        objects: viewerObjectsBefore.data,
        operations: viewerOperationsBefore.data,
        revision,
      });

      viewerContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      trackContextEvidence(viewerContext, evidence);
      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        canonicalPath(projectId, workspaceId),
      );
      await expect(viewerPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );
      await expect(
        viewerPage.getByRole("status", {
          name: "공동 편집 상태: connected",
        }),
      ).toContainText("읽기 전용", { timeout: 45_000 });
      await expect(
        viewerPage.getByRole("button", { name: "선 도구", exact: true }),
      ).toHaveCount(0);

      expect(evidence.pageErrors).toEqual([]);
      expect(evidence.responseErrors).toEqual([]);
      expect(evidence.requestFailures).toEqual([]);
      expect(evidence.consoleErrors).toEqual([]);
      await attachJson(testInfo, "m1-real-entry-resumable-upload", {
        bindingAfterRelogin,
        browserEvidence: evidence,
        project: project.data,
        restartResume: restartResumeEvidence,
        sourceAfter,
        sourceBefore,
        uploadVerification: verification.data,
        viewerMembership: viewerMembership.data,
        viewerMutation: {
          clientOperationId: viewerClientOperationId,
          objectId: viewerObjectId,
          objectsAfter: viewerObjectsAfter.data,
          objectsBefore: viewerObjectsBefore.data,
          operationsAfter: viewerOperationsAfter.data,
          operationsBefore: viewerOperationsBefore.data,
          revisionAfter: revisionAfterViewerDenial,
          revisionBefore: revision,
        },
        viewerMutationError: {
          code: viewerDenied.error?.code,
          message: viewerDenied.error?.message,
        },
        workspaceId,
      });
    } finally {
      await Promise.all([
        ownerContext?.close(),
        reloginContext?.close(),
        viewerContext?.close(),
      ]);
    }
  });

  test("an editor reopens a selected IFC on a source-free workspace before attaching an immutable PDF", async ({
    browser,
  }, testInfo) => {
    let context: BrowserContext | null = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const evidence = trackContextEvidence(context);
    try {
      let page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        `/projects/${fixture.projectId}/workspaces/new`,
      );
      await page.getByLabel("작업실 이름").first().fill("M2 PDF 연결 작업실");
      await page.getByRole("button", { name: "빈 작업실로 시작" }).click();
      await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
      sourceIntegrationWorkspaceId = page.url().split("/").at(-1)!;
      await expect(page.getByText("원본 없음 · 빈 캔버스")).toBeVisible();
      await waitUntilSaved(page);

      const sourceEvidenceBefore = await readSourceEvidence(fixture);
      const sourceBefore =
        sourceEvidenceBefore[fixture.workspaceAttachPdfFileId];
      const ifcSourceBefore = sourceEvidenceBefore[fixture.ifcFileId];

      const ifcSourceSelect = page.getByLabel("IFC 원본 선택");
      await expect(ifcSourceSelect).toBeVisible();
      await ifcSourceSelect.selectOption(fixture.ifcFileId);
      await expect(page).toHaveURL(
        (url) => url.searchParams.get("ifc") === fixture.ifcFileId,
      );
      const ifcViewButton = page.getByRole("button", { name: "IFC 3D" });
      await expect(ifcViewButton).toBeEnabled();
      await ifcViewButton.click();
      await expect(page).toHaveURL(
        (url) =>
          url.searchParams.get("ifc") === fixture.ifcFileId &&
          url.searchParams.get("view") === "3d",
      );
      await expectReadyIfcViewer(page);
      await page.waitForLoadState("networkidle");
      const selectedIfcPath = `${new URL(page.url()).pathname}${
        new URL(page.url()).search
      }`;

      await context.close();
      context = null;
      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      trackContextEvidence(context, evidence);
      page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        selectedIfcPath,
      );
      await expect(page.getByLabel("IFC 원본 선택")).toHaveValue(
        fixture.ifcFileId,
      );
      await expect(page).toHaveURL(
        (url) =>
          url.searchParams.get("ifc") === fixture.ifcFileId &&
          url.searchParams.get("view") === "3d",
      );
      await expectReadyIfcViewer(page);
      await page.waitForLoadState("networkidle");
      const twoDimensionalViewButton = page.getByRole("button", {
        name: "2D 도면",
      });
      await twoDimensionalViewButton.click();
      await expect(page).toHaveURL(
        (url) => url.searchParams.get("view") === "2d",
      );
      await expect(twoDimensionalViewButton).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByLabel(/도면 화면/)).toBeVisible();

      const attachForm = page.getByRole("form", { name: "PDF 원본 연결" });
      await expect(attachForm).toBeVisible();
      await attachForm
        .getByLabel("연결할 PDF 원본")
        .selectOption(fixture.workspaceAttachPdfFileId);
      await attachForm.getByRole("button", { name: "PDF 원본 연결" }).click();

      await expect(
        page.getByText("도면 작업실 · 1HK-m2-attach-background.pdf", {
          exact: true,
        }),
      ).toBeVisible({ timeout: 45_000 });
      await expect(attachForm).toHaveCount(0);
      await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );
      await expect(
        page.getByText("An unexpected error occurred.", { exact: true }),
      ).toHaveCount(0);

      const m4SourceRestoreBefore = await canonicalPdfBinding(
        sourceIntegrationWorkspaceId,
      );
      expect(m4SourceRestoreBefore).toMatchObject({
        canvasSourceFileId: fixture.workspaceAttachPdfFileId,
        canvasSourceSha256: sourceBefore.metadataSha256,
        pdfPageNumber: 1,
        sourceFileId: fixture.workspaceAttachPdfFileId,
        sourceSha256: sourceBefore.metadataSha256,
      });

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );
      await expect(
        page.getByText("도면 작업실 · 1HK-m2-attach-background.pdf", {
          exact: true,
        }),
      ).toBeVisible();

      await context.close();
      context = null;
      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      trackContextEvidence(context, evidence);
      page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        canonicalPath(fixture.projectId, sourceIntegrationWorkspaceId),
      );
      await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );
      await expect(
        page.getByText("도면 작업실 · 1HK-m2-attach-background.pdf", {
          exact: true,
        }),
      ).toBeVisible();
      const [m4SourceRestoreAfter, sourceAfter] = await Promise.all([
        canonicalPdfBinding(sourceIntegrationWorkspaceId),
        readSourceEvidence(fixture),
      ]);
      expect(m4SourceRestoreAfter).toEqual(m4SourceRestoreBefore);
      expect(sourceAfter[fixture.workspaceAttachPdfFileId]).toEqual(
        sourceBefore,
      );
      expect(sourceAfter[fixture.ifcFileId]).toEqual(ifcSourceBefore);
      expect(evidence.pageErrors).toEqual([]);
      const expectedRouterDataCancellation = `GET ${baseUrl}${canonicalPath(
        fixture.projectId,
        sourceIntegrationWorkspaceId,
      )}.data?ifc=${fixture.ifcFileId}&view=3d net::ERR_ABORTED`;
      const routerDataCancellations = evidence.requestFailures.filter(
        (failure) => failure === expectedRouterDataCancellation,
      );
      expect(routerDataCancellations.length).toBeLessThanOrEqual(1);
      expect(
        evidence.requestFailures.filter(
          (failure) => failure !== expectedRouterDataCancellation,
        ),
      ).toEqual([]);
      expect(evidence.responseErrors).toEqual([]);
      expect(
        evidence.consoleErrors.filter((message) =>
          /Unexpected error|Oops!|unhandled/i.test(message),
        ),
      ).toEqual([]);
      await attachJson(testInfo, "m4-source-optional-ifc-pdf-reopen", {
        browserEvidence: evidence,
        m4SourceRestoreAfter,
        m4SourceRestoreBefore,
        ifcSourceAfter: sourceAfter[fixture.ifcFileId],
        ifcSourceBefore,
        sourceAfter: sourceAfter[fixture.workspaceAttachPdfFileId],
        sourceBefore,
        workspaceId: sourceIntegrationWorkspaceId,
      });
    } finally {
      await context?.close();
    }
  });

  test("one canonical object keeps PDF region and IFC GlobalId lineage with bidirectional focus and immutable sources", async ({
    browser,
  }, testInfo) => {
    const binding = await canonicalPdfBinding(sourceIntegrationWorkspaceId);
    const layers = await fixture.admin
      .from("lukas_drawing_layers")
      .select("id,locked,system_kind,sort_order")
      .eq("revision_id", binding.revisionId)
      .order("sort_order", { ascending: true });
    if (layers.error) throw layers.error;
    const workLayer = layers.data?.find((layer) => !layer.locked);
    if (!workLayer) throw new Error("M4 editable layer is unavailable");

    const editor = await authenticateApiClient(fixture, fixture.editor);
    const viewer = await authenticateApiClient(fixture, fixture.viewer);
    const m4CanonicalSourceObjectId = randomUUID();
    const object = {
      id: m4CanonicalSourceObjectId,
      name: "M4 PDF IFC canonical source target",
      layerId: workLayer.id,
      geometry: {
        type: "circle",
        center: { x: 220, y: 220 },
        radius: 40,
      },
      styleId: null,
      style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
      version: 1,
    };
    const added = await editor.rpc("lukas_drawing_apply_operation", {
      p_revision_id: binding.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "add_objects",
      p_base_versions: {},
      p_forward: { type: "add_objects", objects: [object] },
      p_inverse: {
        type: "delete_objects",
        objectIds: [m4CanonicalSourceObjectId],
      },
    });
    if (added.error) throw added.error;

    const allSourceEvidenceBefore = await readSourceEvidence(fixture);
    const m4SourceEvidenceBefore = {
      ifc: allSourceEvidenceBefore[fixture.ifcFileId],
      pdf: allSourceEvidenceBefore[fixture.workspaceAttachPdfFileId],
    };
    const editorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const evidence = newBrowserEvidence();
    trackContextEvidence(editorContext, evidence);
    trackContextEvidence(viewerContext, evidence);
    try {
      const editorPage = await authenticateContext(
        fixture,
        editorContext,
        fixture.editor,
        baseUrl,
        canonicalPath(fixture.projectId, sourceIntegrationWorkspaceId),
      );
      const editorSurface = editorPage.getByLabel(/도면 화면/);
      await expect(editorSurface).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );
      await editorPage.getByRole("button", { name: "선택 도구" }).click();
      const targetPoint = await drawingSurfacePoint(editorPage, {
        x: 220,
        y: 220,
      });
      await editorPage.mouse.click(targetPoint.x, targetPoint.y);
      await expect(editorSurface).toHaveAttribute(
        "data-selected-object-id",
        m4CanonicalSourceObjectId,
      );
      await editorPage.getByRole("tab", { name: "객체", exact: true }).click();
      const editorInspector = editorPage.getByRole("region", {
        name: "선택 객체 원본 근거",
      });
      await editorInspector
        .getByRole("button", { name: "PDF 영역 원본 근거 연결" })
        .click();
      await expect(editorInspector).toContainText("PDF 1쪽 영역");

      await editorPage
        .getByRole("combobox", { name: "IFC 원본 선택" })
        .selectOption(fixture.ifcFileId);
      await expect(editorPage).toHaveURL(
        (url) =>
          url.searchParams.get("ifc") === fixture.ifcFileId &&
          url.searchParams.get("object") === m4CanonicalSourceObjectId &&
          url.searchParams.get("revision") === binding.revisionId,
        { timeout: 30_000 },
      );
      const splitViewButton = editorPage.getByRole("button", {
        name: "분할 보기",
      });
      await expect(splitViewButton).toBeEnabled({ timeout: 30_000 });
      await splitViewButton.click();
      await expect(editorPage).toHaveURL(/view=split/);
      await expect(
        editorPage.locator('canvas[aria-label="IFC 3D 모델"]'),
      ).toHaveCount(1, { timeout: 60_000 });
      const ifcResults = editorPage.getByRole("region", {
        name: "IFC 요소 결과 목록",
      });
      const ifcSearch = editorPage.getByRole("searchbox", {
        name: "IFC 요소 검색",
      });
      await ifcSearch.fill(m4IfcDerivative.name);
      const targetIfcButton = ifcResults
        .getByRole("button")
        .filter({ hasText: m4IfcDerivative.name });
      await expect(targetIfcButton).toHaveCount(1, { timeout: 60_000 });
      await targetIfcButton.click();
      await expect(
        editorInspector.getByRole("button", { name: "IFC 원본 근거 연결" }),
      ).toBeVisible();
      await editorInspector
        .getByRole("button", { name: "IFC 원본 근거 연결" })
        .click();
      await expect(editorInspector).toContainText(
        `IFC GlobalId ${m4IfcDerivative.globalId}`,
      );
      await waitUntilSaved(editorPage);

      const sourceRowsResult = await editor
        .from("lukas_drawing_object_sources")
        .select(
          "id,source_kind,source_file_id,source_sha256,pdf_page_number,ifc_global_id,status,version",
        )
        .eq("object_id", m4CanonicalSourceObjectId)
        .eq("status", "active")
        .order("source_kind", { ascending: true });
      if (sourceRowsResult.error) throw sourceRowsResult.error;
      expect(sourceRowsResult.data).toEqual([
        expect.objectContaining({
          source_kind: "ifc_element",
          source_file_id: fixture.ifcFileId,
          source_sha256: m4SourceEvidenceBefore.ifc.metadataSha256,
          ifc_global_id: m4IfcDerivative.globalId,
          status: "active",
        }),
        expect.objectContaining({
          source_kind: "pdf_region",
          source_file_id: fixture.workspaceAttachPdfFileId,
          source_sha256: m4SourceEvidenceBefore.pdf.metadataSha256,
          pdf_page_number: 1,
          status: "active",
        }),
      ]);
      const sourceRowsBeforeViewer = structuredClone(sourceRowsResult.data);

      await editorSurface.click({ position: { x: 220, y: 100 } });
      await expect(editorSurface).toHaveAttribute(
        "data-selected-object-id",
        "",
      );
      await targetIfcButton.click();
      await expect(editorSurface).toHaveAttribute(
        "data-selected-object-id",
        m4CanonicalSourceObjectId,
      );

      await ifcSearch.fill("L-Angle:L3-1/2X3X3/8:693034");
      await ifcResults
        .getByRole("button", {
          name: /L-Angle:L3-1\/2X3X3\/8:693034/,
        })
        .click();
      await editorSurface.click({ position: { x: 220, y: 100 } });
      await expect(editorSurface).toHaveAttribute(
        "data-selected-object-id",
        "",
      );
      const splitTargetPoint = await drawingSurfacePoint(editorPage, {
        x: 190,
        y: 220,
      });
      await editorPage.mouse.click(splitTargetPoint.x, splitTargetPoint.y);
      await expect(editorSurface).toHaveAttribute(
        "data-selected-object-id",
        m4CanonicalSourceObjectId,
      );
      await ifcSearch.fill(m4IfcDerivative.name);
      await expect(
        editorPage.getByTitle(m4IfcDerivative.globalId),
      ).toBeVisible();
      await expect(
        ifcResults
          .getByRole("button")
          .filter({ hasText: m4IfcDerivative.name }),
      ).toHaveClass(/bg-primary/);

      await editorPage.getByRole("button", { name: "2D 도면" }).click();
      await expect(editorPage).toHaveURL(/view=2d/);
      await expect(editorSurface).toBeVisible();
      await editorPage.getByRole("button", { name: "IFC 3D" }).click();
      await expect(editorPage).toHaveURL(/view=3d/);
      await expect(
        editorPage.getByRole("img", { name: "IFC 3D 모델 화면" }),
      ).toBeVisible();
      await editorPage.getByRole("button", { name: "분할 보기" }).click();
      await expect(editorPage).toHaveURL(/view=split/);
      await expect(editorSurface).toBeVisible();

      await editorPage.getByRole("button", { name: "2D 도면" }).click();
      await expect(
        editorPage.getByRole("group", { name: "PDF 개정 비교" }),
      ).toBeVisible();
      await editorPage.getByRole("button", { name: "겹쳐 보기" }).click();
      await expect(editorSurface).toHaveAttribute(
        "data-pdf-previous-mounted",
        "true",
        { timeout: 60_000 },
      );
      await editorPage.getByRole("button", { name: "변경 표시 계산" }).click();
      await expect(
        editorPage.locator(
          '[data-pdf-diff-marker="true"][data-listening="false"]',
        ),
      ).not.toHaveCount(0, { timeout: 60_000 });

      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        `${canonicalPath(fixture.projectId, sourceIntegrationWorkspaceId)}?ifc=${fixture.ifcFileId}&view=split`,
      );
      const viewerSurface = viewerPage.getByLabel(/도면 화면/);
      await expect(viewerSurface).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );
      await viewerPage.getByRole("button", { name: "선택 도구" }).click();
      const viewerTargetPoint = await drawingSurfacePoint(viewerPage, {
        x: 190,
        y: 220,
      });
      await viewerPage.mouse.click(viewerTargetPoint.x, viewerTargetPoint.y);
      await expect(viewerSurface).toHaveAttribute(
        "data-selected-object-id",
        m4CanonicalSourceObjectId,
      );
      await viewerPage.getByRole("tab", { name: "객체", exact: true }).click();
      const viewerInspector = viewerPage.getByRole("region", {
        name: "선택 객체 원본 근거",
      });
      await expect(viewerInspector).toContainText("조회 전용");
      await expect(viewerInspector).toContainText("PDF 1쪽 영역");
      await expect(viewerInspector).toContainText(
        `IFC GlobalId ${m4IfcDerivative.globalId}`,
      );
      await expect(
        viewerInspector.getByRole("button", {
          name: /원본 근거 (?:연결|해제)/,
        }),
      ).toHaveCount(0);

      const ifcSource = sourceRowsBeforeViewer.find(
        (source) => source.source_kind === "ifc_element",
      );
      if (!ifcSource) throw new Error("M4 IFC source row is unavailable");
      const viewerDenied = await viewer.rpc("lukas_drawing_apply_operation", {
        p_revision_id: binding.revisionId,
        p_client_operation_id: randomUUID(),
        p_operation_type: "mutate_structure",
        p_base_versions: { [ifcSource.id]: ifcSource.version },
        p_forward: {
          type: "mutate_structure",
          actions: [
            {
              kind: "delete_source",
              id: ifcSource.id,
              baseVersion: ifcSource.version,
            },
          ],
        },
        p_inverse: { type: "mutate_structure", actions: [] },
      });
      expect(viewerDenied.error).not.toBeNull();
      const sourceRowsAfterViewer = await fixture.admin
        .from("lukas_drawing_object_sources")
        .select(
          "id,source_kind,source_file_id,source_sha256,pdf_page_number,ifc_global_id,status,version",
        )
        .eq("object_id", m4CanonicalSourceObjectId)
        .eq("status", "active")
        .order("source_kind", { ascending: true });
      if (sourceRowsAfterViewer.error) throw sourceRowsAfterViewer.error;
      expect(sourceRowsAfterViewer.data).toEqual(sourceRowsBeforeViewer);

      const allSourceEvidenceAfter = await readSourceEvidence(fixture);
      const m4SourceEvidenceAfter = {
        ifc: allSourceEvidenceAfter[fixture.ifcFileId],
        pdf: allSourceEvidenceAfter[fixture.workspaceAttachPdfFileId],
      };
      expect(m4SourceEvidenceAfter).toEqual(m4SourceEvidenceBefore);
      expect(evidence.pageErrors).toEqual([]);
      expect(evidence.responseErrors).toEqual([]);
      await attachJson(testInfo, "m4-canonical-pdf-ifc-source-lineage", {
        derivative: m4IfcDerivative,
        m4CanonicalSourceObjectId,
        m4SourceEvidenceAfter,
        m4SourceEvidenceBefore,
        sourceRows: sourceRowsAfterViewer.data,
      });
    } finally {
      await Promise.all([editorContext.close(), viewerContext.close()]);
    }
  });

  test("a verified DXF upload imports one durable object-source graph and rejects Viewer preparation before source lookup", async ({
    browser,
  }, testInfo) => {
    let editorContext: BrowserContext | null = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    let reloginContext: BrowserContext | null = null;
    let viewerContext: BrowserContext | null = null;
    const evidence = newBrowserEvidence();
    trackContextEvidence(editorContext, evidence);
    try {
      let editorPage = await authenticateContext(
        fixture,
        editorContext,
        fixture.editor,
        baseUrl,
        `/projects/${fixture.projectId}/workspaces/new`,
      );
      await editorPage
        .getByLabel("작업실 이름")
        .first()
        .fill("M4 DXF 원본 작업실");
      await editorPage
        .getByRole("button", { name: "빈 작업실로 시작" })
        .click();
      await expect(editorPage).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
      dxfWorkspaceId = editorPage.url().split("/").at(-1)!;
      await expect(editorPage.getByText("원본 없음 · 빈 캔버스")).toBeVisible();
      await waitUntilSaved(editorPage);
      const dxfRevisionBefore = await revisionStatus(dxfWorkspaceId);

      const dxfMetadataBefore = await dxfSourceMetadata(fixture.dxfFileId);
      const dxfEvidenceBefore = (await readSourceEvidence(fixture))[
        fixture.dxfFileId
      ];
      expect(dxfMetadataBefore).toMatchObject({
        id: fixture.dxfFileId,
        project_id: fixture.projectId,
        kind: "dxf",
        original_filename: "1HK-m4-canonical-line.dxf",
        content_type: "application/dxf",
        byte_size: 418,
        sha256: M4_DXF_SHA256,
        immutable: true,
      });
      expect(dxfEvidenceBefore).toEqual({
        metadataSha256: M4_DXF_SHA256,
        storageByteSha256: M4_DXF_SHA256,
        byteLength: 418,
      });
      expect(fixture.dxfEvidence).toEqual(dxfEvidenceBefore);

      const importForm = editorPage.getByRole("form", {
        name: "DXF 도면 가져오기",
      });
      await expect(importForm).toBeVisible();
      await importForm
        .getByLabel("가져올 DXF 원본")
        .selectOption(fixture.dxfFileId);
      await expect(importForm.getByLabel("DXF 단위")).toHaveValue("");
      await importForm
        .getByRole("button", { name: "DXF 도면 가져오기" })
        .click();
      await expect(
        editorPage.getByText(
          "DXF 객체 1개와 원본 계보를 저장 대기열에 추가했습니다.",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 45_000 });
      await expect
        .poll(
          async () => {
            const persisted = await fixture.admin
              .from("lukas_drawing_object_sources")
              .select("id", { count: "exact", head: true })
              .eq("revision_id", dxfRevisionBefore.id)
              .eq("source_file_id", fixture.dxfFileId)
              .eq("source_kind", "dxf_entity")
              .eq("status", "active");
            if (persisted.error) throw persisted.error;
            return persisted.count;
          },
          { timeout: 45_000 },
        )
        .toBe(1);
      await waitUntilSaved(editorPage);

      const graphBeforeUndo = await canonicalDxfImportGraph(
        dxfWorkspaceId,
        fixture.dxfFileId,
      );
      expect(graphBeforeUndo.file).toEqual(dxfMetadataBefore);
      expect(graphBeforeUndo.layers).toHaveLength(1);
      expect(graphBeforeUndo.layers[0]).toMatchObject({
        name: "A-WALL",
        visible: true,
        locked: false,
        system_kind: "custom",
        version: 1,
      });
      expect(graphBeforeUndo.objects).toHaveLength(1);
      expect(graphBeforeUndo.objects[0]).toMatchObject({
        lineage_id: graphBeforeUndo.objects[0].id,
        layer_id: graphBeforeUndo.layers[0].id,
        name: "DXF LINE 1",
        object_type: "line",
        geometry: {
          type: "line",
          start: { x: 120, y: 100 },
          end: { x: 420, y: 100 },
        },
        status: "active",
        version: 1,
      });
      expect(graphBeforeUndo.sources).toEqual([
        expect.objectContaining({
          object_id: graphBeforeUndo.objects[0].id,
          revision_id: graphBeforeUndo.revision.id,
          source_file_id: fixture.dxfFileId,
          source_sha256: M4_DXF_SHA256,
          source_kind: "dxf_entity",
          dxf_entity_key: "entities:0/block:0@raw:BLOCKS:0:0",
          dxf_entity_type: "LINE",
          dxf_source_layer: "0",
          dxf_handle: "B10C",
          dxf_unit_code: 4,
          dxf_unit_source: "declared",
          dxf_importer_version: 1,
          status: "active",
          version: 1,
        }),
      ]);
      const editorSurface = editorPage.getByLabel(/도면 화면/);
      await expect(editorSurface).toHaveAttribute(
        "data-rendered-object-count",
        "1",
      );

      const importedLine = graphBeforeUndo.objects[0].geometry as {
        type: "line";
        start: { x: number; y: number };
        end: { x: number; y: number };
      };
      const selectImportedLine = async (page: Page) => {
        const surface = page.getByLabel(/도면 화면/);
        await page.getByRole("button", { name: "선택 도구" }).click();
        const point = await drawingSurfacePoint(page, {
          x: (importedLine.start.x + importedLine.end.x) / 2,
          y: (importedLine.start.y + importedLine.end.y) / 2,
        });
        await page.mouse.click(point.x, point.y);
        await expect(surface).toHaveAttribute(
          "data-selected-object-id",
          graphBeforeUndo.objects[0].id,
        );
        await page.getByRole("tab", { name: "객체", exact: true }).click();
      };
      await selectImportedLine(editorPage);
      await expect(
        editorPage.getByRole("region", { name: "선택 객체 원본 근거" }),
      ).toContainText("DXF LINE · 0");

      const importResidueInput = {
        revisionId: graphBeforeUndo.revision.id,
        sourceFileId: fixture.dxfFileId,
        layerIds: graphBeforeUndo.layers.map((layer) => layer.id),
        objectIds: graphBeforeUndo.objects.map((object) => object.id),
      };
      const undoButton = editorPage.getByRole("button", {
        name: "실행 취소",
      });
      await expect(undoButton).toBeEnabled();
      await undoButton.click();
      await expect(editorSurface).toHaveAttribute(
        "data-rendered-object-count",
        "0",
      );
      await expect
        .poll(() => {
          const current = new URL(editorPage.url());
          return {
            objectId: current.searchParams.get("object"),
            revisionId: current.searchParams.get("revision"),
          };
        })
        .toEqual({ objectId: null, revisionId: null });
      await waitUntilSaved(editorPage);
      await expect
        .poll(
          async () =>
            (await canonicalDxfImportResidue(importResidueInput)).active,
          { timeout: 45_000 },
        )
        .toEqual({ layers: [], objects: [], sources: [] });
      const graphAfterUndo =
        await canonicalDxfImportResidue(importResidueInput);
      expect(graphAfterUndo.active).toEqual({
        layers: [],
        objects: [],
        sources: [],
      });
      expect(graphAfterUndo.tombstones.objects).toEqual([
        expect.objectContaining({
          id: graphBeforeUndo.objects[0].id,
          lineage_id: graphBeforeUndo.objects[0].id,
          revision_id: graphBeforeUndo.revision.id,
          page_id: graphBeforeUndo.objects[0].page_id,
          name: "DXF LINE 1",
          object_type: "line",
          geometry: graphBeforeUndo.objects[0].geometry,
          status: "deleted",
          version: 2,
        }),
      ]);
      expect(graphAfterUndo.tombstones.sources).toEqual([
        {
          id: graphBeforeUndo.sources[0].id,
          object_id: graphBeforeUndo.objects[0].id,
          revision_id: graphBeforeUndo.revision.id,
          source_file_id: fixture.dxfFileId,
          source_sha256: M4_DXF_SHA256,
          source_kind: "dxf_entity",
          dxf_entity_key: "entities:0/block:0@raw:BLOCKS:0:0",
          dxf_entity_type: "LINE",
          dxf_source_layer: "0",
          dxf_handle: "B10C",
          dxf_unit_code: 4,
          dxf_unit_source: "declared",
          dxf_importer_version: 1,
          status: "deleted",
          version: 2,
        },
      ]);
      expect(await dxfSourceMetadata(fixture.dxfFileId)).toEqual(
        dxfMetadataBefore,
      );

      const redoButton = editorPage.getByRole("button", {
        name: "다시 실행",
      });
      await expect(redoButton).toBeEnabled();
      await redoButton.click();
      await expect(editorSurface).toHaveAttribute(
        "data-rendered-object-count",
        "1",
      );
      await waitUntilSaved(editorPage);
      await expect
        .poll(
          async () => {
            const graph = await canonicalDxfImportResidue(importResidueInput);
            return {
              layers: graph.active.layers.length,
              objects: graph.active.objects.length,
              sources: graph.active.sources.length,
            };
          },
          { timeout: 45_000 },
        )
        .toEqual({ layers: 1, objects: 1, sources: 1 });
      const graphAfterRedo = await canonicalDxfImportGraph(
        dxfWorkspaceId,
        fixture.dxfFileId,
      );
      expect(dxfImportIdentityGraph(graphAfterRedo)).toEqual(
        dxfImportIdentityGraph(graphBeforeUndo),
      );
      expect(graphAfterRedo.file.sha256).toBe(M4_DXF_SHA256);
      expect(graphAfterRedo.layers[0].version).toBeGreaterThan(
        graphBeforeUndo.layers[0].version,
      );
      expect(graphAfterRedo.objects[0].version).toBeGreaterThan(
        graphBeforeUndo.objects[0].version,
      );
      expect(graphAfterRedo.sources[0].version).toBeGreaterThan(
        graphBeforeUndo.sources[0].version,
      );
      await selectImportedLine(editorPage);
      await expect(
        editorPage.getByRole("region", { name: "선택 객체 원본 근거" }),
      ).toContainText("DXF LINE · 0");

      await editorPage.reload({ waitUntil: "domcontentloaded" });
      await expect(editorPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-rendered-object-count",
        "1",
      );
      expect(
        await canonicalDxfImportGraph(dxfWorkspaceId, fixture.dxfFileId),
      ).toEqual(graphAfterRedo);

      await editorContext.close();
      editorContext = null;
      reloginContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      trackContextEvidence(reloginContext, evidence);
      editorPage = await authenticateContext(
        fixture,
        reloginContext,
        fixture.editor,
        baseUrl,
        canonicalPath(fixture.projectId, dxfWorkspaceId),
      );
      await expect(editorPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-rendered-object-count",
        "1",
      );
      await selectImportedLine(editorPage);
      await expect(
        editorPage.getByRole("region", { name: "선택 객체 원본 근거" }),
      ).toContainText("DXF LINE · 0");
      const graphAfterRelogin = await canonicalDxfImportGraph(
        dxfWorkspaceId,
        fixture.dxfFileId,
      );
      expect(graphAfterRelogin).toEqual(graphAfterRedo);

      viewerContext = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      trackContextEvidence(viewerContext, evidence);
      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        canonicalPath(fixture.projectId, dxfWorkspaceId),
      );
      const viewerImportForm = viewerPage.getByRole("form", {
        name: "DXF 도면 가져오기",
      });
      await expect(viewerImportForm).toBeVisible();
      await expect(
        viewerImportForm.getByLabel("가져올 DXF 원본"),
      ).toBeDisabled();
      await expect(
        viewerImportForm.getByRole("button", { name: "DXF 도면 가져오기" }),
      ).toBeDisabled();
      await selectImportedLine(viewerPage);
      const viewerInspector = viewerPage.getByRole("region", {
        name: "선택 객체 원본 근거",
      });
      await expect(viewerInspector).toContainText("조회 전용");
      await expect(viewerInspector).toContainText("DXF LINE · 0");

      const deniedPrepare = await viewerContext.request.post(
        `${baseUrl}${canonicalPath(fixture.projectId, dxfWorkspaceId)}`,
        {
          form: {
            intent: "prepare_dxf_import",
            revision_id: graphAfterRedo.revision.id,
            canvas_id: graphAfterRedo.layers[0].canvas_id,
            source_file_id: randomUUID(),
            created_at: "2026-09-02T12:00:00.000Z",
            unit_code: "",
          },
          maxRedirects: 0,
        },
      );
      expect(deniedPrepare.status()).toBe(403);
      expect(await deniedPrepare.text()).toContain("권한");

      const graphAfterViewer = await canonicalDxfImportGraph(
        dxfWorkspaceId,
        fixture.dxfFileId,
      );
      const dxfEvidenceAfter = (await readSourceEvidence(fixture))[
        fixture.dxfFileId
      ];
      expect(graphAfterViewer).toEqual(graphAfterRedo);
      expect(dxfEvidenceAfter).toEqual(dxfEvidenceBefore);
      expect(evidence.pageErrors).toEqual([]);
      expect(evidence.responseErrors).toEqual([]);
      expect(
        evidence.consoleErrors.filter((message) =>
          /Unexpected error|Oops!|unhandled/i.test(message),
        ),
      ).toEqual([]);
      await attachJson(testInfo, "m4-canonical-dxf-source-lineage", {
        browserEvidence: evidence,
        dxfEvidenceAfter,
        dxfEvidenceBefore,
        graphAfterRedo,
        graphAfterRelogin,
        graphAfterUndo,
        graphAfterViewer,
        graphBeforeUndo,
        viewerPrepareStatus: deniedPrepare.status(),
        workspaceId: dxfWorkspaceId,
      });
    } finally {
      await Promise.all(
        [editorContext, reloginContext, viewerContext]
          .filter((context): context is BrowserContext => context !== null)
          .map((context) => context.close()),
      );
    }
  });

  test("estimator creates line area and count evidence and restores the bound draft after relogin", async ({
    browser,
  }, testInfo) => {
    let context: BrowserContext | null = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const evidence = trackContextEvidence(context);
    try {
      let page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        `/projects/${fixture.projectId}`,
      );
      await page.getByRole("link", { name: "새 작업실" }).first().click();
      await page.getByLabel("작업실 이름").first().fill("A동 실내 적산");
      await page.getByRole("button", { name: "빈 작업실로 시작" }).click();
      await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
      estimatorWorkspaceId = page.url().split("/").at(-1)!;
      await expect(
        page.getByText("기준 좌표 · 1 도면 단위 = 1 mm"),
      ).toBeVisible();

      await page.getByRole("button", { name: "선 도구" }).click();
      await drawWorldLine(page, { x1: 40, y1: 40, x2: 340, y2: 40 });
      await classifySelectedObject(page, {
        name: "M1 W-001 기준선",
        classification: "벽",
        trade: "금속",
        itemCode: "W-001",
        evidenceKind: "현장 실측",
      });
      await drawWorldTwoPointShape(page, "사각형 도구", {
        x1: 40,
        y1: 100,
        x2: 240,
        y2: 200,
      });
      await classifySelectedObject(page, {
        name: "M1 F-001 바닥",
        classification: "바닥",
        trade: "마감",
        itemCode: "F-001",
        evidenceKind: "가정값",
        evidenceReason: "현장 실측 전 설계 치수 가정",
      });
      await drawWorldTwoPointShape(page, "원 도구", {
        x1: 350,
        y1: 120,
        x2: 380,
        y2: 120,
      });
      await classifySelectedObject(page, {
        name: "M1 D-001 문",
        classification: "문",
        trade: "창호",
        itemCode: "D-001",
        evidenceKind: "수기 입력",
      });

      await page.getByRole("button", { name: "선 도구" }).click();
      await drawWorldLine(page, { x1: 80, y1: 240, x2: 230, y2: 240 });
      await classifySelectedObject(page, {
        name: "M1 임시 천장",
        classification: "천장",
        trade: "마감",
        itemCode: "M1-C-001",
        evidenceKind: "현장 실측",
      });
      await page.getByRole("button", { name: "선 도구" }).click();
      await drawWorldLine(page, { x1: 270, y1: 240, x2: 420, y2: 240 });
      await classifySelectedObject(page, {
        name: "M1 임시 창호",
        classification: "창호",
        trade: "창호",
        itemCode: "M1-WIN-001",
        evidenceKind: "현장 실측",
      });
      await drawWorldTwoPointShape(page, "원 도구", {
        x1: 430,
        y1: 130,
        x2: 450,
        y2: 130,
      });
      await classifySelectedObject(page, {
        name: "M1 임시 가구",
        classification: "가구",
        trade: "가구",
        itemCode: "M1-FUR-001",
        evidenceKind: "수기 입력",
      });
      await drawWorldTwoPointShape(page, "사각형 도구", {
        x1: 350,
        y1: 190,
        x2: 430,
        y2: 230,
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
        .select("id,name,geometry")
        .eq("revision_id", revision.id)
        .in("name", classifiedNames);
      if (objects.error || objects.data?.length !== classifiedNames.length)
        throw (
          objects.error ?? new Error("M1 classified objects did not persist")
        );
      const id = (name: string) =>
        objects.data!.find((row) => row.name === name)!.id;
      const geometry = (name: string) =>
        objects.data!.find((row) => row.name === name)!.geometry;
      expect(geometry("M1 W-001 기준선")).toMatchObject({
        type: "line",
        start: { x: 40, y: 40 },
        end: { x: 340, y: 40 },
      });
      expect(geometry("M1 F-001 바닥")).toMatchObject({
        type: "rectangle",
        origin: { x: 40, y: 100 },
        width: 200,
        height: 100,
      });
      expect(geometry("M1 임시 천장")).toMatchObject({
        type: "line",
        start: { x: 80, y: 240 },
        end: { x: 230, y: 240 },
      });
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
        await deleteObject(page, objectId);
      }

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

      await deleteObject(page, missingRateObjectId);
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

      const readEstimatorRestorationSnapshot = async () => {
        const [
          currentRevision,
          savedObjects,
          propertySchemas,
          propertyValues,
          canvases,
          binding,
          boqVersion,
        ] = await Promise.all([
          fixture.admin
            .from("lukas_drawing_revisions")
            .select("id,document_id,status,version")
            .eq("id", revision.id)
            .single(),
          fixture.admin
            .from("lukas_drawing_objects")
            .select(
              "id,lineage_id,page_id,layer_id,name,object_type,geometry,style_id,style,status,version",
            )
            .eq("revision_id", revision.id)
            .in("id", Object.values(estimatorObjectIds))
            .order("name"),
          fixture.admin
            .from("lukas_drawing_property_schemas")
            .select(
              "id,name,value_type,enum_options,applies_to,required,version",
            )
            .eq("revision_id", revision.id)
            .order("name"),
          fixture.admin
            .from("lukas_drawing_property_values")
            .select("id,schema_id,object_id,block_instance_id,value,version")
            .eq("revision_id", revision.id)
            .in("object_id", Object.values(estimatorObjectIds))
            .order("id"),
          fixture.admin
            .from("lukas_drawing_canvases")
            .select(
              "id,page_id,name,space_kind,width_mm,height_mm,background_source_file_id,background_source_sha256,background_pdf_page,calibration,sort_order,version",
            )
            .eq("revision_id", revision.id)
            .order("sort_order"),
          fixture.admin
            .from("lukas_drawing_estimate_bindings")
            .select(
              "id,project_id,drawing_revision_id,boq_version_id,created_by,created_at",
            )
            .eq("drawing_revision_id", revision.id)
            .single(),
          fixture.admin
            .from("lukas_qto_boq_versions")
            .select(
              "id,project_id,version_no,title,status,engine_version,price_book_id,calculation_policy,quantity_scale,input_state_sha256,result_sha256,manifest_sha256,direct_cost_krw,line_count",
            )
            .eq("id", boqVersionId)
            .single(),
        ]);
        const failed = [
          currentRevision,
          savedObjects,
          propertySchemas,
          propertyValues,
          canvases,
          binding,
          boqVersion,
        ].find((result) => result.error);
        if (failed?.error) throw failed.error;
        return {
          binding: binding.data,
          boqVersion: boqVersion.data,
          canvases: canvases.data ?? [],
          objects: savedObjects.data ?? [],
          propertySchemas: propertySchemas.data ?? [],
          propertyValues: propertyValues.data ?? [],
          revision: currentRevision.data,
        };
      };

      const savedRestorationSnapshot = await readEstimatorRestorationSnapshot();
      expect(savedRestorationSnapshot.revision).toMatchObject({
        document_id: estimatorWorkspaceId,
        id: revision.id,
        status: "draft",
      });
      expect(
        Object.fromEntries(
          savedRestorationSnapshot.objects.map(
            ({ id, name, object_type, status }) => [
              name,
              { id, objectType: object_type, status },
            ],
          ),
        ),
      ).toEqual({
        "M1 D-001 문": {
          id: estimatorObjectIds.count,
          objectType: "circle",
          status: "active",
        },
        "M1 F-001 바닥": {
          id: estimatorObjectIds.area,
          objectType: "rectangle",
          status: "active",
        },
        "M1 W-001 기준선": {
          id: estimatorObjectIds.line,
          objectType: "line",
          status: "active",
        },
      });
      expect(
        Object.fromEntries(
          savedRestorationSnapshot.objects.map(({ geometry, name }) => [
            name,
            geometry,
          ]),
        ),
      ).toEqual({
        "M1 D-001 문": {
          center: { x: 350, y: 120 },
          radius: 30,
          type: "circle",
        },
        "M1 F-001 바닥": {
          height: 100,
          origin: { x: 40, y: 100 },
          rotation: 0,
          type: "rectangle",
          width: 200,
        },
        "M1 W-001 기준선": {
          end: { x: 340, y: 40 },
          start: { x: 40, y: 40 },
          type: "line",
        },
      });
      const schemaNameById = new Map(
        savedRestorationSnapshot.propertySchemas.map(({ id, name }) => [
          id,
          name,
        ]),
      );
      const savedPropertyValues = Object.fromEntries(
        savedRestorationSnapshot.objects.map(({ id, name }) => [
          name,
          Object.fromEntries(
            savedRestorationSnapshot.propertyValues
              .filter(({ object_id }) => object_id === id)
              .map(({ schema_id, value }) => [
                schemaNameById.get(schema_id),
                value,
              ]),
          ),
        ]),
      );
      expect(savedPropertyValues).toEqual({
        "M1 D-001 문": {
          "근거 사유": null,
          "근거 상태": "수기 입력",
          공종: "창호",
          "적산 분류": "문",
          "품목 코드": "D-001",
        },
        "M1 F-001 바닥": {
          "근거 사유": "현장 실측 전 설계 치수 가정",
          "근거 상태": "가정값",
          공종: "마감",
          "적산 분류": "바닥",
          "품목 코드": "F-001",
        },
        "M1 W-001 기준선": {
          "근거 사유": null,
          "근거 상태": "현장 실측",
          공종: "금속",
          "적산 분류": "벽",
          "품목 코드": "W-001",
        },
      });
      expect(savedRestorationSnapshot.canvases).toEqual([
        expect.objectContaining({
          background_pdf_page: null,
          background_source_file_id: null,
          background_source_sha256: null,
          calibration: null,
          height_mm: 297,
          name: "1 Paper",
          sort_order: 0,
          space_kind: "paper",
          width_mm: 420,
        }),
      ]);
      expect(savedRestorationSnapshot.binding).toMatchObject({
        boq_version_id: boqVersionId,
        drawing_revision_id: revision.id,
        project_id: fixture.projectId,
      });
      expect(savedRestorationSnapshot.boqVersion).toMatchObject({
        id: boqVersionId,
        project_id: fixture.projectId,
        status: "draft",
      });

      await page.reload();
      await openResultRail(page);
      await expectExactEstimateRow(page, {
        amount: "3,000원",
        code: "W-001",
        quantity: "0.3 m",
        rate: "10,000원",
        state: "초안",
      });

      await page.goto(`${baseUrl}/`);
      const logoutLink = page.getByRole("link", {
        name: "로그아웃",
        exact: true,
      });
      await expect(logoutLink).toBeVisible();
      await logoutLink.click();
      await expect(page).toHaveURL(`${baseUrl}/`);
      await expect(
        page.getByRole("link", { name: "고객 로그인", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "로그아웃", exact: true }),
      ).toHaveCount(0);
      await page.goto(`${baseUrl}/workspace`);
      await expect(page).toHaveURL(
        `${baseUrl}/auth/magic-link?next=%2Fworkspace`,
      );
      await expect(
        page.getByText("로그인 링크 받기", { exact: true }),
      ).toBeVisible();

      const loggedOutPage = page;
      page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        "/workspace",
      );
      await loggedOutPage.close();
      // Login defaults to the editor's personal space; the estimator belongs
      // to the shared fixture organization, selected through the actual hub UI.
      await page.getByRole("combobox", { name: "작업 공간 선택" })
        .selectOption(fixture.organizationId);
      await expect(page).toHaveURL(
        `${baseUrl}/workspace?space=${fixture.organizationId}`,
      );
      const recent = page.getByRole("region", {
        name: "최근 도면",
        exact: true,
      });
      const estimatorPath = canonicalPath(
        fixture.projectId,
        estimatorWorkspaceId,
      );
      const recentEstimator = recent.locator(`a[href="${estimatorPath}"]`);
      await expect(recentEstimator).toBeVisible();
      await expect(recentEstimator).toContainText("A동 실내 적산");
      await recentEstimator.click();
      await expect(page).toHaveURL(estimatorPath);
      await expect(
        page.getByText("기준 좌표 · 1 도면 단위 = 1 mm"),
      ).toBeVisible();
      expect(await readEstimatorRestorationSnapshot()).toEqual(
        savedRestorationSnapshot,
      );
      await openResultRail(page);
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

      await context.close();
      context = null;

      context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      trackContextEvidence(context, evidence);
      page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      );
      await expect(
        page.getByText("기준 좌표 · 1 도면 단위 = 1 mm"),
      ).toBeVisible();
      expect(await readEstimatorRestorationSnapshot()).toEqual(
        savedRestorationSnapshot,
      );
      await openResultRail(page);
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
      const binding = await fixture.admin
        .from("lukas_drawing_estimate_bindings")
        .select("drawing_revision_id,boq_version_id")
        .eq("drawing_revision_id", revision.id)
        .single();
      if (binding.error) throw binding.error;
      expect(binding.data.boq_version_id).toBe(boqVersionId);

      await selectObject(page, estimatorObjectIds.line);
      await openReviewPanel(page);
      await page
        .getByLabel("연결할 이슈", { exact: true })
        .selectOption(fixture.existingIssueId);
      await page
        .getByRole("button", { name: "선택 객체를 이슈에 연결" })
        .click();
      await expect(
        page
          .getByRole("tabpanel", { name: "댓글·이슈" })
          .getByRole("list", { name: "이슈에 연결된 도면 객체" })
          .getByText("M1 W-001 기준선", { exact: true }),
      ).toBeVisible();
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
      await expect(
        page.getByRole("link", {
          name: "1HK-test-drawing.pdf 작업실 열기",
        }),
      ).toHaveAttribute(
        "href",
        canonicalPath(fixture.projectId, fixture.pdfWorkspace.documentId),
      );
      const pdfButton = page.getByRole("button", {
        name: "1HK-m1-new-background.pdf PDF로 시작",
      });
      const pdfForm = await formValues(pdfButton);
      await pdfButton.click();
      await expect(page).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
      pdfWorkspaceId = page.url().split("/").at(-1)!;
      await page.getByRole("button", { name: "두 점 선택" }).click();
      const surface = page.getByLabel(/도면 화면/);
      await expect(surface).toHaveAttribute("data-pdf-current-mounted", "true");
      const reference = { x1: 120, y1: 150, x2: 300, y2: 150 };
      const calibrationStart = await drawingSurfacePoint(page, {
        x: reference.x1,
        y: reference.y1,
      });
      const calibrationEnd = await drawingSurfacePoint(page, {
        x: reference.x2,
        y: reference.y2,
      });
      await page.mouse.click(calibrationStart.x, calibrationStart.y);
      await page.mouse.click(calibrationEnd.x, calibrationEnd.y);
      await page.getByLabel("실제 길이").fill("5");
      await page
        .getByRole("combobox", { name: "단위", exact: true })
        .selectOption("m");
      await page.getByRole("button", { name: "축척 저장" }).click();
      await waitUntilSaved(page);
      await page.getByRole("button", { name: "선 도구" }).click();
      await drawWorldLine(page, reference);
      await page.getByRole("tab", { name: "객체" }).click();
      await expect(
        page
          .getByLabel("길이 수량")
          .getByText("미리보기 · 5 m", { exact: true }),
      ).toBeVisible();
      await expect(
        page
          .getByLabel("길이 수량")
          .getByText("서버 측정 · 5 m", { exact: true }),
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
          .select("id,source_file_id")
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
      expect(documents.data?.[0]?.source_file_id).toBe(
        fixture.workspaceStartPdfFileId,
      );
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
    const anonymousContext = await browser.newContext();
    const nonMemberContext = await browser.newContext();
    const templateDownloads: Array<{
      bytes: Buffer;
      type: "boq_template_csv";
    }> = [];
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

      const approvedDrawingSnapshot = await fixture.admin
        .from("lukas_drawing_snapshots")
        .select("operation_sequence,sha256")
        .eq("project_id", fixture.projectId)
        .eq("revision_id", estimatorRevision.id)
        .eq("revision_version", approvals.data?.[1]?.subject_version)
        .eq("sha256", approvals.data?.[1]?.snapshot_sha256)
        .single();
      const approvedDrawingSnapshotData = approvedDrawingSnapshot.data;
      if (approvedDrawingSnapshot.error) throw approvedDrawingSnapshot.error;
      if (!approvedDrawingSnapshotData)
        throw new Error("M1 approved drawing snapshot is absent");
      expect(approvedDrawingSnapshotData.sha256).toBe(
        approvals.data?.[1]?.snapshot_sha256,
      );

      await approverPage.reload();
      await approverPage.getByRole("button", { name: "내보내기" }).click();
      const drawingExportDialog = approverPage.getByRole("dialog", {
        name: "도면 내보내기",
      });
      const approvedDrawingExports: Array<{
        artifactType: "drawing_pdf" | "drawing_png" | "drawing_svg";
        byteSize: number;
        checkpointSha256: string;
        operationCheckpoint: number;
        requestId: string;
        revisionId: string;
        revisionSnapshotSha256: string;
        revisionVersion: number;
        sha256: string;
        workspaceId: string;
      }> = [];
      const sourceBeforeApprovedDrawingExports =
        await readSourceEvidence(fixture);
      for (const artifactType of [
        "drawing_pdf",
        "drawing_png",
        "drawing_svg",
      ] as const) {
        const format = artifactType.slice("drawing_".length).toUpperCase();
        await drawingExportDialog.getByRole("radio", { name: format }).check();
        const [download] = await Promise.all([
          approverPage.waitForEvent("download", { timeout: 45_000 }),
          drawingExportDialog.getByRole("button", { name: "다운로드" }).click(),
        ]);
        const bytes = await downloadBytes(download);
        expect(bytes.byteLength).toBeGreaterThan(0);

        const receipt = await fixture.admin
          .from("lukas_qto_export_events")
          .select(
            "request_id,artifact_type,artifact_sha256,artifact_byte_size,workspace_id,revision_id,revision_version,operation_checkpoint,checkpoint_sha256,revision_snapshot_sha256",
          )
          .eq("project_id", fixture.projectId)
          .eq("actor_id", fixture.approver.id)
          .eq("workspace_id", estimatorWorkspaceId)
          .eq("revision_id", estimatorRevision.id)
          .eq("revision_version", approvals.data?.[1]?.subject_version)
          .eq("artifact_type", artifactType)
          .single();
        const receiptData = receipt.data;
        if (receipt.error) throw receipt.error;
        if (!receiptData)
          throw new Error("M1 drawing export receipt is absent");
        expect(receiptData.request_id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
        expect(receiptData.artifact_type).toBe(artifactType);
        expect(receiptData.artifact_sha256).toBe(sha256Bytes(bytes));
        expect(Number(receiptData.artifact_byte_size)).toBe(bytes.byteLength);
        expect(receiptData.workspace_id).toBe(estimatorWorkspaceId);
        expect(receiptData.revision_id).toBe(estimatorRevision.id);
        expect(receiptData.revision_version).toBe(
          approvals.data?.[1]?.subject_version,
        );
        expect(Number(receiptData.operation_checkpoint)).toBe(
          Number(approvedDrawingSnapshotData.operation_sequence),
        );
        expect(receiptData.checkpoint_sha256).toBe(
          approvedDrawingSnapshotData.sha256,
        );
        expect(receiptData.revision_snapshot_sha256).toBe(
          approvedDrawingSnapshotData.sha256,
        );
        approvedDrawingExports.push({
          artifactType,
          byteSize: Number(receiptData.artifact_byte_size),
          checkpointSha256: receiptData.checkpoint_sha256,
          operationCheckpoint: Number(receiptData.operation_checkpoint),
          requestId: receiptData.request_id,
          revisionId: receiptData.revision_id,
          revisionSnapshotSha256: receiptData.revision_snapshot_sha256,
          revisionVersion: receiptData.revision_version,
          sha256: receiptData.artifact_sha256,
          workspaceId: receiptData.workspace_id,
        });
      }
      expect(
        approvedDrawingExports.map(({ artifactType }) => artifactType),
      ).toEqual(["drawing_pdf", "drawing_png", "drawing_svg"]);
      expect(
        new Set(approvedDrawingExports.map(({ requestId }) => requestId)).size,
      ).toBe(3);
      expect(await readSourceEvidence(fixture)).toEqual(
        sourceBeforeApprovedDrawingExports,
      );
      await attachJson(
        testInfo,
        "m1-approved-drawing-export-receipts",
        approvedDrawingExports,
      );

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
        const confirmationButton = editorPage.getByRole("button", {
          name: expectedMeasurement.button,
          exact: true,
        });
        const submitted = await formValues(confirmationButton);
        await confirmationButton.click();
        await expect
          .poll(async () => {
            const persisted = await fixture.admin
              .from("lukas_drawing_quantity_links")
              .select("id,measurement_kind,raw_quantity,unit")
              .eq("id", submitted.link_id)
              .eq("drawing_revision_id", estimatorRevision.id)
              .eq("drawing_object_id", objectId)
              .maybeSingle();
            if (persisted.error) throw persisted.error;
            return persisted.data
              ? {
                  ...persisted.data,
                  raw_quantity: String(persisted.data.raw_quantity),
                }
              : null;
          })
          .toMatchObject({
            id: submitted.link_id,
            measurement_kind: expectedMeasurement.kind,
            raw_quantity: expectedMeasurement.quantity,
            unit: expectedMeasurement.unit,
          });
        await expect(confirmationButton).toHaveCount(0);
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
        expect({
          ...quantity,
          raw_quantity: String(quantity.raw_quantity),
        }).toMatchObject({
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
      for (const path of [
        `/projects/${fixture.projectId}/boq/export/pricebook-template`,
        `/projects/${fixture.projectId}/boq/export/structure-template?version=${boqVersionId}`,
      ]) {
        const response = await editorContext.request.get(`${baseUrl}${path}`);
        expect(response.status()).toBe(200);
        expect(response.headers()["cache-control"]).toBe("private, no-store");
        expect(response.headers()["content-disposition"]).toMatch(
          /^attachment; filename="verified-boq-.*-template\.csv"$/,
        );
        expect(response.headers()["content-type"]).toBe(
          "text/csv; charset=utf-8",
        );
        const bytes = await response.body();
        expect(bytes.byteLength).toBeGreaterThan(0);
        templateDownloads.push({ bytes, type: "boq_template_csv" });
      }
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
        const connectButton = card.getByRole("button", {
          name: "연결",
          exact: true,
        });
        const submitted = await formValues(connectButton);
        await connectButton.click();
        await expect
          .poll(async () => {
            const persisted = await fixture.admin
              .from("lukas_drawing_boq_links")
              .select(
                "id,quantity_link_id,boq_version_id,boq_line_id,allocation_factor",
              )
              .eq("id", submitted.id)
              .eq("quantity_link_id", quantity.id)
              .eq("boq_version_id", boqVersionId)
              .eq("boq_line_id", boqStructure.lineIdsByCode[code])
              .maybeSingle();
            if (persisted.error) throw persisted.error;
            return persisted.data
              ? {
                  ...persisted.data,
                  allocation_factor: String(persisted.data.allocation_factor),
                }
              : null;
          })
          .toMatchObject({
            id: submitted.id,
            quantity_link_id: quantity.id,
            boq_version_id: boqVersionId,
            boq_line_id: boqStructure.lineIdsByCode[code],
            allocation_factor: "1",
          });
        await expect(card.getByText(/OCC V1$/)).toBeVisible();
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
        expect({
          ...link,
          allocation_factor: String(link.allocation_factor),
        }).toMatchObject({
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
      await expect
        .poll(async () => {
          const status = await fixture.admin
            .from("lukas_qto_boq_versions")
            .select("status")
            .eq("id", boqVersionId)
            .single();
          if (status.error) throw status.error;
          return status.data.status;
        })
        .toBe("in_review");
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
      expect(csv.url).toBe(
        `${baseUrl}/projects/${fixture.projectId}/boq/export/csv?version=${boqVersionId}`,
      );
      expect(xlsx.url).toBe(
        `${baseUrl}/projects/${fixture.projectId}/boq/export/xlsx?version=${boqVersionId}`,
      );
      expect(manifestDownload.url).toBe(
        `${baseUrl}/projects/${fixture.projectId}/boq/export/manifest?version=${boqVersionId}`,
      );
      expect([...csv.bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect([...xlsx.bytes.subarray(0, 2)]).toEqual([0x50, 0x4b]);
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
          rawQuantity: String(quantity.raw_quantity),
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
      const bytewiseJson = (left: unknown, right: unknown) =>
        Buffer.compare(
          Buffer.from(JSON.stringify(left), "utf8"),
          Buffer.from(JSON.stringify(right), "utf8"),
        );
      const expectedMappings = (boqLinks.data ?? [])
        .map((link) => ({
          sourceKind: "drawing" as const,
          sourceId: link.quantity_link_id,
          lineId: link.boq_line_id,
          allocationFactor: "1",
        }))
        .sort(bytewiseJson);
      expect(calculation.mappings).toHaveLength(3);
      expect(calculation.mappings).toEqual(expectedMappings);
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

      const reviewerAudits = await fixture.admin
        .from("lukas_qto_export_events")
        .select(
          "artifact_type,artifact_sha256,artifact_byte_size,actor_id,project_id",
        )
        .eq("project_id", fixture.projectId)
        .eq("actor_id", fixture.reviewer.id)
        .in("artifact_type", ["boq_csv", "boq_xlsx", "boq_manifest"]);
      if (reviewerAudits.error) throw reviewerAudits.error;
      const reviewerArtifacts = new Map([
        ["boq_csv", csv.bytes],
        ["boq_xlsx", xlsx.bytes],
        ["boq_manifest", manifestDownload.bytes],
      ]);
      expect(reviewerAudits.data).toHaveLength(3);
      for (const audit of reviewerAudits.data ?? []) {
        const bytes = reviewerArtifacts.get(audit.artifact_type);
        if (!bytes) throw new Error("M1 export audit has an unknown artifact");
        expect(audit).toMatchObject({
          actor_id: fixture.reviewer.id,
          artifact_sha256: sha256Bytes(bytes),
          project_id: fixture.projectId,
        });
        expect(Number(audit.artifact_byte_size)).toBe(bytes.byteLength);
      }
      const templateAudits = await fixture.admin
        .from("lukas_qto_export_events")
        .select("artifact_sha256,artifact_byte_size,actor_id")
        .eq("project_id", fixture.projectId)
        .eq("actor_id", fixture.editor.id)
        .eq("artifact_type", "boq_template_csv");
      if (templateAudits.error) throw templateAudits.error;
      expect(templateAudits.data).toHaveLength(2);
      expect(
        (templateAudits.data ?? [])
          .map((audit) => ({
            byteSize: Number(audit.artifact_byte_size),
            sha256: audit.artifact_sha256,
          }))
          .sort((left, right) => left.sha256.localeCompare(right.sha256)),
      ).toEqual(
        templateDownloads
          .map(({ bytes }) => ({
            byteSize: bytes.byteLength,
            sha256: sha256Bytes(bytes),
          }))
          .sort((left, right) => left.sha256.localeCompare(right.sha256)),
      );

      const exportPath = `/projects/${fixture.projectId}/boq/export/csv?version=${boqVersionId}`;
      const anonymousExport = await anonymousContext.request.get(
        `${baseUrl}${exportPath}`,
        { maxRedirects: 0 },
      );
      expect(anonymousExport.status()).toBeGreaterThanOrEqual(300);
      expect(anonymousExport.status()).toBeLessThan(400);
      await authenticateContext(
        fixture,
        nonMemberContext,
        fixture.nonMember,
        baseUrl,
        "/workspace",
      );
      const foreignExport = await nonMemberContext.request.get(
        `${baseUrl}${exportPath}`,
        { maxRedirects: 0 },
      );
      expect(foreignExport.status()).toBe(404);
      const forbiddenAudits = await fixture.admin
        .from("lukas_qto_export_events")
        .select("id", { count: "exact", head: true })
        .eq("project_id", fixture.projectId)
        .eq("actor_id", fixture.nonMember.id);
      if (forbiddenAudits.error) throw forbiddenAudits.error;
      expect(forbiddenAudits.count).toBe(0);

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
        anonymousContext.close(),
        nonMemberContext.close(),
      ]);
    }
  });

  test("an Admin shares one frozen multi-canvas PDF revision while every direct client authority stays closed", async ({
    browser,
  }) => {
    const pdfBinding = await canonicalPdfBinding(pdfWorkspaceId);
    if (!pdfBinding.sourceFileId || !pdfBinding.sourceSha256)
      throw new Error("Canonical PDF source authority is unavailable");
    const pdfEvidence = await exactProjectSourceEvidence(
      fixture.projectId,
      pdfBinding.sourceFileId,
    );
    expect(pdfEvidence).toMatchObject({
      fileId: pdfBinding.sourceFileId,
      immutable: true,
      kind: "pdf",
      metadataSha256: pdfBinding.sourceSha256,
      storageByteSha256: pdfBinding.sourceSha256,
    });

    const editorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const reviewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const approverContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const editorPage = await authenticateContext(
        fixture,
        editorContext,
        fixture.editor,
        baseUrl,
        canonicalPath(fixture.projectId, pdfWorkspaceId),
      );
      await waitUntilSaved(editorPage);
      await editorPage.getByRole("radio", { name: "작성", exact: true }).click();
      await editorPage.getByRole("tab", { name: "페이지·레이어" }).click();
      await editorPage.getByText("페이지 만들기", { exact: true }).click();
      await editorPage
        .getByRole("textbox", { name: "새 페이지 이름" })
        .fill("공유 검토 시트 2");
      await editorPage.getByRole("button", { name: "페이지 추가" }).click();
      await waitUntilSaved(editorPage);
      await expect
        .poll(async () => {
          const canvases = await fixture.admin
            .from("lukas_drawing_canvases")
            .select("id", { count: "exact", head: true })
            .eq("revision_id", pdfBinding.revisionId);
          if (canvases.error) throw canvases.error;
          return canvases.count;
        })
        .toBe(2);
      await editorPage.getByRole("button", { name: "검토 요청" }).click();
      await expect
        .poll(async () => (await revisionStatus(pdfWorkspaceId)).status)
        .toBe("review_requested");

      const reviewerPage = await authenticateContext(
        fixture,
        reviewerContext,
        fixture.reviewer,
        baseUrl,
        canonicalPath(fixture.projectId, pdfWorkspaceId),
      );
      await reviewerPage
        .getByLabel("검토 의견")
        .fill("공유 PDF 독립 검토 완료");
      await reviewerPage
        .getByRole("button", { name: "도면 검토 완료" })
        .click();
      await expect
        .poll(async () => (await revisionStatus(pdfWorkspaceId)).status)
        .toBe("reviewed");

      const approverPage = await authenticateContext(
        fixture,
        approverContext,
        fixture.approver,
        baseUrl,
        canonicalPath(fixture.projectId, pdfWorkspaceId),
      );
      await approverPage.getByLabel("검토 의견").fill("공유 PDF 최종 승인");
      await approverPage
        .getByRole("button", { name: "도면 최종 승인" })
        .click();
      await expect
        .poll(async () => (await revisionStatus(pdfWorkspaceId)).status)
        .toBe("approved");
    } finally {
      await Promise.all([
        editorContext.close(),
        reviewerContext.close(),
        approverContext.close(),
      ]);
    }

    const revision = await revisionStatus(pdfWorkspaceId);
    expect(revision.status).toBe("approved");
    const snapshot = await approvedSnapshot(revision.id);
    expect(snapshot.subject_version).toBe(revision.version);
    expect(snapshot.snapshot_sha256).toMatch(/^[0-9a-f]{64}$/);
    const [snapshotResult, documentResult] = await Promise.all([
      fixture.admin
        .from("lukas_drawing_snapshots")
        .select(
          "revision_id,revision_version,canonical_json,sha256,schema_version",
        )
        .eq("revision_id", revision.id)
        .eq("revision_version", revision.version)
        .eq("sha256", snapshot.snapshot_sha256)
        .single(),
      fixture.admin
        .from("lukas_drawing_documents")
        .select("title")
        .eq("id", pdfWorkspaceId)
        .eq("project_id", fixture.projectId)
        .single(),
    ]);
    for (const result of [snapshotResult, documentResult])
      if (result.error) throw result.error;
    if (!snapshotResult.data || !documentResult.data)
      throw new Error("Frozen drawing share evidence is unavailable");
    expect(snapshotResult.data).toMatchObject({
      revision_id: revision.id,
      revision_version: revision.version,
      schema_version: 2,
      sha256: snapshot.snapshot_sha256,
    });
    const canonicalSnapshot = snapshotResult.data.canonical_json as {
      revision: { id: string; version: number };
      pages: Array<{ id: string; name: string; sortOrder: number }>;
      canvases: Array<{
        id: string;
        pageId: string;
        name: string;
        background: {
          sourceFileId: string;
          sourceSha256: string;
          pdfPageNumber: number;
        } | null;
      }>;
      layers: Array<{ id: string; canvasId: string }>;
      objects: Array<{ id: string; layerId: string }>;
    };
    expect(canonicalSnapshot.revision).toMatchObject({
      id: revision.id,
      version: revision.version,
    });
    expect(canonicalSnapshot.pages).toHaveLength(2);
    expect(canonicalSnapshot.canvases).toHaveLength(2);
    const pdfCanvas = canonicalSnapshot.canvases.find(
      (canvas) => canvas.id === pdfBinding.canvasId,
    );
    const blankCanvas = canonicalSnapshot.canvases.find(
      (canvas) => canvas.id !== pdfBinding.canvasId,
    );
    if (!pdfCanvas || !blankCanvas)
      throw new Error("Frozen PDF share canvases are unavailable");
    expect(pdfCanvas).toMatchObject({
      background: {
        sourceFileId: pdfBinding.sourceFileId,
        sourceSha256: pdfBinding.sourceSha256,
        pdfPageNumber: pdfBinding.pdfPageNumber,
      },
    });
    expect(blankCanvas.background).toBeNull();
    const pdfLayerIds = new Set(
      canonicalSnapshot.layers
        .filter((layer) => layer.canvasId === pdfCanvas.id)
        .map((layer) => layer.id),
    );
    const selectedObjectId = canonicalSnapshot.objects.find((object) =>
      pdfLayerIds.has(object.layerId),
    )?.id;
    if (!selectedObjectId)
      throw new Error("Frozen PDF canvas object is unavailable");

    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const publicContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const ownerPage = await authenticateContext(
        fixture,
        ownerContext,
        fixture.owner,
        baseUrl,
        canonicalPath(fixture.projectId, pdfWorkspaceId),
      );
      const shareSummary = ownerPage.locator("summary").filter({
        hasText: "공유",
      });
      await expect(shareSummary).toBeVisible();
      await shareSummary.click();

      const ownerApi = await authenticateApiClient(fixture, fixture.owner);
      const browserChosenToken = "B".repeat(43);
      const browserChosenHash = createHash("sha256")
        .update(browserChosenToken)
        .digest("hex");
      const browserBypassRequestId = randomUUID();
      const browserBypass = await ownerApi.rpc(
        "lukas_qto_create_drawing_share",
        {
          p_actor_id: fixture.owner.id,
          p_document_id: pdfWorkspaceId,
          p_project_id: fixture.projectId,
          p_request_id: browserBypassRequestId,
          p_revision_id: revision.id,
          p_revision_version: revision.version,
          p_snapshot_sha256: snapshot.snapshot_sha256,
          p_token_hash: browserChosenHash,
        },
      );
      expect(browserBypass.error).toBeTruthy();
      const [bypassRows, bypassEvents] = await Promise.all([
        fixture.admin
          .from("lukas_qto_drawing_shares")
          .select("id")
          .eq("token_hash", browserChosenHash),
        fixture.admin
          .from("lukas_qto_drawing_share_events")
          .select("id")
          .eq("request_id", browserBypassRequestId),
      ]);
      if (bypassRows.error) throw bypassRows.error;
      if (bypassEvents.error) throw bypassEvents.error;
      expect(bypassRows.data).toEqual([]);
      expect(bypassEvents.data).toEqual([]);

      await ownerPage
        .getByRole("button", { name: "7일 보기 링크 만들기" })
        .click();
      await expect(
        ownerPage.getByText("새 공유 링크", { exact: true }),
      ).toBeVisible();
      const shareLink = ownerPage
        .locator('a[href^="/share/"][href$="/drawing"]')
        .last();
      const sharePath = await shareLink.getAttribute("href");
      expect(sharePath).toMatch(/^\/share\/[A-Za-z0-9_-]{43}\/drawing$/);
      if (!sharePath) throw new Error("Drawing share path is unavailable");
      const rawToken = sharePath.split("/")[2];

      const storedShares = await fixture.admin
        .from("lukas_qto_drawing_shares")
        .select(
          "id,token_hash,project_id,document_id,revision_id,revision_version,snapshot_sha256,revoked_at",
        )
        .eq("project_id", fixture.projectId)
        .eq("document_id", pdfWorkspaceId)
        .eq("revision_id", revision.id)
        .eq("revision_version", revision.version)
        .eq("snapshot_sha256", snapshot.snapshot_sha256)
        .is("revoked_at", null);
      if (storedShares.error) throw storedShares.error;
      expect(storedShares.data).toHaveLength(1);
      expect(storedShares.data?.[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(storedShares.data?.[0]?.token_hash).not.toBe(rawToken);

      const collaborationRequests: string[] = [];
      const publicWebSockets: string[] = [];
      const bearerReferrers: string[] = [];
      const publicPage = await publicContext.newPage();
      publicPage.on("request", (request) => {
        const url = request.url();
        const referer = request.headers().referer;
        if (referer?.includes("/share/")) bearerReferrers.push(referer);
        if (
          url.includes("drawing-collaboration") ||
          url.includes("/realtime/v1") ||
          url.includes("access_token=")
        )
          collaborationRequests.push(url);
      });
      publicPage.on("websocket", (socket) =>
        publicWebSockets.push(socket.url()),
      );
      const publicResponse = await publicPage.goto(`${baseUrl}${sharePath}`);
      expect(publicResponse?.status()).toBe(200);
      expect(publicResponse?.headers()["cache-control"]).toContain("no-store");
      expect(publicResponse?.headers()["referrer-policy"]).toBe("no-referrer");
      expect(publicResponse?.headers()["x-robots-tag"]).toContain("noindex");
      await expect(
        publicPage.getByRole("heading", {
          name: documentResult.data.title,
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        publicPage.getByText("보기 전용 · 원본 수정 불가", { exact: true }),
      ).toBeVisible();
      const surface = publicPage.getByLabel(/도면 화면/);
      await expect(surface).toBeVisible();
      await expect(surface).toHaveAttribute(
        "data-active-canvas-id",
        pdfCanvas.id,
      );
      await expect(surface).toHaveAttribute("data-pdf-current-mounted", "true");
      const sharedCanvas = publicPage.getByRole("region", {
        name: "도면 캔버스",
      });
      await expect(sharedCanvas).toHaveAttribute(
        "data-active-canvas-id",
        pdfCanvas.id,
      );
      await expect(sharedCanvas).toHaveAttribute("data-background-kind", "pdf");
      await expect(sharedCanvas).toHaveAttribute(
        "data-background-source-file-id",
        pdfBinding.sourceFileId,
      );
      await expect(sharedCanvas).toHaveAttribute(
        "data-background-source-sha256",
        pdfBinding.sourceSha256,
      );
      await expect(
        publicPage.locator("footer code").filter({
          hasText: snapshot.snapshot_sha256,
        }),
      ).toHaveText(snapshot.snapshot_sha256);
      await expect(
        publicPage.getByRole("button", { name: "선 도구" }),
      ).toHaveCount(0);
      await expect(
        publicPage.getByRole("button", { name: "검토 요청" }),
      ).toHaveCount(0);
      await expect(
        publicPage.getByRole("button", { name: "내보내기" }),
      ).toHaveCount(0);

      const selectedPoint = await drawingSurfacePoint(
        publicPage,
        await objectWorldPoint(selectedObjectId),
      );
      await publicPage.mouse.click(selectedPoint.x, selectedPoint.y);
      await expect(surface).toHaveAttribute("data-selection-count", "1");
      await expect(surface).toHaveAttribute(
        "data-selected-object-id",
        selectedObjectId,
      );

      const stage = surface.locator(".konvajs-content");
      const stageBox = await stage.boundingBox();
      if (!stageBox) throw new Error("Shared drawing stage has no layout box");
      const center = {
        x: stageBox.x + stageBox.width / 2,
        y: stageBox.y + stageBox.height / 2,
      };
      const beforeZoom = await drawingSurfaceState(surface);
      await publicPage.mouse.move(center.x, center.y);
      await publicPage.mouse.wheel(0, -240);
      await expect
        .poll(async () => (await drawingSurfaceState(surface)).zoom)
        .not.toBe(beforeZoom.zoom);
      const beforePan = await drawingSurfaceState(surface);
      await publicPage.mouse.move(center.x, center.y);
      await publicPage.mouse.down({ button: "middle" });
      await publicPage.mouse.move(center.x + 70, center.y + 35, { steps: 8 });
      await publicPage.mouse.up({ button: "middle" });
      await expect
        .poll(async () => {
          const state = await drawingSurfaceState(surface);
          return `${state.x},${state.y}`;
        })
        .not.toBe(`${beforePan.x},${beforePan.y}`);

      const secondPage = canonicalSnapshot.pages.find(
        (page) => page.id === blankCanvas.pageId,
      );
      if (!secondPage)
        throw new Error("Second frozen share page is unavailable");
      await publicPage
        .getByRole("navigation", { name: "공유 도면 페이지와 캔버스" })
        .locator(`a[href="?canvas=${blankCanvas.id}"]`)
        .click();
      await expect(sharedCanvas).toHaveAttribute(
        "data-active-canvas-id",
        blankCanvas.id,
      );
      await expect(sharedCanvas).toHaveAttribute(
        "data-background-kind",
        "blank",
      );
      await expect(publicPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-pdf-current-mounted",
        "false",
      );
      await publicPage
        .getByRole("navigation", { name: "공유 도면 페이지와 캔버스" })
        .locator(`a[href="?canvas=${pdfCanvas.id}"]`)
        .click();
      await expect(sharedCanvas).toHaveAttribute(
        "data-active-canvas-id",
        pdfCanvas.id,
      );
      await expect(publicPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-pdf-current-mounted",
        "true",
      );

      const publicPersistence = await publicPage.evaluate(async () => ({
        indexedDbNames:
          typeof indexedDB.databases === "function"
            ? (await indexedDB.databases())
                .map(({ name }) => name ?? "")
                .filter(Boolean)
            : [],
        localStorageKeys: Object.keys(localStorage),
        sessionStorageKeys: Object.keys(sessionStorage),
      }));
      expect(
        [
          ...publicPersistence.indexedDbNames,
          ...publicPersistence.localStorageKeys,
          ...publicPersistence.sessionStorageKeys,
        ].filter((name) => /drawing-workspace|outbox|yjs/i.test(name)),
      ).toEqual([]);
      expect(collaborationRequests).toEqual([]);
      expect(publicWebSockets).toEqual([]);
      expect(bearerReferrers).toEqual([]);

      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        canonicalPath(fixture.projectId, pdfWorkspaceId),
      );
      await expect(
        viewerPage.locator("summary").filter({ hasText: "공유" }),
      ).toHaveCount(0);
      const deniedUsers = await Promise.all([
        authenticateApiClient(fixture, fixture.viewer),
        authenticateApiClient(fixture, fixture.editor),
        authenticateApiClient(fixture, fixture.reviewer),
        authenticateApiClient(fixture, fixture.approver),
        authenticateApiClient(fixture, fixture.nonMember),
      ]);
      const deniedScope = {
        p_document_id: pdfWorkspaceId,
        p_project_id: fixture.projectId,
        p_revision_id: revision.id,
        p_revision_version: revision.version,
        p_snapshot_sha256: snapshot.snapshot_sha256,
      };
      const assertDirectShareAuthorityDenied = async (
        client: (typeof deniedUsers)[number],
      ) => {
        const tableRead = await client
          .from("lukas_qto_drawing_shares")
          .select("id")
          .eq("document_id", pdfWorkspaceId);
        expect(tableRead.error).toBeTruthy();
        const deniedCalls = await Promise.all([
          client.rpc("lukas_qto_create_drawing_share", {
            ...deniedScope,
            p_actor_id: fixture.owner.id,
            p_request_id: randomUUID(),
            p_token_hash: "b".repeat(64),
          }),
          client.rpc("lukas_qto_list_drawing_shares", deniedScope),
          client.rpc("lukas_qto_revoke_drawing_share", {
            ...deniedScope,
            p_reason: "권한 거부 반례",
            p_request_id: randomUUID(),
            p_share_id: storedShares.data![0].id,
          }),
          client.rpc("lukas_qto_shared_drawing_revision", {
            p_token: rawToken,
          }),
        ]);
        for (const denied of deniedCalls) expect(denied.error).toBeTruthy();
      };
      for (const client of deniedUsers) {
        await assertDirectShareAuthorityDenied(client);
      }

      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey)
        throw new Error("Supabase public runtime configuration is unavailable");
      const anonymous = createClient(supabaseUrl, supabaseAnonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      await assertDirectShareAuthorityDenied(anonymous);
      const anonymousSignIn = await anonymous.auth.signInAnonymously();
      if (
        anonymousSignIn.error ||
        !anonymousSignIn.data.user ||
        !anonymousSignIn.data.session
      )
        throw (
          anonymousSignIn.error ??
          new Error("Anonymous authenticated session is unavailable")
        );
      try {
        await assertDirectShareAuthorityDenied(anonymous);
      } finally {
        await fixture.admin.auth.admin.deleteUser(anonymousSignIn.data.user.id);
      }

      await ownerPage.getByRole("button", { name: "공유 링크 취소" }).click();
      await expect
        .poll(async () => {
          const revoked = await fixture.admin
            .from("lukas_qto_drawing_shares")
            .select("revoked_at")
            .eq("id", storedShares.data![0].id)
            .single();
          if (revoked.error) throw revoked.error;
          return revoked.data.revoked_at;
        })
        .toBeTruthy();
      await expect(
        ownerPage.getByText("활성 링크 0개", { exact: true }),
      ).toBeVisible();
      const revokedResponse = await publicPage.reload({
        waitUntil: "domcontentloaded",
      });
      expect(revokedResponse?.status()).toBe(404);
      await expect(
        publicPage.getByRole("heading", {
          name: "공유 도면을 열 수 없습니다.",
        }),
      ).toBeVisible();
      const revokedShares = await fixture.admin
        .from("lukas_qto_drawing_shares")
        .select("revoked_at,revoked_by")
        .eq("id", storedShares.data![0].id)
        .single();
      if (revokedShares.error) throw revokedShares.error;
      expect(revokedShares.data.revoked_at).toBeTruthy();
      expect(revokedShares.data.revoked_by).toBe(fixture.owner.id);
    } finally {
      await Promise.all([
        ownerContext.close(),
        viewerContext.close(),
        publicContext.close(),
      ]);
    }
  });

  test("approved BOQ material handoff preserves exact drawing-to-site lineage and Viewer denial", async ({
    browser,
  }, testInfo) => {
    const estimatorRevision = await revisionStatus(estimatorWorkspaceId);
    const boqAuthority = await fixture.admin
      .from("lukas_qto_boq_versions")
      .select(
        "id,project_id,status,engine_version,result_sha256,manifest_sha256",
      )
      .eq("id", boqVersionId)
      .eq("project_id", fixture.projectId)
      .single();
    if (boqAuthority.error) throw boqAuthority.error;
    expect(boqAuthority.data).toMatchObject({
      engine_version: "VERIFIED-BOQ-1.1",
      id: boqVersionId,
      project_id: fixture.projectId,
      status: "approved",
    });
    expect(boqAuthority.data.result_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(boqAuthority.data.manifest_sha256).toMatch(/^[0-9a-f]{64}$/);

    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const ownerPage = await authenticateContext(
        fixture,
        ownerContext,
        fixture.owner,
        baseUrl,
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      );
      ownerPage.setDefaultTimeout(45_000);
      ownerPage.setDefaultNavigationTimeout(45_000);
      await openResultRail(ownerPage);
      const materialCta = ownerPage.getByRole("link", {
        name: "자재 인계",
        exact: true,
      });
      await expect(materialCta).toHaveAttribute(
        "href",
        `/projects/${fixture.projectId}/materials?version=${boqVersionId}`,
      );
      await materialCta.click();
      const materialUrl = `${baseUrl}/projects/${fixture.projectId}/materials?version=${boqVersionId}`;
      await expect(ownerPage).toHaveURL(materialUrl);
      await expect(
        ownerPage.getByText("선택한 승인 BOQ", { exact: true }),
      ).toBeVisible();

      const handoffButton = ownerPage.getByRole("button", {
        name: "선택 자재계획 생성",
        exact: true,
      });
      const handoffForm = handoffButton.locator("xpath=ancestor::form");
      const componentCheckboxes = handoffForm.getByRole("checkbox");
      await expect(componentCheckboxes).toHaveCount(3);
      const wallComponent = handoffForm.getByLabel(
        /^W-001 → W-001 · 경량벽체 · m × 1$/,
      );
      await wallComponent.check();
      await expect(wallComponent).toBeChecked();
      await expect(
        handoffForm.getByLabel(/^F-001 → F-001 · 바닥마감 · m2 × 1$/),
      ).not.toBeChecked();
      await expect(
        handoffForm.getByLabel(/^D-001 → D-001 · 문 세트 · EA × 1$/),
      ).not.toBeChecked();
      await handoffButton.click();
      await expect(ownerPage.getByRole("status")).toHaveText(
        "기록되었습니다. 아래 현황에 새 내용이 반영됐습니다.",
      );
      await expect(ownerPage.getByLabel(/^W-001 →/)).toHaveCount(0);

      await expect
        .poll(async () => {
          const result = await fixture.admin
            .from("lukas_drawing_material_links")
            .select("id", { count: "exact", head: true })
            .eq("project_id", fixture.projectId)
            .eq("boq_version_id", boqVersionId)
            .eq(
              "boq_rate_component_id",
              boqStructure.componentIdsByCode["W-001"],
            );
          if (result.error) throw result.error;
          return result.count;
        })
        .toBe(1);
      const materialLinkResult = await fixture.admin
        .from("lukas_drawing_material_links")
        .select(
          "id,project_id,boq_version_id,boq_line_id,boq_rate_component_id,material_resource_id,boq_result_sha256,material_plan_id,derived_design_quantity,material_rule_version,created_by",
        )
        .eq("project_id", fixture.projectId)
        .eq("boq_version_id", boqVersionId);
      if (materialLinkResult.error) throw materialLinkResult.error;
      expect(materialLinkResult.data).toHaveLength(1);
      const materialLinkAfterHandoff = materialLinkResult.data[0];
      expect({
        ...materialLinkAfterHandoff,
        derived_design_quantity: String(
          materialLinkAfterHandoff.derived_design_quantity,
        ),
      }).toEqual({
        id: materialLinkAfterHandoff.id,
        project_id: fixture.projectId,
        boq_version_id: boqVersionId,
        boq_line_id: boqStructure.lineIdsByCode["W-001"],
        boq_rate_component_id: boqStructure.componentIdsByCode["W-001"],
        material_resource_id: boqStructure.resourceIdsByCode["W-001"],
        boq_result_sha256: boqAuthority.data.result_sha256,
        material_plan_id: materialLinkAfterHandoff.material_plan_id,
        derived_design_quantity: "0.3",
        material_rule_version: "P6_MATERIAL_HANDOFF_V1",
        created_by: fixture.owner.id,
      });

      const drawingObjectLineageUrl = `${baseUrl}${canonicalPath(
        fixture.projectId,
        estimatorWorkspaceId,
      )}?revision=${estimatorRevision.id}&object=${estimatorObjectIds.line}`;
      const drawingObjectBoqHref = `/projects/${fixture.projectId}/boq?version=${boqVersionId}&line=${boqStructure.lineIdsByCode["W-001"]}`;
      const drawingObjectMaterialHref = `/projects/${fixture.projectId}/materials?version=${boqVersionId}&boqLineId=${boqStructure.lineIdsByCode["W-001"]}`;
      await ownerPage.goto(drawingObjectLineageUrl);
      await expect(ownerPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selected-object-id",
        estimatorObjectIds.line,
      );
      await ownerPage.getByRole("tab", { name: "객체", exact: true }).click();
      const ownerObjectInspector = ownerPage.locator(
        "#drawing-object-inspector-panel",
      );
      const assertMaterialProgress = async (
        inspector: Locator,
        linkedSteps: readonly string[],
      ) => {
        for (const step of [
          "자재 인계",
          "발주",
          "입고",
          "시공·폐기",
          "탄소 근거",
        ])
          await expect(
            inspector.locator(`[data-material-progress-step="${step}"]`),
          ).toHaveAttribute(
            "data-material-progress-state",
            linkedSteps.includes(step) ? "linked" : "empty",
          );
      };
      const ownerMaterialLineageStep = ownerObjectInspector.locator(
        '[data-lineage-step="자재 인계"]',
      );
      await expect(ownerMaterialLineageStep).toHaveAttribute(
        "data-lineage-state",
        "linked",
      );
      await assertMaterialProgress(ownerObjectInspector, ["자재 인계"]);
      await expect(
        ownerObjectInspector.getByRole("link", {
          name: /^BOQ W-001 · 배분 /,
        }),
      ).toHaveAttribute("href", drawingObjectBoqHref);
      await expect(
        ownerObjectInspector.getByRole("link", {
          name: "자재 인계 및 후속 기록 확인",
          exact: true,
        }),
      ).toHaveAttribute("href", drawingObjectMaterialHref);
      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      );
      viewerPage.setDefaultTimeout(45_000);
      viewerPage.setDefaultNavigationTimeout(45_000);
      await viewerPage.goto(drawingObjectLineageUrl);
      await expect(viewerPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selected-object-id",
        estimatorObjectIds.line,
      );
      await viewerPage.getByRole("tab", { name: "객체", exact: true }).click();
      const viewerObjectInspector = viewerPage.locator(
        "#drawing-object-inspector-panel",
      );
      const viewerMaterialLineageStep = viewerObjectInspector.locator(
        '[data-lineage-step="자재 인계"]',
      );
      await expect(viewerMaterialLineageStep).toHaveAttribute(
        "data-lineage-state",
        "linked",
      );
      const viewerHandoffOnlySteps = ["자재 인계"] as const;
      await assertMaterialProgress(
        viewerObjectInspector,
        viewerHandoffOnlySteps,
      );
      await ownerPage.goto(materialUrl);

      const materialPlanResult = await fixture.admin
        .from("lukas_qto_material_plans")
        .select(
          "id,project_id,material_code,material_name,specification,unit,design_quantity,allowance_rate,required_quantity,rule_id,required_by,source_file_id,source_sha256,baseline_factor_id,source_artifact_id,source_group_key,created_by",
        )
        .eq("id", materialLinkAfterHandoff.material_plan_id)
        .eq("project_id", fixture.projectId)
        .single();
      if (materialPlanResult.error) throw materialPlanResult.error;
      const materialPlan = materialPlanResult.data;
      expect({
        ...materialPlan,
        allowance_rate: String(materialPlan.allowance_rate),
        design_quantity: String(materialPlan.design_quantity),
        required_quantity: String(materialPlan.required_quantity),
      }).toEqual({
        id: materialLinkAfterHandoff.material_plan_id,
        project_id: fixture.projectId,
        material_code: "W-001",
        material_name: "경량벽체",
        specification: "",
        unit: "m",
        design_quantity: "0.3",
        allowance_rate: "0",
        required_quantity: "0.3",
        rule_id: "P6_MATERIAL_HANDOFF_V1",
        required_by: null,
        source_file_id: materialPlan.source_file_id,
        source_sha256: materialPlan.source_sha256,
        baseline_factor_id: null,
        source_artifact_id: null,
        source_group_key: null,
        created_by: fixture.owner.id,
      });

      const manifestMetadata = await fixture.admin
        .from("lukas_qto_files")
        .select(
          "id,project_id,uploaded_by,kind,storage_path,original_filename,content_type,byte_size,sha256,immutable",
        )
        .eq("id", materialPlan.source_file_id)
        .eq("project_id", fixture.projectId)
        .single();
      if (manifestMetadata.error) throw manifestMetadata.error;
      expect(manifestMetadata.data).toMatchObject({
        id: materialPlan.source_file_id,
        immutable: true,
        kind: "other",
        project_id: fixture.projectId,
        sha256: materialPlan.source_sha256,
        uploaded_by: fixture.owner.id,
      });
      expect(manifestMetadata.data.content_type).toBe("application/json");
      const manifestDownload = await fixture.admin.storage
        .from("lukas-qto")
        .download(manifestMetadata.data.storage_path);
      if (manifestDownload.error || !manifestDownload.data)
        throw (
          manifestDownload.error ??
          new Error("M5 material handoff manifest download failed")
        );
      const manifestBytes = Buffer.from(
        await manifestDownload.data.arrayBuffer(),
      );
      expect(manifestBytes.byteLength).toBe(
        Number(manifestMetadata.data.byte_size),
      );
      expect(sha256Bytes(manifestBytes)).toBe(manifestMetadata.data.sha256);
      expect(sha256Bytes(manifestBytes)).toBe(materialPlan.source_sha256);
      expect(manifestMetadata.data.storage_path).toContain(
        `/boq-manifests/${materialPlan.source_sha256}.manifest.json`,
      );
      const storedManifest = JSON.parse(manifestBytes.toString("utf8"));
      expect(storedManifest).toMatchObject({
        approvalEnvelope: { versionId: boqVersionId },
        calculationManifest: {
          boqVersionId,
          projectId: fixture.projectId,
        },
        resultSha256: boqAuthority.data.result_sha256,
        manifestSha256: boqAuthority.data.manifest_sha256,
      });
      expect(storedManifest.handoffSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(manifestMetadata.data.original_filename).toBe(
        `${storedManifest.handoffSha256}.manifest.json`,
      );

      const factorName = `M5 W-001 일반계수 ${boqVersionId.slice(0, 8)}`;
      const factorDetails = ownerPage
        .locator("details")
        .filter({ hasText: "3. 탄소 정보 입력 (고급)" });
      await factorDetails.locator("summary").click();
      await factorDetails.getByLabel("자재코드").fill("W-001");
      await factorDetails.getByLabel("제품·계수명").fill(factorName);
      await factorDetails.getByLabel("선언단위").selectOption("m");
      await factorDetails.getByLabel("A1-A3 kgCO₂e/단위").fill("1.25");
      await factorDetails.getByLabel("자료 종류").selectOption("generic");
      await factorDetails.getByLabel("표준·PCR").fill("ISO 14040");
      await factorDetails.getByLabel("적용 지역").fill("KR");
      await factorDetails
        .getByLabel("탄소계수 원본")
        .selectOption(fixture.rateBookFileId);
      await factorDetails
        .getByRole("button", { name: "탄소 정보 기록", exact: true })
        .click();
      await expect
        .poll(async () => {
          const result = await fixture.admin
            .from("lukas_qto_carbon_factors")
            .select("id", { count: "exact", head: true })
            .eq("project_id", fixture.projectId)
            .eq("product_name", factorName);
          if (result.error) throw result.error;
          return result.count;
        })
        .toBe(1);
      const materialFactorResult = await fixture.admin
        .from("lukas_qto_carbon_factors")
        .select(
          "id,project_id,material_code,product_name,manufacturer,declared_unit,gwp_a1_a3_per_unit,source_type,standard,geography,valid_from,valid_until,source_file_id,source_sha256,created_by",
        )
        .eq("project_id", fixture.projectId)
        .eq("product_name", factorName)
        .single();
      if (materialFactorResult.error) throw materialFactorResult.error;
      const materialFactor = materialFactorResult.data;
      expect({
        ...materialFactor,
        gwp_a1_a3_per_unit: String(materialFactor.gwp_a1_a3_per_unit),
      }).toEqual({
        id: materialFactor.id,
        project_id: fixture.projectId,
        material_code: "W-001",
        product_name: factorName,
        manufacturer: "",
        declared_unit: "m",
        gwp_a1_a3_per_unit: "1.25",
        source_type: "generic",
        standard: "ISO 14040",
        geography: "KR",
        valid_from: null,
        valid_until: null,
        source_file_id: fixture.rateBookFileId,
        source_sha256: fixture.rateBookEvidence.metadataSha256,
        created_by: fixture.owner.id,
      });

      const transactionSection = () =>
        ownerPage
          .getByRole("heading", {
            name: "2. 발주·입고·설치·계산서",
            exact: true,
          })
          .locator("xpath=ancestor::section");
      const fillTransaction = async (
        section: Locator,
        input: {
          documentNumber: string;
          quantity: string;
          relatedOrderId?: string;
          evidence?: boolean;
          physical?: boolean;
        },
      ) => {
        await section.getByLabel("자재계획").selectOption(materialPlan.id);
        await section.getByLabel("문서번호").fill(input.documentNumber);
        await section.getByLabel("공급사").fill("1HK M5 공급사");
        await section.getByLabel("일자").fill("2026-09-02");
        await section.getByLabel("수량", { exact: true }).fill(input.quantity);
        await section
          .getByLabel("제품 탄소계수")
          .selectOption(materialFactor.id);
        if (input.relatedOrderId)
          await section
            .getByLabel("연결 발주")
            .selectOption(input.relatedOrderId);
        if (input.evidence)
          await section
            .getByLabel("또는 기존 증빙 선택")
            .selectOption(fixture.rateBookFileId);
        if (input.physical) {
          await section.getByLabel("현장 인수자").fill("1HK 현장 담당");
          await section.getByLabel("현장 위치").fill("A동 1층");
          await section.getByLabel("수량과 원본을 확인했습니다").check();
        }
        await section.getByLabel("메모").fill("M5 수직 계보 검증");
      };
      const readTransaction = async (documentNumber: string) => {
        await expect
          .poll(async () => {
            const result = await fixture.admin
              .from("lukas_qto_material_transactions")
              .select("id", { count: "exact", head: true })
              .eq("project_id", fixture.projectId)
              .eq("document_number", documentNumber);
            if (result.error) throw result.error;
            return result.count;
          })
          .toBe(1);
        const result = await fixture.admin
          .from("lukas_qto_material_transactions")
          .select(
            "id,project_id,material_plan_id,transaction_type,document_number,supplier_name,occurred_on,quantity,unit_price_krw,amount_krw,related_order_id,carbon_factor_id,evidence_file_id,evidence_sha256,received_by_name,event_location,site_acknowledgement,note,created_by",
          )
          .eq("project_id", fixture.projectId)
          .eq("document_number", documentNumber)
          .single();
        if (result.error) throw result.error;
        return result.data;
      };

      const transactionPrefix = `M5-${boqVersionId.slice(0, 8)}`;
      let transaction = transactionSection();
      await transaction.getByLabel("기록 종류").selectOption("purchase_order");
      await fillTransaction(transaction, {
        documentNumber: `${transactionPrefix}-PO`,
        quantity: "0.3",
      });
      await transaction
        .getByRole("button", { name: "거래 기록", exact: true })
        .click();
      const purchaseOrder = await readTransaction(`${transactionPrefix}-PO`);

      transaction = transactionSection();
      await transaction.getByLabel("기록 종류").selectOption("goods_receipt");
      await fillTransaction(transaction, {
        documentNumber: `${transactionPrefix}-GR`,
        quantity: "0.3",
        relatedOrderId: purchaseOrder.id,
        evidence: true,
        physical: true,
      });
      await transaction
        .getByRole("button", { name: "거래 기록", exact: true })
        .click();
      const goodsReceipt = await readTransaction(`${transactionPrefix}-GR`);

      transaction = transactionSection();
      await transaction.getByLabel("기록 종류").selectOption("installation");
      await fillTransaction(transaction, {
        documentNumber: `${transactionPrefix}-INSTALL`,
        quantity: "0.2",
        relatedOrderId: purchaseOrder.id,
        evidence: true,
        physical: true,
      });
      await transaction
        .getByRole("button", { name: "거래 기록", exact: true })
        .click();
      const installation = await readTransaction(
        `${transactionPrefix}-INSTALL`,
      );

      transaction = transactionSection();
      await transaction.getByLabel("기록 종류").selectOption("waste_disposal");
      await fillTransaction(transaction, {
        documentNumber: `${transactionPrefix}-WASTE`,
        quantity: "0.1",
        relatedOrderId: purchaseOrder.id,
        evidence: true,
        physical: true,
      });
      await transaction
        .getByRole("button", { name: "거래 기록", exact: true })
        .click();
      const wasteDisposal = await readTransaction(`${transactionPrefix}-WASTE`);

      const persistedTransactions = [
        purchaseOrder,
        goodsReceipt,
        installation,
        wasteDisposal,
      ];
      expect(persistedTransactions.map((row) => row.transaction_type)).toEqual([
        "purchase_order",
        "goods_receipt",
        "installation",
        "waste_disposal",
      ]);
      expect(persistedTransactions.map((row) => String(row.quantity))).toEqual([
        "0.3",
        "0.3",
        "0.2",
        "0.1",
      ]);
      expect(
        persistedTransactions.every(
          (row) =>
            row.project_id === fixture.projectId &&
            row.material_plan_id === materialPlan.id &&
            row.supplier_name === "1HK M5 공급사" &&
            row.carbon_factor_id === materialFactor.id &&
            row.created_by === fixture.owner.id,
        ),
      ).toBe(true);
      expect(purchaseOrder.related_order_id).toBeNull();
      expect(purchaseOrder.evidence_file_id).toBeNull();
      for (const row of [goodsReceipt, installation, wasteDisposal]) {
        expect(row.related_order_id).toBe(purchaseOrder.id);
        expect(row.evidence_file_id).toBe(fixture.rateBookFileId);
        expect(row.evidence_sha256).toBe(
          fixture.rateBookEvidence.metadataSha256,
        );
        expect(row.site_acknowledgement).toBe(true);
        expect(row.received_by_name).toBe("1HK 현장 담당");
        expect(row.event_location).toBe("A동 1층");
      }

      const materialSummary = buildMaterialControlSummaries(
        [materialPlanRow(materialPlan)],
        persistedTransactions.map((row) => materialTransactionRow(row)),
        [carbonFactorRow(materialFactor)],
        "2026-09-02",
      )[0];
      expect(materialSummary).toMatchObject({
        materialPlanId: materialPlan.id,
        materialCode: "W-001",
        designQuantity: "0.3",
        requiredQuantity: "0.3",
        orderedQuantity: "0.3",
        receivedQuantity: "0.3",
        installedQuantity: "0.2",
        returnedQuantity: "0",
        wastedQuantity: "0.1",
        onSiteQuantity: "0",
        invoicedQuantity: "0",
        remainingToOrder: "0",
        remainingToReceive: "0",
        invoiceVariance: "-0.3",
        invoiceAmountKrw: "0",
        baselineA1A3KgCo2e: null,
        carbonCoverage: "complete",
        committedA1A3KgCo2e: "0.375",
        receivedA1A3KgCo2e: "0.375",
        installedA1A3KgCo2e: "0.25",
        productEpdCoveredRows: 0,
        nonProductFactorCoveredRows: 3,
        uncoveredCarbonRows: 0,
        planSourceSha256: materialPlan.source_sha256,
        transactionEvidenceSha256: [fixture.rateBookEvidence.metadataSha256],
        carbonSourceSha256: [fixture.rateBookEvidence.metadataSha256],
        findings: [],
      });

      await ownerPage.reload({ waitUntil: "domcontentloaded" });
      const summaryRow = ownerPage
        .getByRole("row")
        .filter({ hasText: "W-001" })
        .filter({ hasText: "경량벽체" });
      await expect(summaryRow).toHaveCount(1);
      const summaryCells = summaryRow.getByRole("cell");
      await expect(summaryCells).toHaveCount(14);
      for (const [index, text] of [
        [1, "0.3 m"],
        [2, "0.3"],
        [3, "0.3"],
        [4, "0.3"],
        [5, "0.2"],
        [6, "0"],
        [7, "0.1"],
        [8, "0"],
        [9, "0"],
        [10, "0원"],
        [11, "근거 없음"],
        [12, "0.375"],
        [13, "일치"],
      ] as const)
        await expect(summaryCells.nth(index)).toHaveText(text);

      const lineageCard = ownerPage
        .locator("article")
        .filter({ hasText: `자재계획 ${materialPlan.id}` });
      await expect(lineageCard).toHaveCount(1);
      await expect(
        lineageCard.getByText("탄소 근거 완전", { exact: true }),
      ).toBeVisible();
      await expect(lineageCard).toContainText(
        `BOQ 결과 ${boqAuthority.data.result_sha256} · 승인 manifest 파일 ${materialPlan.source_file_id} · SHA ${materialPlan.source_sha256}`,
      );
      await expect(lineageCard).toContainText(
        `자재계획 ${materialPlan.id} · 설계 0.3 m`,
      );
      for (const label of ["발주", "입고", "설치", "폐기"])
        await expect(
          lineageCard.getByText(label, { exact: true }),
        ).toBeVisible();
      await expect(
        lineageCard.getByText(`연결 발주 ${purchaseOrder.id}`, {
          exact: true,
        }),
      ).toHaveCount(3);
      await expect(
        lineageCard.getByText(
          `거래 증빙 SHA ${fixture.rateBookEvidence.metadataSha256}`,
          { exact: true },
        ),
      ).toHaveCount(3);
      await expect(
        lineageCard.getByText(`탄소계수 ${materialFactor.id}`, {
          exact: true,
        }),
      ).toHaveCount(4);
      await expect(
        lineageCard.getByText(factorName, { exact: true }),
      ).toBeVisible();
      await expect(lineageCard).toContainText("일반 계수 · 1.25 kgCO₂e/m");
      await expect(lineageCard).toContainText(
        `탄소계수 ID ${materialFactor.id} · 표준 ISO 14040 · 유효기한 제한 없음 · 원본 SHA ${fixture.rateBookEvidence.metadataSha256}`,
      );
      await lineageCard
        .getByRole("link", { name: "이 탄소계수 계보만 보기", exact: true })
        .click();
      await expect(ownerPage).toHaveURL((url) => {
        const search = Object.fromEntries(url.searchParams);
        return (
          url.pathname === `/projects/${fixture.projectId}/materials` &&
          search.carbonFactorId === materialFactor.id &&
          search.version === boqVersionId
        );
      });
      expect(Object.fromEntries(new URL(ownerPage.url()).searchParams)).toEqual(
        {
          carbonFactorId: materialFactor.id,
          version: boqVersionId,
        },
      );
      await expect(lineageCard).toContainText(factorName);
      await expect(
        lineageCard.locator(
          `[data-material-transaction-id="${goodsReceipt.id}"]`,
        ),
      ).toContainText(`${transactionPrefix}-GR`);

      await ownerPage.goto(
        `${baseUrl}/projects/${fixture.projectId}/materials`,
      );
      const goodsReceiptCard = lineageCard.locator(
        `[data-material-transaction-id="${goodsReceipt.id}"]`,
      );
      await goodsReceiptCard
        .getByRole("link", {
          name: "이 거래 계보만 보기",
          exact: true,
        })
        .click();
      await expect(ownerPage).toHaveURL((url) => {
        return (
          url.pathname === `/projects/${fixture.projectId}/materials` &&
          Object.fromEntries(url.searchParams).transactionId === goodsReceipt.id
        );
      });
      expect(Object.fromEntries(new URL(ownerPage.url()).searchParams)).toEqual(
        { transactionId: goodsReceipt.id },
      );
      await expect(goodsReceiptCard).toContainText(`${transactionPrefix}-GR`);

      await lineageCard
        .getByRole("link", {
          name: "이 BOQ 행 계보만 보기",
          exact: true,
        })
        .click();
      await expect(ownerPage).toHaveURL((url) => {
        return (
          url.pathname === `/projects/${fixture.projectId}/materials` &&
          Object.fromEntries(url.searchParams).version === boqVersionId &&
          Object.fromEntries(url.searchParams).boqLineId ===
            boqStructure.lineIdsByCode["W-001"]
        );
      });
      expect(Object.fromEntries(new URL(ownerPage.url()).searchParams)).toEqual(
        {
          boqLineId: boqStructure.lineIdsByCode["W-001"],
          version: boqVersionId,
        },
      );

      await lineageCard
        .getByRole("link", { name: "승인 BOQ 근거 열기", exact: true })
        .click();
      await expect(ownerPage).toHaveURL(
        `${baseUrl}/projects/${fixture.projectId}/boq?version=${boqVersionId}&line=${boqStructure.lineIdsByCode["W-001"]}`,
      );
      await expect(
        ownerPage.locator(`#boq-line-${boqStructure.lineIdsByCode["W-001"]}`),
      ).toBeFocused();
      const drawingSourceCard = ownerPage
        .getByText(new RegExp(`^객체 ${estimatorObjectIds.line} · 계보 `))
        .locator("xpath=ancestor::li[1]");
      await drawingSourceCard
        .getByRole("link", { name: "도면 작업실 열기", exact: true })
        .click();
      await expect(ownerPage).toHaveURL(
        new RegExp(
          `/projects/${fixture.projectId}/workspaces/${estimatorWorkspaceId}\\?`,
        ),
      );
      const drawingLineageUrl = new URL(ownerPage.url());
      expect(drawingLineageUrl.pathname).toBe(
        canonicalPath(fixture.projectId, estimatorWorkspaceId),
      );
      expect(Object.fromEntries(drawingLineageUrl.searchParams)).toMatchObject({
        revision: estimatorRevision.id,
        object: estimatorObjectIds.line,
        boq: boqVersionId,
        line: boqStructure.lineIdsByCode["W-001"],
      });
      await expect(ownerPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selected-object-id",
        estimatorObjectIds.line,
      );
      await ownerPage.getByRole("tab", { name: "객체", exact: true }).click();
      await assertMaterialProgress(ownerObjectInspector, [
        "자재 인계",
        "발주",
        "입고",
        "시공·폐기",
        "탄소 근거",
      ]);
      await ownerPage
        .getByRole("link", { name: "내역으로 돌아가기", exact: true })
        .click();
      await expect(ownerPage).toHaveURL(
        new RegExp(
          `version=${boqVersionId}.*line=${boqStructure.lineIdsByCode["W-001"]}`,
        ),
      );
      await expect(
        ownerPage.locator(`#boq-line-${boqStructure.lineIdsByCode["W-001"]}`),
      ).toBeFocused();

      const materialImmutableEvidenceAfter = await readSourceEvidence(fixture);
      expect(materialImmutableEvidenceAfter).toEqual(immutableEvidenceBefore);

      await viewerPage.goto(drawingObjectLineageUrl);
      await expect(viewerPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selected-object-id",
        estimatorObjectIds.line,
      );
      await viewerPage.getByRole("tab", { name: "객체", exact: true }).click();
      await expect(viewerMaterialLineageStep).toHaveAttribute(
        "data-lineage-state",
        "linked",
      );
      const viewerCompletedMaterialSteps = [
        "자재 인계",
        "발주",
        "입고",
        "시공·폐기",
        "탄소 근거",
      ] as const;
      await assertMaterialProgress(
        viewerObjectInspector,
        viewerCompletedMaterialSteps,
      );
      await expect(
        viewerObjectInspector.getByRole("link", {
          name: /^BOQ W-001 · 배분 /,
        }),
      ).toHaveAttribute("href", drawingObjectBoqHref);
      await expect(
        viewerObjectInspector.getByRole("link", {
          name: "자재 인계 및 후속 기록 확인",
          exact: true,
        }),
      ).toHaveAttribute("href", drawingObjectMaterialHref);
      await expect(
        viewerPage.getByRole("button", { name: "선 도구", exact: true }),
      ).toHaveCount(0);
      await expect(
        viewerObjectInspector.getByRole("button", {
          name: /확정 근거 만들기$/,
        }),
      ).toHaveCount(0);
      await openResultRail(viewerPage);
      await expect(
        viewerPage.getByRole("link", { name: "자재 인계", exact: true }),
      ).toHaveCount(0);
      await viewerPage.goto(
        `${baseUrl}/projects/${fixture.projectId}/boq?version=${boqVersionId}`,
      );
      await expect(
        viewerPage.getByRole("link", { name: "자재 인계", exact: true }),
      ).toHaveCount(0);
      await viewerPage.goto(materialUrl);
      await expect(
        viewerPage.getByText("승인 BOQ 자재 계보", { exact: true }),
      ).toBeVisible();
      await expect(
        viewerPage.getByText("탄소 근거 완전", { exact: true }),
      ).toBeVisible();
      for (const button of [
        "선택 자재계획 생성",
        "규격별 자재계획 생성",
        "자재계획 기록",
        "거래 기록",
        "탄소 정보 기록",
      ])
        await expect(
          viewerPage.getByRole("button", { name: button, exact: true }),
        ).toHaveCount(0);
      await expect(viewerPage.getByRole("checkbox")).toHaveCount(0);
      await expect(
        viewerPage.getByRole("heading", {
          name: "1. 자재계획 만들기",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        viewerPage.getByRole("heading", {
          name: "2. 발주·입고·설치·계산서",
          exact: true,
        }),
      ).toHaveCount(0);

      const viewerMaterialSnapshotBefore = await materialProjectSnapshot(
        fixture.projectId,
      );
      const viewerMaterialAction = await viewerContext.request.post(
        materialUrl,
        {
          form: { intent: "plan" },
          maxRedirects: 0,
        },
      );
      expect(viewerMaterialAction.status()).toBe(403);
      expect(await viewerMaterialAction.text()).toContain("권한");

      const viewer = await authenticateApiClient(fixture, fixture.viewer);
      const viewerMaterialPlanInsert = await viewer
        .from("lukas_qto_material_plans")
        .insert({
          id: randomUUID(),
          project_id: fixture.projectId,
          material_code: "VIEWER-M5",
          material_name: "Viewer forbidden",
          specification: "forbidden",
          unit: "m",
          design_quantity: "0.3",
          allowance_rate: "0",
          required_quantity: "0.3",
          rule_id: "VIEWER_FORBIDDEN",
          required_by: null,
          source_file_id: fixture.rateBookFileId,
          source_sha256: fixture.rateBookEvidence.metadataSha256,
          baseline_factor_id: null,
          created_by: fixture.viewer.id,
        });
      expect(viewerMaterialPlanInsert.error).toBeTruthy();
      expect(viewerMaterialPlanInsert.error?.code).toBe("42501");
      const viewerMaterialTransactionInsert = await viewer
        .from("lukas_qto_material_transactions")
        .insert({
          id: randomUUID(),
          project_id: fixture.projectId,
          material_plan_id: materialPlan.id,
          transaction_type: "purchase_order",
          document_number: `${transactionPrefix}-VIEWER`,
          supplier_name: "1HK M5 공급사",
          occurred_on: "2026-09-02",
          quantity: "0.3",
          unit_price_krw: null,
          amount_krw: null,
          related_order_id: null,
          carbon_factor_id: materialFactor.id,
          evidence_file_id: null,
          evidence_sha256: null,
          received_by_name: "",
          event_location: "",
          site_acknowledgement: false,
          note: "Viewer forbidden",
          created_by: fixture.viewer.id,
        });
      expect(viewerMaterialTransactionInsert.error).toBeTruthy();
      expect(viewerMaterialTransactionInsert.error?.code).toBe("42501");
      const viewerMaterialSnapshotAfter = await materialProjectSnapshot(
        fixture.projectId,
      );
      expect(viewerMaterialSnapshotAfter).toEqual(viewerMaterialSnapshotBefore);

      await attachJson(testInfo, "m5-material-lineage", {
        boqVersionId,
        drawingRevisionId: estimatorRevision.id,
        drawingObjectId: estimatorObjectIds.line,
        materialLinkId: materialLinkAfterHandoff.id,
        materialPlanId: materialPlan.id,
        materialFactorId: materialFactor.id,
        materialManifest: {
          fileId: manifestMetadata.data.id,
          sha256: manifestMetadata.data.sha256,
          byteSize: manifestBytes.byteLength,
          handoffSha256: storedManifest.handoffSha256,
        },
        summary: materialSummary,
        sourceEvidence: {
          before: immutableEvidenceBefore,
          after: materialImmutableEvidenceAfter,
        },
      });
    } finally {
      await Promise.all([ownerContext.close(), viewerContext.close()]);
    }
  });

  test("an owner publishes an approved estimator revision as a company template and an editor imports one immutable clone exactly once", async ({
    browser,
  }, testInfo) => {
    const sourceRevision = await revisionStatus(estimatorWorkspaceId);
    expect(sourceRevision.status).toBe("approved");
    const sourceSnapshotResult = await fixture.admin
      .from("lukas_drawing_snapshots")
      .select(
        "id,revision_id,revision_version,operation_sequence,canonical_json,sha256,schema_version",
      )
      .eq("revision_id", sourceRevision.id)
      .eq("revision_version", sourceRevision.version)
      .single();
    if (sourceSnapshotResult.error) throw sourceSnapshotResult.error;
    const sourceSnapshotBefore = sourceSnapshotResult.data;
    const sourceFingerprint = await workspaceCloneFingerprint(
      sourceRevision.id,
    );
    expect(sourceFingerprint.layers.length).toBeGreaterThanOrEqual(1);
    expect(sourceFingerprint.objects.length).toBe(3);
    expect(sourceFingerprint.propertySchemas.length).toBe(5);
    expect(sourceFingerprint.propertyValues.length).toBeGreaterThanOrEqual(3);

    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const editorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const libraryPath = `/organizations/${fixture.organizationId}/drawing-library`;
      const ownerPage = await authenticateContext(
        fixture,
        ownerContext,
        fixture.owner,
        baseUrl,
        libraryPath,
      );
      await expect(
        ownerPage.getByRole("heading", { name: "회사 도면 라이브러리" }),
      ).toBeVisible();
      const templateName = `M1 회사 표준 ${randomUUID().slice(0, 8)}`;
      const draftForm = ownerPage.locator(
        `form:has(input[name="kind"][value="workspace_template"]):has(input[name="source_revision_id"][value="${sourceRevision.id}"])`,
      );
      await expect(draftForm).toHaveCount(1);
      await draftForm.getByLabel("라이브러리 이름").fill(templateName);
      await draftForm
        .getByRole("button", { name: "이 리비전으로 초안 만들기" })
        .click();
      await expect(
        ownerPage.getByRole("heading", { name: templateName, exact: true }),
      ).toBeVisible();

      const draftResult = await fixture.admin
        .from("lukas_drawing_library_versions")
        .select(
          "id,registry_id,organization_id,status,version_no,canonical_payload,content_sha256,source_kind,source_project_id,source_revision_id,source_entity_id,created_by",
        )
        .eq("organization_id", fixture.organizationId)
        .eq("source_revision_id", sourceRevision.id)
        .eq("source_kind", "project_revision")
        .single();
      if (draftResult.error) throw draftResult.error;
      const draft = draftResult.data;
      expect(draft).toMatchObject({
        organization_id: fixture.organizationId,
        status: "draft",
        version_no: 1,
        content_sha256: sourceSnapshotBefore.sha256,
        canonical_payload: sourceSnapshotBefore.canonical_json,
        source_project_id: fixture.projectId,
        source_revision_id: sourceRevision.id,
        source_entity_id: null,
        created_by: fixture.owner.id,
      });

      const [viewerClient, nonMemberClient] = await Promise.all([
        authenticateApiClient(fixture, fixture.viewer),
        authenticateApiClient(fixture, fixture.nonMember),
      ]);
      for (const [client, actor] of [
        [viewerClient, "viewer"],
        [nonMemberClient, "nonmember"],
      ] as const) {
        const deniedDraft = await client.rpc(
          "lukas_drawing_create_library_draft",
          {
            p_organization_id: fixture.organizationId,
            p_kind: "workspace_template",
            p_name: `${templateName} ${actor}`,
            p_source_revision_id: sourceRevision.id,
            p_source_entity_id: null,
            p_predecessor_version_id: null,
          },
        );
        expect(deniedDraft.error, `${actor} draft`).toBeTruthy();
        const deniedPublish = await client.rpc(
          "lukas_drawing_publish_library_version",
          {
            p_organization_id: fixture.organizationId,
            p_version_id: draft.id,
          },
        );
        expect(deniedPublish.error, `${actor} publish`).toBeTruthy();
      }

      const versionCard = () =>
        ownerPage.locator("article").filter({
          has: ownerPage.getByRole("heading", {
            name: templateName,
            exact: true,
          }),
        });
      await expect(versionCard()).toHaveCount(1);
      await expect(
        versionCard().getByText("초안", { exact: true }),
      ).toBeVisible();
      await versionCard().getByRole("button", { name: "발행" }).click();
      await expect(
        versionCard().getByText("발행됨", { exact: true }),
      ).toBeVisible();

      const publishedResult = await fixture.admin
        .from("lukas_drawing_library_versions")
        .select(
          "id,registry_id,status,canonical_payload,content_sha256,published_by,published_at",
        )
        .eq("id", draft.id)
        .single();
      if (publishedResult.error) throw publishedResult.error;
      expect(publishedResult.data).toMatchObject({
        id: draft.id,
        registry_id: draft.registry_id,
        status: "published",
        canonical_payload: sourceSnapshotBefore.canonical_json,
        content_sha256: sourceSnapshotBefore.sha256,
        published_by: fixture.owner.id,
      });
      expect(publishedResult.data.published_at).toBeTruthy();

      for (const [client, actor] of [
        [viewerClient, "viewer"],
        [nonMemberClient, "nonmember"],
      ] as const) {
        const deniedImport = await client.rpc(
          "lukas_drawing_import_library_version",
          {
            p_organization_id: fixture.organizationId,
            p_version_id: draft.id,
            p_project_id: fixture.emptyProjectId,
            p_revision_id: null,
            p_client_request_id: randomUUID(),
          },
        );
        expect(deniedImport.error, `${actor} import`).toBeTruthy();
      }

      const startPath = `/projects/${fixture.emptyProjectId}/workspaces/new`;
      const editorPage = await authenticateContext(
        fixture,
        editorContext,
        fixture.editor,
        baseUrl,
        startPath,
      );
      const templateButton = editorPage.getByRole("button", {
        name: `${templateName} 회사 템플릿으로 시작`,
        exact: true,
      });
      await expect(templateButton).toBeVisible();
      const templateForm = await formValues(templateButton);
      expect(templateForm).toEqual({
        intent: "create_library_template",
        clientRequestId: expect.any(String),
        libraryVersionId: draft.id,
      });
      await templateButton.click();
      await expect(editorPage).toHaveURL(/\/workspaces\/[0-9a-f-]{36}$/);
      const targetDocumentId = editorPage.url().split("/").at(-1)!;
      const targetRevision = await revisionStatus(targetDocumentId);
      expect(targetRevision.status).toBe("draft");
      expect(await workspaceCloneFingerprint(targetRevision.id)).toEqual(
        sourceFingerprint,
      );

      const [targetDocument, importResult] = await Promise.all([
        fixture.admin
          .from("lukas_drawing_documents")
          .select("id,project_id,title,source_file_id,created_by")
          .eq("id", targetDocumentId)
          .single(),
        fixture.admin
          .from("lukas_drawing_library_imports")
          .select(
            "id,organization_id,registry_id,version_id,project_id,revision_id,target_entity_id,target_document_id,target_revision_id,source_content_sha256,imported_by,client_request_id,request_sha256",
          )
          .eq("imported_by", fixture.editor.id)
          .eq("client_request_id", templateForm.clientRequestId)
          .single(),
      ]);
      if (targetDocument.error || importResult.error)
        throw targetDocument.error ?? importResult.error;
      expect(targetDocument.data).toEqual({
        id: targetDocumentId,
        project_id: fixture.emptyProjectId,
        title: templateName,
        source_file_id: null,
        created_by: fixture.editor.id,
      });
      expect(importResult.data).toMatchObject({
        organization_id: fixture.organizationId,
        registry_id: draft.registry_id,
        version_id: draft.id,
        project_id: fixture.emptyProjectId,
        revision_id: null,
        target_entity_id: null,
        target_document_id: targetDocumentId,
        target_revision_id: targetRevision.id,
        source_content_sha256: sourceSnapshotBefore.sha256,
        imported_by: fixture.editor.id,
        client_request_id: templateForm.clientRequestId,
        request_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });

      const exactRetry = await editorContext.request.post(
        `${baseUrl}${startPath}`,
        { form: templateForm, maxRedirects: 0 },
      );
      expect(exactRetry.status()).toBeGreaterThanOrEqual(300);
      expect(exactRetry.status()).toBeLessThan(400);
      expect(exactRetry.headers().location).toContain(
        canonicalPath(fixture.emptyProjectId, targetDocumentId),
      );
      const [documentsAfterRetry, importsAfterRetry] = await Promise.all([
        fixture.admin
          .from("lukas_drawing_documents")
          .select("id", { count: "exact", head: true })
          .eq("project_id", fixture.emptyProjectId)
          .eq("title", templateName),
        fixture.admin
          .from("lukas_drawing_library_imports")
          .select("id", { count: "exact", head: true })
          .eq("imported_by", fixture.editor.id)
          .eq("client_request_id", templateForm.clientRequestId),
      ]);
      if (documentsAfterRetry.error || importsAfterRetry.error)
        throw documentsAfterRetry.error ?? importsAfterRetry.error;
      expect(documentsAfterRetry.count).toBe(1);
      expect(importsAfterRetry.count).toBe(1);

      const sourceSnapshotAfterResult = await fixture.admin
        .from("lukas_drawing_snapshots")
        .select(
          "id,revision_id,revision_version,operation_sequence,canonical_json,sha256,schema_version",
        )
        .eq("id", sourceSnapshotBefore.id)
        .single();
      if (sourceSnapshotAfterResult.error)
        throw sourceSnapshotAfterResult.error;
      expect(sourceSnapshotAfterResult.data).toEqual(sourceSnapshotBefore);

      await versionCard().getByRole("button", { name: "사용 중단" }).click();
      await expect(
        versionCard()
          .locator("span")
          .filter({ hasText: /^사용 중단$/ }),
      ).toBeVisible();
      const deprecated = await fixture.admin
        .from("lukas_drawing_library_versions")
        .select("status,deprecated_at,canonical_payload,content_sha256")
        .eq("id", draft.id)
        .single();
      if (deprecated.error) throw deprecated.error;
      expect(deprecated.data).toMatchObject({
        status: "deprecated",
        canonical_payload: sourceSnapshotBefore.canonical_json,
        content_sha256: sourceSnapshotBefore.sha256,
      });
      expect(deprecated.data.deprecated_at).toBeTruthy();

      await editorPage.goto(`${baseUrl}${startPath}`);
      await expect(
        editorPage.getByRole("button", {
          name: `${templateName} 회사 템플릿으로 시작`,
          exact: true,
        }),
      ).toHaveCount(0);
      const blockedAfterDeprecation = await editorContext.request.post(
        `${baseUrl}${startPath}`,
        {
          form: { ...templateForm, clientRequestId: randomUUID() },
          maxRedirects: 0,
        },
      );
      expect(blockedAfterDeprecation.status()).toBe(400);
      const [
        documentsAfterDeprecation,
        importsAfterDeprecation,
        deniedImports,
      ] = await Promise.all([
        fixture.admin
          .from("lukas_drawing_documents")
          .select("id", { count: "exact", head: true })
          .eq("project_id", fixture.emptyProjectId)
          .eq("title", templateName),
        fixture.admin
          .from("lukas_drawing_library_imports")
          .select("id", { count: "exact", head: true })
          .eq("version_id", draft.id),
        fixture.admin
          .from("lukas_drawing_library_imports")
          .select("id", { count: "exact", head: true })
          .in("imported_by", [fixture.viewer.id, fixture.nonMember.id]),
      ]);
      for (const result of [
        documentsAfterDeprecation,
        importsAfterDeprecation,
        deniedImports,
      ])
        if (result.error) throw result.error;
      expect(documentsAfterDeprecation.count).toBe(1);
      expect(importsAfterDeprecation.count).toBe(1);
      expect(deniedImports.count).toBe(0);
      await attachJson(testInfo, "m2-organization-template-import", {
        deniedActors: [fixture.viewer.id, fixture.nonMember.id],
        import: importResult.data,
        sourceFingerprint,
        sourceSnapshotAfter: sourceSnapshotAfterResult.data,
        sourceSnapshotBefore,
        targetDocument: targetDocument.data,
        targetRevision,
        version: deprecated.data,
      });
    } finally {
      await Promise.all([ownerContext.close(), editorContext.close()]);
    }
  });

  test("a source-free canonical workspace keeps mentions and checkpoint restore on its document URL", async ({
    browser,
  }, testInfo) => {
    const editor = await authenticateApiClient(fixture, fixture.editor);
    const reviewer = await authenticateApiClient(fixture, fixture.reviewer);
    const created = await editor.rpc("lukas_drawing_create_document", {
      p_project_id: fixture.emptyProjectId,
      p_source_file_id: null,
      p_title: "M3 source-free canonical collaboration",
      p_blank: true,
    });
    if (created.error) throw created.error;
    const workspace = created.data as Partial<{
      documentId: string;
      revisionId: string;
      workLayerId: string;
    }> | null;
    if (
      !workspace?.documentId ||
      !workspace.revisionId ||
      !workspace.workLayerId
    )
      throw new Error(
        "Source-free canonical collaboration workspace is incomplete",
      );
    const document = await fixture.admin
      .from("lukas_drawing_documents")
      .select("id,project_id,source_file_id,source_sha256")
      .eq("id", workspace.documentId)
      .eq("project_id", fixture.emptyProjectId)
      .single();
    if (document.error) throw document.error;
    expect(document.data.source_file_id).toBeNull();
    expect(document.data.source_sha256).toBeNull();

    const commenterOrganization = await fixture.admin
      .from("lukas_qto_organization_members")
      .insert({
        organization_id: fixture.organizationId,
        user_id: fixture.nonMember.id,
        role: "member",
        library_access: true,
      });
    if (commenterOrganization.error) throw commenterOrganization.error;
    const commenterMembership = await fixture.retentionClient.rpc(
      "lukas_qto_set_project_member",
      {
        p_organization_id: fixture.organizationId,
        p_project_id: fixture.emptyProjectId,
        p_email: fixture.nonMember.email,
        p_role: "site",
        p_request_id: randomUUID(),
      },
    );
    if (commenterMembership.error) throw commenterMembership.error;
    const issueTitle = `M3 source-free canonical issue ${randomUUID()}`;

    const addObject = async (id: string, name: string, x: number) => {
      const result = await editor.rpc("lukas_drawing_apply_operation", {
        p_revision_id: workspace.revisionId!,
        p_client_operation_id: randomUUID(),
        p_operation_type: "add_objects",
        p_base_versions: {},
        p_forward: {
          type: "add_objects",
          objects: [
            {
              id,
              name,
              layerId: workspace.workLayerId!,
              geometry: {
                type: "circle",
                center: { x, y: 80 },
                radius: 8,
              },
              styleId: null,
              style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
              version: 1,
            },
          ],
        },
        p_inverse: { type: "delete_objects", objectIds: [id] },
      });
      if (result.error) throw result.error;
    };
    const checkpointObjectId = randomUUID();
    const postCheckpointObjectId = randomUUID();
    await addObject(checkpointObjectId, "M3 canonical checkpoint object", 80);
    const review = await editor.rpc("lukas_drawing_request_review", {
      p_revision_id: workspace.revisionId,
    });
    if (review.error) throw review.error;
    const reviewEvidence = review.data as {
      snapshotSha256: string;
      subjectVersion: number;
    };
    const rejection = await reviewer.rpc(
      "lukas_drawing_record_revision_decision",
      {
        p_revision_id: workspace.revisionId,
        p_subject_version: reviewEvidence.subjectVersion,
        p_snapshot_sha256: reviewEvidence.snapshotSha256,
        p_decision: "rejected",
        p_note: "M3 source-free canonical checkpoint",
      },
    );
    if (rejection.error) throw rejection.error;
    await addObject(
      postCheckpointObjectId,
      "M3 canonical post-checkpoint object",
      110,
    );

    const ownerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const editorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const reviewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const approverContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const commenterContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const path = canonicalPath(fixture.emptyProjectId, workspace.documentId);
    try {
      const [
        ownerPage,
        editorPage,
        reviewerPage,
        approverPage,
        viewerPage,
        commenterPage,
      ] = await Promise.all([
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
        authenticateContext(
          fixture,
          reviewerContext,
          fixture.reviewer,
          baseUrl,
          path,
        ),
        authenticateContext(
          fixture,
          approverContext,
          fixture.approver,
          baseUrl,
          path,
        ),
        authenticateContext(
          fixture,
          viewerContext,
          fixture.viewer,
          baseUrl,
          path,
        ),
        authenticateContext(
          fixture,
          commenterContext,
          fixture.nonMember,
          baseUrl,
          path,
        ),
      ]);
      for (const page of [ownerPage, editorPage])
        await expect(
          page.getByRole("status", {
            name: "실시간 상태: 실시간 연결됨",
          }),
        ).toBeVisible({ timeout: 45_000 });
      for (const page of [ownerPage, editorPage, reviewerPage, commenterPage]) {
        await openReviewPanel(page);
        await expect(
          page.getByRole("button", {
            name: "새 이슈 만들기",
            exact: true,
          }),
        ).toBeVisible();
      }
      await expect(ownerPage.locator("#workspace-issue-target")).toHaveCount(0);
      await ownerPage
        .getByRole("textbox", { name: "이슈 제목", exact: true })
        .fill(issueTitle);
      await ownerPage
        .getByRole("textbox", { name: "설명", exact: true })
        .fill("Canonical comments, mentions, and canvas region navigation");
      await ownerPage
        .getByRole("combobox", { name: "우선순위", exact: true })
        .selectOption("high");
      await ownerPage
        .getByRole("button", { name: "새 이슈 만들기", exact: true })
        .click();
      let issueId = "";
      await expect
        .poll(async () => {
          const result = await fixture.admin
            .from("lukas_drawing_issues")
            .select("id")
            .eq("project_id", fixture.emptyProjectId)
            .eq("title", issueTitle)
            .maybeSingle();
          if (result.error) throw result.error;
          issueId = result.data?.id ?? "";
          return issueId;
        })
        .toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
        );
      await expect(ownerPage.locator("#workspace-issue-target")).toHaveValue(
        issueId,
      );
      const allowedIssueRequests = [
        {
          context: editorContext,
          title: `M3 editor route issue ${randomUUID()}`,
          userId: fixture.editor.id,
        },
        {
          context: reviewerContext,
          title: `M3 reviewer route issue ${randomUUID()}`,
          userId: fixture.reviewer.id,
        },
        {
          context: commenterContext,
          title: `M3 commenter route issue ${randomUUID()}`,
          userId: fixture.nonMember.id,
        },
      ];
      for (const request of allowedIssueRequests) {
        const response = await request.context.request.post(
          `${baseUrl}${path}`,
          {
            form: {
              description: "Allowed canonical workspace issue",
              intent: "create_issue",
              priority: "normal",
              title: request.title,
            },
            maxRedirects: 0,
          },
        );
        expect(response.status()).toBe(200);
      }
      const allowedIssues = await fixture.admin
        .from("lukas_drawing_issues")
        .select("title,created_by")
        .eq("project_id", fixture.emptyProjectId)
        .in(
          "title",
          allowedIssueRequests.map(({ title }) => title),
        );
      if (allowedIssues.error) throw allowedIssues.error;
      expect(
        new Map(allowedIssues.data.map((row) => [row.title, row.created_by])),
      ).toEqual(
        new Map(
          allowedIssueRequests.map(({ title, userId }) => [title, userId]),
        ),
      );
      await openReviewPanel(editorPage);
      await expect(editorPage.locator("#workspace-issue-target")).toContainText(
        issueTitle,
        { timeout: 15_000 },
      );
      await editorPage.locator("#workspace-issue-target").selectOption(issueId);
      await ownerPage
        .getByRole("textbox", { name: "댓글", exact: true })
        .fill("M3 source-free explicit mention");
      await ownerPage
        .locator('select[name="mentioned_user_ids"]')
        .selectOption([fixture.editor.id]);
      await ownerPage.getByRole("button", { name: "댓글 등록" }).click();
      await expect(
        ownerPage.getByText("M3 source-free explicit mention"),
      ).toBeVisible({ timeout: 15_000 });
      await openReviewPanel(editorPage);
      await expect(
        editorPage.getByText("M3 source-free explicit mention"),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        editorPage.getByText(
          new RegExp(`멘션.*${fixture.editor.id.slice(0, 8)}`),
        ),
      ).toBeVisible();

      for (const page of [ownerPage, reviewerPage]) {
        await openReviewPanel(page);
        await expect(
          page.getByRole("button", {
            name: "캔버스에서 영역 선택",
            exact: true,
          }),
        ).toBeVisible();
      }
      for (const page of [approverPage, viewerPage]) {
        await openReviewPanel(page);
        await expect(
          page.getByRole("button", {
            name: "새 이슈 만들기",
            exact: true,
          }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: "캔버스에서 영역 선택",
            exact: true,
          }),
        ).toHaveCount(0);
      }
      const pageBinding = await fixture.admin
        .from("lukas_drawing_pages")
        .select("id")
        .eq("revision_id", workspace.revisionId!)
        .single();
      if (pageBinding.error) throw pageBinding.error;
      const canvasBinding = await fixture.admin
        .from("lukas_drawing_canvases")
        .select("id")
        .eq("page_id", pageBinding.data.id)
        .single();
      if (canvasBinding.error) throw canvasBinding.error;
      const deniedIssueTitles = [
        `M3 approver forged issue ${randomUUID()}`,
        `M3 viewer forged issue ${randomUUID()}`,
      ];
      for (const [index, context] of [
        approverContext,
        viewerContext,
      ].entries()) {
        const deniedIssue = await context.request.post(`${baseUrl}${path}`, {
          form: {
            description: "Forged canonical workspace issue",
            intent: "create_issue",
            priority: "normal",
            title: deniedIssueTitles[index],
          },
          maxRedirects: 0,
        });
        expect(deniedIssue.status()).toBe(403);
        const denied = await context.request.post(`${baseUrl}${path}`, {
          form: {
            anchor_id: randomUUID(),
            canvas_id: canvasBinding.data.id,
            height_mm: "10",
            intent: "add_canvas_region_anchor",
            issue_id: issueId,
            page_id: pageBinding.data.id,
            revision_id: workspace.revisionId!,
            width_mm: "10",
            x_mm: "10",
            y_mm: "10",
          },
          maxRedirects: 0,
        });
        expect(denied.status()).toBe(403);
      }
      const deniedIssues = await fixture.admin
        .from("lukas_drawing_issues")
        .select("id", { count: "exact", head: true })
        .eq("project_id", fixture.emptyProjectId)
        .in("title", deniedIssueTitles);
      if (deniedIssues.error) throw deniedIssues.error;
      expect(deniedIssues.count).toBe(0);

      await openReviewPanel(ownerPage);
      const regionButton = ownerPage.getByRole("button", {
        name: "캔버스에서 영역 선택",
        exact: true,
      });
      const regionForm = ownerPage.locator("form").filter({
        has: ownerPage.locator(
          'input[name="intent"][value="add_canvas_region_anchor"]',
        ),
      });
      await expect(regionForm).toHaveCount(1);
      const regionSubmit = regionForm.getByRole("button", {
        name: "현재 캔버스 영역 연결",
        exact: true,
      });
      const drawingSurface = ownerPage.getByLabel(/도면 화면/);
      const surfaceBox = await drawingSurface.boundingBox();
      if (!surfaceBox)
        throw new Error("Canvas region picker surface is missing");
      const anchorCount = async () => {
        const result = await fixture.admin
          .from("lukas_drawing_canvas_region_anchors")
          .select("id", { count: "exact", head: true })
          .eq("issue_id", issueId)
          .eq("revision_id", workspace.revisionId!);
        if (result.error) throw result.error;
        return result.count;
      };
      await expect.poll(anchorCount).toBe(0);
      await regionButton.click();
      await ownerPage.mouse.move(surfaceBox.x + 180, surfaceBox.y + 180);
      await ownerPage.mouse.down();
      await ownerPage.keyboard.press("Escape");
      await ownerPage.mouse.up();
      await expect.poll(anchorCount).toBe(0);
      await expect(
        regionForm.getByText("선택 영역 ·", { exact: false }),
      ).toHaveCount(0);
      await expect(regionSubmit).toBeDisabled();
      for (const fieldName of [
        "anchor_id",
        "x_mm",
        "y_mm",
        "width_mm",
        "height_mm",
      ]) {
        await expect(
          regionForm.locator(`input[name="${fieldName}"]`),
        ).toHaveValue("");
      }
      await ownerPage.mouse.move(surfaceBox.x + 180, surfaceBox.y + 180);
      await ownerPage.mouse.down();
      await ownerPage.mouse.move(surfaceBox.x + 260, surfaceBox.y + 240);
      await ownerPage.mouse.up();
      await expect(
        regionForm.getByText("선택 영역 ·", { exact: false }),
      ).toBeVisible();
      await expect(regionSubmit).toBeEnabled();
      const regionAnchorId = await regionForm
        .locator('input[name="anchor_id"]')
        .inputValue();
      expect(regionAnchorId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      const regionLabel = `M3 canvas anchor ${randomUUID()}`;
      await regionForm
        .getByLabel("영역 설명", { exact: true })
        .fill(regionLabel);
      await regionSubmit.click();
      await expect(regionForm.locator('input[name="anchor_id"]')).toHaveValue(
        regionAnchorId,
      );
      await expect.poll(anchorCount).toBe(1);
      const [anchor, pageRow] = await Promise.all([
        fixture.admin
          .from("lukas_drawing_canvas_region_anchors")
          .select(
            "id,issue_id,revision_id,page_id,canvas_id,label,x_mm,y_mm,width_mm,height_mm",
          )
          .eq("issue_id", issueId)
          .eq("revision_id", workspace.revisionId!)
          .eq("label", regionLabel)
          .single(),
        fixture.admin
          .from("lukas_drawing_pages")
          .select("id")
          .eq("revision_id", workspace.revisionId!)
          .single(),
      ]);
      if (anchor.error || pageRow.error) throw anchor.error ?? pageRow.error;
      const canvasRow = await fixture.admin
        .from("lukas_drawing_canvases")
        .select("id")
        .eq("page_id", pageRow.data.id)
        .single();
      if (canvasRow.error) throw canvasRow.error;
      expect(anchor.data).toMatchObject({
        id: regionAnchorId,
        issue_id: issueId,
        revision_id: workspace.revisionId,
        page_id: pageRow.data.id,
        canvas_id: canvasRow.data.id,
        label: regionLabel,
      });
      expect(Number(anchor.data.width_mm)).toBeGreaterThan(0);
      expect(Number(anchor.data.height_mm)).toBeGreaterThan(0);

      const ownerRegionAnnotation = ownerPage.getByRole("button", {
        name: `이슈 영역: ${regionLabel}`,
        exact: true,
      });
      await expect(ownerRegionAnnotation).toBeVisible({ timeout: 15_000 });
      await ownerPage.reload();
      await expect(
        ownerPage.getByRole("button", {
          name: `이슈 영역: ${regionLabel}`,
          exact: true,
        }),
      ).toBeVisible({ timeout: 15_000 });
      await viewerPage.reload();
      const viewerWorkspaceShell = viewerPage.locator(
        ".drawing-workspace-shell",
      );
      await expect(
        viewerPage.getByRole("tab", { name: "페이지·레이어" }),
      ).toHaveAttribute("aria-selected", "true");
      const viewerRegionAnnotation = viewerPage.getByRole("button", {
        name: `이슈 영역: ${regionLabel}`,
        exact: true,
      });
      await expect(viewerRegionAnnotation).toBeVisible({ timeout: 15_000 });
      await viewerPage
        .getByRole("button", { name: "왼쪽 도구 패널 숨기기" })
        .click();
      await expect(viewerWorkspaceShell).toHaveAttribute(
        "data-left-dock-open",
        "false",
      );
      await viewerRegionAnnotation.click();
      await expect(viewerWorkspaceShell).toHaveAttribute(
        "data-left-dock-open",
        "true",
      );
      await expect(
        viewerPage.getByRole("complementary", { name: "도면 도구 패널" }),
      ).toBeVisible();
      await expect(
        viewerPage.getByRole("tabpanel", { name: "댓글·이슈" }),
      ).toBeVisible();
      await expect(
        viewerPage.getByRole("tab", { name: "댓글·이슈" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(viewerPage.locator("#workspace-issue-target")).toHaveValue(
        issueId,
      );

      await openReviewPanel(ownerPage);
      await ownerPage.getByRole("tab", { name: "변경 이력" }).click();
      await expect(
        ownerPage.getByRole("region", { name: "변경 이력" }),
      ).toContainText("add_objects");
      await ownerPage
        .getByRole("button", { name: /상태로 복원/ })
        .first()
        .click();
      await waitUntilSaved(ownerPage);
      await expect(ownerPage).toHaveURL(`${baseUrl}${path}`);
      const graph = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id")
        .eq("revision_id", workspace.revisionId)
        .in("id", [checkpointObjectId, postCheckpointObjectId])
        .eq("status", "active");
      if (graph.error) throw graph.error;
      expect(graph.data.map((row) => row.id)).toEqual([checkpointObjectId]);
      const restore = await fixture.admin
        .from("lukas_drawing_operations")
        .select("operation_type,forward")
        .eq("revision_id", workspace.revisionId)
        .eq("operation_type", "restore_checkpoint")
        .single();
      if (restore.error) throw restore.error;
      expect(
        (restore.data.forward as { checkpointId?: string }).checkpointId,
      ).toBeTruthy();
      await attachJson(testInfo, "m3-source-free-canonical-social-restore", {
        checkpointObjectId,
        document: document.data,
        issueId,
        postCheckpointObjectId,
        revisionId: workspace.revisionId,
        url: ownerPage.url(),
      });
    } finally {
      await Promise.all([
        ownerContext.close(),
        editorContext.close(),
        reviewerContext.close(),
        approverContext.close(),
        viewerContext.close(),
        commenterContext.close(),
      ]);
    }
  });

  test("saved issue regions preserve PDF canvas input ownership and accessible navigation", async ({
    browser,
  }) => {
    const editor = await authenticateApiClient(fixture, fixture.editor);
    const decoyIssue = await fixture.retentionClient
      .from("lukas_drawing_issues")
      .insert({
        project_id: fixture.projectId,
        title: `M3 region input decoy ${randomUUID()}`,
        description: "Selection sentinel for region input ownership",
        priority: "normal",
        created_by: fixture.owner.id,
      })
      .select("id")
      .single();
    if (decoyIssue.error) throw decoyIssue.error;
    const objectId = randomUUID();
    const objectResult = await editor.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.pdfWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "add_objects",
      p_base_versions: {},
      p_forward: {
        type: "add_objects",
        objects: [
          {
            id: objectId,
            name: "M3 region interior object",
            layerId: fixture.pdfWorkspace.workLayerId,
            geometry: {
              type: "circle",
              center: { x: 100, y: 90 },
              radius: 8,
            },
            styleId: null,
            style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
            version: 1,
          },
        ],
      },
      p_inverse: { type: "delete_objects", objectIds: [objectId] },
    });
    if (objectResult.error) throw objectResult.error;
    const region = { x: 40, y: 40, width: 120, height: 100 };
    const regionAnchorId = randomUUID();
    const regionLabel = `M3 PDF input region ${randomUUID()}`;
    const anchorResult = await fixture.retentionClient.rpc(
      "lukas_drawing_add_canvas_region_anchor",
      {
        p_anchor_id: regionAnchorId,
        p_canvas_id: fixture.pdfWorkspace.canvasId,
        p_height_mm: region.height,
        p_issue_id: fixture.existingIssueId,
        p_label: regionLabel,
        p_page_id: fixture.pdfWorkspace.pageId,
        p_revision_id: fixture.pdfWorkspace.revisionId,
        p_width_mm: region.width,
        p_x_mm: region.x,
        p_y_mm: region.y,
      },
    );
    if (anchorResult.error) throw anchorResult.error;

    const editorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const approverContext = await browser.newContext({
      viewport: { width: 1024, height: 768 },
    });
    const path = canonicalPath(
      fixture.projectId,
      fixture.pdfWorkspace.documentId,
    );
    try {
      const editorPage = await authenticateContext(
        fixture,
        editorContext,
        fixture.editor,
        baseUrl,
        path,
      );
      const surface = editorPage.getByLabel(/도면 화면/);
      const annotation = editorPage.getByRole("button", {
        name: `이슈 영역: ${regionLabel}`,
        exact: true,
      });
      await expect(annotation).toBeVisible({ timeout: 15_000 });
      await openReviewPanel(editorPage);
      await editorPage
        .locator("#workspace-issue-target")
        .selectOption(decoyIssue.data.id);
      await selectObject(editorPage, objectId);
      await expectRegionAnnotationAligned(surface, annotation, region);

      const surfaceBox = await surface.boundingBox();
      if (!surfaceBox) throw new Error("PDF region surface is unavailable");
      const zoomBefore = await drawingSurfaceState(surface);
      await editorPage.mouse.move(
        surfaceBox.x + surfaceBox.width / 2,
        surfaceBox.y + surfaceBox.height / 2,
      );
      await editorPage.mouse.wheel(0, -240);
      await expect
        .poll(async () => (await drawingSurfaceState(surface)).zoom)
        .not.toBe(zoomBefore.zoom);
      await expectRegionAnnotationAligned(surface, annotation, region);

      await editorPage.getByRole("radio", { name: "작성", exact: true }).click();
      await editorPage.getByRole("tab", { name: "페이지·레이어" }).click();
      await surface.focus();
      await editorPage.keyboard.down("Space");
      await expect(annotation).toHaveAttribute("aria-disabled", "true");
      await expect(annotation).toHaveAttribute("tabindex", "-1");
      const panBefore = await drawingSurfaceState(surface);
      const annotationBox = await annotation.boundingBox();
      if (!annotationBox)
        throw new Error("PDF region label is unavailable for Space-pan");
      await editorPage.mouse.move(
        annotationBox.x + annotationBox.width / 2,
        annotationBox.y + annotationBox.height / 2,
      );
      await editorPage.mouse.down();
      await editorPage.mouse.move(annotationBox.x + 70, annotationBox.y + 45, {
        steps: 4,
      });
      await editorPage.mouse.up();
      await expect
        .poll(async () => {
          const current = await drawingSurfaceState(surface);
          return `${current.x},${current.y}`;
        })
        .not.toBe(`${panBefore.x},${panBefore.y}`);
      await editorPage.keyboard.up("Space");
      await expectRegionAnnotationAligned(surface, annotation, region);
      await expect(
        editorPage.getByRole("tab", { name: "페이지·레이어" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(surface).toHaveAttribute(
        "data-selected-object-id",
        objectId,
      );

      await editorPage.getByRole("button", { name: "두 점 선택" }).click();
      await expect(annotation).toHaveAttribute("aria-disabled", "true");
      await expect(annotation).toHaveAttribute("tabindex", "-1");
      await annotation.evaluate((node) => (node as HTMLButtonElement).click());
      await expect(
        editorPage.getByRole("tab", { name: "페이지·레이어" }),
      ).toHaveAttribute("aria-selected", "true");
      await editorPage.keyboard.press("Escape");

      await editorPage.getByRole("button", { name: "선 도구" }).click();
      await expect(annotation).toHaveAttribute("aria-disabled", "true");
      await expect(annotation).toHaveAttribute("tabindex", "-1");
      await annotation.evaluate((node) => (node as HTMLButtonElement).click());
      await expect(
        editorPage.getByRole("tab", { name: "페이지·레이어" }),
      ).toHaveAttribute("aria-selected", "true");
      await editorPage.getByRole("button", { name: "선택 도구" }).click();

      await openReviewPanel(editorPage);
      await editorPage
        .getByRole("button", { name: "캔버스에서 영역 선택", exact: true })
        .click();
      await expect(annotation).toHaveAttribute("aria-disabled", "true");
      await expect(annotation).toHaveAttribute("tabindex", "-1");
      await annotation.evaluate((node) => (node as HTMLButtonElement).click());
      await expect(editorPage.locator("#workspace-issue-target")).toHaveValue(
        decoyIssue.data.id,
      );
      await editorPage
        .getByRole("button", { name: "영역 선택 취소", exact: true })
        .click();

      const approverPage = await authenticateContext(
        fixture,
        approverContext,
        fixture.approver,
        baseUrl,
        path,
      );
      const approverSurface = approverPage.getByLabel(/도면 화면/);
      const approverShell = approverPage.locator(".drawing-workspace-shell");
      const approverAnnotation = approverPage.getByRole("button", {
        name: `이슈 영역: ${regionLabel}`,
        exact: true,
      });
      await expect(approverAnnotation).toBeVisible({ timeout: 15_000 });
      await selectObject(approverPage, objectId);
      await expect(approverShell).toHaveAttribute(
        "data-left-dock-open",
        "false",
      );
      await expect(approverShell).toHaveAttribute(
        "data-inspector-open",
        "true",
      );
      await approverAnnotation.focus();
      await approverAnnotation.press("Enter");
      await expect(approverShell).toHaveAttribute(
        "data-left-dock-open",
        "true",
      );
      await expect(approverShell).toHaveAttribute(
        "data-inspector-open",
        "false",
      );
      await expect(
        approverPage.getByRole("tab", { name: "댓글·이슈" }),
      ).toHaveAttribute("aria-selected", "true");
      await expect(approverPage.locator("#workspace-issue-target")).toHaveValue(
        fixture.existingIssueId,
      );
      await expect(approverSurface).toHaveAttribute(
        "data-selected-object-id",
        objectId,
      );
    } finally {
      await Promise.all([editorContext.close(), approverContext.close()]);
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
    const editorEvidence = trackContextEvidence(editorContext);
    const viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const reviewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const approverContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const path = canonicalPath(fixture.projectId, collaborationWorkspaceId);
      const [ownerPage, editorPage, viewerPage] = await Promise.all([
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
        authenticateContext(
          fixture,
          viewerContext,
          fixture.viewer,
          baseUrl,
          path,
        ),
      ]);
      for (const page of [ownerPage, editorPage, viewerPage]) {
        await expect(
          page.getByRole("status", { name: "공동 편집 상태: connected" }),
        ).toBeVisible({ timeout: 45_000 });
        await expect(
          page.getByRole("status", { name: "공동 작업 참여자 3명" }),
        ).toBeVisible({ timeout: 45_000 });
      }
      await expect(
        viewerPage.getByRole("status", {
          name: "공동 편집 상태: connected",
        }),
      ).toContainText("읽기 전용");
      await expect(
        viewerPage.getByRole("button", { name: "선 도구" }),
      ).toHaveCount(0);

      const collaborativeName = `M1 shared ${randomUUID()}`;
      await ownerPage.getByRole("button", { name: "선 도구" }).click();
      await drawLine(ownerPage, { x1: 280, y1: 260, x2: 500, y2: 260 });
      await ownerPage.getByRole("tab", { name: "객체" }).click();
      await ownerPage
        .getByLabel("객체 이름", { exact: true })
        .fill(collaborativeName);
      await ownerPage
        .getByRole("button", { name: "속성 적용", exact: true })
        .click();
      await waitUntilSaved(ownerPage);
      const sharedObject = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,geometry,version")
        .eq("revision_id", revision.id)
        .eq("name", collaborativeName)
        .single();
      if (sharedObject.error) throw sharedObject.error;
      await expect(editorPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-rendered-object-count",
        "1",
        { timeout: 30_000 },
      );

      await selectObject(ownerPage, sharedObject.data.id);
      await ownerPage.keyboard.press("ArrowRight");
      await waitUntilSaved(ownerPage);
      await expect
        .poll(
          async () => {
            const result = await fixture.admin
              .from("lukas_drawing_objects")
              .select("geometry,version")
              .eq("id", sharedObject.data.id)
              .single();
            if (result.error) throw result.error;
            return result.data.version;
          },
          { timeout: 30_000 },
        )
        .toBeGreaterThan(sharedObject.data.version);
      const movedObject = await fixture.admin
        .from("lukas_drawing_objects")
        .select("geometry,version")
        .eq("id", sharedObject.data.id)
        .single();
      if (movedObject.error) throw movedObject.error;
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
      const editorDisplayName = fixture.editor.email.split("@")[0];
      const editorCursorPoint = await drawingSurfacePoint(
        editorPage,
        await objectWorldPoint(sharedObject.data.id),
      );
      await editorPage.mouse.move(editorCursorPoint.x, editorCursorPoint.y);
      const editorCursor = ownerPage.getByLabel(`${editorDisplayName} 커서`);
      await expect(editorCursor).toBeVisible({ timeout: 30_000 });
      await expect(editorCursor).toHaveAttribute(
        "data-remote-selection-ids",
        sharedObject.data.id,
      );
      await expect(ownerPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-remote-selection-count",
        "1",
      );

      const warmGeometry = movedObject.data.geometry as {
        end?: { x: number; y: number };
        start?: { x: number; y: number };
        type?: string;
      };
      if (
        warmGeometry.type !== "line" ||
        !warmGeometry.start ||
        !warmGeometry.end
      )
        throw new Error("M3 reflection warm-up did not produce a line");
      const warmBounds = {
        maxX: Math.max(warmGeometry.start.x, warmGeometry.end.x),
        maxY: Math.max(warmGeometry.start.y, warmGeometry.end.y),
        minX: Math.min(warmGeometry.start.x, warmGeometry.end.x),
        minY: Math.min(warmGeometry.start.y, warmGeometry.end.y),
      };
      const reflectionSamplesMilliseconds: number[] = [];
      const reflectionTargetMilliseconds = 500;
      const reflectionSampleCount = 30;
      const reflectionBrowser = {
        name: browser.browserType().name(),
        userAgent: await ownerPage.evaluate(() => navigator.userAgent),
        version: browser.version(),
      };
      const reflectionViewport = ownerPage.viewportSize();
      const reflectionMemory = {
        freeBytesAtMeasurement: os.freemem(),
        totalBytes: os.totalmem(),
      };
      const reflectionStatusObservations: CollaborationStatusObservation[] = [
        { name: "Owner", page: ownerPage, readOnly: false, violations: [] },
        { name: "Editor", page: editorPage, readOnly: false, violations: [] },
        { name: "Viewer", page: viewerPage, readOnly: true, violations: [] },
      ];
      let hasReflectionPrimaryError = false;
      let reflectionEvidenceError: unknown;
      let reflectionPrimaryError: unknown;
      let reflectionMeasurementComplete = false;
      try {
        await Promise.all(
          reflectionStatusObservations.map(startCollaborationStatusObservation),
        );
        await inspectCollaborationStatusObservations(
          reflectionStatusObservations,
        );
        expect(
          reflectionStatusObservations.flatMap((observation) =>
            observation.violations.map(
              (violation) => `${observation.name}: ${violation}`,
            ),
          ),
        ).toEqual([]);
        for (let index = 0; index < reflectionSampleCount; index += 1) {
          const displacement = index + 1;
          const expectedBounds = `X ${warmBounds.minX + displacement}–${warmBounds.maxX + displacement} · Y ${warmBounds.minY}–${warmBounds.maxY}`;
          const started = performance.now();
          await ownerPage.keyboard.press("ArrowRight");
          await expect(editorPage.getByLabel("선택 객체 경계")).toHaveText(
            expectedBounds,
            { timeout: 30_000 },
          );
          reflectionSamplesMilliseconds.push(performance.now() - started);
          await inspectCollaborationStatusObservations(
            reflectionStatusObservations,
          );
        }
        await waitUntilSaved(ownerPage);
        for (const page of [ownerPage, editorPage, viewerPage]) {
          await expect(
            page.getByRole("status", { name: "공동 편집 상태: connected" }),
          ).toBeVisible({ timeout: 30_000 });
          await expect(
            page.getByRole("status", { name: "공동 작업 참여자 3명" }),
          ).toBeVisible({ timeout: 30_000 });
        }
        await expect(
          viewerPage.getByRole("status", { name: "공동 편집 상태: connected" }),
        ).toContainText("읽기 전용");
        await inspectCollaborationStatusObservations(
          reflectionStatusObservations,
        );
        expect(
          reflectionStatusObservations.flatMap((observation) =>
            observation.violations.map(
              (violation) => `${observation.name}: ${violation}`,
            ),
          ),
        ).toEqual([]);
        reflectionMeasurementComplete = true;
      } catch (error) {
        hasReflectionPrimaryError = true;
        reflectionPrimaryError = error;
      } finally {
        if (hasReflectionPrimaryError)
          for (const observation of reflectionStatusObservations)
            observation.stopNodeObservation?.();
        else {
          await inspectCollaborationStatusObservations(
            reflectionStatusObservations,
          );
          await stopCollaborationStatusObservations(
            reflectionStatusObservations,
          );
        }
        let p95Milliseconds: number | null = null;
        let p95CalculationError: string | null = null;
        try {
          p95Milliseconds = reflectionSamplesMilliseconds.length
            ? nearestRankPercentile(reflectionSamplesMilliseconds, 0.95)
            : null;
        } catch (error) {
          p95CalculationError =
            error instanceof Error ? error.message : String(error);
        }
        try {
          const reflectionEvidence = {
            authority: "LOCAL_DISPOSABLE_M1_CANONICAL_COLLABORATION",
            browser: reflectionBrowser,
            collaborationObservationFlush: hasReflectionPrimaryError
              ? "SKIPPED_AFTER_PRIMARY_ERROR"
              : "FLUSHED",
            collaborationObservation: reflectionStatusObservations.map(
              ({ name, readOnly, violations }) => ({
                name,
                readOnly,
                violations,
              }),
            ),
            condition: {
              coldWarm:
                "one Owner ArrowRight plus Editor bounds reflection excluded as warm-up; all recorded samples are warm",
              excludedWarmupSamples: 1,
              measurement:
                "Owner ArrowRight dispatch through Editor independently derived selected line-bounds render; excludes tool selection, database polling, save completion, connection, and reload",
              objectMix: { line: 1 },
              warmSamplesExpected: reflectionSampleCount,
            },
            cpu: {
              logicalCount: os.cpus().length,
              model: os.cpus()[0]?.model ?? "unknown",
            },
            memory: reflectionMemory,
            os: { platform: os.platform(), release: os.release() },
            p95CalculationError,
            p95Milliseconds,
            p95Rank: reflectionSamplesMilliseconds.length
              ? Math.ceil(reflectionSamplesMilliseconds.length * 0.95)
              : null,
            rawSamplesMilliseconds: reflectionSamplesMilliseconds,
            sampleCount: reflectionSamplesMilliseconds.length,
            sampleCountExpected: reflectionSampleCount,
            status:
              reflectionMeasurementComplete &&
              reflectionSamplesMilliseconds.length === reflectionSampleCount &&
              reflectionStatusObservations.every(
                (observation) => observation.violations.length === 0,
              ) &&
              p95Milliseconds !== null &&
              p95Milliseconds <= reflectionTargetMilliseconds
                ? "PASS"
                : "NOT MET",
            targetMilliseconds: reflectionTargetMilliseconds,
            viewport: reflectionViewport,
          };
          const reflectionEvidencePath = testInfo.outputPath(
            "m3-canonical-collaboration-reflection.json",
          );
          await writeFile(
            reflectionEvidencePath,
            `${JSON.stringify(reflectionEvidence, null, 2)}\n`,
          );
          await testInfo.attach("m3-canonical-collaboration-reflection", {
            contentType: "application/json",
            path: reflectionEvidencePath,
          });
        } catch (error) {
          if (!hasReflectionPrimaryError) reflectionEvidenceError = error;
        }
      }
      if (hasReflectionPrimaryError) throw reflectionPrimaryError;
      if (reflectionEvidenceError) throw reflectionEvidenceError;
      expect(
        reflectionStatusObservations.flatMap((observation) =>
          observation.violations.map(
            (violation) => `${observation.name}: ${violation}`,
          ),
        ),
      ).toEqual([]);
      expect(reflectionSamplesMilliseconds).toHaveLength(reflectionSampleCount);
      const reflectionP95Milliseconds = nearestRankPercentile(
        reflectionSamplesMilliseconds,
        0.95,
      );
      expect(
        reflectionP95Milliseconds,
        JSON.stringify({
          p95Rank: Math.ceil(reflectionSamplesMilliseconds.length * 0.95),
          rawSamplesMilliseconds: reflectionSamplesMilliseconds,
          targetMilliseconds: reflectionTargetMilliseconds,
        }),
      ).toBeLessThanOrEqual(reflectionTargetMilliseconds);

      await Promise.all([ownerPage.reload(), editorPage.reload()]);
      for (const page of [ownerPage, editorPage, viewerPage]) {
        await expect(
          page.getByRole("status", { name: "공동 편집 상태: connected" }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          page.getByRole("status", { name: "공동 작업 참여자 3명" }),
        ).toBeVisible({ timeout: 30_000 });
      }
      await selectObject(ownerPage, sharedObject.data.id);

      const preOfflineObject = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,name,geometry,version")
        .eq("id", sharedObject.data.id)
        .single();
      if (preOfflineObject.error) throw preOfflineObject.error;
      const preOfflineGeometry = preOfflineObject.data.geometry as {
        end?: { x: number; y: number };
        start?: { x: number; y: number };
        type?: string;
      };
      if (
        preOfflineGeometry.type !== "line" ||
        !preOfflineGeometry.start ||
        !preOfflineGeometry.end
      )
        throw new Error("M3 pre-offline object is not the selected line");
      const expectedOfflineGeometry = {
        end: {
          x: preOfflineGeometry.end.x + 1,
          y: preOfflineGeometry.end.y,
        },
        start: {
          x: preOfflineGeometry.start.x + 1,
          y: preOfflineGeometry.start.y,
        },
        type: "line",
      };
      const expectedOfflineVersion = preOfflineObject.data.version + 1;
      const expectedOfflineForward = {
        type: "update_objects",
        updates: [
          {
            objectId: sharedObject.data.id,
            patch: { geometry: expectedOfflineGeometry },
          },
        ],
      };
      const expectedOfflineBaseVersions = {
        [sharedObject.data.id]: preOfflineObject.data.version,
      };
      const expectedOfflineResultVersions = {
        [sharedObject.data.id]: expectedOfflineVersion,
      };
      await ownerPage.getByRole("tab", { name: "객체" }).click();
      // Send the nudge from the canvas, not the inspector tab's arrow navigation.
      await selectObject(ownerPage, sharedObject.data.id);
      const persistedBefore = await persistedCollaborationState(ownerPage);
      const editorFailuresBeforeReconnect =
        editorEvidence.requestFailures.length;
      await ownerContext.setOffline(true);
      await ownerPage.keyboard.press("ArrowRight");
      await expect(
        ownerPage.getByRole("status", { name: /저장 상태/ }),
      ).toContainText(/오프라인|저장 중/);
      await expect(ownerPage.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-selected-object-name",
        collaborativeName,
      );
      await expect(ownerPage.getByLabel("선택 객체 경계")).toHaveText(
        lineBoundsText(expectedOfflineGeometry),
      );
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
        status: "pending",
      });
      await ownerContext.setOffline(false);
      await waitUntilSaved(ownerPage);
      for (const page of [ownerPage, editorPage]) {
        await expect(
          page.getByRole("status", { name: "공동 편집 상태: connected" }),
        ).toBeVisible({ timeout: 30_000 });
      }
      await selectObject(editorPage, sharedObject.data.id);
      await editorPage.getByRole("tab", { name: "객체" }).click();
      for (const page of [ownerPage, editorPage]) {
        await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
          "data-selected-object-name",
          collaborativeName,
        );
        await expect(page.getByLabel("선택 객체 경계")).toHaveText(
          lineBoundsText(expectedOfflineGeometry),
        );
      }
      expect(
        editorEvidence.requestFailures.slice(editorFailuresBeforeReconnect),
      ).toEqual([]);
      const authoritativeObject = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,name,geometry,version")
        .eq("id", sharedObject.data.id)
        .single();
      if (authoritativeObject.error) throw authoritativeObject.error;
      expect(authoritativeObject.data).toEqual({
        geometry: expectedOfflineGeometry,
        id: sharedObject.data.id,
        name: collaborativeName,
        version: expectedOfflineVersion,
      });
      const operations = await fixture.admin
        .from("lukas_drawing_operations")
        .select(
          "id,client_operation_id,actor_id,revision_id,sequence,base_versions,forward,result_versions",
        )
        .eq("revision_id", revision.id)
        .eq("client_operation_id", offlineRows[0].clientOperationId);
      if (operations.error) throw operations.error;
      expect(operations.data).toHaveLength(1);
      expect(operations.data?.[0]).toMatchObject({
        actor_id: fixture.owner.id,
        revision_id: revision.id,
      });
      expect(operations.data?.[0].base_versions).toEqual(
        expectedOfflineBaseVersions,
      );
      expect(operations.data?.[0].forward).toEqual(expectedOfflineForward);
      expect(operations.data?.[0].result_versions).toEqual(
        expectedOfflineResultVersions,
      );
      await expect
        .poll(async () => {
          const acknowledged = (
            await persistedCollaborationState(ownerPage)
          ).rows.find(
            ({ clientOperationId }) =>
              clientOperationId === offlineRows[0].clientOperationId,
          );
          return acknowledged
            ? {
                authoritativeSequence: acknowledged.authoritativeSequence,
                resultVersions: acknowledged.resultVersions,
                status: acknowledged.status,
              }
            : null;
        })
        .toEqual({
          authoritativeSequence: Number(operations.data?.[0].sequence),
          resultVersions: expectedOfflineResultVersions,
          status: "acked",
        });

      const editorFailuresBeforeOnlineReload =
        editorEvidence.requestFailures.length;
      await Promise.all([ownerPage.reload(), editorPage.reload()]);
      for (const page of [ownerPage, editorPage]) {
        await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
          "data-rendered-object-count",
          "1",
          { timeout: 30_000 },
        );
        await expect(
          page.getByRole("status", { name: "공동 편집 상태: connected" }),
        ).toBeVisible({ timeout: 30_000 });
      }
      expect(
        editorEvidence.requestFailures.slice(editorFailuresBeforeOnlineReload),
      ).toEqual([]);
      const finalObject = await fixture.admin
        .from("lukas_drawing_objects")
        .select("id,name,geometry,version")
        .eq("id", sharedObject.data.id)
        .single();
      if (finalObject.error) throw finalObject.error;
      expect(finalObject.data).toEqual(authoritativeObject.data);
      for (const page of [ownerPage, editorPage]) {
        await selectObject(page, sharedObject.data.id);
        await page.getByRole("tab", { name: "객체" }).click();
        await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
          "data-selected-object-name",
          collaborativeName,
        );
        await expect(page.getByLabel("선택 객체 경계")).toHaveText(
          lineBoundsText(expectedOfflineGeometry),
        );
      }
      const [ownerPersistence, editorPersistence] = await Promise.all([
        persistedCollaborationState(ownerPage),
        persistedCollaborationState(editorPage),
      ]);
      expect(ownerPersistence.databases).toContain(
        `1hk:drawing-draft:v2:${fixture.owner.id}:${revision.id}`,
      );
      expect(editorPersistence.databases).toContain(
        `1hk:drawing-draft:v2:${fixture.editor.id}:${revision.id}`,
      );
      expect(
        ownerPersistence.rows.find(
          ({ clientOperationId }) =>
            clientOperationId === offlineRows[0].clientOperationId,
        ),
      ).toMatchObject({
        authoritativeSequence: Number(operations.data?.[0].sequence),
        resultVersions: expectedOfflineResultVersions,
        status: "acked",
      });
      const operationsAfterReload = await fixture.admin
        .from("lukas_drawing_operations")
        .select(
          "id,client_operation_id,actor_id,revision_id,sequence,base_versions,forward,result_versions",
          { count: "exact" },
        )
        .eq("revision_id", revision.id)
        .eq("client_operation_id", offlineRows[0].clientOperationId);
      if (operationsAfterReload.error) throw operationsAfterReload.error;
      expect(operationsAfterReload.count).toBe(1);
      expect(operationsAfterReload.data).toEqual(operations.data);

      const dragBase = await fixture.admin
        .from("lukas_drawing_objects")
        .select("geometry,version")
        .eq("id", sharedObject.data.id)
        .single();
      const editorOperationsBefore = await fixture.admin
        .from("lukas_drawing_operations")
        .select("id", { count: "exact", head: true })
        .eq("revision_id", revision.id)
        .eq("actor_id", fixture.editor.id);
      if (dragBase.error || editorOperationsBefore.error)
        throw dragBase.error ?? editorOperationsBefore.error;
      const dragPoint = await drawingSurfacePoint(
        editorPage,
        await objectWorldPoint(sharedObject.data.id),
      );
      await editorPage.mouse.move(dragPoint.x, dragPoint.y);
      await editorPage.mouse.down();
      await editorPage.mouse.move(dragPoint.x + 30, dragPoint.y + 20, {
        steps: 6,
      });
      const editorSurface = editorPage.getByLabel(/도면 화면/);
      await expect(editorSurface).toHaveAttribute("data-drag-active", "true");
      await expect(editorSurface).not.toHaveAttribute(
        "data-drag-preview",
        "0,0",
      );
      const dragPointerId = Number(
        await editorSurface.getAttribute("data-drag-pointer-id"),
      );
      expect(dragPointerId).toBeGreaterThanOrEqual(0);
      expect(
        await editorSurface.evaluate(
          (surface, pointerId) => surface.hasPointerCapture(pointerId),
          dragPointerId,
        ),
      ).toBe(true);
      await ownerPage.getByRole("tab", { name: "객체" }).click();
      await expect(
        ownerPage.getByLabel("객체 잠금 상태", { exact: true }),
      ).toContainText(editorDisplayName);

      await ownerPage.getByRole("button", { name: "검토 요청" }).click();
      const freezeStorageKey = `drawing-review-freeze:${revision.id}:${revision.version}`;
      await expect
        .poll(() =>
          ownerPage.evaluate(
            (key) => sessionStorage.getItem(key),
            freezeStorageKey,
          ),
        )
        .toMatch(/^[0-9a-f-]{36}$/);
      const freezeRequestId = await ownerPage.evaluate(
        (key) => sessionStorage.getItem(key),
        freezeStorageKey,
      );
      if (!freezeRequestId)
        throw new Error("M1 canonical review freeze request was not retained");
      await expect
        .poll(
          async () => (await revisionStatus(collaborationWorkspaceId)).status,
        )
        .toBe("review_requested");
      const frozenEditorLineTool = editorPage.getByRole("button", {
        name: "선 도구",
      });
      await expect(frozenEditorLineTool).toBeVisible();
      await expect(frozenEditorLineTool).toBeDisabled();
      await expect(editorSurface).toHaveAttribute("data-drag-active", "false");
      await expect(editorSurface).toHaveAttribute("data-drag-preview", "0,0");
      expect(
        await editorSurface.evaluate(
          (surface, pointerId) => surface.hasPointerCapture(pointerId),
          dragPointerId,
        ),
      ).toBe(false);
      await editorPage.mouse.up();
      const [dragAfter, editorOperationsAfter] = await Promise.all([
        fixture.admin
          .from("lukas_drawing_objects")
          .select("geometry,version")
          .eq("id", sharedObject.data.id)
          .single(),
        fixture.admin
          .from("lukas_drawing_operations")
          .select("id", { count: "exact", head: true })
          .eq("revision_id", revision.id)
          .eq("actor_id", fixture.editor.id),
      ]);
      if (dragAfter.error || editorOperationsAfter.error)
        throw dragAfter.error ?? editorOperationsAfter.error;
      expect(dragAfter.data).toEqual(dragBase.data);
      expect(editorOperationsAfter.count).toBe(editorOperationsBefore.count);

      const reviewerPage = await authenticateContext(
        fixture,
        reviewerContext,
        fixture.reviewer,
        baseUrl,
        path,
      );
      await reviewerPage.getByLabel("검토 의견").fill("M3 canonical 검토 완료");
      await reviewerPage
        .getByRole("button", { name: "도면 검토 완료" })
        .click();
      await expect
        .poll(
          async () => (await revisionStatus(collaborationWorkspaceId)).status,
        )
        .toBe("reviewed");

      const retryForm = {
        freeze_request_id: freezeRequestId,
        intent: "request_review",
        revision_id: revision.id,
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const exactRetry = await ownerContext.request.post(
          `${baseUrl}${path}`,
          { form: retryForm, maxRedirects: 0 },
        );
        expect(exactRetry.status()).toBe(200);
      }
      expect((await revisionStatus(collaborationWorkspaceId)).status).toBe(
        "reviewed",
      );
      const reviewedApprovals = await fixture.admin
        .from("lukas_drawing_revision_approvals")
        .select("id", { count: "exact", head: true })
        .eq("revision_id", revision.id)
        .eq("decision", "reviewed");
      if (reviewedApprovals.error) throw reviewedApprovals.error;
      expect(reviewedApprovals.count).toBe(1);

      const approverPage = await authenticateContext(
        fixture,
        approverContext,
        fixture.approver,
        baseUrl,
        path,
      );
      await approverPage.getByLabel("검토 의견").fill("M3 canonical 최종 승인");
      await approverPage
        .getByRole("button", { name: "도면 최종 승인" })
        .click();
      await expect
        .poll(
          async () => (await revisionStatus(collaborationWorkspaceId)).status,
        )
        .toBe("approved");
      const approvals = await fixture.admin
        .from("lukas_drawing_revision_approvals")
        .select("decision,decided_by")
        .eq("revision_id", revision.id)
        .in("decision", ["reviewed", "approved"])
        .order("created_at");
      if (approvals.error) throw approvals.error;
      expect(approvals.data).toEqual([
        { decision: "reviewed", decided_by: fixture.reviewer.id },
        { decision: "approved", decided_by: fixture.approver.id },
      ]);
      const approvedRetry = await ownerContext.request.post(
        `${baseUrl}${path}`,
        { form: retryForm, maxRedirects: 0 },
      );
      expect(approvedRetry.status()).toBe(200);
      expect((await revisionStatus(collaborationWorkspaceId)).status).toBe(
        "approved",
      );
      const approvalsAfterApprovedRetry = await fixture.admin
        .from("lukas_drawing_revision_approvals")
        .select("decision,decided_by")
        .eq("revision_id", revision.id)
        .in("decision", ["reviewed", "approved"])
        .order("created_at");
      if (approvalsAfterApprovedRetry.error)
        throw approvalsAfterApprovedRetry.error;
      expect(approvalsAfterApprovedRetry.data).toEqual(approvals.data);
      await attachJson(testInfo, "m1-canonical-collaboration-outbox", {
        canonicalUrl: `${baseUrl}${path}`,
        revisionId: revision.id,
        ownerPersistence,
        editorPersistence,
        offlineClientOperationId: offlineRows[0].clientOperationId,
        persistedOperationCount: operations.data?.length,
        finalGeometry: finalObject.data.geometry,
        reviewFreezeRequestId: freezeRequestId,
        reviewStatus: "approved",
      });
    } finally {
      await Promise.all([
        ownerContext.close(),
        editorContext.close(),
        viewerContext.close(),
        reviewerContext.close(),
        approverContext.close(),
      ]);
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
      await expect(
        page.getByRole("region", {
          name: "1HK-test-drawing.pdf PDF 도면",
        }),
      ).toBeVisible();
      await page.goto(
        `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.ifcFileId}`,
      );
      await expect(page.getByText("1HK-test-model.ifc").first()).toBeVisible();
      await expect(
        page.getByRole("img", { name: "IFC 3D 모델 화면" }),
      ).toBeVisible();
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
      await expect(
        page.getByRole("region", { name: "도면 캔버스" }),
      ).toHaveAttribute("data-edit-ready", "true");
      const firstUsableMilliseconds = performance.now() - started;
      const selectedObjectId = performanceFixture.objects[0].id;
      const changedSelectionObjectId = performanceFixture.objects[1].id;
      const selectedObjectName = performanceFixture.objects[0].name;
      const changedSelectionObjectName = performanceFixture.objects[1].name;
      const surface = page.getByLabel(/도면 화면/);
      const stage = surface.locator(".konvajs-content");
      await expect(stage).toBeVisible();
      const selectionWorkspaceLoaderRequests: string[] = [];
      page.on("request", (request) => {
        const requested = new URL(request.url());
        if (
          requested.pathname ===
            `${canonicalPath(fixture.projectId, fixture.blankWorkspace.documentId)}.data` &&
          requested.searchParams.has("object")
        )
          selectionWorkspaceLoaderRequests.push(requested.pathname);
      });
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
      const zoomFrames = await recordInteractionFrames(
        page,
        "wheel",
        async () => {
          await page.mouse.move(stageCenter.x, stageCenter.y);
          await page.mouse.wheel(0, -240);
        },
      );
      await expect
        .poll(async () => (await drawingSurfaceState(surface)).zoom)
        .not.toBe(zoomBefore.zoom);
      const zoomAfter = await drawingSurfaceState(surface);
      await page.getByRole("button", { name: "이동 도구" }).click();
      const panBefore = await drawingSurfaceState(surface);
      const panFrames = await recordInteractionFrames(
        page,
        "pointerdown",
        async () => {
          await page.mouse.move(stageCenter.x, stageCenter.y);
          await page.mouse.down();
          await page.mouse.move(stageCenter.x + 80, stageCenter.y + 40, {
            steps: 8,
          });
          await page.mouse.up();
        },
      );
      await expect
        .poll(async () => {
          const current = await drawingSurfaceState(surface);
          return `${current.x},${current.y}`;
        })
        .not.toBe(`${panBefore.x},${panBefore.y}`);
      const panAfter = await drawingSurfaceState(surface);
      await page.getByRole("button", { name: "화면 맞춤" }).click();
      await expect
        .poll(async () => {
          const current = await drawingSurfaceState(surface);
          return `${current.x},${current.y},${current.zoom}`;
        })
        .not.toBe(`${panAfter.x},${panAfter.y},${panAfter.zoom}`);
      await page.getByRole("button", { name: "선택 도구" }).click();
      const changedSelectionPoint = await drawingSurfacePoint(
        page,
        await objectWorldPoint(changedSelectionObjectId),
      );
      const selectionBefore = await drawingSurfaceState(surface);
      const selectionFrames = await recordInteractionFrames(
        page,
        "pointerdown",
        () =>
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
      expect(selectionWorkspaceLoaderRequests).toEqual([]);
      const interactionFrameTimesMilliseconds = {
        zoom: zoomFrames,
        pan: panFrames,
        selection: selectionFrames,
      };
      const performanceTargets = {
        maxP95Milliseconds: 16.7,
        minFramesPerSecond: 60,
      };
      const performanceSummary = summarizeInteractionFrameTimes(
        interactionFrameTimesMilliseconds,
        performanceTargets,
      );
      const frameTimes = Object.values(
        interactionFrameTimesMilliseconds,
      ).flat();
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
            "fit the drawing before selecting a known visible object",
            "select second object",
          ],
          workspaceLoaderRequestCount: selectionWorkspaceLoaderRequests.length,
        },
        sampleCount: performanceSummary.sampleCount,
        interactionPerformance: performanceSummary.interactions,
        interactionFrameTimesMilliseconds,
        frameTimesMilliseconds: frameTimes,
        p50FrameMilliseconds: performanceSummary.p50FrameMilliseconds,
        p95FrameMilliseconds: performanceSummary.p95FrameMilliseconds,
        calculatedFps: performanceSummary.calculatedFps,
        firstUsableMilliseconds,
        targets: {
          firstUsableMilliseconds: 2500,
          p95FrameMilliseconds: 16.7,
          fps: 60,
        },
        status:
          firstUsableMilliseconds <= 2500 &&
          performanceSummary.status === "PASS"
            ? "PASS"
            : "NOT MET",
      };
      const evidencePath = testInfo.outputPath(
        "m1-canonical-10k-performance-raw.json",
      );
      await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
      await testInfo.attach("m1-canonical-10k-performance-raw", {
        path: evidencePath,
        contentType: "application/json",
      });
      expect(firstUsableMilliseconds).toBeLessThanOrEqual(2_500);
      for (const metric of Object.values(performanceSummary.interactions)) {
        expect(metric.p95FrameMilliseconds).toBeLessThanOrEqual(
          performanceTargets.maxP95Milliseconds,
        );
        expect(metric.calculatedFps).toBeGreaterThanOrEqual(
          performanceTargets.minFramesPerSecond,
        );
      }
    } finally {
      await context.close();
    }
  });

  test("IFC and DXF source deep links create canonical workspaces while Viewer keeps read-only file access", async ({
    browser,
  }) => {
    for (const source of [
      {
        fileId: fixture.ifcFileId,
        button: "1HK-test-model.ifc IFC로 시작",
        destination: /\/workspaces\/[0-9a-f-]{36}\?ifc=[0-9a-f-]{36}&view=3d$/,
        verify: async (page: Page) =>
          expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(
            1,
            {
              timeout: 60_000,
            },
          ),
      },
      {
        fileId: fixture.dxfFileId,
        button: "1HK-m4-canonical-line.dxf DXF로 시작",
        destination:
          /\/workspaces\/[0-9a-f-]{36}\?dxfSourceFileId=[0-9a-f-]{36}$/,
        verify: async (page: Page) => {
          const source = page.getByLabel("가져올 DXF 원본");
          await expect(source).toContainText("1HK-m4-canonical-line.dxf");
          await expect(source).toHaveValue(fixture.dxfFileId);
        },
      },
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
      });
      try {
        const page = await authenticateContext(
          fixture,
          context,
          fixture.editor,
          baseUrl,
          `/projects/${fixture.projectId}/workspaces/new?sourceFileId=${source.fileId}`,
        );
        const start = page.getByRole("button", {
          name: source.button,
          exact: true,
        });
        await expect(start).toBeVisible();
        await expect(
          start.locator("xpath=ancestor::form").getByLabel("작업실 이름"),
        ).toBeFocused();
        await start.click();
        await expect(page).toHaveURL(source.destination);
        await source.verify(page);
      } finally {
        await context.close();
      }
    }
    const viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    try {
      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        `/projects/${fixture.projectId}/files`,
      );
      await expect(
        viewerPage.getByRole("heading", { name: /프로젝트 파일/ }),
      ).toBeVisible();
      await expect(
        viewerPage.getByRole("cell", {
          name: "1HK-test-model.ifc",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        viewerPage.getByRole("heading", { name: "파일 추가" }),
      ).toHaveCount(0);
      await expect(viewerPage.locator('input[name="source_file"]')).toHaveCount(
        0,
      );
    } finally {
      await viewerContext.close();
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
      pdfFailure?: { currentMounted: string | null; message: string };
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
        for (const heading of ["빈 작업실", "템플릿으로 시작", "원본으로 시작"])
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
          page.getByRole("link", {
            name: "1HK-test-drawing.pdf 작업실 열기",
          }),
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
          if (card === "source-workspace-title") break;
          await page.keyboard.press("Tab");
        }
        expect(focusOrder.slice(0, 3)).toEqual([
          "blank-workspace-title",
          "starter-workspace-title",
          "source-workspace-title",
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
        await expect(canvas).toBeVisible();
        await expect(bottomTools).toBeVisible();
        await expect(selectTool).toBeVisible();
        expect(await containedWithin(bottomTools, canvas)).toBe(true);
        if (viewport.width === 1024) {
          await expect(inspector).toBeVisible();
          await expect(resultRail).toBeVisible();
          await expect(leftRail).toBeHidden();
          expect(await noOverlap(canvas, inspector)).toBe(true);
          expect(await noOverlap(bottomTools, inspector)).toBe(true);
          await page
            .getByRole("button", { name: "왼쪽 도구 패널 열기" })
            .click();
          await expect(leftRail).toBeVisible();
          await expect(inspector).toBeHidden();
          await expect(resultRail).toBeHidden();
          expect(await noOverlap(leftRail, canvas)).toBe(true);
          await page.getByRole("button", { name: "속성 검사기 열기" }).click();
          await expect(inspector).toBeVisible();
          await expect(resultRail).toBeVisible();
          await expect(leftRail).toBeHidden();
          await page.getByRole("tab", { name: "객체" }).click();
          await expect(page.getByRole("tab", { name: "객체" })).toHaveAttribute(
            "aria-selected",
            "true",
          );
          await page.getByRole("tab", { name: "결과" }).click();
        } else {
          await expect(leftRail).toBeVisible();
          await expect(inspector).toBeVisible();
          await expect(resultRail).toBeVisible();
          expect(await noOverlap(leftRail, canvas)).toBe(true);
          expect(await noOverlap(canvas, inspector)).toBe(true);
          expect(await noOverlap(leftRail, inspector)).toBe(true);
          expect(await noOverlap(bottomTools, inspector)).toBe(true);
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
            leftRail: await visibleBoundingBox(leftRail),
            canvas: await visibleBoundingBox(canvas),
            inspector: await visibleBoundingBox(inspector),
            bottomTools: await visibleBoundingBox(bottomTools),
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
        await expect(surface).toBeVisible();
        await expect.poll(() => pdfSignRequestAborted).toBe(true);
        await expect(surface).toHaveAttribute(
          "data-pdf-current-mounted",
          "false",
        );
        const pdfStatus = surface.getByRole("status");
        let pdfFailureMessage = "";
        await expect
          .poll(async () => {
            pdfFailureMessage = (await pdfStatus.textContent())?.trim() ?? "";
            return (
              pdfFailureMessage !== "" &&
              pdfFailureMessage !== "PDF 배경을 준비하는 중입니다." &&
              pdfFailureMessage !== "빈 도면 배경을 표시하고 있습니다."
            );
          })
          .toBe(true);
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
          pdfFailure: {
            currentMounted: await surface.getAttribute(
              "data-pdf-current-mounted",
            ),
            message: pdfFailureMessage,
          },
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

  test("native examples clone without upload, keep A3 output and import editable symbols without granting Viewer writes", async ({
    browser,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const reviewerContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const approverContext = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    });
    const evidence = trackContextEvidence(context);
    const viewerEvidence = trackContextEvidence(viewerContext);
    const reviewerEvidence = trackContextEvidence(reviewerContext);
    const approverEvidence = trackContextEvidence(approverContext);
    const examples = [
      { key: "measured-plan", name: "치수 평면 예제", objects: 9 },
      { key: "office-layout", name: "사무실 배치 예제", objects: 3 },
      { key: "remodel-phases", name: "리모델링 단계 예제", objects: 7 },
      { key: "finishes-takeoff", name: "마감 수량 예제", objects: 3 },
    ];
    const imported: Array<{
      key: string;
      documentId: string;
      revisionId: string;
      request: Record<string, string>;
      objectIds: string[];
    }> = [];
    try {
      const sourceBefore = await readSourceEvidence(fixture);
      const page = await authenticateContext(
        fixture,
        context,
        fixture.editor,
        baseUrl,
        "/workspace",
      );
      await page
        .locator("summary")
        .filter({ hasText: /^\s*새 도면\s*$/ })
        .click();
      await page
        .getByRole("button", { name: "템플릿에서 시작", exact: true })
        .click();
      await expect(page).toHaveURL(
        /\/projects\/[0-9a-f-]{36}\/workspaces\/new#starter-workspace-title$/,
      );
      // The quick entry requires neither an upload nor a project-details form.
      await expect(page.getByLabel("프로젝트명", { exact: true })).toHaveCount(
        0,
      );
      for (const example of examples)
        await expect(
          page.getByRole("img", {
            name: `${example.name} 미리보기`,
            exact: true,
          }),
        ).toBeVisible();
      await expect
        .poll(() =>
          page
            .getByRole("region", { name: "예제 도면으로 시작", exact: true })
            .locator("img")
            .evaluateAll(
              (images) =>
                images.filter(
                  (image) =>
                    (image as HTMLImageElement).complete &&
                    (image as HTMLImageElement).naturalWidth > 0,
                ).length,
            ),
        )
        .toBe(4);
      const startScreenshot = testInfo.outputPath("native-start-cards.png");
      await page
        .getByRole("region", { name: "예제 도면으로 시작", exact: true })
        .screenshot({ path: startScreenshot });
      await testInfo.attach("native-start-cards", {
        path: startScreenshot,
        contentType: "image/png",
      });

      // Use the shared project for subsequent Viewer checks; the same start
      // screen was reached above through the no-project-input personal entry.
      const startPath = `${baseUrl}/projects/${fixture.projectId}/workspaces/new`;
      for (const example of examples) {
        await page.goto(startPath);
        const preview = page.getByRole("img", {
          name: `${example.name} 미리보기`,
          exact: true,
        });
        await expect(preview).toBeVisible();
        const previewUrl = await preview.getAttribute("src");
        expect(previewUrl).toBeTruthy();
        const previewResponse = await context.request.get(
          new URL(previewUrl!, baseUrl).toString(),
        );
        expect(previewResponse.ok()).toBe(true);
        expect(previewResponse.headers()["content-type"]).toContain(
          "image/svg+xml",
        );
        const svg = await previewResponse.text();
        expect(svg).toContain('width="420mm"');
        expect(svg).toContain('height="297mm"');
        expect(svg).toContain('viewBox="0 0 21000 14850"');
        const form = page
          .locator("form")
          .filter({
            has: page.locator(
              `input[name="nativeKey"][value="${example.key}"]`,
            ),
          });
        const button = form.getByRole("button", {
          name: "이 도면으로 시작",
          exact: true,
        });
        const request = await formValues(button);
        expect(Object.keys(request).sort()).toEqual([
          "clientRequestId",
          "intent",
          "nativeKey",
          "nativeVersion",
        ]);
        expect(request.intent).toBe("create_native_template");
        await button.click();
        await expect(page).toHaveURL(
          new RegExp(
            `/projects/${fixture.projectId}/workspaces/[0-9a-f-]{36}$`,
          ),
        );
        await waitUntilSaved(page);
        const documentId = new URL(page.url()).pathname.split("/").at(-1)!;
        const revision = await fixture.admin
          .from("lukas_drawing_revisions")
          .select("id,status")
          .eq("document_id", documentId)
          .single();
        if (revision.error) throw revision.error;
        expect(revision.data.status).toBe("draft");
        const revisionId = revision.data.id;
        const canvases = await fixture.admin
          .from("lukas_drawing_canvases")
          .select("width_mm,height_mm,output_profile,background_source_file_id")
          .eq("revision_id", revisionId);
        if (canvases.error) throw canvases.error;
        expect(canvases.data).toEqual([
          {
            width_mm: 21000,
            height_mm: 14850,
            background_source_file_id: null,
            output_profile: {
              paper: "A3",
              orientation: "landscape",
              widthMillimeters: 420,
              heightMillimeters: 297,
              scaleDenominator: 50,
            },
          },
        ]);
        const objects = await fixture.admin
          .from("lukas_drawing_objects")
          .select("id,object_type,geometry")
          .eq("revision_id", revisionId)
          .eq("status", "active");
        if (objects.error) throw objects.error;
        expect(objects.data).toHaveLength(example.objects);
        const objectIds = objects.data.map((object) => object.id);
        for (const opening of objects.data.filter(
          (object) => object.object_type === "opening",
        ))
          expect(
            objects.data.find((wall) => wall.id === opening.geometry.hostWallId)
              ?.object_type,
          ).toBe("wall");
        const receipt = await fixture.admin
          .from("lukas_drawing_library_imports")
          .select("target_document_id,target_revision_id,client_request_id")
          .eq("target_document_id", documentId);
        if (receipt.error) throw receipt.error;
        expect(receipt.data).toEqual([
          {
            target_document_id: documentId,
            target_revision_id: revisionId,
            client_request_id: request.clientRequestId,
          },
        ]);
        const replay = await context.request.post(startPath, {
          form: request,
          maxRedirects: 0,
        });
        expect(replay.status()).toBe(302);
        expect(replay.headers().location).toBe(
          canonicalPath(fixture.projectId, documentId),
        );
        await page.reload();
        await waitUntilSaved(page);
        await expect(
          page.getByRole("button", { name: "내보내기", exact: true }),
        ).toBeEnabled();
        await page
          .getByRole("button", { name: "화면 맞춤", exact: true })
          .click();
        const screenshot = testInfo.outputPath(`native-${example.key}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(`native-${example.key}`, {
          path: screenshot,
          contentType: "image/png",
        });
        imported.push({
          key: example.key,
          documentId,
          revisionId,
          request,
          objectIds,
        });
      }
      const allObjectIds = imported.flatMap((item) => item.objectIds);
      expect(new Set(allObjectIds).size).toBe(allObjectIds.length);

      const measured = imported[0];
      const measurementPath = `${canonicalPath(fixture.projectId, measured.documentId)}/measurement-evidence`;
      const nativeMeasurementRequests: Array<{ actor: string; url: string }> = [];
      for (const [actor, actorContext] of [
        ["editor", context],
        ["viewer", viewerContext],
      ] as const) {
        actorContext.on("request", (request) => {
          if (new URL(request.url()).pathname === measurementPath)
            nativeMeasurementRequests.push({ actor, url: request.url() });
        });
      }
      const viewerPage = await authenticateContext(
        fixture,
        viewerContext,
        fixture.viewer,
        baseUrl,
        canonicalPath(fixture.projectId, measured.documentId),
      );
      await viewerPage
        .getByRole("radio", { name: "작성", exact: true })
        .click();
      await viewerPage.getByRole("tab", { name: "블록", exact: true }).click();
      await expect(
        viewerPage
          .getByRole("list", { name: "도면 블록", exact: true })
          .getByText("Single door 800 mm", { exact: true }),
      ).toHaveCount(0);
      await page.goto(
        `${baseUrl}${canonicalPath(fixture.projectId, measured.documentId)}`,
      );
      await waitUntilSaved(page);
      await page.getByRole("button", { name: "내보내기", exact: true }).click();
      const draftExportDialog = page.getByRole("dialog", {
        name: "도면 내보내기",
      });
      await expect(draftExportDialog.getByRole("status")).toContainText(
        "승인된 개정만 내보낼 수 있습니다",
      );
      await expect(
        draftExportDialog.getByRole("button", {
          name: "다운로드",
          exact: true,
        }),
      ).toBeDisabled();
      await draftExportDialog
        .getByRole("button", { name: "닫기", exact: true })
        .click();
      await page.getByRole("radio", { name: "작성", exact: true }).click();
      await page.getByRole("tab", { name: "블록", exact: true }).click();
      await page
        .getByRole("searchbox", { name: "기본 심볼 검색", exact: true })
        .fill("door-single-800");
      const symbol = page
        .locator("li")
        .filter({ hasText: "Single door 800 mm" })
        .filter({
          has: page.getByRole("button", { name: "블록에 추가", exact: true }),
        });
      await expect(symbol).toHaveCount(1);
      const [nativeImportResponse] = await Promise.all([
        page.waitForResponse(
          (response) => {
            const url = new URL(response.url());
            return (
              response.request().method() === "POST" &&
              url.pathname ===
                `${canonicalPath(fixture.projectId, measured.documentId)}/operation` &&
              url.searchParams.get("revision") === measured.revisionId &&
              response.request().postData()?.includes("import_native_symbol") ===
                true
            );
          },
          { timeout: 15_000 },
        ),
        symbol
          .getByRole("button", { name: "블록에 추가", exact: true })
          .click(),
      ]);
      expect(nativeImportResponse.status()).toBe(200);
      const nativeOperationUrl = nativeImportResponse.url();
      const nativeOperationRequest = nativeImportResponse.request();
      const nativeOperationBody = nativeOperationRequest.postDataBuffer();
      const nativeOperationContentType =
        nativeOperationRequest.headers()["content-type"];
      expect(nativeOperationBody).not.toBeNull();
      expect(nativeOperationContentType).toContain("multipart/form-data");
      const nativeImportResult = await nativeImportResponse.json();
      const currentBlock = page
        .locator("li")
        .filter({ has: page.locator('input[value="Single door 800 mm"]') });
      await expect(currentBlock).toHaveCount(1);
      await currentBlock
        .getByRole("button", { name: "인스턴스 삽입", exact: true })
        .click();
      await waitUntilSaved(page);
      const block = await fixture.admin
        .from("lukas_drawing_blocks")
        .select("id")
        .eq("revision_id", measured.revisionId)
        .eq("name", "Single door 800 mm")
        .single();
      if (block.error) throw block.error;
      const nativeReceipt = await fixture.admin
        .from("lukas_drawing_library_imports")
        .select(
          "id,target_entity_id,target_revision_id,source_content_sha256,imported_by,client_request_id,request_sha256",
        )
        .eq("project_id", fixture.projectId)
        .eq("revision_id", measured.revisionId)
        .eq("target_entity_id", block.data.id)
        .single();
      if (nativeReceipt.error) throw nativeReceipt.error;
      expect(nativeImportResult).toEqual({
        ok: true,
        kind: "native_symbol_import",
        error: null,
        result: {
          importId: nativeReceipt.data.id,
          targetEntityId: block.data.id,
          revisionId: measured.revisionId,
          contentSha256: nativeReceipt.data.source_content_sha256,
        },
      });
      expect(nativeReceipt.data.imported_by).toBe(fixture.editor.id);
      expect(nativeOperationBody!.toString("utf8")).toContain(
        nativeReceipt.data.client_request_id,
      );
      expect(nativeOperationBody!.toString("utf8")).toContain(
        "door-single-800",
      );
      await expect
        .poll(async () => {
          const instances = await fixture.admin
            .from("lukas_drawing_block_instances")
            .select("id", { count: "exact", head: true })
            .eq("revision_id", measured.revisionId)
            .eq("block_id", block.data.id);
          if (instances.error) throw instances.error;
          return instances.count;
        })
        .toBe(1);
      // The existing insert command starts at the world origin. Place the
      // example inside its paper before approval, using the real inspector.
      await currentBlock.getByRole("button", {
        name: /^Single door 800 mm 인스턴스 1개 보기/,
      }).click();
      await currentBlock.getByRole("button", {
        name: /인스턴스 선택$/,
      }).click();
      await page.getByLabel("원점 X", { exact: true }).fill("3000");
      await page.getByLabel("원점 Y", { exact: true }).fill("9000");
      await page.getByRole("button", {
        name: "인스턴스 저장", exact: true,
      }).click();
      await waitUntilSaved(page);
      await expect.poll(async () => {
        const instance = await fixture.admin
          .from("lukas_drawing_block_instances")
          .select("origin,version")
          .eq("revision_id", measured.revisionId)
          .eq("block_id", block.data.id)
          .single();
        if (instance.error) throw instance.error;
        return instance.data;
      }).toEqual({ origin: { x: 3000, y: 9000 }, version: 2 });
      const readNativePersistenceState = async () => {
        const [operations, blocks, instances, receipts, receipt, placedInstance] =
          await Promise.all([
            fixture.admin
              .from("lukas_drawing_operations")
              .select("id", { count: "exact", head: true })
              .eq("revision_id", measured.revisionId),
            fixture.admin
              .from("lukas_drawing_blocks")
              .select("id", { count: "exact", head: true })
              .eq("revision_id", measured.revisionId),
            fixture.admin
              .from("lukas_drawing_block_instances")
              .select("id", { count: "exact", head: true })
              .eq("revision_id", measured.revisionId),
            fixture.admin
              .from("lukas_drawing_library_imports")
              .select("id", { count: "exact", head: true })
              .eq("revision_id", measured.revisionId),
            fixture.admin
              .from("lukas_drawing_library_imports")
              .select(
                "id,target_entity_id,target_revision_id,source_content_sha256,imported_by,client_request_id,request_sha256",
              )
              .eq("id", nativeReceipt.data.id)
              .single(),
            fixture.admin
              .from("lukas_drawing_block_instances")
              .select("id,origin,version")
              .eq("revision_id", measured.revisionId)
              .eq("block_id", block.data.id)
              .single(),
          ]);
        const failure = [operations, blocks, instances, receipts, receipt, placedInstance].find(
          ({ error }) => error,
        )?.error;
        if (failure) throw failure;
        return {
          operationCount: operations.count,
          blockCount: blocks.count,
          blockInstanceCount: instances.count,
          receiptCount: receipts.count,
          receipt: receipt.data,
          placedInstance: placedInstance.data,
        };
      };
      const nativePersistenceAfterImport = await readNativePersistenceState();
      // This context was already connected before import: a reload-only local
      // fix cannot satisfy the shared definition plus instance assertion.
      await expect(
        viewerPage
          .getByRole("list", { name: "도면 블록", exact: true })
          .getByText("Single door 800 mm", { exact: true }),
      ).toBeVisible();
      await expect(
        viewerPage.getByRole("button", {
          name: /^Single door 800 mm 인스턴스 1개 보기/,
        }),
      ).toBeVisible();
      await expect(
        viewerPage.getByRole("button", { name: "블록에 추가", exact: true }),
      ).toHaveCount(0);
      await viewerPage
        .getByRole("button", { name: "화면 맞춤", exact: true })
        .click();
      const viewerScreenshot = testInfo.outputPath(
        "native-viewer-live-symbol.png",
      );
      await viewerPage.screenshot({ path: viewerScreenshot });
      await testInfo.attach("native-viewer-live-symbol", {
        path: viewerScreenshot,
        contentType: "image/png",
      });
      await page.reload();
      await waitUntilSaved(page);

      // Neither the block panel nor a block-instance inspector consumes
      // semantic measurement evidence. Do not race stale loader checkpoints
      // while inserting/moving a symbol; fetch when the actual consumer opens.
      expect(nativeMeasurementRequests).toEqual([]);
      const [measurementResponse] = await Promise.all([
        page.waitForResponse((response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname === measurementPath,
        ),
        page.getByRole("radio", { name: "수량·금액", exact: true }).click(),
      ]);
      expect(measurementResponse.status()).toBe(200);
      const measurementQuery = new URL(measurementResponse.url()).searchParams;
      expect(Object.fromEntries(measurementQuery)).toEqual({
        revision: measured.revisionId,
        version: "1",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        operation: "3",
      });
      const measurementResource = await measurementResponse.json();
      expect(measurementResource.measurementEvidenceError).toBeNull();
      const measurementCheckpoint = {
        documentId: measured.documentId,
        revisionId: measured.revisionId,
        revisionVersion: 1,
        snapshotSha256: measurementQuery.get("sha256"),
        operationCheckpoint: 3,
        ruleVersion: "P4_MEASUREMENT_V1",
      };
      expect(measurementResource.measurementEvidence).toMatchObject(
        measurementCheckpoint,
      );
      const measurementPanel = page.locator(
        '[aria-labelledby="drawing-semantic-schedules-title"]',
      );
      for (const [attribute, value] of Object.entries({
        "data-drawing-server-evidence": "confirmed",
        "data-drawing-server-evidence-document-id": measured.documentId,
        "data-drawing-server-evidence-revision-id": measured.revisionId,
        "data-drawing-server-evidence-revision-version": "1",
        "data-drawing-server-evidence-operation-checkpoint": "3",
        "data-drawing-server-evidence-snapshot-sha256": measurementQuery.get("sha256")!,
      })) await expect(measurementPanel).toHaveAttribute(attribute, value);
      await expect(page.getByRole("table", {
        name: "Room schedule · 서버 증거", exact: true,
      })).toContainText("예제실 24㎡");
      await expect(measurementPanel.getByRole("alert")).toHaveCount(0);
      await page.getByRole("radio", { name: "작성", exact: true }).click();

      const viewerClone = await viewerContext.request.post(startPath, {
        form: { ...measured.request, clientRequestId: randomUUID() },
        maxRedirects: 0,
      });
      expect(viewerClone.status()).toBe(400);
      await expect(
        viewerPage.getByRole("status", { name: "공동 편집 상태: connected" }),
      ).toContainText("읽기 전용");
      expect(viewerEvidence.pageErrors).toEqual([]);
      expect(viewerEvidence.consoleErrors).toEqual([]);
      expect(viewerEvidence.requestFailures).toEqual([]);
      expect(viewerEvidence.responseErrors).toEqual([]);

      // Audited exports require the existing independent review and approval
      // workflow. Finish editable-symbol checks before freezing this revision.
      const [reviewRequestResponse] = await Promise.all([
        page.waitForResponse(
          (response) =>
            response.request().method() === "POST" &&
            new URL(response.url()).pathname ===
              `${canonicalPath(fixture.projectId, measured.documentId)}.data`,
          { timeout: 15_000 },
        ),
        page.getByRole("button", { name: "검토 요청", exact: true }).click(),
      ]);
      if (reviewRequestResponse.status() >= 400) {
        const failure = {
          status: reviewRequestResponse.status(),
          body: await reviewRequestResponse.text(),
          revision: await revisionStatus(measured.documentId),
          browser: snapshotEvidence(evidence),
        };
        await attachJson(testInfo, "native-review-request-failure", failure);
        throw new Error(`Native collaborative review failed: ${failure.body}`);
      }
      await expect
        .poll(async () => (await revisionStatus(measured.documentId)).status)
        .toBe("review_requested");
      const reviewRequestedReplay = await context.request.fetch(
        nativeOperationUrl,
        {
          method: "POST",
          headers: { "content-type": nativeOperationContentType! },
          data: nativeOperationBody!,
          maxRedirects: 0,
        },
      );
      expect(reviewRequestedReplay.status()).toBe(200);
      expect(await reviewRequestedReplay.json()).toEqual(nativeImportResult);
      const nativePersistenceAfterReviewReplay =
        await readNativePersistenceState();
      expect(nativePersistenceAfterReviewReplay).toEqual(
        nativePersistenceAfterImport,
      );
      const reviewerPage = await authenticateContext(
        fixture,
        reviewerContext,
        fixture.reviewer,
        baseUrl,
        canonicalPath(fixture.projectId, measured.documentId),
      );
      await reviewerPage
        .getByLabel("검토 의견")
        .fill("기본 도면 예제와 추가 심볼 독립 검토 완료");
      await reviewerPage
        .getByRole("button", { name: "도면 검토 완료", exact: true })
        .click();
      await expect
        .poll(async () => (await revisionStatus(measured.documentId)).status)
        .toBe("reviewed");
      const approverPage = await authenticateContext(
        fixture,
        approverContext,
        fixture.approver,
        baseUrl,
        canonicalPath(fixture.projectId, measured.documentId),
      );
      await approverPage
        .getByLabel("검토 의견")
        .fill("기본 도면 A3 출력 검증을 위한 독립 최종 승인");
      await approverPage
        .getByRole("button", { name: "도면 최종 승인", exact: true })
        .click();
      await expect
        .poll(async () => (await revisionStatus(measured.documentId)).status)
        .toBe("approved");
      const approvals = await fixture.admin
        .from("lukas_drawing_revision_approvals")
        .select("decision,decided_by,snapshot_sha256,subject_version")
        .eq("revision_id", measured.revisionId)
        .in("decision", ["reviewed", "approved"])
        .order("created_at");
      if (approvals.error) throw approvals.error;
      expect(
        approvals.data?.map(({ decision, decided_by }) => ({
          decision,
          decided_by,
        })),
      ).toEqual([
        { decision: "reviewed", decided_by: fixture.reviewer.id },
        { decision: "approved", decided_by: fixture.approver.id },
      ]);
      const approval = await approvedSnapshot(measured.revisionId);
      expect(approval.decided_by).toBe(fixture.approver.id);
      const snapshot = await fixture.admin
        .from("lukas_drawing_snapshots")
        .select("sha256,operation_sequence")
        .eq("revision_id", measured.revisionId)
        .eq("revision_version", approval.subject_version)
        .eq("sha256", approval.snapshot_sha256)
        .single();
      if (snapshot.error) throw snapshot.error;
      expect(snapshot.data).toEqual({
        sha256: measurementCheckpoint.snapshotSha256,
        operation_sequence: measurementCheckpoint.operationCheckpoint,
      });

      await page.reload();
      await page.getByRole("radio", { name: "작성", exact: true }).click();
      await page.getByRole("tab", { name: "블록", exact: true }).click();
      await page
        .getByRole("searchbox", { name: "기본 심볼 검색", exact: true })
        .fill("door-single-800");
      await expect(
        page
          .locator("li")
          .filter({ hasText: "Single door 800 mm" })
          .getByRole("button", { name: "블록에 추가", exact: true }),
      ).toBeDisabled();

      const nativePersistenceAtApproval = await readNativePersistenceState();
      expect(nativePersistenceAtApproval).toEqual(nativePersistenceAfterImport);
      const approvedReplay = await context.request.fetch(nativeOperationUrl, {
        method: "POST",
        headers: { "content-type": nativeOperationContentType! },
        data: nativeOperationBody!,
        maxRedirects: 0,
      });
      expect(approvedReplay.status()).toBe(200);
      expect(await approvedReplay.json()).toEqual(nativeImportResult);
      const changedRequest = await context.request.post(nativeOperationUrl, {
        form: {
          intent: "import_native_symbol",
          key: "window-600",
          version: "1",
          revisionId: measured.revisionId,
          clientRequestId: nativeReceipt.data.client_request_id,
        },
        maxRedirects: 0,
      });
      expect(changedRequest.status()).toBe(409);
      const approvedNewRequestId = randomUUID();
      const approvedNewRequest = await context.request.post(
        nativeOperationUrl,
        {
          form: {
            intent: "import_native_symbol",
            key: "window-600",
            version: "1",
            revisionId: measured.revisionId,
            clientRequestId: approvedNewRequestId,
          },
          maxRedirects: 0,
        },
      );
      expect(approvedNewRequest.status()).toBe(409);
      const denied = await viewerContext.request.fetch(nativeOperationUrl, {
        method: "POST",
        headers: { "content-type": nativeOperationContentType! },
        data: nativeOperationBody!,
        maxRedirects: 0,
      });
      expect(denied.status()).toBe(403);
      const nativePersistenceAfterRequests = await readNativePersistenceState();
      expect(nativePersistenceAfterRequests).toEqual(
        nativePersistenceAtApproval,
      );
      const finalApproval = await approvedSnapshot(measured.revisionId);
      expect(finalApproval).toEqual(approval);
      const finalSnapshot = await fixture.admin
        .from("lukas_drawing_snapshots")
        .select("sha256,operation_sequence")
        .eq("revision_id", measured.revisionId)
        .eq("revision_version", approval.subject_version)
        .eq("sha256", approval.snapshot_sha256)
        .single();
      if (finalSnapshot.error) throw finalSnapshot.error;
      expect(finalSnapshot.data).toEqual(snapshot.data);
      const liveEvidencePath = testInfo.outputPath(
        "native-viewer-live-evidence.json",
      );
      await writeFile(
        liveEvidencePath,
        `${JSON.stringify(
          {
            blockId: block.data.id,
            connectedBeforeImport: true,
            viewerCloneStatus: viewerClone.status(),
            viewerImportStatus: denied.status(),
            evidence: snapshotEvidence(viewerEvidence),
          },
          null,
          2,
        )}\n`,
      );
      await testInfo.attach("native-viewer-live-evidence", {
        path: liveEvidencePath,
        contentType: "application/json",
      });

      await approverPage.reload();
      await approverPage
        .getByRole("button", { name: "화면 맞춤", exact: true })
        .click();
      const approvedScreenshot = testInfo.outputPath(
        "native-measured-plan-approved.png",
      );
      await approverPage.screenshot({ path: approvedScreenshot });
      await testInfo.attach("native-measured-plan-approved", {
        path: approvedScreenshot,
        contentType: "image/png",
      });
      await approverPage
        .getByRole("button", { name: "내보내기", exact: true })
        .click();
      const dialog = approverPage.getByRole("dialog", {
        name: "도면 내보내기",
      });
      await dialog.getByRole("radio", { name: "PDF", exact: true }).check();
      const exportOutcome = Promise.race([
        approverPage
          .waitForEvent("download", { timeout: 45_000 })
          .then((download) => ({ kind: "download" as const, download })),
        approverPage
          .waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              new URL(response.url()).pathname ===
                `${canonicalPath(fixture.projectId, measured.documentId)}/export` &&
              response.status() >= 400,
            { timeout: 45_000 },
          )
          .then(async (response) => ({
            kind: "response" as const,
            status: response.status(),
            body: await response.text(),
          })),
        dialog
          .getByRole("alert")
          .waitFor({ state: "visible", timeout: 45_000 })
          .then(async () => ({
            kind: "alert" as const,
            message: await dialog.getByRole("alert").innerText(),
          })),
      ]);
      const [outcome] = await Promise.all([
        exportOutcome,
        dialog.getByRole("button", { name: "다운로드", exact: true }).click(),
      ]).catch(async (error) => {
        await attachJson(testInfo, "native-approved-pdf-export-wait-failure", {
          error: String(error),
          alerts: await dialog.getByRole("alert").allTextContents(),
          approval,
          snapshot: snapshot.data,
          browser: snapshotEvidence(approverEvidence),
        });
        throw error;
      });
      if (outcome.kind !== "download") {
        await attachJson(testInfo, "native-approved-pdf-export-failure", {
          outcome,
          approval,
          snapshot: snapshot.data,
          browser: snapshotEvidence(approverEvidence),
        });
        const failureScreenshot = testInfo.outputPath(
          "native-approved-pdf-export-failure.png",
        );
        await approverPage.screenshot({ path: failureScreenshot });
        await testInfo.attach("native-approved-pdf-export-failure", {
          path: failureScreenshot,
          contentType: "image/png",
        });
        throw new Error(
          `Approved native PDF export failed: ${JSON.stringify(outcome)}`,
        );
      }
      const pdfBytes = await downloadBytes(outcome.download);
      const pdf = await PDFDocument.load(pdfBytes);
      expect(pdf.getPageCount()).toBe(1);
      expect((pdf.getPage(0).getWidth() * 25.4) / 72).toBeCloseTo(420, 6);
      expect((pdf.getPage(0).getHeight() * 25.4) / 72).toBeCloseTo(297, 6);
      const exportReceipt = await fixture.admin
        .from("lukas_qto_export_events")
        .select(
          "artifact_sha256,artifact_byte_size,revision_version,operation_checkpoint,checkpoint_sha256,revision_snapshot_sha256",
        )
        .eq("project_id", fixture.projectId)
        .eq("actor_id", fixture.approver.id)
        .eq("workspace_id", measured.documentId)
        .eq("revision_id", measured.revisionId)
        .eq("artifact_type", "drawing_pdf")
        .single();
      if (exportReceipt.error) throw exportReceipt.error;
      expect(exportReceipt.data).toEqual({
        artifact_sha256: sha256Bytes(pdfBytes),
        artifact_byte_size: pdfBytes.byteLength,
        revision_version: approval.subject_version,
        operation_checkpoint: snapshot.data.operation_sequence,
        checkpoint_sha256: snapshot.data.sha256,
        revision_snapshot_sha256: approval.snapshot_sha256,
      });
      const pdfPath = testInfo.outputPath("native-measured-plan-a3.pdf");
      await writeFile(pdfPath, pdfBytes);
      await testInfo.attach("native-measured-plan-a3", {
        path: pdfPath,
        contentType: "application/pdf",
      });
      await dialog.getByRole("button", { name: "닫기", exact: true }).click();
      const nativeCanvas = await fixture.admin
        .from("lukas_drawing_canvases")
        .select("id")
        .eq("revision_id", measured.revisionId)
        .single();
      if (nativeCanvas.error) throw nativeCanvas.error;
      await proveNativeDrawingDwgExport({
        browser,
        fixture,
        scope: {
          projectId: fixture.projectId,
          documentId: measured.documentId,
          revisionId: measured.revisionId,
          revisionVersion: approval.subject_version,
          canvasId: nativeCanvas.data.id,
          snapshotSha256: approval.snapshot_sha256,
        },
        testInfo,
      });
      expect(await readSourceEvidence(fixture)).toEqual(sourceBefore);
      expect(evidence.pageErrors).toEqual([]);
      expect(evidence.consoleErrors).toEqual([]);
      expect(evidence.responseErrors).toEqual([]);
      for (const browserEvidence of [
        viewerEvidence,
        reviewerEvidence,
        approverEvidence,
      ]) {
        expect(browserEvidence.pageErrors).toEqual([]);
        expect(browserEvidence.consoleErrors).toEqual([]);
        expect(browserEvidence.requestFailures).toEqual([]);
        expect(browserEvidence.responseErrors).toEqual([]);
      }
      const persistencePath = testInfo.outputPath(
        "native-catalog-persistence.json",
      );
      await writeFile(
        persistencePath,
        `${JSON.stringify(
          {
            imported,
            pdfPageMillimeters: {
              width: (pdf.getPage(0).getWidth() * 25.4) / 72,
              height: (pdf.getPage(0).getHeight() * 25.4) / 72,
            },
            blockId: block.data.id,
            nativeRequest: {
              url: nativeOperationUrl,
              key: "door-single-800",
              version: "1",
              clientRequestId: nativeReceipt.data.client_request_id,
            },
            nativeImportResult,
            nativeReceipt: nativeReceipt.data,
            nativePersistenceAfterImport,
            nativePersistenceAfterReviewReplay,
            nativePersistenceAtApproval,
            nativePersistenceAfterRequests,
            measurementCheckpoint,
            nativeMeasurementRequests,
            replayStatus: {
              reviewRequested: reviewRequestedReplay.status(),
              approved: approvedReplay.status(),
              changedSameRequestId: changedRequest.status(),
              approvedNewRequest: approvedNewRequest.status(),
              viewer: denied.status(),
            },
            approvedNewRequestId,
            approvedSnapshot: {
              beforeRequests: { approval, snapshot: snapshot.data },
              afterRequests: {
                approval: finalApproval,
                snapshot: finalSnapshot.data,
              },
            },
            viewerCloneStatus: viewerClone.status(),
            approvals: approvals.data,
            exportReceipt: exportReceipt.data,
            evidence,
            viewerEvidence: snapshotEvidence(viewerEvidence),
            reviewerEvidence: snapshotEvidence(reviewerEvidence),
            approverEvidence: snapshotEvidence(approverEvidence),
          },
          null,
          2,
        )}\n`,
      );
      await testInfo.attach("native-catalog-persistence", {
        path: persistencePath,
        contentType: "application/json",
      });
    } finally {
      await Promise.all([
        context.close(),
        viewerContext.close(),
        reviewerContext.close(),
        approverContext.close(),
      ]);
    }
  });
});
