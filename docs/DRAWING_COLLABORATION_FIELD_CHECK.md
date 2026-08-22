# 1HK 도면 협업실 운영 검증표

## 현재 운영 기준

- 운영 URL: `https://lukas-qto-platform.vercel.app`
- 운영 Supabase project ref: `naubrijesaqnnbfaehpy`
- 배포 commit: `4354117`
- Vercel deployment: `dpl_Cx2GgqQFNgRAuWhM64purxSerxRM`
- 상태: **코드·DB 운영 배포 완료 / 실제 2인 현장 검증 대기**

이 문서는 완료 선언을 위한 증거 양식이다. 고객 도면 원본, 이메일, 사용자 UUID,
서명 URL은 문서나 Git에 기록하지 않는다.

## 자동·운영 게이트 증거

- `npm run build`: 성공
- `node --test tests/*.test.mjs`: 85/85 성공
- `npm run test:ifc -- /tmp/thatopen-example.ifc`: 120개 요소, 115개 형상,
  14,694 triangles 파싱 성공
- 운영 테이블 5개 RLS 활성화 확인
- Realtime publication: `lukas_drawing_issues`,
  `lukas_drawing_issue_comments`, `lukas_drawing_issue_events`
- 운영 DB rollback smoke: 소유자 생성·배정, viewer 읽기, viewer 쓰기 차단,
  담당자 알림 생성 확인; 종료 후 잔여 행 0건
- 인증 사용자의 테이블 권한은 이슈/anchor `SELECT, INSERT, UPDATE`, 댓글
  `SELECT, INSERT`, 이벤트 `SELECT`, 알림 `SELECT, UPDATE`로 제한
- 공개 `/`, `/auth/magic-link`, `/robots.txt`는 HTTP 200, 보호된
  `/workspace`, `/notifications`는 비로그인 요청을 `/login`으로 이동

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
