-- Price-book resources intentionally use an empty string when no material
-- specification is supplied. Install the replacement without a table scan;
-- the next migration normalizes legacy padding and validates it under a
-- weaker lock. A NOT VALID check still protects every new or updated row.
alter table public.lukas_qto_material_plans
  add constraint lukas_qto_material_plans_specification_contract_v2
  check (char_length(specification) <= 200) not valid;

alter table public.lukas_qto_material_plans
  drop constraint if exists lukas_qto_material_plans_specification_check;
