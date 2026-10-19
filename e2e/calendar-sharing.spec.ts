import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';
import { expect,test,type Page } from '@playwright/test';
import type { FakeSupabase } from '../src/test/fakeSupabase';
import { E2E_EMAIL,E2E_PASSWORD,openApp,tabButton,monitorBrowser,calendarViewButton } from './support';

const SELF='00000000-0000-4000-8000-000000000030';
const OTHER='00000000-0000-4000-8000-00000000048b';
const CAL='10000000-0000-4000-8000-00000000048b';
const EVENT='20000000-0000-4000-8000-00000000048b';
const TODO='30000000-0000-4000-8000-00000000048b';
const NOW='2026-10-19T00:00:00.000001Z';
type HarnessWindow=Window & {__daypopSharingHarness?:FakeSupabase};
async function login(page:Page) {
  await page.clock.setFixedTime(new Date('2026-10-19T03:00:00Z'));
  await openApp(page,'/e2e/auth.html');
  console.log('sharing browser timezone:',await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone));
  await tabButton(page,'設定').click();await page.getByRole('button',{name:'登入／註冊',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'保存你的日蹦資料'});
  await dialog.getByLabel('Email').fill(E2E_EMAIL);await dialog.getByLabel('密碼',{exact:true}).fill(E2E_PASSWORD);
  await dialog.getByRole('button',{name:'登入',exact:true}).click();await tabButton(page,'設定').click();
  await expect(page.getByText('帳號已登入',{exact:true})).toBeVisible();
}
async function received(page:Page,permission:'view'|'edit') {
  await page.evaluate(({permission,CAL,OTHER,EVENT,TODO,NOW})=>{
    const db=(window as HarnessWindow).__daypopSharingHarness!;
    db.seed('calendars',[...db.rows('calendars'),{id:CAL,owner_id:OTHER,name:'家人的日曆',color:'#336699',is_visible:false,is_default:true,sort_order:0,created_at:NOW,updated_at:NOW}]);
    db.seed('events',[{id:EVENT,owner_id:OTHER,calendar_id:CAL,title:'家人的共享行程',location:null,notes:'共同安排',is_all_day:false,start_date:null,end_date:null,
      starts_at:'2026-10-19T01:00:00Z',ends_at:'2026-10-19T02:00:00Z',timezone:'Asia/Taipei',reminder_minutes:[],recurrence_rule:null,sharing_scope:'inherit',created_by:OTHER,created_at:NOW,updated_at:NOW}]);
    db.seed('todos',[{id:TODO,owner_id:OTHER,calendar_id:CAL,parent_id:null,title:'家人的共享待辦',due_date:'2026-10-19',priority:'none',completed_at:null,sort_order:0,sharing_scope:'inherit',created_by:OTHER,created_at:NOW,updated_at:NOW}]);
    db.sharingManifest=[{calendarId:CAL,ownerId:OTHER,ownerName:'家人甲',permission,groupId:'40000000-0000-4000-8000-00000000048b',updatedAt:NOW}];
  },{permission,CAL,OTHER,EVENT,TODO,NOW});
  await page.getByRole('button',{name:'重新確認分享',exact:true}).click();
  await expect(page.getByText('家人甲 · '+(permission==='view'?'只能查看':'可共同編輯'),{exact:true})).toBeVisible();
}
async function openReceivedEvent(page:Page,title='家人的共享行程') {
  await tabButton(page,'搜尋').click();await page.getByRole('textbox',{name:'搜尋',exact:true}).fill(title);
  await page.locator('.search-result').filter({hasText:title}).click();
  return page.getByRole('dialog',{name:'編輯行程',exact:true});
}
async function audit(page:Page,minimum=5) {
  await page.locator('.dp-texture').evaluateAll(elements=>elements.forEach(e=>(e as HTMLElement).style.visibility='hidden'));
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(result.violations).toEqual([]);
  expect(result.passes.find(p=>p.id==='color-contrast')?.nodes.length ?? 0).toBeGreaterThanOrEqual(minimum);
  await page.locator('.dp-texture').evaluateAll(elements=>elements.forEach(e=>(e as HTMLElement).style.visibility=''));
}

test('收到的 view 日曆只讀、隱藏僅本次有效、備份與登出不保留收到的內容',async({page},testInfo)=>{
  const clean=monitorBrowser(page);await login(page);await received(page,'view');
  const cacheKey=`daypop.account-cache.${SELF}`;
  const before=await page.evaluate(key=>localStorage.getItem(key),cacheKey);
  expect(before).not.toContain('家人的共享');expect(before).not.toContain(OTHER);
  await page.getByRole('button',{name:'隱藏收到的日曆 家人的日曆'}).click();
  await expect(page.getByRole('button',{name:'顯示收到的日曆 家人的日曆'})).toBeVisible();
  expect(await page.evaluate(key=>localStorage.getItem(key),cacheKey)).toBe(before);
  await page.getByRole('button',{name:'顯示收到的日曆 家人的日曆'}).click();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'⬇ 匯出資料',exact:true}).click();
  const download=await pending;const path=testInfo.outputPath('personal-only.json');await download.saveAs(path);
  const backup=await readFile(path,'utf8');expect(backup).not.toContain('家人的共享');expect(backup).not.toContain(OTHER);
  const dialog=await openReceivedEvent(page);
  await expect(dialog.getByRole('button',{name:'儲存',exact:true})).toBeDisabled();
  await expect(dialog.getByRole('button',{name:'刪除事件',exact:true})).toBeDisabled();
  await expect(dialog.getByText('家人甲的日曆 · 目前只能查看',{exact:true})).toBeVisible();
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await calendarViewButton(page,'週').click();
  const block=page.locator('.cal-week-event').filter({hasText:'家人的共享行程'});
  await expect(block.locator('.cal-week-event-resize')).toHaveCount(0);
  await block.click();await expect(dialog.getByLabel('標題')).toHaveValue('家人的共享行程');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  await tabButton(page,'綜覽').click();await page.getByRole('button',{name:'待辦',exact:true}).click();
  await expect(page.locator('.overview-item').filter({hasText:'家人的共享待辦'})).toBeDisabled();
  await tabButton(page,'設定').click();await audit(page);
  await page.getByRole('button',{name:'登出',exact:true}).click();
  await expect(page.getByText('收到的日曆',{exact:true})).toHaveCount(0);
  await tabButton(page,'搜尋').click();await page.getByRole('textbox',{name:'搜尋',exact:true}).fill('家人的共享');
  await expect(page.locator('.search-result')).toHaveCount(0);clean();
});

test('共享衝突保留草稿，刪除確認在行程 sheet 上方且取消不寫入',async({page})=>{
  const clean=monitorBrowser(page);await login(page);await received(page,'edit');
  const dialog=await openReceivedEvent(page);await dialog.getByLabel('標題').fill('我的未保存草稿');
  await page.evaluate(({EVENT})=>{
    const db=(window as HarnessWindow).__daypopSharingHarness!;const row=db.rows('events').find(e=>e.id===EVENT)!;
    row.title='家人剛修改';row.updated_at='2026-10-19T00:00:01.000001Z';window.dispatchEvent(new Event('focus'));
  },{EVENT});
  await expect(dialog.getByLabel('標題')).toHaveValue('我的未保存草稿');
  await dialog.getByRole('button',{name:'儲存',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('草稿已保留');
  await expect(dialog.getByLabel('標題')).toHaveValue('我的未保存草稿');
  expect(await page.evaluate(()=> (window as HarnessWindow).__daypopSharingHarness!.rows('events')[0]?.title)).toBe('家人剛修改');
  await dialog.getByRole('button',{name:'取消',exact:true}).click();
  const fresh=await openReceivedEvent(page,'家人剛修改');
  await fresh.getByRole('button',{name:'刪除事件',exact:true}).click();
  const confirmation=page.getByRole('dialog',{name:'刪除共享事項',exact:true});
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button',{name:'取消',exact:true}).click();
  await expect(fresh).toBeVisible();
  expect(await page.evaluate(()=> (window as HarnessWindow).__daypopSharingHarness!.rows('events').length)).toBe(1);
  await fresh.getByRole('button',{name:'刪除事件',exact:true}).click();
  // This compact modal has exactly four text nodes: heading, description,
  // cancel and confirm. The underlying sheet is inert and must not be counted.
  await audit(page,4);await confirmation.getByRole('button',{name:'確認刪除',exact:true}).click();
  await expect(fresh).toBeHidden();
  expect(await page.evaluate(()=> (window as HarnessWindow).__daypopSharingHarness!.rows('events').length)).toBe(0);clean();
});

test('擁有者明確確認歷史內容與 edit/view，新增私人事項保留既有 schema',async({page})=>{
  const clean=monitorBrowser(page);await login(page);
  await page.getByRole('button',{name:'設定日曆分享',exact:true}).click();
  await expect(page.getByText('請先建立或加入家庭，再選擇要分享的日曆。',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'關閉分享視窗'}).click();
  await page.getByRole('button',{name:'管理家庭',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'家庭群組',exact:true});
  await manager.getByRole('button',{name:'建立家庭',exact:true}).click();
  await expect(manager.getByRole('heading',{name:'家庭成員（1／6）'})).toBeVisible();
  await manager.getByRole('button',{name:'關閉家庭視窗'}).click();
  await page.getByRole('button',{name:'設定日曆分享',exact:true}).click();
  const settings=page.getByRole('dialog',{name:'設定日曆分享',exact:true});
  await expect(settings.getByLabel('共同編輯',{exact:true})).toBeChecked();
  await settings.getByRole('button',{name:'下一步確認'}).click();
  const confirmation=page.getByRole('dialog',{name:'確認日曆分享',exact:true});
  await expect(confirmation).toContainText('包含歷史內容');await expect(confirmation).toContainText('刪除所有可見事項');
  await audit(page);await confirmation.getByRole('button',{name:'確認分享設定'}).click();await expect(confirmation).toBeHidden();
  await tabButton(page,'日曆').click();await page.getByRole('button',{name:'新增',exact:true}).click();
  const form=page.getByRole('dialog',{name:'新增行程',exact:true});await form.getByLabel('標題').fill('只有本人知道');
  await form.getByLabel('不分享（只有日曆擁有者可見）').check();await form.getByRole('button',{name:'儲存',exact:true}).click();
  await expect(form).toBeHidden();
  expect(await page.evaluate(()=> (window as HarnessWindow).__daypopSharingHarness!.rows('events')[0]?.sharing_scope)).toBe('private');
  const cache=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),`daypop.account-cache.${SELF}`);
  expect(cache.schemaVersion).toBe(4);expect(cache.data.events[0].sharingScope).toBe('private');expect(cache.data).not.toHaveProperty('shares');clean();
});

test('離線或撤權移除待辦列時保留已輸入草稿，登出清除記憶體副本',async({page})=>{
  const clean=monitorBrowser(page);await login(page);await received(page,'edit');
  await tabButton(page,'日曆').click();await calendarViewButton(page,'月').click();
  await page.getByRole('button',{name:'2026-10-19，1 個行程',exact:true}).click();
  const day=page.getByRole('dialog',{name:'10月19日 週一',exact:true});
  await day.getByRole('button',{name:'修改 家人的共享待辦 的標題',exact:true}).click();
  await day.getByRole('textbox',{name:'待辦標題',exact:true}).fill('撤權後仍要保留的輸入');
  await page.evaluate(()=>window.dispatchEvent(new Event('offline')));
  await expect(day.getByRole('textbox',{name:'待辦標題',exact:true})).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'查看未保存輸入',exact:true}).click();
  const retained=page.getByRole('dialog',{name:'未保存的輸入',exact:true});
  await expect(retained.getByRole('textbox',{name:'待辦標題草稿',exact:true})).toHaveValue('撤權後仍要保留的輸入');
  expect(await page.evaluate(()=>JSON.stringify(localStorage))).not.toContain('撤權後仍要保留的輸入');
  await retained.getByRole('button',{name:'關閉未保存輸入',exact:true}).click();
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await tabButton(page,'設定').click();await expect(page.getByText('家人甲 · 可共同編輯',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'登出',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看未保存輸入',exact:true})).toHaveCount(0);clean();
});

test('分享視窗在窄螢幕與橫向可捲至確認，長日曆名稱不造成水平溢出',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='mobile-chrome','手機尺寸與主題 token 的版面矩陣');
  const clean=monitorBrowser(page);await login(page);
  await page.getByRole('button',{name:'管理家庭',exact:true}).click();
  const manager=page.getByRole('dialog',{name:'家庭群組',exact:true});
  await manager.getByRole('button',{name:'建立家庭',exact:true}).click();
  await expect(manager.getByRole('heading',{name:'家庭成員（1／6）'})).toBeVisible();
  await manager.getByRole('button',{name:'關閉家庭視窗'}).click();
  await page.evaluate(()=>{(window as HarnessWindow).__daypopSharingHarness!.rows('calendars')[0]!.name='家庭一起安排日常'.repeat(10).slice(0,80);});
  await page.getByRole('button',{name:'重新確認分享',exact:true}).click();
  for(const size of [{width:390,height:844},{width:375,height:667},{width:932,height:430}]) {
    await page.setViewportSize(size);
    for(const mode of ['light','dark'] as const) {
      await page.getByRole('group',{name:'淺色或深色'}).getByRole('button',{name:mode==='light'?'☀ 淺色':'☾ 深色',exact:true}).click();
      await page.getByRole('button',{name:'設定日曆分享',exact:true}).click();
      const settings=page.getByRole('dialog',{name:'設定日曆分享',exact:true});
      await expect(settings.getByLabel('共同編輯',{exact:true})).toBeVisible();
      expect(await settings.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
      await settings.getByRole('button',{name:'下一步確認'}).click();
      const confirmation=page.getByRole('dialog',{name:'確認日曆分享',exact:true});
      const confirm=confirmation.getByRole('button',{name:'確認分享設定'});await confirm.scrollIntoViewIfNeeded();
      await expect(confirm).toBeVisible();
      const bounds=await confirmation.boundingBox(),viewport=await page.locator('.dp-viewport').boundingBox();
      expect(bounds && viewport && bounds.y>=viewport.y-1 && bounds.y+bounds.height<=viewport.y+viewport.height+1).toBe(true);
      expect(await confirmation.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);
      await page.screenshot({path:testInfo.outputPath(`sharing-${size.width}-${size.height}-${mode}.png`)});
      await page.keyboard.press('Escape');await expect(settings).toBeVisible();await page.keyboard.press('Escape');
    }
  }
  clean();
});
