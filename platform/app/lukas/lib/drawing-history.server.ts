import { z } from "zod";

const HistoryCursorSchema = z.object({
  createdAt: z.string().datetime({ offset: true }),
  id: z.string().uuid(),
  kind: z.enum(["operation", "issue_event"]),
});

export type DrawingHistoryCursor = z.infer<typeof HistoryCursorSchema>;

export type DrawingActivityItem =
  | {
      kind: "operation";
      id: string;
      createdAt: string;
      actorId: string;
      clientOperationId: string;
      revisionId: string;
      action: string;
      detail: unknown;
      provenance: { originalOperationId: string | null };
    }
  | {
      kind: "issue_event";
      id: string;
      createdAt: string;
      actorId: string | null;
      issueId: string;
      action: string;
      detail: unknown;
      provenance: { projectId: string };
    };

type HistoryQuery = {
  select(columns: string): HistoryQuery;
  eq(column: string, value: string): HistoryQuery;
  or(filter: string): HistoryQuery;
  order(column: string, options?: { ascending?: boolean }): HistoryQuery;
  limit(count: number): PromiseLike<{
    data: Array<Record<string, unknown>> | null;
    error: { message: string } | null;
  }>;
};

type HistoryClient = { from(table: string): HistoryQuery };

export function encodeDrawingHistoryCursor(cursor: DrawingHistoryCursor) {
  return Buffer.from(
    JSON.stringify(HistoryCursorSchema.parse(cursor)),
  ).toString("base64url");
}

export function parseDrawingHistoryCursor(value?: string | null) {
  if (!value) return null;
  try {
    return HistoryCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new Response("변경 이력 커서가 올바르지 않습니다.", { status: 400 });
  }
}

export function drawingHistoryPageHref(
  documentId: string,
  cursor: string,
  itemId: string,
) {
  const query = new URLSearchParams({
    document: documentId,
    historyCursor: cursor,
  });
  return `?${query}#history-${itemId}`;
}

/** Loads one bounded immutable activity page using a shared global keyset. */
export async function loadDrawingActivityPage(
  client: HistoryClient,
  projectId: string,
  revisionId: string,
  options: { cursor?: string | null; limit?: number } = {},
) {
  const limit = options.limit ?? 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50)
    throw new Error("Drawing history page size must be between 1 and 50.");
  const cursor = parseDrawingHistoryCursor(options.cursor);
  let operations = client
    .from("lukas_drawing_operations")
    .select(
      "id,client_operation_id,revision_id,actor_id,operation_type,forward,history_action,original_operation_id,created_at",
    )
    .eq("project_id", projectId)
    .eq("revision_id", revisionId);
  if (cursor)
    operations = operations.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`,
    );
  let events = client
    .from("lukas_drawing_issue_events")
    .select(
      "id,issue_id,project_id,actor_id,event_type,to_value,note,created_at",
    )
    .eq("project_id", projectId);
  if (cursor)
    events = events.or(
      `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})${cursor.kind === "operation" ? `,and(created_at.eq.${cursor.createdAt},id.eq.${cursor.id})` : ""}`,
    );
  const [operationResult, eventResult] = await Promise.all([
    operations
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    events
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
  ]);
  const error = operationResult.error ?? eventResult.error;
  if (error)
    throw new Error(`도면 변경 이력을 불러오지 못했습니다: ${error.message}`);
  const operationRows = operationResult.data ?? [];
  const eventRows = eventResult.data ?? [];
  const items: DrawingActivityItem[] = [
    ...operationRows.map((row) => ({
      kind: "operation" as const,
      id: String(row.id),
      createdAt: String(row.created_at),
      actorId: String(row.actor_id),
      clientOperationId: String(row.client_operation_id),
      revisionId: String(row.revision_id),
      action: String(row.history_action ?? row.operation_type),
      detail: row.forward,
      provenance: {
        originalOperationId:
          typeof row.original_operation_id === "string"
            ? row.original_operation_id
            : null,
      },
    })),
    ...eventRows.map((row) => ({
      kind: "issue_event" as const,
      id: String(row.id),
      createdAt: String(row.created_at),
      actorId: typeof row.actor_id === "string" ? row.actor_id : null,
      issueId: String(row.issue_id),
      action: String(row.event_type),
      detail: { to: row.to_value, note: row.note },
      provenance: { projectId: String(row.project_id) },
    })),
  ].sort(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id) ||
      right.kind.localeCompare(left.kind),
  );
  const boundedItems = items.slice(0, limit);
  const last = boundedItems.at(-1);
  const nextCursor =
    items.length > limit && last
      ? encodeDrawingHistoryCursor({
          createdAt: last.createdAt,
          id: last.id,
          kind: last.kind,
        })
      : null;
  return { items: boundedItems, nextCursor };
}
