import assert from 'node:assert/strict';
import test from 'node:test';
import {chromium,expect} from '@playwright/test';
import {PDFDocument} from 'pdf-lib';

test('mobile polyline controls undo draft points and cancel without creating objects',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({hasTouch:true,viewport:{width:390,height:844}});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000154`);
  const open=async()=>{await page.getByRole('button',{name:'작성 도구·명령 열기',exact:true}).tap();await page.getByRole('button',{name:'폴리라인 · 도면에 배치',exact:true}).tap();};
  await open();
  const controls=page.getByRole('group',{name:'폴리라인 작성 조작',exact:true});
  await expect(controls).toBeVisible({timeout:3000});
  const undo=page.getByRole('button',{name:'폴리라인 마지막 점 취소',exact:true});
  const finish=page.getByRole('button',{name:'폴리라인 완료',exact:true});
  await expect(undo).toBeDisabled();await expect(finish).toBeDisabled();
  const canvas=page.getByRole('region',{name:'화면 도형 오버레이',exact:true});
  const canvasBounds=await canvas.boundingBox(),controlsBounds=await controls.boundingBox();
  assert.ok(controlsBounds.y>=canvasBounds.y+canvasBounds.height||controlsBounds.y+controlsBounds.height<=canvasBounds.y,'작성 조작은 도면 밖에 있어야 합니다');
  await expect(page.getByRole('toolbar',{name:'도면 도구',exact:true})).toBeHidden();
  for(const point of [{x:90,y:90},{x:190,y:90},{x:190,y:130}])await canvas.tap({position:point});
  await expect(controls.getByRole('status')).toContainText('3/256');
  await undo.tap();await expect(controls.getByRole('status')).toContainText('2/256');
  await expect(finish).toBeEnabled();
  await undo.tap();await expect(finish).toBeDisabled();
  await page.getByRole('button',{name:'폴리라인 점 초기화',exact:true}).tap();
  await expect(undo).toBeDisabled();await expect(controls.getByRole('status')).toContainText('0/256');
  if(process.env.POLYLINE_CONTROLS_SCREENSHOT)await page.screenshot({path:process.env.POLYLINE_CONTROLS_SCREENSHOT,animations:'disabled'});
  for(const button of await controls.getByRole('button').all())await expect(button).toBeInViewport({ratio:1});
  await page.getByRole('button',{name:'폴리라인 작성 취소',exact:true}).tap();
  await expect(controls).toHaveCount(0);await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  await expect(page.getByRole('toolbar',{name:'도면 도구',exact:true})).toBeVisible();
  await open();await expect(controls.getByRole('status')).toContainText('0/256');
  await canvas.tap({position:{x:90,y:90}});await canvas.tap({position:{x:190,y:130}});
  await page.getByRole('button',{name:'폴리라인 작성 취소',exact:true}).tap();
  await expect(controls).toHaveCount(0);await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
 }finally{await browser.close();}
});

test('polyline draws multiple points and rejoins the normal object history',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({hasTouch:true});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000153`);
  await page.getByRole('button',{name:'작성 도구·명령 열기',exact:true}).click();
  await page.getByRole('button',{name:'폴리라인 · 도면에 배치',exact:true}).click({timeout:3000});
  const canvas=page.getByRole('region',{name:'화면 도형 오버레이',exact:true});
  for(const point of [{x:100,y:100},{x:240,y:100},{x:240,y:220}])await canvas.click({position:point});
  await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  if(process.env.POLYLINE_SCREENSHOT)await page.screenshot({path:process.env.POLYLINE_SCREENSHOT,animations:'disabled'});
  await page.getByRole('button',{name:'폴리라인 완료',exact:true}).click();
  const object=page.locator('[data-screen-shape]');
  await expect(object).toHaveCount(1);
  await expect(object.locator('polyline')).toHaveAttribute('points','0,0 140,0 140,90');
  const id=await object.getAttribute('data-screen-shape');
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await expect(object).toHaveCount(0);
  await page.getByRole('button',{name:'도형 다시 실행',exact:true}).click();
  await expect(object).toHaveAttribute('data-screen-shape',id);
  await page.reload();await expect(object).toHaveAttribute('data-screen-shape',id);
  await expect(object.locator('polyline')).toHaveAttribute('points','0,0 140,0 140,90');
  await object.focus();await page.keyboard.press('Enter');
  const handle=page.getByRole('button',{name:'폴리라인 꼭짓점 2 이동',exact:true});
  await expect(handle).toBeVisible({timeout:3000});
  await page.getByRole('button',{name:'폴리라인 꼭짓점 1 이동',exact:true}).click({trial:true,timeout:3000});
  if(process.env.POLYLINE_HANDLES_SCREENSHOT)await page.screenshot({path:process.env.POLYLINE_HANDLES_SCREENSHOT,animations:'disabled'});
  const handleBounds=await handle.boundingBox();
  const start={x:handleBounds.x+handleBounds.width/2,y:handleBounds.y+handleBounds.height/2};
  const savedBefore=await page.evaluate(()=>JSON.stringify({...sessionStorage}));
  await page.mouse.move(start.x,start.y);await page.mouse.down();
  await page.mouse.move(start.x-25,start.y+30);
  await expect(object.locator('polyline')).not.toHaveAttribute('points','0,0 140,0 140,90');
  assert.equal(await page.evaluate(()=>JSON.stringify({...sessionStorage})),savedBefore);
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(object.locator('polyline')).toHaveAttribute('points','0,0 140,0 140,90');
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x-25,start.y+30);await page.mouse.up();
  await expect(object.locator('polyline')).not.toHaveAttribute('points','0,0 140,0 140,90');
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await expect(object.locator('polyline')).toHaveAttribute('points','0,0 140,0 140,90');
  await page.getByText('경로 꼭짓점 · 3개',{exact:true}).click({timeout:3000});
  await page.getByLabel('점 2 세로 위치 (%)',{exact:true}).fill('50');
  await page.getByLabel('점 2 세로 위치 (%)',{exact:true}).blur();
  await expect(object.locator('polyline')).toHaveAttribute('points','0,0 140,45 140,90');
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await expect(object.locator('polyline')).toHaveAttribute('points','0,0 140,0 140,90');
  await page.getByRole('button',{name:'점 2 삭제',exact:true}).click();
  await expect(object.locator('polyline')).toHaveAttribute('points','0,0 140,90');
  await expect(page.getByRole('button',{name:'점 1 삭제',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await page.getByRole('button',{name:'점 1 뒤에 중간점 추가',exact:true}).click();
  await expect(object.locator('polyline')).toHaveAttribute('points','0,0 70,0 140,0 140,90');
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await object.focus();
  const beforeMove=await object.getAttribute('transform');
  await page.keyboard.press('ArrowRight');
  assert.notEqual(await object.getAttribute('transform'),beforeMove);
  await page.getByRole('button',{name:'선택 도형으로 검토 요청',exact:true}).click();
  await page.getByLabel('요청 메시지',{exact:true}).fill('폴리라인 경로 확인');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const record=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000153')));
  assert.deepEqual(record.requests[0].snapshot.objects[0].points,[{x:0,y:0},{x:140,y:0},{x:140,y:90}]);
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  await page.getByRole('button',{name:'작성 도구·명령 열기',exact:true}).click();
  await page.getByRole('button',{name:'폴리라인 · 도면에 배치',exact:true}).click();
  await canvas.click({position:{x:120,y:180}});
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'폴리라인 완료',exact:true})).not.toBeVisible();
  await expect(object).toHaveCount(1);
  await page.getByRole('button',{name:'작성 도구·명령 열기',exact:true}).click();
  await page.getByRole('button',{name:'폴리라인 · 도면에 배치',exact:true}).click();
  await canvas.click({position:{x:130,y:130}});await canvas.click({position:{x:220,y:210}});
  await page.keyboard.press('Enter');
  await expect(object).toHaveCount(2);
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'작성 도구·명령 열기',exact:true}).click();
  await page.getByRole('button',{name:'폴리라인 · 도면에 배치',exact:true}).click();
  await canvas.tap({position:{x:100,y:80}});await canvas.tap({position:{x:180,y:130}});
  if(process.env.POLYLINE_MOBILE_SCREENSHOT)await page.screenshot({path:process.env.POLYLINE_MOBILE_SCREENSHOT,animations:'disabled'});
  await page.getByRole('button',{name:'폴리라인 완료',exact:true}).tap();
  await expect(object).toHaveCount(3);
  const first=page.locator(`[data-screen-shape="${id}"]`);
  await first.focus();await page.keyboard.press('Enter');
  await page.getByText('경로 꼭짓점 · 3개',{exact:true}).click();
  const pointY=page.getByLabel('점 2 세로 위치 (%)',{exact:true});
  await pointY.fill('50');await pointY.blur();
  await expect(first.locator('polyline')).toHaveAttribute('points','0,0 140,45 140,90');
  await pointY.fill('101');await pointY.blur();await expect(pointY).toHaveValue('50');
  if(process.env.POLYLINE_POINTS_SCREENSHOT)await page.screenshot({path:process.env.POLYLINE_POINTS_SCREENSHOT,animations:'disabled'});
  await page.reload();await expect(first.locator('polyline')).toHaveAttribute('points','0,0 140,45 140,90');
  const preserved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000153')));
  assert.deepEqual(preserved.requests[0].snapshot.objects[0].points,[{x:0,y:0},{x:140,y:0},{x:140,y:90}]);
  const stored=await page.evaluate(()=>sessionStorage.getItem('1hk:preview:screen-draft:00000000-0000-4000-8000-000000000153'));
  await page.goto(`${page.url()}&role=viewer`);await first.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('button',{name:'폴리라인 꼭짓점 2 이동',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'속성',exact:true}).click();
  await page.getByText('경로 꼭짓점 · 3개',{exact:true}).click();
  await expect(pointY).toBeDisabled();
  await expect(page.getByRole('button',{name:'점 2 삭제',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'점 1 뒤에 중간점 추가',exact:true})).toBeDisabled();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('1hk:preview:screen-draft:00000000-0000-4000-8000-000000000153')),stored);
 }finally{await browser.close();}
});

test('PDF selection waits for hydration before accepting a file',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});let release=()=>{};
 try{
  const page=await browser.newPage();const gate=new Promise(resolve=>release=resolve);
  await page.route('**/*.js',async route=>{await gate;await route.continue();});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf`,{waitUntil:'commit'});
  const input=page.getByLabel('로컬 PDF 선택',{exact:true});
  await expect(input).toBeDisabled({timeout:3000});
  release();await expect(input).toBeEnabled();
  const pdf=await PDFDocument.create();pdf.addPage();
  await input.setInputFiles({name:'ready-selection.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
  await expect(page.getByRole('heading',{name:'ready-selection.pdf',exact:true})).toBeVisible();
  await expect(page.getByLabel('현재 페이지 편집 상태',{exact:true})).toContainText('작성 가능');
 }finally{release();await browser.close();}
});

test('single object inspector keeps geometry visible ahead of secondary information',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:220,y:150}});
  await expect(page.getByLabel('현재 페이지 편집 상태',{exact:true})).toContainText('화면 도형 1개 · 작성 가능');
  await expect(page.locator('.pdf-example-caption')).toContainText('배경 원본은 수정하지 않습니다');
  for(const label of ['화면 X 위치','화면 Y 위치','화면 도형 가로','화면 도형 세로','화면 회전 각도'])await expect(page.getByLabel(label,{exact:true})).toBeInViewport({ratio:1,timeout:3000});
  const properties=page.getByRole('region',{name:'선택 도형 사용자 속성',exact:true});
  await expect(properties.getByRole('button',{name:'사용자 속성 편집',exact:true})).not.toBeVisible();
  await properties.getByText('사용자 속성 상세',{exact:true}).click();
  await expect(properties.getByRole('button',{name:'사용자 속성 편집',exact:true})).toBeVisible();
  if(process.env.INSPECTOR_SCREENSHOT){await page.getByRole('complementary',{name:'도면 정보 패널',exact:true}).evaluate(element=>{element.scrollTop=0;});await page.screenshot({path:process.env.INSPECTOR_SCREENSHOT,animations:'disabled'});}
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await expect(page.getByLabel('현재 페이지 편집 상태',{exact:true})).toContainText('화면 도형 1개 · 검토 중');
 }finally{await browser.close();}
});

test('rectangle display size changes the visible frame and survives reopening',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000152`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:200,y:150}});
  const shape=page.locator('[data-screen-shape]');
  const id=await shape.getAttribute('data-screen-shape');
  const before=await shape.boundingBox();
  await page.getByLabel('화면 도형 가로',{exact:true}).fill('280',{timeout:5000});
  await page.getByLabel('화면 도형 세로',{exact:true}).fill('180');
  await page.getByLabel('화면 도형 세로',{exact:true}).blur();
  const after=await shape.boundingBox();
  expect(after.width/before.width).toBeCloseTo(2,1);expect(after.height/before.height).toBeCloseTo(2,1);
  await page.getByRole('button',{name:'선택 도형 90도 회전',exact:true}).click();
  await expect(shape).toHaveAttribute('transform',/rotate\(90 140 90\)/);
  await page.reload();await shape.focus();await page.keyboard.press('Enter');
  await expect(shape).toHaveAttribute('data-screen-shape',id);
  await expect(page.getByLabel('화면 도형 가로',{exact:true})).toHaveValue('280');
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  const region=page.locator('.change-region');
  await expect(region).toBeVisible();
  const regionBox=await region.boundingBox(),shapeBox=await shape.boundingBox();
  expect(regionBox.width/regionBox.height).toBeCloseTo(180/280,2);
  expect(regionBox.x+regionBox.width/2).toBeCloseTo(shapeBox.x+shapeBox.width/2,0);
  expect(regionBox.y+regionBox.height/2).toBeCloseTo(shapeBox.y+shapeBox.height/2,0);
  if(process.env.SIZE_SCREENSHOT)await page.screenshot({path:process.env.SIZE_SCREENSHOT,animations:'disabled'});
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  await page.getByRole('button',{name:'속성',exact:true}).click();
  await expect(page.getByLabel('화면 도형 세로',{exact:true})).toHaveValue('180');
  await page.getByLabel('화면 도형 가로',{exact:true}).fill('0');
  await page.getByLabel('화면 도형 가로',{exact:true}).blur();
  await expect(page.getByLabel('화면 도형 가로',{exact:true})).toHaveValue('280');
 }finally{await browser.close();}
});

test('selected object rotation survives undo copy and reopening',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const url=`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000151`;
  await page.goto(url);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:300,y:180}});
  const shape=page.locator('[data-screen-shape]');
  const id=await shape.getAttribute('data-screen-shape');
  await page.getByRole('button',{name:'선택 도형 90도 회전',exact:true}).click({timeout:5000});
  await expect(shape).toHaveAttribute('transform',/rotate\(90 70 45\)/);
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await expect(shape).toHaveAttribute('transform',/rotate\(0 70 45\)/);
  await page.getByRole('button',{name:'도형 다시 실행',exact:true}).click();
  await expect(shape).toHaveAttribute('transform',/rotate\(90 70 45\)/);
  await page.getByRole('button',{name:'선택 도형 복사',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(2);
  await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveAttribute('transform',/rotate\(90 70 45\)/);
  await page.reload();
  const original=page.locator(`[data-screen-shape="${id}"]`);
  await expect(original).toHaveAttribute('transform',/rotate\(90 70 45\)/);
  await original.focus();await page.keyboard.press('Enter');
  await page.getByLabel('화면 회전 각도',{exact:true}).fill('45');
  await page.getByLabel('화면 회전 각도',{exact:true}).blur();
  await expect(original).toHaveAttribute('transform',/rotate\(45 70 45\)/);
  if(process.env.ROTATION_SCREENSHOT)await page.screenshot({path:process.env.ROTATION_SCREENSHOT,animations:'disabled'});
  const stored=await page.evaluate(()=>sessionStorage.getItem('1hk:preview:screen-draft:00000000-0000-4000-8000-000000000151'));
  await page.goto(`${url}&role=viewer`);await original.focus();await page.keyboard.press('Enter');
  await expect(page.getByLabel('현재 페이지 편집 상태',{exact:true})).toContainText('읽기 전용');
  await page.getByRole('button',{name:'속성',exact:true}).click();
  await expect(page.getByRole('button',{name:'선택 도형 90도 회전',exact:true})).toBeDisabled();
  await expect(page.getByLabel('화면 회전 각도',{exact:true})).toBeDisabled();
  expect(await page.evaluate(()=>sessionStorage.getItem('1hk:preview:screen-draft:00000000-0000-4000-8000-000000000151'))).toBe(stored);
 }finally{await browser.close();}
});

test('library block placement persists its symbol through editing and reopening',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000149`);
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
  await menu.getByRole('button',{name:'블록·라이브러리',exact:true}).click();
  await menu.getByLabel('블록 검색',{exact:true}).fill('F-01');
  await menu.getByRole('button',{name:'이 블록 도면에 배치',exact:true}).click({timeout:5000});
  await expect(menu).not.toBeVisible();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:200,y:120}});
  const block=page.getByRole('button',{name:'6인 회의 테이블 · 화면 도형',exact:true});
  const id=await block.getAttribute('data-screen-shape');
  await expect(block.locator('[data-block-code="F-01"]')).toHaveCount(1);
  if(process.env.BLOCK_PLACEMENT_SCREENSHOT)await page.screenshot({path:process.env.BLOCK_PLACEMENT_SCREENSHOT,animations:'disabled'});
  await block.focus();await page.keyboard.press('ArrowRight');
  const key='1hk:preview:screen-draft:00000000-0000-4000-8000-000000000149';
  const stored=await page.evaluate(key=>sessionStorage.getItem(key),key);
  assert.equal(JSON.parse(stored).objects[0].blockCode,'F-01');
  await page.reload();
  await expect(block).toHaveAttribute('data-screen-shape',id);
  await expect(block.locator('[data-block-code="F-01"]')).toHaveCount(1);
  await block.click();await page.getByRole('button',{name:'선택 도형 삭제',exact:true}).click();
  await expect(block).toHaveCount(0);
  await page.getByRole('button',{name:'도형 삭제 취소',exact:true}).click();
  await expect(block).toHaveAttribute('data-screen-shape',id);
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),stored);
 }finally{await browser.close();}
});

test('block library filtering keeps the visible symbol and detail on the same block',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
  await menu.getByRole('button',{name:'블록·라이브러리',exact:true}).click();
  await menu.getByRole('button',{name:'가구',exact:true}).click();
  const detail=menu.getByRole('region',{name:'선택한 블록 상세',exact:true});
  await expect(detail.getByRole('heading',{name:'6인 회의 테이블',exact:true})).toBeVisible({timeout:5000});
  await expect(detail.getByRole('img',{name:'6인 회의 테이블 평면 기호 예시',exact:true})).toBeVisible();
  await menu.getByLabel('블록 검색',{exact:true}).fill('F-02');
  await expect(detail.getByRole('heading',{name:'업무용 책상',exact:true})).toBeVisible();
  await expect(detail.getByRole('img',{name:'업무용 책상 평면 기호 예시',exact:true})).toBeVisible();
  if(process.env.BLOCK_LIBRARY_SCREENSHOT){await detail.scrollIntoViewIfNeeded();await page.screenshot({path:process.env.BLOCK_LIBRARY_SCREENSHOT,animations:'disabled'});}
  await menu.getByLabel('블록 검색',{exact:true}).fill('없는블록');
  await expect(detail).not.toBeVisible();
  await menu.getByRole('button',{name:'검색 초기화',exact:true}).click();
  await expect(detail.getByRole('heading',{name:'단일 여닫이문',exact:true})).toBeVisible();
 }finally{await browser.close();}
});

for(const mobile of [false,true])test(`correction navigation visits only requested corrections and preserves edits${mobile?' on mobile':''}`,{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000155`);
  for(const [x,name] of [[100,'수정 A'],[300,'확인 B'],[500,'수정 C']]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
   await page.getByLabel('이름',{exact:true}).fill(name);
  }
  await page.getByRole('button',{name:'수정 A · 화면 도형',exact:true}).click();
  for(const name of ['확인 B','수정 C'])await page.getByRole('button',{name:`${name} · 화면 도형`,exact:true}).click({modifiers:['Shift']});
  await page.getByRole('button',{name:'선택한 3개 도형으로 검토 요청',exact:true}).click();
  await page.getByLabel('요청 메시지',{exact:true}).fill('세 영역 검토');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const request=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await request.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  for(const name of ['수정 A','수정 C']){
   const item=request.getByRole('article',{name,exact:true});
   await item.getByLabel('검토 의견',{exact:true}).fill(`${name} 이름 보완`);
   await item.getByRole('button',{name:'수정 요청 · 예시',exact:true}).click();
  }
  await request.getByRole('article',{name:'확인 B',exact:true}).getByRole('button',{name:'확인 · 예시',exact:true}).click();
  const key='1hk:preview:change-requests:00000000-0000-4000-8000-000000000155';
  const raw=await page.evaluate(key=>sessionStorage.getItem(key),key);
  if(mobile)await page.setViewportSize({width:390,height:667});
  await request.getByRole('button',{name:'수정 요청 도형 편집',exact:true}).click();
  const correction=page.getByRole('region',{name:'선택 도형의 수정 요청',exact:true});
  const previous=correction.getByRole('button',{name:'이전 수정 대상',exact:true});
  const next=correction.getByRole('button',{name:'다음 수정 대상',exact:true});
  await expect(previous).toBeDisabled({timeout:3000});
  await expect(correction).toContainText('수정 대상 1 / 2');
  await page.getByLabel('이름',{exact:true}).fill('보완 A');
  await next.click();
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('수정 C');
  await expect(correction).toContainText('수정 C 이름 보완');
  await expect(correction).toContainText('수정 대상 2 / 2');
  await expect(next).toBeDisabled();
  if(mobile&&process.env.CORRECTION_NAV_SCREENSHOT)await page.screenshot({path:process.env.CORRECTION_NAV_SCREENSHOT,animations:'disabled'});
  await expect(previous).toBeInViewport({ratio:1});
  await expect(correction.getByRole('button',{name:'요청 1로 돌아가기',exact:true})).toBeInViewport({ratio:1});
  await page.getByLabel('이름',{exact:true}).fill('보완 C');
  await previous.click();
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('보완 A');
  await expect(correction).toContainText('수정 A 이름 보완');
  await next.click();
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('보완 C');
  if(mobile&&process.env.CORRECTION_NAV_SCREENSHOT)await page.screenshot({path:process.env.CORRECTION_NAV_SCREENSHOT,animations:'disabled'});
  await correction.getByRole('button',{name:'요청 1로 돌아가기',exact:true}).click();
  await expect(request).toBeVisible();
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),raw);
 }finally{await browser.close();}
});

for(const mobileCorrection of [false,true])test(`correction opens the requested object for editing and resubmits without rewriting the old request${mobileCorrection?' on mobile with a long note':''}`,{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000147`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:150,y:100}});
  await page.getByLabel('이름',{exact:true}).fill('수정 전 영역');
  const id=await page.locator('[data-screen-shape][aria-pressed=true]').getAttribute('data-screen-shape');
  const panel=page.getByRole('region',{name:'변경과 대화',exact:true});
  const submit=async()=>{
   await page.getByRole('button',{name:'선택 도형으로 검토 요청',exact:true}).click();
   await panel.getByLabel('요청 메시지',{exact:true}).fill('영역 검토 부탁드립니다');
   await panel.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
   await panel.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  };
  await submit();
  const request=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await request.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  const correctionNote=mobileCorrection?'영역 이름 수정\n'+'통로와 출입구가 겹치지 않는지 확인해 주세요. '.repeat(20)+'\n마지막 확인 사항':'영역 이름 수정';
  await request.getByLabel('검토 의견',{exact:true}).fill(correctionNote);
  await request.getByRole('button',{name:'수정 요청 · 예시',exact:true}).click();
  const read=()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000147')).requests);
  const before=await read();
  if(mobileCorrection)await page.setViewportSize({width:390,height:844});
  await request.getByRole('button',{name:'수정 요청 도형 편집',exact:true}).click({timeout:5000});
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('수정 전 영역');
  const correction=page.getByRole('region',{name:'선택 도형의 수정 요청',exact:true});
  await expect(correction).toContainText('영역 이름 수정');
  if(mobileCorrection&&process.env.MOBILE_CORRECTION_SCREENSHOT)await page.screenshot({path:process.env.MOBILE_CORRECTION_SCREENSHOT,animations:'disabled'});
  await expect(correction).toBeInViewport({ratio:1,timeout:3000});
  if(mobileCorrection){
   const note=correction.locator('p');
   await expect(note).toHaveText(correctionNote);
   await note.evaluate(element=>element.scrollTo({top:element.scrollHeight}));
   assert.ok(await note.evaluate(element=>element.scrollTop>0),'long correction should scroll within the note');
   await expect(correction.getByRole('button',{name:'요청 1로 돌아가기',exact:true})).toBeInViewport({ratio:1});
  }
  assert.ok((await correction.boundingBox()).y>=(await page.locator('.pdf-screen-right .pdf-panel-tabs').boundingBox()).y+(await page.locator('.pdf-screen-right .pdf-panel-tabs').boundingBox()).height,'correction must not be covered by the sticky tabs');
  await correction.getByRole('button',{name:'요청 1로 돌아가기',exact:true}).click();
  await expect(request).toBeVisible();
  assert.deepEqual(await read(),before);
  await request.getByRole('button',{name:'수정 요청 도형 편집',exact:true}).click();
  await expect(correction).toContainText('영역 이름 수정');
  await expect(correction).toBeInViewport({ratio:1,timeout:3000});
  if(mobileCorrection&&process.env.MOBILE_CORRECTION_SCREENSHOT)await page.screenshot({path:process.env.MOBILE_CORRECTION_SCREENSHOT,animations:'disabled'});
  if(!mobileCorrection&&process.env.CORRECTION_CONTEXT_SCREENSHOT)await page.screenshot({path:process.env.CORRECTION_CONTEXT_SCREENSHOT,animations:'disabled'});
  await page.getByLabel('이름',{exact:true}).fill('수정 완료 영역');
  await submit();
  const after=await read();
  assert.deepEqual(after[0],before[0]);
  assert.equal(after[1].items[0].id,id);
  assert.equal(after[1].items[0].title,'수정 완료 영역');
  assert.deepEqual(after[1].decisions,{});
  assert.equal(after[1].approval,undefined);
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  if(mobileCorrection)await page.getByRole('button',{name:'정보 패널 닫기',exact:true}).click();
  await page.locator(`[data-screen-shape="${id}"]`).click();
  await expect(correction).toHaveCount(0);
 }finally{await browser.close();}
});

test('multi-selection enters one review request without adding unselected objects',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({hasTouch:true});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000146`);
  for(const [x,name] of [[100,'검토 A'],[300,'검토 B'],[500,'제외 C']]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
   await page.getByLabel('이름',{exact:true}).fill(name);
  }
  await page.getByRole('button',{name:'검토 A · 화면 도형',exact:true}).click();
  await page.getByRole('button',{name:'검토 B · 화면 도형',exact:true}).click({modifiers:['Shift']});
  const ids=await page.locator('[data-screen-shape][aria-pressed=true]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-screen-shape')));
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'선택한 2개 도형으로 검토 요청',exact:true}).tap({timeout:5000});
  const panel=page.getByRole('region',{name:'변경과 대화',exact:true});
  await expect(panel.getByRole('checkbox',{name:'검토 A · 1쪽',exact:true})).toBeChecked();
  await expect(panel.getByRole('checkbox',{name:'검토 B · 1쪽',exact:true})).toBeChecked();
  await expect(panel.getByRole('checkbox',{name:'제외 C · 1쪽',exact:true})).not.toBeChecked();
  const drawing=page.locator('.pdf-example-sheet');
  await expect(drawing).toBeInViewport({ratio:1});
  assert.ok((await drawing.boundingBox()).height>=100,'request must leave a readable drawing overview, not a collapsed strip');
  await page.setViewportSize({width:390,height:667});
  await expect(drawing).toBeInViewport({ratio:1});
  assert.ok((await drawing.boundingBox()).height>=100,'short mobile viewport must retain the drawing overview');
  await page.setViewportSize({width:390,height:844});
  if(process.env.MULTI_REQUEST_SCREENSHOT)await page.screenshot({path:process.env.MULTI_REQUEST_SCREENSHOT,animations:'disabled'});
  await panel.getByLabel('요청 메시지',{exact:true}).fill('두 영역 함께 확인');
  await panel.getByRole('button',{name:'요청 내용 미리보기',exact:true}).tap();
  await panel.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).tap();
  await expect(page.getByRole('region',{name:'요청 묶음 검토',exact:true})).toContainText('두 영역 함께 확인');
  const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000146')));
  assert.deepEqual(saved.requests[0].items.map(item=>item.id),ids);
  assert.equal(saved.requests[0].approval,undefined);
  const request=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await request.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).tap();
  for(const name of ['검토 A','검토 B']){
   const item=request.getByRole('article',{name,exact:true});
   await item.getByLabel('검토 의견',{exact:true}).fill(`${name} 수정`);
   await item.getByRole('button',{name:'수정 요청 · 예시',exact:true}).tap();
  }
  await request.getByRole('article',{name:'검토 B',exact:true}).getByRole('button',{name:'이 수정 대상 편집',exact:true}).tap({timeout:5000});
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('검토 B');
  await expect(page.locator(`[data-screen-shape="${ids[1]}"]`)).toHaveAttribute('aria-pressed','true');
  await page.getByLabel('이름',{exact:true}).fill('검토 B 수정됨');
  await expect(page.getByRole('button',{name:'검토 A · 화면 도형',exact:true})).toBeAttached();
  const preserved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000146')));
  assert.deepEqual(preserved.requests[0].items,saved.requests[0].items);
  assert.equal(preserved.requests[0].decisions[ids[1]].note,'검토 B 수정');
 }finally{await browser.close();}
});

test('inspector requests only the selected shape through the shared request bundle',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000145`);
  for(const [x,name] of [[100,'첫 번째 영역'],[350,'선택 요청 영역']]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
   await page.getByLabel('이름',{exact:true}).fill(name);
  }
  const selected=await page.locator('[data-screen-shape][aria-pressed=true]').getAttribute('data-screen-shape');
  await page.getByRole('button',{name:'선택 도형으로 검토 요청',exact:true}).click({timeout:5000});
  const panel=page.getByRole('region',{name:'변경과 대화',exact:true});
  await expect(panel.getByRole('checkbox',{name:'선택 요청 영역 · 1쪽',exact:true})).toBeChecked();
  await expect(panel.getByRole('checkbox',{name:'첫 번째 영역 · 1쪽',exact:true})).not.toBeChecked();
  await panel.getByLabel('요청 메시지',{exact:true}).fill('선택한 영역만 확인');
  await panel.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await panel.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const request=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await expect(request).toContainText('선택한 영역만 확인');
  const snapshot=page.getByRole('dialog',{name:'요청 1 · 당시 도형 배치',exact:true});
  await expect(snapshot).toBeHidden();
  const beforeSnapshot=await page.evaluate(()=>sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000145'));
  await request.getByRole('button',{name:'요청 당시 도형 배치 보기',exact:true}).click();
  await expect(snapshot).toBeVisible();
  await expect(snapshot).toContainText('읽기 전용 화면 기록');
  await page.keyboard.press('Escape');
  await expect(snapshot).toBeHidden();
  await expect(request).toBeVisible();
  await expect(request.getByRole('button',{name:'요청 당시 도형 배치 보기',exact:true})).toBeFocused();
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000145')),beforeSnapshot);
  await expect(request.getByRole('region',{name:'요청 기준 도면 개정',exact:true})).toContainText('요청 당시 기준 도면 R1');
  if(process.env.REQUEST_REVISION_SCREENSHOT)await page.screenshot({path:process.env.REQUEST_REVISION_SCREENSHOT,animations:'disabled'});
  const saved=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000145')));
  assert.deepEqual(saved.requests[0].items.map(item=>item.id),[selected]);
  assert.equal(saved.requests[0].drawingRevision,1);
  assert.equal(saved.requests[0].approval,undefined);
  await request.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  await request.getByLabel('검토 의견',{exact:true}).fill('이 위치 치수 확인');
  await request.getByRole('button',{name:'도면에서 확인',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'검토 요청 구성',exact:true})).not.toBeVisible();
  await expect(page.locator(`[data-screen-shape="${selected}"]`)).toHaveAttribute('aria-pressed','true');
  await panel.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await expect(request.getByLabel('검토 의견',{exact:true})).toHaveValue('이 위치 치수 확인');
  await expect(request.getByRole('heading',{name:'선택 요청 영역',exact:true})).toBeInViewport({ratio:1});
  await expect(request.getByRole('heading',{name:'선택 요청 영역',exact:true})).toBeFocused();
  await page.setViewportSize({width:390,height:844});
  await request.getByRole('button',{name:'도면에서 확인',exact:true}).click();
  await expect(panel.locator(`[data-change-detail="${selected}"]`)).toBeVisible();
  await expect(panel.getByLabel('이 위치에 의견 남기기',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await expect(request.getByLabel('검토 의견',{exact:true})).toHaveValue('이 위치 치수 확인');
  await expect(request.getByRole('heading',{name:'선택 요청 영역',exact:true})).toBeInViewport({ratio:1});
  await expect(request.getByRole('heading',{name:'선택 요청 영역',exact:true})).toBeFocused();
  await page.setViewportSize({width:1280,height:720});
  assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000145'))),saved);
  await request.getByRole('button',{name:'수정 요청 · 예시',exact:true}).click();
  await request.getByLabel('요청 항목 상태',{exact:true}).selectOption('checked');
  await request.getByRole('searchbox',{name:'요청 항목 검색',exact:true}).fill('없는 검색어');
  await expect(request.getByRole('article')).toHaveCount(0);
  await request.getByRole('button',{name:'첫 수정 요청 위치 확인',exact:true}).click();
  await panel.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await expect(request.getByRole('heading',{name:'선택 요청 영역',exact:true})).toBeFocused({timeout:3000});
  await expect(request.getByRole('searchbox',{name:'요청 항목 검색',exact:true})).toHaveValue('');
  await expect(request.getByLabel('검토 의견',{exact:true})).toHaveValue('이 위치 치수 확인');
  await page.getByRole('button',{name:'작성 모드',exact:true}).click();
  await page.getByRole('button',{name:'첫 번째 영역 · 화면 도형',exact:true}).click();
  await page.getByRole('button',{name:'선택 도형으로 검토 요청',exact:true}).click();
  await expect(panel.getByRole('heading',{name:'검토 요청 구성',exact:true})).toBeInViewport();
  await expect(panel.getByRole('checkbox',{name:'첫 번째 영역 · 1쪽',exact:true})).toBeChecked();
  await expect(panel.getByRole('checkbox',{name:'선택 요청 영역 · 1쪽',exact:true})).not.toBeChecked();
  assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000145'))),{...saved,requests:[{...saved.requests[0],decisions:{[selected]:{kind:'changes',note:'이 위치 치수 확인'}}}]});
  if(process.env.INSPECTOR_REQUEST_SCREENSHOT)await page.screenshot({path:process.env.INSPECTOR_REQUEST_SCREENSHOT,animations:'disabled'});
 }finally{await browser.close();}
});

test('mobile authoring opens the selected inspector then its review without an extra panel toggle',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).tap();
  const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
  await menu.getByRole('button',{name:'작성 도구·명령',exact:true}).tap();
  await menu.getByLabel('도구·명령 검색',{exact:true}).fill('사각형');
  await menu.getByRole('button',{name:'사각형 · 도면에 배치',exact:true}).tap();
  await expect(menu).not.toBeVisible();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).tap({position:{x:100,y:100}});
  const id=await page.locator('[data-screen-shape]').getAttribute('data-screen-shape');
  await expect(page.getByLabel('이름',{exact:true})).toBeInViewport();
  await page.getByLabel('이름',{exact:true}).fill('모바일 검토 영역');
  await page.getByText('기존 단일 도형 개정 검토',{exact:true}).tap();
  await page.getByRole('button',{name:'선택 도형 검토 대상으로 지정',exact:true}).tap();
  const review=page.getByRole('region',{name:'도면 검토 패널',exact:true});
  await expect(review.getByRole('heading',{name:'변경 1건',exact:true})).toBeInViewport();
  if(process.env.MOBILE_AUTHORING_REVIEW_SCREENSHOT)await page.screenshot({path:process.env.MOBILE_AUTHORING_REVIEW_SCREENSHOT,animations:'disabled'});
  await review.getByRole('heading',{name:'모바일 검토 영역 · 1쪽',exact:true}).scrollIntoViewIfNeeded();
  await expect(review.getByRole('heading',{name:'모바일 검토 영역 · 1쪽',exact:true})).toBeInViewport();
  await review.getByRole('textbox',{name:'요청 내용',exact:true}).fill('영역 확인 요청');
  await review.getByRole('button',{name:'검토 요청',exact:true}).tap();
  await expect(review.getByRole('button',{name:'검토자 보기',exact:true})).toBeVisible();
  assert.equal(await page.locator('[data-screen-shape]').getAttribute('data-screen-shape'),id);
 }finally{await browser.close();}
});

test('authoring menu search activates the canvas tool and its creation uses canvas undo',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'작성 도구·명령 열기',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
  await menu.getByLabel('도구·명령 검색',{exact:true}).fill('rectangle');
  await menu.getByRole('button',{name:'사각형 · 도면에 배치',exact:true}).click({timeout:5000});
  await expect(menu).not.toBeVisible();
  await expect(page.getByRole('button',{name:'사각형 도구 화면',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:100,y:100}});
  await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  await page.getByRole('button',{name:'작성 도구·명령 열기',exact:true}).click();
  await menu.getByLabel('도구·명령 검색',{exact:true}).fill('circle');
  if(process.env.AUTHORING_LAUNCHER_SCREENSHOT)await page.screenshot({path:process.env.AUTHORING_LAUNCHER_SCREENSHOT,animations:'disabled'});
  await menu.getByLabel('도구·명령 검색',{exact:true}).press('Enter');
  await expect(menu).not.toBeVisible();
  await expect(page.getByRole('button',{name:'원 도구 화면',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'원 도구 화면',exact:true})).toHaveAttribute('aria-pressed','false');
  await page.goto(`${page.url()}&role=viewer`);
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  await menu.getByRole('button',{name:'작성 도구·명령',exact:true}).click();
  await expect(menu.getByRole('button',{name:'선 · 도면에 배치',exact:true})).toBeDisabled();
  await menu.getByLabel('도구·명령 검색',{exact:true}).fill('circle');
  await menu.getByLabel('도구·명령 검색',{exact:true}).press('Enter');
  await expect(menu).toBeVisible();
 }finally{await browser.close();}
});

test('object properties belong to the selected shape and restore with the drawing',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000134`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:100,y:100}});
  const id=await page.locator('[data-screen-shape]').getAttribute('data-screen-shape');
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
  await menu.getByRole('button',{name:'사용자 속성',exact:true}).click();
  await menu.getByLabel('공종 분류',{exact:true}).selectOption('구조');
  await menu.getByLabel('회사 항목 코드',{exact:true}).fill('STR-001');
  await menu.getByLabel('검토 메모',{exact:true}).fill('단면 확인 필요');
  await menu.getByRole('button',{name:'선택 도형에 속성 적용',exact:true}).click({timeout:5000});
  await menu.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await expect(page.getByRole('region',{name:'선택 도형 사용자 속성',exact:true})).toContainText('STR-001');
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await expect(page.getByRole('region',{name:'선택 도형 사용자 속성',exact:true})).toContainText('코드 없음');
  await page.getByRole('button',{name:'도형 다시 실행',exact:true}).click();
  await expect(page.getByRole('region',{name:'선택 도형 사용자 속성',exact:true})).toContainText('STR-001');
  await page.reload();await page.locator(`[data-screen-shape="${id}"]`).click();
  await expect(page.getByRole('region',{name:'선택 도형 사용자 속성',exact:true})).toContainText('단면 확인 필요');
  await page.getByText('사용자 속성 상세',{exact:true}).click();
  await page.getByRole('button',{name:'사용자 속성 편집',exact:true}).click();
  await expect(menu.getByLabel('공종 분류',{exact:true})).toHaveValue('구조');
  await expect(menu.getByLabel('회사 항목 코드',{exact:true})).toHaveValue('STR-001');
  if(process.env.OBJECT_PROPERTIES_SCREENSHOT)await page.screenshot({path:process.env.OBJECT_PROPERTIES_SCREENSHOT,animations:'disabled'});
  await menu.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await page.goto(`${page.url()}&role=viewer`);await page.locator(`[data-screen-shape="${id}"]`).click();
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  await menu.getByRole('button',{name:'사용자 속성',exact:true}).click();
  await expect(menu.getByLabel('회사 항목 코드',{exact:true})).toHaveValue('STR-001');
  await expect(menu.getByLabel('회사 항목 코드',{exact:true})).toBeDisabled();
  await expect(menu.getByRole('button',{name:'선택 도형에 속성 적용',exact:true})).toBeDisabled();
 }finally{await browser.close();}
});

test('drawing schedule lists real objects and returns a searched row to the same drawing object',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  for(const [x,name] of [[100,'회의실 바닥'],[350,'복도 바닥']]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
   await page.getByLabel('이름',{exact:true}).fill(name);
  }
  const id=await page.locator('[data-screen-shape]').first().getAttribute('data-screen-shape');
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
  await menu.getByRole('button',{name:'표·스케줄',exact:true}).click();
  await expect(menu.getByRole('table')).toContainText('회의실 바닥');
  await expect(menu.getByRole('table')).toContainText('복도 바닥');
  await expect(menu.getByRole('table')).not.toContainText('R-01');
  await menu.getByLabel('도면 객체 검색',{exact:true}).fill('회의실');
  await expect(menu.getByRole('table')).not.toContainText('복도 바닥');
  if(process.env.OBJECT_SCHEDULE_SCREENSHOT)await page.screenshot({path:process.env.OBJECT_SCHEDULE_SCREENSHOT,animations:'disabled'});
  await menu.getByRole('button',{name:'회의실 바닥 · 도형 위치 확인',exact:true}).click();
  await expect(menu).not.toBeVisible();
  await expect(page.locator(`[data-screen-shape="${id}"]`)).toHaveAttribute('aria-pressed','true');
 }finally{await browser.close();}
});

test('workbench styles apply to the selected drawing objects and undo together',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  for(const x of [100,300,500]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
  }
  const shapes=page.locator('[data-screen-shape]');
  await shapes.nth(0).click();await shapes.nth(1).click({modifiers:['Shift']});
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
  await menu.getByRole('button',{name:'스타일',exact:true}).click();
  await expect(menu.getByRole('button',{name:'선택한 도형에 스타일 적용',exact:true})).toBeVisible();
  await menu.getByLabel('적용할 선 색상',{exact:true}).fill('#ff0000');
  await menu.getByLabel('적용할 선 굵기',{exact:true}).selectOption('1.00 mm');
  await menu.getByLabel('적용할 채움',{exact:true}).selectOption('연한 회색');
  await menu.getByRole('button',{name:'선택한 도형에 스타일 적용',exact:true}).click();
  await expect(menu.getByRole('status')).toContainText('화면 도형에 적용했습니다');
  if(process.env.SELECTED_STYLE_SCREENSHOT)await page.screenshot({path:process.env.SELECTED_STYLE_SCREENSHOT,animations:'disabled'});
  await menu.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  for(const index of [0,1]){
   await expect(shapes.nth(index).locator('rect').first()).toHaveAttribute('stroke','#ff0000');
   await expect(shapes.nth(index).locator('rect').first()).toHaveAttribute('stroke-width','5');
   await expect(shapes.nth(index).locator('rect').first()).toHaveAttribute('fill','#e2e8f0');
  }
  await expect(shapes.nth(2).locator('rect').first()).toHaveAttribute('stroke','#6650f5');
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  for(const index of [0,1])await expect(shapes.nth(index).locator('rect').first()).toHaveAttribute('stroke','#6650f5');
 }finally{await browser.close();}
});

test('box selection selects only enclosed shapes and Escape preserves the previous selection',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  for(const x of [100,300,500]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
  }
  await page.getByRole('button',{name:'다중 선택 시작',exact:true}).click();
  const shapes=page.locator('[data-screen-shape]');
  const a=await shapes.nth(0).boundingBox(),b=await shapes.nth(1).boundingBox();assert.ok(a&&b);
  await page.mouse.move(a.x-10,a.y-10);await page.mouse.down();
  await page.mouse.move(b.x+b.width+10,b.y+b.height+10,{steps:4});
  await expect(page.getByRole('img',{name:'도형 선택 영역',exact:true})).toBeVisible();
  if(process.env.BOX_SELECTION_SCREENSHOT)await page.screenshot({path:process.env.BOX_SELECTION_SCREENSHOT,animations:'disabled'});
  await page.mouse.up();
  await expect(shapes.nth(0)).toHaveAttribute('aria-pressed','true');
  await expect(shapes.nth(1)).toHaveAttribute('aria-pressed','true');
  await expect(shapes.nth(2)).toHaveAttribute('aria-pressed','false');
  await page.mouse.move(a.x-10,a.y-10);await page.mouse.down();
  await page.mouse.move(a.x+10,a.y+10);await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.getByRole('img',{name:'도형 선택 영역',exact:true})).toHaveCount(0);
  await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveCount(2);
  const c=await shapes.nth(2).boundingBox();assert.ok(c);
  await page.keyboard.down('Shift');
  await page.mouse.move(c.x+c.width+10,c.y+c.height+10);await page.mouse.down();
  await page.mouse.move(c.x-10,c.y-10,{steps:4});await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveCount(3);
  await page.getByRole('button',{name:'다중 선택 완료',exact:true}).click();
  await expect(page.getByRole('heading',{name:'도형 3개 선택',exact:true})).toBeVisible();
 }finally{await browser.close();}
});

test('selected objects move together without moving unselected objects and undo as one action',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  for(const x of [100,300,500]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
  }
  const shapes=page.locator('[data-screen-shape]');
  const positions=()=>shapes.evaluateAll(nodes=>nodes.map(node=>{const matrix=node.transform.baseVal.consolidate().matrix;return {x:matrix.e,y:matrix.f};}));
  await shapes.nth(0).click();await shapes.nth(1).click({modifiers:['Shift']});
  const before=await positions();
  await shapes.nth(0).focus();await page.keyboard.press('Shift+ArrowRight');
  await expect.poll(async()=>(await positions())[0].x).toBeGreaterThan(before[0].x);
  let after=await positions();
  assert.ok(Math.abs((after[0].x-before[0].x)-(after[1].x-before[1].x))<.01);
  assert.deepEqual(after[2],before[2]);
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  assert.deepEqual(await positions(),before);
  const box=await shapes.nth(0).boundingBox();assert.ok(box);
  await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();
  await page.mouse.move(box.x+60,box.y+45,{steps:4});
  await page.keyboard.press('Escape');await page.mouse.up();
  assert.deepEqual(await positions(),before);
  await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveCount(2);
  await page.mouse.move(box.x+20,box.y+20);await page.mouse.down();
  await page.mouse.move(box.x+60,box.y+45,{steps:4});
  after=await positions();
  assert.ok(after[0].x>before[0].x);
  assert.ok(Math.abs((after[0].x-before[0].x)-(after[1].x-before[1].x))<.01);
  await page.mouse.up();
  await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveCount(2);
  if(process.env.GROUP_MOVE_SCREENSHOT)await page.screenshot({path:process.env.GROUP_MOVE_SCREENSHOT,animations:'disabled'});
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  assert.deepEqual(await positions(),before);
 }finally{await browser.close();}
});

test('touch multi selection keeps the canvas open until selection is complete',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({hasTouch:true});
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  for(const x of [100,350]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'다중 선택 시작',exact:true}).tap();
  await expect(page.getByRole('button',{name:'선택 도구 모양',exact:true})).toHaveAttribute('aria-pressed','false');
  for(const shape of await page.locator('[data-screen-shape]').all()){
   await shape.scrollIntoViewIfNeeded();
   const box=await shape.boundingBox();assert.ok(box);
   await page.touchscreen.tap(box.x+box.width*.8,box.y+box.height*.8);
  }
  await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveCount(2);
  await expect(page.getByRole('heading',{name:'도형 2개 선택',exact:true})).not.toBeVisible();
  if(process.env.TOUCH_SELECTION_SCREENSHOT)await page.screenshot({path:process.env.TOUCH_SELECTION_SCREENSHOT});
  await page.getByRole('button',{name:'다중 선택 완료',exact:true}).tap();
  await expect(page.getByRole('heading',{name:'도형 2개 선택',exact:true})).toBeVisible();
  await expect(page.getByLabel('공통 선 굵기',{exact:true})).toBeVisible();
 }finally{await browser.close();}
});

test('multiple selection common styles apply only to selected objects and undo together',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  for(const x of [100,300,500]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
  }
  const shapes=page.locator('[data-screen-shape]');
  await shapes.nth(0).click();await page.getByLabel(/^선 굵기/).selectOption('1.00 mm');
  await shapes.nth(1).click({modifiers:['Shift']});
  const width=page.getByLabel('공통 선 굵기',{exact:true});
  for(const label of ['공통 회전 각도','공통 레이어','공통 선 색상','공통 선 굵기','공통 채움'])await expect(page.getByLabel(label,{exact:true})).toBeInViewport({ratio:1,timeout:3000});
  await expect(width).toHaveValue('');
  await width.selectOption('0.50 mm');await expect(width).toHaveValue('0.50 mm');
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await expect(width).toHaveValue('');
  await page.getByRole('button',{name:'도형 다시 실행',exact:true}).click();
  await shapes.nth(0).click();await expect(page.getByLabel(/^선 굵기/)).toHaveValue('0.50 mm');
  await shapes.nth(1).click();await expect(page.getByLabel(/^선 굵기/)).toHaveValue('0.50 mm');
  await shapes.nth(2).click();await expect(page.getByLabel(/^선 굵기/)).toHaveValue('0.25 mm');
 }finally{await browser.close();}
});

test('multiple selection sets individual angles and restores mixed angles with one undo',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  for(const x of [100,300,500]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
  }
  const shapes=page.locator('[data-screen-shape]');
  await shapes.nth(0).click();
  await page.getByRole('button',{name:'선택 도형 90도 회전',exact:true}).click();
  await shapes.nth(1).click({modifiers:['Shift']});
  const angle=page.getByLabel('공통 회전 각도',{exact:true});
  await expect(angle).toHaveValue('');
  await angle.selectOption('180');
  await expect(angle).toHaveValue('180');
  if(process.env.MULTI_ROTATION_SCREENSHOT)await page.screenshot({path:process.env.MULTI_ROTATION_SCREENSHOT,animations:'disabled'});
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await expect(angle).toHaveValue('');
  await shapes.nth(0).click();await expect(page.getByLabel('화면 회전 각도',{exact:true})).toHaveValue('90');
  await shapes.nth(1).click();await expect(page.getByLabel('화면 회전 각도',{exact:true})).toHaveValue('0');
  await page.getByRole('button',{name:'도형 다시 실행',exact:true}).click();
  await shapes.nth(0).click();await expect(page.getByLabel('화면 회전 각도',{exact:true})).toHaveValue('180');
  await shapes.nth(1).click();await expect(page.getByLabel('화면 회전 각도',{exact:true})).toHaveValue('180');
  await shapes.nth(2).click();await expect(page.getByLabel('화면 회전 각도',{exact:true})).toHaveValue('0');
 }finally{await browser.close();}
});

test('multiple canvas objects copy and delete as one undoable selection',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000123`);
  for(const x of [100,350]){
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x,y:100}});
  }
  const ids=await page.locator('[data-screen-shape]').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-screen-shape')));
  await page.locator(`[data-screen-shape="${ids[0]}"]`).click();
  await page.locator(`[data-screen-shape="${ids[1]}"]`).click({modifiers:['Shift']});
  await expect(page.getByRole('heading',{name:'도형 2개 선택',exact:true})).toBeVisible();
  await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveCount(2);
  await page.locator(`[data-screen-shape="${ids[1]}"]`).focus();await page.keyboard.press('Shift+Enter');
  await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveCount(1);
  await page.keyboard.press('Shift+Enter');await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveCount(2);
  await page.getByRole('button',{name:'선택한 도형 함께 복사',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(4);
  await page.getByRole('button',{name:'선택한 도형 함께 삭제',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(2);
  await page.getByRole('button',{name:'도형 실행 취소',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(4);
  await expect(page.locator('[data-screen-shape][aria-pressed=true]')).toHaveCount(2);
  await page.goto(`${page.url()}&role=viewer`);
  await expect(page.getByRole('button',{name:'작성 모드',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'선택한 도형 함께 삭제',exact:true})).toHaveCount(0);
 }finally{await browser.close();}
});

test('inspector typing is one undo action and later fields have separate history',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:150,y:100}});
  const name=page.getByLabel('이름',{exact:true}),x=page.getByLabel('화면 X 위치',{exact:true});
  const original=await name.inputValue(),originalX=await x.inputValue();
  await name.fill('');await name.pressSequentially('회의실 이름');
  const undo=page.getByRole('button',{name:'도형 실행 취소',exact:true}),redo=page.getByRole('button',{name:'도형 다시 실행',exact:true});
  await undo.click();await expect(name).toHaveValue(original);
  await redo.click();await expect(name).toHaveValue('회의실 이름');
  await x.fill('');await x.pressSequentially('350');
  await undo.click();await expect(x).toHaveValue(originalX);await expect(name).toHaveValue('회의실 이름');
 }finally{await browser.close();}
});

test('canvas history shortcuts retain focus and leave text undo to the input',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:150,y:100}});
  await page.locator('[data-screen-shape]').focus();await page.keyboard.press('Control+z');
  await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  await page.keyboard.press('Meta+z');await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  await page.keyboard.press('Control+y');await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  const box=await page.locator('[data-screen-shape]').boundingBox();assert.ok(box);
  await page.mouse.move(box.x+30,box.y+30);await page.mouse.down();await page.mouse.move(box.x+55,box.y+45);
  await page.keyboard.press('Control+z');await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  await page.mouse.up();
  const input=page.getByLabel('이름',{exact:true});await input.fill('입력 유지 확인');
  const prevented=await input.evaluate(element=>{const event=new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true});element.dispatchEvent(event);return event.defaultPrevented;});
  assert.equal(prevented,false);
  await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
 }finally{await browser.close();}
});

test('canvas undo redo restores creation and copies then branches on a new edit',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview/drawing-workspace?layout=pdf&startKind=office`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:150,y:100}});
  const id=await page.locator('[data-screen-shape]').getAttribute('data-screen-shape');
  const undo=page.getByRole('button',{name:'도형 실행 취소',exact:true});
  const redo=page.getByRole('button',{name:'도형 다시 실행',exact:true});
  await undo.click({timeout:5000});await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  await redo.click();await expect(page.locator('[data-screen-shape]')).toHaveAttribute('data-screen-shape',id);
  await page.getByRole('button',{name:'선택 도형 복사',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(2);
  await undo.click();await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  await redo.click();await expect(page.locator('[data-screen-shape]')).toHaveCount(2);
  await page.getByLabel('화면 X 위치',{exact:true}).fill('350');
  await undo.click();await expect(page.getByLabel('화면 X 위치',{exact:true})).not.toHaveValue('350');
  await page.getByLabel('화면 X 위치',{exact:true}).fill('400');await expect(redo).toBeDisabled();
  await page.getByRole('button',{name:'선택 도형 삭제',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  await undo.click();await expect(page.locator('[data-screen-shape]')).toHaveCount(2);
  await expect(page.getByLabel('화면 X 위치',{exact:true})).toHaveValue('400');
  await redo.click();await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await expect(undo).toHaveCount(0);
 }finally{await browser.close();}
});

test('selected screen object can move copy and recover deletion without changing the original',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000116`);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:150,y:100}});
  await page.getByLabel('이름',{exact:true}).fill('원본 표시');
  const original=await page.locator('[data-screen-shape]').getAttribute('data-screen-shape');
  await page.getByRole('button',{name:'선택 도형 복사',exact:true}).click({timeout:5000});
  await expect(page.locator('[data-screen-shape]')).toHaveCount(2);
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('원본 표시 복사본');
  const copy=await page.locator('[data-screen-shape][aria-pressed=true]').getAttribute('data-screen-shape');
  assert.notEqual(copy,original);
  const beforeX=Number(await page.getByLabel('화면 X 위치',{exact:true}).inputValue());
  const box=await page.locator(`[data-screen-shape="${copy}"]`).boundingBox();assert.ok(box);
  await page.mouse.move(box.x+40,box.y+40);await page.mouse.down();
  await page.mouse.move(box.x+100,box.y+70,{steps:5});await page.mouse.up();
  assert.ok(Number(await page.getByLabel('화면 X 위치',{exact:true}).inputValue())>beforeX,'드래그가 선택 도형의 위치를 바꿔야 합니다.');
  const committed=await page.getByLabel('화면 X 위치',{exact:true}).inputValue();
  const movedBox=await page.locator(`[data-screen-shape="${copy}"]`).boundingBox();assert.ok(movedBox);
  await page.mouse.move(movedBox.x+40,movedBox.y+40);await page.mouse.down();await page.mouse.move(movedBox.x+100,movedBox.y+80,{steps:3});
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.getByLabel('화면 X 위치',{exact:true})).toHaveValue(committed);
  await page.getByLabel('화면 X 위치',{exact:true}).fill('350');
  await page.getByLabel('화면 Y 위치',{exact:true}).fill('200');
  await page.locator(`[data-screen-shape="${copy}"]`).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('화면 X 위치',{exact:true})).toHaveValue('349');
  await page.keyboard.press('Shift+ArrowDown');
  await expect(page.getByLabel('화면 Y 위치',{exact:true})).toHaveValue('210');
  await page.getByRole('button',{name:'선택 도형 삭제',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  await expect(page.locator('[data-screen-shape]')).toHaveAttribute('data-screen-shape',original);
  await page.getByRole('button',{name:'도형 삭제 취소',exact:true}).click();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(2);
  await expect(page.getByLabel('화면 X 위치',{exact:true})).toHaveValue('349');
  await expect(page.getByLabel('화면 Y 위치',{exact:true})).toHaveValue('210');
  await page.reload();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(2);
  await page.goto(`${page.url()}&role=viewer`);
  await page.getByRole('button',{name:'원본 표시 · 화면 도형',exact:true}).click();
  await page.getByRole('button',{name:'속성',exact:true}).click();
  await expect(page.getByRole('button',{name:'선택 도형 복사',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'선택 도형 삭제',exact:true})).toBeDisabled();
  await expect(page.getByLabel('화면 X 위치',{exact:true})).toBeDisabled();
  const viewerX=await page.getByLabel('화면 X 위치',{exact:true}).inputValue();
  await page.locator(`[data-screen-shape="${original}"]`).focus();await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('화면 X 위치',{exact:true})).toHaveValue(viewerX);
 }finally{await browser.close();}
});

test('failed drawing save keeps project return on the canvas until retry succeeds',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const id='00000000-0000-4000-8000-000000000118';
  const key=`1hk:preview:screen-draft:${id}`;
  const url=`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=${id}`;
  await page.goto(url);
  await page.evaluate(key=>{const original=Storage.prototype.setItem;window.restoreDrawingWrite=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(name,value){if(name===key)throw Error('test quota');return original.call(this,name,value);};},key);
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:150,y:100}});
  await expect(page.getByRole('alert').filter({hasText:'화면 도형을 보관하지 못했습니다'})).toBeVisible();
  await expect(page.getByLabel('현재 페이지 편집 상태',{exact:true})).toContainText('보관 실패');
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'보관하지 못한 작업이 있어 이동을 멈췄습니다'})).toBeVisible();
  assert.equal(page.url(),url);
  await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  const replacement=await PDFDocument.create();replacement.addPage([600,400]);
  const nextFile={name:'replacement.pdf',mimeType:'application/pdf',buffer:Buffer.from(await replacement.save())};
  page.on('dialog',dialog=>dialog.accept());
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles(nextFile);
  await expect(page.getByText('보관하지 못한 작업이 있어 원본 교체를 멈췄습니다. 보관을 다시 시도한 후 파일을 선택해 주세요.',{exact:true})).toBeVisible();
  await expect(page.locator('[data-screen-shape]')).toHaveCount(1);
  assert.equal(await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),true);
  await page.evaluate(()=>window.restoreDrawingWrite());
  await page.getByRole('button',{name:'도형 보관 다시 시도',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  assert.equal(await page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true}))),false);
  assert.equal(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)).objects.length,1);
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles(nextFile);
  await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  assert.equal(JSON.parse(await page.evaluate(key=>sessionStorage.getItem(key),key)).objects.length,1);
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await expect(page).not.toHaveURL(url);
 }finally{await browser.close();}
});

test('PDF correction navigation crosses pages and reveals a locked layer without unlocking it',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const pdf=await PDFDocument.create();pdf.addPage([600,400]);pdf.addPage([600,400]);
 const file={name:'correction-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview?project=00000000-0000-4000-8000-000000000101&start=file`);
  await page.getByLabel('작업실에서 열 PDF 선택').setInputFiles(file);
  await page.getByRole('button',{name:'선택한 PDF 등록 방식 확인',exact:true}).click();
  await page.getByRole('button',{name:'등록 방식 확인 후 준비',exact:true}).click();
  for(const number of [1,2]){
   if(number===2)await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:150,y:100}});
   await page.getByLabel('이름',{exact:true}).fill(`${number}쪽 수정 대상`);
  }
  const id=new URL(page.url()).searchParams.get('screenDocument');
  const draftKey=`1hk:preview:screen-draft:${id}`,requestKey=`1hk:preview:change-requests:${id}`;
  await page.getByRole('button',{name:'검토 요청 구성 열기',exact:true}).click();
  await page.getByRole('radio',{name:'변경 직접 선택',exact:true}).check();
  for(const number of [1,2])await page.getByRole('checkbox',{name:`${number}쪽 수정 대상 · ${number}쪽`,exact:true}).check();
  await page.getByLabel('요청 메시지',{exact:true}).fill('두 페이지 수정 검토');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const request=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await request.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  for(const number of [1,2]){
   const item=request.getByRole('article',{name:`${number}쪽 수정 대상`,exact:true});
   await item.getByLabel('검토 의견',{exact:true}).fill(`${number}쪽 이름 보완`);
   await item.getByRole('button',{name:'수정 요청 · 예시',exact:true}).click();
  }
  const original=await page.evaluate(key=>sessionStorage.getItem(key),requestKey);
  // Model a saved drawing whose second-page layer was hidden and locked by its author.
  await page.evaluate(key=>{
   const draft=JSON.parse(sessionStorage.getItem(key));
   draft.layers.push({id:'locked-correction',name:'잠긴 수정 레이어',visible:false,locked:true});
   draft.objects.find(object=>object.page===2).layer='locked-correction';
   sessionStorage.setItem(key,JSON.stringify(draft));
  },draftKey);
  await page.reload();
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles(file);
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await page.setViewportSize({width:390,height:667});
  await request.getByRole('button',{name:'수정 요청 도형 편집',exact:true}).click();
  const correction=page.getByRole('region',{name:'선택 도형의 수정 요청',exact:true});
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('1쪽 수정 대상');
  await page.getByLabel('이름',{exact:true}).fill('1쪽 보완 완료');
  await correction.getByRole('button',{name:'다음 수정 대상',exact:true}).click();
  await expect(page.getByRole('button',{name:'2쪽 수정 대상 · 화면 도형',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('이름',{exact:true})).toBeDisabled();
  await expect(correction).toContainText('레이어가 잠겨 있어 편집할 수 없습니다');
  await expect(page.getByRole('contentinfo')).toBeInViewport({ratio:1});
  const dock=await page.getByRole('complementary',{name:'도면 정보 패널',exact:true}).boundingBox();
  const footer=await page.getByRole('contentinfo').boundingBox();
  assert.ok(dock.y+dock.height<=footer.y+1,'correction dock must not overlap the page and zoom footer');
  if(process.env.LOCKED_CORRECTION_SCREENSHOT)await page.screenshot({path:process.env.LOCKED_CORRECTION_SCREENSHOT,animations:'disabled'});
  const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),draftKey);
  assert.deepEqual(saved.layers.find(layer=>layer.id==='locked-correction'),{id:'locked-correction',name:'잠긴 수정 레이어',visible:true,locked:true});
  await correction.getByRole('button',{name:'레이어 관리 열기',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
  await expect(menu.getByRole('button',{name:'잠긴 수정 레이어 잠금 해제 예시',exact:true})).toHaveAttribute('aria-pressed','true');
  await menu.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('2쪽 수정 대상');
  await expect(page.getByLabel('이름',{exact:true})).toBeDisabled();
  await correction.getByRole('button',{name:'이전 수정 대상',exact:true}).click();
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('1쪽 보완 완료');
  await expect(page.getByLabel('이름',{exact:true})).toBeEnabled();
  await correction.getByRole('button',{name:'다음 수정 대상',exact:true}).click();
  await correction.getByRole('button',{name:'레이어 관리 열기',exact:true}).click();
  await menu.getByRole('button',{name:'잠긴 수정 레이어 잠금 해제 예시',exact:true}).click();
  await menu.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await expect(correction.getByRole('status')).toHaveCount(0);
  await page.getByLabel('이름',{exact:true}).fill('2쪽 보완 완료');
  await page.getByLabel('이름',{exact:true}).blur();
  const unlocked=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)),draftKey);
  assert.equal(unlocked.layers.find(layer=>layer.id==='locked-correction').locked,false);
  assert.equal(unlocked.objects.find(object=>object.page===2).name,'2쪽 보완 완료');
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),requestKey),original);
 }finally{await browser.close();}
});

test('registered PDF restores object IDs on both pages after matching-source recovery',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const pdf=await PDFDocument.create();pdf.addPage([600,400]);pdf.addPage([600,400]);
 const file={name:'drawing-draft.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())};
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${origin.origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101&start=file`);
  await page.getByLabel('작업실에서 열 PDF 선택').setInputFiles(file);
  await page.getByRole('button',{name:'선택한 PDF 등록 방식 확인',exact:true}).click();
  await page.getByRole('button',{name:'등록 방식 확인 후 준비',exact:true}).click();
  const ids=[];
  for(const number of [1,2]){
   if(number===2)await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
   await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
   await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:150,y:100}});
   await page.getByLabel('이름',{exact:true}).fill(`${number}쪽 복원 영역`);
   ids.push(await page.getByRole('button',{name:`${number}쪽 복원 영역 · 화면 도형`,exact:true}).getAttribute('data-screen-shape'));
  }
  const documentId=new URL(page.url()).searchParams.get('screenDocument');assert.ok(documentId);
  await page.getByRole('button',{name:'작성 도구·명령 열기',exact:true}).click();
  await page.getByRole('button',{name:'폴리라인 · 도면에 배치',exact:true}).click();
  const polylineCanvas=page.getByRole('region',{name:'화면 도형 오버레이',exact:true});
  await polylineCanvas.click({position:{x:180,y:160}});await polylineCanvas.click({position:{x:260,y:220}});
  await expect(page.getByRole('button',{name:'폴리라인 완료',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'이전 페이지',exact:true}).click();
  await expect(page.getByRole('button',{name:'폴리라인 완료',exact:true})).toBeDisabled({timeout:3000});
  await polylineCanvas.focus();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
  await page.getByRole('button',{name:'2쪽 복원 영역 · 화면 도형',exact:true}).click();
  const key=`1hk:preview:screen-draft:${documentId}`;
  const stored=await page.evaluate(key=>sessionStorage.getItem(key),key);assert.ok(stored);
  const settings=page.locator('.pdf-view-settings');
  await settings.locator('summary').click();
  await settings.getByRole('button',{name:'분할 보기',exact:true}).click();
  await expect(page.getByRole('region',{name:'IFC 모델 화면',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'2쪽 복원 영역 · 화면 도형',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('2쪽 복원 영역');
  await settings.getByRole('button',{name:'3D 모델',exact:true}).click();
  await expect(page.getByRole('button',{name:'2쪽 복원 영역 · 화면 도형',exact:true})).not.toBeVisible();
  await page.getByRole('button',{name:'IFC 연결 정보 보기',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'작업실 메뉴',exact:true});
  await expect(menu).toContainText('drawing-draft.pdf · 2쪽');
  await menu.getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await page.getByRole('button',{name:'2D 도면으로 돌아가기',exact:true}).click();
  await expect(page.getByRole('button',{name:'2쪽 복원 영역 · 화면 도형',exact:true})).toHaveAttribute('data-screen-shape',ids[1]);
  await expect(page.getByRole('button',{name:'2쪽 복원 영역 · 화면 도형',exact:true})).toHaveAttribute('aria-pressed','true');
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),stored);
  await page.getByRole('button',{name:'선택 도형으로 검토 요청',exact:true}).click();
  const panel=page.getByRole('region',{name:'변경과 대화',exact:true});
  await panel.getByLabel('요청 메시지',{exact:true}).fill('2쪽 영역 수정 검토');
  await panel.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await panel.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  const request=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await request.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  await request.getByLabel('검토 의견',{exact:true}).fill('2쪽 치수 확인');
  await request.getByRole('button',{name:'수정 요청 · 예시',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'이전 페이지',exact:true}).click();
  await expect(page.getByRole('button',{name:'1쪽 복원 영역 · 화면 도형',exact:true})).toBeVisible();
  await request.getByRole('button',{name:'수정 요청 도형 편집',exact:true}).click();
  await expect(page.getByLabel('이름',{exact:true})).toHaveValue('2쪽 복원 영역');
  await expect(page.getByRole('button',{name:'2쪽 복원 영역 · 화면 도형',exact:true})).toHaveAttribute('data-screen-shape',ids[1]);
  await expect(page.getByRole('button',{name:'2쪽 복원 영역 · 화면 도형',exact:true})).toHaveAttribute('aria-pressed','true');
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),stored);
  await page.setViewportSize({width:1280,height:720});
  await page.reload();
  await expect(page.getByLabel('로컬 PDF 선택',{exact:true})).toBeEnabled();
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles({...file,name:'same-source-renamed.pdf'});
  await expect(page.getByText('동일한 PDF 원본을 확인했습니다. 현재 페이지와 검토 기록을 유지합니다.',{exact:true})).toBeVisible();
  for(const number of [1,2]){
   if(number===2)await page.getByRole('button',{name:'다음 페이지',exact:true}).click();
   await expect(page.getByRole('button',{name:`${number}쪽 복원 영역 · 화면 도형`,exact:true})).toHaveAttribute('data-screen-shape',ids[number-1]);
  }
  const other=await PDFDocument.create();other.addPage();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByLabel('로컬 PDF 선택',{exact:true}).setInputFiles({...file,buffer:Buffer.from(await other.save())});
  await expect(page.locator('[data-screen-shape]')).toHaveCount(0);
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),stored);
 }finally{await browser.close();}
});

test('corrupt drawing storage blocks layer editing in the workbench and can be reread',{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.OBJECT_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const key='1hk:preview:screen-draft:00000000-0000-4000-8000-000000000111';
  await page.goto(`${origin.origin}/workspace-preview`);
  await page.evaluate(key=>sessionStorage.setItem(key,'null'),key);
  await page.goto(`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000111`);
  await expect(page.getByRole('alert').filter({hasText:'화면 도형을 복원하지 못했습니다'})).toBeVisible();
  await expect(page.getByLabel('현재 페이지 편집 상태',{exact:true})).toContainText('복구 필요');
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  await page.getByRole('button',{name:'페이지·레이어',exact:true}).click();
  await expect(page.getByRole('button',{name:'레이어 추가 · 화면 예시',exact:true})).toBeDisabled({timeout:5000});
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),'null');
  await page.getByRole('dialog',{name:'작업실 메뉴',exact:true}).getByRole('button',{name:'도면으로 돌아가기',exact:true}).click();
  await page.evaluate(key=>sessionStorage.setItem(key,JSON.stringify({schemaVersion:1,source:'office:A3',objects:[],layers:[{id:'review',name:'복구 레이어',visible:true,locked:false}]})),key);
  await page.getByRole('button',{name:'도형 기록 다시 읽기',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'화면 도형을 복원하지 못했습니다'})).toHaveCount(0);
  await page.getByRole('button',{name:'작업실 메뉴 열기',exact:true}).click();
  await page.getByRole('button',{name:'페이지·레이어',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'레이어 1 이름',exact:true})).toHaveValue('복구 레이어');
  await page.getByRole('button',{name:'레이어 추가 · 화면 예시',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'레이어 2 이름',exact:true})).toBeVisible();
 }finally{await browser.close();}
});
