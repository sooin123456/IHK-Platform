import { Unzip, UnzipInflate, unzipSync } from "fflate";

import {
  compareExact,
  exactToString,
  exactZero,
  parseExactDecimal,
} from "./exact-decimal.server.ts";

export type VerifiedBoqPriceResourceImport = {
  resourceCode: string;
  resourceType: "material" | "labor" | "equipment" | "expense";
  resourceName: string;
  specification: string;
  unit: "EA" | "m" | "m2" | "m3" | "kg" | "t" | "day" | "hr";
  unitPriceKrw: string;
};

export const VERIFIED_BOQ_PRICEBOOK_HEADER = [
  "resource_code",
  "resource_type",
  "resource_name",
  "specification",
  "unit",
  "unit_price_krw",
] as const;

export type VerifiedBoqPriceBookHeader =
  (typeof VERIFIED_BOQ_PRICEBOOK_HEADER)[number];

export type VerifiedBoqPriceBookHeaderMapping = {
  sourceColumn: number;
  sourceHeader: string;
  requiredHeader: VerifiedBoqPriceBookHeader | null;
};

export type VerifiedBoqPriceBookAnalysisError = {
  row: number | null;
  field: VerifiedBoqPriceBookHeader | null;
  reason: string;
};

export type VerifiedBoqPriceBookAnalysis = {
  headerMapping: VerifiedBoqPriceBookHeaderMapping[];
  validRows: VerifiedBoqPriceResourceImport[];
  errors: VerifiedBoqPriceBookAnalysisError[];
  totalErrorCount: number;
  errorsTruncated: boolean;
};

const resourceTypes = new Set(["material", "labor", "equipment", "expense"]);
const units = new Set(["EA", "m", "m2", "m3", "kg", "t", "day", "hr"]);
const priceBookHeaders = new Set<string>(VERIFIED_BOQ_PRICEBOOK_HEADER);
const analysisErrorLimit = 100;
const analysisReasonLimit = 500;
const maxPriceBookBytes = 20 * 1024 * 1024;
const maxTableRows = 50_001;
const maxXlsxArchiveEntries = 256;
const maxXlsxExpandedBytes = 32 * 1024 * 1024;
const maxXlsxColumnIndex = 16_383;
const xlsxArchiveInputChunkBytes = 1024;
const commonPriceBookContentTypes = new Set([
  "application/octet-stream",
  "application/vnd.ms-excel",
]);
const csvContentTypes = new Set([
  "application/csv",
  "text/comma-separated-values",
  "text/csv",
  "text/plain",
]);
const xlsxContentTypes = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/x-zip-compressed",
  "application/zip",
]);

export function validateVerifiedBoqPriceBookFileMetadata({
  filename,
  contentType,
  byteSize,
}: {
  filename: string;
  contentType: string;
  byteSize: number;
}): string | null {
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0)
    return "단가표 원본 파일이 비어 있습니다.";
  if (byteSize > maxPriceBookBytes)
    return "단가표 원본 파일은 20MB까지 지원합니다.";
  const lowerFilename = filename.trim().toLowerCase();
  const format = lowerFilename.endsWith(".csv")
    ? "csv"
    : lowerFilename.endsWith(".xlsx")
      ? "xlsx"
      : null;
  if (!format)
    return "단가표 일괄 가져오기는 UTF-8 CSV 또는 XLSX만 지원합니다.";
  const normalizedContentType = contentType
    .split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (
    !commonPriceBookContentTypes.has(normalizedContentType) &&
    !(format === "csv"
      ? csvContentTypes.has(normalizedContentType)
      : xlsxContentTypes.has(normalizedContentType))
  )
    return "단가표 원본 파일 형식 정보가 확장자와 일치하지 않습니다.";
  return null;
}

export function analyzeVerifiedBoqPriceBook(
  bytes: Uint8Array,
  filename: string,
): VerifiedBoqPriceBookAnalysis {
  let rows: string[][];
  try {
    rows = readVerifiedBoqTable(
      bytes,
      filename,
      VERIFIED_BOQ_PRICEBOOK_HEADER.length,
      "단가표",
    );
  } catch (error) {
    return {
      headerMapping: [],
      validRows: [],
      errors: [
        {
          row: null,
          field: null,
          reason: boundedAnalysisReason(errorMessage(error)),
        },
      ],
      totalErrorCount: 1,
      errorsTruncated: false,
    };
  }

  const sourceHeader = rows[0] ?? [];
  const headerMapping = sourceHeader.map(
    (sourceHeader, index): VerifiedBoqPriceBookHeaderMapping => ({
      sourceColumn: index + 1,
      sourceHeader,
      requiredHeader: priceBookHeaders.has(sourceHeader)
        ? (sourceHeader as VerifiedBoqPriceBookHeader)
        : null,
    }),
  );
  const errors: VerifiedBoqPriceBookAnalysisError[] = [];
  let totalErrorCount = 0;
  const addError = (
    row: number | null,
    field: VerifiedBoqPriceBookHeader | null,
    reason: string,
  ) => {
    totalErrorCount += 1;
    if (errors.length < analysisErrorLimit)
      errors.push({ row, field, reason: boundedAnalysisReason(reason) });
  };

  if (rows.length < 2)
    addError(null, null, "단가표에 자원 데이터 행이 없습니다.");
  const exactHeader =
    sourceHeader.length === VERIFIED_BOQ_PRICEBOOK_HEADER.length &&
    VERIFIED_BOQ_PRICEBOOK_HEADER.every(
      (name, index) => sourceHeader[index] === name,
    );
  if (!exactHeader)
    addError(
      1,
      null,
      "단가표 헤더가 검증 내역서 자원 계약과 일치하지 않습니다.",
    );

  const sourceColumns = new Map<VerifiedBoqPriceBookHeader, number>();
  for (const mapping of headerMapping)
    if (
      mapping.requiredHeader !== null &&
      !sourceColumns.has(mapping.requiredHeader)
    )
      sourceColumns.set(mapping.requiredHeader, mapping.sourceColumn - 1);
  const seen = new Set<string>();
  const validRows: VerifiedBoqPriceResourceImport[] = [];

  for (const [index, row] of rows.slice(1).entries()) {
    const line = index + 2;
    const errorsBeforeRow = totalErrorCount;
    if (row.length !== VERIFIED_BOQ_PRICEBOOK_HEADER.length)
      addError(line, null, `단가표 ${line}행의 열 개수가 올바르지 않습니다.`);
    const value = (field: VerifiedBoqPriceBookHeader) =>
      row[sourceColumns.get(field) ?? -1] ?? "";
    const rawCode = value("resource_code");
    const rawType = value("resource_type");
    const rawName = value("resource_name");
    const rawSpecification = value("specification");
    const rawUnit = value("unit");
    const rawPrice = value("unit_price_krw");

    let resourceCode: string | undefined;
    try {
      resourceCode = required(rawCode, 80, `단가표 ${line}행 자원 코드`);
    } catch (error) {
      addError(line, "resource_code", errorMessage(error));
    }
    if (resourceCode && /^[=+\-@]/.test(resourceCode)) {
      addError(
        line,
        "resource_code",
        `단가표 ${line}행 자원 코드는 수식 문자로 시작할 수 없습니다.`,
      );
      resourceCode = undefined;
    }
    if (resourceCode) {
      if (seen.has(resourceCode))
        addError(
          line,
          "resource_code",
          `단가표 자원 코드가 중복되었습니다: ${resourceCode}`,
        );
      else seen.add(resourceCode);
    }

    const resourceType = resourceTypes.has(rawType)
      ? (rawType as VerifiedBoqPriceResourceImport["resourceType"])
      : undefined;
    if (!resourceType)
      addError(
        line,
        "resource_type",
        `단가표 ${line}행 자원 구분이 올바르지 않습니다.`,
      );
    const unit = units.has(rawUnit)
      ? (rawUnit as VerifiedBoqPriceResourceImport["unit"])
      : undefined;
    if (!unit)
      addError(line, "unit", `단가표 ${line}행 단위가 올바르지 않습니다.`);

    let unitPriceKrw: string | undefined;
    try {
      const price = parseExactDecimal(rawPrice, `단가표 ${line}행 단가`);
      if (compareExact(price, exactZero) < 0)
        addError(
          line,
          "unit_price_krw",
          `단가표 ${line}행 단가는 음수일 수 없습니다.`,
        );
      else unitPriceKrw = exactToString(price);
    } catch (error) {
      addError(line, "unit_price_krw", errorMessage(error));
    }

    let resourceName: string | undefined;
    try {
      resourceName = required(rawName, 160, `단가표 ${line}행 자원명`);
    } catch (error) {
      addError(line, "resource_name", errorMessage(error));
    }
    let specification: string | undefined;
    try {
      specification = limited(rawSpecification, 200, `단가표 ${line}행 규격`);
    } catch (error) {
      addError(line, "specification", errorMessage(error));
    }

    if (
      errorsBeforeRow === totalErrorCount &&
      resourceCode !== undefined &&
      resourceType !== undefined &&
      resourceName !== undefined &&
      specification !== undefined &&
      unit !== undefined &&
      unitPriceKrw !== undefined
    )
      validRows.push({
        resourceCode,
        resourceType,
        resourceName,
        specification,
        unit,
        unitPriceKrw,
      });
  }

  return {
    headerMapping,
    validRows,
    errors,
    totalErrorCount,
    errorsTruncated: totalErrorCount > errors.length,
  };
}

export function parseVerifiedBoqPriceBook(
  bytes: Uint8Array,
  filename: string,
): VerifiedBoqPriceResourceImport[] {
  const analysis = analyzeVerifiedBoqPriceBook(bytes, filename);
  if (analysis.totalErrorCount > 0)
    throw new Error(
      analysis.errors[0]?.reason ?? "단가표 파일을 분석하지 못했습니다.",
    );
  return analysis.validRows;
}

export function readVerifiedBoqTable(
  bytes: Uint8Array,
  filename: string,
  columnCount: number,
  label: string,
) {
  if (bytes.byteLength > maxPriceBookBytes)
    throw new Error(`${label} 원본 파일은 20MB까지 지원합니다.`);
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv"))
    return parseCsv(
      new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, ""),
      columnCount,
      label,
    );
  if (lower.endsWith(".xlsx"))
    return parseFirstXlsxSheet(bytes, columnCount, label);
  throw new Error(`${label} 일괄 가져오기는 UTF-8 CSV 또는 XLSX만 지원합니다.`);
}

export function buildVerifiedBoqPriceBookTemplateCsv() {
  return `\uFEFF${VERIFIED_BOQ_PRICEBOOK_HEADER.join(",")}\r\nM-001,material,콘크리트,25-270-15,m3,0\r\n`;
}

export function buildVerifiedBoqPriceBookAnalysisErrorsCsv(
  errors: readonly VerifiedBoqPriceBookAnalysisError[],
) {
  const rows = [
    ["row", "field", "reason"],
    ...errors.map((error) => [
      error.row === null ? "" : String(error.row),
      error.field ?? "",
      error.reason,
    ]),
  ];
  return `\uFEFF${rows
    .map((row) => row.map(formulaSafeCsvCell).join(","))
    .join("\r\n")}\r\n`;
}

function formulaSafeCsvCell(value: string) {
  const safe = /^[\t ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "단가표 파일을 분석하지 못했습니다.";
}

function boundedAnalysisReason(reason: string) {
  if (reason.length <= analysisReasonLimit) return reason;
  return `${reason.slice(0, analysisReasonLimit - 1)}…`;
}

function required(value: string, max: number, label: string) {
  const normalized = value.normalize("NFKC").trim();
  if (!normalized || normalized.length > max)
    throw new Error(`${label}가 비어 있거나 너무 깁니다.`);
  return normalized;
}

function limited(value: string, max: number, label: string) {
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > max) throw new Error(`${label}이 너무 깁니다.`);
  return normalized;
}

function parseFirstXlsxSheet(
  bytes: Uint8Array,
  columnCount: number,
  label: string,
) {
  let archive: Record<string, Uint8Array>;
  try {
    archive = readBoundedXlsxArchive(bytes);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("XLSX "))
      throw error;
    throw new Error("XLSX 압축 구조를 읽지 못했습니다.");
  }
  const workbook = xml(archive, "xl/workbook.xml");
  const relationships = xml(archive, "xl/_rels/workbook.xml.rels");
  const relationId = /<sheet\b[^>]*\br:id="([^"]+)"/i.exec(workbook)?.[1];
  if (!relationId) throw new Error("XLSX 첫 워크시트를 찾지 못했습니다.");
  const escapedId = escapeRegExp(relationId);
  const target = new RegExp(
    `<Relationship\\b(?=[^>]*\\bId="${escapedId}")(?=[^>]*\\bTarget="([^"]+)")[^>]*/?>`,
    "i",
  ).exec(relationships)?.[1];
  if (!target || target.includes(".."))
    throw new Error("XLSX 워크시트 관계가 올바르지 않습니다.");
  const sheetPath = target.startsWith("/")
    ? target.slice(1)
    : `xl/${target.replace(/^\.\//, "")}`;
  if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(sheetPath))
    throw new Error("XLSX 워크시트 관계가 올바르지 않습니다.");
  const sheet = xml(archive, sheetPath);
  if (/<f(?:\s|>)/i.test(sheet))
    throw new Error(
      `${label} 가져오기 셀에는 Excel 수식을 사용할 수 없습니다.`,
    );
  const shared = archive["xl/sharedStrings.xml"]
    ? parseSharedStrings(xml(archive, "xl/sharedStrings.xml"))
    : [];
  const parsed = new Map<number, Map<number, string>>();
  let maxRow = 0;
  let cellCount = 0;
  const maxTableCells = maxTableRows * Math.min(Math.max(columnCount, 1), 32);
  for (const match of sheet.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
    cellCount += 1;
    if (cellCount > maxTableCells)
      throw new Error("XLSX 셀 수가 허용 범위를 초과합니다.");
    const reference = /\br="([A-Z]+)([1-9][0-9]*)"/i.exec(match[1]);
    if (!reference) throw new Error("XLSX 셀 주소가 없습니다.");
    const rowNumber = Number(reference[2]);
    if (!Number.isSafeInteger(rowNumber) || rowNumber > maxTableRows)
      throw new Error("XLSX 행 번호가 허용 범위를 초과합니다.");
    const row = rowNumber - 1;
    const column = columnIndex(reference[1]);
    if (column > maxXlsxColumnIndex)
      throw new Error("XLSX 열 번호가 허용 범위를 초과합니다.");
    const type = /\bt="([^"]+)"/i.exec(match[1])?.[1] ?? "n";
    const body = match[2];
    let value = "";
    if (type === "inlineStr") value = joinText(body);
    else {
      const raw = /<v>([\s\S]*?)<\/v>/i.exec(body)?.[1] ?? "";
      value = decodeXml(raw);
      if (type === "s") {
        const index = Number(value);
        if (!Number.isInteger(index) || shared[index] === undefined)
          throw new Error("XLSX 공유 문자열 인덱스가 올바르지 않습니다.");
        value = shared[index];
      } else if (type !== "n" && type !== "str")
        throw new Error(`지원하지 않는 XLSX 셀 타입입니다: ${type}`);
    }
    const values = parsed.get(row) ?? new Map<number, string>();
    values.set(column, value);
    parsed.set(row, values);
    maxRow = Math.max(maxRow, row);
  }
  const rows: string[][] = [];
  for (let row = 0; row <= maxRow; row += 1) {
    const values = parsed.get(row) ?? new Map<number, string>();
    rows.push(
      Array.from(
        { length: columnCount },
        (_, column) => values.get(column) ?? "",
      ),
    );
  }
  return rows.filter((row, index) => index === 0 || row.some(Boolean));
}

function readBoundedXlsxArchive(bytes: Uint8Array) {
  validateXlsxArchiveEntries(bytes);

  const archive: Record<string, Uint8Array> = {};
  let localEntryCount = 0;
  let actualExpandedBytes = 0;
  let failure: Error | null = null;
  const unzip = new Unzip((entry) => {
    if (failure) return;
    localEntryCount += 1;
    if (localEntryCount > maxXlsxArchiveEntries) {
      failure = new Error("XLSX 압축 항목 수가 허용 범위를 초과합니다.");
      return;
    }
    const path = entry.name.replaceAll("\\", "/");
    if (path.startsWith("/") || path.split("/").includes("..")) {
      failure = new Error("XLSX 압축 항목 경로가 올바르지 않습니다.");
      return;
    }
    if (!isSelectedXlsxArchivePath(path)) return;
    const chunks: Uint8Array[] = [];
    entry.ondata = (error, chunk, final) => {
      if (failure) return;
      if (error || !chunk) {
        failure = new Error("XLSX 압축 구조를 읽지 못했습니다.");
        return;
      }
      actualExpandedBytes += chunk.byteLength;
      if (
        !Number.isSafeInteger(actualExpandedBytes) ||
        actualExpandedBytes > maxXlsxExpandedBytes
      ) {
        failure = new Error("XLSX 압축 해제 크기가 허용 범위를 초과합니다.");
        return;
      }
      chunks.push(chunk);
      if (final) archive[path] = concatXlsxChunks(chunks);
    };
    entry.start();
  });
  unzip.register(UnzipInflate);
  for (
    let offset = 0;
    offset < bytes.length;
    offset += xlsxArchiveInputChunkBytes
  ) {
    const end = Math.min(offset + xlsxArchiveInputChunkBytes, bytes.length);
    unzip.push(bytes.subarray(offset, end), end === bytes.length);
    if (failure) throw failure;
  }
  return archive;
}

function validateXlsxArchiveEntries(bytes: Uint8Array) {
  let entryCount = 0;
  let declaredExpandedBytes = 0;

  unzipSync(bytes, {
    filter(entry) {
      entryCount += 1;
      if (entryCount > maxXlsxArchiveEntries)
        throw new Error("XLSX 압축 항목 수가 허용 범위를 초과합니다.");

      const compressedSize = entry.size;
      const declaredSize = entry.originalSize;
      if (
        !Number.isSafeInteger(compressedSize) ||
        compressedSize < 0 ||
        !Number.isSafeInteger(declaredSize) ||
        declaredSize < 0
      )
        throw new Error("XLSX 압축 항목 크기가 올바르지 않습니다.");

      declaredExpandedBytes += declaredSize;
      if (
        !Number.isSafeInteger(declaredExpandedBytes) ||
        declaredExpandedBytes > maxXlsxExpandedBytes
      )
        throw new Error("XLSX 압축 해제 크기가 허용 범위를 초과합니다.");

      const path = entry.name.replaceAll("\\", "/");
      if (path.startsWith("/") || path.split("/").includes(".."))
        throw new Error("XLSX 압축 항목 경로가 올바르지 않습니다.");

      return false;
    },
  });
}

function isSelectedXlsxArchivePath(path: string) {
  return (
    path === "xl/workbook.xml" ||
    path === "xl/_rels/workbook.xml.rels" ||
    path === "xl/sharedStrings.xml" ||
    /^xl\/worksheets\/[^/]+\.xml$/i.test(path)
  );
}

function concatXlsxChunks(chunks: readonly Uint8Array[]) {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  if (!Number.isSafeInteger(size))
    throw new Error("XLSX 압축 구조를 읽지 못했습니다.");
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function parseSharedStrings(source: string) {
  return [...source.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map(
    (match) => joinText(match[1]),
  );
}

function joinText(source: string) {
  return [...source.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function xml(archive: Record<string, Uint8Array>, path: string) {
  const value = archive[path];
  if (!value) throw new Error(`XLSX 구성 파일이 없습니다: ${path}`);
  return new TextDecoder("utf-8", { fatal: true }).decode(value);
}

function columnIndex(value: string) {
  let result = 0;
  for (const character of value.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
    if (!Number.isSafeInteger(result) || result > maxXlsxColumnIndex + 1)
      throw new Error("XLSX 열 번호가 허용 범위를 초과합니다.");
  }
  return result - 1;
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseCsv(text: string, columnCount: number, label: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let cellCount = 0;
  const maxTableCells = maxTableRows * Math.min(Math.max(columnCount, 1), 32);
  const finishCell = () => {
    cellCount += 1;
    if (cellCount > maxTableCells)
      throw new Error(`${label} 셀 수가 허용 범위를 초과합니다.`);
    row.push(cell);
    cell = "";
  };
  const finishRow = () => {
    if (rows.length >= maxTableRows)
      throw new Error(`${label} 데이터 행은 50,000개까지 지원합니다.`);
    finishCell();
    rows.push(row);
    row = [];
  };
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
      finishCell();
    } else if (value === "\r" || value === "\n") {
      if (value === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
    } else cell += value;
  }
  if (quoted) throw new Error("CSV 따옴표가 닫히지 않았습니다.");
  if (cell.length || row.length) finishRow();
  return rows.filter((values) => values.some((value) => value.length > 0));
}
