import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
const vite=await createServer({appType:'custom',configFile:false,logLevel:'silent',server:{middlewareMode:true}});
const {moveScreenSelection,initialScreenShapeStyle}=await vite.ssrLoadModule('/app/lukas/components/drawing-screen-object-preview.tsx');
test.after(()=>vite.close());
const objects=[{...initialScreenShapeStyle,id:'a',kind:'사각형',page:1,x:100,y:200},{...initialScreenShapeStyle,id:'b',kind:'원',page:1,x:950,y:650},{...initialScreenShapeStyle,id:'c',kind:'선',page:2,x:50,y:50}];
test('group movement clamps one shared delta and preserves spacing at both boundaries',()=>{
 const before=structuredClone(objects);
 const right=moveScreenSelection(objects,['a','b'],'a',400,400);
 assert.deepEqual(right.map(({x,y})=>({x,y})),[{x:150,y:250},{x:1000,y:700},{x:50,y:50}]);
 const left=moveScreenSelection(objects,['a','b'],'b',0,0);
 assert.deepEqual(left.map(({x,y})=>({x,y})),[{x:0,y:0},{x:850,y:450},{x:50,y:50}]);
 assert.equal(right[2],objects[2]);assert.deepEqual(objects,before);
});
test('no movement or invalid anchor does not create a replacement history state',()=>{
 for(const [ids,id,x,y] of [[['a'],'a',100,200],[[],'a',200,200],[['b'],'a',200,200],[['a'],'a',NaN,200],[['a'],'a',200,Infinity]])assert.equal(moveScreenSelection(objects,ids,id,x,y),objects);
});
