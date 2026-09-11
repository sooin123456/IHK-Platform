import { chromium, expect } from "@playwright/test";

// Catches lost local documents, seeded-source fallback and broken canvas actions.
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await expect(button("빈 작업실 열기")).toBeDisabled();
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("1층 배치 구상");
  await button("빈 작업실 열기").click();
  await expect(page).toHaveURL(/blank=/);
  const url = page.url();
  const workspace = page.getByRole("region", { name: "원본 없는 빈 작업실" });
  await expect(workspace).toContainText("0개 구상 객체");
  await expect(workspace).not.toContainText("A-101");
  await expect(workspace).not.toContainText("PDF-01");
  await button("사각형 구상 도구").click();
  await page
    .getByRole("img", { name: "빈 작업 캔버스" })
    .click({ position: { x: 180, y: 160 } });
  await expect(workspace).toContainText("1개 구상 객체");
  await page.getByLabel("구상 객체 이름", { exact: true }).fill("회의 공간");
  await page.getByLabel("구상 X 위치", { exact: true }).fill("100");
  await page.getByLabel("구상 Y 위치", { exact: true }).fill("100");
  const rectangle = button("회의 공간 구상 객체");
  const box = await rectangle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 60,
    box.y + box.height / 2 + 40,
    { steps: 6 },
  );
  await page.mouse.up();
  expect(
    Number(await page.getByLabel("구상 X 위치", { exact: true }).inputValue()),
  ).toBeGreaterThan(100);
  await button("구상 실행 취소").click();
  await rectangle.click();
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue(
    "100",
  );
  await button("구상 다시 실행").click();
  await rectangle.click();
  expect(
    Number(await page.getByLabel("구상 X 위치", { exact: true }).inputValue()),
  ).toBeGreaterThan(100);
  await button("선택 구상 복사").click();
  await expect(workspace).toContainText("2개 구상 객체");
  await button("구상 실행 취소").click();
  await expect(workspace).toContainText("1개 구상 객체");
  await button("사각형 구상 도구").click();
  await page
    .getByRole("img", { name: "빈 작업 캔버스" })
    .click({ position: { x: 380, y: 160 } });
  await expect(workspace).toContainText("2개 구상 객체");
  await button("선택 구상 삭제").click();
  await expect(workspace).toContainText("1개 구상 객체");
  await page.reload({ waitUntil: "networkidle" });
  await expect(workspace).toContainText("1개 구상 객체");
  await button("회의 공간 구상 객체").click();
  await expect(page.getByLabel("구상 객체 이름", { exact: true })).toHaveValue(
    "회의 공간",
  );
  await button("내 빈 작업 목록").click();
  await expect(page).toHaveURL(/page=projects/);
  await button("1층 배치 구상 열기").click();
  await expect(page).toHaveURL(url);
  await expect(workspace).toContainText("1개 구상 객체");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-blank-workspace-mobile.png",
    fullPage: true,
  });
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=workspace&blank=missing",
    { waitUntil: "networkidle" },
  );
  await expect(workspace).toHaveCount(0);
  await expect(button("내 작업 목록으로")).toBeVisible();
  await expect(
    page.getByLabel("도면·모델 작업 캔버스", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
  console.log(
    "PASS blank creation, independent canvas, rename/delete, reload/reopen, mobile and missing-document recovery",
  );
} finally {
  await browser.close();
}
