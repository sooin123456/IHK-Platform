import { chromium, expect } from "@playwright/test";

// Catches missing keyboard placement, repeat-created duplicates and read-only edits.
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", { waitUntil: "networkidle" });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("키보드 작성");
  await page.getByRole("button", { name: "빈 작업실 열기", exact: true }).press("Enter");
  const canvas = page.getByRole("img", { name: "빈 작업 캔버스" });
  await page.getByRole("button", { name: "원 구상 도구", exact: true }).press("Enter");
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect(canvas.getByRole("button")).toHaveCount(1);
  await expect(canvas.locator("circle")).toHaveCount(1);
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue("340");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue("350");
  await page.keyboard.press("Enter");
  await expect(canvas.getByRole("button")).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect(canvas.getByRole("button")).toHaveCount(0);
  await page.keyboard.press("Control+Shift+z");
  await expect(canvas.getByRole("button")).toHaveCount(1);
  await page.getByRole("button", { name: "텍스트 구상 도구", exact: true }).press("Enter");
  await canvas.focus();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Enter");
  await expect(canvas.getByRole("button")).toHaveCount(1);
  await page.getByLabel("도면 검토 체험 역할").selectOption("viewer");
  await canvas.focus();
  await page.keyboard.press("Enter");
  await expect(canvas.getByRole("button")).toHaveCount(1);
  expect(errors).toEqual([]);
  console.log("PASS keyboard creation, geometry, movement, history, cancellation and read-only guard");
} finally {
  await browser.close();
}
