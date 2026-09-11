import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MIXED_INVALID_RATE_BOOK_CSV,
  MIXED_INVALID_RATE_BOOK_SHA256,
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

test("M1 estimator mixed-invalid rate fixture preserves the preflight error rows and digest", () => {
  assert.equal(
    MIXED_INVALID_RATE_BOOK_CSV,
    [
      "resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
      "OK-001,material,정상 자원,,EA,12345",
      "BAD-NEG,material,음수 단가 자원,,EA,-1",
      "BAD-UNIT,material,잘못된 단위 자원,,BOX,1",
    ].join("\n"),
  );
  assert.equal(
    MIXED_INVALID_RATE_BOOK_SHA256,
    "1b8b859c5dcb084ba1280bba0fbe13fd5c9cea8d68d397e9e7ac29fa1e3a98c0",
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

test("M4 IFC fixture leases work through the audited converter identity", async () => {
  const source = await readFile(
    new URL("../e2e/utils/drawing-estimator-fixture.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /M4_IFC_FIXTURE_CONVERTER_SHA256/);
  assert.match(
    source,
    /fixture\.admin\.rpc\(\s*"lukas_drawing_claim_ifc_derivative_job_for_converter",\s*\{[\s\S]*?p_converter_sha256:\s*M4_IFC_FIXTURE_CONVERTER_SHA256,[\s\S]*?p_lease_seconds:\s*900/,
  );
  assert.doesNotMatch(
    source,
    /fixture\.admin\.rpc\(\s*"lukas_drawing_claim_ifc_derivative_job",/,
  );
});
