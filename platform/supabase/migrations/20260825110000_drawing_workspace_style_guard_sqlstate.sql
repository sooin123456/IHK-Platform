-- Keep the referenced-style delete denial distinguishable from unexpected RPC errors.
create or replace function private.lukas_drawing_style_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()<=1 and (
    exists(select 1 from public.lukas_drawing_objects o where o.style_id=old.id and o.status='active')
    or exists(select 1 from public.lukas_drawing_blocks b
      cross join lateral pg_catalog.jsonb_array_elements(b.primitives) p
      where b.revision_id=old.revision_id and p->>'styleId'=old.id::text)
  ) then
    raise exception using errcode='P1C01', message='Referenced drawing style cannot be deleted';
  end if;
  if tg_op<>'DELETE' and private.lukas_drawing_style_valid(new.value) is not true then
    raise exception 'Drawing style definition is invalid';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
