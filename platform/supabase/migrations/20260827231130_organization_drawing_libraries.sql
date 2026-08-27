begin;

alter table public.lukas_qto_projects
  add constraint lukas_qto_projects_id_organization_key
  unique (id,organization_id);

create table public.lukas_drawing_library_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null
    references public.lukas_qto_organizations(id) on delete restrict,
  kind text not null check (kind in ('style','block','property_schema','workspace_template')),
  name text not null check (
    name=pg_catalog.btrim(name)
    and pg_catalog.char_length(name) between 1 and 255
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  unique (id,organization_id),
  unique (organization_id,kind,name)
);

create table public.lukas_drawing_library_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  registry_id uuid not null,
  organization_id uuid not null,
  version_no bigint not null check (version_no>0),
  status text not null check (status in ('draft','published','deprecated')),
  canonical_payload jsonb not null check (
    pg_catalog.jsonb_typeof(canonical_payload)='object'
    and pg_catalog.octet_length(canonical_payload::text)<=4194304
  ),
  content_sha256 text not null check (content_sha256~'^[0-9a-f]{64}$'),
  predecessor_version_id uuid,
  predecessor_registry_id uuid,
  predecessor_organization_id uuid,
  source_project_id uuid not null,
  source_revision_id uuid not null,
  source_entity_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  published_at timestamptz,
  deprecated_at timestamptz,
  unique (id,registry_id,organization_id),
  unique (registry_id,version_no),
  constraint lukas_drawing_library_versions_content_sha_check check (
    content_sha256=pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(canonical_payload::text,'UTF8'),'sha256'
    ),'hex')
  ),
  constraint lukas_drawing_library_versions_registry_fkey
    foreign key (registry_id,organization_id)
    references public.lukas_drawing_library_entries(id,organization_id)
    on delete restrict,
  constraint lukas_drawing_library_versions_predecessor_fkey
    foreign key (predecessor_version_id,predecessor_registry_id,predecessor_organization_id)
    references public.lukas_drawing_library_versions(id,registry_id,organization_id)
    on delete restrict,
  constraint lukas_drawing_library_versions_source_project_fkey
    foreign key (source_project_id,organization_id)
    references public.lukas_qto_projects(id,organization_id) on delete restrict,
  constraint lukas_drawing_library_versions_source_revision_fkey
    foreign key (source_revision_id,source_project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete restrict,
  check (
    (predecessor_version_id is null and predecessor_registry_id is null
      and predecessor_organization_id is null)
    or (predecessor_version_id is not null and predecessor_registry_id=registry_id
      and predecessor_organization_id=organization_id)
  ),
  check (
    (version_no=1 and predecessor_version_id is null)
    or (version_no>1 and predecessor_version_id is not null)
  ),
  check (
    (status='draft' and published_by is null and published_at is null
      and deprecated_at is null)
    or (status='published' and published_by is not null and published_at is not null
      and deprecated_at is null)
    or (status='deprecated' and published_by is not null and published_at is not null
      and deprecated_at is not null)
  )
);

create table public.lukas_drawing_library_imports (
  id uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null,
  registry_id uuid not null,
  version_id uuid not null,
  project_id uuid not null,
  revision_id uuid,
  target_entity_id uuid,
  target_document_id uuid,
  target_revision_id uuid,
  source_content_sha256 text not null check (source_content_sha256~'^[0-9a-f]{64}$'),
  imported_by uuid not null references auth.users(id) on delete restrict,
  client_request_id uuid not null,
  request_sha256 text not null check (request_sha256~'^[0-9a-f]{64}$'),
  imported_at timestamptz not null default pg_catalog.now(),
  unique (id,organization_id),
  unique (imported_by,client_request_id),
  constraint lukas_drawing_library_imports_version_fkey
    foreign key (version_id,registry_id,organization_id)
    references public.lukas_drawing_library_versions(id,registry_id,organization_id)
    on delete restrict,
  constraint lukas_drawing_library_imports_project_fkey
    foreign key (project_id,organization_id)
    references public.lukas_qto_projects(id,organization_id) on delete restrict,
  constraint lukas_drawing_library_imports_revision_fkey
    foreign key (revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete restrict,
  constraint lukas_drawing_library_imports_target_document_fkey
    foreign key (target_document_id,project_id)
    references public.lukas_drawing_documents(id,project_id) on delete restrict,
  constraint lukas_drawing_library_imports_target_revision_fkey
    foreign key (target_revision_id,project_id)
    references public.lukas_drawing_revisions(id,project_id) on delete restrict,
  check (
    (target_entity_id is not null and target_document_id is null
      and target_revision_id=revision_id)
    or (target_entity_id is null and revision_id is null
      and target_document_id is not null and target_revision_id is not null)
  )
);

create index lukas_drawing_library_entries_org_kind_idx
  on public.lukas_drawing_library_entries(organization_id,kind,name,id);
create index lukas_drawing_library_versions_registry_status_idx
  on public.lukas_drawing_library_versions(registry_id,status,version_no desc,id);
create index lukas_drawing_library_imports_project_revision_idx
  on public.lukas_drawing_library_imports(project_id,revision_id,imported_at desc,id);

create or replace function private.lukas_drawing_library_version_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then
    raise exception using errcode='P1C01',
      message='Published library versions are immutable';
  end if;
  if new.id is distinct from old.id
    or new.registry_id is distinct from old.registry_id
    or new.organization_id is distinct from old.organization_id
    or new.version_no is distinct from old.version_no
    or new.canonical_payload is distinct from old.canonical_payload
    or new.content_sha256 is distinct from old.content_sha256
    or new.predecessor_version_id is distinct from old.predecessor_version_id
    or new.predecessor_registry_id is distinct from old.predecessor_registry_id
    or new.predecessor_organization_id is distinct from old.predecessor_organization_id
    or new.source_project_id is distinct from old.source_project_id
    or new.source_revision_id is distinct from old.source_revision_id
    or new.source_entity_id is distinct from old.source_entity_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.published_by is distinct from coalesce(old.published_by,new.published_by)
    or new.published_at is distinct from coalesce(old.published_at,new.published_at)
    or not (
      current_user=pg_catalog.pg_get_userbyid(
        (select c.relowner from pg_catalog.pg_class c where c.oid=tg_relid)
      ) and (
        (old.status='draft' and new.status='published'
          and old.published_by is null and new.published_by is not null
          and old.published_at is null and new.published_at is not null
          and old.deprecated_at is null and new.deprecated_at is null)
        or (old.status='published' and new.status='deprecated'
          and new.published_by=old.published_by
          and new.published_at=old.published_at
          and old.deprecated_at is null and new.deprecated_at is not null)
      )
    ) then
    raise exception using errcode='P1C01',
      message='Library version content is immutable';
  end if;
  return new;
end;
$$;
create trigger lukas_drawing_library_version_guard
before update or delete on public.lukas_drawing_library_versions
for each row execute function private.lukas_drawing_library_version_guard();

create or replace function private.lukas_drawing_library_append_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception using errcode='P1C01',message='Drawing library provenance is append-only';
end;
$$;
create trigger lukas_drawing_library_import_guard
before update or delete on public.lukas_drawing_library_imports
for each row execute function private.lukas_drawing_library_append_guard();

create or replace function private.lukas_drawing_library_manager(p_organization_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select (select auth.uid()) is not null
    and private.lukas_qto_organization_role(p_organization_id)
      in ('owner','admin','staff')
$$;

create or replace function private.lukas_drawing_library_payload(
  p_kind text,p_revision_id uuid,p_source_entity_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_payload jsonb; v_primitive jsonb; v_primitives jsonb:='[]'::jsonb;
begin
  if p_kind='style' then
    select pg_catalog.jsonb_build_object(
      'id',s.id,'revisionId',s.revision_id,'name',s.name,
      'value',s.value,'version',s.version
    ) into v_payload from public.lukas_drawing_styles s
    where s.id=p_source_entity_id and s.revision_id=p_revision_id;
  elsif p_kind='block' then
    select pg_catalog.jsonb_build_object(
      'id',b.id,'revisionId',b.revision_id,'name',b.name,
      'primitives',b.primitives,'version',b.version
    ) into v_payload from public.lukas_drawing_blocks b
    where b.id=p_source_entity_id and b.revision_id=p_revision_id;
    if v_payload is not null then
      for v_primitive in
        select value from pg_catalog.jsonb_array_elements(v_payload->'primitives')
      loop
        if pg_catalog.jsonb_typeof(v_primitive->'styleId')='string' then
          select pg_catalog.jsonb_set(
            pg_catalog.jsonb_set(v_primitive,'{styleId}','null'::jsonb),
            '{style}',s.value
          ) into v_primitive from public.lukas_drawing_styles s
          where s.id=(v_primitive->>'styleId')::uuid
            and s.revision_id=p_revision_id;
          if not found then return null; end if;
        end if;
        v_primitives:=v_primitives||pg_catalog.jsonb_build_array(v_primitive);
      end loop;
      v_payload:=pg_catalog.jsonb_set(v_payload,'{primitives}',v_primitives);
    end if;
  elsif p_kind='property_schema' then
    select pg_catalog.jsonb_build_object(
      'id',s.id,'revisionId',s.revision_id,'name',s.name,
      'valueType',s.value_type,'enumOptions',s.enum_options,
      'appliesTo',s.applies_to,'required',s.required,'version',s.version
    ) into v_payload from public.lukas_drawing_property_schemas s
    where s.id=p_source_entity_id and s.revision_id=p_revision_id;
  elsif p_kind='workspace_template' and p_source_entity_id is null then
    select s.canonical_json into v_payload
    from public.lukas_drawing_snapshots s
    join public.lukas_drawing_revisions r
      on r.id=s.revision_id and r.project_id=s.project_id
      and r.version=s.revision_version and r.status='approved'
    join public.lukas_drawing_revision_approvals a
      on a.revision_id=s.revision_id and a.project_id=s.project_id
      and a.subject_version=s.revision_version
      and a.snapshot_sha256=s.sha256 and a.decision='approved'
    where s.revision_id=p_revision_id;
  end if;
  return v_payload;
exception when others then return null;
end;
$$;

create or replace function public.lukas_drawing_create_library_draft(
  p_organization_id uuid,p_kind text,p_name text,p_source_revision_id uuid,
  p_source_entity_id uuid default null,p_predecessor_version_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_revision public.lukas_drawing_revisions%rowtype;
  v_registry public.lukas_drawing_library_entries%rowtype;
  v_predecessor public.lukas_drawing_library_versions%rowtype;
  v_payload jsonb; v_version public.lukas_drawing_library_versions%rowtype;
  v_version_no bigint;
begin
  if v_actor is null or not private.lukas_drawing_library_manager(p_organization_id)
    or p_kind not in ('style','block','property_schema','workspace_template')
    or p_name is null or pg_catalog.char_length(pg_catalog.btrim(p_name)) not between 1 and 255
    or ((p_kind='workspace_template') is distinct from (p_source_entity_id is null)) then
    raise exception using errcode='P1R01',message='Drawing library target is unavailable';
  end if;
  select r.* into v_revision from public.lukas_drawing_revisions r
  join public.lukas_qto_projects p on p.id=r.project_id
  where r.id=p_source_revision_id and p.organization_id=p_organization_id
    and r.status='approved' for key share;
  if not found then raise exception using errcode='P1R01',message='Drawing library target is unavailable'; end if;
  v_payload:=private.lukas_drawing_library_payload(p_kind,p_source_revision_id,p_source_entity_id);
  if v_payload is null then raise exception using errcode='P1R01',message='Drawing library source is unavailable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_organization_id::text||':'||p_kind||':'||pg_catalog.btrim(p_name),0
  ));
  select * into v_registry from public.lukas_drawing_library_entries e
  where e.organization_id=p_organization_id and e.kind=p_kind
    and e.name=pg_catalog.btrim(p_name) for update;
  if not found then
    if p_predecessor_version_id is not null then
      raise exception using errcode='P1C01',message='Library predecessor is inconsistent';
    end if;
    insert into public.lukas_drawing_library_entries(
      organization_id,kind,name,created_by
    ) values(p_organization_id,p_kind,pg_catalog.btrim(p_name),v_actor)
    returning * into v_registry;
    v_version_no:=1;
  else
    if p_predecessor_version_id is null then
      raise exception using errcode='P1C01',message='Library predecessor is required';
    end if;
    select * into v_predecessor from public.lukas_drawing_library_versions v
    where v.id=p_predecessor_version_id and v.registry_id=v_registry.id
      and v.organization_id=p_organization_id and v.status in ('published','deprecated')
    for key share;
    if not found or exists(
      select 1 from public.lukas_drawing_library_versions newer
      where newer.registry_id=v_registry.id and newer.version_no>v_predecessor.version_no
    ) then raise exception using errcode='P1C01',message='Library predecessor is inconsistent'; end if;
    v_version_no:=v_predecessor.version_no+1;
  end if;
  insert into public.lukas_drawing_library_versions(
    registry_id,organization_id,version_no,status,canonical_payload,content_sha256,
    predecessor_version_id,predecessor_registry_id,predecessor_organization_id,
    source_project_id,source_revision_id,source_entity_id,created_by
  ) values(
    v_registry.id,p_organization_id,v_version_no,'draft',v_payload,
    pg_catalog.encode(extensions.digest(
      pg_catalog.convert_to(v_payload::text,'UTF8'),'sha256'
    ),'hex'),
    v_predecessor.id,case when v_predecessor.id is null then null else v_registry.id end,
    case when v_predecessor.id is null then null else p_organization_id end,
    v_revision.project_id,p_source_revision_id,p_source_entity_id,v_actor
  ) returning * into v_version;
  return pg_catalog.jsonb_build_object('registryId',v_registry.id,'versionId',v_version.id,
    'versionNo',v_version.version_no,'contentSha256',v_version.content_sha256,'status',v_version.status);
end;
$$;

create or replace function public.lukas_drawing_publish_library_version(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_version public.lukas_drawing_library_versions%rowtype;
  v_payload jsonb; v_sha text;
begin
  select * into v_version from public.lukas_drawing_library_versions v
  where v.id=p_version_id for update;
  if not found or v_actor is null
    or not private.lukas_drawing_library_manager(v_version.organization_id)
    or v_version.status<>'draft' then
    raise exception using errcode='P1R01',message='Drawing library version is unavailable';
  end if;
  v_payload:=private.lukas_drawing_library_payload(
    (select e.kind from public.lukas_drawing_library_entries e where e.id=v_version.registry_id),
    v_version.source_revision_id,v_version.source_entity_id
  );
  v_sha:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_payload::text,'UTF8'),'sha256'
  ),'hex');
  if v_payload is distinct from v_version.canonical_payload
    or v_sha is distinct from v_version.content_sha256 then
    raise exception using errcode='P1R01',message='Drawing library source changed';
  end if;
  update public.lukas_drawing_library_versions set status='published',published_by=v_actor,
    published_at=pg_catalog.now() where id=v_version.id;
  return pg_catalog.jsonb_build_object('versionId',v_version.id,'status','published',
    'contentSha256',v_version.content_sha256);
end;
$$;

create or replace function public.lukas_drawing_deprecate_library_version(p_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_version public.lukas_drawing_library_versions%rowtype;
begin
  select * into v_version from public.lukas_drawing_library_versions v
  where v.id=p_version_id for update;
  if not found or v_actor is null
    or not private.lukas_drawing_library_manager(v_version.organization_id)
    or v_version.status<>'published' then
    raise exception using errcode='P1R01',message='Drawing library version is unavailable';
  end if;
  update public.lukas_drawing_library_versions set status='deprecated',deprecated_at=pg_catalog.now()
  where id=v_version.id;
  return pg_catalog.jsonb_build_object('versionId',v_version.id,'status','deprecated');
end;
$$;

-- Copies an approved organization template into another project while keeping
-- the published source revision and its exact snapshot immutable.
create or replace function private.lukas_drawing_clone_library_template(
  p_source_revision_id uuid,p_target_project_id uuid,p_actor uuid,p_title text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_document_id uuid; v_revision_id uuid;
  v_page_map jsonb:='{}'::jsonb; v_canvas_map jsonb:='{}'::jsonb;
  v_layer_map jsonb:='{}'::jsonb; v_style_map jsonb:='{}'::jsonb;
  v_block_map jsonb:='{}'::jsonb; v_instance_map jsonb:='{}'::jsonb;
  v_object_map jsonb:='{}'::jsonb; v_schema_map jsonb:='{}'::jsonb;
  v_column_map jsonb; v_row record; v_item jsonb; v_new_id uuid;
  v_json jsonb; v_columns jsonb; v_rows jsonb; v_cells jsonb;
begin
  insert into public.lukas_drawing_documents(project_id,title,created_by)
  values(p_target_project_id,p_title,p_actor) returning id into v_document_id;
  insert into public.lukas_drawing_revisions(document_id,project_id,sequence,status,version,created_by)
  values(v_document_id,p_target_project_id,1,'draft',1,p_actor) returning id into v_revision_id;
  for v_row in select * from public.lukas_drawing_pages where revision_id=p_source_revision_id order by sort_order,id loop
    v_new_id:=extensions.gen_random_uuid(); v_page_map:=v_page_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_pages(id,revision_id,project_id,name,page_number,sort_order,version,width_mm,height_mm)
    values(v_new_id,v_revision_id,p_target_project_id,v_row.name,v_row.sort_order+1,v_row.sort_order,1,v_row.width_mm,v_row.height_mm);
  end loop;
  for v_row in select * from public.lukas_drawing_canvases where revision_id=p_source_revision_id order by sort_order,id loop
    v_new_id:=extensions.gen_random_uuid(); v_canvas_map:=v_canvas_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_canvases(id,page_id,revision_id,project_id,name,space_kind,width_mm,height_mm,sort_order,version,created_by)
    values(v_new_id,(v_page_map->>v_row.page_id::text)::uuid,v_revision_id,p_target_project_id,v_row.name,v_row.space_kind,v_row.width_mm,v_row.height_mm,v_row.sort_order,1,p_actor);
  end loop;
  for v_row in select * from public.lukas_drawing_layers where revision_id=p_source_revision_id order by sort_order,id loop
    v_new_id:=extensions.gen_random_uuid(); v_layer_map:=v_layer_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_layers(id,page_id,canvas_id,revision_id,project_id,name,sort_order,visible,locked,system_kind,version,created_by)
    values(v_new_id,(v_page_map->>v_row.page_id::text)::uuid,(v_canvas_map->>v_row.canvas_id::text)::uuid,v_revision_id,p_target_project_id,v_row.name,v_row.sort_order,v_row.visible,v_row.locked,v_row.system_kind,1,p_actor);
  end loop;
  for v_row in select * from public.lukas_drawing_styles where revision_id=p_source_revision_id order by id loop
    v_new_id:=extensions.gen_random_uuid(); v_style_map:=v_style_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_styles(id,revision_id,project_id,name,value,version,created_by)
    values(v_new_id,v_revision_id,p_target_project_id,v_row.name,v_row.value,1,p_actor);
  end loop;
  for v_row in select * from public.lukas_drawing_blocks where revision_id=p_source_revision_id order by id loop
    v_new_id:=extensions.gen_random_uuid(); v_block_map:=v_block_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    select pg_catalog.jsonb_agg(case when pg_catalog.jsonb_typeof(p->'styleId')='string'
      then pg_catalog.jsonb_set(p,'{styleId}',pg_catalog.to_jsonb((v_style_map->>(p->>'styleId'))::uuid)) else p end order by ord)
      into v_json from pg_catalog.jsonb_array_elements(v_row.primitives) with ordinality x(p,ord);
    insert into public.lukas_drawing_blocks(id,revision_id,project_id,name,primitives,version,created_by)
    values(v_new_id,v_revision_id,p_target_project_id,v_row.name,v_json,1,p_actor);
  end loop;
  for v_row in select * from public.lukas_drawing_objects where revision_id=p_source_revision_id and status='active' order by id loop
    v_new_id:=extensions.gen_random_uuid(); v_object_map:=v_object_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_objects(id,lineage_id,page_id,layer_id,revision_id,project_id,name,object_type,geometry,style_id,style,status,version,created_by,updated_by)
    values(v_new_id,v_row.lineage_id,(v_page_map->>v_row.page_id::text)::uuid,(v_layer_map->>v_row.layer_id::text)::uuid,v_revision_id,p_target_project_id,v_row.name,v_row.object_type,v_row.geometry,
      case when v_row.style_id is null then null else (v_style_map->>v_row.style_id::text)::uuid end,v_row.style,'active',1,p_actor,p_actor);
  end loop;
  for v_row in select * from public.lukas_drawing_block_instances where revision_id=p_source_revision_id order by id loop
    v_new_id:=extensions.gen_random_uuid(); v_instance_map:=v_instance_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_block_instances(id,lineage_id,block_id,layer_id,revision_id,project_id,name,origin,rotation,scale_x,scale_y,version,created_by)
    values(v_new_id,v_row.lineage_id,(v_block_map->>v_row.block_id::text)::uuid,(v_layer_map->>v_row.layer_id::text)::uuid,v_revision_id,p_target_project_id,v_row.name,v_row.origin,v_row.rotation,v_row.scale_x,v_row.scale_y,1,p_actor);
  end loop;
  for v_row in select * from public.lukas_drawing_property_schemas where revision_id=p_source_revision_id order by id loop
    v_new_id:=extensions.gen_random_uuid(); v_schema_map:=v_schema_map||pg_catalog.jsonb_build_object(v_row.id::text,v_new_id);
    insert into public.lukas_drawing_property_schemas(id,revision_id,project_id,name,value_type,enum_options,applies_to,required,version,created_by)
    values(v_new_id,v_revision_id,p_target_project_id,v_row.name,v_row.value_type,v_row.enum_options,v_row.applies_to,v_row.required,1,p_actor);
  end loop;
  for v_row in select * from public.lukas_drawing_property_values where revision_id=p_source_revision_id order by id loop
    insert into public.lukas_drawing_property_values(id,schema_id,object_id,block_instance_id,revision_id,project_id,value,version,created_by)
    values(extensions.gen_random_uuid(),(v_schema_map->>v_row.schema_id::text)::uuid,
      case when v_row.object_id is null then null else (v_object_map->>v_row.object_id::text)::uuid end,
      case when v_row.block_instance_id is null then null else (v_instance_map->>v_row.block_instance_id::text)::uuid end,
      v_revision_id,p_target_project_id,v_row.value,1,p_actor);
  end loop;
  for v_row in select * from public.lukas_drawing_tables where revision_id=p_source_revision_id order by id loop
    v_column_map:='{}'::jsonb; v_columns:='[]'::jsonb; v_rows:='[]'::jsonb;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_row.columns_json) loop
      v_new_id:=extensions.gen_random_uuid(); v_column_map:=v_column_map||pg_catalog.jsonb_build_object(v_item->>'id',v_new_id);
      v_item:=pg_catalog.jsonb_set(v_item,'{id}',pg_catalog.to_jsonb(v_new_id));
      if v_item->>'kind'='property' then v_item:=pg_catalog.jsonb_set(v_item,'{propertySchemaId}',pg_catalog.to_jsonb((v_schema_map->>(v_item->>'propertySchemaId'))::uuid)); end if;
      v_columns:=v_columns||pg_catalog.jsonb_build_array(v_item);
    end loop;
    for v_item in select value from pg_catalog.jsonb_array_elements(v_row.rows_json) loop
      select pg_catalog.coalesce(pg_catalog.jsonb_object_agg(v_column_map->>cell.key,cell.value),'{}'::jsonb) into v_cells from pg_catalog.jsonb_each(v_item->'cells') cell;
      v_item:=pg_catalog.jsonb_set(v_item,'{id}',pg_catalog.to_jsonb(extensions.gen_random_uuid()));
      v_item:=pg_catalog.jsonb_set(v_item,'{cells}',v_cells);
      if v_item->>'objectId' is not null then v_item:=pg_catalog.jsonb_set(v_item,'{objectId}',pg_catalog.to_jsonb((v_object_map->>(v_item->>'objectId'))::uuid)); end if;
      if v_item->>'blockInstanceId' is not null then v_item:=pg_catalog.jsonb_set(v_item,'{blockInstanceId}',pg_catalog.to_jsonb((v_instance_map->>(v_item->>'blockInstanceId'))::uuid)); end if;
      v_rows:=v_rows||pg_catalog.jsonb_build_array(v_item);
    end loop;
    insert into public.lukas_drawing_tables(id,revision_id,project_id,name,columns_json,rows_json,version,created_by)
    values(extensions.gen_random_uuid(),v_revision_id,p_target_project_id,v_row.name,v_columns,v_rows,1,p_actor);
  end loop;
  return pg_catalog.jsonb_build_object('documentId',v_document_id,'revisionId',v_revision_id);
end;
$$;

create or replace function public.lukas_drawing_import_library_version(
  p_version_id uuid,p_project_id uuid,p_revision_id uuid,p_client_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=(select auth.uid()); v_version public.lukas_drawing_library_versions%rowtype;
  v_entry public.lukas_drawing_library_entries%rowtype; v_project public.lukas_qto_projects%rowtype;
  v_revision public.lukas_drawing_revisions%rowtype; v_existing public.lukas_drawing_library_imports%rowtype;
  v_live jsonb; v_current jsonb; v_legacy boolean; v_sha text;
  v_request_sha text; v_target uuid; v_result jsonb;
begin
  if v_actor is null or p_client_request_id is null then raise exception using errcode='P1R01',message='Drawing library import is unavailable'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text||':'||p_client_request_id::text,0));
  v_request_sha:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'versionId',p_version_id,'projectId',p_project_id,'revisionId',p_revision_id
  )::text,'UTF8'),'sha256'),'hex');
  select * into v_existing from public.lukas_drawing_library_imports i
  where i.imported_by=v_actor and i.client_request_id=p_client_request_id for update;
  if found then
    if v_existing.request_sha256 is distinct from v_request_sha then
      raise exception using errcode='P1C01',message='Request ID does not match the stored library import';
    end if;
    if v_existing.target_entity_id is not null then
      return pg_catalog.jsonb_build_object('importId',v_existing.id,
        'targetEntityId',v_existing.target_entity_id,
        'revisionId',v_existing.target_revision_id,
        'contentSha256',v_existing.source_content_sha256);
    end if;
    return pg_catalog.jsonb_build_object('importId',v_existing.id,
      'documentId',v_existing.target_document_id,
      'revisionId',v_existing.target_revision_id,
      'contentSha256',v_existing.source_content_sha256);
  end if;
  select * into v_version from public.lukas_drawing_library_versions v where v.id=p_version_id for key share;
  if not found or v_version.status<>'published' then raise exception using errcode='P1R01',message='Drawing library version is unavailable'; end if;
  select * into v_entry from public.lukas_drawing_library_entries e
  where e.id=v_version.registry_id and e.organization_id=v_version.organization_id;
  select * into v_project from public.lukas_qto_projects p
  where p.id=p_project_id and p.organization_id=v_version.organization_id for key share;
  if not found or private.lukas_drawing_workspace_capability(p_project_id) not in ('admin','editor') then
    raise exception using errcode='P1R01',message='Drawing library target is unavailable';
  end if;
  v_live:=private.lukas_drawing_library_payload(v_entry.kind,v_version.source_revision_id,v_version.source_entity_id);
  v_sha:=pg_catalog.encode(extensions.digest(
    pg_catalog.convert_to(v_live::text,'UTF8'),'sha256'
  ),'hex');
  if v_live is distinct from v_version.canonical_payload or v_sha is distinct from v_version.content_sha256 then
    raise exception using errcode='P1R01',message='Drawing library source changed';
  end if;
  if v_entry.kind='workspace_template' then
    if p_revision_id is not null then raise exception using errcode='P1C01',message='Workspace template creates a new drawing revision'; end if;
    if v_live->>'schemaVersion'='2' then
      select exists(
        select 1 from pg_catalog.jsonb_array_elements(v_live->'blockInstances') x
        where not (x ? 'lineageId')
      ) into v_legacy;
      if v_legacy and exists(
        select 1 from pg_catalog.jsonb_array_elements(v_live->'blockInstances') x
        where x ? 'lineageId'
      ) then raise exception using errcode='P1R01',message='Drawing library source changed'; end if;
      v_current:=private.lukas_drawing_p2_canonical_snapshot(
        v_version.source_revision_id,not v_legacy
      );
      if v_current is distinct from v_live then
        raise exception using errcode='P1R01',message='Drawing library source changed';
      end if;
      v_result:=private.lukas_drawing_clone_library_template(
        v_version.source_revision_id,p_project_id,v_actor,v_entry.name
      );
    elsif v_live->>'schemaVersion'='1' then
      v_result:=private.lukas_drawing_clone_v1_snapshot(
        v_live,p_project_id,v_actor,v_entry.name,null
      );
    else
      raise exception using errcode='P1R01',message='Drawing library source changed';
    end if;
  else
    select * into v_revision from public.lukas_drawing_revisions r
    where r.id=p_revision_id and r.project_id=p_project_id and r.status='draft' for update;
    if not found then raise exception using errcode='P1R01',message='Drawing library target revision is unavailable'; end if;
    v_target:=extensions.gen_random_uuid();
    if v_entry.kind='style' then
      insert into public.lukas_drawing_styles(id,revision_id,project_id,name,value,version,created_by)
      values(v_target,p_revision_id,p_project_id,v_live->>'name',v_live->'value',1,v_actor);
    elsif v_entry.kind='block' then
      insert into public.lukas_drawing_blocks(id,revision_id,project_id,name,primitives,version,created_by)
      values(v_target,p_revision_id,p_project_id,v_live->>'name',v_live->'primitives',1,v_actor);
    else
      insert into public.lukas_drawing_property_schemas(id,revision_id,project_id,name,value_type,enum_options,applies_to,required,version,created_by)
      values(v_target,p_revision_id,p_project_id,v_live->>'name',v_live->>'valueType',v_live->'enumOptions',v_live->'appliesTo',(v_live->>'required')::boolean,1,v_actor);
    end if;
    v_result:=pg_catalog.jsonb_build_object('revisionId',p_revision_id,'targetEntityId',v_target);
  end if;
  insert into public.lukas_drawing_library_imports(
    organization_id,registry_id,version_id,project_id,revision_id,target_entity_id,
    target_document_id,target_revision_id,source_content_sha256,imported_by,
    client_request_id,request_sha256
  ) values(
    v_version.organization_id,v_version.registry_id,v_version.id,p_project_id,p_revision_id,
    v_target,(v_result->>'documentId')::uuid,(v_result->>'revisionId')::uuid,
    v_version.content_sha256,v_actor,p_client_request_id,v_request_sha
  ) returning id into v_target;
  return v_result||pg_catalog.jsonb_build_object('importId',v_target,'contentSha256',v_version.content_sha256);
exception
  when sqlstate 'P1C01' or sqlstate 'P1R01' or serialization_failure or deadlock_detected then raise;
  when unique_violation or foreign_key_violation or check_violation or not_null_violation then
    raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

alter table public.lukas_drawing_library_entries enable row level security;
alter table public.lukas_drawing_library_versions enable row level security;
alter table public.lukas_drawing_library_imports enable row level security;
revoke all on table public.lukas_drawing_library_entries from anon,authenticated;
revoke all on table public.lukas_drawing_library_versions from anon,authenticated;
revoke all on table public.lukas_drawing_library_imports from anon,authenticated;
grant select on table public.lukas_drawing_library_entries to authenticated;
grant select on table public.lukas_drawing_library_versions to authenticated;
grant select on table public.lukas_drawing_library_imports to authenticated;
grant all on table public.lukas_drawing_library_entries to service_role;
grant all on table public.lukas_drawing_library_versions to service_role;
grant all on table public.lukas_drawing_library_imports to service_role;

create policy "organization members read drawing library entries"
on public.lukas_drawing_library_entries for select to authenticated
using(private.lukas_qto_organization_role(organization_id) is not null);
create policy "organization members read drawing library versions"
on public.lukas_drawing_library_versions for select to authenticated
using(private.lukas_qto_organization_role(organization_id) is not null);
create policy "organization members read drawing library imports"
on public.lukas_drawing_library_imports for select to authenticated
using(private.lukas_qto_organization_role(organization_id) is not null);

revoke all on function
  private.lukas_drawing_library_version_guard(),
  private.lukas_drawing_library_append_guard(),
  private.lukas_drawing_library_manager(uuid),
  private.lukas_drawing_library_payload(text,uuid,uuid),
  private.lukas_drawing_clone_library_template(uuid,uuid,uuid,text)
from public,anon,authenticated,service_role;
revoke all on function public.lukas_drawing_create_library_draft(uuid,text,text,uuid,uuid,uuid),
  public.lukas_drawing_publish_library_version(uuid),
  public.lukas_drawing_deprecate_library_version(uuid),
  public.lukas_drawing_import_library_version(uuid,uuid,uuid,uuid)
from public,anon;
grant execute on function public.lukas_drawing_create_library_draft(uuid,text,text,uuid,uuid,uuid),
  public.lukas_drawing_publish_library_version(uuid),
  public.lukas_drawing_deprecate_library_version(uuid),
  public.lukas_drawing_import_library_version(uuid,uuid,uuid,uuid)
to authenticated,service_role;

commit;
