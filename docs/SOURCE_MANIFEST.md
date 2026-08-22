# 소스 매니페스트 계약

L1.4.3 안전 실행은 파일 이름이 아니라 SHA-256으로 IFC·QTO·내역·매핑의 신원을 확인한다. 일반 검산은 QTO·내역·매핑 세 입력이, IFC 프로젝트 검산은 네 입력이 모두 같은 `scope_id`의 최신 `ACTIVE`여야 한다. 이 조건이 하나라도 맞지 않으면 계산 규칙을 실행하지 않고 S001~S005(또는 IFC 프로젝트의 S006) 결과만 남긴다.

## CSV 형식

열 순서와 이름은 정확히 다음과 같다.

```csv
source_id,path,sha256,slot,scope_id,revision,status,related_source_id
```

| 열 | 의미 |
|---|---|
| `source_id` | 매니페스트 안에서 유일한 소스 식별자 |
| `path` | 매니페스트 폴더 기준 상대 경로. 절대경로, `..`, 심볼릭 링크는 금지 |
| `sha256` | 파일 바이트의 SHA-256 64자리 값 |
| `slot` | `ifc`, `qto`, `estimate`, `mapping` 중 하나 |
| `scope_id` | 같은 공사 범위 입력을 묶는 식별자 |
| `revision` | `(scope_id, slot)` 안의 양의 정수 개정 번호 |
| `status` | 아래 상태 중 하나 |
| `related_source_id` | 교체 원본·수식 원본 관계가 있을 때 같은 범위·slot의 소스 ID. ACTIVE QTO는 같은 scope·revision의 ACTIVE IFC source ID를 provenance로 가리킬 수 있음 |

상태 의미는 다음과 같다.

- `ACTIVE`: 계산 입력으로 선택할 수 있는 유일한 최신 원본
- `SUPERSEDED`: 더 높은 revision의 교체 원본을 가리키는 과거 원본
- `DERIVATIVE`: 같은 revision 원본에서 수식 일부가 값으로 평탄화된 XLSX. 원본 ID가 필수
- `UNRESOLVED`: 어느 개정이 권위본인지 아직 결정하지 못한 원본 후보. 해당 범위·slot 실행을 차단
- `REFERENCE`: 계산 입력은 아니지만 보관할 참고본. 원본 ID를 적은 XLSX는 EMS 핵심 시트의 수식·저장값 동등 여부를 검사

`ifc` slot은 `.ifc` 확장자여야 한다. ACTIVE QTO가 IFC를 가리키는 것은 **선언된 provenance link**이며, 그 자체로 IFC 내부와 QTO 수량이 같다는 뜻은 아니다. Revit 패키지에서 실제 같은 export run임을 증명하려면 Desktop `프로젝트 만들기`가 COMPLETE `export-manifest.csv`의 IFC/QTO SHA를 재검증한 경로를 사용한다.

원본 계보에서 revision은 중복될 수 없고 `ACTIVE`가 가장 높아야 한다. `SUPERSEDED` 관계는 낮은 revision에서 높은 revision으로만 향하므로 순환할 수 없다. `DERIVATIVE`와 원본 관계가 없는 일반 `REFERENCE`는 `related_source_id`를 비워 둔다.

## 게이트 규칙

- `S001`: 매니페스트 형식, 상대경로 경계, 파일 존재, SHA-256 무결성
- `S002`: 선택 파일이 정확한 slot의 등록 SHA인지 확인
- `S003`: 선택된 필수 slot의 `scope_id` 일치
- `S004`: 선택 소스가 최신 `ACTIVE`인지와 개정 계보 확인
- `S005`: 선언된 XLSX `DERIVATIVE` 또는 동등 `REFERENCE`의 EMS 핵심 7개 시트 저장값·수식 관계 확인. 스타일·병합·외부링크·그 밖의 시트 동일성은 판단하지 않음
- `S006`: IFC 프로젝트 실행에서 선택 ACTIVE QTO의 `related_source_id`, scope, revision이 선택 ACTIVE IFC와 일치하는지 확인

일반 검산은 QTO·내역·매핑 세 slot이 모두 필요하다. 매핑 템플릿 생성은 아직 매핑 파일이 없으므로 QTO·내역만 확인한다.

IFC 프로젝트 실행은 네 slot을 사용한다.

```sh
dotnet run --project src/Lukas.Qto.Preflight -- \
  --sources samples/source-manifest.csv --ifc samples/sample.ifc \
  samples/qto.csv samples/estimate.csv samples/mapping.csv samples/project-report.csv
```

```sh
dotnet run --project src/Lukas.Qto.Preflight -- \
  --sources samples/source-manifest.csv \
  samples/qto.csv samples/estimate.csv samples/mapping.csv samples/report.csv

dotnet run --project src/Lukas.Qto.Preflight -- \
  --sources samples/source-manifest.csv --mapping-template \
  samples/qto.csv samples/estimate.csv mapping-template.xlsx qto-index.xlsx
```

등록 전 진단이 꼭 필요할 때만 `--unsafe-no-source-gate`를 명시한다. 이 실행은 보고서에 `S000 REVIEW`, 실행 manifest에 `소스게이트=SKIPPED`를 남기고 결과가 계산돼도 종료 코드 3을 반환한다.

## 보안 경계

이 CSV는 로컬 작업에서 실수로 다른 범위·개정·파생본을 섞는 것을 막고 실행을 재현하기 위한 장치다. 전자서명된 권한장은 아니다. 파일과 매니페스트를 함께 바꿀 수 있는 공격자를 방어하려면 조직의 접근제어 저장소, 승인된 매니페스트 해시 고정 또는 전자서명이 별도로 필요하다.

동작 가능한 예시는 [samples/source-manifest.csv](../samples/source-manifest.csv)에 있다.
