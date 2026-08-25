# 1HK Drawing Workspace P2 구조와 재사용 설계

기준일: 2026-08-25

## 1. 목표와 완료 경계

P2는 P0/P1 편집기를 다중 페이지 문서 작업실로 확장하고, canvas·style·block·project template·table/schedule·사용자 속성·내보내기를 추가한다. P3 실시간 협업, P4 건축 의미 객체와 의미 schedule, P6 Excel/내역 연결은 포함하지 않는다.

완료 사용 흐름은 다음과 같다.

`페이지 생성 → paper/model canvas 선택 → canvas별 layer 편집 → style 적용 → block 정의/배치 → 사용자 속성 입력 → schedule 확인 → 승인 revision을 template로 복제 → PDF/PNG/SVG 내보내기`

## 2. 최소 오픈소스 결정

- 기존 React Router, Supabase, Zod, Konva/react-konva, PDF.js를 재사용한다.
- PNG는 브라우저 Canvas/Konva primitive를 재사용한다.
- SVG는 canonical geometry를 직접 직렬화한다. 별도 SVG 편집/내보내기 패키지를 추가하지 않는다.
- 다중 페이지 PDF writer에만 MIT `pdf-lib`를 exact version으로 추가하고 `THIRD_PARTY_NOTICES.md`에 기록한다.
- Excalidraw는 MIT command/library/export 패턴의 설계 참고만 하며 전체 editor package를 포함하지 않는다.
- Penpot과 tldraw 코드는 포함하지 않는다.
- grid/table, state-management, form, template 전용 라이브러리를 추가하지 않는다.

## 3. 문서와 canvas 계약

### 페이지

`DrawingPage`는 문서 내 sheet identity와 정렬만 가진다.

```ts
type DrawingPage = {
  id: string;
  revisionId: string;
  name: string;
  sortOrder: number;
  version: number;
};
```

### Canvas

```ts
type DrawingCanvas = {
  id: string;
  pageId: string;
  name: string;
  spaceKind: "paper" | "model";
  widthMillimeters: number;
  heightMillimeters: number;
  background: null | {
    sourceFileId: string;
    sourceSha256: string;
    pdfPageNumber: number | null;
    calibration: PdfCalibration | null;
  };
  sortOrder: number;
  version: number;
};
```

- 기존 page의 크기·배경·calibration은 새 기본 `paper` canvas로 backfill한다.
- 기존 page column은 업그레이드 호환을 위해 남기되 P2 mutation과 loader의 권위는 canvas다.
- page에는 하나 이상의 canvas가 있어야 하며 정확히 하나의 기본 paper canvas가 있어야 한다.
- layer는 `canvasId`와 `sortOrder`를 가지며 canvas 간 이동할 수 있다.
- object는 layer를 통해 canvas/page에 귀속한다.
- source canvas/background는 원본 file ID와 SHA를 변경하지 않는다.

## 4. P2 구조 operation

기존 object/layer operation은 유지한다. P2 구조 엔티티는 operation type을 계속 늘리지 않고 하나의 엄격한 `mutate_structure` operation을 추가한다.

```ts
type DrawingStructureAction =
  | { kind: "put_page"; entity: DrawingPage; baseVersion: number | null }
  | { kind: "delete_page"; id: string; baseVersion: number }
  | { kind: "put_canvas"; entity: DrawingCanvas; baseVersion: number | null }
  | { kind: "delete_canvas"; id: string; baseVersion: number }
  | { kind: "put_style"; entity: DrawingStyleDefinition; baseVersion: number | null }
  | { kind: "delete_style"; id: string; baseVersion: number }
  | { kind: "put_block"; entity: DrawingBlock; baseVersion: number | null }
  | { kind: "delete_block"; id: string; baseVersion: number }
  | { kind: "put_block_instance"; entity: DrawingBlockInstance; baseVersion: number | null }
  | { kind: "delete_block_instance"; id: string; baseVersion: number }
  | { kind: "put_property_schema"; entity: DrawingPropertySchema; baseVersion: number | null }
  | { kind: "delete_property_schema"; id: string; baseVersion: number }
  | { kind: "put_property_value"; entity: DrawingPropertyValue; baseVersion: number | null }
  | { kind: "delete_property_value"; id: string; baseVersion: number }
  | { kind: "put_table"; entity: DrawingTable; baseVersion: number | null }
  | { kind: "delete_table"; id: string; baseVersion: number };
```

- forward와 inverse는 strict action array다.
- 한 operation 안의 action은 한 transaction에서 순서대로 적용한다.
- inverse는 forward 역순이며 삭제 전 exact entity를 포함한다.
- 각 action은 revision/project ancestry와 base version을 서버가 다시 검증한다.
- 승인/검토 요청 revision은 모든 구조 mutation을 거부한다.
- 기존 outbox의 causal ordering, idempotency payload binding, custom SQLSTATE를 그대로 확장한다.

## 5. Style 계약

```ts
type DrawingStyleDefinition = {
  id: string;
  revisionId: string;
  name: string;
  value: DrawingStyle;
  version: number;
};
```

- object와 block primitive는 `styleId: string | null`과 `style: Partial<DrawingStyle>` override를 가진다.
- `styleId === null`인 기존 object는 완전한 inline style을 유지한다.
- `styleId !== null`이면 definition value 위에 override를 병합한다.
- merge 결과가 완전한 `DrawingStyleSchema`를 만족하지 않으면 저장과 렌더링을 fail closed한다.
- style definition 수정은 참조 object row를 다시 쓰지 않고 즉시 렌더 결과에 반영한다.
- 사용 중인 style 삭제는 차단한다.

## 6. Block 계약

```ts
type DrawingBlockPrimitive = {
  localId: string;
  name: string;
  geometry: DrawingGeometry;
  styleId: string | null;
  style: Partial<DrawingStyle>;
};

type DrawingBlock = {
  id: string;
  revisionId: string;
  name: string;
  primitives: DrawingBlockPrimitive[];
  version: number;
};

type DrawingBlockInstance = {
  id: string;
  blockId: string;
  layerId: string;
  name: string;
  origin: Point;
  rotation: number;
  scaleX: number;
  scaleY: number;
  version: number;
};
```

- primitive geometry는 block 원점 기준 상대 좌표다.
- instance는 하나의 선택/이동/복사/삭제 단위다.
- block 수정은 instance row를 다시 쓰지 않고 모든 instance 렌더에 반영된다.
- 사용 중인 block 정의 삭제는 차단한다.
- P2 `블록 만들기`는 선택 객체를 복제해 definition을 만들고 instance를 추가한 뒤 원본을 삭제하는 서버-side compound action으로 원자 처리한다.
- P2 block override와 nested block은 지원하지 않는다.

## 7. Project template 계약

- 별도 template table을 만들지 않는다.
- 같은 project의 승인된 revision을 template source로 선택한다.
- `createDrawingDocumentFromTemplate(sourceRevisionId, title, optionalSourceFileId)` RPC는 승인 snapshot v2를 새 draft document/revision으로 복제한다.
- 새 object/block instance ID는 새 UUID이며 `lineage_id`는 원본 lineage를 보존한다.
- 원본 file SHA/source link는 template에서 명시적으로 선택한 source가 있을 때만 복제한다.
- P7에서 organization/company template registry를 별도 추가한다.

## 8. 사용자 속성 계약

```ts
type DrawingPropertySchema = {
  id: string;
  revisionId: string;
  name: string;
  valueType: "text" | "number" | "boolean" | "date" | "enum";
  enumOptions: string[];
  appliesTo: Array<DrawingGeometry["type"] | "block_instance">;
  required: boolean;
  version: number;
};

type DrawingPropertyValue = {
  id: string;
  schemaId: string;
  objectId: string | null;
  blockInstanceId: string | null;
  value: string | number | boolean | null;
  version: number;
};
```

- value는 object 또는 block instance 중 정확히 하나에 귀속한다.
- date는 `YYYY-MM-DD` 문자열이다.
- enum은 schema option 중 하나다.
- number는 finite number다.
- required는 승인 요청 validation에서 검사한다.
- schema/type 변경이 기존 값을 무효화하면 mutation을 거부한다.

## 9. Table/schedule 계약

```ts
type DrawingTable = {
  id: string;
  revisionId: string;
  name: string;
  columns: Array<{
    id: string;
    name: string;
    kind: "text" | "number" | "object_name" | "object_type" | "property";
    propertySchemaId: string | null;
  }>;
  rows: Array<{
    id: string;
    objectId: string | null;
    blockInstanceId: string | null;
    cells: Record<string, string | number | null>;
  }>;
  version: number;
};
```

- P2 table은 수식·정렬 규칙·집계식이 없는 저장된 schedule view다.
- object/property column은 현재 object/property 값에서 결정론적으로 resolve한다.
- 수동 cell은 text/number column에만 저장한다.
- semantic 공간·문·마감 schedule은 P4에서 확장한다.
- DOM semantic table을 사용하고 canvas object로 렌더하지 않는다.

## 10. 승인 snapshot v2

- snapshot schema version을 2로 올린다.
- canonical order는 page/canvas/layer/object/style/block/instance/property schema/value/table 각각 `sortOrder` 또는 ID 오름차순이다.
- snapshot v2가 모든 P2 entity와 source SHA를 포함하지 않으면 검토 요청을 거부한다.
- 기존 승인 snapshot v1은 불변으로 유지하고 loader가 읽기 전용으로 지원한다.
- v1 승인 revision에서 새 draft를 만들 때 P2 entity는 빈 상태/default canvas로 승격한다.

## 11. UI

- 왼쪽 panel에 page tree와 page별 canvas를 표시한다.
- active page/canvas가 바뀌면 해당 canvas layer/object/instance만 canvas에 표시한다.
- layer drag reorder와 canvas 이동은 version-aware command다.
- style/block/property/table panel은 기존 rail panel 패턴을 따른다.
- inspector는 effective style, style preset, block transform, custom property를 표시한다.
- Viewer/Reviewer는 모든 구조를 읽을 수 있지만 mutation control은 DOM에 없다.

## 12. Export

- PNG: 선택 canvas, 선택한 배경 포함 여부, 1x/2x/4x pixel ratio.
- SVG: 선택 canvas의 visible vector layer/object/block instance. PDF raster background를 포함하면 data URI image로 명시한다.
- PDF: 모든 visible paper canvas를 sort order대로 새 PDF page로 생성한다. model canvas는 명시 선택하지 않으면 제외한다.
- export는 현재 draft 미리보기 또는 승인 snapshot을 source로 선택한다.
- 원본 PDF/IFC bytes나 row를 변경하지 않고 새 download bytes만 생성한다.
- export renderer는 canonical geometry/style/block resolver를 공유하고 Konva node JSON을 읽지 않는다.
- PNG/SVG/PDF는 동일 fixture에서 object bounds와 page count가 일치해야 한다.

## 13. 권한·오류·성능

- P0/P1 capability/RLS/RPC mapping을 모든 P2 table/action에 적용한다.
- 구조 mutation도 custom SQLSTATE `P1C01`/`P1R01`과 exact idempotency binding을 사용한다.
- active canvas가 삭제/잠금/권한 변경되면 tool과 selection을 취소한다.
- outbox가 P2 action을 replay하지 못하면 부분 적용 없이 conflict로 남긴다.
- 10,000 object + 1,000 block instance + 20 canvas fixture에서 active canvas만 render한다.
- page/canvas 전환 p95 250ms, export는 30초 timeout과 명시적 오류를 가진다.

## 14. 출시 게이트

1. 기존 P0/P1 document가 default paper canvas로 손실 없이 열린다.
2. 세 페이지와 paper/model canvas를 만들고 전환한다.
3. canvas별 layer/object가 섞이지 않는다.
4. style 수정이 참조 object/block에 반영되고 override가 유지된다.
5. block 정의/instance/복사/변환/삭제와 사용 중 삭제 차단이 동작한다.
6. 승인 revision에서 template 문서를 만들고 lineage/source 계약이 유지된다.
7. 다섯 property type과 required 승인 validation이 동작한다.
8. schedule이 object/property를 정확히 resolve한다.
9. 새로고침·offline replay 뒤 P2 상태가 동일하다.
10. snapshot v2 SHA가 결정론적이며 승인 후 P2 table 직접 mutation이 차단된다.
11. PNG/SVG/PDF export가 보이는 page/canvas/style/block을 재현한다.
12. 기존 PDF/IFC SHA와 기존 P0/P1·수량·승인·Revit 흐름이 변하지 않는다.

