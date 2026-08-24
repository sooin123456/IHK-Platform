# 1HK Drawing Workspace 설계

기준일: 2026-08-24

## 1. 목표

기존 1HK 도면 협업실을 PDF·IFC 검토 화면에서 브라우저 기반 도면 작업실로 확장한다. 사용자는 원본 파일을 변경하지 않은 채 도형을 작성·측정·분류하고, 객체를 이슈·승인·물량·내역·금액·자재 근거에 연결한다.

최종 계보는 다음과 같다.

`원본 RVT/PDF/IFC → 도면 객체 → 검토 이슈 → 승인 → 물량 → 내역·금액 → 자재·발주·입고 → 탄소 근거`

P0부터 P7까지를 하나의 제품 목표로 유지하되, 각 단계는 독립적인 명세·구현·검증 게이트로 출시한다. 초기 편집 기능을 이유로 후속 협업·적산·제품화 범위를 삭제하지 않는다.

## 2. 기존 구현과 변경 경계

다음 기존 구현을 그대로 재사용한다.

- React Router 7 애플리케이션과 Vercel 배포
- Supabase Auth, Postgres, RLS, Storage, Realtime
- `pdfjs-dist` PDF 렌더러
- Three.js와 `web-ifc` IFC 렌더러
- `lukas_qto_projects`, 불변 파일과 SHA-256, 파일 개정 그래프
- 도면 이슈·앵커·댓글·이벤트·알림·maker-checker 승인
- 검증된 BOQ, 물량, 자재, 탄소 데이터와 승인 계약

현재 `/projects/:projectId/drawings/:fileId` 협업실은 새 작업실이 출시 게이트를 통과할 때까지 유지한다. 새 편집기는 `/projects/:projectId/drawings/:fileId/workspace`에 추가한다. 기존 흐름을 새 편집기로 즉시 교체하지 않는다.

## 3. 채택한 오픈소스 전략

### 직접 포함 가능

상용 1HK 코드에 직접 포함하거나 수정하는 소프트웨어는 MIT, Apache-2.0, BSD와 같은 permissive license로 제한한다.

- Konva와 react-konva: 2D scene graph, 선택, 변형, 레이어, 이벤트
- Excalidraw: command, undo/redo, 클립보드, 단축키, local-first 구현 참고
- OpenPlan3D: 벽·문·창·공간·스냅 기하 알고리즘 참고
- Arcada Planner: React/Konva 평면 편집 구현 참고
- Yjs와 y-indexeddb: P3 실시간 문서와 오프라인 병합
- Hocuspocus: P3 Yjs WebSocket 동기화 서버

패키지 의존을 우선한다. 코드를 직접 이식할 때는 원본 저장소, commit, 파일, license, 수정 내역을 `THIRD_PARTY_NOTICES.md`에 기록하고 저작권 고지를 보존한다.

### 직접 포함하지 않음

- tldraw SDK: source-available이며 상용 운영에 별도 라이선스가 필요하다.
- Penpot: 설계 참고만 한다. Clojure/ClojureScript 전체 스택을 포크하지 않는다.
- Graphite: 설계 참고만 한다. Rust/WASM 편집기 전체를 포크하지 않는다.
- GPL, AGPL, LGPL, MPL 코드는 별도 법률 검토와 명시적 승인 없이 제품 코드에 복사하지 않는다.

완성형 앱 포크 대신 `기존 1HK + Konva 편집 코어 + 선별 이식한 permissive 알고리즘 + 1HK 데이터 계보`를 사용한다.

## 4. 시스템 아키텍처

### 서버 화면

새 route loader는 다음을 수행한다.

1. 로그인과 프로젝트 멤버십을 확인한다.
2. 파일 ID, project ID, SHA-256을 함께 검증한다.
3. 편집 문서와 최신 접근 가능한 개정을 읽는다.
4. PDF/IFC 원본의 짧은 signed URL을 만든다.
5. 역할에서 계산한 작업실 capability를 반환한다.

모든 mutation은 React Router action 또는 명시적인 Supabase RPC를 통과한다. 브라우저가 보낸 project ID, 역할, 객체 version, 수량·금액 결과를 신뢰하지 않는다.

### 클라이언트 편집기

편집기는 다음 경계로 분리한다.

- document model: 페이지·레이어·도형·스타일의 도메인 상태
- command engine: 추가·수정·삭제·이동·복사와 inverse command
- canvas adapter: 도메인 객체를 Konva node로 표시하고 포인터 입력을 command로 변환
- selection/tools: 선택, 다중 선택, 스냅, 도구별 작성 상태
- inspector: 선택 객체의 검증된 속성 편집
- local outbox: 저장 전 operation의 IndexedDB 보존과 재전송
- collaboration adapter: P3 이전 단일 사용자 store, P3 이후 Yjs/Hocuspocus 연결

Konva JSON은 DB 계약이 아니다. Konva node는 언제든 도메인 상태에서 다시 만들 수 있는 view adapter다. 텍스트 입력, 접근성, 컨텍스트 메뉴는 DOM 오버레이에서 처리한다.

### 렌더링 계층

아래에서 위 순서로 렌더링한다.

1. 잠긴 PDF 또는 래스터 배경
2. 편집 가능한 Konva 벡터 계층
3. 선택 상자·스냅·가이드·실시간 커서 계층
4. 텍스트 입력·메뉴·접근성 DOM 계층

IFC는 기존 Three.js 렌더러를 유지한다. P5 분할 보기에서 2D 객체 선택과 IFC GlobalId 선택을 공통 selection bridge로 연결한다.

## 5. 좌표와 측정 계약

- 편집 도메인의 월드 길이 단위는 millimeter다.
- 화면 좌표는 저장하지 않으며 viewport transform으로 월드 좌표와 변환한다.
- PDF 페이지 원본 위치는 회전을 반영한 0~1 정규화 좌표로 보존한다.
- PDF 실측은 사용자가 알려진 두 점과 실제 길이를 입력해 calibration transform을 확정한 뒤에만 제공한다.
- calibration이 없는 PDF 측정은 `축척 미확정` 미리보기이며 승인 수량으로 사용할 수 없다.
- IFC meter 좌표는 명시적인 model-to-world transform으로 millimeter에 매핑한다.
- 브라우저의 `number` 계산은 미리보기다. 확정 수량은 고정된 rule version, 단위 변환, 반올림 순서를 서버에서 다시 계산한다.

P0/P1 geometry 계약은 다음 객체만 포함한다.

- line: 시작점과 끝점
- polyline: 두 개 이상의 점과 닫힘 여부
- rectangle: 기준점, 폭, 높이, 회전
- circle: 중심과 반지름
- text: 기준점, 폭, 문자열, 글자 style
- dimension: 두 측정점, 치수선 위치, calibration 참조

호, 벽, 개구부, 공간, 축은 P4에서 같은 object contract의 새 type으로 추가한다. 모든 geometry는 Zod와 서버 RPC에서 type별로 검증한다.

## 6. 데이터 모델

모든 새 public table은 `lukas_` 접두사, RLS, least-privilege grant, project FK 인덱스를 가진다.

### P0/P1 핵심

- `lukas_drawing_documents`: 프로젝트 편집 문서
- `lukas_drawing_revisions`: 부모 개정, sequence, `draft | review_requested | approved | superseded`
- `lukas_drawing_pages`: 시트와 배경 파일·페이지·calibration
- `lukas_drawing_layers`: 순서, 표시, 잠금
- `lukas_drawing_objects`: type, geometry, style, version, `lineage_id`
- `lukas_drawing_operations`: append-only 사용자 command
- `lukas_drawing_snapshots`: canonical JSON, operation sequence, SHA-256
- `lukas_drawing_revision_approvals`: append-only 승인·반려
- `lukas_drawing_object_sources`: 원본 파일 ID·SHA와 PDF/IFC 위치
- `lukas_drawing_object_issue_links`: 기존 drawing issue와 객체

### P2 구조화

- `lukas_drawing_canvases`
- `lukas_drawing_styles`
- `lukas_drawing_blocks`
- `lukas_drawing_block_instances`
- `lukas_drawing_property_schemas`
- `lukas_drawing_property_values`
- `lukas_drawing_tables`

P0에서 페이지당 canvas가 하나일 때는 page가 canvas 속성을 가진다. P2에서 model/paper space가 실제로 필요할 때 canvas table로 이동한다.

### P3 협업 상태

- `private.lukas_drawing_collaboration_states`: revision별 Yjs binary, schema version, 저장 시각

이 table은 Data API에 노출하지 않고 Hocuspocus service identity만 읽고 쓴다. Yjs binary는 병합 가능한 작업 상태이며 승인 근거가 아니다. 승인 근거는 public snapshot table의 canonical JSON과 SHA-256이다.

### P6 계보

- `lukas_drawing_quantity_links`
- `lukas_drawing_boq_links`
- `lukas_drawing_material_links`

원본·이슈·물량·내역 연결을 객체 JSON에 넣지 않는다. 별도 관계 테이블과 동일 프로젝트 FK로 역추적 가능성을 강제한다.

### 객체와 개정

- `id`는 개정별 객체 인스턴스다.
- `lineage_id`는 개정 간 같은 논리 객체를 추적한다.
- 새 개정은 승인 스냅샷의 페이지·레이어·객체를 복제해 시작한다.
- 초기 목표인 10,000개 객체에서는 단순 복제를 허용하고 copy-on-write를 만들지 않는다.
- 승인 개정의 페이지·레이어·객체·스타일은 update/delete할 수 없다.
- 승인 스냅샷은 canonical JSON과 SHA-256으로 식별한다.

## 7. 저장·실행 취소·오프라인

### P0부터 P2

입력 흐름은 다음과 같다.

`포인터/키보드 → command → 로컬 적용 → IndexedDB outbox → 저장 RPC`

저장 RPC는 한 DB transaction에서 다음을 수행한다.

1. capability와 draft 상태 검증
2. `client_operation_id` 중복 확인
3. 대상 객체 `base_version` 확인
4. 객체 materialized current state 갱신
5. append-only operation 추가
6. 서버 sequence와 새 version 반환

operation 상태는 `pending | acked | conflicted | rejected`다. ack 전에는 IndexedDB에서 지우지 않는다. 재시도는 같은 `client_operation_id`를 사용한다.

실행 취소는 사용자의 마지막 command에 저장된 inverse를 새 operation으로 적용한다. 이미 다른 사용자가 변경한 객체를 과거 상태로 덮지 않으며, inverse의 base version이 맞지 않으면 충돌 검토로 전환한다.

### P3

- Yjs는 draft의 실시간 작업 상태를 관리한다.
- y-indexeddb는 단절 중 Yjs update를 보존한다.
- Hocuspocus는 Supabase JWT와 document capability를 검증한다.
- editor만 update를 보내며 reviewer와 viewer는 read-only다.
- command는 감사 이력을 위해 Postgres operation에도 기록한다.
- Hocuspocus 저장 시 문서 schema를 검증한다.
- 검토 요청 시 서버가 Yjs 상태를 canonical JSON으로 변환하고 operation sequence와 함께 snapshot을 고정한다.
- 승인 뒤 해당 Yjs 문서는 read-only가 되며 다음 편집은 새 revision document에서 시작한다.

Yjs는 도형·좌표·스타일·레이어의 작업 상태만 가진다. 승인·수량·단가·금액은 Postgres에서만 변경한다.

## 8. 협업 서비스 도입 일정

### P0-P2

- React `useSyncExternalStore` 기반의 작은 document store
- IndexedDB outbox
- Postgres materialized state와 operations
- 별도 상태관리 라이브러리 없음

### P3-A

- Supabase Realtime로 기존 댓글·이슈·승인 DB 이벤트 전달
- 초기 접속·권한·다중 브라우저 흐름 검증

### P3-B 완료 전

- Yjs, y-indexeddb, Hocuspocus 도입
- Hocuspocus Awareness로 커서·선택·현재 페이지 전달
- Supabase Presence를 고빈도 포인터 전송에 사용하지 않음

Hocuspocus는 Vercel 함수에 넣지 않는다. 장기 WebSocket을 지원하는 별도 오픈소스 서비스로 배포하고 Supabase JWT를 재검증한다.

협업 서비스는 Node.js 22 기반 OCI container로 패키징한다. 특정 hosting vendor의 독점 API에 의존하지 않으며 환경 변수로 Supabase URL, JWT 검증 정보, document storage 연결을 주입한다.

### P7

측정된 부하가 단일 인스턴스 기준을 넘을 때 Hocuspocus 다중 인스턴스와 Redis 확장을 추가한다. 별도 상태관리 라이브러리는 제품 목표가 아니며 Yjs와 역할이 중복되므로 필수 도입 항목으로 두지 않는다.

## 9. 권한

기존 프로젝트 역할을 유지하고 작업실 capability로 매핑한다.

| 프로젝트 역할 | capability |
|---|---|
| `owner`, `staff` | Admin, Editor, Reviewer, Approver |
| `estimator` | Editor, Commenter, 검토 요청 |
| `reviewer` | Commenter, Reviewer, Approver |
| `site`, `procurement` | Commenter |
| `viewer` | Viewer |

UI 숨김만으로 권한을 구현하지 않는다. React Router action, Supabase RLS/RPC, Hocuspocus 인증이 같은 매핑을 재검증한다. 승인자는 자신이 만든 개정 또는 이슈를 승인할 수 없다.

## 10. 승인과 불변성

- 검토 요청은 현재 Yjs/operation 상태의 canonical snapshot을 생성한다.
- 승인·반려는 `subject_version`과 snapshot SHA를 가진 append-only decision이다.
- 승인 transaction은 snapshot, 대상 version, approver 분리를 다시 검증한다.
- snapshot 생성이나 검증이 실패하면 승인도 실패한다.
- 승인 성공 뒤 기존 revision의 직접 update/delete를 DB trigger와 RLS에서 차단한다.
- PDF·IFC 원본 row와 Storage object는 편집 동작으로 update/delete하지 않는다.
- 새 개정은 부모 승인 snapshot과 원본 file SHA를 보존한다.

## 11. 오류와 충돌 처리

- 네트워크 단절 중 로컬 편집을 허용하고 재연결 뒤 순서대로 전송한다.
- 서로 다른 객체의 변경은 독립 적용한다.
- 같은 객체의 동일 속성 변경은 변경자와 결과를 표시한다.
- 벽·개구부·수량 근거처럼 업무 의미가 바뀔 수 있는 충돌은 자동 확정하지 않고 검토 상태로 남긴다.
- 렌더러 오류가 나도 파일 정보, 이슈, 댓글, 변경 이력은 계속 열 수 있다.
- 원본 위치를 찾지 못하면 연결을 삭제하지 않고 `근거 열기 실패`로 표시한다.
- signed URL 만료는 재발급 후 재시도하며 원본을 공개 URL로 전환하지 않는다.
- 클라이언트 schema가 서버보다 새롭거나 오래되면 쓰기를 차단하고 안전한 reload/export 경로를 제공한다.

## 12. 제품 단계

### P0 편집 기반

route, shell, 빈 도면/PDF 배경, 월드 좌표, pan/zoom, grid, 선택, 핵심 DB/RLS, 자동 저장, 재개, outbox를 구현한다.

### P1 기본 2D

선, polyline, rectangle, circle, text, dimension, 다중 선택, 이동, 복사, 삭제, undo/redo, shortcut, command search, inspector를 구현한다.

### P2 구조와 재사용

페이지, canvas, layer, style, block, template, schedule, custom property, PDF/PNG/SVG export를 구현한다.

### P3 실시간 협업

Yjs/Hocuspocus, offline merge, cursor, selection, soft lock, object comment, mention, role sharing, history, restore를 구현한다.

### P4 건축 의미 객체

wall, opening, space, area, grid, arc와 결정론적 길이·면적·개수 측정, 공간·문·마감 schedule을 구현한다.

### P5 PDF·IFC 통합

2D/3D/split, 객체와 IFC GlobalId 상호 선택, 개정 overlay, 기존 anchor 재연결 검토를 구현한다.

### P6 물량·내역

원수량·보정수량·최종수량, 단가·공종·내역 mapping, 개정 변화 비교, 승인 Excel/CSV 인계를 구현한다.

### P7 제품화

회사 template/library, desktop/tablet 적응형 UI, 대형 도면 최적화, 감사·보존·백업·복구, 현장 검증, 요금제·조직 관리를 구현한다. AI 인식·분류·누락 추천은 이 단계가 완료된 뒤 별도 승인 기능으로 설계한다.

## 13. 검증과 출시 게이트

### 자동 검증

- 좌표 변환, calibration, snapping, 측정, command inverse, canonical snapshot 단위 테스트
- FK, RLS, 승인 원자성, revision freeze, 멱등 operation DB 반례
- 도구 전환, selection, inspector, shortcut, 접근성 component 검증
- 빈 도면/PDF 열기부터 작성·저장·재로그인·이슈·검토·승인까지 Playwright
- 다중 browser cursor·selection·동시 수정·재접속 검증
- 기존 PDF/IFC 검토, 수량, 승인, Revit download 회귀 테스트
- dependency license와 직접 이식 코드 notice 검사

현재 Node test runner와 Playwright를 확장한다. 같은 검증을 위해 새 테스트 framework를 추가하지 않는다.

### 성능·신뢰성

- 10,000개 혼합 객체 pan/zoom/selection 60fps 목표
- 대표 PDF 첫 사용 가능 화면 2.5초 이내
- 실제 사용자 3명 공동 편집 반영 p95 500ms 이내
- 5분 단절 중 100 operation 작성 후 유실 0건
- 승인 revision update/delete 반례 100% 차단
- 비회원과 Viewer의 DB·WebSocket 쓰기 차단

성능 결과에는 browser, CPU, memory, 화면 크기, 객체 구성, cold/warm 조건을 함께 기록한다.

### 수직 기능 게이트

P0+P1 구현 게이트는 단일 사용자 편집 기반을 검증한다. 원래 정의된 다중 사용자 cursor 조건은 P3 기능이므로 삭제하지 않고 `P0+P1+P3 협업 slice`의 첫 수직 기능 출시 게이트로 이동한다.

최초 출시 전 다음 열 가지를 모두 만족해야 한다.

1. 빈 도면 또는 PDF 배경을 연다.
2. 기본 여섯 도형을 작성한다.
3. 선택·이동·복사·삭제·undo/redo가 동작한다.
4. 두 개 이상 layer의 표시·잠금을 변경한다.
5. inspector에서 이름·layer·색·선·채움·text를 변경한다.
6. 새로고침·재로그인 뒤 같은 상태가 복원된다.
7. 기존 댓글 또는 issue를 객체에 연결한다.
8. 두 browser에서 cursor와 객체 생성·이동이 보인다.
9. PDF·IFC SHA-256이 작업 전후 동일하다.
10. Viewer 쓰기는 차단되고 Editor만 객체를 변경한다.

### 운영 검증

실제 사용자 3명이 운영 Supabase와 협업 서버에서 `도면 열기 → 작성 → 댓글 → 수정 → 검토 요청 → 승인 → 내보내기`를 수행한다. build 성공만으로 출시 완료를 선언하지 않는다.

## 14. 범위 밖 또는 후속 판단

- 원본 PDF·IFC byte 수정
- 네이티브 DWG 편집
- 자동 승인과 AI 확정 계산
- 근거 없는 PDF 좌표의 자동 개정 이식
- 측정 없이 도입하는 microfrontend, custom geometry server, state framework

DWG/DXF는 permissive parser와 실제 고객 파일의 round-trip 검증이 확보된 별도 단계에서 추가한다.

## 15. 구현 계획 경계

이 문서는 P0-P7 전체 프로그램의 공통 architecture와 불변 계약이다. 한 개의 거대 implementation plan으로 실행하지 않는다. 다음 순서로 별도 plan과 검증 결과를 만든다.

1. P0/P1 편집 kernel과 첫 단일 사용자 수직 기능
2. P2 문서 구조·재사용·export
3. P3 Yjs/Hocuspocus 협업과 첫 전체 수직 기능
4. P4 건축 의미 객체와 결정론적 측정
5. P5 PDF/IFC selection·revision 통합
6. P6 물량·내역·금액 계보
7. P7 운영 제품화와 전체 completion audit

각 plan은 이전 단계의 검증된 public contract만 의존한다. 단계 구현 중 공통 architecture를 변경해야 하면 이 문서를 먼저 개정하고 승인받는다.

## 16. 성공 판정

P0부터 P7까지 각 단계의 코드, DB 정책, 자동 테스트, 운영 증거가 모두 존재할 때만 전체 목표를 완료로 판정한다. 부분 구현이나 로컬 demo는 전체 완료 근거가 아니다.
