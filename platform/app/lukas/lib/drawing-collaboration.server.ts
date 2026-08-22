import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "database.types";
import { redirect } from "react-router";
import { z } from "zod";

import makeServerClient from "../../core/lib/supa-client.server.ts";

import {
  DrawingAnchorSchema,
  DrawingCommentSchema,
  DrawingIssueCreateSchema,
  DrawingPrioritySchema,
  DrawingStatusSchema,
} from "./drawing-collaboration.types.ts";
import type {
  DrawingAnchorInput,
  DrawingFile,
  DrawingIssue,
} from "./drawing-collaboration.types.ts";

type ProjectMemberRow = {
  project_id: string;
  user_id: string;
  role: string;
  created_at: string;
};
type DrawingAnchorRow = {
  id: string;
  issue_id: string;
  project_id: string;
  file_id: string;
  anchor_kind: "ifc_element" | "pdf_region";
  element_id: string | null;
  ifc_global_id: string | null;
  camera_json: Json | null;
  page_number: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
  label: string;
  active: boolean;
  created_by: string;
  created_at: string;
  deactivated_by: string | null;
  deactivated_at: string | null;
  deactivation_note: string | null;
};
type DrawingCommentRow = {
  id: string;
  issue_id: string;
  project_id: string;
  author_id: string;
  body: string;
  created_at: string;
};
type DrawingEventRow = {
  id: string;
  issue_id: string;
  project_id: string;
  actor_id: string | null;
  event_type: string;
  from_value: unknown;
  to_value: unknown;
  note: string;
  created_at: string;
};
type TableDefinition<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};
type DrawingDatabase = Omit<Database, "public"> & {
  public: Omit<Database["public"], "Tables"> & {
    Tables: Database["public"]["Tables"] & {
      lukas_qto_project_members: TableDefinition<
        ProjectMemberRow,
        Omit<ProjectMemberRow, "created_at"> & { created_at?: string },
        { role?: string }
      >;
      lukas_drawing_issues: TableDefinition<
        DrawingIssue,
        Pick<DrawingIssue, "project_id" | "title" | "description" | "priority" | "created_by"> & {
          assignee_user_id?: string | null;
          due_at?: string | null;
        },
        Partial<Pick<DrawingIssue, "status" | "priority" | "assignee_user_id" | "due_at">>
      >;
      lukas_drawing_issue_anchors: TableDefinition<
        DrawingAnchorRow,
        Omit<DrawingAnchorRow, "id" | "created_at" | "active" | "deactivated_by" | "deactivated_at" | "deactivation_note">,
        { active?: boolean; deactivation_note?: string }
      >;
      lukas_drawing_issue_comments: TableDefinition<
        DrawingCommentRow,
        Omit<DrawingCommentRow, "id" | "created_at">,
        never
      >;
      lukas_drawing_issue_events: TableDefinition<DrawingEventRow, never, never>;
    };
  };
};

type DrawingClient = SupabaseClient<DrawingDatabase>;

const SetStatusMutationSchema = z.object({
  intent: z.literal("set_status"),
  issueId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  status: DrawingStatusSchema,
});

const CreateIssueMutationSchema = DrawingIssueCreateSchema.extend({
  intent: z.literal("create_issue"),
});
const AddAnchorMutationSchema = z.object({
  intent: z.literal("add_anchor"),
  issueId: z.string().uuid(),
  anchor: DrawingAnchorSchema,
});
const CommentMutationSchema = DrawingCommentSchema.extend({
  intent: z.literal("comment"),
});
const versionedIssueMutation = {
  issueId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
};
const SetAssigneeMutationSchema = z.object({
  intent: z.literal("set_assignee"),
  ...versionedIssueMutation,
  assigneeUserId: z.string().uuid().nullable(),
});
const SetDueMutationSchema = z.object({
  intent: z.literal("set_due"),
  ...versionedIssueMutation,
  dueAt: z.string().datetime({ offset: true }).nullable(),
});
const SetPriorityMutationSchema = z.object({
  intent: z.literal("set_priority"),
  ...versionedIssueMutation,
  priority: DrawingPrioritySchema,
});
const DeactivateAnchorMutationSchema = z.object({
  intent: z.literal("deactivate_anchor"),
  anchorId: z.string().uuid(),
  note: z.string().trim().min(1).max(1000),
});

const DrawingMutationSchema = z.discriminatedUnion("intent", [
  SetStatusMutationSchema,
  CreateIssueMutationSchema,
  AddAnchorMutationSchema,
  CommentMutationSchema,
  SetAssigneeMutationSchema,
  SetDueMutationSchema,
  SetPriorityMutationSchema,
  DeactivateAnchorMutationSchema,
]);

export type DrawingMutation = z.infer<typeof DrawingMutationSchema>;

function optionalFormString(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function optionalDueAt(value: FormDataEntryValue | null): string | null {
  const due = optionalFormString(value);
  if (!due) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? `${due}T23:59:59+09:00` : due;
}

export function parseDrawingMutationForm(form: FormData): DrawingMutation {
  const intent = form.get("intent");
  if (intent === "create_issue")
    return DrawingMutationSchema.parse({
      intent,
      title: form.get("title"),
      description: form.get("description") ?? "",
      priority: form.get("priority") ?? "normal",
      assigneeUserId: optionalFormString(form.get("assignee_user_id")),
      dueAt: optionalDueAt(form.get("due_at")),
    });
  if (intent === "add_anchor") {
    const anchorJson = form.get("anchor_json");
    if (typeof anchorJson !== "string") throw new Error("앵커 근거가 없습니다.");
    let anchor: unknown;
    try {
      anchor = JSON.parse(anchorJson);
    } catch {
      throw new Error("앵커 근거 JSON 형식이 올바르지 않습니다.");
    }
    return DrawingMutationSchema.parse({
      intent,
      issueId: form.get("issue_id"),
      anchor,
    });
  }
  if (intent === "comment")
    return DrawingMutationSchema.parse({
      intent,
      issueId: form.get("issue_id"),
      body: form.get("body"),
    });
  if (intent === "set_assignee")
    return DrawingMutationSchema.parse({
      intent,
      issueId: form.get("issue_id"),
      expectedVersion: Number(form.get("expected_version")),
      assigneeUserId: optionalFormString(form.get("assignee_user_id")),
    });
  if (intent === "set_due")
    return DrawingMutationSchema.parse({
      intent,
      issueId: form.get("issue_id"),
      expectedVersion: Number(form.get("expected_version")),
      dueAt: optionalDueAt(form.get("due_at")),
    });
  if (intent === "set_priority")
    return DrawingMutationSchema.parse({
      intent,
      issueId: form.get("issue_id"),
      expectedVersion: Number(form.get("expected_version")),
      priority: form.get("priority"),
    });
  if (intent === "deactivate_anchor")
    return DrawingMutationSchema.parse({
      intent,
      anchorId: form.get("anchor_id"),
      note: form.get("note"),
    });
  return DrawingMutationSchema.parse({
    intent,
    issueId: form.get("issue_id"),
    expectedVersion: Number(form.get("expected_version")),
    status: form.get("status"),
  });
}

export async function drawingContext(request: Request, projectId: string) {
  const [baseClient, headers] = makeServerClient(request);
  const {
    data: { user },
  } = await baseClient.auth.getUser();
  if (!user || user.is_anonymous) throw redirect("/login");

  const { data: project } = await baseClient
    .from("lukas_qto_projects")
    .select("id, name, owner_id")
    .eq("id", projectId)
    .single();
  if (!project)
    throw new Response("프로젝트를 찾을 수 없습니다.", { status: 404 });

  const client = baseClient as unknown as DrawingClient;
  let role: string | null = null;
  if (user.app_metadata.role === "hangil_staff") role = "staff";
  else if (project.owner_id === user.id) role = "owner";
  else {
    const { data: membership } = await client
      .from("lukas_qto_project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", user.id)
      .maybeSingle();
    role = membership?.role ?? null;
  }
  if (!role) throw new Response("프로젝트 접근 권한이 없습니다.", { status: 403 });
  return { client, headers, project, role, user };
}

export async function listDrawingFiles(client: DrawingClient, projectId: string) {
  const { data, error } = await client
    .from("lukas_qto_files")
    .select(
      "id, project_id, kind, original_filename, storage_path, content_type, byte_size, sha256, created_at",
    )
    .eq("project_id", projectId)
    .in("kind", ["ifc", "pdf"])
    .order("created_at", { ascending: false });
  if (error) throw new Error(`도면 파일을 불러오지 못했습니다: ${error.message}`);
  return (data ?? []) as DrawingFile[];
}

export async function loadDrawingRoom(
  client: DrawingClient,
  projectId: string,
  fileId: string,
) {
  const { data: file, error: fileError } = await client
    .from("lukas_qto_files")
    .select(
      "id, project_id, kind, original_filename, storage_path, content_type, byte_size, sha256, created_at",
    )
    .eq("project_id", projectId)
    .eq("id", fileId)
    .in("kind", ["ifc", "pdf"])
    .single();
  if (fileError || !file)
    throw new Response("도면 원본을 찾을 수 없습니다.", { status: 404 });

  const { data: issues, error: issueError } = await client
    .from("lukas_drawing_issues")
    .select("*")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
  if (issueError) throw new Error(`도면 이슈를 불러오지 못했습니다: ${issueError.message}`);
  const issueIds = (issues ?? []).map((issue) => issue.id);
  if (issueIds.length === 0)
    return {
      file: file as DrawingFile,
      issues: [] as DrawingIssue[],
      anchors: [] as DrawingAnchorRow[],
      comments: [] as DrawingCommentRow[],
      events: [] as DrawingEventRow[],
    };

  const [anchorsResult, commentsResult, eventsResult] = await Promise.all([
    client
      .from("lukas_drawing_issue_anchors")
      .select("*")
      .in("issue_id", issueIds)
      .order("created_at"),
    client
      .from("lukas_drawing_issue_comments")
      .select("*")
      .in("issue_id", issueIds)
      .order("created_at"),
    client
      .from("lukas_drawing_issue_events")
      .select("*")
      .in("issue_id", issueIds)
      .order("created_at"),
  ]);
  const error = anchorsResult.error ?? commentsResult.error ?? eventsResult.error;
  if (error) throw new Error(`도면 이슈 근거를 불러오지 못했습니다: ${error.message}`);
  return {
    file: file as DrawingFile,
    issues: issues ?? [],
    anchors: anchorsResult.data ?? [],
    comments: commentsResult.data ?? [],
    events: eventsResult.data ?? [],
  };
}

function anchorInsert(
  projectId: string,
  issueId: string,
  actorId: string,
  anchor: DrawingAnchorInput,
): DrawingDatabase["public"]["Tables"]["lukas_drawing_issue_anchors"]["Insert"] {
  if (anchor.kind === "ifc_element")
    return {
      issue_id: issueId,
      project_id: projectId,
      file_id: anchor.fileId,
      anchor_kind: anchor.kind,
      element_id: anchor.elementId,
      ifc_global_id: anchor.ifcGlobalId,
      camera_json: anchor.camera,
      page_number: null,
      x: null,
      y: null,
      width: null,
      height: null,
      label: anchor.label,
      created_by: actorId,
    };
  return {
    issue_id: issueId,
    project_id: projectId,
    file_id: anchor.fileId,
    anchor_kind: anchor.kind,
    element_id: null,
    ifc_global_id: null,
    camera_json: null,
    page_number: anchor.pageNumber,
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
    label: anchor.label,
    created_by: actorId,
  };
}

export async function mutateDrawingIssue(
  client: DrawingClient,
  actorId: string,
  projectId: string,
  input: DrawingMutation,
) {
  if (input.intent === "create_issue") {
    const { data, error } = await client
      .from("lukas_drawing_issues")
      .insert({
        project_id: projectId,
        title: input.title,
        description: input.description,
        priority: input.priority,
        assignee_user_id: input.assigneeUserId,
        due_at: input.dueAt,
        created_by: actorId,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
  if (input.intent === "add_anchor") {
    const { data, error } = await client
      .from("lukas_drawing_issue_anchors")
      .insert(anchorInsert(projectId, input.issueId, actorId, input.anchor))
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
  if (input.intent === "comment") {
    const { data, error } = await client
      .from("lukas_drawing_issue_comments")
      .insert({
        issue_id: input.issueId,
        project_id: projectId,
        author_id: actorId,
        body: input.body,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
  if (input.intent === "deactivate_anchor") {
    const { data, error } = await client
      .from("lukas_drawing_issue_anchors")
      .update({ active: false, deactivation_note: input.note })
      .eq("project_id", projectId)
      .eq("id", input.anchorId)
      .eq("active", true)
      .select()
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Response("앵커가 이미 비활성화됐거나 존재하지 않습니다.", { status: 409 });
    return data;
  }
  const update =
    input.intent === "set_status"
      ? { status: input.status }
      : input.intent === "set_assignee"
        ? { assignee_user_id: input.assigneeUserId }
        : input.intent === "set_due"
          ? { due_at: input.dueAt }
          : { priority: input.priority };
  const { data, error } = await client
    .from("lukas_drawing_issues")
    .update(update)
    .eq("project_id", projectId)
    .eq("id", input.issueId)
    .eq("version", input.expectedVersion)
    .select()
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Response("다른 사용자가 먼저 이슈를 변경했습니다. 새로고침 후 다시 시도하세요.", {
      status: 409,
    });
  return data;
}
