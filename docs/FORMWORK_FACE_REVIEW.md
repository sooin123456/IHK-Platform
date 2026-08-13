# 거푸집 Face 원장 검토 계약

Revit의 **거푸집 Face 원장** 명령은 `formwork-face-ledger.csv`와 같은 이름의
`.manifest.csv`를 별도 내보냅니다. 원장에는 실제 solid face의 면적·방향·재료·host
근거만 기록하며, 접촉면·개구부·공제 여부를 자동 판정하지 않습니다. 따라서 최초 상태는
항상 `boundary_kind=Unknown`, `decision=Review`, sidecar `status=REVIEW`입니다.

Desktop의 **원장 검토**는 다음만 수행합니다.

- 원장/sidecar의 정확한 헤더, 행 수, UTC 시각, 파일 SHA-256, canonical geometry SHA-256 검증
- face ID 중복 차단 및 추정된 Include/Exclude 원장 차단
- Unknown/Review face 수 표시

계산은 `formwork face approval` CSV가 원장의 모든 face ID를 한 번씩 명시할 때만 가능합니다.
승인 CSV는 각 행에서 원장 SHA-256, 면적 기준, 개구부 union, boundary, Include/Exclude/Review,
policy rule ID/SHA/source와 승인 문서의 source 위치를 기록합니다. Core는 다음 세 가지를 각각
승인 registry와 대조합니다.

1. Revit geometry ledger SHA (`FORMWORK_FACE_LEDGER` source 및 `formwork-face-ledger` document)
2. 사용자 승인 CSV 자체의 SHA (각 decision source)
3. policy rule SHA

관리자 trust store가 registry SHA를 신뢰하지 않으면 계산 결과는 숫자가 맞아도 `REVIEW`입니다.
PE 필름·비드/PF 단열재는 순수 거푸집에 합산하지 않습니다. 부대재료를 지원할 때도 승인된
source/document SHA가 없으면 `REVIEW`이며, 면적을 0 또는 접촉면으로 추정하지 않습니다.

결과는 별도 result CSV와 `.manifest.csv`에 입력 원장·sidecar·승인 CSV·registry 해시를 남깁니다.
