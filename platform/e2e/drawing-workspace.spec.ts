import { expect, test, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  authenticateContext,
  createDrawingFixture,
  destroyDrawingFixture,
  readSourceHashes,
  seedDrawingPerformanceObjects,
  type DrawingFixture,
} from "./utils/drawing-collaboration-fixture";

const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4000";

async function drawingPoint(page: Page, xRatio: number, yRatio: number) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Drawing canvas has no layout box");
  return { x: box.x + box.width * xRatio, y: box.y + box.height * yRatio };
}

async function drawClicks(
  page: Page,
  tool: string,
  points: Array<[number, number]>,
  finish: "none" | "double" = "none",
) {
  await page.getByRole("button", { name: tool }).click();
  for (const [x, y] of points) {
    const point = await drawingPoint(page, x, y);
    await page.mouse.click(point.x, point.y);
  }
  if (finish === "double") {
    const point = await drawingPoint(
      page,
      points.at(-1)![0],
      points.at(-1)![1],
    );
    await page.mouse.dblclick(point.x, point.y);
  }
}

async function drawDrag(
  page: Page,
  tool: string,
  start: [number, number],
  end: [number, number],
) {
  await page.getByRole("button", { name: tool }).click();
  const from = await drawingPoint(page, ...start);
  const to = await drawingPoint(page, ...end);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
}

async function waitUntilSaved(page: Page) {
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible({
    timeout: 30_000,
  });
}

test.describe.serial("1HK drawing workspace P0/P1", () => {
  let fixture: DrawingFixture;

  test.beforeAll(async () => {
    fixture = await createDrawingFixture();
  });

  test.afterAll(async () => {
    await destroyDrawingFixture(fixture);
  });

  test("pdf-backed and blank workspaces open", async ({ browser }) => {
    const context = await browser.newContext();
    const pdfPath = `/projects/${fixture.projectId}/drawings/${fixture.pdfWorkspace.fileId}/workspace`;
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      pdfPath,
    );
    await expect(
      page.getByText("PDF 원본 배경을 표시하고 있습니다."),
    ).toBeVisible({
      timeout: 30_000,
    });

    const blankPath = `/projects/${fixture.projectId}/drawings/${fixture.blankWorkspace.fileId}/workspace`;
    await page.goto(`${baseUrl}${blankPath}`);
    await expect(
      page.getByText("빈 도면 배경을 표시하고 있습니다."),
    ).toBeVisible();
    await context.close();
  });

  test("editor authors six tools, edits properties, and survives reload and relogin", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfWorkspace.fileId}/workspace`;
    const context = await browser.newContext();
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      path,
    );
    await waitUntilSaved(page);

    await drawClicks(page, "선 도구", [
      [0.22, 0.22],
      [0.32, 0.22],
    ]);
    await drawClicks(
      page,
      "폴리라인 도구",
      [
        [0.38, 0.2],
        [0.42, 0.26],
        [0.48, 0.2],
      ],
      "double",
    );
    await drawDrag(page, "사각형 도구", [0.54, 0.19], [0.64, 0.28]);
    await drawDrag(page, "원 도구", [0.7, 0.23], [0.75, 0.28]);
    await page.getByRole("button", { name: "텍스트 도구" }).click();
    const textPoint = await drawingPoint(page, 0.28, 0.38);
    await page.mouse.click(textPoint.x, textPoint.y);
    await page.getByLabel("도면 텍스트").fill("1HK E2E 메모");
    await page.getByLabel("도면 텍스트").press("Enter");
    await drawClicks(page, "치수 도구", [
      [0.42, 0.38],
      [0.55, 0.38],
    ]);
    await waitUntilSaved(page);

    await page.getByLabel("새 레이어 이름").fill("검토 주석");
    await page.getByRole("button", { name: "레이어 추가" }).click();
    await page.getByLabel("레이어 표시: 검토 주석").uncheck();
    await page.getByLabel("레이어 표시: 검토 주석").check();
    await page.getByLabel("레이어 잠금: 검토 주석").check();
    await page.getByLabel("레이어 잠금: 검토 주석").uncheck();

    await page.getByRole("button", { name: "선택 도구" }).click();
    const rectangle = await drawingPoint(page, 0.59, 0.23);
    await page.mouse.click(rectangle.x, rectangle.y);
    await page.getByLabel("객체 이름").fill("외벽 검토 영역");
    await page.getByLabel("레이어").selectOption({ label: "검토 주석" });
    await page.getByLabel("선 색상").fill("#dc2626");
    await page.getByLabel("선 두께").fill("3");
    await page.getByLabel("채우기").fill("#fee2e2aa");
    await page.getByRole("button", { name: "속성 적용" }).click();

    await page.mouse.click(textPoint.x, textPoint.y);
    await page.getByLabel("텍스트").fill("수정된 1HK E2E 메모");
    await page.getByRole("button", { name: "속성 적용" }).click();
    await page.mouse.click(rectangle.x, rectangle.y);

    await page.mouse.move(rectangle.x, rectangle.y);
    await page.mouse.down();
    await page.mouse.move(rectangle.x + 18, rectangle.y + 12, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");
    await page.keyboard.press("Delete");
    await page.getByRole("button", { name: "실행 취소" }).click();
    await page.getByRole("button", { name: "다시 실행" }).click();
    await waitUntilSaved(page);

    await page.reload();
    await waitUntilSaved(page);
    const ownerApi = await authenticateApiClient(fixture, fixture.owner);
    const { data: persisted, error: persistedError } = await ownerApi
      .from("lukas_drawing_objects")
      .select("id,name,object_type,version,layer_id,geometry")
      .eq("revision_id", fixture.pdfWorkspace.revisionId)
      .eq("status", "active");
    if (persistedError) throw persistedError;
    expect(
      new Set((persisted ?? []).map((object) => object.object_type)),
    ).toEqual(
      new Set(["line", "polyline", "rectangle", "circle", "text", "dimension"]),
    );
    expect(persisted?.some((object) => object.name === "외벽 검토 영역")).toBe(
      true,
    );
    const { data: customLayer, error: customLayerError } = await ownerApi
      .from("lukas_drawing_layers")
      .select("id")
      .eq("revision_id", fixture.pdfWorkspace.revisionId)
      .eq("name", "검토 주석")
      .single();
    if (customLayerError || !customLayer)
      throw customLayerError ?? new Error("Custom layer evidence missing");
    expect(
      persisted?.find((object) => object.name === "외벽 검토 영역")?.layer_id,
    ).toBe(customLayer.id);
    expect(
      persisted?.some(
        (object) =>
          object.object_type === "text" &&
          (object.geometry as { text?: string }).text === "수정된 1HK E2E 메모",
      ),
    ).toBe(true);

    await context.close();
    const reloginContext = await browser.newContext();
    const reloginPage = await authenticateContext(
      fixture,
      reloginContext,
      fixture.owner,
      baseUrl,
      path,
    );
    await waitUntilSaved(reloginPage);
    await expect(reloginPage.getByText("검토 주석")).toBeVisible();
    await reloginContext.close();
  });

  test("reload and relogin restore acknowledged edits, link an issue, and a separate reviewer approves", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfWorkspace.fileId}/workspace`;
    const ownerContext = await browser.newContext();
    const ownerPage = await authenticateContext(
      fixture,
      ownerContext,
      fixture.owner,
      baseUrl,
      path,
    );
    await waitUntilSaved(ownerPage);
    await ownerPage.getByRole("button", { name: "선택 도구" }).click();
    const line = await drawingPoint(ownerPage, 0.27, 0.22);
    await ownerPage.mouse.click(line.x, line.y);
    await ownerPage
      .getByRole("form", { name: "이슈 연결" })
      .getByLabel("이슈")
      .selectOption(fixture.existingIssueId);
    await ownerPage.getByRole("button", { name: "이슈 연결" }).click();
    await expect(ownerPage.getByText(/기존 창호 이슈/)).toBeVisible();
    await ownerPage.getByRole("button", { name: "검토 요청" }).click();

    const reviewerContext = await browser.newContext();
    const reviewerPage = await authenticateContext(
      fixture,
      reviewerContext,
      fixture.reviewer,
      baseUrl,
      path,
    );
    await reviewerPage
      .getByLabel("검토 의견")
      .fill("P0/P1 근거와 객체 연결 확인");
    await reviewerPage.getByRole("button", { name: "도면 승인" }).click();
    await expect(
      reviewerPage.getByRole("button", { name: "도면 승인" }),
    ).toHaveCount(0);

    const ownerApi = await authenticateApiClient(fixture, fixture.owner);
    const { data: object, error: objectError } = await ownerApi
      .from("lukas_drawing_objects")
      .select("id")
      .eq("revision_id", fixture.pdfWorkspace.revisionId)
      .eq("status", "active")
      .limit(1)
      .single();
    if (objectError || !object)
      throw objectError ?? new Error("Object evidence missing");
    await expect
      .poll(async () => {
        const { data } = await ownerApi
          .from("lukas_drawing_revisions")
          .select("status")
          .eq("id", fixture.pdfWorkspace.revisionId)
          .single();
        return data?.status;
      })
      .toBe("approved");
    expect(await readSourceHashes(fixture)).toEqual(fixture.sourceHashes);
    await ownerContext.close();
    await reviewerContext.close();
  });

  test("viewer UI and direct mutations are read-only", async ({ browser }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfWorkspace.fileId}/workspace`;
    const context = await browser.newContext();
    const page = await authenticateContext(
      fixture,
      context,
      fixture.viewer,
      baseUrl,
      path,
    );
    for (const control of ["선 도구", "레이어 추가", "속성 적용"])
      await expect(page.getByRole("button", { name: control })).toBeDisabled();

    const viewerApi = await authenticateApiClient(fixture, fixture.viewer);
    const objectId = crypto.randomUUID();
    const direct = await viewerApi.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: crypto.randomUUID(),
      p_operation_type: "add_objects",
      p_base_versions: {},
      p_forward: {
        type: "add_objects",
        objects: [
          {
            id: objectId,
            name: "Viewer mutation attempt",
            layerId: fixture.blankWorkspace.workLayerId,
            geometry: { type: "circle", center: { x: 10, y: 10 }, radius: 5 },
            style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
            version: 1,
          },
        ],
      },
      p_inverse: { type: "delete_objects", objectIds: [objectId] },
    });
    expect(direct.error).toBeTruthy();
    await context.close();
  });

  test("approved revision rejects direct update and delete", async () => {
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const { data: revision, error } = await owner
      .from("lukas_drawing_revisions")
      .select("status")
      .eq("id", fixture.pdfWorkspace.revisionId)
      .single();
    if (error) throw error;
    expect(revision.status).toBe("approved");
    const { data: object, error: objectError } = await owner
      .from("lukas_drawing_objects")
      .select("id")
      .eq("revision_id", fixture.pdfWorkspace.revisionId)
      .eq("status", "active")
      .limit(1)
      .single();
    if (objectError || !object)
      throw objectError ?? new Error("Approved object evidence missing");
    const update = await owner
      .from("lukas_drawing_objects")
      .update({ name: "승인 후 변경 시도" })
      .eq("id", object.id);
    const deletion = await owner
      .from("lukas_drawing_objects")
      .delete()
      .eq("id", object.id);
    expect(update.error).toBeTruthy();
    expect(deletion.error).toBeTruthy();
  });

  test("10,000 canonical objects stay below the catastrophic P0/P1 budget", async ({
    browser,
  }) => {
    const seeded = await seedDrawingPerformanceObjects(fixture);
    expect(seeded.count).toBe(10_000);
    const path = `/projects/${fixture.projectId}/drawings/${fixture.blankWorkspace.fileId}/workspace`;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      path,
    );
    await waitUntilSaved(page);
    const metrics = await page.getByLabel(/도면 화면/).evaluate(
      async (surface, input) => {
        const target = surface.querySelector("canvas");
        if (!(target instanceof HTMLCanvasElement))
          throw new Error(
            "Konva canvas is unavailable for performance evidence",
          );
        const frameDurations: number[] = [];
        for (let frame = 0; frame < input.frameCount; frame += 1) {
          const started = performance.now();
          target.dispatchEvent(
            new WheelEvent("wheel", {
              bubbles: true,
              cancelable: true,
              clientX: 720,
              clientY: 450,
              deltaY: frame % 2 === 0 ? -2 : 2,
            }),
          );
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          frameDurations.push(performance.now() - started);
        }
        const selectionDurations: number[] = [];
        for (let query = 0; query < 20; query += 1) {
          const started = performance.now();
          const x = 120 + query * 4;
          const y = 140 + query * 3;
          target.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              clientX: x,
              clientY: y,
              pointerId: query + 1,
            }),
          );
          target.dispatchEvent(
            new PointerEvent("pointerup", {
              bubbles: true,
              clientX: x + 100,
              clientY: y + 80,
              pointerId: query + 1,
            }),
          );
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
          selectionDurations.push(performance.now() - started);
        }
        const percentile = (values: number[], ratio: number) => {
          const sorted = [...values].sort((a, b) => a - b);
          return sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0;
        };
        return {
          browser: navigator.userAgent,
          viewport: { width: innerWidth, height: innerHeight },
          composition: input.composition,
          frameCount: input.frameCount,
          frameMedianMs: percentile(frameDurations, 0.5),
          frameP95Ms: percentile(frameDurations, 0.95),
          selectionMedianMs: percentile(selectionDurations, 0.5),
          selectionP95Ms: percentile(selectionDurations, 0.95),
        };
      },
      { composition: seeded.composition, frameCount: 120 },
    );
    test.info().annotations.push({
      type: "performance",
      description: JSON.stringify(metrics),
    });
    expect(metrics.frameP95Ms, JSON.stringify(metrics)).toBeLessThanOrEqual(50);
    expect(metrics.selectionP95Ms, JSON.stringify(metrics)).toBeLessThanOrEqual(
      50,
    );
    await context.close();
  });
});
