import {chromium,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
const pdf=await PDFDocument.create();pdf.addPage([800,520]);const buffer=Buffer.from(await pdf.save());
const browser=await chromium.launch();try{
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});await page.getByLabel('빈 작업 이름',{exact:true}).fill('실제 작업 화면');await page.getByRole('button',{name:'빈 작업실 열기',exact:true}).click();await expect(page).toHaveURL(/blank=/);
 const canvas=page.getByRole('img',{name:'빈 작업 캔버스',exact:true});await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/1hk-local-canvas-before-pdf.png',fullPage:true});expect((await canvas.boundingBox()).y).toBeLessThanOrEqual(500);
 await page.getByLabel('작업실 PDF 선택',{exact:true}).setInputFiles({name:'source.pdf',mimeType:'application/pdf',buffer});await expect(page.locator('.flow-local-pdf-surface [aria-busy="false"]')).toHaveCount(1);await page.evaluate(()=>scrollTo(0,0));const box=await page.locator('.flow-local-pdf-surface').boundingBox();expect(box.y).toBeLessThanOrEqual(550);
 await page.getByRole('button',{name:'사각형 구상 도구',exact:true}).click();await canvas.focus();await page.keyboard.press('Enter');await expect(page.getByLabel('선택할 객체',{exact:true})).not.toHaveValue('');await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'/tmp/1hk-local-canvas-priority.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);console.log('PASS local blank/PDF canvas prominence, authoring and mobile width');
}finally{await browser.close();}
