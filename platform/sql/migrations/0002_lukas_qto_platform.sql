-- Lukas QTO project data, review annotations and private source file metadata.
create table if not exists public.lukas_qto_projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.lukas_qto_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('ifc','qto_csv','element_ledger','formwork_ledger','estimate','mapping','other')),
  storage_path text not null unique check (storage_path !~ '(^/|//|/\.\.?/|^$)'),
  original_filename text not null check (char_length(trim(original_filename)) between 1 and 255),
  content_type text,
  byte_size bigint not null check (byte_size >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  immutable boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.lukas_qto_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  file_id uuid references public.lukas_qto_files(id) on delete set null,
  author_id uuid references auth.users(id) on delete set null,
  status text not null default 'open' check (status in ('open','in_review','resolved','blocked')),
  note text not null default '' check (char_length(note) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.lukas_qto_shares (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.lukas_qto_projects(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  token uuid not null unique default gen_random_uuid(),
  permission text not null check (permission in ('view','review')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lukas_qto_projects_owner_id_idx on public.lukas_qto_projects(owner_id);
create index if not exists lukas_qto_files_project_id_idx on public.lukas_qto_files(project_id);
create index if not exists lukas_qto_reviews_project_id_idx on public.lukas_qto_reviews(project_id);
create index if not exists lukas_qto_shares_project_id_idx on public.lukas_qto_shares(project_id);

alter table public.lukas_qto_projects enable row level security;
alter table public.lukas_qto_files enable row level security;
alter table public.lukas_qto_reviews enable row level security;
alter table public.lukas_qto_shares enable row level security;
create policy "lukas qto owners manage projects" on public.lukas_qto_projects for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "lukas qto owners manage files" on public.lukas_qto_files for all to authenticated
  using (exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (uploaded_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "lukas qto owners manage reviews" on public.lukas_qto_reviews for all to authenticated
  using (exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())));
create policy "lukas qto owners manage shares" on public.lukas_qto_shares for all to authenticated
  using (exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())))
  with check (created_by = (select auth.uid()) and exists (select 1 from public.lukas_qto_projects p where p.id = project_id and p.owner_id = (select auth.uid())));

create or replace function public.lukas_qto_set_updated_at() returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger lukas_qto_projects_set_updated_at before update on public.lukas_qto_projects for each row execute function public.lukas_qto_set_updated_at();
create trigger lukas_qto_reviews_set_updated_at before update on public.lukas_qto_reviews for each row execute function public.lukas_qto_set_updated_at();

-- Share RPCs stay server-only. The web app validates public tokens server-side;
-- the browser never gets elevated database access nor direct access to Storage.
create or replace function public.lukas_qto_shared_project(p_token uuid)
returns table(project_id uuid, project_name text, permission text, expires_at timestamptz)
language sql security definer set search_path = public as $$
  select p.id, p.name, s.permission, s.expires_at from public.lukas_qto_shares s
  join public.lukas_qto_projects p on p.id = s.project_id
  where s.token = p_token and (s.expires_at is null or s.expires_at > now());
$$;
create or replace function public.lukas_qto_submit_share_review(p_token uuid, p_status text, p_note text, p_file_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_project_id uuid; v_review_id uuid;
begin
  select s.project_id into v_project_id from public.lukas_qto_shares s
  where s.token = p_token and s.permission = 'review' and (s.expires_at is null or s.expires_at > now());
  if v_project_id is null then raise exception 'Invalid, expired, or read-only share link'; end if;
  if p_status not in ('open','in_review','resolved','blocked') then raise exception 'Invalid review status'; end if;
  if char_length(coalesce(p_note, '')) > 5000 then raise exception 'Review note is too long'; end if;
  if p_file_id is not null and not exists (select 1 from public.lukas_qto_files f where f.id = p_file_id and f.project_id = v_project_id) then raise exception 'File does not belong to the shared project'; end if;
  insert into public.lukas_qto_reviews(project_id,file_id,author_id,status,note)
  values (v_project_id,p_file_id,null,p_status,coalesce(p_note,'')) returning id into v_review_id;
  return v_review_id;
end;
$$;
revoke all on function public.lukas_qto_shared_project(uuid) from public, anon, authenticated;
revoke all on function public.lukas_qto_submit_share_review(uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.lukas_qto_shared_project(uuid) to service_role;
grant execute on function public.lukas_qto_submit_share_review(uuid,text,text,uuid) to service_role;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('lukas-qto','lukas-qto',false,1073741824,array['application/x-step','application/octet-stream','text/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "lukas qto owners read their source files" on storage.objects for select to authenticated using (bucket_id='lukas-qto' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "lukas qto owners upload their source files" on storage.objects for insert to authenticated with check (bucket_id='lukas-qto' and (storage.foldername(name))[1]=(select auth.uid()::text));
create policy "lukas qto owners delete their source files" on storage.objects for delete to authenticated using (bucket_id='lukas-qto' and (storage.foldername(name))[1]=(select auth.uid()::text));
