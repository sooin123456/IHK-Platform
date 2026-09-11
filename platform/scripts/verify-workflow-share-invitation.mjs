import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const button=name=>page.getByRole('button',{name,exact:true});
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});
 await page.getByLabel('빈 작업 이름',{exact:true}).fill('초대 검토 도면');await button('빈 작업실 열기').click();await expect(page).toHaveURL(/blank=/);
 await page.getByText('내 도면 공유 설정',{exact:true}).click();await page.getByLabel('내 도면 공유 수신자',{exact:true}).fill('guest@example.com');await page.getByLabel('내 도면 공유 권한',{exact:true}).selectOption('comment');await button('공유 구성 보관 (체험)').click();await button('공유 #1 받는 사람 화면').click();await expect(page).toHaveURL(/sharedDocument=/);
 const url=page.url();await expect(page.getByRole('heading',{name:'도면 공유 초대'})).toBeVisible();await expect(page.getByRole('img',{name:'공유 도면 표시'})).toHaveCount(0);await expect(page.getByLabel('공유 도면 의견',{exact:true})).toHaveCount(0);
 await page.getByLabel('초대 확인 이메일',{exact:true}).fill('wrong@example.com');await button('초대 수락 (체험)').click();await expect(page.getByRole('alert')).toContainText('받는 사람 이메일과 일치하지 않습니다');await expect(page.getByRole('img',{name:'공유 도면 표시'})).toHaveCount(0);
 await page.getByLabel('초대 확인 이메일',{exact:true}).fill('GUEST@example.com');await button('초대 수락 (체험)').click();await expect(page.getByRole('img',{name:'공유 도면 표시'})).toBeVisible();await page.reload();await expect(page.getByRole('img',{name:'공유 도면 표시'})).toBeVisible();
 await button('보내는 사람 작업실').click();await expect(page).toHaveURL(/blank=/);await page.getByText('내 도면 공유 설정',{exact:true}).click();await expect(page.getByRole('region',{name:'내 도면 공유'})).toContainText('초대 수락됨');await page.getByLabel('내 도면 공유 수신자',{exact:true}).fill('other@example.com');await button('공유 구성 보관 (체험)').click();await button('공유 #2 받는 사람 화면').click();await expect(page).toHaveURL(/share=2/);
 await page.getByLabel('초대 확인 이메일',{exact:true}).fill('other@example.com');await button('초대 거절 (체험)').click();await expect(page.getByRole('heading',{name:'초대를 거절했습니다'})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'초대를 거절했습니다'})).toBeVisible();await expect(button('초대 수락 (체험)')).toHaveCount(0);await expect(page.getByRole('img',{name:'공유 도면 표시'})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'/tmp/1hk-share-invitation.png',fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.goto(url);await expect(page.getByRole('img',{name:'공유 도면 표시'})).toBeVisible();expect(errors).toEqual([]);console.log('PASS invitation email mismatch, accept/reload, decline/reload, exact-share isolation, mobile');
}finally{await browser.close();}
