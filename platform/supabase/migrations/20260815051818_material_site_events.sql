-- Extend the append-only material evidence ledger from commercial documents
-- to the minimum physical site events needed for stock and carbon coverage.

alter table public.lukas_qto_material_transactions
  add column event_location text not null default '',
  add constraint lukas_qto_material_transactions_event_location_check
    check (char_length(event_location) <= 240);

alter table public.lukas_qto_material_transactions
  drop constraint lukas_qto_material_transactions_transaction_type_check,
  add constraint lukas_qto_material_transactions_transaction_type_check
    check (transaction_type in (
      'purchase_order', 'goods_receipt', 'invoice_evidence',
      'installation', 'return_to_supplier', 'waste_disposal'
    ));

create or replace function public.lukas_qto_validate_material_transaction()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  order_kind text;
  order_plan uuid;
  order_supplier text;
  plan_code text;
  plan_unit text;
  factor_code text;
  factor_unit text;
begin
  select material_code, unit into plan_code, plan_unit
    from public.lukas_qto_material_plans
    where id = new.material_plan_id and project_id = new.project_id;
  if plan_code is null then
    raise exception 'Material plan does not belong to the project';
  end if;
  if new.carbon_factor_id is not null then
    select material_code, declared_unit into factor_code, factor_unit
      from public.lukas_qto_carbon_factors
      where id = new.carbon_factor_id and project_id = new.project_id;
    if factor_code is distinct from plan_code or factor_unit is distinct from plan_unit then
      raise exception 'The product carbon factor must match the material code and unit';
    end if;
  end if;
  if new.transaction_type = 'purchase_order' then
    if new.related_order_id is not null then
      raise exception 'A purchase order cannot reference another order';
    end if;
  else
    if new.related_order_id is null then
      raise exception 'Material evidence events require a purchase order';
    end if;
    select transaction_type, material_plan_id, supplier_name
      into order_kind, order_plan, order_supplier
      from public.lukas_qto_material_transactions
      where id = new.related_order_id and project_id = new.project_id;
    if order_kind is distinct from 'purchase_order'
       or order_plan is distinct from new.material_plan_id then
      raise exception 'The referenced purchase order must belong to the same project and material plan';
    end if;
    if order_supplier is distinct from new.supplier_name then
      raise exception 'Material event supplier must match the purchase order';
    end if;
  end if;
  if new.transaction_type <> 'purchase_order' and new.evidence_file_id is null then
    raise exception 'Material evidence events require an immutable evidence file';
  end if;
  if new.transaction_type in (
    'goods_receipt','installation','return_to_supplier','waste_disposal'
  ) and (
    not new.site_acknowledgement
    or trim(new.received_by_name) = ''
    or trim(new.event_location) = ''
  ) then
    raise exception 'Physical site events require acknowledgement, responsible person and location';
  end if;
  if new.transaction_type = 'invoice_evidence'
     and (new.unit_price_krw is null or new.amount_krw is null) then
    raise exception 'Invoice evidence requires a unit price and source amount';
  end if;
  if new.transaction_type = 'invoice_evidence'
     and new.amount_krw <> round(new.quantity * new.unit_price_krw, 0) then
    raise exception 'Invoice source amount does not match rounded quantity times unit price';
  end if;
  return new;
end;
$$;
