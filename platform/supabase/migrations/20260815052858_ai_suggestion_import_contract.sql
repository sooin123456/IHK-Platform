alter table public.lukas_qto_suggestions
  drop constraint lukas_qto_suggestions_producer_kind_check,
  add constraint lukas_qto_suggestions_producer_kind_check
    check (producer_kind in ('rule','ai')),
  add constraint lukas_qto_suggestions_ai_payload_check check (
    producer_kind <> 'ai'
    or (payload_file_id is not null and payload_sha256 is not null)
  );
