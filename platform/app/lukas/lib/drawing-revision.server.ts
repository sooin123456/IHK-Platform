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
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      lukas_drawing_issue_anchors: {
        Row: {
          id: string;
          issue_id: string;
          file_id: string;
          anchor_kind: "ifc_element" | "pdf_region";
          ifc_global_id: string | null;
          active: boolean;
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
  if (error)
    throw new Error(
      `도면 근거를 새 개정본에 연결하지 못했습니다: ${error.message}`,
    );
  return RelinkDrawingAnchorResultSchema.parse(data);
}

export async function loadDrawingRevisionReview(
  baseClient: DrawingClient,
  projectId: string,
  currentFileId: string,
): Promise<DrawingRevisionReviewItem[]> {
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
  if (!revision) return [];

  const { data: anchors, error: anchorError } = await client
    .from("lukas_drawing_issue_anchors")
    .select("id,issue_id,file_id,anchor_kind,ifc_global_id,active")
    .eq("file_id", revision.previous_file_id)
    .eq("active", true);
  if (anchorError)
    throw new Error(
      `이전 도면 근거를 불러오지 못했습니다: ${anchorError.message}`,
    );
  if (!anchors?.length) return [];

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

  return anchors.reduce<DrawingRevisionReviewItem[]>((result, anchor) => {
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
  }, []);
}
