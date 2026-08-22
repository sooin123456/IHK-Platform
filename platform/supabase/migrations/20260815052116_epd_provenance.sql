-- Product-specific EPD factors must remain distinguishable from industry and
-- generic factors and carry the minimum independently checkable declaration.

alter table public.lukas_qto_carbon_factors
  add column epd_program_operator text not null default '',
  add column epd_declaration_number text not null default '',
  add column epd_verifier text not null default '',
  add column pcr_reference text not null default '',
  add constraint lukas_qto_carbon_factors_epd_text_lengths_check check (
    char_length(epd_program_operator) <= 200
    and char_length(epd_declaration_number) <= 160
    and char_length(epd_verifier) <= 200
    and char_length(pcr_reference) <= 200
  ),
  add constraint lukas_qto_carbon_factors_product_epd_provenance_check check (
    source_type <> 'product_epd'
    or (
      trim(epd_program_operator) <> ''
      and trim(epd_declaration_number) <> ''
      and trim(epd_verifier) <> ''
      and trim(pcr_reference) <> ''
      and valid_until is not null
      and trim(manufacturer) <> ''
    )
  );
