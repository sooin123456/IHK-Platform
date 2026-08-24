import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { test } from "node:test";

const rendererUrl = new URL(
  "../app/lukas/lib/pdf-page-renderer.client.ts",
  import.meta.url,
);

test("shared PDF renderer self-hosts character maps and standard fonts", async () => {
  const source = await readFile(rendererUrl, "utf8");

  assert.match(source, /cMapUrl:\s*["']\/pdfjs\/cmaps\/["']/);
  assert.match(source, /cMapPacked:\s*true/);
  assert.match(
    source,
    /standardFontDataUrl:\s*["']\/pdfjs\/standard_fonts\/["']/,
  );

  await access(
    new URL("../public/pdfjs/cmaps/Adobe-Korea1-UCS2.bcmap", import.meta.url),
  );
  await access(
    new URL(
      "../public/pdfjs/standard_fonts/LiberationSans-Regular.ttf",
      import.meta.url,
    ),
  );
});
