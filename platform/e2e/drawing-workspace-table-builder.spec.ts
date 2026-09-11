import { expect, test, type Page } from "@playwright/test";

const previewPath = "/workspace-preview/drawing-workspace?verticalTest=1";

async function openPreview(page: Page) {
  await page.goto(previewPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText(
    "준비됨",
    { timeout: 20_000 },
  );
  await page.getByRole("tab", { name: "표·일람" }).click();
}

async function operationIds(page: Page) {
  const snapshot = JSON.parse(
    (await page.getByLabel("P4 mounted workspace snapshot").textContent())!,
  );
  return snapshot.operationIds as string[];
}

test("schedule builder renames, adds, types, reorders, and saves through one operation", async ({
  page,
}) => {
  page.setDefaultTimeout(10_000);
  await openPreview(page);
  const schedule = page.getByRole("region", { name: "창호 점검 일람표" });
  await expect(schedule).toBeVisible();
  const before = await operationIds(page);

  await schedule.getByLabel("일람표 이름: 창호 점검").fill("현장 창호 점검");
  await schedule.getByLabel("열 이름: 메모").fill("현장 비고");
  await schedule.getByRole("button", { name: "열 추가: 창호 점검" }).click();
  await schedule.getByLabel("열 이름: 새 열").fill("검토 상태 열");
  await schedule.getByLabel("열 종류: 검토 상태 열").selectOption("property");
  await schedule
    .getByLabel("사용자 속성: 검토 상태 열")
    .selectOption({ label: "검토 상태" });
  await schedule
    .getByRole("button", { name: "열 위로 이동: 검토 상태 열" })
    .click();
  await schedule.getByLabel("현장 창호 점검 1 현장 비고").fill("재확인");
  await schedule.getByRole("button", { name: "일람표 저장" }).click();

  await expect
    .poll(async () => (await operationIds(page)).length)
    .toBe(before.length + 1);
  const saved = page.getByRole("region", { name: "현장 창호 점검 일람표" });
  await expect(saved).toBeVisible();
  const headers = saved.getByRole("columnheader");
  await expect(headers.nth(0)).toHaveText("검토 상태 열");
  await expect(headers.nth(1)).toHaveText("현장 비고");
  await expect(saved.getByLabel("현장 창호 점검 1 현장 비고")).toHaveValue(
    "재확인",
  );
  await expect(saved.getByLabel("현장 창호 점검 1 현장 비고")).toBeEnabled();
  await expect(
    saved.getByRole("button", { name: "일람표 저장" }),
  ).toBeVisible();
});
