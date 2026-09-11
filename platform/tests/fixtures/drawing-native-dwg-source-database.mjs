import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

const FUNCTION_SIGNATURE =
  "public.lukas_qto_drawing_native_dwg_source(uuid,uuid,uuid,bigint,uuid,text)";
const UNAVAILABLE_MESSAGE = "Approved native DWG source is unavailable";

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function quoteRole(role) {
  assert.ok(["anon", "authenticated", "service_role"].includes(role));
  return `"${role}"`;
}

async function localSession(tx, role, actorId, callback, options = {}) {
  return tx.savepoint(async (sp) => {
    await sp.unsafe(`set local role ${quoteRole(role)}`);
    await sp`select pg_catalog.set_config(
      'request.jwt.claims',${JSON.stringify({
        role,
        sub: actorId ?? undefined,
        is_anonymous: options.anonymous ?? false,
        app_metadata: {},
      })},true
    )`;
    const result = await callback(sp);
    await sp.unsafe("reset role");
    await sp`select pg_catalog.set_config('request.jwt.claims','{}',true)`;
    return result;
  });
}

function callSource(tx, request) {
  return tx`
    select public.lukas_qto_drawing_native_dwg_source(
      ${request.projectId}::uuid,
      ${request.documentId}::uuid,
      ${request.revisionId}::uuid,
      ${request.revisionVersion}::bigint,
      ${request.canvasId}::uuid,
      ${request.snapshotSha256}
    ) value
  `;
}

async function assertUnavailable(promise, code = "PND01") {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    if (code === "PND01") assert.equal(error.message, UNAVAILABLE_MESSAGE);
    assert.doesNotMatch(error.message, /canonical_json|select |storage_path|sql/i);
    return true;
  });
}

async function importNativeTemplate(tx, ids, key = "measured-plan") {
  const [row] = await localSession(
    tx,
    "authenticated",
    ids.users.editor,
    (sp) => sp`
      select public.lukas_drawing_import_native_asset(
        ${ids.project}::uuid,null::uuid,'workspace_template',${key},1,
        ${randomUUID()}::uuid
      ) value
    `,
  );
  return row.value;
}

async function revisionScope(tx, ids, imported) {
  const [row] = await tx`
    select r.document_id,r.version,r.sequence,c.id canvas_id
    from public.lukas_drawing_revisions r
    join public.lukas_drawing_canvases c
      on c.revision_id=r.id and c.project_id=r.project_id
    where r.id=${imported.revisionId}::uuid
  `;
  assert.ok(row);
  return {
    projectId: ids.project,
    documentId: row.document_id,
    revisionId: imported.revisionId,
    revisionVersion: Number(row.version),
    canvasId: row.canvas_id,
    snapshotSha256: "0".repeat(64),
  };
}

async function reviewAndApprove(tx, ids, revisionId) {
  await localSession(tx, "authenticated", ids.users.editor, (sp) => sp`
    select public.lukas_drawing_request_review(${revisionId}::uuid)
  `);
  const [subject] = await tx`
    select r.version,r.sequence,s.sha256,s.operation_sequence,
      s.canonical_json::text canonical_json_text,
      pg_catalog.encode(extensions.digest(
        pg_catalog.convert_to(s.canonical_json::text,'UTF8'),'sha256'
      ),'hex') recomputed
    from public.lukas_drawing_revisions r
    join public.lukas_drawing_snapshots s
      on s.revision_id=r.id and s.project_id=r.project_id
        and s.revision_version=r.version
    where r.id=${revisionId}::uuid
  `;
  assert.ok(subject);
  assert.equal(subject.sha256, subject.recomputed);
  await localSession(tx, "authenticated", ids.users.reviewer, (sp) => sp`
    select public.lukas_drawing_record_revision_decision(
      ${revisionId}::uuid,${subject.version}::bigint,${subject.sha256},
      'reviewed','Native DWG source review proof'
    )
  `);
  return subject;
}

async function approveReviewed(tx, ids, revisionId, subject) {
  await localSession(tx, "authenticated", ids.users.approver, (sp) => sp`
    select public.lukas_drawing_record_revision_decision(
      ${revisionId}::uuid,${subject.version}::bigint,${subject.sha256},
      'approved','Native DWG source approval proof'
    )
  `);
}

async function approvedImportedScope(tx, ids, imported) {
  const scope = await revisionScope(tx, ids, imported);
  const subject = await reviewAndApprove(tx, ids, imported.revisionId);
  scope.revisionVersion = Number(subject.version);
  scope.snapshotSha256 = subject.sha256;
  await approveReviewed(tx, ids, imported.revisionId, subject);
  return { scope, subject };
}

async function addThenDeleteObjectSource(tx, ids, imported, sourceFile) {
  const [object] = await tx`
    select id from public.lukas_drawing_objects
    where revision_id=${imported.revisionId}::uuid and status='active'
    order by id limit 1
  `;
  assert.ok(object);
  const source = {
    id: randomUUID(),
    objectId: object.id,
    revisionId: imported.revisionId,
    sourceFileId: sourceFile.id,
    sourceSha256: sourceFile.sha256,
    sourceKind: "pdf_region",
    pdfPageNumber: 1,
    x: 0.1,
    y: 0.1,
    width: 0.2,
    height: 0.2,
    version: 1,
  };
  await localSession(tx, "authenticated", ids.users.editor, (sp) => sp`
    select public.lukas_drawing_apply_operation(
      ${imported.revisionId}::uuid,${randomUUID()}::uuid,'mutate_structure',
      '{}'::jsonb,
      ${sp.json({
        type: "mutate_structure",
        actions: [{ kind: "put_source", entity: source, baseVersion: null }],
      })}::jsonb,
      ${sp.json({
        type: "mutate_structure",
        actions: [{ kind: "delete_source", id: source.id, baseVersion: 1 }],
      })}::jsonb
    )
  `);
  await localSession(tx, "authenticated", ids.users.editor, (sp) => sp`
    select public.lukas_drawing_apply_operation(
      ${imported.revisionId}::uuid,${randomUUID()}::uuid,'mutate_structure',
      ${sp.json({ [source.id]: 1 })}::jsonb,
      ${sp.json({
        type: "mutate_structure",
        actions: [{ kind: "delete_source", id: source.id, baseVersion: 1 }],
      })}::jsonb,
      ${sp.json({
        type: "mutate_structure",
        actions: [{ kind: "put_source", entity: source, baseVersion: null }],
      })}::jsonb
    )
  `);
  const [stored] = await tx`
    select status,version from public.lukas_drawing_object_sources
    where id=${source.id}::uuid
  `;
  assert.deepEqual(
    { status: stored.status, version: Number(stored.version) },
    { status: "deleted", version: 2 },
  );
}

async function persistUnitScaleOutputProfile(tx, ids, revisionId) {
  const [stored] = await tx`
    select private.lukas_drawing_structure_entity_json(
      'canvas',canvas.id,canvas.revision_id,canvas.project_id
    ) entity
    from public.lukas_drawing_canvases canvas
    where canvas.revision_id=${revisionId}::uuid
  `;
  assert.ok(stored);
  const updated = {
    ...stored.entity,
    outputProfile: {
      paper: "A3",
      orientation: "landscape",
      widthMillimeters: stored.entity.widthMillimeters,
      heightMillimeters: stored.entity.heightMillimeters,
      scaleDenominator: 1,
    },
  };
  await localSession(tx, "authenticated", ids.users.editor, (sp) => sp`
    select public.lukas_drawing_apply_operation(
      ${revisionId}::uuid,${randomUUID()}::uuid,'mutate_structure',
      ${sp.json({ [stored.entity.id]: stored.entity.version })}::jsonb,
      ${sp.json({
        type: "mutate_structure",
        actions: [{
          kind: "put_canvas",
          entity: updated,
          baseVersion: stored.entity.version,
        }],
      })}::jsonb,
      ${sp.json({
        type: "mutate_structure",
        actions: [{
          kind: "put_canvas",
          entity: stored.entity,
          baseVersion: stored.entity.version + 1,
        }],
      })}::jsonb
    )
  `);
}

async function seedAdversarialPreApprovalIfcBinding(tx, ids, imported) {
  const source = {
    id: randomUUID(),
    sha256: "7".repeat(64),
    path: `m1/${ids.project}/adversarial-native-binding.ifc`,
  };
  const derivative = {
    id: randomUUID(),
    manifestSha256: "8".repeat(64),
    geometrySha256: "9".repeat(64),
  };
  const prefix = `projects/${ids.project}/ifc-derivatives/${source.sha256}/v1`;
  const manifest = {
    schemaVersion: 1,
    source: { fileId: source.id, sha256: source.sha256 },
    geometry: { sha256: derivative.geometrySha256 },
    elements: [],
  };
  await tx`
    insert into public.lukas_qto_files(
      id,project_id,uploaded_by,kind,storage_path,original_filename,
      content_type,byte_size,sha256,immutable
    ) values(
      ${source.id}::uuid,${ids.project}::uuid,${ids.users.editor}::uuid,
      'ifc',${source.path},'adversarial-native-binding.ifc',
      'application/x-step',1,${source.sha256},true
    )
  `;
  await tx`
    insert into storage.objects(id,bucket_id,name)
    values(${randomUUID()}::uuid,'lukas-qto',${source.path})
  `;
  await tx`
    insert into public.lukas_drawing_ifc_derivatives(
      id,project_id,source_file_id,source_sha256,version,schema_version,status,
      manifest_json,manifest_storage_path,manifest_byte_size,manifest_sha256,
      geometry_storage_path,geometry_byte_size,geometry_sha256,created_by
    ) values(
      ${derivative.id}::uuid,${ids.project}::uuid,${source.id}::uuid,
      ${source.sha256},1,1,'ready',${tx.json(manifest)}::jsonb,
      ${`${prefix}/${derivative.manifestSha256}.json`},256,
      ${derivative.manifestSha256},
      ${`${prefix}/${derivative.geometrySha256}.glb`},128,
      ${derivative.geometrySha256},${ids.users.editor}::uuid
    )
  `;
  const [revision] = await tx`
    select version from public.lukas_drawing_revisions
    where id=${imported.revisionId}::uuid
  `;
  const bindingId = randomUUID();
  await tx`
    insert into public.lukas_drawing_revision_ifc_derivatives(
      id,revision_id,revision_version,project_id,source_file_id,source_sha256,
      derivative_id,derivative_version,manifest_sha256,geometry_sha256,created_by
    ) values(
      ${bindingId}::uuid,${imported.revisionId}::uuid,${revision.version}::bigint,
      ${ids.project}::uuid,${source.id}::uuid,${source.sha256},
      ${derivative.id}::uuid,1,${derivative.manifestSha256},
      ${derivative.geometrySha256},${ids.users.editor}::uuid
    )
  `;
  return bindingId;
}

export async function proveNativeDwgSourceAuthority({
  owner,
  ids,
  onApprovedSource,
}) {
  assert.equal(typeof owner?.begin, "function");
  assert.equal(onApprovedSource === undefined || typeof onApprovedSource === "function", true);
  const rollback = new Error("M1 native DWG source proof rollback");
  try {
    await owner.begin(async (tx) => {
      const [privileges] = await tx`
        select
          not exists(
            select 1
            from pg_catalog.pg_proc routine,
              lateral pg_catalog.aclexplode(coalesce(
                routine.proacl,
                pg_catalog.acldefault('f',routine.proowner)
              )) grant_entry
            where routine.oid=${FUNCTION_SIGNATURE}::pg_catalog.regprocedure
              and grant_entry.grantee=0
              and grant_entry.privilege_type='EXECUTE'
          ) public_denied,
          pg_catalog.has_function_privilege(
            'anon',${FUNCTION_SIGNATURE},'EXECUTE'
          ) anon,
          pg_catalog.has_function_privilege(
            'authenticated',${FUNCTION_SIGNATURE},'EXECUTE'
          ) authenticated,
          pg_catalog.has_function_privilege(
            'service_role',${FUNCTION_SIGNATURE},'EXECUTE'
          ) service_role
      `;
      assert.deepEqual(privileges, {
        public_denied: true,
        anon: false,
        authenticated: true,
        service_role: false,
      });

      const imported = await importNativeTemplate(tx, ids);
      const scope = await revisionScope(tx, ids, imported);
      const [draftCanonical] = await tx`
        select private.lukas_drawing_p2_canonical_snapshot(
          ${imported.revisionId}::uuid,true
        )::text canonical_json_text
      `;
      scope.snapshotSha256 = sha256(draftCanonical.canonical_json_text);
      await assertUnavailable(
        localSession(tx, "authenticated", ids.users.editor, (sp) =>
          callSource(sp, scope),
        ),
      );

      const subject = await reviewAndApprove(tx, ids, imported.revisionId);
      scope.revisionVersion = Number(subject.version);
      scope.snapshotSha256 = subject.sha256;
      await assertUnavailable(
        localSession(tx, "authenticated", ids.users.reviewer, (sp) =>
          callSource(sp, scope),
        ),
      );
      await approveReviewed(tx, ids, imported.revisionId, subject);

      const beforeRead = await tx`
        select r.status,r.version,r.updated_at,d.updated_at,
          s.canonical_json::text canonical_json_text,s.sha256,
          (select pg_catalog.count(*)::integer
            from public.lukas_drawing_operations operation
            where operation.revision_id=r.id) operation_count,
          (select pg_catalog.count(*)::integer
            from public.lukas_drawing_revision_approvals approval
            where approval.revision_id=r.id) approval_count
        from public.lukas_drawing_revisions r
        join public.lukas_drawing_documents d
          on d.id=r.document_id and d.project_id=r.project_id
        join public.lukas_drawing_snapshots s
          on s.revision_id=r.id and s.project_id=r.project_id
            and s.revision_version=r.version
        where r.id=${imported.revisionId}::uuid
      `;
      assert.equal(beforeRead.length, 1);

      const payloads = [];
      for (const actor of [
        ids.users.owner,
        ids.users.editor,
        ids.users.viewer,
      ]) {
        const [row] = await localSession(
          tx,
          "authenticated",
          actor,
          (sp) => callSource(sp, scope),
        );
        payloads.push(row.value);
      }
      assert.deepEqual(payloads[1], payloads[0]);
      assert.deepEqual(payloads[2], payloads[0]);
      const payload = payloads[0];
      assert.equal(payload.snapshot.canonicalJsonText, subject.canonical_json_text);
      assert.equal(
        sha256(payload.snapshot.canonicalJsonText),
        payload.snapshot.sha256,
      );
      assert.equal(payload.snapshot.operationSequence, Number(subject.operation_sequence));
      assert.equal(payload.revision.sequence, Number(subject.sequence));
      assert.equal(payload.approvalDecision, "approved");
      assert.deepEqual(
        Object.keys(payload).sort(),
        [
          "approvalDecision",
          "canvasId",
          "documentId",
          "projectId",
          "revision",
          "snapshot",
        ],
      );

      if (onApprovedSource) {
        await onApprovedSource({
          request: scope,
          payload,
          tx,
          createApprovedNativeScope: async (key) => approvedImportedScope(
            tx,
            ids,
            await importNativeTemplate(tx, ids, key),
          ),
        });
      }

      await assertUnavailable(
        localSession(tx, "authenticated", ids.users.outsider, (sp) =>
          callSource(sp, scope),
        ),
      );
      await assertUnavailable(
        localSession(
          tx,
          "authenticated",
          ids.users.anonymous,
          (sp) => callSource(sp, scope),
          { anonymous: true },
        ),
      );
      await assertUnavailable(
        localSession(tx, "anon", null, (sp) => callSource(sp, scope)),
        "42501",
      );

      await tx`
        insert into public.lukas_qto_project_members(project_id,user_id,role)
        values(${ids.project}::uuid,${ids.users.quickOwner}::uuid,'viewer')
      `;
      const [beforeRevoke] = await localSession(
        tx,
        "authenticated",
        ids.users.quickOwner,
        (sp) => callSource(sp, scope),
      );
      assert.equal(beforeRevoke.value.snapshot.sha256, scope.snapshotSha256);
      await tx`
        delete from public.lukas_qto_project_members
        where project_id=${ids.project}::uuid
          and user_id=${ids.users.quickOwner}::uuid
      `;
      await assertUnavailable(
        localSession(tx, "authenticated", ids.users.quickOwner, (sp) =>
          callSource(sp, scope),
        ),
      );

      for (const mismatch of [
        { projectId: ids.foreignProject },
        { documentId: randomUUID() },
        { revisionId: randomUUID() },
        { revisionVersion: scope.revisionVersion + 1 },
        { canvasId: randomUUID() },
        { snapshotSha256: "f".repeat(64) },
      ])
        await assertUnavailable(
          localSession(tx, "authenticated", ids.users.owner, (sp) =>
            callSource(sp, { ...scope, ...mismatch }),
          ),
        );

      const afterRead = await tx`
        select r.status,r.version,r.updated_at,d.updated_at,
          s.canonical_json::text canonical_json_text,s.sha256,
          (select pg_catalog.count(*)::integer
            from public.lukas_drawing_operations operation
            where operation.revision_id=r.id) operation_count,
          (select pg_catalog.count(*)::integer
            from public.lukas_drawing_revision_approvals approval
            where approval.revision_id=r.id) approval_count
        from public.lukas_drawing_revisions r
        join public.lukas_drawing_documents d
          on d.id=r.document_id and d.project_id=r.project_id
        join public.lukas_drawing_snapshots s
          on s.revision_id=r.id and s.project_id=r.project_id
            and s.revision_version=r.version
        where r.id=${imported.revisionId}::uuid
      `;
      assert.deepEqual(afterRead, beforeRead, "source lookup is read-only");

      const pdfFile = {
        id: randomUUID(),
        sha256: "e".repeat(64),
        path: `m1/${ids.project}/native-dwg-source-proof.pdf`,
      };
      await tx`
        insert into public.lukas_qto_files(
          id,project_id,uploaded_by,kind,storage_path,original_filename,
          content_type,byte_size,sha256,immutable
        ) values(
          ${pdfFile.id}::uuid,${ids.project}::uuid,${ids.users.editor}::uuid,
          'pdf',${pdfFile.path},'native-dwg-source-proof.pdf',
          'application/pdf',1,${pdfFile.sha256},true
        )
      `;
      await tx`
        insert into storage.objects(id,bucket_id,name)
        values(${randomUUID()}::uuid,'lukas-qto',${pdfFile.path})
      `;

      const guardDraft = await importNativeTemplate(tx, ids, "office-layout");
      const [guardPage] = await tx`
        select id from public.lukas_drawing_pages
        where revision_id=${guardDraft.revisionId}::uuid
      `;
      await assertUnavailable(
        localSession(tx, "authenticated", ids.users.editor, (sp) => sp`
          update public.lukas_drawing_pages set
            background_source_file_id=${pdfFile.id}::uuid,
            background_source_sha256=${pdfFile.sha256},
            background_pdf_page=1
          where id=${guardPage.id}::uuid
        `),
        "42501",
      );
      await assert.rejects(
        tx.savepoint(async (sp) => {
          await sp`select pg_catalog.set_config(
            'request.jwt.claims',${JSON.stringify({
              role: "authenticated",
              sub: ids.users.editor,
              is_anonymous: false,
              app_metadata: {},
            })},true
          )`;
          return sp`
            update public.lukas_drawing_pages set
              background_source_file_id=${pdfFile.id}::uuid,
              background_source_sha256=${pdfFile.sha256},
              background_pdf_page=1
            where id=${guardPage.id}::uuid
          `;
        }),
        (error) => error.code === "P1C01" &&
          /Legacy drawing page canvas columns are read-only/.test(error.message),
      );
      await tx`select pg_catalog.set_config('request.jwt.claims','{}',true)`;

      const [sourceDocument] = await localSession(
        tx,
        "authenticated",
        ids.users.editor,
        (sp) => sp`
          select public.lukas_drawing_create_document_idempotent(
            ${ids.project}::uuid,${pdfFile.id}::uuid,
            'M1 source-bound native rejection',true,${randomUUID()}::uuid,
            null::uuid
          ) value
        `,
      );
      const [sourceOnly] = await tx`
        select d.source_file_id,d.source_sha256,
          pg_catalog.count(*) filter(where
            page.background_source_file_id is not null
            or page.background_source_sha256 is not null
            or page.background_pdf_page is not null
            or page.calibration is not null
            or canvas.background_source_file_id is not null
            or canvas.background_source_sha256 is not null
            or canvas.background_pdf_page is not null
            or canvas.calibration is not null
          )::integer background_count
        from public.lukas_drawing_documents d
        join public.lukas_drawing_revisions revision
          on revision.document_id=d.id and revision.project_id=d.project_id
        join public.lukas_drawing_pages page
          on page.revision_id=revision.id and page.project_id=revision.project_id
        join public.lukas_drawing_canvases canvas
          on canvas.page_id=page.id and canvas.revision_id=revision.id
        where d.id=${sourceDocument.value.documentId}::uuid
        group by d.source_file_id,d.source_sha256
      `;
      assert.deepEqual(sourceOnly, {
        source_file_id: pdfFile.id,
        source_sha256: pdfFile.sha256,
        background_count: 0,
      });
      await persistUnitScaleOutputProfile(
        tx,
        ids,
        sourceDocument.value.revisionId,
      );
      const sourceBound = await approvedImportedScope(
        tx,
        ids,
        sourceDocument.value,
      );
      await assertUnavailable(
        localSession(tx, "authenticated", ids.users.owner, (sp) =>
          callSource(sp, sourceBound.scope),
        ),
      );

      const sourceHistory = await importNativeTemplate(
        tx,
        ids,
        "finishes-takeoff",
      );
      await addThenDeleteObjectSource(tx, ids, sourceHistory, pdfFile);
      const deletedSource = await approvedImportedScope(
        tx,
        ids,
        sourceHistory,
      );
      const [snapshotSources] = await tx`
        select canonical_json->'sources' sources
        from public.lukas_drawing_snapshots
        where revision_id=${sourceHistory.revisionId}::uuid
          and revision_version=${deletedSource.scope.revisionVersion}::bigint
      `;
      assert.deepEqual(snapshotSources.sources, []);
      await assertUnavailable(
        localSession(tx, "authenticated", ids.users.owner, (sp) =>
          callSource(sp, deletedSource.scope),
        ),
      );

      // This is deliberately adversarial: table-owner setup creates a valid
      // pre-approval binding that normal source-free native workflows cannot.
      // It exercises the independent binding predicate without bypassing a
      // trigger or changing any approved row.
      const boundNative = await importNativeTemplate(tx, ids, "remodel-phases");
      const bindingId = await seedAdversarialPreApprovalIfcBinding(
        tx,
        ids,
        boundNative,
      );
      const boundSource = await approvedImportedScope(tx, ids, boundNative);
      const [binding] = await tx`
        select revision_id,revision_version
        from public.lukas_drawing_revision_ifc_derivatives
        where id=${bindingId}::uuid
      `;
      assert.deepEqual(
        {
          revision_id: binding.revision_id,
          revision_version: Number(binding.revision_version),
        },
        {
          revision_id: boundNative.revisionId,
          revision_version: boundSource.scope.revisionVersion,
        },
      );
      await assertUnavailable(
        localSession(tx, "authenticated", ids.users.owner, (sp) =>
          callSource(sp, boundSource.scope),
        ),
      );

      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
}
