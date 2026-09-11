import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1360, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=workspace",
    { waitUntil: "networkidle" },
  );
  const open = () =>
    page.getByRole("button", { name: "확인할 항목·AI", exact: true }).click();
  await open();
  const panel = page.getByLabel("근거 기반 AI 제안 예시", { exact: true });
  await expect(
    panel.getByRole("button", { name: "검토 의견으로 채택", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("AI 제안 판단 이유", { exact: true })
    .fill("개구부 공제 범위를 검토할 필요가 있음");
  await page
    .getByRole("button", { name: "원본·변경 근거 비교", exact: true })
    .click();
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await open();
  await expect(
    page.getByLabel("AI 제안 판단 이유", { exact: true }),
  ).toHaveValue("개구부 공제 범위를 검토할 필요가 있음");
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "검토 의견으로 채택", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("검토 의견으로 채택됨");
  await page.reload({ waitUntil: "networkidle" });
  await open();
  await expect(panel.getByRole("status")).toContainText("검토 의견으로 채택됨");
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await page.getByRole("button", { name: "변경안 적용", exact: true }).click();
  await open();
  await expect(panel.getByRole("status")).toContainText(
    "현재 개정 재확인 필요",
  );
  await page
    .getByLabel("AI 제안 판단 이유", { exact: true })
    .fill("현재 변경 범위와 무관하여 기각");
  await panel.getByRole("checkbox").check();
  await panel
    .getByRole("button", { name: "이유를 남기고 기각", exact: true })
    .click();
  await expect(panel.getByRole("status")).toContainText("기각됨");
  await page.screenshot({
    path: "/tmp/1hk-assistant-decision.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "데모 시나리오", exact: true })
    .click();
  await page.locator(".flow-demo select").nth(2).selectOption("ai");
  await page
    .getByRole("button", { name: "근거와 수동 확인 항목", exact: true })
    .click();
  await expect(
    panel.getByRole("button", { name: "검토 의견으로 채택", exact: true }),
  ).toBeDisabled();
  await expect(panel.getByRole("alert")).toContainText("자료 부족");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS: reason/evidence gate, draft retention through comparison, decision refresh, revision invalidation, dismissal and insufficient evidence guard",
  );
} finally {
  await browser.close();
}
