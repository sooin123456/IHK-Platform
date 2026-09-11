import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import {
  blockInstanceRenderModel,
  blockRenderModelBounds,
  type DrawingBlockRenderModel,
} from "./drawing-blocks.ts";
import { hydrateDrawingAuthoritySnapshot } from "./drawing-authority-snapshot.server.ts";
import { resolveDrawingStyle } from "./drawing-structure.ts";
import type { DrawingWorkspaceClient } from "./drawing-workspace.server.ts";
import type {
  DrawingBlockInstance,
  DrawingCanvas,
  DrawingLayer,
  DrawingObject,
  DrawingPage,
  DrawingStyle,
} from "./drawing-workspace.types.ts";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const DrawingShareToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine((token) => {
    const bytes = Buffer.from(token, "base64url");
    return (
      bytes.byteLength === 32 &&
      Buffer.from(bytes).toString("base64url") === token
    );
  }, "Drawing share token must be canonical 32-byte base64url.");
const FrozenRevisionStatus = z.enum([
  "review_requested",
  "reviewed",
  "approved",
  "superseded",
]);

const DrawingShareScopeSchema = z
  .object({
    projectId: Uuid,
    documentId: Uuid,
    revisionId: Uuid,
    revisionVersion: z.number().int().positive(),
    snapshotSha256: Sha256,
  })
  .strict();

const DrawingShareRowSchema = z
  .object({
    shareId: Uuid,
    revisionVersion: z.number().int().positive(),
    snapshotSha256: Sha256,
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    revokedAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict();

const DrawingShareMutationResultSchema = z
  .object({
    shareId: Uuid,
    projectId: Uuid,
    documentId: Uuid,
    revisionId: Uuid,
    revisionVersion: z.number().int().positive(),
    snapshotSha256: Sha256,
    createdAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    revokedAt: z.string().datetime({ offset: true }).nullable(),
    requestId: Uuid,
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();

const DrawingShareAuthoritySchema = z
  .object({
    shareId: Uuid,
    project: z.object({ id: Uuid, name: z.string().min(1) }).strict(),
    document: z.object({ id: Uuid, title: z.string().min(1) }).strict(),
    revision: z
      .object({
        id: Uuid,
        sequence: z.number().int().positive(),
        version: z.number().int().positive(),
        status: FrozenRevisionStatus,
      })
      .strict(),
    snapshot: z
      .object({
        sha256: Sha256,
        schemaVersion: z.literal(2),
        operationSequence: z.number().int().nonnegative(),
        canonicalJson: z.unknown(),
      })
      .strict(),
    expiresAt: z.string().datetime({ offset: true }),
  })
  .strict();

type RpcResult = { data: unknown; error: unknown };
type DrawingShareRpcClient = {
  rpc: unknown;
};
type DrawingShareResolverClient = DrawingShareRpcClient & {
  from: unknown;
  storage: unknown;
};

export type DrawingRevisionShare = z.infer<typeof DrawingShareRowSchema>;
export type PublicDrawingShareView = {
  project: { id: string; name: string };
  document: { id: string; title: string };
  revision: {
    id: string;
    sequence: number;
    version: number;
    status: z.infer<typeof FrozenRevisionStatus>;
  };
  snapshotSha256: string;
  expiresAt: string;
  pages: DrawingPage[];
  canvases: DrawingCanvas[];
  layers: DrawingLayer[];
  objects: Array<DrawingObject & { style: DrawingStyle }>;
  blockInstances: Array<DrawingBlockRenderModel & { bounds: BoundsLike }>;
  pdfSources: Record<string, { id: string; sha256: string; signedUrl: string }>;
};

type BoundsLike = { x: number; y: number; width: number; height: number };

function unavailableDrawingShare(): Response {
  return new Response("공유 도면을 열 수 없습니다.", { status: 404 });
}

function rpcValue(result: RpcResult): unknown {
  if (result.error || result.data === null || result.data === undefined)
    throw unavailableDrawingShare();
  return result.data;
}

function callDrawingShareRpc(
  client: DrawingShareRpcClient,
  name: string,
  args: Record<string, unknown>,
): PromiseLike<RpcResult> {
  if (typeof client.rpc !== "function") throw unavailableDrawingShare();
  const rpc = client.rpc as (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<RpcResult>;
  return rpc.call(client, name, args);
}

export function parseDrawingShareToken(value: unknown): string {
  return DrawingShareToken.parse(value);
}

export function drawingShareSecretFromBytes(bytes: Uint8Array) {
  if (bytes.byteLength !== 32)
    throw new Error("Drawing share secrets require exactly 32 bytes.");
  const token = Buffer.from(bytes).toString("base64url");
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  };
}

export function drawingShareSecretFromToken(value: unknown) {
  const token = parseDrawingShareToken(value);
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  };
}

export function createDrawingShareSecret() {
  return drawingShareSecretFromBytes(randomBytes(32));
}

export function drawingSharePath(token: string) {
  return `/share/${encodeURIComponent(parseDrawingShareToken(token))}/drawing`;
}

export function assertDrawingRevisionShareScope(input: {
  capability: string;
  projectId: string;
  documentId: string;
  revision: { id: string; version: number; status: string };
  bootstrap: {
    sha256: string;
    canonicalJson: {
      revision: {
        id: string;
        documentId: string;
        projectId: string;
        version: number;
      };
    };
  } | null;
}) {
  if (input.capability !== "admin")
    throw new Response("공유 링크를 관리할 권한이 없습니다.", { status: 403 });
  if (!FrozenRevisionStatus.safeParse(input.revision.status).success)
    throw new Response("고정된 도면 개정만 공유할 수 있습니다.", {
      status: 409,
    });
  const bootstrap = input.bootstrap;
  if (
    !bootstrap ||
    bootstrap.canonicalJson.revision.id !== input.revision.id ||
    bootstrap.canonicalJson.revision.documentId !== input.documentId ||
    bootstrap.canonicalJson.revision.projectId !== input.projectId ||
    bootstrap.canonicalJson.revision.version !== input.revision.version
  )
    throw new Response("공유할 도면 스냅샷이 현재 개정과 일치하지 않습니다.", {
      status: 409,
    });
  return DrawingShareScopeSchema.parse({
    projectId: input.projectId,
    documentId: input.documentId,
    revisionId: input.revision.id,
    revisionVersion: input.revision.version,
    snapshotSha256: bootstrap.sha256,
  });
}

function byOrder<T extends { id: string; sortOrder?: number }>(
  left: T,
  right: T,
) {
  return (
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

async function loadExactPdfSource(
  client: DrawingShareResolverClient,
  input: { projectId: string; sourceFileId: string; sourceSha256: string },
) {
  const sourceClient = client as unknown as Pick<
    DrawingWorkspaceClient,
    "from" | "storage"
  >;
  const { data, error } = await sourceClient
    .from("lukas_qto_files")
    .select("id,project_id,kind,storage_path,sha256,immutable")
    .eq("id", input.sourceFileId)
    .eq("project_id", input.projectId)
    .eq("sha256", input.sourceSha256)
    .eq("kind", "pdf")
    .eq("immutable", true)
    .maybeSingle();
  const row = data as {
    id: string;
    project_id: string;
    kind: string;
    storage_path: string;
    sha256: string;
    immutable: boolean;
  } | null;
  if (
    error ||
    !row ||
    row.id !== input.sourceFileId ||
    row.project_id !== input.projectId ||
    row.kind !== "pdf" ||
    row.sha256 !== input.sourceSha256 ||
    row.immutable !== true
  )
    throw unavailableDrawingShare();
  const signed = await sourceClient.storage
    .from("lukas-qto")
    .createSignedUrl(row.storage_path, 60);
  if (signed.error || !signed.data?.signedUrl) throw unavailableDrawingShare();
  return {
    id: row.id,
    sha256: row.sha256,
    signedUrl: signed.data.signedUrl,
  };
}

function hydrateAuthoritySnapshot(
  authority: z.infer<typeof DrawingShareAuthoritySchema>,
) {
  const { state } = hydrateDrawingAuthoritySnapshot({
    projectId: authority.project.id,
    documentId: authority.document.id,
    revision: authority.revision,
    snapshot: authority.snapshot,
  });
  return state;
}

export async function resolvePublicDrawingShare(
  client: DrawingShareResolverClient,
  rawToken: unknown,
): Promise<PublicDrawingShareView> {
  let authority: z.infer<typeof DrawingShareAuthoritySchema>;
  let state: ReturnType<typeof hydrateAuthoritySnapshot>;
  try {
    const token = parseDrawingShareToken(rawToken);
    const result = await callDrawingShareRpc(
      client,
      "lukas_qto_shared_drawing_revision",
      {
        p_token: token,
      },
    );
    authority = DrawingShareAuthoritySchema.parse(rpcValue(result));
    if (Date.parse(authority.expiresAt) <= Date.now())
      throw unavailableDrawingShare();
    state = hydrateAuthoritySnapshot(authority);
  } catch (error) {
    if (error instanceof Response) throw error;
    throw unavailableDrawingShare();
  }

  const structure = state.structure;
  if (!structure) throw unavailableDrawingShare();
  const pages = Object.values(structure.pages).sort(byOrder);
  const pageOrder = new Map(pages.map((page, index) => [page.id, index]));
  const canvases = Object.values(structure.canvases).sort(
    (left, right) =>
      (pageOrder.get(left.pageId) ?? Number.MAX_SAFE_INTEGER) -
        (pageOrder.get(right.pageId) ?? Number.MAX_SAFE_INTEGER) ||
      byOrder(left, right),
  );
  const layers = Object.values(structure.layers).sort(
    (left, right) =>
      canvases.findIndex((canvas) => canvas.id === left.canvasId) -
        canvases.findIndex((canvas) => canvas.id === right.canvasId) ||
      byOrder(left, right),
  );
  const objects = Object.values(structure.objects)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((object) => ({
      ...object,
      style: resolveDrawingStyle(object, structure.styles),
    }));
  const blockInstances = Object.values(structure.blockInstances)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((instance: DrawingBlockInstance) => {
      const block = structure.blocks[instance.blockId];
      if (!block) throw unavailableDrawingShare();
      const model = blockInstanceRenderModel(block, instance, structure.styles);
      return { ...model, bounds: blockRenderModelBounds(model) };
    });

  const pdfReferences = new Map<
    string,
    { sourceFileId: string; sourceSha256: string }
  >();
  for (const canvas of canvases) {
    if (!canvas.background || canvas.background.pdfPageNumber === null)
      continue;
    const existing = pdfReferences.get(canvas.background.sourceFileId);
    if (existing && existing.sourceSha256 !== canvas.background.sourceSha256)
      throw unavailableDrawingShare();
    pdfReferences.set(canvas.background.sourceFileId, {
      sourceFileId: canvas.background.sourceFileId,
      sourceSha256: canvas.background.sourceSha256,
    });
  }
  const pdfSources: PublicDrawingShareView["pdfSources"] = {};
  for (const reference of pdfReferences.values()) {
    const source = await loadExactPdfSource(client, {
      projectId: authority.project.id,
      ...reference,
    });
    pdfSources[source.id] = source;
  }

  return {
    project: authority.project,
    document: authority.document,
    revision: authority.revision,
    snapshotSha256: authority.snapshot.sha256,
    expiresAt: authority.expiresAt,
    pages,
    canvases,
    layers,
    objects,
    blockInstances,
    pdfSources,
  };
}

function shareScopeRpcArgs(input: z.input<typeof DrawingShareScopeSchema>) {
  const scope = DrawingShareScopeSchema.parse({
    projectId: input.projectId,
    documentId: input.documentId,
    revisionId: input.revisionId,
    revisionVersion: input.revisionVersion,
    snapshotSha256: input.snapshotSha256,
  });
  return {
    p_project_id: scope.projectId,
    p_document_id: scope.documentId,
    p_revision_id: scope.revisionId,
    p_revision_version: scope.revisionVersion,
    p_snapshot_sha256: scope.snapshotSha256,
  };
}

export async function listDrawingRevisionShares(
  client: DrawingShareRpcClient,
  input: z.input<typeof DrawingShareScopeSchema>,
): Promise<DrawingRevisionShare[]> {
  const result = await callDrawingShareRpc(
    client,
    "lukas_qto_list_drawing_shares",
    shareScopeRpcArgs(input),
  );
  const value = rpcValue(result);
  return z.array(DrawingShareRowSchema).parse(value);
}

export async function createDrawingRevisionShare(
  client: DrawingShareRpcClient,
  input: z.input<typeof DrawingShareScopeSchema> & {
    actorId: string;
    requestId: string;
    secretBytes?: Uint8Array;
    token?: string;
  },
) {
  const actorId = Uuid.parse(input.actorId);
  const requestId = Uuid.parse(input.requestId);
  if (input.secretBytes && input.token)
    throw new Error("Provide either token or secretBytes, not both.");
  const secret = input.token
    ? drawingShareSecretFromToken(input.token)
    : input.secretBytes
      ? drawingShareSecretFromBytes(input.secretBytes)
      : createDrawingShareSecret();
  const result = await callDrawingShareRpc(
    client,
    "lukas_qto_create_drawing_share",
    {
      ...shareScopeRpcArgs(input),
      p_actor_id: actorId,
      p_token_hash: secret.tokenHash,
      p_request_id: requestId,
    },
  );
  const row = DrawingShareMutationResultSchema.parse(rpcValue(result));
  return {
    shareId: row.shareId,
    revisionVersion: row.revisionVersion,
    snapshotSha256: row.snapshotSha256,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    token: secret.token,
  };
}

export async function revokeDrawingRevisionShare(
  client: DrawingShareRpcClient,
  input: z.input<typeof DrawingShareScopeSchema> & {
    shareId: string;
    reason: string;
    requestId: string;
  },
) {
  const result = await callDrawingShareRpc(
    client,
    "lukas_qto_revoke_drawing_share",
    {
      ...shareScopeRpcArgs(input),
      p_share_id: Uuid.parse(input.shareId),
      p_reason: z.string().trim().min(1).max(1000).parse(input.reason),
      p_request_id: Uuid.parse(input.requestId),
    },
  );
  const row = DrawingShareMutationResultSchema.parse(rpcValue(result));
  if (!row.revokedAt || !row.reason) throw unavailableDrawingShare();
  return { shareId: row.shareId, revokedAt: row.revokedAt };
}
