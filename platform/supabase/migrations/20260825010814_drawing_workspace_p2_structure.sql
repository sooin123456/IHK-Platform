begin;

-- P2 remains additive. Existing P0/P1 pages are promoted to one authoritative
-- paper canvas without rewriting operation or snapshot evidence.
alter table public.lukas_drawing_pages
  add column sort_order integer;
alter table public.lukas_drawing_pages
  add column version bigint;
alter table public.lukas_drawing_pages disable trigger user;
update public.lukas_drawing_pages
set sort_order = page_number - 1, version = 1;
alter table public.lukas_drawing_pages enable trigger user;
alter table public.lukas_drawing_pages
  alter column sort_order set not null,
  alter column version set not null,
  alter column version set default 1;
alter table public.lukas_drawing_pages
  add constraint lukas_drawing_pages_sort_order_nonnegative check (sort_order >= 0),
  add constraint lukas_drawing_pages_version_positive check (version > 0);

create table public.lukas_drawing_canvases (
  id uuid primary key,
  page_id uuid not null,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  name text not null check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 255
  ),
  space_kind text not null check (space_kind in ('paper', 'model')),
  width_mm numeric(18,6) not null check (width_mm > 0),
  height_mm numeric(18,6) not null check (height_mm > 0),
  background_source_file_id uuid,
  background_source_sha256 text check (
    background_source_sha256 is null or background_source_sha256 ~ '^[0-9a-f]{64}$'
  ),
  background_pdf_page integer check (
    background_pdf_page is null or background_pdf_page > 0
  ),
  calibration jsonb check (
    calibration is null or (
      pg_catalog.jsonb_typeof(calibration) = 'object'
      and pg_catalog.octet_length(calibration::text) <= 65536
    )
  ),
  sort_order integer not null check (sort_order >= 0),
  version bigint not null check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (id, revision_id, project_id),
  unique (id, page_id, revision_id, project_id),
  unique (page_id, name),
  constraint lukas_drawing_canvases_page_fkey
    foreign key (page_id, revision_id, project_id)
    references public.lukas_drawing_pages(id, revision_id, project_id) on delete cascade,
  constraint lukas_drawing_canvases_background_source_fkey
    foreign key (background_source_file_id, project_id, background_source_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  check (
    (background_source_file_id is null and background_source_sha256 is null
      and background_pdf_page is null and calibration is null)
    or (space_kind = 'paper' and background_source_file_id is not null
      and background_source_sha256 is not null)
  )
);

create unique index lukas_drawing_canvases_default_paper_idx
  on public.lukas_drawing_canvases(page_id)
  where space_kind = 'paper' and sort_order = 0;

create table public.lukas_drawing_styles (
  id uuid primary key,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  name text not null check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 255
  ),
  value jsonb not null check (
    pg_catalog.jsonb_typeof(value) = 'object'
    and pg_catalog.octet_length(value::text) <= 65536
  ),
  version bigint not null check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (id, revision_id, project_id),
  unique (revision_id, name),
  constraint lukas_drawing_styles_revision_fkey
    foreign key (revision_id, project_id)
    references public.lukas_drawing_revisions(id, project_id) on delete cascade
);

create table public.lukas_drawing_blocks (
  id uuid primary key,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  name text not null check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 255
  ),
  primitives jsonb not null check (
    pg_catalog.jsonb_typeof(primitives) = 'array'
    and pg_catalog.jsonb_array_length(primitives) > 0
    and pg_catalog.octet_length(primitives::text) <= 1048576
  ),
  version bigint not null check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (id, revision_id, project_id),
  unique (revision_id, name),
  constraint lukas_drawing_blocks_revision_fkey
    foreign key (revision_id, project_id)
    references public.lukas_drawing_revisions(id, project_id) on delete cascade
);

create table public.lukas_drawing_block_instances (
  id uuid primary key,
  block_id uuid not null,
  layer_id uuid not null,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  name text not null check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 255
  ),
  origin jsonb not null check (
    pg_catalog.jsonb_typeof(origin) = 'object'
    and pg_catalog.octet_length(origin::text) <= 4096
  ),
  rotation numeric not null,
  scale_x numeric not null check (scale_x <> 0),
  scale_y numeric not null check (scale_y <> 0),
  version bigint not null check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (id, revision_id, project_id),
  constraint lukas_drawing_block_instances_block_fkey
    foreign key (block_id, revision_id, project_id)
    references public.lukas_drawing_blocks(id, revision_id, project_id) on delete restrict,
  constraint lukas_drawing_block_instances_layer_fkey
    foreign key (layer_id, revision_id, project_id)
    references public.lukas_drawing_layers(id, revision_id, project_id) on delete restrict
);

create table public.lukas_drawing_property_schemas (
  id uuid primary key,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  name text not null check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 255
  ),
  value_type text not null check (value_type in ('text','number','boolean','date','enum')),
  enum_options jsonb not null check (
    pg_catalog.jsonb_typeof(enum_options) = 'array'
    and pg_catalog.jsonb_array_length(enum_options) <= 255
    and pg_catalog.octet_length(enum_options::text) <= 65536
  ),
  applies_to jsonb not null check (
    pg_catalog.jsonb_typeof(applies_to) = 'array'
    and pg_catalog.jsonb_array_length(applies_to) > 0
    and pg_catalog.octet_length(applies_to::text) <= 65536
  ),
  required boolean not null,
  version bigint not null check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (id, revision_id, project_id),
  unique (revision_id, name),
  constraint lukas_drawing_property_schemas_revision_fkey
    foreign key (revision_id, project_id)
    references public.lukas_drawing_revisions(id, project_id) on delete cascade
);

create table public.lukas_drawing_property_values (
  id uuid primary key,
  schema_id uuid not null,
  object_id uuid,
  block_instance_id uuid,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  value jsonb,
  version bigint not null check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (id, revision_id, project_id),
  constraint lukas_drawing_property_values_schema_fkey
    foreign key (schema_id, revision_id, project_id)
    references public.lukas_drawing_property_schemas(id, revision_id, project_id) on delete restrict,
  constraint lukas_drawing_property_values_object_fkey
    foreign key (object_id, revision_id, project_id)
    references public.lukas_drawing_objects(id, revision_id, project_id) on delete cascade,
  constraint lukas_drawing_property_values_instance_fkey
    foreign key (block_instance_id, revision_id, project_id)
    references public.lukas_drawing_block_instances(id, revision_id, project_id) on delete cascade,
  check ((object_id is null) <> (block_instance_id is null)),
  unique nulls not distinct (schema_id, object_id, block_instance_id)
);

create table public.lukas_drawing_tables (
  id uuid primary key,
  revision_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  name text not null check (
    name = pg_catalog.btrim(name) and pg_catalog.char_length(name) between 1 and 255
  ),
  columns_json jsonb not null check (
    pg_catalog.jsonb_typeof(columns_json) = 'array'
    and pg_catalog.jsonb_array_length(columns_json) > 0
    and pg_catalog.octet_length(columns_json::text) <= 1048576
  ),
  rows_json jsonb not null check (
    pg_catalog.jsonb_typeof(rows_json) = 'array'
    and pg_catalog.octet_length(rows_json::text) <= 4194304
  ),
  version bigint not null check (version > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (id, revision_id, project_id),
  unique (revision_id, name),
  constraint lukas_drawing_tables_revision_fkey
    foreign key (revision_id, project_id)
    references public.lukas_drawing_revisions(id, project_id) on delete cascade
);

alter table public.lukas_drawing_objects
  add column style_id uuid;
alter table public.lukas_drawing_objects
  add constraint lukas_drawing_objects_style_fkey
  foreign key (style_id, revision_id, project_id)
  references public.lukas_drawing_styles(id, revision_id, project_id) on delete restrict;

alter table public.lukas_drawing_layers
  add column canvas_id uuid;

do $$
begin
  if exists (
    select 1 from public.lukas_drawing_layers l
    left join public.lukas_drawing_pages p
      on p.id=l.page_id and p.revision_id=l.revision_id and p.project_id=l.project_id
    where p.id is null
  ) then
    raise exception using errcode='P1C01',
      message='Drawing layer ancestry must be repaired before P2 canvas backfill';
  end if;
end;
$$;

insert into public.lukas_drawing_canvases(
  id,page_id,revision_id,project_id,name,space_kind,width_mm,height_mm,
  background_source_file_id,background_source_sha256,background_pdf_page,
  calibration,sort_order,version,created_by,created_at,updated_at
)
select extensions.gen_random_uuid(),p.id,p.revision_id,p.project_id,
  case when pg_catalog.char_length(p.name || ' Paper') <= 255
    then p.name || ' Paper' else pg_catalog.left(p.name,249) || ' Paper' end,
  'paper',p.width_mm,p.height_mm,p.background_source_file_id,
  p.background_source_sha256,p.background_pdf_page,p.calibration,0,1,
  r.created_by,p.created_at,p.updated_at
from public.lukas_drawing_pages p
join public.lukas_drawing_revisions r
  on r.id=p.revision_id and r.project_id=p.project_id;

alter table public.lukas_drawing_layers disable trigger user;
update public.lukas_drawing_layers l
set canvas_id=c.id
from public.lukas_drawing_canvases c
where c.page_id=l.page_id and c.revision_id=l.revision_id
  and c.project_id=l.project_id and c.space_kind='paper' and c.sort_order=0;
alter table public.lukas_drawing_layers enable trigger user;

do $$
begin
  if exists (select 1 from public.lukas_drawing_layers where canvas_id is null) then
    raise exception using errcode='P1C01',
      message='Every drawing layer must bind to a canvas before P2 deployment';
  end if;
end;
$$;

alter table public.lukas_drawing_layers
  alter column canvas_id set not null;
alter table public.lukas_drawing_layers
  add constraint lukas_drawing_layers_canvas_fkey
  foreign key (canvas_id,page_id,revision_id,project_id)
  references public.lukas_drawing_canvases(id,page_id,revision_id,project_id) on delete cascade;

alter table public.lukas_drawing_snapshots
  add column schema_version smallint not null default 1
  check (schema_version in (1,2));

alter table public.lukas_drawing_operations
  drop constraint if exists lukas_drawing_operations_operation_type_check;
alter table public.lukas_drawing_operations
  add constraint lukas_drawing_operations_operation_type_check check (operation_type in (
    'add_objects','update_objects','delete_objects','add_layer','update_layer','mutate_structure'
  ));

create index lukas_drawing_canvases_project_idx
  on public.lukas_drawing_canvases(project_id,revision_id,page_id,sort_order,id);
create index lukas_drawing_canvases_page_idx
  on public.lukas_drawing_canvases(page_id,revision_id,project_id,sort_order,id);
create index lukas_drawing_canvases_source_idx
  on public.lukas_drawing_canvases(background_source_file_id,project_id,background_source_sha256)
  where background_source_file_id is not null;
create index lukas_drawing_canvases_created_by_idx
  on public.lukas_drawing_canvases(created_by);
create index lukas_drawing_styles_project_idx
  on public.lukas_drawing_styles(project_id,revision_id,id) include (name,value,version);
create index lukas_drawing_styles_created_by_idx on public.lukas_drawing_styles(created_by);
create index lukas_drawing_blocks_project_idx
  on public.lukas_drawing_blocks(project_id,revision_id,id) include (name,primitives,version);
create index lukas_drawing_blocks_created_by_idx on public.lukas_drawing_blocks(created_by);
create index lukas_drawing_block_instances_project_idx
  on public.lukas_drawing_block_instances(project_id,revision_id,layer_id,id)
  include (block_id,name,origin,rotation,scale_x,scale_y,version);
create index lukas_drawing_block_instances_block_idx
  on public.lukas_drawing_block_instances(block_id,revision_id,project_id);
create index lukas_drawing_block_instances_created_by_idx
  on public.lukas_drawing_block_instances(created_by);
create index lukas_drawing_property_schemas_project_idx
  on public.lukas_drawing_property_schemas(project_id,revision_id,id)
  include (name,value_type,enum_options,applies_to,required,version);
create index lukas_drawing_property_schemas_created_by_idx
  on public.lukas_drawing_property_schemas(created_by);
create index lukas_drawing_property_values_project_idx
  on public.lukas_drawing_property_values(project_id,revision_id,schema_id,id)
  include (object_id,block_instance_id,value,version);
create index lukas_drawing_property_values_object_idx
  on public.lukas_drawing_property_values(object_id,revision_id,project_id)
  where object_id is not null;
create index lukas_drawing_property_values_instance_idx
  on public.lukas_drawing_property_values(block_instance_id,revision_id,project_id)
  where block_instance_id is not null;
create index lukas_drawing_property_values_created_by_idx
  on public.lukas_drawing_property_values(created_by);
create index lukas_drawing_tables_project_idx
  on public.lukas_drawing_tables(project_id,revision_id,id)
  include (name,version);
create index lukas_drawing_tables_created_by_idx on public.lukas_drawing_tables(created_by);
create index lukas_drawing_layers_canvas_idx
  on public.lukas_drawing_layers(canvas_id,revision_id,project_id,sort_order,id)
  include (name,visible,locked,system_kind,version);
create index lukas_drawing_objects_style_idx
  on public.lukas_drawing_objects(style_id,revision_id,project_id)
  where style_id is not null;

drop index if exists public.lukas_drawing_layers_one_source_idx;
drop index if exists public.lukas_drawing_layers_one_work_idx;
create unique index lukas_drawing_layers_one_source_per_canvas_idx
  on public.lukas_drawing_layers(canvas_id,system_kind) where system_kind='source';
create unique index lukas_drawing_layers_one_work_per_canvas_idx
  on public.lukas_drawing_layers(canvas_id,system_kind) where system_kind='work';

create or replace function private.lukas_drawing_style_override_valid(p_style jsonb)
returns boolean
language sql immutable security invoker
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_style)='object'
    and p_style - array['stroke','strokeWidth','fill','fontSize']='{}'::jsonb
    and (not (p_style ? 'stroke') or (
      pg_catalog.jsonb_typeof(p_style->'stroke')='string'
      and p_style->>'stroke' ~ '^#[0-9A-Fa-f]{6}$'))
    and (not (p_style ? 'strokeWidth') or (
      pg_catalog.jsonb_typeof(p_style->'strokeWidth')='number'
      and (p_style->>'strokeWidth')::numeric > 0
      and (p_style->>'strokeWidth')::numeric <= 1000))
    and (not (p_style ? 'fill') or (
      pg_catalog.jsonb_typeof(p_style->'fill')='null'
      or (pg_catalog.jsonb_typeof(p_style->'fill')='string'
        and p_style->>'fill' ~ '^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$')))
    and (not (p_style ? 'fontSize') or (
      pg_catalog.jsonb_typeof(p_style->'fontSize')='number'
      and (p_style->>'fontSize')::numeric > 0
      and (p_style->>'fontSize')::numeric <= 10000)), false)
$$;

create or replace function private.lukas_drawing_p2_uuid(p_value jsonb)
returns boolean
language sql immutable security invoker
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value)='string' and p_value #>> '{}' ~
    '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',false)
$$;

create or replace function private.lukas_drawing_p2_positive_integer(p_value jsonb)
returns boolean
language sql immutable security invoker
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value)='number'
    and (p_value #>> '{}')::numeric > 0
    and (p_value #>> '{}')::numeric=pg_catalog.trunc((p_value #>> '{}')::numeric),false)
$$;

create or replace function private.lukas_drawing_p2_name(p_value jsonb)
returns boolean
language sql immutable security invoker
set search_path = ''
as $$
  select coalesce(pg_catalog.jsonb_typeof(p_value)='string'
    and p_value #>> '{}' = pg_catalog.btrim(p_value #>> '{}')
    and pg_catalog.char_length(p_value #>> '{}') between 1 and 255,false)
$$;

create or replace function private.lukas_drawing_p2_calibration_valid(p_value jsonb)
returns boolean
language sql immutable security invoker
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value)='object'
    and p_value ?& array['normalizedStart','normalizedEnd','realLengthMillimeters',
      'millimetersPerNormalizedUnit']
    and p_value-array['normalizedStart','normalizedEnd','realLengthMillimeters',
      'millimetersPerNormalizedUnit']='{}'::jsonb
    and private.lukas_drawing_point_valid(p_value->'normalizedStart') is true
    and private.lukas_drawing_point_valid(p_value->'normalizedEnd') is true
    and pg_catalog.jsonb_typeof(p_value->'realLengthMillimeters')='number'
    and (p_value->>'realLengthMillimeters')::numeric>0
    and pg_catalog.jsonb_typeof(p_value->'millimetersPerNormalizedUnit')='number'
    and (p_value->>'millimetersPerNormalizedUnit')::numeric>0,false)
$$;

create or replace function private.lukas_drawing_p2_property_value_valid(
  p_value jsonb,
  p_value_type text,
  p_enum_options jsonb
) returns boolean
language sql immutable security invoker
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_value)='null' then true
    when p_value_type='text' then pg_catalog.jsonb_typeof(p_value)='string'
    when p_value_type='number' then pg_catalog.jsonb_typeof(p_value)='number'
    when p_value_type='boolean' then pg_catalog.jsonb_typeof(p_value)='boolean'
    when p_value_type='date' then pg_catalog.jsonb_typeof(p_value)='string'
      and p_value #>> '{}' ~ '^\d{4}-\d{2}-\d{2}$'
      and pg_catalog.to_char(pg_catalog.to_date(p_value #>> '{}','YYYY-MM-DD'),'YYYY-MM-DD')=p_value #>> '{}'
    when p_value_type='enum' then pg_catalog.jsonb_typeof(p_value)='string'
      and p_enum_options @> pg_catalog.jsonb_build_array(p_value #>> '{}')
    else false end
$$;

create or replace function private.lukas_drawing_p2_block_primitives_valid(
  p_primitives jsonb,
  p_revision_id uuid,
  p_project_id uuid
) returns boolean
language plpgsql stable security invoker
set search_path = ''
as $$
declare v_item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_primitives)<>'array'
    or pg_catalog.jsonb_array_length(p_primitives)=0
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_primitives) item
      group by item->>'localId' having pg_catalog.count(*)>1
    ) then return false; end if;
  for v_item in select value from pg_catalog.jsonb_array_elements(p_primitives) loop
    if pg_catalog.jsonb_typeof(v_item)<>'object'
      or not (v_item ?& array['localId','name','geometry','styleId','style'])
      or v_item-array['localId','name','geometry','styleId','style']<>'{}'::jsonb
      or pg_catalog.jsonb_typeof(v_item->'localId')<>'string'
      or pg_catalog.char_length(v_item->>'localId') not between 1 and 255
      or private.lukas_drawing_p2_name(v_item->'name') is not true
      or private.lukas_drawing_geometry_valid(v_item->'geometry'->>'type',v_item->'geometry') is not true
      or not (
        (pg_catalog.jsonb_typeof(v_item->'styleId')='null'
          and private.lukas_drawing_style_valid(v_item->'style') is true)
        or (private.lukas_drawing_p2_uuid(v_item->'styleId') is true
          and private.lukas_drawing_style_override_valid(v_item->'style') is true
          and exists (select 1 from public.lukas_drawing_styles s
            where s.id=(v_item->>'styleId')::uuid
              and s.revision_id=p_revision_id and s.project_id=p_project_id))
      ) then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function private.lukas_drawing_p2_property_schema_json_valid(
  p_value_type text,
  p_enum_options jsonb,
  p_applies_to jsonb
) returns boolean
language sql immutable security invoker
set search_path = ''
as $$
  select coalesce(
    p_value_type in ('text','number','boolean','date','enum')
    and pg_catalog.jsonb_typeof(p_enum_options)='array'
    and not exists (select 1 from pg_catalog.jsonb_array_elements(p_enum_options) v
      where private.lukas_drawing_p2_name(v) is not true)
    and ((p_value_type='enum' and pg_catalog.jsonb_array_length(p_enum_options)>0)
      or (p_value_type<>'enum' and p_enum_options='[]'::jsonb))
    and pg_catalog.jsonb_typeof(p_applies_to)='array'
    and pg_catalog.jsonb_array_length(p_applies_to)>0
    and not exists (select 1 from pg_catalog.jsonb_array_elements_text(p_applies_to) v
      where v not in ('line','polyline','rectangle','circle','text','dimension','block_instance'))
    and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements_text(p_applies_to))
      =(select pg_catalog.count(distinct v) from pg_catalog.jsonb_array_elements_text(p_applies_to) v),false)
$$;

create or replace function private.lukas_drawing_structure_tombstone(
  p_revision_id uuid,p_id uuid,p_put_kind text
) returns jsonb
language sql stable security invoker set search_path='' as $$
  with latest as (
    select o.inverse,o.result_versions
    from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.result_versions ? p_id::text
    order by o.sequence desc limit 1
  )
  select a->'entity' from latest,
    lateral pg_catalog.jsonb_array_elements(latest.inverse->'actions') a
  where latest.result_versions->p_id::text='null'::jsonb
    and a->>'kind'=p_put_kind and a->'entity'->>'id'=p_id::text
  limit 1
$$;

create or replace function private.lukas_drawing_p2_number_close(
  p_left double precision,p_right double precision
) returns boolean
language sql immutable security invoker set search_path='' as $$
  select coalesce(pg_catalog.abs(p_left-p_right)
    <= 1e-12 + 1.4210854715202004e-14
      * greatest(pg_catalog.abs(p_left),pg_catalog.abs(p_right)),false)
$$;

create or replace function private.lukas_drawing_p2_world_point_matches(
  p_local jsonb,p_world jsonb,p_origin jsonb,p_rotation double precision,
  p_scale_x double precision,p_scale_y double precision
) returns boolean
language sql immutable security invoker set search_path='' as $$
  select private.lukas_drawing_p2_number_close(
      ((p_local->>'x')::double precision*p_scale_x
        * pg_catalog.cos(p_rotation*pg_catalog.pi()/180.0))
      - ((p_local->>'y')::double precision*p_scale_y
        * pg_catalog.sin(p_rotation*pg_catalog.pi()/180.0))
      + (p_origin->>'x')::double precision,
      (p_world->>'x')::double precision)
    and private.lukas_drawing_p2_number_close(
      ((p_local->>'x')::double precision*p_scale_x
        * pg_catalog.sin(p_rotation*pg_catalog.pi()/180.0))
      + ((p_local->>'y')::double precision*p_scale_y
        * pg_catalog.cos(p_rotation*pg_catalog.pi()/180.0))
      + (p_origin->>'y')::double precision,
      (p_world->>'y')::double precision)
$$;

create or replace function private.lukas_drawing_p2_world_geometry_matches(
  p_local jsonb,p_world jsonb,p_origin jsonb,p_rotation double precision,
  p_scale_x double precision,p_scale_y double precision
) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare v_type text:=p_local->>'type'; v_point record;
begin
  if v_type is distinct from p_world->>'type' then return false; end if;
  if v_type='line' then
    return private.lukas_drawing_p2_world_point_matches(p_local->'start',p_world->'start',
        p_origin,p_rotation,p_scale_x,p_scale_y)
      and private.lukas_drawing_p2_world_point_matches(p_local->'end',p_world->'end',
        p_origin,p_rotation,p_scale_x,p_scale_y);
  elsif v_type='polyline' then
    if p_local->'closed' is distinct from p_world->'closed'
      or pg_catalog.jsonb_array_length(p_local->'points')
        <>pg_catalog.jsonb_array_length(p_world->'points') then return false; end if;
    for v_point in select value,ordinality from
      pg_catalog.jsonb_array_elements(p_local->'points') with ordinality loop
      if private.lukas_drawing_p2_world_point_matches(v_point.value,
        p_world->'points'->(v_point.ordinality-1),p_origin,p_rotation,p_scale_x,p_scale_y)
        is not true then return false; end if;
    end loop;
    return true;
  elsif v_type='rectangle' then
    return private.lukas_drawing_p2_world_point_matches(p_local->'origin',p_world->'origin',
        p_origin,p_rotation,p_scale_x,p_scale_y)
      and private.lukas_drawing_p2_number_close(
        (p_local->>'width')::double precision*pg_catalog.abs(p_scale_x),
        (p_world->>'width')::double precision)
      and private.lukas_drawing_p2_number_close(
        (p_local->>'height')::double precision*pg_catalog.abs(p_scale_y),
        (p_world->>'height')::double precision)
      and private.lukas_drawing_p2_number_close(
        (p_local->>'rotation')::double precision+p_rotation,
        (p_world->>'rotation')::double precision);
  elsif v_type='circle' then
    return pg_catalog.abs(p_scale_x)=pg_catalog.abs(p_scale_y)
      and private.lukas_drawing_p2_world_point_matches(p_local->'center',p_world->'center',
        p_origin,p_rotation,p_scale_x,p_scale_y)
      and private.lukas_drawing_p2_number_close(
        (p_local->>'radius')::double precision*pg_catalog.abs(p_scale_x),
        (p_world->>'radius')::double precision);
  elsif v_type='text' then
    return p_local->'text' is not distinct from p_world->'text'
      and private.lukas_drawing_p2_world_point_matches(p_local->'origin',p_world->'origin',
        p_origin,p_rotation,p_scale_x,p_scale_y)
      and private.lukas_drawing_p2_number_close(
        (p_local->>'width')::double precision*pg_catalog.abs(p_scale_x),
        (p_world->>'width')::double precision);
  elsif v_type='dimension' then
    return pg_catalog.abs(p_scale_x)=pg_catalog.abs(p_scale_y)
      and p_local->'calibrationId' is not distinct from p_world->'calibrationId'
      and private.lukas_drawing_p2_world_point_matches(p_local->'start',p_world->'start',
        p_origin,p_rotation,p_scale_x,p_scale_y)
      and private.lukas_drawing_p2_world_point_matches(p_local->'end',p_world->'end',
        p_origin,p_rotation,p_scale_x,p_scale_y)
      and private.lukas_drawing_p2_number_close(
        (p_local->>'offset')::double precision*pg_catalog.abs(p_scale_x),
        (p_world->>'offset')::double precision);
  end if;
  return false;
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_structure_block_compound_valid(
  p_actions jsonb,p_revision_id uuid,p_project_id uuid
) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare
  v_block_action jsonb; v_instance_action jsonb; v_block jsonb; v_instance jsonb;
  v_object_action record; v_object public.lukas_drawing_objects%rowtype;
  v_existing_block public.lukas_drawing_blocks%rowtype;
  v_existing_instance public.lukas_drawing_block_instances%rowtype;
  v_primitive jsonb; v_delete_count integer;
begin
  if exists(select 1 from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind'='delete_object') then
    select a into v_block_action from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind'='put_block';
    select a into v_instance_action from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind'='put_block_instance';
    v_block:=v_block_action->'entity'; v_instance:=v_instance_action->'entity';
    select pg_catalog.count(*) into v_delete_count from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind'='delete_object';
    if pg_catalog.jsonb_typeof(v_block_action->'baseVersion')<>'null'
      or pg_catalog.jsonb_typeof(v_instance_action->'baseVersion')<>'null'
      or v_instance->>'blockId' is distinct from v_block->>'id'
      or pg_catalog.jsonb_array_length(v_block->'primitives')<>v_delete_count
      or not exists(select 1 from public.lukas_drawing_layers l
        where l.id=(v_instance->>'layerId')::uuid and l.revision_id=p_revision_id
          and l.project_id=p_project_id and l.system_kind<>'source'
          and l.visible and not l.locked) then return false; end if;
    for v_object_action in select a,ordinality from
      pg_catalog.jsonb_array_elements(p_actions) with ordinality x(a,ordinality)
      where a->>'kind'='delete_object' order by ordinality loop
      select * into v_object from public.lukas_drawing_objects o
        where o.id=(v_object_action.a->>'id')::uuid and o.revision_id=p_revision_id
          and o.project_id=p_project_id and o.status='active';
      v_primitive:=v_block->'primitives'->(
        (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_actions) with ordinality y(a,ordinality)
          where a->>'kind'='delete_object' and ordinality<=v_object_action.ordinality)::integer-1);
      if not found or v_object.layer_id::text is distinct from v_instance->>'layerId'
        or v_object.name is distinct from v_primitive->>'name'
        or coalesce(v_object.style_id::text,'') is distinct from coalesce(v_primitive->>'styleId','')
        or v_object.style is distinct from v_primitive->'style'
        or private.lukas_drawing_p2_world_geometry_matches(v_primitive->'geometry',v_object.geometry,
          v_instance->'origin',(v_instance->>'rotation')::double precision,
          (v_instance->>'scaleX')::double precision,(v_instance->>'scaleY')::double precision)
          is not true then return false; end if;
    end loop;
    return true;
  end if;
  select * into v_existing_block from public.lukas_drawing_blocks b
    where b.id=(select (a->>'id')::uuid from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind'='delete_block') and b.revision_id=p_revision_id and b.project_id=p_project_id;
  select * into v_existing_instance from public.lukas_drawing_block_instances i
    where i.id=(select (a->>'id')::uuid from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind'='delete_block_instance') and i.revision_id=p_revision_id and i.project_id=p_project_id;
  return found and v_existing_instance.block_id=v_existing_block.id
    and pg_catalog.jsonb_array_length(v_existing_block.primitives)
      =(select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(p_actions) a
        where a->>'kind'='put_object');
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_p2_child_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb:=pg_catalog.to_jsonb(old);
  v_new jsonb:=pg_catalog.to_jsonb(new);
  v_revision_id uuid:=coalesce((v_new->>'revision_id')::uuid,(v_old->>'revision_id')::uuid);
  v_project_id uuid:=coalesce((v_new->>'project_id')::uuid,(v_old->>'project_id')::uuid);
  v_status text; v_put_kind text; v_tombstone jsonb;
  v_actor uuid:=(select auth.uid());
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()>1 then return old; end if;
  if v_actor is null or coalesce(
      private.lukas_drawing_workspace_capability(v_project_id),'')
      not in ('admin','editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  select r.status into v_status from public.lukas_drawing_revisions r
  where r.id=v_revision_id and r.project_id=v_project_id for update;
  if not found then raise exception 'Drawing revision does not exist'; end if;
  if v_status<>'draft' then raise exception 'Approved drawing revision is immutable'; end if;
  if tg_op='INSERT' then
    if (v_new->>'created_by')::uuid<>v_actor then
      raise exception 'Drawing P2 child creator or initial version is invalid';
    end if;
    if (v_new->>'version')::bigint<>1 then
      v_put_kind:=case tg_table_name
        when 'lukas_drawing_canvases' then 'put_canvas'
        when 'lukas_drawing_styles' then 'put_style'
        when 'lukas_drawing_blocks' then 'put_block'
        when 'lukas_drawing_block_instances' then 'put_block_instance'
        when 'lukas_drawing_property_schemas' then 'put_property_schema'
        when 'lukas_drawing_property_values' then 'put_property_value'
        when 'lukas_drawing_tables' then 'put_table' end;
      v_tombstone:=private.lukas_drawing_structure_tombstone(v_revision_id,
        (v_new->>'id')::uuid,v_put_kind);
      if v_tombstone is null or (v_new->>'version')::bigint<>(v_tombstone->>'version')::bigint+2 then
        raise exception 'Drawing P2 child restore version is invalid';
      end if;
    end if;
    return new;
  elsif tg_op='DELETE' then return old;
  end if;
  if v_new->>'id' is distinct from v_old->>'id'
    or v_new->>'revision_id' is distinct from v_old->>'revision_id'
    or v_new->>'project_id' is distinct from v_old->>'project_id'
    or v_new->>'created_by' is distinct from v_old->>'created_by'
    or v_new->>'created_at' is distinct from v_old->>'created_at' then
    raise exception 'Drawing P2 child identity is immutable';
  end if;
  if (v_new->>'version')::bigint<>(v_old->>'version')::bigint+1 then
    raise exception 'Drawing P2 child version must increase by one';
  end if;
  new.updated_at:=pg_catalog.now();
  return new;
end;
$$;

create or replace function private.lukas_drawing_canvas_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()>1 then return old; end if;
  if tg_op='DELETE' then
    if old.space_kind='paper' and old.sort_order=0
      and current_setting('private.lukas_drawing_delete_page_ids',true)
        not like '%'||old.page_id::text||'%' then
      raise exception 'Default paper canvas is immutable';
    end if;
    if exists (select 1 from public.lukas_drawing_layers l
      where l.canvas_id=old.id and exists (select 1 from public.lukas_drawing_objects o
        where o.layer_id=l.id and o.status='active'))
      or exists (select 1 from public.lukas_drawing_block_instances i
        join public.lukas_drawing_layers l on l.id=i.layer_id where l.canvas_id=old.id) then
      raise exception 'Nonempty drawing canvas cannot be deleted';
    end if;
  elsif tg_op='UPDATE' then
    if new.page_id is distinct from old.page_id then
      raise exception 'Drawing canvas page identity is immutable';
    end if;
    if old.space_kind='paper' and old.sort_order=0
      and (new.space_kind<>'paper' or new.sort_order<>0) then
      raise exception 'Default paper canvas is immutable';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.background_source_file_id is not null and not exists(select 1
    from public.lukas_qto_files f where f.id=new.background_source_file_id
      and f.project_id=new.project_id and f.sha256=new.background_source_sha256
      and f.kind='pdf' and f.immutable) then
    raise exception 'Drawing canvas background must be an immutable project PDF';
  end if;
  return new;
end;
$$;

create or replace function private.lukas_drawing_style_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()<=1 and (
    exists(select 1 from public.lukas_drawing_objects o where o.style_id=old.id and o.status='active')
    or exists(select 1 from public.lukas_drawing_blocks b
      cross join lateral pg_catalog.jsonb_array_elements(b.primitives) p
      where b.revision_id=old.revision_id and p->>'styleId'=old.id::text)
  ) then raise exception 'Referenced drawing style cannot be deleted'; end if;
  if tg_op<>'DELETE' and private.lukas_drawing_style_valid(new.value) is not true then
    raise exception 'Drawing style definition is invalid';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.lukas_drawing_block_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()<=1 and exists(
    select 1 from public.lukas_drawing_block_instances i where i.block_id=old.id
  ) then raise exception 'Referenced drawing block cannot be deleted'; end if;
  if tg_op<>'DELETE' and private.lukas_drawing_p2_block_primitives_valid(
    new.primitives,new.revision_id,new.project_id) is not true then
    raise exception 'Drawing block primitives are invalid';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.lukas_drawing_property_schema_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()<=1 and (
    exists(select 1 from public.lukas_drawing_property_values v where v.schema_id=old.id)
    or exists(select 1 from public.lukas_drawing_tables t
      cross join lateral pg_catalog.jsonb_array_elements(t.columns_json) c
      where t.revision_id=old.revision_id and c->>'propertySchemaId'=old.id::text)
  ) then raise exception 'Referenced drawing property schema cannot be deleted'; end if;
  if tg_op<>'DELETE' and private.lukas_drawing_p2_property_schema_json_valid(
    new.value_type,new.enum_options,new.applies_to) is not true then
    raise exception 'Drawing property schema is invalid';
  end if;
  if tg_op='UPDATE' and exists(select 1 from public.lukas_drawing_property_values v
    where v.schema_id=old.id and private.lukas_drawing_p2_property_value_valid(
      v.value,new.value_type,new.enum_options) is not true) then
    raise exception 'Drawing property schema change invalidates an existing value';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.lukas_drawing_property_value_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_schema public.lukas_drawing_property_schemas%rowtype; v_type text;
begin
  if tg_op<>'DELETE' then
    select * into v_schema from public.lukas_drawing_property_schemas s
      where s.id=new.schema_id and s.revision_id=new.revision_id and s.project_id=new.project_id;
    if not found or private.lukas_drawing_p2_property_value_valid(
      new.value,v_schema.value_type,v_schema.enum_options) is not true then
      raise exception 'Drawing property value does not match its schema';
    end if;
    if new.object_id is not null then
      select o.object_type into v_type from public.lukas_drawing_objects o
      where o.id=new.object_id and o.revision_id=new.revision_id
        and o.project_id=new.project_id and o.status='active';
    else
      select 'block_instance' into v_type from public.lukas_drawing_block_instances i
      where i.id=new.block_instance_id and i.revision_id=new.revision_id
        and i.project_id=new.project_id;
    end if;
    if v_type is null or not (v_schema.applies_to @> pg_catalog.jsonb_build_array(v_type)) then
      raise exception 'Drawing property is not applicable to its target';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create trigger lukas_drawing_canvases_guard before insert or update or delete
  on public.lukas_drawing_canvases for each row execute function private.lukas_drawing_canvas_guard();
create trigger lukas_drawing_canvases_revision_guard before insert or update or delete
  on public.lukas_drawing_canvases for each row execute function private.lukas_drawing_p2_child_guard();
create trigger lukas_drawing_styles_guard before insert or update or delete
  on public.lukas_drawing_styles for each row execute function private.lukas_drawing_style_guard();
create trigger lukas_drawing_styles_revision_guard before insert or update or delete
  on public.lukas_drawing_styles for each row execute function private.lukas_drawing_p2_child_guard();
create trigger lukas_drawing_blocks_guard before insert or update or delete
  on public.lukas_drawing_blocks for each row execute function private.lukas_drawing_block_guard();
create trigger lukas_drawing_block_instances_guard before insert or update or delete
  on public.lukas_drawing_block_instances for each row execute function private.lukas_drawing_p2_child_guard();
create trigger lukas_drawing_blocks_revision_guard before insert or update or delete
  on public.lukas_drawing_blocks for each row execute function private.lukas_drawing_p2_child_guard();
create trigger lukas_drawing_property_schemas_guard before insert or update or delete
  on public.lukas_drawing_property_schemas for each row execute function private.lukas_drawing_property_schema_guard();
create trigger lukas_drawing_property_schemas_revision_guard before insert or update or delete
  on public.lukas_drawing_property_schemas for each row execute function private.lukas_drawing_p2_child_guard();
create trigger lukas_drawing_property_values_guard before insert or update or delete
  on public.lukas_drawing_property_values for each row execute function private.lukas_drawing_property_value_guard();
create trigger lukas_drawing_property_values_revision_guard before insert or update or delete
  on public.lukas_drawing_property_values for each row execute function private.lukas_drawing_p2_child_guard();
create trigger lukas_drawing_tables_guard before insert or update or delete
  on public.lukas_drawing_tables for each row execute function private.lukas_drawing_p2_child_guard();

create or replace function private.lukas_drawing_page_source_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and (
    new.width_mm is distinct from old.width_mm or new.height_mm is distinct from old.height_mm
    or new.background_source_file_id is distinct from old.background_source_file_id
    or new.background_source_sha256 is distinct from old.background_source_sha256
    or new.background_pdf_page is distinct from old.background_pdf_page
    or new.calibration is distinct from old.calibration
  ) then raise exception 'Legacy drawing page canvas columns are read-only'; end if;
  if new.background_source_file_id is not null and not exists(select 1
    from public.lukas_qto_files f where f.id=new.background_source_file_id
      and f.project_id=new.project_id and f.sha256=new.background_source_sha256
      and f.kind='pdf' and f.immutable) then
    raise exception 'Drawing page background must be an immutable project PDF';
  end if;
  new.updated_at:=pg_catalog.now(); return new;
end;
$$;

create or replace function private.lukas_drawing_layer_canvas_fill()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.canvas_id is null then
    select c.id into new.canvas_id from public.lukas_drawing_canvases c
      where c.page_id=new.page_id and c.revision_id=new.revision_id
        and c.project_id=new.project_id and c.space_kind='paper' and c.sort_order=0;
    if new.canvas_id is null then raise exception 'Drawing layer requires a canvas'; end if;
  end if;
  return new;
end;
$$;

create or replace function private.lukas_drawing_layer_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if tg_op='INSERT' then
    if current_user='authenticated' and new.system_kind<>'custom' then
      raise exception 'Only custom drawing layers may be inserted directly'; end if;
    if new.created_by<>v_actor or new.version<>1 then
      raise exception 'Drawing layer creator and initial version are invalid'; end if;
  elsif tg_op='DELETE' then
    if pg_catalog.pg_trigger_depth()>1 then return old; end if;
    if old.system_kind='source' then raise exception 'Source drawing layer is immutable'; end if;
    if not exists(select 1 from public.lukas_drawing_layers l where l.canvas_id=old.canvas_id
      and l.id<>old.id and l.system_kind<>'source' and l.visible and not l.locked) then
      raise exception 'At least one visible unlocked user drawing layer is required'; end if;
    return old;
  else
    if old.system_kind='source' then raise exception 'Source drawing layer is immutable'; end if;
    if new.id is distinct from old.id or new.revision_id is distinct from old.revision_id
      or new.project_id is distinct from old.project_id or new.system_kind is distinct from old.system_kind
      or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'Drawing layer identity is immutable'; end if;
    if new.version<>old.version+1 then raise exception 'Drawing layer version must increase by one'; end if;
  end if;
  if not exists(select 1 from public.lukas_drawing_canvases c where c.id=new.canvas_id
    and c.page_id=new.page_id and c.revision_id=new.revision_id and c.project_id=new.project_id) then
    raise exception 'Drawing layer canvas ancestry is invalid'; end if;
  if new.system_kind='source' and (not new.locked or not new.visible) then
    raise exception 'Source drawing layer must remain visible and locked'; end if;
  if new.system_kind<>'source' and (not new.visible or new.locked)
    and not exists(select 1 from public.lukas_drawing_layers l where l.canvas_id=new.canvas_id
      and l.id<>new.id and l.system_kind<>'source' and l.visible and not l.locked) then
    raise exception 'At least one visible unlocked user drawing layer is required'; end if;
  new.updated_at:=pg_catalog.now(); return new;
end;
$$;

create or replace function private.lukas_drawing_object_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_actor uuid:=(select auth.uid());
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if private.lukas_drawing_geometry_valid(new.object_type,new.geometry) is not true
    or ((new.style_id is null and private.lukas_drawing_style_valid(new.style) is not true)
      or (new.style_id is not null and private.lukas_drawing_style_override_valid(new.style) is not true)) then
    raise exception 'Drawing object domain JSON is invalid'; end if;
  if new.geometry->>'type' is distinct from new.object_type then
    raise exception 'Drawing geometry type must match object_type'; end if;
  if not exists(select 1 from public.lukas_drawing_layers l where l.id=new.layer_id
    and l.page_id=new.page_id and l.revision_id=new.revision_id and l.project_id=new.project_id
    and not l.locked) then raise exception 'Drawing object requires an unlocked layer on the same page'; end if;
  if new.style_id is not null and not exists(select 1 from public.lukas_drawing_styles s
    where s.id=new.style_id and s.revision_id=new.revision_id and s.project_id=new.project_id) then
    raise exception 'Drawing object style reference is invalid'; end if;
  if tg_op='INSERT' then
    if new.created_by<>v_actor or new.updated_by<>v_actor or new.version<>1 or new.status<>'active' then
      raise exception 'Drawing object creator or initial state is invalid'; end if;
  else
    if new.id is distinct from old.id or new.lineage_id is distinct from old.lineage_id
      or new.revision_id is distinct from old.revision_id or new.project_id is distinct from old.project_id
      or new.object_type is distinct from old.object_type or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then raise exception 'Drawing object identity is immutable'; end if;
    if new.updated_by<>v_actor or new.version<>old.version+1 then
      raise exception 'Drawing object actor or version is invalid'; end if;
  end if;
  new.updated_at:=pg_catalog.now(); return new;
end;
$$;

drop trigger if exists lukas_drawing_layers_domain_guard on public.lukas_drawing_layers;
drop trigger if exists lukas_drawing_layers_canvas_fill on public.lukas_drawing_layers;
create trigger lukas_drawing_layers_canvas_fill before insert on public.lukas_drawing_layers
  for each row execute function private.lukas_drawing_layer_canvas_fill();
create trigger lukas_drawing_layers_domain_guard before insert or update or delete on public.lukas_drawing_layers
  for each row execute function private.lukas_drawing_layer_guard();

alter table public.lukas_drawing_canvases enable row level security;
alter table public.lukas_drawing_styles enable row level security;
alter table public.lukas_drawing_blocks enable row level security;
alter table public.lukas_drawing_block_instances enable row level security;
alter table public.lukas_drawing_property_schemas enable row level security;
alter table public.lukas_drawing_property_values enable row level security;
alter table public.lukas_drawing_tables enable row level security;

revoke all on public.lukas_drawing_canvases,
  public.lukas_drawing_styles,
  public.lukas_drawing_blocks,
  public.lukas_drawing_block_instances,
  public.lukas_drawing_property_schemas,
  public.lukas_drawing_property_values,
  public.lukas_drawing_tables
from public, anon, authenticated;
grant select on public.lukas_drawing_canvases,
  public.lukas_drawing_styles,
  public.lukas_drawing_blocks,
  public.lukas_drawing_block_instances,
  public.lukas_drawing_property_schemas,
  public.lukas_drawing_property_values,
  public.lukas_drawing_tables to authenticated;
grant all on public.lukas_drawing_canvases,
  public.lukas_drawing_styles,
  public.lukas_drawing_blocks,
  public.lukas_drawing_block_instances,
  public.lukas_drawing_property_schemas,
  public.lukas_drawing_property_values,
  public.lukas_drawing_tables to service_role;
revoke all on public.lukas_drawing_canvases from public, anon, authenticated;
revoke all on public.lukas_drawing_styles from public, anon, authenticated;
revoke all on public.lukas_drawing_blocks from public, anon, authenticated;
revoke all on public.lukas_drawing_block_instances from public, anon, authenticated;
revoke all on public.lukas_drawing_property_schemas from public, anon, authenticated;
revoke all on public.lukas_drawing_property_values from public, anon, authenticated;
revoke all on public.lukas_drawing_tables from public, anon, authenticated;
grant select on public.lukas_drawing_canvases,public.lukas_drawing_styles,
  public.lukas_drawing_blocks,public.lukas_drawing_block_instances,
  public.lukas_drawing_property_schemas,public.lukas_drawing_property_values,
  public.lukas_drawing_tables to authenticated;

create policy "project members read drawing canvases" on public.lukas_drawing_canvases for select to authenticated
  using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "project members read drawing styles" on public.lukas_drawing_styles for select to authenticated
  using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "project members read drawing blocks" on public.lukas_drawing_blocks for select to authenticated
  using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "project members read drawing block instances" on public.lukas_drawing_block_instances for select to authenticated
  using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "project members read drawing property schemas" on public.lukas_drawing_property_schemas for select to authenticated
  using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "project members read drawing property values" on public.lukas_drawing_property_values for select to authenticated
  using (private.lukas_drawing_workspace_capability(project_id) is not null);
create policy "project members read drawing tables" on public.lukas_drawing_tables for select to authenticated
  using (private.lukas_drawing_workspace_capability(project_id) is not null);

alter function private.lukas_drawing_create_document(uuid, uuid, text, boolean)
  rename to lukas_drawing_create_document_pre_p2;

create or replace function private.lukas_drawing_create_document(
  p_project_id uuid,p_source_file_id uuid,p_title text,p_blank boolean
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_file public.lukas_qto_files%rowtype;
  v_document_id uuid; v_revision_id uuid; v_page_id uuid; v_canvas_id uuid;
  v_source_layer_id uuid; v_work_layer_id uuid;
begin
  if v_actor is null or coalesce(
    private.lukas_drawing_workspace_capability(p_project_id),'')
    not in ('admin','editor') then raise exception 'Drawing workspace editor capability required'; end if;
  if p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 240
    or p_blank is null then raise exception 'Drawing document title and blank-page choice are required'; end if;
  if p_source_file_id is not null then
    select * into v_file from public.lukas_qto_files f
      where f.id=p_source_file_id and f.project_id=p_project_id for key share;
    if not found or v_file.kind not in ('pdf','ifc') or not v_file.immutable then
      raise exception 'Drawing source must be an immutable project PDF or IFC'; end if;
  elsif not p_blank then raise exception 'A non-blank drawing requires a PDF or IFC source'; end if;
  insert into public.lukas_drawing_documents(project_id,source_file_id,source_sha256,title,created_by)
    values(p_project_id,p_source_file_id,v_file.sha256,pg_catalog.btrim(p_title),v_actor)
    returning id into v_document_id;
  insert into public.lukas_drawing_revisions(document_id,project_id,sequence,status,version,created_by)
    values(v_document_id,p_project_id,1,'draft',1,v_actor) returning id into v_revision_id;
  insert into public.lukas_drawing_pages(revision_id,project_id,name,page_number,sort_order,version,
    background_source_file_id,background_source_sha256,background_pdf_page)
    values(v_revision_id,p_project_id,'1',1,0,1,
      case when not p_blank and v_file.kind='pdf' then v_file.id end,
      case when not p_blank and v_file.kind='pdf' then v_file.sha256 end,
      case when not p_blank and v_file.kind='pdf' then 1 end)
    returning id into v_page_id;
  insert into public.lukas_drawing_canvases(id,page_id,revision_id,project_id,name,space_kind,
    width_mm,height_mm,background_source_file_id,background_source_sha256,background_pdf_page,
    calibration,sort_order,version,created_by)
    values(extensions.gen_random_uuid(),v_page_id,v_revision_id,p_project_id,'1 Paper','paper',420,297,
      case when not p_blank and v_file.kind='pdf' then v_file.id end,
      case when not p_blank and v_file.kind='pdf' then v_file.sha256 end,
      case when not p_blank and v_file.kind='pdf' then 1 end,null,0,1,v_actor)
    returning id into v_canvas_id;
  insert into public.lukas_drawing_layers(page_id,canvas_id,revision_id,project_id,name,sort_order,
    visible,locked,system_kind,version,created_by)
    values(v_page_id,v_canvas_id,v_revision_id,p_project_id,'작업',1,true,false,'work',1,v_actor)
    returning id into v_work_layer_id;
  insert into public.lukas_drawing_layers(page_id,canvas_id,revision_id,project_id,name,sort_order,
    visible,locked,system_kind,version,created_by)
    values(v_page_id,v_canvas_id,v_revision_id,p_project_id,'원본',0,true,true,'source',1,v_actor)
    returning id into v_source_layer_id;
  return pg_catalog.jsonb_build_object('documentId',v_document_id,'revisionId',v_revision_id,
    'pageId',v_page_id,'canvasId',v_canvas_id,'sourceLayerId',v_source_layer_id,
    'workLayerId',v_work_layer_id);
exception
  when unique_violation then raise exception using errcode='P1C01',
    message='A drawing document already exists for this source file';
  when raise_exception then
    if sqlstate in ('P1C01','P1R01') then raise; end if;
    raise exception using errcode='P1R01',message=sqlerrm;
end;
$$;

create or replace function private.lukas_drawing_structure_entity_json(
  p_kind text,p_id uuid,p_revision_id uuid,p_project_id uuid
) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;
begin
  if p_kind='object' then
    select pg_catalog.jsonb_build_object('id',o.id,'name',o.name,'layerId',o.layer_id,
      'geometry',o.geometry,'styleId',o.style_id,'style',o.style,'version',o.version)
      into v from public.lukas_drawing_objects o where o.id=p_id and o.revision_id=p_revision_id
        and o.project_id=p_project_id and o.status='active';
  elsif p_kind='page' then
    select pg_catalog.jsonb_build_object('id',p.id,'revisionId',p.revision_id,'name',p.name,
      'sortOrder',p.sort_order,'version',p.version) into v
      from public.lukas_drawing_pages p where p.id=p_id and p.revision_id=p_revision_id and p.project_id=p_project_id;
  elsif p_kind='canvas' then
    select pg_catalog.jsonb_build_object('id',c.id,'pageId',c.page_id,'name',c.name,
      'spaceKind',c.space_kind,'widthMillimeters',c.width_mm,'heightMillimeters',c.height_mm,
      'background',case when c.background_source_file_id is null then null else
        pg_catalog.jsonb_build_object('sourceFileId',c.background_source_file_id,
          'sourceSha256',c.background_source_sha256,'pdfPageNumber',c.background_pdf_page,
          'calibration',c.calibration) end,'sortOrder',c.sort_order,'version',c.version)
      into v from public.lukas_drawing_canvases c where c.id=p_id and c.revision_id=p_revision_id and c.project_id=p_project_id;
  elsif p_kind='style' then
    select pg_catalog.jsonb_build_object('id',s.id,'revisionId',s.revision_id,'name',s.name,
      'value',s.value,'version',s.version) into v from public.lukas_drawing_styles s
      where s.id=p_id and s.revision_id=p_revision_id and s.project_id=p_project_id;
  elsif p_kind='block' then
    select pg_catalog.jsonb_build_object('id',b.id,'revisionId',b.revision_id,'name',b.name,
      'primitives',b.primitives,'version',b.version) into v from public.lukas_drawing_blocks b
      where b.id=p_id and b.revision_id=p_revision_id and b.project_id=p_project_id;
  elsif p_kind='block_instance' then
    select pg_catalog.jsonb_build_object('id',i.id,'blockId',i.block_id,'layerId',i.layer_id,
      'name',i.name,'origin',i.origin,'rotation',i.rotation,'scaleX',i.scale_x,'scaleY',i.scale_y,
      'version',i.version) into v from public.lukas_drawing_block_instances i
      where i.id=p_id and i.revision_id=p_revision_id and i.project_id=p_project_id;
  elsif p_kind='property_schema' then
    select pg_catalog.jsonb_build_object('id',s.id,'revisionId',s.revision_id,'name',s.name,
      'valueType',s.value_type,'enumOptions',s.enum_options,'appliesTo',s.applies_to,
      'required',s.required,'version',s.version) into v from public.lukas_drawing_property_schemas s
      where s.id=p_id and s.revision_id=p_revision_id and s.project_id=p_project_id;
  elsif p_kind='property_value' then
    select pg_catalog.jsonb_build_object('id',v0.id,'schemaId',v0.schema_id,'objectId',v0.object_id,
      'blockInstanceId',v0.block_instance_id,'value',v0.value,'version',v0.version) into v
      from public.lukas_drawing_property_values v0 where v0.id=p_id
        and v0.revision_id=p_revision_id and v0.project_id=p_project_id;
  elsif p_kind='table' then
    select pg_catalog.jsonb_build_object('id',t.id,'revisionId',t.revision_id,'name',t.name,
      'columns',t.columns_json,'rows',t.rows_json,'version',t.version) into v
      from public.lukas_drawing_tables t where t.id=p_id and t.revision_id=p_revision_id and t.project_id=p_project_id;
  end if;
  return v;
end;
$$;

create or replace function private.lukas_drawing_structure_raw_id_exists(p_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.lukas_drawing_pages where id=p_id)
    or exists(select 1 from public.lukas_drawing_canvases where id=p_id)
    or exists(select 1 from public.lukas_drawing_layers where id=p_id)
    or exists(select 1 from public.lukas_drawing_objects where id=p_id)
    or exists(select 1 from public.lukas_drawing_styles where id=p_id)
    or exists(select 1 from public.lukas_drawing_blocks where id=p_id)
    or exists(select 1 from public.lukas_drawing_block_instances where id=p_id)
    or exists(select 1 from public.lukas_drawing_property_schemas where id=p_id)
    or exists(select 1 from public.lukas_drawing_property_values where id=p_id)
    or exists(select 1 from public.lukas_drawing_tables where id=p_id)
$$;

create or replace function private.lukas_drawing_structure_raw_id_recorded(
  p_revision_id uuid,p_id uuid
) returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.result_versions ? p_id::text)
$$;

create or replace function private.lukas_drawing_structure_action_valid(
  p_action jsonb,p_revision_id uuid
) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare v_kind text; v_entity jsonb; v_background jsonb; v_item jsonb;
begin
  if pg_catalog.jsonb_typeof(p_action)<>'object' or not (p_action ? 'kind')
    or pg_catalog.jsonb_typeof(p_action->'kind')<>'string' then return false; end if;
  v_kind:=p_action->>'kind';
  if v_kind like 'delete\_%' then
    return p_action ?& array['kind','id','baseVersion']
      and p_action-array['kind','id','baseVersion']='{}'::jsonb
      and v_kind in ('delete_object','delete_page','delete_canvas','delete_style','delete_block',
        'delete_block_instance','delete_property_schema','delete_property_value','delete_table')
      and private.lukas_drawing_p2_uuid(p_action->'id') is true
      and private.lukas_drawing_p2_positive_integer(p_action->'baseVersion') is true;
  end if;
  if v_kind not in ('put_object','put_page','put_canvas','put_style','put_block',
      'put_block_instance','put_property_schema','put_property_value','put_table')
    or not (p_action ?& array['kind','entity','baseVersion'])
    or p_action-array['kind','entity','baseVersion']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(p_action->'entity')<>'object'
    or not (pg_catalog.jsonb_typeof(p_action->'baseVersion')='null'
      or private.lukas_drawing_p2_positive_integer(p_action->'baseVersion') is true) then return false; end if;
  v_entity:=p_action->'entity';
  if private.lukas_drawing_p2_uuid(v_entity->'id') is not true
    or private.lukas_drawing_p2_positive_integer(v_entity->'version') is not true then return false; end if;
  if v_kind='put_object' then
    return v_entity ?& array['id','name','layerId','geometry','style','version']
      and v_entity-array['id','name','layerId','geometry','style','styleId','version']='{}'::jsonb
      and private.lukas_drawing_p2_name(v_entity->'name') is true
      and private.lukas_drawing_p2_uuid(v_entity->'layerId') is true
      and private.lukas_drawing_geometry_valid(v_entity->'geometry'->>'type',v_entity->'geometry') is true
      and ((not (v_entity ? 'styleId') or pg_catalog.jsonb_typeof(v_entity->'styleId')='null')
        and private.lukas_drawing_style_valid(v_entity->'style') is true
        or (private.lukas_drawing_p2_uuid(v_entity->'styleId') is true
          and private.lukas_drawing_style_override_valid(v_entity->'style') is true));
  elsif v_kind='put_page' then
    return v_entity ?& array['id','revisionId','name','sortOrder','version']
      and v_entity-array['id','revisionId','name','sortOrder','version']='{}'::jsonb
      and v_entity->>'revisionId'=p_revision_id::text
      and private.lukas_drawing_p2_name(v_entity->'name') is true
      and pg_catalog.jsonb_typeof(v_entity->'sortOrder')='number'
      and (v_entity->>'sortOrder')::numeric>=0
      and (v_entity->>'sortOrder')::numeric=pg_catalog.trunc((v_entity->>'sortOrder')::numeric);
  elsif v_kind='put_canvas' then
    if not (v_entity ?& array['id','pageId','name','spaceKind','widthMillimeters',
      'heightMillimeters','background','sortOrder','version'])
      or v_entity-array['id','pageId','name','spaceKind','widthMillimeters','heightMillimeters',
        'background','sortOrder','version']<>'{}'::jsonb
      or private.lukas_drawing_p2_uuid(v_entity->'pageId') is not true
      or private.lukas_drawing_p2_name(v_entity->'name') is not true
      or v_entity->>'spaceKind' not in ('paper','model')
      or pg_catalog.jsonb_typeof(v_entity->'widthMillimeters')<>'number'
      or (v_entity->>'widthMillimeters')::numeric<=0
      or pg_catalog.jsonb_typeof(v_entity->'heightMillimeters')<>'number'
      or (v_entity->>'heightMillimeters')::numeric<=0
      or pg_catalog.jsonb_typeof(v_entity->'sortOrder')<>'number'
      or (v_entity->>'sortOrder')::numeric<0
      or (v_entity->>'sortOrder')::numeric<>pg_catalog.trunc((v_entity->>'sortOrder')::numeric)
      then return false; end if;
    v_background:=v_entity->'background';
    return pg_catalog.jsonb_typeof(v_background)='null' or (
      pg_catalog.jsonb_typeof(v_background)='object'
      and v_background ?& array['sourceFileId','sourceSha256','pdfPageNumber','calibration']
      and v_background-array['sourceFileId','sourceSha256','pdfPageNumber','calibration']='{}'::jsonb
      and private.lukas_drawing_p2_uuid(v_background->'sourceFileId') is true
      and pg_catalog.jsonb_typeof(v_background->'sourceSha256')='string'
      and v_background->>'sourceSha256' ~ '^[0-9a-f]{64}$'
      and (pg_catalog.jsonb_typeof(v_background->'pdfPageNumber')='null'
        or private.lukas_drawing_p2_positive_integer(v_background->'pdfPageNumber') is true)
      and (pg_catalog.jsonb_typeof(v_background->'calibration')='null'
        or private.lukas_drawing_p2_calibration_valid(v_background->'calibration') is true));
  elsif v_kind='put_style' then
    return v_entity ?& array['id','revisionId','name','value','version']
      and v_entity-array['id','revisionId','name','value','version']='{}'::jsonb
      and v_entity->>'revisionId'=p_revision_id::text
      and private.lukas_drawing_p2_name(v_entity->'name') is true
      and private.lukas_drawing_style_valid(v_entity->'value') is true;
  elsif v_kind='put_block' then
    return v_entity ?& array['id','revisionId','name','primitives','version']
      and v_entity-array['id','revisionId','name','primitives','version']='{}'::jsonb
      and v_entity->>'revisionId'=p_revision_id::text
      and private.lukas_drawing_p2_name(v_entity->'name') is true
      and pg_catalog.jsonb_typeof(v_entity->'primitives')='array';
  elsif v_kind='put_block_instance' then
    return v_entity ?& array['id','blockId','layerId','name','origin','rotation','scaleX','scaleY','version']
      and v_entity-array['id','blockId','layerId','name','origin','rotation','scaleX','scaleY','version']='{}'::jsonb
      and private.lukas_drawing_p2_uuid(v_entity->'blockId') is true
      and private.lukas_drawing_p2_uuid(v_entity->'layerId') is true
      and private.lukas_drawing_p2_name(v_entity->'name') is true
      and private.lukas_drawing_point_valid(v_entity->'origin') is true
      and pg_catalog.jsonb_typeof(v_entity->'rotation')='number'
      and pg_catalog.jsonb_typeof(v_entity->'scaleX')='number' and (v_entity->>'scaleX')::numeric<>0
      and pg_catalog.jsonb_typeof(v_entity->'scaleY')='number' and (v_entity->>'scaleY')::numeric<>0;
  elsif v_kind='put_property_schema' then
    return v_entity ?& array['id','revisionId','name','valueType','enumOptions','appliesTo','required','version']
      and v_entity-array['id','revisionId','name','valueType','enumOptions','appliesTo','required','version']='{}'::jsonb
      and v_entity->>'revisionId'=p_revision_id::text
      and private.lukas_drawing_p2_name(v_entity->'name') is true
      and pg_catalog.jsonb_typeof(v_entity->'required')='boolean'
      and private.lukas_drawing_p2_property_schema_json_valid(v_entity->>'valueType',
        v_entity->'enumOptions',v_entity->'appliesTo') is true;
  elsif v_kind='put_property_value' then
    return v_entity ?& array['id','schemaId','objectId','blockInstanceId','value','version']
      and v_entity-array['id','schemaId','objectId','blockInstanceId','value','version']='{}'::jsonb
      and private.lukas_drawing_p2_uuid(v_entity->'schemaId') is true
      and ((private.lukas_drawing_p2_uuid(v_entity->'objectId') is true
          and pg_catalog.jsonb_typeof(v_entity->'blockInstanceId')='null')
        or (pg_catalog.jsonb_typeof(v_entity->'objectId')='null'
          and private.lukas_drawing_p2_uuid(v_entity->'blockInstanceId') is true))
      and pg_catalog.jsonb_typeof(v_entity->'value') in ('null','string','number','boolean');
  elsif v_kind='put_table' then
    if not (v_entity ?& array['id','revisionId','name','columns','rows','version'])
      or v_entity-array['id','revisionId','name','columns','rows','version']<>'{}'::jsonb
      or v_entity->>'revisionId'<>p_revision_id::text
      or private.lukas_drawing_p2_name(v_entity->'name') is not true
      or pg_catalog.jsonb_typeof(v_entity->'columns')<>'array'
      or pg_catalog.jsonb_array_length(v_entity->'columns')=0
      or pg_catalog.jsonb_typeof(v_entity->'rows')<>'array' then return false; end if;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_entity->'columns') loop
      if pg_catalog.jsonb_typeof(v_item)<>'object'
        or not (v_item ?& array['id','name','kind','propertySchemaId'])
        or v_item-array['id','name','kind','propertySchemaId']<>'{}'::jsonb
        or private.lukas_drawing_p2_uuid(v_item->'id') is not true
        or private.lukas_drawing_p2_name(v_item->'name') is not true
        or v_item->>'kind' not in ('text','number','object_name','object_type','property')
        or not ((v_item->>'kind'='property'
            and private.lukas_drawing_p2_uuid(v_item->'propertySchemaId') is true)
          or (v_item->>'kind'<>'property'
            and pg_catalog.jsonb_typeof(v_item->'propertySchemaId')='null'))
        then return false; end if;
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_entity->'rows') loop
      if pg_catalog.jsonb_typeof(v_item)<>'object'
        or not (v_item ?& array['id','objectId','blockInstanceId','cells'])
        or v_item-array['id','objectId','blockInstanceId','cells']<>'{}'::jsonb
        or private.lukas_drawing_p2_uuid(v_item->'id') is not true
        or not (pg_catalog.jsonb_typeof(v_item->'objectId')='null'
          or private.lukas_drawing_p2_uuid(v_item->'objectId') is true)
        or not (pg_catalog.jsonb_typeof(v_item->'blockInstanceId')='null'
          or private.lukas_drawing_p2_uuid(v_item->'blockInstanceId') is true)
        or pg_catalog.jsonb_typeof(v_item->'cells')<>'object'
        or exists(select 1 from pg_catalog.jsonb_each(v_item->'cells') cell
          where private.lukas_drawing_p2_uuid(pg_catalog.to_jsonb(cell.key)) is not true
            or pg_catalog.jsonb_typeof(cell.value) not in ('string','number','null'))
        then return false; end if;
    end loop;
    return true;
  end if;
  return false;
exception when others then return false;
end;
$$;

alter function private.lukas_drawing_apply_operation(uuid, uuid, text, jsonb, jsonb, jsonb)
  rename to lukas_drawing_apply_operation_pre_p2;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_action jsonb; v_inverse_action jsonb; v_entity jsonb; v_previous jsonb;
  v_expected_inverse jsonb; v_tombstone jsonb; v_actions jsonb;
  v_kind text; v_entity_kind text; v_id uuid; v_base bigint; v_new_version bigint;
  v_index integer; v_action_count integer; v_operation_id uuid; v_sequence bigint;
  v_expected_bases jsonb:='{}'::jsonb; v_result_versions jsonb:='{}'::jsonb;
  v_page_id uuid; v_layer public.lukas_drawing_layers%rowtype;
  v_delete_page_ids text:=''; v_count integer;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
    where r.id=p_revision_id and v_actor is not null
      and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
    for update;
  if not found then raise exception using errcode='P1R01',
    message='Drawing revision target is unavailable'; end if;

  select o.* into v_existing from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
      or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions
      or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse then
      raise exception using errcode='P1C01',
        message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object('operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions);
  end if;

  if p_operation_type = 'mutate_structure' then
    null;
  else
    return private.lukas_drawing_apply_operation_pre_p2(p_revision_id,p_client_operation_id,
      p_operation_type,p_base_versions,p_forward,p_inverse);
  end if;
  if v_revision.status<>'draft' then raise exception using errcode='P1C01',
    message='Drawing operation requires a draft revision'; end if;
  if p_client_operation_id is null or pg_catalog.jsonb_typeof(p_base_versions)<>'object'
    or pg_catalog.jsonb_typeof(p_forward)<>'object'
    or not (p_forward ?& array['type','actions'])
    or p_forward-array['type','actions']<>'{}'::jsonb
    or p_forward->>'type'<>'mutate_structure'
    or pg_catalog.jsonb_typeof(p_forward->'actions')<>'array'
    or pg_catalog.jsonb_array_length(p_forward->'actions')=0
    or pg_catalog.jsonb_typeof(p_inverse)<>'object'
    or not (p_inverse ?& array['type','actions'])
    or p_inverse-array['type','actions']<>'{}'::jsonb
    or p_inverse->>'type'<>'mutate_structure'
    or pg_catalog.jsonb_typeof(p_inverse->'actions')<>'array'
    or pg_catalog.jsonb_array_length(p_inverse->'actions')
      <>pg_catalog.jsonb_array_length(p_forward->'actions') then
    raise exception using errcode='P1C01',message='Drawing structure payload is invalid';
  end if;
  v_actions:=p_forward->'actions'; v_action_count:=pg_catalog.jsonb_array_length(v_actions);
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_actions) a
      where private.lukas_drawing_structure_action_valid(a,p_revision_id) is not true)
    or exists(select 1 from pg_catalog.jsonb_array_elements(v_actions) a
      group by coalesce(a->'entity'->>'id',a->>'id') having pg_catalog.count(*)>1) then
    raise exception using errcode='P1C01',message='Drawing structure action JSON is invalid';
  end if;

  -- Object structure actions are reserved for one atomic block conversion or its inverse.
  if exists(select 1 from pg_catalog.jsonb_array_elements(v_actions) a
      where a->>'kind' in ('put_object','delete_object')) then
    if not (
      (not exists(select 1 from pg_catalog.jsonb_array_elements(v_actions) a where a->>'kind'='put_object')
        and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_actions) a where a->>'kind'='put_block')=1
        and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_actions) a where a->>'kind'='put_block_instance')=1
        and not exists(select 1 from pg_catalog.jsonb_array_elements(v_actions) a
          where a->>'kind' not in ('delete_object','put_block','put_block_instance')))
      or
      (not exists(select 1 from pg_catalog.jsonb_array_elements(v_actions) a where a->>'kind'='delete_object')
        and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_actions) a where a->>'kind'='delete_block')=1
        and (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(v_actions) a where a->>'kind'='delete_block_instance')=1
        and not exists(select 1 from pg_catalog.jsonb_array_elements(v_actions) a
          where a->>'kind' not in ('put_object','delete_block','delete_block_instance')))
    ) then raise exception using errcode='P1C01',
      message='Structure object actions require an exact block compound'; end if;
    if private.lukas_drawing_structure_block_compound_valid(
      v_actions,p_revision_id,v_revision.project_id) is not true then
      raise exception using errcode='P1C01',
        message='Drawing block compound does not exactly represent its source objects';
    end if;
  end if;

  select pg_catalog.string_agg(a->>'id',',') into v_delete_page_ids
    from pg_catalog.jsonb_array_elements(v_actions) a where a->>'kind'='delete_page';
  perform pg_catalog.set_config('private.lukas_drawing_delete_page_ids',coalesce(v_delete_page_ids,''),true);

  for v_index in 0..v_action_count-1 loop
    v_action:=v_actions->v_index;
    v_inverse_action:=p_inverse->'actions'->(v_action_count-v_index-1);
    v_kind:=v_action->>'kind';
    v_entity_kind:=replace(replace(v_kind,'put_',''),'delete_','');
    v_entity:=v_action->'entity';
    v_id:=coalesce((v_entity->>'id')::uuid,(v_action->>'id')::uuid);
    v_previous:=private.lukas_drawing_structure_entity_json(v_entity_kind,v_id,
      p_revision_id,v_revision.project_id);

    if v_kind like 'put\_%' then
      if pg_catalog.jsonb_typeof(v_action->'baseVersion')='null' then
        if v_previous is not null then raise exception using errcode='P1C01',
          message='Drawing structure entity already exists'; end if;
        v_tombstone:=private.lukas_drawing_structure_tombstone(p_revision_id,v_id,v_kind);
        if v_tombstone is null then
          if private.lukas_drawing_structure_raw_id_exists(v_id)
            or private.lukas_drawing_structure_raw_id_recorded(p_revision_id,v_id)
            or (v_entity->>'version')::bigint<>1 then
            raise exception using errcode='P1C01',message='Drawing structure raw ID collision'; end if;
          v_new_version:=1;
        else
          if v_entity is distinct from v_tombstone then raise exception using errcode='P1C01',
            message='Drawing structure restore must match the exact tombstone'; end if;
          v_new_version:=(v_tombstone->>'version')::bigint+2;
        end if;
        v_expected_inverse:=pg_catalog.jsonb_build_object('kind',replace(v_kind,'put_','delete_'),
          'id',v_id,'baseVersion',v_new_version);
      else
        v_base:=(v_action->>'baseVersion')::bigint;
        v_expected_bases:=v_expected_bases||pg_catalog.jsonb_build_object(v_id::text,v_base);
        if v_previous is null or (v_previous->>'version')::bigint<>v_base
          or (v_entity->>'version')::bigint<>v_base then
          raise exception using errcode='P1C01',message='Drawing structure base version conflict'; end if;
        v_new_version:=v_base+1;
        v_expected_inverse:=pg_catalog.jsonb_build_object('kind',v_kind,'entity',v_previous,
          'baseVersion',v_new_version);
      end if;
    else
      v_base:=(v_action->>'baseVersion')::bigint;
      v_expected_bases:=v_expected_bases||pg_catalog.jsonb_build_object(v_id::text,v_base);
      if v_previous is null or (v_previous->>'version')::bigint<>v_base then
        raise exception using errcode='P1C01',message='Drawing structure base version conflict'; end if;
      v_new_version:=v_base+1;
      v_expected_inverse:=pg_catalog.jsonb_build_object('kind',replace(v_kind,'delete_','put_'),
        'entity',v_previous,'baseVersion',null);
    end if;
    if v_inverse_action is distinct from v_expected_inverse then
      raise exception using errcode='P1C01',message='Drawing structure inverse is not exact'; end if;

    if v_kind='put_page' then
      if v_previous is null then
        insert into public.lukas_drawing_pages(id,revision_id,project_id,name,page_number,
          sort_order,version,width_mm,height_mm)
          values(v_id,p_revision_id,v_revision.project_id,v_entity->>'name',
            (v_entity->>'sortOrder')::integer+1,(v_entity->>'sortOrder')::integer,
            v_new_version,420,297);
      else update public.lukas_drawing_pages set name=v_entity->>'name',
        page_number=(v_entity->>'sortOrder')::integer+1,sort_order=(v_entity->>'sortOrder')::integer,
        version=v_new_version where id=v_id; end if;
    elsif v_kind='delete_page' then
      if exists(select 1 from public.lukas_drawing_canvases c where c.page_id=v_id) then
        raise exception using errcode='P1C01',message='Drawing page still contains canvases'; end if;
      delete from public.lukas_drawing_pages where id=v_id;
    elsif v_kind='put_canvas' then
      v_page_id:=(v_entity->>'pageId')::uuid;
      perform 1 from public.lukas_drawing_pages p where p.id=v_page_id
        and p.revision_id=p_revision_id and p.project_id=v_revision.project_id for key share;
      if not found then raise exception using errcode='P1R01',message='Drawing structure reference is unavailable'; end if;
      if v_previous is null then
        insert into public.lukas_drawing_canvases(id,page_id,revision_id,project_id,name,space_kind,
          width_mm,height_mm,background_source_file_id,background_source_sha256,background_pdf_page,
          calibration,sort_order,version,created_by)
          values(v_id,v_page_id,p_revision_id,v_revision.project_id,v_entity->>'name',v_entity->>'spaceKind',
            (v_entity->>'widthMillimeters')::numeric,(v_entity->>'heightMillimeters')::numeric,
            nullif(v_entity->'background'->>'sourceFileId','')::uuid,
            v_entity->'background'->>'sourceSha256',
            nullif(v_entity->'background'->>'pdfPageNumber','')::integer,
            case when pg_catalog.jsonb_typeof(v_entity->'background'->'calibration')='null'
              then null else v_entity->'background'->'calibration' end,
            (v_entity->>'sortOrder')::integer,
            v_new_version,v_actor);
        insert into public.lukas_drawing_layers(page_id,canvas_id,revision_id,project_id,name,
          sort_order,visible,locked,system_kind,version,created_by)
          values(v_page_id,v_id,p_revision_id,v_revision.project_id,
            'P2 '||pg_catalog.left(v_id::text,8),0,true,false,'custom',1,v_actor);
      else update public.lukas_drawing_canvases set name=v_entity->>'name',
        space_kind=v_entity->>'spaceKind',width_mm=(v_entity->>'widthMillimeters')::numeric,
        height_mm=(v_entity->>'heightMillimeters')::numeric,
        background_source_file_id=nullif(v_entity->'background'->>'sourceFileId','')::uuid,
        background_source_sha256=v_entity->'background'->>'sourceSha256',
        background_pdf_page=nullif(v_entity->'background'->>'pdfPageNumber','')::integer,
        calibration=case when pg_catalog.jsonb_typeof(v_entity->'background'->'calibration')='null'
          then null else v_entity->'background'->'calibration' end,
        sort_order=(v_entity->>'sortOrder')::integer,
        version=v_new_version where id=v_id; end if;
    elsif v_kind='delete_canvas' then
      delete from public.lukas_drawing_canvases where id=v_id;
    elsif v_kind='put_style' then
      if v_previous is null then insert into public.lukas_drawing_styles(id,revision_id,project_id,name,
        value,version,created_by) values(v_id,p_revision_id,v_revision.project_id,v_entity->>'name',
          v_entity->'value',v_new_version,v_actor);
      else update public.lukas_drawing_styles set name=v_entity->>'name',value=v_entity->'value',
        version=v_new_version where id=v_id; end if;
    elsif v_kind='delete_style' then delete from public.lukas_drawing_styles where id=v_id;
    elsif v_kind='put_block' then
      if v_previous is null then insert into public.lukas_drawing_blocks(id,revision_id,project_id,name,
        primitives,version,created_by) values(v_id,p_revision_id,v_revision.project_id,v_entity->>'name',
          v_entity->'primitives',v_new_version,v_actor);
      else update public.lukas_drawing_blocks set name=v_entity->>'name',primitives=v_entity->'primitives',
        version=v_new_version where id=v_id; end if;
    elsif v_kind='delete_block' then delete from public.lukas_drawing_blocks where id=v_id;
    elsif v_kind='put_block_instance' then
      select * into v_layer from public.lukas_drawing_layers l where l.id=(v_entity->>'layerId')::uuid
        and l.revision_id=p_revision_id and l.project_id=v_revision.project_id
        and l.visible and not l.locked for key share;
      if not found then raise exception using errcode='P1R01',message='Drawing structure reference is unavailable'; end if;
      if v_previous is null then insert into public.lukas_drawing_block_instances(id,block_id,layer_id,
        revision_id,project_id,name,origin,rotation,scale_x,scale_y,version,created_by)
        values(v_id,(v_entity->>'blockId')::uuid,v_layer.id,p_revision_id,v_revision.project_id,
          v_entity->>'name',v_entity->'origin',(v_entity->>'rotation')::numeric,
          (v_entity->>'scaleX')::numeric,(v_entity->>'scaleY')::numeric,v_new_version,v_actor);
      else update public.lukas_drawing_block_instances set block_id=(v_entity->>'blockId')::uuid,
        layer_id=v_layer.id,name=v_entity->>'name',origin=v_entity->'origin',
        rotation=(v_entity->>'rotation')::numeric,scale_x=(v_entity->>'scaleX')::numeric,
        scale_y=(v_entity->>'scaleY')::numeric,version=v_new_version where id=v_id; end if;
    elsif v_kind='delete_block_instance' then
      if exists(select 1 from public.lukas_drawing_property_values where block_instance_id=v_id)
        or exists(select 1 from public.lukas_drawing_tables t
          cross join lateral pg_catalog.jsonb_array_elements(t.rows_json) r
          where t.revision_id=p_revision_id and r->>'blockInstanceId'=v_id::text) then
        raise exception using errcode='P1C01',message='Referenced block instance cannot be deleted'; end if;
      delete from public.lukas_drawing_block_instances where id=v_id;
    elsif v_kind='put_property_schema' then
      if v_previous is null then insert into public.lukas_drawing_property_schemas(id,revision_id,project_id,
        name,value_type,enum_options,applies_to,required,version,created_by)
        values(v_id,p_revision_id,v_revision.project_id,v_entity->>'name',v_entity->>'valueType',
          v_entity->'enumOptions',v_entity->'appliesTo',(v_entity->>'required')::boolean,v_new_version,v_actor);
      else update public.lukas_drawing_property_schemas set name=v_entity->>'name',
        value_type=v_entity->>'valueType',enum_options=v_entity->'enumOptions',
        applies_to=v_entity->'appliesTo',required=(v_entity->>'required')::boolean,
        version=v_new_version where id=v_id; end if;
    elsif v_kind='delete_property_schema' then delete from public.lukas_drawing_property_schemas where id=v_id;
    elsif v_kind='put_property_value' then
      if v_previous is null then insert into public.lukas_drawing_property_values(id,schema_id,object_id,
        block_instance_id,revision_id,project_id,value,version,created_by)
        values(v_id,(v_entity->>'schemaId')::uuid,nullif(v_entity->>'objectId','')::uuid,
          nullif(v_entity->>'blockInstanceId','')::uuid,p_revision_id,v_revision.project_id,
          v_entity->'value',v_new_version,v_actor);
      else update public.lukas_drawing_property_values set schema_id=(v_entity->>'schemaId')::uuid,
        object_id=nullif(v_entity->>'objectId','')::uuid,
        block_instance_id=nullif(v_entity->>'blockInstanceId','')::uuid,value=v_entity->'value',
        version=v_new_version where id=v_id; end if;
    elsif v_kind='delete_property_value' then delete from public.lukas_drawing_property_values where id=v_id;
    elsif v_kind='put_table' then
      if exists(select 1 from pg_catalog.jsonb_array_elements(v_entity->'columns') c
          where c->>'kind'='property' and not exists(select 1 from public.lukas_drawing_property_schemas s
            where s.id=(c->>'propertySchemaId')::uuid and s.revision_id=p_revision_id))
        or exists(select 1 from pg_catalog.jsonb_array_elements(v_entity->'rows') r
          where (r->>'objectId' is not null and not exists(select 1 from public.lukas_drawing_objects o
            where o.id=(r->>'objectId')::uuid and o.revision_id=p_revision_id and o.status='active'))
          or (r->>'blockInstanceId' is not null and not exists(select 1 from public.lukas_drawing_block_instances i
            where i.id=(r->>'blockInstanceId')::uuid and i.revision_id=p_revision_id))) then
        raise exception using errcode='P1R01',message='Drawing structure reference is unavailable'; end if;
      if exists(select 1 from pg_catalog.jsonb_array_elements(v_entity->'rows') r
          cross join lateral pg_catalog.jsonb_each(r->'cells') cell
          left join lateral (select c from pg_catalog.jsonb_array_elements(v_entity->'columns') c
            where c->>'id'=cell.key) matched on true
          where matched.c is null
            or (pg_catalog.jsonb_typeof(cell.value)<>'null' and (
              matched.c->>'kind' not in ('text','number')
              or (matched.c->>'kind'='text' and pg_catalog.jsonb_typeof(cell.value)<>'string')
              or (matched.c->>'kind'='number' and pg_catalog.jsonb_typeof(cell.value)<>'number')
            ))) then raise exception using errcode='P1C01',
          message='Drawing table cells are invalid'; end if;
      if v_previous is null then insert into public.lukas_drawing_tables(id,revision_id,project_id,name,
        columns_json,rows_json,version,created_by) values(v_id,p_revision_id,v_revision.project_id,
          v_entity->>'name',v_entity->'columns',v_entity->'rows',v_new_version,v_actor);
      else update public.lukas_drawing_tables set name=v_entity->>'name',columns_json=v_entity->'columns',
        rows_json=v_entity->'rows',version=v_new_version where id=v_id; end if;
    elsif v_kind='delete_table' then delete from public.lukas_drawing_tables where id=v_id;
    elsif v_kind='delete_object' then
      if exists(select 1 from public.lukas_drawing_property_values where object_id=v_id)
        or exists(select 1 from public.lukas_drawing_tables t
          cross join lateral pg_catalog.jsonb_array_elements(t.rows_json) r
          where t.revision_id=p_revision_id and r->>'objectId'=v_id::text) then
        raise exception using errcode='P1C01',message='Referenced drawing object cannot be converted'; end if;
      update public.lukas_drawing_objects set status='deleted',version=v_new_version,updated_by=v_actor where id=v_id;
    elsif v_kind='put_object' then
      select * into v_layer from public.lukas_drawing_layers l where l.id=(v_entity->>'layerId')::uuid
        and l.revision_id=p_revision_id and l.project_id=v_revision.project_id and not l.locked for key share;
      if not found then raise exception using errcode='P1R01',message='Drawing structure reference is unavailable'; end if;
      update public.lukas_drawing_objects set layer_id=v_layer.id,page_id=v_layer.page_id,
        name=v_entity->>'name',object_type=v_entity->'geometry'->>'type',geometry=v_entity->'geometry',
        style_id=nullif(v_entity->>'styleId','')::uuid,style=v_entity->'style',status='active',
        version=v_new_version,updated_by=v_actor where id=v_id and status='deleted';
      if not found then raise exception using errcode='P1C01',message='Drawing object tombstone is unavailable'; end if;
    end if;
    v_result_versions:=v_result_versions||pg_catalog.jsonb_build_object(v_id::text,
      case when v_kind like 'delete\_%' then null else v_new_version end);
  end loop;

  if v_expected_bases is distinct from p_base_versions then
    raise exception using errcode='P1C01',message='Drawing structure base versions are incomplete'; end if;
  if exists(select 1 from public.lukas_drawing_pages p where p.revision_id=p_revision_id and (
      (select pg_catalog.count(*) from public.lukas_drawing_canvases c where c.page_id=p.id)=0
      or (select pg_catalog.count(*) from public.lukas_drawing_canvases c
        where c.page_id=p.id and c.space_kind='paper' and c.sort_order=0)<>1)) then
    raise exception using errcode='P1C01',message='Every page requires exactly one default paper canvas'; end if;
  if exists(select 1 from public.lukas_drawing_canvases c where c.revision_id=p_revision_id
      and not exists(select 1 from public.lukas_drawing_layers l where l.canvas_id=c.id
        and l.system_kind<>'source' and l.visible and not l.locked)) then
    raise exception using errcode='P1C01',message='Every canvas requires a visible unlocked layer'; end if;
  select coalesce(pg_catalog.max(o.sequence),0)+1 into v_sequence
    from public.lukas_drawing_operations o where o.revision_id=p_revision_id;
  insert into public.lukas_drawing_operations(revision_id,project_id,sequence,client_operation_id,
    operation_type,base_versions,forward,inverse,result_versions,actor_id)
    values(p_revision_id,v_revision.project_id,v_sequence,p_client_operation_id,p_operation_type,
      p_base_versions,p_forward,p_inverse,v_result_versions,v_actor) returning id into v_operation_id;
  return pg_catalog.jsonb_build_object('operationId',v_operation_id,'sequence',v_sequence,
    'resultVersions',v_result_versions);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' then raise;
  when unique_violation or foreign_key_violation or check_violation or not_null_violation then
    raise exception using errcode='P1C01',message=sqlerrm;
  when raise_exception then raise exception using errcode='P1R01',message=sqlerrm;
end;
$$;

alter function private.lukas_drawing_request_review(uuid)
  rename to lukas_drawing_request_review_pre_p2;

create or replace function private.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype;
  v_snapshot jsonb; v_sha256 text; v_operation_sequence bigint; v_snapshot_id uuid;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
    where r.id=p_revision_id and v_actor is not null
      and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
    for update;
  if not found then raise exception using errcode='P1R01',
    message='Drawing revision target is unavailable'; end if;
  if v_revision.status<>'draft' then raise exception using errcode='P1C01',
    message='Only a draft drawing revision can request review'; end if;
  if exists(
    select 1 from public.lukas_drawing_property_schemas s
    where s.revision_id=p_revision_id and s.required and (
      exists(select 1 from public.lukas_drawing_objects o
        where o.revision_id=p_revision_id and o.status='active'
          and s.applies_to @> pg_catalog.jsonb_build_array(o.object_type)
          and not exists(select 1 from public.lukas_drawing_property_values v
            where v.schema_id=s.id and v.object_id=o.id
              and pg_catalog.jsonb_typeof(v.value)<>'null'))
      or exists(select 1 from public.lukas_drawing_block_instances i
        where i.revision_id=p_revision_id
          and s.applies_to @> '["block_instance"]'::jsonb
          and not exists(select 1 from public.lukas_drawing_property_values v
            where v.schema_id=s.id and v.block_instance_id=i.id
              and pg_catalog.jsonb_typeof(v.value)<>'null'))
    )
  ) then raise exception using errcode='P1C01',
    message='Required drawing property values are incomplete'; end if;
  select coalesce(pg_catalog.max(o.sequence),0) into v_operation_sequence
    from public.lukas_drawing_operations o where o.revision_id=p_revision_id;
  v_snapshot:=pg_catalog.jsonb_build_object(
    'schemaVersion', 2,
    'revision',pg_catalog.jsonb_build_object('id',v_revision.id,'documentId',v_revision.document_id,
      'projectId',v_revision.project_id,'sequence',v_revision.sequence,'version',v_revision.version),
    'sources',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',s.id,'objectId',s.object_id,'sourceFileId',s.source_file_id,'sourceSha256',s.source_sha256,
      'sourceKind',s.source_kind,'pdfPageNumber',s.pdf_page_number,'x',s.x,'y',s.y,
      'width',s.width,'height',s.height,'elementId',s.element_id,'ifcGlobalId',s.ifc_global_id,
      'camera',s.camera_json) order by s.id)
      from public.lukas_drawing_object_sources s where s.revision_id=p_revision_id),'[]'::jsonb),
    'pages',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',p.id,'revisionId',p.revision_id,'name',p.name,'sortOrder',p.sort_order,
      'version',p.version) order by p.sort_order,p.id)
      from public.lukas_drawing_pages p where p.revision_id=p_revision_id),'[]'::jsonb),
    'canvases',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',c.id,'pageId',c.page_id,'name',c.name,'spaceKind',c.space_kind,
      'widthMillimeters',c.width_mm,'heightMillimeters',c.height_mm,
      'background',case when c.background_source_file_id is null then null else
        pg_catalog.jsonb_build_object('sourceFileId',c.background_source_file_id,
          'sourceSha256',c.background_source_sha256,'pdfPageNumber',c.background_pdf_page,
          'calibration',c.calibration) end,'sortOrder',c.sort_order,'version',c.version)
      order by p.sort_order,c.sort_order,c.id)
      from public.lukas_drawing_canvases c join public.lukas_drawing_pages p on p.id=c.page_id
      where c.revision_id=p_revision_id),'[]'::jsonb),
    'layers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',l.id,'pageId',l.page_id,'canvasId',l.canvas_id,'name',l.name,'sortOrder',l.sort_order,
      'visible',l.visible,'locked',l.locked,'systemKind',l.system_kind,'version',l.version)
      order by p.sort_order,c.sort_order,l.sort_order,l.id)
      from public.lukas_drawing_layers l join public.lukas_drawing_canvases c on c.id=l.canvas_id
      join public.lukas_drawing_pages p on p.id=l.page_id where l.revision_id=p_revision_id),'[]'::jsonb),
    'objects',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',o.id,'lineageId',o.lineage_id,'pageId',o.page_id,'layerId',o.layer_id,
      'name',o.name,'type',o.object_type,'geometry',o.geometry,'styleId',o.style_id,
      'style',o.style,'version',o.version) order by o.id)
      from public.lukas_drawing_objects o where o.revision_id=p_revision_id and o.status='active'),'[]'::jsonb),
    'styles',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',s.id,'revisionId',s.revision_id,'name',s.name,'value',s.value,'version',s.version) order by s.id)
      from public.lukas_drawing_styles s where s.revision_id=p_revision_id),'[]'::jsonb),
    'blocks',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',b.id,'revisionId',b.revision_id,'name',b.name,'primitives',b.primitives,'version',b.version) order by b.id)
      from public.lukas_drawing_blocks b where b.revision_id=p_revision_id),'[]'::jsonb),
    'blockInstances',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',i.id,'blockId',i.block_id,'layerId',i.layer_id,'name',i.name,'origin',i.origin,
      'rotation',i.rotation,'scaleX',i.scale_x,'scaleY',i.scale_y,'version',i.version) order by i.id)
      from public.lukas_drawing_block_instances i where i.revision_id=p_revision_id),'[]'::jsonb),
    'propertySchemas',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',s.id,'revisionId',s.revision_id,'name',s.name,'valueType',s.value_type,
      'enumOptions',s.enum_options,'appliesTo',s.applies_to,'required',s.required,'version',s.version) order by s.id)
      from public.lukas_drawing_property_schemas s where s.revision_id=p_revision_id),'[]'::jsonb),
    'propertyValues',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',v.id,'schemaId',v.schema_id,'objectId',v.object_id,'blockInstanceId',v.block_instance_id,
      'value',v.value,'version',v.version) order by v.id)
      from public.lukas_drawing_property_values v where v.revision_id=p_revision_id),'[]'::jsonb),
    'tables',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',t.id,'revisionId',t.revision_id,'name',t.name,'columns',t.columns_json,
      'rows',t.rows_json,'version',t.version) order by t.id)
      from public.lukas_drawing_tables t where t.revision_id=p_revision_id),'[]'::jsonb),
    'issues',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id',l.issue_id,'objectId',l.object_id) order by l.issue_id,l.object_id)
      from public.lukas_drawing_object_issue_links l where l.revision_id=p_revision_id),'[]'::jsonb),
    'operationSequence',v_operation_sequence);
  v_sha256:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  insert into public.lukas_drawing_snapshots(revision_id,project_id,revision_version,
    operation_sequence,canonical_json,sha256,schema_version,created_by)
    values(p_revision_id,v_revision.project_id,v_revision.version,v_operation_sequence,
      v_snapshot,v_sha256,2,v_actor) returning id into v_snapshot_id;
  update public.lukas_drawing_revisions set status='review_requested',
    review_requested_at=pg_catalog.now(),updated_at=pg_catalog.now() where id=p_revision_id;
  return pg_catalog.jsonb_build_object('snapshotId',v_snapshot_id,'subjectVersion',v_revision.version,
    'snapshotSha256',v_sha256,'operationSequence',v_operation_sequence);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' then raise;
  when raise_exception then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create or replace function private.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid()); v_source_revision public.lukas_drawing_revisions%rowtype;
  v_project_id uuid; v_snapshot public.lukas_drawing_snapshots%rowtype;
  v_file public.lukas_qto_files%rowtype; v_document_id uuid; v_revision_id uuid;
  v_page_map jsonb:='{}'::jsonb; v_canvas_map jsonb:='{}'::jsonb; v_layer_map jsonb:='{}'::jsonb;
  v_style_map jsonb:='{}'::jsonb; v_block_map jsonb:='{}'::jsonb; v_instance_map jsonb:='{}'::jsonb;
  v_object_map jsonb:='{}'::jsonb; v_schema_map jsonb:='{}'::jsonb;
  v_column_map jsonb:='{}'::jsonb;
  v_row record; v_new_id uuid; v_json jsonb; v_item jsonb;
  v_columns jsonb; v_rows jsonb; v_cells jsonb;
begin
  select r.* into v_source_revision from public.lukas_drawing_revisions r
    where r.id=p_source_revision_id for update;
  if not found then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  select d.project_id into v_project_id from public.lukas_drawing_documents d
    where d.id=v_source_revision.document_id for key share;
  if not found then
    raise exception using errcode='P1R01',message='Drawing template target is unavailable';
  end if;
  if v_actor is null or v_source_revision.project_id<>v_project_id
    or coalesce(private.lukas_drawing_workspace_capability(v_project_id),'')
      not in ('admin','editor')
    or v_source_revision.status<>'approved' then
    raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  if p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 240 then
    raise exception using errcode='P1C01',message='Drawing template title is required'; end if;
  select s.* into v_snapshot from public.lukas_drawing_snapshots s
    join public.lukas_drawing_revision_approvals a on a.revision_id=s.revision_id
      and a.project_id=s.project_id and a.subject_version=s.revision_version
      and a.snapshot_sha256=s.sha256 and a.decision='approved'
    where s.revision_id=p_source_revision_id and s.revision_version=v_source_revision.version;
  if not found then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  if p_source_file_id is not null then
    select * into v_file from public.lukas_qto_files f where f.id=p_source_file_id
      and f.project_id=v_project_id and f.immutable and f.kind in ('pdf','ifc') for key share;
    if not found or not (
      exists(select 1 from public.lukas_drawing_documents d
        where d.id=v_source_revision.document_id and d.project_id=v_project_id
          and d.source_file_id=p_source_file_id and d.source_sha256=v_file.sha256)
      or exists(select 1 from public.lukas_drawing_canvases c
        where c.revision_id=p_source_revision_id and c.project_id=v_project_id
          and c.background_source_file_id=p_source_file_id
          and c.background_source_sha256=v_file.sha256)
      or exists(select 1 from public.lukas_drawing_object_sources s
        where s.revision_id=p_source_revision_id and s.project_id=v_project_id
          and s.source_file_id=p_source_file_id and s.source_sha256=v_file.sha256)
    ) then raise exception using errcode='P1R01',message='Drawing template target is unavailable'; end if;
  end if;
  insert into public.lukas_drawing_documents(project_id,source_file_id,source_sha256,title,created_by)
    values(v_project_id,p_source_file_id,v_file.sha256,pg_catalog.btrim(p_title),v_actor)
    returning id into v_document_id;
  insert into public.lukas_drawing_revisions(document_id,project_id,sequence,status,version,created_by)
    values(v_document_id,v_project_id,1,'draft',1,v_actor) returning id into v_revision_id;

  for v_row in select * from public.lukas_drawing_pages where revision_id=p_source_revision_id
      order by sort_order,id loop
    v_new_id:=extensions.gen_random_uuid();
    v_page_map:=v_page_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_pages(id,revision_id,project_id,name,page_number,sort_order,version,
      width_mm,height_mm,background_source_file_id,background_source_sha256,background_pdf_page,calibration)
      values(v_new_id,v_revision_id,v_project_id,v_row.name,v_row.sort_order+1,v_row.sort_order,1,
        v_row.width_mm,v_row.height_mm,null,null,null,null);
  end loop;
  for v_row in select * from public.lukas_drawing_canvases where revision_id=p_source_revision_id
      order by sort_order,id loop
    v_new_id:=extensions.gen_random_uuid();
    v_canvas_map:=v_canvas_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_canvases(id,page_id,revision_id,project_id,name,space_kind,
      width_mm,height_mm,background_source_file_id,background_source_sha256,background_pdf_page,
      calibration,sort_order,version,created_by)
      values(v_new_id,(v_page_map->>v_row.page_id::text)::uuid,v_revision_id,v_project_id,
        v_row.name,v_row.space_kind,v_row.width_mm,v_row.height_mm,
        case when p_source_file_id=v_row.background_source_file_id then p_source_file_id end,
        case when p_source_file_id=v_row.background_source_file_id then v_file.sha256 end,
        case when p_source_file_id=v_row.background_source_file_id then v_row.background_pdf_page end,
        case when p_source_file_id=v_row.background_source_file_id then v_row.calibration end,
        v_row.sort_order,1,v_actor);
  end loop;
  for v_row in select * from public.lukas_drawing_layers where revision_id=p_source_revision_id
      order by sort_order,id loop
    v_new_id:=extensions.gen_random_uuid();
    v_layer_map:=v_layer_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_layers(id,page_id,canvas_id,revision_id,project_id,name,sort_order,
      visible,locked,system_kind,version,created_by)
      values(v_new_id,(v_page_map->>v_row.page_id::text)::uuid,
        (v_canvas_map->>v_row.canvas_id::text)::uuid,v_revision_id,v_project_id,v_row.name,
        v_row.sort_order,v_row.visible,v_row.locked,v_row.system_kind,1,v_actor);
  end loop;
  if v_snapshot.schema_version=2 then
    for v_row in select * from public.lukas_drawing_styles where revision_id=p_source_revision_id order by id loop
      v_new_id:=extensions.gen_random_uuid(); v_style_map:=v_style_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
      insert into public.lukas_drawing_styles(id,revision_id,project_id,name,value,version,created_by)
        values(v_new_id,v_revision_id,v_project_id,v_row.name,v_row.value,1,v_actor);
    end loop;
    for v_row in select * from public.lukas_drawing_blocks where revision_id=p_source_revision_id order by id loop
      v_new_id:=extensions.gen_random_uuid(); v_block_map:=v_block_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
      select pg_catalog.jsonb_agg(case when pg_catalog.jsonb_typeof(p->'styleId')='string'
        then pg_catalog.jsonb_set(p,'{styleId}',pg_catalog.to_jsonb((v_style_map->>(p->>'styleId'))::uuid)) else p end
        order by ord) into v_json from pg_catalog.jsonb_array_elements(v_row.primitives) with ordinality x(p,ord);
      insert into public.lukas_drawing_blocks(id,revision_id,project_id,name,primitives,version,created_by)
        values(v_new_id,v_revision_id,v_project_id,v_row.name,v_json,1,v_actor);
    end loop;
  end if;
  for v_row in select * from public.lukas_drawing_objects where revision_id=p_source_revision_id
      and status='active' order by id loop
    v_new_id:=extensions.gen_random_uuid(); v_object_map:=v_object_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_objects(id,lineage_id,page_id,layer_id,revision_id,project_id,
      name,object_type,geometry,style_id,style,status,version,created_by,updated_by)
      values(v_new_id,v_row.lineage_id,(v_page_map->>v_row.page_id::text)::uuid,
        (v_layer_map->>v_row.layer_id::text)::uuid,v_revision_id,v_project_id,v_row.name,
        v_row.object_type,v_row.geometry,case when v_row.style_id is null then null
          else (v_style_map->>v_row.style_id::text)::uuid end,v_row.style,'active',1,v_actor,v_actor);
  end loop;
  if p_source_file_id is not null then
    insert into public.lukas_drawing_object_sources(object_id,revision_id,project_id,source_file_id,
      source_sha256,source_kind,pdf_page_number,x,y,width,height,element_id,ifc_global_id,camera_json,created_by)
    select (v_object_map->>s.object_id::text)::uuid,v_revision_id,v_project_id,p_source_file_id,
      s.source_sha256,s.source_kind,s.pdf_page_number,s.x,s.y,s.width,s.height,s.element_id,
      s.ifc_global_id,s.camera_json,v_actor from public.lukas_drawing_object_sources s
      where s.revision_id=p_source_revision_id and s.source_file_id=p_source_file_id
        and s.source_sha256=v_file.sha256;
  end if;
  if v_snapshot.schema_version=2 then
    for v_row in select * from public.lukas_drawing_block_instances where revision_id=p_source_revision_id order by id loop
      v_new_id:=extensions.gen_random_uuid(); v_instance_map:=v_instance_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
      insert into public.lukas_drawing_block_instances(id,block_id,layer_id,revision_id,project_id,
        name,origin,rotation,scale_x,scale_y,version,created_by)
        values(v_new_id,(v_block_map->>v_row.block_id::text)::uuid,(v_layer_map->>v_row.layer_id::text)::uuid,
          v_revision_id,v_project_id,v_row.name,v_row.origin,v_row.rotation,v_row.scale_x,v_row.scale_y,1,v_actor);
    end loop;
    for v_row in select * from public.lukas_drawing_property_schemas where revision_id=p_source_revision_id order by id loop
      v_new_id:=extensions.gen_random_uuid(); v_schema_map:=v_schema_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
      insert into public.lukas_drawing_property_schemas(id,revision_id,project_id,name,value_type,
        enum_options,applies_to,required,version,created_by)
        values(v_new_id,v_revision_id,v_project_id,v_row.name,v_row.value_type,v_row.enum_options,
          v_row.applies_to,v_row.required,1,v_actor);
    end loop;
    for v_row in select * from public.lukas_drawing_property_values where revision_id=p_source_revision_id order by id loop
      insert into public.lukas_drawing_property_values(id,schema_id,object_id,block_instance_id,
        revision_id,project_id,value,version,created_by)
        values(extensions.gen_random_uuid(),(v_schema_map->>v_row.schema_id::text)::uuid,
          case when v_row.object_id is null then null else (v_object_map->>v_row.object_id::text)::uuid end,
          case when v_row.block_instance_id is null then null else (v_instance_map->>v_row.block_instance_id::text)::uuid end,
          v_revision_id,v_project_id,v_row.value,1,v_actor);
    end loop;
    for v_row in select * from public.lukas_drawing_tables where revision_id=p_source_revision_id order by id loop
      v_column_map:='{}'::jsonb; v_columns:='[]'::jsonb; v_rows:='[]'::jsonb;
      for v_item in select value from pg_catalog.jsonb_array_elements(v_row.columns_json) loop
        v_new_id:=extensions.gen_random_uuid();
        v_column_map:=v_column_map||pg_catalog.jsonb_build_object(v_item->>'id',v_new_id);
        v_item:=pg_catalog.jsonb_set(v_item,'{id}',pg_catalog.to_jsonb(v_new_id));
        if v_item->>'kind'='property' then
          v_item:=pg_catalog.jsonb_set(v_item,'{propertySchemaId}',
            pg_catalog.to_jsonb((v_schema_map->>(v_item->>'propertySchemaId'))::uuid));
        end if;
        v_columns:=v_columns||pg_catalog.jsonb_build_array(v_item);
      end loop;
      for v_item in select value from pg_catalog.jsonb_array_elements(v_row.rows_json) loop
        select coalesce(pg_catalog.jsonb_object_agg(v_column_map->>cell.key,cell.value),'{}'::jsonb)
          into v_cells from pg_catalog.jsonb_each(v_item->'cells') cell;
        v_item:=pg_catalog.jsonb_set(v_item,'{id}',pg_catalog.to_jsonb(extensions.gen_random_uuid()));
        v_item:=pg_catalog.jsonb_set(v_item,'{cells}',v_cells);
        if v_item->>'objectId' is not null then v_item:=pg_catalog.jsonb_set(v_item,'{objectId}',
          pg_catalog.to_jsonb((v_object_map->>(v_item->>'objectId'))::uuid)); end if;
        if v_item->>'blockInstanceId' is not null then v_item:=pg_catalog.jsonb_set(v_item,'{blockInstanceId}',
          pg_catalog.to_jsonb((v_instance_map->>(v_item->>'blockInstanceId'))::uuid)); end if;
        v_rows:=v_rows||pg_catalog.jsonb_build_array(v_item);
      end loop;
      insert into public.lukas_drawing_tables(id,revision_id,project_id,name,columns_json,rows_json,version,created_by)
        values(extensions.gen_random_uuid(),v_revision_id,v_project_id,v_row.name,v_columns,v_rows,1,v_actor);
    end loop;
  end if;
  return pg_catalog.jsonb_build_object('documentId',v_document_id,'revisionId',v_revision_id,
    'sourceRevisionId',p_source_revision_id);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' then raise;
  when unique_violation or foreign_key_violation or check_violation or not_null_violation then
    raise exception using errcode='P1C01',message=sqlerrm;
  when raise_exception then raise exception using errcode='P1R01',message=sqlerrm;
end;
$$;

create or replace function public.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid default null
) returns jsonb language sql security invoker set search_path='' as $$
  select private.lukas_drawing_create_from_template(p_source_revision_id,p_title,p_source_file_id)
$$;

revoke all on function private.lukas_drawing_create_document_pre_p2(uuid,uuid,text,boolean)
  from public,anon,authenticated;
revoke all on function private.lukas_drawing_apply_operation_pre_p2(uuid,uuid,text,jsonb,jsonb,jsonb)
  from public,anon,authenticated;
revoke all on function private.lukas_drawing_request_review_pre_p2(uuid)
  from public,anon,authenticated;
revoke all on function private.lukas_drawing_create_document(uuid,uuid,text,boolean) from public,anon;
revoke all on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon;
revoke all on function private.lukas_drawing_request_review(uuid) from public,anon;
revoke all on function private.lukas_drawing_create_from_template(uuid,text,uuid) from public,anon;
grant execute on function private.lukas_drawing_create_document(uuid,uuid,text,boolean)
  to authenticated,service_role;
grant execute on function private.lukas_drawing_apply_operation(uuid,uuid,text,jsonb,jsonb,jsonb)
  to authenticated,service_role;
grant execute on function private.lukas_drawing_request_review(uuid) to authenticated,service_role;
grant execute on function private.lukas_drawing_create_from_template(uuid,text,uuid)
  to authenticated,service_role;
revoke all on function public.lukas_drawing_create_from_template(uuid,text,uuid) from public,anon;
grant execute on function public.lukas_drawing_create_from_template(uuid,text,uuid)
  to authenticated,service_role;

revoke all on function private.lukas_drawing_style_override_valid(jsonb),
  private.lukas_drawing_p2_uuid(jsonb),
  private.lukas_drawing_p2_positive_integer(jsonb),
  private.lukas_drawing_p2_name(jsonb),
  private.lukas_drawing_p2_calibration_valid(jsonb),
  private.lukas_drawing_p2_property_value_valid(jsonb,text,jsonb),
  private.lukas_drawing_p2_block_primitives_valid(jsonb,uuid,uuid),
  private.lukas_drawing_p2_property_schema_json_valid(text,jsonb,jsonb),
  private.lukas_drawing_p2_child_guard(),
  private.lukas_drawing_canvas_guard(),
  private.lukas_drawing_style_guard(),
  private.lukas_drawing_block_guard(),
  private.lukas_drawing_property_schema_guard(),
  private.lukas_drawing_property_value_guard(),
  private.lukas_drawing_layer_canvas_fill(),
  private.lukas_drawing_structure_entity_json(text,uuid,uuid,uuid),
  private.lukas_drawing_structure_raw_id_exists(uuid),
  private.lukas_drawing_structure_raw_id_recorded(uuid,uuid),
  private.lukas_drawing_structure_tombstone(uuid,uuid,text),
  private.lukas_drawing_p2_number_close(double precision,double precision),
  private.lukas_drawing_p2_world_point_matches(jsonb,jsonb,jsonb,double precision,double precision,double precision),
  private.lukas_drawing_p2_world_geometry_matches(jsonb,jsonb,jsonb,double precision,double precision,double precision),
  private.lukas_drawing_structure_block_compound_valid(jsonb,uuid,uuid),
  private.lukas_drawing_structure_action_valid(jsonb,uuid)
from public,anon,authenticated;

commit;
