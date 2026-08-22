alter table public.lukas_qto_element_identity_links
  drop constraint lukas_qto_element_identity_links_revit_element_id_check;
alter table public.lukas_qto_element_identity_links
  alter column revit_element_id type text using revit_element_id::text;
alter table public.lukas_qto_element_identity_links
  add constraint lukas_qto_element_identity_links_revit_element_id_check
  check(revit_element_id ~ '^[1-9][0-9]{0,18}$');
