import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';import {unzipSync,strFromU8} from 'fflate';import {createHash} from 'node:crypto';
test('handover archive includes exact frozen metadata and deduplicated originals, rejects missing or wrong bytes',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const {createHandoverArchive}=await vite.ssrLoadModule('/app/lukas/lib/workflow-handover-export.ts');
  const bytes=Buffer.from('original maintenance manual'),sha256=createHash('sha256').update(bytes).digest('hex'),file=new File([bytes],'manual.txt');
  const meta={name:'../../manual.txt',size:bytes.length,sha256},item={id:2,revision:1,recipient:'시설팀',phase:'received',feedback:'확인',assets:[{objectId:'pump',name:'당시 펌프',manualFiles:[meta]},{objectId:'pipe',name:'당시 배관',manualFiles:[meta]}]};
  await assert.rejects(createHandoverArchive('doc',item,[]),/원본/);
  await assert.rejects(createHandoverArchive('doc',item,[new File(['wrong'],'manual.txt')]),/원본/);
  const zip=unzipSync(await createHandoverArchive('doc',item,[file]));
  assert.equal(Object.keys(zip).length,3);assert.ok(Object.keys(zip).every(path=>!path.includes('..')));
  const manifest=JSON.parse(strFromU8(zip['handover.json']));assert.equal(manifest.simulated,true);assert.equal(manifest.includesDrawingOriginal,false);assert.equal(manifest.documentId,'doc');assert.deepEqual(manifest.handover,item);assert.equal(manifest.manuals.length,1);assert.equal(manifest.manuals[0].originalName,'../../manual.txt');assert.deepEqual(Buffer.from(zip[manifest.manuals[0].path]),bytes);
 }finally{await vite.close();}
});
