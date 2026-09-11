import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=rates&scenario=architecture&scope=sample",
    { waitUntil: "networkidle" },
  );
  const section = page.getByRole("region", { name: "단가표 버전 관리" });
  await expect(section.getByLabel("단가 코드", { exact: true })).toBeVisible();
  await section.getByLabel("단가 코드", { exact: true }).fill("FIN-A");
  await section.getByLabel("단가 품목명", { exact: true }).fill("바닥 마감");
  await section.getByLabel("단가 단위", { exact: true }).selectOption("m²");
  await section.getByLabel("단가 금액", { exact: true }).fill("45000");
  await expect(
    section.getByRole("button", { name: "새 단가 버전 보관", exact: true }),
  ).toBeDisabled();
  await section.getByLabel("단가 출처", { exact: true }).fill("단가표 1쪽");
  await section
    .getByRole("button", { name: "새 단가 버전 보관", exact: true })
    .click();
  await section
    .getByRole("button", { name: "이 버전 단가 적용", exact: true })
    .click();
  await expect(section).toContainText("현재 연결: FIN-A · v1");
  await section
    .getByRole("button", { name: "수정본 작성", exact: true })
    .click();
  await section.getByLabel("단가 금액", { exact: true }).fill("47000");
  await section
    .getByRole("button", { name: "새 단가 버전 보관", exact: true })
    .click();
  await expect(section).toContainText("현재 연결: FIN-A · v1");
  await expect(section).toContainText("47,000");
  await page.reload();
  await expect(section).toContainText("현재 연결: FIN-A · v1");
  await section.locator("summary").filter({ hasText: "이전 버전" }).click();
  await expect(section).toContainText("45,000");
  await page
    .getByRole("button", { name: "데모 시나리오", exact: true })
    .click();
  await page.locator(".flow-demo select").nth(1).selectOption("viewer");
  await expect(
    section.getByRole("button", { name: "새 단가 버전 보관", exact: true }),
  ).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-pricebook-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS catalog registration, immutable revisions, pinned applied rate, reload, role guard and mobile",
  );
} finally {
  await browser.close();
}
