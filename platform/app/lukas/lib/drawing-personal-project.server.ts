import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  DrawingWorkspaceConflictError,
  DrawingWorkspaceRejectedError,
  DrawingWorkspaceRetryableError,
  DrawingWorkspaceRpcError,
} from "./drawing-workspace.server.ts";

const PersonalProject = z
  .object({
    projectId: z.string().uuid(),
    organizationId: z.string().uuid(),
  })
  .strict();

const conflictCodes = new Set(["23505", "23P01", "P1C01"]);
const retryableCodes = new Set(["40001", "40P01", "P1T01"]);

export async function ensurePersonalDrawingProject(
  client: SupabaseClient<any>,
): Promise<{ projectId: string; organizationId: string }> {
  const { data, error } = await client.rpc(
    "lukas_drawing_ensure_personal_project",
  );
  if (error) {
    if (error.code === "P1R01")
      throw new DrawingWorkspaceRejectedError(error.message);
    if (conflictCodes.has(error.code))
      throw new DrawingWorkspaceConflictError(error.message);
    if (retryableCodes.has(error.code))
      throw new DrawingWorkspaceRetryableError(error.message);
    throw new DrawingWorkspaceRpcError(error.message);
  }
  return PersonalProject.parse(data);
}
