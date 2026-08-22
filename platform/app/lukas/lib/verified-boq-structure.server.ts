import {
  compareExact,
  exactToString,
  exactZero,
  parseExactDecimal,
} from "./exact-decimal.server.ts";
import { readVerifiedBoqTable } from "./verified-boq-pricebook.server.ts";

export const VERIFIED_BOQ_STRUCTURE_HEADER = [
  "row_type",
  "parent_code",
  "code",
  "name",
  "specification",
  "unit",
  "signed_adjustment",
  "adjustment_reason",
  "cbs_code",
  "wbs_code",
  "wbs_allocation_percent",
] as const;

export type VerifiedBoqStructureImport = {
  sections: { code: string; name: string }[];
  wbsNodes: { parentCode: string; code: string; name: string }[];
  items: {
    code: string;
    name: string;
    specification: string;
    unit: "EA" | "m" | "m2" | "m3";
    signedAdjustment: string;
    adjustmentReason: string;
    cbsCode: string;
    wbsCode: string;
    wbsAllocationPercent: string;
  }[];
};

const units = new Set(["EA", "m", "m2", "m3"]);

export function parseVerifiedBoqStructure(
  bytes: Uint8Array,
  filename: string,
): VerifiedBoqStructureImport {
  const rows = readVerifiedBoqTable(
    bytes,
    filename,
    VERIFIED_BOQ_STRUCTURE_HEADER.length,
    "내역 체계",
  );
  if (rows.length < 2) throw new Error("내역 체계에 데이터 행이 없습니다.");
  if (
    rows[0].length !== VERIFIED_BOQ_STRUCTURE_HEADER.length ||
    VERIFIED_BOQ_STRUCTURE_HEADER.some((name, index) => rows[0][index] !== name)
  )
    throw new Error("내역 체계 헤더가 지원 계약과 일치하지 않습니다.");
  const result: VerifiedBoqStructureImport = {
    sections: [],
    wbsNodes: [],
    items: [],
  };
  const sectionCodes = new Set<string>();
  const wbsCodes = new Set<string>();
  const itemCodes = new Set<string>();
  for (const [index, row] of rows.slice(1).entries()) {
    const line = index + 2;
    if (row.length !== VERIFIED_BOQ_STRUCTURE_HEADER.length)
      throw new Error(`내역 체계 ${line}행의 열 개수가 올바르지 않습니다.`);
    const [
      rowType,
      rawParent,
      rawCode,
      rawName,
      rawSpecification,
      rawUnit,
      rawAdjustment,
      rawReason,
      rawCbs,
      rawWbs,
      rawPercent,
    ] = row;
    const code = requiredCode(rawCode, `내역 체계 ${line}행 코드`);
    const name = required(rawName, 160, `내역 체계 ${line}행 이름`);
    if (rowType === "CBS") {
      if (sectionCodes.has(code))
        throw new Error(`CBS 코드가 중복되었습니다: ${code}`);
      sectionCodes.add(code);
      result.sections.push({ code, name });
      continue;
    }
    if (rowType === "WBS") {
      if (wbsCodes.has(code))
        throw new Error(`WBS 코드가 중복되었습니다: ${code}`);
      wbsCodes.add(code);
      result.wbsNodes.push({
        parentCode: limited(rawParent, 80, `내역 체계 ${line}행 상위 코드`),
        code,
        name,
      });
      continue;
    }
    if (rowType !== "ITEM")
      throw new Error(`내역 체계 ${line}행 row_type이 올바르지 않습니다.`);
    if (itemCodes.has(code))
      throw new Error(`품목 코드가 중복되었습니다: ${code}`);
    itemCodes.add(code);
    if (!units.has(rawUnit))
      throw new Error(`내역 체계 ${line}행 품목 단위가 올바르지 않습니다.`);
    const adjustment = parseExactDecimal(
      rawAdjustment || "0",
      `내역 체계 ${line}행 보정`,
    );
    const adjustmentReason = limited(
      rawReason,
      1000,
      `내역 체계 ${line}행 보정 사유`,
    );
    if (compareExact(adjustment, exactZero) !== 0 && !adjustmentReason)
      throw new Error(`내역 체계 ${line}행 보정 사유가 필요합니다.`);
    result.items.push({
      code,
      name,
      specification: limited(rawSpecification, 200, `내역 체계 ${line}행 규격`),
      unit: rawUnit as VerifiedBoqStructureImport["items"][number]["unit"],
      signedAdjustment: exactToString(adjustment),
      adjustmentReason,
      cbsCode: requiredCode(rawCbs, `내역 체계 ${line}행 CBS 코드`),
      wbsCode: limited(rawWbs, 80, `내역 체계 ${line}행 WBS 코드`),
      wbsAllocationPercent: limited(
        rawPercent,
        20,
        `내역 체계 ${line}행 WBS 배분율`,
      ),
    });
  }
  if (!result.sections.length || !result.items.length)
    throw new Error("내역 체계에는 CBS와 ITEM이 각각 한 건 이상 필요합니다.");
  validateReferences(result);
  return result;
}

export function buildVerifiedBoqStructureTemplateCsv() {
  return `\uFEFF${VERIFIED_BOQ_STRUCTURE_HEADER.join(",")}\r\nCBS,,01,건축공사,,,,,,,\r\nWBS,,W01,본관,,,,,,,\r\nITEM,,CONC-001,콘크리트,25-270-15,m3,0,,01,W01,100\r\n`;
}

function validateReferences(value: VerifiedBoqStructureImport) {
  const sections = new Set(value.sections.map((row) => row.code));
  const nodes = new Map(value.wbsNodes.map((row) => [row.code, row]));
  for (const node of value.wbsNodes) {
    if (node.parentCode && !nodes.has(node.parentCode))
      throw new Error(`WBS 상위 코드를 찾지 못했습니다: ${node.parentCode}`);
    const visited = new Set([node.code]);
    let current = node;
    let depth = 1;
    while (current.parentCode) {
      if (visited.has(current.parentCode))
        throw new Error(`WBS 계층에 순환 참조가 있습니다: ${node.code}`);
      visited.add(current.parentCode);
      const parent = nodes.get(current.parentCode);
      if (!parent) break;
      current = parent;
      depth += 1;
      if (depth > 3)
        throw new Error(`WBS는 최대 3단계까지만 지원합니다: ${node.code}`);
    }
  }
  for (const item of value.items) {
    if (!sections.has(item.cbsCode))
      throw new Error(`품목의 CBS 코드를 찾지 못했습니다: ${item.cbsCode}`);
    if (item.wbsCode) {
      if (!nodes.has(item.wbsCode))
        throw new Error(`품목의 WBS 코드를 찾지 못했습니다: ${item.wbsCode}`);
      const percent = parseExactDecimal(
        item.wbsAllocationPercent,
        `품목 ${item.code} WBS 배분율`,
      );
      if (compareExact(percent, parseExactDecimal("100")) !== 0)
        throw new Error(
          `일괄 가져오기 품목의 단일 WBS 배분율은 100이어야 합니다: ${item.code}`,
        );
    } else if (item.wbsAllocationPercent)
      throw new Error(`WBS 코드 없이 배분율을 넣을 수 없습니다: ${item.code}`);
  }
}

function requiredCode(value: string, label: string) {
  const code = required(value, 80, label);
  if (/^[=+\-@]/.test(code))
    throw new Error(`${label}는 수식 문자로 시작할 수 없습니다.`);
  return code;
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
