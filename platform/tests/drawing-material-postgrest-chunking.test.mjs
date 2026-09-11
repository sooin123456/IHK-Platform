import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCompleteMaterialControlExport,
  listMaterialBoqLineage,
  listMaterialControlPlanPage,
} from "../app/lukas/lib/material-control.server.ts";

const ids = {
  project: "53000000-0000-4000-8000-000000000001",
  version: "53000000-0000-4000-8000-000000000002",
  line: "53000000-0000-4000-8000-000000000003",
  resource: "53000000-0000-4000-8000-000000000004",
  file: "53000000-0000-4000-8000-000000000005",
};

function uuid(namespace, index) {
  return `${namespace}0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function materialLineageRows(count) {
  return Array.from({ length: count }, (_, index) => {
    const materialPlanId = uuid("6", index + 1);
    return {
      id: uuid("7", index + 1),
      project_id: ids.project,
      boq_version_id: ids.version,
      boq_line_id: ids.line,
      boq_rate_component_id: uuid("8", index + 1),
      material_resource_id: ids.resource,
      boq_result_sha256: "a".repeat(64),
      material_plan_id: materialPlanId,
      derived_design_quantity: "1",
      created_at: "2026-09-02T00:00:00.000Z",
      boq_line: { item_code: `MAT-${index + 1}` },
      material_plan: {
        id: materialPlanId,
        material_code: `MAT-${index + 1}`,
        material_name: `material-${index + 1}`,
        specification: "standard",
        unit: "EA",
        design_quantity: "1",
        allowance_rate: "0",
        required_quantity: "1",
        rule_id: "P6_MATERIAL_HANDOFF_V1",
        baseline_factor_id: null,
        source_file_id: ids.file,
        source_sha256: "b".repeat(64),
      },
    };
  });
}

function materialTransactions(links) {
  const rows = links.map((link, index) => ({
    id: uuid("9", index + 1),
    project_id: ids.project,
    created_at: new Date(Date.UTC(2026, 8, 2, 0, 0, index + 1)).toISOString(),
    material_plan_id: link.material_plan_id,
    transaction_type: "purchase_order",
    document_number: `PO-${index + 1}`,
    supplier_name: "supplier",
    quantity: "1",
    unit_price_krw: null,
    amount_krw: null,
    related_order_id: null,
    carbon_factor_id: null,
    evidence_sha256: null,
  }));
  rows.push({
    ...rows[0],
    id: uuid("9", 1_000),
    created_at: "2026-09-01T00:00:00.000Z",
    document_number: "PO-EARLY",
  });
  return rows;
}

function materialLineageClient(rowsByTable, inCalls) {
  return {
    from(table) {
      const filters = [];
      const ordering = [];
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters.push({ kind: "eq", column, value });
          return query;
        },
        in(column, values) {
          inCalls.push({ table, column, values: [...values] });
          filters.push({ kind: "in", column, values: [...values] });
          return query;
        },
        gt(column, value) {
          filters.push({ kind: "gt", column, value });
          return query;
        },
        or() {
          return query;
        },
        order(column, options) {
          ordering.push({ column, ascending: options?.ascending !== false });
          return query;
        },
        limit(size) {
          let rows = [...(rowsByTable[table] ?? [])];
          for (const filter of filters) {
            if (filter.kind === "eq")
              rows = rows.filter((row) => row[filter.column] === filter.value);
            else if (filter.kind === "in")
              rows = rows.filter((row) =>
                filter.values.includes(row[filter.column]),
              );
            else rows = rows.filter((row) => row[filter.column] > filter.value);
          }
          rows.sort((left, right) => {
            for (const item of ordering) {
              const direction = String(left[item.column]).localeCompare(
                String(right[item.column]),
              );
              if (direction)
                return item.ascending === false ? -direction : direction;
            }
            return 0;
          });
          return Promise.resolve({ data: rows.slice(0, size), error: null });
        },
      };
      return query;
    },
  };
}

test("material lineage keeps every transaction while limiting each PostgREST in filter to 100 values", async () => {
  const links = materialLineageRows(200);
  const transactions = materialTransactions(links);
  const inCalls = [];
  const result = await listMaterialBoqLineage(
    materialLineageClient(
      {
        lukas_drawing_material_links: links,
        lukas_qto_material_transactions: transactions,
      },
      inCalls,
    ),
    { projectId: ids.project, cursor: null },
  );

  const transactionCalls = inCalls.filter(
    (call) =>
      call.table === "lukas_qto_material_transactions" &&
      call.column === "material_plan_id",
  );
  assert.ok(
    transactionCalls.length >= 4,
    `expected chunked transaction queries, got ${transactionCalls.length}`,
  );
  assert.ok(
    transactionCalls.every((call) => call.values.length <= 100),
    `oversized material transaction filter: ${JSON.stringify(transactionCalls.map((call) => call.values.length))}`,
  );
  assert.equal(result.rows.length, 200);
  assert.equal(
    result.rows.flatMap((row) => row.transactions).length,
    transactions.length,
  );
  assert.equal(
    new Set(result.rows.flatMap((row) => row.transactions.map(({ id }) => id)))
      .size,
    transactions.length,
  );
  assert.deepEqual(
    result.rows
      .find((row) => row.materialPlanId === links[0].material_plan_id)
      .transactions.map((row) => row.id),
    [uuid("9", 1_000), uuid("9", 1)],
  );
});

test("material lineage returns only the exact BOQ version and line tuple", async () => {
  const [matching] = materialLineageRows(1);
  const otherVersion = "53000000-0000-4000-8000-000000000006";
  const foreign = {
    ...structuredClone(matching),
    id: uuid("7", 2),
    boq_version_id: otherVersion,
    material_plan_id: uuid("6", 2),
    boq_line: { item_code: "FOREIGN-VERSION" },
    material_plan: {
      ...matching.material_plan,
      id: uuid("6", 2),
      material_code: "FOREIGN-VERSION",
    },
  };
  const result = await listMaterialBoqLineage(
    materialLineageClient(
      {
        lukas_drawing_material_links: [matching, foreign],
      },
      [],
    ),
    {
      projectId: ids.project,
      boqVersionId: ids.version,
      boqLineId: ids.line,
      cursor: null,
    },
  );

  assert.deepEqual(
    result.rows.map((row) => [row.boqVersionId, row.boqLineId]),
    [[ids.version, ids.line]],
  );
});

test("material lineage rejects a malformed BOQ version filter", async () => {
  await assert.rejects(
    listMaterialBoqLineage(materialLineageClient({}, []), {
      projectId: ids.project,
      boqVersionId: "not-a-uuid",
      boqLineId: ids.line,
      cursor: null,
    }),
    /자재 계보 범위가 올바르지 않습니다/,
  );
});

function materialControlPlanRows(count, projectId = ids.project) {
  return Array.from({ length: count }, (_, index) => ({
    id: uuid("1", index + 1),
    project_id: projectId,
    material_code: `PAGE-${index + 1}`,
    material_name: `page material ${index + 1}`,
    specification: "standard",
    unit: "EA",
    design_quantity: "1",
    allowance_rate: "0",
    required_quantity: "1",
    rule_id: "PAGED_MATERIAL_V1",
    baseline_factor_id: null,
    source_sha256: "d".repeat(64),
    created_at: new Date(Date.UTC(2026, 0, 1) + index * 1_000).toISOString(),
  }));
}

function materialControlPageClient(rowsByTable, { apiCap = 37 } = {}) {
  const calls = [];
  return {
    calls,
    client: {
      from(table) {
        const filters = [];
        const ordering = [];
        let cursor = null;
        const query = {
          select() {
            return query;
          },
          eq(column, value) {
            filters.push({ kind: "eq", column, value });
            return query;
          },
          in(column, values) {
            filters.push({ kind: "in", column, values: [...values] });
            return query;
          },
          gt(column, value) {
            filters.push({ kind: "gt", column, value });
            return query;
          },
          or(expression) {
            const prefix = "created_at.lt.";
            const separator = ",and(created_at.eq.";
            const idSeparator = ",id.lt.";
            assert.ok(expression.startsWith(prefix));
            const middle = expression.indexOf(separator);
            const idStart = expression.indexOf(
              idSeparator,
              middle + separator.length,
            );
            assert.ok(middle > prefix.length && idStart > middle);
            cursor = {
              createdAt: expression.slice(prefix.length, middle),
              equalCreatedAt: expression.slice(
                middle + separator.length,
                idStart,
              ),
              id: expression.slice(idStart + idSeparator.length, -1),
            };
            return query;
          },
          order(column, options) {
            ordering.push({ column, ascending: options?.ascending !== false });
            return query;
          },
          limit(size) {
            let rows = [...(rowsByTable[table] ?? [])];
            for (const filter of filters) {
              if (filter.kind === "eq")
                rows = rows.filter(
                  (row) => row[filter.column] === filter.value,
                );
              else if (filter.kind === "in")
                rows = rows.filter((row) =>
                  filter.values.includes(row[filter.column]),
                );
              else
                rows = rows.filter((row) => row[filter.column] > filter.value);
            }
            if (cursor) {
              assert.equal(cursor.equalCreatedAt, cursor.createdAt);
              rows = rows.filter(
                (row) =>
                  row.created_at < cursor.createdAt ||
                  (row.created_at === cursor.createdAt && row.id < cursor.id),
              );
            }
            rows.sort((left, right) => {
              for (const item of ordering) {
                const direction = String(left[item.column]).localeCompare(
                  String(right[item.column]),
                );
                if (direction)
                  return item.ascending === false ? -direction : direction;
              }
              return 0;
            });
            calls.push({ table, filters: structuredClone(filters), size });
            return Promise.resolve({
              data: rows.slice(0, Math.min(size, apiCap)),
              error: null,
            });
          },
        };
        return query;
      },
    },
  };
}

test("material control returns a 200-row URL cursor page instead of rejecting 2,001 plans", async () => {
  const plans = materialControlPlanRows(2_001);
  const fixture = materialControlPageClient(
    { lukas_qto_material_plans: plans },
    { apiCap: 250 },
  );

  const first = await listMaterialControlPlanPage(fixture.client, {
    projectId: ids.project,
    cursor: null,
  });
  const second = await listMaterialControlPlanPage(fixture.client, {
    projectId: ids.project,
    cursor: first.nextCursor,
  });

  assert.equal(first.planRows.length, 200);
  assert.equal(second.planRows.length, 200);
  assert.ok(first.nextCursor);
  assert.equal(
    new Set([...first.planRows, ...second.planRows].map((row) => row.id)).size,
    400,
  );
  assert.equal(first.planRows[0].id, plans.at(-1).id);
  assert.equal(second.planRows[0].id, plans.at(-201).id);
  assert.ok(
    fixture.calls
      .filter((call) => call.table === "lukas_qto_material_plans")
      .every((call) =>
        call.filters.some(
          (filter) =>
            filter.kind === "eq" &&
            filter.column === "project_id" &&
            filter.value === ids.project,
        ),
      ),
  );
});

test("material control selected-plan totals include every transaction and referenced factor", async () => {
  const [plan] = materialControlPlanRows(1);
  plan.baseline_factor_id = uuid("2", 1);
  plan.design_quantity = "5";
  plan.required_quantity = "5";
  const orderId = uuid("3", 1);
  const transactionRows = [
    {
      id: orderId,
      project_id: ids.project,
      material_plan_id: plan.id,
      transaction_type: "purchase_order",
      document_number: "PO-EXACT",
      supplier_name: "supplier",
      quantity: "5",
      unit_price_krw: null,
      amount_krw: null,
      related_order_id: null,
      carbon_factor_id: uuid("2", 2),
      evidence_sha256: null,
      created_at: "2026-09-02T00:00:00.000Z",
    },
    ...Array.from({ length: 53 }, (_, index) => ({
      id: uuid("4", index + 1),
      project_id: ids.project,
      material_plan_id: plan.id,
      transaction_type: "goods_receipt",
      document_number: `GR-${index + 1}`,
      supplier_name: "supplier",
      quantity: "0.05",
      unit_price_krw: null,
      amount_krw: null,
      related_order_id: orderId,
      carbon_factor_id: uuid("2", 2),
      evidence_sha256: "e".repeat(64),
      created_at: new Date(Date.UTC(2026, 8, 2, 0, 0, index + 1)).toISOString(),
    })),
  ];
  const factorRows = [
    {
      id: uuid("2", 1),
      project_id: ids.project,
      material_code: plan.material_code,
      product_name: "baseline",
      declared_unit: "EA",
      gwp_a1_a3_per_unit: "1",
      source_type: "generic",
      standard: "ISO 14040",
      source_sha256: "a".repeat(64),
      valid_until: null,
    },
    {
      id: uuid("2", 2),
      project_id: ids.project,
      material_code: plan.material_code,
      product_name: "transaction factor",
      declared_unit: "EA",
      gwp_a1_a3_per_unit: "2",
      source_type: "product_epd",
      standard: "ISO 14025",
      source_sha256: "b".repeat(64),
      valid_until: null,
    },
  ];
  const fixture = materialControlPageClient(
    {
      lukas_qto_material_plans: [plan],
      lukas_qto_material_transactions: transactionRows,
      lukas_qto_carbon_factors: factorRows,
    },
    { apiCap: 7 },
  );

  const result = await listMaterialControlPlanPage(fixture.client, {
    projectId: ids.project,
    materialPlanId: plan.id,
    cursor: null,
    asOfDate: "2026-09-02",
  });

  assert.equal(result.planRows.length, 1);
  assert.equal(result.transactionRows.length, 54);
  assert.deepEqual(
    result.factorRows.map((row) => row.id).sort(),
    factorRows.map((row) => row.id).sort(),
  );
  assert.equal(result.summaries[0].orderedQuantity, "5");
  assert.equal(result.summaries[0].receivedQuantity, "2.65");
  assert.equal(result.summaries[0].baselineA1A3KgCo2e, "5");
  assert.equal(result.summaries[0].receivedA1A3KgCo2e, "5.3");
});

test("material control rejects malformed cursors and cannot select another project's plan", async () => {
  const otherProject = "53000000-0000-4000-8000-000000000099";
  const [foreignPlan] = materialControlPlanRows(1, otherProject);
  const fixture = materialControlPageClient({
    lukas_qto_material_plans: [foreignPlan],
  });

  for (const cursor of ["", "not-a-cursor"])
    await assert.rejects(
      listMaterialControlPlanPage(fixture.client, {
        projectId: ids.project,
        cursor,
      }),
      (error) => error instanceof Response && error.status === 400,
    );
  const foreignCursor = Buffer.from(
    JSON.stringify({
      projectId: otherProject,
      createdAt: "2026-09-02T00:00:00.000Z",
      id: foreignPlan.id,
    }),
  ).toString("base64url");
  await assert.rejects(
    listMaterialControlPlanPage(fixture.client, {
      projectId: ids.project,
      cursor: foreignCursor,
    }),
    (error) => error instanceof Response && error.status === 400,
  );
  await assert.rejects(
    listMaterialControlPlanPage(fixture.client, {
      projectId: ids.project,
      materialPlanId: foreignPlan.id,
      cursor: null,
    }),
    (error) => error instanceof Response && error.status === 404,
  );
});

test("material CSV refuses to export a partial plan page", () => {
  assert.doesNotThrow(() =>
    assertCompleteMaterialControlExport({
      cursor: null,
      nextCursor: null,
      materialPlanId: undefined,
    }),
  );
  for (const page of [
    { cursor: "previous-page", nextCursor: null, materialPlanId: undefined },
    { cursor: null, nextCursor: "next-page", materialPlanId: undefined },
    { cursor: null, nextCursor: null, materialPlanId: uuid("1", 1) },
  ])
    assert.throws(
      () => assertCompleteMaterialControlExport(page),
      (error) => error instanceof Response && error.status === 409,
    );
});
