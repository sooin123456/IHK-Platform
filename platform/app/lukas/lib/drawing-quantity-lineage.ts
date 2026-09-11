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
import type { DrawingMeasurement } from "./drawing-measurements.ts";
import { drawingMeasurementObjectFingerprint } from "./drawing-semantic-schedules.ts";
import type { DrawingObject } from "./drawing-workspace.types.ts";

export const P6_MEASUREMENT_RULE_VERSION = "P4_MEASUREMENT_V1" as const;
export const P6_MATERIAL_RULE_VERSION = "P6_MATERIAL_HANDOFF_V1" as const;

export type P6LineageErrorCode = "P6Q01" | "P6M01";

export class P6LineageError extends Error {
  readonly code: P6LineageErrorCode;

  constructor(code: P6LineageErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "P6LineageError";
    this.code = code;
  }
}

export type DrawingQuantityMeasurementKind = "length" | "area" | "count";
export type DrawingQuantityUnit = "EA" | "m" | "m2";

export type DrawingQuantityValue = {
  measurementKind: DrawingQuantityMeasurementKind;
  rawQuantity: string;
  unit: DrawingQuantityUnit;
  measurementRuleVersion: typeof P6_MEASUREMENT_RULE_VERSION;
};

export type DrawingQuantitySource = {
  quantityLinkId: string;
  revisionId: string;
  revisionVersion: number;
  snapshotSha256: string;
  objectId: string;
  lineageId: string;
  objectVersion: number;
  objectFingerprint: string;
  measurementKind: DrawingQuantityMeasurementKind;
  rawQuantity: string;
  unit: DrawingQuantityUnit;
  measurementRuleVersion: typeof P6_MEASUREMENT_RULE_VERSION;
  sourceAnchors: Array<
    {
      sourceFileId: string;
      sourceSha256: string;
    } & (
      | {
          sourceKind: "pdf_region";
          pdfRegion: {
            pageNumber: number;
            x: number;
            y: number;
            width: number;
            height: number;
          };
          ifcGlobalId: null;
          dxfEntity?: never;
          dwgEntity?: never;
        }
      | {
          sourceKind: "ifc_element";
          pdfRegion: null;
          ifcGlobalId: string;
          dxfEntity?: never;
          dwgEntity?: never;
        }
      | {
          sourceKind: "dxf_entity";
          pdfRegion: null;
          ifcGlobalId: null;
          dxfEntity: {
            entityKey: string;
            entityType:
              | "LINE"
              | "LWPOLYLINE"
              | "POLYLINE"
              | "CIRCLE"
              | "ARC"
              | "TEXT";
            sourceLayer: string;
            handle: string | null;
            unitCode: 1 | 2 | 4 | 5 | 6;
            unitSource: "declared" | "user_selected";
            importerVersion: 1;
          };
          dwgEntity?: never;
        }
      | {
          sourceKind: "dwg_entity";
          pdfRegion: null;
          ifcGlobalId: null;
          dxfEntity?: never;
          dwgEntity: {
            analysisJobId: string;
            reportSha256: string;
            handle: string;
            ownerHandle: string;
            layerHandle: string;
            entityType: "LINE" | "LWPOLYLINE" | "CIRCLE" | "ARC" | "TEXT";
            sourceLayer: string;
            unitCode: 1 | 2 | 4 | 5 | 6;
            unitSource: "declared" | "user_selected";
            importerVersion: 1;
          };
        }
    )
  >;
  issueLinks: Array<{ issueId: string }>;
};

export type P6MaterialComponentInput = {
  boqVersionId: string;
  lineId: string;
  rateComponentId: string;
  resourceId: string;
  resourceCode: string;
  resourceName: string;
  resourceSpecification: string;
  resourceUnit: string;
  resourceCoefficient: string;
  finalQuantity: string;
};

export type P6MaterialPlanDerivation = {
  materialCode: string;
  materialName: string;
  specification: string;
  unit: string;
  designQuantity: string;
  allowanceRate: "0";
  requiredQuantity: string;
  ruleId: typeof P6_MATERIAL_RULE_VERSION;
  components: Array<{
    rateComponentId: string;
    derivedDesignQuantity: string;
  }>;
};

export function drawingObjectFingerprintSha256(object: DrawingObject) {
  return createHash("sha256")
    .update(drawingMeasurementObjectFingerprint(object), "utf8")
    .digest("hex");
}

export function convertDrawingMeasurement(
  measurement: DrawingMeasurement,
  measurementKind: DrawingQuantityMeasurementKind,
): DrawingQuantityValue {
  if (measurement.ruleVersion !== P6_MEASUREMENT_RULE_VERSION)
    throw new P6LineageError("P6Q01", "지원하지 않는 측정 규칙입니다.");

  const source =
    measurementKind === "length"
      ? measurement.lengthMillimeters
      : measurementKind === "area"
        ? measurement.areaSquareMillimeters
        : measurementKind === "count"
          ? measurement.count
          : null;
  if (source === null)
    throw new P6LineageError("P6Q01", "선택한 측정값을 확정할 수 없습니다.");
  if (measurementKind === "count" && source !== "1")
    throw new P6LineageError("P6Q01", "선택한 측정값을 확정할 수 없습니다.");

  const factor =
    measurementKind === "length"
      ? "0.001"
      : measurementKind === "area"
        ? "0.000001"
        : measurementKind === "count"
          ? "1"
          : null;
  if (factor === null)
    throw new P6LineageError("P6Q01", "지원하지 않는 측정 종류입니다.");

  try {
    const value = multiplyExact(
      parseExactDecimal(source),
      parseExactDecimal(factor),
    );
    const rawQuantity = exactToString(value);
    const [whole, fraction = ""] = rawQuantity.split(".");
    if (
      compareExact(value, exactZero) < 0 ||
      whole.length > 17 ||
      fraction.length > 12
    )
      throw new Error("unsupported quantity precision");
    return {
      measurementKind,
      rawQuantity,
      unit:
        measurementKind === "length"
          ? "m"
          : measurementKind === "area"
            ? "m2"
            : "EA",
      measurementRuleVersion: P6_MEASUREMENT_RULE_VERSION,
    };
  } catch {
    throw new P6LineageError("P6Q01", "선택한 측정값을 확정할 수 없습니다.");
  }
}

type MaterialIdentity = {
  code: string;
  name: string;
  specification: string;
  unit: string;
};

type MaterialGroup = MaterialIdentity & {
  total: ReturnType<typeof parseExactDecimal>;
  components: P6MaterialPlanDerivation["components"];
};

function compareBytewise(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function compareMaterialIdentity(left: MaterialIdentity, right: MaterialIdentity) {
  return (
    compareBytewise(left.code, right.code) ||
    compareBytewise(left.specification, right.specification) ||
    compareBytewise(left.unit, right.unit)
  );
}

function materialIdentity(component: P6MaterialComponentInput): MaterialIdentity {
  return {
    code: component.resourceCode,
    name: component.resourceName,
    specification: component.resourceSpecification,
    unit: component.resourceUnit,
  };
}

function sameMaterialIdentity(left: MaterialIdentity, right: MaterialIdentity) {
  return (
    left.code === right.code &&
    left.name === right.name &&
    left.specification === right.specification &&
    left.unit === right.unit
  );
}

function materialKey(identity: MaterialIdentity) {
  return JSON.stringify([identity.code, identity.specification, identity.unit]);
}

function validComponent(component: P6MaterialComponentInput) {
  const requiredIdentity = [
    component.boqVersionId,
    component.lineId,
    component.rateComponentId,
    component.resourceId,
    component.resourceCode,
    component.resourceName,
    component.resourceUnit,
  ].every((value) => typeof value === "string" && value.length > 0);
  return (
    requiredIdentity &&
    typeof component.resourceSpecification === "string" &&
    [...component.resourceSpecification].length <= 200
  );
}

/** Pure approved-BOQ material handoff; it only derives selected components. */
export function deriveP6MaterialPlans(
  components: readonly P6MaterialComponentInput[],
): P6MaterialPlanDerivation[] {
  try {
    const componentIds = new Set<string>();
    const resourceIdentities = new Map<string, MaterialIdentity>();
    const groups = new Map<string, MaterialGroup>();
    let boqVersionId: string | null = null;

    for (const component of components) {
      if (!validComponent(component) || componentIds.has(component.rateComponentId))
        throw new Error("invalid material component");
      if (boqVersionId !== null && boqVersionId !== component.boqVersionId)
        throw new Error("mixed BOQ versions");
      boqVersionId = component.boqVersionId;
      componentIds.add(component.rateComponentId);

      const identity = materialIdentity(component);
      const existingResource = resourceIdentities.get(component.resourceId);
      if (existingResource && !sameMaterialIdentity(existingResource, identity))
        throw new Error("incompatible material resource");
      resourceIdentities.set(component.resourceId, identity);

      const finalQuantity = parseExactDecimal(component.finalQuantity);
      const coefficient = parseExactDecimal(component.resourceCoefficient);
      if (
        compareExact(finalQuantity, exactZero) < 0 ||
        compareExact(coefficient, exactZero) < 0
      )
        throw new Error("negative material quantity");
      const derived = roundExact(
        multiplyExact(finalQuantity, coefficient),
        6,
        "half_away_from_zero",
      );
      const key = materialKey(identity);
      let group = groups.get(key);
      if (group && !sameMaterialIdentity(group, identity))
        throw new Error("incompatible material group");
      if (!group) {
        group = { ...identity, total: exactZero, components: [] };
        groups.set(key, group);
      }
      group.total = addExact(group.total, derived);
      group.components.push({
        rateComponentId: component.rateComponentId,
        derivedDesignQuantity: exactToString(derived),
      });
    }

    return [...groups.values()]
      .sort(compareMaterialIdentity)
      .map((group) => {
        const designQuantity = exactToString(group.total);
        return {
          materialCode: group.code,
          materialName: group.name,
          specification: group.specification,
          unit: group.unit,
          designQuantity,
          allowanceRate: "0",
          requiredQuantity: designQuantity,
          ruleId: P6_MATERIAL_RULE_VERSION,
          components: group.components.sort((left, right) =>
            compareBytewise(left.rateComponentId, right.rateComponentId),
          ),
        };
      });
  } catch (error) {
    if (error instanceof P6LineageError) throw error;
    throw new P6LineageError("P6M01", "자재 구성요소가 호환되지 않습니다.");
  }
}
