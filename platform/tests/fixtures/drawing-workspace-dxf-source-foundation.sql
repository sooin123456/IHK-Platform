create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role lukas_drawing_collaboration nologin;
create publication supabase_realtime;
create schema auth;
create schema extensions;
create schema private;
create schema storage;
create extension pgcrypto with schema extensions;

alter default privileges in schema public
  grant all on tables to anon,authenticated,service_role;
alter default privileges in schema public
  grant all on sequences to anon,authenticated,service_role;
alter default privileges in schema public
  grant all on functions to anon,authenticated,service_role;

create table auth.users(
  id uuid primary key,
  email text,
  email_confirmed_at timestamptz,
  is_anonymous boolean not null default false,
  raw_app_meta_data jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

create function auth.uid() returns uuid language sql stable set search_path='' as $$
  select (nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;

create function auth.jwt() returns jsonb language sql stable set search_path='' as $$
  select coalesce(nullif(pg_catalog.current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)
$$;

create table storage.buckets(
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);

create table storage.objects(
  id uuid primary key default extensions.gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null
);

create function storage.foldername(text) returns text[] language sql immutable as $$
  select pg_catalog.string_to_array($1,'/')
$$;

grant usage on schema auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid(),auth.jwt(),storage.foldername(text)
  to anon,authenticated,service_role;
