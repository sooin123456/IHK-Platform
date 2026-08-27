import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

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
import {
  compareVerifiedBoqApprovedStates,
  verifiedBoqStoredReplayMatches,
} from "../app/lukas/lib/verified-boq-comparison-v1-1.server.ts";
import { buildApprovedVerifiedBoqExport } from "../app/lukas/lib/verified-boq-approved-export.server.ts";

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
  pdfAnchor: "00000000-0000-4000-8000-000000000997",
  ifcAnchor: "00000000-0000-4000-8000-000000000998",
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

function antiCorrelatedInput() {
  const input = mixedInput();
  const lineA = input.lines.find((line) => line.itemCode === "001-A");
  const lineB = input.lines.find((line) => line.itemCode === "002-B");
  const oldLineA = lineA.id;
  const oldLineB = lineB.id;
  lineA.id = "00000000-0000-4000-8000-000000000999";
  lineB.id = "00000000-0000-4000-8000-000000000001";
  lineB.itemCode = "999-B";
  for (const mapping of [...input.legacyMappings, ...input.drawingMappings]) {
    if (mapping.lineId === oldLineA) mapping.lineId = lineA.id;
    if (mapping.lineId === oldLineB) mapping.lineId = lineB.id;
  }
  const resourceA = {
    ...input.resources[0],
    id: "00000000-0000-4000-8000-000000000998",
    code: "001-M",
  };
  const resourceB = {
    ...input.resources[0],
    id: "00000000-0000-4000-8000-000000000002",
    code: "999-M",
    type: "labor",
  };
  input.resources = [resourceB, resourceA];
  input.components = [
    {
      id: "00000000-0000-4000-8000-000000000003",
      lineId: lineB.id,
      resourceId: resourceB.id,
      coefficient: "1",
    },
    {
      id: "00000000-0000-4000-8000-000000000997",
      lineId: lineA.id,
      resourceId: resourceA.id,
      coefficient: "2",
    },
  ];
  return input;
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

test("1.1 canonical business ordering ignores anti-correlated database IDs", () => {
  const input = antiCorrelatedInput();
  const canonical = canonicalizeVerifiedBoqV1_1Input(input);
  assert.deepEqual(
    canonical.lines.map((row) => [row.itemCode, row.id]),
    [
      ["001-A", "00000000-0000-4000-8000-000000000999"],
      ["999-B", "00000000-0000-4000-8000-000000000001"],
    ],
  );
  assert.deepEqual(
    canonical.resources.map((row) => [row.code, row.id]),
    [
      ["001-M", "00000000-0000-4000-8000-000000000998"],
      ["999-M", "00000000-0000-4000-8000-000000000002"],
    ],
  );
  assert.deepEqual(
    canonical.components.map((row) => [row.resourceId, row.id]),
    [
      [
        "00000000-0000-4000-8000-000000000998",
        "00000000-0000-4000-8000-000000000997",
      ],
      [
        "00000000-0000-4000-8000-000000000002",
        "00000000-0000-4000-8000-000000000003",
      ],
    ],
  );

  const result = calculateVerifiedBoqV1_1(input);
  const calculation = buildVerifiedBoqCalculationManifest(input, result, {
    projectId: ids.project,
    inputStateSha256: F,
  });
  const shuffled = structuredClone(input);
  shuffled.lines.reverse();
  shuffled.resources.reverse();
  shuffled.components.reverse();
  shuffled.legacyMappings.reverse();
  shuffled.drawingMappings.reverse();
  const shuffledResult = calculateVerifiedBoqV1_1(shuffled);
  const shuffledCalculation = buildVerifiedBoqCalculationManifest(
    shuffled,
    shuffledResult,
    { projectId: ids.project, inputStateSha256: F },
  );
  assert.deepEqual(
    result.lines.map((row) => row.itemCode),
    ["001-A", "999-B"],
  );
  assert.equal(shuffledResult.canonicalSha256, result.canonicalSha256);
  assert.equal(shuffledCalculation.manifestSha256, calculation.manifestSha256);
  assert.deepEqual(
    shuffledCalculation.canonicalBytes,
    calculation.canonicalBytes,
  );
});

test("split legacy allocations require one identical immutable source", () => {
  const conflicting = mixedInput();
  conflicting.legacyMappings[0].factor = "0.5";
  conflicting.legacyMappings.push({
    ...structuredClone(conflicting.legacyMappings[0]),
    id: "00000000-0000-4000-8000-000000000604",
    lineId: ids.lineB,
    sourceQuantity: "100",
    elementIds: ["9999"],
  });
  assert.throws(
    () => calculateVerifiedBoqV1_1(conflicting),
    /P6B04.*legacy 원수량 근거/,
  );

  const valid = mixedInput();
  valid.legacyMappings[0].factor = "0.5";
  valid.legacyMappings.push({
    ...structuredClone(valid.legacyMappings[0]),
    id: "00000000-0000-4000-8000-000000000604",
    lineId: ids.lineB,
  });
  const result = calculateVerifiedBoqV1_1(valid);
  assert.deepEqual(
    result.lines.map((row) => row.rawQuantity),
    ["6.1875", "8.5625"],
  );
  const calculation = buildVerifiedBoqCalculationManifest(valid, result, {
    projectId: ids.project,
    inputStateSha256: F,
  });
  assert.equal(calculation.manifest.legacySources.length, 1);
  const legacyMappings = calculation.manifest.mappings.filter(
    (row) => row.sourceKind === "legacy",
  );
  assert.deepEqual(
    legacyMappings.map((row) => [row.sourceId, row.allocationFactor]),
    [
      [`${ids.legacyFile}\u001fLEGACY-A\u001fm2`, "0.5"],
      [`${ids.legacyFile}\u001fLEGACY-A\u001fm2`, "0.5"],
    ],
  );
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

test("approved 1.1 export round-trips canonical CSV, XLSX, and lineage manifest without formulas", () => {
  const input = mixedInput();
  input.lines[0].itemName = "=악성";
  input.lines[0].specification = "+사양";
  const result = calculateVerifiedBoqV1_1(input);
  const calculation = buildVerifiedBoqCalculationManifest(input, result, {
    projectId: ids.project,
    inputStateSha256: F,
  });
  const approvalEnvelope = {
    versionId: ids.version,
    resultSha256: result.canonicalSha256,
    manifestSha256: calculation.manifestSha256,
    decision: "approved",
    decidedBy: ids.approver,
    decidedAt: "2026-08-28T00:00:00.000Z",
    note: "승인",
  };
  const exported = buildApprovedVerifiedBoqExport({
    result,
    calculationManifest: calculation.manifest,
    approvalEnvelope,
    resources: [
      {
        code: "0001",
        type: "material",
        name: "-자재",
        specification: "@규격",
        unit: "m2",
        unitPriceKrw: "100.00",
      },
    ],
    legacyMappings: [
      {
        itemCode: "001-A",
        sourceFilename: "-원수량.csv",
        sourceSha256: A,
        subjectKey: "@WALL",
        sourceQuantity: "10.00",
        factor: "1.0",
        unit: "m2",
        elementIds: ["1001", "1002"],
      },
    ],
    drawingEvidence: [
      {
        itemCode: "001-A",
        quantityLinkId: ids.quantity,
        revisionId: ids.revision,
        revisionVersion: 2,
        snapshotSha256: B,
        objectId: ids.object,
        lineageId: ids.lineage,
        objectVersion: 3,
        objectFingerprint: C,
        measurementKind: "area",
        unit: "m2",
        rawQuantity: "4.7500",
        allocationFactor: "0.250",
        measurementRuleVersion: "P4_MEASUREMENT_V1",
        sourceAnchorIds: [ids.ifcAnchor, ids.pdfAnchor],
        sourceFileSha256: [D, E],
        issueIds: [ids.issueA, ids.issueB],
      },
    ],
    structures: [
      {
        itemCode: "001-A",
        cbsCode: "01",
        cbsName: "건축",
        wbsCode: "A-01",
        wbsName: "본관",
        allocationPercent: "100",
      },
    ],
    review: {
      projectName: "한글 프로젝트",
      versionLabel: "V001",
      status: "approved",
      makerId: ids.project,
      approvals: [
        {
          decision: "approved",
          note: "승인",
          decidedBy: ids.approver,
          createdAt: "2026-08-28T00:00:00.000Z",
        },
      ],
    },
  });

  assert.equal(exported.resultSha256, result.canonicalSha256);
  assert.equal(exported.manifestSha256, calculation.manifestSha256);
  assert.match(exported.handoffSha256, /^[0-9a-f]{64}$/);

  const manifestText = new TextDecoder().decode(exported.manifestJson);
  const manifest = JSON.parse(manifestText);
  assert.equal(manifestText, JSON.stringify(manifest));
  assert.equal(manifest.resultSha256, exported.resultSha256);
  assert.equal(manifest.manifestSha256, exported.manifestSha256);
  assert.equal(manifest.handoffSha256, exported.handoffSha256);
  assert.deepEqual(manifest.evidenceFiles, [
    { fileId: ids.ifcFile, sha256: D },
    { fileId: ids.pdfFile, sha256: E },
    { fileId: ids.legacyFile, sha256: A },
    { fileId: ids.priceFile, sha256: NINE },
  ]);

  const csv = new TextDecoder().decode(exported.csv);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /한글 프로젝트|악성/);
  assert.match(csv, /'001-A/);
  for (const protectedCell of ["'=악성", "'+사양", "'-원수량.csv", "'@WALL"])
    assert.match(csv, new RegExp(protectedCell.replace(/[+]/g, "\\+")));
  for (const hash of [
    exported.resultSha256,
    exported.manifestSha256,
    exported.handoffSha256,
  ])
    assert.match(csv, new RegExp(hash));
  assert.match(csv, /4\.7500/);
  assert.match(csv, /1001\|1002/);

  const archive = unzipSync(exported.xlsx);
  const workbook = strFromU8(archive["xl/workbook.xml"]);
  for (const name of [
    "공종별내역서",
    "자원단가",
    "매핑근거",
    "검토정보",
    "WBS-CBS",
    "도면근거",
    "승인·매니페스트",
  ])
    assert.match(workbook, new RegExp(`name="${name}"`));
  const workbookXml = Object.entries(archive)
    .filter(([name]) => name.endsWith(".xml"))
    .map(([, bytes]) => strFromU8(bytes))
    .join("\n");
  assert.doesNotMatch(workbookXml, /<f(?:\s|>)/);
  for (const hash of [
    exported.resultSha256,
    exported.manifestSha256,
    exported.handoffSha256,
  ])
    assert.match(workbookXml, new RegExp(hash));
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

test("verified BOQ 1.1 renders four distinct quantity columns and Drawing mapping UI", async () => {
  const screen = await readFile(
    new URL("../app/lukas/screens/verified-boq.tsx", import.meta.url),
    "utf8",
  );
  for (const label of ["원수량", "보정값", "보정 후 수량", "최종수량"])
    assert.match(screen, new RegExp(`>${label}<`));
  const quantityColumnGate = screen.indexOf(
    'result?.engineVersion === "VERIFIED-BOQ-1.1"',
  );
  const adjustmentColumn = screen.indexOf(">보정값<", quantityColumnGate);
  assert.ok(quantityColumnGate >= 0 && quantityColumnGate < adjustmentColumn);
  assert.match(
    screen,
    /result\.engineVersion === "VERIFIED-BOQ-1\.1" &&\s+"adjustedQuantity" in line/,
  );
  assert.match(screen, /VerifiedBoqDrawingSources/);
  assert.match(screen, /drawingSources/);
  assert.match(screen, /engine_version/);
  assert.doesNotMatch(
    screen,
    /name="(?:raw_quantity|final_quantity|unit_price|amount|result_sha256|manifest_sha256)"/,
  );
});

test("approved comparison UI renders every cause state and closure without a primary cause", async () => {
  const component = await readFile(
    new URL(
      "../app/lukas/components/verified-boq-comparison.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  for (const cause of ["RAW", "MAPPING", "ADJUSTMENT", "PRICE", "FORMULA"])
    assert.match(component, new RegExp(`id: "${cause}"`));
  for (const state of ["added", "removed", "changed", "unchanged"])
    assert.match(component, new RegExp(`${state}:`));
  for (const total of [
    "comparison.amountDeltaKrw",
    "comparison.causeAmountDeltaKrw",
    "comparison.rowAmountDeltaKrw",
    "comparison.amountCloses",
  ])
    assert.match(component, new RegExp(total.replaceAll(".", "\\.")));
  assert.doesNotMatch(component, /primary/i);
});

function approved(input, engineVersion = "VERIFIED-BOQ-1.1") {
  return {
    engineVersion,
    status: "approved",
    approvedDecision: {
      decidedBy: ids.approver,
      createdAt: "2026-08-28T00:00:00.000Z",
    },
    input,
    result:
      engineVersion === "VERIFIED-BOQ-1.0"
        ? calculateVerifiedBoq(input)
        : calculateVerifiedBoqV1_1(input),
  };
}

test("approved 1.1 comparison attributes each exact waterfall category", () => {
  const changes = [
    [
      "RAW",
      (input) => {
        input.legacyMappings[0].sourceQuantity = "12";
      },
      "400",
    ],
    [
      "MAPPING",
      (input) => {
        input.drawingMappings[0].allocationFactor = "0.5";
        input.drawingMappings[1].allocationFactor = "0.5";
      },
      "118",
    ],
    [
      "ADJUSTMENT",
      (input) => {
        input.lines.find((line) => line.itemCode === "001-A").signedAdjustment =
          "0";
      },
      "250",
    ],
    [
      "PRICE",
      (input) => {
        input.resources[0].unitPriceKrw = "110";
      },
      "235",
    ],
    [
      "FORMULA",
      (input) => {
        input.quantityScale = 1;
      },
      "-7",
    ],
  ];
  for (const [cause, mutate, amountDeltaKrw] of changes) {
    const current = mixedInput();
    mutate(current);
    const comparison = compareVerifiedBoqApprovedStates(
      approved(mixedInput()),
      approved(current),
    );
    assert.equal(comparison.status, "comparable", cause);
    assert.equal(comparison.amountDeltaKrw, amountDeltaKrw, cause);
    assert.equal(comparison.causeAmountDeltaKrw, amountDeltaKrw, cause);
    assert.equal(comparison.rowAmountDeltaKrw, amountDeltaKrw, cause);
    assert.equal(comparison.amountCloses, true, cause);
    assert.deepEqual(
      [
        ...new Set(
          comparison.rows.flatMap((row) =>
            row.causes.map((item) => item.cause),
          ),
        ),
      ],
      [cause],
      cause,
    );
  }
});

test("comparison keeps multiple visible causes and closes their exact row totals", () => {
  const current = mixedInput();
  current.legacyMappings[0].sourceQuantity = "12";
  current.drawingMappings[0].allocationFactor = "0.5";
  current.drawingMappings[1].allocationFactor = "0.5";
  current.lines.find((line) => line.itemCode === "001-A").signedAdjustment =
    "0";
  current.resources[0].unitPriceKrw = "110";
  current.quantityScale = 1;
  const comparison = compareVerifiedBoqApprovedStates(
    approved(mixedInput()),
    approved(current),
  );
  assert.equal(comparison.status, "comparable");
  assert.equal(comparison.amountCloses, true);
  assert.equal(comparison.causeAmountDeltaKrw, comparison.amountDeltaKrw);
  assert.equal(comparison.rowAmountDeltaKrw, comparison.amountDeltaKrw);
  assert.deepEqual(
    [
      ...new Set(
        comparison.rows.flatMap((row) => row.causes.map((item) => item.cause)),
      ),
    ],
    ["RAW", "MAPPING", "ADJUSTMENT", "PRICE", "FORMULA"],
  );
});

test("zero-amount semantic changes remain visible in their declared cause", () => {
  const cases = [
    [
      "RAW",
      (input) => {
        input.drawingMappings[0].source.objectFingerprint = D;
        input.drawingMappings[1].source.objectFingerprint = D;
      },
    ],
    [
      "ADJUSTMENT",
      (input) => {
        input.lines[0].adjustmentReason = "동일 수량의 변경 사유";
      },
    ],
    [
      "PRICE",
      (input) => {
        input.priceBook.effectiveDate = "2026-08-02";
      },
    ],
    [
      "FORMULA",
      (input) => {
        input.quantityScale = 4;
      },
    ],
  ];
  for (const [cause, mutate] of cases) {
    const current = mixedInput();
    mutate(current);
    const comparison = compareVerifiedBoqApprovedStates(
      approved(mixedInput()),
      approved(current),
    );
    assert.equal(comparison.status, "comparable", cause);
    assert.equal(comparison.amountDeltaKrw, "0", cause);
    assert.ok(
      comparison.rows.some((row) =>
        row.causes.some(
          (item) => item.cause === cause && item.amountDeltaKrw === "0",
        ),
      ),
      cause,
    );
  }
});

test("comparison reports added and removed rows without inventing a sixth cause", () => {
  const removed = mixedInput();
  removed.lines = removed.lines.filter((line) => line.itemCode === "001-A");
  removed.drawingMappings = removed.drawingMappings
    .filter((mapping) => mapping.lineId === ids.lineA)
    .map((mapping) => ({ ...mapping, allocationFactor: "1" }));
  removed.components = removed.components.filter(
    (component) => component.lineId === ids.lineA,
  );
  const removal = compareVerifiedBoqApprovedStates(
    approved(mixedInput()),
    approved(removed),
  );
  assert.equal(removal.status, "comparable");
  assert.equal(
    removal.rows.find((row) => row.itemCode === "002-B").rowState,
    "removed",
  );
  assert.deepEqual(
    removal.rows.find((row) => row.itemCode === "002-B").causes,
    [
      { cause: "MAPPING", amountDeltaKrw: "-369" },
      { cause: "ADJUSTMENT", amountDeltaKrw: "0" },
      { cause: "PRICE", amountDeltaKrw: "0" },
    ],
  );

  const addition = compareVerifiedBoqApprovedStates(
    approved(removed),
    approved(mixedInput()),
  );
  assert.equal(addition.status, "comparable");
  assert.equal(
    addition.rows.find((row) => row.itemCode === "002-B").rowState,
    "added",
  );
  assert.deepEqual(
    addition.rows.find((row) => row.itemCode === "002-B").causes,
    [
      { cause: "MAPPING", amountDeltaKrw: "0" },
      { cause: "ADJUSTMENT", amountDeltaKrw: "0" },
      { cause: "PRICE", amountDeltaKrw: "369" },
    ],
  );
  for (const row of [...removal.rows, ...addition.rows])
    assert.ok(
      row.causes.every((cause) =>
        ["RAW", "MAPPING", "ADJUSTMENT", "PRICE", "FORMULA"].includes(
          cause.cause,
        ),
      ),
    );
});

test("a brand-new source and row enters RAW before mapping and price", () => {
  const previous = mixedInput();
  const current = mixedInput();
  current.lines.push({
    id: "00000000-0000-4000-8000-000000000a01",
    sectionCode: "S",
    itemCode: "003-C",
    itemName: "신규",
    specification: "",
    unit: "EA",
    signedAdjustment: "0",
    adjustmentReason: "",
  });
  current.drawingMappings.push({
    id: "00000000-0000-4000-8000-000000000a02",
    lineId: "00000000-0000-4000-8000-000000000a01",
    quantityLinkId: "00000000-0000-4000-8000-000000000a03",
    allocationFactor: "1",
    source: {
      ...drawingSource(),
      quantityLinkId: "00000000-0000-4000-8000-000000000a03",
      revisionId: "00000000-0000-4000-8000-000000000a04",
      objectId: "00000000-0000-4000-8000-000000000a05",
      lineageId: "00000000-0000-4000-8000-000000000a06",
      measurementKind: "count",
      rawQuantity: "2",
      unit: "EA",
      snapshotSha256: "c".repeat(64),
      objectFingerprint: "d".repeat(64),
      measurementRuleVersion: "P4_MEASUREMENT_V1",
    },
  });
  current.resources.push({
    id: "00000000-0000-4000-8000-000000000a07",
    code: "R-C",
    type: "material",
    unit: "EA",
    unitPriceKrw: "50",
  });
  current.components.push({
    id: "00000000-0000-4000-8000-000000000a08",
    lineId: "00000000-0000-4000-8000-000000000a01",
    resourceId: "00000000-0000-4000-8000-000000000a07",
    coefficient: "1",
  });
  const comparison = compareVerifiedBoqApprovedStates(
    approved(previous),
    approved(current),
  );
  assert.equal(comparison.status, "comparable");
  assert.deepEqual(
    comparison.rows.find((row) => row.itemCode === "003-C").causes,
    [
      { cause: "RAW", amountDeltaKrw: "0" },
      { cause: "MAPPING", amountDeltaKrw: "0" },
      { cause: "ADJUSTMENT", amountDeltaKrw: "0" },
      { cause: "PRICE", amountDeltaKrw: "100" },
    ],
  );
});

test("comparison ignores regenerated database IDs and byte-sorts business item codes", () => {
  const previousInput = mixedInput();
  previousInput.lines[0].itemCode = "A-002";
  previousInput.lines[1].itemCode = "가-001";
  const current = structuredClone(previousInput);
  current.versionId = "00000000-0000-4000-8000-000000000011";
  const lineIds = new Map([
    [ids.lineA, "00000000-0000-4000-8000-000000000111"],
    [ids.lineB, "00000000-0000-4000-8000-000000000112"],
  ]);
  for (const line of current.lines) line.id = lineIds.get(line.id);
  for (const mapping of current.legacyMappings) {
    mapping.id = "00000000-0000-4000-8000-000000000611";
    mapping.lineId = lineIds.get(mapping.lineId);
  }
  for (const [index, mapping] of current.drawingMappings.entries()) {
    mapping.id = `00000000-0000-4000-8000-00000000062${index + 1}`;
    mapping.lineId = lineIds.get(mapping.lineId);
    mapping.quantityLinkId = "00000000-0000-4000-8000-000000000211";
    mapping.source.quantityLinkId = mapping.quantityLinkId;
  }
  current.priceBook.id = "00000000-0000-4000-8000-000000000711";
  current.priceBook.sourceFileId = "00000000-0000-4000-8000-000000000712";
  current.resources[0].id = "00000000-0000-4000-8000-000000000811";
  for (const [index, component] of current.components.entries()) {
    component.id = `00000000-0000-4000-8000-00000000091${index + 1}`;
    component.lineId = lineIds.get(component.lineId);
    component.resourceId = current.resources[0].id;
  }
  const comparison = compareVerifiedBoqApprovedStates(
    approved(previousInput),
    approved(current),
  );
  assert.equal(comparison.status, "comparable");
  assert.deepEqual(
    comparison.rows.map((row) => [row.itemCode, row.rowState, row.causes]),
    [
      ["A-002", "unchanged", []],
      ["가-001", "unchanged", []],
    ],
  );
});

test("1.0 to 1.1 replay exposes the engine switch only as FORMULA", () => {
  const legacy = legacyInput();
  const current = {
    ...structuredClone(legacy),
    engineVersion: "VERIFIED-BOQ-1.1",
    legacyMappings: structuredClone(legacy.mappings),
    drawingMappings: [],
    priceBook: structuredClone(mixedInput().priceBook),
  };
  delete current.mappings;
  const comparison = compareVerifiedBoqApprovedStates(
    approved(legacy, "VERIFIED-BOQ-1.0"),
    approved(current),
  );
  assert.equal(comparison.status, "comparable");
  assert.equal(comparison.amountDeltaKrw, "0");
  assert.deepEqual(
    comparison.rows.flatMap((row) => row.causes),
    [{ cause: "FORMULA", amountDeltaKrw: "0" }],
  );
});

test("comparison fails closed for unavailable engines ambiguous rows and invalid counterfactuals", () => {
  const base = approved(mixedInput());
  const unavailable = structuredClone(base);
  unavailable.engineVersion = "VERIFIED-BOQ-9.9";
  assert.deepEqual(compareVerifiedBoqApprovedStates(unavailable, base), {
    status: "review",
    rows: [],
    amountDeltaKrw: "0",
    causeAmountDeltaKrw: "0",
    rowAmountDeltaKrw: "0",
    amountCloses: false,
    message: "승인 내역 변경 원인을 자동 재현할 수 없습니다.",
  });

  const duplicate = structuredClone(base);
  duplicate.input.lines[1].itemCode = duplicate.input.lines[0].itemCode;
  assert.equal(
    compareVerifiedBoqApprovedStates(base, duplicate).status,
    "review",
  );

  const invalid = structuredClone(base);
  invalid.input.lines[0].signedAdjustment = "-999999";
  assert.equal(
    compareVerifiedBoqApprovedStates(base, invalid).status,
    "review",
  );
});

test("comparison rejects non-approved or tampered historical results", () => {
  const prior = approved(mixedInput());
  const draft = { ...approved(mixedInput()), status: "in_review" };
  assert.equal(compareVerifiedBoqApprovedStates(prior, draft).status, "review");
  const tampered = structuredClone(prior);
  tampered.result.directCostKrw = "999999";
  assert.equal(
    compareVerifiedBoqApprovedStates(tampered, prior).status,
    "review",
  );
});

test("stored approved hashes must match the exact historical replay", () => {
  const input = {
    engineVersion: "VERIFIED-BOQ-1.1",
    stored: {
      inputStateSha256: A,
      resultSha256: B,
      manifestSha256: C,
      directCostKrw: "2357",
      lineCount: 2,
    },
    replayed: {
      inputStateSha256: A,
      resultSha256: B,
      manifestSha256: C,
      directCostKrw: "2357",
      lineCount: 2,
    },
  };
  assert.equal(verifiedBoqStoredReplayMatches(input), true);
  assert.equal(
    verifiedBoqStoredReplayMatches({
      ...input,
      stored: { ...input.stored, directCostKrw: "2357.000000" },
    }),
    true,
  );
  for (const mutate of [
    (value) => (value.stored.inputStateSha256 = D),
    (value) => (value.stored.resultSha256 = D),
    (value) => (value.stored.manifestSha256 = D),
    (value) => (value.stored.directCostKrw = "2358"),
    (value) => (value.stored.lineCount = 3),
  ]) {
    const stale = structuredClone(input);
    mutate(stale);
    assert.equal(verifiedBoqStoredReplayMatches(stale), false);
  }
});
