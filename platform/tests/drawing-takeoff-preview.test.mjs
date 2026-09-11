import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
const vite = await createServer({ appType: "custom", configFile: false, logLevel: "silent", resolve: { alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) } }, server: { middlewareMode: true } });
const { TakeoffPreviewBody } = await vite.ssrLoadModule("/app/lukas/components/drawing-takeoff-preview.tsx");
test.after(() => vite.close());
test('selected takeoff drafts reject corrupt rows instead of replacing them',async()=>{
 const {parseSelectedTakeoffDrafts}=await vite.ssrLoadModule('/app/lukas/lib/drawing-selected-takeoff-storage.ts');
 const rows={a:{name:'바닥',trade:'건축 마감',step:'quantity'}};
 assert.deepEqual(parseSelectedTakeoffDrafts(JSON.stringify({schemaVersion:1,rows})),rows);
 for(const value of [null,{}, {schemaVersion:2,rows},{schemaVersion:1,rows:[]},{schemaVersion:1,rows:{a:{...rows.a,trade:'unknown'}}},{schemaVersion:1,rows:{a:{...rows.a,name:'a'.repeat(81)}}}])assert.throws(()=>parseSelectedTakeoffDrafts(JSON.stringify(value)));
});
const base = { documentName: "구조.pdf", sourceLabel: "원본 PDF", page: 7, ready: true, viewer: false, step: "area", name: "검토 구역", trade: "구조", onStep() {}, onName() {}, onTrade() {}, onReturn() {} };
const render = (props = {}) => renderToStaticMarkup(React.createElement(TakeoffPreviewBody, { ...base, ...props }));
test("quantity comparison distinguishes illustrative snapshots from actual drawing revisions", () => {
 const html=render({step:"quantity",reviewContext:{revision:4,page:7}});
 assert.match(html,/수량·금액 변경 비교/);
 assert.match(html,/실제 R4 개정에서 산출한 비교가 아닙니다/);
 assert.match(html,/기준 예시/);
 assert.match(html,/변경 예시/);
 assert.match(html,/\+10,000원/);
 assert.match(html,/변경 수량의 A01 근거 확인/);
 assert.doesNotMatch(render({ready:false}),/수량·금액 변경 비교/);
});
test("unclassified quantities identify missing mapping and provide a correction destination", () => {
 const html=render({step:"quantity",trade:"미분류"});
 assert.match(html,/공종 연결 필요/);
 assert.match(html,/영역 속성에서 공종 선택/);
 assert.match(html,/축척·보정 근거 미등록/);
 assert.match(html,/근거 위치 확인/);
 assert.doesNotMatch(render({step:"quantity",trade:"구조"}),/공종 연결 필요/);
});
test("every stage identifies the same local page and explicitly disclaims measured quantities", () => {
  for (const step of ["area", "quantity", "estimate"]) {
    const html = render({ step });
    assert.match(html, /구조.pdf/); assert.match(html, /7쪽/); assert.match(html, /A01/);
    assert.match(html, /도면에서 추출한 값이 아닙니다/);
    assert.match(html, /도면의 A01 위치로 돌아가기/);
  }
});
test("quantity and estimate rows expose their original-anchor return action", () => {
  assert.match(render({ step: "quantity" }), /aria-label="Q01 행의 A01 도면 근거 보기"/);
  assert.match(render({ step: "estimate" }), /aria-label="B01 행의 A01 도면 근거 보기"/);
  assert.match(render({ step: "quantity" }), /검토 구역/);
  assert.match(render({ step: "estimate" }), /검토 구역/);
});
test("viewer may inspect example rows but cannot edit area properties", () => {
  const html = render({ viewer: true });
  assert.match(html, /<input[^>]*disabled/); assert.match(html, /<select[^>]*disabled/);
  assert.match(html, /보기 전용/);
});
test("no source means no area, quantity or cost is fabricated", () => {
  const html = render({ ready: false, page: 0, step: "estimate" });
  assert.match(html, /도면을 먼저 열어/);
  assert.doesNotMatch(html, /130,000|12.50|<table|물량·내역 단계/);
});
test("an empty edited name retains a usable row label and no markup injection", () => {
  assert.match(render({ step: "quantity", name: "  " }), /이름 없는 영역/);
  assert.doesNotMatch(render({ step: "estimate", name: "<script>bad</script>" }), /<script>/);
});
test("takeoff shows the drawing review lineage without inheriting quantity approval", () => {
  const html = render({ step: "quantity", reviewContext: { revision: 2, page: 1 } });
  assert.match(html, /R2 · 1쪽 · D01/);
  assert.match(html, /7쪽/);
  assert.match(html, /물량·금액 승인은 별도/);
});
