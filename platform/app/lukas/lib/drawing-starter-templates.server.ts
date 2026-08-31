import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { z } from "zod";

import {
  applyDrawingOperation,
  createDrawingDocumentIdempotent,
  DrawingWorkspaceConflictError,
  DrawingWorkspaceRejectedError,
  DrawingWorkspaceRetryableError,
  DrawingWorkspaceRpcError,
} from "./drawing-workspace.server.ts";
import type { DrawingOperationInput } from "./drawing-workspace.types.ts";
import {
  DRAWING_ESTIMATE_CATEGORIES,
  DRAWING_EVIDENCE_KINDS,
  DrawingStarterDefinitionSchema,
  type DrawingStarterCatalogItem,
  type DrawingStarterDefinition,
} from "./drawing-starter-templates.ts";

type StarterClient = SupabaseClient<any>;

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const StarterKey = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const APPROVED_STARTERS = [
  ["apartment-remodel", "공동주택 리모델링", 1],
  ["commercial-interior", "상업공간 인테리어", 1],
  ["demolition-restoration", "철거·원상복구", 1],
  ["interior-basic", "실내건축 기본 적산", 1],
] as const;
const APPROVED_STARTER_DETAILS: Record<
  (typeof APPROVED_STARTERS)[number][0],
  { description: string; layers: readonly string[] }
> = {
  "apartment-remodel": {
    description: "세대 공간별 마감·창호·가구·철거 수량을 정리합니다.",
    layers: ["실측", "기존", "철거", "신설", "마감", "가구"],
  },
  "commercial-interior": {
    description: "영업 공간의 구획·마감·집기 수량을 정리합니다.",
    layers: ["실측", "구획", "바닥", "벽", "천장", "집기", "설비 근거"],
  },
  "demolition-restoration": {
    description: "철거 대상과 복구 대상을 분리해 수량을 정리합니다.",
    layers: ["실측", "존치", "철거", "폐기", "복구", "보양"],
  },
  "interior-basic": {
    description: "바닥·벽·천장·문·창호·가구 기본 수량을 정리합니다.",
    layers: ["실측", "바닥", "벽", "천장", "문·창호", "가구"],
  },
};

const StarterCatalogRow = z
  .object({
    key: StarterKey,
    version: z.coerce.number().int().positive(),
    name: z.string().min(1),
    description: z.string().min(1),
    canonical_payload: DrawingStarterDefinitionSchema,
    content_sha256: Sha256,
  })
  .strict();

const EnsuredStarter = z
  .object({
    registryId: Uuid,
    versionId: Uuid,
    versionNo: z.coerce.number().int().positive(),
    key: StarterKey,
    version: z.literal(1),
    name: z.string().min(1),
    description: z.string().min(1),
    canonicalPayload: DrawingStarterDefinitionSchema,
    contentSha256: Sha256,
    status: z.literal("published"),
  })
  .strict();

const StarterImportReceipt = z
  .object({
    importId: Uuid,
    documentId: Uuid,
    revisionId: Uuid,
    contentSha256: Sha256,
    structureFingerprint: Sha256,
  })
  .strict();

function starterRpcResult<T>(
  data: T | null,
  error: { code?: string; message: string } | null,
) {
  if (error) {
    if (["23505", "23P01", "P1C01"].includes(error.code ?? ""))
      throw new DrawingWorkspaceConflictError(error.message);
    if (error.code === "P1R01")
      throw new DrawingWorkspaceRejectedError(error.message);
    if (["40001", "40P01"].includes(error.code ?? ""))
      throw new DrawingWorkspaceRetryableError(error.message);
    throw new DrawingWorkspaceRpcError(error.message);
  }
  if (data === null)
    throw new DrawingWorkspaceRpcError("starter 작업 결과가 없습니다.");
  return data;
}

export async function loadDrawingStarterCatalog(
  client: StarterClient,
  organizationId: string,
  projectId: string,
): Promise<DrawingStarterCatalogItem[]> {
  const { data, error } = await client.rpc(
    "lukas_drawing_list_platform_starters",
    {
      p_organization_id: Uuid.parse(organizationId),
      p_project_id: Uuid.parse(projectId),
    },
  );
  const rows = z
    .array(StarterCatalogRow)
    .parse(starterRpcResult(data, error))
    .sort((left, right) =>
      Buffer.compare(Buffer.from(left.key), Buffer.from(right.key)),
    );
  if (new Set(rows.map((row) => `${row.key}:${row.version}`)).size !== rows.length)
    throw new DrawingWorkspaceConflictError("starter catalog key가 중복되었습니다.");
  if (
    rows.length !== APPROVED_STARTERS.length ||
    rows.some((row, index) => {
      const approved = APPROVED_STARTERS[index];
      const details = APPROVED_STARTER_DETAILS[approved[0]];
      return (
        row.key !== approved[0] ||
        row.name !== approved[1] ||
        row.version !== approved[2] ||
        row.canonical_payload.key !== row.key ||
        row.canonical_payload.version !== row.version ||
        row.canonical_payload.name !== row.name ||
        row.canonical_payload.description !== row.description ||
        row.description !== details.description ||
        row.canonical_payload.layers.length !== details.layers.length ||
        row.canonical_payload.layers.some(
          (layer, layerIndex) => layer !== details.layers[layerIndex],
        )
      );
    })
  )
    throw new DrawingWorkspaceRejectedError(
      "승인된 네 개의 starter catalog가 아닙니다.",
    );
  return rows.map((row) => ({
    definition: row.canonical_payload,
    contentSha256: row.content_sha256,
  }));
}

export async function ensureDrawingStarterVersion(
  client: StarterClient,
  organizationId: string,
  projectId: string,
  key: string,
  version: 1,
) {
  const { data, error } = await client.rpc(
    "lukas_drawing_ensure_platform_starter_version",
    {
      p_organization_id: Uuid.parse(organizationId),
      p_project_id: Uuid.parse(projectId),
      p_key: StarterKey.parse(key),
      p_version: version,
    },
  );
  const ensured = EnsuredStarter.parse(starterRpcResult(data, error));
  if (
    ensured.canonicalPayload.key !== ensured.key ||
    ensured.canonicalPayload.version !== ensured.version ||
    ensured.canonicalPayload.name !== ensured.name ||
    ensured.canonicalPayload.description !== ensured.description
  )
    throw new DrawingWorkspaceConflictError(
      "starter library version payload가 일치하지 않습니다.",
    );
  return ensured;
}

export async function recordDrawingPlatformStarterImport(
  client: StarterClient,
  input: {
    organizationId: string;
    versionId: string;
    projectId: string;
    documentId: string;
    revisionId: string;
    clientRequestId: string;
  },
) {
  const parsed = z
    .object({
      organizationId: Uuid,
      versionId: Uuid,
      projectId: Uuid,
      documentId: Uuid,
      revisionId: Uuid,
      clientRequestId: Uuid,
    })
    .strict()
    .parse(input);
  const { data, error } = await client.rpc(
    "lukas_drawing_record_platform_starter_import",
    {
      p_organization_id: parsed.organizationId,
      p_version_id: parsed.versionId,
      p_project_id: parsed.projectId,
      p_document_id: parsed.documentId,
      p_revision_id: parsed.revisionId,
      p_client_request_id: parsed.clientRequestId,
    },
  );
  return StarterImportReceipt.parse(starterRpcResult(data, error));
}

function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

const allDrawingObjectKinds = [
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
] as const;

export function buildDrawingWorkspaceScaffoldOperation({
  definition,
  revisionId,
  pageId,
  canvasId,
  clientRequestId,
  createdAt,
}: {
  definition: DrawingStarterDefinition | null;
  revisionId: string;
  pageId: string;
  canvasId: string;
  clientRequestId: string;
  createdAt: string;
}): DrawingOperationInput {
  const parsedDefinition = definition
    ? DrawingStarterDefinitionSchema.parse(definition)
    : null;
  const parsedRevisionId = Uuid.parse(revisionId);
  Uuid.parse(pageId);
  const parsedCanvasId = Uuid.parse(canvasId);
  const parsedRequestId = Uuid.parse(clientRequestId);
  const parsedCreatedAt = z.string().datetime().parse(createdAt);
  const schemaInputs = [
    {
      name: "적산 분류",
      valueType: "enum",
      enumOptions: [...DRAWING_ESTIMATE_CATEGORIES],
    },
    { name: "공종", valueType: "text", enumOptions: [] },
    { name: "품목 코드", valueType: "text", enumOptions: [] },
    {
      name: "근거 상태",
      valueType: "enum",
      enumOptions: [...DRAWING_EVIDENCE_KINDS],
    },
    { name: "근거 사유", valueType: "text", enumOptions: [] },
  ] as const;
  const schemas = schemaInputs.map((schema) => ({
    id: deterministicUuid(`${parsedRequestId}:property-schema:${schema.name}`),
    revisionId: parsedRevisionId,
    name: schema.name,
    valueType: schema.valueType,
    enumOptions: schema.enumOptions,
    appliesTo: [...allDrawingObjectKinds],
    required: false,
    version: 1,
  }));
  const schemaByName = new Map(schemas.map((schema) => [schema.name, schema]));
  const putActions: Array<Record<string, unknown>> = [
    ...(parsedDefinition?.layers.map((name, index) => ({
      kind: "put_layer",
      entity: {
        id: deterministicUuid(`${parsedRequestId}:layer:${index}:${name}`),
        name,
        visible: true,
        locked: false,
        systemKind: "custom",
        canvasId: parsedCanvasId,
        sortOrder: index + 2,
        version: 1,
      },
      baseVersion: null,
    })) ?? []),
    ...schemas.map((schema) => ({
      kind: "put_property_schema",
      entity: schema,
      baseVersion: null,
    })),
  ];
  if (parsedDefinition) {
    const tableId = deterministicUuid(`${parsedRequestId}:table:기본 내역`);
    const columnInputs = [
      {
        name: "적산 분류",
        kind: "property",
        propertySchemaId: schemaByName.get("적산 분류")!.id,
      },
      {
        name: "품목 코드",
        kind: "property",
        propertySchemaId: schemaByName.get("품목 코드")!.id,
      },
      { name: "측정 종류", kind: "text", propertySchemaId: null },
      { name: "단위", kind: "text", propertySchemaId: null },
      { name: "검토 규칙", kind: "text", propertySchemaId: null },
    ] as const;
    putActions.push({
      kind: "put_table",
      entity: {
        id: tableId,
        revisionId: parsedRevisionId,
        name: parsedDefinition.table.name,
        columns: columnInputs.map((column, index) => ({
          id: deterministicUuid(
            `${parsedRequestId}:table-column:${index}:${column.name}`,
          ),
          ...column,
        })),
        rows: [],
        version: 1,
      },
      baseVersion: null,
    });
  }
  const inverseActions = [...putActions].reverse().map((action) => ({
    kind: String(action.kind).replace(/^put_/, "delete_"),
    id: (action.entity as { id: string }).id,
    baseVersion: 1,
  }));
  return {
    clientOperationId: deterministicUuid(`${parsedRequestId}:scaffold`),
    revisionId: parsedRevisionId,
    type: "mutate_structure",
    baseVersions: {},
    forward: { type: "mutate_structure", actions: putActions },
    inverse: { type: "mutate_structure", actions: inverseActions },
    createdAt: parsedCreatedAt,
  } as DrawingOperationInput;
}

const CreationResult = z
  .object({
    documentId: Uuid,
    revisionId: Uuid,
    pageId: Uuid,
    canvasId: Uuid,
  })
  .passthrough();

export async function createDrawingWorkspaceStart(
  client: StarterClient,
  input: {
    organizationId: string;
    projectId: string;
    title: string;
    sourceFile: { id: string; kind: "pdf" } | null;
    definition: DrawingStarterDefinition | null;
    starterVersion?: 1;
    clientRequestId: string;
    clientCreatedAt: string;
  },
) {
  const definition = input.definition
    ? DrawingStarterDefinitionSchema.parse(input.definition)
    : null;
  const ensured = definition
    ? await ensureDrawingStarterVersion(
        client,
        input.organizationId,
        input.projectId,
        definition.key,
        input.starterVersion ?? definition.version,
      )
    : null;
  const created = CreationResult.parse(
    await createDrawingDocumentIdempotent(client, input.projectId, {
      title: input.title,
      mode: input.sourceFile ? "pdf_background" : "blank",
      sourceFile: input.sourceFile,
      clientRequestId: input.clientRequestId,
      ...(ensured ? { libraryVersionId: ensured.versionId } : {}),
    }),
  );
  const operation = buildDrawingWorkspaceScaffoldOperation({
    definition: ensured?.canonicalPayload ?? null,
    revisionId: created.revisionId,
    pageId: created.pageId,
    canvasId: created.canvasId,
    clientRequestId: input.clientRequestId,
    createdAt: input.clientCreatedAt,
  });
  await applyDrawingOperation(client, operation);
  const starterImport = ensured
    ? await recordDrawingPlatformStarterImport(client, {
        organizationId: input.organizationId,
        versionId: ensured.versionId,
        projectId: input.projectId,
        documentId: created.documentId,
        revisionId: created.revisionId,
        clientRequestId: input.clientRequestId,
      })
    : null;
  return { ...created, operation, starterImport };
}
