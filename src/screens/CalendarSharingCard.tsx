import { useEffect,useRef,useState } from 'react';
import { useAuth } from '../auth/authContext';
import { useDayPopData,useDayPopDataState } from '../data/dataContext';
import { receivedCalendar } from '../data/calendarSharing';
import { FamilyFrame } from '../family/FamilyDialog';
import { useFamilyServiceFactory,type FamilyServiceFactory } from '../family/familyContext';
import { familyFailure } from '../family/familyFormatting';
import type { Calendar } from '../domain/types';
import '../family/family.css';

export function CalendarSharingCard({onOpenAuth}:{onOpenAuth():void}) {
  const auth=useAuth();const {data,personalData,sharing,updateCalendar}=useDayPopData();
  const {revalidateShares}=useDayPopDataState();const factory=useFamilyServiceFactory();
  const [open,setOpen]=useState(false);
  const received=data.calendars.filter(c=>receivedCalendar(sharing,c.id));
  return <>
    <div className="dp-section-label">日曆分享</div>
    <div className="dp-account-blocks"><section className="family-card">
      <div><strong>選擇自己的分享範圍</strong><p>開啟後，家人能查看或共同編輯既有及未來的非私人行程、待辦。附件、聯絡資料與貼圖仍僅供本人使用。</p></div>
      <button className="button secondary" type="button" disabled={Boolean(auth.sessionUnconfirmed || auth.configurationError || (auth.user && !sharing?.available))}
        onClick={()=>auth.user?setOpen(true):onOpenAuth()}>{auth.user?'設定日曆分享':'登入分享日曆'}</button>
    </section>
    {auth.user && !sharing?.available ? <p className="family-help">連線並確認登入後，才能載入分享內容；目前只顯示自己的資料。</p> : null}
    {received.length>0 ? <section className="family-card"><div><strong>收到的日曆</strong><p>只在這次使用期間顯示，不會存入這台裝置的帳號快取或備份。隱藏只影響自己的畫面。</p>
      <ul className="family-list">{received.map(calendar=>{const share=receivedCalendar(sharing,calendar.id)!;return <li key={calendar.id}>
        <div><strong>{calendar.name}</strong><p>{share.ownerName} · {share.permission==='edit'?'可共同編輯':'只能查看'}</p></div>
        <button className="button secondary" type="button" aria-pressed={calendar.isVisible}
          aria-label={`${calendar.isVisible?'隱藏':'顯示'}收到的日曆 ${calendar.name}`} onClick={()=>void updateCalendar(calendar.id,{isVisible:!calendar.isVisible})}>{calendar.isVisible?'隱藏':'顯示'}</button>
      </li>;})}</ul></div></section> : null}
    {auth.user ? <button className="button secondary" type="button" disabled={Boolean(auth.sessionUnconfirmed || auth.configurationError)} onClick={revalidateShares}>重新確認分享</button> : null}
    </div>
    {open && auth.user && sharing?.available ? <CalendarSharingDialog calendars={personalData.calendars} factory={factory} userId={auth.user.id} onClose={()=>setOpen(false)}/> : null}
  </>;
}

function CalendarSharingDialog({calendars,factory,userId,onClose}:{calendars:Calendar[];factory:FamilyServiceFactory;userId:string;onClose():void}) {
  const {sharing,setCalendarShare}=useDayPopData();
  const [calendarId,setCalendarId]=useState(calendars[0]?.id ?? '');
  const initial=sharing?.shares.find(s=>s.calendarId===calendarId);
  const [permission,setPermission]=useState<'edit'|'view'|'off'>(initial?.permission ?? 'edit');
  const [family,setFamily]=useState<boolean|null>(null);
  const [busy,setBusy]=useState(false);const [confirming,setConfirming]=useState(false);const [error,setError]=useState<string|null>(null);
  const pending=useRef(false);const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;let active=true;Promise.resolve().then(()=>factory(userId).load()).then(snapshot=>{
    if(active)setFamily(snapshot.group!==null);
  },cause=>{if(active)setError(familyFailure(cause));});return()=>{active=false;mounted.current=false;};},[factory,userId]);
  const existing=sharing?.shares.find(s=>s.calendarId===calendarId);
  const chosen=calendars.find(c=>c.id===calendarId);
  async function save() {
    if(pending.current || !setCalendarShare) return;
    pending.current=true;setBusy(true);setError(null);
    try {await setCalendarShare(calendarId,permission==='off'?null:permission);if(mounted.current)onClose();}
    catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'尚未確認分享設定，請重新確認。');}
    finally{pending.current=false;if(mounted.current)setBusy(false);}
  }
  return <FamilyFrame title={confirming?'確認日曆分享':'設定日曆分享'} busy={busy} closeLabel="關閉分享視窗" onClose={()=>{if(confirming){setConfirming(false);setError(null);}else onClose();}}>
    {error?<p className="family-feedback" role="alert">{error}</p>:null}
    {family===null && !error?<p className="dialog-intro">正在確認家庭資格…</p>:family===false?
      <p className="dialog-intro">請先建立或加入家庭，再選擇要分享的日曆。</p>:family ? <>
      {confirming?<>
        <p className="dialog-intro">{permission==='off'?`關閉「${chosen?.name}」的分享後，家人將無法再讀寫它，日曆內容會保留。`:
          `將「${chosen?.name}」分享給目前的家庭，包含歷史內容與未來新增的非私人行程、待辦；家人${permission==='edit'?'可新增、修改、完成與刪除所有可見事項':'只能查看，不能修改'}。`}</p>
        <p className="family-help">設為「不分享」的事項只供日曆擁有者使用，與建立事項的人無關。附件、聯絡資料及貼圖不會分享。</p>
        <div className="family-actions"><button className="button secondary" type="button" autoFocus disabled={busy} onClick={()=>setConfirming(false)}>返回調整</button>
          <button className="button primary" type="button" disabled={busy} onClick={()=>void save()}>{busy?'保存中…':'確認分享設定'}</button></div>
      </>:<>
        <label className="family-help" htmlFor="share-calendar">自己的日曆</label>
        <select id="share-calendar" className="button secondary sharing-calendar-select" disabled={busy} value={calendarId} onChange={event=>{
          setCalendarId(event.target.value);setPermission(sharing?.shares.find(s=>s.calendarId===event.target.value)?.permission ?? 'edit');
        }}>{calendars.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <p className="family-help">目前：{existing?existing.permission==='edit'?'共同編輯':'只能查看':'尚未分享'}</p>
        <fieldset className="family-fields" disabled={busy}><legend>家人可以做什麼</legend>
          {([['edit','共同編輯'],['view','只能查看'],['off','關閉分享']] as const).map(([value,label])=><label className="sharing-choice" key={value}>
            <input type="radio" name="share-permission" value={value} checked={permission===value} onChange={()=>setPermission(value)}/>{label}
          </label>)}
        </fieldset>
        <button className="button primary" type="button" disabled={!chosen || busy || (!existing && permission==='off')} onClick={()=>{setError(null);setConfirming(true);}}>下一步確認</button>
      </>}
    </>:null}
  </FamilyFrame>;
}
