import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});test.after(()=>vite.close());
test('BOQ groups keep unit/rate separate and exclude stale or unlinked evidence from totals',async()=>{
 const {groupDocumentBoq}=await vite.ssrLoadModule('/app/lukas/lib/workflow-boq-groups.ts');
 const {setDocumentQuantity}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-quantity.ts');
 let doc={id:'d',title:'구조',source:{name:'a.pdf',sha256:'a'.repeat(64),pages:1},shapes:['a','b','c','d','e'].map((id,i)=>({id,label:id,x:i*20,y:10}))};
 for(const [id,raw,unit,rate] of [['a',2,'m',100],['b',3,'m',100],['c',4,'m²',100],['d',5,'m',200]])doc=setDocumentQuantity(doc,id,{raw,correction:0,unit,rate,reason:'확인',rateSource:{code:'TEST',name:'배관',source:'로컬 예시',version:1,unit,rate}});
 const result=groupDocumentBoq([doc]);assert.equal(result.groups.length,3);assert.equal(result.total,1900);assert.equal(result.missing,1);assert.equal(result.groups[0].quantity,5);assert.equal(result.groups[0].amount,500);assert.deepEqual(result.groups[0].items.map(item=>item.shape.id),['a','b']);
 const stale={...doc,shapes:doc.shapes.map(shape=>shape.id==='a'?{...shape,x:200}:shape)};const changed=groupDocumentBoq([stale]);assert.equal(changed.stale,1);assert.equal(changed.total,1700);assert.equal(changed.groups[0].quantity,3);
 assert.equal(doc.shapes[0].x,0);
 const differentVersion={...doc,shapes:doc.shapes.map(shape=>shape.id==='b'?{...shape,quantity:{...shape.quantity,rateSource:{...shape.quantity.rateSource,version:2}}}:shape)};
 assert.equal(groupDocumentBoq([differentVersion]).groups.length,4);
 const manual={...doc,shapes:doc.shapes.map(shape=>shape.quantity?{...shape,quantity:{...shape.quantity,rateSource:undefined}}:shape)};
 assert.equal(groupDocumentBoq([manual]).groups.length,4);
});
