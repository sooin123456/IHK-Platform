import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
const pdf = await PDFDocument.create();
pdf.addPage([800, 520]);
const buffer = Buffer.from(await pdf.save());
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const base = "http://127.0.0.1:4181/workspace-preview/flow";
  await page.goto(`${base}?page=rates&scenario=architecture`, {
    waitUntil: "networkidle",
  });
  const catalog = page.getByRole("region", { name: "단가표 버전 관리" });
  await catalog.getByLabel("단가 코드", { exact: true }).fill("LOCAL-A");
  await catalog.getByLabel("단가 품목명", { exact: true }).fill("현장 바닥");
  await catalog.getByLabel("단가 단위", { exact: true }).selectOption("m²");
  await catalog.getByLabel("단가 금액", { exact: true }).fill("45000");
  await catalog
    .getByLabel("단가 출처", { exact: true })
    .fill("현장 단가표 1쪽");
  await catalog
    .getByRole("button", { name: "새 단가 버전 보관", exact: true })
    .click();
  await page.goto(`${base}?page=start&scenario=architecture`, {waitUntil:'networkidle'});
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("등록 단가 연결");
  await page
    .getByRole("button", { name: "빈 작업실 열기", exact: true })
    .click();
  await expect(page).toHaveURL(/blank=/);
  await page
    .getByLabel("작업실 PDF 선택", { exact: true })
    .setInputFiles({ name: "rates.pdf", mimeType: "application/pdf", buffer });
  const draw = page.getByRole("button", {
    name: "사각형 구상 도구",
    exact: true,
  });
  await expect(draw).toBeEnabled();
  await draw.click();
  await page.getByRole("img", { name: "빈 작업 캔버스" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("수동 원수량", { exact: true }).fill("10");
  await page
    .getByRole("button", { name: "단가표에서 선택", exact: true })
    .click();
  await page
    .getByRole("button", { name: "현장 바닥 v1 등록 단가 선택", exact: true })
    .click();
  await expect(page.getByLabel("단가 원", { exact: true })).toHaveValue(
    "45000",
  );
  await page.getByLabel("수량 입력 근거", { exact: true }).fill("면적표 10");
  await page
    .getByRole("button", { name: "수량 근거 연결", exact: true })
    .click();
  await page
    .getByRole("button", { name: "내 수량·내역 보기", exact: true })
    .click();
  const rows = page.getByRole("region", { name: "내 도면 수량·내역" });
  await expect(rows).toContainText("450,000");
  await expect(rows).toContainText("LOCAL-A · v1");
  const quantityUrl = page.url();
  await page.goto(`${base}?page=rates&scenario=architecture`);
  await catalog
    .getByRole("button", { name: "수정본 작성", exact: true })
    .click();
  await catalog.getByLabel("단가 금액", { exact: true }).fill("47000");
  await catalog
    .getByRole("button", { name: "새 단가 버전 보관", exact: true })
    .click();
  await page.goto(quantityUrl);
  await expect(rows).toContainText("450,000");
  await expect(rows).toContainText("LOCAL-A · v1");
  await page.reload();
  await expect(rows).toContainText("현장 단가표 1쪽");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-local-pricebook.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS registered rate to local PDF quantity, frozen v1 after v2, reload and mobile",
  );
} finally {
  await browser.close();
}
