export const p5Ids = Object.freeze({
  project: "50000000-0000-4000-8000-000000000001",
  revision: "50000000-0000-4000-8000-000000000002",
  object: "50000000-0000-4000-8000-000000000003",
  pdfFile: "50000000-0000-4000-8000-000000000004",
  ifcFile: "50000000-0000-4000-8000-000000000005",
  pdfSource: "50000000-0000-4000-8000-000000000006",
  ifcSource: "50000000-0000-4000-8000-000000000007",
  previousAnchor: "50000000-0000-4000-8000-000000000008",
  replacementAnchor: "50000000-0000-4000-8000-000000000009",
});

export const p5PdfSha256 = "a".repeat(64);
export const p5IfcSha256 = "b".repeat(64);

export const p5PdfSource = Object.freeze({
  id: p5Ids.pdfSource,
  objectId: p5Ids.object,
  revisionId: p5Ids.revision,
  sourceFileId: p5Ids.pdfFile,
  sourceSha256: p5PdfSha256,
  sourceKind: "pdf_region",
  pdfPageNumber: 1,
  x: 0.1,
  y: 0.2,
  width: 0.3,
  height: 0.4,
  version: 1,
});

export const p5IfcSource = Object.freeze({
  id: p5Ids.ifcSource,
  objectId: p5Ids.object,
  revisionId: p5Ids.revision,
  sourceFileId: p5Ids.ifcFile,
  sourceSha256: p5IfcSha256,
  sourceKind: "ifc_element",
  ifcGlobalId: "0Q2gXl1Hn3fQ9A2W4k6M8P",
  elementId: "42",
  camera: { position: [1, 2, 3], target: [4, 5, 6] },
  version: 1,
});

export function p5SourceRow(source) {
  return {
    id: source.id,
    object_id: source.objectId,
    revision_id: source.revisionId,
    project_id: p5Ids.project,
    source_file_id: source.sourceFileId,
    source_sha256: source.sourceSha256,
    source_kind: source.sourceKind,
    pdf_page_number:
      source.sourceKind === "pdf_region" ? source.pdfPageNumber : null,
    x: source.sourceKind === "pdf_region" ? source.x : null,
    y: source.sourceKind === "pdf_region" ? source.y : null,
    width: source.sourceKind === "pdf_region" ? source.width : null,
    height: source.sourceKind === "pdf_region" ? source.height : null,
    element_id: source.sourceKind === "ifc_element" ? source.elementId : null,
    ifc_global_id:
      source.sourceKind === "ifc_element" ? source.ifcGlobalId : null,
    camera: source.sourceKind === "ifc_element" ? source.camera : null,
    version: source.version,
    status: "active",
  };
}
