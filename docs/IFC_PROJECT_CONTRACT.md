# IFC 프로젝트 실행 계약

Lukas QTO의 첫 실제 통합은 IFC 전체 형상을 다시 해석하지 않는다. Revit 패키지 명령이 동일한 문서 상태에서 만든 IFC와 대응 QTO, 내역, 승인 매핑을 한 실행 단위로 고정한다. QTO는 IFC 내부에서 추출된 파생물이 아니다. 형상·속성 파싱은 별도 기능이 실제로 필요할 때 추가한다.

## 최소 입력

하나의 `scope_id`에 다음 네 개의 최신 `ACTIVE` 소스가 필요하다. 같은 export run의 IFC와 대응 QTO는 같은 `revision`이어야 하고, 내역·매핑은 각 slot의 독립적인 최신 revision을 사용한다.

| slot | 역할 |
|---|---|
| `ifc` | Revit에서 내보낸 `.ifc` 원본 |
| `qto` | IFC와 동일 Revit export run에서 별도로 추출된 검산 수량 |
| `estimate` | 비교할 공사 내역 |
| `mapping` | 내역 행과 QTO 항목의 승인 연결 |

QTO 행의 `related_source_id`는 같은 `scope_id`·`revision`의 IFC `source_id`를 가리키는 선언된 provenance link다. 파생관계를 뜻하지 않는다. 선택 파일은 모두 소스 매니페스트의 SHA-256과 일치해야 한다. 이 연결만으로 동일 export run을 증명하지는 않는다.

```csv
source_id,path,sha256,slot,scope_id,revision,status,related_source_id
project-ifc-r1,model.ifc,<sha256>,ifc,PROJECT-01,1,ACTIVE,
project-qto-r1,qto.csv,<sha256>,qto,PROJECT-01,1,ACTIVE,project-ifc-r1
project-estimate-r1,estimate.xlsx,<sha256>,estimate,PROJECT-01,1,ACTIVE,
project-mapping-r1,mapping.csv,<sha256>,mapping,PROJECT-01,1,ACTIVE,
```

## 실행

```sh
dotnet run --project src/Lukas.Qto.Preflight -- \
  --sources samples/source-manifest.csv --ifc samples/sample.ifc \
  samples/qto.csv samples/estimate.csv samples/mapping.csv samples/project-report.csv
```

기존 QTO·내역·매핑 실행은 호환성을 위해 유지된다. `--ifc` 프로젝트 실행에서는 기존 S001~S005에 더해 `S006`이 QTO와 선택 IFC의 선언된 provenance 연결을 검사한다. 결과 실행 매니페스트에는 IFC 파일명, SHA-256, 선택된 IFC 소스 ID가 기록된다. 동일 export run의 증명은 Desktop의 `프로젝트 만들기`가 원본 `export-manifest.csv`의 IFC/QTO 해시를 재검증해 프로젝트를 생성한 경우에만 성립한다. 수기로 만든 source manifest의 S006 PASS는 그 선언의 구조적 일치만 뜻한다.

Revit export manifest v2는 정확히 16열이며 기존 `qto_row_count,element_count` 뒤에 `element_ledger_file,element_ledger_sha256,element_ledger_row_count`를 두고 마지막에 `status,failure_reason`을 둔다. `COMPLETE`는 같은 실행에서 만든 비어 있지 않은 `element-ledger.csv`를 strict 계약으로 재읽고 SHA-256과 행 수를 재검증한 경우에만 허용한다. 이 15열 원장은 요소별 이름과 체적(m3)·길이(m)·높이(m)를 각각 `MISSING|ZERO|COMPUTED` 상태 및 built-in 파라미터 출처와 함께 보존하며 재료·규격·누락값을 추정하지 않는다.

## 현재 보장과 경계

- 보장: 파일 존재, 상대경로 경계, SHA-256, scope, revision, ACTIVE 상태, 선언된 IFC-QTO 관계, 입력 변경 감지
- 표준 Desktop 프로젝트 생성 경로에서 추가 보장: 원본 COMPLETE export manifest가 기록한 IFC/QTO 해시와 실제 파일의 일치
- 보장하지 않음: IFC 내부 형상 계산, IFC 스키마 적합성, Revit 모델과 IFC 객체의 의미적 동일성

IFC 내부 수량 계산은 다음 단계에서 검증할 실제 고객 IFC와 기대 결과가 확보될 때 표준 라이브러리를 선택해 추가한다. 자체 IFC 파서를 만들지 않는다.
