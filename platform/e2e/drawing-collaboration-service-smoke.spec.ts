import { createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
} from "@hocuspocus/provider";
import { expect, test } from "@playwright/test";
import CrossWebSocket from "crossws/websocket";
import * as Y from "yjs";

import { appendDrawingCollaborationOperation } from "../app/lukas/lib/drawing-collaboration-yjs";
import type { DrawingCollaborationOperation } from "../app/lukas/lib/drawing-collaboration-protocol";
import {
  authenticateApiClient,
  createDrawingFixture,
  destroyDrawingP3Fixture,
  requireDrawingP3ProductionCredentials,
  type DrawingFixture,
} from "./utils/drawing-collaboration-fixture";

const credentials = requireDrawingP3ProductionCredentials(process.env);

function lifecycleCommand(name: string) {
  const raw = process.env[name];
  let value: unknown;
  try {
    value = raw && JSON.parse(raw);
  } catch {
    throw new Error(`${name} is UNEXECUTED: expected a JSON command array.`);
  }
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  )
    throw new Error(`${name} is UNEXECUTED: expected a JSON command array.`);
  return value as [string, ...string[]];
}

const sigtermCommand = lifecycleCommand(
  "P3_COLLABORATION_SIGTERM_COMMAND_JSON",
);
const restartCommand = lifecycleCommand(
  "P3_COLLABORATION_RESTART_COMMAND_JSON",
);

const NodeOriginWebSocket = CrossWebSocket as unknown as new (
  url: string,
  protocols?: string[],
  options?: { origin?: string },
) => WebSocket;

class OriginWebSocket extends NodeOriginWebSocket {
  constructor(url: string) {
    super(url, [], { origin: new URL(credentials.E2E_BASE_URL).origin });
  }
}

function roomName(fixture: DrawingFixture) {
  return `drawing:${fixture.projectId}:${fixture.blankWorkspace.revisionId}`;
}

async function tokenFor(
  fixture: DrawingFixture,
  user: DrawingFixture["owner"],
) {
  const client = await authenticateApiClient(fixture, user);
  const { data } = await client.auth.getSession();
  if (!data.session?.access_token)
    throw new Error("Collaboration smoke access token is unavailable.");
  return { client, token: data.session.access_token };
}

async function connect(fixture: DrawingFixture, user: DrawingFixture["owner"]) {
  const { client, token } = await tokenFor(fixture, user);
  const document = new Y.Doc();
  const websocket = new HocuspocusProviderWebsocket({
    url: credentials.VITE_DRAWING_COLLABORATION_URL,
    WebSocketPolyfill: OriginWebSocket,
  });
  let closeObserved = false;
  let provider: HocuspocusProvider | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Collaboration smoke sync timed out.")),
        20_000,
      );
      provider = new HocuspocusProvider({
        websocketProvider: websocket,
        name: roomName(fixture),
        document,
        token,
        onSynced: () => {
          clearTimeout(timeout);
          resolve();
        },
        onAuthenticationFailed: ({ reason }) => {
          clearTimeout(timeout);
          reject(new Error(reason));
        },
        onClose: () => {
          closeObserved = true;
        },
      });
    });
  } catch (error) {
    provider?.destroy();
    websocket.destroy();
    document.destroy();
    throw error;
  }
  return {
    client,
    document,
    provider: provider!,
    async waitForClose() {
      await expect.poll(() => closeObserved, { timeout: 20_000 }).toBe(true);
    },
    dispose() {
      provider!.destroy();
      websocket.destroy();
      document.destroy();
    },
  };
}

async function requireNonMemberRejection(fixture: DrawingFixture) {
  const { token } = await tokenFor(fixture, fixture.nonMember);
  const document = new Y.Doc();
  const websocket = new HocuspocusProviderWebsocket({
    url: credentials.VITE_DRAWING_COLLABORATION_URL,
    WebSocketPolyfill: OriginWebSocket,
  });
  let provider: HocuspocusProvider | undefined;
  try {
    const denied = await new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Non-member rejection timed out.")),
        10_000,
      );
      provider = new HocuspocusProvider({
        websocketProvider: websocket,
        name: roomName(fixture),
        document,
        token,
        onSynced: () => {
          clearTimeout(timeout);
          resolve(false);
        },
        onAuthenticationFailed: () => {
          clearTimeout(timeout);
          resolve(true);
        },
      });
    });
    if (!denied) throw new Error("Non-member unexpectedly entered the room.");
  } finally {
    provider?.destroy();
    websocket.destroy();
    document.destroy();
  }
}

function runLifecycle([command, ...args]: [string, ...string[]]) {
  const result = spawnSync(command, args, {
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
  if (result.status !== 0)
    throw new Error(
      `Collaboration lifecycle command failed (${result.status ?? "signal"}).`,
    );
}

async function requireHealth() {
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(
            new URL("/healthz", credentials.COLLABORATION_INTERNAL_URL),
          );
          return response.ok;
        } catch {
          return false;
        }
      },
      { timeout: 60_000 },
    )
    .toBe(true);
}

async function postOutcome(
  fixture: DrawingFixture,
  operation: DrawingCollaborationOperation,
  sequence: number,
  resultVersions: Record<string, number>,
) {
  const body = JSON.stringify({
    receiptId: operation.clientOperationId,
    roomName: roomName(fixture),
    operationId: operation.clientOperationId,
    operation,
    outcome: "acked",
    authoritativeSequence: sequence,
    resultVersions,
  });
  const signature = createHmac(
    "sha256",
    credentials.COLLABORATION_INTERNAL_SECRET,
  )
    .update(body)
    .digest("hex");
  const response = await fetch(
    new URL("/internal/outcomes", credentials.COLLABORATION_INTERNAL_URL),
    {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        "x-1hk-signature": signature,
      },
    },
  );
  if (!response.ok)
    throw new Error(`Outcome receipt failed with ${response.status}.`);
}

async function postFreeze(
  fixture: DrawingFixture,
  action: "freeze" | "release",
  requestId: string,
) {
  const response = await fetch(
    new URL("/internal/freeze", credentials.COLLABORATION_INTERNAL_URL),
    {
      method: "POST",
      body: JSON.stringify({
        action,
        roomName: roomName(fixture),
        freezeRequestId: requestId,
      }),
      headers: {
        "content-type": "application/json",
        "x-1hk-freeze-secret": credentials.COLLABORATION_FREEZE_SECRET,
      },
    },
  );
  if (!response.ok)
    throw new Error(`${action} failed with ${response.status}.`);
  return response.json() as Promise<{ freezeState: string }>;
}

test.describe.serial("deployed drawing collaboration service smoke", () => {
  let fixture: DrawingFixture | undefined;

  test.beforeAll(async () => {
    fixture = await createDrawingFixture({
      p3RunId: credentials.P3_E2E_RUN_ID,
    });
  });

  test.afterAll(async () => {
    await destroyDrawingP3Fixture(
      fixture,
      credentials.P3_E2E_DATABASE_ADMIN_URL,
    );
  });

  test("authenticated admission, non-member rejection, store/reload, outcome receipt, freeze/release, restart, and SIGTERM drain", async () => {
    if (!fixture)
      throw new Error("Collaboration smoke fixture is unavailable.");
    await requireHealth();
    await requireNonMemberRejection(fixture);

    const connection = await connect(fixture, fixture.editor);
    const objectId = randomUUID();
    const operation: DrawingCollaborationOperation = {
      actorId: fixture.editor.id,
      schemaVersion: 1,
      clientOperationId: randomUUID(),
      revisionId: fixture.blankWorkspace.revisionId,
      type: "add_objects",
      baseVersions: {},
      forward: {
        type: "add_objects",
        objects: [
          {
            id: objectId,
            name: "P3 deployed service smoke",
            layerId: fixture.blankWorkspace.workLayerId,
            geometry: {
              type: "circle",
              center: { x: 32, y: 24 },
              radius: 4,
            },
            style: { stroke: "#2563eb", strokeWidth: 1, fill: null },
            version: 1,
          },
        ],
      },
      inverse: { type: "delete_objects", objectIds: [objectId] },
      createdAt: new Date().toISOString(),
    };
    appendDrawingCollaborationOperation(connection.document, operation);
    await connection.provider.flushPendingUpdates();
    const applied = await connection.client.rpc(
      "lukas_drawing_apply_operation",
      {
        p_revision_id: operation.revisionId,
        p_client_operation_id: operation.clientOperationId,
        p_operation_type: operation.type,
        p_base_versions: operation.baseVersions,
        p_forward: operation.forward,
        p_inverse: operation.inverse,
      },
    );
    if (applied.error) throw applied.error;
    const result = applied.data as {
      sequence: number;
      resultVersions: Record<string, number>;
    };
    await postOutcome(
      fixture,
      operation,
      result.sequence,
      result.resultVersions,
    );
    await expect
      .poll(
        () =>
          connection.document
            .getMap<{ status?: string }>("operationStatus")
            .get(operation.clientOperationId)?.status,
      )
      .toBe("acked");

    const freezeRequestId = randomUUID();
    await expect(
      postFreeze(fixture, "freeze", freezeRequestId),
    ).resolves.toMatchObject({
      freezeState: "frozen",
    });
    await expect(
      postFreeze(fixture, "release", freezeRequestId),
    ).resolves.toMatchObject({
      freezeState: "released",
    });
    runLifecycle(restartCommand);
    await connection.waitForClose();
    connection.dispose();
    await requireHealth();
    const afterRestart = await connect(fixture, fixture.editor);
    expect(
      afterRestart.document.getArray<string>("operationOrder").toArray(),
    ).toContain(operation.clientOperationId);

    runLifecycle(sigtermCommand);
    await afterRestart.waitForClose();
    afterRestart.dispose();
    runLifecycle(restartCommand);
    await requireHealth();
    const afterDrain = await connect(fixture, fixture.editor);
    expect(
      afterDrain.document
        .getMap("operationStatus")
        .get(operation.clientOperationId),
    ).toMatchObject({ status: "acked" });
    afterDrain.dispose();
  });
});
