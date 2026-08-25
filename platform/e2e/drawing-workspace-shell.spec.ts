import { expect, test, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace";
test.describe.configure({ timeout: 30_000 });

async function openPreview(page: Page) {
  page.setDefaultTimeout(5_000);
  await page.goto(previewPath, {
    timeout: 15_000,
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByRole("tablist", { name: "도면 도구" })).toBeVisible();
}

test("local preview keeps its realtime indicator connected without a Supabase request", async ({
  page,
}) => {
  const supabaseRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).port === "54321")
      supabaseRequests.push(request.url());
  });
  await openPreview(page);

  await expect(
    page.getByRole("status", { name: "실시간 상태: 실시간 연결됨" }),
  ).toBeVisible();
  expect(supabaseRequests).toEqual([]);
});

test("local preview click selects the Style tab and reveals its panel", async ({
  page,
}) => {
  await openPreview(page);

  const structureTab = page.getByRole("tab", { name: "페이지·레이어" });
  const stylesTab = page.getByRole("tab", { name: "스타일" });
  const structurePanel = page.locator("#drawing-panel-structure");
  const stylesPanel = page.locator("#drawing-panel-styles");

  await expect(structureTab).toHaveAttribute("aria-selected", "true");
  await expect(structurePanel).toBeVisible();
  await expect(stylesPanel).toBeHidden();

  await expect(async () => {
    await stylesTab.click();
    await expect(stylesTab).toHaveAttribute("aria-selected", "true", {
      timeout: 250,
    });
  }).toPass({ timeout: 10_000 });

  await expect(structureTab).toHaveAttribute("aria-selected", "false");
  await expect(stylesPanel).toBeVisible();
  await expect(structurePanel).toBeHidden();
});

test("local preview Arrow, Home, and End keys select and focus their target tabs", async ({
  page,
}) => {
  await openPreview(page);

  const structureTab = page.getByRole("tab", { name: "페이지·레이어" });
  const stylesTab = page.getByRole("tab", { name: "스타일" });
  const blocksTab = page.getByRole("tab", { name: "블록" });

  await expect(async () => {
    await structureTab.focus();
    await structureTab.press("ArrowRight");
    await expect(stylesTab).toHaveAttribute("aria-selected", "true", {
      timeout: 250,
    });
    await expect(stylesTab).toBeFocused({ timeout: 250 });
  }).toPass({ timeout: 10_000 });
  await expect(page.locator("#drawing-panel-styles")).toBeVisible();

  await stylesTab.press("End");
  await expect(blocksTab).toHaveAttribute("aria-selected", "true");
  await expect(blocksTab).toBeFocused();
  await expect(page.locator("#drawing-panel-blocks")).toBeVisible();

  await blocksTab.press("Home");
  await expect(structureTab).toHaveAttribute("aria-selected", "true");
  await expect(structureTab).toBeFocused();
  await expect(page.locator("#drawing-panel-structure")).toBeVisible();
});

test("hydrated export dialog explains background availability and cancels one gated run", async ({
  page,
}) => {
  await openPreview(page);
  const dialog = page.getByRole("dialog", { name: "도면 내보내기" });
  await expect(async () => {
    await page.getByRole("button", { name: "내보내기" }).click();
    await expect(dialog).toBeVisible({ timeout: 250 });
  }).toPass({ timeout: 10_000 });

  await dialog.getByRole("radio", { name: "PNG" }).check();
  const includeBackground = dialog.getByRole("checkbox", {
    name: "PDF 배경 포함",
  });
  await expect(includeBackground).toBeDisabled();
  await expect(dialog).toContainText(
    "현재 canvas에는 포함할 PDF 배경이 없습니다.",
  );

  await dialog.getByRole("radio", { name: "PDF" }).check();
  const download = dialog.getByRole("button", { name: "다운로드" });
  await download.evaluate((button) => {
    (button as HTMLElement).click();
    (button as HTMLElement).click();
  });
  await expect(dialog.getByRole("button", { name: "취소" })).toBeVisible();
  await dialog.getByRole("button", { name: "취소" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "내보내기" }).click();
  await expect(
    page.getByRole("dialog", { name: "도면 내보내기" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "다운로드" })).toBeEnabled();
});

test("1280px structure panel keeps disabled explanations readable below controls", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPreview(page);

  const panel = page.locator("#drawing-panel-structure");
  const explanations = panel.locator(
    'p[id^="page-delete-reason-"], p[id^="canvas-delete-reason-"], p[id^="canvas-order-reason-"]',
  );
  await expect(explanations).not.toHaveCount(0);

  const layout = await panel.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);

  const rectangles = await explanations.evaluateAll((nodes) =>
    nodes.map((node) => {
      const explanation = node.getBoundingClientRect();
      const input = node.closest("div.rounded-md")?.querySelector("input");
      const controls = input?.getBoundingClientRect();
      return {
        explanation: {
          width: explanation.width,
          y: explanation.y,
        },
        controls: controls
          ? { height: controls.height, y: controls.y }
          : null,
      };
    }),
  );
  for (const rectangle of rectangles) {
    expect(rectangle.controls).not.toBeNull();
    expect(rectangle.explanation.width).toBeGreaterThanOrEqual(120);
    expect(rectangle.explanation.y).toBeGreaterThanOrEqual(
      rectangle.controls!.y + rectangle.controls!.height,
    );
  }
});
