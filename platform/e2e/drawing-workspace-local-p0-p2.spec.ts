import { expect, test, type Download, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace?verticalTest=1";

type Snapshot = {
  activeCanvasId: string | null;
  layers: Record<string, { locked: boolean; name: string; visible: boolean }>;
  objects: Record<
    string,
    {
      geometry: { type: string };
      id: string;
      layerId: string;
      name: string;
      style: Record<string, unknown>;
    }
  >;
  operationIds: string[];
  redoIds: string[];
  selectedIds: string[];
  undoIds: string[];
};

async function openPreview(page: Page) {
  await page.goto(previewPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(page.getByRole("tablist", { name: "도면 도구" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "P4 로컬 저장 동기화" }),
  ).toBeEnabled();
  await page.waitForTimeout(500);
}

async function snapshot(page: Page) {
  const output = page.getByLabel("P4 mounted workspace snapshot");
  let current: Snapshot | null = null;
  await expect
    .poll(async () => {
      const text = await output.textContent();
      current = text && text !== "null" ? (JSON.parse(text) as Snapshot) : null;
      return current !== null;
    })
    .toBe(true);
  return current!;
}

async function point(page: Page, world: { x: number; y: number }) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Drawing surface has no layout box");
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  const local = {
    x: Number(await surface.getAttribute("data-viewport-x")) + world.x * zoom,
    y: Number(await surface.getAttribute("data-viewport-y")) + world.y * zoom,
  };
  return {
    client: { x: box.x + local.x, y: box.y + local.y },
    local,
  };
}

async function drawClicks(
  page: Page,
  tool: string,
  points: Array<{ x: number; y: number }>,
) {
  await page.getByRole("button", { name: tool }).click();
  const surface = page.getByLabel(/도면 화면/);
  for (const coordinate of points) {
    const target = await point(page, coordinate);
    await surface.click({ position: target.local });
    await page.waitForTimeout(120);
  }
}

async function drawDrag(
  page: Page,
  tool: string,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  await page.getByRole("button", { name: tool }).click();
  const from = await point(page, start);
  const to = await point(page, end);
  await page.mouse.move(from.client.x, from.client.y);
  await page.mouse.down();
  await page.mouse.move(to.client.x, to.client.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

test("local P0 layer visibility changes", async ({ page }) => {
  await openPreview(page);
  const visibility = page.getByLabel("레이어 표시: 건축 작업");
  await visibility.uncheck();
  await expect(visibility).not.toBeChecked();
});

test("local P0 layer lock changes", async ({ page }) => {
  await openPreview(page);
  const lock = page.getByLabel("레이어 잠금: 검토 주석");
  await lock.check();
  await expect(lock).toBeChecked();
});

test("local P0 primitive reloads from IndexedDB", async ({ page }) => {
  await openPreview(page);
  const initialIds = new Set(Object.keys((await snapshot(page)).objects));
  await drawClicks(page, "선 도구", [
    { x: 940, y: 160 },
    { x: 1110, y: 160 },
  ]);
  await expect
    .poll(
      async () =>
        Object.values((await snapshot(page)).objects).find(
          (object) =>
            object.geometry.type === "line" && !initialIds.has(object.id),
        )?.id,
    )
    .not.toBeUndefined();
  const authoredLineId = Object.values((await snapshot(page)).objects).find(
    (object) => object.geometry.type === "line" && !initialIds.has(object.id),
  )!.id;
  await page.getByRole("button", { name: "P4 로컬 저장 동기화" }).click();
  await expect(page.getByLabel("P4 mounted command result")).toHaveText(
    "로컬 저장 동기화됨",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect
    .poll(async () => Boolean((await snapshot(page)).objects[authoredLineId]))
    .toBe(true);
});

test("local P0-P2 vertical authors, structures, reuses, exports, and enforces viewer access", async ({
  page,
}) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page);
  const initial = await snapshot(page);
  const initialIds = new Set(Object.keys(initial.objects));
  await page.getByText("레이어 만들기", { exact: true }).click();
  await page.getByLabel("새 레이어 이름").fill("로컬 회귀 레이어");
  await page.getByRole("button", { name: "레이어 추가" }).click();
  await expect(page.getByLabel("레이어 이름: 로컬 회귀 레이어")).toBeVisible();
  await page.getByRole("button", { name: "P4 로컬 저장 동기화" }).click();
  await expect(page.getByLabel("P4 mounted command result")).toHaveText(
    "로컬 저장 동기화됨",
  );
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "폴리라인 도구" }).click();
  const polylineStart = await point(page, { x: 940, y: 230 });
  const polylineEnd = await point(page, { x: 1110, y: 300 });
  const surface = page.getByLabel(/도면 화면/);
  await surface.click({ position: polylineStart.local });
  await page.waitForTimeout(500);
  await surface.dblclick({ position: polylineEnd.local });
  await expect
    .poll(async () =>
      Object.values((await snapshot(page)).objects).some(
        (object) =>
          object.geometry.type === "polyline" && !initialIds.has(object.id),
      ),
    )
    .toBe(true);
  await drawClicks(page, "선 도구", [
    { x: 940, y: 160 },
    { x: 1110, y: 160 },
  ]);
  await drawDrag(page, "사각형 도구", { x: 940, y: 350 }, { x: 1060, y: 430 });
  await drawDrag(page, "원 도구", { x: 1000, y: 500 }, { x: 1070, y: 570 });
  await page.getByRole("button", { name: "텍스트 도구" }).click();
  const textPoint = await point(page, { x: 1010, y: 640 });
  await page.getByLabel(/도면 화면/).click({ position: textPoint.local });
  await page.getByLabel("도면 텍스트").fill("로컬 P0-P2 메모");
  await page.getByLabel("도면 텍스트").press("Enter");
  await drawClicks(page, "치수 도구", [
    { x: 940, y: 790 },
    { x: 1110, y: 790 },
  ]);

  await expect
    .poll(async () => {
      const current = await snapshot(page);
      return Object.keys(current.objects).filter((id) => !initialIds.has(id))
        .length;
    })
    .toBe(6);
  const afterAuthoring = await snapshot(page);
  const authoredEntries = Object.entries(afterAuthoring.objects).filter(
    ([id]) => !initialIds.has(id),
  );
  expect(authoredEntries).toHaveLength(6);
  expect(
    authoredEntries.map(([, object]) => object.geometry.type).sort(),
  ).toEqual(["circle", "dimension", "line", "polyline", "rectangle", "text"]);
  await page.getByRole("button", { name: "P4 로컬 저장 동기화" }).click();
  await expect(page.getByLabel("P4 mounted command result")).toHaveText(
    "로컬 저장 동기화됨",
  );
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "선택 도구" }).click();
  const rectanglePoint = await point(page, { x: 960, y: 370 });
  await page.getByLabel(/도면 화면/).click({ position: rectanglePoint.local });
  const inspector = page.getByRole("complementary", { name: "속성 검사기" });
  await inspector.getByRole("tab", { name: "객체", exact: true }).click();
  await inspector
    .getByLabel("객체 이름", { exact: true })
    .fill("로컬 검토 영역");
  await inspector.getByLabel("선 색상", { exact: true }).fill("#dc2626");
  await inspector.getByLabel("선 두께", { exact: true }).fill("3");
  await inspector.getByLabel("채우기", { exact: true }).fill("#fee2e2aa");
  await inspector
    .getByRole("button", { name: "속성 적용", exact: true })
    .click();

  const rectangleId = (await snapshot(page)).selectedIds[0];
  await expect
    .poll(async () => (await snapshot(page)).objects[rectangleId].name)
    .toBe("로컬 검토 영역");
  const beforeMove = await snapshot(page);
  await page.mouse.move(rectanglePoint.client.x, rectanglePoint.client.y);
  await page.mouse.down();
  await page.mouse.move(
    rectanglePoint.client.x + 20,
    rectanglePoint.client.y + 12,
    { steps: 4 },
  );
  await page.mouse.up();
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("ControlOrMeta+v");
  await expect
    .poll(async () => Object.keys((await snapshot(page)).objects).length)
    .toBe(Object.keys(beforeMove.objects).length + 1);
  await page.getByRole("button", { name: "선택 도구" }).click();
  const movedRectanglePoint = await point(page, { x: 985, y: 380 });
  await page
    .getByLabel(/도면 화면/)
    .click({ position: movedRectanglePoint.local });
  await expect
    .poll(async () => (await snapshot(page)).selectedIds.length)
    .toBe(1);
  await page.keyboard.press("Delete");
  await expect
    .poll(async () => Object.keys((await snapshot(page)).objects).length)
    .toBe(Object.keys(beforeMove.objects).length);
  await page.getByRole("button", { name: "실행 취소" }).click();
  await expect
    .poll(async () => Object.keys((await snapshot(page)).objects).length)
    .toBe(Object.keys(beforeMove.objects).length + 1);
  await page.getByRole("button", { name: "다시 실행" }).click();
  await expect
    .poll(async () => Object.keys((await snapshot(page)).objects).length)
    .toBe(Object.keys(beforeMove.objects).length);
  await page.getByRole("button", { name: "실행 취소" }).click();
  await expect
    .poll(async () => Object.keys((await snapshot(page)).objects).length)
    .toBe(Object.keys(beforeMove.objects).length + 1);

  await page.getByRole("tab", { name: "페이지·레이어" }).click();
  await page.getByRole("button", { name: /^.*층 모델 \(모델\)$/ }).click();
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-active-canvas-id",
    "00000000-0000-4000-8000-000000000021",
  );
  await page.getByRole("button", { name: /^평면 용지 \(용지\)$/ }).click();
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-active-canvas-id",
    initial.activeCanvasId ?? "",
  );

  await page.getByRole("tab", { name: "스타일" }).click();
  const styleName = page.getByLabel("스타일 이름: 검토 주석");
  await styleName.fill("검토 주석 로컬");
  await styleName
    .locator("xpath=ancestor::form")
    .getByRole("button", { name: "스타일 저장" })
    .click();
  await expect(page.getByLabel("스타일 이름: 검토 주석 로컬")).toBeVisible();

  await page.getByRole("tab", { name: "블록" }).click();
  await page.getByRole("button", { name: /단문 D-01 인스턴스 .*보기/ }).click();
  await page.getByRole("button", { name: "D-01 북측 인스턴스 선택" }).click();
  await expect(inspector.getByLabel("이름", { exact: true })).toHaveValue(
    "D-01 북측",
  );

  await page.getByRole("tab", { name: "속성" }).click();
  await expect(
    page
      .getByLabel("도면 도구 패널")
      .getByRole("heading", { name: "사용자 속성" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("도면 도구 패널").getByLabel("속성 이름", { exact: true }),
  ).toHaveValue("검토 상태");

  await page.getByRole("tab", { name: "표·일람" }).click();
  await expect(page.getByRole("table", { name: "창호 점검" })).toContainText(
    "메모",
  );

  await page.getByRole("button", { name: "내보내기" }).click();
  const dialog = page.getByRole("dialog", { name: "도면 내보내기" });
  await dialog.getByRole("radio", { name: "SVG" }).check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "다운로드" }).click(),
  ]);
  expect((await downloadBytes(download)).toString("utf8")).toContain("<svg");
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();

  await page.goto(`${previewPath}&bootstrapReadOnlyTest=1`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(page.getByRole("button", { name: "선 도구" })).toHaveCount(0);
});
