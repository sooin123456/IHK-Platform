begin;

create table private.lukas_drawing_checkpoint_reference_targets(
  transaction_id bigint not null,
  actor_id uuid not null,
  revision_id uuid not null,
  snapshot_id uuid not null,
  sources jsonb not null,
  issues jsonb not null,
  primary key(transaction_id,actor_id,revision_id)
);

create table private.lukas_drawing_checkpoint_reference_history(
  id uuid primary key default extensions.gen_random_uuid(),
  revision_id uuid not null,
  project_id uuid not null,
  snapshot_id uuid not null,
  client_operation_id uuid not null,
  actor_id uuid not null,
  link_kind text not null check(link_kind in ('source','issue')),
  action text not null check(action in ('delete','restore')),
  link_identity jsonb not null,
  created_at timestamptz not null default pg_catalog.now()
);

create table private.lukas_drawing_checkpoint_issue_delete_leases(
  transaction_id bigint not null,
  actor_id uuid not null,
  revision_id uuid not null,
  link_id uuid not null,
  primary key(transaction_id,actor_id,revision_id,link_id)
);

create trigger lukas_drawing_checkpoint_reference_history_append_only
before update or delete on private.lukas_drawing_checkpoint_reference_history
for each row execute function private.lukas_drawing_append_only_guard();

alter function private.lukas_drawing_checkpoint_structure(jsonb)
  rename to lukas_drawing_checkpoint_structure_pre_reference_authority;

create function private.lukas_drawing_checkpoint_structure(p_graph jsonb)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when t.revision_id is null then s.value else
    pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(s.value,'{sources}',t.sources,true),
      '{issues}',t.issues,true
    ) end
  from (select private.lukas_drawing_checkpoint_structure_pre_reference_authority(
    p_graph
  ) value) s
  left join private.lukas_drawing_checkpoint_reference_targets t
    on t.transaction_id=pg_catalog.txid_current()
   and t.actor_id=(select auth.uid())
  limit 1
$$;

create function private.lukas_drawing_checkpoint_issue_link_guard()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' and (
    pg_catalog.pg_trigger_depth()>1 or exists(
      select 1 from private.lukas_drawing_checkpoint_issue_delete_leases l
      where l.transaction_id=pg_catalog.txid_current()
        and l.actor_id=(select auth.uid())
        and l.revision_id=old.revision_id and l.link_id=old.id
    )
  ) then return old; end if;
  raise exception using errcode='P1C01',
    message='Drawing object issue links are append-only';
end;
$$;

drop trigger lukas_drawing_object_issue_links_append_only
  on public.lukas_drawing_object_issue_links;
create trigger lukas_drawing_object_issue_links_append_only
before update or delete on public.lukas_drawing_object_issue_links
for each row execute function private.lukas_drawing_checkpoint_issue_link_guard();

alter function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) rename to lukas_drawing_apply_operation_pre_checkpoint_reference_authority;

create function private.lukas_drawing_apply_operation(
  p_revision_id uuid,p_client_operation_id uuid,p_operation_type text,
  p_base_versions jsonb,p_forward jsonb,p_inverse jsonb,
  p_history_action text,p_original_operation_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid:=(select auth.uid());
  v_revision public.lukas_drawing_revisions%rowtype;
  v_snapshot public.lukas_drawing_snapshots%rowtype;
  v_source jsonb; v_issue jsonb; v_row jsonb; v_result jsonb; v_live jsonb;
begin
  if p_operation_type<>'restore_checkpoint' then
    return private.lukas_drawing_apply_operation_pre_checkpoint_reference_authority(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;

  if exists(select 1 from public.lukas_drawing_operations o
    where o.revision_id=p_revision_id
      and o.client_operation_id=p_client_operation_id) then
    return private.lukas_drawing_apply_operation_pre_checkpoint_reference_authority(
      p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
      p_forward,p_inverse,p_history_action,p_original_operation_id
    );
  end if;

  select r.* into v_revision from public.lukas_drawing_revisions r
  where r.id=p_revision_id and r.status='draft'
    and private.lukas_drawing_workspace_capability(r.project_id)
      in ('admin','editor') for update;
  if not found then raise exception using errcode='P1C01',
    message='Drawing checkpoint requires a writable draft revision'; end if;

  select s.* into v_snapshot from public.lukas_drawing_snapshots s
  where s.id=(p_forward->>'checkpointId')::uuid
    and s.revision_id=p_revision_id for share;
  if not found or v_snapshot.schema_version<>2
    or v_snapshot.sha256 is distinct from pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(
        v_snapshot.canonical_json::text,'UTF8'),'sha256'),'hex'
    ) or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'sources')<>'array'
      or pg_catalog.jsonb_typeof(v_snapshot.canonical_json->'issues')<>'array'
  then raise exception using errcode='P1C01',
    message='Drawing checkpoint reference target is invalid'; end if;

  if exists(
    select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'sources'
    ) s where not (s.value ?& array[
      'id','objectId','sourceFileId','sourceSha256','sourceKind',
      'pdfPageNumber','x','y','width','height','elementId','ifcGlobalId','camera'
    ]) or s.value-array[
      'id','objectId','sourceFileId','sourceSha256','sourceKind',
      'pdfPageNumber','x','y','width','height','elementId','ifcGlobalId','camera'
    ]<>'{}'::jsonb
      or not exists(select 1 from pg_catalog.jsonb_array_elements(
        v_snapshot.canonical_json->'objects'
      ) o where o.value->>'id'=s.value->>'objectId')
      or not exists(select 1 from public.lukas_qto_files f
        where f.id=(s.value->>'sourceFileId')::uuid
          and f.project_id=v_revision.project_id
          and f.sha256=s.value->>'sourceSha256'
          and ((s.value->>'sourceKind'='pdf_region' and f.kind='pdf')
            or (s.value->>'sourceKind'='ifc_element' and f.kind='ifc')))
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'issues'
    ) i where not (i.value ?& array['id','objectId'])
      or i.value-array['id','objectId']<>'{}'::jsonb
      or not exists(select 1 from pg_catalog.jsonb_array_elements(
        v_snapshot.canonical_json->'objects'
      ) o where o.value->>'id'=i.value->>'objectId')
      or not exists(select 1 from public.lukas_drawing_issues x
        where x.id=(i.value->>'id')::uuid and x.project_id=v_revision.project_id)
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'sources'
    ) s group by s.value->>'id' having count(*)>1
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'sources'
    ) s group by s.value->>'objectId',s.value->>'sourceFileId',
      s.value->>'sourceKind' having count(*)>1
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(
      v_snapshot.canonical_json->'issues'
    ) i group by i.value->>'id',i.value->>'objectId' having count(*)>1
  ) then raise exception using errcode='P1C01',
    message='Drawing checkpoint reference graph is invalid'; end if;

  insert into private.lukas_drawing_checkpoint_reference_targets(
    transaction_id,actor_id,revision_id,snapshot_id,sources,issues
  ) values(
    pg_catalog.txid_current(),v_actor,p_revision_id,v_snapshot.id,
    v_snapshot.canonical_json->'sources',v_snapshot.canonical_json->'issues'
  );

  insert into private.lukas_drawing_checkpoint_issue_delete_leases(
    transaction_id,actor_id,revision_id,link_id
  ) select pg_catalog.txid_current(),v_actor,p_revision_id,l.id
    from public.lukas_drawing_object_issue_links l
    where l.revision_id=p_revision_id and not exists(
      select 1 from pg_catalog.jsonb_array_elements(
        v_snapshot.canonical_json->'issues'
      ) i where i.value->>'id'=l.issue_id::text
        and i.value->>'objectId'=l.object_id::text
    );
  insert into private.lukas_drawing_checkpoint_reference_history(
    revision_id,project_id,snapshot_id,client_operation_id,actor_id,
    link_kind,action,link_identity
  ) select p_revision_id,v_revision.project_id,v_snapshot.id,
      p_client_operation_id,v_actor,'issue','delete',to_jsonb(l)
    from public.lukas_drawing_object_issue_links l
    join private.lukas_drawing_checkpoint_issue_delete_leases x
      on x.transaction_id=pg_catalog.txid_current() and x.actor_id=v_actor
     and x.revision_id=p_revision_id and x.link_id=l.id;
  delete from public.lukas_drawing_object_issue_links l
    using private.lukas_drawing_checkpoint_issue_delete_leases x
    where x.transaction_id=pg_catalog.txid_current() and x.actor_id=v_actor
      and x.revision_id=p_revision_id and x.link_id=l.id;

  for v_row in select to_jsonb(s) from public.lukas_drawing_object_sources s
    where s.revision_id=p_revision_id and not exists(
      select 1 from pg_catalog.jsonb_array_elements(
        v_snapshot.canonical_json->'sources'
      ) x where x.value->>'id'=s.id::text
        and x.value->>'objectId'=s.object_id::text
    )
  loop
    insert into private.lukas_drawing_checkpoint_reference_history(
      revision_id,project_id,snapshot_id,client_operation_id,actor_id,
      link_kind,action,link_identity
    ) values(p_revision_id,v_revision.project_id,v_snapshot.id,
      p_client_operation_id,v_actor,'source','delete',v_row);
    delete from public.lukas_drawing_object_sources
      where id=(v_row->>'id')::uuid;
  end loop;

  v_result:=private.lukas_drawing_apply_operation_pre_checkpoint_reference_authority(
    p_revision_id,p_client_operation_id,p_operation_type,p_base_versions,
    p_forward,p_inverse,p_history_action,p_original_operation_id
  );

  for v_source in select value from pg_catalog.jsonb_array_elements(
    v_snapshot.canonical_json->'sources'
  ) loop
    if not exists(select 1 from public.lukas_drawing_object_sources s
      where s.id=(v_source->>'id')::uuid and s.object_id=(v_source->>'objectId')::uuid) then
      insert into public.lukas_drawing_object_sources(
        id,object_id,revision_id,project_id,source_file_id,source_sha256,
        source_kind,pdf_page_number,x,y,width,height,element_id,ifc_global_id,
        camera_json,created_by
      ) values(
        (v_source->>'id')::uuid,(v_source->>'objectId')::uuid,p_revision_id,
        v_revision.project_id,(v_source->>'sourceFileId')::uuid,
        v_source->>'sourceSha256',v_source->>'sourceKind',
        (v_source->>'pdfPageNumber')::integer,(v_source->>'x')::numeric,
        (v_source->>'y')::numeric,(v_source->>'width')::numeric,
        (v_source->>'height')::numeric,v_source->>'elementId',
        v_source->>'ifcGlobalId',v_source->'camera',v_actor
      );
      insert into private.lukas_drawing_checkpoint_reference_history(
        revision_id,project_id,snapshot_id,client_operation_id,actor_id,
        link_kind,action,link_identity
      ) values(p_revision_id,v_revision.project_id,v_snapshot.id,
        p_client_operation_id,v_actor,'source','restore',v_source);
    end if;
  end loop;
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
  v_live:=private.lukas_drawing_p2_canonical_snapshot(p_revision_id,true);
  if private.lukas_drawing_checkpoint_structure(v_live) is distinct from
    private.lukas_drawing_checkpoint_structure(v_snapshot.canonical_json)
  then raise exception using errcode='P1C01',
    message='Drawing checkpoint reference graph does not match target'; end if;
  return v_result;
exception when sqlstate 'P1C01' or sqlstate 'P1R01' then raise;
  when others then raise exception using errcode='P1C01',message=sqlerrm;
end;
$$;

revoke all on table private.lukas_drawing_checkpoint_reference_targets,
  private.lukas_drawing_checkpoint_reference_history,
  private.lukas_drawing_checkpoint_issue_delete_leases
  from public,anon,authenticated,service_role;
revoke all on function
  private.lukas_drawing_checkpoint_structure_pre_reference_authority(jsonb),
  private.lukas_drawing_checkpoint_structure(jsonb),
  private.lukas_drawing_checkpoint_issue_link_guard(),
  private.lukas_drawing_apply_operation_pre_checkpoint_reference_authority(
    uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
  ) from public,anon,authenticated,service_role;
grant execute on function private.lukas_drawing_apply_operation(
  uuid,uuid,text,jsonb,jsonb,jsonb,text,uuid
) to authenticated,service_role;

commit;
