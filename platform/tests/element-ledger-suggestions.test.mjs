import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { strFromU8, unzipSync } from "fflate";

import {
  buildElementLedgerRevisionSuggestions,
  buildElementLedgerSuggestions,
  parseCsv,
} from "../app/lukas/lib/element-ledger-suggestions.server.ts";
import {
  resolveConcreteTakeoffInputs,
  verifyConcreteTakeoffBundle,
} from "../app/lukas/lib/concrete-takeoff-artifact.server.ts";
import {
  buildSuggestionEvaluation,
  buildSuggestionFeedbackExport,
} from "../app/lukas/lib/suggestion-feedback.server.ts";
import {
  resolvePreflightInputs,
  verifyPreflightBundle,
} from "../app/lukas/lib/preflight-artifact.server.ts";
import {
  buildMaterialControlSummaries,
  buildMaterialControlCsv,
  calculateRequiredQuantity,
  deriveMaterialPlansFromApprovedTakeoff,
} from "../app/lukas/lib/material-control.server.ts";
import {
  buildBcf21FromRequirementFindings,
  checkIdsAgainstElementLedger,
} from "../app/lukas/lib/information-requirements.server.ts";
import { verifyAiSuggestionImport } from "../app/lukas/lib/ai-suggestion-import.server.ts";
import { verifyElementIdentityPair } from "../app/lukas/lib/element-identity-link.server.ts";

const header =
  "element_id,category,family,type,element_name,level,volume_state,volume_m3,volume_source_parameter,length_state,length_m,length_source_parameter,height_state,height_m,height_source_parameter";

test("Revit element and IFC GlobalId confirmation is bound to both immutable files", () => {
  const ledger = new TextEncoder().encode(
    `${header}\n101,Walls,Basic Wall,200mm,Exterior,L1,COMPUTED,1.25,HOST_VOLUME_COMPUTED,MISSING,,,MISSING,,\n9223372036854775807,Walls,Basic Wall,200mm,Exterior,L1,COMPUTED,1.25,HOST_VOLUME_COMPUTED,MISSING,,,MISSING,,\n`,
  );
  const globalId = "0AbCdEfGhIjKlMnOpQrStU";
  const ifc = new TextEncoder().encode(
    `ISO-10303-21;\nDATA;\n#42=IFCWALL('${globalId}',#1,'Wall',$,$,#2,#3,$,.NOTDEFINED.);\nENDSEC;\nEND-ISO-10303-21;\n`,
  );
  const result = verifyElementIdentityPair(ledger, ifc, "101", globalId);
  assert.equal(result.category, "Walls");
  assert.equal(
    result.ledgerSha256,
    createHash("sha256").update(ledger).digest("hex"),
  );
  assert.equal(
    result.ifcSha256,
    createHash("sha256").update(ifc).digest("hex"),
  );
  assert.equal(
    verifyElementIdentityPair(ledger, ifc, "9223372036854775807", globalId)
      .revitElementId,
    "9223372036854775807",
  );
  assert.throws(
    () => verifyElementIdentityPair(ledger, ifc, "999", globalId),
    /정확히 한 번/,
  );
  assert.throws(
    () =>
      verifyElementIdentityPair(ledger, ifc, "101", "1AbCdEfGhIjKlMnOpQrStU"),
    /존재하지 않습니다/,
  );
});

test("CSV parser preserves quoted commas and automatic review stays evidence-bound", () => {
  assert.equal(parseCsv('a,"b,c"\n')[0][1], "b,c");
  const csv = `${header}\n1,Walls,Basic Wall,T1,Wall 1,L1,COMPUTED,1.5,HOST_VOLUME_COMPUTED,MISSING,,,MISSING,,\n2,,,T2,Item 2,,MISSING,,,MISSING,,,MISSING,,\n`;
  const suggestions = buildElementLedgerSuggestions(csv, "a".repeat(64));
  assert.deepEqual(
    suggestions.map((item) => item.subjectKey),
    ["missing-classification", "no-measured-property"],
  );
  assert.equal(suggestions[1].evidence.source_sha256, "a".repeat(64));
});

test("invalid measurement combinations are surfaced and never corrected", () => {
  const csv = `${header}\n7,Walls,F,T,N,L,ZERO,2,HOST_VOLUME_COMPUTED,MISSING,,,MISSING,,\n`;
  const [finding] = buildElementLedgerSuggestions(csv, "b".repeat(64));
  assert.equal(finding.subjectKey, "invalid-measurement-state");
});

test("suggestions cannot be detached from a canonical source hash", () => {
  assert.throws(
    () => buildElementLedgerSuggestions(`${header}\n`, "not-a-sha"),
    /SHA-256|파일 확인번호/,
  );
});

test("revision review compares stable Element IDs and calculates exact quantity impact", () => {
  const previous = `${header}\n1,Walls,F,T,Wall,L1,COMPUTED,1,V,MISSING,,,MISSING,,\n2,Doors,D,T,Door,L1,MISSING,,,MISSING,,,MISSING,,\n`;
  const current = `${header}\n1,Walls,F,T,Wall,L2,COMPUTED,2,V,MISSING,,,MISSING,,\n3,Windows,W,T,Window,L1,MISSING,,,MISSING,,,MISSING,,\n`;
  const suggestions = buildElementLedgerRevisionSuggestions(
    current,
    "c".repeat(64),
    previous,
    "d".repeat(64),
  );
  assert.deepEqual(
    suggestions.map((item) => item.subjectKey),
    [
      "elements-added",
      "elements-removed",
      "classification-changed",
      "measurement-changed",
      "quantity-delta",
    ],
  );
  assert.equal(suggestions[0].evidence.previous_source_sha256, "d".repeat(64));
  assert.deepEqual(suggestions[3].evidence.sample_element_ids, ["1"]);
  assert.deepEqual(suggestions[4].evidence.quantity_deltas, [
    {
      measure: "volume",
      label: "체적",
      unit: "m³",
      previous: "1",
      current: "2",
      delta: "1",
      comparable_count: 1,
      changed_count: 1,
      not_evaluated_count: 0,
    },
  ]);
});

test("revision quantity impact preserves decimal precision and exposes missing comparisons", () => {
  const previous = `${header}\n1,Walls,F,T,Wall,L1,COMPUTED,9007199254740992.00000001,V,MISSING,,,MISSING,,\n2,Walls,F,T,Wall,L1,COMPUTED,1,V,MISSING,,,MISSING,,\n`;
  const current = `${header}\n1,Walls,F,T,Wall,L1,COMPUTED,9007199254740992.00000002,V,MISSING,,,MISSING,,\n2,Walls,F,T,Wall,L1,MISSING,,,MISSING,,,MISSING,,\n`;
  const suggestion = buildElementLedgerRevisionSuggestions(
    current,
    "e".repeat(64),
    previous,
    "f".repeat(64),
  ).find((item) => item.subjectKey === "quantity-delta");
  assert.ok(suggestion);
  assert.equal(suggestion.confidence, null);
  assert.deepEqual(suggestion.evidence.quantity_deltas, [
    {
      measure: "volume",
      label: "체적",
      unit: "m³",
      previous: "9007199254740992.00000001",
      current: "9007199254740992.00000002",
      delta: "0.00000001",
      comparable_count: 1,
      changed_count: 1,
      not_evaluated_count: 1,
    },
  ]);
});

test("revision quantity impact never chooses one row from a duplicated Element ID", () => {
  const previous = `${header}\n1,Walls,F,T,Wall,L1,COMPUTED,1,V,MISSING,,,MISSING,,\n`;
  const current = `${header}\n1,Walls,F,T,Wall,L1,COMPUTED,2,V,MISSING,,,MISSING,,\n1,Walls,F,T,Wall,L1,COMPUTED,3,V,MISSING,,,MISSING,,\n`;
  const suggestion = buildElementLedgerRevisionSuggestions(
    current,
    "1".repeat(64),
    previous,
    "2".repeat(64),
  ).find((item) => item.subjectKey === "quantity-delta");
  assert.ok(suggestion);
  assert.equal(suggestion.confidence, null);
  assert.equal(suggestion.evidence.quantity_deltas[0].comparable_count, 0);
  assert.equal(suggestion.evidence.quantity_deltas[0].not_evaluated_count, 1);
});

test("feedback export keeps evidence and decisions without approver identity or free-text notes", () => {
  const exported = buildSuggestionFeedbackExport(
    "project-1",
    "2026-08-14T00:00:00Z",
    [
      {
        id: "suggestion-1",
        file_id: "file-1",
        producer_kind: "rule",
        producer_version: "v1",
        source_sha256: "e".repeat(64),
        suggestion_kind: "anomaly",
        subject_key: "duplicate",
        title: "Duplicate",
        detail: "Review",
        confidence: 1,
        evidence: { affected_count: 2 },
        created_at: "2026-08-13T00:00:00Z",
      },
    ],
    [
      {
        suggestion_id: "suggestion-1",
        decision: "accepted",
        created_at: "2026-08-14T00:00:00Z",
        decided_by: "secret-user",
        note: "personal note",
      },
    ],
  );
  assert.equal(exported.authority, "HUMAN_DECISION_ONLY_FINAL");
  assert.deepEqual(exported.records[0].decisions, [
    { decision: "accepted", decided_at_utc: "2026-08-14T00:00:00Z" },
  ]);
  assert.equal(JSON.stringify(exported).includes("secret-user"), false);
  assert.equal(JSON.stringify(exported).includes("personal note"), false);
});

test("evaluation uses the latest human decision and never invents an acceptance rate", () => {
  const suggestions = [
    {
      id: "s1",
      producer_kind: "rule",
      producer_version: "v1",
      suggestion_kind: "mapping",
      created_at: "2026-08-13T00:00:00Z",
    },
    {
      id: "s2",
      producer_kind: "rule",
      producer_version: "v1",
      suggestion_kind: "mapping",
      created_at: "2026-08-13T00:00:00Z",
    },
    {
      id: "s3",
      producer_kind: "rule",
      producer_version: "v1",
      suggestion_kind: "classification",
      created_at: "2026-08-13T00:00:00Z",
    },
  ];
  const metrics = buildSuggestionEvaluation(suggestions, [
    {
      id: "1",
      suggestion_id: "s1",
      decision: "rejected",
      created_at: "2026-08-13T00:00:00Z",
      decision_sequence: 1,
    },
    {
      id: "2",
      suggestion_id: "s1",
      decision: "accepted",
      created_at: "2026-08-14T00:00:00Z",
      decision_sequence: 2,
    },
    {
      id: "3",
      suggestion_id: "s2",
      decision: "deferred",
      created_at: "2026-08-14T00:00:00Z",
      decision_sequence: 3,
    },
  ]);
  const classification = metrics.find(
    (item) => item.suggestion_kind === "classification",
  );
  const mapping = metrics.find((item) => item.suggestion_kind === "mapping");
  assert.equal(classification.acceptance_rate, null);
  assert.equal(classification.pending, 1);
  assert.equal(mapping.accepted, 1);
  assert.equal(mapping.deferred, 1);
  assert.equal(mapping.acceptance_rate, 1);
  assert.equal(mapping.decision_rate, 1);
  assert.equal(mapping.sample_sufficient, false);
  assert.equal(mapping.promotion_allowed, false);
  assert.equal(mapping.median_review_seconds, 86400);
});

test("concrete takeoff bundle preserves exact decimals and rejects hash or input-evidence tampering", () => {
  const takeoffHeader =
    "record_type,status,source_kind,building,floor,member,spec,raw_m3,deduction_m3,allowance_m3,final_m3,formula,rule_id,rule_hash,rule_source,source_evidence,element_ids,message,left_m3,right_m3,delta_m3";
  const row = [
    "TAKEOFF",
    "PASS",
    "Revit",
    "A",
    "1F",
    "W1",
    "25-270-15",
    "10.00000001",
    "-1.00000001",
    "-0.50000001",
    "9.5",
    "raw+deduction+allowance",
    "RULE-1",
    "a".repeat(64),
    "rules.csv!2",
    "ledger.csv;row=2",
    "101|102",
    "verified",
    "",
    "",
    "",
  ].join(",");
  const reportText = `${takeoffHeader}\n${row}\n`;
  const reportBytes = new TextEncoder().encode(reportText);
  const reportSha = createHash("sha256").update(reportBytes).digest("hex");
  const inputs = [
    "export_manifest",
    "ifc",
    "qto",
    "element_ledger",
    "revit_mapping",
    "concrete_rules",
    "registry",
  ];
  const manifestText =
    [
      "key,value",
      "format_version,CONCRETE_TAKEOFF_CSV_V1",
      "report_file,takeoff.csv",
      `report_sha256,${reportSha}`,
      "row_count,1",
      ...inputs.map(
        (name, index) => `input_${name},${String(index + 1).repeat(64)}`,
      ),
    ].join("\n") + "\n";
  const verified = verifyConcreteTakeoffBundle(
    reportBytes,
    "takeoff.csv",
    new TextEncoder().encode(manifestText),
  );
  assert.equal(verified.rows[0].raw_m3, "10.00000001");
  assert.equal(verified.rows[0].deduction_m3, "-1.00000001");
  assert.equal(verified.rows[0].allowance_m3, "-0.50000001");
  assert.equal(verified.statusCounts.PASS, 1);
  const forgedReportText = reportText.replace("-0.50000001", "0.5");
  const forgedReportBytes = new TextEncoder().encode(forgedReportText);
  const forgedReportSha = createHash("sha256")
    .update(forgedReportBytes)
    .digest("hex");
  assert.throws(
    () =>
      verifyConcreteTakeoffBundle(
        forgedReportBytes,
        "takeoff.csv",
        new TextEncoder().encode(
          manifestText.replace(reportSha, forgedReportSha),
        ),
      ),
    /산식과 일치하지 않습니다/,
  );
  const duplicateReportText = `${takeoffHeader}\n${row}\n${row.replace("101|102", "101|103")}\n`;
  const duplicateReportBytes = new TextEncoder().encode(duplicateReportText);
  const duplicateReportSha = createHash("sha256")
    .update(duplicateReportBytes)
    .digest("hex");
  assert.throws(
    () =>
      verifyConcreteTakeoffBundle(
        duplicateReportBytes,
        "takeoff.csv",
        new TextEncoder().encode(
          manifestText
            .replace(reportSha, duplicateReportSha)
            .replace("row_count,1", "row_count,2"),
        ),
      ),
    /Element ID가 중복됩니다/,
  );
  assert.throws(
    () =>
      verifyConcreteTakeoffBundle(
        new TextEncoder().encode(`${reportText}tampered`),
        "takeoff.csv",
        new TextEncoder().encode(manifestText),
      ),
    /SHA-256|파일명·확인번호|열 수/,
  );
  assert.throws(
    () =>
      verifyConcreteTakeoffBundle(
        reportBytes,
        "takeoff.csv",
        new TextEncoder().encode(
          manifestText.replace(/input_registry[^\n]+\n/, ""),
        ),
      ),
    /정확한 7개/,
  );
});

test("approved concrete takeoff becomes deterministic material plans without a second allowance", () => {
  const base = {
    record_type: "TAKEOFF",
    status: "PASS",
    source_kind: "Revit",
    building: "A",
    floor: "1F",
    member: "W1",
    spec: "25-270-15",
    raw_m3: "1",
    deduction_m3: "0",
    allowance_m3: "0.1",
    final_m3: "1.1",
    formula: "raw+allowance",
    rule_id: "R1",
    rule_hash: "a".repeat(64),
    rule_source: "rule.csv!2",
    source_evidence: "ledger.csv!2",
    element_ids: "1",
    message: "verified",
  };
  const plans = deriveMaterialPlansFromApprovedTakeoff([
    base,
    { ...base, member: "W2", final_m3: "2.000001", element_ids: "2" },
    { ...base, spec: "25-180-8", final_m3: "3", element_ids: "3" },
  ]);
  assert.deepEqual(
    plans.map((plan) => [
      plan.specification,
      plan.designQuantity,
      plan.requiredQuantity,
      plan.allowanceRate,
      plan.sourceRowCount,
    ]),
    [
      ["25-180-8", "3", "3", "0", 1],
      ["25-270-15", "3.100001", "3.100001", "0", 2],
    ],
  );
  assert.equal(plans[1].materialCode, "CONCRETE:25-270-15");
  assert.equal(plans[1].ruleId, "APPROVED_CONCRETE_TAKEOFF_V1");
  assert.deepEqual(
    deriveMaterialPlansFromApprovedTakeoff([base]),
    deriveMaterialPlansFromApprovedTakeoff([base]),
  );
});

test("material-plan import fails closed for review, missing, over-precision, or zero-only takeoff", () => {
  const row = {
    record_type: "TAKEOFF",
    status: "PASS",
    source_kind: "Revit",
    building: "A",
    floor: "1F",
    member: "W1",
    spec: "25-270-15",
    raw_m3: "1",
    deduction_m3: "0",
    allowance_m3: "0",
    final_m3: "1",
    formula: "raw",
    rule_id: "R1",
    rule_hash: "a".repeat(64),
    rule_source: "rule.csv!2",
    source_evidence: "ledger.csv!2",
    element_ids: "1",
    message: "verified",
  };
  assert.throws(
    () =>
      deriveMaterialPlansFromApprovedTakeoff([{ ...row, status: "REVIEW" }]),
    /PASS가 아니므로/,
  );
  assert.throws(
    () => deriveMaterialPlansFromApprovedTakeoff([{ ...row, final_m3: null }]),
    /최종수량이 없습니다/,
  );
  assert.throws(
    () =>
      deriveMaterialPlansFromApprovedTakeoff([
        { ...row, final_m3: "1.0000001" },
      ]),
    /소수점 6자리/,
  );
  assert.throws(
    () => deriveMaterialPlansFromApprovedTakeoff([{ ...row, final_m3: "0" }]),
    /0보다 큰/,
  );
});

test("IDS 1.0 exact requirements check the immutable element ledger and unsupported facets stay REVIEW", () => {
  const ids = `<?xml version="1.0" encoding="UTF-8"?>
<ids:ids xmlns:ids="http://standards.buildingsmart.org/IDS">
  <ids:info><ids:title>Wall delivery</ids:title></ids:info>
  <ids:specifications>
    <ids:specification name="벽 레벨" ifcVersion="IFC4">
      <ids:applicability><ids:entity><ids:name><ids:simpleValue>IFCWALL</ids:simpleValue></ids:name></ids:entity></ids:applicability>
      <ids:requirements>
        <ids:property cardinality="required">
          <ids:propertySet><ids:simpleValue>LukasQTO</ids:simpleValue></ids:propertySet>
          <ids:baseName><ids:simpleValue>Level</ids:simpleValue></ids:baseName>
        </ids:property>
      </ids:requirements>
    </ids:specification>
    <ids:specification name="전문 IFC 검사" ifcVersion="IFC4">
      <ids:applicability />
      <ids:requirements><ids:material /></ids:requirements>
    </ids:specification>
  </ids:specifications>
</ids:ids>`;
  const ledger = `${header}\n1,Walls,F,T,Wall 1,L1,COMPUTED,1,V,MISSING,,,MISSING,,\n2,Walls,F,T,Wall 2,,COMPUTED,1,V,MISSING,,,MISSING,,\n3,Doors,D,T,Door 1,L1,MISSING,,,MISSING,,,MISSING,,\n`;
  const result = checkIdsAgainstElementLedger(
    new TextEncoder().encode(ids),
    new TextEncoder().encode(ledger),
  );
  assert.equal(result.idsVersion, "1.0");
  assert.deepEqual(
    result.findings.map((finding) => [
      finding.status,
      finding.checkedCount,
      finding.failedCount,
    ]),
    [
      ["FAIL", 2, 1],
      ["REVIEW", 3, 0],
    ],
  );
  assert.deepEqual(result.findings[0].elementIds, ["2"]);
  assert.throws(
    () =>
      checkIdsAgainstElementLedger(
        new TextEncoder().encode(
          `<!DOCTYPE x [<!ENTITY y SYSTEM "file:///etc/passwd">]>${ids}`,
        ),
        new TextEncoder().encode(ledger),
      ),
    /외부 엔터티/,
  );
});

test("BCF 2.1 export contains only deterministic FAIL and REVIEW topics", () => {
  const result = {
    idsTitle: "Delivery",
    idsVersion: "1.0",
    idsSha256: "a".repeat(64),
    ledgerSha256: "b".repeat(64),
    findings: [
      {
        key: "1",
        specification: "Walls",
        status: "FAIL",
        requirement: "LukasQTO.Level",
        expected: null,
        checkedCount: 2,
        failedCount: 1,
        elementIds: ["2"],
        message: "missing",
      },
      {
        key: "2",
        specification: "Doors",
        status: "PASS",
        requirement: "LukasQTO.Level",
        expected: null,
        checkedCount: 1,
        failedCount: 0,
        elementIds: [],
        message: "ok",
      },
    ],
  };
  const zip = unzipSync(
    buildBcf21FromRequirementFindings(result, "2026-08-15T00:00:00Z"),
  );
  assert.equal(strFromU8(zip["bcf.version"]).includes('VersionId="2.1"'), true);
  const markups = Object.entries(zip).filter(([name]) =>
    name.endsWith("/markup.bcf"),
  );
  assert.equal(markups.length, 1);
  assert.match(strFromU8(markups[0][1]), /FAIL · Walls/);
  assert.equal(strFromU8(markups[0][1]).includes("Doors"), false);
});

test("AI suggestions are import-only, source-bound, evidence-bound, and cannot carry authority fields", () => {
  const sourceSha = "c".repeat(64);
  const payload = {
    format_version: "LUKAS_AI_SUGGESTIONS_V1",
    producer: {
      provider: "external",
      model: "review-model",
      version: "2026-08",
    },
    source: { sha256: sourceSha },
    suggestions: [
      {
        suggestion_kind: "classification",
        subject_key: "wall-type-review",
        title: "벽 타입 분류 검토",
        detail: "사람이 원본 요소를 확인하세요.",
        confidence: 0.7,
        evidence: { element_ids: ["1", "2"], reason_code: "NAME_MATCH" },
      },
    ],
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const verified = verifyAiSuggestionImport(bytes, sourceSha);
  assert.equal(verified.suggestions.length, 1);
  assert.equal(verified.producerVersion, "external/review-model/2026-08");
  assert.throws(
    () => verifyAiSuggestionImport(bytes, "d".repeat(64)),
    /선택한 원본 파일/,
  );
  assert.throws(
    () =>
      verifyAiSuggestionImport(
        new TextEncoder().encode(
          JSON.stringify({
            ...payload,
            suggestions: [
              { ...payload.suggestions[0], evidence: { final_quantity: 10 } },
            ],
          }),
        ),
        sourceSha,
      ),
    /수량·금액·판정·승인/,
  );
  assert.throws(
    () =>
      verifyAiSuggestionImport(
        new TextEncoder().encode(
          JSON.stringify({
            ...payload,
            suggestions: [{ ...payload.suggestions[0], evidence: {} }],
          }),
        ),
        sourceSha,
      ),
    /원본 근거/,
  );
  assert.throws(
    () =>
      verifyAiSuggestionImport(
        new TextEncoder().encode(
          JSON.stringify({
            ...payload,
            suggestions: [
              {
                ...payload.suggestions[0],
                evidence: { reason_code: "NO_POINTER" },
              },
            ],
          }),
        ),
        sourceSha,
      ),
    /원본 근거/,
  );
});

test("concrete takeoff approval requires seven same-project immutable source identities of the expected kinds", () => {
  const inputs = {
    export_manifest: "1".repeat(64),
    ifc: "2".repeat(64),
    qto: "3".repeat(64),
    element_ledger: "4".repeat(64),
    revit_mapping: "5".repeat(64),
    concrete_rules: "6".repeat(64),
    registry: "7".repeat(64),
  };
  const files = [
    ["export_manifest", "other"],
    ["ifc", "ifc"],
    ["qto", "qto_csv"],
    ["element_ledger", "element_ledger"],
    ["revit_mapping", "mapping"],
    ["concrete_rules", "other"],
    ["registry", "other"],
  ].map(([role, kind], index) => ({
    id: `file-${index}`,
    kind,
    sha256: inputs[role],
  }));
  assert.equal(resolveConcreteTakeoffInputs(inputs, files).length, 7);
  assert.throws(
    () =>
      resolveConcreteTakeoffInputs(
        inputs,
        files.filter((file) => file.kind !== "ifc"),
      ),
    /누락: ifc/,
  );
  assert.throws(
    () =>
      resolveConcreteTakeoffInputs(
        inputs,
        files.map((file) =>
          file.kind === "mapping" ? { ...file, kind: "other" } : file,
        ),
      ),
    /revit_mapping/,
  );
  assert.throws(
    () =>
      resolveConcreteTakeoffInputs(
        {
          ...inputs,
          export_manifest: inputs.concrete_rules,
          registry: inputs.concrete_rules,
        },
        files,
      ),
    /서로 다른 원본 파일/,
  );
});

test("material control keeps design, ordered, received and invoiced quantities separate", () => {
  assert.equal(calculateRequiredQuantity("100", "0.03"), "103");
  const plans = [
    {
      id: "plan-1",
      materialCode: "CONC-25-270",
      materialName: "철근콘크리트",
      specification: "25-270-15",
      unit: "m3",
      designQuantity: "100",
      allowanceRate: "0.03",
      requiredQuantity: "103",
      ruleId: "LOSS-R1",
      baselineFactorId: "factor-generic",
      sourceSha256: "1".repeat(64),
    },
  ];
  const factors = [
    {
      id: "factor-generic",
      materialCode: "CONC-25-270",
      productName: "일반 레미콘 계수",
      declaredUnit: "m3",
      gwpA1A3PerUnit: "300",
      sourceType: "generic",
      standard: "EN 15804",
      validUntil: null,
      sourceSha256: "2".repeat(64),
    },
    {
      id: "factor-product",
      materialCode: "CONC-25-270",
      productName: "공급사 EPD",
      declaredUnit: "m3",
      gwpA1A3PerUnit: "250",
      sourceType: "product_epd",
      standard: "ISO 14025",
      validUntil: "2099-12-31",
      sourceSha256: "3".repeat(64),
    },
  ];
  const transactions = [
    {
      id: "po-1",
      materialPlanId: "plan-1",
      transactionType: "purchase_order",
      documentNumber: "PO-1",
      supplierName: "공급사",
      quantity: "103",
      unitPriceKrw: null,
      amountKrw: null,
      relatedOrderId: null,
      carbonFactorId: "factor-product",
      evidenceSha256: null,
    },
    {
      id: "receipt-1",
      materialPlanId: "plan-1",
      transactionType: "goods_receipt",
      documentNumber: "DN-1",
      supplierName: "공급사",
      quantity: "60",
      unitPriceKrw: null,
      amountKrw: null,
      relatedOrderId: "po-1",
      carbonFactorId: null,
      evidenceSha256: "4".repeat(64),
    },
    {
      id: "invoice-1",
      materialPlanId: "plan-1",
      transactionType: "invoice_evidence",
      documentNumber: "INV-1",
      supplierName: "공급사",
      quantity: "65",
      unitPriceKrw: "90000",
      amountKrw: "5850000",
      relatedOrderId: "po-1",
      carbonFactorId: null,
      evidenceSha256: "5".repeat(64),
    },
    {
      id: "install-1",
      materialPlanId: "plan-1",
      transactionType: "installation",
      documentNumber: "INSTALL-1",
      supplierName: "공급사",
      quantity: "40",
      unitPriceKrw: null,
      amountKrw: null,
      relatedOrderId: "po-1",
      carbonFactorId: null,
      evidenceSha256: "6".repeat(64),
    },
    {
      id: "return-1",
      materialPlanId: "plan-1",
      transactionType: "return_to_supplier",
      documentNumber: "RETURN-1",
      supplierName: "공급사",
      quantity: "5",
      unitPriceKrw: null,
      amountKrw: null,
      relatedOrderId: "po-1",
      carbonFactorId: null,
      evidenceSha256: "7".repeat(64),
    },
    {
      id: "waste-1",
      materialPlanId: "plan-1",
      transactionType: "waste_disposal",
      documentNumber: "WASTE-1",
      supplierName: "공급사",
      quantity: "3",
      unitPriceKrw: null,
      amountKrw: null,
      relatedOrderId: "po-1",
      carbonFactorId: null,
      evidenceSha256: "8".repeat(64),
    },
  ];
  const [summary] = buildMaterialControlSummaries(plans, transactions, factors);
  assert.equal(summary.requiredQuantity, "103");
  assert.equal(summary.receivedQuantity, "60");
  assert.equal(summary.installedQuantity, "40");
  assert.equal(summary.returnedQuantity, "5");
  assert.equal(summary.wastedQuantity, "3");
  assert.equal(summary.onSiteQuantity, "12");
  assert.equal(summary.invoiceVariance, "5");
  assert.equal(summary.baselineA1A3KgCo2e, "30900");
  assert.equal(summary.committedA1A3KgCo2e, "25750");
  assert.equal(summary.receivedA1A3KgCo2e, "15000");
  assert.equal(summary.installedA1A3KgCo2e, "10000");
  assert.equal(summary.productEpdCoveredRows, 3);
  assert.equal(summary.nonProductFactorCoveredRows, 1);
  assert.equal(summary.uncoveredCarbonRows, 0);
  assert.ok(summary.findings.includes("입고 확인량 초과 청구"));
  const csv = buildMaterialControlCsv("project-1", "2026-08-15T00:00:00Z", [
    summary,
  ]);
  assert.match(csv, /plan_source_file_check/);
  assert.match(csv, /product_epd_covered_rows/);
  assert.match(csv, new RegExp("4".repeat(64)));
  assert.match(
    buildMaterialControlCsv("project-1", "2026-08-15T00:00:00Z", [
      { ...summary, materialCode: "=CMD" },
    ]),
    /'=CMD/,
  );
});

test("material control rejects detached receipt evidence and stored formula tampering", () => {
  const plan = {
    id: "p",
    materialCode: "C",
    materialName: "콘크리트",
    specification: "S",
    unit: "m3",
    designQuantity: "10",
    allowanceRate: "0.1",
    requiredQuantity: "11",
    ruleId: "R",
    baselineFactorId: null,
    sourceSha256: "a".repeat(64),
  };
  assert.throws(
    () =>
      buildMaterialControlSummaries(
        [plan],
        [
          {
            id: "r",
            materialPlanId: "p",
            transactionType: "goods_receipt",
            documentNumber: "D",
            supplierName: "S",
            quantity: "1",
            unitPriceKrw: null,
            amountKrw: null,
            relatedOrderId: null,
            carbonFactorId: null,
            evidenceSha256: "b".repeat(64),
          },
        ],
        [],
      ),
    /연결 발주/,
  );
  assert.throws(
    () =>
      buildMaterialControlSummaries(
        [{ ...plan, requiredQuantity: "10" }],
        [],
        [],
      ),
    /계산식과 다릅니다/,
  );
});

test("L1 preflight bundle binds estimate, QTO, mapping, source manifest and report under a PASS source gate", () => {
  const reportText =
    "규칙,상태,심각도,내역ID,검산키,단위,기대값,실제값,차이,근거,설명\nR021,PASS,INFO,E-1,Q-1,m3,10.00000001,10.00000001,0,line=E-1,일치\n";
  const reportBytes = new TextEncoder().encode(reportText);
  const reportSha = createHash("sha256").update(reportBytes).digest("hex");
  const values = {
    QTO: ["qto.csv", "1".repeat(64)],
    내역: ["estimate.xlsx", "2".repeat(64)],
    매핑: ["mapping.csv", "3".repeat(64)],
  };
  const manifestRows = [
    ["키", "값"],
    ["규칙버전", "L1.4.3"],
    ["엔진_코어_SHA256", "a".repeat(64)],
    ["엔진_CLI_SHA256", "b".repeat(64)],
    ["수량허용오차", "0"],
    ["KRW허용오차", "0"],
    ["생성시각_UTC", "2026-08-14T00:00:00.000Z"],
    ["QTO_파일", values.QTO[0]],
    ["QTO_SHA256", values.QTO[1]],
    ["내역_파일", values.내역[0]],
    ["내역_SHA256", values.내역[1]],
    ["매핑_파일", values.매핑[0]],
    ["매핑_SHA256", values.매핑[1]],
    ["결과_CSV_파일", "preflight.csv"],
    ["결과_CSV_SHA256", reportSha],
    ["소스게이트", "PASS"],
    ["소스_매니페스트", "source-manifest.csv"],
    ["소스_매니페스트_SHA256", "4".repeat(64)],
    ["공사범위_ID", "SCOPE-1"],
    ["IFC_소스_ID", ""],
    ["QTO_소스_ID", "qto-r1"],
    ["ESTIMATE_소스_ID", "estimate-r1"],
    ["MAPPING_소스_ID", "mapping-r1"],
  ];
  const manifestBytes = new TextEncoder().encode(
    manifestRows.map((row) => row.join(",")).join("\n") + "\n",
  );
  const verified = verifyPreflightBundle(
    reportBytes,
    "preflight.csv",
    manifestBytes,
  );
  assert.equal(verified.rows[0].expected, "10.00000001");
  assert.equal(verified.inputs.estimate.sha256, "2".repeat(64));
  const files = [
    {
      id: "q",
      kind: "qto_csv",
      sha256: "1".repeat(64),
      original_filename: "qto.csv",
    },
    {
      id: "e",
      kind: "estimate",
      sha256: "2".repeat(64),
      original_filename: "estimate.xlsx",
    },
    {
      id: "m",
      kind: "mapping",
      sha256: "3".repeat(64),
      original_filename: "mapping.csv",
    },
    {
      id: "s",
      kind: "other",
      sha256: "4".repeat(64),
      original_filename: "source-manifest.csv",
    },
  ];
  assert.equal(resolvePreflightInputs(verified.inputs, files).length, 4);
  assert.throws(
    () =>
      verifyPreflightBundle(
        reportBytes,
        "preflight.csv",
        new TextEncoder().encode(
          new TextDecoder()
            .decode(manifestBytes)
            .replace("소스게이트,PASS", "소스게이트,SKIPPED"),
        ),
      ),
    /소스 게이트 PASS/,
  );
  assert.throws(
    () =>
      resolvePreflightInputs(
        verified.inputs,
        files.filter((file) => file.kind !== "estimate"),
      ),
    /estimate/,
  );
});
