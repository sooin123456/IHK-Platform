import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const canvas = () => page.getByRole("img", { name: "빈 작업 캔버스" });
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("표시 도면");
  await button("빈 작업실 열기").click();
  for (const [tool, x, y] of [
    ["선", 120, 100],
    ["원", 350, 100],
    ["텍스트", 120, 300],
    ["사각형", 350, 300],
  ]) {
    await button(`${tool} 구상 도구`).click();
    await canvas().click({ position: { x, y } });
  }
  await expect(canvas().getByRole("button")).toHaveCount(4);
  await button("선 표시 구상 객체").click();
  await page.getByLabel("구상 선 색").fill("#cc1122");
  await page.getByLabel("구상 선 굵기").fill("5");
  await expect(button("선 표시 구상 객체").locator("line")).toHaveAttribute(
    "stroke",
    "#cc1122",
  );
  await expect(button("선 표시 구상 객체").locator("line")).toHaveAttribute(
    "stroke-width",
    "5",
  );
  await button("원 표시 구상 객체").click();
  await page.getByLabel("구상 채움 없음").check();
  await expect(button("원 표시 구상 객체").locator("circle")).toHaveAttribute(
    "fill",
    "none",
  );
  await button("구상 실행 취소").click();
  await expect(button("원 표시 구상 객체").locator("circle")).toHaveAttribute(
    "fill",
    "#ede9fe",
  );
  await button("구상 다시 실행").click();
  await expect(button("원 표시 구상 객체").locator("circle")).toHaveAttribute(
    "fill",
    "none",
  );
  await button("텍스트 입력 구상 객체").click();
  await page
    .getByLabel("구상 객체 이름", { exact: true })
    .fill("시공 전 현장 치수 확인");
  await expect(
    button("시공 전 현장 치수 확인 구상 객체").locator("foreignObject"),
  ).toContainText("시공 전 현장 치수 확인");
  await page.reload({ waitUntil: "networkidle" });
  await expect(canvas().getByRole("button")).toHaveCount(4);
  await expect(button("선 표시 구상 객체").locator("line")).toHaveAttribute(
    "stroke",
    "#cc1122",
  );
  await expect(button("원 표시 구상 객체").locator("circle")).toHaveAttribute(
    "fill",
    "none",
  );
  await button("시공 전 현장 치수 확인 구상 객체").click();
  await expect(page.getByLabel("구상 객체 이름", { exact: true })).toHaveValue(
    "시공 전 현장 치수 확인",
  );
  await page.screenshot({ path: "/tmp/1hk-draft-tools.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-draft-tools-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS four geometry kinds, color/width/fill, style undo/redo, text and reload/mobile",
  );
} finally {
  await browser.close();
}
