import * as THREE from "three";

export type IfcRenderProperty = { key: string; value: string };

export type IfcRenderElement = {
  expressId: number;
  globalId: string | null;
  typeName: string;
  name: string;
  properties: IfcRenderProperty[];
  nodeRefs: string[];
};

export type IfcRenderManifest = {
  schemaVersion: 1;
  sourceIfcSha256: string;
  glbSha256: string;
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

export type IfcRenderBundleDescriptor = {
  sourceIfcSha256: string;
  manifest: IfcRenderAssetDescriptor & { schemaVersion: 1 };
  glb: IfcRenderAssetDescriptor;
};

export type VerifiedIfcRenderBundle = {
  manifest: IfcRenderManifest;
  glbBytes: Uint8Array | null;
  skipped: boolean;
};

const SHA256 = /^[0-9a-f]{64}$/;
const IFC_GLOBAL_ID = /^[0-9A-Za-z_$]{22}$/;
const MAX_ELEMENTS = 500_000;
const MAX_PROPERTIES_PER_ELEMENT = 500;
const MAX_NODE_REFS_PER_ELEMENT = 10_000;
export const MAX_BROWSER_GLB_BYTES = 75 * 1024 * 1024;

function manifestError(message: string): never {
  throw new Error(`IFC render manifest is invalid: ${message}`);
}

function strictString(
  value: unknown,
  label: string,
  { allowEmpty = false, max = 2_048 } = {},
) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.length > max
  )
    manifestError(label);
  return value;
}

export function validateIfcRenderManifest(
  input: unknown,
  expected: { sourceIfcSha256: string; glbSha256: string },
): IfcRenderManifest {
  if (!input || typeof input !== "object" || Array.isArray(input))
    manifestError("root");
  const record = input as Record<string, unknown>;
  if (record.schemaVersion !== 1) manifestError("schemaVersion");
  if (
    !SHA256.test(expected.sourceIfcSha256) ||
    !SHA256.test(expected.glbSha256) ||
    record.sourceIfcSha256 !== expected.sourceIfcSha256 ||
    record.glbSha256 !== expected.glbSha256
  )
    manifestError("hash chain");
  if (!Array.isArray(record.elements) || record.elements.length > MAX_ELEMENTS)
    manifestError("elements");

  const expressIds = new Set<number>();
  const globalIds = new Set<string>();
  const nodeRefs = new Set<string>();
  const elements = record.elements.map((value, index): IfcRenderElement => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      manifestError(`elements[${index}]`);
    const element = value as Record<string, unknown>;
    if (
      !Number.isSafeInteger(element.expressId) ||
      (element.expressId as number) <= 0 ||
      expressIds.has(element.expressId as number)
    )
      manifestError(`elements[${index}].expressId`);
    expressIds.add(element.expressId as number);

    const globalId = element.globalId;
    if (
      globalId !== null &&
      (typeof globalId !== "string" ||
        !IFC_GLOBAL_ID.test(globalId) ||
        globalIds.has(globalId))
    )
      manifestError(`elements[${index}].globalId`);
    if (typeof globalId === "string") globalIds.add(globalId);

    if (
      !Array.isArray(element.properties) ||
      element.properties.length > MAX_PROPERTIES_PER_ELEMENT
    )
      manifestError(`elements[${index}].properties`);
    const properties = element.properties.map((property, propertyIndex) => {
      if (!property || typeof property !== "object" || Array.isArray(property))
        manifestError(`elements[${index}].properties[${propertyIndex}]`);
      const item = property as Record<string, unknown>;
      return {
        key: strictString(
          item.key,
          `elements[${index}].properties[${propertyIndex}].key`,
          { max: 512 },
        ),
        value: strictString(
          item.value,
          `elements[${index}].properties[${propertyIndex}].value`,
          { allowEmpty: true, max: 16_384 },
        ),
      };
    });

    if (
      !Array.isArray(element.nodeRefs) ||
      element.nodeRefs.length === 0 ||
      element.nodeRefs.length > MAX_NODE_REFS_PER_ELEMENT
    )
      manifestError(`elements[${index}].nodeRefs`);
    const ownedNodeRefs = element.nodeRefs.map((nodeRef, nodeIndex) => {
      const parsed = strictString(
        nodeRef,
        `elements[${index}].nodeRefs[${nodeIndex}]`,
        { max: 512 },
      );
      if (nodeRefs.has(parsed))
        manifestError(`duplicate node ref ${parsed}`);
      nodeRefs.add(parsed);
      return parsed;
    });

    return {
      expressId: element.expressId as number,
      globalId: globalId as string | null,
      typeName: strictString(
        element.typeName,
        `elements[${index}].typeName`,
        { max: 256 },
      ),
      name: strictString(element.name, `elements[${index}].name`, {
        max: 2_048,
      }),
      properties,
      nodeRefs: ownedNodeRefs,
    };
  });

  return {
    schemaVersion: 1,
    sourceIfcSha256: expected.sourceIfcSha256,
    glbSha256: expected.glbSha256,
    elements,
  };
}

export function mapIfcRenderScene(
  root: THREE.Object3D,
  manifest: IfcRenderManifest,
) {
  const expected = new Map<string, number>();
  for (const element of manifest.elements)
    for (const nodeRef of element.nodeRefs)
      expected.set(nodeRef, element.expressId);

  const seen = new Set<string>();
  const elementMeshes = new Map<number, THREE.Mesh[]>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const nodeRef = object.userData.ifcNodeRef;
    const expressId = object.userData.ifcExpressId;
    if (typeof nodeRef !== "string" || !expected.has(nodeRef))
      throw new Error("IFC GLB node ref is missing or unknown.");
    if (seen.has(nodeRef))
      throw new Error(`IFC GLB node ref is duplicated: ${nodeRef}`);
    const expectedExpressId = expected.get(nodeRef)!;
    if (expressId !== expectedExpressId)
      throw new Error(`IFC GLB expressId does not match node ref ${nodeRef}.`);
    seen.add(nodeRef);
    object.userData.expressId = expectedExpressId;
    const siblings = elementMeshes.get(expectedExpressId);
    if (siblings) siblings.push(object);
    else elementMeshes.set(expectedExpressId, [object]);
  });

  if (seen.size !== expected.size) {
    const missing = [...expected.keys()].find((nodeRef) => !seen.has(nodeRef));
    throw new Error(`IFC GLB node ref is missing: ${missing ?? "unknown"}`);
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

function disposeIfcRenderRoot(root: THREE.Object3D) {
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
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.removeFromParent();
}

export function createOwnedIfcRenderModel(
  root: THREE.Object3D,
  manifest: IfcRenderManifest,
): OwnedIfcRenderModel {
  const { elementMeshes } = mapIfcRenderScene(root, manifest);
  let disposed = false;
  return {
    root,
    elementMeshes,
    renderedElementCount: elementMeshes.size,
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeIfcRenderRoot(root);
      elementMeshes.clear();
    },
  };
}

export function assertSelfContainedGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 20) throw new Error("GLB is not self-contained: header");
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
    descriptor.byteSize < 0
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
) {
  validAssetDescriptor(descriptor, label);
  const response = await fetcher(descriptor.signedUrl);
  if (!response.ok) throw new Error(`IFC ${label} could not be fetched.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== descriptor.byteSize)
    throw new Error(`IFC ${label} byte size does not match its descriptor.`);
  if ((await sha256(bytes)) !== descriptor.sha256)
    throw new Error(`IFC ${label} SHA-256 does not match its descriptor.`);
  return bytes;
}

export async function loadVerifiedIfcRenderBundle(
  descriptor: IfcRenderBundleDescriptor,
  options: {
    fetcher?: typeof fetch;
    maxGlbBytes?: number;
  } = {},
): Promise<VerifiedIfcRenderBundle> {
  if (!SHA256.test(descriptor.sourceIfcSha256))
    throw new Error("IFC source SHA-256 is invalid.");
  if (descriptor.manifest.schemaVersion !== 1)
    throw new Error("IFC manifest descriptor schema is invalid.");
  validAssetDescriptor(descriptor.manifest, "manifest");
  validAssetDescriptor(descriptor.glb, "GLB");
  const fetcher = options.fetcher ?? fetch;
  const manifestBytes = await fetchVerifiedBytes(
    descriptor.manifest,
    "manifest",
    fetcher,
  );
  let manifestInput: unknown;
  try {
    manifestInput = JSON.parse(new TextDecoder().decode(manifestBytes));
  } catch {
    throw new Error("IFC render manifest is invalid: JSON");
  }
  const manifest = validateIfcRenderManifest(manifestInput, {
    sourceIfcSha256: descriptor.sourceIfcSha256,
    glbSha256: descriptor.glb.sha256,
  });

  if (
    descriptor.glb.byteSize >
    (options.maxGlbBytes ?? MAX_BROWSER_GLB_BYTES)
  )
    return { manifest, glbBytes: null, skipped: true };

  const glbBytes = await fetchVerifiedBytes(descriptor.glb, "GLB", fetcher);
  assertSelfContainedGlb(glbBytes);
  return { manifest, glbBytes, skipped: false };
}

export async function instantiateVerifiedIfcRenderModel(
  bundle: VerifiedIfcRenderBundle,
): Promise<OwnedIfcRenderModel> {
  if (bundle.skipped || !bundle.glbBytes)
    throw new Error("IFC GLB rendering was skipped.");
  assertSelfContainedGlb(bundle.glbBytes);
  const { GLTFLoader } = await import(
    "three/examples/jsm/loaders/GLTFLoader.js"
  );
  const bytes = bundle.glbBytes;
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    new GLTFLoader().parse(arrayBuffer, "", resolve, reject);
  });
  try {
    return createOwnedIfcRenderModel(gltf.scene, bundle.manifest);
  } catch (error) {
    disposeIfcRenderRoot(gltf.scene);
    throw error;
  }
}
