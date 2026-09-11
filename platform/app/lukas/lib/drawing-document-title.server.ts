import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  DrawingWorkspaceConflictError,
  DrawingWorkspaceRejectedError,
  type DrawingWorkspaceCapability,
} from "~/lukas/lib/drawing-workspace.server";

const titleSchema = z.string().trim().min(1).max(160);
const titleMutationSchema = z
  .object({
    intent: z.literal("rename_drawing_document"),
    expectedTitle: z.string().min(1).max(240),
    title: titleSchema,
  })
  .strict();

const renamedDocumentSchema = z
  .object({ id: z.string().uuid(), title: titleSchema })
  .strict();

export function parseDrawingDocumentTitleForm(form: FormData) {
  const fields = ["intent", "expectedTitle", "title"];
  if (
    [...form.keys()].some((field) => !fields.includes(field)) ||
    fields.some((field) => form.getAll(field).length !== 1)
  )
    return titleMutationSchema.parse({});
  return titleMutationSchema.parse(Object.fromEntries(form));
}

export function assertDrawingDocumentTitleScope(
  capability: DrawingWorkspaceCapability,
  revisionStatus: string,
) {
  if (capability !== "admin" && capability !== "editor")
    throw new DrawingWorkspaceRejectedError(
      "도면 이름을 변경할 권한이 없습니다.",
    );
  if (revisionStatus !== "draft")
    throw new DrawingWorkspaceConflictError(
      "초안 개정에서만 도면 이름을 변경할 수 있습니다.",
    );
}

export async function renameDrawingDocumentFromWorkspaceAction({
  client,
  capability,
  form,
  projectId,
  workspace,
}: {
  client: SupabaseClient<any>;
  capability: DrawingWorkspaceCapability;
  form: FormData;
  projectId: string;
  workspace: {
    document: { id: string; revision: { status: string } };
  };
}) {
  const mutation = parseDrawingDocumentTitleForm(form);
  assertDrawingDocumentTitleScope(
    capability,
    workspace.document.revision.status,
  );
  return renameDrawingDocument(client, {
    projectId,
    documentId: workspace.document.id,
    expectedTitle: mutation.expectedTitle,
    title: mutation.title,
  });
}

export async function renameDrawingDocument(
  client: SupabaseClient<any>,
  input: {
    projectId: string;
    documentId: string;
    expectedTitle: string;
    title: string;
  },
) {
  const parsed = z
    .object({
      projectId: z.string().uuid(),
      documentId: z.string().uuid(),
      expectedTitle: z.string().min(1).max(240),
      title: titleSchema,
    })
    .strict()
    .parse(input);
  const { data, error } = await client
    .from("lukas_drawing_documents")
    .update({ title: parsed.title })
    .eq("project_id", parsed.projectId)
    .eq("id", parsed.documentId)
    .eq("title", parsed.expectedTitle)
    .select("id,title")
    .maybeSingle();
  if (error) throw new DrawingWorkspaceRejectedError(error.message);
  if (!data)
    throw new DrawingWorkspaceConflictError(
      "도면 이름이 이미 변경되었거나 현재 상태에서 변경할 수 없습니다.",
    );
  return renamedDocumentSchema.parse(data);
}
