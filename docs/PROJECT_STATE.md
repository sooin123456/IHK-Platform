# 프로젝트 상태

## 1HK 도면 협업 플랫폼 진행 상태 (2026-08-23)

- 목표는 축소하지 않는다. IFC 3D와 PDF 2D를 같은 프로젝트에서 열고,
  객체·페이지 위치 근거에 이슈, 댓글, 담당자, 기한, 상태, 개정 재검토,
  알림, 승인, 감사 이력을 연결하는 완성형 도면 협업 플랫폼이 최종 기준이다.
- 도면 목록·IFC/PDF 협업실·공통 이슈·담당자·감사 이력·개정 재검토·Realtime
  알림을 구현했고 운영 Supabase와 Vercel에 배포했다.
- 운영 DB는 5개 도면 테이블의 RLS, 최소 권한, Realtime 3개 테이블,
  외래키 인덱스와 rollback 기반 owner/viewer 권한 검사를 통과했다.
- 현재 상태는 **코드·DB 운영 배포 완료 / 실제 2인 현장 검증 대기**다.
  서로 다른 소유자·검토자가 실제 IFC/PDF로 데스크톱과 모바일 전체 흐름을
  끝내기 전에는 최종 완성으로 표시하지 않는다.
- 고정 검증 기준과 비식별 증거 양식은
  `docs/DRAWING_COLLABORATION_FIELD_CHECK.md`에 기록한다.
- 최신 운영 commit은 `42d0af4`, Vercel deployment는
  `dpl_Avd2huenCGqy5KQ3jbRYQUC8o5Co`이다. 도면 이슈를 50건 단위로 서버
  조회하고 오래된 이슈 직접 링크·IFC 객체 선택을 보존하며, 동일 갱신 시각의
  행도 고유 ID로 안정 정렬한다. 저장 근거를 열면 IFC 요소·카메라 또는 PDF
  페이지·영역을 복원하고, 같은 IFC의 query·Realtime 갱신은 모델을 다시
  파싱하지 않는다.
- 최신 플랫폼 검증은 Node 계약 115/115, TypeScript, production build와 실제
  Revit IFC(560요소·7,904 triangles) geometry smoke를 통과했다. 운영
  Playwright는 Vercel CLI가 Sensitive 값을 `[SENSITIVE]`로 내보내는 보안
  경계에서 테스트 데이터 생성 전에 중단됐으며 성공으로 간주하지 않는다.
- 운영 4역할 Playwright 코드는 준비됐지만 Vercel CLI는 Sensitive 값을
  마스킹하고, 현재 GitHub OAuth/App은 workflow 파일 쓰기 권한이 없다.
  권한을 우회해 비밀값을 노출하지 않으며, 마스킹되지 않은 service-role을
  안전한 실행 환경에 주입한 실제 성공 run은 아직 남았다.
- 최신 운영 배포의 최근 24시간 Vercel error 로그는 0건이었다. 실제 2인
  사용 중 renderer 오류·서명 URL 반복·Realtime 재연결 횟수는 현장 run에서
  별도로 기록해야 한다.

## 현재 완성된 범위

- 제품 우선순위는 **실무 물량추출 → 내역 집계 → 근거 검산** 순서로 고정했다. 검산·해시·리비전은 추출 결과를 증명하는 계층이다.
- 콘크리트 vertical slice가 ZG/ZJ signed ledger를 막자갈·무근·철근콘크리트로 변환하고, 승인된 spec별 공제·할증·적용단위·반올림 규칙만 계산한다. Revit 요소ID 또는 원본 SHA·셀을 보존하며 공통 키별 차이와 총차 closure를 검사한다.
- 거푸집 vertical slice가 gross/net face, opening union, 경계 종류, 포함/제외 정책을 검증하고 PE필름·비드·PF단열을 순수 거푸집과 분리한다. 현재 generic `AreaM2`는 상세 거푸집으로 PASS하지 않는다.
- 철근 vertical slice가 규격별 signed 길이·단위중량·손율·추가길이·반올림 단계를 계산하고, 원시 산식에 이미 포함된 정착·이음 등의 중복 추가와 공식 target 순환검증을 차단한다.
- 콘크리트 bridge·산출·reconciliation 결과는 고정밀 CSV와 SHA manifest로 원자 생성하며 상태·공식·규칙 해시·원본 근거·요소ID를 무손실 round-trip한다.
- Revit 요소별 Properties ledger V2는 집계 전 element ID·category·family·type·**element name**·level과 체적·길이·높이 각각의 `MISSING/ZERO/COMPUTED`, 실제 source parameter를 분리해 보존한다. 재료·규격은 이름으로 추정하지 않는다.
- Revit 수량 집계 CSV에 검산키와 실제 요소ID 목록을 보존한다.
- Revit 리본의 `IFC·QTO 내보내기`가 같은 문서 실행에서 `model.ifc`, `qto.csv`, `element-ledger.csv`, 16열 `export-manifest.csv`를 GUID staging으로 만들고, 세 파일 SHA·행·요소ID 집합이 검증될 때만 최종 패키지로 이동한다.
- Desktop의 `콘크리트 산출`은 COMPLETE 패키지와 승인 형식의 Include/Exclude 매핑·계산 규칙·registry를 다시 해시 검증한 뒤 element ledger에서 근거 report를 생성한다. 사용자 선택 registry는 계산 일관성만 확인하며 관리자 trust-store에 registry SHA가 없으면 REVIEW다.
- Revit 리본의 `거푸집 Face 원장`은 generic AreaM2가 아닌 Solid face 면적과 stable reference 근거를 별도 원장·SHA manifest로 출력한다. 경계·접촉·개구부 판정은 자동 추정하지 않아 초기 상태는 REVIEW다.
- Desktop의 `철근 산출`은 길이 ledger·규격별 단위중량/손율/반올림 규칙·독립 공식 kg를 읽어 결과 report를 생성한다. 실제 ZJ 승인 규칙이 없으면 PASS하지 않는다.
- 설치형 Desktop 검산기가 COMPLETE Revit 패키지·내역·승인 매핑으로 해시가 고정된 4-slot 프로젝트를 만들고, IFC provenance(S006)·L1 검산·결과 CSV/HTML/manifest·이전 결과 비교를 실행한다.
- 순수 C# L1 엔진이 EMS 구성단가 합계·내역 산술·승인된 BIM 매핑 수량을 검산한다.
- L1 범위·조달청 경쟁 위험·L2 착수 금지 조건은 `docs/DECISION_GATE.md`에 고정한다.
- CLI가 QTO CSV·내역 CSV/XLSX·매핑 CSV/XLSX에서 결과 CSV·공유용 HTML·실행 manifest를 생성한다.
- SHA 기반 소스 매니페스트가 QTO·내역·매핑의 slot·scope·최신 ACTIVE 개정을 계산 전에 확인한다.
- 외부 패키지 없이 self-test 프로젝트를 제공한다.
- ZG/ZJ 구조수량 파일은 확장자가 아닌 OOXML 시트·표제 스키마로 인식하고, 공식 anchor·signed ledger·복합 bucket·철근 kg 근거를 분리한다.
- 웹 프로젝트에 증거 기반 자동 검토 흐름을 추가했다. 요소 원장 업로드 시 원본 SHA·규칙 버전에 묶인 중복 Element ID·수량 상태·분류·속성 누락 제안만 생성하고, 원본 수량은 변경하지 않는다. 같은 프로젝트의 직전 요소 원장과 안정 Element ID로 비교해 추가·삭제·분류·물량 속성 변경을 두 원본 SHA가 포함된 개정 제안으로 남긴다. 사용자의 승인·기각·보류와 근거 메모는 제안과 분리된 append-only 이력으로 보존한다. 향후 AI는 같은 제안 계약을 사용하며 최종 계산 권한을 갖지 않는다.
- 한길시스템 담당자는 제안 근거와 시간순 사람 결정 라벨을 `LUKAS_SUGGESTION_FEEDBACK_V1` JSON으로 내보낼 수 있다. 평가 데이터에는 사용자 ID와 자유서술 결정 메모를 제외하며, AI 평가셋으로만 사용하고 계산·승인 권한을 부여하지 않는다.
- 담당자 전용 `LUKAS_AI_SUGGESTIONS_V1` 가져오기는 선택한 원본 SHA와 일치하는 오프라인 AI 제안만 허용한다. 알 수 없는 필드와 수량·금액·판정 확장 필드는 거부하고, AI JSON 원본도 별도 SHA의 비공개 파일로 보존한다. AI 제안은 동일한 사람 승인·기각 흐름에만 들어가며 계산 결과를 수정하지 않는다.
- 프로젝트 화면은 생성기 종류·버전·제안 유형별 총 제안, 최신 사람 결정의 승인·기각·보류·미결정, 검토율과 승인률을 표시한다. 승인/기각 표본이 없으면 승인률은 `판정 불가`이며, 아직 어떤 임계값이나 자동 승격도 적용하지 않는다.
- 웹 프로젝트는 Core의 `CONCRETE_TAKEOFF_CSV_V1` report·manifest 쌍을 등록 전에 다시 검증한다. report/manifest SHA-256, 무손실 decimal, PASS 행의 계산식·규칙 해시·원본 근거·Element ID와 export manifest·IFC·QTO·element ledger·Revit mapping·concrete rule·registry 7개 입력 SHA를 하나의 산출 artifact로 묶는다. 각 입력은 같은 프로젝트에 보관된 예상 kind의 불변 파일 ID·SHA와 복합 외래키로 연결되어야 하므로 임의 SHA만 적은 manifest는 승인 흐름에 들어오지 못한다. 상세 화면은 원본 파일을 다시 읽어 동일 검증을 통과한 경우에만 기본수량·공제·보정·최종수량·계산식·승인 규칙·요소 근거와 전체 사람 결정 이력을 표시한다. 사람의 승인·기각·보류는 원본과 분리된 append-only 이력이며 AI가 작성할 수 없다.
- 동일 프로젝트·자료 종류의 새 파일은 직전 파일 ID·SHA와 새 파일 ID·SHA를 명시적인 `supersedes` 간선으로 연결한다. DB trigger가 같은 kind·시간 방향을 확인하고 predecessor/current 양쪽 unique 제약으로 동시 업로드 분기를 차단한다. 파일명이나 수정시각만으로 개정을 추정하지 않으며, 같은 최신 SHA 재업로드도 거부한다.
- CLI/Desktop의 L1 사전검토 report·실행 manifest도 별도 웹 artifact로 연결한다. 소스 게이트 PASS·공사범위·엔진 해시·허용오차·report SHA를 검증하고 QTO·내역서·매핑·소스 manifest·선택 IFC가 같은 프로젝트의 예상 kind·파일명·SHA와 정확히 일치해야 등록된다. 상세 화면은 bundle을 다시 검증해 규칙별 기대값·실제값·차이·근거와 append-only 사람 승인 이력을 보여준다.
- 공개 웹은 `/news` 회사 소식·현장 검증·제품 업데이트, `/news.xml` RSS와 `/download` Revit 2025 무료 베타 상품 흐름을 제공한다. 현재 가격은 0원이며 카드·결제정보를 받지 않는다. HTTPS 배포 URL과 64자리 SHA-256이 모두 설정된 경우에만 다운로드 버튼이 활성화된다. 오해 가능성이 있는 Toss/NFT 데모 결제 코드와 의존성은 제거했다. 향후 유료 전환은 서버 발급 주문·서명된 결제 확인·릴리스 SHA에 결합된 다운로드 권한·환불 계약을 별도 구현한 뒤에만 허용한다.

## 마지막 검증

- `dotnet build src/Lukas.Qto.Preflight/Lukas.Qto.Preflight.csproj -c Release --no-restore` 성공 (경고 0, 오류 0)
- `dotnet run --no-restore --project tests/Lukas.Qto.Core.SelfTest/Lukas.Qto.Core.SelfTest.csproj -c Release` 성공
- `tests/run-cli-integration.sh` 성공: 안전·우회·빈 내역·위험 기계 ID·manifest CSV 수식 방어·기존 결과 덮어쓰기·심볼릭 방지·slot 오용·바이너리 해시를 프로세스 단위로 검증
- `tests/run-revit-stubs.sh`는 물리 객체 필터 변경 직후 2017·2022~2026을 순차 빌드·실행해 모두 통과했다. evidence V2 변경 뒤에는 호환성 경계인 2017·2025·2026을 다시 빌드·실행해 경고·오류 없이 통과했다. 이는 Revit API 스텁 검증이며 실제 Windows/Revit 실행을 대체하지 않는다.
- 샘플 QTO·내역·매핑 CSV로 결과 보고서 생성 성공 (R011 PASS, R021 PASS)
- EMS 구성단가 합계(R010)가 총단가 불일치를 별도로 검출하며, 매핑 오류 시 R021을 NOT_EVALUATED로 남기는 self-test를 통과함.
- XLSX 첫 워크시트의 공유 문자열, inline 문자열, 수치, 저장된 수식값을 읽는 self-test 통과. EMS의 `공종별내역서`는 우선 선택한다. 실제 0910과 동일한 EMS7에서 각각 R010 96개가 PASS했고, R011은 명시 수량이 있는 94개가 PASS·빈 수량 2개가 NOT_EVALUATED다. 음수 고철 공제 2개는 계산 검증 후 BIM 대조에서 제외한다.
- CSV 파서는 인용된 쉼표·큰따옴표·줄바꿈을 보존하는 self-test를 통과함.
- 역방향 커버리지 규칙 R022(미매핑 BIM)와 R023(다중 내역 매핑)를 `REVIEW / INFO`로 출력하며 self-test를 통과함.
- 모든 셀을 텍스트 타입으로 고정한 XLSX 매핑 템플릿과 QTO 인덱스를 CLI로 생성하고, 숫자형 기계 ID 보존 및 `승인=Y` 행만 매핑으로 읽는 흐름을 self-test·CLI 샘플로 검증함.
- 모든 검산 실행은 규칙 버전·코어·CLI 어셈블리 SHA-256·허용오차·UTC 시각·입력 파일과 소스 매니페스트 SHA-256·범위·소스 ID·게이트 상태를 포함한 sidecar manifest를 생성하며 self-test·CLI 샘플로 검증함.
- 현재 규칙 버전은 `L1.4.3`이며 manifest와 HTML이 하나의 버전 상수를 공유한다.
- S001~S005가 미등록 해시, slot 오용, 범위 혼합, 폐기·미결정 개정, XLSX 수식 파생 관계 오류를 차단한다. 게이트 실패 시 R 규칙은 실행하지 않고 소스 결과와 실행 manifest만 남긴다. 우회 실행은 `--unsafe-no-source-gate`를 명시하고 S000 REVIEW와 종료 코드 3을 남긴다.
- 소스 게이트 self-test는 정상 흐름, 필수 slot, 범위 혼합, SUPERSEDED 선택, 역방향 개정 관계, 경로 탈출, SHA 변조, 결과 불변성을 검증했다. 안전 CLI 샘플은 S001~S005와 R011·R021이 모두 PASS했고 잘못된 slot 입력은 종료 코드 1과 차단 보고서를 남겼다.
- 구조 workbook adapter가 ZG 02/03의 콘크리트 409.221m³·형틀 패키지 2,781.316m²·철근 30,886.375kg과 ZJ 01의 450.781m³·2,717.205m²·31,908.817kg을 독립 집계 셀 간에 재현했다. 이는 공식 보고값 일치이며 raw→official 재산출 PASS를 의미하지 않는다.
- 실제 ZG 04A 원시 원장 1,092행과 ZJ 02 원시 원장 865행을 공통 signed-row로 읽어 SHA·시트·행·산식·부호를 보존했다. `막자갈깔기` 규격을 콘크리트 bedding으로 근거 분류한 뒤 명시 버킷에 속하지 않는 ZG 264행·ZJ 24행도 삭제하지 않고 `Unknown`으로 남기며, Unknown 행도 산식 불일치는 FAIL한다. 결과·개소 셀은 저장값을 가진 OOXML 숫자 타입만 허용한다.
- 실제 ledger→콘크리트 bridge는 ZG 145행 raw 405.540m³와 official 409.221m³ 사이의 미설명 3.681m³를 REVIEW로 남긴다. ZJ 106행 raw와 official은 450.781m³로 같지만 승인 raw→official 규칙을 적용한 것이 아니므로 bridge 자체는 REVIEW다.
- ZG/ZJ 공식 anchor의 SUM·직접 참조는 하위 leaf까지 재귀 계산해, 하위 값만 바꾸고 중간·최종 저장 캐시를 남기는 변조를 차단한다. SQ002는 모든 child SQ001이 PASS해야 PASS하며, 승인 registry 사용 시 expected ledger ID 집합 자체의 canonical SHA도 승인 규칙에 고정한다.
- SQ001~SQ003 규칙은 개별 산식·signed ledger 완전성·child bucket 합계·철근 배근중량 근거를 검산한다. 원본·규칙 SHA가 독립 승인 registry와 다르거나 MDB/JOYST 환산 규칙이 없으면 REVIEW다.
- 실제 0910 원가계산서에서 R012 8단계(재료·노무·경비 소계, 순공사원가, 공급가액, 부가세, 도급액, 총공사비)가 모두 PASS했고 총공사비 80,487,000원을 재현함.
- 0910과 EMS7 XLSX의 핵심 7개 시트를 공유수식 확장 후 비교해 저장값 13,855개와 수식 4,476개가 모두 동일한 `EXACT_EQUIVALENT`임을 확인했다. EMS7을 수식 평탄화본으로 분류하지 않는다.
- QTO 입력은 분류·패밀리·타입·레벨 SHA-256 검산키를 대문자 64자리로 정규화·재계산하고 중복 집계행을 파서에서 차단한다. 요소ID는 양의 정수로 정규화하며 행 안·전체 행 간 중복, `수량 < 1`, 요소ID 개수 불일치를 차단한다. 빈 모델 내보내기는 헤더만 있는 QTO CSV를 남긴다. Core 직접 호출에서도 위반 QTO를 R030 FAIL로 남기고 R021 PASS에 사용하지 않는다.
- 실제 0614 두 리비전에서 R010은 191개와 186개가 PASS했다. R011은 각각 188개·183개가 PASS하고 빈 수량 행 3개씩은 NOT_EVALUATED다. R012는 `D7` 별도비와 `DK/DL/DM` 관급·폐기물 가산을 포함해 BS 및 내부 총액 5단계가 PASS하고, 구성비 배분 근거 없이 차이가 있는 AS·CS 2단계는 NOT_EVALUATED다. 각각 총공사비 957,201,444원과 950,271,444원을 재현한다.
- 결과 HTML은 의존성 없는 단일 파일이며, 실패·검토 필요 요약과 모든 규칙 결과를 표시하고 HTML 이스케이프 self-test를 통과함.
- 일반 내역 및 QTO의 음수값은 R030 오류로 차단한다. EMS의 수량·금액 동시 음수 조정 행만 R010·R011을 검증하고 R021에서 제외하는 self-test를 통과함.
- CSV 숫자는 실행 PC 지역설정과 무관한 고정 형식으로 해석하며, 소수점 쉼표 입력을 거부하는 self-test를 통과함.
- 중복 헤더는 입력 단계에서, 같은 내역ID·검산키의 중복 매핑은 R020에서 차단하며 이중 수량 합산을 방지하는 self-test를 통과함.
- 빈 내역 파일, 저장값 없는 일반·공유수식 XLSX 셀, 문자열 숫자, 숫자 타입 기계 ID, Excel 수식 문자로 시작하는 기계 ID를 입력에서 차단한다. 빈 승인 매핑은 산술 전용 진단 입력으로 허용하되 BIM 대조는 NOT_EVALUATED다. CSV·HTML·실행 manifest의 사람 입력 텍스트는 Excel 수식 실행을 막는다.
- CLI·HTML 보고서·입력 오류 문구를 한국어로 통일했고, 새 빌드 결과에 반영됨을 확인함.
- 실제 Autodesk DLL을 찾지 못하면 Revit 프로젝트가 빌드 전에 중단되며, 스텁 빌드는 명시적 `IsRevitStubBuild=true`일 때만 `build/stub/<Configuration>/<버전>`으로 격리된다. 실제 Windows/Revit 검증 절차는 `docs/WINDOWS_REVIT_VERIFICATION.md`에 기록함.
- Windows 배포 스크립트는 자신의 `deploy` 폴더를 기준으로 실행하도록 보정했고, ASCII·CRLF 인코딩을 확인함. `build-all.bat`는 성공한 Release DLL에만 표식을 남기고 L1 CLI를 `build\preflight`에 publish한다.
- `build-all.bat`은 버전·TFM·실제 Revit API 경로·비-스텁 여부·DLL SHA-256의 정확한 5행 표식을 만든다. `install.bat`은 source/stage/installed DLL 해시를 모두 확인하고 Revit 실행 중 설치를 막으며, 기존 DLL·Lukas 매니페스트를 복구 파일로 보존한다. 이전 `Lukas.Qto.addin`은 삭제하지 않고 `.disabled`로 이동해 중복 로딩을 차단한다. 복구 실패 파일이나 active/disabled legacy 충돌이 있으면 자동 덮어쓰기하지 않는다. Windows cmd·Revit 실기 검증은 아직 남아 있다.
- publish된 L1 CLI DLL로 샘플 QTO·내역·매핑 실행과 CSV·HTML·manifest 생성을 확인함. Windows 앱 호스트 실행은 실제 .NET 8 Runtime 환경에서 검증해야 한다.
- Revit API 스텁으로 2017·2022~2026 조건부 컴파일을 점검했고, 2017 스텁은 최신 `UnitTypeId`를 제공하지 않는 상태에서도 통과했다. 스텁 모델에서 수량 집계·요소ID 추적·2017 정수 ID 및 2026 64비트 ID 실행 테스트를 통과함. 실제 Revit 검증을 대체하지 않음.
- Revit 2017 애드인 소스를 실제 `net46` 대상으로 끝까지 링크했으며 산출물이 Windows x64 .NET Framework 4.6 DLL임을 확인했다. 스텁 참조 산출물은 `build/stub/Release/2017`로 격리되어 설치 대상이 아니다.
- Revit 스텁 테스트는 추출 결과를 실제 QTO CSV로 저장한 뒤 L1 `Input.ReadQto`로 다시 읽어, 요소ID·수량·체적·면적을 보존하는 종단 간 경로도 검증한다.
- Core·Desktop self-test와 CLI integration은 IFC source slot/S006, export manifest 해시 검증, 원자 결과 publish, 변조 결과 SHA 차단, 재검산 상태 분류와 CLI 동시 실행 결과 bundle을 검증한다.
- `deploy/verify-field-package.ps1`는 Revit 외부에서 COMPLETE 패키지의 manifest/QTO schema·SHA·수량·요소ID를 검사하고 증거 JSON을 남긴다. Windows PowerShell 실행은 아직 남아 있다.
- 웹 production build가 `/news`, 세 개의 회사 소식 상세, `/download` 라우트와 sitemap을 포함해 성공했고, 기존 적산 제안·산출 artifact Node 테스트 10건이 모두 통과했다. 로컬 HTTP 서버 실행은 현재 샌드박스의 포트 권한 제한으로 별도 브라우저에서 확인해야 한다.

## 미검증·외부 blocker

- Revit API DLL과 Windows/Revit 실기 환경이 없어 애드인 빌드·실행은 미검증이다.
- 일반적인 첫 워크시트 XLSX 및 현재 프로젝트의 EMS `공종별내역서` 계열은 지원하지만, 병합셀·다른 현장 양식·EMS 앱 원본 직접 해석은 아직 검증·구현하지 않았다.
- 표준품셈·단가 DB 라이선스가 미확정이므로 L2 단가·품셈 검증은 구현하지 않았다.
- ZG와 ZJ의 구조 수량 합계가 서로 다르며 범위·공제·부재 기준을 승인할 적산/BIM 담당자 판정이 없다. 플랫폼은 아직 어느 쪽도 정답으로 선택하지 않는다.
- 거푸집 face extractor와 원장 출력은 구현됐으나 실제 Revit에서 stable reference·중첩 geometry·면적을 확인하고, 사람이 승인한 접촉·개구부 판정을 Desktop 산출로 연결하는 작업이 남았다.
- 요소별 Properties ledger V2는 독립 `Properties 추출` CSV와 IFC·QTO 원자 패키지에 포함됐다. 실제 Revit 모델로 이름·체적·길이·높이와 요소 역추적을 확인하는 현장 증거가 남았다.
- 철근 official kg를 재현할 MDB/ACCDB 규격별 단위중량·손율·절사/반올림 테이블의 필드 근거를 아직 읽지 못했다. ZJ raw에 일반 단위중량과 일괄 3%를 적용한 결과는 official보다 330.388651kg 작아 임의 계수를 쓰지 않는다.
- Supabase의 제안·결정, 결정론적 산출 artifact, 파일 개정 그래프, L1 검산,
  도면 협업 migration은 운영 DB에 적용됐다. 운영 브라우저에서 파일 업로드와
  실제 2인 maker/reviewer 전체 흐름을 완료하는 현장 증거는 아직 남았다.

전체 요구사항별 완료 증거와 미충족 조건은 `docs/COMPLETION_AUDIT.md`에 정리한다.
