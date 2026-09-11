import {chromium,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import {createHash} from 'node:crypto';
const pdf=await PDFDocument.create();pdf.addPage([800,520]);const buffer=Buffer.from(await pdf.save());const source={name:'재개.pdf',mimeType:'application/pdf',buffer};
const browser=await chromium.launch();
try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});
 await page.evaluate(()=>{crypto.subtle.digest=()=>new Promise(()=>{});});
 await page.getByLabel('여러 도면 파일 선택',{exact:true}).setInputFiles([source,{name:'대기.ifc',mimeType:'application/octet-stream',buffer:Buffer.from('ISO-10303-21')}]);
 const panel=page.getByRole('region',{name:'내 파일 가져오기 목록'});await expect(panel.getByRole('article')).toHaveCount(2);
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:workflow-preview:session:v1')).importRecords?.length)).toBe(2);
 await page.reload();await expect(panel.getByRole('article')).toHaveCount(2);await expect(panel).toContainText('확인 미완료');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.screenshot({path:'/tmp/1hk-import-resume.png'});
 const key='1hk:workflow-preview:session:v1',hash=createHash('sha256').update(buffer).digest('hex');
 await page.evaluate(({key,hash})=>{const saved=JSON.parse(sessionStorage.getItem(key));saved.importRecords[0].sha256=hash;sessionStorage.setItem(key,JSON.stringify(saved));},{key,hash});await page.reload();
 await page.getByLabel('재개.pdf 확인 다시 진행',{exact:true}).setInputFiles({...source,buffer:Buffer.alloc(buffer.length,65)});await expect(panel).toContainText('내용이 다릅니다');await expect(panel.getByRole('button',{name:'재개.pdf 작업실 열기',exact:true})).toHaveCount(0);
 await page.getByLabel('재개.pdf 확인 다시 진행',{exact:true}).setInputFiles(source);await expect(panel.getByRole('button',{name:'재개.pdf 작업실 열기',exact:true})).toBeEnabled();
 await page.getByLabel('대기.ifc 확인 다시 진행',{exact:true}).setInputFiles({name:'다른.ifc',mimeType:'application/octet-stream',buffer:Buffer.from('ISO-10303-21')});await expect(panel).toContainText('이름과 크기');
 await page.getByLabel('대기.ifc 확인 다시 진행',{exact:true}).setInputFiles({name:'대기.ifc',mimeType:'application/octet-stream',buffer:Buffer.from('ISO-10303-21')});await expect(panel).toContainText('분석 엔진 미연결');await page.reload();await expect(panel.getByRole('article')).toHaveCount(2);await expect(panel).not.toContainText('확인 미완료');
 const records=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).importRecords,key);expect(records[0].sha256).toBe(hash);expect(records[0].status).toBe('ready');expect(records[1].status).toBe('needs-engine');expect(errors).toEqual([]);console.log('PASS interrupted batch persists every selection; per-file resume rejects wrong identity/hash and retains results');
}finally{await browser.close();}
