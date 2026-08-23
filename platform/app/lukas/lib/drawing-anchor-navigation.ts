import {
  validatePdfRegion,
  type PdfRegion,
} from "./drawing-collaboration-policy.ts";
import { canonicalIfcCameraState, type IfcCameraState } from "./ifc-anchor.ts";

const drawingIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DrawingAnchorEvidence = {
  id: string;
  issue_id: string;
  file_id: string;
  anchor_kind: "ifc_element" | "pdf_region";
  element_id: string | null;
  ifc_global_id: string | null;
  camera_json: unknown;
  page_number: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
};

export type DrawingViewerAnchor =
  | {
      kind: "ifc_element";
      elementId: string;
      ifcGlobalId: string | null;
      camera: IfcCameraState;
    }
  | ({ kind: "pdf_region" } & PdfRegion);

function canonicalDrawingId(value: string | null) {
  return value && drawingIdPattern.test(value) ? value.toLowerCase() : null;
}

function cameraVector(value: unknown) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  )
    return null;
  return value as [number, number, number];
}

export function parseDrawingAnchorId(value: string | null) {
  return canonicalDrawingId(value);
}

export function drawingLegacyGlobalId(
  requestedAnchor: string | null,
  globalId: string | null,
) {
  return requestedAnchor === null ? globalId : null;
}

export function selectDrawingAnchorForView<T extends DrawingAnchorEvidence>(
  anchors: T[],
  requestedAnchorId: string | null,
  requestedIssueId: string | null,
  currentFileId: string,
) {
  const anchorId = canonicalDrawingId(requestedAnchorId);
  const issueId = canonicalDrawingId(requestedIssueId);
  if (!anchorId || !issueId) return null;
  return (
    anchors.find(
      (anchor) =>
        anchor.id.toLowerCase() === anchorId &&
        anchor.issue_id.toLowerCase() === issueId &&
        anchor.file_id === currentFileId,
    ) ?? null
  );
}

export function drawingAnchorHref(
  projectId: string,
  anchor: DrawingAnchorEvidence,
) {
  const params = new URLSearchParams({
    issue: anchor.issue_id,
    anchor: anchor.id,
  });
  if (anchor.ifc_global_id) params.set("globalId", anchor.ifc_global_id);
  return `/projects/${projectId}/drawings/${anchor.file_id}?${params.toString()}`;
}

export function drawingViewerAnchor(
  anchor: DrawingAnchorEvidence | null,
): DrawingViewerAnchor | null {
  if (!anchor) return null;
  if (anchor.anchor_kind === "ifc_element") {
    if (
      !anchor.element_id ||
      !anchor.camera_json ||
      typeof anchor.camera_json !== "object"
    )
      return null;
    const camera = anchor.camera_json as Record<string, unknown>;
    const position = cameraVector(camera.position);
    const target = cameraVector(camera.target);
    if (!position || !target) return null;
    return {
      kind: "ifc_element",
      elementId: anchor.element_id,
      ifcGlobalId: anchor.ifc_global_id,
      camera: canonicalIfcCameraState({ position, target }),
    };
  }
  const region = {
    pageNumber: anchor.page_number,
    x: anchor.x,
    y: anchor.y,
    width: anchor.width,
    height: anchor.height,
  };
  if (
    typeof region.pageNumber !== "number" ||
    typeof region.x !== "number" ||
    typeof region.y !== "number" ||
    typeof region.width !== "number" ||
    typeof region.height !== "number" ||
    !validatePdfRegion(region as PdfRegion)
  )
    return null;
  return { kind: "pdf_region", ...(region as PdfRegion) };
}
