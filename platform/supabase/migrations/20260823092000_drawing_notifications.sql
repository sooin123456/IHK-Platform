create or replace function private.lukas_drawing_create_notifications()
returns trigger
language plpgsql security definer
set search_path = public, private
as $$
begin
  insert into public.lukas_drawing_notifications(
    project_id, issue_id, event_id, user_id
  )
  select new.project_id, new.issue_id, new.id, recipients.user_id
  from (
    select i.created_by as user_id
    from public.lukas_drawing_issues i
    where i.id = new.issue_id and i.project_id = new.project_id
    union
    select i.assignee_user_id
    from public.lukas_drawing_issues i
    where i.id = new.issue_id and i.project_id = new.project_id
      and i.assignee_user_id is not null
    union
    select p.owner_id
    from public.lukas_qto_projects p
    where p.id = new.project_id
      and new.event_type = 'status_changed'
      and new.to_value = '"resolution_requested"'::jsonb
    union
    select m.user_id
    from public.lukas_qto_project_members m
    where m.project_id = new.project_id
      and m.role in ('owner','staff','reviewer')
      and new.event_type = 'status_changed'
      and new.to_value = '"resolution_requested"'::jsonb
  ) recipients
  where recipients.user_id is not null
    and recipients.user_id is distinct from new.actor_id
  on conflict (event_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists lukas_drawing_notifications_from_event
  on public.lukas_drawing_issue_events;
create trigger lukas_drawing_notifications_from_event
after insert on public.lukas_drawing_issue_events
for each row execute function private.lukas_drawing_create_notifications();

revoke all on function private.lukas_drawing_create_notifications()
  from public, anon, authenticated;
