import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'vite';
test('object comments preserve target context and do not modify drawing approval',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});
 try{
 const {addObjectComment,commentMatches}=await vite.ssrLoadModule('/app/lukas/lib/workflow-document-comments.ts');
 const doc={id:'d',title:'도면',revision:2,shapes:[{id:'a',label:'벽',x:10,y:20,page:1}],reviewRounds:[]};
 const next=addObjectComment(doc,'a','reviewer','위치 확인 부탁합니다');
 assert.equal(next.objectComments[0].objectId,'a');assert.equal(next.objectComments[0].revision,2);assert.equal(commentMatches(next,next.objectComments[0]),true);
 assert.equal(next.shapes,doc.shapes);assert.equal(next.reviewRounds,doc.reviewRounds);
 assert.equal(addObjectComment(doc,'a','viewer','의견'),doc);assert.equal(addObjectComment(doc,'missing','author','의견'),doc);assert.equal(addObjectComment(doc,'a','author',' '),doc);
 assert.equal(commentMatches({...next,revision:3},next.objectComments[0]),false);
 assert.equal(commentMatches({...next,shapes:[]},next.objectComments[0]),false);
 }finally{await vite.close();}
});
