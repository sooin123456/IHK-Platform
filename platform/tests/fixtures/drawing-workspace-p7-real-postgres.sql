-- Local-only deterministic prerequisites for the P7 real PostgreSQL gates.
-- Apply after every committed Supabase migration. Never apply to a hosted project.

insert into auth.users(id,email) values
  ('70000000-0000-4000-8000-000000000001','p7-owner@example.test'),
  ('70000000-0000-4000-8000-000000000002','p7-admin@example.test'),
  ('70000000-0000-4000-8000-000000000003','p7-member@example.test'),
  ('70000000-0000-4000-8000-000000000004','p7-other-owner@example.test');

insert into public.lukas_qto_organizations(id,name,owner_id) values
  ('70000000-0000-4000-8000-000000000101','P7 gate organization',
    '70000000-0000-4000-8000-000000000001'),
  ('70000000-0000-4000-8000-000000000102','P7 gate other organization',
    '70000000-0000-4000-8000-000000000004');

insert into public.lukas_qto_organization_members(
  organization_id,user_id,role
) values
  ('70000000-0000-4000-8000-000000000101','70000000-0000-4000-8000-000000000001','owner'),
  ('70000000-0000-4000-8000-000000000101','70000000-0000-4000-8000-000000000002','admin'),
  ('70000000-0000-4000-8000-000000000101','70000000-0000-4000-8000-000000000003','member'),
  ('70000000-0000-4000-8000-000000000102','70000000-0000-4000-8000-000000000004','owner');

insert into public.lukas_qto_organization_admin_events(
  id,organization_id,event_type,entitlement_version_id,request_id,
  request_sha256,details,actor_id
) select
  '70000000-0000-4000-8000-000000000111',
  '70000000-0000-4000-8000-000000000101',
  'organization_settings_changed',e.id,
  '70000000-0000-4000-8000-000000000112',repeat('1',64),
  '{"fixture":"p7-real-postgres"}'::jsonb,
  '70000000-0000-4000-8000-000000000001'
from public.lukas_qto_organization_entitlement_versions e
where e.organization_id='70000000-0000-4000-8000-000000000101'
order by e.version_no desc limit 1;

select pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"70000000-0000-4000-8000-000000000001","is_anonymous":false,"app_metadata":{}}',
  false
);

insert into public.lukas_qto_projects(
  id,organization_id,owner_id,name,description
) values(
  '70000000-0000-4000-8000-000000000201',
  '70000000-0000-4000-8000-000000000101',
  '70000000-0000-4000-8000-000000000001',
  'P7 gate project','Local release-gate fixture'
);

insert into public.lukas_qto_files(
  id,project_id,uploaded_by,kind,storage_path,original_filename,
  content_type,byte_size,sha256,immutable
) values(
  '70000000-0000-4000-8000-000000000211',
  '70000000-0000-4000-8000-000000000201',
  '70000000-0000-4000-8000-000000000001','other',
  'p7-real-postgres/source.bin','source.bin','application/octet-stream',1,
  repeat('2',64),true
);

insert into public.lukas_drawing_documents(
  id,project_id,title,created_by
) values(
  '70000000-0000-4000-8000-000000000301',
  '70000000-0000-4000-8000-000000000201','P7 gate drawing',
  '70000000-0000-4000-8000-000000000001'
);

insert into public.lukas_drawing_revisions(
  id,document_id,project_id,sequence,status,version,created_by
) values(
  '70000000-0000-4000-8000-000000000302',
  '70000000-0000-4000-8000-000000000301',
  '70000000-0000-4000-8000-000000000201',1,'draft',1,
  '70000000-0000-4000-8000-000000000001'
);

insert into public.lukas_drawing_library_entries(
  id,organization_id,kind,name,created_by
) values(
  '70000000-0000-4000-8000-000000000311',
  '70000000-0000-4000-8000-000000000101','workspace_template',
  'P7 gate template','70000000-0000-4000-8000-000000000001'
);

insert into public.lukas_drawing_library_versions(
  id,registry_id,organization_id,version_no,status,canonical_payload,
  content_sha256,source_project_id,source_revision_id,created_by
) values(
  '70000000-0000-4000-8000-000000000312',
  '70000000-0000-4000-8000-000000000311',
  '70000000-0000-4000-8000-000000000101',1,'draft','{}'::jsonb,
  pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to('{}'::jsonb::text,'UTF8'),'sha256'),'hex'),
  '70000000-0000-4000-8000-000000000201',
  '70000000-0000-4000-8000-000000000302',
  '70000000-0000-4000-8000-000000000001'
);

update public.lukas_drawing_library_versions
set status='published',
  published_by='70000000-0000-4000-8000-000000000001',
  published_at='2026-08-29T00:00:00Z'
where id='70000000-0000-4000-8000-000000000312';

insert into public.lukas_qto_price_books(
  id,project_id,name,version_label,effective_date,currency,rights_basis,
  license_note,source_file_id,source_sha256,created_by
) values(
  '70000000-0000-4000-8000-000000000401',
  '70000000-0000-4000-8000-000000000201','P7 gate prices','2026-08',
  '2026-08-01','KRW','customer_owned','Local fixture only',
  '70000000-0000-4000-8000-000000000211',repeat('2',64),
  '70000000-0000-4000-8000-000000000001'
);

insert into public.lukas_qto_boq_versions(
  id,project_id,version_no,title,status,calculation_policy,quantity_scale,
  price_book_id,engine_version,created_by
) values(
  '70000000-0000-4000-8000-000000000402',
  '70000000-0000-4000-8000-000000000201',1,'P7 gate BOQ','draft',
  'general_half_away',6,'70000000-0000-4000-8000-000000000401',
  'VERIFIED-BOQ-1.0','70000000-0000-4000-8000-000000000001'
);

insert into public.lukas_qto_carbon_factors(
  id,project_id,material_code,product_name,declared_unit,gwp_a1_a3_per_unit,
  source_type,standard,source_file_id,source_sha256,created_by
) values(
  '70000000-0000-4000-8000-000000000501',
  '70000000-0000-4000-8000-000000000201','P7-M-001','P7 gate material',
  'm2',1,'generic','ISO 14040',
  '70000000-0000-4000-8000-000000000211',repeat('2',64),
  '70000000-0000-4000-8000-000000000001'
);

insert into public.lukas_qto_material_plans(
  id,project_id,material_code,material_name,specification,unit,
  design_quantity,allowance_rate,required_quantity,rule_id,
  source_file_id,source_sha256,baseline_factor_id,created_by
) values(
  '70000000-0000-4000-8000-000000000502',
  '70000000-0000-4000-8000-000000000201','P7-M-001','P7 gate material',
  'fixture','m2',1,0,1,'P7_GATE',
  '70000000-0000-4000-8000-000000000211',repeat('2',64),
  '70000000-0000-4000-8000-000000000501',
  '70000000-0000-4000-8000-000000000001'
);

insert into public.lukas_qto_material_transactions(
  id,project_id,material_plan_id,transaction_type,document_number,
  supplier_name,occurred_on,quantity,carbon_factor_id,note,created_by
) values(
  '70000000-0000-4000-8000-000000000503',
  '70000000-0000-4000-8000-000000000201',
  '70000000-0000-4000-8000-000000000502','purchase_order','P7-PO-1',
  'P7 fixture supplier','2026-08-29',1,
  '70000000-0000-4000-8000-000000000501','Local fixture only',
  '70000000-0000-4000-8000-000000000001'
);

select pg_catalog.set_config('request.jwt.claims','{}',false);
