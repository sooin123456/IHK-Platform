-- The former constraint bounded the trimmed value, so an otherwise valid
-- legacy row could exceed 200 characters only through surrounding spaces.
-- Normalize that insignificant padding before validating the exact storage
-- contract. New writes were already protected by the NOT VALID constraint.
update public.lukas_qto_material_plans
set specification = trim(specification)
where char_length(specification) > 200;

alter table public.lukas_qto_material_plans
  validate constraint lukas_qto_material_plans_specification_contract_v2;
