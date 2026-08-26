import { createHash, createHmac, randomUUID } from "node:crypto";
import os from "node:os";

import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Download,
  type Page,
} from "@playwright/test";
import CrossWebSocket from "crossws/websocket";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";
import * as Y from "yjs";

import { appendDrawingCollaborationOperation } from "../app/lukas/lib/drawing-collaboration-yjs";
import type { DrawingCollaborationOperation } from "../app/lukas/lib/drawing-collaboration-protocol";
import {
  authenticateApiClient,
  authenticateContext,
  buildDrawingP2PerformanceFixture,
  createDrawingFixture,
  destroyDrawingP3Fixture,
  readSourceEvidence,
  requireDrawingP3ProductionCredentials,
  type DrawingFixture,
} from "./utils/drawing-collaboration-fixture";

const credentials = requireDrawingP3ProductionCredentials(process.env);
const baseUrl = credentials.E2E_BASE_URL;
const collaborationUrl = credentials.VITE_DRAWING_COLLABORATION_URL;
const trackedContexts = new Set<BrowserContext>();
const trackedProviderDisposers = new Set<() => void>();

type ApiClient = Awaited<ReturnType<typeof authenticateApiClient>>;
type TestUser = DrawingFixture["owner"];

function workspacePath(
  fixture: DrawingFixture,
  workspace: DrawingFixture["blankWorkspace"],
  documentId?: string,
) {
  const query = documentId ? `?document=${encodeURIComponent(documentId)}` : "";
  return `/projects/${fixture.projectId}/drawings/${workspace.fileId}/workspace${query}`;
}

function roomName(fixture: DrawingFixture, revisionId: string) {
  return `drawing:${fixture.projectId}:${revisionId}`;
}

function displayName(user: TestUser) {
  return user.email.split("@")[0];
}

function trackContext(context: BrowserContext) {
  trackedContexts.add(context);
  context.on("close", () => trackedContexts.delete(context));
  return context;
}

async function waitUntilSaved(page: Page) {
  await expect(
    page.getByRole("status", { name: "저장 상태: 저장됨" }),
  ).toBeVisible({
    timeout: 45_000,
  });
}

async function canvasPoint(page: Page, world: { x: number; y: number }) {
  const surface = page.getByLabel(/도면 화면/);
  const box = await surface.boundingBox();
  if (!box) throw new Error("Drawing canvas has no layout box");
  const [x, y, zoom] = await Promise.all([
    surface.getAttribute("data-viewport-x"),
    surface.getAttribute("data-viewport-y"),
    surface.getAttribute("data-viewport-zoom"),
  ]);
  return {
    x: box.x + Number(x) + world.x * Number(zoom),
    y: box.y + Number(y) + world.y * Number(zoom),
  };
}

async function dragWorld(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const start = await canvasPoint(page, from);
  const end = await canvasPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

async function addObject(
  client: ApiClient,
  fixture: DrawingFixture,
  input: {
    id?: string;
    name: string;
    center: { x: number; y: number };
    revisionId?: string;
    layerId?: string;
  },
) {
  const id = input.id ?? randomUUID();
  const revisionId = input.revisionId ?? fixture.blankWorkspace.revisionId;
  const layerId = input.layerId ?? fixture.blankWorkspace.workLayerId;
  const operation = {
    revisionId,
    clientOperationId: randomUUID(),
    type: "add_objects",
    baseVersions: {},
    forward: {
      type: "add_objects",
      objects: [
        {
          id,
          name: input.name,
          layerId,
          geometry: { type: "circle", center: input.center, radius: 6 },
          style: { stroke: "#2563eb", strokeWidth: 2, fill: "#bfdbfe55" },
          version: 1,
        },
      ],
    },
    inverse: { type: "delete_objects", objectIds: [id] },
    createdAt: new Date().toISOString(),
  };
  const result = await client.rpc("lukas_drawing_apply_operation", {
    p_revision_id: revisionId,
    p_client_operation_id: operation.clientOperationId,
    p_operation_type: operation.type,
    p_base_versions: operation.baseVersions,
    p_forward: operation.forward,
    p_inverse: operation.inverse,
  });
  if (result.error) throw result.error;
  return {
    id,
    operation,
    result: result.data as {
      sequence: number;
      resultVersions: Record<string, number>;
    },
  };
}

async function addSmallPageCanvas(fixture: DrawingFixture, owner: ApiClient) {
  const built = buildDrawingP2PerformanceFixture({
    revisionId: fixture.blankWorkspace.revisionId,
    pageId: fixture.blankWorkspace.pageId,
    canvasId: fixture.blankWorkspace.canvasId,
    layerId: fixture.blankWorkspace.workLayerId,
  });
  const page = built.pages[1];
  const canvas = built.canvases.find(
    (candidate) => candidate.pageId === page.id,
  )!;
  const layer = built.layers.find(
    (candidate) =>
      candidate.id !== fixture.blankWorkspace.workLayerId &&
      candidate.canvasId === canvas.id,
  )!;
  const actions = [
    { kind: "put_page", entity: page, baseVersion: null },
    { kind: "put_canvas", entity: canvas, baseVersion: null },
    { kind: "put_layer", entity: layer, baseVersion: null },
  ];
  const inverse = [
    { kind: "delete_layer", id: layer.id, baseVersion: 1 },
    { kind: "delete_canvas", id: canvas.id, baseVersion: 1 },
    { kind: "delete_page", id: page.id, baseVersion: 1 },
  ];
  const result = await owner.rpc("lukas_drawing_apply_operation", {
    p_revision_id: fixture.blankWorkspace.revisionId,
    p_client_operation_id: randomUUID(),
    p_operation_type: "mutate_structure",
    p_base_versions: {},
    p_forward: { type: "mutate_structure", actions },
    p_inverse: { type: "mutate_structure", actions: inverse },
  });
  if (result.error) throw result.error;
  return { page, canvas, layer };
}

async function seedQuantityArtifact(fixture: DrawingFixture) {
  const roles = [
    "export_manifest",
    "ifc",
    "qto",
    "element_ledger",
    "revit_mapping",
    "concrete_rules",
    "registry",
  ] as const;
  const evidenceFiles = [
    fixture.pdfFileId,
    fixture.ifcFileId,
    fixture.revisedPdfFileId,
    fixture.revisedIfcFileId,
  ];
  const inputSha256 = Object.fromEntries(
    roles.map((role, index) => [
      role,
      fixture.sourceEvidence[evidenceFiles[index % evidenceFiles.length]]
        .metadataSha256,
    ]),
  );
  const quantityArtifact = await fixture.admin
    .from("lukas_qto_takeoff_artifacts")
    .insert({
      project_id: fixture.projectId,
      artifact_kind: "concrete_takeoff",
      format_version: "CONCRETE_TAKEOFF_CSV_V1",
      report_file_id: fixture.pdfFileId,
      manifest_file_id: fixture.revisedPdfFileId,
      report_sha256: fixture.sourceEvidence[fixture.pdfFileId].metadataSha256,
      manifest_sha256:
        fixture.sourceEvidence[fixture.revisedPdfFileId].metadataSha256,
      row_count: 1,
      input_sha256: inputSha256,
      status_counts: { PASS: 1 },
      created_by: fixture.owner.id,
    })
    .select("id,row_count,input_sha256,status_counts")
    .single();
  if (quantityArtifact.error) throw quantityArtifact.error;
  const inputs = roles.map((role, index) => {
    const fileId = evidenceFiles[index % evidenceFiles.length];
    return {
      artifact_id: quantityArtifact.data.id,
      project_id: fixture.projectId,
      input_role: role,
      file_id: fileId,
      source_sha256: fixture.sourceEvidence[fileId].metadataSha256,
    };
  });
  const inserted = await fixture.admin
    .from("lukas_qto_takeoff_inputs")
    .insert(inputs);
  if (inserted.error) throw inserted.error;
  return quantityArtifact.data;
}

async function openWorkspace(
  browser: Browser,
  fixture: DrawingFixture,
  user: TestUser,
  path = workspacePath(fixture, fixture.blankWorkspace),
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  trackContext(context);
  const page = await authenticateContext(fixture, context, user, baseUrl, path);
  await expect(
    page.getByRole("status", { name: "공동 편집 상태: connected" }),
  ).toBeVisible({ timeout: 45_000 });
  return { context, page };
}

function percentile(values: number[], ratio: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * ratio) - 1] ?? 0;
}

async function tokenFor(fixture: DrawingFixture, user: TestUser) {
  const client = await authenticateApiClient(fixture, user);
  const { data } = await client.auth.getSession();
  if (!data.session?.access_token) throw new Error("P3 provider token missing");
  return { client, token: data.session.access_token };
}

const NodeOriginWebSocket = CrossWebSocket as unknown as new (
  url: string,
  protocols?: string[],
  options?: { origin?: string },
) => WebSocket;

class OriginWebSocket extends NodeOriginWebSocket {
  constructor(url: string) {
    super(url, [], { origin: new URL(baseUrl).origin });
  }
}

async function connectProvider(
  fixture: DrawingFixture,
  user: TestUser,
  revisionId = fixture.blankWorkspace.revisionId,
) {
  const { client, token } = await tokenFor(fixture, user);
  const document = new Y.Doc();
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: collaborationUrl,
    WebSocketPolyfill: OriginWebSocket,
  });
  let provider: HocuspocusProvider;
  const synced = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("P3 provider sync timed out")),
      20_000,
    );
    provider = new HocuspocusProvider({
      websocketProvider,
      name: roomName(fixture, revisionId),
      document,
      token,
      onSynced: () => {
        clearTimeout(timeout);
        resolve();
      },
      onAuthenticationFailed: ({ reason }) => {
        clearTimeout(timeout);
        reject(new Error(reason));
      },
    });
  });
  try {
    await synced;
  } catch (error) {
    const cleanupErrors: unknown[] = [error];
    for (const cleanup of [
      () => provider?.destroy(),
      () => websocketProvider.destroy(),
      () => document.destroy(),
    ]) {
      try {
        cleanup();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    throw new AggregateError(
      cleanupErrors,
      "P3 provider failed to synchronize and clean up",
    );
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    trackedProviderDisposers.delete(dispose);
    const errors: unknown[] = [];
    for (const cleanup of [
      () => provider!.destroy(),
      () => websocketProvider.destroy(),
      () => document.destroy(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length)
      throw new AggregateError(errors, "P3 provider cleanup failed");
  };
  trackedProviderDisposers.add(dispose);
  return {
    client,
    document,
    provider: provider!,
    dispose,
  };
}

async function deniedProvider(fixture: DrawingFixture, user: TestUser) {
  const { token } = await tokenFor(fixture, user);
  const document = new Y.Doc();
  const websocketProvider = new HocuspocusProviderWebsocket({
    url: collaborationUrl,
    WebSocketPolyfill: OriginWebSocket,
  });
  let provider: HocuspocusProvider;
  let result: { connected: boolean; reason: string } | undefined;
  let primaryError: unknown;
  try {
    result = await new Promise<{ connected: boolean; reason: string }>(
      (resolve, reject) => {
        const timeout = setTimeout(
          () =>
            reject(new Error("P3 denied-provider classification timed out")),
          10_000,
        );
        provider = new HocuspocusProvider({
          websocketProvider,
          name: roomName(fixture, fixture.blankWorkspace.revisionId),
          document,
          token,
          onSynced: () => {
            clearTimeout(timeout);
            resolve({ connected: true, reason: "unexpected sync" });
          },
          onAuthenticationFailed: ({ reason }) => {
            clearTimeout(timeout);
            resolve({ connected: false, reason });
          },
          onClose: () => {
            clearTimeout(timeout);
            reject(
              new Error(
                "P3 denied-provider closed without an authentication denial",
              ),
            );
          },
        });
      },
    );
  } catch (error) {
    primaryError = error;
  }
  const cleanupErrors: unknown[] = [];
  for (const cleanup of [
    () => provider?.destroy(),
    () => websocketProvider.destroy(),
    () => document.destroy(),
  ]) {
    try {
      cleanup();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (primaryError) cleanupErrors.unshift(primaryError);
  if (cleanupErrors.length)
    throw new AggregateError(
      cleanupErrors,
      "P3 denied-provider cleanup failed",
    );
  if (!result) throw new Error("P3 denied-provider returned no result");
  return result;
}

async function sendOutcomeReceipt(
  fixture: DrawingFixture,
  operation: DrawingCollaborationOperation,
  outcome: "acked" | "conflicted",
  authoritativeSequence: number | null,
  resultVersions: Record<string, number>,
) {
  const body = JSON.stringify({
    receiptId: operation.clientOperationId,
    roomName: roomName(fixture, operation.revisionId),
    operationId: operation.clientOperationId,
    operation,
    outcome,
    authoritativeSequence,
    resultVersions,
  });
  const signature = createHmac(
    "sha256",
    credentials.COLLABORATION_INTERNAL_SECRET,
  )
    .update(body)
    .digest("hex");
  const response = await fetch(
    new URL("/internal/outcomes", credentials.COLLABORATION_INTERNAL_URL),
    {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-1hk-signature": signature,
      },
    },
  );
  expect(response.ok).toBe(true);
}

async function downloadBytes(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Playwright download stream is unavailable");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function runDownload(page: Page, format: "SVG" | "PDF") {
  await page.getByRole("button", { name: "내보내기" }).click();
  await page.getByLabel(format, { exact: true }).check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "다운로드", exact: true }).click(),
  ]);
  const bytes = await downloadBytes(download);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  return { bytes, filename: download.suggestedFilename() };
}

async function readOutboxIds(page: Page, ownerId: string, revisionId: string) {
  return page.evaluate(
    ({ ownerId, revisionId }) =>
      new Promise<string[]>((resolve, reject) => {
        const request = indexedDB.open("1hk-drawing-workspace", 2);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("operations", "readonly");
          const rows = transaction.objectStore("operations").getAll();
          rows.onerror = () => reject(rows.error);
          rows.onsuccess = () => {
            resolve(
              (
                rows.result as Array<{
                  clientOperationId: string;
                  ownerId?: string;
                  revisionId: string;
                }>
              )
                .filter(
                  (row) =>
                    row.ownerId === ownerId && row.revisionId === revisionId,
                )
                .map((row) => row.clientOperationId),
            );
            db.close();
          };
        };
      }),
    { ownerId, revisionId },
  );
}

test.describe
  .serial("1HK Drawing Workspace P3 production collaboration", () => {
  let fixture: DrawingFixture;
  let immutableSourceBefore: DrawingFixture["sourceEvidence"];
  let sharedObjectId: string;
  let quantityArtifact: Awaited<ReturnType<typeof seedQuantityArtifact>>;
  let nextDraft: { documentId: string; revisionId: string } | null = null;

  test.beforeAll(async () => {
    fixture = await createDrawingFixture({
      p3RunId: credentials.P3_E2E_RUN_ID,
    });
    immutableSourceBefore = structuredClone(fixture.sourceEvidence);
    const owner = await authenticateApiClient(fixture, fixture.owner);
    sharedObjectId = (
      await addObject(owner, fixture, {
        name: "P3 shared lock target",
        center: { x: 120, y: 90 },
      })
    ).id;
    await addSmallPageCanvas(fixture, owner);
    quantityArtifact = await seedQuantityArtifact(fixture);
  });

  test.afterEach(async () => {
    const disposers = [...trackedProviderDisposers];
    const providerResults = await Promise.allSettled(
      disposers.map(async (dispose) => dispose()),
    );
    const contextResults = await Promise.allSettled(
      [...trackedContexts].map((context) => context.close()),
    );
    const errors = [...providerResults, ...contextResults]
      .filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      )
      .map((result) => result.reason);
    if (errors.length)
      throw new AggregateError(errors, "P3 browser context cleanup failed");
  });

  test.afterAll(async () => {
    await destroyDrawingP3Fixture(
      fixture,
      credentials.P3_E2E_DATABASE_ADMIN_URL,
    );
  });

  test("P3 Gate 01: three participants share world cursor selection and canvas scope", async ({
    browser,
  }) => {
    const threeContexts = await Promise.all([
      openWorkspace(browser, fixture, fixture.owner),
      openWorkspace(browser, fixture, fixture.editor),
      openWorkspace(browser, fixture, fixture.reviewer),
    ]);
    const [owner, editor, reviewer] = threeContexts;
    for (const { page } of threeContexts)
      await expect(
        page.getByRole("status", { name: "공동 작업 참여자 3명" }),
      ).toBeVisible();

    const cursorWorld = { x: 72, y: 48 };
    const cursorScreen = await canvasPoint(editor.page, cursorWorld);
    await editor.page.mouse.move(cursorScreen.x, cursorScreen.y);
    const remoteCursor = owner.page.getByLabel(
      `${displayName(fixture.editor)} 커서`,
    );
    await expect(remoteCursor).toBeVisible();
    const ownerSurface = owner.page.getByLabel(/도면 화면/);
    const ownerBox = await ownerSurface.boundingBox();
    if (!ownerBox) throw new Error("Owner canvas has no box");
    const left = Number.parseFloat(
      (await remoteCursor.evaluate((node) => getComputedStyle(node).left)) ||
        "NaN",
    );
    const top = Number.parseFloat(
      (await remoteCursor.evaluate((node) => getComputedStyle(node).top)) ||
        "NaN",
    );
    const expected = await canvasPoint(owner.page, cursorWorld);
    expect(left).toBeCloseTo(expected.x - ownerBox.x + 10, 0);
    expect(top).toBeCloseTo(expected.y - ownerBox.y + 10, 0);

    await editor.page.getByRole("button", { name: "선택 도구" }).click();
    const target = await canvasPoint(editor.page, { x: 120, y: 90 });
    await editor.page.mouse.click(target.x, target.y);
    await expect(ownerSurface).toHaveAttribute(
      "data-remote-selection-count",
      "1",
    );

    await editor.page.getByRole("tab", { name: "페이지·레이어" }).click();
    const secondCanvas = editor.page.getByRole("button", {
      name: /P2 (paper|model) canvas 02/,
    });
    await secondCanvas.click();
    const activeCanvasId = await editor.page
      .getByLabel(/도면 화면/)
      .getAttribute("data-active-canvas-id");
    expect(activeCanvasId).not.toBe(fixture.blankWorkspace.canvasId);
    await expect(
      owner.page.getByLabel(`${displayName(fixture.editor)} 커서`),
    ).toHaveCount(0);
    await Promise.all(threeContexts.map(({ context }) => context.close()));
    expect(reviewer.page.isClosed()).toBe(true);
  });

  test("P3 Gate 02: different-object collaboration meets measured reflection target", async ({
    browser,
    browserName,
  }) => {
    const ownerApi = await authenticateApiClient(fixture, fixture.owner);
    const first = await addObject(ownerApi, fixture, {
      name: "P3 differentObject A",
      center: { x: 180, y: 100 },
    });
    const second = await addObject(ownerApi, fixture, {
      name: "P3 differentObject B",
      center: { x: 230, y: 100 },
    });
    const differentObject = [first.id, second.id];
    expect(new Set(differentObject).size).toBe(2);
    const [owner, editor, observer] = await Promise.all([
      openWorkspace(browser, fixture, fixture.owner),
      openWorkspace(browser, fixture, fixture.editor),
      openWorkspace(browser, fixture, fixture.viewer),
    ]);
    await Promise.all([
      dragWorld(owner.page, { x: 180, y: 100 }, { x: 190, y: 110 }),
      dragWorld(editor.page, { x: 230, y: 100 }, { x: 245, y: 115 }),
    ]);
    await Promise.all([
      waitUntilSaved(owner.page),
      waitUntilSaved(editor.page),
    ]);
    const independentMovement = await fixture.admin
      .from("lukas_drawing_objects")
      .select("id,geometry,version")
      .in("id", differentObject);
    if (independentMovement.error) throw independentMovement.error;
    expect(independentMovement.data).toHaveLength(2);
    const movedById = new Map(
      independentMovement.data.map((row) => [row.id, row]),
    );
    expect(movedById.get(first.id)).toMatchObject({
      geometry: { center: { x: 190, y: 110 } },
      version: 2,
    });
    expect(movedById.get(second.id)).toMatchObject({
      geometry: { center: { x: 245, y: 115 } },
      version: 2,
    });

    const observerSurface = observer.page.getByLabel(/도면 화면/);
    let expectedCount = Number(
      await observerSurface.getAttribute("data-rendered-object-count"),
    );
    const reflectionLatencies: number[] = [];
    for (let index = 0; index < 30; index += 1) {
      const started = performance.now();
      const tool =
        index % 3 === 0
          ? "원 도구"
          : index % 3 === 1
            ? "사각형 도구"
            : "선 도구";
      await owner.page.getByRole("button", { name: tool }).click();
      const from = await canvasPoint(owner.page, {
        x: 35 + index * 4,
        y: 150 + (index % 5) * 8,
      });
      const to = await canvasPoint(owner.page, {
        x: 40 + index * 4,
        y: 155 + (index % 5) * 8,
      });
      if (tool === "선 도구") {
        await owner.page.mouse.click(from.x, from.y);
        await owner.page.mouse.click(to.x, to.y);
      } else {
        await owner.page.mouse.move(from.x, from.y);
        await owner.page.mouse.down();
        await owner.page.mouse.move(to.x, to.y, { steps: 3 });
        await owner.page.mouse.up();
      }
      expectedCount += 1;
      await expect(observerSurface).toHaveAttribute(
        "data-rendered-object-count",
        String(expectedCount),
      );
      reflectionLatencies.push(performance.now() - started);
    }
    const p95 = percentile(reflectionLatencies, 0.95);
    const viewport = owner.page.viewportSize();
    const browserVersion = browser.version();
    const evidence = {
      execution: "PRODUCTION_MEASURED",
      localMeasurement: "UNEXECUTED_BY_THIS_COMMAND",
      browserName,
      browserVersion,
      viewport,
      objectMix: {
        circle: 10,
        rectangle: 10,
        line: 10,
        seededDifferentObject: 2,
      },
      samples: reflectionLatencies.length,
      coldSamples: 5,
      warmSamples: 25,
      coldWarm: "first five cold, remaining twenty-five warm",
      cpu: {
        model: os.cpus()[0]?.model ?? "unknown",
        logicalCount: os.cpus().length,
      },
      memory: {
        totalBytes: os.totalmem(),
        freeBytesAtMeasurement: os.freemem(),
      },
      p95Ms: p95,
      productTargetMs: 500,
    };
    test.info().annotations.push({
      type: "P3 reflection latency",
      description: JSON.stringify(evidence),
    });
    expect(p95).toBeLessThanOrEqual(500);
    await Promise.all([
      owner.context.close(),
      editor.context.close(),
      observer.context.close(),
    ]);
  });

  test("P3 Gate 03: opposite-order collision chooses authoritative winner and reports soft lock", async ({
    browser,
  }) => {
    const ownerApi = await authenticateApiClient(fixture, fixture.owner);
    const created = await ownerApi.rpc("lukas_drawing_create_document", {
      p_project_id: fixture.projectId,
      p_source_file_id: fixture.revisedPdfFileId,
      p_title: `P3 collision room ${credentials.P3_E2E_RUN_ID}`,
      p_blank: true,
    });
    if (created.error) throw created.error;
    const collisionWorkspace = created.data as {
      revisionId: string;
      workLayerId: string;
    };
    const collisionObject = await addObject(ownerApi, fixture, {
      name: "P3 collision target",
      center: { x: 120, y: 90 },
      revisionId: collisionWorkspace.revisionId,
      layerId: collisionWorkspace.workLayerId,
    });
    const collisionObjectId = collisionObject.id;
    const adminObject = await fixture.admin
      .from("lukas_drawing_objects")
      .select("id,name,geometry,style,version")
      .eq("id", collisionObjectId)
      .single();
    if (adminObject.error) throw adminObject.error;
    const base = adminObject.data;
    const ownerConnection = await connectProvider(
      fixture,
      fixture.owner,
      collisionWorkspace.revisionId,
    );
    const editorConnection = await connectProvider(
      fixture,
      fixture.editor,
      collisionWorkspace.revisionId,
    );
    const makeOperation = (
      actorId: string,
      name: string,
    ): DrawingCollaborationOperation => ({
      actorId,
      schemaVersion: 1,
      clientOperationId: randomUUID(),
      revisionId: collisionWorkspace.revisionId,
      type: "update_objects",
      baseVersions: { [collisionObjectId]: base.version },
      forward: {
        type: "update_objects",
        updates: [{ objectId: collisionObjectId, patch: { name } }],
      },
      inverse: {
        type: "update_objects",
        updates: [{ objectId: collisionObjectId, patch: { name: base.name } }],
      },
      createdAt: new Date().toISOString(),
    });
    const authoritativeWinner = makeOperation(
      fixture.owner.id,
      "P3 authoritative winner",
    );
    const conflictedLoser = makeOperation(
      fixture.editor.id,
      "P3 conflicted loser",
    );
    appendDrawingCollaborationOperation(
      editorConnection.document,
      conflictedLoser,
    );
    await editorConnection.provider.flushPendingUpdates();
    appendDrawingCollaborationOperation(
      ownerConnection.document,
      authoritativeWinner,
    );
    await ownerConnection.provider.flushPendingUpdates();
    await expect
      .poll(() => {
        const yjsOrder = ownerConnection.document
          .getArray<string>("operationOrder")
          .toArray();
        const loserIndex = yjsOrder.indexOf(conflictedLoser.clientOperationId);
        const winnerIndex = yjsOrder.indexOf(
          authoritativeWinner.clientOperationId,
        );
        return loserIndex >= 0 && winnerIndex > loserIndex;
      })
      .toBe(true);

    const winnerResult = await ownerConnection.client.rpc(
      "lukas_drawing_apply_operation",
      {
        p_revision_id: authoritativeWinner.revisionId,
        p_client_operation_id: authoritativeWinner.clientOperationId,
        p_operation_type: authoritativeWinner.type,
        p_base_versions: authoritativeWinner.baseVersions,
        p_forward: authoritativeWinner.forward,
        p_inverse: authoritativeWinner.inverse,
      },
    );
    if (winnerResult.error) throw winnerResult.error;
    const loserResult = await editorConnection.client.rpc(
      "lukas_drawing_apply_operation",
      {
        p_revision_id: conflictedLoser.revisionId,
        p_client_operation_id: conflictedLoser.clientOperationId,
        p_operation_type: conflictedLoser.type,
        p_base_versions: conflictedLoser.baseVersions,
        p_forward: conflictedLoser.forward,
        p_inverse: conflictedLoser.inverse,
      },
    );
    expect(loserResult.error).toBeTruthy();
    expect(loserResult.error?.code).toBe("P1C01");
    expect(loserResult.error?.message).toMatch(/version conflict/i);
    const winnerData = winnerResult.data as {
      sequence: number;
      resultVersions: Record<string, number>;
    };
    await sendOutcomeReceipt(
      fixture,
      authoritativeWinner,
      "acked",
      winnerData.sequence,
      winnerData.resultVersions,
    );
    await sendOutcomeReceipt(fixture, conflictedLoser, "conflicted", null, {});
    const operationStatus = ownerConnection.document.getMap("operationStatus");
    await expect
      .poll(() => operationStatus.get(authoritativeWinner.clientOperationId))
      .toMatchObject({ status: "acked" });
    await expect
      .poll(() => operationStatus.get(conflictedLoser.clientOperationId))
      .toMatchObject({ status: "conflicted" });
    const finalRow = await fixture.admin
      .from("lukas_drawing_objects")
      .select("name")
      .eq("id", collisionObjectId)
      .single();
    expect(finalRow.data?.name).toBe("P3 authoritative winner");

    const [owner, editor] = await Promise.all([
      openWorkspace(browser, fixture, fixture.owner),
      openWorkspace(browser, fixture, fixture.editor),
    ]);
    await editor.page.getByRole("button", { name: "선택 도구" }).click();
    const point = await canvasPoint(editor.page, { x: 120, y: 90 });
    await editor.page.mouse.move(point.x, point.y);
    await editor.page.mouse.down();
    await expect(owner.page.getByLabel("객체 잠금 상태")).toContainText(
      displayName(fixture.editor),
    );
    await editor.page.mouse.up();
    await Promise.all([owner.context.close(), editor.context.close()]);
    ownerConnection.dispose();
    editorConnection.dispose();
  });

  test("P3 Gate 04: crash reconnect repairs 100 five-minute offline operations without loss", async ({
    browser,
  }) => {
    const context = trackContext(
      await browser.newContext({ viewport: { width: 1440, height: 900 } }),
    );
    const path = workspacePath(fixture, fixture.blankWorkspace);
    let page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      path,
    );
    await waitUntilSaved(page);
    await page.getByRole("button", { name: "선택 도구" }).click();
    const point = await canvasPoint(page, { x: 120, y: 90 });
    await page.mouse.click(point.x, point.y);
    const before = await fixture.admin
      .from("lukas_drawing_operations")
      .select("client_operation_id")
      .eq("revision_id", fixture.blankWorkspace.revisionId)
      .eq("actor_id", fixture.owner.id);
    if (before.error) throw before.error;
    const baseOfflineObject = await fixture.admin
      .from("lukas_drawing_objects")
      .select("version")
      .eq("id", sharedObjectId)
      .single();
    if (baseOfflineObject.error) throw baseOfflineObject.error;
    const baseOfflineObjectVersion = baseOfflineObject.data.version;
    await page.evaluate(() => {
      const RealDate = Date;
      let offset = 0;
      class OfflineDate extends RealDate {
        constructor(...args: ConstructorParameters<typeof Date>) {
          super(args.length ? args[0] : RealDate.now() + offset);
        }
        static now() {
          return RealDate.now() + offset;
        }
      }
      Object.assign(window, {
        Date: OfflineDate,
        advanceOfflineMinute: () => {
          offset += 60_000;
        },
      });
    });
    await context.setOffline(true);
    const outboxBefore = await readOutboxIds(
      page,
      fixture.owner.id,
      fixture.blankWorkspace.revisionId,
    );
    for (let minute = 0; minute < 5; minute += 1) {
      for (let operation = 0; operation < 20; operation += 1)
        await page.keyboard.press("ArrowRight");
      await page.evaluate(() =>
        (
          window as unknown as { advanceOfflineMinute(): void }
        ).advanceOfflineMinute(),
      );
    }
    await expect
      .poll(
        () =>
          readOutboxIds(
            page,
            fixture.owner.id,
            fixture.blankWorkspace.revisionId,
          ),
        { timeout: 30_000 },
      )
      .toHaveLength(outboxBefore.length + 100);
    await expect(
      page.getByRole("status", { name: "공동 편집 상태: degraded" }),
    ).toBeVisible();
    await page.close();
    await context.setOffline(false);
    page = await context.newPage();
    await page.goto(`${baseUrl}${path}`);
    await waitUntilSaved(page);
    await expect
      .poll(
        async () => {
          const result = await fixture.admin
            .from("lukas_drawing_operations")
            .select("client_operation_id")
            .eq("revision_id", fixture.blankWorkspace.revisionId)
            .eq("actor_id", fixture.owner.id);
          if (result.error) throw result.error;
          return result.data ?? [];
        },
        { timeout: 60_000 },
      )
      .toHaveLength((before.data?.length ?? 0) + 100);
    const ids =
      (
        await fixture.admin
          .from("lukas_drawing_operations")
          .select("client_operation_id")
          .eq("revision_id", fixture.blankWorkspace.revisionId)
          .eq("actor_id", fixture.owner.id)
      ).data ?? [];
    expect(new Set(ids.map((row) => row.client_operation_id)).size).toBe(
      ids.length,
    );
    const object = await fixture.admin
      .from("lukas_drawing_objects")
      .select("id,version")
      .eq("id", sharedObjectId)
      .single();
    expect(object.data?.id).toBe(sharedObjectId);
    expect(object.data?.version).toBeGreaterThanOrEqual(
      baseOfflineObjectVersion + 100,
    );
    await context.close();
  });

  test("P3 Gate 05: viewer reviewer and nonmember fail closed at WebSocket and database authorities", async ({
    browser,
  }) => {
    const viewer = await openWorkspace(browser, fixture, fixture.viewer);
    const reviewer = await openWorkspace(browser, fixture, fixture.reviewer);
    for (const page of [viewer.page, reviewer.page]) {
      await expect(
        page.getByRole("status", { name: "공동 편집 상태: connected" }),
      ).toContainText("읽기 전용");
      await expect(page.getByRole("button", { name: "선 도구" })).toHaveCount(
        0,
      );
    }
    const viewerConnection = await connectProvider(fixture, fixture.viewer);
    const viewerObserverConnection = await connectProvider(
      fixture,
      fixture.owner,
    );
    const viewerWsObjectId = randomUUID();
    const viewerWsOperationId = randomUUID();
    appendDrawingCollaborationOperation(viewerConnection.document, {
      actorId: fixture.viewer.id,
      schemaVersion: 1,
      clientOperationId: viewerWsOperationId,
      revisionId: fixture.blankWorkspace.revisionId,
      type: "add_objects",
      baseVersions: {},
      forward: {
        type: "add_objects",
        objects: [
          {
            id: viewerWsObjectId,
            name: "P3 viewer WS denied",
            layerId: fixture.blankWorkspace.workLayerId,
            geometry: {
              type: "circle",
              center: { x: 12, y: 12 },
              radius: 2,
            },
            style: { stroke: "#dc2626", strokeWidth: 1, fill: null },
            version: 1,
          },
        ],
      },
      inverse: { type: "delete_objects", objectIds: [viewerWsObjectId] },
      createdAt: new Date().toISOString(),
    });
    viewerConnection.provider.flushPendingUpdates();
    const viewerWriteStarted = Date.now();
    await expect
      .poll(() => {
        const observerOrder = viewerObserverConnection.document
          .getArray<string>("operationOrder")
          .toArray();
        return (
          Date.now() - viewerWriteStarted >= 1_000 &&
          viewerConnection.provider.hasUnsyncedChanges &&
          !observerOrder.includes(viewerWsOperationId)
        );
      })
      .toBe(true);
    const viewerWsRow = await fixture.admin
      .from("lukas_drawing_objects")
      .select("id")
      .eq("id", viewerWsObjectId)
      .maybeSingle();
    if (viewerWsRow.error) throw viewerWsRow.error;
    expect(viewerWsRow.data).toBeNull();
    viewerConnection.dispose();
    viewerObserverConnection.dispose();
    const nonMemberWs = await deniedProvider(fixture, fixture.nonMember);
    expect(nonMemberWs.connected).toBe(false);
    expect(nonMemberWs.reason).toBeTruthy();
    for (const user of [fixture.viewer, fixture.reviewer, fixture.nonMember]) {
      const api = await authenticateApiClient(fixture, user);
      const deniedId = randomUUID();
      const denied = await api.rpc("lukas_drawing_apply_operation", {
        p_revision_id: fixture.blankWorkspace.revisionId,
        p_client_operation_id: randomUUID(),
        p_operation_type: "add_objects",
        p_base_versions: {},
        p_forward: {
          type: "add_objects",
          objects: [
            {
              id: deniedId,
              name: "P3 denied role write",
              layerId: fixture.blankWorkspace.workLayerId,
              geometry: {
                type: "circle",
                center: { x: 10, y: 10 },
                radius: 2,
              },
              style: { stroke: "#ef4444", strokeWidth: 2, fill: null },
              version: 1,
            },
          ],
        },
        p_inverse: { type: "delete_objects", objectIds: [deniedId] },
      });
      expect(denied.error).toBeTruthy();
    }
    const outsider = await authenticateApiClient(fixture, fixture.nonMember);
    const bootstrap = await outsider.rpc(
      "lukas_drawing_collaboration_bootstrap",
      {
        p_revision_id: fixture.blankWorkspace.revisionId,
      },
    );
    expect(bootstrap.error).toBeTruthy();
    await Promise.all([viewer.context.close(), reviewer.context.close()]);
  });

  test("P3 Gate 06: comments mentions sharing history and checkpoint restore retain evidence", async ({
    browser,
  }) => {
    const ownerApi = await authenticateApiClient(fixture, fixture.owner);
    const reviewerApi = await authenticateApiClient(fixture, fixture.reviewer);
    const checkpointObject = await addObject(ownerApi, fixture, {
      name: "P3 checkpoint object",
      center: { x: 80, y: 80 },
      revisionId: fixture.pdfWorkspace.revisionId,
      layerId: fixture.pdfWorkspace.workLayerId,
    });
    const review = await ownerApi.rpc("lukas_drawing_request_review", {
      p_revision_id: fixture.pdfWorkspace.revisionId,
    });
    if (review.error) throw review.error;
    const reviewEvidence = review.data as {
      subjectVersion: number;
      snapshotSha256: string;
    };
    const rejection = await reviewerApi.rpc(
      "lukas_drawing_record_revision_decision",
      {
        p_revision_id: fixture.pdfWorkspace.revisionId,
        p_subject_version: reviewEvidence.subjectVersion,
        p_snapshot_sha256: reviewEvidence.snapshotSha256,
        p_decision: "rejected",
        p_note: "P3 checkpoint restore gate",
      },
    );
    if (rejection.error) throw rejection.error;
    const postCheckpointObject = await addObject(ownerApi, fixture, {
      name: "P3 post-checkpoint object",
      center: { x: 100, y: 80 },
      revisionId: fixture.pdfWorkspace.revisionId,
      layerId: fixture.pdfWorkspace.workLayerId,
    });

    const [owner, editor] = await Promise.all([
      openWorkspace(
        browser,
        fixture,
        fixture.owner,
        workspacePath(fixture, fixture.pdfWorkspace),
      ),
      openWorkspace(
        browser,
        fixture,
        fixture.editor,
        workspacePath(fixture, fixture.pdfWorkspace),
      ),
    ]);
    await owner.page.getByRole("tab", { name: "댓글·이슈" }).click();
    await owner.page.getByLabel("댓글").fill("P3 명시적 멘션 댓글");
    await owner.page
      .locator('select[name="mentioned_user_ids"]')
      .selectOption([fixture.editor.id]);
    await owner.page.getByRole("button", { name: "댓글 등록" }).click();
    await expect(editor.page.getByText("P3 명시적 멘션 댓글")).toBeVisible();
    await expect(
      editor.page.getByText(
        new RegExp(`멘션.*${fixture.editor.id.slice(0, 8)}`),
      ),
    ).toBeVisible();
    await expect(
      owner.page.getByRole("link", { name: "프로젝트 멤버 및 역할 관리" }),
    ).toHaveAttribute("href", `/projects/${fixture.projectId}/members`);
    const members = await owner.context.newPage();
    await members.goto(`${baseUrl}/projects/${fixture.projectId}/members`);
    await members.locator("#member-email").fill(fixture.editor.email);
    await members.locator("#member-role").selectOption("site");
    await members.getByRole("button", { name: "추가·변경" }).click();
    await expect
      .poll(async () => {
        const result = await fixture.admin
          .from("lukas_qto_project_members")
          .select("role")
          .eq("project_id", fixture.projectId)
          .eq("user_id", fixture.editor.id)
          .single();
        return result.data?.role;
      })
      .toBe("site");
    await members.locator("#member-email").fill(fixture.editor.email);
    await members.locator("#member-role").selectOption("estimator");
    await members.getByRole("button", { name: "추가·변경" }).click();
    await expect
      .poll(async () => {
        const result = await fixture.admin
          .from("lukas_qto_project_members")
          .select("role")
          .eq("project_id", fixture.projectId)
          .eq("user_id", fixture.editor.id)
          .single();
        return result.data?.role;
      })
      .toBe("estimator");
    await members.close();

    await owner.page.getByRole("tab", { name: "변경 이력" }).click();
    await expect(owner.page.getByLabel("변경 이력")).toContainText(
      checkpointObject.operation.type,
    );
    await owner.page
      .getByRole("button", { name: /상태로 복원/ })
      .first()
      .click();
    await waitUntilSaved(owner.page);
    const restoreCheckpoint = await fixture.admin
      .from("lukas_drawing_operations")
      .select("operation_type,forward")
      .eq("revision_id", fixture.pdfWorkspace.revisionId)
      .eq("operation_type", "restore_checkpoint")
      .single();
    if (restoreCheckpoint.error) throw restoreCheckpoint.error;
    expect(restoreCheckpoint.data.operation_type).toBe("restore_checkpoint");
    expect(
      (restoreCheckpoint.data.forward as { checkpointId?: string })
        .checkpointId,
    ).toBeTruthy();
    const checkpointGraph = await fixture.admin
      .from("lukas_drawing_objects")
      .select("id")
      .in("id", [checkpointObject.id, postCheckpointObject.id])
      .is("deleted_at", null);
    if (checkpointGraph.error) throw checkpointGraph.error;
    expect(checkpointGraph.data.map((row) => row.id)).toEqual([
      checkpointObject.id,
    ]);
    await Promise.all([owner.context.close(), editor.context.close()]);
  });

  test("P3 Gate 07: review during drag cancels edits, approval freezes, and child draft edits", async ({
    browser,
  }) => {
    const dragBase = await fixture.admin
      .from("lukas_drawing_objects")
      .select("geometry,version")
      .eq("id", sharedObjectId)
      .single();
    if (dragBase.error) throw dragBase.error;
    const editorOperationsBefore = await fixture.admin
      .from("lukas_drawing_operations")
      .select("client_operation_id")
      .eq("revision_id", fixture.blankWorkspace.revisionId)
      .eq("actor_id", fixture.editor.id);
    if (editorOperationsBefore.error) throw editorOperationsBefore.error;
    const [owner, editor] = await Promise.all([
      openWorkspace(browser, fixture, fixture.owner),
      openWorkspace(browser, fixture, fixture.editor),
    ]);
    await editor.page.getByRole("button", { name: "선택 도구" }).click();
    const point = await canvasPoint(editor.page, { x: 120, y: 90 });
    await editor.page.mouse.move(point.x, point.y);
    await editor.page.mouse.down();
    await editor.page.mouse.move(point.x + 30, point.y + 20, { steps: 6 });
    await owner.page.getByRole("button", { name: "검토 요청" }).click();
    await expect
      .poll(
        async () => {
          const revision = await fixture.admin
            .from("lukas_drawing_revisions")
            .select("status")
            .eq("id", fixture.blankWorkspace.revisionId)
            .single();
          return revision.data?.status;
        },
        { timeout: 45_000 },
      )
      .toBe("review_requested");
    await expect(
      editor.page.getByRole("button", { name: "선 도구" }),
    ).toHaveCount(0);
    await editor.page.mouse.up();
    const dragAfter = await fixture.admin
      .from("lukas_drawing_objects")
      .select("geometry,version")
      .eq("id", sharedObjectId)
      .single();
    if (dragAfter.error) throw dragAfter.error;
    expect(dragAfter.data).toEqual(dragBase.data);
    const editorOperationsAfter = await fixture.admin
      .from("lukas_drawing_operations")
      .select("client_operation_id")
      .eq("revision_id", fixture.blankWorkspace.revisionId)
      .eq("actor_id", fixture.editor.id);
    if (editorOperationsAfter.error) throw editorOperationsAfter.error;
    expect(editorOperationsAfter.data).toHaveLength(
      editorOperationsBefore.data.length,
    );

    const reviewer = await openWorkspace(browser, fixture, fixture.reviewer);
    await reviewer.page.getByLabel("검토 의견").fill("P3 production approval");
    await reviewer.page.getByRole("button", { name: "도면 승인" }).click();
    await expect
      .poll(async () => {
        const revision = await fixture.admin
          .from("lukas_drawing_revisions")
          .select("status")
          .eq("id", fixture.blankWorkspace.revisionId)
          .single();
        return revision.data?.status;
      })
      .toBe("approved");
    const ownerApi = await authenticateApiClient(fixture, fixture.owner);
    const frozenBase = await fixture.admin
      .from("lukas_drawing_objects")
      .select("version")
      .eq("id", sharedObjectId)
      .single();
    if (frozenBase.error) throw frozenBase.error;
    const frozenUpdate = await ownerApi.rpc("lukas_drawing_apply_operation", {
      p_revision_id: fixture.blankWorkspace.revisionId,
      p_client_operation_id: randomUUID(),
      p_operation_type: "update_objects",
      p_base_versions: { [sharedObjectId]: frozenBase.data.version },
      p_forward: {
        type: "update_objects",
        updates: [{ objectId: sharedObjectId, patch: { name: "forbidden" } }],
      },
      p_inverse: {
        type: "update_objects",
        updates: [
          {
            objectId: sharedObjectId,
            patch: { name: "P3 shared lock target" },
          },
        ],
      },
    });
    expect(frozenUpdate.error).toBeTruthy();

    await owner.page.reload();
    await owner.page.getByRole("tab", { name: "변경 이력" }).click();
    await owner.page.getByRole("button", { name: "새 초안으로 복원" }).click();
    await owner.page.waitForURL((url) => url.searchParams.has("document"));
    const documentId = new URL(owner.page.url()).searchParams.get("document")!;
    const child = await fixture.admin
      .from("lukas_drawing_revisions")
      .select("id,status,document_id,parent_revision_id")
      .eq("document_id", documentId)
      .single();
    if (child.error) throw child.error;
    expect(child.data.status).toBe("draft");
    expect(child.data.parent_revision_id).toBe(
      fixture.blankWorkspace.revisionId,
    );
    nextDraft = { documentId, revisionId: child.data.id };
    await expect(
      owner.page.getByRole("button", { name: "선 도구" }),
    ).toBeVisible();
    await Promise.all([
      owner.context.close(),
      editor.context.close(),
      reviewer.context.close(),
    ]);
  });

  test("P3 Gate 08: immutable sources and P0-P2 export quantity approval drawing-room Revit routes regress cleanly", async ({
    browser,
  }) => {
    expect(nextDraft).not.toBeNull();
    expect(await readSourceEvidence(fixture)).toEqual(immutableSourceBefore);
    for (const evidence of Object.values(immutableSourceBefore)) {
      expect(evidence.storageByteSha256).toBe(evidence.metadataSha256);
      expect(evidence.byteLength).toBeGreaterThan(0);
    }
    const approval = await fixture.admin
      .from("lukas_drawing_revision_approvals")
      .select("decision,snapshot_sha256")
      .eq("revision_id", fixture.blankWorkspace.revisionId)
      .eq("decision", "approved")
      .single();
    if (approval.error) throw approval.error;
    expect(approval.data.decision).toBe("approved");
    expect(approval.data.snapshot_sha256).toMatch(/^[0-9a-f]{64}$/);
    const quantityInputs = await fixture.admin
      .from("lukas_qto_takeoff_inputs")
      .select("input_role,source_sha256")
      .eq("artifact_id", quantityArtifact.id)
      .order("input_role");
    if (quantityInputs.error) throw quantityInputs.error;
    expect(quantityArtifact).toMatchObject({
      row_count: 1,
      status_counts: { PASS: 1 },
    });
    expect(quantityInputs.data).toHaveLength(7);
    expect(
      quantityInputs.data.every(
        (input) =>
          quantityArtifact.input_sha256[input.input_role] ===
          input.source_sha256,
      ),
    ).toBe(true);

    const context = trackContext(
      await browser.newContext({ viewport: { width: 1440, height: 900 } }),
    );
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      workspacePath(fixture, fixture.blankWorkspace, nextDraft!.documentId),
    );
    await waitUntilSaved(page);
    await page.getByRole("button", { name: "선 도구" }).click();
    const lineStart = await canvasPoint(page, { x: 40, y: 40 });
    const lineEnd = await canvasPoint(page, { x: 100, y: 40 });
    await page.mouse.click(lineStart.x, lineStart.y);
    await page.mouse.click(lineEnd.x, lineEnd.y);
    await waitUntilSaved(page);
    const svg = await runDownload(page, "SVG");
    expect(svg.filename).toMatch(/\.svg$/);
    expect(svg.bytes.toString("utf8")).toContain("<svg");
    expect(svg.bytes.toString("utf8")).toContain("<line");
    const pdf = await runDownload(page, "PDF");
    const parsedPdf = await PDFDocument.load(pdf.bytes);
    expect(parsedPdf.getPageCount()).toBeGreaterThan(0);
    expect(parsedPdf.getSubject()).toBe("Canonical drawing workspace export");

    for (const [route, evidence] of [
      [
        `/projects/${fixture.projectId}/drawings/${fixture.blankWorkspace.fileId}`,
        /협업 도면실/,
      ],
      [`/projects/${fixture.projectId}/quantities`, /물량 산출 결과/],
      [`/projects/${fixture.projectId}/materials`, /자재 관리/],
      [
        `/projects/${fixture.projectId}/ifc/${fixture.ifcFileId}`,
        /모델을 보고 요소와 속성을 확인합니다/,
      ],
    ] as const) {
      const response = await page.goto(`${baseUrl}${route}`);
      expect(response?.status()).toBe(200);
      await expect(page.getByText(evidence).first()).toBeVisible();
    }
    await page.goto(`${baseUrl}/projects/${fixture.projectId}/quantities`);
    await expect(page.getByText("CONCRETE_TAKEOFF_CSV_V1")).toBeVisible();
    await expect(page.getByText("1행")).toBeVisible();
    await expect(page.getByText("PASS 1")).toBeVisible();
    const downloadLanding = await page.goto(`${baseUrl}/download`);
    expect(downloadLanding?.status()).toBe(200);
    const revitLink = page.getByRole("link", {
      name: /현장 검증 ZIP 다운로드/,
    });
    await expect(revitLink).toHaveAttribute("href", "/download/revit-2025");
    const redirect = await page.request.get(`${baseUrl}/download/revit-2025`, {
      maxRedirects: 0,
    });
    expect([301, 302, 303, 307, 308]).toContain(redirect.status());
    const artifact = await page.request.get(redirect.headers().location!);
    expect(artifact.ok()).toBe(true);
    expect(artifact.headers()["content-type"]).toMatch(/zip|octet-stream/i);
    const artifactBytes = await artifact.body();
    expect(artifactBytes.subarray(0, 2).toString("ascii")).toBe("PK");
    const revitEntries = Object.keys(unzipSync(new Uint8Array(artifactBytes)));
    expect(revitEntries.some((entry) => /\.(?:addin|dll)$/i.test(entry))).toBe(
      true,
    );
    const combinedSourceHash = createHash("sha256")
      .update(
        Object.values(immutableSourceBefore)
          .map((item) => item.storageByteSha256)
          .sort()
          .join(""),
      )
      .digest("hex");
    expect(combinedSourceHash).toMatch(/^[0-9a-f]{64}$/);
    await context.close();
  });
});
