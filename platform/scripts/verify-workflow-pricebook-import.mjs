import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=rates&scenario=architecture",
    { waitUntil: "networkidle" },
  );
  await page
    .getByRole("button", { name: "CSV 단가표 가져오기", exact: true })
    .click();
  const input = page.getByLabel("단가 CSV 내용", { exact: true });
  const csv =
    '코드,품목명,단위,단가,출처\nFIN-A,"바닥, 마감",m²,45000,회사표 1쪽';
  await input.fill(csv + "\nERR,오류,m²,-2,회사표");
  await page
    .getByRole("button", { name: "가져오기 미리보기", exact: true })
    .click();
  const preview = page.getByRole("region", { name: "단가 가져오기 미리보기" });
  await expect(preview).toContainText("3행");
  await expect(
    page.getByRole("button", { name: "전체 새 버전 보관", exact: true }),
  ).toBeDisabled();
  await input.fill(csv);
  await expect(preview).toHaveCount(0);
  await page
    .getByRole("button", { name: "가져오기 미리보기", exact: true })
    .click();
  await expect(preview).toContainText("FIN-A · v1");
  await page
    .getByRole("button", { name: "전체 새 버전 보관", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "단가표 버전 관리" }),
  ).toContainText("바닥, 마감 · FIN-A · v1");
  await expect(input).toHaveValue("");
  await input.fill(csv.replace("45000", "47000"));
  await page
    .getByRole("button", { name: "가져오기 미리보기", exact: true })
    .click();
  await expect(preview).toContainText("FIN-A · v2");
  await page
    .getByRole("button", { name: "전체 새 버전 보관", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("region", { name: "단가표 버전 관리" }),
  ).toContainText("바닥, 마감 · FIN-A · v2");
  await page
    .getByRole("button", { name: "CSV 단가표 가져오기", exact: true })
    .click();
  await input.fill(csv);
  await page
    .getByRole("button", { name: "가져오기 미리보기", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await preview.screenshot({ path: "/tmp/1hk-pricebook-import-mobile.png" });
  await page
    .getByRole("button", { name: "데모 시나리오", exact: true })
    .click();
  await page.locator(".flow-demo select").nth(1).selectOption("viewer");
  await expect(
    page.getByRole("button", { name: "전체 새 버전 보관", exact: true }),
  ).toBeDisabled();
  expect(errors).toEqual([]);
  console.log(
    "PASS CSV error recovery, staged preview, append versions, reload, viewer and mobile",
  );
} finally {
  await browser.close();
}
