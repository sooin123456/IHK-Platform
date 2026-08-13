# Lukas QTO 실제 제품 구현 기획

기준일: 2026-08-13  
사용자: 설계·BIM·견적 실무자 Lukas  
제품명: **Lukas QTO** (`THEKIE.Qto`는 기존 DLL·네임스페이스 호환용 식별자)

## 0. 제품 우선순위 결정

현장 사용자 피드백에 따라 Lukas QTO의 본체를 **근거 검산기**가 아니라
**실무 적산 물량추출 엔진**으로 고정한다. 검산·해시·리비전 비교는 추출
결과를 신뢰하고 수정하기 위한 검증 계층이다.

우선순위는 다음과 같다.

1. Revit 요소와 형상에서 부재별 정미량을 추출한다.
2. 공제·할증·손율·반올림이 명시된 공종별 규칙을 적용한다.
3. 공법에 따라 주재료와 부속재료를 분리한다.
4. 실무 내역 품목으로 집계한다.
5. 모든 결과를 계산식·규칙 버전·원본 셀·Revit 요소ID까지 역추적한다.
6. 기존 ZG·ZJ·EMS 결과 및 이전 리비전과 대조한다.

첫 승인 규칙 세트는 제공된 꿈푸른 유치원 자료를 근거로 만든다. 이를
국가 표준 전체나 모든 현장에 적용되는 보편 규칙이라고 주장하지 않는다.
ZG와 ZJ처럼 결과가 충돌하면 임의로 하나를 선택하지 않고 scope·층·부재·
재료·공제·할증 단계별 차이를 닫힌 합계로 설명한다.

첫 구현 공종은 다음 순서로 제한한다.

- 콘크리트: 막자갈, 무근콘크리트, 철근콘크리트의 정미량·공제·할증
- 거푸집: 부재 외피 face의 실제 접촉면, 개구부·부재 접촉면 공제
- 철근: 규격별 길이, 단위중량, 이음·정착·손율, 승인 중량표 대조

규칙 근거가 없거나 모델 정보가 부족하면 `0` 또는 추정값을 만들지 않고
`REVIEW` 또는 `NOT_EVALUATED`로 남긴다.

## 1. 제품 정의

Lukas QTO는 하나의 Windows 제품 안에서 세 작업을 이어 준다.

1. **실무 물량산출**: Revit 요소·형상과 승인된 공종 규칙으로 적산 물량과 재료를 계산한다.
2. **모델 전달 패키지 생성**: Revit 모델에서 IFC와 근거가 남는 QTO CSV를 같은 실행으로 내보낸다.
3. **QTO·내역 검산**: 산출 결과, 내역서, 사람이 승인한 매핑을 결정론적 계산식으로 검사하고 원본 행과 Revit 요소ID가 남는 보고서를 만든다.

세 기능은 독립 실행도 가능해야 한다. 단순 전달은 IFC·기초 QTO만 만들고,
적산 담당자는 공종별 규칙을 적용하며, 기존 QTO가 있는 견적 검토자는 검산에
바로 넣을 수 있다. 기능을 하나의 서버에 억지로 묶지 않는다.

### 실제 제품의 1차 형태

- Revit 내부: `Lukas QTO` 리본의 **IFC·QTO 내보내기**
- Revit 밖: 설치형 **Lukas QTO 검산기**
- 전달 단위: 서버 업로드가 아닌 로컬 프로젝트 폴더와 결과 ZIP
- 계산: 기존 `THEKIE.Qto.Core`를 양쪽에서 재사용

웹 데모는 제품 소개용이다. 파일 처리, 판정, 재검산의 운영 원본은 Windows 프로그램이 맡는다.

## 2. 이번 범위에서 하지 않는 것

Ponytail 원칙에 따라 실제 사용 증거가 생기기 전에는 다음을 만들지 않는다.

- 계정, 조직, 결제, 클라우드 DB, 협업 댓글, 실시간 동기화
- 모델 뷰어와 자체 IFC 파서
- AI 자동 매핑과 AI 숫자 판정
- 표준품셈·시장단가 DB 및 L2 적정성 판정
- Revit 요소와 IFC 객체의 범용 양방향 매핑

1차 제품에서 IFC는 **Revit이 공식 Export API로 만든 납품 파일**이고, 상세
적산은 원본 Revit API에서 요소·형상 근거를 보존하며 수행한다. 같은 문서에서
생성된 IFC·기초 QTO·상세 산출 ledger는 manifest와 SHA-256으로 결합한다. 임의의
외부 IFC만으로 동일 수준의 상세 적산을 재생성하는 기능은 별도 IFC fixture와
property-set 계약을 확보한 뒤 확장한다.

## 3. 사용자 흐름

### A. IFC·QTO 내보내기

1. 사용자가 Revit에서 검토할 모델을 연다.
2. `Lukas QTO > IFC·QTO 내보내기`를 누른다.
3. 저장 폴더와 패키지 이름을 선택한다. 1차 버전은 Revit의 기본 `IFCExportOptions`를 사용하고 그 사실을 manifest에 기록한다.
4. 프로그램이 IFC를 내보내고, 같은 문서 상태에서 QTO를 집계한다.
5. `model.ifc`, `qto.csv`, `export-manifest.csv`가 모두 성공한 경우에만 완료로 표시한다.
6. 사용자는 폴더를 협업자에게 전달하거나 바로 검산기에서 연다.

내보내는 동안에는 최종 폴더가 아닌 같은 위치의 `.partial` 폴더를 사용한다. 세 파일을 검증한 뒤에만 최종 폴더명으로 바꾼다. 실패하면 최종 폴더를 만들지 않고 `.partial`의 manifest를 `FAILED`로 남겨 원인을 확인하게 한다.

### B. QTO·내역 검산

1. 사용자가 검산기에서 새 프로젝트 폴더를 만든다.
2. QTO 또는 A에서 생성된 `export-manifest.csv`, 내역 CSV/XLSX, 승인 매핑 CSV/XLSX를 선택한다.
3. 프로그램이 파일 SHA, slot, scope, 최신 ACTIVE 개정을 먼저 검사한다.
4. 소스 게이트가 통과하면 R010~R030을 실행한다.
5. 사용자는 `FAIL`, `REVIEW`, `NOT_EVALUATED`를 우선순위로 확인한다.
6. 항목을 누르면 계산식, 기대값, 원본값, 차이, 원본 행과 요소ID를 본다.
7. 원본 파일을 수정한 뒤 새 개정으로 등록하고 **같은 규칙**으로 재검산한다.
8. 결과 CSV, 단일 HTML, 실행 manifest를 같은 결과 폴더에 보관한다.

재검산은 상태 버튼이 아니다. 수정된 입력의 새 SHA를 등록하고 전체 규칙을 다시 실행한 결과만 새 판정으로 인정한다.

## 4. 모듈 경계

기존 구현을 재사용하고, 한 구현만 있는 인터페이스나 별도 서비스 계층은 만들지 않는다.

| 모듈 | 책임 | 금지 |
|---|---|---|
| `THEKIE.Qto` Revit Add-in | 활성 문서 접근, IFC Export API 호출, QTO 추출, 파일 저장, Revit UI | 내역 검산·금액 판정 |
| `THEKIE.Qto.Core` | CSV/XLSX 입력, 소스 게이트, 계산 규칙, 보고서·manifest 생성 | Revit API·화면·네트워크 |
| `THEKIE.Qto.Preflight` | 자동화와 장애 진단을 위한 기존 CLI | 별도 계산식 복제 |
| `Lukas.Qto.Desktop` 신규 | 파일 선택, 프로젝트 상태 표시, Core 실행, 결과 탐색·재검산 | 계산식 재구현·DB |
| `deploy` | 버전별 빌드, 설치, 무결성 표식, 롤백 | 스텁 산출물 설치 |

Desktop은 Core를 프로세스 내부에서 호출한다. CLI 출력을 화면에서 다시 파싱하거나 로컬 HTTP 서버를 띄우지 않는다. UI는 별도 패키지 없는 .NET 8 WPF로 만들고 기본 `DataGrid`와 상세 패널만 쓴다. 새 UI 프레임워크는 실제 요구가 WPF 기본 기능으로 불가능할 때만 도입한다.

## 5. 입출력 계약

### 5.1 내보내기 패키지

```text
<프로젝트명>_<yyyyMMdd_HHmmss>/
  model.ifc
  qto.csv
  element-ledger.csv
  export-manifest.csv
```

`qto.csv`는 [CSV 계약](CSV_CONTRACT.md)의 기존 열을 그대로 사용한다.

```text
검산키,분류,패밀리,타입,레벨,수량,체적_m3,면적_m2,길이_m,요소ID
```

`element-ledger.csv` V2는 요소 하나당 한 행이며, 다음 15열을 정확히 사용한다. 이는 첫 공개 기능인 `Properties 추출`의 독립 CSV이면서 IFC·QTO 패키지에도 동일하게 포함된다.

```text
element_id,category,family,type,element_name,level,
volume_state,volume_m3,volume_source_parameter,
length_state,length_m,length_source_parameter,
height_state,height_m,height_source_parameter
```

각 measurement 상태는 `COMPUTED`, `ZERO`, `MISSING` 중 하나다. `MISSING`에는 값이나 source parameter를 채우지 않으며, 누락값을 추정하거나 bounding box로 대체하지 않는다.

`export-manifest.csv`의 1차 필수 필드는 다음으로 고정한다.

```text
product_version,exported_at_utc,revit_version,document_title,
ifc_configuration,ifc_file,ifc_sha256,qto_file,qto_sha256,
qto_row_count,element_count,element_ledger_file,element_ledger_sha256,element_ledger_row_count,status,failure_reason
```

- 시간은 UTC ISO 8601이다.
- 경로는 패키지 루트 기준 상대경로다.
- IFC와 QTO를 모두 쓴 뒤 각 파일을 다시 읽어 SHA-256을 계산한다.
- `status=COMPLETE`는 IFC·QTO·요소별 원장 존재, 해시 일치, QTO가 1행 이상이고 QTO와 원장의 요소ID 집합·개수가 정확히 같을 때만 허용한다.
- 실패한 `.partial` 패키지는 `status=FAILED`와 `failure_reason`을 남긴다.
- 작업 중 폴더는 `.partial` 접미사를 사용한다. COMPLETE manifest를 쓴 뒤 최종 폴더명으로 한 번만 변경한다.
- Revit 원본 파일 자체의 SHA는 저장된 로컬 파일을 안전하게 읽을 수 있을 때만 기록한다. 미저장 변경이 있는 모델의 파일 SHA를 현재 문서 상태의 해시라고 주장하지 않는다.

1차 구현은 빈 `IFCExportOptions`가 의미하는 Revit 기본 구성을 사용하며 manifest에 `not user-selected`로 기록한다. 구성 선택 UI는 실제 Windows/Revit에서 버전별 선택지와 산출물을 확인한 뒤 추가한다. 검증 전에는 특정 납품용 IFC 구성을 사용했다고 주장하지 않는다.

### 5.2 검산 프로젝트

검산기의 입력과 출력은 새 포맷을 만들지 않고 기존 계약을 사용한다.

- 입력: `source-manifest.csv`, QTO CSV, 내역 CSV/XLSX, 매핑 CSV/XLSX
- 출력: `report.csv`, `report.csv.html`, `report.csv.manifest.csv`
- 판정: `PASS`, `FAIL`, `REVIEW`, `NOT_EVALUATED`
- 규칙: 현재 `L1.4.3`의 S001~S006, R010~R030

`export-manifest.csv`는 QTO 출처를 채우는 보조 근거다. 검산 승인 권한을 대신하지 않으며, QTO·내역·매핑을 같은 `scope_id`의 ACTIVE 소스로 등록하는 기존 소스 게이트는 유지한다.

## 6. 화면 구성

### Revit 리본

- `IFC·QTO 내보내기`: 패키지 생성
- `QTO만 내보내기`: 현재 기능의 이름을 명확히 유지
- `검산기 열기`: 설치된 Desktop 실행 파일이 있을 때만 표시 또는 실행

### Desktop 최소 화면

1. **프로젝트 열기**: 입력 파일, scope, 개정, SHA 상태
2. **검산 실행**: 소스 게이트 결과와 규칙 버전 표시
3. **결과 목록**: 상태·규칙·내역ID·차이, 상태 필터
4. **근거 상세**: 계산식, 값, 원본 행, 검산키, 요소ID
5. **결과 내보내기**: 기존 CSV·HTML·manifest 및 ZIP

그래프, 대시보드 KPI, 채팅 UI는 없다. 실무자가 오류를 찾고 근거를 전달하는 데 필요한 표와 상세 패널만 만든다.

## 7. 단계별 빌드와 완료 기준

각 단계는 코드 존재가 아니라 아래 증거를 모두 만족해야 끝난다. 이전 단계를 통과하지 못한 상태에서 설치·판매 완료를 주장하지 않는다.

### T0 — 꿈푸른 실무 산출 vertical slice

기존 P0~P5 제품 기반에 앞서, 추출 엔진의 실무성을 다음 공종 순서로 증명한다.

#### T0-1 콘크리트

- ZG/ZJ 원시 ledger의 막자갈·무근·철근콘크리트를 부재·층·규격별 signed 행으로 변환
- 승인 규칙 묶음에만 공제·할증·적용단위·반올림 순서를 허용
- ZG/ZJ/Revit 결과를 동일 키로 full-outer 비교하고 총차가 행 차이 합과 닫히는지 검사
- 모든 행에 규칙 ID/SHA, 원본 SHA·셀 또는 Revit 요소ID, 계산식을 기록

현재 고정 증거는 ZG raw `405.540 m3` 대 official `409.221 m3`로 미설명
차이 `3.681 m3`이며, 승인 변환 규칙 전까지 `REVIEW`다. ZJ raw와 official은
각각 `450.781 m3`지만 raw→official 규칙을 적용한 것이 아니므로 bridge 상태는
계속 `REVIEW`다. 숫자 일치만으로 규칙을 역산해 PASS하지 않는다.

#### T0-2 거푸집

- Revit 요소 총면적이 아니라 물리적 외피 face를 최소 단위로 사용
- 슬래브 상부, 보·벽·기둥·기초의 콘크리트 접촉면, 개구부를 승인 정책에 따라 제외
- host 면적이 net인지 gross인지 기록하고 개구부를 두 번 공제하지 않음
- PE필름·비드단열·PF단열을 순수 거푸집과 별도 bucket으로 보존
- face/정책 근거가 없는 기존 `AreaM2`는 `NOT_EVALUATED`

#### T0-3 철근

- H10/H13/H16/H19 원시 길이를 규격별로 보존
- 원시 산식에 이미 포함된 정착·이음·갈고리·벤드와 추가 규칙의 중복을 차단
- 승인된 규격별 단위중량·손율·적용순서·절사/반올림만 kg 환산에 사용
- 보고 중량과 변환 규칙이 같은 셀을 참조하는 순환 자기검증을 차단

ZJ raw 길이에 일반 단위중량과 일괄 3%를 적용한 `31,578.428349 kg`은
official `31,908.817 kg`과 `330.388651 kg` 차이가 난다. 이 차이를 official에서
역산한 계수로 메우지 않는다. MDB/ACCDB 테이블 또는 적산 담당자가 승인한
규칙표의 필드·SHA가 확보되기 전 kg 변환은 `REVIEW`다.

### P0 — 계약과 골든 샘플 고정

구현:

- 내보내기 manifest 계약과 실패 원칙을 테스트 입력으로 고정
- 현재 QTO/Preflight 회귀 명령을 기준선으로 기록

완료 증거:

- 기존 Core self-test, CLI integration, Revit stubs 전부 PASS
- 헤더만 있는 빈 QTO와 정상 QTO 샘플의 기대 결과 고정
- 제품명은 UI에서 Lukas QTO, legacy 식별자는 바이너리 내부에만 남음

### P1 — Revit IFC·QTO 원자적 패키지 생성

구현:

- 별도 `ExportIfcQtoCommand`
- Revit 공식 IFC Export API 호출
- 기존 `QuantityExtractor`와 `CsvWriter` 재사용
- IFC/QTO SHA 및 manifest 생성
- 취소, IFC 실패, QTO 실패, 경로 충돌 처리

완료 증거:

- 스텁에서 manifest 성공/실패 상태와 해시 변조 테스트 PASS
- 기존 QTO 값·요소ID 회귀 PASS
- 실제 Windows/Revit에서 승인된 모델 1개로 IFC가 재개방되고 QTO CSV가 Core에 재입력됨
- Revit 버전, 선택한 IFC 구성, 산출물 SHA가 검증 기록에 남음

외부 게이트: 실제 Autodesk DLL, Revit 설치 PC, 배포 가능한 테스트 모델이 필요하다.

### P2 — QTO 추출 실기 안정화

구현:

- 실제 모델에서 누락된 카테고리·파라미터만 증거를 보고 최소 보정
- 요소ID 선택으로 원본 요소 역추적 확인
- Revit 2017과 운영 대상 최신 버전 우선 검증 후 나머지 지원 버전 확인

완료 증거:

- 버전별 모델 요소 수, 집계 행 수, 0값 항목 수 기록
- 표본 20개 이상의 길이·면적·체적을 Revit 속성값과 비교
- 요소ID 표본이 카테고리·패밀리·타입·레벨과 일치
- 누락·오차가 허용 기준을 벗어나면 지원 범위를 문서화하고 출시 차단

### P3 — 설치형 검산기 최소 UI

구현:

- 로컬 프로젝트 열기와 파일 선택
- source manifest 생성·개정 등록 보조
- Core 실행 및 결과 표/상세 표시
- 기존 HTML/CSV/manifest 내보내기

완료 증거:

- 샘플 QTO·내역·매핑을 화면에서 선택해 CLI와 byte-equivalent 또는 의미상 동일한 판정 생성
- 소스 게이트 실패 시 R 규칙이 실행되지 않음
- `FAIL/REVIEW/NOT_EVALUATED`가 숨겨지지 않음
- 네트워크 없이 Windows PC에서 실행

### P4 — 실제 수정·재검산

구현:

- 기존 입력 덮어쓰기 금지
- 새 개정 파일 등록, 새 SHA 계산, 동일 규칙 전체 재실행
- 두 실행 manifest와 항목 상태의 전후 비교
- 비교 키는 `규칙+내역ID+검산키+단위`로 고정하고 중복 키는 `REVIEW_DUPLICATE`로 노출
- 두 결과 CSV는 각 실행 manifest의 파일명·SHA-256과 일치해야 하며 비교 중 입력 변경을 거부

완료 증거:

- 금액 오류, BIM 수량 차이, 단위 매핑 오류 샘플에서 원본 수정 전 FAIL과 수정 후 PASS가 실제 계산으로 재현
- 수정되지 않은 FAIL을 임의로 해결 상태로 바꿀 수 없음
- 규칙 버전 또는 허용오차가 달라지면 단순 전후 비교가 아닌 조건 변경으로 표시
- 두 실행의 nonblank `공사범위_ID`가 같고 소스 게이트가 모두 PASS일 때만 해결/신규 오류를 계산

Desktop은 **내역 새 개정**과 **매핑 새 개정** 버튼으로 프로젝트 밖의 CSV/XLSX만 받아 해시를 고정한 복사본과 새 `source-manifest.<slot>-rN-<hash>.csv`를 프로젝트 폴더에 추가한다. 선택했던 manifest는 절대 수정하지 않는다. 새 manifest에서는 종전 ACTIVE만 `SUPERSEDED`로 바꾸어 새 rN ACTIVE를 가리키며, 선택하지 않은 행과 IFC-QTO provenance는 그대로 보존한다. 화면은 새 manifest와 새 파일을 자동 선택하고, 이후 실행 결과만 비교 대상으로 쓴다. 비교는 이전 `report.csv`를 선택하면 현재 실행 뒤 `report.csv.comparison.csv`를 새로 만들고 화면의 **이전 결과와 비교** 탭에 표시한다. `RESOLVED`, `UNCHANGED_FAIL`, `NEW_FAIL`, `NOT_COMPARABLE`, `CONDITION_CHANGED`, `REVIEW_DUPLICATE`를 결정론적으로 분류하며 기존 파일을 덮어쓰지 않는다. Windows WPF 실기 검증은 별도 완료 게이트로 남는다.

### P5 — 설치·복구·배포 후보

구현:

- Add-in과 Desktop을 한 Windows 설치 흐름으로 배포
- 버전 선택, 해시 검증, Revit 실행 중 교체 차단, 롤백 유지
- 제거 절차와 진단 로그

완료 증거:

- 깨끗한 Windows VM 또는 PC에서 설치→Revit 실행→패키지 생성→Desktop 검산→제거 종단 간 PASS
- Revit 2017과 운영 대상 최신 버전에서 최소 1회씩 PASS
- 기존 `THEKIE.Qto.addin` 중복 로딩 없음
- 실패 설치에서 이전 버전 복구 확인

### P6 — 파일럿 출시 판정

완료 증거:

- 실제 프로젝트 2개 이상에서 IFC·QTO 패키지 생성
- 적산/BIM 실무자가 차이 항목 최소 30건을 검토하고 오판을 기록
- 치명적 데이터 손실 0건, 근거 없는 자동 PASS 0건
- 설치, 추출, 검산, 재검산, 보고서 전달 절차를 다른 실무자가 문서만 보고 수행

P6 전에는 `프로토타입` 또는 `파일럿`이라고 부른다. 전체 프로그램 완성 또는 상용 준비 완료라고 부르지 않는다.

## 8. 에이전트 목표 분할

한 에이전트가 한 경계를 책임지고, 같은 파일을 동시에 수정하지 않는다. 총괄은 계약과 통합을 소유한다.

| 에이전트 | 목표 | 주 편집 범위 | 완료 증거 |
|---|---|---|---|
| `export-package` | IFC·QTO·manifest 패키지 생성 | Revit command, export manifest, 관련 스텁 | 성공·실패·해시 테스트 |
| `qto-revit` | 실제 QTO 누락·버전 호환 보정 | Extractor, Compat, Revit tests | 버전별 스텁 + Windows 실기표 |
| `desktop-preflight` | 최소 Windows 검산 UI | 신규 Desktop 프로젝트만 | CLI와 동일 판정 종단 간 |
| `core-contract` | Core 입출력·재검산 불변식 감사 | Core 및 self-test | 반례 테스트와 전체 회귀 |
| `installer-release` | 통합 설치·롤백 | deploy만 | 깨끗한 Windows 설치 E2E |
| `field-validation` | 실제 모델·내역 검증 기록 | 테스트 기록·문서만 | 프로젝트 2개, 전문가 판정 |

### 실행 순서와 에이전트 목표

1. `core-contract`: P0 기준선과 새 export manifest 반례를 먼저 고정한다. 다른 제품 기능을 구현하지 않는다.
2. `export-package`: P1만 구현한다. Core 계산 규칙과 Desktop 파일은 수정하지 않는다.
3. `desktop-preflight`: P3의 읽기·실행·결과 탐색만 구현한다. Add-in과 Core 계산 규칙은 수정하지 않는다.
4. `qto-revit`: P1이 스텁을 통과한 뒤 실제 Windows 결과를 받아 P2의 증거 있는 누락만 보정한다.
5. `installer-release`: P1·P3이 각각 통과한 뒤 P5를 맡는다. 제품 기능을 고치지 않고 설치 문제를 원 소유 에이전트로 돌린다.
6. `field-validation`: 실제 PC와 프로젝트가 준비되는 즉시 P2·P6 체크리스트를 수행하며 코드는 수정하지 않는다.

P0 뒤에는 `export-package`와 `desktop-preflight`를 병렬 실행할 수 있다. 두 에이전트 모두 Core 계약을 바꾸지 않는다. 공통 계약 변경이 필요하면 이유와 반례만 총괄에게 보고하고 멈춘다. 총괄만 변경 소유자를 다시 지정한다.

## 9. 총괄 운영 규칙

1. 총괄은 매 단계 시작 전 현재 파일과 테스트 결과를 확인한다.
2. 에이전트에게 허용 파일, 금지 파일, 실행할 테스트, 완료 증거를 정확히 준다.
3. 숫자, 단위, 매핑, PASS/FAIL은 결정론적 Core만 만든다.
4. 새 의존성, 서버, DB, AI 기능 제안은 현재 단계 완료에 필수라는 증거가 없으면 거절한다.
5. 각 변경은 가장 작은 관련 테스트와 전체 회귀 중 필요한 범위를 실행한다.
6. Windows/Revit 실기가 필요한 항목은 스텁 성공으로 대체하지 않는다.
7. 외부 게이트가 막혀도 문서만 늘리지 말고, 로컬에서 증명 가능한 다음 단계까지 구현한다.

## 10. 외부 운영 게이트

다음은 코드만으로 완료할 수 없다.

- Revit 2017·운영 대상 최신 버전의 실제 Autodesk DLL 빌드 및 리본 실행
- 실제 모델의 IFC 재개방과 납품처 호환 확인
- 실제 요소ID 역추적과 수량 표본 대조
- ZG/ZJ 구조수량의 범위·공제·할증에 대한 적산/BIM 담당자 승인
- L2 데이터 저장·가공·서비스 권리의 서면 라이선스
- 배포용 코드서명 인증서와 조직의 설치 정책

게이트가 통과하지 않은 기능은 UI에서 `검증됨`으로 표시하거나 영업 문구로 보증하지 않는다.

## 11. 바로 시작할 작업

1. P0 회귀를 다시 실행해 기준선을 남긴다.
2. `export-manifest.csv`의 정상·IFC 실패·QTO 실패 골든 샘플과 self-test를 만든다.
3. Revit 스텁에 Export 호출 경계를 최소 추가하고 `ExportIfcQtoCommand`를 구현한다.
4. 동시에 Desktop은 읽기 전용 결과 탐색부터 만들고, Core 계산식은 건드리지 않는다.
5. Windows/Revit 실기 체크리스트에 IFC 재개방·구성·SHA 증거를 추가한다.

첫 출시 목표는 “온라인에서 그럴듯한 화면”이 아니다. **실제 Revit 모델에서 IFC와 QTO를 만들고, 실제 내역을 다시 계산하며, 오류 근거를 결과 파일로 전달하는 한 번의 종단 간 성공**이다.
