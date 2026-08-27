begin;

-- P6 fixed database errors: P6A01 P6Q01 P6Q02 P6Q03 P6U01 P6O01 P6B04 P6C01 P6M01 P6M02.
-- Fail before DDL if the composite authority that makes the bridge safe changed.
do $$
declare v_table text;
begin
  foreach v_table in array array[
    'public.lukas_qto_projects','public.lukas_drawing_revisions',
    'public.lukas_drawing_snapshots','public.lukas_drawing_layers',
    'public.lukas_drawing_objects',
    'public.lukas_drawing_revision_approvals','public.lukas_drawing_object_sources',
    'public.lukas_drawing_object_issue_links','public.lukas_qto_boq_versions',
    'public.lukas_qto_boq_sections','public.lukas_qto_boq_lines',
    'public.lukas_qto_boq_rate_components',
    'public.lukas_qto_boq_quantity_mappings','public.lukas_qto_boq_source_exclusions',
    'public.lukas_qto_boq_approvals','public.lukas_qto_price_books',
    'public.lukas_qto_price_resources','public.lukas_qto_material_plans',
    'public.lukas_qto_files','public.lukas_qto_project_members'
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
  if pg_catalog.to_regprocedure('private.lukas_drawing_geometry_valid(text,jsonb)') is null
    or pg_catalog.to_regprocedure('private.lukas_qto_project_role(uuid)') is null
    or pg_catalog.to_regprocedure('private.lukas_qto_verified_session()') is null then
    raise exception using errcode='P6Q03', message='P6 base authority functions differ';
  end if;
  if exists (
    select 1
    from (values
      ('lukas_drawing_revisions','version'),
      ('lukas_drawing_objects','page_id'),('lukas_drawing_objects','layer_id'),
      ('lukas_drawing_objects','object_type'),('lukas_drawing_objects','host_object_id'),
      ('lukas_drawing_layers','canvas_id'),('lukas_drawing_snapshots','schema_version'),
      ('lukas_drawing_object_sources','version'),('lukas_drawing_object_sources','status'),
      ('lukas_qto_files','kind'),('lukas_qto_files','storage_path'),
      ('lukas_qto_files','immutable'),('lukas_qto_price_resources','price_book_id'),
      ('lukas_qto_material_plans','baseline_factor_id'),
      ('lukas_qto_material_plans','required_by'),
      ('lukas_qto_material_plans','source_artifact_id'),
      ('lukas_qto_material_plans','source_group_key'),
      ('lukas_qto_boq_lines','section_id'),('lukas_qto_boq_lines','item_name'),
      ('lukas_qto_boq_lines','specification'),('lukas_qto_boq_lines','sort_order')
    ) required(table_name,column_name)
    where not exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid=('public.'||required.table_name)::pg_catalog.regclass
        and a.attname=required.column_name and a.attnum>0 and not a.attisdropped
    )
  ) then
    raise exception using errcode='P6Q03', message='P6 base columns differ';
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
create function private.lukas_drawing_guard_p6_boq_link()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_version_id uuid:=case when tg_op='DELETE' then old.boq_version_id else new.boq_version_id end;
declare v_project_id uuid:=case when tg_op='DELETE' then old.project_id else new.project_id end;
declare v_status text;
begin
  select b.status into v_status from public.lukas_qto_boq_versions b
    where b.id=v_version_id and b.project_id=v_project_id for share;
  if v_status is distinct from 'draft' then
    raise exception using errcode='P6O01',message='Submitted BOQ links are immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger lukas_drawing_quantity_links_immutable before update or delete on public.lukas_drawing_quantity_links for each row execute function private.lukas_drawing_reject_p6_immutable();
create trigger lukas_drawing_material_links_immutable before update or delete on public.lukas_drawing_material_links for each row execute function private.lukas_drawing_reject_p6_material_immutable();
create trigger lukas_drawing_boq_links_status_guard before insert or update or delete on public.lukas_drawing_boq_links for each row execute function private.lukas_drawing_guard_p6_boq_link();

create function private.lukas_drawing_p6_input_state(p_version_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select pg_catalog.jsonb_build_object(
    'versionId',v.id,'projectId',v.project_id,'engineVersion',v.engine_version,
    'calculationPolicy',v.calculation_policy,'quantityScale',v.quantity_scale,
    'lines',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',l.id,'sectionId',l.section_id,
      'section',pg_catalog.jsonb_build_object('id',s.id,'parentId',s.parent_id,
        'code',s.code,'name',s.name,'sortOrder',s.sort_order),
      'itemCode',l.item_code,'itemName',l.item_name,'specification',l.specification,
      'unit',l.unit,'adjustment',l.signed_adjustment,
      'reason',l.adjustment_reason,'sortOrder',l.sort_order)
      order by l.item_code collate "C",l.id)
      from public.lukas_qto_boq_lines l
      join public.lukas_qto_boq_sections s
        on s.id=l.section_id and s.version_id=l.version_id and s.project_id=l.project_id
      where l.version_id=v.id),'[]'::jsonb),
    'drawingLinks',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',b.id,'line',b.boq_line_id,'factor',b.allocation_factor,'version',b.version,
      'source',pg_catalog.jsonb_build_object('id',q.id,'revisionId',q.drawing_revision_id,
        'revisionVersion',q.drawing_revision_version,'snapshotSha256',q.drawing_snapshot_sha256,
        'objectId',q.drawing_object_id,'lineageId',q.drawing_object_lineage_id,
        'objectVersion',q.drawing_object_version,'fingerprint',q.object_fingerprint,
        'kind',q.measurement_kind,'rawQuantity',q.raw_quantity,'unit',q.unit,
        'rule',q.measurement_rule_version,
        'anchors',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id',a.id,'sourceFileId',a.source_file_id,'sourceSha256',a.source_sha256,
          'sourceKind',a.source_kind,'pdfPageNumber',a.pdf_page_number,
          'x',a.x,'y',a.y,'width',a.width,'height',a.height,
          'elementId',a.element_id,'ifcGlobalId',a.ifc_global_id,
          'camera',a.camera_json,'version',a.version) order by a.id)
          from public.lukas_drawing_object_sources a
          where a.object_id=q.drawing_object_id
            and a.revision_id=q.drawing_revision_id and a.project_id=q.project_id
            and a.status='active'),'[]'::jsonb),
        'issues',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id',i.id,'issueId',i.issue_id) order by i.id)
          from public.lukas_drawing_object_issue_links i
          where i.object_id=q.drawing_object_id
            and i.revision_id=q.drawing_revision_id and i.project_id=q.project_id),'[]'::jsonb)))
      order by b.quantity_link_id,b.boq_line_id)
      from public.lukas_drawing_boq_links b
      join public.lukas_drawing_quantity_links q
        on q.id=b.quantity_link_id and q.project_id=b.project_id
      where b.boq_version_id=v.id),'[]'::jsonb),
    'legacyMappings',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',m.id,'line',m.line_id,'fileId',m.source_file_id,'sha256',m.source_sha256,
      'subject',m.source_subject_key,'quantity',m.source_quantity,'factor',m.factor,
      'unit',m.unit,'elementIds',m.element_ids) order by m.id)
      from public.lukas_qto_boq_quantity_mappings m where m.version_id=v.id),'[]'::jsonb),
    'legacyExclusions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',e.id,'fileId',e.source_file_id,'sha256',e.source_sha256,'subject',e.source_subject_key,
      'quantity',e.source_quantity,'unit',e.unit,'elementIds',e.element_ids,'reason',e.reason) order by e.id)
      from public.lukas_qto_boq_source_exclusions e where e.version_id=v.id),'[]'::jsonb),
    'components',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',c.id,'line',c.line_id,'resourceId',c.resource_id,'coefficient',c.coefficient,
      'resource',pg_catalog.jsonb_build_object('id',r.id,'code',r.resource_code,'type',r.resource_type,
        'name',r.resource_name,'specification',r.specification,'unit',r.unit,
        'unitPriceKrw',r.unit_price_krw,'priceBookId',r.price_book_id)) order by c.id)
      from public.lukas_qto_boq_rate_components c
      join public.lukas_qto_price_resources r
        on r.id=c.resource_id and r.project_id=c.project_id
      where c.version_id=v.id),'[]'::jsonb),
    'priceBook', (select pg_catalog.jsonb_build_object(
      'id',p.id,'name',p.name,'versionLabel',p.version_label,
      'fileId',p.source_file_id,'sha256',p.source_sha256,
      'effectiveDate',p.effective_date,'currency',p.currency,
      'rightsBasis',p.rights_basis,'licenseNote',p.license_note)
      from public.lukas_qto_price_books p
      where p.id=v.price_book_id and p.project_id=v.project_id)
  ) from public.lukas_qto_boq_versions v where v.id=p_version_id
$$;

create function private.lukas_drawing_p6_input_sha256(p_version_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select pg_catalog.encode(extensions.digest(private.lukas_drawing_p6_input_state(p_version_id)::text,'sha256'),'hex')
$$;

create function private.lukas_drawing_p6_actor_project_role(
  p_actor_id uuid,p_project_id uuid
) returns text language sql stable security definer set search_path='' as $$
  select case
    when p.owner_id=p_actor_id then 'owner'
    when p_actor_id=(select auth.uid())
      and (select auth.jwt()->'app_metadata'->>'role')='hangil_staff' then 'staff'
    else (select m.role from public.lukas_qto_project_members m
      where m.project_id=p.id and m.user_id=p_actor_id)
  end
  from public.lukas_qto_projects p where p.id=p_project_id
$$;

create function private.lukas_drawing_p6_canonical_json(p_value jsonb)
returns text language sql immutable security invoker set search_path='' as $$
  select case pg_catalog.jsonb_typeof(p_value)
    when 'object' then '{'||coalesce((select pg_catalog.string_agg(pg_catalog.to_json(k.key)::text||':'||private.lukas_drawing_p6_canonical_json(k.value),',' order by k.key) from pg_catalog.jsonb_each(p_value) k),'')||'}'
    when 'array' then '['||coalesce((select pg_catalog.string_agg(private.lukas_drawing_p6_canonical_json(a.value),',' order by a.ordinality) from pg_catalog.jsonb_array_elements(p_value) with ordinality as a(value,ordinality)),'')||']'
    when 'number' then pg_catalog.trim_scale((p_value#>>'{}')::numeric)::text
    else p_value::text end
$$;

create function private.lukas_drawing_p6_scaled_integer(p_value jsonb)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare v_value numeric;
begin
  if pg_catalog.jsonb_typeof(p_value)<>'number' then
    raise exception using errcode='P6Q01',message='P4 geometry is invalid';
  end if;
  v_value:=(p_value#>>'{}')::numeric;
  if pg_catalog.abs(v_value)>9000000000
    or v_value*1000000<>pg_catalog.trunc(v_value*1000000) then
    raise exception using errcode='P6Q01',message='P4 geometry is invalid';
  end if;
  return v_value*1000000;
exception
  when sqlstate 'P6Q01' then raise;
  when others then
    raise exception using errcode='P6Q01',message='P4 geometry is invalid';
end;
$$;

create function private.lukas_drawing_p6_integer_sqrt(p_value numeric)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare v_estimate numeric; v_next numeric; v_digits integer;
begin
  if p_value<0 or p_value<>pg_catalog.trunc(p_value) then
    raise exception using errcode='P6Q01',message='P4 square root is invalid';
  end if;
  if p_value<2 then return p_value; end if;
  v_digits:=pg_catalog.char_length(pg_catalog.trunc(p_value)::text);
  v_estimate:=('1'||pg_catalog.repeat('0',(v_digits+1)/2))::numeric;
  loop
    v_next:=pg_catalog.floor((v_estimate+pg_catalog.floor(p_value/v_estimate))/2);
    if v_next>=v_estimate then return v_estimate; end if;
    v_estimate:=v_next;
  end loop;
end;
$$;

create function private.lukas_drawing_p6_round_positive(
  p_numerator numeric,p_denominator numeric
) returns numeric language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_numerator<0 or p_numerator<>pg_catalog.trunc(p_numerator)
    or p_denominator<=0 or p_denominator<>pg_catalog.trunc(p_denominator) then
    raise exception using errcode='P6Q01',message='P4 rounding input is invalid';
  end if;
  return pg_catalog.floor((2*p_numerator+p_denominator)/(2*p_denominator));
end;
$$;

create function private.lukas_drawing_p6_uuid_text(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_text text;
begin
  if pg_catalog.jsonb_typeof(p_value)<>'string' then return false; end if;
  v_text:=p_value#>>'{}';
  return v_text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and v_text=(v_text::uuid)::text;
exception when others then return false;
end;
$$;

create function private.lukas_drawing_p6_decimal_text(
  p_value jsonb,p_integer_digits integer,p_scale integer
) returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare v_text text; v_pattern text;
begin
  if pg_catalog.jsonb_typeof(p_value)<>'string'
    or p_integer_digits not between 1 and 100 or p_scale not between 1 and 100 then
    return false;
  end if;
  v_text:=p_value#>>'{}';
  v_pattern:='^(0|[1-9][0-9]{0,'||(p_integer_digits-1)::text||'})(\.[0-9]{0,'||(p_scale-1)::text||'}[1-9])?$';
  return v_text ~ v_pattern;
exception when others then return false;
end;
$$;

-- Exact SQL equivalent of P4_MEASUREMENT_V1. Every authored number first
-- becomes a six-place scaled integer. Irrational edges are accumulated as an
-- interval and rounded once at the final micromillimetre boundary.
create function private.lukas_drawing_p6_measure(
  p_geometry jsonb,p_kind text,p_snapshot_objects jsonb default null
)
returns numeric language plpgsql immutable security invoker set search_path='' as $$
declare v_type text:=p_geometry->>'type'; v_width numeric; v_height numeric;
declare v_dx numeric; v_dy numeric; v_radius numeric; v_sweep numeric;
declare v_start_x numeric; v_start_y numeric; v_end_x numeric; v_end_y numeric;
declare v_count integer; v_index integer; v_next integer; v_point jsonb; v_next_point jsonb;
declare v_x numeric; v_y numeric; v_next_x numeric; v_next_y numeric;
declare v_doubled_area numeric:=0; v_edges numeric[]:='{}'; v_edge numeric;
declare v_precision numeric; v_lower numeric; v_uncertainty numeric; v_root numeric;
declare v_lower_bucket numeric; v_upper_bucket numeric;
declare v_host jsonb; v_host_count integer; v_offset numeric; v_sill numeric;
declare v_host_height numeric; v_host_squared numeric;
begin
  if pg_catalog.jsonb_typeof(p_geometry)<>'object'
    or p_kind not in ('length','area','count') then
    raise exception using errcode='P6Q01',message='P4 measurement is unavailable';
  end if;
  if private.lukas_drawing_geometry_valid(v_type,p_geometry) is not true then
    raise exception using errcode='P6Q01',message='P4 geometry is invalid';
  end if;
  if v_type in ('wall','grid','opening','space','area','arc')
    and (pg_catalog.jsonb_typeof(p_geometry->'semanticVersion')<>'number'
      or p_geometry->>'semanticVersion'<>'1') then
    raise exception using errcode='P6Q01',message='P4 geometry is invalid';
  end if;
  if v_type in ('wall','grid') then
    v_start_x:=private.lukas_drawing_p6_scaled_integer(p_geometry#>'{start,x}');
    v_start_y:=private.lukas_drawing_p6_scaled_integer(p_geometry#>'{start,y}');
    v_end_x:=private.lukas_drawing_p6_scaled_integer(p_geometry#>'{end,x}');
    v_end_y:=private.lukas_drawing_p6_scaled_integer(p_geometry#>'{end,y}');
    v_dx:=v_end_x-v_start_x; v_dy:=v_end_y-v_start_y;
    if v_dx=0 and v_dy=0 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if p_kind='count' then return 1; end if;
    if p_kind='length' then
      v_root:=private.lukas_drawing_p6_integer_sqrt(v_dx*v_dx+v_dy*v_dy);
      if (v_dx*v_dx+v_dy*v_dy)-v_root*v_root
        >=(v_root+1)*(v_root+1)-(v_dx*v_dx+v_dy*v_dy) then
        v_root:=v_root+1;
      end if;
      return v_root/1000000000;
    end if;
  elsif v_type='opening' then
    v_width:=private.lukas_drawing_p6_scaled_integer(p_geometry->'widthMillimeters');
    v_height:=private.lukas_drawing_p6_scaled_integer(p_geometry->'heightMillimeters');
    v_offset:=private.lukas_drawing_p6_scaled_integer(p_geometry->'offsetMillimeters');
    v_sill:=private.lukas_drawing_p6_scaled_integer(p_geometry->'sillHeightMillimeters');
    if v_width<=0 or v_height<=0 or coalesce(p_geometry->>'hostWallId','')=''
      or p_geometry->>'openingKind' not in ('door','window','void')
      or (p_geometry->>'openingKind'='door' and (p_geometry->>'sillHeightMillimeters')::numeric<>0) then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if pg_catalog.jsonb_typeof(p_snapshot_objects)<>'array' then
      raise exception using errcode='P6Q01',message='P4 opening host is unavailable';
    end if;
    select pg_catalog.count(*) into v_host_count
      from pg_catalog.jsonb_array_elements(p_snapshot_objects)
      where value->>'id'=p_geometry->>'hostWallId';
    select value into v_host from pg_catalog.jsonb_array_elements(p_snapshot_objects)
      where value->>'id'=p_geometry->>'hostWallId';
    if v_host_count<>1 or v_host->>'type'<>'wall' then
      raise exception using errcode='P6Q01',message='P4 opening host is unavailable';
    end if;
    v_start_x:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,start,x}');
    v_start_y:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,start,y}');
    v_end_x:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,end,x}');
    v_end_y:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,end,y}');
    v_host_height:=private.lukas_drawing_p6_scaled_integer(v_host#>'{geometry,heightMillimeters}');
    v_dx:=v_end_x-v_start_x; v_dy:=v_end_y-v_start_y;
    v_host_squared:=v_dx*v_dx+v_dy*v_dy;
    if v_host_squared=0 or 2*v_offset-v_width<0
      or (2*v_offset+v_width)*(2*v_offset+v_width)>4*v_host_squared
      or (p_geometry->>'openingKind'='window' and v_sill+v_height>v_host_height) then
      raise exception using errcode='P6Q01',message='P4 opening host is incompatible';
    end if;
    if p_kind='count' then return 1; end if;
    if p_kind='length' then return v_width/1000000000; end if;
    if p_kind='area' then
      return private.lukas_drawing_p6_round_positive(v_width*v_height,1000000)/1000000000000;
    end if;
  elsif v_type='arc' and p_kind='length' then
    perform private.lukas_drawing_p6_scaled_integer(p_geometry#>'{center,x}');
    perform private.lukas_drawing_p6_scaled_integer(p_geometry#>'{center,y}');
    perform private.lukas_drawing_p6_scaled_integer(p_geometry->'startAngleDegrees');
    v_radius:=private.lukas_drawing_p6_scaled_integer(p_geometry->'radius');
    v_sweep:=pg_catalog.abs(private.lukas_drawing_p6_scaled_integer(p_geometry->'sweepAngleDegrees'));
    if v_radius<=0 or v_sweep<=0 or v_sweep>360000000 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    return private.lukas_drawing_p6_round_positive(
      v_radius*v_sweep*3141592653589793,
      180*1000000::numeric*1000000000000000
    )/1000000000;
  elsif v_type='arc' then
    perform private.lukas_drawing_p6_scaled_integer(p_geometry#>'{center,x}');
    perform private.lukas_drawing_p6_scaled_integer(p_geometry#>'{center,y}');
    perform private.lukas_drawing_p6_scaled_integer(p_geometry->'startAngleDegrees');
    v_radius:=private.lukas_drawing_p6_scaled_integer(p_geometry->'radius');
    v_sweep:=pg_catalog.abs(private.lukas_drawing_p6_scaled_integer(p_geometry->'sweepAngleDegrees'));
    if v_radius<=0 or v_sweep<=0 or v_sweep>360000000 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if p_kind='count' then return 1; end if;
  elsif v_type in ('space','area') then
    if pg_catalog.jsonb_typeof(p_geometry->'boundary')<>'array' then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    v_count:=pg_catalog.jsonb_array_length(p_geometry->'boundary');
    if v_count not between 3 and 4096 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    for v_index in 0..v_count-1 loop
      v_next:=(v_index+1)%v_count;
      v_point:=p_geometry->'boundary'->v_index;
      v_next_point:=p_geometry->'boundary'->v_next;
      v_x:=private.lukas_drawing_p6_scaled_integer(v_point->'x');
      v_y:=private.lukas_drawing_p6_scaled_integer(v_point->'y');
      v_next_x:=private.lukas_drawing_p6_scaled_integer(v_next_point->'x');
      v_next_y:=private.lukas_drawing_p6_scaled_integer(v_next_point->'y');
      v_dx:=v_next_x-v_x; v_dy:=v_next_y-v_y;
      if v_dx=0 and v_dy=0 then
        raise exception using errcode='P6Q01',message='P4 geometry is invalid';
      end if;
      v_edges:=pg_catalog.array_append(v_edges,v_dx*v_dx+v_dy*v_dy);
      v_doubled_area:=v_doubled_area+v_x*v_next_y-v_next_x*v_y;
    end loop;
    if v_doubled_area=0 then
      raise exception using errcode='P6Q01',message='P4 geometry is invalid';
    end if;
    if p_kind='count' then return 1; end if;
    if p_kind='area' then
      return private.lukas_drawing_p6_round_positive(pg_catalog.abs(v_doubled_area),2000000)/1000000000000;
    elsif p_kind='length' then
      v_precision:=1000000;
      loop
        v_lower:=0; v_uncertainty:=0;
        foreach v_edge in array v_edges loop
          v_root:=private.lukas_drawing_p6_integer_sqrt(v_edge*v_precision*v_precision);
          v_lower:=v_lower+v_root;
          if v_root*v_root<>v_edge*v_precision*v_precision then
            v_uncertainty:=v_uncertainty+1;
          end if;
        end loop;
        v_lower_bucket:=private.lukas_drawing_p6_round_positive(v_lower,v_precision);
        v_upper_bucket:=private.lukas_drawing_p6_round_positive(v_lower+v_uncertainty,v_precision);
        if v_lower_bucket=v_upper_bucket then return v_lower_bucket/1000000000; end if;
        v_precision:=v_precision*1000000;
      end loop;
    end if;
  elsif v_type in ('line','polyline','rectangle','circle','text','dimension')
    and p_kind='count' then
    return 1;
  end if;
  raise exception using errcode='P6Q01',message='P4 measurement is unavailable';
exception
  when sqlstate 'P6Q01' then raise;
  when others then
  raise exception using errcode='P6Q01',message='P4 geometry is invalid';
end;
$$;

create function private.lukas_drawing_insert_quantity_link(
  p_actor_id uuid,p_id uuid,p_revision_id uuid,p_object_id uuid,p_measurement_kind text,
  p_snapshot_sha256 text,p_object_lineage_id uuid,p_object_version bigint,
  p_object_fingerprint text,p_raw_quantity numeric,p_unit text,p_measurement_rule_version text
) returns public.lukas_drawing_quantity_links
language plpgsql security definer set search_path='' as $$
declare v_snapshot public.lukas_drawing_snapshots%rowtype;
declare v_object public.lukas_drawing_objects%rowtype;
declare v_host_object public.lukas_drawing_objects%rowtype;
declare v_result public.lukas_drawing_quantity_links%rowtype;
declare v_status text; v_revision_version bigint; v_digest text;
declare v_snapshot_object jsonb; v_host_snapshot_object jsonb;
declare v_fingerprint text; v_object_count integer; v_host_count integer;
declare v_measure numeric;
begin
  if pg_catalog.current_setting('role',true)<>'service_role' or p_actor_id is null then
    raise exception using errcode='P6A01',message='Trusted quantity authority required';
  end if;
  select * into v_snapshot from public.lukas_drawing_snapshots s
    where s.revision_id=p_revision_id and s.sha256=p_snapshot_sha256 for update;
  if v_snapshot.id is null
    or v_snapshot.schema_version<>2
    or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'objects')<>'array'
    or v_snapshot.canonical_json->>'schemaVersion'<>'2' then
    raise exception using errcode='P6Q03',message='Drawing approval or snapshot is stale';
  end if;
  select r.status,r.version into v_status,v_revision_version
    from public.lukas_drawing_revisions r
    where r.id=p_revision_id and r.project_id=v_snapshot.project_id for share;
  select * into v_object from public.lukas_drawing_objects o
    where o.id=p_object_id and o.revision_id=p_revision_id and o.project_id=v_snapshot.project_id for share;
  v_digest:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_snapshot.canonical_json::text,'UTF8'),'sha256'),'hex');
  select count(*) into v_object_count from pg_catalog.jsonb_array_elements(v_snapshot.canonical_json->'objects')
    where value->>'id'=p_object_id::text;
  select value into v_snapshot_object from pg_catalog.jsonb_array_elements(v_snapshot.canonical_json->'objects')
    where value->>'id'=p_object_id::text;
  if v_status not in ('approved','superseded')
    or v_revision_version<>v_snapshot.revision_version
    or v_digest<>v_snapshot.sha256
    or p_measurement_rule_version<>'P4_MEASUREMENT_V1'
    or not exists(select 1 from public.lukas_drawing_revision_approvals a where a.revision_id=p_revision_id
      and a.project_id=v_snapshot.project_id and a.subject_version=v_snapshot.revision_version
      and a.snapshot_sha256=v_snapshot.sha256 and a.decision='approved') then
    raise exception using errcode='P6Q03',message='Drawing approval or snapshot is stale';
  end if;
  if v_object.id is null or v_object_count<>1 or v_object.status<>'active'
    or coalesce(private.lukas_drawing_p6_actor_project_role(
      p_actor_id,v_snapshot.project_id),'') not in ('owner','staff','estimator')
    or v_object.lineage_id<>p_object_lineage_id
    or v_object.version<>p_object_version or v_snapshot_object->>'lineageId'<>p_object_lineage_id::text
    or v_snapshot_object->>'version'<>p_object_version::text
    or v_snapshot_object->>'name' is distinct from v_object.name
    or v_snapshot_object->>'type' is distinct from v_object.object_type
    or v_snapshot_object->>'pageId' is distinct from v_object.page_id::text
    or v_snapshot_object->>'layerId' is distinct from v_object.layer_id::text
    or v_snapshot_object->'geometry' is distinct from v_object.geometry
    or private.lukas_drawing_geometry_valid(v_object.object_type,v_object.geometry) is not true then
    raise exception using errcode='P6Q03',message='Drawing object identity differs';
  end if;
  if v_object.object_type='opening' then
    select pg_catalog.count(*),pg_catalog.min(value::text)::jsonb
      into v_host_count,v_host_snapshot_object
      from pg_catalog.jsonb_array_elements(v_snapshot.canonical_json->'objects')
      where value->>'id'=v_object.host_object_id::text;
    select * into v_host_object from public.lukas_drawing_objects h
      where h.id=v_object.host_object_id and h.revision_id=p_revision_id
        and h.project_id=v_snapshot.project_id for share;
    if v_host_count<>1 or v_host_object.id is null
      or v_host_object.status<>'active' or v_host_object.object_type<>'wall'
      or v_host_object.page_id<>v_object.page_id
      or (select l.canvas_id from public.lukas_drawing_layers l
          where l.id=v_host_object.layer_id and l.revision_id=p_revision_id
            and l.project_id=v_snapshot.project_id)
        is distinct from
        (select l.canvas_id from public.lukas_drawing_layers l
          where l.id=v_object.layer_id and l.revision_id=p_revision_id
            and l.project_id=v_snapshot.project_id)
      or v_host_snapshot_object->>'lineageId' is distinct from v_host_object.lineage_id::text
      or v_host_snapshot_object->>'version' is distinct from v_host_object.version::text
      or v_host_snapshot_object->>'name' is distinct from v_host_object.name
      or v_host_snapshot_object->>'type' is distinct from 'wall'
      or v_host_snapshot_object->>'pageId' is distinct from v_host_object.page_id::text
      or v_host_snapshot_object->>'layerId' is distinct from v_host_object.layer_id::text
      or v_host_snapshot_object->'geometry' is distinct from v_host_object.geometry
      or private.lukas_drawing_geometry_valid('wall',v_host_object.geometry) is not true then
      raise exception using errcode='P6Q03',message='Drawing opening host identity differs';
    end if;
  end if;
  v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    private.lukas_drawing_p6_canonical_json(pg_catalog.jsonb_build_object(
      'geometry',v_snapshot_object->'geometry','id',v_snapshot_object->'id',
      'name',v_snapshot_object->'name','version',v_snapshot_object->'version')),
    'UTF8'),'sha256'),'hex');
  if p_object_fingerprint<>v_fingerprint then
    raise exception using errcode='P6Q03',message='Drawing object fingerprint differs';
  end if;
  if (p_measurement_kind='length' and p_unit<>'m') or (p_measurement_kind='area' and p_unit<>'m2')
    or (p_measurement_kind='count' and p_unit<>'EA') then
    raise exception using errcode='P6U01',message='Drawing measurement unit differs';
  end if;
  if p_measurement_kind not in ('length','area','count') or p_raw_quantity<0
    or pg_catalog.scale(p_raw_quantity)>12 or p_raw_quantity>=100000000000000000 then
    raise exception using errcode='P6Q01',message='Drawing measurement is unavailable';
  end if;
  v_measure:=private.lukas_drawing_p6_measure(
    v_snapshot_object->'geometry',p_measurement_kind,v_snapshot.canonical_json->'objects'
  )::numeric(29,12);
  if v_measure<0 or pg_catalog.scale(v_measure)>12
    or v_measure>=100000000000000000 or p_raw_quantity<>v_measure then
    raise exception using errcode='P6Q01',message='P4 measurement differs';
  end if;
  select * into v_result from public.lukas_drawing_quantity_links where id=p_id for share;
  if v_result.id is not null then
    if v_result.project_id=v_snapshot.project_id
      and v_result.drawing_revision_id=p_revision_id
      and v_result.drawing_revision_version=v_snapshot.revision_version
      and v_result.drawing_snapshot_sha256=p_snapshot_sha256
      and v_result.drawing_object_id=p_object_id
      and v_result.drawing_object_lineage_id=p_object_lineage_id
      and v_result.drawing_object_version=p_object_version
      and v_result.object_fingerprint=p_object_fingerprint
      and v_result.measurement_kind=p_measurement_kind
      and v_result.raw_quantity=p_raw_quantity and v_result.unit=p_unit
      and v_result.measurement_rule_version=p_measurement_rule_version
      and v_result.created_by=p_actor_id then return v_result; end if;
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
exception when unique_violation then
  raise exception using errcode='P6O01',message='Quantity replay differs';
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
  if v_actor is null or not private.lukas_qto_verified_session() then
    raise exception using errcode='P6A01',message='Verified draft maker session required';
  end if;
  if p_allocation_factor is null or p_allocation_factor<=0
    or p_allocation_factor>1 or pg_catalog.scale(p_allocation_factor)>9 then
    raise exception using errcode='P6B04',message='Allocation factor is invalid';
  end if;
  select * into v_result from public.lukas_drawing_boq_links where id=p_id for update;
  if v_result.id is not null then
    select * into v_version from public.lukas_qto_boq_versions v where v.id=v_result.boq_version_id for update;
    if v_version.id is null or v_result.project_id<>v_version.project_id
      or v_result.project_id<>(select q.project_id from public.lukas_drawing_quantity_links q where q.id=v_result.quantity_link_id)
      or v_result.boq_version_id<>p_boq_version_id or v_result.quantity_link_id<>p_quantity_link_id
      or v_result.boq_line_id<>p_boq_line_id or v_version.status<>'draft'
      or v_version.created_by<>v_actor
      or coalesce(private.lukas_qto_project_role(v_version.project_id),'') not in ('owner','staff','estimator') then
      raise exception using errcode='P6O01',message='BOQ link identity or authority is stale';
    end if;
    if v_result.quantity_link_id=p_quantity_link_id and v_result.boq_version_id=p_boq_version_id and v_result.boq_line_id=p_boq_line_id
      and v_result.allocation_factor=p_allocation_factor then return v_result; end if;
    if p_base_version is null or v_result.version<>p_base_version then raise exception using errcode='P6O01',message='BOQ link is stale'; end if;
    select coalesce(sum(b.allocation_factor),0)-v_result.allocation_factor+p_allocation_factor into v_total
      from public.lukas_drawing_boq_links b where b.boq_version_id=p_boq_version_id and b.quantity_link_id=p_quantity_link_id;
    if v_total>1 then raise exception using errcode='P6B04',message='Drawing allocation exceeds one'; end if;
    update public.lukas_drawing_boq_links set allocation_factor=p_allocation_factor,version=version+1,updated_by=v_actor,updated_at=pg_catalog.now()
      where id=p_id and project_id=v_version.project_id and boq_version_id=p_boq_version_id
        and quantity_link_id=p_quantity_link_id and boq_line_id=p_boq_line_id and version=p_base_version
      returning * into v_result;
    if v_result.id is null then raise exception using errcode='P6O01',message='BOQ link changed concurrently'; end if;
    return v_result;
  end if;
  select * into v_version from public.lukas_qto_boq_versions v where v.id=p_boq_version_id for update;
  if v_version.id is null or v_version.status<>'draft' or v_version.created_by<>v_actor
    or coalesce(private.lukas_qto_project_role(v_version.project_id),'') not in ('owner','staff','estimator') then
    raise exception using errcode='P6A01',message='Draft maker role required';
  end if;
  -- A concurrent retry on this operation ID waits on the same BOQ-version row.
  select * into v_result from public.lukas_drawing_boq_links where id=p_id for update;
  if v_result.id is not null then
    if v_result.project_id=v_version.project_id
      and v_result.quantity_link_id=p_quantity_link_id
      and v_result.boq_version_id=p_boq_version_id
      and v_result.boq_line_id=p_boq_line_id
      and v_result.allocation_factor=p_allocation_factor
      and v_result.created_by=v_actor and v_result.updated_by=v_actor then
      return v_result;
    end if;
    raise exception using errcode='P6O01',message='BOQ link replay differs';
  end if;
  if not exists(select 1 from public.lukas_drawing_quantity_links q where q.id=p_quantity_link_id and q.project_id=v_version.project_id)
    or not exists(select 1 from public.lukas_qto_boq_lines l where l.id=p_boq_line_id and l.version_id=p_boq_version_id and l.project_id=v_version.project_id
      and l.unit=(select q.unit from public.lukas_drawing_quantity_links q where q.id=p_quantity_link_id)) then
    raise exception using errcode='P6U01',message='BOQ ancestry or unit differs';
  end if;
  select coalesce(sum(b.allocation_factor),0)+p_allocation_factor into v_total from public.lukas_drawing_boq_links b
    where b.boq_version_id=p_boq_version_id and b.quantity_link_id=p_quantity_link_id;
  if v_total>1 then raise exception using errcode='P6B04',message='Drawing allocation exceeds one'; end if;
  insert into public.lukas_drawing_boq_links(id,project_id,quantity_link_id,boq_version_id,boq_line_id,allocation_factor,created_by,updated_by)
    values(p_id,v_version.project_id,p_quantity_link_id,p_boq_version_id,p_boq_line_id,p_allocation_factor,v_actor,v_actor) returning * into v_result;
  return v_result;
exception when unique_violation then
  raise exception using errcode='P6O01',message='BOQ link replay differs';
end;
$$;

create function public.lukas_drawing_delete_boq_link(p_id uuid,p_base_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_link public.lukas_drawing_boq_links%rowtype; v_version public.lukas_qto_boq_versions%rowtype;
begin
  if v_actor is null or not private.lukas_qto_verified_session() then
    raise exception using errcode='P6A01',message='Verified draft maker session required';
  end if;
  select * into v_link from public.lukas_drawing_boq_links where id=p_id for update;
  if v_link.id is null then
    raise exception using errcode='P6O01',message='BOQ link is stale';
  end if;
  select * into v_version from public.lukas_qto_boq_versions where id=v_link.boq_version_id for update;
  if v_version.id is null or v_link.project_id<>v_version.project_id
    or v_version.status<>'draft' or v_version.created_by<>v_actor
    or coalesce(private.lukas_qto_project_role(v_version.project_id),'') not in ('owner','staff','estimator') then
    raise exception using errcode='P6A01',message='Draft maker role required';
  end if;
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
  if (select auth.uid()) is null or not private.lukas_qto_verified_session()
    or v.id is null or v.created_by<>(select auth.uid())
    or v.status<>'draft'
    or coalesce(private.lukas_qto_project_role(v.project_id),'') not in ('owner','staff','estimator') then
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
  if v.id is null or v.engine_version<>'VERIFIED-BOQ-1.1' or v.created_by<>p_actor_id
    or coalesce(private.lukas_drawing_p6_actor_project_role(
      p_actor_id,v.project_id),'') not in ('owner','staff','estimator') then
    raise exception using errcode='P6O01',message='BOQ finalization is stale';
  end if;
  if v.status<>'draft' then
    if v.status in ('in_review','approved','superseded')
      and v.input_state_sha256=p_input_state_sha256
      and v.result_sha256=p_result_sha256 and v.manifest_sha256=p_manifest_sha256
      and v.direct_cost_krw=p_direct_cost_krw and v.line_count=p_line_count
      and v.input_state_sha256=private.lukas_drawing_p6_input_sha256(p_version_id) then
      return pg_catalog.jsonb_build_object(
        'versionId',p_version_id,'inputStateSha256',p_input_state_sha256,
        'resultSha256',p_result_sha256,'manifestSha256',p_manifest_sha256
      );
    end if;
    raise exception using errcode='P6O01',message='BOQ finalization is stale';
  end if;
  if p_input_state_sha256 is null or p_result_sha256 is null
    or p_manifest_sha256 is null or p_direct_cost_krw is null or p_line_count is null
    or p_input_state_sha256<>private.lukas_drawing_p6_input_sha256(p_version_id)
    or p_input_state_sha256 !~ '^[0-9a-f]{64}$' or p_result_sha256 !~ '^[0-9a-f]{64}$'
    or p_manifest_sha256 !~ '^[0-9a-f]{64}$' or p_direct_cost_krw<0
    or pg_catalog.scale(p_direct_cost_krw)>6 or p_direct_cost_krw>=100000000000000000000000
    or p_line_count<0
    or p_line_count<>(select pg_catalog.count(*) from public.lukas_qto_boq_lines l
      where l.version_id=p_version_id and l.project_id=v.project_id) then
    raise exception using errcode='P6C01',message='BOQ calculation digest differs';
  end if;
  if exists(select 1 from public.lukas_drawing_boq_links b where b.boq_version_id=p_version_id group by b.quantity_link_id having sum(b.allocation_factor)<>1) then
    raise exception using errcode='P6B04',message='Drawing allocations are incomplete';
  end if;
  perform pg_catalog.set_config('private.lukas_drawing_p6_finalize',v.id::text,true);
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
declare v_existing public.lukas_drawing_material_links%rowtype;
declare v_existing_id public.lukas_drawing_material_links%rowtype;
declare v_existing_plan public.lukas_qto_material_plans%rowtype;
begin
  if pg_catalog.current_setting('role',true)<>'service_role' or p_actor_id is null then
    raise exception using errcode='P6A01',message='Trusted material authority required';
  end if;
  if pg_catalog.jsonb_typeof(p_material_plan_rows)<>'array' or pg_catalog.jsonb_typeof(p_material_link_rows)<>'array'
    or pg_catalog.jsonb_array_length(p_material_plan_rows) not between 1 and 2000
    or pg_catalog.jsonb_array_length(p_material_link_rows) not between 1 and 10000 then
    raise exception using errcode='P6M01',message='Material handoff payload exceeds bounds';
  end if;
  select * into v from public.lukas_qto_boq_versions where id=p_boq_version_id for update;
  if v.id is null or p_result_sha256 is null or p_manifest_file_id is null
    or p_manifest_file_sha256 is null or v.engine_version<>'VERIFIED-BOQ-1.1'
    or v.status not in ('approved','superseded') or v.result_sha256<>p_result_sha256
    or v.manifest_sha256<>p_manifest_file_sha256
    or p_result_sha256 !~ '^[0-9a-f]{64}$'
    or p_manifest_file_sha256 !~ '^[0-9a-f]{64}$'
    or not exists(select 1 from public.lukas_qto_boq_approvals a
      where a.version_id=v.id and a.decision='approved' and a.decided_by<>v.created_by)
    or not exists(select 1 from public.lukas_qto_files f
      where f.id=p_manifest_file_id and f.project_id=v.project_id
        and f.sha256=p_manifest_file_sha256 and f.kind='other' and f.immutable
        and pg_catalog.right(f.storage_path,pg_catalog.char_length(
          '/boq-manifests/'||p_manifest_file_sha256||'.manifest.json'
        ))='/boq-manifests/'||p_manifest_file_sha256||'.manifest.json') then
    raise exception using errcode='P6M01',message='Approved BOQ manifest is required';
  end if;
  if coalesce(private.lukas_drawing_p6_actor_project_role(
      p_actor_id,v.project_id),'') not in ('owner','staff','estimator') then
    raise exception using errcode='P6A01',message='Material maker role required';
  end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_material_plan_rows) p
      group by p->>'id' having pg_catalog.count(*)<>1)
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_material_plan_rows) p
      group by p->>'materialCode',p->>'specification',p->>'unit'
      having pg_catalog.count(*)<>1) then
    raise exception using errcode='P6M01',message='Material plan identity is duplicated';
  end if;
  for v_plan in select value from pg_catalog.jsonb_array_elements(p_material_plan_rows) loop
    if pg_catalog.jsonb_typeof(v_plan)<>'object'
      or not (v_plan ?& array['id','materialResourceId','materialCode','materialName','specification','unit','designQuantity','allowanceRate','requiredQuantity','ruleId'])
      or v_plan-array['id','materialResourceId','materialCode','materialName','specification','unit','designQuantity','allowanceRate','requiredQuantity','ruleId']<>'{}'::jsonb
      or private.lukas_drawing_p6_uuid_text(v_plan->'id') is not true
      or private.lukas_drawing_p6_uuid_text(v_plan->'materialResourceId') is not true
      or pg_catalog.jsonb_typeof(v_plan->'materialCode')<>'string'
      or pg_catalog.jsonb_typeof(v_plan->'materialName')<>'string'
      or pg_catalog.jsonb_typeof(v_plan->'specification')<>'string'
      or pg_catalog.jsonb_typeof(v_plan->'unit')<>'string'
      or pg_catalog.jsonb_typeof(v_plan->'ruleId')<>'string'
      or private.lukas_drawing_p6_decimal_text(v_plan->'designQuantity',18,6) is not true
      or private.lukas_drawing_p6_decimal_text(v_plan->'allowanceRate',1,6) is not true
      or private.lukas_drawing_p6_decimal_text(v_plan->'requiredQuantity',18,6) is not true then
      raise exception using errcode='P6M01',message='Material plan keys are invalid';
    end if;
    if v_plan->>'ruleId'<>'P6_MATERIAL_HANDOFF_V1' or v_plan->>'allowanceRate'<>'0'
      or (v_plan->>'requiredQuantity')::numeric<>(v_plan->>'designQuantity')::numeric
      or not exists(select 1 from public.lukas_qto_price_resources r
        where r.id=(v_plan->>'materialResourceId')::uuid and r.project_id=v.project_id
          and r.price_book_id=v.price_book_id and r.resource_type='material'
          and r.resource_code=v_plan->>'materialCode'
          and r.resource_name=v_plan->>'materialName'
          and r.specification=v_plan->>'specification' and r.unit=v_plan->>'unit') then
      raise exception using errcode='P6M01',message='Material plan differs from resource';
    end if;
    select * into v_existing_plan from public.lukas_qto_material_plans p
      where p.id=(v_plan->>'id')::uuid for update;
    if v_existing_plan.id is not null then
      if v_existing_plan.project_id<>v.project_id
        or v_existing_plan.material_code<>v_plan->>'materialCode'
        or v_existing_plan.material_name<>v_plan->>'materialName'
        or v_existing_plan.specification<>v_plan->>'specification'
        or v_existing_plan.unit<>v_plan->>'unit'
        or v_existing_plan.design_quantity<>(v_plan->>'designQuantity')::numeric
        or v_existing_plan.allowance_rate<>0
        or v_existing_plan.required_quantity<>(v_plan->>'requiredQuantity')::numeric
        or v_existing_plan.rule_id<>'P6_MATERIAL_HANDOFF_V1'
        or v_existing_plan.required_by is not null
        or v_existing_plan.source_file_id<>p_manifest_file_id
        or v_existing_plan.source_sha256<>p_manifest_file_sha256
        or v_existing_plan.baseline_factor_id is not null
        or v_existing_plan.source_artifact_id is not null
        or v_existing_plan.source_group_key is not null
        or v_existing_plan.created_by<>p_actor_id then
        raise exception using errcode='P6O01',message='Material plan replay differs';
      end if;
    else
      insert into public.lukas_qto_material_plans(
        id,project_id,material_code,material_name,specification,unit,
        design_quantity,allowance_rate,required_quantity,rule_id,
        source_file_id,source_sha256,created_by
      ) values(
        (v_plan->>'id')::uuid,v.project_id,v_plan->>'materialCode',
        v_plan->>'materialName',v_plan->>'specification',v_plan->>'unit',
        (v_plan->>'designQuantity')::numeric,0,
        (v_plan->>'requiredQuantity')::numeric,'P6_MATERIAL_HANDOFF_V1',
        p_manifest_file_id,p_manifest_file_sha256,p_actor_id
      );
    end if;
  end loop;
  for v_link in select value from pg_catalog.jsonb_array_elements(p_material_link_rows) loop
    if pg_catalog.jsonb_typeof(v_link)<>'object'
      or not (v_link ?& array['id','boqLineId','boqRateComponentId','materialResourceId','materialPlanId','derivedDesignQuantity'])
      or v_link-array['id','boqLineId','boqRateComponentId','materialResourceId','materialPlanId','derivedDesignQuantity']<>'{}'::jsonb
      or private.lukas_drawing_p6_uuid_text(v_link->'id') is not true
      or private.lukas_drawing_p6_uuid_text(v_link->'boqLineId') is not true
      or private.lukas_drawing_p6_uuid_text(v_link->'boqRateComponentId') is not true
      or private.lukas_drawing_p6_uuid_text(v_link->'materialResourceId') is not true
      or private.lukas_drawing_p6_uuid_text(v_link->'materialPlanId') is not true
      or private.lukas_drawing_p6_decimal_text(v_link->'derivedDesignQuantity',18,6) is not true then
      raise exception using errcode='P6M01',message='Material link keys are invalid';
    end if;
    if not exists(select 1 from pg_catalog.jsonb_array_elements(p_material_plan_rows) p
        where p->>'id'=v_link->>'materialPlanId')
      or not exists(select 1
        from public.lukas_qto_boq_rate_components c
        join public.lukas_qto_price_resources r
          on r.id=c.resource_id and r.project_id=c.project_id
        join public.lukas_qto_boq_lines l
          on l.id=c.line_id and l.version_id=c.version_id and l.project_id=c.project_id
        join public.lukas_qto_material_plans p
          on p.id=(v_link->>'materialPlanId')::uuid and p.project_id=c.project_id
        where c.id=(v_link->>'boqRateComponentId')::uuid
          and c.version_id=v.id and c.project_id=v.project_id
          and l.id=(v_link->>'boqLineId')::uuid
          and r.id=(v_link->>'materialResourceId')::uuid
          and r.price_book_id=v.price_book_id and r.resource_type='material'
          and p.material_code=r.resource_code and p.material_name=r.resource_name
          and p.specification=r.specification and p.unit=r.unit
          and p.source_file_id=p_manifest_file_id
          and p.source_sha256=p_manifest_file_sha256) then
      raise exception using errcode='P6M01',message='Material component or plan differs';
    end if;
    select * into v_existing_id from public.lukas_drawing_material_links x
      where x.id=(v_link->>'id')::uuid for update;
    select * into v_existing from public.lukas_drawing_material_links x
      where x.boq_version_id=v.id and x.boq_rate_component_id=(v_link->>'boqRateComponentId')::uuid for update;
    if v_existing_id.id is not null or v_existing.id is not null then
      if v_existing_id.id is null or v_existing.id is null
        or v_existing_id.id<>v_existing.id
        or v_existing.id<>(v_link->>'id')::uuid
        or v_existing.project_id<>v.project_id or v_existing.boq_version_id<>v.id
        or v_existing.boq_line_id<>(v_link->>'boqLineId')::uuid
        or v_existing.boq_rate_component_id<>(v_link->>'boqRateComponentId')::uuid
        or v_existing.material_resource_id<>(v_link->>'materialResourceId')::uuid
        or v_existing.boq_result_sha256<>p_result_sha256
        or v_existing.material_plan_id<>(v_link->>'materialPlanId')::uuid
        or v_existing.derived_design_quantity<>(v_link->>'derivedDesignQuantity')::numeric
        or v_existing.material_rule_version<>'P6_MATERIAL_HANDOFF_V1'
        or v_existing.created_by<>p_actor_id then
        raise exception using errcode='P6O01',message='Material replay differs';
      end if;
    else
      insert into public.lukas_drawing_material_links(id,project_id,boq_version_id,boq_line_id,boq_rate_component_id,material_resource_id,boq_result_sha256,material_plan_id,derived_design_quantity,material_rule_version,created_by)
        values((v_link->>'id')::uuid,v.project_id,v.id,(v_link->>'boqLineId')::uuid,(v_link->>'boqRateComponentId')::uuid,(v_link->>'materialResourceId')::uuid,p_result_sha256,(v_link->>'materialPlanId')::uuid,(v_link->>'derivedDesignQuantity')::numeric,'P6_MATERIAL_HANDOFF_V1',p_actor_id);
    end if;
    v_count:=v_count+1;
  end loop;
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_material_link_rows) x
      group by x->>'id' having pg_catalog.count(*)<>1)
    or exists(select 1 from pg_catalog.jsonb_array_elements(p_material_link_rows) x
      group by x->>'boqRateComponentId' having pg_catalog.count(*)<>1) then
    raise exception using errcode='P6M01',message='Material link identity is duplicated';
  end if;
  for v_plan in select value from pg_catalog.jsonb_array_elements(p_material_plan_rows) loop
    if not exists(select 1 from pg_catalog.jsonb_array_elements(p_material_link_rows) x
        where x->>'materialPlanId'=v_plan->>'id')
      or (v_plan->>'designQuantity')::numeric<>(select coalesce(
        pg_catalog.sum((x->>'derivedDesignQuantity')::numeric),0)
        from pg_catalog.jsonb_array_elements(p_material_link_rows) x
        where x->>'materialPlanId'=v_plan->>'id')
      or (v_plan->>'designQuantity')::numeric<>(select coalesce(
        pg_catalog.sum(x.derived_design_quantity),0)
        from public.lukas_drawing_material_links x
        where x.project_id=v.project_id
          and x.material_plan_id=(v_plan->>'id')::uuid) then
      raise exception using errcode='P6M01',message='Material plan total differs';
    end if;
  end loop;
  return pg_catalog.jsonb_build_object('insertedOrReplayed',v_count);
exception
  when sqlstate 'P6A01' or sqlstate 'P6M01' or sqlstate 'P6O01' then raise;
  when unique_violation then
    raise exception using errcode='P6O01',message='Material replay differs';
  when others then
    raise exception using errcode='P6M01',message='Material handoff payload is invalid';
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
    if old.created_by is distinct from (select auth.uid())
      and not (pg_catalog.current_setting('role',true)='service_role'
        and pg_catalog.current_setting('private.lukas_drawing_p6_finalize',true)=old.id::text)
    then raise exception 'Only the BOQ maker can submit a draft version'; end if;
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
  if (select auth.uid()) is null or v.id is null or not private.lukas_qto_verified_session()
    or v.status<>'in_review' or v.created_by=(select auth.uid())
    or coalesce(private.lukas_qto_project_role(v.project_id),'') not in ('owner','staff','reviewer') then
    raise exception using errcode='P6A01',message='Independent verified reviewer required';
  end if;
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

revoke all on function private.lukas_drawing_reject_p6_immutable() from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_reject_p6_material_immutable() from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_guard_p6_boq_link() from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_input_state(uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_input_sha256(uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_actor_project_role(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_canonical_json(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_scaled_integer(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_integer_sqrt(numeric) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_round_positive(numeric,numeric) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_uuid_text(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_decimal_text(jsonb,integer,integer) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_p6_measure(jsonb,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_insert_quantity_link(uuid,uuid,uuid,uuid,text,text,uuid,bigint,text,numeric,text,text) from public,anon,authenticated,service_role;
revoke all on function private.lukas_qto_finalize_boq_v1_1(uuid,uuid,text,text,text,numeric,integer) from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_insert_material_handoff(uuid,uuid,text,uuid,text,jsonb,jsonb) from public,anon,authenticated,service_role;
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
