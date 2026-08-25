import type { Route } from "./+types/drawing-workspace";

import { ArrowLeft } from "lucide-react";
import { Form, Link, data, redirect } from "react-router";

import { DrawingTemplateDialog } from "~/lukas/components/drawing-template-dialog";
import DrawingWorkspaceClient from "~/lukas/components/drawing-workspace.client";
import { ProjectWorkspaceNav } from "~/lukas/components/project-workspace-nav";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import {
  handleWorkspaceMutation,
  drawingTemplateCloneLocation,
  loadDrawingWorkspace,
  loadDrawingWorkspaceCapability,
  loadDrawingWorkspaceSourceUrl,
} from "~/lukas/lib/drawing-workspace.server";
import type {
  DrawingWorkspaceCapability,
  DrawingWorkspaceClient as DrawingWorkspaceDatabaseClient,
} from "~/lukas/lib/drawing-workspace.server";

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

async function workspaceContext(request: Request, projectId: string) {
  const context = await drawingContext(request, projectId);
  const client = context.client as unknown as DrawingWorkspaceDatabaseClient;
  const capability = await loadDrawingWorkspaceCapability(
    client,
    context.project.id,
    context.user.id,
    context.project.owner_id,
    context.role,
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
    new URL(request.url).searchParams.get("document") ?? undefined,
  );
  const sourceUrl = await loadDrawingWorkspaceSourceUrl(client, workspace);
  return data(
    { project, currentUserId: user.id, capability, workspace, sourceUrl },
    { headers },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const { client, headers, project, capability } = await workspaceContext(
    request,
    params.projectId!,
  );
  const form = await request.formData();
  const workspace = await loadDrawingWorkspace(
    client,
    project.id,
    params.fileId!,
  );
  const result = await handleWorkspaceMutation({
    client,
    projectId: project.id,
    capability,
    workspace,
    form,
  });
  if (
    form.get("intent") === "create_from_template" &&
    result.status === 200 &&
    result.body.ok
  ) {
    return redirect(
      drawingTemplateCloneLocation(
        project.id,
        workspace.file.id,
        result.body.result,
      ),
      { headers },
    );
  }
  return data(result.body, { status: result.status, headers });
}

export default function DrawingWorkspaceScreen({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { project, capability, workspace } = loaderData;
  const editable = canEdit(capability);
  if (workspace.document) {
    return (
      <DrawingWorkspaceClient
        actionError={actionData?.error}
        capability={capability}
        currentUserId={loaderData.currentUserId}
        roomUrl={`/projects/${project.id}/drawings/${workspace.file.id}`}
        sourceUrl={loaderData.sourceUrl}
        workspace={{ ...workspace, document: workspace.document }}
      />
    );
  }
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

      <section className="mt-8 max-w-2xl rounded-2xl border p-6">
        <h2 className="text-xl font-bold">편집 도면 만들기</h2>
        {editable ? (
          <>
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
                <DrawingTemplateDialog
                  actionError={actionData?.error ?? undefined}
                  candidates={workspace.templateCandidates}
                  sourceFile={workspace.file}
                />
              </div>
            </Form>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            이 파일을 볼 수 있지만 편집 도면을 만들 권한은 없습니다.
          </p>
        )}
      </section>
    </main>
  );
}
