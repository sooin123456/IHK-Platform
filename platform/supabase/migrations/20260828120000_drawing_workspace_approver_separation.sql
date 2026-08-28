-- P7 final authority: reviewers recommend; approvers alone make final approval.

alter table public.lukas_qto_project_members
  drop constraint lukas_qto_project_members_role_check,
  add constraint lukas_qto_project_members_role_check
    check(role in('owner','estimator','reviewer','approver','site','procurement','viewer'));

alter table public.lukas_drawing_revisions
  drop constraint lukas_drawing_revisions_status_check,
  drop constraint lukas_drawing_revisions_check;
alter table public.lukas_drawing_revisions
  add constraint lukas_drawing_revisions_status_check
    check(status in('draft','review_requested','reviewed','approved','superseded')),
  add constraint lukas_drawing_revisions_lifecycle_check check(
    (status='draft' and review_requested_at is null and approved_at is null)
    or (status in('review_requested','reviewed') and review_requested_at is not null and approved_at is null)
    or (status in('approved','superseded') and review_requested_at is not null and approved_at is not null)
  );

alter table public.lukas_drawing_revision_approvals
  drop constraint lukas_drawing_revision_approvals_decision_check,
  drop constraint lukas_drawing_revision_approvals_revision_id_subject_version_key;
alter table public.lukas_drawing_revision_approvals
  add constraint lukas_drawing_revision_approvals_decision_check
    check(decision in('reviewed','approved','rejected')),
  add constraint lukas_drawing_revision_approvals_stage_key
    unique(revision_id,subject_version,decision);

create or replace function private.lukas_drawing_workspace_capability(p_project_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when private.lukas_qto_project_feature_active(p_project_id,'drawing_workspace')
    then private.lukas_drawing_collaboration_capability_for_user((select auth.uid()),p_project_id)
    else null::text end
$$;

-- The hosted collaboration service authorizes an explicit user rather than
-- auth.uid(); keep its role map aligned so an approver can mount read-only and
-- make the final decision through the authenticated application action.
create or replace function private.lukas_drawing_collaboration_capability_for_user(
  p_user_id uuid,p_project_id uuid
) returns text language sql stable security definer set search_path='' as $$
  select case
    when p_user_id is null then null
    when exists(select 1 from auth.users u where u.id=p_user_id
      and pg_catalog.to_jsonb(u)->'raw_app_meta_data'->>'role'='hangil_staff') then 'admin'
    when p.owner_id=p_user_id then 'admin'
    else case (select m.role from public.lukas_qto_project_members m
      where m.project_id=p.id and m.user_id=p_user_id)
      when 'estimator' then 'editor' when 'reviewer' then 'reviewer'
      when 'approver' then 'approver' when 'site' then 'commenter'
      when 'procurement' then 'commenter' when 'viewer' then 'viewer' end
  end from public.lukas_qto_projects p where p.id=p_project_id
$$;

create or replace function private.lukas_drawing_revision_approval_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype; v_role text;
begin
  if v_actor is null or new.decided_by<>v_actor then raise exception 'Authenticated drawing decision actor required'; end if;
  select * into v_revision from public.lukas_drawing_revisions r
    where r.id=new.revision_id and r.project_id=new.project_id for update;
  if not found then raise exception 'Drawing revision does not exist'; end if;
  if v_revision.created_by=v_actor then raise exception 'Maker cannot decide their own drawing revision'; end if;
  v_role:=private.lukas_qto_project_role(v_revision.project_id);
  if new.decision='reviewed' then
    if v_role<>'reviewer' or v_revision.status<>'review_requested' then raise exception 'Exact drawing reviewer recommendation required'; end if;
  elsif new.decision='approved' then
    if v_role<>'approver' or v_revision.status<>'reviewed' then raise exception 'Exact drawing approver final authority required'; end if;
    if not exists(select 1 from public.lukas_drawing_revision_approvals a
      where a.revision_id=new.revision_id and a.project_id=new.project_id
        and a.subject_version=new.subject_version and a.snapshot_sha256=new.snapshot_sha256
        and a.decision='reviewed' and a.decided_by<>v_actor and a.decided_by<>v_revision.created_by)
    then raise exception 'Independent reviewer recommendation required'; end if;
  elsif new.decision='rejected' then
    if not ((v_role='reviewer' and v_revision.status='review_requested')
      or (v_role='approver' and v_revision.status='reviewed')) then raise exception 'Exact staged rejection authority required'; end if;
  else raise exception 'Invalid drawing decision'; end if;
  if v_revision.version<>new.subject_version then raise exception 'Drawing revision subject version changed'; end if;
  if not exists(select 1 from public.lukas_drawing_snapshots s where s.revision_id=new.revision_id
      and s.project_id=new.project_id and s.revision_version=new.subject_version and s.sha256=new.snapshot_sha256)
  then raise exception 'Drawing decision snapshot SHA does not match'; end if;
  new.created_at:=pg_catalog.now(); return new;
end;
$$;

create or replace function private.lukas_drawing_apply_revision_approval()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.decision='reviewed' then
    update public.lukas_drawing_revisions set status='reviewed',updated_at=pg_catalog.now()
      where id=new.revision_id and project_id=new.project_id and status='review_requested' and version=new.subject_version;
  elsif new.decision='approved' then
    update public.lukas_drawing_revisions set status='approved',approved_at=pg_catalog.now(),updated_at=pg_catalog.now()
      where id=new.revision_id and project_id=new.project_id and status='reviewed' and version=new.subject_version;
  else
    update public.lukas_drawing_revisions set status='draft',version=version+1,
      review_requested_at=null,approved_at=null,updated_at=pg_catalog.now()
      where id=new.revision_id and project_id=new.project_id
        and status in('review_requested','reviewed') and version=new.subject_version;
  end if;
  if not found then raise exception 'Drawing revision decision lost its subject version'; end if;
  return new;
end;
$$;

create or replace function private.lukas_drawing_record_revision_decision(
  p_revision_id uuid,p_subject_version bigint,p_snapshot_sha256 text,p_decision text,p_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype; v_approval_id uuid; v_status text; v_version bigint;
begin
  if v_actor is null or p_decision not in('reviewed','approved','rejected')
    or p_note is null or pg_catalog.char_length(p_note)>5000 then raise exception 'Drawing decision input is invalid'; end if;
  select * into v_revision from public.lukas_drawing_revisions r where r.id=p_revision_id for update;
  if not found then raise exception 'Drawing revision does not exist'; end if;
  insert into public.lukas_drawing_revision_approvals(revision_id,project_id,subject_version,snapshot_sha256,decision,note,decided_by)
  values(p_revision_id,v_revision.project_id,p_subject_version,p_snapshot_sha256,p_decision,p_note,v_actor)
  returning id into v_approval_id;
  select status,version into v_status,v_version from public.lukas_drawing_revisions where id=p_revision_id;
  return pg_catalog.jsonb_build_object('approvalId',v_approval_id,'status',v_status,'version',v_version);
end;
$$;

drop policy "revision approvals enforce maker checker" on public.lukas_drawing_revision_approvals;
create policy "revision decisions enforce separated maker checker"
on public.lukas_drawing_revision_approvals for insert to authenticated with check(
  decided_by=(select auth.uid())
  and ((decision in('reviewed','rejected') and private.lukas_qto_project_role(project_id)='reviewer')
    or (decision in('approved','rejected') and private.lukas_qto_project_role(project_id)='approver'))
  and exists(select 1 from public.lukas_drawing_revisions r where r.id=revision_id and r.project_id=project_id and r.created_by<>(select auth.uid()))
);

create or replace function public.lukas_qto_set_project_member(
  p_organization_id uuid,p_project_id uuid,p_email text,p_role text,p_request_id uuid
) returns public.lukas_qto_project_members language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_email text:=pg_catalog.lower(pg_catalog.btrim(p_email)); v_user uuid;
  v_owner uuid; v_member public.lukas_qto_project_members%rowtype; v_sha text;
begin
  if v_actor is null or not private.lukas_qto_project_membership_manager(p_project_id) then raise exception using errcode='P7A04',message='Project member authority denied'; end if;
  select p.owner_id into v_owner from public.lukas_qto_projects p where p.id=p_project_id and p.organization_id=p_organization_id;
  if not found or p_role not in('estimator','reviewer','approver','site','procurement','viewer') or p_request_id is null then raise exception using errcode='P7A05',message='Project member input is invalid'; end if;
  select u.id into v_user from auth.users u join public.lukas_qto_organization_members m on m.user_id=u.id
    where m.organization_id=p_organization_id and pg_catalog.lower(pg_catalog.btrim(u.email))=v_email and coalesce(u.is_anonymous,false)=false;
  if v_user is null then raise exception using errcode='P7A05',message='Exact organization member email is unavailable'; end if;
  if v_user=v_owner then raise exception using errcode='P7A05',message='Cannot change the project owner'; end if;
  v_sha:=private.lukas_qto_admin_request_sha(pg_catalog.jsonb_build_array(p_organization_id,p_project_id,v_user,p_role));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||p_request_id::text,0));
  if private.lukas_qto_admin_retry_matches(v_actor,p_request_id,v_sha) then select * into v_member from public.lukas_qto_project_members where project_id=p_project_id and user_id=v_user; return v_member; end if;
  insert into public.lukas_qto_project_members(project_id,user_id,role) values(p_project_id,v_user,p_role)
    on conflict(project_id,user_id) do update set role=excluded.role returning * into v_member;
  insert into public.lukas_qto_organization_admin_events(organization_id,event_type,subject_user_id,project_id,request_id,request_sha256,details,actor_id)
  values(p_organization_id,'project_member_changed',v_user,p_project_id,p_request_id,v_sha,pg_catalog.jsonb_build_object('role',p_role),v_actor);
  return v_member;
end;
$$;

revoke all on function private.lukas_drawing_revision_approval_guard() from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_apply_revision_approval() from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_record_revision_decision(uuid,bigint,text,text,text) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_revision_approval_guard() to service_role;
grant execute on function private.lukas_drawing_apply_revision_approval() to service_role;
grant execute on function private.lukas_drawing_record_revision_decision(uuid,bigint,text,text,text) to service_role;
