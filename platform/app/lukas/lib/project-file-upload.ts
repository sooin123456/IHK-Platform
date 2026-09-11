import {
  contentTypeMatchesProjectKind,
  fileMatchesProjectKind,
  parseDrawingWorkspaceUploadReturnTarget,
  projectFileKindMismatchMessage,
  projectFileKinds,
  type ProjectFileKind,
} from "~/lukas/lib/drawing-entry";
import {
  isProjectStorageObjectPath,
  projectSourceUploadDirectory,
  storageObjectPath,
} from "~/lukas/lib/storage-object-key";
import * as tus from "tus-js-client";

export const maxProjectUploadBytes = 200 * 1024 * 1024;

export function projectUploadContentType(
  kind: ProjectFileKind,
  browserContentType: string,
): string {
  return kind === "dwg"
    ? "application/octet-stream"
    : browserContentType || "application/octet-stream";
}

type StorageUploadResult = {
  error: { message: string } | null;
  storagePath?: string;
};

export type ProjectFileUploadMetadata = {
  byteSize: number;
  contentType: string;
  kind: ProjectFileKind;
  originalFilename: string;
  storagePath: string;
};

export type PendingProjectUpload = ProjectFileUploadMetadata & {
  actorId: string;
  ownerId: string;
  projectId: string;
  returnTo: string | null;
  revision: number;
  uploadId: string;
  uploadComplete: boolean;
  verificationId: string | null;
  version: 1;
};

export class ProjectUploadFinalizationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProjectUploadFinalizationError";
  }
}

type ProjectUploadStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;
type ProjectUploadLockManager = {
  request<T>(name: string, callback: () => T | Promise<T>): Promise<T>;
};
type PendingProjectUploadTransition = "advance" | "replace-verification";

const pendingProjectUploadPrefix = "1hk:pending-project-upload:v1";
const pendingProjectUploadLockPrefix = "1hk:pending-project-upload-lock:v1";
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const inProcessLockTails = new Map<string, Promise<void>>();

function browserStorage(): ProjectUploadStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const inProcessLockManager: ProjectUploadLockManager = {
  request<T>(name: string, callback: () => T | Promise<T>) {
    const previous = inProcessLockTails.get(name) ?? Promise.resolve();
    const result = previous.then(callback);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    inProcessLockTails.set(name, tail);
    return result.finally(() => {
      if (inProcessLockTails.get(name) === tail)
        inProcessLockTails.delete(name);
    });
  },
};

function browserLockManager(): ProjectUploadLockManager | null {
  if (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    navigator.locks
  ) {
    return {
      request: async (name, callback) =>
        await navigator.locks.request(name, () => callback()),
    };
  }
  // Server/test callers share one event loop, so a keyed promise queue is safe.
  // A real browser without Web Locks must fail closed instead of racing tabs.
  return typeof window === "undefined" ? inProcessLockManager : null;
}

function pendingProjectUploadLockKey(actorId: string, projectId: string) {
  return `${pendingProjectUploadLockPrefix}:${actorId}:${projectId}`;
}

export function pendingProjectUploadStorageKey(
  actorId: string,
  projectId: string,
) {
  return `${pendingProjectUploadPrefix}:${actorId}:${projectId}`;
}

export function projectUploadFinalizationPath(projectId: string) {
  return `/projects/${projectId}/files/finalize-upload`;
}

function validPendingProjectUpload(
  value: unknown,
  actorId: string,
  ownerId: string,
  projectId: string,
): value is PendingProjectUpload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pending = value as Record<string, unknown>;
  if (
    pending.version !== 1 ||
    pending.actorId !== actorId ||
    pending.ownerId !== ownerId ||
    pending.projectId !== projectId ||
    !Number.isSafeInteger(pending.revision) ||
    (pending.revision as number) < 0 ||
    typeof pending.uploadId !== "string" ||
    !uuidPattern.test(pending.uploadId) ||
    typeof pending.uploadComplete !== "boolean" ||
    typeof pending.kind !== "string" ||
    !projectFileKinds.includes(pending.kind as ProjectFileKind) ||
    !Number.isSafeInteger(pending.byteSize) ||
    (pending.byteSize as number) <= 0 ||
    (pending.byteSize as number) > maxProjectUploadBytes ||
    typeof pending.contentType !== "string" ||
    pending.contentType.length > 255 ||
    (pending.kind === "dwg" &&
      pending.contentType !== "application/octet-stream") ||
    typeof pending.originalFilename !== "string" ||
    pending.originalFilename !== pending.originalFilename.trim() ||
    !fileMatchesProjectKind(
      pending.kind as ProjectFileKind,
      pending.originalFilename,
    ) ||
    typeof pending.storagePath !== "string" ||
    !isProjectStorageObjectPath({
      directory: projectSourceUploadDirectory,
      originalFilename: pending.originalFilename,
      ownerId,
      projectId,
      storagePath: pending.storagePath,
    }) ||
    (pending.verificationId !== null &&
      (typeof pending.verificationId !== "string" ||
        !uuidPattern.test(pending.verificationId))) ||
    (pending.returnTo !== null && typeof pending.returnTo !== "string")
  )
    return false;
  if (pending.returnTo !== null) {
    if (pending.kind !== "pdf" && pending.kind !== "dxf") return false;
    try {
      if (!parseDrawingWorkspaceUploadReturnTarget(projectId, pending.returnTo))
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

export async function savePendingProjectUpload(
  pending: PendingProjectUpload,
  storage: ProjectUploadStorage | null = browserStorage(),
  lockManager: ProjectUploadLockManager | null = browserLockManager(),
  transition: PendingProjectUploadTransition = "advance",
) {
  if (
    !storage ||
    !lockManager ||
    !validPendingProjectUpload(
      pending,
      pending.actorId,
      pending.ownerId,
      pending.projectId,
    )
  )
    return null;
  try {
    return await lockManager.request(
      pendingProjectUploadLockKey(pending.actorId, pending.projectId),
      () => {
        const current = loadPendingProjectUpload(
          pending.actorId,
          pending.ownerId,
          pending.projectId,
          storage,
        );
        if (
          (current &&
            (current.uploadId !== pending.uploadId ||
              current.revision !== pending.revision ||
              current.revision === Number.MAX_SAFE_INTEGER ||
              (current.uploadComplete && !pending.uploadComplete) ||
              (current.verificationId !== null &&
                pending.verificationId !== current.verificationId &&
                transition !== "replace-verification"))) ||
          (!current && pending.revision !== 0) ||
          (transition === "replace-verification" &&
            (!current?.verificationId || !pending.verificationId))
        )
          return null;
        const saved = {
          ...pending,
          revision: pending.revision + 1,
        } satisfies PendingProjectUpload;
        const result = storage.setItem(
          pendingProjectUploadStorageKey(pending.actorId, pending.projectId),
          JSON.stringify(saved),
        );
        if ((result as unknown) === false) return null;
        return saved;
      },
    );
  } catch {
    return null;
  }
}

export async function clearPendingProjectUpload(
  actorId: string,
  projectId: string,
  uploadId: string,
  revision: number,
  storage: ProjectUploadStorage | null = browserStorage(),
  lockManager: ProjectUploadLockManager | null = browserLockManager(),
) {
  if (!storage || !lockManager) return false;
  const key = pendingProjectUploadStorageKey(actorId, projectId);
  try {
    return await lockManager.request(
      pendingProjectUploadLockKey(actorId, projectId),
      () => {
        const encoded = storage.getItem(key);
        if (!encoded) return true;
        const current = JSON.parse(encoded) as Record<string, unknown>;
        if (current.uploadId !== uploadId || current.revision !== revision)
          return false;
        storage.removeItem(key);
        return true;
      },
    );
  } catch {
    // Recovery persistence is best effort when browser storage is unavailable.
    return false;
  }
}

export function loadPendingProjectUpload(
  actorId: string,
  ownerId: string,
  projectId: string,
  storage: ProjectUploadStorage | null = browserStorage(),
) {
  if (!storage) return null;
  const key = pendingProjectUploadStorageKey(actorId, projectId);
  try {
    const encoded = storage.getItem(key);
    if (!encoded) return null;
    const parsed: unknown = JSON.parse(encoded);
    if (validPendingProjectUpload(parsed, actorId, ownerId, projectId))
      return parsed;
    storage.removeItem(key);
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore an unavailable browser store and continue without recovery.
    }
  }
  return null;
}

export async function finalizePendingProjectUpload({
  actionUrl,
  fetchImpl = fetch,
  pending,
}: {
  actionUrl: string;
  fetchImpl?: typeof fetch;
  pending: PendingProjectUpload;
}) {
  if (!pending.verificationId)
    throw new Error("파일 검증 완료 정보를 확인할 수 없습니다.");
  const response = await fetchImpl(actionUrl, {
    body: JSON.stringify({
      verificationId: pending.verificationId,
      ...(pending.returnTo ? { returnTo: pending.returnTo } : {}),
    }),
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("파일 등록 서버의 응답을 확인하지 못했습니다.");
  }
  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>).error
        : null;
    throw new ProjectUploadFinalizationError(
      typeof error === "string" ? error : "파일 기록에 실패했습니다.",
      response.status,
    );
  }
  const destination =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).destination
      : null;
  if (typeof destination !== "string")
    throw new Error("파일 등록 완료 주소를 확인하지 못했습니다.");
  const action = new URL(actionUrl);
  const target = new URL(destination, action);
  const projectRoot = `/projects/${pending.projectId}`;
  if (
    target.origin !== action.origin ||
    (target.pathname !== projectRoot &&
      !target.pathname.startsWith(`${projectRoot}/`))
  )
    throw new Error("파일 등록 완료 주소가 올바르지 않습니다.");
  return `${target.pathname}${target.search}${target.hash}`;
}

export async function completePendingProjectUpload({
  finalize,
  pending,
  persist,
  verify,
}: {
  finalize: (pending: PendingProjectUpload) => Promise<string>;
  pending: PendingProjectUpload;
  persist: (
    pending: PendingProjectUpload,
    transition?: PendingProjectUploadTransition,
  ) =>
    | boolean
    | PendingProjectUpload
    | Promise<boolean | PendingProjectUpload | null>
    | null;
  verify: (metadata: ProjectFileUploadMetadata) => Promise<string>;
}) {
  if (!pending.uploadComplete)
    throw new Error(
      "원본 업로드가 아직 완료되지 않았습니다. 같은 파일을 다시 선택해 이어서 올려주세요.",
    );
  const verifyPending = async (
    candidate: PendingProjectUpload,
    transition: PendingProjectUploadTransition = "advance",
  ) => {
    const verificationId = await verify({
      byteSize: candidate.byteSize,
      contentType: candidate.contentType,
      kind: candidate.kind,
      originalFilename: candidate.originalFilename,
      storagePath: candidate.storagePath,
    });
    if (!uuidPattern.test(verificationId))
      throw new Error("파일 검증 완료 정보를 받지 못했습니다.");
    const verified = { ...candidate, verificationId };
    const persisted = await persist(verified, transition);
    if (!persisted)
      throw new Error(
        "파일 검증 복구 정보를 저장하지 못했습니다. 브라우저 저장소를 확인한 뒤 다시 시도해주세요.",
      );
    return typeof persisted === "boolean" ? verified : persisted;
  };

  let verified = pending.verificationId
    ? pending
    : await verifyPending(pending);
  try {
    return { destination: await finalize(verified), pending: verified };
  } catch (error) {
    if (
      !(error instanceof ProjectUploadFinalizationError) ||
      error.status !== 410
    )
      throw error;
    verified = await verifyPending(verified, "replace-verification");
    return { destination: await finalize(verified), pending: verified };
  }
}

export function supabaseResumableUploadEndpoint(supabaseUrl: string) {
  const url = new URL(supabaseUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    const projectRef = url.hostname.split(".")[0];
    return `${url.protocol}//${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

export async function uploadProjectFileDirect({
  file,
  kind,
  ownerId,
  projectId,
  upload,
}: {
  file: File;
  kind: ProjectFileKind;
  ownerId: string;
  projectId: string;
  upload: (
    storagePath: string,
    file: File,
    options: { contentType: string; upsert: false },
  ) => Promise<StorageUploadResult>;
}): Promise<ProjectFileUploadMetadata> {
  const originalFilename = file.name.trim();
  if (!originalFilename) throw new Error("파일 이름을 확인할 수 없습니다.");
  if (!fileMatchesProjectKind(kind, originalFilename))
    throw new Error(
      projectFileKindMismatchMessage(kind, originalFilename) ??
        "선택한 자료 종류와 파일 형식이 맞지 않습니다.",
    );
  if (file.size <= 0) throw new Error("빈 파일은 업로드할 수 없습니다.");
  if (file.size > maxProjectUploadBytes)
    throw new Error("현재 웹 업로드는 파일당 200MB까지 가능합니다.");
  if (originalFilename.length > 255)
    throw new Error("파일 이름은 255자 이하여야 합니다.");

  const contentType = projectUploadContentType(kind, file.type);
  if (contentType.length > 255)
    throw new Error("파일 형식 정보가 너무 깁니다.");
  if (!contentTypeMatchesProjectKind(kind, contentType))
    throw new Error("DXF 파일 형식 정보가 허용되지 않습니다.");
  const storagePath = storageObjectPath({
    directory: projectSourceUploadDirectory,
    ownerId,
    projectId,
    originalFilename,
  });
  const uploaded = await upload(storagePath, file, {
    contentType,
    upsert: false,
  });
  if (uploaded.error)
    throw new Error(`파일 저장 실패: ${uploaded.error.message}`);
  const uploadedStoragePath = uploaded.storagePath ?? storagePath;
  if (
    !isProjectStorageObjectPath({
      directory: projectSourceUploadDirectory,
      originalFilename,
      ownerId,
      projectId,
      storagePath: uploadedStoragePath,
    })
  )
    throw new Error("파일 저장 경로를 확인할 수 없습니다.");

  return {
    byteSize: file.size,
    contentType,
    kind,
    originalFilename,
    storagePath: uploadedStoragePath,
  };
}

export function uploadProjectFileResumable({
  accessToken,
  file,
  kind,
  onUploadComplete,
  onProgress,
  onStoragePath,
  ownerId,
  projectId,
  resumeStoragePath,
  supabaseUrl,
}: {
  accessToken: string;
  file: File;
  kind: ProjectFileKind;
  onUploadComplete?: (
    metadata: ProjectFileUploadMetadata,
  ) => void | Promise<void>;
  onProgress?: (percentage: number) => void;
  onStoragePath?: (metadata: ProjectFileUploadMetadata) => void | Promise<void>;
  ownerId: string;
  projectId: string;
  resumeStoragePath?: string;
  supabaseUrl: string;
}) {
  return uploadProjectFileDirect({
    file,
    kind,
    ownerId,
    projectId,
    upload: (storagePath, source, options) =>
      new Promise((resolve, reject) => {
        const endpoint = supabaseResumableUploadEndpoint(supabaseUrl);
        let activeStoragePath = storagePath;
        let activeUrlStorageKey: string | null = null;
        let resumedStoragePath: string | null = null;
        let resumedUploadUrl: string | null = null;
        const reportStoragePath = async (nextStoragePath: string) =>
          await onStoragePath?.({
            byteSize: source.size,
            contentType: options.contentType,
            kind,
            originalFilename: source.name.trim(),
            storagePath: nextStoragePath,
          });
        const baseUrlStorage = tus.defaultOptions?.urlStorage;
        const urlStorage: typeof tus.defaultOptions.urlStorage | undefined =
          baseUrlStorage
            ? {
                addUpload: async (fingerprint, previousUpload) => {
                  const key = await baseUrlStorage.addUpload(
                    fingerprint,
                    previousUpload,
                  );
                  activeUrlStorageKey = key;
                  return key;
                },
                findAllUploads: () => baseUrlStorage.findAllUploads(),
                findUploadsByFingerprint: (fingerprint) =>
                  baseUrlStorage.findUploadsByFingerprint(fingerprint),
                removeUpload: async (key) => {
                  await baseUrlStorage.removeUpload(key);
                  if (activeUrlStorageKey === key) activeUrlStorageKey = null;
                },
              }
            : undefined;
        const completeUpload = async () => {
          const metadata = {
            byteSize: source.size,
            contentType: options.contentType,
            kind,
            originalFilename: source.name.trim(),
            storagePath: activeStoragePath,
          } satisfies ProjectFileUploadMetadata;
          await onUploadComplete?.(metadata);
          if (activeUrlStorageKey && urlStorage)
            await urlStorage.removeUpload(activeUrlStorageKey);
          return metadata;
        };
        // TUS's browser fingerprint includes File.type, not metadata.contentType.
        // Keep DWG resume identity stable without changing other file kinds.
        const tusSource =
          kind === "dwg" && source.type !== options.contentType
            ? new File([source], source.name, {
                type: options.contentType,
                lastModified: source.lastModified,
              })
            : source;
        const upload = new tus.Upload(tusSource, {
          chunkSize: 6 * 1024 * 1024,
          endpoint,
          headers: { authorization: `Bearer ${accessToken}` },
          metadata: {
            bucketName: "lukas-qto",
            cacheControl: "3600",
            contentType: options.contentType,
            objectName: storagePath,
          },
          onAfterResponse: async (request, response) => {
            if (
              request.getMethod() !== "HEAD" ||
              request.getURL() !== resumedUploadUrl ||
              !resumedStoragePath
            )
              return;
            activeStoragePath =
              response.getStatus() >= 200 && response.getStatus() < 300
                ? resumedStoragePath
                : storagePath;
            await reportStoragePath(activeStoragePath);
          },
          onError: (error) => reject(error),
          onProgress: (uploaded, total) =>
            onProgress?.(total > 0 ? Math.round((uploaded / total) * 100) : 0),
          onSuccess: () => {
            void completeUpload()
              .then(({ storagePath: completedStoragePath }) =>
                resolve({ error: null, storagePath: completedStoragePath }),
              )
              .catch(reject);
          },
          removeFingerprintOnSuccess: false,
          retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
          uploadDataDuringCreation: false,
          ...(urlStorage ? { urlStorage } : {}),
        });
        upload
          .findPreviousUploads()
          .catch(() => [])
          .then(async (previousUploads) => {
            const previous = previousUploads.find((candidate) => {
              if (
                candidate.size !== source.size ||
                !candidate.metadata ||
                candidate.metadata.bucketName !== "lukas-qto" ||
                candidate.metadata.contentType !== options.contentType ||
                typeof candidate.metadata.objectName !== "string" ||
                candidate.metadata.objectName !== resumeStoragePath ||
                candidate.parallelUploadUrls != null ||
                !candidate.uploadUrl
              )
                return false;
              let uploadUrl: URL;
              const endpointUrl = new URL(endpoint);
              try {
                uploadUrl = new URL(candidate.uploadUrl);
              } catch {
                return false;
              }
              return (
                uploadUrl.origin === endpointUrl.origin &&
                (uploadUrl.pathname === endpointUrl.pathname ||
                  uploadUrl.pathname.startsWith(`${endpointUrl.pathname}/`)) &&
                isProjectStorageObjectPath({
                  directory: projectSourceUploadDirectory,
                  originalFilename: source.name.trim(),
                  ownerId,
                  projectId,
                  storagePath: candidate.metadata.objectName ?? "",
                })
              );
            });
            if (previous) {
              resumedStoragePath = previous.metadata.objectName;
              resumedUploadUrl = previous.uploadUrl;
              activeUrlStorageKey = previous.urlStorageKey;
              activeStoragePath = resumedStoragePath;
              upload.resumeFromPreviousUpload(previous);
            }
            await reportStoragePath(activeStoragePath);
            upload.start();
          })
          .catch(reject);
      }),
  });
}
