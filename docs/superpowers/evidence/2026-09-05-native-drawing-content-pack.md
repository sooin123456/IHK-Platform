# 1HK 네이티브 콘텐츠·주석 검증 근거

작성일: 2026-09-05. 전체 개발 목표는 활성 상태다. 이 문서는 R5의 콘텐츠 생성·검증 단위이며, 운영 배포·네이티브 DWG 납품·전체 R5 완료 선언이 아니다.

## 구현 범위

- 원저작 심볼 24종: 문 5종, 창 5종, 벽 4종, 가구 10종. 이름만 나열한 목록이 아니라 실제 mm 좌표의 선·폴리라인·사각형·원으로 구성한 재사용 블록이다.
- 네이티브 템플릿 4종: 실측 기록용 예제, 사무실 배치, 기존·철거·신설 구분, 마감 수량 예제. 모두 실제 객체·레이어·스타일·치수·블록·속성·표의 참조가 연결된 편집 그래프다.
- 모든 수치는 `예제·가정값 — 현장 확인 필요`로 표시한다. 고객 실측·확정 물량·최종 금액·승인 근거를 생성하지 않는다.
- A3 가로 1:50 프로필과 21000×14850mm 네이티브 좌표를 제공한다. SVG의 물리 출력 크기만 420×297mm로 바꾸고 저장 객체 좌표는 변환하지 않는다.
- 원저작 정의의 키·버전·출처·내용 SHA-256, 실제 SVG의 SHA-256을 manifest에 기록하는 로컬 검증 도구를 추가했다. 기존 경로·symlink·위험하거나 중복된 키는 덮어쓰지 않는다.
- 공통 주석 처리에서 native mm 캔버스와 PDF 보정 문맥을 구분한다. 원본 PDF가 렌더링에 실패해도 native로 오판하지 않으며, 미보정·누락·잘못 연결된 PDF 보정 경고를 유지한다. 글자 스타일을 실제 Canvas/SVG/PNG와 선택 영역에 전달한다.

기존 4개 starter의 row/hash/schema/RPC와 운영 생성 경로는 바꾸지 않았다. 새 4종을 로그인 후 선택·가져오기하는 UI/DB 연결은 다음 개발 단위다. 현재 미리보기에 새 템플릿 선택지가 노출됐다고 주장하지 않는다.

## 검증 현황

최초 root 통합 검사에서 관련 기능 202/202 통과했으나, 배포 전 타입 검사는 semantic font 매개변수의 literal 타입 추론으로 실패했다. 독립 검토에서 도형 외부에 표시된 semantic label의 좁은 클릭 판정 불일치도 발견했다. 두 항목을 수정하고 각각 회귀 테스트와 타입 검사를 통과했다.

최종 전체 검토는 추가로 constrained 개구부 preview와 선택 테두리의 위치 불일치, 영역 선택 테스트가 실제로는 객체 이동을 검사하던 문제를 찾았다. 한 번의 수정 묶음으로 실제 preview 그래프의 공유 render bounds를 사용하고, 영역 선택이 활성화됐음을 검사하도록 수정했다. 최종 scoped re-review에서 두 지적 모두 해소되고 새 문제 없이 source 승인됐다. 최초 실패를 숨기거나 검사 조건을 약화하지 않았다.

| 검사 | 최근 root 실행 근거 |
|---|---|
| 관련 네이티브·블록·구조·측정·starter·내보내기·공유·shell | 최종 수정 후204/204 통과, skip0, 1911.28ms |
| 배포용 빌드 | 타입 검사·클라이언트·SSR·prerender·협업 빌드 통과 |
| 격리 DB 및 M1 브라우저 | 최종 수정 후runner exit0, 22/22 통과(2.5분), 일회용 환경 정리 후 docker 실행 컨테이너0 |
| 반응형 미리보기 | 최종 새 빌드 서버4173에서4/4 통과(15.3초), 데스크톱·태블릿·모바일·키보드 진입·모드 전환/초안 유지 |
| 실제 도면 미리보기 | HTTP200, hydration준비됨, 브라우저 오류0, 오류 overlay0, 가로 넘침없음 |
| 콘텐츠 실제 SVG 출력 | 28개 native JSON·28개 SVG·manifest 생성,4템플릿 XML오류0·캔버스 밖 객체0 |

실제 Postgres 권한/불변성 검사들을 실행했다. DB가 연결됐을 때 실행하지 않는 ‘필수 DB URL 누락 시 실패’ 검사 두 건은 의도된 skip이며, 권한 검사를 생략한 것이 아니다. 실제 업로드 TUS 복구와 원본 SHA 보존, IFC/DXF 근거 연결, 제목 동시 변경과 재시도, Viewer 차단, 검토·승인·BOQ·자재 계보, 기존 template clone, 다중 사용자 협업·offline outbox, Revit 회귀도22개 시나리오에 포함한다.

최종 수정 후 로컬 Apple M3 Max/Chromium151의10,000객체 fixture에서 첫 사용 가능1370.80ms, 프레임p95 10.2ms, 협업 warm30표본p95 107.45ms였다. 지정된 로컬 fixture/하드웨어 결과이며 운영망·모든 도면 성능 보장은 아니다. 최종 원시 근거는 같은 이름 하위 폴더의 `10k-performance-final.json`, `collaboration-reflection-final.json`에 원본과 바이트 동일하게 보존했다. `-final` 없는 파일은 최종 선택 테두리 수정 전의 첫 통합 통과 기록이다.

실제 A3 SVG의 치수는 순서대로6000/4000mm,10000mm,8000mm,6000mm이며 모두140-unit 글자 스타일을 사용한다. 원본 PDF 보정의 빨간 경고와 구분된다. 4종 모두 실제 렌더된 범위가 캔버스 내부이고, 철거/신설 벽이 범위 채움에 가려지지 않으며 문 심볼 jamb와 host 개구부가 일치한다. 생성한 SVG·JSON·manifest와4템플릿 PNG, 로컬 작업실 PNG를 함께 보존했다.

기존 theme-cookie 서명 안내, Node localStorage/색상 환경 경고, Vite 빈 route chunk/대형 번들 안내, React Router v8 future flag 안내, migration NOTICE는 남아 있다. 통합 실행에는 보호된 협업 상태 변경 거절 로그와 공유404 진단도 기록됐다. 무경고 빌드라고 주장하지 않는다. 구현 중 에이전트가 별도로 실행한 저장소 전체 테스트의 실패9건(alias 직접 실행, 기존 계약/근거 hash 및 병렬 작업/포트 관련 보고)은 이204개·22개 통과와 동일한 전체-suite 통과 주장으로 바꾸지 않는다.

핵심 재현 명령은 `platform` 기준이다.

```sh
node --test tests/drawing-native-symbols.test.mjs tests/drawing-native-templates.test.mjs tests/drawing-native-content-export.test.mjs tests/drawing-native-annotations.test.mjs tests/drawing-workspace-blocks.test.mjs tests/drawing-workspace-structure.test.mjs tests/drawing-workspace-measurements.test.mjs tests/drawing-workspace-m1-start.test.mjs tests/drawing-workspace-export.test.mjs tests/drawing-revision-share-route.test.mjs tests/drawing-workspace-shell.test.mjs
npm run test:e2e:drawing-workspace-m1:local
node scripts/verify-native-drawing-content.mjs --output-dir /absolute/new-directory
```

새 도구는 실제 네이티브 그래프 검증기와 기존 SVG 렌더러를 실행한다. 테스트는 CLI를 실행하기 전 원래 정의를 별도로 확보하고 독립적인 canonical JSON/Node SHA-256으로 모든 출력 정의·바이트·digest를 비교한다. 동일 구현끼리 계산 결과만 맞추는 검사는 피했다. 내용 키 24개, 템플릿 4개, 전체 A3 프로필과 비운영 상태를 명시적으로 검사한다.

## 원저작·오픈소스·DWG 경계

새 패키지나 협업 서버를 추가하지 않고 기존 네이티브 모델·렌더러·Web Crypto를 재사용했다. 원저작 도형은 Rayon 화면·아이콘·문구, 고객 CAD 또는 재배포 권한이 불명확한 다운로드 자산을 복제하지 않았다.

현재 `platform/LICENSE.md`는 Supaplate의 제한된 상용 라이선스 문서다. 이를 오픈소스 허가로 간주하지 않는다. 새 콘텐츠에도 사용자가 지정하지 않은 재배포 라이선스를 임의로 부여하지 않고 `NOASSERTION`과 first-party provenance를 명시했다. 공개 배포 전 기초 코드 및 콘텐츠 라이선스 범위 검토가 필요하다.

이 검증은 SVG 및 네이티브 편집 데이터 출력이다. DWG 재저장·납품 지원으로 표시하지 않는다. 앞선 ACadSharp 시험은 별도 근거를 유지하며, 허가된 실무 파일 corpus·독립 CAD 수신 검증·고정 개정 파생물 작업과 원본/객체/승인 계보 연결이 여전히 필요하다.

## 이번 실행의 판단과 비용

1. 보호된 import보다 콘텐츠 생성·검증을 먼저 분리했다. 실제 형상 품질을 권한 변경 없이 검증할 수 있지만, 후속 import에서 envelope 조정이 필요할 수 있다.
2. 기존 dirty 작업을 보존하고 커밋·staging 없이 태스크별 스냅샷 diff로 검토했다. 비용은 커밋 단위 이력 대신 별도 근거를 보존해야 한다는 점이다.
3. 콘텐츠 라이선스는 NOASSERTION으로 기록하고 Supaplate 범위를 출시 게이트로 남겼다. 비용은 공개 재배포가 라이선스 결정·검토를 기다린다는 점이다.
4. 파일 소유권이 겹치지 않는 심볼·템플릿 준비를 병렬 수행했다. 비용은 생산자·소비자 인터페이스 조정이다.
5. 실제 출력 결함에 따라 공통 주석 수정 단위를 추가했다. 비용은 프로덕션 렌더러에 영향을 주므로 전체 격리 M1 회귀가 필요하다는 점이다.
6. 유용한 감사 문맥을 가진 종료된 에이전트 자리를 재사용했다. 구현자와 검토자는 분리했으나, 완전히 새 문맥보다 격리 수준이 낮아지는 비용이 있다.

## 남은 목표

1. 새 템플릿·심볼을 실제 로그인 catalog/import에 연결: 조직 격리, 전체 ID/참조 remap, 원자적·멱등 생성, 승인된 정의 불변성, 기존 starter 및 사용자 자산 보존.
2. 출력 프로필과 표시 단위 편집·저장: 원본 및 canonical mm 계산 근거는 변경하지 않고 표현 설정으로 관리.
3. DWG 실무 납품 검증 및 계보 연결. 합성 round-trip 테스트만으로 완료 처리하지 않음.
4. 실제 사용자 3명과 수신자 검증, 납품 패키지 및 라이선스 출시 점검.

운영 DB 변경·배포·push·라이선스 구매는 수행하지 않았다. 이 개발 단위 이후에도 목표는 계속 활성 상태로 유지한다.
