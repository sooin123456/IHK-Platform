import type { Json } from "database.types";

export const FEEDBACK_EXPORT_VERSION = "LUKAS_SUGGESTION_FEEDBACK_V1";

type Suggestion = {
  id: string;
  file_id: string;
  producer_kind: string;
  producer_version: string;
  source_sha256: string;
  suggestion_kind: string;
  subject_key: string;
  title: string;
  detail: string;
  confidence: number | null;
  evidence: Json;
  created_at: string;
};

type Decision = { id?: string; suggestion_id: string; decision: string; created_at: string; decision_sequence?: number };

export type SuggestionEvaluation = {
  producer_kind: string;
  producer_version: string;
  suggestion_kind: string;
  total: number;
  accepted: number;
  rejected: number;
  deferred: number;
  pending: number;
  decision_rate: number;
  acceptance_rate: number | null;
  minimum_sample_size: 30;
  sample_sufficient: boolean;
  promotion_allowed: false;
  median_review_seconds: number | null;
};

export function buildSuggestionEvaluation(suggestions: Pick<Suggestion, "id" | "producer_kind" | "producer_version" | "suggestion_kind" | "created_at">[],
  decisions: Decision[]): SuggestionEvaluation[] {
  const latest = new Map<string, Decision>();
  for (const decision of decisions) {
    const existing = latest.get(decision.suggestion_id);
    if (!existing || (decision.decision_sequence ?? -1) > (existing.decision_sequence ?? -1)
      || ((decision.decision_sequence ?? -1) === (existing.decision_sequence ?? -1) && decision.created_at > existing.created_at)
      || ((decision.decision_sequence ?? -1) === (existing.decision_sequence ?? -1) && decision.created_at === existing.created_at && (decision.id ?? "") > (existing.id ?? ""))) latest.set(decision.suggestion_id, decision);
  }

  const groups = new Map<string, SuggestionEvaluation>();
  const reviewSeconds = new Map<string, number[]>();
  for (const suggestion of suggestions) {
    const key = `${suggestion.producer_kind}\u001f${suggestion.producer_version}\u001f${suggestion.suggestion_kind}`;
    const group = groups.get(key) ?? {
      producer_kind: suggestion.producer_kind, producer_version: suggestion.producer_version,
      suggestion_kind: suggestion.suggestion_kind, total: 0, accepted: 0, rejected: 0,
      deferred: 0, pending: 0, decision_rate: 0, acceptance_rate: null,
      minimum_sample_size: 30, sample_sufficient: false, promotion_allowed: false,
      median_review_seconds: null,
    };
    group.total += 1;
    const decision = latest.get(suggestion.id)?.decision;
    if (decision === "accepted") group.accepted += 1;
    else if (decision === "rejected") group.rejected += 1;
    else if (decision === "deferred") group.deferred += 1;
    else group.pending += 1;
    const latestDecision = latest.get(suggestion.id);
    if (latestDecision && suggestion.created_at) {
      const elapsed = (Date.parse(latestDecision.created_at) - Date.parse(suggestion.created_at)) / 1000;
      if (Number.isFinite(elapsed) && elapsed >= 0) {
        const values = reviewSeconds.get(key) ?? [];
        values.push(elapsed);
        reviewSeconds.set(key, values);
      }
    }
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    const conclusive = group.accepted + group.rejected;
    const times = (reviewSeconds.get(`${group.producer_kind}\u001f${group.producer_version}\u001f${group.suggestion_kind}`) ?? []).sort((a,b) => a-b);
    const middle = Math.floor(times.length / 2);
    const median = times.length === 0 ? null : times.length % 2 === 1 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
    return {
      ...group,
      decision_rate: group.total === 0 ? 0 : (group.total - group.pending) / group.total,
      acceptance_rate: conclusive === 0 ? null : group.accepted / conclusive,
      sample_sufficient: conclusive >= group.minimum_sample_size,
      promotion_allowed: false as const,
      median_review_seconds: median,
    };
  }).sort((left, right) => `${left.producer_kind}\u001f${left.producer_version}\u001f${left.suggestion_kind}`
    .localeCompare(`${right.producer_kind}\u001f${right.producer_version}\u001f${right.suggestion_kind}`));
}

export function buildSuggestionFeedbackExport(projectId: string, exportedAt: string,
  suggestions: Suggestion[], decisions: Decision[]) {
  const allowedSuggestionIds = new Set(suggestions.map((suggestion) => suggestion.id));
  const grouped = new Map<string, Decision[]>();
  for (const decision of decisions) {
    if (!allowedSuggestionIds.has(decision.suggestion_id)) continue;
    const values = grouped.get(decision.suggestion_id) ?? [];
    values.push(decision);
    grouped.set(decision.suggestion_id, values);
  }
  return {
    contract: FEEDBACK_EXPORT_VERSION,
    project_id: projectId,
    exported_at_utc: exportedAt,
    authority: "HUMAN_DECISION_ONLY_FINAL",
    records: suggestions.map((suggestion) => ({
      suggestion_id: suggestion.id,
      file_id: suggestion.file_id,
      producer_kind: suggestion.producer_kind,
      producer_version: suggestion.producer_version,
      source_sha256: suggestion.source_sha256,
      suggestion_kind: suggestion.suggestion_kind,
      subject_key: suggestion.subject_key,
      title: suggestion.title,
      detail: suggestion.detail,
      confidence: suggestion.confidence,
      evidence: suggestion.evidence,
      suggested_at_utc: suggestion.created_at,
      decisions: (grouped.get(suggestion.id) ?? [])
        .sort((left, right) => (left.decision_sequence ?? 0) - (right.decision_sequence ?? 0) || left.created_at.localeCompare(right.created_at))
        .map(({ decision, created_at }) => ({ decision, decided_at_utc: created_at })),
    })),
  };
}
