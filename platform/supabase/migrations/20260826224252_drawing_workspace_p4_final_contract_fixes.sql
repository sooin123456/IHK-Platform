begin;

create function private.lukas_drawing_p4_js_trim_codepoint(p_codepoint integer)
returns boolean language sql immutable security invoker set search_path='' as $$
  select p_codepoint in (
    9,10,11,12,13,32,160,5760,
    8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,
    8232,8233,8239,8287,12288,65279
  )
$$;

create or replace function private.lukas_drawing_p2_name(p_value jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare
  v_text text;
  v_length integer;
begin
  if pg_catalog.jsonb_typeof(p_value)<>'string'
    or private.lukas_drawing_p4_utf16_string_valid(p_value) is not true then
    return false;
  end if;
  v_text:=p_value#>>'{}';
  v_length:=pg_catalog.char_length(v_text);
  if v_length=0 then return false; end if;
  return private.lukas_drawing_p4_js_trim_codepoint(
      pg_catalog.ascii(pg_catalog.substr(v_text,1,1))
    ) is not true
    and private.lukas_drawing_p4_js_trim_codepoint(
      pg_catalog.ascii(pg_catalog.substr(v_text,v_length,1))
    ) is not true;
exception when others then return false;
end;
$$;

do $$
begin
  if exists(
    select 1 from public.lukas_drawing_objects o
    where private.lukas_drawing_p2_name(pg_catalog.to_jsonb(o.name)) is not true
  ) then
    raise exception using errcode='P1C01',
      message='Invalid drawing object name exists before P4 final contract fixes';
  end if;
end;
$$;

alter table public.lukas_drawing_objects
  drop constraint if exists lukas_drawing_objects_name_contract;
alter table public.lukas_drawing_objects
  add constraint lukas_drawing_objects_name_contract check (
    private.lukas_drawing_p2_name(pg_catalog.to_jsonb(name)) is true
  );

revoke all on function
  private.lukas_drawing_p4_js_trim_codepoint(integer),
  private.lukas_drawing_p2_name(jsonb)
from public,anon,authenticated,service_role;

commit;
