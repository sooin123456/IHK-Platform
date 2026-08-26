import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Download, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace";
const artifactRoot = path.resolve(
  "..",
  ".superpowers/sdd/2026-08-26-drawing-workspace-p4",
);

async function openPreview(page: Page, query = "") {
  await page.goto(`${previewPath}${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(page.getByRole("tablist", { name: "도면 도구" })).toBeVisible();
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportBytes(page: Page, format: "SVG" | "PNG" | "PDF") {
  await page.getByRole("button", { name: "내보내기" }).click();
  const dialog = page.getByRole("dialog", { name: "도면 내보내기" });
  await dialog.getByRole("radio", { name: format }).check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "다운로드" }).click(),
  ]);
  const bytes = await downloadBytes(download);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  return bytes;
}

test("P4 populated preview exports every semantic object and survives offline IndexedDB recovery", async ({
  page,
  browser,
}) => {
  const ifcPath = path.resolve("../samples/sample.ifc");
  const ifcBefore = createHash("sha256")
    .update(await readFile(ifcPath))
    .digest("hex");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page);
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "7",
  );
  const semanticList = page.getByRole("list", { name: "건축 객체 목록" });
  await expect(semanticList).toContainText("회의실 외벽 · wall");
  await expect(semanticList).toContainText("D-101 · opening");
  await expect(semanticList).toContainText("W-101 · opening");
  await expect(semanticList).toContainText("회의실 · space");
  await expect(semanticList).toContainText("외부 포장 · area");
  await expect(semanticList).toContainText("A · grid");
  await expect(semanticList).toContainText("처마 호 · arc");
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(
    page.getByRole("table", { name: "Room schedule · 미리보기" }),
  ).toContainText("회의실");
  await expect(
    page.getByRole("table", { name: "Door schedule · 미리보기" }),
  ).toContainText("D-101");
  await expect(
    page.getByRole("table", { name: "Finish schedule · 미리보기" }),
  ).toContainText("카펫 타일");

  const svg = (await exportBytes(page, "SVG")).toString("utf8");
  expect(svg.match(/data-semantic-type=/g)).toHaveLength(7);
  expect(svg).toContain("101 · 회의실");
  expect(svg).toContain("외부 포장");
  expect(svg).toContain(">A</text>");
  const png = await exportBytes(page, "PNG");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  const trigger = page.getByRole("button", { name: "건축 객체" });
  await trigger.click();
  await page.getByRole("menuitem", { name: "벽 도구" }).click();
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  const x = Number(await surface.getAttribute("data-viewport-x"));
  const y = Number(await surface.getAttribute("data-viewport-y"));
  await surface.click({ position: { x: x + 80 * zoom, y: y + 400 * zoom } });
  await surface.click({ position: { x: x + 300 * zoom, y: y + 400 * zoom } });
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "8",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "8",
  );
  const restoreContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const restorePage = await restoreContext.newPage();
  await openPreview(restorePage);
  const restoreSurface = restorePage.getByLabel(/도면 화면/);
  await restorePage.getByRole("tab", { name: "변경 이력" }).click();
  await restorePage.getByRole("button", { name: /상태로 복원/ }).click();
  await expect(
    restorePage.getByText("Drawing checkpoint already matches current state."),
  ).toBeVisible();
  await expect(restoreSurface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "7",
  );
  await restorePage.screenshot({
    path: path.join(artifactRoot, "task-6-desktop.png"),
    fullPage: true,
  });
  await restorePage.setViewportSize({ width: 768, height: 1024 });
  await restorePage.screenshot({
    path: path.join(artifactRoot, "task-6-tablet.png"),
    fullPage: true,
  });
  await restorePage.setViewportSize({ width: 1440, height: 900 });
  const restoreTrigger = restorePage.getByRole("button", { name: "건축 객체" });
  await restoreTrigger.click();
  await restorePage.getByRole("menuitem", { name: "벽 도구" }).click();
  const restoreZoom = Number(
    await restoreSurface.getAttribute("data-viewport-zoom"),
  );
  const restoreX = Number(await restoreSurface.getAttribute("data-viewport-x"));
  const restoreY = Number(await restoreSurface.getAttribute("data-viewport-y"));
  await restoreSurface.click({
    position: {
      x: restoreX + 80 * restoreZoom,
      y: restoreY + 400 * restoreZoom,
    },
  });
  await restoreSurface.click({
    position: {
      x: restoreX + 300 * restoreZoom,
      y: restoreY + 400 * restoreZoom,
    },
  });
  await expect(restoreSurface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "8",
  );
  await restoreContext.close();
  expect(
    createHash("sha256")
      .update(await readFile(ifcPath))
      .digest("hex"),
  ).toBe(ifcBefore);
});

test("P4 awareness exposes semantic selection and lock while review freeze blocks writes", async ({
  page,
}) => {
  await openPreview(page, "?awarenessTest=1");
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute("data-remote-selection-count", "3");
  await expect(
    page.getByRole("status", { name: "객체 잠금 상태" }),
  ).toContainText("김도윤님이 D-101 편집 중");
  await openPreview(page, "?reviewFreezeTest=1");
  const review = page.getByRole("button", { name: "검토 요청" });
  await review.evaluate((button) => {
    const form = button.closest("form") as HTMLFormElement;
    form.requestSubmit = () => undefined;
    (button as HTMLButtonElement).click();
  });
  await expect(
    page.getByRole("textbox", { name: "새 레이어 이름" }),
  ).toBeHidden();
  await expect(page.getByRole("button", { name: "건축 객체" })).toBeHidden();
});
