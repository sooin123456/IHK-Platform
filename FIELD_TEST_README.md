# Lukas QTO Field Test Kit

이 ZIP은 **정식 설치본이 아닌 현장 검증용 소스 키트**입니다. Revit이 설치된
Windows PC에서 직접 빌드한 뒤, `Properties 추출`의 실제 결과를 확인하기 위해
제공합니다. 빌드가 끝난 뒤에는 관리자 권한 없이 현재 사용자에게만 설치할 수
있습니다.

## 필요한 환경

- Windows 10/11
- Autodesk Revit 2017 또는 2022–2026 중 하나
- 해당 Revit 버전의 실행 권한
- .NET 8 SDK x64
- 관리자 권한은 시스템 전체 설치에만 필요함

Revit 2017은 .NET Framework 4.6 Targeting Pack 또는
`Microsoft.NETFramework.ReferenceAssemblies.net46` NuGet 캐시가 필요할 수 있다.

Revit 2025에 포함된 .NET Runtime만으로는 소스 빌드를 할 수 없다. 아래 공식
페이지에서 **.NET 8 SDK x64**를 설치하고 Windows를 다시 시작해야 한다.

https://dotnet.microsoft.com/download/dotnet/8.0

## 가장 쉬운 검증 절차

1. ZIP을 **먼저 압축 해제**한다. ZIP 안에서 직접 실행하면 안 된다.
2. Revit을 완전히 종료한다.
3. 압축을 푼 폴더에서 `deploy\build-all.bat 2025`를 실행한다. 이 소스 키트는
   빌드에 .NET 8 SDK가 필요하다.
4. Revit을 종료한 뒤 `deploy\install-user-2025.bat`을 실행한다. 이 설치는
   관리자 권한이 필요 없으며 현재 사용자 계정에만 설치한다.
5. 성공 메시지가 나오면 Revit 2025를 시작해 `Lukas QTO` 탭을 확인한다.
6. 탭이 없으면 Revit을 종료하고 `2-DIAGNOSE-2025.bat`을 실행한다.

결과 로그와 JSON은 모두 같은 폴더의 `field-evidence`에 생성된다.

## 명령줄 검증 절차

Revit 2025 예시:

```bat
deploy\build-all.bat 2025
deploy\install-user-2025.bat
```

사용자 설치는 Revit 2025 애드인과 Desktop 검산기를 현재 계정에만 설치한다.
시스템 전체 설치가 필요한 관리 환경에서는 기존 `deploy\install.bat 2025`를
관리자 권한으로 사용한다.

1. Revit을 다시 시작한다.
2. `Lukas QTO > 수량·검산 > Properties 추출`을 누른다.
3. 빈 폴더에 `element-ledger.csv`를 만든다.
4. PowerShell에서 결과 계약을 확인한다.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\verify-properties-ledger.ps1 -LedgerPath "D:\QTO\element-ledger.csv"
```

5. 서로 다른 요소 5개를 골라 Revit Properties 창과 CSV의 이름, 체적, 길이,
   높이, state, source parameter를 비교한다.

## 보내줄 결과

- `element-ledger.csv`
- `element-ledger.csv.field-verification.json`
- Revit 버전과 Windows 버전
- 빌드/설치 중 오류가 있으면 전체 콘솔 메시지 또는 화면 캡처

RVT 원본 모델은 보내지 않아도 된다. 민감한 요소 이름이 있다면 CSV의 이름을
가린 뒤에도 수치·state·source parameter·element_id 형식은 보존해 달라.

## 제한

- 이 키트는 웹에서 RVT를 처리하지 않는다.
- UCF Exporter를 복제하지 않는다.
- 누락값을 계산하거나 보정하지 않는다. `MISSING`은 그대로 남긴다.
- 이 검증이 통과하기 전에는 정식 설치 ZIP이나 상용 출시로 보지 않는다.

상세 절차는 `docs\WINDOWS_REVIT_VERIFICATION.md`를 따른다. PowerShell을
`C:\Windows\System32`에서 열고 `deploy\...` 같은 상대경로를 실행하지 않는다.

## 리본이 보이지 않을 때

Revit을 완전히 종료한 다음 아래 진단을 실행하고 생성된 JSON을 함께 보낸다.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\diagnose-revit-addin.ps1 -RevitVersion 2025 -Scope User
```

이 명령은 `Lukas.Qto.addin` 위치, Assembly 절대 경로, DLL 존재·SHA-256,
기존 THEKIE manifest 충돌, Revit 재시작 필요 여부만 읽는다. 모델과 Revit 설정을
수정하지 않는다.
