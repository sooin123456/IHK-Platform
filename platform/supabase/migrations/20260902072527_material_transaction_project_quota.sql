create or replace function private.lukas_qto_enforce_material_transaction_project_quota()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'lukas_qto_material_transactions:'||new.project_id::text,
      0
    )
  );
  if (
    select pg_catalog.count(*)
    from public.lukas_qto_material_transactions
    where project_id=new.project_id
  )>=10000 then
    raise exception 'Material transaction project limit exceeded';
  end if;
  return new;
end;
$$;

revoke all on function private.lukas_qto_enforce_material_transaction_project_quota()
  from public;

drop trigger if exists lukas_qto_material_transactions_write_quota
  on public.lukas_qto_material_transactions;
create trigger lukas_qto_material_transactions_write_quota
before insert on public.lukas_qto_material_transactions
for each row execute function private.lukas_qto_enforce_material_transaction_project_quota();
