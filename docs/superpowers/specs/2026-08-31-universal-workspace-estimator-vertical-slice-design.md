# 1HK Universal Workspace — 적산 수직 기능 재기획

기준일: 2026-08-31
상태: 대화에서 섹션별 승인된 설계를 현재 구현에 맞춰 통합한 검토본

## 1. 문서의 역할

이 문서는 1HK Drawing Workspace를 파일 중심 도면 편집기에서 **원본 선택형 적산 작업실**로 재구성한다. 기존 P0–P7 구현을 폐기하거나 다시 만들지 않는다. 다음 문서의 불변 계약과 구현 자산을 유지하면서 제품 진입점과 출시 순서를 바꾼다.

- `2026-08-24-drawing-workspace-design.md`: 좌표, 객체, 저장, 개정, 승인, 협업 계약
- `2026-08-27-drawing-workspace-p6-design.md`: 객체 → 수량 → BOQ → 금액 → 자재 계보
- `2026-08-28-drawing-workspace-p7-design.md`: 조직, 성능, 보존, 제품화 계약

기존 P0–P7은 기술 능력의 이력이다. 이 문서의 M1–M5는 고객이 완성된 결과를 얻는 **제품 수직 기능 순서**다. 기존 코드를 단계 이름 때문에 복제하지 않는다.

## 2. 제품 결정

### 2.1 제품 정의

1HK는 도면을 먼저 올려야 하는 프로그램이 아니다. 사용자는 프로젝트 안에서 작업실을 만들고, 필요할 때 PDF·이미지·IFC·CAD·Excel·현장 근거를 연결한다.

한 문장 제품 약속은 다음과 같다.

> 빈 화면, 템플릿 또는 원본 자료에서 시작해 10분 안에 근거가 연결된 수량·금액 초안을 만든다.

첫 핵심 사용자는 **적산·견적 담당자**다. 첫 결과는 개략 도면이나 검토 보고서가 아니라 **근거가 연결된 수량·금액 초안**이다.

### 2.2 첫 템플릿과 단가

첫 업무 팩은 **실내건축·리모델링 적산**이다.

- 실내건축 기본 적산
- 공동주택 리모델링
- 상업공간 인테리어
- 철거·원상복구

템플릿은 샘플 화면이 아니라 레이어, 객체 분류, 사용자 속성, 측정 종류, BOQ 열, 검토 규칙을 포함하는 불변 버전이다.

단가는 플랫폼이 임의의 시장 가격을 제공하지 않는다. 회사가 보유한 CSV/XLSX를 프로젝트의 불변 price-book 버전으로 가져온다. 각 버전은 원본 파일 ID, SHA-256, 기준일, 권리 근거를 보존한다.

### 2.3 기본 화면

승인된 화면 방향은 **A안: 캔버스 + 결과 레일**이다.

- 상단: 프로젝트, 작업실, 저장, 참여자, 검토·승인
- 왼쪽: 소스, 페이지, 레이어, 템플릿, 내역, 이력
- 중앙: 2D/PDF/IFC/분할 캔버스
- 오른쪽: 객체와 `근거 → 수량 → 단가 → 금액 → 검토 상태`
- 하단: 작성, 측정, 댓글 도구

상세 BOQ는 별도 화면을 유지한다. 오른쪽 결과 레일은 빠른 초안과 누락 확인, BOQ 상세 진입을 담당한다.

## 3. 현재 구현에서 확인된 사실

### 3.1 이미 존재하므로 재사용하는 것

- `lukas_drawing_documents.source_file_id`는 nullable이고 빈 문서 생성 RPC가 존재한다.
- 페이지, 캔버스, 레이어, 스타일, 블록, 속성, 표, 객체, operation, snapshot, approval이 구현돼 있다.
- line/polyline/rectangle/circle/text/dimension과 wall/opening/space/area/grid/arc 객체가 존재한다.
- Konva 편집기, PDF.js, Three.js/web-ifc, IndexedDB outbox가 존재한다.
- Yjs, y-indexeddb, Hocuspocus 서버와 Awareness 흐름이 이미 존재한다.
- 조직 drawing library와 immutable `workspace_template` 버전이 존재한다.
- CSV/XLSX 단가 파서, price book, BOQ, exact-decimal 계산, 승인 CSV/XLSX/manifest export가 존재한다.
- 승인 drawing object → quantity link → BOQ link → material link 계보가 존재한다.

### 3.2 실제 제품 공백

- production route가 `/projects/:projectId/drawings/:fileId/workspace`라 file ID 없이는 진입할 수 없다.
- 프로젝트에 drawing file이 없으면 대시보드가 업로드 화면으로 이동한다.
- 빈 문서와 조직 템플릿 생성은 DB에서 가능하지만 canonical document route가 없어 기본 진입점으로 사용할 수 없다.
- 템플릿 선택 UI는 승인된 후보가 없으면 사라지고 플랫폼 starter catalog가 없다.
- 편집기와 BOQ가 각각 구현돼 있지만 적산 담당자가 보는 한 화면의 결과 레일로 통합되지 않았다.
- 일반 line/polyline/closed shape 측정과 적산 분류 UX가 건축 의미 객체 측정만큼 정리돼 있지 않다.
- 예상 가능한 빈 상태·원본 오류·import 오류가 전체 route error boundary의 `Unexpected error`로 올라갈 수 있다.

따라서 M1은 새 편집기나 새 계산 엔진을 만드는 작업이 아니다. **진입 경로, source optional loader, starter template, 분류·측정 연결, 결과 레일을 기존 권위에 연결하는 통합 작업**이다.

## 4. 채택한 구조

### 4.1 작업실 identity

M1에서 새 `workspaces` 테이블을 만들지 않는다.

- 공개 개념의 `workspaceId`는 기존 `lukas_drawing_documents.id`다.
- canonical route는 `/projects/:projectId/workspaces/:workspaceId`다.
- 하위 mutation/export route도 workspace ID를 사용한다.
- 기존 file route는 호환 진입점으로 유지하고, 권한 검증 뒤 canonical route로 redirect한다.

`lukas_drawing_documents`가 이미 프로젝트, source optional identity, pages/canvases, revisions를 소유하므로 별도 wrapper table은 중복이다. 하나의 작업실이 여러 독립 drawing document를 묶어야 한다는 실제 요구가 생길 때만 상위 table을 검토한다.

### 4.2 document-first loader

새 loader 순서는 다음과 같다.

1. 로그인, project membership, entitlement 확인
2. `projectId + workspaceId(documentId)`의 exact document 확인
3. 요청한 또는 최신 접근 가능 revision 확인
4. optional primary source 확인
5. project source catalog와 signed URL 확인
6. drawing, template provenance, estimate binding, BOQ summary 로드
7. capability와 오류 상태 반환

기존 `workspace.file` 필수 계약은 `primarySource: SourceFile | null`로 바꾼다. 원본이 없을 때 캔버스, 객체, 댓글, revision, estimate 기능은 정상 동작한다.

### 4.3 시작 흐름

`/projects/:projectId/workspaces/new`에서 다음 세 가지를 같은 우선순위로 보여준다.

1. 빈 작업실
2. 실내건축·리모델링 템플릿
3. PDF 가져오기

IFC, 이미지, DXF, 기존 프로젝트 복제는 같은 source adapter 계약으로 후속 노출한다. 업로드 실패가 작업실 생성 실패가 되지 않는다. 사용자는 빈 작업실을 먼저 만든 뒤 source를 다시 연결할 수 있다.

빈 작업실 생성은 기존 `lukas_drawing_create_document(..., null, ..., true)`를 사용한다. `lukas_drawing_documents`에는 nullable `creation_request_id`를 추가하고 `(project_id, created_by, creation_request_id)` partial unique index를 둔다. 생성 RPC는 같은 request ID와 같은 입력의 재시도에는 기존 문서를 반환하고, 같은 ID의 다른 입력은 충돌로 거부한다. 네트워크 재시도는 중복 문서를 만들지 않는다.

### 4.4 적산 작업실과 BOQ 연결

기존 drawing/BOQ 권위를 합치지 않는다. 두 도메인의 선택 관계만 저장하는 작은 append-only bridge를 추가한다.

`lukas_drawing_estimate_bindings`

- `id`
- `project_id`
- `drawing_revision_id`
- `boq_version_id`
- `created_by`, `created_at`
- same-project composite foreign keys
- revision과 BOQ version별 unique constraint
- RLS, explicit grants, entitlement fence
- ordinary update/delete 금지

템플릿 버전은 기존 library import ledger가, 단가 버전은 BOQ의 `price_book_id`가 이미 고정하므로 중복 저장하지 않는다.

## 5. 수량·금액 데이터 흐름

### 5.1 첫 10분 초안

초안 흐름은 다음과 같다.

`작업실 → 축척/단위 → line/area/count 객체 → 적산 분류 → 단가 자원 매핑 → 결과 레일`

사용자 속성 schema로 `적산 분류`, `공종`, `품목 코드`, `근거 상태`를 저장한다. 새 classification column이나 별도 클라이언트 객체 저장소를 만들지 않는다.

일반 객체 측정은 기존 `measureDrawingObject`를 확장한다.

- line/open polyline/grid: length
- rectangle/closed polyline/circle/area/space: area
- 분류된 object 또는 block instance: count
- calibration 없는 PDF 측정: `축척 미확정`, 금액 확정 불가

결과 레일은 현재 revision geometry/property와 선택한 draft BOQ/price book에서 파생한다. 별도 Zustand store나 결과 캐시를 canonical state로 사용하지 않는다.

### 5.2 초안과 확정의 경계

승인 전 결과는 명확히 `초안` 또는 `미리보기`로 표시한다.

- 브라우저 계산은 즉각적인 화면 미리보기다.
- 서버는 같은 입력으로 결정론적 draft summary를 계산한다.
- 승인 전에는 `lukas_drawing_quantity_links`를 만들지 않는다.
- 금액을 outbox, Yjs, 사용자 속성 JSON에 authoritative value로 저장하지 않는다.

확정 흐름은 기존 권위를 그대로 사용한다.

`drawing review → approved snapshot → drawing_quantity_links → drawing_boq_links → VERIFIED-BOQ-1.1 → independent approval → export/material lineage`

P6의 “승인 drawing만 확정 quantity source를 만든다”는 불변 조건을 완화하지 않는다.

### 5.3 결과 상태

각 결과 행은 다음 중 하나를 가진다.

- `확정`: 승인된 snapshot, measurement rule, BOQ result에 고정
- `초안`: 저장된 작업 객체와 draft BOQ로 서버 재현 가능
- `검토 필요`: 충돌, 단위 또는 rule 확인 필요
- `가정값`: 사용자가 근거 종류와 이유를 입력
- `근거 누락`: source/anchor/scale/rate 중 필요한 값 없음

도면 없는 작업은 `수기 입력`, `현장 실측`, `가정값`을 근거 종류로 사용한다. PDF/IFC/CAD를 연결하면 좌표·GlobalId·source SHA 근거를 추가한다.

파일 없는 작업실의 댓글·이슈는 기존 object link를 사용한다. file ID가 필수인 legacy anchor의 제약을 완화하거나 가짜 file ID를 만들지 않는다.

## 6. 템플릿과 단가 버전

### 6.1 starter templates

조직 drawing library와 immutable version/import ledger를 재사용한다. 별도 템플릿 엔진을 만들지 않는다.

플랫폼 starter catalog는 위 네 가지 canonical template payload로 구성한다. 새 조직이 처음 template 기능을 사용할 때 조직 library에 불변 버전을 seed하고 provenance를 남긴다. 조직은 이를 복제해 회사 표준을 만들 수 있지만 platform starter version을 덮어쓰지 못한다.

템플릿에는 가격 숫자를 넣지 않는다. 품목 코드, 측정 종류, 단위, 기본 BOQ 구조와 검토 규칙만 포함한다.

### 6.2 company rate book

기존 `parseVerifiedBoqPriceBook`, `lukas_qto_price_books`, `lukas_qto_price_resources`를 사용한다. 새 Excel library를 추가하지 않는다.

import는 다음을 보장한다.

- CSV/XLSX 파일 형식과 크기 검증
- formula cell 거부
- header mapping과 error row preview
- 공종 코드, 자원 구분, 이름, 규격, 단위, 단가, 기준일 검증
- duplicate code, 음수 가격, unsupported unit 거부
- immutable file row와 SHA 재검증 후 price book publish

M1의 “회사 라이브러리”는 회사 파일을 **프로젝트 immutable price-book version으로 가져오는 기능**이다. 여러 프로젝트가 직접 공유하는 organization-owned price book registry는 실제 반복 사용이 확인된 후 M2에서 copy/provenance ledger로 추가한다.

## 7. 상태관리와 실시간 협업 일정

코드 감사 결과 Yjs, y-indexeddb, Hocuspocus와 기존 external document store는 이미 구현돼 있다. 따라서 일정은 새 dependency 설치가 아니라 제품 경로에 대한 검증·노출 일정이다.

### M1

- 기존 external document store와 IndexedDB outbox 유지
- 새 상태관리 library 없음
- 기존 Yjs/Hocuspocus 코드를 삭제하지 않지만 M1 출시 판단을 별도 재구현에 묶지 않음
- comment/status 변화는 기존 Supabase authority 사용
- outbox와 collaboration identity는 계속 revision ID를 사용하므로 route 변경만으로 IndexedDB schema를 바꾸지 않음

### M2

- 결과 레일, inspector, source panel 간 UI state 경계를 정리
- 현재 store로 충족되면 Zustand를 추가하지 않음
- 실제 중복 구독·prop drilling·테스트 불가능성이 측정되면 Zustand를 UI state에만 도입
- drawing objects, BOQ, money를 Zustand에 복제하지 않음

### M3

- 기존 Yjs/Hocuspocus를 canonical workspace route에 연결
- y-indexeddb offline merge, Awareness cursor/selection/current page, read-only role 검증
- 협업 서비스의 Supabase JWT와 entitlement 재검증
- 두 브라우저, 단절·재연결, snapshot freeze 운영 gate 통과

Supabase Realtime은 댓글·승인·알림 같은 업무 사건을 전달한다. 고빈도 drawing document state는 Yjs/Hocuspocus가 담당한다. 승인·단가·수량·금액은 Postgres authority만 변경한다.

M3 이후 단일 Hocuspocus instance의 측정 한계를 넘을 때만 Redis/pub-sub과 수평 확장을 검토한다.

## 8. 오픈소스와 의존성 정책

완성형 편집기 포크가 아니라 현재 구현을 조합한다.

- React + Konva/react-konva: 2D 편집 core
- PDF.js: PDF source renderer
- Three.js/web-ifc와 현재 IFC adapter: IFC 근거
- Yjs/y-indexeddb/Hocuspocus: draft collaboration
- Node crypto, Zod, fflate, 기존 exact-decimal code: hash, validation, XLSX, money

M1은 새 runtime dependency와 새 test framework를 추가하지 않는다.

다음 전체 코드베이스는 포크하지 않는다.

- Penpot: 전체 디자인 플랫폼이라 과도함
- tldraw: 운영 라이선스 제약
- draw.io: diagram object model이 AEC/BOQ 계보와 다름
- Excalidraw: 별도 sketch object model을 core에 중복시킴

Excalidraw는 실제 현장 스케치 요구가 검증될 때 독립 adapter로만 검토한다. DWG native browser editing은 약속하지 않는다. M4에서 DXF import부터 검증하고 DWG는 명시적 변환 경계로 둔다.

직접 이식한 permissive code가 생기면 upstream commit/file/license/수정 내역을 `THIRD_PARTY_NOTICES.md`에 기록한다. Rayon/Figma의 이름, UI, icon, sample, 문구, proprietary code를 복사하지 않는다.

## 9. 권한과 불변성

- Viewer: 보기
- Commenter: 댓글·이슈
- Editor: 객체·속성·estimate draft 편집
- Reviewer: 검토 결정
- Approver: 독립 승인
- Admin: 구성원·공유·보존·library

capability는 기존 project role/organization entitlement에서 계산한다. UI, React Router action, RLS/RPC, Hocuspocus가 각각 재검증한다.

새 public table은 다음을 만족해야 한다.

- RLS enabled before grants
- `anon` no access
- explicit authenticated/service grants
- same-project composite FK
- restrictive non-anonymous and entitlement policy
- public `SECURITY DEFINER` write tunnel 금지
- private definer가 필요하면 safe `search_path`, auth/project recheck, PUBLIC execute revoke

PDF·IFC·RVT·price-book 원본 byte와 SHA-256은 어떤 workspace action으로도 변경하지 않는다. 승인 revision, snapshot, quantity/BOQ/material links와 approval event는 ordinary update/delete가 불가능하다.

## 10. 오류·복구 UX

예상 가능한 오류를 전체 화면 `Oops`로 보내지 않는다.

### route-level

- 인증 없음: 로그인 복귀 주소 포함
- 권한 없음: 403 안내와 프로젝트 목록 이동
- workspace 없음/다른 프로젝트: 404, 다른 revision으로 자동 대체 금지
- source 없음: 정상 빈 캔버스
- signed URL 만료: 서버 재발급 후 한 번 재시도
- PDF/IFC renderer 실패: 캔버스 source panel만 오류, 객체·댓글·결과 레일 유지

### mutation-level

- validation: 해당 field/row에 Korean message
- stale version: 최신 authority reload와 비교
- 네트워크 unknown result: 같은 client request ID로 idempotent retry
- outbox rejection: operation 유지, export/retry 경로 제공
- approved revision mutation: 새 revision 생성 CTA

### import-level

- 파일 읽기 전 size/MIME/extension 검증
- header mapping preview
- 오류 행과 이유를 다운로드 가능하게 표시
- valid/invalid 혼합 업로드는 전체 publish하지 않음
- 원본 파일 hash 불일치 시 price book 생성 차단

unknown error는 request ID를 보여주고 SQL, signed URL, service key, source byte를 노출하지 않는다.

## 11. 제품 로드맵

### M1 — 근거가 연결된 견적 초안

- source-optional canonical workspace route와 시작 화면
- 빈 작업실, 네 starter template, PDF 시작
- scale/unit, line/area/count 측정과 적산 분류
- 기존 Excel rate book import
- 캔버스 + 결과 레일
- draft/confirmed evidence 상태
- persistence/relogin, revision, comment, Viewer/Editor
- BOQ 상세와 approved CSV/XLSX export 연결
- source SHA invariance와 기존 PDF/IFC flow regression

### M2 — 편집기·회사 표준 확장

- 정밀 drawing, dimension, wall/opening/space, layer/style/block/table UX 정리
- organization template 관리와 실제 사용이 검증되면 organization price-book registry
- cross-panel UI state 경계 정리
- PDF/PNG/SVG output와 tablet authoring 개선

### M3 — 실시간 협업 운영화

- canonical route의 Yjs/Hocuspocus 연결
- cursor, selection, soft lock, offline merge, activity, restore
- role sharing, object comment, mention, review/approval 전체 흐름

### M4 — PDF·IFC·CAD 통합

- 2D/3D/split
- PDF anchor ↔ IFC GlobalId selection
- revision overlay와 change indication
- DXF import와 실제 고객 fixture round-trip
- native DWG 대신 explicit conversion boundary

### M5 — 업무 계보 확장

- approved BOQ → material plan → PO → receipt → installation/waste → carbon
- revision quantity/amount cause comparison
- organization retention, backup/restore, audit, entitlement
- 현장 사용자 검증과 요금제·조직 제품화

AI recognition, classification, omission suggestion은 M5 gate 이후 별도 설계한다. AI는 수량·금액·승인을 확정하지 않는다.

## 12. M1 완료 조건

M1은 다음 수직 흐름을 한 production-shaped fixture에서 통과해야 한다.

1. drawing file 없는 프로젝트에서 `새 작업실`을 누른다.
2. 빈 작업실, starter template, PDF 중 하나로 생성한다.
3. 생성 route 재시도는 같은 client request ID에서 중복 문서를 만들지 않는다.
4. 축척·단위를 설정하고 line, area, count 객체를 만든다.
5. 객체를 바닥·벽·천장·문·창호·가구·철거 중 하나로 분류한다.
6. 회사 CSV/XLSX 단가표를 검증·가져온다.
7. 결과 레일에서 수량·단가·금액·근거·검토 상태를 본다.
8. 단가 또는 근거 누락은 0원 확정이 아니라 `검토 필요`로 남는다.
9. 새로고침·로그아웃·재로그인 뒤 작업과 binding이 복원된다.
10. 댓글 또는 기존 issue를 객체에 연결한다.
11. draft 결과는 `초안`, 승인 snapshot과 BOQ 결과만 `확정`으로 표시된다.
12. Viewer의 object/binding/rate/BOQ mutation은 UI와 DB에서 모두 거부된다.
13. Editor가 review를 요청하고 다른 Approver가 승인한다.
14. approved CSV/XLSX/manifest를 내려받아 수량·금액·object/source hash를 재검증한다.
15. 작업 전후 PDF/IFC/RVT/price-book byte SHA-256이 동일하다.
16. 기존 file route와 PDF/IFC 검토·BOQ·Revit download 회귀가 통과한다.

## 13. 검증과 출시 gate

### 단위·component

- workspace/document/source resolver
- blank creation idempotency
- coordinate, calibration, length/area/count
- property classification and result grouping
- draft/confirmed label boundary
- CSV/XLSX parser adversarial inputs
- exact-decimal quantity × rate and unsupported unit
- route/panel error states and accessibility

### database

- fresh migration and populated upgrade
- `anon`, anonymous sign-in, non-member, Viewer, Editor, Reviewer, Approver, Admin
- cross-project IDs in workspace resolver and estimate binding
- direct table write and function-execute counterexamples
- same request ID exact retry and mismatched retry
- approved child update/delete denial
- entitlement, explicit grants, indexes, function search path
- real PostgreSQL RLS/locking proof; PGlite alone은 release authority가 아님

### E2E

- 빈/템플릿/PDF 시작 → 측정 → 분류 → rate import → result rail → refresh → comment → review → independent approval → export
- two-browser committed update visibility
- offline operation, reconnect, zero loss
- renderer failure with non-renderer panels still usable
- legacy file route redirect and exact object/BOQ reverse navigation

### 성능

- 10,000 object desktop pan/zoom/selection target 60fps
- whole workspace first usable target 2.5s on documented reference hardware
- collaboration reflection p95 500ms at M3 gate
- result rail and BOQ summary use bounded, indexed, paginated queries

Threshold miss는 `NOT MET`, 필요한 hosted authority가 없으면 `UNEXECUTED`로 기록한다. local build나 mock만으로 production PASS를 선언하지 않는다.

## 14. 명시적 비목표와 upgrade trigger

M1에서 하지 않는다.

- 새 drawing engine 또는 generic workspace framework
- 새 workspaces table
- 새 state manager, CRDT, collaboration server, spreadsheet library, decimal engine
- Penpot/tldraw/Excalidraw/draw.io 전체 포크
- native DWG editing
- public market price 자동 제공
- OCR/AI takeoff, AI 자동 분류·승인
- money/approval의 offline CRDT merge
- 기존 P6/P7 계보·조직·보존 authority 재작성

다음 실제 증거가 있을 때만 확장한다.

- 한 workspace가 여러 독립 document를 묶어야 함: 상위 workspace table
- 여러 프로젝트에서 같은 price book을 반복 복제함: organization price-book registry
- current external store가 측정된 cross-panel 문제를 해결하지 못함: Zustand
- single Hocuspocus instance가 측정 한계를 넘음: Redis/pub-sub과 horizontal scale
- 실제 고객 DXF round-trip이 안정적임: CAD adapter 범위 확대

## 15. 성공 판정

M1 성공은 기능 개수나 새 화면 수가 아니다. 적산 담당자가 source 없이도 시작하고, 10분 안에 재현 가능한 수량·금액 초안을 만들며, 승인 뒤 같은 결과를 원본·객체·산출식·단가·금액으로 역추적할 수 있어야 한다.

M1의 코드, DB policy, automated test, production-shaped evidence가 모두 존재할 때 M2로 진행한다. M1 부분 demo는 전체 M1–M5 목표 완료가 아니다.
