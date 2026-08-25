import { blockInstanceRenderModel } from "./drawing-blocks.ts";
import type { DrawingDocumentState } from "./drawing-commands.ts";
import { drawingDimensionLayout, drawingTextLayout } from "./drawing-layout.ts";
import { resolveDrawingStyle } from "./drawing-structure.ts";
import type {
  DrawingCanvas,
  DrawingGeometry,
  DrawingPage,
  DrawingStyle,
} from "./drawing-workspace.types.ts";

export type DrawingExportTransform = [
  number,
  number,
  number,
  number,
  number,
  number,
];

export type DrawingExportPrimitive = {
  geometry: DrawingGeometry;
  id: string;
  layerId: string;
  style: DrawingStyle;
  transform: DrawingExportTransform;
};

export type DrawingExportTraversal = {
  canvas: DrawingCanvas;
  page: DrawingPage;
  primitives: DrawingExportPrimitive[];
};

export type DrawingExportBackground = {
  bounds: { x: number; y: number; width: number; height: number };
  canvas: CanvasImageSource;
  pdfPageNumber: number | null;
  sourceFileId: string;
  sourceSha256: string;
};

export type DrawingExportPngOptions = {
  background?: DrawingExportBackground;
  canvasFactory?: () => HTMLCanvasElement;
  scale: 1 | 2 | 4;
};

export type DrawingExportPdfOptions = {
  author?: string;
  canvasFactory?: () => HTMLCanvasElement;
  canvasIds?: string[];
  createdAt: string;
  getBackground?: (
    canvas: DrawingCanvas,
  ) => Promise<DrawingExportBackground | undefined>;
  scale: 1 | 2 | 4;
  subject?: string;
  title: string;
};

export class DrawingExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DrawingExportError";
  }
}

const identityTransform: DrawingExportTransform = [1, 0, 0, 1, 0, 0];

function canonicalOrder(
  left: { id: string; sortOrder?: number },
  right: { id: string; sortOrder?: number },
) {
  return (
    (left.sortOrder ?? 0) - (right.sortOrder ?? 0) ||
    left.id.localeCompare(right.id)
  );
}

function stableNumber(value: number) {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

function instanceTransform(instance: {
  origin: { x: number; y: number };
  rotation: number;
  scaleX: number;
  scaleY: number;
}): DrawingExportTransform {
  const radians = (instance.rotation * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  return [
    stableNumber(cosine * instance.scaleX),
    stableNumber(sine * instance.scaleX),
    stableNumber(-sine * instance.scaleY),
    stableNumber(cosine * instance.scaleY),
    instance.origin.x,
    instance.origin.y,
  ];
}

/**
 * Produces the one canonical, immutable render traversal shared by all export
 * encoders. Only visible layers owned by the selected canvas participate;
 * locked visible layers remain exportable reference content.
 */
export function collectExportPrimitives(
  document: DrawingDocumentState,
  canvasId: string,
): DrawingExportTraversal {
  const structure = document.structure;
  if (!structure)
    throw new DrawingExportError("Canonical drawing structure is required.");
  const canvas = structure.canvases[canvasId];
  if (!canvas)
    throw new DrawingExportError(`Drawing canvas ${canvasId} does not exist.`);
  const page = structure.pages[canvas.pageId];
  if (!page)
    throw new DrawingExportError(
      `Drawing page ${canvas.pageId} does not exist.`,
    );

  const primitives: DrawingExportPrimitive[] = [];
  const layers = Object.values(structure.layers)
    .filter((layer) => layer.canvasId === canvasId && layer.visible)
    .sort(canonicalOrder);

  for (const layer of layers) {
    const objects = Object.values(structure.objects)
      .filter((object) => object.layerId === layer.id)
      .map((object) => ({ id: object.id, kind: "object" as const, object }));
    const instances = Object.values(structure.blockInstances)
      .filter((instance) => instance.layerId === layer.id)
      .map((instance) => ({
        id: instance.id,
        instance,
        kind: "block" as const,
      }));

    for (const item of [...objects, ...instances].sort((left, right) =>
      left.id.localeCompare(right.id),
    )) {
      if (item.kind === "object") {
        primitives.push({
          geometry: structuredClone(item.object.geometry),
          id: item.object.id,
          layerId: layer.id,
          style: resolveDrawingStyle(item.object, structure.styles),
          transform: [...identityTransform],
        });
        continue;
      }
      const block = structure.blocks[item.instance.blockId];
      if (!block)
        throw new DrawingExportError(
          `Drawing block ${item.instance.blockId} does not exist.`,
        );
      const model = blockInstanceRenderModel(
        block,
        item.instance,
        structure.styles,
      );
      const transform = instanceTransform(item.instance);
      for (const primitive of [...model.primitives].sort((left, right) =>
        left.localId.localeCompare(right.localId),
      )) {
        primitives.push({
          geometry: structuredClone(primitive.geometry),
          id: `${item.instance.id}/${primitive.localId}`,
          layerId: layer.id,
          style: structuredClone(primitive.style),
          transform: [...transform],
        });
      }
    }
  }

  return {
    canvas: structuredClone(canvas),
    page: structuredClone(page),
    primitives,
  };
}

function exportNumber(value: number) {
  if (!Number.isFinite(value))
    throw new DrawingExportError("Drawing export values must be finite.");
  const stable = stableNumber(value);
  if (Number.isInteger(stable)) return String(stable);
  return stable.toFixed(12).replace(/0+$/, "").replace(/\.$/, "");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function svgStroke(style: DrawingStyle) {
  return `fill="none" stroke="${style.stroke}" stroke-width="${exportNumber(style.strokeWidth)}"`;
}

function dimensionCalibration(
  canvas: DrawingCanvas,
  geometry: Extract<DrawingGeometry, { type: "dimension" }>,
) {
  const calibration = canvas.background?.calibration;
  return geometry.calibrationId && calibration
    ? {
        id: geometry.calibrationId,
        millimetersPerNormalizedUnit: calibration.millimetersPerNormalizedUnit,
        pageHeight: canvas.heightMillimeters,
        pageWidth: canvas.widthMillimeters,
      }
    : null;
}

function svgGeometry(
  primitive: DrawingExportPrimitive,
  canvas: DrawingCanvas,
): string[] {
  const { geometry, style } = primitive;
  switch (geometry.type) {
    case "line":
      return [
        `<line x1="${exportNumber(geometry.start.x)}" y1="${exportNumber(geometry.start.y)}" x2="${exportNumber(geometry.end.x)}" y2="${exportNumber(geometry.end.y)}" ${svgStroke(style)}/>`,
      ];
    case "polyline": {
      const element = geometry.closed ? "polygon" : "polyline";
      const points = geometry.points
        .map((point) => `${exportNumber(point.x)},${exportNumber(point.y)}`)
        .join(" ");
      return [`<${element} points="${points}" ${svgStroke(style)}/>`];
    }
    case "rectangle": {
      const rotation = geometry.rotation
        ? ` transform="rotate(${exportNumber(geometry.rotation)} ${exportNumber(geometry.origin.x)} ${exportNumber(geometry.origin.y)})"`
        : "";
      return [
        `<rect x="${exportNumber(geometry.origin.x)}" y="${exportNumber(geometry.origin.y)}" width="${exportNumber(geometry.width)}" height="${exportNumber(geometry.height)}" fill="${style.fill ?? "none"}" stroke="${style.stroke}" stroke-width="${exportNumber(style.strokeWidth)}"${rotation}/>`,
      ];
    }
    case "circle":
      return [
        `<circle cx="${exportNumber(geometry.center.x)}" cy="${exportNumber(geometry.center.y)}" r="${exportNumber(geometry.radius)}" fill="${style.fill ?? "none"}" stroke="${style.stroke}" stroke-width="${exportNumber(style.strokeWidth)}"/>`,
      ];
    case "text": {
      const layout = drawingTextLayout(geometry, style.fontSize ?? 14);
      const lines = geometry.text.split("\n");
      const content =
        lines.length === 1
          ? escapeXml(geometry.text)
          : lines
              .map(
                (line, index) =>
                  `<tspan x="${exportNumber(geometry.origin.x)}" y="${exportNumber(geometry.origin.y + index * layout.fontSize * layout.lineHeight)}">${escapeXml(line)}</tspan>`,
              )
              .join("");
      return [
        `<text x="${exportNumber(geometry.origin.x)}" y="${exportNumber(geometry.origin.y)}" width="${exportNumber(layout.width)}" fill="${style.fill ?? style.stroke}" font-family="sans-serif" font-size="${exportNumber(layout.fontSize)}" dominant-baseline="text-before-edge" xml:space="preserve">${content}</text>`,
      ];
    }
    case "dimension": {
      const layout = drawingDimensionLayout(
        geometry,
        dimensionCalibration(canvas, geometry),
      );
      const line = (
        start: { x: number; y: number },
        end: { x: number; y: number },
      ) =>
        `<line x1="${exportNumber(start.x)}" y1="${exportNumber(start.y)}" x2="${exportNumber(end.x)}" y2="${exportNumber(end.y)}" ${svgStroke(style)}/>`;
      return [
        line(layout.displayStart, layout.displayEnd),
        line(geometry.start, layout.displayStart),
        line(geometry.end, layout.displayEnd),
        `<text x="${exportNumber(layout.label.x)}" y="${exportNumber(layout.label.y)}" width="${exportNumber(layout.width)}" fill="${geometry.calibrationId === null ? "#dc2626" : style.stroke}" font-family="sans-serif" font-size="${exportNumber(layout.fontSize)}" dominant-baseline="text-before-edge" xml:space="preserve">${escapeXml(layout.text)}</text>`,
      ];
    }
  }
}

/** Creates stable SVG bytes directly from the canonical export traversal. */
export function exportDrawingSvg(
  document: DrawingDocumentState,
  canvasId: string,
): string {
  const traversal = collectExportPrimitives(document, canvasId);
  const { canvas } = traversal;
  const width = exportNumber(canvas.widthMillimeters);
  const height = exportNumber(canvas.heightMillimeters);
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}mm" height="${height}mm" viewBox="0 0 ${width} ${height}">`,
    `<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`,
  ];
  for (const primitive of traversal.primitives) {
    lines.push(
      `<g data-export-id="${escapeXml(primitive.id)}" transform="matrix(${primitive.transform.map(exportNumber).join(" ")})">`,
      ...svgGeometry(primitive, canvas),
      "</g>",
    );
  }
  lines.push("</svg>", "");
  return lines.join("\n");
}

function requireExportBackground(
  canvas: DrawingCanvas,
  background: DrawingExportBackground | undefined,
) {
  const canonical = canvas.background;
  if (!canonical) return null;
  if (!background)
    throw new DrawingExportError("PDF background pixels are missing.");
  if (
    background.sourceFileId !== canonical.sourceFileId ||
    background.sourceSha256 !== canonical.sourceSha256 ||
    background.pdfPageNumber !== canonical.pdfPageNumber
  )
    throw new DrawingExportError(
      "PDF background canvas does not match the canonical source.",
    );
  const { bounds } = background;
  if (
    ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
    bounds.width <= 0 ||
    bounds.height <= 0
  )
    throw new DrawingExportError("PDF background bounds are invalid.");
  return background;
}

function nativeCanvas() {
  if (typeof document === "undefined" || !document.createElement)
    throw new DrawingExportError(
      "PNG export requires a browser Canvas implementation.",
    );
  return document.createElement("canvas");
}

function canvasLine(
  context: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

function paintGeometry(
  context: CanvasRenderingContext2D,
  primitive: DrawingExportPrimitive,
  canvas: DrawingCanvas,
) {
  const { geometry, style } = primitive;
  context.save();
  context.transform(...primitive.transform);
  context.strokeStyle = style.stroke;
  context.lineWidth = style.strokeWidth;
  context.fillStyle = style.fill ?? style.stroke;
  switch (geometry.type) {
    case "line":
      canvasLine(context, geometry.start, geometry.end);
      break;
    case "polyline":
      context.beginPath();
      context.moveTo(geometry.points[0].x, geometry.points[0].y);
      for (const point of geometry.points.slice(1))
        context.lineTo(point.x, point.y);
      if (geometry.closed) context.closePath();
      context.stroke();
      break;
    case "rectangle":
      context.save();
      context.translate(geometry.origin.x, geometry.origin.y);
      context.rotate((geometry.rotation * Math.PI) / 180);
      if (style.fill) context.fillRect(0, 0, geometry.width, geometry.height);
      context.strokeRect(0, 0, geometry.width, geometry.height);
      context.restore();
      break;
    case "circle":
      context.beginPath();
      context.arc(
        geometry.center.x,
        geometry.center.y,
        geometry.radius,
        0,
        Math.PI * 2,
      );
      if (style.fill) context.fill();
      context.stroke();
      break;
    case "text": {
      const layout = drawingTextLayout(geometry, style.fontSize ?? 14);
      context.font = `${exportNumber(layout.fontSize)}px sans-serif`;
      context.textBaseline = "top";
      geometry.text
        .split("\n")
        .forEach((line, index) =>
          context.fillText(
            line,
            geometry.origin.x,
            geometry.origin.y + index * layout.fontSize * layout.lineHeight,
            layout.width,
          ),
        );
      break;
    }
    case "dimension": {
      const layout = drawingDimensionLayout(
        geometry,
        dimensionCalibration(canvas, geometry),
      );
      canvasLine(context, layout.displayStart, layout.displayEnd);
      canvasLine(context, geometry.start, layout.displayStart);
      canvasLine(context, geometry.end, layout.displayEnd);
      context.fillStyle =
        geometry.calibrationId === null ? "#dc2626" : style.stroke;
      context.font = `${exportNumber(layout.fontSize)}px sans-serif`;
      context.textBaseline = "top";
      context.fillText(
        layout.text,
        layout.label.x,
        layout.label.y,
        layout.width,
      );
      break;
    }
  }
  context.restore();
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new DrawingExportError("PNG encoding failed."));
      }, "image/png");
    } catch (error) {
      reject(
        error instanceof DOMException && error.name === "SecurityError"
          ? new DrawingExportError(
              "PNG export failed because the background canvas is tainted.",
            )
          : new DrawingExportError(
              `PNG encoding failed: ${error instanceof Error ? error.message : "unknown error"}`,
            ),
      );
    }
  });
}

/** Renders canonical primitives and optional verified PDF.js pixels to PNG. */
export async function exportDrawingPng(
  documentState: DrawingDocumentState,
  canvasId: string,
  options: DrawingExportPngOptions,
): Promise<Blob> {
  if (options.scale !== 1 && options.scale !== 2 && options.scale !== 4)
    throw new DrawingExportError("PNG scale must be 1x, 2x, or 4x.");
  const traversal = collectExportPrimitives(documentState, canvasId);
  const background = requireExportBackground(
    traversal.canvas,
    options.background,
  );
  const canvas = (options.canvasFactory ?? nativeCanvas)();
  canvas.width = Math.max(
    1,
    Math.round(traversal.canvas.widthMillimeters * options.scale),
  );
  canvas.height = Math.max(
    1,
    Math.round(traversal.canvas.heightMillimeters * options.scale),
  );
  const context = canvas.getContext("2d");
  if (!context)
    throw new DrawingExportError("PNG Canvas 2D context is unavailable.");
  context.setTransform(
    canvas.width / traversal.canvas.widthMillimeters,
    0,
    0,
    canvas.height / traversal.canvas.heightMillimeters,
    0,
    0,
  );
  context.fillStyle = "#ffffff";
  context.fillRect(
    0,
    0,
    traversal.canvas.widthMillimeters,
    traversal.canvas.heightMillimeters,
  );
  if (background) {
    try {
      context.drawImage(
        background.canvas,
        background.bounds.x,
        background.bounds.y,
        background.bounds.width,
        background.bounds.height,
      );
    } catch (error) {
      throw new DrawingExportError(
        error instanceof DOMException && error.name === "SecurityError"
          ? "PNG export failed because the background canvas is tainted."
          : `PDF background encoding failed: ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }
  }
  for (const primitive of traversal.primitives)
    paintGeometry(context, primitive, traversal.canvas);
  return encodePng(canvas);
}

function exportCanvases(
  documentState: DrawingDocumentState,
  selectedIds?: string[],
) {
  const structure = documentState.structure;
  if (!structure)
    throw new DrawingExportError("Canonical drawing structure is required.");
  const selected = selectedIds ? new Set(selectedIds) : null;
  if (selected) {
    for (const canvasId of selected) {
      if (!structure.canvases[canvasId])
        throw new DrawingExportError(
          `Drawing canvas ${canvasId} does not exist.`,
        );
    }
  }
  const canvases = Object.values(structure.canvases)
    .filter((canvas) =>
      selected ? selected.has(canvas.id) : canvas.spaceKind === "paper",
    )
    .sort((left, right) => {
      const leftPage = structure.pages[left.pageId];
      const rightPage = structure.pages[right.pageId];
      if (!leftPage || !rightPage)
        throw new DrawingExportError("Drawing canvas page does not exist.");
      return (
        leftPage.sortOrder - rightPage.sortOrder ||
        leftPage.id.localeCompare(rightPage.id) ||
        left.sortOrder - right.sortOrder ||
        left.id.localeCompare(right.id)
      );
    });
  if (!canvases.length)
    throw new DrawingExportError("No drawing canvases were selected for PDF.");
  return canvases;
}

/** Writes one rendered image page per canonical paper canvas (or explicit model selection). */
export async function exportDrawingPdf(
  documentState: DrawingDocumentState,
  options: DrawingExportPdfOptions,
): Promise<Uint8Array> {
  const createdAt = new Date(options.createdAt);
  if (!Number.isFinite(createdAt.getTime()))
    throw new DrawingExportError("PDF metadata date is invalid.");
  const title = options.title.trim();
  if (!title) throw new DrawingExportError("PDF title is required.");
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setTitle(title);
  if (options.author?.trim()) pdf.setAuthor(options.author.trim());
  if (options.subject?.trim()) pdf.setSubject(options.subject.trim());
  pdf.setCreator("1HK Drawing Workspace");
  pdf.setProducer("pdf-lib 1.17.1 / 1HK Drawing Workspace");
  pdf.setCreationDate(createdAt);
  pdf.setModificationDate(createdAt);

  for (const canvas of exportCanvases(documentState, options.canvasIds)) {
    const background = await options.getBackground?.(structuredClone(canvas));
    const png = await exportDrawingPng(documentState, canvas.id, {
      background,
      canvasFactory: options.canvasFactory,
      scale: options.scale,
    });
    const image = await pdf.embedPng(await png.arrayBuffer());
    const width = (canvas.widthMillimeters * 72) / 25.4;
    const height = (canvas.heightMillimeters * 72) / 25.4;
    const page = pdf.addPage([width, height]);
    page.drawImage(image, { x: 0, y: 0, width, height });
  }
  return pdf.save({ addDefaultPage: false, useObjectStreams: false });
}
