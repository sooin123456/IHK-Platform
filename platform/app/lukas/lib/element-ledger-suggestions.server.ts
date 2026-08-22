import type { Json } from "database.types";

import {
  addExact,
  compareExact,
  exactToString,
  exactZero,
  parseExactDecimal,
  subtractExact,
  type ExactDecimal,
} from "./exact-decimal.server.ts";

export const ELEMENT_LEDGER_HEADER = [
  "element_id",
  "category",
  "family",
  "type",
  "element_name",
  "level",
  "volume_state",
  "volume_m3",
  "volume_source_parameter",
  "length_state",
  "length_m",
  "length_source_parameter",
  "height_state",
  "height_m",
  "height_source_parameter",
] as const;

export const LEDGER_REVIEW_VERSION = "ELEMENT_LEDGER_REVIEW_V2";

export type SuggestionDraft = {
  suggestionKind: "anomaly" | "classification" | "mapping" | "revision_change";
  subjectKey: string;
  title: string;
  detail: string;
  confidence: number | null;
  evidence: Json;
};

type BaseEvidence = { [key: string]: Json | undefined };

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) quoted = true;
    else if (char === '"')
      throw new Error("CSV 큰따옴표는 필드 시작 위치에만 올 수 있습니다.");
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") field += char;
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function buildElementLedgerSuggestions(
  text: string,
  sourceSha256: string,
): SuggestionDraft[] {
  validateSha(sourceSha256);
  const rows = readLedger(text);

  const body = rows.slice(1);
  const malformed: string[] = [];
  const duplicateIds: string[] = [];
  const missingIdentity: string[] = [];
  const noMeasuredProperty: string[] = [];
  const invalidMeasurements: string[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < body.length; index += 1) {
    const fields = body[index];
    const rowNumber = index + 2;
    if (fields.length !== ELEMENT_LEDGER_HEADER.length) {
      malformed.push(String(rowNumber));
      continue;
    }
    const elementId = fields[0].trim();
    if (!/^[1-9][0-9]*$/.test(elementId)) malformed.push(String(rowNumber));
    else if (seen.has(elementId)) duplicateIds.push(elementId);
    else seen.add(elementId);

    if ([fields[1], fields[2], fields[3]].some((value) => !value.trim()))
      missingIdentity.push(elementId || `row:${rowNumber}`);
    if (
      [fields[6], fields[9], fields[12]].every((state) => state === "MISSING")
    )
      noMeasuredProperty.push(elementId || `row:${rowNumber}`);

    const triples = [
      [6, 7, 8],
      [9, 10, 11],
      [12, 13, 14],
    ] as const;
    if (
      triples.some(
        ([stateIndex, valueIndex, sourceIndex]) =>
          !validMeasurement(
            fields[stateIndex],
            fields[valueIndex],
            fields[sourceIndex],
          ),
      )
    ) {
      invalidMeasurements.push(elementId || `row:${rowNumber}`);
    }
  }

  const baseEvidence = {
    source_sha256: sourceSha256,
    row_count: body.length,
    rule_version: LEDGER_REVIEW_VERSION,
  };
  const suggestions: SuggestionDraft[] = [];
  if (body.length === 0)
    suggestions.push(
      draft(
        "anomaly",
        "empty-ledger",
        "추출 대상 요소가 없습니다",
        "추출 범위와 Revit 뷰·선택 상태를 확인하세요.",
        baseEvidence,
        [],
      ),
    );
  if (malformed.length > 0)
    suggestions.push(
      draft(
        "anomaly",
        "malformed-ledger",
        "요소 원장 형식 오류",
        "열 수 또는 element_id가 올바르지 않은 행이 있습니다.",
        baseEvidence,
        malformed,
      ),
    );
  if (duplicateIds.length > 0)
    suggestions.push(
      draft(
        "anomaly",
        "duplicate-element-id",
        "중복 Element ID",
        "같은 Revit 요소가 두 번 집계됐을 수 있습니다.",
        baseEvidence,
        duplicateIds,
      ),
    );
  if (invalidMeasurements.length > 0)
    suggestions.push(
      draft(
        "anomaly",
        "invalid-measurement-state",
        "수량 상태와 값이 일치하지 않습니다",
        "MISSING/ZERO/COMPUTED 상태, 값, source parameter 조합을 확인하세요.",
        baseEvidence,
        invalidMeasurements,
      ),
    );
  if (missingIdentity.length > 0)
    suggestions.push(
      draft(
        "classification",
        "missing-classification",
        "분류 정보가 비어 있습니다",
        "category·family·type 중 비어 있는 요소를 공종 매핑 전에 확인하세요.",
        baseEvidence,
        missingIdentity,
      ),
    );
  if (noMeasuredProperty.length > 0)
    suggestions.push(
      draft(
        "mapping",
        "no-measured-property",
        "사용 가능한 물량 속성이 없습니다",
        "체적·길이·높이가 모두 MISSING인 요소입니다. 추정값은 만들지 않았습니다.",
        baseEvidence,
        noMeasuredProperty,
      ),
    );
  return suggestions;
}

export function buildElementLedgerRevisionSuggestions(
  currentText: string,
  currentSha256: string,
  previousText: string,
  previousSha256: string,
): SuggestionDraft[] {
  validateSha(currentSha256);
  validateSha(previousSha256);
  const currentRows = readLedger(currentText).slice(1);
  const previousRows = readLedger(previousText).slice(1);
  const current = comparableRows(currentRows);
  const previous = comparableRows(previousRows);
  const added = [...current.keys()].filter((id) => !previous.has(id));
  const removed = [...previous.keys()].filter((id) => !current.has(id));
  const classificationChanged: string[] = [];
  const measurementChanged: string[] = [];

  for (const [id, currentRow] of current) {
    const previousRow = previous.get(id);
    if (!previousRow) continue;
    if (
      [1, 2, 3, 4, 5].some((index) => currentRow[index] !== previousRow[index])
    )
      classificationChanged.push(id);
    if (
      [6, 7, 8, 9, 10, 11, 12, 13, 14].some(
        (index) => currentRow[index] !== previousRow[index],
      )
    )
      measurementChanged.push(id);
  }

  const baseEvidence: BaseEvidence = {
    source_sha256: currentSha256,
    previous_source_sha256: previousSha256,
    row_count: currentRows.length,
    previous_row_count: previousRows.length,
    rule_version: LEDGER_REVIEW_VERSION,
  };
  const suggestions: SuggestionDraft[] = [];
  if (added.length > 0)
    suggestions.push(
      draft(
        "revision_change",
        "elements-added",
        "새 요소가 추가됐습니다",
        `이전 원장에 없던 Element ID ${added.length}개가 있습니다.`,
        baseEvidence,
        added,
      ),
    );
  if (removed.length > 0)
    suggestions.push(
      draft(
        "revision_change",
        "elements-removed",
        "기존 요소가 사라졌습니다",
        `이전 원장에 있던 Element ID ${removed.length}개가 새 원장에는 없습니다.`,
        baseEvidence,
        removed,
      ),
    );
  if (classificationChanged.length > 0)
    suggestions.push(
      draft(
        "revision_change",
        "classification-changed",
        "요소 분류 정보가 변경됐습니다",
        `동일 Element ID의 category·family·type·name·level이 변경된 요소가 ${classificationChanged.length}개입니다.`,
        baseEvidence,
        classificationChanged,
      ),
    );
  if (measurementChanged.length > 0)
    suggestions.push(
      draft(
        "revision_change",
        "measurement-changed",
        "요소 물량 속성이 변경됐습니다",
        `동일 Element ID의 체적·길이·높이 상태, 값 또는 근거 파라미터가 변경된 요소가 ${measurementChanged.length}개입니다.`,
        baseEvidence,
        measurementChanged,
      ),
    );
  const quantityImpact = buildRevisionQuantityImpact(current, previous);
  if (quantityImpact.deltas.length > 0) {
    const changed = quantityImpact.deltas
      .filter((item) => item.changed_count > 0)
      .map((item) => `${item.label} ${signed(item.delta)} ${item.unit}`);
    const notEvaluated = quantityImpact.deltas.reduce(
      (sum, item) => sum + item.not_evaluated_count,
      0,
    );
    const detail = [
      changed.length > 0
        ? `비교 가능한 요소 기준 ${changed.join(" · ")}`
        : "비교 가능한 요소의 총차는 0입니다",
      notEvaluated > 0 ? `값이 없어 미산정 ${notEvaluated}건` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    suggestions.push({
      suggestionKind: "revision_change",
      subjectKey: "quantity-delta",
      title:
        notEvaluated > 0
          ? "개정 물량 차이에 확인이 필요합니다"
          : "개정 물량 차이를 계산했습니다",
      detail: `${detail}.`,
      confidence: notEvaluated === 0 ? 1 : null,
      evidence: {
        ...baseEvidence,
        affected_count: quantityImpact.affectedIds.length,
        sample_element_ids: quantityImpact.affectedIds.slice(0, 20),
        quantity_formula:
          "delta = SUM(current comparable) - SUM(previous comparable)",
        quantity_deltas: quantityImpact.deltas,
      },
    });
  }
  return suggestions;
}

export function revisionComparisonUnavailable(
  currentSha256: string,
  previousSha256: string,
  reasonCode: string,
): SuggestionDraft {
  validateSha(currentSha256);
  validateSha(previousSha256);
  return {
    suggestionKind: "revision_change",
    subjectKey: "comparison-unavailable",
    title: "이전 원장 비교가 완료되지 않았습니다",
    detail:
      "이전 요소 원장을 읽지 못해 자동 개정 비교를 실행하지 않았습니다. 원본 파일을 직접 확인하세요.",
    confidence: null,
    evidence: {
      source_sha256: currentSha256,
      previous_source_sha256: previousSha256,
      rule_version: LEDGER_REVIEW_VERSION,
      reason_code: reasonCode,
      affected_count: 0,
      sample_element_ids: [],
    },
  };
}

function readLedger(text: string) {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (
    rows.length === 0 ||
    !ELEMENT_LEDGER_HEADER.every(
      (value, index) => rows[0]?.[index] === value,
    ) ||
    rows[0].length !== ELEMENT_LEDGER_HEADER.length
  ) {
    throw new Error(
      "요소 원장 헤더가 ELEMENT_QUANTITY_LEDGER_V2 계약과 다릅니다.",
    );
  }
  return rows;
}

function comparableRows(rows: string[][]) {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    if (
      row.length !== ELEMENT_LEDGER_HEADER.length ||
      !/^[1-9][0-9]*$/.test(row[0])
    )
      continue;
    if (result.has(row[0])) result.set(row[0], []);
    else result.set(row[0], row);
  }
  return result;
}

function validateSha(value: string) {
  if (!/^[0-9a-f]{64}$/.test(value))
    throw new Error("요소 원장의 파일 확인번호 형식이 올바르지 않습니다.");
}

function validMeasurement(state: string, value: string, source: string) {
  if (state === "MISSING") return value === "" && source === "";
  if (state !== "ZERO" && state !== "COMPUTED") return false;
  if (source.trim() === "" || !/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value))
    return false;
  try {
    const numeric = parseExactDecimal(value, "수량");
    const comparison = compareExact(numeric, exactZero);
    return state === "ZERO" ? comparison === 0 : comparison > 0;
  } catch {
    return false;
  }
}

type MeasurementKind = "known" | "missing" | "invalid" | "absent";
type MeasurementValue = { kind: MeasurementKind; value: ExactDecimal };

const revisionMeasures = [
  {
    measure: "volume",
    label: "체적",
    unit: "m³",
    state: 6,
    value: 7,
    source: 8,
  },
  {
    measure: "length",
    label: "길이",
    unit: "m",
    state: 9,
    value: 10,
    source: 11,
  },
  {
    measure: "height",
    label: "높이",
    unit: "m",
    state: 12,
    value: 13,
    source: 14,
  },
] as const;

function buildRevisionQuantityImpact(
  current: Map<string, string[]>,
  previous: Map<string, string[]>,
) {
  const ids = [...new Set([...current.keys(), ...previous.keys()])].sort(
    compareElementIds,
  );
  const affected = new Set<string>();
  const deltas = revisionMeasures.flatMap((measure) => {
    let previousTotal = exactZero;
    let currentTotal = exactZero;
    let comparableCount = 0;
    let changedCount = 0;
    let notEvaluatedCount = 0;

    for (const id of ids) {
      const before = revisionMeasurement(previous.get(id), measure);
      const after = revisionMeasurement(current.get(id), measure);
      if (
        (before.kind === "absent" || before.kind === "missing") &&
        (after.kind === "absent" || after.kind === "missing")
      )
        continue;
      if (
        (before.kind !== "known" && before.kind !== "absent") ||
        (after.kind !== "known" && after.kind !== "absent")
      ) {
        notEvaluatedCount += 1;
        affected.add(id);
        continue;
      }
      comparableCount += 1;
      previousTotal = addExact(previousTotal, before.value);
      currentTotal = addExact(currentTotal, after.value);
      if (compareExact(before.value, after.value) !== 0) {
        changedCount += 1;
        affected.add(id);
      }
    }

    if (changedCount === 0 && notEvaluatedCount === 0) return [];
    return [
      {
        measure: measure.measure,
        label: measure.label,
        unit: measure.unit,
        previous: exactToString(previousTotal),
        current: exactToString(currentTotal),
        delta: exactToString(subtractExact(currentTotal, previousTotal)),
        comparable_count: comparableCount,
        changed_count: changedCount,
        not_evaluated_count: notEvaluatedCount,
      },
    ];
  });
  return { deltas, affectedIds: [...affected].sort(compareElementIds) };
}

function revisionMeasurement(
  row: string[] | undefined,
  measure: (typeof revisionMeasures)[number],
): MeasurementValue {
  if (!row) return { kind: "absent", value: exactZero };
  const state = row[measure.state];
  const value = row[measure.value];
  const source = row[measure.source];
  if (state === "MISSING" && value === "" && source === "")
    return { kind: "missing", value: exactZero };
  if (!validMeasurement(state, value, source))
    return { kind: "invalid", value: exactZero };
  return { kind: "known", value: parseExactDecimal(value, measure.measure) };
}

function compareElementIds(left: string, right: string) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function signed(value: string) {
  return value === "0" || value.startsWith("-") ? value : `+${value}`;
}

function draft(
  kind: SuggestionDraft["suggestionKind"],
  subjectKey: string,
  title: string,
  detail: string,
  baseEvidence: BaseEvidence,
  affected: string[],
): SuggestionDraft {
  return {
    suggestionKind: kind,
    subjectKey,
    title,
    detail,
    confidence: 1,
    evidence: {
      ...baseEvidence,
      affected_count: affected.length,
      sample_element_ids: affected.slice(0, 20),
    },
  };
}
