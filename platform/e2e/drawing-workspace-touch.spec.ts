import { expect, test, type CDPSession, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace?verticalTest=1";

test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });

async function openPreview(page: Page, path = previewPath) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText(
    "준비됨",
    { timeout: 45_000 },
  );
  await expect(page.getByRole("tablist", { name: "도면 도구" })).toBeVisible();
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await surface.boundingBox();
      return Boolean(bounds && bounds.width > 0 && bounds.height > 0);
    })
    .toBe(true);
}

async function touch(
  client: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd" | "touchCancel",
  points: Array<{ id: number; x: number; y: number }>,
) {
  await client.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: points,
  });
}

async function tap(
  client: CDPSession,
  id: number,
  point: { x: number; y: number },
) {
  await touch(client, "touchStart", [{ id, ...point }]);
  await touch(client, "touchEnd", []);
}

async function canvasPoint(page: Page, world: { x: number; y: number }) {
  const surface = page.getByLabel(/도면 화면/);
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Drawing surface has no layout box");
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  const point = {
    x:
      bounds.x +
      Number(await surface.getAttribute("data-viewport-x")) +
      world.x * zoom,
    y:
      bounds.y +
      Number(await surface.getAttribute("data-viewport-y")) +
      world.y * zoom,
  };
  if (
    point.x < bounds.x ||
    point.x > bounds.x + bounds.width ||
    point.y < bounds.y ||
    point.y > bounds.y + bounds.height
  )
    throw new Error(
      `World point is outside the drawing surface: ${JSON.stringify({ bounds, point, world, zoom })}`,
    );
  return point;
}

test("hasTouch selects and moves with one finger, then pinches without authoring a phantom object", async ({
  page,
}) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await openPreview(page);
  const client = await page.context().newCDPSession(page);
  const surface = page.getByLabel(/도면 화면/);
  const snapshot = page.getByLabel("P4 mounted workspace snapshot");
  const core = await canvasPoint(page, { x: 450, y: 310 });

  await tap(client, 1, core);
  await expect(surface).toHaveAttribute("data-selected-object-name", "코어");

  const beforeDrag = JSON.parse((await snapshot.textContent())!);
  const beforeOrigin =
    beforeDrag.objects["00000000-0000-4000-8000-000000000071"].geometry.origin;
  await touch(client, "touchStart", [{ id: 2, ...core }]);
  await touch(client, "touchMove", [{ id: 2, x: core.x + 40, y: core.y + 20 }]);
  await touch(client, "touchEnd", []);
  await expect
    .poll(async () => {
      const current = JSON.parse((await snapshot.textContent())!);
      return current.objects["00000000-0000-4000-8000-000000000071"].geometry
        .origin;
    })
    .not.toEqual(beforeOrigin);

  const reviewArea = await canvasPoint(page, { x: 690, y: 280 });
  const pinchSecond = await canvasPoint(page, { x: 820, y: 360 });
  await touch(client, "touchStart", [{ id: 21, ...reviewArea }]);
  await expect(surface).toHaveAttribute(
    "data-selected-object-name",
    "검토 구역",
  );
  await touch(client, "touchStart", [
    { id: 21, ...reviewArea },
    { id: 22, ...pinchSecond },
  ]);
  await touch(client, "touchEnd", []);
  await expect(surface).toHaveAttribute("data-selected-object-name", "코어");

  await page.getByRole("button", { name: "건축 객체" }).click();
  await page.getByRole("menuitem", { name: "벽 도구" }).click();
  const wallStart = await canvasPoint(page, { x: 50, y: 600 });
  const wallEnd = await canvasPoint(page, { x: 1150, y: 600 });
  const wallCountBefore = Object.values(
    JSON.parse((await snapshot.textContent())!).objects,
  ).filter((object: any) => object.geometry.type === "wall").length;
  await tap(client, 3, wallStart);
  await tap(client, 4, wallEnd);
  await expect
    .poll(
      async () =>
        Object.values(
          JSON.parse((await snapshot.textContent())!).objects,
        ).filter((object: any) => object.geometry.type === "wall").length,
    )
    .toBe(wallCountBefore + 1);

  await page.getByRole("button", { name: "건축 객체" }).click();
  await page.getByRole("menuitem", { name: "벽 도구" }).click();
  const pendingWallStart = await canvasPoint(page, { x: 200, y: 320 });
  await tap(client, 5, pendingWallStart);
  const beforePendingWallPinch = JSON.parse((await snapshot.textContent())!);
  const pendingWallEnd = await canvasPoint(page, { x: 500, y: 320 });
  const wallPinchSecond = await canvasPoint(page, { x: 650, y: 420 });
  await touch(client, "touchStart", [{ id: 6, ...pendingWallEnd }]);
  await touch(client, "touchStart", [
    { id: 6, ...pendingWallEnd },
    { id: 7, ...wallPinchSecond },
  ]);
  await touch(client, "touchEnd", []);
  const afterPendingWallPinch = JSON.parse((await snapshot.textContent())!);
  expect(Object.keys(afterPendingWallPinch.objects)).toHaveLength(
    Object.keys(beforePendingWallPinch.objects).length,
  );
  expect(afterPendingWallPinch.operationIds).toEqual(
    beforePendingWallPinch.operationIds,
  );

  await page.getByRole("button", { name: "건축 객체" }).click();
  await page.getByRole("menuitem", { name: "개구부 도구" }).click();
  const openingPoint = await canvasPoint(page, { x: 600, y: 600 });
  const openingCountBefore = Object.values(
    JSON.parse((await snapshot.textContent())!).objects,
  ).filter((object: any) => object.geometry.type === "opening").length;
  await tap(client, 8, openingPoint);
  await expect
    .poll(
      async () =>
        Object.values(
          JSON.parse((await snapshot.textContent())!).objects,
        ).filter((object: any) => object.geometry.type === "opening").length,
    )
    .toBe(openingCountBefore + 1);

  await page.getByRole("button", { name: "건축 객체" }).click();
  await page.getByRole("menuitem", { name: "개구부 도구" }).click();
  const beforePinch = JSON.parse((await snapshot.textContent())!);
  const beforeZoom = Number(await surface.getAttribute("data-viewport-zoom"));
  const first = openingPoint;
  const second = await canvasPoint(page, { x: 1120, y: 660 });
  await touch(client, "touchStart", [{ id: 9, ...first }]);
  await touch(client, "touchStart", [
    { id: 9, ...first },
    { id: 10, ...second },
  ]);
  await touch(client, "touchMove", [
    { id: 9, x: first.x - 60, y: first.y + 30 },
    { id: 10, x: second.x + 100, y: second.y + 30 },
  ]);
  await touch(client, "touchEnd", []);

  await expect
    .poll(async () => Number(await surface.getAttribute("data-viewport-zoom")))
    .toBeGreaterThan(beforeZoom);
  const afterPinch = JSON.parse((await snapshot.textContent())!);
  expect(Object.keys(afterPinch.objects)).toHaveLength(
    Object.keys(beforePinch.objects).length,
  );
  expect(afterPinch.operationIds).toEqual(beforePinch.operationIds);
});

test("touch cancellation, blur, and tool changes close the owned gesture", async ({
  page,
}) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await openPreview(page);
  const client = await page.context().newCDPSession(page);
  const surface = page.getByLabel(/도면 화면/);
  const snapshot = page.getByLabel("P4 mounted workspace snapshot");
  const point = async (x: number, y: number) => {
    const bounds = await surface.boundingBox();
    if (!bounds) throw new Error("Drawing surface has no layout box");
    return { x: bounds.x + x, y: bounds.y + y };
  };
  const objectCount = async () =>
    Object.keys(JSON.parse((await snapshot.textContent())!).objects).length;

  await page.getByRole("button", { name: "건축 객체" }).click();
  await page.getByRole("menuitem", { name: "벽 도구" }).click();
  await tap(client, 31, await point(180, 180));
  const beforeCancel = await objectCount();
  await touch(client, "touchStart", [{ id: 32, ...(await point(380, 180)) }]);
  await touch(client, "touchCancel", []);
  await expect(page.getByRole("button", { name: "선택 도구" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await objectCount()).toBe(beforeCancel);

  await page.getByRole("button", { name: "건축 객체" }).click();
  await page.getByRole("menuitem", { name: "벽 도구" }).click();
  await tap(client, 33, await point(180, 260));
  await surface.focus();
  await touch(client, "touchStart", [{ id: 34, ...(await point(380, 260)) }]);
  await surface.evaluate((element) => element.blur());
  await expect(page.getByRole("button", { name: "선택 도구" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await touch(client, "touchCancel", []);
  expect(await objectCount()).toBe(beforeCancel);

  await page.getByRole("button", { name: "이동 도구" }).click();
  const panStart = await point(600, 280);
  await touch(client, "touchStart", [{ id: 35, ...panStart }]);
  await touch(client, "touchMove", [
    { id: 35, x: panStart.x + 20, y: panStart.y + 10 },
  ]);
  await page.getByRole("button", { name: "선택 도구" }).click();
  await touch(client, "touchMove", [
    { id: 35, x: panStart.x + 40, y: panStart.y + 20 },
  ]);
  await touch(client, "touchEnd", []);

  const lineCountBefore = Object.values(
    JSON.parse((await snapshot.textContent())!).objects,
  ).filter((object: any) => object.geometry.type === "line").length;
  await page.getByRole("button", { name: "선 도구" }).click();
  await tap(client, 36, await point(220, 360));
  await tap(client, 37, await point(440, 360));
  await expect
    .poll(
      async () =>
        Object.values(
          JSON.parse((await snapshot.textContent())!).objects,
        ).filter((object: any) => object.geometry.type === "line").length,
    )
    .toBe(lineCountBefore + 1);
});

test("touch calibration commits taps on release and treats a second finger as pinch", async ({
  page,
}) => {
  test.setTimeout(90_000);
  page.setDefaultTimeout(10_000);
  await openPreview(page, "/workspace-preview/drawing-workspace?view=2d");
  const client = await page.context().newCDPSession(page);
  const surface = page.getByLabel(/도면 화면/);

  await page.getByRole("tab", { name: "페이지·레이어" }).click();
  await page.getByRole("button", { name: "두 점 선택" }).click();
  await expect(page.getByText("1번째 점을 선택하세요.")).toBeVisible();

  const first = await canvasPoint(page, { x: 120, y: 150 });
  const second = await canvasPoint(page, { x: 300, y: 150 });
  const pinchSecond = await canvasPoint(page, { x: 420, y: 260 });
  const zoomBefore = Number(await surface.getAttribute("data-viewport-zoom"));

  const panBefore = {
    x: Number(await surface.getAttribute("data-viewport-x")),
    y: Number(await surface.getAttribute("data-viewport-y")),
  };
  await surface.focus();
  await page.keyboard.down("Space");
  await touch(client, "touchStart", [{ id: 49, ...first }]);
  await touch(client, "touchMove", [
    { id: 49, x: first.x + 70, y: first.y + 35 },
  ]);
  await touch(client, "touchEnd", []);
  await page.keyboard.up("Space");
  await expect
    .poll(async () => ({
      x: Number(await surface.getAttribute("data-viewport-x")),
      y: Number(await surface.getAttribute("data-viewport-y")),
    }))
    .not.toEqual(panBefore);
  await expect(page.getByText("1번째 점을 선택하세요.")).toBeVisible();

  await touch(client, "touchStart", [{ id: 51, ...first }]);
  await expect(page.getByText("1번째 점을 선택하세요.")).toBeVisible();
  await touch(client, "touchStart", [
    { id: 51, ...first },
    { id: 52, ...pinchSecond },
  ]);
  await touch(client, "touchMove", [
    { id: 51, x: first.x - 40, y: first.y },
    { id: 52, x: pinchSecond.x + 80, y: pinchSecond.y },
  ]);
  await touch(client, "touchEnd", []);

  await expect
    .poll(async () => Number(await surface.getAttribute("data-viewport-zoom")))
    .toBeGreaterThan(zoomBefore);
  await expect(page.getByText("1번째 점을 선택하세요.")).toBeVisible();

  await tap(client, 53, first);
  await expect(page.getByText("2번째 점을 선택하세요.")).toBeVisible();
  await tap(client, 54, second);
  await expect(page.getByText("2점 선택 완료")).toBeVisible();
  await expect(page.getByRole("button", { name: "축척 저장" })).toBeEnabled();
});
