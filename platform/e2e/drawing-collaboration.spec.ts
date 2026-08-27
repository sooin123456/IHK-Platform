import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  authenticateApiClient,
  authenticateContext,
  createDrawingFixture,
  destroyDrawingFixture,
  type DrawingFixture,
} from "./utils/drawing-collaboration-fixture";

test.describe.serial("1HK drawing collaboration", () => {
  let fixture: DrawingFixture;
  const baseUrl = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4000";

  test.beforeAll(async () => {
    fixture = await createDrawingFixture();
  });

  test.afterAll(async () => {
    await destroyDrawingFixture(fixture);
  });

  test("maker requests review and a separate reviewer approves it in realtime", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}`;
    const ownerContext = await browser.newContext();
    const reviewerContext = await browser.newContext();
    const ownerPage = await authenticateContext(
      fixture,
      ownerContext,
      fixture.owner,
      baseUrl,
      path,
    );

    await expect(ownerPage.getByTestId("pdf-canvas")).toBeVisible();
    await ownerPage.getByRole("button", { name: "영역 지정" }).click();
    const canvas = ownerPage.getByTestId("pdf-canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("PDF canvas has no layout box");
    await ownerPage.mouse.move(
      box.x + box.width * 0.2,
      box.y + box.height * 0.2,
    );
    await ownerPage.mouse.down();
    await ownerPage.mouse.move(
      box.x + box.width * 0.55,
      box.y + box.height * 0.45,
    );
    await ownerPage.mouse.up();
    await expect(ownerPage.getByText("1쪽 영역을 선택했습니다.")).toBeVisible();

    await ownerPage.getByLabel("이슈 제목").fill("창호 치수 확인 E2E");
    await ownerPage.getByLabel("기한").first().fill("2099-12-31");
    await ownerPage.getByLabel("담당자").selectOption(fixture.reviewer.id);
    await ownerPage.getByRole("button", { name: "이슈 만들기" }).click();
    await ownerPage.getByRole("button", { name: /창호 치수 확인 E2E/ }).click();
    await ownerPage
      .getByRole("button", { name: "선택한 도면 근거 연결" })
      .click();
    await expect(ownerPage.getByText("PDF 영역 근거")).toBeVisible();
    const ownerApi = await authenticateApiClient(fixture, fixture.owner);
    const { data: createdIssue, error: createdIssueError } = await ownerApi
      .from("lukas_drawing_issues")
      .select("id")
      .eq("project_id", fixture.projectId)
      .eq("title", "창호 치수 확인 E2E")
      .single();
    if (createdIssueError || !createdIssue)
      throw createdIssueError ?? new Error("Created issue was not persisted");
    const { data: previousAnchor, error: previousAnchorError } = await ownerApi
      .from("lukas_drawing_issue_anchors")
      .select("id")
      .eq("issue_id", createdIssue.id)
      .eq("active", true)
      .single();
    if (previousAnchorError || !previousAnchor)
      throw (
        previousAnchorError ?? new Error("Previous anchor was not persisted")
      );
    await expect(ownerPage.locator('input[id^="due-"]')).toHaveValue(
      "2099-12-31",
    );
    await ownerPage.getByLabel("상태").selectOption("in_progress");
    await ownerPage.getByRole("button", { name: /저장/ }).first().click();
    await ownerPage.getByLabel("상태").selectOption("resolution_requested");
    await ownerPage.getByRole("button", { name: /저장/ }).first().click();
    await expect(
      ownerPage.getByText("다른 검토자가 승인 또는 반려해야 합니다"),
    ).toBeVisible();
    await ownerPage.goto(
      `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.revisedPdfFileId}`,
    );
    await expect(ownerPage.getByText("개정 도면 재검토 1건")).toBeVisible();
    await expect(
      ownerPage.getByText(
        "PDF 좌표는 자동 복사하지 않습니다. 새 도면에서 영역을 다시 선택하세요.",
      ),
    ).toBeVisible();
    await ownerPage.getByRole("button", { name: /창호 치수 확인 E2E/ }).click();
    const revisedCanvas = ownerPage.getByTestId("pdf-canvas");
    const selectRevisedRegion = async () => {
      await ownerPage.getByRole("button", { name: "영역 지정" }).click();
      const revisedBox = await revisedCanvas.boundingBox();
      if (!revisedBox) throw new Error("Revised PDF canvas has no layout box");
      await ownerPage.mouse.move(
        revisedBox.x + revisedBox.width * 0.3,
        revisedBox.y + revisedBox.height * 0.25,
      );
      await ownerPage.mouse.down();
      await ownerPage.mouse.move(
        revisedBox.x + revisedBox.width * 0.65,
        revisedBox.y + revisedBox.height * 0.55,
      );
      await ownerPage.mouse.up();
    };
    await selectRevisedRegion();
    await expect(
      ownerPage.getByText(/개정 검토 후보를 먼저 선택하세요/),
    ).toBeVisible();
    await expect(
      ownerPage.locator('input[name="intent"][value="add_anchor"]'),
    ).toHaveCount(0);
    await expect(
      ownerPage.locator('input[name="intent"][value="deactivate_anchor"]'),
    ).toHaveCount(0);

    const roomUrl = `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.revisedPdfFileId}`;
    const crossRouteUrl = `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}`;
    const bypassAnchor = JSON.stringify({
      kind: "pdf_region",
      fileId: fixture.revisedPdfFileId,
      pageNumber: 1,
      x: 0.2,
      y: 0.2,
      width: 0.2,
      height: 0.2,
      label: "분리 요청 우회",
    });
    const bypassAdd = await ownerPage.request.post(crossRouteUrl, {
      form: {
        intent: "add_anchor",
        issue_id: createdIssue.id,
        anchor_json: bypassAnchor,
      },
    });
    expect(bypassAdd.status()).toBe(400);
    const bypassDeactivate = await ownerPage.request.post(crossRouteUrl, {
      form: {
        intent: "deactivate_anchor",
        anchor_id: previousAnchor.id,
        note: "분리 요청 우회",
      },
    });
    expect(bypassDeactivate.status()).toBe(400);
    const { error: directInsertError } = await ownerApi
      .from("lukas_drawing_issue_anchors")
      .insert({
        id: crypto.randomUUID(),
        issue_id: createdIssue.id,
        project_id: fixture.projectId,
        file_id: fixture.revisedPdfFileId,
        anchor_kind: "pdf_region",
        element_id: null,
        ifc_global_id: null,
        camera_json: null,
        page_number: 1,
        x: 0.2,
        y: 0.2,
        width: 0.2,
        height: 0.2,
        label: "직접 Data API 우회",
        active: true,
        created_by: fixture.owner.id,
        replaces_anchor_id: null,
      });
    expect(directInsertError?.message).toMatch(/atomic relink function/i);
    const { error: directUpdateError } = await ownerApi
      .from("lukas_drawing_issue_anchors")
      .update({ active: false, deactivation_note: "직접 Data API 우회" })
      .eq("id", previousAnchor.id);
    expect(directUpdateError?.message).toMatch(/atomic relink function/i);
    const failedRelink = await ownerPage.request.post(roomUrl, {
      form: {
        intent: "relink_anchor",
        previous_anchor_id: previousAnchor.id,
        new_anchor_id: crypto.randomUUID(),
        current_file_id: fixture.revisedPdfFileId,
        anchor_json: JSON.stringify({
          ...JSON.parse(bypassAnchor),
          fileId: fixture.pdfFileId,
        }),
        note: "파일 불일치 롤백 확인",
      },
    });
    expect(failedRelink.status()).toBe(400);
    const { data: anchorsAfterFailure, error: anchorsAfterFailureError } =
      await ownerApi
        .from("lukas_drawing_issue_anchors")
        .select("id,active,replaces_anchor_id")
        .eq("issue_id", createdIssue.id);
    if (anchorsAfterFailureError) throw anchorsAfterFailureError;
    expect(anchorsAfterFailure).toEqual([
      expect.objectContaining({
        id: previousAnchor.id,
        active: true,
        replaces_anchor_id: null,
      }),
    ]);

    const viewerRevisionContext = await browser.newContext();
    const viewerRevisionPage = await authenticateContext(
      fixture,
      viewerRevisionContext,
      fixture.viewer,
      baseUrl,
      `/projects/${fixture.projectId}/drawings/${fixture.revisedPdfFileId}`,
    );
    await expect(
      viewerRevisionPage.getByText("개정 도면 재검토 1건"),
    ).toBeVisible();
    await expect(
      viewerRevisionPage.getByRole("button", {
        name: "원자적으로 근거 교체 확인",
      }),
    ).toHaveCount(0);
    await expect(
      viewerRevisionPage.locator(
        'input[name="intent"][value="add_anchor"], input[name="intent"][value="deactivate_anchor"]',
      ),
    ).toHaveCount(0);
    await viewerRevisionContext.close();

    await ownerPage.getByRole("button", { name: "후보 검토" }).click();
    await expect(
      ownerPage.getByRole("button", { name: "검토 중인 후보" }),
    ).toBeVisible();
    await expect(
      ownerPage.locator(
        'input[name="intent"][value="add_anchor"], input[name="intent"][value="deactivate_anchor"]',
      ),
    ).toHaveCount(0);
    await selectRevisedRegion();
    await expect(
      ownerPage.getByRole("form", { name: "개정 근거 원자적 교체" }),
    ).toBeVisible();
    await expect(
      ownerPage.locator(
        'input[name="intent"][value="add_anchor"], input[name="intent"][value="deactivate_anchor"]',
      ),
    ).toHaveCount(0);
    await ownerPage
      .getByLabel("교체 검토 메모")
      .fill("개정본에서 새 영역을 직접 확인함");
    let atomicRelinkPosts = 0;
    ownerPage.on("request", (request) => {
      if (
        request.method() === "POST" &&
        request.postData()?.includes("relink_anchor")
      )
        atomicRelinkPosts += 1;
    });
    await ownerPage
      .getByRole("button", { name: "원자적으로 근거 교체 확인" })
      .click();
    await expect(
      ownerPage.getByText(/두 변경은 한 번의 원자적 작업/),
    ).toBeVisible();
    expect(atomicRelinkPosts).toBe(1);

    const { data: relinkedAnchors, error: relinkedAnchorsError } =
      await ownerApi
        .from("lukas_drawing_issue_anchors")
        .select("id,file_id,active,replaces_anchor_id")
        .eq("issue_id", createdIssue.id);
    if (relinkedAnchorsError) throw relinkedAnchorsError;
    expect(relinkedAnchors).toHaveLength(2);
    expect(relinkedAnchors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: previousAnchor.id,
          file_id: fixture.pdfFileId,
          active: false,
          replaces_anchor_id: null,
        }),
        expect.objectContaining({
          file_id: fixture.revisedPdfFileId,
          active: true,
          replaces_anchor_id: previousAnchor.id,
        }),
      ]),
    );
    for (const [fileId, storagePath] of [
      [fixture.pdfFileId, fixture.storagePaths[0]],
      [fixture.revisedPdfFileId, fixture.storagePaths[2]],
    ] as const) {
      const { data: sourceBlob, error: sourceError } =
        await fixture.admin.storage.from("lukas-qto").download(storagePath);
      if (sourceError || !sourceBlob)
        throw sourceError ?? new Error("Source bytes are unavailable");
      const sourceBytes = Buffer.from(await sourceBlob.arrayBuffer());
      expect(createHash("sha256").update(sourceBytes).digest("hex")).toBe(
        fixture.sourceEvidence[fileId].storageByteSha256,
      );
    }

    const reviewerPage = await authenticateContext(
      fixture,
      reviewerContext,
      fixture.reviewer,
      baseUrl,
      path,
    );
    await reviewerPage.goto(`${baseUrl}/notifications`);
    await expect(reviewerPage.getByText("창호 치수 확인 E2E")).toBeVisible();
    await expect(reviewerPage.getByText(/안 읽음 [1-9]/)).toBeVisible();
    const unreadButtons = reviewerPage.getByRole("button", {
      name: "읽음 처리",
    });
    for (
      let remaining = await unreadButtons.count();
      remaining > 0;
      remaining--
    ) {
      await unreadButtons.first().click();
      await expect(unreadButtons).toHaveCount(remaining - 1);
    }
    await expect(reviewerPage.getByText("안 읽음 0")).toBeVisible();
    await reviewerPage.goto(`${baseUrl}${path}`);
    await reviewerPage
      .getByRole("button", { name: /창호 치수 확인 E2E/ })
      .click();
    await reviewerPage.getByLabel("댓글").fill("검토 완료: 치수 근거 확인");
    await reviewerPage.getByRole("button", { name: "등록" }).click();
    await reviewerPage.getByLabel("검토 결정").selectOption("approved");
    await reviewerPage
      .getByLabel("검토 의견")
      .fill("PDF 영역과 수정 의견을 확인해 승인합니다.");
    await reviewerPage.getByRole("button", { name: "결정 기록" }).click();
    await expect(reviewerPage.getByText("완료", { exact: true })).toBeVisible();
    await expect(
      reviewerPage.getByRole("region", { name: "승인 기록" }),
    ).toContainText("PDF 영역과 수정 의견을 확인해 승인합니다.");
    await expect(ownerPage.getByText("완료", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      ownerPage.getByText("검토 완료: 치수 근거 확인"),
    ).toBeVisible();
    await expect(
      ownerPage.getByRole("region", { name: "변경 기록" }),
    ).toContainText("상태 변경");

    await ownerContext.close();
    await reviewerContext.close();
  });

  test("maker binds a real IFC element and camera to an issue", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.ifcFileId}`;
    const context = await browser.newContext();
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      path,
    );

    const useElement = page.getByRole("button", {
      name: "이 요소를 이슈 근거로 사용",
    });
    await expect(useElement).toBeEnabled({ timeout: 30_000 });
    await useElement.click();
    await page.getByLabel("이슈 제목").fill("IFC 객체 근거 E2E");
    await page.getByRole("button", { name: "이슈 만들기" }).click();
    await page.getByRole("button", { name: /IFC 객체 근거 E2E/ }).click();
    await page.getByRole("button", { name: "선택한 도면 근거 연결" }).click();
    await expect(page.getByText("IFC 객체 근거")).toBeVisible();
    await page.goto(
      `${baseUrl}/projects/${fixture.projectId}/drawings/${fixture.revisedIfcFileId}`,
    );
    await expect(page.getByText("개정 도면 재검토 1건")).toBeVisible();
    await expect(
      page.getByText(
        "같은 IFC 객체가 확인되지 않았습니다. 새 도면에서 객체를 다시 선택하세요.",
      ),
    ).toBeVisible();

    await context.close();
  });

  test("database rejects approval bypasses and preserves a rejected decision", async () => {
    const owner = await authenticateApiClient(fixture, fixture.owner);
    const reviewer = await authenticateApiClient(fixture, fixture.reviewer);
    const viewer = await authenticateApiClient(fixture, fixture.viewer);

    const createReviewRequest = async (withAnchor: boolean) => {
      const { data: issue, error: issueError } = await owner
        .from("lukas_drawing_issues")
        .insert({
          project_id: fixture.projectId,
          title: `승인 보안 E2E ${crypto.randomUUID()}`,
          description: "실제 RLS와 트리거 반례 검증",
          priority: "normal",
          created_by: fixture.owner.id,
        })
        .select("id,project_id,version,status")
        .single();
      if (issueError || !issue)
        throw issueError ?? new Error("Issue setup failed");
      if (withAnchor) {
        const { error: anchorError } = await owner
          .from("lukas_drawing_issue_anchors")
          .insert({
            issue_id: issue.id,
            project_id: fixture.projectId,
            file_id: fixture.pdfFileId,
            anchor_kind: "pdf_region",
            page_number: 1,
            x: 0.1,
            y: 0.1,
            width: 0.2,
            height: 0.2,
            label: "승인 보안 근거",
            created_by: fixture.owner.id,
          });
        if (anchorError) throw anchorError;
      }
      const { data: inProgress, error: progressError } = await owner
        .from("lukas_drawing_issues")
        .update({ status: "in_progress" })
        .eq("id", issue.id)
        .eq("version", issue.version)
        .select("id,project_id,version,status")
        .single();
      if (progressError || !inProgress)
        throw progressError ?? new Error("Progress transition failed");
      const { data: requested, error: requestError } = await owner
        .from("lukas_drawing_issues")
        .update({ status: "resolution_requested" })
        .eq("id", issue.id)
        .eq("version", inProgress.version)
        .select("id,project_id,version,status")
        .single();
      if (requestError || !requested)
        throw requestError ?? new Error("Review transition failed");
      return requested;
    };

    const rejectIssue = await createReviewRequest(true);
    const approvalInput = {
      issue_id: rejectIssue.id,
      project_id: fixture.projectId,
      subject_version: rejectIssue.version,
      note: "검토 반례 확인",
    };
    const { error: selfApprovalError } = await owner
      .from("lukas_drawing_issue_approvals")
      .insert({
        ...approvalInput,
        decision: "approved",
        reviewer_id: fixture.owner.id,
      });
    expect(selfApprovalError).toBeTruthy();

    const { error: staleError } = await reviewer
      .from("lukas_drawing_issue_approvals")
      .insert({
        ...approvalInput,
        subject_version: rejectIssue.version - 1,
        decision: "approved",
        reviewer_id: fixture.reviewer.id,
      });
    expect(staleError).toBeTruthy();

    const { data: rejected, error: rejectError } = await reviewer
      .from("lukas_drawing_issue_approvals")
      .insert({
        ...approvalInput,
        decision: "rejected",
        reviewer_id: fixture.reviewer.id,
      })
      .select("id,decision,note")
      .single();
    expect(rejectError).toBeNull();
    expect(rejected?.decision).toBe("rejected");
    const { data: rejectedIssue } = await reviewer
      .from("lukas_drawing_issues")
      .select("status")
      .eq("id", rejectIssue.id)
      .single();
    expect(rejectedIssue?.status).toBe("in_progress");
    const { error: updateApprovalError } = await reviewer
      .from("lukas_drawing_issue_approvals")
      .update({ note: "변조" })
      .eq("id", rejected!.id);
    expect(updateApprovalError).toBeTruthy();

    const restrictedIssue = await createReviewRequest(false);
    const restrictedInput = {
      issue_id: restrictedIssue.id,
      project_id: fixture.projectId,
      subject_version: restrictedIssue.version,
      decision: "approved" as const,
      note: "거부돼야 하는 승인",
    };
    const { error: missingAnchorError } = await reviewer
      .from("lukas_drawing_issue_approvals")
      .insert({ ...restrictedInput, reviewer_id: fixture.reviewer.id });
    expect(missingAnchorError).toBeTruthy();

    const viewerIssue = await createReviewRequest(true);
    const { error: viewerApprovalError } = await viewer
      .from("lukas_drawing_issue_approvals")
      .insert({
        issue_id: viewerIssue.id,
        project_id: fixture.projectId,
        subject_version: viewerIssue.version,
        decision: "approved",
        note: "읽기 전용 사용자의 승인 시도",
        reviewer_id: fixture.viewer.id,
      });
    expect(viewerApprovalError).toBeTruthy();
    const { error: directCloseError } = await owner
      .from("lukas_drawing_issues")
      .update({ status: "closed" })
      .eq("id", restrictedIssue.id)
      .eq("version", restrictedIssue.version);
    expect(directCloseError).toBeTruthy();
  });

  test("viewer is read-only and non-member cannot enter", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}`;
    const viewerContext = await browser.newContext();
    const viewerPage = await authenticateContext(
      fixture,
      viewerContext,
      fixture.viewer,
      baseUrl,
      path,
    );
    await expect(
      viewerPage.getByText("조회 권한으로 참여 중입니다."),
    ).toBeVisible();
    await expect(viewerPage.getByLabel("이슈 제목")).toHaveCount(0);

    const outsiderContext = await browser.newContext();
    const outsiderPage = await authenticateContext(
      fixture,
      outsiderContext,
      fixture.nonMember,
      baseUrl,
      "/workspace",
    );
    const response = await outsiderPage.goto(`${baseUrl}${path}`);
    expect(response?.status()).toBe(404);
    await viewerContext.close();
    await outsiderContext.close();
  });

  test("390px mobile keeps drawing and issue work reachable", async ({
    browser,
  }) => {
    const path = `/projects/${fixture.projectId}/drawings/${fixture.pdfFileId}`;
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    const page = await authenticateContext(
      fixture,
      context,
      fixture.owner,
      baseUrl,
      path,
    );
    await expect(page.getByRole("button", { name: "도면" })).toBeVisible();
    await page.getByRole("button", { name: /이슈/ }).click();
    await expect(page.getByRole("region", { name: "도면 이슈" })).toBeVisible();
    await page.getByRole("button", { name: "도면" }).click();
    await expect(page.getByTestId("pdf-canvas")).toBeVisible();
    await context.close();
  });
});
