import postgres from "postgres";
import * as Y from "yjs";

import type { DrawingRoomAuthorization } from "./auth.ts";

export type DrawingStorageScope = {
  userId: string;
  projectId: string;
  revisionId: string;
};
export type DrawingStoredState = {
  yjsState: Uint8Array;
  generation: number;
  sha256: string;
  baseOperationSequence: number;
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
  bootstrap?: (scope: DrawingStorageScope) => Promise<unknown>;
  lookupOperations?: (
    revisionId: string,
    operationIds: string[],
  ) => Promise<DrawingAcceptedOperation[]>;
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
  validateState?: (state: Uint8Array, scope: DrawingStorageScope) => void;
}) {
  const tokens = new Map<
    string,
    { generation: number; sha256: string | null }
  >();
  const sleep =
    input.sleep ??
    ((milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const key = (scope: DrawingStorageScope) =>
    `${scope.userId}:${scope.projectId}:${scope.revisionId}`;

  async function load(scope: DrawingStorageScope) {
    const state = await retry(() => input.database.load(scope), sleep);
    tokens.set(
      key(scope),
      state
        ? { generation: state.generation, sha256: state.sha256 }
        : { generation: 0, sha256: null },
    );
    return state;
  }

  async function store(
    value: DrawingStorageScope & {
      state: Uint8Array;
      baseOperationSequence: number;
    },
  ) {
    let state = value.state;
    let token = tokens.get(key(value)) ?? { generation: 0, sha256: null };
    for (let casAttempt = 0; ; casAttempt += 1) {
      try {
        const stored = await retry(
          () =>
            input.database.store({
              ...value,
              state,
              expectedGeneration: token.generation,
              expectedSha256: token.sha256,
            }),
          sleep,
        );
        tokens.set(key(value), {
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
        const current = await load(value);
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

  return {
    load,
    store,
    authorize: input.database.authorize,
    bootstrap: input.database.bootstrap,
    lookupOperations: input.database.lookupOperations
      ? (revisionId: string, operationIds: string[]) =>
          retry(
            () => input.database.lookupOperations!(revisionId, operationIds),
            sleep,
          )
      : undefined,
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
          sequence: Number(row.sequence),
          resultVersions: row.result_versions,
        }));
      }),
    health: async () => {
      const rows = await sql<{ ok: number }[]>`select 1 ok`;
      return rows[0]?.ok === 1;
    },
    close: () => sql.end({ timeout: 5 }),
  };
}
