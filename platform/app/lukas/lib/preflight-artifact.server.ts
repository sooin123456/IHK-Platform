import { createHash } from "node:crypto";

import { parseCsv } from "./element-ledger-suggestions.server.ts";

const reportHeader = [
  "규칙",
  "상태",
  "심각도",
  "내역ID",
  "검산키",
  "단위",
  "기대값",
  "실제값",
  "차이",
  "근거",
  "설명",
] as const;
const validStatuses = new Set(["PASS", "FAIL", "REVIEW", "NOT_EVALUATED"]);
const validSeverities = new Set(["ERROR", "WARNING", "INFO"]);
const requiredManifestKeys = [
  "규칙버전",
  "엔진_코어_SHA256",
  "엔진_CLI_SHA256",
  "수량허용오차",
  "KRW허용오차",
  "생성시각_UTC",
  "QTO_파일",
  "QTO_SHA256",
  "내역_파일",
  "내역_SHA256",
  "매핑_파일",
  "매핑_SHA256",
  "결과_CSV_파일",
  "결과_CSV_SHA256",
  "소스게이트",
  "소스_매니페스트",
  "소스_매니페스트_SHA256",
  "공사범위_ID",
  "IFC_소스_ID",
  "QTO_소스_ID",
  "ESTIMATE_소스_ID",
  "MAPPING_소스_ID",
] as const;

export type PreflightFindingRow = {
  rule: string;
  status: string;
  severity: string;
  estimateLineId: string;
  qtoKey: string;
  unit: string;
  expected: string | null;
  actual: string | null;
  delta: string | null;
  evidence: string;
  message: string;
};

export type VerifiedPreflightArtifact = {
  formatVersion: "LUKAS_PREFLIGHT_REPORT_V1";
  rulesetVersion: string;
  reportSha256: string;
  manifestSha256: string;
  rowCount: number;
  scopeId: string;
  quantityTolerance: string;
  krwTolerance: string;
  statusCounts: Record<string, number>;
  inputs: Record<
    string,
    { filename: string; sha256: string; sourceId: string }
  >;
  rows: PreflightFindingRow[];
};

export function verifyPreflightBundle(
  reportBytes: Uint8Array,
  reportFilename: string,
  manifestBytes: Uint8Array,
): VerifiedPreflightArtifact {
  if (!safeName(reportFilename))
    throw new Error("사전검토 report 파일명이 올바르지 않습니다.");
  const reportSha256 = sha(reportBytes);
  const manifestSha256 = sha(manifestBytes);
  const report = parseCsv(decode(reportBytes));
  const manifestRows = parseCsv(decode(manifestBytes));
  if (
    report.length < 2 ||
    report[0].length !== reportHeader.length ||
    !reportHeader.every((value, index) => report[0][index] === value)
  )
    throw new Error("사전검토 report 헤더가 L1 계약과 다릅니다.");
  if (
    manifestRows.length < 2 ||
    manifestRows[0].length !== 2 ||
    manifestRows[0][0] !== "키" ||
    manifestRows[0][1] !== "값"
  )
    throw new Error("사전검토 산출 근거 기록 형식이 올바르지 않습니다.");
  const manifest = new Map<string, string>();
  for (const row of manifestRows.slice(1)) {
    if (row.length !== 2 || !row[0] || manifest.has(row[0]))
      throw new Error(
        "사전검토 산출 근거 기록의 항목이 잘못되거나 중복됩니다.",
      );
    manifest.set(row[0], original(row[1]));
  }
  if (requiredManifestKeys.some((key) => !manifest.has(key)))
    throw new Error("사전검토 산출 근거 기록에 필수 항목이 없습니다.");
  if (manifest.get("소스게이트") !== "PASS")
    throw new Error(
      "승인된 소스 게이트 PASS 실행만 웹 승인 흐름에 등록할 수 있습니다.",
    );
  if (
    manifest.get("결과_CSV_파일") !== reportFilename ||
    manifest.get("결과_CSV_SHA256")?.toLowerCase() !== reportSha256
  )
    throw new Error(
      "사전검토 결과의 파일명 또는 확인번호가 산출 근거 기록과 다릅니다.",
    );
  for (const key of [
    "엔진_코어_SHA256",
    "엔진_CLI_SHA256",
    "QTO_SHA256",
    "내역_SHA256",
    "매핑_SHA256",
    "소스_매니페스트_SHA256",
  ])
    if (!isSha(manifest.get(key) ?? ""))
      throw new Error(
        `사전검토 산출 근거 기록의 파일 확인번호가 올바르지 않습니다: ${key}`,
      );
  const rulesetVersion = requiredText(manifest, "규칙버전");
  const scopeId = requiredText(manifest, "공사범위_ID");
  const quantityTolerance = decimal(
    requiredText(manifest, "수량허용오차"),
    "수량허용오차",
  );
  const krwTolerance = decimal(
    requiredText(manifest, "KRW허용오차"),
    "KRW허용오차",
  );
  if (quantityTolerance.startsWith("-") || krwTolerance.startsWith("-"))
    throw new Error("사전검토 허용오차는 음수일 수 없습니다.");
  if (!Number.isFinite(Date.parse(requiredText(manifest, "생성시각_UTC"))))
    throw new Error("사전검토 생성시각이 올바르지 않습니다.");
  const inputs: VerifiedPreflightArtifact["inputs"] = {
    qto: input(manifest, "QTO", "QTO_소스_ID"),
    estimate: input(manifest, "내역", "ESTIMATE_소스_ID"),
    mapping: input(manifest, "매핑", "MAPPING_소스_ID"),
    source_manifest: {
      filename: requiredText(manifest, "소스_매니페스트"),
      sha256: requiredText(manifest, "소스_매니페스트_SHA256").toLowerCase(),
      sourceId: "SOURCE_MANIFEST",
    },
  };
  const ifcFilename = manifest.get("IFC_파일") ?? "";
  if (ifcFilename || manifest.has("IFC_SHA256")) {
    if (!ifcFilename || !isSha(manifest.get("IFC_SHA256") ?? ""))
      throw new Error("IFC 입력 파일명과 파일 확인번호가 완전하지 않습니다.");
    inputs.ifc = {
      filename: ifcFilename,
      sha256: (manifest.get("IFC_SHA256") ?? "").toLowerCase(),
      sourceId: requiredText(manifest, "IFC_소스_ID"),
    };
  }
  const statusCounts: Record<string, number> = {};
  const rows = report.slice(1).map((values, index): PreflightFindingRow => {
    if (values.length !== reportHeader.length)
      throw new Error(`${index + 2}행 열 수가 올바르지 않습니다.`);
    const text = values.map(original);
    if (
      !text[0].trim() ||
      !validStatuses.has(text[1]) ||
      !validSeverities.has(text[2])
    )
      throw new Error(`${index + 2}행 규칙·상태·심각도가 올바르지 않습니다.`);
    statusCounts[text[1]] = (statusCounts[text[1]] ?? 0) + 1;
    return {
      rule: text[0],
      status: text[1],
      severity: text[2],
      estimateLineId: text[3],
      qtoKey: text[4],
      unit: text[5],
      expected: optionalDecimal(text[6], index + 2, "기대값"),
      actual: optionalDecimal(text[7], index + 2, "실제값"),
      delta: optionalDecimal(text[8], index + 2, "차이"),
      evidence: text[9],
      message: text[10],
    };
  });
  return {
    formatVersion: "LUKAS_PREFLIGHT_REPORT_V1",
    rulesetVersion,
    reportSha256,
    manifestSha256,
    rowCount: rows.length,
    scopeId,
    quantityTolerance,
    krwTolerance,
    statusCounts,
    inputs,
    rows,
  };
}

export function resolvePreflightInputs(
  inputs: VerifiedPreflightArtifact["inputs"],
  files: {
    id: string;
    kind: string;
    sha256: string;
    original_filename: string;
  }[],
) {
  const expectedKinds: Record<string, string> = {
    qto: "qto_csv",
    estimate: "estimate",
    mapping: "mapping",
    source_manifest: "other",
    ifc: "ifc",
  };
  const resolved = Object.entries(inputs).map(([role, inputValue]) => ({
    role,
    input: inputValue,
    file: files.find(
      (candidate) =>
        candidate.kind === expectedKinds[role] &&
        candidate.sha256 === inputValue.sha256 &&
        candidate.original_filename === inputValue.filename,
    ),
  }));
  const missing = resolved
    .filter((item) => !item.file)
    .map((item) => item.role);
  if (missing.length > 0)
    throw new Error(
      `사전검토 등록 전에 실행에 사용한 원본을 파일명과 내용이 같은 상태로 보관하세요. 누락: ${missing.join(", ")}`,
    );
  return resolved.map((item) => ({
    role: item.role,
    input: item.input,
    file: item.file!,
  }));
}

function input(
  manifest: Map<string, string>,
  prefix: string,
  sourceKey: string,
) {
  const filename = requiredText(manifest, `${prefix}_파일`);
  const hash = requiredText(manifest, `${prefix}_SHA256`);
  const sourceId = requiredText(manifest, sourceKey);
  if (!safeName(filename) || !isSha(hash))
    throw new Error(`${prefix} 입력 근거가 올바르지 않습니다.`);
  return { filename, sha256: hash.toLowerCase(), sourceId };
}
function requiredText(values: Map<string, string>, key: string) {
  const value = values.get(key) ?? "";
  if (!value.trim())
    throw new Error(`사전검토 산출 근거 기록의 필수 항목이 없습니다: ${key}`);
  return value;
}
function safeName(value: string) {
  return Boolean(value) && !value.includes("/") && !value.includes("\\");
}
function decode(value: Uint8Array) {
  return new TextDecoder("utf-8", { fatal: true })
    .decode(value)
    .replace(/^\uFEFF/, "");
}
function sha(value: Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
function isSha(value: string) {
  return /^[0-9a-fA-F]{64}$/.test(value);
}
function decimal(value: string, field: string) {
  if (!/^-?[0-9]+(?:\.[0-9]+)?$/.test(value))
    throw new Error(`${field}가 lossless decimal 형식이 아닙니다.`);
  return value;
}
function optionalDecimal(value: string, row: number, field: string) {
  return value === "" ? null : decimal(value, `${row}행 ${field}`);
}
function original(value: string) {
  let index = 0;
  while (index < value.length && [" ", "\t", "\r", "\n"].includes(value[index]))
    index += 1;
  return value[index] === "'" &&
    index + 1 < value.length &&
    ["'", "=", "+", "-", "@"].includes(value[index + 1])
    ? value.slice(0, index) + value.slice(index + 1)
    : value;
}
