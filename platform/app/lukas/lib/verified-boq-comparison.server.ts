import {
  addExact,
  compareExact,
  exactToString,
  exactZero,
  parseExactDecimal,
  subtractExact,
} from "./exact-decimal.server.ts";
import type {
  VerifiedBoqLine,
  VerifiedBoqResult,
} from "./verified-boq.server.ts";

export type BoqLineChange =
  | "ADDED"
  | "REMOVED"
  | "QTY_CHANGED"
  | "PRICE_CHANGED"
  | "FORMULA_CHANGED"
  | "UNIT_CHANGED"
  | "UNCHANGED";

export type BoqComparisonRow = {
  itemCode: string;
  itemName: string;
  unit: string;
  changes: BoqLineChange[];
  previousQuantity: string | null;
  currentQuantity: string | null;
  quantityDelta: string | null;
  previousAmountKrw: string | null;
  currentAmountKrw: string | null;
  amountDeltaKrw: string;
};

export type VerifiedBoqComparison = {
  status: "comparable" | "review";
  message: string;
  rows: BoqComparisonRow[];
  amountDeltaKrw: string;
  rowAmountDeltaKrw: string;
  amountCloses: boolean;
  quantityDeltaByUnit: Record<string, string>;
};

export function compareVerifiedBoq(
  previous: VerifiedBoqResult,
  current: VerifiedBoqResult,
): VerifiedBoqComparison {
  if (previous.engineVersion !== current.engineVersion)
    return review("계산 엔진 버전이 달라 자동 비교하지 않습니다.");
  const previousByCode = byCode(previous.lines);
  const currentByCode = byCode(current.lines);
  const codes = [
    ...new Set([...previousByCode.keys(), ...currentByCode.keys()]),
  ].sort();
  const quantityDelta = new Map<string, ReturnType<typeof parseExactDecimal>>();
  let rowAmountDelta = exactZero;
  const rows = codes.map((code) => {
    const left = previousByCode.get(code) ?? null;
    const right = currentByCode.get(code) ?? null;
    const row = compareRow(code, left, right);
    rowAmountDelta = addExact(
      rowAmountDelta,
      parseExactDecimal(row.amountDeltaKrw),
    );
    if (row.quantityDelta !== null) {
      quantityDelta.set(
        row.unit,
        addExact(
          quantityDelta.get(row.unit) ?? exactZero,
          parseExactDecimal(row.quantityDelta),
        ),
      );
    }
    return row;
  });
  const amountDelta = subtractExact(
    parseExactDecimal(current.directCostKrw),
    parseExactDecimal(previous.directCostKrw),
  );
  const closes = compareExact(amountDelta, rowAmountDelta) === 0;
  return {
    status: closes ? "comparable" : "review",
    message: closes
      ? "행별 금액 차이 합계가 전체 직접공사비 차이와 일치합니다."
      : "행별 차이 합계가 전체 직접공사비 차이와 일치하지 않습니다.",
    rows,
    amountDeltaKrw: exactToString(amountDelta),
    rowAmountDeltaKrw: exactToString(rowAmountDelta),
    amountCloses: closes,
    quantityDeltaByUnit: Object.fromEntries(
      [...quantityDelta.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => [key, exactToString(value)]),
    ),
  };
}

function review(message: string): VerifiedBoqComparison {
  return {
    status: "review",
    message,
    rows: [],
    amountDeltaKrw: "0",
    rowAmountDeltaKrw: "0",
    amountCloses: false,
    quantityDeltaByUnit: {},
  };
}

function byCode(lines: VerifiedBoqLine[]) {
  const result = new Map<string, VerifiedBoqLine>();
  for (const line of lines) {
    if (result.has(line.itemCode))
      throw new Error(`비교 품목 코드가 중복됩니다: ${line.itemCode}`);
    result.set(line.itemCode, line);
  }
  return result;
}

function compareRow(
  code: string,
  left: VerifiedBoqLine | null,
  right: VerifiedBoqLine | null,
): BoqComparisonRow {
  const leftAmount = parseExactDecimal(left?.amountKrw ?? "0");
  const rightAmount = parseExactDecimal(right?.amountKrw ?? "0");
  const unit = right?.unit ?? left?.unit ?? "";
  if (!left)
    return row(
      code,
      right!,
      unit,
      ["ADDED"],
      null,
      right!.finalQuantity,
      right!.finalQuantity,
      null,
      right!.amountKrw,
      exactToString(rightAmount),
    );
  if (!right)
    return row(
      code,
      left,
      unit,
      ["REMOVED"],
      left.finalQuantity,
      null,
      left.finalQuantity === null
        ? null
        : exactToString(
            subtractExact(exactZero, parseExactDecimal(left.finalQuantity)),
          ),
      left.amountKrw,
      null,
      exactToString(subtractExact(exactZero, leftAmount)),
    );
  const changes: BoqLineChange[] = [];
  if (left.unit !== right.unit) changes.push("UNIT_CHANGED");
  if (left.finalQuantity !== right.finalQuantity) changes.push("QTY_CHANGED");
  if (left.totalUnitPriceKrw !== right.totalUnitPriceKrw)
    changes.push("PRICE_CHANGED");
  if (left.formula !== right.formula) changes.push("FORMULA_CHANGED");
  if (changes.length === 0) changes.push("UNCHANGED");
  const comparableQuantity =
    left.unit === right.unit &&
    left.finalQuantity !== null &&
    right.finalQuantity !== null;
  return row(
    code,
    right,
    unit,
    changes,
    left.finalQuantity,
    right.finalQuantity,
    comparableQuantity
      ? exactToString(
          subtractExact(
            parseExactDecimal(right.finalQuantity!),
            parseExactDecimal(left.finalQuantity!),
          ),
        )
      : null,
    left.amountKrw,
    right.amountKrw,
    exactToString(subtractExact(rightAmount, leftAmount)),
  );
}

function row(
  itemCode: string,
  source: VerifiedBoqLine,
  unit: string,
  changes: BoqLineChange[],
  previousQuantity: string | null,
  currentQuantity: string | null,
  quantityDelta: string | null,
  previousAmountKrw: string | null,
  currentAmountKrw: string | null,
  amountDeltaKrw: string,
): BoqComparisonRow {
  return {
    itemCode,
    itemName: source.itemName,
    unit,
    changes,
    previousQuantity,
    currentQuantity,
    quantityDelta,
    previousAmountKrw,
    currentAmountKrw,
    amountDeltaKrw,
  };
}
