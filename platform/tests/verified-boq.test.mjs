import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  buildVerifiedBoqCsv,
  calculateVerifiedBoq,
} from "../app/lukas/lib/verified-boq.server.ts";
import { buildVerifiedBoqXlsx } from "../app/lukas/lib/verified-boq-xlsx.server.ts";
import { compareVerifiedBoq } from "../app/lukas/lib/verified-boq-comparison.server.ts";
import {
  assertVerifiedBoqSourceCoverage,
  listVerifiedBoqSources,
  resolveVerifiedBoqSource,
} from "../app/lukas/lib/verified-boq-source.server.ts";
import {
  buildVerifiedBoqPriceBookTemplateCsv,
  parseVerifiedBoqPriceBook,
} from "../app/lukas/lib/verified-boq-pricebook.server.ts";
import {
  buildVerifiedBoqStructureTemplateCsv,
  parseVerifiedBoqStructure,
} from "../app/lukas/lib/verified-boq-structure.server.ts";
import {
  exactToString,
  multiplyExact,
  parseExactDecimal,
  roundExact,
} from "../app/lukas/lib/exact-decimal.server.ts";

function goldenInput(policy = "general_half_away") {
  return {
    versionId: "boq-v1",
    calculationPolicy: policy,
    quantityScale: 6,
    lines: [
      {
        id: "line-1",
        sectionCode: "01",
        itemCode: "CONC-001",
        itemName: "콘크리트",
        specification: "25-270-15",
        unit: "m3",
        signedAdjustment: "0",
        adjustmentReason: "",
      },
    ],
    mappings: [
      {
        id: "mapping-1",
        lineId: "line-1",
        sourceFileId: "qto-file-1",
        sourceSha256: "a".repeat(64),
        subjectKey: "WALL-CONCRETE",
        sourceQuantity: "10",
        factor: "1",
        unit: "m3",
        elementIds: ["1001", "1002"],
      },
    ],
    resources: [
      { id: "r-m", code: "M-001", type: "material", unitPriceKrw: "100000" },
      { id: "r-l", code: "L-001", type: "labor", unitPriceKrw: "10000" },
      { id: "r-e", code: "E-001", type: "expense", unitPriceKrw: "5000" },
    ],
    components: [
      { id: "c-m", lineId: "line-1", resourceId: "r-m", coefficient: "1" },
      { id: "c-l", lineId: "line-1", resourceId: "r-l", coefficient: "1" },
      { id: "c-e", lineId: "line-1", resourceId: "r-e", coefficient: "1" },
    ],
  };
}

test("verified BOQ closes the 10m3 direct-cost golden vector with source evidence", () => {
  const result = calculateVerifiedBoq(goldenInput());
  assert.equal(result.status, "calculated");
  assert.equal(result.directCostKrw, "1150000");
  assert.equal(result.lines[0].rawQuantity, "10");
  assert.equal(result.lines[0].totalUnitPriceKrw, "115000");
  assert.equal(result.lines[0].amountKrw, "1150000");
  assert.deepEqual(result.lines[0].elementIds, ["1001", "1002"]);
  assert.match(result.canonicalSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(calculateVerifiedBoq(goldenInput()), result);
});

test("Verified BOQ 1.0 result, CSV, and XLSX bytes stay frozen", () => {
  const result = calculateVerifiedBoq(goldenInput());
  assert.equal(
    JSON.stringify(result),
    '{"engineVersion":"VERIFIED-BOQ-1.0","versionId":"boq-v1","calculationPolicy":"general_half_away","status":"calculated","lines":[{"lineId":"line-1","sectionCode":"01","itemCode":"CONC-001","itemName":"콘크리트","specification":"25-270-15","unit":"m3","adjustment":"0","status":"calculated","rawQuantity":"10","finalQuantity":"10","materialUnitPriceKrw":"100000","laborUnitPriceKrw":"10000","expenseUnitPriceKrw":"5000","totalUnitPriceKrw":"115000","amountKrw":"1150000","formula":"ROUND_HALF_AWAY(Q×(M+L+E),0)","sourceSha256":["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],"elementIds":["1001","1002"],"message":"계산 가능"}],"directCostKrw":"1150000","exclusions":[],"canonicalSha256":"55baa46f10c6d9b087074d166daeb57ff0d0ff1d8905bb4ec95a1949e1ea4f6a"}',
  );
  assert.equal(
    result.canonicalSha256,
    "55baa46f10c6d9b087074d166daeb57ff0d0ff1d8905bb4ec95a1949e1ea4f6a",
  );
  assert.equal(
    createHash("sha256").update(buildVerifiedBoqCsv(result)).digest("hex"),
    "c194a5b8fd1add317a9cf5e81ed9d809b4288241049af653a8c4c5a0893465f8",
  );
  const oldTimezone = process.env.TZ;
  process.env.TZ = "Asia/Seoul";
  const RealDate = globalThis.Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(args.length ? args[0] : "2026-08-28T00:00:00.000Z");
    }

    static now() {
      return new RealDate("2026-08-28T00:00:00.000Z").valueOf();
    }
  };
  try {
    assert.equal(
      createHash("sha256")
        .update(
          buildVerifiedBoqXlsx({
            result,
            resources: [
              {
                code: "M-001",
                type: "material",
                name: "레미콘",
                specification: "25-270-15",
                unit: "m3",
                unitPriceKrw: "100000",
              },
            ],
            mappings: [
              {
                itemCode: "CONC-001",
                sourceFilename: "원수량.csv",
                sourceSha256: "a".repeat(64),
                subjectKey: "WALL-CONCRETE",
                sourceQuantity: "10",
                factor: "1",
                unit: "m3",
                elementIds: ["1001", "1002"],
              },
            ],
            structures: [
              {
                itemCode: "CONC-001",
                cbsCode: "01",
                cbsName: "철근콘크리트",
                wbsCode: "A-01",
                wbsName: "본관 1층",
                allocationPercent: "100",
              },
            ],
            review: {
              projectName: "유치원",
              versionLabel: "V1",
              status: "draft",
              makerId: "maker",
              approvals: [],
            },
          }),
        )
        .digest("hex"),
      "89d84aff9f892d1bf243736e0def67ebe15785ecfd44d2abf7424cd03e81419c",
    );
  } finally {
    globalThis.Date = RealDate;
    if (oldTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = oldTimezone;
  }
});

test("general and EMS policies use their documented rounding order", () => {
  const general = goldenInput("general_half_away");
  general.mappings[0].sourceQuantity = "1.5";
  general.resources = [
    { id: "r-m", code: "M", type: "material", unitPriceKrw: "1" },
    { id: "r-l", code: "L", type: "labor", unitPriceKrw: "1" },
    { id: "r-e", code: "E", type: "expense", unitPriceKrw: "1" },
  ];
  assert.equal(calculateVerifiedBoq(general).directCostKrw, "5");
  const ems = structuredClone(general);
  ems.calculationPolicy = "ems_component_truncate";
  assert.equal(calculateVerifiedBoq(ems).directCostKrw, "3");
});

test("exact decimal multiplication and half-away/truncate never use Number", () => {
  const product = multiplyExact(
    parseExactDecimal("9007199254740992.00000001"),
    parseExactDecimal("0.00000001"),
  );
  assert.equal(exactToString(product), "90071992.5474099200000001");
  assert.equal(
    exactToString(
      roundExact(parseExactDecimal("-1.5"), 0, "half_away_from_zero"),
    ),
    "-2",
  );
  assert.equal(
    exactToString(roundExact(parseExactDecimal("-1.9"), 0, "truncate")),
    "-1",
  );
});

test("duplicate allocation, unit mismatch and missing adjustment reason fail closed", () => {
  const duplicate = goldenInput();
  duplicate.mappings.push({
    ...duplicate.mappings[0],
    id: "mapping-2",
    lineId: "line-1",
    subjectKey: "WALL-CONCRETE",
    factor: "0.1",
  });
  assert.throws(() => calculateVerifiedBoq(duplicate), /계수 합계는 정확히 1/);

  const partial = goldenInput();
  partial.mappings[0].factor = "0.5";
  assert.throws(() => calculateVerifiedBoq(partial), /계수 합계는 정확히 1/);

  const unit = goldenInput();
  unit.mappings[0].unit = "m2";
  assert.throws(() => calculateVerifiedBoq(unit), /단위가 다릅니다/);

  const adjustment = goldenInput();
  adjustment.lines[0].signedAdjustment = "-1";
  assert.throws(() => calculateVerifiedBoq(adjustment), /보정 사유/);
});

test("split mappings close at 100 percent and exclusions remain in the result hash", () => {
  const split = goldenInput();
  split.mappings[0].factor = "0.5";
  split.lines.push({
    ...split.lines[0],
    id: "line-2",
    itemCode: "CONC-002",
  });
  split.mappings.push({
    ...split.mappings[0],
    id: "mapping-2",
    lineId: "line-2",
    factor: "0.5",
  });
  split.components.push({
    id: "c-m-2",
    lineId: "line-2",
    resourceId: "r-m",
    coefficient: "1",
  });
  const result = calculateVerifiedBoq(split);
  assert.deepEqual(
    result.lines.map((line) => line.rawQuantity),
    ["5", "5"],
  );

  const excluded = goldenInput();
  excluded.exclusions = [
    {
      id: "excluded-1",
      sourceFileId: "qto-file-2",
      sourceSha256: "b".repeat(64),
      subjectKey: "ROOF-TILE",
      sourceQuantity: "12.5",
      unit: "m2",
      elementIds: ["2001"],
      reason: "이번 직접공사비 범위에서 제외",
    },
  ];
  const excludedResult = calculateVerifiedBoq(excluded);
  assert.equal(excludedResult.exclusions.length, 1);
  assert.notEqual(excludedResult.canonicalSha256, result.canonicalSha256);
  assert.match(buildVerifiedBoqCsv(excludedResult), /EXCLUDE_WITH_REASON/);

  excluded.exclusions[0].sourceFileId = "qto-file-1";
  excluded.exclusions[0].subjectKey = "WALL-CONCRETE";
  excluded.exclusions[0].unit = "m3";
  assert.throws(
    () => calculateVerifiedBoq(excluded),
    /동시에 제외할 수 없습니다/,
  );
});

test("one source row can independently supply volume and area quantities", () => {
  const input = goldenInput();
  input.lines.push({
    ...input.lines[0],
    id: "line-area",
    itemCode: "FORM-001",
    itemName: "거푸집",
    unit: "m2",
  });
  input.mappings.push({
    ...input.mappings[0],
    id: "mapping-area",
    lineId: "line-area",
    sourceQuantity: "12.5",
    unit: "m2",
  });
  input.components.push({
    id: "component-area",
    lineId: "line-area",
    resourceId: "r-m",
    coefficient: "1",
  });
  assert.deepEqual(
    calculateVerifiedBoq(input).lines.map((line) => line.rawQuantity),
    ["10", "12.5"],
  );
});

test("incomplete lines stay review and CSV neutralizes spreadsheet formulas", () => {
  const input = goldenInput();
  input.lines[0].itemName = '=HYPERLINK("https://invalid")';
  input.components = [];
  const result = calculateVerifiedBoq(input);
  assert.equal(result.status, "review");
  assert.equal(result.lines[0].amountKrw, null);
  const csv = buildVerifiedBoqCsv(result);
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /'=HYPERLINK/);
});

test("Excel export contains five evidence sheets and stores user text as inline strings", () => {
  const result = calculateVerifiedBoq(goldenInput());
  result.lines[0].itemName = "=SUM(1,1)";
  const archive = unzipSync(
    buildVerifiedBoqXlsx({
      result,
      resources: [
        {
          code: "M-001",
          type: "material",
          name: "레미콘",
          specification: "25-270-15",
          unit: "m3",
          unitPriceKrw: "100000",
        },
      ],
      mappings: [
        {
          itemCode: "CONC-001",
          sourceFilename: "원수량.csv",
          sourceSha256: "a".repeat(64),
          subjectKey: "WALL-CONCRETE",
          sourceQuantity: "10",
          factor: "1",
          unit: "m3",
          elementIds: ["1001", "1002"],
        },
      ],
      structures: [
        {
          itemCode: "CONC-001",
          cbsCode: "01",
          cbsName: "철근콘크리트",
          wbsCode: "A-01",
          wbsName: "본관 1층",
          allocationPercent: "100",
        },
      ],
      review: {
        projectName: "유치원",
        versionLabel: "V1",
        status: "draft",
        makerId: "maker",
        approvals: [],
      },
    }),
  );
  const workbook = strFromU8(archive["xl/workbook.xml"]);
  assert.match(workbook, /name="공종별내역서"/);
  assert.match(workbook, /name="자원단가"/);
  assert.match(workbook, /name="매핑근거"/);
  assert.match(workbook, /name="검토정보"/);
  assert.match(workbook, /name="WBS-CBS"/);
  const boqSheet = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  assert.match(boqSheet, /t="inlineStr"/);
  assert.match(boqSheet, /=SUM\(1,1\)/);
  assert.doesNotMatch(boqSheet, /<f>/);
});

test("revision comparison classifies changes and closes the total amount delta", () => {
  const previous = calculateVerifiedBoq(goldenInput());
  const currentInput = goldenInput();
  currentInput.versionId = "boq-v2";
  currentInput.mappings[0].sourceQuantity = "12";
  currentInput.resources[0].unitPriceKrw = "110000";
  const current = calculateVerifiedBoq(currentInput);
  const comparison = compareVerifiedBoq(previous, current);
  assert.equal(comparison.status, "comparable");
  assert.equal(comparison.amountCloses, true);
  assert.deepEqual(comparison.rows[0].changes, [
    "QTY_CHANGED",
    "PRICE_CHANGED",
  ]);
  assert.equal(comparison.quantityDeltaByUnit.m3, "2");
  assert.equal(comparison.amountDeltaKrw, "350000");
  assert.equal(comparison.rowAmountDeltaKrw, "350000");
});

test("revision comparison accounts for added and removed rows without hiding deltas", () => {
  const previous = calculateVerifiedBoq(goldenInput());
  const currentInput = goldenInput();
  currentInput.versionId = "boq-v2";
  currentInput.lines[0].itemCode = "CONC-NEW";
  const current = calculateVerifiedBoq(currentInput);
  const comparison = compareVerifiedBoq(previous, current);
  assert.deepEqual(
    comparison.rows.map((row) => row.changes[0]),
    ["REMOVED", "ADDED"],
  );
  assert.equal(comparison.amountCloses, true);
  assert.equal(comparison.amountDeltaKrw, "0");
});

test("verified BOQ migration separates immutable sources, drafts and approvals", () => {
  const sql = readFileSync(
    new URL(
      "../supabase/migrations/20260820025118_verified_boq_v1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  for (const table of [
    "lukas_qto_price_books",
    "lukas_qto_price_resources",
    "lukas_qto_boq_versions",
    "lukas_qto_boq_sections",
    "lukas_qto_boq_wbs_nodes",
    "lukas_qto_boq_wbs_allocations",
    "lukas_qto_boq_lines",
    "lukas_qto_boq_quantity_mappings",
    "lukas_qto_boq_source_exclusions",
    "lukas_qto_boq_rate_components",
    "lukas_qto_boq_approvals",
  ]) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
  }
  assert.match(sql, /maker cannot approve their own version/i);
  assert.match(sql, /Only a draft BOQ version can be edited/);
  assert.match(sql, /Only the BOQ maker can edit a draft version/);
  assert.match(sql, /Only the BOQ maker can edit draft rows/);
  assert.match(
    sql,
    /pg_get_constraintdef\(oid\) = 'UNIQUE \(id, project_id, sha256\)'/,
  );
  assert.match(sql, /lukas_qto_decide_boq/);
  assert.match(sql, /lukas_qto_import_boq_structure/);
  assert.match(sql, /BOQ structure import requires an empty draft version/);
  assert.match(sql, /cannot be both mapped and excluded/);
  assert.match(sql, /exactly 100 percent WBS allocation/);
  assert.match(sql, /CBS hierarchy cannot contain a cycle/);
  assert.match(sql, /VERIFIED-BOQ-1\.0/);
  assert.match(sql, /revoke all on table[\s\S]+from anon,authenticated/);
});

test("verified BOQ RPCs reject anonymous execution and use the hardened project-role helper", () => {
  const base = readFileSync(
    new URL(
      "../supabase/migrations/20260820025118_verified_boq_v1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const hardening = readFileSync(
    new URL(
      "../supabase/migrations/20260820040254_verified_boq_security_hardening.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(base, /public\.lukas_qto_project_role\(/);
  assert.match(base, /private\.lukas_qto_project_role\(/);
  assert.match(
    hardening,
    /revoke all on function public\.lukas_qto_decide_boq\(uuid,text,text\) from public,anon/,
  );
  assert.match(
    hardening,
    /revoke all on function public\.lukas_qto_import_boq_structure\(uuid,jsonb\) from public,anon/,
  );
  assert.match(
    hardening,
    /return private\.lukas_qto_project_role\(\(\(storage\.foldername\(p_name\)\)\[2\]\)::uuid\)/,
  );
});

test("QTO mapping values are derived from immutable CSV rows instead of form input", () => {
  const csv = [
    "검산키,분류,패밀리,타입,레벨,수량,체적_m3,면적_m2,길이_m,요소ID",
    "9C5BC3B6F055579833928FF128369A39BB1D295F393389F41ABEC2515BDAB30F,벽,기본 벽,콘크리트 벽,L1,2,10,12.5,0,1001|1002",
  ].join("\r\n");
  assert.deepEqual(
    resolveVerifiedBoqSource(
      new TextEncoder().encode(csv),
      "qto_csv",
      "9c5bc3b6f055579833928ff128369a39bb1d295f393389f41abec2515bdab30f",
      "m3",
    ),
    {
      subjectKey:
        "9C5BC3B6F055579833928FF128369A39BB1D295F393389F41ABEC2515BDAB30F",
      quantity: "10",
      unit: "m3",
      elementIds: ["1001", "1002"],
    },
  );
});

test("every positive source row needs a mapping or an explicit exclusion", () => {
  const csv = [
    "검산키,분류,패밀리,타입,레벨,수량,체적_m3,면적_m2,길이_m,요소ID",
    "9C5BC3B6F055579833928FF128369A39BB1D295F393389F41ABEC2515BDAB30F,벽,기본 벽,콘크리트 벽,L1,2,10,12.5,0,1001|1002",
    "7FBB5F17DC75AB23659FFDF0BE85BA0EB9DC97B389596985B8F88CC8668372CF,바닥,기본 바닥,콘크리트 바닥,L1,1,3,8,0,1003",
  ].join("\n");
  const bytes = new TextEncoder().encode(csv);
  const sources = listVerifiedBoqSources(bytes, "qto_csv", "m3");
  assert.equal(sources.length, 2);
  assert.throws(
    () => assertVerifiedBoqSourceCoverage(sources, [sources[0]]),
    /양수 원수량 1건.*첫 누락/,
  );
  assert.doesNotThrow(() =>
    assertVerifiedBoqSourceCoverage(sources, [sources[0], sources[1]]),
  );
  assert.throws(
    () =>
      assertVerifiedBoqSourceCoverage(sources, [
        { ...sources[0], quantity: "999" },
        sources[1],
      ]),
    /저장된 원수량 근거가 현재 원본과 다릅니다/,
  );
});

test("element ledger mapping requires an explicit computed measurement basis", () => {
  const csv = [
    "element_id,category,family,type,element_name,level,volume_state,volume_m3,volume_source_parameter,length_state,length_m,length_source_parameter,height_state,height_m,height_source_parameter",
    "01001,벽,기본 벽,콘크리트 벽,벽 1,L1,COMPUTED,3.25,HOST_VOLUME_COMPUTED,ZERO,0,CURVE_ELEM_LENGTH,MISSING,,",
  ].join("\n");
  const resolved = resolveVerifiedBoqSource(
    new TextEncoder().encode(csv),
    "element_ledger",
    "element:1001:volume",
    "m3",
  );
  assert.equal(resolved.quantity, "3.25");
  assert.deepEqual(resolved.elementIds, ["1001"]);
  assert.throws(
    () =>
      resolveVerifiedBoqSource(
        new TextEncoder().encode(csv),
        "element_ledger",
        "element:1001:height",
        "m",
      ),
    /계산된 원본 값이 아닙니다/,
  );
});

test("tampered QTO metadata is rejected even when its file hash is registered", () => {
  const csv = [
    "검산키,분류,패밀리,타입,레벨,수량,체적_m3,면적_m2,길이_m,요소ID",
    "9C5BC3B6F055579833928FF128369A39BB1D295F393389F41ABEC2515BDAB30F,변조,기본 벽,콘크리트 벽,L1,2,10,12.5,0,1001|1001",
  ].join("\n");
  assert.throws(
    () =>
      resolveVerifiedBoqSource(
        new TextEncoder().encode(csv),
        "qto_csv",
        "9C5BC3B6F055579833928FF128369A39BB1D295F393389F41ABEC2515BDAB30F",
        "m3",
      ),
    /검산키.*일치하지 않습니다/,
  );
});

test("an invalid unselected QTO row invalidates the whole evidence file", () => {
  const csv = [
    "검산키,분류,패밀리,타입,레벨,수량,체적_m3,면적_m2,길이_m,요소ID",
    "9C5BC3B6F055579833928FF128369A39BB1D295F393389F41ABEC2515BDAB30F,벽,기본 벽,콘크리트 벽,L1,2,10,12.5,0,1001|1002",
    "9C5BC3B6F055579833928FF128369A39BB1D295F393389F41ABEC2515BDAB30F,벽,기본 벽,콘크리트 벽,L1,1,1,1,1,1002",
  ].join("\n");
  assert.throws(
    () =>
      resolveVerifiedBoqSource(
        new TextEncoder().encode(csv),
        "qto_csv",
        "9C5BC3B6F055579833928FF128369A39BB1D295F393389F41ABEC2515BDAB30F",
        "m3",
      ),
    /검산키가 없거나 중복되었습니다|중복 Element ID/,
  );
});

test("BOQ mapping action never accepts quantity, unit, or element IDs from the browser form", () => {
  const route = readFileSync(
    new URL("../app/lukas/screens/verified-boq.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(route, /name="source_quantity"/);
  assert.doesNotMatch(route, /name="element_ids"/);
  assert.match(route, /resolveVerifiedBoqSource\(/);
  assert.match(route, /sha256Bytes\(sourceBytes\) !== sourceSha256/);
});

test("BOQ evidence opens the confirmed IFC GlobalId instead of assuming Revit and IFC IDs match", () => {
  const boqRoute = readFileSync(
    new URL("../app/lukas/screens/verified-boq.tsx", import.meta.url),
    "utf8",
  );
  const ifcRoute = readFileSync(
    new URL("../app/lukas/screens/ifc-browser.tsx", import.meta.url),
    "utf8",
  );
  const browser = readFileSync(
    new URL(
      "../app/lukas/components/ifc-property-browser.client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(boqRoute, /lukas_qto_element_identity_links/);
  assert.match(boqRoute, /\?globalId=\$\{encodeURIComponent/);
  assert.match(ifcRoute, /requestedGlobalId/);
  assert.match(browser, /element\.globalId === initialGlobalId/);
  assert.doesNotMatch(boqRoute, /\?element=\$\{/);
});

test("IFC browser route exposes only a verified derivative render bundle", () => {
  const ifcRoute = readFileSync(
    new URL("../app/lukas/screens/ifc-browser.tsx", import.meta.url),
    "utf8",
  );
  assert.match(ifcRoute, /loadDrawingIfcDerivative\(/);
  assert.match(ifcRoute, /adaptIfcRenderBundleDescriptor\(/);
  assert.match(ifcRoute, /renderBundle=\{loaderData\.renderBundle\}/);
  assert.doesNotMatch(ifcRoute, /createSignedUrl\(file\.storage_path/);
  assert.doesNotMatch(ifcRoute, /signedUrl=\{loaderData\.signedUrl\}/);
  assert.doesNotMatch(ifcRoute, /file\.byte_size > 200 \* 1024 \* 1024/);
});

test("IFC derivative generation is non-destructive while failure remains distinct", () => {
  const browser = readFileSync(
    new URL(
      "../app/lukas/components/ifc-property-browser.client.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    browser,
    /const generating = derivative\?\.status === "pending"/,
  );
  assert.match(browser, /setViewerPhase\(generating \? "loading" : "error"\)/);
  assert.match(browser, /setError\(generating \? null : message\)/);
  assert.doesNotMatch(browser, /byteSize/);
});

test("project file rows defer original-file capabilities to the authenticated download route", () => {
  const projectRoute = readFileSync(
    new URL("../app/lukas/screens/project.tsx", import.meta.url),
    "utf8",
  );
  const downloadRoute = readFileSync(
    new URL("../app/lukas/screens/project-file-download.ts", import.meta.url),
    "utf8",
  );
  const projectLoader = projectRoute.slice(
    projectRoute.indexOf("export async function loader"),
    projectRoute.indexOf("export async function action"),
  );
  assert.doesNotMatch(projectRoute, /signedUrls/);
  assert.doesNotMatch(projectRoute, /createSignedUrl\(file\.storage_path/);
  assert.doesNotMatch(projectLoader, /storage_path/);
  assert.match(
    projectRoute,
    /\/projects\/\$\{loaderData\.project\.id\}\/files\/\$\{file\.id\}\/download/,
  );
  assert.match(
    downloadRoute,
    /drawingContext\(\s*request,\s*params\.projectId!/,
  );
  assert.match(downloadRoute, /resolveProjectFileDownload/);
});

test("customer-owned price resources import from strict UTF-8 CSV", () => {
  const csv = buildVerifiedBoqPriceBookTemplateCsv().replace(
    "M-001,material,콘크리트,25-270-15,m3,0",
    'M-001,material,"콘크리트, 레미콘",25-270-15,m3,120000.125',
  );
  assert.deepEqual(
    parseVerifiedBoqPriceBook(new TextEncoder().encode(csv), "단가표.csv"),
    [
      {
        resourceCode: "M-001",
        resourceType: "material",
        resourceName: "콘크리트, 레미콘",
        specification: "25-270-15",
        unit: "m3",
        unitPriceKrw: "120000.125",
      },
    ],
  );
});

test("customer-owned price resources import from a formula-free XLSX first sheet", () => {
  const cells = [
    [
      "resource_code",
      "resource_type",
      "resource_name",
      "specification",
      "unit",
      "unit_price_krw",
    ],
    ["L-001", "labor", "보통인부", "", "day", "180000"],
  ];
  const sheetRows = cells
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => {
            const column = String.fromCharCode(65 + columnIndex);
            return `<c r="${column}${rowIndex + 1}" t="inlineStr"><is><t>${value}</t></is></c>`;
          })
          .join("")}</row>`,
    )
    .join("");
  const workbook = zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="단가" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`,
    ),
  });
  assert.deepEqual(parseVerifiedBoqPriceBook(workbook, "단가표.xlsx"), [
    {
      resourceCode: "L-001",
      resourceType: "labor",
      resourceName: "보통인부",
      specification: "",
      unit: "day",
      unitPriceKrw: "180000",
    },
  ]);
});

test("price-book import rejects duplicate resource codes and negative prices", () => {
  const duplicate = [
    "resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
    "M,material,A,,EA,1",
    "M,material,B,,EA,-1",
  ].join("\n");
  assert.throws(
    () =>
      parseVerifiedBoqPriceBook(
        new TextEncoder().encode(duplicate),
        "rates.csv",
      ),
    /중복되었습니다/,
  );
  const negative = [
    "resource_code,resource_type,resource_name,specification,unit,unit_price_krw",
    "M,material,A,,EA,-1",
  ].join("\n");
  assert.throws(
    () =>
      parseVerifiedBoqPriceBook(
        new TextEncoder().encode(negative),
        "rates.csv",
      ),
    /음수일 수 없습니다/,
  );
});

test("price-book XLSX import rejects formula cells even with cached values", () => {
  const formulaWorkbook = zipSync({
    "xl/workbook.xml": strToU8(
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="단가" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>resource_code</t></is></c></row><row r="2"><c r="A2"><f>1+1</f><v>2</v></c></row></sheetData></worksheet>',
    ),
  });
  assert.throws(
    () => parseVerifiedBoqPriceBook(formulaWorkbook, "rates.xlsx"),
    /Excel 수식을 사용할 수 없습니다/,
  );
});

test("CBS WBS and item structure imports from one strict customer-owned table", () => {
  const imported = parseVerifiedBoqStructure(
    new TextEncoder().encode(buildVerifiedBoqStructureTemplateCsv()),
    "내역체계.csv",
  );
  assert.deepEqual(imported.sections, [{ code: "01", name: "건축공사" }]);
  assert.deepEqual(imported.wbsNodes, [
    { parentCode: "", code: "W01", name: "본관" },
  ]);
  assert.equal(imported.items[0].code, "CONC-001");
  assert.equal(imported.items[0].wbsAllocationPercent, "100");
});

test("structure import rejects orphan WBS and unreasoned quantity adjustment", () => {
  const orphan = buildVerifiedBoqStructureTemplateCsv().replace(
    "WBS,,W01",
    "WBS,MISSING,W01",
  );
  assert.throws(
    () =>
      parseVerifiedBoqStructure(
        new TextEncoder().encode(orphan),
        "내역체계.csv",
      ),
    /WBS 상위 코드를 찾지 못했습니다/,
  );
  const adjustment = buildVerifiedBoqStructureTemplateCsv().replace(
    "m3,0,,01",
    "m3,-1,,01",
  );
  assert.throws(
    () =>
      parseVerifiedBoqStructure(
        new TextEncoder().encode(adjustment),
        "내역체계.csv",
      ),
    /보정 사유가 필요합니다/,
  );
});
