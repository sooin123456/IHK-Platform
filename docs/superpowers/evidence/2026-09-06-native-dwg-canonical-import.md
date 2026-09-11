# 네이티브 DWG → 편집 객체 저장 검증

검증일: 2026-09-06. 승인된 Universal Workspace 목표는 계속 활성 상태다. 이 기록은 **DWG 분석 결과를 정규 편집 객체·원본 근거·변경 이력으로 저장하는 서버 기반**의 검증이며, 사용자 화면 연결이나 DWG 재납품 완료 선언이 아니다. 운영 배포·원격 DB 변경·커밋은 하지 않았다.

## 이번에 구현한 범위

- 실제 DWG 분석 작업의 결과를 세션 권한으로 다시 읽고, 원본·분석 결과의 SHA-256과 대상을 검증한 후 편집 operation 권한을 발급한다.
- DXF의 기존 레이어/객체 생성·역연산·분할 저장 코드를 재사용한다. 네이티브 근거는 별도의 `dwg_entity`/`dwg_import`로 남으며 DXF로 바꾸어 표시하지 않는다.
- 객체마다 파일 해시, 분석 작업/결과 해시, 원본 handle·owner/layer handle, 종류와 단위를 유지한다. 원본 바이트는 변경하지 않는다.
- 저장된 객체·수량 근거·체크포인트·복제·복원에서 같은 원본 계보를 유지한다. 단일 가져오기 그룹의 실행 취소/다시 실행과 실제 객체 편집의 실행 취소/다시 실행을 검증했다.
- Viewer·다른 사용자·잘못된 원본·변경된 발급 요청·불완전한 원본 객체 목록·잘못된 객체/근거 짝·승인 잠금 상태를 차단한다.
- 기존 잠긴/숨긴 레이어의 복제 실패와, 복제·복원 기록 때문에 정상 프로젝트 보존 삭제가 막히던 문제를 제한된 범위에서 보완했다. 임의 기록 삭제는 여전히 차단한다.

핵심 파일: [네이티브 plan](../../../platform/app/lukas/lib/drawing-native-dwg-import-plan.server.ts), [인증된 준비 함수](../../../platform/app/lukas/lib/drawing-native-dwg-import-source.server.ts), [DB migration](../../../platform/supabase/migrations/20260906011309_drawing_native_dwg_canonical_import.sql).

## 새로 실행한 검증

최종 수정 후 `controller-final-2`, 2026-09-06 02:14:48 UTC 종료. 모든 명령의 exit code는 0이고 stderr는 비어 있다. 28개 구현/테스트 파일의 검증 전후 SHA-256이 일치하며, 캡처한 나머지 기존 파일도 보존되었다.

| 검증 | 결과 |
| --- | --- |
| 네이티브/DXF/협업·outbox/이력/원본/수량·BOQ 회귀 | 589/589, 실패·취소·건너뜀 0 |
| 실제 격리 DWG reader + 실제 PostgreSQL | 1/1, 실패·취소·건너뜀 0 |
| 앱 타입 검사와 실제 SSR 클라이언트 타입 회귀 | 통과 |
| 네이티브 worker 타입 검사 | 통과 |
| 협업 서버 타입 검사 | 통과 |

상세 명령과 코드 해시: [verification.json](2026-09-06-native-dwg-canonical-import/accepted-code/verification.json). 실제 통합 결과: [real-postgres.stdout.log](2026-09-06-native-dwg-canonical-import/accepted-code/real-postgres.stdout.log). 회귀 결과: [node-regressions.stdout.log](2026-09-06-native-dwg-canonical-import/accepted-code/node-regressions.stdout.log). `accepted-code`가 최종 검증 기록이며 상위 폴더의 초기 검증 기록은 비교를 위해 보존했다.

사용한 공개 합성 DWG는 10,987바이트, `AC1024`이며 SHA-256은 `5c287281fafa07f76a0158d5374dd7577910c107dcb55817688acf9fd8656c71`이다. 실제 reader가 생성한 1,446바이트 보고서 해시는 `c01a5e9ebae2460de8781e90dda68a47dc8e3bf3a869d8be188d34adebc783cf`이다. 고정 reader image는 `sha256:c67ff75cdacccad6cd77b275ad2557f889943bd29c98767c8f0e399d5e9b394f`이다.

실제 흐름에서 원본 handle `4A`–`4E`의 객체 5개와 근거 5개를 저장했다. operation 2개 중 첫 1개 저장 후 재준비로 정확한 prefix를 복구했고, 전체 저장 후에도 2개 receipt를 재사용했다. 그룹 취소/재실행 각 2개 operation, 별도 객체 편집 취소/재실행 각 1개 operation, checkpoint sequence 9와 새 DB 연결의 snapshot 조회를 검증했다. 원본 해시는 그대로이며 테스트가 소유한 parser container·parser config·fixture DB 잔여는 0이다.

분석 receipt는 계속 `analyzed` / `not-issued`다. 검증된 준비 결과에만 별도로 `operation-attested`를 부여한다. `experimental-unqualified` 표시는 유지한다.

검증 후 controller가 소유한 임시 PostgreSQL container `71f4cca757440d3938e855163fd6958cd7ec845560b0c03c26391e705e61f39d`의 이름·소유 label·image·tmpfs를 재확인했다. `m1_*` DB 잔여 0을 확인한 뒤 이 container만 중지·제거했고, 정확한 ID의 목록이 비어 있음을 확인했다. 빈 private Docker config도 `rmdir`로 정리했다. 사용자 데이터나 원본 파일은 삭제하지 않았고 테스트 기록은 보존했다.

## 검토에서 추가한 회귀 방어

- 별도 근거 JSON에 DB의 공통 파일/객체/개정 ID를 넣어 덮어쓰려는 입력을 두 조회 경로에서 거절한다.
- `dxf_import → dxf_entity`, `dwg_import → dwg_entity` 관계를 정방향·역방향과 여러 이력 조각 전체에 적용한다.
- 실제 앱 `makeServerClient()`의 타입을 준비 함수에 직접 넣는 컴파일 회귀를 추가했다. 테스트용 클라이언트만 맞는 상태를 방지한다.
- 실제 DB row lock 대기를 확인한 뒤 동시 freeze를 커밋하는 테스트로, 잠금을 얻은 후 현재 권한을 다시 검사하는 것을 증명한다.
- 올바른 원본 근거 두 개의 순서를 바꾸고 역연산까지 다시 맞춘 요청도 발급 전에 거절한다. 거절 후 발급 ledger 행은 0이다.

세 작업의 독립 검토와 수정 재검토, 최종 통합 검토의 수정 재검토까지 통과했다. 최종 검토에서 발견한 수량 근거의 빈 좌표 필드 8개 누락은 SQL 생성부에서 수정했다. 실제 저장된 DWG 근거를 DB에서 읽어 그대로 생산 코드의 검산 입력 파서에 전달하는 테스트로 `P6B04` 실패를 재현했고, 수정 후 통과했다. 소비자 검사는 느슨하게 바꾸지 않았다. 최종 수정 코드 전체를 위 명령들로 다시 검증했으며 열린 검토 지적은 없다.

## 설계 판단과 비용

- 기존 저장·협업·CAD 분할 이력을 재사용하고 새 엔진/큐/상태 라이브러리를 추가하지 않았다. 서비스 projector를 신뢰된 발급자로 두므로 SQL이 좌표 계산을 이중 구현하지 않는다. 서비스 발급자 자격 자체가 탈취된 상황까지 방어했다는 뜻은 아니다.
- DWG 근거를 별도 엄격한 형식으로 유지했다. DB·조회·수량 등 여러 계층의 호환성을 같이 관리해야 한다.
- 단위 해석은 분석 작업에 고정한다. 단위를 바꾸려면 재분석하며, 같은 파일의 다른 분석 작업이 기존 가져오기 계보를 덮어쓰면 충돌 처리한다. 불필요한 재시도가 늘 수 있으나 임의 재해석·덮어쓰기를 피한다.
- 잠긴/숨긴 레이어를 복제할 때 잠시 표시·잠금 해제한 후 같은 트랜잭션에서 정상 UPDATE로 복원한다. 실제 상태 복원 UPDATE가 있는 레이어는 version 2이고, 그대로인 레이어는 version 1이다. 소비자가 모든 새 레이어를 version 1로 가정하면 안 된다.
- 기존 복제·복원 private ledger의 외래 키/삭제 방어를 보완했다. 삭제는 소유자·중첩 cascade·정확한 보존 마크·프로젝트 제거 조건을 모두 만족해야 한다. 공유된 오래된 ledger도 변경하므로 운영 반영 전 **기존 데이터가 들어 있는 DB의 업그레이드 rehearsal**이 필요하다. 이번에는 새 DB 전체 migration과 커밋된 복제·복원·삭제를 검증했고, 기존 ledger 행을 미리 넣은 업그레이드는 별도로 실행하지 않았다.
- 화면은 서버 권한 검증 이후에 연결한다. 따라서 현재 브라우저에 이 단위의 새 DWG 가져오기 버튼은 아직 나오지 않는다. 별도 승인 반복 없이 기존 승인 범위에서 개발했으며, 로컬 검증 외 운영 변경은 하지 않았다.

## 남은 필수 작업과 출시 경계

1. 실제 프로젝트 DWG 업로드/선택 → 분석 상태 표시 → 편집 객체 가져오기 화면을 연결한다. 잘못된 DXF 분류를 제거하고 Viewer 제한과 안전한 오류/단위 선택을 표시한다.
2. 네이티브 outbox의 재접속·재로그인 재발급/재전송을 기존 DXF와 같은 경로로 통합하고, 실제 브라우저·인증·Supabase Storage 환경에서 검증한다. 이번 HTTP bridge 및 SQL 세션은 **실제 PostgREST/JWT/Storage의 검증이 아니다**.
3. 승인된 편집 상태의 원본 handle 기반 DWG writer 연결과 재저장·납품을 완성한다. 현재 5종 투영 및 기존 제한적 native writer의 통과가 DWG 전체 호환성을 뜻하지 않는다. source-free native export 보호 조건은 약화하지 않았다.
4. 실제 CAD 수신 프로그램 재열기, 지원/미지원 엔티티·외부 참조·스타일 등 손실 검사, 사용자 실무 도면 검증을 수행한다.
5. 이어서 실무 템플릿·납품 패키지와 기존 빠른 시작/저장·복원 흐름의 회귀를 완성한다. 전체 목표는 완료 처리하지 않는다.

운영 반영 시 새 source column과 함수가 필요하므로 검증된 migration이 앱 변경보다 먼저 적용되어야 한다. 비용·라이선스 계약이나 배포 권한이 필요한 별도 단계는 자동으로 실행하지 않는다.
