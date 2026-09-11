import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=projects&scope=sample",
    { waitUntil: "networkidle" },
  );
  await expect(page.locator("[data-project-card]")).toHaveCount(2);
  await page
    .getByLabel("프로젝트·자료 검색", { exact: true })
    .fill("없는 프로젝트");
  await expect(page.locator("[data-project-card]")).toHaveCount(0);
  await button("검색·필터 초기화").click();
  await page
    .getByLabel("프로젝트 작업 상태", { exact: true })
    .selectOption("approved");
  await expect(page.locator("[data-project-card]")).toHaveCount(0);
  await button("검색·필터 초기화").click();
  await button("건축 적산 열기").click();
  await expect(page).toHaveURL(/scenario=architecture/);
  await button("작업실 열기").click();
  await button("변경안 적용").click();
  await button("프로젝트 목록").click();
  await expect(page.locator("[data-project-card]").first()).toContainText("R2");
  await button("토목 현장 열기").click();
  await expect(page).toHaveURL(/scenario=civil/);
  await button("작업실 열기").click();
  await expect(
    page.getByLabel("도면·모델 작업 캔버스", { exact: true }),
  ).toContainText("C-301");
  await button("프로젝트 목록").click();
  await button("3D 검토 열기").click();
  await expect(page).toHaveURL(/scenario=ifc/);
  await button("프로젝트 목록").click();
  await expect(page).toHaveURL(/page=projects/);
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("[data-project-card]").first()).toContainText("R2");
  await page.screenshot({
    path: "/tmp/1hk-grouped-projects.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-grouped-projects-mobile.png",
    fullPage: true,
  });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS grouped project search/filter, three workflow entries, independent revisions and reload/mobile layout",
  );
} finally {
  await browser.close();
}
