import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const packageUrl = new URL("../package.json", import.meta.url);
const noticeUrl = new URL("../THIRD_PARTY_NOTICES.md", import.meta.url);
const rendererUrl = new URL(
  "../app/lukas/lib/pdf-page-renderer.client.ts",
  import.meta.url,
);
const viewerUrl = new URL(
  "../app/lukas/components/pdf-drawing-viewer.client.tsx",
  import.meta.url,
);
const lockUrl = new URL("../package-lock.json", import.meta.url);

test("drawing editor dependencies are permissive and noticed", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");

  assert.equal(pkg.dependencies.konva, "10.3.1");
  assert.equal(pkg.dependencies["react-konva"], "19.2.5");
  assert.match(notice, /\|\s*Konva\s*\|\s*10\.3\.1\s*\|.*\|\s*MIT\s*\|/);
  assert.match(notice, /\|\s*react-konva\s*\|\s*19\.2\.5\s*\|.*\|\s*MIT\s*\|/);
  assert.match(
    notice,
    /\|\s*@electric-sql\/pglite\s*\|\s*0\.5\.3\s*\|.*\|\s*Apache-2\.0\s*\|/,
  );
});

test("drawing export uses the exact unmodified MIT pdf-lib dependency", async () => {
  const pkg = JSON.parse(await readFile(packageUrl, "utf8"));
  const lock = JSON.parse(await readFile(lockUrl, "utf8"));
  const notice = await readFile(noticeUrl, "utf8");

  assert.equal(pkg.dependencies["pdf-lib"], "1.17.1");
  assert.equal(lock.packages["node_modules/pdf-lib"].version, "1.17.1");
  assert.equal(lock.packages["node_modules/pdf-lib"].license, "MIT");
  assert.match(
    notice,
    /\|\s*pdf-lib\s*\|\s*1\.17\.1\s*\|\s*https:\/\/github\.com\/Hopding\/pdf-lib\s*\|\s*MIT\s*\|\s*No\s*\|\s*npm\s*\|/,
  );
  assert.equal(pkg.dependencies["svg2pdf.js"], undefined);
  assert.equal(pkg.dependencies["canvg"], undefined);
  assert.equal(pkg.dependencies["jspdf"], undefined);
  for (const dependencyPath of [
    "node_modules/pdf-lib",
    "node_modules/@pdf-lib/standard-fonts",
    "node_modules/@pdf-lib/upng",
    "node_modules/pdf-lib/node_modules/pako",
    "node_modules/pdf-lib/node_modules/tslib",
  ]) {
    assert.doesNotMatch(
      lock.packages[dependencyPath].license,
      /GPL|MPL|source[- ]available/i,
    );
  }
});

test("viewer delegates PDF.js primitives to the shared renderer", async () => {
  const source = await readFile(viewerUrl, "utf8");

  assert.match(source, /openPdfDocument/);
  assert.match(source, /renderPdfPageToCanvas/);
  assert.doesNotMatch(
    source,
    /pdfjs-dist|GlobalWorkerOptions|\.getDocument\(|\.getPage\(|\.render\(/,
  );
});

test("document replacement cancels an active renderer before destruction", async () => {
  const source = await readFile(viewerUrl, "utf8");
  const cleanupRegistration = source.indexOf(
    "renderCleanupRef.current = () => controller.abort();",
  );
  const renderStart = source.indexOf("void renderPdfPageToCanvas({");
  const documentReplacement = source.indexOf(
    "renderControllerRef.current?.abort();",
  );
  const documentDestroy = source.indexOf("void openedDocument?.destroy();");

  assert.ok(cleanupRegistration >= 0 && cleanupRegistration < renderStart);
  assert.ok(documentReplacement >= 0 && documentReplacement < documentDestroy);
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
