import { useState } from "react";
import type { Workflow, WorkflowAction } from "../lib/workflow-prototype";

export function WorkflowImportPanel({
  state,
  dispatch,
  onOpen,
}: {
  state: Workflow;
  dispatch: (action: WorkflowAction) => void;
  onOpen: () => void;
}) {
  const [format, setFormat] = useState<"PDF" | "IFC" | "DWG">(
    state.importSetup?.format ?? (state.scenario === "ifc" ? "IFC" : "PDF"),
  );
  const [unit, setUnit] = useState<"mm" | "m">(state.importSetup?.unit ?? "mm");
  const [page, setPage] = useState(String(state.importSetup?.page ?? 1));
  const [step, setStep] = useState(0);
  const [ack, setAck] = useState(false);
  const [outcome, setOutcome] = useState<"ready" | "partial" | "failed">("partial");
  const [result, setResult] = useState<"processing" | "ready" | "partial" | "failed">("processing");
  const [partialAck, setPartialAck] = useState(false);
  const beginProcessing = () => {setResult("processing");setPartialAck(false);setStep(3);};
  const editable =
    state.role === "author" && ["draft", "changes"].includes(state.phase);
  const valid =
    Number.isInteger(Number(page)) && Number(page) > 0 && Number(page) <= 9999;
  const warnings =
    format === "DWG"
      ? [
          "글꼴 대체 시 문자 폭과 줄바꿈이 달라질 수 있습니다.",
          "외부참조·프록시 객체의 누락 여부를 원본과 비교해야 합니다.",
          "DWG 재저장 후 대상 CAD에서 열어 객체·치수·출력 설정을 확인해야 합니다.",
        ]
      : format === "IFC"
        ? [
            "모델 좌표·단위를 확인해야 합니다.",
            "GlobalId와 형상 누락 여부는 실제 IFC 처리 후 검증해야 합니다.",
          ]
        : [
            "페이지별 축척이 다를 수 있으므로 측정 전 기준 길이를 설정하세요.",
            "PDF 원본은 유지하고 편집 내용은 별도 오버레이로 취급합니다.",
          ];
  return (
    <section className="flow-import-panel" aria-label="파일 가져오기 준비">
      <ol className="flow-import-steps" aria-label="가져오기 단계">
        {["형식 선택", "설정 확인", "주의사항", "처리 결과 체험"].map((title, i) => (
          <li key={title} aria-current={step === i ? "step" : undefined}>
            {i + 1}. {title}
          </li>
        ))}
      </ol>
      <p>
        파일 업로드·검사는 실행하지 않습니다. 설정을 체험한 뒤 기존 시나리오
        도면을 엽니다.
      </p>
      {step === 0 && (
        <>
          <label className="flow-input">
            가져올 형식
            <select
              aria-label="가져올 형식"
              value={format}
              onChange={(e) => {
                setFormat(e.target.value as typeof format);
                setAck(false);
              }}
            >
              {["PDF", "IFC", "DWG"].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <p>
            {format === "DWG"
              ? "CAD 원본을 보존하고 읽기·편집·재저장 호환성을 단계별로 확인합니다."
              : format === "IFC"
                ? "요소 구조·좌표·형상과 도면 근거의 연결을 준비합니다."
                : "페이지를 배경으로 사용하고 도형·주석을 별도로 작성합니다."}
          </p>
          <button onClick={() => setStep(1)}>설정 확인으로</button>
        </>
      )}
      {step === 1 && (
        <>
          <label className="flow-input">
            원본 단위
            <select
              aria-label="원본 단위"
              value={unit}
              onChange={(e) => setUnit(e.target.value as "mm" | "m")}
            >
              <option value="mm">밀리미터 (mm)</option>
              <option value="m">미터 (m)</option>
            </select>
          </label>
          <label className="flow-input">
            시작 페이지·시트 번호
            <input
              aria-label="시작 페이지·시트 번호"
              type="number"
              min="1"
              max="9999"
              value={page}
              aria-invalid={!valid}
              onChange={(e) => setPage(e.target.value)}
            />
          </label>
          {!valid && (
            <p role="alert">1~9999 사이의 정수 페이지 번호를 입력하세요.</p>
          )}
          <p>
            현재는 파일을 분석하지 않으므로 실제 페이지 수·모델 공간은 확인되지
            않습니다. 단위 선택은 축척 검증을 대신하지 않습니다.
          </p>
          <button disabled={!valid} onClick={() => setStep(2)}>
            주의사항 확인
          </button>
        </>
      )}
      {step === 2 && (
        <>
          <h3>{format} 호환성 확인 목록 · 예시</h3>
          <ul>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
          <dl>
            <dt>선택 설정</dt>
            <dd>
              {format} · {unit} · 시트 {page}
            </dd>
            <dt>열릴 시나리오</dt>
            <dd>
              {state.document} · {state.object.sourceId}
            </dd>
          </dl>
          <label className="flow-input">
            <span>
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />{" "}
              실제 검사·변환 결과가 아닌 예시임을 확인했습니다
            </span>
          </label>
          {!editable && (
            <p role="status">
              현재 역할·개정에서는 설정을 변경할 수 없습니다. 기존 도면은 열람할
              수 있습니다.
            </p>
          )}
          <button
            disabled={!ack || !editable}
            onClick={beginProcessing}
          >
            처리 흐름 체험 시작
          </button>
          {!editable && <button onClick={onOpen}>기존 도면 보기</button>}
        </>
      )}
      {step === 3 && <>
        <h3>{format} 처리 결과 · 화면 시뮬레이션</h3>
        <p>{format} · {unit} · 시트 {page}. 파일을 전송하거나 변환하지 않습니다. 아래 결과는 사용자가 선택한 예시이며 호환성 인증이 아닙니다.</p>
        {result === "processing" ? <>
          <p role="status">처리 중 · 예시 결과를 선택하여 다음 화면을 확인하세요.</p>
          <ol><li>원본 보관</li><li>형상·참조 분석</li><li>열람 및 편집 가능 범위 확인</li></ol>
          <label className="flow-input">체험할 처리 결과<select aria-label="체험할 처리 결과" value={outcome} onChange={event=>setOutcome(event.target.value as typeof outcome)}>
            <option value="ready">정상 처리 예시</option><option value="partial">일부 지원 예시</option><option value="failed">처리 실패 예시</option>
          </select></label>
          <button onClick={()=>setResult(outcome)}>선택한 결과 확인</button>
          <button onClick={()=>setStep(2)}>처리 체험 취소</button>
        </> : <>
          <p role={result === "failed" ? "alert" : "status"}>{result === "failed" ? "처리 실패 예시 · 작업실을 열지 않았습니다." : result === "partial" ? "일부 지원 예시 · 누락 가능 항목을 확인하세요." : "정상 처리 예시 · 실제 파일 검증 결과가 아닙니다."}</p>
          {result === "failed" ? <p>예시 원인: 파일 분석을 완료하지 못했습니다. 원본을 CAD/BIM 도구에서 열어 확인하거나 다른 파일을 준비한 후 다시 시도하는 흐름입니다. 현재 원본·프로젝트 기록은 변경되지 않았습니다.</p> : <>
            <ul>
              <li>열람: 기존 시나리오 도면만 제공</li>
              <li>편집: 예시 객체만 가능 · 가져온 파일의 객체 편집 아님</li>
              <li>{format === "DWG" ? "DWG 재저장·납품: 검증되지 않음" : "원본 형식 내보내기·납품: 검증되지 않음"}</li>
            </ul>
            {result === "partial" && <>
              <h4>누락 가능 항목 · 예시 점검 목록</h4>
              <ul>{warnings.map(warning=><li key={warning}>{warning}</li>)}</ul>
              <label className="flow-input"><span><input type="checkbox" checked={partialAck} onChange={event=>setPartialAck(event.target.checked)}/> 누락 가능 항목을 확인하고 예시만 열겠습니다</span></label>
            </>}
            <p>열릴 예시: {state.document} · {state.object.sourceId}</p>
            <button disabled={!editable || (result === "partial" && !partialAck)} onClick={()=>{
              dispatch({type:"import-setup",format,unit,page:Number(page)});onOpen();
            }}>예시 작업실 열기</button>
          </>}
          <button disabled={!editable} onClick={beginProcessing}>다시 처리 체험</button>
          <button onClick={()=>{setStep(0);setAck(false);setPartialAck(false);}}>형식·설정 다시 선택</button>
        </>}
      </>}
      {step > 0 && step < 3 && <button onClick={() => setStep(step - 1)}>이전 단계</button>}
    </section>
  );
}
