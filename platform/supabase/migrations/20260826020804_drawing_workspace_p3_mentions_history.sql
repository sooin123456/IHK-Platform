begin;

alter table public.lukas_drawing_issue_comments
  add constraint lukas_drawing_issue_comments_identity_key
  unique(id,issue_id,project_id);

alter table public.lukas_drawing_issue_events
  drop constraint if exists lukas_drawing_issue_events_event_type_check;
alter table public.lukas_drawing_issue_events
  add constraint lukas_drawing_issue_events_event_type_check check (
    event_type in (
      'created','status_changed','assignee_changed','due_changed',
      'priority_changed','anchor_added','anchor_deactivated','comment_added',
      'approval_recorded','mention_added'
    )
  );

create table public.lukas_drawing_comment_mentions (
  comment_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  issue_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  primary key(comment_id,user_id),
  foreign key(comment_id,issue_id,project_id)
    references public.lukas_drawing_issue_comments(id,issue_id,project_id)
    on delete restrict
);

create index lukas_drawing_comment_mentions_user_created_idx
  on public.lukas_drawing_comment_mentions(user_id,created_at desc,comment_id);

create table public.lukas_drawing_canvas_region_anchors (
  id uuid primary key,
  issue_id uuid not null,
  revision_id uuid not null,
  page_id uuid not null,
  canvas_id uuid not null,
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  x_mm double precision not null,
  y_mm double precision not null,
  width_mm double precision not null,
  height_mm double precision not null,
  label text not null default '' check (
    label=pg_catalog.btrim(label) and pg_catalog.char_length(label)<=240
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique(id,project_id),
  foreign key(issue_id,project_id)
    references public.lukas_drawing_issues(id,project_id) on delete restrict,
  foreign key(revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete restrict,
  foreign key(page_id,revision_id,project_id)
    references public.lukas_drawing_pages(id,revision_id,project_id) on delete restrict,
  foreign key(canvas_id,page_id,revision_id,project_id)
    references public.lukas_drawing_canvases(id,page_id,revision_id,project_id)
    on delete restrict,
  check (
    x_mm not in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)
    and y_mm not in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)
    and width_mm not in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)
    and height_mm not in ('NaN'::double precision,'Infinity'::double precision,'-Infinity'::double precision)
    and width_mm>0 and height_mm>0
  )
);

create index lukas_drawing_canvas_region_anchors_revision_created_idx
  on public.lukas_drawing_canvas_region_anchors(
    revision_id,created_at desc,id desc
  );
create index lukas_drawing_canvas_region_anchors_issue_created_idx
  on public.lukas_drawing_canvas_region_anchors(
    issue_id,created_at,id
  );

create function private.lukas_drawing_p3_append_only_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='P3S01',
    message=pg_catalog.format('%I is append-only',tg_table_name);
end;
$$;

create trigger lukas_drawing_comment_mentions_append_only
before update or delete on public.lukas_drawing_comment_mentions
for each row execute function private.lukas_drawing_p3_append_only_guard();
create trigger lukas_drawing_canvas_region_anchors_append_only
before update or delete on public.lukas_drawing_canvas_region_anchors
for each row execute function private.lukas_drawing_p3_append_only_guard();

alter table public.lukas_drawing_comment_mentions enable row level security;
alter table public.lukas_drawing_canvas_region_anchors enable row level security;
revoke all on public.lukas_drawing_comment_mentions,
  public.lukas_drawing_canvas_region_anchors from public,anon,authenticated;
grant select on public.lukas_drawing_comment_mentions,
  public.lukas_drawing_canvas_region_anchors to authenticated;
grant all on public.lukas_drawing_comment_mentions,
  public.lukas_drawing_canvas_region_anchors to service_role;

create policy "project members read drawing comment mentions"
on public.lukas_drawing_comment_mentions for select to authenticated
using (private.lukas_qto_project_role(project_id) is not null);
create policy "project members read drawing canvas region anchors"
on public.lukas_drawing_canvas_region_anchors for select to authenticated
using (private.lukas_qto_project_role(project_id) is not null);

create function public.lukas_drawing_add_comment(
  p_issue_id uuid,p_comment_id uuid,p_body text,p_mentioned_user_ids uuid[]
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_project_id uuid; v_comment public.lukas_drawing_issue_comments%rowtype;
  v_mentions uuid[]; v_existing_mentions uuid[]; v_user_id uuid; v_event_id uuid;
begin
  if v_actor is null or p_comment_id is null or p_issue_id is null
    or p_body is null or pg_catalog.char_length(pg_catalog.btrim(p_body)) not between 1 and 10000
    or p_mentioned_user_ids is null
    or pg_catalog.cardinality(p_mentioned_user_ids)>50
    or pg_catalog.array_position(p_mentioned_user_ids,null) is not null then
    raise exception using errcode='P3S01',message='Drawing comment request is invalid';
  end if;
  select coalesce(pg_catalog.array_agg(x order by x),'{}'::uuid[])
  into v_mentions from (
    select distinct value x from pg_catalog.unnest(p_mentioned_user_ids) value
  ) selected;
  select i.project_id into v_project_id from public.lukas_drawing_issues i
  where i.id=p_issue_id
    and private.lukas_drawing_workspace_capability(i.project_id)
      in ('admin','editor','commenter','reviewer')
  for key share;
  if not found then
    raise exception using errcode='P3S01',message='Drawing comment target is unavailable';
  end if;
  if exists(
    select 1 from pg_catalog.unnest(v_mentions) mentioned(user_id)
    where not exists(
      select 1 from public.lukas_qto_projects p
      where p.id=v_project_id and (
        p.owner_id=mentioned.user_id or exists(
          select 1 from public.lukas_qto_project_members m
          where m.project_id=p.id and m.user_id=mentioned.user_id
        )
      )
    )
  ) then
    raise exception using errcode='P3S01',
      message='Mentioned user must belong to the drawing project';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':'||p_comment_id::text,0
  ));
  select c.* into v_comment from public.lukas_drawing_issue_comments c
  where c.id=p_comment_id for update;
  if found then
    select coalesce(pg_catalog.array_agg(m.user_id order by m.user_id),'{}'::uuid[])
    into v_existing_mentions from public.lukas_drawing_comment_mentions m
    where m.comment_id=p_comment_id;
    if v_comment.issue_id is distinct from p_issue_id
      or v_comment.project_id is distinct from v_project_id
      or v_comment.author_id is distinct from v_actor
      or v_comment.body is distinct from pg_catalog.btrim(p_body)
      or v_existing_mentions is distinct from v_mentions then
      raise exception using errcode='P3S01',
        message='Drawing comment idempotency key does not match the stored request';
    end if;
  else
    insert into public.lukas_drawing_issue_comments(
      id,issue_id,project_id,author_id,body
    ) values(
      p_comment_id,p_issue_id,v_project_id,v_actor,pg_catalog.btrim(p_body)
    ) returning * into v_comment;
    foreach v_user_id in array v_mentions loop
      insert into public.lukas_drawing_comment_mentions(
        comment_id,user_id,issue_id,project_id,created_by
      ) values(p_comment_id,v_user_id,p_issue_id,v_project_id,v_actor);
      insert into public.lukas_drawing_issue_events(
        issue_id,project_id,actor_id,event_type,to_value
      ) values(
        p_issue_id,v_project_id,v_actor,'mention_added',
        pg_catalog.jsonb_build_object(
          'comment_id',p_comment_id,'mentioned_user_id',v_user_id
        )
      ) returning id into v_event_id;
      insert into public.lukas_drawing_notifications(
        project_id,issue_id,event_id,user_id
      ) values(v_project_id,p_issue_id,v_event_id,v_user_id)
      on conflict(event_id,user_id) do nothing;
    end loop;
  end if;
  return pg_catalog.jsonb_build_object(
    'commentId',p_comment_id,'mentionedUserIds',pg_catalog.to_jsonb(v_mentions)
  );
exception
  when sqlstate 'P3S01' then raise;
  when unique_violation or foreign_key_violation or check_violation
    or not_null_violation then
    raise exception using errcode='P3S01',message='Drawing comment request is invalid';
end;
$$;

create function public.lukas_drawing_add_canvas_region_anchor(
  p_issue_id uuid,p_revision_id uuid,p_page_id uuid,p_canvas_id uuid,
  p_anchor_id uuid,p_x_mm double precision,p_y_mm double precision,
  p_width_mm double precision,p_height_mm double precision,p_label text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_project_id uuid;
begin
  select r.project_id into v_project_id
  from public.lukas_drawing_revisions r
  join public.lukas_drawing_pages p
    on p.id=p_page_id and p.revision_id=r.id and p.project_id=r.project_id
  join public.lukas_drawing_canvases c
    on c.id=p_canvas_id and c.page_id=p.id and c.revision_id=r.id
    and c.project_id=r.project_id
  join public.lukas_drawing_issues i
    on i.id=p_issue_id and i.project_id=r.project_id
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor','commenter','reviewer')
  for key share of r;
  if not found then
    raise exception using errcode='P3S01',
      message='Drawing canvas anchor target is unavailable';
  end if;
  insert into public.lukas_drawing_canvas_region_anchors(
    id,issue_id,revision_id,page_id,canvas_id,project_id,
    x_mm,y_mm,width_mm,height_mm,label,created_by
  ) values(
    p_anchor_id,p_issue_id,p_revision_id,p_page_id,p_canvas_id,v_project_id,
    p_x_mm,p_y_mm,p_width_mm,p_height_mm,coalesce(pg_catalog.btrim(p_label),''),v_actor
  );
  insert into public.lukas_drawing_issue_events(
    issue_id,project_id,actor_id,event_type,to_value
  ) values(
    p_issue_id,v_project_id,v_actor,'anchor_added',
    pg_catalog.jsonb_build_object('canvas_region_anchor_id',p_anchor_id)
  );
  return pg_catalog.jsonb_build_object(
    'anchorId',p_anchor_id,'revisionId',p_revision_id,'pageId',p_page_id,
    'canvasId',p_canvas_id,'xMm',p_x_mm,'yMm',p_y_mm,
    'widthMm',p_width_mm,'heightMm',p_height_mm
  );
exception
  when sqlstate 'P3S01' then raise;
  when unique_violation or foreign_key_violation or check_violation
    or not_null_violation or numeric_value_out_of_range then
    raise exception using errcode='P3S01',
      message='Drawing canvas anchor request is invalid';
end;
$$;

create table private.lukas_drawing_snapshot_restore_requests (
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  source_revision_id uuid not null,
  child_revision_id uuid not null,
  document_id uuid not null,
  project_id uuid not null,
  created_at timestamptz not null default pg_catalog.now(),
  primary key(actor_id,request_id),
  unique(child_revision_id),
  foreign key(source_revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete restrict,
  foreign key(child_revision_id,document_id,project_id)
    references public.lukas_drawing_revisions(id,document_id,project_id)
    on delete restrict,
  foreign key(document_id,project_id)
    references public.lukas_drawing_documents(id,project_id) on delete restrict
);
revoke all on private.lukas_drawing_snapshot_restore_requests
  from public,anon,authenticated,service_role;

create function private.lukas_drawing_snapshot_restore_ledger_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='P3S01',
    message='Drawing snapshot restore ledger is append-only';
end;
$$;
create trigger lukas_drawing_snapshot_restore_ledger_append_only
before update or delete on private.lukas_drawing_snapshot_restore_requests
for each row execute function private.lukas_drawing_snapshot_restore_ledger_guard();

create or replace function private.lukas_drawing_revision_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE'
    and current_user not in ('authenticated','anon')
    and pg_catalog.current_setting(
      'private.lukas_drawing_snapshot_restore_reparent',true
    )=old.id::text
    and old.status='draft' and new.status='draft'
    and new.id=old.id and new.project_id=old.project_id
    and new.version=old.version and new.created_by=old.created_by
    and new.created_at=old.created_at
    and new.review_requested_at is null and new.approved_at is null then
    return new;
  end if;
  if old.status='approved' then
    raise exception 'Approved drawing revision is immutable';
  end if;
  if tg_op='DELETE' then return old; end if;
  if new.document_id is distinct from old.document_id
    or new.project_id is distinct from old.project_id
    or new.parent_revision_id is distinct from old.parent_revision_id
    or new.sequence is distinct from old.sequence
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'Drawing revision identity is immutable';
  end if;
  if new.status=old.status and new.version is distinct from old.version then
    raise exception 'Direct drawing revision version update is forbidden';
  end if;
  if new.status is distinct from old.status then
    if old.status='draft' and new.status='review_requested' then
      if new.version<>old.version or new.review_requested_at is null
        or not exists(select 1 from public.lukas_drawing_snapshots s
          where s.revision_id=old.id and s.project_id=old.project_id
            and s.revision_version=old.version) then
        raise exception 'Drawing review request requires a canonical snapshot';
      end if;
    elsif old.status='review_requested' and new.status='approved' then
      if new.version<>old.version or new.approved_at is null
        or not exists(select 1 from public.lukas_drawing_revision_approvals a
          where a.revision_id=old.id and a.project_id=old.project_id
            and a.subject_version=old.version and a.decision='approved') then
        raise exception 'Drawing approval requires an append-only decision';
      end if;
    elsif old.status='review_requested' and new.status='draft' then
      if new.version<>old.version+1 or new.review_requested_at is not null
        or new.approved_at is not null
        or not exists(select 1 from public.lukas_drawing_revision_approvals a
          where a.revision_id=old.id and a.project_id=old.project_id
            and a.subject_version=old.version and a.decision='rejected') then
        raise exception 'Drawing rejection requires an append-only decision';
      end if;
    else
      raise exception 'Direct drawing revision status update is forbidden';
    end if;
  end if;
  return new;
end;
$$;

create function public.lukas_drawing_restore_approved_snapshot(
  p_source_revision_id uuid,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_source public.lukas_drawing_revisions%rowtype;
  v_document public.lukas_drawing_documents%rowtype;
  v_existing private.lukas_drawing_snapshot_restore_requests%rowtype;
  v_clone jsonb; v_child uuid; v_temporary_document uuid; v_sequence integer;
begin
  if v_actor is null or p_request_id is null then
    raise exception using errcode='P3S01',
      message='Drawing snapshot restore request is invalid';
  end if;
  select r.* into v_source from public.lukas_drawing_revisions r
  where r.id=p_source_revision_id and r.status='approved'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor')
  for update;
  if not found then
    raise exception using errcode='P3S01',
      message='Drawing approved snapshot target is unavailable';
  end if;
  select d.* into v_document from public.lukas_drawing_documents d
  where d.id=v_source.document_id and d.project_id=v_source.project_id
  for key share;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_actor::text||':'||p_request_id::text,0
  ));
  select l.* into v_existing
  from private.lukas_drawing_snapshot_restore_requests l
  where l.actor_id=v_actor and l.request_id=p_request_id for update;
  if found then
    if v_existing.source_revision_id is distinct from p_source_revision_id then
      raise exception using errcode='P3S01',
        message='Drawing restore idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'documentId',v_existing.document_id,
      'revisionId',v_existing.child_revision_id,
      'sourceRevisionId',v_existing.source_revision_id,
      'parentRevisionId',v_existing.source_revision_id,'status','draft'
    );
  end if;
  select coalesce(pg_catalog.max(r.sequence),0)+1 into v_sequence
  from public.lukas_drawing_revisions r where r.document_id=v_source.document_id;
  v_clone:=private.lukas_drawing_create_from_template(
    p_source_revision_id,v_document.title||' · 복원',null::uuid
  );
  v_child:=(v_clone->>'revisionId')::uuid;
  v_temporary_document:=(v_clone->>'documentId')::uuid;
  perform pg_catalog.set_config(
    'private.lukas_drawing_snapshot_restore_reparent',v_child::text,true
  );
  update public.lukas_drawing_revisions set
    document_id=v_source.document_id,parent_revision_id=v_source.id,
    sequence=v_sequence
  where id=v_child and document_id=v_temporary_document and status='draft';
  perform pg_catalog.set_config(
    'private.lukas_drawing_snapshot_restore_reparent','',true
  );

  update public.lukas_drawing_canvases child set
    background_source_file_id=source.background_source_file_id,
    background_source_sha256=source.background_source_sha256,
    background_pdf_page=source.background_pdf_page,
    calibration=source.calibration,version=child.version+1
  from public.lukas_drawing_canvases source
  join public.lukas_drawing_pages source_page on source_page.id=source.page_id
  join public.lukas_drawing_pages child_page
    on child_page.revision_id=v_child
    and child_page.sort_order=source_page.sort_order
  where source.revision_id=v_source.id and child.revision_id=v_child
    and child.page_id=child_page.id and child.sort_order=source.sort_order;

  insert into public.lukas_drawing_object_sources(
    object_id,revision_id,project_id,source_file_id,source_sha256,source_kind,
    pdf_page_number,x,y,width,height,element_id,ifc_global_id,camera_json,created_by
  )
  select child.id,v_child,v_source.project_id,source.source_file_id,
    source.source_sha256,source.source_kind,source.pdf_page_number,
    source.x,source.y,source.width,source.height,source.element_id,
    source.ifc_global_id,source.camera_json,v_actor
  from public.lukas_drawing_object_sources source
  join public.lukas_drawing_objects parent
    on parent.id=source.object_id and parent.revision_id=v_source.id
  join public.lukas_drawing_objects child
    on child.revision_id=v_child and child.lineage_id=parent.lineage_id;

  insert into public.lukas_drawing_object_issue_links(
    object_id,revision_id,issue_id,project_id,created_by
  )
  select child.id,v_child,link.issue_id,v_source.project_id,v_actor
  from public.lukas_drawing_object_issue_links link
  join public.lukas_drawing_objects parent
    on parent.id=link.object_id and parent.revision_id=v_source.id
  join public.lukas_drawing_objects child
    on child.revision_id=v_child and child.lineage_id=parent.lineage_id
  on conflict(object_id,issue_id) do nothing;

  delete from public.lukas_drawing_documents d
  where d.id=v_temporary_document
    and not exists(select 1 from public.lukas_drawing_revisions r
      where r.document_id=d.id);
  insert into private.lukas_drawing_snapshot_restore_requests(
    actor_id,request_id,source_revision_id,child_revision_id,
    document_id,project_id
  ) values(
    v_actor,p_request_id,v_source.id,v_child,v_source.document_id,v_source.project_id
  );
  return pg_catalog.jsonb_build_object(
    'documentId',v_source.document_id,'revisionId',v_child,
    'sourceRevisionId',v_source.id,'parentRevisionId',v_source.id,
    'status','draft'
  );
exception
  when sqlstate 'P3S01' then raise;
  when others then
    raise exception using errcode='P3S01',
      message='Drawing approved snapshot restore failed';
end;
$$;

revoke all on function private.lukas_drawing_p3_append_only_guard(),
  private.lukas_drawing_snapshot_restore_ledger_guard()
  from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_add_comment(uuid,uuid,text,uuid[]),
  public.lukas_drawing_add_canvas_region_anchor(
    uuid,uuid,uuid,uuid,uuid,double precision,double precision,
    double precision,double precision,text
  ),public.lukas_drawing_restore_approved_snapshot(uuid,uuid)
  from public,anon;
grant execute on function public.lukas_drawing_add_comment(uuid,uuid,text,uuid[]),
  public.lukas_drawing_add_canvas_region_anchor(
    uuid,uuid,uuid,uuid,uuid,double precision,double precision,
    double precision,double precision,text
  ),public.lukas_drawing_restore_approved_snapshot(uuid,uuid)
  to authenticated,service_role;

alter table public.lukas_drawing_operations
  drop constraint lukas_drawing_operations_operation_type_check,
  add constraint lukas_drawing_operations_operation_type_check check (
    operation_type in (
      'add_objects','update_objects','delete_objects','add_layer','update_layer',
      'mutate_structure','mutate_objects_with_references','restore_checkpoint'
    )
  );

create or replace function private.lukas_drawing_operations_history_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' and pg_catalog.pg_trigger_depth()>1 then return old; end if;
  if tg_op='UPDATE' and current_user not in ('authenticated','anon')
    and pg_catalog.current_setting('private.lukas_drawing_checkpoint_write',true)=old.id::text
    and new.id=old.id and new.revision_id=old.revision_id
    and new.project_id=old.project_id and new.sequence=old.sequence
    and new.client_operation_id=old.client_operation_id
    and new.base_versions=old.base_versions
    and new.result_versions=old.result_versions
    and new.actor_id=old.actor_id and new.created_at=old.created_at then
    return new;
  end if;
  if tg_op='UPDATE' and current_user not in ('authenticated','anon')
    and pg_catalog.current_setting('private.lukas_drawing_p2_operation_rewrite',true)=old.id::text
    and new.id=old.id and new.revision_id=old.revision_id
    and new.project_id=old.project_id and new.sequence=old.sequence
    and new.client_operation_id=old.client_operation_id
    and new.operation_type=old.operation_type and new.actor_id=old.actor_id
    and new.created_at=old.created_at then return new; end if;
  if tg_op='UPDATE'
    and pg_catalog.current_setting('private.lukas_drawing_history_write',true)='1'
    and old.history_action is null and old.original_operation_id is null
    and (pg_catalog.to_jsonb(new)-'history_action'-'original_operation_id')
      =(pg_catalog.to_jsonb(old)-'history_action'-'original_operation_id') then
    return new;
  end if;
  raise exception '% is append-only',tg_table_name;
end;
$$;

alter function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) rename to lukas_drawing_apply_operation_pre_p3_checkpoint;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_existing public.lukas_drawing_operations%rowtype;
  v_operation_id uuid;
  v_original_actor uuid;
  v_result jsonb;
begin
  if p_operation_type<>'restore_checkpoint' then
    return private.lukas_drawing_apply_operation_pre_p3_checkpoint(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id and o.client_operation_id=p_client_operation_id;
  if found then
    if v_existing.actor_id is distinct from v_actor
      or v_existing.operation_type is distinct from p_operation_type
      or v_existing.base_versions is distinct from p_base_versions
      or v_existing.forward is distinct from p_forward
      or v_existing.inverse is distinct from p_inverse
      or v_existing.history_action is distinct from p_history_action
      or v_existing.original_operation_id is distinct from p_original_operation_id then
      raise exception using errcode='P1C01',
        message='Drawing operation idempotency key does not match the stored request';
    end if;
    return pg_catalog.jsonb_build_object(
      'operationId',v_existing.id,'sequence',v_existing.sequence,
      'resultVersions',v_existing.result_versions
    );
  end if;
  if not (
    pg_catalog.jsonb_typeof(p_forward)='object'
    and p_forward->>'type'='restore_checkpoint'
    and pg_catalog.jsonb_typeof(p_forward->'actions')='array'
    and pg_catalog.jsonb_array_length(p_forward->'actions') between 1 and 5000
    and pg_catalog.jsonb_typeof(p_inverse)='object'
    and p_inverse->>'type'='restore_checkpoint'
    and p_inverse->>'checkpointId'=p_forward->>'checkpointId'
    and pg_catalog.jsonb_typeof(p_inverse->'actions')='array'
    and pg_catalog.jsonb_array_length(p_inverse->'actions')
      =pg_catalog.jsonb_array_length(p_forward->'actions')
    and exists(
      select 1 from public.lukas_drawing_snapshots s
      where s.id=(p_forward->>'checkpointId')::uuid
        and s.revision_id=p_revision_id
    )
  ) then raise exception using errcode='P1C01',
    message='Drawing checkpoint payload is invalid'; end if;
  if not (
    (p_history_action is null and p_original_operation_id is null)
    or (p_history_action in ('undo','redo') and p_original_operation_id is not null)
  ) then raise exception using errcode='P1C01',
    message='Drawing history lineage is invalid'; end if;
  if p_original_operation_id is not null then
    select o.actor_id into v_original_actor from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id
      and o.client_operation_id=p_original_operation_id;
    if not found or v_original_actor is distinct from v_actor then
      raise exception using errcode='P1C01',
        message='Drawing history original must belong to the same actor';
    end if;
  end if;
  v_result:=private.lukas_drawing_apply_operation_pre_task9_block_references(
    p_revision_id,p_client_operation_id,'mutate_structure',p_base_versions,
    pg_catalog.jsonb_build_object('type','mutate_structure','actions',p_forward->'actions'),
    pg_catalog.jsonb_build_object('type','mutate_structure','actions',p_inverse->'actions')
  );
  v_operation_id:=(v_result->>'operationId')::uuid;
  perform pg_catalog.set_config(
    'private.lukas_drawing_checkpoint_write',v_operation_id::text,true
  );
  update public.lukas_drawing_operations set
    operation_type='restore_checkpoint',forward=p_forward,inverse=p_inverse,
    history_action=p_history_action,original_operation_id=p_original_operation_id
  where id=v_operation_id;
  perform pg_catalog.set_config('private.lukas_drawing_checkpoint_write','',true);
  return v_result;
end;
$$;

create or replace function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb
) returns jsonb language sql security definer set search_path='' as $$
  select private.lukas_drawing_apply_operation(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,null::text,null::uuid
  )
$$;

revoke all on function private.lukas_drawing_apply_operation_pre_p3_checkpoint(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
), private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) to authenticated,service_role;

do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='lukas_drawing_comment_mentions') then
      execute 'alter publication supabase_realtime add table public.lukas_drawing_comment_mentions';
    end if;
    if not exists(select 1 from pg_catalog.pg_publication_tables
      where pubname='supabase_realtime' and schemaname='public'
        and tablename='lukas_drawing_canvas_region_anchors') then
      execute 'alter publication supabase_realtime add table public.lukas_drawing_canvas_region_anchors';
    end if;
  end if;
end;
$$;

commit;
