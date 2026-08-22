# 한길시스템 — BIM 건축 적산·물량산출

외부 제품 브랜드는 **한길시스템**, 제품·기술 식별자는 **Lukas QTO / `Lukas.Qto`**로 통일한다. 첫 공식 베타는 Revit 2025를 대상으로 미리 빌드된 사용자별 설치 ZIP으로 제공한다.

Revit 2017 및 2022–2026을 하나의 소스로 지원하는 애드인과 설치형 L1 사전검산기.
제품의 첫 사용 가치는 Revit 요소별 원시 Properties를 빠르고 근거 있게 꺼내는 것이다. Revit의 **`Properties 추출`**은 요소마다 이름·체적·길이·높이와 실제 사용한 내장 파라미터를 CSV로 남긴다. IFC·QTO 패키지, 공종별 물량산출, 내역 검산은 그 원시 결과 위에 쌓이는 다음 단계다. Desktop은 승인된 공종 매핑과 계산 규칙으로 물량을 산출하고 기존 내역도 검산하며, CLI는 자동화·진단용이다.

---

## 1. 버전 대응 구조

| Revit | .NET | 조건부 상수 |
|---|---|---|
| 2017 | net46 | `REVIT2017` |
| 2022 | net48 | `REVIT2022` |
| 2023 | net48 | `REVIT2023` |
| 2024 | net48 | `REVIT2024` |
| 2025 | net8.0-windows | `REVIT2025` |
| 2026 | net8.0-windows | `REVIT2026` |

`RevitVersion` 프로퍼티 하나로 TFM·참조경로·컴파일상수가 전부 갈립니다.

```
dotnet build src/Lukas.Qto/Lukas.Qto.csproj -c Release -p:RevitVersion=2024
dotnet build src/Lukas.Qto/Lukas.Qto.csproj -c Release -p:RevitVersion=2026
```

위 명령은 개발 중 개별 컴파일 확인용이다. 설치 가능한 DLL과 5행 SHA-256 표식은 Windows에서 `deploy\build-all.bat 2024`처럼 버전을 지정하거나, 인자 없이 전체 버전을 빌드해 생성한다.

**버전별 API 차이는 `Compat/RevitCompat.cs` 한 곳에만 둡니다.**
현재 격리된 항목:
- `ElementId.IntegerValue`(2017·2022·2023) ↔ `ElementId.Value`(2024 이상)
  — Revit 2024에서 ElementId가 64비트로 확장되며 바뀜
- Revit 2017의 `DisplayUnitType` ↔ Revit 2022 이상의 `UnitTypeId`
  — 내부 피트 단위를 m·m²·m³로 변환하는 API 차이

새 버전을 추가할 때 이 파일 외의 곳에 `#if`가 늘어나면 설계가 무너진 신호입니다.

---

## 2. 빌드 · 설치

```
cd deploy
build-all.bat      REM 한 버전이라도 빌드 실패하면 종료 코드 1
build-all.bat 2017 REM 한 버전만 빌드해도 같은 5행 무결성 표식을 생성
install.bat        REM 빌드된 전체 버전 설치, 관리자 권한 필요
install.bat 2017   REM 선택 빌드와 같은 한 버전만 설치
install-user-2025.bat REM Revit 2025 + Desktop을 현재 사용자에게만 설치, 관리자 불필요
install-user-2025.bat addin-only REM 현장 추출 테스트용 Revit 애드인만 설치
uninstall-user-2025.bat REM 현재 사용자 beta 설치본만 제거
```

`build-all.bat`는 Revit 버전별 Release 애드인을 `build\Release\<버전>`에 만들고, 성공한 빌드에만 버전·TFM·실제 API 경로·비-스텁 여부·DLL SHA-256을 고정한 5행 설치 표식을 남긴다. 같은 실행에서 `Lukas.Qto.Desktop`을 `build\desktop`에 게시하고 게시 파일별 SHA-256 표식을 만든다. `install.bat`은 표식과 해시를 검증한 뒤 애드인과 `%ProgramFiles%\Lukas QTO\Desktop`을 설치한다. 기존 파일은 롤백 단위로 보존하며, 복구 파일이 남은 PC에서는 자동 덮어쓰기하지 않는다. CLI는 `build\preflight\Lukas.Qto.Preflight.exe`로 publish된다. Desktop과 CLI 실행에는 .NET 8 Desktop Runtime이 필요하다.

Revit이 없는 빌드 머신이면 `-p:RevitApiDir=...`로 API DLL 경로를 넘기거나,
csproj의 `<Reference>`를 NuGet 패키지로 교체하십시오.
`[검증필요]` NuGet 패키지명·버전은 사용 전 nuget.org에서 직접 확인할 것.

Revit 2017 빌드는 프로젝트가 빌드 전용 .NET Framework 4.6 참조 어셈블리를 복원한다. 오프라인 빌드라면 해당 NuGet 패키지를 미리 캐시하거나 .NET Framework 4.6 **Targeting Pack**을 설치해야 한다. 실제 Revit 2017 실행 검증 전에는 이 호환성을 완료로 간주하지 않는다.

기본 `install.bat` 설치 위치는 `%ProgramData%\Autodesk\Revit\Addins\<버전>\`와 `%ProgramFiles%\Lukas QTO\Desktop`이며 관리자 권한이 필요하다. Revit 2025 beta의 `install-user-2025.bat`은 관리자 권한 없이 `%AppData%\Autodesk\Revit\Addins\2025\Lukas.Qto.addin`과 `%LocalAppData%\Lukas QTO\Desktop`에만 설치한다. 현장 추출만 확인할 때는 `install-user-2025.bat addin-only`로 Desktop 설치를 건너뛴다. 두 경로는 서로 독립적이므로 사용자 beta 제거는 시스템 설치본을 건드리지 않는다.

사용자 beta도 같은 `build\Release\2025`와 `build\desktop`의 SHA-256 표식을 먼저 검증한다. 설치 도중 `.new` 또는 `.rollback`이 남으면 자동 덮어쓰지 않으므로, 표시된 경로를 복구·보관한 뒤 다시 실행해야 한다. 설치 후 다음처럼 사용자 범위를 명시해 진단한다.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\diagnose-revit-addin.ps1 -RevitVersion 2025 -Scope User
```

`install.bat`은 대상 버전 폴더 안에 `Lukas.Qto.addin`을 생성하고, 해당 PC의 **절대 DLL 경로**를 기록한다. `addin/Lukas.Qto.addin`은 수동 설치용 템플릿이므로 `__INSTALL_DIRECTORY__`를 실제 경로로 바꾸지 않고 복사하면 안 된다.

---

## 3. 인코딩 규칙 — 반드시 지킬 것

이번에 겪은 오류(`'cho.'`, `'xecutionPolicy'`)의 원인이 여기입니다.

| 파일 | 인코딩 | 이유 |
|---|---|---|
| `*.bat` | **ASCII 또는 ANSI(CP949), BOM 금지** | cmd가 CP949로 읽음. UTF-8 한글 3바이트 중 남은 1바이트가 다음 영문자를 삼킴 |
| `*.cs` | **UTF-8 + BOM** | 한글 리터럴이 있을 때 컴파일러 오판 방지 |
| `*.addin` | UTF-8 | XML 선언에 명시됨 |
| CSV 출력 | UTF-8 + BOM | 없으면 Excel이 CP949로 읽어 한글 깨짐 |

`.bat`에는 한글을 아예 넣지 않는 것이 가장 안전합니다. 본 저장소의 `.bat` 2개는
순수 ASCII·CRLF로 검증되어 있습니다.

---

## 4. 설계 원칙

**숫자에는 LLM을 쓰지 않습니다.**

- `QuantityExtractor` — 집계만. 판단 없음. 값이 없으면 0, 추정하지 않음
- `CsvWriter` — 검산 CSV에는 최대 12자리 소수 정밀도를 보존. 화면 표기 반올림과 원본 검산값을 섞지 않음
- 검산 계층(L1) — 결정론적 룰. 내역 산술·승인된 매핑 수량 검증
- LLM 역할 — 공종명 매칭(표기 흔들림 흡수), 오류 설명문 생성. 그 이상 금지

`QtoRow.ElementIds`를 반드시 보존하는 이유도 같습니다. 검산이 "이상 있음"이라고
말할 때 **어느 요소인지 되짚어갈 수 없으면 아무도 그 결과를 신뢰하지 않습니다.**

---

## 5. 실제 사용자 흐름

1. Revit의 `한길시스템` 리본에서 `Properties 추출`을 누르고 빈 폴더에 `element-ledger.csv`를 만든다.
2. CSV의 한 행이 한 요소인지, `element_name`, 체적·길이·높이, 각 `*_state`, `*_source_parameter`를 확인한다. `ZERO`는 실제 0 값이며 `MISSING`은 값이 없어 추정하지 않았다는 뜻이다.
3. IFC와 집계 QTO도 필요한 경우에만 `IFC·QTO 내보내기`를 누른다. 생성된 최종 폴더에는 `model.ifc`, `qto.csv`, `element-ledger.csv`, `export-manifest.csv`가 있으며, 실패 폴더는 `.partial`이고 산출·검산 입력으로 쓰지 않는다.
4. Revit 리본의 `검산기 열기`를 누르거나 `Lukas.Qto.Desktop.exe`를 열고 `export-manifest.csv`, 내역서, 승인 매핑을 선택한다.
5. `프로젝트 만들기`를 눌러 IFC/QTO 해시가 확인된 로컬 프로젝트를 만든다.
6. 실무 물량산출은 `콘크리트 승인파일`에서 아래 3개 CSV를 선택하고 `콘크리트 산출`을 누른다.
   - Revit 정확 매핑: `category/family/type`별 `Include` 또는 `Exclude`, Include일 때 building/member/spec
   - 콘크리트 규칙: spec별 할증률, row/subtotal 적용, 공제 순서, 반올림 방식
   - 승인표: 두 bundle의 ID·version·canonical SHA-256
7. 결과 `concrete-takeoff.csv`와 manifest에서 정미량·공제·할증·최종량·공식·규칙 SHA·요소ID를 확인한다. `MISSING`, 미매핑, 미승인 값은 자동 보정하지 않고 REVIEW다.
8. 기존 내역 검토는 별도로 `검산 실행`을 눌러 모든 S/R finding과 근거를 보고 CSV·HTML·실행 manifest를 보관한다.

저장소의 `samples/concrete-demo`에는 위 네 파일 패키지와 3개 승인 CSV가 있다. Desktop에서 그대로 선택하면 `10m³`, 할증 `0`인 전체 흐름을 재현한다. 다만 사용자가 규칙과 registry를 함께 고를 수 있는 샘플은 **계산 일관성 데모**이지 독립 운영 승인이 아니다. 운영 `PASS`는 관리자가 HKLM의 `SOFTWARE\Lukas QTO\Approvals\TrustedRegistrySha256`에 승인 registry SHA를 등록한 PC에서만 허용한다.

관리자 승인 절차:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\deploy\approve-registry.ps1 -RegistryCsv C:\approved\concrete-registry.csv
```

이 스크립트는 관리자 권한을 요구하며 승인표 원문이 아니라 검토한 파일의 SHA-256만 시스템 trust store에 원자적으로 등록한다. 규칙이나 승인표가 한 글자라도 바뀌면 다시 REVIEW가 된다.

IFC 없이 기존 QTO만 검산할 때는 source manifest, QTO, 내역, 매핑을 직접 선택할 수 있다. 이 경우 IFC 동일 export run 증명은 제공하지 않는다. 상세 절차와 실제 PC 통과 기준은 [Windows·Revit 검증](docs/WINDOWS_REVIT_VERIFICATION.md), 제품 범위와 단계는 [제품 기획](docs/PRODUCT_PLAN.md)을 따른다.

## 6. 현재 완성 범위와 다음 현장 게이트

현재 코드로 콘크리트는 `element-ledger → 승인 Include/Exclude 매핑 → 승인 계산 규칙 → 근거 report`까지 Desktop에서 실행된다. 거푸집은 Revit solid face 전용 원장을 추출하며 모든 접촉·개구부 판정은 REVIEW에서 시작한다. 철근은 규격별 길이×단위중량×손율×반올림 엔진까지 구현됐으나 실제 ZJ 중량을 재현하는 승인 MDB 규칙은 아직 없다.

1. 실제 Revit 2017 및 사용 중인 최신 버전에서 네 파일 패키지·요소 역추적·콘크리트 Desktop 산출을 검증
2. ZG·ZJ 구조수량 원장을 공통 signed-row로 읽은 결과 중 아직 `Unknown`인 ZG 264행·ZJ 24행을 적산 담당자와 분류하고, MDB/JOYST 할증·철근 중량 규칙을 승인
3. 적산 전문가가 실제 차이 결과를 검토하고 오판 기록
4. 대조 엔진 L2 — 표준품셈·단가 대조 `[검증필요]` **DB 라이선스가 최대 리스크**
5. Windows Desktop에서 결과 그리드·프로젝트 생성·재검산 비교 실기 확인

---

## 7. 미검증 항목

Core와 Desktop의 비-UI 실행 회귀는 통과했다. Revit 소스의 스텁 실행도 확인했지만 이 macOS 환경에서 6개 버전 MSBuild 복원은 멈췄다. 실제 Autodesk DLL을 쓴 Windows/Revit 실행은 아직 검증하지 않았으므로 사무실 PC에서 다음을 확인해야 한다.

- `BuiltInParameter` 이름 일부가 버전에 따라 다를 수 있음 `[검증필요]`
- `WhereElementIsViewIndependent()` 조합에 따른 누락 가능성 `[검증필요]`
- 리본 탭 중복 생성 예외 처리 동작 `[가정]`

첫 빌드 오류는 정상입니다. 오류 메시지를 그대로 주시면 잡겠습니다.

---

## 8. L1 내역 사전검산기

`src/Lukas.Qto.Preflight`는 Revit이 내보낸 QTO CSV, 내역 CSV 또는 XLSX, 사람이 승인한 매핑 CSV 또는 XLSX를 대조한다. 새 매핑 템플릿은 기계 ID 자동 변환을 막는 텍스트 셀 XLSX로 생성한다.
외부 패키지와 LLM을 쓰지 않으며, 현재 범위는 다음 두 가지다.

- EMS 구성단가·내역 금액·원가계산서 총공사비 산술 검산
- 매핑된 BIM 수량과 내역 수량의 차이 검산

입출력 열과 실행 방법은 [CSV 계약](docs/CSV_CONTRACT.md), 규칙은 [계산식 카탈로그](docs/FORMULA_CATALOG.md)를 따른다.

```sh
dotnet run --project src/Lukas.Qto.Preflight -- --sources samples/source-manifest.csv samples/qto.csv samples/estimate.csv samples/mapping.csv samples/report.csv
dotnet run --project tests/Lukas.Qto.Core.SelfTest
```

실행하면 `report.csv`(기계 처리), `report.csv.html`(사람 검토), `report.csv.manifest.csv`(입력·소스 매니페스트 해시, 범위·소스 ID, 규칙 버전, 허용오차)가 함께 생성된다. 안전 실행은 [소스 매니페스트 계약](docs/SOURCE_MANIFEST.md)에 따라 세 입력의 범위와 최신 개정을 먼저 확인한다.

제공된 꿈푸른유치원 폴더 전체의 파일 계보·충돌·구현 우선순위는 [프로젝트 소스 감사](docs/PROJECT_SOURCE_AUDIT.md)에 정리했다. ZG/ZJ 구조수량은 [구조수량 계약](docs/STRUCTURAL_QUANTITY_CONTRACT.md)에 따라 공식 anchor를 셀 근거와 함께 읽고, signed ledger·child bucket·증거 registry·철근 kg 근거를 결정론적으로 검산한다. MDB/JOYST 규칙을 승인하기 전에는 raw→official 차이를 임의로 보정하지 않고 REVIEW로 남긴다.

L2 표준품셈·시장단가 검증은 라이선스와 실제 데이터 구조가 확인되기 전까지 구현하지 않는다.

여러 에이전트로 후속 개발을 진행할 때는 [총괄 프롬프트](docs/MASTER_AGENT_PROMPT.md)를 사용한다. 이 프롬프트는 L1의 계산·추적성 경계를 유지한 채 조사와 검증 작업만 병렬화한다.
