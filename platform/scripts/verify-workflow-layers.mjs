import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const checkbox = (name) => page.getByRole("checkbox", { name, exact: true });
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scenario=civil",
    { waitUntil: "networkidle" },
  );
  await page.locator(".flow-layer-controls summary").click();
  await expect(checkbox("원본 배경 잠금")).toBeChecked();
  await expect(checkbox("원본 배경 잠금")).toBeDisabled();
  await page.getByLabel("새 레이어 이름", { exact: true }).fill("현장 확인");
  await button("레이어 추가").click();
  await expect(button("레이어 추가")).toBeDisabled();
  await button("속성·레이어").click();
  await page
    .getByLabel("표시 레이어", { exact: true })
    .selectOption("현장 확인");
  await button("객체 속성 적용").click();
  await button("현재 화면으로 돌아가기").click();
  await checkbox("현장 확인 표시").uncheck();
  await expect(
    page.getByRole("button", { name: "C-301 도면 객체 선택", exact: true }),
  ).toHaveCount(0);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".flow-layer-controls summary").click();
  await expect(checkbox("현장 확인 표시")).not.toBeChecked();
  await checkbox("현장 확인 표시").check();
  await checkbox("현장 확인 잠금").check();
  await expect(button("변경안 적용")).toBeDisabled();
  await button("속성·레이어").click();
  await expect(page.getByLabel("객체 이름", { exact: true })).toBeDisabled();
  await expect(button("객체 속성 적용")).toBeDisabled();
  await button("현재 화면으로 돌아가기").click();
  await checkbox("원본 배경 표시").uncheck();
  await expect(
    page.locator(".flow-review-reference").first(),
  ).not.toBeVisible();
  await page.screenshot({
    path: "/tmp/1hk-layer-controls.png",
    fullPage: true,
  });
  await checkbox("원본 배경 표시").check();
  await checkbox("현장 확인 잠금").uncheck();
  await expect(button("변경안 적용")).toBeEnabled();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS add layer, assign object, hide/restore, reload, protected original and locked property/geometry edits",
  );
} finally {
  await browser.close();
}
