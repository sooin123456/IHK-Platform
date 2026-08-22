# Windows/Revit 검증 절차

현재 Revit 애드인은 Windows와 해당 버전의 Revit API DLL이 있어야만 빌드할 수 있다.

Revit 2025 현장 검증자는 ZIP을 압축 해제한 뒤 루트의
`1-BUILD-INSTALL-2025.bat`을 일반 사용자로 실행한다. 이 경로는 현재 사용자 계정에만
설치한다. 리본이 보이지 않으면 Revit을 종료하고 `2-DIAGNOSE-2025.bat`을 실행한다. 두 파일은 `%~dp0` 기준의
절대경로를 사용하므로 현재 PowerShell/명령 프롬프트 위치와 무관하다.

## Revit 2025 사용자 beta (관리자 권한 없음)

현장 PC에서 시스템 전체 설치 권한이 없으면, Revit을 완전히 종료한 뒤 ZIP 또는 저장소 루트에서 아래를 실행한다. 이 경로는 **현재 Windows 사용자**의 `%AppData%\Autodesk\Revit\Addins\2025`와 `%LocalAppData%\Lukas QTO\Desktop`만 변경하며 `%ProgramData%`·`%ProgramFiles%` 설치본은 변경하지 않는다.

```bat
deploy\build-all.bat 2025
deploy\install-user-2025.bat
```

설치기는 Revit DLL의 5행 build marker와 Desktop 파일별 SHA-256 marker를 원본·스테이지·설치본에서 확인한다. 기존 사용자 설치본은 폴더 단위 rollback 후 교체하며 `.new` 또는 `.rollback`이 남은 경우에는 자동 덮어쓰지 않는다. 리본이 보이지 않으면 다음처럼 반드시 `User` 범위를 지정해 JSON 증거를 생성한다.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\diagnose-revit-addin.ps1 -RevitVersion 2025 -Scope User
```

제거는 Revit을 종료한 뒤 `deploy\uninstall-user-2025.bat`을 실행한다. 이 제거기는 Lukas QTO manifest와 Desktop publish marker를 확인한 사용자 설치본만 지우며, 소유 표식이 없거나 복구 경로가 남은 대상은 제거하지 않는다.

1. 이 자료의 실제 모델은 Revit 2017 형식이다. Revit 2017이 설치된 Windows에서 저장소 루트를 기준으로 다음을 실행한다. 이 경로는 개별 `dotnet build`와 달리 DLL SHA-256까지 포함한 설치용 5행 표식을 만든다. 오프라인 환경이면 .NET Framework 4.6 Targeting Pack(또는 `Microsoft.NETFramework.ReferenceAssemblies.net46` NuGet 캐시)을 준비한다.

   ```bat
   deploy\build-all.bat 2017
   deploy\install.bat 2017
   ```

   빌드 뒤 `build\Release\2017\Lukas.Qto.dll`과 `Lukas.Qto.build.ok`가 모두 있는지 확인한다. 표식에는 정확히 `RevitVersion`, `TargetFramework`, `IsRevitStubBuild`, `RevitApiDir`, `AssemblySha256` 5행이 있어야 한다. 설치 뒤 `%ProgramData%\Autodesk\Revit\Addins\2017\Lukas.Qto.addin`을 열어 `Assembly` 값이 실제 `Lukas.Qto\Lukas.Qto.dll`의 **절대 경로**인지 확인한다. 같은 폴더의 예전 `Lukas.Qto.addin`은 활성 상태로 남아 있으면 안 되며, 설치기가 이전 파일을 `.disabled`로 보존한다.

   리본에 `Lukas QTO` 탭이 보이지 않으면 추출 기능을 시험하지 말고 Revit을 완전히 종료한 뒤 아래 명령을 먼저 실행한다. 생성된 JSON에는 manifest, DLL 경로, SHA, legacy 충돌, 재시작 상태가 들어 있다.

   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\diagnose-revit-addin.ps1 -RevitVersion 2017
   ```

2. Revit을 재시작한 뒤 `Lukas QTO > 수량·검산 > Properties 추출`을 실행해 `현재 선택`, `활성 뷰`, `전체 host 모델` 중 하나를 고르고 임의의 빈 폴더에 CSV를 만든다. 링크 모델은 어떤 선택에서도 자동 제외되며, `element-ledger.csv.evidence.json` V2에 Revit version/build, 범위, `built-in-category-physical-v1` 필터, 후보·제외·행 수, CSV SHA-256이 기록되어야 한다. 검증기는 `candidate = eligible_host_model + excluded_link_instances + excluded_non_model + excluded_non_quantity`와 `eligible_host_model = CSV 행 수`도 확인한다. `<Sketch>`, Materials, Legend Components 같은 작성 보조 객체는 CSV에 남지 않아야 하고 `excluded_non_quantity` 수에 기록되어야 한다. 이어서 `IFC·QTO 내보내기`를 실행해 완료 폴더에 `model.ifc`, `qto.csv`, `element-ledger.csv`, `export-manifest.csv`가 있는지 확인한다. Properties CSV와 패키지의 element ledger는 요소당 한 행이며 이름, 체적(m3), 길이(m), 높이(m), 각 상태와 원본 내장 파라미터를 보존해야 한다. 이 명령은 현재 `IFCExportOptions` 기본값을 사용하며, manifest의 `ifc_configuration`도 사용자 선택 구성이 아님을 명시한다. 버전별 승인 IFC 구성은 아직 실제 Revit에서 검증되지 않았다.
3. Revit과 독립적으로 완료 패키지를 검증하고 증거 JSON을 남긴다. 가장 쉬운 방법은 최종 패키지 폴더를 루트의 `3-VERIFY-EXTRACTION-2025.bat` 위로 끌어다 놓는 것이다. 이 검증기는 `model.ifc`, `qto.csv`, `element-ledger.csv`, `export-manifest.csv`를 수정하지 않으며, 실패해도 JSON을 남기고 1로 종료한다.

   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\verify-field-package.ps1 -PackageDirectory 'D:\QTO\MyExport_20260812_101500' -ExpectedRevitVersion 2017
   ```

   기본 증거 파일은 패키지 폴더의 `field-verification.json`이다. 패키지 경로 자체가 없을 때는 그 경로 옆의 `<폴더명>.field-verification.json`으로 기록하므로, 실패한 입력 때문에 새 패키지 폴더를 만들지 않는다. 별도 증거 보관 위치가 필요하면 `-EvidencePath 'D:\QTO-evidence\run-001.json'`을 지정한다. 해당 상위 폴더는 미리 있어야 하며, `model.ifc`·`qto.csv`·`element-ledger.csv`·`export-manifest.csv`를 EvidencePath로 지정할 수 없다. 통과 전에는 Desktop 프로젝트 생성이나 검산 승인 자료로 사용하지 않는다.

   검증기는 최종 폴더인지(`.partial` 없음), **16열·데이터 1행** manifest, `COMPLETE`, 정해진 파일명과 존재·비어있지 않음, IFC/QTO/element-ledger SHA-256, ISO UTC, Revit 버전, manifest 수량, 10열 QTO, **15열 element ledger**를 확인한다. element ledger는 양수·전역 고유 `element_id`, `element_name`, 체적·길이·높이 각각의 `MISSING/ZERO/COMPUTED` 상태와 source parameter 규칙을 만족해야 한다. 같은 export run에서는 QTO와 ledger의 요소ID 집합, `element_count`, `element_ledger_row_count`가 정확히 일치해야 한다. 증거 JSON에는 두 파일의 해시와 행·요소 수를 기록한다. `model.ifc`를 Revit 또는 승인된 IFC 뷰어에서 다시 열어 형상과 속성 전달 범위를 확인하는 일과 Revit Properties 창의 실제 값을 대조하는 일은 이 스크립트가 대신할 수 없는 수동 게이트다.
4. 독립 `Properties 추출` CSV도 Revit 없이 아래 명령으로 V2 헤더·요소 ID·체적/길이/높이 상태·값·source parameter를 확인하고 JSON 증거를 남긴다. 이 스크립트는 CSV를 수정하지 않는다.

   ```powershell
   powershell -ExecutionPolicy Bypass -File deploy\verify-properties-ledger.ps1 -LedgerPath 'D:\QTO\element-ledger.csv'
   ```

   기본 증거 파일은 `element-ledger.csv.field-verification.json`이다.
5. `Properties 추출` CSV에서 서로 다른 유형의 요소 5개를 골라 Revit Properties 창과 아래처럼 대조한다. 값이 없을 때는 `MISSING`, 실제 0일 때는 `ZERO`인지도 기록한다. 이 표와 CSV SHA-256이 첫 공개 설치 파일의 현장 증거다.

   | element_id | Revit에서 확인한 항목 | CSV 값 | state | source_parameter | 일치 |
   |---|---|---|---|---|---|
   | 예: 12345 | Volume | 1.250 m³ | COMPUTED | HOST_VOLUME_COMPUTED | Y/N |
   | 예: 12345 | Length | 4.000 m | COMPUTED/ZERO/MISSING | CURVE_ELEM_LENGTH 등 | Y/N |
   | 예: 12345 | Height | 3.000 m | COMPUTED/ZERO/MISSING | WALL_USER_HEIGHT_PARAM 등 | Y/N |

   임의의 `MISSING`을 0으로 고치거나, 다른 파라미터 값으로 대체하면 현장 검증은 실패다.
6. `요소ID` 하나를 Revit에서 선택해 해당 QTO 행의 카테고리·패밀리·타입·레벨과 일치하는지 확인한다.
7. 권장 경로는 아래 Desktop에서 `프로젝트 만들기`를 사용해 export manifest·IFC·QTO 해시가 연결된 source manifest를 생성하는 것이다. CLI를 직접 쓸 경우 IFC·QTO·내역·매핑의 SHA-256을 같은 `scope_id`에 등록하고, QTO의 `related_source_id`가 IFC source ID를 가리키도록 [IFC 프로젝트 실행 계약](IFC_PROJECT_CONTRACT.md)을 따라야 한다. 이 CLI는 .NET 8 Desktop Runtime이 필요하다.

   ```bat
   build\preflight\Lukas.Qto.Preflight.exe --sources source-manifest.csv --ifc model.ifc qto.csv estimate.csv mapping.csv report.csv
   ```

검증 담당자는 Revit 버전·모델 파일명·생성 시각과 승인한 `scope_id`·`source_id`를 작업 기록에 남긴다. CLI 실행 manifest에는 입력과 소스 매니페스트 SHA-256·규칙 버전·선택 ID가 자동 기록되고, 결과 CSV·HTML·manifest를 함께 보관한다.

`build-all.bat`과 `install.bat`은 어느 작업 디렉터리에서 실행해도 자신의 `deploy` 폴더를 기준으로 경로를 해석한다.
설치 중 복구가 실패해 `.rollback` 파일이 남으면 설치기를 다시 실행하지 말고 메시지에 표시된 DLL 또는 매니페스트를 먼저 수동 복원한다. 재실행은 남은 복구 파일을 자동으로 덮어쓰지 않는다.

## Lukas QTO 검산기(P3) Windows 확인

검산기는 .NET 8 WPF이다. Windows에서 저장소 루트를 기준으로 `build-all.bat`을 실행하면 Revit 애드인과 CLI에 이어 `win-x64`, framework-dependent Release 앱이 `build\desktop`에 게시되고 각 게시 파일의 SHA-256을 담은 `Lukas.Qto.Desktop.publish.ok`가 생성된다. 설치기는 이 목록으로 원본·스테이지·설치본의 해시를 확인한 뒤 `%ProgramFiles%\Lukas QTO\Desktop`을 디렉터리 단위로 교체한다.

```bat
deploy\build-all.bat 2017
deploy\install.bat 2017
```

설치된 실행 파일은 `%ProgramFiles%\Lukas QTO\Desktop\Lukas.Qto.Desktop.exe`이다. framework-dependent 게시이므로 대상 PC에 .NET 8 Desktop Runtime x64가 필요하다. Revit 완료 폴더의 `export-manifest.csv`, 내역서, 승인 매핑을 선택하고 `프로젝트 만들기`를 누른다. 생성된 새 폴더에는 검증·복사된 `model.ifc`, `qto.csv`, `export-manifest.csv`, 내역, 매핑과 `source-manifest.csv`가 있어야 한다. 원본 IFC/QTO를 변경한 패키지와 `status=FAILED` 패키지는 프로젝트를 만들지 않아야 하며 기존 프로젝트 폴더를 덮어쓰지 않아야 한다. 성공하면 화면의 소스 매니페스트·IFC·QTO·내역·매핑 경로가 새 프로젝트 파일로 바뀐다.

## 공개 다운로드 패키지 만들기

Windows 현장 게이트가 통과한 **동일한 빌드 폴더**에서만 아래 명령을 실행한다. 스크립트는 스텁 DLL, SHA 불일치 DLL, 불완전한 Desktop publish를 거부하고 `install.bat`이 요구하는 `deploy/`와 `build/` 구조만 ZIP에 넣는다. 원본 저장소나 Revit 모델은 포함하지 않는다.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\package-release.ps1 -OutputDirectory 'D:\QTO\release' -ReleaseVersion '0.1.0-rc1'
```

생성된 `Lukas-QTO-0.1.0-rc1.zip`과 동명 `.sha256` 파일을 함께 보관한다. ZIP을 새 Windows PC에 풀고 관리자 설치는 `deploy\install.bat 2025`, no-admin beta 설치는 `deploy\install-user-2025.bat`로 각각 설치·추출·제거를 다시 확인한 뒤, ZIP SHA-256과 지원 Revit 버전·게시일을 웹에 등록한다. 이 재설치 확인 전에는 다운로드 URL을 공개하지 않는다.

그 다음 결과 CSV 경로를 선택하고 `검산 실행`을 누른다. IFC를 비우면 기존 3-slot 검산을 유지하고, 선택하면 S006이 source manifest에 선언된 IFC-QTO 연결을 검사하며 실행 매니페스트에 IFC 파일명·SHA-256·소스 ID를 기록한다. 동일 export run 증명이 필요하면 반드시 `프로젝트 만들기`로 원본 COMPLETE export manifest의 해시를 검증한 프로젝트를 사용한다. 승인 샘플은 소스 게이트 PASS와 R 규칙 결과가 함께 보여야 하고, QTO를 변경하거나 IFC-QTO provenance가 잘못된 샘플은 소스 게이트 FAIL 뒤 결과 목록에 S 규칙만 있어야 한다. 결과 CSV 옆에 `.html`, `.manifest.csv`가 생성되는지 확인한다.

재검산은 기존 프로젝트 파일을 편집하지 않는다. 우선 현재 `source-manifest.csv`와 ACTIVE 내역/매핑을 화면에 둔 뒤, 프로젝트 **밖**의 승인된 CSV/XLSX를 골라 **내역 새 개정** 또는 **매핑 새 개정**을 누른다. 프로그램은 새 파일을 해시로 검증해 프로젝트에 새 이름으로 복사하고, 기존 manifest를 보존한 채 새 `source-manifest.<slot>-rN-<hash>.csv`를 만든 뒤 자동 선택해야 한다. 새 manifest에서 이전 ACTIVE는 `SUPERSEDED`, 새 파일은 같은 scope의 rN `ACTIVE`여야 하고 IFC-QTO 행은 변하지 않아야 한다. 이어서 이전 실행의 `report.csv`를 **이전 결과 (선택)**에 지정하고 새 결과 경로로 검산한다. **이전 결과와 비교** 탭과 새 `.comparison.csv`가 생성되어야 한다. 이전·현재 실행 manifest의 소스 게이트가 모두 PASS이고 공사범위·규칙버전·수량/KRW 허용오차가 같을 때만 `RESOLVED`, `UNCHANGED_FAIL`, `NEW_FAIL`을 센다. 조건이 다르면 `CONDITION_CHANGED`, 사라진 항목은 `NOT_COMPARABLE`, 비교 키 중복은 `REVIEW_DUPLICATE`여야 한다. 이전/현재 report를 수정한 뒤 실행하면 manifest의 결과 SHA-256과 불일치하여 비교를 거부해야 하며 기존 비교 CSV를 덮어쓰지 않아야 한다.

설치 실패 시 `Desktop.rollback` 또는 `Desktop.new`가 남을 수 있다. 메시지에 표시된 폴더를 수동 복원하거나 보관하기 전에는 설치기를 다시 실행하지 않는다. 설치기는 잔존 복구 폴더를 덮어쓰지 않는다.

비-UI 실행 경계는 Windows가 아닌 환경에서도 다음 명령으로 검증한다.

```bat
dotnet run --project tests\Lukas.Qto.Desktop.SelfTest\Lukas.Qto.Desktop.SelfTest.csproj -c Release
```

현재 macOS/Linux에서는 WPF 창 자체를 실행할 수 없으므로, 실제 창 렌더링·파일 선택 대화상자·Windows 오프라인 실행은 미검증 외부 게이트다. 이 self-test는 WPF가 호출하는 동일한 `DesktopPreflightRunner.cs`를 링크해 Core와 의미상 동일한 판정, 소스 게이트 차단, CSV/HTML/manifest 생성을 검증한다.
