# 1HK 도면 협업실 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프로젝트 참여자가 IFC 3D 객체와 PDF 2D 영역을 공통 이슈에 연결하고, 댓글·담당자·기한·상태·개정 재검토·알림·감사 이력을 권한에 맞게 끝까지 처리하는 운영형 도면 협업실을 만든다.

**Architecture:** 기존 React Router 7 애플리케이션과 Supabase 프로젝트/RLS/Storage/개정 그래프를 유지한다. IFC는 기존 `web-ifc`/Three.js 뷰어를 확장하고 PDF는 `pdfjs-dist@6.2.108` 클라이언트 렌더러를 추가하되, 두 렌더러는 공통 issue/anchor/comment/event 서버 계약만 공유한다. 저장 성공은 Supabase mutation 응답으로 판단하고 Realtime은 프로젝트별 화면 동기화에만 사용한다.

**Tech Stack:** React 19, React Router 7.18.2, TypeScript 5.9, Supabase Postgres/RLS/Storage/Realtime, `web-ifc@0.0.77`, `three@0.185.1`, `pdfjs-dist@6.2.108`, Zod, Node test runner, Playwright 1.62.1

**Spec:** `docs/superpowers/specs/2026-08-23-drawing-collaboration-room-design.md`

## Global Constraints

- 기존 프로젝트·파일·회원·IFC 뷰어·Supabase RLS를 재사용한다.
- IFC와 PDF는 서로 다른 렌더러를 사용하지만 이슈·앵커·댓글·상태 모델은 공유한다.
- 원본 파일, 앵커, 댓글, 이벤트는 덮어쓰거나 삭제하지 않는다.
- PDF 좌표는 페이지 기준 0~1 정규화 좌표로 저장한다.
- owner/reviewer만 이슈를 최종 종료하거나 재개할 수 있고 프로젝트 비회원은 아무 데이터도 읽을 수 없다.
- Realtime 이벤트는 저장 성공 판정으로 사용하지 않는다.
- Go 마이크로서비스, DWG 렌더링, OCR/AI, 자유곡선 편집, 동시 커서, 음성·영상은 이 계획에 추가하지 않는다.
- 모든 신규 테이블은 RLS를 활성화하고 `anon` 권한을 철회한다.
- 실제 사용자·운영 Supabase·모바일/데스크톱 검증 전에는 완성 또는 출시 완료로 표시하지 않는다.

---

## File Map

- `platform/supabase/migrations/20260823090000_drawing_collaboration_room.sql`: 이슈·앵커·댓글·이벤트·알림 계약, 상태 전이 함수, 인덱스, RLS, Realtime publication.
- `platform/app/lukas/lib/drawing-collaboration.types.ts`: 서버와 UI가 공유하는 좁은 타입·Zod schema.
- `platform/app/lukas/lib/drawing-collaboration.server.ts`: 프로젝트 컨텍스트, 조회, mutation, 낙관적 잠금, signed URL 생성.
- `platform/app/lukas/screens/project-drawings.tsx`: 도면 파일함 route.
- `platform/app/lukas/screens/drawing-room.tsx`: 협업실 loader/action과 shell.
- `platform/app/lukas/components/drawing-room.client.tsx`: 뷰어/이슈 패널 조합과 모바일 탭.
- `platform/app/lukas/components/pdf-drawing-viewer.client.tsx`: PDF 렌더·확대·페이지·정규화 영역 선택.
- `platform/app/lukas/components/drawing-issue-panel.tsx`: 공통 이슈 목록·상세·댓글·상태 form.
- `platform/app/lukas/components/drawing-realtime.client.tsx`: 프로젝트 필터 Realtime 구독과 연결 상태.
- `platform/app/lukas/components/ifc-property-browser.client.tsx`: 선택 객체와 카메라를 공통 앵커 callback으로 노출.
- `platform/app/lukas/components/ifc-model-viewer.client.ts`: 카메라 snapshot/restore public API 추가.
- `platform/app/lukas/components/workspace-dashboard.tsx`: 카드 지표와 기본 협업실 진입.
- `platform/app/lukas/screens/project.tsx`: 프로젝트 홈에 도면/이슈 요약 연결.
- `platform/app/routes.ts`: 도면 파일함·협업실 route 등록.
- `platform/tests/drawing-collaboration.test.mjs`: migration/route/권한/상태/앵커 정적·계약 테스트.
- `platform/e2e/drawing-collaboration.spec.ts`: 두 사용자 운영 흐름과 모바일 흐름.
- `platform/DEPLOYMENT.md`: migration, Realtime, PDF worker, 운영 검증 절차.

---

### Task 1: Database contract, state machine, and RLS

**Files:**
- Create: `platform/supabase/migrations/20260823090000_drawing_collaboration_room.sql`
- Create: `platform/tests/drawing-collaboration.test.mjs`

**Interfaces:**
- Consumes: `private.lukas_qto_project_role(uuid)`, `public.lukas_qto_files`, `public.lukas_qto_file_revisions`.
- Produces: `lukas_drawing_issues`, `lukas_drawing_issue_anchors`, `lukas_drawing_issue_comments`, `lukas_drawing_issue_events`, `lukas_drawing_notifications`, `private.lukas_drawing_transition_allowed(text,text,text)`.

- [ ] **Step 1: Write failing migration contract tests**

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sql = await readFile(
  new URL("../supabase/migrations/20260823090000_drawing_collaboration_room.sql", import.meta.url),
  "utf8",
).catch(() => "");

test("drawing collaboration tables are RLS protected", () => {
  for (const table of ["issues", "issue_anchors", "issue_comments", "issue_events", "notifications"]) {
    assert.match(sql, new RegExp(`alter table public\\.lukas_drawing_${table} enable row level security`, "i"));
  }
  assert.match(sql, /revoke all on[\s\S]+from anon/i);
});

test("only owner or reviewer can close and reopen", () => {
  assert.match(sql, /lukas_drawing_transition_allowed/i);
  assert.match(sql, /in\('owner','reviewer'\)/i);
  assert.match(sql, /resolution_requested[\s\S]+closed/i);
});
```

- [ ] **Step 2: Run the test and confirm it fails because the migration does not exist**

Run: `cd platform && node --test tests/drawing-collaboration.test.mjs`

Expected: FAIL on missing RLS/table/status patterns.

- [ ] **Step 3: Add the additive migration**

Create UUID tables with explicit enums enforced by check constraints, `version bigint not null default 1`, `created_at/updated_at timestamptz`, project/file foreign keys, normalized PDF coordinate checks `0 <= value <= 1`, positive page numbers, IFC/PDF mutually exclusive anchor checks, and append-only comment/event policies. Add `before update` trigger that increments issue version and rejects forbidden status transitions based on the caller's project role. Add project/status, assignee/status, issue/created_at and unread-notification indexes. Add the four collaborative tables to `supabase_realtime` only if they are not already members.

The transition function must implement this exact matrix:

```sql
case
  when old_status = new_status then true
  when role in ('owner','reviewer') then
    (old_status,new_status) in (
      ('open','in_progress'),('in_progress','resolution_requested'),
      ('resolution_requested','in_progress'),('resolution_requested','closed'),
      ('closed','open')
    )
  when role in ('estimator','site','procurement') then
    (old_status,new_status) in (
      ('open','in_progress'),('in_progress','resolution_requested')
    )
  else false
end
```

- [ ] **Step 4: Add adversarial RLS assertions**

Extend the test to require same-project checks for every anchor, `created_by = auth.uid()` for create/comment, no UPDATE/DELETE policy on comments/events, and read-only access for `viewer`.

- [ ] **Step 5: Run tests and commit**

Run: `cd platform && node --test tests/drawing-collaboration.test.mjs`

Expected: PASS.

```bash
git add platform/supabase/migrations/20260823090000_drawing_collaboration_room.sql platform/tests/drawing-collaboration.test.mjs
git commit -m "feat: add drawing collaboration data contract"
```

### Task 2: Shared types and server operations

**Files:**
- Create: `platform/app/lukas/lib/drawing-collaboration.types.ts`
- Create: `platform/app/lukas/lib/drawing-collaboration.server.ts`
- Modify: `platform/tests/drawing-collaboration.test.mjs`

**Interfaces:**
- Consumes: Task 1 tables and `makeServerClient(request)`.
- Produces: `drawingContext(request, projectId)`, `listDrawingFiles(client, projectId)`, `loadDrawingRoom(client, projectId, fileId)`, `mutateDrawingIssue(client, actor, input)`; Zod schemas `IssueMutationSchema`, `IfcAnchorSchema`, `PdfAnchorSchema`.

- [ ] **Step 1: Add failing source-contract tests**

```js
test("server mutations require expected version and never trust form role", async () => {
  const source = await readFile(new URL("../app/lukas/lib/drawing-collaboration.server.ts", import.meta.url), "utf8");
  assert.match(source, /expectedVersion/);
  assert.match(source, /\.eq\("version", input\.expectedVersion\)/);
  assert.doesNotMatch(source, /formData.*role|input\.role/);
});
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `cd platform && node --test tests/drawing-collaboration.test.mjs`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Define strict shared schemas**

Define discriminated anchor schemas:

```ts
export const IfcAnchorSchema = z.object({
  kind: z.literal("ifc_element"), fileId: z.string().uuid(),
  elementId: z.string().trim().min(1).max(128),
  ifcGlobalId: z.string().regex(/^[0-9A-Za-z_$]{22}$/).nullable(),
  camera: z.object({ position: z.tuple([z.number(), z.number(), z.number()]), target: z.tuple([z.number(), z.number(), z.number()]) }),
});
export const PdfAnchorSchema = z.object({
  kind: z.literal("pdf_region"), fileId: z.string().uuid(),
  pageNumber: z.number().int().positive(),
  x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().positive().max(1), height: z.number().positive().max(1),
}).refine((v) => v.x + v.width <= 1 && v.y + v.height <= 1);
```

- [ ] **Step 4: Implement server-only project context and mutations**

Load user via `client.auth.getUser()`, project through RLS, and membership role from project owner/member rows. Parse every action with Zod. For update, apply `.eq("id", issueId).eq("version", expectedVersion).select().single()` and return HTTP 409 when no row changed. Insert event only after the primary mutation succeeds; rely on one SQL RPC for state mutation+event when atomicity is required.

- [ ] **Step 5: Run typecheck/tests and commit**

Run: `cd platform && npm run typecheck && node --test tests/drawing-collaboration.test.mjs`

Expected: PASS.

```bash
git add platform/app/lukas/lib/drawing-collaboration.types.ts platform/app/lukas/lib/drawing-collaboration.server.ts platform/tests/drawing-collaboration.test.mjs
git commit -m "feat: add drawing collaboration server contract"
```

### Task 3: Drawing library and routes

**Files:**
- Create: `platform/app/lukas/screens/project-drawings.tsx`
- Create: `platform/app/lukas/screens/drawing-room.tsx`
- Modify: `platform/app/routes.ts`
- Modify: `platform/app/lukas/components/project-workspace-nav.tsx`
- Modify: `platform/tests/drawing-collaboration.test.mjs`

**Interfaces:**
- Consumes: `listDrawingFiles`, `loadDrawingRoom`, shared issue schemas.
- Produces: routes `/projects/:projectId/drawings` and `/projects/:projectId/drawings/:fileId`; loader data `{project,file,files,issues,role,signedUrl}`.

- [ ] **Step 1: Add failing route and visible-copy tests**

```js
test("drawing library and room routes are registered", async () => {
  const routes = await readFile(new URL("../app/routes.ts", import.meta.url), "utf8");
  assert.match(routes, /projects\/:projectId\/drawings/);
  assert.match(routes, /projects\/:projectId\/drawings\/:fileId/);
});
```

- [ ] **Step 2: Run test and confirm route failure**

Run: `cd platform && node --test tests/drawing-collaboration.test.mjs`

- [ ] **Step 3: Implement the drawing library loader and UI**

Query only `ifc` and `pdf`, join revision predecessor metadata and aggregate open issue counts server-side. Render file name, kind, revision state, author, timestamp, unresolved count, and one `협업실 열기` link. Keep file upload on the existing Files screen and link there with `?kind=ifc` or `?kind=pdf`.

- [ ] **Step 4: Implement collaboration room loader/action shell**

Reject non-IFC/PDF files with 404, generate a 5-minute private signed URL, and dispatch intents `create_issue`, `comment`, `assign`, `set_due`, `set_priority`, `set_status`, `add_anchor`, `deactivate_anchor` through `mutateDrawingIssue`. Return field errors with status 400, concurrent version errors with 409, and permission errors with 403.

- [ ] **Step 5: Run checks and commit**

Run: `cd platform && npm run typecheck && node --test tests/drawing-collaboration.test.mjs`

```bash
git add platform/app/routes.ts platform/app/lukas/screens/project-drawings.tsx platform/app/lukas/screens/drawing-room.tsx platform/app/lukas/components/project-workspace-nav.tsx platform/tests/drawing-collaboration.test.mjs
git commit -m "feat: add drawing library and room routes"
```

### Task 4: PDF renderer and normalized region anchors

**Files:**
- Modify: `platform/package.json`
- Modify: `platform/package-lock.json`
- Create: `platform/app/lukas/components/pdf-drawing-viewer.client.tsx`
- Create: `platform/app/lukas/lib/pdf-anchor.ts`
- Create: `platform/tests/pdf-anchor.test.mjs`

**Interfaces:**
- Consumes: private `signedUrl`, optional `PdfAnchor`, `onRegionSelected(anchor)`.
- Produces: `PdfDrawingViewer` and pure functions `normalizeRegion(rect, viewport)` / `denormalizeRegion(anchor, viewport)`.

- [ ] **Step 1: Write failing pure-coordinate tests**

```js
test("PDF region survives viewport resize", () => {
  const normalized = normalizeRegion({ x: 100, y: 200, width: 300, height: 100 }, { width: 1000, height: 2000 });
  assert.deepEqual(normalized, { x: .1, y: .1, width: .3, height: .05 });
  assert.deepEqual(denormalizeRegion(normalized, { width: 500, height: 1000 }), { x: 50, y: 100, width: 150, height: 50 });
});
```

- [ ] **Step 2: Run and confirm missing module failure**

Run: `cd platform && node --test tests/pdf-anchor.test.mjs`

- [ ] **Step 3: Install exact PDF.js and implement pure math**

Run: `cd platform && npm install --save-exact pdfjs-dist@6.2.108`

Clamp drag endpoints to the viewport, reject regions below 4 CSS pixels in either dimension before normalization, and never store zoom/rotation pixels.

- [ ] **Step 4: Implement client-only PDF viewer**

Lazy import `pdfjs-dist`, configure the bundled worker URL through Vite, fetch only the selected page render task, cancel the previous render on page/zoom changes, and clean up `PDFDocumentProxy`, `PDFPageProxy`, canvas, and ResizeObserver on unmount. Provide page navigation, zoom, fit-width, drag-region mode, selected-region overlay, loading/error/empty states, keyboard labels, and `aria-live` status.

- [ ] **Step 5: Run tests, build, and commit**

Run: `cd platform && node --test tests/pdf-anchor.test.mjs && npm run typecheck && npm run build`

Expected: all PASS; PDF.js is emitted as a client chunk and never imported by SSR execution.

```bash
git add platform/package.json platform/package-lock.json platform/app/lukas/components/pdf-drawing-viewer.client.tsx platform/app/lukas/lib/pdf-anchor.ts platform/tests/pdf-anchor.test.mjs
git commit -m "feat: add PDF drawing viewer"
```

### Task 5: IFC anchor capture and restore

**Files:**
- Modify: `platform/app/lukas/components/ifc-model-viewer.client.ts`
- Modify: `platform/app/lukas/components/ifc-property-browser.client.tsx`
- Create: `platform/app/lukas/lib/ifc-anchor.ts`
- Modify: `platform/tests/drawing-collaboration.test.mjs`

**Interfaces:**
- Consumes: selected express ID/global ID and Three camera/controller state.
- Produces: `IfcModelViewer.getViewState(): IfcCameraState`, `restoreViewState(state)`, and property-browser props `onAnchorSelected`, `activeAnchor`.

- [ ] **Step 1: Add failing API contract test**

```js
test("IFC viewer exposes deterministic camera capture and restore", async () => {
  const source = await readFile(new URL("../app/lukas/components/ifc-model-viewer.client.ts", import.meta.url), "utf8");
  assert.match(source, /getViewState/);
  assert.match(source, /restoreViewState/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `cd platform && node --test tests/drawing-collaboration.test.mjs`

- [ ] **Step 3: Implement canonical serialization**

Round each camera/target component to 6 decimal places, reject non-finite values, and expose immutable tuples. `restoreViewState` must set position and controls target, call controls update, select/focus the element, and request one render.

- [ ] **Step 4: Connect property selection without race regressions**

Use the existing selection request token and selected ID ref. Only emit an IFC anchor after both the selected element identity and current camera state exist. Restoring an absent element shows `근거 열기 실패` while leaving the issue selected.

- [ ] **Step 5: Run IFC smoke/typecheck and commit**

Run: `cd platform && npm run test:ifc && npm run typecheck && node --test tests/drawing-collaboration.test.mjs`

```bash
git add platform/app/lukas/components/ifc-model-viewer.client.ts platform/app/lukas/components/ifc-property-browser.client.tsx platform/app/lukas/lib/ifc-anchor.ts platform/tests/drawing-collaboration.test.mjs
git commit -m "feat: capture IFC issue anchors"
```

### Task 6: Shared issue panel and collaboration room layout

**Files:**
- Create: `platform/app/lukas/components/drawing-issue-panel.tsx`
- Create: `platform/app/lukas/components/drawing-room.client.tsx`
- Modify: `platform/app/lukas/screens/drawing-room.tsx`
- Modify: `platform/tests/drawing-collaboration.test.mjs`

**Interfaces:**
- Consumes: room loader data, fetcher action intents, `PdfDrawingViewer`, enhanced `IfcPropertyBrowser`.
- Produces: desktop three-pane room and mobile `도면 | 이슈` tabs; issue create/detail/comment/status UI.

- [ ] **Step 1: Write failing accessible UI contract tests**

Require visible labels `이슈 제목`, `담당자`, `기한`, `상태`, `댓글`, buttons with explicit names, and status/error live regions.

- [ ] **Step 2: Run and confirm failure**

Run: `cd platform && node --test tests/drawing-collaboration.test.mjs`

- [ ] **Step 3: Build the shared issue panel**

Filter by open/closed, assignee, priority. Show anchor chips with file/page/object labels. Do not show forbidden actions: viewer has no forms; non-reviewers have no close/reopen; staff roles can request resolution. Every form includes `issue_id`, `expected_version`, CSRF-safe React Router submission, and disabled pending state.

- [ ] **Step 4: Compose IFC/PDF renderers with one selection model**

Desktop grid is `280px minmax(0,1fr) 360px`; mobile uses two 44px tab buttons and a fixed 52px `이슈 만들기` action. Selecting an anchor switches the active file when needed, restores the viewer position, and scrolls the issue into view without changing the stored anchor.

- [ ] **Step 5: Run typecheck/build/tests and commit**

Run: `cd platform && npm run typecheck && npm run build && node --test tests/drawing-collaboration.test.mjs`

```bash
git add platform/app/lukas/components/drawing-issue-panel.tsx platform/app/lukas/components/drawing-room.client.tsx platform/app/lukas/screens/drawing-room.tsx platform/tests/drawing-collaboration.test.mjs
git commit -m "feat: add shared drawing issue workspace"
```

### Task 7: Project home integration and truthful next action

**Files:**
- Modify: `platform/app/lukas/components/workspace-dashboard.tsx`
- Modify: `platform/app/lukas/screens/workspace.tsx`
- Modify: `platform/app/lukas/screens/project.tsx`
- Modify: `platform/tests/public-site-contract.test.mjs`

**Interfaces:**
- Consumes: open issue counts, assigned-to-me counts, latest drawing file.
- Produces: project card metrics and deterministic `계속하기` destination.

- [ ] **Step 1: Add failing copy/navigation tests**

Require `도면 협업실`, `내 담당`, `미해결`, and a drawings route link in workspace/project source.

- [ ] **Step 2: Run and confirm failure**

Run: `cd platform && node --test tests/public-site-contract.test.mjs`

- [ ] **Step 3: Extend workspace loader with aggregate queries**

Return per-project latest IFC/PDF file, unresolved count, and current user's assigned unresolved count. Do not fetch issue bodies or signed URLs on the workspace route.

- [ ] **Step 4: Update project cards and project home**

If a drawing exists, `계속하기` opens its collaboration room. If no drawing exists, it opens Files with `kind=ifc`. Show zero values honestly; never create demo counts.

- [ ] **Step 5: Run tests/build and commit**

Run: `cd platform && node --test tests/public-site-contract.test.mjs && npm run typecheck && npm run build`

```bash
git add platform/app/lukas/components/workspace-dashboard.tsx platform/app/lukas/screens/workspace.tsx platform/app/lukas/screens/project.tsx platform/tests/public-site-contract.test.mjs
git commit -m "feat: connect projects to drawing collaboration"
```

### Task 8: Revision re-review without silent anchor migration

**Files:**
- Create: `platform/app/lukas/lib/drawing-revision.server.ts`
- Modify: `platform/app/lukas/screens/drawing-room.tsx`
- Modify: `platform/app/lukas/components/drawing-issue-panel.tsx`
- Modify: `platform/tests/drawing-collaboration.test.mjs`

**Interfaces:**
- Consumes: `lukas_qto_file_revisions`, issue anchors, parsed IFC identity index.
- Produces: `loadRevisionReview(projectId,fileId)` returning `{previousIssues,rebindCandidates}`; `confirm_rebind` action creates a new anchor and event.

- [ ] **Step 1: Add failing revision safety tests**

```js
test("PDF anchors are never copied and IFC candidates require one exact identity", async () => {
  const source = await readFile(new URL("../app/lukas/lib/drawing-revision.server.ts", import.meta.url), "utf8");
  assert.match(source, /matches\.length === 1/);
  assert.doesNotMatch(source, /pdf_region[\s\S]+insert/);
});
```

- [ ] **Step 2: Run and confirm missing module failure**

Run: `cd platform && node --test tests/drawing-collaboration.test.mjs`

- [ ] **Step 3: Implement re-review query and candidate generation**

Show unresolved prior-revision issues. For IFC, suggest only a stable element/global ID occurring exactly once in the current model identity index. For PDF, return `manual_reanchor_required` without coordinates. Never update an old anchor.

- [ ] **Step 4: Implement explicit confirmation**

`confirm_rebind` inserts a new current-file anchor and append-only event with old/new anchor IDs. Require owner/reviewer or the assigned issue worker; retain the old anchor active as historical evidence.

- [ ] **Step 5: Run tests and commit**

Run: `cd platform && npm run typecheck && node --test tests/drawing-collaboration.test.mjs`

```bash
git add platform/app/lukas/lib/drawing-revision.server.ts platform/app/lukas/screens/drawing-room.tsx platform/app/lukas/components/drawing-issue-panel.tsx platform/tests/drawing-collaboration.test.mjs
git commit -m "feat: add drawing revision re-review"
```

### Task 9: Realtime synchronization and in-app notifications

**Files:**
- Create: `platform/app/lukas/components/drawing-realtime.client.tsx`
- Create: `platform/app/lukas/screens/notifications.tsx`
- Modify: `platform/app/lukas/components/drawing-room.client.tsx`
- Modify: `platform/app/routes.ts`
- Modify: `platform/tests/drawing-collaboration.test.mjs`

**Interfaces:**
- Consumes: browser Supabase client and authenticated project ID.
- Produces: `useDrawingRealtime({projectId,onInvalidate})`, `/notifications`, `mark_read` action.

- [ ] **Step 1: Add failing Realtime contract tests**

Require `.eq('project_id', projectId)`-equivalent channel filters, subscribed/closed/error states, and no mutation success derived from channel payloads.

- [ ] **Step 2: Run and confirm failure**

Run: `cd platform && node --test tests/drawing-collaboration.test.mjs`

- [ ] **Step 3: Implement project-filtered subscriptions**

Subscribe only while the room is mounted. Batch invalidations within 100ms, call React Router revalidation, unsubscribe on project/unmount, and show `실시간 연결 끊김 · 새로고침으로 계속할 수 있습니다` outside the canvas.

- [ ] **Step 4: Implement notification inbox**

Create notifications on assignment, comment on my issue, resolution request, and reopen via database trigger. List current user's rows only; mark read by `user_id = auth.uid()` and preserve notification records.

- [ ] **Step 5: Run tests/build and commit**

Run: `cd platform && npm run typecheck && npm run build && node --test tests/drawing-collaboration.test.mjs`

```bash
git add platform/app/lukas/components/drawing-realtime.client.tsx platform/app/lukas/components/drawing-room.client.tsx platform/app/lukas/screens/notifications.tsx platform/app/routes.ts platform/tests/drawing-collaboration.test.mjs
git commit -m "feat: add drawing realtime and notifications"
```

### Task 10: Automated browser workflow and performance guards

**Files:**
- Create: `platform/e2e/drawing-collaboration.spec.ts`
- Create: `platform/tests/fixtures/tiny-drawing.pdf`
- Modify: `platform/playwright.config.ts`
- Modify: `platform/app/lukas/components/pdf-drawing-viewer.client.tsx`
- Modify: `platform/app/lukas/components/drawing-room.client.tsx`

**Interfaces:**
- Consumes: seeded owner/reviewer accounts, small IFC fixture, two-page PDF fixture.
- Produces: repeatable desktop/mobile maker-reviewer tests and first-usable-view timing marks.

- [ ] **Step 1: Write the failing end-to-end scenario**

```ts
test("maker creates a PDF issue and reviewer closes it", async ({ browser }) => {
  const maker = await browser.newContext({ storageState: ".auth/maker.json" });
  const reviewer = await browser.newContext({ storageState: ".auth/reviewer.json" });
  const makerPage = await maker.newPage();
  await makerPage.goto(`/projects/${projectId}/drawings/${pdfFileId}`);
  await makerPage.getByRole("button", { name: "영역 지정" }).click();
  await makerPage.getByTestId("pdf-canvas").dragTo(makerPage.getByTestId("pdf-region-end"));
  await makerPage.getByLabel("이슈 제목").fill("창호 치수 확인");
  await makerPage.getByRole("button", { name: "이슈 등록" }).click();
  const reviewPage = await reviewer.newPage();
  await reviewPage.goto(`/projects/${projectId}/drawings/${pdfFileId}`);
  await expect(reviewPage.getByText("창호 치수 확인")).toBeVisible();
  await reviewPage.getByLabel("상태").selectOption("closed");
  await reviewPage.getByRole("button", { name: "상태 저장" }).click();
  await expect(makerPage.getByText("종료")).toBeVisible();
});
```

- [ ] **Step 2: Run and confirm failure before fixture/setup exists**

Run: `cd platform && npm run test:e2e -- drawing-collaboration.spec.ts`

- [ ] **Step 3: Add deterministic fixtures and auth setup**

Use a generated two-page PDF containing only “1HK TEST PAGE 1/2” and rectangles; do not commit customer documents. Reuse the repository's permitted synthetic IFC fixture or generate one through the existing IFC smoke helper. Seed owner, reviewer, viewer, non-member and one project through service-role test setup.

- [ ] **Step 4: Add permission, revision, mobile and failure cases**

Test viewer create refusal, non-member 404/403, concurrent version conflict, PDF manual re-anchor, IFC exact-ID candidate, signed URL expiry recovery, Realtime disconnected banner, 390px mobile tab flow, and renderer failure with accessible issue list retained.

- [ ] **Step 5: Add performance guards**

Record `performance.mark("drawing-first-page")` after first PDF page or IFC frame. Assert the route shell renders before the whole 100-page synthetic PDF is loaded; confirm only the visible PDF page has a live render task and the Three renderer pauses while hidden.

- [ ] **Step 6: Run and commit**

Run: `cd platform && npm run test:e2e -- drawing-collaboration.spec.ts && npm run typecheck && npm run build`

```bash
git add platform/e2e/drawing-collaboration.spec.ts platform/tests/fixtures/tiny-drawing.pdf platform/playwright.config.ts platform/app/lukas/components/pdf-drawing-viewer.client.tsx platform/app/lukas/components/drawing-room.client.tsx
git commit -m "test: verify drawing collaboration workflow"
```

### Task 11: Production migration, documentation, and release evidence

**Files:**
- Modify: `platform/DEPLOYMENT.md`
- Create: `docs/DRAWING_COLLABORATION_FIELD_CHECK.md`
- Modify: `docs/PROJECT_STATE.md`

**Interfaces:**
- Consumes: Tasks 1-10 completed commit set.
- Produces: reproducible production deployment and signed field evidence; no new product API.

- [ ] **Step 1: Document exact deployment order**

Record: backup/schema snapshot → migration dry run → migration apply → generated DB types → test suite → Vercel preview → two-user production smoke → production promotion → rollback procedure. Include the exact table and publication queries used to verify RLS and Realtime membership.

- [ ] **Step 2: Run the complete local gate**

Run:

```bash
cd platform
node --test tests/*.test.mjs
npm run typecheck
npm run build
npm run test:ifc
npm run test:e2e -- drawing-collaboration.spec.ts
```

Expected: every command exits 0.

- [ ] **Step 3: Apply and verify the additive migration**

Run: `cd platform && npx --yes supabase@latest db push --linked`

Then regenerate: `npm run db:typegen`.

Verify with authenticated owner/reviewer/viewer/non-member requests that database RLS, not only the UI, enforces the permission matrix.

- [ ] **Step 4: Deploy preview and run the field checklist**

Use one authorized real IFC and one authorized multi-page PDF. Two different users must complete upload → IFC/PDF anchor → comment → assignment → resolution request → reviewer close → new revision → re-review on desktop and mobile. Record file IDs, issue IDs, event IDs, browser versions, timestamps, and observed result; do not copy source documents into git.

- [ ] **Step 5: Update project state honestly**

Mark D0-D5 complete only if the operational checklist passes. If any external gate is pending, record `코드 구현 완료 / 운영 검증 대기` and keep the goal active.

- [ ] **Step 6: Commit and push the completed release branch**

```bash
git add platform/DEPLOYMENT.md platform/database.types.ts docs/DRAWING_COLLABORATION_FIELD_CHECK.md docs/PROJECT_STATE.md
git commit -m "docs: record drawing collaboration release evidence"
git push origin codex/figma-project-workspace
```

---

## Final Release Gate

The feature is complete only when all of the following are true:

- Tasks 1-11 are committed and the worktree is clean.
- Node contracts, TypeScript, production build, IFC smoke and Playwright E2E all pass.
- Production RLS rejects viewer writes and all non-member reads.
- IFC and PDF anchors reopen at their recorded locations.
- Comments and changes are present in append-only audit events.
- A new revision preserves old anchors and requires explicit re-review.
- Two real users complete maker/reviewer flow on desktop and mobile.
- Monitoring shows no unhandled renderer error, signed URL loop or Realtime reconnect loop during the field run.

Only after this gate may `docs/PROJECT_STATE.md` and release UI say `도면 협업실 완성`.
