import { z } from "zod";

export const DRAWING_ESTIMATE_CATEGORIES = [
  "바닥",
  "벽",
  "천장",
  "문",
  "창호",
  "가구",
  "철거",
] as const;

export const DRAWING_EVIDENCE_KINDS = [
  "수기 입력",
  "현장 실측",
  "가정값",
  "원본 연결",
] as const;

const StarterKey = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const ExactCategories = z
  .tuple(DRAWING_ESTIMATE_CATEGORIES.map((value) => z.literal(value)) as [
    z.ZodLiteral<"바닥">,
    z.ZodLiteral<"벽">,
    z.ZodLiteral<"천장">,
    z.ZodLiteral<"문">,
    z.ZodLiteral<"창호">,
    z.ZodLiteral<"가구">,
    z.ZodLiteral<"철거">,
  ]);
const ExactEvidenceKinds = z.tuple(
  DRAWING_EVIDENCE_KINDS.map((value) => z.literal(value)) as [
    z.ZodLiteral<"수기 입력">,
    z.ZodLiteral<"현장 실측">,
    z.ZodLiteral<"가정값">,
    z.ZodLiteral<"원본 연결">,
  ],
);
const ExactTableColumns = z.tuple([
  z.literal("적산 분류"),
  z.literal("품목 코드"),
  z.literal("측정 종류"),
  z.literal("단위"),
  z.literal("검토 규칙"),
]);

export const DrawingStarterDefinitionSchema = z
  .object({
    schemaVersion: z.literal("1hk-platform-starter/1"),
    key: StarterKey,
    version: z.literal(1),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().min(1).max(2000),
    layers: z.array(z.string().trim().min(1).max(255)).min(1).max(64),
    categories: ExactCategories,
    evidenceKinds: ExactEvidenceKinds,
    table: z
      .object({
        name: z.literal("기본 내역"),
        columns: ExactTableColumns,
        rows: z.tuple([]),
      })
      .strict(),
  })
  .strict()
  .superRefine((definition, context) => {
    if (new Set(definition.layers).size !== definition.layers.length)
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["layers"],
        message: "starter 레이어는 중복될 수 없습니다.",
      });
  });

export type DrawingStarterDefinition = z.infer<
  typeof DrawingStarterDefinitionSchema
>;

export type DrawingStarterCatalogItem = {
  definition: DrawingStarterDefinition;
  contentSha256: string;
};
