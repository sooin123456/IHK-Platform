import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('supporting-file drafts keep bounded raw metadata and verified cache rejects wrong bytes and evicts old originals',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-supporting-files.ts');
  const meta={name:'"\\'.repeat(240)+'.txt',sha256:'c'.repeat(64),size:100},patch=m.supportingFileDraftPatch([meta],'a');
  assert.ok(Object.values(patch).every(value=>value.length<=500));assert.deepEqual(m.readSupportingFileDraft(JSON.parse(JSON.stringify(patch)),'a'),[meta]);assert.deepEqual(m.readSupportingFileDraft(patch,'b'),[]);assert.deepEqual(m.readSupportingFileDraft({...patch,...m.supportingFileDraftPatch([],'a')},'a'),[]);
  const actual=await m.inspectSupportingFile(new File(['verified original'],'calculation.txt'));await assert.rejects(()=>m.inspectSupportingFile(new File(['wrong bytes'],'calculation.txt'),actual),/내용이 다릅니다/);assert.equal(await m.recallSupportingFile(actual.sha256).text(),'verified original');
  await assert.rejects(()=>m.inspectSupportingFile(new File(['binary'],'program.exe')),/지원하는 보조 자료/);
  for(let index=0;index<10;index++)await m.inspectSupportingFile(new File([String(index)],`${index}.txt`));assert.equal(m.recallSupportingFile(actual.sha256),null);
 }finally{await vite.close();}
});
test('supporting file metadata survives drafts and submissions; acceptance requires verified originals',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const m=await vite.ssrLoadModule('/app/lukas/lib/workflow-submittals.ts');
  const file={name:'검토 계산서.xlsx',sha256:'a'.repeat(64),size:100};const doc={id:'d',title:'검토도',shapes:[]};
  const submitted=m.submitDrawing(doc,'author',{title:'시공도 검토',due:'2026-09-30',assignee:'reviewer',message:'계산서 포함',supportingFiles:[file]});
  assert.deepEqual(submitted.submittals[0].supportingFiles,[file]);assert.equal(m.decideSubmittal(submitted,1,'reviewer','accepted','확인'),submitted);
  assert.equal(m.decideSubmittal(submitted,1,'reviewer','accepted','확인',[],['b'.repeat(64)]),submitted);
  assert.equal(m.decideSubmittal(submitted,1,'reviewer','accepted','확인',[],[file.sha256]).submittals[0].phase,'accepted');
 }finally{await vite.close();}
});
