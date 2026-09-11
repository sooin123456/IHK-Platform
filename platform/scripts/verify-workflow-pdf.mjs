import { chromium, expect } from "@playwright/test";
import { PDFDocument, rgb } from "pdf-lib";
const pdf = await PDFDocument.create();
for (let i = 0; i < 2; i++) {
  const page = pdf.addPage([800, 520]);
  page.drawRectangle({
    x: 100,
    y: 100,
    width: 500,
    height: 300,
    borderWidth: 5,
    borderColor: rgb(0, 0, 0),
  });
  page.drawText(`PLAN PAGE ${i + 1}`, { x: 130, y: 350, size: 30 });
}
const source = {
  name: "two-page-plan.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from(await pdf.save()),
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const input = () => page.getByLabel("작업실 PDF 선택", { exact: true });
  const rendered = () =>
    page.locator('.flow-local-pdf-surface [aria-busy="false"]');
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("PDF 작업");
  await button("빈 작업실 열기").click();
  await input().setInputFiles({
    name: "broken.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("invalid"),
  });
  await expect(page.getByRole("alert")).toContainText("PDF를 열 수 없습니다");
  await input().setInputFiles(source);
  await expect(rendered()).toHaveCount(1, { timeout: 20000 });
  const pixels = await page
    .locator(".flow-local-pdf-surface canvas")
    .evaluate((canvas) => {
      const data = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] < 80 && data[i + 3] > 0) dark++;
      return dark;
    });
  expect(pixels).toBeGreaterThan(1000);
  await button("사각형 구상 도구").click();
  await page
    .getByRole("img", { name: "빈 작업 캔버스" })
    .click({ position: { x: 180, y: 160 } });
  await page.getByLabel("구상 객체 이름", { exact: true }).fill("1쪽 확인");
  await button("다음 PDF 쪽").click();
  await expect(rendered()).toHaveCount(1);
  await expect(button("1쪽 확인 구상 객체")).toHaveCount(0);
  await button("사각형 구상 도구").click();
  await page
    .getByRole("img", { name: "빈 작업 캔버스" })
    .click({ position: { x: 230, y: 180 } });
  await page.getByLabel("구상 객체 이름", { exact: true }).fill("2쪽 확인");
  await button("PDF 확대").click();
  await expect(rendered()).toHaveCount(1);
  await expect(button("2쪽 확인 구상 객체")).toBeVisible();
  await page.screenshot({
    path: "/tmp/1hk-workflow-real-pdf.png",
    fullPage: true,
  });
  await page.reload({ waitUntil: "networkidle" });
  await expect(button("사각형 구상 도구")).toBeDisabled();
  await expect(page.locator(".flow-local-pdf-surface canvas")).toHaveCount(0);
  await input().setInputFiles({
    name: "different.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.concat([source.buffer, Buffer.from("\n% different")]),
  });
  await expect(page.getByRole("alert")).toContainText(
    "등록한 PDF와 내용이 다릅니다",
  );
  await input().setInputFiles(source);
  await expect(rendered()).toHaveCount(1);
  await expect(button("2쪽 확인 구상 객체")).toBeVisible();
  await button("이전 PDF 쪽").click();
  await expect(button("1쪽 확인 구상 객체")).toBeVisible();
  await expect(button("2쪽 확인 구상 객체")).toHaveCount(0);
  await button("1쪽 확인 구상 객체").click();
  const review = page.getByRole("region", { name: "이 도면 검토" });
  const opinion = page.getByLabel("도면 검토 의견", { exact: true });
  const role = page.getByLabel("도면 검토 체험 역할", { exact: true });
  await expect(button("선택 객체 검토 요청")).toBeDisabled();
  await opinion.fill("표시한 구간 검토를 요청합니다");
  await button("선택 객체 검토 요청").click();
  await expect(review).toContainText("검토 대기");
  await expect(button("구상 실행 취소")).toBeDisabled();
  await expect(button("선택 구상 복사")).toBeDisabled();
  await button("내 할 일").click();
  const inbox = page.getByRole("region", { name: "내 도면 검토 목록" });
  await expect(inbox).toContainText("two-page-plan.pdf");
  await expect(inbox).toContainText("검토자");
  await page.getByLabel("내 도면 검토 검색").fill("없는 도면");
  await expect(button("PDF 작업 검토 열기")).toHaveCount(0);
  await button("검토 검색 초기화").click();
  await button("PDF 작업 검토 열기").click();
  await expect(role).toHaveValue("reviewer");
  await input().setInputFiles(source);
  await expect(rendered()).toHaveCount(1);
  await expect(page.getByLabel("구상 객체 이름", { exact: true })).toHaveValue(
    "1쪽 확인",
  );
  await expect(
    page.getByLabel("구상 객체 이름", { exact: true }),
  ).toBeDisabled();
  await role.selectOption("reviewer");
  await opinion.fill("객체 명칭을 보강 구간으로 구체화해주세요");
  await button("수정 요청하기").click();
  await role.selectOption("author");
  await page.getByLabel("구상 객체 이름", { exact: true }).fill("보강 구간");
  await opinion.fill("명칭을 보강 구간으로 수정했습니다");
  await button("수정본 재제출").click();
  await expect(review).toContainText("R2");
  await role.selectOption("reviewer");
  await button("검토 대상 위치로").click();
  await expect(page.getByLabel("구상 객체 이름", { exact: true })).toHaveValue(
    "보강 구간",
  );
  await opinion.fill("수정 사항 확인 완료");
  await button("검토 완료하기").click();
  await role.selectOption("approver");
  await opinion.fill("도면 구상 검토를 승인합니다");
  await button("이 개정 승인하기").click();
  await expect(review).toContainText("승인됨");
  await page.reload({ waitUntil: "networkidle" });
  await role.selectOption("author");
  await expect(review).toContainText("승인됨");
  await expect(button("사각형 구상 도구")).toBeDisabled();
  await input().setInputFiles(source);
  await expect(rendered()).toHaveCount(1);
  await button("보강 구간 구상 객체").click();
  await expect(
    page.getByLabel("구상 객체 이름", { exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: "/tmp/1hk-local-pdf-approved.png",
    fullPage: true,
  });
  await button("새 개정에서 수정").click();
  await expect(review).toContainText("R3");
  await expect(button("구상 실행 취소")).toBeDisabled();
  await expect(
    page.getByLabel("구상 객체 이름", { exact: true }),
  ).toBeEnabled();
  await page.getByLabel("구상 객체 이름", { exact: true }).fill("새 개정 구간");
  await review.locator("summary").click();
  await expect(review.locator("article").nth(0)).toContainText("1쪽 확인");
  await expect(review.locator("article").nth(1)).toContainText("보강 구간");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(rendered()).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await button("내 빈 작업 목록").click();
  const workCard = page.locator("article").filter({
    has: page.getByRole("heading", { name: "PDF 작업", exact: true }),
  });
  await expect(workCard).toContainText("two-page-plan.pdf");
  await expect(workCard).toContainText("R3");
  await button("내 할 일").click();
  await expect(inbox).toContainText("처리할 로컬 검토 작업이 없습니다");
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=reviews", {
    waitUntil: "networkidle",
  });
  await expect(inbox).toContainText("승인됨");
  await expect(inbox).toContainText("현재 R3 작성 중");
  await page.screenshot({
    path: "/tmp/1hk-local-review-inbox.png",
    fullPage: true,
  });
  await button("PDF 작업 검토 열기").click();
  await expect(role).toHaveValue("viewer");
  await expect(role).toBeDisabled();
  await input().setInputFiles(source);
  await expect(rendered()).toHaveCount(1);
  await expect(page.getByLabel("구상 객체 이름", { exact: true })).toHaveValue(
    "보강 구간",
  );
  await button("내 빈 작업 목록").click();
  await button("PDF 작업 열기").click();
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=delivery",
    { waitUntil: "networkidle" },
  );
  const delivery = page.getByRole("region", { name: "내 PDF 납품" });
  await expect(page.getByText("건축 적산 / R1", { exact: true })).toHaveCount(
    0,
  );
  await expect(delivery).toContainText("현재 작업 R3");
  await expect(button("납품 구성 준비")).toBeDisabled();
  await expect(page.getByLabel("PDF 작업 납품 개정")).toHaveValue("2");
  await page.getByLabel("PDF 작업 수신 대상").fill("발주처 검토팀");
  await button("납품 구성 준비").click();
  await button("받는 사람 화면 보기").click();
  await expect(delivery).toContainText("보강 구간");
  await expect(delivery).not.toContainText("새 개정 구간");
  await expect(button("구성 확인 완료 (체험)")).toBeDisabled();
  await page.getByLabel("납품 수신 의견").fill("도면 목록 보완이 필요합니다");
  await button("보완 요청 (체험)").click();
  await expect(delivery).toContainText("도면 목록 보완이 필요합니다");
  await page.reload({ waitUntil: "networkidle" });
  await expect(delivery).toContainText("보완 요청 (체험)");
  await button("납품 구성 다시 만들기").click();
  await expect(
    page.locator("summary").filter({ hasText: "이전 납품 구성" }),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "이전 납품 구성" }).click();
  await expect(
    page.getByRole("region", { name: "이전 납품 구성" }),
  ).toContainText("도면 목록 보완이 필요합니다");
  await page
    .getByRole("region", { name: "이전 납품 구성" })
    .screenshot({ path: "/tmp/1hk-delivery-history.png" });
  await button("이전 승인본 보기").click();
  await expect(role).toBeDisabled();
  await expect(page.getByLabel("구상 객체 이름", { exact: true })).toHaveValue(
    "보강 구간",
  );
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=delivery&scope=local",
    { waitUntil: "networkidle" },
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("summary").filter({ hasText: "이전 납품 구성" }).click();
  await expect(
    page.getByRole("region", { name: "이전 납품 구성" }),
  ).toContainText("도면 목록 보완이 필요합니다");
  await button("받는 사람 화면 보기").click();
  await page.getByLabel("납품 수신 의견").fill("구성 확인 완료");
  await button("구성 확인 완료 (체험)").click();
  await expect(delivery).toContainText("구성 확인 완료 (체험)");
  await page.reload({ waitUntil: "networkidle" });
  await expect(delivery).toContainText("구성 확인 완료 (체험)");
  await button("납품 구성 다시 만들기").click();
  await button("독립 수신 화면 열기").click();
  await expect(
    page.getByRole("main", { name: "수신자 납품 확인" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "데모 시나리오", exact: true }),
  ).toHaveCount(0);
  const guestUrl = page.url();
  await expect(button("승인 도면 보기")).toBeVisible();
  await button("승인 도면 보기").click();
  const guestDrawing = page.getByRole("region", { name: "수신 승인 도면" });
  const documentBefore = await page.evaluate(() =>
    sessionStorage.getItem("1hk:workflow-preview:session:v1"),
  );
  await guestDrawing
    .getByLabel("작업실 PDF 선택", { exact: true })
    .setInputFiles({
      ...source,
      name: "wrong.pdf",
      buffer: Buffer.concat([source.buffer, Buffer.from("\n% different")]),
    });
  await expect(guestDrawing.getByRole("alert")).toContainText(
    "등록한 PDF와 내용이 다릅니다",
  );
  await expect(guestDrawing.locator("canvas")).toHaveCount(0);
  await guestDrawing
    .getByLabel("작업실 PDF 선택", { exact: true })
    .setInputFiles(source);
  await expect(guestDrawing.locator('[aria-busy="false"] canvas')).toHaveCount(
    1,
  );
  await expect(
    guestDrawing.getByRole("img", {
      name: "승인 객체: 보강 구간",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    guestDrawing.getByRole("img", {
      name: "승인 객체: 새 개정 구간",
      exact: true,
    }),
  ).toHaveCount(0);
  await button("승인 위치 보기: 2쪽 확인").click();
  await expect(
    guestDrawing.getByRole("img", { name: "승인 객체: 2쪽 확인", exact: true }),
  ).toHaveCount(1);
  await expect(
    guestDrawing.getByRole("img", {
      name: "승인 객체: 보강 구간",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("1hk:workflow-preview:session:v1"),
    ),
  ).toBe(documentBefore);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await page.getByRole("main").boundingBox()).width).toBeGreaterThan(
    700,
  );
  await page.screenshot({
    path: "/tmp/1hk-recipient-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-recipient-mobile.png",
    fullPage: true,
  });
  await expect(page.getByRole("main")).toContainText("보강 구간");
  await expect(page.getByRole("main")).not.toContainText("새 개정 구간");
  await page
    .getByLabel("수신자 확인 의견", { exact: true })
    .fill("외부 화면 구성 확인");
  await button("수신 확인 기록 (체험)").click();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("main")).toContainText("외부 화면 구성 확인");
  await button("내부 납품 화면으로 (체험)").click();
  await button("수신 화면 만료시키기 (체험)").click();
  await page.goto(guestUrl, { waitUntil: "networkidle" });
  await expect(page.getByRole("main")).toContainText(
    "수신 화면이 만료되었습니다",
  );
  await expect(
    page.getByLabel("수신자 확인 의견", { exact: true }),
  ).toHaveCount(0);
  await button("내부 납품 화면으로 (체험)").click();
  await button("납품 구성 다시 만들기").click();
  await page.goto(guestUrl, { waitUntil: "networkidle" });
  await expect(page.getByRole("main")).toContainText(
    "이 납품 구성이 교체되었습니다",
  );
  const isolated = await browser.newPage();
  await isolated.goto(guestUrl, { waitUntil: "networkidle" });
  await expect(isolated.getByRole("main")).toContainText(
    "이 탭에서 납품 자료를 찾을 수 없습니다",
  );
  await isolated.close();
  await button("내부 납품 화면으로 (체험)").click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-local-pdf-delivery.png",
    fullPage: true,
  });
  await button("받는 사람 화면 보기").click();
  await button("납품 승인본 확인").click();
  await expect(role).toBeDisabled();
  await input().setInputFiles(source);
  await expect(rendered()).toHaveCount(1);
  await expect(page.getByLabel("구상 객체 이름", { exact: true })).toHaveValue(
    "보강 구간",
  );
  expect(errors).toEqual([]);
  if (process.argv[2]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
      waitUntil: "networkidle",
    });
    await page
      .getByLabel("빈 작업 이름", { exact: true })
      .fill("구조 도면 확인");
    await button("빈 작업실 열기").click();
    await input().setInputFiles(process.argv[2]);
    await expect(rendered()).toHaveCount(1, { timeout: 30000 });
    await page.screenshot({
      path: "/tmp/1hk-workflow-structure-pdf.png",
      fullPage: true,
    });
    expect(errors).toEqual([]);
    console.log("PASS supplied PDF first-page rendering");
  }
  console.log(
    "PASS real PDF pixels, corrupt-file recovery, per-page overlay, zoom, refresh fingerprint gate and mobile layout",
  );
} finally {
  await browser.close();
}
