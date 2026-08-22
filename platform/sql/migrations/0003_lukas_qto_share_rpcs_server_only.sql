-- Public share URLs are handled by the server. Do not expose SECURITY DEFINER
-- token functions through the browser-accessible Supabase RPC endpoint.
revoke execute on function public.lukas_qto_shared_project(uuid) from anon, authenticated;
revoke execute on function public.lukas_qto_submit_share_review(uuid, text, text, uuid) from anon, authenticated;
grant execute on function public.lukas_qto_shared_project(uuid) to service_role;
grant execute on function public.lukas_qto_submit_share_review(uuid, text, text, uuid) to service_role;
