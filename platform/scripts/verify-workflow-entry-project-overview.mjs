import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:4181/workspace-preview/flow';
 await page.goto(base,{waitUntil:'networkidle'});await expect(page.getByRole('heading',{level:1,name:'시작 홈',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'프로젝트 목록',exact:true}).click();
 await expect(page.locator('[data-project-card]')).toHaveCount(0);
 const projects=page.getByRole('region',{name:'내 프로젝트'});
 for(const name of ['건축 프로젝트','토목 프로젝트']){
  await projects.getByLabel('새 프로젝트 이름',{exact:true}).fill(name);await projects.getByRole('button',{name:'프로젝트 만들기',exact:true}).click();
  await page.getByLabel('빈 작업 이름',{exact:true}).fill(`${name} 도면`);await page.getByRole('button',{name:'빈 작업실 열기',exact:true}).click();await expect(page).toHaveURL(/blank=/);
  await page.goto(base,{waitUntil:'networkidle'});await expect(page.getByRole('heading',{level:1,name:'프로젝트 목록',exact:true})).toBeVisible();
 }
 const card=page.locator('[data-local-project]').filter({has:page.getByRole('heading',{name:'건축 프로젝트',exact:true})});
 await card.getByRole('button',{name:'프로젝트 개요 열기',exact:true}).click();
 const overview=page.getByRole('region',{name:'내 도면 진행 개요'});await expect(overview.getByRole('heading',{name:'건축 프로젝트 도면',exact:true})).toBeVisible();await expect(overview.getByRole('heading',{name:'토목 프로젝트 도면',exact:true})).toHaveCount(0);
 await overview.getByRole('button',{name:'건축 프로젝트 도면 도면 열기',exact:true}).click();await expect(page).toHaveURL(/blank=/);await page.getByRole('button',{name:'개요',exact:true}).click();await expect(overview.getByRole('heading',{name:'건축 프로젝트 도면',exact:true})).toBeVisible();await expect(overview.getByRole('heading',{name:'토목 프로젝트 도면',exact:true})).toHaveCount(0);
 await page.reload({waitUntil:'networkidle'});await expect(overview.getByRole('heading',{name:'건축 프로젝트 도면',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'도면/모델',exact:true}).click();
 const documents=page.getByRole('region',{name:'내 도면 목록'});await expect(documents.getByRole('heading',{name:'건축 프로젝트 도면',exact:true})).toBeVisible();await expect(documents.getByRole('heading',{name:'토목 프로젝트 도면',exact:true})).toHaveCount(0);
 await documents.getByLabel('내 도면 검색',{exact:true}).fill('건축');await documents.getByRole('button',{name:'건축 프로젝트 도면 열기',exact:true}).click();await expect(page).toHaveURL(/blank=/);await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'도면 목록으로 돌아가기',exact:true}).click();await expect(documents.getByLabel('내 도면 검색',{exact:true})).toHaveValue('건축');await expect(documents.getByRole('heading',{name:'토목 프로젝트 도면',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'모든 도면 목록 보기',exact:true}).click();await expect(documents.getByRole('heading',{name:'토목 프로젝트 도면',exact:true})).toBeVisible();
 await page.goto(`${base}?page=overview&scope=local&project=missing`,{waitUntil:'networkidle'});await expect(page.getByRole('alert').filter({hasText:'프로젝트를 찾을 수 없습니다'})).toBeVisible();await expect(overview).toHaveCount(0);
 await page.goto(`${base}?page=projects`,{waitUntil:'networkidle'});await page.getByRole('button',{name:'예시 프로젝트 둘러보기',exact:true}).click();await expect(page.locator('[data-project-card]')).toHaveCount(2);await expect(projects).toHaveCount(0);
 await page.getByRole('button',{name:'내 프로젝트로 돌아가기',exact:true}).click();await expect(projects).toBeVisible();await expect(page.locator('[data-project-card]')).toHaveCount(0);
 await page.goto(`${base}?page=home`,{waitUntil:'networkidle'});await expect(page.getByRole('heading',{level:1,name:'시작 홈',exact:true})).toBeVisible();
 await page.goto(base,{waitUntil:'networkidle'});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();await page.screenshot({path:'/tmp/1hk-project-entry.png',fullPage:true});expect(errors).toEqual([]);
 console.log('PASS new/returning entry, explicit home, opt-in examples, project-only overview/reload/return and missing-project guard');
}finally{await browser.close();}
