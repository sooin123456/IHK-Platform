import { chromium, expect } from "@playwright/test";
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto(
    "http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scenario=civil",
    { waitUntil: "networkidle" },
  );
  await expect(button("외부 검토 공유")).toBeVisible();
  await button("외부 검토 공유").click();
  await expect(button("수신자 화면 미리보기")).toBeDisabled();
  await page
    .getByLabel("공유 수신자 이메일", { exact: true })
    .fill("reviewer@example.com");
  await button("수신자 화면 미리보기").click();
  const guest = page.getByLabel("수신자 열람 화면", { exact: true });
  const invitation=page.getByRole('region',{name:'초대 확인'});
  await expect(guest).toHaveCount(0);
  await invitation.getByLabel('접속 계정 체험').selectOption('other');
  await expect(button('초대 수락 후 열기 (체험)')).toBeDisabled();
  await invitation.getByLabel('접속 계정 체험').selectOption('signed-out');
  await expect(button('초대 수락 후 열기 (체험)')).toBeDisabled();
  await button('초대 계정으로 전환 체험').click();
  await page.setViewportSize({width:390,height:844});
  expect(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await invitation.screenshot({path:'/tmp/1hk-invitation.png'});
  await button('초대 거절 (체험)').click();await expect(guest).toHaveCount(0);
  await button('초대 다시 확인').click();
  await button('초대 수락 후 열기 (체험)').click();
  await expect(guest).toContainText("CIVIL-01");
  await expect(guest).not.toContainText("5,100,000");
  await page
    .getByLabel("수신자 검토 의견", { exact: true })
    .fill("구간 끝점 근거 확인");
  await button("의견 예시 보관").click();
  await button("현재 화면으로 돌아가기").click();
  await button("변경안 적용").click();
  await page.reload({ waitUntil: "networkidle" });
  await button("외부 검토 공유").click();
  await expect(
    page.getByLabel("외부 공유 미리보기", { exact: true }),
  ).toContainText("구간 끝점 근거 확인");
  await button("보관된 수신자 화면 열기").click();
  await expect(guest).toContainText("60 m");
  await expect(guest).toContainText("현재 개정과 다른 고정 범위");
  await page.screenshot({
    path: "/tmp/1hk-external-review-preview.png",
    fullPage: true,
  });
  await button("접근 종료 상태 체험").click();
  await expect(guest).toHaveCount(0);
  await expect(
    page.getByLabel("외부 공유 미리보기", { exact: true }),
  ).toContainText("접근이 종료된 화면 예시");
  await page.getByLabel('접근 요청 사유',{exact:true}).fill('기존 검토 의견을 다시 확인해야 합니다');
  await button('접근 요청 기록 (체험)').click();
  await expect(guest).toHaveCount(0);
  await button('소유자 판단 화면 체험').click();
  await page.getByLabel('접근 판단 사유',{exact:true}).fill('재열람 목적을 보완하세요');
  await button('접근 요청 거절 (체험)').click();
  await expect(guest).toHaveCount(0);
  await expect(page.getByLabel('외부 공유 미리보기',{exact:true}).getByRole('status')).toContainText('재열람 목적을 보완하세요');
  await button('사유 보완 후 다시 요청').click();
  await page.getByLabel('접근 요청 사유',{exact:true}).fill('이전 구간 끝점 검토 이력을 확인합니다');
  await button('접근 요청 기록 (체험)').click();
  await button('소유자 판단 화면 체험').click();
  await page.setViewportSize({width:390,height:844});
  expect(await page.getByRole('dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1)).toBe(true);
  await page.getByRole('dialog').screenshot({path:'/tmp/1hk-access-request.png'});
  await page.getByLabel('접근 판단 사유',{exact:true}).fill('동일한 공개 범위만 허용');
  await button('기존 범위 재열람 허용 (체험)').click();
  await expect(guest).toContainText('60 m');
  await expect(guest).not.toContainText('5,610,000');
  await button('접근 종료 상태 체험').click();
  await button("공유 설정으로 돌아가기").click();
  await page.getByLabel("공유 권한", { exact: true }).selectOption("view");
  await page
    .getByRole("checkbox", { name: "금액 예시도 공개", exact: true })
    .check();
  await button("새 미리보기 구성 · 기존 예시 교체").click();
  await expect(invitation).toContainText('보기 전용');
  await button('초대 수락 후 열기 (체험)').click();
  await expect(guest).toContainText("5,610,000");
  await expect(
    page.getByLabel("수신자 검토 의견", { exact: true }),
  ).toHaveCount(0);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(
    "PASS share scope/privacy, guest feedback retention, frozen revision, expiry and read-only regeneration without messaging",
  );
} finally {
  await browser.close();
}
