import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});test.after(()=>vite.close());
test('pending imports resume by identity without overwriting verified documents',async()=>{
 const {appendImportRecords,importManifestSchema}=await vite.ssrLoadModule('/app/lukas/lib/workflow-import-manifest.ts');
 const pending={id:'p',name:'a.pdf',size:12,format:'PDF',status:'pending'};assert.equal(importManifestSchema.safeParse(pending).success,true);
 const ready={...pending,status:'ready',sha256:'a'.repeat(64),pages:1};assert.deepEqual(appendImportRecords([pending],[ready]),[ready]);
 assert.deepEqual(appendImportRecords([ready],[pending]),[ready]);
 assert.deepEqual(appendImportRecords([pending],[{...ready,name:'b.pdf'}]),[pending]);
 const hashed={...pending,sha256:'b'.repeat(64)};assert.deepEqual(appendImportRecords([hashed],[ready]),[hashed]);
 const failed={...pending,status:'failed'};assert.deepEqual(appendImportRecords([failed],[pending]),[pending]);
 assert.deepEqual(appendImportRecords([ready,{...pending,id:'q'}],[{...ready,id:'q'}]),[ready]);
});
test('file manifest distinguishes actual PDF readiness from unsupported CAD/BIM engines',async()=>{
 const {importManifestSchema,appendImportRecords,documentFromImport}=await vite.ssrLoadModule('/app/lukas/lib/workflow-import-manifest.ts');
 const pdf={id:'a',name:'구조.pdf',size:12,sha256:'a'.repeat(64),format:'PDF',status:'ready',pages:2};
 assert.equal(importManifestSchema.safeParse(pdf).success,true);
 assert.equal(importManifestSchema.safeParse({...pdf,format:'DWG'}).success,false);
 assert.equal(importManifestSchema.safeParse({...pdf,pages:undefined}).success,false);
 assert.deepEqual(appendImportRecords([pdf],[{...pdf,id:'b'}]),[pdf]);
 const dwg={id:'b',name:'구조.dwg',size:10,sha256:'b'.repeat(64),format:'DWG',status:'needs-engine'};
 assert.equal(documentFromImport(dwg,'d'),null);
 assert.deepEqual(documentFromImport(pdf,'d'),{id:'d',title:'구조.pdf',source:{name:'구조.pdf',sha256:'a'.repeat(64),pages:2},page:1,revision:1,shapes:[]});
});
