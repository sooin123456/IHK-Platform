import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  DrawingBlockSchema,
  DrawingPropertySchemaSchema,
  DrawingStyleDefinitionSchema,
} from "./drawing-workspace.types.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const Kind = z.enum([
  "style",
  "block",
  "property_schema",
  "workspace_template",
]);
const Status = z.enum(["draft", "published", "deprecated"]);

export const ORGANIZATION_LIBRARY_LIST_LIMIT = 100;

const createDraftFields = new Set([
  "intent",
  "kind",
  "name",
  "source_revision_id",
  "source_entity_id",
  "predecessor_version_id",
]);
const versionFields = new Set(["intent", "version_id"]);
const importFields = new Set([
  "intent",
  "version_id",
  "project_id",
  "revision_id",
  "client_request_id",
]);

function exactFields(form: FormData, allowed: ReadonlySet<string>) {
  for (const key of form.keys())
    if (!allowed.has(key)) throw new Error(`허용되지 않은 필드입니다: ${key}`);
}

export function parseOrganizationDrawingLibraryForm(form: FormData) {
  const intent = String(form.get("intent") ?? "");
  if (intent === "create_draft") {
    exactFields(form, createDraftFields);
    const parsed = z
      .object({
        kind: Kind,
        name: z.string().trim().min(1).max(255),
        sourceRevisionId: Uuid,
        sourceEntityId: Uuid.nullable(),
        predecessorVersionId: Uuid.nullable(),
      })
      .superRefine((value, context) => {
        if (
          (value.kind === "workspace_template") !==
          (value.sourceEntityId === null)
        )
          context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sourceEntityId"],
            message: "원본 객체 선택이 올바르지 않습니다.",
          });
      })
      .parse({
        kind: form.get("kind"),
        name: form.get("name"),
        sourceRevisionId: form.get("source_revision_id"),
        sourceEntityId: form.get("source_entity_id") || null,
        predecessorVersionId: form.get("predecessor_version_id") || null,
      });
    return { intent, ...parsed } as const;
  }
  if (intent === "publish" || intent === "deprecate") {
    exactFields(form, versionFields);
    return {
      intent,
      versionId: Uuid.parse(form.get("version_id")),
    } as const;
  }
  if (intent === "import") {
    exactFields(form, importFields);
    return {
      intent,
      versionId: Uuid.parse(form.get("version_id")),
      projectId: Uuid.parse(form.get("project_id")),
      revisionId: form.get("revision_id")
        ? Uuid.parse(form.get("revision_id"))
        : null,
      clientRequestId: Uuid.parse(form.get("client_request_id")),
    } as const;
  }
  throw new Error("회사 라이브러리 작업이 올바르지 않습니다.");
}

export function parseOrganizationDrawingLibrarySearch(search: URLSearchParams) {
  const allowed = new Set(["kind", "status"]);
  for (const key of search.keys())
    if (!allowed.has(key))
      throw new Error("회사 라이브러리 필터가 올바르지 않습니다.");
  const parsed = z
    .object({ kind: Kind.optional(), status: Status.optional() })
    .safeParse({
      kind: search.get("kind") || undefined,
      status: search.get("status") || undefined,
    });
  if (!parsed.success)
    throw new Error("회사 라이브러리 필터가 올바르지 않습니다.");
  return parsed.data;
}

const WorkspaceTemplatePayload = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    revision: z.record(z.string(), z.unknown()),
    pages: z.array(z.unknown()),
    layers: z.array(z.unknown()),
    objects: z.array(z.unknown()),
    operationSequence: z.number().int().nonnegative(),
  })
  .passthrough();

export function parseOrganizationLibraryCanonicalPayload(
  kind: z.infer<typeof Kind>,
  payload: unknown,
) {
  if (kind === "style") return DrawingStyleDefinitionSchema.parse(payload);
  if (kind === "block") return DrawingBlockSchema.parse(payload);
  if (kind === "property_schema")
    return DrawingPropertySchemaSchema.parse(payload);
  return WorkspaceTemplatePayload.parse(payload);
}

const EntryRow = z
  .object({
    id: Uuid,
    organization_id: Uuid,
    kind: Kind,
    name: z.string().min(1),
    created_by: Uuid,
    created_at: z.string(),
  })
  .strict();
const VersionRow = z
  .object({
    id: Uuid,
    registry_id: Uuid,
    organization_id: Uuid,
    version_no: z.coerce.number().int().positive(),
    status: Status,
    canonical_payload: z.unknown(),
    content_sha256: Sha256,
    predecessor_version_id: Uuid.nullable(),
    source_project_id: Uuid,
    source_revision_id: Uuid,
    source_entity_id: Uuid.nullable(),
    created_by: Uuid,
    published_by: Uuid.nullable(),
    created_at: z.string(),
    published_at: z.string().nullable(),
    deprecated_at: z.string().nullable(),
  })
  .strict();

type LibraryClient = SupabaseClient<any>;

export async function listOrganizationDrawingLibrary(
  client: LibraryClient,
  organizationId: string,
  filters: ReturnType<typeof parseOrganizationDrawingLibrarySearch>,
) {
  let entriesQuery = client
    .from("lukas_drawing_library_entries")
    .select("id,organization_id,kind,name,created_by,created_at")
    .eq("organization_id", Uuid.parse(organizationId))
    .order("name")
    .order("id")
    .limit(ORGANIZATION_LIBRARY_LIST_LIMIT);
  if (filters.kind) entriesQuery = entriesQuery.eq("kind", filters.kind);
  const entriesResult = await entriesQuery;
  if (entriesResult.error)
    throw new Error(
      `회사 라이브러리를 불러오지 못했습니다: ${entriesResult.error.message}`,
    );
  const entries = z.array(EntryRow).parse(entriesResult.data ?? []);
  if (entries.length === 0) return [];
  let versionsQuery = client
    .from("lukas_drawing_library_versions")
    .select(
      "id,registry_id,organization_id,version_no,status,canonical_payload,content_sha256,predecessor_version_id,source_project_id,source_revision_id,source_entity_id,created_by,published_by,created_at,published_at,deprecated_at",
    )
    .eq("organization_id", organizationId)
    .in(
      "registry_id",
      entries.map((entry) => entry.id),
    )
    .order("version_no", { ascending: false })
    .order("id")
    .limit(ORGANIZATION_LIBRARY_LIST_LIMIT);
  if (filters.status)
    versionsQuery = versionsQuery.eq("status", filters.status);
  const versionsResult = await versionsQuery;
  if (versionsResult.error)
    throw new Error(
      `회사 라이브러리 버전을 불러오지 못했습니다: ${versionsResult.error.message}`,
    );
  const versions = z.array(VersionRow).parse(versionsResult.data ?? []);
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  return versions.map((version) => {
    const entry = entryById.get(version.registry_id);
    if (!entry || entry.organization_id !== version.organization_id)
      throw new Error("회사 라이브러리 계보가 올바르지 않습니다.");
    return {
      ...version,
      entry,
      canonical_payload: parseOrganizationLibraryCanonicalPayload(
        entry.kind,
        version.canonical_payload,
      ),
    };
  });
}

export async function runOrganizationDrawingLibraryMutation(
  client: LibraryClient,
  organizationId: string,
  mutation: ReturnType<typeof parseOrganizationDrawingLibraryForm>,
) {
  const rpc =
    mutation.intent === "create_draft"
      ? client.rpc("lukas_drawing_create_library_draft", {
          p_organization_id: Uuid.parse(organizationId),
          p_kind: mutation.kind,
          p_name: mutation.name,
          p_source_revision_id: mutation.sourceRevisionId,
          p_source_entity_id: mutation.sourceEntityId,
          p_predecessor_version_id: mutation.predecessorVersionId,
        })
      : mutation.intent === "publish"
        ? client.rpc("lukas_drawing_publish_library_version", {
            p_version_id: mutation.versionId,
          })
        : mutation.intent === "deprecate"
          ? client.rpc("lukas_drawing_deprecate_library_version", {
              p_version_id: mutation.versionId,
            })
          : client.rpc("lukas_drawing_import_library_version", {
              p_version_id: mutation.versionId,
              p_project_id: mutation.projectId,
              p_revision_id: mutation.revisionId,
              p_client_request_id: mutation.clientRequestId,
            });
  const { data, error } = await rpc;
  if (error) throw new Error(error.message);
  return z.record(z.string(), z.unknown()).parse(data);
}
