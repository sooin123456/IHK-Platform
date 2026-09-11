import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',resolve:{alias:{'~':fileURLToPath(new URL('../app',import.meta.url))}},server:{middlewareMode:true}});
test.after(()=>vite.close());
test('document approval preflight rejects incomplete scope and stale evidence without mutating records',async()=>{
 const {documentApprovalPreflight}=await vite.ssrLoadModule('/app/lukas/lib/drawing-document-approval-preflight.ts');
 const snapshot={documentName:'도면',pageCount:1,objects:[{id:'a'}],layers:[],source:{kind:'blank',paper:'A3'}};
 const request={round:1,drawingRevision:1,items:[{id:'a'}],approval:{note:'확인',at:'2026-09-10'},snapshot};
 const raw=JSON.stringify(request);
 assert.deepEqual(documentApprovalPreflight(request,snapshot,1),{ready:true,reasons:[],outsideCount:0});
 for(const [record,current,revision] of [[{...request,approval:undefined},snapshot,1],[{...request,drawingRevision:undefined},snapshot,1],[request,snapshot,2],[request,{...snapshot,documentName:'변경'},1],[{...request,snapshot:{...snapshot,source:undefined}},snapshot,1],[request,undefined,1],[{...request,items:[]},snapshot,1]]){
  assert.equal(documentApprovalPreflight(record,current,revision).ready,false);
  assert.ok(documentApprovalPreflight(record,current,revision).reasons.length>0);
 }
 assert.equal(documentApprovalPreflight({...request,items:[]},snapshot,1).outsideCount,1);
 assert.equal(documentApprovalPreflight({...request,items:[{id:'a',sample:true}]},snapshot,1).ready,false);
 assert.equal(documentApprovalPreflight({...request,items:[{id:'a'},{id:'missing'}]},snapshot,1).ready,false);
 assert.equal(JSON.stringify(request),raw);
});
test('correction context only shows an unapproved latest request for the selected object',async()=>{
 const {DrawingObjectCorrectionContext}=await vite.ssrLoadModule('/app/lukas/components/drawing-object-correction-context.tsx');
 const request={round:1,items:[{id:'a'}],decisions:{a:{kind:'changes',note:'출입구 폭 확인'}}};
 const render=(requests,objectId='a')=>renderToStaticMarkup(React.createElement(DrawingObjectCorrectionContext,{objectId,requests,onOpen(){}}));
 assert.match(render([request]),/출입구 폭 확인/);
 assert.equal(render(null),'');assert.equal(render([]),'');assert.equal(render([request],'b'),'');
 assert.equal(render([{...request,approval:{note:'확인',at:'2026-09-10'}}]),'');
 assert.equal(render([request,{...request,round:2,decisions:{}}]),'');
 assert.equal(render([request,{...request,round:2,items:[{id:'b'}]}]),'');
});
test('correction navigation excludes checked, missing and sample targets without changing the request',async()=>{
 const {DrawingObjectCorrectionContext}=await vite.ssrLoadModule('/app/lukas/components/drawing-object-correction-context.tsx');
 const request={round:1,items:[{id:'a'},{id:'checked'},{id:'missing'},{id:'sample',sample:true},{id:'c'}],decisions:{a:{kind:'changes',note:'A 보완'},checked:{kind:'checked',note:''},missing:{kind:'changes',note:'삭제됨'},sample:{kind:'changes',note:'예시'},c:{kind:'changes',note:'C 보완'}}};
 const raw=JSON.stringify(request);
 const html=renderToStaticMarkup(React.createElement(DrawingObjectCorrectionContext,{objectId:'c',requests:[request],availableIds:['a','checked','sample','c'],onOpen(){},onEdit(){}}));
 assert.match(html,/수정 대상 2 \/ 2/);
 assert.match(html,/현재 없는 수정 대상 1개/);
 assert.equal(JSON.stringify(request),raw);
});
test('quantity review links show only the object history and distinguish unavailable evidence',async()=>{
 const {DrawingObjectReviewLinks}=await vite.ssrLoadModule('/app/lukas/components/drawing-object-review-links.tsx');
 const records=[{round:1,items:[{id:'a'}],decisions:{}},{round:2,items:[{id:'b'}],decisions:{}},{round:3,items:[{id:'a'}],decisions:{a:{kind:'changes',note:'수정'}}},{round:4,items:[{id:'a'}],decisions:{a:{kind:'checked',note:''}},approval:{note:'도형 확인',at:'2026-09-10'}}];
 const original=JSON.stringify(records);
 const render=requests=>renderToStaticMarkup(React.createElement(DrawingObjectReviewLinks,{objectId:'a',requests,onOpen(){}}));
 const html=render(records);
 assert.match(html,/도형 검토 요청 1 열기/);assert.match(html,/도형 검토 요청 3 열기/);assert.match(html,/도형 검토 요청 4 열기/);assert.doesNotMatch(html,/도형 검토 요청 2 열기/);
 assert.ok(html.indexOf('도형 검토 요청 4 열기')<html.indexOf('도형 검토 요청 1 열기'));
 assert.match(html,/확인 대기/);assert.match(html,/수정 요청/);assert.match(html,/요청 승인 확인/);assert.match(html,/수량·금액 승인이 아닙니다/);
 assert.match(render(null),/아직 확인할 수 없습니다/);assert.match(render([]),/포함된 검토 요청이 없습니다/);
 assert.equal(JSON.stringify(records),original);
});
test('polyline records require bounded local vertices and preserve them in snapshots',async()=>{
 const {validTarget}=await vite.ssrLoadModule('/app/lukas/components/drawing-review-loop.tsx');
 const shape={id:'path',name:'경로',kind:'폴리라인',page:1,x:100,y:100,width:200,height:120,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:'',points:[{x:0,y:0},{x:140,y:0},{x:140,y:90}]};
 assert.equal(validTarget(shape),true);
 for(const points of [undefined,[],[{x:0,y:0}],Array(257).fill({x:0,y:0}),[{x:0,y:0},{x:141,y:90}],[{x:0,y:0},{x:140,y:NaN}]])assert.equal(validTarget({...shape,points}),false);
 const {drawingChangeItems}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx');
 assert.deepEqual(JSON.parse(drawingChangeItems([shape],false)[0].sourceState).points,shape.points);
});
test('resized screen rectangles validate their frame and retain it in review locations',async()=>{
 const {validTarget}=await vite.ssrLoadModule('/app/lukas/components/drawing-review-loop.tsx');
 const {drawingChangeItems}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx');
 const shape={id:'size',name:'영역',kind:'사각형',page:1,x:100,y:100,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:'',width:280,height:180};
 for(const width of [0,-1,1001,'280',NaN])assert.equal(validTarget({...shape,width}),false);
 for(const height of [0,-1,701,'180',NaN])assert.equal(validTarget({...shape,height}),false);
 assert.equal(validTarget(shape),true);
 const [item]=drawingChangeItems([shape],false);
 assert.equal(item.width,280);assert.equal(item.height,180);
 const {DrawingChangePins}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx');
 const html=renderToStaticMarkup(React.createElement(DrawingChangePins,{items:drawingChangeItems([{...shape,rotation:90}],false),selected:shape.id,page:1,onSelect(){},highlight:true}));
 assert.match(html,/class="change-region"[^>]*style="transform:rotate\(90deg\)/);
 const {parseChangeRequestStorage}=await vite.ssrLoadModule('/app/lukas/lib/drawing-change-request-storage.ts');
 const raw=rotation=>JSON.stringify({schemaVersion:1,requests:[{round:1,message:'크기 확인',items:[{...item,rotation}],decisions:{}}]});
 assert.equal(parseChangeRequestStorage(raw(90))[0].items[0].rotation,90);
 for(const value of [-1,360,'90',null])assert.throws(()=>parseChangeRequestStorage(raw(value)));
});
test('rotation is validated and renders in the recorded drawing object',async()=>{
 const {validTarget}=await vite.ssrLoadModule('/app/lukas/components/drawing-review-loop.tsx');
 const {DrawingScreenObjectPreview}=await vite.ssrLoadModule('/app/lukas/components/drawing-screen-object-preview.tsx');
 const shape={id:'rotate',name:'회전 벽',kind:'사각형',page:1,x:100,y:100,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
 for(const rotation of [-1,360,NaN,Infinity,'90',null])assert.equal(validTarget({...shape,rotation}),false);
 assert.equal(validTarget(shape),true);
 assert.equal(validTarget({...shape,rotation:90}),true);
 const html=renderToStaticMarkup(React.createElement(DrawingScreenObjectPreview,{objects:[{...shape,rotation:90}],selected:null,tool:'',onCreate(){},onSelect(){}}));
 assert.match(html,/rotate\(90 70 45\)/);
 const {compareDrawingRequestSnapshots}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-request-preview.tsx');
 const snapshot={documentName:'회전 도면',pageCount:1,objects:[shape],layers:[{id:'review',name:'검토',visible:true,locked:false}]};
 assert.equal(compareDrawingRequestSnapshots(snapshot,{...snapshot,objects:[{...shape,rotation:90}]}).modified.length,1);
});
test('screen block records retain an allowlisted symbol and reject unknown definitions',async()=>{
 const {validTarget}=await vite.ssrLoadModule('/app/lukas/components/drawing-review-loop.tsx');
 const shape={id:'block-1',name:'회의 테이블',kind:'블록',blockCode:'F-01',page:1,x:10,y:20,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
 assert.equal(validTarget(shape),true);
 for(const blockCode of [undefined,'unknown','<svg>',null])assert.equal(validTarget({...shape,blockCode}),false);
 assert.equal(validTarget({...shape,kind:'사각형'}),false);
});
test('approved request distinguishes requested objects from the remaining drawing approval scope',async()=>{
 const {DrawingChangeRequestPreview}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-request-preview.tsx');
 const shape={id:'a',name:'요청한 벽',kind:'사각형',page:1,x:10,y:20,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
 const snapshot={documentName:'검토 도면',pageCount:2,objects:[shape,{...shape,id:'b',name:'미요청 창',page:2}],layers:[{id:'review',name:'검토',visible:true,locked:false}]};
 const item={id:'a',title:'요청한 벽',kind:'added',page:1,x:10,y:20,width:30,height:40,author:'나',summary:'표시',before:'없음',after:'벽',sample:false};
 const request={round:1,drawingRevision:1,message:'벽 확인',items:[item],decisions:{a:{kind:'checked',note:''}},approval:{note:'확인',at:'2026-09-10T00:00:00Z'},snapshot};
 const props={requests:[request],active:1,visible:true,viewer:false,available:['a','b'],currentItems:[item],currentSnapshot:snapshot,currentDrawingRevision:1,onActive(){},onDecision(){},onLocate(){},onReconfigure(){},onClose(){},onApprove(){}};
 const html=renderToStaticMarkup(React.createElement(DrawingChangeRequestPreview,props));
 assert.match(html,/aria-label="도면 개정 승인 전 범위 확인"/);
 assert.match(html,/요청 범위 밖 도형 · 1개/);
 assert.match(html,/미요청 창/);
 assert.match(html,/전체 도면 승인은 아직 이루어지지 않았습니다/);
 for(const guard of [{viewer:true},{currentItems:[]}]){
  const guarded=renderToStaticMarkup(React.createElement(DrawingChangeRequestPreview,{...props,...guard}));
  assert.match(guarded,/<button[^>]*disabled=""[^>]*>전체 화면 도형으로 새 요청 구성<\/button>/);
 }
 const pending=renderToStaticMarkup(React.createElement(DrawingChangeRequestPreview,{...props,requests:[{...request,approval:undefined}]}));
 assert.doesNotMatch(pending,/aria-label="도면 개정 승인 전 범위 확인"/);
});
test('request revision provenance survives storage and prevents confirmation against another revision',async()=>{
 const {canApproveChangeRequest}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-request-preview.tsx');
 const {parseChangeRequestStorage}=await vite.ssrLoadModule('/app/lukas/lib/drawing-change-request-storage.ts');
 const item={id:'a',title:'영역',kind:'added',page:1,x:10,y:10,width:100,height:50,author:'나',summary:'추가',before:'없음',after:'영역',sample:false};
 const request={round:7,drawingRevision:2,message:'검토',items:[item],decisions:{a:{kind:'checked',note:''}}};
 assert.equal(canApproveChangeRequest(request,[item],undefined,2),true);
 assert.equal(canApproveChangeRequest(request,[item],undefined,3),false);
 assert.equal(canApproveChangeRequest(request,[item],undefined,undefined),false);
 const raw=value=>JSON.stringify({schemaVersion:1,requests:[value]});
 assert.equal(parseChangeRequestStorage(raw(request))[0].drawingRevision,2);
 const {drawingRevision,...legacy}=request;
 assert.equal(parseChangeRequestStorage(raw(legacy))[0].drawingRevision,undefined);
 for(const bad of [0,-1,1.5,'2',null])assert.throws(()=>parseChangeRequestStorage(raw({...request,drawingRevision:bad})));
});
test('request drawing comparison separates added modified removed and context changes',async()=>{
 const {compareDrawingRequestSnapshots}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-request-preview.tsx');
 assert.equal(typeof compareDrawingRequestSnapshots,'function');
 const shape={id:'a',kind:'사각형',page:1,x:10,y:20,name:'벽',layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
 const before={documentName:'기록',pageCount:1,objects:[shape,{...shape,id:'gone'}],layers:[{id:'review',name:'검토',visible:true,locked:false}],source:{kind:'office',paper:'A3'}};
 const after={...before,objects:[{...shape,x:40},{...shape,id:'new'}],layers:[{...before.layers[0],visible:false}],source:{kind:'house',paper:'A3'}};
 const result=compareDrawingRequestSnapshots(before,after);
 assert.deepEqual(result.added.map(value=>value.id),['new']);
 assert.deepEqual(result.modified.map(value=>value.id),['a']);
 assert.deepEqual(result.removed.map(value=>value.id),['gone']);
 assert.equal(result.layersChanged,true);assert.equal(result.sourceChanged,true);assert.equal(result.documentChanged,false);
 assert.equal(compareDrawingRequestSnapshots(before,undefined),null);
 const same=compareDrawingRequestSnapshots(before,structuredClone(before));
 assert.deepEqual([same.added,same.modified,same.removed],[[],[],[]]);
 assert.equal(same.layersChanged,false);assert.equal(same.sourceChanged,false);
});
test('request snapshot rejects invalid geometry or missing layer references',async()=>{
 const {parseChangeRequestStorage}=await vite.ssrLoadModule('/app/lukas/lib/drawing-change-request-storage.ts');
 const shape={id:'one',kind:'사각형',page:1,x:100,y:200,name:'기록 영역',layer:'one',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
 const snapshot={documentName:'기록 도면',pageCount:1,objects:[shape],layers:[{id:'one',name:'작성',visible:true,locked:false}]};
 const item={id:'one',title:'영역',kind:'added',page:1,x:100,y:200,width:140,height:90,author:'나',summary:'화면',before:'없음',after:'사각형',sample:false};
 const parse=value=>parseChangeRequestStorage(JSON.stringify({schemaVersion:1,requests:[{round:1,message:'검토',items:[item],decisions:{},snapshot:value}]}));
 assert.deepEqual(parse(snapshot)[0].snapshot,snapshot);
 const source={kind:'pdf',fileName:'기록.pdf',byteSize:200,fingerprint:'a'.repeat(64)};
 assert.deepEqual(parse({...snapshot,source})[0].snapshot.source,source);
 for(const invalid of [{...source,fingerprint:'bad'},{...source,byteSize:0},{kind:'url',url:'https://example.com'},{kind:'office',paper:'A0'}])assert.throws(()=>parse({...snapshot,source:invalid}));
 for(const bad of [{...snapshot,objects:[{...shape,x:-1}]},{...snapshot,objects:[{...shape,page:2}]},{...snapshot,layers:[]},{...snapshot,objects:[{...shape,layer:'missing'}]},{...snapshot,pageCount:0}])assert.throws(()=>parse(bad));
});
test('one input transaction undoes as a unit while later input stays separate',async()=>{
 const {screenObjectHistory}=await vite.ssrLoadModule('/app/lukas/lib/drawing-screen-object-history.ts');
 let state={past:[],present:[{id:'a',name:'원래 이름'}],future:[]};
 for(const name of ['회','회의','회의실'])state=screenObjectHistory(state,{type:'record',group:'name-focus-1',update:objects=>objects.map(object=>({...object,name}))});
 assert.equal(state.past.length,1);
 state=screenObjectHistory(state,{type:'undo'});assert.equal(state.present[0].name,'원래 이름');
 state=screenObjectHistory(state,{type:'redo'});assert.equal(state.present[0].name,'회의실');
 state=screenObjectHistory(state,{type:'record',group:'name-focus-2',update:objects=>objects.map(object=>({...object,name:'회의실 A'}))});
 state=screenObjectHistory(state,{type:'undo'});assert.equal(state.present[0].name,'회의실');
});
test('screen object history restores geometry and clears redo on a new edit',async()=>{
 const {screenObjectHistory,canRestoreScreenObjects}=await vite.ssrLoadModule('/app/lukas/lib/drawing-screen-object-history.ts');
 const shape={id:'a',layer:'draw',x:10};
 let state={past:[],present:[],future:[]};
 state=screenObjectHistory(state,{type:'record',update:()=>[shape]});
 state=screenObjectHistory(state,{type:'record',update:objects=>objects.map(object=>({...object,x:30}))});
 state=screenObjectHistory(state,{type:'undo'});assert.equal(state.present[0].x,10);
 state=screenObjectHistory(state,{type:'redo'});assert.equal(state.present[0].x,30);
 state=screenObjectHistory(state,{type:'undo'});
 state=screenObjectHistory(state,{type:'record',update:objects=>objects.map(object=>({...object,x:50}))});
 assert.equal(state.future.length,0);
 assert.equal(canRestoreScreenObjects(state.present,[shape],[{id:'draw',locked:false}],undefined),true);
 assert.equal(canRestoreScreenObjects(state.present,[shape],[{id:'draw',locked:true}],undefined),false);
 assert.equal(canRestoreScreenObjects(state.present,[],[{id:'draw',locked:false}],'a'),false);
 assert.equal(canRestoreScreenObjects(state.present,[shape],[{id:'draw',locked:false}],'a'),true);
 assert.equal(canRestoreScreenObjects(state.present,[shape],[],undefined),false);
 state=screenObjectHistory(state,{type:'reset',objects:[shape]});assert.equal(state.past.length,0);
});
test('conversation draft storage validates local notes without accepting corrupt state',async()=>{
 const {parseChangeConversation}=await vite.ssrLoadModule('/app/lukas/lib/drawing-change-conversation-storage.ts');
 const value={schemaVersion:1,drafts:{door:'작성 중'},notes:{door:[{text:'폭 확인',kind:'수정 요청'}]},noteKinds:{door:'의견'},checked:{door:true}};
 assert.deepEqual(parseChangeConversation(JSON.stringify(value)),value);
 const withRequest={...value,requestDraft:{message:'검토할 범위',mode:'selected',ids:['door']}};
 assert.deepEqual(parseChangeConversation(JSON.stringify(withRequest)),withRequest);
 for(const requestDraft of [{message:'확인',mode:'all',ids:[]},{message:'확인',mode:'selected',ids:['door','door']},{message:3,mode:'page',ids:[]}])assert.throws(()=>parseChangeConversation(JSON.stringify({...value,requestDraft})));
 for(const invalid of [{...value,schemaVersion:2},{...value,drafts:{door:3}},{...value,notes:{door:[{text:'의견',kind:'승인'}]}},{...value,checked:{door:'yes'}},{...value,noteKinds:null}])assert.throws(()=>parseChangeConversation(JSON.stringify(invalid)));
});
test('request approval requires every checked item to still match the frozen scope',async()=>{
 const {canApproveChangeRequest}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-request-preview.tsx');
 assert.equal(typeof canApproveChangeRequest,'function');
 const item={id:'a',title:'벽',kind:'added',page:1,x:10,y:20,width:30,height:40,author:'나',summary:'표시',before:'없음',after:'선',sample:false,sourceState:'original'};
 const request={round:1,message:'확인',items:[item],decisions:{a:{kind:'checked',note:''}}};
 assert.equal(canApproveChangeRequest(request,[{...item}]),true);
 for(const candidate of [{...request,decisions:{}},{...request,decisions:{a:{kind:'changes',note:'수정'}}},{...request,approval:{note:'완료',at:'2026-09-09T00:00:00.000Z'}}])assert.equal(canApproveChangeRequest(candidate,[item]),false);
 assert.equal(canApproveChangeRequest(request,[]),false);
 assert.equal(canApproveChangeRequest(request,[{...item,sourceState:'changed-color'}]),false);
 const {parseChangeRequestStorage}=await vite.ssrLoadModule('/app/lukas/lib/drawing-change-request-storage.ts');
 const approved={...request,approval:{note:'범위 확인',at:'2026-09-09T00:00:00.000Z'}};
 assert.deepEqual(parseChangeRequestStorage(JSON.stringify({schemaVersion:1,requests:[approved]})),[approved]);
 for(const invalid of [{...approved,decisions:{}},{...approved,approval:{note:'',at:'invalid'}},{...approved,approval:null}])assert.throws(()=>parseChangeRequestStorage(JSON.stringify({schemaVersion:1,requests:[invalid]})));
});
test('approval of a captured drawing refuses changes outside the requested items',async()=>{
 const {canApproveChangeRequest}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-request-preview.tsx');
 const item={id:'a',title:'벽',kind:'added',page:1,x:10,y:20,width:30,height:40,author:'나',summary:'표시',before:'없음',after:'선',sample:false};
 const snapshot={documentName:'도면',pageCount:1,objects:[],layers:[{id:'review',name:'검토',visible:true,locked:false}],source:{kind:'office',paper:'A3'}};
 const request={round:1,message:'확인',items:[item],decisions:{a:{kind:'checked',note:''}},snapshot};
 assert.equal(canApproveChangeRequest(request,[item],structuredClone(snapshot)),true);
 for(const changed of [undefined,{...snapshot,pageCount:2},{...snapshot,source:{kind:'house',paper:'A3'}},{...snapshot,layers:[{...snapshot.layers[0],visible:false}]},{...snapshot,objects:[{id:'new'}]}])assert.equal(canApproveChangeRequest(request,[item],changed),false);
});
test('review legend counts only the current page and pin preview exposes that change summary',async()=>{
 const {DrawingChangeLegend,DrawingChangePins}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx');
 assert.equal(typeof DrawingChangeLegend,'function');
 const base={id:'one',title:'문 위치',kind:'modified',page:1,x:20,y:30,width:40,height:50,author:'설계자',summary:'출입문을 통로 쪽으로 이동했습니다.',before:'이전 위치',after:'이동 위치',sample:false};
 const items=[base,{...base,id:'two',kind:'added'},{...base,id:'other-page',kind:'removed',page:2}];
 const html=renderToStaticMarkup(React.createElement(DrawingChangeLegend,{items,page:1}));
 assert.match(html,/수정 1/);assert.match(html,/추가 1/);assert.doesNotMatch(html,/삭제 1/);
 const empty=renderToStaticMarkup(React.createElement(DrawingChangeLegend,{items,page:3}));
 assert.match(empty,/이 페이지에 표시된 변경이 없습니다/);
 const pins=renderToStaticMarkup(React.createElement(DrawingChangePins,{items,selected:null,page:1,onSelect(){},highlight:true}));
 assert.match(pins,/출입문을 통로 쪽으로 이동했습니다/);
});
test('drawing drafts retain styles and layers while rejecting mixed sources and invalid references',async()=>{
 const {parseScreenDraft}=await vite.ssrLoadModule('/app/lukas/lib/drawing-screen-draft-storage.ts');
 const object={id:'shape-1',kind:'사각형',page:2,x:120,y:150,name:'검토 영역',layer:'review',color:'#112233',lineWidth:'0.50 mm',fill:'연한 회색',text:''};
 const layers=[{id:'review',name:'내 레이어',visible:false,locked:true}];
 const draft={schemaVersion:1,source:'pdf:A3',objects:[object],layers};
 assert.deepEqual(parseScreenDraft(JSON.stringify(draft),'pdf:A3'),{objects:[object],layers});
 assert.throws(()=>parseScreenDraft(JSON.stringify(draft),'office:A3'));
 for(const invalid of [null,{...draft,objects:[object,object]},{...draft,objects:[{...object,layer:'missing'}]},{...draft,layers:[]},{...draft,objects:[{...object,x:Infinity}]}])assert.throws(()=>parseScreenDraft(JSON.stringify(invalid),'pdf:A3'));
});
test('request storage rejects malformed snapshots and decisions outside the frozen scope',async()=>{
 const {parseChangeRequestStorage}=await vite.ssrLoadModule('/app/lukas/lib/drawing-change-request-storage.ts');
 const item={id:'a',title:'고정 항목',kind:'added',page:2,x:10,y:20,width:30,height:40,author:'나',summary:'설명',before:'없음',after:'추가',sample:false};
 const valid={schemaVersion:1,requests:[{round:1,message:'검토',items:[item],decisions:{a:{kind:'changes',note:'폭 확인'}}}]};
 assert.deepEqual(parseChangeRequestStorage(JSON.stringify(valid)),valid.requests);
 for(const invalid of [null,{}, {...valid,schemaVersion:2}, {...valid,requests:[{...valid.requests[0],items:[item,item]}]}, {...valid,requests:[{...valid.requests[0],decisions:{missing:{kind:'checked',note:''}}}]}, {...valid,requests:[{...valid.requests[0],decisions:{a:{kind:'changes',note:''}}}]}, {...valid,requests:[{...valid.requests[0],items:[{...item,page:0}]}]}])assert.throws(()=>parseChangeRequestStorage(JSON.stringify(invalid)));
});
test('nearby pins group in screen pixels without changing source positions or pages',async()=>{
 const {groupDrawingChanges,drawingChangeItems}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx');
 assert.equal(typeof groupDrawingChanges,'function');
 const base=drawingChangeItems([],true)[0];
 const items=[{...base,id:'a',x:100,y:100},{...base,id:'b',x:120,y:110},{...base,id:'c',x:900,y:100},{...base,id:'d',page:2,x:100,y:100}];
 const original=JSON.stringify(items);
 assert.deepEqual(groupDrawingChanges(items,1,1000,700).map(group=>group.map(item=>item.id)),[['a','b'],['c']]);
 assert.deepEqual(groupDrawingChanges(items,1,3000,2100).map(group=>group.map(item=>item.id)),[['a'],['b'],['c']]);
 assert.deepEqual(groupDrawingChanges(items,2,1000,700).map(group=>group.map(item=>item.id)),[['d']]);
 assert.equal(JSON.stringify(items),original);
});
test('locating a hidden layer reveals only that layer without unlocking or mutating it',async()=>{
 const {revealPreviewLayer}=await vite.ssrLoadModule('/app/lukas/components/drawing-document-preview.tsx');
 assert.equal(typeof revealPreviewLayer,'function');
 const layers=[{id:'a',name:'검토',visible:false,locked:true},{id:'b',name:'다른 영역',visible:false,locked:false}];
 const result=revealPreviewLayer(layers,'a');
 assert.deepEqual(result,[{id:'a',name:'검토',visible:true,locked:true},{id:'b',name:'다른 영역',visible:false,locked:false}]);
 assert.equal(layers[0].visible,false);
 assert.equal(revealPreviewLayer(layers,'missing'),layers);
 assert.equal(revealPreviewLayer(result,'a'),result);
});
test('change navigation enters at either end and wraps without skipping records',async()=>{
 const {nextDrawingChange}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx');
 assert.equal(typeof nextDrawingChange,'function');
 const items=[{id:'a'},{id:'b'},{id:'c'}];
 for(const [selected,direction,want] of [[null,-1,'c'],[null,1,'a'],['missing',-1,'c'],['a',-1,'c'],['c',1,'a'],['b',-1,'a']]){
  assert.equal(nextDrawingChange(items,selected,direction),want);
 }
 assert.equal(nextDrawingChange([],null,-1),null);
 assert.equal(nextDrawingChange([{id:'a'}],'a',1),'a');
});
test('page filtering preserves the same change number used in the list',async()=>{
 const {drawingChangeItems,DrawingChangePins}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx');
 const items=drawingChangeItems([],true).map((item,index)=>({...item,page:index===0?1:2}));
 const html=renderToStaticMarkup(React.createElement(DrawingChangePins,{items,page:2,selected:null,onSelect(){},highlight:true}));
 assert.match(html,/aria-label="추가 2 · 회의실 검토 영역 추가"/);
 assert.match(html,/aria-label="삭제 3 · 칸막이 철거 검토"/);
});
test('added change does not offer a previous area that cannot be displayed',async()=>{
 const {drawingChangeItems,DrawingChangePanel}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx');
 const items=drawingChangeItems([],true);
 const html=renderToStaticMarkup(React.createElement(DrawingChangePanel,{items,selected:items[1].id,mode:'review',viewer:false,page:1,compare:false,requesting:false,onSelect(){},onReview(){},onAuthor(){},onCompare(){},onRequest(){},onLegacyReview(){},hasReviewRecord:false}));
 assert.doesNotMatch(html,/<button[^>]*>[\s\S]*?이전 영역 함께 보기/);
});
test('workspace provides author and review modes without replacing the drawing surface',async()=>{
 const {DrawingPdfScreenPreview}=await vite.ssrLoadModule('/app/lukas/components/drawing-pdf-screen-preview.tsx');
 const html=renderToStaticMarkup(React.createElement(DrawingPdfScreenPreview,{startKind:'office'}));
 assert.match(html,/aria-label="작업 모드"/);
 assert.match(html,/aria-label="작성 모드"[^>]*aria-pressed="true"/);
 assert.match(html,/aria-label="검토 모드"/);
 assert.match(html,/office-plan.png/);
});
test('PDF entry does not invent template changes',async()=>{
 const {DrawingPdfScreenPreview}=await vite.ssrLoadModule('/app/lukas/components/drawing-pdf-screen-preview.tsx');
 const html=renderToStaticMarkup(React.createElement(DrawingPdfScreenPreview,{startKind:'pdf'}));
 assert.doesNotMatch(html,/sample-entrance|sample-meeting|sample-partition/);
});
test('change list and pins use the same actual object identity and do not mix samples',async()=>{
 const mod=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx').catch(()=>({}));
 assert.equal(typeof mod.drawingChangeItems,'function');
 const items=mod.drawingChangeItems([{id:'real-1',name:'내 영역',kind:'사각형',page:2,x:200,y:100,color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',layer:'review',text:''}],true);
 assert.equal(items.length,1);assert.equal(items[0].id,'real-1');assert.equal(items[0].page,2);
 assert.deepEqual(mod.drawingChangeItems([],false),[]);
 const html=renderToStaticMarkup(React.createElement(mod.DrawingChangePins,{items,selected:'real-1',page:2,onSelect(){},highlight:true}));
 assert.match(html,/data-change-pin="real-1"/);assert.match(html,/aria-pressed="true"/);
 const hidden=renderToStaticMarkup(React.createElement(mod.DrawingChangePins,{items,selected:'real-1',page:1,onSelect(){},highlight:true}));
 assert.doesNotMatch(hidden,/data-change-pin=/);
});
test('Viewer can inspect a selected change but cannot write comments or mark it checked',async()=>{
 const {drawingChangeItems,DrawingChangePanel}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-preview.tsx');
 const items=drawingChangeItems([],true);
 const html=renderToStaticMarkup(React.createElement(DrawingChangePanel,{items,selected:items[0].id,mode:'review',viewer:true,page:1,compare:false,requesting:false,onSelect(){},onReview(){},onAuthor(){},onCompare(){},onRequest(){},onLegacyReview(){},hasReviewRecord:false}));
 assert.match(html,/data-change-detail="sample-entrance"/);
 assert.doesNotMatch(html,/<h2>변경 상세<\/h2>/);
 assert.match(html,/<textarea[^>]*aria-label="이 위치에 의견 남기기"[^>]*disabled/);
 assert.match(html,/<button[^>]*disabled[^>]*>[\s\S]*?화면에 추가/);
 assert.doesNotMatch(html,/최종 승인하기/);
});
