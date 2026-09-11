import assert from "node:assert/strict";
import test from "node:test";

let model;
try {
  model = await import("../app/lukas/lib/workflow-prototype.ts");
} catch {}
test('restoring expired sharing preserves frozen scope and requires owner role and reason',()=>{
 let s=model.reduceWorkflow(model.createWorkflow('civil'),{type:'share-preview',recipient:'guest@example.com',permission:'view',includeAmount:false});
 s=model.reduceWorkflow(s,{type:'revise'});s=model.reduceWorkflow(s,{type:'share-expire'});
 const restored=model.reduceWorkflow(s,{type:'share-restore',message:'기존 범위 확인 허용'});
 assert.equal(restored.sharePreview.status,'active');
 assert.deepEqual(restored.sharePreview,{...s.sharePreview,status:'active'});
 assert.equal(model.reduceWorkflow(s,{type:'share-restore',message:' '}),s);
 const viewer={...s,role:'viewer'};assert.equal(model.reduceWorkflow(viewer,{type:'share-restore',message:'허용'}),viewer);
});

test('layers preserve original lock, persist visibility and prevent editing locked objects',()=>{
 assert.equal(typeof model.getWorkflowLayers,'function');
 let s=model.createWorkflow('civil');
 assert.equal(model.getWorkflowLayers(s).find(l=>l.kind==='source').locked,true);
 s=model.reduceWorkflow(s,{type:'layer-create',name:'현장 확인'});
 assert.ok(model.getWorkflowLayers(s).some(l=>l.name==='현장 확인'));
 assert.equal(model.reduceWorkflow(s,{type:'layer-create',name:'현장 확인'}),s);
 s=model.reduceWorkflow(s,{type:'layer-toggle',name:'물량 근거',property:'visible'});
 assert.equal(model.getWorkflowLayers(s).find(l=>l.name==='물량 근거').visible,false);
 s=model.reduceWorkflow(s,{type:'layer-toggle',name:'물량 근거',property:'locked'});
 assert.equal(model.reduceWorkflow(s,{type:'revise'}),s);
 assert.equal(model.reduceWorkflow(s,{type:'properties',name:'바꾸기',layer:'현장 확인',stroke:'#112233',fill:'#ddeeff',lineWidth:2}),s);
 assert.equal(model.reduceWorkflow(s,{type:'layer-toggle',name:'원본 배경',property:'locked'}),s);
 assert.equal(model.reduceWorkflow({...s,role:'viewer'},{type:'layer-create',name:'추가'}).layers.length,s.layers.length);
});

test('delivery configuration is tied to approved snapshot and rejects empty or unknown formats',()=>{
 const initial=model.createWorkflow('civil');
 const s={...initial,role:'approver',phase:'approved',approved:{revision:1,quantity:60,amount:5100000}};
 const configured=model.reduceWorkflow(s,{type:'deliver',formats:['DWG','CSV'],recipient:'발주처 검토 담당'});
 assert.deepEqual(configured.deliveryPackage.formats,['DWG','CSV']);
 assert.equal(configured.deliveryPackage.revision,1);
 assert.equal(configured.deliveryPackage.recipient,'발주처 검토 담당');
 assert.equal(model.reduceWorkflow(s,{type:'deliver',formats:[],recipient:''}),s);
 assert.equal(model.reduceWorkflow(s,{type:'deliver',formats:['EXE']}),s);
 assert.equal(model.reduceWorkflow({...s,approved:null},{type:'deliver'}).delivery,'unprepared');
});

test('share preview freezes disclosed scope and view-only or expired previews reject feedback',()=>{
 const s=model.createWorkflow('civil');
 const shared=model.reduceWorkflow(s,{type:'share-preview',recipient:'reviewer@example.com',permission:'comment',includeAmount:false});
 assert.equal(shared.sharePreview.sourceId,'CIVIL-01');
 assert.equal(shared.sharePreview.revision,1);
 assert.equal(shared.sharePreview.amount,undefined);
 const changed=model.reduceWorkflow(shared,{type:'revise'});
 assert.equal(changed.sharePreview.quantity,60);
 const feedback=model.reduceWorkflow(changed,{type:'share-feedback',message:'구간 끝점 확인 요청'});
 assert.equal(feedback.sharePreview.feedback,'구간 끝점 확인 요청');
 assert.equal(feedback.phase,'draft');
 assert.equal(feedback.approved,null);
 const expired=model.reduceWorkflow(feedback,{type:'share-expire'});
 assert.equal(model.reduceWorkflow(expired,{type:'share-feedback',message:'추가 의견'}),expired);
 const view=model.reduceWorkflow(s,{type:'share-preview',recipient:'reviewer@example.com',permission:'view',includeAmount:true});
 assert.equal(model.reduceWorkflow(view,{type:'share-feedback',message:'의견'}),view);
 assert.equal(model.reduceWorkflow(s,{type:'share-preview',recipient:'invalid',permission:'comment',includeAmount:false}),s);
});

test('scale setup keeps reference units, invalidates quantities and rejects invalid or approved changes',()=>{
 const s=model.createWorkflow('architecture');
 const calibrated=model.reduceWorkflow(s,{type:'calibrate',length:6,unit:'m'});
 assert.deepEqual(calibrated.scale,{length:6,unit:'m'});
 assert.equal(calibrated.calibrated,true);
 assert.equal(calibrated.quantityStatus,'stale');
 assert.equal(calibrated.object.quantity,24);
 for(const length of [0,-1,NaN,Infinity])assert.equal(model.reduceWorkflow(s,{type:'calibrate',length,unit:'mm'}),s);
 assert.equal(model.reduceWorkflow({...calibrated,phase:'approved'},{type:'calibrate',length:5,unit:'m'}).scale.length,6);
});

test('comparison includes rate-only changes and signed decreases against the initial sample',()=>{
  assert.equal(typeof model.compareWorkflow,'function');
  const initial=model.createWorkflow('civil');
  const rate=model.reduceWorkflow(initial,{type:'rate',rate:90000,unit:'m'});
  const change=model.compareWorkflow(rate);
  assert.equal(change.quantityDelta,0);
  assert.equal(change.amountDelta,300000);
  assert.equal(change.baseline.rate,85000);
  const smaller={...initial,object:{...initial.object,quantity:58}};
  assert.equal(model.compareWorkflow(smaller).quantityDelta,-2);
  assert.equal(model.compareWorkflow(smaller).amountDelta,-170000);
});

test('drawing edits attach their history event to the resulting revision',()=>{
  const initial=model.createWorkflow('civil');
  const revised=model.reduceWorkflow(initial,{type:'revise'});
  assert.equal(revised.revision,2);
  assert.equal(revised.history.at(-1).revision,2);
  const again=model.reduceWorkflow(revised,{type:'revise'});
  assert.equal(again.history.at(-1).revision,3);
  assert.equal(again.history[0].revision,2);
  for(const action of [
    {type:'rate',rate:90000,unit:'m'},
    {type:'properties',name:'변경 객체',layer:'기본',stroke:'#112233',fill:'#ddeeff',lineWidth:2},
  ]) {
    const changed=model.reduceWorkflow(initial,action);
    assert.equal(changed.history.at(-1).revision,2);
  }
  const renewed=model.reduceWorkflow({...initial,phase:'approved'}, {type:'new-revision'});
  assert.equal(renewed.history.at(-1).revision,2);
});

test('field notes preserve location evidence without modifying approved quantities',()=>{
  const s=model.createWorkflow('civil');
  const next=model.reduceWorkflow(s,{type:'field-note',title:'배수관 위치 변경',note:'현장 장애물로 위치 조정 검토',condition:'changed',photoName:'현장사진.jpg'});
  assert.equal(next.fieldNotes[0].objectId,'C-301');
  assert.equal(next.fieldNotes[0].sourceId,'CIVIL-01');
  assert.equal(next.fieldNotes[0].revision,1);
  assert.equal(next.object.quantity,60);
  assert.equal(model.reduceWorkflow(s,{type:'field-note',title:'',note:'내용',condition:'changed'}),s);
  assert.equal(model.reduceWorkflow({...s,role:'viewer'},{type:'field-note',title:'제목',note:'내용',condition:'changed'}).fieldNotes,undefined);
});

test('materials track order receipt and installation separately from the approved design',()=>{
  const s=model.createWorkflow('civil');
  const action={type:'materials',ordered:65,received:60,installed:50,reason:'포장 단위 예시'};
  assert.equal(model.reduceWorkflow(s,action),s);
  const approved={...s,approved:{revision:1,quantity:60,amount:5100000}};
  const next=model.reduceWorkflow(approved,action);
  assert.equal(next.materials.ordered,65);
  assert.equal(next.materials.received,60);
  assert.equal(next.materials.installed,50);
  assert.equal(next.materials.approvedRevision,1);
  assert.equal(next.approved.quantity,60);
  assert.equal(next.object.quantity,60);
  assert.equal(model.reduceWorkflow(approved,{...action,received:70}),approved);
  assert.equal(model.reduceWorkflow(approved,{...action,installed:61}),approved);
  assert.equal(model.reduceWorkflow(approved,{...action,reason:' '}),approved);
});

test("quantity formula separates raw/correction/reason and keeps source plus approved baseline", () => {
  let s = model.createWorkflow("architecture");
  const action = {
    type: "formula",
    raw: 24,
    correction: -2,
    reason: "개구부 면적 공제",
  };
  assert.equal(model.reduceWorkflow(s, action), s);
  s = model.reduceWorkflow(s, { type: "calibrate" });
  const next = model.reduceWorkflow(s, action);
  assert.equal(next.object.quantity, 22);
  assert.equal(next.measurement.raw, 24);
  assert.equal(next.measurement.correction, -2);
  assert.equal(next.measurement.reason, "개구부 면적 공제");
  assert.equal(next.quantityStatus, "current");
  assert.equal(next.revision, 2);
  assert.equal(next.object.sourceId, "PDF-01");
  assert.equal(model.reduceWorkflow(s, { ...action, reason: "" }), s);
  assert.equal(model.reduceWorkflow(s, { ...action, correction: -30 }), s);
  assert.equal(model.reduceWorkflow(s, { ...action, raw: Infinity }), s);
  const approved = {
    ...next,
    phase: "approved",
    approved: { revision: 2, quantity: 22, amount: 924000 },
  };
  assert.equal(model.reduceWorkflow(approved, action), approved);
  const draft = model.reduceWorkflow(approved, { type: "new-revision" });
  assert.equal(
    model.reduceWorkflow(draft, {
      ...action,
      correction: 0,
      reason: "공제 제외",
    }).approved.quantity,
    22,
  );
});

test("object properties revise the same evidence without changing quantity and reject invalid or locked edits", () => {
  const s = model.createWorkflow("architecture");
  const action = {
    type: "properties",
    name: "회의실 타일 마감",
    layer: "물량 근거",
    stroke: "#cc3311",
    fill: "#ffeecc",
    lineWidth: 3,
  };
  const next = model.reduceWorkflow(s, action);
  assert.equal(next.object.name, "회의실 타일 마감");
  assert.equal(next.object.appearance.stroke, "#cc3311");
  assert.equal(next.object.id, "A-101");
  assert.equal(next.object.quantity, 24);
  assert.equal(next.revision, 2);
  assert.equal(model.reduceWorkflow(s, { ...action, name: " " }), s);
  assert.equal(
    model.reduceWorkflow(s, { ...action, stroke: "url(http://example.com)" }),
    s,
  );
  assert.equal(model.reduceWorkflow(s, { ...action, lineWidth: -1 }), s);
  assert.equal(
    model.reduceWorkflow({ ...s, phase: "approved" }, action).object.name,
    s.object.name,
  );
  assert.equal(
    model.reduceWorkflow({ ...s, role: "viewer" }, action).object.name,
    s.object.name,
  );
});

test("AI example decisions require current evidence and reason without changing quantities or approval", () => {
  const state = model.createWorkflow("architecture");
  const action = {
    type: "ai-decision",
    revision: 1,
    decision: "accepted",
    reason: "공제 근거를 검토 의견에 반영",
  };
  const next = model.reduceWorkflow(state, action);
  assert.equal(next.aiDecision.decision, "accepted");
  assert.equal(next.aiDecision.revision, 1);
  assert.equal(next.object, state.object);
  assert.equal(next.approved, null);
  assert.equal(next.phase, "draft");
  assert.equal(model.reduceWorkflow(state, { ...action, reason: " " }), state);
  const revised = model.reduceWorkflow(next, { type: "revise" });
  assert.equal(model.reduceWorkflow(revised, action), revised);
  assert.equal(
    model.reduceWorkflow({ ...state, role: "viewer" }, action).aiDecision,
    undefined,
  );
  const dismissed = model.reduceWorkflow(revised, {
    ...action,
    revision: 2,
    decision: "dismissed",
    reason: "현재 범위와 무관",
  });
  assert.equal(dismissed.aiDecision.decision, "dismissed");
});

test("exception policy blocks unavailable evidence and offline approval without blocking local drafting", () => {
  assert.equal(typeof model.workflowExceptionAllows, "function");
  assert.equal(
    model.workflowExceptionAllows("permission", { type: "revise" }),
    false,
  );
  assert.equal(
    model.workflowExceptionAllows("expired", { type: "role", role: "author" }),
    false,
  );
  assert.equal(
    model.workflowExceptionAllows("missing", { type: "calculate" }),
    false,
  );
  assert.equal(
    model.workflowExceptionAllows("offline", { type: "approve" }),
    false,
  );
  assert.equal(
    model.workflowExceptionAllows("offline", {
      type: "request",
      message: "test",
    }),
    false,
  );
  assert.equal(
    model.workflowExceptionAllows("offline", { type: "revise" }),
    true,
  );
  assert.equal(
    model.workflowExceptionAllows("required", { type: "calibrate" }),
    true,
  );
  assert.equal(
    model.workflowExceptionAllows("ai", { type: "calculate" }),
    true,
  );
  assert.equal(
    model.workflowExceptionAllows("ai", {
      type: "ai-decision",
      revision: 1,
      decision: "accepted",
      reason: "검토",
    }),
    false,
  );
});

test("import setup preserves the selected source and does not calibrate or replace original data", () => {
  const s = model.createWorkflow("architecture");
  const action = { type: "import-setup", format: "DWG", unit: "mm", page: 1 };
  const next = model.reduceWorkflow(s, action);
  assert.deepEqual(next.importSetup, { format: "DWG", unit: "mm", page: 1 });
  assert.equal(next.object.sourceId, "PDF-01");
  assert.equal(next.calibrated, false);
  assert.equal(model.reduceWorkflow(s, { ...action, page: 0 }), s);
  assert.equal(
    model.reduceWorkflow({ ...s, role: "viewer" }, action).importSetup,
    undefined,
  );
});

test("rate selection validates units, creates a revised estimate and preserves approval snapshots", () => {
  let s = model.createWorkflow("architecture");
  const invalid = { type: "rate", rate: -1, unit: "m²" };
  assert.equal(model.reduceWorkflow(s, invalid), s);
  assert.equal(
    model.reduceWorkflow(s, { type: "rate", rate: 47000, unit: "m" }),
    s,
  );
  assert.equal(
    model.reduceWorkflow(s, { type: "rate", rate: Infinity, unit: "m²" }),
    s,
  );
  const next = model.reduceWorkflow(s, {
    type: "rate",
    rate: 47000,
    unit: "m²",
  });
  assert.equal(next.object.rate, 47000);
  assert.equal(next.revision, 2);
  assert.equal(next.object.quantity, 24);
  assert.equal(next.quantityStatus, "stale");
  const approved = {
    ...next,
    phase: "approved",
    approved: { revision: 2, quantity: 24, amount: 1128000 },
  };
  assert.equal(
    model.reduceWorkflow(approved, { type: "rate", rate: 50000, unit: "m²" }),
    approved,
  );
  const draft = model.reduceWorkflow(approved, { type: "new-revision" });
  const updated = model.reduceWorkflow(draft, {
    type: "rate",
    rate: 50000,
    unit: "m²",
  });
  assert.equal(updated.approved.amount, 1128000);
  assert.equal(updated.object.rate, 50000);
  assert.equal(
    model.reduceWorkflow(
      { ...s, role: "viewer" },
      { type: "rate", rate: 47000, unit: "m²" },
    ).object.rate,
    42000,
  );
});

test("architecture, IFC, and civil journeys retain object evidence when quantities change", () => {
  assert.ok(model, "The shared frontend workflow model must exist");
  for (const scenario of ["architecture", "ifc", "civil"]) {
    const initial = model.createWorkflow(scenario);
    const next = model.reduceWorkflow(initial, { type: "revise" });
    assert.equal(next.object.id, initial.object.id);
    assert.equal(next.object.sourceId, initial.object.sourceId);
    assert.equal(next.revision, 2);
    assert.equal(next.quantityStatus, "stale");
    assert.notEqual(next.object.quantity, initial.object.quantity);
    assert.equal(initial.revision, 1);
  }
});

test("review cannot be requested with missing scale or uncalculated revision", () => {
  assert.ok(model);
  let s = model.createWorkflow("architecture");
  assert.equal(
    model.reduceWorkflow(s, { type: "request", message: "면적 변경 검토" })
      .phase,
    "draft",
  );
  s = model.reduceWorkflow(s, { type: "calibrate" });
  s = model.reduceWorkflow(s, { type: "calculate" });
  assert.equal(
    model.reduceWorkflow(s, { type: "request", message: "  " }).phase,
    "draft",
  );
  s = model.reduceWorkflow(s, { type: "request", message: "면적 변경 검토" });
  assert.equal(s.phase, "requested");
  assert.equal(s.request.objectId, "A-101");
  assert.equal(s.request.revision, 1);
});

test("correction and approval freeze the same evidence; new revision preserves approved result", () => {
  assert.ok(model);
  let s = model.createWorkflow("ifc");
  s = model.reduceWorkflow(s, { type: "calculate" });
  s = model.reduceWorkflow(s, { type: "request", message: "벽체 수량 확인" });
  assert.equal(model.reduceWorkflow(s, { type: "approve" }).phase, "requested");
  s = model.reduceWorkflow(s, { type: "role", role: "reviewer" });
  s = model.reduceWorkflow(s, {
    type: "correction",
    message: "보정 근거 확인",
  });
  assert.equal(s.phase, "changes");
  s = model.reduceWorkflow(s, { type: "role", role: "author" });
  s = model.reduceWorkflow(s, { type: "revise" });
  s = model.reduceWorkflow(s, { type: "calculate" });
  s = model.reduceWorkflow(s, { type: "request", message: "보정 근거 반영" });
  s = model.reduceWorkflow(s, { type: "role", role: "reviewer" });
  s = model.reduceWorkflow(s, { type: "review" });
  s = model.reduceWorkflow(s, { type: "role", role: "approver" });
  s = model.reduceWorkflow(s, { type: "approve" });
  assert.equal(s.phase, "approved");
  assert.equal(s.approved.revision, 2);
  const amount = s.approved.amount;
  assert.equal(model.reduceWorkflow(s, { type: "revise" }), s);
  s = model.reduceWorkflow(s, { type: "role", role: "author" });
  s = model.reduceWorkflow(s, { type: "new-revision" });
  assert.equal(s.revision, 3);
  assert.equal(s.approved.amount, amount);
  assert.equal(s.quantityStatus, "stale");
});

test("viewer cannot mutate a demo through workflow commands", () => {
  assert.ok(model);
  const s = model.reduceWorkflow(model.createWorkflow("civil"), {
    type: "role",
    role: "viewer",
  });
  for (const action of [
    { type: "revise" },
    { type: "calculate" },
    { type: "calibrate" },
    { type: "request", message: "요청" },
    { type: "approve" },
    { type: "deliver" },
    { type: "new-revision" },
  ]) {
    assert.equal(model.reduceWorkflow(s, action), s);
  }
});

test("findings link to evidence and resolve after calibration and calculation", () => {
  assert.ok(model);
  let s = model.createWorkflow("architecture");
  assert.ok(
    model
      .workflowFindings(s)
      .some((f) => f.id === "scale" && f.objectId === "A-101"),
  );
  s = model.reduceWorkflow(s, { type: "calibrate" });
  s = model.reduceWorkflow(s, { type: "calculate" });
  assert.equal(
    model
      .workflowFindings(s)
      .some((f) => f.id === "scale" || f.id === "quantity"),
    false,
  );
  s = model.reduceWorkflow(s, { type: "revise" });
  assert.ok(model.workflowFindings(s).some((f) => f.id === "quantity"));
});

test("delivery is unavailable before approval and never represents server publication", () => {
  assert.ok(model);
  const s = model.createWorkflow("civil");
  assert.equal(model.reduceWorkflow(s, { type: "deliver" }), s);
  assert.equal(s.delivery, "unprepared");
  assert.equal(s.persistence, "demo-only");
});
