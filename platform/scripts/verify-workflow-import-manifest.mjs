import {chromium,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
const pdf=await PDFDocument.create();pdf.addPage([800,520]);const buffer=Buffer.from(await pdf.save());const source={name:'구조.pdf',mimeType:'application/pdf',buffer};
const browser=await chromium.launch();
try{
 const page=await browser.newPage();page.setDefaultTimeout(7000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=start',{waitUntil:'networkidle'});
 const panel=page.getByRole('region',{name:'내 파일 가져오기 목록'});
 await page.getByLabel('여러 도면 파일 선택',{exact:true}).setInputFiles([source,{name:'기계.dwg',mimeType:'application/octet-stream',buffer:Buffer.from('AC1032 example')},{name:'시설.ifc',mimeType:'application/octet-stream',buffer:Buffer.from('ISO-10303-21 example')},{name:'메모.txt',mimeType:'text/plain',buffer:Buffer.from('not drawing')},{name:'손상.pdf',mimeType:'application/pdf',buffer:Buffer.from('broken pdf')}]);
 await expect(panel.getByRole('article')).toHaveCount(5);await expect(panel).toContainText('실제 PDF 열람 준비');await expect(panel).toContainText('분석 엔진 미연결');await expect(panel).toContainText('지원하지 않는 형식');await expect(panel).toContainText('파일 확인 실패');
 await page.reload();await expect(panel.getByRole('article')).toHaveCount(5);
 await page.getByLabel('여러 도면 파일 선택',{exact:true}).setInputFiles(source);await expect(panel).toContainText('선택 처리를 마쳤습니다');await expect(panel.getByRole('article')).toHaveCount(5);
 await panel.getByRole('button',{name:'구조.pdf 작업실 열기',exact:true}).click();await expect(page).toHaveURL(/blank=/);const url=page.url();await expect(page.locator('.flow-local-pdf-surface [aria-busy="false"]')).toHaveCount(1);
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=documents&scope=local');await expect(panel.getByRole('article')).toHaveCount(5);await panel.getByRole('button',{name:'구조.pdf 작업실 열기',exact:true}).click();await expect(page).toHaveURL(url);
 const session=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:workflow-preview:session:v1')));expect(session.blankDocuments).toHaveLength(1);expect(session.importRecords).toHaveLength(5);expect(session.importRecords.find(record=>record.format==='DWG').documentId).toBeUndefined();expect(session.blankDocuments[0].source.sha256).toBe(session.importRecords[0].sha256);
 await page.goto('http://127.0.0.1:4181/workspace-preview/flow?page=documents&scope=local');await expect(panel.getByRole('article')).toHaveCount(5);await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await panel.screenshot({path:'/tmp/1hk-import-manifest.png'});expect(errors).toEqual([]);console.log('PASS mixed file manifest, corrupt/unsupported/engine states, reload/dedup and exact real-PDF workspace');
}finally{await browser.close();}
