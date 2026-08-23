import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { canRecordDrawingApproval } from "../app/lukas/lib/drawing-collaboration-policy.ts";
import { parseDrawingMutationForm } from "../app/lukas/lib/drawing-collaboration.server.ts";

const reviewerId = "11111111-1111-4111-8111-111111111111";
const creatorId = "22222222-2222-4222-8222-222222222222";
const issueId = "33333333-3333-4333-8333-333333333333";

test("drawing approval requires a separate review role and a review request", () => {
  for (const role of ["owner", "staff", "reviewer"])
    assert.equal(
      canRecordDrawingApproval(
        role,
        reviewerId,
        creatorId,
        "resolution_requested",
      ),
      true,
    );
  for (const role of ["estimator", "site", "procurement", "viewer"])
    assert.equal(
      canRecordDrawingApproval(
        role,
        reviewerId,
        creatorId,
        "resolution_requested",
      ),
      false,
    );
  assert.equal(
    canRecordDrawingApproval(
      "reviewer",
      creatorId,
      creatorId,
      "resolution_requested",
    ),
    false,
  );
  assert.equal(
    canRecordDrawingApproval("reviewer", reviewerId, creatorId, "in_progress"),
    false,
  );
});

test("drawing approval form binds decision to the exact issue version", () => {
  const form = new FormData();
  form.set("intent", "record_approval");
  form.set("issue_id", issueId);
  form.set("subject_version", "7");
  form.set("decision", "approved");
  form.set("note", "도면 근거와 수정 내용을 확인했습니다.");
  assert.deepEqual(parseDrawingMutationForm(form), {
    intent: "record_approval",
    issueId,
    subjectVersion: 7,
    decision: "approved",
    note: "도면 근거와 수정 내용을 확인했습니다.",
  });

  form.set("subject_version", "0");
  assert.throws(() => parseDrawingMutationForm(form));
  form.set("subject_version", "7");
  form.set("note", " ");
  assert.throws(() => parseDrawingMutationForm(form));
});

test("drawing approvals are append-only maker-checker evidence and the only close gate", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/20260823100000_drawing_issue_approvals.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(sql, /create table public\.lukas_drawing_issue_approvals/i);
  assert.match(sql, /decision[\s\S]*approved[\s\S]*rejected/i);
  assert.match(
    sql,
    /subject_version[\s\S]*check\s*\(subject_version\s*>\s*0\)/i,
  );
  assert.match(sql, /reviewer_id[\s\S]*<>[\s\S]*created_by/i);
  assert.match(sql, /status[\s\S]*resolution_requested/i);
  assert.match(sql, /lukas_drawing_issue_anchors[\s\S]*and a\.active/i);
  assert.match(sql, /unique\s*\(issue_id,\s*subject_version\)/i);
  assert.match(
    sql,
    /revoke update, delete[\s\S]*approvals[\s\S]*authenticated/i,
  );
  assert.match(sql, /approval_recorded/i);
  assert.match(sql, /lukas\.drawing_approval_issue_id/i);
  assert.match(
    sql,
    /alter publication supabase_realtime add table public\.lukas_drawing_issue_approvals/i,
  );
});

test("drawing approval UI shows an explicit decision form and immutable history", async () => {
  const source = await readFile(
    new URL("../app/lukas/components/drawing-issue-panel.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /승인 또는 반려/);
  assert.match(source, /name="decision"/);
  assert.match(source, /name="subject_version"/);
  assert.match(source, /승인 기록/);
  assert.match(source, /canRecordDrawingApproval/);
});

test("drawing approval composite foreign key has a covering index", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/20260823101500_drawing_approval_foreign_key_index.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    sql,
    /on public\.lukas_drawing_issue_approvals\s*\(issue_id,\s*project_id\)/i,
  );
});
