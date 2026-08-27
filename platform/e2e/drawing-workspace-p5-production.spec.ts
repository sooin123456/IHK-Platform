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
    const pdfSourceId = randomUUID();
    const ifcSourceId = randomUUID();
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
    const pdfSource = {
      id: pdfSourceId,
      objectId,
      revisionId: workspace.revisionId,
      sourceFileId: fixture.revisedPdfFileId,
      sourceSha256:
        fixture.sourceEvidence[fixture.revisedPdfFileId].metadataSha256,
      sourceKind: "pdf_region",
      pdfPageNumber: 1,
      x: 0.1,
      y: 0.1,
      width: 0.2,
      height: 0.2,
      version: 1,
    };
    const put = await editor.rpc("lukas_drawing_apply_operation", {
      p_revision_id: workspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "mutate_structure",
      p_base_versions: {},
      p_forward: {
        type: "mutate_structure",
        actions: [{ kind: "put_source", entity: pdfSource, baseVersion: null }],
      },
      p_inverse: {
        type: "mutate_structure",
        actions: [{ kind: "delete_source", id: pdfSourceId, baseVersion: 1 }],
      },
    });
    if (put.error) throw put.error;

    await expect
      .poll(async () => {
        const reflected = await viewer
          .from("lukas_drawing_object_sources")
          .select("id,source_file_id,version")
          .eq("id", pdfSourceId);
        if (reflected.error) throw reflected.error;
        return reflected.data;
      })
      .toEqual([
        {
          id: pdfSourceId,
          source_file_id: fixture.revisedPdfFileId,
          version: 1,
        },
      ]);
    const denied = await viewer.rpc("lukas_drawing_apply_operation", {
      p_revision_id: workspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "mutate_structure",
      p_base_versions: { [pdfSourceId]: 1 },
      p_forward: {
        type: "mutate_structure",
        actions: [{ kind: "delete_source", id: pdfSourceId, baseVersion: 1 }],
      },
      p_inverse: { type: "mutate_structure", actions: [] },
    });
    expect(denied.error).not.toBeNull();
    const outsider = await nonMember
      .from("lukas_drawing_object_sources")
      .select("id")
      .eq("id", pdfSourceId);
    expect(outsider.error).toBeNull();
    expect(outsider.data).toEqual([]);

    const ifcSource = {
      id: ifcSourceId,
      objectId,
      revisionId: workspace.revisionId,
      sourceFileId: fixture.ifcFileId,
      sourceSha256: fixture.sourceEvidence[fixture.ifcFileId].metadataSha256,
      sourceKind: "ifc_element",
      ifcGlobalId: "0VNYAWfXv8JvIRVfOzYH1j",
      elementId: "2863",
      camera: null,
      version: 1,
    };
    const relink = await editor.rpc("lukas_drawing_apply_operation", {
      p_revision_id: workspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "mutate_structure",
      p_base_versions: { [pdfSourceId]: 1 },
      p_forward: {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: pdfSourceId, baseVersion: 1 },
          { kind: "put_source", entity: ifcSource, baseVersion: null },
        ],
      },
      p_inverse: {
        type: "mutate_structure",
        actions: [
          { kind: "delete_source", id: ifcSourceId, baseVersion: 1 },
          { kind: "put_source", entity: pdfSource, baseVersion: null },
        ],
      },
    });
    if (relink.error) throw relink.error;
    const stale = await editor.rpc("lukas_drawing_apply_operation", {
      p_revision_id: workspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "mutate_structure",
      p_base_versions: { [pdfSourceId]: 1 },
      p_forward: {
        type: "mutate_structure",
        actions: [{ kind: "delete_source", id: pdfSourceId, baseVersion: 1 }],
      },
      p_inverse: { type: "mutate_structure", actions: [] },
    });
    expect(stale.error).not.toBeNull();

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const requiredSignedPaths = [
      fixture.storagePaths[2],
      fixture.storagePaths[0],
      fixture.storagePaths[1],
    ];
    const signedSourceResponses = new Set<string>();
    context.on("response", (response) => {
      if (response.status() < 200 || response.status() >= 300) return;
      const decodedUrl = decodeURIComponent(response.url());
      const path = requiredSignedPaths.find((candidate) =>
        decodedUrl.includes(candidate),
      );
      if (path) signedSourceResponses.add(path);
    });
    const path = `/projects/${fixture.projectId}/drawings/${workspace.fileId}/workspace?document=${workspace.documentId}&ifc=${fixture.ifcFileId}&view=split`;
    const page = await authenticateContext(
      fixture,
      context,
      fixture.editor,
      credentials.E2E_BASE_URL,
      path,
    );
    await expect(
      page.getByRole("group", { name: "도면 작업실 보기" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/view=split/);
    await expect(
      page.getByText("PDF 원본 배경을 표시하고 있습니다."),
    ).toBeVisible();
    await expect(page.locator('canvas[aria-label="IFC 3D 모델"]')).toHaveCount(
      1,
      {
        timeout: 60_000,
      },
    );
    await page.getByRole("button", { name: "겹쳐 보기" }).click();
    await expect(
      page.getByRole("button", { name: "변경 표시 계산" }),
    ).toBeEnabled();
    await expect
      .poll(() => [...signedSourceResponses].sort(), { timeout: 60_000 })
      .toEqual([...requiredSignedPaths].sort());
    await page.getByRole("button", { name: "2D 도면" }).click();
    await page.getByRole("button", { name: "IFC 3D" }).click();
    await page.getByRole("button", { name: "분할 보기" }).click();
    await context.close();

    expect(await readSourceEvidence(fixture)).toEqual(sourceBefore);
  });
});
