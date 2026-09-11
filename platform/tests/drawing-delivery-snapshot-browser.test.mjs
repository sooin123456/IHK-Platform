import test from 'node:test';
import {chromium,expect} from '@playwright/test';

test('legacy approval handoff warns about missing evidence and never repairs the old request',{skip:!process.env.DELIVERY_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const key='1hk:preview:change-requests:00000000-0000-4000-8000-000000000111';
  await page.addInitScript(key=>{
   if(sessionStorage.getItem(key))return;
   const request={round:1,message:'옛 검토 기록',items:[{id:'old',title:'과거 영역',page:1,kind:'added',sample:false,x:100,y:100,width:140,height:90,author:'나',summary:'범위',before:'없음',after:'추가'}],decisions:{old:{kind:'checked',note:'확인'}},approval:{note:'당시 확인',at:'2026-09-10T03:00:00Z'}};
   sessionStorage.setItem(key,JSON.stringify({schemaVersion:1,requests:[request]}));
  },key);
  await page.goto(`${process.env.DELIVERY_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000111&returnProject=00000000-0000-4000-8000-000000000101`);
  const raw=await page.evaluate(key=>sessionStorage.getItem(key),key);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await page.getByRole('button',{name:'이 요청을 납품 구성에 첨부',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'납품으로 넘길 검토 기록',exact:true});
  await expect(dialog.getByRole('status')).toContainText('현재 도면 대조 근거 부족');
  await expect(dialog).toContainText('개정 미기록');
  await expect(dialog).not.toContainText('현재 도면 기록과 일치');
  await expect(dialog.getByRole('button',{name:'이 기록으로 납품 구성 열기',exact:true})).toBeInViewport({ratio:1});
  if(process.env.LEGACY_HANDOFF_SCREENSHOT)await page.screenshot({path:process.env.LEGACY_HANDOFF_SCREENSHOT,animations:'disabled'});
  await dialog.getByRole('button',{name:'이 기록으로 납품 구성 열기',exact:true}).click();
  await page.getByRole('button',{name:'납품 구성으로 계속',exact:true}).click();
  await expect(page.getByRole('button',{name:'납품 준비 화면 보기',exact:true})).toBeDisabled();
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(raw);
 }finally{await browser.close();}
});

test('legacy delivery evidence stays readable but cannot advance without captured source records',{skip:!process.env.DELIVERY_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const key='1hk:preview:delivery:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111';
  await page.addInitScript(key=>{
   if(sessionStorage.getItem(key))return;
   const request={round:1,message:'옛 도면 검토 기록',items:[{id:'a',title:'검토 영역',page:1,kind:'added',sample:false,x:100,y:100,width:140,height:90,author:'나',summary:'범위',before:'없음',after:'추가'}],decisions:{a:{kind:'checked',note:'확인'}},approval:{note:'기록 확인',at:'2026-09-10T03:00:00Z'}};
   sessionStorage.setItem(key,JSON.stringify({schema:1,deliveryStage:'package',deliveryConfiguration:{recipient:'현장 담당 · 예시',includeEvidence:true,includeBoq:false,boqFormat:'xlsx'},exportSelection:{format:'pdf',pageRange:'all',includeComments:false},deliverySource:{documentName:'옛 도면.pdf',page:1,pageCount:1,reviewState:'draft',approvedRequest:request},deliveryHistory:[]}));
  },key);
  await page.goto(`${process.env.DELIVERY_PREVIEW_ORIGIN}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-deliveries`);
  const read=()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);
  const before=await read();
  await page.locator('[data-document-id="00000000-0000-4000-8000-000000000111"]').getByRole('link',{name:'납품 작업 이어가기',exact:true}).click();
  const delivery=page.getByRole('region',{name:'납품·수신 화면 예시',exact:true});
  await expect(delivery.getByRole('button',{name:'납품 준비 화면 보기',exact:true})).toBeDisabled();
  const notice=delivery.getByRole('status',{name:'납품 준비 보류 안내',exact:true});
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeInViewport();
  if(process.env.DELIVERY_MISSING_EVIDENCE_SCREENSHOT)await page.screenshot({path:process.env.DELIVERY_MISSING_EVIDENCE_SCREENSHOT,animations:'disabled'});
  await page.reload();
  await expect(delivery.getByRole('button',{name:'납품 준비 화면 보기',exact:true})).toBeDisabled();
  expect((await read()).deliverySource).toEqual(before.deliverySource);
  expect((await read()).deliveryStage).toBe('package');
  await delivery.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await expect(delivery).not.toBeVisible();
 }finally{await browser.close();}
});

test('comparison page and hidden-layer controls preserve the frozen delivery record',{skip:!process.env.DELIVERY_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const key='1hk:preview:delivery:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111';
  await page.addInitScript(key=>{
   const shape={id:'a',kind:'사각형',page:1,x:100,y:100,name:'숨긴 영역',layer:'hidden',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
   const before={documentName:'검토 기록',pageCount:1,objects:[shape],layers:[{id:'hidden',name:'숨김',visible:false,locked:true}],source:{kind:'blank',paper:'A3'}};
   const request={round:1,message:'고정 기록',items:[{id:'a',title:'숨긴 영역',page:1,kind:'added',sample:false,x:100,y:100,width:140,height:90,author:'나',summary:'범위',before:'없음',after:'추가'}],decisions:{a:{kind:'checked',note:'확인'}},approval:{note:'확인',at:'2026-09-10T03:00:00Z'},snapshot:before};
   const after={...before,documentName:'납품 기록',pageCount:2,objects:[shape,{...shape,id:'b',page:2,name:'2층 영역'}]};
   sessionStorage.setItem(key,JSON.stringify({schema:1,deliveryStage:'package',deliveryConfiguration:{recipient:'현장 담당 · 예시',includeEvidence:true,includeBoq:false,boqFormat:'xlsx'},exportSelection:{format:'pdf',pageRange:'all',includeComments:false},deliverySource:{documentName:'납품 기록',page:1,pageCount:2,reviewState:'draft',drawingSnapshot:after,approvedRequest:request},deliveryHistory:[]}));
  },key);
  await page.goto(`${process.env.DELIVERY_PREVIEW_ORIGIN}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-deliveries`);
  const raw=await page.evaluate(key=>sessionStorage.getItem(key),key);
  await page.locator('[data-document-id="00000000-0000-4000-8000-000000000111"]').getByRole('button',{name:'두 기록 나란히 비교',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'요청과 납품 도형 비교',exact:true});
  const left=dialog.getByRole('region',{name:'요청 당시 비교',exact:true}),right=dialog.getByRole('region',{name:'납품 구성 당시 비교',exact:true});
  await expect(dialog.locator('[data-screen-shape]')).toHaveCount(0);
  await dialog.getByRole('checkbox',{name:'숨긴 도형 임시 표시',exact:true}).check();
  await expect(dialog.locator('[data-screen-shape]')).toHaveCount(2);
  await dialog.getByLabel('비교 페이지',{exact:true}).selectOption('2');
  await expect(left).toContainText('이 기록에는 2쪽이 없습니다');
  await expect(left.locator('[data-screen-shape]')).toHaveCount(0);
  await expect(right.locator('[data-screen-shape]')).toHaveAttribute('aria-label','2층 영역 · 화면 도형');
  await dialog.getByRole('button',{name:'나란히 비교 닫기',exact:true}).click();
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(raw);
 }finally{await browser.close();}
});

test('snapshot-heavy delivery history survives browser reload and project navigation',{skip:!process.env.DELIVERY_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const key='1hk:preview:delivery:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111';
  await page.addInitScript(key=>{
   if(sessionStorage.getItem(key))return;
   const objects=Array.from({length:600},(_,index)=>({id:`object-${index}`,kind:'사각형',page:1,x:20,y:20,name:`검토 도형 ${index}`,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''}));
   const snapshot={documentName:'구조.pdf',pageCount:1,objects,layers:[{id:'review',name:'검토',visible:true,locked:false}],source:{kind:'office',paper:'A3'}};
   const request={round:1,message:'600개 도형 배치',items:[{id:'object-0',title:'검토 도형 0',page:1,kind:'added',sample:false,x:20,y:20,width:140,height:90,author:'나',summary:'범위 확인',before:'없음',after:'추가'}],decisions:{'object-0':{kind:'checked',note:'확인'}},approval:{note:'범위 확인',at:'2026-09-10T03:00:00Z'},snapshot};
   const draft={schema:1,deliveryStage:'package',deliveryConfiguration:{recipient:'현장 담당 · 예시',includeEvidence:true,includeBoq:false,boqFormat:'xlsx'},exportSelection:{format:'pdf',pageRange:'all',includeComments:false},deliverySource:{documentName:'구조.pdf',page:1,pageCount:1,reviewState:'draft',drawingSnapshot:snapshot,approvedRequest:request},deliveryHistory:[]};
   draft.deliveryHistory=[1,2].map(index=>({...draft,id:`history-${index}`,createdAt:'2026-09-10T03:00:00Z',deliveryHistory:[]}));
   sessionStorage.setItem(key,JSON.stringify(draft));
  },key);
  await page.goto(`${process.env.DELIVERY_PREVIEW_ORIGIN}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-deliveries`);
  const card=page.locator('[data-document-id="00000000-0000-4000-8000-000000000111"]');
  await expect(card.getByRole('region',{name:'요청과 납품 도면 기록 대조',exact:true})).toContainText('기록이 일치합니다');
  await expect(card.getByRole('region',{name:'납품 승인 범위 안내',exact:true}).first()).toContainText('요청 1 · 1개 항목 승인 확인 기록 첨부');
  await card.getByRole('link',{name:'납품 작업 이어가기',exact:true}).click();
  await expect(page).toHaveURL(/drawing-workspace/);
  await expect(page.getByRole('region',{name:'납품·수신 화면 예시',exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region',{name:'납품·수신 화면 예시',exact:true})).toContainText('기록이 일치합니다');
  await expect(page.getByRole('region',{name:'납품·수신 화면 예시',exact:true}).getByRole('region',{name:'납품 승인 범위 안내',exact:true})).toContainText('별도 개정 검토 기록 없음');
  if(process.env.DELIVERY_APPROVAL_SCREENSHOT){await page.getByRole('region',{name:'납품·수신 화면 예시',exact:true}).getByRole('region',{name:'납품 승인 범위 안내',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:process.env.DELIVERY_APPROVAL_SCREENSHOT,animations:'disabled'});}
  const raw=await page.evaluate(key=>sessionStorage.getItem(key),key);expect(raw.length).toBeGreaterThan(250000);
  const restored=JSON.parse(raw);expect(restored.deliverySource.drawingSnapshot.objects).toHaveLength(600);expect(restored.deliveryHistory).toHaveLength(2);expect(restored.deliveryHistory[1].deliverySource.approvedRequest.snapshot.objects).toHaveLength(600);
  await expect(page.getByRole('alert')).toHaveCount(0);
 }finally{await browser.close();}
});

test('new delivery captures changed drawing while preserving the previously matching package',{skip:!process.env.DELIVERY_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const key='1hk:preview:delivery:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111';
  const url=`${process.env.DELIVERY_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000111&returnProject=00000000-0000-4000-8000-000000000101`;
  const open=async()=>{const button=page.getByRole('button',{name:'내보내기 화면 열기',exact:true});if(!await button.isVisible())await page.getByLabel('도면 업무 더보기',{exact:true}).click();await button.click();};
  await page.goto(url);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:150,y:130}});
  await page.getByLabel('이름',{exact:true}).fill('검토 영역');
  await page.getByRole('button',{name:'검토 요청 구성 열기',exact:true}).click();
  await page.getByLabel('요청 메시지',{exact:true}).fill('이 배치로 확인');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const batch=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await batch.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  await batch.getByRole('button',{name:'확인 · 예시',exact:true}).click();
  await batch.getByRole('button',{name:'승인 확인으로 계속',exact:true}).click();
  await batch.getByLabel('요청 승인 의견',{exact:true}).fill('고정 배치 확인');
  await batch.getByRole('button',{name:'이 요청 승인 확인 · 예시',exact:true}).click();
  const preflight=batch.getByRole('status',{name:'전체 도면 승인 사전 점검',exact:true});
  await expect(preflight).toContainText('확인 준비됨 · 아직 승인 아님');
  const requestKey='1hk:preview:change-requests:00000000-0000-4000-8000-000000000111';
  const beforePreparation=await page.evaluate(key=>sessionStorage.getItem(key),requestKey);
  await batch.getByRole('button',{name:'전체 도면 승인 내용 구성',exact:true}).click();
  const preparation=page.getByRole('dialog',{name:'전체 도면 승인 내용 구성',exact:true});
  const preview=preparation.getByRole('button',{name:'승인 내용 미리보기',exact:true});
  await expect(preview).toBeDisabled();
  await preparation.getByRole('checkbox',{name:'원본 전체 페이지를 확인했습니다',exact:true}).check();
  await expect(preview).toBeDisabled();
  await preparation.getByRole('checkbox',{name:'화면 도형과 레이어 범위를 확인했습니다',exact:true}).check();
  await preparation.getByLabel('전체 도면 승인 의견',{exact:true}).fill('전체 범위 확인 초안');
  await preview.click();
  await expect(preparation.getByRole('status')).toContainText('전체 범위 확인 초안');
  await expect(preparation.getByRole('status')).toContainText('아직 승인되지 않았습니다');
  await expect(preparation.getByLabel('전체 도면 승인 의견',{exact:true})).toHaveCount(0);
  const editPreparation=preparation.getByRole('button',{name:'승인 내용 수정',exact:true});
  await expect(editPreparation).toBeInViewport({ratio:1,timeout:3000});
  await page.setViewportSize({width:390,height:667});
  await expect(preparation.getByRole('button',{name:'검토로 돌아가기',exact:true})).toBeInViewport({ratio:1,timeout:3000});
  await expect(editPreparation).toBeInViewport({ratio:1,timeout:3000});
  await expect(preparation.getByRole('status')).toBeInViewport({ratio:1,timeout:3000});
  await editPreparation.click();
  await expect(preparation.getByLabel('전체 도면 승인 의견',{exact:true})).toHaveValue('전체 범위 확인 초안');
  await expect(preparation.getByRole('status')).toHaveCount(0);
  await preview.click();
  await expect(preparation.getByRole('status')).toBeInViewport({ratio:1,timeout:3000});
  if(process.env.APPROVAL_PREPARATION_SCREENSHOT)await page.screenshot({path:process.env.APPROVAL_PREPARATION_SCREENSHOT,animations:'disabled'});
  await page.setViewportSize({width:1280,height:720});
  await page.keyboard.press('Escape');
  expect(await page.evaluate(key=>sessionStorage.getItem(key),requestKey)).toBe(beforePreparation);
  await batch.getByRole('button',{name:'전체 도면 승인 내용 구성',exact:true}).click();
  await expect(preparation.getByLabel('전체 도면 승인 의견',{exact:true})).toHaveValue('전체 범위 확인 초안');
  await preparation.getByLabel('전체 도면 승인 의견',{exact:true}).fill('보완한 승인 의견');
  await expect(preparation.getByRole('status')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await batch.getByRole('button',{name:'전체 도면 승인 내용 구성',exact:true}).click();
  await expect(preparation.getByLabel('전체 도면 승인 의견',{exact:true})).toHaveValue('보완한 승인 의견');
  await expect(preparation.getByRole('checkbox',{name:'원본 전체 페이지를 확인했습니다',exact:true})).not.toBeChecked();
  await expect(preview).toBeDisabled();
  expect(await page.evaluate(key=>sessionStorage.getItem(key),requestKey)).toBe(beforePreparation);
  const opinionKey=`${requestKey}:approval-opinion:1`;
  await page.evaluate(key=>{
    window.restoreOpinionStorage=Storage.prototype.setItem;
    Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException('Full','QuotaExceededError');return window.restoreOpinionStorage.call(this,name,value);};
  },opinionKey);
  await preparation.getByLabel('전체 도면 승인 의견',{exact:true}).fill('저장 재시도 의견');
  await expect(preparation.getByRole('alert')).toContainText('보관하지 못했습니다');
  expect(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),opinionKey)).note).toBe('보완한 승인 의견');
  await page.evaluate(()=>{Storage.prototype.setItem=window.restoreOpinionStorage;});
  await preparation.getByRole('button',{name:'초안 저장 다시 시도',exact:true}).click();
  await expect(preparation.getByRole('alert')).toHaveCount(0);
  expect(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),opinionKey)).note).toBe('저장 재시도 의견');
  await page.keyboard.press('Escape');
  await page.evaluate(key=>sessionStorage.setItem(key,'broken draft'),opinionKey);
  await page.reload();
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await batch.getByRole('button',{name:'전체 도면 승인 내용 구성',exact:true}).click();
  await expect(preparation.getByRole('alert')).toContainText('불러오지 못했습니다');
  await expect(preparation.getByLabel('전체 도면 승인 의견',{exact:true})).toBeDisabled();
  expect(await page.evaluate(key=>sessionStorage.getItem(key),opinionKey)).toBe('broken draft');
  await page.evaluate(key=>sessionStorage.setItem(key,JSON.stringify({schemaVersion:1,note:'복구한 의견'})),opinionKey);
  await preparation.getByRole('button',{name:'초안 다시 불러오기',exact:true}).click();
  await expect(preparation.getByLabel('전체 도면 승인 의견',{exact:true})).toHaveValue('복구한 의견');
  await expect(preparation.getByLabel('전체 도면 승인 의견',{exact:true})).toBeEnabled();
  await page.keyboard.press('Escape');
  if(process.env.DOCUMENT_PREFLIGHT_SCREENSHOT){await preflight.scrollIntoViewIfNeeded();await page.screenshot({path:process.env.DOCUMENT_PREFLIGHT_SCREENSHOT,animations:'disabled'});}
  await batch.getByRole('button',{name:'이 요청을 납품 구성에 첨부',exact:true}).click();
  const handoff=page.getByRole('dialog',{name:'납품으로 넘길 검토 기록',exact:true});
  await expect(handoff).toContainText('현재 도면 기록과 일치');
  await expect(handoff).toContainText('화면 도형 1개');
  if(process.env.DELIVERY_HANDOFF_SCREENSHOT)await page.screenshot({path:process.env.DELIVERY_HANDOFF_SCREENSHOT,animations:'disabled'});
  await page.getByRole('button',{name:'이 기록으로 납품 구성 열기',exact:true}).click();
  await page.getByRole('button',{name:'납품 구성으로 계속',exact:true}).click();
  const delivery=page.getByRole('region',{name:'납품·수신 화면 예시',exact:true});
  const comparison=delivery.getByRole('region',{name:'요청과 납품 도면 기록 대조',exact:true});
  await expect(comparison).toContainText('요청 당시 기록과 납품 구성 당시 기록이 일치합니다');
  const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).deliverySource,key);
  expect(saved.drawingSnapshot.objects[0].name).toBe('검토 영역');
  await delivery.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  await page.locator('[data-screen-shape]').click();
  await page.getByLabel('이름',{exact:true}).fill('수정된 영역');
  await page.getByLabel('이름',{exact:true}).blur();
  await page.reload();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await batch.getByRole('button',{name:'이 요청을 납품 구성에 첨부',exact:true}).click();
  await expect(handoff.getByRole('status')).toContainText('현재 도면이 요청 당시와 다릅니다');
  await expect(handoff).not.toContainText('현재 도면 기록과 일치');
  await handoff.getByRole('button',{name:'검토에 머무르기',exact:true}).click();
  await expect(preflight).toContainText('전체 도면 승인 전 보완 필요');
  await expect(batch.getByRole('button',{name:'전체 도면 승인 내용 구성',exact:true})).toBeDisabled();
  await expect(preflight).toContainText('요청 이후 도면이 바뀌었습니다');
  expect(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).deliverySource,key)).toEqual(saved);
  await open();
  await expect(page.getByRole('status').filter({hasText:'현재 작업이 구성 당시와 다릅니다'})).toBeVisible({timeout:5000});
  await expect(comparison).toContainText('요청 당시 기록과 납품 구성 당시 기록이 일치합니다');
  await page.getByRole('button',{name:'현재 도면으로 새 납품 구성',exact:true}).click();
  await page.getByRole('button',{name:'납품 구성으로 계속',exact:true}).click();
  await expect(comparison).toContainText('승인 요청과 납품 구성의 도면 기록이 다릅니다');
  await expect(comparison).toContainText('수정 1개');
  await expect(delivery.getByRole('button',{name:'납품 준비 화면 보기',exact:true})).toBeDisabled();
  await page.reload();await open();
  await expect(comparison).toContainText('수정 1개');
  const restored=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),key);
  expect(restored.deliverySource.drawingSnapshot.objects[0].name).toBe('수정된 영역');
  expect(restored.deliveryHistory[0].deliverySource).toEqual(saved);
  expect(restored.deliverySource.approvedRequest).toEqual(saved.approvedRequest);
  const beforeViewing=await page.evaluate(key=>sessionStorage.getItem(key),key);
  for(const [label,name] of [['요청 당시','검토 영역'],['납품 구성 당시','수정된 영역']]){
   await comparison.getByRole('button',{name:`${label} 도형 배치 보기`,exact:true}).click();
   const dialog=page.getByRole('dialog',{name:label==='요청 당시'?'요청 1 · 당시 도형 배치':'납품 구성 당시 도형 배치',exact:true});
   await expect(dialog.getByRole('region',{name:`${label} 도형 배치`,exact:true})).toBeVisible();
   await dialog.locator('[data-screen-shape]').click();
   await expect(dialog).toContainText(name);
   await expect(dialog.getByLabel('이름',{exact:true})).toHaveCount(0);
   await dialog.getByRole('button',{name:`${label} 도형 배치 닫기`,exact:true}).click();
   await expect(dialog).toHaveCount(0);
  }
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(beforeViewing);
  await comparison.getByRole('button',{name:'두 기록 나란히 비교',exact:true}).click();
  const split=page.getByRole('dialog',{name:'요청과 납품 도형 비교',exact:true});
  const left=split.getByRole('region',{name:'요청 당시 비교',exact:true});
  const right=split.getByRole('region',{name:'납품 구성 당시 비교',exact:true});
  await left.locator('[data-screen-shape]').click();
  await expect(left).toContainText('검토 영역 · 사각형');
  await expect(right).toContainText('수정된 영역 · 사각형');
  await expect(right.locator('[data-screen-shape]')).toHaveAttribute('aria-pressed','true');
  const leftBox=await left.boundingBox(),rightBox=await right.boundingBox();
  expect(rightBox.x).toBeGreaterThan(leftBox.x);expect(Math.abs(rightBox.y-leftBox.y)).toBeLessThan(2);
  if(process.env.DELIVERY_SNAPSHOT_SCREENSHOT)await page.screenshot({path:process.env.DELIVERY_SNAPSHOT_SCREENSHOT.replace('.png','-split.png'),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await expect.poll(async()=>{const a=await left.boundingBox(),b=await right.boundingBox();return b.y>a.y+a.height-2;}).toBe(true);
  await expect(split).toBeVisible();
  await split.getByRole('button',{name:'나란히 비교 닫기',exact:true}).click();
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(beforeViewing);
  await page.setViewportSize({width:1280,height:720});
  if(process.env.DELIVERY_SNAPSHOT_SCREENSHOT){await comparison.scrollIntoViewIfNeeded();await page.screenshot({path:process.env.DELIVERY_SNAPSHOT_SCREENSHOT,animations:'disabled'});}
 }finally{await browser.close();}
});
