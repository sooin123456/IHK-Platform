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
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("레이어 작업");
  await button("빈 작업실 열기").click();
  await button("사각형 구상 도구").click();
  await page.getByRole("img", { name: "빈 작업 캔버스" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("새 레이어 이름", { exact: true }).fill("검토 표시");
  await button("레이어 추가").click();
  await page
    .getByLabel("객체 레이어", { exact: true })
    .selectOption({ label: "검토 표시" });
  const shape = button("구상 영역 구상 객체");
  await page.getByLabel("검토 표시 잠금", { exact: true }).check();
  await expect(page.getByLabel("구상 너비", { exact: true })).toBeDisabled();
  await shape.focus();
  await page.keyboard.press("Delete");
  await expect(shape).toHaveCount(1);
  await page.getByLabel("검토 표시 표시", { exact: true }).uncheck();
  await expect(shape).toHaveCount(0);
  await page.getByLabel("숨긴 레이어 임시 표시", { exact: true }).check();
  await expect(shape).toHaveCount(1);
  await page.reload();
  await expect(shape).toHaveCount(0);
  await expect(
    page.getByLabel("검토 표시 잠금", { exact: true }),
  ).toBeChecked();
  await page.getByLabel("검토 표시 표시", { exact: true }).check();
  await page.getByLabel("검토 표시 잠금", { exact: true }).uncheck();
  await shape.click();
  await expect(page.getByLabel("구상 너비", { exact: true })).toBeEnabled();
  await expect(
    page.getByLabel("객체 레이어", { exact: true }).locator("option:checked"),
  ).toHaveText("검토 표시");
  await page.getByLabel("구상 너비", { exact: true }).fill("200");
  await button("구상 실행 취소").click();
  await shape.click();
  await expect(page.getByLabel("구상 너비", { exact: true })).toHaveValue(
    "120",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("region", { name: "도면 레이어" })
    .screenshot({ path: "/tmp/1hk-local-layers.png" });
  expect(errors).toEqual([]);
  console.log(
    "PASS local layer create/assign/lock/hide/temporary reveal/reload/unlock/edit/mobile",
  );
} finally {
  await browser.close();
}
