-- Preserve immutable drawing documents for ordinary callers while allowing
-- the already-authorized retention RPC to complete its nested project cascade.

create or replace function private.lukas_drawing_document_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_owner name;
  v_marker text;
begin
  if tg_op = 'DELETE'
    and pg_catalog.pg_trigger_depth() > 1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project', true
    ) = old.project_id::text
    and current_user = pg_catalog.pg_get_userbyid(
      (select c.relowner from pg_catalog.pg_class c where c.oid = tg_relid)
    )
    and not exists(
      select 1 from public.lukas_qto_projects p
      where p.id = old.project_id
    ) then return old;
  end if;

  select pg_catalog.pg_get_userbyid(c.relowner) into v_owner
  from pg_catalog.pg_class c
  where c.oid = tg_relid;

  if tg_op = 'INSERT' then
    if v_actor is null or new.created_by <> v_actor then
      raise exception 'Drawing document creator must be the authenticated user';
    end if;
    if new.creation_request_id is not null
      or new.creation_request_sha256 is not null then
      raise exception using errcode = 'P1C01',
        message = 'Drawing document creation identity is immutable';
    end if;
  elsif tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at then
      raise exception 'Drawing document identity is immutable';
    end if;
    if new.creation_request_id is distinct from old.creation_request_id
      or new.creation_request_sha256 is distinct from old.creation_request_sha256 then
      v_marker := pg_catalog.current_setting(
        'lukas.drawing_creation_identity', true
      );
      if old.creation_request_id is not null
        or old.creation_request_sha256 is not null
        or new.creation_request_id is null
        or new.creation_request_sha256 is null
        or current_user <> v_owner
        or v_marker is distinct from
          old.id::text || ':' || new.creation_request_id::text || ':' ||
            new.creation_request_sha256 then
        raise exception using errcode = 'P1C01',
          message = 'Drawing document creation identity is immutable';
      end if;
    end if;
  end if;

  if tg_op <> 'INSERT' and exists(
    select 1
    from public.lukas_drawing_revisions r
    where r.document_id = old.id and r.status <> 'draft'
  ) then
    raise exception 'Drawing document with a non-draft revision is immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.source_file_id is not null and not exists(
    select 1
    from public.lukas_qto_files f
    where f.id = new.source_file_id
      and f.project_id = new.project_id
      and f.sha256 = new.source_sha256
      and f.kind in ('pdf', 'ifc')
      and f.immutable
  ) then
    raise exception 'Drawing source must be an immutable PDF or IFC from the project';
  end if;
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

revoke all on function private.lukas_drawing_document_guard()
  from public, anon, authenticated, service_role;

