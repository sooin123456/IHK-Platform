import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));const button=name=>page.getByRole('button',{name,exact:true});
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=documents&scope=local',{waitUntil:'networkidle'});
 await expect(page.locator('.flow-body')).not.toContainText('A-101');
 const list=page.getByRole('region',{name:'내 도면 목록'});await expect(list).toContainText('아직 만든 도면이 없습니다');
 for(const name of ['건축 검토 도면','토목 계획 도면']){await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});await page.getByLabel('빈 작업 이름',{exact:true}).fill(name);await button('빈 작업실 열기').click();await expect(page).toHaveURL(/blank=/);}
 await button('도면/모델').click();await expect(page).toHaveURL(/page=documents/);await expect(list.getByRole('article')).toHaveCount(2);await expect(page.locator('.flow-body')).not.toContainText('A-101');
 await page.getByLabel('내 도면 검색',{exact:true}).fill('토목');await expect(page).toHaveURL(/documentSearch=/);await expect(list.getByRole('article')).toHaveCount(1);await page.reload();await expect(list.getByRole('article')).toHaveCount(1);
 await button('토목 계획 도면 열기').click();await expect(page).toHaveURL(/blank=/);await expect(page.getByRole('heading',{name:'토목 계획 도면',exact:true})).toBeVisible();await button('도면 목록으로 돌아가기').click();await expect(page).toHaveURL(/page=documents/);await expect(page.getByLabel('내 도면 검색',{exact:true})).toHaveValue('토목');
 await page.getByLabel('내 도면 검색',{exact:true}).fill('없는 도면');await expect(list.getByRole('article')).toHaveCount(0);await button('도면 검색 초기화').click();await expect(list.getByRole('article')).toHaveCount(2);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await list.screenshot({path:'/tmp/1hk-local-documents.png'});
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scope=local',{waitUntil:'networkidle'});await expect(list.getByRole('article')).toHaveCount(2);await expect(page.locator('.flow-body')).not.toContainText('A-101');await expect(page.locator('.flow-body')).toContainText('열 도면이 지정되지 않았습니다');await button('도면/모델').click();await expect(page).toHaveURL(/page=documents/);
 await button('예시 프로젝트').click();await expect(page).toHaveURL(/scope=sample/);await expect(list).toHaveCount(0);await expect(page.getByRole('region',{name:'내 파일 가져오기 목록'})).toHaveCount(0);await expect(page.locator('.flow-body')).toContainText('A-101');expect(errors).toEqual([]);console.log('PASS local document scope isolation, empty/search/reload/exact return and explicit sample switch');
}finally{await browser.close();}
