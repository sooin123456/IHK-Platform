import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:4181/workspace-preview/flow';
 await page.goto(`${base}?page=library`,{waitUntil:'networkidle'});await page.getByLabel('템플릿 작업 이름',{exact:true}).fill('시공 검토도');await page.getByRole('button',{name:'이 템플릿으로 작업 만들기',exact:true}).click();await expect(page).toHaveURL(/blank=/);
 await page.locator('[data-project-section="검토"]').click();await page.getByRole('navigation',{name:'검토 세부 화면'}).getByRole('button',{name:'제출물 검토',exact:true}).click();await expect(page).toHaveURL(/page=submittals/);const region=page.getByRole('region',{name:'제출물 검토'});
 await expect(page.locator('.flow-heading')).not.toContainText('건축 / R');
 await expect(page.locator('.flow-heading .flow-eyebrow')).toHaveText('내 작업공간');
 await region.getByLabel('제출 제목',{exact:true}).fill('1층 시공도');await region.getByLabel('검토 기한',{exact:true}).fill('2026-09-30');await region.getByLabel('제출 설명',{exact:true}).fill('치수 검토 부탁드립니다');await region.getByRole('button',{name:'현재 도면 제출',exact:true}).click();
 await expect(region.getByRole('heading',{name:'#1 · 1층 시공도',exact:true})).toBeVisible();await page.reload();await expect(region.getByRole('heading',{name:'#1 · 1층 시공도',exact:true})).toBeVisible();
 await region.getByLabel('제출물 역할 체험',{exact:true}).selectOption('reviewer');await region.getByLabel('검토 의견 1',{exact:true}).fill('출입 공간을 보완하세요');await region.getByRole('button',{name:'보완 요청 1',exact:true}).click();
 await expect(region).toContainText('출입 공간을 보완하세요');await region.getByLabel('제출물 역할 체험',{exact:true}).selectOption('author');await region.getByRole('button',{name:'재제출 준비 1',exact:true}).click();
 await region.getByLabel('제출 설명',{exact:true}).fill('출입 공간 검토 설명을 보완했습니다');await region.getByRole('button',{name:'현재 도면 재제출',exact:true}).click();await expect(region.getByRole('heading',{name:'#2 · 1층 시공도',exact:true})).toBeVisible();
 await region.getByLabel('제출물 역할 체험',{exact:true}).selectOption('reviewer');await region.getByLabel('검토 의견 2',{exact:true}).fill('제출 내용 확인');await region.getByRole('button',{name:'제출물 수락 2',exact:true}).click();await page.reload();await expect(region).toContainText('수락');await expect(region).toContainText('출입 공간을 보완하세요');
 await region.getByRole('button',{name:'현재 도면 확인 2',exact:true}).click();await expect(page).toHaveURL(/blank=/);await page.getByRole('button',{name:'제출물 검토로 돌아가기',exact:true}).click();await expect(page).toHaveURL(/page=submittals/);
 const data=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:workflow-preview:session:v1')));expect(data.blankDocuments[0].reviewRounds??[]).toHaveLength(0);expect(data.blankDocuments[0].submittals.map(item=>item.phase)).toEqual(['changes','accepted']);
 await region.getByLabel('제출물 역할 체험',{exact:true}).selectOption('author');await region.getByLabel('제출 설명',{exact:true}).fill('추가 검토');await region.getByRole('button',{name:'현재 도면 제출',exact:true}).click();await expect(region.getByRole('heading',{name:'#3 · 1층 시공도',exact:true})).toBeVisible();
 await page.goto(`${base}?page=workspace&blank=${data.blankDocuments[0].id}&localRole=author`);await page.getByRole('button',{name:'회의실 구상 객체',exact:true}).click();await page.getByLabel('구상 객체 이름',{exact:true}).fill('변경된 회의실');
 await page.goto(`${base}?page=submittals&submissionRole=reviewer`);await expect(region.getByRole('button',{name:'제출물 수락 3',exact:true})).toBeDisabled();await expect(region.getByRole('button',{name:'현재 도면 확인 3',exact:true})).toBeDisabled();await expect(region.getByRole('button',{name:'보완 요청 3',exact:true})).toBeEnabled();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await region.screenshot({path:'/tmp/1hk-submittals.png'});expect(errors).toEqual([]);console.log('PASS submission, return/resubmit history, acceptance isolation, stale drawing guard, reload and workspace return/mobile');
}finally{await browser.close();}
