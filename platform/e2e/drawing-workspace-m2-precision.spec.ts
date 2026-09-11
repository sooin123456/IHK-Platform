import { expect, test, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace?verticalTest=1";
const wallId = "00000000-0000-4000-8000-000000000100";
const dimensionId = "00000000-0000-4000-8000-000000000075";

async function openPreview(page: Page) {
  await page.goto(previewPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText(
    "준비됨",
    { timeout: 20_000 },
  );
  await expect(page.getByLabel(/도면 화면/)).toBeVisible();
}

async function canvasPoint(page: Page, world: { x: number; y: number }) {
  const surface = page.getByLabel(/도면 화면/);
  const bounds = await surface.boundingBox();
  if (!bounds) throw new Error("Drawing surface has no layout box");
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  return {
    x: Number(await surface.getAttribute("data-viewport-x")) + world.x * zoom,
    y: Number(await surface.getAttribute("data-viewport-y")) + world.y * zoom,
  };
}

async function previewState(page: Page) {
  return JSON.parse(
    (await page.getByLabel("P4 mounted workspace snapshot").textContent())!,
  );
}

test("precision inspector rejects an invalid hosted wall and stores exact wall and dimension millimeters", async ({
  page,
}) => {
  page.setDefaultTimeout(10_000);
  await openPreview(page);
  const surface = page.getByLabel(/도면 화면/);
  const inspector = page.getByRole("complementary", { name: "속성 검사기" });

  await page.getByRole("button", { name: "선택 도구" }).click();
  await surface.click({ position: await canvasPoint(page, { x: 500, y: 720 }) });
  await expect(surface).toHaveAttribute("data-selected-object-id", wallId);
  await inspector.getByRole("tab", { name: "객체" }).click();
  await expect(inspector.getByRole("heading", { name: "정밀 위치" })).toBeVisible();

  await inspector.getByLabel("끝 X", { exact: true }).fill("300");
  await inspector.getByRole("button", { name: "정밀 위치 적용" }).click();
  await expect(inspector.getByRole("alert")).toContainText(/Opening .* invalid/);
  expect((await previewState(page)).objects[wallId].geometry.end.x).toBe(900);

  await inspector.getByLabel("끝 X", { exact: true }).fill("950.000001");
  await inspector.getByRole("button", { name: "정밀 위치 적용" }).click();
  await expect
    .poll(async () => (await previewState(page)).objects[wallId].geometry.end.x)
    .toBe(950.000001);

  await surface.click({ position: await canvasPoint(page, { x: 440, y: 654 }) });
  await expect(surface).toHaveAttribute("data-selected-object-id", dimensionId);
  await inspector.getByLabel("치수 오프셋", { exact: true }).fill("-32.5");
  await inspector.getByRole("button", { name: "정밀 위치 적용" }).click();
  await expect
    .poll(
      async () =>
        (await previewState(page)).objects[dimensionId].geometry.offset,
    )
    .toBe(-32.5);
});
