# 승인 스냅샷 → 네이티브 DWG 연결 검증

검증일: 2026-09-06. 운영 배포 없이 로컬 작업 트리와 폐기 가능한 PostgreSQL에서 수행했다.

## 완료한 범위

실제 검토·승인을 거친 네이티브 도면을 정확한 프로젝트·문서·개정·버전·캔버스·스냅샷 SHA로 조회하고, 기존 CAD 투영 및 ACadSharp 3.7.1 작성기로 실제 DWG를 생성했다. 브라우저가 제출한 도형이나 축척을 승인 원본으로 사용하지 않는다.

- 기존 공유 뷰와 DWG 입력이 동일한 엄격한 스냅샷 복원 함수를 사용한다.
- 읽기 전용 RPC는 현재 프로젝트 접근권한과 검증된 로그인, 승인 결정, 원본 해시, 보존 정책을 확인한다. Viewer의 원본 조회는 허용하지만 편집권한은 추가하지 않는다.
- PostgreSQL이 반환한 원래 `jsonb::text` 바이트를 먼저 해시 검증한다. 스냅샷 SHA, 투영 구조 SHA, 변환 입력 SHA, DWG SHA를 별도로 기록한다.
- 원본 없는 단일 페이지·캔버스와 저장된 출력 프로필만 이번 네이티브 경로에 들어간다. PDF/IFC 및 삭제된 연결 이력이 있는 문서, 추가 캔버스, 지원하지 않는 도형을 조용히 생략하지 않고 거절한다.
- 객체 계보, 페이지, 종류 및 이슈 연결을 별도 authority에 보존한다. 이 자료 자체는 서명된 승인 증명이나 배포 영수증이 아니다.

화면이나 운영 다운로드 버튼은 이번 단위에서 바꾸지 않았다. 라이브러리 추가, 원본 파일 수정, 원격 DB 변경, 커밋·푸시·배포도 하지 않았다.

## 검증 결과

| 검증 | 결과 | 범위 |
| --- | --- | --- |
| 집중 테스트 | 146 통과, 실패·건너뜀 0 | 원본 검증, 공유 회귀, CAD 투영, 고정 좌표·스타일 및 이슈 연결 순서 검증 |
| 실제 PostgreSQL | 5 통과, 실패 0 | M1 승인 원본, PDF 연결, 저장소 검증. 별도 설정 확인용 항목 2개만 조건부 건너뜀 |
| Chromium 브라우저 회귀 | 23 통과, 실패 0 | 빈 도면, 템플릿, PDF 업로드, IFC/PDF 연결, 수량, 승인·공유 |
| 타입 검사·빌드 | 통과 | React Router 타입 생성, TypeScript, 클라이언트·SSR, 협업 서버 |
| 실제 DWG 생성 | 내부 비교 통과 | AC1024, 13,003바이트, 모델 엔티티 19개, 블록 1개 |
| 원본 보존 | 통과 | 캡처한 SQL 응답 및 스냅샷 텍스트 불변, 원문 해시 일치 |

집중 테스트 명령은 앱 디렉터리에서 실행했다.

```sh
NODE_OPTIONS=--no-experimental-webstorage node --test tests/drawing-native-dwg-source.test.mjs tests/drawing-authority-snapshot.test.mjs tests/drawing-revision-share.test.mjs tests/drawing-revision-share-route.test.mjs tests/drawing-cad-projection.test.mjs
NODE_OPTIONS=--no-experimental-webstorage npm run test:e2e:drawing-workspace-m1:local
```

최종 146개 테스트는 독립 검토에서 요청한 수작업 좌표 fixture와 동일 이슈에 연결된 여러 객체의 정렬 회귀를 추가한 뒤 다시 실행했다. 마지막 운영 코드 수정은 이슈 목록에 객체 ID 정렬 기준을 추가한 한 곳이다. 이후 집중 테스트·타입 검사와 캡처한 실제 SQL 원본 재처리를 수행해 변환 입력·authority가 바이트 단위로 동일함을 확인했다. 전체 브라우저·DB·앱 빌드와 실제 DWG 생성은 이 작은 정렬 수정 전에 수행한 결과이며, 그 뒤 다시 실행한 것으로 계산하지 않는다.

최종 통합 검토는 Critical 0, Important 0, Minor 1이었다. 이슈 정렬 권고를 수정하고 범위를 한정한 재검토까지 통과해 열린 지적 사항은 없다. 빌드의 큰 청크 경고, 기존 마이그레이션 NOTICE, 색상 환경 경고 및 의도된 보호 경계 거절 로그는 남아 있다. 로그가 완전히 경고 없는 상태라는 뜻은 아니다.

권한 검증에는 실제 Editor → Reviewer → Approver 순서와 owner/editor/viewer 조회, 외부인·익명·권한 회수·미승인·잘못된 범위 거절을 포함했다. IFC 연결 검증은 유효한 외래키를 가진 의도적 승인 전 fixture로 수행했다. 페이지에만 배경을 넣는 상태는 기존 공개 경로에서 만들 수 없어, 테이블 ACL과 기존 보호 트리거의 거절을 각각 확인했다. 보호 트리거나 권한을 완화하지 않았다.

초기 DB 검증 세 번은 PUBLIC 의사역할 및 SQL 역할/JWT 사용자 컨텍스트를 잘못 설정한 테스트 오류로 실패했다. 테스트를 수정한 네 번째 실행과 후속 통합·전체 회귀가 통과했다. 앱 디렉터리가 아닌 저장소 루트에서 실행한 초기 helper 테스트도 경로 오류로 실패했으며, 올바른 디렉터리에서 재실행한 결과만 위 표에 포함했다.

## 실제 결과 파일

- [생성 DWG](/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-approved-native-dwg-source/writer/native.dwg)
- [원본·입력·출력 및 최종 구현 파일 해시 목록](/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-approved-native-dwg-source/hash-index-final.json)
- [연결 검증 결과](/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-approved-native-dwg-source/verification.json)
- [DWG 내부 재읽기 비교 보고서](/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-approved-native-dwg-source/writer/native-report.json)
- [최종 정렬 수정 후 원본 재처리 비교](/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/evidence/2026-09-06-approved-native-dwg-source/post-fix-replay.json)

이 디렉터리에는 원래 스냅샷 텍스트, 실제 SQL 응답, 요청 범위, authority 및 CAD 입력도 함께 보존했다. 생성 당시 해시 목록도 덮어쓰지 않고 보존하며, 최종 목록이 이 원래 목록과 후속 재처리 결과를 구분해 참조한다. 테스트 전용 무작위 식별자와 자체 템플릿이며 고객 파일이나 자격 증명은 포함하지 않는다. 해시 목록은 파일 바이트 검증 자료이지 독립 서명·운영 배포 증명이 아니다.

## 아직 완료하지 않은 필수 범위

이번 연결은 실제 SQL 함수 응답을 검사된 서버 어댑터 transport shim으로 전달한 결과다. PostgREST HTTP 전송과 운영 환경은 검증하지 않았다. DWG 검증도 같은 엔진의 작성·재읽기 비교이며, 수신자 CAD에서의 호환성을 증명하지 않는다. 결과물에는 `experimental-unqualified`, `not-qualified`, `not-performed` 표시를 유지한다.

다음 구현 순서는 요청별 멱등 변환 작업, 워커 임대·빌드 고정, 업로드 전 임시 산출물 등록, 덮어쓰기 없는 저장·재읽기, 불변 결과 기록·보존 정책, 권한 있는 상태 조회·다운로드다. 이후 기존 DWG 가져오기·편집·재저장, 레이아웃·글꼴·외부 참조 보존, 사용 권한이 확인된 실무 파일 및 독립 CAD 열기·저장·출력 검증을 완료해야 한다. 초안 내보내기도 명시적인 초안 표기와 함께 별도 지원해야 한다.

전체 제품 목표는 계속 진행 중이다. 이 자료는 승인 원본 연결 단위의 증거이며, 전체 DWG 납품 기능 완료 선언이 아니다.
