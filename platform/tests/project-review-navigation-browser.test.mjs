import assert from "node:assert/strict";
import test from "node:test";
import {chromium, expect} from "@playwright/test";

test('request item filter isolates pending and correction work without rewriting records',{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const origin=process.env.SHARING_PREVIEW_ORIGIN;
  await page.goto(`${origin}/workspace-preview`);
  const key='1hk:preview:change-requests:00000000-0000-4000-8000-000000000111';
  const item={kind:'added',page:1,x:100,y:100,width:140,height:90,author:'나',summary:'표시',before:'없음',after:'추가',sample:false};
  const raw=JSON.stringify({schemaVersion:1,requests:[{round:1,message:'항목 상태별 검토',items:[{...item,id:'a',title:'미확인 벽'},{...item,id:'b',title:'수정할 창'},{...item,id:'c',title:'확인한 문'}],decisions:{b:{kind:'changes',note:'폭 수정'},c:{kind:'checked',note:'확인'}}},{round:2,message:'다음 요청',items:[{...item,id:'d',title:'다음 벽'}],decisions:{}}]});
  await page.evaluate(({key,raw})=>sessionStorage.setItem(key,raw),{key,raw});
  await page.goto(`${origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-reviews&role=viewer`);
  await page.getByRole('link',{name:'요청 1 검토하기',exact:true}).click();
  const batch=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  const filter=batch.getByLabel('요청 항목 상태',{exact:true});
  const search=batch.getByRole('searchbox',{name:'요청 항목 검색',exact:true});
  await search.fill('폭 수정');
  await expect(batch.getByRole('article')).toHaveAccessibleName('수정할 창');
  await filter.selectOption('pending');
  await expect(batch.getByRole('article')).toHaveCount(0);
  await batch.getByRole('button',{name:'전체 항목 보기',exact:true}).click();
  await expect(search).toHaveValue('');
  await expect(filter).toHaveValue('all');
  await expect(batch.getByRole('article')).toHaveCount(3);
  await search.fill('  미확인 벽  ');
  await expect(batch.getByRole('article')).toHaveAccessibleName('미확인 벽');
  await search.fill('1쪽');
  await expect(batch.getByRole('article')).toHaveCount(3);
  await search.fill('');
  for(const [value,title] of [['pending','미확인 벽'],['changes','수정할 창'],['checked','확인한 문']]){
   await filter.selectOption(value,{timeout:3000});
   await expect(batch.getByRole('article')).toHaveCount(1);
   await expect(batch.getByRole('article')).toHaveAccessibleName(title);
   if(value==='changes'&&process.env.REQUEST_FILTER_SCREENSHOT){await filter.scrollIntoViewIfNeeded();await page.screenshot({path:process.env.REQUEST_FILTER_SCREENSHOT,animations:'disabled'});}
  }
  await search.fill('확인한 문');
  await batch.getByLabel('요청 이력',{exact:true}).selectOption('2');
  await expect(search).toHaveValue('');
  await expect(filter).toHaveValue('all');
  await expect(batch.getByRole('article')).toHaveAccessibleName('다음 벽');
  await filter.selectOption('changes');
  await expect(batch.getByRole('article')).toHaveCount(0);
  await expect(batch.getByText('이 상태의 항목이 없습니다.',{exact:true})).toBeVisible();
  await batch.getByRole('button',{name:'전체 항목 보기',exact:true}).click();
  await expect(batch.getByRole('article')).toHaveCount(1);
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),raw);
 }finally{await browser.close();}
});

test('approved request can compose all current screen objects without changing prior approval',{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const origin=process.env.SHARING_PREVIEW_ORIGIN;
  await page.goto(`${origin}/workspace-preview`);
  const key='1hk:preview:change-requests:00000000-0000-4000-8000-000000000111';
  const previous={round:1,message:'일부 검토',items:[{id:'a',title:'이전 대상',kind:'added',page:1,x:100,y:100,width:140,height:90,author:'나',summary:'표시',before:'없음',after:'추가',sample:false}],decisions:{a:{kind:'checked',note:''}},approval:{note:'이전 승인',at:'2026-09-09T00:00:00.000Z'}};
  await page.evaluate(({key,previous})=>sessionStorage.setItem(key,JSON.stringify({schemaVersion:1,requests:[previous]})),{key,previous});
  await page.goto(`${origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-reviews`);
  await page.getByRole('link',{name:'요청 1 검토하기',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  if(process.env.REQUEST_SCOPE_SCREENSHOT){await page.getByRole('button',{name:'전체 화면 도형으로 새 요청 구성',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:process.env.REQUEST_SCOPE_SCREENSHOT,animations:'disabled'});}
  await page.getByRole('button',{name:'전체 화면 도형으로 새 요청 구성',exact:true}).click({timeout:3000});
  const choices=page.getByRole('group',{name:'검토할 변경 선택',exact:true}).getByRole('checkbox');
  const count=await choices.count();assert.ok(count>1);
  for(const choice of await choices.all())await expect(choice).toBeChecked();
  await expect(page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true})).not.toBeVisible();
  await page.getByLabel('요청 메시지',{exact:true}).fill('전체 화면 범위 확인');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  await expect.poll(()=>page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).requests.length,key)).toBe(2);
  const saved=await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).requests,key);
  assert.deepEqual(saved[0],previous);assert.equal(saved[1].items.length,count);
  assert.deepEqual(saved[1].decisions,{});assert.equal(saved[1].approval,undefined);
 }finally{await browser.close();}
});

test('request filter is disabled until hydration can preserve its selection',{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:30000},async()=>{
 const browser=await chromium.launch({headless:true});
 let release=()=>{};
 try{
  const page=await browser.newPage();const gate=new Promise(resolve=>release=resolve);
  await page.route('**/*.js',async route=>{await gate;await route.continue();});
  await page.goto(`${process.env.SHARING_PREVIEW_ORIGIN}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-reviews`,{waitUntil:'commit'});
  const filter=page.getByLabel('요청 묶음 상태',{exact:true});
  await expect(filter).toBeDisabled();release();
  await expect(filter).toBeEnabled();
  await filter.selectOption({label:'승인 확인'});
  await expect(page).toHaveURL(/requestStatus=/);
  await expect(filter).toHaveValue('승인 확인');
 }finally{release();await browser.close();}
});

test('project separates approved request snapshots from item confirmation and reopens the same approval',{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.SHARING_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${origin.origin}/workspace-preview`);
  await page.evaluate(()=>{
   const item={id:'a',title:'승인 대상',kind:'added',page:1,x:100,y:100,width:140,height:90,author:'나',summary:'표시',before:'없음',after:'추가',sample:false};
   const confirmed={round:1,message:'검토 확인만 한 요청',items:[item],decisions:{a:{kind:'checked',note:''}}};
   sessionStorage.setItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000111',JSON.stringify({schemaVersion:1,requests:[confirmed,{...confirmed,round:2,message:'승인자가 확인한 요청',approval:{note:'고정 범위 승인 확인',at:'2026-09-09T00:00:00.000Z'}}]}));
  });
  await page.goto(`${origin.origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-reviews&role=viewer`);
  const list=page.getByRole('region',{name:'프로젝트 변경 요청 묶음',exact:true});
  const filter=list.getByLabel('요청 묶음 상태',{exact:true});
  await filter.selectOption({label:'승인 확인'},{timeout:5000});
  await expect(list.getByRole('article')).toHaveCount(1);
  await expect(list.getByRole('article')).toContainText('승인자가 확인한 요청');
  await list.getByRole('link',{name:'요청 2 검토하기',exact:true}).click();
  const batch=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await expect(batch).toContainText('고정 범위 승인 확인');
  await batch.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  await expect(batch.getByRole('button',{name:'확인 · 예시',exact:true})).toBeDisabled();
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await expect(filter).toHaveValue('승인 확인');
  await filter.selectOption({label:'확인 완료'});
  await expect(list.getByRole('article')).toHaveCount(1);
  await expect(list.getByRole('article')).toContainText('검토 확인만 한 요청');
 }finally{await browser.close();}
});

test('empty request list leads to a chosen project drawing and preserves Viewer access',{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.SHARING_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const url=`${origin.origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-reviews`;
  for(const viewer of [false,true]){
   await page.goto(`${url}${viewer?'&role=viewer':''}`);
   const list=page.getByRole('region',{name:'프로젝트 변경 요청 묶음',exact:true});
   await list.getByText('검토할 도면 선택',{exact:true}).click({timeout:5000});
   await list.getByRole('link',{name:'1층 평면도 열기',exact:true}).click();
   await expect(page).toHaveURL(/screenDocument=00000000-0000-4000-8000-000000000111/);
   if(viewer)await expect(page.getByRole('button',{name:'작성 모드',exact:true})).toBeDisabled();
   else await expect(page.getByRole('button',{name:'작성 모드',exact:true})).toBeEnabled();
   await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
   await expect(page).toHaveURL(/panel=project-reviews/);
   if(viewer)await expect(page).toHaveURL(/role=viewer/);
  }
 }finally{await browser.close();}
});

test('project request filters separate pending, correction and checked bundles without losing history',{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.SHARING_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.goto(`${origin.origin}/workspace-preview`);
  await page.evaluate(()=>{
   const item={id:'a',title:'검토 영역',kind:'added',page:1,x:100,y:100,width:140,height:90,author:'나',summary:'표시',before:'없음',after:'추가',sample:false};
   sessionStorage.setItem('1hk:preview:change-requests:00000000-0000-4000-8000-000000000111',JSON.stringify({schemaVersion:1,requests:[
    {round:1,message:'대기 묶음',items:[item],decisions:{}},
    {round:2,message:'수정 묶음',items:[item],decisions:{a:{kind:'changes',note:'폭 수정'}}},
    {round:3,message:'확인 묶음',items:[item],decisions:{a:{kind:'checked',note:''}}}
   ]}));
  });
  await page.goto(`${origin.origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-reviews`);
  const list=page.getByRole('region',{name:'프로젝트 변경 요청 묶음',exact:true});
  await expect(list.getByRole('article')).toHaveCount(3);
  const requestHeading=await list.getByRole('heading',{name:'변경 요청 묶음',exact:true}).boundingBox();
  const revisionHeading=await page.getByRole('heading',{name:'개정 검토 기록',exact:true}).boundingBox();
  assert.ok(requestHeading&&revisionHeading&&requestHeading.y<revisionHeading.y,'항목별 변경 요청을 개정 기록보다 먼저 보여야 합니다.');
  const filter=list.getByLabel('요청 묶음 상태',{exact:true});
  for(const [status,message] of [['확인 대기','대기 묶음'],['수정 요청','수정 묶음'],['확인 완료','확인 묶음']]){
   await filter.selectOption({label:status});
   await expect(list.getByRole('article')).toHaveCount(1);
   await expect(list.getByRole('article')).toContainText(message);
  }
  await list.getByRole('link',{name:'요청 3 검토하기',exact:true}).click();
  await expect(page.getByRole('region',{name:'요청 묶음 검토',exact:true})).toContainText('확인 묶음');
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await expect(filter).toHaveValue('확인 완료');
  await expect(list.getByRole('article')).toHaveCount(1);
  await page.reload();
  await expect(filter).toHaveValue('확인 완료');
  await filter.selectOption({label:'전체 요청'});
  await expect(list.getByRole('article')).toHaveCount(3);
  await expect(list.getByRole('article').first()).toContainText('확인 묶음');
  await expect(page.getByText('아직 검토 요청이 없습니다.',{exact:true})).toHaveCount(0);
 }finally{await browser.close();}
});

test('an explicit request round stays visible over a restored approved revision',{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.SHARING_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const documentId='00000000-0000-4000-8000-000000000111';
  await page.goto(`${origin.origin}/workspace-preview`);
  await page.evaluate(documentId=>{
   sessionStorage.setItem(`1hk:preview:review:${documentId}`,JSON.stringify({phase:'approved',role:'author',revision:3,page:1,position:0,before:0,issue:'',message:'승인된 개정 보존',focused:false,compared:false,history:[]}));
   const item={id:'snapshot-item',title:'별도 요청 항목',kind:'added',page:1,x:100,y:100,width:140,height:90,author:'나',summary:'요청 당시 항목',before:'없음',after:'추가',sample:false};
   sessionStorage.setItem(`1hk:preview:change-requests:${documentId}`,JSON.stringify({schemaVersion:1,requests:[{round:1,message:'명시적으로 선택한 요청',items:[item],decisions:{}}]}));
  },documentId);
  const url=`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=${documentId}&requestRound=1`;
  const key=`1hk:preview:review:${documentId}`;
  const before=await page.evaluate(key=>sessionStorage.getItem(key),key);
  await page.goto(url);
  await expect(page.getByRole('region',{name:'요청 묶음 검토',exact:true})).toBeVisible({timeout:5000});
  await expect(page.getByRole('button',{name:'검토 모드',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(page.getByRole('region',{name:'요청 묶음 검토',exact:true})).toContainText('명시적으로 선택한 요청');
  assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),key),before);
  await page.goto(url.replace('requestRound=1','requestRound=999'));
  await expect(page.getByRole('status').filter({hasText:'이 문서에서 요청 기록을 찾을 수 없습니다'})).toBeVisible();
  await expect(page.getByText('명시적으로 선택한 요청',{exact:true})).toHaveCount(0);
 }finally{await browser.close();}
});

test('project review opens the same change request round and reflects its decision on return',{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.SHARING_PREVIEW_ORIGIN);assert.ok(['localhost','127.0.0.1'].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  const base=`${origin.origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101`;
  await page.goto(base);
  await page.getByRole('link',{name:'1층 평면도 작업실 열기',exact:true}).click();
  await page.getByRole('button',{name:'사각형 도구 화면',exact:true}).click();
  await page.getByRole('region',{name:'화면 도형 오버레이',exact:true}).click({position:{x:120,y:100}});
  await page.getByLabel('이름',{exact:true}).fill('복원할 실제 화면 도형');
  const shapeId=await page.getByRole('button',{name:'복원할 실제 화면 도형 · 화면 도형',exact:true}).getAttribute('data-screen-shape');
  await page.getByRole('button',{name:'검토 모드',exact:true}).click();
  await page.getByRole('button',{name:'검토 요청 구성',exact:true}).click();
  await page.getByLabel('요청 메시지',{exact:true}).fill('프로젝트에서 이어 볼 요청');
  await page.getByRole('button',{name:'요청 내용 미리보기',exact:true}).click();
  await page.getByRole('button',{name:'이 구성으로 검토 흐름 체험',exact:true}).click();
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await page.getByRole('navigation',{name:'프로젝트 업무',exact:true}).getByRole('link',{name:'검토',exact:true}).click();
  const list=page.getByRole('region',{name:'프로젝트 변경 요청 묶음',exact:true});
  await expect(list).toContainText('프로젝트에서 이어 볼 요청',{timeout:5000});
  await list.getByRole('link',{name:'요청 1 검토하기',exact:true}).click();
  await expect(page).toHaveURL(/screenDocument=00000000-0000-4000-8000-000000000111/);
  await expect(page).toHaveURL(/requestRound=1/);
  const batch=page.getByRole('region',{name:'요청 묶음 검토',exact:true});
  await expect(batch).toContainText('프로젝트에서 이어 볼 요청');
  await expect(batch.getByRole('button',{name:'도면에서 확인',exact:true})).toBeEnabled({timeout:5000});
  await batch.getByRole('button',{name:'도면에서 확인',exact:true}).click();
  await expect(page.locator('[data-change-detail]')).toHaveAttribute('data-change-detail',shapeId);
  await expect(page.getByRole('button',{name:'복원할 실제 화면 도형 · 화면 도형',exact:true})).toHaveAttribute('data-screen-shape',shapeId);
  await page.getByRole('button',{name:'요청 묶음 보기',exact:true}).click();
  await page.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  const item=batch.getByRole('article').first();
  await item.getByLabel('검토 의견',{exact:true}).fill('프로젝트 왕복 후 수정 요청');
  await item.getByRole('button',{name:'수정 요청 · 예시',exact:true}).click();
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await expect(page).toHaveURL(/panel=project-reviews/);
  await expect(list).toContainText('수정 요청 1건');
  await page.goto(`${base}&panel=project-reviews&role=viewer`);
  await list.getByRole('link',{name:'요청 1 검토하기',exact:true}).click();
  await expect(page).toHaveURL(/role=viewer/);
  await page.getByRole('button',{name:'검토자 보기 · 예시',exact:true}).click();
  await expect(batch.getByRole('button',{name:'확인 · 예시',exact:true}).first()).toBeDisabled();
 }finally{await browser.close();}
});

test("material reference stays fixed across a new revision and Viewer cannot reassign it",{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.SHARING_PREVIEW_ORIGIN);assert.ok(["localhost","127.0.0.1"].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(`${origin.origin}/workspace-preview`);
  await page.evaluate(()=>{
   sessionStorage.setItem("1hk:preview:review:00000000-0000-4000-8000-000000000111",JSON.stringify({phase:"draft",role:"author",revision:2,page:1,position:0,before:0,issue:"",message:"",focused:false,compared:false,history:[]}));
   sessionStorage.setItem("1hk:preview:material-draft:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111",JSON.stringify({current:"material",name:"근거 유지 자재",supplier:"",memo:"",receipt:"미확인",linkedEvidence:false,sourceReference:{revision:1,page:1}}));
  });
  const url=`${origin.origin}/workspace-preview/drawing-workspace?layout=pdf&startKind=office&screenDocument=00000000-0000-4000-8000-000000000111&returnProject=00000000-0000-4000-8000-000000000101&takeoffPreview=1`;
  for(const role of ["viewer","editor"]){
   await page.goto(`${url}&role=${role}`);
   await page.getByRole("button",{name:"설명용 A01 예시 보기",exact:true}).click();
   await page.getByRole("button",{name:"3 내역",exact:true}).click();
   await page.getByRole("button",{name:"자재·발주·입고 화면 보기",exact:true}).click();
   const ref=page.getByRole("region",{name:"자재 지정 근거",exact:true});
   await expect(ref).toContainText("지정 근거: R1 · 1쪽");
   await expect(ref).toContainText("현재 R2과 지정 근거가 다릅니다");
   await page.getByText("지정 근거 열기",{exact:true}).click();
   await expect(ref).toContainText("이전 지정 기록에 원본 식별 정보가 없습니다");
   await expect(ref.getByRole("img")).toHaveCount(0);
   await page.getByText("지정 근거 열기",{exact:true}).click();
   const assign=page.getByRole("button",{name:"현재 페이지·개정을 자재 근거로 지정",exact:true});
   if(role==="viewer")await expect(assign).toBeDisabled();
   else{await assign.click();await expect(ref).toContainText("지정 근거: R2 · 1쪽");}
  }
  assert.deepEqual(await page.evaluate(()=>JSON.parse(sessionStorage.getItem("1hk:preview:material-draft:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111")).sourceReference),{revision:2,page:1,source:{kind:"office",paper:"A3"}});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test("quantity and material routes use an existing drawing and return to the originating panel",{skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const origin=new URL(process.env.SHARING_PREVIEW_ORIGIN);assert.ok(["localhost","127.0.0.1"].includes(origin.hostname));
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();const errors=[];page.on("pageerror",e=>errors.push(e.message));
  const base=`${origin.origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101`;
  await page.goto(`${base}&panel=project-quantities`);
  await expect(page.getByRole("heading",{name:"물량 현황",exact:true})).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link",{name:"이 도면의 물량·내역 보기",exact:true}).first().click();
  await expect(page).toHaveURL(/screenDocument=00000000-0000-4000-8000-000000000111/);
  await expect(page.getByRole("region",{name:"물량·내역 작업 패널",exact:true})).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const drawingBox=await page.locator('.pdf-drawing-viewport').boundingBox();
  const panelBox=await page.getByRole("region",{name:"물량·내역 작업 패널",exact:true}).boundingBox();
  assert.ok(drawingBox&&panelBox&&drawingBox.x+drawingBox.width<=panelBox.x+1,"drawing remains beside takeoff rather than beneath an overlay");
  await page.keyboard.press("Escape");
  await page.locator('a[href*="panel=project-quantities"]').click();
  await expect(page.getByRole("heading",{name:"물량 현황",exact:true})).toBeVisible();
  await page.getByRole("navigation",{name:"프로젝트 업무",exact:true}).getByRole("link",{name:"자재",exact:true}).click();
  await expect(page.getByRole("region",{name:"자재 업무 화면 예시",exact:true})).toHaveCount(0);
  await page.getByRole("combobox",{name:"기준 도면",exact:true}).selectOption("00000000-0000-4000-8000-000000000111");
  await expect(page.getByRole("region",{name:"자재 업무 화면 예시",exact:true})).toContainText("1층 평면도");
  await page.getByRole("textbox",{name:"자재 이름",exact:true}).fill("1층 마감 자재 초안");
  await page.getByRole("button",{name:"발주 초안",exact:true}).click();
  await page.getByRole("textbox",{name:"공급사 초안",exact:true}).fill("협의 중인 공급사");
  await page.getByRole("textbox",{name:"요청 메모",exact:true}).fill("사양 확인 후 발주 검토");
  await page.getByRole("button",{name:"도면의 A01 위치로 돌아가기",exact:true}).click();
  await expect(page).toHaveURL(/screenDocument=00000000-0000-4000-8000-000000000111/);
  await expect(page.getByRole("region",{name:"물량·내역 작업 패널",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"설명용 A01 예시 보기",exact:true}).click();
  await page.getByRole("button",{name:"3 내역",exact:true}).click();
  await page.getByRole("button",{name:"자재·발주·입고 화면 보기",exact:true}).click();
  await page.getByRole("button",{name:"현재 페이지·개정을 자재 근거로 지정",exact:true}).click();
  await expect(page.getByRole("region",{name:"자재 업무 화면 예시",exact:true})).toContainText("지정 근거: R1 · 1쪽");
  await page.getByText("지정 근거 열기",{exact:true}).click();
  await expect(page.getByRole("img",{name:"1층 평면도 · 지정 원본 템플릿 예시",exact:true})).toBeVisible();
  await page.getByText("지정 근거 열기",{exact:true}).click();
  await expect(page.getByRole("textbox",{name:"공급사 초안",exact:true})).toHaveValue("협의 중인 공급사");
  await expect(page.getByRole("textbox",{name:"요청 메모",exact:true})).toHaveValue("사양 확인 후 발주 검토");
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreMaterialWrite=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.startsWith("1hk:preview:material-draft:"))throw Error("test quota");return original.call(this,key,value);};});
  await page.getByRole("textbox",{name:"공급사 초안",exact:true}).fill("도면에서 수정한 공급사");
  await expect(page.getByRole("alert").filter({hasText:"자재 초안을 보관하지 못했습니다"})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region",{name:"물량·내역 작업 패널",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"물량·내역 패널 닫기",exact:true}).click();
  await expect(page.getByRole("region",{name:"물량·내역 작업 패널",exact:true})).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/screenDocument=00000000-0000-4000-8000-000000000111/);
  await expect(page.getByRole("button",{name:"B01 내역으로 돌아가기",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"도면의 A01 위치로 돌아가기",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"공급사 초안",exact:true})).toHaveValue("도면에서 수정한 공급사");
  await page.evaluate(()=>window.restoreMaterialWrite());
  await page.getByRole("button",{name:"자재 초안 보관 다시 시도",exact:true}).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  if(process.env.MATERIAL_DRAFT_SCREENSHOT)await page.screenshot({path:process.env.MATERIAL_DRAFT_SCREENSHOT,fullPage:true,animations:"disabled"});
  await page.setViewportSize({width:390,height:844});
  const mobileDrawing=await page.locator('.pdf-drawing-viewport').boundingBox();
  const mobilePanel=await page.getByRole("region",{name:"물량·내역 작업 패널",exact:true}).boundingBox();
  assert.ok(mobileDrawing&&mobilePanel&&mobileDrawing.height>0&&mobileDrawing.y+mobileDrawing.height<=mobilePanel.y+1,"mobile keeps drawing above the work panel");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.MATERIAL_MOBILE_SCREENSHOT)await page.screenshot({path:process.env.MATERIAL_MOBILE_SCREENSHOT,fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"물량·내역 패널 닫기",exact:true}).click();
  await expect(page.getByRole("region",{name:"물량·내역 작업 패널",exact:true})).toHaveCount(0);
  await page.getByLabel("도면 업무 더보기",{exact:true}).click();
  await page.getByRole("button",{name:"물량·내역 화면 열기",exact:true}).click();
  await expect(page.getByRole("region",{name:"도면 물량 연결",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"설명용 A01 예시 보기",exact:true}).click();
  await page.getByRole("button",{name:"자재·발주·입고 화면 보기",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"공급사 초안",exact:true})).toHaveValue("도면에서 수정한 공급사");
  await page.getByRole("textbox",{name:"공급사 초안",exact:true}).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region",{name:"물량·내역 작업 패널",exact:true})).not.toBeVisible();
  await page.setViewportSize({width:1280,height:720});
  await page.locator('a[href*="panel=project-materials"]').click();
  await expect(page.getByRole("combobox",{name:"기준 도면",exact:true})).toHaveValue("00000000-0000-4000-8000-000000000111");
  await expect(page.getByRole("region",{name:"자재 업무 화면 예시",exact:true})).toContainText("지정 근거: R1 · 1쪽");
  await expect(page.getByRole("textbox",{name:"공급사 초안",exact:true})).toHaveValue("도면에서 수정한 공급사");
  await expect(page.getByRole("textbox",{name:"요청 메모",exact:true})).toHaveValue("사양 확인 후 발주 검토");
  await page.reload();
  await expect(page.getByRole("textbox",{name:"요청 메모",exact:true})).toHaveValue("사양 확인 후 발주 검토");
  const source=page.getByRole("combobox",{name:"기준 도면",exact:true});
  const alternate=await source.locator('option').nth(2).getAttribute('value');
  await source.selectOption(alternate);
  await expect(page.getByRole("textbox",{name:"자재 이름",exact:true})).toHaveValue("마감 자재 · 예시");
  await page.getByRole("textbox",{name:"자재 이름",exact:true}).fill("다른 도면의 자재");
  await source.selectOption("00000000-0000-4000-8000-000000000111");
  await expect(page.getByRole("textbox",{name:"요청 메모",exact:true})).toHaveValue("사양 확인 후 발주 검토");
  await page.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreMaterialWrite=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(key,value){if(key.startsWith("1hk:preview:material-draft:"))throw Error("test quota");return original.call(this,key,value);};});
  await page.getByRole("textbox",{name:"요청 메모",exact:true}).fill("보관 실패 메모 유지");
  await expect(page.getByRole("alert").filter({hasText:"자재 초안을 보관하지 못했습니다"})).toBeVisible();
  await page.getByRole("navigation",{name:"프로젝트 업무",exact:true}).getByRole("link",{name:"검토",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"요청 메모",exact:true})).toHaveValue("보관 실패 메모 유지");
  await page.evaluate(()=>window.restoreMaterialWrite());
  await page.getByRole("button",{name:"자재 초안 보관 다시 시도",exact:true}).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("textbox",{name:"요청 메모",exact:true})).toHaveValue("보관 실패 메모 유지");
  await page.evaluate(()=>sessionStorage.setItem("1hk:preview:material-draft:00000000-0000-4000-8000-000000000101:00000000-0000-4000-8000-000000000111","null"));
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("자재 초안을 복원하지 못했습니다");
  await expect(page.getByRole("textbox",{name:"자재 이름",exact:true})).toBeDisabled();
  await page.goto(`${base}&panel=project-materials&sourceDrawing=missing`);
  await expect(page.getByRole("alert")).toContainText("지정한 도면을 찾을 수 없습니다");
  await expect(page.getByRole("region",{name:"자재 업무 화면 예시",exact:true})).toHaveCount(0);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});

test("project sections remain in the shell and preserve the resource draft across navigation", {skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000}, async()=>{
  const origin=new URL(process.env.SHARING_PREVIEW_ORIGIN);
  assert.ok(["localhost","127.0.0.1"].includes(origin.hostname));
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on("pageerror",e=>errors.push(e.message));
    await page.goto(`${origin.origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-resources`);
    await expect(page.getByRole("textbox",{name:"자료 이름",exact:true})).toBeEnabled();
    await page.getByRole("textbox",{name:"자료 이름",exact:true}).fill("회의록 초안 유지");
    for(const [label,title] of [["변경 이력","프로젝트 변경 이력"],["외부 공유","외부 공유 준비"],["자료","프로젝트 자료"]]) {
      const link=page.getByRole("navigation",{name:"프로젝트 업무",exact:true}).getByRole("link",{name:label,exact:true});
      await link.click();
      await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();
      await expect(link).toHaveAttribute("aria-current","page");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    }
    await expect(page.getByRole("textbox",{name:"자료 이름",exact:true})).toHaveValue("회의록 초안 유지");
    if(process.env.PROJECT_SECTIONS_SCREENSHOT)await page.screenshot({path:process.env.PROJECT_SECTIONS_SCREENSHOT,fullPage:true,animations:"disabled"});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button",{name:"프로젝트 메뉴 열기",exact:true}).click();
    await page.getByRole("dialog").getByRole("link",{name:"외부 공유",exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("textbox",{name:"수신자 표시 이름",exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});

test("project review is an inline destination and preserves drawing search on return", {skip:!process.env.SHARING_PREVIEW_ORIGIN,timeout:60000}, async()=>{
  const origin=new URL(process.env.SHARING_PREVIEW_ORIGIN);
  assert.ok(["localhost","127.0.0.1"].includes(origin.hostname));
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[]; page.on("pageerror", error=>errors.push(error.message));
    await page.goto(`${origin.origin}/workspace-preview?project=00000000-0000-4000-8000-000000000101`);
    await page.getByRole("textbox",{name:"도면 검색",exact:true}).fill("검색 상태 유지");
    await page.getByRole("navigation",{name:"프로젝트 업무",exact:true}).getByRole("link",{name:"검토",exact:true}).click();
    await expect(page.getByRole("heading",{name:"검토 현황",exact:true})).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("navigation",{name:"프로젝트 업무",exact:true}).getByRole("link",{name:"검토",exact:true})).toHaveAttribute("aria-current","page");
    await page.getByRole("link",{name:"도면 목록으로",exact:true}).click();
    await expect(page.getByRole("textbox",{name:"도면 검색",exact:true})).toHaveValue("검색 상태 유지");
    await page.getByRole("navigation",{name:"프로젝트 업무",exact:true}).getByRole("link",{name:"검토",exact:true}).click();
    await page.getByRole("button",{name:"완료",exact:true}).click();
    await expect(page).toHaveURL(/reviewStatus=/);
    await expect(page.getByRole("button",{name:"완료",exact:true})).toHaveAttribute("aria-pressed","true");
    await page.reload();
    await expect(page.getByRole("button",{name:"완료",exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(page.getByRole("heading",{name:"조건에 맞는 검토가 없습니다.",exact:true})).toBeVisible();
    await page.setViewportSize({width:390,height:844});
    await page.getByRole("button",{name:"프로젝트 메뉴 열기",exact:true}).click();
    const menu=page.getByRole("dialog");
    await expect(menu.getByRole("link",{name:"검토",exact:true})).toHaveAttribute("aria-current","page");
    await menu.getByRole("link",{name:"도면",exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("textbox",{name:"도면 검색",exact:true})).toBeVisible();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
