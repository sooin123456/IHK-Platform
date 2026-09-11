import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";

import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});

const preview = await vite.ssrLoadModule(
  "/app/lukas/screens/workspace-preview.tsx",
);
const dialogUi = await vite.ssrLoadModule("/app/core/components/ui/dialog.tsx");
test("project deliveries has its own inline section rather than a drawing list or modal",()=>{
 const html=renderPreview("/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-deliveries");
 assert.match(html,/aria-label="프로젝트 납품 구성"/);
 assert.match(html,/<a[^>]*aria-current="page"[^>]*href="[^"]*panel=project-deliveries"/);
 assert.doesNotMatch(html,/role="dialog"|aria-label="도면 검색"/);
});
for(const [kind,title] of [["quantities","물량 현황"],["materials","자재 현황"]])test(`project ${kind} opens inline without inventing a source drawing`,()=>{
 const html=renderPreview(`/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-${kind}`);
 assert.match(html,new RegExp(`<h1[^>]*>${title}</h1>`));
 assert.match(html,new RegExp(`<a[^>]*aria-current="page"[^>]*href="[^"]*panel=project-${kind}"`));
 assert.doesNotMatch(html,/role="dialog"|aria-label="도면 검색"/);
 if(kind==="materials")assert.match(html,/기준 도면을 선택/);
 else assert.match(html,/screenDocument=00000000-0000-4000-8000-000000000111/);
});
test("cost proposals belong to a round revision and remain frozen in report records",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-change-preview.tsx');
 const round=m.createChangeRound([],'p','출입구','확인',[{documentId:'d',title:'도면',revision:2,page:1,phase:'requested'}],'round','2026-09-09');
 const proposal={id:'line',kind:'addition',item:'방화문',unit:'개',note:'변경으로 추가',documentId:'d'};
 assert.equal(typeof m.saveChangeCostProposals,'function');
 let stored='';const rows=m.saveChangeCostProposals([round],'p','round',[proposal],{setItem:(_key,value)=>{stored=value;}});
 assert.deepEqual(m.parseChangeRounds(stored,'p')[0].costProposals,[proposal]);
 assert.equal(round.costProposals,undefined);
 const report=m.createChangeReport(rows,{roundIds:['round'],format:'xlsx',recipient:'예시',sections:['cost']},'report',1,'2026-09-09');
 rows[0].costProposals[0].item='수정된 이름';assert.equal(report.rounds[0].costProposals[0].item,'방화문');
 assert.throws(()=>m.saveChangeCostProposals([round],'p','round',[{...proposal,documentId:'other'}],{setItem(){throw Error('must not save');}}));
 assert.throws(()=>m.saveChangeCostProposals([round],'p','round',[proposal,proposal],{setItem(){throw Error('must not save');}}));
});
test("invitation cancellation blocks guests and reissue keeps the original scope immutable",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-sharing-preview.tsx');
 const original=m.createSharingPreview([{id:'resource:r',kind:'resource',title:'회의록',detail:'공유 당시 내용'}],['resource:r'],{id:'old',projectId:'p',role:'request',recipient:'예시',expiresAt:'2099-01-01'});
 const raw=JSON.stringify(original);
 assert.equal(typeof m.manageSharingInvitation,'function');
 const cancelled=m.manageSharingInvitation([original],'old',{kind:'cancel'},1000);
 assert.throws(()=>m.readSharingInvitation(JSON.stringify(cancelled),'p','old',1001),/취소/);
 assert.throws(()=>m.createExternalRequest(cancelled[0],'resource:r','예시','의견','r',1001));
 const reissued=m.manageSharingInvitation(cancelled,'old',{kind:'reissue',id:'new',expiresAt:'2099-02-01'},2000);
 const fresh=m.readSharingInvitation(JSON.stringify(reissued),'p','new',2001);
 assert.deepEqual(fresh.items,original.items);
 assert.equal(fresh.role,'request');assert.equal(fresh.replacesId,'old');
 assert.equal(JSON.stringify(original),raw);
 assert.throws(()=>m.readSharingInvitation(JSON.stringify(reissued),'p','old',2001),/취소/);
 assert.throws(()=>m.manageSharingInvitation(reissued,'old',{kind:'reissue',id:'new',expiresAt:'2099-02-01'},3000));
 assert.throws(()=>m.manageSharingInvitation(reissued,'missing',{kind:'cancel'},3000));
 assert.throws(()=>m.manageSharingInvitation(reissued,'old',{kind:'reissue',id:'third',expiresAt:'1970-01-01'},3000));
});
for (const [section,title] of [["resources","프로젝트 자료"],["changes","프로젝트 변경 이력"],["sharing","외부 공유 준비"]]) {
 test(`project ${section} has an inline heading and matching active navigation`,()=>{
  const html=renderPreview(`/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-${section}`);
  assert.match(html,new RegExp(`<h1[^>]*>${title}</h1>`));
  assert.match(html,new RegExp(`<a[^>]*aria-current="page"[^>]*href="[^"]*panel=project-${section}"`));
  assert.doesNotMatch(html,/aria-label="도면 검색"|role="dialog"/);
 });
}
test("project review opens in the project body with the review navigation active",()=>{
 const html=renderPreview('/workspace-preview?project=00000000-0000-4000-8000-000000000101&panel=project-reviews');
 assert.match(html,/<h1[^>]*>검토 현황<\/h1>/);
 assert.match(html,/<a[^>]*aria-current="page"[^>]*href="[^"]*panel=project-reviews"/);
 assert.doesNotMatch(html,/aria-label="도면 검색"|role="dialog"/);
 assert.match(html,/검토 기록을 불러오고 있습니다/);
});
test("request context rejects another project or drawing instead of opening a substitute",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-sharing-preview.tsx');
 const review=await vite.ssrLoadModule('/app/lukas/components/drawing-review-loop.tsx');
 const invite=m.createSharingPreview([{id:'drawing:d',kind:'drawing',title:'도면',revision:1,page:1,detail:'고정',view:{kind:'office',paper:'A3',review:review.createReviewLoop('requested')}}],['drawing:d'],{id:'i',projectId:'p',role:'request',recipient:'예시',expiresAt:'2099-01-01'});
 const request=m.createExternalRequest(invite,'drawing:d','예시','위치 확인','r',1000);
 const raw=JSON.stringify([request]);
 assert.equal(typeof m.readExternalRequestContext,'function');
 assert.equal(m.readExternalRequestContext(raw,'p','d','r').target.view.review.position,1);
 assert.throws(()=>m.readExternalRequestContext(raw,'other','d','r'));
 assert.throws(()=>m.readExternalRequestContext(raw,'p','other','r'));
 assert.throws(()=>m.readExternalRequestContext(raw,'p','d','missing'));
});
test("shared drawing view keeps only the chosen revision and rejects mismatched page references",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-sharing-preview.tsx');
 const review=await vite.ssrLoadModule('/app/lukas/components/drawing-review-loop.tsx');
 const state=review.createReviewLoop('requested');
 state.history=[{...state,revision:9,message:'unshared historical message'}];
 const item={id:'drawing:d',kind:'drawing',title:'평면도',revision:1,page:1,detail:'공유',view:{kind:'office',paper:'A3',review:state}};
 const input={id:'i',projectId:'p',role:'view',recipient:'감리',expiresAt:'2099-01-01T00:00:00Z'};
 const frozen=m.createSharingPreview([item],[item.id],input);
 assert.equal(frozen.items[0].view.review.history.length,0);
 state.position=4;
 assert.equal(frozen.items[0].view.review.position,1);
 assert.throws(()=>m.createSharingPreview([{...item,page:2}],[item.id],input));
 assert.throws(()=>m.createSharingPreview([{...item,view:{...item.view,kind:'pdf',fingerprint:'invalid'}}],[item.id],input));
});
test("external reply draft IDs prevent duplicate history after a stale draft is restored",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-sharing-preview.tsx');
 const original={id:'r',status:'pending',message:'확인 요청'};
 const first=m.respondToExternalRequest(original,'working','도면 확인 중',1000,'draft-1');
 const retried=m.respondToExternalRequest(first,'working','도면 확인 중',2000,'draft-1');
 assert.equal(retried.history.length,1);
 assert.equal(retried.history[0].at,'1970-01-01T00:00:01.000Z');
});
test("external response appends explanation and status without rewriting earlier history",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-sharing-preview.tsx');
 assert.equal(typeof m.respondToExternalRequest,'function');
 const original={id:'r',status:'pending',message:'확인 요청'};
 assert.throws(()=>m.respondToExternalRequest(original,'resolved',' ',0));
 const first=m.respondToExternalRequest(original,'working','도면 확인 중',1000);
 const second=m.respondToExternalRequest(first,'resolved','출입구 폭 확인 완료',2000);
 assert.equal(original.status,'pending');
 assert.equal(first.history.length,1);
 assert.equal(second.history.length,2);
 assert.deepEqual(second.history[0],first.history[0]);
 assert.equal(second.history[1].message,'출입구 폭 확인 완료');
 assert.equal(second.status,'resolved');
 assert.throws(()=>m.respondToExternalRequest(second,'approved','승인',3000));
});
test("external requests retain frozen targets and reject view-only, expired, or out-of-scope input",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-sharing-preview.tsx');
 assert.equal(typeof m.createExternalRequest,'function');
 const invitation={id:'i',projectId:'p',role:'request',recipient:'감리',expiresAt:'2099-01-01T00:00:00Z',items:[{id:'drawing:d',kind:'drawing',title:'평면도',revision:2,page:3,detail:'변경'}]};
 const request=m.createExternalRequest(invitation,'drawing:d','이름 · 소속','위치 확인','request-a',0);
 invitation.items[0].revision=3;
 assert.equal(request.target.revision,2);
 assert.equal(request.status,'pending');
 assert.throws(()=>m.createExternalRequest({...invitation,role:'view'},'drawing:d','이름','요청','r',0));
 assert.throws(()=>m.createExternalRequest(invitation,'other','이름','요청','r',0));
 assert.throws(()=>m.createExternalRequest(invitation,'drawing:d','이름',' ','r',0));
 assert.throws(()=>m.createExternalRequest(invitation,'drawing:d','이름','요청','r',Date.parse('2100-01-01')));
});
test("guest entry never renders project navigation before scoped invitation is loaded",()=>{
 const html=renderPreview('/workspace-preview?project=00000000-0000-4000-8000-000000000101&guest=invite-a');
 assert.match(html,/외부 참여자/);
 assert.doesNotMatch(html,/모든 프로젝트|프로젝트 업무|파일로 시작/);
});
test("guest lookup rejects mismatched and expired invitations",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-sharing-preview.tsx');
 assert.equal(typeof m.readSharingInvitation,'function');
 const record=m.createSharingPreview([{id:'resource:r',kind:'resource',title:'회의록',detail:'범위 확인'}],['resource:r'],{id:'i',projectId:'p',role:'view',recipient:'발주자',expiresAt:'2099-01-01T00:00:00Z'});
 assert.equal(m.readSharingInvitation(JSON.stringify([record]),'p','i',0).items.length,1);
 assert.throws(()=>m.readSharingInvitation(JSON.stringify([record]),'other','i',0));
 assert.throws(()=>m.readSharingInvitation(JSON.stringify([record]),'p','missing',0));
 assert.throws(()=>m.readSharingInvitation(JSON.stringify([record]),'p','i',Date.parse('2100-01-01')));
});
test("external sharing opens only within a project and keeps Viewer role",()=>{
 const project="00000000-0000-4000-8000-000000000101";
 const model=preview.resolveWorkspacePreview(`?project=${project}&role=viewer&panel=project-sharing`);
 assert.equal(model.dialog?.kind,"project-sharing");
 assert.equal(model.closeHref,`/workspace-preview?project=${project}&role=viewer`);
 assert.equal(preview.resolveWorkspacePreview("?panel=project-sharing").dialog,null);
});
test("sharing scope freezes selected revisions and rejects unknown or empty selections",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-sharing-preview.tsx');
 const items=[{id:'drawing:d',kind:'drawing',title:'평면도',revision:2,page:1,detail:'검토 완료'}];
 const invite=m.createSharingPreview(items,['drawing:d'],{id:'invite-a',projectId:'p',role:'view',recipient:'감리 예시',expiresAt:'2099-01-01T00:00:00Z'});
 items[0].revision=3;
 assert.equal(invite.items[0].revision,2);
 assert.throws(()=>m.createSharingPreview(items,[],{...invite,items:undefined}));
 assert.throws(()=>m.createSharingPreview(items,['missing'],{...invite,items:undefined}));
 assert.throws(()=>m.createSharingPreview(items,['drawing:d'],{...invite,role:'editor'}));
});
test("resource PDF reader exposes local selection without claiming stored or editable content",async()=>{
 const m=await vite.ssrLoadModule('/app/lukas/components/project-resource-reader.tsx');
 const html=renderToStaticMarkup(React.createElement(m.ProjectResourceReader));
 assert.match(html,/열람할 로컬 PDF 선택/);
 assert.match(html,/동일성은 확인되지 않았습니다/);
 assert.doesNotMatch(html,/<canvas|도면 저장|업로드 완료/);
});
test("general project resources are distinct from materials and keep Viewer project origin",()=>{
 const project="00000000-0000-4000-8000-000000000101";
 const model=preview.resolveWorkspacePreview(`?project=${project}&role=viewer&panel=project-resources`);
 assert.equal(model.dialog?.kind,"project-resources");
 assert.equal(model.closeHref,`/workspace-preview?project=${project}&role=viewer`);
 assert.equal(preview.resolveWorkspacePreview("?panel=project-resources").dialog,null);
 const html=renderDialog("project-resources",model.closeHref);
 assert.match(html,/프로젝트 자료/);
 assert.doesNotMatch(html,/<form/);
});
test("project change history opens in the selected project and retains Viewer origin", () => {
 const project="00000000-0000-4000-8000-000000000101";
 const model=preview.resolveWorkspacePreview(`?project=${project}&role=viewer&panel=project-changes`);
 assert.equal(model.dialog?.kind,"project-changes");
 assert.equal(model.closeHref,`/workspace-preview?project=${project}&role=viewer`);
 assert.equal(preview.resolveWorkspacePreview("?panel=project-changes").dialog,null);
 const html=renderDialog("project-changes",model.closeHref);
 assert.match(html,/프로젝트 변경 이력/);
 assert.doesNotMatch(html,/<form/);
});
test("change rounds freeze selected revisions, reject missing targets and never mutate after storage failure", async () => {
 const m=await vite.ssrLoadModule('/app/lukas/components/project-change-preview.tsx');
 const refs=[{documentId:'drawing-a',title:'평면',revision:3,page:2,phase:'reviewed'}];
 const round=m.createChangeRound([], 'project-a','출입구 변경','통행 간섭 조정',refs,'round-a','2026-09-09T00:00:00Z');
 assert.equal(round.number,1);
 refs[0].revision=4;
 assert.equal(round.revisions[0].revision,3);
 assert.throws(()=>m.createChangeRound([], 'project-a','변경','',refs,'x','now'));
 assert.throws(()=>m.createChangeRound([], 'project-a','변경','사유',[],'x','now'));
 assert.equal(m.parseChangeRounds(JSON.stringify([round]),'project-b'),null);
 assert.deepEqual(m.parseChangeRounds(JSON.stringify([round]),'project-a'),[round]);
 const existing=[];
 assert.throws(()=>m.saveChangeRound(existing,round,{setItem(){throw Error('quota');}}),/quota/);
 assert.deepEqual(existing,[]);
});
test("change drafts preserve incomplete input and reject malformed selections", async () => {
 const m=await vite.ssrLoadModule('/app/lukas/components/project-change-preview.tsx');
 assert.equal(typeof m.parseChangeDraft,'function');
 const draft={id:'draft-a',title:'입력 중',reason:'',selected:['drawing-a']};
 assert.deepEqual(m.parseChangeDraft(JSON.stringify(draft)),draft);
 for (const value of [null,{}, {...draft,title:'x'.repeat(81)}, {...draft,selected:['a','a']}, {...draft,selected:[null]}]) assert.equal(m.parseChangeDraft(JSON.stringify(value)),null);
});
test("cost checks persist independently without changing the linked review decision", async () => {
 const m=await vite.ssrLoadModule('/app/lukas/components/project-change-preview.tsx');
 assert.equal(typeof m.saveChangeCostChecks,'function');
 const round=m.createChangeRound([], 'p','변경','사유',[{documentId:'d',title:'도면',revision:2,page:1,phase:'approved'}],'r','2026-09-09T00:00:00Z');
 const checks={addition:'checked',deletion:'unchecked',basis:'applied'};
 let saved;
 const result=m.saveChangeCostChecks([round],'p','r',checks,{setItem(key,raw){saved=JSON.parse(raw);}});
 assert.deepEqual(result[0].costChecks,checks);
 assert.equal(result[0].revisions[0].phase,'approved');
 assert.equal(round.costChecks,undefined);
 assert.deepEqual(saved,result);
 assert.throws(()=>m.saveChangeCostChecks([round],'other','r',checks,{setItem(){throw Error('must not write');}}),/일치/);
 assert.equal(m.parseChangeRounds(JSON.stringify([{...round,costChecks:{...checks,basis:'approved'}}]),'p'),null);
 assert.throws(()=>m.saveChangeCostChecks([round],'p','r',checks,{setItem(){throw Error('quota');}}),/quota/);
});
test("change report captures exact selected rounds and does not follow later edits", async () => {
 const m=await vite.ssrLoadModule('/app/lukas/components/project-change-preview.tsx');
 assert.equal(typeof m.createChangeReport,'function');
 const round=m.createChangeRound([], 'p','출입구','간섭 조정',[{documentId:'d',title:'평면',revision:2,page:3,phase:'approved'}],'r','2026-09-09T00:00:00Z');
 const config={roundIds:['r'],format:'xlsx',recipient:'발주 담당 · 예시',sections:['reason','cost']};
 const report=m.createChangeReport([round],config,'report-1',1,'2026-09-09T01:00:00Z');
 round.title='후속 변경';round.revisions[0].revision=3;
 assert.equal(report.rounds[0].title,'출입구');
 assert.equal(report.rounds[0].revisions[0].revision,2);
 assert.deepEqual(report.sections,['reason','cost']);
 assert.throws(()=>m.createChangeReport([round],{...config,roundIds:['missing']},'x',2,'2026-09-09T01:00:00Z'));
 assert.throws(()=>m.createChangeReport([round],{...config,sections:[]},'x',2,'2026-09-09T01:00:00Z'));
});
test("project list restoration validates filters and bounds the saved search", async () => {
 const m=await vite.ssrLoadModule("/app/lukas/components/workspace-dashboard.tsx");
 assert.equal(typeof m.parseProjectListView,"function");
 assert.deepEqual(m.parseProjectListView('{"query":"현장","filter":"favorites","view":"list"}'),{query:"현장",filter:"favorites",view:"list"});
 for(const raw of ['null','{','{"query":42,"filter":"all","view":"grid"}','{"query":"x","filter":"other","view":"list"}']) assert.equal(m.parseProjectListView(raw),null);
 assert.equal(m.parseProjectListView(JSON.stringify({query:"x".repeat(501),filter:"all",view:"grid"})),null);
});

test("failed drawing persistence leaves the list unchanged and a retry adds one drawing", () => {
  assert.equal(typeof preview.saveLocalPreviewDrawing, "function");
  const current=[];
  const drawing={id:"draft-1",project_id:"project-1",title:"초안",updated_at:"2026-09-08",source_file_id:null,previewStartKind:"blank",previewPaper:"A3"};
  assert.throws(()=>preview.saveLocalPreviewDrawing(current,drawing,{setItem(){throw new Error("quota");}}),/quota/);
  assert.deepEqual(current,[]);
  let saved;
  const result=preview.saveLocalPreviewDrawing(current,drawing,{setItem(key,value){saved=JSON.parse(value);}});
  assert.equal(result.length,1);
  assert.deepEqual(saved,[drawing]);
  assert.deepEqual(current,[]);
});

test("project materials exposes the same draft flow with Viewer restrictions", () => {
  const html = renderDialog("project-materials", "/workspace-preview?project=00000000-0000-4000-8000-000000000101&role=viewer");
  assert.match(html, /자재 업무 단계/);
  assert.match(html, /실제 발주·입고·저장 없음/);
  assert.match(html, /<fieldset disabled/);
});

test.after(() => vite.close());

test("native preparation can return to file selection in the same project", () => {
 for (const kind of ["dwg", "ifc"]) {
  const html = renderDialog(kind, "/workspace-preview?project=00000000-0000-4000-8000-000000000101");
  assert.match(html, /href="\/workspace-preview\?project=00000000-0000-4000-8000-000000000101&amp;start=file"/);
  assert.match(html, /파일 형식 선택으로 돌아가기/);
  assert.match(html, /파일 이름과 준비 설정은 초기화/);
 }
});

test("native preparation starts retain the project and enforce viewer restriction", () => {
 for (const kind of ["dwg","ifc"]) {
  const project="00000000-0000-4000-8000-000000000101";
  const model=preview.resolveWorkspacePreview(`?project=${project}&start=${kind}`);
  assert.equal(model.dialog?.kind,kind);
  assert.equal(model.closeHref,`/workspace-preview?project=${project}`);
  assert.equal(preview.resolveWorkspacePreview(`?project=${project}&role=viewer&start=${kind}`).dialog,null);
 }
 assert.match(renderDialog("file"), /start=dwg/);
 assert.match(renderDialog("file"), /start=ifc/);
});

test("created preview drawing belongs only to its project and retains its start settings", () => {
  const project = {id:"00000000-0000-4000-9000-012345678abc", name:"새 현장", description:"", workflow_status:"draft", created_at:"2026-09-08T00:00:00Z", updated_at:"2026-09-08T00:00:00Z"};
  const drawing = {id:"drawing-test",project_id:project.id,title:"배치 계획",updated_at:"2026-09-08T01:00:00Z",source_file_id:null,previewStartKind:"house",previewPaper:"A2"};
  const model = preview.resolveWorkspacePreview(`?project=${project.id}`, [project], [drawing]);
  assert.equal(model.selectedProject.documents.length, 1);
  assert.equal(model.selectedProject.documents[0].previewStartKind, "house");
  assert.equal(model.selectedProject.documents[0].previewPaper, "A2");
  assert.equal(model.drawings.find(d=>d.id==="drawing-test")?.title, "배치 계획");
  const other = preview.resolveWorkspacePreview("?project=00000000-0000-4000-8000-000000000101", [project], [drawing]);
  assert.equal(other.selectedProject.documents.some(d=>d.id==="drawing-test"), false);
});

test("local project deep link waits for restore instead of showing unrelated projects", () => {
  const html = renderPreview("/workspace-preview?project=00000000-0000-4000-9000-012345678abc");
  assert.match(html, /프로젝트를 복원하고 있습니다/);
  assert.doesNotMatch(html, /성수동 사무실/);
});
test("preview search waits for restoration instead of accepting text that can be overwritten", () => {
 const html=renderPreview("/workspace-preview");
 assert.match(html,/<input[^>]*aria-label="프로젝트와 파일 검색"[^>]*disabled/);
 assert.match(html,/목록 설정을 복원하고 있습니다/);
});
test("unknown project links show recovery instead of unrelated projects or a creation dialog", () => {
 for(const suffix of ["", "&start=blank", "&panel=project-reviews"]){
  const html=renderPreview(`/workspace-preview?project=missing-project${suffix}`);
  assert.match(html,/프로젝트를 열 수 없습니다/);
  assert.match(html,/프로젝트 목록으로/);
  assert.doesNotMatch(html,/성수동 사무실|제목 없는 도면/);
 }
});

test("new local project review panel has no fabricated review history", () => {
  const html = renderDialog("project-reviews", "/workspace-preview?project=00000000-0000-4000-9000-012345678abc");
  assert.match(html, /아직 검토 요청이 없습니다/);
  assert.doesNotMatch(html, /회의실 출입문 폭 확인|reviewState=approved/);
  assert.match(html, /start=blank/);
  const viewer = renderDialog("project-reviews", "/workspace-preview?project=00000000-0000-4000-9000-012345678abc&role=viewer");
  assert.doesNotMatch(viewer, /start=blank/);
});

test("locally created project opens an empty drawing browser and retains start origin", () => {
  const local = {id:"00000000-0000-4000-9000-012345678abc", name:"새 현장", description:"로컬 예시", workflow_status:"draft", created_at:"2026-09-08T00:00:00Z", updated_at:"2026-09-08T00:00:00Z"};
  const model = preview.resolveWorkspacePreview(`?project=${local.id}`, [local]);
  assert.equal(model.selectedProject?.project.name, "새 현장");
  assert.deepEqual(model.selectedProject?.documents, []);
  assert.deepEqual(model.selectedProject?.files, []);
  assert.equal(new URL(preview.drawingWorkspacePreviewHref(`/workspace-preview?project=${local.id}`, {startKind:"blank"}), "http://local").searchParams.get("returnProject"), local.id);
});

test("new and existing account previews offer a local project creation screen", () => {
  for (const entry of ["/workspace-preview", "/workspace-preview?state=empty"]) {
    assert.match(renderPreview(entry), /새 프로젝트/);
  }
  assert.equal(preview.resolveWorkspacePreview("?state=empty&panel=new-project").dialog?.kind, "new-project");
});

test("project restore ignores malformed storage and non-preview identifiers", () => {
  assert.deepEqual(preview.parseLocalPreviewProjects("invalid json"), []);
  assert.deepEqual(preview.parseLocalPreviewProjects('{"id":"x"}'), []);
  assert.deepEqual(preview.parseLocalPreviewProjects('[null,{"id":"x"}]'), []);
  const project = {id:"00000000-0000-4000-9000-012345678abc", name:"새 현장", description:"", workflow_status:"draft", created_at:"2026-09-08T00:00:00Z", updated_at:"2026-09-08T00:00:00Z"};
  assert.deepEqual(preview.parseLocalPreviewProjects(JSON.stringify([project])), [project]);
  assert.deepEqual(preview.parseLocalPreviewProjects(JSON.stringify([{...project,name:" "},{...project,id:"00000000-0000-4000-8000-000000000101"}])), []);
  const readonly = preview.resolveWorkspacePreview(`?project=${project.id}&role=viewer&start=blank`, [project]);
  assert.equal(readonly.selectedProject?.canCreateWorkspace, false);
  assert.equal(readonly.dialog, null);
});

test("project preview offers separate favorite actions and a favorite filter", () => {
  const html = renderPreview("/workspace-preview");
  assert.match(html, /aria-label="성수동 사무실 즐겨찾기 추가"/);
  assert.match(html, /aria-label="판교 주택 리모델링 즐겨찾기 추가"/);
  assert.match(html, />즐겨찾기<\/button>/);
  assert.doesNotMatch(html, /<a[^>]*aria-label="성수동 사무실 도면 목록 열기"[^>]*>(?:(?!<\/a>)[\s\S])*<button/);
});

test("materials offers one drawing destination instead of a redundant generic link", () => {
 const html=renderDialog("project-materials");
 assert.match(html,/도면의 A01 위치로 돌아가기/);
 assert.doesNotMatch(html,/>도면에서 확인<\/a>/);
});

test("notification destination retains explicit workflow and safe origin", () => {
  const href = preview.drawingWorkspacePreviewHref("/workspace-preview?state=empty", {startKind:"office", workflowPanel:"export"});
  const query = new URL(href, "http://preview.local").searchParams;
  assert.equal(query.get("workflowPanel"), "export");
  assert.equal(query.get("returnState"), "empty");
});

test("notification empty state offers an explicit example instead of fabricated unread items", () => {
  const html = renderDialog("notifications");
  assert.match(html, /확인할 알림이 없습니다/);
  assert.match(html, /알림 예시 살펴보기/);
});

test("project members reuse example collaboration roles", () => {
  const html = renderDialog("project-members", "/workspace-preview?project=00000000-0000-4000-8000-000000000101");
  assert.match(html, /실제 접속 상태가 아닙니다/);
  assert.match(html, /Approver/);
});

function renderPreview(entry) {
  const router = createMemoryRouter(
    [{ path: "*", element: React.createElement(preview.default) }],
    { initialEntries: [entry] },
  );
  const html = renderToStaticMarkup(
    React.createElement(RouterProvider, { router }),
  );
  router.dispose();
  return html;
}

function renderDialog(kind, closeHref = "/workspace-preview?state=default", extra = {}) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: React.createElement(
          dialogUi.Dialog,
          { open: true },
          React.createElement(preview.PreviewDialogContent, {
            closeHref,
            dialog: { kind },
            onOpenPdf() {},
            ...extra,
          }),
        ),
      },
    ],
    { initialEntries: [closeHref] },
  );
  const html = renderToStaticMarkup(
    React.createElement(RouterProvider, { router }),
  );
  router.dispose();
  return html;
}

test("project review inbox shows stored drawing revision and returns to the same identity", () => {
 const html=renderDialog("project-reviews", "/workspace-preview?project=00000000-0000-4000-9000-012345678abc", {reviewEntries:[{document:{id:"00000000-0000-4000-8000-000000000111",title:"내 평면",source_file_id:null,updated_at:"2026-09-08",previewStartKind:"blank",previewPaper:"A2"},state:{phase:"approved",revision:2,page:3,message:"내 검토 요청",issue:"출입문 조정",history:[]}}]});
 assert.match(html,/내 평면/);assert.match(html,/R2 · 3쪽/);assert.match(html,/내 검토 요청/);
 assert.match(html,/screenDocument=00000000-0000-4000-8000-000000000111/);
 assert.match(html,/paper=A2/);assert.doesNotMatch(html,/회의실 출입문 폭 확인/);
});

test("notification activity opens its recorded drawing and project instead of a generic example", () => {
 const html=renderDialog("notifications", "/workspace-preview?role=viewer", {reviewEntries:[{document:{id:"00000000-0000-4000-8000-000000000111",project_id:"00000000-0000-4000-8000-000000000101",title:"알림 대상 도면",source_file_id:null,previewStartKind:"blank",previewPaper:"A2"},state:{phase:"changes",revision:3,page:2,message:"위치 수정 요청",issue:"출입문",history:[]}}]});
 assert.match(html,/알림 대상 도면/);
 assert.match(html,/R3 · 2쪽/);
 assert.match(html,/screenDocument=00000000-0000-4000-8000-000000000111/);
 assert.match(html,/returnProject=00000000-0000-4000-8000-000000000101/);
 assert.match(html,/role=viewer/);
 assert.doesNotMatch(html,/새 알림이 없습니다|예시 도면에서 확인/);
});

test("review return preserves a legacy house template instead of opening a blank drawing", () => {
  const html = renderDialog("project-reviews", "/workspace-preview?project=00000000-0000-4000-8000-000000000102", {
    reviewEntries: [{
      document: {id:"00000000-0000-4000-8000-000000000111",title:"주택 평면",source_file_id:null,updated_at:"2026-09-08",thumbnailUrl:"/images/workspace-start/house-plan.png"},
      state: {phase:"requested",revision:1,page:1,message:"검토 요청",issue:"",history:[]},
    }],
  });
  assert.match(html, /startKind=house/);
  assert.doesNotMatch(html, /startKind=blank/);
});

test("file start exposes CAD choices before the PDF picker and retains project origin", () => {
 const html=renderDialog("file", "/workspace-preview?project=00000000-0000-4000-8000-000000000101");
 assert.match(html, /<nav[^>]*aria-label="파일 형식 선택"/);
 assert.ok(html.indexOf('파일 형식 선택') < html.indexOf('작업실에서 열 PDF 선택'));
 assert.match(html,/start=dwg/);
 assert.match(html,/start=ifc/);
 assert.match(html,/엔진 미연결/);
});

test("default preview exposes three dated personal projects with real UUID fixtures", () => {
  const model = preview.resolveWorkspacePreview("?state=default");

  assert.deepEqual(
    model.projects.map((project) => project.name),
    ["성수동 사무실", "판교 주택 리모델링", "강남 카페"],
  );
  assert.ok(
    model.projects.every((project) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/.test(
        project.id,
      ),
    ),
  );
  assert.ok(
    model.projects.every(
      (project) => project.updated_at === "2026-09-07T03:00:00.000Z",
    ),
  );
  assert.equal(model.drawings.length, 5);
  assert.deepEqual(
    model.drawings
      .filter((drawing) => drawing.project_id === model.projects[0].id)
      .map((drawing) => drawing.title),
    ["1층 평면도", "아이디어 스케치", "기존 DXF 평면"],
  );
  assert.equal(model.projectMetrics[model.projects[0].id].fileCount, 3);
  assert.equal(model.organizations[0].is_personal, true);
  assert.equal(model.hasAccessibleProjects, true);
  assert.equal(model.projects[1].shared, true);
});

test("empty preview has no projects or drawings and quick-start dialogs return to empty", () => {
  const empty = preview.resolveWorkspacePreview("?state=empty");
  const blank = preview.resolveWorkspacePreview("?start=blank");

  assert.deepEqual(empty.projects, []);
  assert.deepEqual(empty.drawings, []);
  assert.equal(empty.hasAccessibleProjects, false);
  assert.deepEqual(blank.projects, []);
  assert.equal(blank.dialog?.kind, "blank");
  assert.equal(blank.closeHref, "/workspace-preview?state=empty");
});

test("a known project opens the full drawing browser with its documents and sources", () => {
  const dashboard = preview.resolveWorkspacePreview("");
  const projectId = dashboard.projects[0].id;
  const selected = preview.resolveWorkspacePreview(`?project=${projectId}`);

  assert.equal(selected.dialog, null);
  assert.equal(selected.selectedProject?.project.name, "성수동 사무실");
  assert.deepEqual(
    selected.selectedProject?.documents.map((drawing) => drawing.title),
    ["1층 평면도", "아이디어 스케치", "기존 DXF 평면"],
  );
  assert.deepEqual(
    selected.selectedProject?.files.map((file) => file.original_filename),
    ["성수동_1층.pdf", "성수동_기존.dxf", "성수동_모델.ifc"],
  );
  assert.equal(selected.selectedProject?.canCreateWorkspace, true);
});

test("unknown project IDs never become drawing-browser links", () => {
  const unknown = preview.resolveWorkspacePreview(
    "?project=00000000-0000-4000-8000-000000000999",
  );

  assert.equal(unknown.selectedProject, null);
  assert.equal(unknown.dialog, null);
});

test("project actions keep the selected browser underneath and close back to it", () => {
  const projectId = preview.resolveWorkspacePreview("").projects[0].id;
  const file = preview.resolveWorkspacePreview(
    `?project=${projectId}&start=file`,
  );
  const reviews = preview.resolveWorkspacePreview(
    `?project=${projectId}&panel=project-reviews`,
  );

  assert.equal(file.selectedProject?.project.id, projectId);
  assert.equal(file.dialog?.kind, "file");
  assert.equal(file.closeHref, `/workspace-preview?project=${projectId}`);
  assert.equal(reviews.selectedProject?.project.id, projectId);
  assert.equal(reviews.dialog?.kind, "project-reviews");
  assert.equal(reviews.closeHref, `/workspace-preview?project=${projectId}`);
  assert.equal(
    preview.resolveWorkspacePreview(
      `?project=${projectId}&tab=files&start=file`,
    ).closeHref,
    `/workspace-preview?project=${projectId}&tab=files`,
  );
});

test("project files dialog lists preview metadata and never loses its selected project", () => {
  const projectId = preview.resolveWorkspacePreview("").projects[0].id;
  const model = preview.resolveWorkspacePreview(
    `?project=${projectId}&role=viewer&panel=project-files`,
  );

  assert.equal(model.dialog?.kind, "project-files");
  assert.deepEqual(
    model.dialog?.files.map((file) => [file.kind, file.original_filename]),
    [
      ["pdf", "성수동_1층.pdf"],
      ["dxf", "성수동_기존.dxf"],
      ["ifc", "성수동_모델.ifc"],
    ],
  );
  assert.equal(
    model.closeHref,
    `/workspace-preview?project=${projectId}&role=viewer`,
  );
});

test("viewer and selected-project empty knobs provide read-only QA fixtures", () => {
  const projectId = preview.resolveWorkspacePreview("").projects[0].id;
  const model = preview.resolveWorkspacePreview(
    `?project=${projectId}&role=viewer&empty=1`,
  );

  assert.equal(model.selectedProject?.canCreateWorkspace, false);
  assert.deepEqual(model.selectedProject?.documents, []);
  assert.deepEqual(model.selectedProject?.files, []);
});

test("crafted start queries cannot open creation dialogs for a selected viewer project", () => {
  const projectId = preview.resolveWorkspacePreview("").projects[0].id;

  for (const start of ["blank", "file", "template"]) {
    const model = preview.resolveWorkspacePreview(
      `?project=${projectId}&role=viewer&start=${start}`,
    );
    assert.equal(model.selectedProject?.project.id, projectId);
    assert.equal(model.selectedProject?.canCreateWorkspace, false);
    assert.equal(model.dialog, null);
    assert.equal(model.closeHref, "/workspace-preview?role=viewer");
  }
});

test("global settings return retains Viewer without requiring a selected project",()=>{
  for(const state of ["","&state=empty","&state=default"]){
    const model=preview.resolveWorkspacePreview(`?panel=settings&role=viewer${state}`);
    assert.equal(new URL(model.closeHref,"http://preview.local").searchParams.get("role"),"viewer");
  }
});

test("crafted viewer start URL SSR keeps the safe project list without creation actions", () => {
  const projectId = preview.resolveWorkspacePreview("").projects[0].id;
  const html = renderPreview(
    `/workspace-preview?project=${projectId}&role=viewer&start=blank`,
  );

  assert.match(html, /성수동 사무실/);
  assert.match(html, /1층 평면도/);
  assert.match(html, /보기 권한/);
  assert.doesNotMatch(html, /저장되지 않는 편집기 체험 열기/);
  assert.doesNotMatch(html, /(?:\?|&amp;)start=(?:blank|file|template)/);
});

test("selected project SSR renders the shared browser and unified drawing actions", () => {
  const projectId = preview.resolveWorkspacePreview("").projects[0].id;
  const html = renderPreview(`/workspace-preview?project=${projectId}`);
  const filesHtml = renderPreview(
    `/workspace-preview?project=${projectId}&tab=files`,
  );

  assert.match(html, /성수동 사무실/);
  assert.match(html, /1층 평면도/);
  assert.match(filesHtml, /성수동_모델\.ifc/);
  assert.ok(
    html.includes(
      `/workspace-preview/drawing-workspace?layout=pdf&amp;screenDocument=00000000-0000-4000-8000-000000000111&amp;startKind=office&amp;title=1%EC%B8%B5+%ED%8F%89%EB%A9%B4%EB%8F%84&amp;returnProject=${projectId}`,
    ),
  );
  assert.doesNotMatch(html, new RegExp(`/projects/${projectId}`));
});

test("resume opens the example layout while PDF source entry opens the empty real-PDF screen", () => {
  assert.doesNotMatch(
    renderPreview("/workspace-preview"),
    /안전하게 저장됩니다/,
  );
  const dashboard = renderPreview("/workspace-preview");
  assert.match(
    dashboard,
    /href="\/workspace-preview\/drawing-workspace\?layout=pdf&amp;screenDocument=00000000-0000-4000-8000-000000000111&amp;startKind=office&amp;title=1%EC%B8%B5\+%ED%8F%89%EB%A9%B4%EB%8F%84&amp;returnProject=00000000-0000-4000-8000-000000000101"/,
  );
  const files = renderPreview(
    "/workspace-preview?project=00000000-0000-4000-8000-000000000101&tab=files&role=viewer",
  );
  assert.match(
    files,
    /href="\/workspace-preview\/drawing-workspace\?layout=pdf&amp;returnProject=00000000-0000-4000-8000-000000000101&amp;role=viewer&amp;returnTab=files"/,
  );
});

test("panel queries keep the populated dashboard and preserve explicit state on close", () => {
  const library = preview.resolveWorkspacePreview(
    "?state=default&panel=library",
  );
  const notifications = preview.resolveWorkspacePreview(
    "?state=default&panel=notifications",
  );

  assert.equal(library.projects.length, 3);
  assert.equal(library.dialog?.kind, "library");
  assert.equal(library.closeHref, "/workspace-preview?state=default");
  assert.equal(notifications.dialog?.kind, "notifications");
});

test("quick-start respects an explicit default origin instead of replacing its populated dashboard", () => {
  const blank = preview.resolveWorkspacePreview("?state=default&start=blank");

  assert.equal(blank.projects.length, 3);
  assert.equal(blank.hasAccessibleProjects, true);
  assert.equal(blank.dialog?.kind, "blank");
  assert.equal(blank.closeHref, "/workspace-preview?state=default");
});

test("settings panel opens an honest preview dialog and closes to its originating state", () => {
  const settings = preview.resolveWorkspacePreview(
    "?state=default&panel=settings",
  );

  assert.equal(settings.dialog?.kind, "settings");
  assert.equal(settings.projects.length, 3);
  assert.equal(settings.closeHref, "/workspace-preview?state=default");
});

test("drawing starts keep only safe preview origins and trim the 80-character title", () => {
  const projectId = preview.resolveWorkspacePreview("").projects[0].id;
  const href = preview.drawingWorkspacePreviewHref(
    `/workspace-preview?project=${projectId}&state=default&empty=1&tab=files&role=viewer`,
    {
      paper: "A2",
      startKind: "blank",
      title: `  ${"가".repeat(82)}  `,
    },
  );
  const url = new URL(href, "https://preview.local");

  assert.equal(url.pathname, "/workspace-preview/drawing-workspace");
  assert.equal(url.searchParams.get("layout"), "pdf");
  assert.equal(url.searchParams.get("startKind"), "blank");
  assert.equal(url.searchParams.get("title"), "가".repeat(80));
  assert.equal(url.searchParams.get("paper"), "A2");
  assert.equal(url.searchParams.get("returnProject"), projectId);
  assert.equal(url.searchParams.get("returnState"), "default");
  assert.equal(url.searchParams.get("returnEmpty"), "1");
  assert.equal(url.searchParams.get("returnTab"), "files");
  assert.equal(url.searchParams.get("role"), "viewer");

  for (const unsafe of [
    `https://outside.example/workspace-preview?project=${projectId}&role=viewer`,
    `/another-local-screen?project=${projectId}&role=viewer`,
  ]) {
    const escaped = new URL(
      preview.drawingWorkspacePreviewHref(unsafe, {
        startKind: "office",
        title: "사무실 평면",
      }),
      "https://preview.local",
    );
    assert.equal(escaped.pathname, "/workspace-preview/drawing-workspace");
    assert.equal(escaped.searchParams.has("returnProject"), false);
    assert.equal(escaped.searchParams.has("role"), false);
  }
});

test("drawing title validation rejects whitespace before local form navigation", () => {
  assert.equal(
    preview.workspacePreviewDrawingTitleError(" \n "),
    "도면 제목을 입력해 주세요.",
  );
  assert.equal(preview.workspacePreviewDrawingTitleError(" 1층 평면도 "), null);
});

test("blank start renders an editable screen-preview drawing setup", () => {
  const html = renderDialog("blank");

  assert.match(html, /새 도면/);
  assert.match(html, /도면 제목/);
  assert.match(html, /maxLength="80"/);
  assert.match(html, /용지/);
  assert.match(html, /A3 가로/);
  assert.match(html, /화면 미리보기/);
  assert.match(html, /<form/);
  assert.match(html, /type="submit"/);
  assert.match(html, /용지 이름만 미리 봅니다/);
  assert.match(
    html,
    /href="\/workspace-preview\?state=default&amp;start=template"/,
  );
  assert.match(html, /템플릿에서 시작/);
});

test("template search returns selectable image-layout examples without a file", () => {
  assert.deepEqual(
    preview
      .filterWorkspacePreviewTemplates("사무실")
      .map((template) => template.kind),
    ["office"],
  );
  assert.deepEqual(
    preview
      .filterWorkspacePreviewTemplates("주택")
      .map((template) => template.kind),
    ["house"],
  );
  assert.deepEqual(preview.filterWorkspacePreviewTemplates("병원"), []);

  const html = renderDialog("template");
  assert.match(html, /템플릿 검색/);
  assert.match(html, /사무실 평면/);
  assert.match(html, /주택 리모델링/);
  assert.match(html, /검색 결과가 없습니다/);
  assert.match(html, /검색 초기화/);
  assert.match(html, /이미지 레이아웃 예시/);
  assert.match(html, /편집 가능한 벡터 도면을 가져오지 않습니다/);
  assert.match(html, /템플릿 도면 제목/);
  assert.match(html, /value="사무실 평면"/);
  assert.match(html, /maxLength="80"/);
  assert.match(html, /type="submit"/);
  assert.doesNotMatch(html, /type="file"/);
});

test("project review rows expose filters and open the office review simulation", () => {
  const projectId = preview.resolveWorkspacePreview("").projects[0].id;
  const html = renderDialog(
    "project-reviews",
    `/workspace-preview?project=${projectId}&role=viewer`,
  );

  for (const label of ["전체", "검토 중", "수정 필요", "완료"])
    assert.match(html, new RegExp(label));
  assert.match(html, /회의실 출입문 폭 확인/);
  assert.match(html, /도면에서 확인/);
  assert.match(html, /startKind=office/);
  assert.match(html, /reviewPreview=1/);
  for (const state of ["requested", "changes", "approved"])
    assert.match(html, new RegExp(`reviewPreview=1&amp;reviewState=${state}`));
  assert.match(html, new RegExp(`returnProject=${projectId}`));
  assert.match(html, /role=viewer/);
  assert.match(html, /실제 검토 데이터 저장·전송 없음/);
});

test("project information panes render compact facts and drawing actions", () => {
  assert.match(renderDialog("project-quantities", "/workspace-preview?project=00000000-0000-4000-8000-000000000101&role=viewer"), /takeoffPreview=1/);
  const projectId = preview.resolveWorkspacePreview("").projects[0].id;
  const expected = {
    "project-overview": ["설계 검토", "최근 도면", "1층 평면도"],
    "project-quantities": [
      "공간",
      "도면 연결 전",
      "길이",
      "측정 기준 설정 전",
      "개수",
      "집계 전",
    ],
    "project-materials": ["자재 업무 단계", "발주수량 미확정", "실제 자재 매핑 없음"],
    "project-members": ["참여자 예시", "Reviewer", "Approver"],
  };

  for (const [panel, labels] of Object.entries(expected)) {
    const html = renderDialog(panel, `/workspace-preview?project=${projectId}`);
    for (const label of labels) assert.match(html, new RegExp(label));
    assert.match(html, panel === "project-materials" ? /도면의 A01 위치로 돌아가기/ : /도면에서 확인/);
    assert.match(
      html,
      panel === "project-members" ? /가상 참여자/ : /화면 구성 예시/,
    );
    assert.match(html, /실제 .* 연결|실제 접속·초대 없음/);
    if (panel === "project-members")
      assert.doesNotMatch(html, /작업 중|공유됨/);
  }
});

test("PDF start clearly distinguishes a real local file from durable project data", () => {
  const html = renderDialog("file", "/workspace-preview?state=empty");

  assert.match(html, /실제 PDF/);
  assert.match(html, /브라우저에서만/);
  assert.match(html, /영구 저장되지 않습니다/);
  assert.match(html, /PDF 50MB 이하/);
});
