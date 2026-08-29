-- Anonymous Supabase users use the PostgreSQL `authenticated` role. Keep the
-- drawing workspace and membership graph available only to verified email
-- sessions, in addition to each table's existing project-scoped policies.

create policy "verified email sessions only" on public.lukas_qto_organizations as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());

create policy "verified email sessions only" on public.lukas_qto_organization_members as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());

create policy "verified email sessions only" on public.lukas_qto_project_members as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());

create policy "verified email sessions only" on public.lukas_drawing_issues as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());

create policy "verified email sessions only" on public.lukas_drawing_issue_anchors as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());

create policy "verified email sessions only" on public.lukas_drawing_issue_comments as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());

create policy "verified email sessions only" on public.lukas_drawing_issue_events as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());

create policy "verified email sessions only" on public.lukas_drawing_notifications as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());

create policy "verified email sessions only" on public.lukas_drawing_issue_approvals as restrictive for all to authenticated
using (private.lukas_qto_verified_session())
with check (private.lukas_qto_verified_session());
