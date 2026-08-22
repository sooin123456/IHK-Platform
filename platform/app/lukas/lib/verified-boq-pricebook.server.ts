import { unzipSync } from "fflate";

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

const resourceTypes = new Set(["material", "labor", "equipment", "expense"]);
const units = new Set(["EA", "m", "m2", "m3", "kg", "t", "day", "hr"]);

export function parseVerifiedBoqPriceBook(
  bytes: Uint8Array,
  filename: string,
): VerifiedBoqPriceResourceImport[] {
  const rows = readVerifiedBoqTable(
    bytes,
    filename,
    VERIFIED_BOQ_PRICEBOOK_HEADER.length,
    "단가표",
  );
  if (rows.length < 2) throw new Error("단가표에 자원 데이터 행이 없습니다.");
  if (
    rows[0].length !== VERIFIED_BOQ_PRICEBOOK_HEADER.length ||
    VERIFIED_BOQ_PRICEBOOK_HEADER.some((name, index) => rows[0][index] !== name)
  )
    throw new Error("단가표 헤더가 검증 내역서 자원 계약과 일치하지 않습니다.");
  const seen = new Set<string>();
  return rows.slice(1).map((row, index) => {
    if (row.length !== VERIFIED_BOQ_PRICEBOOK_HEADER.length)
      throw new Error(`단가표 ${index + 2}행의 열 개수가 올바르지 않습니다.`);
    const [rawCode, rawType, rawName, specification, rawUnit, rawPrice] = row;
    const resourceCode = required(
      rawCode,
      80,
      `단가표 ${index + 2}행 자원 코드`,
    );
    if (/^[=+\-@]/.test(resourceCode))
      throw new Error(
        `단가표 ${index + 2}행 자원 코드는 수식 문자로 시작할 수 없습니다.`,
      );
    if (seen.has(resourceCode))
      throw new Error(`단가표 자원 코드가 중복되었습니다: ${resourceCode}`);
    seen.add(resourceCode);
    if (!resourceTypes.has(rawType))
      throw new Error(`단가표 ${index + 2}행 자원 구분이 올바르지 않습니다.`);
    if (!units.has(rawUnit))
      throw new Error(`단가표 ${index + 2}행 단위가 올바르지 않습니다.`);
    const price = parseExactDecimal(rawPrice, `단가표 ${index + 2}행 단가`);
    if (compareExact(price, exactZero) < 0)
      throw new Error(`단가표 ${index + 2}행 단가는 음수일 수 없습니다.`);
    return {
      resourceCode,
      resourceType: rawType as VerifiedBoqPriceResourceImport["resourceType"],
      resourceName: required(rawName, 160, `단가표 ${index + 2}행 자원명`),
      specification: limited(specification, 200, `단가표 ${index + 2}행 규격`),
      unit: rawUnit as VerifiedBoqPriceResourceImport["unit"],
      unitPriceKrw: exactToString(price),
    };
  });
}

export function readVerifiedBoqTable(
  bytes: Uint8Array,
  filename: string,
  columnCount: number,
  label: string,
) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv"))
    return parseCsv(
      new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, ""),
    );
  if (lower.endsWith(".xlsx"))
    return parseFirstXlsxSheet(bytes, columnCount, label);
  throw new Error(`${label} 일괄 가져오기는 UTF-8 CSV 또는 XLSX만 지원합니다.`);
}

export function buildVerifiedBoqPriceBookTemplateCsv() {
  return `\uFEFF${VERIFIED_BOQ_PRICEBOOK_HEADER.join(",")}\r\nM-001,material,콘크리트,25-270-15,m3,0\r\n`;
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
    archive = unzipSync(bytes);
  } catch {
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
  for (const match of sheet.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
    const reference = /\br="([A-Z]+)([1-9][0-9]*)"/i.exec(match[1]);
    if (!reference) throw new Error("XLSX 셀 주소가 없습니다.");
    const row = Number(reference[2]) - 1;
    const column = columnIndex(reference[1]);
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
  for (const character of value.toUpperCase())
    result = result * 26 + character.charCodeAt(0) - 64;
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
