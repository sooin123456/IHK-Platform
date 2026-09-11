import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
test.after(() => vite.close());
const module = await vite
  .ssrLoadModule("/app/lukas/components/drawing-workbench-preview.tsx")
  .catch(() => ({}));
const base = {
  section: "blocks",
  documentName: "구조.pdf",
  page: 3,
  ready: true,
  viewer: false,
};
const render = (props = {}) => {
  assert.equal(
    typeof module.WorkbenchPreviewBody,
    "function",
    "missing workbench screen body",
  );
  return renderToStaticMarkup(
    React.createElement(module.WorkbenchPreviewBody, { ...base, ...props }),
  );
};

test('connected block placement respects readonly and unavailable drawing contexts',()=>{
 for(const props of [{viewer:true},{authoringReadOnly:true},{ready:false}]){
  assert.match(render({onChooseBlock(){},...props}),/<button[^>]*disabled=""[^>]*>이 블록 도면에 배치<\/button>/);
 }
 const html=render({onChooseBlock(){}});
 assert.match(html,/이 블록 도면에 배치/);
 assert.doesNotMatch(html,/<button[^>]*disabled=""[^>]*>이 블록 도면에 배치<\/button>/);
 assert.doesNotMatch(html,/새로고침하면 초기화됩니다/);
});

test('drawing properties retain valid metadata and reject malformed stored metadata',async()=>{
 const {parseScreenDraft}=await vite.ssrLoadModule('/app/lukas/lib/drawing-screen-draft-storage.ts');
 const object={id:'one',name:'벽',kind:'사각형',page:1,x:0,y:0,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''};
 const raw=properties=>JSON.stringify({schemaVersion:1,source:'office:A3',objects:[{...object,...(properties===undefined?{}:{properties})}],layers:[{id:'review',name:'검토',visible:true,locked:false}]});
 const properties={classification:'구조',code:'STR-01',note:'확인',required:true};
 assert.deepEqual(parseScreenDraft(raw(properties),'office:A3').objects[0].properties,properties);
 assert.equal(parseScreenDraft(raw(undefined),'office:A3').objects[0].properties,undefined);
 for(const bad of [null,[],{...properties,code:'x'.repeat(41)},{...properties,note:'x'.repeat(501)},{...properties,classification:'임의'},{...properties,required:'true'}])assert.throws(()=>parseScreenDraft(raw(bad),'office:A3'));
});

test('connected authoring disables placement for readonly and missing drawing contexts',()=>{
 for(const props of [{viewer:true},{authoringReadOnly:true},{ready:false}]){
  const html=render({section:'authoring',onChooseTool(){},...props});
  assert.match(html,/<button[^>]*disabled=""[^>]*aria-label="사각형 · 도면에 배치"/);
 }
 const html=render({section:'authoring',onChooseTool(){}});
 assert.doesNotMatch(html,/<button[^>]*disabled=""/);
 assert.doesNotMatch(html,/예시 선 A|시작 X/);
});

test("all workbench sections retain drawing context without promising source edits", () => {
  for (const section of ["blocks", "styles", "properties", "schedules"]) {
    const html = render({ section });
    assert.match(html, /구조.pdf/);
    assert.match(html, /3쪽/);
    assert.match(html, /원본 도면에 적용되지 않습니다/);
  }
});
test("block search has a labelled control and details but no geometry insertion action", () => {
  const html = render();
  assert.match(html, /블록 검색/);
  assert.match(html, /단일 여닫이문/);
  assert.match(html, /도면에 배치되지 않습니다/);
  assert.doesNotMatch(html, /블록 삽입 완료|저장됨/);
});
test("viewer can inspect style and property values but cannot edit them", () => {
  for (const section of ["styles", "properties"]) {
    const html = render({ section, viewer: true });
    assert.match(html, /<fieldset[^>]*disabled/);
    assert.match(html, /보기 전용/);
  }
});

test('selected style controls are disabled for viewers, locked selection and absent apply capability',()=>{
 const selectedObjects=[{id:'one',name:'선택 벽',kind:'사각형',page:3,x:0,y:0,layer:'review',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''}];
 for(const props of [{viewer:true,onApplyStyle(){}},{styleReadOnly:true,onApplyStyle(){}},{}]){
  const html=render({section:'styles',selectedObjects,...props});
  assert.match(html,/<fieldset[^>]*disabled=""/);
  assert.match(html,/<button[^>]*disabled=""[^>]*>선택한 도형에 스타일 적용<\/button>/);
 }
 const editable=render({section:'styles',selectedObjects,onApplyStyle(){}});
 assert.doesNotMatch(editable,/<fieldset[^>]*disabled=""/);
});

test('real drawing schedule has an empty state instead of invented room rows',()=>{
 const html=render({section:'schedules',drawingObjects:[]});
 assert.match(html,/작성한 도형이 없습니다/);assert.doesNotMatch(html,/R-01|R-02|<table/);
});
test('real drawing schedule shows object page and hidden locked layer without fabricated quantities',()=>{
 const html=render({section:'schedules',drawingObjects:[{id:'real',name:'<wall>',kind:'사각형',page:7,x:0,y:0,layer:'layer',color:'#6650f5',lineWidth:'0.25 mm',fill:'없음',text:''}],layers:[{id:'layer',name:'구조',visible:false,locked:true}],onLocateObject(){}});
 assert.match(html,/&lt;wall&gt;/);assert.match(html,/7쪽/);assert.match(html,/숨김 · 잠금/);
 assert.doesNotMatch(html,/R-01|13\.00|<wall>/);
});
test("no drawing shows schedule guidance instead of fabricated room rows", () => {
  const html = render({
    section: "schedules",
    ready: false,
    page: 0,
    documentName: "",
  });
  assert.match(html, /도면을 먼저 열어/);
  assert.doesNotMatch(html, /<table|회의실|3쪽/);
});
test("schedule rows are explicitly examples and source values are escaped", () => {
  const html = render({
    section: "schedules",
    documentName: "<script>bad</script>",
  });
  assert.match(html, /<table/);
  assert.match(html, /도면에서 추출한 결과가 아닙니다/);
  assert.doesNotMatch(html, /<script>/);
});
