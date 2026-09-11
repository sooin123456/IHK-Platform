import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
const vite = await createServer({
  configFile: false,
  appType: "custom",
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
test.after(() => vite.close());

const mod = await vite
  .ssrLoadModule("/app/lukas/components/drawing-material-preview.tsx")
  .catch(() => ({}));
function render(props = {}) {
  assert.equal(typeof mod.DrawingMaterialPreview, "function");
  return renderToStaticMarkup(
    React.createElement(mod.DrawingMaterialPreview, {
      documentName: "구조.pdf",
      page: 3,
      ready: true,
      viewer: false,
      onReturn() {},
      ...props,
    }),
  );
}
test("material source accepts only positive integer page and revision references", () => {
  assert.equal(mod.isMaterialSourceReference({page:3,revision:2}),true);
  assert.equal(mod.isMaterialSourceReference({page:3,revision:2,source:{kind:"pdf",paper:"A3",fingerprint:"a".repeat(64)}}),true);
  for(const source of [{kind:"url",paper:"A3"},{kind:"office",paper:"A0"},{kind:"pdf",paper:"A3",fingerprint:"invalid"}])assert.equal(mod.isMaterialSourceReference({page:1,revision:1,source}),false);
  assert.equal(mod.isMaterialSourceReference({page:3,revision:1,source:{kind:"office",paper:"A3"}}),false);
  for(const value of [null,{}, {page:0,revision:1},{page:1,revision:0},{page:1.5,revision:2},{page:"3",revision:2},{page:1,revision:Infinity}])assert.equal(mod.isMaterialSourceReference(value),false);
});
test("material keeps drawing lineage without turning example quantity into an order", () => {
  const h = render();
  assert.match(h, /A01 → Q01 → B01/);
  assert.match(h, /구조.pdf/);
  assert.match(h, /3쪽/);
  assert.match(h, /발주수량 미확정/);
});
test("order and receipt are drafts with no financial commitment", () => {
  for (const stage of ["order", "receipt"]) {
    const h = render({ stage });
    assert.match(h, /실제 발주·입고·저장 없음/);
    assert.match(h, /<fieldset/);
    assert.doesNotMatch(h, /발주 완료|입고 완료/);
  }
});
test("Viewer cannot edit receipt and missing source cannot fabricate material", () => {
  assert.match(
    render({ viewer: true, stage: "receipt" }),
    /<fieldset disabled/,
  );
  assert.match(render({ ready: false }), /도면을 먼저/);
});
test("carbon evidence is unknown rather than zero", () => {
  const h = render({ stage: "evidence" });
  assert.match(h, /탄소량 미산정/);
  assert.match(h, /EPD/);
  assert.doesNotMatch(h, /0 kg/);
});
test("evidence offers an explicit fictional link example", () => {
  assert.match(render({ stage: "evidence" }), /근거 연결 예시 보기/);
});
