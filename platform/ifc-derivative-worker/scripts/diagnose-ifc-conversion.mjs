import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";

import { createClient } from "@supabase/supabase-js";

import { validateManagedIfcDerivativePair } from "../../app/lukas/lib/drawing-workspace.server.ts";

const converter = process.env.IFC_DIAGNOSTIC_CONVERTER_PATH;
const scanner = process.env.IFC_DIAGNOSTIC_SCANNER_PATH;
if (!converter || !isAbsolute(converter)) {
  throw new Error("IFC_DIAGNOSTIC_CONVERTER_PATH must be absolute");
}
if (!scanner || !isAbsolute(scanner)) {
  throw new Error("IFC_DIAGNOSTIC_SCANNER_PATH must be absolute");
}

const client = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  },
);

const { data: files, error } = await client
  .from("lukas_qto_files")
  .select("id,storage_path,byte_size,sha256")
  .eq("kind", "ifc")
  .eq("immutable", true)
  .order("id", { ascending: true });
if (error) throw new Error("Could not list immutable IFC sources");

const root = await mkdtemp(join(tmpdir(), "1hk-ifc-diagnostic-"));
const results = [];
try {
  for (const [index, file] of (files ?? []).entries()) {
    const { data: blob, error: downloadError } = await client.storage
      .from("lukas-qto")
      .download(file.storage_path);
    if (downloadError || !blob) {
      results.push({ sourceOrdinal: index + 1, stage: "download_failed" });
      continue;
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const keywordCounts = new Map();
    for (const match of text.matchAll(/#[0-9]+\s*=\s*(IFC[A-Z0-9_]+)\s*\(/g)) {
      keywordCounts.set(match[1], (keywordCounts.get(match[1]) ?? 0) + 1);
    }
    const geometryKeywords = [...keywordCounts]
      .filter(([keyword]) =>
        /BREP|BOOLEAN|BOUNDINGBOX|CARTESIANPOINTLIST|CSG|CURVE|EXTRUDED|FACE|HALFSPACE|MAPPEDITEM|MESH|POLYGON|PROFILE|REPRESENTATION|REVOLVED|SHELL|SOLID|SURFACE|SWEPT|TESSELLATED|TRIANGULATED/.test(
          keyword,
        ),
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([keyword, count]) => ({ keyword, count }));

    const sourcePath = join(root, `source-${index + 1}.ifc`);
    const manifestPath = join(root, `manifest-${index + 1}.json`);
    const geometryPath = join(root, `geometry-${index + 1}.glb`);
    await writeFile(sourcePath, bytes, { flag: "wx", mode: 0o600 });
    const conversion = await runConverter([
      sourcePath,
      manifestPath,
      geometryPath,
      "--source-file-id",
      file.id,
    ]);
    const artifactSummary =
      conversion.exitCode === 0
        ? await summarizeArtifacts(
            await readFile(manifestPath),
            await readFile(geometryPath),
            file.id,
            digest,
          )
        : null;
    const scan = await runProcess(scanner, [sourcePath]);
    if (scan.exitCode !== 0) throw new Error("IFC diagnostic scan failed");
    const failedProductId = conversion.stderr.match(/product #(\d+)/)?.[1];
    const failedProduct = failedProductId
      ? instanceSummary(text, failedProductId)
      : null;
    results.push({
      sourceOrdinal: index + 1,
      byteSize: bytes.byteLength,
      metadataByteSizeMatches: bytes.byteLength === Number(file.byte_size),
      metadataSha256Matches: digest === file.sha256,
      schema: text.match(/FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i)?.[1] ?? null,
      productCount: [...keywordCounts]
        .filter(([keyword]) =>
          /^(IFCBEAM|IFCBUILDINGELEMENTPROXY|IFCCOLUMN|IFCCOVERING|IFCCURTAINWALL|IFCDOOR|IFCFOOTING|IFCFURNISHINGELEMENT|IFCMEMBER|IFCPLATE|IFCRAILING|IFCRAMP|IFCROOF|IFCSLAB|IFCSTAIR|IFCWALL|IFCWINDOW)$/.test(
            keyword,
          ),
        )
        .reduce((sum, [, count]) => sum + count, 0),
      geometryKeywords,
      converterExitCode: conversion.exitCode,
      artifactSummary,
      failedProduct,
      meshScan: JSON.parse(scan.stdout),
      converterError: conversion.stderr
        .replaceAll(root, "<diagnostic-temp>")
        .slice(0, 4_000),
    });
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

process.stdout.write(`${JSON.stringify({ sources: results })}\n`);

async function summarizeArtifacts(
  manifestBytes,
  geometryBytes,
  sourceFileId,
  sourceSha256,
) {
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const view = new DataView(
    geometryBytes.buffer,
    geometryBytes.byteOffset,
    geometryBytes.byteLength,
  );
  const jsonLength = view.getUint32(12, true);
  const geometry = JSON.parse(
    new TextDecoder()
      .decode(geometryBytes.subarray(20, 20 + jsonLength))
      .trim(),
  );
  const primitiveModes = {};
  for (const mesh of geometry.meshes ?? [])
    for (const primitive of mesh.primitives ?? []) {
      const mode = String(primitive.mode ?? 4);
      primitiveModes[mode] = (primitiveModes[mode] ?? 0) + 1;
    }
  await validateManagedIfcDerivativePair({
    sourceFileId,
    sourceSha256,
    manifestBytes,
    geometryBytes,
  });
  return {
    elementCount: manifest.elements?.length ?? 0,
    managedValidation: true,
    nodeCount: geometry.nodes?.length ?? 0,
    primitiveModes,
  };
}

function instanceSummary(text, expressId) {
  const records = new Map();
  for (const match of text.matchAll(
    /#(\d+)\s*=\s*(IFC[A-Z0-9_]+)\s*\(([\s\S]*?)\);/g,
  )) {
    records.set(match[1], { keyword: match[2], body: match[3] });
  }
  const root = records.get(expressId);
  if (!root) return { expressId, keyword: null, directReferences: [] };
  const directReferences = [...root.body.matchAll(/#(\d+)/g)]
    .map((match) => match[1])
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .map((id) => ({
      expressId: id,
      keyword: records.get(id)?.keyword ?? null,
    }));
  const representationGraph = directReferences
    .filter(({ keyword }) => keyword === "IFCPRODUCTDEFINITIONSHAPE")
    .flatMap(({ expressId: definitionId }) => {
      const definition = records.get(definitionId);
      if (!definition) return [];
      return [...definition.body.matchAll(/#(\d+)/g)]
        .map((match) => match[1])
        .filter((id, index, ids) => ids.indexOf(id) === index)
        .map((representationId) => {
          const representation = records.get(representationId);
          const representationReferences = representation
            ? [...representation.body.matchAll(/#(\d+)/g)]
                .map((match) => match[1])
                .filter((id, index, ids) => ids.indexOf(id) === index)
                .map((id) => ({
                  expressId: id,
                  keyword: records.get(id)?.keyword ?? null,
                  nestedReferenceKeywords: records.get(id)
                    ? [...records.get(id).body.matchAll(/#(\d+)/g)]
                        .map((match) => records.get(match[1])?.keyword ?? null)
                        .filter((keyword) => keyword !== null)
                    : [],
                }))
            : [];
          return {
            expressId: representationId,
            keyword: representation?.keyword ?? null,
            references: representationReferences,
          };
        });
    });
  const closure = [];
  const queued = directReferences
    .filter(({ keyword }) => keyword === "IFCPRODUCTDEFINITIONSHAPE")
    .map(({ expressId: id }) => ({ id, depth: 0 }));
  const visited = new Set();
  while (queued.length && closure.length < 100) {
    const { id, depth } = queued.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const record = records.get(id);
    if (!record) continue;
    const childIds = [...record.body.matchAll(/#(\d+)/g)]
      .map((match) => match[1])
      .filter((childId, index, ids) => ids.indexOf(childId) === index);
    const children = childIds
      .map((childId) => ({
        expressId: childId,
        keyword: records.get(childId)?.keyword ?? null,
      }))
      .filter(({ keyword }) => keyword !== null);
    closure.push({ expressId: id, keyword: record.keyword, depth, children });
    if (depth >= 6) continue;
    for (const child of children) {
      if (
        /REPRESENTATION|MAPPEDITEM|TRANSFORMATION|GEOMETRICSET|CURVESET|POLYLINE|COMPOSITECURVE|TRIMMEDCURVE|FACE|SHELL|SURFACE/.test(
          child.keyword,
        )
      ) {
        queued.push({ id: child.expressId, depth: depth + 1 });
      }
    }
  }
  return {
    expressId,
    keyword: root.keyword,
    directReferences,
    representationGraph,
    representationClosure: closure,
  };
}

function runConverter(args) {
  return runProcess(converter, args);
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { PATH: process.env.PATH ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk}`.slice(0, 1_000_000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(0, 8_000);
    });
    child.once("error", reject);
    child.once("close", (exitCode) =>
      resolve({ exitCode, stdout: stdout.trim(), stderr: stderr.trim() }),
    );
  });
}
