import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const vite = await createServer({ appType: "custom", configFile: false, logLevel: "silent", resolve: { alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) } }, server: { middlewareMode: true } });
test.after(() => vite.close());
let mod = {};
try { mod = await vite.ssrLoadModule("/app/lukas/components/drawing-review-loop.tsx"); } catch {}
const start = () => { assert.equal(typeof mod.createReviewLoop, "function", "review loop is implemented"); return mod.createReviewLoop(); };
const act = (state, type, extra = {}) => mod.reviewLoopReducer(state, { type, ...extra });
function requested() { return act(act(start(), "move", { page: 2 }), "request", { message: "출입구 간섭 확인" }); }
test('review compares saved custom properties even when geometry is unchanged',()=>{
 const before={id:'prop',kind:'사각형',page:1,x:100,y:100,name:'벽',layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:'',properties:{classification:'미분류',code:'OLD-01',note:'기존 메모',required:false}};
 const target={...before,properties:{classification:'구조',code:'STR-01',note:'단면 확인',required:true}};
 const state={...start(),target,beforeTarget:before,compared:true};
 const html=renderToStaticMarkup(React.createElement(mod.DrawingReviewLoop,{state,dispatch(){},ready:true,viewer:true,onLocate(){}}));
 assert.match(html,/OLD-01 → STR-01/);assert.match(html,/기존 메모 → 단면 확인/);assert.match(html,/미분류 → 구조/);assert.match(html,/없음 → 있음/);
});
test("selected screen object is frozen through correction and approval, not replaced by the door sample",()=>{
 const object={id:"shape-a",kind:"사각형",page:2,x:100,y:150,name:"검토 영역",layer:"review",color:"#6650f5",lineWidth:"0.25 mm",fill:"없음",text:""};
 let state=act(start(),"target",{object});
 assert.equal(state.target?.id,"shape-a");assert.equal(state.page,2);
 object.name="caller changed";assert.equal(state.target.name,"검토 영역");
 state=act(state,"request",{message:"영역 확인"});
 const frozen=JSON.stringify(state.target);
 assert.deepEqual(act(state,"edit-target",{object:{...state.target,name:"불가"}}),state);
 state=act(act(state,"role",{role:"reviewer"}),"changes",{message:"이름 수정"});
 state=act(act(act(state,"role",{role:"author"}),"focus"),"resolve");
 assert.equal(state.revision,2);assert.equal(state.phase,"draft");
 assert.deepEqual(act(state,"request",{message:"아직 수정 안 함"}),state);
 state=act(state,"edit-target",{object:{...state.target,name:"수정 영역"}});
 assert.equal(state.phase,"revised");assert.equal(JSON.stringify(state.history[0].target),frozen);
 state=approveReviewed(act(act(state,"request",{message:"이름 반영"}),"role",{role:"reviewer"}));
 const restored=mod.parseReviewLoopSession(JSON.stringify(state));assert.equal(restored.target.name,"수정 영역");
 const html=renderToStaticMarkup(React.createElement(mod.DrawingReviewLoop,{state:restored,dispatch(){},ready:true,viewer:true,onLocate(){}}));
 assert.match(html,/수정 영역/);assert.doesNotMatch(html,/문 위치|D01/);
 const next=act(act(state,"role",{role:"author"}),"new-revision");
 assert.equal(next.target.id,"shape-a");assert.equal(next.history[1].target.name,"수정 영역");
 for(const target of [{...state.target,x:NaN},{...state.target,kind:"script"},{...state.target,page:0}])assert.equal(mod.parseReviewLoopSession(JSON.stringify({...state,target})),null);
});
test("sharing freezes the chosen shape and renders it without substituting D01",async()=>{
 const shared=await vite.ssrLoadModule("/app/lukas/components/shared-drawing-preview.tsx");
 const object={id:"shape-share",kind:"원",page:1,x:100,y:150,name:"공유 원",layer:"review",color:"#6650f5",lineWidth:"0.25 mm",fill:"없음",text:""};
 const state=act(start(),"target",{object});
 const view=shared.freezeSharedDrawingView({kind:"office",paper:"A3",review:state},1,1);
 assert.equal(view.review.target?.id,"shape-share");
 state.target.name="changed after sharing";assert.equal(view.review.target.name,"공유 원");
 const html=renderToStaticMarkup(React.createElement(shared.SharedDrawingPreview,{view,title:"원본"}));
 assert.match(html,/공유 원/);assert.match(html,/<circle/);assert.doesNotMatch(html,/D01/);
});
test("internal request identity survives correction and approval without rewriting review history",()=>{
 let state=act(act(requested(),"role",{role:"reviewer"}),"changes",{message:"문 폭 확인"});
 assert.equal(typeof mod.internalReviewRequests,"function");
 const pending=mod.internalReviewRequests("doc-a",state);
 assert.equal(pending.length,1);assert.equal(pending[0].status,"pending");
 state=act(act(act(state,"role",{role:"author"}),"focus"),"resolve");
 const working=mod.internalReviewRequests("doc-a",state);
 assert.equal(working.length,1);assert.equal(working[0].id,pending[0].id);assert.equal(working[0].status,"working");
 state=act(state,"request",{message:"수정 반영"});
 state=approveReviewed(act(state,"role",{role:"reviewer"}));
 const saved=JSON.stringify(state);
 const resolved=mod.internalReviewRequests("doc-a",state);
 assert.equal(resolved[0].id,pending[0].id);assert.equal(resolved[0].status,"resolved");
 assert.equal(JSON.stringify(state),saved);
 state=act(act(state,"role",{role:"author"}),"new-revision");
 assert.equal(mod.internalReviewRequests("doc-a",state)[0].status,"resolved");
 assert.notEqual(mod.internalReviewRequests("doc-b",state)[0].id,pending[0].id);
 state=act(act(state,"move",{page:2}),"request",{message:"추가 검토"});
 state=act(act(state,"role",{role:"reviewer"}),"changes",{message:"문 폭 확인"});
 const reopened=mod.internalReviewRequests("doc-a",state);
 assert.equal(reopened.length,2);assert.equal(reopened[0].status,"resolved");assert.equal(reopened[1].status,"pending");
 assert.notEqual(reopened[0].id,reopened[1].id);
 const uncertain={...state,revision:4,issue:"다른 지적",history:[{...state,revision:3,phase:"changes",issue:"결과 없는 이전 지적"}]};
 assert.equal(mod.internalReviewRequests("doc-a",uncertain)[0].status,"unknown");
});
test("revision inspection selects an exact archived page without changing the current draft", () => {
 const state={...requested(),revision:3,history:[{...requested(),revision:1,phase:'approved'}]};
 assert.equal(typeof mod.reviewRevisionFor,'function');
 const archived=mod.reviewRevisionFor(state,1,2);
 assert.equal(archived.revision,1);
 assert.equal(archived.phase,'approved');
 assert.equal(state.revision,3);
 assert.equal(mod.reviewRevisionFor(state,2,2),null);
 assert.equal(mod.reviewRevisionFor(state,1,3),null);
});
function approveReviewed(s) {
  s = act(act(s, "compare"), "review-complete");
  assert.equal(s.phase, "reviewed");
  return act(act(act(s, "role", {role:"approver"}), "compare"), "approve");
}

test("review completion does not grant approval and approver must inspect the fixed revision", () => {
  const reviewer = act(act(requested(), "role", {role:"reviewer"}), "compare");
  assert.deepEqual(act(reviewer, "approve"), reviewer);
  const reviewed = act(reviewer, "review-complete");
  assert.equal(reviewed.phase, "reviewed");
  assert.deepEqual(act(reviewed, "approve"), reviewed);
  const approver = act(reviewed, "role", {role:"approver"});
  assert.deepEqual(act(approver, "approve"), approver);
  assert.equal(act(act(approver, "compare"), "approve").phase, "approved");
  assert.equal(mod.parseReviewLoopSession(JSON.stringify(approver))?.phase, "reviewed");
});

test("reviewer UI offers review completion while only approver sees final approval", () => {
  const render = state => renderToStaticMarkup(React.createElement(mod.DrawingReviewLoop, {state, dispatch(){}, ready:true, viewer:false, onLocate(){}}));
  const reviewer = act(requested(), "role", {role:"reviewer"});
  assert.match(render(reviewer), /검토 완료 · 승인 요청/);
  assert.doesNotMatch(render(reviewer), /최종 승인하기/);
  const reviewed = act(act(reviewer, "compare"), "review-complete");
  assert.match(render(reviewed), /검토 대상 고정/);
  assert.match(render(act(reviewed, "role", {role:"approver"})), /최종 승인하기/);
});

test("restored review keeps history but requires comparison again", () => {
  assert.equal(typeof mod.parseReviewLoopSession,"function");
  let s=approveReviewed(act(requested(),"role",{role:"reviewer"}));
  s=act(act(s,"role",{role:"author"}),"new-revision");
  const restored=mod.parseReviewLoopSession(JSON.stringify(s));
  assert.equal(restored.revision,2);
  assert.equal(restored.history[0].phase,"approved");
  assert.equal(restored.compared,false);
  for(const raw of ["bad","null",JSON.stringify({...s,page:-1}),JSON.stringify({...s,history:[{revision:1}]})]) assert.equal(mod.parseReviewLoopSession(raw),null);
});

test("new revisions keep an immutable approved snapshot and readable history", () => {
  let approved = approveReviewed(act(requested(), "role", {role:"reviewer"}));
  let next = act(act(approved, "role", {role:"author"}), "new-revision");
  assert.equal(next.history?.length, 1);
  assert.equal(next.history[0].phase, "approved");
  assert.equal(next.history[0].revision, 1);
  assert.equal(next.history[0].position, 1);
  next = act(next,"move",{page:3});
  assert.equal(next.history[0].position, 1);
  assert.equal(next.history[0].page, 2);
  const html=renderToStaticMarkup(React.createElement(mod.DrawingReviewLoop,{state:next,dispatch(){},ready:true,viewer:false,onLocate(){}}));
  assert.match(html,/이전 개정/);
  assert.match(html,/R1 · 승인된 개정 · 2쪽/);
  assert.match(html,/출입구 간섭 확인/);
  assert.equal(act(next,"reset").history.length,0);
});

test("correction keeps the previous revision and its original review reason",()=>{
 let s=act(requested(),"role",{role:"reviewer"});
 s=act(s,"changes",{message:"문 폭 확인"});
 s=act(act(act(s,"role",{role:"author"}),"focus"),"resolve");
 assert.equal(s.history?.[0]?.phase,"changes");
 assert.equal(s.history?.[0]?.issue,"문 폭 확인");
 assert.equal(s.history?.[0]?.revision,1);
});

test("an author submits a fixed page and revision but cannot decide their own request", () => {
  let s = requested();
  assert.equal(s.phase, "requested");
  assert.equal(s.page, 2);
  assert.equal(s.revision, 1);
  assert.equal(s.role, "author");
  assert.deepEqual(act(s, "approve"), s);
  assert.deepEqual(act(s, "move", { page: 3 }), s);
});
test("request requires a change and nonempty purpose", () => {
  const empty = start();
  assert.deepEqual(act(empty, "request", { message: "확인" }), empty);
  const moved = act(empty, "move", { page: 1 });
  assert.deepEqual(act(moved, "request", { message: "  " }), moved);
});
test("a location-linked issue survives correction and re-review of the next revision", () => {
  let s = act(requested(), "role", { role: "reviewer" });
  s = act(s, "changes", { message: "문을 벽 끝에서 더 이격해 주세요." });
  assert.equal(s.phase, "changes");
  assert.equal(s.issue, "문을 벽 끝에서 더 이격해 주세요.");
  s = act(s, "role", { role: "author" });
  assert.deepEqual(act(s, "resolve"), s, "must locate the issue before correction");
  s = act(act(s, "focus"), "resolve");
  assert.equal(s.phase, "revised");
  assert.equal(s.revision, 2, "correction belongs to a new draft, not the frozen request");
  assert.equal(s.page, 2);
  s = act(s, "request", { message: "간섭 의견 반영" });
  assert.equal(s.revision, 2);
  assert.equal(s.compared, false);
  assert.match(s.issue, /벽 끝/);
  s = act(s, "role", { role: "reviewer" });
  assert.deepEqual(act(s, "approve"), s, "uninspected changes cannot be approved");
  s = approveReviewed(s);
  assert.equal(s.phase, "approved");
  assert.deepEqual(act(s, "resolve"), s);
  s = act(s, "role", { role: "author" });
  s = act(s, "new-revision");
  assert.equal(s.phase, "draft");
  assert.equal(s.revision, 3);
});
test("reviewer cannot edit and an empty correction request is rejected", () => {
  const s = act(requested(), "role", { role: "reviewer" });
  assert.deepEqual(act(s, "move", { page: 1 }), s);
  assert.deepEqual(act(s, "changes", { message: " " }), s);
});
test("new revision retains the existing door and its page even when another page is open", () => {
  let s = act(requested(), "role", { role: "reviewer" });
  s = approveReviewed(s);
  s = act(act(s, "role", { role: "author" }), "new-revision");
  const html = renderToStaticMarkup(React.createElement(mod.DrawingReviewMarker, { state: s, onLocate() {} }));
  assert.match(html, /<svg/);
  s = act(s, "move", { page: 3 });
  assert.equal(s.page, 2);
  assert.equal(s.before, 1);
  assert.equal(s.position, 2);
});
test("author waiting UI has no approval actions and review remains an inline panel", () => {
  const html = renderToStaticMarkup(React.createElement(mod.DrawingReviewLoop, { state: requested(), dispatch() {}, ready: true, viewer: false, onLocate() {} }));
  assert.match(html, /검토 대기/);
  assert.doesNotMatch(html, /role="dialog"/);
  assert.doesNotMatch(html, />승인하기</);
  assert.match(html, /2쪽/);
});
test("Viewer has neither role switching nor mutation actions", () => {
  const html = renderToStaticMarkup(React.createElement(mod.DrawingReviewLoop, { state: start(), dispatch() {}, ready: true, viewer: true, onLocate() {} }));
  assert.match(html, /보기 전용/);
  assert.doesNotMatch(html, /<button|<textarea|<select/);
});
test("read-only review preserves the request and correction evidence", () => {
 const state={...requested(),issue:'문 간섭 재확인'};
 const html=renderToStaticMarkup(React.createElement(mod.DrawingReviewLoop,{state,dispatch(){},ready:true,viewer:true,onLocate(){}}));
 assert.match(html,/출입구 간섭 확인/);
 assert.match(html,/문 간섭 재확인/);
 assert.match(html,/2쪽/);
 assert.doesNotMatch(html,/<textarea|<select|체험 역할 전환/);
});

test("PDF workspace opens review beside the drawing, not in the old step wizard", async () => {
  const { DrawingPdfScreenPreview } = await vite.ssrLoadModule("/app/lukas/components/drawing-pdf-screen-preview.tsx");
  const html = renderToStaticMarkup(React.createElement(DrawingPdfScreenPreview, { startKind: "office", initialReviewState: "requested", initialWorkflowPanel: "review" }));
  assert.match(html, /aria-label="도면 검토 패널"/);
  assert.match(html, /office-plan.png/);
  assert.doesNotMatch(html, /1 도면|2 검토|3 내보내기/);
  assert.doesNotMatch(html, /role="dialog"/);
});

test("comment view reads the same location issue and updated resolution", () => {
  assert.equal(typeof mod.DrawingReviewIssueSummary, "function");
  let s = act(requested(), "role", { role: "reviewer" });
  s = act(s, "changes", { message: "문 간섭 수정" });
  const render = () => renderToStaticMarkup(React.createElement(mod.DrawingReviewIssueSummary, { state: s, onLocate() {} }));
  assert.match(render(), /문 간섭 수정/);
  assert.match(render(), /2쪽/);
  assert.match(render(), /미해결/);
  s = act(act(s, "role", { role: "author" }), "focus");
  s = act(s, "resolve");
  assert.match(render(), /재검토 대상/);
  s = act(act(s, "request", { message: "수정함" }), "role", { role: "reviewer" });
  s = approveReviewed(s);
  assert.match(render(), /해결됨/);
});

test("selected object inspection retains its review page and read-only state", () => {
  const s = requested();
  const html = renderToStaticMarkup(React.createElement(mod.DrawingReviewLoop, { state: s, dispatch() {}, ready: true, viewer: false, page: 4, onLocate() {} }));
  assert.match(html, /객체 속성/);
  assert.match(html, /검토 오버레이/);
  assert.match(html, /검토 대상 고정/);
  assert.doesNotMatch(html, /4쪽/);
});
