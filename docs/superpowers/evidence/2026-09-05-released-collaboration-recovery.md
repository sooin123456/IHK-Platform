# Released collaboration recovery — local verification

Status: implemented, independently reviewed and locally verified. The full Universal Workspace/DWG goal remains active. No operating deployment or customer acceptance trial occurred.

## Failure and repair

The actual SQL adapter returned `released` with a null request ID after its lease row was removed. A fresh production recovery coordinator requires that request identity and rejects the inconsistent result. The regression reproduced `actual:null` before the fix.

The new `20260905131704_drawing_released_freeze_recovery.sql` migration replaces only the current private function's request-ID fallback: use a current lease ID first, otherwise the stored released ID. Existing freezing/frozen state priority, expiry/takeover rules,14-column return contract, function OID/owner/ACL, empty search_path and security-definer behavior remain unchanged. No historical migration or collaboration TypeScript implementation changed.

The actual database test loads persisted Yjs bytes into a new document and creates a fresh production coordinator. Recovery preserves the release request, operation envelopes/order, encoded Yjs bytes and canonical snapshot; no lease is left behind. This directly tests the recovery boundary, not a fake readFreeze response. It is not a claim that an operating server was restarted or a real customer's reconnect was tested.

## Verified cases

| Stored state and lease | Required result |
|---|---|
| Released A, no lease | released/A and successful fresh-coordinator recovery |
| Released A, new preparation B | freezing/B |
| Cancel preparation B | released/A |
| Active preparation cancelled | active/null |
| Expired preparation | remains fenced; only lawful takeover/cancellation succeeds |
| Frozen/committed review | matching frozen request and immutable manifest remain |
| Anonymous/authenticated/service_role direct call |42501 denied; collaboration role retains execute |

Wrong-owner acquisition, renewal and cancellation remain rejected. The test uses a controlled timestamp only on its isolated test lease; no production expiry shortcut exists.

## Final evidence

- Actual database RED0/1 → GREEN1/1, zero skips. Root's fresh final run also passed1/1.
- Root freeze/native-collaboration regression31/31, zero skips.
- Independent spec and quality review: approved; no Critical/Important issue in the two-file unit.
- Full M1: application and collaboration builds passed; three database gates5 passed with2 expected configuration-guard skips; all23 Chromium stories passed in2.8minutes. This includes upload-free entry, native templates/symbols, measurable-consumer hydration, live Viewer reflection, review/approval, PDF audit and authority/lineage checks.
- Supabase CLI2.114.0 security advisors ran against the guarded, live disposable local M1 database: exit0, zero ERROR/WARN findings,8 INFO `rls_enabled_no_policy` findings retained. They concern existing private service data and RPC-backed jobs/share tables; no policies were added merely to silence the linter. This is not a complete security certification. Function-security guidance was checked against [Supabase's documentation](https://supabase.com/docs/guides/database/functions).
- Six integration source hashes matched after the full run. Scoped diff whitespace check passed. Owned disposable services were cleaned up.
- Local4173 simulated preview restarted and checked:HTTP200,3canvas elements,zero collected console/page errors and no error overlay. This preview does not exercise authenticated recovery.

[Machine verification](./2026-09-05-released-collaboration-recovery/verification.json), [native regression graph/approval evidence](./2026-09-05-released-collaboration-recovery/native-catalog-persistence.json), [actual regression PDF](./2026-09-05-released-collaboration-recovery/native-measured-plan-a3.pdf).

Private unit evidence retains RED/GREEN details, original dirty snapshots, scoped review diff, full M1 log and unfiltered advisor output. Existing unsigned theme-preference, build chunk/color and intentional protected-state rejection logs remain. Native editor evidence retains loader GET cancellation events; the other three contexts have no collected request failures. No warning-free/network-cancellation-free claim is made.

## Remaining goal

The native-catalog unit remains implemented; this closes its separate inherited released-room recovery bug. Editable output/unit controls and native DWG generation/edit/re-save/delivery remain required. ACadSharp's existing synthetic experiment is not production qualification; licensed customer files, independent recipient CAD/print checks and actual recipient acceptance remain unverified.
