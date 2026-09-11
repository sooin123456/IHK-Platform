import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});test.after(()=>vite.close());
test('layer-only changes are separate from geometry and use the historical layer snapshot',async()=>{
 const {compareDrawingObjects}=await vite.ssrLoadModule('/app/lukas/lib/workflow-drawing-comparison.ts');
 const source={name:'a.pdf',sha256:'a'.repeat(64),pages:1};const shapes=[{id:'a',label:'벽',x:10,y:10}];
 const baseline=[{id:'default',name:'기본',visible:true,locked:false},{id:'old',name:'제거',visible:true,locked:false}];
 const layers=[{id:'new',name:'추가',visible:true,locked:false},{id:'default',name:'구조',visible:false,locked:true}];
 const doc={source,shapes,layers:baseline,reviewRounds:[{phase:'approved',revision:1,source,objects:shapes,layers:baseline},{phase:'approved',revision:2,source,objects:shapes,layers}]};
 const result=compareDrawingObjects(doc,1,2);assert.equal(result.rows[0].kind,'same');
 assert.deepEqual(result.layerRows.map(row=>[row.id,row.kind]),[['default','changed'],['old','removed'],['new','added']]);
 assert.deepEqual(result.layerRows[0].changes,['name','visible','locked','order']);
 assert.equal(compareDrawingObjects(doc,1).layerRows.every(row=>row.kind==='same'),true);
 const legacy={...doc,layers:undefined,reviewRounds:[{phase:'approved',revision:1,source,objects:shapes}]};
 assert.equal(compareDrawingObjects(legacy,1).layerRows[0].kind,'same');
});
test('historical drawing comparison uses the selected approved target instead of the live document',async()=>{
 const {compareDrawingObjects}=await vite.ssrLoadModule('/app/lukas/lib/workflow-drawing-comparison.ts');
 const source={name:'source.pdf',sha256:'a'.repeat(64),pages:1};
 const doc={id:'d',source:{...source,sha256:'b'.repeat(64)},shapes:[{id:'live',x:900,y:900}],reviewRounds:[{revision:1,phase:'approved',source,objects:[{id:'wall',label:'벽',x:10,y:10}]},{revision:2,phase:'approved',source,objects:[{id:'wall',label:'벽',x:30,y:10}]},{revision:3,phase:'review',source,objects:[]}]};
 const result=compareDrawingObjects(doc,1,2);
 assert.equal(result.compatible,true);assert.equal(result.target.revision,2);
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].kind,'changed');assert.equal(result.rows[0].after.x,30);
 assert.equal(compareDrawingObjects(doc,1,3),null);assert.equal(compareDrawingObjects(doc,1,99),null);
 assert.equal(compareDrawingObjects(doc,1,1).rows[0].kind,'same');
 assert.equal(compareDrawingObjects(doc,1).compatible,false);
 assert.equal(doc.shapes[0].id,'live');
});
