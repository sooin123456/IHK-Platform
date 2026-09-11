import { chromium, expect } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';
const pdf=await PDFDocument.create();pdf.addPage([800,520]);
const source={name:'delivery.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
const browser=await chromium.launch();
let activePage;
try {
 const page=await browser.newPage();activePage=page;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const button=name=>page.getByRole('button',{name,exact:true});
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});
 await page.getByLabel('빈 작업 이름',{exact:true}).fill('납품 근거');await button('빈 작업실 열기').click();
 await page.getByLabel('작업실 PDF 선택',{exact:true}).setInputFiles(source);
 await expect(page.locator('.flow-local-pdf-surface [aria-busy="false"]')).toHaveCount(1);
 await expect(button('사각형 구상 도구')).toBeEnabled();await button('사각형 구상 도구').click();
 await page.getByRole('img',{name:'빈 작업 캔버스'}).focus();await page.keyboard.press('Enter');
 await page.getByLabel('수동 원수량',{exact:true}).fill('10');await page.getByLabel('단가 원',{exact:true}).fill('45000');
 await page.getByLabel('수량 입력 근거',{exact:true}).fill('승인 면적표');await button('수량 근거 연결').click();await button('내 수량·내역 보기').click();
 for(const [role,action] of [['author','수량 검산 요청'],['reviewer','수량 검산 완료'],['approver','금액 승인 체험']]) {
  await page.getByLabel('수량 검토 체험 역할',{exact:true}).selectOption(role);await page.getByLabel('검산·승인 의견',{exact:true}).fill(`${role} 근거 확인`);await button(action).click();
 }
 await page.getByRole('region',{name:'내 도면 수량·내역'}).getByRole('button',{name:'도면 근거 열기',exact:true}).click();
 await page.getByLabel('작업실 PDF 선택',{exact:true}).setInputFiles(source);
 for(const [role,action] of [['author','선택 객체 검토 요청'],['reviewer','검토 완료하기'],['approver','이 개정 승인하기']]) {
  await page.getByLabel('도면 검토 체험 역할',{exact:true}).selectOption(role);await page.getByLabel('도면 검토 의견',{exact:true}).fill(`${role} 도면 확인`);await button(action).click();
 }
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=delivery&scope=local');
 await page.getByLabel('납품 근거 포함할 검산 결과').selectOption('1');await page.getByLabel('납품 근거 수신 대상').fill('발주처');await button('납품 구성 준비').click();
 const output=page.getByRole('region',{name:'승인본 출력 준비'}).first();
 await expect(output).toContainText('검산 #1');
 const beforeOutput=await page.evaluate(()=>sessionStorage.getItem('1hk:workflow-preview:session:v1'));
 await output.getByRole('button',{name:'출력 준비 체험',exact:true}).click();
 await page.reload();await expect(output).toContainText('출력 준비 중');
 await output.getByLabel('출력 결과 체험').selectOption('failed');
 await output.getByRole('button',{name:'결과 확인',exact:true}).click();
 await expect(output.getByRole('alert')).toContainText('실패');
 await page.reload();await expect(output.getByRole('alert')).toContainText('실패');
 await output.getByRole('button',{name:'출력 다시 준비',exact:true}).click();
 await output.getByRole('button',{name:'출력 준비 취소',exact:true}).click();await page.reload();await expect(output).toContainText('상태: 취소');
 await output.getByRole('button',{name:'출력 준비 체험',exact:true}).click();
 await output.getByLabel('출력 결과 체험').selectOption('ready');
 await output.getByRole('button',{name:'결과 확인',exact:true}).click();
 await expect(output.getByRole('status')).toContainText('준비 완료 예시');
 await page.reload();await expect(output).toContainText('준비 완료 예시');
 const afterOutput=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:workflow-preview:session:v1')));const before=JSON.parse(beforeOutput);
 const changed=afterOutput.blankDocuments.find(doc=>doc.title==='납품 근거');expect(changed.delivery.output.phase).toBe('ready');expect(changed.delivery.output.attempt).toBe(3);
 delete changed.delivery.output;expect(afterOutput).toEqual(before);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await output.screenshot({path:'/tmp/1hk-output-preparation.png'});
 await page.getByLabel('납품 근거 포함할 검산 결과').selectOption('1');await page.getByLabel('납품 근거 수신 대상').fill('발주처 재구성');await button('납품 구성 다시 만들기').click();await expect(output).toContainText('출력 시도 0회');
 await page.getByText('이전 납품 구성 (1)',{exact:true}).click();const history=page.getByRole('region',{name:'이전 납품 구성'});await expect(history).toContainText('출력 시도 3회');await expect(history).toContainText('준비 완료 예시');await expect(history.getByRole('button',{name:'다시 출력 준비',exact:true})).toHaveCount(0);
 await page.reload();await expect(output).toContainText('출력 시도 0회');
 await button('독립 수신 화면 열기').click();
 const report=page.getByRole('region',{name:'납품 수량 검산 결과'});
 await expect(report).toContainText('450,000');await report.locator('summary').click();await expect(report).toContainText('승인 면적표');
 await expect(report).toContainText('수동 입력 단가');
 await page.reload();await expect(report).toContainText('450,000');
 await page.setViewportSize({width:390,height:844});await report.locator('summary').click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await report.screenshot({path:'/tmp/1hk-quantity-delivery.png'});
 await page.getByLabel('수신자 확인 의견').fill('근거와 금액 확인');await button('수신 확인 기록 (체험)').click();await expect(page.getByRole('status')).toContainText('근거와 금액 확인');
 expect(errors).toEqual([]);console.log('PASS local quantity approval → drawing approval → selected delivery → pinned recipient evidence, reload, mobile and receipt');
} catch(error) {console.error(await activePage?.locator('body').innerText());throw error;} finally {await browser.close();}
