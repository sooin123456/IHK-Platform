# 한길시스템 Revit 2025 베타 설치 키트

이 ZIP은 한길시스템이 Windows에서 미리 빌드하고 SHA-256을 검증한 초대형 베타
설치본입니다. 테스터는 소스코드를 빌드하지 않으며 관리자 권한 없이 현재
사용자에게만 설치합니다.

## 필요한 환경

- Windows 10/11
- Autodesk Revit 2025
- Revit 2025의 실행 권한
- 관리자 권한은 시스템 전체 설치에만 필요함

`.NET 8 SDK`는 필요하지 않습니다. 공식 ZIP에 `build\Release\2025`의 DLL과
무결성 표식이 없으면 설치하지 말고 ZIP을 다시 받으십시오.

## 가장 쉬운 검증 절차

1. ZIP을 **먼저 압축 해제**한다. ZIP 안에서 직접 실행하면 안 된다.
2. Revit을 완전히 종료한다.
3. 루트의 `1-INSTALL-2025.bat`을 실행한다. 기존 링크를 위해 남긴
   `1-BUILD-INSTALL-2025.bat`도 같은 **무빌드 설치**를 실행한다.
4. 성공 메시지가 나오면 Revit 2025를 시작해 `한길시스템` 탭을 확인한다.
5. 탭이 없으면 Revit을 종료하고 `2-DIAGNOSE-2025.bat`을 실행한다.

결과 로그와 JSON은 모두 같은 폴더의 `field-evidence`에 생성된다.

설치기는 현재 사용자 위치와 전체 사용자 위치를 함께 확인합니다. 다른 위치에
`Lukas.Qto.addin` 또는 `THEKIE.Qto.addin`이 활성화돼 있으면 공용 파일을 임의로
바꾸지 않고 정확한 충돌 경로를 알려준 뒤 중단합니다. 기존 공용 설치는 관리자에게
제거를 요청하고, 사용자 설치는 이 ZIP의 제거 도구로 정리한 뒤 다시 실행하십시오.
실패했다고 같은 설치 파일을 반복 실행하지 말고 `field-evidence` 폴더를 먼저
확인하십시오.

## 개발자용 패키지 생성 절차

Revit 2025 예시:

```bat
deploy\build-all.bat 2025 addin-only
powershell -ExecutionPolicy Bypass -File deploy\package-release.ps1 -OutputDirectory C:\release
```

`addin-only` 사용자 설치는 Revit 2025 추출 애드인만 현재 계정에 설치한다.
시스템 전체 설치가 필요한 관리 환경에서는 기존 `deploy\install.bat 2025`를
관리자 권한으로 사용한다.

개발자만 Revit API와 .NET 8 SDK가 설치된 검증 PC에서 위 명령으로 ZIP을 만듭니다.
테스터는 생성된 ZIP의 SHA-256을 확인하고 다음만 수행합니다.

1. Revit을 다시 시작한다.
2. `한길시스템 > BIM 물량·적산 > Properties 추출`을 누른다.
3. 빈 폴더에 `element-ledger.csv`를 만든다.
4. PowerShell에서 결과 계약을 확인한다.

```powershell
powershell -ExecutionPolicy Bypass -File deploy\verify-properties-ledger.ps1 -LedgerPath "D:\QTO\element-ledger.csv"
```

5. `IFC·QTO 내보내기`도 실행했다면, 만들어진 **최종 패키지 폴더**를
   `3-VERIFY-EXTRACTION-2025.bat` 위로 끌어다 놓는다. 이 파일은 패키지를 바꾸지 않고
   `field-verification.json`을 같은 폴더에 만든다.
6. 검증 JSON에서 `schema_version=revit-properties-evidence-v2`,
   `physical_category_filter=built-in-category-physical-v1` 및
   `excluded_non_quantity` 수를 확인한다. `<Sketch>`, Materials, Legend Components는
   CSV에 없어야 한다.
7. 서로 다른 요소 5개를 골라 Revit Properties 창과 CSV의 이름, 체적, 길이,
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
powershell -ExecutionPolicy Bypass -File deploy\diagnose-revit-addin.ps1 -RevitVersion 2025 -Scope Auto
```

이 명령은 User와 Machine 설치 위치를 모두 확인하고, 중복 manifest, Assembly
절대 경로, 동일한 애드인 등록 ID, DLL SHA-256, Revit의 전체 Product/File Version,
재시작 여부를 JSON으로
남깁니다. 모델과 Revit 설정은 수정하지 않습니다.
