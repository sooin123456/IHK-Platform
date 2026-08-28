import { z } from "zod";

import { drawingIssueStatuses } from "./drawing-collaboration-policy.ts";

export const DrawingPrioritySchema = z.enum(["low", "normal", "high", "urgent"]);
export const DrawingStatusSchema = z.enum(drawingIssueStatuses);

const finiteVector = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);

export const IfcAnchorSchema = z.object({
  kind: z.literal("ifc_element"),
  fileId: z.string().uuid(),
  elementId: z.string().trim().min(1).max(128),
  ifcGlobalId: z.string().regex(/^[0-9A-Za-z_$]{22}$/).nullable(),
  camera: z.object({ position: finiteVector, target: finiteVector }),
  label: z.string().trim().max(240).default(""),
});

export const PdfAnchorSchema = z
  .object({
    kind: z.literal("pdf_region"),
    fileId: z.string().uuid(),
    pageNumber: z.number().int().positive(),
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    width: z.number().finite().positive().max(1),
    height: z.number().finite().positive().max(1),
    label: z.string().trim().max(240).default(""),
  })
  .refine((value) => value.x + value.width <= 1, {
    message: "PDF 영역이 페이지 오른쪽을 벗어났습니다.",
    path: ["width"],
  })
  .refine((value) => value.y + value.height <= 1, {
    message: "PDF 영역이 페이지 아래를 벗어났습니다.",
    path: ["height"],
  });

export const DrawingAnchorSchema = z.union([IfcAnchorSchema, PdfAnchorSchema]);

export const DrawingIssueCreateSchema = z.object({
  title: z.string().trim().min(1).max(240),
  description: z.string().max(10000).default(""),
  priority: DrawingPrioritySchema.default("normal"),
  assigneeUserId: z.string().uuid().nullable().default(null),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
});

export const DrawingIssueUpdateSchema = z.object({
  issueId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  status: DrawingStatusSchema.optional(),
  priority: DrawingPrioritySchema.optional(),
  assigneeUserId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export const DrawingCommentSchema = z.object({
  issueId: z.string().uuid(),
  body: z.string().trim().min(1).max(10000),
});

export type DrawingAnchorInput = z.infer<typeof DrawingAnchorSchema>;
export type DrawingIssueCreateInput = z.infer<typeof DrawingIssueCreateSchema>;
export type DrawingIssueUpdateInput = z.infer<typeof DrawingIssueUpdateSchema>;

export type DrawingFile = {
  id: string;
  project_id: string;
  kind: "ifc" | "pdf";
  original_filename: string;
  storage_path: string;
  content_type: string | null;
  byte_size: number;
  sha256: string;
  immutable: boolean;
  created_at: string;
};

export type DrawingIssue = {
  id: string;
  project_id: string;
  title: string;
  description: string;
  priority: z.infer<typeof DrawingPrioritySchema>;
  status: z.infer<typeof DrawingStatusSchema>;
  assignee_user_id: string | null;
  due_at: string | null;
  created_by: string;
  closed_by: string | null;
  closed_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
