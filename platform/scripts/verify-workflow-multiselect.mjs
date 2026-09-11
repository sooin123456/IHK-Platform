import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("다중 선택");
  await button("빈 작업실 열기").click();
  for (const [name, x] of [
    ["A", 100],
    ["B", 300],
  ]) {
    await button("사각형 구상 도구").click();
    await page.getByRole("img", { name: "빈 작업 캔버스" }).focus();
    await page.keyboard.press("Enter");
    await page.getByLabel("구상 객체 이름", { exact: true }).fill(name);
    await page.getByLabel("구상 X 위치", { exact: true }).fill(String(x));
  }
  await button("A 구상 객체").click({ modifiers: ["Shift"] });
  const multi = page.getByRole("region", { name: "다중 객체 편집" });
  await expect(multi).toContainText("2개 선택");
  await multi.getByLabel("선택 이동 X", { exact: true }).fill("20");
  await multi.getByLabel("선택 이동 Y", { exact: true }).fill("0");
  await multi
    .getByRole("button", { name: "선택 함께 이동", exact: true })
    .click();
  await page
    .getByLabel("선택할 객체", { exact: true })
    .selectOption({ label: "1 · A" });
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue(
    "120",
  );
  await button('보이는 객체 모두 선택').click();
  const target=button('A 구상 객체');await target.scrollIntoViewIfNeeded();const box=await target.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+15,{steps:5});await page.mouse.up();
  const moved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:workflow-preview:session:v1')).blankDocuments[0].shapes);
  expect(moved[0].x).toBeGreaterThan(120);expect(moved[1].x-moved[0].x).toBeCloseTo(200,8);
  await button('구상 실행 취소').click();
  await button("보이는 객체 모두 선택").click();
  await button("선택 함께 복사").click();
  await expect(
    page.getByRole("img", { name: "빈 작업 캔버스" }).getByRole("button"),
  ).toHaveCount(4);
  await button("선택 함께 삭제").click();
  await expect(
    page.getByRole("img", { name: "빈 작업 캔버스" }).getByRole("button"),
  ).toHaveCount(2);
  await button("구상 실행 취소").click();
  await expect(
    page.getByRole("img", { name: "빈 작업 캔버스" }).getByRole("button"),
  ).toHaveCount(4);
  await page.getByLabel("구상 표시 잠금", { exact: true }).check();
  await button("보이는 객체 모두 선택").click();
  await expect(button("선택 함께 삭제")).toBeDisabled();
  await page.getByLabel("구상 표시 잠금", { exact: true }).uncheck();
  await page.reload();
  await expect(
    page.getByRole("img", { name: "빈 작업 캔버스" }).getByRole("button"),
  ).toHaveCount(4);
  await button("보이는 객체 모두 선택").click();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await multi.screenshot({ path: "/tmp/1hk-multiselect.png" });
  expect(errors).toEqual([]);
  console.log(
    "PASS Shift selection, shared move/copy/delete/undo, locked atomic denial and reload/mobile",
  );
} finally {
  await browser.close();
}
