import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  getNativeDrawingSymbol,
  listNativeDrawingSymbols,
  nativeAssetCanonicalJson,
} from "./drawing-native-symbols.ts";
import {
  buildNativeDrawingTemplate,
  listNativeDrawingTemplateKeys,
  type NativeDrawingTemplateKey,
} from "./drawing-native-templates.ts";
import {
  DrawingWorkspaceRejectedError,
  drawingWorkspaceRpcResult,
} from "./drawing-workspace.server.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Kind = z.enum(["workspace_template", "block"]);
type NativeKind = z.infer<typeof Kind>;
type Client = SupabaseClient<any>;

export function nativeDrawingDefinition(
  kind: NativeKind,
  key: string,
  version: number,
) {
  if (version !== 1) throw new Error("기본 도면 버전을 사용할 수 없습니다.");
  if (kind === "block") return getNativeDrawingSymbol(key);
  if (
    !listNativeDrawingTemplateKeys().includes(key as NativeDrawingTemplateKey)
  )
    throw new Error("기본 도면을 찾을 수 없습니다.");
  return buildNativeDrawingTemplate(key as NativeDrawingTemplateKey);
}

export function parseNativeDrawingDefinition(kind: NativeKind, value: unknown) {
  const identity = z
    .object({ key: z.string(), version: z.literal(1) })
    .parse(value);
  const authored = nativeDrawingDefinition(
    kind,
    identity.key,
    identity.version,
  );
  if (nativeAssetCanonicalJson(value) !== nativeAssetCanonicalJson(authored))
    throw new Error("기본 도면 내용이 배포된 버전과 일치하지 않습니다.");
  return authored;
}

const CatalogRow = z
  .object({
    kind: Kind,
    key: z.string(),
    version: z.literal(1),
    name: z.string(),
    description: z.string(),
    definition: z.unknown(),
    contentSha256: Sha256,
    artifactSha256: Sha256,
  })
  .strict();

export async function loadNativeDrawingCatalog(
  client: Client,
  projectId: string,
  kind: NativeKind,
) {
  const { data, error } = await client.rpc("lukas_drawing_list_native_assets", {
    p_project_id: Uuid.parse(projectId),
    p_kind: Kind.parse(kind),
  });
  if (error) throw new Error("기본 도면 목록을 불러오지 못했습니다.");
  const rows = z.array(CatalogRow).parse(data);
  const expectedKeys =
    kind === "block"
      ? listNativeDrawingSymbols().map((symbol) => symbol.key)
      : listNativeDrawingTemplateKeys();
  if (
    rows.length !== expectedKeys.length ||
    new Set(rows.map((row) => row.key)).size !== rows.length
  )
    throw new Error("기본 도면 목록이 배포된 버전과 일치하지 않습니다.");
  return rows.map((row) => {
    const definition = parseNativeDrawingDefinition(kind, row.definition);
    // Artifact bytes use sorted compact JSON. contentSha256 belongs to PostgreSQL
    // jsonb::text and is checked by SQL; these digest domains are not interchangeable.
    const artifactSha256 = createHash("sha256")
      .update(nativeAssetCanonicalJson(definition))
      .digest("hex");
    if (
      row.kind !== kind ||
      row.key !== definition.key ||
      row.version !== definition.version ||
      row.name !== definition.name ||
      row.description !== definition.description ||
      row.artifactSha256 !== artifactSha256
    )
      throw new Error("기본 도면 식별 정보가 일치하지 않습니다.");
    return { ...row, definition };
  });
}

const ImportInput = z
  .object({
    projectId: Uuid,
    revisionId: Uuid.nullable(),
    kind: Kind,
    key: z.string(),
    version: z.literal(1),
    clientRequestId: Uuid,
  })
  .strict();
const TemplateReceipt = z
  .object({
    importId: Uuid,
    documentId: Uuid,
    revisionId: Uuid,
    contentSha256: Sha256,
  })
  .strict();
const BlockReceipt = z
  .object({
    importId: Uuid,
    targetEntityId: Uuid,
    revisionId: Uuid,
    contentSha256: Sha256,
  })
  .strict();

export async function importNativeDrawingAsset(
  client: Client,
  input: z.infer<typeof ImportInput>,
) {
  const parsed = ImportInput.parse(input);
  nativeDrawingDefinition(parsed.kind, parsed.key, parsed.version);
  if ((parsed.kind === "workspace_template") !== (parsed.revisionId === null))
    throw new Error("기본 도면을 가져올 개정이 올바르지 않습니다.");
  const { data, error } = await client.rpc(
    "lukas_drawing_import_native_asset",
    {
      p_project_id: parsed.projectId,
      p_revision_id: parsed.revisionId,
      p_kind: parsed.kind,
      p_asset_key: parsed.key,
      p_asset_version: parsed.version,
      p_client_request_id: parsed.clientRequestId,
    },
  );
  const receipt = drawingWorkspaceRpcResult(data, error);
  const result =
    parsed.kind === "workspace_template"
      ? TemplateReceipt.parse(receipt)
      : BlockReceipt.parse(receipt);
  if (parsed.revisionId && result.revisionId !== parsed.revisionId)
    throw new Error("기본 도면 가져오기 결과가 대상 개정과 일치하지 않습니다.");
  return result;
}

export function parseNativeDrawingSymbolForm(form: FormData) {
  const entries = [...form.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw new Error("중복 입력 필드는 허용되지 않습니다.");
  const parsed = z
    .object({
      intent: z.literal("import_native_symbol"),
      key: z.string(),
      version: z.literal("1"),
      revisionId: Uuid,
      clientRequestId: Uuid,
    })
    .strict()
    .parse(Object.fromEntries(entries));
  nativeDrawingDefinition("block", parsed.key, 1);
  return { ...parsed, version: 1 as const };
}

export async function importNativeDrawingSymbolFromWorkspace(
  client: Client,
  input: {
    projectId: string;
    capability: string;
    revision: { id: string; status: string } | null;
    form: FormData;
  },
) {
  const mutation = parseNativeDrawingSymbolForm(input.form);
  if (
    !["admin", "editor"].includes(input.capability) ||
    input.revision?.id !== mutation.revisionId
  )
    throw new DrawingWorkspaceRejectedError(
      "기본 심볼을 가져올 편집 권한이 없습니다.",
    );
  // SQL replays an existing actor-bound receipt before enforcing draft-only
  // new writes, so a lost successful response remains recoverable after review.
  return importNativeDrawingAsset(client, {
    projectId: input.projectId,
    revisionId: mutation.revisionId,
    kind: "block",
    key: mutation.key,
    version: mutation.version,
    clientRequestId: mutation.clientRequestId,
  });
}
