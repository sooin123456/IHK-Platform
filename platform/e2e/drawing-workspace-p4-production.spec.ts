import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { deriveAuthorizedDrawingMeasurementEvidence } from "../app/lukas/lib/drawing-workspace.server";
import { drawingMeasurementEvidenceCurrent } from "../app/lukas/lib/drawing-semantic-schedules";
import "./drawing-workspace-p3.spec";
import {
  authenticateApiClient,
  authenticateContext,
  createDrawingFixture,
  destroyDrawingP3Fixture,
  readSourceEvidence,
  requireDrawingP3ProductionCredentials,
  type DrawingFixture,
} from "./utils/drawing-collaboration-fixture";
import {
  assertDrawingP4HostedServerEvidence,
  buildDrawingP4ProductionObjects,
} from "./utils/drawing-p4-release-fixture";

const credentials = requireDrawingP3ProductionCredentials(process.env);
const baseUrl = credentials.E2E_BASE_URL;

async function waitUntilSaved(page: Page) {
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible({ timeout: 45_000 });
}

async function clickWorld(page: Page, point: { x: number; y: number }) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("P4 production canvas has no layout box");
  const [x, y, zoom] = await Promise.all([
    surface.getAttribute("data-viewport-x"),
    surface.getAttribute("data-viewport-y"),
    surface.getAttribute("data-viewport-zoom"),
  ]);
  await page.mouse.click(
    box.x + Number(x) + point.x * Number(zoom),
    box.y + Number(y) + point.y * Number(zoom),
  );
}

test.describe.serial("P4 hosted semantic authority", () => {
  let fixture: DrawingFixture;
  let objects: ReturnType<typeof buildDrawingP4ProductionObjects>;
  const sourceBefore = {} as DrawingFixture["sourceEvidence"];

  test.beforeAll(async () => {
    fixture = await createDrawingFixture();
    Object.assign(sourceBefore, fixture.sourceEvidence);
    objects = buildDrawingP4ProductionObjects(
      fixture.blankWorkspace.workLayerId,
      randomUUID,
    );
  });

  test.afterAll(async () => {
    await destroyDrawingP3Fixture(
      fixture,
      credentials.P3_E2E_DATABASE_ADMIN_URL,
    );
  });

  test("P4 Gate 09: hosted semantic graph measurement schedules RLS freeze and source bytes remain authoritative", async ({
    browser,
  }) => {
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const editor = await authenticateApiClient(fixture, fixture.editor);
    const reviewer = await authenticateApiClient(fixture, fixture.reviewer);
    const viewer = await authenticateApiClient(fixture, fixture.viewer);
    const nonMember = await authenticateApiClient(fixture, fixture.nonMember);
    const add = await owner.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "add_objects",
      p_base_versions: {},
      p_forward: { type: "add_objects", objects },
      p_inverse: {
        type: "delete_objects",
        objectIds: objects.map(({ id }) => id).reverse(),
      },
    });
    if (add.error) throw add.error;

    const stored = await owner
      .from("lukas_drawing_objects")
      .select("id,object_type,geometry,version")
      .in(
        "id",
        objects.map(({ id }) => id),
      );
    if (stored.error) throw stored.error;
    expect(stored.data).toHaveLength(6);
    expect(stored.data.map(({ object_type }) => object_type).sort()).toEqual([
      "arc",
      "area",
      "grid",
      "opening",
      "space",
      "wall",
    ]);
    expect(
      stored.data.find(({ object_type }) => object_type === "opening")?.geometry
        .hostWallId,
    ).toBe(objects[0].id);

    const bootstrapResult = await owner.rpc(
      "lukas_drawing_collaboration_bootstrap",
      { p_revision_id: fixture.blankWorkspace.revisionId },
    );
    if (bootstrapResult.error) throw bootstrapResult.error;
    const bootstrap = bootstrapResult.data;
    const evidence = deriveAuthorizedDrawingMeasurementEvidence(bootstrap);
    const lineage = {
      documentId: bootstrap.canonicalJson.revision.documentId,
      revisionId: bootstrap.canonicalJson.revision.id,
      revisionVersion: bootstrap.canonicalJson.revision.version,
      snapshotSha256: bootstrap.sha256,
      operationCheckpoint: bootstrap.operationSequence,
    };
    const state = {
      revisionId: lineage.revisionId,
      objects: Object.fromEntries(objects.map((object) => [object.id, object])),
    };
    assertDrawingP4HostedServerEvidence({
      evidence,
      evidenceError: null,
      current: drawingMeasurementEvidenceCurrent(lineage, state, false),
      objects,
    });

    const path = `/projects/${fixture.projectId}/drawings/${fixture.blankWorkspace.fileId}/workspace`;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      path,
    );
    await waitUntilSaved(page);
    const surface = page.getByLabel(/도면 화면/);
    await expect(surface).toHaveAttribute(
      "data-rendered-semantic-object-count",
      "6",
    );
    await page.getByRole("button", { name: "선택 도구" }).click();
    await clickWorld(page, { x: 50, y: 40 });
    await expect(page.getByText(/^확정 · 200 mm · 수량 1$/)).toBeVisible();
    await expect(
      page.getByText(
        `P4_MEASUREMENT_V1 · 체크포인트 ${lineage.operationCheckpoint} · Postgres 권한 확인 로드 · revision ${lineage.revisionId} · 객체 ${objects[0].id}`,
        { exact: true },
      ),
    ).toBeVisible();
    await page.getByRole("tab", { name: "Schedule" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "서버 증거" }),
    ).toHaveText(
      `서버 증거 · P4_MEASUREMENT_V1 · 체크포인트 ${lineage.operationCheckpoint} · Postgres 권한 확인 로드 · revision ${lineage.revisionId}`,
    );
    const serializedLoaderEvidence = await page
      .locator("[data-drawing-server-evidence]")
      .getAttribute("data-drawing-server-evidence");
    expect(serializedLoaderEvidence).not.toBeNull();
    const loaderEvidence = JSON.parse(
      serializedLoaderEvidence!,
    ) as typeof evidence;
    expect(loaderEvidence).toEqual(evidence);
    assertDrawingP4HostedServerEvidence({
      evidence: loaderEvidence,
      evidenceError: null,
      current: drawingMeasurementEvidenceCurrent(lineage, state, false),
      objects,
    });
    await expect(
      page.getByRole("table", { name: "Room schedule · 서버 증거" }),
    ).toContainText("P4-101 P4 hosted room 0.024 m² 1");
    await expect(
      page.getByRole("table", { name: "Door schedule · 서버 증거" }),
    ).toContainText("P4 hosted door 90 mm 2100 mm 1");
    await expect(
      page.getByRole("table", { name: "Finish schedule · 서버 증거" }),
    ).toContainText("P4-101 P4 hosted room tile paint acoustic 0.024 m²");

    const forbiddenUpdate = {
      ...objects[0],
      name: "forbidden hosted wall",
      version: 2,
    };
    for (const denied of [reviewer, viewer]) {
      const result = await denied.rpc("lukas_drawing_apply_operation", {
        p_revision_id: fixture.blankWorkspace.revisionId,
        p_client_operation_id: randomUUID(),
        p_operation_type: "update_objects",
        p_base_versions: { [objects[0].id]: 1 },
        p_forward: { type: "update_objects", objects: [forbiddenUpdate] },
        p_inverse: { type: "update_objects", objects: [objects[0]] },
      });
      expect(result.error).toBeTruthy();
    }
    const outsiderRead = await nonMember
      .from("lukas_drawing_objects")
      .select("id")
      .eq("id", objects[0].id);
    expect(outsiderRead.error).toBeNull();
    expect(outsiderRead.data).toEqual([]);

    const editorUpdate = { ...objects[0], name: "P4 editor wall", version: 2 };
    const edit = await editor.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "update_objects",
      p_base_versions: { [objects[0].id]: 1 },
      p_forward: { type: "update_objects", objects: [editorUpdate] },
      p_inverse: { type: "update_objects", objects: [objects[0]] },
    });
    if (edit.error) throw edit.error;
    const review = await editor.rpc("lukas_drawing_request_review", {
      p_revision_id: fixture.blankWorkspace.revisionId,
    });
    if (review.error) throw review.error;
    const approval = await reviewer.rpc(
      "lukas_drawing_record_revision_decision",
      {
        p_revision_id: fixture.blankWorkspace.revisionId,
        p_subject_version: review.data.subjectVersion,
        p_snapshot_sha256: review.data.snapshotSha256,
        p_decision: "approved",
        p_note: "P4 hosted semantic release gate",
      },
    );
    if (approval.error) throw approval.error;
    const approvedMutation = await editor.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "update_objects",
      p_base_versions: { [objects[0].id]: 2 },
      p_forward: {
        type: "update_objects",
        objects: [
          { ...editorUpdate, name: "mutated after approval", version: 3 },
        ],
      },
      p_inverse: { type: "update_objects", objects: [editorUpdate] },
    });
    expect(approvedMutation.error).toBeTruthy();
    const frozen = await owner
      .from("lukas_drawing_objects")
      .select("name,geometry,version")
      .eq("id", objects[0].id)
      .single();
    if (frozen.error) throw frozen.error;
    expect(frozen.data).toEqual({
      name: "P4 editor wall",
      geometry: objects[0].geometry,
      version: 2,
    });
    expect(await readSourceEvidence(fixture)).toEqual(sourceBefore);
    await context.close();
  });
});
