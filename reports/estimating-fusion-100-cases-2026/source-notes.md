# 적산 핵심기능 융합 100사례 — 조사 노트

## 조사 목적

- 질문: 적산의 핵심 기능을 독립 모듈로 떼어 다른 사업과 결합한 실제 사례 100개는 무엇이며, Lukas QTO에는 어떤 융합 순서가 현실적인가?
- 독자: 제품·사업 기획 의사결정자.
- 기준일: 2026-08-22.
- 사례 단위: 회사가 아니라 **공식적으로 판매·운영되는 제품 또는 결합 서비스**. 한 회사의 제품이 서로 다른 구매자와 업무를 갖는 경우에만 별도 사례로 보았다.
- 포함 기준: 수량, 내역, 단가, 예산, 원가코드, 공정률, 자산수량 등 적산 핵심 데이터가 입찰·조달·변경·현장·금융·탄소·운영·사업성 중 하나로 실제 전달되는 구조가 공식 페이지에서 확인되는 사례.
- 제외 기준: 단순 회사소개, 기능이 확인되지 않는 컨설팅, 종료가 명확한 제품, 소스코드 저장소만 있는 연구 프로토타입.

## 분류 정의

1. 수량·견적: 도면/BIM 측정값을 BOQ·원가·제안서로 전환.
2. 입찰·조달: 내역·패키지를 업체 네트워크, RFQ, 비교, 낙찰로 전환.
3. 원가·변경: 기준 내역을 계약, 변경, 예측, 실제비로 전환.
4. 공정·프로젝트통제: 수량·원가를 WBS·일정·리스크·현금흐름으로 전환.
5. 현장진도·검측: 계획 수량을 영상·스캔 기반 실적과 기성 증거로 전환.
6. 자재·ERP: 수량을 구매, 입고, 재고, 송장, 회계로 전환.
7. 탄소·순환경제: 수량을 EPD, LCA, 자재여권, 재사용 가치로 전환.
8. 준공·시설운영: 시공 중 객체·자산 목록을 O&M, CMMS, 디지털트윈으로 전환.
9. 지급·금융: 예산·기성·증빙을 청구, 대출 집행, 채권, 금융으로 전환.
10. 벤치마크·사업성: 원가·수량 데이터를 지수, 개략예산, 개발 타당성으로 재판매.

## 우선순위 정의

- P0: 현재 Lukas의 Revit/IFC·검증수량·BOQ에 바로 붙여 첫 유료 서비스가 될 수 있음.
- P1: 1~2개 모듈과 실무 운영을 추가하면 판매 가능.
- P2: 고객 데이터와 파트너 연동이 축적된 뒤 확장.
- L3: 금융·AI·대기업 ERP·디지털트윈 등 장기 옵션.

## 주요 공식 근거

- ConstructConnect: 프로젝트 탐색→수량산출·견적→입찰관리 연결. https://www.constructconnect.com/
- Bluebeam: 측정·협업·Excel Quantity Link의 사용자 구독 구조. https://www.bluebeam.com/pricing/
- Kreo: 도면 업로드→측정→BOQ/원가견적. https://www.kreo.net/
- Buildxact: 견적→자재가격·일정·구매·송장. https://www.buildxact.com/us/
- Procore: 견적·예산→계약·변경·예측·송장. https://www.procore.com/cost-management
- Oracle Primavera Unifier: CBS/WBS·원가·일정·계약·현금흐름·ERP. https://www.oracle.com/construction-engineering/primavera-unifier-project-controls-asset-management/
- Bentley SYNCHRO: 모델 수량→4D·원가·변경·기성. https://www.bentley.com/software/synchro/
- OpenSpace Track: 현장 영상+사람 검증→설치진도·청구·일정. https://www.openspace.ai/products/track/
- DroneDeploy Progress AI: 촬영→공종별 work-in-place·진도. https://dronedeploy.com/product/progress-ai
- Cupix SiteInsights: 360 캡처+BIM+일정→요소 진도. https://www.cupix.com/product/construction-progress-tracking-software
- 2050 Materials API: BOQ 재료 매칭·LCA·원가 SW 연동. https://docs.2050-materials.com/readme/using-the-2050-materials-api
- Autodesk Tandem: Revit/IFC 자산→IoT·BMS·FM 디지털트윈. https://www.autodesk.com/products/tandem/overview
- IBM Maximo: BIM handover→시설 자산·작업관리. https://www.ibm.com/docs/en/masv-and-l/maximo-ref/cd?topic=information-overview
- Rabbet: 예산·기성·증빙→개발금융·건설대출 심사. https://rabbet.com/
- Siteline: SOV·기성→pay app·lien waiver·A/R. https://www.siteline.com/
- Constrafor: 조달·송장→보험·리스크·인보이스 금융. https://www.constrafor.com/

## 해석상 주의

- 기능과 사업모델은 공식 판매 페이지·도움말·제품문서 기준의 1차 조사다. 고객 성과 수치는 회사 주장이라 이 보고서의 비교점수에 사용하지 않았다.
- `기업 견적`, `SaaS 구독`, `서비스 결합`은 공개 가격이 없는 경우 판매 형태를 설명한 것이며 실제 계약 가격을 뜻하지 않는다.
- 사례 수는 시장점유율이 아니다. 지역과 제품군의 다양성을 보여주기 위한 표본이다.
- 경쟁사의 데이터·화면·문구·단가 DB를 복제하자는 제안이 아니다. 기능 경계와 사업 결합 구조를 참고하는 자료다.
- 탄소계수, 표준품셈, 단가 DB, 금융 판단은 각각 라이선스·규제·전문가 승인 없이 Lukas가 자체 확정해서는 안 된다.

## 차트 맵

- `융합 영역별 사례 수`: 분류 체계의 범위가 10개 생애주기 영역을 모두 덮는지 확인하는 가로 막대. 데이터는 cases.csv의 category 건수.
- `Lukas 적용 우선순위`: P0/P1/P2/L3 사례 수. 시장 크기가 아니라 본 조사자의 제품 전략 분류임을 명시.

## 보고서 구조 매핑

- Title → 보고서 제목.
- Executive Summary → 직접 답변과 사업 결론.
- Key findings with visual evidence → 영역별 사례 수 차트, 100개 사례 표, 반복 사업 패턴.
- Recommended next steps → Lukas에 권장하는 5단계 수익화 순서.
- Further questions → 실무 검증·가격·책임·파트너 결정.
- Caveats and assumptions → 조사 한계와 금지선.
