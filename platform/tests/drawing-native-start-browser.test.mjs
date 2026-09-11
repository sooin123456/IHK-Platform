import test from 'node:test';
import {chromium,expect} from '@playwright/test';

for(const kind of ['dwg','ifc'])test(`${kind} rejects a replacement with the wrong extension and preserves valid preparation through retry`,{skip:!process.env.OBJECT_PREVIEW_ORIGIN,timeout:60000},async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:kind==='ifc'?{width:390,height:844}:{width:1280,height:800}});
  const project='00000000-0000-4000-8000-000000000101';
  await page.goto(`${process.env.OBJECT_PREVIEW_ORIGIN}/workspace-preview?project=${project}&start=${kind}`);
  const input=page.locator('input[type=file]');
  await input.setInputFiles({name:`현장 도면.${kind}`,mimeType:'application/octet-stream',buffer:Buffer.from('screen-only filename fixture')});
  await expect(page.getByRole('button',{name:'준비 조건 확인',exact:true})).toBeEnabled();
  await input.setInputFiles({name:'잘못 선택한 파일.txt',mimeType:'text/plain',buffer:Buffer.from('invalid')});
  await expect(page.getByRole('alert')).toContainText(`${kind.toUpperCase()} 파일을 선택해 주세요`);
  await expect(page.getByRole('button',{name:'준비 조건 확인',exact:true})).toBeDisabled();
  await input.setInputFiles({name:`현장 도면.${kind}`,mimeType:'application/octet-stream',buffer:Buffer.from('screen-only filename fixture')});
  await page.getByRole('button',{name:'준비 조건 확인',exact:true}).click();
  await page.getByLabel(kind==='dwg'?/^작업 공간/:/^모델 표시 방식/).selectOption(kind==='dwg'?'layout':'3d');
  await page.getByLabel('누락 항목 안내 예시 보기').check();
  await expect(page.getByRole('status')).toContainText(kind==='dwg'?'XREF':'GlobalId');
  await page.getByRole('button',{name:'작업실 준비 화면 체험',exact:true}).click();
  await page.getByRole('button',{name:'등록 방식 확인 후 준비',exact:true}).click();
  await page.getByRole('button',{name:'실패 상태 체험',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('원본은 변경되지 않았습니다');
  await page.getByRole('button',{name:'등록 방식 확인 후 재시도',exact:true}).click();
  await page.getByRole('button',{name:'등록 방식 확인 후 준비',exact:true}).click();
  await page.getByRole('button',{name:'작업실 화면으로 계속',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`view=${kind==='dwg'?'2d':'3d'}`));
  await expect(page.getByRole('heading',{level:1})).toContainText(kind==='dwg'?'레이아웃':'IFC');
  await page.getByText(/^등록 준비 기록 ·/).click();
  await expect(page.getByRole('group',{name:'등록 준비 기록',exact:true})).toContainText(`현장 도면.${kind}`);
  await page.getByRole('link',{name:'작업공간으로 돌아가기',exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`project=${project}`));
 }finally{await browser.close();}
});
