import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const vite = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const mod = await vite.ssrLoadModule("/app/lukas/components/drawing-delivery-preview.tsx");
test.after(() => vite.close());

test('attached requests require captured drawing and source evidence before preparation',()=>{
 const snapshot={documentName:'구조.pdf',pageCount:3,objects:[],layers:[],source:{kind:'office',paper:'A3'}};
 const request={round:1,message:'근거 확인',items:[{id:'one',title:'1층',page:1}],decisions:{},snapshot};
 for(const [before,after] of [[undefined,snapshot],[snapshot,undefined],[{...snapshot,source:undefined},snapshot],[snapshot,{...snapshot,source:undefined}]]){
  for(const [stage,label] of [['package','납품 준비 화면 보기'],['preparing','수신자 화면 보기'],['failed','같은 구성으로 재시도']]){
   const html=render({page:1,pageCount:3,stage,approvedRequest:{...request,snapshot:before},drawingSnapshot:after});
   assert.match(html,new RegExp(`<button[^>]* disabled=""[^>]*>${label}</button>`));
  }
 }
 const complete=render({page:1,pageCount:3,approvedRequest:request,drawingSnapshot:snapshot});
 assert.doesNotMatch(complete,/<button[^>]* disabled=""[^>]*>납품 준비 화면 보기<\/button>/);
 const oldRecipient=render({page:1,pageCount:3,stage:'recipient',approvedRequest:{...request,snapshot:undefined}});
 assert.doesNotMatch(oldRecipient,/<button[^>]* disabled=""[^>]*>납품 구성으로 돌아가기<\/button>/);
});

test('frozen drawing records each offer a correctly labelled read-only viewer',()=>{
 const snapshot={documentName:'구조.pdf',pageCount:1,objects:[],layers:[{id:'review',name:'검토',visible:true,locked:false}]};
 const request={round:1,items:[],decisions:{},snapshot};
 const renderCheck=(value)=>renderToStaticMarkup(React.createElement(mod.DrawingDeliveryDrawingCheck,{request,snapshot:value}));
 assert.match(renderCheck(snapshot),/>요청 당시 도형 배치 보기<\/button>/);
 assert.match(renderCheck(snapshot),/>납품 구성 당시 도형 배치 보기<\/button>/);
 assert.match(renderCheck(snapshot),/>두 기록 나란히 비교<\/button>/);
 assert.doesNotMatch(renderCheck(undefined),/>납품 구성 당시 도형 배치 보기<\/button>/);
 assert.doesNotMatch(renderCheck(undefined),/>두 기록 나란히 비교<\/button>/);
});

test('comparison pane distinguishes an absent page from an empty recorded page',async()=>{
 const {DrawingSnapshotComparisonPane}=await vite.ssrLoadModule('/app/lukas/components/drawing-snapshot-comparison');
 const snapshot={documentName:'기록',pageCount:1,objects:[],layers:[],source:{kind:'pdf',fileName:'기록.pdf',fingerprint:'a'.repeat(64),byteSize:100}};
 const pane=page=>renderToStaticMarkup(React.createElement(DrawingSnapshotComparisonPane,{label:'요청 당시',snapshot,page,selected:null,onSelect:()=>{}}));
 assert.match(pane(2),/이 기록에는 2쪽이 없습니다/);
 assert.doesNotMatch(pane(2),/화면 도형 오버레이/);
 assert.match(pane(1),/이 페이지에 표시할 저장 도형이 없습니다/);
 assert.match(pane(1),/요청 당시 비교 PDF 선택/);
 assert.match(pane(1),/동일한 원본만 표시/);
 const shape={id:'a',kind:'사각형',page:1,x:100.123456,y:200,name:'숨긴 도형',layer:'hidden',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
 const hidden={...snapshot,objects:[shape],layers:[{id:'hidden',name:'숨김',visible:false,locked:true}],source:{kind:'office',paper:'A3'}};
 const renderHidden=showHidden=>renderToStaticMarkup(React.createElement(DrawingSnapshotComparisonPane,{label:'요청 당시',snapshot:hidden,page:1,selected:'a',onSelect:()=>{},showHidden}));
 assert.doesNotMatch(renderHidden(false),/data-screen-shape="a"/);
 assert.match(renderHidden(true),/data-screen-shape="a"/);
 assert.match(renderHidden(true),/aspect-\[7\/3\]/);
 assert.match(renderHidden(true),/화면 위치 100.12, 200/);
});

test('pending delivery attachment requires an approved request and survives before a package exists',async()=>{
 const {parseDeliveryDraft}=await vite.ssrLoadModule('/app/lukas/components/drawing-delivery-draft.ts');
 const request={round:1,message:'첨부 대기',items:[{id:'one',title:'영역',kind:'added',page:1,x:10,y:20,width:140,height:90,author:'나',summary:'화면 도형',before:'없음',after:'사각형',sample:false}],decisions:{one:{kind:'checked',note:'확인'}},approval:{note:'승인 범위 확인',at:'2026-09-10T03:00:00.000Z'}};
 const draft={schema:1,deliveryStage:'package',deliveryConfiguration:{recipient:'현장 담당 · 예시',includeEvidence:true,includeBoq:false,boqFormat:'xlsx'},exportSelection:null,deliverySource:null,pendingApprovedRequest:request};
 assert.equal(parseDeliveryDraft(JSON.stringify(draft))?.pendingApprovedRequest.approval.note,'승인 범위 확인');
 for(const invalid of [null,{...request,approval:undefined},{...request,decisions:{}},{...request,approval:{note:'x',at:'invalid'}}])assert.equal(parseDeliveryDraft(JSON.stringify({...draft,pendingApprovedRequest:invalid})),null);
});

test('archived delivery displays its frozen request items and decisions',async()=>{
 const {DrawingDeliveryHistory}=await vite.ssrLoadModule('/app/lukas/components/drawing-delivery-preview.tsx');
 const request={round:2,message:'고정된 출입문 검토',items:[{id:'door',title:'출입문 폭',page:2}],decisions:{door:{kind:'checked',note:'유효 폭 확인'}},approval:{note:'요청 범위 확인 완료',at:'2026-09-09T03:00:00.000Z'}};
 const record={id:'one',createdAt:'2026-09-09T04:00:00.000Z',deliveryStage:'package',deliveryConfiguration:{recipient:'현장 담당 · 예시',includeEvidence:true,includeBoq:false,boqFormat:'xlsx'},exportSelection:{format:'pdf',pageRange:'current',includeComments:true},deliverySource:{documentName:'구조.pdf',page:2,pageCount:3,reviewState:'draft',approvedRequest:request}};
 const html=renderToStaticMarkup(React.createElement(DrawingDeliveryHistory,{records:[record]}));
 for(const text of ['고정된 출입문 검토','출입문 폭','유효 폭 확인','요청 범위 확인 완료'])assert.ok(html.includes(text),`missing frozen evidence: ${text}`);
 assert.doesNotMatch(html,/<(?:input|textarea|select)\b/);
});

const render = (props = {}) => {
  assert.equal(typeof mod.DrawingDeliveryPreview, "function");
  return renderToStaticMarkup(
    React.createElement(mod.DrawingDeliveryPreview, {
      documentName: "구조.pdf",
      page: 3,
      ready: true,
      viewer: false,
      reviewState: "draft",
      selection: { format: "dwg", pageRange: "current", includeComments: true },
      onReturn() {},
      ...props,
    }),
  );
};
test('delivery separates attached request approval from an untouched revision example',async()=>{
 const {createReviewLoop}=await vite.ssrLoadModule('/app/lukas/components/drawing-review-loop.tsx');
 const request={round:2,message:'요청만 확인',items:[{id:'a',title:'영역',page:1}],decisions:{a:{kind:'checked',note:'확인'}},approval:{note:'요청 확인',at:'2026-09-10T03:00:00Z'}};
 const html=render({approvedRequest:request,reviewRecord:createReviewLoop()});
 assert.match(html,/요청 2 · 1개 항목 승인 확인 기록 첨부/);
 assert.match(html,/별도 개정 검토 기록 없음/);
 assert.doesNotMatch(html,/구성 당시 검토 기록/);
 assert.doesNotMatch(html,/D01 · 문 위치 변경 예시/);
 assert.doesNotMatch(html,/>검토 전<\/dd>/);
 assert.match(html,/요청 항목의 승인 확인을 도면 전체 승인으로 확대하지 않습니다/);
 const legacy=render({reviewRecord:createReviewLoop('approved'),reviewState:'approved'});
 assert.match(legacy,/첨부된 요청 승인 기록 없음/);
 assert.match(legacy,/R1 · 승인된 개정/);
 assert.match(legacy,/구성 당시 검토 기록/);
});
test("package retains source context and does not qualify DWG delivery", () => {
  const h = render();
  assert.match(h, /구조.pdf/);
  assert.match(h, /3쪽/);
  assert.match(h, /DWG/);
  assert.match(h, /호환성 미검증/);
  assert.match(h, /실제 파일·전송 없음/);
  assert.doesNotMatch(h, /download=/);
});
test('delivery blocks preparation when its scope omits an attached request page',()=>{
 const approvedRequest={round:2,message:'두 페이지 검토',items:[{id:'one',title:'1층',page:1},{id:'two',title:'2층',page:2}],decisions:{},approval:{note:'확인',at:'2026-09-10T03:00:00Z'}};
 const html=render({page:1,pageCount:3,approvedRequest,onSelectionChange(){}});
 assert.match(html,/납품 범위에서 빠진 요청 페이지: 2쪽/);
 assert.match(html,/<button[^>]* disabled=""[^>]*>납품 준비 화면 보기<\/button>/);
 assert.match(html,/전체 페이지로 범위 변경/);
 const snapshot={documentName:'구조.pdf',pageCount:3,objects:[],layers:[],source:{kind:'office',paper:'A3'}};
 const all=render({page:1,pageCount:3,approvedRequest:{...approvedRequest,snapshot},drawingSnapshot:snapshot,selection:{format:'pdf',pageRange:'all',includeComments:true}});
 assert.match(all,/요청 항목이 있는 모든 페이지가 포함됩니다/);
 assert.match(all,/요청 항목이 없는 납품 페이지: 1개/);
 assert.doesNotMatch(all,/<button[^>]* disabled=""[^>]*>납품 준비 화면 보기<\/button>/);
 assert.match(all,/파일 동일성·도면 전체 승인을 확인한 결과가 아닙니다/);
});
test('request pages beyond the captured document cannot be repaired by selecting all pages',()=>{
 const html=render({page:1,pageCount:2,approvedRequest:{round:1,message:'옛 요청',items:[{id:'one',title:'3층',page:3}],decisions:{}},onSelectionChange(){}});
 assert.match(html,/납품 범위에서 빠진 요청 페이지: 3쪽/);
 assert.doesNotMatch(html,/전체 페이지로 범위 변경/);
 assert.match(html,/요청 페이지를 포함하는 도면으로 새 납품 구성을 시작해 주세요/);
});
test('unknown delivery page count blocks preparation without offering an all-page correction',()=>{
 const html=render({page:1,pageCount:undefined,selection:{format:'pdf',pageRange:'all',includeComments:false},approvedRequest:{round:1,message:'페이지 확인',items:[{id:'one',title:'1층',page:1}],decisions:{}},onSelectionChange(){}});
 assert.match(html,/페이지 정보를 확인할 수 없습니다/);
 assert.match(html,/<button[^>]* disabled=""[^>]*>납품 준비 화면 보기<\/button>/);
 assert.doesNotMatch(html,/전체 페이지로 범위 변경|요청 항목이 있는 모든 페이지가 포함됩니다/);
});
test('delivery distinguishes a changed frozen drawing from the approved request',()=>{
 const snapshot={documentName:'구조.pdf',pageCount:3,objects:[],layers:[{id:'review',name:'검토',visible:true,locked:false}],source:{kind:'pdf',fileName:'구조.pdf',byteSize:100,fingerprint:'a'.repeat(64)}};
 const request={round:1,message:'승인 범위',items:[{id:'one',title:'1층',page:1}],decisions:{},snapshot};
 const changed=render({page:1,pageCount:3,approvedRequest:request,drawingSnapshot:{...snapshot,source:{...snapshot.source,fingerprint:'b'.repeat(64)}}});
 assert.match(changed,/승인 요청과 납품 구성의 도면 기록이 다릅니다/);
 assert.match(changed,/원본 식별 정보가 변경됐습니다/);
 assert.match(changed,/<button[^>]* disabled=""[^>]*>납품 준비 화면 보기<\/button>/);
 const same=render({page:1,pageCount:3,approvedRequest:request,drawingSnapshot:snapshot});
 assert.match(same,/요청 당시 기록과 납품 구성 당시 기록이 일치합니다/);
 assert.doesNotMatch(same,/<button[^>]* disabled=""[^>]*>납품 준비 화면 보기<\/button>/);
 assert.match(render({page:1,pageCount:3,approvedRequest:request}),/납품 구성 당시 도면 기록이 없어 대조할 수 없습니다/);
});
test('delivery validates captured drawing records and never invents them for old packages',async()=>{
 const {parseDeliveryDraft}=await vite.ssrLoadModule('/app/lukas/components/drawing-delivery-draft.ts');
 const source={documentName:'구조.pdf',page:1,pageCount:3,reviewState:'draft'};
 const snapshot={documentName:'구조.pdf',pageCount:3,objects:[],layers:[{id:'review',name:'검토',visible:true,locked:false}],source:{kind:'pdf',fileName:'구조.pdf',byteSize:100,fingerprint:'a'.repeat(64)}};
 const draft={schema:1,deliveryStage:'package',deliveryConfiguration:{recipient:'현장 담당 · 예시',includeEvidence:true,includeBoq:false,boqFormat:'xlsx'},exportSelection:{format:'pdf',pageRange:'all',includeComments:false},deliverySource:source};
 assert.equal(parseDeliveryDraft(JSON.stringify(draft)).deliverySource.drawingSnapshot,undefined);
 const parse=drawingSnapshot=>parseDeliveryDraft(JSON.stringify({...draft,deliverySource:{...source,drawingSnapshot}}));
 assert.deepEqual(parse(snapshot)?.deliverySource.drawingSnapshot,snapshot);
 for(const value of [null,{...snapshot,pageCount:2},{...snapshot,objects:'broken'},{...snapshot,source:{...snapshot.source,fingerprint:'bad'}}])assert.equal(parse(value),null);
});
test('reordering otherwise identical drawing objects requires renewed review',()=>{
 const a={id:'a',kind:'사각형',page:1,x:20,y:20,name:'A',layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
 const b={...a,id:'b',name:'B'};
 const snapshot={documentName:'구조.pdf',pageCount:3,objects:[a,b],layers:[{id:'review',name:'검토',visible:true,locked:false}],source:{kind:'office',paper:'A3'}};
 const html=render({page:1,pageCount:3,approvedRequest:{round:1,message:'순서 확인',items:[{id:'a',title:'A',page:1}],decisions:{},snapshot},drawingSnapshot:{...snapshot,objects:[b,a]}});
 assert.match(html,/도형 표시 순서가 변경됐습니다/);
 assert.match(html,/<button[^>]* disabled=""[^>]*>납품 준비 화면 보기<\/button>/);
});
test('valid multi-object delivery history is not rejected by the old draft size ceiling',async()=>{
 const {parseDeliveryDraft}=await vite.ssrLoadModule('/app/lukas/components/drawing-delivery-draft.ts');
 const objects=Array.from({length:600},(_,index)=>({id:`object-${index}`,kind:'사각형',page:1,x:20,y:20,name:`검토 도형 ${index}`,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''}));
 const snapshot={documentName:'구조.pdf',pageCount:1,objects,layers:[{id:'review',name:'검토',visible:true,locked:false}],source:{kind:'office',paper:'A3'}};
 const approvedRequest={round:1,message:'기록 보관',items:[{id:'object-0',title:'검토 도형 0',page:1,kind:'added',sample:false,x:20,y:20,width:140,height:90,author:'나',summary:'범위 확인',before:'없음',after:'추가'}],decisions:{'object-0':{kind:'checked',note:'확인'}},approval:{note:'범위 확인',at:'2026-09-10T03:00:00Z'},snapshot};
 const draft={schema:1,deliveryStage:'package',deliveryConfiguration:{recipient:'현장 담당 · 예시',includeEvidence:true,includeBoq:false,boqFormat:'xlsx'},exportSelection:{format:'pdf',pageRange:'all',includeComments:false},deliverySource:{documentName:'구조.pdf',page:1,pageCount:1,reviewState:'draft',drawingSnapshot:snapshot,approvedRequest},deliveryHistory:[]};
 draft.deliveryHistory=[1,2].map(index=>({...draft,id:`history-${index}`,createdAt:'2026-09-10T03:00:00Z',deliveryHistory:[]}));
 const raw=JSON.stringify(draft);assert.ok(raw.length>250000);
 const restored=parseDeliveryDraft(raw);
 assert.equal(restored?.deliverySource.drawingSnapshot.objects.length,600);
 assert.equal(restored?.deliveryHistory[1].deliverySource.drawingSnapshot.objects[599].name,'검토 도형 599');
});
test("delivery identifies the selected reviewed object rather than the door demo",()=>{
 const html=render({reviewContext:{revision:2,page:1,targetName:"회의실 A"}});
 assert.match(html,/R2 · 1쪽 · 회의실 A/);assert.doesNotMatch(html,/D01/);
});
test("delivery draft rejects corrupt or mismatched frozen scope instead of inventing a package",async()=>{
 const {parseDeliveryDraft}=await vite.ssrLoadModule("/app/lukas/components/drawing-delivery-draft.ts");
 const draft={schema:1,deliveryStage:"recipient",deliveryConfiguration:{recipient:"현장 담당 · 예시",includeEvidence:true,includeBoq:false,boqFormat:"xlsx"},exportSelection:{format:"pdf",pageRange:"current",includeComments:false},deliverySource:{documentName:"구조.pdf",page:2,pageCount:3,reviewState:"approved",reviewContext:{revision:2,page:1,targetName:"영역"}}};
 assert.equal(parseDeliveryDraft(JSON.stringify(draft))?.deliverySource.page,2);
 const record={...draft,id:"package-1",createdAt:"2026-09-09T03:00:00.000Z"};
 const withHistory={...draft,deliveryHistory:[record]};
 assert.equal(parseDeliveryDraft(JSON.stringify(withHistory))?.deliveryHistory.length,1);
 for(const history of [[{...record,id:""}],[{...record,createdAt:"bad"}],[record,record],[{...record,deliverySource:null}]] )assert.equal(parseDeliveryDraft(JSON.stringify({...draft,deliveryHistory:history})),null);
 for(const bad of [null,{...draft,schema:2},{...draft,deliveryStage:"sent"},{...draft,deliverySource:null},{...draft,exportSelection:{...draft.exportSelection,format:"exe"}},{...draft,deliverySource:{...draft.deliverySource,page:4}},{...draft,deliveryConfiguration:{...draft.deliveryConfiguration,includeBoq:"yes"}}])assert.equal(parseDeliveryDraft(JSON.stringify(bad)),null);
 assert.equal(parseDeliveryDraft("not json"),null);
});
test("recipient view never claims a delivered or approved package", () => {
  const h = render({ stage: "recipient" });
  assert.match(h, /수신자 화면 예시/);
  assert.match(h, /전달받은 실제 파일은 없습니다/);
  assert.match(h, /별도 개정 검토 기록 없음/);
  assert.match(h, /도면으로 돌아가기/);
});
test("restored configuration reaches the recipient without reverting format or evidence choices", () => {
 const html=render({stage:"recipient",configuration:{recipient:"현장 담당 · 예시",includeEvidence:false,includeBoq:true,boqFormat:"csv"}});
 assert.match(html,/현장 담당 · 예시의 보기 전용/);
 assert.match(html,/CSV \(.csv\)/);
 assert.match(html,/B01 내역 구성/);
 assert.doesNotMatch(html,/원본·개정 근거 목록/);
});
test("empty drawing has no fabricated package", () => {
  const h = render({ ready: false });
  assert.match(h, /도면을 먼저/);
  assert.doesNotMatch(h, /수신자 화면 보기/);
});
test("Viewer can inspect but cannot configure package", () => {
  assert.match(render({ viewer: true }), /<fieldset disabled/);
});
test("package offers only unconfirmed BOQ inclusion", () => {
  assert.match(render(), /미확정 내역 예시 포함/);
});
test("delivery preparation and failure keep package context and offer recovery", () => {
 const preparing=render({stage:"preparing"});
 assert.match(preparing,/납품 준비 중 · 화면 예시/);
 assert.match(preparing,/준비 취소/);
 assert.match(preparing,/실패 상태 체험/);
 const failed=render({stage:"failed"});
 assert.match(failed,/납품 준비 실패 · 화면 예시/);
 assert.match(failed,/같은 구성으로 재시도/);
 assert.match(failed,/구조.pdf/);
 assert.match(failed,/실제 파일·전송 없음/);
});
test("package exposes spreadsheet handoff formats without enabling finalized export", () => {
 const html=render();
 assert.match(html,/내역 인계 형식/);
 assert.match(html,/Excel \(.xlsx\)/);
 assert.match(html,/CSV \(.csv\)/);
 assert.match(html,/확정 자료 내보내기 · 승인 근거 필요/);
 assert.doesNotMatch(html,/download=/);
});
test("delivery distinguishes reviewed page and revision from the exported page", () => {
  const html = render({ reviewState: "approved", reviewContext: { revision: 2, page: 1 } });
  assert.match(html, /R2 · 1쪽 · D01/);
  assert.match(html, /3쪽/);
  assert.match(html, /내보내기 범위 전체의 승인을 의미하지 않습니다/);
  assert.doesNotMatch(html, /개정 미등록/);
});
