# Lukas QTO 원시 Properties 추출 목표 프롬프트

아래 내용을 새 Codex 작업의 첫 메시지로 사용한다.

```text
당신은 Lukas QTO의 총괄 구현 책임자다. 작업 경로는
`/Users/h/Documents/GoAgent`이다. 사용자는 Lukas이며 Lukas가 아니다.

이번 목표는 UCF Exporter 전체를 복제하거나 적산 계산식을 추측하는 것이
아니다. Revit 요소마다 실무자가 즉시 확인할 수 있는 최소 원시 Properties를
가볍고 정확하게 추출하는 설치형 Revit 애드인을 완성하고, 사용자가 웹에서
제품을 이해하고 설치 파일을 받을 수 있게 한다.

## Ponytail: full

항상 다음 순서로 판단한다.

1. 기존 코드로 가능한가?
2. Revit 공식 API와 .NET 표준 기능으로 가능한가?
3. 기존 `ElementQuantityExtractor`, `ElementQuantityLedger`, IFC·QTO 패키지,
   SHA manifest, Revit 호환 계층과 테스트를 재사용할 수 있는가?
4. 그래도 부족할 때만 가장 작은 코드를 추가한다.

새 처리 서버, DB, 회원가입, 결제, 웹 기반 RVT 실행, IFC 파서, UI 프레임워크,
범용 property 엔진, reflection 기반 자동 추출, 플러그인 구조, 새 외부 패키지는
만들지 않는다.
인터페이스 하나와 구현 하나를 따로 만들지 않는다. 기존 공용 흐름을
수정하면 되는 일을 새 병렬 파이프라인으로 복제하지 않는다.

## 단일 제품 목표

Revit에서 버튼 한 번으로 각 모델 요소의 다음 정보만 CSV로 산출한다.

- `element_id`
- `category`
- `family`
- `type`
- `element_name`
- `level`
- `volume_state`, `volume_m3`, `volume_source_parameter`
- `length_state`, `length_m`, `length_source_parameter`
- `height_state`, `height_m`, `height_source_parameter`

출력 단위는 m³와 m로 고정한다. 면적, 재료, 메시, 정점, 경계, 룸,
작업세트, 모든 사용자 파라미터, 계산식 적용, 내역 매핑은 이번 목표에
포함하지 않는다.

## 제품 제공 방식

- 실제 추출은 사용자의 Windows PC와 설치된 Revit에서 실행한다.
- 웹사이트는 RVT 파일을 업로드하거나 Revit API를 실행하지 않는다.
- 웹사이트의 책임은 제품 설명, 지원 Revit 버전, 정확한 출력 항목,
  설치 방법, 샘플 결과, 릴리스 상태, 설치 파일 다운로드다.
- 서버 측 Revit 자동화, Autodesk Automation API, 작업 큐, 파일 저장소는
  이번 목표에서 만들지 않는다.
- 설치 없이 체험할 수 있는 것은 실제 RVT 처리 기능이 아니라 샘플 CSV와
  결과 화면뿐이다. 이를 `온라인 추출`이라고 표시하면 안 된다.

제품 흐름은 다음 하나로 고정한다.

1. 사용자가 Lukas QTO 웹사이트에서 지원 버전과 출력 예시를 확인한다.
2. 검증된 Windows 설치 파일을 다운로드한다.
3. 설치 후 Revit을 열고 `Properties 추출`을 실행한다.
4. 프로그램이 독립 `element-ledger.csv` V2를 생성한다. IFC·QTO 패키지를 만들 때도 같은 V2 원장이 함께 들어간다.
5. 사용자는 CSV에서 요소별 이름·부피·길이·높이와 누락 상태를 확인한다.

웹에는 설치 파일의 버전, SHA-256, 지원 Revit 버전, 게시일을 함께 표시한다.
실제 Windows/Revit 검증, 악성코드 검사, 설치·제거 시험, 파일 SHA 검증이 끝난
릴리스만 다운로드 가능하게 한다. 준비되지 않은 빌드에는 다운로드 링크를
만들지 말고 `현장 검증 중`으로 표시한다.

## 값 선택 계약

- 값은 Revit 공식 API의 내장 파라미터에서만 읽는다.
- 기존 호환 계층을 사용해 Revit 내부 단위를 m³/m로 변환한다.
- 후보 파라미터의 우선순위를 코드에 명시하고 실제로 선택한 파라미터
  이름을 각 `*_source_parameter`에 기록한다.
- 첫 번째 유효한 값이 0이면 `ZERO`로 확정한다. 뒤의 양수 후보로
  바꾸지 않는다.
- 파라미터가 없거나 숫자로 읽을 수 없으면 `MISSING`이다. 0으로 만들지
  않는다.
- 양수 유효값은 `COMPUTED`다.
- 음수, NaN, Infinity, 변환 overflow는 그 요소와 파라미터 이름이 포함된
  오류로 실패시킨다. 다른 후보로 조용히 넘어가면 안 된다.
- 높이와 길이는 서로 대체하지 않는다. 높이가 없다고 길이를 높이로
  복사하거나 Bounding Box로 추정하지 않는다.
- family/type/name/level이 비어 있어도 추측해서 채우지 않는다.
- Element ID는 양의 정수 canonical 형식이며 전체 파일에서 중복될 수 없다.

상태 enum은 가능하면 기존 `MISSING|ZERO|COMPUTED` 하나를 이름만 일반화해
세 수량이 공유한다. 기존 공개 계약을 깨뜨리는 대규모 rename보다 작은
호환 변경을 우선한다.

## UCF 프로그램 분석 경계

제공 파일
`/Users/h/Downloads/Setup-RevitAddin_Export Ucf 2025.exe`는 실행하지 않고
정적 참고 자료로만 사용한다. 현재 확인된 함수·문자열과 사용자가 제공한
정상 출력 파일이 있을 때 필드 이름, 단위, 누락 처리, 요소 수를 비교한다.

UCF 내부 계산식을 추정하거나 숫자가 맞도록 역산하지 않는다. 코드를
복제하지 않는다. Lukas QTO의 값은 반드시 Revit API 원시값과 기록된
파라미터에서 독립적으로 나온다. UCF 계산 규칙 분석은 동일한 작은 RVT를
양쪽에서 실행한 출력 쌍이 확보된 뒤 별도 목표로 연다.

## 구현 경계

먼저 아래 파일과 모든 호출자를 읽고 실제 흐름을 확인한다.

- `src/Lukas.Qto/Core/ElementQuantityExtractor.cs`
- `src/Lukas.Qto.Core/ElementQuantityLedger.cs`
- `src/Lukas.Qto/Commands/ExportIfcQtoPackageCommand.cs`
- `src/Lukas.Qto/Compat/RevitCompat.cs`
- `tests/RevitApiStub/RevitAPI.cs`
- `tests/Lukas.Qto.RevitStubTest/Program.cs`
- `deploy/verify-field-package.ps1`
- `deploy/build-all.bat`
- `deploy/install.bat`
- `site/app/page.tsx`
- `site/app/globals.css`
- `site/.openai/hosting.json`

가장 작은 구현은 기존 element ledger를 V2로 확장하고 기존 IFC·QTO 패키지에
그 V2 파일을 그대로 넣는 것이다. 새 CSV를 하나 더 만들지 않는다. V1을
실제 소비 중인 코드가 있으면 reader만 V1을 읽을 수 있게 유지하되 writer는
V2 하나만 쓴다. 소비자가 없다면 불필요한 호환 계층을 만들지 않는다.

패키지의 기존 원자 게시, SHA-256, 행 수, QTO↔ledger Element ID 집합 일치,
CSV 수식 주입 방어를 그대로 유지한다. 출력 파일을 덮어쓰지 않는다.

웹사이트는 기존 `site` 프로젝트를 수정한다. 새 사이트나 별도 프런트엔드
프로젝트를 만들지 않는다. 기존 스타일과 호스팅 설정을 재사용하고 다음
내용만 추가한다.

- 첫 화면의 주목적을 `Revit Properties 추출`로 변경
- `무엇을 추출하는가` 표
- 3단계 사용법: 다운로드 → Revit 실행 → CSV 확인
- 샘플 `element-ledger.csv` 미리보기 또는 다운로드
- 지원 버전과 현재 검증 상태
- 검증된 설치 파일 1개의 다운로드 버튼
- 버전·SHA-256·게시일

계정, 프로젝트 목록, 업로드 영역, 처리 진행률, 가짜 실행 버튼은 만들지 않는다.
다운로드 파일을 웹 저장소에 직접 넣어 소스 저장소를 비대하게 만들지 않는다.
호스팅이 허용하는 릴리스 자산 또는 승인된 외부 파일 URL 하나를 사용한다.

## 에이전트 운영

동시에 최대 3개 역할만 사용한다.

1. 총괄: 현재 호출 흐름 확인, 파일 경계 결정, 통합, 최종 테스트
2. `revit-extraction`: extractor/compat/stub의 최소 구현과 테스트
3. `release-web-audit`: 설치 패키지·다운로드 메타데이터·웹 문구를 독립 검토

같은 파일을 둘 이상의 에이전트가 수정하지 않는다. 독립 작업이 아니면
에이전트를 만들지 않고 총괄이 직접 처리한다. 하위 에이전트 생성은 금지한다.
각 에이전트에는 허용 파일, 금지 파일, 완료 명령을 정확히 지정한다.

## 최소 테스트

테스트 모델 또는 Revit stub에 다음 요소만 둔다.

- 체적·길이·높이가 모두 양수인 요소
- 체적 0, 뒤 후보 체적 양수인 요소: 결과는 ZERO
- 길이만 있고 높이는 없는 요소: 높이는 MISSING
- 높이만 있고 길이는 없는 요소: 길이는 MISSING
- 세 값이 모두 없는 요소: 모두 MISSING
- 음수, NaN, Infinity인 요소: 명시적 실패
- 위험한 `=`, `+`, `-`, `@`로 시작하는 이름: CSV에서 안전하고 read 후 원문 복원
- 중복 또는 `01`/`1` Element ID 별칭: 실패

테스트는 기존 RevitStubTest에 추가한다. 새 테스트 프레임워크나 거대한 fixture를
만들지 않는다.

## 완료 기준

다음이 모두 충족되어야 완료다.

1. Revit 버튼 한 번으로 독립 `element-ledger.csv` V2가 생성되고, IFC·QTO 패키지에도 같은 V2 원장이 포함된다.
2. CSV 한 행이 Revit 모델 요소 한 개이며 이름·체적·길이·높이와 각 상태·출처를
   보존한다.
3. ZERO와 MISSING이 테스트와 실제 결과에서 구분된다.
4. 단위 변환과 버전 차이는 `RevitCompat.cs` 한 곳에만 존재한다.
5. 패키지 manifest의 ledger SHA·행 수와 QTO↔ledger ID 집합 검증이 유지된다.
6. Core self-test와 2017·2022·2023·2024·2025·2026 Revit stub test가 통과한다.
7. 실제 Windows/Revit 2025에서 작은 RVT로 CSV를 만든 증거가 없으면
   `스텁 완료`라고만 보고하고 실제 완료를 주장하지 않는다.
8. 결과 CSV에서 임의 요소 5개를 Revit Properties 창과 대조한 표를 남긴다.
9. Windows 현장 게이트가 통과한 설치 파일만 웹 다운로드에 연결한다.
10. 웹페이지가 실제 RVT를 온라인에서 처리한다고 오해할 표현이 없다.
11. 공개 URL에서 제품 설명·샘플 CSV·지원 버전·설치 절차·설치 파일 해시를
    확인할 수 있다.

권장 검증 명령:

- `dotnet run --project tests/Lukas.Qto.Core.SelfTest -c Release`
- `tests/run-revit-stubs.sh`
- 관련 패키지/CLI self-test
- Windows에서는 `deploy/verify-field-package.ps1`로 실제 패키지 검증
- Windows에서는 `deploy/verify-properties-ledger.ps1`로 독립 Properties CSV의 V2 계약과 SHA 증거 생성
- Windows에서 설치 → Revit 리본 로드 → 추출 → 제거를 직접 검증
- 현장 검증을 통과한 동일 Windows build에서 `deploy/package-release.ps1`로 ZIP·SHA-256을 생성하고, 깨끗한 PC에 재설치 확인
- `site`의 기존 build/test
- 공개 후 다운로드 파일의 SHA-256을 별도 재확인

## 즉시 중단할 범위 팽창

다음 제안이 나오면 구현하지 말고 `후속 후보` 한 줄로만 기록한다.

- 모든 Revit Properties 자동 덤프
- UCF 전체 포맷 복제
- IFC에서 동일 값을 다시 계산
- 재료별 물량, 거푸집 Face, 철근, 할증·공제 계산
- 새로운 Desktop 화면, 웹 업로드 또는 브라우저 RVT 처리
- AI가 파라미터 의미를 판단하거나 누락값을 보정하는 기능

## 최종 보고 형식

- 변경 파일
- 생성된 CSV 정확한 헤더
- 실행한 테스트와 결과
- 실제 Revit에서 확인한 항목 / 아직 확인하지 못한 항목
- 공개 URL과 다운로드 버전·SHA-256
- 후속 후보는 최대 3개

설명보다 실행 증거를 우선한다. 가장 작은 diff로 위 완료 기준만 달성하고
멈춘다.
```

## 목표 이후의 다음 판단

이 목표가 실제 Revit에서 통과한 뒤에만 UCF와 동일한 작은 모델의 출력을
비교하여 누락된 property가 무엇인지 결정한다. 사용자가 실제로 요구한 필드만
두 번째 목표에 추가한다.
