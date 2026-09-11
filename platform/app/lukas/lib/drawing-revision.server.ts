import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { DrawingClient } from "./drawing-collaboration.server.ts";

type RevisionReviewDatabase = {
  public: {
    Tables: {
      lukas_qto_file_revisions: {
        Row: {
          project_id: string;
          previous_file_id: string;
          current_file_id: string;
          relation_kind: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      lukas_drawing_issue_anchors: {
        Row: {
          id: string;
          issue_id: string;
          project_id: string;
          file_id: string;
          anchor_kind: "ifc_element" | "pdf_region";
          element_id: string | null;
          ifc_global_id: string | null;
          camera_json: unknown;
          page_number: number | null;
          x: number | null;
          y: number | null;
          width: number | null;
          height: number | null;
          label: string;
          active: boolean;
          deactivation_note: string | null;
          replaces_anchor_id: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      lukas_drawing_issues: {
        Row: {
          id: string;
          project_id: string;
          title: string;
          status: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      lukas_qto_element_identity_links: {
        Row: {
          project_id: string;
          ifc_file_id: string;
          ifc_global_id: string;
          revit_element_id: number;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      lukas_drawing_relink_issue_anchor: {
        Args: {
          p_previous_anchor_id: string;
          p_new_anchor_id: string;
          p_current_file_id: string;
          p_anchor: unknown;
          p_note: string;
        };
        Returns: unknown;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type DrawingRevisionReviewItem = {
  issueId: string;
  issueTitle: string;
  previousAnchorId: string;
  previousFileId: string;
  sourceKind: "ifc_element" | "pdf_region";
  kind: "ifc_candidate" | "manual_reanchor_required";
  ifcGlobalId: string | null;
};

export const drawingRevisionReviewBatchSize = 50;

export type DrawingRevisionReviewPage = {
  items: DrawingRevisionReviewItem[];
  nextCursor: string | null;
  previousCursor: string | null;
};

export function parseDrawingRevisionReviewCursor(value: string | null) {
  return value === null ? null : z.string().uuid().parse(value);
}

export async function assertGenericDrawingAnchorMutationAllowed(
  baseClient: DrawingClient,
  projectId: string,
  input:
    | { intent: "add_anchor"; issueId: string }
    | { intent: "deactivate_anchor"; anchorId: string },
) {
  const client =
    baseClient as unknown as SupabaseClient<RevisionReviewDatabase>;
  let revision:
    | RevisionReviewDatabase["public"]["Tables"]["lukas_qto_file_revisions"]["Row"]
    | null = null;

  if (input.intent === "add_anchor") {
    const predecessorResult = await client
      .from("lukas_drawing_issue_anchors")
      .select("id,issue_id,project_id,file_id,active")
      .eq("project_id", projectId)
      .eq("issue_id", input.issueId)
      .eq("active", true);
    if (predecessorResult.error)
      throw new Error(
        `이전 도면 근거를 확인하지 못했습니다: ${predecessorResult.error.message}`,
      );
    const previousFileIds = [
      ...new Set(
        (predecessorResult.data ?? []).map((anchor) => anchor.file_id),
      ),
    ];
    if (!previousFileIds.length) return;
    const revisionResult = await client
      .from("lukas_qto_file_revisions")
      .select("project_id,previous_file_id,current_file_id,relation_kind")
      .eq("project_id", projectId)
      .eq("relation_kind", "supersedes")
      .in("previous_file_id", previousFileIds);
    if (revisionResult.error)
      throw new Error(
        `도면 개정 관계를 확인하지 못했습니다: ${revisionResult.error.message}`,
      );
    revision = revisionResult.data?.[0] ?? null;
    if (!revision) return;
  } else {
    const anchorResult = await client
      .from("lukas_drawing_issue_anchors")
      .select("id,issue_id,project_id,file_id,active")
      .eq("project_id", projectId)
      .eq("id", input.anchorId)
      .eq("active", true)
      .maybeSingle();
    if (anchorResult.error)
      throw new Error(
        `도면 근거를 확인하지 못했습니다: ${anchorResult.error.message}`,
      );
    if (!anchorResult.data) return;
    const revisionResult = await client
      .from("lukas_qto_file_revisions")
      .select("project_id,previous_file_id,current_file_id,relation_kind")
      .eq("project_id", projectId)
      .eq("previous_file_id", anchorResult.data.file_id)
      .eq("relation_kind", "supersedes")
      .maybeSingle();
    if (revisionResult.error)
      throw new Error(
        `도면 개정 관계를 확인하지 못했습니다: ${revisionResult.error.message}`,
      );
    revision = revisionResult.data;
    if (!revision) return;
  }

  throw new Error(
    "개정 검토 근거는 후보 확인 후 원자적 교체로만 변경할 수 있습니다.",
  );
}

const Uuid = z.string().uuid();
const RelinkPdfAnchorSchema = z
  .object({
    kind: z.literal("pdf_region"),
    fileId: Uuid,
    pageNumber: z.number().int().positive(),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
    label: z.string().max(240),
  })
  .strict()
  .refine((anchor) => anchor.x + anchor.width <= 1)
  .refine((anchor) => anchor.y + anchor.height <= 1);
const RelinkIfcAnchorSchema = z
  .object({
    kind: z.literal("ifc_element"),
    fileId: Uuid,
    elementId: z.string().regex(/^[1-9][0-9]*$/),
    ifcGlobalId: z.string().regex(/^[0-9A-Za-z_$]{22}$/),
    camera: z
      .object({
        position: z.tuple([
          z.number().finite(),
          z.number().finite(),
          z.number().finite(),
        ]),
        target: z.tuple([
          z.number().finite(),
          z.number().finite(),
          z.number().finite(),
        ]),
      })
      .strict(),
    label: z.string().max(240),
  })
  .strict();
const RelinkDrawingAnchorInputSchema = z
  .object({
    previousAnchorId: Uuid,
    newAnchorId: Uuid,
    currentFileId: Uuid,
    anchor: z.union([RelinkPdfAnchorSchema, RelinkIfcAnchorSchema]),
    note: z.string().trim().min(1).max(1000),
  })
  .strict()
  .refine((input) => input.anchor.fileId === input.currentFileId);
const RelinkDrawingAnchorResultSchema = z
  .object({ previousAnchorId: Uuid, newAnchorId: Uuid })
  .strict();

export type RelinkDrawingAnchorInput = z.infer<
  typeof RelinkDrawingAnchorInputSchema
>;

export class DrawingRevisionRelinkError extends Error {
  readonly kind: "forbidden" | "rejected" | "conflict" | "retryable";
  readonly code: string;

  constructor(
    kind: "forbidden" | "rejected" | "conflict" | "retryable",
    code: string,
  ) {
    super(
      kind === "forbidden"
        ? "도면 근거를 새 개정본에 연결할 권한이 없습니다."
        : kind === "rejected"
          ? "현재 작업실의 정확한 개정 관계에서만 근거를 연결할 수 있습니다."
          : kind === "conflict"
            ? "도면 근거가 이미 변경되었습니다. 최신 상태를 다시 확인해 주세요."
            : "도면 근거 연결이 일시적으로 지연되었습니다. 같은 요청으로 다시 시도해 주세요.",
    );
    this.name = "DrawingRevisionRelinkError";
    this.kind = kind;
    this.code = code;
  }
}

function drawingRevisionRelinkError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "UNKNOWN";
  return new DrawingRevisionRelinkError(
    code === "42501"
      ? "forbidden"
      : code === "P1R01"
        ? "rejected"
        : code === "P1C01"
          ? "conflict"
          : "retryable",
    code,
  );
}

export function parseRelinkDrawingAnchorForm(
  form: FormData,
): RelinkDrawingAnchorInput {
  const anchorJson = form.get("anchor_json");
  if (form.get("intent") !== "relink_anchor" || typeof anchorJson !== "string")
    throw new Error("새 도면 근거 후보가 없습니다.");
  let anchor: unknown;
  try {
    anchor = JSON.parse(anchorJson);
  } catch {
    throw new Error("새 도면 근거 후보 형식이 올바르지 않습니다.");
  }
  return RelinkDrawingAnchorInputSchema.parse({
    previousAnchorId: form.get("previous_anchor_id"),
    newAnchorId: form.get("new_anchor_id"),
    currentFileId: form.get("current_file_id"),
    anchor,
    note: form.get("note"),
  });
}

export async function relinkDrawingIssueAnchor(
  baseClient: DrawingClient,
  input: RelinkDrawingAnchorInput,
): Promise<z.infer<typeof RelinkDrawingAnchorResultSchema>> {
  const value = RelinkDrawingAnchorInputSchema.parse(input);
  const client =
    baseClient as unknown as SupabaseClient<RevisionReviewDatabase>;
  const { data, error } = await client.rpc(
    "lukas_drawing_relink_issue_anchor",
    {
      p_previous_anchor_id: value.previousAnchorId,
      p_new_anchor_id: value.newAnchorId,
      p_current_file_id: value.currentFileId,
      p_anchor: value.anchor,
      p_note: value.note,
    },
  );
  if (error) throw drawingRevisionRelinkError(error);
  return RelinkDrawingAnchorResultSchema.parse(data);
}

function sameRelinkCamera(
  value: unknown,
  expected: { position: number[]; target: number[] },
) {
  if (!value || typeof value !== "object") return false;
  const camera = value as { position?: unknown; target?: unknown };
  return (["position", "target"] as const).every((key) => {
    const tuple = camera[key];
    return (
      Array.isArray(tuple) &&
      tuple.length === 3 &&
      tuple.every((item, index) => Number(item) === expected[key][index])
    );
  });
}

export async function loadDrawingRevisionRelinkReplay(
  baseClient: DrawingClient,
  input: RelinkDrawingAnchorInput,
): Promise<z.infer<typeof RelinkDrawingAnchorResultSchema> | null> {
  const value = RelinkDrawingAnchorInputSchema.parse(input);
  const client =
    baseClient as unknown as SupabaseClient<RevisionReviewDatabase>;
  const select =
    "id,issue_id,project_id,file_id,anchor_kind,element_id,ifc_global_id,camera_json,page_number,x,y,width,height,label,active,deactivation_note,replaces_anchor_id";
  const { data: replacement, error: replacementError } = await client
    .from("lukas_drawing_issue_anchors")
    .select(select)
    .eq("id", value.newAnchorId)
    .maybeSingle();
  if (replacementError) throw drawingRevisionRelinkError(replacementError);
  if (!replacement) return null;
  const { data: previous, error: previousError } = await client
    .from("lukas_drawing_issue_anchors")
    .select(select)
    .eq("id", value.previousAnchorId)
    .maybeSingle();
  if (previousError) throw drawingRevisionRelinkError(previousError);
  const anchorMatches =
    value.anchor.kind === "pdf_region"
      ? replacement.page_number === value.anchor.pageNumber &&
        Number(replacement.x) === value.anchor.x &&
        Number(replacement.y) === value.anchor.y &&
        Number(replacement.width) === value.anchor.width &&
        Number(replacement.height) === value.anchor.height
      : replacement.element_id === value.anchor.elementId &&
        replacement.ifc_global_id === value.anchor.ifcGlobalId &&
        sameRelinkCamera(replacement.camera_json, value.anchor.camera);
  if (
    !previous ||
    previous.active ||
    previous.deactivation_note !== value.note ||
    !replacement.active ||
    replacement.replaces_anchor_id !== value.previousAnchorId ||
    replacement.issue_id !== previous.issue_id ||
    replacement.project_id !== previous.project_id ||
    replacement.file_id !== value.currentFileId ||
    replacement.anchor_kind !== value.anchor.kind ||
    replacement.label !== value.anchor.label ||
    !anchorMatches
  )
    throw new DrawingRevisionRelinkError("conflict", "P1C01");
  return RelinkDrawingAnchorResultSchema.parse({
    previousAnchorId: value.previousAnchorId,
    newAnchorId: value.newAnchorId,
  });
}

export async function loadDrawingRevisionReview(
  baseClient: DrawingClient,
  projectId: string,
  currentFileId: string,
): Promise<DrawingRevisionReviewItem[]> {
  return (
    await loadDrawingRevisionReviewPage(baseClient, projectId, currentFileId)
  ).items;
}

export async function loadDrawingRevisionReviewPage(
  baseClient: DrawingClient,
  projectId: string,
  currentFileId: string,
  afterAnchorId: string | null = null,
): Promise<DrawingRevisionReviewPage> {
  const client =
    baseClient as unknown as SupabaseClient<RevisionReviewDatabase>;
  const { data: revision, error: revisionError } = await client
    .from("lukas_qto_file_revisions")
    .select("previous_file_id,current_file_id,project_id")
    .eq("project_id", projectId)
    .eq("current_file_id", currentFileId)
    .maybeSingle();
  if (revisionError)
    throw new Error(
      `도면 개정 관계를 불러오지 못했습니다: ${revisionError.message}`,
    );
  if (!revision) return { items: [], nextCursor: null, previousCursor: null };

  const anchorQuery = client
    .from("lukas_drawing_issue_anchors")
    .select("id,issue_id,file_id,anchor_kind,ifc_global_id,active")
    .eq("file_id", revision.previous_file_id)
    .eq("active", true)
    .order("id");
  const { data: loadedAnchors, error: anchorError } = afterAnchorId
    ? await anchorQuery
        .gt("id", afterAnchorId)
        .limit(drawingRevisionReviewBatchSize + 1)
    : await anchorQuery.limit(drawingRevisionReviewBatchSize + 1);
  if (anchorError)
    throw new Error(
      `이전 도면 근거를 불러오지 못했습니다: ${anchorError.message}`,
    );
  if (!loadedAnchors?.length)
    return { items: [], nextCursor: null, previousCursor: null };
  const hasMore = loadedAnchors.length > drawingRevisionReviewBatchSize;
  const anchors = loadedAnchors.slice(0, drawingRevisionReviewBatchSize);
  const previousCursor = afterAnchorId
    ? await (async () => {
        const { data: previousAnchors, error: previousAnchorError } =
          await client
            .from("lukas_drawing_issue_anchors")
            .select("id")
            .eq("file_id", revision.previous_file_id)
            .eq("active", true)
            .lt("id", afterAnchorId)
            .order("id", { ascending: false })
            .limit(drawingRevisionReviewBatchSize);
        if (previousAnchorError)
          throw new Error(
            `이전 도면 근거를 불러오지 못했습니다: ${previousAnchorError.message}`,
          );
        return previousAnchors?.length === drawingRevisionReviewBatchSize
          ? (previousAnchors.at(-1)?.id ?? null)
          : null;
      })()
    : null;

  const issueIds = [...new Set(anchors.map((anchor) => anchor.issue_id))];
  const { data: issues, error: issueError } = await client
    .from("lukas_drawing_issues")
    .select("id,project_id,title,status")
    .eq("project_id", projectId)
    .in("id", issueIds);
  if (issueError)
    throw new Error(`재검토 이슈를 불러오지 못했습니다: ${issueError.message}`);
  const issueById = new Map((issues ?? []).map((issue) => [issue.id, issue]));

  const globalIds = [
    ...new Set(
      anchors
        .filter((anchor) => anchor.anchor_kind === "ifc_element")
        .map((anchor) => anchor.ifc_global_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const identityRows = globalIds.length
    ? await client
        .from("lukas_qto_element_identity_links")
        .select("project_id,ifc_file_id,ifc_global_id,revit_element_id")
        .eq("project_id", projectId)
        .eq("ifc_file_id", currentFileId)
        .in("ifc_global_id", globalIds)
    : { data: [], error: null };
  if (identityRows.error)
    throw new Error(
      `IFC 요소 식별 관계를 불러오지 못했습니다: ${identityRows.error.message}`,
    );

  const items = anchors.reduce<DrawingRevisionReviewItem[]>(
    (result, anchor) => {
      const issue = issueById.get(anchor.issue_id);
      if (!issue) return result;
      if (anchor.anchor_kind === "ifc_element" && anchor.ifc_global_id) {
        const matches = [
          ...new Set(
            (identityRows.data ?? [])
              .filter((row) => row.ifc_global_id === anchor.ifc_global_id)
              .map((row) => row.revit_element_id),
          ),
        ];
        if (matches.length === 1) {
          result.push({
            issueId: issue.id,
            issueTitle: issue.title,
            previousAnchorId: anchor.id,
            previousFileId: anchor.file_id,
            sourceKind: anchor.anchor_kind,
            kind: "ifc_candidate" as const,
            ifcGlobalId: anchor.ifc_global_id,
          });
          return result;
        }
      }
      result.push({
        issueId: issue.id,
        issueTitle: issue.title,
        previousAnchorId: anchor.id,
        previousFileId: anchor.file_id,
        sourceKind: anchor.anchor_kind,
        kind: "manual_reanchor_required" as const,
        ifcGlobalId: null,
      });
      return result;
    },
    [],
  );
  return {
    items,
    nextCursor: hasMore ? (anchors.at(-1)?.id ?? null) : null,
    previousCursor,
  };
}

export async function loadDrawingRevisionReviewCandidate(
  baseClient: DrawingClient,
  projectId: string,
  currentFileId: string,
  previousAnchorId: string,
): Promise<DrawingRevisionReviewItem | null> {
  const client =
    baseClient as unknown as SupabaseClient<RevisionReviewDatabase>;
  const { data: revision, error: revisionError } = await client
    .from("lukas_qto_file_revisions")
    .select("previous_file_id,current_file_id,project_id")
    .eq("project_id", projectId)
    .eq("current_file_id", currentFileId)
    .maybeSingle();
  if (revisionError)
    throw new Error(
      `도면 개정 관계를 불러오지 못했습니다: ${revisionError.message}`,
    );
  if (!revision) return null;

  const { data: anchor, error: anchorError } = await client
    .from("lukas_drawing_issue_anchors")
    .select("id,issue_id,project_id,file_id,anchor_kind,ifc_global_id,active")
    .eq("id", previousAnchorId)
    .eq("project_id", projectId)
    .eq("file_id", revision.previous_file_id)
    .eq("active", true)
    .maybeSingle();
  if (anchorError)
    throw new Error(
      `이전 도면 근거를 불러오지 못했습니다: ${anchorError.message}`,
    );
  if (!anchor) return null;

  const { data: issue, error: issueError } = await client
    .from("lukas_drawing_issues")
    .select("id,project_id,title,status")
    .eq("id", anchor.issue_id)
    .eq("project_id", projectId)
    .maybeSingle();
  if (issueError)
    throw new Error(`재검토 이슈를 불러오지 못했습니다: ${issueError.message}`);
  if (!issue) return null;

  return {
    issueId: issue.id,
    issueTitle: issue.title,
    previousAnchorId: anchor.id,
    previousFileId: anchor.file_id,
    sourceKind: anchor.anchor_kind,
    kind: "manual_reanchor_required",
    ifcGlobalId: null,
  };
}
