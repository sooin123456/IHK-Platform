# Revit Properties 추출 범위와 근거

Revit 2025의 `Properties 추출`은 CSV를 만들기 전에 다음 중 하나를 명시적으로 선택한다.

- `Selection`: 현재 선택한 host 요소만
- `ActiveView`: 현재 활성 뷰의 host 요소만
- `EntireHostModel`: 현재 열려 있는 host RVT 문서의 모델 요소 전체

어느 범위에서도 `RevitLinkInstance`와 링크 문서의 내부 요소는 포함하지 않는다. 링크 인스턴스가
선택 또는 collector에 나타나면 제외 수를 evidence에 기록하며, 링크 요소의 수량을 host 모델
수량으로 합산하거나 역추정하지 않는다.

세 범위 모두 `수량 산출` 및 `IFC·QTO 패키지`와 같은 물리 객체 필터를 사용한다. 벽·바닥·지붕·문·창·
구조·설비처럼 실제 시공 대상인 Revit built-in category만 포함하고, `<Sketch>`, Materials, Legend
Components, Sheets, Cameras, Sun Path 같은 작성 보조 객체는 제외한다. 표시 언어가 바뀌어도 결과가
달라지지 않도록 화면의 카테고리 이름이 아니라 Revit의 stable built-in category ID로 판정한다.

기존 `element-ledger.csv` 열 계약은 바뀌지 않는다. 같은 위치에
`element-ledger.csv.evidence.json` V2를 별도 생성하며, 다음을 남긴다.

- Revit version 및 build
- 선택한 scope와 `built-in-category-physical-v1` 필터 버전
- 후보, 적격 host 모델, 제외 link instance/비모델/비수량 보조 객체, 없는 selection ID, CSV 행 수
- CSV 파일명 및 SHA-256

evidence JSON 또는 CSV가 이미 있으면 덮어쓰지 않는다. ActiveView의 정확한 표시/가시성은 실제
Revit에서 `FilteredElementCollector(document, activeView.Id)`로 검증해야 하며, stub은 API 계약과
링크 제외·evidence 구조만 검증한다.
