import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { createServer } from "vite";

function routeData(result) {
  assert.ok(result && typeof result === "object", "loader must return data");
  assert.ok("data" in result, "loader must return a React Router data payload");
  assert.notEqual(result.data, undefined, "loader data must be defined");
  if (result.init?.headers !== undefined)
    assert.ok(
      result.init.headers instanceof Headers,
      "loader data headers must be a Headers instance",
    );
  return result.data;
}

const vite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const materialActionClientFactoryKey =
  "__drawingWorkspaceM5MaterialActionClientFactory";
globalThis[materialActionClientFactoryKey] = () => {
  throw new Error("Material action test client is not configured.");
};
const actionVite = await createServer({
  appType: "custom",
  configFile: false,
  logLevel: "silent",
  plugins: [
    {
      enforce: "pre",
      load(id) {
        if (id === "\0virtual:m5-material-action-client")
          return `export default (...args) => globalThis[${JSON.stringify(materialActionClientFactoryKey)}](...args);`;
      },
      name: "m5-material-action-client",
      resolveId(source) {
        if (source.endsWith("/app/core/lib/supa-client.server"))
          return "\0virtual:m5-material-action-client";
      },
    },
  ],
  resolve: {
    alias: { "~": fileURLToPath(new URL("../app", import.meta.url)) },
  },
  server: { middlewareMode: true },
});
const materialLineageModule = await vite.ssrLoadModule(
  "/app/lukas/components/material-boq-lineage.tsx",
);
const estimateRailModule = await vite.ssrLoadModule(
  "/app/lukas/components/drawing-estimate-result-rail.tsx",
);
const materialScreenModule = await vite.ssrLoadModule(
  "/app/lukas/screens/material-control.tsx",
);
const materialActionModule = await actionVite.ssrLoadModule(
  "/app/lukas/screens/material-control.tsx",
);
const verifiedBoqModule = await vite.ssrLoadModule(
  "/app/lukas/screens/verified-boq.tsx",
);
test.after(async () => {
  delete globalThis[materialActionClientFactoryKey];
  await Promise.all([vite.close(), actionVite.close()]);
});

const ids = {
  project: "51000000-0000-4000-8000-000000000001",
  workspace: "51000000-0000-4000-8000-000000000002",
  revision: "51000000-0000-4000-8000-000000000003",
  version: "51000000-0000-4000-8000-000000000004",
  line: "51000000-0000-4000-8000-000000000005",
  component: "51000000-0000-4000-8000-000000000006",
  materialPlan: "51000000-0000-4000-8000-000000000007",
  resource: "51000000-0000-4000-8000-000000000008",
  transaction: "51000000-0000-4000-8000-000000000009",
  factor: "51000000-0000-4000-8000-000000000010",
  file: "51000000-0000-4000-8000-000000000011",
  operation: "51000000-0000-4000-8000-000000000012",
};

function render(element) {
  return renderToStaticMarkup(
    createElement(RouterProvider, {
      router: createMemoryRouter([{ path: "/", element }], {
        initialEntries: ["/"],
      }),
    }),
  );
}

function lineageRow() {
  return {
    boqVersionId: ids.version,
    boqResultSha256: "a".repeat(64),
    boqLineId: ids.line,
    itemCode: "MAT-001",
    rateComponentId: ids.component,
    materialResourceId: ids.resource,
    materialPlanId: ids.materialPlan,
    derivedDesignQuantity: "10",
    materialPlan: {
      id: ids.materialPlan,
      materialCode: "STEEL-001",
      materialName: "구조용 강재",
      specification: "SS275",
      unit: "kg",
      designQuantity: "10",
      allowanceRate: "0",
      requiredQuantity: "10",
      ruleId: "P6_MATERIAL_HANDOFF_V1",
      baselineFactorId: ids.factor,
      sourceSha256: "b".repeat(64),
    },
    transactions: [
      {
        id: ids.transaction,
        materialPlanId: ids.materialPlan,
        transactionType: "purchase_order",
        documentNumber: "PO-001",
        supplierName: "1HK 공급사",
        quantity: "10",
        unitPriceKrw: "1000",
        amountKrw: "10000",
        relatedOrderId: null,
        carbonFactorId: ids.factor,
        evidenceSha256: null,
      },
    ],
    carbonFactors: [
      {
        id: ids.factor,
        materialCode: "STEEL-001",
        productName: "강재 일반 계수",
        declaredUnit: "kg",
        gwpA1A3PerUnit: "2.1",
        sourceType: "generic",
        standard: "ISO 14040",
        validUntil: null,
        sourceSha256: "c".repeat(64),
      },
    ],
    carbonCoverage: "complete",
    manifestFileId: ids.file,
    manifestFileSha256: "d".repeat(64),
  };
}

test("material lineage returns to the exact approved BOQ line and localizes evidence enums", () => {
  const html = render(
    createElement(materialLineageModule.MaterialBoqLineage, {
      projectId: ids.project,
      operationId: ids.operation,
      canHandoff: true,
      selectedBoqVersionId: ids.version,
      approvedBoqs: [
        {
          id: ids.version,
          label: "V2 구조공사 · 승인 완료",
          components: [
            {
              id: ids.component,
              itemCode: "MAT-001",
              resourceCode: "STEEL-001",
              resourceName: "구조용 강재",
              specification: "SS275",
              unit: "kg",
              coefficient: "1",
            },
          ],
        },
      ],
      rows: [lineageRow()],
      nextCursor: "next-cursor",
      transactionId: ids.transaction,
      carbonFactorId: ids.factor,
    }),
  );
  assert.match(
    html,
    new RegExp(
      `href="/projects/${ids.project}/boq\\?version=${ids.version}&amp;line=${ids.line}"`,
    ),
  );
  assert.match(
    html,
    new RegExp(
      `href="/\\?lineageCursor=next-cursor&amp;transactionId=${ids.transaction}&amp;carbonFactorId=${ids.factor}&amp;version=${ids.version}"[^>]*>계보 다음 200건`,
    ),
  );
  assert.match(html, /선택한 승인 BOQ/);
  assert.match(html, />발주</);
  assert.match(html, /일반 계수/);
  assert.match(
    html,
    new RegExp(
      `href="/\\?transactionId=${ids.transaction}&amp;version=${ids.version}"[^>]*>이 거래 계보만 보기`,
    ),
  );
  assert.match(
    html,
    new RegExp(
      `href="/\\?carbonFactorId=${ids.factor}&amp;version=${ids.version}"[^>]*>이 탄소계수 계보만 보기`,
    ),
  );
  assert.doesNotMatch(html, />purchase_order</);
  assert.doesNotMatch(html, />generic</);
});

test("read-only material lineage keeps evidence visible without handoff controls", () => {
  const html = render(
    createElement(materialLineageModule.MaterialBoqLineage, {
      projectId: ids.project,
      operationId: ids.operation,
      canHandoff: false,
      approvedBoqs: [
        {
          id: ids.version,
          label: "V2 구조공사 · 승인 완료",
          components: [
            {
              id: ids.component,
              itemCode: "MAT-001",
              resourceCode: "STEEL-001",
              resourceName: "구조용 강재",
              specification: "SS275",
              unit: "kg",
              coefficient: "1",
            },
          ],
        },
      ],
      rows: [lineageRow()],
      nextCursor: null,
    }),
  );
  assert.match(html, /MAT-001.*STEEL-001/s);
  assert.match(html, /승인 BOQ 근거 열기/);
  assert.doesNotMatch(html, /<form|<button|type="checkbox"/);
  assert.doesNotMatch(html, /선택 자재계획 생성/);
});

test("BOQ-row lineage link carries its row version without a page version scope", () => {
  const html = render(
    createElement(materialLineageModule.MaterialBoqLineage, {
      projectId: ids.project,
      operationId: ids.operation,
      canHandoff: false,
      approvedBoqs: [],
      rows: [lineageRow()],
      nextCursor: null,
      selectedBoqVersionId: null,
    }),
  );

  assert.match(
    html,
    new RegExp(
      `href="/\\?boqLineId=${ids.line}&amp;version=${ids.version}"[^>]*>이 BOQ 행 계보만 보기`,
    ),
  );
});

test("material capabilities match every exact project role", () => {
  const capabilities = materialScreenModule.materialCapabilitiesForRole;
  assert.equal(typeof capabilities, "function");
  const allTransactions = [
    "purchase_order",
    "goods_receipt",
    "invoice_evidence",
    "installation",
    "return_to_supplier",
    "waste_disposal",
  ];
  assert.deepEqual(capabilities("owner"), {
    canHandoff: true,
    canManagePlans: true,
    canManageFactors: true,
    transactionTypes: allTransactions,
  });
  assert.deepEqual(capabilities("staff"), capabilities("owner"));
  assert.deepEqual(capabilities("estimator"), {
    canHandoff: true,
    canManagePlans: true,
    canManageFactors: true,
    transactionTypes: [],
  });
  assert.deepEqual(capabilities("procurement"), {
    canHandoff: false,
    canManagePlans: false,
    canManageFactors: true,
    transactionTypes: ["purchase_order", "invoice_evidence"],
  });
  assert.deepEqual(capabilities("site"), {
    canHandoff: false,
    canManagePlans: false,
    canManageFactors: false,
    transactionTypes: [
      "goods_receipt",
      "installation",
      "return_to_supplier",
      "waste_disposal",
    ],
  });
  for (const role of ["reviewer", "approver", "viewer"])
    assert.deepEqual(capabilities(role), {
      canHandoff: false,
      canManagePlans: false,
      canManageFactors: false,
      transactionTypes: [],
    });
  assert.throws(() => capabilities("admin"), /프로젝트 접근 권한/);
});

function materialRoleClient(membershipRole, membershipError = null) {
  const filters = [];
  return {
    filters,
    from(table) {
      assert.equal(table, "lukas_qto_project_members");
      const query = {
        select(columns) {
          assert.equal(columns, "role");
          return query;
        },
        eq(column, value) {
          filters.push([column, value]);
          return query;
        },
        maybeSingle() {
          return Promise.resolve({
            data: membershipRole === null ? null : { role: membershipRole },
            error: membershipError,
          });
        },
      };
      return query;
    },
  };
}

test("material role lookup binds the exact actor and rejects unknown membership", async () => {
  const loadRole = materialScreenModule.loadMaterialProjectRole;
  assert.equal(typeof loadRole, "function");
  const user = { id: ids.resource, app_metadata: {} };
  const project = { id: ids.project, owner_id: ids.file };
  for (const role of [
    "estimator",
    "reviewer",
    "approver",
    "procurement",
    "site",
    "viewer",
  ]) {
    const client = materialRoleClient(role);
    assert.equal(await loadRole(client, user, project), role);
    assert.deepEqual(client.filters, [
      ["project_id", ids.project],
      ["user_id", ids.resource],
    ]);
  }
  assert.equal(
    await loadRole(
      materialRoleClient(null),
      { id: ids.file, app_metadata: {} },
      project,
    ),
    "owner",
  );
  assert.equal(
    await loadRole(
      materialRoleClient(null),
      { id: ids.resource, app_metadata: { role: "hangil_staff" } },
      project,
    ),
    "staff",
  );
  for (const client of [
    materialRoleClient(null),
    materialRoleClient("admin"),
    materialRoleClient("viewer", { message: "denied" }),
  ])
    await assert.rejects(
      loadRole(client, user, project),
      (error) => error instanceof Response && error.status === 403,
    );
});

test("material version search accepts an absent or one exact UUID", () => {
  const parse = materialScreenModule.parseMaterialBoqVersionSearch;
  assert.equal(typeof parse, "function");
  assert.equal(parse(new URLSearchParams()), null);
  assert.equal(
    parse(new URLSearchParams({ version: ids.version })),
    ids.version,
  );
});

test("material version search rejects malformed and duplicate identities", () => {
  const parse = materialScreenModule.parseMaterialBoqVersionSearch;
  assert.equal(typeof parse, "function");
  for (const search of [
    new URLSearchParams({ version: "not-a-uuid" }),
    new URLSearchParams([
      ["version", ids.version],
      ["version", ids.version],
    ]),
  ])
    assert.throws(
      () => parse(search),
      (error) => error instanceof Response && error.status === 400,
    );
});

function estimateSummary(status) {
  return {
    status: status === "approved" ? "confirmed" : "draft",
    binding: {
      id: "51000000-0000-4000-8000-000000000013",
      projectId: ids.project,
      drawingRevisionId: ids.revision,
      boqVersionId: ids.version,
      createdAt: "2026-09-02T00:00:00.000Z",
    },
    boq: {
      id: ids.version,
      title: "구조공사",
      versionNo: 2,
      priceBookName: "회사 단가표",
      status,
      engineVersion: "VERIFIED-BOQ-1.1",
    },
    rows: [],
    directCostKrw: "10000",
    missingRateCount: 0,
    reviewCount: 0,
  };
}

function renderEstimateRail(
  status,
  capability = "editor",
  summaryOverrides = {},
) {
  return render(
    createElement(estimateRailModule.DrawingEstimateResultRail, {
      capability,
      drawingRevisionId: ids.revision,
      estimateOptions: [],
      projectId: ids.project,
      summary: { ...estimateSummary(status), ...summaryOverrides },
      workspaceId: ids.workspace,
    }),
  );
}

test("approved drawing estimate exposes one exact material handoff destination", () => {
  const html = renderEstimateRail("approved");
  assert.match(html, />자재 인계</);
  assert.match(
    html,
    new RegExp(
      `href="/projects/${ids.project}/materials\\?version=${ids.version}"`,
    ),
  );
});

test("drawing estimate hides material handoff while an exact V1.1 binding needs review", () => {
  assert.doesNotMatch(
    renderEstimateRail("approved", "editor", { status: "needs_review" }),
    />자재 인계/,
  );
});

test("drawing estimate hides material handoff without approval or edit authority", () => {
  assert.doesNotMatch(renderEstimateRail("draft"), />자재 인계</);
  assert.doesNotMatch(renderEstimateRail("approved", "viewer"), />자재 인계/);
  assert.doesNotMatch(
    renderEstimateRail("approved", "editor", {
      binding: {
        ...estimateSummary("approved").binding,
        boqVersionId: "51000000-0000-4000-8000-000000000099",
      },
    }),
    />자재 인계/,
  );
});

function verifiedLoaderData(overrides = {}) {
  const version = {
    id: ids.version,
    version_no: 2,
    title: "구조공사",
    status: "approved",
    calculation_policy: "general_half_away",
    quantity_scale: 6,
    price_book_id: "51000000-0000-4000-8000-000000000014",
    supersedes_id: null,
    created_by: "51000000-0000-4000-8000-000000000015",
    result_sha256: "e".repeat(64),
    direct_cost_krw: "10000",
    engine_version: "VERIFIED-BOQ-1.1",
    input_state_sha256: "f".repeat(64),
    manifest_sha256: "0".repeat(64),
    line_count: 0,
  };
  return {
    project: {
      id: ids.project,
      name: "1HK 현장",
      owner_id: "51000000-0000-4000-8000-000000000015",
    },
    userId: "51000000-0000-4000-8000-000000000016",
    role: "estimator",
    mayEdit: true,
    mayReview: false,
    files: [],
    priceBooks: [],
    versions: [version],
    version,
    resources: [],
    versionRows: {
      sections: [],
      lines: [],
      wbsNodes: [],
      wbsAllocations: [],
      mappings: [],
      exclusions: [],
      components: [],
      approvals: [],
    },
    result: {
      engineVersion: "VERIFIED-BOQ-1.1",
      versionId: ids.version,
      calculationPolicy: "general_half_away",
      status: "calculated",
      lines: [],
      directCostKrw: "10000",
      exclusions: [],
      canonicalSha256: "e".repeat(64),
      inputStateSha256: "f".repeat(64),
      manifestSha256: "0".repeat(64),
    },
    calculationError: null,
    snapshotValid: true,
    comparison: null,
    identityLinks: [],
    drawingSources: [],
    drawingSourcesHaveMore: false,
    returnTo: null,
    focusedLineId: null,
    ...overrides,
  };
}

function renderVerifiedBoq(overrides = {}) {
  return render(
    createElement(verifiedBoqModule.default, {
      loaderData: verifiedLoaderData(overrides),
      actionData: undefined,
    }),
  );
}

test("editable approved BOQ exposes its exact material handoff destination", () => {
  const html = renderVerifiedBoq();
  assert.match(html, />자재 인계</);
  assert.match(
    html,
    new RegExp(
      `href="/projects/${ids.project}/materials\\?version=${ids.version}"`,
    ),
  );
});

test("verified BOQ hides material handoff without a valid approval context", () => {
  assert.doesNotMatch(renderVerifiedBoq({ mayEdit: false }), />자재 인계</);
  assert.doesNotMatch(
    renderVerifiedBoq({ snapshotValid: false }),
    />자재 인계/,
  );
  assert.doesNotMatch(
    renderVerifiedBoq({
      result: {
        ...verifiedLoaderData().result,
        versionId: "51000000-0000-4000-8000-000000000099",
      },
    }),
    />자재 인계/,
  );
  const draft = verifiedLoaderData();
  draft.version = { ...draft.version, status: "draft" };
  assert.doesNotMatch(
    render(
      createElement(verifiedBoqModule.default, {
        loaderData: draft,
        actionData: undefined,
      }),
    ),
    />자재 인계/,
  );
});

test("material workspace presents production-facing copy", () => {
  const html = render(
    createElement(materialScreenModule.default, {
      loaderData: {
        project: { id: ids.project, name: "1HK 현장" },
        plans: [],
        transactions: [],
        factors: [],
        files: [],
        approvedTakeoffs: [],
        approvedBoqs: [],
        materialLineage: { rows: [], nextCursor: null },
        materialPlanId: undefined,
        boqLineId: undefined,
        selectedBoqVersionId: null,
        materialHandoffOperationId: ids.operation,
        summaries: [],
        role: "owner",
        capabilities: {
          canHandoff: true,
          canManagePlans: true,
          canManageFactors: true,
          transactionTypes: [
            "purchase_order",
            "goods_receipt",
            "invoice_evidence",
            "installation",
            "return_to_supplier",
            "waste_disposal",
          ],
        },
      },
      actionData: undefined,
    }),
  );
  assert.match(html, /자재·탄소 운영/);
  assert.doesNotMatch(html, /시험 운영/);
});

function materialLoaderData(role, overrides = {}) {
  return {
    project: { id: ids.project, name: "1HK 현장", owner_id: ids.file },
    plans: [],
    transactions: [],
    factors: [],
    files: [],
    approvedTakeoffs: [
      {
        id: ids.file,
        createdAt: "2026-09-02T00:00:00.000Z",
        rowCount: 1,
        reportSha256: "e".repeat(64),
        alreadyImported: false,
      },
    ],
    approvedBoqs: [
      {
        id: ids.version,
        label: "V2 구조공사 · 승인 완료",
        components: [
          {
            id: ids.component,
            itemCode: "MAT-001",
            resourceCode: "STEEL-001",
            resourceName: "구조용 강재",
            specification: "SS275",
            unit: "kg",
            coefficient: "1",
          },
        ],
      },
    ],
    materialLineage: { rows: [lineageRow()], nextCursor: null },
    materialPlanId: undefined,
    boqLineId: undefined,
    selectedBoqVersionId: ids.version,
    materialHandoffOperationId: ids.operation,
    summaries: [],
    role,
    capabilities: materialScreenModule.materialCapabilitiesForRole(role),
    ...overrides,
  };
}

function renderMaterialRole(role, overrides = {}) {
  return render(
    createElement(materialScreenModule.default, {
      loaderData: materialLoaderData(role, overrides),
      actionData: undefined,
    }),
  );
}

test("material workspace keeps reviewer, approver, and viewer surfaces read-only", () => {
  for (const role of ["reviewer", "approver", "viewer"]) {
    const html = renderMaterialRole(role);
    assert.match(html, /MAT-001.*STEEL-001/s, role);
    assert.match(html, /자재 흐름 한눈에 보기/, role);
    assert.doesNotMatch(html, /<form|<button|type="checkbox"/, role);
    assert.doesNotMatch(
      html,
      /선택 자재계획 생성|규격별 자재계획 생성|자재계획 기록|거래 기록|탄소 정보 기록/,
      role,
    );
  }
});

test("material workspace exposes only role-authorized write forms and transaction types", () => {
  const owner = renderMaterialRole("owner");
  for (const intent of [
    "boq_handoff",
    "import_takeoff",
    "plan",
    "factor",
    "transaction",
  ])
    assert.match(owner, new RegExp(`value="${intent}"`), intent);
  for (const transactionType of [
    "purchase_order",
    "goods_receipt",
    "invoice_evidence",
    "installation",
    "return_to_supplier",
    "waste_disposal",
  ])
    assert.match(owner, new RegExp(`value="${transactionType}"`));

  const estimator = renderMaterialRole("estimator");
  assert.match(estimator, /value="boq_handoff"/);
  assert.match(estimator, /value="import_takeoff"/);
  assert.match(estimator, /value="plan"/);
  assert.match(estimator, /value="factor"/);
  assert.doesNotMatch(estimator, /value="transaction"/);

  const procurement = renderMaterialRole("procurement");
  assert.match(procurement, /value="factor"/);
  assert.match(procurement, /value="transaction"/);
  assert.match(procurement, /value="purchase_order"/);
  assert.match(procurement, /value="invoice_evidence"/);
  assert.doesNotMatch(
    procurement,
    /value="(?:boq_handoff|import_takeoff|plan|goods_receipt|installation|return_to_supplier|waste_disposal)"/,
  );

  const site = renderMaterialRole("site");
  assert.match(site, /value="transaction"/);
  for (const transactionType of [
    "goods_receipt",
    "installation",
    "return_to_supplier",
    "waste_disposal",
  ])
    assert.match(site, new RegExp(`value="${transactionType}"`));
  assert.doesNotMatch(
    site,
    /value="(?:boq_handoff|import_takeoff|plan|factor|purchase_order|invoice_evidence)"/,
  );
});

function materialActionClient(role) {
  const actorId = ids.resource;
  const project = {
    id: ids.project,
    owner_id: ids.file,
    organization_id: ids.workspace,
  };
  const observations = { membershipFilters: [], order: [], writeTables: [] };
  const client = {
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
      if (table === "lukas_qto_projects") {
        const query = {
          select() {
            return query;
          },
          eq() {
            return query;
          },
          single() {
            observations.order.push("project");
            return Promise.resolve({ data: project, error: null });
          },
          maybeSingle() {
            observations.order.push("feature-project");
            return Promise.resolve({
              data: { organization_id: project.organization_id },
              error: null,
            });
          },
        };
        return query;
      }
      if (table === "lukas_qto_project_members") {
        const query = {
          select() {
            return query;
          },
          eq(column, value) {
            observations.membershipFilters.push([column, value]);
            return query;
          },
          maybeSingle() {
            observations.order.push("role");
            return Promise.resolve({ data: { role }, error: null });
          },
        };
        return query;
      }
      observations.writeTables.push(table);
      throw new Error(`Unexpected material write through ${table}`);
    },
    async rpc() {
      observations.order.push("feature");
      return { data: true, error: null };
    },
  };
  return { actorId, client, observations };
}

const loaderSha = (value) => value.repeat(64);

function loaderUuid(value) {
  return `52000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

function materialLoaderRows(planCount = 2) {
  const plans = Array.from({ length: planCount }, (_, index) => ({
    id: loaderUuid(100 + index),
    project_id: ids.project,
    material_code: index === 0 ? "MAT-PAGED" : `MAT-${index + 1}`,
    material_name: index === 0 ? "페이지 합계 자재" : `자재 ${index + 1}`,
    specification: "",
    unit: "EA",
    design_quantity: index === 0 ? "3" : "1",
    allowance_rate: "0",
    required_quantity: index === 0 ? "3" : "1",
    rule_id: "P6_MATERIAL_HANDOFF_V1",
    required_by: null,
    source_file_id: loaderUuid(20),
    source_sha256: loaderSha("1"),
    baseline_factor_id: null,
    source_artifact_id: null,
    source_group_key: null,
    created_by: ids.resource,
    created_at: "2026-09-02T00:00:00Z",
  }));
  return {
    lukas_drawing_material_links: [],
    lukas_qto_boq_rate_components: [],
    lukas_qto_boq_versions: [],
    lukas_qto_carbon_factors: [
      {
        id: loaderUuid(301),
        project_id: ids.project,
        material_code: "UNUSED-1",
        product_name: "계수 1",
        manufacturer: "",
        declared_unit: "EA",
        gwp_a1_a3_per_unit: "1",
        source_type: "generic",
        standard: "ISO 14040",
        geography: "KR",
        valid_from: null,
        valid_until: null,
        source_file_id: loaderUuid(20),
        source_sha256: loaderSha("2"),
        created_by: ids.resource,
        created_at: "2026-09-02T00:00:00Z",
      },
      {
        id: loaderUuid(302),
        project_id: ids.project,
        material_code: "UNUSED-2",
        product_name: "계수 2",
        manufacturer: "",
        declared_unit: "EA",
        gwp_a1_a3_per_unit: "2",
        source_type: "generic",
        standard: "ISO 14040",
        geography: "KR",
        valid_from: null,
        valid_until: null,
        source_file_id: loaderUuid(21),
        source_sha256: loaderSha("3"),
        created_by: ids.resource,
        created_at: "2026-09-02T00:00:00Z",
      },
    ],
    lukas_qto_files: [
      {
        id: loaderUuid(20),
        project_id: ids.project,
        kind: "other",
        original_filename: "source-1.json",
        sha256: loaderSha("1"),
        created_at: "2026-09-02T00:00:00Z",
      },
      {
        id: loaderUuid(21),
        project_id: ids.project,
        kind: "other",
        original_filename: "source-2.json",
        sha256: loaderSha("2"),
        created_at: "2026-09-02T00:00:00Z",
      },
    ],
    lukas_qto_material_plans: plans,
    lukas_qto_material_transactions: [
      {
        id: loaderUuid(401),
        project_id: ids.project,
        material_plan_id: plans[0].id,
        transaction_type: "purchase_order",
        document_number: "PO-PAGE-1",
        supplier_name: "페이지 공급사",
        occurred_on: "2026-09-02",
        quantity: "1",
        unit_price_krw: null,
        amount_krw: null,
        related_order_id: null,
        carbon_factor_id: null,
        evidence_file_id: null,
        evidence_sha256: null,
        received_by_name: "",
        event_location: "",
        site_acknowledgement: false,
        note: "",
        created_by: ids.resource,
        created_at: "2026-09-02T00:00:00Z",
      },
      {
        id: loaderUuid(402),
        project_id: ids.project,
        material_plan_id: plans[0].id,
        transaction_type: "purchase_order",
        document_number: "PO-PAGE-2",
        supplier_name: "페이지 공급사",
        occurred_on: "2026-09-02",
        quantity: "2",
        unit_price_krw: null,
        amount_krw: null,
        related_order_id: null,
        carbon_factor_id: null,
        evidence_file_id: null,
        evidence_sha256: null,
        received_by_name: "",
        event_location: "",
        site_acknowledgement: false,
        note: "",
        created_by: ids.resource,
        created_at: "2026-09-02T00:00:00Z",
      },
    ],
    lukas_qto_projects: [
      {
        id: ids.project,
        name: "M5 loader project",
        owner_id: ids.resource,
        organization_id: ids.workspace,
      },
    ],
    lukas_qto_project_members: [],
    lukas_qto_takeoff_approvals: [
      {
        id: loaderUuid(601),
        artifact_id: loaderUuid(501),
        artifact: { project_id: ids.project },
        decision: "approved",
        decision_sequence: 1,
        created_at: "2026-09-02T00:00:00Z",
      },
      {
        id: loaderUuid(602),
        artifact_id: loaderUuid(502),
        artifact: { project_id: ids.project },
        decision: "approved",
        decision_sequence: 1,
        created_at: "2026-09-02T00:00:00Z",
      },
    ],
    lukas_qto_takeoff_artifacts: [
      {
        id: loaderUuid(501),
        project_id: ids.project,
        artifact_kind: "concrete_takeoff",
        report_file_id: loaderUuid(20),
        manifest_file_id: loaderUuid(21),
        report_sha256: loaderSha("4"),
        manifest_sha256: loaderSha("5"),
        row_count: 1,
        input_sha256: loaderSha("6"),
        status_counts: {},
        created_at: "2026-09-02T00:00:00Z",
      },
      {
        id: loaderUuid(502),
        project_id: ids.project,
        artifact_kind: "concrete_takeoff",
        report_file_id: loaderUuid(20),
        manifest_file_id: loaderUuid(21),
        report_sha256: loaderSha("7"),
        manifest_sha256: loaderSha("8"),
        row_count: 1,
        input_sha256: loaderSha("9"),
        status_counts: {},
        created_at: "2026-09-02T00:00:00Z",
      },
    ],
  };
}

function materialLoaderClient({
  apiCap = 1,
  errorPages = {},
  mutateAfterPages = {},
  rows = materialLoaderRows(),
} = {}) {
  const observations = { inCalls: [], orderings: {}, ranges: {} };
  const client = {
    auth: {
      async getUser() {
        return {
          data: {
            user: { id: ids.resource, is_anonymous: false, app_metadata: {} },
          },
          error: null,
        };
      },
    },
    from(table) {
      const filters = [];
      const ordering = [];
      let requestedLimit = Number.POSITIVE_INFINITY;
      let requestedRange = null;
      const execute = () => {
        const offset = requestedRange?.[0] ?? 0;
        observations.orderings[table] ??= [];
        observations.orderings[table].push([...ordering]);
        observations.ranges[table] ??= [];
        const pageIndex = observations.ranges[table].length;
        observations.ranges[table].push(requestedRange);
        if (errorPages[table]?.has(pageIndex))
          return {
            data: null,
            error: { message: `injected ${table} page failure` },
          };
        let selected = [...(rows[table] ?? [])];
        const valueAt = (row, path) =>
          path.split(".").reduce((value, key) => value?.[key], row);
        for (const filter of filters) {
          if (filter.kind === "eq")
            selected = selected.filter(
              (row) => valueAt(row, filter.column) === filter.value,
            );
          else if (filter.kind === "in")
            selected = selected.filter((row) =>
              filter.values.includes(valueAt(row, filter.column)),
            );
          else if (filter.kind === "cursor")
            selected = selected.filter(
              (row) =>
                row.created_at < filter.createdAt ||
                (row.created_at === filter.createdAt && row.id < filter.id),
            );
          else
            selected = selected.filter(
              (row) => valueAt(row, filter.column) > filter.value,
            );
        }
        selected.sort((left, right) => {
          for (const item of ordering) {
            const leftValue = valueAt(left, item.column);
            const rightValue = valueAt(right, item.column);
            if (leftValue === rightValue) continue;
            const direction = leftValue < rightValue ? -1 : 1;
            return item.ascending ? direction : -direction;
          }
          return 0;
        });
        const requestedLength = requestedRange
          ? requestedRange[1] - requestedRange[0] + 1
          : requestedLimit;
        const length = Math.min(apiCap, requestedLength);
        const data = selected.slice(offset, offset + length);
        mutateAfterPages[table]?.get(pageIndex)?.(rows[table]);
        return {
          data,
          error: null,
        };
      };
      const query = {
        eq(column, value) {
          filters.push({ kind: "eq", column, value });
          return query;
        },
        in(column, values) {
          observations.inCalls.push({ table, column, values: [...values] });
          filters.push({ kind: "in", column, values });
          return query;
        },
        gt(column, value) {
          filters.push({ kind: "gt", column, value });
          return query;
        },
        limit(value) {
          requestedLimit = value;
          return query;
        },
        maybeSingle() {
          const result = execute();
          return Promise.resolve({
            ...result,
            data: result.data?.[0] ?? null,
          });
        },
        or(expression) {
          const match = expression.match(
            /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.([^)]+)\)$/,
          );
          if (match) {
            assert.equal(match[1], match[2]);
            filters.push({
              kind: "cursor",
              createdAt: match[1],
              id: match[3],
            });
          }
          return query;
        },
        order(column, options) {
          ordering.push({
            column,
            ascending: options?.ascending !== false,
          });
          return query;
        },
        range(from, to) {
          requestedRange = [from, to];
          return query;
        },
        select() {
          return query;
        },
        single() {
          const result = execute();
          return Promise.resolve({
            ...result,
            data: result.data?.[0] ?? null,
          });
        },
        then(resolve, reject) {
          return Promise.resolve(execute()).then(resolve, reject);
        },
      };
      return query;
    },
    async rpc() {
      return { data: true, error: null };
    },
  };
  return { client, observations };
}

async function loadMaterialWorkspace(input) {
  const { search = "", ...clientInput } = input ?? {};
  const fixture = materialLoaderClient(clientInput);
  globalThis[materialActionClientFactoryKey] = () => [
    fixture.client,
    new Headers(),
  ];
  const result = await materialActionModule.loader({
    request: new Request(
      `http://app.test/projects/${ids.project}/materials${search}`,
    ),
    params: { projectId: ids.project },
  });
  return { ...fixture, data: routeData(result) };
}

test("material loader binds an exact BOQ version and line tuple", async () => {
  const rows = materialLoaderRows();
  const plan = rows.lukas_qto_material_plans[0];
  const matching = {
    id: loaderUuid(701),
    project_id: ids.project,
    boq_version_id: ids.version,
    boq_line_id: ids.line,
    boq_rate_component_id: ids.component,
    material_resource_id: ids.resource,
    boq_result_sha256: loaderSha("a"),
    material_plan_id: plan.id,
    derived_design_quantity: "3",
    created_at: "2026-09-02T00:00:00.000Z",
    boq_line: { item_code: "MATCHING" },
    material_plan: plan,
  };
  rows.lukas_drawing_material_links = [
    matching,
    {
      ...matching,
      id: loaderUuid(702),
      boq_version_id: loaderUuid(703),
      boq_line: { item_code: "FOREIGN-VERSION" },
    },
  ];

  const { data } = await loadMaterialWorkspace({
    apiCap: 200,
    rows,
    search: `?version=${ids.version}&boqLineId=${ids.line}`,
  });

  assert.deepEqual(
    data.materialLineage.rows.map((row) => row.itemCode),
    ["MATCHING"],
  );
});

test("material loader rejects an orphan BOQ line filter", async () => {
  await assert.rejects(
    loadMaterialWorkspace({ search: `?boqLineId=${ids.line}` }),
    (error) => error instanceof Response && error.status === 400,
  );
});

test("material loader rejects duplicate BOQ line identities", async () => {
  await assert.rejects(
    loadMaterialWorkspace({
      search: `?version=${ids.version}&boqLineId=${ids.line}&boqLineId=${ids.line}`,
    }),
    (error) => error instanceof Response && error.status === 400,
  );
});

test("material loader binds one exact transaction to its authoritative material plan", async () => {
  const rows = materialLoaderRows();
  const plan = rows.lukas_qto_material_plans[0];
  rows.lukas_drawing_material_links = [
    {
      id: loaderUuid(704),
      project_id: ids.project,
      boq_version_id: ids.version,
      boq_line_id: ids.line,
      boq_rate_component_id: ids.component,
      material_resource_id: ids.resource,
      boq_result_sha256: loaderSha("a"),
      material_plan_id: plan.id,
      derived_design_quantity: "3",
      created_at: "2026-09-02T00:00:00.000Z",
      boq_line: { item_code: "TRANSACTION-MATCH" },
      material_plan: plan,
    },
  ];
  const transactionId = rows.lukas_qto_material_transactions[0].id;

  const { data } = await loadMaterialWorkspace({
    apiCap: 200,
    rows,
    search: `?transactionId=${transactionId}`,
  });

  assert.equal(data.transactionId, transactionId);
  assert.deepEqual(
    data.materialLineage.rows.map((row) => row.itemCode),
    ["TRANSACTION-MATCH"],
  );
});

test("material loader rejects duplicate and malformed transaction identities", async () => {
  await assert.rejects(
    loadMaterialWorkspace({ search: "?transactionId=not-a-uuid" }),
    (error) => error instanceof Response && error.status === 400,
  );
  await assert.rejects(
    loadMaterialWorkspace({
      search: `?transactionId=${ids.transaction}&transactionId=${ids.transaction}`,
    }),
    (error) => error instanceof Response && error.status === 400,
  );
});

test("material loader returns a controlled 404 for missing and foreign-project transactions", async () => {
  await assert.rejects(
    loadMaterialWorkspace({
      search: `?transactionId=${loaderUuid(799)}`,
    }),
    (error) => error instanceof Response && error.status === 404,
  );

  const rows = materialLoaderRows();
  const foreignTransactionId = rows.lukas_qto_material_transactions[0].id;
  rows.lukas_qto_material_transactions[0].project_id = loaderUuid(798);
  await assert.rejects(
    loadMaterialWorkspace({
      apiCap: 200,
      rows,
      search: `?transactionId=${foreignTransactionId}`,
    }),
    (error) => error instanceof Response && error.status === 404,
  );
});

test("material loader returns a controlled 400 for conflicting plan and transaction filters", async () => {
  const rows = materialLoaderRows();
  const transactionId = rows.lukas_qto_material_transactions[0].id;
  const conflictingPlanId = rows.lukas_qto_material_plans[1].id;

  await assert.rejects(
    loadMaterialWorkspace({
      apiCap: 200,
      rows,
      search: `?materialPlanId=${conflictingPlanId}&transactionId=${transactionId}`,
    }),
    (error) => error instanceof Response && error.status === 400,
  );
});

test("material loader binds one exact carbon factor and rejects malformed or duplicate factor identities", async () => {
  const rows = materialLoaderRows();
  const factorId = rows.lukas_qto_carbon_factors[0].id;
  const plan = rows.lukas_qto_material_plans[0];
  plan.baseline_factor_id = factorId;
  rows.lukas_drawing_material_links = [
    {
      id: loaderUuid(705),
      project_id: ids.project,
      boq_version_id: ids.version,
      boq_line_id: ids.line,
      boq_rate_component_id: ids.component,
      material_resource_id: ids.resource,
      boq_result_sha256: loaderSha("a"),
      material_plan_id: plan.id,
      derived_design_quantity: "3",
      created_at: "2026-09-02T00:00:00.000Z",
      boq_line: { item_code: "CARBON-MATCH" },
      material_plan: plan,
    },
  ];

  const { data } = await loadMaterialWorkspace({
    apiCap: 200,
    rows,
    search: `?carbonFactorId=${factorId}`,
  });
  assert.equal(data.carbonFactorId, factorId);
  assert.deepEqual(
    data.materialLineage.rows.map((row) => row.itemCode),
    ["CARBON-MATCH"],
  );
  for (const search of [
    "?carbonFactorId=not-a-uuid",
    `?carbonFactorId=${factorId}&carbonFactorId=${factorId}`,
  ])
    await assert.rejects(
      loadMaterialWorkspace({ apiCap: 200, rows, search }),
      (error) => error instanceof Response && error.status === 400,
    );
});

test("material loader pages every operational dataset under an API cap of one", async () => {
  const { data, observations } = await loadMaterialWorkspace();
  assert.equal(data.plans.length, 2);
  assert.equal(data.transactions.length, 2);
  assert.equal(data.factors.length, 2);
  assert.equal(data.files.length, 2);
  assert.equal(data.approvedTakeoffs.length, 2);
  assert.equal(
    data.summaries.find(
      (summary) =>
        summary.materialPlanId === data.transactions[0].material_plan_id,
    ).orderedQuantity,
    "3",
  );
  for (const [table, expected] of [
    [
      "lukas_qto_material_plans",
      [
        { column: "created_at", ascending: false },
        { column: "id", ascending: false },
      ],
    ],
    ["lukas_qto_material_transactions", [{ column: "id", ascending: true }]],
    ["lukas_qto_carbon_factors", [{ column: "id", ascending: true }]],
    ["lukas_qto_files", [{ column: "id", ascending: true }]],
    ["lukas_qto_takeoff_artifacts", [{ column: "id", ascending: true }]],
    ["lukas_qto_takeoff_approvals", [{ column: "id", ascending: true }]],
  ])
    assert.ok(
      observations.orderings[table].every(
        (ordering) => JSON.stringify(ordering) === JSON.stringify(expected),
      ),
      `${table} must page with one deterministic identity order`,
    );
});

test("material loader keeps every approved BOQ component while limiting PostgREST in filters to 100 values", async () => {
  const rows = materialLoaderRows();
  const versions = Array.from({ length: 200 }, (_, index) => ({
    id: loaderUuid(10_000 + index),
    project_id: ids.project,
    engine_version: "VERIFIED-BOQ-1.1",
    version_no: index + 1,
    title: `BOQ ${index + 1}`,
    status: index === 199 ? "approved" : "superseded",
  }));
  rows.lukas_qto_boq_versions = versions;
  rows.lukas_qto_boq_rate_components = versions.map((version, index) => ({
    id: loaderUuid(20_000 + index),
    project_id: ids.project,
    version_id: version.id,
    coefficient: "1",
    line: { item_code: `ITEM-${index + 1}` },
    resource: {
      resource_code: `MAT-${index + 1}`,
      resource_name: `material-${index + 1}`,
      specification: "standard",
      unit: "EA",
      resource_type: "material",
    },
  }));
  rows.lukas_drawing_material_links = [];

  const { data, observations } = await loadMaterialWorkspace({
    apiCap: 200,
    rows,
  });
  const approvedBoqCalls = observations.inCalls.filter(
    (call) =>
      (call.table === "lukas_qto_boq_rate_components" &&
        call.column === "version_id") ||
      (call.table === "lukas_drawing_material_links" &&
        call.column === "boq_version_id"),
  );
  assert.ok(
    approvedBoqCalls.length >= 4,
    `expected chunked approved BOQ queries, got ${approvedBoqCalls.length}`,
  );
  assert.ok(
    approvedBoqCalls.every((call) => call.values.length <= 100),
    `oversized approved BOQ filter: ${JSON.stringify(approvedBoqCalls.map((call) => call.values.length))}`,
  );
  assert.equal(data.approvedBoqs.length, versions.length);
  assert.equal(
    data.approvedBoqs.flatMap((version) => version.components).length,
    versions.length,
  );
  assert.deepEqual(
    data.approvedBoqs.map((version) => version.id),
    [...versions].reverse().map((version) => version.id),
  );
});

test("material loader keeps baseline totals exact while rows append between pages", async () => {
  const rows = materialLoaderRows();
  const first = rows.lukas_qto_material_transactions[0];
  const leading = {
    ...first,
    id: loaderUuid(399),
    document_number: "PO-LEADING-APPEND",
    occurred_on: "2026-01-01",
    quantity: "8",
  };
  const trailing = {
    ...first,
    id: loaderUuid(499),
    document_number: "PO-TRAILING-APPEND",
    occurred_on: "2026-12-31",
    quantity: "4",
  };
  const { data } = await loadMaterialWorkspace({
    apiCap: 1,
    rows,
    mutateAfterPages: {
      lukas_qto_material_transactions: new Map([
        [0, (tableRows) => tableRows.push(leading, trailing)],
      ]),
    },
  });
  assert.deepEqual(
    data.transactions.map((row) => row.id),
    [first.id, rows.lukas_qto_material_transactions[1].id, trailing.id],
  );
  assert.equal(
    data.summaries.find(
      (summary) => summary.materialPlanId === first.material_plan_id,
    ).orderedQuantity,
    "7",
  );
});

test("material loader fails closed on a later page error from every operational dataset", async () => {
  for (const table of [
    "lukas_qto_material_plans",
    "lukas_qto_material_transactions",
    "lukas_qto_carbon_factors",
    "lukas_qto_files",
    "lukas_qto_takeoff_artifacts",
    "lukas_qto_takeoff_approvals",
  ])
    await assert.rejects(
      loadMaterialWorkspace({ errorPages: { [table]: new Set([1]) } }),
      (error) => {
        assert.equal(error.status, 409, `${table}: ${error}`);
        return true;
      },
    );
});

test("material loader exposes a 200-plan cursor page beyond the former hard bound", async () => {
  const { data } = await loadMaterialWorkspace({
    apiCap: 200,
    rows: materialLoaderRows(2_001),
  });
  assert.equal(data.plans.length, 200);
  assert.ok(data.materialPlanPage.nextCursor);
  assert.match(data.materialPlanPage.nextHref, /planCursor=/);
});

test("material loader selects an off-page plan with its complete transaction and factor scope", async () => {
  const rows = materialLoaderRows(201);
  const selectedPlan = rows.lukas_qto_material_plans[0];
  const selectedFactor = rows.lukas_qto_carbon_factors[0];
  selectedPlan.baseline_factor_id = selectedFactor.id;
  selectedFactor.material_code = selectedPlan.material_code;
  for (const transaction of rows.lukas_qto_material_transactions)
    transaction.carbon_factor_id = selectedFactor.id;

  const { data } = await loadMaterialWorkspace({
    apiCap: 7,
    rows,
    search: `?materialPlanId=${selectedPlan.id}`,
  });

  assert.deepEqual(
    data.plans.map((plan) => plan.id),
    [selectedPlan.id],
  );
  assert.equal(data.transactions.length, 2);
  assert.equal(data.summaries[0].orderedQuantity, "3");
  assert.equal(data.summaries[0].baselineA1A3KgCo2e, "3");
  assert.equal(data.summaries[0].committedA1A3KgCo2e, "3");
  assert.equal(data.materialPlanPage.nextCursor, null);
});

test("material loader bounds approvals to artifacts in the current project", async () => {
  const rows = materialLoaderRows();
  rows.lukas_qto_takeoff_approvals.push(
    ...Array.from({ length: 10_001 }, (_, index) => ({
      id: loaderUuid(20_000 + index),
      artifact_id: loaderUuid(40_000 + index),
      artifact: { project_id: loaderUuid(90_000) },
      decision: "approved",
      decision_sequence: 1,
      created_at: "2026-09-02T00:00:00Z",
    })),
  );
  const { data } = await loadMaterialWorkspace({ apiCap: 200, rows });
  assert.equal(data.approvedTakeoffs.length, 2);
});

function failedMaterialEvidenceClient(
  role,
  { metadataDeleteFails = false, storageDeleteFails = false } = {},
) {
  const actorId = ids.resource;
  const evidenceId = loaderUuid(role === "site" ? 701 : 702);
  const metadata = new Set();
  const storageObjects = new Set();
  const uploadedPaths = [];
  const project = {
    id: ids.project,
    owner_id: ids.file,
    organization_id: ids.workspace,
  };
  const projectQuery = {
    eq() {
      return projectQuery;
    },
    maybeSingle() {
      return Promise.resolve({ data: project, error: null });
    },
    select() {
      return projectQuery;
    },
    single() {
      return Promise.resolve({ data: project, error: null });
    },
  };
  const client = {
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
      if (table === "lukas_qto_projects") return projectQuery;
      if (table === "lukas_qto_project_members") {
        const query = {
          eq() {
            return query;
          },
          maybeSingle() {
            return Promise.resolve({ data: { role }, error: null });
          },
          select() {
            return query;
          },
        };
        return query;
      }
      if (table === "lukas_qto_files")
        return {
          delete() {
            let selectedId = null;
            const query = {
              eq(_column, value) {
                selectedId = value;
                return query;
              },
              select() {
                return query;
              },
              maybeSingle() {
                if (metadataDeleteFails)
                  return Promise.resolve({
                    data: null,
                    error: { message: "injected metadata cleanup failure" },
                  });
                const deleted = metadata.delete(selectedId);
                return Promise.resolve({
                  data: deleted ? { id: selectedId } : null,
                  error: null,
                });
              },
            };
            return query;
          },
          insert() {
            return {
              select() {
                return {
                  single() {
                    metadata.add(evidenceId);
                    return Promise.resolve({
                      data: { id: evidenceId },
                      error: null,
                    });
                  },
                };
              },
            };
          },
        };
      if (table === "lukas_qto_material_transactions")
        return {
          insert() {
            return Promise.resolve({
              data: null,
              error: { message: "injected material transaction failure" },
            });
          },
        };
      throw new Error(`Unexpected failed evidence table: ${table}`);
    },
    async rpc() {
      return { data: true, error: null };
    },
    storage: {
      from(bucket) {
        assert.equal(bucket, "lukas-qto");
        return {
          async remove(paths) {
            const denied = paths.some((path) => path.split("/")[0] !== actorId);
            if (denied)
              return {
                data: null,
                error: { message: "uploader cannot delete another prefix" },
              };
            if (storageDeleteFails)
              return {
                data: null,
                error: { message: "injected storage cleanup failure" },
              };
            for (const path of paths) storageObjects.delete(path);
            return { data: paths, error: null };
          },
          async upload(path) {
            uploadedPaths.push(path);
            storageObjects.add(path);
            return { data: { path }, error: null };
          },
        };
      },
    },
  };
  return {
    actorId,
    client,
    evidenceId,
    metadata,
    storageObjects,
    uploadedPaths,
  };
}

function materialEvidenceFailureForm(role, transactionType) {
  const form = new FormData();
  for (const [name, value] of [
    ["intent", "transaction"],
    ["transaction_type", transactionType],
    ["material_plan_id", ids.materialPlan],
    ["document_number", `${role}-failed-evidence`],
    ["supplier_name", "1HK 공급사"],
    ["occurred_on", "2026-09-02"],
    ["quantity", "1"],
    ["unit_price_krw", transactionType === "invoice_evidence" ? "10" : ""],
    ["amount_krw", transactionType === "invoice_evidence" ? "10" : ""],
    ["related_order_id", ids.transaction],
    ["carbon_factor_id", ""],
    ["evidence_file_id", ""],
    ["received_by_name", role === "site" ? "현장 담당" : ""],
    ["event_location", role === "site" ? "A동" : ""],
    ["note", "실패 cleanup"],
  ])
    form.set(name, value);
  if (role === "site") form.set("site_acknowledgement", "on");
  form.set(
    "evidence_capture",
    new File([new Uint8Array([1, 2, 3])], `${role}.jpg`, {
      type: "image/jpeg",
    }),
  );
  return form;
}

test("site and procurement transaction failures leave no uploaded evidence orphan", async () => {
  for (const [role, transactionType] of [
    ["site", "goods_receipt"],
    ["procurement", "invoice_evidence"],
  ]) {
    const fixture = failedMaterialEvidenceClient(role);
    globalThis[materialActionClientFactoryKey] = () => [
      fixture.client,
      new Headers(),
    ];
    const form = materialEvidenceFailureForm(role, transactionType);
    const response = await materialActionModule.action({
      request: new Request(
        `http://app.test/projects/${ids.project}/materials`,
        { method: "POST", body: form },
      ),
      params: { projectId: ids.project },
    });
    assert.equal(response.init.status, 400);
    assert.deepEqual([...fixture.metadata], []);
    assert.deepEqual([...fixture.storageObjects], []);
    assert.match(
      fixture.uploadedPaths[0],
      new RegExp(`^${fixture.actorId}/${ids.project}/material-evidence/`),
    );
  }
});

test("failed metadata cleanup preserves uploaded bytes and reports an integrity-safe error", async () => {
  const fixture = failedMaterialEvidenceClient("site", {
    metadataDeleteFails: true,
  });
  globalThis[materialActionClientFactoryKey] = () => [
    fixture.client,
    new Headers(),
  ];
  const form = materialEvidenceFailureForm("site", "goods_receipt");
  const response = await materialActionModule.action({
    request: new Request(`http://app.test/projects/${ids.project}/materials`, {
      method: "POST",
      body: form,
    }),
    params: { projectId: ids.project },
  });
  assert.equal(response.init.status, 400);
  assert.match(response.data.error, /증빙 metadata 정리 실패/);
  assert.deepEqual([...fixture.metadata], [fixture.evidenceId]);
  assert.equal(fixture.storageObjects.size, 1);
});

test("failed blob cleanup leaves no dangling metadata and reports the staged orphan", async () => {
  const fixture = failedMaterialEvidenceClient("site", {
    storageDeleteFails: true,
  });
  globalThis[materialActionClientFactoryKey] = () => [
    fixture.client,
    new Headers(),
  ];
  const form = materialEvidenceFailureForm("site", "goods_receipt");
  const response = await materialActionModule.action({
    request: new Request(`http://app.test/projects/${ids.project}/materials`, {
      method: "POST",
      body: form,
    }),
    params: { projectId: ids.project },
  });
  assert.equal(response.init.status, 400);
  assert.match(response.data.error, /증빙 blob 정리 실패/);
  assert.deepEqual([...fixture.metadata], []);
  assert.equal(fixture.storageObjects.size, 1);
});

async function postMaterialAction(role, intent, transactionType) {
  const fixture = materialActionClient(role);
  globalThis[materialActionClientFactoryKey] = () => [
    fixture.client,
    new Headers(),
  ];
  const form = new FormData();
  form.set("intent", intent);
  if (transactionType) form.set("transaction_type", transactionType);
  const response = await materialActionModule.action({
    request: new Request(`http://app.test/projects/${ids.project}/materials`, {
      method: "POST",
      body: form,
    }),
    params: { projectId: ids.project },
  });
  return { ...fixture, response };
}

test("material action rejects every unauthorized known intent with 403 before writes", async () => {
  for (const [role, intent, transactionType] of [
    ["viewer", "boq_handoff"],
    ["reviewer", "import_takeoff"],
    ["approver", "plan"],
    ["site", "factor"],
    ["site", "transaction", "purchase_order"],
    ["procurement", "transaction", "installation"],
    ["estimator", "transaction", "invoice_evidence"],
  ]) {
    const { observations, response } = await postMaterialAction(
      role,
      intent,
      transactionType,
    );
    assert.equal(response.init.status, 403, `${role}:${intent}`);
    assert.match(response.data.error, /권한/);
    assert.deepEqual(observations.writeTables, []);
    assert.deepEqual(observations.membershipFilters, [
      ["project_id", ids.project],
      ["user_id", ids.resource],
    ]);
  }
});

test("material action rejects an unknown project role with 403", async () => {
  const { observations, response } = await postMaterialAction("admin", "plan");
  assert.equal(response.init.status, 403);
  assert.match(response.data.error, /권한/);
  assert.deepEqual(observations.writeTables, []);
});

test("material action checks feature entitlement before role and form details", async () => {
  const fixture = materialActionClient("viewer");
  globalThis[materialActionClientFactoryKey] = () => [
    fixture.client,
    new Headers(),
  ];
  const form = new FormData();
  form.set("intent", "plan");
  const response = await materialActionModule.action({
    request: {
      url: `http://app.test/projects/${ids.project}/materials`,
      async formData() {
        fixture.observations.order.push("form");
        return form;
      },
    },
    params: { projectId: ids.project },
  });
  assert.equal(response.init.status, 403);
  assert.deepEqual(fixture.observations.order, [
    "project",
    "feature-project",
    "feature",
    "role",
    "form",
  ]);
});

test("all non-PO material events name every evidence-required event", async () => {
  const fixture = materialActionClient("site");
  globalThis[materialActionClientFactoryKey] = () => [
    fixture.client,
    new Headers(),
  ];
  const form = new FormData();
  for (const [name, value] of [
    ["intent", "transaction"],
    ["transaction_type", "goods_receipt"],
    ["material_plan_id", ids.materialPlan],
    ["document_number", "GR-001"],
    ["supplier_name", "1HK 공급사"],
    ["occurred_on", "2026-09-02"],
    ["quantity", "1"],
    ["received_by_name", ""],
    ["event_location", ""],
    ["note", ""],
  ])
    form.set(name, value);
  const response = await materialActionModule.action({
    request: new Request(`http://app.test/projects/${ids.project}/materials`, {
      method: "POST",
      body: form,
    }),
    params: { projectId: ids.project },
  });
  assert.equal(response.init.status, 400);
  assert.equal(
    response.data.error,
    "입고·설치·반품·폐기·계산서에는 원본 증빙 파일이 필요합니다.",
  );
  assert.deepEqual(fixture.observations.writeTables, []);
});
