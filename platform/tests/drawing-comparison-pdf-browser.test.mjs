import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import {createHash} from 'node:crypto';

for(const pageCount of [2,3])test(pageCount===2?'comparison accepts only each recorded PDF and shares zoom without changing records':'comparison rejects hash-valid PDFs when recorded page count differs',{skip:!process.env.DELIVERY_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const makePdf=async(title)=>{const pdf=await PDFDocument.create();pdf.setTitle(title);const width=title==='After'?800:600;pdf.addPage([width,400]).drawText(title,{x:50,y:200});pdf.addPage([width,400]);return {name:'same-name.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};};
 const beforeFile=await makePdf('Before'),afterFile=await makePdf('After');
 const source=file=>({kind:'pdf',fileName:file.name,byteSize:file.buffer.length,fingerprint:createHash('sha256').update(file.buffer).digest('hex')});
 const originalHash=source(beforeFile).fingerprint;
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const key='1hk:preview:delivery:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111';
  await page.addInitScript(({key,beforeSource,afterSource,pageCount})=>{
   const snapshot={documentName:'비교 도면',pageCount,objects:[],layers:[{id:'review',name:'검토',visible:true,locked:false}],source:beforeSource};
   const request={round:1,message:'원본 비교',items:[{id:'a',title:'영역',page:1,kind:'added',sample:false,x:100,y:100,width:140,height:90,author:'나',summary:'범위',before:'없음',after:'추가'}],decisions:{a:{kind:'checked',note:'확인'}},approval:{note:'확인',at:'2026-09-10T03:00:00Z'},snapshot};
   sessionStorage.setItem(key,JSON.stringify({schema:1,deliveryStage:'package',deliveryConfiguration:{recipient:'현장 담당 · 예시',includeEvidence:true,includeBoq:false,boqFormat:'xlsx'},exportSelection:{format:'pdf',pageRange:'all',includeComments:false},deliverySource:{documentName:'비교 도면',page:1,pageCount,reviewState:'draft',approvedRequest:request,drawingSnapshot:{...snapshot,source:afterSource}},deliveryHistory:[]}));
  },{key,beforeSource:source(beforeFile),afterSource:source(afterFile),pageCount});
  await page.goto(`${process.env.DELIVERY_PREVIEW_ORIGIN}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-deliveries`);
  const raw=await page.evaluate(key=>sessionStorage.getItem(key),key);
  const trigger=page.locator('[data-document-id="00000000-0000-4000-8000-000000000111"]').getByRole('button',{name:'두 기록 나란히 비교',exact:true});
  await trigger.click();
  const dialog=page.getByRole('dialog',{name:'요청과 납품 도형 비교',exact:true});
  const left=dialog.getByRole('region',{name:'요청 당시 비교',exact:true}),right=dialog.getByRole('region',{name:'납품 구성 당시 비교',exact:true});
  await left.getByLabel('요청 당시 비교 PDF 선택',{exact:true}).setInputFiles(afterFile);
  await expect(left.getByRole('alert')).toContainText('기록된 원본과 다릅니다');
  await expect(left.locator('canvas')).toHaveCount(0);
  await left.getByLabel('요청 당시 비교 PDF 선택',{exact:true}).setInputFiles(afterFile);
  await left.getByLabel('요청 당시 비교 PDF 선택',{exact:true}).setInputFiles(beforeFile);
  await right.getByLabel('납품 구성 당시 비교 PDF 선택',{exact:true}).setInputFiles(afterFile);
  if(pageCount===3){
   for(const pane of [left,right]){await expect(pane.getByRole('alert')).toContainText('기록된 페이지 수와 다릅니다');await expect(pane.locator('canvas')).toHaveCount(0);}
   await dialog.getByRole('button',{name:'나란히 비교 닫기',exact:true}).click();
   expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(raw);
   return;
  }
  for(const pane of [left,right])await expect(pane.getByLabel('PDF 1쪽',{exact:true})).toHaveAttribute('aria-busy','false');
  for(const pane of [left,right])await expect(pane.getByRole('status')).toContainText('원본 확인 완료 · same-name.pdf');
  const fitted=await Promise.all([left,right].map(pane=>pane.locator('canvas').evaluate(canvas=>canvas.width)));
  await dialog.getByRole('button',{name:'비교 PDF 함께 확대',exact:true}).click();
  for(const [index,pane] of [left,right].entries())await expect.poll(()=>pane.locator('canvas').evaluate(canvas=>canvas.width)).toBeGreaterThan(fitted[index]);
  for(let i=0;i<3;i++)await dialog.getByRole('button',{name:'비교 PDF 함께 확대',exact:true}).click();
  const leftPdf=left.getByLabel('PDF 1쪽',{exact:true}),rightPdf=right.getByLabel('PDF 1쪽',{exact:true});
  for(const pane of [leftPdf,rightPdf])await expect(pane).toHaveAttribute('aria-busy','false');
  await dialog.getByRole('checkbox',{name:'PDF 같이 이동',exact:true}).check();
  const ratio=element=>element.scrollLeft/Math.max(1,element.scrollWidth-element.clientWidth);
  const verticalRatio=element=>element.scrollTop/Math.max(1,element.scrollHeight-element.clientHeight);
  await expect.poll(()=>leftPdf.evaluate(element=>element.scrollWidth-element.clientWidth)).toBeGreaterThan(10);
  await leftPdf.evaluate(element=>{element.scrollLeft=(element.scrollWidth-element.clientWidth)*.7;element.scrollTop=(element.scrollHeight-element.clientHeight)*.6;});
  await expect.poll(()=>rightPdf.evaluate(ratio)).toBeGreaterThan(.68);
  await expect.poll(()=>rightPdf.evaluate(ratio)).toBeLessThan(.72);
  await expect.poll(()=>rightPdf.evaluate(verticalRatio)).toBeGreaterThan(.58);
  await expect.poll(()=>rightPdf.evaluate(verticalRatio)).toBeLessThan(.62);
  await rightPdf.evaluate(element=>{element.scrollLeft=(element.scrollWidth-element.clientWidth)*.4;});
  await expect.poll(()=>leftPdf.evaluate(ratio)).toBeGreaterThan(.38);
  await expect.poll(()=>leftPdf.evaluate(ratio)).toBeLessThan(.42);
  await dialog.getByRole('checkbox',{name:'PDF 같이 이동',exact:true}).uncheck();
  await leftPdf.evaluate(element=>{element.scrollLeft=0;});
  await expect.poll(()=>leftPdf.evaluate(ratio)).toBe(0);
  expect(await rightPdf.evaluate(ratio)).toBeGreaterThan(.38);
  await dialog.getByRole('checkbox',{name:'PDF 같이 이동',exact:true}).check();
  await leftPdf.evaluate(element=>{element.scrollLeft=(element.scrollWidth-element.clientWidth)*.6;});
  await expect.poll(()=>rightPdf.evaluate(ratio)).toBeGreaterThan(.58);
  await dialog.getByLabel('비교 페이지',{exact:true}).selectOption('2');
  for(const pane of [left,right])await expect(pane.getByLabel('PDF 2쪽',{exact:true})).toHaveAttribute('aria-busy','false');
  for(const pane of [left,right])await expect.poll(()=>pane.getByLabel('PDF 2쪽',{exact:true}).evaluate(element=>({left:element.scrollLeft,top:element.scrollTop}))).toEqual({left:0,top:0});
  await dialog.getByRole('button',{name:'비교 PDF 화면 맞춤',exact:true}).click();
  for(const [index,pane] of [left,right].entries())await expect.poll(()=>pane.locator('canvas').evaluate(canvas=>canvas.width)).toBe(fitted[index]);
  await dialog.getByLabel('비교 페이지',{exact:true}).selectOption('1');
  for(const pane of [left,right])await expect(pane.getByLabel('PDF 1쪽',{exact:true})).toHaveAttribute('aria-busy','false');
  if(process.env.COMPARISON_PDF_SCREENSHOT)await page.screenshot({path:process.env.COMPARISON_PDF_SCREENSHOT,animations:'disabled'});
  await dialog.getByRole('button',{name:'나란히 비교 닫기',exact:true}).click();
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(raw);
  await trigger.click();await expect(dialog.locator('canvas')).toHaveCount(0);
  expect(createHash('sha256').update(beforeFile.buffer).digest('hex')).toBe(originalHash);
 }finally{await browser.close();}
});
