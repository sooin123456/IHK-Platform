import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';
import {createHash} from 'node:crypto';

test('mobile request comparison reaches the current object and returns to editing',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const id='00000000-0000-4000-8000-000000000131';
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=${id}`);
  const old={id:'a',kind:'사각형',page:1,x:100,y:100,name:'이전 영역',layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''},current={...old,x:300,name:'수정한 영역'};
  const layers=[{id:'review',name:'검토',visible:true,locked:false}];
  const request={round:1,message:'영역 검토',items:[{id:'a',title:old.name,kind:'added',page:1,x:100,y:100,width:140,height:90,author:'나',summary:'영역',before:'없음',after:'사각형',sample:false}],decisions:{},snapshot:{documentName:'템플릿 도면',pageCount:1,objects:[old],layers,source:{kind:'office',paper:'A3'}}};
  await page.evaluate(({id,current,layers,request})=>{
   sessionStorage.setItem(`1hk:preview:screen-draft:${id}`,JSON.stringify({schemaVersion:1,source:'office:A3',objects:[current],layers}));
   sessionStorage.setItem(`1hk:preview:change-requests:${id}`,JSON.stringify({schemaVersion:1,requests:[request]}));
  },{id,current,layers,request});
  await page.reload();
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await page.getByText('요청 이후 변경 내역 · 추가 0 · 수정 1 · 삭제 0',{exact:true}).click();
  await page.getByRole('region',{name:'수정된 도형',exact:true}).getByRole('button',{name:'현재 위치 확인',exact:true}).click();
  await expect(page.getByRole('heading',{name:'수정한 영역',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'작성으로',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'이름',exact:true})).toHaveValue('수정한 영역');
  await expect(page.locator('[data-screen-shape="a"]')).toHaveAttribute('aria-pressed','true');
  const saved=await page.evaluate(id=>JSON.parse(sessionStorage.getItem(`1hk:preview:change-requests:${id}`)),id);
  expect(saved.requests[0].snapshot.objects[0].name).toBe('이전 영역');
  await page.getByRole('textbox',{name:'이름',exact:true}).fill('재수정 영역');
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await page.getByRole('button',{name:'같은 항목으로 재검토 구성',exact:true}).click();
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'요청 이력',exact:true})).toHaveValue('2');
  await expect.poll(()=>page.evaluate(id=>JSON.parse(sessionStorage.getItem(`1hk:preview:change-requests:${id}`)).requests.length,id)).toBe(2);
  const updated=await page.evaluate(id=>JSON.parse(sessionStorage.getItem(`1hk:preview:change-requests:${id}`)).requests,id);
  expect(updated[0]).toEqual(saved.requests[0]);
  expect(updated[1].snapshot.objects[0].name).toBe('재수정 영역');
  expect(updated[1].decisions).toEqual({});
  if(process.env.MOBILE_REVIEW_ROUND_SCREENSHOT)await page.screenshot({path:process.env.MOBILE_REVIEW_ROUND_SCREENSHOT,animations:'disabled'});
 }finally{await browser.close();}
});

test('hidden snapshot layers can be inspected without rewriting the frozen record',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const id='00000000-0000-4000-8000-000000000130',key=`1hk:preview:change-requests:${id}`;
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=blank&screenDocument=${id}`);
  const shape={id:'hidden',kind:'사각형',page:1,x:100,y:100,name:'숨긴 검토 영역',layer:'hidden',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
  const record=JSON.stringify({schemaVersion:1,requests:[{round:1,message:'저장된 요청',items:[{id:'hidden',title:shape.name,kind:'added',page:1,x:100,y:100,width:140,height:90,author:'나',summary:'영역',before:'없음',after:'사각형',sample:false}],decisions:{},snapshot:{documentName:'레이어 기록',pageCount:1,objects:[shape],layers:[{id:'hidden',name:'숨긴 레이어',visible:false,locked:true}],source:{kind:'blank',paper:'A3'}}}]});
  await page.evaluate(([key,record])=>sessionStorage.setItem(key,record),[key,record]);
  await page.reload();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await expect(page.getByText('요청 당시 전체 도면과 현재 화면이 다릅니다',{exact:true})).toBeVisible();
  await page.getByText('요청 이후 변경 내역 · 추가 0 · 수정 0 · 삭제 1',{exact:true}).click();
  await expect(page.getByRole('region',{name:'삭제된 도형',exact:true})).toContainText('숨긴 검토 영역');
  await page.getByRole('button',{name:'요청 당시 도형 배치 보기',exact:true}).click();
  const snapshot=page.getByRole('region',{name:'요청 당시 도형 배치',exact:true});
  await expect(snapshot.locator('[data-screen-shape]')).toHaveCount(0);
  await snapshot.getByRole('checkbox',{name:'숨긴 도형 함께 보기',exact:true}).check();
  await expect(snapshot.locator('[data-screen-shape]')).toHaveAttribute('aria-label','숨긴 검토 영역 · 화면 도형');
  await expect(snapshot).toContainText('임시 표시');
  if(process.env.HIDDEN_SNAPSHOT_SCREENSHOT)await page.screenshot({path:process.env.HIDDEN_SNAPSHOT_SCREENSHOT,animations:'disabled'});
  await page.getByRole('button',{name:'요청 당시 도형 배치 닫기',exact:true}).click();
  await page.getByRole('button',{name:'요청 당시 도형 배치 보기',exact:true}).click();
  await expect(snapshot.getByRole('checkbox',{name:'숨긴 도형 함께 보기',exact:true})).not.toBeChecked();
  await expect(snapshot.locator('[data-screen-shape]')).toHaveCount(0);
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(record);
  await page.getByRole('button',{name:'요청 당시 도형 배치 닫기',exact:true}).click();
  await page.getByRole('button',{name:'현재 항목으로 재검토 구성',exact:true}).click({timeout:5000});
  await expect(page.getByLabel('요청 메시지',{exact:true})).toHaveValue('저장된 요청');
  await expect(page.getByRole('button',{name:'요청 내용 미리보기',exact:true})).toBeDisabled();
  expect(await page.evaluate(key=>sessionStorage.getItem(key),key)).toBe(record);
 }finally{await browser.close();}
});

test('template request retains the matching background when reopened',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  for(const kind of ['office','house']){
   const page=await browser.newPage();
   await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=${kind}&screenDocument=00000000-0000-4000-8000-000000000129`);
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:100,y:100}});
   await page.getByRole('button',{name:'검토 요청 구성 열기',exact:true}).click();
   await page.getByLabel('요청 메시지',{exact:true}).fill('템플릿 배치 검토');
   await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
   await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
   for(const reload of [false,true]){
    if(reload){await page.reload();await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();}
    await page.getByRole('button',{name:'요청 당시 도형 배치 보기',exact:true}).click();
    const snapshot=page.getByRole('region',{name:'요청 당시 도형 배치',exact:true});
    const background=snapshot.getByRole('img',{name:'템플릿 배경 예시',exact:true});
    await expect(background).toBeVisible();
    await expect(background).toHaveAttribute('src',`/images/workspace-start/${kind}-plan.png`);
    await expect.poll(()=>background.evaluate(img=>img.naturalWidth)).toBeGreaterThan(0);
    const bounds=await background.boundingBox();
    expect(bounds.width/bounds.height).toBeCloseTo(7/3,1);
    if(process.env.TEMPLATE_SNAPSHOT_SCREENSHOT&&kind==='office'&&!reload)await page.screenshot({path:process.env.TEMPLATE_SNAPSHOT_SCREENSHOT,animations:'disabled'});
    await expect(snapshot.locator('[data-screen-shape]')).toHaveCount(1);
    await expect(snapshot.getByLabel('요청 당시 PDF 재선택',{exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'요청 당시 도형 배치 닫기',exact:true}).click();
   }
   await page.close();
  }
 }finally{await browser.close();}
});

test('second-page request opens its frozen page and retains all pages after reload',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const pdf=await PDFDocument.create();pdf.addPage([600,400]);pdf.addPage([600,400]);
 const file={name:'two-page-snapshot.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview?project=00000000-0000-4000-8000-000000000101&start=file`);
  await page.getByLabel('작업실에서 열 PDF 선택').setInputFiles(file);
  await page.getByRole('button',{name:'선택한 PDF 등록 방식 확인',exact:true}).click();
  await page.getByRole('button',{name:'등록 방식 확인 후 준비',exact:true}).click();
  await expect(page.getByRole('button',{name:'다음 페이지',exact:true})).toBeEnabled();
  for(const number of [1,2]){
   if(number===2)await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:100,y:100}});
   await page.getByLabel('이름',{exact:true}).fill(`${number}층 기록 영역`);
  }
  await page.getByRole('button',{name:'검토 요청 구성 열기',exact:true}).click();
  await page.getByLabel('요청 메시지',{exact:true}).fill('2층만 검토');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const snapshot=page.getByRole('region',{name:'요청 당시 도형 배치',exact:true});
  for(const reload of [false,true]){
   if(reload){await page.reload();await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles(file);await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();}
   await page.getByRole('button',{name:'요청 당시 도형 배치 보기',exact:true}).click();
   await expect(snapshot.getByLabel('기록 페이지',{exact:true})).toHaveValue('2');
   await expect(snapshot.getByLabel('PDF 2쪽',{exact:true})).toHaveAttribute('aria-busy','false');
   const fitted=await snapshot.locator('canvas').evaluate(canvas=>canvas.width);
   await snapshot.getByRole('button',{name:'기록 PDF 확대',exact:true}).click();
   await expect.poll(()=>snapshot.locator('canvas').evaluate(canvas=>canvas.width)).toBeGreaterThan(fitted);
   await snapshot.getByRole('button',{name:'기록 PDF 화면 맞춤',exact:true}).click();
   await expect.poll(()=>snapshot.locator('canvas').evaluate(canvas=>canvas.width)).toBe(fitted);
   await snapshot.getByText('요청 당시 원본 근거',{exact:true}).click();
   await expect(snapshot.getByText(createHash('sha256').update(file.buffer).digest('hex'),{exact:true})).toBeVisible();
   const originalInput=snapshot.getByLabel('요청 당시 PDF 재선택',{exact:true});
   const other=await PDFDocument.create();other.addPage([300,300]);
   await originalInput.setInputFiles({name:file.name,mimeType:'application/pdf',buffer:Buffer.from(await other.save())});
   await expect(snapshot.getByRole('alert')).toContainText('요청 당시 원본과 다릅니다');
   await expect(snapshot.locator('canvas')).toHaveCount(0);
   await originalInput.setInputFiles(file);
   await expect(snapshot.getByLabel('PDF 2쪽',{exact:true})).toHaveAttribute('aria-busy','false');
   await expect(snapshot.locator('canvas')).toBeVisible();
   if(process.env.REQUEST_SNAPSHOT_SCREENSHOT&&!reload)await page.screenshot({path:process.env.REQUEST_SNAPSHOT_SCREENSHOT,animations:'disabled'});
   await expect(snapshot.locator('[data-screen-shape]')).toHaveAttribute('aria-label','2층 기록 영역 · 화면 도형');
   await snapshot.getByLabel('기록 페이지',{exact:true}).selectOption('1');
   await expect(snapshot.locator('[data-screen-shape]')).toHaveAttribute('aria-label','1층 기록 영역 · 화면 도형');
   // Wait for the overlay's ResizeObserver to apply the fitted PDF viewport.
   await expect.poll(()=>snapshot.getByRole('region',{name:'화면 도형 오버레이',exact:true}).evaluate(svg=>Math.abs(svg.viewBox.baseVal.width-svg.getBoundingClientRect().width))).toBeLessThan(1);
   const shape=snapshot.locator('[data-screen-shape]'),before=await shape.getAttribute('transform');
   await shape.focus();await page.keyboard.press('ArrowRight');await expect(shape).toHaveAttribute('transform',before);
   await page.getByRole('button',{name:'요청 당시 도형 배치 닫기',exact:true}).click();
  }
 }finally{await browser.close();}
});
