import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import postgres from "postgres";

const databaseUrl = process.env.P3_POSTGRES_CONCURRENCY_DATABASE_URL;
const actorId = process.env.P3_POSTGRES_ACTOR_ID;
const projectId = process.env.P3_POSTGRES_PROJECT_ID;
const configured = Boolean(databaseUrl && actorId && projectId);
const supplied = [databaseUrl, actorId, projectId].filter(Boolean).length;

if (supplied > 0 && !configured)
  throw new Error(
    "P3 PostgreSQL concurrency verification requires database URL, actor ID, and project ID together",
  );

test(
  "P3 public and service bootstraps share one snapshot across a concurrent operation commit",
  { skip: configured ? false : "UNEXECUTED: disposable PostgreSQL concurrency fixture is not configured" },
  async () => {
    const sql = postgres(databaseUrl, { max: 3, prepare: false });
    let documentId;
    try {
      const [created] = await sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('request.jwt.claim.sub',${actorId},true)`;
        return tx`select public.lukas_drawing_create_document(
          ${projectId}::uuid,null,'P3 concurrent bootstrap',true
        ) result`;
      });
      const ids = created.result;
      documentId = ids.documentId;
      const clientOperationId = randomUUID();
      const layerId = randomUUID();

      await sql.begin(async (reader) => {
        await reader.unsafe("set transaction isolation level repeatable read");
        await reader.unsafe("set local role authenticated");
        await reader`select set_config('request.jwt.claim.sub',${actorId},true)`;
        const [before] = await reader`
          select public.lukas_drawing_collaboration_bootstrap(${ids.revisionId}::uuid) result
        `;

        await sql.begin(async (writer) => {
          await writer.unsafe("set local role authenticated");
          await writer`select set_config('request.jwt.claim.sub',${actorId},true)`;
          await writer`select public.lukas_drawing_apply_operation(
            ${ids.revisionId}::uuid,
            ${clientOperationId}::uuid,
            'add_layer',
            ${writer.json({ [layerId]: 1 })}::jsonb,
            ${writer.json({
              type: "add_layer",
              layer: {
                id: layerId,
                name: "Concurrent layer",
                canvasId: ids.canvasId,
                sortOrder: 9,
                visible: true,
                locked: false,
                version: 1,
              },
            })}::jsonb,
            '{}'::jsonb
          )`;
        });

        await reader.unsafe("reset role");
        await reader.unsafe("set local role lukas_drawing_collaboration");
        const [service] = await reader`
          select private.lukas_drawing_collaboration_bootstrap(
            ${actorId}::uuid,${projectId}::uuid,${ids.revisionId}::uuid
          ) result
        `;
        assert.deepEqual(service.result, before.result);
        assert.equal(before.result.operationSequence, 0);
      });

      const [after] = await sql.begin(async (tx) => {
        await tx.unsafe("set local role authenticated");
        await tx`select set_config('request.jwt.claim.sub',${actorId},true)`;
        return tx`
          select public.lukas_drawing_collaboration_bootstrap(${ids.revisionId}::uuid) result
        `;
      });
      assert.equal(after.result.operationSequence, 1);
      assert.equal(after.result.recentOutcomes[0].clientOperationId, clientOperationId);
    } finally {
      if (documentId)
        await sql.begin(async (tx) => {
          await tx.unsafe("set local role authenticated");
          await tx`select set_config('request.jwt.claim.sub',${actorId},true)`;
          await tx`delete from public.lukas_drawing_documents where id=${documentId}::uuid`;
        });
      await sql.end();
    }
  },
);
