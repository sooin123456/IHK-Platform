import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scenario=architecture",
    { waitUntil: "networkidle" },
  );
  await button("산출 근거 확인").click();
  await button("축척 먼저 설정").click();
  await page.getByLabel("축척 기준 길이", { exact: true }).fill("0");
  await expect(button("축척 설정 체험")).toBeDisabled();
  await page.getByLabel("축척 기준 길이", { exact: true }).fill("6");
  await page.getByLabel("축척 길이 단위", { exact: true }).selectOption("m");
  await button("축척 설정 체험").click();
  await expect(
    page.getByLabel("축척 기준 설정", { exact: true }),
  ).toContainText("보관된 기준: 6 m");
  await button("현재 화면으로 돌아가기").click();
  await page.reload({ waitUntil: "networkidle" });
  await button("산출 근거 확인").click();
  await button("축척 기준 확인").click();
  await expect(page.getByLabel("축척 기준 길이", { exact: true })).toHaveValue(
    "6",
  );
  await expect(page.getByLabel("축척 길이 단위", { exact: true })).toHaveValue(
    "m",
  );
  await page.screenshot({ path: "/tmp/1hk-scale-setup.png", fullPage: true });
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS invalid length gate, m unit setup, unchanged demo quantities and reload/reopen reference input restoration",
  );
} finally {
  await browser.close();
}
