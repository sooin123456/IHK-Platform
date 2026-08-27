begin;

create function private.lukas_drawing_revision_anchor_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user <> 'authenticated' then return new; end if;

  if tg_op = 'INSERT' then
    if new.replaces_anchor_id is null and exists (
      select 1
      from public.lukas_drawing_issue_anchors predecessor
      join public.lukas_qto_file_revisions edge
        on edge.project_id = predecessor.project_id
       and edge.previous_file_id = predecessor.file_id
       and edge.relation_kind = 'supersedes'
      join public.lukas_qto_files previous_file
        on previous_file.id = edge.previous_file_id
       and previous_file.project_id = edge.project_id
       and previous_file.sha256 = edge.previous_sha256
       and previous_file.immutable
      join public.lukas_qto_files current_file
        on current_file.id = edge.current_file_id
       and current_file.project_id = edge.project_id
       and current_file.sha256 = edge.current_sha256
       and current_file.immutable
      where predecessor.issue_id = new.issue_id
        and predecessor.project_id = new.project_id
        and predecessor.active
        and previous_file.kind = current_file.kind
        and previous_file.kind = case predecessor.anchor_kind
          when 'pdf_region' then 'pdf'
          when 'ifc_element' then 'ifc'
        end
    ) then
      raise exception using errcode = '42501',
        message = 'Revision-review anchors require the atomic relink function';
    end if;
    return new;
  end if;

  if old.active and not new.active and exists (
    select 1
    from public.lukas_qto_file_revisions edge
    join public.lukas_qto_files previous_file
      on previous_file.id = edge.previous_file_id
     and previous_file.project_id = edge.project_id
     and previous_file.sha256 = edge.previous_sha256
     and previous_file.immutable
    join public.lukas_qto_files current_file
      on current_file.id = edge.current_file_id
     and current_file.project_id = edge.project_id
     and current_file.sha256 = edge.current_sha256
     and current_file.immutable
    where edge.project_id = old.project_id
      and edge.previous_file_id = old.file_id
      and edge.relation_kind = 'supersedes'
      and previous_file.kind = current_file.kind
      and previous_file.kind = case old.anchor_kind
        when 'pdf_region' then 'pdf'
        when 'ifc_element' then 'ifc'
      end
  ) then
    raise exception using errcode = '42501',
      message = 'Revision-review anchors require the atomic relink function';
  end if;
  return new;
end;
$$;

create trigger lukas_drawing_anchors_revision_authority
before insert or update on public.lukas_drawing_issue_anchors
for each row execute function private.lukas_drawing_revision_anchor_guard();

revoke all on function private.lukas_drawing_revision_anchor_guard()
from public, anon, authenticated, service_role;

alter default privileges revoke execute on functions from public;

commit;
