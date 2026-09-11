import assert from "node:assert/strict";
import test from "node:test";

import {
  DrawingWorkspaceConflictError,
  DrawingWorkspaceRejectedError,
  DrawingWorkspaceRetryableError,
  DrawingWorkspaceRpcError,
} from "../app/lukas/lib/drawing-workspace.server.ts";
import { ensurePersonalDrawingProject } from "../app/lukas/lib/drawing-personal-project.server.ts";

const projectId = "91000000-0000-4000-8000-000000000001";
const organizationId = "91000000-0000-4000-8000-000000000002";

function clientResult(result) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(...args) {
        calls.push(args);
        return result;
      },
    },
  };
}

test("personal drawing project RPC accepts no browser identity and returns strict UUIDs", async () => {
  const fake = clientResult({
    data: { projectId, organizationId },
    error: null,
  });

  assert.deepEqual(await ensurePersonalDrawingProject(fake.client), {
    projectId,
    organizationId,
  });
  assert.deepEqual(fake.calls, [["lukas_drawing_ensure_personal_project"]]);
});

test("personal drawing project RPC classifies bounded database failures", async () => {
  for (const [code, ErrorType] of [
    ["P1R01", DrawingWorkspaceRejectedError],
    ["P1C01", DrawingWorkspaceConflictError],
    ["23505", DrawingWorkspaceConflictError],
    ["40001", DrawingWorkspaceRetryableError],
    ["40P01", DrawingWorkspaceRetryableError],
    ["P1T01", DrawingWorkspaceRetryableError],
    ["XX000", DrawingWorkspaceRpcError],
  ]) {
    const fake = clientResult({
      data: null,
      error: { code, message: `failure ${code}` },
    });
    await assert.rejects(
      ensurePersonalDrawingProject(fake.client),
      (error) =>
        error instanceof ErrorType && error.message === `failure ${code}`,
      code,
    );
  }
});

test("personal drawing project RPC rejects null and malformed success payloads", async () => {
  for (const data of [
    null,
    {},
    { projectId: "not-a-uuid", organizationId },
    { projectId, organizationId, ownerId: projectId },
  ]) {
    const fake = clientResult({ data, error: null });
    await assert.rejects(
      ensurePersonalDrawingProject(fake.client),
      (error) => error?.name === "ZodError",
      JSON.stringify(data),
    );
  }
});
