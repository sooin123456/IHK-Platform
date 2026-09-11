import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  for (const [scenario, id, quantity, amount] of [
    ["architecture", "A-101", 22, "924,000"],
    ["ifc", "W-201", 34, "2,210,000"],
    ["civil", "C-301", 58, "4,930,000"],
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(
      `http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scenario=${scenario}`,
      { waitUntil: "networkidle" },
    );
    await page
      .getByRole("button", { name: "산출 근거 확인", exact: true })
      .click();
    if (scenario === "architecture") {
      await page
        .getByRole("button", { name: "축척 먼저 설정", exact: true })
        .click();
      await page
        .getByRole("button", { name: "축척 설정 체험", exact: true })
        .click();
      await page
        .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
        .click();
      await page
        .getByRole("button", { name: "산출 근거 확인", exact: true })
        .click();
    }
    await page.getByLabel("보정수량", { exact: true }).fill("-2");
    await expect(
      page.getByRole("button", { name: "산출 결과 확인 체험", exact: true }),
    ).toBeDisabled();
    await page.getByLabel("보정 사유", { exact: true }).fill("중복 구간 공제");
    await page
      .getByRole("button", { name: "산출 결과 확인 체험", exact: true })
      .click();
    await expect(
      page.getByLabel("산출 근거 편집", { exact: true }),
    ).toContainText(`${quantity}`);
    await expect(
      page.getByLabel("산출 근거 편집", { exact: true }),
    ).toContainText(amount);
    await page
      .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
      .click();
    if (scenario === "architecture")
      await expect(
        page.locator('[aria-label="A-101 도면 객체 선택"] rect').first(),
      ).toHaveAttribute("width", "180");
    await page
      .getByRole("button", { name: "연결 내역 보기", exact: true })
      .click();
    await expect(page.locator("table")).toContainText(id);
    await expect(page.locator("table")).toContainText(amount);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.locator("table")).toContainText(amount);
    if (errors.length) throw new Error(errors.join("\n"));
    await page.close();
  }
  console.log(
    "PASS: three scenario correction/reason validation, totals, unchanged source geometry, estimate links and refresh",
  );
} finally {
  await browser.close();
}
