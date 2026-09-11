import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
const browser = await chromium.launch({
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scenario=ifc",
    { waitUntil: "networkidle" },
  );
  await button("3D 모델").click();
  const host = page.getByLabel("회전 가능한 시나리오 3D 모델", { exact: true });
  await expect(host.locator("canvas")).toBeVisible();
  const digest = async () =>
    createHash("sha256")
      .update(await host.screenshot())
      .digest("hex");
  const original = await digest();
  const bounds = await host.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width * 0.55,
    bounds.y + bounds.height * 0.45,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.75,
    bounds.y + bounds.height * 0.52,
    { steps: 12 },
  );
  await page.mouse.up();
  const rotated = await digest();
  expect(rotated).not.toBe(original);
  await host.screenshot({ path: "/tmp/1hk-3d-rotated.png" });
  await page
    .getByRole("checkbox", { name: "그리드·축선", exact: true })
    .uncheck();
  await page
    .getByRole("checkbox", { name: "그리드·축선", exact: true })
    .check();
  await expect
    .poll(digest, {
      timeout: 5000,
      message: "Grid toggling must not reset the rotated camera",
    })
    .toBe(rotated);
  await button("모델 단면").click();
  await expect(button("모델 단면")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(digest).not.toBe(rotated);
  await host.screenshot({ path: "/tmp/1hk-3d-section.png" });
  await button("모델 단면").click();
  await expect.poll(digest).toBe(rotated);
  await button("선택 객체 단독 표시").click();
  await host.screenshot({ path: "/tmp/1hk-3d-isolated.png" });
  await button("선택 객체 단독 표시").click();
  await expect.poll(digest).toBe(rotated);
  await button("2D 도면").click();
  await button("3D 모델").click();
  await expect
    .poll(digest, {
      message: "Switching to 2D and back must preserve the camera",
    })
    .toBe(rotated);
  await button("시점 초기화").click();
  await button("3D 모델").focus();
  await page.mouse.move(0, 0);
  await expect.poll(digest).toBe(original);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS real WebGL sample render, rotation, grid/section/isolation camera preservation and explicit reset",
  );
} finally {
  await browser.close();
}
