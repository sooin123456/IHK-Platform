import { chromium, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
const pdf = await PDFDocument.create();
pdf.addPage([800, 520]);
const buffer = Buffer.from(await pdf.save());
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const button = (name) => page.getByRole("button", { name, exact: true });
  await page.goto("http://127.0.0.1:4181/workspace-preview/flow?page=start", {
    waitUntil: "networkidle",
  });
  await page.getByLabel("빈 작업 이름", { exact: true }).fill("독립 검산");
  await button("빈 작업실 열기").click();
  await page
    .getByLabel("작업실 PDF 선택", {exact:true})
    .setInputFiles({
      name: "takeoff.pdf",
      mimeType: "application/pdf",
      buffer,
    });
  await expect(button("사각형 구상 도구")).toBeEnabled();
  await button("사각형 구상 도구").click();
  await page.getByRole("img", { name: "빈 작업 캔버스" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("수동 원수량", { exact: true }).fill("10");
  await page.getByLabel("단가 원", { exact: true }).fill("45000");
  await page.getByLabel("수량 입력 근거", { exact: true }).fill("면적표 10");
  await button("수량 근거 연결").click();
  await button("내 수량·내역 보기").click();
  const panel = page.getByRole("region", { name: "수량 검산·금액 승인" });
  await expect(panel).toContainText("450,000");
  await expect(button("수량 검산 요청")).toBeDisabled();
  await page.getByLabel("검산·승인 의견", { exact: true }).fill("면적표 검산");
  await button("수량 검산 요청").click();
  await page
    .getByLabel("수량 검토 체험 역할", { exact: true })
    .selectOption("reviewer");
  await page.getByLabel("검산·승인 의견", { exact: true }).fill("근거 보완");
  await button("수량 보완 요청").click();
  await page
    .getByLabel("수량 검토 체험 역할", { exact: true })
    .selectOption("author");
  await page
    .getByLabel("검산·승인 의견", { exact: true })
    .fill("근거 확인 후 재제출");
  await button("수량 검산 요청").click();
  await expect(panel).toContainText("검산 2차");
  await page
    .getByLabel("수량 검토 체험 역할", { exact: true })
    .selectOption("reviewer");
  await page.getByLabel("검산·승인 의견", { exact: true }).fill("수량 확인");
  await button("수량 검산 완료").click();
  await page
    .getByLabel("수량 검토 체험 역할", { exact: true })
    .selectOption("approver");
  await page
    .getByLabel("검산·승인 의견", { exact: true })
    .fill("미확정 금액 확인");
  await button("금액 승인 체험").click();
  await expect(panel).toContainText("금액 승인 체험 완료");
  const url = page.url();
  await page.reload();
  await expect(panel).toContainText("금액 승인 체험 완료");
  await page
    .getByRole("region", { name: "내 도면 수량·내역" })
    .getByRole("button", { name: "도면 근거 열기", exact: true })
    .click();
  await page
    .getByLabel("작업실 PDF 선택", {exact:true})
    .setInputFiles({
      name: "takeoff.pdf",
      mimeType: "application/pdf",
      buffer,
    });
  await expect(page.getByLabel("수동 원수량", { exact: true })).toBeEnabled();
  await page.getByLabel("수동 원수량", { exact: true }).fill("12");
  await button("수량 근거 연결").click();
  await page.goto(url);
  await expect(panel).toContainText("새 검산 필요");
  await expect(panel).toContainText("450,000");
  await expect(
    page.getByRole("region", { name: "내 도면 수량·내역" }),
  ).toContainText("540,000");
  const comparison=page.getByRole('region',{name:'승인 수량과 현재 비교'});
  await expect(comparison).toContainText('+90,000');
  await comparison.locator('summary').click();await expect(comparison).toContainText('변경');
  await comparison.screenshot({path:'/tmp/1hk-local-quantity-comparison.png'});
  await comparison.getByRole('button',{name:'현재 도면 근거 열기',exact:true}).click();
  await page.getByLabel('작업실 PDF 선택',{exact:true}).setInputFiles({name:'takeoff.pdf',mimeType:'application/pdf',buffer});
  await expect(page.getByLabel('수동 원수량',{exact:true})).toHaveValue('12');
  await button('내 수량·내역 보기').click();
  await expect(page.getByRole('region',{name:'승인 수량과 현재 비교'})).toContainText('+90,000');
  for(const [role,action] of [['author','수량 검산 요청'],['reviewer','수량 검산 완료'],['approver','금액 승인 체험']]) {
    await page.getByLabel('수량 검토 체험 역할',{exact:true}).selectOption(role);
    await page.getByLabel('검산·승인 의견',{exact:true}).fill('두 번째 승인 기준');await button(action).click();
  }
  await page.getByLabel('비교 기준 검산',{exact:true}).selectOption('2');
  await page.reload();await expect(page.getByLabel('비교 기준 검산',{exact:true})).toHaveValue('2');await expect(comparison).toContainText('+90,000');
  await comparison.locator('summary').click();await comparison.getByRole('button',{name:'현재 도면 근거 열기',exact:true}).click();
  await page.getByLabel('작업실 PDF 선택',{exact:true}).setInputFiles({name:'takeoff.pdf',mimeType:'application/pdf',buffer});
  await button('내 수량·내역 보기').click();await expect(page.getByLabel('비교 기준 검산',{exact:true})).toHaveValue('2');
  await page
    .getByLabel("수량 검토 체험 역할", { exact: true })
    .selectOption("viewer");
  await expect(button("수량 검산 요청")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({ path: "/tmp/1hk-quantity-review.png" });
  const missingBaseline=new URL(page.url());missingBaseline.searchParams.set('comparisonSequence','99');await page.goto(missingBaseline.toString());
  await expect(comparison).toContainText('선택한 승인 기록을 찾을 수 없습니다');await expect(comparison).not.toContainText('증감 +');
  await page.getByLabel('비교 기준 검산',{exact:true}).selectOption('2');await expect(comparison).toContainText('+90,000');
  await page.getByLabel('비교 대상 검산',{exact:true}).selectOption('3');await expect(comparison).toContainText('승인 #3');await expect(comparison).toContainText('+90,000');
  await page.getByLabel('비교 기준 검산',{exact:true}).selectOption('3');await page.getByLabel('비교 대상 검산',{exact:true}).selectOption('2');await expect(comparison).toContainText('-90,000');
  await page.reload();await expect(page.getByLabel('비교 대상 검산',{exact:true})).toHaveValue('2');await expect(comparison).toContainText('-90,000');
  await comparison.locator('summary').click();await comparison.screenshot({path:'/tmp/1hk-historical-quantity-comparison.png'});
  // Add a frozen drawing approval to the real quantity journey so both comparisons coexist.
  await page.evaluate(()=>{const key='1hk:workflow-preview:session:v1';const saved=JSON.parse(sessionStorage.getItem(key));const doc=saved.blankDocuments[0];doc.reviewRounds=[{revision:doc.revision??1,source:doc.source,objects:structuredClone(doc.shapes),targetId:doc.shapes[0].id,message:'도면 비교 기준',phase:'approved'}];sessionStorage.setItem(key,JSON.stringify(saved));});
  const changesUrl=new URL(page.url());changesUrl.searchParams.set('page','changes');await page.goto(changesUrl.toString());
  await expect(page.getByRole('region',{name:'내 도면 변경 비교'})).toBeVisible();await expect(comparison).toContainText('-90,000');
  const drawing=page.getByRole('region',{name:'도면 변경 오버레이'});await drawing.getByLabel('동일 객체도 표시',{exact:true}).click();await expect(drawing.getByLabel('동일 객체도 표시',{exact:true})).toBeChecked();await drawing.getByRole('button',{name:/^이전 위치:/}).first().click();await expect(page).toHaveURL(/drawingObject=/);
  const drawingContext=Object.fromEntries(['drawingRevision','drawingTarget','drawingPage','drawingObject','drawingSame'].map(key=>[key,new URL(page.url()).searchParams.get(key)]));
  await page.getByLabel('비교 대상 검산',{exact:true}).selectOption('current');await comparison.locator('summary').click();
  for(const [key,value] of Object.entries(drawingContext))expect(new URL(page.url()).searchParams.get(key)).toBe(value);
  await comparison.getByRole('button',{name:'현재 도면 근거 열기',exact:true}).click();await button('변경 비교로 돌아가기').click();
  await expect(page).toHaveURL(/page=changes/);await expect(page.getByLabel('비교 기준 검산',{exact:true})).toHaveValue('3');
  for(const [key,value] of Object.entries(drawingContext))expect(new URL(page.url()).searchParams.get(key)).toBe(value);await page.reload();await expect(drawing.getByLabel('동일 객체도 표시',{exact:true})).toBeChecked();await expect(drawing.getByRole('button',{name:'선택한 변경 항목으로 돌아가기',exact:true})).toBeVisible();
  await comparison.locator('summary').click();await comparison.getByRole('button',{name:'이전 승인 도면 근거 열기',exact:true}).click();await expect(page).toHaveURL(/snapshot=/);await button('변경 비교로 돌아가기').click();await expect(page).toHaveURL(/page=changes/);for(const [key,value] of Object.entries(drawingContext))expect(new URL(page.url()).searchParams.get(key)).toBe(value);
  await expect(page.locator('.flow-body')).not.toContainText('1,008,000');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'/tmp/1hk-local-changes-page.png',fullPage:true});
  expect(errors).toEqual([]);
  console.log(
    "PASS independent quantity correction/resubmit/review/approval, frozen amount, stale revision and mobile",
  );
} finally {
  await browser.close();
}
