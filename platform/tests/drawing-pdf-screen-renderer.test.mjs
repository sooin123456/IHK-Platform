import assert from "node:assert/strict";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const layoutModule = await import(
  "../app/lukas/lib/drawing-pdf-screen-layout.ts"
).catch(() => ({}));

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  configFile: false,
  logLevel: "silent",
  resolve: { alias: { "~": `${root}/app` } },
  root,
  server: { middlewareMode: true },
});
after(() => vite.close());

test("contain fit leaves vertical breathing room and preserves a rotated page ratio", () => {
  assert.equal(typeof layoutModule.calculatePdfScreenLayout, "function");
  const layout = layoutModule.calculatePdfScreenLayout({
    pageWidth: 1000,
    pageHeight: 500,
    hostWidth: 900,
    hostHeight: 700,
    zoom: 1,
    deviceScale: 2,
  });

  assert.deepEqual(layout.displaySize, { width: 852, height: 426 });
  assert.equal(layout.fitScale, 0.852);
});

test("height-limited fit reserves 44 pixels above and 96 below the page", () => {
  const layout = layoutModule.calculatePdfScreenLayout({
    pageWidth: 500,
    pageHeight: 1000,
    hostWidth: 900,
    hostHeight: 700,
    zoom: 1,
    deviceScale: 1,
  });

  assert.equal(layout.fitScale, 0.56);
  assert.deepEqual(layout.displaySize, { width: 280, height: 560 });
  assert.equal(44 + layout.displaySize.height + 96, 700);
});

test("backing-store caps do not change the CSS zoom size", () => {
  const layout = layoutModule.calculatePdfScreenLayout({
    pageWidth: 2000,
    pageHeight: 1000,
    hostWidth: 1000,
    hostHeight: 800,
    zoom: 20,
    deviceScale: 2,
  });

  assert.deepEqual(layout.displaySize, { width: 19040, height: 9520 });
  assert.ok(layout.backingSize.width <= 4096);
  assert.ok(layout.backingSize.height <= 4096);
  assert.ok(layout.backingSize.width * layout.backingSize.height <= 16_000_000);
  assert.ok(layout.renderCssScale < layout.displayScale);
});

test("low-resolution portrait thumbnails cap their tall backing edge", () => {
  assert.equal(typeof layoutModule.calculatePdfRenderDensity, "function");
  const density = layoutModule.calculatePdfRenderDensity({
    pageWidth: 100,
    pageHeight: 10_000,
    displayScale: 1.8,
    deviceScale: 2,
  });

  assert.deepEqual(density.backingSize, { width: 40, height: 4096 });
  assert.ok(density.renderCssScale < 1.8);
});

test("invalid or collapsed dimensions produce a bounded blank layout", () => {
  assert.deepEqual(
    layoutModule.calculatePdfScreenLayout({
      pageWidth: 0,
      pageHeight: 100,
      hostWidth: 800,
      hostHeight: 600,
      zoom: 1,
      deviceScale: 2,
    }),
    {
      fitScale: 0,
      displayScale: 0,
      renderCssScale: 0,
      displaySize: { width: 0, height: 0 },
      backingSize: { width: 0, height: 0 },
    },
  );
});

test("surface and thumbnail expose honest blank loading states before pixels exist", async () => {
  const module = await vite.ssrLoadModule(
    "/app/lukas/components/drawing-pdf-screen-renderer.client.tsx",
  );
  assert.equal(typeof module.PdfScreenSurface, "function");
  assert.equal(typeof module.PdfScreenThumbnail, "function");

  const document = { numPages: 1, getPage() {} };
  const surface = renderToStaticMarkup(
    createElement(module.PdfScreenSurface, {
      document,
      pageNumber: 1,
      zoom: 1,
      panEnabled: false,
      fitKey: 0,
    }),
  );
  assert.match(surface, /aria-busy="true"/);
  assert.match(surface, /PDF 1쪽을 불러오는 중입니다/);
  assert.match(surface, /visibility:hidden/);

  const thumbnail = renderToStaticMarkup(
    createElement(module.PdfScreenThumbnail, { document, pageNumber: 1 }),
  );
  assert.match(thumbnail, /aria-busy="true"/);
  assert.match(thumbnail, /PDF 1쪽 미리보기를 기다리는 중입니다/);
  assert.match(thumbnail, /visibility:hidden/);
  assert.match(thumbnail, /h-full min-h-0/);
  assert.match(thumbnail, /max-h-full max-w-full object-contain/);
});
