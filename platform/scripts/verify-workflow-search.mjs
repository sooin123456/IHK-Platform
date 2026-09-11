import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("검색 대상 도면");
  await button("빈 작업실 열기").click();
  await expect(page).toHaveURL(/blank=/);
  const documentUrl = page.url();
  await button("화면·작업 검색").click();
  const dialog = page.getByRole("dialog", { name: "화면·작업 검색" }),
    input = dialog.getByRole("textbox");
  await input.fill("없는 내용");
  await expect(dialog).toContainText("검색 결과가 없습니다");
  await input.fill("검토");
  await dialog
    .getByRole("button", { name: "화면: 검토·승인함", exact: true })
    .click();
  await expect(page).toHaveURL(/page=reviews/);
  await expect(dialog).not.toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await input.fill("검색 대상 도면");
  await dialog
    .getByRole("button", { name: "작업: 검색 대상 도면", exact: true })
    .click();
  await expect(page).toHaveURL(documentUrl);
  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await button("화면·작업 검색").click();
  await input.fill("납품");
  await expect(
    dialog.getByRole("button", { name: /화면: 납품/ }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-workflow-search-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS global screen/local-document search, no results, exact return, keyboard/Escape and mobile",
  );
} finally {
  await browser.close();
}
