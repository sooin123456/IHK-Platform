import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});test.after(()=>vite.close());
test('mapped CSV preserves quoted fields and refuses missing or duplicated column assignments',async()=>{
 const {mapPriceBookCsv,previewPriceBookCsv}=await vite.ssrLoadModule('/app/lukas/lib/workflow-pricebook.ts');
 const text='금액,설명,번호,근거,단위,비고\n1200,"배관, 일반",P-01,"견적\n1쪽",m,제외';
 const mapping=[2,1,4,0,3];const result=mapPriceBookCsv(text,mapping);assert.equal(result.errors.length,0);
 const parsed=previewPriceBookCsv(result.csv,[]);assert.equal(parsed.errors.length,0);assert.equal(parsed.entries[0].name,'배관, 일반');assert.equal(parsed.entries[0].source,'견적\n1쪽');assert.equal(parsed.entries[0].rate,1200);
 assert.ok(mapPriceBookCsv(text,[2,1,4,0,0]).errors.length);assert.ok(mapPriceBookCsv(text,[2,1,-1,0,3]).errors.length);assert.ok(mapPriceBookCsv(text,[2,1,99,0,3]).errors.length);
 assert.ok(mapPriceBookCsv('a,b\n"broken',mapping).errors.length);
});
