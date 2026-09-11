import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});test.after(()=>vite.close());
test('civil template creates independent schematic alignment and work zones without engineering evidence',async()=>{
 const {createWorkflowTemplateDocument}=await vite.ssrLoadModule('/app/lukas/lib/workflow-blank-document.ts');
 const a=createWorkflowTemplateDocument('civil','a','토목 검토'),b=createWorkflowTemplateDocument('civil','b','다른 검토');assert.ok(a);assert.equal(a.shapes.length,4);assert.equal(a.shapes[0].kind,'polyline');assert.equal(a.shapes[0].points.length,3);assert.ok(a.shapes.some(shape=>shape.label==='검측 구간'));
 assert.ok(a.shapes[0].points.every(point=>point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1));
 assert.equal(a.source,undefined);assert.equal(a.reviewRounds,undefined);assert.ok(a.shapes.every(shape=>!shape.quantity));a.shapes[0].points[0].x=99;assert.equal(b.shapes[0].points[0].x,0);assert.notEqual(a.shapes[0].id,b.shapes[0].id);
});
