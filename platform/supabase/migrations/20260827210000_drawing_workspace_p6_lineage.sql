begin;

-- P6 fixed database errors: P6A01 P6Q01 P6Q02 P6Q03 P6U01 P6O01 P6B04 P6C01 P6M01 P6M02.
-- Fail before DDL if the composite authority that makes the bridge safe changed.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'public.lukas_qto_projects','public.lukas_drawing_revisions',
    'public.lukas_drawing_snapshots','public.lukas_drawing_objects',
    'public.lukas_drawing_revision_approvals','public.lukas_qto_boq_versions',
    'public.lukas_qto_boq_lines','public.lukas_qto_boq_rate_components',
    'public.lukas_qto_price_resources','public.lukas_qto_material_plans',
    'public.lukas_qto_files'
  ] loop
    if pg_catalog.to_regclass(v_table) is null then
      raise exception using errcode='P6Q03', message='P6 base authority is missing';
    end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid='public.lukas_drawing_snapshots'::pg_catalog.regclass
      and c.contype='u'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%(revision_id, project_id, revision_version, sha256)%'
  ) or not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid='public.lukas_drawing_objects'::pg_catalog.regclass
      and c.contype='u'
      and pg_catalog.pg_get_constraintdef(c.oid) like '%(id, revision_id, project_id)%'
  ) then
    raise exception using errcode='P6Q03', message='P6 base composite keys differ';
  end if;
end;
$$;

alter table public.lukas_qto_boq_versions
  add column input_state_sha256 text,
  add column manifest_sha256 text,
  add constraint lukas_qto_boq_versions_input_state_sha256_check
    check (input_state_sha256 is null or input_state_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint lukas_qto_boq_versions_manifest_sha256_check
    check (manifest_sha256 is null or manifest_sha256 ~ '^[0-9a-f]{64}$');

alter table public.lukas_qto_boq_versions
  drop constraint lukas_qto_boq_versions_engine_version_check,
  add constraint lukas_qto_boq_versions_engine_version_check
    check (engine_version in ('VERIFIED-BOQ-1.0','VERIFIED-BOQ-1.1')),
  add constraint lukas_qto_boq_versions_p6_frozen_hashes_check check (
    engine_version='VERIFIED-BOQ-1.0' or status='draft' or (
      input_state_sha256 is not null and result_sha256 is not null
      and manifest_sha256 is not null
    )
  );

alter table public.lukas_qto_boq_rate_components
  add constraint lukas_qto_boq_rate_components_p6_identity_key
  unique (id,version_id,project_id);

create table public.lukas_drawing_quantity_links (
  id uuid primary key,
  project_id uuid not null,
  drawing_revision_id uuid not null,
  drawing_revision_version bigint not null check (drawing_revision_version>0),
  drawing_snapshot_sha256 text not null check (drawing_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  drawing_object_id uuid not null,
  drawing_object_lineage_id uuid not null,
  drawing_object_version bigint not null check (drawing_object_version>0),
  object_fingerprint text not null check (object_fingerprint ~ '^[0-9a-f]{64}$'),
  measurement_kind text not null check (measurement_kind in ('length','area','count')),
  raw_quantity numeric(29,12) not null check (raw_quantity>=0),
  unit text not null check (unit in ('EA','m','m2')),
  measurement_rule_version text not null check (measurement_rule_version='P4_MEASUREMENT_V1'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(id,project_id),
  unique(drawing_revision_id,drawing_object_id,measurement_kind,measurement_rule_version),
  foreign key(project_id) references public.lukas_qto_projects(id) on delete restrict,
  foreign key(drawing_revision_id,project_id,drawing_revision_version,drawing_snapshot_sha256)
    references public.lukas_drawing_snapshots(revision_id,project_id,revision_version,sha256) on delete restrict,
  foreign key(drawing_object_id,drawing_revision_id,project_id)
    references public.lukas_drawing_objects(id,revision_id,project_id) on delete restrict,
  check ((measurement_kind='length' and unit='m') or (measurement_kind='area' and unit='m2') or (measurement_kind='count' and unit='EA'))
);

create table public.lukas_drawing_boq_links (
  id uuid primary key,
  project_id uuid not null,
  quantity_link_id uuid not null,
  boq_version_id uuid not null,
  boq_line_id uuid not null,
  allocation_factor numeric(20,9) not null check (allocation_factor>0 and allocation_factor<=1),
  version bigint not null default 1 check(version>0),
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique(id,project_id), unique(boq_version_id,quantity_link_id,boq_line_id),
  foreign key(project_id) references public.lukas_qto_projects(id) on delete restrict,
  foreign key(quantity_link_id,project_id) references public.lukas_drawing_quantity_links(id,project_id) on delete restrict,
  foreign key(boq_version_id,project_id) references public.lukas_qto_boq_versions(id,project_id) on delete restrict,
  foreign key(boq_line_id,boq_version_id,project_id) references public.lukas_qto_boq_lines(id,version_id,project_id) on delete restrict
);

create table public.lukas_drawing_material_links (
  id uuid primary key,
  project_id uuid not null,
  boq_version_id uuid not null,
  boq_line_id uuid not null,
  boq_rate_component_id uuid not null,
  material_resource_id uuid not null,
  boq_result_sha256 text not null check (boq_result_sha256 ~ '^[0-9a-f]{64}$'),
  material_plan_id uuid not null,
  derived_design_quantity numeric(29,9) not null check(derived_design_quantity>=0),
  material_rule_version text not null check(material_rule_version='P6_MATERIAL_HANDOFF_V1'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(id,project_id), unique(boq_version_id,boq_rate_component_id),
  foreign key(project_id) references public.lukas_qto_projects(id) on delete restrict,
  foreign key(boq_version_id,project_id) references public.lukas_qto_boq_versions(id,project_id) on delete restrict,
  foreign key(boq_line_id,boq_version_id,project_id) references public.lukas_qto_boq_lines(id,version_id,project_id) on delete restrict,
  foreign key(boq_rate_component_id,boq_version_id,project_id) references public.lukas_qto_boq_rate_components(id,version_id,project_id) on delete restrict,
  foreign key(material_resource_id,project_id) references public.lukas_qto_price_resources(id,project_id) on delete restrict,
  foreign key(material_plan_id,project_id) references public.lukas_qto_material_plans(id,project_id) on delete restrict
);

create index lukas_drawing_quantity_links_object_idx on public.lukas_drawing_quantity_links(project_id,drawing_revision_id,drawing_object_id);
create index lukas_drawing_quantity_links_lineage_idx on public.lukas_drawing_quantity_links(project_id,drawing_object_lineage_id,created_at desc);
create index lukas_drawing_boq_links_line_idx on public.lukas_drawing_boq_links(project_id,boq_version_id,boq_line_id);
create index lukas_drawing_boq_links_source_idx on public.lukas_drawing_boq_links(project_id,quantity_link_id,boq_version_id);
create index lukas_drawing_material_links_line_idx on public.lukas_drawing_material_links(project_id,boq_version_id,boq_line_id);
create index lukas_drawing_material_links_plan_idx on public.lukas_drawing_material_links(project_id,material_plan_id);
create index lukas_drawing_material_links_resource_idx on public.lukas_drawing_material_links(project_id,material_resource_id);

create function private.lukas_drawing_reject_p6_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='P6Q02',message='Drawing quantity links are immutable'; end;
$$;
create function private.lukas_drawing_reject_p6_material_immutable()
returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception using errcode='P6M02',message='Drawing material links are immutable'; end;
$$;
create trigger lukas_drawing_quantity_links_immutable before update or delete on public.lukas_drawing_quantity_links for each row execute function private.lukas_drawing_reject_p6_immutable();
create trigger lukas_drawing_material_links_immutable before update or delete on public.lukas_drawing_material_links for each row execute function private.lukas_drawing_reject_p6_material_immutable();

create function private.lukas_drawing_p6_input_state(p_version_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'versionId',v.id,'projectId',v.project_id,'engineVersion',v.engine_version,
    'calculationPolicy',v.calculation_policy,'quantityScale',v.quantity_scale,
    'lines',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',l.id,'itemCode',l.item_code,'unit',l.unit,'adjustment',l.signed_adjustment,
      'reason',l.adjustment_reason) order by l.item_code,l.id)
      from public.lukas_qto_boq_lines l where l.version_id=v.id),'[]'::jsonb),
    'drawingLinks',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',b.id,'source',b.quantity_link_id,'line',b.boq_line_id,'factor',b.allocation_factor,
      'version',b.version) order by b.quantity_link_id,b.boq_line_id)
      from public.lukas_drawing_boq_links b where b.boq_version_id=v.id),'[]'::jsonb),
    'components',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',c.id,'line',c.line_id,'resource',c.resource_id,'coefficient',c.coefficient) order by c.id)
      from public.lukas_qto_boq_rate_components c where c.version_id=v.id),'[]'::jsonb)
  ) from public.lukas_qto_boq_versions v where v.id=p_version_id
$$;

create function private.lukas_drawing_p6_input_sha256(p_version_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select pg_catalog.encode(extensions.digest(private.lukas_drawing_p6_input_state(p_version_id)::text,'sha256'),'hex')
$$;

create function private.lukas_drawing_insert_quantity_link(
  p_actor_id uuid,p_id uuid,p_revision_id uuid,p_object_id uuid,p_measurement_kind text,
  p_snapshot_sha256 text,p_object_lineage_id uuid,p_object_version bigint,
  p_object_fingerprint text,p_raw_quantity numeric,p_unit text,p_measurement_rule_version text
) returns public.lukas_drawing_quantity_links
language plpgsql security definer set search_path='' as $$
declare v_snapshot public.lukas_drawing_snapshots%rowtype;
declare v_object public.lukas_drawing_objects%rowtype;
declare v_result public.lukas_drawing_quantity_links%rowtype;
declare v_status text; v_digest text;
begin
  if pg_catalog.current_setting('role',true)<>'service_role' or p_actor_id is null then
    raise exception using errcode='P6A01',message='Trusted quantity authority required';
  end if;
  select * into v_snapshot from public.lukas_drawing_snapshots s
    where s.revision_id=p_revision_id and s.sha256=p_snapshot_sha256 for share;
  select r.status into v_status from public.lukas_drawing_revisions r
    where r.id=p_revision_id and r.project_id=v_snapshot.project_id for share;
  select * into v_object from public.lukas_drawing_objects o
    where o.id=p_object_id and o.revision_id=p_revision_id and o.project_id=v_snapshot.project_id for share;
  v_digest:=pg_catalog.encode(extensions.digest(v_snapshot.canonical_json::text,'sha256'),'hex');
  if not found or v_status not in ('approved','superseded') or v_snapshot.revision_version is null
    or v_digest<>v_snapshot.sha256 or p_measurement_rule_version<>'P4_MEASUREMENT_V1'
    or not exists(select 1 from public.lukas_drawing_revision_approvals a where a.revision_id=p_revision_id
      and a.project_id=v_snapshot.project_id and a.subject_version=v_snapshot.revision_version
      and a.snapshot_sha256=v_snapshot.sha256 and a.decision='approved') then
    raise exception using errcode='P6Q03',message='Drawing approval or snapshot is stale';
  end if;
  if v_object.id is null or v_object.status<>'active' or v_object.lineage_id<>p_object_lineage_id
    or v_object.version<>p_object_version or p_object_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception using errcode='P6Q03',message='Drawing object identity differs';
  end if;
  if (p_measurement_kind='length' and p_unit<>'m') or (p_measurement_kind='area' and p_unit<>'m2')
    or (p_measurement_kind='count' and p_unit<>'EA') then
    raise exception using errcode='P6U01',message='Drawing measurement unit differs';
  end if;
  if p_measurement_kind not in ('length','area','count') or p_raw_quantity<0
    or pg_catalog.scale(p_raw_quantity)>12 then
    raise exception using errcode='P6Q01',message='Drawing measurement is unavailable';
  end if;
  select * into v_result from public.lukas_drawing_quantity_links where id=p_id for share;
  if found then
    if v_result.project_id=v_snapshot.project_id and v_result.drawing_revision_id=p_revision_id
      and v_result.drawing_object_id=p_object_id and v_result.measurement_kind=p_measurement_kind
      and v_result.raw_quantity=p_raw_quantity and v_result.object_fingerprint=p_object_fingerprint then return v_result; end if;
    raise exception using errcode='P6O01',message='Quantity replay differs';
  end if;
  insert into public.lukas_drawing_quantity_links(
    id,project_id,drawing_revision_id,drawing_revision_version,drawing_snapshot_sha256,
    drawing_object_id,drawing_object_lineage_id,drawing_object_version,object_fingerprint,
    measurement_kind,raw_quantity,unit,measurement_rule_version,created_by
  ) values(p_id,v_snapshot.project_id,p_revision_id,v_snapshot.revision_version,p_snapshot_sha256,
    p_object_id,p_object_lineage_id,p_object_version,p_object_fingerprint,p_measurement_kind,
    p_raw_quantity,p_unit,p_measurement_rule_version,p_actor_id) returning * into v_result;
  return v_result;
end;
$$;

create function public.lukas_drawing_put_boq_link(
  p_id uuid,p_quantity_link_id uuid,p_boq_version_id uuid,p_boq_line_id uuid,
  p_allocation_factor numeric,p_base_version bigint default null
) returns public.lukas_drawing_boq_links
language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_version public.lukas_qto_boq_versions%rowtype;
declare v_result public.lukas_drawing_boq_links%rowtype; v_total numeric;
begin
  select * into v_version from public.lukas_qto_boq_versions v where v.id=p_boq_version_id for update;
  if v_actor is null or not found or v_version.status<>'draft' or v_version.created_by<>v_actor
    or private.lukas_qto_project_role(v_version.project_id) not in ('owner','staff','estimator') then
    raise exception using errcode='P6A01',message='Draft maker role required';
  end if;
  if p_allocation_factor<=0 or p_allocation_factor>1 then raise exception using errcode='P6B04',message='Allocation factor is invalid'; end if;
  if not exists(select 1 from public.lukas_drawing_quantity_links q where q.id=p_quantity_link_id and q.project_id=v_version.project_id)
    or not exists(select 1 from public.lukas_qto_boq_lines l where l.id=p_boq_line_id and l.version_id=p_boq_version_id and l.project_id=v_version.project_id
      and l.unit=(select q.unit from public.lukas_drawing_quantity_links q where q.id=p_quantity_link_id)) then
    raise exception using errcode='P6U01',message='BOQ ancestry or unit differs';
  end if;
  select * into v_result from public.lukas_drawing_boq_links where id=p_id for update;
  if found then
    if v_result.quantity_link_id=p_quantity_link_id and v_result.boq_version_id=p_boq_version_id and v_result.boq_line_id=p_boq_line_id
      and v_result.allocation_factor=p_allocation_factor then return v_result; end if;
    if p_base_version is null or v_result.version<>p_base_version then raise exception using errcode='P6O01',message='BOQ link is stale'; end if;
    select coalesce(sum(b.allocation_factor),0)-v_result.allocation_factor+p_allocation_factor into v_total
      from public.lukas_drawing_boq_links b where b.boq_version_id=p_boq_version_id and b.quantity_link_id=p_quantity_link_id;
    if v_total>1 then raise exception using errcode='P6B04',message='Drawing allocation exceeds one'; end if;
    update public.lukas_drawing_boq_links set allocation_factor=p_allocation_factor,version=version+1,updated_by=v_actor,updated_at=pg_catalog.now()
      where id=p_id returning * into v_result; return v_result;
  end if;
  select coalesce(sum(b.allocation_factor),0)+p_allocation_factor into v_total from public.lukas_drawing_boq_links b
    where b.boq_version_id=p_boq_version_id and b.quantity_link_id=p_quantity_link_id;
  if v_total>1 then raise exception using errcode='P6B04',message='Drawing allocation exceeds one'; end if;
  insert into public.lukas_drawing_boq_links(id,project_id,quantity_link_id,boq_version_id,boq_line_id,allocation_factor,created_by,updated_by)
    values(p_id,v_version.project_id,p_quantity_link_id,p_boq_version_id,p_boq_line_id,p_allocation_factor,v_actor,v_actor) returning * into v_result;
  return v_result;
end;
$$;

create function public.lukas_drawing_delete_boq_link(p_id uuid,p_base_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_link public.lukas_drawing_boq_links%rowtype; v_version public.lukas_qto_boq_versions%rowtype;
begin
  select * into v_link from public.lukas_drawing_boq_links where id=p_id for update;
  select * into v_version from public.lukas_qto_boq_versions where id=v_link.boq_version_id for update;
  if v_actor is null or not found or v_version.status<>'draft' or v_version.created_by<>v_actor
    or private.lukas_qto_project_role(v_version.project_id) not in ('owner','staff','estimator') then raise exception using errcode='P6A01',message='Draft maker role required'; end if;
  if p_base_version is null or p_base_version<>v_link.version then raise exception using errcode='P6O01',message='BOQ link is stale'; end if;
  delete from public.lukas_drawing_boq_links where id=p_id;
  return pg_catalog.jsonb_build_object('id',p_id,'deleted',true);
end;
$$;

create function public.lukas_qto_boq_v1_1_input(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v public.lukas_qto_boq_versions%rowtype; v_state jsonb;
begin
  select * into v from public.lukas_qto_boq_versions where id=p_version_id;
  if (select auth.uid()) is null or not found or v.created_by<>(select auth.uid())
    or v.status<>'draft' or private.lukas_qto_project_role(v.project_id) not in ('owner','staff','estimator') then
    raise exception using errcode='P6A01',message='Draft maker authority required';
  end if;
  if v.engine_version<>'VERIFIED-BOQ-1.1' then raise exception using errcode='P6B04',message='BOQ engine is not 1.1'; end if;
  select private.lukas_drawing_p6_input_state(p_version_id) into v_state;
  return pg_catalog.jsonb_build_object('input',v_state,'inputStateSha256',private.lukas_drawing_p6_input_sha256(p_version_id));
end;
$$;

create function private.lukas_qto_finalize_boq_v1_1(
  p_actor_id uuid,p_version_id uuid,p_input_state_sha256 text,p_result_sha256 text,
  p_manifest_sha256 text,p_direct_cost_krw numeric,p_line_count integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.lukas_qto_boq_versions%rowtype;
begin
  if pg_catalog.current_setting('role',true)<>'service_role' or p_actor_id is null then raise exception using errcode='P6A01',message='Trusted finalization authority required'; end if;
  select * into v from public.lukas_qto_boq_versions where id=p_version_id for update;
  if not found or v.engine_version<>'VERIFIED-BOQ-1.1' or v.status<>'draft' or v.created_by<>p_actor_id then
    raise exception using errcode='P6O01',message='BOQ finalization is stale';
  end if;
  if p_input_state_sha256<>private.lukas_drawing_p6_input_sha256(p_version_id)
    or p_input_state_sha256 !~ '^[0-9a-f]{64}$' or p_result_sha256 !~ '^[0-9a-f]{64}$'
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$' or p_direct_cost_krw<0 or p_line_count<0 then
    raise exception using errcode='P6C01',message='BOQ calculation digest differs';
  end if;
  if exists(select 1 from public.lukas_drawing_boq_links b where b.boq_version_id=p_version_id group by b.quantity_link_id having sum(b.allocation_factor)<>1) then
    raise exception using errcode='P6B04',message='Drawing allocations are incomplete';
  end if;
  update public.lukas_qto_boq_versions set input_state_sha256=p_input_state_sha256,result_sha256=p_result_sha256,
    manifest_sha256=p_manifest_sha256,direct_cost_krw=p_direct_cost_krw,line_count=p_line_count,status='in_review'
    where id=p_version_id;
  return pg_catalog.jsonb_build_object('versionId',p_version_id,'inputStateSha256',p_input_state_sha256,'resultSha256',p_result_sha256,'manifestSha256',p_manifest_sha256);
end;
$$;

create function private.lukas_drawing_insert_material_handoff(
  p_actor_id uuid,p_boq_version_id uuid,p_result_sha256 text,p_manifest_file_id uuid,
  p_manifest_file_sha256 text,p_material_plan_rows jsonb,p_material_link_rows jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.lukas_qto_boq_versions%rowtype; v_link jsonb; v_plan jsonb; v_count integer:=0;
begin
  if pg_catalog.current_setting('role',true)<>'service_role' or p_actor_id is null then raise exception using errcode='P6A01',message='Trusted material authority required'; end if;
  if pg_catalog.jsonb_typeof(p_material_plan_rows)<>'array' or pg_catalog.jsonb_typeof(p_material_link_rows)<>'array'
    or pg_catalog.jsonb_array_length(p_material_plan_rows)>2000 or pg_catalog.jsonb_array_length(p_material_link_rows)>10000 then
    raise exception using errcode='P6M01',message='Material handoff payload exceeds bounds';
  end if;
  select * into v from public.lukas_qto_boq_versions where id=p_boq_version_id for update;
  if not found or v.status not in ('approved','superseded') or v.result_sha256<>p_result_sha256
    or not exists(select 1 from public.lukas_qto_boq_approvals a where a.version_id=v.id and a.decision='approved')
    or not exists(select 1 from public.lukas_qto_files f where f.id=p_manifest_file_id and f.project_id=v.project_id and f.sha256=p_manifest_file_sha256) then
    raise exception using errcode='P6M01',message='Approved BOQ manifest is required';
  end if;
  if private.lukas_qto_project_role(v.project_id) not in ('owner','staff','estimator') then raise exception using errcode='P6A01',message='Material maker role required'; end if;
  for v_plan in select value from pg_catalog.jsonb_array_elements(p_material_plan_rows) loop
    if pg_catalog.jsonb_typeof(v_plan)<>'object' or v_plan - array['id','materialResourceId','materialCode','materialName','specification','unit','designQuantity','allowanceRate','requiredQuantity','ruleId'] <> '{}'::jsonb then
      raise exception using errcode='P6M01',message='Material plan keys are invalid';
    end if;
    if (v_plan->>'ruleId')<>'P6_MATERIAL_HANDOFF_V1' or (v_plan->>'allowanceRate')::numeric<>0
      or (v_plan->>'requiredQuantity')::numeric<>(v_plan->>'designQuantity')::numeric
      or not exists(select 1 from public.lukas_qto_price_resources r where r.id=(v_plan->>'materialResourceId')::uuid and r.project_id=v.project_id and r.resource_type='material'
        and r.resource_code=v_plan->>'materialCode' and r.resource_name=v_plan->>'materialName' and r.specification=v_plan->>'specification' and r.unit=v_plan->>'unit') then
      raise exception using errcode='P6M01',message='Material plan differs from resource';
    end if;
    insert into public.lukas_qto_material_plans(id,project_id,material_code,material_name,specification,unit,design_quantity,allowance_rate,required_quantity,rule_id,source_file_id,source_sha256,created_by)
      values((v_plan->>'id')::uuid,v.project_id,v_plan->>'materialCode',v_plan->>'materialName',v_plan->>'specification',v_plan->>'unit',(v_plan->>'designQuantity')::numeric,0,(v_plan->>'requiredQuantity')::numeric,'P6_MATERIAL_HANDOFF_V1',p_manifest_file_id,p_manifest_file_sha256,p_actor_id)
      on conflict(id) do nothing;
  end loop;
  for v_link in select value from pg_catalog.jsonb_array_elements(p_material_link_rows) loop
    if pg_catalog.jsonb_typeof(v_link)<>'object' or v_link - array['id','boqLineId','boqRateComponentId','materialResourceId','materialPlanId','derivedDesignQuantity'] <> '{}'::jsonb then
      raise exception using errcode='P6M01',message='Material link keys are invalid';
    end if;
    if not exists(select 1 from public.lukas_qto_boq_rate_components c join public.lukas_qto_price_resources r on r.id=c.resource_id and r.project_id=c.project_id
      join public.lukas_qto_boq_lines l on l.id=c.line_id and l.version_id=c.version_id and l.project_id=c.project_id
      join public.lukas_qto_material_plans p on p.id=(v_link->>'materialPlanId')::uuid and p.project_id=c.project_id
      where c.id=(v_link->>'boqRateComponentId')::uuid and c.version_id=v.id and c.project_id=v.project_id
        and l.id=(v_link->>'boqLineId')::uuid and r.id=(v_link->>'materialResourceId')::uuid and r.resource_type='material'
        and p.material_code=r.resource_code and p.material_name=r.resource_name and p.specification=r.specification and p.unit=r.unit
        and p.source_file_id=p_manifest_file_id and p.source_sha256=p_manifest_file_sha256) then
      raise exception using errcode='P6M01',message='Material component or plan differs';
    end if;
    insert into public.lukas_drawing_material_links(id,project_id,boq_version_id,boq_line_id,boq_rate_component_id,material_resource_id,boq_result_sha256,material_plan_id,derived_design_quantity,material_rule_version,created_by)
      values((v_link->>'id')::uuid,v.project_id,v.id,(v_link->>'boqLineId')::uuid,(v_link->>'boqRateComponentId')::uuid,(v_link->>'materialResourceId')::uuid,p_result_sha256,(v_link->>'materialPlanId')::uuid,(v_link->>'derivedDesignQuantity')::numeric,'P6_MATERIAL_HANDOFF_V1',p_actor_id)
      on conflict(boq_version_id,boq_rate_component_id) do nothing;
    v_count:=v_count+1;
  end loop;
  return pg_catalog.jsonb_build_object('insertedOrReplayed',v_count);
end;
$$;

create or replace function public.lukas_qto_guard_boq_version_transition()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.engine_version='VERIFIED-BOQ-1.1' and new.status in ('in_review','approved','superseded')
    and (new.input_state_sha256 is null or new.result_sha256 is null or new.manifest_sha256 is null) then
    raise exception using errcode='P6C01',message='BOQ 1.1 requires frozen hashes';
  end if;
  if new.id is distinct from old.id or new.project_id is distinct from old.project_id
     or new.version_no is distinct from old.version_no or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then raise exception 'BOQ version identity is immutable'; end if;
  if old.status='superseded' then raise exception 'A superseded BOQ version is immutable'; end if;
  if old.status='approved' then
    if new.status='superseded' and exists(select 1 from public.lukas_qto_boq_versions s where s.supersedes_id=old.id and s.status='approved') then return new; end if;
    raise exception 'An approved BOQ version is immutable except when superseded by an approved successor';
  end if;
  if new.status=old.status then
    if old.status<>'draft' then raise exception 'A submitted BOQ version cannot be edited'; end if;
    if old.created_by is distinct from (select auth.uid()) then raise exception 'Only the BOQ maker can edit a draft version'; end if;
    return new;
  end if;
  if old.status='draft' and new.status='in_review' then
    if old.created_by is distinct from (select auth.uid()) then raise exception 'Only the BOQ maker can submit a draft version'; end if;
    if exists(select 1 from public.lukas_qto_boq_lines l where l.version_id=old.id and exists(select 1 from public.lukas_qto_boq_sections c where c.parent_id=l.section_id)) then raise exception 'Every BOQ line must belong to a CBS leaf node'; end if;
    if exists(select 1 from public.lukas_qto_boq_wbs_nodes where version_id=old.id) and exists(select 1 from public.lukas_qto_boq_lines l left join public.lukas_qto_boq_wbs_allocations a on a.line_id=l.id where l.version_id=old.id group by l.id having coalesce(sum(a.allocation_percent),0)<>100) then raise exception 'Every BOQ line must have exactly 100 percent WBS allocation'; end if;
    if exists(select 1 from public.lukas_qto_boq_wbs_allocations a where a.version_id=old.id and exists(select 1 from public.lukas_qto_boq_wbs_nodes c where c.parent_id=a.wbs_node_id)) then raise exception 'Every WBS allocation must target a leaf node'; end if;
    new.submitted_at:=coalesce(new.submitted_at,pg_catalog.now()); new.approved_at:=null;
  elsif old.status='in_review' and new.status='draft' then
    if not exists(select 1 from public.lukas_qto_boq_approvals a where a.version_id=old.id and a.decision='rejected') then raise exception 'A rejected review is required before returning to draft'; end if;
    new.submitted_at:=null; new.approved_at:=null;
  elsif old.status='in_review' and new.status='approved' then
    if not exists(select 1 from public.lukas_qto_boq_approvals a where a.version_id=old.id and a.decision='approved' and a.decided_by=(select auth.uid()) and a.decided_by<>old.created_by) then raise exception 'An independent approval by the current reviewer is required'; end if;
    new.approved_at:=coalesce(new.approved_at,pg_catalog.now());
  else raise exception 'Unsupported BOQ status transition'; end if;
  return new;
end;
$$;

create or replace function public.lukas_qto_decide_boq(p_version_id uuid,p_decision text,p_note text default '')
returns void language plpgsql security definer set search_path='' as $$
declare v public.lukas_qto_boq_versions%rowtype;
begin
  select * into v from public.lukas_qto_boq_versions where id=p_version_id for update;
  if v.engine_version='VERIFIED-BOQ-1.1' and p_decision='approved'
    and (v.input_state_sha256 is null or v.result_sha256 is null or v.manifest_sha256 is null
      or v.input_state_sha256<>private.lukas_drawing_p6_input_sha256(p_version_id)) then
    raise exception using errcode='P6C01',message='BOQ 1.1 authority differs';
  end if;
  if p_decision not in ('approved','rejected','deferred') then raise exception 'Unsupported BOQ decision'; end if;
  insert into public.lukas_qto_boq_approvals(version_id,decided_by,decision,note)
    values(p_version_id,(select auth.uid()),p_decision,coalesce(p_note,''));
  if p_decision='approved' then
    update public.lukas_qto_boq_versions set status='approved' where id=p_version_id;
    update public.lukas_qto_boq_versions predecessor set status='superseded'
      where predecessor.id=(select successor.supersedes_id from public.lukas_qto_boq_versions successor where successor.id=p_version_id)
        and predecessor.status='approved';
  elsif p_decision='rejected' then
    update public.lukas_qto_boq_versions set status='draft' where id=p_version_id;
  end if;
end;
$$;

alter table public.lukas_drawing_quantity_links enable row level security;
alter table public.lukas_drawing_boq_links enable row level security;
alter table public.lukas_drawing_material_links enable row level security;

create policy "P6 project roles read drawing quantities" on public.lukas_drawing_quantity_links for select to authenticated
  using ((select auth.uid()) is not null and private.lukas_qto_project_role(project_id) is not null);
create policy "P6 project roles read drawing BOQ links" on public.lukas_drawing_boq_links for select to authenticated
  using ((select auth.uid()) is not null and private.lukas_qto_project_role(project_id) is not null);
create policy "P6 project roles read drawing material links" on public.lukas_drawing_material_links for select to authenticated
  using ((select auth.uid()) is not null and private.lukas_qto_project_role(project_id) is not null);
create policy "P6 verified sessions read drawing quantities" on public.lukas_drawing_quantity_links as restrictive for select to authenticated
  using (private.lukas_qto_verified_session());
create policy "P6 verified sessions read drawing BOQ links" on public.lukas_drawing_boq_links as restrictive for select to authenticated
  using (private.lukas_qto_verified_session());
create policy "P6 verified sessions read drawing material links" on public.lukas_drawing_material_links as restrictive for select to authenticated
  using (private.lukas_qto_verified_session());

revoke all on table public.lukas_drawing_quantity_links,public.lukas_drawing_boq_links,public.lukas_drawing_material_links from public,anon,authenticated,service_role;
grant select on table public.lukas_drawing_quantity_links to authenticated;
grant select on table public.lukas_drawing_boq_links to authenticated;
grant select on table public.lukas_drawing_material_links to authenticated;
grant select,insert on table public.lukas_drawing_quantity_links to service_role;
grant select,insert on table public.lukas_drawing_boq_links to service_role;
grant select,insert on table public.lukas_drawing_material_links to service_role;

revoke all on function private.lukas_drawing_reject_p6_immutable() from public,anon,authenticated;
revoke all on function private.lukas_drawing_reject_p6_material_immutable() from public,anon,authenticated;
revoke all on function private.lukas_drawing_p6_input_state(uuid) from public,anon,authenticated;
revoke all on function private.lukas_drawing_p6_input_sha256(uuid) from public,anon,authenticated;
revoke all on function private.lukas_drawing_insert_quantity_link(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text) from public,anon,authenticated;
revoke all on function private.lukas_qto_finalize_boq_v1_1(uuid,uuid,text,text,text,numeric,integer) from public,anon,authenticated;
revoke all on function private.lukas_drawing_insert_material_handoff(uuid,uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.lukas_drawing_insert_quantity_link(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text) to service_role;
grant execute on function private.lukas_qto_finalize_boq_v1_1(uuid,uuid,text,text,text,numeric,integer) to service_role;
grant execute on function private.lukas_drawing_insert_material_handoff(uuid,uuid,text,uuid,text,jsonb,jsonb) to service_role;

revoke all on function public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint) from public,anon;
revoke all on function public.lukas_drawing_delete_boq_link(uuid,bigint) from public,anon;
revoke all on function public.lukas_qto_boq_v1_1_input(uuid) from public,anon;
revoke all on function public.lukas_qto_decide_boq(uuid,text,text) from public,anon;
grant execute on function public.lukas_drawing_put_boq_link(uuid,uuid,uuid,uuid,numeric,bigint) to authenticated,service_role;
grant execute on function public.lukas_drawing_delete_boq_link(uuid,bigint) to authenticated,service_role;
grant execute on function public.lukas_qto_boq_v1_1_input(uuid) to authenticated,service_role;
grant execute on function public.lukas_qto_decide_boq(uuid,text,text) to authenticated,service_role;

commit;
