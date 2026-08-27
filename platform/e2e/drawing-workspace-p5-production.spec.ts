import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  authenticateContext,
  createDrawingFixture,
  destroyDrawingP3Fixture,
  readSourceEvidence,
  requireDrawingP3ProductionCredentials,
  type DrawingFixture,
} from "./utils/drawing-collaboration-fixture";

async function selectWorldObject(
  page: import("@playwright/test").Page,
  point: { x: number; y: number },
) {
  const surface = page.getByLabel(/도면 화면/);
  const zoom = Number(await surface.getAttribute("data-viewport-zoom"));
  const viewportX = Number(await surface.getAttribute("data-viewport-x"));
  const viewportY = Number(await surface.getAttribute("data-viewport-y"));
  await surface.click({
    position: {
      x: viewportX + point.x * zoom,
      y: viewportY + point.y * zoom,
    },
  });
}

test.describe.serial("P5 hosted workspace source authority", () => {
  let fixture: DrawingFixture;
  let workspace: DrawingFixture["pdfWorkspace"];
  let credentials: ReturnType<typeof requireDrawingP3ProductionCredentials>;
  let sourceBefore: DrawingFixture["sourceEvidence"];

  test.beforeAll(async () => {
    credentials = requireDrawingP3ProductionCredentials(process.env);
    fixture = await createDrawingFixture({
      p3RunId: credentials.P3_E2E_RUN_ID,
    });
    sourceBefore = structuredClone(fixture.sourceEvidence);
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const created = await owner.rpc("lukas_drawing_create_document", {
      p_project_id: fixture.projectId,
      p_source_file_id: fixture.revisedPdfFileId,
      p_title: "P5 hosted revision workspace",
      p_blank: false,
    });
    if (created.error) throw created.error;
    const value = created.data as Record<string, string>;
    workspace = {
      documentId: value.documentId,
      revisionId: value.revisionId,
      pageId: value.pageId,
      canvasId: value.canvasId,
      sourceLayerId: value.sourceLayerId,
      workLayerId: value.workLayerId,
      fileId: fixture.revisedPdfFileId,
    };
  });

  test.afterAll(async () => {
    if (fixture)
      await destroyDrawingP3Fixture(
        fixture,
        credentials.P3_E2E_DATABASE_ADMIN_URL,
      );
  });

  test("Editor source relink reflects to Viewer while OCC RLS bytes and signed workspace modes stay authoritative", async ({
    browser,
  }) => {
    const editor = await authenticateApiClient(fixture, fixture.editor);
    const viewer = await authenticateApiClient(fixture, fixture.viewer);
    const nonMember = await authenticateApiClient(fixture, fixture.nonMember);
    const objectId = randomUUID();
    const object = {
      id: objectId,
      name: "P5 hosted source target",
      layerId: workspace.workLayerId,
      geometry: { type: "circle", center: { x: 220, y: 220 }, radius: 40 },
      styleId: null,
      style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
      version: 1,
    };
    const add = await editor.rpc("lukas_drawing_apply_operation", {
      p_revision_id: workspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "add_objects",
      p_base_versions: {},
      p_forward: { type: "add_objects", objects: [object] },
      p_inverse: { type: "delete_objects", objectIds: [objectId] },
    });
    if (add.error) throw add.error;
    const previousAnchorId = randomUUID();
    const newAnchorId = randomUUID();
    const { error: anchorError } = await editor
      .from("lukas_drawing_issue_anchors")
      .insert({
        id: previousAnchorId,
        issue_id: fixture.existingIssueId,
        project_id: fixture.projectId,
        file_id: fixture.pdfFileId,
        anchor_kind: "pdf_region",
        page_number: 1,
        x: 0.1,
        y: 0.1,
        width: 0.2,
        height: 0.2,
        label: "P5 predecessor anchor",
        active: true,
        created_by: fixture.editor.id,
        replaces_anchor_id: null,
      });
    if (anchorError) throw anchorError;
    const nextAnchor = {
      kind: "pdf_region",
      fileId: fixture.revisedPdfFileId,
      pageNumber: 1,
      x: 0.3,
      y: 0.25,
      width: 0.25,
      height: 0.2,
      label: "P5 revised anchor",
    };
    const failedRelink = await editor.rpc("lukas_drawing_relink_issue_anchor", {
      p_previous_anchor_id: previousAnchorId,
      p_new_anchor_id: newAnchorId,
      p_current_file_id: fixture.pdfFileId,
      p_anchor: { ...nextAnchor, fileId: fixture.pdfFileId },
      p_note: "exact revision edge rollback",
    });
    expect(failedRelink.error).not.toBeNull();
    const rollback = await editor
      .from("lukas_drawing_issue_anchors")
      .select("id,active,replaces_anchor_id")
      .eq("issue_id", fixture.existingIssueId);
    if (rollback.error) throw rollback.error;
    expect(rollback.data).toEqual([
      { id: previousAnchorId, active: true, replaces_anchor_id: null },
    ]);
    const viewerRelink = await viewer.rpc("lukas_drawing_relink_issue_anchor", {
      p_previous_anchor_id: previousAnchorId,
      p_new_anchor_id: randomUUID(),
      p_current_file_id: fixture.revisedPdfFileId,
      p_anchor: nextAnchor,
      p_note: "Viewer denial",
    });
    expect(viewerRelink.error).not.toBeNull();
    const relink = await editor.rpc("lukas_drawing_relink_issue_anchor", {
      p_previous_anchor_id: previousAnchorId,
      p_new_anchor_id: newAnchorId,
      p_current_file_id: fixture.revisedPdfFileId,
      p_anchor: nextAnchor,
      p_note: "exact revision edge confirmed",
    });
    if (relink.error) throw relink.error;
    expect(relink.data).toEqual({ previousAnchorId, newAnchorId });
    const anchors = await editor
      .from("lukas_drawing_issue_anchors")
      .select("id,file_id,active,replaces_anchor_id")
      .eq("issue_id", fixture.existingIssueId);
    if (anchors.error) throw anchors.error;
    expect(anchors.data).toEqual(
      expect.arrayContaining([
        {
          id: previousAnchorId,
          file_id: fixture.pdfFileId,
          active: false,
          replaces_anchor_id: null,
        },
        {
          id: newAnchorId,
          file_id: fixture.revisedPdfFileId,
          active: true,
          replaces_anchor_id: previousAnchorId,
        },
      ]),
    );

    const editorContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const viewerContext = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const requiredSignedPaths = [
      fixture.storagePaths[2],
      fixture.storagePaths[0],
      fixture.storagePaths[1],
    ];
    const signedSourceResponses = new Set<string>();
    editorContext.on("response", (response) => {
      if (response.status() < 200 || response.status() >= 300) return;
      const decodedUrl = decodeURIComponent(response.url());
      const path = requiredSignedPaths.find((candidate) =>
        decodedUrl.includes(candidate),
      );
      if (path) signedSourceResponses.add(path);
    });
    const path = `/projects/${fixture.projectId}/drawings/${workspace.fileId}/workspace?document=${workspace.documentId}&ifc=${fixture.ifcFileId}&view=split`;
    const editorPage = await authenticateContext(
      fixture,
      editorContext,
      fixture.editor,
      credentials.E2E_BASE_URL,
      path,
    );
    const viewerPage = await authenticateContext(
      fixture,
      viewerContext,
      fixture.viewer,
      credentials.E2E_BASE_URL,
      path,
    );
    try {
      for (const page of [editorPage, viewerPage]) {
        await expect(
          page.getByRole("group", { name: "도면 작업실 보기" }),
        ).toBeVisible();
        await expect(
          page.getByRole("status", { name: "공동 편집 상태: connected" }),
        ).toBeVisible({ timeout: 60_000 });
        await expect(
          page.getByText("PDF 원본 배경을 표시하고 있습니다."),
        ).toBeVisible();
        await page.getByRole("button", { name: "선택 도구" }).click();
        await selectWorldObject(page, { x: 220, y: 220 });
      }
      const editorInspector = editorPage.getByRole("region", {
        name: "선택 객체 원본 근거",
      });
      const viewerInspector = viewerPage.getByRole("region", {
        name: "선택 객체 원본 근거",
      });
      await expect(viewerInspector).toContainText("조회 전용");
      await expect(
        viewerInspector.getByRole("button", {
          name: "PDF 영역 원본 근거 연결",
        }),
      ).toHaveCount(0);

      await editorInspector
        .getByRole("button", { name: "PDF 영역 원본 근거 연결" })
        .click();
      await expect(viewerInspector).toContainText("PDF 1쪽 영역", {
        timeout: 60_000,
      });
      const linked = await editor
        .from("lukas_drawing_object_sources")
        .select("id,status,version,source_file_id")
        .eq("object_id", objectId)
        .eq("status", "active")
        .single();
      if (linked.error || !linked.data)
        throw linked.error ?? new Error("Mounted PDF link did not persist");
      const denied = await viewer.rpc("lukas_drawing_apply_operation", {
        p_revision_id: workspace.revisionId,
        p_client_operation_id: randomUUID(),
        p_operation_type: "mutate_structure",
        p_base_versions: { [linked.data.id]: 1 },
        p_forward: {
          type: "mutate_structure",
          actions: [
            { kind: "delete_source", id: linked.data.id, baseVersion: 1 },
          ],
        },
        p_inverse: { type: "mutate_structure", actions: [] },
      });
      expect(denied.error).not.toBeNull();

      await editorInspector
        .getByRole("button", { name: "원본 근거 해제" })
        .click();
      await expect(viewerInspector).toContainText(
        "연결된 원본 근거가 없습니다.",
        { timeout: 60_000 },
      );
      await editorInspector
        .getByRole("button", { name: "PDF 영역 원본 근거 연결" })
        .click();
      await expect(viewerInspector).toContainText("PDF 1쪽 영역", {
        timeout: 60_000,
      });
      const orderedSources = await editor
        .from("lukas_drawing_object_sources")
        .select("id,status,version,source_file_id")
        .eq("object_id", objectId);
      if (orderedSources.error) throw orderedSources.error;
      expect(orderedSources.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: linked.data.id,
            status: "deleted",
            version: 2,
          }),
          expect.objectContaining({
            status: "active",
            version: 1,
            source_file_id: fixture.revisedPdfFileId,
          }),
        ]),
      );
      const outsider = await nonMember
        .from("lukas_drawing_object_sources")
        .select("id")
        .eq("object_id", objectId);
      expect(outsider.error).toBeNull();
      expect(outsider.data).toEqual([]);

      await editorPage.getByRole("button", { name: "분할 보기" }).click();
      await expect(
        editorPage.locator('canvas[aria-label="IFC 3D 모델"]'),
      ).toHaveCount(1, { timeout: 60_000 });
      await editorPage.getByRole("button", { name: "겹쳐 보기" }).click();
      await expect(
        editorPage.getByRole("button", { name: "변경 표시 계산" }),
      ).toBeEnabled();
      await expect
        .poll(() => [...signedSourceResponses].sort(), { timeout: 60_000 })
        .toEqual([...requiredSignedPaths].sort());
      await editorPage.getByRole("button", { name: "2D 도면" }).click();
      await editorPage.getByRole("button", { name: "IFC 3D" }).click();
      await editorPage.getByRole("button", { name: "분할 보기" }).click();
    } finally {
      await Promise.all([editorContext.close(), viewerContext.close()]);
    }

    expect(await readSourceEvidence(fixture)).toEqual(sourceBefore);
  });
});
