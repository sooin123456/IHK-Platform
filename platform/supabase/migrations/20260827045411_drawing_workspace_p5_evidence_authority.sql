begin;

alter table public.lukas_drawing_object_sources
  add column status text not null default 'active',
  add column version bigint not null default 1,
  add column updated_by uuid,
  add column updated_at timestamptz not null default pg_catalog.now();

alter table public.lukas_drawing_object_sources
  disable trigger lukas_drawing_object_sources_revision_guard;

update public.lukas_drawing_object_sources
set updated_by=created_by where updated_by is null;

alter table public.lukas_drawing_object_sources
  alter column updated_by set not null,
  alter column updated_by set default auth.uid(),
  add constraint lukas_drawing_object_sources_status_check
    check(status in ('active','deleted')),
  add constraint lukas_drawing_object_sources_version_check check(version>0),
  add constraint lukas_drawing_object_sources_updated_by_fkey
    foreign key(updated_by) references auth.users(id) on delete restrict;

do $$
declare v_constraint record;
begin
  for v_constraint in
    select c.conname
    from pg_catalog.pg_constraint c
    where c.conrelid='public.lukas_drawing_object_sources'::pg_catalog.regclass
      and (
        c.contype='u'
        or (c.contype='c' and pg_catalog.pg_get_constraintdef(c.oid)
          ilike '%pdf_page_number%')
      )
  loop
    execute pg_catalog.format(
      'alter table public.lukas_drawing_object_sources drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

create or replace function private.lukas_drawing_p5_camera_valid(p_camera jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
  select p_camera is null or coalesce(
    pg_catalog.jsonb_typeof(p_camera)='object'
    and p_camera ?& array['position','target']
    and p_camera-array['position','target']='{}'::jsonb
    and not exists(
      select 1 from pg_catalog.jsonb_array_elements(
        pg_catalog.jsonb_build_array(p_camera->'position',p_camera->'target')
      ) a
      where pg_catalog.jsonb_typeof(a)<>'array'
        or pg_catalog.jsonb_array_length(a)<>3
        or exists(
          select 1 from pg_catalog.jsonb_array_elements(a) n
          where pg_catalog.jsonb_typeof(n)<>'number'
            or pg_catalog.abs((n#>>'{}')::numeric)>999999999999
            or (n#>>'{}')::numeric*1000000
              <>pg_catalog.trunc((n#>>'{}')::numeric*1000000)
        )
    ),false)
$$;

update public.lukas_drawing_object_sources
set status='deleted',version=2,updated_at=pg_catalog.clock_timestamp()
where source_kind='ifc_element' and not (
  ifc_global_id is not null
  and ifc_global_id ~ '^[0-9A-Za-z_$]{22}$'
  and (element_id is null or element_id ~ '^[1-9][0-9]*$')
  and private.lukas_drawing_p5_camera_valid(camera_json)
);

alter table public.lukas_drawing_object_sources
  enable trigger lukas_drawing_object_sources_revision_guard;

alter table public.lukas_drawing_object_sources
  add constraint lukas_drawing_object_sources_exact_payload_check check(
    status='active' and (
      (source_kind='pdf_region'
        and pdf_page_number is not null and x is not null and y is not null
        and width is not null and height is not null and pdf_page_number>0
        and x>=0 and y>=0 and width>0 and height>0
        and x+width<=1 and y+height<=1
        and element_id is null and ifc_global_id is null and camera_json is null)
      or
      (source_kind='ifc_element'
        and pdf_page_number is null and x is null and y is null
        and width is null and height is null
        and ifc_global_id is not null
        and ifc_global_id ~ '^[0-9A-Za-z_$]{22}$'
        and (element_id is null or element_id ~ '^[1-9][0-9]*$')
        and private.lukas_drawing_p5_camera_valid(camera_json))
    ) or status='deleted' and (
      (source_kind='pdf_region'
        and pdf_page_number is not null and x is not null and y is not null
        and width is not null and height is not null and pdf_page_number>0
        and x>=0 and y>=0 and width>0 and height>0
        and x+width<=1 and y+height<=1
        and element_id is null and ifc_global_id is null and camera_json is null)
      or
      (source_kind='ifc_element'
        and pdf_page_number is null and x is null and y is null
        and width is null and height is null
        and (element_id is not null or ifc_global_id is not null)
        and (element_id is null
          or pg_catalog.char_length(pg_catalog.btrim(element_id)) between 1 and 128)
        and (ifc_global_id is null
          or ifc_global_id ~ '^[0-9A-Za-z_$]{22}$')
        and (camera_json is null
          or pg_catalog.jsonb_typeof(camera_json)='object'))
    )
  );

create unique index lukas_drawing_object_sources_active_identity_uidx
  on public.lukas_drawing_object_sources(object_id,source_file_id,source_kind)
  where(status='active');
create index lukas_drawing_object_sources_updated_by_idx
  on public.lukas_drawing_object_sources(updated_by);

create or replace function private.lukas_drawing_source_json(
  p_id uuid,p_revision_id uuid,p_project_id uuid,p_active_only boolean default true
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb;
begin
  select case s.source_kind
    when 'pdf_region' then pg_catalog.jsonb_build_object(
      'id',s.id,'objectId',s.object_id,'revisionId',s.revision_id,
      'sourceFileId',s.source_file_id,'sourceSha256',s.source_sha256,
      'sourceKind',s.source_kind,'pdfPageNumber',s.pdf_page_number,
      'x',s.x,'y',s.y,'width',s.width,'height',s.height,'version',s.version)
    else pg_catalog.jsonb_build_object(
      'id',s.id,'objectId',s.object_id,'revisionId',s.revision_id,
      'sourceFileId',s.source_file_id,'sourceSha256',s.source_sha256,
      'sourceKind',s.source_kind,'ifcGlobalId',s.ifc_global_id,
      'elementId',s.element_id,'camera',s.camera_json,'version',s.version)
    end into v
  from public.lukas_drawing_object_sources s
  where s.id=p_id and s.revision_id=p_revision_id and s.project_id=p_project_id
    and (not p_active_only or s.status='active');
  return v;
end;
$$;

alter function private.lukas_drawing_structure_entity_json(text,uuid,uuid,uuid)
  rename to lukas_drawing_structure_entity_json_pre_p5_sources;
create function private.lukas_drawing_structure_entity_json(
  p_kind text,p_id uuid,p_revision_id uuid,p_project_id uuid
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if p_kind='source' then
    return private.lukas_drawing_source_json(
      p_id,p_revision_id,p_project_id,true
    );
  end if;
  return private.lukas_drawing_structure_entity_json_pre_p5_sources(
    p_kind,p_id,p_revision_id,p_project_id
  );
end;
$$;

create or replace function private.lukas_drawing_structure_raw_id_exists(p_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from public.lukas_drawing_pages where id=p_id)
    or exists(select 1 from public.lukas_drawing_canvases where id=p_id)
    or exists(select 1 from public.lukas_drawing_layers where id=p_id)
    or exists(select 1 from public.lukas_drawing_objects where id=p_id)
    or exists(select 1 from public.lukas_drawing_styles where id=p_id)
    or exists(select 1 from public.lukas_drawing_blocks where id=p_id)
    or exists(select 1 from public.lukas_drawing_block_instances where id=p_id)
    or exists(select 1 from public.lukas_drawing_property_schemas where id=p_id)
    or exists(select 1 from public.lukas_drawing_property_values where id=p_id)
    or exists(select 1 from public.lukas_drawing_tables where id=p_id)
    or exists(select 1 from public.lukas_drawing_object_sources where id=p_id)
$$;

alter function private.lukas_drawing_structure_tombstone(uuid,uuid,text)
  rename to lukas_drawing_structure_tombstone_pre_p5_sources;
create function private.lukas_drawing_structure_tombstone(
  p_revision_id uuid,p_id uuid,p_put_kind text
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_entity jsonb;
begin
  v_entity:=private.lukas_drawing_structure_tombstone_pre_p5_sources(
    p_revision_id,p_id,p_put_kind
  );
  if v_entity is not null or p_put_kind<>'put_object' then return v_entity; end if;
  select candidate.value into v_entity
  from public.lukas_drawing_operations o
  cross join lateral pg_catalog.jsonb_array_elements(
    coalesce(o.inverse->'objects','[]'::jsonb)
  ) candidate(value)
  where o.revision_id=p_revision_id and o.result_versions->p_id::text='null'::jsonb
    and o.inverse->>'type'='mutate_objects_with_references'
    and o.inverse->>'objectAction'='restore'
    and candidate.value->>'id'=p_id::text
  order by o.sequence desc limit 1;
  return v_entity;
end;
$$;

alter function private.lukas_drawing_structure_action_valid(jsonb,uuid)
  rename to lukas_drawing_structure_action_valid_pre_p5_sources;
create function private.lukas_drawing_structure_action_valid(
  p_action jsonb,p_revision_id uuid
) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare v jsonb:=p_action->'entity'; v_kind text:=p_action->>'kind';
begin
  if v_kind not in ('put_source','delete_source') then
    return private.lukas_drawing_structure_action_valid_pre_p5_sources(
      p_action,p_revision_id
    );
  end if;
  if pg_catalog.jsonb_typeof(p_action)<>'object' then return false; end if;
  if v_kind='delete_source' then
    return p_action ?& array['kind','id','baseVersion']
      and p_action-array['kind','id','baseVersion']='{}'::jsonb
      and private.lukas_drawing_p2_uuid(p_action->'id') is true
      and private.lukas_drawing_p2_positive_integer(p_action->'baseVersion') is true;
  end if;
  if not (p_action ?& array['kind','entity','baseVersion'])
    or p_action-array['kind','entity','baseVersion']<>'{}'::jsonb
    or pg_catalog.jsonb_typeof(v)<>'object'
    or not (pg_catalog.jsonb_typeof(p_action->'baseVersion')='null'
      or private.lukas_drawing_p2_positive_integer(p_action->'baseVersion') is true)
    or not (v ?& array['id','objectId','revisionId','sourceFileId',
      'sourceSha256','sourceKind','version'])
    or private.lukas_drawing_p2_uuid(v->'id') is not true
    or private.lukas_drawing_p2_uuid(v->'objectId') is not true
    or private.lukas_drawing_p2_uuid(v->'revisionId') is not true
    or (v->>'revisionId')::uuid<>p_revision_id
    or private.lukas_drawing_p2_uuid(v->'sourceFileId') is not true
    or v->>'sourceSha256' !~ '^[0-9a-f]{64}$'
    or private.lukas_drawing_p2_positive_integer(v->'version') is not true
    then return false;
  end if;
  if v->>'sourceKind'='pdf_region' then
    return v ?& array['pdfPageNumber','x','y','width','height']
      and v-array['id','objectId','revisionId','sourceFileId','sourceSha256',
        'sourceKind','pdfPageNumber','x','y','width','height','version']='{}'::jsonb
      and private.lukas_drawing_p2_positive_integer(v->'pdfPageNumber') is true
      and pg_catalog.jsonb_typeof(v->'x')='number'
      and pg_catalog.jsonb_typeof(v->'y')='number'
      and pg_catalog.jsonb_typeof(v->'width')='number'
      and pg_catalog.jsonb_typeof(v->'height')='number'
      and (v->>'x')::numeric>=0 and (v->>'y')::numeric>=0
      and (v->>'width')::numeric>0 and (v->>'height')::numeric>0
      and (v->>'x')::numeric+(v->>'width')::numeric<=1
      and (v->>'y')::numeric+(v->>'height')::numeric<=1;
  elsif v->>'sourceKind'='ifc_element' then
    return v ?& array['ifcGlobalId','elementId','camera']
      and v-array['id','objectId','revisionId','sourceFileId','sourceSha256',
        'sourceKind','ifcGlobalId','elementId','camera','version']='{}'::jsonb
      and v->>'ifcGlobalId' ~ '^[0-9A-Za-z_$]{22}$'
      and (pg_catalog.jsonb_typeof(v->'elementId')='null'
        or (pg_catalog.jsonb_typeof(v->'elementId')='string'
          and v->>'elementId' ~ '^[1-9][0-9]*$'))
      and (pg_catalog.jsonb_typeof(v->'camera')='null'
        or private.lukas_drawing_p5_camera_valid(v->'camera'));
  end if;
  return false;
exception when others then return false;
end;
$$;

create or replace function private.lukas_drawing_object_source_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_internal boolean:=current_user not in ('authenticated','anon')
    or pg_catalog.current_setting(
      'private.lukas_drawing_source_operation',true
    )=coalesce(new.revision_id,old.revision_id)::text;
begin
  if not v_internal then
    raise exception using errcode='42501',
      message='Drawing sources are mutated only by drawing operations';
  end if;
  if tg_op='DELETE' then
    if pg_catalog.current_setting(
      'private.lukas_drawing_p5_checkpoint_operation',true
    )=old.revision_id::text then return null; end if;
    if old.status='deleted' then return null; end if;
    perform pg_catalog.set_config(
      'private.lukas_drawing_source_operation',old.revision_id::text,true
    );
    update public.lukas_drawing_object_sources set
      status='deleted',version=old.version+1,updated_by=coalesce(v_actor,old.updated_by),
      updated_at=pg_catalog.now()
    where id=old.id and status='active';
    return null;
  end if;
  if not exists(
    select 1 from public.lukas_qto_files f
    where f.id=new.source_file_id and f.project_id=new.project_id
      and f.sha256=new.source_sha256 and f.immutable
      and ((new.source_kind='pdf_region' and f.kind='pdf')
        or (new.source_kind='ifc_element' and f.kind='ifc'))
  ) then
    raise exception using errcode='P1R01',
      message='Drawing source requires its immutable project file identity';
  end if;
  if new.status='active' and not exists(
    select 1 from public.lukas_drawing_objects o
    where o.id=new.object_id and o.revision_id=new.revision_id
      and o.project_id=new.project_id and o.status='active'
  ) then
    raise exception using errcode='P1R01',
      message='Drawing source requires an active owning object';
  end if;
  if tg_op='INSERT' then
    if pg_catalog.current_setting(
        'private.lukas_drawing_source_operation',true
      ) is distinct from new.revision_id::text
      and current_user not in ('authenticated','anon') then
      if exists(
        select 1 from public.lukas_drawing_object_sources existing
        where existing.object_id=new.object_id
          and existing.source_file_id=new.source_file_id
          and existing.source_kind=new.source_kind
          and existing.status='active'
      ) then return null; end if;
      if not exists(
        select 1
        from public.lukas_drawing_objects child
        join public.lukas_drawing_objects parent
          on parent.lineage_id=child.lineage_id
          and parent.project_id=child.project_id
        join public.lukas_drawing_object_sources source
          on source.object_id=parent.id and source.revision_id=parent.revision_id
          and source.project_id=parent.project_id and source.status='active'
        where child.id=new.object_id and child.revision_id=new.revision_id
          and source.source_file_id=new.source_file_id
          and source.source_sha256=new.source_sha256
          and source.source_kind=new.source_kind
          and source.pdf_page_number is not distinct from new.pdf_page_number
          and source.x is not distinct from new.x and source.y is not distinct from new.y
          and source.width is not distinct from new.width
          and source.height is not distinct from new.height
          and source.element_id is not distinct from new.element_id
          and source.ifc_global_id is not distinct from new.ifc_global_id
          and source.camera_json is not distinct from new.camera_json
      ) then return null; end if;
    end if;
    if new.status<>'active' or new.version<>1
      or new.created_by is distinct from v_actor
      or new.updated_by is distinct from v_actor then
      raise exception using errcode='P1C01',
        message='Drawing source initial actor and version are invalid';
    end if;
  else
    if new.id is distinct from old.id
      or new.object_id is distinct from old.object_id
      or new.revision_id is distinct from old.revision_id
      or new.project_id is distinct from old.project_id
      or new.source_file_id is distinct from old.source_file_id
      or new.source_sha256 is distinct from old.source_sha256
      or new.source_kind is distinct from old.source_kind
      or new.pdf_page_number is distinct from old.pdf_page_number
      or new.x is distinct from old.x or new.y is distinct from old.y
      or new.width is distinct from old.width or new.height is distinct from old.height
      or new.element_id is distinct from old.element_id
      or new.ifc_global_id is distinct from old.ifc_global_id
      or new.camera_json is distinct from old.camera_json
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.version<>old.version+1
      or new.updated_by is distinct from v_actor
      or not ((old.status='active' and new.status in ('active','deleted'))
        or (old.status='deleted' and new.status='active')) then
      raise exception using errcode='P1C01',
        message='Drawing source identity, payload, actor, and version are immutable';
    end if;
  end if;
  new.updated_at:=pg_catalog.now();
  return new;
end;
$$;

alter table public.lukas_drawing_issue_anchors
  add column replaces_anchor_id uuid,
  add constraint lukas_drawing_issue_anchors_issue_identity_key
    unique(id,issue_id,project_id),
  add constraint lukas_drawing_issue_anchors_replaces_fkey
    foreign key(replaces_anchor_id,issue_id,project_id)
    references public.lukas_drawing_issue_anchors(id,issue_id,project_id)
    on delete restrict;
create unique index lukas_drawing_issue_anchors_replaces_uidx
  on public.lukas_drawing_issue_anchors(replaces_anchor_id)
  where replaces_anchor_id is not null;

create or replace function private.lukas_drawing_anchor_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_role text:=private.lukas_qto_project_role(new.project_id);
begin
  if v_actor is null then raise exception using errcode='42501',
    message='Authenticated drawing actor required'; end if;
  if tg_op='INSERT' then
    if new.created_by<>v_actor then raise exception using errcode='42501',
      message='Anchor creator must be current user'; end if;
    if v_role not in ('owner','staff','reviewer','estimator','site','procurement')
      then raise exception using errcode='42501',
        message='Project role cannot create drawing anchors'; end if;
    if new.replaces_anchor_id is not null
      and current_user in ('authenticated','anon') then
      raise exception using errcode='42501',
      message='Replacement anchors require the atomic relink function'; end if;
    if not exists(
      select 1 from public.lukas_qto_files f
      where f.id=new.file_id and f.project_id=new.project_id and f.immutable
        and ((new.anchor_kind='ifc_element' and f.kind='ifc')
          or (new.anchor_kind='pdf_region' and f.kind='pdf'))
    ) then raise exception using errcode='P1R01',
      message='Anchor file is not a matching immutable project drawing'; end if;
    return new;
  end if;
  if old.active=false or new.active<>false
    or new.id is distinct from old.id or new.issue_id is distinct from old.issue_id
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
    or new.replaces_anchor_id is distinct from old.replaces_anchor_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception using errcode='P1C01',
      message='Drawing anchors are immutable and may only be deactivated once';
  end if;
  if v_role not in ('owner','staff','reviewer','estimator','site','procurement')
    then raise exception using errcode='42501',
      message='Project role cannot deactivate drawing anchors'; end if;
  new.deactivated_by:=v_actor;
  new.deactivated_at:=pg_catalog.now();
  return new;
end;
$$;
drop trigger if exists lukas_drawing_anchors_guard
  on public.lukas_drawing_issue_anchors;
create trigger lukas_drawing_anchors_guard
before insert or update on public.lukas_drawing_issue_anchors
for each row execute function private.lukas_drawing_anchor_guard();

create or replace function private.lukas_drawing_relink_issue_anchor(
  p_previous_anchor_id uuid,p_new_anchor_id uuid,p_current_file_id uuid,
  p_anchor jsonb,p_note text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_previous public.lukas_drawing_issue_anchors%rowtype;
  v_edge public.lukas_qto_file_revisions%rowtype;
  v_previous_file public.lukas_qto_files%rowtype;
  v_current_file public.lukas_qto_files%rowtype;
begin
  if v_actor is null or p_previous_anchor_id is null or p_new_anchor_id is null
    or p_new_anchor_id=p_previous_anchor_id or p_current_file_id is null
    or pg_catalog.jsonb_typeof(p_anchor)<>'object'
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_note,''))) not between 1 and 1000
    then raise exception using errcode='P1C01',
      message='Drawing anchor relink request is invalid';
  end if;
  select * into v_previous from public.lukas_drawing_issue_anchors
  where id=p_previous_anchor_id for update;
  if not found or not v_previous.active then raise exception using errcode='P1C01',
    message='Drawing anchor predecessor is stale or inactive'; end if;
  if private.lukas_qto_project_role(v_previous.project_id)
    not in ('owner','staff','reviewer','estimator','site','procurement') then
    raise exception using errcode='42501',
      message='Project role cannot relink drawing anchors';
  end if;
  perform 1 from public.lukas_drawing_issues i
    where i.id=v_previous.issue_id and i.project_id=v_previous.project_id
    for update;
  select * into v_edge from public.lukas_qto_file_revisions e
  where e.project_id=v_previous.project_id
    and e.previous_file_id=v_previous.file_id
    and e.current_file_id=p_current_file_id
    and e.relation_kind='supersedes'
  for key share;
  if not found then raise exception using errcode='P1R01',
    message='Drawing anchor relink requires the exact revision edge'; end if;
  select * into v_previous_file from public.lukas_qto_files f
  where f.id=v_edge.previous_file_id and f.project_id=v_edge.project_id
    and f.sha256=v_edge.previous_sha256 and f.immutable for key share;
  select * into v_current_file from public.lukas_qto_files f
  where f.id=v_edge.current_file_id and f.project_id=v_edge.project_id
    and f.sha256=v_edge.current_sha256 and f.immutable for key share;
  if not found or v_previous_file.id is null
    or v_previous_file.kind<>v_current_file.kind
    or v_previous.anchor_kind<>(case v_current_file.kind
      when 'pdf' then 'pdf_region' else 'ifc_element' end)
    or p_anchor->>'fileId' is distinct from p_current_file_id::text
    or p_anchor->>'kind' is distinct from v_previous.anchor_kind then
    raise exception using errcode='P1R01',
      message='Drawing anchor relink file identity or kind is invalid';
  end if;
  if v_previous.anchor_kind='pdf_region' then
    if not (p_anchor ?& array['kind','fileId','pageNumber','x','y','width','height','label'])
      or p_anchor-array['kind','fileId','pageNumber','x','y','width','height','label']<>'{}'::jsonb
      or private.lukas_drawing_p2_positive_integer(p_anchor->'pageNumber') is not true
      or pg_catalog.jsonb_typeof(p_anchor->'x')<>'number'
      or pg_catalog.jsonb_typeof(p_anchor->'y')<>'number'
      or pg_catalog.jsonb_typeof(p_anchor->'width')<>'number'
      or pg_catalog.jsonb_typeof(p_anchor->'height')<>'number'
      or (p_anchor->>'x')::numeric<0 or (p_anchor->>'y')::numeric<0
      or (p_anchor->>'width')::numeric<=0 or (p_anchor->>'height')::numeric<=0
      or (p_anchor->>'x')::numeric+(p_anchor->>'width')::numeric>1
      or (p_anchor->>'y')::numeric+(p_anchor->>'height')::numeric>1 then
      raise exception using errcode='P1C01',message='PDF relink payload is invalid';
    end if;
  else
    if not (p_anchor ?& array['kind','fileId','elementId','ifcGlobalId','camera','label'])
      or p_anchor-array['kind','fileId','elementId','ifcGlobalId','camera','label']<>'{}'::jsonb
      or p_anchor->>'elementId' !~ '^[1-9][0-9]*$'
      or p_anchor->>'ifcGlobalId' !~ '^[0-9A-Za-z_$]{22}$'
      or private.lukas_drawing_p5_camera_valid(p_anchor->'camera') is not true
      or pg_catalog.jsonb_typeof(p_anchor->'camera')<>'object' then
      raise exception using errcode='P1C01',message='IFC relink payload is invalid';
    end if;
  end if;
  if pg_catalog.jsonb_typeof(p_anchor->'label')<>'string'
    or pg_catalog.char_length(p_anchor->>'label')>240 then
    raise exception using errcode='P1C01',message='Anchor label is invalid';
  end if;
  insert into public.lukas_drawing_issue_anchors(
    id,issue_id,project_id,file_id,anchor_kind,element_id,ifc_global_id,
    camera_json,page_number,x,y,width,height,label,active,created_by,replaces_anchor_id
  ) values(
    p_new_anchor_id,v_previous.issue_id,v_previous.project_id,p_current_file_id,
    v_previous.anchor_kind,
    case when v_previous.anchor_kind='ifc_element' then p_anchor->>'elementId' end,
    case when v_previous.anchor_kind='ifc_element' then p_anchor->>'ifcGlobalId' end,
    case when v_previous.anchor_kind='ifc_element' then p_anchor->'camera' end,
    case when v_previous.anchor_kind='pdf_region' then (p_anchor->>'pageNumber')::integer end,
    case when v_previous.anchor_kind='pdf_region' then (p_anchor->>'x')::numeric end,
    case when v_previous.anchor_kind='pdf_region' then (p_anchor->>'y')::numeric end,
    case when v_previous.anchor_kind='pdf_region' then (p_anchor->>'width')::numeric end,
    case when v_previous.anchor_kind='pdf_region' then (p_anchor->>'height')::numeric end,
    p_anchor->>'label',true,v_actor,v_previous.id
  );
  update public.lukas_drawing_issue_anchors set
    active=false,deactivation_note=pg_catalog.btrim(p_note)
  where id=v_previous.id and active;
  if not found then raise exception using errcode='P1C01',
    message='Drawing anchor predecessor became stale'; end if;
  return pg_catalog.jsonb_build_object(
    'previousAnchorId',v_previous.id,'newAnchorId',p_new_anchor_id
  );
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or sqlstate '42501'
    or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation
    or not_null_violation then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

create or replace function public.lukas_drawing_relink_issue_anchor(
  p_previous_anchor_id uuid,p_new_anchor_id uuid,p_current_file_id uuid,
  p_anchor jsonb,p_note text
) returns jsonb language sql security definer set search_path='' as $$
  select private.lukas_drawing_relink_issue_anchor(
    p_previous_anchor_id,p_new_anchor_id,p_current_file_id,p_anchor,p_note
  )
$$;

create or replace function private.lukas_drawing_apply_source_actions(
  p_revision_id uuid,p_project_id uuid,p_actor uuid,
  p_actions jsonb,p_result_versions jsonb
) returns void language plpgsql security definer set search_path='' as $$
declare v_action jsonb; v_entity jsonb; v_id uuid; v_row jsonb; v_version bigint;
begin
  if pg_catalog.jsonb_typeof(p_actions)<>'array' then return; end if;
  perform pg_catalog.set_config(
    'private.lukas_drawing_source_operation',p_revision_id::text,true
  );
  for v_action in
    select value from pg_catalog.jsonb_array_elements(p_actions)
  loop
    if v_action->>'kind' not in ('put_source','delete_source') then continue; end if;
    v_entity:=v_action->'entity';
    v_id:=coalesce((v_entity->>'id')::uuid,(v_action->>'id')::uuid);
    if v_action->>'kind'='delete_source' then
      update public.lukas_drawing_object_sources set
        status='deleted',version=(v_action->>'baseVersion')::bigint+1,
        updated_by=p_actor
      where id=v_id and revision_id=p_revision_id and project_id=p_project_id
        and status='active' and version=(v_action->>'baseVersion')::bigint;
      if not found then raise exception using errcode='P1C01',
        message='Drawing source delete base version is stale'; end if;
    else
      v_version:=(p_result_versions->>v_id::text)::bigint;
      v_row:=private.lukas_drawing_source_json(
        v_id,p_revision_id,p_project_id,false
      );
      if v_row is null then
        if v_version<>1 then raise exception using errcode='P1C01',
          message='Drawing source initial result version is invalid'; end if;
        insert into public.lukas_drawing_object_sources(
          id,object_id,revision_id,project_id,source_file_id,source_sha256,
          source_kind,pdf_page_number,x,y,width,height,element_id,ifc_global_id,
          camera_json,status,version,created_by,updated_by
        ) values(
          v_id,(v_entity->>'objectId')::uuid,p_revision_id,p_project_id,
          (v_entity->>'sourceFileId')::uuid,v_entity->>'sourceSha256',
          v_entity->>'sourceKind',nullif(v_entity->>'pdfPageNumber','')::integer,
          nullif(v_entity->>'x','')::numeric,nullif(v_entity->>'y','')::numeric,
          nullif(v_entity->>'width','')::numeric,nullif(v_entity->>'height','')::numeric,
          nullif(v_entity->>'elementId',''),nullif(v_entity->>'ifcGlobalId',''),
          case when pg_catalog.jsonb_typeof(v_entity->'camera')='null'
            then null else v_entity->'camera' end,
          'active',v_version,p_actor,p_actor
        );
      else
        if (v_row-'version') is distinct from (v_entity-'version') then
          raise exception using errcode='P1C01',
            message='Drawing source payload is immutable';
        end if;
        update public.lukas_drawing_object_sources set
          status='active',version=v_version,updated_by=p_actor
        where id=v_id and revision_id=p_revision_id and project_id=p_project_id
          and version=v_version-1;
        if not found then raise exception using errcode='P1C01',
          message='Drawing source put result version is stale'; end if;
      end if;
    end if;
  end loop;
  if exists(
    select 1 from public.lukas_drawing_object_sources s
    left join public.lukas_drawing_objects o
      on o.id=s.object_id and o.revision_id=s.revision_id
      and o.project_id=s.project_id and o.status='active'
    where s.revision_id=p_revision_id and s.project_id=p_project_id
      and s.status='active' and o.id is null
  ) then raise exception using errcode='P1C01',
    message='Drawing source final graph has an inactive owner'; end if;
end;
$$;

create function private.lukas_drawing_operations_apply_sources()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if pg_catalog.jsonb_typeof(new.forward->'actions')='array' and exists(
    select 1 from pg_catalog.jsonb_array_elements(new.forward->'actions') a
    where a->>'kind' in ('put_source','delete_source')
  ) then
    perform private.lukas_drawing_apply_source_actions(
      new.revision_id,new.project_id,new.actor_id,
      new.forward->'actions',new.result_versions
    );
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_operations_apply_sources
after insert on public.lukas_drawing_operations
for each row execute function private.lukas_drawing_operations_apply_sources();

create function private.lukas_drawing_validate_source_actions(
  p_revision_id uuid,p_project_id uuid,p_actions jsonb,p_inverse_actions jsonb
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  v_action jsonb; v_inverse jsonb; v_previous jsonb; v_tombstone jsonb;
  v_entity jsonb; v_expected_inverse jsonb:='[]'::jsonb;
  v_bases jsonb:='{}'::jsonb; v_results jsonb:='{}'::jsonb;
  v_id uuid; v_base bigint; v_new bigint;
begin
  if pg_catalog.jsonb_typeof(p_actions)<>'array'
    or pg_catalog.jsonb_typeof(p_inverse_actions)<>'array'
    or pg_catalog.jsonb_array_length(p_actions)
      <>pg_catalog.jsonb_array_length(p_inverse_actions)
    or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_actions) a
      where a->>'kind' not in ('put_source','delete_source')
        or private.lukas_drawing_structure_action_valid(a,p_revision_id) is not true
    ) or exists(
      select 1 from pg_catalog.jsonb_array_elements(p_actions) a
      group by coalesce(a->'entity'->>'id',a->>'id') having pg_catalog.count(*)>1
    ) then raise exception using errcode='P1C01',
      message='Drawing source actions are invalid';
  end if;
  for v_action in select value from pg_catalog.jsonb_array_elements(p_actions)
  loop
    v_entity:=v_action->'entity';
    v_id:=coalesce((v_entity->>'id')::uuid,(v_action->>'id')::uuid);
    v_previous:=private.lukas_drawing_source_json(
      v_id,p_revision_id,p_project_id,true
    );
    if v_action->>'kind'='delete_source' then
      v_base:=(v_action->>'baseVersion')::bigint;
      if v_previous is null or (v_previous->>'version')::bigint<>v_base then
        raise exception using errcode='P1C01',
          message='Drawing source delete base version is stale';
      end if;
      v_new:=v_base+1;
      v_bases:=v_bases||pg_catalog.jsonb_build_object(v_id::text,v_base);
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,null);
      v_inverse:=pg_catalog.jsonb_build_object(
        'kind','put_source','entity',v_previous,'baseVersion',null
      );
    elsif pg_catalog.jsonb_typeof(v_action->'baseVersion')='null' then
      if v_previous is not null then raise exception using errcode='P1C01',
        message='Drawing source already exists'; end if;
      v_tombstone:=private.lukas_drawing_structure_tombstone(
        p_revision_id,v_id,'put_source'
      );
      if v_tombstone is null then
        if private.lukas_drawing_structure_raw_id_exists(v_id)
          or private.lukas_drawing_structure_raw_id_recorded(p_revision_id,v_id)
          or (v_entity->>'version')::bigint<>1 then
          raise exception using errcode='P1C01',
            message='Drawing source raw ID collision';
        end if;
        v_new:=1;
      else
        if v_entity is distinct from v_tombstone then
          raise exception using errcode='P1C01',
            message='Drawing source restore must match its exact tombstone';
        end if;
        v_new:=(v_tombstone->>'version')::bigint+2;
      end if;
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,v_new);
      v_inverse:=pg_catalog.jsonb_build_object(
        'kind','delete_source','id',v_id,'baseVersion',v_new
      );
    else
      v_base:=(v_action->>'baseVersion')::bigint;
      if v_previous is null or (v_previous->>'version')::bigint<>v_base
        or (v_entity->>'version')::bigint<>v_base
        or (v_entity-'version') is distinct from (v_previous-'version') then
        raise exception using errcode='P1C01',
          message='Drawing source put base version or payload is stale';
      end if;
      v_new:=v_base+1;
      v_bases:=v_bases||pg_catalog.jsonb_build_object(v_id::text,v_base);
      v_results:=v_results||pg_catalog.jsonb_build_object(v_id::text,v_new);
      v_inverse:=pg_catalog.jsonb_build_object(
        'kind','put_source','entity',v_previous,'baseVersion',v_new
      );
    end if;
    v_expected_inverse:=pg_catalog.jsonb_build_array(v_inverse)||v_expected_inverse;
  end loop;
  if v_expected_inverse is distinct from p_inverse_actions then
    raise exception using errcode='P1C01',
      message='Drawing source inverse is not exact';
  end if;
  return pg_catalog.jsonb_build_object('bases',v_bases,'results',v_results);
end;
$$;

alter function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) rename to lukas_drawing_apply_operation_pre_p5_sources;
create function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_sources jsonb; v_inverse_sources jsonb; v_core jsonb; v_inverse_core jsonb;
  v_plan jsonb; v_core_bases jsonb; v_result jsonb; v_results jsonb;
  v_source_ids text[]; v_operation_id uuid;
begin
  if p_operation_type='restore_checkpoint' then
    perform pg_catalog.set_config(
      'private.lukas_drawing_p5_checkpoint_operation',p_revision_id::text,true
    );
    v_result:=private.lukas_drawing_apply_operation_pre_p5_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
    perform pg_catalog.set_config(
      'private.lukas_drawing_p5_checkpoint_operation','',true
    );
    return v_result;
  end if;
  if p_operation_type<>'mutate_objects_with_references'
    or p_forward->>'type'<>'mutate_objects_with_references' then
    return private.lukas_drawing_apply_operation_pre_p5_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and v_actor is not null
    and private.lukas_drawing_workspace_capability(r.project_id) in ('admin','editor')
  for update;
  if not found then raise exception using errcode='P1R01',
    message='Drawing revision target is unavailable'; end if;
  select * into v_existing from public.lukas_drawing_operations o
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
  select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
    into v_sources from pg_catalog.jsonb_array_elements(p_forward->'actions')
      with ordinality a(value,ordinality)
    where a.value->>'kind' in ('put_source','delete_source');
  select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
    into v_inverse_sources from pg_catalog.jsonb_array_elements(p_inverse->'actions')
      with ordinality a(value,ordinality)
    where a.value->>'kind' in ('put_source','delete_source');
  if pg_catalog.jsonb_array_length(v_sources)=0 then
    if exists(
      select 1 from public.lukas_drawing_object_sources s
      where s.revision_id=p_revision_id and s.status='active'
        and exists(select 1 from pg_catalog.jsonb_array_elements(p_forward->'objects') o
          where o->>'id'=s.object_id::text)
    ) then raise exception using errcode='P1C01',
      message='Reference-aware object mutation must carry every source'; end if;
    return private.lukas_drawing_apply_operation_pre_p5_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  v_plan:=private.lukas_drawing_validate_source_actions(
    p_revision_id,v_revision.project_id,v_sources,v_inverse_sources
  );
  select pg_catalog.array_agg(key) into v_source_ids
    from pg_catalog.jsonb_object_keys(v_plan->'results') key;
  v_core_bases:=p_base_versions-coalesce(v_source_ids,array[]::text[]);
  if p_base_versions is distinct from v_core_bases||(v_plan->'bases') then
    raise exception using errcode='P1C01',
      message='Drawing source base versions are incomplete';
  end if;
  select pg_catalog.jsonb_set(p_forward,'{actions}',coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind' not in ('put_source','delete_source')),
    '[]'::jsonb),false) into v_core
  from pg_catalog.jsonb_array_elements(p_forward->'actions')
    with ordinality a(value,ordinality);
  select pg_catalog.jsonb_set(p_inverse,'{actions}',coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind' not in ('put_source','delete_source')),
    '[]'::jsonb),false) into v_inverse_core
  from pg_catalog.jsonb_array_elements(p_inverse->'actions')
    with ordinality a(value,ordinality);

  v_result:=private.lukas_drawing_apply_operation_pre_p5_sources(
    p_revision_id,p_client_operation_id,p_operation_type,v_core_bases,
    v_core,v_inverse_core,p_history_action,p_original_operation_id
  );
  v_results:=(v_result->'resultVersions')||(v_plan->'results');
  perform private.lukas_drawing_apply_source_actions(
    p_revision_id,v_revision.project_id,v_actor,v_sources,v_results
  );
  v_operation_id:=(v_result->>'operationId')::uuid;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite',v_operation_id::text,true
  );
  update public.lukas_drawing_operations set
    base_versions=p_base_versions,forward=p_forward,inverse=p_inverse,
    result_versions=v_results
  where id=v_operation_id;
  perform pg_catalog.set_config('private.lukas_drawing_p2_operation_rewrite','',true);
  return v_result||pg_catalog.jsonb_build_object('resultVersions',v_results);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01'
    or serialization_failure or deadlock_detected then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

alter function private.lukas_drawing_p2_canonical_snapshot(uuid,boolean)
  rename to lukas_drawing_p2_canonical_snapshot_pre_p5_sources;
create function private.lukas_drawing_p2_canonical_snapshot(
  p_revision_id uuid,p_include_instance_lineage boolean
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_snapshot jsonb; v_sources jsonb;
begin
  v_snapshot:=private.lukas_drawing_p2_canonical_snapshot_pre_p5_sources(
    p_revision_id,p_include_instance_lineage
  );
  if v_snapshot is null then return null; end if;
  select coalesce(pg_catalog.jsonb_agg(
    private.lukas_drawing_source_json(s.id,s.revision_id,s.project_id,true)
    order by s.id
  ),'[]'::jsonb) into v_sources
  from public.lukas_drawing_object_sources s
  where s.revision_id=p_revision_id and s.status='active';
  return pg_catalog.jsonb_set(v_snapshot,'{sources}',v_sources,false);
end;
$$;

alter function private.lukas_drawing_create_from_template(uuid,text,uuid)
  rename to lukas_drawing_create_from_template_pre_p5_sources;
create function private.lukas_drawing_create_from_template(
  p_source_revision_id uuid,p_title text,p_source_file_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_result jsonb; v_revision_id uuid;
begin
  v_result:=private.lukas_drawing_create_from_template_pre_p5_sources(
    p_source_revision_id,p_title,p_source_file_id
  );
  v_revision_id:=(v_result->>'revisionId')::uuid;
  insert into public.lukas_drawing_object_sources(
    id,object_id,revision_id,project_id,source_file_id,source_sha256,
    source_kind,pdf_page_number,x,y,width,height,element_id,ifc_global_id,
    camera_json,status,version,created_by,updated_by
  ) select
    extensions.gen_random_uuid(),child.id,v_revision_id,source.project_id,
    source.source_file_id,source.source_sha256,source.source_kind,
    source.pdf_page_number,source.x,source.y,source.width,source.height,
    source.element_id,source.ifc_global_id,source.camera_json,
    'active',1,v_actor,v_actor
  from public.lukas_drawing_object_sources source
  join public.lukas_drawing_objects parent
    on parent.id=source.object_id and parent.revision_id=p_source_revision_id
    and parent.project_id=source.project_id and parent.status='active'
  join public.lukas_drawing_objects child
    on child.lineage_id=parent.lineage_id and child.revision_id=v_revision_id
    and child.project_id=parent.project_id and child.status='active'
  where source.revision_id=p_source_revision_id and source.status='active'
    and not exists(
      select 1 from public.lukas_drawing_object_sources existing
      where existing.object_id=child.id
        and existing.source_file_id=source.source_file_id
        and existing.source_kind=source.source_kind and existing.status='active'
    );
  return v_result;
end;
$$;

create function private.lukas_drawing_p5_checkpoint_sources(
  p_sources jsonb,p_revision_id uuid
) returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare
  v_source jsonb;
  v_result jsonb:='[]'::jsonb;
  v_legacy_keys text[]:=array[
    'id','objectId','sourceFileId','sourceSha256','sourceKind',
    'pdfPageNumber','x','y','width','height','elementId','ifcGlobalId','camera'
  ];
begin
  if pg_catalog.jsonb_typeof(p_sources)<>'array' then return p_sources; end if;
  for v_source in select value from pg_catalog.jsonb_array_elements(p_sources)
  loop
    if pg_catalog.jsonb_typeof(v_source)='object'
      and v_source ?& v_legacy_keys
      and v_source-v_legacy_keys='{}'::jsonb then
      if v_source->>'sourceKind'='pdf_region' then
        v_source:=pg_catalog.jsonb_build_object(
          'id',v_source->'id','objectId',v_source->'objectId',
          'revisionId',p_revision_id,'sourceFileId',v_source->'sourceFileId',
          'sourceSha256',v_source->'sourceSha256','sourceKind','pdf_region',
          'pdfPageNumber',v_source->'pdfPageNumber','x',v_source->'x',
          'y',v_source->'y','width',v_source->'width','height',v_source->'height',
          'version',1
        );
      elsif v_source->>'sourceKind'='ifc_element' then
        v_source:=pg_catalog.jsonb_build_object(
          'id',v_source->'id','objectId',v_source->'objectId',
          'revisionId',p_revision_id,'sourceFileId',v_source->'sourceFileId',
          'sourceSha256',v_source->'sourceSha256','sourceKind','ifc_element',
          'ifcGlobalId',v_source->'ifcGlobalId','elementId',v_source->'elementId',
          'camera',v_source->'camera','version',1
        );
      end if;
    end if;
    v_result:=v_result||pg_catalog.jsonb_build_array(v_source);
  end loop;
  return v_result;
end;
$$;

alter function private.lukas_drawing_apply_operation_pre_p4_semantic_objects(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) rename to lukas_drawing_apply_operation_pre_p5_checkpoint_sources;
create function private.lukas_drawing_apply_operation_pre_p4_semantic_objects(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_snapshot public.lukas_drawing_snapshots%rowtype;
  v_existing public.lukas_drawing_operations%rowtype;
  v_issue jsonb; v_action jsonb; v_identity jsonb; v_result jsonb;
  v_sources jsonb; v_inverse_sources jsonb; v_core jsonb; v_inverse_core jsonb;
  v_plan jsonb; v_core_bases jsonb; v_results jsonb; v_live_sources jsonb;
  v_snapshot_sources jsonb; v_target_sources jsonb; v_live_issues jsonb;
  v_source_ids text[];
  v_operation_id uuid; v_sequence bigint;
begin
  if p_operation_type<>'restore_checkpoint' then
    return private.lukas_drawing_apply_operation_pre_p5_checkpoint_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  select s.* into v_snapshot from public.lukas_drawing_snapshots s
  where s.id=(p_forward->>'checkpointId')::uuid
    and s.revision_id=p_revision_id for share;
  if not found or not (
    exists(select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'sources'
    ) s where s ? 'revisionId')
    or exists(select 1 from pg_catalog.jsonb_array_elements(
      p_forward->'actions'
    ) a where a->>'kind' in ('put_source','delete_source'))
  ) then
    return private.lukas_drawing_apply_operation_pre_p5_checkpoint_sources(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;
  select o.* into v_existing from public.lukas_drawing_operations o
  where o.revision_id=p_revision_id
    and o.client_operation_id=p_client_operation_id;
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
  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.status='draft'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor') for update;
  if not found or v_snapshot.schema_version<>2
    or v_snapshot.sha256 is distinct from pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(
        v_snapshot.canonical_json::text,'UTF8'),'sha256'),'hex'
  ) then raise exception using errcode='P1C01',
      message='Drawing checkpoint reference target is invalid'; end if;
  v_snapshot_sources:=private.lukas_drawing_p5_checkpoint_sources(
    v_snapshot.canonical_json->'sources',p_revision_id
  );
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(v_snapshot_sources) s
    where private.lukas_drawing_structure_action_valid(
      pg_catalog.jsonb_build_object(
        'kind','put_source','entity',s,'baseVersion',null
      ),p_revision_id
    ) is not true
      or not exists(select 1 from pg_catalog.jsonb_array_elements(
        v_snapshot.canonical_json->'objects'
      ) o where o->>'id'=s->>'objectId')
      or not exists(select 1 from public.lukas_qto_files f
        where f.id=(s->>'sourceFileId')::uuid
          and f.project_id=v_revision.project_id
          and f.sha256=s->>'sourceSha256' and f.immutable
          and ((s->>'sourceKind'='pdf_region' and f.kind='pdf')
            or (s->>'sourceKind'='ifc_element' and f.kind='ifc')))
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(v_snapshot_sources) s
    group by s->>'objectId',s->>'sourceFileId',s->>'sourceKind'
      having pg_catalog.count(*)>1
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'issues'
    ) i where not (i ?& array['id','objectId'])
      or i-array['id','objectId']<>'{}'::jsonb
      or not exists(select 1 from pg_catalog.jsonb_array_elements(
        v_snapshot.canonical_json->'objects'
      ) o where o->>'id'=i->>'objectId')
      or not exists(select 1 from public.lukas_drawing_issues x
        where x.id=(i->>'id')::uuid and x.project_id=v_revision.project_id)
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'issues'
    ) i group by i->>'id',i->>'objectId' having pg_catalog.count(*)>1
  ) then raise exception using errcode='P1C01',
    message='Drawing checkpoint source graph is invalid'; end if;

  select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
    into v_sources from pg_catalog.jsonb_array_elements(p_forward->'actions')
      with ordinality a(value,ordinality)
    where a.value->>'kind' in ('put_source','delete_source');
  select coalesce(pg_catalog.jsonb_agg(a.value order by a.ordinality),'[]'::jsonb)
    into v_inverse_sources from pg_catalog.jsonb_array_elements(p_inverse->'actions')
      with ordinality a(value,ordinality)
    where a.value->>'kind' in ('put_source','delete_source');
  v_plan:=private.lukas_drawing_validate_source_actions(
    p_revision_id,v_revision.project_id,v_sources,v_inverse_sources
  );
  select pg_catalog.array_agg(key) into v_source_ids
    from pg_catalog.jsonb_object_keys(v_plan->'results') key;
  v_core_bases:=p_base_versions-coalesce(v_source_ids,array[]::text[]);
  if p_base_versions is distinct from v_core_bases||(v_plan->'bases') then
    raise exception using errcode='P1C01',
      message='Drawing checkpoint source base versions are incomplete';
  end if;
  select pg_catalog.jsonb_set(p_forward,'{actions}',coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind' not in ('put_source','delete_source')),
    '[]'::jsonb),false) into v_core
  from pg_catalog.jsonb_array_elements(p_forward->'actions')
    with ordinality a(value,ordinality);
  select pg_catalog.jsonb_set(p_inverse,'{actions}',coalesce(
    pg_catalog.jsonb_agg(a.value order by a.ordinality)
      filter(where a.value->>'kind' not in ('put_source','delete_source')),
    '[]'::jsonb),false) into v_inverse_core
  from pg_catalog.jsonb_array_elements(p_inverse->'actions')
    with ordinality a(value,ordinality);

  insert into private.lukas_drawing_checkpoint_reference_targets(
    transaction_id,actor_id,revision_id,snapshot_id,sources,issues
  ) values(
    pg_catalog.txid_current(),v_actor,p_revision_id,v_snapshot.id,
    v_snapshot_sources,v_snapshot.canonical_json->'issues'
  );

  insert into private.lukas_drawing_checkpoint_issue_delete_leases(
    transaction_id,actor_id,revision_id,link_id
  ) select pg_catalog.txid_current(),v_actor,p_revision_id,l.id
    from public.lukas_drawing_object_issue_links l
    where l.revision_id=p_revision_id and not exists(
      select 1 from pg_catalog.jsonb_array_elements(
        v_snapshot.canonical_json->'issues'
      ) i where i->>'id'=l.issue_id::text and i->>'objectId'=l.object_id::text
    );
  insert into private.lukas_drawing_checkpoint_reference_history(
    revision_id,project_id,snapshot_id,client_operation_id,actor_id,
    link_kind,action,link_identity
  ) select p_revision_id,v_revision.project_id,v_snapshot.id,
      p_client_operation_id,v_actor,'issue','delete',pg_catalog.to_jsonb(l)
    from public.lukas_drawing_object_issue_links l
    join private.lukas_drawing_checkpoint_issue_delete_leases x
      on x.transaction_id=pg_catalog.txid_current() and x.actor_id=v_actor
      and x.revision_id=p_revision_id and x.link_id=l.id;
  delete from public.lukas_drawing_object_issue_links l
    using private.lukas_drawing_checkpoint_issue_delete_leases x
    where x.transaction_id=pg_catalog.txid_current() and x.actor_id=v_actor
      and x.revision_id=p_revision_id and x.link_id=l.id;

  for v_action in select value from pg_catalog.jsonb_array_elements(p_forward->'actions')
  loop
    if v_action->>'kind' in ('put_source','delete_source') then
      v_identity:=case when v_action->>'kind'='put_source'
        then v_action->'entity'
        else private.lukas_drawing_source_json(
          (v_action->>'id')::uuid,p_revision_id,v_revision.project_id,true
        ) end;
      insert into private.lukas_drawing_checkpoint_reference_history(
        revision_id,project_id,snapshot_id,client_operation_id,actor_id,
        link_kind,action,link_identity
      ) values(p_revision_id,v_revision.project_id,v_snapshot.id,
        p_client_operation_id,v_actor,'source',
        case when v_action->>'kind'='put_source' then 'restore' else 'delete' end,
        v_identity);
    end if;
  end loop;

  if pg_catalog.jsonb_array_length(v_core->'actions')=0 then
    select coalesce(pg_catalog.max(o.sequence),0)+1 into v_sequence
    from public.lukas_drawing_operations o where o.revision_id=p_revision_id;
    v_operation_id:=extensions.gen_random_uuid();
    v_results:=v_plan->'results';
    insert into public.lukas_drawing_operations(
      id,revision_id,project_id,sequence,client_operation_id,operation_type,
      base_versions,forward,inverse,result_versions,actor_id,
      history_action,original_operation_id
    ) values(
      v_operation_id,p_revision_id,v_revision.project_id,v_sequence,
      p_client_operation_id,p_operation_type,p_base_versions,p_forward,
      p_inverse,v_results,v_actor,p_history_action,p_original_operation_id
    );
    v_result:=pg_catalog.jsonb_build_object(
      'operationId',v_operation_id,'sequence',v_sequence
    );
  else
    v_result:=private.lukas_drawing_apply_operation_pre_checkpoint_reference_authority(
      p_revision_id,p_client_operation_id,p_operation_type,v_core_bases,
      v_core,v_inverse_core,p_history_action,p_original_operation_id
    );
    v_results:=(v_result->'resultVersions')||(v_plan->'results');
    perform private.lukas_drawing_apply_source_actions(
      p_revision_id,v_revision.project_id,v_actor,v_sources,v_results
    );
    v_operation_id:=(v_result->>'operationId')::uuid;
  end if;
  perform pg_catalog.set_config(
    'private.lukas_drawing_p2_operation_rewrite',v_operation_id::text,true
  );
  update public.lukas_drawing_operations set
    base_versions=p_base_versions,forward=p_forward,inverse=p_inverse,
    result_versions=v_results
  where id=v_operation_id;
  perform pg_catalog.set_config('private.lukas_drawing_p2_operation_rewrite','',true);

  for v_issue in select value from pg_catalog.jsonb_array_elements(
    v_snapshot.canonical_json->'issues'
  ) loop
    if not exists(select 1 from public.lukas_drawing_object_issue_links l
      where l.object_id=(v_issue->>'objectId')::uuid
        and l.issue_id=(v_issue->>'id')::uuid) then
      insert into public.lukas_drawing_object_issue_links(
        object_id,revision_id,issue_id,project_id,created_by
      ) values((v_issue->>'objectId')::uuid,p_revision_id,
        (v_issue->>'id')::uuid,v_revision.project_id,v_actor);
      insert into private.lukas_drawing_checkpoint_reference_history(
        revision_id,project_id,snapshot_id,client_operation_id,actor_id,
        link_kind,action,link_identity
      ) values(p_revision_id,v_revision.project_id,v_snapshot.id,
        p_client_operation_id,v_actor,'issue','restore',v_issue);
    end if;
  end loop;
  delete from private.lukas_drawing_checkpoint_issue_delete_leases l
    where l.transaction_id=pg_catalog.txid_current() and l.actor_id=v_actor
      and l.revision_id=p_revision_id;
  delete from private.lukas_drawing_checkpoint_reference_targets t
    where t.transaction_id=pg_catalog.txid_current() and t.actor_id=v_actor
      and t.revision_id=p_revision_id;
  select coalesce(pg_catalog.jsonb_agg(s.value-'version' order by s.value->>'id'),
    '[]'::jsonb) into v_live_sources
  from pg_catalog.jsonb_array_elements(
    private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true)->'sources'
  ) s;
  select coalesce(pg_catalog.jsonb_agg(s.value-'version' order by s.value->>'id'),
    '[]'::jsonb) into v_target_sources
  from pg_catalog.jsonb_array_elements(v_snapshot_sources) s;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',l.issue_id,'objectId',l.object_id
  ) order by l.issue_id,l.object_id),'[]'::jsonb) into v_live_issues
  from public.lukas_drawing_object_issue_links l where l.revision_id=p_revision_id;
  if v_live_sources is distinct from v_target_sources
    or v_live_issues is distinct from v_snapshot.canonical_json->'issues' then
    raise exception using errcode='P1C01',
      message='Drawing checkpoint reference delta does not match its snapshot';
  end if;
  return v_result||pg_catalog.jsonb_build_object('resultVersions',v_results);
end;
$$;

drop policy if exists "workspace editors add draft drawing object sources"
  on public.lukas_drawing_object_sources;
drop policy if exists "workspace editors update draft drawing object sources"
  on public.lukas_drawing_object_sources;
drop policy if exists "workspace editors delete draft drawing object sources"
  on public.lukas_drawing_object_sources;
drop policy if exists "project members read drawing object sources"
  on public.lukas_drawing_object_sources;
create policy "project members read active drawing object sources"
on public.lukas_drawing_object_sources for select to authenticated
using (
  status='active'
  and (select private.lukas_drawing_workspace_capability(project_id)) is not null
);

revoke all on table public.lukas_drawing_object_sources from public,anon;
revoke insert,update,delete on table public.lukas_drawing_object_sources
  from authenticated;
grant select on table public.lukas_drawing_object_sources to authenticated;
grant all on table public.lukas_drawing_object_sources to service_role;

revoke all on function
  private.lukas_drawing_p5_camera_valid(jsonb),
  private.lukas_drawing_object_source_guard(),
  private.lukas_drawing_anchor_guard(),
  private.lukas_drawing_relink_issue_anchor(uuid,uuid,uuid,jsonb,text),
  private.lukas_drawing_source_json(uuid,uuid,uuid,boolean),
  private.lukas_drawing_structure_entity_json_pre_p5_sources(text,uuid,uuid,uuid),
  private.lukas_drawing_structure_tombstone_pre_p5_sources(uuid,uuid,text),
  private.lukas_drawing_structure_tombstone(uuid,uuid,text),
  private.lukas_drawing_structure_action_valid_pre_p5_sources(jsonb,uuid),
  private.lukas_drawing_apply_source_actions(uuid,uuid,uuid,jsonb,jsonb),
  private.lukas_drawing_operations_apply_sources(),
  private.lukas_drawing_validate_source_actions(uuid,uuid,jsonb,jsonb),
  private.lukas_drawing_p2_canonical_snapshot_pre_p5_sources(uuid,boolean),
  private.lukas_drawing_create_from_template_pre_p5_sources(uuid,text,uuid),
  private.lukas_drawing_create_from_template(uuid,text,uuid),
  private.lukas_drawing_apply_operation_pre_p5_checkpoint_sources(
    uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
  ),
  private.lukas_drawing_p5_checkpoint_sources(jsonb,uuid),
  private.lukas_drawing_apply_operation_pre_p4_semantic_objects(
    uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
  ),
  private.lukas_drawing_apply_operation_pre_p5_sources(
    uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
  )
from public,anon,authenticated,service_role;
revoke all on function private.lukas_drawing_structure_entity_json(
  text,uuid,uuid,uuid
),private.lukas_drawing_structure_action_valid(jsonb,uuid),
  private.lukas_drawing_structure_raw_id_exists(uuid),
  private.lukas_drawing_p2_canonical_snapshot(uuid,boolean)
from public,anon,authenticated,service_role;

revoke all on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) from public,anon;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) to authenticated,service_role;

revoke all on function public.lukas_drawing_relink_issue_anchor(
  uuid,uuid,uuid,jsonb,text
) from public,anon,authenticated,service_role;
grant execute on function public.lukas_drawing_relink_issue_anchor(
  uuid,uuid,uuid,jsonb,text
) to authenticated,service_role;

alter default privileges revoke execute on functions from public;

commit;
