import { act,useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,describe,expect,it } from 'vitest';
import { calendarToInsert,eventToInsert,preferencesToInsert } from '../domain/databaseMapping';
import { createEmptyUserData } from '../domain/types';
import { FakeSupabase } from '../test/fakeSupabase';
import { SupabaseDayPopRepository } from './supabaseRepository';
import { DataProvider } from './DataProvider';
import { useDayPopDataState,type DataContextValue } from './dataContext';

const OWNER='00000000-0000-4000-8000-000000000481';
const CAL='10000000-0000-4000-8000-000000000481';
const EVENT='20000000-0000-4000-8000-000000000481';
const NOW='2026-10-19T00:00:00.000Z';
let root:ReturnType<typeof createRoot> | undefined;
let host:HTMLDivElement;
afterEach(()=>{if(root)act(()=>root!.unmount());host?.remove();root=undefined;});
function fixture() {
  const db=new FakeSupabase();const data=createEmptyUserData({idFactory:()=>CAL,now:NOW});
  db.seed('calendars',[{...calendarToInsert(data.calendars[0]!,OWNER),created_at:NOW,updated_at:NOW}]);
  db.seed('user_preferences',[{...preferencesToInsert(data.preferences,OWNER),created_at:NOW,updated_at:NOW}]);
  db.seed('events',[{...eventToInsert({id:EVENT,calendarId:CAL,title:'共同維護',allDay:true,startDate:'2026-10-19',endDate:'2026-10-19',location:null,notes:null,reminderMinutes:[],recurrence:null,sharingScope:'inherit',createdAt:NOW,updatedAt:NOW},OWNER),created_at:NOW,updated_at:NOW}]);
  db.sharingManifest=[{calendarId:CAL,ownerId:OWNER,ownerName:'自己',permission:'edit',groupId:'30000000-0000-4000-8000-000000000481',updatedAt:NOW}];
  return {db,repository:new SupabaseDayPopRepository(db.asClient(),OWNER)};
}
describe('sharing in the mounted data boundary',()=>{
  it('captures the version at the UI call, before another queued write changes the snapshot',async()=>{
    const {repository,db}=fixture();let latest!:DataContextValue;
    function Probe(){latest=useDayPopDataState();return null;}
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    await act(async()=>root!.render(<DataProvider repository={repository}><Probe/></DataProvider>));
    let first!:Promise<void>;let second!:Promise<void>;let secondError:unknown;
    await act(async()=>{
      first=latest.actions.updateEvent(EVENT,{title:'第一份草稿'});
      second=latest.actions.updateEvent(EVENT,{title:'舊畫面第二份草稿'}).catch(error=>{secondError=error;});
      await Promise.all([first,second]);
    });
    expect(secondError).toBeInstanceOf(Error);
    expect(db.rows('events')[0]?.title).toBe('第一份草稿');
    expect(latest.state).toMatchObject({status:'ready',warning:{kind:'write-failed'}});
  });
  it('rechecks sharing on focus without unmounting the editor or resetting its draft',async()=>{
    const {repository,db}=fixture();let latest!:DataContextValue;const statuses:string[]=[];
    function Probe(){latest=useDayPopDataState();statuses.push(latest.state.status);const [draft]=useState('未保存的草稿');return <input aria-label="草稿" value={draft} readOnly/>;}
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    await act(async()=>root!.render(<DataProvider repository={repository}><Probe/></DataProvider>));
    const node=host.querySelector('input');statuses.length=0;db.sharingManifest=[];
    await act(async()=>{window.dispatchEvent(new Event('focus'));await new Promise(resolve=>setTimeout(resolve,0));});
    expect(latest.sharing?.shares).toEqual([]);
    expect(statuses.every(s=>s==='ready')).toBe(true);
    expect(host.querySelector('input')).toBe(node);
    expect(host.querySelector('input')?.value).toBe('未保存的草稿');
  });
  it('discards received content immediately on offline and waits for online before rechecking',async()=>{
    const {repository,db}=fixture();
    const other='00000000-0000-4000-8000-000000000482',calendar='10000000-0000-4000-8000-000000000482';
    db.seed('calendars',[...db.rows('calendars'),{...db.rows('calendars')[0],id:calendar,owner_id:other}]);
    db.seed('events',[...db.rows('events'),{...db.rows('events')[0],id:'20000000-0000-4000-8000-000000000482',owner_id:other,calendar_id:calendar,title:'離線不可保留的分享'}]);
    db.sharingManifest=[...(db.sharingManifest as Record<string,unknown>[]),{calendarId:calendar,ownerId:other,ownerName:'家人',permission:'edit',groupId:'30000000-0000-4000-8000-000000000481',updatedAt:NOW}];
    let latest!:DataContextValue;
    function Probe(){latest=useDayPopDataState();return null;}
    host=document.createElement('div');document.body.append(host);root=createRoot(host);
    await act(async()=>root!.render(<DataProvider repository={repository}><Probe/></DataProvider>));
    expect(latest.state.status==='ready'?latest.state.data.events.length:0).toBe(2);
    const calls=db.rpcCalls.length;
    await act(async()=>{window.dispatchEvent(new Event('offline'));window.dispatchEvent(new Event('focus'));});
    expect(latest.state).toMatchObject({status:'ready',warning:{kind:'cached'}});
    expect(latest.state.status==='ready'?latest.state.data.events.map(e=>e.id):[]).toEqual([EVENT]);
    expect(db.rpcCalls.length).toBe(calls);
    expect(latest.sharing?.available).toBe(false);
    await act(async()=>{window.dispatchEvent(new Event('online'));await new Promise(resolve=>setTimeout(resolve,0));});
    expect(latest.state.status==='ready'?latest.state.data.events.length:0).toBe(2);
    expect(latest.sharing?.available).toBe(true);
  });
});
