import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  const visit = async (section) =>
    page.goto(
      `http://127.0.0.1:4181/workspace-preview/flow?page=${section}&scenario=civil`,
      { waitUntil: "networkidle" },
    );
  await visit("workspace");
  await button("산출 근거 확인").click();
  await page.getByLabel("보정수량", { exact: true }).fill("-2");
  await page.getByLabel("보정 사유", { exact: true }).fill("중복 구간 공제");
  await button("산출 결과 확인 체험").click();
  await button("현재 화면으로 돌아가기").click();
  await button("변경 전후 비교").click();
  const compare = page.getByLabel("도면 변경 영향 비교", { exact: true });
  await expect(compare).toContainText("-2 m");
  await expect(compare).toContainText("-170,000원");
  await expect(compare).not.toContainText("+-");
  await button("변경 건 상세 보기").click();
  await expect(compare).toContainText("-170,000원");
  await page.reload({ waitUntil: "networkidle" });
  await expect(compare).toContainText("-170,000원");
  await page.screenshot({ path: "/tmp/1hk-change-impact.png", fullPage: true });
  const ratePage = await browser.newPage();
  ratePage.on("pageerror", (e) => errors.push(e.message));
  await ratePage.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=rates&scenario=civil",
    { waitUntil: "networkidle" },
  );
  await ratePage
    .getByRole("button", { name: "가져오기·연결", exact: true })
    .click();
  await ratePage.getByLabel("적용 단가", { exact: true }).fill("90000");
  await ratePage
    .getByRole("button", { name: "예시 단가 적용", exact: true })
    .click();
  await ratePage
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await ratePage.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=changes&scenario=civil",
    { waitUntil: "networkidle" },
  );
  await expect(
    ratePage.getByLabel("도면 변경 영향 비교", { exact: true }),
  ).toContainText("+300,000원");
  await expect(
    ratePage.getByLabel("도면 변경 영향 비교", { exact: true }),
  ).toContainText("미확정 미리보기");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS signed decrease, dialog/page consistency, refresh and rate-only +300,000 impact with stale warning",
  );
} finally {
  await browser.close();
}
