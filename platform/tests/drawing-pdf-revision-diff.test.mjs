import assert from "node:assert/strict";
import test from "node:test";

import { computeDrawingPdfRevisionDiff } from "../app/lukas/lib/drawing-pdf-revision-diff.ts";

function page(width, height, options = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = 255;
    data[index + 1] = 255;
    data[index + 2] = 255;
    data[index + 3] = 255;
  }
  return {
    rotation: 0,
    viewport: { width, height },
    pixels: { width, height, data },
    ...options,
  };
}

function paint(input, x, y, width, height, rgba = [0, 0, 0, 255]) {
  const next = {
    ...input,
    pixels: { ...input.pixels, data: input.pixels.data.slice() },
  };
  for (let row = y; row < y + height; row += 1)
    for (let column = x; column < x + width; column += 1) {
      const index = (row * input.pixels.width + column) * 4;
      next.pixels.data.set(rgba, index);
    }
  return next;
}

function paintInPlace(input, x, y, width, height, rgba = [0, 0, 0, 255]) {
  for (let row = y; row < y + height; row += 1)
    for (let column = x; column < x + width; column += 1) {
      const index = (row * input.pixels.width + column) * 4;
      input.pixels.data.set(rgba, index);
    }
}

test("identical premultiplied RGBA pages produce no preview markers", () => {
  const previous = page(64, 64);
  const current = page(64, 64);
  assert.deepEqual(computeDrawingPdfRevisionDiff({ previous, current }), {
    status: "ready",
    markers: [],
  });

  const transparentA = paint(previous, 0, 0, 64, 64, [255, 0, 0, 0]);
  const transparentB = paint(current, 0, 0, 64, 64, [0, 255, 0, 0]);
  assert.deepEqual(
    computeDrawingPdfRevisionDiff({
      previous: transparentA,
      current: transparentB,
    }),
    { status: "ready", markers: [] },
  );
});

test("the fixed threshold marks 32px tiles and discards isolated pixel noise", () => {
  const previous = paint(page(64, 64), 0, 0, 64, 64, [0, 0, 0, 255]);
  const atThreshold = paint(previous, 0, 0, 32, 32, [32, 32, 32, 255]);
  assert.deepEqual(
    computeDrawingPdfRevisionDiff({ previous, current: atThreshold }),
    { status: "ready", markers: [] },
  );

  const overThreshold = paint(previous, 0, 0, 32, 32, [33, 33, 33, 255]);
  assert.deepEqual(
    computeDrawingPdfRevisionDiff({ previous, current: overThreshold }),
    {
      status: "ready",
      markers: [
        {
          x: 0,
          y: 0,
          width: 0.5,
          height: 0.5,
          label: "브라우저 미리보기",
        },
      ],
    },
  );

  const onePixel = paint(previous, 0, 0, 1, 1, [255, 255, 255, 255]);
  assert.deepEqual(
    computeDrawingPdfRevisionDiff({ previous, current: onePixel }),
    { status: "ready", markers: [] },
  );
});

test("adjacent tiles merge and marker order/capping stay stable", () => {
  const previous = page(1024, 1024);
  let current = page(1024, 1024);
  for (let tileY = 0; tileY < 32; tileY += 1)
    for (let tileX = 0; tileX < 32; tileX += 1)
      if ((tileX + tileY) % 2 === 0)
        paintInPlace(current, tileX * 32, tileY * 32, 2, 2);

  const first = computeDrawingPdfRevisionDiff({ previous, current });
  const second = computeDrawingPdfRevisionDiff({ previous, current });
  assert.equal(first.status, "ready");
  assert.equal(first.markers.length, 256);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(first.markers[0], {
    x: 0,
    y: 0,
    width: 1 / 32,
    height: 1 / 32,
    label: "브라우저 미리보기",
  });

  const merged = computeDrawingPdfRevisionDiff({
    previous: page(96, 64),
    current: paint(page(96, 64), 0, 0, 64, 32),
  });
  assert.deepEqual(merged.markers, [
    {
      x: 0,
      y: 0,
      width: 2 / 3,
      height: 0.5,
      label: "브라우저 미리보기",
    },
  ]);
});

test("rotation and aspect mismatches refuse automatic markers", () => {
  const previous = page(64, 64);
  assert.deepEqual(
    computeDrawingPdfRevisionDiff({
      previous,
      current: page(64, 64, { rotation: 90 }),
    }),
    { status: "refused", reason: "rotation_mismatch", markers: [] },
  );
  assert.deepEqual(
    computeDrawingPdfRevisionDiff({
      previous,
      current: page(64, 64, {
        viewport: { width: 102, height: 100 },
      }),
    }),
    { status: "refused", reason: "aspect_mismatch", markers: [] },
  );
});

test("diff work is bounded and AbortController/generation cancellable", () => {
  assert.throws(() =>
    computeDrawingPdfRevisionDiff({
      previous: page(1025, 1),
      current: page(1025, 1),
    }),
  );

  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () =>
      computeDrawingPdfRevisionDiff({
        previous: page(64, 64),
        current: page(64, 64),
        signal: controller.signal,
      }),
    { name: "AbortError" },
  );
  assert.throws(
    () =>
      computeDrawingPdfRevisionDiff({
        previous: page(64, 64),
        current: page(64, 64),
        generation: { requested: 4, current: () => 5 },
      }),
    { name: "AbortError" },
  );
});
