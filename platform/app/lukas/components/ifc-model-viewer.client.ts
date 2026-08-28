import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import type { FlatMesh, IfcAPI, PlacedGeometry } from "web-ifc";

import {
  canonicalIfcCameraState,
  type IfcCameraState,
} from "~/lukas/lib/ifc-anchor";
import {
  createVisibilityRenderGate,
  markDrawingFirstUsable,
} from "~/lukas/lib/drawing-runtime";

export type IfcModelViewerStatus = {
  phase: "loading" | "ready" | "error" | "disposed";
  message: string;
  loaded: number;
  total: number;
  progress: number;
};

export type IfcModelViewerDisposeEvidence = {
  phase: "disposed";
  contextLossRequested: true;
  viewerInstance: string | undefined;
};

export type CreateIfcModelViewerOptions = {
  container: HTMLElement;
  api: IfcAPI;
  modelId: number;
  firstPaintLifecycleKey: string;
  onSelect?: (expressId: number) => void;
  onStatus?: (message: string, status: IfcModelViewerStatus) => void;
  onContextLost?: () => void;
  onDispose?: (evidence: IfcModelViewerDisposeEvidence) => void;
};

export type IfcModelViewer = {
  fitModel(): void;
  focusElement(expressId: number): void;
  selectElement(expressId: number | null): void;
  getViewState(): IfcCameraState;
  restoreViewState(state: IfcCameraState): void;
  setRemoteElements(expressIds: readonly number[]): void;
  setFirstPaintLifecycleKey(lifecycleKey: string): void;
  setVisible(visible: boolean): void;
  dispose(): void;
  readonly renderedElementCount: number;
};

type RenderedIfcMesh = THREE.Mesh<THREE.BufferGeometry, THREE.Material>;

const HIGHLIGHT_COLOR = 0x6d5dfc;
const REMOTE_HIGHLIGHT_COLOR = 0x22d3ee;
let viewerInstanceSequence = 0;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function materialKey(color: PlacedGeometry["color"]) {
  return [color.x, color.y, color.z, color.w]
    .map((value) => value.toFixed(4))
    .join(":");
}

function createGeometry(api: IfcAPI, modelId: number, geometryId: number) {
  const ifcGeometry = api.GetGeometry(modelId, geometryId);
  try {
    const rawVertices = new Float32Array(
      api.GetVertexArray(
        ifcGeometry.GetVertexData(),
        ifcGeometry.GetVertexDataSize(),
      ),
    );
    const rawIndices = new Uint32Array(
      api.GetIndexArray(
        ifcGeometry.GetIndexData(),
        ifcGeometry.GetIndexDataSize(),
      ),
    );
    const vertexCount = Math.floor(rawVertices.length / 6);
    const positions = new Float32Array(vertexCount * 3);
    const normals = new Float32Array(vertexCount * 3);

    for (let source = 0, target = 0; source < vertexCount * 6; source += 6) {
      positions[target] = rawVertices[source];
      normals[target++] = rawVertices[source + 3];
      positions[target] = rawVertices[source + 1];
      normals[target++] = rawVertices[source + 4];
      positions[target] = rawVertices[source + 2];
      normals[target++] = rawVertices[source + 5];
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    geometry.setIndex(new THREE.BufferAttribute(rawIndices, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    return geometry;
  } finally {
    ifcGeometry.delete();
  }
}

function boundsForObjects(objects: THREE.Object3D[]) {
  const bounds = new THREE.Box3();
  for (const object of objects) bounds.expandByObject(object, true);
  return bounds;
}

export function createIfcInitialFitOnce(fit: () => void) {
  let armed = false;
  let fitted = false;
  return {
    arm() {
      if (!fitted) armed = true;
    },
    attempt({
      ready,
      visible,
      width,
      height,
    }: {
      ready: boolean;
      visible: boolean;
      width: number;
      height: number;
    }) {
      if (!armed || fitted || !ready || !visible || width <= 0 || height <= 0)
        return false;
      fitted = true;
      fit();
      return true;
    },
    cancel() {
      fitted = true;
    },
  };
}

export function createIfcModelViewer({
  container,
  api,
  modelId,
  firstPaintLifecycleKey,
  onSelect,
  onStatus,
  onContextLost,
  onDispose,
}: CreateIfcModelViewerOptions): IfcModelViewer {
  let disposed = false;
  let visible = true;
  let selectedExpressId: number | null = null;
  let remoteExpressIds = new Set<number>();
  let pointerDown: { x: number; y: number } | null = null;
  let modelReady = false;
  let initialFitFrame: number | null = null;

  const scene = new THREE.Scene();
  const modelRoot = new THREE.Group();
  modelRoot.name = `IFC model ${modelId}`;
  scene.add(modelRoot);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 10_000);
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.setAttribute("aria-label", "IFC 3D 모델");
  renderer.domElement.dataset.ifcViewerInstance = String(
    ++viewerInstanceSequence,
  );
  renderer.domElement.style.display = "block";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.width = "100%";
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;
  controls.zoomToCursor = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.25));
  const mainLight = new THREE.DirectionalLight(0xffffff, 2.5);
  mainLight.position.set(3, -4, 8);
  scene.add(mainLight);
  const fillLight = new THREE.DirectionalLight(0xb9d5ff, 1.25);
  fillLight.position.set(-5, 2, 3);
  scene.add(fillLight);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const elementMeshes = new Map<number, RenderedIfcMesh[]>();
  const geometryCache = new Map<number, THREE.BufferGeometry>();
  const materialCache = new Map<string, THREE.MeshStandardMaterial>();
  let activeFirstPaintLifecycleKey = firstPaintLifecycleKey;
  let firstUsableFrameMarked = false;
  const highlightMaterial = new THREE.MeshStandardMaterial({
    color: HIGHLIGHT_COLOR,
    emissive: HIGHLIGHT_COLOR,
    emissiveIntensity: 0.18,
    metalness: 0,
    opacity: 0.92,
    roughness: 0.72,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });
  const remoteHighlightMaterial = new THREE.MeshStandardMaterial({
    color: REMOTE_HIGHLIGHT_COLOR,
    emissive: REMOTE_HIGHLIGHT_COLOR,
    emissiveIntensity: 0.12,
    metalness: 0,
    opacity: 0.82,
    roughness: 0.72,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  function report(status: IfcModelViewerStatus) {
    if (!disposed) onStatus?.(status.message, status);
  }

  const renderGate = createVisibilityRenderGate({
    isHidden: () => !visible || document.visibilityState === "hidden",
    render: () => {
      if (!disposed) {
        renderer.render(scene, camera);
        if (!firstUsableFrameMarked && elementMeshes.size > 0) {
          firstUsableFrameMarked = true;
          markDrawingFirstUsable(
            "ifc",
            performance,
            activeFirstPaintLifecycleKey,
          );
        }
      }
    },
  });
  const render = () => renderGate.request();
  const handleVisibilityChange = () => renderGate.visibilityChanged();
  document.addEventListener("visibilitychange", handleVisibilityChange);

  function resize() {
    if (disposed) return;
    const width = container.clientWidth;
    const height = container.clientHeight;
    const renderWidth = Math.max(1, width);
    const renderHeight = Math.max(1, height);
    camera.aspect = renderWidth / renderHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(renderWidth, renderHeight, false);
    if (!fitInitialModel.attempt({ ready: modelReady, visible, width, height }))
      render();
  }

  function frameObjects(objects: THREE.Object3D[], padding = 1.35) {
    if (disposed || objects.length === 0) return;
    const bounds = boundsForObjects(objects);
    if (bounds.isEmpty()) return;

    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const diagonal = Math.max(size.length(), 0.01);
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov =
      2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const distance =
      (Math.max(
        size.z / (2 * Math.tan(verticalFov / 2)),
        Math.max(size.x, size.y) / (2 * Math.tan(horizontalFov / 2)),
        diagonal * 0.55,
      ) || 1) * padding;
    const currentDirection = camera.position.clone().sub(controls.target);
    const direction =
      currentDirection.lengthSq() > Number.EPSILON
        ? currentDirection.normalize()
        : new THREE.Vector3(1, -1, 0.8).normalize();

    controls.target.copy(center);
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(diagonal / 10_000, 0.001);
    camera.far = Math.max(distance + diagonal * 20, 1_000);
    camera.updateProjectionMatrix();
    controls.maxDistance = Math.max(diagonal * 100, distance * 4);
    controls.update();
    render();
  }

  function fitModel() {
    fitInitialModel.cancel();
    frameObjects([modelRoot]);
  }

  const fitInitialModel = createIfcInitialFitOnce(() =>
    frameObjects([modelRoot]),
  );

  function selectElement(expressId: number | null) {
    if (disposed || selectedExpressId === expressId) return;
    const previous = selectedExpressId;
    selectedExpressId = elementMeshes.has(expressId ?? -1) ? expressId : null;
    for (const id of [previous, selectedExpressId]) {
      if (id === null) continue;
      for (const mesh of elementMeshes.get(id) ?? [])
        mesh.material =
          id === selectedExpressId
            ? highlightMaterial
            : remoteExpressIds.has(id)
              ? remoteHighlightMaterial
              : mesh.userData.originalMaterial;
    }
    render();
  }

  function setRemoteElements(expressIds: readonly number[]) {
    if (disposed) return;
    const previous = remoteExpressIds;
    remoteExpressIds = new Set(
      expressIds.filter((expressId) => elementMeshes.has(expressId)),
    );
    renderer.domElement.dataset.remoteIfcElementIds = [...remoteExpressIds]
      .sort((left, right) => left - right)
      .join(" ");
    for (const id of new Set([...previous, ...remoteExpressIds])) {
      if (id === selectedExpressId) continue;
      for (const mesh of elementMeshes.get(id) ?? [])
        mesh.material = remoteExpressIds.has(id)
          ? remoteHighlightMaterial
          : mesh.userData.originalMaterial;
    }
    render();
  }

  function setVisible(nextVisible: boolean) {
    if (disposed || visible === nextVisible) return;
    visible = nextVisible;
    if (visible) resize();
    renderGate.visibilityChanged();
  }

  function setFirstPaintLifecycleKey(lifecycleKey: string) {
    if (disposed || lifecycleKey === activeFirstPaintLifecycleKey) return;
    activeFirstPaintLifecycleKey = lifecycleKey;
    firstUsableFrameMarked = false;
    render();
  }

  function focusElement(expressId: number) {
    if (disposed) return;
    const meshes = elementMeshes.get(expressId);
    if (!meshes?.length) return;
    fitInitialModel.cancel();
    selectElement(expressId);
    frameObjects(meshes, 1.8);
  }

  function getViewState(): IfcCameraState {
    return canonicalIfcCameraState({
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
    });
  }

  function restoreViewState(state: IfcCameraState) {
    if (disposed) return;
    fitInitialModel.cancel();
    const canonical = canonicalIfcCameraState(state);
    camera.position.fromArray(canonical.position);
    controls.target.fromArray(canonical.target);
    camera.updateProjectionMatrix();
    controls.update();
    render();
  }

  function materialFor(placed: PlacedGeometry) {
    const key = materialKey(placed.color);
    let material = materialCache.get(key);
    if (!material) {
      const opacity = clamp01(placed.color.w);
      material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(
          clamp01(placed.color.x),
          clamp01(placed.color.y),
          clamp01(placed.color.z),
        ),
        metalness: 0,
        opacity,
        roughness: 0.82,
        side: THREE.DoubleSide,
        transparent: opacity < 0.999,
        depthWrite: opacity >= 0.999,
      });
      materialCache.set(key, material);
    }
    return material;
  }

  function addPlacedGeometry(flatMesh: FlatMesh, placed: PlacedGeometry) {
    let geometry = geometryCache.get(placed.geometryExpressID);
    if (!geometry) {
      geometry = createGeometry(api, modelId, placed.geometryExpressID);
      geometryCache.set(placed.geometryExpressID, geometry);
    }
    const originalMaterial = materialFor(placed);
    const mesh: RenderedIfcMesh = new THREE.Mesh(geometry, originalMaterial);
    mesh.matrix.fromArray(placed.flatTransformation);
    mesh.matrixAutoUpdate = false;
    mesh.userData = { expressId: flatMesh.expressID, originalMaterial };
    modelRoot.add(mesh);

    const siblings = elementMeshes.get(flatMesh.expressID);
    if (siblings) siblings.push(mesh);
    else elementMeshes.set(flatMesh.expressID, [mesh]);
  }

  function handlePointerDown(event: PointerEvent) {
    if (event.button === 0)
      pointerDown = { x: event.clientX, y: event.clientY };
  }

  function clearPointerDown() {
    pointerDown = null;
  }

  function handlePointerUp(event: PointerEvent) {
    if (disposed || event.button !== 0 || !pointerDown) return;
    const movement = Math.hypot(
      event.clientX - pointerDown.x,
      event.clientY - pointerDown.y,
    );
    pointerDown = null;
    if (movement > 5) return;

    const bounds = renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersection = raycaster.intersectObject(modelRoot, true)[0];
    const expressId = intersection?.object.userData.expressId;
    if (typeof expressId !== "number") return;
    selectElement(expressId);
    onSelect?.(expressId);
  }

  renderer.domElement.addEventListener("pointerdown", handlePointerDown);
  renderer.domElement.addEventListener("pointerup", handlePointerUp);
  renderer.domElement.addEventListener("pointercancel", clearPointerDown);
  const handleContextLost = (event: Event) => {
    event.preventDefault();
    if (disposed) return;
    report({
      phase: "error",
      message: "WebGL 연결이 끊어졌습니다. 3D 화면을 다시 시도해 주세요.",
      loaded: elementMeshes.size,
      total: elementMeshes.size,
      progress: 0,
    });
    onContextLost?.();
  };
  renderer.domElement.addEventListener("webglcontextlost", handleContextLost);
  controls.addEventListener("change", render);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);
  resize();

  try {
    report({
      phase: "loading",
      message: "IFC 3D 형상을 불러오는 중입니다.",
      loaded: 0,
      total: 0,
      progress: 0,
    });
    api.StreamAllMeshes(modelId, (flatMesh, index, total) => {
      for (
        let geometryIndex = 0;
        geometryIndex < flatMesh.geometries.size();
        geometryIndex += 1
      ) {
        addPlacedGeometry(flatMesh, flatMesh.geometries.get(geometryIndex));
      }

      const loaded = Math.min(index + 1, total);
      const reportStep = Math.max(1, Math.floor(total / 100));
      if (loaded === 1 || loaded === total || loaded % reportStep === 0) {
        report({
          phase: "loading",
          message: `IFC 3D 형상을 불러오는 중입니다. ${loaded.toLocaleString("ko-KR")}/${total.toLocaleString("ko-KR")}`,
          loaded,
          total,
          progress: total > 0 ? clamp01(loaded / total) : 0,
        });
      }
    });

    modelReady = true;
    resize();
    initialFitFrame = requestAnimationFrame(() => {
      initialFitFrame = null;
      if (disposed) return;
      fitInitialModel.arm();
      resize();
    });
    report({
      phase: "ready",
      message: `3D 요소 ${elementMeshes.size.toLocaleString("ko-KR")}개를 표시했습니다.`,
      loaded: elementMeshes.size,
      total: elementMeshes.size,
      progress: 1,
    });
  } catch (error) {
    report({
      phase: "error",
      message:
        error instanceof Error
          ? error.message
          : "IFC 3D 형상을 표시하지 못했습니다.",
      loaded: elementMeshes.size,
      total: elementMeshes.size,
      progress: 0,
    });
    dispose(false);
    throw error;
  }

  function dispose(notify = true) {
    if (disposed) return;
    disposed = true;
    if (initialFitFrame !== null) cancelAnimationFrame(initialFitFrame);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    resizeObserver.disconnect();
    renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
    renderer.domElement.removeEventListener("pointerup", handlePointerUp);
    renderer.domElement.removeEventListener("pointercancel", clearPointerDown);
    renderer.domElement.removeEventListener(
      "webglcontextlost",
      handleContextLost,
    );
    controls.removeEventListener("change", render);
    controls.dispose();
    for (const geometry of geometryCache.values()) geometry.dispose();
    for (const material of materialCache.values()) material.dispose();
    highlightMaterial.dispose();
    remoteHighlightMaterial.dispose();
    renderer.renderLists.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
    elementMeshes.clear();
    geometryCache.clear();
    materialCache.clear();
    onDispose?.({
      phase: "disposed",
      contextLossRequested: true,
      viewerInstance: renderer.domElement.dataset.ifcViewerInstance,
    });
    if (notify)
      onStatus?.("IFC 3D 화면을 닫았습니다.", {
        phase: "disposed",
        message: "IFC 3D 화면을 닫았습니다.",
        loaded: 0,
        total: 0,
        progress: 0,
      });
  }

  return {
    fitModel,
    focusElement,
    getViewState,
    restoreViewState,
    selectElement,
    setFirstPaintLifecycleKey,
    setRemoteElements,
    setVisible,
    dispose,
    get renderedElementCount() {
      return elementMeshes.size;
    },
  };
}
