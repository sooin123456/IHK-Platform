begin;

-- Project retention is service-only and marks the transaction immediately before
-- deleting the project.  Drawing child guards must allow that already-authorized
-- foreign-key cascade after the project row is gone, without opening direct or
-- ordinary nested drawing deletes.
create or replace function private.lukas_drawing_draft_child_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_old jsonb := pg_catalog.to_jsonb(old);
  v_new jsonb := pg_catalog.to_jsonb(new);
  v_revision_id uuid := (v_old ->> 'revision_id')::uuid;
  v_project_id uuid := (v_old ->> 'project_id')::uuid;
  v_status text;
  v_actor uuid := (select auth.uid());
  v_capability text;
begin
  if tg_op = 'DELETE'
     and pg_catalog.pg_trigger_depth() > 1
     and pg_catalog.current_setting(
       'app.lukas_retention_purge_project', true
     ) = old.project_id::text
     and not exists (
       select 1 from public.lukas_qto_projects p
       where p.id = old.project_id
     ) then
    return old;
  end if;
  v_capability := private.lukas_drawing_workspace_capability(v_project_id);
  if v_actor is null or v_capability is null
     or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
  select r.status into v_status
  from public.lukas_drawing_revisions r
  where r.id = v_revision_id and r.project_id = v_project_id
  for update;
  if v_status is null then
    raise exception 'Drawing revision does not exist';
  end if;
  if v_status <> 'draft' then
    raise exception 'Approved drawing revision is immutable';
  end if;
  if tg_op = 'UPDATE'
     and ((v_new ->> 'revision_id') is distinct from (v_old ->> 'revision_id')
       or (v_new ->> 'project_id') is distinct from (v_old ->> 'project_id')) then
    raise exception 'Drawing child revision identity is immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.lukas_drawing_layer_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_tombstone jsonb;
begin
  if tg_op='DELETE'
    and pg_catalog.pg_trigger_depth()>1
    and pg_catalog.current_setting(
      'app.lukas_retention_purge_project',true
    )=old.project_id::text
    and not exists(
      select 1 from public.lukas_qto_projects p
      where p.id=old.project_id
    ) then return old; end if;
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if tg_op='INSERT' then
    if current_user='authenticated' and new.system_kind<>'custom' then
      raise exception 'Only custom drawing layers may be inserted directly'; end if;
    v_tombstone:=private.lukas_drawing_structure_tombstone(new.revision_id,new.id,'put_layer');
    if new.created_by<>v_actor or not (
      new.version=1 or (v_tombstone is not null
        and new.version=(v_tombstone->>'version')::bigint+2)
    ) then
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
    if new.canvas_id is distinct from old.canvas_id and not exists(
      select 1 from public.lukas_drawing_layers l where l.canvas_id=old.canvas_id
        and l.id<>old.id and l.system_kind<>'source' and l.visible and not l.locked
    ) then raise exception 'The previous canvas must retain an editable layer'; end if;
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

revoke all on function private.lukas_drawing_draft_child_guard(),
  private.lukas_drawing_layer_guard()
from public,anon,authenticated,service_role;

commit;
