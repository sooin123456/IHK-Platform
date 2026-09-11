import { createHash, randomUUID } from "node:crypto";

import { expect, test, type Download, type Page } from "@playwright/test";
import { XMLParser } from "fast-xml-parser";
import { PDFDocument } from "pdf-lib";

import {
  authenticateApiClient,
  authenticateContext,
  buildDrawingP2PerformanceFixture,
  createDrawingFixture,
  destroyDrawingFixture,
  readSourceEvidence,
  requireDrawingP2ProductionCredentials,
  seedDrawingP2PerformanceFixture,
  type DrawingFixture,
} from "./utils/drawing-collaboration-fixture";

const credentials = requireDrawingP2ProductionCredentials(process.env);
const baseUrl = credentials.E2E_BASE_URL;

type P2PerformanceFixture = ReturnType<typeof buildDrawingP2PerformanceFixture>;

type TemplateClone = {
  documentId: string;
  revisionId: string;
  sourceRevisionId: string;
};

function workspacePath(
  fixture: DrawingFixture,
  workspace: DrawingFixture["blankWorkspace"],
  documentId?: string,
) {
  const query = documentId ? `?document=${encodeURIComponent(documentId)}` : "";
  return `/projects/${fixture.projectId}/drawings/${workspace.fileId}/workspace${query}`;
}

async function waitUntilSaved(page: Page) {
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible({ timeout: 30_000 });
}

async function applyStructure(
  client: Awaited<ReturnType<typeof authenticateApiClient>>,
  revisionId: string,
  actions: Array<Record<string, unknown>>,
  inverseActions: Array<Record<string, unknown>>,
  baseVersions: Record<string, number> = {},
) {
  const result = await client.rpc("lukas_drawing_apply_operation", {
    p_revision_id: revisionId,
    p_client_operation_id: randomUUID(),
    p_operation_type: "mutate_structure",
    p_base_versions: baseVersions,
    p_forward: { type: "mutate_structure", actions },
    p_inverse: { type: "mutate_structure", actions: inverseActions },
  });
  if (result.error) throw result.error;
  return result.data;
}

async function addObjects(
  client: Awaited<ReturnType<typeof authenticateApiClient>>,
  revisionId: string,
  objects: Array<Record<string, unknown>>,
) {
  const result = await client.rpc("lukas_drawing_apply_operation", {
    p_revision_id: revisionId,
    p_client_operation_id: randomUUID(),
    p_operation_type: "add_objects",
    p_base_versions: {},
    p_forward: { type: "add_objects", objects },
    p_inverse: {
      type: "delete_objects",
      objectIds: objects.map(({ id }) => id),
    },
  });
  if (result.error) throw result.error;
  return result.data;
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0;
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Playwright download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function parsePng(bytes: Uint8Array) {
  const signature = Buffer.from(bytes.subarray(0, 8)).toString("hex");
  if (signature !== "89504e470d0a1a0a")
    throw new Error("Downloaded PNG signature is invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ihdr = Buffer.from(bytes.subarray(12, 16)).toString("ascii");
  if (ihdr !== "IHDR") throw new Error("Downloaded PNG has no IHDR chunk");
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function runDownload(page: Page, format: "PNG" | "SVG" | "PDF") {
  await page.getByRole("button", { name: "내보내기" }).click();
  await page.getByLabel(format, { exact: true }).check();
  const started = performance.now();
  const [download, auditRequest] = await Promise.all([
    page.waitForEvent("download"),
    page.waitForRequest(
      (request) =>
        request.method() === "POST" && request.url().endsWith("/export"),
    ),
    page.getByRole("button", { name: "다운로드", exact: true }).click(),
  ]);
  const bytes = await downloadBytes(download);
  const durationMs = performance.now() - started;
  const requestId = auditRequest
    .postData()
    ?.match(/name="request_id"\r\n\r\n([0-9a-f-]{36})/i)?.[1];
  expect(requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  return {
    bytes,
    durationMs,
    filename: download.suggestedFilename(),
    requestId: requestId!,
  };
}

test.describe.serial("1HK drawing workspace P2 production release", () => {
  let fixture: DrawingFixture;
  let performanceFixture: P2PerformanceFixture;
  let templateClone: TemplateClone;
  let approvedPdfSnapshot: { sha256: string; version: number };
  let immutableSourceBefore: DrawingFixture["sourceEvidence"];

  test.beforeAll(async () => {
    fixture = await createDrawingFixture();
    immutableSourceBefore = structuredClone(fixture.sourceEvidence);
  });

  test.afterAll(async () => {
    await destroyDrawingFixture(fixture);
  });

  test("Gate 01: P0/P1 content upgrades to one default paper canvas without loss", async ({
    browser,
  }) => {
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const legacyObject = {
      id: randomUUID(),
      name: "P0/P1 retained object",
      layerId: fixture.pdfWorkspace.workLayerId,
      geometry: { type: "circle", center: { x: 32, y: 48 }, radius: 7 },
      style: { stroke: "#2563eb", strokeWidth: 2, fill: null },
      version: 1,
    };
    await addObjects(owner, fixture.pdfWorkspace.revisionId, [legacyObject]);
    const { data: canvases, error: canvasError } = await owner
      .from("lukas_drawing_canvases")
      .select("id,page_id,space_kind,sort_order")
      .eq("revision_id", fixture.pdfWorkspace.revisionId)
      .order("sort_order");
    if (canvasError) throw canvasError;
    expect(canvases).toEqual([
      {
        id: fixture.pdfWorkspace.canvasId,
        page_id: fixture.pdfWorkspace.pageId,
        space_kind: "paper",
        sort_order: 0,
      },
    ]);
    const { data: retained, error: retainedError } = await owner
      .from("lukas_drawing_objects")
      .select("id,name,layer_id,status,version")
      .eq("id", legacyObject.id)
      .single();
    if (retainedError) throw retainedError;
    expect(retained).toEqual({
      id: legacyObject.id,
      name: legacyObject.name,
      layer_id: fixture.pdfWorkspace.workLayerId,
      status: "active",
      version: 1,
    });
    const context = await browser.newContext();
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      workspacePath(fixture, fixture.pdfWorkspace),
    );
    await waitUntilSaved(page);
    await expect(page.getByText("P0/P1 retained object")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Canvas 1.*paper/i }),
    ).toBeVisible();
    await context.close();
  });

  test("Gate 02: three pages switch across twenty paper and model canvases", async ({
    browser,
  }) => {
    performanceFixture = await seedDrawingP2PerformanceFixture(fixture);
    expect(performanceFixture.counts).toMatchObject({
      pages: 3,
      canvases: 20,
      objects: 10_000,
      blockInstances: 1_000,
      styles: 20,
      propertySchemas: 20,
      propertyValues: 20,
      tables: 5,
    });
    const owner = await authenticateApiClient(fixture, fixture.owner);
    for (const [table, count] of [
      ["lukas_drawing_pages", 3],
      ["lukas_drawing_canvases", 20],
      ["lukas_drawing_objects", 10_000],
      ["lukas_drawing_block_instances", 1_000],
      ["lukas_drawing_styles", 20],
      ["lukas_drawing_property_schemas", 20],
      ["lukas_drawing_property_values", 20],
      ["lukas_drawing_tables", 5],
    ] as const) {
      const result = await owner
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("revision_id", fixture.blankWorkspace.revisionId);
      if (result.error) throw result.error;
      expect(result.count, table).toBe(count);
    }

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      workspacePath(fixture, fixture.blankWorkspace),
    );
    await waitUntilSaved(page);
    await page.getByRole("tab", { name: "페이지·레이어" }).click();
    await expect(
      page.getByLabel("도면 페이지와 canvas").getByRole("listitem"),
    ).toHaveCount(23);
    for (const canvas of [
      performanceFixture.canvases[1],
      performanceFixture.canvases[2],
      performanceFixture.canvases[19],
    ]) {
      await page.getByRole("button", { name: new RegExp(canvas.name) }).click();
      await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
        "data-active-canvas-id",
        canvas.id,
      );
    }
    await context.close();
  });

  test("Gate 03: layer object and instance state stays isolated by active canvas", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      workspacePath(fixture, fixture.blankWorkspace),
    );
    await waitUntilSaved(page);
    const surface = page.getByLabel(/도면 화면/);
    await expect(surface).toHaveAttribute(
      "data-active-canvas-id",
      performanceFixture.activeCanvasId,
    );
    await expect(surface).toHaveAttribute("data-rendered-object-count", "500");
    await expect(surface).toHaveAttribute("data-rendered-instance-count", "50");
    const second = performanceFixture.canvases[1];
    await page.getByRole("tab", { name: "페이지·레이어" }).click();
    await page.getByRole("button", { name: new RegExp(second.name) }).click();
    await expect(surface).toHaveAttribute("data-active-canvas-id", second.id);
    await expect(surface).toHaveAttribute("data-rendered-object-count", "500");
    await expect(surface).toHaveAttribute("data-rendered-instance-count", "50");
    expect(
      Number(await surface.getAttribute("data-rendered-object-count")),
    ).toBeLessThan(performanceFixture.objects.length);
    expect(
      Number(await surface.getAttribute("data-rendered-instance-count")),
    ).toBeLessThan(performanceFixture.blockInstances.length);
    await context.close();
  });

  test("P2 deterministic performance fixture records product targets separately", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      "/",
    );
    const started = performance.now();
    await page.goto(
      `${baseUrl}${workspacePath(fixture, fixture.blankWorkspace)}`,
    );
    const surface = page.getByLabel(/도면 화면/);
    await expect(surface).toHaveAttribute("data-rendered-object-count", "500", {
      timeout: 10_000,
    });
    const firstUsableMs = performance.now() - started;
    expect(firstUsableMs).toBeLessThanOrEqual(10_000);

    await surface.evaluate((element) => {
      const evidence = {
        mode: "wheel",
        wheel: [] as number[],
        pan: [] as number[],
      };
      Object.assign(element, { __p2PerformanceEvidence: evidence });
      const measure = (kind: "wheel" | "pan") => {
        const frameStarted = performance.now();
        requestAnimationFrame(() =>
          evidence[kind].push(performance.now() - frameStarted),
        );
      };
      element.addEventListener("wheel", () => measure("wheel"), {
        capture: true,
      });
      element.addEventListener(
        "pointermove",
        () => {
          if (evidence.mode === "pan") measure("pan");
        },
        { capture: true },
      );
    });
    const box = await surface.boundingBox();
    if (!box) throw new Error("P2 performance canvas has no layout box");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let frame = 0; frame < 60; frame += 1) {
      await page.mouse.wheel(0, frame < 30 ? -3 : 1);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }
    await page.getByLabel("이동 도구").click();
    await surface.evaluate((element) => {
      (
        element as HTMLElement & { __p2PerformanceEvidence: { mode: string } }
      ).__p2PerformanceEvidence.mode = "pan";
    });
    const pan = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.55 };
    await page.mouse.move(pan.x, pan.y);
    await page.mouse.down();
    for (let frame = 1; frame <= 60; frame += 1) {
      await page.mouse.move(pan.x + frame * 1.5, pan.y + frame);
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          ),
      );
    }
    await page.mouse.up();
    const frames = await surface.evaluate((element) => {
      const evidence = (
        element as HTMLElement & {
          __p2PerformanceEvidence: { wheel: number[]; pan: number[] };
        }
      ).__p2PerformanceEvidence;
      return { wheel: evidence.wheel, pan: evidence.pan };
    });
    expect(frames.wheel).toHaveLength(60);
    expect(frames.pan).toHaveLength(60);
    const frameP95Ms = percentile([...frames.wheel, ...frames.pan], 0.95);
    expect(frameP95Ms).toBeLessThanOrEqual(50);

    await page.getByRole("tab", { name: "블록" }).click();
    await page
      .getByRole("button", { name: /P2 block 01 인스턴스 .*보기/ })
      .click();
    const selectionTargets = [
      "P2 active block instance",
      "P2 instance 0021",
    ].map((name) => ({
      name,
      button: page.getByRole("button", { name: `${name} 인스턴스 선택` }),
    }));
    const selectionDurations: number[] = [];
    let lastSelectedName: string | null = null;
    for (let selection = 0; selection < 20; selection += 1) {
      const target = selectionTargets[selection % selectionTargets.length];
      expect(target.name).not.toBe(lastSelectedName);
      const selectionStarted = performance.now();
      await target.button.click();
      await expect(page.getByLabel("속성 검사기")).toContainText(target.name);
      selectionDurations.push(performance.now() - selectionStarted);
      lastSelectedName = target.name;
    }
    expect(selectionDurations).toHaveLength(20);
    expect(percentile(selectionDurations, 0.95)).toBeLessThanOrEqual(50);

    await page.getByRole("tab", { name: "페이지·레이어" }).click();
    const switchDurations: number[] = [];
    for (const canvas of performanceFixture.canvases.slice(1)) {
      const switchStarted = performance.now();
      await page.getByRole("button", { name: new RegExp(canvas.name) }).click();
      await expect(surface).toHaveAttribute("data-active-canvas-id", canvas.id);
      switchDurations.push(performance.now() - switchStarted);
    }
    const switchP95Ms = percentile(switchDurations, 0.95);
    expect(switchP95Ms).toBeLessThanOrEqual(2_000);
    const metrics = {
      environment: {
        browser: await page.evaluate(() => navigator.userAgent),
        viewport: page.viewportSize(),
      },
      composition: performanceFixture.counts,
      firstUsableMs,
      frameCount: frames.wheel.length + frames.pan.length,
      frameP95Ms,
      selectionCount: selectionDurations.length,
      selectionP95Ms: percentile(selectionDurations, 0.95),
      switchCount: switchDurations.length,
      switchP95Ms,
      productTargets: {
        firstUsableAtMost2500Ms: firstUsableMs <= 2_500,
        frameAtLeast60Fps: frameP95Ms <= 1000 / 60,
        switchP95AtMost250Ms: switchP95Ms <= 250,
      },
      catastrophicCeilings: {
        firstUsableMs: 10_000,
        frameP95Ms: 50,
        selectionP95Ms: 50,
        switchP95Ms: 2_000,
      },
    };
    test.info().annotations.push({
      type: "performance",
      description: JSON.stringify(metrics),
    });
    await context.close();
  });

  test("Gate 04: live styles update references while overrides persist", async () => {
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const style = performanceFixture.styles[0];
    const referencedObject = performanceFixture.objects[0];
    const referencedBlock = performanceFixture.blocks[0];
    const updated = {
      ...style,
      value: { stroke: "#ef4444", strokeWidth: 4, fill: "#fee2e2" },
    };
    await applyStructure(
      owner,
      fixture.blankWorkspace.revisionId,
      [{ kind: "put_style", entity: updated, baseVersion: 1 }],
      [{ kind: "put_style", entity: { ...style, version: 2 }, baseVersion: 2 }],
      { [style.id]: 1 },
    );
    const [styleRead, objectRead, blockRead] = await Promise.all([
      owner
        .from("lukas_drawing_styles")
        .select("value,version")
        .eq("id", style.id)
        .single(),
      owner
        .from("lukas_drawing_objects")
        .select("style_id,style")
        .eq("id", referencedObject.id)
        .single(),
      owner
        .from("lukas_drawing_blocks")
        .select("primitives")
        .eq("id", referencedBlock.id)
        .single(),
    ]);
    for (const result of [styleRead, objectRead, blockRead])
      if (result.error) throw result.error;
    expect(styleRead.data).toEqual({ value: updated.value, version: 2 });
    expect(objectRead.data).toEqual({
      style_id: style.id,
      style: referencedObject.style,
    });
    expect(blockRead.data?.primitives[0].styleId).toBe(style.id);
    expect(blockRead.data?.primitives[0].style).toEqual({});
  });

  test("Gate 05: block instance copy transform delete lifecycle and referenced delete denial", async () => {
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const definition = performanceFixture.blocks[0];
    const source = performanceFixture.blockInstances[0];
    const copyId = randomUUID();
    const copy = {
      ...source,
      id: copyId,
      lineageId: copyId,
      name: "P2 lifecycle copy",
      origin: { x: 80, y: 90 },
      version: 1,
    };
    await applyStructure(
      owner,
      fixture.blankWorkspace.revisionId,
      [{ kind: "put_block_instance", entity: copy, baseVersion: null }],
      [{ kind: "delete_block_instance", id: copyId, baseVersion: 1 }],
    );
    const transformed = { ...copy, rotation: 45, scaleX: 1.5, scaleY: 0.75 };
    await applyStructure(
      owner,
      fixture.blankWorkspace.revisionId,
      [{ kind: "put_block_instance", entity: transformed, baseVersion: 1 }],
      [
        {
          kind: "put_block_instance",
          entity: { ...copy, version: 2 },
          baseVersion: 2,
        },
      ],
      { [copyId]: 1 },
    );
    const { data: transformedRead, error: transformedReadError } = await owner
      .from("lukas_drawing_block_instances")
      .select("origin,rotation,scale_x,scale_y,version")
      .eq("id", copyId)
      .single();
    if (transformedReadError) throw transformedReadError;
    expect(transformedRead).toEqual({
      origin: transformed.origin,
      rotation: 45,
      scale_x: 1.5,
      scale_y: 0.75,
      version: 2,
    });
    const blocked = await owner.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "mutate_structure",
      p_base_versions: { [definition.id]: 1 },
      p_forward: {
        type: "mutate_structure",
        actions: [{ kind: "delete_block", id: definition.id, baseVersion: 1 }],
      },
      p_inverse: {
        type: "mutate_structure",
        actions: [{ kind: "put_block", entity: definition, baseVersion: null }],
      },
    });
    expect(blocked.error).toBeTruthy();
    const { data: stillReferenced, error: definitionError } = await owner
      .from("lukas_drawing_blocks")
      .select("id,version")
      .eq("id", definition.id)
      .single();
    if (definitionError) throw definitionError;
    expect(stillReferenced).toEqual({ id: definition.id, version: 1 });
    await applyStructure(
      owner,
      fixture.blankWorkspace.revisionId,
      [{ kind: "delete_block_instance", id: copyId, baseVersion: 2 }],
      [
        {
          kind: "put_block_instance",
          entity: { ...transformed, version: 2 },
          baseVersion: null,
        },
      ],
      { [copyId]: 2 },
    );
    const { count, error } = await owner
      .from("lukas_drawing_block_instances")
      .select("id", { count: "exact", head: true })
      .eq("id", copyId);
    if (error) throw error;
    expect(count).toBe(0);
  });

  test("Gate 06: approved revision clones with immutable template lineage and source SHA", async () => {
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const reviewer = await authenticateApiClient(fixture, fixture.reviewer);
    const style = {
      id: randomUUID(),
      revisionId: fixture.pdfWorkspace.revisionId,
      name: "Approved template style",
      value: { stroke: "#0f172a", strokeWidth: 2, fill: null },
      version: 1,
    };
    await applyStructure(
      owner,
      fixture.pdfWorkspace.revisionId,
      [{ kind: "put_style", entity: style, baseVersion: null }],
      [{ kind: "delete_style", id: style.id, baseVersion: 1 }],
    );
    const review = await owner.rpc("lukas_drawing_request_review", {
      p_revision_id: fixture.pdfWorkspace.revisionId,
    });
    if (review.error) throw review.error;
    approvedPdfSnapshot = {
      sha256: review.data.snapshotSha256,
      version: review.data.subjectVersion,
    };
    const approval = await reviewer.rpc(
      "lukas_drawing_record_revision_decision",
      {
        p_revision_id: fixture.pdfWorkspace.revisionId,
        p_subject_version: review.data.subjectVersion,
        p_snapshot_sha256: review.data.snapshotSha256,
        p_decision: "approved",
        p_note: "P2 template lineage release gate",
      },
    );
    if (approval.error) throw approval.error;
    const cloned = await owner.rpc("lukas_drawing_create_from_template", {
      p_source_revision_id: fixture.pdfWorkspace.revisionId,
      p_title: "P2 approved template clone",
      p_source_file_id: fixture.pdfFileId,
      p_client_request_id: randomUUID(),
    });
    if (cloned.error) throw cloned.error;
    templateClone = cloned.data as TemplateClone;
    expect(templateClone.sourceRevisionId).toBe(
      fixture.pdfWorkspace.revisionId,
    );
    const [sourceObject, clonedObject, clonedCanvas, clonedRevision] =
      await Promise.all([
        owner
          .from("lukas_drawing_objects")
          .select("id")
          .eq("revision_id", fixture.pdfWorkspace.revisionId)
          .eq("status", "active")
          .limit(1)
          .single(),
        owner
          .from("lukas_drawing_objects")
          .select("id,lineage_id")
          .eq("revision_id", templateClone.revisionId)
          .eq("status", "active")
          .limit(1)
          .single(),
        owner
          .from("lukas_drawing_canvases")
          .select("background_source_file_id,background_source_sha256")
          .eq("revision_id", templateClone.revisionId)
          .limit(1)
          .single(),
        owner
          .from("lukas_drawing_revisions")
          .select("status")
          .eq("id", templateClone.revisionId)
          .single(),
      ]);
    for (const result of [
      sourceObject,
      clonedObject,
      clonedCanvas,
      clonedRevision,
    ])
      if (result.error) throw result.error;
    expect(clonedObject.data?.id).not.toBe(sourceObject.data?.id);
    expect(clonedObject.data?.lineage_id).toBe(sourceObject.data?.id);
    expect(clonedCanvas.data).toEqual({
      background_source_file_id: fixture.pdfFileId,
      background_source_sha256:
        immutableSourceBefore[fixture.pdfFileId].storageByteSha256,
    });
    expect(clonedRevision.data?.status).toBe("draft");
    expect(await readSourceEvidence(fixture)).toEqual(immutableSourceBefore);
  });

  test("Gate 07: five property types persist and required review validation fails closed", async () => {
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const { data: schemas, error: schemaError } = await owner
      .from("lukas_drawing_property_schemas")
      .select("value_type")
      .eq("revision_id", fixture.blankWorkspace.revisionId);
    if (schemaError) throw schemaError;
    expect(new Set(schemas?.map(({ value_type }) => value_type))).toEqual(
      new Set(["text", "number", "boolean", "date", "enum"]),
    );
    const requiredSchema = {
      id: randomUUID(),
      revisionId: fixture.blankWorkspace.revisionId,
      name: "Required approval evidence",
      valueType: "text",
      enumOptions: [],
      appliesTo: ["dimension"],
      required: true,
      version: 1,
    };
    const requiredObject = {
      id: randomUUID(),
      name: "Required dimension",
      layerId: fixture.blankWorkspace.workLayerId,
      geometry: {
        type: "dimension",
        start: { x: 1, y: 1 },
        end: { x: 20, y: 1 },
        offset: 3,
        calibrationId: null,
      },
      style: { stroke: "#334155", strokeWidth: 1, fill: null },
      version: 1,
    };
    await addObjects(owner, fixture.blankWorkspace.revisionId, [
      requiredObject,
    ]);
    await applyStructure(
      owner,
      fixture.blankWorkspace.revisionId,
      [
        {
          kind: "put_property_schema",
          entity: requiredSchema,
          baseVersion: null,
        },
      ],
      [
        {
          kind: "delete_property_schema",
          id: requiredSchema.id,
          baseVersion: 1,
        },
      ],
    );
    const rejected = await owner.rpc("lukas_drawing_request_review", {
      p_revision_id: fixture.blankWorkspace.revisionId,
    });
    expect(rejected.error).toBeTruthy();
    expect(rejected.error?.code).toBe("P1C01");
    const value = {
      id: randomUUID(),
      schemaId: requiredSchema.id,
      objectId: requiredObject.id,
      blockInstanceId: null,
      value: "complete",
      version: 1,
    };
    await applyStructure(
      owner,
      fixture.blankWorkspace.revisionId,
      [{ kind: "put_property_value", entity: value, baseVersion: null }],
      [{ kind: "delete_property_value", id: value.id, baseVersion: 1 }],
    );
  });

  test("Gate 08: schedule object property and manual cells resolve deterministically", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      workspacePath(fixture, fixture.blankWorkspace),
    );
    await waitUntilSaved(page);
    await page.getByRole("tab", { name: "표·일람" }).click();
    const table = performanceFixture.tables[0];
    const schedule = page.getByRole("table", { name: table.name });
    await expect(schedule).toBeVisible();
    await expect(schedule.getByRole("row")).toHaveCount(21);
    const firstRow = schedule.getByRole("row").nth(1);
    await expect(firstRow).toContainText(performanceFixture.objects[0].name);
    await expect(firstRow).toContainText("P2 value 1");
    await expect(page.getByLabel(`${table.name} 1 Manual note`)).toHaveValue(
      "manual-0-0",
    );
    await expect(page.getByLabel(`${table.name} 1 Manual number`)).toHaveValue(
      "0.25",
    );
    await page.reload();
    await waitUntilSaved(page);
    await page.getByRole("tab", { name: "표·일람" }).click();
    await expect(
      page.getByRole("table", { name: table.name }).getByRole("row").nth(1),
    ).toContainText(performanceFixture.objects[0].name);
    await context.close();
  });

  test("Gate 09: offline outbox replay and reload preserve complete P2 state", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      workspacePath(fixture, fixture.blankWorkspace),
    );
    await waitUntilSaved(page);
    await page.getByRole("tab", { name: "스타일" }).click();
    await context.setOffline(true);
    const styleName = page.getByLabel("스타일 이름: P2 style 01");
    await styleName.fill("P2 offline replay style");
    await styleName
      .locator("xpath=ancestor::form")
      .getByRole("button", { name: "스타일 저장" })
      .click();
    await expect(page.getByRole("status", { name: /오프라인/ })).toBeVisible();
    await context.setOffline(false);
    await waitUntilSaved(page);
    await page.reload();
    await waitUntilSaved(page);
    await page.getByRole("tab", { name: "스타일" }).click();
    await expect(
      page.getByLabel("스타일 이름: P2 offline replay style"),
    ).toBeVisible();
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const counts = {};
    for (const [table, expected] of [
      ["lukas_drawing_canvases", 20],
      ["lukas_drawing_objects", 10_001],
      ["lukas_drawing_block_instances", 1_000],
      ["lukas_drawing_styles", 20],
      ["lukas_drawing_property_schemas", 21],
      ["lukas_drawing_property_values", 21],
      ["lukas_drawing_tables", 5],
    ] as const) {
      const result = await owner
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("revision_id", fixture.blankWorkspace.revisionId);
      if (result.error) throw result.error;
      Object.assign(counts, { [table]: result.count });
      expect(result.count, table).toBe(expected);
    }
    expect(Object.keys(counts)).toHaveLength(7);
    await context.close();
  });

  test("Gate 10: deterministic snapshot v2 approval denies direct DML and RPC mutation", async ({
    browser,
  }) => {
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const editor = await authenticateApiClient(fixture, fixture.editor);
    const reviewer = await authenticateApiClient(fixture, fixture.reviewer);
    const viewer = await authenticateApiClient(fixture, fixture.viewer);
    const outsider = await authenticateApiClient(fixture, fixture.nonMember);
    const path = workspacePath(fixture, fixture.blankWorkspace);

    const editorContext = await browser.newContext();
    const editorPage = await authenticateContext(
      fixture,
      editorContext,
      fixture.editor,
      baseUrl,
      path,
    );
    await expect(
      editorPage.getByRole("button", { name: "선 도구" }),
    ).toBeVisible();
    const reviewerContext = await browser.newContext();
    const reviewerPage = await authenticateContext(
      fixture,
      reviewerContext,
      fixture.reviewer,
      baseUrl,
      path,
    );
    await expect(
      reviewerPage.getByRole("button", { name: "선 도구" }),
    ).toHaveCount(0);
    const viewerContext = await browser.newContext();
    const viewerPage = await authenticateContext(
      fixture,
      viewerContext,
      fixture.viewer,
      baseUrl,
      path,
    );
    await expect(
      viewerPage.getByRole("button", { name: "선 도구" }),
    ).toHaveCount(0);
    await expect(
      viewerPage.getByRole("button", { name: "내보내기" }),
    ).toBeVisible();
    const outsiderRead = await outsider
      .from("lukas_drawing_documents")
      .select("id")
      .eq("id", fixture.blankWorkspace.documentId);
    expect(outsiderRead.error).toBeNull();
    expect(outsiderRead.data).toEqual([]);

    const editorObject = {
      id: randomUUID(),
      name: "P2 editor-authored evidence",
      layerId: performanceFixture.layers[0].id,
      geometry: {
        type: "line",
        start: { x: 8, y: 8 },
        end: { x: 16, y: 16 },
      },
      style: { stroke: "#0f172a", strokeWidth: 1, fill: null },
      version: 1,
    };
    await addObjects(editor, fixture.blankWorkspace.revisionId, [editorObject]);
    const editorRead = await editor
      .from("lukas_drawing_objects")
      .select("id,name,version")
      .eq("id", editorObject.id)
      .single();
    if (editorRead.error) throw editorRead.error;
    expect(editorRead.data).toEqual({
      id: editorObject.id,
      name: editorObject.name,
      version: 1,
    });
    const review = await editor.rpc("lukas_drawing_request_review", {
      p_revision_id: fixture.blankWorkspace.revisionId,
    });
    if (review.error) throw review.error;
    expect(review.data.schemaVersion).toBe(2);
    const ownApproval = await owner.rpc(
      "lukas_drawing_record_revision_decision",
      {
        p_revision_id: fixture.blankWorkspace.revisionId,
        p_subject_version: review.data.subjectVersion,
        p_snapshot_sha256: review.data.snapshotSha256,
        p_decision: "approved",
        p_note: "maker must not approve",
      },
    );
    expect(ownApproval.error).toBeTruthy();
    const editorApproval = await editor.rpc(
      "lukas_drawing_record_revision_decision",
      {
        p_revision_id: fixture.blankWorkspace.revisionId,
        p_subject_version: review.data.subjectVersion,
        p_snapshot_sha256: review.data.snapshotSha256,
        p_decision: "approved",
        p_note: "editor role has no approval capability",
      },
    );
    expect(editorApproval.error).toBeTruthy();
    const approval = await reviewer.rpc(
      "lukas_drawing_record_revision_decision",
      {
        p_revision_id: fixture.blankWorkspace.revisionId,
        p_subject_version: review.data.subjectVersion,
        p_snapshot_sha256: review.data.snapshotSha256,
        p_decision: "approved",
        p_note: "P2 complete canonical approval",
      },
    );
    if (approval.error) throw approval.error;
    const { data: snapshots, error: snapshotError } = await owner
      .from("lukas_drawing_snapshots")
      .select("schema_version,canonical_json,sha256")
      .eq("revision_id", fixture.blankWorkspace.revisionId)
      .eq("sha256", review.data.snapshotSha256);
    if (snapshotError) throw snapshotError;
    expect(snapshots).toHaveLength(1);
    expect(snapshots?.[0].schema_version).toBe(2);
    expect(snapshots?.[0].sha256).toBe(review.data.snapshotSha256);
    for (const key of [
      "pages",
      "canvases",
      "layers",
      "objects",
      "styles",
      "blocks",
      "blockInstances",
      "propertySchemas",
      "propertyValues",
      "tables",
    ])
      expect(Array.isArray(snapshots?.[0].canonical_json[key]), key).toBe(true);

    const probes = [
      [
        "lukas_drawing_canvases",
        performanceFixture.canvases[0].id,
        { name: "forged" },
      ],
      [
        "lukas_drawing_styles",
        performanceFixture.styles[0].id,
        { name: "forged" },
      ],
      [
        "lukas_drawing_blocks",
        performanceFixture.blocks[0].id,
        { name: "forged" },
      ],
      [
        "lukas_drawing_block_instances",
        performanceFixture.blockInstances[0].id,
        { name: "forged" },
      ],
      [
        "lukas_drawing_property_schemas",
        performanceFixture.propertySchemas[0].id,
        { name: "forged" },
      ],
      [
        "lukas_drawing_property_values",
        performanceFixture.propertyValues[0].id,
        { version: 99 },
      ],
      [
        "lukas_drawing_tables",
        performanceFixture.tables[0].id,
        { name: "forged" },
      ],
    ] as const;
    for (const [table, id, patch] of probes) {
      const before = await editor.from(table).select("*").eq("id", id).single();
      if (before.error) throw before.error;
      const update = await editor
        .from(table)
        .update(patch)
        .eq("id", id)
        .select("id");
      const deletion = await editor
        .from(table)
        .delete()
        .eq("id", id)
        .select("id");
      expect(
        Boolean(update.error) || update.data?.length === 0,
        `${table} update`,
      ).toBe(true);
      expect(
        Boolean(deletion.error) || deletion.data?.length === 0,
        `${table} delete`,
      ).toBe(true);
      const after = await editor.from(table).select("*").eq("id", id).single();
      if (after.error) throw after.error;
      expect(after.data, table).toEqual(before.data);
    }
    const rpcDenied = await editor.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "mutate_structure",
      p_base_versions: { [performanceFixture.styles[0].id]: 2 },
      p_forward: {
        type: "mutate_structure",
        actions: [
          {
            kind: "put_style",
            entity: {
              ...performanceFixture.styles[0],
              name: "RPC forged",
              version: 2,
            },
            baseVersion: 2,
          },
        ],
      },
      p_inverse: { type: "mutate_structure", actions: [] },
    });
    expect(rpcDenied.error).toBeTruthy();
    expect(
      (
        await viewer
          .from("lukas_drawing_styles")
          .select("id")
          .eq("revision_id", fixture.blankWorkspace.revisionId)
      ).data?.length,
    ).toBe(20);
    await editorContext.close();
    await reviewerContext.close();
    await viewerContext.close();
  });

  test("Gate 11: downloaded PNG SVG and PDF parse visible canonical content in page order", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.viewer,
      baseUrl,
      workspacePath(fixture, fixture.blankWorkspace),
    );
    await expect(page.getByLabel(/도면 화면/)).toHaveAttribute(
      "data-rendered-object-count",
      "502",
    );
    const svg = await runDownload(page, "SVG");
    expect(svg.filename).toMatch(/\.svg$/);
    const xml = new XMLParser({ ignoreAttributes: false }).parse(
      svg.bytes.toString("utf8"),
    );
    expect(xml.svg["@_viewBox"]).toBeTruthy();
    expect(svg.bytes.toString("utf8")).toContain("P2 active selection target");
    expect(svg.bytes.toString("utf8")).toContain("P2 active block instance");

    const png = await runDownload(page, "PNG");
    expect(png.filename).toMatch(/@2x\.png$/);
    const pngEvidence = parsePng(png.bytes);
    expect(pngEvidence).toEqual({ width: 840, height: 594 });

    const pdf = await runDownload(page, "PDF");
    expect(pdf.filename).toMatch(/\.pdf$/);
    const parsedPdf = await PDFDocument.load(pdf.bytes);
    const expectedPaper = performanceFixture.canvases
      .filter(({ spaceKind }) => spaceKind === "paper")
      .sort((left, right) => {
        const leftPage = performanceFixture.pages.find(
          ({ id }) => id === left.pageId,
        )!;
        const rightPage = performanceFixture.pages.find(
          ({ id }) => id === right.pageId,
        )!;
        return (
          leftPage.sortOrder - rightPage.sortOrder ||
          left.sortOrder - right.sortOrder ||
          left.id.localeCompare(right.id)
        );
      });
    expect(parsedPdf.getPageCount()).toBe(expectedPaper.length);
    parsedPdf.getPages().forEach((pdfPage, index) => {
      expect(pdfPage.getWidth()).toBeCloseTo(
        (expectedPaper[index].widthMillimeters * 72) / 25.4,
        4,
      );
      expect(pdfPage.getHeight()).toBeCloseTo(
        (expectedPaper[index].heightMillimeters * 72) / 25.4,
        4,
      );
      expect(pdfPage.node.Resources()?.lookupMaybe).toBeTruthy();
    });
    expect(parsedPdf.getTitle()).toBeTruthy();
    expect(parsedPdf.getSubject()).toBe("Canonical drawing workspace export");
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const revision = await owner
      .from("lukas_drawing_revisions")
      .select("id,document_id,version")
      .eq("id", fixture.blankWorkspace.revisionId)
      .single();
    if (revision.error) throw revision.error;
    const receipts = await owner
      .from("lukas_qto_export_events")
      .select(
        "request_id,artifact_type,artifact_sha256,artifact_byte_size,workspace_id,revision_id,revision_version,operation_checkpoint,checkpoint_sha256",
      )
      .in("request_id", [svg.requestId, png.requestId, pdf.requestId]);
    if (receipts.error) throw receipts.error;
    expect(receipts.data).toHaveLength(3);
    const receiptByRequest = new Map(
      receipts.data.map((receipt) => [receipt.request_id, receipt]),
    );
    for (const [downloaded, artifactType] of [
      [svg, "drawing_svg"],
      [png, "drawing_png"],
      [pdf, "drawing_pdf"],
    ] as const) {
      const receipt = receiptByRequest.get(downloaded.requestId);
      expect(receipt?.artifact_type).toBe(artifactType);
      expect(receipt?.artifact_sha256).toBe(
        createHash("sha256").update(downloaded.bytes).digest("hex"),
      );
      expect(receipt?.artifact_byte_size).toBe(downloaded.bytes.byteLength);
      expect(receipt?.workspace_id).toBe(fixture.blankWorkspace.documentId);
      expect(receipt?.revision_id).toBe(fixture.blankWorkspace.revisionId);
      expect(receipt?.revision_version).toBe(revision.data.version);
      expect(Number(receipt?.operation_checkpoint)).toBeGreaterThanOrEqual(0);
      expect(receipt?.checkpoint_sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    const durations = {
      svgMs: svg.durationMs,
      pngMs: png.durationMs,
      pdfMs: pdf.durationMs,
      productTargets: {
        svgAtMost30Seconds: svg.durationMs <= 30_000,
        pngAtMost30Seconds: png.durationMs <= 30_000,
        pdfAtMost30Seconds: pdf.durationMs <= 30_000,
      },
    };
    test.info().annotations.push({
      type: "export-performance",
      description: JSON.stringify(durations),
    });
    expect(
      Math.max(svg.durationMs, png.durationMs, pdf.durationMs),
    ).toBeLessThanOrEqual(30_000);
    await context.close();
  });

  test("Gate 12: PDF IFC source SHA and P0/P1 quantity approval and Revit routes do not regress", async ({
    browser,
  }) => {
    expect(await readSourceEvidence(fixture)).toEqual(immutableSourceBefore);
    for (const evidence of Object.values(immutableSourceBefore)) {
      expect(evidence.metadataSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(evidence.storageByteSha256).toBe(evidence.metadataSha256);
      expect(evidence.byteLength).toBeGreaterThan(0);
    }
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const { data: approved, error: approvedError } = await owner
      .from("lukas_drawing_revision_approvals")
      .select("decision,snapshot_sha256")
      .eq("revision_id", fixture.pdfWorkspace.revisionId)
      .eq("decision", "approved")
      .single();
    if (approvedError) throw approvedError;
    expect(approved).toEqual({
      decision: "approved",
      snapshot_sha256: approvedPdfSnapshot.sha256,
    });
    expect(templateClone.sourceRevisionId).toBe(
      fixture.pdfWorkspace.revisionId,
    );

    const context = await browser.newContext();
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      "/",
    );
    for (const [route, visibleEvidence] of [
      [`/projects/${fixture.projectId}`, /1HK Drawing E2E/],
      [
        `/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}`,
        /1HK-test-drawing\.pdf/,
      ],
      [`/projects/${fixture.projectId}/quantities`, /물량 산출 결과/],
      [`/projects/${fixture.projectId}/materials`, /자재 관리/],
      [
        `/projects/${fixture.projectId}/ifc/${fixture.ifcFileId}`,
        /모델을 보고 요소와 속성을 확인합니다/,
      ],
    ] as const) {
      const response = await page.goto(`${baseUrl}${route}`);
      expect(response?.status(), route).toBe(200);
      expect(page.url(), route).toContain(route);
      await expect(page.getByText(visibleEvidence).first()).toBeVisible();
    }

    const downloadLanding = await page.goto(`${baseUrl}/download`);
    expect(downloadLanding?.status()).toBe(200);
    const revitLink = page.getByRole("link", {
      name: /현장 검증 ZIP 다운로드/,
    });
    await expect(revitLink).toHaveAttribute("href", "/download/revit-2025");
    const releaseRedirect = await page.request.get(
      `${baseUrl}/download/revit-2025`,
      { maxRedirects: 0 },
    );
    expect([301, 302, 303, 307, 308]).toContain(releaseRedirect.status());
    const releaseUrl = releaseRedirect.headers().location;
    expect(releaseUrl).toBeTruthy();
    const releaseDownload = await page.request.get(releaseUrl!);
    expect(releaseDownload.ok()).toBe(true);
    expect((await releaseDownload.body()).byteLength).toBeGreaterThan(0);
    await context.close();
    const combinedSha = createHash("sha256")
      .update(
        Object.values(immutableSourceBefore)
          .map(({ storageByteSha256 }) => storageByteSha256)
          .sort()
          .join(""),
      )
      .digest("hex");
    expect(combinedSha).toMatch(/^[0-9a-f]{64}$/);
  });
});
