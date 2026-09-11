import { chromium, expect } from "@playwright/test";
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
  await page
    .getByLabel("빈 작업 이름", { exact: true })
    .fill("레이어 실행 취소");
  await button("빈 작업실 열기").click();
  await button("사각형 구상 도구").click();
  await page.getByRole("img", { name: "빈 작업 캔버스" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("새 레이어 이름", { exact: true }).fill("검토");
  await button("레이어 추가").click();
  await button("구상 실행 취소").click();
  await expect(page.getByLabel("검토 잠금", { exact: true })).toHaveCount(0);
  await button("구상 다시 실행").click();
  await expect(page.getByLabel("검토 잠금", { exact: true })).toHaveCount(1);
  await button("구상 영역 구상 객체").click();
  await page
    .getByLabel("객체 레이어", { exact: true })
    .selectOption({ label: "검토" });
  await page.getByLabel("구상 너비", { exact: true }).fill("200");
  await page.getByLabel("검토 잠금", { exact: true }).check();
  await button("구상 실행 취소").click();
  await expect(page.getByLabel("검토 잠금", { exact: true })).not.toBeChecked();
  await button("구상 실행 취소").click();
  await button("구상 영역 구상 객체").click();
  await expect(page.getByLabel("구상 너비", { exact: true })).toHaveValue(
    "120",
  );
  await button("검토 이름 변경").click();
  await page
    .getByLabel("변경할 레이어 이름", { exact: true })
    .fill("검토 완료");
  await button("레이어 이름 저장").click();
  await expect(button("검토 완료 레이어 삭제")).toBeDisabled();
  const rows = page
    .getByRole("region", { name: "도면 레이어" })
    .locator(".flow-document-layer-row");
  await expect(rows.first()).toContainText("검토 완료");
  await button("검토 완료 뒤로").click();
  await expect(rows.last()).toContainText("검토 완료");
  await button("구상 실행 취소").click();
  await expect(rows.first()).toContainText("검토 완료");
  await page.getByLabel("새 레이어 이름", { exact: true }).fill("빈 레이어");
  await button("레이어 추가").click();
  await button("빈 레이어 레이어 삭제").click();
  await expect(button("빈 레이어 레이어 삭제")).toHaveCount(0);
  await button("구상 실행 취소").click();
  await expect(button("빈 레이어 레이어 삭제")).toHaveCount(1);
  await page.reload();
  await expect(button("검토 완료 이름 변경")).toHaveCount(1);
  await expect(button("빈 레이어 레이어 삭제")).toHaveCount(1);
  await expect(button("구상 실행 취소")).toBeDisabled();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("region", { name: "도면 레이어" })
    .screenshot({ path: "/tmp/1hk-layer-history.png" });
  expect(errors).toEqual([]);
  console.log(
    "PASS unified object/layer undo, rename/reorder, safe empty deletion, reload/mobile",
  );
} finally {
  await browser.close();
}
