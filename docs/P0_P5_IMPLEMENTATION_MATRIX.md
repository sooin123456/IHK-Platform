# Lukas QTO P0–P5 구현 매트릭스

기준일: 2026-08-15

판정 원칙: 코드·운영 Supabase·자동 테스트가 모두 확인된 기능만 `완료`로 쓴다.
Windows/Revit 실기와 3개 현장 적용은 코드 완료와 분리된 외부 게이트다. 외부
모델 제안은 기본 비활성인 한길 담당자 전용 파일럿에서만 가져올 수 있고, 고객
화면의 자동 실행·자동 판정·수량 계산에는 연결되지 않는다.

## Drawing Workspace P0/P1 추가 범위 (2026-08-24)

| 요구사항            | 구현 증거                                                                                                                                     | 상태                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 편집 코어           | PDF/빈 배경, 6개 도구, 선택·이동·복사·삭제, undo/redo, 레이어·속성 검사기 계약 테스트                                                         | 코드 완료 / 로컬 자동 검증       |
| 저장·복구           | append-only operation RPC와 IndexedDB outbox의 ack·충돌·재시도·재로그인 복구 계약                                                             | 코드 완료 / 로컬 자동 검증       |
| 이슈·검토·승인      | 기존 이슈 객체 연결, maker-checker 검토 요청, 별도 Reviewer 승인, 승인 후 변경 차단                                                           | 코드 완료 / 운영 E2E 외부 게이트 |
| 권한·격리           | Viewer 변경 UI 부재와 RPC 거부, non-member route·read API·RPC 거부                                                                            | 코드 완료 / 운영 E2E 외부 게이트 |
| 원본 불변성         | fixture가 PDF/IFC 파일 행 SHA-256과 Storage 다운로드 바이트의 Node SHA-256·크기를 작업 전후 정확히 비교                                       | 코드 완료 / 운영 E2E 미실행      |
| 10,000 객체         | Chromium 1440×900에서 실제 wheel 60 + drag-pan 60 프레임과 실제 선택의 viewport·inspector 변화 및 median/p95 측정; P0/P1 p95 50ms 파국 방지선 | 코드 완료 / 운영 성능 미실행     |
| P3 실시간 공동 편집 | Yjs, y-indexeddb, Hocuspocus와 두 브라우저 live cursor/concurrent sync                                                                        | 미구현 / P3 외부 게이트          |

`완료`는 production Playwright 실행을 뜻하지 않는다. 운영 자격 증명과 격리된
대상 환경이 없으면 `test:e2e:drawing-workspace:production`은 `unexecuted`로
기록한다. 10,000 객체 60fps는 P7 목표이며 P0/P1에서 달성으로 표시하지 않는다.

## Drawing Workspace P2 완료 게이트 (2026-08-26)

| 범위                             | implemented                                                                                        | locally executed                                                  | production unexecuted                                    | measured target                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 12개 P2 기능·권한·migration 계약 | 예: production spec과 PGlite/source contract 구현                                                  | 예: Task 11 보고서의 로컬 계약·전체 Node·IFC·typecheck·build 근거 | 예: 실제 4개 운영 변수가 없는 세션에서는 미실행          | 해당 없음                                                                                     |
| 결정론적 성능 fixture            | 예: canvas 20, object 10,000, block instance 1,000, style 20, property schema/value 각 20, table 5 | 예: 로컬 fixture 구성·active-canvas slice 계약                    | 예: credentialed Chromium 측정 미실행                    | 미판정: first usable <=2.5s, 60fps, switch p95 <=250ms, export <=30s는 운영 측정 전 PASS 아님 |
| P2 release runbook               | 예: preflight·backup·migration·typegen·preview·promotion·rollback 경계 문서화                      | 예: 로컬 명령 결과는 Task 11 보고서에 개별 기록                   | 예: production Playwright와 실제 promotion evidence 없음 | 미판정                                                                                        |

`implemented`, `locally executed`, `production unexecuted`, `measured target`은
서로 대체할 수 없는 별도 상태다. 특히 로컬 계약 통과는 운영 실행이나 성능 목표
달성을 뜻하지 않는다. P3 realtime/Yjs는 이 P2 범위에서 구현되지 않았다.

## P0 — 보안·운영 기반

| 요구사항              | 구현 증거                                                                                           | 상태                      |
| --------------------- | --------------------------------------------------------------------------------------------------- | ------------------------- |
| 웹 의존성·빌드        | React Router 7.18.2, Supabase JS 2.112.3 등 고정; production high/critical 0; production build PASS | 완료                      |
| Supabase RLS·Data API | 모든 신규 public table RLS, authenticated/service_role 명시 grant, anon 차단                        | 완료                      |
| 권한 helper 노출 차단 | SECURITY DEFINER helper를 비노출 `private` schema로 이동, anon 실행권한 제거                        | 완료                      |
| Advisor               | 보안 경고는 Dashboard에서 켜야 하는 유출 비밀번호 보호 1건만 잔존; 성능 WARN 0                      | 코드 완료 / 운영 설정 1건 |
| 설치·추출             | Revit 2025 진단·Properties 범위·증거 JSON·Element 원장 구현                                         | 완료                      |
| 실제 Windows/Revit    | 세부 2025 build, 실제 Ribbon/IFC 재개방                                                             | 외부 게이트               |

## P1 — 승인 물량에서 현장 자재까지

| 요구사항              | 구현 증거                                                                             | 상태        |
| --------------------- | ------------------------------------------------------------------------------------- | ----------- |
| 승인 takeoff→자재계획 | PASS TAKEOFF만 6자리 고정소수점으로 규격별 합산, 이중 할증 금지, idempotent DB unique | 완료        |
| 최신 승인 판정        | append-only `decision_sequence`로 승인 후 기각도 정확히 반영                          | 완료        |
| 발주·입고·청구        | 발주 연결, 수량×단가, 증빙 확인번호, 차이 finding                                     | 완료        |
| 설치·반품·폐기        | append-only 현장 사건, 담당자·위치·증빙 필수                                          | 완료        |
| CSV·탄소              | 계획/발주/입고/설치/반품/폐기/청구, 제품 EPD·비제품 계수·미확정 건수를 분리 export    | 완료        |
| 실제 3개 현장         | 승인수량–입고–청구 폐쇄루프 기록                                                      | 외부 게이트 |

## P2 — 정보 요구·분류 표준

| 요구사항           | 구현 증거                                                                         | 상태             |
| ------------------ | --------------------------------------------------------------------------------- | ---------------- |
| IDS 검사           | IDS 1.0 XML을 strict parse하고 현재 Element 원장이 증명 가능한 속성만 판정        | 최소 기능 완료   |
| BCF 반환           | FAIL·REVIEW만 BCF 2.1 zip으로 결정론적 export                                     | 최소 기능 완료   |
| 분류 ID            | namespace·code·version·label을 보존하는 연결 테이블과 UI                          | 완료             |
| Revit↔IFC 연결    | Element ID가 원장에 1회, GlobalId가 IFC entity 첫 ID로 존재할 때만 사람 확인 기록 | 완료             |
| 공식 IDS 전체 호환 | buildingSMART 공식 corpus 전체와 BCF viewpoint round-trip                         | 후속 표준 게이트 |

## P3 — 제품 EPD와 자재 추적

| 요구사항      | 구현 증거                                                         | 상태      |
| ------------- | ----------------------------------------------------------------- | --------- |
| 제품 EPD 근거 | 제조사·운영자·선언번호·검증자·PCR·유효기간 필수                   | 완료      |
| 일반계수 분리 | product_epd / industry_average / generic 별도 보존                | 완료      |
| 사건 원장     | 주문·입고·설치·반품·폐기·청구 append-only                         | 완료      |
| 탄소 커버리지 | 제품 EPD 적용행, 일반계수 적용행, 미확정행을 각각 계산·CSV export | 완료      |
| 외부 EPD/DPP  | openEPD 조회·EU DPP export adapter                                | 후속 연동 |

## P4 — 조직·역할·무료 배포

| 요구사항           | 구현 증거                                                                                    | 상태           |
| ------------------ | -------------------------------------------------------------------------------------------- | -------------- |
| 조직·프로젝트 역할 | owner/estimator/reviewer/site/procurement/viewer 및 구성원 UI                                | 완료           |
| 역할 분리          | 적산 계획, 검토 승인, 현장 사건, 구매·EPD를 DB RLS로 분리하고 산출 등록자=최종 승인자를 거부 | 완료           |
| 무료 이용권        | 로그인 사용자의 free/active entitlement와 다운로드 감사 사건                                 | 완료           |
| 비로그인 무료 배포 | 기존 공개 다운로드 유지; 같은 서버 redirect가 안전한 HTTPS·공식 확인번호를 검증              | 완료           |
| ERP 연동           | 버전 고정 material-control CSV                                                               | 최소 기능 완료 |
| Webhook/API        | 승인 결과 전용 outbox·partner API                                                            | 후속 연동      |

## P5 — AI는 마지막, 제안으로만

| 요구사항           | 구현 증거                                                                                                          | 상태                      |
| ------------------ | ------------------------------------------------------------------------------------------------------------------ | ------------------------- |
| 결정론적 규칙 검토 | ELEMENT_LEDGER_REVIEW_V2: 원장 오류와 Element ID 개정 차이, 체적·길이·높이의 exact-decimal 증감 및 사람 결정       | 완료                      |
| 외부 제안 안전계약 | 원본·payload hash, 실제 원본 재해시, evidence 위치 필수; 수량·금액·상태·승인 key 재귀 거부                         | 완료                      |
| 운영 화면          | `LUKAS_ENABLE_AI_PILOT=false` 기본값, `hangil_staff` 전용 import-only 파일럿. 웹앱 안에서 모델 API를 호출하지 않음 | 파일럿 완료 / 기본 비활성 |
| 사람 피드백        | append-only 결정 순서, 생산자·제안종류별 승인/기각/보류·검토시간 집계, 30건 미만 표본 부족 표시                    | 완료                      |
| 권한 경계          | 외부 제안은 최종 수량·금액·상태·승인 필드를 가질 수 없고 자동 승격 기능 없음                                       | 완료                      |
| 고객 출시          | 실제 표본 30건 이상, 법무·개인정보·정확도 기준 승인 후 별도 feature flag                                           | 외부 게이트               |

## 자동 검증 결과

- 웹 typecheck, production build: PASS
- 공개 사이트 계약: 10/10 PASS
- 도메인 계약: 19/19 PASS
- 운영 Supabase migration: P0–P5 기반 15개 추가 migration 적용
- 운영 RLS 반례: 본인 entitlement/event 1건, 타인 entitlement 노출 0건
- Supabase security advisor: 코드 관련 경고 0, Auth Dashboard 설정 1건
- Supabase performance advisor: WARN 0 (unused index 정보는 초기 운영량에서는 유지)

## 아직 완료라고 부르면 안 되는 것

1. 실제 Windows/Revit 2025 세부 build별 현장 설치·추출 재검증
2. 실제 3개 프로젝트의 자재 발주–입고–청구 폐쇄루프
3. IDS 공식 전체 corpus와 BCF viewpoint 상호운용
4. openEPD/DPP 및 ERP partner 연동
5. 외부 제안 파일럿의 실제 검토 표본 30건 이상과 고객 기능 출시 승인
