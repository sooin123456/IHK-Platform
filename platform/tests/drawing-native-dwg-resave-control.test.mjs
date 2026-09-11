import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createServer } from "vite";
import { chromium } from "@playwright/test";
const actor = "82000000-0000-4000-8000-000000000080",
  otherActor = "82000000-0000-4000-8000-000000000081",
  jobId = "82000000-0000-4000-8000-000000000090";
const scope = {
  projectId: "82000000-0000-4000-8000-000000000001",
  documentId: "82000000-0000-4000-8000-000000000002",
  revisionId: "82000000-0000-4000-8000-000000000003",
  revisionVersion: 3,
  canvasId: "82000000-0000-4000-8000-000000000004",
  snapshotSha256: "a".repeat(64),
};
const receipt = {
  schemaVersion: "1hk-dwg-resave-receipt/1",
  jobId,
  attemptNumber: 1,
  scope,
  resaverImageId: "sha256:" + "c".repeat(64),
  sourceSha256: "b".repeat(64),
  qualification: "experimental-unqualified",
  persistenceAuthority: "not-issued",
  artifacts: [
    { kind: "dwg", sha256: "d".repeat(64), byteSize: 6 },
    { kind: "edit_request", sha256: "e".repeat(64), byteSize: 1 },
    { kind: "authority", sha256: "f".repeat(64), byteSize: 1 },
    { kind: "report", sha256: "0".repeat(64), byteSize: 1 },
  ],
  createdAt: "2026-09-06T00:00:00Z",
};
async function browserTest(run) {
  const server = await createServer({
    configFile: false,
    logLevel: "silent",
    resolve: {
      alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
    },
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "resave-fixture",
        enforce: "pre",
        configureServer(s) {
          s.middlewares.use((req, res, next) => {
            if (req.url !== "/") return next();
            res.setHeader("Content-Type", "text/html");
            res.end(
              '<div id="root"></div><script type="module" src="/resave-fixture.js"></script>',
            );
          });
        },
        resolveId(id) {
          if (id === "/resave-fixture.js") return "\0resave-fixture";
          if (
            id === "~/core/components/ui/dialog" ||
            /\/core\/components\/ui\/dialog(?:\.tsx)?$/.test(id)
          )
            return "\0dialog";
        },
        load(id) {
          if (id === "\0dialog")
            return `import React from 'react'; const Shell=({children})=>React.createElement('div',null,children);export const Dialog=Shell,DialogClose=Shell,DialogContent=Shell,DialogDescription=Shell,DialogFooter=Shell,DialogHeader=Shell,DialogTitle=Shell,DialogTrigger=Shell;`;
          if (id !== "\0resave-fixture") return;
          return `import React from 'react';import {createRoot} from 'react-dom/client';import {NativeDrawingDwgResaveControl} from '/app/lukas/components/drawing-native-dwg-resave-control.tsx';import {DrawingExportDialog} from '/app/lukas/components/drawing-export-dialog.tsx';import {buildNativeDrawingTemplate} from '/app/lukas/lib/drawing-native-templates.ts';import {createDrawingDocumentState} from '/app/lukas/lib/drawing-commands.ts';
 window.props={scope:${JSON.stringify(scope)},currentUserId:${JSON.stringify(actor)},open:true,readiness:true};window.calls=[];window.pending=[];window.result={job:null,receipt:null};window.failPost=false;window.hold=false;
 const transport=async(url,init={})=>{const body=init.body?JSON.parse(init.body):null;window.calls.push({url,body});if(window.hold)return new Promise(resolve=>window.pending.push(value=>resolve(Response.json(value))));if(body?.intent==='request'){if(window.failPost)throw Error('uncertain');window.result={job:{jobId:${JSON.stringify(jobId)},requestId:body.requestId,hasChanges:true,status:'queued',attemptCount:0,failureCode:null},receipt:null};return Response.json({jobId:${JSON.stringify(jobId)},requestId:body.requestId,hasChanges:true});}if(body?.intent==='cancel')window.result={job:{...window.result.job,status:'cancelled'},receipt:null};return Response.json(window.result);};
 window.fetch=transport;const root=createRoot(document.getElementById('root'));window.render=()=>root.render(React.createElement(NativeDrawingDwgResaveControl,{...window.props,transport}));window.render();
 const t=buildNativeDrawingTemplate('measured-plan');const canvas=Object.values(t.structure.canvases)[0];canvas.outputProfile=t.outputProfile;
 window.dialogProps={auditRequired:true,currentUserId:${JSON.stringify(actor)},checkpointSha256:'a'.repeat(64),createdAt:'2026-09-06T00:00:00Z',documentState:{...createDrawingDocumentState({revisionId:t.structure.revisionId,structure:t.structure}),activeCanvasId:canvas.id,activePageId:canvas.pageId},hideTrigger:true,open:true,operationCheckpoint:0,outboxReady:true,projectId:${JSON.stringify(scope.projectId)},revisionId:t.structure.revisionId,revisionStatus:'approved',revisionVersion:1,saveStatus:'저장됨',sourceUrl:null,title:t.name,workspaceId:${JSON.stringify(scope.documentId)}};
 window.renderDialog=()=>root.render(React.createElement(DrawingExportDialog,window.dialogProps));window.unmount=()=>root.render(null);`;
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
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => typeof window.render === "function");
    await run(page);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
}
test("browser-safe DTO contract is shared and rejects forged completed envelopes", async () => {
  const vite = await createServer({
    appType: "custom",
    configFile: false,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const c = await vite
      .ssrLoadModule("/app/lukas/lib/drawing-native-dwg-resave-contract.ts")
      .catch(() => ({}));
    assert.equal(
      typeof c.NativeDrawingDwgResaveReceiptSchema?.safeParse,
      "function",
    );
    assert.equal(
      c.NativeDrawingDwgResaveReceiptSchema.safeParse(receipt).success,
      true,
    );
    for (const bad of [
      { ...receipt, persistenceAuthority: "issued" },
      { ...receipt, artifacts: [...receipt.artifacts].reverse() },
      { ...receipt, path: "private" },
    ])
      assert.equal(
        c.NativeDrawingDwgResaveReceiptSchema.safeParse(bad).success,
        false,
      );
  } finally {
    await vite.close();
  }
});
test("React requests only on click, retries same identity, owns cancel, and exposes only completed validated four links", async () =>
  browserTest(async (page) => {
    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
    assert.equal(
      await page.evaluate(() => window.calls.filter((c) => c.body).length),
      0,
    );
    await page.evaluate(() => (window.failPost = true));
    await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
    await page.getByRole("alert").waitFor();
    const first = await page.evaluate(
      () => window.calls.find((c) => c.body).body,
    );
    assert.deepEqual(
      Object.keys(first).sort(),
      ["intent", ...Object.keys(scope), "requestId"].sort(),
    );
    await page.evaluate(() => (window.failPost = false));
    await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
    await page.getByRole("button", { name: "요청 취소" }).waitFor();
    const posts = await page.evaluate(() => window.calls.filter((c) => c.body));
    assert.equal(posts[1].body.requestId, first.requestId);
    assert.equal(await page.locator("a").count(), 0);
    await page.evaluate(() => {
      window.result = {
        job: { ...window.result.job, status: "completed", attemptCount: 1 },
        receipt: null,
      };
    });
    await page.waitForTimeout(1150);
    assert.equal(await page.locator("a").count(), 0);
    await page.evaluate((r) => {
      window.result.receipt = r;
    }, receipt);
    await page.getByRole("link", { name: "DWG 다운로드" }).waitFor();
    assert.equal(await page.locator("a").count(), 4);
    const hrefs = await page
      .locator("a")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")));
    assert.ok(
      hrefs.every((h) =>
        h.startsWith(
          `/projects/${scope.projectId}/workspaces/${scope.documentId}/native-dwg-resave/${jobId}/download/`,
        ),
      ),
    );
  }));
test("actor/open/scope generations fence A to B to A responses and relogin reads latest without admission", async () =>
  browserTest(async (page) => {
    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
    await page.evaluate(() => {
      window.hold = true;
      window.props = { ...window.props, open: false };
      window.render();
    });
    await page.waitForTimeout(30);
    await page.evaluate(() => {
      window.props = { ...window.props, open: true };
      window.render();
    });
    await page.waitForFunction(() => window.pending.length === 1);
    await page.evaluate((a) => {
      window.props = { ...window.props, currentUserId: a };
      window.render();
    }, otherActor);
    await page.waitForFunction(() => window.pending.length === 2);
    await page.evaluate((a) => {
      window.props = { ...window.props, currentUserId: a };
      window.render();
    }, actor);
    await page.waitForFunction(() => window.pending.length === 3);
    await page.evaluate(
      ({ receipt, jobId }) =>
        window.pending[0]({
          job: {
            jobId,
            requestId: "82000000-0000-4000-8000-000000000091",
            hasChanges: true,
            status: "completed",
            attemptCount: 1,
            failureCode: null,
          },
          receipt,
        }),
      { receipt, jobId },
    );
    await page.waitForTimeout(30);
    assert.equal(await page.locator("a").count(), 0);
    await page.evaluate(() => window.pending[2]({ job: null, receipt: null }));
    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
    assert.equal(
      await page.evaluate(() => window.calls.filter((c) => c.body).length),
      0,
    );
    await page.evaluate(() => {
      window.hold = false;
      window.props = { ...window.props, currentUserId: null };
      window.render();
    });
    assert.equal(
      await page.getByRole("button", { name: "DWG 재저장 요청" }).count(),
      0,
    );
  }));
test("actual dialog chooses one imported control and gates actor/backend/checkpoint/outbox; workspace passes actor", async () => {
  const workspace = await readFile(
    new URL("../app/lukas/components/drawing-workspace.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    workspace,
    /<DrawingExportLauncher[\s\S]*?currentUserId=\{currentUserId\}/,
  );
  await browserTest(async (page) => {
    await page.evaluate(() => {
      window.dialogProps.documentState.structure.sources = {
        imported: { sourceKind: "dwg_entity" },
      };
      window.renderDialog();
    });
    await page.getByRole("radio", { name: "DWG (시험)" }).check();
    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
    assert.equal(
      await page.getByRole("button", { name: "네이티브 DWG 요청" }).count(),
      0,
    );
    for (const change of [
      { auditRequired: false },
      { outboxReady: false },
      { operationCheckpoint: null },
      { checkpointSha256: null },
      { saveStatus: "저장 중" },
      { currentUserId: null },
    ]) {
      await page.evaluate((change) => {
        window.saved = { ...window.dialogProps };
        Object.assign(window.dialogProps, change);
        window.renderDialog();
      }, change);
      const button = page.getByRole("button", { name: "DWG 재저장 요청" });
      assert.ok((await button.count()) === 0 || (await button.isDisabled()));
      await page.evaluate(() => {
        window.dialogProps = window.saved;
        window.renderDialog();
      });
    }
    await page.evaluate(() => {
      window.dialogProps.documentState.structure.sources = {};
      window.renderDialog();
    });
    assert.equal(
      await page.getByRole("button", { name: "DWG 재저장 요청" }).count(),
      0,
    );
    assert.ok((await page.locator("body").innerText()).includes("네이티브"));
  });
});

test("remount recovers latest and actor-scoped ownership; own cancel is explicit and retry gets a new ID", async () =>
  browserTest(async (page) => {
    await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
    await page.getByRole("button", { name: "요청 취소" }).waitFor();
    const first = await page.evaluate(() => window.result.job.requestId);
    await page.evaluate(() => window.unmount());
    await page.waitForFunction(
      () => document.querySelector("#root").childElementCount === 0,
    );
    await page.evaluate(() => window.render());
    await page.getByRole("button", { name: "요청 취소" }).waitFor();
    assert.equal(
      await page.evaluate(() => window.calls.filter((c) => c.body).length),
      1,
    );
    assert.ok(
      await page.evaluate(() => !window.calls.at(-1).url.includes("jobId=")),
    );
    await page.evaluate((a) => {
      window.props = { ...window.props, currentUserId: a };
      window.render();
    }, otherActor);
    await page.waitForFunction(() =>
      document.body.innerText.includes("대기 중"),
    );
    assert.equal(
      await page.getByRole("button", { name: "요청 취소" }).count(),
      0,
    );
    await page.evaluate((a) => {
      window.props = { ...window.props, currentUserId: a };
      window.render();
    }, actor);
    await page.getByRole("button", { name: "요청 취소" }).click();
    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
    const cancel = await page.evaluate(
      () => window.calls.find((c) => c.body?.intent === "cancel").body,
    );
    assert.deepEqual(cancel, { intent: "cancel", ...scope, jobId });
    await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
    await page.getByRole("button", { name: "요청 취소" }).waitFor();
    assert.notEqual(
      await page.evaluate(() => window.result.job.requestId),
      first,
    );
  }));

test("scope and close/reopen generations fence pending status; disabled storage keeps uncertain identity", async () =>
  browserTest(async (page) => {
    await page.getByRole("button", { name: "DWG 재저장 요청" }).waitFor();
    await page.evaluate(() => {
      window.failPost = true;
      Storage.prototype.getItem = () => {
        throw Error("denied");
      };
      Storage.prototype.setItem = () => {
        throw Error("denied");
      };
    });
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "DWG 재저장 요청" }).click();
      await page.getByRole("alert").waitFor();
    }
    assert.equal(
      await page.evaluate(
        () =>
          window.calls.filter((c) => c.body)[0].body.requestId ===
          window.calls.filter((c) => c.body)[1].body.requestId,
      ),
      true,
    );
    await page.evaluate(() => {
      window.hold = true;
      window.props = {
        ...window.props,
        scope: { ...window.props.scope, revisionVersion: 4 },
      };
      window.render();
    });
    await page.waitForFunction(() => window.pending.length === 1);
    await page.evaluate(() => {
      window.props = {
        ...window.props,
        scope: { ...window.props.scope, revisionVersion: 3 },
      };
      window.render();
    });
    await page.waitForFunction(() => window.pending.length === 2);
    await page.evaluate(() => {
      window.props = { ...window.props, open: false };
      window.render();
    });
    await page.waitForTimeout(25);
    await page.evaluate(() => {
      window.props = { ...window.props, open: true };
      window.render();
    });
    await page.waitForFunction(() => window.pending.length === 3);
    await page.evaluate(
      ({ receipt, jobId }) =>
        window.pending[1]({
          job: {
            jobId,
            requestId: "82000000-0000-4000-8000-000000000091",
            hasChanges: true,
            status: "completed",
            attemptCount: 1,
            failureCode: null,
          },
          receipt,
        }),
      { receipt, jobId },
    );
    await page.waitForTimeout(25);
    assert.equal(await page.locator("a").count(), 0);
    await page.evaluate(() => window.pending[2]({ job: null, receipt: null }));
  }));
