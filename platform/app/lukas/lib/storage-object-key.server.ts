import { randomUUID } from "node:crypto";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const directoryPattern = /^[A-Za-z0-9_-]+$/;
const extensionPattern = /\.([A-Za-z0-9]{1,16})$/;

type StorageObjectPathOptions = {
  ownerId: string;
  projectId: string;
  originalFilename: string;
  directory?: string;
  objectId?: string;
};

function requireUuid(value: string, label: string) {
  if (!uuidPattern.test(value))
    throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value.toLowerCase();
}

export function storageObjectName(
  originalFilename: string,
  objectId: string = randomUUID(),
) {
  const safeId = requireUuid(objectId, "파일 ID");
  const extension =
    originalFilename
      .normalize("NFKC")
      .match(extensionPattern)?.[0]
      .toLowerCase() ?? "";
  return `${safeId}${extension}`;
}

export function storageObjectPath({
  ownerId,
  projectId,
  originalFilename,
  directory,
  objectId,
}: StorageObjectPathOptions) {
  const segments = [
    requireUuid(ownerId, "소유자 ID"),
    requireUuid(projectId, "프로젝트 ID"),
  ];
  if (directory) {
    if (!directoryPattern.test(directory))
      throw new Error("저장 폴더 형식이 올바르지 않습니다.");
    segments.push(directory);
  }
  segments.push(storageObjectName(originalFilename, objectId));
  return segments.join("/");
}
