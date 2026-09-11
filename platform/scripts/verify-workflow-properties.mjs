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
  await page.getByRole("button", { name: "속성·레이어", exact: true }).click();
  await page.getByLabel("객체 이름", { exact: true }).fill("");
  await expect(
    page.getByRole("button", { name: "객체 속성 적용", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("객체 이름", { exact: true }).fill("회의실 타일 마감");
  await page
    .getByLabel("표시 레이어", { exact: true })
    .selectOption("검토 주석");
  await page.getByLabel("선 색", { exact: true }).fill("#cc3311");
  await page.getByLabel("채움 색", { exact: true }).fill("#ffeecc");
  await page.getByLabel("선 굵기", { exact: true }).fill("3");
  await page
    .getByRole("button", { name: "객체 속성 적용", exact: true })
    .click();
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  const rect = page.locator('[aria-label="A-101 도면 객체 선택"] rect').first();
  await expect(rect).toHaveAttribute("fill", "#ffeecc");
  await expect(rect).toHaveAttribute("stroke", "#cc3311");
  await expect(rect).toHaveAttribute("width", "180");
  await expect(page.locator(".flow-canvas-inspector")).toContainText(
    "회의실 타일 마감",
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(rect).toHaveAttribute("fill", "#ffeecc");
  await page.getByRole("button", { name: "속성·레이어", exact: true }).click();
  await expect(page.getByLabel("표시 레이어", { exact: true })).toHaveValue(
    "검토 주석",
  );
  await expect(page.getByLabel("객체 이름", { exact: true })).toHaveValue(
    "회의실 타일 마감",
  );
  await page.screenshot({
    path: "/tmp/1hk-object-properties.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "데모 시나리오", exact: true })
    .click();
  await page.locator(".flow-demo select").nth(1).selectOption("viewer");
  await page.getByRole("button", { name: "속성·레이어", exact: true }).click();
  await expect(page.getByLabel("객체 이름", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "객체 속성 적용", exact: true }),
  ).toBeDisabled();
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS: property validation, style rendering without geometry change, refresh restoration and viewer denial",
  );
} finally {
  await browser.close();
}
