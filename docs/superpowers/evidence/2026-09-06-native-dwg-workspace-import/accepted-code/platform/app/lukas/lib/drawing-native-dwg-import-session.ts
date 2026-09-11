export type NativeDwgImportScope = {
  actorId: string;
  projectId: string;
  documentId: string;
  revisionId: string;
  canvasId: string;
};
export type NativeDwgImportUnit = "" | "1" | "2" | "4" | "5" | "6";
export type NativeDwgImportSession = NativeDwgImportScope & {
  version: 1;
  sourceFileId: string;
  sourceSha256: string;
  unitCode: NativeDwgImportUnit;
  requestId: string;
  jobId: string | null;
};
type PointerStorage = Pick<Storage, "getItem" | "setItem">;
const scopeFields = [
  "actorId",
  "projectId",
  "documentId",
  "revisionId",
  "canvasId",
] as const;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nativeDwgSessionKey(scope: NativeDwgImportScope): string {
  return `drawing-native-dwg-import:v1:${scopeFields.map((field) => encodeURIComponent(scope[field])).join(":")}`;
}

export function readNativeDwgSession(
  storage: Pick<PointerStorage, "getItem">,
  scope: NativeDwgImportScope,
): NativeDwgImportSession | null {
  let text: string | null;
  try {
    text = storage.getItem(nativeDwgSessionKey(scope));
  } catch {
    throw new Error("DWG 분석 요청의 로컬 저장소를 읽을 수 없습니다.");
  }
  if (!text) return null;
  try {
    const value = JSON.parse(text);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).sort().join(",") !==
        [
          ...scopeFields,
          "version",
          "sourceFileId",
          "sourceSha256",
          "unitCode",
          "requestId",
          "jobId",
        ]
          .sort()
          .join(",") ||
      value.version !== 1 ||
      scopeFields.some(
        (field) => value[field] !== scope[field] || !uuid.test(value[field]),
      ) ||
      typeof value.sourceFileId !== "string" ||
      !uuid.test(value.sourceFileId) ||
      typeof value.sourceSha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(value.sourceSha256) ||
      !["", "1", "2", "4", "5", "6"].includes(value.unitCode) ||
      typeof value.requestId !== "string" ||
      !uuid.test(value.requestId) ||
      (value.jobId !== null &&
        (typeof value.jobId !== "string" || !uuid.test(value.jobId)))
    )
      return null;
    return value as NativeDwgImportSession;
  } catch {
    return null;
  }
}

export function writeNativeDwgSession(
  storage: Pick<PointerStorage, "setItem">,
  pointer: NativeDwgImportSession,
): void {
  try {
    storage.setItem(nativeDwgSessionKey(pointer), JSON.stringify(pointer));
  } catch {
    throw new Error(
      "DWG 분석 요청을 로컬 저장소에 저장하지 못했습니다. 저장소를 확인한 뒤 다시 시도하세요.",
    );
  }
}

export function beginNativeDwgSession(
  storage: PointerStorage,
  scope: NativeDwgImportScope,
  source: { id: string; sha256: string },
  unitCode: NativeDwgImportUnit,
  createRequestId: () => string = () => crypto.randomUUID(),
  newRequest = false,
): NativeDwgImportSession {
  const existing = readNativeDwgSession(storage, scope);
  if (
    !newRequest &&
    existing?.sourceFileId === source.id &&
    existing.sourceSha256 === source.sha256 &&
    existing.unitCode === unitCode
  )
    return existing;
  const pointer: NativeDwgImportSession = {
    ...scope,
    version: 1,
    sourceFileId: source.id,
    sourceSha256: source.sha256,
    unitCode,
    requestId: createRequestId(),
    jobId: null,
  };
  // This synchronous write must succeed before any request leaves the browser.
  writeNativeDwgSession(storage, pointer);
  return pointer;
}
