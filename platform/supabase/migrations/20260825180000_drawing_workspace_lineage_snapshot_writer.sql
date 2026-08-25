begin;

-- Keep the historical review function and its pre-lineage evidence untouched.
-- This BEFORE INSERT hook only canonicalizes newly written v2 snapshots.
create or replace function private.lukas_drawing_snapshot_lineage_writer()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.schema_version=2 then
    new.canonical_json:=private.lukas_drawing_p2_canonical_snapshot(new.revision_id,true);
    if new.canonical_json is null then
      raise exception using errcode='P1R01',message='Drawing revision target is unavailable';
    end if;
    new.sha256:=encode(extensions.digest(convert_to(new.canonical_json::text,'UTF8'),'sha256'),'hex');
  end if;
  return new;
end;
$$;
drop trigger if exists aaa_lukas_drawing_snapshot_lineage_writer on public.lukas_drawing_snapshots;
create trigger aaa_lukas_drawing_snapshot_lineage_writer before insert on public.lukas_drawing_snapshots
  for each row execute function private.lukas_drawing_snapshot_lineage_writer();

commit;
