import { describe,expect,it } from 'vitest';
import { LocalDayPopRepository } from '../storage/localRepository';
import { MemoryStorage } from '../storage/browserStorage';

describe('existing sharing scope controls',()=>{
  it('keeps private scope on new guest items without changing the v4 document shape',async()=>{
    const repository=new LocalDayPopRepository(new MemoryStorage());await repository.load();
    const data=await repository.addEvent({title:'保密',date:'2026-10-19',allDay:true,start:'',end:'',sharingScope:'private'});
    expect(data.events[0]?.sharingScope).toBe('private');
    const todoData=await repository.addTodo({title:'保密待辦',date:'2026-10-19',sharingScope:'private'});
    expect(todoData.todos[0]?.sharingScope).toBe('private');
  });
  it('changes privacy across the entire connected recurrence series',async()=>{
    const repository=new LocalDayPopRepository(new MemoryStorage());await repository.load();
    const event=(await repository.addEvent({title:'系列',date:'2026-10-19',allDay:true,start:'',end:'',recurrenceRule:'FREQ=DAILY'})).events[0]!;
    await repository.replaceEventOccurrence(event.id,{kind:'all-day',date:'2026-10-20'},{title:'單次修改'});
    const data=await repository.updateEvent(event.id,{sharingScope:'private'});
    expect(data.events).toHaveLength(2);
    expect(data.events.every(e=>e.sharingScope==='private')).toBe(true);
    const restored=await repository.updateEvent(data.events.find(e=>e.id!==event.id)!.id,{sharingScope:'inherit'});
    expect(restored.events.every(e=>e.sharingScope==='inherit')).toBe(true);
    const privateReplacement=await repository.replaceEventOccurrence(event.id,{kind:'all-day',date:'2026-10-21'},{sharingScope:'private'});
    expect(privateReplacement.events.every(e=>e.sharingScope==='private')).toBe(true);
  });
});
