import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
const errors = [];
try {
 for (const width of [1360,390]) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=workspace",
    { waitUntil: "networkidle" },
  );
  await page
    .getByRole("button", { name: "데모 시나리오", exact: true })
    .click();
  const selector = page.locator(".flow-demo select").nth(2);
  for (const id of [
    "empty",
    "loading",
    "unsupported",
    "required",
    "stale",
    "missing",
    "permission",
    "expired",
    "offline",
    "ai",
  ]) {
    await selector.selectOption(id);
    await expect(
      page.getByLabel("예외 상태 복구", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if (["empty", "loading", "unsupported", "expired"].includes(id))
      await expect(
        page.getByLabel("도면·모델 작업 캔버스", { exact: true }),
      ).toHaveCount(0);
  }
  await selector.selectOption("permission");
  await expect(page.locator(".flow-heading")).toContainText("보기 전용");
  await expect(
    page.getByRole("button", { name: "변경안 적용", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "편집 권한 요청 작성", exact: true })
    .click();
  await expect(
    page.getByLabel("예외 상태 복구", { exact: true }).getByRole("status"),
  ).toContainText("실제 전송하지 않았습니다");
  await selector.selectOption("missing");
  await expect(
    page.getByRole("button", { name: "동일 원본 재연결 체험", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("복구 대상 원본", { exact: true })
    .selectOption("PDF-01");
  await page
    .getByLabel("예외 상태 복구", { exact: true })
    .getByRole("checkbox")
    .check();
  await page
    .getByRole("button", { name: "동일 원본 재연결 체험", exact: true })
    .click();
  await expect(page.getByLabel("예외 상태 복구", { exact: true })).toHaveCount(
    0,
  );
  await selector.selectOption("unsupported");
  await page
    .getByRole("button", { name: "재시도 화면 보기", exact: true })
    .click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await page
    .getByRole("button", { name: "완료 상황 체험", exact: true })
    .click();
  await selector.selectOption("required");
  await expect(
    page.getByRole("button", { name: "설정 확인 후 계속", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "누락 설정 열기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "축척 설정 체험", exact: true })
    .click();
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "설정 확인 후 계속", exact: true })
    .click();
  await selector.selectOption("stale");
  await page
    .getByRole("button", { name: "산출 결과 다시 확인", exact: true })
    .click();
  await page
    .getByRole("button", { name: "산출 결과 확인 체험", exact: true })
    .click();
  await page
    .getByRole("button", { name: "현재 화면으로 돌아가기", exact: true })
    .click();
  await page
    .getByRole("button", { name: "갱신 확인 후 계속", exact: true })
    .click();
  await selector.selectOption("ai");
  await page
    .getByRole("button", {
      name: "AI 없이 계속 · 미검사 상태 확인",
      exact: true,
    })
    .click();
  await selector.selectOption("offline");
  await page.getByRole("button", { name: "변경안 적용", exact: true }).click();
  await expect(
    page.getByLabel("예외 상태 복구", { exact: true }),
  ).toContainText("28 m²");
  await page.getByLabel("복구 방식", { exact: true }).selectOption("keep");
  await page
    .getByRole("button", { name: "현재 작업 유지 · 재연결 체험", exact: true })
    .click();
  await expect(
    page.getByLabel("도면·모델 작업 캔버스", { exact: true }),
  ).toContainText("28 m²");
  await selector.selectOption("expired");
  await page
    .getByRole("button", { name: "새 링크 요청 작성", exact: true })
    .click();
  await expect(
    page.getByLabel("예외 상태 복구", { exact: true }).getByRole("status"),
  ).toContainText("실제 링크 생성");
  await page.screenshot({
    path: `/tmp/1hk-workflow-expired-${width}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "내 프로젝트로 돌아가기", exact: true })
    .click();
  await expect(page).toHaveURL(/page=projects/);
  await selector.selectOption("empty");
  await page
    .getByRole("button", { name: "첫 자료 준비하기", exact: true })
    .click();
  await expect(page).toHaveURL(/page=start/);
  await page.close();
  console.log(`PASS ${width}: ten exception views and recovery actions`);
 }
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS: desktop/mobile exceptions; permission denial, reconnect identity, retry, offline draft retention, expired exit; no overflow or pageerrors",
  );
} finally {
  await browser.close();
}
