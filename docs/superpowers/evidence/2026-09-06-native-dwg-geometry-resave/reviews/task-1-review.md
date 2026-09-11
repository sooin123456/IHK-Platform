# Task1 review — spec + quality

Reviewer /root/dwg_geometry_compiler_review sol/high. Verdict Needs fixes. No Critical/Minor.

Important: selected-edits.server.ts297–314 does not revalidate compiled native polyline distinctness. Projected {x:0} and {x:Number.MIN_VALUE} differ, but centimeter division by10 collapses both to nativezero. Must validate compiled pointarray and add regression. Exact v2wire contract violation; no planconflict.

Strengths: exact five-type v2records, nativeunit/rawprecision, TEXT-onlyfontSize, nonmoduloArc, completeobjects/metadata/resultflags, bounds and quotas.

Cannotverify: nativeconsumer v1/preservation, realcrossruntime, auth/approval/artifactdelivery. These are separateTask2/3 or unchanged fullgoal gates. Report61/61/typesconsistent; not rerun.

Focused unchanged checks: drawing-workspace.types polyline/Arc validation; native-import.server raw reportvalidation; drawing-geometry boundshelper. Read selectedtest snapshot tail530–551 to complete diffcut hunk. No writes/gitmutation.
