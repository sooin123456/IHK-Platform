# Lifecycle and restore verification artifacts

These artifacts concern the exact four-file dirty-baseline delta, not the entire branch or overall R2/R4/R5 completion.

- `workspace.diff`, `preview.diff`, `shell-test.diff`, `acceptance-test.diff`: generated comparisons against pre-task copies, not HEAD.
- `source-hashes.json`: baseline, current and owned-runtime SHA-256 for each source file.
- `lifecycle-red.log`: initial actual-browser stale-status reproduction.
- `lifecycle-generation-red.log`: returning A while B's provider remains pending revives A's old connected phase under the first identity-only fix.
- `lifecycle-generation-green.log`: generation-aware fix passes both the new delayed replacement check and existing local-edit/revalidation/actor-reset/read-only check.
- `final-focused.log`: final production dependency fix passes those two checks; the additional compact split-view test fails on its pre-existing missing PDF request.
- `workspace-regression.log`: 159 Node runtime/shell/realtime/structure/collaboration checks pass with no skips.
- `typecheck-final.log`: successful application typecheck before final dependency-only addition; subsequent copied M1 prebuild reruns full typegen/typecheck on final source.
- `shell-baseline.log`, `shell-final.log`: failing full preview suite is preserved, not suppressed or claimed green.
- `compact-http-*.log`: independent HTTP response capture proves the missing fake PDF 500 on both pre-task and changed source.

`m1-authenticated-attempt5.log` is the final exit-0 runner: 23/23 Chromium scenarios and the real database gates pass. `m1-authenticated.log` and attempts 2–4 retain initial environment/test preparation failures separately. `native-publish.log` records the owned fresh .NET build; `native-dwg-export-jobs.json` and `native-dwg-native-report.json` retain actual source-free publication/download and experimental-native evidence. `native-viewer-live-evidence.json` is the final Viewer browser capture, not a correlation of every server authorization log.

Email delivery, disconnected shell navigation, independent recipient CAD acceptance and the imported-DWG resave job workflow are not established by these checks. Inline JSON attachments from the estimator/offline assertions are not retained by the line-only successful-test reporter; those contracts are evidenced by the exact frozen test code and successful execution, not claimed as separately saved raw snapshots.
