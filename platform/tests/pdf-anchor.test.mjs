import assert from "node:assert/strict";
import { test } from "node:test";

import {
  denormalizeRegion,
  normalizeDragRegion,
  normalizeRegion,
} from "../app/lukas/lib/pdf-anchor.ts";

test("PDF region survives viewport resize", () => {
  const normalized = normalizeRegion(
    { x: 100, y: 200, width: 300, height: 100 },
    { width: 1000, height: 2000 },
  );
  assert.deepEqual(normalized, { x: 0.1, y: 0.1, width: 0.3, height: 0.05 });
  assert.deepEqual(
    denormalizeRegion(normalized, { width: 500, height: 1000 }),
    { x: 50, y: 100, width: 150, height: 50 },
  );
});

test("PDF drag is ordered and clamped to the viewport", () => {
  assert.deepEqual(
    normalizeDragRegion(
      { x: 900, y: 1900 },
      { x: -100, y: 100 },
      { width: 1000, height: 2000 },
    ),
    { x: 0, y: 0.05, width: 0.9, height: 0.9 },
  );
});

test("PDF drag rejects accidental tiny regions and invalid viewports", () => {
  assert.equal(
    normalizeDragRegion(
      { x: 10, y: 10 },
      { x: 13, y: 13 },
      { width: 1000, height: 2000 },
    ),
    null,
  );
  assert.throws(() =>
    normalizeRegion(
      { x: 0, y: 0, width: 10, height: 10 },
      { width: 0, height: 100 },
    ),
  );
});
