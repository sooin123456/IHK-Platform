import type { Route } from "./+types/drawing-workspace";

import { ArrowLeft } from "lucide-react";
import { Form, Link, data } from "react-router";
import { z } from "zod";

import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import {
  DrawingWorkspaceRpcError,
  applyDrawingOperation,
  createDrawingDocument,
  loadDrawingWorkspace,
  loadDrawingWorkspaceCapability,
  parseWorkspaceMutation,
  recordDrawingRevisionDecision,
  requestDrawingReview,
} from "~/lukas/lib/drawing-workspace.server";
import type {
  DrawingWorkspaceCapability,
  DrawingWorkspaceClient,
} from "~/lukas/lib/drawing-workspace.server";
import { DrawingOperationInputSchema } from "~/lukas/lib/drawing-workspace.types";

export const meta: Route.MetaFunction = ({ data: page }) => [
  {
    title: page?.workspace?.file
      ? `${page.workspace.file.original_filename} | 도면 편집 작업실 | 1HK Platform`
      : "도면 편집 작업실 | 1HK Platform",
  },
];

function canEdit(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "editor";
}

function canReview(capability: DrawingWorkspaceCapability) {
  return capability === "admin" || capability === "reviewer";
}

async function workspaceContext(request: Request, projectId: string) {
  const context = await drawingContext(request, projectId);
  const client = context.client as unknown as DrawingWorkspaceClient;
  const capability = await loadDrawingWorkspaceCapability(
    client,
    context.project.id,
    context.user.id,
    context.project.owner_id,
  );
  if (!capability)
    throw new Response("도면 작업 권한이 없습니다.", { status: 403 });
  return { ...context, client, capability };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { client, headers, project, user, capability } = await workspaceContext(
    request,
    params.projectId!,
  );
  const workspace = await loadDrawingWorkspace(
    client,
    project.id,
    params.fileId!,
  );
  return data(
    { project, currentUserId: user.id, capability, workspace },
    { headers },
  );
}

const DocumentModeSchema = z.enum(["blank", "pdf_background"]);

function currentRevisionId(
  workspace: Awaited<ReturnType<typeof loadDrawingWorkspace>>,
) {
  if (!workspace.document) throw new Error("먼저 도면 문서를 만들어야 합니다.");
  return workspace.document.revision.id;
}

function assertCurrentRevision(
  workspace: Awaited<ReturnType<typeof loadDrawingWorkspace>>,
  revisionId: string,
) {
  if (currentRevisionId(workspace) !== revisionId)
    throw new Error("현재 파일의 도면 리비전과 요청이 일치하지 않습니다.");
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project, capability } = await workspaceContext(
    request,
    params.projectId!,
  );
  try {
    const workspace = await loadDrawingWorkspace(
      client,
      project.id,
      params.fileId!,
    );
    const form = await request.formData();
    const mutation = parseWorkspaceMutation(form);
    let result: unknown;

    if (mutation.intent === "record_revision_decision") {
      if (!canReview(capability))
        throw new Response("도면 리비전을 검토할 권한이 없습니다.", {
          status: 403,
        });
      assertCurrentRevision(workspace, mutation.revisionId);
      result = await recordDrawingRevisionDecision(client, mutation);
    } else {
      if (!canEdit(capability))
        throw new Response("도면을 편집할 권한이 없습니다.", { status: 403 });

      if (mutation.intent === "create_document") {
        if (workspace.document)
          throw new DrawingWorkspaceRpcError(
            "이 파일에는 이미 도면 문서가 있습니다.",
          );
        const mode = DocumentModeSchema.parse(
          form.get("document_mode") ?? "blank",
        );
        result = await createDrawingDocument(
          client,
          project.id,
          workspace.file,
          { title: mutation.title, mode },
        );
      } else if (mutation.intent === "apply_operation") {
        assertCurrentRevision(workspace, mutation.operation.revisionId);
        result = await applyDrawingOperation(client, mutation.operation);
      } else if (mutation.intent === "create_layer") {
        const revisionId = currentRevisionId(workspace);
        const operation = DrawingOperationInputSchema.parse({
          clientOperationId: crypto.randomUUID(),
          revisionId,
          type: "add_layer",
          baseVersions: {},
          forward: {
            type: "add_layer",
            layer: {
              id: crypto.randomUUID(),
              name: mutation.name,
              visible: true,
              locked: false,
              version: 1,
            },
          },
          inverse: {},
          createdAt: new Date().toISOString(),
        });
        result = await applyDrawingOperation(client, operation);
      } else if (mutation.intent === "request_review") {
        assertCurrentRevision(workspace, mutation.revisionId);
        result = await requestDrawingReview(client, mutation.revisionId);
      } else {
        return data(
          {
            ok: false as const,
            kind: "validation" as const,
            error: "이슈 연결은 아직 사용할 수 없습니다.",
          },
          { status: 400, headers },
        );
      }
    }
    return data(
      { ok: true as const, kind: "success" as const, error: null, result },
      { headers },
    );
  } catch (error) {
    if (error instanceof Response) throw error;
    const kind =
      error instanceof DrawingWorkspaceRpcError ? error.kind : "validation";
    return data(
      {
        ok: false as const,
        kind,
        error:
          error instanceof Error
            ? error.message
            : "도면 작업을 저장하지 못했습니다.",
      },
      { status: kind === "conflict" ? 409 : 400, headers },
    );
  }
}

export default function DrawingWorkspaceScreen({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { project, capability, workspace } = loaderData;
  const editable = canEdit(capability);
  return (
    <main className="mx-auto w-full max-w-7xl px-5 pb-28 pt-8 sm:px-8 sm:pb-12">
      <Link
        className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground underline underline-offset-4"
        to={`/projects/${project.id}/drawings/${workspace.file.id}`}
      >
        <ArrowLeft className="size-4" /> 협업 도면실
      </Link>

      <header className="mt-4 border-b pb-6">
        <p className="text-sm font-semibold text-primary">
          {project.name} · 도면 편집 작업실
        </p>
        <h1 className="mt-2 truncate text-3xl font-bold tracking-tight">
          {workspace.file.original_filename}
        </h1>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          원본 SHA-256: {workspace.file.sha256}
        </p>
      </header>
      <ProjectWorkspaceNav current="drawings" projectId={project.id} />

      {actionData?.error ? (
        <p
          className="mt-5 rounded-xl bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          {actionData.error}
        </p>
      ) : null}

      {!workspace.document ? (
        <section className="mt-8 max-w-2xl rounded-2xl border p-6">
          <h2 className="text-xl font-bold">편집 도면 만들기</h2>
          {editable ? (
            <Form className="mt-5 space-y-4" method="post">
              <input name="intent" type="hidden" value="create_document" />
              <label
                className="block text-sm font-semibold"
                htmlFor="drawing-title"
              >
                도면 제목
              </label>
              <input
                className="min-h-11 w-full rounded-lg border bg-background px-3"
                defaultValue={workspace.file.original_filename.replace(
                  /\.[^.]+$/,
                  "",
                )}
                id="drawing-title"
                maxLength={240}
                name="title"
                required
              />
              <div className="flex flex-wrap gap-3">
                <button
                  className="min-h-11 rounded-lg border px-4 font-semibold"
                  name="document_mode"
                  type="submit"
                  value="blank"
                >
                  빈 도면
                </button>
                {workspace.file.kind === "pdf" ? (
                  <button
                    className="min-h-11 rounded-lg bg-primary px-4 font-semibold text-primary-foreground"
                    name="document_mode"
                    type="submit"
                    value="pdf_background"
                  >
                    PDF 배경 사용
                  </button>
                ) : null}
              </div>
            </Form>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              이 파일을 볼 수 있지만 편집 도면을 만들 권한은 없습니다.
            </p>
          )}
        </section>
      ) : (
        <section className="mt-8 rounded-2xl border p-6">
          <p className="text-sm font-semibold text-primary">
            리비전 {workspace.document.revision.sequence}
          </p>
          <h2 className="mt-2 text-xl font-bold">{workspace.document.title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            상태: {workspace.document.revision.status}
          </p>
        </section>
      )}
    </main>
  );
}
