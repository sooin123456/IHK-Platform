import { expect, test, type Page } from "@playwright/test";

import {
  authenticateApiClient,
  authenticateContext,
  createDrawingFixture,
  destroyDrawingFixture,
  readSourceEvidence,
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
    const inspector = page.getByLabel("속성 검사기");
    const inspectorLayer = inspector.getByLabel("레이어", { exact: true });
    await expect(inspectorLayer).toHaveCount(1);
    await inspector
      .getByLabel("객체 이름", { exact: true })
      .fill("외벽 검토 영역");
    await inspectorLayer.selectOption({ label: "검토 주석" });
    await inspector.getByLabel("선 색상", { exact: true }).fill("#dc2626");
    await inspector.getByLabel("선 두께", { exact: true }).fill("3");
    await inspector.getByLabel("채우기", { exact: true }).fill("#fee2e2aa");
    await inspector.getByRole("button", { name: "속성 적용" }).click();

    await page.mouse.click(textPoint.x, textPoint.y);
    const inspectorText = inspector.getByLabel("텍스트", { exact: true });
    await expect(inspectorText).toHaveCount(1);
    await inspectorText.fill("수정된 1HK E2E 메모");
    await inspector.getByRole("button", { name: "속성 적용" }).click();
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

  test("same-session draw, save, and issue link without reload, then a separate reviewer approves", async ({
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
    await drawClicks(ownerPage, "선 도구", [
      [0.82, 0.68],
      [0.9, 0.68],
    ]);
    await waitUntilSaved(ownerPage);
    await ownerPage.getByRole("button", { name: "선택 도구" }).click();
    const line = await drawingPoint(ownerPage, 0.86, 0.68);
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
    expect(await readSourceEvidence(fixture)).toEqual(fixture.sourceEvidence);
    await ownerContext.close();
    await reviewerContext.close();
  });

  test("viewer UI mutation controls are absent and RPC is read-only", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfWorkspace.fileId}/workspace`;
    const context = await browser.newContext();
    const page = await authenticateContext(
      fixture,
      context,
      fixture.viewer,
      baseUrl,
      path,
    );
    for (const control of [
      "선 도구",
      "폴리라인 도구",
      "사각형 도구",
      "원 도구",
      "텍스트 도구",
      "치수 도구",
      "레이어 추가",
      "속성 적용",
      "실행 취소",
      "다시 실행",
    ])
      await expect(page.getByRole("button", { name: control })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "선택 도구" })).toBeVisible();
    await expect(page.getByText("읽기 전용 레이어 목록")).toBeVisible();

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

  test("non-member route, read API, and mutation RPC are denied", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.blankWorkspace.fileId}/workspace`;
    const context = await browser.newContext();
    const page = await authenticateContext(
      fixture,
      context,
      fixture.nonMember,
      baseUrl,
      "/",
    );
    const routeResponse = await page.goto(`${baseUrl}${path}`);
    expect(routeResponse?.status()).toBe(403);

    const outsider = await authenticateApiClient(fixture, fixture.nonMember);
    const read = await outsider
      .from("lukas_drawing_documents")
      .select("id")
      .eq("id", fixture.blankWorkspace.documentId);
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);

    const objectId = crypto.randomUUID();
    const mutation = await outsider.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: crypto.randomUUID(),
      p_operation_type: "add_objects",
      p_base_versions: {},
      p_forward: {
        type: "add_objects",
        objects: [
          {
            id: objectId,
            name: "Non-member mutation attempt",
            layerId: fixture.blankWorkspace.workLayerId,
            geometry: {
              type: "circle",
              center: { x: 10, y: 10 },
              radius: 5,
            },
            style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
            version: 1,
          },
        ],
      },
      p_inverse: { type: "delete_objects", objectIds: [objectId] },
    });
    expect(mutation.error).toBeTruthy();
    await context.close();
  });

  test("approved revision rejects canonical RPC and direct table mutations", async () => {
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
      .select("id,name,layer_id,geometry,style,version,status")
      .eq("revision_id", fixture.pdfWorkspace.revisionId)
      .eq("status", "active")
      .limit(1)
      .single();
    if (objectError || !object)
      throw objectError ?? new Error("Approved object evidence missing");

    const canonicalBefore = structuredClone(object);
    const rpcUpdate = await owner.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.pdfWorkspace.revisionId,
      p_client_operation_id: crypto.randomUUID(),
      p_operation_type: "update_objects",
      p_base_versions: { [object.id]: object.version },
      p_forward: {
        type: "update_objects",
        updates: [
          { objectId: object.id, patch: { name: "승인 후 RPC 변경 시도" } },
        ],
      },
      p_inverse: {
        type: "update_objects",
        updates: [{ objectId: object.id, patch: { name: object.name } }],
      },
    });
    expect(rpcUpdate.error).toBeTruthy();
    const rpcDelete = await owner.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.pdfWorkspace.revisionId,
      p_client_operation_id: crypto.randomUUID(),
      p_operation_type: "delete_objects",
      p_base_versions: { [object.id]: object.version },
      p_forward: { type: "delete_objects", objectIds: [object.id] },
      p_inverse: {
        type: "add_objects",
        objects: [
          {
            id: object.id,
            name: object.name,
            layerId: object.layer_id,
            geometry: object.geometry,
            style: object.style,
            version: object.version + 2,
          },
        ],
      },
    });
    expect(rpcDelete.error).toBeTruthy();
    const { data: afterRpc, error: afterRpcError } = await owner
      .from("lukas_drawing_objects")
      .select("id,name,layer_id,geometry,style,version,status")
      .eq("id", object.id)
      .single();
    if (afterRpcError) throw afterRpcError;
    expect(afterRpc).toEqual(canonicalBefore);

    // Separate defense-in-depth proof: authenticated table DML is also blocked.
    const update = await owner
      .from("lukas_drawing_objects")
      .update({ name: "승인 후 변경 시도" })
      .eq("id", object.id)
      .select("id");
    const deletion = await owner
      .from("lukas_drawing_objects")
      .delete()
      .eq("id", object.id)
      .select("id");
    expect(Boolean(update.error) || update.data?.length === 0).toBe(true);
    expect(Boolean(deletion.error) || deletion.data?.length === 0).toBe(true);
    const { data: afterDirect, error: afterDirectError } = await owner
      .from("lukas_drawing_objects")
      .select("id,name,layer_id,geometry,style,version,status")
      .eq("id", object.id)
      .single();
    if (afterDirectError) throw afterDirectError;
    expect(afterDirect).toEqual(canonicalBefore);
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
    const surface = page.getByLabel(/도면 화면/);
    const state = surface;
    const readState = async () => ({
      viewportX: Number(await state.getAttribute("data-viewport-x")),
      viewportY: Number(await state.getAttribute("data-viewport-y")),
      viewportZoom: Number(await state.getAttribute("data-viewport-zoom")),
      selectionCount: Number(await state.getAttribute("data-selection-count")),
      selectedObjectName:
        (await state.getAttribute("data-selected-object-name")) ?? "",
    });
    const initial = await readState();
    expect(initial.viewportZoom).toBeGreaterThanOrEqual(
      seeded.selectionTarget.minimumZoom,
    );
    await surface.evaluate((element) => {
      const evidence = {
        mode: "zoom" as "zoom" | "pan" | "selection",
        zoom: [] as number[],
        pan: [] as number[],
        selection: [] as number[],
      };
      Object.assign(element, { __drawingPerformanceEvidence: evidence });
      const measure = (kind: "wheel" | "pointermove" | "pointerup") => {
        const started = performance.now();
        requestAnimationFrame(() => {
          const elapsed = performance.now() - started;
          if (kind === "wheel" && evidence.mode === "zoom")
            evidence.zoom.push(elapsed);
          if (kind === "pointermove" && evidence.mode === "pan")
            evidence.pan.push(elapsed);
          if (kind === "pointerup" && evidence.mode === "selection")
            evidence.selection.push(elapsed);
        });
      };
      element.addEventListener("wheel", () => measure("wheel"), {
        capture: true,
      });
      element.addEventListener("pointermove", () => measure("pointermove"), {
        capture: true,
      });
      element.addEventListener("pointerup", () => measure("pointerup"), {
        capture: true,
      });
    });
    const box = await surface.boundingBox();
    if (!box) throw new Error("Performance canvas has no layout box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let frame = 0; frame < 60; frame += 1) {
      await page.mouse.wheel(0, frame < 30 ? -3 : 1);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }
    const afterZoom = await readState();
    expect(afterZoom.viewportZoom).not.toBe(initial.viewportZoom);

    await page.getByLabel("이동 도구").click();
    const panStart = {
      x: box.x + box.width * 0.55,
      y: box.y + box.height * 0.55,
    };
    await page.mouse.move(panStart.x, panStart.y);
    await surface.evaluate((element) => {
      (
        element as HTMLElement & {
          __drawingPerformanceEvidence: { mode: string };
        }
      ).__drawingPerformanceEvidence.mode = "pan";
    });
    await page.mouse.down();
    for (let frame = 1; frame <= 60; frame += 1) {
      await page.mouse.move(panStart.x + frame * 1.5, panStart.y + frame);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }
    await page.mouse.up();
    const afterPan = await readState();
    expect({ x: afterPan.viewportX, y: afterPan.viewportY }).not.toEqual({
      x: afterZoom.viewportX,
      y: afterZoom.viewportY,
    });

    const gestureMetrics = await surface.evaluate(
      (element, input) => {
        const evidence = (
          element as HTMLElement & {
            __drawingPerformanceEvidence: {
              zoom: number[];
              pan: number[];
            };
          }
        ).__drawingPerformanceEvidence;
        const percentile = (values: number[], ratio: number) => {
          const sorted = [...values].sort((a, b) => a - b);
          return sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0;
        };
        const frameDurations = [...evidence.zoom, ...evidence.pan];
        return {
          browser: navigator.userAgent,
          viewport: { width: innerWidth, height: innerHeight },
          composition: input.composition,
          frameCount: frameDurations.length,
          zoomFrameCount: evidence.zoom.length,
          panFrameCount: evidence.pan.length,
          frameMedianMs: percentile(frameDurations, 0.5),
          frameP95Ms: percentile(frameDurations, 0.95),
          initialViewport: input.initial,
          gestureViewport: input.afterPan,
        };
      },
      { composition: seeded.composition, initial, afterPan },
    );
    expect(gestureMetrics.frameCount).toBe(120);
    expect(gestureMetrics.zoomFrameCount).toBe(60);
    expect(gestureMetrics.panFrameCount).toBe(60);
    expect(
      gestureMetrics.frameP95Ms,
      JSON.stringify(gestureMetrics),
    ).toBeLessThanOrEqual(50);

    await page.getByRole("button", { name: "화면 맞춤" }).click();
    const fitBox = await surface.boundingBox();
    if (!fitBox) throw new Error("Performance canvas lost its layout box");
    const fitSize = {
      width: Math.floor(fitBox.width),
      height: Math.floor(fitBox.height),
    };
    const fitZoom = Math.min(
      32,
      Math.max(
        0.05,
        Math.min(
          Math.max(1, fitSize.width - 80) / seeded.canvas.width,
          Math.max(1, fitSize.height - 80) / seeded.canvas.height,
        ),
      ),
    );
    const fitViewport = {
      x: (fitSize.width - seeded.canvas.width * fitZoom) / 2,
      y: (fitSize.height - seeded.canvas.height * fitZoom) / 2,
      zoom: fitZoom,
    };
    await expect
      .poll(async () => {
        const current = await readState();
        return Math.max(
          Math.abs(current.viewportX - fitViewport.x),
          Math.abs(current.viewportY - fitViewport.y),
          Math.abs(current.viewportZoom - fitViewport.zoom),
        );
      })
      .toBeLessThan(0.001);
    const fittedState = await readState();
    const targetScreenPoint = {
      x:
        fittedState.viewportX +
        seeded.selectionTarget.world.x * fittedState.viewportZoom,
      y:
        fittedState.viewportY +
        seeded.selectionTarget.world.y * fittedState.viewportZoom,
    };
    const selectionSafetyMargin = 12;
    expect(targetScreenPoint.x).toBeGreaterThanOrEqual(selectionSafetyMargin);
    expect(targetScreenPoint.y).toBeGreaterThanOrEqual(selectionSafetyMargin);
    expect(targetScreenPoint.x).toBeLessThanOrEqual(
      fitBox.width - selectionSafetyMargin,
    );
    expect(targetScreenPoint.y).toBeLessThanOrEqual(
      fitBox.height - selectionSafetyMargin,
    );

    await page.getByRole("button", { name: "선택 도구" }).click();
    await surface.evaluate((element) => {
      (
        element as HTMLElement & {
          __drawingPerformanceEvidence: { mode: string };
        }
      ).__drawingPerformanceEvidence.mode = "selection";
    });
    for (let query = 0; query < 20; query += 1) {
      const target = seeded.selectionTarget;
      await page.mouse.click(
        fitBox.x + targetScreenPoint.x,
        fitBox.y + targetScreenPoint.y,
      );
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
      await expect(state).toHaveAttribute("data-selection-count", "1");
      await expect(state).toHaveAttribute(
        "data-selected-object-name",
        target.name,
      );
      await expect(
        page.getByLabel("속성 검사기").getByLabel("객체 이름", { exact: true }),
      ).toHaveValue(target.name);
    }
    const finalState = await readState();
    const inspectorObjectName = await page
      .getByLabel("속성 검사기")
      .getByLabel("객체 이름", { exact: true })
      .inputValue();
    expect(finalState.selectionCount).toBe(1);
    expect(finalState.selectedObjectName).toBe(seeded.selectionTarget.name);
    expect(inspectorObjectName).toBe(finalState.selectedObjectName);

    const metrics = await surface.evaluate(
      (element, input) => {
        const evidence = (
          element as HTMLElement & {
            __drawingPerformanceEvidence: {
              zoom: number[];
              pan: number[];
              selection: number[];
            };
          }
        ).__drawingPerformanceEvidence;
        const percentile = (values: number[], ratio: number) => {
          const sorted = [...values].sort((a, b) => a - b);
          return sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0;
        };
        return {
          ...input.gestureMetrics,
          selectionCount: evidence.selection.length,
          selectionMedianMs: percentile(evidence.selection, 0.5),
          selectionP95Ms: percentile(evidence.selection, 0.95),
          selectionViewport: input.finalState,
          inspectorObjectName: input.inspectorObjectName,
        };
      },
      {
        gestureMetrics,
        finalState,
        inspectorObjectName,
      },
    );
    expect(metrics.frameCount).toBe(120);
    expect(metrics.zoomFrameCount).toBe(60);
    expect(metrics.panFrameCount).toBe(60);
    expect(metrics.selectionCount).toBe(20);
    test.info().annotations.push({
      type: "performance",
      description: JSON.stringify(metrics),
    });
    expect(metrics.selectionP95Ms, JSON.stringify(metrics)).toBeLessThanOrEqual(
      50,
    );
    expect(await readSourceEvidence(fixture)).toEqual(fixture.sourceEvidence);
    await context.close();
  });
});
