import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFIED_BOQ_V1_1_ENGINE_VERSION,
  calculateVerifiedBoqByEngine,
  calculateVerifiedBoqV1_1,
  canonicalizeVerifiedBoqV1_1Input,
} from "../app/lukas/lib/verified-boq-v1-1.server.ts";
import {
  buildVerifiedBoqCalculationManifest,
  buildVerifiedBoqHandoffManifest,
} from "../app/lukas/lib/verified-boq-manifest.server.ts";
import { calculateVerifiedBoq } from "../app/lukas/lib/verified-boq.server.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);
const E = "e".repeat(64);
const F = "f".repeat(64);
const NINE = "9".repeat(64);

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  version: "00000000-0000-4000-8000-000000000010",
  lineA: "00000000-0000-4000-8000-000000000101",
  lineB: "00000000-0000-4000-8000-000000000102",
  quantity: "00000000-0000-4000-8000-000000000201",
  revision: "00000000-0000-4000-8000-000000000202",
  object: "00000000-0000-4000-8000-000000000203",
  lineage: "00000000-0000-4000-8000-000000000204",
  ifcFile: "00000000-0000-4000-8000-000000000301",
  pdfFile: "00000000-0000-4000-8000-000000000302",
  issueA: "00000000-0000-4000-8000-000000000401",
  issueB: "00000000-0000-4000-8000-000000000402",
  legacyFile: "00000000-0000-4000-8000-000000000501",
  legacyMapping: "00000000-0000-4000-8000-000000000601",
  drawingMapA: "00000000-0000-4000-8000-000000000602",
  drawingMapB: "00000000-0000-4000-8000-000000000603",
  priceBook: "00000000-0000-4000-8000-000000000701",
  priceFile: "00000000-0000-4000-8000-000000000702",
  resource: "00000000-0000-4000-8000-000000000801",
  componentA: "00000000-0000-4000-8000-000000000901",
  componentB: "00000000-0000-4000-8000-000000000902",
  approver: "00000000-0000-4000-8000-000000000999",
};

function drawingSource() {
  return {
    quantityLinkId: ids.quantity,
    revisionId: ids.revision,
    revisionVersion: 2,
    snapshotSha256: B,
    objectId: ids.object,
    lineageId: ids.lineage,
    objectVersion: 3,
    objectFingerprint: C,
    measurementKind: "area",
    rawQuantity: "4.7500",
    unit: "m2",
    measurementRuleVersion: "P4_MEASUREMENT_V1",
    sourceAnchors: [
      {
        sourceFileId: ids.pdfFile,
        sourceSha256: E,
        sourceKind: "pdf_region",
        pdfRegion: {
          pageNumber: 1,
          x: 10,
          y: 20,
          width: 30,
          height: 40,
        },
        ifcGlobalId: null,
      },
      {
        sourceFileId: ids.ifcFile,
        sourceSha256: D,
        sourceKind: "ifc_element",
        pdfRegion: null,
        ifcGlobalId: "IFC-A",
      },
    ],
    issueLinks: [{ issueId: ids.issueB }, { issueId: ids.issueA }],
  };
}

function mixedInput() {
  return {
    engineVersion: "VERIFIED-BOQ-1.1",
    versionId: ids.version,
    calculationPolicy: "general_half_away",
    quantityScale: 3,
    lines: [
      {
        id: ids.lineB,
        sectionCode: "01",
        itemCode: "002-B",
        itemName: "내벽",
        specification: "B",
        unit: "m2",
        signedAdjustment: "0.1250",
        adjustmentReason: "마감 여유",
      },
      {
        id: ids.lineA,
        sectionCode: "01",
        itemCode: "001-A",
        itemName: "외벽",
        specification: "A",
        unit: "m2",
        signedAdjustment: "-1.250",
        adjustmentReason: "설계 공제",
      },
    ],
    legacyMappings: [
      {
        id: ids.legacyMapping,
        lineId: ids.lineA,
        sourceFileId: ids.legacyFile,
        sourceSha256: A,
        subjectKey: "LEGACY-A",
        sourceQuantity: "10.00",
        factor: "1.0",
        unit: "m2",
        elementIds: ["1002", "1001"],
      },
    ],
    drawingMappings: [
      {
        id: ids.drawingMapB,
        lineId: ids.lineB,
        quantityLinkId: ids.quantity,
        allocationFactor: "0.750",
        source: drawingSource(),
      },
      {
        id: ids.drawingMapA,
        lineId: ids.lineA,
        quantityLinkId: ids.quantity,
        allocationFactor: "0.250",
        source: drawingSource(),
      },
    ],
    priceBook: {
      id: ids.priceBook,
      sourceFileId: ids.priceFile,
      sourceSha256: NINE,
      effectiveDate: "2026-08-01",
      rightsBasis: "customer_owned",
    },
    exclusions: [],
    resources: [
      {
        id: ids.resource,
        code: "M-001",
        type: "material",
        unit: "m2",
        unitPriceKrw: "100.00",
      },
    ],
    components: [
      {
        id: ids.componentB,
        lineId: ids.lineB,
        resourceId: ids.resource,
        coefficient: "1.0",
      },
      {
        id: ids.componentA,
        lineId: ids.lineA,
        resourceId: ids.resource,
        coefficient: "2.00",
      },
    ],
  };
}

function legacyInput() {
  const input = mixedInput();
  return {
    versionId: input.versionId,
    calculationPolicy: input.calculationPolicy,
    quantityScale: input.quantityScale,
    lines: [input.lines[1]],
    mappings: input.legacyMappings,
    exclusions: [],
    resources: input.resources,
    components: [input.components[1]],
  };
}

const EXPECTED_RESULT_JSON =
  '{"engineVersion":"VERIFIED-BOQ-1.1","versionId":"00000000-0000-4000-8000-000000000010","calculationPolicy":"general_half_away","status":"calculated","lines":[{"lineId":"00000000-0000-4000-8000-000000000101","sectionCode":"01","itemCode":"001-A","itemName":"외벽","specification":"A","unit":"m2","status":"calculated","rawQuantity":"11.1875","adjustment":"-1.25","adjustedQuantity":"9.9375","finalQuantity":"9.938","materialUnitPriceKrw":"200","laborUnitPriceKrw":"0","expenseUnitPriceKrw":"0","totalUnitPriceKrw":"200","amountKrw":"1988","formula":"ROUND_HALF_AWAY(Q×(M+L+E),0)","sourceSha256":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],"elementIds":["1001","1002"],"drawingQuantityLinkIds":["00000000-0000-4000-8000-000000000201"],"message":"계산 가능"},{"lineId":"00000000-0000-4000-8000-000000000102","sectionCode":"01","itemCode":"002-B","itemName":"내벽","specification":"B","unit":"m2","status":"calculated","rawQuantity":"3.5625","adjustment":"0.125","adjustedQuantity":"3.6875","finalQuantity":"3.688","materialUnitPriceKrw":"100","laborUnitPriceKrw":"0","expenseUnitPriceKrw":"0","totalUnitPriceKrw":"100","amountKrw":"369","formula":"ROUND_HALF_AWAY(Q×(M+L+E),0)","sourceSha256":["bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],"elementIds":[],"drawingQuantityLinkIds":["00000000-0000-4000-8000-000000000201"],"message":"계산 가능"}],"directCostKrw":"2357","exclusions":[],"canonicalSha256":"a811dd7eb20dfbd030293035589f2923fd43d10238c104fd4f5f31dba862bee8"}';

test("1.1 mixes legacy and Drawing sources with exact quantities", () => {
  const result = calculateVerifiedBoqV1_1(mixedInput());
  assert.equal(VERIFIED_BOQ_V1_1_ENGINE_VERSION, "VERIFIED-BOQ-1.1");
  assert.equal(JSON.stringify(result), EXPECTED_RESULT_JSON);
  assert.equal(
    result.canonicalSha256,
    "a811dd7eb20dfbd030293035589f2923fd43d10238c104fd4f5f31dba862bee8",
  );
  assert.deepEqual(
    result.lines.map((line) => [
      line.rawQuantity,
      line.adjustment,
      line.adjustedQuantity,
      line.finalQuantity,
    ]),
    [
      ["11.1875", "-1.25", "9.9375", "9.938"],
      ["3.5625", "0.125", "3.6875", "3.688"],
    ],
  );
});

test("1.1 canonical input byte-sorts every source and normalizes decimals", () => {
  const original = mixedInput();
  const before = structuredClone(original);
  const canonical = canonicalizeVerifiedBoqV1_1Input(original);
  assert.deepEqual(original, before);
  assert.deepEqual(
    canonical.lines.map((row) => row.id),
    [ids.lineA, ids.lineB],
  );
  assert.deepEqual(
    canonical.drawingMappings.map((row) => row.id),
    [ids.drawingMapA, ids.drawingMapB],
  );
  assert.deepEqual(
    canonical.drawingMappings[0].source.sourceAnchors.map(
      (row) => row.sourceFileId,
    ),
    [ids.ifcFile, ids.pdfFile],
  );
  assert.deepEqual(
    canonical.drawingMappings[0].source.issueLinks.map((row) => row.issueId),
    [ids.issueA, ids.issueB],
  );
  assert.equal(canonical.legacyMappings[0].sourceQuantity, "10");
  assert.equal(canonical.legacyMappings[0].factor, "1");
  assert.deepEqual(canonical.legacyMappings[0].elementIds, ["1001", "1002"]);
  assert.equal(canonical.drawingMappings[0].allocationFactor, "0.25");
  assert.equal(canonical.drawingMappings[0].source.rawQuantity, "4.75");
  assert.equal(canonical.resources[0].unitPriceKrw, "100");
  assert.equal(canonical.components[0].coefficient, "2");
});

test("engine dispatch preserves 1.0 and rejects unavailable versions", () => {
  assert.deepEqual(
    calculateVerifiedBoqByEngine(legacyInput()),
    calculateVerifiedBoq(legacyInput()),
  );
  assert.equal(
    calculateVerifiedBoqByEngine(mixedInput()).engineVersion,
    "VERIFIED-BOQ-1.1",
  );
  assert.throws(
    () =>
      calculateVerifiedBoqByEngine({
        ...mixedInput(),
        engineVersion: "VERIFIED-BOQ-9.9",
      }),
    /P6B04.*지원하지 않는 계산 엔진/,
  );
});

test("1.1 fails closed on split, unit, ID, volume, adjusted, and review errors", () => {
  const cases = [
    [
      (input) => {
        input.drawingMappings[0].allocationFactor = "0.7";
      },
      /P6B04.*계수 합계/,
    ],
    [
      (input) => {
        input.drawingMappings[0].source.unit = "m3";
      },
      /P6U01/,
    ],
    [
      (input) => {
        input.drawingMappings[0].source.unit = "EA";
      },
      /P6U01/,
    ],
    [
      (input) => {
        input.drawingMappings[0].id = input.drawingMappings[1].id;
      },
      /P6B04.*중복/,
    ],
    [
      (input) => {
        input.lines[0].signedAdjustment = "-4";
      },
      /P6B04.*보정 후 수량/,
    ],
    [
      (input) => {
        input.components = input.components.filter(
          (row) => row.lineId !== ids.lineB,
        );
      },
      /P6B04.*계산할 수 없습니다/,
    ],
    [
      (input) => {
        input.legacyMappings[0].elementIds = [];
      },
      /Element ID/,
    ],
    [
      (input) => {
        input.priceBook.sourceSha256 = "BAD";
      },
      /P6B04.*단가표/,
    ],
    [
      (input) => {
        input.priceBook.rightsBasis = " ";
      },
      /P6B04.*권리/,
    ],
    [
      (input) => {
        input.priceBook.effectiveDate = "2026-02-30";
      },
      /P6B04.*기준일/,
    ],
    [
      (input) => {
        input.drawingMappings[0].source.revisionVersion = 0;
      },
      /P6B04.*개정 버전/,
    ],
    [
      (input) => {
        input.drawingMappings[0].source.objectVersion = 1.5;
      },
      /P6B04.*객체 버전/,
    ],
  ];
  for (const [mutate, pattern] of cases) {
    const input = mixedInput();
    mutate(input);
    assert.throws(() => calculateVerifiedBoqV1_1(input), pattern);
  }
});

test("calculation and approval manifests bind canonical lineage and evidence", () => {
  const input = mixedInput();
  const result = calculateVerifiedBoqV1_1(input);
  const calculation = buildVerifiedBoqCalculationManifest(input, result, {
    projectId: ids.project,
    inputStateSha256: F,
  });
  assert.equal(
    calculation.manifestSha256,
    "5fc033a23d2ba9071a2f1a99de0695fd0d7311f79c11abea6beae34d7cf7b36e",
  );
  assert.equal(
    new TextDecoder().decode(calculation.canonicalBytes),
    JSON.stringify(calculation.manifest),
  );
  assert.equal(calculation.manifest.drawingSources[0].sourceAnchors.length, 2);
  assert.deepEqual(calculation.manifest.drawingSources[0].issueLinks, [
    { issueId: ids.issueA },
    { issueId: ids.issueB },
  ]);
  assert.deepEqual(
    calculation.manifest.mappings.map((row) => row.sourceKind),
    ["drawing", "drawing", "legacy"],
  );
  assert.equal(
    calculation.manifest.mappings[2].sourceId,
    `${ids.legacyFile}\u001fLEGACY-A\u001fm2`,
  );
  assert.equal(
    calculation.manifest.result.resultSha256,
    result.canonicalSha256,
  );

  const approvalEnvelope = {
    versionId: ids.version,
    resultSha256: result.canonicalSha256,
    manifestSha256: calculation.manifestSha256,
    decision: "approved",
    decidedBy: ids.approver,
    decidedAt: "2026-08-28T00:00:00.000Z",
    note: "승인",
  };
  const handoff = buildVerifiedBoqHandoffManifest(
    calculation.manifest,
    approvalEnvelope,
  );
  assert.equal(
    handoff.handoffSha256,
    "c40e6020cd87be0852a432051bc2295b5ab3d30e32d28420f58e2e3f9a4c44b6",
  );
  assert.equal(handoff.manifest.handoffSha256, handoff.handoffSha256);
  assert.deepEqual(handoff.manifest.evidenceFiles, [
    { fileId: ids.ifcFile, sha256: D },
    { fileId: ids.pdfFile, sha256: E },
    { fileId: ids.legacyFile, sha256: A },
    { fileId: ids.priceFile, sha256: NINE },
  ]);
  assert.equal(
    new TextDecoder().decode(handoff.canonicalBytes),
    JSON.stringify(handoff.manifest),
  );
});

test("manifest builders reject stale result and approval hashes", () => {
  const input = mixedInput();
  const result = calculateVerifiedBoqV1_1(input);
  assert.throws(
    () =>
      buildVerifiedBoqCalculationManifest(
        input,
        { ...result, canonicalSha256: A },
        { projectId: ids.project, inputStateSha256: F },
      ),
    /P6C01/,
  );
  const calculation = buildVerifiedBoqCalculationManifest(input, result, {
    projectId: ids.project,
    inputStateSha256: F,
  });
  assert.throws(
    () =>
      buildVerifiedBoqHandoffManifest(calculation.manifest, {
        versionId: ids.version,
        resultSha256: A,
        manifestSha256: calculation.manifestSha256,
        decision: "approved",
        decidedBy: ids.approver,
        decidedAt: "2026-08-28T00:00:00.000Z",
        note: "승인",
      }),
    /P6C01/,
  );
});

test("1.1 result and manifests are independent of order, locale, time, and random", () => {
  const expected = calculateVerifiedBoqV1_1(mixedInput());
  const calculation = buildVerifiedBoqCalculationManifest(
    mixedInput(),
    expected,
    { projectId: ids.project, inputStateSha256: F },
  );
  const oldRandom = Math.random;
  const oldNow = Date.now;
  const oldTimezone = process.env.TZ;
  Math.random = () => 0.999999;
  Date.now = () => 1;
  process.env.TZ = "Pacific/Kiritimati";
  try {
    for (let index = 0; index < 100; index += 1) {
      const input = mixedInput();
      if (index % 2 === 0) {
        input.lines.reverse();
        input.drawingMappings.reverse();
        input.components.reverse();
        for (const row of input.drawingMappings) {
          row.source.sourceAnchors.reverse();
          row.source.issueLinks.reverse();
        }
      }
      const result = calculateVerifiedBoqV1_1(input);
      const rerun = buildVerifiedBoqCalculationManifest(input, result, {
        projectId: ids.project,
        inputStateSha256: F,
      });
      assert.equal(JSON.stringify(result), EXPECTED_RESULT_JSON);
      assert.equal(rerun.manifestSha256, calculation.manifestSha256);
      assert.deepEqual(rerun.canonicalBytes, calculation.canonicalBytes);
    }
  } finally {
    Math.random = oldRandom;
    Date.now = oldNow;
    if (oldTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = oldTimezone;
  }
});
