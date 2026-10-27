import { describe, expect, it, vi } from 'vitest';
import { calendarToInsert, preferencesToInsert } from '../domain/databaseMapping';
import { createEmptyUserData } from '../domain/types';
import { FakeSupabase } from '../test/fakeSupabase';
import { SupabaseDayPopRepository } from './supabaseRepository';

const OWNER='00000000-0000-4000-8000-000000000215';
const CAL='10000000-0000-4000-8000-000000000215';
const NOW='2026-10-26T00:00:00.000Z';
describe('occurrence RPC replies with equivalent timestamp encodings',()=>{
  it('merges the stored exception after a committed response was lost and retry proposed another ID',async()=>{
    const db=new FakeSupabase();
    const data=createEmptyUserData({idFactory:()=>CAL,now:NOW});
    db.seed('calendars',[{...calendarToInsert(data.calendars[0]!,OWNER),created_at:NOW,updated_at:NOW}]);
    db.seed('user_preferences',[{...preferencesToInsert(data.preferences,OWNER),created_at:NOW,updated_at:NOW}]);
    const repository=new SupabaseDayPopRepository(db.asClient(),OWNER);
    await repository.load();
    const created=await repository.addEvent({title:'每日會議',calendarId:CAL,date:'2026-10-26',allDay:false,start:'09:00',end:'10:00',timezone:'America/New_York',recurrenceRule:'FREQ=DAILY;COUNT=4'});
    const source=created.events[0]!;
    const rpc=db.rpc.bind(db);let replies=0;
    vi.spyOn(db,'rpc').mockImplementation(async(name,args)=>{
      const result=await rpc(name,args);
      if(name!=='replace_event_occurrence'||result.error)return result;
      replies++;
      if(replies===1)return {data:null,error:{message:'synthetic response lost after commit'}};
      const value=result.data as {exception:Record<string,unknown>};
      return {...result,data:{...value,exception:{...value.exception,occurrence_starts_at:'2026-10-27T13:00:00+00:00'}}};
    });
    const occurrence={kind:'timed' as const,startsAt:'2026-10-27T13:00:00.000Z'};
    await expect(repository.replaceEventOccurrence(source.id,occurrence,{title:'單次改期'})).rejects.toThrow();
    const restored=await repository.replaceEventOccurrence(source.id,occurrence,{title:'單次改期'});
    expect(replies).toBe(2);
    expect(db.rows('event_exceptions')).toHaveLength(1);
    expect(restored.eventExceptions).toHaveLength(1);
    expect(restored.eventExceptions[0]?.id).toBe(db.rows('event_exceptions')[0]?.id);
    expect(restored.events).toHaveLength(2);
    expect(restored.events.some(event=>event.id===restored.eventExceptions[0]?.replacementEventId&&event.title==='單次改期')).toBe(true);
  });
});
