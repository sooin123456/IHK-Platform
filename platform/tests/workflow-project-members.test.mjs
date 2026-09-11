import test from 'node:test';import assert from 'node:assert/strict';import {createServer} from 'vite';
test('project member plans persist independently and reject readonly or invalid updates',async()=>{
 const vite=await createServer({configFile:false,appType:'custom',logLevel:'silent',server:{middlewareMode:true}});try{
  const {projectsSchema,saveProjectMember}=await vite.ssrLoadModule('/app/lukas/lib/workflow-projects.ts');
  const project={id:'p',name:'현장',kind:'civil'},member={name:' 김검토 ',email:'REVIEW@example.test',role:'reviewer'};
  const updated=saveProjectMember(project,'admin',member);assert.deepEqual(updated.members,[{name:'김검토',email:'review@example.test',role:'reviewer'}]);
  assert.equal(saveProjectMember(project,'viewer',member),project);assert.equal(saveProjectMember(project,'admin',{...member,email:'bad'}),project);
  const edited=saveProjectMember(updated,'admin',{...member,name:'박검토',role:'approver'});assert.equal(edited.members.length,1);assert.equal(edited.members[0].role,'approver');assert.equal(updated.members[0].name,'김검토');
  assert.equal(projectsSchema.parse([updated])[0].members[0].email,'review@example.test');assert.equal(projectsSchema.safeParse([{...updated,members:[...updated.members,...updated.members]}]).success,false);
 }finally{await vite.close();}
});
