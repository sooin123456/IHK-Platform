import {chromium,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
const pdf=await PDFDocument.create();pdf.addPage([800,520]);const buffer=Buffer.from(await pdf.save());
const browser=await chromium.launch();
try {
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const button=name=>page.getByRole('button',{name,exact:true});
 for(const name of ['다른 도면','확인 대상']) {
  await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});await page.getByLabel('빈 작업 이름',{exact:true}).fill(name);await button('빈 작업실 열기').click();
 }
 await page.locator('summary').filter({hasText:'다음 확인할 항목'}).click();const findings=page.getByRole('region',{name:'내 도면 확인할 항목'});
 await expect(findings).toContainText('원본 PDF 연결 필요');await button('PDF 연결 위치로').click();await expect(page.getByLabel('작업실 PDF 선택',{exact:true})).toBeFocused();
 await page.getByLabel('작업실 PDF 선택',{exact:true}).setInputFiles({name:'basis.pdf',mimeType:'application/pdf',buffer});await expect(page.locator('.flow-local-pdf-surface [aria-busy="false"]')).toHaveCount(1);
 await button('사각형 구상 도구').click();await page.getByRole('img',{name:'빈 작업 캔버스'}).focus();await page.keyboard.press('Enter');
 const exact=await page.evaluate(()=>{const docs=JSON.parse(sessionStorage.getItem('1hk:workflow-preview:session:v1')).blankDocuments;const doc=docs.find(doc=>doc.title==='확인 대상');return {id:doc.id,object:doc.shapes[0].id};});
 await button('개요').click();await expect(page).toHaveURL(/page=overview/);
 const overview=page.getByRole('region',{name:'내 도면 진행 개요'});await overview.getByText('확인할 일 펼치기',{exact:true}).last().click();
 await overview.getByRole('button',{name:/확인 대상.*수량 미등록/}).click();await expect(page).toHaveURL(new RegExp(`target=${exact.object}`));await expect(page.getByLabel('선택할 객체')).toHaveValue(exact.object);
 await expect(page.locator('.flow-local-pdf-surface [aria-busy="false"]')).toHaveCount(1);
 await button('진행 개요로 돌아가기').click();await expect(page).toHaveURL(/page=overview/);
 await overview.getByRole('button',{name:'확인 대상 도면 열기',exact:true}).click();await expect(page).toHaveURL(new RegExp(`blank=${exact.id}`));
 await expect(page.locator('.flow-local-pdf-surface [aria-busy="false"]')).toHaveCount(1);
 await page.getByText('원본 보관·재연결 안내',{exact:true}).click();await button('이 원본 임시 보관 해제').click();await expect(page.locator('.flow-local-pdf-surface')).toHaveCount(0);
 await page.getByLabel('작업실 PDF 선택',{exact:true}).setInputFiles({name:'basis.pdf',mimeType:'application/pdf',buffer});await expect(page.locator('.flow-local-pdf-surface [aria-busy="false"]')).toHaveCount(1);
 await page.locator('summary').filter({hasText:'다음 확인할 항목'}).click();
 await expect(findings).toContainText('수량 미등록');await findings.getByRole('button',{name:/수량 근거 확인/}).click();await expect(page.getByRole('heading',{name:'수량',exact:true})).toBeFocused();
 await page.getByLabel('수동 원수량',{exact:true}).fill('10');await page.getByLabel('단가 원',{exact:true}).fill('45000');await page.getByLabel('수량 입력 근거',{exact:true}).fill('면적표');await button('수량 근거 연결').click();
 await expect(findings.getByRole('list')).not.toContainText('수량 미등록');await expect(findings).toContainText('수량 검산 요청 필요');await button('검산 화면 열기').click();
 await expect(page).toHaveURL(/quantityDocument=/);
 await expect(page.getByLabel('검산할 도면')).toHaveValue(new URL(page.url()).searchParams.get('quantityDocument'));
 await expect(page.getByLabel('검산할 도면').locator('option:checked')).toHaveText('확인 대상');
 await page.getByLabel('검산·승인 의견',{exact:true}).fill('목록에서 이어갈 요청');await button('수량 검산 요청').click();
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=tasks&scope=local');
 const inbox=page.getByRole('region',{name:'내 수량 검산 목록'});await expect(inbox).toContainText('목록에서 이어갈 요청');
 await page.getByLabel('검산 요청 검색',{exact:true}).fill('없는 요청');await expect(inbox.getByRole('button',{name:'검산 대상 열기'})).toHaveCount(0);await button('검산 검색 초기화').click();
 await inbox.getByRole('button',{name:'검산 대상 열기'}).click();await expect(page.getByLabel('검산할 도면').locator('option:checked')).toHaveText('확인 대상');
 for(const [role,action] of [['reviewer','수량 검산 완료'],['approver','금액 승인 체험']]) {await page.getByLabel('수량 검토 체험 역할',{exact:true}).selectOption(role);await page.getByLabel('검산·승인 의견',{exact:true}).fill('목록 연계 확인');await button(action).click();}
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=tasks&scope=local');await expect(inbox.getByRole('button',{name:'검산 대상 열기'})).toHaveCount(0);
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=reviews&scope=local');await expect(inbox).toContainText('금액 승인 완료');await page.reload();await expect(inbox).toContainText('450,000');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await inbox.screenshot({path:'/tmp/1hk-quantity-inbox.png'});
 expect(errors).toEqual([]);console.log('PASS local findings source focus, exact object quantity action, automatic resolution and second-document review handoff');
}finally{await browser.close();}
