import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
test('PDF memory cache is bounded, least-recently used and explicitly forgettable',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
 try{
 const {rememberWorkflowPdf:put,recalledWorkflowPdf:get,forgetWorkflowPdf:forget}=await vite.ssrLoadModule('/app/lukas/lib/workflow-pdf-session.ts');
 const hashes=['a','b','c','d'].map(x=>x.repeat(64));
 for(const hash of hashes.slice(0,3))put(hash,new File(['pdf'],`${hash[0]}.pdf`));
 assert.equal(get(hashes[0]).name,'a.pdf');put(hashes[3],new File(['d'],'d.pdf'));assert.equal(get(hashes[1]),null);
 forget(hashes[0]);assert.equal(get(hashes[0]),null);
 // Structural file fixture exercises byte accounting without allocating huge buffers.
 put(hashes[0],{name:'large.pdf',size:64*1024*1024});assert.equal(get(hashes[2]),null);assert.equal(get(hashes[3]),null);
 put(hashes[1],{size:65*1024*1024});assert.equal(get(hashes[1]),null);
 put('invalid',new File(['bad'],'bad.pdf'));assert.equal(get('invalid'),null);
 }finally{await vite.close();}
});
