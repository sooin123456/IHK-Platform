import assert from 'node:assert/strict';import test from 'node:test';import {createServer} from 'vite';
test('saved page templates strip evidence and create independent editable documents through session restore',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-saved-templates.ts');
 const doc={id:'source',title:'원본',source:{name:'a.pdf',sha256:'a'.repeat(64),pages:2},revision:4,layers:[{id:'default',name:'도형',visible:true,locked:false}],shapes:[{id:'first',label:'다른 쪽',x:0,y:0},{id:'second',label:'배관',page:2,x:40,y:50,kind:'polyline',width:100,height:80,points:[{x:0,y:0},{x:1,y:1}],quantity:{raw:999}}]};
 const template=m.captureDrawingTemplate(doc,'template','배관 표준',2);assert.equal(template.shapes.length,1);assert.equal(template.shapes[0].page,1);assert.equal(template.shapes[0].quantity,undefined);assert.equal(template.source,undefined);assert.equal(template.revision,undefined);
 const a=m.instantiateDrawingTemplate(template,'copy-a','첫 작업'),b=m.instantiateDrawingTemplate(template,'copy-b','둘째 작업');assert.notEqual(a.shapes[0].id,b.shapes[0].id);a.shapes[0].points[0].x=.5;a.layers[0].name='변경';assert.equal(template.shapes[0].points[0].x,0);assert.equal(b.layers[0].name,'도형');assert.equal(a.reviewRounds,undefined);
 const codec=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype-session.ts'),{createWorkflow}=await vite.ssrLoadModule('/app/lukas/lib/workflow-prototype.ts');const raw=codec.encodeWorkflowSession({scenarios:Object.fromEntries(['architecture','ifc','civil'].map(s=>[s,createWorkflow(s)])),drafts:{},savedTemplates:[template]});assert.deepEqual(codec.decodeWorkflowSession(raw).savedTemplates,[template]);
 const invalid=JSON.parse(raw);invalid.savedTemplates[0].shapes[0].quantity={raw:999};assert.equal(codec.decodeWorkflowSession(JSON.stringify(invalid)),null);
 assert.equal(m.captureDrawingTemplate(doc,'t','',2),null);assert.equal(m.captureDrawingTemplate(doc,'t','이름',3),null);
 }finally{await vite.close();}
});
