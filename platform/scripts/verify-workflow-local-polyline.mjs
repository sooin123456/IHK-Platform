import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("폴리라인 검토");
  await button("빈 작업실 열기").click();
  await button("폴리라인 구상 도구").click();
  await expect(button("폴리라인 완료")).toBeDisabled();
  const canvas = page.getByRole("img", { name: "빈 작업 캔버스" });
  await canvas.click({ position: { x: 80, y: 80 } });
  await canvas.click({ position: { x: 200, y: 80 } });
  await canvas.click({ position: { x: 200, y: 160 } });
  await button("마지막 점 취소").click();
  await expect(
    page.getByRole("region", { name: "폴리라인 작성" }),
  ).toContainText("2개 점");
  await canvas.click({ position: { x: 200, y: 160 } });
  await button("폴리라인 완료").click();
  const shape = button("폴리라인 표시 구상 객체");
  await expect(shape.locator("polyline")).toHaveCount(1);
  await page.getByLabel("폴리라인 닫기", { exact: true }).check();
  await expect(shape.locator("polygon")).toHaveCount(1);
  await button("구상 실행 취소").click();
  await expect(shape.locator("polyline")).toHaveCount(1);
  await button("구상 다시 실행").click();
  await expect(shape.locator("polygon")).toHaveCount(1);
  await shape.click();
  await page.getByLabel("구상 너비", { exact: true }).fill("300");
  await page.getByText("꼭짓점 편집", { exact: true }).click();
  await page.getByLabel("점 2 X", { exact: true }).fill("150");
  await button("선택 구상 복사").click();
  await expect(
    button("폴리라인 표시 복사 구상 객체").locator("polygon"),
  ).toHaveCount(1);
  await button("폴리라인 구상 도구").click();
  await canvas.click({ position: { x: 30, y: 30 } });
  await button("폴리라인 취소").click();
  await expect(canvas.getByRole("button")).toHaveCount(2);
  await page.reload();
  await expect(shape.locator("polygon")).toHaveCount(1);
  await page.getByLabel('선택할 객체',{exact:true}).selectOption({label:'1 · 폴리라인 표시'});
  await page.getByText("꼭짓점 편집", { exact: true }).click();
  await expect(page.getByLabel("점 2 X", { exact: true })).toHaveValue("150");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-local-polyline.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS click polyline, point undo/cancel, closed path, vertex edit, copy, history and reload/mobile",
  );
} finally {
  await browser.close();
}
