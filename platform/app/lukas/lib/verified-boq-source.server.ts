import { createHash } from "node:crypto";

import {
  compareExact,
  exactToString,
  exactZero,
  parseExactDecimal,
} from "./exact-decimal.server.ts";

export type VerifiedBoqUnit = "EA" | "m" | "m2" | "m3";

export type VerifiedBoqResolvedSource = {
  subjectKey: string;
  quantity: string;
  unit: VerifiedBoqUnit;
  elementIds: string[];
};

export type VerifiedBoqSourceDecision = VerifiedBoqResolvedSource & {
  sourceFileId: string;
  sourceSha256: string;
};

const qtoHeader = [
  "검산키",
  "분류",
  "패밀리",
  "타입",
  "레벨",
  "수량",
  "체적_m3",
  "면적_m2",
  "길이_m",
  "요소ID",
];
const ledgerHeader = [
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
];
const decimalId = /^[0-9]+$/;
const auditKey = /^[0-9A-F]{64}$/;

export function sha256Bytes(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function resolveVerifiedBoqSource(
  bytes: Uint8Array,
  kind: "qto_csv" | "element_ledger",
  requestedSubjectKey: string,
  unit: VerifiedBoqUnit,
): VerifiedBoqResolvedSource {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("원수량 파일에 데이터 행이 없습니다.");
  return kind === "qto_csv"
    ? resolveQto(rows, requestedSubjectKey, unit)
    : resolveLedger(rows, requestedSubjectKey, unit);
}

export function listVerifiedBoqSources(
  bytes: Uint8Array,
  kind: "qto_csv" | "element_ledger",
  unit: VerifiedBoqUnit,
): VerifiedBoqResolvedSource[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("원수량 파일에 데이터 행이 없습니다.");
  if (kind === "qto_csv") {
    requireHeader(rows[0], qtoHeader, "QTO CSV");
    validateQtoRows(rows.slice(1));
    return rows
      .slice(1)
      .map((row) => qtoSourceFromRow(row, row[0].toUpperCase(), unit))
      .filter((source) => isPositive(source.quantity));
  }
  requireHeader(rows[0], ledgerHeader, "객체별 수량표");
  validateLedgerRows(rows.slice(1));
  const sources: VerifiedBoqResolvedSource[] = [];
  for (const row of rows.slice(1)) {
    const id = canonicalId(row[0], "element_id");
    const bases =
      unit === "EA"
        ? (["EA"] as const)
        : unit === "m3"
          ? (["volume"] as const)
          : unit === "m"
            ? (["length", "height"] as const)
            : [];
    for (const basis of bases) {
      try {
        const source = ledgerSourceFromRow(row, id, basis, unit);
        if (isPositive(source.quantity)) sources.push(source);
      } catch (error) {
        if (
          basis === "EA" ||
          !(error instanceof Error) ||
          error.message !== "선택한 요소 측정값은 계산된 원본 값이 아닙니다."
        )
          throw error;
      }
    }
  }
  return sources;
}

export function assertVerifiedBoqSourceCoverage(
  candidates: VerifiedBoqResolvedSource[],
  decisions: VerifiedBoqResolvedSource[],
) {
  const candidateByKey = new Map(
    candidates.map((source) => [sourceDecisionKey(source), source]),
  );
  const decidedKeys = new Set<string>();
  for (const decision of decisions) {
    const key = sourceDecisionKey(decision);
    const candidate = candidateByKey.get(key);
    if (!candidate)
      throw new Error(`원수량 결정이 현재 원본 범위에 없습니다: ${key}`);
    if (
      compareExact(
        parseExactDecimal(candidate.quantity),
        parseExactDecimal(decision.quantity),
      ) !== 0 ||
      candidate.elementIds.join("|") !== decision.elementIds.join("|")
    )
      throw new Error(`저장된 원수량 근거가 현재 원본과 다릅니다: ${key}`);
    decidedKeys.add(key);
  }
  const missing = [...candidateByKey.keys()].filter(
    (key) => !decidedKeys.has(key),
  );
  if (missing.length)
    throw new Error(
      `양수 원수량 ${missing.length}건을 아직 품목에 연결하거나 사유와 함께 제외하지 않았습니다. 첫 누락: ${missing[0]}`,
    );
}

function sourceDecisionKey(source: VerifiedBoqResolvedSource) {
  return `${source.subjectKey}\u001f${source.unit}`;
}

function isPositive(value: string) {
  return compareExact(parseExactDecimal(value), exactZero) > 0;
}

function resolveQto(
  rows: string[][],
  requestedSubjectKey: string,
  unit: VerifiedBoqUnit,
) {
  requireHeader(rows[0], qtoHeader, "QTO CSV");
  validateQtoRows(rows.slice(1));
  const key = requestedSubjectKey.trim().toUpperCase();
  if (!auditKey.test(key))
    throw new Error("QTO 원본 행 키는 64자리 검산키여야 합니다.");
  const matches = rows.slice(1).filter((row) => row[0]?.toUpperCase() === key);
  if (matches.length !== 1)
    throw new Error(
      matches.length === 0
        ? "QTO에서 검산키를 찾지 못했습니다."
        : "QTO에 같은 검산키가 중복되어 있습니다.",
    );
  const row = matches[0];
  return qtoSourceFromRow(row, key, unit);
}

function qtoSourceFromRow(row: string[], key: string, unit: VerifiedBoqUnit) {
  const ids = canonicalIds(row[9]);
  const count = readNonnegative(row[5], "QTO 수량");
  if (!/^\d+$/.test(count) || BigInt(count) !== BigInt(ids.length))
    throw new Error("QTO 수량은 Element ID 개수와 같은 정수여야 합니다.");
  const quantity =
    unit === "EA"
      ? count
      : readNonnegative(
          row[unit === "m3" ? 6 : unit === "m2" ? 7 : 8],
          `QTO ${unit} 수량`,
        );
  return { subjectKey: key, quantity, unit, elementIds: ids };
}

function resolveLedger(
  rows: string[][],
  requestedSubjectKey: string,
  unit: VerifiedBoqUnit,
) {
  requireHeader(rows[0], ledgerHeader, "객체별 수량표");
  validateLedgerRows(rows.slice(1));
  const match = /^element:([1-9][0-9]*):(EA|volume|length|height)$/.exec(
    requestedSubjectKey.trim(),
  );
  if (!match)
    throw new Error(
      "객체별 수량표 키는 element:요소ID:EA|volume|length|height 형식이어야 합니다.",
    );
  const id = BigInt(match[1]).toString();
  const basis = match[2] as "EA" | "volume" | "length" | "height";
  const matches = rows
    .slice(1)
    .filter((row) => canonicalId(row[0], "element_id") === id);
  if (matches.length !== 1)
    throw new Error(
      matches.length === 0
        ? "객체별 수량표에서 Element ID를 찾지 못했습니다."
        : "객체별 수량표에 Element ID가 중복되어 있습니다.",
    );
  const row = matches[0];
  return ledgerSourceFromRow(row, id, basis, unit);
}

function ledgerSourceFromRow(
  row: string[],
  id: string,
  basis: "EA" | "volume" | "length" | "height",
  unit: VerifiedBoqUnit,
) {
  const expectedUnit = basis === "EA" ? "EA" : basis === "volume" ? "m3" : "m";
  if (unit !== expectedUnit)
    throw new Error(
      `선택한 요소 측정값은 ${expectedUnit} 품목에만 연결할 수 있습니다.`,
    );
  if (basis === "EA")
    return {
      subjectKey: `element:${id}:EA`,
      quantity: "1",
      unit,
      elementIds: [id],
    };
  const [stateIndex, valueIndex, sourceIndex] =
    basis === "volume"
      ? [6, 7, 8]
      : basis === "length"
        ? [9, 10, 11]
        : [12, 13, 14];
  if (row[stateIndex] !== "COMPUTED" || !row[sourceIndex]?.trim())
    throw new Error("선택한 요소 측정값은 계산된 원본 값이 아닙니다.");
  return {
    subjectKey: `element:${id}:${basis}`,
    quantity: readNonnegative(row[valueIndex], `요소 ${basis} 수량`),
    unit,
    elementIds: [id],
  };
}

function validateQtoRows(rows: string[][]) {
  const keys = new Set<string>();
  const allIds = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (row.length !== qtoHeader.length)
      throw new Error(`QTO ${index + 2}행의 열 개수가 올바르지 않습니다.`);
    const key = row[0].toUpperCase();
    if (!auditKey.test(key) || keys.has(key))
      throw new Error(`QTO ${index + 2}행 검산키가 없거나 중복되었습니다.`);
    keys.add(key);
    if ([row[1], row[2], row[3], row[4]].some((value) => !value.trim()))
      throw new Error(`QTO ${index + 2}행 분류 정보가 비어 있습니다.`);
    const expectedKey = createHash("sha256")
      .update([row[1], row[2], row[3], row[4]].join("\u001f"), "utf8")
      .digest("hex")
      .toUpperCase();
    if (expectedKey !== key)
      throw new Error(
        "QTO 검산키와 분류·패밀리·타입·레벨이 일치하지 않습니다.",
      );
    const ids = canonicalIds(row[9]);
    for (const id of ids) {
      if (allIds.has(id))
        throw new Error(`QTO 전체에 중복 Element ID가 있습니다: ${id}`);
      allIds.add(id);
    }
    const count = readNonnegative(row[5], "QTO 수량");
    if (!/^\d+$/.test(count) || BigInt(count) !== BigInt(ids.length))
      throw new Error("QTO 수량은 Element ID 개수와 같은 정수여야 합니다.");
    readNonnegative(row[6], "QTO 체적");
    readNonnegative(row[7], "QTO 면적");
    readNonnegative(row[8], "QTO 길이");
  }
}

function validateLedgerRows(rows: string[][]) {
  const ids = new Set<string>();
  for (const [index, row] of rows.entries()) {
    if (row.length !== ledgerHeader.length)
      throw new Error(
        `객체별 수량표 ${index + 2}행의 열 개수가 올바르지 않습니다.`,
      );
    const id = canonicalId(row[0], "element_id");
    if (ids.has(id))
      throw new Error(`객체별 수량표에 중복 element_id가 있습니다: ${id}`);
    ids.add(id);
    validateMeasurement(row, 6, 7, 8, "volume_m3", id);
    validateMeasurement(row, 9, 10, 11, "length_m", id);
    validateMeasurement(row, 12, 13, 14, "height_m", id);
  }
}

function validateMeasurement(
  row: string[],
  stateIndex: number,
  valueIndex: number,
  sourceIndex: number,
  label: string,
  id: string,
) {
  const state = row[stateIndex];
  const rawValue = row[valueIndex];
  const source = row[sourceIndex];
  if (!["MISSING", "ZERO", "COMPUTED"].includes(state))
    throw new Error(`${label} 상태가 올바르지 않습니다: ${id}`);
  if (state === "MISSING") {
    if (rawValue !== "" || source !== "")
      throw new Error(`MISSING ${label}에는 값과 출처가 없어야 합니다: ${id}`);
    return;
  }
  if (!source.trim() || rawValue === "")
    throw new Error(`${state} ${label}에는 값과 출처가 필요합니다: ${id}`);
  const value = parseExactDecimal(rawValue, label);
  if (compareExact(value, exactZero) < 0)
    throw new Error(`${label}은 음수일 수 없습니다: ${id}`);
  if (state === "ZERO" && compareExact(value, exactZero) !== 0)
    throw new Error(`ZERO ${label}은 0이어야 합니다: ${id}`);
  if (state === "COMPUTED" && compareExact(value, exactZero) <= 0)
    throw new Error(`COMPUTED ${label}은 0보다 커야 합니다: ${id}`);
}

function requireHeader(actual: string[], expected: string[], label: string) {
  if (
    actual.length !== expected.length ||
    expected.some((name, index) => actual[index] !== name)
  )
    throw new Error(`${label} 헤더가 지원 계약과 일치하지 않습니다.`);
}

function readNonnegative(value: string, label: string) {
  const parsed = parseExactDecimal(value, label);
  if (compareExact(parsed, exactZero) < 0)
    throw new Error(`${label}은 음수일 수 없습니다.`);
  return exactToString(parsed);
}

function canonicalIds(value: string) {
  const ids = value.split("|").map((part) => canonicalId(part, "요소ID"));
  if (ids.length === 0 || new Set(ids).size !== ids.length)
    throw new Error("요소ID가 비어 있거나 중복되어 있습니다.");
  return ids.sort((left, right) => {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function canonicalId(value: string, label: string) {
  const trimmed = value.trim();
  if (!decimalId.test(trimmed) || BigInt(trimmed) <= 0n)
    throw new Error(`${label}는 양의 정수여야 합니다.`);
  return BigInt(trimmed).toString();
}

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const value = text[index];
    if (quoted) {
      if (value === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (value === '"') quoted = false;
      else cell += value;
    } else if (value === '"' && cell.length === 0) quoted = true;
    else if (value === ",") {
      row.push(cell);
      cell = "";
    } else if (value === "\r" || value === "\n") {
      if (value === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += value;
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.length > 0));
}
