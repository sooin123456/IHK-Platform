import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=quantities",
    { waitUntil: "networkidle" },
  );
  const button = (name) => page.getByRole("button", { name, exact: true });
  await expect(button("내 도면")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("region", { name: "내 도면 수량·내역" }),
  ).toBeVisible();
  await expect(
    page.getByText("근거가 연결된 산출 항목", { exact: true }),
  ).toHaveCount(0);
  await button("예시 프로젝트").click();
  await expect(
    page.getByText("근거가 연결된 산출 항목", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "내 도면 수량·내역" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(button("예시 프로젝트")).toHaveAttribute("aria-pressed", "true");
  await button("내 도면").click();
  await button("내역서").click();
  await expect(button("내 도면")).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("region", { name: "내 도면 수량·내역" }),
  ).toBeVisible();
  for (const route of ["tasks", "reviews", "delivery"]) {
    await page.goto(
      `http://127.0.0.1:4181/workspace-preview/flow?page=${route}&scope=local`,
      { waitUntil: "networkidle" },
    );
    await expect(button("내 도면")).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByRole("region", { name: "예시 프로젝트 업무" }),
    ).toHaveCount(0);
    await button("예시 프로젝트").click();
    await expect(
      page.getByRole("region", { name: "예시 프로젝트 업무" }),
    ).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/1hk-workflow-scope-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
  console.log(
    "PASS local/sample separation, empty local scope, reload/navigation persistence and mobile",
  );
} finally {
  await browser.close();
}
