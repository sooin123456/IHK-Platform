do $m1_collaboration_role_assumption$
begin
  if current_setting('server_version_num')::integer >= 160000 then
    execute 'grant lukas_drawing_collaboration to postgres with inherit false, set true';
  else
    execute 'grant lukas_drawing_collaboration to postgres';
  end if;
end
$m1_collaboration_role_assumption$;
