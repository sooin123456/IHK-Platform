# Lukas QTO 다음 제품 전략 — 증명 가능한 적산 원장

기준일: 2026-08-15  
목적: 현재 구현과 외부 제품·오픈소스를 비교해, 현장에서 반복 사용되는 다음 개발 순서를 확정한다.

## 1. 한 문장 제품 정의

**Lukas QTO는 Revit/IFC에서 추출한 물량이 내역, 설계 변경, 발주, 입고, 청구, 탄소 근거로 이어지는 과정을 요소 단위로 증명하는 한국형 적산 데이터 플랫폼이다.**

빠른 자동 인식만으로 Kreo와 경쟁하거나, 범용 현장관리 전체를 Procore처럼 만들지 않는다. AI는 마지막 단계의 추천 도구이고 수량·금액·승인은 결정론적 규칙과 사람이 확정한다.

## 2. 경쟁 제품에서 확인한 시장 방향

| 제품/표준 | 강점 | Lukas가 배울 점 | 그대로 만들지 않을 것 |
|---|---|---|---|
| [Autodesk Forma Takeoff](https://www.autodesk.com/products/forma-takeoff/overview) | 2D·3D 물량, 사용자 계산식, 공통 문서 환경 | 추출 범위·패키지·수량 인벤토리를 단순한 흐름으로 표시 | Autodesk CDE 전체 복제 |
| [RIB CostX](https://www.rib-software.com/en/rib-benchmark?redirect=exactal) | 도면/BIM-견적 live link, revision, 보고서, 탄소 | 변경 전후 물량·금액·탄소가 동시에 닫히는 비교표 | 범용 스프레드시트 엔진 재개발 |
| [Kreo API](https://help-takeoff.kreo.net/en/articles/11688710-getting-started-with-the-kreo-api) | 2D AI 인식 결과를 API로 제공 | AI 결과도 좌표·치수·버전이 있는 독립 제안으로 저장 | 초기 단계에서 2D AI 모델 직접 개발 |
| [Procore Estimating](https://www.procore.com/estimating) | 견적→입찰→계약·재무 연결 | 적산 결과가 다음 업무로 끊기지 않는 handoff | 프로젝트 관리 전체 제품군 |
| [Kojo](https://www.usekojo.com/) | 현장 요청, PO, 입고표, 송장 3-way match | 모바일 입고 확인과 PO-입고-청구 차이 | 재고·공구·회계 ERP 전체 |
| [EC3](https://www.buildingtransparency.org/tools/ec3/) | BIM/견적 수량과 제품 EPD를 구매 결정에 연결 | 제품별 EPD와 일반 계수의 신뢰도를 분리 | 자체 글로벌 EPD 데이터베이스 |
| 산군 | 기업·현장·수요·원가 빅데이터 | 외부 시장/업체 정보는 API·제휴 데이터로 결합 | 기업 신용·수주 DB 직접 수집 사업 |

### 시장의 공통 이동 방향

1. 단일 물량표보다 `원본 설계 → 수량 → 비용 → 변경 → 구매`의 연결이 중요해지고 있다.
2. 완전 자동화보다 사용자가 수정·승인하고 감사 이력을 남기는 구조가 실무 도입에 유리하다.
3. 탄소는 설계단계의 일반계수에서 구매단계의 제품 EPD로 이동한다.
4. BIM 이슈는 독자 형식보다 IDS·BCF·bSDD 같은 개방형 표준으로 주고받아야 한다.
5. 건설제품의 디지털 제품 여권과 추적성은 BIM과 호환되는 방향으로 제도화되고 있다. [EU CPR DPP 타당성 연구](https://op.europa.eu/en/publication-detail/-/publication/cf329d5e-3464-11f0-8a44-01aa75ed71a1/language-en)

## 3. GitHub·개방형 생태계 활용 원칙

| 자산 | 활용 결정 | 이유/주의 |
|---|---|---|
| [buildingSMART IDS 1.0](https://github.com/buildingSMART/IDS/releases) | **표준과 공식 테스트 케이스 채택** | 250개 이상의 테스트 쌍을 구현 회귀에 활용. 자체 IDS 방언 금지 |
| [buildingSMART BCF API](https://github.com/buildingSMART/BCF-API) | **BCF 2.1 파일 우선, 3.0 API 후속** | 검산 실패를 설계자에게 되돌리는 표준 이슈 포맷 |
| [buildingSMART bSDD](https://github.com/buildingSMART/bSDD) | **분류 URI·버전 보존, 조회 adapter** | 사내 공종코드와 국제 분류를 이름이 아니라 ID로 연결 |
| [IfcOpenShell/IfcTester](https://github.com/IfcOpenShell/IfcOpenShell) | **별도 검증 서비스 후보** | IDS/IFC 검증 기능이 성숙했지만 LGPL/GPL 라이선스와 네이티브 배포를 검토해야 함. 소스 복사 금지 |
| [Speckle Server](https://github.com/specklesystems/speckle-server) | **아키텍처 참고만** | 버전 객체 그래프·webhook은 참고하되 대형 서버 전체를 복제하지 않음 |
| [openEPD](https://github.com/cchangelabs/openepd) | **EPD 교환 형식 adapter** | EPD·PCR·조직·공장·버전 식별을 구조화. PDF 숫자 수동 복사 최소화 |

### 직접 만들어야 하는 핵심

- Revit 공식 API 기반 요소 원장과 실제 설치 호환성
- 한국 적산 내역·공종·규격 매핑 및 승인 규칙
- 수량과 계산식, 원본 셀/요소, 승인자의 역추적
- 설계 변경이 수량·금액·발주에 미친 영향의 결정론적 비교
- 한국 현장용 PO·입고·청구·반품·폐기 증빙 흐름

## 4. Lukas의 특장점

### 4.1 숫자의 출처를 다시 찾을 수 있다

수량 한 줄에 Revit Element ID, IFC GlobalId, 추출 범위, Revit build, 파일 원본 확인값, 계산 규칙과 승인 이력을 연결한다. 사용자는 복잡한 SHA-256 대신 UI에서 **원본 일치 확인**, **변경 감지**, **근거 열기**로 이해한다.

### 4.2 모르는 값을 통과시키지 않는다

데이터 누락이나 승인 규칙 부재는 0이나 PASS로 꾸미지 않고 `검토 필요`로 남긴다. 이는 자동화율보다 허위 확정을 줄이는 제품 전략이다.

### 4.3 국내 실무 자료를 이미 검증 자산으로 가진다

꿈푸른 유치원 EMS·ZG·ZJ·Revit 자료와 실제 Windows 현장 피드백은 일반 IFC 데모보다 강한 회귀 자산이다. 각 현장 오류를 익명 fixture로 축적하면 경쟁사가 단기간에 복제하기 어려운 품질 데이터가 된다.

### 4.4 적산에서 구매·탄소까지 같은 수량을 사용한다

견적 수량을 다시 입력하지 않고 `승인 물량 → 자재계획 → 발주 → 입고 → 청구 → 제품 EPD → 탄소`로 연결한다. 설계 예상과 실제 구매·사용 차이가 닫히는 것이 장기 해자다.

## 5. 지속 개발 우선순위

### P0 — 설치·추출 신뢰성 및 운영 보안

1. Revit 2025 세부 build별 설치/리본/추출 호환 매트릭스 자동 기록
2. 선택 요소·현재 뷰·전체 모델 범위와 링크 제외 수를 결과 첫 화면에 표시
3. Windows 진단 번들을 사용자가 한 번에 생성·업로드하는 흐름
4. 웹 의존성 보안, Supabase RLS, Storage 권한, FK 인덱스, 실제 비소유자 접근 테스트
5. Node 22+, TypeScript 5+, 신규 public table의 명시적 Data API GRANT 적용

**완료 기준:** 설치 성공이 아니라 실제 모델에서 요소 원장과 증거 JSON이 생성되고, 동일 파일 재검증과 비소유자 차단이 통과한다.

### P1 — 승인 물량에서 현장 자재까지

1. 승인된 콘크리트 산출 artifact에서 자재계획 자동 생성
2. 구매 요청→PO→입고→청구의 3-way match
3. 설치·반품·폐기 이벤트와 사진/PDF 증빙
4. 계획/발주/입고/청구/사용 차이와 이유 코드
5. 현장 모바일 화면은 `입고 확인`, `수량 차이`, `사진 첨부` 세 동작부터 시작

**완료 기준:** 실제 3개 프로젝트에서 승인 수량과 입고·청구가 한 재료코드로 닫힌다.

### P2 — 정보 품질 표준

1. IDS 1.0 등록·검사 및 공식 테스트 케이스 회귀
2. 실패 요소를 BCF 2.1 issue로 내보내 Revit/설계자에게 반환
3. 사내 공종코드에 bSDD/분류 namespace·code·version 연결
4. IFC GlobalId↔Revit Element ID는 증거가 있을 때만 확정, 나머지는 검토 필요

**완료 기준:** “필수 속성 누락”이 CSV 메시지로 끝나지 않고 해당 BIM 요소가 선택되는 BCF로 전달된다.

### P3 — 제품 EPD와 자재 추적

1. 일반 탄소계수와 제품별 EPD를 명확히 분리
2. openEPD ID, PCR, 프로그램 운영자, 검증자, 지역, 유효기간, 선언단위 보존
3. 주문·입고·설치·반품·폐기 사건을 append-only 원장으로 저장
4. 제품별 EPD 적용률과 미확정 탄소량을 별도 KPI로 표시
5. 장기적으로 건설제품 디지털 여권 export adapter 추가

**완료 기준:** “탄소 총량”만 보여주지 않고 어떤 제품 EPD가 몇 %를 설명하는지 증명한다.

### P4 — 조직·승인·외부 연동

1. 회사/프로젝트 멤버와 `적산·검토·현장·구매·관리자` 역할
2. 작성자와 승인자 분리, 승인 후 원본 변경 시 자동 무효화
3. 무료 다운로드 entitlement와 감사 로그
4. ERP용 안정 CSV와 webhook outbox
5. 외부 API는 원본 파일이 아닌 최소 권한의 승인 결과부터 공개

**완료 기준:** 동일 사용자가 작성과 최종 승인을 우회할 수 없고, 다른 회사 데이터는 RLS에서 차단된다.

### P5 — AI는 제안으로만 추가

1. AI 출력은 immutable JSON 제안이며 수량·금액·승인 필드를 가질 수 없음
2. 공종 분류·내역 매핑·누락·중복·이상치·개정 설명만 추천
3. 채택/보류/기각과 수정 내용을 학습 데이터로 축적
4. producer/version별 정확도·검토시간·표본수를 평가
5. 표본이 적거나 프로젝트 범위가 다르면 자동 승격 금지

**완료 기준:** AI를 끄더라도 추출·계산·승인·감사 전체가 동일하게 작동한다.

## 6. Supabase 제품 구조

```text
Auth / Organization RLS
        ↓
Project ─ Source files (private Storage, immutable identity)
        ├─ Model elements / quantity artifacts / revision graph
        ├─ IDS findings / BCF issues / human approvals
        ├─ Material plan / PO / receipt / invoice / site events
        └─ EPD references / carbon results / exports
```

운영 원칙:

- `public` 테이블은 모두 RLS를 켜고 `anon/authenticated` 권한을 명시한다.
- 권한은 사용자가 바꿀 수 있는 `user_metadata`가 아니라 조직 멤버 테이블과 서버 통제 값으로 판정한다.
- 원본 파일은 private Storage에 두며 브라우저에 service role을 노출하지 않는다.
- 업무 사건은 수정 덮어쓰기보다 취소·정정 사건을 추가하는 append-only 방식으로 저장한다.
- Realtime은 화면 갱신용이고 최종 판정은 Postgres 제약·함수·RLS가 담당한다.
- 신규 테이블은 2026 Data API 변경에 맞춰 명시적 `GRANT`를 포함한다.
- Supabase 최신 요구에 맞춰 Node.js 22 이상과 TypeScript 5 이상을 유지한다.

## 7. 하지 않을 것

- SHA-256을 블록체인이나 영지식 증명으로 홍보하지 않는다. 현재 기능은 **파일 원본 일치 확인**이다.
- 원본 근거 없이 IFC 형상에서 모든 공종의 최종 적산량을 추정하지 않는다.
- Kreo와 같은 2D AI 인식 모델을 P0–P4보다 먼저 개발하지 않는다.
- Speckle·Procore·ERP 전체를 복제하지 않는다.
- 승인되지 않은 단가·할증·공제·탄소계수를 코드에 몰래 내장하지 않는다.

## 8. 12개월 제품 순서

| 기간 | 출시 단위 | 고객이 얻는 결과 |
|---|---|---|
| 0–2개월 | P0 추출 신뢰성 + 보안 마감 | 설치/추출 실패를 진단하고 원본 일치를 증명 |
| 2–4개월 | P1 콘크리트 폐쇄루프 | 모델 수량에서 입고·청구 차이까지 확인 |
| 4–6개월 | P2 IDS/BCF | 누락 속성을 설계자에게 요소 단위로 반환 |
| 6–9개월 | P3 EPD/현장 사건 | 실제 구매 제품의 탄소와 자재 흐름 증명 |
| 9–11개월 | P4 조직/승인/API | 여러 회사·역할이 안전하게 협업 |
| 11–12개월 | P5 AI 제안 pilot | 반복 분류·매핑 검토시간 단축 |

## 9. 제품 KPI

- 승인 수량 중 Revit/IFC 요소 근거가 연결된 비율
- 내역 금액 중 계산 규칙과 원본 셀이 연결된 비율
- 설계 개정 후 재검증 완료 시간
- PO-입고-청구 수량·금액 불일치율
- 실제 구매량 중 제품별 EPD로 설명되는 비율
- 자동 PASS가 아니라 `검토 필요 → 승인/기각`으로 닫힌 비율과 소요시간
- Windows/Revit build별 추출 성공률

핵심 North Star는 **“최종 금액 중 모델 요소부터 현장 증빙까지 양방향으로 추적 가능한 비율”**이다.

## 10. 다음 구현 스프린트

1. P0 보안·의존성·Supabase advisor 잔여 항목을 닫는다.
2. 승인된 concrete takeoff artifact→material plan의 idempotent import를 구현한다.
3. 조직/프로젝트 역할 스키마를 먼저 설계해 이후 IDS·자재·승인 테이블이 같은 권한 모델을 쓰게 한다.
4. IDS 1.0 parser는 공식 XSD와 test corpus를 기준으로 별도 adapter로 구현한다.
5. BCF 2.1 export는 IDS 실패 요소의 GlobalId/Element ID/설명/관점을 포함한다.
6. 현장 입고 UI는 모바일 단일 화면으로 pilot하고, ERP와 AI는 그 뒤에 연결한다.

## 11. 운영 Supabase 현재 진단

- 운영 `lua_Main`에는 조직·프로젝트 역할, 승인 takeoff 자재계획, 현장 사건,
  EPD provenance, 요소–IFC–분류 연결, 무료 entitlement·다운로드 감사까지 적용돼 있다.
- SECURITY DEFINER 권한 helper는 Data API에 노출되지 않는 `private` schema로
  이동했고 anon 실행권한을 제거했다. 보안 Advisor의 코드 관련 경고는 0건이다.
- 성능 Advisor의 unindexed FK, auth init-plan, multiple permissive policy WARN은
  0건이다. 초기 운영에서 아직 사용되지 않은 index 정보는 삭제하지 않는다.
- 남은 외부 보안 경고 1건은 Supabase Auth Dashboard의 유출 비밀번호 차단
  기능이다. [설정 안내](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- 다음 우선순위는 새 기반 구축이 아니라 **실제 Windows/Revit build 검증,
  3개 현장 폐쇄루프, IDS/BCF 상호운용 증거**다.
