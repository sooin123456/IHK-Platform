import {chromium,expect} from '@playwright/test';

// Catches dropped template state during download/restore and undisclosed replacement.
const browser=await chromium.launch();
try {
 const page=await browser.newPage();page.setDefaultTimeout(7000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const base='http://127.0.0.1:4181/workspace-preview/flow';
 await page.goto(`${base}?page=library`,{waitUntil:'networkidle'});
 await page.getByLabel('템플릿 작업 이름',{exact:true}).fill('보관 원본');
 await page.getByRole('button',{name:'이 템플릿으로 작업 만들기',exact:true}).click();
 await expect(page).toHaveURL(/blank=/);
 await page.goto(`${base}?page=library`);
 const library=page.getByRole('region',{name:'내 도면 재사용 템플릿'});
 await library.getByLabel('보관할 템플릿 이름',{exact:true}).fill('인계용 회의실');
 await library.getByRole('button',{name:'선택 페이지를 템플릿으로 보관',exact:true}).click();
 await expect(library.getByLabel('내 템플릿',{exact:true})).not.toHaveValue('');
 const backup=page.getByRole('region',{name:'작업 백업·복원'});
 await backup.locator('summary').click();
 const downloadEvent=page.waitForEvent('download');
 await backup.getByRole('button',{name:'현재 작업 백업 다운로드',exact:true}).click();
 const stream=await (await downloadEvent).createReadStream();const chunks=[];
 for await(const chunk of stream)chunks.push(chunk);
 const buffer=Buffer.concat(chunks);const data=JSON.parse(buffer.toString());
 expect(data.savedTemplates).toHaveLength(1);
 expect(data.savedTemplates[0].name).toBe('인계용 회의실');
 const restored=await browser.newPage();restored.setDefaultTimeout(7000);
 restored.on('pageerror',e=>errors.push(e.message));
 await restored.goto(`${base}?page=library`,{waitUntil:'networkidle'});
 const recovery=restored.getByRole('region',{name:'작업 백업·복원'});
 await recovery.locator('summary').click();
 await recovery.getByLabel('작업 백업 파일',{exact:true}).setInputFiles({name:'templates.json',mimeType:'application/json',buffer});
 await expect(recovery).toContainText('재사용 템플릿 1개');
 await expect(recovery.getByRole('button',{name:'확인한 백업으로 현재 탭 복원',exact:true})).toBeDisabled();
 await recovery.getByLabel('현재 탭의 작업을 선택한 백업으로 교체함을 확인합니다',{exact:true}).check();
 await recovery.getByRole('button',{name:'확인한 백업으로 현재 탭 복원',exact:true}).click();
 await expect(recovery).toContainText('백업을 현재 탭에 복원했습니다');
 await restored.goto(`${base}?page=library`);await restored.reload();
 const restoredLibrary=restored.getByRole('region',{name:'내 도면 재사용 템플릿'});
 await expect(restoredLibrary).toContainText('인계용 회의실');
 await restoredLibrary.getByLabel('재사용 작업 이름',{exact:true}).fill('복원 후 작업');
 await restoredLibrary.getByRole('button',{name:'내 템플릿으로 새 작업 만들기',exact:true}).click();
 await expect(restored).toHaveURL(/blank=/);
 await expect(restored.getByRole('button',{name:'회의실 구상 객체',exact:true})).toBeVisible();
 expect(errors).toEqual([]);
 console.log('PASS template backup download, disclosed explicit restore in new tab, reload and editable reuse');
} finally {await browser.close();}
