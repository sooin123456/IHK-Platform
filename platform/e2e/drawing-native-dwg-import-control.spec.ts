import { expect, test, type Page } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { buildNativeDrawingDwgImportPlan } from "../app/lukas/lib/drawing-native-dwg-import-plan.server";

// Production React control, controlled HTTP only: no Auth, Storage or worker claim.
let server: ViteDevServer;
let url: string;
const id = (n: number) =>
  `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const report = {
  schemaVersion: "1hk-dwg-import/1",
  qualification: "experimental-unqualified",
  source: { sha256: "a".repeat(64), byteSize: 1024, headerVersion: "AC1024" },
  engine: { name: "ACadSharp", version: "3.7.1" },
  coordinateSystem: "WCS_NATIVE_UNITS",
  unitCode: 4,
  modelSpaceHandle: "10",
  layers: [{ handle: "20", name: "WALL", visible: true, locked: false }],
  entities: [
    {
      handle: "30",
      ownerHandle: "10",
      layerHandle: "20",
      type: "LINE",
      geometry: { start: [0, 0, 0], end: [1000, 0, 0] },
    },
  ],
  coverage: {
    modelSpaceEntities: 1,
    importedEntities: 1,
    unsupportedEntities: 0,
    nonModelSpaceEntities: 0,
  },
  unsupported: [],
  readerNotificationCount: 0,
};
const plan = {
  ...buildNativeDrawingDwgImportPlan({
    report,
    expectedSource: report.source,
    revisionId: id(4),
    canvasId: id(5),
    sourceFileId: id(6),
    analysisJobId: id(8),
    reportSha256: "b".repeat(64),
  }),
  canonicalReceipts: [],
  persistenceAuthority: "operation-attested",
};
test.beforeAll(async () => {
  server = await createServer({
    configFile: false,
    esbuild: { jsx: "automatic" },
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "native-dwg-control-harness",
        configureServer(vite) {
          vite.middlewares.use((req, res, next) => {
            if (req.url?.startsWith("/control")) {
              res.setHeader("Content-Type", "text/html");
              res.end(
                '<div id="root"></div><script type="module" src="/e2e/utils/drawing-native-dwg-import-control.tsx"></script>',
              );
            } else next();
          });
        },
      },
    ],
  });
  await server.listen();
  url = server.resolvedUrls!.local[0] + "control";
});
test.afterAll(async () => {
  await server?.close();
});
async function transport(
  page: Page,
  options: {
    status?: string;
    lost?: boolean;
    unauthorized?: boolean;
    delayed?: boolean;
    delayedPrepare?: boolean;
    statusNetworkError?: boolean;
  } = {},
) {
  const requests: URLSearchParams[] = [];
  let resolveStatus: (() => void) | undefined;
  await page.route("**/controlled-action", async (route) => {
    const request = route.request();
    const body = await new Request(request.url(), {
      method: "POST",
      headers: request.headers(),
      body: request.postData()!,
    }).formData();
    const form = new URLSearchParams(
      [...body.entries()].map(([key, value]) => [key, String(value)]),
    );
    requests.push(form);
    const intent = form.get("intent");
    if (intent === "request_native_dwg_import") {
      const pointers = await page.evaluate(() =>
        Object.entries(localStorage)
          .filter(([key]) => key.startsWith("drawing-native-dwg-import:v1:"))
          .map(([, text]) => JSON.parse(text)),
      );
      expect(
        pointers.some(
          (pointer) =>
            pointer.requestId === form.get("request_id") &&
            pointer.sourceFileId === form.get("source_file_id") &&
            pointer.jobId === null,
        ),
      ).toBe(true);
    }
    if (options.unauthorized)
      return route.fulfill({
        status: 403,
        json: { ok: false, error: "권한이 없습니다." },
      });
    if (options.lost && intent === "request_native_dwg_import") {
      options.lost = false;
      return route.abort("failed");
    }
    if (options.delayed && intent === "native_dwg_import_status")
      await new Promise<void>((resolve) => {
        resolveStatus = resolve;
      });
    if (options.delayedPrepare && intent === "prepare_native_dwg_import")
      await new Promise<void>((resolve) => {
        resolveStatus = resolve;
      });
    if (options.statusNetworkError && intent === "native_dwg_import_status")
      return route.abort("failed");
    const status = options.status ?? "queued";
    const result =
      intent === "request_native_dwg_import"
        ? { jobId: id(8) }
        : intent === "prepare_native_dwg_import"
          ? plan
          : {
              jobId: id(8),
              status,
              attemptCount: 1,
              failureCode: status === "failed" ? "reader_failed" : null,
              receipt:
                status === "analyzed"
                  ? {
                  jobId: id(8),
                  attemptNumber: 1,
                  readerImageId: `sha256:${"c".repeat(64)}`,
                  reportSha256: "b".repeat(64),
                  reportByteSize: 1024,
                  qualification: "experimental-unqualified",
                  persistenceAuthority: "not-issued",
                  source: { verificationId: id(9), fileId: id(6), sha256: "a".repeat(64), byteSize: 1024, headerVersion: "AC1024" },
                    }
                  : null,
            };
    const kind =
      intent === "request_native_dwg_import"
        ? "native_dwg_import_requested"
        : intent === "prepare_native_dwg_import"
          ? "native_dwg_import_prepared"
          : "native_dwg_import_status";
    await route
      .fulfill({ json: { ok: true, kind, error: null, result } })
      .catch(() => {});
  });
  return { requests, options, release: () => resolveStatus?.() };
}
test("queued analysis survives remount; analyzed requires explicit apply", async ({
  page,
}) => {
  const http = await transport(page);
  await page.goto(url);
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("분석 대기");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("분석 대기");
  expect(
    http.requests.filter(
      (r) => r.get("intent") === "request_native_dwg_import",
    ),
  ).toHaveLength(1);
  http.options.status = "analyzed";
  await expect(
    page.getByRole("button", { name: "편집 객체로 가져오기", exact: true }),
  ).toBeEnabled({ timeout: 6000 });
  await expect(page.getByLabel("Applied plans")).toHaveText("0");
  await page
    .getByRole("button", { name: "편집 객체로 가져오기", exact: true })
    .click();
  await expect(page.getByLabel("Applied plans")).toHaveText("1");
  await expect(page.getByRole("status")).toContainText("저장 대기열");
});
test("lost request response retries same durable request after reload", async ({
  page,
}) => {
  const http = await transport(page, { lost: true });
  await page.goto(url);
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "같은 요청 다시 확인", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("분석 대기");
  const starts = http.requests.filter(
    (r) => r.get("intent") === "request_native_dwg_import",
  );
  expect(starts).toHaveLength(2);
  expect(starts[0].get("request_id")).toBe(starts[1].get("request_id"));
});
test("failed is terminal and requires explicit new request; unauthorized is surfaced", async ({
  page,
}) => {
  const http = await transport(page, { status: "failed" });
  await page.goto(url);
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("분석 실패");
  const count = http.requests.length;
  await page.waitForTimeout(2300);
  expect(http.requests).toHaveLength(count);
  http.options.unauthorized = true;
  await page.getByRole("button", { name: "새 분석 요청", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("권한");
  const starts = http.requests.filter(
    (r) => r.get("intent") === "request_native_dwg_import",
  );
  expect(starts[0].get("request_id")).not.toBe(starts[1].get("request_id"));
});
test("scope switch discards a pending response", async ({ page }) => {
  const http = await transport(page, { status: "analyzed", delayed: true });
  await page.goto(url);
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect
    .poll(() =>
      http.requests.some((r) => r.get("intent") === "native_dwg_import_status"),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Switch canvas" }).click();
  http.release();
  await expect(
    page.getByRole("button", { name: "DWG 분석 시작", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "편집 객체로 가져오기", exact: true }),
  ).toHaveCount(0);
});
test("viewer cannot request; offline stops polling", async ({ page }) => {
  const http = await transport(page);
  await page.goto(url + "?viewer");
  await expect(
    page.getByRole("button", { name: "DWG 분석 시작", exact: true }),
  ).toBeDisabled();
  expect(http.requests).toHaveLength(0);
  await page.goto(url);
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("분석 대기");
  await page.getByRole("button", { name: "Toggle online" }).click();
  const count = http.requests.length;
  await page.waitForTimeout(2300);
  expect(http.requests).toHaveLength(count);
});
test("storage failure prevents network", async ({ page }) => {
  const http = await transport(page);
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error("quota fixture");
    };
  });
  await page.goto(url);
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("저장");
  expect(http.requests).toHaveLength(0);
});
test("unit and source changes require explicit analysis with a new identity", async ({
  page,
}) => {
  const http = await transport(page);
  await page.goto(url);
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("분석 대기");
  await page.getByLabel("DWG 단위", { exact: true }).selectOption("6");
  expect(
    http.requests.filter(
      (r) => r.get("intent") === "request_native_dwg_import",
    ),
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("분석 대기");
  await page.getByLabel("DWG 원본", { exact: true }).selectOption(id(7));
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("분석 대기");
  const starts = http.requests.filter(
    (r) => r.get("intent") === "request_native_dwg_import",
  );
  expect(starts).toHaveLength(3);
  expect(new Set(starts.map((r) => r.get("request_id"))).size).toBe(3);
  expect(starts[1].get("unit_code")).toBe("6");
  expect(starts[2].get("source_file_id")).toBe(id(7));
});
test("network failure stops polling until explicit check", async ({ page }) => {
  const http = await transport(page, { statusNetworkError: true });
  await page.goto(url);
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  const count = http.requests.length;
  await page.waitForTimeout(2300);
  expect(http.requests).toHaveLength(count);
  http.options.statusNetworkError = false;
  await page
    .getByRole("button", { name: "분석 상태 확인", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("분석 대기");
});
test("apply needs persistence readiness and ignores preparation after authority revocation", async ({
  page,
}) => {
  const http = await transport(page, {
    status: "analyzed",
    delayedPrepare: true,
  });
  await page.goto(url);
  await page.getByRole("button", { name: "Toggle persistence ready" }).click();
  await page
    .getByRole("button", { name: "DWG 분석 시작", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "편집 객체로 가져오기", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Toggle persistence ready" }).click();
  await page
    .getByRole("button", { name: "편집 객체로 가져오기", exact: true })
    .click();
  await expect
    .poll(() =>
      http.requests.some(
        (r) => r.get("intent") === "prepare_native_dwg_import",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Revoke editor" }).click();
  http.release();
  await expect(page.getByRole("status")).toContainText("편집 권한");
  await expect(page.getByLabel("Applied plans")).toHaveText("0");
});
