begin;

-- This migration is intentionally ordered between the P2 canvas migration and
-- contract hardening. Fresh upgrades repair every P0/P1-reachable canvas before
-- hardening rejects incomplete structure; databases that already passed the
-- hardening migration have no candidate rows and treat this as a no-op.

alter table public.lukas_drawing_layers disable trigger user;

-- Legacy direct DML could store a negative order before P2 revoked it. Order is
-- presentation-only, so zero is a deterministic, evidence-independent repair.
update public.lukas_drawing_layers set sort_order=0 where sort_order<0;

do $$
begin
  if exists(select 1 from public.lukas_drawing_layers where sort_order<0) then
    raise exception using errcode='P1C01',
      message='Legacy drawing layer sort order repair was incomplete';
  end if;
end;
$$;

do $$
declare
  v record; v_digest text; v_layer_id uuid; v_name text; v_suffix integer;
begin
  for v in
    select c.id canvas_id,c.page_id,c.revision_id,c.project_id,r.created_by
    from public.lukas_drawing_canvases c
    join public.lukas_drawing_revisions r
      on r.id=c.revision_id and r.project_id=c.project_id
    where not exists(
      select 1 from public.lukas_drawing_layers l
      where l.canvas_id=c.id and l.system_kind<>'source' and l.visible and not l.locked
    )
    order by c.id
  loop
    v_digest:=pg_catalog.md5('lukas-drawing-p2-editable-layer:'||v.canvas_id::text);
    v_layer_id:=(pg_catalog.substr(v_digest,1,8)||'-'||pg_catalog.substr(v_digest,9,4)||'-5'||
      pg_catalog.substr(v_digest,14,3)||'-a'||pg_catalog.substr(v_digest,18,3)||'-'||
      pg_catalog.substr(v_digest,21,12))::uuid;
    if private.lukas_drawing_structure_raw_id_exists(v_layer_id) then
      raise exception using errcode='P1C01',
        message='Deterministic drawing layer backfill ID collides with existing structure';
    end if;
    v_suffix:=0;
    loop
      v_name:=case when v_suffix=0 then 'P2 Work '||v.canvas_id::text
        else 'P2 Work '||v.canvas_id::text||' #'||v_suffix::text end;
      exit when not exists(select 1 from public.lukas_drawing_layers l
        where l.page_id=v.page_id and l.name=v_name);
      v_suffix:=v_suffix+1;
    end loop;
    insert into public.lukas_drawing_layers(
      id,page_id,canvas_id,revision_id,project_id,name,sort_order,
      visible,locked,system_kind,version,created_by
    ) values(
      v_layer_id,v.page_id,v.canvas_id,v.revision_id,v.project_id,v_name,0,
      true,false,'custom',1,v.created_by
    );
  end loop;
end;
$$;

alter table public.lukas_drawing_layers enable trigger user;

do $$
begin
  if not exists(select 1 from pg_catalog.pg_constraint
    where conrelid='public.lukas_drawing_layers'::regclass
      and conname='lukas_drawing_layers_sort_order_nonnegative') then
    alter table public.lukas_drawing_layers
      add constraint lukas_drawing_layers_sort_order_nonnegative check (sort_order>=0);
  end if;
end;
$$;

commit;
