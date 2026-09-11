import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const library='http://127.0.0.1:4181/workspace-preview/flow?page=library';
 await page.goto(library,{waitUntil:'networkidle'});
 const title=page.getByLabel('템플릿 작업 이름',{exact:true});const civil=page.getByRole('button',{name:/철도·토목 구간 검토.*노선/});
 await civil.click();await title.fill('교량 구간 검토 초안');
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=projects');await page.goto(library);
 await expect(title).toHaveValue('교량 구간 검토 초안');await expect(civil).toHaveAttribute('aria-pressed','true');await page.reload();await expect(title).toHaveValue('교량 구간 검토 초안');
 await page.getByRole('button',{name:'이 템플릿으로 작업 만들기',exact:true}).click();await expect(page).toHaveURL(/blank=/);await expect(page.getByRole('button',{name:'노선 구상 구상 객체',exact:true})).toBeVisible();
 await page.goto(library);await expect(title).toHaveValue('');await expect(page.getByRole('button',{name:'이 템플릿으로 작업 만들기',exact:true})).toBeDisabled();
 await title.fill('버릴 초안');await page.getByRole('button',{name:'시작 입력 초기화',exact:true}).click();await expect(title).toHaveValue('');await page.reload();await expect(title).toHaveValue('');
 await page.evaluate(()=>{const key='1hk:workflow-preview:session:v1';const data=JSON.parse(sessionStorage.getItem(key));data.drafts['template:selected']='removed-template';data.drafts['template:title']='남겨둔 이름';sessionStorage.setItem(key,JSON.stringify(data));});await page.reload();
 await expect(page.getByRole('alert')).toContainText('보관된 템플릿을 찾을 수 없습니다');await expect(page.getByRole('button',{name:'이 템플릿으로 작업 만들기',exact:true})).toBeDisabled();await expect(title).toHaveValue('남겨둔 이름');await civil.click();await expect(title).toHaveValue('남겨둔 이름');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);console.log('PASS template draft navigation/reload, successful-create reset, discard, unavailable-template recovery and mobile');
}finally{await browser.close();}
