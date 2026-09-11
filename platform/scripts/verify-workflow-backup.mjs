import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "1hk:workflow-preview:session:v1")
        throw new DOMException("Blocked", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("백업 도면");
  await button("빈 작업실 열기").click();
  await button("사각형 구상 도구").click();
  await page.getByRole("img", { name: "빈 작업 캔버스" }).focus();
  await page.keyboard.press("Enter");
  await expect(button("현재 작업 백업 다운로드")).toBeVisible();
  const downloading = page.waitForEvent("download");
  await button("현재 작업 백업 다운로드").click();
  const download = await downloading;
  const stream = await download.createReadStream();
  const parts = [];
  for await (const chunk of stream) parts.push(chunk);
  const buffer = Buffer.concat(parts);
  expect(JSON.parse(buffer.toString()).blankDocuments[0].shapes).toHaveLength(
    1,
  );
  await button("사각형 구상 도구").click();
  await page.getByRole("img", { name: "빈 작업 캔버스" }).focus();
  await page.keyboard.press("Enter");
  await page
    .getByLabel("작업 백업 파일", { exact: true })
    .setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from("{broken"),
    });
  await expect(
    page.getByRole("region", { name: "작업 백업·복원" }),
  ).toContainText("복원할 수 없는 파일");
  await expect(button("확인한 백업으로 현재 탭 복원")).toBeDisabled();
  await page
    .getByLabel("작업 백업 파일", { exact: true })
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer,
    });
  await expect(
    page.getByRole("region", { name: "작업 백업·복원" }),
  ).toContainText("도면 1개 · 객체 1개");
  await button('복원 취소').click();
  await expect(page.getByLabel('작업 백업 파일',{exact:true})).toHaveValue('');
  await page.getByLabel('작업 백업 파일',{exact:true}).setInputFiles({name:'backup.json',mimeType:'application/json',buffer});
  await expect(button("확인한 백업으로 현재 탭 복원")).toBeDisabled();
  await page
    .getByLabel("현재 탭의 작업을 선택한 백업으로 교체함을 확인합니다", {
      exact: true,
    })
    .check();
  await button("확인한 백업으로 현재 탭 복원").click();
  await expect(
    page.getByRole("heading", { name: "내 로컬 작업 · 1개", exact: true }),
  ).toBeVisible();
  await button("백업 도면 열기").click();
  await expect(
    page.getByRole("img", { name: "빈 작업 캔버스" }).getByRole("button"),
  ).toHaveCount(1);
  await expect(page.locator(".flow-top")).toContainText("저장 불가");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("region", { name: "작업 백업·복원" })
    .screenshot({ path: "/tmp/1hk-backup.png" });
  expect(errors).toEqual([]);
  console.log(
    "PASS storage-denied backup download, invalid recovery, explicit replacement and restored drawing/mobile",
  );
} finally {
  await browser.close();
}
