import React from "react";
import { renderToString } from "react-dom/server";
import WorkspacePreviewRoom from "../app/lukas/components/workspace-preview-room";

const html = renderToString(
  <WorkspacePreviewRoom
    fileId="preview-drawing"
    projectId="preview-community-center"
  />,
);

if (!html.includes("도면 작업실") || !html.includes("도면 이슈")) {
  throw new Error(
    "로컬 도면 작업실 SSR 결과가 예상한 화면을 포함하지 않습니다.",
  );
}

console.log("workspace preview room SSR passed");
