import { z } from "zod";

const HistoryCursorSchema = z.object({
  operationId: z.string().uuid().nullable(),
  eventId: z.string().uuid().nullable(),
});

export type DrawingHistoryCursor = z.infer<typeof HistoryCursorSchema>;

export type DrawingActivityItem =
  | {
      kind: "operation";
      id: string;
      createdAt: string;
      actorId: string;
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
  gt(column: string, value: string): HistoryQuery;
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
  if (!value) return { operationId: null, eventId: null };
  try {
    return HistoryCursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new Response("변경 이력 커서가 올바르지 않습니다.", { status: 400 });
  }
}

/** Loads one bounded immutable activity page using independent ID keysets. */
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
      "id,revision_id,actor_id,operation_type,forward,history_action,original_operation_id,created_at",
    )
    .eq("project_id", projectId)
    .eq("revision_id", revisionId);
  if (cursor.operationId) operations = operations.gt("id", cursor.operationId);
  let events = client
    .from("lukas_drawing_issue_events")
    .select(
      "id,issue_id,project_id,actor_id,event_type,to_value,note,created_at",
    )
    .eq("project_id", projectId);
  if (cursor.eventId) events = events.gt("id", cursor.eventId);
  const [operationResult, eventResult] = await Promise.all([
    operations.order("id", { ascending: true }).limit(limit + 1),
    events.order("id", { ascending: true }).limit(limit + 1),
  ]);
  const error = operationResult.error ?? eventResult.error;
  if (error)
    throw new Error(`도면 변경 이력을 불러오지 못했습니다: ${error.message}`);
  const operationRows = operationResult.data ?? [];
  const eventRows = eventResult.data ?? [];
  const hasMore = operationRows.length > limit || eventRows.length > limit;
  const boundedOperations = operationRows.slice(0, limit);
  const boundedEvents = eventRows.slice(0, limit);
  const items: DrawingActivityItem[] = [
    ...boundedOperations.map((row) => ({
      kind: "operation" as const,
      id: String(row.id),
      createdAt: String(row.created_at),
      actorId: String(row.actor_id),
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
    ...boundedEvents.map((row) => ({
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
      right.id.localeCompare(left.id),
  );
  const nextCursor = hasMore
    ? encodeDrawingHistoryCursor({
        operationId:
          boundedOperations.length > 0
            ? String(boundedOperations.at(-1)!.id)
            : cursor.operationId,
        eventId:
          boundedEvents.length > 0
            ? String(boundedEvents.at(-1)!.id)
            : cursor.eventId,
      })
    : null;
  return { items, nextCursor };
}
