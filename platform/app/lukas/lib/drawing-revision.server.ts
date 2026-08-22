import type { SupabaseClient } from "@supabase/supabase-js";

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
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type DrawingRevisionReviewItem = {
  issueId: string;
  issueTitle: string;
  previousAnchorId: string;
  previousFileId: string;
  kind: "ifc_candidate" | "manual_reanchor_required";
  ifcGlobalId: string | null;
};

export async function loadDrawingRevisionReview(
  baseClient: DrawingClient,
  projectId: string,
  currentFileId: string,
): Promise<DrawingRevisionReviewItem[]> {
  const client = baseClient as unknown as SupabaseClient<RevisionReviewDatabase>;
  const { data: revision, error: revisionError } = await client
    .from("lukas_qto_file_revisions")
    .select("previous_file_id,current_file_id,project_id")
    .eq("project_id", projectId)
    .eq("current_file_id", currentFileId)
    .maybeSingle();
  if (revisionError)
    throw new Error(`도면 개정 관계를 불러오지 못했습니다: ${revisionError.message}`);
  if (!revision) return [];

  const { data: anchors, error: anchorError } = await client
    .from("lukas_drawing_issue_anchors")
    .select("id,issue_id,file_id,anchor_kind,ifc_global_id,active")
    .eq("file_id", revision.previous_file_id)
    .eq("active", true);
  if (anchorError)
    throw new Error(`이전 도면 근거를 불러오지 못했습니다: ${anchorError.message}`);
  if (!anchors?.length) return [];

  const issueIds = [...new Set(anchors.map((anchor) => anchor.issue_id))];
  const { data: issues, error: issueError } = await client
    .from("lukas_drawing_issues")
    .select("id,project_id,title,status")
    .eq("project_id", projectId)
    .in("id", issueIds)
    .neq("status", "closed");
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
    throw new Error(`IFC 요소 식별 관계를 불러오지 못했습니다: ${identityRows.error.message}`);

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
      if (matches.length === 1)
        result.push({
          issueId: issue.id,
          issueTitle: issue.title,
          previousAnchorId: anchor.id,
          previousFileId: anchor.file_id,
          kind: "ifc_candidate" as const,
          ifcGlobalId: anchor.ifc_global_id,
        });
        return result;
    }
    result.push({
      issueId: issue.id,
      issueTitle: issue.title,
      previousAnchorId: anchor.id,
      previousFileId: anchor.file_id,
      kind: "manual_reanchor_required" as const,
      ifcGlobalId: null,
    });
    return result;
  }, []);
}
