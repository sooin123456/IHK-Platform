import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
const pdf = await PDFDocument.create();
pdf.addPage([800, 520]);
const buffer = Buffer.from(await pdf.save());
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
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("크기 회전 검토");
  await button("빈 작업실 열기").click();
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "frame.pdf", mimeType: "application/pdf", buffer });
  await expect(button("사각형 구상 도구")).toBeEnabled();
  await button("사각형 구상 도구").click();
  await page.getByRole("img", { name: "빈 작업 캔버스" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("구상 너비", { exact: true }).fill("500");
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue(
    "300",
  );
  await page.getByLabel("구상 높이", { exact: true }).fill("200");
  await page.getByLabel("구상 회전", { exact: true }).fill("30");
  const shape = button("구상 영역 구상 객체");
  await expect(shape.locator("g").first()).toHaveAttribute(
    "transform",
    /rotate\(30 /,
  );
  await button("구상 실행 취소").click();
  await expect(shape.locator("g").first()).toHaveAttribute(
    "transform",
    /rotate\(0 /,
  );
  await button("구상 다시 실행").click();
  await expect(shape.locator("g").first()).toHaveAttribute(
    "transform",
    /rotate\(30 /,
  );
  await shape.click();
  await button("선택 구상 복사").click();
  await expect(page.getByLabel("구상 너비", { exact: true })).toHaveValue(
    "500",
  );
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue(
    "300",
  );
  await button("선택 구상 삭제").click();
  await shape.click();
  await page
    .getByLabel("도면 검토 의견", { exact: true })
    .fill("크기와 각도 확인");
  await button("선택 객체 검토 요청").click();
  await expect(page.getByLabel("구상 너비", { exact: true })).toBeDisabled();
  await page
    .getByLabel("도면 검토 체험 역할", { exact: true })
    .selectOption("reviewer");
  await page.getByLabel("도면 검토 의견", { exact: true }).fill("검토 완료");
  await button("검토 완료하기").click();
  await page
    .getByLabel("도면 검토 체험 역할", { exact: true })
    .selectOption("approver");
  await page.getByLabel("도면 검토 의견", { exact: true }).fill("승인");
  await button("이 개정 승인하기").click();
  await page.reload();
  await page
    .locator("input[type=file]")
    .setInputFiles({ name: "frame.pdf", mimeType: "application/pdf", buffer });
  await expect(shape).toBeVisible();
  await shape.click();
  await expect(page.getByLabel("구상 너비", { exact: true })).toHaveValue(
    "500",
  );
  await expect(page.getByLabel("구상 회전", { exact: true })).toHaveValue("30");
  await expect(page.getByLabel("구상 회전", { exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-draft-frame-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS size/rotation, bounds, copy, undo/redo, review lock and reload/mobile",
  );
} finally {
  await browser.close();
}
