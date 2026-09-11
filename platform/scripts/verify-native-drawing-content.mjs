#!/usr/bin/env node
// Local authored-content evidence, not an authenticated tenant import or CAD delivery service.
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createDrawingDocumentState } from "../app/lukas/lib/drawing-commands.ts";
import { exportDrawingSvg } from "../app/lukas/lib/drawing-export.ts";
import {
  nativeAssetCanonicalJson,
  nativeAssetSha256,
  listNativeDrawingSymbols,
} from "../app/lukas/lib/drawing-native-symbols.ts";
import {
  buildNativeDrawingTemplate,
  listNativeDrawingTemplateKeys,
} from "../app/lukas/lib/drawing-native-templates.ts";
import { validateDrawingStructureState } from "../app/lukas/lib/drawing-structure.ts";

const usage =
  "Usage: node scripts/verify-native-drawing-content.mjs --output-dir /absolute/new-directory";

export function assertNativeAssetOutputKey(key, seen) {
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(key) || seen.has(key))
    throw new Error("Native asset output keys must be safe, unique filenames.");
  seen.add(key);
}

function symbolPreview(symbol) {
  const id = (number) =>
    `10000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const [revisionId, pageId, canvasId, layerId, blockId, instanceId] = [
    1, 2, 3, 4, 5, 6,
  ].map(id);
  const margin = Math.max(symbol.bounds.width, symbol.bounds.height) * 0.08;
  const structure = {
    revisionId,
    pages: {
      [pageId]: {
        id: pageId,
        revisionId,
        name: symbol.name,
        sortOrder: 0,
        version: 1,
      },
    },
    canvases: {
      [canvasId]: {
        id: canvasId,
        pageId,
        name: symbol.name,
        spaceKind: "paper",
        widthMillimeters: symbol.bounds.width + margin * 2,
        heightMillimeters: symbol.bounds.height + margin * 2,
        background: null,
        sortOrder: 0,
        version: 1,
      },
    },
    layers: {
      [layerId]: {
        id: layerId,
        name: symbol.recommendedLayer,
        visible: true,
        locked: false,
        systemKind: "work",
        canvasId,
        sortOrder: 0,
        version: 1,
      },
    },
    objects: {},
    styles: {},
    blocks: {
      [blockId]: {
        id: blockId,
        revisionId,
        name: symbol.name,
        primitives: symbol.primitives,
        version: 1,
      },
    },
    blockInstances: {
      [instanceId]: {
        id: instanceId,
        lineageId: instanceId,
        blockId,
        layerId,
        name: symbol.name,
        origin: { x: margin - symbol.bounds.x, y: margin - symbol.bounds.y },
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        version: 1,
      },
    },
    propertySchemas: {},
    propertyValues: {},
    tables: {},
  };
  validateDrawingStructureState(structure);
  const { revisionId: revision, ...collections } = structure;
  return exportDrawingSvg(
    createDrawingDocumentState({
      revisionId: revision,
      structure: collections,
    }),
    canvasId,
  );
}

function templatePreview(template) {
  validateDrawingStructureState(template.structure);
  const { revisionId, ...collections } = template.structure;
  const canvases = Object.values(collections.canvases);
  if (canvases.length !== 1)
    throw new Error(
      "Native content evidence requires one explicitly authored model canvas.",
    );
  const canvas = canvases[0];
  const profile = template.outputProfile;
  if (
    profile.widthMillimeters * profile.scaleDenominator !==
      canvas.widthMillimeters ||
    profile.heightMillimeters * profile.scaleDenominator !==
      canvas.heightMillimeters
  )
    throw new Error(
      "Native template paper dimensions and model scale do not agree.",
    );
  const svg = exportDrawingSvg(
    createDrawingDocumentState({ revisionId, structure: collections }),
    canvas.id,
  );
  // Only the physical paper size changes; all entity coordinates and the native viewBox remain millimeters.
  const root = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.widthMillimeters}mm" height="${canvas.heightMillimeters}mm" viewBox="0 0 ${canvas.widthMillimeters} ${canvas.heightMillimeters}">`;
  if (!svg.startsWith(root))
    throw new Error(
      "Native SVG root contract changed; refusing an unverified scale conversion.",
    );
  return svg.replace(
    root,
    `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${profile.widthMillimeters}mm" height="${profile.heightMillimeters}mm" viewBox="0 0 ${canvas.widthMillimeters} ${canvas.heightMillimeters}">`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--output-dir") throw new Error(usage);
  if (!path.isAbsolute(args[1]))
    throw new Error(`${usage}\nOutput must be an absolute path.`);
  const directory = path.resolve(args[1]);
  // mkdir without recursive or reuse is also a no-overwrite gate for files, directories and symlinks.
  await mkdir(directory);
  const assets = [];
  const entries = [
    ...listNativeDrawingSymbols().map((definition) => ({
      kind: "native_symbol",
      definition,
      preview: symbolPreview,
    })),
    ...listNativeDrawingTemplateKeys().map((key) => ({
      kind: "workspace_template",
      definition: buildNativeDrawingTemplate(key),
      preview: templatePreview,
    })),
  ];
  const seen = new Set();
  for (const { kind, definition, preview } of entries) {
    assertNativeAssetOutputKey(definition.key, seen);
    const before = nativeAssetCanonicalJson(definition);
    const svg = preview(definition);
    if (nativeAssetCanonicalJson(definition) !== before)
      throw new Error(`Renderer changed source definition: ${definition.key}`);
    const definitionFile = `${definition.key}.native.json`;
    const previewFile = `${definition.key}.svg`;
    await writeFile(path.join(directory, definitionFile), `${before}\n`, {
      flag: "wx",
    });
    await writeFile(path.join(directory, previewFile), svg, { flag: "wx" });
    assets.push({
      kind,
      key: definition.key,
      version: definition.version,
      contentSha256: await nativeAssetSha256(definition),
      previewSha256: createHash("sha256").update(svg).digest("hex"),
      definitionFile,
      previewFile,
      provenance: definition.provenance,
      units: definition.units,
      ...(kind === "workspace_template"
        ? { outputProfile: definition.outputProfile }
        : {
            bounds: definition.bounds,
            insertionPoint: definition.insertionPoint,
            classification: definition.classification,
          }),
    });
  }
  const manifest = {
    schemaVersion: "1hk-native-content-evidence/1",
    status: "local-content-verification-only",
    productionDwgQualified: false,
    publicRedistributionLicensed: false,
    limitations: [
      "Schematic examples and assumed quantities require site and professional review.",
      "Authenticated catalog import and persisted output-profile editing are not part of this content compiler.",
      "First-party content redistribution license is unassigned; review platform/LICENSE.md separately before public distribution.",
      "This SVG evidence is not DWG qualification or customer delivery acceptance.",
    ],
    assets,
  };
  // Written last: its presence means all referenced exclusive writes and validations completed.
  await writeFile(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx" },
  );
  process.stdout.write(
    `${JSON.stringify({ status: manifest.status, assets: assets.length, outputDirectory: directory })}\n`,
  );
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url))
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
