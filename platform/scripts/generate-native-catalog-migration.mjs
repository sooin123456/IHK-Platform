// Rebuild only generated seed/helper sections of the named migration. No database access.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildNativeDrawingTemplate,listNativeDrawingTemplateKeys} from '../app/lukas/lib/drawing-native-templates.ts';
import {listNativeDrawingSymbols,nativeAssetCanonicalJson} from '../app/lukas/lib/drawing-native-symbols.ts';
const file='supabase/migrations/20260905091919_native_drawing_catalog_import.sql';
let text=readFileSync(file,'utf8');
const old=text;
const generated=(name,body)=>{
  const start=`-- ${name}`;
  const end=`-- END_${name}`;
  const at=text.indexOf(start), until=text.indexOf(end,at);
  text=text.slice(0,at)+start+'\n'+body+'\n'+end+text.slice(until<0?at+start.length:until+end.length);
};
const assets=[...listNativeDrawingTemplateKeys().map(key=>['workspace_template',buildNativeDrawingTemplate(key)]),...listNativeDrawingSymbols().map(x=>['block',x])];
generated('NATIVE_SEED',assets.map(([kind,asset])=>{
  const compact=nativeAssetCanonicalJson(asset);
  const digest=createHash('sha256').update(compact).digest('hex');
  return `insert into private.lukas_drawing_native_assets(kind,key,version,definition,content_sha256,artifact_sha256) select '${kind}','${asset.key}',1,p,pg_catalog.encode(extensions.digest(p::text,'sha256'),'hex'),'${digest}' from (values($native$${compact}$native$::jsonb)) seed(p);`;
}).join('\n'));

const library=readFileSync('supabase/migrations/20260827231130_organization_drawing_libraries.sql','utf8');
let clone=library.slice(library.indexOf('create or replace function private.lukas_drawing_clone_library_template('),library.indexOf('create or replace function public.lukas_drawing_import_library_version('));
clone=clone.replace('private.lukas_drawing_clone_library_template(','private.lukas_drawing_clone_catalog_graph(').replace('p_source_revision_id uuid','p_snapshot jsonb');
const kinds={pages:'pages',canvases:'canvases',layers:'layers',styles:'styles',blocks:'blocks',objects:'objects',block_instances:'blockInstances',property_schemas:'propertySchemas',property_values:'propertyValues',tables:'tables'};
for(const [table,kind] of Object.entries(kinds)) {
  clone=clone.replaceAll(`from public.lukas_drawing_${table} where revision_id=p_source_revision_id`, `from pg_catalog.jsonb_populate_recordset(null::public.lukas_drawing_${table},private.lukas_drawing_catalog_rows(p_snapshot,'${kind}'))`);
}
clone=clone.replaceAll(" and status='active'", " where status='active'");
clone=clone.replace('from public.lukas_drawing_layers source\n  where source.revision_id=p_source_revision_id and',"from pg_catalog.jsonb_populate_recordset(null::public.lukas_drawing_layers,private.lukas_drawing_catalog_rows(p_snapshot,'layers')) source\n  where");
clone=clone.replace('height_mm,sort_order,version,created_by)\n    values(v_new_id,(v_page_map', 'height_mm,sort_order,version,created_by,output_profile)\n    values(v_new_id,(v_page_map');
clone=clone.replace('v_row.height_mm,v_row.sort_order,1,p_actor);','v_row.height_mm,v_row.sort_order,1,p_actor,v_row.output_profile);');
clone=clone.replace('declare v_document_id uuid;', 'declare v_ids jsonb; v_document_id uuid;');
clone=clone.replace('begin\n  insert into', `begin
  if p_actor is null or p_actor is distinct from (select auth.uid())
    or coalesce(private.lukas_drawing_workspace_capability(p_target_project_id),'') not in('admin','editor') then
    raise exception using errcode='P1R01',message='Drawing graph target is unavailable';
  end if;
  -- Allocate every graph identity before writing any references, including embedded tables.
  select pg_catalog.jsonb_object_agg(id,extensions.gen_random_uuid()) into v_ids from (
    select entity->>'id' id from pg_catalog.jsonb_each(p_snapshot) collection
      cross join lateral pg_catalog.jsonb_array_elements(collection.value) entity
      where collection.key in('pages','canvases','layers','styles','blocks','objects','blockInstances','propertySchemas','propertyValues','tables')
    union select item->>'id' from pg_catalog.jsonb_array_elements(p_snapshot->'tables') t cross join lateral pg_catalog.jsonb_array_elements(t->'columns') item
    union select item->>'id' from pg_catalog.jsonb_array_elements(p_snapshot->'tables') t cross join lateral pg_catalog.jsonb_array_elements(t->'rows') item
  ) identities where id is not null;
  insert into`);
clone=clone.replaceAll('v_new_id:=extensions.gen_random_uuid();', 'v_new_id:=(v_ids->>v_row.id::text)::uuid;');
clone=clone.replace('v_row.id::text,extensions.gen_random_uuid()', 'v_row.id::text,(v_ids->>v_row.id::text)::uuid');
clone=clone.replaceAll('values(extensions.gen_random_uuid(),', 'values((v_ids->>v_row.id::text)::uuid,');
clone=clone.replace('v_new_id:=(v_ids->>v_row.id::text)::uuid; v_column_map', "v_new_id:=(v_ids->>(v_item->>'id'))::uuid; v_column_map");
clone=clone.replace("pg_catalog.to_jsonb(extensions.gen_random_uuid())", "pg_catalog.to_jsonb((v_ids->>(v_item->>'id'))::uuid)");
// jsonb_populate_recordset maps JSON null to SQL NULL; optional property values retain JSON null.
clone=clone.replace('v_revision_id,p_target_project_id,v_row.value,1,p_actor);','v_revision_id,p_target_project_id,coalesce(v_row.value,\'null\'::jsonb),1,p_actor);');
const rows=`create function private.lukas_drawing_catalog_rows(p_snapshot jsonb,p_kind text)
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(pg_catalog.jsonb_agg(converted.value||case
    when p_kind='objects' then pg_catalog.jsonb_build_object('status','active','object_type',coalesce(item->'type',item->'geometry'->'type'),'page_id',coalesce(item->'pageId',(select c->'pageId' from pg_catalog.jsonb_array_elements(p_snapshot->'layers') l join pg_catalog.jsonb_array_elements(p_snapshot->'canvases') c on c->>'id'=l->>'canvasId' where l->>'id'=item->>'layerId')))
    when p_kind='layers' then pg_catalog.jsonb_build_object('page_id',coalesce(item->'pageId',(select c->'pageId' from pg_catalog.jsonb_array_elements(p_snapshot->'canvases') c where c->>'id'=item->>'canvasId')))
    when p_kind='pages' then pg_catalog.jsonb_build_object('width_mm',coalesce(item->'widthMillimeters',p_snapshot->'canvases'->0->'widthMillimeters','1000'::jsonb),'height_mm',coalesce(item->'heightMillimeters',p_snapshot->'canvases'->0->'heightMillimeters','1000'::jsonb)) else '{}'::jsonb end),'[]'::jsonb)
  from pg_catalog.jsonb_array_elements(p_snapshot->p_kind) item
  cross join lateral (select pg_catalog.jsonb_object_agg(case key
    when 'type' then 'object_type' when 'columns' then 'columns_json' when 'rows' then 'rows_json'
    when 'widthMillimeters' then 'width_mm' when 'heightMillimeters' then 'height_mm'
    else pg_catalog.lower(pg_catalog.regexp_replace(key,'([A-Z])','_\\1','g')) end,value) value
    from pg_catalog.jsonb_each(item)) converted
$$;
`;
const wrapper=`create or replace function private.lukas_drawing_clone_library_template(p_source_revision_id uuid,p_target_project_id uuid,p_actor uuid,p_title text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;
begin
  snapshot:=private.lukas_drawing_p2_canonical_snapshot(p_source_revision_id,true);
  snapshot:=pg_catalog.jsonb_set(snapshot,'{pages}',(select pg_catalog.jsonb_agg(x.value||pg_catalog.jsonb_build_object('widthMillimeters',p.width_mm,'heightMillimeters',p.height_mm) order by x.ordinality) from pg_catalog.jsonb_array_elements(snapshot->'pages') with ordinality x join public.lukas_drawing_pages p on p.id=(x.value->>'id')::uuid));
  return private.lukas_drawing_clone_catalog_graph(snapshot,p_target_project_id,p_actor,p_title);
end;
$$;
revoke all on function private.lukas_drawing_catalog_rows(jsonb,text),private.lukas_drawing_clone_catalog_graph(jsonb,uuid,uuid,text),private.lukas_drawing_clone_library_template(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;`;
generated('NATIVE_CLONE_HELPER',rows+clone+wrapper);
// Patch the underlying materializers in place, preserving all existing wrappers and guards.
// Exact source matches fail the migration if a predecessor's implementation changes.
// Locate the P2 materializer under the name given by later wrapper migrations.
// The migration discovers it by its actual canvas insert body below, not by a guessed version suffix.
generated('PROFILE_MATERIALIZERS',`do $profile$
declare proc record; source text; changed text; canvas_start integer; canvas_end integer; section text;
begin
  for proc in select pg_catalog.unnest(array[
    'private.lukas_drawing_apply_operation_pre_p2_contract_hardening(uuid,uuid,text,jsonb,jsonb,jsonb)'::regprocedure,
    'private.lukas_drawing_checkpoint_stage_canvases(uuid,jsonb,jsonb)'::regprocedure,
    'private.lukas_drawing_create_from_template_pre_p2_contract_hardening(uuid,text,uuid)'::regprocedure
  ])::oid oid loop
    source:=pg_catalog.pg_get_functiondef(proc.oid); changed:=source;
    if pg_catalog.strpos(source,'insert into public.lukas_drawing_canvases')=0 then raise exception 'Canvas materializer predecessor missing: %',proc.oid::regprocedure; end if;
    canvas_start:=pg_catalog.strpos(source,'insert into public.lukas_drawing_canvases');
    canvas_end:=pg_catalog.strpos(pg_catalog.substr(source,canvas_start),';')+canvas_start;
    section:=pg_catalog.substr(source,canvas_start,canvas_end-canvas_start);
    if pg_catalog.strpos(section,'output_profile')>0 then raise exception 'Canvas materializer predecessor already changed: %',proc.oid::regprocedure; end if;
    if pg_catalog.strpos(section,'v_entity')>0 then
      changed:=pg_catalog.replace(changed,section,pg_catalog.regexp_replace(section,'created_by([[:space:]]*)\\)','created_by,output_profile\\1)'));
      canvas_end:=pg_catalog.strpos(pg_catalog.substr(changed,canvas_start),';')+canvas_start;
      section:=pg_catalog.substr(changed,canvas_start,canvas_end-canvas_start);
      changed:=pg_catalog.replace(changed,section,pg_catalog.regexp_replace(section,'v_actor([[:space:]]*)\\);$','v_actor,v_entity->''outputProfile''\\1);'));
      changed:=pg_catalog.replace(changed,'else update public.lukas_drawing_canvases set name=v_entity->>''name'',','else update public.lukas_drawing_canvases set output_profile=v_entity->''outputProfile'',name=v_entity->>''name'',');
    elsif pg_catalog.strpos(section,'v_row.width_mm')>0 then
      changed:=pg_catalog.replace(changed,section,pg_catalog.regexp_replace(pg_catalog.regexp_replace(section,'created_by([[:space:]]*)\\)','created_by,output_profile\\1)'),'v_actor([[:space:]]*)\\);$','v_actor,v_row.output_profile\\1);'));
    end if;
    if changed=source or pg_catalog.strpos(changed,'output_profile')=0 then raise exception 'Canvas materializer profile patch failed: %',proc.oid::regprocedure; end if;
    execute changed;
  end loop;
end;
$profile$;
revoke all on function private.lukas_drawing_output_profile_valid(jsonb,numeric,numeric),private.lukas_drawing_structure_action_valid(jsonb,uuid),private.lukas_drawing_structure_action_valid_pre_output_profile(jsonb,uuid),private.lukas_drawing_structure_entity_json(text,uuid,uuid,uuid),private.lukas_drawing_structure_entity_json_pre_output_profile(text,uuid,uuid,uuid),private.lukas_drawing_p2_canonical_snapshot(uuid,boolean),private.lukas_drawing_p2_canonical_snapshot_pre_output_profile(uuid,boolean) from public,anon,authenticated,service_role;`);
if(process.argv.includes('--check')) {
  if(text!==old)throw new Error('Native catalog migration differs from reproducible authored generation');
  console.log('Native catalog seed and shared clone helper are reproducible');
} else execFileSync('apply_patch',[],{input:'*** Begin Patch\n*** Update File: '+file+'\n@@\n'+old.trimEnd().split('\n').map(x=>'-'+x).join('\n')+'\n'+text.trimEnd().split('\n').map(x=>'+'+x).join('\n')+'\n*** End Patch\n',stdio:['pipe','inherit','inherit']});
