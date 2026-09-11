import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createServer} from 'vite';
import {fileURLToPath} from 'node:url';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',resolve:{alias:{'~':fileURLToPath(new URL('../app',import.meta.url))}},server:{middlewareMode:true}});
test.after(()=>vite.close());
const {DrawingObjectPropertiesRecord}=await vite.ssrLoadModule('/app/lukas/components/drawing-object-properties-record');
const shape={id:'a',kind:'사각형',page:1,x:100,y:100,name:'벽',layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
const before={...shape,properties:{classification:'구조',code:'OLD',note:'<script>',required:true}};
const after={...shape,properties:{classification:'건축 마감',code:'NEW',note:'메모',required:false}};
test('property removal is shown as unregistered rather than an empty or approved state',()=>{
 const html=renderToStaticMarkup(React.createElement(DrawingObjectPropertiesRecord,{object:shape,before}));
 assert.match(html,/OLD → 미등록/);assert.match(html,/있음 → 미등록/);assert.match(html,/&lt;script&gt;/);
 assert.equal(renderToStaticMarkup(React.createElement(DrawingObjectPropertiesRecord,{object:shape})), '');
});
test('comparison pane displays the selected snapshot metadata without borrowing current data',async()=>{
 const {DrawingSnapshotComparisonPane}=await vite.ssrLoadModule('/app/lukas/components/drawing-snapshot-comparison');
 const snapshot={documentName:'기록',pageCount:1,objects:[before],layers:[{id:'review',name:'검토',visible:true,locked:false}]};
 const html=renderToStaticMarkup(React.createElement(DrawingSnapshotComparisonPane,{label:'요청 당시',snapshot,page:1,selected:'a',onSelect(){}}));
 assert.match(html,/OLD/);assert.doesNotMatch(html,/NEW/);assert.match(html,/&lt;script&gt;/);
 const absent=renderToStaticMarkup(React.createElement(DrawingSnapshotComparisonPane,{label:'현재',snapshot:{...snapshot,objects:[shape]},page:1,selected:'a',onSelect(){}}));
 assert.match(absent,/미등록/);
});
test('request comparison displays frozen and current property values separately',async()=>{
 const {DrawingChangeRequestPreview}=await vite.ssrLoadModule('/app/lukas/components/drawing-change-request-preview');
 const item={id:'a',title:'벽',kind:'added',page:1,x:100,y:100,width:140,height:90,author:'나',summary:'표시',before:'없음',after:'사각형',sample:false};
 const snapshot={documentName:'기록',pageCount:1,objects:[before],layers:[{id:'review',name:'검토',visible:true,locked:false}]};
 const html=renderToStaticMarkup(React.createElement(DrawingChangeRequestPreview,{requests:[{round:1,message:'검토',items:[item],decisions:{},snapshot}],active:1,viewer:true,available:['a'],visible:true,currentItems:[item],currentSnapshot:{...snapshot,objects:[after]},onActive(){},onDecision(){},onLocate(){},onReconfigure(){},onClose(){},onApprove(){}}));
 assert.match(html,/OLD → NEW/);assert.match(html,/구조 → 건축 마감/);assert.match(html,/있음 → 없음/);
});
