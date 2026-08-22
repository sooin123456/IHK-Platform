alter table public.lukas_qto_suggestion_decisions
  add column decision_sequence bigint generated always as identity;
alter table public.lukas_qto_suggestion_decisions
  add constraint lukas_qto_suggestion_decisions_sequence_unique unique(decision_sequence);
create index lukas_qto_suggestion_decisions_latest_idx
  on public.lukas_qto_suggestion_decisions(suggestion_id,decision_sequence desc);
create unique index lukas_qto_suggestions_ai_import_unique
  on public.lukas_qto_suggestions(project_id,payload_sha256,suggestion_kind,subject_key)
  where producer_kind='ai';
