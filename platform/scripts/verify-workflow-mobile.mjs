import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("모바일 도면");
  await button("빈 작업실 열기").click();
  const canvas = page.getByRole("img", { name: "빈 작업 캔버스" });
  expect((await canvas.boundingBox()).y).toBeLessThan(560);
  const inspector = page.locator(".flow-inspector-disclosure");
  await expect(inspector).not.toHaveAttribute("open", "");
  await button("사각형 구상 도구").click();
  await canvas.click({ position: { x: 150, y: 100 } });
  await expect(inspector).toHaveAttribute("open", "");
  await expect(
    page.getByLabel("구상 객체 이름", { exact: true }),
  ).toBeVisible();
  await inspector.locator("summary").click();
  await expect(inspector).not.toHaveAttribute("open", "");
  await page.getByText("원본 보관·재연결 안내", { exact: true }).click();
  await expect(
    page.getByText(/파일은 서버에 업로드하지 않습니다/),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByText("원본 보관·재연결 안내", { exact: true }).click();
  await page.screenshot({
    path: "/tmp/1hk-mobile-canvas-first.png",
    fullPage: true,
  });
  console.log(
    "PASS mobile canvas above fold, selectable tools, auto-open inspector, manual collapse and source disclosure",
  );
} finally {
  await browser.close();
}
