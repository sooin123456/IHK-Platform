import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConcreteTakeoffRow } from "./concrete-takeoff-artifact.server.ts";

const SCALE_DIGITS = 6;
const SCALE = 1_000_000n;

export type MaterialPlan = {
  id: string;
  materialCode: string;
  materialName: string;
  specification: string;
  unit: string;
  designQuantity: string;
  allowanceRate: string;
  requiredQuantity: string;
  ruleId: string;
  baselineFactorId: string | null;
  sourceSha256: string;
};

export type MaterialTransaction = {
  id: string;
  materialPlanId: string;
  transactionType:
    | "purchase_order"
    | "goods_receipt"
    | "invoice_evidence"
    | "installation"
    | "return_to_supplier"
    | "waste_disposal";
  documentNumber: string;
  supplierName: string;
  quantity: string;
  unitPriceKrw: string | null;
  amountKrw: string | null;
  relatedOrderId: string | null;
  carbonFactorId: string | null;
  evidenceSha256: string | null;
};

export type CarbonFactor = {
  id: string;
  materialCode: string;
  productName: string;
  declaredUnit: string;
  gwpA1A3PerUnit: string;
  sourceType: "product_epd" | "industry_average" | "generic";
  standard: string;
  manufacturer?: string;
  epdProgramOperator?: string;
  epdDeclarationNumber?: string;
  epdVerifier?: string;
  pcrReference?: string;
  validUntil: string | null;
  sourceSha256: string;
};

export type MaterialBoqLineageRow = {
  boqVersionId: string;
  boqResultSha256: string;
  boqLineId: string;
  itemCode: string;
  rateComponentId: string;
  materialResourceId: string;
  materialPlanId: string;
  derivedDesignQuantity: string;
  materialPlan: MaterialPlan;
  transactions: MaterialTransaction[];
  carbonFactors: CarbonFactor[];
  carbonCoverage: "complete" | "partial" | "missing";
  manifestFileId: string;
  manifestFileSha256: string;
};

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POSTGRES_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const MATERIAL_TRANSACTION_LIMIT = 10_000;
const MATERIAL_TRANSACTION_PAGE_SIZE = 200;

function lineageCursor(cursor: string | null) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !value ||
      typeof value.createdAt !== "string" ||
      !POSTGRES_TIMESTAMP.test(value.createdAt) ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !UUID.test(value.id)
    )
      throw new Error("invalid cursor");
    return { createdAt: value.createdAt as string, id: value.id as string };
  } catch {
    throw new Error("자재 계보 커서가 올바르지 않습니다.");
  }
}

export function materialPlanRow(row: Record<string, unknown>): MaterialPlan {
  return {
    id: String(row.id),
    materialCode: String(row.material_code),
    materialName: String(row.material_name),
    specification: String(row.specification),
    unit: String(row.unit),
    designQuantity: String(row.design_quantity),
    allowanceRate: String(row.allowance_rate),
    requiredQuantity: String(row.required_quantity),
    ruleId: String(row.rule_id),
    baselineFactorId: row.baseline_factor_id
      ? String(row.baseline_factor_id)
      : null,
    sourceSha256: String(row.source_sha256),
  };
}

export function materialTransactionRow(
  row: Record<string, unknown>,
): MaterialTransaction {
  return {
    id: String(row.id),
    materialPlanId: String(row.material_plan_id),
    transactionType:
      row.transaction_type as MaterialTransaction["transactionType"],
    documentNumber: String(row.document_number),
    supplierName: String(row.supplier_name),
    quantity: String(row.quantity),
    unitPriceKrw:
      row.unit_price_krw === null ? null : String(row.unit_price_krw),
    amountKrw: row.amount_krw === null ? null : String(row.amount_krw),
    relatedOrderId: row.related_order_id ? String(row.related_order_id) : null,
    carbonFactorId: row.carbon_factor_id ? String(row.carbon_factor_id) : null,
    evidenceSha256: row.evidence_sha256 ? String(row.evidence_sha256) : null,
  };
}

export function carbonFactorRow(row: Record<string, unknown>): CarbonFactor {
  return {
    id: String(row.id),
    materialCode: String(row.material_code),
    productName: String(row.product_name),
    declaredUnit: String(row.declared_unit),
    gwpA1A3PerUnit: String(row.gwp_a1_a3_per_unit),
    sourceType: row.source_type as CarbonFactor["sourceType"],
    standard: String(row.standard),
    manufacturer: String(row.manufacturer ?? ""),
    epdProgramOperator: String(row.epd_program_operator ?? ""),
    epdDeclarationNumber: String(row.epd_declaration_number ?? ""),
    epdVerifier: String(row.epd_verifier ?? ""),
    pcrReference: String(row.pcr_reference ?? ""),
    validUntil: row.valid_until ? String(row.valid_until) : null,
    sourceSha256: String(row.source_sha256),
  };
}

export async function listMaterialBoqLineage(
  userClient: SupabaseClient,
  input: {
    projectId: string;
    materialPlanId?: string;
    boqLineId?: string;
    cursor: string | null;
    limit?: number;
    asOfDate?: string;
  },
): Promise<{ rows: MaterialBoqLineageRow[]; nextCursor: string | null }> {
  if (
    !UUID.test(input.projectId) ||
    (input.materialPlanId !== undefined && !UUID.test(input.materialPlanId)) ||
    (input.boqLineId !== undefined && !UUID.test(input.boqLineId))
  )
    throw new Error("자재 계보 범위가 올바르지 않습니다.");
  const limit = Math.min(200, Math.max(1, input.limit ?? 200));
  const cursor = lineageCursor(input.cursor);
  let query = userClient
    .from("lukas_drawing_material_links")
    .select(
      "id,project_id,boq_version_id,boq_line_id,boq_rate_component_id,material_resource_id,boq_result_sha256,material_plan_id,derived_design_quantity,created_at,boq_line:lukas_qto_boq_lines!inner(item_code),material_plan:lukas_qto_material_plans!inner(id,material_code,material_name,specification,unit,design_quantity,allowance_rate,required_quantity,rule_id,baseline_factor_id,source_file_id,source_sha256)",
    )
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
  if (input.materialPlanId)
    query = query.eq("material_plan_id", input.materialPlanId);
  if (input.boqLineId) query = query.eq("boq_line_id", input.boqLineId);
  if (cursor)
    query = query.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  const { data, error } = await query.limit(limit + 1);
  if (error) throw new Error("자재 계보를 읽지 못했습니다.");
  const page = (data ?? []).slice(0, limit) as unknown as Array<
    Record<string, unknown>
  >;
  const planIds = [...new Set(page.map((row) => String(row.material_plan_id)))];
  const transactionData: Record<string, unknown>[] = [];
  if (planIds.length) {
    let offset = 0;
    while (true) {
      const { data: batch, error: transactionError } = await userClient
        .from("lukas_qto_material_transactions")
        .select(
          "id,material_plan_id,transaction_type,document_number,supplier_name,quantity,unit_price_krw,amount_krw,related_order_id,carbon_factor_id,evidence_sha256",
        )
        .eq("project_id", input.projectId)
        .in("material_plan_id", planIds)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + MATERIAL_TRANSACTION_PAGE_SIZE - 1);
      if (transactionError)
        throw new Error("자재 거래 계보가 허용 범위를 초과했습니다.");
      const rows = (batch ?? []) as unknown as Record<string, unknown>[];
      if (!rows.length) break;
      transactionData.push(...rows);
      if (transactionData.length > MATERIAL_TRANSACTION_LIMIT)
        throw new Error("자재 거래 계보가 허용 범위를 초과했습니다.");
      offset += rows.length;
    }
  }
  const transactions = transactionData.map((row) =>
    materialTransactionRow(row as unknown as Record<string, unknown>),
  );
  const factorIds = [
    ...new Set([
      ...page.flatMap((row) => {
        const plan = row.material_plan as Record<string, unknown>;
        return plan.baseline_factor_id ? [String(plan.baseline_factor_id)] : [];
      }),
      ...transactions.flatMap((row) =>
        row.carbonFactorId ? [row.carbonFactorId] : [],
      ),
    ]),
  ];
  const { data: factorData, error: factorError } = factorIds.length
    ? await userClient
        .from("lukas_qto_carbon_factors")
        .select(
          "id,material_code,product_name,declared_unit,gwp_a1_a3_per_unit,source_type,standard,manufacturer,epd_program_operator,epd_declaration_number,epd_verifier,pcr_reference,valid_until,source_sha256",
        )
        .eq("project_id", input.projectId)
        .in("id", factorIds)
        .limit(201)
    : { data: [], error: null };
  if (factorError || (factorData?.length ?? 0) !== factorIds.length)
    throw new Error("자재 탄소 근거를 읽지 못했습니다.");
  const factors = (factorData ?? []).map((row) =>
    carbonFactorRow(row as unknown as Record<string, unknown>),
  );
  const rows = page.map((row) => {
    const plan = row.material_plan as Record<string, unknown>;
    const boqLine = row.boq_line as Record<string, unknown>;
    const materialPlanId = String(row.material_plan_id);
    const planTransactions = transactions.filter(
      (transaction) => transaction.materialPlanId === materialPlanId,
    );
    const linkedFactorIds = new Set([
      ...(plan.baseline_factor_id ? [String(plan.baseline_factor_id)] : []),
      ...planTransactions.flatMap((transaction) =>
        transaction.carbonFactorId ? [transaction.carbonFactorId] : [],
      ),
    ]);
    return {
      boqVersionId: String(row.boq_version_id),
      boqResultSha256: String(row.boq_result_sha256),
      boqLineId: String(row.boq_line_id),
      itemCode: String(boqLine.item_code),
      rateComponentId: String(row.boq_rate_component_id),
      materialResourceId: String(row.material_resource_id),
      materialPlanId,
      derivedDesignQuantity: String(row.derived_design_quantity),
      materialPlan: materialPlanRow(plan),
      transactions: planTransactions,
      carbonFactors: factors.filter((factor) => linkedFactorIds.has(factor.id)),
      manifestFileId: String(plan.source_file_id),
      manifestFileSha256: String(plan.source_sha256),
    };
  });
  const uniquePlans = [
    ...new Map(
      rows.map((row) => [row.materialPlan.id, row.materialPlan]),
    ).values(),
  ];
  const coverageByPlan = new Map(
    buildMaterialControlSummaries(
      uniquePlans,
      transactions,
      factors,
      input.asOfDate ?? new Date().toISOString().slice(0, 10),
    ).map((summary) => [summary.materialPlanId, summary.carbonCoverage]),
  );
  const last = page.at(-1);
  return {
    rows: rows.map((row): MaterialBoqLineageRow => ({
      ...row,
      carbonCoverage: coverageByPlan.get(row.materialPlanId) ?? "missing",
    })),
    nextCursor:
      (data?.length ?? 0) > limit && last
        ? Buffer.from(
            JSON.stringify({ createdAt: last.created_at, id: last.id }),
            "utf8",
          ).toString("base64url")
        : null,
  };
}

export type MaterialControlSummary = {
  materialPlanId: string;
  materialCode: string;
  materialName: string;
  specification: string;
  unit: string;
  designQuantity: string;
  requiredQuantity: string;
  orderedQuantity: string;
  receivedQuantity: string;
  installedQuantity: string;
  returnedQuantity: string;
  wastedQuantity: string;
  onSiteQuantity: string;
  invoicedQuantity: string;
  remainingToOrder: string;
  remainingToReceive: string;
  invoiceVariance: string;
  invoiceAmountKrw: string;
  baselineA1A3KgCo2e: string | null;
  committedA1A3KgCo2e: string | null;
  receivedA1A3KgCo2e: string | null;
  installedA1A3KgCo2e: string | null;
  carbonCoverage: "complete" | "partial" | "missing";
  productEpdCoveredRows: number;
  nonProductFactorCoveredRows: number;
  uncoveredCarbonRows: number;
  carbonFactorProvenance: string[];
  planSourceSha256: string;
  transactionEvidenceSha256: string[];
  carbonSourceSha256: string[];
  findings: string[];
};

export type ApprovedTakeoffMaterialPlan = {
  materialCode: string;
  materialName: "콘크리트 계열";
  specification: string;
  unit: "m3";
  designQuantity: string;
  allowanceRate: "0";
  requiredQuantity: string;
  ruleId: "APPROVED_CONCRETE_TAKEOFF_V1";
  sourceGroupKey: string;
  sourceRowCount: number;
};

const SHA256 = /^[0-9a-f]{64}$/;

function parseFixed(value: string, label: string): bigint {
  const normalized = value.trim();
  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
  if (!match)
    throw new Error(
      `${label}은 소수점 ${SCALE_DIGITS}자리 이하의 숫자여야 합니다.`,
    );
  const fraction = (match[3] ?? "").padEnd(SCALE_DIGITS, "0");
  const result = BigInt(match[2]) * SCALE + BigInt(fraction || "0");
  return match[1] === "-" ? -result : result;
}

function formatFixed(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE)
    .toString()
    .padStart(SCALE_DIGITS, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function concreteMaterialCode(specification: string): string {
  const readable = `CONCRETE:${specification}`;
  if (readable.length <= 80 && /^[\p{L}\p{N}._:+-]+$/u.test(readable))
    return readable;
  const digest = createHash("sha256").update(specification).digest("hex");
  return `CONCRETE:${digest.slice(0, 20)}`;
}

/**
 * Converts an independently approved concrete takeoff into deterministic,
 * idempotent material-plan groups. It never infers a specification or applies
 * a second allowance: final_m3 is already the approved final quantity.
 */
export function deriveMaterialPlansFromApprovedTakeoff(
  rows: ConcreteTakeoffRow[],
): ApprovedTakeoffMaterialPlan[] {
  const takeoffRows = rows.filter((row) => row.record_type === "TAKEOFF");
  if (takeoffRows.length === 0)
    throw new Error("승인된 콘크리트 TAKEOFF 행이 없습니다.");

  const groups = new Map<string, { quantity: bigint; count: number }>();
  for (const [index, row] of takeoffRows.entries()) {
    if (row.status !== "PASS")
      throw new Error(
        `콘크리트 산출 ${index + 1}행이 PASS가 아니므로 자재계획을 만들 수 없습니다.`,
      );
    const specification = row.spec.normalize("NFKC").trim();
    if (!specification || specification.length > 200)
      throw new Error(
        `콘크리트 산출 ${index + 1}행의 규격이 올바르지 않습니다.`,
      );
    if (row.final_m3 === null)
      throw new Error(`콘크리트 산출 ${index + 1}행의 최종수량이 없습니다.`);
    const quantity = parseFixed(row.final_m3, "콘크리트 최종수량");
    if (quantity < 0n)
      throw new Error("콘크리트 최종수량은 음수일 수 없습니다.");
    if (quantity === 0n) continue;
    const existing = groups.get(specification) ?? { quantity: 0n, count: 0 };
    existing.quantity += quantity;
    existing.count += 1;
    groups.set(specification, existing);
  }
  if (groups.size === 0)
    throw new Error("0보다 큰 승인 콘크리트 수량이 없습니다.");

  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "ko"))
    .map(([specification, group]) => {
      const quantity = formatFixed(group.quantity);
      return {
        materialCode: concreteMaterialCode(specification),
        materialName: "콘크리트 계열",
        specification,
        unit: "m3",
        designQuantity: quantity,
        allowanceRate: "0",
        requiredQuantity: quantity,
        ruleId: "APPROVED_CONCRETE_TAKEOFF_V1",
        sourceGroupKey: specification,
        sourceRowCount: group.count,
      };
    });
}

function multiply(left: bigint, right: bigint): bigint {
  const product = left * right;
  const negative = product < 0n;
  const absolute = negative ? -product : product;
  const rounded = (absolute + SCALE / 2n) / SCALE;
  return negative ? -rounded : rounded;
}

export function calculateRequiredQuantity(
  designQuantity: string,
  allowanceRate: string,
) {
  const design = parseFixed(designQuantity, "설계수량");
  const allowance = parseFixed(allowanceRate, "할증률");
  if (design < 0n) throw new Error("설계수량은 음수일 수 없습니다.");
  if (allowance < 0n) throw new Error("할증률은 음수일 수 없습니다.");
  return formatFixed(multiply(design, SCALE + allowance));
}

function sum(values: bigint[]) {
  return values.reduce((total, value) => total + value, 0n);
}

export function buildMaterialControlSummaries(
  plans: MaterialPlan[],
  transactions: MaterialTransaction[],
  factors: CarbonFactor[],
  asOfDate: string | null = null,
): MaterialControlSummary[] {
  if (asOfDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate))
    throw new Error("탄소계수 확인 기준일 형식이 올바르지 않습니다.");
  const factorById = new Map(factors.map((factor) => [factor.id, factor]));
  const planIds = new Set<string>();
  const transactionIds = new Set<string>();
  const transactionById = new Map<string, MaterialTransaction>();

  for (const plan of plans) {
    if (planIds.has(plan.id)) throw new Error(`중복 자재계획 ID: ${plan.id}`);
    if (!SHA256.test(plan.sourceSha256))
      throw new Error(
        `${plan.materialCode}의 설계수량 원본 확인번호가 올바르지 않습니다.`,
      );
    planIds.add(plan.id);
    const calculated = calculateRequiredQuantity(
      plan.designQuantity,
      plan.allowanceRate,
    );
    if (
      parseFixed(calculated, "계산 발주수량") !==
      parseFixed(plan.requiredQuantity, "저장 발주수량")
    )
      throw new Error(
        `${plan.materialCode}의 저장 발주수량이 계산식과 다릅니다.`,
      );
  }
  for (const transaction of transactions) {
    if (transactionIds.has(transaction.id))
      throw new Error(`중복 거래 ID: ${transaction.id}`);
    transactionIds.add(transaction.id);
    transactionById.set(transaction.id, transaction);
    if (!planIds.has(transaction.materialPlanId))
      throw new Error(
        `거래 ${transaction.documentNumber}의 자재계획이 없습니다.`,
      );
    if (parseFixed(transaction.quantity, "거래수량") <= 0n)
      throw new Error(
        `거래 ${transaction.documentNumber}의 수량은 0보다 커야 합니다.`,
      );
    if (
      transaction.transactionType !== "purchase_order" &&
      !SHA256.test(transaction.evidenceSha256 ?? "")
    )
      throw new Error(
        `거래 ${transaction.documentNumber}의 증빙 확인번호가 없습니다.`,
      );
    if (transaction.transactionType === "invoice_evidence") {
      const price = parseFixed(transaction.unitPriceKrw ?? "", "청구 단가");
      const amount = parseFixed(transaction.amountKrw ?? "", "청구 공급가액");
      const expected = multiply(
        parseFixed(transaction.quantity, "청구량"),
        price,
      );
      const expectedKrw = ((expected + SCALE / 2n) / SCALE) * SCALE;
      if (amount !== expectedKrw)
        throw new Error(
          `거래 ${transaction.documentNumber}의 공급가액이 수량×단가 반올림과 다릅니다.`,
        );
    }
  }
  for (const factor of factors)
    if (!SHA256.test(factor.sourceSha256))
      throw new Error(
        `${factor.productName} 탄소계수의 원본 확인번호가 올바르지 않습니다.`,
      );

  for (const transaction of transactions) {
    if (transaction.transactionType === "purchase_order") {
      if (transaction.relatedOrderId)
        throw new Error("발주 행은 다른 발주를 참조할 수 없습니다.");
      continue;
    }
    const order = transaction.relatedOrderId
      ? transactionById.get(transaction.relatedOrderId)
      : null;
    if (
      !order ||
      order.transactionType !== "purchase_order" ||
      order.materialPlanId !== transaction.materialPlanId
    )
      throw new Error(
        `${transaction.documentNumber}의 연결 발주가 올바르지 않습니다.`,
      );
  }

  return plans.map((plan) => {
    const rows = transactions.filter((row) => row.materialPlanId === plan.id);
    const orders = rows.filter(
      (row) => row.transactionType === "purchase_order",
    );
    const receipts = rows.filter(
      (row) => row.transactionType === "goods_receipt",
    );
    const invoices = rows.filter(
      (row) => row.transactionType === "invoice_evidence",
    );
    const installations = rows.filter(
      (row) => row.transactionType === "installation",
    );
    const returns = rows.filter(
      (row) => row.transactionType === "return_to_supplier",
    );
    const waste = rows.filter(
      (row) => row.transactionType === "waste_disposal",
    );
    const required = parseFixed(plan.requiredQuantity, "발주수량");
    const ordered = sum(
      orders.map((row) => parseFixed(row.quantity, "발주량")),
    );
    const received = sum(
      receipts.map((row) => parseFixed(row.quantity, "입고량")),
    );
    const invoiced = sum(
      invoices.map((row) => parseFixed(row.quantity, "청구량")),
    );
    const installed = sum(
      installations.map((row) => parseFixed(row.quantity, "설치량")),
    );
    const returned = sum(
      returns.map((row) => parseFixed(row.quantity, "반품량")),
    );
    const wasted = sum(waste.map((row) => parseFixed(row.quantity, "폐기량")));
    const onSite = received - installed - returned - wasted;
    const invoiceAmount = sum(
      invoices.map((row) => parseFixed(row.amountKrw ?? "0", "청구 공급가액")),
    );

    const findings: string[] = [];
    if (ordered < required) findings.push("발주 부족");
    if (ordered > required) findings.push("설계 필요량 초과 발주");
    if (received > ordered) findings.push("발주량 초과 입고");
    if (invoiced > received) findings.push("입고 확인량 초과 청구");
    if (onSite < 0n) findings.push("입고량보다 설치·반품·폐기 합계가 큼");

    const baselineFactor = plan.baselineFactorId
      ? factorById.get(plan.baselineFactorId)
      : null;
    const factorFor = (row: MaterialTransaction) => {
      const direct = row.carbonFactorId
        ? factorById.get(row.carbonFactorId)
        : null;
      if (direct) return direct;
      const order = row.relatedOrderId
        ? transactionById.get(row.relatedOrderId)
        : null;
      return order?.carbonFactorId
        ? (factorById.get(order.carbonFactorId) ?? null)
        : null;
    };
    const validFactor = (factor: CarbonFactor | null | undefined) => {
      if (!factor) return null;
      if (factor.materialCode !== plan.materialCode) {
        findings.push(`탄소계수 자재코드 불일치: ${factor.productName}`);
        return null;
      }
      if (factor.declaredUnit !== plan.unit) {
        findings.push(`탄소계수 단위 불일치: ${factor.productName}`);
        return null;
      }
      if (asOfDate && factor.validUntil && factor.validUntil < asOfDate) {
        findings.push(`탄소계수 유효기간 만료: ${factor.productName}`);
        return null;
      }
      return factor;
    };
    const baseline = validFactor(baselineFactor);
    const carbonTotal = (source: MaterialTransaction[]) => {
      let covered = 0;
      let total = 0n;
      const usedFactors: CarbonFactor[] = [];
      for (const row of source) {
        const factor = validFactor(factorFor(row));
        if (!factor) continue;
        covered += 1;
        usedFactors.push(factor);
        total += multiply(
          parseFixed(row.quantity, "탄소 적용수량"),
          parseFixed(factor.gwpA1A3PerUnit, "A1-A3 계수"),
        );
      }
      return { covered, total, usedFactors };
    };
    const committed = carbonTotal(orders);
    const actual = carbonTotal(receipts);
    const installedCarbon = carbonTotal(installations);
    const carbonRows =
      orders.length +
      receipts.length +
      installations.length +
      (baseline ? 1 : 0);
    const coveredRows =
      committed.covered +
      actual.covered +
      installedCarbon.covered +
      (baseline ? 1 : 0);
    const carbonCoverage =
      coveredRows === 0
        ? "missing"
        : coveredRows === carbonRows
          ? "complete"
          : "partial";
    if (carbonCoverage !== "complete") findings.push("탄소계수 근거 일부 누락");
    const usedFactors = [
      ...(baseline ? [baseline] : []),
      ...committed.usedFactors,
      ...actual.usedFactors,
      ...installedCarbon.usedFactors,
    ];
    const productEpdCoveredRows = usedFactors.filter(
      (factor) => factor.sourceType === "product_epd",
    ).length;
    const nonProductFactorCoveredRows =
      usedFactors.length - productEpdCoveredRows;
    const carbonFactorProvenance = [
      ...new Set(
        usedFactors.map((factor) =>
          [
            factor.sourceType,
            factor.productName,
            factor.manufacturer ?? "",
            factor.epdProgramOperator ?? "",
            factor.epdDeclarationNumber ?? "",
            factor.epdVerifier ?? "",
            factor.pcrReference ?? "",
            factor.validUntil ?? "",
            factor.sourceSha256,
          ].join("|"),
        ),
      ),
    ].sort();

    return {
      materialPlanId: plan.id,
      materialCode: plan.materialCode,
      materialName: plan.materialName,
      specification: plan.specification,
      unit: plan.unit,
      designQuantity: formatFixed(parseFixed(plan.designQuantity, "설계수량")),
      requiredQuantity: formatFixed(required),
      orderedQuantity: formatFixed(ordered),
      receivedQuantity: formatFixed(received),
      installedQuantity: formatFixed(installed),
      returnedQuantity: formatFixed(returned),
      wastedQuantity: formatFixed(wasted),
      onSiteQuantity: formatFixed(onSite),
      invoicedQuantity: formatFixed(invoiced),
      remainingToOrder: formatFixed(required - ordered),
      remainingToReceive: formatFixed(ordered - received),
      invoiceVariance: formatFixed(invoiced - received),
      invoiceAmountKrw: formatFixed(invoiceAmount),
      baselineA1A3KgCo2e: baseline
        ? formatFixed(
            multiply(
              required,
              parseFixed(baseline.gwpA1A3PerUnit, "기준 탄소계수"),
            ),
          )
        : null,
      committedA1A3KgCo2e:
        orders.length && committed.covered === orders.length
          ? formatFixed(committed.total)
          : null,
      receivedA1A3KgCo2e:
        receipts.length && actual.covered === receipts.length
          ? formatFixed(actual.total)
          : null,
      installedA1A3KgCo2e:
        installations.length && installedCarbon.covered === installations.length
          ? formatFixed(installedCarbon.total)
          : null,
      carbonCoverage,
      productEpdCoveredRows,
      nonProductFactorCoveredRows,
      uncoveredCarbonRows: carbonRows - coveredRows,
      carbonFactorProvenance,
      planSourceSha256: plan.sourceSha256,
      transactionEvidenceSha256: [
        ...new Set(
          rows
            .map((row) => row.evidenceSha256)
            .filter((value): value is string => Boolean(value)),
        ),
      ].sort(),
      carbonSourceSha256: [
        ...new Set(
          [
            baseline,
            ...orders.map(factorFor),
            ...receipts.map(factorFor),
            ...installations.map(factorFor),
          ]
            .filter((value): value is CarbonFactor => Boolean(value))
            .map((factor) => factor.sourceSha256),
        ),
      ].sort(),
      findings,
    };
  });
}

function spreadsheetText(value: string) {
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string) {
  const safe = spreadsheetText(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildMaterialControlCsv(
  projectId: string,
  exportedAtUtc: string,
  summaries: MaterialControlSummary[],
) {
  const header = [
    "project_id",
    "exported_at_utc",
    "material_code",
    "material_name",
    "specification",
    "unit",
    "design_quantity",
    "required_quantity",
    "ordered_quantity",
    "received_quantity",
    "installed_quantity",
    "returned_quantity",
    "wasted_quantity",
    "on_site_quantity",
    "invoiced_quantity",
    "remaining_to_order",
    "remaining_to_receive",
    "invoice_variance",
    "invoice_amount_krw",
    "baseline_a1_a3_kgco2e",
    "committed_a1_a3_kgco2e",
    "received_a1_a3_kgco2e",
    "installed_a1_a3_kgco2e",
    "carbon_coverage",
    "product_epd_covered_rows",
    "non_product_factor_covered_rows",
    "uncovered_carbon_rows",
    "carbon_factor_provenance",
    "plan_source_file_check",
    "transaction_evidence_file_checks",
    "carbon_source_file_checks",
    "findings",
  ];
  const rows = summaries.map((row) => [
    projectId,
    exportedAtUtc,
    row.materialCode,
    row.materialName,
    row.specification,
    row.unit,
    row.designQuantity,
    row.requiredQuantity,
    row.orderedQuantity,
    row.receivedQuantity,
    row.installedQuantity,
    row.returnedQuantity,
    row.wastedQuantity,
    row.onSiteQuantity,
    row.invoicedQuantity,
    row.remainingToOrder,
    row.remainingToReceive,
    row.invoiceVariance,
    row.invoiceAmountKrw,
    row.baselineA1A3KgCo2e ?? "",
    row.committedA1A3KgCo2e ?? "",
    row.receivedA1A3KgCo2e ?? "",
    row.installedA1A3KgCo2e ?? "",
    row.carbonCoverage,
    row.productEpdCoveredRows,
    row.nonProductFactorCoveredRows,
    row.uncoveredCarbonRows,
    row.carbonFactorProvenance.join("||"),
    row.planSourceSha256,
    row.transactionEvidenceSha256.join("|"),
    row.carbonSourceSha256.join("|"),
    row.findings.join("|"),
  ]);
  return (
    [header, ...rows]
      .map((row) => row.map((value) => csvCell(String(value))).join(","))
      .join("\r\n") + "\r\n"
  );
}
