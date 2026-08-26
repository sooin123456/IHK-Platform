# 1HK 도면 협업실 운영 검증표

## 현재 운영 기준

- 운영 URL: `https://lukas-qto-platform.vercel.app`
- 운영 Supabase project ref: `naubrijesaqnnbfaehpy`
- 배포 commit: `42d0af4`
- Vercel deployment: `dpl_Avd2huenCGqy5KQ3jbRYQUC8o5Co`
- 상태: **코드·DB 운영 배포 완료 / 실제 2인 현장 검증 대기**

이 문서는 완료 선언을 위한 증거 양식이다. 고객 도면 원본, 이메일, 사용자 UUID,
서명 URL은 문서나 Git에 기록하지 않는다.

## Drawing Workspace P3 상태

- P3 local implementation: Tasks 1~11 구현과 범위별 공식 검토는 완료했다.
  Final broad review의 production-shaped Yjs bootstrap 결함은 수정했고 실제
  provider 회귀 테스트를 추가했지만 fresh final broad review는 pending이다.
- P3 production: **UNEXECUTED / 미실행**. 현재 문서 상단의 기존 운영 배포
  commit·Vercel ID는 이전 도면 협업실 증거이며 Yjs/Hocuspocus P3 배포 증거가
  아니다.
- hosted migration 적용, collaboration image build/push, asymmetric JWKS,
  dedicated database LOGIN, application preview, 실제 WebSocket/RLS와 source
  재다운로드, promotion 및 rollback rehearsal 증거는 아직 없다.
- production three-context warm reflection p95 목표는 500 ms 이하이나 현재
  값은 `UNEXECUTED`; cold 측정도 `UNEXECUTED`다. 로컬 계약 결과를 production
  수치로 옮겨 적지 않는다.

P3 production fixture는 owner, editor, reviewer, viewer, nonmember 다섯 역할을
분리하고 세 browser context를 동시에 사용해야 한다. 다음을 비식별 release
record에 함께 남긴다.

1. exact app/service image digest와 적용 migration 목록
2. 브라우저·OS·viewport·CPU·memory·도면 object mix와 warm/cold 조건
3. 30회 warm reflection의 nearest-rank p95와 500 ms 판정
4. offline 100 operation ID의 Postgres/Yjs exact set, 유실 건수와 최종 geometry
5. owner/editor 쓰기, reviewer/viewer 읽기 전용, nonmember WebSocket·DB 거부
6. review freeze, 승인, 반려 후 released draft, approved child draft 복원
7. 작업 전후 PDF/IFC metadata·downloaded-byte SHA-256 및 byte size
8. 실제 quantity report/manifest·도면 객체·IFC source lineage와 cleanup
9. 새 admission 중단→Hocuspocus flush/drain→image rollback→복구 smoke 결과

전체 항목과 아래 실제 2인 현장 검증이 끝나기 전에는 P3 operationally complete
또는 P3 운영 완료로 표시하지 않는다.

## Drawing Workspace P4 상태

- P4 local implementation은 여섯 건축 객체, hosted reference, 서버
  `P4_MEASUREMENT_V1`, Room/Door/Finish schedule, semantic export와 실제
  IndexedDB/outbox reload/action-ACK 경계를 포함한다.
- P4 local production-build baseline은 Chromium 151, Apple M3 Max, 1440×900,
  10,000 mixed semantic objects에서 first usable 5,434.0 ms로 측정되어
  `<= 2.5s` 목표를 **충족하지 못했다**. 60 fps는 P7 gate다.
- P4 production은 **UNEXECUTED / 미실행**이다. 실제 owner/editor/reviewer/
  viewer/nonmember RLS, hosted provider convergence, three-context provider p95
  `<= 500 ms`, freeze/approved immutability, source hash, cleanup과 rollback을
  현장 증거 없이 PASS로 바꾸지 않는다.
- `npm run release:drawing-workspace-p4:production`은 실제 authority가 없으면
  Playwright 시작 전에 nonzero `UNEXECUTED`로 종료한다.

## 자동·운영 게이트 증거

- `npm run build`: 성공
- `node --test tests/*.test.mjs`: 116/116 성공
- `npm run typecheck`, `npm run build`: 성공
- 권한 있는 실제 Revit IFC smoke: 2,207,379 bytes, 560개 IFC 요소,
  385개 형상 요소, 441 placements, 7,904 triangles 파싱 성공
- 로그인 없는 로컬 현장 점검에서 같은 IFC의 첫 3D 화면을 1.824초에 표시하고
  객체 #1356을 이슈 근거로 연결했다. 539쪽·7,115,196 bytes PDF는 첫 페이지를
  0.795초에 표시하고 2쪽 전환·영역 지정·이슈 근거 연결을 완료했다. 브라우저
  console error와 PDF font loading warning은 모두 0건이었다. 이 시간은 로컬
  Chrome 1회 측정값이며 운영 네트워크 SLA가 아니다.
- PDF.js 문자표와 표준 글꼴을 애플리케이션에서 직접 제공하므로 한국어·기호
  문서가 외부 CDN에 의존하지 않는다.
- 이슈 목록은 서버에서 50건 단위로 조회하며, 오래된 이슈 직접 링크와 IFC
  객체 선택 query를 페이지 이동 뒤에도 보존한다.
- 저장된 근거 링크는 이슈·파일·anchor를 함께 검증한다. IFC는 요소 선택과
  카메라 위치를, PDF는 페이지와 정규화 영역을 복원하며 잘못된 anchor는
  `globalId`만 부분 적용하지 않는다. 같은 IFC에서 query나 Realtime 데이터가
  바뀌어도 파일 ID가 같으면 모델 전체를 다시 파싱하지 않는다.
- Realtime 재연결 시 loader를 한 번 갱신하고, 숨긴 브라우저 탭에서는 IFC
  WebGL render와 first-frame 측정을 함께 보류한다.
- 운영 도면 테이블 6개 RLS 활성화 확인
- Realtime publication: `lukas_drawing_issues`,
  `lukas_drawing_issue_comments`, `lukas_drawing_issue_events`
- 운영 DB rollback smoke: 소유자 생성·배정, viewer 읽기, viewer 쓰기 차단,
  담당자 알림 생성 확인; 종료 후 잔여 행 0건
- 인증 사용자의 테이블 권한은 이슈/anchor `SELECT, INSERT, UPDATE`, 댓글
  `SELECT, INSERT`, 이벤트 `SELECT`, 알림 `SELECT, UPDATE`로 제한
- 공개 `/`, `/auth/magic-link`, `/robots.txt`는 HTTP 200, 보호된
  `/workspace`, `/notifications`는 비로그인 요청을 `/login`으로 이동
- 최신 운영 배포 기준 최근 24시간 Vercel `error` 로그 집계는 0건이다.
  이는 관측된 서버 오류가 없다는 뜻이며, 아직 실행하지 못한 실제 2인
  renderer·Realtime 현장 흐름을 대신하지 않는다.

## 역할별 브라우저 자동 검증

`platform/e2e/drawing-collaboration.spec.ts`는 실행할 때마다 임시 소유자,
검토자, 조회자, 비멤버 계정과 프로젝트를 만들고 종료 시 모두 삭제한다. PDF
영역 이슈 생성, 담당자 배정, 다른 브라우저의 댓글·종료, 소유자 화면의 실시간
반영, 조회자 쓰기 차단, 비멤버 404, 390px 모바일 전환을 검사한다.

운영 환경 실행에는 마스킹되지 않은 `SUPABASE_SERVICE_ROLE_KEY`가 필요하다.
Vercel의 `[SENSITIVE]` 표시값은 실제 키가 아니므로 테스트가 명확히 실패한다.
실제 비밀값을 Git, 로그, Playwright report에 기록하지 않는다.

2026-08-23 운영 URL을 대상으로 Vercel production env pull을 사용한 실행은
테스트 데이터 생성 전에 위 마스킹 게이트에서 중단됐다. 따라서 운영 데이터
잔여물은 없고, 이를 E2E 성공으로 기록하지 않는다.

GitHub Actions 수동 게이트도 검토했으나 현재 저장소 OAuth와 GitHub App에는
workflow 파일 쓰기 권한이 없어 공개 push가 403으로 거부됐다. 권한을 우회해
비밀값을 코드나 일반 환경변수로 옮기지 않는다. 현재 재현 가능한 명령은 아래
로컬 명령이며, 마스킹되지 않은 세 값은 실행 프로세스에만 주입한다.

```sh
cd platform
E2E_BASE_URL=https://lukas-qto-platform.vercel.app \
SUPABASE_URL=https://PROJECT.supabase.co \
SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... \
npx playwright test e2e/drawing-collaboration.spec.ts --project=chromium
```

## 실제 2인 현장 검증

아래 전체가 끝나기 전에는 `도면 협업실 완성`으로 표시하지 않는다.

1. 소유자와 검토자가 서로 다른 계정으로 로그인한다.
2. 권한 있는 실제 IFC 1개와 2페이지 이상 PDF 1개를 같은 프로젝트에 등록한다.
3. 소유자가 IFC 객체를 선택해 이슈를 만들고 담당자와 기한을 지정한다.
4. 소유자가 PDF 영역을 지정해 두 번째 이슈를 만든다.
5. 검토자가 다른 브라우저에서 두 이슈와 객체/페이지 위치 근거를 다시 연다.
6. 검토자가 댓글을 남기고 담당자가 `검토 요청` 상태로 변경한다.
7. 검토자가 이슈를 종료하고 소유자 알림에 반영되는지 확인한다.
8. 새 IFC/PDF 개정을 등록한다. 이전 anchor는 유지하고 IFC만 정확히 같은
   GlobalId 후보를 보여주며 PDF는 수동 재지정하는지 확인한다.
9. 390px 모바일 화면에서 도면, 이슈, 댓글, 알림을 키보드 가림 없이 처리한다.
10. viewer 계정의 생성·배정·종료 요청과 비멤버의 프로젝트 읽기가 DB에서
    거부되는지 확인한다.

## 기록할 비식별 증거

- 검증 UTC 시작/종료 시각
- 브라우저와 OS 버전
- IFC/PDF 파일 ID, 이슈 ID, event ID (원본 파일명과 사용자 ID 제외)
- 데스크톱/모바일 각 단계 성공 여부와 실패 문구
- 첫 도면 표시 시간, Realtime 재연결 횟수, 처리되지 않은 renderer 오류 수
- 실패 시 재현 단계, 수정 commit, 재검증 시각

## 롤백

1. Vercel에서 직전 정상 production deployment를 promote한다.
2. 도면 migration은 additive이므로 운영 중 생성된 이력 행을 삭제하지 않는다.
3. UI를 롤백해도 도면 테이블과 감사 이벤트는 보존한다.
4. Realtime 문제가 있으면 UI 구독만 비활성화하고 서버 조회·수정 흐름을 유지한다.
5. RLS 또는 권한 문제가 확인되면 공개를 중지하고 보정 migration을 추가한다.
   이미 적용한 migration 파일을 수정하거나 down migration으로 데이터를 지우지 않는다.
