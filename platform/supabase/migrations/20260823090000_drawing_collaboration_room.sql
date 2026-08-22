-- 1HK drawing collaboration room: immutable anchors/comments/events with project RLS.
alter table public.lukas_qto_files
  drop constraint if exists lukas_qto_files_kind_check;
alter table public.lukas_qto_files
  add constraint lukas_qto_files_kind_check check (
    kind in (
      'ifc','pdf','qto_csv','element_ledger','formwork_ledger',
      'estimate','mapping','other'
    )
  );

update storage.buckets
set allowed_mime_types = array(
  select distinct mime
  from unnest(coalesce(allowed_mime_types, '{}'::text[]) || array['application/pdf']) mime
  order by mime
)
where id = 'lukas-qto';

create table public.lukas_drawing_issues (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 240),
  description text not null default '' check (char_length(description) <= 10000),
  priority text not null default 'normal'
    check (priority in ('low','normal','high','urgent')),
  status text not null default 'open'
    check (status in ('open','in_progress','resolution_requested','closed')),
  assignee_user_id uuid references auth.users(id) on delete restrict,
  due_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  closed_by uuid references auth.users(id) on delete restrict,
  closed_at timestamptz,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id),
  check ((status = 'closed') = (closed_by is not null and closed_at is not null))
);

create table public.lukas_drawing_issue_anchors (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  file_id uuid not null references public.lukas_qto_files(id) on delete restrict,
  anchor_kind text not null check (anchor_kind in ('ifc_element','pdf_region')),
  element_id text,
  ifc_global_id text,
  camera_json jsonb,
  page_number integer,
  x numeric(12,10),
  y numeric(12,10),
  width numeric(12,10),
  height numeric(12,10),
  label text not null default '' check (char_length(label) <= 240),
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  deactivated_by uuid references auth.users(id) on delete restrict,
  deactivated_at timestamptz,
  deactivation_note text check (deactivation_note is null or char_length(deactivation_note) between 1 and 1000),
  constraint lukas_drawing_anchor_issue_fkey
    foreign key (issue_id, project_id)
    references public.lukas_drawing_issues(id, project_id) on delete cascade,
  check ((active and deactivated_by is null and deactivated_at is null and deactivation_note is null)
    or (not active and deactivated_by is not null and deactivated_at is not null and deactivation_note is not null)),
  check (
    (anchor_kind = 'ifc_element'
      and element_id is not null and char_length(trim(element_id)) between 1 and 128
      and (ifc_global_id is null or ifc_global_id ~ '^[0-9A-Za-z_$]{22}$')
      and jsonb_typeof(camera_json) = 'object'
      and page_number is null and x is null and y is null and width is null and height is null)
    or
    (anchor_kind = 'pdf_region'
      and element_id is null and ifc_global_id is null and camera_json is null
      and page_number > 0
      and x >= 0 and y >= 0 and width > 0 and height > 0
      and x + width <= 1 and y + height <= 1)
  )
);

create table public.lukas_drawing_issue_comments (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (char_length(trim(body)) between 1 and 10000),
  created_at timestamptz not null default now(),
  constraint lukas_drawing_comment_issue_fkey
    foreign key (issue_id, project_id)
    references public.lukas_drawing_issues(id, project_id) on delete cascade
);

create table public.lukas_drawing_issue_events (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete restrict,
  event_type text not null check (event_type in (
    'created','status_changed','assignee_changed','due_changed','priority_changed',
    'anchor_added','anchor_deactivated','comment_added'
  )),
  from_value jsonb,
  to_value jsonb,
  note text not null default '' check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  constraint lukas_drawing_event_issue_fkey
    foreign key (issue_id, project_id)
    references public.lukas_drawing_issues(id, project_id) on delete cascade
);

create table public.lukas_drawing_notifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  issue_id uuid not null,
  event_id uuid not null references public.lukas_drawing_issue_events(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, user_id),
  constraint lukas_drawing_notification_issue_fkey
    foreign key (issue_id, project_id)
    references public.lukas_drawing_issues(id, project_id) on delete cascade
);

create index lukas_drawing_issues_project_status_idx
  on public.lukas_drawing_issues(project_id, status, updated_at desc);
create index lukas_drawing_issues_assignee_status_idx
  on public.lukas_drawing_issues(assignee_user_id, status, updated_at desc)
  where assignee_user_id is not null;
create index lukas_drawing_anchors_issue_active_idx
  on public.lukas_drawing_issue_anchors(issue_id, active, created_at);
create index lukas_drawing_anchors_file_idx
  on public.lukas_drawing_issue_anchors(file_id, issue_id);
create index lukas_drawing_comments_issue_created_idx
  on public.lukas_drawing_issue_comments(issue_id, created_at);
create index lukas_drawing_events_issue_created_idx
  on public.lukas_drawing_issue_events(issue_id, created_at);
create index lukas_drawing_notifications_user_unread_idx
  on public.lukas_drawing_notifications(user_id, created_at desc)
  where read_at is null;

create or replace function private.lukas_drawing_transition_allowed(
  p_role text,
  p_old_status text,
  p_new_status text
) returns boolean
language sql immutable set search_path = ''
as $$
  select case
    when p_old_status = p_new_status then true
    when p_role in ('owner','staff','reviewer') then
      (p_old_status,p_new_status) in (
        ('open','in_progress'),
        ('in_progress','resolution_requested'),
        ('resolution_requested','in_progress'),
        ('resolution_requested','closed'),
        ('closed','open')
      )
    when p_role in ('estimator','site','procurement') then
      (p_old_status,p_new_status) in (
        ('open','in_progress'),
        ('in_progress','resolution_requested')
      )
    else false
  end;
$$;

create or replace function private.lukas_drawing_issue_guard()
returns trigger
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := private.lukas_qto_project_role(new.project_id);
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if tg_op = 'INSERT' then
    if new.created_by <> v_actor then raise exception 'Issue creator must be current user'; end if;
    if v_role not in ('owner','staff','reviewer','estimator','site','procurement') then
      raise exception 'Project role cannot create drawing issues';
    end if;
    if v_role not in ('owner','staff','reviewer') and new.assignee_user_id is not null then
      raise exception 'Only reviewers may assign drawing issues';
    end if;
    new.status := 'open';
    new.closed_by := null;
    new.closed_at := null;
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
  end if;
  if new.assignee_user_id is not null and not exists (
    select 1
    from public.lukas_qto_projects p
    where p.id = new.project_id
      and (
        p.owner_id = new.assignee_user_id
        or exists (
          select 1 from public.lukas_qto_project_members m
          where m.project_id = new.project_id and m.user_id = new.assignee_user_id
        )
      )
  ) then
    raise exception 'Drawing issue assignee must belong to the project';
  end if;
  if tg_op = 'INSERT' then
    return new;
  end if;

  if new.project_id is distinct from old.project_id
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Immutable issue identity changed';
  end if;
  if not private.lukas_drawing_transition_allowed(v_role, old.status, new.status) then
    raise exception 'Drawing issue status transition is not allowed';
  end if;
  if v_role not in ('owner','staff','reviewer') then
    if old.assignee_user_id is distinct from v_actor then
      raise exception 'Only the assigned worker may change issue status';
    end if;
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.priority is distinct from old.priority
       or new.assignee_user_id is distinct from old.assignee_user_id
       or new.due_at is distinct from old.due_at then
      raise exception 'Only reviewers may edit issue assignment or details';
    end if;
  end if;
  if new.status = 'closed' and old.status <> 'closed' then
    new.closed_by := v_actor;
    new.closed_at := now();
  elsif old.status = 'closed' and new.status <> 'closed' then
    new.closed_by := null;
    new.closed_at := null;
  elsif new.closed_by is distinct from old.closed_by
     or new.closed_at is distinct from old.closed_at then
    raise exception 'Closed evidence is managed by the status transition';
  end if;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end;
$$;

create trigger lukas_drawing_issues_guard
before insert or update on public.lukas_drawing_issues
for each row execute function private.lukas_drawing_issue_guard();

create or replace function private.lukas_drawing_anchor_guard()
returns trigger
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := private.lukas_qto_project_role(new.project_id);
begin
  if v_actor is null then raise exception 'Authenticated drawing actor required'; end if;
  if tg_op = 'INSERT' then
    if new.created_by <> v_actor then raise exception 'Anchor creator must be current user'; end if;
    if v_role not in ('owner','staff','reviewer','estimator','site','procurement') then
      raise exception 'Project role cannot create drawing anchors';
    end if;
    if not exists (
      select 1 from public.lukas_qto_files f
      where f.id = new.file_id and f.project_id = new.project_id
        and ((new.anchor_kind = 'ifc_element' and f.kind = 'ifc')
          or (new.anchor_kind = 'pdf_region' and f.kind = 'pdf'))
    ) then raise exception 'Anchor file is not a matching project drawing'; end if;
    return new;
  end if;
  if old.active = false or new.active <> false
     or new.id is distinct from old.id
     or new.issue_id is distinct from old.issue_id
     or new.project_id is distinct from old.project_id
     or new.file_id is distinct from old.file_id
     or new.anchor_kind is distinct from old.anchor_kind
     or new.element_id is distinct from old.element_id
     or new.ifc_global_id is distinct from old.ifc_global_id
     or new.camera_json is distinct from old.camera_json
     or new.page_number is distinct from old.page_number
     or new.x is distinct from old.x or new.y is distinct from old.y
     or new.width is distinct from old.width or new.height is distinct from old.height
     or new.label is distinct from old.label
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'Drawing anchors are immutable and may only be deactivated once';
  end if;
  if v_role not in ('owner','staff','reviewer','estimator','site','procurement') then
    raise exception 'Project role cannot deactivate drawing anchors';
  end if;
  new.deactivated_by := v_actor;
  new.deactivated_at := now();
  return new;
end;
$$;

create trigger lukas_drawing_anchors_guard
before insert or update on public.lukas_drawing_issue_anchors
for each row execute function private.lukas_drawing_anchor_guard();

create or replace function private.lukas_drawing_append_event()
returns trigger
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_event_id uuid;
  v_actor uuid := (select auth.uid());
begin
  if tg_table_name = 'lukas_drawing_issues' then
    if tg_op = 'INSERT' then
      insert into public.lukas_drawing_issue_events(issue_id,project_id,actor_id,event_type,to_value)
      values(new.id,new.project_id,v_actor,'created',jsonb_build_object('status',new.status))
      returning id into v_event_id;
    else
      if new.status is distinct from old.status then
        insert into public.lukas_drawing_issue_events(issue_id,project_id,actor_id,event_type,from_value,to_value)
        values(new.id,new.project_id,v_actor,'status_changed',to_jsonb(old.status),to_jsonb(new.status));
      end if;
      if new.assignee_user_id is distinct from old.assignee_user_id then
        insert into public.lukas_drawing_issue_events(issue_id,project_id,actor_id,event_type,from_value,to_value)
        values(new.id,new.project_id,v_actor,'assignee_changed',to_jsonb(old.assignee_user_id),to_jsonb(new.assignee_user_id));
      end if;
      if new.due_at is distinct from old.due_at then
        insert into public.lukas_drawing_issue_events(issue_id,project_id,actor_id,event_type,from_value,to_value)
        values(new.id,new.project_id,v_actor,'due_changed',to_jsonb(old.due_at),to_jsonb(new.due_at));
      end if;
      if new.priority is distinct from old.priority then
        insert into public.lukas_drawing_issue_events(issue_id,project_id,actor_id,event_type,from_value,to_value)
        values(new.id,new.project_id,v_actor,'priority_changed',to_jsonb(old.priority),to_jsonb(new.priority));
      end if;
    end if;
  elsif tg_table_name = 'lukas_drawing_issue_anchors' then
    insert into public.lukas_drawing_issue_events(issue_id,project_id,actor_id,event_type,from_value,to_value,note)
    values(
      new.issue_id,new.project_id,v_actor,
      case when tg_op = 'INSERT' then 'anchor_added' else 'anchor_deactivated' end,
      case when tg_op = 'UPDATE' then jsonb_build_object('anchor_id',new.id,'active',true) end,
      jsonb_build_object('anchor_id',new.id,'active',new.active),
      coalesce(new.deactivation_note,'')
    );
  elsif tg_table_name = 'lukas_drawing_issue_comments' then
    insert into public.lukas_drawing_issue_events(issue_id,project_id,actor_id,event_type,to_value)
    values(new.issue_id,new.project_id,v_actor,'comment_added',jsonb_build_object('comment_id',new.id));
  end if;
  return new;
end;
$$;

create trigger lukas_drawing_issue_events_from_issue
after insert or update on public.lukas_drawing_issues
for each row execute function private.lukas_drawing_append_event();
create trigger lukas_drawing_issue_events_from_anchor
after insert or update on public.lukas_drawing_issue_anchors
for each row execute function private.lukas_drawing_append_event();
create trigger lukas_drawing_issue_events_from_comment
after insert on public.lukas_drawing_issue_comments
for each row execute function private.lukas_drawing_append_event();

create or replace function private.lukas_drawing_notification_guard()
returns trigger
language plpgsql security definer
set search_path = public, private
as $$
begin
  if new.id is distinct from old.id
     or new.project_id is distinct from old.project_id
     or new.issue_id is distinct from old.issue_id
     or new.event_id is distinct from old.event_id
     or new.user_id is distinct from old.user_id
     or new.created_at is distinct from old.created_at
     or old.read_at is not null
     or new.read_at is null then
    raise exception 'Drawing notifications may only be marked read once';
  end if;
  new.read_at := now();
  return new;
end;
$$;

create trigger lukas_drawing_notifications_guard
before update on public.lukas_drawing_notifications
for each row execute function private.lukas_drawing_notification_guard();

alter table public.lukas_drawing_issues enable row level security;
alter table public.lukas_drawing_issue_anchors enable row level security;
alter table public.lukas_drawing_issue_comments enable row level security;
alter table public.lukas_drawing_issue_events enable row level security;
alter table public.lukas_drawing_notifications enable row level security;

revoke all on public.lukas_drawing_issues, public.lukas_drawing_issue_anchors,
  public.lukas_drawing_issue_comments, public.lukas_drawing_issue_events,
  public.lukas_drawing_notifications from public, anon;
grant select, insert, update on public.lukas_drawing_issues,
  public.lukas_drawing_issue_anchors to authenticated;
grant select, insert on public.lukas_drawing_issue_comments to authenticated;
grant select on public.lukas_drawing_issue_events to authenticated;
grant select, update on public.lukas_drawing_notifications to authenticated;
grant all on public.lukas_drawing_issues, public.lukas_drawing_issue_anchors,
  public.lukas_drawing_issue_comments, public.lukas_drawing_issue_events,
  public.lukas_drawing_notifications to service_role;

create policy "project roles read drawing issues"
on public.lukas_drawing_issues for select to authenticated
using (private.lukas_qto_project_role(project_id) is not null);
create policy "project contributors create drawing issues"
on public.lukas_drawing_issues for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.lukas_qto_project_role(project_id) in
    ('owner','staff','reviewer','estimator','site','procurement')
);
create policy "project contributors update drawing issues"
on public.lukas_drawing_issues for update to authenticated
using (private.lukas_qto_project_role(project_id) in
  ('owner','staff','reviewer','estimator','site','procurement'))
with check (private.lukas_qto_project_role(project_id) in
  ('owner','staff','reviewer','estimator','site','procurement'));

create policy "project roles read drawing anchors"
on public.lukas_drawing_issue_anchors for select to authenticated
using (private.lukas_qto_project_role(project_id) is not null);
create policy "project contributors create drawing anchors"
on public.lukas_drawing_issue_anchors for insert to authenticated
with check (
  created_by = (select auth.uid())
  and private.lukas_qto_project_role(project_id) in
    ('owner','staff','reviewer','estimator','site','procurement')
);
create policy "project contributors deactivate drawing anchors"
on public.lukas_drawing_issue_anchors for update to authenticated
using (private.lukas_qto_project_role(project_id) in
  ('owner','staff','reviewer','estimator','site','procurement'))
with check (private.lukas_qto_project_role(project_id) in
  ('owner','staff','reviewer','estimator','site','procurement'));

create policy "project roles read drawing comments"
on public.lukas_drawing_issue_comments for select to authenticated
using (private.lukas_qto_project_role(project_id) is not null);
create policy "project contributors add drawing comments"
on public.lukas_drawing_issue_comments for insert to authenticated
with check (
  author_id = (select auth.uid())
  and private.lukas_qto_project_role(project_id) in
    ('owner','staff','reviewer','estimator','site','procurement')
);

create policy "project roles read drawing events"
on public.lukas_drawing_issue_events for select to authenticated
using (private.lukas_qto_project_role(project_id) is not null);
create policy "users read own drawing notifications"
on public.lukas_drawing_notifications for select to authenticated
using (user_id = (select auth.uid()) and private.lukas_qto_project_role(project_id) is not null);
create policy "users mark own drawing notifications read"
on public.lukas_drawing_notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()) and read_at is not null);

revoke all on function private.lukas_drawing_transition_allowed(text,text,text) from public, anon;
revoke all on function private.lukas_drawing_issue_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_anchor_guard() from public, anon, authenticated;
revoke all on function private.lukas_drawing_append_event() from public, anon, authenticated;
revoke all on function private.lukas_drawing_notification_guard() from public, anon, authenticated;
grant execute on function private.lukas_drawing_transition_allowed(text,text,text)
  to authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lukas_drawing_issues'
  ) then
    execute 'alter publication supabase_realtime add table public.lukas_drawing_issues';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lukas_drawing_issue_comments'
  ) then
    execute 'alter publication supabase_realtime add table public.lukas_drawing_issue_comments';
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lukas_drawing_issue_events'
  ) then
    execute 'alter publication supabase_realtime add table public.lukas_drawing_issue_events';
  end if;
end;
$$;
