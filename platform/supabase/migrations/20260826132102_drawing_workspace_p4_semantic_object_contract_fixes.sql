begin;

create function private.lukas_drawing_p4_utf16_string_valid(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
  v_text text; v_index integer:=1; v_units integer:=0; v_codepoint integer;
begin
  if pg_catalog.jsonb_typeof(p_value)<>'string' then return false; end if;
  v_text:=p_value#>>'{}';
  while v_index<=pg_catalog.char_length(v_text) loop
    v_codepoint:=pg_catalog.ascii(pg_catalog.substr(v_text,v_index,1));
    v_units:=v_units+case when v_codepoint>65535 then 2 else 1 end;
    if v_units>255 then return false; end if;
    v_index:=v_index+1;
  end loop;
  return true;
exception when others then return false;
end;
$$;

alter table public.lukas_drawing_objects
  add constraint lukas_drawing_objects_p4_utf16_strings_check check (
    object_type<>'space' or (
      private.lukas_drawing_p4_utf16_string_valid(geometry->'number')
      and (pg_catalog.jsonb_typeof(geometry->'finishes'->'floor')='null'
        or private.lukas_drawing_p4_utf16_string_valid(
          geometry->'finishes'->'floor'
        ))
      and (pg_catalog.jsonb_typeof(geometry->'finishes'->'wall')='null'
        or private.lukas_drawing_p4_utf16_string_valid(
          geometry->'finishes'->'wall'
        ))
      and (pg_catalog.jsonb_typeof(geometry->'finishes'->'ceiling')='null'
        or private.lukas_drawing_p4_utf16_string_valid(
          geometry->'finishes'->'ceiling'
        ))
    )
  );

alter function private.lukas_drawing_geometry_valid(text,jsonb)
  rename to lukas_drawing_geometry_valid_pre_p4_contract_fixes;
create function private.lukas_drawing_geometry_valid(
  p_object_type text,p_geometry jsonb
) returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if private.lukas_drawing_geometry_valid_pre_p4_contract_fixes(
      p_object_type,p_geometry
    ) is not true then
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

alter function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) rename to lukas_drawing_apply_operation_pre_p4_contract_fixes;
create function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_put_ids text[]; v_expected_put_bases jsonb; v_core_bases jsonb;
begin
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P1R01',
      message='Drawing revision target is unavailable';
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
  if found then
    return private.lukas_drawing_apply_operation_pre_p4_contract_fixes(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  if p_operation_type='mutate_objects_with_references'
    and p_forward->>'type'='mutate_objects_with_references'
    and pg_catalog.jsonb_typeof(p_forward->'actions')='array'
    and exists(
      select 1 from pg_catalog.jsonb_array_elements(p_forward->'actions') a
      where a->>'kind'='put_object'
    ) then
    select pg_catalog.array_agg(a.value->'entity'->>'id'),
      pg_catalog.jsonb_object_agg(
        a.value->'entity'->>'id',a.value->'baseVersion'
      )
      into v_put_ids,v_expected_put_bases
    from pg_catalog.jsonb_array_elements(p_forward->'actions') a(value)
    where a.value->>'kind'='put_object';
    v_core_bases:=p_base_versions-v_put_ids;
    if pg_catalog.jsonb_typeof(p_base_versions)<>'object'
      or p_base_versions is distinct from
        v_core_bases||v_expected_put_bases then
      raise exception using errcode='P1C01',
        message='Mixed drawing semantic base versions are not exact';
    end if;
  end if;
  return private.lukas_drawing_apply_operation_pre_p4_contract_fixes(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,p_history_action,p_original_operation_id
  );
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

revoke all on function
  private.lukas_drawing_p4_utf16_string_valid(jsonb),
  private.lukas_drawing_geometry_valid_pre_p4_contract_fixes(text,jsonb),
  private.lukas_drawing_geometry_valid(text,jsonb),
  private.lukas_drawing_apply_operation_pre_p4_contract_fixes(
    uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
  )
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) from public,anon;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) to authenticated,service_role;

commit;
