import assert from 'node:assert/strict';import test from 'node:test';import {createServer} from 'vite';
test('transmittal register keeps superseded records and separates document-local sequence identities',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
 const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-transmittals.ts');
 const round={revision:1,phase:'approved',source:{name:'원본.pdf'},objects:[]};
 const documents=[{id:'a',title:'건축도',reviewRounds:[round],deliveryHistory:[{sequence:1,revision:1,recipient:'감리',status:'received'}],delivery:{sequence:2,revision:1,recipient:'발주처',status:'prepared'}},{id:'b',title:'토목도',reviewRounds:[round],delivery:{sequence:1,revision:1,recipient:'감리',status:'prepared',linkStatus:'expired'}}];
 const rows=m.transmittalRows(documents);assert.equal(rows.length,3);assert.equal(new Set(rows.map(row=>row.key)).size,3);
 assert.equal(rows.find(row=>row.document.id==='a'&&row.delivery.sequence===1).available,false);
 assert.equal(rows.find(row=>row.document.id==='a'&&row.delivery.sequence===2).available,true);
 assert.equal(rows.find(row=>row.document.id==='b').available,false);
 assert.equal(m.filterTransmittals(rows,'감리','all').length,2);
 assert.equal(m.filterTransmittals(rows,'','waiting').length,1);
 assert.equal(m.filterTransmittals(rows,'','history').length,1);
 assert.deepEqual(m.filterTransmittals(rows,'','unknown'),[]);
 }finally{await vite.close();}
});
