begin;

lock table public.lukas_drawing_objects,public.lukas_drawing_blocks
  in share row exclusive mode;

create or replace function private.lukas_drawing_geometry_valid(
  p_object_type text,p_geometry jsonb
) returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if private.lukas_drawing_geometry_valid_pre_p4_contract_fixes(
      p_object_type,p_geometry
    ) is not true then
    return false;
  end if;
  if p_object_type in ('line','polyline','rectangle','circle','text','dimension')
    and exists(
      select 1
      from pg_catalog.jsonb_path_query(
        p_geometry,'strict $.** ? (@.type() == "number")'
      ) value
      where private.lukas_drawing_p4_number_valid(value) is not true
    ) then
    return false;
  end if;
  if p_object_type<>'space' then return true; end if;
  return private.lukas_drawing_p4_utf16_string_valid(p_geometry->'number')
    and (pg_catalog.jsonb_typeof(p_geometry->'finishes'->'floor')='null'
      or private.lukas_drawing_p4_utf16_string_valid(
        p_geometry->'finishes'->'floor'
      ))
    and (pg_catalog.jsonb_typeof(p_geometry->'finishes'->'wall')='null'
      or private.lukas_drawing_p4_utf16_string_valid(
        p_geometry->'finishes'->'wall'
      ))
    and (pg_catalog.jsonb_typeof(p_geometry->'finishes'->'ceiling')='null'
      or private.lukas_drawing_p4_utf16_string_valid(
        p_geometry->'finishes'->'ceiling'
      ));
exception when others then return false;
end;
$$;

do $$
begin
  if exists(
      select 1 from public.lukas_drawing_objects o
      where o.object_type in (
          'line','polyline','rectangle','circle','text','dimension'
        )
        and private.lukas_drawing_geometry_valid(
          o.object_type,o.geometry
        ) is not true
    ) or exists(
      select 1
      from public.lukas_drawing_blocks b
      cross join lateral pg_catalog.jsonb_array_elements(b.primitives) p(value)
      where p.value->'geometry'->>'type' in (
          'line','polyline','rectangle','circle','text','dimension'
        )
        and private.lukas_drawing_geometry_valid(
          p.value->'geometry'->>'type',p.value->'geometry'
        ) is not true
    ) then
    raise exception using errcode='P1C01',
      message='Primitive geometry authority preflight failed';
  end if;
end;
$$;

create or replace function public.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode='P1R01',
      message='Drawing revision target is unavailable';
  end if;
  return private.lukas_drawing_apply_operation(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,p_history_action,p_original_operation_id
  );
exception when sqlstate 'P1R01' then
  if sqlerrm='Drawing operation domain JSON is invalid' then
    raise exception using errcode='P1C01',message=sqlerrm;
  end if;
  raise;
end;
$$;

create or replace function public.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language sql security invoker set search_path='' as $$
  select public.lukas_drawing_apply_operation(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,null::text,null::uuid
  )
$$;

revoke all on function private.lukas_drawing_geometry_valid(text,jsonb)
  from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
),public.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) from public,anon;
grant execute on function public.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
),public.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb
) to authenticated,service_role;

commit;
