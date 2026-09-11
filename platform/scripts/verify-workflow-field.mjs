import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const visit = async (section) =>
    page.goto(
      `http://127.0.0.1:4181/workspace-preview/flow?page=${section}&scenario=civil`,
      { waitUntil: "networkidle" },
    );
  await visit("materials");
  await expect(button("자재 현황 예시 보관")).toBeDisabled();
  await visit("field");
  await expect(button("현장 기록 예시 보관")).toBeDisabled();
  await page
    .getByLabel("현장 기록 제목", { exact: true })
    .fill("배수관 위치 변경 확인");
  await page
    .getByLabel("현장 기록 내용", { exact: true })
    .fill("현장 확인 내용 ".repeat(90));
  await page
    .getByLabel("현장 관찰 상태", { exact: true })
    .selectOption("changed");
  await page
    .getByLabel("현장 사진 선택", { exact: true })
    .setInputFiles({
      name: "site.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await expect(
    page.getByAltText("사용자가 선택한 현장 사진 · 현재 화면 미리보기"),
  ).toBeVisible();
  await button("현장 기록 예시 보관").click();
  await expect(page.locator(".flow-field-note")).toContainText("CIVIL-01");
  await button("이 기록으로 검토 초안 작성").click();
  const draft = page.getByLabel("검토 요청 내용", { exact: true });
  await expect(draft).toHaveValue(/CIVIL-01 \/ C-301 \/ R1/);
  await expect(draft).toHaveValue(/STA/);
  await button("현재 화면으로 돌아가기").click();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator(".flow-field-note")).toContainText("site.png");
  await expect(page.locator(".flow-field-note")).toContainText(
    "원본 이미지는 별도 첨부 필요",
  );
  await page.screenshot({ path: "/tmp/1hk-field-record.png", fullPage: true });
  await visit("workspace");
  await button("산출 근거 확인").click();
  await button("산출 결과 확인 체험").click();
  await button("현재 화면으로 돌아가기").click();
  await button("검토 요청").click();
  await button("검토 요청 체험").click();
  await button("검토자로 전환 · 데모").click();
  await button("검토 완료 체험").click();
  await button("승인자로 전환 · 데모").click();
  await page
    .getByRole("checkbox", {
      name: "도면 개정·수량·금액의 근거를 확인했습니다",
    })
    .check();
  await button("승인 체험").click();
  await button("현재 화면으로 돌아가기").click();
  await visit("materials");
  await page.getByLabel("발주 수량", { exact: true }).fill("65");
  await page.getByLabel("입고 수량", { exact: true }).fill("70");
  await page.getByLabel("시공 확인 수량", { exact: true }).fill("50");
  await page
    .getByLabel("자재 기록 사유", { exact: true })
    .fill("여유분 5m 포함, 입고 및 현장 확인");
  await expect(button("자재 현황 예시 보관")).toBeDisabled();
  await page.getByLabel("입고 수량", { exact: true }).fill("60");
  await page.getByLabel("시공 확인 수량", { exact: true }).fill("61");
  await expect(button("자재 현황 예시 보관")).toBeDisabled();
  await page.getByLabel("시공 확인 수량", { exact: true }).fill("50");
  await button("자재 현황 예시 보관").click();
  await page.reload({ waitUntil: "networkidle" });
  const cells = page.locator("tbody tr").first().locator("td");
  await expect(cells).toHaveText(["60 m · R1", "65", "60", "50"]);
  await expect(page.getByLabel("발주 수량", { exact: true })).toHaveValue("65");
  await expect(page.getByLabel("입고 수량", { exact: true })).toHaveValue("60");
  await expect(page.getByLabel("시공 확인 수량", { exact: true })).toHaveValue("50");
  await page.screenshot({
    path: "/tmp/1hk-materials-record.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("body")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-materials-mobile.png",
    fullPage: true,
  });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS field evidence draft, photo filename restoration, approval chain, independent materials quantities, invalid input gates, refresh and mobile overflow",
  );
} finally {
  await browser.close();
}
