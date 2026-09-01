import assert from "node:assert/strict";
import test from "node:test";

import {
  RATE_BOOK_CSV,
  RATE_BOOK_SHA256,
} from "../e2e/utils/drawing-estimator-fixture.ts";

test("M1 estimator rate fixture preserves the approved UTF-8 bytes and digest", () => {
  assert.equal(
    RATE_BOOK_CSV,
    [
      "resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
      "W-001,material,경량벽체,,m,10000",
      "F-001,material,바닥마감,,m2,30000",
      "D-001,material,문 세트,,EA,150000",
    ].join("\n"),
  );
  assert.equal(
    RATE_BOOK_SHA256,
    "7592f8466e82cd829e29bb0258ecbc339fe0bda2dd34527178e5ef097096051c",
  );
});
