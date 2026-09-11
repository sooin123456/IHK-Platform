import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
const key = "1hk:workflow-preview:session:v1";
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const url = "http://127.0.0.1:4181/workspace-preview/flow?page=workspace";
  await page.goto(url, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "변경안 적용", exact: true }).click();
  await page.getByRole("button", { name: "검토 요청", exact: true }).click();
  await page
    .getByLabel("검토 요청 내용", { exact: true })
    .fill("개구부 공제와 마감 면적 확인");
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await page.getByRole("button", { name: "검토 요청", exact: true }).click();
  await expect(page.getByLabel("검토 요청 내용", { exact: true })).toHaveValue(
    "개구부 공제와 마감 면적 확인",
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(
    page.getByLabel("도면·모델 작업 캔버스", { exact: true }),
  ).toContainText("28 m²");
  await page.getByRole("button", { name: "검토 요청", exact: true }).click();
  await expect(page.getByLabel("검토 요청 내용", { exact: true })).toHaveValue(
    "개구부 공제와 마감 면적 확인",
  );
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "데모 시나리오", exact: true })
    .click();
  await page.locator(".flow-demo select").nth(0).selectOption("ifc");
  await page.getByRole("button", { name: "검토 요청", exact: true }).click();
  await expect(
    page.getByLabel("검토 요청 내용", { exact: true }),
  ).not.toHaveValue("개구부 공제와 마감 면적 확인");
  await page
    .getByLabel("검토 요청 내용", { exact: true })
    .fill("IFC 전용 검토");
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await page.locator(".flow-demo select").nth(0).selectOption("architecture");
  await page.getByRole("button", { name: "검토 요청", exact: true }).click();
  await expect(page.getByLabel("검토 요청 내용", { exact: true })).toHaveValue(
    "개구부 공제와 마감 면적 확인",
  );
  await page.evaluate(
    (key) => sessionStorage.setItem(key, "broken-preview"),
    key,
  );
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("alert")).toContainText("복원하지 못했습니다");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), key)).toBe(
    "broken-preview",
  );
  await page
    .getByRole("button", { name: "기존 예시 대신 현재 화면 보관", exact: true })
    .click();
  await expect(page.locator(".flow-top")).toContainText("탭에 보관됨");
  const denied = await browser.newPage();
  await denied.addInitScript((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Blocked", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, key);
  await denied.goto(url, { waitUntil: "networkidle" });
  await expect(denied.getByRole("alert")).toContainText(
    "브라우저 저장을 사용할 수 없습니다",
  );
  await denied
    .getByRole("button", { name: "변경안 적용", exact: true })
    .click();
  await expect(
    denied.getByLabel("도면·모델 작업 캔버스", { exact: true }),
  ).toContainText("28 m²");
  await expect(denied.locator(".flow-top")).not.toContainText("탭에 보관됨");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS: refresh snapshot, panel draft retention, scenario isolation, corrupt snapshot preservation, unavailable storage warning and continued drafting",
  );
} finally {
  await browser.close();
}
