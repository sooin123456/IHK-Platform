import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=settings&scenario=architecture",
    { waitUntil: "networkidle" },
  );
  const section = page.getByRole("region", { name: "구성원 역할 배치안" });
  await expect(
    section.getByLabel("구성원 이름", { exact: true }),
  ).toBeVisible();
  await section.getByLabel("구성원 이름", { exact: true }).fill("현장 검토자");
  await section.getByLabel("구성원 이메일", { exact: true }).fill("invalid");
  await expect(
    section.getByRole("button", { name: "구성원 배치안 보관", exact: true }),
  ).toBeDisabled();
  await section
    .getByLabel("구성원 이메일", { exact: true })
    .fill("review@example.test");
  await section
    .getByLabel("계획 역할", { exact: true })
    .selectOption("reviewer");
  await section
    .getByRole("button", { name: "구성원 배치안 보관", exact: true })
    .click();
  const row = section
    .locator("article")
    .filter({ hasText: "review@example.test" });
  await expect(row).toContainText("검토자");
  await page.reload();
  await expect(row).toContainText("현장 검토자");
  await row.getByRole("button", { name: "배치안 수정", exact: true }).click();
  await section.getByLabel("계획 역할", { exact: true }).selectOption("viewer");
  await section
    .getByRole("button", { name: "구성원 배치안 보관", exact: true })
    .click();
  await expect(row).toContainText("보기 전용");
  await page
    .getByRole("button", { name: "데모 시나리오", exact: true })
    .click();
  await page.locator(".flow-demo select").nth(1).selectOption("viewer");
  await expect(
    section.getByRole("button", { name: "구성원 배치안 보관", exact: true }),
  ).toBeDisabled();
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=settings&scenario=civil",
    { waitUntil: "networkidle" },
  );
  await expect(
    section.locator("article").filter({ hasText: "review@example.test" }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-members-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS member plan validation, add/edit/restore, viewer guard, scenario isolation and mobile",
  );
} finally {
  await browser.close();
}
