import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect, test, type Download, type Page } from "@playwright/test";
import { PDFDocument } from "pdf-lib";

const previewPath = "/workspace-preview/drawing-workspace";
const artifactRoot = path.resolve(
  "..",
  ".superpowers/sdd/2026-08-26-drawing-workspace-p4",
);

async function openPreview(page: Page, query = "") {
  await page.goto(`${previewPath}${query}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("미리보기 hydration 상태")).toHaveText("준비됨");
  await expect(page.getByRole("tablist", { name: "도면 도구" })).toBeVisible();
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function exportBytes(page: Page, format: "SVG" | "PNG" | "PDF") {
  await page.getByRole("button", { name: "내보내기" }).click();
  const dialog = page.getByRole("dialog", { name: "도면 내보내기" });
  await dialog.getByRole("radio", { name: format }).check();
  if (format !== "SVG")
    await dialog.getByLabel("PNG 렌더 배율").selectOption("1");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    dialog.getByRole("button", { name: "다운로드" }).click(),
  ]);
  const bytes = await downloadBytes(download);
  await dialog.getByRole("button", { name: "닫기", exact: true }).click();
  return bytes;
}

test("P4 populated preview exports every semantic object", async ({ page }) => {
  const ifcPath = path.resolve("../samples/sample.ifc");
  const ifcBefore = createHash("sha256")
    .update(await readFile(ifcPath))
    .digest("hex");
  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page);
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute(
    "data-rendered-semantic-object-count",
    "8",
  );
  const semanticList = page.getByRole("list", { name: "건축 객체 목록" });
  await expect(semanticList).toContainText("회의실 외벽 · wall");
  await expect(semanticList).toContainText("회의실 동측벽 · wall");
  await expect(semanticList).toContainText("D-101 · opening");
  await expect(semanticList).toContainText("W-101 · opening");
  await expect(semanticList).toContainText("회의실 · space");
  await expect(semanticList).toContainText("외부 포장 · area");
  await expect(semanticList).toContainText("A · grid");
  await expect(semanticList).toContainText("처마 호 · arc");
  await page.getByRole("tab", { name: "Schedule" }).click();
  await expect(
    page.getByRole("table", { name: "Room schedule · 미리보기" }),
  ).toContainText("회의실");
  await expect(
    page.getByRole("table", { name: "Door schedule · 미리보기" }),
  ).toContainText("D-101");
  await expect(
    page.getByRole("table", { name: "Finish schedule · 미리보기" }),
  ).toContainText("카펫 타일");

  const svg = (await exportBytes(page, "SVG")).toString("utf8");
  expect(svg.match(/data-semantic-type=/g)).toHaveLength(8);
  expect(svg).toContain("101 · 회의실");
  expect(svg).toContain("외부 포장");
  expect(svg).toContain(">A</text>");
  const png = await exportBytes(page, "PNG");
  expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

  await page.screenshot({
    path: path.join(artifactRoot, "task-6-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.screenshot({
    path: path.join(artifactRoot, "task-6-tablet.png"),
    fullPage: true,
  });
  expect(
    createHash("sha256")
      .update(await readFile(ifcPath))
      .digest("hex"),
  ).toBe(ifcBefore);
});

test("P4 integrated architectural authoring, conflict, restore, permissions, freeze, and durable export vertical", async ({
  page,
}) => {
  test.setTimeout(10 * 60_000);
  const sourcePdfPath = path.resolve(
    "../.superpowers/sdd/2026-08-25-drawing-workspace-p2/task-10-artifacts/representative-drawing.pdf",
  );
  const ifcPath = path.resolve("../samples/sample.ifc");
  const sourcePdfBytes = await readFile(sourcePdfPath);
  const before = {
    pdf: createHash("sha256").update(sourcePdfBytes).digest("hex"),
    ifc: createHash("sha256")
      .update(await readFile(ifcPath))
      .digest("hex"),
  };

  await page.setViewportSize({ width: 1440, height: 900 });
  await openPreview(page);
  const core = await page.evaluate(async () => {
    const paths = {
      awareness: "/app/lukas/lib/drawing-awareness.ts",
      collaboration: "/app/lukas/lib/drawing-collaboration-client.ts",
      commands: "/app/lukas/lib/drawing-commands.ts",
      documentStore: "/app/lukas/lib/drawing-document-store.ts",
      draft: "/app/lukas/lib/drawing-yjs-draft.ts",
      drawingExport: "/app/lukas/lib/drawing-export.ts",
      geometry: "/app/lukas/lib/drawing-semantic-geometry.ts",
      persistence: "/app/lukas/lib/drawing-yjs-persistence.client.ts",
      preview: "/app/lukas/screens/local-drawing-workspace-preview.tsx",
      schedules: "/app/lukas/lib/drawing-semantic-schedules.ts",
      tools: "/app/lukas/components/drawing-canvas.client.tsx",
    };
    const commands = await import(paths.commands);
    const documentStore = await import(paths.documentStore);
    const geometry = await import(paths.geometry);
    const schedules = await import(paths.schedules);
    const awareness = await import(paths.awareness);
    const collaboration = await import(paths.collaboration);
    const draft = await import(paths.draft);
    const persistence = await import(paths.persistence);
    const drawingExport = await import(paths.drawingExport);
    const tools = await import(paths.tools);
    const preview = await import(paths.preview);
    const fixture = preview.localDrawingWorkspacePreviewFixture();
    const revision = fixture.workspace.document.revision;
    const actorId = fixture.currentUserId;
    const layerId = revision.layers.find(
      (layer: any) => layer.systemKind === "work" && !layer.locked,
    ).id;
    const activeCanvasId = revision.activeCanvasId;
    let state = documentStore.hydrateDrawingDocumentState({
      revisionId: revision.id,
      pages: revision.pages,
      canvases: revision.canvases,
      layers: revision.layers,
      objects: revision.objects,
      styles: revision.styles,
      blocks: revision.blocks,
      blockInstances: revision.blockInstances,
      propertySchemas: revision.propertySchemas,
      propertyValues: revision.propertyValues,
      tables: revision.tables,
    });
    const ids = Array.from(
      { length: 6 },
      (_, index) =>
        `20000000-0000-4000-8000-${String(index + 501).padStart(12, "0")}`,
    );
    let operationIndex = 0;
    const environment = () => ({
      createId: () =>
        `30000000-0000-4000-8000-${String(operationIndex++ + 601).padStart(
          12,
          "0",
        )}`,
      now: () =>
        new Date(Date.UTC(2026, 7, 27) + operationIndex * 1000).toISOString(),
    });
    const apply = (command: any) => {
      state = commands.applyDrawingCommand(state, command, environment()).state;
    };
    const snap = {
      gridSize: 0,
      objectCandidates: [],
      tolerancePixels: 12,
      zoom: 1,
    };
    const options = (objectId: string) => ({
      actorId,
      layerId,
      objectId,
      objects: state.objects,
      repeatMode: false,
      snap,
    });
    const context = (activeTool: string, objectId: string) => ({
      activeTool,
      actorId,
      calibrationId: null,
      canEdit: true,
      layerId,
      layers: state.layers,
      objectId,
      objects: state.objects,
      repeatMode: false,
      snap: { gridSize: 0, objectCandidates: [], tolerancePixels: 12 },
      viewport: { x: 0, y: 0, zoom: 1 },
    });
    const down = (controller: any, point: any, toolContext: any) =>
      tools.drawingToolEventTransition(
        controller,
        {
          type: "pointer_down",
          button: 0,
          pointerId: 1,
          screenPoint: point,
          shiftKey: false,
        },
        toolContext,
      );
    const authoredTypes = [];
    let result = tools.commitDrawingPoint(
      tools.beginDrawingToolSession("wall", { x: 2000, y: 1000 }, snap),
      { x: 5000, y: 1000 },
      options(ids[0]),
    );
    authoredTypes.push(result.command.objects[0].geometry.type);
    apply(result.command);

    let toolContext = context("opening", ids[1]);
    result = down(
      tools.createDrawingToolControllerState(toolContext),
      { x: 3500, y: 1000 },
      toolContext,
    );
    authoredTypes.push(result.command.objects[0].geometry.type);
    apply(result.command);

    for (const [tool, objectId, y] of [
      ["space", ids[2], 1800],
      ["area", ids[3], 3000],
    ] as Array<[string, string, number]>) {
      toolContext = context(tool, objectId);
      let polygon = tools.createDrawingToolControllerState(toolContext);
      for (const point of [
        { x: 2000, y },
        { x: 3200, y },
        { x: 3200, y: y + 800 },
        { x: 2000, y: y + 800 },
      ])
        polygon = down(polygon, point, toolContext).state;
      result = tools.drawingToolEventTransition(
        polygon,
        { type: "key_down", key: "Enter" },
        toolContext,
      );
      authoredTypes.push(result.command.objects[0].geometry.type);
      apply(result.command);
    }

    result = tools.commitDrawingPoint(
      tools.beginDrawingToolSession("grid", { x: 1800, y: 4500 }, snap),
      { x: 5200, y: 4500 },
      options(ids[4]),
    );
    authoredTypes.push(result.command.objects[0].geometry.type);
    apply(result.command);

    toolContext = context("arc", ids[5]);
    let arc = down(
      tools.createDrawingToolControllerState(toolContext),
      { x: 4000, y: 3000 },
      toolContext,
    );
    arc = down(arc.state, { x: 4400, y: 3000 }, toolContext);
    result = down(arc.state, { x: 4000, y: 3400 }, toolContext);
    authoredTypes.push(result.command.objects[0].geometry.type);
    apply(result.command);

    const baseline = structuredClone(state);
    const baselineSchedules = ["room", "door", "finish"].map((kind) =>
      schedules.resolveDrawingSemanticSchedule(kind, baseline),
    );
    const baselineSvg = drawingExport.exportDrawingSvg(
      baseline,
      activeCanvasId,
    );

    apply({
      type: "update_objects",
      actorId,
      updates: [
        {
          objectId: ids[0],
          baseVersion: state.objects[ids[0]].version,
          patch: {
            name: "Inspector edited wall",
            geometry: {
              ...state.objects[ids[0]].geometry,
              thicknessMillimeters: 240,
            },
          },
        },
      ],
    });
    const beforeFollow = geometry.resolveDrawingOpening(
      state.objects[ids[1]].geometry,
      state.objects,
    );
    apply(
      commands.moveDrawingSelection(state, [ids[0]], actorId, {
        x: 125,
        y: 75,
      }),
    );
    const afterFollow = geometry.resolveDrawingOpening(
      state.objects[ids[1]].geometry,
      state.objects,
    );
    const followed = {
      x: afterFollow.center.x - beforeFollow.center.x,
      y: afterFollow.center.y - beforeFollow.center.y,
    };
    const offsetBeforeMove = state.objects[ids[1]].geometry.offsetMillimeters;
    apply(
      commands.moveDrawingOpeningToPoint(state, ids[1], actorId, {
        x: 4200,
        y: 1075,
      }),
    );
    const offsetAfterMove = state.objects[ids[1]].geometry.offsetMillimeters;

    let invalidShrinkRejected = false;
    try {
      commands.applyDrawingCommand(
        state,
        {
          type: "update_objects",
          actorId,
          updates: [
            {
              objectId: ids[0],
              baseVersion: state.objects[ids[0]].version,
              patch: {
                geometry: {
                  ...state.objects[ids[0]].geometry,
                  end: {
                    x: state.objects[ids[0]].geometry.start.x + 500,
                    y: state.objects[ids[0]].geometry.start.y,
                  },
                },
              },
            },
          ],
        },
        environment(),
      );
    } catch {
      invalidShrinkRejected = true;
    }
    const undone = commands.undoDrawingCommand(state, actorId, environment());
    const undoOffset = undone.state.objects[ids[1]].geometry.offsetMillimeters;
    const redone = commands.redoDrawingCommand(
      undone.state,
      actorId,
      environment(),
    );
    state = redone.state;
    const redoOffset = state.objects[ids[1]].geometry.offsetMillimeters;

    const restoreCommand = commands.createDrawingCheckpointRestoreCommand(
      state,
      baseline,
      actorId,
      revision.checkpoints[0].id,
    );
    const lockConflict = awareness.drawingCommandSoftLockConflict(
      restoreCommand,
      [
        {
          clientId: 99,
          user: { id: "peer", displayName: "Peer", color: "#f00" },
          softLocks: [
            {
              entityId: ids[0],
              leaseId: "peer-lock",
              expiresAt: Date.now() + 5000,
            },
          ],
        },
      ],
    );
    state = commands.applyDrawingCommand(
      state,
      restoreCommand,
      environment(),
    ).state;
    const withoutVersions = (objects: Record<string, any>) =>
      Object.fromEntries(
        Object.entries(objects).map(([id, object]) => {
          const { version: _version, ...semantic } = object;
          return [id, semantic];
        }),
      );
    const restoredSchedules = ["room", "door", "finish"].map((kind) =>
      schedules.resolveDrawingSemanticSchedule(kind, state),
    );
    const restoredSvg = drawingExport.exportDrawingSvg(state, activeCanvasId);

    const locked = structuredClone(baseline);
    locked.layers[layerId].locked = true;
    locked.structure.layers[layerId].locked = true;
    let layerLockRejected = false;
    try {
      commands.applyDrawingCommand(
        locked,
        {
          type: "update_objects",
          actorId,
          updates: [
            {
              objectId: ids[0],
              baseVersion: locked.objects[ids[0]].version,
              patch: { name: "must reject" },
            },
          ],
        },
        environment(),
      );
    } catch {
      layerLockRejected = true;
    }

    const yDocument = persistence.createDrawingYjsDocument();
    const localBaseMeta = collaboration.initializeDrawingCollaborationDocument({
      document: yDocument,
      projectId: fixture.workspace.file.project_id,
      revisionId: revision.id,
      baseSnapshotSha256: "a".repeat(64),
      baseOperationSequence: 0,
    });
    const viewer = draft.createDrawingDraftAdapter({
      document: yDocument,
      authoritativeState: baseline,
      actorId,
      authorization: "viewer",
      frozen: false,
      localBaseMeta,
    });
    let viewerDirectRejected = false;
    try {
      viewer.prepareLocal({
        type: "delete_objects",
        actorId,
        objectIds: [ids[0]],
      });
    } catch {
      viewerDirectRejected = true;
    }
    viewer.dispose();
    yDocument.destroy();

    return {
      authoredTypes,
      inspectorEdited:
        state.objects[ids[0]].name === baseline.objects[ids[0]].name,
      followed,
      invalidShrinkRejected,
      layerLockRejected,
      lockConflict: Boolean(lockConflict),
      offsetBeforeMove,
      offsetAfterMove,
      redoOffset,
      restoreObjectsEqual:
        JSON.stringify(withoutVersions(state.objects)) ===
        JSON.stringify(withoutVersions(baseline.objects)),
      restoreReferencesEqual:
        state.objects[ids[1]].geometry.hostWallId ===
        baseline.objects[ids[1]].geometry.hostWallId,
      restoreSchedulesEqual:
        JSON.stringify(restoredSchedules) === JSON.stringify(baselineSchedules),
      restoreSvgEqual: restoredSvg === baselineSvg,
      undoOffset,
      viewerDirectRejected,
    };
  });

  expect(core.authoredTypes).toEqual([
    "wall",
    "opening",
    "space",
    "area",
    "grid",
    "arc",
  ]);
  expect(core.followed).toEqual({ x: 125, y: 75 });
  expect(core.offsetAfterMove).not.toBe(core.offsetBeforeMove);
  expect(core.undoOffset).toBe(core.offsetBeforeMove);
  expect(core.redoOffset).toBe(core.offsetAfterMove);
  expect(core.invalidShrinkRejected).toBe(true);
  expect(core.lockConflict).toBe(true);
  expect(core.layerLockRejected).toBe(true);
  expect(core.viewerDirectRejected).toBe(true);
  expect(core.restoreObjectsEqual).toBe(true);
  expect(core.restoreReferencesEqual).toBe(true);
  expect(core.restoreSchedulesEqual).toBe(true);
  expect(core.restoreSvgEqual).toBe(true);

  await openPreview(page, "?reviewFreezeTest=1");
  const review = page.getByRole("button", { name: "검토 요청" });
  const click = review.click();
  await expect(
    page.getByRole("textbox", { name: "새 레이어 이름" }),
  ).toBeHidden();
  await click;
  await expect(page.getByText("로컬 동결 실패 복구 시험")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "새 레이어 이름" }),
  ).toBeVisible();

  await openPreview(page);

  const inspectorSurface = page.getByLabel(/도면 화면/);
  await page.getByRole("button", { name: "선택 도구" }).click();
  const zoom = Number(
    await inspectorSurface.getAttribute("data-viewport-zoom"),
  );
  const viewportX = Number(
    await inspectorSurface.getAttribute("data-viewport-x"),
  );
  const viewportY = Number(
    await inspectorSurface.getAttribute("data-viewport-y"),
  );
  await inspectorSurface.click({
    position: { x: viewportX + 500 * zoom, y: viewportY + 720 * zoom },
  });
  await expect(page.getByLabel("벽 두께")).toBeVisible();
  await page.getByLabel("벽 두께").fill("240");
  await page.getByRole("button", { name: "건축 속성 적용" }).click();
  await expect(page.getByLabel("벽 두께")).toHaveValue("240");

  const pdf = await exportBytes(page, "PDF");
  const parsed = await PDFDocument.load(pdf);
  expect(parsed.getPageCount()).toBeGreaterThan(0);
  expect(parsed.getSubject()).toBe("Canonical drawing workspace export");
  const rendered = await page.evaluate(
    async (bytes) => {
      const rendererPath = "/app/lukas/lib/pdf-page-renderer.client.ts";
      const renderer = await import(rendererPath);
      const blobUrl = URL.createObjectURL(
        new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
      );
      const opened = await renderer.openPdfDocument(blobUrl);
      const canvas = document.createElement("canvas");
      const pageRender = await renderer.renderPdfPageToCanvas({
        document: opened.document,
        pageNumber: 1,
        canvas,
        hostWidth: 900,
        zoom: 1,
      });
      const pixels = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhite = 0;
      for (let index = 0; index < pixels.length; index += 4)
        if (
          pixels[index] < 250 ||
          pixels[index + 1] < 250 ||
          pixels[index + 2] < 250
        )
          nonWhite += 1;
      pageRender.cleanup();
      await opened.destroy();
      URL.revokeObjectURL(blobUrl);
      return { height: canvas.height, nonWhite, width: canvas.width };
    },
    [...pdf],
  );
  expect(rendered.width).toBeGreaterThan(0);
  expect(rendered.height).toBeGreaterThan(0);
  expect(rendered.nonWhite).toBeGreaterThan(100);

  const sourceRendered = await page.evaluate(
    async (bytes) => {
      const rendererPath = "/app/lukas/lib/pdf-page-renderer.client.ts";
      const renderer = await import(rendererPath);
      const url = URL.createObjectURL(
        new Blob([Uint8Array.from(bytes)], { type: "application/pdf" }),
      );
      const opened = await renderer.openPdfDocument(url);
      const pages = opened.document.numPages;
      await opened.destroy();
      URL.revokeObjectURL(url);
      return pages;
    },
    [...sourcePdfBytes],
  );
  expect(sourceRendered).toBeGreaterThan(0);

  await openPreview(page, "?awarenessTest=1");
  await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
    "data-remote-selection-count",
    "3",
  );
  await expect(
    page.getByRole("status", { name: "객체 잠금 상태" }),
  ).toContainText("김도윤님이 D-101 편집 중");

  await openPreview(page, "?collaborationRetryTest=1");
  await expect(page.getByLabel("협업 재시도 상태")).toHaveText("local-failed");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByLabel("협업 재시도 상태")).toHaveText(
    "provider-failed",
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(page.getByLabel("협업 재시도 상태")).toHaveText("connected");

  await openPreview(page, "?bootstrapReadOnlyTest=1");
  await expect(page.getByRole("button", { name: "건축 객체" })).toBeHidden();
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toContainText("읽기 전용");

  await page.screenshot({
    path: path.join(artifactRoot, "task-6-fix-integrated.png"),
    fullPage: true,
  });
  expect(
    createHash("sha256")
      .update(await readFile(sourcePdfPath))
      .digest("hex"),
  ).toBe(before.pdf);
  expect(
    createHash("sha256")
      .update(await readFile(ifcPath))
      .digest("hex"),
  ).toBe(before.ifc);
});

test("P4 awareness exposes semantic selection and lock", async ({ page }) => {
  await openPreview(page, "?awarenessTest=1");
  const surface = page.getByLabel(/도면 화면/);
  await expect(surface).toHaveAttribute("data-remote-selection-count", "3");
  await expect(
    page.getByRole("status", { name: "객체 잠금 상태" }),
  ).toContainText("김도윤님이 D-101 편집 중");
});
