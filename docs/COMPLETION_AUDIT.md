# 완료 감사 — 2026-08-13

완료 판정은 코드가 존재한다는 사실이 아니라, 인수인계가 요구한 증거가 있는지로 한다.

| 인수인계 요구 | 상태 | 현재 증거 또는 미충족 사유 |
|---|---|---|
| 숫자에 LLM을 쓰지 않는 결정론적 L1 | 완료 | `Lukas.Qto.Core`와 self-test가 R010·R011·R012·R020·R021·R022·R023·R030을 실행한다. LLM·외부 패키지 의존성이 없다. |
| IFC·QTO 동일 실행 패키지 | 부분 완료 | Revit 명령이 `model.ifc`, `qto.csv`, `element-ledger.csv`, 16열 `export-manifest.csv`를 GUID staging에서 만들고 세 파일 SHA·행 수·QTO/ledger 요소ID 집합을 검증한 뒤에만 최종 폴더로 이동한다. 실제 Autodesk DLL·Revit에서 IFC 재개방은 미검증이다. |
| Revit 원시 Properties 추출 | 부분 완료 | `Properties 추출` 리본 명령이 요소 하나당 V2 15열 CSV를 만들도록 구현했다. 이름, 체적·길이·높이, 각 `COMPUTED/ZERO/MISSING` 상태와 선택된 Revit built-in parameter를 보존하며 값을 추정하지 않는다. QTO·Properties·패키지는 같은 built-in physical category 필터를 사용해 `<Sketch>`, Materials, Legend Components 같은 보조 객체를 제외한다. evidence V2와 `deploy/verify-properties-ledger.ps1`는 필터 버전·제외 수·CSV SHA를 함께 확인한다. 자동 테스트는 통과했지만 실제 Revit 2025에서 요소 5개를 Properties 창과 대조하는 현장 증거와 이 변경을 포함한 설치 파일은 아직 없다. |
| IFC-QTO provenance 연결 | 완료(로컬 계약) | 4-slot source manifest와 S006이 IFC/QTO의 scope·revision·관계 선언을 검사한다. Desktop `프로젝트 만들기`는 COMPLETE export manifest의 IFC/QTO SHA를 다시 확인한 뒤 복사·등록한다. 수기 source manifest의 S006 PASS는 같은 export run의 독립 증명이 아니라 선언 일치이며, 문서에 한계를 명시했다. |
| 설치형 검산기·재검산 | 완료(비-UI 로컬 범위) | .NET 8 WPF 화면과 같은 runner가 source gate hard-block, CSV·HTML·실행 manifest 원자 출력을 수행한다. 프로젝트 생성, 결과 SHA 결합, `RESOLVED`·`UNCHANGED_FAIL`·`NEW_FAIL`·조건 변경 비교를 Desktop self-test에서 검증했다. 실제 Windows WPF 렌더링·파일 대화상자·설치 실행은 미검증이다. |
| Windows 현장 패키지 검증 | 구현 완료, 실기 미검증 | `deploy/verify-field-package.ps1`가 COMPLETE package의 16열 manifest·IFC/QTO/Properties ledger SHA·QTO 검산키·요소ID·행/요소 수를 독립 검사해 증거 JSON을 남긴다. 실제 Revit/IFC 뷰어에서의 재개방과 요소 선택은 수동 게이트로 남는다. |
| 범위·개정·원본 혼합 방지 | 완료(L1.4.3 계약 범위) | 안전 CLI가 SHA 기반 소스 매니페스트를 필수로 받고 S001~S005를 먼저 실행한다. 미등록·slot 오용·혼합 scope·비활성 개정을 차단하며 실행 manifest에 소스 매니페스트 해시·범위·소스 ID를 고정한다. 전자서명 권한장은 아니므로 악의적 공동변조 방어는 별도다. |
| QTO 요소 역추적 | 부분 완료 | CSV에 실제 요소ID를 보존하고, 메타데이터 SHA-256 검산키의 대문자 정규화·재계산·중복 금지, 양의 정수 요소ID 정규화·행/전체 중복 금지, `수량 ≥ 1`과 ID 개수 일치를 입력과 Core에서 강제하며 스텁 테스트를 통과했다. 빈 모델은 헤더 CSV를 남긴다. 실제 Revit 모델에서 역추적한 증거는 없다. |
| QTO 내보내기→검산 입력 연결 | 완료(스텁 범위) | Revit 스텁에서 집계한 QTO를 실제 CSV로 내보내고 L1 CSV 파서로 재입력하여 요소ID·수량·체적·면적 보존을 테스트한다. 실제 Revit 파일 내보내기 검증은 별도다. |
| 실무 콘크리트 산출 | 부분 완료 | Revit element ledger→정확 Include/Exclude 매핑→공제·할증·반올림→근거 report가 Desktop 버튼으로 연결됐다. 네 파일 패키지와 모든 규칙 입력 SHA를 결과에 묶는다. 사용자 선택 registry는 관리자 trust가 없으면 REVIEW다. 실제 ZG raw 405.540m³→official 409.221m³의 3.681m³는 승인 규칙이 없어 REVIEW다. |
| 실무 거푸집 산출 | 부분 완료 | face gross/net, opening union, 접촉면, PE·비드·PF 분리 코어와 Revit Solid face 전용 extractor/원장 버튼을 구현했다. generic AreaM2는 쓰지 않는다. 실제 Revit geometry와 사람이 승인한 경계·개구부 판정을 Desktop 결과로 연결하는 현장 검증이 남았다. |
| 실무 철근 산출 | 부분 완료, 승인 변환표 미확보 | 규격별 길이·단위중량·손율·추가길이·반올림 코어 및 Desktop CSV 실행/report를 구현했다. 실제 ZJ official 31,908.817kg은 현재 원장과 일괄 3%로 재현되지 않으며 MDB/ACCDB 또는 승인 규칙표 근거 전에는 REVIEW다. |
| Revit 2017·2022~2026 호환 | 부분 완료 | 2017·2022·2023·2024·2025·2026 조건부 소스 컴파일과 집계 테스트를 통과했다. 2017은 실제 `net46`로 링크했으며 스텁은 `UnitTypeId`를 제공하지 않아 구형 단위변환 분기를 확인한다. 다만 실제 Autodesk DLL의 빌드·리본·요소 수집·저장은 미검증이다. |
| Revit·Desktop 설치 산출물 | 부분 완료 | build 표식은 버전·TFM·API 경로·비-스텁·DLL SHA를 고정하고 Desktop `win-x64` 게시본의 파일별 SHA marker를 만든다. `install.bat`은 Revit 종료, 5행 add-in 표식, Desktop 파일 marker, source/stage/installed 해시와 rollback을 확인하며 legacy 매니페스트를 `.disabled`로 보존한다. 실제 Windows cmd·WPF·Revit 시작에서의 증거는 아직 없다. |
| 실제 내역 Excel 지원 | 부분 완료 | 현재 프로젝트의 0910·EMS7·0614 두 리비전을 직접 읽었다. R010은 96·96·191·186개가 PASS했다. R011은 94·94·188·183개가 PASS했고 명시 수량이 없는 2·2·3·3개 행은 NOT_EVALUATED다. 음수 고철 공제 2건은 계산 검증 후 BIM 대조에서 제외한다. 0910·EMS7은 핵심 7개 시트의 저장값 13,855개와 확장 수식 4,476개가 동등하다. 스타일·병합·외부링크·비교 대상 밖 시트의 동일성은 주장하지 않는다. 다른 현장 양식과 EMS 앱 원본은 미검증이다. |
| 실제 원가계산서 총액 | 완료(현재 EMS 계열 산술) | 0910·EMS7은 R012 8단계가 모두 PASS해 총공사비 80,487,000원을 재현했다. 0614 두 리비전은 BS와 D7·DK/DL/DM을 포함한 내부 총액 5단계가 PASS해 957,201,444원과 950,271,444원을 재현했고, 배분 근거 없이 차이가 있는 AS·CS 2단계는 NOT_EVALUATED다. 요율의 법적 적정성은 R012/L1이 판단하지 않으며, 근거와 라이선스가 확보된 뒤 L2에서 다룬다. |
| ZG·ZJ 구조수량 anchor | 부분 완료 | OOXML 시트·표제 스키마로 ZG 02/03과 ZJ 01의 6개 공식 집계 일치를 재현했다. 공식 SUM/직접 참조를 leaf까지 재귀 검산한다. ZG 04A 1,092행·ZJ 02 865행을 signed ledger로 가져오며 막자갈 분류 후 미분류 264행·24행도 보존하고 산식은 전 행에서 검산한다. 숫자 셀 타입·child SQ001·승인 ID 집합 해시·철근 근거 게이트를 구현했지만 MDB/JOYST 규칙과 미분류 행이 승인되기 전 raw→official은 REVIEW다. |
| L2 표준품셈·단가 대조 | 미착수 | 상업적 저장·가공·재배포 권리가 서면으로 확인되지 않았다. |
| 공공조달 경쟁·조달 방식 확인 | 부분 완료 | 조달청의 AI 전환·내부 적용은 확인했다. 공사원가 AI의 상세 범위와 외부 조달 여부는 공개 자료로 확인되지 않았다. |
| 적산 전문가의 실제 오류 판정 | 미검증 | 프로젝트 원본과 전문가 기대 결과가 제공되지 않았다. |

## 결론

Lukas QTO는 실무 물량추출을 본체로, IFC·QTO 패키지와 근거 검산을 검증·전달 계층으로 재정렬했다. 첫 공개 기능은 요소별 이름·체적·길이·높이를 근거와 함께 남기는 `Properties 추출`이다. 콘크리트는 Desktop 실행까지, 거푸집은 Revit face 원장까지, 철근은 Desktop 계산까지 연결됐다. 그러나 실제 Autodesk 환경의 Properties 산출 증거와 설치 파일 검증, 거푸집 경계 승인, ZJ 철근 MDB 규칙이 남아 있어 아직 **Windows/Revit 현장검증 전 파일럿 후보**이며 완성 제품이라고 주장할 증거는 없다.

다음 진행에는 외부 상태 변화가 필요하다: Windows/Revit 실기 결과, ZG·ZJ 및 관급 구성비를 설명하는 원본 분류 근거 또는 적산 전문가 검토, L2 라이선스 서면 답변. 제공 폴더의 충돌과 구현 순서는 [프로젝트 소스 감사](PROJECT_SOURCE_AUDIT.md), 상세 외부 절차는 [결정 게이트](DECISION_GATE.md)와 [Windows/Revit 검증 절차](WINDOWS_REVIT_VERIFICATION.md)를 따른다.
