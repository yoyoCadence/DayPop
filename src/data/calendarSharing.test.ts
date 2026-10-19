import { describe, expect, it, vi } from 'vitest';
import { calendarToInsert, eventToInsert, preferencesToInsert } from '../domain/databaseMapping';
import { createEmptyUserData } from '../domain/types';
import { MemoryStorage } from '../storage/browserStorage';
import { readAccountCache } from '../storage/accountCache';
import { FakeSupabase } from '../test/fakeSupabase';
import { CachedRemoteLoadError, CachedSupabaseDayPopRepository } from './cachedSupabaseRepository';
import { SupabaseDayPopRepository } from './supabaseRepository';

const SELF='00000000-0000-4000-8000-000000000481';
const OTHER='00000000-0000-4000-8000-000000000482';
const CAL='10000000-0000-4000-8000-000000000481';
const RECEIVED='10000000-0000-4000-8000-000000000482';
const EVENT='20000000-0000-4000-8000-000000000481';
const STAMP='2026-10-19T00:00:00.000001Z';

function fixture() {
  const db=new FakeSupabase();
  const personal=createEmptyUserData({idFactory:()=>CAL,now:STAMP});
  db.seed('calendars',[
    {...calendarToInsert(personal.calendars[0]!,SELF),created_at:STAMP,updated_at:STAMP},
    {...calendarToInsert({...personal.calendars[0]!,id:RECEIVED,name:'家人的日曆',isVisible:false},OTHER),created_at:STAMP,updated_at:STAMP},
  ]);
  db.seed('user_preferences',[{...preferencesToInsert(personal.preferences,SELF),created_at:STAMP,updated_at:STAMP}]);
  db.seed('events',[{...eventToInsert({id:EVENT,calendarId:RECEIVED,title:'收到的行程',allDay:true,startDate:'2026-10-19',endDate:'2026-10-19',location:null,notes:null,reminderMinutes:[],recurrence:null,sharingScope:'inherit',createdAt:STAMP,updatedAt:STAMP},OTHER),created_by:OTHER,created_at:STAMP,updated_at:STAMP}]);
  db.sharingManifest=[{calendarId:RECEIVED,ownerId:OTHER,ownerName:'家人',permission:'edit',groupId:'30000000-0000-4000-8000-000000000481',updatedAt:STAMP}];
  return {db,personal};
}

describe('session-only received calendars',()=>{
  it('combines an explicit received set while retaining one personal default and viewer visibility',async()=>{
    const {db}=fixture();
    const repository=new SupabaseDayPopRepository(db.asClient(),SELF);
    const data=await repository.load();
    expect(data.calendars).toHaveLength(2);
    expect(data.calendars.filter(c=>c.isDefault).map(c=>c.id)).toEqual([CAL]);
    expect(data.calendars.find(c=>c.id===RECEIVED)?.isVisible).toBe(true);
    expect(data.events[0]?.title).toBe('收到的行程');
    expect(repository.personalData().events).toEqual([]);
    expect(repository.sharingSession().shares[0]?.permission).toBe('edit');
  });
  it('returns the combined view but writes only owned data to the versioned account cache',async()=>{
    const {db}=fixture(); const storage=new MemoryStorage();
    const repository=new CachedSupabaseDayPopRepository(db.asClient(),SELF,storage);
    expect((await repository.load()).events).toHaveLength(1);
    const cache=readAccountCache(SELF,storage);
    expect(cache.status).toBe('ready');
    if(cache.status==='ready') {
      expect(cache.envelope.data.calendars.map(c=>c.id)).toEqual([CAL]);
      expect(cache.envelope.data.events).toEqual([]);
    }
    expect(storage.getItem(`daypop.account-cache.${SELF}`)).not.toContain('收到的行程');
  });
  it('revalidates grants, removes revoked rows and never persists viewer hide choices',async()=>{
    const {db}=fixture(); const storage=new MemoryStorage();
    const repository=new CachedSupabaseDayPopRepository(db.asClient(),SELF,storage);
    await repository.load();
    const before=storage.getItem(`daypop.account-cache.${SELF}`);
    const hidden=await repository.updateCalendar(RECEIVED,{isVisible:false});
    expect(hidden.calendars.find(c=>c.id===RECEIVED)?.isVisible).toBe(false);
    expect(storage.getItem(`daypop.account-cache.${SELF}`)).toBe(before);
    expect(db.writes).toEqual([]);
    db.sharingManifest=[];
    expect((await repository.load()).events).toEqual([]);
    expect(repository.sharingSession().shares).toEqual([]);
  });
  it('fails closed on invalid metadata and clears previously received content on a failed revalidation',async()=>{
    const {db}=fixture(); const repository=new SupabaseDayPopRepository(db.asClient(),SELF);
    await repository.load();
    db.sharingManifest=[{calendarId:RECEIVED,permission:'owner'}];
    await expect(repository.load()).rejects.toThrow();
    expect(repository.sharingSession().shares).toEqual([]);
    expect(repository.personalData().events).toEqual([]);
  });
  it('uses the loaded full-precision server version and never claims the received owner in a write',async()=>{
    const {db}=fixture(); const repository=new SupabaseDayPopRepository(db.asClient(),SELF);
    await repository.load();
    const saved=await repository.updateEvent(EVENT,{title:'共同修改'});
    expect(saved.events[0]?.title).toBe('共同修改');
    const call=db.rpcCalls.find(c=>c.name==='write_shared_calendar_item');
    expect(call?.args.p_versions).toEqual({events:{[EVENT]:STAMP}});
    expect(call?.args.p_payload).not.toHaveProperty('owner_id');
    expect(call?.args.p_payload).not.toHaveProperty('values.owner_id');
    expect(db.writes.some(w=>w.row.owner_id===SELF && w.row.id===EVENT)).toBe(false);
    expect(repository.personalData().events).toEqual([]);
  });
  it('view permission refuses writes locally and revocation is revalidated after a server rejection',async()=>{
    const {db}=fixture();
    db.sharingManifest=(db.sharingManifest as Record<string,unknown>[]).map(s=>({...s,permission:'view'}));
    const repository=new SupabaseDayPopRepository(db.asClient(),SELF);
    await repository.load();
    await expect(repository.updateEvent(EVENT,{title:'不准寫入'})).rejects.toThrow();
    expect(db.writes).toEqual([]);
    expect(db.rpcCalls.some(c=>c.name==='write_shared_calendar_item')).toBe(false);
    db.sharingManifest=(db.sharingManifest as Record<string,unknown>[]).map(s=>({...s,permission:'edit'}));
    await repository.load();
    db.failures.set('rpc:write_shared_calendar_item','sharing_access_changed');
    db.sharingManifest=[];
    await expect(repository.updateEvent(EVENT,{title:'已撤權草稿'})).rejects.toThrow();
    expect(repository.sharingSession().shares).toEqual([]);
  });
  it('does not acknowledge a changed shared creation draft after a lost response has been reloaded',async()=>{
    const {db}=fixture();const repository=new SupabaseDayPopRepository(db.asClient(),SELF);await repository.load();
    const id='20000000-0000-4000-8000-000000000482';
    const input={id,title:'已保存的原草稿',date:'2026-10-19',allDay:true,start:'',end:'',calendarId:RECEIVED};
    await repository.addEvent(input);await repository.load();
    await expect(repository.addEvent({...input,title:'重試前修改的草稿'})).rejects.toThrow();
    expect(db.rows('events').find(e=>e.id===id)?.title).toBe('已保存的原草稿');
  });
  it.each(['update','cancel','replace'] as const)('rejects a versioned %s after revalidation removes its target',async operation=>{
    const {db}=fixture();db.rows('events')[0]!.recurrence_rule='FREQ=DAILY;COUNT=3';
    const repository=new SupabaseDayPopRepository(db.asClient(),SELF);await repository.load();
    const versions=repository.captureSharingVersions();db.sharingManifest=[];await repository.load();
    const occurrence={kind:'all-day' as const,date:'2026-10-20'};
    const save=()=>operation==='update'?repository.updateEvent(EVENT,{title:'仍需保留的草稿'}):
      operation==='cancel'?repository.cancelEventOccurrence(EVENT,occurrence):repository.replaceEventOccurrence(EVENT,occurrence,{title:'單次草稿'});
    await expect(repository.withSharingVersions(versions,save)).rejects.toThrow('草稿已保留');
    expect(db.writes).toEqual([]);
    expect(repository.personalData().events).toEqual([]);
  });
  it.each([[false,'manifest'],[false,'received-page'],[true,'manifest'],[true,'received-page']] as const)(
    'keeps fresh owned rows on a sharing-only outage (prior cache: %s, failure: %s)',async(priorCache,failure)=>{
      const {db}=fixture();const storage=new MemoryStorage();
      const repository=new CachedSupabaseDayPopRepository(db.asClient(),SELF,storage);
      if(priorCache)await repository.load();
      const personalId='20000000-0000-4000-8000-000000000489';
      db.seed('events',[...db.rows('events'),{...db.rows('events')[0],id:personalId,owner_id:SELF,calendar_id:CAL,title:'雲端剛載入的本人資料'}]);
      if(failure==='manifest')db.failures.set('rpc:calendar_sharing_manifest','sharing unavailable');
      else {
        const rpc=db.rpc.bind(db);
        vi.spyOn(db,'rpc').mockImplementation((name,args)=>{
          if(name==='calendar_sharing_manifest')db.failures.set('events','received page unavailable');
          return rpc(name,args);
        });
      }
      let failureResult:unknown;
      await repository.load().catch(error=>{failureResult=error;});
      expect(failureResult).toBeInstanceOf(CachedRemoteLoadError);
      expect((failureResult as CachedRemoteLoadError).cachedData.events.map(e=>e.id)).toEqual([personalId]);
      expect((failureResult as Error).message).toContain('分享');
      const cached=readAccountCache(SELF,storage);
      expect(cached.status==='ready'?cached.envelope.data.events.map(e=>e.id):[]).toEqual([personalId]);
      expect(repository.sharingSession().available).toBe(false);
      expect(storage.getItem(`daypop.account-cache.${SELF}`)).not.toContain('收到的行程');
  });
});
