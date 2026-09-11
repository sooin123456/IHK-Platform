import assert from "node:assert/strict";
import test from "node:test";

import {
  assertGenericDrawingAnchorMutationAllowed,
  drawingRevisionReviewBatchSize,
  DrawingRevisionRelinkError,
  loadDrawingRevisionReviewCandidate,
  loadDrawingRevisionReviewPage,
  loadDrawingRevisionReview,
  loadDrawingRevisionRelinkReplay,
  parseDrawingRevisionReviewCursor,
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
    order() {
      return query;
    },
    limit() {
      return Promise.resolve(result);
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

test("revision review cursor accepts only one stable anchor ID", () => {
  const cursor = "00000000-0000-4000-8000-000000000051";
  assert.equal(parseDrawingRevisionReviewCursor(null), null);
  assert.equal(parseDrawingRevisionReviewCursor(cursor), cursor);
  assert.throws(() => parseDrawingRevisionReviewCursor("anchor-051"));
});

test("revision review reads one bounded predecessor batch", async () => {
  const anchors = Array.from({ length: 60 }, (_, index) => ({
    id: `anchor-${index}`,
    issue_id: `issue-${index}`,
    file_id: "pdf-old",
    anchor_kind: "pdf_region",
    ifc_global_id: null,
    active: true,
  }));
  let observedLimit = null;
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
      if (table === "lukas_drawing_issue_anchors") {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          order() {
            return query;
          },
          limit(value) {
            observedLimit = value;
            return Promise.resolve({
              data: anchors.slice(0, value),
              error: null,
            });
          },
        };
        return query;
      }
      if (table === "lukas_drawing_issues")
        return queryResult(
          anchors.slice(0, drawingRevisionReviewBatchSize).map((anchor) => ({
            id: anchor.issue_id,
            project_id: "project-1",
            title: anchor.issue_id,
            status: "open",
          })),
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
  assert.equal(observedLimit, drawingRevisionReviewBatchSize + 1);
  assert.equal(result.length, drawingRevisionReviewBatchSize);
});

test("revision review continuation reaches anchors after the first bounded page", async () => {
  const anchors = Array.from({ length: 101 }, (_, index) => ({
    id: `anchor-${String(index + 1).padStart(3, "0")}`,
    issue_id: `issue-${index + 1}`,
    file_id: "pdf-old",
    anchor_kind: "pdf_region",
    ifc_global_id: null,
    active: true,
  }));
  const cursorCalls = [];
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
      if (table === "lukas_drawing_issue_anchors") {
        let after = null;
        let before = null;
        let descending = false;
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          gt(_column, value) {
            after = value;
            cursorCalls.push(value);
            return query;
          },
          lt(_column, value) {
            before = value;
            return query;
          },
          order(_column, options) {
            descending = options?.ascending === false;
            return query;
          },
          limit(value) {
            return Promise.resolve({
              data: anchors
                .filter(
                  (anchor) =>
                    (!after || anchor.id > after) &&
                    (!before || anchor.id < before),
                )
                .sort((left, right) =>
                  descending
                    ? right.id.localeCompare(left.id)
                    : left.id.localeCompare(right.id),
                )
                .slice(0, value),
              error: null,
            });
          },
        };
        return query;
      }
      if (table === "lukas_drawing_issues")
        return queryResult(
          anchors.map((anchor) => ({
            id: anchor.issue_id,
            project_id: "project-1",
            title: anchor.issue_id,
            status: "open",
          })),
        );
      if (table === "lukas_qto_element_identity_links") return queryResult([]);
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  const first = await loadDrawingRevisionReviewPage(
    client,
    "project-1",
    "pdf-new",
  );
  assert.equal(first.items.length, drawingRevisionReviewBatchSize);
  assert.equal(first.nextCursor, "anchor-050");
  assert.equal(first.previousCursor, null);

  const second = await loadDrawingRevisionReviewPage(
    client,
    "project-1",
    "pdf-new",
    first.nextCursor,
  );
  assert.equal(second.items.length, drawingRevisionReviewBatchSize);
  assert.equal(second.items.at(0)?.previousAnchorId, "anchor-051");
  assert.equal(second.nextCursor, "anchor-100");
  assert.equal(second.previousCursor, null);

  const third = await loadDrawingRevisionReviewPage(
    client,
    "project-1",
    "pdf-new",
    second.nextCursor,
  );
  assert.deepEqual(
    third.items.map((item) => item.previousAnchorId),
    ["anchor-101"],
  );
  assert.equal(third.nextCursor, null);
  assert.equal(third.previousCursor, "anchor-050");
  assert.deepEqual(cursorCalls, ["anchor-050", "anchor-100"]);
});

test("exact revision candidate lookup authorizes an anchor outside the displayed page", async () => {
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
        return queryResult(
          {
            id: "anchor-051",
            issue_id: "issue-051",
            project_id: "project-1",
            file_id: "pdf-old",
            anchor_kind: "pdf_region",
            ifc_global_id: null,
            active: true,
          },
          { single: true },
        );
      if (table === "lukas_drawing_issues")
        return queryResult(
          {
            id: "issue-051",
            project_id: "project-1",
            title: "51번째 검토 이슈",
            status: "open",
          },
          { single: true },
        );
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  assert.deepEqual(
    await loadDrawingRevisionReviewCandidate(
      client,
      "project-1",
      "pdf-new",
      "anchor-051",
    ),
    {
      issueId: "issue-051",
      issueTitle: "51번째 검토 이슈",
      previousAnchorId: "anchor-051",
      previousFileId: "pdf-old",
      sourceKind: "pdf_region",
      kind: "manual_reanchor_required",
      ifcGlobalId: null,
    },
  );
});

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

test("a lost relink response replays the exact committed result without a second mutation", async () => {
  const issueId = "50000000-0000-4000-8000-000000000020";
  const projectId = "50000000-0000-4000-8000-000000000021";
  const rows = new Map([
    [
      p5Ids.previousAnchor,
      {
        id: p5Ids.previousAnchor,
        issue_id: issueId,
        project_id: projectId,
        file_id: "50000000-0000-4000-8000-000000000022",
        anchor_kind: "pdf_region",
        element_id: null,
        ifc_global_id: null,
        camera_json: null,
        page_number: 1,
        x: 0.05,
        y: 0.05,
        width: 0.1,
        height: 0.1,
        label: "이전 근거",
        active: false,
        deactivation_note: "개정본에서 다시 확인",
        replaces_anchor_id: null,
      },
    ],
    [
      p5Ids.replacementAnchor,
      {
        id: p5Ids.replacementAnchor,
        issue_id: issueId,
        project_id: projectId,
        file_id: p5Ids.pdfFile,
        anchor_kind: "pdf_region",
        element_id: null,
        ifc_global_id: null,
        camera_json: null,
        page_number: 1,
        x: 0.1,
        y: 0.2,
        width: 0.3,
        height: 0.4,
        label: "새 근거",
        active: true,
        deactivation_note: null,
        replaces_anchor_id: p5Ids.previousAnchor,
      },
    ],
  ]);
  let rpcCalls = 0;
  const client = {
    from(table) {
      assert.equal(table, "lukas_drawing_issue_anchors");
      let id = null;
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          if (column === "id") id = value;
          return query;
        },
        maybeSingle() {
          return Promise.resolve({ data: rows.get(id) ?? null, error: null });
        },
      };
      return query;
    },
    async rpc() {
      rpcCalls += 1;
      throw new Error("replay must not call the RPC");
    },
  };
  const input = {
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
      label: "새 근거",
    },
    note: "개정본에서 다시 확인",
  };

  assert.deepEqual(await loadDrawingRevisionRelinkReplay(client, input), {
    previousAnchorId: p5Ids.previousAnchor,
    newAnchorId: p5Ids.replacementAnchor,
  });
  assert.equal(rpcCalls, 0);
  await assert.rejects(
    loadDrawingRevisionRelinkReplay(client, {
      ...input,
      note: "다른 요청",
    }),
    (error) =>
      error instanceof DrawingRevisionRelinkError && error.kind === "conflict",
  );
});

test("revision relink keeps stable database failures typed without exposing database detail", async () => {
  const input = {
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
      label: "새 근거",
    },
    note: "개정본에서 다시 확인",
  };

  for (const [code, kind] of [
    ["42501", "forbidden"],
    ["P1R01", "rejected"],
    ["P1C01", "conflict"],
    ["40001", "retryable"],
    ["40P01", "retryable"],
    ["PGRST000", "retryable"],
  ]) {
    let failure;
    try {
      await relinkDrawingIssueAnchor(
        {
          async rpc() {
            return {
              data: null,
              error: { code, message: `private database detail ${code}` },
            };
          },
        },
        input,
      );
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof DrawingRevisionRelinkError);
    assert.equal(failure.kind, kind);
    assert.equal(failure.code, code);
    assert.doesNotMatch(failure.message, /private database detail/);
  }
});

test("relink review form accepts one exact IFC candidate and camera", () => {
  const form = new FormData();
  form.set("intent", "relink_anchor");
  form.set("previous_anchor_id", p5Ids.previousAnchor);
  form.set("new_anchor_id", p5Ids.replacementAnchor);
  form.set("current_file_id", p5Ids.ifcFile);
  form.set(
    "anchor_json",
    JSON.stringify({
      kind: "ifc_element",
      fileId: p5Ids.ifcFile,
      elementId: "73",
      ifcGlobalId: "0Q2gXl1Hn3fQ9A2W4k6M8P",
      camera: { position: [1, 2, 3], target: [4, 5, 6] },
      label: "새 IFC 요소",
    }),
  );
  form.set("note", "새 모델에서 직접 선택");

  assert.deepEqual(parseRelinkDrawingAnchorForm(form), {
    previousAnchorId: p5Ids.previousAnchor,
    newAnchorId: p5Ids.replacementAnchor,
    currentFileId: p5Ids.ifcFile,
    anchor: {
      kind: "ifc_element",
      fileId: p5Ids.ifcFile,
      elementId: "73",
      ifcGlobalId: "0Q2gXl1Hn3fQ9A2W4k6M8P",
      camera: { position: [1, 2, 3], target: [4, 5, 6] },
      label: "새 IFC 요소",
    },
    note: "새 모델에서 직접 선택",
  });
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

test("generic anchor guard denies cross-route revision replacement from authoritative issue and file evidence", async () => {
  const projectId = "50000000-0000-4000-8000-000000000020";
  const issueId = "50000000-0000-4000-8000-000000000021";
  const previousFileId = "50000000-0000-4000-8000-000000000022";
  const currentFileId = "50000000-0000-4000-8000-000000000023";
  const previousAnchorId = "50000000-0000-4000-8000-000000000024";
  const revision = {
    project_id: projectId,
    previous_file_id: previousFileId,
    current_file_id: currentFileId,
    relation_kind: "supersedes",
  };
  const predecessor = {
    id: previousAnchorId,
    issue_id: issueId,
    project_id: projectId,
    file_id: previousFileId,
    active: true,
  };
  const addClient = {
    from(table) {
      if (table === "lukas_qto_file_revisions") return queryResult([revision]);
      if (table === "lukas_drawing_issue_anchors")
        return queryResult([predecessor]);
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  const deactivateClient = {
    from(table) {
      if (table === "lukas_qto_file_revisions")
        return queryResult(revision, { single: true });
      if (table === "lukas_drawing_issue_anchors")
        return queryResult(predecessor, { single: true });
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  await assert.rejects(
    assertGenericDrawingAnchorMutationAllowed(addClient, projectId, {
      intent: "add_anchor",
      issueId,
    }),
    /원자적 교체/,
  );
  await assert.rejects(
    assertGenericDrawingAnchorMutationAllowed(deactivateClient, projectId, {
      intent: "deactivate_anchor",
      anchorId: previousAnchorId,
    }),
    /원자적 교체/,
  );
});
