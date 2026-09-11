# Workspace Issue Regions Design

Status: approved by the standing Universal Drawing Workspace implementation authorization

## Problem

The canonical drawing workspace can persist a canvas-region anchor only after a project issue already exists. A source-free or newly created workspace therefore sends the user back to a legacy project screen before the first collaboration action. After an anchor is saved, the workspace shows only numeric coordinates in the collaboration rail; the saved region is not visible or selectable on the drawing.

## Outcome

A permitted collaborator can create a project issue without leaving the drawing workspace, attach a world-coordinate region to it, and later click the persistent region on the drawing to reopen that issue. Read-only roles can see and navigate saved regions without gaining mutation authority.

## Design

1. Reuse `parseDrawingMutationForm` and `mutateDrawingIssue` for `create_issue`. The canonical route applies the same exact `drawingWorkspaceCanComment` allow-list already used by comments and canvas-region anchors.
2. Add a compact issue form to the collaboration panel with title, description, and priority. Do not duplicate assignee or due-date workflows from the full issue screen.
3. Reconcile the selected issue whenever the realtime/revalidated issue list changes. Preserve a still-valid manual selection; otherwise select the first current issue.
4. Derive visible region annotations by exact `revision_id`, `page_id`, and `canvas_id` equality. Join each anchor to its project issue for its accessible label.
5. Render saved regions as a pointer-transparent DOM outline plus a compact accessible label button projected from world coordinates through the current viewport. The outline never blocks object selection inside the region. DOM is the interaction and accessibility surface; Konva remains the bulk drawing renderer.
6. A region label button is interactive only while the select tool is active and the temporary region picker is not armed. Selecting it opens the collaboration panel and selects its issue. It never mutates an anchor or selects a drawing object.
7. Viewer and Approver roles receive the same read-only region display, but no issue-creation form and no region picker.

## Non-goals

- No new table, RPC, RLS policy, Realtime service, state-management library, Yjs type, or collaboration server.
- No anchor editing, resizing, deletion, deactivation, clustering, or viewport auto-fit.
- No duplication of the full project issue administration form.
- No change to PDF/IFC source bytes or the drawing object operation graph.

## Acceptance

- Admin, Editor, Commenter, and Reviewer can create an issue in the workspace; Viewer and Approver cannot render the form and receive HTTP 403 for a forged `create_issue` submission.
- A newly created issue becomes the selected workspace issue after revalidation or realtime refresh without undoing a later valid manual selection.
- Only anchors matching the active revision, page, and canvas are rendered.
- Saved region outlines remain aligned after pan, zoom, and reload.
- Clicking or keyboard-activating a region opens `댓글·이슈` with its owning issue selected, without creating a mutation or changing drawing-object selection.
- Viewer and Approver can see and activate saved region navigation, but cannot arm or submit the region picker.
- Existing canvas pan, object selection, calibration capture, temporary region preview, comments, mentions, and issue links keep working.
