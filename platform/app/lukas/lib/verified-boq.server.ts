import { createHash } from "node:crypto";

import {
  addExact,
  compareExact,
  exactToString,
  exactZero,
  multiplyExact,
  parseExactDecimal,
  roundExact,
} from "./exact-decimal.server.ts";

export type BoqCalculationPolicy =
  "general_half_away" | "ems_component_truncate";

export type BoqResource = {
  id: string;
  code: string;
  type: "material" | "labor" | "equipment" | "expense";
  unit?: string;
  unitPriceKrw: string;
};

export type BoqQuantityMapping = {
  id: string;
  lineId: string;
  sourceFileId: string;
  sourceSha256: string;
  subjectKey: string;
  sourceQuantity: string;
  factor: string;
  unit: "EA" | "m" | "m2" | "m3";
  elementIds: string[];
};

export type BoqRateComponent = {
  id: string;
  lineId: string;
  resourceId: string;
  coefficient: string;
};

export type BoqSourceExclusion = {
  id: string;
  sourceFileId: string;
  sourceSha256: string;
  subjectKey: string;
  sourceQuantity: string;
  unit: "EA" | "m" | "m2" | "m3";
  elementIds: string[];
  reason: string;
};

export type BoqInputLine = {
  id: string;
  sectionCode: string;
  itemCode: string;
  itemName: string;
  specification: string;
  unit: "EA" | "m" | "m2" | "m3";
  signedAdjustment: string;
  adjustmentReason: string;
};

export type VerifiedBoqInput = {
  versionId: string;
  calculationPolicy: BoqCalculationPolicy;
  quantityScale: number;
  lines: BoqInputLine[];
  mappings: BoqQuantityMapping[];
  exclusions?: BoqSourceExclusion[];
  resources: BoqResource[];
  components: BoqRateComponent[];
};

export const VERIFIED_BOQ_ENGINE_VERSION = "VERIFIED-BOQ-1.0" as const;

export type VerifiedBoqLine = {
  lineId: string;
  sectionCode: string;
  itemCode: string;
  itemName: string;
  specification: string;
  unit: string;
  status: "calculated" | "review";
  rawQuantity: string | null;
  adjustment: string;
  finalQuantity: string | null;
  materialUnitPriceKrw: string | null;
  laborUnitPriceKrw: string | null;
  expenseUnitPriceKrw: string | null;
  totalUnitPriceKrw: string | null;
  amountKrw: string | null;
  formula: string;
  sourceSha256: string[];
  elementIds: string[];
  message: string;
};

export type VerifiedBoqResult = {
  engineVersion: typeof VERIFIED_BOQ_ENGINE_VERSION;
  versionId: string;
  calculationPolicy: BoqCalculationPolicy;
  status: "calculated" | "review";
  lines: VerifiedBoqLine[];
  directCostKrw: string;
  exclusions: BoqSourceExclusion[];
  canonicalSha256: string;
};

const sha256Pattern = /^[0-9a-f]{64}$/;
const positiveElementId = /^[1-9][0-9]*$/;

/** @internal Shared exact-engine input used by the additive 1.1 adapter. */
export type VerifiedBoqCalculationMapping = {
  id: string;
  lineId: string;
  sourceKind: "legacy" | "drawing";
  sourceId: string;
  sourceSha256: string;
  sourceQuantity: string;
  factor: string;
  unit: "EA" | "m" | "m2" | "m3";
  elementIds: string[];
};

type VerifiedBoqCoreInput = Omit<VerifiedBoqInput, "mappings"> & {
  mappings: VerifiedBoqCalculationMapping[];
};

type VerifiedBoqCoreResult = Omit<
  VerifiedBoqResult,
  "engineVersion" | "canonicalSha256"
>;

export function calculateVerifiedBoq(
  input: VerifiedBoqInput,
): VerifiedBoqResult {
  const core = calculateVerifiedBoqCore(
    {
      ...input,
      mappings: input.mappings.map((mapping) => ({
        id: mapping.id,
        lineId: mapping.lineId,
        sourceKind: "legacy",
        sourceId: `${mapping.sourceFileId}\u001f${mapping.subjectKey}`,
        sourceSha256: mapping.sourceSha256,
        sourceQuantity: mapping.sourceQuantity,
        factor: mapping.factor,
        unit: mapping.unit,
        elementIds: mapping.elementIds,
      })),
    },
    false,
  );
  const resultWithoutHash = {
    engineVersion: VERIFIED_BOQ_ENGINE_VERSION,
    ...core,
  };
  return {
    ...resultWithoutHash,
    canonicalSha256: createHash("sha256")
      .update(JSON.stringify(resultWithoutHash))
      .digest("hex"),
  };
}

/** @internal Reuses the 1.0 arithmetic without relaxing its public input. */
export function calculateVerifiedBoqCore(
  input: VerifiedBoqCoreInput,
  allowDrawing: boolean,
): VerifiedBoqCoreResult {
  if (!input.versionId.trim()) throw new Error("내역 버전 ID가 없습니다.");
  if (
    !Number.isInteger(input.quantityScale) ||
    input.quantityScale < 0 ||
    input.quantityScale > 9
  )
    throw new Error("수량 반올림 자리수는 0부터 9 사이여야 합니다.");

  const lineById = uniqueBy(input.lines, (item) => item.id, "내역 행 ID");
  uniqueBy(input.lines, (item) => item.itemCode, "품목 코드");
  const resourceById = uniqueBy(input.resources, (item) => item.id, "자원 ID");
  uniqueBy(input.resources, (item) => item.code, "자원 코드");
  uniqueBy(input.mappings, (item) => item.id, "수량 연결 ID");
  uniqueBy(input.exclusions ?? [], (item) => item.id, "제외 결정 ID");
  uniqueBy(input.components, (item) => item.id, "일위대가 구성 ID");

  const mappingsByLine = new Map<string, VerifiedBoqCalculationMapping[]>();
  const sourceFactorTotals = new Map<
    string,
    ReturnType<typeof parseExactDecimal>
  >();
  for (const mapping of input.mappings) {
    if (mapping.sourceKind === "drawing" && !allowDrawing)
      throw new Error("Drawing 원수량은 1.0 계산에 사용할 수 없습니다.");
    if (!mapping.sourceId.trim()) throw new Error("원수량 ID가 비어 있습니다.");
    const line = lineById.get(mapping.lineId);
    if (!line) throw new Error(`수량 연결 ${mapping.id}의 내역 행이 없습니다.`);
    if (mapping.unit !== line.unit)
      throw new Error(`${line.itemCode}의 원수량 단위와 품목 단위가 다릅니다.`);
    if (!sha256Pattern.test(mapping.sourceSha256))
      throw new Error(
        `${line.itemCode}의 원본 파일 확인번호가 올바르지 않습니다.`,
      );
    const quantity = parseExactDecimal(mapping.sourceQuantity, "원수량");
    const factor = parseExactDecimal(mapping.factor, "연결 계수");
    if (compareExact(quantity, exactZero) < 0)
      throw new Error(`${line.itemCode}의 원수량은 음수일 수 없습니다.`);
    if (compareExact(factor, exactZero) <= 0)
      throw new Error(`${line.itemCode}의 연결 계수는 0보다 커야 합니다.`);
    const canonicalIds = canonicalElementIds(mapping.elementIds);
    if (mapping.sourceKind === "legacy" && canonicalIds.length === 0)
      throw new Error(`${line.itemCode}의 원본 Element ID가 없습니다.`);
    if (mapping.sourceKind === "drawing" && canonicalIds.length !== 0)
      throw new Error("Drawing 원수량에는 Element ID를 복제할 수 없습니다.");
    const normalizedMapping = { ...mapping, elementIds: canonicalIds };
    const sourceKey = `${mapping.sourceKind}\u001f${mapping.sourceId}\u001f${mapping.unit}`;
    sourceFactorTotals.set(
      sourceKey,
      addExact(sourceFactorTotals.get(sourceKey) ?? exactZero, factor),
    );
    const rows = mappingsByLine.get(mapping.lineId) ?? [];
    rows.push(normalizedMapping);
    mappingsByLine.set(mapping.lineId, rows);
  }
  const one = parseExactDecimal("1");
  for (const factorTotal of sourceFactorTotals.values())
    if (compareExact(factorTotal, one) !== 0)
      throw new Error("같은 원수량의 연결 계수 합계는 정확히 1이어야 합니다.");

  const mappedSourceKeys = new Set(
    input.mappings
      .filter((mapping) => mapping.sourceKind === "legacy")
      .map((mapping) => `${mapping.sourceId}\u001f${mapping.unit}`),
  );
  const exclusionKeys = new Set<string>();
  const exclusions = (input.exclusions ?? [])
    .map((exclusion) => {
      if (!sha256Pattern.test(exclusion.sourceSha256))
        throw new Error("제외 결정의 원본 파일 확인번호가 올바르지 않습니다.");
      if (!exclusion.reason.trim())
        throw new Error("원수량 제외 결정에는 사유가 필요합니다.");
      const key = `${exclusion.sourceFileId}\u001f${exclusion.subjectKey}\u001f${exclusion.unit}`;
      if (mappedSourceKeys.has(key))
        throw new Error("같은 원수량을 연결하면서 동시에 제외할 수 없습니다.");
      if (exclusionKeys.has(key))
        throw new Error("같은 원수량 제외 결정이 중복되었습니다.");
      exclusionKeys.add(key);
      const quantity = parseExactDecimal(
        exclusion.sourceQuantity,
        "제외 원수량",
      );
      if (compareExact(quantity, exactZero) < 0)
        throw new Error("제외 원수량은 음수일 수 없습니다.");
      return {
        ...exclusion,
        sourceQuantity: exactToString(quantity),
        elementIds: canonicalElementIds(exclusion.elementIds),
        reason: exclusion.reason.normalize("NFKC").trim(),
      };
    })
    .sort((left, right) =>
      `${left.sourceSha256}\u001f${left.subjectKey}\u001f${left.unit}`.localeCompare(
        `${right.sourceSha256}\u001f${right.subjectKey}\u001f${right.unit}`,
      ),
    );

  const componentsByLine = new Map<string, BoqRateComponent[]>();
  const componentKeys = new Set<string>();
  for (const component of input.components) {
    const line = lineById.get(component.lineId);
    const resource = resourceById.get(component.resourceId);
    if (!line)
      throw new Error(`일위대가 구성 ${component.id}의 내역 행이 없습니다.`);
    if (!resource)
      throw new Error(`일위대가 구성 ${component.id}의 자원이 없습니다.`);
    const key = `${component.lineId}\u001f${component.resourceId}`;
    if (componentKeys.has(key))
      throw new Error(`${line.itemCode}에 같은 자원이 중복 연결되었습니다.`);
    componentKeys.add(key);
    if (
      compareExact(
        parseExactDecimal(component.coefficient, "자원 소요계수"),
        exactZero,
      ) <= 0
    )
      throw new Error(`${line.itemCode}의 자원 소요계수는 0보다 커야 합니다.`);
    if (
      compareExact(
        parseExactDecimal(resource.unitPriceKrw, "자원 단가"),
        exactZero,
      ) < 0
    )
      throw new Error(`${resource.code}의 단가는 음수일 수 없습니다.`);
    const rows = componentsByLine.get(component.lineId) ?? [];
    rows.push(component);
    componentsByLine.set(component.lineId, rows);
  }

  const lines = input.lines.map((line) =>
    calculateLine(
      line,
      mappingsByLine.get(line.id) ?? [],
      componentsByLine.get(line.id) ?? [],
      resourceById,
      input.calculationPolicy,
      input.quantityScale,
    ),
  );
  const directCost = lines.reduce(
    (total, line) =>
      line.amountKrw === null
        ? total
        : addExact(total, parseExactDecimal(line.amountKrw, "내역 금액")),
    exactZero,
  );
  return {
    versionId: input.versionId,
    calculationPolicy: input.calculationPolicy,
    status: lines.every((line) => line.status === "calculated")
      ? ("calculated" as const)
      : ("review" as const),
    lines,
    directCostKrw: exactToString(directCost),
    exclusions,
  };
}

function calculateLine(
  line: BoqInputLine,
  mappings: VerifiedBoqCalculationMapping[],
  components: BoqRateComponent[],
  resources: Map<string, BoqResource>,
  policy: BoqCalculationPolicy,
  quantityScale: number,
): VerifiedBoqLine {
  const adjustment = parseExactDecimal(line.signedAdjustment, "보정수량");
  if (
    compareExact(adjustment, exactZero) !== 0 &&
    !line.adjustmentReason.trim()
  )
    throw new Error(`${line.itemCode}의 보정 사유가 없습니다.`);
  const base = {
    lineId: line.id,
    sectionCode: line.sectionCode,
    itemCode: line.itemCode,
    itemName: line.itemName,
    specification: line.specification,
    unit: line.unit,
    adjustment: exactToString(adjustment),
  };
  if (mappings.length === 0 || components.length === 0)
    return {
      ...base,
      status: "review",
      rawQuantity: null,
      finalQuantity: null,
      materialUnitPriceKrw: null,
      laborUnitPriceKrw: null,
      expenseUnitPriceKrw: null,
      totalUnitPriceKrw: null,
      amountKrw: null,
      formula: "",
      sourceSha256: [],
      elementIds: [],
      message:
        mappings.length === 0
          ? "원수량 연결이 필요합니다."
          : "단가 자원 연결이 필요합니다.",
    };

  const raw = mappings.reduce(
    (total, mapping) =>
      addExact(
        total,
        multiplyExact(
          parseExactDecimal(mapping.sourceQuantity, "원수량"),
          parseExactDecimal(mapping.factor, "연결 계수"),
        ),
      ),
    exactZero,
  );
  const finalQuantity = roundExact(
    addExact(raw, adjustment),
    quantityScale,
    "half_away_from_zero",
  );
  if (compareExact(finalQuantity, exactZero) < 0)
    throw new Error(`${line.itemCode}의 최종수량은 음수일 수 없습니다.`);

  const prices = { material: exactZero, labor: exactZero, expense: exactZero };
  for (const component of components) {
    const resource = resources.get(component.resourceId)!;
    const componentAmount = roundExact(
      multiplyExact(
        parseExactDecimal(component.coefficient, "자원 소요계수"),
        parseExactDecimal(resource.unitPriceKrw, "자원 단가"),
      ),
      6,
      "half_away_from_zero",
    );
    const bucket =
      resource.type === "material"
        ? "material"
        : resource.type === "labor"
          ? "labor"
          : "expense";
    prices[bucket] = addExact(prices[bucket], componentAmount);
  }
  const unitPrice = addExact(
    addExact(prices.material, prices.labor),
    prices.expense,
  );
  let amount;
  let formula;
  if (policy === "ems_component_truncate") {
    amount = addExact(
      addExact(
        roundExact(
          multiplyExact(finalQuantity, prices.material),
          0,
          "truncate",
        ),
        roundExact(multiplyExact(finalQuantity, prices.labor), 0, "truncate"),
      ),
      roundExact(multiplyExact(finalQuantity, prices.expense), 0, "truncate"),
    );
    formula = "TRUNC(Q×M,0)+TRUNC(Q×L,0)+TRUNC(Q×E,0)";
  } else {
    amount = roundExact(
      multiplyExact(finalQuantity, unitPrice),
      0,
      "half_away_from_zero",
    );
    formula = "ROUND_HALF_AWAY(Q×(M+L+E),0)";
  }
  return {
    ...base,
    status: "calculated",
    rawQuantity: exactToString(raw),
    finalQuantity: exactToString(finalQuantity),
    materialUnitPriceKrw: exactToString(prices.material),
    laborUnitPriceKrw: exactToString(prices.labor),
    expenseUnitPriceKrw: exactToString(prices.expense),
    totalUnitPriceKrw: exactToString(unitPrice),
    amountKrw: exactToString(amount),
    formula,
    sourceSha256: [
      ...new Set(mappings.map((item) => item.sourceSha256)),
    ].sort(),
    elementIds: canonicalElementIds(
      mappings.flatMap((item) => item.elementIds),
    ),
    message: "계산 가능",
  };
}

function uniqueBy<T>(rows: T[], key: (row: T) => string, label: string) {
  const result = new Map<string, T>();
  for (const row of rows) {
    const value = key(row).normalize("NFKC").trim();
    if (!value) throw new Error(`${label}가 비어 있습니다.`);
    if (result.has(value)) throw new Error(`중복 ${label}: ${value}`);
    result.set(value, row);
  }
  return result;
}

function canonicalElementIds(values: string[]) {
  const result = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!positiveElementId.test(trimmed))
      throw new Error(`Element ID가 올바르지 않습니다: ${value}`);
    const canonical = BigInt(trimmed).toString();
    if (result.has(canonical)) throw new Error(`중복 Element ID: ${canonical}`);
    result.add(canonical);
  }
  return [...result].sort((left, right) => {
    const a = BigInt(left);
    const b = BigInt(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function csvCell(value: string) {
  const protectedValue = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(protectedValue)
    ? `"${protectedValue.replace(/"/g, '""')}"`
    : protectedValue;
}

export function buildVerifiedBoqCsv(result: VerifiedBoqResult) {
  const header = [
    "engine_version",
    "version_id",
    "status",
    "section_code",
    "item_code",
    "item_name",
    "specification",
    "unit",
    "raw_quantity",
    "adjustment",
    "final_quantity",
    "material_unit_price_krw",
    "labor_unit_price_krw",
    "expense_unit_price_krw",
    "total_unit_price_krw",
    "amount_krw",
    "formula",
    "source_sha256",
    "element_ids",
    "message",
    "result_sha256",
  ];
  const rows = result.lines.map((line) => [
    result.engineVersion,
    result.versionId,
    line.status,
    line.sectionCode,
    line.itemCode,
    line.itemName,
    line.specification,
    line.unit,
    line.rawQuantity ?? "",
    line.adjustment,
    line.finalQuantity ?? "",
    line.materialUnitPriceKrw ?? "",
    line.laborUnitPriceKrw ?? "",
    line.expenseUnitPriceKrw ?? "",
    line.totalUnitPriceKrw ?? "",
    line.amountKrw ?? "",
    line.formula,
    line.sourceSha256.join("|"),
    line.elementIds.join("|"),
    line.message,
    result.canonicalSha256,
  ]);
  for (const exclusion of result.exclusions)
    rows.push([
      result.engineVersion,
      result.versionId,
      "excluded",
      "",
      "",
      "원수량 제외",
      "",
      exclusion.unit,
      exclusion.sourceQuantity,
      "0",
      "",
      "",
      "",
      "",
      "",
      "",
      "EXCLUDE_WITH_REASON",
      exclusion.sourceSha256,
      exclusion.elementIds.join("|"),
      exclusion.reason,
      result.canonicalSha256,
    ]);
  return `\uFEFF${[header, ...rows].map((row) => row.map((value) => csvCell(String(value))).join(",")).join("\r\n")}\r\n`;
}
