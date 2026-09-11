import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const library = "http://127.0.0.1:4181/workspace-preview/flow?page=library";
  await page.goto(library, { waitUntil: "networkidle" });
  await expect(button("이 템플릿으로 작업 만들기")).toBeDisabled();
  await expect(
    page.getByRole("img", { name: "사무실 배치 템플릿 미리보기" }),
  ).toBeVisible();
  await page.getByLabel("템플릿 작업 이름").fill("사무실 A");
  await button("이 템플릿으로 작업 만들기").click();
  await expect(page).toHaveURL(/blank=/);
  const first = page.url();
  await expect(
    page.getByRole("region", { name: "원본 없는 빈 작업실" }),
  ).toContainText("4개 구상 객체");
  await button("회의실 구상 객체").click();
  await page.getByLabel("구상 객체 이름", { exact: true }).fill("대회의실");
  await page.goto(library, { waitUntil: "networkidle" });
  await page.getByLabel("템플릿 작업 이름").fill("사무실 B");
  await button("이 템플릿으로 작업 만들기").click();
  await expect(page).toHaveURL(/blank=/);
  expect(page.url()).not.toBe(first);
  await expect(button("회의실 구상 객체")).toBeVisible();
  await expect(button("대회의실 구상 객체")).toHaveCount(0);
  await page.goto(library, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /현장 작업 구역.*작업·자재/ }).click();
  await expect(
    page.getByRole("img", { name: "현장 작업 구역 템플릿 미리보기" }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const titleBox = await page.getByRole('button', {name: /현장 작업 구역.*작업·자재/}).locator('strong').boundingBox();
  expect(titleBox.height).toBeLessThan(30);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-template-library-mobile.png",
    fullPage: true,
  });
  await page.getByLabel("템플릿 작업 이름").fill("현장 구상");
  await button("이 템플릿으로 작업 만들기").click();
  await expect(page).toHaveURL(/blank=/);
  await expect(
    page.getByRole("region", { name: "원본 없는 빈 작업실" }),
  ).toContainText("3개 구상 객체");
  await page.reload({ waitUntil: "networkidle" });
  await expect(button("자재 적치 구상 객체")).toBeVisible();
  await button("내 빈 작업 목록").click();
  await button("사무실 A 열기").click();
  await expect(page).toHaveURL(first);
  await expect(button("대회의실 구상 객체")).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    "PASS two template previews, named independent copies, edit isolation, refresh/reopen and mobile layout",
  );
} finally {
  await browser.close();
}
