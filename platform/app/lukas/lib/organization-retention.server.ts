import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const Uuid = z.string().uuid();
const Reason = z.string().trim().min(1).max(2000);
const requestFields = new Set(["intent", "project_id", "reason", "request_id"]);
const holdFields = new Set([
  "intent",
  "project_id",
  "hold_id",
  "reason",
  "request_id",
]);
const policyFields = new Set([
  "intent",
  "archive_retention_days",
  "approved_retention_days",
  "reason",
  "request_id",
]);

function exactFields(form: FormData, allowed: ReadonlySet<string>) {
  for (const key of form.keys())
    if (!allowed.has(key)) throw new Error(`허용되지 않은 필드입니다: ${key}`);
}

export function parseOrganizationRetentionForm(form: FormData) {
  const intent = String(form.get("intent") ?? "");
  if (intent === "set_policy") {
    exactFields(form, policyFields);
    const value = z
      .object({
        archiveRetentionDays: z.coerce.number().int().min(0).max(3650),
        approvedRetentionDays: z.coerce.number().int().min(0).max(3650),
        reason: Reason,
        requestId: Uuid,
      })
      .parse({
        archiveRetentionDays: form.get("archive_retention_days"),
        approvedRetentionDays: form.get("approved_retention_days"),
        reason: form.get("reason"),
        requestId: form.get("request_id"),
      });
    if (
      value.approvedRetentionDays < 365 ||
      value.approvedRetentionDays < value.archiveRetentionDays
    )
      throw new Error(
        "승인 근거 보존기간은 일반 보존기간보다 짧을 수 없습니다.",
      );
    return { intent, ...value } as const;
  }
  if (intent === "archive" || intent === "request_delete") {
    exactFields(form, requestFields);
    return {
      intent,
      projectId: Uuid.parse(form.get("project_id")),
      reason: Reason.parse(form.get("reason")),
      requestId: Uuid.parse(form.get("request_id")),
    } as const;
  }
  if (intent === "place_hold" || intent === "release_hold") {
    exactFields(form, holdFields);
    return {
      intent,
      projectId: Uuid.parse(form.get("project_id")),
      holdId: Uuid.parse(form.get("hold_id")),
      reason: Reason.parse(form.get("reason")),
      requestId: Uuid.parse(form.get("request_id")),
    } as const;
  }
  throw new Error("보존 관리 작업이 올바르지 않습니다.");
}

type RetentionClient = SupabaseClient<any>;

export async function runOrganizationRetentionMutation(
  client: RetentionClient,
  organizationId: string,
  mutation: ReturnType<typeof parseOrganizationRetentionForm>,
) {
  const common = {
    p_organization_id: Uuid.parse(organizationId),
    p_reason: mutation.reason,
  };
  const rpc =
    mutation.intent === "set_policy"
      ? client.rpc("lukas_qto_set_retention_policy", {
          ...common,
          p_archive_retention_days: mutation.archiveRetentionDays,
          p_approved_retention_days: mutation.approvedRetentionDays,
          p_request_id: mutation.requestId,
        })
      : mutation.intent === "archive"
        ? client.rpc("lukas_qto_archive_project", {
            ...common,
            p_project_id: mutation.projectId,
            p_request_id: mutation.requestId,
          })
        : mutation.intent === "request_delete"
          ? client.rpc("lukas_qto_request_project_deletion", {
              ...common,
              p_project_id: mutation.projectId,
              p_request_id: mutation.requestId,
            })
          : mutation.intent === "place_hold"
            ? client.rpc("lukas_qto_place_legal_hold", {
                ...common,
                p_project_id: mutation.projectId,
                p_hold_id: mutation.holdId,
                p_request_id: mutation.requestId,
              })
            : client.rpc("lukas_qto_release_legal_hold", {
                ...common,
                p_project_id: mutation.projectId,
                p_hold_id: mutation.holdId,
                p_request_id: mutation.requestId,
              });
  const { data, error } = await rpc;
  if (error) throw new Error(error.message);
  return z.record(z.string(), z.unknown()).parse(data);
}
