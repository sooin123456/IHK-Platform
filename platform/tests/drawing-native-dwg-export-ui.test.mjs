import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const ui = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-native-dwg-export.tsx",
);
const paths = await vite.ssrLoadModule(
  "/app/lukas/lib/drawing-workspace-paths.ts",
);

test.after(() => vite.close());

const ids = Object.freeze({
  project: "82000000-0000-4000-8000-000000000001",
  document: "82000000-0000-4000-8000-000000000002",
  revision: "82000000-0000-4000-8000-000000000003",
  canvas: "82000000-0000-4000-8000-000000000004",
  request: "82000000-0000-4000-8000-000000000005",
  otherRequest: "82000000-0000-4000-8000-000000000006",
  job: "82000000-0000-4000-8000-000000000007",
});
const scope = Object.freeze({
  projectId: ids.project,
  documentId: ids.document,
  revisionId: ids.revision,
  revisionVersion: 3,
  canvasId: ids.canvas,
  snapshotSha256: "a".repeat(64),
});

test("request identity is reused only for the exact six-field source and reset for retry", () => {
  let created = 0;
  const create = () => [ids.request, ids.otherRequest][created++];
  const first = ui.nativeDrawingDwgRequestIdentity(null, scope, create);
  assert.equal(first.requestId, ids.request);
  assert.equal(
    ui.nativeDrawingDwgRequestIdentity(first, { ...scope }, create),
    first,
  );
  const changed = ui.nativeDrawingDwgRequestIdentity(
    first,
    { ...scope, revisionVersion: 4 },
    create,
  );
  assert.equal(changed.requestId, ids.otherRequest);
  assert.notEqual(changed.key, first.key);
});

test("an uncertain request identity survives control unmount and reopen in session storage", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
  const first = ui.nativeDrawingDwgPersistentRequestIdentity(
    null,
    scope,
    storage,
    () => ids.request,
  );
  const reopened = ui.nativeDrawingDwgPersistentRequestIdentity(
    null,
    { ...scope },
    storage,
    () => assert.fail("reopen minted a different request identity"),
  );
  assert.deepEqual(reopened, first);
  const retried = ui.nativeDrawingDwgPersistentRequestIdentity(
    null,
    scope,
    storage,
    () => ids.otherRequest,
    true,
  );
  assert.equal(retried.requestId, ids.otherRequest);
});

test("one in-flight request suppresses double click and ignores a stale scope response", async () => {
  let resolve;
  let calls = 0;
  const pending = new Promise((done) => (resolve = done));
  const gate = { current: null };
  const first = ui.runNativeDrawingDwgRequest({
    gate,
    scopeKey: ui.nativeDrawingDwgScopeKey(scope),
    request: async () => {
      calls += 1;
      return pending;
    },
  });
  const duplicate = await ui.runNativeDrawingDwgRequest({
    gate,
    scopeKey: ui.nativeDrawingDwgScopeKey(scope),
    request: async () => assert.fail("duplicate transport call"),
  });
  assert.equal(duplicate, null);
  resolve({ accepted: true, jobId: ids.job, requestId: ids.request });
  assert.deepEqual(await first, {
    scopeKey: ui.nativeDrawingDwgScopeKey(scope),
    value: { accepted: true, jobId: ids.job, requestId: ids.request },
  });
  assert.equal(calls, 1);

  const stale = ui.nativeDrawingDwgFreshResult(
    ui.nativeDrawingDwgScopeKey(scope),
    ui.nativeDrawingDwgScopeKey({
      ...scope,
      canvasId: "82000000-0000-4000-8000-000000000099",
    }),
    { status: "queued" },
  );
  assert.equal(stale, null);
});

test("poll scheduling exists only for an open active job and aborts on close", () => {
  assert.equal(ui.nativeDrawingDwgShouldPoll(true, { status: "queued" }), true);
  assert.equal(
    ui.nativeDrawingDwgShouldPoll(true, { status: "processing" }),
    true,
  );
  assert.equal(
    ui.nativeDrawingDwgShouldPoll(true, { status: "retry_wait" }),
    true,
  );
  assert.equal(
    ui.nativeDrawingDwgShouldPoll(true, { status: "completed" }),
    false,
  );
  assert.equal(
    ui.nativeDrawingDwgShouldPoll(false, { status: "queued" }),
    false,
  );
  const controller = new AbortController();
  ui.abortNativeDrawingDwgPolling(controller);
  assert.equal(controller.signal.aborted, true);

  const previous = new AbortController();
  const ref = { current: previous };
  const current = ui.replaceNativeDrawingDwgAbortController(ref, true);
  assert.equal(previous.signal.aborted, true);
  assert.equal(ref.current, current);
  ui.replaceNativeDrawingDwgAbortController(ref, false);
  assert.equal(current.signal.aborted, true);
  assert.equal(ref.current, null);
});

function renderStatus(status) {
  return renderToStaticMarkup(
    React.createElement(ui.NativeDrawingDwgStatusView, {
      onRequest: () => {},
      requesting: false,
      scope,
      status,
    }),
  );
}

test("the rendered control honestly exposes pending, retrying, failed and completed states", () => {
  assert.match(renderStatus({ kind: "idle" }), /시험용 DWG 만들기/);
  assert.match(renderStatus({ kind: "loading" }), /상태를 확인/);
  assert.match(
    renderStatus({
      kind: "job",
      job: { status: "queued", attemptCount: 0, lastErrorCode: null },
    }),
    /대기열/,
  );
  assert.match(
    renderStatus({
      kind: "job",
      job: {
        status: "processing",
        attemptCount: 1,
        lastErrorCode: null,
      },
    }),
    /DWG 파일을 생성하고 있습니다/,
  );
  assert.match(
    renderStatus({
      kind: "job",
      job: {
        status: "retry_wait",
        attemptCount: 1,
        lastErrorCode: "upload_failed",
      },
    }),
    /재시도를 기다리고 있습니다/,
  );
  const failed = renderStatus({
    kind: "job",
    job: {
      status: "failed",
      attemptCount: 3,
      lastErrorCode: "verification_failed",
    },
  });
  assert.match(failed, /실패/);
  assert.match(failed, /다시 요청/);

  const completed = renderStatus({
    kind: "job",
    job: {
      jobId: ids.job,
      status: "completed",
      attemptCount: 1,
      lastErrorCode: null,
      qualification: "experimental-unqualified",
      receipt: {
        artifacts: [
          { kind: "dwg" },
          { kind: "source_manifest" },
          { kind: "authority" },
          { kind: "report" },
        ],
      },
    },
  });
  assert.match(completed, /시험용 DWG 파일이 준비되었습니다/);
  for (const label of ["DWG", "도면 데이터", "승인·원본 근거", "검증 보고서"])
    assert.match(completed, new RegExp(label));
  assert.equal((completed.match(/href=/g) ?? []).length, 4);
  assert.match(completed, /독립 CAD/);
  assert.match(completed, /내부 시험용/);
  assert.match(completed, /experimental-unqualified/);
});

test("client status validation refuses unbounded errors and incomplete completed receipts", () => {
  assert.equal(
    ui.isNativeDrawingDwgJob({
      jobId: ids.job,
      status: "failed",
      attemptCount: 3,
      lastErrorCode: "raw worker stderr",
      receipt: null,
    }),
    false,
  );
  assert.equal(
    ui.isNativeDrawingDwgJob({
      jobId: ids.job,
      status: "completed",
      attemptCount: 1,
      lastErrorCode: null,
      qualification: "experimental-unqualified",
      receipt: { artifacts: [{ kind: "dwg" }] },
    }),
    false,
  );
});

test("unsupported imported or multi-canvas sources render actionable errors", () => {
  const imported = renderToStaticMarkup(
    React.createElement(ui.NativeDrawingDwgExportControl, {
      backendAvailable: true,
      documentState: {
        activeCanvasId: ids.canvas,
        revisionId: ids.revision,
        structure: {
          pages: { [ids.revision]: { id: ids.revision } },
          canvases: {
            [ids.canvas]: {
              id: ids.canvas,
              background: null,
              outputProfile: {},
            },
          },
          sources: {
            x: { sourceKind: "dxf_entity" },
          },
        },
      },
      open: true,
      outboxReady: true,
      projectId: ids.project,
      revisionId: ids.revision,
      revisionStatus: "approved",
      revisionVersion: 3,
      saveStatus: "저장됨",
      snapshotSha256: scope.snapshotSha256,
      workspaceId: ids.document,
    }),
  );
  assert.match(imported, /가져온/);

  const multi = renderToStaticMarkup(
    React.createElement(ui.NativeDrawingDwgExportControl, {
      backendAvailable: true,
      documentState: {
        activeCanvasId: ids.canvas,
        revisionId: ids.revision,
        structure: {
          pages: { [ids.revision]: { id: ids.revision } },
          canvases: {
            [ids.canvas]: {
              id: ids.canvas,
              background: null,
              outputProfile: {},
            },
            "82000000-0000-4000-8000-000000000099": {
              id: "82000000-0000-4000-8000-000000000099",
              background: null,
              outputProfile: {},
            },
          },
          sources: {},
        },
      },
      open: true,
      outboxReady: true,
      projectId: ids.project,
      revisionId: ids.revision,
      revisionStatus: "approved",
      revisionVersion: 3,
      saveStatus: "저장됨",
      snapshotSha256: scope.snapshotSha256,
      workspaceId: ids.document,
    }),
  );
  assert.match(multi, /캔버스가 각각 하나/);
  assert.doesNotMatch(multi, /href=/);
});

test("native DWG paths preserve exact scope and fixed artifact names", () => {
  assert.equal(
    paths.drawingNativeDwgExportPath(ids.project, ids.document),
    `/projects/${ids.project}/workspaces/${ids.document}/native-dwg`,
  );
  assert.equal(
    paths.drawingNativeDwgDownloadPath(
      ids.project,
      ids.document,
      ids.job,
      "report",
    ),
    `/projects/${ids.project}/workspaces/${ids.document}/native-dwg/${ids.job}/download/report`,
  );
});

async function withBrowserControl(run) {
  const props = {
    backendAvailable: true,
    open: true,
    outboxReady: true,
    projectId: ids.project,
    workspaceId: ids.document,
    revisionId: ids.revision,
    revisionVersion: 3,
    revisionStatus: "approved",
    saveStatus: "저장됨",
    snapshotSha256: scope.snapshotSha256,
    documentState: {
      activeCanvasId: ids.canvas,
      structure: {
        pages: { page: {} },
        canvases: {
          [ids.canvas]: { id: ids.canvas, background: null, outputProfile: {} },
        },
        sources: {},
        tombstones: {},
      },
    },
  };
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
    },
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "native-dwg-browser-fixture",
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              '<div id="root"></div><script type="module" src="/native-dwg-fixture.js"></script>',
            );
          });
        },
        resolveId(id) {
          if (id === "/native-dwg-fixture.js") return "\0native-dwg-fixture";
        },
        load(id) {
          if (id !== "\0native-dwg-fixture") return;
          return `import React from 'react'; import {createRoot} from 'react-dom/client';
          import {NativeDrawingDwgExportControl} from '/app/lukas/components/drawing-native-dwg-export.tsx';
          window.requests = []; window.abortCount = 0;
          const transport = (url, init = {}) => { if (init.method === 'POST') {
            window.requests.push(JSON.parse(init.body));
            init.signal.addEventListener('abort', () => window.abortCount++);
          } return fetch(url, init); };
          createRoot(document.getElementById('root')).render(React.createElement(NativeDrawingDwgExportControl, {...${JSON.stringify(props)}, transport}));`;
        },
      },
    ],
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    try {
      await run(page, server.resolvedUrls.local[0]);
    } catch (error) {
      error.message += `\nBrowser diagnostics: ${JSON.stringify({ errors, text: await page.locator("body").innerText() })}`;
      throw error;
    }
  } finally {
    await browser?.close();
    await server.close();
  }
}

test("browser control resumes status after replay returns the same accepted job", async () => {
  await withBrowserControl(async (page, url) => {
    let gets = 0;
    await page.route("**/native-dwg**", async (route) => {
      if (!route.request().url().includes("/projects/"))
        return route.continue();
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        return route.fulfill({
          json: { accepted: true, jobId: ids.job, requestId: body.requestId },
        });
      }
      gets += 1;
      if (gets === 1) return route.fulfill({ json: null });
      if (gets === 2)
        return route.fulfill({ status: 503, body: "unavailable" });
      return route.fulfill({
        json: {
          jobId: ids.job,
          status: "failed",
          attemptCount: 3,
          lastErrorCode: "upload_failed",
          qualification: "experimental-unqualified",
          receipt: null,
        },
      });
    });
    await page.goto(url);
    await page.getByRole("button", { name: "시험용 DWG 만들기" }).click();
    await page.getByRole("button", { name: "같은 요청 다시 확인" }).click();
    await page
      .getByRole("button", { name: "새 요청으로 다시 요청" })
      .waitFor({ timeout: 3000 })
      .catch(async () => {
        assert.fail(
          JSON.stringify({
            gets,
            state: await page.evaluate(() => ({
              text: document.body.innerText,
              requests: window.requests,
              aborts: window.abortCount,
            })),
          }),
        );
      });
    assert.equal(gets, 3);
    const requests = await page.evaluate(() => window.requests);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].requestId, requests[1].requestId);
  });
});

test("browser control ignores a duplicate click before mutating the live request", async () => {
  await withBrowserControl(async (page, url) => {
    let accepted = false;
    await page.route("**/native-dwg**", async (route) => {
      if (!route.request().url().includes("/projects/"))
        return route.continue();
      if (route.request().method() === "POST") {
        accepted = true;
        const body = route.request().postDataJSON();
        return route.fulfill({
          json: { accepted: true, jobId: ids.job, requestId: body.requestId },
        });
      }
      return route.fulfill({
        json: accepted
          ? {
              jobId: ids.job,
              status: "failed",
              attemptCount: 3,
              lastErrorCode: "upload_failed",
              qualification: "experimental-unqualified",
              receipt: null,
            }
          : null,
      });
    });
    await page.goto(url);
    const button = page.getByRole("button", { name: "시험용 DWG 만들기" });
    await button.waitFor();
    await button.evaluate((element) => {
      element.click();
      element.click();
    });
    await page
      .getByRole("button", { name: "새 요청으로 다시 요청" })
      .waitFor({ timeout: 3000 })
      .catch(async () => {
        assert.fail(
          JSON.stringify({
            accepted,
            state: await page.evaluate(() => ({
              text: document.body.innerText,
              requests: window.requests,
              aborts: window.abortCount,
            })),
          }),
        );
      });
    assert.equal(await page.evaluate(() => window.requests.length), 1);
    assert.equal(await page.evaluate(() => window.abortCount), 0);
  });
});
