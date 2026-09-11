import { createHmac } from "node:crypto";

import { z } from "zod";

import {
  assertDrawingRevisionShareScope,
  createDrawingRevisionShare,
  drawingSharePath,
  revokeDrawingRevisionShare,
} from "./drawing-share.server.ts";
import type {
  DrawingWorkspace,
  DrawingWorkspaceCapability,
  DrawingWorkspaceClient,
  DrawingWorkspaceCollaborationBootstrap,
} from "./drawing-workspace.server.ts";

function assertDrawingShareFormFields(form: FormData, intent: string) {
  const allowed = new Set(
    intent === "create_drawing_share"
      ? ["intent", "request_id"]
      : ["intent", "request_id", "share_id", "reason"],
  );
  for (const key of form.keys())
    if (!allowed.has(key) || form.getAll(key).length !== 1)
      throw new z.ZodError([]);
  return z.string().uuid().parse(form.get("request_id"));
}

function drawingShareReplaySecret(
  scope: {
    projectId: string;
    documentId: string;
    revisionId: string;
    revisionVersion: number;
    snapshotSha256: string;
  },
  requestId: string,
  environment: Record<string, string | undefined>,
) {
  const serverSecret =
    environment.DRAWING_SHARE_TOKEN_SECRET ??
    environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverSecret || serverSecret.length < 32)
    throw new Response("공유 링크 생성 설정이 준비되지 않았습니다.", {
      status: 503,
    });
  return createHmac("sha256", serverSecret)
    .update(
      JSON.stringify([
        "1hk-drawing-share-token-v1",
        requestId,
        scope.projectId,
        scope.documentId,
        scope.revisionId,
        scope.revisionVersion,
        scope.snapshotSha256,
      ]),
    )
    .digest();
}

export async function handleDrawingShareIntent(input: {
  actorId: string;
  authorityClient: Pick<DrawingWorkspaceClient, "rpc">;
  bootstrap: Pick<
    DrawingWorkspaceCollaborationBootstrap,
    "sha256" | "canonicalJson"
  > | null;
  capability: DrawingWorkspaceCapability;
  client: Pick<DrawingWorkspaceClient, "rpc">;
  form: FormData;
  environment?: Record<string, string | undefined>;
  projectId: string;
  workspace: Pick<DrawingWorkspace, "document">;
}) {
  const intent = z
    .enum(["create_drawing_share", "revoke_drawing_share"])
    .parse(input.form.get("intent"));
  const requestId = assertDrawingShareFormFields(input.form, intent);
  const scope = assertDrawingRevisionShareScope({
    capability: input.capability,
    projectId: input.projectId,
    documentId: input.workspace.document.id,
    revision: input.workspace.document.revision,
    bootstrap: input.bootstrap,
  });
  if (intent === "create_drawing_share") {
    const created = await createDrawingRevisionShare(input.authorityClient, {
      ...scope,
      actorId: input.actorId,
      requestId,
      secretBytes: drawingShareReplaySecret(
        scope,
        requestId,
        input.environment ?? process.env,
      ),
    });
    const { token, ...metadata } = created;
    return {
      ok: true as const,
      kind: "drawing_share_created" as const,
      error: null,
      result: { ...metadata, sharePath: drawingSharePath(token) },
    };
  }
  const revoked = await revokeDrawingRevisionShare(input.client, {
    ...scope,
    shareId: z.string().uuid().parse(input.form.get("share_id")),
    reason: z.string().trim().min(1).max(1000).parse(input.form.get("reason")),
    requestId,
  });
  return {
    ok: true as const,
    kind: "drawing_share_revoked" as const,
    error: null,
    result: revoked,
  };
}
