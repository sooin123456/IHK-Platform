-- Explicit immutable revision edges. File order is evidence, never inferred from filenames.
create table if not exists public.lukas_qto_file_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  previous_file_id uuid not null,
  previous_sha256 text not null check (previous_sha256 ~ '^[0-9a-f]{64}$'),
  current_file_id uuid not null,
  current_sha256 text not null check (current_sha256 ~ '^[0-9a-f]{64}$'),
  relation_kind text not null check (relation_kind = 'supersedes'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (current_file_id),
  unique (previous_file_id),
  check (previous_file_id <> current_file_id),
  constraint lukas_qto_revision_previous_identity_fkey
    foreign key (previous_file_id, project_id, previous_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict,
  constraint lukas_qto_revision_current_identity_fkey
    foreign key (current_file_id, project_id, current_sha256)
    references public.lukas_qto_files(id, project_id, sha256) on delete restrict
);

create or replace function public.lukas_qto_validate_file_revision()
returns trigger language plpgsql security invoker set search_path = public as $$
declare previous_kind text; current_kind text; previous_created timestamptz; current_created timestamptz;
begin
  select kind, created_at into previous_kind, previous_created from public.lukas_qto_files
    where id = new.previous_file_id and project_id = new.project_id and sha256 = new.previous_sha256;
  select kind, created_at into current_kind, current_created from public.lukas_qto_files
    where id = new.current_file_id and project_id = new.project_id and sha256 = new.current_sha256;
  if previous_kind is null or current_kind is null or previous_kind <> current_kind then
    raise exception 'Revision files must exist in the same project and have the same kind';
  end if;
  if previous_created > current_created then raise exception 'Revision direction must follow file creation time'; end if;
  return new;
end;
$$;

create trigger lukas_qto_file_revisions_validate before insert on public.lukas_qto_file_revisions
for each row execute function public.lukas_qto_validate_file_revision();

create index if not exists lukas_qto_file_revisions_project_created_idx
  on public.lukas_qto_file_revisions(project_id, created_at desc);
create index if not exists lukas_qto_file_revisions_previous_idx
  on public.lukas_qto_file_revisions(previous_file_id);

alter table public.lukas_qto_file_revisions enable row level security;
create policy "project members read file revision graph" on public.lukas_qto_file_revisions for select to authenticated
  using (exists (
    select 1 from public.lukas_qto_projects p where p.id = project_id
      and (p.owner_id = (select auth.uid()) or (select auth.jwt()->'app_metadata'->>'role') = 'hangil_staff')
  ));

grant select on public.lukas_qto_file_revisions to authenticated;
revoke insert, update, delete on public.lukas_qto_file_revisions from authenticated;
grant all on public.lukas_qto_file_revisions to service_role;
