-- Reassert the public API contract explicitly. An authenticated project user
-- may use only the operations exposed by the RLS policies; destructive table
-- privileges such as DELETE and TRUNCATE are never required by the product.
revoke all on public.lukas_drawing_issues,
  public.lukas_drawing_issue_anchors,
  public.lukas_drawing_issue_comments,
  public.lukas_drawing_issue_events,
  public.lukas_drawing_notifications
from authenticated;

grant select, insert, update on public.lukas_drawing_issues,
  public.lukas_drawing_issue_anchors
to authenticated;

grant select, insert on public.lukas_drawing_issue_comments to authenticated;
grant select on public.lukas_drawing_issue_events to authenticated;
grant select, update on public.lukas_drawing_notifications to authenticated;
