begin;

-- Required string values must contain visible content before a draft can
-- become an immutable review snapshot. Existing drafts and approved snapshots
-- are not rewritten; this guard applies only when review is requested.
alter function private.lukas_drawing_request_review(uuid)
  rename to lukas_drawing_request_review_pre_required_blank;

create function private.lukas_drawing_request_review(p_revision_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  perform 1
  from public.lukas_drawing_revisions r
  where r.id = p_revision_id
    and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin', 'editor')
  for update;

  if not found then
    raise exception using
      errcode = 'P1R01',
      message = 'Drawing revision target is unavailable';
  end if;

  if exists (
    select 1
    from public.lukas_drawing_property_schemas s
    where s.revision_id = p_revision_id
      and s.required
      and (
        exists (
          select 1
          from public.lukas_drawing_objects o
          where o.revision_id = p_revision_id
            and o.status = 'active'
            and s.applies_to @> pg_catalog.jsonb_build_array(o.object_type)
            and not exists (
              select 1
              from public.lukas_drawing_property_values v
              where v.schema_id = s.id
                and v.object_id = o.id
                and pg_catalog.jsonb_typeof(v.value) <> 'null'
                and private.lukas_drawing_p2_property_value_valid(
                  v.value,
                  s.value_type,
                  s.enum_options
                ) is true
                and (
                  s.value_type <> 'text'
                  or pg_catalog.btrim(
                    v.value #>> '{}', E' \t\n\r\f\v'
                  ) <> ''
                )
            )
        )
        or exists (
          select 1
          from public.lukas_drawing_block_instances i
          where i.revision_id = p_revision_id
            and s.applies_to @> '["block_instance"]'::jsonb
            and not exists (
              select 1
              from public.lukas_drawing_property_values v
              where v.schema_id = s.id
                and v.block_instance_id = i.id
                and pg_catalog.jsonb_typeof(v.value) <> 'null'
                and private.lukas_drawing_p2_property_value_valid(
                  v.value,
                  s.value_type,
                  s.enum_options
                ) is true
                and (
                  s.value_type <> 'text'
                  or pg_catalog.btrim(
                    v.value #>> '{}', E' \t\n\r\f\v'
                  ) <> ''
                )
            )
        )
      )
  ) then
    raise exception using
      errcode = 'P1C01',
      message = 'Required drawing property values are incomplete';
  end if;

  return private.lukas_drawing_request_review_pre_required_blank(
    p_revision_id
  );
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when others then
    raise exception using errcode = 'P1C01', message = sqlerrm;
end;
$$;

revoke all on function
  private.lukas_drawing_request_review_pre_required_blank(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.lukas_drawing_request_review(uuid)
from public, anon, authenticated, service_role;

alter default privileges revoke execute on functions from public;

commit;
