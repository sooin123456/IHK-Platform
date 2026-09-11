# 1HK 직접 도면 시작·이름 변경·DWG 엔진 시험 근거

작성일: 2026-09-05. 현재 목표는 활성 상태다. 이 문서는 해당 개발 단위의 근거이며 전체 제품 또는 DWG 납품 완료 선언이 아니다. 운영 DB 적용·배포·커밋은 수행하지 않았다.

## 구현 범위

- `/workspace`의 `새 도면`에서 빈 도면, 템플릿, 파일 가져오기를 시작한다. 빈 도면은 프로젝트명·연락처·원본 업로드 없이 기존 canonical 편집기로 진입한다.
- 서버가 로그인한 비익명 사용자만을 기준으로 개인 기본 프로젝트 `내 도면`을 확보한다. 추가된 private 매핑/RPC가 동시 호출과 재시도를 직렬화하며 기존 권한·quota·entitlement를 유지한다. GET은 생성하지 않는다.
- 같은 생성 요청은 같은 도면으로 돌아온다. 실패 시 요청 UUID와 생성 시각을 유지하며, 오류가 접힌 메뉴에 가려지지 않는다. 보관·삭제 요청·다른 조직으로 이동한 기본 프로젝트를 자동 복원하거나 대체하지 않는다.
- 최근 도면 목록은 실제 프로젝트/문서 ID로 연결한다. 기존 프로젝트 지정 생성과 이전 도면 목록은 계속 제공한다.
- 초안 작성자는 편집기에서 이름을 바꿀 수 있다. title만 조건부 UPDATE하고, 다른 사용자가 먼저 변경했다면 최신 이름을 다시 읽되 작성 중인 입력은 보존한다. 저장·취소 후 포커스를 돌려준다. 기존 240자 제목도 비교 대상으로 허용한다.
- Viewer와 비초안 이름 변경은 서버에서 거절한다. DB의 전체 이력 동결 조건과 원본/생성 식별자는 유지한다. 캔버스 재마운트나 별도 협업 상태 저장소는 추가하지 않았다.

새 스키마: `platform/supabase/migrations/20260905065400_personal_drawing_quick_start.sql`. 운영에 반영하려면 이 migration의 별도 검토·적용과 앱 배포가 필요하다. 현재는 격리 테스트 DB에만 적용했다.

## 검증 현황

| 검사 | 근거 |
|---|---|
| 기존 회귀 + 시작/이름/권한 테스트 | 최종 서버 경계 수정 후178/178 통과, skip0, 약2초 |
| 배포용 빌드 | 타입 검사·클라이언트·SSR·prerender 통과 |
| 실제 Postgres | 동시 기본 프로젝트 확보, title CAS, Viewer 차단, 검토 후 RLS/trigger 동결 검증 실행·통과 |
| 반응형 미리보기 | 최종 빌드 서버 재시작 후4/4 통과(16.4초). 데스크톱/태블릿/모바일, 키보드 열기, disabled 선택지 표시, POST/콘솔 오류/가로 넘침 없음 |
| 전체 M1 브라우저 회귀 | 최종22/22 통과, 2.5분. runner exit0, 일회용 환경 정리 완료 |
| 독립 교차 검토 | DB·진입 UI·이름 변경·브라우저 시나리오·CAD 시험 도구의 Important/Critical 지적 수정 후 승인 |
| DWG 도구 자체 검사 | root 재실행9/9 통과; .NET 빌드 warning0/error0 |

최종 M1은 새 도면 시작·동일 요청 재시도·최근 도면·서버 동시 이름 변경409/입력 보존/재시도/포커스/재접속·캔버스 DOM 유지와 저장 객체 동일성을 검증했다. 기존 PDF TUS 단절 복구/원본 SHA 보존, IFC/DXF 연결, 승인/수량/BOQ/자재 근거, 템플릿 복제, 세 사용자 협업/오프라인 outbox, Revit 경로도 기존 검사 그대로 통과했다. 추가한 두 시작 테스트는 공유 팀의 Editor 계정이 자기 개인 공간을 만드는 흐름으로 격리하여 기존 Owner 프로젝트 한도를 소모하지 않는다.

로컬 Apple M3 Max/Chromium151 기준10,000객체 첫 사용1,424.84ms, 조작 프레임p95 10.2ms였다. 공동 편집은 warm30표본p95 191.77ms다. 지정된 로컬 fixture/하드웨어 조건의 결과이며 운영 네트워크·모든 기기 성능 보장은 아니다. 재실행으로 test-results가 교체되어도 보존되도록 원시 데이터를 이 문서와 같은 이름의 하위 폴더에 `10k-performance.json`, `collaboration-reflection.json`으로 복사했다.

주요 재현 명령은 저장소 `platform` 기준이다.

```sh
node --test tests/drawing-workspace-entry-flow.test.mjs tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-modes.test.mjs tests/business-product-entry.test.mjs tests/public-site-contract.test.mjs tests/drawing-personal-project.test.mjs tests/drawing-workspace-m1-database.test.mjs tests/drawing-document-title.test.mjs
npm run test:e2e:drawing-workspace-m1:local
E2E_BASE_URL=http://127.0.0.1:4173 node_modules/.bin/playwright test e2e/business-workspace-entry.spec.ts --config=playwright.config.ts --project=chromium --workers=1 --reporter=line --output=../.superpowers/sdd/2026-09-05-direct-drawing-start/browser-results
```

첫 실패를 숨기지 않는다: 새 summary 선택자가 아이콘 앞뒤 공백을 고려하지 않았고, 새 DB 관찰 코드가 `object_type` 대신 없는 `kind` 열을 요청했다. 둘 다 실제 DOM/DDL 확인 후 테스트를 바로잡았다. 서버 action 테스트를 위한 비표준 route export가 client 빌드에 `.server` 의존성을 남긴 문제는 기존 서버 모듈로 이동해 수정했다. 새 시나리오와 기존 업로드 시나리오가 같은 계정의 프로젝트 한도를 함께 소모한 문제는 계정별 테스트 범위로 분리했다. 운영 quota를 바꾸거나 기존 검사 조건을 삭제하지 않았다.

미리보기는 dummy local 인증 환경이며 실제 로그인/저장 시험이 아니다. 실제 저장·권한·협업은 runner가 일회용 Auth/Postgres/Storage/Hocuspocus를 함께 준비하는 별도 환경에서 확인한다. 기존 theme-cookie 서명 안내, Node localStorage/색상 환경 경고, Vite 빈 route chunk/대형 번들 안내, 기존 migration NOTICE는 남아 있으며 무경고 빌드라고 주장하지 않는다. 예상한 이름 충돌409는 응답을 별도로 검증하고 해당 정확한 URL의 브라우저 resource409 로그만 허용한다.

## DWG: 시험 완료와 제품 지원의 구분

별도 `tools/dwg-engine-qualification/`에 ACadSharp3.7.1을 정확히 고정했다. 웹 앱 패키지나 운영 import/export 플래그는 바꾸지 않았다. 원저작 합성 AC1024 파일만 사용했고 고객 도면이나 라이선스 불명 샘플은 사용하지 않았다.

- 재저장 전후9개 객체, no-edit 및 line/text edit 비교 실패0.
- 입력/작업 사본/처리 후 원본 SHA-256: `257b8c994be7e0b6e3426b05802d33a710ca34e8374ae154d587a7469ffa6369`로 동일.
- 물리 경로·symlink 별칭·파일/디렉터리 출력 충돌 방어, bounded 실패 보고, 중복 handle 진단과 미검증 INSERT 속성 진단을 추가했다.
- 결과는 `passed-with-inventory-gaps`. 기본 VIEWPORT 의미 속성 공백과 TextStyle/TableStyle reader 경고가 남는다.
- `productionDwgDeliveryQualification=not-qualified`, `independentCadVerification=not-performed`를 항상 명시한다. 같은 엔진이 만든 파일을 같은 엔진으로 읽는 결과만으로 실제 CAD 납품을 보장하지 않는다.

도구 설명: `tools/dwg-engine-qualification/README.md`. 생성 근거: `tools/dwg-engine-qualification/artifacts/run-attribute-gap-final/qualification-report.json`; 보존 사본은 이 문서와 같은 이름의 하위 폴더 `dwg-qualification.json`이다. 정확한 라이선스/패키지/명령/검토 내역은 현재 SDD의 `task-3-report.md`에 기록했다.

## 남은 목표

1. 문서 표시 단위 선택: 현재 좌표·치수·PDF 보정·DXF 입력은 canonical mm다. 단위 선택은 저장 도형/계산 근거를 재스케일하지 않는 표현 설정으로 추가해야 한다.
2. 실무 네이티브 템플릿4종과 심볼20–40종: 기존 닫힌4개 starter의 row/hash/schema/RPC는 그대로 두고, 기존 그래프/라이브러리 복제 검증을 재사용하는 추가형 버전 권한이 필요하다.
3. DWG 납품: 허가된30파일 corpus, 독립 CAD 열기/저장/출력, 글꼴·SHX·Xref·layout·미지원 객체 검증, 고정 개정 기반 파생물 worker와 원본/객체/승인/물량 계보 연결이 남는다. 유료 엔진 계약은 체결하지 않았다.
4. 납품 패키지·실사용자 검증: 실제 사용자3명과 수신자 CAD 수용 여부는 합성 자동 테스트로 대체하지 않는다.

현재 승인 기획과 목표는 유지한다. 위 미완료 항목 때문에 전체 목표를 완료 처리하지 않는다.
