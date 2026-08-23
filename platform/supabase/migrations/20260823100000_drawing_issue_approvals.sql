-- Append-only maker-checker decisions for drawing issues. Closing an issue is
-- an effect of an approved decision, never a direct status edit.
create table public.lukas_drawing_issue_approvals (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  subject_version bigint not null check (subject_version > 0),
  decision text not null check (decision in ('approved','rejected')),
  note text not null check (char_length(trim(note)) between 1 and 2000),
  reviewer_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint lukas_drawing_approval_issue_fkey
    foreign key (issue_id, project_id)
    references public.lukas_drawing_issues(id, project_id) on delete cascade,
  unique (issue_id, subject_version)
);

create index lukas_drawing_approvals_project_created_idx
  on public.lukas_drawing_issue_approvals(project_id, created_at desc);
create index lukas_drawing_approvals_reviewer_idx
  on public.lukas_drawing_issue_approvals(reviewer_id, created_at desc);

alter table public.lukas_drawing_issue_events
  drop constraint if exists lukas_drawing_issue_events_event_type_check;
alter table public.lukas_drawing_issue_events
  add constraint lukas_drawing_issue_events_event_type_check check (
    event_type in (
      'created','status_changed','assignee_changed','due_changed','priority_changed',
      'anchor_added','anchor_deactivated','comment_added','approval_recorded'
    )
  );

create or replace function private.lukas_drawing_approval_guard()
returns trigger
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_actor uuid := (select auth.uid());
  v_role text := private.lukas_qto_project_role(new.project_id);
  v_issue public.lukas_drawing_issues%rowtype;
begin
  if v_actor is null then
    raise exception 'Authenticated drawing reviewer required';
  end if;
  if new.reviewer_id <> v_actor then
    raise exception 'Approval reviewer must be current user';
  end if;
  if v_role not in ('owner','staff','reviewer') then
    raise exception 'Project role cannot approve drawing issues';
  end if;

  select * into v_issue
  from public.lukas_drawing_issues
  where id = new.issue_id and project_id = new.project_id
  for update;
  if not found then raise exception 'Drawing issue not found'; end if;
  if not (new.reviewer_id <> v_issue.created_by) then
    raise exception 'Issue creator cannot approve own issue';
  end if;
  if v_issue.status <> 'resolution_requested' then
    raise exception 'Drawing issue must be awaiting review';
  end if;
  if v_issue.version <> new.subject_version then
    raise exception 'Drawing issue version changed before approval';
  end if;
  if not exists (
    select 1
    from public.lukas_drawing_issue_anchors a
    where a.issue_id = new.issue_id
      and a.project_id = new.project_id
      and a.active
  ) then
    raise exception 'Drawing approval requires active drawing evidence';
  end if;

  new.created_at := now();
  return new;
end;
$$;

create trigger lukas_drawing_approval_guard
before insert on public.lukas_drawing_issue_approvals
for each row execute function private.lukas_drawing_approval_guard();

create or replace function private.lukas_drawing_close_approval_guard()
returns trigger
language plpgsql security definer
set search_path = public, private
as $$
begin
  if new.status = 'closed' and old.status <> 'closed'
     and coalesce(current_setting('lukas.drawing_approval_issue_id', true), '')
       <> new.id::text then
    raise exception 'Drawing issues close only through an approval record';
  end if;
  return new;
end;
$$;

create trigger lukas_drawing_close_approval_guard
before update on public.lukas_drawing_issues
for each row execute function private.lukas_drawing_close_approval_guard();

create or replace function private.lukas_drawing_apply_approval()
returns trigger
language plpgsql security definer
set search_path = public, private
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  perform set_config('lukas.drawing_approval_issue_id', new.issue_id::text, true);
  update public.lukas_drawing_issues
  set status = case when new.decision = 'approved' then 'closed' else 'in_progress' end
  where id = new.issue_id
    and project_id = new.project_id
    and version = new.subject_version
    and status = 'resolution_requested';
  if not found then
    raise exception 'Drawing issue changed before approval was applied';
  end if;

  insert into public.lukas_drawing_issue_events(
    issue_id, project_id, actor_id, event_type, to_value, note
  ) values (
    new.issue_id,
    new.project_id,
    v_actor,
    'approval_recorded',
    jsonb_build_object(
      'approval_id', new.id,
      'decision', new.decision,
      'subject_version', new.subject_version
    ),
    new.note
  );
  return new;
end;
$$;

create trigger lukas_drawing_apply_approval
after insert on public.lukas_drawing_issue_approvals
for each row execute function private.lukas_drawing_apply_approval();

alter table public.lukas_drawing_issue_approvals enable row level security;

revoke all on public.lukas_drawing_issue_approvals from public, anon, authenticated;
grant select, insert on public.lukas_drawing_issue_approvals to authenticated;
grant all on public.lukas_drawing_issue_approvals to service_role;
revoke update, delete on public.lukas_drawing_issue_approvals from authenticated;

create policy "project roles read drawing approvals"
on public.lukas_drawing_issue_approvals for select to authenticated
using (private.lukas_qto_project_role(project_id) is not null);

create policy "review roles add drawing approvals"
on public.lukas_drawing_issue_approvals for insert to authenticated
with check (
  reviewer_id = (select auth.uid())
  and private.lukas_qto_project_role(project_id) in ('owner','staff','reviewer')
);

revoke all on function private.lukas_drawing_approval_guard()
  from public, anon, authenticated;
revoke all on function private.lukas_drawing_close_approval_guard()
  from public, anon, authenticated;
revoke all on function private.lukas_drawing_apply_approval()
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lukas_drawing_issue_approvals'
  ) then
    execute 'alter publication supabase_realtime add table public.lukas_drawing_issue_approvals';
  end if;
end;
$$;
