import {chromium,expect} from '@playwright/test';

// Catches carrying a document-local submission id into a different drawing.
const browser=await chromium.launch();
try {
 const page=await browser.newPage();
 page.setDefaultTimeout(7000);
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const base='http://127.0.0.1:4181/workspace-preview/flow';
 const ids=[];
 const review=page.getByRole('region',{name:'제출물 검토',exact:true});
 for(const [title,submissions] of [['건축 검토도',['건축 시공도']],['토목 검토도',['토목 시공도','토목 상세도']]]) {
  await page.goto(`${base}?page=library`,{waitUntil:'networkidle'});
  await page.getByLabel('템플릿 작업 이름',{exact:true}).fill(title);
  await page.getByRole('button',{name:'이 템플릿으로 작업 만들기',exact:true}).click();
  await expect(page).toHaveURL(/blank=/);
  const id=new URL(page.url()).searchParams.get('blank');ids.push(id);
  await page.goto(`${base}?page=submittals&submissionDocument=${id}`);
  for(const title of submissions) {
   await review.getByLabel('제출 제목',{exact:true}).fill(title);
   await review.getByLabel('검토 기한',{exact:true}).fill('2026-09-30');
   await review.getByLabel('제출 설명',{exact:true}).fill(`${title} 검토 요청`);
   await review.getByRole('button',{name:'현재 도면 제출',exact:true}).click();
   await expect(review.getByRole('heading',{name:new RegExp(` · ${title}$`)})).toBeVisible();
  }
 }
 await page.goto(`${base}?page=tasks&scope=local`);
 const queue=page.getByRole('region',{name:'내 제출물 할 일',exact:true});
 await queue.getByLabel('제출물 할 일 역할',{exact:true}).selectOption('reviewer');
 await queue.getByRole('button',{name:'건축 시공도 처리하기',exact:true}).click();
 await expect(page).toHaveURL(/submissionItem=1/);
 await review.getByLabel('검토 의견 1',{exact:true}).fill('건축 도면 의견 초안');
 await review.getByLabel('제출 대상 도면',{exact:true}).selectOption(ids[1]);
 await expect(review.getByRole('heading',{name:'#2 · 토목 상세도',exact:true})).toBeVisible();
 await expect(review.getByRole('heading',{name:'#1 · 토목 시공도',exact:true})).toBeVisible();
 expect(new URL(page.url()).searchParams.has('submissionItem')).toBe(false);
 await expect(review.getByLabel('검토 의견 1',{exact:true})).toHaveValue('');
 await review.getByLabel('검토 의견 1',{exact:true}).fill('토목 도면 의견 초안');
 await page.reload();
 await expect(review.getByRole('heading',{name:'#2 · 토목 상세도',exact:true})).toBeVisible();
 await expect(review.getByLabel('검토 의견 1',{exact:true})).toHaveValue('토목 도면 의견 초안');
 await review.getByLabel('제출 대상 도면',{exact:true}).selectOption(ids[0]);
 await expect(review.getByLabel('검토 의견 1',{exact:true})).toHaveValue('건축 도면 의견 초안');
 await review.getByRole('button',{name:'제출물 할 일로 돌아가기',exact:true}).click();
 await expect(queue.getByLabel('제출물 할 일 역할',{exact:true})).toHaveValue('reviewer');
 await expect(queue.getByRole('button',{name:'토목 상세도 처리하기',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
 console.log('PASS drawing switch clears submission selection, shows complete target history, isolates drafts and retains queue return');
} finally {await browser.close();}
