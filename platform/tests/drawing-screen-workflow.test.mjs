import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

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

const workflow = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-screen-workflow.tsx",
);

test.after(() => vite.close());

test("export embeds project report preparation without navigating away from the drawing", () => {
  const html = renderBody({open:"export",returnHref:"/workspace-preview?project=00000000-0000-4000-8000-000000000101"});
  assert.match(html,/aria-label="프로젝트 변경 보고서"/);
  assert.match(html,/변경 회차를 불러오고 있습니다/);
});

test("standalone and untrusted return routes cannot load another project's reports", () => {
  for (const returnHref of ["/workspace-preview", "https://evil.example/workspace-preview?project=00000000-0000-4000-8000-000000000101", "/workspace-preview?project=invalid"]) {
    const html=renderBody({open:"export",returnHref});
    assert.match(html,/프로젝트에 연결된 도면에서 변경 보고서를 구성/);
    assert.doesNotMatch(html,/변경 회차를 불러오고 있습니다/);
  }
});

test("empty source sharing cannot expose an invitation form", () => {
 const html=renderBody({open:"share",ready:false});
 assert.match(html,/도면을 먼저/);
 assert.doesNotMatch(html,/<form/);
});

const baseProps = {
  documentName: "성수동 1층 평면도",
  onOpenChange() {},
  onReviewStateChange() {},
  open: "review",
  page: 2,
  pageCount: 4,
  ready: true,
  returnHref: "/workspace-preview?project=project-101&tab=files",
  reviewState: "draft",
  viewer: false,
};

function renderBody(overrides = {}) {
  return renderToStaticMarkup(
    React.createElement(workflow.DrawingScreenWorkflowBody, {
      ...baseProps,
      ...overrides,
    }),
  );
}

test("draft review renders a keyboard-submittable simulated request without claiming delivery", () => {
  const html = renderBody();

  assert.match(html, /화면 시뮬레이션 · 전송·승인·파일 생성 없음/);
  assert.match(html, /성수동 1층 평면도/);
  assert.match(html, /2 \/ 4쪽/);
  assert.match(html, /<form/);
  assert.match(html, /name="recipientRole"/);
  assert.match(
    html,
    /<option value="reviewer" selected="">검토자 예시<\/option>/,
  );
  assert.match(
    html,
    /<textarea(?=[^>]*name="message")(?=[^>]*maxLength="500")[^>]*>/,
  );
  assert.match(html, /<button[^>]*type="submit"[^>]*>[^<]*검토 요청 화면 보기/);
  assert.doesNotMatch(html, /요청이 전송되었습니다/);
});

test("review shows a guided empty state until a document is ready", () => {
  const html = renderBody({ ready: false, pageCount: 0 });

  assert.match(html, /도면을 먼저 준비해 주세요/);
  assert.doesNotMatch(html, /1 \/ 1쪽/);
  assert.match(html, /도면 화면으로 돌아가 페이지를 준비/);
  assert.match(
    html,
    /href="\/workspace-preview\?project=project-101&amp;tab=files"/,
  );
  assert.doesNotMatch(
    html,
    /검토 요청 화면 보기|승인 완료 화면 보기|변경 요청 화면 보기/,
  );
});

test("requested review exposes checks and both simulated decisions only to a non-viewer", () => {
  const editor = renderBody({ reviewState: "requested" });
  const viewer = renderBody({ reviewState: "requested", viewer: true });

  for (const label of ["도면명과 페이지 확인", "검토 의견 확인"])
    assert.match(editor, new RegExp(label));
  assert.match(editor, /승인 완료 화면 보기/);
  assert.match(editor, /name="reason"[^>]*required/);
  assert.match(editor, /변경 요청 화면 보기/);

  assert.match(viewer, /검토 요청 상태 화면 예시/);
  assert.match(viewer, /보기 전용/);
  assert.match(viewer, />도면으로 돌아가기<\/button>/);
  assert.match(
    viewer,
    /href="\/workspace-preview\?project=project-101&amp;tab=files"[^>]*>프로젝트\/시작 화면으로 돌아가기<\/a>/,
  );
  assert.doesNotMatch(
    viewer,
    /승인 완료 화면 보기|변경 요청 화면 보기|name="reason"/,
  );
});

test("changes and approved review states provide the next local workflow step", () => {
  const changes = renderBody({ reviewState: "changes" });
  const approved = renderBody({ reviewState: "approved" });

  assert.match(changes, /변경 요청 화면 예시/);
  assert.match(changes, /초안으로 돌아가기/);
  assert.match(approved, /승인 완료 화면 예시/);
  assert.match(approved, /실제로 승인되지 않았습니다/);
  assert.match(approved, /내보내기 설정 보기/);
});

test("export settings cover every requested preview option and respect readiness", () => {
  const ready = renderBody({ open: "export" });
  const waiting = renderBody({ open: "export", ready: false });

  for (const format of ["PDF", "PNG", "SVG", "DWG"])
    assert.match(ready, new RegExp(`value="${format.toLowerCase()}"`));
  assert.match(ready, /DWG 변환 엔진 미연결/);
  assert.match(ready, /value="current"/);
  assert.match(ready, /value="all"/);
  assert.match(ready, /name="includeComments"/);
  assert.match(ready, /<button[^>]*type="submit"[^>]*>[^<]*납품 구성으로 계속/);
  assert.doesNotMatch(
    ready,
    /<button[^>]*disabled=""[^>]*>[^<]*납품 구성으로 계속/,
  );
  assert.match(waiting, /화면 준비 중/);
  assert.match(waiting, /<button[^>]*disabled=""[^>]*>[^<]*납품 구성으로 계속/);
});

test("export completion remains an explicit no-file example with return and reset choices", () => {
  const html = renderToStaticMarkup(
    React.createElement(workflow.DrawingScreenExportBody, {
      complete: true,
      documentName: baseProps.documentName,
      onBackToReview() {},
      onComplete() {},
      onResetExport() {},
      page: baseProps.page,
      pageCount: baseProps.pageCount,
      ready: true,
      returnHref: baseProps.returnHref,
      selection: {
        format: "png",
        includeComments: true,
        pageRange: "all",
      },
      viewer: false,
    }),
  );

  assert.match(html, /내보내기 완료 화면 예시/);
  assert.match(html, /실제 파일은 생성되지 않았습니다/);
  assert.match(
    html,
    /href="\/workspace-preview\?project=project-101&amp;tab=files"/,
  );
  assert.match(html, /검토로 돌아가기/);
  assert.match(html, /내보내기 설정 다시 보기/);
  assert.match(html, /PNG/);
  assert.match(html, /전체 페이지/);
  assert.match(html, /댓글 포함/);
  assert.doesNotMatch(html, / download(?:=|>)/);
});

test("share is a local invitation preview with no sent or copy-link claim", () => {
  const form = renderBody({ open: "share" });
  const preview = renderToStaticMarkup(
    React.createElement(workflow.DrawingScreenShareBody, {
      confirmed: true,
      documentName: baseProps.documentName,
      onConfirm() {},
      onReset() {},
      selection: {
        email: "reviewer@example.com",
        role: "commenter",
      },
      viewer: false,
    }),
  );

  assert.match(form, /type="email"/);
  for (const role of ["Viewer", "Commenter", "Editor"])
    assert.match(form, new RegExp(`>${role}<`));
  assert.match(form, /초대 화면 확인/);
  assert.match(preview, /초대 확인 화면 예시/);
  assert.match(preview, /실제 초대는 전송되지 않았습니다/);
  assert.match(preview, /reviewer@example\.com/);
  assert.match(preview, /Commenter/);
  assert.doesNotMatch(`${form}${preview}`, /초대가 전송되었습니다|링크 복사/);
});

test("viewer can inspect export completion and reconfigure without changing review state", () => {
  const html = renderToStaticMarkup(
    React.createElement(workflow.DrawingScreenExportBody, {
      complete: true,
      documentName: baseProps.documentName,
      onBackToReview() {},
      onComplete() {},
      onResetExport() {},
      page: baseProps.page,
      pageCount: baseProps.pageCount,
      ready: true,
      returnHref: baseProps.returnHref,
      selection: {
        format: "pdf",
        includeComments: false,
        pageRange: "current",
      },
      viewer: true,
    }),
  );

  assert.match(html, /내보내기 완료 화면 예시/);
  assert.match(html, />도면으로 돌아가기<\/button>/);
  assert.match(html, /검토로 돌아가기/);
  assert.match(html, /프로젝트\/시작 화면으로 돌아가기/);
  assert.match(html, /내보내기 설정 다시 보기/);
  assert.doesNotMatch(html, /검토 상태 초기화/);
});

test("viewer sees share as read-only and cannot submit an invitation or change roles", () => {
  const html = renderBody({ open: "share", viewer: true });

  assert.match(html, /공유 설정 보기 전용/);
  assert.match(html, />도면으로 돌아가기<\/button>/);
  assert.match(html, /프로젝트\/시작 화면으로 돌아가기/);
  assert.doesNotMatch(
    html,
    /type="email"|name="role"|초대 화면 확인|초대 설정으로 돌아가기/,
  );
});

test("returning to draft keeps the prior recipient and request message editable", () => {
  const html = renderToStaticMarkup(
    React.createElement(workflow.DrawingScreenReviewBody, {
      documentName: baseProps.documentName,
      onOpenChange() {},
      onReviewStateChange() {},
      page: baseProps.page,
      pageCount: baseProps.pageCount,
      ready: true,
      returnHref: baseProps.returnHref,
      reviewSession: {
        changeReason: "문 위치를 다시 확인해 주세요.",
        checks: { comments: false, document: false },
        recipientRole: "approver",
        requestedMessage: "2쪽 출입문 치수를 확인해 주세요.",
      },
      reviewState: "draft",
      setReviewSession() {},
      viewer: false,
    }),
  );

  assert.match(
    html,
    /<option value="approver" selected="">승인자 예시<\/option>/,
  );
  assert.match(
    html,
    /<textarea(?=[^>]*name="message")[^>]*>2쪽 출입문 치수를 확인해 주세요\.<\/textarea>/,
  );
});

test("requested review identifies the selected recipient role", () => {
  const html = renderToStaticMarkup(
    React.createElement(workflow.DrawingScreenReviewBody, {
      documentName: baseProps.documentName,
      onOpenChange() {},
      onReviewStateChange() {},
      page: baseProps.page,
      pageCount: baseProps.pageCount,
      ready: true,
      returnHref: baseProps.returnHref,
      reviewSession: {
        changeReason: "",
        checks: { comments: false, document: false },
        recipientRole: "site",
        requestedMessage: "현장 확인을 요청합니다.",
      },
      reviewState: "requested",
      setReviewSession() {},
      viewer: false,
    }),
  );

  assert.match(html, /받는 역할/);
  assert.match(html, /현장 담당자 예시/);
  assert.match(html, /현장 확인을 요청합니다/);
});
