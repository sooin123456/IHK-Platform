create index if not exists lukas_drawing_anchors_issue_project_idx
  on public.lukas_drawing_issue_anchors(issue_id, project_id);
create index if not exists lukas_drawing_anchors_project_idx
  on public.lukas_drawing_issue_anchors(project_id);
create index if not exists lukas_drawing_anchors_created_by_idx
  on public.lukas_drawing_issue_anchors(created_by);
create index if not exists lukas_drawing_anchors_deactivated_by_idx
  on public.lukas_drawing_issue_anchors(deactivated_by)
  where deactivated_by is not null;

create index if not exists lukas_drawing_comments_issue_project_idx
  on public.lukas_drawing_issue_comments(issue_id, project_id);
create index if not exists lukas_drawing_comments_project_idx
  on public.lukas_drawing_issue_comments(project_id);
create index if not exists lukas_drawing_comments_author_idx
  on public.lukas_drawing_issue_comments(author_id);

create index if not exists lukas_drawing_events_issue_project_idx
  on public.lukas_drawing_issue_events(issue_id, project_id);
create index if not exists lukas_drawing_events_project_idx
  on public.lukas_drawing_issue_events(project_id);
create index if not exists lukas_drawing_events_actor_idx
  on public.lukas_drawing_issue_events(actor_id)
  where actor_id is not null;

create index if not exists lukas_drawing_issues_created_by_idx
  on public.lukas_drawing_issues(created_by);
create index if not exists lukas_drawing_issues_closed_by_idx
  on public.lukas_drawing_issues(closed_by)
  where closed_by is not null;

create index if not exists lukas_drawing_notifications_issue_project_idx
  on public.lukas_drawing_notifications(issue_id, project_id);
create index if not exists lukas_drawing_notifications_project_idx
  on public.lukas_drawing_notifications(project_id);
