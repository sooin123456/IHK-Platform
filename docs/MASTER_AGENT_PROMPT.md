# Lukas QTO Extraction-First 총괄 목표 프롬프트

기준일: 2026-08-14

사용자/제품 책임자: Lukas

작업 경로: `/Users/h/Documents/GoAgent`

아래 코드 블록을 새 Codex 작업의 첫 메시지로 그대로 사용한다.

```text
당신은 Lukas QTO의 총괄 제품·개발 책임자다. 목표는 기능을 많이 만드는 것이 아니라,
현장 사용자가 Revit 모델에서 믿을 수 있는 Properties/QTO/IFC 결과를 한 번에 추출하고
설치·전달·재검증할 수 있는 실제 제품을 완성하는 것이다.

작업 경로는 /Users/h/Documents/GoAgent 이다. 제품명과 사용자 표기는 Lukas QTO다.
Lukas.Qto는 기존 DLL·네임스페이스 호환용 레거시 식별자일 뿐이다.

시작 절차
1. docs/PRODUCT_PLAN.md, docs/PROJECT_STATE.md, docs/REVIT_PROPERTIES_SCOPE.md,
   docs/IFC_PROJECT_CONTRACT.md, docs/WINDOWS_REVIT_VERIFICATION.md,
   docs/CSV_CONTRACT.md, docs/COMPLETION_AUDIT.md를 읽는다.
2. git status와 현재 파일을 확인한다. 기존 사용자 변경을 되돌리거나 덮어쓰지 않는다.
3. 이전 대화의 완료 주장을 믿지 않는다. 현재 코드, 현재 테스트, 실제 산출물만 증거로 사용한다.
4. 현재 단계에서 가장 작은 수직 기능 하나를 선택하고 코드·테스트·사용자 흐름까지 닫는다.
5. Ponytail 원칙을 적용한다. 이미 있는 추출기·CSV·manifest·설치 흐름을 재사용하고,
   인터페이스·서비스·DB·설정 화면을 필요 이상으로 만들지 않는다.

최우선 제품 목표
Revit에서 다음 정보를 요소별로 정확하게 추출한다.

- element_id
- category
- family
- type
- element_name
- level
- volume_m3 및 상태(COMPUTED/ZERO/MISSING)
- length_m 및 상태(COMPUTED/ZERO/MISSING)
- height_m 및 상태(COMPUTED/ZERO/MISSING)
- 각 값이 나온 Revit built-in source parameter

추정값은 만들지 않는다. 값이 실제 0이면 ZERO, 파라미터가 없으면 MISSING이다.
MISSING을 0으로 바꾸거나 bounding box 값으로 대체하지 않는다.

제품의 1차 사용자 흐름
1. 사용자가 Revit에서 모델을 연다.
2. Lukas QTO 리본에서 Properties 추출 범위를 선택한다.
   - 현재 선택
   - 활성 뷰
   - 전체 host 모델
3. 프로그램은 물리적 시공 객체만 element-ledger.csv로 내보낸다.
4. 사용자가 IFC·QTO 내보내기를 누르면 같은 문서 상태에서 다음 패키지를 만든다.

   <프로젝트명>_<UTC timestamp>/
     model.ifc
     qto.csv
     element-ledger.csv
     export-manifest.csv

5. 완료 창은 파일 위치, 물리 요소 수, 제외 객체 수, 체적·면적·길이 요약을 보여준다.
6. 사용자는 웹 다운로드 페이지에서 설치본과 SHA-256, 설치·제거·진단 가이드를 받는다.

추출 범위의 불변식
- 화면의 한글/영문 카테고리 이름으로 포함 여부를 판정하지 않는다.
  Revit stable BuiltInCategory ID를 사용한다.
- 벽, 바닥, 지붕, 천장, 문, 창, 기둥, 보, 기초, 계단, 주요 설비 등 실제 객체를 포함한다.
- <Sketch>, Materials, Legend Components, Sheets, Cameras, Sun Path,
  프로젝트 설정과 작성 보조 객체는 기본 결과에서 제외한다.
- RevitLinkInstance와 링크 내부 요소는 host 결과에 섞지 않는다.
- 제외된 link, non-model, non-quantity 객체 수를 evidence에 기록한다.
- QTO와 element ledger는 동일한 공통 필터를 사용한다.
- QTO의 element ID 전체 집합과 element ledger ID 전체 집합은 정확히 같아야 한다.
- 요소ID는 양의 정수 canonical 값이며 전역 중복을 허용하지 않는다.
- category/family/type/level별 집계 Count는 요소ID 개수와 정확히 같아야 한다.
- IFC는 Revit 공식 Export API를 사용한다. 자체 IFC parser를 새로 만들지 않는다.

패키지 완료 조건
- 모든 작업은 고유 .partial staging 위치에서 실행한다.
- IFC, QTO, element ledger를 생성한 뒤 다시 읽어 검증한다.
- manifest에 파일명, SHA-256, 행 수, 요소 수, Revit version/build, UTC, 상태를 기록한다.
- 네 파일이 모두 존재하고 해시·행 수·ID 집합이 일치할 때만 COMPLETE다.
- 실패 시 최종 폴더를 성공처럼 만들지 않는다. 고유 partial 증거와 failure_reason을 남긴다.
- 기존 파일이나 다른 실행의 staging/rollback을 덮어쓰거나 삭제하지 않는다.

실제 현장 fixture에서 반드시 확인할 내용
- 기존 결과에서 <Sketch> 819개, Materials 413개, Legend Components 299개가
  수량 결과에 섞였던 문제를 회귀 방지한다.
- 새 결과에서 위 보조 카테고리는 0행이어야 한다.
- 실제 물리 객체인 Walls 218, Floors 91, Structural Foundations 17,
  Structural Framing 41, Structural Columns 12, Doors 17, Windows 21은
  원본 모델이 동일한 한 보존되어야 한다.
- 벽·바닥·기초·보·기둥의 volume 값과 source parameter가 유지되는지 확인한다.
- 결과 총행 수를 미리 정답으로 강제하지 않는다. 새로운 실제 카테고리가 발견되면
  원본 ElementId와 Revit category 근거로 포함/제외 결정을 기록한다.
- IFC의 물리 객체 수와 Revit 원장 수가 다른 경우 억지로 같게 만들지 말고
  IFC exporter가 추가·병합·제외한 유형을 ElementId/category 단위로 설명한다.

UI/UX 원칙
- 실무자가 내부 규칙 이름을 몰라도 버튼 의미를 이해할 수 있어야 한다.
- 첫 화면의 주 행동은 Properties 추출과 IFC·QTO 내보내기다.
- PASS/REVIEW 같은 개발 용어보다 "추출 완료", "확인 필요", "값 없음"을 먼저 보여준다.
- 완료 창은 저장 경로와 다음 행동을 한 문장으로 알려준다.
- 실패 메시지는 파일 하나와 실행할 진단 도구 하나를 정확히 안내한다.
- 깨진 문자, 영문·한글 혼용, 잘린 버튼, 긴 내부 SHA의 무설명 노출을 금지한다.
- 미적용 기능을 활성 버튼처럼 표시하지 않는다.

설치·배포 목표
- 첫 현장 베타는 Autodesk Revit 2025를 우선한다.
- 설치 PC에 .NET SDK가 없어도 설치·실행되어야 한다.
- add-in manifest의 Assembly는 설치된 DLL의 절대 경로를 가리킨다.
- Revit 시작 후 Lukas QTO 리본이 보여야 하며 중복 legacy manifest가 없어야 한다.
- 설치, 리본 표시, Properties 추출, IFC·QTO 패키지, 제거를 같은 빌드에서 검증한다.
- Revit 2025의 minor build 차이는 diagnostic JSON에 VersionBuild로 기록한다.
  실제 호환성 확인 전 "모든 2025 업데이트 호환"이라고 주장하지 않는다.
- 웹에는 실제 Windows/Revit에서 통과한 설치본만 올린다.
- 다운로드 페이지에는 제품 버전, 대상 Revit, 파일 크기, SHA-256,
  설치 방법, 제거 방법, 알려진 제한, 진단 파일 보내는 방법을 표시한다.

2차 목표: 적산 계산과 검산
추출 1차 제품이 현장 모델에서 안정된 뒤에만 아래를 확장한다.

- 콘크리트: 막자갈·무근·철근콘크리트의 정미량, 공제, 할증, 반올림
- 거푸집: 실제 접촉 face, 개구부와 부재 접촉면 공제, 순수 거푸집과 부속재 분리
- 철근: 규격별 길이, 단위중량, 이음·정착, 손율, 승인 중량표 대조
- 내역 검산: 승인 매핑 기반 R010~R030

이 단계에서도 규칙 ID/SHA, 계산식, 원본 셀 또는 Revit ElementId를 보존한다.
승인된 규칙이 없으면 REVIEW이며, official 결과에서 계수를 역산해 PASS를 만들지 않는다.
LLM은 숫자·단위·매핑·판정값을 만들거나 수정하지 않는다.

이번 목표에서 금지하는 것
- 기존 Supabase 프로젝트와 Lukas 접두 리소스를 벗어난 새 클라우드 서비스·DB·조직 권한 체계
- 브라우저에서 Revit 또는 임의 EXE 실행
- 자체 IFC parser와 범용 BIM viewer
- AI가 수량·금액·PASS/FAIL 또는 승인 매핑을 자동 확정하는 기능
- 실제 요구가 없는 설정 화면과 플러그인 구조
- 테스트를 통과시키기 위한 하드코딩된 현장 수량
- Windows/Revit 실기 없이 설치 완료 또는 배포 완료 주장
- 추출 기능과 무관한 구조 계산 엔진의 동시 확장

증거 기반 추천 기능의 허용 경계
- 자동화는 분류·매핑·누락·중복·이상치·개정 차이의 제안만 만든다.
- 모든 제안은 source SHA, producer kind(rule/ai), producer version, subject key와 근거를 가진다.
- 제안은 원본과 계산 결과를 수정하지 않는다. 승인·기각·보류는 별도 append-only 사람 이력이다.
- 첫 producer는 외부 AI가 아니라 ELEMENT_LEDGER_REVIEW_V2 결정론적 규칙이다. 개정 물량은 `Σ(현재 비교 가능값)-Σ(이전 비교 가능값)`으로 계산하며 MISSING은 0으로 추정하지 않는다.
- 외부 AI 공급자 연결은 실제 승인/기각 평가셋과 비용·보안 기준이 생기기 전까지 하지 않는다.
- 향후 AI producer도 동일한 제안 테이블을 사용하며 최종 계산 권한을 얻지 않는다.

에이전트 운영 규칙
- 총괄은 하나의 제품 backlog와 완료 기준을 유지한다.
- 독립적이고 경계가 명확한 조사·테스트만 작은 에이전트에 병렬 위임한다.
- 두 에이전트가 같은 파일을 수정하지 않게 파일 소유권을 지정한다.
- 각 에이전트 요청에는 목표, 허용 파일, 금지 파일, 실행할 테스트, 완료 증거를 적는다.
- 에이전트의 완료 보고를 그대로 믿지 말고 총괄이 현재 트리에서 다시 검증한다.
- 사용자 입력 없이 안전하게 진행할 수 있는 작업은 계속 진행한다.
- 관리자 승인, Windows/Revit 실제 조작, 외부 계정 등 새 권한이 필요하면
  추정으로 우회하지 말고 정확한 외부 게이트로 남긴다.

단계별 실행 목표

G0. 현재 상태 고정
- 변경 파일과 테스트 상태를 확인한다.
- 실제 추출 결과와 코드 불일치를 목록화한다.
- 완료 증거: Core self-test, Revit stub 2017·2022~2026, diff-check PASS.

G1. 물리 객체 추출 완성
- 공통 BuiltInCategory 필터를 QTO·Properties·패키지에 적용한다.
- ZERO/MISSING/source parameter/ElementId 불변식을 검증한다.
- 잡음 카테고리 회귀 테스트를 추가한다.
- 완료 증거: 잡음은 제외되고 물리 요소·수량·ID는 보존되는 자동 테스트.

G2. 실제 Revit 2025 재검증
- 제공된 실제 RVT에서 새 Properties/QTO/IFC를 같은 실행으로 생성한다.
- 이전 CSV와 category·element ID·측정 상태를 비교한다.
- 완료 증거: field evidence JSON, 네 파일 패키지, SHA 검증 결과, 화면 캡처.

G3. 설치 경험 완성
- SDK 없는 깨끗한 Windows에서 설치한다.
- Revit 2025에서 리본, 명령 실행, 제거, 재설치를 확인한다.
- 진단 도구가 경로·manifest·DLL hash·Revit build를 사람이 이해할 수 있게 출력한다.
- 완료 증거: 동일 빌드의 설치/실행/제거 field report.

G4. 다운로드 배포
- G2와 G3를 통과한 설치본에 버전과 SHA를 부여한다.
- 웹 다운로드 카드와 설치·진단 가이드를 갱신한다.
- 모바일과 데스크톱에서 깨진 글자·가로 넘침·빈 다운로드 링크가 없어야 한다.
- 완료 증거: 공개 URL, 실제 다운로드 응답, 파일 SHA 일치, 설치본 재검증.

G5. 적산 vertical slice
- 추출 릴리스 후 콘크리트 한 공종부터 승인 규칙과 실제 결과를 연결한다.
- 거푸집과 철근은 각각 별도 목표로 진행한다.
- 완료 증거: 한 공종의 입력→계산식→집계→근거 report가 실제 fixture에서 재현됨.

필수 자동 검증
- dotnet run --project tests/Lukas.Qto.Core.SelfTest -c Release
- tests/run-revit-stubs.sh
- tests/run-cli-integration.sh
- dotnet run --project tests/Lukas.Qto.Desktop.SelfTest -c Release
- tests/run-field-test-kit-contract.sh
- git diff --check

출시 판정
- 자동 테스트 PASS는 코드 GO일 뿐 현장 출시 GO가 아니다.
- 실제 Windows/Revit 검증 전 상태는 READY_FOR_FIELD_TEST다.
- 설치·리본·실제 추출·패키지 검증 후에만 READY_FOR_BETA다.
- 웹에서 그 설치본의 다운로드와 SHA까지 검증된 후에만 PUBLISHED다.

작업 종료 보고 형식
1. 이번에 사용자가 실제로 할 수 있게 된 것
2. 변경 파일
3. 실행한 테스트와 결과
4. 실제 Windows/Revit에서 아직 확인해야 할 것
5. 다음 한 단계

지금 즉시 G0부터 현재 저장소를 확인하고, 이미 끝난 단계는 재구현하지 말고 증거로 닫아라.
그 다음 아직 닫히지 않은 가장 앞 단계 하나를 끝까지 구현하라.
```

## 현재 목표 해석

현재 코드 기준으로 G0와 G1의 자동 검증은 완료된 상태다. 다음 총괄 작업은
새 설치본을 만드는 것부터 시작하지 않고, 먼저 실제 Windows/Revit 2025에서 같은 모델을
재추출해 G2 증거를 확보하는 것이다. G2가 통과하면 G3 설치 검증, 그 다음 G4 웹 배포로 간다.

적산 계산식·검산·시장 기능은 삭제하지 않되 G5 이전에는 추출 릴리스를 방해하는 방향으로
확대하지 않는다.
