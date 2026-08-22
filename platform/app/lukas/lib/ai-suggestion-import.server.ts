import { createHash } from "node:crypto";

import { z } from "zod";

const sha256 = /^[0-9a-f]{64}$/;
const forbiddenKey = /(quantity|qty|amount|cost|price|decision|approval|approved|final[_-]?value|status)/i;
const kinds = ["anomaly", "classification", "mapping", "revision_change"] as const;
const unique = <T>(values: T[]) => new Set(values).size === values.length;
const locatorArray = (pattern: RegExp, label: string) =>
  z.array(z.string().trim().regex(pattern, label)).min(1).max(5000).refine(unique, `${label}가 중복됩니다.`).optional();
const evidenceSchema = z.object({
  element_ids: locatorArray(/^[1-9][0-9]{0,18}$/, "Revit Element ID"),
  ifc_global_ids: locatorArray(/^[0-9A-Za-z_$]{22}$/, "IFC GlobalId"),
  source_rows: z.array(z.number().int().positive()).min(1).max(5000).refine(unique, "원본 행 번호가 중복됩니다.").optional(),
  source_cells: locatorArray(/^[^\r\n]{1,200}$/, "원본 셀 위치"),
  file_refs: z.array(z.object({
    sha256: z.string().regex(sha256),
    locator: z.string().trim().min(1).max(240),
  }).strict()).min(1).max(100).optional(),
  reason_code: z.string().trim().min(1).max(120).optional(),
  observations: z.record(z.string().max(120), z.union([z.string().max(1000), z.number().finite(), z.boolean(), z.null()])).optional(),
}).strict().refine(
  (value) => Boolean(value.element_ids?.length || value.ifc_global_ids?.length || value.source_rows?.length || value.source_cells?.length || value.file_refs?.length),
  "AI 제안에는 요소·IFC·행·셀·파일 위치 중 하나 이상의 원본 근거가 필요합니다.",
);

const suggestionSchema = z.object({
  suggestion_kind: z.enum(kinds),
  subject_key: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(5000),
  confidence: z.number().min(0).max(1).nullable(),
  evidence: evidenceSchema,
}).strict();

const payloadSchema = z.object({
  format_version: z.literal("LUKAS_AI_SUGGESTIONS_V1"),
  producer: z.object({
    provider: z.string().trim().min(1).max(120),
    model: z.string().trim().min(1).max(160),
    version: z.string().trim().min(1).max(120),
  }).strict(),
  source: z.object({
    sha256: z.string().regex(sha256),
  }).strict(),
  suggestions: z.array(suggestionSchema).min(1).max(5000),
}).strict();

function rejectForbiddenKeys(value: unknown, path = "payload") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectForbiddenKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (forbiddenKey.test(key))
      throw new Error(`AI 제안에는 수량·금액·판정·승인 필드를 넣을 수 없습니다: ${path}.${key}`);
    rejectForbiddenKeys(child, `${path}.${key}`);
  }
}

export type VerifiedAiSuggestionImport = {
  payloadSha256: string;
  sourceSha256: string;
  producerVersion: string;
  suggestions: Array<{
    suggestionKind: (typeof kinds)[number];
    subjectKey: string;
    title: string;
    detail: string;
    confidence: number | null;
    evidence: Record<string, unknown>;
  }>;
};

export function verifyAiSuggestionImport(
  bytes: Uint8Array,
  expectedSourceSha256: string,
): VerifiedAiSuggestionImport {
  if (bytes.byteLength === 0 || bytes.byteLength > 10 * 1024 * 1024)
    throw new Error("AI 제안 JSON은 1바이트 이상 10MB 이하여야 합니다.");
  if (!sha256.test(expectedSourceSha256))
    throw new Error("원본 파일 확인번호가 올바르지 않습니다.");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("AI 제안 JSON을 UTF-8로 읽을 수 없습니다.");
  }
  rejectForbiddenKeys(raw);
  const parsed = payloadSchema.parse(raw);
  if (parsed.source.sha256 !== expectedSourceSha256)
    throw new Error("AI 제안이 선택한 원본 파일과 연결되지 않습니다.");
  const keys = new Set<string>();
  const suggestions = parsed.suggestions.map((item) => {
    const identity = `${item.suggestion_kind}\u001f${item.subject_key}`;
    if (keys.has(identity))
      throw new Error(`AI 제안 종류·키가 중복됩니다: ${item.subject_key}`);
    keys.add(identity);
    return {
      suggestionKind: item.suggestion_kind,
      subjectKey: item.subject_key,
      title: item.title,
      detail: item.detail,
      confidence: item.confidence,
      evidence: item.evidence,
    };
  });
  const readableProducer = `${parsed.producer.provider}/${parsed.producer.model}/${parsed.producer.version}`;
  const producerVersion =
    readableProducer.length <= 120
      ? readableProducer
      : `${parsed.producer.provider.slice(0, 60)}/${createHash("sha256").update(readableProducer).digest("hex").slice(0, 32)}`;
  return {
    payloadSha256: createHash("sha256").update(bytes).digest("hex"),
    sourceSha256: parsed.source.sha256,
    producerVersion,
    suggestions,
  };
}
