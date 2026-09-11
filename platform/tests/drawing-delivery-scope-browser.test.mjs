import test from 'node:test';
import {chromium,expect} from '@playwright/test';

test('delivery scope correction persists without changing its attached approval',{skip:!process.env.DELIVERY_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const key='1hk:preview:delivery:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111';
  const items=[1,2].map(number=>({id:`scope-${number}`,title:`${number}층 범위`,page:number,kind:'added',sample:false,x:10,y:20,width:140,height:90,author:'나',summary:'범위 확인',before:'없음',after:'추가'}));
  const snapshot={documentName:'검토도면.pdf',pageCount:3,objects:items.map(item=>({id:item.id,name:item.title,kind:'사각형',page:item.page,x:10,y:20,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''})),layers:[{id:'review',name:'검토',visible:true,locked:false}],source:{kind:'pdf',fileName:'검토도면.pdf',byteSize:100,fingerprint:'a'.repeat(64)}};
  const request={round:1,message:'두 페이지 범위 확인',items,decisions:Object.fromEntries(items.map(item=>[item.id,{kind:'checked',note:'검토함'}])),approval:{note:'고정 승인 의견',at:'2026-09-10T03:00:00Z'},snapshot};
  const draft={schema:1,deliveryConfiguration:{recipient:'현장 담당 · 예시',includeEvidence:true,includeBoq:false,boqFormat:'xlsx'},deliveryStage:'package',exportSelection:{format:'pdf',pageRange:'current',includeComments:true},deliveryHistory:[],deliverySource:{documentName:'검토도면.pdf',page:1,pageCount:3,reviewState:'draft',approvedRequest:request,drawingSnapshot:snapshot}};
  await page.addInitScript(({key,draft})=>{if(!sessionStorage.getItem(key))sessionStorage.setItem(key,JSON.stringify(draft));},{key,draft});
  const url=`${process.env.DELIVERY_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000111&returnProject=00000000-0000-4000-8000-000000000101`;
  const open=async()=>{const button=page.getByRole('button',{name:'내보내기 화면 열기',exact:true});if(!await button.isVisible())await page.getByLabel('도면 업무 더보기',{exact:true}).click();await button.click();};
  await page.goto(url);await open();
  const delivery=page.getByRole('region',{name:'납품·수신 화면 예시',exact:true});
  await expect(delivery.getByRole('button',{name:'납품 준비 화면 보기',exact:true})).toBeDisabled();
  await expect(delivery.getByRole('region',{name:'요청과 납품 페이지 대조',exact:true})).toContainText('납품 범위에서 빠진 요청 페이지: 2쪽');
  const stored=await page.evaluate(key=>sessionStorage.getItem(key),key);
  await page.goto(`${url}&role=viewer`);await open();
  await expect(page.getByRole('button',{name:'전체 페이지로 범위 변경',exact:true})).toHaveCount(0);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(stored);
  await page.goto(url);await open();
  await page.getByRole('button',{name:'전체 페이지로 범위 변경',exact:true}).click();
  await expect(delivery.getByRole('button',{name:'납품 준비 화면 보기',exact:true})).toBeEnabled();
  await page.reload();await open();
  const scope=delivery.getByRole('region',{name:'요청과 납품 페이지 대조',exact:true});
  await expect(scope).toContainText('납품 페이지: 전체 3쪽');
  await expect(scope).toContainText('요청 항목이 없는 납품 페이지: 1개');
  const restored=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);
  expect(restored.deliverySource.approvedRequest).toEqual(request);
  expect(restored.exportSelection.pageRange).toBe('all');
  if(process.env.DELIVERY_SCOPE_SCREENSHOT){await scope.scrollIntoViewIfNeeded();await page.screenshot({path:process.env.DELIVERY_SCOPE_SCREENSHOT,animations:'disabled'});}
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await page.getByRole('link',{name:'납품',exact:true}).click();
  const card=page.locator('[data-document-id="00000000-0000-4000-8000-000000000111"]');
  await expect(card.getByRole('region',{name:'요청과 납품 페이지 대조',exact:true})).toContainText('납품 페이지: 전체 3쪽',{timeout:5000});
  await card.getByRole('link',{name:'납품 작업 이어가기',exact:true}).click();
  await page.getByRole('button',{name:'현재 도면으로 새 납품 구성',exact:true}).click();
  await page.getByText('이전 납품 구성 (1)',{exact:true}).click();
  const history=page.getByRole('region',{name:'이전 납품 구성 목록',exact:true});
  await history.getByText('구성 1 · 개정 미등록 · 현장 담당 · 예시',{exact:true}).click();
  await expect(history.getByRole('region',{name:'요청과 납품 페이지 대조',exact:true})).toContainText('납품 페이지: 전체 3쪽');
  await expect(history.locator('input,select,textarea')).toHaveCount(0);
 }finally{await browser.close();}
});
