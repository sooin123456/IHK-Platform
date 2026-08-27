import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";

import {
  createP6MaterialHandoff,
  createDrawingQuantityLink,
  deleteDrawingBoqLink,
  listDrawingObjectQuantityLineage,
  listVerifiedBoqDrawingSources,
  parseVerifiedBoqV1_1RpcInput,
  putDrawingBoqLink,
  recheckAndDecideVerifiedBoqV1_1,
  resolveDrawingWorkspaceEntry,
  submitVerifiedBoqV1_1,
} from "../app/lukas/lib/drawing-quantity-lineage.server.ts";
import { boqManifestStorageObjectPath } from "../app/lukas/lib/storage-object-key.server.ts";
import { listMaterialBoqLineage } from "../app/lukas/lib/material-control.server.ts";
import {
  assertVerifiedBoqSourceAnchorIds,
  loadApprovedVerifiedBoqExport,
} from "../app/lukas/lib/verified-boq-approved-export.server.ts";

const P6_SHA_A = "a".repeat(64);
const P6_SHA_B = "b".repeat(64);

const componentB = "00000000-0000-4000-8000-000000000116";

function materialManifestJson({
  versionId = p6Ids.version,
  handoffSha256 = P6_SHA_B,
  finalQuantity = "4.75",
} = {}) {
  return new TextEncoder().encode(
    JSON.stringify({
      handoffSha256,
      resultSha256: P6_SHA_A,
      calculationManifest: {
        projectId: p6Ids.project,
        boqVersionId: versionId,
        rateComponents: [
          {
            id: p6Ids.component,
            lineId: p6Ids.line,
            resourceId: p6Ids.resource,
            coefficient: "2",
          },
          {
            id: componentB,
            lineId: p6Ids.line,
            resourceId: p6Ids.resource,
            coefficient: "3",
          },
        ],
        resources: [
          {
            id: p6Ids.resource,
            code: "M-001",
            type: "material",
            unit: "m2",
          },
        ],
        result: {
          canonicalLines: [{ lineId: p6Ids.line, unit: "m2", finalQuantity }],
        },
      },
    }),
  );
}

test("approved BOQ material handoff persists only selected authoritative material components", async () => {
  const operationId = "00000000-0000-4000-8000-000000000121";
  const manifestFileId = "00000000-0000-4000-8000-000000000122";
  const inserted = [];
  const plansById = new Map();
  const linksById = new Map();
  const manifestJson = materialManifestJson();
  const manifestFileSha256 = createHash("sha256")
    .update(manifestJson)
    .digest("hex");
  const authority = {
    async loadApprovedExport() {
      return {
        resultSha256: P6_SHA_A,
        manifestSha256: "c".repeat(64),
        handoffSha256: P6_SHA_B,
        manifestJson,
      };
    },
    async loadContext() {
      return {
        ownerId: p6Ids.actor,
        projectId: p6Ids.project,
        boqVersionId: p6Ids.version,
        priceBookId: p6Ids.priceBook,
        resultSha256: P6_SHA_A,
        components: [
          {
            boqVersionId: p6Ids.version,
            lineId: p6Ids.line,
            rateComponentId: p6Ids.component,
            resourceId: p6Ids.resource,
            resourceCode: "M-001",
            resourceName: "벽체재",
            resourceSpecification: "12.5T",
            resourceUnit: "m2",
            resourceType: "material",
            resourcePriceBookId: p6Ids.priceBook,
            resourceCoefficient: "2",
            finalQuantity: "4.75",
          },
        ],
      };
    },
    async persistManifest(input) {
      assert.deepEqual(input.bytes, manifestJson);
      assert.equal(
        input.path,
        `${p6Ids.actor}/${p6Ids.project}/boq-manifests/${manifestFileSha256}.manifest.json`,
      );
      assert.equal(input.manifestFileSha256, manifestFileSha256);
      return manifestFileId;
    },
    async insertHandoff(input) {
      for (const plan of input.plans) {
        const prior = plansById.get(plan.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(plan))
          throw Object.assign(new Error("mismatched retry"), { code: "P6O01" });
        plansById.set(plan.id, plan);
      }
      for (const link of input.links) {
        const prior = linksById.get(link.id);
        if (prior && JSON.stringify(prior) !== JSON.stringify(link))
          throw Object.assign(new Error("mismatched retry"), { code: "P6O01" });
        linksById.set(link.id, link);
      }
      inserted.push(input);
      return input;
    },
  };
  const result = await createP6MaterialHandoff(
    authorizedClient(p6Ids.actor, p6Ids.project, "estimator"),
    p6Ids.actor,
    {
      projectId: p6Ids.project,
      boqVersionId: p6Ids.version,
      operationId,
      selectedRateComponentIds: [p6Ids.component],
    },
    authority,
  );
  assert.equal(result.manifestFileId, manifestFileId);
  assert.equal(result.materialPlanIds.length, 1);
  assert.equal(result.materialLinkIds.length, 1);
  assert.deepEqual(
    inserted[0].plans.map((row) => ({
      materialCode: row.materialCode,
      designQuantity: row.designQuantity,
      allowanceRate: row.allowanceRate,
      requiredQuantity: row.requiredQuantity,
    })),
    [
      {
        materialCode: "M-001",
        designQuantity: "9.5",
        allowanceRate: "0",
        requiredQuantity: "9.5",
      },
    ],
  );
  assert.deepEqual(
    inserted[0].links.map((row) => row.derivedDesignQuantity),
    ["9.5"],
  );
  const retry = await createP6MaterialHandoff(
    authorizedClient(p6Ids.actor, p6Ids.project, "estimator"),
    p6Ids.actor,
    {
      projectId: p6Ids.project,
      boqVersionId: p6Ids.version,
      operationId,
      selectedRateComponentIds: [p6Ids.component],
    },
    authority,
  );
  assert.deepEqual(retry, result);
  assert.deepEqual(inserted[1], inserted[0]);

  const mismatched = {
    ...authority,
    async loadContext() {
      const context = await authority.loadContext();
      return {
        ...context,
        components: [
          {
            ...context.components[0],
            rateComponentId: componentB,
            resourceCoefficient: "3",
          },
        ],
      };
    },
  };
  await assert.rejects(
    createP6MaterialHandoff(
      authorizedClient(p6Ids.actor, p6Ids.project, "estimator"),
      p6Ids.actor,
      {
        projectId: p6Ids.project,
        boqVersionId: p6Ids.version,
        operationId,
        selectedRateComponentIds: [componentB],
      },
      mismatched,
    ),
    (error) => error.code === "P6O01",
  );

  const nextVersion = "00000000-0000-4000-8000-000000000117";
  const nextHandoffSha256 = "d".repeat(64);
  const nextManifestJson = materialManifestJson({
    versionId: nextVersion,
    handoffSha256: nextHandoffSha256,
  });
  const later = await createP6MaterialHandoff(
    authorizedClient(p6Ids.actor, p6Ids.project, "estimator"),
    p6Ids.actor,
    {
      projectId: p6Ids.project,
      boqVersionId: nextVersion,
      operationId,
      selectedRateComponentIds: [p6Ids.component],
    },
    {
      ...authority,
      async loadApprovedExport() {
        return {
          resultSha256: P6_SHA_A,
          manifestSha256: "c".repeat(64),
          handoffSha256: nextHandoffSha256,
          manifestJson: nextManifestJson,
        };
      },
      async loadContext() {
        const context = await authority.loadContext();
        return {
          ...context,
          boqVersionId: nextVersion,
          components: context.components.map((component) => ({
            ...component,
            boqVersionId: nextVersion,
          })),
        };
      },
      async persistManifest(input) {
        assert.deepEqual(input.bytes, nextManifestJson);
        return "00000000-0000-4000-8000-000000000118";
      },
    },
  );
  assert.notDeepEqual(later.materialPlanIds, result.materialPlanIds);

  const zeroOperation = "00000000-0000-4000-8000-000000000119";
  const zeroManifest = materialManifestJson({ finalQuantity: "0" });
  const zeroAuthority = {
    ...authority,
    async loadApprovedExport() {
      return {
        resultSha256: P6_SHA_A,
        manifestSha256: "c".repeat(64),
        handoffSha256: P6_SHA_B,
        manifestJson: zeroManifest,
      };
    },
    async loadContext() {
      const context = await authority.loadContext();
      return {
        ...context,
        components: [{ ...context.components[0], finalQuantity: "0" }],
      };
    },
    async persistManifest() {
      return manifestFileId;
    },
  };
  await createP6MaterialHandoff(
    authorizedClient(p6Ids.actor, p6Ids.project, "estimator"),
    p6Ids.actor,
    {
      projectId: p6Ids.project,
      boqVersionId: p6Ids.version,
      operationId: zeroOperation,
      selectedRateComponentIds: [p6Ids.component],
    },
    zeroAuthority,
  );
  await assert.rejects(
    createP6MaterialHandoff(
      authorizedClient(p6Ids.actor, p6Ids.project, "estimator"),
      p6Ids.actor,
      {
        projectId: p6Ids.project,
        boqVersionId: p6Ids.version,
        operationId: zeroOperation,
        selectedRateComponentIds: [componentB],
      },
      {
        ...zeroAuthority,
        async loadContext() {
          const context = await zeroAuthority.loadContext();
          return {
            ...context,
            components: [
              {
                ...context.components[0],
                rateComponentId: componentB,
                resourceCoefficient: "3",
              },
            ],
          };
        },
      },
    ),
    (error) => error.code === "P6O01",
  );
});

test("material handoff fails closed on non-material, stale, missing, duplicate, or non-positive selected components", async () => {
  const base = {
    boqVersionId: p6Ids.version,
    lineId: p6Ids.line,
    rateComponentId: p6Ids.component,
    resourceId: p6Ids.resource,
    resourceCode: "M-001",
    resourceName: "벽체재",
    resourceSpecification: "12.5T",
    resourceUnit: "m2",
    resourceType: "material",
    resourcePriceBookId: p6Ids.priceBook,
    resourceCoefficient: "2",
    finalQuantity: "4.75",
  };
  for (const components of [
    [],
    [{ ...base, resourceType: "labor" }],
    [{ ...base, resourcePriceBookId: "00000000-0000-4000-8000-000000000199" }],
    [{ ...base, resourceCoefficient: "0" }],
  ]) {
    let persisted = false;
    await assert.rejects(
      createP6MaterialHandoff(
        authorizedClient(p6Ids.actor, p6Ids.project, "estimator"),
        p6Ids.actor,
        {
          projectId: p6Ids.project,
          boqVersionId: p6Ids.version,
          operationId: "00000000-0000-4000-8000-000000000121",
          selectedRateComponentIds: [p6Ids.component],
        },
        {
          async loadApprovedExport() {
            return {
              resultSha256: P6_SHA_A,
              manifestSha256: "c".repeat(64),
              handoffSha256: P6_SHA_B,
              manifestJson: materialManifestJson(),
            };
          },
          async loadContext() {
            return {
              ownerId: p6Ids.actor,
              projectId: p6Ids.project,
              boqVersionId: p6Ids.version,
              priceBookId: p6Ids.priceBook,
              resultSha256: P6_SHA_A,
              components,
            };
          },
          async persistManifest() {
            persisted = true;
            return p6Ids.quantity;
          },
          async insertHandoff() {
            throw new Error("unexpected");
          },
        },
      ),
      (error) => error.code === "P6M01",
    );
    assert.equal(persisted, false);
  }
});

test("BOQ manifest storage path accepts only canonical UUIDs and lowercase file digests", () => {
  assert.equal(
    boqManifestStorageObjectPath({
      ownerId: p6Ids.actor,
      projectId: p6Ids.project,
      manifestFileSha256: P6_SHA_A,
    }),
    `${p6Ids.actor}/${p6Ids.project}/boq-manifests/${P6_SHA_A}.manifest.json`,
  );
  for (const input of [
    {
      ownerId: "not-a-uuid",
      projectId: p6Ids.project,
      manifestFileSha256: P6_SHA_A,
    },
    {
      ownerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa".toUpperCase(),
      projectId: p6Ids.project,
      manifestFileSha256: P6_SHA_A,
    },
    {
      ownerId: p6Ids.actor,
      projectId: p6Ids.project,
      manifestFileSha256: P6_SHA_A.toUpperCase(),
    },
  ])
    assert.throws(() => boqManifestStorageObjectPath(input));
});

test("material lineage traverses approved BOQ through plan, transactions, carbon, and file digests", async () => {
  const planId = "00000000-0000-4000-8000-000000000131";
  const linkId = "00000000-0000-4000-8000-000000000132";
  const orderId = "00000000-0000-4000-8000-000000000135";
  const transactionId = "00000000-0000-4000-8000-000000000133";
  const factorId = "00000000-0000-4000-8000-000000000134";
  const client = cappedTableClient({
    lukas_drawing_material_links: [
      {
        id: linkId,
        project_id: p6Ids.project,
        boq_version_id: p6Ids.version,
        boq_line_id: p6Ids.line,
        boq_rate_component_id: p6Ids.component,
        material_resource_id: p6Ids.resource,
        boq_result_sha256: P6_SHA_A,
        material_plan_id: planId,
        derived_design_quantity: "9.5",
        created_at: "2026-08-28T00:00:00.000Z",
        boq_line: { item_code: "001-A" },
        material_plan: {
          id: planId,
          material_code: "M-001",
          material_name: "벽체재",
          specification: "12.5T",
          unit: "m2",
          design_quantity: "9.5",
          allowance_rate: "0",
          required_quantity: "9.5",
          rule_id: "P6_MATERIAL_HANDOFF_V1",
          baseline_factor_id: null,
          source_file_id: p6Ids.quantity,
          source_sha256: P6_SHA_B,
        },
      },
    ],
    lukas_qto_material_transactions: [
      {
        id: orderId,
        material_plan_id: planId,
        transaction_type: "purchase_order",
        document_number: "PO-1",
        supplier_name: "공급사",
        quantity: "9.5",
        unit_price_krw: null,
        amount_krw: null,
        related_order_id: null,
        carbon_factor_id: factorId,
        evidence_sha256: null,
      },
      {
        id: transactionId,
        material_plan_id: planId,
        transaction_type: "goods_receipt",
        document_number: "GR-1",
        supplier_name: "공급사",
        quantity: "9.5",
        unit_price_krw: null,
        amount_krw: null,
        related_order_id: orderId,
        carbon_factor_id: null,
        evidence_sha256: "c".repeat(64),
      },
    ],
    lukas_qto_carbon_factors: [
      {
        id: factorId,
        material_code: "M-001",
        product_name: "제품 EPD",
        declared_unit: "m2",
        gwp_a1_a3_per_unit: "1.2",
        source_type: "product_epd",
        standard: "EN 15804",
        manufacturer: "공급사",
        epd_program_operator: "EPD",
        epd_declaration_number: "D-1",
        epd_verifier: "V",
        pcr_reference: "PCR",
        valid_until: "2020-01-01",
        source_sha256: "d".repeat(64),
      },
    ],
  });
  const result = await listMaterialBoqLineage(client, {
    projectId: p6Ids.project,
    materialPlanId: planId,
    cursor: null,
  });
  assert.equal(result.nextCursor, null);
  assert.equal(result.rows[0].itemCode, "001-A");
  assert.equal(result.rows[0].materialPlanId, planId);
  assert.deepEqual(
    result.rows[0].transactions.map((row) => row.id),
    [orderId, transactionId],
  );
  assert.deepEqual(
    result.rows[0].carbonFactors.map((row) => row.id),
    [factorId],
  );
  assert.equal(result.rows[0].manifestFileSha256, P6_SHA_B);
  assert.equal(result.rows[0].carbonCoverage, "missing");
});

test("material lineage cursor returns every link once across bounded pages", async () => {
  const planId = "00000000-0000-4000-8000-000000000141";
  const links = [1, 2, 3].map((value) => ({
    id: `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`,
    project_id: p6Ids.project,
    boq_version_id: p6Ids.version,
    boq_line_id: p6Ids.line,
    boq_rate_component_id: `00000000-0000-4000-8100-${String(value).padStart(12, "0")}`,
    material_resource_id: p6Ids.resource,
    boq_result_sha256: P6_SHA_A,
    material_plan_id: planId,
    derived_design_quantity: String(value),
    created_at: `2026-08-28T00:00:0${4 - value}.123456+00:00`,
    boq_line: { item_code: `I-${value}` },
    material_plan: {
      id: planId,
      material_code: "M-001",
      material_name: "벽체재",
      specification: "12.5T",
      unit: "m2",
      design_quantity: "6",
      allowance_rate: "0",
      required_quantity: "6",
      rule_id: "P6_MATERIAL_HANDOFF_V1",
      baseline_factor_id: null,
      source_file_id: p6Ids.quantity,
      source_sha256: P6_SHA_B,
    },
  }));
  const client = pagedLineageClient(links);
  const first = await listMaterialBoqLineage(client, {
    projectId: p6Ids.project,
    cursor: null,
    limit: 2,
  });
  const second = await listMaterialBoqLineage(client, {
    projectId: p6Ids.project,
    cursor: first.nextCursor,
    limit: 2,
  });
  assert.ok(first.nextCursor);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(
    [...first.rows, ...second.rows].map((row) => row.rateComponentId),
    links.map((row) => row.boq_rate_component_id),
  );
  assert.ok(
    [...first.rows, ...second.rows].every(
      (row) => row.carbonCoverage === "missing",
    ),
  );
  const unsafeDateCursor = Buffer.from(
    JSON.stringify({ createdAt: "2026-08-28 00:00:00Z", id: links[0].id }),
  ).toString("base64url");
  await assert.rejects(
    listMaterialBoqLineage(client, {
      projectId: p6Ids.project,
      cursor: unsafeDateCursor,
      limit: 2,
    }),
    /커서가 올바르지 않습니다/,
  );
  await assert.rejects(
    listMaterialBoqLineage(
      tableClient({
        lukas_drawing_material_links: [links[0]],
        lukas_qto_material_transactions: Array.from(
          { length: 10_001 },
          () => ({}),
        ),
      }),
      { projectId: p6Ids.project, cursor: null },
    ),
    /허용 범위를 초과했습니다/,
  );
});

test("procurement and site roles gain no BOQ material handoff write authority", async () => {
  for (const role of ["procurement", "site", "viewer"]) {
    let privileged = false;
    await assert.rejects(
      createP6MaterialHandoff(
        authorizedClient(p6Ids.actor, p6Ids.project, role),
        p6Ids.actor,
        {
          projectId: p6Ids.project,
          boqVersionId: p6Ids.version,
          operationId: "00000000-0000-4000-8000-000000000151",
          selectedRateComponentIds: [p6Ids.component],
        },
        {
          async loadApprovedExport() {
            privileged = true;
            throw new Error("unexpected");
          },
          async loadContext() {
            throw new Error("unexpected");
          },
          async persistManifest() {
            throw new Error("unexpected");
          },
          async insertHandoff() {
            throw new Error("unexpected");
          },
        },
      ),
      (error) => error.code === "P6A01",
    );
    assert.equal(privileged, false);
  }
});

function tableClient(rows) {
  return {
    from(table) {
      const result = { data: rows[table] ?? [], error: null };
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        order() {
          return query;
        },
        or() {
          return query;
        },
        limit() {
          return Promise.resolve(result);
        },
        range(from, to) {
          return Promise.resolve({
            data: (rows[table] ?? []).slice(from, to + 1),
            error: null,
          });
        },
      };
      return query;
    },
  };
}

function cappedTableClient(rows) {
  return {
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        order() {
          return query;
        },
        or() {
          return query;
        },
        limit() {
          return Promise.resolve({ data: rows[table] ?? [], error: null });
        },
        range(from, to) {
          const cap = table === "lukas_qto_material_transactions" ? 1 : to + 1;
          return Promise.resolve({
            data: (rows[table] ?? []).slice(from, Math.min(to + 1, from + cap)),
            error: null,
          });
        },
      };
      return query;
    },
  };
}

function pagedLineageClient(links) {
  return {
    from(table) {
      let cursor = null;
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        in() {
          return query;
        },
        order() {
          return query;
        },
        or(value) {
          const match =
            /^created_at\.lt\.([^,]+),and\(created_at\.eq\.[^,]+,id\.lt\.([^)]+)\)$/.exec(
              value,
            );
          if (match) cursor = { createdAt: match[1], id: match[2] };
          return query;
        },
        limit(size) {
          if (table !== "lukas_drawing_material_links")
            return Promise.resolve({ data: [], error: null });
          const rows = cursor
            ? links.filter(
                (row) =>
                  row.created_at < cursor.createdAt ||
                  (row.created_at === cursor.createdAt && row.id < cursor.id),
              )
            : links;
          return Promise.resolve({ data: rows.slice(0, size), error: null });
        },
        range() {
          return Promise.resolve({ data: [], error: null });
        },
      };
      return query;
    },
  };
}

const p6Ids = {
  actor: "00000000-0000-4000-8000-000000000101",
  reviewer: "00000000-0000-4000-8000-000000000102",
  project: "00000000-0000-4000-8000-000000000103",
  version: "00000000-0000-4000-8000-000000000104",
  section: "00000000-0000-4000-8000-000000000105",
  line: "00000000-0000-4000-8000-000000000106",
  quantity: "00000000-0000-4000-8000-000000000107",
  drawingLink: "00000000-0000-4000-8000-000000000108",
  revision: "00000000-0000-4000-8000-000000000109",
  object: "00000000-0000-4000-8000-000000000110",
  lineage: "00000000-0000-4000-8000-000000000111",
  priceBook: "00000000-0000-4000-8000-000000000112",
  priceFile: "00000000-0000-4000-8000-000000000113",
  resource: "00000000-0000-4000-8000-000000000114",
  component: "00000000-0000-4000-8000-000000000115",
};

function boqInputRpcPayload() {
  return {
    inputStateSha256: P6_SHA_A,
    input: {
      versionId: p6Ids.version,
      projectId: p6Ids.project,
      engineVersion: "VERIFIED-BOQ-1.1",
      calculationPolicy: "general_half_away",
      quantityScale: 3,
      lines: [
        {
          id: p6Ids.line,
          sectionId: p6Ids.section,
          section: {
            id: p6Ids.section,
            parentId: null,
            code: "01",
            name: "건축",
            sortOrder: 1,
          },
          itemCode: "001-A",
          itemName: "벽체",
          specification: "A",
          unit: "m2",
          adjustment: "0",
          reason: "",
          sortOrder: 1,
        },
      ],
      drawingLinks: [
        {
          id: p6Ids.drawingLink,
          line: p6Ids.line,
          factor: "1",
          version: 1,
          source: {
            id: p6Ids.quantity,
            revisionId: p6Ids.revision,
            revisionVersion: 2,
            snapshotSha256: P6_SHA_B,
            objectId: p6Ids.object,
            lineageId: p6Ids.lineage,
            objectVersion: 3,
            fingerprint: P6_SHA_A,
            kind: "area",
            rawQuantity: "4.75",
            unit: "m2",
            rule: "P4_MEASUREMENT_V1",
            anchors: [],
            issues: [],
          },
        },
      ],
      legacyMappings: [],
      legacyExclusions: [],
      components: [
        {
          id: p6Ids.component,
          line: p6Ids.line,
          resourceId: p6Ids.resource,
          coefficient: "2",
          resource: {
            id: p6Ids.resource,
            code: "M-001",
            type: "material",
            name: "벽체재",
            specification: "A",
            unit: "m2",
            unitPriceKrw: "100",
            priceBookId: p6Ids.priceBook,
          },
        },
      ],
      priceBook: {
        id: p6Ids.priceBook,
        name: "고객 단가표",
        versionLabel: "2026-08",
        fileId: p6Ids.priceFile,
        sha256: P6_SHA_B,
        effectiveDate: "2026-08-01",
        currency: "KRW",
        rightsBasis: "customer_owned",
        licenseNote: "customer",
      },
    },
  };
}

test("trusted quantity creation forwards only server-derived evidence", async () => {
  const ids = {
    actor: "00000000-0000-4000-8000-000000000001",
    project: "00000000-0000-4000-8000-000000000002",
    document: "00000000-0000-4000-8000-000000000003",
    revision: "00000000-0000-4000-8000-000000000004",
    object: "00000000-0000-4000-8000-000000000005",
    layer: "00000000-0000-4000-8000-000000000006",
    page: "00000000-0000-4000-8000-000000000007",
    link: "00000000-0000-4000-8000-000000000008",
  };
  const canonicalJson = {
    schemaVersion: 2,
    revision: {
      id: ids.revision,
      documentId: ids.document,
      projectId: ids.project,
      sequence: 1,
      version: 7,
    },
    sources: [],
    pages: [],
    canvases: [],
    layers: [],
    objects: [
      {
        id: ids.object,
        lineageId: ids.object,
        pageId: ids.page,
        layerId: ids.layer,
        name: "A-01",
        type: "area",
        geometry: {
          type: "area",
          semanticVersion: 1,
          boundary: [
            { x: 0, y: 0 },
            { x: 5000, y: 0 },
            { x: 5000, y: 2500 },
            { x: 0, y: 2500 },
          ],
        },
        styleId: null,
        style: { stroke: "#111111", strokeWidth: 1, fill: null },
        version: 3,
      },
    ],
    styles: [],
    blocks: [],
    blockInstances: [],
    propertySchemas: [],
    propertyValues: [],
    tables: [],
    issues: [],
    operationSequence: 12,
  };
  const snapshotSha256 = "a".repeat(64);
  const calls = [];
  const client = authorizedClient(ids.actor, ids.project, "estimator");

  const result = await createDrawingQuantityLink(
    client,
    ids.actor,
    {
      projectId: ids.project,
      drawingRevisionId: ids.revision,
      drawingObjectId: ids.object,
      measurementKind: "area",
      linkId: ids.link,
    },
    {
      async transaction(run) {
        return run({
          async loadAuthority() {
            return {
              projectId: ids.project,
              documentId: ids.document,
              revisionId: ids.revision,
              revisionVersion: 7,
              revisionStatus: "approved",
              operationSequence: 12,
              canonicalJson,
              snapshotSha256,
              recomputedSnapshotSha256: snapshotSha256,
              approvalDecision: "approved",
              objectId: ids.object,
              objectLineageId: ids.object,
              objectVersion: 3,
              sourceAnchors: [],
              issueLinks: [],
            };
          },
          async insertQuantityLink(args) {
            calls.push(args);
            return {
              id: ids.link,
              project_id: ids.project,
              drawing_revision_id: ids.revision,
              drawing_revision_version: 7,
              drawing_snapshot_sha256: snapshotSha256,
              drawing_object_id: ids.object,
              drawing_object_lineage_id: ids.object,
              drawing_object_version: 3,
              object_fingerprint: args.p_object_fingerprint,
              measurement_kind: "area",
              raw_quantity: "12.5",
              unit: "m2",
              measurement_rule_version: "P4_MEASUREMENT_V1",
              created_by: ids.actor,
              created_at: "2026-08-28T00:00:00.000Z",
            };
          },
        });
      },
    },
  );

  assert.equal(result.rawQuantity, "12.5");
  assert.deepEqual(calls[0], {
    p_actor_id: ids.actor,
    p_id: ids.link,
    p_revision_id: ids.revision,
    p_object_id: ids.object,
    p_measurement_kind: "area",
    p_snapshot_sha256: snapshotSha256,
    p_object_lineage_id: ids.object,
    p_object_version: 3,
    p_object_fingerprint: calls[0].p_object_fingerprint,
    p_raw_quantity: "12.5",
    p_unit: "m2",
    p_measurement_rule_version: "P4_MEASUREMENT_V1",
  });
  assert.match(calls[0].p_object_fingerprint, /^[0-9a-f]{64}$/);
});

test("quantity creation rejects anonymous and read-only roles before database access", async () => {
  const project = "00000000-0000-4000-8000-000000000011";
  const actor = "00000000-0000-4000-8000-000000000012";
  const input = {
    projectId: project,
    drawingRevisionId: "00000000-0000-4000-8000-000000000013",
    drawingObjectId: "00000000-0000-4000-8000-000000000014",
    measurementKind: "count",
    linkId: "00000000-0000-4000-8000-000000000015",
  };
  for (const role of ["viewer", "site", "reviewer"]) {
    let touched = false;
    await assert.rejects(
      createDrawingQuantityLink(
        authorizedClient(actor, project, role),
        actor,
        input,
        {
          async transaction() {
            touched = true;
          },
        },
      ),
      (error) => error.code === "P6A01" && Boolean(error.requestId),
    );
    assert.equal(touched, false);
  }
});

test("owner, estimator, and verified staff reach trusted authority with server identity", async () => {
  const project = "00000000-0000-4000-8000-000000000016";
  const actor = "00000000-0000-4000-8000-000000000017";
  const input = {
    projectId: project,
    drawingRevisionId: "00000000-0000-4000-8000-000000000018",
    drawingObjectId: "00000000-0000-4000-8000-000000000019",
    measurementKind: "count",
    linkId: "00000000-0000-4000-8000-000000000020",
  };
  for (const [role, isStaff] of [
    ["owner", false],
    ["estimator", false],
    ["staff", true],
  ]) {
    let trustedActor = null;
    await assert.rejects(
      createDrawingQuantityLink(
        authorizedClient(actor, project, role),
        actor,
        input,
        {
          async transaction(_run, context) {
            trustedActor = context;
            throw Object.assign(new Error("bounded"), { code: "P6Q03" });
          },
        },
      ),
      (error) => error.code === "P6Q03",
    );
    assert.deepEqual(trustedActor, { actorId: actor, isStaff });
  }
});

test("lineage pages by created_at and id with a hard 200 row bound", async () => {
  const client = lineageClient();
  const page = await listDrawingObjectQuantityLineage(client, {
    projectId: "00000000-0000-4000-8000-000000000021",
    revisionId: "00000000-0000-4000-8000-000000000022",
    objectId: "00000000-0000-4000-8000-000000000023",
    cursor: null,
    limit: 500,
  });
  assert.equal(page.rows.length, 200);
  assert.ok(page.nextCursor);
  assert.deepEqual(client.orders.slice(0, 2), ["created_at", "id"]);
});

test("exact BOQ evidence is included even when its quantity is older than the first page", async () => {
  const target = quantityFixture({
    id: "00000000-0000-4000-8000-0000000002ff",
    created_at: "2020-01-01T00:00:00.000Z",
  });
  const recent = Array.from({ length: 201 }, (_, index) =>
    quantityFixture({
      id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
      created_at: `2026-08-28T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    }),
  );
  const exactLink = {
    ...drawingLinkFixture(target.id),
    boq_version: { status: "approved" },
    boq_line: { item_code: "001-A" },
    quantity: { id: target.id },
  };
  const client = {
    from(table) {
      if (table === "lukas_drawing_quantity_links") {
        const query = chain({ data: target, error: null });
        query.limit = (size) =>
          Promise.resolve({ data: recent.slice(0, size), error: null });
        return query;
      }
      const query = chain({ data: exactLink, error: null });
      query.limit = () => Promise.resolve({ data: [], error: null });
      return query;
    },
  };
  const page = await listDrawingObjectQuantityLineage(client, {
    projectId: p6Ids.project,
    revisionId: p6Ids.revision,
    objectId: p6Ids.object,
    cursor: null,
    limit: 200,
    boqEvidence: {
      boqVersionId: p6Ids.version,
      boqLineId: p6Ids.line,
    },
  });
  assert.equal(page.rows.length, 200);
  assert.equal(page.rows[0].quantity.id, target.id);
  assert.equal(page.rows[0].boqLinks[0].id, exactLink.id);
  assert.ok(page.nextCursor);
});

test("workspace resolution returns exact evidence route and never falls back", async () => {
  const ids = {
    project: "00000000-0000-4000-8000-000000000031",
    revision: "00000000-0000-4000-8000-000000000032",
    object: "00000000-0000-4000-8000-000000000033",
    boq: "00000000-0000-4000-8000-000000000034",
    line: "00000000-0000-4000-8000-000000000035",
    document: "00000000-0000-4000-8000-000000000036",
    file: "00000000-0000-4000-8000-000000000037",
  };
  const client = exactEntryClient(ids);
  assert.equal(
    await resolveDrawingWorkspaceEntry(client, {
      projectId: ids.project,
      revisionId: ids.revision,
      objectId: ids.object,
      boqVersionId: ids.boq,
      boqLineId: ids.line,
      fileId: ids.file,
    }),
    `/projects/${ids.project}/drawings/${ids.file}/workspace?document=${ids.document}&revision=${ids.revision}&object=${ids.object}&boq=${ids.boq}&line=${ids.line}&evidence=${ids.file}&view=2d`,
  );
  await assert.rejects(
    resolveDrawingWorkspaceEntry(exactEntryClient({ ...ids, file: null }), {
      projectId: ids.project,
      revisionId: ids.revision,
      objectId: ids.object,
      boqVersionId: ids.boq,
      boqLineId: ids.line,
      fileId: ids.file,
    }),
    /연결된 도면 근거를 열 수 없습니다/,
  );
});

test("1.1 RPC input parser keeps fixed authoritative fields and rejects injection", () => {
  const parsed = parseVerifiedBoqV1_1RpcInput(boqInputRpcPayload());
  assert.equal(parsed.projectId, p6Ids.project);
  assert.equal(parsed.inputStateSha256, P6_SHA_A);
  assert.equal(parsed.input.engineVersion, "VERIFIED-BOQ-1.1");
  assert.equal(parsed.input.drawingMappings[0].source.rawQuantity, "4.75");
  assert.equal(parsed.input.drawingMappings[0].allocationFactor, "1");
  assert.equal(parsed.input.resources[0].unit, "m2");

  for (const mutate of [
    (value) => (value.resultSha256 = P6_SHA_B),
    (value) => (value.input.lines[0].finalQuantity = "999"),
    (value) => (value.input.drawingLinks[0].source.amount = "999"),
    (value) => (value.input.components[0].resource.unitPrice = "999"),
  ]) {
    const injected = structuredClone(boqInputRpcPayload());
    mutate(injected);
    assert.throws(
      () => parseVerifiedBoqV1_1RpcInput(injected),
      (error) => error.code === "P6B04",
    );
  }

  const nonFiniteAnchor = boqInputRpcPayload();
  nonFiniteAnchor.input.drawingLinks[0].source.anchors = [
    {
      id: "00000000-0000-4000-8000-000000000123",
      sourceFileId: p6Ids.priceFile,
      sourceSha256: P6_SHA_A,
      sourceKind: "pdf_region",
      pdfPageNumber: 1,
      x: "NaN",
      y: 0,
      width: 1,
      height: 1,
      elementId: null,
      ifcGlobalId: null,
      camera: null,
      version: 1,
    },
  ];
  assert.throws(
    () => parseVerifiedBoqV1_1RpcInput(nonFiniteAnchor),
    (error) => error.code === "P6B04",
  );

  const wrongBook = boqInputRpcPayload();
  wrongBook.input.components[0].resource.priceBookId = p6Ids.project;
  assert.throws(
    () => parseVerifiedBoqV1_1RpcInput(wrongBook),
    (error) => error.code === "P6B04",
  );
  const conflicting = boqInputRpcPayload();
  conflicting.input.components.push({
    ...structuredClone(conflicting.input.components[0]),
    id: "00000000-0000-4000-8000-000000000116",
    resource: {
      ...structuredClone(conflicting.input.components[0].resource),
      unitPriceKrw: "999",
    },
  });
  assert.throws(
    () => parseVerifiedBoqV1_1RpcInput(conflicting),
    (error) => error.code === "P6B04",
  );
});

test("BOQ link put accepts only IDs factor and OCC version, supports partial and exact retry", async () => {
  const calls = [];
  const row = {
    id: p6Ids.drawingLink,
    project_id: p6Ids.project,
    quantity_link_id: p6Ids.quantity,
    boq_version_id: p6Ids.version,
    boq_line_id: p6Ids.line,
    allocation_factor: "0.5",
    version: 1,
    created_by: p6Ids.actor,
    updated_by: p6Ids.actor,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
  const client = rpcClient(p6Ids.actor, async (name, args) => {
    calls.push([name, args]);
    return { data: row, error: null };
  });
  const input = {
    id: p6Ids.drawingLink,
    quantityLinkId: p6Ids.quantity,
    boqVersionId: p6Ids.version,
    boqLineId: p6Ids.line,
    allocationFactor: "0.5",
    baseVersion: null,
  };
  assert.equal(
    (await putDrawingBoqLink(client, input)).allocationFactor,
    "0.5",
  );
  assert.deepEqual(calls[0], [
    "lukas_drawing_put_boq_link",
    {
      p_id: p6Ids.drawingLink,
      p_quantity_link_id: p6Ids.quantity,
      p_boq_version_id: p6Ids.version,
      p_boq_line_id: p6Ids.line,
      p_allocation_factor: "0.5",
      p_base_version: null,
    },
  ]);
  assert.deepEqual(
    await putDrawingBoqLink(client, input),
    await putDrawingBoqLink(client, input),
  );

  await assert.rejects(
    putDrawingBoqLink(client, { ...input, resultSha256: P6_SHA_A }),
    (error) => error.code === "P6B04",
  );
});

test("BOQ link put/delete bounds allocation, unit, authorization, project, and OCC failures", async () => {
  const input = {
    id: p6Ids.drawingLink,
    quantityLinkId: p6Ids.quantity,
    boqVersionId: p6Ids.version,
    boqLineId: p6Ids.line,
    allocationFactor: "1",
    baseVersion: 3,
  };
  for (const code of ["P6B04", "P6U01", "P6A01", "P6O01"]) {
    const client = rpcClient(p6Ids.actor, async () => ({
      data: null,
      error: { code, message: "database detail must stay bounded" },
    }));
    await assert.rejects(
      putDrawingBoqLink(client, input),
      (error) =>
        error.code === code && !error.message.includes("database detail"),
    );
  }
  await assert.rejects(
    putDrawingBoqLink(rpcClient(p6Ids.actor), {
      ...input,
      allocationFactor: "1.000000001",
    }),
    (error) => error.code === "P6B04",
  );
  const calls = [];
  await deleteDrawingBoqLink(
    rpcClient(p6Ids.actor, async (name, args) => {
      calls.push([name, args]);
      return { data: { id: p6Ids.drawingLink, deleted: true }, error: null };
    }),
    { id: p6Ids.drawingLink, baseVersion: 3 },
  );
  assert.deepEqual(calls[0], [
    "lukas_drawing_delete_boq_link",
    {
      p_id: p6Ids.drawingLink,
      p_base_version: 3,
    },
  ]);
});

test("verified BOQ Drawing source loader caps sources and links at 200", async () => {
  const quantities = Array.from({ length: 201 }, (_, index) => ({
    id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, "0")}`,
    project_id: p6Ids.project,
    drawing_revision_id: p6Ids.revision,
    drawing_revision_version: 2,
    drawing_snapshot_sha256: P6_SHA_B,
    drawing_object_id: p6Ids.object,
    drawing_object_lineage_id: p6Ids.lineage,
    drawing_object_version: 3,
    object_fingerprint: P6_SHA_A,
    measurement_kind: "area",
    raw_quantity: "4.75",
    unit: "m2",
    measurement_rule_version: "P4_MEASUREMENT_V1",
    created_by: p6Ids.actor,
    created_at: "2026-08-28T00:00:00.000Z",
  }));
  const client = listClient({ quantities, links: [] });
  const page = await listVerifiedBoqDrawingSources(client, {
    projectId: p6Ids.project,
    boqVersionId: p6Ids.version,
    limit: 500,
  });
  assert.equal(page.rows.length, 200);
  assert.equal(page.hasMore, true);
  assert.equal(client.limits[0], 201);

  const overLinks = Array.from({ length: 201 }, (_, index) => ({
    id: `00000000-0000-4000-8002-${String(index + 1).padStart(12, "0")}`,
    project_id: p6Ids.project,
    quantity_link_id: quantities[0].id,
    boq_version_id: p6Ids.version,
    boq_line_id: p6Ids.line,
    allocation_factor: "0.001",
    version: 1,
    created_by: p6Ids.actor,
    updated_by: p6Ids.actor,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  }));
  await assert.rejects(
    listVerifiedBoqDrawingSources(
      listClient({ quantities: [quantities[0]], links: overLinks }),
      { projectId: p6Ids.project, boqVersionId: p6Ids.version },
    ),
    (error) => error.code === "P6B04",
  );
});

test("verified BOQ Drawing links resolve exact immutable workspace ancestry in bulk", async () => {
  const document = "00000000-0000-4000-8000-000000000117";
  const file = "00000000-0000-4000-8000-000000000118";
  const quantity = {
    id: p6Ids.quantity,
    project_id: p6Ids.project,
    drawing_revision_id: p6Ids.revision,
    drawing_revision_version: 2,
    drawing_snapshot_sha256: P6_SHA_B,
    drawing_object_id: p6Ids.object,
    drawing_object_lineage_id: p6Ids.lineage,
    drawing_object_version: 3,
    object_fingerprint: P6_SHA_A,
    measurement_kind: "area",
    raw_quantity: "4.75",
    unit: "m2",
    measurement_rule_version: "P4_MEASUREMENT_V1",
    created_by: p6Ids.actor,
    created_at: "2026-08-28T00:00:00.000Z",
  };
  const link = {
    id: p6Ids.drawingLink,
    project_id: p6Ids.project,
    quantity_link_id: p6Ids.quantity,
    boq_version_id: p6Ids.version,
    boq_line_id: p6Ids.line,
    allocation_factor: "1",
    version: 2,
    created_by: p6Ids.actor,
    updated_by: p6Ids.actor,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
  const page = await listVerifiedBoqDrawingSources(
    listClient({
      quantities: [quantity],
      links: [link],
      revisions: [{ id: p6Ids.revision, document_id: document }],
      documents: [{ id: document, source_file_id: file }],
      sources: [
        {
          revision_id: p6Ids.revision,
          object_id: p6Ids.object,
          source_file_id: file,
          source_kind: "pdf_region",
        },
      ],
      files: [{ id: file, kind: "pdf" }],
    }),
    { projectId: p6Ids.project, boqVersionId: p6Ids.version },
  );
  assert.equal(page.rows[0].allocationTotal, "1");
  assert.equal(
    page.rows[0].links[0].workspaceHref,
    `/projects/${p6Ids.project}/drawings/${file}/workspace?document=${document}&revision=${p6Ids.revision}&object=${p6Ids.object}&boq=${p6Ids.version}&line=${p6Ids.line}&evidence=${file}&view=2d`,
  );
});

test("verified BOQ Drawing source fallback is bound to the exact revision and object", async () => {
  const document = "00000000-0000-4000-8000-000000000119";
  const exactFile = "00000000-0000-4000-8000-000000000120";
  const otherFile = "00000000-0000-4000-8000-000000000121";
  const otherRevision = "00000000-0000-4000-8000-000000000122";
  const quantity = quantityFixture();
  const link = drawingLinkFixture(quantity.id);
  const page = await listVerifiedBoqDrawingSources(
    listClient({
      quantities: [quantity],
      links: [link],
      revisions: [{ id: p6Ids.revision, document_id: document }],
      documents: [{ id: document, source_file_id: null }],
      sources: [
        {
          revision_id: otherRevision,
          object_id: p6Ids.object,
          source_file_id: otherFile,
          source_kind: "pdf_region",
        },
        {
          revision_id: p6Ids.revision,
          object_id: p6Ids.object,
          source_file_id: exactFile,
          source_kind: "pdf_region",
        },
      ],
      files: [
        { id: exactFile, kind: "pdf" },
        { id: otherFile, kind: "pdf" },
      ],
    }),
    { projectId: p6Ids.project, boqVersionId: p6Ids.version },
  );
  assert.match(page.rows[0].links[0].workspaceHref, new RegExp(exactFile));
});

test("PDF document entry keeps its pathname while IFC evidence opens exact split focus", async () => {
  const document = "00000000-0000-4000-8000-000000000123";
  const pdfFile = "00000000-0000-4000-8000-000000000124";
  const ifcFile = "00000000-0000-4000-8000-000000000125";
  const page = await listVerifiedBoqDrawingSources(
    listClient({
      quantities: [quantityFixture()],
      links: [drawingLinkFixture(p6Ids.quantity)],
      revisions: [{ id: p6Ids.revision, document_id: document }],
      documents: [{ id: document, source_file_id: pdfFile }],
      sources: [
        {
          revision_id: p6Ids.revision,
          object_id: p6Ids.object,
          source_file_id: pdfFile,
          source_kind: "pdf_region",
        },
        {
          revision_id: p6Ids.revision,
          object_id: p6Ids.object,
          source_file_id: ifcFile,
          source_kind: "ifc_element",
        },
      ],
      files: [
        { id: pdfFile, kind: "pdf" },
        { id: ifcFile, kind: "ifc" },
      ],
    }),
    { projectId: p6Ids.project, boqVersionId: p6Ids.version },
  );
  const link = page.rows[0].links[0];
  assert.equal(link.workspaceHref, null);
  assert.deepEqual(
    link.evidenceHrefs.map((row) => [row.sourceKind, row.href]),
    [
      [
        "pdf_region",
        `/projects/${p6Ids.project}/drawings/${pdfFile}/workspace?document=${document}&revision=${p6Ids.revision}&object=${p6Ids.object}&boq=${p6Ids.version}&line=${p6Ids.line}&evidence=${pdfFile}&view=2d`,
      ],
      [
        "ifc_element",
        `/projects/${p6Ids.project}/drawings/${pdfFile}/workspace?document=${document}&revision=${p6Ids.revision}&object=${p6Ids.object}&boq=${p6Ids.version}&line=${p6Ids.line}&evidence=${ifcFile}&view=split&ifc=${ifcFile}`,
      ],
    ],
  );
});

test("bulk evidence resolution fetches the complete bounded entry and anchor file union", async () => {
  const id = (prefix, index) =>
    `00000000-0000-4000-8000-${prefix}${String(index + 1).padStart(9, "0")}`;
  const quantities = Array.from({ length: 200 }, (_, index) =>
    quantityFixture({
      id: id("300", index),
      drawing_revision_id: id("100", index),
      drawing_object_id: id("200", index),
    }),
  );
  const client = listClient({
    quantities,
    links: quantities.map((quantity, index) => ({
      ...drawingLinkFixture(quantity.id),
      id: id("400", index),
    })),
    revisions: quantities.map((quantity, index) => ({
      id: quantity.drawing_revision_id,
      document_id: id("500", index),
    })),
    documents: quantities.map((_quantity, index) => ({
      id: id("500", index),
      source_file_id: id("600", index),
    })),
    sources: quantities.flatMap((quantity, index) => [
      {
        revision_id: quantity.drawing_revision_id,
        object_id: quantity.drawing_object_id,
        source_file_id: id("700", index),
        source_kind: "pdf_region",
      },
      {
        revision_id: quantity.drawing_revision_id,
        object_id: quantity.drawing_object_id,
        source_file_id: id("800", index),
        source_kind: "ifc_element",
      },
    ]),
    files: quantities.flatMap((_quantity, index) => [
      { id: id("600", index), kind: "pdf" },
      { id: id("700", index), kind: "pdf" },
      { id: id("800", index), kind: "ifc" },
    ]),
  });
  const page = await listVerifiedBoqDrawingSources(client, {
    projectId: p6Ids.project,
    boqVersionId: p6Ids.version,
  });
  assert.equal(page.rows.length, 200);
  assert.equal(
    page.rows.every((row) => row.links[0].evidenceHrefs.length === 2),
    true,
  );
  assert.equal(client.limits.includes(401), true);
  assert.equal(client.limits.includes(601), true);
});

test("verified BOQ Drawing source loader always includes old mapped sources before filling the 200 row page", async () => {
  const recent = Array.from({ length: 201 }, (_, index) =>
    quantityFixture({
      id: `00000000-0000-4000-8003-${String(index + 1).padStart(12, "0")}`,
    }),
  );
  const oldMapped = quantityFixture({
    id: "00000000-0000-4000-8004-000000000001",
  });
  const page = await listVerifiedBoqDrawingSources(
    listClient({
      quantities: recent,
      mappedQuantities: [oldMapped],
      links: [drawingLinkFixture(oldMapped.id)],
    }),
    { projectId: p6Ids.project, boqVersionId: p6Ids.version },
  );
  assert.equal(page.rows.length, 200);
  assert.equal(page.rows[0].quantity.id, oldMapped.id);
  assert.equal(page.rows[0].links.length, 1);
  assert.equal(page.hasMore, true);
});

test("verified BOQ Drawing source loader fails closed for cross-project RLS denial", async () => {
  await assert.rejects(
    listVerifiedBoqDrawingSources(
      listClient({
        quantities: [],
        links: [],
        errorTable: "lukas_drawing_boq_links",
      }),
      { projectId: p6Ids.project, boqVersionId: p6Ids.version },
    ),
    (error) => error.code === "P6A01",
  );
});

test("1.1 submission calculates trusted input then compare-and-freezes exact hashes", async () => {
  const finalizeCalls = [];
  const result = await submitVerifiedBoqV1_1(
    rpcClient(p6Ids.actor, async (name) => {
      assert.equal(name, "lukas_qto_boq_v1_1_input");
      return { data: boqInputRpcPayload(), error: null };
    }),
    p6Ids.actor,
    p6Ids.version,
    {
      async finalize(args) {
        finalizeCalls.push(args);
        return args;
      },
      async loadFrozenInput() {
        throw new Error("not used");
      },
    },
  );
  assert.match(result.resultSha256, /^[0-9a-f]{64}$/);
  assert.match(result.manifestSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(finalizeCalls[0], {
    actorId: p6Ids.actor,
    versionId: p6Ids.version,
    inputStateSha256: P6_SHA_A,
    resultSha256: result.resultSha256,
    manifestSha256: result.manifestSha256,
    directCostKrw: "950",
    lineCount: 1,
  });
});

test("1.1 submission fails closed on uncalculated input and finalize race", async () => {
  const uncalculated = boqInputRpcPayload();
  uncalculated.input.components = [];
  await assert.rejects(
    submitVerifiedBoqV1_1(
      rpcClient(p6Ids.actor, async () => ({ data: uncalculated, error: null })),
      p6Ids.actor,
      p6Ids.version,
      freezeAuthority(),
    ),
    (error) => error.code === "P6B04",
  );
  await assert.rejects(
    submitVerifiedBoqV1_1(
      rpcClient(p6Ids.actor, async () => ({
        data: boqInputRpcPayload(),
        error: null,
      })),
      p6Ids.actor,
      p6Ids.version,
      freezeAuthority({ finalizeCode: "P6O01" }),
    ),
    (error) => error.code === "P6O01",
  );
  await assert.rejects(
    submitVerifiedBoqV1_1(
      rpcClient(p6Ids.reviewer, async () => ({
        data: boqInputRpcPayload(),
        error: null,
      })),
      p6Ids.actor,
      p6Ids.version,
      freezeAuthority(),
    ),
    (error) => error.code === "P6A01",
  );
});

test("1.1 decision reruns frozen hashes, requires an independent reviewer, and forwards no hashes", async () => {
  const payload = boqInputRpcPayload();
  const submitted = await submitVerifiedBoqV1_1(
    rpcClient(p6Ids.actor, async () => ({ data: payload, error: null })),
    p6Ids.actor,
    p6Ids.version,
    freezeAuthority(),
  );
  const rpcCalls = [];
  const reviewer = decisionClient({
    actorId: p6Ids.reviewer,
    version: {
      created_by: p6Ids.actor,
      status: "in_review",
      input_state_sha256: P6_SHA_A,
      result_sha256: submitted.resultSha256,
      manifest_sha256: submitted.manifestSha256,
    },
    rpcCalls,
  });
  await recheckAndDecideVerifiedBoqV1_1(
    reviewer,
    p6Ids.reviewer,
    { versionId: p6Ids.version, decision: "approved", note: "확인" },
    freezeAuthority({ payload }),
  );
  assert.deepEqual(rpcCalls, [
    [
      "lukas_qto_decide_boq",
      {
        p_version_id: p6Ids.version,
        p_decision: "approved",
        p_note: "확인",
      },
    ],
  ]);

  await assert.rejects(
    recheckAndDecideVerifiedBoqV1_1(
      decisionClient({
        actorId: p6Ids.actor,
        version: {
          created_by: p6Ids.actor,
          status: "in_review",
          input_state_sha256: P6_SHA_A,
          result_sha256: submitted.resultSha256,
          manifest_sha256: submitted.manifestSha256,
        },
      }),
      p6Ids.actor,
      { versionId: p6Ids.version, decision: "approved", note: "self" },
      freezeAuthority({ payload }),
    ),
    (error) => error.code === "P6A01",
  );
  await assert.rejects(
    recheckAndDecideVerifiedBoqV1_1(
      decisionClient({
        actorId: p6Ids.reviewer,
        version: {
          created_by: p6Ids.actor,
          status: "in_review",
          input_state_sha256: P6_SHA_A,
          result_sha256: P6_SHA_B,
          manifest_sha256: submitted.manifestSha256,
        },
      }),
      p6Ids.reviewer,
      { versionId: p6Ids.version, decision: "approved", note: "stale" },
      freezeAuthority({ payload }),
    ),
    (error) => error.code === "P6C01",
  );

  let privilegedLoads = 0;
  await assert.rejects(
    recheckAndDecideVerifiedBoqV1_1(
      decisionClient({
        actorId: p6Ids.reviewer,
        role: "viewer",
        version: {
          created_by: p6Ids.actor,
          status: "in_review",
          input_state_sha256: P6_SHA_A,
          result_sha256: submitted.resultSha256,
          manifest_sha256: submitted.manifestSha256,
        },
      }),
      p6Ids.reviewer,
      { versionId: p6Ids.version, decision: "approved", note: "viewer" },
      {
        ...freezeAuthority({ payload }),
        async loadFrozenInput() {
          privilegedLoads += 1;
          return payload;
        },
      },
    ),
    (error) => error.code === "P6A01",
  );
  assert.equal(privilegedLoads, 0);
});

test("approved export reloads authoritative input and denies non-approved or stale snapshots before bytes", async () => {
  const payload = boqInputRpcPayload();
  const submitted = await submitVerifiedBoqV1_1(
    rpcClient(p6Ids.actor, async () => ({ data: payload, error: null })),
    p6Ids.actor,
    p6Ids.version,
    freezeAuthority(),
  );
  const stored = {
    input_state_sha256: P6_SHA_A,
    result_sha256: submitted.resultSha256,
    manifest_sha256: submitted.manifestSha256,
    direct_cost_krw: "950.000000",
    line_count: 1,
  };

  for (const denied of [
    { status: "draft", decision: "approved" },
    { status: "in_review", decision: "approved" },
    { status: "approved", decision: "rejected" },
  ])
    await assert.rejects(
      loadApprovedVerifiedBoqExport(
        approvedExportClient({ ...stored, ...denied }),
        p6Ids.actor,
        p6Ids.version,
        freezeAuthority({ payload }),
      ),
      (error) => error.code === "P6A01",
    );

  for (const mutation of [
    { input_state_sha256: P6_SHA_B },
    { result_sha256: P6_SHA_B },
    { manifest_sha256: P6_SHA_B },
  ])
    await assert.rejects(
      loadApprovedVerifiedBoqExport(
        approvedExportClient({
          ...stored,
          status: "approved",
          decision: "approved",
          ...mutation,
        }),
        p6Ids.actor,
        p6Ids.version,
        freezeAuthority({ payload }),
      ),
      (error) => error.code === "P6C01",
    );

  for (const status of ["approved", "superseded"])
    for (const replay of [
      await loadApprovedVerifiedBoqExport(
        approvedExportClient({
          ...stored,
          status,
          decision: "approved",
        }),
        p6Ids.actor,
        p6Ids.version,
        freezeAuthority({ payload }),
      ),
    ]) {
      assert.equal(replay.resultSha256, submitted.resultSha256);
      assert.equal(replay.manifestSha256, submitted.manifestSha256);
      assert.ok(replay.csv.byteLength > 3);
      assert.ok(replay.xlsx.byteLength > 0);
      assert.ok(replay.manifestJson.byteLength > 0);
    }
});

test("approved export pages every WBS row instead of accepting a PostgREST-capped workbook", async () => {
  const payload = boqInputRpcPayload();
  const submitted = await submitVerifiedBoqV1_1(
    rpcClient(p6Ids.actor, async () => ({ data: payload, error: null })),
    p6Ids.actor,
    p6Ids.version,
    freezeAuthority(),
  );
  const wbsNodes = Array.from({ length: 1001 }, (_, index) => ({
    id: `wbs-${index}`,
    code: `W-${String(index).padStart(4, "0")}`,
    name: `작업 ${index}`,
  }));
  const allocations = wbsNodes.map((node) => ({
    line_id: p6Ids.line,
    wbs_node_id: node.id,
    allocation_percent: "0.1",
  }));
  const observed = {};
  const exported = await loadApprovedVerifiedBoqExport(
    approvedExportClient({
      status: "approved",
      decision: "approved",
      input_state_sha256: P6_SHA_A,
      result_sha256: submitted.resultSha256,
      manifest_sha256: submitted.manifestSha256,
      direct_cost_krw: "950",
      line_count: 1,
      wbsNodes,
      allocations,
      observed,
    }),
    p6Ids.actor,
    p6Ids.version,
    freezeAuthority({ payload }),
  );
  const structureSheet = strFromU8(
    unzipSync(exported.xlsx)["xl/worksheets/sheet5.xml"],
  );
  assert.match(structureSheet, /W-1000/);
  assert.deepEqual(
    observed.ranges.filter(([table]) => table === "lukas_qto_boq_wbs_nodes"),
    [
      ["lukas_qto_boq_wbs_nodes", 0, 999],
      ["lukas_qto_boq_wbs_nodes", 1000, 1999],
      ["lukas_qto_boq_wbs_nodes", 1001, 2000],
    ],
  );
});

test("approved export continues WBS pagination below the requested page size", async () => {
  const payload = boqInputRpcPayload();
  const submitted = await submitVerifiedBoqV1_1(
    rpcClient(p6Ids.actor, async () => ({ data: payload, error: null })),
    p6Ids.actor,
    p6Ids.version,
    freezeAuthority(),
  );
  const wbsNodes = Array.from({ length: 1001 }, (_, index) => ({
    id: `wbs-${index}`,
    code: `W-${String(index).padStart(4, "0")}`,
    name: `작업 ${index}`,
  }));
  const allocations = wbsNodes.map((node, index) => ({
    id: `allocation-${index}`,
    line_id: p6Ids.line,
    wbs_node_id: node.id,
    allocation_percent: "0.1",
  }));
  const exported = await loadApprovedVerifiedBoqExport(
    approvedExportClient({
      status: "approved",
      decision: "approved",
      input_state_sha256: P6_SHA_A,
      result_sha256: submitted.resultSha256,
      manifest_sha256: submitted.manifestSha256,
      direct_cost_krw: "950",
      line_count: 1,
      wbsNodes,
      allocations,
      dataApiCap: 400,
    }),
    p6Ids.actor,
    p6Ids.version,
    freezeAuthority({ payload }),
  );
  assert.match(
    strFromU8(unzipSync(exported.xlsx)["xl/worksheets/sheet5.xml"]),
    /W-1000/,
  );
});

test("approved export batches the complete immutable evidence-file union", async () => {
  const payload = boqInputRpcPayload();
  const anchors = Array.from({ length: 200 }, (_, index) => ({
    id: `00000000-0000-4000-8100-${String(index + 1).padStart(12, "0")}`,
    sourceFileId: `00000000-0000-4000-8200-${String(index + 1).padStart(12, "0")}`,
    sourceSha256: P6_SHA_B,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: index,
    y: 0,
    width: 1,
    height: 1,
    elementId: null,
    ifcGlobalId: null,
    camera: null,
    version: 1,
  }));
  payload.input.drawingLinks[0].source.anchors = anchors;
  const submitted = await submitVerifiedBoqV1_1(
    rpcClient(p6Ids.actor, async () => ({ data: payload, error: null })),
    p6Ids.actor,
    p6Ids.version,
    freezeAuthority({ payload }),
  );
  const files = [
    {
      id: p6Ids.priceFile,
      original_filename: "단가표.csv",
      sha256: P6_SHA_B,
      immutable: true,
    },
    ...anchors.map((anchor) => ({
      id: anchor.sourceFileId,
      original_filename: `${anchor.sourceFileId}.pdf`,
      sha256: anchor.sourceSha256,
      immutable: true,
    })),
  ];
  const observed = {};
  const exported = await loadApprovedVerifiedBoqExport(
    approvedExportClient({
      status: "superseded",
      decision: "approved",
      input_state_sha256: P6_SHA_A,
      result_sha256: submitted.resultSha256,
      manifest_sha256: submitted.manifestSha256,
      direct_cost_krw: "950",
      line_count: 1,
      files,
      observed,
    }),
    p6Ids.actor,
    p6Ids.version,
    freezeAuthority({ payload }),
  );
  assert.ok(exported.manifestJson.byteLength > 0);
  assert.equal(observed.fileBatches.length, 3);
  assert.equal(
    observed.fileBatches.every((batch) => batch.length <= 100),
    true,
  );
});

test("approved export binds source anchor IDs to the frozen database input", () => {
  const frozen = boqInputRpcPayload().input;
  const anchorId = "00000000-0000-4000-8300-000000000001";
  frozen.drawingLinks[0].source.anchors = [{ id: anchorId }];
  const evidence = [
    {
      itemCode: "001-A",
      quantityLinkId: p6Ids.quantity,
      allocationFactor: "1.0",
      sourceAnchorIds: [anchorId],
    },
  ];
  assert.doesNotThrow(() => assertVerifiedBoqSourceAnchorIds(evidence, frozen));
  evidence[0].sourceAnchorIds = ["00000000-0000-4000-8300-000000000002"];
  assert.throws(
    () => assertVerifiedBoqSourceAnchorIds(evidence, frozen),
    (error) => error.code === "P6C01",
  );
});

function authorizedClient(actor, project, role) {
  return {
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: actor,
              is_anonymous: false,
              app_metadata: role === "staff" ? { role: "hangil_staff" } : {},
            },
          },
          error: null,
        };
      },
    },
    from(table) {
      const query = chain({
        data:
          table === "lukas_qto_projects"
            ? {
                id: project,
                owner_id:
                  role === "owner"
                    ? actor
                    : "00000000-0000-4000-8000-000000000099",
              }
            : { role },
        error: null,
      });
      return query;
    },
  };
}

function chain(result) {
  const query = {
    select() {
      return query;
    },
    eq() {
      return query;
    },
    in() {
      return query;
    },
    order() {
      return query;
    },
    gt() {
      return query;
    },
    or() {
      return query;
    },
    limit() {
      return Promise.resolve(result);
    },
    single() {
      return Promise.resolve(result);
    },
    maybeSingle() {
      return Promise.resolve(result);
    },
  };
  return query;
}

function lineageClient() {
  const quantities = Array.from({ length: 201 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    project_id: "00000000-0000-4000-8000-000000000021",
    drawing_revision_id: "00000000-0000-4000-8000-000000000022",
    drawing_revision_version: 1,
    drawing_snapshot_sha256: "a".repeat(64),
    drawing_object_id: "00000000-0000-4000-8000-000000000023",
    drawing_object_lineage_id: "00000000-0000-4000-8000-000000000023",
    drawing_object_version: 1,
    object_fingerprint: "b".repeat(64),
    measurement_kind: "count",
    raw_quantity: "1",
    unit: "EA",
    measurement_rule_version: "P4_MEASUREMENT_V1",
    created_by: "00000000-0000-4000-8000-000000000024",
    created_at: `2026-08-28T00:00:${String(index % 60).padStart(2, "0")}.000Z`,
  }));
  return {
    orders: [],
    from(table) {
      const rows = table === "lukas_drawing_quantity_links" ? quantities : [];
      const query = chain({ data: rows, error: null });
      query.order = (column) => {
        this.orders.push(column);
        return query;
      };
      query.limit = (size) =>
        Promise.resolve({ data: rows.slice(0, size), error: null });
      return query;
    },
  };
}

function exactEntryClient(ids) {
  const rows = {
    lukas_drawing_revisions: {
      id: ids.revision,
      document_id: ids.document,
      project_id: ids.project,
    },
    lukas_drawing_documents: {
      id: ids.document,
      project_id: ids.project,
      source_file_id: ids.file,
    },
    lukas_drawing_objects: {
      id: ids.object,
      revision_id: ids.revision,
      project_id: ids.project,
    },
    lukas_qto_boq_versions: { id: ids.boq, project_id: ids.project },
    lukas_qto_boq_lines: {
      id: ids.line,
      version_id: ids.boq,
      project_id: ids.project,
    },
    lukas_drawing_boq_links: {
      id: "00000000-0000-4000-8000-000000000038",
      quantity: { id: "00000000-0000-4000-8000-000000000039" },
    },
    lukas_drawing_object_sources: {
      id: "00000000-0000-4000-8000-00000000003a",
    },
    lukas_qto_files: ids.file
      ? { id: ids.file, project_id: ids.project, immutable: true, kind: "pdf" }
      : null,
  };
  return {
    from(table) {
      return chain({ data: rows[table], error: null });
    },
  };
}

function rpcClient(
  actorId,
  handler = async () => ({ data: null, error: null }),
) {
  return {
    auth: {
      async getUser() {
        return {
          data: {
            user: { id: actorId, is_anonymous: false, app_metadata: {} },
          },
          error: null,
        };
      },
    },
    rpc: handler,
  };
}

function freezeAuthority(options = {}) {
  return {
    async finalize(args) {
      if (options.finalizeCode)
        throw Object.assign(new Error("database detail"), {
          code: options.finalizeCode,
        });
      return args;
    },
    async loadFrozenInput() {
      return options.payload ?? boqInputRpcPayload();
    },
  };
}

function decisionClient({
  actorId,
  version,
  rpcCalls = [],
  role = "reviewer",
}) {
  return {
    auth: {
      async getUser() {
        return {
          data: {
            user: { id: actorId, is_anonymous: false, app_metadata: {} },
          },
          error: null,
        };
      },
    },
    from(table) {
      const data =
        table === "lukas_qto_boq_versions"
          ? {
              id: p6Ids.version,
              project_id: p6Ids.project,
              engine_version: "VERIFIED-BOQ-1.1",
              ...version,
            }
          : table === "lukas_qto_projects"
            ? {
                id: p6Ids.project,
                owner_id: "00000000-0000-4000-8000-000000000199",
              }
            : table === "lukas_qto_project_members"
              ? { role }
              : null;
      assert.ok(data);
      return chain({ data, error: null });
    },
    async rpc(name, args) {
      rpcCalls.push([name, args]);
      return { data: null, error: null };
    },
  };
}

function approvedExportClient({
  status,
  decision,
  wbsNodes = [],
  allocations = [],
  files: suppliedFiles,
  dataApiCap = 1000,
  observed = {},
  ...stored
}) {
  observed.ranges ??= [];
  observed.fileBatches ??= [];
  const rows = {
    lukas_qto_boq_versions: {
      id: p6Ids.version,
      project_id: p6Ids.project,
      version_no: 1,
      title: "승인 내역",
      status,
      created_by: p6Ids.actor,
      engine_version: "VERIFIED-BOQ-1.1",
      ...stored,
    },
    lukas_qto_boq_approvals: [
      {
        id: "00000000-0000-4000-8000-000000000190",
        version_id: p6Ids.version,
        decision,
        note: "검토",
        decided_by: p6Ids.reviewer,
        created_at: "2026-08-28T00:00:00.000Z",
      },
    ],
    lukas_qto_projects: { id: p6Ids.project, name: "한글 프로젝트" },
    lukas_qto_files: suppliedFiles ?? [
      {
        id: p6Ids.priceFile,
        original_filename: "단가표.csv",
        sha256: P6_SHA_B,
        immutable: true,
      },
    ],
    lukas_qto_boq_wbs_nodes: wbsNodes,
    lukas_qto_boq_wbs_allocations: allocations,
  };
  return {
    auth: {
      async getUser() {
        return {
          data: {
            user: {
              id: p6Ids.actor,
              is_anonymous: false,
              app_metadata: {},
            },
          },
          error: null,
        };
      },
    },
    from(table) {
      assert.ok(table in rows, table);
      const result = { data: rows[table], error: null };
      const query = chain(result);
      if (table === "lukas_qto_boq_approvals")
        query.order = () => Promise.resolve(result);
      if (table === "lukas_qto_files")
        query.in = (_column, values) => {
          observed.fileBatches.push(values);
          return Promise.resolve(
            values.length > 100
              ? { data: null, error: new Error("request too large") }
              : {
                  data: rows[table].filter((row) => values.includes(row.id)),
                  error: null,
                },
          );
        };
      if (
        table === "lukas_qto_boq_wbs_nodes" ||
        table === "lukas_qto_boq_wbs_allocations"
      ) {
        query.eq = () => query;
        query.order = () => query;
        query.range = (from, to) => {
          observed.ranges.push([table, from, to]);
          return Promise.resolve({
            data: rows[table].slice(from, Math.min(to + 1, from + dataApiCap)),
            error: null,
          });
        };
        query.then = (resolve, reject) =>
          Promise.resolve({
            data: rows[table].slice(0, 1000),
            error: null,
          }).then(resolve, reject);
      }
      return query;
    },
  };
}

function listClient({
  quantities,
  mappedQuantities = quantities,
  links,
  revisions = [],
  documents = [],
  sources = [],
  files = [],
  errorTable = null,
}) {
  return {
    limits: [],
    from(table) {
      const rows =
        table === "lukas_drawing_quantity_links"
          ? quantities
          : table === "lukas_drawing_boq_links"
            ? links
            : table === "lukas_drawing_revisions"
              ? revisions
              : table === "lukas_drawing_documents"
                ? documents
                : table === "lukas_drawing_object_sources"
                  ? sources
                  : table === "lukas_qto_files"
                    ? files
                    : [];
      let selectedRows = rows;
      const result = () => ({
        data: selectedRows,
        error: table === errorTable ? { code: "42501" } : null,
      });
      const query = chain(result());
      query.in = (column) => {
        if (table === "lukas_drawing_quantity_links" && column === "id")
          selectedRows = mappedQuantities;
        return query;
      };
      query.limit = (size) => {
        this.limits.push(size);
        const current = result();
        return Promise.resolve({
          data: current.data.slice(0, size),
          error: current.error,
        });
      };
      return query;
    },
  };
}

function quantityFixture(overrides = {}) {
  return {
    id: p6Ids.quantity,
    project_id: p6Ids.project,
    drawing_revision_id: p6Ids.revision,
    drawing_revision_version: 2,
    drawing_snapshot_sha256: P6_SHA_B,
    drawing_object_id: p6Ids.object,
    drawing_object_lineage_id: p6Ids.lineage,
    drawing_object_version: 3,
    object_fingerprint: P6_SHA_A,
    measurement_kind: "area",
    raw_quantity: "4.75",
    unit: "m2",
    measurement_rule_version: "P4_MEASUREMENT_V1",
    created_by: p6Ids.actor,
    created_at: "2026-08-28T00:00:00.000Z",
    ...overrides,
  };
}

function drawingLinkFixture(quantityLinkId) {
  return {
    id: p6Ids.drawingLink,
    project_id: p6Ids.project,
    quantity_link_id: quantityLinkId,
    boq_version_id: p6Ids.version,
    boq_line_id: p6Ids.line,
    allocation_factor: "1",
    version: 1,
    created_by: p6Ids.actor,
    updated_by: p6Ids.actor,
    created_at: "2026-08-28T00:00:00.000Z",
    updated_at: "2026-08-28T00:00:00.000Z",
  };
}
