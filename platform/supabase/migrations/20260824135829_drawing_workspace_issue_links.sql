-- Object-to-issue provenance is append-only in P0/P1. Existing issue anchors
-- remain the authoritative source-location evidence and are not modified here.

create or replace function private.lukas_drawing_object_issue_link_insert_guard()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_capability text;
  v_revision_status text;
  v_object_status text;
  v_issue_project_id uuid;
begin
  v_capability := private.lukas_drawing_workspace_capability(new.project_id);
  if v_actor is null or v_capability is null
     or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  if new.created_by <> v_actor then
    raise exception 'Drawing issue link actor mismatch';
  end if;

  select r.status into v_revision_status
  from public.lukas_drawing_revisions r
  where r.id = new.revision_id and r.project_id = new.project_id
  for update;
  if v_revision_status is null then
    raise exception 'Drawing revision does not exist';
  end if;
  if v_revision_status <> 'draft' then
    raise exception 'Drawing issue link requires a draft revision';
  end if;

  select o.status into v_object_status
  from public.lukas_drawing_objects o
  where o.id = new.object_id
    and o.revision_id = new.revision_id
    and o.project_id = new.project_id;
  if v_object_status is null then
    raise exception 'Drawing object does not exist in the revision project';
  end if;
  if v_object_status <> 'active' then
    raise exception 'Drawing issue link requires an active object';
  end if;

  select i.project_id into v_issue_project_id
  from public.lukas_drawing_issues i
  where i.id = new.issue_id;
  if v_issue_project_id is null then
    raise exception 'Drawing issue does not exist';
  end if;
  if v_issue_project_id <> new.project_id then
    raise exception 'Drawing object and issue must belong to the same project';
  end if;
  return new;
end;
$$;

drop trigger if exists lukas_drawing_object_issue_links_insert_revision_guard
  on public.lukas_drawing_object_issue_links;
create trigger lukas_drawing_object_issue_links_insert_guard
before insert on public.lukas_drawing_object_issue_links
for each row execute function private.lukas_drawing_object_issue_link_insert_guard();

drop trigger if exists lukas_drawing_object_issue_links_revision_guard
  on public.lukas_drawing_object_issue_links;
drop trigger if exists lukas_drawing_object_issue_links_append_only
  on public.lukas_drawing_object_issue_links;
create trigger lukas_drawing_object_issue_links_append_only
before update or delete on public.lukas_drawing_object_issue_links
for each row execute function private.lukas_drawing_append_only_guard();

drop policy if exists "workspace editors add draft drawing object issue links"
  on public.lukas_drawing_object_issue_links;
drop policy if exists "workspace editors delete draft drawing object issue links"
  on public.lukas_drawing_object_issue_links;
revoke insert, update, delete on public.lukas_drawing_object_issue_links
  from authenticated;
grant select on public.lukas_drawing_object_issue_links to authenticated;

create or replace function public.lukas_drawing_link_object_issue(
  p_object_id uuid,
  p_issue_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_object record;
  v_revision record;
  v_issue_project_id uuid;
  v_capability text;
  v_link record;
begin
  if v_actor is null then
    raise exception 'Authenticated drawing editor required';
  end if;

  select o.id, o.revision_id, o.project_id, o.status
  into v_object
  from public.lukas_drawing_objects o
  where o.id = p_object_id;
  if v_object.id is null then
    raise exception 'Drawing object does not exist';
  end if;

  select r.id, r.project_id, r.status
  into v_revision
  from public.lukas_drawing_revisions r
  where r.id = v_object.revision_id
    and r.project_id = v_object.project_id
  for update;
  if v_revision.id is null then
    raise exception 'Drawing revision does not exist';
  end if;

  select o.id, o.revision_id, o.project_id, o.status
  into v_object
  from public.lukas_drawing_objects o
  where o.id = p_object_id
    and o.revision_id = v_revision.id
    and o.project_id = v_revision.project_id
  for update;
  if v_object.id is null then
    raise exception 'Drawing object does not exist';
  end if;
  if v_object.status <> 'active' then
    raise exception 'Drawing issue link requires an active object';
  end if;

  v_capability := private.lukas_drawing_workspace_capability(v_object.project_id);
  if v_capability is null or v_capability not in ('admin', 'editor') then
    raise exception 'Drawing workspace editor capability required';
  end if;
  if v_revision.status <> 'draft' then
    raise exception 'Drawing issue link requires a draft revision';
  end if;

  select i.project_id into v_issue_project_id
  from public.lukas_drawing_issues i
  where i.id = p_issue_id;
  if v_issue_project_id is null then
    raise exception 'Drawing issue does not exist';
  end if;
  if v_issue_project_id <> v_object.project_id then
    raise exception 'Drawing object and issue must belong to the same project';
  end if;

  insert into public.lukas_drawing_object_issue_links(
    object_id, revision_id, issue_id, project_id, created_by
  ) values (
    v_object.id, v_object.revision_id, p_issue_id, v_object.project_id, v_actor
  )
  on conflict (object_id, issue_id) do nothing;

  select l.id, l.object_id, l.issue_id, l.created_by, l.created_at
  into v_link
  from public.lukas_drawing_object_issue_links l
  where l.object_id = v_object.id and l.issue_id = p_issue_id;

  return pg_catalog.jsonb_build_object(
    'id', v_link.id,
    'objectId', v_link.object_id,
    'issueId', v_link.issue_id,
    'createdBy', v_link.created_by,
    'createdAt', v_link.created_at
  );
end;
$$;

revoke all on function private.lukas_drawing_object_issue_link_insert_guard()
  from public, anon, authenticated;
grant execute on function private.lukas_drawing_object_issue_link_insert_guard()
  to service_role;
revoke all on function public.lukas_drawing_link_object_issue(uuid, uuid)
  from public, anon;
grant execute on function public.lukas_drawing_link_object_issue(uuid, uuid)
  to authenticated, service_role;
