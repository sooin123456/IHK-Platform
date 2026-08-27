import {
  addExact,
  compareExact,
  exactToString,
  exactZero,
  parseExactDecimal,
  subtractExact,
} from "./exact-decimal.server.ts";
import {
  calculateVerifiedBoqV1_1,
  canonicalizeVerifiedBoqV1_1Input,
  verifiedBoqLegacySourceId,
  type VerifiedBoqV1_1Input,
  type VerifiedBoqV1_1Result,
} from "./verified-boq-v1-1.server.ts";
import {
  calculateVerifiedBoq,
  type BoqInputLine,
  type BoqRateComponent,
  type BoqResource,
  type VerifiedBoqInput,
  type VerifiedBoqResult,
} from "./verified-boq.server.ts";

export type VerifiedBoqCause =
  "RAW" | "MAPPING" | "ADJUSTMENT" | "PRICE" | "FORMULA";

export type VerifiedBoqCauseDelta = {
  cause: VerifiedBoqCause;
  amountDeltaKrw: string;
};

export type VerifiedBoqV1_1ComparisonRow = {
  itemCode: string;
  rowState: "added" | "removed" | "changed" | "unchanged";
  causes: VerifiedBoqCauseDelta[];
  previousAmountKrw: string;
  currentAmountKrw: string;
  amountDeltaKrw: string;
};

export type VerifiedBoqV1_1Comparison = {
  status: "comparable" | "review";
  rows: VerifiedBoqV1_1ComparisonRow[];
  amountDeltaKrw: string;
  causeAmountDeltaKrw: string;
  rowAmountDeltaKrw: string;
  amountCloses: boolean;
  message: string;
};

export type ReplayableApprovedBoqState = {
  engineVersion: "VERIFIED-BOQ-1.0" | "VERIFIED-BOQ-1.1";
  status: "approved" | "superseded";
  approvedDecision: { decidedBy: string; createdAt: string };
  input: VerifiedBoqInput | VerifiedBoqV1_1Input;
  result: VerifiedBoqResult | VerifiedBoqV1_1Result;
};

export function verifiedBoqStoredReplayMatches(input: {
  engineVersion: "VERIFIED-BOQ-1.0" | "VERIFIED-BOQ-1.1";
  stored: {
    inputStateSha256: string | null;
    resultSha256: string | null;
    manifestSha256: string | null;
    directCostKrw: string | number | null;
    lineCount: number | null | undefined;
  };
  replayed: {
    inputStateSha256?: string;
    resultSha256: string;
    manifestSha256?: string;
    directCostKrw: string;
    lineCount: number;
  };
}) {
  let directCostMatches = false;
  try {
    directCostMatches =
      input.stored.directCostKrw !== null &&
      compareExact(
        parseExactDecimal(String(input.stored.directCostKrw)),
        parseExactDecimal(input.replayed.directCostKrw),
      ) === 0;
  } catch {
    return false;
  }
  return (
    input.stored.resultSha256 === input.replayed.resultSha256 &&
    directCostMatches &&
    input.stored.lineCount === input.replayed.lineCount &&
    (input.engineVersion === "VERIFIED-BOQ-1.0" ||
      (input.stored.inputStateSha256 === input.replayed.inputStateSha256 &&
        input.stored.manifestSha256 === input.replayed.manifestSha256))
  );
}

type LineModel = BoqInputLine;
type MappingModel = { id: string; itemCode: string; factor: string };
type SourceModel = {
  key: string;
  content: string;
  kind: "legacy" | "drawing";
  legacy?: VerifiedBoqV1_1Input["legacyMappings"][number];
  drawing?: VerifiedBoqV1_1Input["drawingMappings"][number]["source"];
  mappings: MappingModel[];
};
type PriceModel = {
  priceBook: VerifiedBoqV1_1Input["priceBook"];
  resources: VerifiedBoqV1_1Input["resources"];
  components: Array<BoqRateComponent & { itemCode: string }>;
};
type ComparisonModel = {
  declaredEngine: ReplayableApprovedBoqState["engineVersion"];
  versionId: string;
  calculationPolicy: VerifiedBoqInput["calculationPolicy"];
  quantityScale: number;
  lines: Map<string, LineModel>;
  sources: Map<string, SourceModel>;
  exclusions: VerifiedBoqV1_1Input["exclusions"];
  price: PriceModel;
};

const causes: VerifiedBoqCause[] = [
  "RAW",
  "MAPPING",
  "ADJUSTMENT",
  "PRICE",
  "FORMULA",
];

function review(): VerifiedBoqV1_1Comparison {
  return {
    status: "review",
    rows: [],
    amountDeltaKrw: "0",
    causeAmountDeltaKrw: "0",
    rowAmountDeltaKrw: "0",
    amountCloses: false,
    message: "승인 내역 변경 원인을 자동 재현할 수 없습니다.",
  };
}

function canonicalJson(value: unknown) {
  return JSON.stringify(value);
}

function bytewise(left: string, right: string) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function businessMappings(source: SourceModel | undefined) {
  return (source?.mappings ?? [])
    .map(({ itemCode, factor }) => ({ itemCode, factor }))
    .sort(
      (left, right) =>
        bytewise(left.itemCode, right.itemCode) ||
        bytewise(left.factor, right.factor),
    );
}

function equivalentResult(
  expected: VerifiedBoqResult | VerifiedBoqV1_1Result,
  actual: VerifiedBoqResult | VerifiedBoqV1_1Result,
) {
  if (
    expected.directCostKrw !== actual.directCostKrw ||
    expected.status !== actual.status ||
    expected.lines.length !== actual.lines.length
  )
    return false;
  const actualByCode = resultLines(actual);
  return expected.lines.every((line) => {
    const found = actualByCode.get(line.itemCode);
    return (
      found !== undefined &&
      line.status === found.status &&
      line.rawQuantity === found.rawQuantity &&
      line.adjustment === found.adjustment &&
      line.finalQuantity === found.finalQuantity &&
      line.amountKrw === found.amountKrw &&
      line.totalUnitPriceKrw === found.totalUnitPriceKrw &&
      line.formula === found.formula
    );
  });
}

function legacyAdapter(input: VerifiedBoqInput): VerifiedBoqV1_1Input {
  const sourceSha256 = input.mappings[0]?.sourceSha256 ?? "0".repeat(64);
  return {
    ...input,
    engineVersion: "VERIFIED-BOQ-1.1",
    legacyMappings: input.mappings,
    drawingMappings: [],
    priceBook: {
      id: "historical-price-book",
      sourceFileId: "historical-price-file",
      sourceSha256,
      effectiveDate: "1970-01-01",
      rightsBasis: "historical-approved-input",
    },
    resources: input.resources.map((resource) => ({
      ...resource,
      unit: resource.unit?.trim() || "EA",
    })),
  };
}

function replay(state: ReplayableApprovedBoqState) {
  if (
    !["approved", "superseded"].includes(state.status) ||
    !state.approvedDecision?.decidedBy?.trim() ||
    !state.approvedDecision?.createdAt?.trim()
  )
    throw new Error("unapproved state");
  if (state.engineVersion === "VERIFIED-BOQ-1.0") {
    const input = state.input as VerifiedBoqInput;
    const replayed = calculateVerifiedBoq(input);
    if (
      state.result.engineVersion !== "VERIFIED-BOQ-1.0" ||
      canonicalJson(replayed) !== canonicalJson(state.result)
    )
      throw new Error("tampered 1.0 state");
    const adapted = canonicalizeVerifiedBoqV1_1Input(legacyAdapter(input));
    if (!equivalentResult(replayed, calculateVerifiedBoqV1_1(adapted)))
      throw new Error("unreplayable 1.0 adapter");
    return { input: adapted, result: replayed };
  }
  if (state.engineVersion !== "VERIFIED-BOQ-1.1")
    throw new Error("missing engine");
  const input = canonicalizeVerifiedBoqV1_1Input(
    state.input as VerifiedBoqV1_1Input,
  );
  const replayed = calculateVerifiedBoqV1_1(input);
  if (
    state.result.engineVersion !== "VERIFIED-BOQ-1.1" ||
    canonicalJson(replayed) !== canonicalJson(state.result)
  )
    throw new Error("tampered 1.1 state");
  return { input, result: replayed };
}

function comparisonModel(
  declaredEngine: ReplayableApprovedBoqState["engineVersion"],
  input: VerifiedBoqV1_1Input,
): ComparisonModel {
  const lines = new Map(input.lines.map((line) => [line.itemCode, line]));
  if (lines.size !== input.lines.length) throw new Error("ambiguous row");
  const lineCode = (lineId: string) => {
    const line = input.lines.find((candidate) => candidate.id === lineId);
    if (!line) throw new Error("missing row");
    return line.itemCode;
  };
  const sources = new Map<string, SourceModel>();
  for (const mapping of input.legacyMappings) {
    const key = `legacy:${verifiedBoqLegacySourceId(mapping)}`;
    const content = canonicalJson({
      sourceFileId: mapping.sourceFileId,
      sourceSha256: mapping.sourceSha256,
      subjectKey: mapping.subjectKey,
      sourceQuantity: mapping.sourceQuantity,
      unit: mapping.unit,
      elementIds: mapping.elementIds,
    });
    const source = sources.get(key) ?? {
      key,
      content,
      kind: "legacy" as const,
      legacy: mapping,
      mappings: [],
    };
    if (source.content !== content) throw new Error("ambiguous legacy source");
    source.mappings.push({
      id: mapping.id,
      itemCode: lineCode(mapping.lineId),
      factor: mapping.factor,
    });
    sources.set(key, source);
  }
  for (const mapping of input.drawingMappings) {
    const sourceValue = mapping.source;
    const key = `drawing:${sourceValue.lineageId}\u001f${sourceValue.measurementKind}\u001f${sourceValue.unit}`;
    const { quantityLinkId: _quantityLinkId, ...drawingEvidence } = sourceValue;
    const content = canonicalJson(drawingEvidence);
    const source = sources.get(key) ?? {
      key,
      content,
      kind: "drawing" as const,
      drawing: sourceValue,
      mappings: [],
    };
    if (source.content !== content) throw new Error("ambiguous drawing source");
    source.mappings.push({
      id: mapping.id,
      itemCode: lineCode(mapping.lineId),
      factor: mapping.allocationFactor,
    });
    sources.set(key, source);
  }
  const resources = new Map(input.resources.map((row) => [row.id, row]));
  return {
    declaredEngine,
    versionId: input.versionId,
    calculationPolicy: input.calculationPolicy,
    quantityScale: input.quantityScale,
    lines,
    sources,
    exclusions: input.exclusions ?? [],
    price: {
      priceBook: input.priceBook,
      resources: input.resources,
      components: input.components.map((component) => ({
        ...component,
        itemCode: lineCode(component.lineId),
        resourceId:
          resources.get(component.resourceId)?.id ??
          (() => {
            throw new Error("missing resource");
          })(),
      })),
    },
  };
}

function copySources(
  sourceContent: Map<string, SourceModel>,
  mappings: Map<string, SourceModel>,
) {
  return new Map(
    [...sourceContent].map(([key, source]) => {
      const prior = mappings.get(key);
      return [
        key,
        {
          ...source,
          mappings: structuredClone(prior?.mappings ?? []),
        },
      ];
    }),
  );
}

function stageInput(model: ComparisonModel): VerifiedBoqV1_1Input {
  const requiredCodes = new Set(
    [...model.sources.values()].flatMap((source) =>
      source.mappings.map((mapping) => mapping.itemCode),
    ),
  );
  const lines = [...model.lines.values()].filter((line) =>
    requiredCodes.has(line.itemCode),
  );
  if (lines.length !== requiredCodes.size) throw new Error("missing line");
  const lineIds = new Map(lines.map((line) => [line.itemCode, line.id]));
  const resources = new Map(
    model.price.resources.map((resource) => [resource.id, resource]),
  );
  return {
    engineVersion: "VERIFIED-BOQ-1.1",
    versionId: model.versionId,
    calculationPolicy: model.calculationPolicy,
    quantityScale: model.quantityScale,
    lines,
    legacyMappings: [...model.sources.values()].flatMap((source) =>
      source.kind === "legacy"
        ? source.mappings.map((mapping) => ({
            ...source.legacy!,
            id: mapping.id,
            lineId: lineIds.get(mapping.itemCode)!,
            factor: mapping.factor,
          }))
        : [],
    ),
    drawingMappings: [...model.sources.values()].flatMap((source) =>
      source.kind === "drawing"
        ? source.mappings.map((mapping) => ({
            id: mapping.id,
            lineId: lineIds.get(mapping.itemCode)!,
            quantityLinkId: source.drawing!.quantityLinkId,
            allocationFactor: mapping.factor,
            source: source.drawing!,
          }))
        : [],
    ),
    priceBook: model.price.priceBook,
    exclusions: model.exclusions,
    resources: model.price.resources,
    components: model.price.components
      .filter(
        (component) =>
          lineIds.has(component.itemCode) &&
          resources.has(component.resourceId),
      )
      .map(({ itemCode, ...component }) => ({
        ...component,
        lineId: lineIds.get(itemCode)!,
      })),
  };
}

function resultLines(result: VerifiedBoqResult | VerifiedBoqV1_1Result) {
  const rows = new Map<string, (typeof result.lines)[number]>();
  for (const row of result.lines) {
    if (rows.has(row.itemCode)) throw new Error("ambiguous result row");
    rows.set(row.itemCode, row);
  }
  return rows;
}

function rowAmount(
  rows: Map<string, VerifiedBoqResult["lines"][number]>,
  code: string,
) {
  return parseExactDecimal(rows.get(code)?.amountKrw ?? "0");
}

function changedSourceRows(
  previous: ComparisonModel,
  current: ComparisonModel,
) {
  const raw = new Set<string>();
  const mapping = new Set<string>();
  for (const key of new Set([
    ...previous.sources.keys(),
    ...current.sources.keys(),
  ])) {
    const left = previous.sources.get(key);
    const right = current.sources.get(key);
    const rows = [...(left?.mappings ?? []), ...(right?.mappings ?? [])].map(
      (item) => item.itemCode,
    );
    if (!left || !right || left.content !== right.content)
      rows.forEach((row) => raw.add(row));
    if (
      canonicalJson(businessMappings(left)) !==
      canonicalJson(businessMappings(right))
    )
      rows.forEach((row) => mapping.add(row));
  }
  return { raw, mapping };
}

function visibleCauses(previous: ComparisonModel, current: ComparisonModel) {
  const sourceRows = changedSourceRows(previous, current);
  const adjustment = new Set<string>();
  for (const code of new Set([
    ...previous.lines.keys(),
    ...current.lines.keys(),
  ])) {
    const left = previous.lines.get(code);
    const right = current.lines.get(code);
    if (
      left?.signedAdjustment !== right?.signedAdjustment ||
      left?.adjustmentReason !== right?.adjustmentReason
    )
      adjustment.add(code);
  }
  const allRows = new Set([...previous.lines.keys(), ...current.lines.keys()]);
  const price = priceCauseRows(previous, current, allRows);
  const formulaChanged =
    previous.declaredEngine !== current.declaredEngine ||
    previous.calculationPolicy !== current.calculationPolicy ||
    previous.quantityScale !== current.quantityScale;
  return new Map<VerifiedBoqCause, Set<string>>([
    ["RAW", sourceRows.raw],
    ["MAPPING", sourceRows.mapping],
    ["ADJUSTMENT", adjustment],
    ["PRICE", price],
    ["FORMULA", formulaChanged ? allRows : new Set()],
  ]);
}

function priceCauseRows(
  previous: ComparisonModel,
  current: ComparisonModel,
  allRows: Set<string>,
) {
  const affected = new Set<string>();
  const priceBook = (model: ComparisonModel) => ({
    sourceSha256: model.price.priceBook.sourceSha256,
    effectiveDate: model.price.priceBook.effectiveDate,
    rightsBasis: model.price.priceBook.rightsBasis,
  });
  if (
    previous.declaredEngine !== "VERIFIED-BOQ-1.0" &&
    canonicalJson(priceBook(previous)) !== canonicalJson(priceBook(current))
  )
    allRows.forEach((code) => affected.add(code));

  const resourceBusiness = (model: ComparisonModel) =>
    new Map(
      model.price.resources.map((resource) => [
        resource.code,
        canonicalJson({
          type: resource.type,
          unit: resource.unit,
          unitPriceKrw: resource.unitPriceKrw,
        }),
      ]),
    );
  const leftResources = resourceBusiness(previous);
  const rightResources = resourceBusiness(current);
  const changedResourceCodes = new Set(
    [...new Set([...leftResources.keys(), ...rightResources.keys()])].filter(
      (code) => leftResources.get(code) !== rightResources.get(code),
    ),
  );
  const componentBusiness = (model: ComparisonModel) => {
    const resourceCodes = new Map(
      model.price.resources.map((resource) => [resource.id, resource.code]),
    );
    const rows = new Map<
      string,
      Array<{ resourceCode: string; coefficient: string }>
    >();
    for (const component of model.price.components) {
      const resourceCode = resourceCodes.get(component.resourceId);
      if (!resourceCode) throw new Error("missing component resource");
      const values = rows.get(component.itemCode) ?? [];
      values.push({ resourceCode, coefficient: component.coefficient });
      rows.set(component.itemCode, values);
      if (changedResourceCodes.has(resourceCode))
        affected.add(component.itemCode);
    }
    return new Map(
      [...rows].map(([code, values]) => [
        code,
        canonicalJson(
          values.sort(
            (left, right) =>
              bytewise(left.resourceCode, right.resourceCode) ||
              bytewise(left.coefficient, right.coefficient),
          ),
        ),
      ]),
    );
  };
  const leftComponents = componentBusiness(previous);
  const rightComponents = componentBusiness(current);
  for (const code of new Set([
    ...leftComponents.keys(),
    ...rightComponents.keys(),
  ]))
    if (leftComponents.get(code) !== rightComponents.get(code))
      affected.add(code);
  return affected;
}

function priceWithNewRows(
  previous: ComparisonModel,
  current: ComparisonModel,
): PriceModel {
  const priorCodes = new Set(previous.lines.keys());
  const currentResources = new Map(
    current.price.resources.map((resource) => [resource.id, resource]),
  );
  const addedComponents = current.price.components
    .filter((component) => !priorCodes.has(component.itemCode))
    .map((component) => ({
      ...component,
      resourceId: `${component.resourceId}:comparison-added:${component.itemCode}`,
    }));
  const components = [...previous.price.components, ...addedComponents];
  const resources = new Map(
    previous.price.resources.map((resource) => [resource.id, resource]),
  );
  for (const component of addedComponents) {
    const originalId = component.resourceId.split(":comparison-added:")[0];
    const resource = currentResources.get(originalId);
    if (!resource) throw new Error("missing added-row resource");
    resources.set(component.resourceId, {
      ...resource,
      id: component.resourceId,
      code: `${resource.code}:comparison-added:${component.itemCode}`,
      unitPriceKrw: "0",
    });
  }
  return {
    priceBook: previous.price.priceBook,
    resources: [...resources.values()],
    components,
  };
}

export function compareVerifiedBoqApprovedStates(
  previous: ReplayableApprovedBoqState,
  current: ReplayableApprovedBoqState,
): VerifiedBoqV1_1Comparison {
  try {
    const previousReplay = replay(previous);
    const currentReplay = replay(current);
    if (
      canonicalJson(previousReplay.input) === canonicalJson(currentReplay.input)
    ) {
      const rows = previousReplay.result.lines
        .map((line) => ({
          itemCode: line.itemCode,
          rowState: "unchanged" as const,
          causes: [],
          previousAmountKrw: line.amountKrw ?? "0",
          currentAmountKrw: line.amountKrw ?? "0",
          amountDeltaKrw: "0",
        }))
        .sort((left, right) => bytewise(left.itemCode, right.itemCode));
      return {
        status: "comparable",
        rows,
        amountDeltaKrw: "0",
        causeAmountDeltaKrw: "0",
        rowAmountDeltaKrw: "0",
        amountCloses: true,
        message:
          "다섯 원인과 행별 증감이 전체 직접공사비 증감에 정확히 일치합니다.",
      };
    }
    const left = comparisonModel(previous.engineVersion, previousReplay.input);
    const right = comparisonModel(current.engineVersion, currentReplay.input);
    const visible = visibleCauses(left, right);
    const earlyPrice = priceWithNewRows(left, right);
    const stages: ComparisonModel[] = [left];
    stages.push({
      ...left,
      versionId: right.versionId,
      lines: new Map([...right.lines, ...left.lines]),
      sources: copySources(right.sources, left.sources),
      exclusions: right.exclusions,
      price: earlyPrice,
    });
    stages.push({
      ...stages[1],
      sources: copySources(right.sources, right.sources),
    });
    stages.push({
      ...stages[2],
      lines: new Map(
        [...stages[2].lines].map(([code, line]) => {
          const next = right.lines.get(code);
          return [
            code,
            next
              ? {
                  ...line,
                  signedAdjustment: next.signedAdjustment,
                  adjustmentReason: next.adjustmentReason,
                }
              : line,
          ];
        }),
      ),
    });
    stages.push({ ...stages[3], price: right.price });
    stages.push({
      ...stages[4],
      declaredEngine: right.declaredEngine,
      calculationPolicy: right.calculationPolicy,
      quantityScale: right.quantityScale,
      lines: right.lines,
    });

    const results = stages.map((stage) =>
      calculateVerifiedBoqV1_1(stageInput(stage)),
    );
    if (
      !equivalentResult(previousReplay.result, results[0]) ||
      !equivalentResult(currentReplay.result, results.at(-1)!)
    )
      return review();

    const codes = [
      ...new Set(
        results.flatMap((result) => result.lines.map((line) => line.itemCode)),
      ),
    ].sort(bytewise);
    const rowsByStage = results.map(resultLines);
    let causeTotal = exactZero;
    const rows = codes.map((itemCode) => {
      const rowCauses: VerifiedBoqCauseDelta[] = [];
      for (let index = 0; index < causes.length; index += 1) {
        const amount = subtractExact(
          rowAmount(rowsByStage[index + 1], itemCode),
          rowAmount(rowsByStage[index], itemCode),
        );
        if (
          visible.get(causes[index])?.has(itemCode) ||
          compareExact(amount, exactZero) !== 0
        )
          rowCauses.push({
            cause: causes[index],
            amountDeltaKrw: exactToString(amount),
          });
        causeTotal = addExact(causeTotal, amount);
      }
      const previousAmount = rowAmount(rowsByStage[0], itemCode);
      const currentAmount = rowAmount(rowsByStage.at(-1)!, itemCode);
      const delta = subtractExact(currentAmount, previousAmount);
      const existed = rowsByStage[0].has(itemCode);
      const exists = rowsByStage.at(-1)!.has(itemCode);
      return {
        itemCode,
        rowState: !existed
          ? ("added" as const)
          : !exists
            ? ("removed" as const)
            : compareExact(delta, exactZero) !== 0 || rowCauses.length
              ? ("changed" as const)
              : ("unchanged" as const),
        causes: rowCauses,
        previousAmountKrw: exactToString(previousAmount),
        currentAmountKrw: exactToString(currentAmount),
        amountDeltaKrw: exactToString(delta),
      };
    });
    const amountDelta = subtractExact(
      parseExactDecimal(results.at(-1)!.directCostKrw),
      parseExactDecimal(results[0].directCostKrw),
    );
    const rowTotal = rows.reduce(
      (sum, row) => addExact(sum, parseExactDecimal(row.amountDeltaKrw)),
      exactZero,
    );
    const closes =
      compareExact(amountDelta, rowTotal) === 0 &&
      compareExact(amountDelta, causeTotal) === 0;
    if (!closes) return review();
    return {
      status: "comparable",
      rows,
      amountDeltaKrw: exactToString(amountDelta),
      causeAmountDeltaKrw: exactToString(causeTotal),
      rowAmountDeltaKrw: exactToString(rowTotal),
      amountCloses: true,
      message:
        "다섯 원인과 행별 증감이 전체 직접공사비 증감에 정확히 일치합니다.",
    };
  } catch {
    return review();
  }
}
