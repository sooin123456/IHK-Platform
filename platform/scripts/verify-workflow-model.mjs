import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scenario=ifc",
    { waitUntil: "networkidle" },
  );
  await button("도면 확대").click();
  await button("모델 구조·근거").click();
  const panel = page.getByLabel("모델 근거 탐색", { exact: true });
  await expect(panel).toContainText("GlobalId 미연결");
  await page.getByLabel("모델 객체 검색", { exact: true }).fill("없는 요소");
  await expect(panel).toContainText("일치하는 시나리오 객체가 없습니다");
  await expect(button("이 객체 검토 요청")).toHaveCount(0);
  await button("검색 초기화").click();
  await page.getByLabel("모델 객체 검색", { exact: true }).fill("W-201");
  await expect(panel).toContainText("IFC-01");
  await page.screenshot({
    path: "/tmp/1hk-model-evidence.png",
    fullPage: true,
  });
  await button("이 객체의 산출 근거").click();
  await expect(
    page.getByLabel("산출 근거 편집", { exact: true }),
  ).toContainText("W-201");
  await button("현재 화면으로 돌아가기").click();
  await expect(page.locator(".flow-canvas-tools")).toContainText("125%");
  await button("모델 구조·근거").click();
  await button("작업실에서 대상 확인").click();
  await expect(
    page.getByLabel("도면·모델 작업 캔버스", { exact: true }),
  ).toContainText("W-201");
  await expect(page.locator(".flow-canvas-tools")).toContainText("125%");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS model search/no-result/reset, honest source metadata, quantity link and same-canvas return",
  );
} finally {
  await browser.close();
}
