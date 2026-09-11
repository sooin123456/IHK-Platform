import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {createServer} from "vite";
import {fileURLToPath} from "node:url";
const vite=await createServer({configFile:false,appType:"custom",logLevel:"silent",resolve:{alias:{"~":fileURLToPath(new URL("../app",import.meta.url))}},server:{middlewareMode:true}});
test.after(()=>vite.close());
test("preparation progress offers cancellation and explicit simulated outcomes, not a fake download",async()=>{
 const m=await vite.ssrLoadModule("/app/lukas/components/drawing-native-start-preview.tsx");
 assert.equal(typeof m.NativePreparationProgress,"function");
 const html=renderToStaticMarkup(React.createElement(m.NativePreparationProgress,{onCancel(){},onFailure(){},onContinue(){}}));
 assert.match(html,/role="status"/);
 assert.match(html,/준비 취소/);
 assert.match(html,/실패 상태 체험/);
 assert.match(html,/작업실 화면으로 계속/);
 assert.match(html,/실제 파일 처리/);
 assert.doesNotMatch(html,/다운로드 완료|100%/);
});
test("DWG preparation offers model/layout and roundtrip constraints without claiming parsing",async()=>{
 const m=await vite.ssrLoadModule("/app/lukas/components/drawing-native-start-preview.tsx");
 const html=renderToStaticMarkup(React.createElement(m.DrawingNativeStartPreview,{kind:"dwg",onOpen(){}}));
 assert.match(html,/DWG/); assert.match(html,/모델 공간/); assert.match(html,/레이아웃/);
 assert.match(html,/외부참조/); assert.match(html,/재저장/); assert.match(html,/해석하지 않습니다/);
 assert.match(html,/파일 없이 준비 화면 체험/);
});
test("IFC preparation avoids DWG export claims and explains unconnected 3D",async()=>{
 const m=await vite.ssrLoadModule("/app/lukas/components/drawing-native-start-preview.tsx");
 const html=renderToStaticMarkup(React.createElement(m.DrawingNativeStartPreview,{kind:"ifc",onOpen(){}}));
 assert.match(html,/IFC/); assert.match(html,/분할 보기/);
 assert.doesNotMatch(html,/DWG 납품/);
});
