import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
export function WorkflowDraftShape({
  shape,
  selected,
}: {
  shape: WorkflowBlankDocument["shapes"][number];
  selected: boolean;
}) {
  const { x, y } = shape,
    width = shape.width ?? 120,
    height = shape.height ?? 80,
    stroke = shape.stroke ?? "#aaa0d0",
    fill = shape.fill ?? "#ede9fe",
    lineWidth = shape.lineWidth ?? 2;
  return (
    <g
      transform={`rotate(${shape.rotation ?? 0} ${x + width / 2} ${y + height / 2})`}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        pointerEvents="all"
      />
      {shape.kind === "polyline" ? (
        shape.closed ? (
          <polygon
            points={shape.points
              ?.map((point) => `${x + point.x * width},${y + point.y * height}`)
              .join(" ")}
            fill={fill}
            stroke={stroke}
            strokeWidth={lineWidth}
          />
        ) : (
          <polyline
            points={shape.points
              ?.map((point) => `${x + point.x * width},${y + point.y * height}`)
              .join(" ")}
            fill="none"
            stroke={stroke}
            strokeWidth={lineWidth}
          />
        )
      ) : shape.kind === "line" ? (
        <line
          x1={x}
          y1={y + height}
          x2={x + width}
          y2={y}
          stroke={stroke}
          strokeWidth={lineWidth}
        />
      ) : shape.kind === "circle" ? (
        <circle
          cx={x + width / 2}
          cy={y + height / 2}
          r={Math.min(width, height) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={lineWidth}
        />
      ) : shape.kind === "text" ? (
        <foreignObject x={x} y={y} width={width} height={height}>
          <div
            style={{
              color: stroke,
              fontSize: 13,
              lineHeight: "16px",
              overflowWrap: "anywhere",
              height: "100%",
              overflow: "auto",
            }}
          >
            {shape.label}
          </div>
        </foreignObject>
      ) : (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          rx="4"
          fill={fill}
          stroke={stroke}
          strokeWidth={lineWidth}
        />
      )}
      {shape.kind !== "text" && (
        <text
          x={x + width / 2}
          y={y + height / 2 + 4}
          textAnchor="middle"
          fontSize="13"
          fill="#493e78"
        >
          {shape.label.slice(0, 9)}
        </text>
      )}
      {selected && (
        <rect
          x={x - 3}
          y={y - 3}
          width={width + 6}
          height={height + 6}
          fill="none"
          stroke="#6554d7"
          strokeWidth="1"
          strokeDasharray="4 3"
          pointerEvents="none"
        />
      )}
    </g>
  );
}
