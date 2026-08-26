import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

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
  operationStatuses: Array<{
    clientOperationId: string;
    status: "acked" | "rejected";
    authoritativeSequence: number | null;
    resultVersions: Record<string, number>;
  }>;
  stateVectorBase64: string;
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
  frozenSubjectRevisionVersion?: number | null;
  stateVectorBase64?: string | null;
  operationStatuses?: DrawingFreezeManifest["operationStatuses"] | null;
  revisionVersion?: number;
  reviewCommitted?: boolean;
  ownerToken?: string | null;
  ownerRequestId?: string | null;
  leaseExpiresAtMs?: number | null;
};

export type DrawingFreezeDatabase = {
  readFreeze(scope: {
    projectId: string;
    revisionId: string;
  }): Promise<DrawingFreezeState | null>;
  acquireFreezeLease(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    ownerToken: string;
    leaseMs: number;
    yjsState?: Uint8Array;
    baseOperationSequence?: number;
  }): Promise<void>;
  renewFreezeLease(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    ownerToken: string;
    leaseMs: number;
  }): Promise<void>;
  releaseFreezeLease(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    ownerToken: string;
  }): Promise<void>;
  beginFreeze(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    yjsState: Uint8Array;
    baseOperationSequence: number;
    ownerToken: string;
  }): Promise<DrawingFreezeState>;
  completeFreeze(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    yjsState: Uint8Array;
    manifest: DrawingFreezeManifest;
    ownerToken: string;
  }): Promise<DrawingFreezeState>;
  releaseFreeze(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    yjsState: Uint8Array;
    ownerToken: string;
  }): Promise<DrawingFreezeState>;
  syncReleasedState(input: {
    projectId: string;
    revisionId: string;
    requestId: string;
    yjsState: Uint8Array;
    ownerToken: string;
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
  const operationStatuses: DrawingFreezeManifest["operationStatuses"] = [];
  for (const operationId of ledger.operationOrder) {
    const envelope = ledger.operations[operationId];
    const status = DrawingCollaborationStatusSchema.parse(
      statuses.get(operationId),
    );
    if (status.status === "pending")
      throw new Error("Drawing collaboration has pending operations.");
    if (status.status === "conflicted")
      throw new Error("Drawing collaboration has conflicted operations.");
    operationStatuses.push({
      clientOperationId: operationId,
      status: status.status,
      authoritativeSequence: status.authoritativeSequence,
      resultVersions: status.resultVersions,
    });
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
  const stateVector = Y.encodeStateVector(document);
  if (stateVector.byteLength > 65_536)
    throw new Error("Drawing collaboration state vector is too large.");
  return {
    operations,
    operationStatuses,
    stateVectorBase64: Buffer.from(stateVector).toString("base64"),
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
    operationStatuses:
      state.operationStatuses ?? manifest?.operationStatuses ?? [],
    stateVectorBase64:
      state.stateVectorBase64 ?? manifest?.stateVectorBase64 ?? null,
    subjectRevisionVersion:
      state.frozenSubjectRevisionVersion ?? state.revisionVersion ?? null,
  };
}

export function createDrawingFreezeCoordinator(input: {
  database: DrawingFreezeDatabase;
  reconcile?: (document: Y.Doc) => Promise<void>;
  now?: () => number;
  completedLeaseMs?: number;
  ownerToken?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  setInterval?: typeof globalThis.setInterval;
  clearInterval?: typeof globalThis.clearInterval;
}) {
  const now = input.now ?? Date.now;
  const completedLeaseMs = input.completedLeaseMs ?? 60_000;
  const ownerToken = input.ownerToken ?? randomUUID();
  const leaseMs = input.leaseMs ?? 30_000;
  const heartbeatMs = input.heartbeatMs ?? 10_000;
  const setInterval = input.setInterval ?? globalThis.setInterval;
  const clearInterval = input.clearInterval ?? globalThis.clearInterval;
  type FreezeOwner = {
    requestId: string;
    phase: "in_flight" | "completed";
    expiresAt: number;
    promise: Promise<ReturnType<typeof result>>;
    heartbeat: ReturnType<typeof setInterval> | null;
    leaseError: unknown;
  };
  type FreezePreparation = {
    requestId: string;
    count: number;
    heartbeat: ReturnType<typeof setInterval> | null;
    promise: Promise<void>;
  };
  const owners = new Map<string, FreezeOwner>();
  const preparations = new Map<string, FreezePreparation>();
  const forgetOwner = (roomName: string, owner?: FreezeOwner) => {
    const current = owners.get(roomName);
    if (!current || (owner && current !== owner)) return;
    if (current.heartbeat !== null) clearInterval(current.heartbeat);
    owners.delete(roomName);
  };
  const fenceDocument = (document: Y.Doc, state: DrawingFreezeState) => {
    const requestId = state.ownerRequestId ?? state.requestId;
    if (!requestId) throw new Error("Drawing freeze lease request is missing.");
    const freezeState = state.state === "frozen" ? "frozen" : "freezing";
    document.transact(() => {
      document.getMap("serverMeta").set("freezeState", freezeState);
      document.getMap("serverMeta").set("freezeRequestId", requestId);
    });
    return result({ ...state, state: freezeState, requestId });
  };
  const leaseIsLive = (state: DrawingFreezeState) =>
    Boolean(state.ownerToken && (state.leaseExpiresAtMs ?? 0) > now());
  const acquireRecovery = async (
    scope: { projectId: string; revisionId: string },
    document: Y.Doc,
    requestId: string,
  ) => {
    const meta = DrawingCollaborationMetaSchema.parse(
      document.getMap("serverMeta").toJSON(),
    );
    try {
      await input.database.acquireFreezeLease({
        ...scope,
        requestId,
        ownerToken,
        leaseMs,
        yjsState: Y.encodeStateAsUpdate(document),
        baseOperationSequence: meta.baseOperationSequence,
      });
    } catch (error) {
      const authoritative = await input.database
        .readFreeze(scope)
        .catch(() => null);
      if (authoritative && leaseIsLive(authoritative))
        fenceDocument(document, authoritative);
      throw error;
    }
  };
  const prepare = async ({
    roomName,
    requestId,
  }: {
    roomName: string;
    requestId: string;
  }) => {
    const scope = parseDrawingRoomName(roomName);
    const existing = preparations.get(roomName);
    if (existing) {
      if (existing.requestId !== requestId)
        throw new Error("Drawing freeze lease is busy.");
      existing.count += 1;
      return existing.promise;
    }
    const preparation: FreezePreparation = {
      requestId,
      count: 1,
      heartbeat: null,
      promise: Promise.resolve(),
    };
    preparations.set(roomName, preparation);
    preparation.promise = input.database
      .acquireFreezeLease({
        ...scope,
        requestId,
        ownerToken,
        leaseMs,
      })
      .then(() => {
        if (preparations.get(roomName) !== preparation) return;
        preparation.heartbeat = setInterval(() => {
          void input.database
            .renewFreezeLease({
              ...scope,
              requestId,
              ownerToken,
              leaseMs,
            })
            .catch(() => undefined);
        }, heartbeatMs);
      })
      .catch((error) => {
        if (preparations.get(roomName) === preparation)
          preparations.delete(roomName);
        throw error;
      });
    return preparation.promise;
  };
  const finishPreparation = (roomName: string, requestId: string) => {
    const preparation = preparations.get(roomName);
    if (!preparation || preparation.requestId !== requestId) return false;
    preparation.count -= 1;
    if (preparation.count > 0) return false;
    if (preparation.heartbeat !== null)
      clearInterval(preparation.heartbeat);
    preparations.delete(roomName);
    return true;
  };
  const cancelPreparation = async ({
    roomName,
    requestId,
  }: {
    roomName: string;
    requestId: string;
  }) => {
    const scope = parseDrawingRoomName(roomName);
    const finished = finishPreparation(roomName, requestId);
    if (!finished || owners.get(roomName)?.requestId === requestId) return;
    await input.database.releaseFreezeLease({
      ...scope,
      requestId,
      ownerToken,
    });
  };
  const shareOwner = ({
    roomName,
    requestId,
  }: {
    roomName: string;
    requestId: string;
  }) => {
    let owner = owners.get(roomName);
    if (owner?.phase === "completed" && owner.expiresAt <= now()) {
      forgetOwner(roomName, owner);
      owner = undefined;
    }
    if (!owner) return null;
    if (owner.requestId !== requestId)
      throw new Error("Drawing freeze is already in progress.");
    return owner.promise;
  };
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
        ownerToken,
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
      state.frozenBaseOperationSequence !== manifest.baseOperationSequence ||
      (state.stateVectorBase64 !== null &&
        state.stateVectorBase64 !== undefined &&
        state.stateVectorBase64 !== manifest.stateVectorBase64) ||
      (state.operationStatuses !== null &&
        state.operationStatuses !== undefined &&
        JSON.stringify(canonical(state.operationStatuses)) !==
          JSON.stringify(canonical(manifest.operationStatuses)))
    )
      throw new Error("Persisted drawing freeze manifest does not match.");
    return result(state, manifest);
  };
  const freezeDocument = async ({
    document,
    roomName,
    requestId,
    owner,
  }: {
    document: Y.Doc;
    roomName: string;
    requestId: string;
    owner: FreezeOwner;
  }) => {
    const scope = parseDrawingRoomName(roomName);
    const meta = DrawingCollaborationMetaSchema.parse(
      document.getMap("serverMeta").toJSON(),
    );
    if (
      meta.projectId !== scope.projectId ||
      meta.revisionId !== scope.revisionId
    )
      throw new Error("Drawing freeze scope is invalid.");
    document.transact(() => {
      document.getMap("serverMeta").set("freezeState", "freezing");
      document.getMap("serverMeta").set("freezeRequestId", requestId);
    });
    try {
      await input.database.acquireFreezeLease({
        ...scope,
        requestId,
        ownerToken,
        leaseMs,
        yjsState: Y.encodeStateAsUpdate(document),
        baseOperationSequence: meta.baseOperationSequence,
      });
    } catch (error) {
      const authoritative = await input.database
        .readFreeze(scope)
        .catch(() => null);
      if (authoritative && leaseIsLive(authoritative))
        fenceDocument(document, authoritative);
      throw error;
    }
    if (owner.heartbeat === null)
      owner.heartbeat = setInterval(() => {
        if (owner.phase === "completed" && owner.expiresAt <= now()) {
          forgetOwner(roomName, owner);
          return;
        }
        void input.database
          .renewFreezeLease({
            ...scope,
            requestId,
            ownerToken,
            leaseMs,
          })
          .catch((error) => {
            owner.leaseError = error;
          });
      }, heartbeatMs);
    const renew = async () => {
      if (owner.leaseError) throw owner.leaseError;
      await input.database.renewFreezeLease({
        ...scope,
        requestId,
        ownerToken,
        leaseMs,
      });
    };
    const existing = await input.database.readFreeze(scope);
    if (existing?.state === "frozen") {
      if (existing.requestId !== requestId)
        throw new Error("Drawing freeze request does not match.");
      const serverMeta = document.getMap("serverMeta");
      if (
        serverMeta.get("freezeState") !== "frozen" ||
        serverMeta.get("freezeRequestId") !== requestId
      )
        document.transact(() => {
          serverMeta.set("freezeState", "frozen");
          serverMeta.set("freezeRequestId", requestId);
        });
      const manifest = drawingFreezeManifest(document);
      if (
        existing.revisionStatus === "draft" &&
        (!existing.stateVectorBase64 || !existing.operationStatuses)
      ) {
        const upgraded = await input.database.completeFreeze({
          ...scope,
          requestId,
          ownerToken,
          yjsState: Y.encodeStateAsUpdate(document),
          manifest,
        });
        return result(upgraded, manifest);
      }
      return frozenResult(existing, document);
    }
    if (existing?.state === "freezing" && existing.requestId !== requestId)
      throw new Error("Drawing freeze is already in progress.");
    if (existing?.revisionStatus && existing.revisionStatus !== "draft")
      throw new Error("Drawing revision is permanently frozen.");
    let started = false;
    try {
      await renew();
      const beginning = await input.database.beginFreeze({
        ...scope,
        requestId,
        ownerToken,
        yjsState: Y.encodeStateAsUpdate(document),
        baseOperationSequence: meta.baseOperationSequence,
      });
      started = true;
      if (beginning.state === "frozen")
        return frozenResult(beginning, document);
      await renew();
      await input.reconcile?.(document);
      await renew();
      document.transact(() => {
        document.getMap("serverMeta").set("freezeState", "frozen");
      });
      const manifest = drawingFreezeManifest(document);
      const frozen = await input.database.completeFreeze({
        ...scope,
        requestId,
        ownerToken,
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
        authoritative.requestId === requestId &&
        authoritative.ownerToken === ownerToken &&
        leaseIsLive(authoritative)
      )
        return frozenResult(authoritative, document);
      if (
        started &&
        authoritative?.revisionStatus === "draft" &&
        authoritative.requestId === requestId &&
        authoritative.ownerToken === ownerToken &&
        leaseIsLive(authoritative) &&
        preparations.get(roomName)?.requestId !== requestId
      )
        await releaseDocument(scope, document, requestId);
      else if (
        !started &&
        authoritative?.ownerToken === ownerToken &&
        authoritative.ownerRequestId === requestId &&
        leaseIsLive(authoritative) &&
        ["active", "released"].includes(authoritative.state) &&
        preparations.get(roomName)?.requestId !== requestId
      )
        await input.database.releaseFreezeLease({
          ...scope,
          requestId,
          ownerToken,
        });
      else if (authoritative && leaseIsLive(authoritative))
        fenceDocument(document, authoritative);
      throw error;
    }
  };
  const ownedFreeze = ({
    document,
    roomName,
    requestId,
  }: {
    document: Y.Doc;
    roomName: string;
    requestId: string;
  }) => {
    finishPreparation(roomName, requestId);
    let existing = owners.get(roomName);
    if (existing?.phase === "completed" && existing.expiresAt <= now()) {
      forgetOwner(roomName, existing);
      existing = undefined;
    }
    if (existing) {
      if (existing.requestId !== requestId)
        return Promise.reject(
          new Error("Drawing freeze is owned by another request."),
        );
      return existing.promise;
    }
    const owner: FreezeOwner = {
      requestId,
      phase: "in_flight",
      expiresAt: Number.POSITIVE_INFINITY,
      promise: Promise.resolve(null as never),
      heartbeat: null,
      leaseError: null,
    };
    owners.set(roomName, owner);
    owner.promise = freezeDocument({ document, roomName, requestId, owner })
      .then((value) => {
        const current = owners.get(roomName);
        if (current === owner) {
          current.phase = "completed";
          current.expiresAt = now() + completedLeaseMs;
        }
        return value;
      })
      .catch((error) => {
        forgetOwner(roomName, owner);
        throw error;
      });
    return owner.promise;
  };
  return {
    prepare,
    cancelPreparation,
    shareOwner,
    dispose() {
      for (const preparation of preparations.values())
        if (preparation.heartbeat !== null)
          clearInterval(preparation.heartbeat);
      preparations.clear();
      for (const owner of owners.values())
        if (owner.heartbeat !== null) clearInterval(owner.heartbeat);
      owners.clear();
    },
    async reconcileLoaded({
      document,
      roomName,
    }: {
      document: Y.Doc;
      roomName: string;
    }) {
      const scope = parseDrawingRoomName(roomName);
      const state = await input.database.readFreeze(scope);
      if (!state) return null;
      const owner = owners.get(roomName);
      const committed = ["review_requested", "approved"].includes(
        state.revisionStatus ?? "",
      );
      if (committed) {
        if (
          leaseIsLive(state) &&
          state.ownerToken === ownerToken &&
          state.ownerRequestId
        )
          await input.database.releaseFreezeLease({
            ...scope,
            requestId: state.ownerRequestId,
            ownerToken,
          });
        forgetOwner(roomName);
      } else if (
        leaseIsLive(state) &&
        (!owner ||
          state.ownerToken !== ownerToken ||
          state.ownerRequestId !== owner.requestId)
      ) {
        return fenceDocument(document, state);
      }
      if (owner && (state.state === "released" || committed))
        forgetOwner(roomName, owner);
      else if (owner) {
        if (state.requestId && state.requestId !== owner.requestId)
          throw new Error(
            "Drawing freeze owner does not match persisted state.",
          );
        if (owner.phase === "completed" && owner.expiresAt <= now())
          forgetOwner(roomName, owner);
        else if (["active", "freezing"].includes(state.state)) {
          document.transact(() => {
            document.getMap("serverMeta").set("freezeState", "freezing");
            document
              .getMap("serverMeta")
              .set("freezeRequestId", owner.requestId);
          });
          return result({
            ...state,
            state: "freezing",
            requestId: owner.requestId,
          });
        } else if (state.state === "frozen") {
          const serverMeta = document.getMap("serverMeta");
          if (
            serverMeta.get("freezeState") !== "frozen" ||
            serverMeta.get("freezeRequestId") !== owner.requestId
          )
            document.transact(() => {
              serverMeta.set("freezeState", "frozen");
              serverMeta.set("freezeRequestId", owner.requestId);
            });
          return frozenResult(state, document);
        } else {
          return result(state);
        }
      }
      if (state.state === "released") {
        if (!state.requestId)
          throw new Error("Released drawing freeze request is missing.");
        const serverMeta = document.getMap("serverMeta");
        if (
          serverMeta.get("freezeState") === "released" &&
          serverMeta.get("freezeRequestId") === state.requestId
        )
          return result(state);
        await acquireRecovery(scope, document, state.requestId);
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
          candidate.transact(() => {
            candidate.getMap("serverMeta").set("freezeState", "released");
            candidate
              .getMap("serverMeta")
              .set("freezeRequestId", state.requestId);
          });
          const synchronized = await input.database.syncReleasedState({
            ...scope,
            requestId: state.requestId,
            ownerToken,
            yjsState: Y.encodeStateAsUpdate(candidate),
          });
          Y.applyUpdate(document, Y.encodeStateAsUpdate(candidate));
          return result(synchronized);
        } finally {
          candidate.destroy();
        }
      }
      if (state.state === "freezing") {
        if (!state.requestId)
          throw new Error("Drawing freeze request is missing.");
        if (state.frozenSubjectRevisionVersion !== state.revisionVersion)
          throw new Error("Drawing freeze subject version changed.");
        if (state.revisionStatus === "draft") {
          await ownedFreeze({
            document,
            roomName,
            requestId: state.requestId,
          });
          const completed = await input.database.readFreeze(scope);
          if (
            completed?.state !== "frozen" ||
            completed.requestId !== state.requestId
          )
            throw new Error(
              "Interrupted drawing freeze changed during recovery.",
            );
          if (
            ["review_requested", "approved"].includes(
              completed.revisionStatus ?? "",
            )
          )
            return frozenResult(completed, document);
          if (completed.revisionStatus !== "draft" || completed.reviewCommitted)
            throw new Error(
              "Interrupted drawing freeze changed during recovery.",
            );
          const released = await releaseDocument(
            scope,
            document,
            state.requestId,
          );
          forgetOwner(roomName);
          return result(released);
        }
        document.transact(() => {
          document.getMap("serverMeta").set("freezeState", "freezing");
          document.getMap("serverMeta").set("freezeRequestId", state.requestId);
        });
        return result(state);
      }
      if (state.state === "frozen") {
        if (state.frozenSubjectRevisionVersion !== state.revisionVersion)
          throw new Error("Drawing freeze subject version changed.");
        if (!state.requestId)
          throw new Error("Frozen drawing freeze request is missing.");
        if (state.revisionStatus === "draft") {
          if (state.reviewCommitted)
            throw new Error("Rejected drawing freeze was not released.");
          await acquireRecovery(scope, document, state.requestId);
          const released = await releaseDocument(
            scope,
            document,
            state.requestId,
          );
          forgetOwner(roomName);
          return result(released);
        }
        const serverMeta = document.getMap("serverMeta");
        if (
          serverMeta.get("freezeState") !== "frozen" ||
          serverMeta.get("freezeRequestId") !== state.requestId
        )
          document.transact(() => {
            serverMeta.set("freezeState", "frozen");
            serverMeta.set("freezeRequestId", state.requestId);
          });
        return frozenResult(state, document);
      }
      if (state.state === "active") {
        const serverMeta = document.getMap("serverMeta");
        if (
          serverMeta.get("freezeState") !== "active" ||
          serverMeta.get("freezeRequestId") !== null
        )
          document.transact(() => {
            serverMeta.set("freezeState", "active");
            serverMeta.set("freezeRequestId", null);
          });
      }
      return result(state);
    },
    freeze: ownedFreeze,
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
      const owner = owners.get(roomName);
      if (owner?.requestId === requestId && owner.phase === "in_flight")
        throw new Error("Drawing freeze is still in progress.");
      const authoritative = await input.database.readFreeze(scope);
      if (
        !authoritative ||
        authoritative.requestId !== requestId ||
        authoritative.revisionStatus !== "draft" ||
        !["freezing", "frozen"].includes(authoritative.state)
      )
        throw new Error("Drawing freeze cannot be released.");
      if (
        leaseIsLive(authoritative) &&
        authoritative.ownerToken !== ownerToken
      ) {
        fenceDocument(document, authoritative);
        throw new Error("Drawing freeze lease is busy.");
      }
      if (!leaseIsLive(authoritative))
        await acquireRecovery(scope, document, requestId);
      const released = await releaseDocument(scope, document, requestId);
      if (owners.get(roomName)?.requestId === requestId) forgetOwner(roomName);
      return released;
    },
  };
}
