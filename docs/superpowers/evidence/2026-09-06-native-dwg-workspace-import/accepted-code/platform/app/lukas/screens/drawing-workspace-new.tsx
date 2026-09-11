import type { Route } from "./+types/drawing-workspace-new";

import { data, redirect } from "react-router";
import { z } from "zod";

import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { DrawingWorkspaceStart } from "~/lukas/components/drawing-workspace-start";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import {
  createDrawingWorkspaceStart,
  loadDrawingStarterCatalog,
} from "~/lukas/lib/drawing-starter-templates.server";
import {
  type DrawingStarterDefinition,
  DrawingStarterDefinitionSchema,
} from "~/lukas/lib/drawing-starter-templates";
import { DrawingWorkspaceConflictError } from "~/lukas/lib/drawing-workspace.server";
import { importNativeDrawingAsset, loadNativeDrawingCatalog } from "~/lukas/lib/drawing-native-catalog.server";
import { listNativeDrawingTemplateKeys } from "~/lukas/lib/drawing-native-templates";
import {
  listOrganizationDrawingLibrary,
  runOrganizationDrawingLibraryMutation,
} from "~/lukas/lib/organization-drawing-library.server";
import { drawingWorkspacePath } from "~/lukas/lib/drawing-workspace-paths";

const Uuid = z.string().uuid();
const Title = z.string().trim().min(1, "작업실 이름을 입력하세요.").max(240);
const StarterKey = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const StartMutation = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("create_native_template"),
    nativeKey: z.string().refine(key => listNativeDrawingTemplateKeys().some(candidate => candidate === key)),
    nativeVersion: z.literal(1),
    clientRequestId: Uuid,
  }).strict(),
  z
    .object({
      intent: z.literal("create_blank"),
      title: Title,
      clientRequestId: Uuid,
      clientCreatedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      intent: z.literal("create_starter"),
      title: Title,
      starterKey: StarterKey,
      starterVersion: z.literal(1),
      clientRequestId: Uuid,
      clientCreatedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      intent: z.literal("create_pdf"),
      title: Title,
      sourceFileId: Uuid,
      clientRequestId: Uuid,
      clientCreatedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      intent: z.literal("create_ifc"),
      title: Title,
      sourceFileId: Uuid,
      clientRequestId: Uuid,
      clientCreatedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      intent: z.literal("create_dxf"),
      title: Title,
      sourceFileId: Uuid,
      clientRequestId: Uuid,
      clientCreatedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      intent: z.literal("create_dwg"),
      title: Title,
      sourceFileId: Uuid,
      clientRequestId: Uuid,
      clientCreatedAt: z.string().datetime(),
    })
    .strict(),
  z
    .object({
      intent: z.literal("create_library_template"),
      libraryVersionId: Uuid,
      clientRequestId: Uuid,
    })
    .strict(),
]);

type StartMutation = z.infer<typeof StartMutation>;

export function parseDrawingWorkspaceStartForm(form: FormData): StartMutation {
  const entries = [...form.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length)
    throw new Error("중복 입력 필드는 허용되지 않습니다.");
  const value: Record<string, unknown> = Object.fromEntries(entries);
  if (value.starterVersion !== undefined)
    value.starterVersion = Number(value.starterVersion);
  if (value.nativeVersion !== undefined)
    value.nativeVersion = Number(value.nativeVersion);
  const parsed = StartMutation.safeParse(value);
  if (!parsed.success) {
    const unexpected = parsed.error.issues.some(
      (issue) => issue.code === "unrecognized_keys",
    );
    if (unexpected) throw new Error("허용되지 않은 입력 필드입니다.");
    throw parsed.error;
  }
  return parsed.data;
}

async function projectOrganization(client: any, projectId: string) {
  const { data: project, error } = await client
    .from("lukas_qto_projects")
    .select("id,organization_id")
    .eq("id", projectId)
    .single();
  if (error || !project?.organization_id)
    throw new Response("프로젝트 조직을 찾을 수 없습니다.", { status: 404 });
  return project.organization_id as string;
}

function requestPair(includeCreatedAt = true) {
  return {
    clientRequestId: crypto.randomUUID(),
    ...(includeCreatedAt ? { clientCreatedAt: new Date().toISOString() } : {}),
  };
}

const START_CATALOG_FAILURE_NOTICES = {
  nativeTemplates: "예제 도면을 불러오지 못했습니다. 빈 작업실로 시작하거나 다시 시도하세요.",
  organizationTemplates:
    "회사 템플릿을 불러오지 못했습니다. 빈 작업실이나 PDF로 시작해 주세요.",
  starters:
    "기본 템플릿을 불러오지 못했습니다. 빈 작업실이나 PDF로 시작해 주세요.",
} as const;

async function optionalStartCatalog<T>(
  catalog: PromiseLike<T[]>,
  failureNotice: string,
) {
  try {
    return { items: await catalog, notice: null };
  } catch {
    return { items: [] as T[], notice: failureNotice };
  }
}

export async function resolveDrawingWorkspaceStartResources<
  TLibraryVersion,
  TStarter,
  TNativeTemplate,
>({
  documents,
  files,
  libraryVersions,
  starters,
  nativeTemplates = Promise.resolve([]),
}: {
  documents: PromiseLike<{ data: any[] | null; error: any }>;
  files: PromiseLike<{ data: any[] | null; error: any }>;
  libraryVersions: PromiseLike<TLibraryVersion[]>;
  starters: PromiseLike<TStarter[]>;
  nativeTemplates?: PromiseLike<TNativeTemplate[]>;
}) {
  const [resolvedFiles, resolvedDocuments, starterCatalog, libraryCatalog, nativeCatalog] =
    await Promise.all([
      files,
      documents,
      optionalStartCatalog(starters, START_CATALOG_FAILURE_NOTICES.starters),
      optionalStartCatalog(
        libraryVersions,
        START_CATALOG_FAILURE_NOTICES.organizationTemplates,
      ),
      optionalStartCatalog(nativeTemplates, START_CATALOG_FAILURE_NOTICES.nativeTemplates),
    ]);
  return {
    catalogNotices: {
      organizationTemplates: libraryCatalog.notice,
      starters: starterCatalog.notice,
      nativeTemplates: nativeCatalog.notice,
    },
    documents: resolvedDocuments,
    files: resolvedFiles,
    libraryVersions: libraryCatalog.items,
    starters: starterCatalog.items,
    nativeTemplates: nativeCatalog.items,
  };
}

export function bindDrawingWorkspacePdfSources<
  TFile extends { id: string },
  TDocument extends { id: string; source_file_id: string | null },
>(files: TFile[], documents: TDocument[]) {
  const workspaceBySource = new Map(
    documents.flatMap((document) =>
      document.source_file_id
        ? [[document.source_file_id, document.id] as const]
        : [],
    ),
  );
  return files.map((file) => ({
    ...file,
    workspaceId: workspaceBySource.get(file.id) ?? null,
  }));
}

async function existingPdfWorkspace(
  client: any,
  projectId: string,
  sourceFileId: string,
) {
  const { data: document, error } = await client
    .from("lukas_drawing_documents")
    .select("id,creation_request_id")
    .eq("project_id", projectId)
    .eq("source_file_id", sourceFileId)
    .maybeSingle();
  if (error)
    throw new Error(`PDF 작업실을 확인하지 못했습니다: ${error.message}`);
  return document as {
    id: string;
    creation_request_id: string | null;
  } | null;
}

export function reusablePdfWorkspaceId(
  existing: { id: string; creation_request_id: string | null } | null,
  clientRequestId: string,
) {
  return existing && existing.creation_request_id !== clientRequestId
    ? existing.id
    : null;
}

export function resolveDrawingStarterSelection(
  requestedKey: string | null,
  starters: readonly DrawingStarterDefinition[],
  catalogUnavailable: boolean,
) {
  if (requestedKey === null) return undefined;
  if (!StarterKey.safeParse(requestedKey).success)
    throw new Response("선택한 템플릿을 사용할 수 없습니다.", {
      status: 400,
    });
  if (starters.some((starter) => starter.key === requestedKey))
    return requestedKey;
  if (catalogUnavailable) return undefined;
  throw new Response("선택한 템플릿을 사용할 수 없습니다.", {
    status: 400,
  });
}

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.project
      ? `${page.project.name} 새 작업실 | 1HK Platform`
      : "새 작업실 | 1HK Platform",
  },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project, role } = await drawingContext(
    request,
    params.projectId!,
  );
  try {
    if (!["owner", "staff", "estimator"].includes(role))
      throw new Response("작업실을 만들 권한이 없습니다.", { status: 403 });
    const organizationId = await projectOrganization(client, project.id);
    const {
      catalogNotices,
      documents: { data: documents, error: documentsError },
      files: { data: files, error: filesError },
      libraryVersions,
      starters,
      nativeTemplates,
    } = await resolveDrawingWorkspaceStartResources({
      nativeTemplates: loadNativeDrawingCatalog(client as any, project.id, "workspace_template"),
      files: client
        .from("lukas_qto_files")
        .select(
          "id,project_id,kind,original_filename,sha256,immutable,created_at",
        )
        .eq("project_id", project.id)
        .in("kind", ["pdf", "ifc", "dxf", "dwg"])
        .eq("immutable", true)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false }),
      documents: (client as any)
        .from("lukas_drawing_documents")
        .select("id,source_file_id")
        .eq("project_id", project.id)
        .not("source_file_id", "is", null),
      starters: loadDrawingStarterCatalog(
        client as any,
        organizationId,
        project.id,
      ),
      libraryVersions: listOrganizationDrawingLibrary(
        client as any,
        organizationId,
        {
          kind: "workspace_template",
          status: "published",
        },
      ),
    });
    if (filesError || documentsError)
      throw new Response("프로젝트 PDF를 불러오지 못했습니다.", {
        status: 500,
      });
    const drawingSources = bindDrawingWorkspacePdfSources(
      files ?? [],
      documents ?? [],
    );
    const organizationTemplates = libraryVersions.filter(
      (version) => version.source_kind === "project_revision",
    );
    const url = new URL(request.url);
    const sourceFileId = url.searchParams.get("sourceFileId");
    const starterKey = url.searchParams.get("starterKey");
    for (const key of url.searchParams.keys())
      if (key !== "sourceFileId" && key !== "starterKey")
        throw new Response("시작 화면 주소가 올바르지 않습니다.", {
          status: 400,
        });
    if (
      sourceFileId &&
      (!Uuid.safeParse(sourceFileId).success ||
        !drawingSources.some((file: any) => file.id === sourceFileId))
    )
      throw new Response("선택한 도면 원본을 사용할 수 없습니다.", {
        status: 400,
      });
    const selectedStarterKey = resolveDrawingStarterSelection(
      starterKey,
      starters.map((starter) => starter.definition),
      catalogNotices.starters !== null,
    );
    return data(
      {
        project,
        capability: role === "owner" || role === "staff" ? "admin" : "editor",
        catalogNotices,
        files: drawingSources,
        starters,
        nativeTemplates: nativeTemplates.map(({ key, version, name, description }) => ({ key, version, name, description })),
        organizationTemplates,
        sourceFileId: sourceFileId ?? undefined,
        starterKey: selectedStarterKey,
        requestPairs: {
          nativeTemplates: Object.fromEntries(nativeTemplates.map(template => [template.key, requestPair(false)])),
          blank: requestPair(),
          pdfs: Object.fromEntries(
            drawingSources.flatMap((file: any) =>
              file.workspaceId ? [] : [[file.id, requestPair()]],
            ),
          ),
          starters: Object.fromEntries(
            starters.map((starter) => [starter.definition.key, requestPair()]),
          ),
          libraryTemplates: Object.fromEntries(
            organizationTemplates.map((template) => [
              template.id,
              requestPair(false),
            ]),
          ),
        },
      },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw mergeResponseHeaders(error, headers);
    throw error;
  }
}

function actionIdentity(mutation: StartMutation | null) {
  return {
    clientRequestId: mutation?.clientRequestId ?? null,
    clientCreatedAt:
      mutation && "clientCreatedAt" in mutation
        ? mutation.clientCreatedAt
        : null,
  };
}

function submittedActionIdentity(form: FormData) {
  const clientRequestId = form.get("clientRequestId");
  const clientCreatedAt = form.get("clientCreatedAt");
  return {
    clientRequestId:
      typeof clientRequestId === "string" &&
      Uuid.safeParse(clientRequestId).success
        ? clientRequestId
        : null,
    clientCreatedAt:
      typeof clientCreatedAt === "string" &&
      z.string().datetime().safeParse(clientCreatedAt).success
        ? clientCreatedAt
        : null,
  };
}

function boundedActionError(error: unknown) {
  if (error instanceof z.ZodError) {
    const flattened = error.flatten().fieldErrors;
    return {
      fieldErrors: Object.fromEntries(
        Object.entries(flattened).flatMap(([key, messages]) =>
          messages?.[0] ? [[key, messages[0]]] : [],
        ),
      ),
      formError: "입력값을 확인하세요.",
    };
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "DrawingWorkspaceConflictError")
    return {
      fieldErrors: {},
      formError: "같은 요청의 기존 내용과 일치하지 않습니다.",
    };
  if (name === "DrawingWorkspaceRejectedError")
    return { fieldErrors: {}, formError: "이 작업실을 만들 수 없습니다." };
  if (name === "DrawingWorkspaceRetryableError")
    return {
      fieldErrors: {},
      formError: "잠시 후 같은 요청으로 다시 시도하세요.",
    };
  return {
    fieldErrors: {},
    formError: "작업실 만들기를 완료하지 못했습니다.",
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project, role } = await drawingContext(
    request,
    params.projectId!,
  );
  let mutation: StartMutation | null = null;
  const form = await request.formData();
  const submittedIdentity = submittedActionIdentity(form);
  try {
    mutation = parseDrawingWorkspaceStartForm(form);
  } catch (error) {
    const failure = boundedActionError(error);
    return data(
      { ok: false as const, ...failure, ...submittedIdentity },
      { status: 400, headers },
    );
  }
  if (!["owner", "staff", "estimator"].includes(role))
    return data(
      {
        ok: false as const,
        fieldErrors: {},
        formError: "작업실을 만들 권한이 없습니다.",
        ...actionIdentity(mutation),
      },
      { status: 400, headers },
    );
  const organizationId = await projectOrganization(client, project.id);
  try {
    if (mutation.intent === "create_native_template") {
      const result = await importNativeDrawingAsset(client as any, {
        projectId: project.id, revisionId: null, kind: "workspace_template",
        key: mutation.nativeKey, version: mutation.nativeVersion, clientRequestId: mutation.clientRequestId,
      });
      if (!("documentId" in result)) throw new Error("예제 도면 생성 결과가 올바르지 않습니다.");
      return redirect(drawingWorkspacePath(project.id, result.documentId), { headers });
    }
    if (mutation.intent === "create_library_template") {
      const result = await runOrganizationDrawingLibraryMutation(
        client as any,
        organizationId,
        {
          intent: "import",
          versionId: mutation.libraryVersionId,
          projectId: project.id,
          revisionId: null,
          clientRequestId: mutation.clientRequestId,
        },
      );
      const documentId = Uuid.parse(result.documentId);
      return redirect(drawingWorkspacePath(project.id, documentId), {
        headers,
      });
    }
    let sourceFile: { id: string; kind: "pdf" | "ifc" } | null = null;
    let definition: DrawingStarterDefinition | null = null;
    if (
      mutation.intent === "create_pdf" ||
      mutation.intent === "create_ifc" ||
      mutation.intent === "create_dxf" ||
      mutation.intent === "create_dwg"
    ) {
      const expectedKind = mutation.intent.replace("create_", "") as
        | "pdf"
        | "ifc"
        | "dxf"
        | "dwg";
      const { data: file, error: fileError } = await client
        .from("lukas_qto_files")
        .select("id,project_id,kind,immutable")
        .eq("id", mutation.sourceFileId)
        .eq("project_id", project.id)
        .eq("kind", expectedKind)
        .eq("immutable", true)
        .maybeSingle();
      if (fileError || !file) throw new Error("Selected source is unavailable");
      if (expectedKind !== "dxf" && expectedKind !== "dwg") {
        const existing = await existingPdfWorkspace(
          client,
          project.id,
          mutation.sourceFileId,
        );
        const reusableWorkspaceId = reusablePdfWorkspaceId(
          existing,
          mutation.clientRequestId,
        );
        if (reusableWorkspaceId)
          return redirect(
            drawingWorkspacePath(project.id, reusableWorkspaceId),
            { headers },
          );
        sourceFile = { id: Uuid.parse(file.id), kind: expectedKind };
      }
    }
    if (mutation.intent === "create_starter") {
      const starters = await loadDrawingStarterCatalog(
        client as any,
        organizationId,
        project.id,
      );
      const selected = starters.find(
        (starter) =>
          starter.definition.key === mutation.starterKey &&
          starter.definition.version === mutation.starterVersion,
      );
      if (!selected) throw new Error("Selected starter is unavailable");
      definition = DrawingStarterDefinitionSchema.parse(selected.definition);
    }
    const created = await createDrawingWorkspaceStart(client as any, {
      organizationId,
      projectId: project.id,
      title: mutation.title,
      sourceFile,
      definition,
      ...(mutation.intent === "create_starter"
        ? { starterVersion: mutation.starterVersion }
        : {}),
      clientRequestId: mutation.clientRequestId,
      clientCreatedAt: mutation.clientCreatedAt,
    });
    const destination = new URL(
      drawingWorkspacePath(project.id, created.documentId),
      request.url,
    );
    if (mutation.intent === "create_ifc") {
      destination.searchParams.set("ifc", mutation.sourceFileId);
      destination.searchParams.set("view", "3d");
    }
    if (mutation.intent === "create_dxf")
      destination.searchParams.set("dxfSourceFileId", mutation.sourceFileId);
    if (mutation.intent === "create_dwg")
      destination.searchParams.set("dwgSourceFileId", mutation.sourceFileId);
    return redirect(`${destination.pathname}${destination.search}`, {
      headers,
    });
  } catch (error) {
    if (
      (mutation.intent === "create_pdf" || mutation.intent === "create_ifc") &&
      error instanceof DrawingWorkspaceConflictError
    ) {
      try {
        const reusableWorkspaceId = reusablePdfWorkspaceId(
          await existingPdfWorkspace(client, project.id, mutation.sourceFileId),
          mutation.clientRequestId,
        );
        if (reusableWorkspaceId)
          return redirect(
            drawingWorkspacePath(project.id, reusableWorkspaceId),
            { headers },
          );
      } catch {
        // Preserve the original bounded conflict when the recovery lookup fails.
      }
    }
    const failure = boundedActionError(error);
    return data(
      { ok: false as const, ...failure, ...actionIdentity(mutation) },
      { status: 400, headers },
    );
  }
}

export default function DrawingWorkspaceNew({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  return (
    <DrawingWorkspaceStart
      actionData={actionData as any}
      loaderData={loaderData}
    />
  );
}
