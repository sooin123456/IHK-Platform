import assert from "node:assert/strict";
import test from "node:test";

import {
  loadDrawingRevisionReview,
  parseRelinkDrawingAnchorForm,
  relinkDrawingIssueAnchor,
} from "../app/lukas/lib/drawing-revision.server.ts";

import { p5Ids } from "./fixtures/drawing-workspace-p5-database-fixtures.mjs";

function queryResult(data, { single = false, neqResult } = {}) {
  const result = { data, error: null };
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    in() {
      return query;
    },
    neq() {
      return neqResult === undefined ? query : queryResult(neqResult);
    },
    maybeSingle() {
      return Promise.resolve(single ? result : { data: null, error: null });
    },
    then(resolve, reject) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

test("an unmatched IFC revision anchor remains visible for manual re-anchoring", async () => {
  const client = {
    from(table) {
      if (table === "lukas_qto_file_revisions")
        return queryResult(
          {
            project_id: "project-1",
            previous_file_id: "ifc-old",
            current_file_id: "ifc-new",
          },
          { single: true },
        );
      if (table === "lukas_drawing_issue_anchors")
        return queryResult([
          {
            id: "anchor-1",
            issue_id: "issue-1",
            file_id: "ifc-old",
            anchor_kind: "ifc_element",
            ifc_global_id: "0Q2gXl1Hn3fQ9A2W4k6M8P",
            active: true,
          },
        ]);
      if (table === "lukas_drawing_issues")
        return queryResult([
          {
            id: "issue-1",
            project_id: "project-1",
            title: "기둥 위치 확인",
            status: "open",
          },
        ]);
      if (table === "lukas_qto_element_identity_links") return queryResult([]);
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const result = await loadDrawingRevisionReview(
    client,
    "project-1",
    "ifc-new",
  );

  assert.deepEqual(result, [
    {
      issueId: "issue-1",
      issueTitle: "기둥 위치 확인",
      previousAnchorId: "anchor-1",
      previousFileId: "ifc-old",
      sourceKind: "ifc_element",
      kind: "manual_reanchor_required",
      ifcGlobalId: null,
    },
  ]);
});

test("closed issues keep their active drawing evidence in revision review", async () => {
  const client = {
    from(table) {
      if (table === "lukas_qto_file_revisions")
        return queryResult(
          {
            project_id: "project-1",
            previous_file_id: "pdf-old",
            current_file_id: "pdf-new",
          },
          { single: true },
        );
      if (table === "lukas_drawing_issue_anchors")
        return queryResult([
          {
            id: "anchor-closed",
            issue_id: "issue-closed",
            file_id: "pdf-old",
            anchor_kind: "pdf_region",
            ifc_global_id: null,
            active: true,
          },
        ]);
      if (table === "lukas_drawing_issues")
        return queryResult(
          [
            {
              id: "issue-closed",
              project_id: "project-1",
              title: "준공 승인 근거",
              status: "closed",
            },
          ],
          { neqResult: [] },
        );
      if (table === "lukas_qto_element_identity_links") return queryResult([]);
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const result = await loadDrawingRevisionReview(
    client,
    "project-1",
    "pdf-new",
  );

  assert.deepEqual(result, [
    {
      issueId: "issue-closed",
      issueTitle: "준공 승인 근거",
      previousAnchorId: "anchor-closed",
      previousFileId: "pdf-old",
      sourceKind: "pdf_region",
      kind: "manual_reanchor_required",
      ifcGlobalId: null,
    },
  ]);
});

test("issue re-anchoring is one typed atomic RPC call", async () => {
  const calls = [];
  const client = {
    async rpc(name, args) {
      calls.push([name, args]);
      return {
        data: {
          previousAnchorId: p5Ids.previousAnchor,
          newAnchorId: p5Ids.replacementAnchor,
        },
        error: null,
      };
    },
  };
  const result = await relinkDrawingIssueAnchor(client, {
    previousAnchorId: p5Ids.previousAnchor,
    newAnchorId: p5Ids.replacementAnchor,
    currentFileId: p5Ids.pdfFile,
    anchor: {
      kind: "pdf_region",
      fileId: p5Ids.pdfFile,
      pageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      label: "검토 위치",
    },
    note: "새 개정본 위치로 이동",
  });
  assert.deepEqual(result, {
    previousAnchorId: p5Ids.previousAnchor,
    newAnchorId: p5Ids.replacementAnchor,
  });
  assert.deepEqual(calls, [
    [
      "lukas_drawing_relink_issue_anchor",
      {
        p_previous_anchor_id: p5Ids.previousAnchor,
        p_new_anchor_id: p5Ids.replacementAnchor,
        p_current_file_id: p5Ids.pdfFile,
        p_anchor: {
          kind: "pdf_region",
          fileId: p5Ids.pdfFile,
          pageNumber: 1,
          x: 0.1,
          y: 0.2,
          width: 0.3,
          height: 0.4,
          label: "검토 위치",
        },
        p_note: "새 개정본 위치로 이동",
      },
    ],
  ]);
});

test("relink review form creates one exact new PDF candidate without predecessor coordinates", () => {
  const form = new FormData();
  form.set("intent", "relink_anchor");
  form.set("previous_anchor_id", p5Ids.previousAnchor);
  form.set("new_anchor_id", p5Ids.replacementAnchor);
  form.set("current_file_id", p5Ids.pdfFile);
  form.set(
    "anchor_json",
    JSON.stringify({
      kind: "pdf_region",
      fileId: p5Ids.pdfFile,
      pageNumber: 3,
      x: 0.51,
      y: 0.42,
      width: 0.2,
      height: 0.1,
      label: "사용자가 새 개정본에서 선택",
    }),
  );
  form.set("note", "새 도면에서 직접 확인");

  assert.deepEqual(parseRelinkDrawingAnchorForm(form), {
    previousAnchorId: p5Ids.previousAnchor,
    newAnchorId: p5Ids.replacementAnchor,
    currentFileId: p5Ids.pdfFile,
    anchor: {
      kind: "pdf_region",
      fileId: p5Ids.pdfFile,
      pageNumber: 3,
      x: 0.51,
      y: 0.42,
      width: 0.2,
      height: 0.1,
      label: "사용자가 새 개정본에서 선택",
    },
    note: "새 도면에서 직접 확인",
  });
});

test("relink review form rejects copied or mismatched candidate payloads", () => {
  for (const anchor of [
    {
      kind: "pdf_region",
      fileId: p5Ids.ifcFile,
      pageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      label: "wrong file",
    },
    {
      kind: "pdf_region",
      fileId: p5Ids.pdfFile,
      pageNumber: 1,
      x: 0.1,
      y: 0.2,
      width: 0.3,
      height: 0.4,
      label: "extra key",
      pixels: { x: 10, y: 20 },
    },
  ]) {
    const form = new FormData();
    form.set("intent", "relink_anchor");
    form.set("previous_anchor_id", p5Ids.previousAnchor);
    form.set("new_anchor_id", p5Ids.replacementAnchor);
    form.set("current_file_id", p5Ids.pdfFile);
    form.set("anchor_json", JSON.stringify(anchor));
    form.set("note", "새 위치 확인");
    assert.throws(() => parseRelinkDrawingAnchorForm(form));
  }
});
