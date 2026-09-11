import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));const button=name=>page.getByRole('button',{name,exact:true});
 for(const title of ['건축 도면','토목 도면']){
  await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});await page.getByLabel('빈 작업 이름',{exact:true}).fill(title);await button('빈 작업실 열기').click();await expect(page).toHaveURL(/blank=/);await button('사각형 구상 도구').click();await page.getByRole('img',{name:'빈 작업 캔버스'}).focus();await page.keyboard.press('Enter');
  await page.getByText('선택 객체 공식 질의 작성',{exact:true}).click();await page.getByLabel('질의 제목',{exact:true}).fill(`${title} 확인`);await page.getByLabel('질의 내용',{exact:true}).fill('치수 근거 확인');await page.getByLabel('질의 답변 기한',{exact:true}).fill('2026-10-01');await page.getByLabel('질의 답변 담당',{exact:true}).selectOption(title==='토목 도면'?'approver':'reviewer');await button('질의 등록 (체험)').click();await expect(page.getByRole('region',{name:'선택 객체 공식 질의'})).toContainText('등록했습니다');
 }
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=issues&scope=local');const inbox=page.getByRole('region',{name:'내 도면 공식 질의'});await expect(inbox.getByRole('article')).toHaveCount(2);
 await page.getByLabel('질의 검색',{exact:true}).fill('토목');await expect(page).toHaveURL(/rfiSearch=/);
 await page.getByLabel('질의 상태 필터',{exact:true}).selectOption('requested');await expect(page).toHaveURL(/rfiPhase=requested/);
 await page.getByLabel('질의 담당 필터',{exact:true}).selectOption('approver');await expect(page).toHaveURL(/rfiAssignee=approver/);
 await page.getByLabel('질의 처리 역할',{exact:true}).selectOption('approver');await expect(page).toHaveURL(/rfiRole=approver/);
 await expect(inbox.getByRole('article')).toHaveCount(1);await expect(inbox).not.toContainText('건축 도면 확인');await button('RFI #1 도면 위치').click();await expect(page).toHaveURL(/rfiReturn=/);await expect(page.getByRole('heading',{name:'토목 도면',exact:true})).toBeVisible();await button('질의 목록으로 돌아가기').click();await expect(page).toHaveURL(/page=issues/);
 await expect(page.getByLabel('질의 검색',{exact:true})).toHaveValue('토목');await expect(page.getByLabel('질의 담당 필터',{exact:true})).toHaveValue('approver');await expect(page.getByLabel('질의 처리 역할',{exact:true})).toHaveValue('approver');await page.reload();await expect(inbox.getByRole('article')).toHaveCount(1);
 await page.getByLabel('질의 검색',{exact:true}).fill('없는 질의');await expect(inbox.getByRole('article')).toHaveCount(0);await button('질의 필터 초기화').click();await expect(inbox.getByRole('article')).toHaveCount(2);
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=tasks&scope=local&rfiRole=reviewer');const tasks=page.getByRole('region',{name:'내 질의 할 일'});await expect(tasks.getByRole('article')).toHaveCount(1);await expect(tasks).toContainText('건축 도면 확인');await expect(tasks).not.toContainText('토목 도면 확인');
 await button('RFI #1 도면 위치').click();await expect(page).toHaveURL(/rfiReturn=tasks/);await button('질의 목록으로 돌아가기').click();await expect(page).toHaveURL(/page=tasks/);await expect(page.getByLabel('질의 처리 역할',{exact:true})).toHaveValue('reviewer');
 await page.getByLabel('RFI #1 처리 의견',{exact:true}).fill('치수 확인 완료');await button('RFI #1 답변 보관').click();await expect(tasks.getByRole('article')).toHaveCount(0);
 await page.getByLabel('질의 처리 역할',{exact:true}).selectOption('author');await expect(tasks.getByRole('article')).toHaveCount(1);await page.getByLabel('RFI #1 처리 의견',{exact:true}).fill('답변 확인 후 종결');await button('RFI #1 종결 보관').click();await expect(tasks.getByRole('article')).toHaveCount(0);
 await page.getByLabel('질의 처리 역할',{exact:true}).selectOption('approver');await expect(page).toHaveURL(/rfiRole=approver/);await expect(tasks).toContainText('토목 도면 확인');await page.getByLabel('질의 처리 역할',{exact:true}).selectOption('viewer');await expect(page).toHaveURL(/rfiRole=viewer/);await expect(tasks.getByRole('article')).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await tasks.screenshot({path:'/tmp/1hk-rfi-inbox.png'});expect(errors).toEqual([]);console.log('PASS multi-document RFI filters, URL/reload/return context, role queues and resolved task removal');
}finally{await browser.close();}
