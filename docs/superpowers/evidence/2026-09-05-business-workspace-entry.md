# 1HK 사업모델 반영 — 첫 구현 단위

기준일: 2026-09-05. 작업 위치: `codex/universal-workspace-m1`. 현재 상태: 첫 구현 단위와 아래 명시한 검증 완료. 운영 배포·요금제·결제·새 DWG 엔진 적용은 하지 않았다.

## 반영한 변경

1. 홈페이지와 기존 단일 탐색 메뉴에서 `직접 작업하기 → /workspace`와 `전문가에게 의뢰하기 → /inquiry`를 분리했다. 로그인 전후·데스크톱·모바일에 동일한 제품/서비스 구분을 사용한다. 별도 탐색 줄은 추가하지 않았다. Revit 무료 베타·소식·로그인 경로는 유지했다.
2. 작업공간은 본인의 조직 membership으로 역할을 계산하고 URL의 선택 공간을 서버에서 검증한다. 본인 개인 공간을 우선하며 잘못되거나 철회된 선택은 접근 가능한 범위로 복귀한다. 공유받은 항목은 실제 소유/프로젝트 membership으로 구분하여 플랫폼 운영자에게 보이는 전역 프로젝트가 섞이지 않게 했다.
3. 조직마다 반복되던 관리·라이브러리·보존 메뉴를 선택 공간 한 묶음으로 줄였다. 최근 프로젝트에는 보조 정보를 표시하고 중앙 목록은 독립적으로 스크롤한다. 모바일은 기존 Radix Sheet의 초점 제한·Escape·초점 복귀를 재사용한다.
4. 편집기에 `작성 / 검토 / 수량·금액` 모드를 추가했다. 도구 패널과 기본 검사기를 바꾸되 같은 문서·선택·개정·협업·outbox를 유지한다. 방문한 패널은 처음 필요할 때만 마운트하고 숨겨서 입력 초안을 보존한다. 저장·충돌·권한·승인 정보는 업무 모드 밖에 남겼다.

기존 React/Konva/Yjs/Hocuspocus/Radix 기반을 재사용했다. 새 패키지·상태관리·편집 엔진·DB 마이그레이션은 없다.

## 확인한 검증

| 검증 | 결과 |
|---|---|
| 변경 전 entry-flow / shell / public Node 기준선 | 134/134 통과 |
| 변경 후 entry-flow / shell / modes / business-product-entry / public | 153/153 통과 |
| TypeScript·프런트/서버 빌드·협업 서버 빌드 | 통과; 최초 shared-scope `false` 타입 추론 오류는 수정 후 재검증 |
| 실제 브라우저의 공개 메뉴·모바일 작업공간·모드 상태 보존 | 3/3 통과, 저장 상태 검증 추가 후 13.5초 |
| 코드 서식·선택 파일 diff 공백 오류 | 통과 |
| 분리된 실제 Auth/Postgres/Storage/Hocuspocus M1 전체 회귀 | 최종 실행 20/20 통과, 2.3분, 종료 코드 0 |

단위 테스트 명령:

```sh
node --test tests/drawing-workspace-entry-flow.test.mjs tests/drawing-workspace-shell.test.mjs tests/drawing-workspace-modes.test.mjs tests/business-product-entry.test.mjs tests/public-site-contract.test.mjs
```

브라우저 검증은 loopback 전용 시험 환경에서 `e2e/business-workspace-entry.spec.ts`를 실행했다. 최초 실행은 새 selector/radiogroup 부재로 실패했고 구현 후 통과했다. 마지막 검증은 이미 준비된 loopback 서버를 사용하고 M1과 결과 디렉터리를 분리했다.

```sh
E2E_BASE_URL=http://127.0.0.1:4173 node_modules/.bin/playwright test e2e/business-workspace-entry.spec.ts --config=playwright.config.ts --project=chromium --workers=1 --reporter=line --output=../.superpowers/sdd/2026-09-05-business-workspace-entry/browser-results
npm run test:e2e:drawing-workspace-m1:local
```

화면 폭: 공개 진입 1440/768/390px, 작업공간 탐색 1440/1024/768/390px. 편집기 검증은 실제 선을 작성한 뒤 local durable flush 완료와 `저장 상태: 저장됨`을 확인하고 세 모드를 전환한다. 객체·선택·operation/undo/redo 전체 스냅샷, 동일 캔버스 DOM 노드, 작성 중인 페이지 이름, 저장 상태의 표시/값이 유지되는 것을 확인했다. 공개 홈페이지/편집기 캡처도 직접 확인했으며 해당 시연 세션의 콘솔·페이지 오류와 오류 오버레이는 0건이었다.

M1 최종 실행은 로그인한 소유자/Viewer의 공간 범위와 메뉴 권한, 빈 도면·템플릿·PDF 생성, 원본 보존, 단계별 승인과 확정 수량·내역·내보내기, 공유·회사 템플릿, 공동 편집·오프라인 outbox 1회 재전송, 기존 PDF/IFC/Revit 경로, 대형 도면 및 반응형·실패 격리 검증을 통과했다. 10,000개 객체 테스트의 통과를 모든 고객 환경의 60fps 보장으로 해석하지 않는다. 선행 PostgreSQL materials 검증은 3개 통과·1개 건너뜀이다. 전체 저장소의 모든 테스트를 실행했다는 의미가 아니다.

## 검토와 검증 중 발견한 점

- 구현 담당자와 다른 담당자가 각 변경의 요구사항·코드 품질을 교차 검토했다. 승인된 범위의 Critical/Important 코드 지적은 남아 있지 않다. 별도 신규 리뷰 작업 생성은 도구의 작업 수 제한으로 불가능했으므로, 새로운 독립 최종 리뷰어를 사용했다고 주장하지 않는다.
- 검토에서 빠진 저장 상태 assertion을 보강한 후 브라우저 3개를 다시 통과했다.
- 기존 M1 검토/견적 테스트는 모든 탭과 결과 패널이 처음부터 열린 구 UI를 가정했다. 새 `작성`, `검토`, `수량·금액` 선택을 통해 진입하도록 수정했다. 기존 권한·계산·승인 assertions는 유지했다. 잘못된 locator가 15분 동안 대기하지 않도록 기본 action timeout은 30초로 제한했다. 마지막 전체 재실행에서 20개가 모두 통과했다.
- 중간 시험 실행은 이 진입 경로 보완을 위해 중단했다. 첫 중단의 남은 시험 서버 PID를 확인해 종료한 뒤 격리 환경을 다시 만들었다. 사용자/운영 데이터는 삭제하지 않았다.
- 기존 unsigned theme-cookie, Node localStorage, 빌드 청크 등의 경고는 남아 있다. M1 서버에서는 보호된 협업 상태 변경 거부 로그도 관찰됐다. 이를 오류 로그가 전혀 없는 실행으로 표현하지 않는다.

## 아직 완료하지 않은 범위

- 프로젝트 입력 없이 즉시 시작하는 자동 개인 기본 프로젝트/도면의 멱등 생성. 현재는 빈 도면·템플릿을 프로젝트 안에서 만들며, 대시보드 새 프로젝트는 개인 공간 저장임을 명시한다.
- 네이티브 DWG 편집·재저장·납품. ACadSharp 시험 및 필요시 정식 라이선스 엔진 평가, 실제 수령 CAD 재열기와 글꼴·Xref·레이아웃·의미 보존 검증이 필수로 남는다. DXF나 원본 보관을 DWG 완료로 표시하지 않는다.
- 실무 템플릿/심볼·납품 패키지, 실제 고객 파일럿·가격·좌석 과금 검증.
- 운영 도면 업로드/재로그인과 실제 3인 업무 검증. 로컬 격리된 자동 테스트가 운영 고객 수용 확인을 대신하지 않는다.
- 소규모 정리: 더 이상 소비하지 않는 shared-count 표시용 prop, 첫 팀/조직 없음 fallback의 추가 테스트, 같은 이름·날짜·파일까지 일치하는 최근 항목의 추가 구분, 대규모 프로젝트 목록의 명시적 DB 페이지네이션.

기존 사용자 변경사항이 많은 작업트리는 그대로 보존했다. 전체를 임의 커밋·푸시·배포하지 않았다. 세부 구현 범위는 [구현 계획](/Users/h/Documents/GoAgent/.worktrees/universal-workspace-m1/docs/superpowers/plans/2026-09-05-business-workspace-entry.md)에 기록했다.

## 로컬 확인

개발 서버는 `http://127.0.0.1:4173/`에 유지했다. 편집기 시연은 `/workspace-preview/drawing-workspace?awarenessTest=1`이다. 이 서버의 인증 환경과 시연 데이터는 loopback 전용이므로 운영 계정 로그인이나 실제 고객 협업 검증을 대신하지 않는다. 실제 권한·저장·협업 검증은 위의 별도 M1 시험 환경에서 수행했다.
