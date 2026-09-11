import test from 'node:test';
import assert from 'node:assert/strict';
test('PDF reference measurement uses page aspect and rejects degenerate or invalid calibration',async()=>{
 const {previewDistance}=await import('../app/lukas/lib/workflow-measurement.ts');
 const reference=[{x:0,y:0},{x:0.5,y:0}];
 assert.equal(previewDistance(reference,[{x:0,y:0},{x:0,y:0.5}],10,2),5);
 assert.equal(previewDistance(reference,[{x:0,y:0},{x:0.25,y:0}],10,2),5);
 assert.equal(previewDistance([reference[0],reference[0]],reference,10,2),null);
 assert.equal(previewDistance(reference,reference,0,2),null);
 assert.equal(previewDistance(reference,reference,10,NaN),null);
});
test('path and polygon previews use calibration and reject crossing or degenerate areas',async()=>{
 const {previewMeasure}=await import('../app/lukas/lib/workflow-measurement.ts');
 const reference=[{x:0,y:0},{x:.5,y:0}];
 const rectangle=[{x:0,y:0},{x:.5,y:0},{x:.5,y:.5},{x:0,y:.5}];
 assert.equal(previewMeasure('path',reference,rectangle.slice(0,3),10,2),15);
 assert.equal(previewMeasure('area',reference,rectangle,10,2),50);
 assert.equal(previewMeasure('area',reference,[...rectangle].reverse(),10,2),50);
 assert.equal(previewMeasure('area',reference,[rectangle[0],rectangle[2],rectangle[1],rectangle[3]],10,2),null);
 assert.equal(previewMeasure('area',reference,[{x:0,y:0},{x:.2,y:0},{x:.4,y:0}],10,2),null);
 assert.equal(previewMeasure('path',reference,[{x:0,y:0}],10,2),null);
 assert.equal(previewMeasure('path',reference,[{x:0,y:0},{x:.5,y:0},{x:0,y:0}],1e308,2),null);
});
