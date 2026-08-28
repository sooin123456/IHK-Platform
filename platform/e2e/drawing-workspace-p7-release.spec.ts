import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace";
const artifactRoot = path.resolve(
  process.cwd(),
  "../.superpowers/sdd/2026-08-28-drawing-workspace-p7",
);

async function openCurrentWorkspace(page: Page, requireVisibleIfc = true) {
  await page.goto(previewPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(page.getByRole("tablist", { name: "도면 도구" })).toBeVisible();
  await expect(page.getByText(/P4 공동 편집 미리보기/)).toHaveCount(0);
  if (requireVisibleIfc)
    await expect(
      page.getByRole("complementary", { name: "IFC 3D 원본" }),
    ).toBeVisible();
  await expect(page.getByLabel(/도면 화면/)).toBeVisible();
}

async function layoutEvidence(page: Page) {
  return page.evaluate(() => ({
    viewport: {
      width: document.documentElement.clientWidth,
      height: document.documentElement.clientHeight,
    },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    },
    canvases: document.querySelectorAll(".konvajs-content > canvas").length,
    drawing: document
      .querySelector('[aria-label="도면 캔버스"]')
      ?.getBoundingClientRect()
      .toJSON(),
  }));
}

test("current desktop release view is canvas-first, split-source capable, and keyboard recoverable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openCurrentWorkspace(page);
  const canvas = page.getByRole("region", { name: "도면 캔버스" });
  const evidence = await layoutEvidence(page);
  expect(evidence.document.width).toBeLessThanOrEqual(evidence.viewport.width);
  expect(evidence.document.height).toBeLessThanOrEqual(
    evidence.viewport.height + 1,
  );
  expect(evidence.drawing?.width).toBeGreaterThan(900);
  expect(evidence.drawing?.height).toBeGreaterThan(600);
  expect(evidence.canvases).toBeGreaterThanOrEqual(3);

  const tools = page.getByRole("complementary", { name: "도면 도구 패널" });
  await page.keyboard.press("[");
  await expect(tools).toBeHidden();
  await page.keyboard.press("[");
  await expect(tools).toBeVisible();
  await page.keyboard.press("]");
  await expect(
    page.getByRole("complementary", { name: "속성 검사기" }),
  ).toBeVisible();
  await page.keyboard.press("]");
  await expect(
    page.getByRole("complementary", { name: "속성 검사기" }),
  ).toBeHidden();
  await expect(canvas).toBeVisible();
  await page.screenshot({
    path: path.join(artifactRoot, "task-7-desktop-1280x720.png"),
    animations: "disabled",
  });
});

for (const viewport of [
  { name: "portrait", width: 768, height: 1024 },
  { name: "landscape", width: 1024, height: 768 },
] as const) {
  test(`tablet ${viewport.name} keeps one tool surface, touch targets, focus, and canvas`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await openCurrentWorkspace(page, viewport.width >= 1024);
    const drawing = page.getByLabel(/도면 화면/);
    const tools = page.getByRole("complementary", { name: "도면 도구 패널" });
    const inspector = page.getByRole("complementary", { name: "속성 검사기" });
    await expect(drawing).toBeVisible();
    await expect(tools).toBeVisible();
    await expect(inspector).toBeHidden();
    for (const target of await tools.getByRole("tab").all()) {
      const box = await target.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await page.getByRole("button", { name: "속성 검사기 열기" }).click();
    await expect(inspector).toBeVisible();
    await expect(tools).toBeHidden();
    await page.getByRole("button", { name: "속성 검사기 숨기기" }).click();
    await expect(inspector).toBeHidden();
    await expect(drawing).toBeFocused();
    const evidence = await layoutEvidence(page);
    expect(evidence.document.width).toBeLessThanOrEqual(
      evidence.viewport.width,
    );
    expect(evidence.document.height).toBeLessThanOrEqual(
      evidence.viewport.height + 1,
    );
    expect(evidence.canvases).toBeGreaterThanOrEqual(3);
    await page.screenshot({
      path: path.join(
        artifactRoot,
        `task-7-tablet-${viewport.name}-${viewport.width}x${viewport.height}.png`,
      ),
      animations: "disabled",
    });
  });
}
