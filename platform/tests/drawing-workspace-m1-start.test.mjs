import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAWING_ESTIMATE_CATEGORIES,
  DRAWING_EVIDENCE_KINDS,
  DrawingStarterDefinitionSchema,
} from "../app/lukas/lib/drawing-starter-templates.ts";
import {
  buildDrawingWorkspaceScaffoldOperation,
  createDrawingWorkspaceStart,
  ensureDrawingStarterVersion,
  loadDrawingStarterCatalog,
  recordDrawingPlatformStarterImport,
} from "../app/lukas/lib/drawing-starter-templates.server.ts";

const ids = Object.freeze({
  organization: "71000000-0000-4000-8000-000000000001",
  project: "71000000-0000-4000-8000-000000000002",
  document: "71000000-0000-4000-8000-000000000003",
  revision: "71000000-0000-4000-8000-000000000004",
  page: "71000000-0000-4000-8000-000000000005",
  canvas: "71000000-0000-4000-8000-000000000006",
  version: "71000000-0000-4000-8000-000000000007",
  request: "71000000-0000-4000-8000-000000000008",
  import: "71000000-0000-4000-8000-000000000009",
  registry: "71000000-0000-4000-8000-000000000010",
  revisionTwo: "71000000-0000-4000-8000-000000000011",
});

const starterHashes = Object.freeze({
  "apartment-remodel":
    "d74b6bb15543de5fbddb9b7b546534998b0ff8b96c16903f7ac84b00203f9daf",
  "commercial-interior":
    "cff6d5e23a2d6d4815eb25a5f7bb6740eb7c80a0f6ca54d905f22c3df74bdd01",
  "demolition-restoration":
    "973125f1edd20abfe14a96b78a9d449b3238ba185481a3a74e957f0127c33a3b",
  "interior-basic":
    "b8fd33eeee0e14bcf2cb7cd4407602e55ad6dc6edea805d4fb45028710aa6df9",
});

const starterDefinitions = Object.freeze(
  [
    {
      key: "interior-basic",
      name: "실내건축 기본 적산",
      description: "바닥·벽·천장·문·창호·가구 기본 수량을 정리합니다.",
      layers: ["실측", "바닥", "벽", "천장", "문·창호", "가구"],
    },
    {
      key: "apartment-remodel",
      name: "공동주택 리모델링",
      description: "세대 공간별 마감·창호·가구·철거 수량을 정리합니다.",
      layers: ["실측", "기존", "철거", "신설", "마감", "가구"],
    },
    {
      key: "commercial-interior",
      name: "상업공간 인테리어",
      description: "영업 공간의 구획·마감·집기 수량을 정리합니다.",
      layers: ["실측", "구획", "바닥", "벽", "천장", "집기", "설비 근거"],
    },
    {
      key: "demolition-restoration",
      name: "철거·원상복구",
      description: "철거 대상과 복구 대상을 분리해 수량을 정리합니다.",
      layers: ["실측", "존치", "철거", "폐기", "복구", "보양"],
    },
  ].map((starter) => ({
    schemaVersion: "1hk-platform-starter/1",
    version: 1,
    categories: ["바닥", "벽", "천장", "문", "창호", "가구", "철거"],
    evidenceKinds: ["수기 입력", "현장 실측", "가정값", "원본 연결"],
    table: {
      name: "기본 내역",
      columns: ["적산 분류", "품목 코드", "측정 종류", "단위", "검토 규칙"],
      rows: [],
    },
    ...starter,
  })),
);

function starterRows() {
  return starterDefinitions.map((definition) => ({
    key: definition.key,
    version: definition.version,
    name: definition.name,
    description: definition.description,
    canonical_payload: definition,
    content_sha256: starterHashes[definition.key],
  }));
}

function starterRpcClient(rows = starterRows()) {
  return {
    rpc(name, args) {
      assert.equal(name, "lukas_drawing_list_platform_starters");
      assert.deepEqual(args, {
        p_organization_id: ids.organization,
        p_project_id: ids.project,
      });
      return Promise.resolve({ data: rows, error: null });
    },
  };
}

test("M1 loads exactly four immutable organization-seedable starters in bytewise key order", async () => {
  const catalog = await loadDrawingStarterCatalog(
    starterRpcClient(),
    ids.organization,
    ids.project,
  );
  assert.deepEqual(
    catalog.map(({ definition: { key, name, version } }) => ({
      key,
      name,
      version,
    })),
    [
      { key: "apartment-remodel", name: "공동주택 리모델링", version: 1 },
      { key: "commercial-interior", name: "상업공간 인테리어", version: 1 },
      { key: "demolition-restoration", name: "철거·원상복구", version: 1 },
      { key: "interior-basic", name: "실내건축 기본 적산", version: 1 },
    ],
  );
  assert.equal(catalog.at(-1).definition.categories.length, 7);
  assert.equal(catalog.at(-1).definition.table.rows.length, 0);
  assert.deepEqual(DRAWING_ESTIMATE_CATEGORIES, [
    "바닥",
    "벽",
    "천장",
    "문",
    "창호",
    "가구",
    "철거",
  ]);
  assert.deepEqual(DRAWING_EVIDENCE_KINDS, [
    "수기 입력",
    "현장 실측",
    "가정값",
    "원본 연결",
  ]);
  assert.equal(
    DrawingStarterDefinitionSchema.safeParse({
      ...catalog[0].definition,
      extra: true,
    }).success,
    false,
  );
});

test("starter catalog rejects duplicate, malformed-hash, and non-canonical rows", async () => {
  await assert.rejects(
    loadDrawingStarterCatalog(
      starterRpcClient([...starterRows(), starterRows()[0]]),
      ids.organization,
      ids.project,
    ),
    /중복|duplicate/i,
  );
  await assert.rejects(
    loadDrawingStarterCatalog(
      starterRpcClient([
        { ...starterRows()[0], content_sha256: "not-a-sha" },
        ...starterRows().slice(1),
      ]),
      ids.organization,
      ids.project,
    ),
    /starter|시작|hash|sha/i,
  );
  await assert.rejects(
    loadDrawingStarterCatalog(
      starterRpcClient([
        { ...starterRows()[0], content_sha256: "a".repeat(64) },
        ...starterRows().slice(1),
      ]),
      ids.organization,
      ids.project,
    ),
    /starter|시작|hash|sha/i,
  );
  await assert.rejects(
    loadDrawingStarterCatalog(
      starterRpcClient(starterRows().slice(0, 3)),
      ids.organization,
      ids.project,
    ),
    /starter|시작|four|4/i,
  );
  const changedDescription = starterRows();
  changedDescription[0] = {
    ...changedDescription[0],
    description: "변경된 설명",
    canonical_payload: {
      ...changedDescription[0].canonical_payload,
      description: "변경된 설명",
    },
  };
  await assert.rejects(
    loadDrawingStarterCatalog(
      starterRpcClient(changedDescription),
      ids.organization,
      ids.project,
    ),
    /starter|시작/i,
  );
  const changedLayers = starterRows();
  changedLayers[0] = {
    ...changedLayers[0],
    canonical_payload: {
      ...changedLayers[0].canonical_payload,
      layers: ["실측", "임의 레이어"],
    },
  };
  await assert.rejects(
    loadDrawingStarterCatalog(
      starterRpcClient(changedLayers),
      ids.organization,
      ids.project,
    ),
    /starter|시작/i,
  );
});

test("starter ensure returns the immutable exact retry and surfaces a same-name custom collision", async () => {
  const calls = [];
  const ensured = {
    registryId: ids.registry,
    versionId: ids.version,
    versionNo: 1,
    key: "interior-basic",
    version: 1,
    name: "실내건축 기본 적산",
    description: "바닥·벽·천장·문·창호·가구 기본 수량을 정리합니다.",
    canonicalPayload: starterDefinitions[0],
    contentSha256: starterHashes["interior-basic"],
    status: "published",
  };
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: structuredClone(ensured), error: null });
    },
  };
  const first = await ensureDrawingStarterVersion(
    client,
    ids.organization,
    ids.project,
    "interior-basic",
    1,
  );
  const retry = await ensureDrawingStarterVersion(
    client,
    ids.organization,
    ids.project,
    "interior-basic",
    1,
  );
  assert.deepEqual(retry, first);
  assert.deepEqual(calls, [
    {
      name: "lukas_drawing_ensure_platform_starter_version",
      args: {
        p_organization_id: ids.organization,
        p_project_id: ids.project,
        p_key: "interior-basic",
        p_version: 1,
      },
    },
    {
      name: "lukas_drawing_ensure_platform_starter_version",
      args: {
        p_organization_id: ids.organization,
        p_project_id: ids.project,
        p_key: "interior-basic",
        p_version: 1,
      },
    },
  ]);
  await assert.rejects(
    ensureDrawingStarterVersion(
      {
        rpc() {
          return Promise.resolve({
            data: null,
            error: {
              code: "P1C01",
              message:
                "A custom drawing library entry already uses this starter name",
            },
          });
        },
      },
      ids.organization,
      ids.project,
      "interior-basic",
      1,
    ),
    /custom drawing library entry|starter name/i,
  );
});

test("starter ensure binds the response to the requested approved tuple and DB-canonical hash", async () => {
  const interior = {
    registryId: ids.registry,
    versionId: ids.version,
    versionNo: 1,
    key: "interior-basic",
    version: 1,
    name: starterDefinitions[0].name,
    description: starterDefinitions[0].description,
    canonicalPayload: starterDefinitions[0],
    contentSha256: starterHashes["interior-basic"],
    status: "published",
  };
  const responseClient = (data) => ({
    rpc() {
      return Promise.resolve({ data: structuredClone(data), error: null });
    },
  });

  await assert.rejects(
    ensureDrawingStarterVersion(
      responseClient({
        ...interior,
        key: "apartment-remodel",
        name: starterDefinitions[1].name,
        description: starterDefinitions[1].description,
        canonicalPayload: starterDefinitions[1],
        contentSha256: starterHashes["apartment-remodel"],
      }),
      ids.organization,
      ids.project,
      "interior-basic",
      1,
    ),
    /starter|tuple|key|요청|일치/i,
  );
  await assert.rejects(
    ensureDrawingStarterVersion(
      responseClient({ ...interior, version: 2 }),
      ids.organization,
      ids.project,
      "interior-basic",
      1,
    ),
    /starter|version|버전|일치/i,
  );
  await assert.rejects(
    ensureDrawingStarterVersion(
      responseClient({ ...interior, contentSha256: "f".repeat(64) }),
      ids.organization,
      ids.project,
      "interior-basic",
      1,
    ),
    /starter|hash|sha|일치/i,
  );
});

test("starter import ledger uses exact request identity and rejects a changed retry", async () => {
  const calls = [];
  const receipt = {
    importId: ids.import,
    documentId: ids.document,
    revisionId: ids.revision,
    contentSha256: "1".repeat(64),
    structureFingerprint: "f".repeat(64),
  };
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return Promise.resolve({ data: structuredClone(receipt), error: null });
    },
  };
  const input = {
    organizationId: ids.organization,
    versionId: ids.version,
    projectId: ids.project,
    documentId: ids.document,
    revisionId: ids.revision,
    clientRequestId: ids.request,
  };
  const first = await recordDrawingPlatformStarterImport(client, input);
  const retry = await recordDrawingPlatformStarterImport(client, input);
  assert.deepEqual(retry, first);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], {
    name: "lukas_drawing_record_platform_starter_import",
    args: {
      p_organization_id: ids.organization,
      p_version_id: ids.version,
      p_project_id: ids.project,
      p_document_id: ids.document,
      p_revision_id: ids.revision,
      p_client_request_id: ids.request,
    },
  });
  await assert.rejects(
    recordDrawingPlatformStarterImport(
      {
        rpc() {
          return Promise.resolve({
            data: null,
            error: {
              code: "P1C01",
              message:
                "Request ID does not match the stored platform starter import",
            },
          });
        },
      },
      { ...input, documentId: "71000000-0000-4000-8000-000000000011" },
    ),
    /request id does not match/i,
  );
});

test("one deterministic starter scaffold contains preset layers, five schemas, and a valid empty table", () => {
  const input = {
    definition: starterDefinitions[0],
    revisionId: ids.revision,
    pageId: ids.page,
    canvasId: ids.canvas,
    clientRequestId: ids.request,
    createdAt: "2026-08-31T01:02:03.000Z",
  };
  const first = buildDrawingWorkspaceScaffoldOperation(input);
  const retry = buildDrawingWorkspaceScaffoldOperation(input);
  assert.deepEqual(retry, first);
  assert.equal(first.clientOperationId, "fc740112-71cc-45f3-8541-c06c4eb403c2");
  assert.equal(first.createdAt, input.createdAt);
  assert.equal(first.type, "mutate_structure");
  assert.deepEqual(first.baseVersions, {});
  assert.equal(first.forward.type, "mutate_structure");
  assert.equal(first.inverse.type, "mutate_structure");
  assert.equal(first.forward.actions.length, 12);
  assert.deepEqual(
    first.inverse.actions.map(({ kind }) => kind),
    first.forward.actions
      .map(({ kind }) => kind.replace(/^put_/, "delete_"))
      .reverse(),
  );

  const schemas = first.forward.actions
    .filter(({ kind }) => kind === "put_property_schema")
    .map(({ entity }) => entity);
  assert.deepEqual(
    schemas.map(({ name, valueType, required, version }) => ({
      name,
      valueType,
      required,
      version,
    })),
    [
      { name: "적산 분류", valueType: "enum", required: false, version: 1 },
      { name: "공종", valueType: "text", required: false, version: 1 },
      { name: "품목 코드", valueType: "text", required: false, version: 1 },
      { name: "근거 상태", valueType: "enum", required: false, version: 1 },
      { name: "근거 사유", valueType: "text", required: false, version: 1 },
    ],
  );
  const appliesTo = [
    "line",
    "polyline",
    "rectangle",
    "circle",
    "text",
    "dimension",
    "wall",
    "opening",
    "space",
    "area",
    "grid",
    "arc",
    "block_instance",
  ];
  for (const schema of schemas) assert.deepEqual(schema.appliesTo, appliesTo);
  assert.deepEqual(schemas[0].enumOptions, DRAWING_ESTIMATE_CATEGORIES);
  assert.deepEqual(schemas[3].enumOptions, DRAWING_EVIDENCE_KINDS);

  const table = first.forward.actions.find(
    ({ kind }) => kind === "put_table",
  ).entity;
  assert.equal(table.name, "기본 내역");
  assert.equal(table.version, 1);
  assert.deepEqual(table.rows, []);
  assert.deepEqual(
    table.columns.map(({ name, kind }) => ({ name, kind })),
    [
      { name: "적산 분류", kind: "property" },
      { name: "품목 코드", kind: "property" },
      { name: "측정 종류", kind: "text" },
      { name: "단위", kind: "text" },
      { name: "검토 규칙", kind: "text" },
    ],
  );
  assert.equal(table.columns[0].propertySchemaId, schemas[0].id);
  assert.equal(table.columns[1].propertySchemaId, schemas[2].id);
  assert.deepEqual(
    table.columns.slice(2).map(({ propertySchemaId }) => propertySchemaId),
    [null, null, null],
  );
});

test("blank and PDF starts share the common five-schema scaffold without layers or a table", () => {
  const operation = buildDrawingWorkspaceScaffoldOperation({
    definition: null,
    revisionId: ids.revision,
    pageId: ids.page,
    canvasId: ids.canvas,
    clientRequestId: ids.request,
    createdAt: "2026-08-31T01:02:03.000Z",
  });
  assert.deepEqual(
    operation.forward.actions.map(({ kind }) => kind),
    Array(5).fill("put_property_schema"),
  );
  assert.equal(
    operation.forward.actions.some(({ kind }) => kind === "put_table"),
    false,
  );
  assert.equal(
    operation.forward.actions.some(({ kind }) => kind === "put_layer"),
    false,
  );
});

test("scaffold entity and column UUIDs are revision-scoped while exact retries stay byte-identical", () => {
  const input = {
    definition: starterDefinitions[0],
    revisionId: ids.revision,
    pageId: ids.page,
    canvasId: ids.canvas,
    clientRequestId: ids.request,
    createdAt: "2026-08-31T01:02:03.000Z",
  };
  const first = buildDrawingWorkspaceScaffoldOperation(input);
  const retry = buildDrawingWorkspaceScaffoldOperation(input);
  const otherRevision = buildDrawingWorkspaceScaffoldOperation({
    ...input,
    revisionId: ids.revisionTwo,
  });
  const entityIds = (operation) =>
    operation.forward.actions.flatMap(({ entity }) => [
      entity.id,
      ...(entity.columns?.map(({ id }) => id) ?? []),
    ]);

  assert.deepEqual(retry, first);
  assert.equal(otherRevision.clientOperationId, first.clientOperationId);
  assert.equal(
    entityIds(first).some((id) => entityIds(otherRevision).includes(id)),
    false,
  );
});

test("an exact starter start retry preserves one document, one byte-identical operation envelope, and one import row", async () => {
  const documents = new Map();
  const operations = new Map();
  const imports = new Map();
  const operationEnvelopes = [];
  const client = {
    async rpc(name, args) {
      if (name === "lukas_drawing_ensure_platform_starter_version")
        return {
          data: {
            registryId: ids.registry,
            versionId: ids.version,
            versionNo: 1,
            key: "interior-basic",
            version: 1,
            name: starterDefinitions[0].name,
            description: starterDefinitions[0].description,
            canonicalPayload: starterDefinitions[0],
            contentSha256: starterHashes["interior-basic"],
            status: "published",
          },
          error: null,
        };
      if (name === "lukas_drawing_create_document_idempotent") {
        const identity = JSON.stringify(args);
        const previous = documents.get(args.p_client_request_id);
        if (previous && previous.identity !== identity)
          return {
            data: null,
            error: { code: "P1C01", message: "changed drawing request" },
          };
        const result = {
          documentId: ids.document,
          revisionId: ids.revision,
          pageId: ids.page,
          canvasId: ids.canvas,
        };
        documents.set(args.p_client_request_id, { identity, result });
        return { data: result, error: null };
      }
      if (name === "lukas_drawing_apply_operation") {
        const envelope = JSON.stringify(args);
        operationEnvelopes.push(envelope);
        const previous = operations.get(args.p_client_operation_id);
        if (previous && previous !== envelope)
          return {
            data: null,
            error: { code: "P1C01", message: "changed operation envelope" },
          };
        operations.set(args.p_client_operation_id, envelope);
        return {
          data: {
            operationId: args.p_client_operation_id,
            clientOperationId: args.p_client_operation_id,
            sequence: 1,
            resultVersions: Object.fromEntries(
              args.p_forward.actions.map((action) => [action.entity.id, 1]),
            ),
          },
          error: null,
        };
      }
      if (name === "lukas_drawing_record_platform_starter_import") {
        const identity = JSON.stringify(args);
        const previous = imports.get(args.p_client_request_id);
        if (previous && previous.identity !== identity)
          return {
            data: null,
            error: { code: "P1C01", message: "changed import request" },
          };
        const result = {
          importId: ids.import,
          documentId: ids.document,
          revisionId: ids.revision,
          contentSha256: "1".repeat(64),
          structureFingerprint: "f".repeat(64),
        };
        imports.set(args.p_client_request_id, { identity, result });
        return { data: result, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  };
  const input = {
    organizationId: ids.organization,
    projectId: ids.project,
    title: "실내건축 적산",
    sourceFile: null,
    definition: starterDefinitions[0],
    starterVersion: 1,
    clientRequestId: ids.request,
    clientCreatedAt: "2026-08-31T01:02:03.000Z",
  };
  const first = await createDrawingWorkspaceStart(client, input);
  const retry = await createDrawingWorkspaceStart(client, input);
  assert.deepEqual(retry, first);
  assert.equal(first.documentId, ids.document);
  assert.equal(documents.size, 1);
  assert.equal(operations.size, 1);
  assert.equal(imports.size, 1);
  assert.equal(operationEnvelopes.length, 2);
  assert.equal(operationEnvelopes[1], operationEnvelopes[0]);
  assert.equal(first.operation.createdAt, "2026-08-31T01:02:03.000Z");
  assert.deepEqual(retry.operation, first.operation);
});
