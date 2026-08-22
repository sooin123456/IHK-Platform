# 검증 내역서 구현·출시 상태

기준일: 2026-08-20

## 현재 증명된 범위

- Revit/QTO 원본과 분리된 내역 버전, CBS, WBS, 품목, 단가표, 자원, 매핑, 승인 데이터 계약
- 고객 보유·허가 단가만 등록하는 권리 근거와 변경되지 않는 원본 파일 SHA 결합
- 고객 단가표의 strict UTF-8 CSV/XLSX 자원 일괄 가져오기와 수식 셀·중복 코드·음수 단가 차단
- 빈 내역 버전에 CBS·최대 3단계 WBS·품목을 strict CSV/XLSX로 원자적 일괄 등록하고 고아·순환·중복·무사유 보정을 차단
- 일반 반올림 및 EMS 구성별 절사의 exact-decimal 직접공사비 계산
- 원수량 파일을 서버에서 다시 내려받아 SHA를 확인하고 QTO/객체별 수량표의 수량·단위·Element ID를 직접 읽는 매핑
- 분할 매핑의 연결계수 단위별 정확히 100% 강제, 포함과 제외 동시 선택 차단, 제외 수량·Element ID·필수 사유의 결과 해시·CSV·XLSX 보존
- 검토 요청과 승인 직전에 선택 원본을 다시 읽고, 파일·단위별 모든 양수 원수량이 100% 매핑 또는 사유 있는 제외로 처리됐는지 확인
- 작성자·승인자 분리, 승인 요청 결과 해시 고정, 승인본 불변, 후속 승인본에 의한 이전본 대체
- WBS 100% 배분, CBS/WBS leaf, 계층 cycle 및 깊이 제한
- 개정별 수량·단가·산식·금액 변화와 합계 delta closure
- 확인된 Revit Element ID↔IFC GlobalId 관계를 사용한 내역 근거→IFC 3D 선택·강조 이동
- CSV 및 5-sheet XLSX(`공종별내역서`, `자원단가`, `매핑근거`, `검토정보`, `WBS-CBS`) 출력
- CSV 수식 주입 방어와 XLSX inline string 출력

로컬 증거:

- `platform`: typecheck PASS
- `platform`: Node 계약 테스트 60개 PASS
- `platform`: production client/SSR build PASS
- `Lukas.Qto.Core.SelfTest`: PASS

운영 증거:

- Supabase production에 `verified_boq_v1`과 `verified_boq_security_hardening` 적용
- 신규 테이블 11개 모두 RLS 활성화, 익명 테이블 조회 권한 0건
- 내역 가져오기·승인 RPC는 `authenticated`/`service_role`만 실행 가능
- Vercel production 배포 및 공개 페이지·로그인 경계·다운로드 동작 확인
- 운영 URL: `https://lukas-qto-platform.vercel.app`

## 아직 운영에서 증명해야 하는 범위

1. 서로 다른 두 실제 사용자로 작성→검토요청→승인 maker-checker 과제를 실행한다.
2. 실제 QTO/element-ledger를 연결해 결과 Excel을 Excel/LibreOffice에서 열고 다시 대조한다.
3. Windows/Revit 2025 현장 PC와 적산 실무자 3명의 과제 검증을 마친다.
4. Supabase Auth의 유출 비밀번호 보호 기능을 운영 정책에 맞춰 활성화한다.

이 항목들이 끝나기 전에는 코드 구현 완료와 운영 출시 완료를 같은 의미로 사용하지 않는다.

## 다음 제품 범위

- 선택한 원수량 파일 전체 행의 포함·제외 처리율 대시보드
- 대규모 내역에서 CBS/WBS/품목 가져오기 진행률·오류행 미리보기
- 실제 유치원 기준 내역의 전문가 승인 골든 fixture
- 간접비·일반관리비·이윤·VAT는 별도 규칙·근거 승인 후 추가

AI 자동분류·자동매핑·자동승인과 무단 표준단가 번들링은 현재 범위에 포함하지 않는다.
