import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("M1 BOQ fixture seeds and exactly removes a real component-free negative line", async () => {
  const source = await readFile(
    new URL("../e2e/utils/drawing-estimator-fixture.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /const lines = \[\s*"W-001",\s*"F-001",\s*"D-001",\s*"M1-C-001",?\s*\]/,
  );
  assert.match(source, /"M1 임시 천장"/);
  assert.match(source, /unit: "m"/);
  assert.match(
    source,
    /const estimator = await authenticateApiClient\(fixture, fixture\.editor\)/,
  );
  assert.match(source, /version\.data\.created_by !== fixture\.editor\.id/);
  assert.match(
    source,
    /export async function removeEstimatorNegativeLine[\s\S]*\.eq\("id", lineId\)[\s\S]*\.eq\("project_id", fixture\.projectId\)[\s\S]*\.eq\("version_id", versionId\)[\s\S]*\.select\("id"\)/,
  );
  assert.match(
    source,
    /components = lines[\s\S]*\.filter\(\(line\) => line\.item_code !== "M1-C-001"\)/,
  );
});
