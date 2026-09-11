import {deliveryIdentitySchema} from "../lib/workflow-delivery-identity";
import { useState } from "react";
import {WorkflowOutputPreparation} from './workflow-output-preparation';
import { WorkflowDeliveryQuantity } from './workflow-delivery-quantity';
import { deliveryQuantityReview } from '../lib/workflow-document-delivery';
import type { WorkflowBlankDocument } from "../lib/workflow-blank-document";
import {
  reduceDocumentDelivery,
  type DocumentDeliveryAction,
} from "../lib/workflow-document-delivery";
export function WorkflowDocumentDeliveries({
  documents,
  drafts,
  onDraft,
  onChange,
  onOpen,
  onRecipient,
}: {
  documents: WorkflowBlankDocument[];
  drafts:Record<string,string>;
  onDraft:(patch:Record<string,string>)=>void;
  onChange: (document: WorkflowBlankDocument) => void;
  onRecipient: (id: string, sequence: number) => void;
  onOpen: (
    id: string,
    revision: number,
    targetId: string,
    page: number,
  ) => void;
}) {
  const eligible = documents.filter((document) =>
    document.reviewRounds?.some((round) => round.phase === "approved"),
  );
  return (
    <section className="flow-card" aria-label="내 PDF 납품">
      <h2>내 PDF 승인본 · 납품 구성</h2>
      <p>
        직접 만든 도면의 승인 기록을 사용합니다. 실제 파일 생성·메일 전송·수신
        증명은 수행하지 않는 로컬 화면 체험입니다.
      </p>
      {!eligible.length ? (
        <p>
          승인된 로컬 PDF 작업이 없습니다. 작업실에서 검토·승인 흐름을 먼저
          완료하세요.
        </p>
      ) : (
        eligible.map((document) => (
          <DocumentPackage
            key={`${document.id}:${JSON.stringify(document.delivery)}`}
            document={document}
            drafts={drafts}
            onDraft={onDraft}
            onChange={onChange}
            onOpen={onOpen}
            onRecipient={onRecipient}
          />
        ))
      )}
    </section>
  );
}
function DocumentPackage({
  document,
  drafts,
  onDraft,
  onChange,
  onOpen,
  onRecipient,
}: {
  document: WorkflowBlankDocument;
  drafts:Record<string,string>;
  onDraft:(patch:Record<string,string>)=>void;
  onRecipient: (id: string, sequence: number) => void;
  onChange: (document: WorkflowBlankDocument) => void;
  onOpen: (
    id: string,
    revision: number,
    targetId: string,
    page: number,
  ) => void;
}) {
  const rounds = document.reviewRounds!.filter(
    (round) => round.phase === "approved",
  );
  const prefix=`delivery:${document.id}:`;
  const value=(field:string,fallback='')=>drafts[prefix+field]??fallback;
  const edit=(field:string,text:string)=>onDraft({[prefix+field]:text});
  const revision=Number(value('revision',String(document.delivery?.revision??rounds.at(-1)!.revision)));
  const recipient=value('recipient',document.delivery?.recipient??'');
  const reference=value('reference',document.delivery?.reference??'');
  const issuedOn=value('issuedOn',document.delivery?.issuedOn??'');
  const setRecipient=(text:string)=>edit('recipient',text);
  const setReference=(text:string)=>edit('reference',text);
  const setIssuedOn=(text:string)=>edit('issuedOn',text);
  const identity=reference||issuedOn?{reference,issuedOn}:{};
  const identityValid=deliveryIdentitySchema.safeParse(identity).success;
  const [guest, setGuest] = useState(false);
  const quantitySequence=value('quantitySequence',document.delivery?.quantityReviewSequence?.toString()??'');
  const setQuantitySequence=(text:string)=>edit('quantitySequence',text);
  const message=value(`feedback:${document.delivery?.sequence??0}`);
  const setMessage=(text:string)=>edit(`feedback:${document.delivery?.sequence??0}`,text);
  const saved = document.delivery;
  const round = rounds.find(
    (round) => round.revision === (guest ? saved?.revision : revision),
  )!;
  const act = (action: DocumentDeliveryAction) =>
    onChange(reduceDocumentDelivery(document, action));
  return (
    <article
      className="flow-local-package"
      aria-label={`${document.title} 납품 구성`}
    >
      <h3>{document.title}</h3>
      <p>
        현재 작업 R{document.revision ?? 1} · 납품 대상은 승인 개정만 선택할 수
        있습니다.
      </p>
      <p className="flow-note">작성 중인 내용은 이 탭의 도면별 초안으로 보관합니다. 납품 구성을 준비하기 전에는 배포 기록이 바뀌지 않습니다.</p>
      {!guest ? (
        <>
          <label className="flow-input">
            승인 개정
            <select
              aria-label={`${document.title} 납품 개정`}
              value={revision}
              onChange={(event) => onDraft({[prefix+'revision']:event.target.value,[prefix+'quantitySequence']:''})}
            >
              {!rounds.some(round=>round.revision===revision)&&<option value={revision}>선택했던 승인 개정을 찾을 수 없습니다</option>}
              {rounds.map((round) => (
                <option key={round.revision} value={round.revision}>
                  R{round.revision} · {round.source.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flow-input">
            포함할 검산 결과
            <select aria-label={`${document.title} 포함할 검산 결과`} value={quantitySequence} onChange={event=>setQuantitySequence(event.target.value)}>
              <option value="">미포함 · 도면만 전달</option>
              {(document.quantityReviews??[]).filter(item=>deliveryQuantityReview(document,revision,item.sequence)).map(item=><option key={item.sequence} value={item.sequence}>검산 #{item.sequence} · R{item.revision} 금액 승인 (체험)</option>)}
            </select>
          </label>
          <p>선택한 승인 도면과 수량 근거가 일치하는 검산 결과만 포함할 수 있습니다.</p>
          <label className="flow-input">
            수신 대상
            <input
              aria-label={`${document.title} 수신 대상`}
              maxLength={120}
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="예: 발주처 검토팀"
            />
          </label>
          <label className="flow-input">문서번호 (선택)<input aria-label={`${document.title} 문서번호`} maxLength={80} value={reference} onChange={event=>setReference(event.target.value)}/></label>
          <label className="flow-input">발행일<input aria-label={`${document.title} 발행일`} type="date" value={issuedOn} onChange={event=>setIssuedOn(event.target.value)}/></label>
          <p>문서번호를 사용할 때는 발행일도 입력하세요. 공식 발송번호의 중복 확인이나 실제 발송은 수행하지 않습니다.</p>
          {!identityValid&&<p role="alert">문서번호와 유효한 발행일을 함께 입력하세요.</p>}
          <p>
            포함 예정: PDF 원본 참조, 구상 객체 목록, 개정별 검토 의견. PDF 출력
            파일은 아직 생성되지 않았습니다. DWG 재저장 엔진과 수량·내역 Excel은
            연결되지 않았습니다.
          </p>
          <button
            disabled={
              !recipient.trim() || !identityValid || !rounds.some(round=>round.revision===revision) ||
              (document.deliveryHistory?.length ?? 0) >= 100
            }
            onClick={() => act({ type: "prepare", revision, recipient, ...identity, ...(quantitySequence ? {quantityReviewSequence:Number(quantitySequence)} : {}) })}
          >
            {saved ? "납품 구성 다시 만들기" : "납품 구성 준비"}
          </button>
          {(document.deliveryHistory?.length ?? 0) >= 100 && (
            <p role="status">
              이 탭의 이전 구성 보관 한도 100건에 도달했습니다. 기존 기록을
              지우거나 덮어쓰지 않습니다.
            </p>
          )}
          {saved && (
            <>
              <p>
                보관 구성: R{saved.revision} → {saved.recipient} ·{" "}
                {saved.status === "prepared"
                  ? "확인 대기"
                  : saved.status === "received"
                    ? "구성 확인 완료 (체험)"
                    : "보완 요청 (체험)"}
              </p>
              {saved.reference&&<p>문서번호 {saved.reference} · 발행일 {saved.issuedOn}</p>}
              {saved.feedback && <p>수신 의견: {saved.feedback}</p>}
              <WorkflowDeliveryQuantity document={document} delivery={saved}/>
              <WorkflowOutputPreparation document={document} delivery={saved} onChange={onChange}/>
              <button
                disabled={saved.linkStatus === "expired"}
                onClick={() => setGuest(true)}
              >
                받는 사람 화면 보기
              </button>
              <button
                onClick={() => onRecipient(document.id, saved.sequence ?? 0)}
              >
                독립 수신 화면 열기
              </button>
              <button
                disabled={saved.linkStatus === "expired"}
                onClick={() => act({ type: "expire" })}
              >
                수신 화면 만료시키기 (체험)
              </button>
              {saved.linkStatus === "expired" && (
                <p role="status">
                  수신 화면 만료됨 · 구성을 다시 만들면 새로운 화면으로
                  준비됩니다.
                </p>
              )}
              <p className="flow-note">
                다시 만들면 이전 구성과 수신 의견을 아래 이력에 보관합니다. 서버
                전송 이력이나 실제 수신 증명은 아닙니다.
              </p>
            </>
          )}
          {Boolean(document.deliveryHistory?.length) && (
            <details>
              <summary>
                이전 납품 구성 ({document.deliveryHistory!.length})
              </summary>
              <section aria-label="이전 납품 구성">
                <p>
                  교체된 구성의 마지막 상태입니다. 이전 수신 주소는 재사용할 수
                  없으며, 승인본 확인은 읽기 전용입니다.
                </p>
                {document
                  .deliveryHistory!.slice()
                  .reverse()
                  .map((item, index) => {
                    const approved = rounds.find(
                      (round) => round.revision === item.revision,
                    );
                    return (
                      <article
                        className="flow-card"
                        key={`${item.sequence ?? 0}:${index}`}
                      >
                        <h4>
                          구성 #{item.sequence ?? 0} · 승인본 R{item.revision}
                        </h4>
                        <p>수신 대상: {item.recipient}</p>
                        <WorkflowDeliveryQuantity document={document} delivery={item}/>
                        <WorkflowOutputPreparation document={document} delivery={item} onChange={onChange} readOnly/>
                        <p>
                          {item.status === "received"
                            ? "수신 확인 기록"
                            : item.status === "correction"
                              ? "보완 요청 기록"
                              : "확인 대기 중 교체"}{" "}
                          ·{" "}
                          {item.linkStatus === "expired"
                            ? "만료 후 교체"
                            : "새 구성으로 교체"}
                        </p>
                        <p>수신 의견: {item.feedback || "기록 없음"}</p>
                        <p>
                          원본 참조:{" "}
                          {approved?.source.name ?? "승인본 확인 필요"}
                        </p>
                        <button
                          disabled={!approved}
                          onClick={() => {
                            if (approved)
                              onOpen(
                                document.id,
                                approved.revision,
                                approved.targetId,
                                approved.objects.find(
                                  (object) => object.id === approved.targetId,
                                )?.page ?? 1,
                              );
                          }}
                        >
                          이전 승인본 보기
                        </button>
                      </article>
                    );
                  })}
              </section>
            </details>
          )}
        </>
      ) : (
        <>
          <h4>받는 사람 미리보기 · {saved!.recipient}</h4>
          <WorkflowDeliveryQuantity document={document} delivery={saved!}/>
          <p>
            R{round.revision} 승인본 · {round.source.name} ·{" "}
            {round.objects.length}개 객체
          </p>
          <ul>
            {round.objects.map((object) => (
              <li key={object.id}>
                {object.page ?? 1}쪽 · {object.label}
              </li>
            ))}
          </ul>
          <p>요청: {round.message}</p>
          <p>검토: {round.reviewNote}</p>
          <p>승인: {round.approvalNote}</p>
          <button
            onClick={() =>
              onOpen(
                document.id,
                round.revision,
                round.targetId,
                round.objects.find((object) => object.id === round.targetId)
                  ?.page ?? 1,
              )
            }
          >
            납품 승인본 확인
          </button>
          {saved!.status === "prepared" ? (
            <>
              <label className="flow-input">
                수신 의견
                <textarea
                  aria-label="납품 수신 의견"
                  maxLength={500}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              <div className="flow-actions">
                <button
                  disabled={!message.trim()}
                  onClick={() => act({ type: "receive", message })}
                >
                  구성 확인 완료 (체험)
                </button>
                <button
                  disabled={!message.trim()}
                  onClick={() => act({ type: "correction", message })}
                >
                  보완 요청 (체험)
                </button>
              </div>
            </>
          ) : (
            <p>{saved!.feedback}</p>
          )}
          <button onClick={() => setGuest(false)}>보내는 사람 화면으로</button>
        </>
      )}
    </article>
  );
}
