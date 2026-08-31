import {
  fileMatchesProjectKind,
  type ProjectFileKind,
} from "~/lukas/lib/drawing-entry";
import {
  projectSourceUploadDirectory,
  storageObjectPath,
} from "~/lukas/lib/storage-object-key";
import * as tus from "tus-js-client";

export const maxProjectUploadBytes = 200 * 1024 * 1024;

type StorageUploadResult = { error: { message: string } | null };

export type ProjectFileUploadMetadata = {
  byteSize: number;
  contentType: string;
  kind: ProjectFileKind;
  originalFilename: string;
  storagePath: string;
};

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
    throw new Error("선택한 자료 종류와 파일 형식이 맞지 않습니다.");
  if (file.size <= 0) throw new Error("빈 파일은 업로드할 수 없습니다.");
  if (file.size > maxProjectUploadBytes)
    throw new Error("현재 웹 업로드는 파일당 200MB까지 가능합니다.");
  if (originalFilename.length > 255)
    throw new Error("파일 이름은 255자 이하여야 합니다.");

  const contentType = file.type || "application/octet-stream";
  if (contentType.length > 255)
    throw new Error("파일 형식 정보가 너무 깁니다.");
  const storagePath = storageObjectPath({
    directory: projectSourceUploadDirectory,
    ownerId,
    projectId,
    originalFilename,
  });
  const { error } = await upload(storagePath, file, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`파일 저장 실패: ${error.message}`);

  return {
    byteSize: file.size,
    contentType,
    kind,
    originalFilename,
    storagePath,
  };
}

export function uploadProjectFileResumable({
  accessToken,
  file,
  kind,
  onProgress,
  ownerId,
  projectId,
  supabaseUrl,
}: {
  accessToken: string;
  file: File;
  kind: ProjectFileKind;
  onProgress?: (percentage: number) => void;
  ownerId: string;
  projectId: string;
  supabaseUrl: string;
}) {
  return uploadProjectFileDirect({
    file,
    kind,
    ownerId,
    projectId,
    upload: (storagePath, source, options) =>
      new Promise((resolve, reject) => {
        const upload = new tus.Upload(source, {
          chunkSize: 6 * 1024 * 1024,
          endpoint: supabaseResumableUploadEndpoint(supabaseUrl),
          headers: { authorization: `Bearer ${accessToken}` },
          metadata: {
            bucketName: "lukas-qto",
            cacheControl: "3600",
            contentType: options.contentType,
            objectName: storagePath,
          },
          onError: (error) => reject(error),
          onProgress: (uploaded, total) =>
            onProgress?.(total > 0 ? Math.round((uploaded / total) * 100) : 0),
          onSuccess: () => resolve({ error: null }),
          removeFingerprintOnSuccess: true,
          retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
          uploadDataDuringCreation: true,
        });
        upload.start();
      }),
  });
}
