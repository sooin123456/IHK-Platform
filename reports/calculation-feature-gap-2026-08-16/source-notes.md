# Lukas QTO calculation and workflow gap — source notes

Snapshot date: 2026-08-16 (Asia/Seoul)

## Local implementation evidence

- `src/Lukas.Qto.Core/ConcreteTakeoff.cs`: signed deductions, allowance basis, deduction timing, rounding policy and status aggregation.
- `src/Lukas.Qto.Core/TakeoffReport.cs`: concrete report parsing, manifest binding and semantic verification.
- `platform/app/lukas/lib/concrete-takeoff-artifact.server.ts`: server-side verification before a concrete result can be stored as an artifact.
- `platform/app/lukas/lib/element-ledger-suggestions.server.ts`: stable Revit Element ID comparison and deterministic revision review.
- `platform/app/lukas/screens/project.tsx`: human review surface for rule-generated suggestions.
- `platform/tests/element-ledger-suggestions.test.mjs` and `tests/Lukas.Qto.Core.SelfTest/Program.cs`: regression evidence for exact decimals, source binding and fail-closed behavior.

## Official competitor evidence

- Autodesk Takeoff sheet and quantity comparison: https://help.autodesk.com/cloudhelp/ENU/Takeoff-Files/files/Compare_Sheets.html
  - Side-by-side or overlay comparison, quantity increases/decreases and a calculated Diff column.
- Kreo Formula Property: https://help-takeoff.kreo.net/en/articles/6204588-how-to-create-the-formula-property
  - Formula properties can use measured area, perimeter, length and other properties as inputs.
- RIB CostX Auto-Revisioning: https://www.rib-software.com/en/blogs/rib-costx-auto-drawing-revisioning
  - Revised drawings are overlaid, dimensions are matched and comparison reports summarize variances and totals.
- Bluebeam custom cost columns: https://support.bluebeam.com/revu/how-to/tips-and-tricks/calculate-costs-with-custom-columns-in-markups-list.html
  - User-defined formula columns calculate material cost from measurement and material variables.

## Interpretation boundaries

- Competitor pages establish product patterns, not permission to copy proprietary implementations or hidden formulas.
- Lukas does not add a free-form formula runtime in this change. Its approved deterministic rule bundles remain the authority for final quantities.
- Revision quantity impact is calculated only from comparable immutable element-ledger values. A missing value is reported as not evaluated and is never imputed as zero.
- Local tests prove deterministic code behavior, not Windows/Revit field usability or product-market fit.

