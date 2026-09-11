import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
    }),
    errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("키보드 도면");
  await button("빈 작업실 열기").click();
  await button("사각형 구상 도구").click();
  await page
    .getByRole("img", { name: "빈 작업 캔버스" })
    .click({ position: { x: 150, y: 120 } });
  await page.getByLabel("구상 X 위치", { exact: true }).fill("100");
  await page.getByLabel("구상 객체 이름", { exact: true }).fill("대상");
  const object = () => button("대상 구상 객체");
  await object().focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue(
    "101",
  );
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue(
    "111",
  );
  await page.keyboard.press("Control+z");
  await object().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue(
    "101",
  );
  await page.keyboard.press("Control+Shift+z");
  await object().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue(
    "111",
  );
  await page.keyboard.press("Delete");
  await expect(object()).toHaveCount(0);
  await page.getByRole("region", { name: "원본 없는 빈 작업실" }).focus();
  await page.keyboard.press("Control+z");
  await expect(object()).toHaveCount(1);
  await object().focus();
  await page.keyboard.press("Enter");
  const name = page.getByLabel("구상 객체 이름", { exact: true });
  await name.focus();
  await page.keyboard.press("End");
  await page.keyboard.press("Delete");
  await expect(object()).toHaveCount(1);
  await object().focus();
  await page.keyboard.press("Escape");
  await expect(name).toHaveCount(0);
  await page.getByLabel("도면 검토 체험 역할").selectOption("viewer");
  await object().focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByLabel("구상 X 위치", { exact: true })).toHaveValue(
    "111",
  );
  await page.keyboard.press("Delete");
  await expect(object()).toHaveCount(1);
  expect(errors).toEqual([]);
  console.log(
    "PASS keyboard movement, accelerated movement, undo/redo/delete, text-input isolation and viewer guard",
  );
} finally {
  await browser.close();
}
