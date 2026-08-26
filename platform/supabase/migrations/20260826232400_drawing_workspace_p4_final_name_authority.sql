begin;

create function private.lukas_drawing_p4_array_names_valid(
  p_values jsonb,
  p_name_key text
)
returns boolean
language plpgsql immutable security invoker set search_path = ''
as $$
declare
  v_value jsonb;
  v_name jsonb;
begin
  if pg_catalog.jsonb_typeof(p_values) <> 'array' then return false; end if;
  for v_value in
    select value from pg_catalog.jsonb_array_elements(p_values)
  loop
    v_name := case
      when p_name_key is null then v_value
      when pg_catalog.jsonb_typeof(v_value) = 'object'
        then v_value -> p_name_key
      else null
    end;
    if private.lukas_drawing_p2_name(v_name) is not true then return false; end if;
  end loop;
  return true;
exception when others then return false;
end;
$$;

do $$
declare
  v_consumer text;
begin
  select invalid.consumer into v_consumer
  from (
    select 'page' consumer from public.lukas_drawing_pages
      where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is not true
    union all
    select 'canvas' from public.lukas_drawing_canvases
      where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is not true
    union all
    select 'layer' from public.lukas_drawing_layers
      where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is not true
    union all
    select 'object' from public.lukas_drawing_objects
      where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is not true
    union all
    select 'style' from public.lukas_drawing_styles
      where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is not true
    union all
    select 'block' from public.lukas_drawing_blocks
      where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is not true
    union all
    select 'block primitive' from public.lukas_drawing_blocks
      where private.lukas_drawing_p4_array_names_valid(primitives, 'name') is not true
    union all
    select 'block instance' from public.lukas_drawing_block_instances
      where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is not true
    union all
    select 'property schema' from public.lukas_drawing_property_schemas
      where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is not true
    union all
    select 'enum option' from public.lukas_drawing_property_schemas
      where private.lukas_drawing_p4_array_names_valid(enum_options, null) is not true
    union all
    select 'table' from public.lukas_drawing_tables
      where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is not true
    union all
    select 'table column' from public.lukas_drawing_tables
      where private.lukas_drawing_p4_array_names_valid(columns_json, 'name') is not true
  ) invalid
  limit 1;
  if v_consumer is not null then
    raise exception using
      errcode = 'P1C01',
      message = 'Invalid persisted drawing name exists before P4 final name authority: '
        || v_consumer;
  end if;
end;
$$;

alter table public.lukas_drawing_pages
  drop constraint if exists lukas_drawing_pages_name_check,
  drop constraint if exists lukas_drawing_pages_name_contract,
  add constraint lukas_drawing_pages_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  );
alter table public.lukas_drawing_canvases
  drop constraint if exists lukas_drawing_canvases_name_contract,
  add constraint lukas_drawing_canvases_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  );
alter table public.lukas_drawing_layers
  drop constraint if exists lukas_drawing_layers_name_contract,
  add constraint lukas_drawing_layers_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  );
alter table public.lukas_drawing_objects
  drop constraint if exists lukas_drawing_objects_name_contract,
  add constraint lukas_drawing_objects_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  );
alter table public.lukas_drawing_styles
  drop constraint if exists lukas_drawing_styles_name_contract,
  add constraint lukas_drawing_styles_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  );
alter table public.lukas_drawing_blocks
  drop constraint if exists lukas_drawing_blocks_name_contract,
  drop constraint if exists lukas_drawing_blocks_primitive_names_contract,
  add constraint lukas_drawing_blocks_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  ),
  add constraint lukas_drawing_blocks_primitive_names_contract check (
    private.lukas_drawing_p4_array_names_valid(primitives, 'name') is true
  );
alter table public.lukas_drawing_block_instances
  drop constraint if exists lukas_drawing_block_instances_name_contract,
  add constraint lukas_drawing_block_instances_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  );
alter table public.lukas_drawing_property_schemas
  drop constraint if exists lukas_drawing_property_schemas_name_contract,
  drop constraint if exists lukas_drawing_property_schemas_enum_option_names_contract,
  add constraint lukas_drawing_property_schemas_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  ),
  add constraint lukas_drawing_property_schemas_enum_option_names_contract check (
    private.lukas_drawing_p4_array_names_valid(enum_options, null) is true
  );
alter table public.lukas_drawing_tables
  drop constraint if exists lukas_drawing_tables_name_contract,
  drop constraint if exists lukas_drawing_tables_column_names_contract,
  add constraint lukas_drawing_tables_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  ),
  add constraint lukas_drawing_tables_column_names_contract check (
    private.lukas_drawing_p4_array_names_valid(columns_json, 'name') is true
  );

revoke all on function
  private.lukas_drawing_p4_array_names_valid(jsonb,text)
from public, anon, authenticated, service_role;

commit;
