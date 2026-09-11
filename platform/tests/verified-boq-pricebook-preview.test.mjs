import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createServer } from "vite";

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const previewModule = await vite
  .ssrLoadModule(
    "/app/lukas/components/verified-boq-pricebook-import-preview.tsx",
  )
  .catch(() => ({}));

test.after(() => vite.close());

const bookId = "82000000-0000-4000-8000-000000000001";
const reportUrl = `/projects/82000000-0000-4000-8000-000000000002/boq/export/pricebook-errors?price_book_id=${bookId}`;

function renderPreview(preview) {
  return renderToStaticMarkup(
    createElement(RouterProvider, {
      router: createMemoryRouter(
        [
          {
            path: "/",
            element: createElement(
              previewModule.VerifiedBoqPriceBookImportPreview,
              { preview, returnTo: "/projects/p/workspaces/w" },
            ),
          },
        ],
        { initialEntries: ["/"] },
      ),
    }),
  );
}

const headerMapping = [
  {
    sourceColumn: 1,
    sourceHeader: "resource_code",
    requiredHeader: "resource_code",
  },
  {
    sourceColumn: 2,
    sourceHeader: "resource_type",
    requiredHeader: "resource_type",
  },
];

test("price-book preview exposes mapping and every bounded row error without offering publish", () => {
  assert.equal(
    typeof previewModule.VerifiedBoqPriceBookImportPreview,
    "function",
  );
  const html = renderPreview({
    bookId,
    filename: "mixed-rates.csv",
    sourceSha256: "a".repeat(64),
    reportUrl,
    headerMapping,
    validRowCount: 1,
    errors: [
      {
        row: 3,
        field: "unit_price_krw",
        reason: "단가표 3행 단가는 음수일 수 없습니다.",
      },
      {
        row: 4,
        field: "unit",
        reason: "단가표 4행 단위가 올바르지 않습니다.",
      },
    ],
    totalErrorCount: 2,
    errorsTruncated: false,
  });
  assert.match(html, /단가표 가져오기 미리보기/);
  assert.match(html, /헤더 매핑/);
  assert.match(html, /resource_code/);
  assert.match(html, /유효 1행/);
  assert.match(html, /오류 2건/);
  assert.match(html, /3행/);
  assert.match(html, /음수일 수 없습니다/);
  assert.match(html, /4행/);
  assert.match(html, /단위가 올바르지 않습니다/);
  assert.match(html, /오류 CSV 다운로드/);
  assert.match(html, new RegExp(`href="${reportUrl.replace("?", "\\?")}"`));
  assert.doesNotMatch(html, /resource_import_report/);
  assert.doesNotMatch(html, /검사 결과 반영/);
});

test("error-free price-book preview offers one server-revalidated publish action", () => {
  const html = renderPreview({
    bookId,
    filename: "valid-rates.csv",
    sourceSha256: "b".repeat(64),
    reportUrl,
    headerMapping,
    validRowCount: 3,
    errors: [],
    totalErrorCount: 0,
    errorsTruncated: false,
  });
  assert.match(html, /유효 3행/);
  assert.match(html, /오류 0건/);
  assert.match(html, /name="intent" value="resource_import"/);
  assert.match(html, new RegExp(`name="price_book_id" value="${bookId}"`));
  assert.match(html, /검사 결과 반영/);
  assert.doesNotMatch(html, /오류 CSV 다운로드/);
});
