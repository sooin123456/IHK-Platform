import type { Route } from "./+types/drawing-workspace-quantity-lineage";

import { data } from "react-router";
import { z } from "zod";

import { mergeResponseHeaders } from "~/core/lib/response-headers.server";
import { drawingContext } from "~/lukas/lib/drawing-collaboration.server";
import {
  drawingQuantityLineageErrorResponse,
  listDrawingObjectQuantityLineage,
  resolveDrawingWorkspaceEntry,
} from "~/lukas/lib/drawing-quantity-lineage.server";
import {
  assertDrawingBoqEvidenceScope,
  loadDrawingWorkspaceCapability,
  type DrawingWorkspaceClient,
} from "~/lukas/lib/drawing-workspace.server";
import { assertDrawingObjectIssueScope } from "~/lukas/lib/drawing-workspace-route.server";
import { assertProjectOrganizationFeature } from "~/lukas/lib/organization-administration.server";

const Uuid = z.string().uuid();
const allowedQueryFields = new Set([
  "revision",
  "object",
  "boq",
  "line",
  "evidence",
  "quantityCursor",
]);

export function parseQuantityLineageResourceQuery(
  searchParams: URLSearchParams,
) {
  try {
    for (const key of searchParams.keys())
      if (!allowedQueryFields.has(key)) throw new Error("unknown query field");
    const one = (name: string) => {
      const values = searchParams.getAll(name);
      if (values.length > 1) throw new Error("duplicate query field");
      return values[0] ?? null;
    };
    const revision = one("revision");
    const object = one("object");
    const boq = one("boq");
    const line = one("line");
    const evidence = one("evidence");
    const cursor = one("quantityCursor");
    if (!revision || !object) throw new Error("missing lineage scope");
    if ((boq || line || evidence) && !(boq && line))
      throw new Error("incomplete BOQ evidence");
    return {
      revisionId: Uuid.parse(revision),
      objectId: Uuid.parse(object),
      boqVersionId: boq ? Uuid.parse(boq) : null,
      boqLineId: line ? Uuid.parse(line) : null,
      evidenceFileId: evidence ? Uuid.parse(evidence) : null,
      cursor,
    };
  } catch {
    throw new Response("도면 수량 계보 요청이 올바르지 않습니다.", {
      status: 400,
    });
  }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const context = await drawingContext(request, params.projectId!);
  try {
    if (request.method !== "GET")
      throw new Response("Method Not Allowed", { status: 405 });
    const projectId = Uuid.parse(params.projectId);
    const workspaceId = Uuid.parse(params.workspaceId);
    const parsed = parseQuantityLineageResourceQuery(
      new URL(request.url).searchParams,
    );
    const client = context.client as unknown as DrawingWorkspaceClient;
    await Promise.all([
      assertProjectOrganizationFeature(
        client as any,
        context.project.id,
        "drawing_workspace",
      ),
      assertProjectOrganizationFeature(
        client as any,
        context.project.id,
        "quantity_lineage",
      ),
    ]);
    const capability = await loadDrawingWorkspaceCapability(
      client,
      context.project.id,
      context.user.id,
      context.project.owner_id,
      context.role,
    );
    if (!capability)
      throw new Response("도면 작업 권한이 없습니다.", { status: 403 });

    if (parsed.boqVersionId && parsed.boqLineId) {
      try {
        const entry = await resolveDrawingWorkspaceEntry(client as any, {
          projectId: context.project.id,
          revisionId: parsed.revisionId,
          objectId: parsed.objectId,
          boqVersionId: parsed.boqVersionId,
          boqLineId: parsed.boqLineId,
          fileId: parsed.evidenceFileId ?? undefined,
        });
        if (entry.documentId !== workspaceId)
          throw new Error("workspace entry mismatch");
      } catch {
        throw new Response("연결된 도면 근거를 열 수 없습니다.", {
          status: 404,
        });
      }
    } else {
      await assertDrawingObjectIssueScope(client, {
        projectId: context.project.id,
        documentId: workspaceId,
        revisionId: parsed.revisionId,
        objectId: parsed.objectId,
      });
    }

    let quantityLineage;
    try {
      quantityLineage = await listDrawingObjectQuantityLineage(client as any, {
        projectId: context.project.id,
        revisionId: parsed.revisionId,
        objectId: parsed.objectId,
        cursor: parsed.cursor,
        limit: 200,
        boqEvidence:
          parsed.boqVersionId && parsed.boqLineId
            ? {
                boqVersionId: parsed.boqVersionId,
                boqLineId: parsed.boqLineId,
              }
            : undefined,
      });
      if (parsed.boqVersionId && parsed.boqLineId)
        assertDrawingBoqEvidenceScope(quantityLineage, {
          boqVersionId: parsed.boqVersionId,
          boqLineId: parsed.boqLineId,
        });
    } catch (error) {
      const bounded = drawingQuantityLineageErrorResponse(error);
      throw new Response(bounded.body.error, {
        status: bounded.body.errorCode === "P6O01" ? 400 : bounded.status,
      });
    }
    context.headers.set("Cache-Control", "private, no-store");
    return data(
      { objectId: parsed.objectId, quantityLineage },
      { headers: context.headers },
    );
  } catch (error) {
    if (error instanceof Response)
      throw mergeResponseHeaders(error, context.headers);
    throw error;
  }
}
