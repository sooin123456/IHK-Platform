import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scenario=civil",
    { waitUntil: "networkidle" },
  );
  await button("도면 확대").click();
  await button("변경안 적용").click();
  await button("검토 모드").click();
  await expect(button("검토 모드")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".flow-canvas-tools")).toContainText("125%");
  await expect(page.locator(".flow-canvas-status")).toContainText(
    "C-301 선택됨",
  );
  await expect(button("변경안 적용")).toBeDisabled();
  await page
    .getByRole("button", { name: "C-301 도면 객체 선택", exact: true })
    .locator("text")
    .hover();
  await expect(page.getByRole("tooltip")).toContainText("CIVIL-01");
  await expect(page.getByRole("tooltip")).toContainText("R2");
  await expect(page.getByRole("tooltip")).toContainText("객체 수정");
  await page.screenshot({
    path: "/tmp/1hk-review-target-detail.png",
    fullPage: true,
  });
  await button("검토 모드").focus();
  await page.mouse.move(0, 0);
  await page
    .getByRole("button", { name: "C-301 도면 객체 선택", exact: true })
    .focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toBeHidden();
  await expect(page.getByLabel("현재 도면 검토 기록")).toContainText(
    "객체 수정",
  );
  await expect(page.getByLabel("현재 도면 검토 기록")).toContainText(
    "CIVIL-01",
  );
  await button("이 도면의 검토 요청").click();
  await page
    .getByLabel("검토 요청 내용", { exact: true })
    .fill("구간 변경 사유 확인");
  await button("현재 화면으로 돌아가기").click();
  await expect(button("검토 모드")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".flow-canvas-tools")).toContainText("125%");
  await button("작성 모드").click();
  await expect(button("변경안 적용")).toBeEnabled();
  await expect(page.locator(".flow-canvas-tools")).toContainText("125%");
  await button("검토 모드").click();
  await page.screenshot({
    path: "/tmp/1hk-workspace-review-mode.png",
    fullPage: true,
  });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS mode toggle preserves zoom and selection, disables edits, exposes current evidence history and retains context through review dialog",
  );
} finally {
  await browser.close();
}
