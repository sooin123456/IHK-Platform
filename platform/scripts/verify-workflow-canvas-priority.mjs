import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=workspace&scope=sample&scenario=architecture',{waitUntil:'networkidle'});
 const canvas=page.getByLabel('2D 시나리오 도면',{exact:true});const box=await canvas.boundingBox();expect(box.y).toBeLessThanOrEqual(460);expect(Math.min(900,box.y+box.height)-box.y).toBeGreaterThanOrEqual(400);
 await expect(page.getByRole('heading',{level:1,name:'작업실',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'업무 대상 선택'})).toContainText('실제 업무 결과가 아닙니다');
 await page.getByRole('region',{name:'작업 백업·복원'}).getByText('작업 백업·복원',{exact:true}).click();await expect(page.getByRole('button',{name:'현재 작업 백업 다운로드',exact:true})).toBeVisible();await page.getByRole('region',{name:'작업 백업·복원'}).getByText('작업 백업·복원',{exact:true}).click();
 await page.screenshot({path:'/tmp/1hk-canvas-priority.png',fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'검토 모드',exact:true})).toBeVisible();expect(errors).toEqual([]);console.log('PASS desktop canvas above fold, heading/disclosure/backup controls retained, mobile width');
}finally{await browser.close();}
