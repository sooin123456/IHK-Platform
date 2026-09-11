import { createHash } from "node:crypto";

import type { DrawingQuantitySource } from "./drawing-quantity-lineage.ts";
import {
  addExact,
  compareExact,
  exactToString,
  exactZero,
  multiplyExact,
  parseExactDecimal,
} from "./exact-decimal.server.ts";
import {
  calculateVerifiedBoq,
  calculateVerifiedBoqCore,
  type BoqQuantityMapping,
  type BoqResource,
  type VerifiedBoqCalculationMapping,
  type VerifiedBoqInput,
  type VerifiedBoqLine,
  type VerifiedBoqResult,
} from "./verified-boq.server.ts";

export const VERIFIED_BOQ_V1_1_ENGINE_VERSION = "VERIFIED-BOQ-1.1" as const;

export type VerifiedBoqDrawingMapping = {
  id: string;
  lineId: string;
  quantityLinkId: string;
  allocationFactor: string;
  source: DrawingQuantitySource;
};

export type VerifiedBoqManifestPriceBook = {
  id: string;
  sourceFileId: string;
  sourceSha256: string;
  effectiveDate: string;
  rightsBasis: string;
};

export type VerifiedBoqV1_1Input = Omit<
  VerifiedBoqInput,
  "mappings" | "resources"
> & {
  engineVersion: typeof VERIFIED_BOQ_V1_1_ENGINE_VERSION;
  legacyMappings: BoqQuantityMapping[];
  drawingMappings: VerifiedBoqDrawingMapping[];
  priceBook: VerifiedBoqManifestPriceBook;
  resources: Array<BoqResource & { unit: string }>;
};

export type VerifiedBoqV1_1Line = Omit<VerifiedBoqLine, "adjustment"> & {
  adjustment: string;
  adjustedQuantity: string | null;
  drawingQuantityLinkIds: string[];
};

export type VerifiedBoqV1_1Result = Omit<
  VerifiedBoqResult,
  "engineVersion" | "lines" | "canonicalSha256"
> & {
  engineVersion: typeof VERIFIED_BOQ_V1_1_ENGINE_VERSION;
  lines: VerifiedBoqV1_1Line[];
  canonicalSha256: string;
};

const sha256Pattern = /^[0-9a-f]{64}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const nativeHandlePattern = /^[1-9A-F][0-9A-F]{0,15}$/;
const positiveElementId = /^[1-9][0-9]*$/;

function bytewise(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function normalizedId(value: string, label: string) {
  const result = value.normalize("NFKC").trim();
  if (!result) throw new Error(`P6B04: ${label}가 비어 있습니다.`);
  return result;
}

function decimal(value: string, label: string) {
  try {
    return exactToString(parseExactDecimal(value, label));
  } catch {
    throw new Error(`P6B04: ${label}가 올바르지 않습니다.`);
  }
}

function canonicalElementIds(values: readonly string[]) {
  const result = new Set<string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!positiveElementId.test(trimmed))
      throw new Error(`P6B04: Element ID가 올바르지 않습니다: ${value}`);
    const canonical = BigInt(trimmed).toString();
    if (result.has(canonical))
      throw new Error(`P6B04: 중복 Element ID: ${canonical}`);
    result.add(canonical);
  }
  return [...result].sort(bytewise);
}

function unique<T>(rows: readonly T[], key: (row: T) => string, label: string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const value = key(row);
    if (seen.has(value)) throw new Error(`P6B04: 중복 ${label}: ${value}`);
    seen.add(value);
  }
}

export function verifiedBoqLegacySourceId(
  mapping: Pick<BoqQuantityMapping, "sourceFileId" | "subjectKey" | "unit">,
) {
  return `${mapping.sourceFileId}\u001f${mapping.subjectKey}\u001f${mapping.unit}`;
}

function canonicalSource(source: DrawingQuantitySource): DrawingQuantitySource {
  if (
    source.measurementRuleVersion !== "P4_MEASUREMENT_V1" ||
    !sha256Pattern.test(source.snapshotSha256) ||
    !sha256Pattern.test(source.objectFingerprint)
  )
    throw new Error("P6B04: Drawing 원수량 근거가 올바르지 않습니다.");
  if (
    !Number.isSafeInteger(source.revisionVersion) ||
    source.revisionVersion <= 0
  )
    throw new Error("P6B04: Drawing 개정 버전이 올바르지 않습니다.");
  if (!Number.isSafeInteger(source.objectVersion) || source.objectVersion <= 0)
    throw new Error("P6B04: Drawing 객체 버전이 올바르지 않습니다.");
  if (
    !(["length", "area", "count"] as string[]).includes(
      source.measurementKind,
    ) ||
    (source as { unit: string }).unit === "m3" ||
    (source.measurementKind === "length" && source.unit !== "m") ||
    (source.measurementKind === "area" && source.unit !== "m2") ||
    (source.measurementKind === "count" && source.unit !== "EA")
  )
    throw new Error("P6U01: 지원하지 않거나 일치하지 않는 Drawing 단위입니다.");
  const rawQuantity = decimal(source.rawQuantity, "Drawing 원수량");
  if (compareExact(parseExactDecimal(rawQuantity), exactZero) < 0)
    throw new Error("P6B04: Drawing 원수량은 음수일 수 없습니다.");

  const sourceAnchors: DrawingQuantitySource["sourceAnchors"] =
    source.sourceAnchors
      .map((anchor): DrawingQuantitySource["sourceAnchors"][number] => {
        if (!sha256Pattern.test(anchor.sourceSha256))
          throw new Error("P6B04: 원본 근거 확인번호가 올바르지 않습니다.");
        const dxfEntity = "dxfEntity" in anchor ? anchor.dxfEntity : undefined;
        const dwgEntity = "dwgEntity" in anchor ? anchor.dwgEntity : undefined;
        if (
          (anchor.sourceKind === "pdf_region" &&
            (anchor.pdfRegion === null ||
              anchor.ifcGlobalId !== null ||
              dxfEntity !== undefined ||
              dwgEntity !== undefined)) ||
          (anchor.sourceKind === "ifc_element" &&
            (anchor.pdfRegion !== null ||
              !anchor.ifcGlobalId?.trim() ||
              dxfEntity !== undefined ||
              dwgEntity !== undefined)) ||
          (anchor.sourceKind === "dxf_entity" &&
            (anchor.pdfRegion !== null ||
              anchor.ifcGlobalId !== null ||
              dwgEntity !== undefined ||
              !dxfEntity ||
              Object.keys(dxfEntity).sort().join(",") !==
                "entityKey,entityType,handle,importerVersion,sourceLayer,unitCode,unitSource" ||
              dxfEntity.entityKey.length < 1 ||
              dxfEntity.entityKey.length > 1_024 ||
              dxfEntity.entityKey !== dxfEntity.entityKey.trim() ||
              /[\u0000-\u001f\u007f]/u.test(dxfEntity.entityKey) ||
              ![
                "LINE",
                "LWPOLYLINE",
                "POLYLINE",
                "CIRCLE",
                "ARC",
                "TEXT",
              ].includes(dxfEntity.entityType) ||
              dxfEntity.sourceLayer.length < 1 ||
              dxfEntity.sourceLayer.length > 255 ||
              dxfEntity.sourceLayer !== dxfEntity.sourceLayer.trim() ||
              dxfEntity.sourceLayer.includes("\0") ||
              (dxfEntity.handle !== null &&
                !/^[0-9A-F]{1,32}$/.test(dxfEntity.handle)) ||
              ![1, 2, 4, 5, 6].includes(dxfEntity.unitCode) ||
              !["declared", "user_selected"].includes(dxfEntity.unitSource) ||
              dxfEntity.importerVersion !== 1)) ||
          (anchor.sourceKind === "dwg_entity" &&
            (anchor.pdfRegion !== null ||
              anchor.ifcGlobalId !== null ||
              dxfEntity !== undefined ||
              !dwgEntity ||
              Object.keys(dwgEntity).sort().join(",") !==
                "analysisJobId,entityType,handle,importerVersion,layerHandle,ownerHandle,reportSha256,sourceLayer,unitCode,unitSource" ||
              !uuidPattern.test(dwgEntity.analysisJobId) ||
              !sha256Pattern.test(dwgEntity.reportSha256) ||
              !nativeHandlePattern.test(dwgEntity.handle) ||
              !nativeHandlePattern.test(dwgEntity.ownerHandle) ||
              !nativeHandlePattern.test(dwgEntity.layerHandle) ||
              !["LINE", "LWPOLYLINE", "CIRCLE", "ARC", "TEXT"].includes(
                dwgEntity.entityType,
              ) ||
              dwgEntity.sourceLayer.length < 1 ||
              dwgEntity.sourceLayer.length > 255 ||
              dwgEntity.sourceLayer !== dwgEntity.sourceLayer.trim() ||
              dwgEntity.sourceLayer.includes("\0") ||
              ![1, 2, 4, 5, 6].includes(dwgEntity.unitCode) ||
              !["declared", "user_selected"].includes(dwgEntity.unitSource) ||
              dwgEntity.importerVersion !== 1)) ||
          !["pdf_region", "ifc_element", "dxf_entity", "dwg_entity"].includes(
            anchor.sourceKind,
          )
        )
          throw new Error("P6B04: 원본 근거 종류와 좌표가 일치하지 않습니다.");
        const common = {
          sourceFileId: normalizedId(anchor.sourceFileId, "원본 파일 ID"),
          sourceSha256: anchor.sourceSha256,
        };
        if (anchor.sourceKind === "pdf_region")
          return {
            ...common,
            sourceKind: "pdf_region",
            pdfRegion: { ...anchor.pdfRegion },
            ifcGlobalId: null,
          };
        if (anchor.sourceKind === "ifc_element")
          return {
            ...common,
            sourceKind: "ifc_element",
            pdfRegion: null,
            ifcGlobalId: anchor.ifcGlobalId,
          };
        return anchor.sourceKind === "dxf_entity"
          ? {
              ...common,
              sourceKind: "dxf_entity",
              pdfRegion: null,
              ifcGlobalId: null,
              dxfEntity: { ...anchor.dxfEntity },
            }
          : {
              ...common,
              sourceKind: "dwg_entity",
              pdfRegion: null,
              ifcGlobalId: null,
              dwgEntity: { ...anchor.dwgEntity },
            };
      })
      .sort((left, right) =>
        bytewise(JSON.stringify(left), JSON.stringify(right)),
      );
  unique(sourceAnchors, (row) => JSON.stringify(row), "원본 근거");
  const issueLinks = source.issueLinks
    .map((row) => ({ issueId: normalizedId(row.issueId, "이슈 ID") }))
    .sort((left, right) => bytewise(left.issueId, right.issueId));
  unique(issueLinks, (row) => row.issueId, "이슈 연결");

  return {
    quantityLinkId: normalizedId(source.quantityLinkId, "수량 근거 ID"),
    revisionId: normalizedId(source.revisionId, "도면 개정 ID"),
    revisionVersion: source.revisionVersion,
    snapshotSha256: source.snapshotSha256,
    objectId: normalizedId(source.objectId, "도면 객체 ID"),
    lineageId: normalizedId(source.lineageId, "객체 계보 ID"),
    objectVersion: source.objectVersion,
    objectFingerprint: source.objectFingerprint,
    measurementKind: source.measurementKind,
    rawQuantity,
    unit: source.unit,
    measurementRuleVersion: source.measurementRuleVersion,
    sourceAnchors,
    issueLinks,
  };
}

export function canonicalizeVerifiedBoqV1_1Input(
  input: VerifiedBoqV1_1Input,
): VerifiedBoqV1_1Input {
  if (input.engineVersion !== VERIFIED_BOQ_V1_1_ENGINE_VERSION)
    throw new Error("P6B04: 지원하지 않는 계산 엔진입니다.");
  const lines = input.lines
    .map((line) => ({
      id: normalizedId(line.id, "내역 행 ID"),
      sectionCode: line.sectionCode,
      itemCode: normalizedId(line.itemCode, "품목 코드"),
      itemName: line.itemName,
      specification: line.specification,
      unit: line.unit,
      signedAdjustment: decimal(line.signedAdjustment, "보정수량"),
      adjustmentReason: line.adjustmentReason.normalize("NFKC").trim(),
    }))
    .sort(
      (left, right) =>
        bytewise(left.itemCode, right.itemCode) || bytewise(left.id, right.id),
    );
  const legacyMappings = input.legacyMappings
    .map((mapping) => ({
      id: normalizedId(mapping.id, "legacy 수량 연결 ID"),
      lineId: normalizedId(mapping.lineId, "내역 행 ID"),
      sourceFileId: normalizedId(mapping.sourceFileId, "원본 파일 ID"),
      sourceSha256: mapping.sourceSha256,
      subjectKey: normalizedId(mapping.subjectKey, "원수량 묶음"),
      sourceQuantity: decimal(mapping.sourceQuantity, "legacy 원수량"),
      factor: decimal(mapping.factor, "legacy 연결 계수"),
      unit: mapping.unit,
      elementIds: canonicalElementIds(mapping.elementIds),
    }))
    .sort((left, right) => bytewise(left.id, right.id));
  const drawingMappings = input.drawingMappings
    .map((mapping) => {
      const source = canonicalSource(mapping.source);
      const quantityLinkId = normalizedId(
        mapping.quantityLinkId,
        "수량 근거 ID",
      );
      if (quantityLinkId !== source.quantityLinkId)
        throw new Error("P6B04: Drawing 수량 근거 ID가 일치하지 않습니다.");
      return {
        id: normalizedId(mapping.id, "Drawing 수량 연결 ID"),
        lineId: normalizedId(mapping.lineId, "내역 행 ID"),
        quantityLinkId,
        allocationFactor: decimal(
          mapping.allocationFactor,
          "Drawing 배분 계수",
        ),
        source,
      };
    })
    .sort((left, right) => bytewise(left.id, right.id));
  unique(lines, (row) => row.id, "내역 행 ID");
  unique(lines, (row) => row.itemCode, "품목 코드");
  unique(
    [...legacyMappings, ...drawingMappings],
    (row) => row.id,
    "수량 연결 ID",
  );
  const legacySources = new Map<string, string>();
  for (const mapping of legacyMappings) {
    const sourceId = verifiedBoqLegacySourceId(mapping);
    const source = JSON.stringify({
      sourceSha256: mapping.sourceSha256,
      sourceQuantity: mapping.sourceQuantity,
      elementIds: mapping.elementIds,
    });
    const prior = legacySources.get(sourceId);
    if (prior !== undefined && prior !== source)
      throw new Error(
        "P6B04: 같은 legacy 원수량 근거의 SHA, 수량, Element ID가 다릅니다.",
      );
    legacySources.set(sourceId, source);
  }
  const sources = new Map<string, string>();
  for (const mapping of drawingMappings) {
    const serialized = JSON.stringify(mapping.source);
    const prior = sources.get(mapping.quantityLinkId);
    if (prior !== undefined && prior !== serialized)
      throw new Error("P6B04: 같은 Drawing 수량 근거 내용이 다릅니다.");
    sources.set(mapping.quantityLinkId, serialized);
  }

  const exclusions = (input.exclusions ?? [])
    .map((row) => ({
      id: normalizedId(row.id, "제외 결정 ID"),
      sourceFileId: normalizedId(row.sourceFileId, "원본 파일 ID"),
      sourceSha256: row.sourceSha256,
      subjectKey: normalizedId(row.subjectKey, "원수량 묶음"),
      sourceQuantity: decimal(row.sourceQuantity, "제외 원수량"),
      unit: row.unit,
      elementIds: canonicalElementIds(row.elementIds),
      reason: row.reason.normalize("NFKC").trim(),
    }))
    .sort((left, right) => bytewise(left.id, right.id));
  const resources = input.resources
    .map((row) => ({
      id: normalizedId(row.id, "자원 ID"),
      code: normalizedId(row.code, "자원 코드"),
      type: row.type,
      unit: normalizedId(row.unit, "자원 단위"),
      unitPriceKrw: decimal(row.unitPriceKrw, "자원 단가"),
    }))
    .sort(
      (left, right) =>
        bytewise(left.code, right.code) || bytewise(left.id, right.id),
    );
  const resourceCodeById = new Map(
    resources.map((resource) => [resource.id, resource.code]),
  );
  const components = input.components
    .map((row) => ({
      id: normalizedId(row.id, "일위대가 구성 ID"),
      lineId: normalizedId(row.lineId, "내역 행 ID"),
      resourceId: normalizedId(row.resourceId, "자원 ID"),
      coefficient: decimal(row.coefficient, "자원 소요계수"),
    }))
    .sort(
      (left, right) =>
        bytewise(
          resourceCodeById.get(left.resourceId) ?? left.resourceId,
          resourceCodeById.get(right.resourceId) ?? right.resourceId,
        ) || bytewise(left.id, right.id),
    );

  const priceBookSha = input.priceBook.sourceSha256;
  if (!sha256Pattern.test(priceBookSha))
    throw new Error("P6B04: 단가표 파일 확인번호가 올바르지 않습니다.");
  const rightsBasis = input.priceBook.rightsBasis.normalize("NFKC").trim();
  if (!rightsBasis) throw new Error("P6B04: 단가표 권리 근거가 비어 있습니다.");
  const effectiveDate = input.priceBook.effectiveDate;
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)
    ? new Date(`${effectiveDate}T00:00:00.000Z`)
    : null;
  if (
    parsedDate === null ||
    Number.isNaN(parsedDate.valueOf()) ||
    parsedDate.toISOString().slice(0, 10) !== effectiveDate
  )
    throw new Error("P6B04: 단가표 기준일이 올바르지 않습니다.");

  return {
    engineVersion: VERIFIED_BOQ_V1_1_ENGINE_VERSION,
    versionId: normalizedId(input.versionId, "내역 버전 ID"),
    calculationPolicy: input.calculationPolicy,
    quantityScale: input.quantityScale,
    lines,
    legacyMappings,
    drawingMappings,
    priceBook: {
      id: normalizedId(input.priceBook.id, "단가표 ID"),
      sourceFileId: normalizedId(
        input.priceBook.sourceFileId,
        "단가표 파일 ID",
      ),
      sourceSha256: priceBookSha,
      effectiveDate,
      rightsBasis,
    },
    exclusions,
    resources,
    components,
  };
}

function calculationMappings(
  input: VerifiedBoqV1_1Input,
): VerifiedBoqCalculationMapping[] {
  return [
    ...input.legacyMappings.map((mapping) => ({
      id: mapping.id,
      lineId: mapping.lineId,
      sourceKind: "legacy" as const,
      sourceId: `${mapping.sourceFileId}\u001f${mapping.subjectKey}`,
      sourceSha256: mapping.sourceSha256,
      sourceQuantity: mapping.sourceQuantity,
      factor: mapping.factor,
      unit: mapping.unit,
      elementIds: mapping.elementIds,
    })),
    ...input.drawingMappings.map((mapping) => ({
      id: `drawing:${mapping.id}`,
      lineId: mapping.lineId,
      sourceKind: "drawing" as const,
      sourceId: mapping.source.quantityLinkId,
      sourceSha256: mapping.source.snapshotSha256,
      sourceQuantity: mapping.source.rawQuantity,
      factor: mapping.allocationFactor,
      unit: mapping.source.unit,
      elementIds: [],
    })),
  ];
}

export function calculateVerifiedBoqV1_1(
  input: VerifiedBoqV1_1Input,
): VerifiedBoqV1_1Result {
  const canonical = canonicalizeVerifiedBoqV1_1Input(input);
  const rawByLine = new Map<string, ReturnType<typeof parseExactDecimal>>();
  for (const mapping of calculationMappings(canonical))
    rawByLine.set(
      mapping.lineId,
      addExact(
        rawByLine.get(mapping.lineId) ?? exactZero,
        multiplyExact(
          parseExactDecimal(mapping.sourceQuantity),
          parseExactDecimal(mapping.factor),
        ),
      ),
    );
  for (const line of canonical.lines)
    if (
      compareExact(
        addExact(
          rawByLine.get(line.id) ?? exactZero,
          parseExactDecimal(line.signedAdjustment),
        ),
        exactZero,
      ) < 0
    )
      throw new Error(
        `P6B04: ${line.itemCode}의 보정 후 수량은 음수일 수 없습니다.`,
      );
  let core;
  try {
    core = calculateVerifiedBoqCore(
      { ...canonical, mappings: calculationMappings(canonical) },
      true,
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "계산할 수 없습니다.";
    if (/단위/.test(message)) throw new Error(`P6U01: ${message}`);
    throw new Error(`P6B04: ${message}`);
  }
  if (core.status !== "calculated")
    throw new Error("P6B04: 모든 내역 행을 계산할 수 없습니다.");

  const drawingIdsByLine = new Map<string, Set<string>>();
  for (const mapping of canonical.drawingMappings) {
    const idsForLine =
      drawingIdsByLine.get(mapping.lineId) ?? new Set<string>();
    idsForLine.add(mapping.source.quantityLinkId);
    drawingIdsByLine.set(mapping.lineId, idsForLine);
  }
  const lines = core.lines.map((line) => {
    if (line.rawQuantity === null || line.finalQuantity === null)
      throw new Error("P6B04: 모든 내역 행을 계산할 수 없습니다.");
    const adjusted = addExact(
      parseExactDecimal(line.rawQuantity),
      parseExactDecimal(line.adjustment),
    );
    if (compareExact(adjusted, exactZero) < 0)
      throw new Error(
        `P6B04: ${line.itemCode}의 보정 후 수량은 음수일 수 없습니다.`,
      );
    return {
      lineId: line.lineId,
      sectionCode: line.sectionCode,
      itemCode: line.itemCode,
      itemName: line.itemName,
      specification: line.specification,
      unit: line.unit,
      status: line.status,
      rawQuantity: line.rawQuantity,
      adjustment: line.adjustment,
      adjustedQuantity: exactToString(adjusted),
      finalQuantity: line.finalQuantity,
      materialUnitPriceKrw: line.materialUnitPriceKrw,
      laborUnitPriceKrw: line.laborUnitPriceKrw,
      expenseUnitPriceKrw: line.expenseUnitPriceKrw,
      totalUnitPriceKrw: line.totalUnitPriceKrw,
      amountKrw: line.amountKrw,
      formula: line.formula,
      sourceSha256: [...line.sourceSha256].sort(bytewise),
      elementIds: [...line.elementIds].sort(bytewise),
      drawingQuantityLinkIds: [
        ...(drawingIdsByLine.get(line.lineId) ?? []),
      ].sort(bytewise),
      message: line.message,
    };
  });
  const resultWithoutHash = {
    engineVersion: VERIFIED_BOQ_V1_1_ENGINE_VERSION,
    versionId: core.versionId,
    calculationPolicy: core.calculationPolicy,
    status: core.status,
    lines,
    directCostKrw: core.directCostKrw,
    exclusions: canonical.exclusions ?? [],
  };
  return {
    ...resultWithoutHash,
    canonicalSha256: createHash("sha256")
      .update(JSON.stringify(resultWithoutHash))
      .digest("hex"),
  };
}

export function calculateVerifiedBoqByEngine(
  input: VerifiedBoqInput | VerifiedBoqV1_1Input,
): VerifiedBoqResult | VerifiedBoqV1_1Result {
  const engineVersion = (input as { engineVersion?: string }).engineVersion;
  if (engineVersion === undefined || engineVersion === "VERIFIED-BOQ-1.0")
    return calculateVerifiedBoq(input as VerifiedBoqInput);
  if (engineVersion === VERIFIED_BOQ_V1_1_ENGINE_VERSION)
    return calculateVerifiedBoqV1_1(input as VerifiedBoqV1_1Input);
  throw new Error("P6B04: 지원하지 않는 계산 엔진입니다.");
}
