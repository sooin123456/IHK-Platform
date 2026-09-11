begin;

-- Evidence gate only: introduce a shared price-book registry after identical
-- immutable source bytes are actually reused across multiple projects.
create function public.lukas_qto_list_organization_price_book_reuse_candidates(
  p_organization_id uuid
) returns table(
  source_sha256 text,
  project_count integer,
  price_book_count integer,
  projects jsonb
) language plpgsql stable security definer set search_path='' as $$
begin
  if (select auth.uid()) is null
    or private.lukas_qto_verified_session() is not true
    or not private.lukas_qto_organization_manager(p_organization_id) then
    raise exception using errcode='P7A04',
      message='Organization price-book reuse evidence authority denied';
  end if;
  if not private.lukas_qto_organization_feature_active(
      p_organization_id,'organization_library'
    ) or not private.lukas_qto_organization_feature_active(
      p_organization_id,'quantity_lineage'
    ) then
    raise exception using errcode='P7A07',
      message='Organization price-book reuse evidence entitlement is unavailable';
  end if;

  return query
  with candidates as (
    select b.source_sha256,
      pg_catalog.count(distinct b.project_id)::integer as project_count,
      pg_catalog.count(*)::integer as price_book_count
    from public.lukas_qto_price_books b
    join public.lukas_qto_projects p on p.id=b.project_id
    where p.organization_id=p_organization_id
    group by b.source_sha256
    having pg_catalog.count(distinct b.project_id)>=2
  )
  select c.source_sha256,c.project_count,c.price_book_count,
    (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id',used.id,'name',used.name)
        order by used.name,used.id
      )
      from (
        select distinct p.id,p.name
        from public.lukas_qto_price_books b
        join public.lukas_qto_projects p on p.id=b.project_id
        where p.organization_id=p_organization_id
          and b.source_sha256=c.source_sha256
      ) used
    ) as projects
  from candidates c
  order by c.project_count desc,c.price_book_count desc,c.source_sha256
  limit 100;
end;
$$;

revoke all on function
  public.lukas_qto_list_organization_price_book_reuse_candidates(uuid)
from public,anon,authenticated,service_role;
grant execute on function
  public.lukas_qto_list_organization_price_book_reuse_candidates(uuid)
to authenticated,service_role;

commit;
