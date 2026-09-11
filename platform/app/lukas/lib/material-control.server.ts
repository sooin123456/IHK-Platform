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
const POSTGRES_TIMESTAMP_PARTS =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2}):(\d{2}))$/;
const MATERIAL_TRANSACTION_LIMIT = 10_000;
const MATERIAL_PLAN_LINEAGE_LIMIT = 2_000;
const MATERIAL_TRANSACTION_PAGE_SIZE = 200;
const MATERIAL_PLAN_PAGE_SIZE = 200;
const CARBON_FACTOR_QUERY_CHUNK_SIZE = 100;
const POSTGREST_IN_FILTER_CHUNK_SIZE = 100;

export async function collectBoundedRows<Row extends { id: string }>(
  loadPage: (
    afterId: string | null,
    limit: number,
  ) => Promise<{ data: Row[] | null; error: unknown }>,
  maximum: number,
) {
  const rows: Row[] = [];
  let afterId: string | null = null;
  while (true) {
    const page = await loadPage(afterId, MATERIAL_TRANSACTION_PAGE_SIZE);
    if (page.error) throw new Error("bounded row read failed");
    const batch = page.data ?? [];
    if (!batch.length) return rows;
    let previousId = afterId;
    for (const row of batch) {
      if (
        typeof row.id !== "string" ||
        (previousId !== null && row.id <= previousId)
      )
        throw new Error("bounded row identity order failed");
      previousId = row.id;
    }
    rows.push(...batch);
    if (rows.length > maximum) throw new Error("bounded row limit exceeded");
    afterId = batch.at(-1)!.id;
  }
}

export async function collectBoundedRowsByFilterChunks<
  Row extends { id: string },
>(
  filterValues: readonly string[],
  loadPage: (
    chunk: readonly string[],
    afterId: string | null,
    limit: number,
  ) => Promise<{ data: Row[] | null; error: unknown }>,
  maximum: number,
) {
  if (new Set(filterValues).size !== filterValues.length)
    throw new Error("bounded filter input contains duplicates");
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (
    let offset = 0;
    offset < filterValues.length;
    offset += POSTGREST_IN_FILTER_CHUNK_SIZE
  ) {
    const chunk = filterValues.slice(
      offset,
      offset + POSTGREST_IN_FILTER_CHUNK_SIZE,
    );
    const chunkRows = await collectBoundedRows(
      (afterId, limit) => loadPage(chunk, afterId, limit),
      maximum - rows.length,
    );
    for (const row of chunkRows) {
      if (seen.has(row.id))
        throw new Error("bounded filter query returned duplicate rows");
      seen.add(row.id);
    }
    rows.push(...chunkRows);
  }
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

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

function lineageTimestampMicroseconds(timestamp: string) {
  const match = POSTGRES_TIMESTAMP_PARTS.exec(timestamp);
  if (!match) throw new Error("invalid lineage timestamp");
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    fraction = "",
    zone,
    sign,
    zoneHour,
    zoneMinute,
  ] = match;
  const utcMilliseconds = Date.parse(
    `${year}-${month}-${day}T${hour}:${minute}:${second}Z`,
  );
  const offsetMilliseconds =
    zone === "Z"
      ? 0
      : (sign === "+" ? 1 : -1) *
        (Number(zoneHour) * 60 + Number(zoneMinute)) *
        60_000;
  return (
    BigInt(utcMilliseconds - offsetMilliseconds) * 1_000n +
    BigInt(fraction.padEnd(6, "0"))
  );
}

function compareLineageRows(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const leftCreatedAt = lineageTimestampMicroseconds(String(left.created_at));
  const rightCreatedAt = lineageTimestampMicroseconds(String(right.created_at));
  if (leftCreatedAt !== rightCreatedAt)
    return leftCreatedAt > rightCreatedAt ? -1 : 1;
  return String(right.id).localeCompare(String(left.id));
}

function materialPlanCursor(cursor: string | null, projectId: string) {
  if (cursor === null) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      !value ||
      value.projectId !== projectId ||
      typeof value.createdAt !== "string" ||
      !POSTGRES_TIMESTAMP.test(value.createdAt) ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !UUID.test(value.id)
    )
      throw new Error("invalid cursor");
    return { createdAt: value.createdAt as string, id: value.id as string };
  } catch {
    throw new Response("자재계획 페이지 주소가 올바르지 않습니다.", {
      status: 400,
    });
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

type MaterialControlRawRow = Record<string, unknown> & { id: string };

export type MaterialControlPlanPage = {
  planRows: MaterialControlRawRow[];
  transactionRows: MaterialControlRawRow[];
  factorRows: MaterialControlRawRow[];
  summaries: MaterialControlSummary[];
  nextCursor: string | null;
};

export function assertCompleteMaterialControlExport(input: {
  cursor: string | null;
  nextCursor: string | null;
  materialPlanId?: string;
}) {
  if (input.cursor || input.nextCursor || input.materialPlanId)
    throw new Response(
      "자재 CSV는 전체 원장만 내보낼 수 있습니다. 현재 화면이 일부 범위이거나 전체 내보내기 한도인 자재계획 200개를 초과해 CSV를 만들지 않았습니다.",
      { status: 409 },
    );
}

/**
 * Loads one URL-addressable plan page and the complete transaction/factor
 * dependency closure needed to calculate that page. Project filters are
 * repeated on every query so a malformed cursor or foreign identity fails
 * closed even when an upstream caller supplies an elevated client.
 */
export async function listMaterialControlPlanPage(
  userClient: SupabaseClient,
  input: {
    projectId: string;
    materialPlanId?: string;
    cursor: string | null;
    limit?: number;
    asOfDate?: string;
  },
): Promise<MaterialControlPlanPage> {
  if (
    !UUID.test(input.projectId) ||
    (input.materialPlanId !== undefined && !UUID.test(input.materialPlanId))
  )
    throw new Response("자재계획 범위가 올바르지 않습니다.", { status: 400 });
  if (input.materialPlanId && input.cursor)
    throw new Response(
      "선택 자재계획과 페이지 주소를 함께 사용할 수 없습니다.",
      {
        status: 400,
      },
    );

  const limit = Math.min(
    MATERIAL_PLAN_PAGE_SIZE,
    Math.max(1, input.limit ?? MATERIAL_PLAN_PAGE_SIZE),
  );
  const cursor = materialPlanCursor(input.cursor, input.projectId);
  let planRows: MaterialControlRawRow[] = [];

  if (input.materialPlanId) {
    const { data, error } = await userClient
      .from("lukas_qto_material_plans")
      .select("*")
      .eq("project_id", input.projectId)
      .eq("id", input.materialPlanId)
      .limit(1);
    if (error)
      throw new Response("선택한 자재계획을 읽지 못했습니다.", {
        status: 409,
      });
    planRows = (data ?? []) as unknown as MaterialControlRawRow[];
    if (planRows.length !== 1)
      throw new Response("선택한 자재계획을 찾을 수 없습니다.", {
        status: 404,
      });
  } else {
    let after = cursor;
    while (planRows.length < limit + 1) {
      let query = userClient
        .from("lukas_qto_material_plans")
        .select("*")
        .eq("project_id", input.projectId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
      if (after)
        query = query.or(
          `created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`,
        );
      const remaining = limit + 1 - planRows.length;
      const { data, error } = await query.limit(remaining);
      if (error)
        throw new Response("자재계획 페이지를 읽지 못했습니다.", {
          status: 409,
        });
      const batch = (data ?? []) as unknown as MaterialControlRawRow[];
      if (!batch.length) break;
      planRows.push(...batch);
      const last = batch.at(-1)!;
      after = { createdAt: String(last.created_at), id: last.id };
      if (batch.length >= remaining) break;
    }
  }

  const scopeRows = planRows.slice(0, limit);
  let previous = cursor;
  for (const row of planRows) {
    const createdAt = String(row.created_at);
    if (
      row.project_id !== input.projectId ||
      !UUID.test(row.id) ||
      !POSTGRES_TIMESTAMP.test(createdAt) ||
      (previous !== null &&
        !(
          createdAt < previous.createdAt ||
          (createdAt === previous.createdAt && row.id < previous.id)
        ))
    )
      throw new Response("자재계획 페이지 범위가 일치하지 않습니다.", {
        status: 409,
      });
    previous = { createdAt, id: row.id };
  }

  const planIds = scopeRows.map((row) => row.id);
  let transactionRows: MaterialControlRawRow[] = [];
  try {
    transactionRows = planIds.length
      ? await collectBoundedRowsByFilterChunks<MaterialControlRawRow>(
          planIds,
          async (chunk, afterId, pageLimit) => {
            let query = userClient
              .from("lukas_qto_material_transactions")
              .select("*")
              .eq("project_id", input.projectId)
              .in("material_plan_id", [...chunk]);
            if (afterId) query = query.gt("id", afterId);
            const { data, error } = await query
              .order("id", { ascending: true })
              .limit(pageLimit);
            return {
              data: data as unknown as MaterialControlRawRow[] | null,
              error,
            };
          },
          MATERIAL_TRANSACTION_LIMIT,
        )
      : [];
  } catch {
    throw new Response(
      "현재 자재계획 페이지의 거래를 읽지 못했거나 허용 범위를 초과했습니다.",
      { status: 409 },
    );
  }
  const planIdSet = new Set(planIds);
  if (
    transactionRows.some(
      (row) =>
        row.project_id !== input.projectId ||
        !planIdSet.has(String(row.material_plan_id)),
    )
  )
    throw new Response(
      "자재 거래 범위가 자재계획 페이지와 일치하지 않습니다.",
      {
        status: 409,
      },
    );
  transactionRows.sort(
    (left, right) =>
      String(left.occurred_on ?? left.created_at).localeCompare(
        String(right.occurred_on ?? right.created_at),
      ) || left.id.localeCompare(right.id),
  );

  const factorIds = [
    ...new Set([
      ...scopeRows.flatMap((row) =>
        row.baseline_factor_id ? [String(row.baseline_factor_id)] : [],
      ),
      ...transactionRows.flatMap((row) =>
        row.carbon_factor_id ? [String(row.carbon_factor_id)] : [],
      ),
    ]),
  ];
  let factorRows: MaterialControlRawRow[] = [];
  try {
    factorRows = factorIds.length
      ? await collectBoundedRowsByFilterChunks<MaterialControlRawRow>(
          factorIds,
          async (chunk, afterId, pageLimit) => {
            let query = userClient
              .from("lukas_qto_carbon_factors")
              .select("*")
              .eq("project_id", input.projectId)
              .in("id", [...chunk]);
            if (afterId) query = query.gt("id", afterId);
            const { data, error } = await query
              .order("id", { ascending: true })
              .limit(pageLimit);
            return {
              data: data as unknown as MaterialControlRawRow[] | null,
              error,
            };
          },
          factorIds.length,
        )
      : [];
  } catch {
    throw new Response("자재계획 페이지의 탄소 근거를 읽지 못했습니다.", {
      status: 409,
    });
  }
  const factorIdSet = new Set(factorIds);
  if (
    factorRows.length !== factorIds.length ||
    factorRows.some(
      (row) => row.project_id !== input.projectId || !factorIdSet.has(row.id),
    )
  )
    throw new Response("자재계획 페이지의 탄소 근거가 완전하지 않습니다.", {
      status: 409,
    });

  const summaries = buildMaterialControlSummaries(
    scopeRows.map((row) => materialPlanRow(row)),
    transactionRows.map((row) => materialTransactionRow(row)),
    factorRows.map((row) => carbonFactorRow(row)),
    input.asOfDate ?? new Date().toISOString().slice(0, 10),
  );
  const last = scopeRows.at(-1);
  return {
    planRows: scopeRows,
    transactionRows,
    factorRows,
    summaries,
    nextCursor:
      !input.materialPlanId && planRows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              projectId: input.projectId,
              createdAt: last.created_at,
              id: last.id,
            }),
            "utf8",
          ).toString("base64url")
        : null,
  };
}

export async function listMaterialBoqLineage(
  userClient: SupabaseClient,
  input: {
    projectId: string;
    materialPlanId?: string;
    transactionId?: string;
    carbonFactorId?: string;
    boqVersionId?: string;
    boqLineId?: string;
    cursor: string | null;
    limit?: number;
    asOfDate?: string;
  },
): Promise<{ rows: MaterialBoqLineageRow[]; nextCursor: string | null }> {
  if (
    !UUID.test(input.projectId) ||
    (input.materialPlanId !== undefined && !UUID.test(input.materialPlanId)) ||
    (input.transactionId !== undefined && !UUID.test(input.transactionId)) ||
    (input.carbonFactorId !== undefined && !UUID.test(input.carbonFactorId)) ||
    (input.boqVersionId !== undefined && !UUID.test(input.boqVersionId)) ||
    (input.boqLineId !== undefined && !UUID.test(input.boqLineId)) ||
    (input.boqLineId && !input.boqVersionId)
  )
    throw new Error("자재 계보 범위가 올바르지 않습니다.");
  const limit = Math.min(200, Math.max(1, input.limit ?? 200));
  const cursor = lineageCursor(input.cursor);
  let materialPlanId = input.materialPlanId;
  if (input.transactionId) {
    const { data, error } = await userClient
      .from("lukas_qto_material_transactions")
      .select("id,project_id,material_plan_id")
      .eq("project_id", input.projectId)
      .eq("id", input.transactionId)
      .limit(2);
    const transaction = data?.[0];
    const transactionMaterialPlanId = transaction?.material_plan_id;
    if (
      error ||
      data?.length !== 1 ||
      transaction?.id !== input.transactionId ||
      transaction?.project_id !== input.projectId ||
      typeof transactionMaterialPlanId !== "string" ||
      !UUID.test(transactionMaterialPlanId)
    )
      throw new Response("자재 거래 계보를 찾지 못했습니다.", {
        status: 404,
      });
    if (materialPlanId && materialPlanId !== transactionMaterialPlanId)
      throw new Response("자재 계보 범위가 서로 일치하지 않습니다.", {
        status: 400,
      });
    materialPlanId = transactionMaterialPlanId;
  }
  let carbonPlanIds: string[] | null = null;
  if (input.carbonFactorId) {
    const { data, error } = await userClient
      .from("lukas_qto_carbon_factors")
      .select("id,project_id")
      .eq("project_id", input.projectId)
      .eq("id", input.carbonFactorId)
      .limit(2);
    const factor = data?.[0];
    if (
      error ||
      data?.length !== 1 ||
      factor?.id !== input.carbonFactorId ||
      factor?.project_id !== input.projectId
    )
      throw new Response("탄소계수 계보를 찾지 못했습니다.", { status: 404 });
    let baselinePlans: (Record<string, unknown> & { id: string })[] = [];
    let factorTransactions: (Record<string, unknown> & { id: string })[] = [];
    try {
      baselinePlans = await collectBoundedRows(async (afterId, pageLimit) => {
        let query = userClient
          .from("lukas_qto_material_plans")
          .select("id,project_id,baseline_factor_id")
          .eq("project_id", input.projectId)
          .eq("baseline_factor_id", input.carbonFactorId);
        if (afterId) query = query.gt("id", afterId);
        const { data, error } = await query
          .order("id", { ascending: true })
          .limit(pageLimit);
        return {
          data: data as unknown as
            | (Record<string, unknown> & { id: string })[]
            | null,
          error,
        };
      }, MATERIAL_PLAN_LINEAGE_LIMIT);
      factorTransactions = await collectBoundedRows(
        async (afterId, pageLimit) => {
          let query = userClient
            .from("lukas_qto_material_transactions")
            .select("id,project_id,material_plan_id,carbon_factor_id")
            .eq("project_id", input.projectId)
            .eq("carbon_factor_id", input.carbonFactorId);
          if (afterId) query = query.gt("id", afterId);
          const { data, error } = await query
            .order("id", { ascending: true })
            .limit(pageLimit);
          return {
            data: data as unknown as
              | (Record<string, unknown> & { id: string })[]
              | null,
            error,
          };
        },
        MATERIAL_TRANSACTION_LIMIT,
      );
    } catch {
      throw new Response("탄소계수 계보 범위를 읽지 못했습니다.", {
        status: 409,
      });
    }
    if (
      baselinePlans.some(
        (plan) =>
          plan.project_id !== input.projectId ||
          plan.baseline_factor_id !== input.carbonFactorId ||
          !UUID.test(plan.id),
      ) ||
      factorTransactions.some(
        (transaction) =>
          transaction.project_id !== input.projectId ||
          transaction.carbon_factor_id !== input.carbonFactorId ||
          typeof transaction.material_plan_id !== "string" ||
          !UUID.test(transaction.material_plan_id),
      )
    )
      throw new Response("탄소계수 계보 범위가 일치하지 않습니다.", {
        status: 409,
      });
    carbonPlanIds = [
      ...new Set([
        ...baselinePlans.map((plan) => plan.id),
        ...factorTransactions.map((transaction) =>
          String(transaction.material_plan_id),
        ),
      ]),
    ];
    if (carbonPlanIds.length > MATERIAL_PLAN_LINEAGE_LIMIT)
      throw new Response(
        "탄소계수 계보의 자재계획이 허용 범위를 초과했습니다.",
        {
          status: 409,
        },
      );
    if (materialPlanId && !carbonPlanIds.includes(materialPlanId))
      throw new Response("자재 계보 범위가 서로 일치하지 않습니다.", {
        status: 400,
      });
    if (!carbonPlanIds.length) return { rows: [], nextCursor: null };
  }
  const select =
    "id,project_id,boq_version_id,boq_line_id,boq_rate_component_id,material_resource_id,boq_result_sha256,material_plan_id,derived_design_quantity,created_at,boq_line:lukas_qto_boq_lines!inner(item_code),material_plan:lukas_qto_material_plans!inner(id,material_code,material_name,specification,unit,design_quantity,allowance_rate,required_quantity,rule_id,baseline_factor_id,source_file_id,source_sha256)";
  const applyLinkScope = (query: any) => {
    if (materialPlanId) query = query.eq("material_plan_id", materialPlanId);
    if (input.boqVersionId)
      query = query.eq("boq_version_id", input.boqVersionId);
    if (input.boqLineId) query = query.eq("boq_line_id", input.boqLineId);
    if (cursor)
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
      );
    return query;
  };
  let data: unknown[] | null = null;
  if (carbonPlanIds) {
    const links: Record<string, unknown>[] = [];
    for (
      let offset = 0;
      offset < carbonPlanIds.length;
      offset += POSTGREST_IN_FILTER_CHUNK_SIZE
    ) {
      const chunk = carbonPlanIds.slice(
        offset,
        offset + POSTGREST_IN_FILTER_CHUNK_SIZE,
      );
      const { data: chunkData, error } = await applyLinkScope(
        userClient
          .from("lukas_drawing_material_links")
          .select(select)
          .eq("project_id", input.projectId)
          .in("material_plan_id", chunk)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
      ).limit(limit + 1);
      if (error) throw new Error("자재 계보를 읽지 못했습니다.");
      links.push(
        ...((chunkData ?? []) as unknown as Record<string, unknown>[]),
      );
    }
    const planIdSet = new Set(carbonPlanIds);
    if (
      links.some(
        (row) =>
          row.project_id !== input.projectId ||
          !planIdSet.has(String(row.material_plan_id)) ||
          !UUID.test(String(row.id)) ||
          !POSTGRES_TIMESTAMP.test(String(row.created_at)),
      )
    )
      throw new Response("탄소계수 계보의 자재 연결이 일치하지 않습니다.", {
        status: 409,
      });
    const uniqueLinks = [
      ...new Map(links.map((row) => [String(row.id), row])).values(),
    ];
    uniqueLinks.sort(compareLineageRows);
    data = uniqueLinks.slice(0, limit + 1);
  } else {
    const result = await applyLinkScope(
      userClient
        .from("lukas_drawing_material_links")
        .select(select)
        .eq("project_id", input.projectId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
    ).limit(limit + 1);
    if (result.error) throw new Error("자재 계보를 읽지 못했습니다.");
    data = result.data as unknown[] | null;
  }
  const page = (data ?? []).slice(0, limit) as unknown as Array<
    Record<string, unknown>
  >;
  const planIds = [...new Set(page.map((row) => String(row.material_plan_id)))];
  let transactionData: (Record<string, unknown> & { id: string })[] = [];
  try {
    transactionData = planIds.length
      ? await collectBoundedRowsByFilterChunks<
          Record<string, unknown> & { id: string }
        >(
          planIds,
          async (chunk, afterId, pageLimit) => {
            let transactionQuery = userClient
              .from("lukas_qto_material_transactions")
              .select(
                "id,project_id,material_plan_id,transaction_type,document_number,supplier_name,quantity,unit_price_krw,amount_krw,related_order_id,carbon_factor_id,evidence_sha256,created_at",
              )
              .eq("project_id", input.projectId)
              .in("material_plan_id", [...chunk]);
            if (afterId) transactionQuery = transactionQuery.gt("id", afterId);
            const { data: batch, error: transactionError } =
              await transactionQuery
                .order("id", { ascending: true })
                .limit(pageLimit);
            return {
              data: batch as unknown as
                | (Record<string, unknown> & { id: string })[]
                | null,
              error: transactionError,
            };
          },
          MATERIAL_TRANSACTION_LIMIT,
        )
      : [];
  } catch {
    throw new Error("자재 거래 계보가 허용 범위를 초과했습니다.");
  }
  if (
    carbonPlanIds &&
    transactionData.some(
      (transaction) =>
        transaction.project_id !== input.projectId ||
        !carbonPlanIds.includes(String(transaction.material_plan_id)),
    )
  )
    throw new Response("탄소계수 계보의 자재 거래가 일치하지 않습니다.", {
      status: 409,
    });
  transactionData.sort(
    (left, right) =>
      String(left.created_at).localeCompare(String(right.created_at)) ||
      left.id.localeCompare(right.id),
  );
  const transactions = transactionData.map((row) =>
    materialTransactionRow(row as unknown as Record<string, unknown>),
  );
  if (
    input.transactionId &&
    !transactions.some((transaction) => transaction.id === input.transactionId)
  )
    throw new Response("자재 거래 계보를 찾지 못했습니다.", {
      status: 404,
    });
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
  const factorData: Record<string, unknown>[] = [];
  for (
    let offset = 0;
    offset < factorIds.length;
    offset += CARBON_FACTOR_QUERY_CHUNK_SIZE
  ) {
    const chunk = factorIds.slice(
      offset,
      offset + CARBON_FACTOR_QUERY_CHUNK_SIZE,
    );
    const { data, error } = await userClient
      .from("lukas_qto_carbon_factors")
      .select(
        "id,project_id,material_code,product_name,declared_unit,gwp_a1_a3_per_unit,source_type,standard,manufacturer,epd_program_operator,epd_declaration_number,epd_verifier,pcr_reference,valid_until,source_sha256",
      )
      .eq("project_id", input.projectId)
      .in("id", chunk)
      .limit(chunk.length + 1);
    if (
      error ||
      (data?.length ?? 0) !== chunk.length ||
      data?.some(
        (row) =>
          !chunk.includes(String(row.id)) ||
          (input.carbonFactorId && row.project_id !== input.projectId),
      )
    )
      throw new Error("자재 탄소 근거를 읽지 못했습니다.");
    factorData.push(...(data as unknown as Array<Record<string, unknown>>));
  }
  const factors = factorData.map((row) =>
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
    rows: rows.map(
      (row): MaterialBoqLineageRow => ({
        ...row,
        carbonCoverage: coverageByPlan.get(row.materialPlanId) ?? "missing",
      }),
    ),
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
