import { describe, expect, it } from 'vitest';
import { timedEventFromWallTime } from './eventTime';
import { cancelEventOccurrence, findEventException, replaceEventOccurrence } from './mutations';
import { resolveEventOccurrences } from './recurrence';
import { createEmptyUserData, type DayPopUserData, type EventException } from './types';

const CAL='10000000-0000-4000-8000-000000000215';
const SOURCE='20000000-0000-4000-8000-000000000215';
const EXCEPTION='30000000-0000-4000-8000-000000000215';
const REPLACEMENT='40000000-0000-4000-8000-000000000215';
const NOW='2026-10-26T00:00:00.000123Z';
const WINDOW={startDate:'2026-10-26',endDate:'2026-10-29'};
const REFERENCE={kind:'timed' as const,startsAt:'2026-10-27T13:00:00.000Z'};
function fixture():DayPopUserData {
  const data=createEmptyUserData({idFactory:()=>CAL,now:NOW});
  const event=timedEventFromWallTime({id:SOURCE,calendarId:CAL,title:'紐約站會',location:null,notes:null,
    reminderMinutes:[],recurrence:{rule:'FREQ=DAILY;COUNT=4'},sharingScope:'inherit',createdAt:NOW,updatedAt:NOW},
  {date:'2026-10-26',start:'09:00',end:'10:00'},'America/New_York');
  return {...data,events:[event]};
}
function cancelled(startsAt:string):EventException {
  return {id:EXCEPTION,eventId:SOURCE,occurrence:{kind:'timed',startsAt},isCancelled:true,replacementEventId:null,createdAt:NOW,updatedAt:NOW};
}
function storedReplacement() {
  const data=replaceEventOccurrence(fixture(),SOURCE,REFERENCE,{title:'單次修改'},
    {exceptionId:EXCEPTION,replacementEventId:REPLACEMENT,now:NOW});
  return {...data,eventExceptions:data.eventExceptions.map(row=>({...row,occurrence:{kind:'timed' as const,startsAt:'2026-10-27T13:00:00+00:00'}}))};
}
describe('equivalent timed occurrence instants',()=>{
  it.each(['2026-10-27T13:00:00+00:00','2026-10-27T13:00:00.000000Z','2026-10-27T21:00:00+08:00','2026-10-27T09:00:00-04:00'])('honors a stored cancellation encoded as %s',startsAt=>{
    const data={...fixture(),eventExceptions:[cancelled(startsAt)]};
    const result=resolveEventOccurrences(data,WINDOW);
    expect(result.map(row=>!row.event.allDay&&Date.parse(row.event.startsAt))).toEqual([
      Date.parse('2026-10-26T13:00:00Z'),Date.parse('2026-10-28T13:00:00Z'),Date.parse('2026-10-29T13:00:00Z'),
    ]);
  });
  it('renders a PostgREST replacement once without also rendering its original occurrence',()=>{
    const data=storedReplacement();
    const result=resolveEventOccurrences(data,WINDOW);
    expect(result).toHaveLength(4);
    expect(result.filter(row=>row.replacementEventId===REPLACEMENT)).toHaveLength(1);
    expect(result.filter(row=>row.event.id===SOURCE)).toHaveLength(3);
  });
  it('reuses stored exception and replacement IDs when the same instant is edited again',()=>{
    const result=replaceEventOccurrence(storedReplacement(),SOURCE,REFERENCE,{title:'再次修改'},
      {exceptionId:'50000000-0000-4000-8000-000000000215',replacementEventId:'60000000-0000-4000-8000-000000000215',now:NOW});
    expect(result.eventExceptions).toHaveLength(1);
    expect(result.eventExceptions[0]?.id).toBe(EXCEPTION);
    expect(result.events.filter(event=>event.id!==SOURCE)).toEqual([expect.objectContaining({id:REPLACEMENT,title:'再次修改'})]);
  });
  it('cancels the stored replacement instead of leaving an orphan and a second exception',()=>{
    const result=cancelEventOccurrence(storedReplacement(),SOURCE,REFERENCE,
      {exceptionId:'50000000-0000-4000-8000-000000000215',replacementEventId:REPLACEMENT,now:NOW});
    expect(result.eventExceptions).toHaveLength(1);
    expect(result.eventExceptions[0]).toMatchObject({id:EXCEPTION,isCancelled:true,replacementEventId:null});
    expect(result.events.map(event=>event.id)).toEqual([SOURCE]);
  });
  it('distinguishes submillisecond references while accepting equivalent offset encodings',()=>{
    const data={...fixture(),eventExceptions:[cancelled('2026-10-27T13:00:00.000001+00:00')]};
    expect(findEventException(data,SOURCE,{kind:'timed',startsAt:'2026-10-27T21:00:00.0000010+08:00'})?.id).toBe(EXCEPTION);
    expect(findEventException(data,SOURCE,{kind:'timed',startsAt:'2026-10-27T13:00:00.000002Z'})).toBeUndefined();
    expect(resolveEventOccurrences(data,WINDOW)).toHaveLength(4);
    expect(data.eventExceptions[0]?.updatedAt).toBe(NOW);
  });
  it('keeps the rendered key stable when only the stored UTC encoding changes',()=>{
    const data=fixture();const series=data.events[0]!;
    if(series.allDay)throw new Error('expected timed fixture');
    const first=resolveEventOccurrences({events:[{...series,recurrence:null,startsAt:'2026-10-27T13:00:00+00:00',endsAt:'2026-10-27T14:00:00+00:00'}],eventExceptions:[]},WINDOW);
    const second=resolveEventOccurrences({events:[{...series,recurrence:null,startsAt:REFERENCE.startsAt,endsAt:'2026-10-27T14:00:00.000Z'}],eventExceptions:[]},WINDOW);
    expect(first[0]?.key).toBe(second[0]?.key);
  });
});
