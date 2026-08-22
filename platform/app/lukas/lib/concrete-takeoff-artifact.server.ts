import { createHash } from "node:crypto";

import { parseCsv } from "./element-ledger-suggestions.server.ts";
import {
  compareExact,
  equalExact,
  parseExactDecimal,
  subtractExact,
} from "./exact-decimal.server.ts";

export const CONCRETE_TAKEOFF_FORMAT = "CONCRETE_TAKEOFF_CSV_V1";
const header = [
  "record_type",
  "status",
  "source_kind",
  "building",
  "floor",
  "member",
  "spec",
  "raw_m3",
  "deduction_m3",
  "allowance_m3",
  "final_m3",
  "formula",
  "rule_id",
  "rule_hash",
  "rule_source",
  "source_evidence",
  "element_ids",
  "message",
  "left_m3",
  "right_m3",
  "delta_m3",
] as const;
const inputNames = [
  "export_manifest",
  "ifc",
  "qto",
  "element_ledger",
  "revit_mapping",
  "concrete_rules",
  "registry",
] as const;
const expectedInputKinds: Record<(typeof inputNames)[number], string> = {
  export_manifest: "other",
  ifc: "ifc",
  qto: "qto_csv",
  element_ledger: "element_ledger",
  revit_mapping: "mapping",
  concrete_rules: "other",
  registry: "other",
};
const validStatuses = new Set(["PASS", "FAIL", "REVIEW", "NOT_EVALUATED"]);

export type ConcreteTakeoffRow = {
  record_type: string;
  status: string;
  source_kind: string;
  building: string;
  floor: string;
  member: string;
  spec: string;
  raw_m3: string | null;
  deduction_m3: string | null;
  allowance_m3: string | null;
  final_m3: string | null;
  formula: string;
  rule_id: string;
  rule_hash: string;
  rule_source: string;
  source_evidence: string;
  element_ids: string;
  message: string;
};

export type VerifiedConcreteTakeoff = {
  formatVersion: typeof CONCRETE_TAKEOFF_FORMAT;
  reportSha256: string;
  manifestSha256: string;
  rowCount: number;
  inputSha256: Record<(typeof inputNames)[number], string>;
  statusCounts: Record<string, number>;
  rows: ConcreteTakeoffRow[];
};

export function resolveConcreteTakeoffInputs(
  inputSha256: VerifiedConcreteTakeoff["inputSha256"],
  files: { id: string; kind: string; sha256: string }[],
) {
  const resolved = inputNames.map((role) => ({
    role,
    hash: inputSha256[role],
    file: files.find(
      (candidate) =>
        candidate.sha256 === inputSha256[role] &&
        candidate.kind === expectedInputKinds[role],
    ),
  }));
  const missing = resolved
    .filter((input) => !input.file)
    .map((input) => input.role);
  if (missing.length > 0)
    throw new Error(
      `산출 근거 등록 전에 7개 입력 원본을 프로젝트에 보관하세요. 누락: ${missing.join(", ")}`,
    );
  const fileIds = resolved.map((input) => input.file!.id);
  if (new Set(fileIds).size !== fileIds.length)
    throw new Error(
      "콘크리트 산출의 7개 입력 역할은 서로 다른 원본 파일이어야 합니다.",
    );
  return resolved.map((input) => ({
    role: input.role,
    hash: input.hash,
    file: input.file!,
  }));
}

export function verifyConcreteTakeoffBundle(
  reportBytes: Uint8Array,
  reportFilename: string,
  manifestBytes: Uint8Array,
): VerifiedConcreteTakeoff {
  if (
    !reportFilename ||
    reportFilename.includes("/") ||
    reportFilename.includes("\\")
  )
    throw new Error("콘크리트 report 파일명이 올바르지 않습니다.");
  const reportSha256 = sha(reportBytes);
  const manifestSha256 = sha(manifestBytes);
  const reportCsv = parseCsv(decode(reportBytes));
  const manifestCsv = parseCsv(decode(manifestBytes));
  if (
    reportCsv.length < 2 ||
    reportCsv[0].length !== header.length ||
    !header.every((name, index) => reportCsv[0][index] === name)
  ) {
    throw new Error(
      `콘크리트 report 헤더가 ${CONCRETE_TAKEOFF_FORMAT} 계약과 다릅니다.`,
    );
  }
  if (
    manifestCsv.length < 2 ||
    manifestCsv[0].length !== 2 ||
    manifestCsv[0][0] !== "key" ||
    manifestCsv[0][1] !== "value"
  ) {
    throw new Error("콘크리트 산출 근거 기록 형식이 올바르지 않습니다.");
  }
  const manifest = new Map<string, string>();
  for (const row of manifestCsv.slice(1)) {
    if (row.length !== 2 || !row[0] || manifest.has(row[0]))
      throw new Error(
        "콘크리트 산출 근거 기록의 항목이 잘못되거나 중복됩니다.",
      );
    manifest.set(row[0], row[1]);
  }
  const expectedKeys = [
    "format_version",
    "report_file",
    "report_sha256",
    "row_count",
    ...inputNames.map((name) => `input_${name}`),
  ];
  if (
    manifest.size !== expectedKeys.length ||
    expectedKeys.some((key) => !manifest.has(key))
  )
    throw new Error(
      "콘크리트 산출 근거 기록에는 정확한 7개 입력 파일 확인번호가 필요합니다.",
    );
  if (
    manifest.get("format_version") !== CONCRETE_TAKEOFF_FORMAT ||
    original(manifest.get("report_file") ?? "") !== reportFilename ||
    manifest.get("report_sha256")?.toLowerCase() !== reportSha256 ||
    manifest.get("row_count") !== String(reportCsv.length - 1)
  )
    throw new Error(
      "콘크리트 결과가 산출 근거 기록의 버전·파일명·확인번호·행 수와 일치하지 않습니다.",
    );

  const inputSha256 = {} as Record<(typeof inputNames)[number], string>;
  for (const name of inputNames) {
    const value = manifest.get(`input_${name}`) ?? "";
    if (!isSha(value))
      throw new Error(
        `콘크리트 결과의 입력 파일 확인번호가 올바르지 않습니다: input_${name}`,
      );
    inputSha256[name] = value.toLowerCase();
  }

  const statusCounts: Record<string, number> = {};
  const elementOwners = new Map<string, number>();
  const ruleHashes = new Map<string, string>();
  const rows = reportCsv.slice(1).map((values, index): ConcreteTakeoffRow => {
    if (values.length !== header.length)
      throw new Error(`${index + 2}행 열 수가 올바르지 않습니다.`);
    const text = values.map(original);
    const recordType = text[0];
    const status = text[1];
    if (recordType !== "TAKEOFF" && recordType !== "TAKEOFF_SUMMARY")
      throw new Error("웹 산출 근거에는 TAKEOFF report만 등록할 수 있습니다.");
    if (!validStatuses.has(status))
      throw new Error("콘크리트 report에 정의되지 않은 status가 있습니다.");
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    const numbers = [7, 8, 9, 10, 18, 19, 20].map((column) =>
      decimal(text[column], index + 2, header[column]),
    );
    if (recordType === "TAKEOFF" && status === "PASS") {
      if (
        numbers.slice(0, 4).some((value) => value === null) ||
        [3, 4, 5, 6, 11, 12, 14].some((column) => !text[column].trim()) ||
        !isSha(text[13]) ||
        (!text[15].trim() && !text[16].trim())
      )
        throw new Error(
          "PASS TAKEOFF 행에는 수량·공식·승인 규칙·원본 근거가 모두 필요합니다.",
        );
      const raw = parseExactDecimal(numbers[0]!, `${index + 2}행 raw_m3`);
      const deduction = parseExactDecimal(
        numbers[1]!,
        `${index + 2}행 deduction_m3`,
      );
      const allowance = parseExactDecimal(
        numbers[2]!,
        `${index + 2}행 allowance_m3`,
      );
      const final = parseExactDecimal(numbers[3]!, `${index + 2}행 final_m3`);
      if (
        compareExact(raw, { coefficient: 0n, scale: 0 }) < 0 ||
        compareExact(final, { coefficient: 0n, scale: 0 }) < 0 ||
        compareExact(deduction, { coefficient: 0n, scale: 0 }) > 0 ||
        !equalExact(allowance, subtractExact(final, raw))
      )
        throw new Error(
          `${index + 2}행 PASS 수량은 정미량·공제·할증·최종량 산식과 일치하지 않습니다.`,
        );

      const previousRuleHash = ruleHashes.get(text[12]);
      if (previousRuleHash && previousRuleHash !== text[13].toLowerCase())
        throw new Error("같은 rule_id에 서로 다른 rule_hash가 사용됐습니다.");
      ruleHashes.set(text[12], text[13].toLowerCase());
    }
    if (text[16]) {
      for (const id of text[16].split("|")) {
        if (!/^[1-9][0-9]*$/.test(id))
          throw new Error(`${index + 2}행 element_ids가 올바르지 않습니다.`);
        const canonical = BigInt(id).toString();
        const previousRow = elementOwners.get(canonical);
        if (previousRow !== undefined)
          throw new Error(
            `${previousRow}행과 ${index + 2}행에 같은 Element ID가 중복됩니다.`,
          );
        elementOwners.set(canonical, index + 2);
      }
    }
    if (recordType === "TAKEOFF_SUMMARY" && status === "PASS")
      throw new Error("산출 행이 없는 TAKEOFF summary는 PASS일 수 없습니다.");
    return {
      record_type: recordType,
      status,
      source_kind: text[2],
      building: text[3],
      floor: text[4],
      member: text[5],
      spec: text[6],
      raw_m3: numbers[0],
      deduction_m3: numbers[1],
      allowance_m3: numbers[2],
      final_m3: numbers[3],
      formula: text[11],
      rule_id: text[12],
      rule_hash: text[13],
      rule_source: text[14],
      source_evidence: text[15],
      element_ids: text[16],
      message: text[17],
    };
  });
  return {
    formatVersion: CONCRETE_TAKEOFF_FORMAT,
    reportSha256,
    manifestSha256,
    rowCount: rows.length,
    inputSha256,
    statusCounts,
    rows,
  };
}

function decode(value: Uint8Array) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(value);
  return text.replace(/^\uFEFF/, "");
}

function sha(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
function isSha(value: string) {
  return /^[0-9a-fA-F]{64}$/.test(value);
}
function decimal(value: string, row: number, field: string) {
  if (value === "") return null;
  if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(value))
    throw new Error(`${row}행 ${field}가 lossless decimal 형식이 아닙니다.`);
  return value;
}
function original(value: string) {
  let index = 0;
  while (index < value.length && [" ", "\t", "\r", "\n"].includes(value[index]))
    index += 1;
  if (
    value[index] !== "'" ||
    index + 1 >= value.length ||
    !["'", "=", "+", "-", "@"].includes(value[index + 1])
  )
    return value;
  return value.slice(0, index) + value.slice(index + 1);
}
