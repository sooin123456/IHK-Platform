-- Concrete-first material control pilot. This is a separate web workflow from
-- the Revit add-in: source files are linked by immutable project file identity.

create table if not exists public.lukas_qto_carbon_factors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  material_code text not null check (char_length(trim(material_code)) between 1 and 80),
  product_name text not null check (char_length(trim(product_name)) between 1 and 200),
  manufacturer text not null default '' check (char_length(manufacturer) <= 160),
  declared_unit text not null check (declared_unit in ('m3','kg','t','m2','m','EA')),
  gwp_a1_a3_per_unit numeric(24,6) not null check (gwp_a1_a3_per_unit >= 0),
  source_type text not null check (source_type in ('product_epd','industry_average','generic')),
  standard text not null check (char_length(trim(standard)) between 1 and 160),
  geography text not null default '' check (char_length(geography) <= 120),
  valid_from date,
  valid_until date,
  source_file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint lukas_qto_carbon_factor_source_identity_fkey
    foreign key (source_file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create table if not exists public.lukas_qto_material_plans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  material_code text not null check (char_length(trim(material_code)) between 1 and 80),
  material_name text not null check (char_length(trim(material_name)) between 1 and 160),
  specification text not null check (char_length(trim(specification)) between 1 and 200),
  unit text not null check (unit in ('m3','kg','t','m2','m','EA')),
  design_quantity numeric(24,6) not null check (design_quantity >= 0),
  allowance_rate numeric(12,6) not null default 0 check (allowance_rate >= 0 and allowance_rate <= 10),
  required_quantity numeric(24,6) not null check (required_quantity >= 0),
  rule_id text not null check (char_length(trim(rule_id)) between 1 and 120),
  required_by date,
  source_file_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  baseline_factor_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, material_code, created_at),
  check (required_quantity = round(design_quantity * (1 + allowance_rate), 6)),
  constraint lukas_qto_material_plan_source_identity_fkey
    foreign key (source_file_id, project_id, source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  constraint lukas_qto_material_plan_baseline_factor_fkey
    foreign key (baseline_factor_id, project_id)
    references public.lukas_qto_carbon_factors(id, project_id) on delete restrict
);

create table if not exists public.lukas_qto_material_transactions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  material_plan_id uuid not null,
  transaction_type text not null check (transaction_type in ('purchase_order','goods_receipt','invoice_evidence')),
  document_number text not null check (char_length(trim(document_number)) between 1 and 120),
  supplier_name text not null check (char_length(trim(supplier_name)) between 1 and 160),
  occurred_on date not null,
  quantity numeric(24,6) not null check (quantity > 0),
  unit_price_krw numeric(24,0) check (unit_price_krw >= 0),
  amount_krw numeric(24,0) check (amount_krw >= 0),
  related_order_id uuid,
  carbon_factor_id uuid,
  evidence_file_id uuid,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  received_by_name text not null default '' check (char_length(received_by_name) <= 120),
  site_acknowledgement boolean not null default false,
  note text not null default '' check (char_length(note) <= 2000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (id, project_id),
  unique (project_id, transaction_type, supplier_name, document_number, material_plan_id),
  check ((evidence_file_id is null) = (evidence_sha256 is null)),
  constraint lukas_qto_material_transaction_plan_fkey
    foreign key (material_plan_id, project_id)
    references public.lukas_qto_material_plans(id, project_id) on delete restrict,
  constraint lukas_qto_material_transaction_order_fkey
    foreign key (related_order_id, project_id)
    references public.lukas_qto_material_transactions(id, project_id) on delete restrict,
  constraint lukas_qto_material_transaction_factor_fkey
    foreign key (carbon_factor_id, project_id)
    references public.lukas_qto_carbon_factors(id, project_id) on delete restrict,
  constraint lukas_qto_material_transaction_evidence_identity_fkey
    foreign key (evidence_file_id, project_id, evidence_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create or replace function public.lukas_qto_validate_material_plan()
returns trigger language plpgsql security invoker set search_path = public as $$
declare factor_code text; factor_unit text;
begin
  if new.baseline_factor_id is not null then
    select material_code, declared_unit into factor_code, factor_unit
      from public.lukas_qto_carbon_factors where id = new.baseline_factor_id and project_id = new.project_id;
    if factor_code is distinct from new.material_code or factor_unit is distinct from new.unit then
      raise exception 'The baseline carbon factor must match the material code and unit';
    end if;
  end if;
  return new;
end;
$$;

create trigger lukas_qto_material_plans_validate before insert on public.lukas_qto_material_plans
for each row execute function public.lukas_qto_validate_material_plan();

create or replace function public.lukas_qto_validate_material_transaction()
returns trigger language plpgsql security invoker set search_path = public as $$
declare order_kind text; order_plan uuid; order_supplier text; plan_code text; plan_unit text; factor_code text; factor_unit text;
begin
  select material_code, unit into plan_code, plan_unit from public.lukas_qto_material_plans
    where id = new.material_plan_id and project_id = new.project_id;
  if plan_code is null then raise exception 'Material plan does not belong to the project'; end if;
  if new.carbon_factor_id is not null then
    select material_code, declared_unit into factor_code, factor_unit from public.lukas_qto_carbon_factors
      where id = new.carbon_factor_id and project_id = new.project_id;
    if factor_code is distinct from plan_code or factor_unit is distinct from plan_unit then
      raise exception 'The product carbon factor must match the material code and unit';
    end if;
  end if;
  if new.transaction_type = 'purchase_order' then
    if new.related_order_id is not null then raise exception 'A purchase order cannot reference another order'; end if;
  else
    if new.related_order_id is null then raise exception 'Receipt and invoice evidence require a purchase order'; end if;
    select transaction_type, material_plan_id, supplier_name into order_kind, order_plan, order_supplier
      from public.lukas_qto_material_transactions
      where id = new.related_order_id and project_id = new.project_id;
    if order_kind is distinct from 'purchase_order' or order_plan is distinct from new.material_plan_id then
      raise exception 'The referenced purchase order must belong to the same project and material plan';
    end if;
    if order_supplier is distinct from new.supplier_name then raise exception 'Receipt and invoice supplier must match the purchase order'; end if;
  end if;
  if new.transaction_type in ('goods_receipt','invoice_evidence') and new.evidence_file_id is null then
    raise exception 'Receipt and invoice evidence require an immutable evidence file';
  end if;
  if new.transaction_type = 'goods_receipt' and (not new.site_acknowledgement or trim(new.received_by_name) = '') then
    raise exception 'A goods receipt requires site acknowledgement and receiver name';
  end if;
  if new.transaction_type = 'invoice_evidence' and (new.unit_price_krw is null or new.amount_krw is null) then
    raise exception 'Invoice evidence requires a unit price and source amount';
  end if;
  if new.transaction_type = 'invoice_evidence' and new.amount_krw <> round(new.quantity * new.unit_price_krw, 0) then
    raise exception 'Invoice source amount does not match rounded quantity times unit price';
  end if;
  return new;
end;
$$;

create trigger lukas_qto_material_transactions_validate before insert on public.lukas_qto_material_transactions
for each row execute function public.lukas_qto_validate_material_transaction();

create index if not exists lukas_qto_carbon_factors_project_idx on public.lukas_qto_carbon_factors(project_id, created_at desc);
create index if not exists lukas_qto_material_plans_project_idx on public.lukas_qto_material_plans(project_id, created_at desc);
create index if not exists lukas_qto_material_transactions_project_idx on public.lukas_qto_material_transactions(project_id, occurred_on desc);
create index if not exists lukas_qto_material_transactions_plan_idx on public.lukas_qto_material_transactions(material_plan_id, transaction_type);

alter table public.lukas_qto_carbon_factors enable row level security;
alter table public.lukas_qto_material_plans enable row level security;
alter table public.lukas_qto_material_transactions enable row level security;

create policy "project members read carbon factors" on public.lukas_qto_carbon_factors for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members add carbon factors" on public.lukas_qto_carbon_factors for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members read material plans" on public.lukas_qto_material_plans for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members add material plans" on public.lukas_qto_material_plans for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members read material transactions" on public.lukas_qto_material_transactions for select to authenticated using (exists (
  select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));
create policy "project members add material transactions" on public.lukas_qto_material_transactions for insert to authenticated with check (
  created_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')));

create policy "verified email sessions only" on public.lukas_qto_carbon_factors as restrictive for all to authenticated
  using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_material_plans as restrictive for all to authenticated
  using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);
create policy "verified email sessions only" on public.lukas_qto_material_transactions as restrictive for all to authenticated
  using (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false)
  with check (coalesce((select auth.jwt()->>'is_anonymous')::boolean, false) = false);

grant select, insert on public.lukas_qto_carbon_factors, public.lukas_qto_material_plans, public.lukas_qto_material_transactions to authenticated;
revoke update, delete on public.lukas_qto_carbon_factors, public.lukas_qto_material_plans, public.lukas_qto_material_transactions from authenticated;
grant all on public.lukas_qto_carbon_factors, public.lukas_qto_material_plans, public.lukas_qto_material_transactions to service_role;

-- Field evidence stays private in the existing bucket. The Revit package MIME
-- types remain allowed; this migration only adds receipt photos and PDF slips.
update storage.buckets set allowed_mime_types = array[
  'application/x-step','application/octet-stream','text/csv','application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg','image/png','application/pdf'
] where id = 'lukas-qto';
