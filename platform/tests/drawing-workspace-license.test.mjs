import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const packageUrl = new URL("../package.json", import.meta.url);
const noticeUrl = new URL("../THIRD_PARTY_NOTICES.md", import.meta.url);
const rendererUrl = new URL(
  "../app/lukas/lib/pdf-page-renderer.client.ts",
  import.meta.url,
);

test("drawing editor dependencies are permissive and noticed", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");

  assert.equal(typeof pkg.dependencies.konva, "string");
  assert.equal(typeof pkg.dependencies["react-konva"], "string");
  assert.match(notice, /Konva.*MIT/is);
  assert.match(notice, /react-konva.*MIT/is);
  assert.match(notice, /@electric-sql\/pglite.*Apache-2\.0/is);
});

test("PDF pages use the shared client renderer", async () => {
  const source = await readFile(rendererUrl, "utf8");

  assert.match(source, /export\s+async\s+function\s+openPdfDocument\s*\(/);
  assert.match(
    source,
    /export\s+async\s+function\s+renderPdfPageToCanvas\s*\(/,
  );
});

test("shared PDF opening stops before starting an aborted load", async () => {
  const source = await readFile(rendererUrl, "utf8");
  const abortCheck = source.indexOf("if (signal?.aborted) throw abortError();");
  const createLoadingTask = source.indexOf("const loadingTask");

  assert.ok(abortCheck >= 0 && abortCheck < createLoadingTask);
});
