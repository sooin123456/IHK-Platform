import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";
import { strToU8, zipSync } from "fflate";

import { parseCsv } from "./element-ledger-suggestions.server.ts";

const IDS_NAMESPACE = "http://standards.buildingsmart.org/IDS";
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
] as const;
const supportedProperties = new Map([
  ["Category", 1],
  ["Family", 2],
  ["Type", 3],
  ["Name", 4],
  ["Level", 5],
  ["Volume", 7],
  ["Length", 10],
  ["Height", 13],
]);
const entityByCategory = new Map([
  ["Walls", "IFCWALL"],
  ["Floors", "IFCSLAB"],
  ["Doors", "IFCDOOR"],
  ["Windows", "IFCWINDOW"],
  ["Structural Framing", "IFCBEAM"],
  ["Structural Columns", "IFCCOLUMN"],
]);

type XmlNode = Record<string, unknown>;
type LedgerRow = Record<(typeof ledgerHeader)[number], string>;

export type InformationRequirementFinding = {
  key: string;
  specification: string;
  status: "PASS" | "FAIL" | "REVIEW";
  requirement: string;
  expected: string | null;
  checkedCount: number;
  failedCount: number;
  elementIds: string[];
  message: string;
};

export type InformationRequirementResult = {
  idsTitle: string;
  idsVersion: "1.0";
  idsSha256: string;
  ledgerSha256: string;
  findings: InformationRequirementFinding[];
};

function sha(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
function array<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}
function node(value: unknown): XmlNode {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XmlNode)
    : {};
}
function textValue(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number")
    return String(value).trim() || null;
  const candidate = node(value);
  for (const key of ["simpleValue", "xs:simpleValue", "#text"])
    if (typeof candidate[key] === "string" && candidate[key].trim())
      return candidate[key].trim();
  return null;
}
function exactValue(value: unknown): string | null {
  const direct = textValue(value);
  if (direct) return direct;
  const restriction = node(node(value).restriction);
  const enumeration = array(restriction.enumeration as XmlNode | XmlNode[]).map(
    (entry) => textValue(node(entry)["@_value"] ?? entry),
  );
  return enumeration.length === 1 ? enumeration[0] : null;
}
function requireLedger(bytes: Uint8Array): LedgerRow[] {
  const csv = parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (
    csv.length < 2 ||
    csv[0].length !== ledgerHeader.length ||
    !ledgerHeader.every((name, index) => csv[0][index] === name)
  )
    throw new Error("element-ledger.csv 헤더 또는 데이터 행이 없습니다.");
  const ids = new Set<string>();
  return csv.slice(1).map((values, rowIndex) => {
    if (values.length !== ledgerHeader.length)
      throw new Error(`element-ledger ${rowIndex + 2}행 열 수가 다릅니다.`);
    const row = Object.fromEntries(
      ledgerHeader.map((name, index) => [name, values[index]]),
    ) as LedgerRow;
    if (!/^[1-9][0-9]*$/.test(row.element_id) || ids.has(row.element_id))
      throw new Error(`element-ledger ${rowIndex + 2}행 ID가 잘못되거나 중복됩니다.`);
    ids.add(row.element_id);
    return row;
  });
}

export function checkIdsAgainstElementLedger(
  idsBytes: Uint8Array,
  ledgerBytes: Uint8Array,
): InformationRequirementResult {
  if (idsBytes.byteLength === 0 || idsBytes.byteLength > 5 * 1024 * 1024)
    throw new Error("IDS 파일은 1바이트 이상 5MB 이하여야 합니다.");
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(idsBytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("외부 엔터티가 포함된 IDS는 처리하지 않습니다.");
  const parsed = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  }).parse(xml);
  const ids = node(node(parsed).ids);
  if (!Object.keys(ids).length)
    throw new Error("IDS 1.0 루트 요소를 찾을 수 없습니다.");
  const namespace = String(node(node(parsed).ids)["@_xmlns"] ?? IDS_NAMESPACE);
  if (namespace !== IDS_NAMESPACE && !xml.includes(IDS_NAMESPACE))
    throw new Error("buildingSMART IDS 1.0 namespace가 아닙니다.");
  const title = textValue(node(ids.info).title);
  if (!title) throw new Error("IDS info/title이 필요합니다.");
  const specifications = array(
    node(ids.specifications).specification as XmlNode | XmlNode[],
  );
  if (specifications.length === 0)
    throw new Error("IDS specification이 하나 이상 필요합니다.");
  const rows = requireLedger(ledgerBytes);
  const findings: InformationRequirementFinding[] = [];

  for (const [specIndex, rawSpecification] of specifications.entries()) {
    const specification = node(rawSpecification);
    const specificationName =
      textValue(specification["@_name"]) ?? `Specification ${specIndex + 1}`;
    const applicability = node(specification.applicability);
    const facets = Object.keys(applicability).filter(
      (key) => !key.startsWith("@_") && key !== "entity",
    );
    const entities = array(applicability.entity as XmlNode | XmlNode[]);
    if (facets.length > 0 || entities.length > 1) {
      findings.push({
        key: `${specIndex + 1}:applicability`,
        specification: specificationName,
        status: "REVIEW",
        requirement: "applicability",
        expected: null,
        checkedCount: 0,
        failedCount: 0,
        elementIds: [],
        message: "현재 웹 원장은 IDS entity 단일 exact 적용범위만 자동 판정합니다.",
      });
      continue;
    }
    const entityName = entities.length
      ? exactValue(node(entities[0]).name)?.toUpperCase()
      : null;
    if (entities.length && !entityName) {
      findings.push({
        key: `${specIndex + 1}:entity`,
        specification: specificationName,
        status: "REVIEW",
        requirement: "entity",
        expected: null,
        checkedCount: 0,
        failedCount: 0,
        elementIds: [],
        message: "정규식·복수 entity 적용범위는 IFC 전문 검사기에서 확인해야 합니다.",
      });
      continue;
    }
    const selected = entityName
      ? rows.filter((row) => entityByCategory.get(row.category) === entityName)
      : rows;
    const requirements = node(specification.requirements);
    const unsupported = Object.keys(requirements).filter(
      (key) => !key.startsWith("@_") && key !== "property",
    );
    if (unsupported.length > 0) {
      findings.push({
        key: `${specIndex + 1}:requirements`,
        specification: specificationName,
        status: "REVIEW",
        requirement: unsupported.join("|"),
        expected: null,
        checkedCount: selected.length,
        failedCount: 0,
        elementIds: [],
        message: "분류·재료·관계 facet은 IFC 전문 검사기에서 확인해야 합니다.",
      });
    }
    for (const [propertyIndex, rawProperty] of array(
      requirements.property as XmlNode | XmlNode[],
    ).entries()) {
      const property = node(rawProperty);
      const setName = exactValue(property.propertySet);
      const baseName = exactValue(property.baseName);
      const expected = exactValue(property.value);
      const column = baseName ? supportedProperties.get(baseName) : undefined;
      if (setName !== "LukasQTO" || column === undefined) {
        findings.push({
          key: `${specIndex + 1}:property:${propertyIndex + 1}`,
          specification: specificationName,
          status: "REVIEW",
          requirement: `${setName ?? "?"}.${baseName ?? "?"}`,
          expected,
          checkedCount: selected.length,
          failedCount: 0,
          elementIds: [],
          message: "웹 element-ledger 범위를 벗어난 IFC 속성은 추정하지 않습니다.",
        });
        continue;
      }
      const failed = selected.filter((row) => {
        const value = row[ledgerHeader[column]].trim();
        return !value || (expected !== null && value !== expected);
      });
      findings.push({
        key: `${specIndex + 1}:property:${propertyIndex + 1}`,
        specification: specificationName,
        status: selected.length === 0 || failed.length > 0 ? "FAIL" : "PASS",
        requirement: `LukasQTO.${baseName}`,
        expected,
        checkedCount: selected.length,
        failedCount: failed.length,
        elementIds: failed.slice(0, 100).map((row) => row.element_id),
        message:
          selected.length === 0
            ? "적용 대상 요소가 없습니다."
            : failed.length
              ? "필수 값이 없거나 exact 값과 다릅니다."
              : "선택된 요소가 요구사항을 충족합니다.",
      });
    }
  }
  if (findings.length === 0)
    throw new Error("자동 확인 가능한 IDS 요구사항이 없습니다.");
  return {
    idsTitle: title,
    idsVersion: "1.0",
    idsSha256: sha(idsBytes),
    ledgerSha256: sha(ledgerBytes),
    findings,
  };
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
function stableGuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function buildBcf21FromRequirementFindings(
  result: InformationRequirementResult,
  createdAtUtc: string,
) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(createdAtUtc))
    throw new Error("BCF 생성시각은 UTC ISO-8601 형식이어야 합니다.");
  const failures = result.findings.filter((finding) => finding.status !== "PASS");
  if (failures.length === 0)
    throw new Error("BCF로 반환할 FAIL 또는 REVIEW 요구사항이 없습니다.");
  const files: Record<string, Uint8Array> = {
    "bcf.version": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Version VersionId="2.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"/>',
    ),
  };
  for (const finding of failures) {
    const guid = stableGuid(`${result.idsSha256}:${result.ledgerSha256}:${finding.key}`);
    const title = `${finding.status} · ${finding.specification} · ${finding.requirement}`;
    const description = `${finding.message} checked=${finding.checkedCount}; failed=${finding.failedCount}; element_ids=${finding.elementIds.join("|") || "none"}`;
    files[`${guid}/markup.bcf`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><Markup><Topic Guid="${guid}" TopicType="Error" TopicStatus="Open"><Title>${escapeXml(title)}</Title><CreationDate>${createdAtUtc}</CreationDate><CreationAuthor>system@lukas-qto.local</CreationAuthor><Description>${escapeXml(description)}</Description></Topic></Markup>`,
    );
  }
  return zipSync(files, { level: 6 });
}
