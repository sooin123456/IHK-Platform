# Document Approval Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 기존 요청을 전체 도면 승인으로 오인하지 않도록 공통 사전 점검과 화면 진입 준비 상태를 구현한다. 전체 목표 중 첫 의존 작업이다.

**Architecture:** 요청/스냅샷/현재 개정을 받는 순수 함수가 미승인 요청, 근거 부족, 개정 차이, 도면 차이, 요청 밖 도형을 반환한다. 요청 승인 이후 범위 패널이 이를 표시한다. 승인 기록을 새로 만들거나 기존 단일 객체 루프를 변경하지 않는다.

**Tech Stack:** 기존 React/TypeScript, Node test, Vite SSR.

**Spec:** `docs/superpowers/plans/2026-09-09-screen-acceptance-matrix.md` D1/D2/T1; 사용자 원칙: 승인된 버전 덮어쓰기 금지, 원본 불변, 화면 우선.

## Global Constraints

- 새 라이브러리·서버·배포 없음. 기존 작업 보존, 커밋하지 않음.
- 준비 상태는 승인 완료가 아니다. 원본 내부 요소나 수량·금액을 승인하지 않는다.
- 기존 승인 통합은 후속 필수 작업으로 남긴다. 이 계획 완료가 전체 목표 완료가 아니다.

### Task 1: 공통 사전 점검과 범위 화면

**Files:** Create `platform/app/lukas/lib/drawing-document-approval-preflight.ts`; Modify `platform/app/lukas/components/drawing-change-request-preview.tsx`; Test `platform/tests/drawing-change-preview.test.mjs`.

**Interfaces:** `documentApprovalPreflight(request: ChangeRequestPreview, currentSnapshot?: DrawingRequestSnapshot, currentRevision?: number): {ready:boolean; reasons:string[]; outsideCount:number}`. reasons는 사용자에게 표시할 한국어 문장이다.

- [x] RED: 승인 없는 요청, 원본 없는 스냅샷, 요청 개정 미기록/다른 개정, 변경된 스냅샷, 요청 밖 도형 각각에서 ready=false; 모든 조건 충족 시 true. 원래 요청 JSON 불변.
- [x] 실행: `node --test --test-name-pattern='document approval preflight' tests/drawing-change-preview.test.mjs`.
- [x] 구현: `reasons=[]`; `!request.approval`, `!request.snapshot?.source || !currentSnapshot?.source`, revision undefined/mismatch, snapshot JSON mismatch, snapshot.objects 중 request.items에 없는 ID의 각 조건에서 이유 추가. `ready=reasons.length===0`. 외부 데이터 변경 없음. 추가 RED로 예시 항목/당시 도면에 없는 항목도 거절한다.
- [x] 범위 패널에 `role=status`로 결과와 reasons를 표시. 준비 완료일 때도 `전체 도면 승인 전 확인 준비됨 · 아직 승인 아님`을 표시한다.
- [x] 단위28건, 최종 검토·납품 포함53/53 통과(skip0). 타입 검사·빌드·diff 통과. `/tmp/1hk-document-preflight.png` 시각 확인, 로컬4181 반영.

## 후속 필수 통합 범위

전체 승인 의견/원본·페이지 확인 UI, 고정 개정 승인 기록의 저장·검증, 승인 후 직접 편집 차단과 새 개정, 프로젝트·납품·물량의 동일 근거 소비를 함께 구현해야 전체 도면 승인 통합을 완료로 판정한다. 기존 단일 도형 이력은 자동 승격하지 않고 보관해야 한다.
