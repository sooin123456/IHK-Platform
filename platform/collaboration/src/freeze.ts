import { createHash, timingSafeEqual } from "node:crypto";

import * as Y from "yjs";

import {
  DrawingCollaborationMetaSchema,
  DrawingCollaborationStatusSchema,
  parseDrawingRoomName,
} from "../../app/lukas/lib/drawing-collaboration-protocol.ts";
import { readDrawingCollaborationLedger } from "../../app/lukas/lib/drawing-collaboration-yjs.ts";

export type DrawingFreezeManifestOperation = {
  clientOperationId: string;
  revisionId: string;
  actorId: string;
  operationType: string;
  baseVersions: Record<string, number>;
  forward: unknown;
  inverse: unknown;
  historyAction: "undo" | "redo" | null;
  originalOperationId: string | null;
  sequence: number;
  resultVersions: Record<string, number>;
};

export type DrawingFreezeManifest = {
  operations: DrawingFreezeManifestOperation[];
  sha256: string;
  count: number;
  baseOperationSequence: number;
};

export type DrawingFreezeState = {
  state: "active" | "freezing" | "frozen" | "released";
  requestId: string | null;
  revisionStatus?: string;
  manifestSha256?: string | null;
  manifestCount?: number | null;
  frozenBaseOperationSequence?: number | null;
};

export type DrawingFreezeDatabase = {
  readFreeze(scope: {
    projectId: string;
    revisionId: string;
  }): Promise<DrawingFreezeState | null>;
  beginFreeze(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    yjsState: Uint8Array;
    baseOperationSequence: number;
  }): Promise<DrawingFreezeState>;
  completeFreeze(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    yjsState: Uint8Array;
    manifest: DrawingFreezeManifest;
  }): Promise<DrawingFreezeState>;
  releaseFreeze(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    yjsState: Uint8Array;
  }): Promise<DrawingFreezeState>;
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}

export function createDrawingFreezeSecretVerifier(secret: string) {
  if (Buffer.byteLength(secret) < 32)
    throw new Error("Internal drawing freeze secret is too short.");
  const expected = Buffer.from(secret);
  return (supplied: string | undefined) => {
    const candidate = Buffer.from(supplied ?? "");
    const comparable =
      candidate.byteLength === expected.byteLength
        ? candidate
        : Buffer.alloc(expected.byteLength);
    if (!timingSafeEqual(expected, comparable))
      throw new Error("Drawing freeze authentication failed.");
  };
}

export function drawingFreezeManifest(document: Y.Doc): DrawingFreezeManifest {
  const meta = DrawingCollaborationMetaSchema.parse(
    document.getMap("serverMeta").toJSON(),
  );
  const ledger = readDrawingCollaborationLedger(document);
  const statuses = document.getMap("operationStatus");
  const operations: DrawingFreezeManifestOperation[] = [];
  for (const operationId of ledger.operationOrder) {
    const envelope = ledger.operations[operationId];
    const status = DrawingCollaborationStatusSchema.parse(
      statuses.get(operationId),
    );
    if (status.status === "pending")
      throw new Error("Drawing collaboration has pending operations.");
    if (status.status === "conflicted")
      throw new Error("Drawing collaboration has conflicted operations.");
    if (status.status === "rejected") continue;
    operations.push({
      clientOperationId: envelope.clientOperationId,
      revisionId: envelope.revisionId,
      actorId: envelope.actorId,
      operationType: envelope.type,
      baseVersions: envelope.baseVersions,
      forward: envelope.forward,
      inverse: envelope.inverse,
      historyAction: envelope.historyAction ?? null,
      originalOperationId: envelope.originalOperationId ?? null,
      sequence: status.authoritativeSequence!,
      resultVersions: status.resultVersions,
    });
  }
  operations.sort((left, right) => left.sequence - right.sequence);
  if (
    new Set(operations.map((operation) => operation.sequence)).size !==
    operations.length
  )
    throw new Error("Drawing collaboration operation sequence is invalid.");
  return {
    operations,
    sha256: digest(operations),
    count: operations.length,
    baseOperationSequence: meta.baseOperationSequence,
  };
}

function result(state: DrawingFreezeState, manifest?: DrawingFreezeManifest) {
  return {
    freezeState: state.state,
    freezeRequestId: state.requestId,
    manifestSha256: state.manifestSha256 ?? manifest?.sha256 ?? null,
    manifestCount: state.manifestCount ?? manifest?.count ?? null,
    baseOperationSequence:
      state.frozenBaseOperationSequence ??
      manifest?.baseOperationSequence ??
      null,
    operations: manifest?.operations ?? [],
  };
}

export function createDrawingFreezeCoordinator(input: {
  database: DrawingFreezeDatabase;
  reconcile?: (document: Y.Doc) => Promise<void>;
}) {
  const releaseDocument = async (
    scope: { projectId: string; revisionId: string },
    document: Y.Doc,
    requestId: string,
  ) => {
    const candidate = new Y.Doc();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
      candidate.transact(() => {
        candidate.getMap("serverMeta").set("freezeState", "released");
        candidate.getMap("serverMeta").set("freezeRequestId", requestId);
      });
      const released = await input.database.releaseFreeze({
        ...scope,
        requestId,
        yjsState: Y.encodeStateAsUpdate(candidate),
      });
      Y.applyUpdate(document, Y.encodeStateAsUpdate(candidate));
      return released;
    } finally {
      candidate.destroy();
    }
  };
  const frozenResult = (state: DrawingFreezeState, document: Y.Doc) => {
    const manifest = drawingFreezeManifest(document);
    if (
      state.manifestSha256 !== manifest.sha256 ||
      state.manifestCount !== manifest.count ||
      state.frozenBaseOperationSequence !== manifest.baseOperationSequence
    )
      throw new Error("Persisted drawing freeze manifest does not match.");
    return result(state, manifest);
  };
  return {
    async freeze({
      document,
      roomName,
      requestId,
    }: {
      document: Y.Doc;
      roomName: string;
      requestId: string;
    }) {
      const scope = parseDrawingRoomName(roomName);
      const meta = DrawingCollaborationMetaSchema.parse(
        document.getMap("serverMeta").toJSON(),
      );
      if (
        meta.projectId !== scope.projectId ||
        meta.revisionId !== scope.revisionId
      )
        throw new Error("Drawing freeze scope is invalid.");
      const existing = await input.database.readFreeze(scope);
      if (existing?.state === "frozen") {
        if (existing.requestId !== requestId)
          throw new Error("Drawing freeze request does not match.");
        document.transact(() => {
          document.getMap("serverMeta").set("freezeState", "frozen");
          document.getMap("serverMeta").set("freezeRequestId", requestId);
        });
        return frozenResult(existing, document);
      }
      if (existing?.state === "freezing" && existing.requestId !== requestId)
        throw new Error("Drawing freeze is already in progress.");
      if (existing?.revisionStatus && existing.revisionStatus !== "draft")
        throw new Error("Drawing revision is permanently frozen.");

      document.transact(() => {
        document.getMap("serverMeta").set("freezeState", "freezing");
        document.getMap("serverMeta").set("freezeRequestId", requestId);
      });
      let started = false;
      try {
        const beginning = await input.database.beginFreeze({
          ...scope,
          requestId,
          yjsState: Y.encodeStateAsUpdate(document),
          baseOperationSequence: meta.baseOperationSequence,
        });
        started = true;
        if (beginning.state === "frozen")
          return frozenResult(beginning, document);
        await input.reconcile?.(document);
        const manifest = drawingFreezeManifest(document);
        document.transact(() => {
          document.getMap("serverMeta").set("freezeState", "frozen");
        });
        const frozen = await input.database.completeFreeze({
          ...scope,
          requestId,
          yjsState: Y.encodeStateAsUpdate(document),
          manifest,
        });
        return result(frozen, manifest);
      } catch (error) {
        const authoritative = await input.database
          .readFreeze(scope)
          .catch(() => null);
        if (
          authoritative?.state === "frozen" &&
          authoritative.requestId === requestId
        )
          return frozenResult(authoritative, document);
        if (
          started &&
          authoritative?.revisionStatus === "draft" &&
          authoritative.requestId === requestId
        )
          await releaseDocument(scope, document, requestId);
        throw error;
      }
    },
    async release({
      document,
      roomName,
      requestId,
    }: {
      document: Y.Doc;
      roomName: string;
      requestId: string;
    }) {
      const scope = parseDrawingRoomName(roomName);
      const authoritative = await input.database.readFreeze(scope);
      if (
        !authoritative ||
        authoritative.requestId !== requestId ||
        authoritative.revisionStatus !== "draft" ||
        !["freezing", "frozen"].includes(authoritative.state)
      )
        throw new Error("Drawing freeze cannot be released.");
      return releaseDocument(scope, document, requestId);
    },
  };
}
