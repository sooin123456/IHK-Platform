import assert from "node:assert/strict";
import test from "node:test";

import { loadMaterialHandoffContext } from "../app/lukas/lib/drawing-quantity-lineage.server.ts";

const ids = Object.freeze({
  actor: "40000000-0000-4000-8000-000000000001",
  project: "40000000-0000-4000-8000-000000000002",
  version: "40000000-0000-4000-8000-000000000003",
  priceBook: "40000000-0000-4000-8000-000000000004",
});

function uuid(namespace, index) {
  return `${namespace}0000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function mockClient(rowsByTable, inCalls) {
  return {
    from(table) {
      const filters = [];
      let includedIds = null;
      let afterId = null;
      const rows = () =>
        [...(rowsByTable[table] ?? [])]
          .filter((row) =>
            filters.every(([column, value]) => row[column] === value),
          )
          .filter((row) => !includedIds || includedIds.has(row.id))
          .filter((row) => !afterId || row.id > afterId)
          .sort((left, right) => left.id.localeCompare(right.id));
      const query = {
        select() {
          return query;
        },
        eq(column, value) {
          filters.push([column, value]);
          return query;
        },
        in(column, values) {
          assert.equal(column, "id");
          inCalls.push({ table, size: values.length });
          includedIds = new Set(values);
          return query;
        },
        gt(column, value) {
          assert.equal(column, "id");
          afterId = value;
          return query;
        },
        order() {
          return query;
        },
        limit(size) {
          return Promise.resolve({
            data: rows().slice(0, Math.min(size, 17)),
            error: null,
          });
        },
        single() {
          const matches = rows();
          return Promise.resolve({
            data: matches.length === 1 ? matches[0] : null,
            error: matches.length === 1 ? null : { code: "ROW_COUNT" },
          });
        },
      };
      return query;
    },
  };
}

test("material handoff chunks every selected component, resource, and line id query", async () => {
  const count = 205;
  const components = Array.from({ length: count }, (_, index) => ({
    id: uuid("1", index + 1),
    project_id: ids.project,
    version_id: ids.version,
    line_id: uuid("3", index + 1),
    resource_id: uuid("2", index + 1),
    coefficient: "1",
  }));
  const resources = components.map((component, index) => ({
    id: component.resource_id,
    project_id: ids.project,
    price_book_id: ids.priceBook,
    resource_type: "material",
    resource_code: `M-${index + 1}`,
    resource_name: `material-${index + 1}`,
    specification: "standard",
    unit: "m2",
  }));
  const lines = components.map((component, index) => ({
    id: component.line_id,
    project_id: ids.project,
    version_id: ids.version,
    item_code: `L-${index + 1}`,
    unit: "m2",
  }));
  const inCalls = [];
  const context = await loadMaterialHandoffContext(
    mockClient(
      {
        lukas_qto_boq_versions: [
          {
            id: ids.version,
            project_id: ids.project,
            price_book_id: ids.priceBook,
            result_sha256: "a".repeat(64),
            status: "approved",
          },
        ],
        lukas_qto_projects: [{ id: ids.project, owner_id: ids.actor }],
        lukas_qto_boq_rate_components: components,
        lukas_qto_price_resources: resources,
        lukas_qto_boq_lines: lines,
      },
      inCalls,
    ),
    {
      projectId: ids.project,
      boqVersionId: ids.version,
      operationId: "40000000-0000-4000-8000-000000000005",
      selectedRateComponentIds: components.map((row) => row.id).reverse(),
    },
  );

  assert.equal(context.components.length, count);
  assert.deepEqual(
    context.components.map((row) => row.rateComponentId),
    components.map((row) => row.id),
    "chunking preserves the prior globally sorted deterministic order",
  );
  assert.ok(inCalls.length >= 9, "each of the three datasets is chunked");
  assert.ok(
    inCalls.every((call) => call.size <= 100),
    `oversized .in() call: ${JSON.stringify(inCalls)}`,
  );
});
