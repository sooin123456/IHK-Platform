import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { IfcRenderBundleDescriptor } from "./ifc-render-descriptor";
export type { IfcRenderBundleDescriptor } from "./ifc-render-descriptor";

export type IfcRenderProperty = {
  group: string;
  name: string;
  value: string | number | boolean | null;
};

export type IfcRenderMeshReference = {
  nodeId: string;
  primitiveIndices: number[];
};

export type IfcRenderElement = {
  expressId: number;
  globalId: string;
  typeName: string;
  name: string | null;
  properties: IfcRenderProperty[];
  meshes: IfcRenderMeshReference[];
};

export type IfcRenderManifest = {
  schemaVersion: 1;
  source: { fileId: string; sha256: string };
  geometry: { sha256: string };
  elements: IfcRenderElement[];
};

export type OwnedIfcRenderModel = {
  root: THREE.Object3D;
  elementMeshes: ReadonlyMap<number, readonly THREE.Mesh[]>;
  renderedElementCount: number;
  dispose(): void;
};

export type IfcRenderAssetDescriptor = {
  signedUrl: string;
  sha256: string;
  byteSize: number;
};

export type VerifiedIfcRenderBundle = {
  manifest: IfcRenderManifest;
  geometryBytes: Uint8Array | null;
  skipped: boolean;
};

const SHA256 = /^[0-9a-f]{64}$/;
const IFC_GLOBAL_ID = /^[0-9A-Za-z_$]{22}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ELEMENTS = 1_000_000;
const MAX_PROPERTIES_PER_ELEMENT = 10_000;
const MAX_NODE_REFS_PER_ELEMENT = 10_000;
const MAX_PRIMITIVES_PER_NODE = 1_000;
const MAX_MANIFEST_BYTES = 32 * 1024 * 1024;
export const MAX_BROWSER_GLB_BYTES = 75 * 1024 * 1024;

function manifestError(message: string): never {
  throw new Error(`IFC render manifest is invalid: ${message}`);
}

function strictString(
  value: unknown,
  label: string,
  { allowEmpty = false, max = 2_048, trim = false } = {},
) {
  const normalized = typeof value === "string" && trim ? value.trim() : value;
  if (
    typeof normalized !== "string" ||
    (!allowEmpty && normalized.length === 0) ||
    normalized.length > max
  )
    manifestError(label);
  return normalized;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
) {
  if (
    Object.keys(value).length !== expected.length ||
    Object.keys(value).some((key) => !expected.includes(key))
  )
    manifestError(label);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export function validateIfcRenderManifest(
  input: unknown,
  expected: {
    source: { fileId: string; sha256: string };
    geometrySha256: string;
  },
): IfcRenderManifest {
  if (!input || typeof input !== "object" || Array.isArray(input))
    manifestError("root");
  const record = input as Record<string, unknown>;
  exactKeys(
    record,
    ["schemaVersion", "source", "geometry", "elements"],
    "root keys",
  );
  if (record.schemaVersion !== 1) manifestError("schemaVersion");
  const source = record.source as Record<string, unknown> | null;
  const geometry = record.geometry as Record<string, unknown> | null;
  if (
    !UUID.test(expected.source.fileId) ||
    !SHA256.test(expected.source.sha256) ||
    !SHA256.test(expected.geometrySha256) ||
    !source ||
    Array.isArray(source) ||
    source.fileId !== expected.source.fileId ||
    source.sha256 !== expected.source.sha256 ||
    !geometry ||
    Array.isArray(geometry) ||
    geometry.sha256 !== expected.geometrySha256
  )
    manifestError("hash chain");
  exactKeys(source, ["fileId", "sha256"], "source keys");
  exactKeys(geometry, ["sha256"], "geometry keys");
  if (!Array.isArray(record.elements) || record.elements.length > MAX_ELEMENTS)
    manifestError("elements");

  const expressIds = new Set<number>();
  const globalIds = new Set<string>();
  const meshPrimitives = new Set<string>();
  const elements = record.elements.map((value, index): IfcRenderElement => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      manifestError(`elements[${index}]`);
    const element = value as Record<string, unknown>;
    exactKeys(
      element,
      ["expressId", "globalId", "typeName", "name", "meshes", "properties"],
      `elements[${index}] keys`,
    );
    if (
      !Number.isSafeInteger(element.expressId) ||
      (element.expressId as number) <= 0 ||
      expressIds.has(element.expressId as number)
    )
      manifestError(`elements[${index}].expressId`);
    expressIds.add(element.expressId as number);

    const globalId = element.globalId;
    if (
      typeof globalId !== "string" ||
      !IFC_GLOBAL_ID.test(globalId) ||
      globalIds.has(globalId)
    )
      manifestError(`elements[${index}].globalId`);
    globalIds.add(globalId);

    if (
      !Array.isArray(element.properties) ||
      element.properties.length > MAX_PROPERTIES_PER_ELEMENT
    )
      manifestError(`elements[${index}].properties`);
    const properties = element.properties.map((property, propertyIndex) => {
      if (!property || typeof property !== "object" || Array.isArray(property))
        manifestError(`elements[${index}].properties[${propertyIndex}]`);
      const item = property as Record<string, unknown>;
      exactKeys(
        item,
        ["group", "name", "value"],
        `elements[${index}].properties[${propertyIndex}] keys`,
      );
      if (
        item.value !== null &&
        typeof item.value !== "string" &&
        typeof item.value !== "number" &&
        typeof item.value !== "boolean"
      )
        manifestError(`elements[${index}].properties[${propertyIndex}].value`);
      if (typeof item.value === "number" && !Number.isFinite(item.value))
        manifestError(`elements[${index}].properties[${propertyIndex}].value`);
      return {
        group: strictString(
          item.group,
          `elements[${index}].properties[${propertyIndex}].group`,
          { max: 160, trim: true },
        ),
        name: strictString(
          item.name,
          `elements[${index}].properties[${propertyIndex}].name`,
          { max: 160, trim: true },
        ),
        value:
          typeof item.value === "string"
            ? strictString(
                item.value,
                `elements[${index}].properties[${propertyIndex}].value`,
                { allowEmpty: true, max: 4_000 },
              )
            : (item.value as number | boolean | null),
      };
    });

    if (
      !Array.isArray(element.meshes) ||
      element.meshes.length === 0 ||
      element.meshes.length > MAX_NODE_REFS_PER_ELEMENT
    )
      manifestError(`elements[${index}].meshes`);
    const meshes = element.meshes.map((mesh, meshIndex) => {
      if (!mesh || typeof mesh !== "object" || Array.isArray(mesh))
        manifestError(`elements[${index}].meshes[${meshIndex}]`);
      const item = mesh as Record<string, unknown>;
      exactKeys(
        item,
        ["nodeId", "primitiveIndices"],
        `elements[${index}].meshes[${meshIndex}] keys`,
      );
      const nodeId = strictString(
        item.nodeId,
        `elements[${index}].meshes[${meshIndex}].nodeId`,
        { max: 256, trim: true },
      );
      if (
        !Array.isArray(item.primitiveIndices) ||
        item.primitiveIndices.length === 0 ||
        item.primitiveIndices.length > MAX_PRIMITIVES_PER_NODE
      )
        manifestError(
          `elements[${index}].meshes[${meshIndex}].primitiveIndices`,
        );
      const localPrimitiveIndices = new Set<number>();
      const primitiveIndices = item.primitiveIndices.map(
        (primitiveIndex, primitiveOffset) => {
          if (
            !Number.isSafeInteger(primitiveIndex) ||
            primitiveIndex < 0 ||
            localPrimitiveIndices.has(primitiveIndex)
          )
            manifestError(
              `elements[${index}].meshes[${meshIndex}].primitiveIndices[${primitiveOffset}]`,
            );
          localPrimitiveIndices.add(primitiveIndex);
          const key = `${nodeId}:${primitiveIndex}`;
          if (meshPrimitives.has(key))
            manifestError(`duplicate mesh primitive ${key}`);
          meshPrimitives.add(key);
          return primitiveIndex;
        },
      );
      return { nodeId, primitiveIndices };
    });

    return {
      expressId: element.expressId as number,
      globalId,
      typeName: strictString(element.typeName, `elements[${index}].typeName`, {
        max: 160,
        trim: true,
      }),
      name:
        element.name === null
          ? null
          : strictString(element.name, `elements[${index}].name`, {
              allowEmpty: true,
              max: 500,
            }),
      properties,
      meshes,
    };
  });

  return {
    schemaVersion: 1,
    source: { ...expected.source },
    geometry: { sha256: expected.geometrySha256 },
    elements,
  };
}

export function mapIfcRenderScene(
  root: THREE.Object3D,
  manifest: IfcRenderManifest,
) {
  const expected = new Map<string, number>();
  for (const element of manifest.elements)
    for (const mesh of element.meshes)
      for (const primitiveIndex of mesh.primitiveIndices)
        expected.set(`${mesh.nodeId}:${primitiveIndex}`, element.expressId);

  const seen = new Set<string>();
  const elementMeshes = new Map<number, THREE.Mesh[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let node: THREE.Object3D | null = object;
    while (node && typeof node.userData.ifcNodeId !== "string")
      node = node.parent;
    const nodeId = node?.userData.ifcNodeId;
    const primitiveIndex = object.userData.ifcPrimitiveIndex;
    if (typeof nodeId !== "string" || !Number.isSafeInteger(primitiveIndex))
      throw new Error("IFC GLB node ID or primitive index is missing.");
    const primitiveKey = `${nodeId}:${primitiveIndex}`;
    if (!expected.has(primitiveKey))
      throw new Error(`IFC GLB node primitive is unknown: ${primitiveKey}`);
    if (seen.has(primitiveKey))
      throw new Error(`IFC GLB node primitive is duplicated: ${primitiveKey}`);
    const expectedExpressId = expected.get(primitiveKey)!;
    const embeddedExpressId = node?.userData.ifcExpressId;
    if (
      embeddedExpressId !== undefined &&
      embeddedExpressId !== expectedExpressId
    )
      throw new Error(
        `IFC GLB expressId does not match node primitive ${primitiveKey}.`,
      );
    seen.add(primitiveKey);
    object.userData.ifcResolvedExpressId = expectedExpressId;
    const siblings = elementMeshes.get(expectedExpressId);
    if (siblings) siblings.push(object);
    else elementMeshes.set(expectedExpressId, [object]);
  });

  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].find(
      (primitiveKey) => !seen.has(primitiveKey),
    );
    throw new Error(
      `IFC GLB node primitive is missing: ${missing ?? "unknown"}`,
    );
  }
  return { elementMeshes };
}

function ownedTextures(material: THREE.Material) {
  const textures = new Set<THREE.Texture>();
  for (const value of Object.values(material))
    if (value instanceof THREE.Texture) textures.add(value);
  const uniforms = (material as THREE.ShaderMaterial).uniforms;
  if (uniforms)
    for (const uniform of Object.values(uniforms)) {
      const value = (uniform as { value?: unknown })?.value;
      if (value instanceof THREE.Texture) textures.add(value);
      else if (Array.isArray(value))
        for (const item of value)
          if (item instanceof THREE.Texture) textures.add(item);
    }
  return textures;
}

function collectIfcRenderResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(material);
      for (const texture of ownedTextures(material)) textures.add(texture);
    }
  });
  return { geometries, materials, textures };
}

function disposeIfcRenderResources(
  root: THREE.Object3D,
  resources: ReturnType<typeof collectIfcRenderResources>,
) {
  const { geometries, materials, textures } = resources;
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.removeFromParent();
}

function disposeIfcRenderRoot(root: THREE.Object3D) {
  disposeIfcRenderResources(root, collectIfcRenderResources(root));
}

export function createOwnedIfcRenderModel(
  root: THREE.Object3D,
  manifest: IfcRenderManifest,
): OwnedIfcRenderModel {
  const { elementMeshes } = mapIfcRenderScene(root, manifest);
  const resources = collectIfcRenderResources(root);
  let disposed = false;
  return {
    root,
    elementMeshes,
    renderedElementCount: elementMeshes.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeIfcRenderResources(root, resources);
      elementMeshes.clear();
    },
  };
}

export function assertSelfContainedGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 20)
    throw new Error("GLB is not self-contained: header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  )
    throw new Error("GLB is not self-contained: invalid container");

  let offset = 12;
  let json: Record<string, unknown> | null = null;
  while (offset + 8 <= bytes.byteLength) {
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += 8;
    if (offset + length > bytes.byteLength)
      throw new Error("GLB is not self-contained: invalid chunk");
    if (type === 0x4e4f534a) {
      const text = new TextDecoder()
        .decode(bytes.subarray(offset, offset + length))
        .trim();
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        throw new Error("GLB is not self-contained: invalid JSON");
      }
    }
    offset += length;
  }
  if (offset !== bytes.byteLength)
    throw new Error("GLB is not self-contained: incomplete chunk header");
  if (!json) throw new Error("GLB is not self-contained: JSON chunk missing");
  for (const collection of [json.buffers, json.images]) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      const uri =
        item && typeof item === "object"
          ? (item as Record<string, unknown>).uri
          : undefined;
      if (typeof uri === "string" && !uri.startsWith("data:"))
        throw new Error("GLB must be self-contained; external URI rejected.");
    }
  }
}

function validAssetDescriptor(
  descriptor: IfcRenderAssetDescriptor,
  label: string,
) {
  if (
    !descriptor ||
    typeof descriptor.signedUrl !== "string" ||
    descriptor.signedUrl.length === 0 ||
    !SHA256.test(descriptor.sha256) ||
    !Number.isSafeInteger(descriptor.byteSize) ||
    descriptor.byteSize <= 0
  )
    throw new Error(`IFC ${label} descriptor is invalid.`);
}

async function sha256(bytes: Uint8Array) {
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function fetchVerifiedBytes(
  descriptor: IfcRenderAssetDescriptor,
  label: string,
  fetcher: typeof fetch,
  maxBytes: number,
  oversize: "error" | "skip",
  signal?: AbortSignal,
): Promise<Uint8Array | null> {
  validAssetDescriptor(descriptor, label);
  const response = await fetcher(descriptor.signedUrl, { signal });
  if (!response.ok) throw new Error(`IFC ${label} could not be fetched.`);
  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    (!/^\d+$/.test(declaredLength) ||
      !Number.isSafeInteger(Number(declaredLength)) ||
      Number(declaredLength) !== descriptor.byteSize)
  ) {
    await response.body?.cancel();
    throw new Error(`IFC ${label} byte size does not match its descriptor.`);
  }
  if (descriptor.byteSize > maxBytes) {
    await response.body?.cancel();
    if (oversize === "skip") return null;
    throw new Error(`IFC ${label} exceeds the browser byte limit.`);
  }
  if (!response.body) throw new Error(`IFC ${label} response body is missing.`);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > descriptor.byteSize) {
      await reader.cancel();
      throw new Error(`IFC ${label} byte size does not match its descriptor.`);
    }
    if (length > maxBytes) {
      await reader.cancel();
      if (oversize === "skip") return null;
      throw new Error(`IFC ${label} exceeds the browser byte limit.`);
    }
    chunks.push(value);
  }
  if (length !== descriptor.byteSize)
    throw new Error(`IFC ${label} byte size does not match its descriptor.`);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if ((await sha256(bytes)) !== descriptor.sha256)
    throw new Error(`IFC ${label} SHA-256 does not match its descriptor.`);
  return bytes;
}

export async function loadVerifiedIfcRenderBundle(
  descriptor: IfcRenderBundleDescriptor,
  options: {
    fetcher?: typeof fetch;
    maxGeometryBytes?: number;
    signal?: AbortSignal;
  } = {},
): Promise<VerifiedIfcRenderBundle> {
  if (
    !UUID.test(descriptor.source.fileId) ||
    !SHA256.test(descriptor.source.sha256) ||
    descriptor.derivative.status !== "ready" ||
    !Number.isSafeInteger(descriptor.derivative.version) ||
    descriptor.derivative.version <= 0 ||
    descriptor.derivative.sourceSha256 !== descriptor.source.sha256
  )
    throw new Error("IFC source identity is invalid.");
  const manifestAsset = {
    signedUrl: descriptor.derivative.manifestSignedUrl,
    sha256: descriptor.derivative.manifestSha256,
    byteSize: descriptor.derivative.manifestByteSize,
  };
  const geometryAsset = {
    signedUrl: descriptor.derivative.geometrySignedUrl,
    sha256: descriptor.derivative.geometrySha256,
    byteSize: descriptor.derivative.geometryByteSize,
  };
  validAssetDescriptor(manifestAsset, "manifest");
  validAssetDescriptor(geometryAsset, "geometry GLB");
  if (manifestAsset.byteSize > MAX_MANIFEST_BYTES)
    throw new Error("IFC manifest exceeds the browser byte limit.");
  const fetcher = options.fetcher ?? fetch;
  const manifestBytes = await fetchVerifiedBytes(
    manifestAsset,
    "manifest",
    fetcher,
    MAX_MANIFEST_BYTES,
    "error",
    options.signal,
  );
  if (!manifestBytes) throw new Error("IFC manifest could not be read.");
  let manifestInput: unknown;
  try {
    manifestInput = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error("IFC render manifest is invalid: JSON");
  }
  const manifest = deepFreeze(
    validateIfcRenderManifest(manifestInput, {
      source: descriptor.source,
      geometrySha256: descriptor.derivative.geometrySha256,
    }),
  );

  const maxGeometryBytes = options.maxGeometryBytes ?? MAX_BROWSER_GLB_BYTES;
  if (geometryAsset.byteSize > maxGeometryBytes)
    return { manifest, geometryBytes: null, skipped: true };
  const geometryBytes = await fetchVerifiedBytes(
    geometryAsset,
    "geometry GLB",
    fetcher,
    maxGeometryBytes,
    "skip",
    options.signal,
  );
  if (!geometryBytes) return { manifest, geometryBytes: null, skipped: true };
  assertSelfContainedGlb(geometryBytes);
  return { manifest, geometryBytes, skipped: false };
}

export async function instantiateVerifiedIfcRenderModel(
  bundle: VerifiedIfcRenderBundle,
): Promise<OwnedIfcRenderModel> {
  if (bundle.skipped || !bundle.geometryBytes)
    throw new Error("IFC GLB rendering was skipped.");
  if ((await sha256(bundle.geometryBytes)) !== bundle.manifest.geometry.sha256)
    throw new Error("IFC geometry GLB SHA-256 changed after verification.");
  assertSelfContainedGlb(bundle.geometryBytes);
  const { GLTFLoader } = await import(
    "three/examples/jsm/loaders/GLTFLoader.js"
  );
  const bytes = bundle.geometryBytes;
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, "", resolve, reject);
  });
  for (const [object, associationValue] of gltf.parser.associations ?? []) {
    const association = associationValue as { primitives?: unknown };
    if (
      object instanceof THREE.Mesh &&
      Number.isSafeInteger(association.primitives)
    )
      object.userData.ifcPrimitiveIndex = association.primitives;
  }
  try {
    return createOwnedIfcRenderModel(gltf.scene, bundle.manifest);
  } catch (error) {
    disposeIfcRenderRoot(gltf.scene);
    throw error;
  }
}
