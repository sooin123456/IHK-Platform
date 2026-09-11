import type { Route } from "./+types/drawing-workspace-measurement-evidence";

import { data } from "react-router";
import { z } from "zod";

import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import {
  loadDrawingWorkspaceCapability,
  loadDrawingWorkspaceMeasurementState,
  type DrawingWorkspaceClient,
} from "~/lukas/lib/drawing-workspace.server";
import { compactDrawingServerMeasurementEvidence } from "~/lukas/lib/drawing-workspace-loader-payload";
import { assertProjectOrganizationFeature } from "~/lukas/lib/organization-administration.server";

const Uuid = z.string().uuid();
const Query = z
  .object({
    revision: Uuid,
    version: z.coerce.number().int().positive(),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    operation: z.coerce.number().int().nonnegative(),
  })
  .strict();

export function parseMeasurementEvidenceQuery(searchParams: URLSearchParams) {
  const parsed = Query.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success || Array.from(searchParams).length !== 4)
    throw new Response("측정 근거 요청이 올바르지 않습니다.", {
      status: 400,
    });
  return parsed.data;
}

export function assertMeasurementEvidenceScopeResult(result: {
  data: { id: string } | null;
  error: unknown | null;
}) {
  if (result.error)
    throw new Response("측정 근거를 불러오지 못했습니다.", {
      status: 503,
    });
  if (!result.data)
    throw new Response("측정 근거 체크포인트가 변경되었습니다.", {
      status: 409,
    });
  return result.data;
}

async function assertMeasurementEvidenceScope(
  client: any,
  input: {
    projectId: string;
    workspaceId: string;
    revisionId: string;
    revisionVersion: number;
  },
) {
  const result = await client
    .from("lukas_drawing_revisions")
    .select("id")
    .eq("id", input.revisionId)
    .eq("document_id", input.workspaceId)
    .eq("project_id", input.projectId)
    .eq("version", input.revisionVersion)
    .maybeSingle();
  assertMeasurementEvidenceScopeResult(result);
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const context = await drawingContext(request, params.projectId!);
  try {
    if (request.method !== "GET")
      throw new Response("Method Not Allowed", { status: 405 });
    const projectId = Uuid.parse(params.projectId);
    const workspaceId = Uuid.parse(params.workspaceId);
    const parsed = parseMeasurementEvidenceQuery(
      new URL(request.url).searchParams,
    );
    const client = context.client as unknown as DrawingWorkspaceClient;
    await assertProjectOrganizationFeature(
      client as any,
      context.project.id,
      "drawing_workspace",
    );
    const capability = await loadDrawingWorkspaceCapability(
      client,
      context.project.id,
      context.user.id,
      context.project.owner_id,
      context.role,
    );
    if (!capability)
      throw new Response("도면 작업 권한이 없습니다.", { status: 403 });
    await assertMeasurementEvidenceScope(client, {
      projectId: context.project.id,
      workspaceId,
      revisionId: parsed.revision,
      revisionVersion: parsed.version,
    });
    const measurement = await loadDrawingWorkspaceMeasurementState(client, {
      documentId: workspaceId,
      revisionId: parsed.revision,
      revisionVersion: parsed.version,
    });
    const bootstrap = measurement.collaborationBootstrap;
    if (
      !bootstrap ||
      bootstrap.canonicalJson.revision.projectId !== context.project.id ||
      bootstrap.sha256 !== parsed.sha256 ||
      bootstrap.operationSequence !== parsed.operation
    )
      throw new Response("측정 근거 체크포인트가 변경되었습니다.", {
        status: 409,
      });
    context.headers.set("Cache-Control", "private, no-store");
    return data(
      {
        measurementEvidence: measurement.measurementEvidence
          ? compactDrawingServerMeasurementEvidence(
              measurement.measurementEvidence,
              bootstrap,
            )
          : null,
        measurementEvidenceError: measurement.measurementEvidenceError,
      },
      { headers: context.headers },
    );
  } catch (error) {
    if (error instanceof Response)
      throw mergeResponseHeaders(error, context.headers);
    throw error;
  }
}
