import postgres from "postgres";
import * as Y from "yjs";

import type { DrawingRoomAuthorization } from "./auth.ts";
import type { DrawingFreezeDatabase, DrawingFreezeState } from "./freeze.ts";

export type DrawingStorageScope = {
  userId: string;
  projectId: string;
  revisionId: string;
};
export type DrawingServiceStorageScope = Omit<DrawingStorageScope, "userId">;
export type DrawingStoredState = {
  yjsState: Uint8Array;
  generation: number;
  sha256: string;
  baseOperationSequence: number;
  freezeState?: DrawingFreezeState["state"];
  freezeRequestId?: string | null;
};
export type DrawingStoreInput = DrawingStorageScope & {
  state: Uint8Array;
  baseOperationSequence: number;
  expectedGeneration: number;
  expectedSha256: string | null;
};
export type DrawingAcceptedOperation = {
  revisionId: string;
  clientOperationId: string;
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

export type DrawingCollaborationDatabase = {
  authorize?: (
    userId: string,
    projectId: string,
    revisionId: string,
  ) => Promise<DrawingRoomAuthorization>;
  load: (scope: DrawingStorageScope) => Promise<DrawingStoredState | null>;
  store: (
    input: DrawingStoreInput,
  ) => Promise<{ generation: number; sha256: string }>;
  loadService?: (
    scope: DrawingServiceStorageScope,
  ) => Promise<DrawingStoredState | null>;
  storeService?: (
    input: Omit<DrawingStoreInput, "userId">,
  ) => Promise<{ generation: number; sha256: string }>;
  bootstrap?: (scope: DrawingStorageScope) => Promise<unknown>;
  bootstrapService?: (scope: DrawingServiceStorageScope) => Promise<unknown>;
  lookupOperations?: (
    revisionId: string,
    operationIds: string[],
  ) => Promise<DrawingAcceptedOperation[]>;
  freeze?: DrawingFreezeDatabase;
  health?: () => Promise<boolean>;
  close?: () => Promise<void>;
};

const transientCodes = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "57P01",
  "57P03",
  "40001",
  "40P01",
]);

function isTransient(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    transientCodes.has(String(error.code)),
  );
}

async function retry<T>(
  action: () => Promise<T>,
  sleep: (milliseconds: number) => Promise<void>,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      if (attempt >= 2 || !isTransient(error)) throw error;
      await sleep(25 * 2 ** attempt);
    }
  }
}

export function createDrawingCollaborationStorage(input: {
  database: DrawingCollaborationDatabase;
  sleep?: (milliseconds: number) => Promise<void>;
  validateState?: (
    state: Uint8Array,
    scope: DrawingServiceStorageScope,
  ) => void;
}) {
  const tokens = new Map<
    string,
    { generation: number; sha256: string | null }
  >();
  const sleep =
    input.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const key = (scope: DrawingServiceStorageScope, userId: string | null) =>
    `${userId ?? "service"}:${scope.projectId}:${scope.revisionId}`;

  async function loadWith(
    scope: DrawingStorageScope | DrawingServiceStorageScope,
    service: boolean,
  ) {
    if (service && !input.database.loadService)
      throw new Error("Drawing collaboration service load is unavailable.");
    const state = await retry(
      () =>
        service
          ? input.database.loadService!(scope)
          : input.database.load(scope as DrawingStorageScope),
      sleep,
    );
    const userId = service ? null : (scope as DrawingStorageScope).userId;
    tokens.set(
      key(scope, userId),
      state
        ? { generation: state.generation, sha256: state.sha256 }
        : { generation: 0, sha256: null },
    );
    return state;
  }
  const load = (scope: DrawingStorageScope) => loadWith(scope, false);
  const loadService = (scope: DrawingServiceStorageScope) =>
    loadWith(scope, true);

  async function storeWith(
    value: (DrawingStorageScope | DrawingServiceStorageScope) & {
      state: Uint8Array;
      baseOperationSequence: number;
    },
    service: boolean,
  ) {
    if (service && !input.database.storeService)
      throw new Error("Drawing collaboration service store is unavailable.");
    let state = value.state;
    const userId = service ? null : (value as DrawingStorageScope).userId;
    let token = tokens.get(key(value, userId)) ?? {
      generation: 0,
      sha256: null,
    };
    for (let casAttempt = 0; ; casAttempt += 1) {
      try {
        const stored = await retry(() => {
          const payload = {
            ...value,
            state,
            expectedGeneration: token.generation,
            expectedSha256: token.sha256,
          };
          return service
            ? input.database.storeService!(payload)
            : input.database.store(payload as DrawingStoreInput);
        }, sleep);
        tokens.set(key(value, userId), {
          generation: stored.generation,
          sha256: stored.sha256,
        });
        return {
          ...stored,
          state,
          baseOperationSequence: value.baseOperationSequence,
        };
      } catch (error) {
        if (
          casAttempt > 0 ||
          !error ||
          typeof error !== "object" ||
          !("code" in error) ||
          error.code !== "P3S03"
        )
          throw error;
        const current = await loadWith(value, service);
        if (!current) throw error;
        const merged = new Y.Doc();
        Y.applyUpdate(merged, Y.mergeUpdates([current.yjsState, state]));
        const baseOperationSequence = Math.max(
          current.baseOperationSequence,
          value.baseOperationSequence,
        );
        merged
          .getMap("serverMeta")
          .set("baseOperationSequence", baseOperationSequence);
        state = Y.encodeStateAsUpdate(merged);
        merged.destroy();
        value = { ...value, baseOperationSequence };
        if (!input.validateState) throw error;
        input.validateState(state, value);
        token = { generation: current.generation, sha256: current.sha256 };
      }
    }
  }
  const store = (
    value: DrawingStorageScope & {
      state: Uint8Array;
      baseOperationSequence: number;
    },
  ) => storeWith(value, false);
  const storeService = (
    value: DrawingServiceStorageScope & {
      state: Uint8Array;
      baseOperationSequence: number;
    },
  ) => storeWith(value, true);

  return {
    load,
    store,
    loadService,
    storeService,
    authorize: input.database.authorize,
    bootstrap: input.database.bootstrap,
    bootstrapService: input.database.bootstrapService,
    lookupOperations: input.database.lookupOperations
      ? (revisionId: string, operationIds: string[]) =>
          retry(
            () => input.database.lookupOperations!(revisionId, operationIds),
            sleep,
          )
      : undefined,
    freeze: input.database.freeze,
    health: input.database.health,
    close: input.database.close,
  };
}

function firstRow<T>(rows: readonly T[]): T | null {
  return rows[0] ?? null;
}

export function createPostgresDrawingCollaborationDatabase(
  databaseUrl: string,
): DrawingCollaborationDatabase {
  const sql = postgres(databaseUrl, {
    max: 10,
    onnotice: () => {},
    transform: { undefined: null },
  });
  const inRole = <T>(
    action: (transaction: postgres.TransactionSql) => Promise<T>,
  ) =>
    sql.begin(async (transaction) => {
      await transaction.unsafe("set local role lukas_drawing_collaboration");
      return action(transaction);
    });

  return {
    authorize: (userId, projectId, revisionId) =>
      inRole(async (tx) => {
        const row = firstRow(
          await tx<
            {
              capability: string;
              can_write: boolean;
              revision_status: string;
            }[]
          >`select * from private.lukas_drawing_collaboration_authorize(${userId}::uuid,${projectId}::uuid,${revisionId}::uuid)`,
        );
        if (!row)
          throw new Error("Drawing collaboration target is unavailable.");
        return {
          capability: row.capability,
          canWrite: row.can_write,
          revisionStatus: row.revision_status,
        };
      }),
    load: (scope) =>
      inRole(async (tx) => {
        const row = firstRow(
          await tx<
            {
              yjs_state: Uint8Array;
              store_generation: number;
              yjs_sha256: string;
              base_operation_sequence: number;
            }[]
          >`select * from private.lukas_drawing_collaboration_load_state(${scope.userId}::uuid,${scope.projectId}::uuid,${scope.revisionId}::uuid)`,
        );
        return row
          ? {
              yjsState: new Uint8Array(row.yjs_state),
              generation: Number(row.store_generation),
              sha256: row.yjs_sha256,
              baseOperationSequence: Number(row.base_operation_sequence),
            }
          : null;
      }),
    store: (value) =>
      inRole(async (tx) => {
        const rows = await tx<
          {
            store_generation: number;
            yjs_sha256: string;
          }[]
        >`select * from private.lukas_drawing_collaboration_store_state(
          ${value.userId}::uuid,${value.projectId}::uuid,${value.revisionId}::uuid,
          1::smallint,${Buffer.from(value.state)}::bytea,${value.baseOperationSequence}::bigint,
          ${value.expectedGeneration}::bigint,${value.expectedSha256}
        )`;
        const row = firstRow(rows);
        if (!row)
          throw new Error("Drawing collaboration store returned no state.");
        return {
          generation: Number(row.store_generation),
          sha256: row.yjs_sha256,
        };
      }),
    loadService: (scope) =>
      inRole(async (tx) => {
        const row = firstRow(
          await tx<
            {
              yjs_state: Uint8Array;
              store_generation: number;
              yjs_sha256: string;
              base_operation_sequence: number;
            }[]
          >`select * from private.lukas_drawing_collaboration_service_load_state(${scope.projectId}::uuid,${scope.revisionId}::uuid)`,
        );
        return row
          ? {
              yjsState: new Uint8Array(row.yjs_state),
              generation: Number(row.store_generation),
              sha256: row.yjs_sha256,
              baseOperationSequence: Number(row.base_operation_sequence),
            }
          : null;
      }),
    storeService: (value) =>
      inRole(async (tx) => {
        const row = firstRow(
          await tx<
            { store_generation: number; yjs_sha256: string }[]
          >`select * from private.lukas_drawing_collaboration_service_store_state(
            ${value.projectId}::uuid,${value.revisionId}::uuid,1::smallint,
            ${Buffer.from(value.state)}::bytea,${value.baseOperationSequence}::bigint,
            ${value.expectedGeneration}::bigint,${value.expectedSha256}
          )`,
        );
        if (!row)
          throw new Error(
            "Drawing collaboration service store returned no state.",
          );
        return {
          generation: Number(row.store_generation),
          sha256: row.yjs_sha256,
        };
      }),
    bootstrap: (scope) =>
      inRole(async (tx) => {
        const row = firstRow(
          await tx<
            { result: unknown }[]
          >`select private.lukas_drawing_collaboration_bootstrap(${scope.userId}::uuid,${scope.projectId}::uuid,${scope.revisionId}::uuid) result`,
        );
        if (!row)
          throw new Error("Drawing collaboration bootstrap returned no state.");
        return row.result;
      }),
    bootstrapService: (scope) =>
      inRole(async (tx) => {
        const row = firstRow(
          await tx<
            { result: unknown }[]
          >`select private.lukas_drawing_collaboration_service_bootstrap(${scope.projectId}::uuid,${scope.revisionId}::uuid) result`,
        );
        if (!row)
          throw new Error(
            "Drawing collaboration service bootstrap returned no state.",
          );
        return row.result;
      }),
    lookupOperations: (revisionId, operationIds) =>
      inRole(async (tx) => {
        const rows = await tx<
          {
            revision_id: string;
            client_operation_id: string;
            actor_id: string;
            operation_type: string;
            base_versions: Record<string, number>;
            forward: unknown;
            inverse: unknown;
            history_action: "undo" | "redo" | null;
            original_operation_id: string | null;
            sequence: number;
            result_versions: Record<string, number>;
          }[]
        >`select * from private.lukas_drawing_collaboration_lookup_operations(${revisionId}::uuid,${operationIds}::uuid[])`;
        return rows.map((row) => ({
          revisionId: row.revision_id,
          clientOperationId: row.client_operation_id,
          actorId: row.actor_id,
          operationType: row.operation_type,
          baseVersions: row.base_versions,
          forward: row.forward,
          inverse: row.inverse,
          historyAction: row.history_action,
          originalOperationId: row.original_operation_id,
          sequence: Number(row.sequence),
          resultVersions: row.result_versions,
        }));
      }),
    freeze: {
      readFreeze: (scope) =>
        inRole(async (tx) => {
          const row = firstRow(
            await tx<
              {
                freeze_state: DrawingFreezeState["state"];
                freeze_request_id: string | null;
                revision_status: string;
                revision_version: number;
                accepted_manifest_sha256: string | null;
                accepted_operation_count: number | null;
                frozen_base_operation_sequence: number | null;
                frozen_subject_revision_version: number | null;
                frozen_yjs_state_vector: string | null;
                frozen_operation_statuses:
                  DrawingFreezeState["operationStatuses"] | null;
                review_committed: boolean;
                freeze_owner_token: string | null;
                freeze_owner_request_id: string | null;
                freeze_owner_lease_expires_at: Date | string | null;
              }[]
            >`select * from private.lukas_drawing_collaboration_read_freeze(${scope.projectId}::uuid,${scope.revisionId}::uuid)`,
          );
          return row
            ? {
                state: row.freeze_state,
                requestId: row.freeze_request_id,
                revisionStatus: row.revision_status,
                revisionVersion: Number(row.revision_version),
                manifestSha256: row.accepted_manifest_sha256,
                manifestCount:
                  row.accepted_operation_count === null
                    ? null
                    : Number(row.accepted_operation_count),
                frozenBaseOperationSequence:
                  row.frozen_base_operation_sequence === null
                    ? null
                    : Number(row.frozen_base_operation_sequence),
                frozenSubjectRevisionVersion:
                  row.frozen_subject_revision_version === null
                    ? null
                    : Number(row.frozen_subject_revision_version),
                stateVectorBase64: row.frozen_yjs_state_vector,
                operationStatuses: row.frozen_operation_statuses,
                reviewCommitted: row.review_committed,
                ownerToken: row.freeze_owner_token,
                ownerRequestId: row.freeze_owner_request_id,
                leaseExpiresAtMs:
                  row.freeze_owner_lease_expires_at === null
                    ? null
                    : new Date(row.freeze_owner_lease_expires_at).getTime(),
              }
            : null;
        }),
      acquireFreezeLease: (value) =>
        inRole(async (tx) => {
          await tx`select private.lukas_drawing_collaboration_acquire_freeze_lease(
            ${value.projectId}::uuid,${value.revisionId}::uuid,${value.requestId}::uuid,
            ${value.ownerToken}::uuid,${Math.ceil(value.leaseMs / 1000)}::integer,
            ${value.yjsState ? Buffer.from(value.yjsState) : null}::bytea,
            ${value.baseOperationSequence ?? null}::bigint
          )`;
        }),
      renewFreezeLease: (value) =>
        inRole(async (tx) => {
          await tx`select private.lukas_drawing_collaboration_renew_freeze_lease(
            ${value.projectId}::uuid,${value.revisionId}::uuid,${value.requestId}::uuid,
            ${value.ownerToken}::uuid,${Math.ceil(value.leaseMs / 1000)}::integer
          )`;
        }),
      releaseFreezeLease: (value) =>
        inRole(async (tx) => {
          await tx`select private.lukas_drawing_collaboration_release_freeze_lease(
            ${value.projectId}::uuid,${value.revisionId}::uuid,${value.requestId}::uuid,
            ${value.ownerToken}::uuid
          )`;
        }),
      beginFreeze: (value) =>
        inRole(async (tx) => {
          const row = firstRow(
            await tx<
              { result: DrawingFreezeState }[]
            >`select private.lukas_drawing_collaboration_begin_freeze(
              ${value.projectId}::uuid,${value.revisionId}::uuid,${value.requestId}::uuid,
              ${Buffer.from(value.yjsState)}::bytea,${value.baseOperationSequence}::bigint,
              ${value.ownerToken}::uuid
            ) result`,
          );
          if (!row) throw new Error("Drawing freeze returned no state.");
          return row.result;
        }),
      completeFreeze: (value) =>
        inRole(async (tx) => {
          const row = firstRow(
            await tx<
              { result: DrawingFreezeState }[]
            >`select private.lukas_drawing_collaboration_complete_freeze(
              ${value.projectId}::uuid,${value.revisionId}::uuid,${value.requestId}::uuid,
              ${Buffer.from(value.yjsState)}::bytea,
              ${tx.json(JSON.parse(JSON.stringify(value.manifest.operations)))}::jsonb,${value.manifest.sha256},
              ${value.manifest.count}::integer,${value.manifest.baseOperationSequence}::bigint,
              ${value.manifest.stateVectorBase64},
              ${tx.json(JSON.parse(JSON.stringify(value.manifest.operationStatuses)))}::jsonb,
              ${value.ownerToken}::uuid
            ) result`,
          );
          if (!row) throw new Error("Drawing freeze returned no state.");
          return row.result;
        }),
      releaseFreeze: (value) =>
        inRole(async (tx) => {
          const row = firstRow(
            await tx<
              { result: DrawingFreezeState }[]
            >`select private.lukas_drawing_collaboration_release_freeze(
              ${value.projectId}::uuid,${value.revisionId}::uuid,${value.requestId}::uuid,
              ${Buffer.from(value.yjsState)}::bytea,${value.ownerToken}::uuid
            ) result`,
          );
          if (!row)
            throw new Error("Drawing freeze release returned no state.");
          return row.result;
        }),
      syncReleasedState: (value) =>
        inRole(async (tx) => {
          const row = firstRow(
            await tx<
              { result: DrawingFreezeState }[]
            >`select private.lukas_drawing_collaboration_sync_released_state(
              ${value.projectId}::uuid,${value.revisionId}::uuid,${value.requestId}::uuid,
              ${Buffer.from(value.yjsState)}::bytea,${value.ownerToken}::uuid
            ) result`,
          );
          if (!row) throw new Error("Drawing released sync returned no state.");
          return row.result;
        }),
    },
    health: async () => {
      const rows = await sql<{ ok: number }[]>`select 1 ok`;
      return rows[0]?.ok === 1;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
