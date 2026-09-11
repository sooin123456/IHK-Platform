import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DrawingNativeDwgImport } from "../../app/lukas/components/drawing-native-dwg-import";

const id = (n: number) =>
  `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function Harness() {
  const [canvas, setCanvas] = useState(5);
  const [online, setOnline] = useState(true);
  const [editor, setEditor] = useState(!location.search.includes("viewer"));
  const [ready, setReady] = useState(true);
  const [applied, setApplied] = useState(0);
  return (
    <>
      <p>Controlled HTTP component fixture — not real Auth/Storage</p>
      <button onClick={() => setCanvas(10)}>Switch canvas</button>
      <button onClick={() => setOnline((value) => !value)}>
        Toggle online
      </button>
      <button onClick={() => setEditor(false)}>Revoke editor</button>
      <button onClick={() => setReady((value) => !value)}>
        Toggle persistence ready
      </button>
      <span aria-label="Applied plans">{applied}</span>
      <DrawingNativeDwgImport
        action="/controlled-action"
        scope={{
          actorId: id(1),
          projectId: id(2),
          documentId: id(3),
          revisionId: id(4),
          canvasId: id(canvas),
        }}
        sources={[
          {
            id: id(6),
            sha256: "a".repeat(64),
            originalFilename: "fixture.dwg",
            byteSize: 1024,
          },
          {
            id: id(7),
            sha256: "b".repeat(64),
            originalFilename: "second.dwg",
            byteSize: 2048,
          },
        ]}
        canRequest={editor}
        canApply={editor && ready}
        online={online}
        onPrepared={async () => {
          setApplied((value) => value + 1);
        }}
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
